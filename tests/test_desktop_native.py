#!/usr/bin/env python3
"""The Linux desktop application: a window, not a web app and not a terminal.

The .deb used to install a command you ran in a terminal, and the only windowed
option was an Electron shell pointing at an HTTP server on localhost. Neither
is a desktop application in the sense that matters: something you install, find
in your applications menu, and click.

This is the Linux counterpart of what the Android app does. GTK's WebKit lets a
program answer requests for a URI scheme itself, so the UI is served on
`omerta:///` straight out of core/dispatch -- no socket, no port, nothing
listening, and no terminal to keep open. Because WebKit hands the request body
to the scheme handler, the page needs no special case at all: fetch('/api/x')
just arrives.

Two halves are checked here. The serving logic runs anywhere, with GTK stubbed
out. The window itself needs GTK, WebKit and a display, so it runs as a
subprocess under whichever interpreter actually has the bindings and is skipped
-- not failed -- when there is none.
"""
import os
import shutil
import subprocess
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "desktop_native" / "omerta_desktop.py"

fails = []


def check(label, cond, detail=""):
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {detail}" if not cond else ""))
    if not cond:
        fails.append(label)


print("=== native desktop app ===")

# ── 1. the serving logic, with GTK stubbed ─────────────────────────────────
# The module exits if gi is missing, which is right for a launcher and useless
# for a test, so the import is satisfied with stand-ins.
class _Any:
    """Stands in for any GTK symbol, including ones used as base classes."""

    def __init__(self, *a, **k):
        pass

    def __getattr__(self, _name):
        return _Any

    def __call__(self, *a, **k):
        return _Any()


class _Mod(types.ModuleType):
    def __getattr__(self, _name):
        return _Any


def _stub_gi():
    gi = types.ModuleType("gi")
    gi.require_version = lambda *a, **k: None
    repo = types.ModuleType("gi.repository")
    for name in ("Gtk", "WebKit2", "Gio", "GLib"):
        setattr(repo, name, _Mod(name))
    gi.repository = repo
    sys.modules["gi"] = gi
    sys.modules["gi.repository"] = repo


_stub_gi()
sys.path.insert(0, str(ROOT / "desktop_native"))
sys.path.insert(0, str(ROOT))
import omerta_desktop as app  # noqa: E402

check("the app finds the agent's code", (app.ROOT / "core" / "dispatch.py").is_file(),
      app.ROOT)

got = app._static("/")
check("the UI is served at the root", got is not None and got[1] == "text/html")
check("and it is the real page", got is not None and b"OMERTA" in got[0])

# a served directory plus ../ is how a UI bug becomes "read any file"
for bad in ("/assets/../../etc/passwd", "/assets/../../../etc/shadow",
            "/webui/../../etc/passwd"):
    check(f"traversal refused: {bad}", app._static(bad) is None)

check("an unknown path is not served", app._static("/nope") is None)

data, ctype, status = app._api("GET", "/api/version", {}, None)
check("the API answers in-process", status == 200 and ctype == "application/json")
import json  # noqa: E402
check("and reports a real version", bool(json.loads(data).get("version")))

data, _c, status = app._api("GET", "/api/no-such-route", {}, None)
check("an unknown route is a 404, not a crash", status == 404)

# local-only surfaces are direct operation of THIS machine; in-process is local
data, _c, status = app._api("GET", "/api/term", {}, None)
check("local-only routes are reachable from the window itself", status == 200)

# ── 2. packaging: it has to be installable and findable ────────────────────
deb = (ROOT / "packaging" / "build-deb.sh").read_text(encoding="utf-8")
check("the .deb ships the desktop app", "desktop_native" in deb)
check("and a launcher on PATH", "usr/bin/omerta-desktop" in deb)
check("and a menu entry", "usr/share/applications" in deb)
check("and icons for the shell", "icons/hicolor" in deb)
check("and depends on the GTK/WebKit bindings",
      "python3-gi" in deb and "gir1.2-webkit2" in deb)
check("and refreshes the desktop database after install", "postinst" in deb)

entry = (ROOT / "packaging" / "omerta.desktop").read_text(encoding="utf-8")
for key in ("Type=Application", "Exec=omerta-desktop", "Icon=omerta-agent",
            "Terminal=false"):
    check(f"desktop entry declares {key}", key in entry)

# ── 3. the window itself, when this machine can run one ────────────────────
def interpreter_with_gi():
    for exe in ("python3", "/usr/bin/python3", "/usr/bin/python3.12",
                "/usr/bin/python3.13", "/usr/bin/python3.11"):
        p = shutil.which(exe) if not exe.startswith("/") else (
            exe if os.path.exists(exe) else None)
        if not p:
            continue
        r = subprocess.run(
            [p, "-c", "import gi;gi.require_version('Gtk','3.0');"
                      "gi.require_version('WebKit2','4.1');"
                      "from gi.repository import Gtk, WebKit2"],
            capture_output=True)
        if r.returncode == 0:
            return p
    return None


py = interpreter_with_gi()
if py is None or not shutil.which("xvfb-run"):
    print("  – no GTK/WebKit interpreter or no display — skipping the window "
          "(not a failure)")
else:
    driver = f'''
import sys, json
sys.argv = ["omerta_desktop"]
sys.path.insert(0, {str(ROOT / "desktop_native")!r})
sys.path.insert(0, {str(ROOT)!r})
import gi
gi.require_version("Gtk","3.0")
try: gi.require_version("WebKit2","4.1")
except ValueError: gi.require_version("WebKit2","4.0")
from gi.repository import Gtk, WebKit2, GLib
import omerta_desktop as d
out = {{}}
ctx = WebKit2.WebContext.get_default()
ctx.register_uri_scheme(d.SCHEME, d.on_request, None)
sm = ctx.get_security_manager(); sm.register_uri_scheme_as_secure(d.SCHEME)
view = WebKit2.WebView()
w = Gtk.Window(); w.set_default_size(1000,760); w.add(view); w.show_all()
def js(code, key, then=None):
    def cb(v, r):
        try:
            val = v.evaluate_javascript_finish(r)
            out[key] = val.to_string() if val else None
        except Exception as e: out[key] = "ERR %{{}}s" % e
        if then: then()
    view.evaluate_javascript(code, -1, None, None, None, cb)
def on_load(v, ev):
    if ev != WebKit2.LoadEvent.FINISHED: return
    def read(): js("String(window.__r)", "api", Gtk.main_quit)
    def kick():
        js("""(async()=>{{try{{
               const a = await get('/api/version');
               const b = await post('/api/chats/action', {{action:'list'}});
               window.__r = a.version + '|post:' + (b ? 'ok' : 'none') +
                            '|secure:' + window.isSecureContext;
             }}catch(e){{ window.__r = 'ERR ' + e.message; }}}})(); 'go'""",
           "kick", lambda: GLib.timeout_add(2000, lambda: (read(), False)[1]))
    js("document.title + '|' + document.querySelectorAll('nav button').length",
       "title", kick)
view.connect("load-changed", on_load)
GLib.timeout_add_seconds(35, Gtk.main_quit)
view.load_uri(d.BASE)
Gtk.main()
print("RESULT " + json.dumps(out))
'''
    r = subprocess.run(["xvfb-run", "-a", py, "-c", driver],
                       capture_output=True, text=True, timeout=300)
    line = ""
    for ln in (r.stdout or "").splitlines():
        if ln.startswith("RESULT "):
            line = ln[len("RESULT "):]
    data = json.loads(line) if line else {}
    check("the window loads the UI", (data.get("title") or "").startswith("OMERTA AI"),
          data or (r.stdout + r.stderr)[-300:])
    check("with its tabs rendered",
          (data.get("title") or "").endswith("|6"), data.get("title"))
    api = data.get("api") or ""
    check("a GET reaches the backend through the private scheme",
          api.startswith("1."), api)
    check("a POST body reaches it too (no HTTP server involved)",
          "post:ok" in api, api)
    check("the page is a secure context, so clipboard and mic work",
          "secure:true" in api, api)

if fails:
    print(f"\n{len(fails)} FAILED")
    sys.exit(1)
print("\nDESKTOP APP TESTS PASSED")
