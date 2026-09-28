#!/usr/bin/env python3
"""
OMERTA AI — a desktop application, not a web app and not a terminal.

This is the Linux counterpart of what the Android app does: the backend runs
INSIDE this process, and the window talks to it directly. There is no HTTP
server, no port, no localhost URL and nothing to start in a terminal first.
You install the .deb, the agent appears in your applications menu, and it opens
in its own window.

How the window and the backend talk
-----------------------------------
GTK's WebKit lets an application register a URI scheme and answer requests for
it itself. The UI is served on `omerta:///`, and every request the page makes
-- the page itself, its assets, and each /api/... call -- is handled here by
calling core/dispatch directly. Nothing is serialised over a socket, and
nothing is listening.

That also means the UI needs no special case for the desktop: `fetch('/api/x')`
resolves against `omerta:///` and arrives here, exactly as it would have
arrived at an HTTP server. WebKit has exposed the request body to scheme
handlers since 2.40, which is what makes POST work without a server.

Why WebKit rather than a widget toolkit
---------------------------------------
The interface is one HTML document that the phone, the desktop and a LAN
browser all share, so a GTK-widget rewrite would mean maintaining two of them
and letting them drift. The application itself is native -- a real window, a
real menu entry, its own process -- and the renderer is the system's WebKit,
which is also what an Electron app would be doing with a private copy of
Chromium.

Run it with: omerta-desktop
"""
import json
import mimetypes
import os
import sys
import threading
import traceback
from pathlib import Path
from urllib.parse import urlparse, parse_qs

try:
    import gi

    gi.require_version("Gtk", "3.0")
    try:
        gi.require_version("WebKit2", "4.1")
    except ValueError:                              # older distributions
        gi.require_version("WebKit2", "4.0")
    from gi.repository import Gtk, WebKit2, Gio, GLib
except (ImportError, ValueError) as _e:
    # The .deb depends on these, so reaching this means the launcher is running
    # under a DIFFERENT python than the one the distribution packaged them for
    # -- a hand-built interpreter earlier on PATH, usually. Say that, and say
    # what still works, rather than printing a traceback about a missing _gi.
    sys.stderr.write(
        "OMERTA AI: the desktop window needs GTK and WebKit for this Python.\n"
        f"  python : {sys.executable} ({sys.version.split()[0]})\n"
        f"  missing: {_e}\n\n"
        "  Debian/Ubuntu:  sudo apt install python3-gi gir1.2-gtk-3.0 "
        "gir1.2-webkit2-4.1\n"
        "  If you build your own Python, run the app with the system one:\n"
        "      /usr/bin/python3 /opt/omerta-agent/desktop_native/omerta_desktop.py\n\n"
        "  The agent itself is fine either way -- `omerta` and `omerta serve`\n"
        "  do not need a window.\n")
    sys.exit(1)

SCHEME = "omerta"
BASE = f"{SCHEME}:///"
APP_ID = "com.omerta.agent"


def _root():
    """Where the agent's code and resources live.

    Installed from the .deb that is /opt/omerta-agent; run from a checkout it
    is the directory above this file. OMERTA_HOME wins over both so the same
    launcher can point at a working tree.
    """
    env = os.environ.get("OMERTA_HOME")
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    for cand in (here.parent, Path("/opt/omerta-agent")):
        if (cand / "core" / "dispatch.py").is_file():
            return cand
    return here.parent


ROOT = _root()
sys.path.insert(0, str(ROOT))


# ── serving the UI, in-process ──────────────────────────────────────────────
def _static(path):
    """(bytes, content-type) for a file the UI asks for, or None."""
    if path in ("/", "/index.html"):
        f = ROOT / "webui" / "index.html"
    elif path.startswith("/assets/"):
        f = ROOT / "assets" / path[len("/assets/"):]
    elif path in ("/icon.svg", "/favicon.ico"):
        f = ROOT / "assets" / path[1:]
    elif path.startswith("/webui/"):
        f = ROOT / "webui" / path[len("/webui/"):]
    else:
        return None
    try:
        f = f.resolve()
        # A served directory plus "../" is how a UI bug becomes "read any file
        # on the machine", so anything that climbed out is simply not found.
        if ROOT.resolve() not in f.parents or not f.is_file():
            return None
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        return f.read_bytes(), ctype
    except OSError:
        return None


def _generated(path):
    """The theme stylesheet and its images, which are built rather than read."""
    from core import api
    if path == "/theme.css":
        return api.theme_css().encode("utf-8"), "text/css"
    prefix = "/theme/asset/"
    if path.startswith(prefix):
        from core import theme
        p = theme.image_path(path[len(prefix):])
        if not p:
            return None
        ctype = mimetypes.guess_type(str(p))[0] or "image/png"
        with open(p, "rb") as fh:
            return fh.read(), ctype
    return None


def _api(method, path, query, body):
    from core import dispatch
    status, payload = dispatch.handle(method, path, query=query, body=body,
                                      local=True)
    return (json.dumps(payload, default=str).encode("utf-8"),
            "application/json", status)


def _read_body(request):
    """The request body, or None. Only POST has one."""
    try:
        stream = request.get_http_body()
    except AttributeError:
        return None                                  # WebKit older than 2.40
    if stream is None:
        return None
    out = bytearray()
    while True:
        chunk = stream.read_bytes(64 * 1024, None)
        if chunk is None or chunk.get_size() == 0:
            break
        out += chunk.get_data()
    if not out:
        return None
    try:
        return json.loads(out.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def _finish(request, data, ctype):
    stream = Gio.MemoryInputStream.new_from_data(data, None)
    request.finish(stream, len(data), ctype)


def on_request(request, _user_data=None):
    """Answer one request for omerta:///...

    The work happens on a thread: a chat turn can take a minute, and doing it
    on the main loop would freeze the window with no way to tell whether it had
    crashed. The reply is delivered back on the main loop, because that is
    where GTK objects may be touched.
    """
    uri = urlparse(request.get_uri())
    path = uri.path or "/"
    method = "GET"
    try:
        method = (request.get_http_method() or "GET").upper()
    except AttributeError:
        pass
    query = parse_qs(uri.query)
    body = _read_body(request) if method == "POST" else None

    def work():
        try:
            if path.startswith("/api/"):
                data, ctype, _status = _api(method, path, query, body)
            else:
                got = _static(path) or _generated(path)
                if got is None:
                    data, ctype = b"not found", "text/plain"
                else:
                    data, ctype = got
        except Exception:                            # noqa: BLE001
            # A failure has to reach the window as something renderable. An
            # exception escaping here leaves the request unanswered and the
            # page waiting forever with no clue why.
            detail = traceback.format_exc()[-2000:]
            data = json.dumps({"error": "request failed",
                               "trace": detail}).encode("utf-8")
            ctype = "application/json"
        GLib.idle_add(_finish, request, bytes(data), ctype)

    threading.Thread(target=work, daemon=True).start()


# ── the window ──────────────────────────────────────────────────────────────
class Omerta(Gtk.Application):

    def __init__(self):
        super().__init__(application_id=APP_ID,
                         flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.win = None

    def do_command_line(self, _cmdline):
        self.activate()
        return 0

    def do_activate(self):
        if self.win is not None:
            self.win.present()
            return

        ctx = WebKit2.WebContext.get_default()
        ctx.register_uri_scheme(SCHEME, on_request, None)
        sec = ctx.get_security_manager()
        # Registering the scheme as secure is what gives the page a secure
        # context, and with it navigator.clipboard and getUserMedia. Over
        # http://127.0.0.1 both were unavailable and the copy buttons needed a
        # fallback path.
        sec.register_uri_scheme_as_secure(SCHEME)
        sec.register_uri_scheme_as_cors_enabled(SCHEME)

        view = WebKit2.WebView()
        s = view.get_settings()
        s.set_property("enable-developer-extras", True)
        s.set_property("javascript-can-access-clipboard", True)
        s.set_property("enable-media-stream", True)
        view.connect("permission-request", self._on_permission)

        self.win = Gtk.ApplicationWindow(application=self)
        self.win.set_title("OMERTA AI")
        self.win.set_default_size(1200, 820)
        icon = ROOT / "assets" / "icon_512.png"
        if icon.is_file():
            try:
                self.win.set_icon_from_file(str(icon))
            except Exception:                        # noqa: BLE001
                pass
        self.win.add(view)
        self.win.show_all()
        view.load_uri(BASE)

    @staticmethod
    def _on_permission(_view, request):
        # The only page loaded is ours, on a scheme only this process answers,
        # so a microphone request here is the user pressing the mic button in
        # the agent's own UI.
        if isinstance(request, WebKit2.UserMediaPermissionRequest):
            request.allow()
            return True
        request.deny()
        return True


def main():
    # The backend has to be initialised before the first request arrives, and
    # it is the same bring-up the servers do.
    try:
        from core import api, mcp
        api.boot()
        try:
            mcp.connect_all()
        except Exception:                            # noqa: BLE001
            pass
    except Exception:                                # noqa: BLE001
        # Still open the window: it can show the failure, which is worth more
        # than exiting to a terminal the user may not have open.
        traceback.print_exc()
    return Omerta().run(sys.argv)


if __name__ == "__main__":
    sys.exit(main())
