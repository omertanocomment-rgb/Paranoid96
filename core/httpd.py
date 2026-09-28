"""
Embedded HTTP server — zero third-party dependencies, plain request/response.

`server.py` uses FastAPI/uvicorn, which is great everywhere except Android:
uvicorn -> (via FastAPI) pydantic -> pydantic-core, a Rust extension with no
prebuilt Android wheel. So the Android app can't ship it. This server speaks
the exact same protocol using only the standard library (`http.server`), and
both delegate every request to `core/api.py`, so the agent, the approval gate
and the wire format are identical no matter which server is running.

There is no websocket and nothing to install or configure: chat is a normal
`POST /api/chat` (one request in, one JSON reply out). It is used by the in-APK
backend (see `omerta_android.py`) and works as a drop-in `omerta serve`
fallback on any machine where FastAPI isn't installed.
"""
import os
import json
import threading
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from . import config, auth, mcp, api, dispatch

PUBLIC_PATHS = {"/favicon.ico", "/icon.svg"}
_CTYPES = {".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
           ".json": "application/json", ".css": "text/css", ".js": "text/javascript"}


# ── request handler ─────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OmertaHTTPD/1.0"

    def log_message(self, fmt, *args):            # quiet unless asked
        if config.get("OMERTA_HTTPD_LOG"):
            super().log_message(fmt, *args)

    # -- helpers --------------------------------------------------------------
    def _query(self):
        return parse_qs(urlparse(self.path).query)

    def _query_token(self):
        return (self._query().get("token") or [None])[0]

    def _cookie_token(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            return SimpleCookie(raw).get(auth.COOKIE).value
        except Exception:  # noqa: BLE001
            return None

    # The local-only list lives in core/dispatch, so every transport enforces
    # the same one. Two copies is how /api/attach came to be local-only on one
    # server and open on the other.
    LOCAL_ONLY = dispatch.LOCAL_ONLY

    def _is_local_only(self, path):
        return dispatch.is_local_only(path)

    def _local(self):
        """Did this request genuinely come from this device? Forwarding
        headers make the source unknowable, so they forfeit "local"."""
        client = self.client_address[0] if self.client_address else ""
        return auth.is_local_request(client, auth.forwarded(self.headers))

    def _authorized(self):
        client = self.client_address[0] if self.client_address else ""
        tok = (self._query_token()
               or self.headers.get("x-omerta-token")
               or self._cookie_token())
        return auth.check(tok, client, spoofable=auth.forwarded(self.headers))

    def _send(self, body: bytes, ctype="application/json", status=200, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # set the auth cookie after a successful ?token= handshake, like server.py
        if self._query_token():
            self.send_header(
                "Set-Cookie",
                f"{auth.COOKIE}={self._query_token()}; HttpOnly; SameSite=Lax; "
                f"Max-Age={60 * 60 * 24 * 365}; Path=/")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, obj, status=200):
        if isinstance(obj, dict) and "_status" in obj:
            obj = dict(obj)
            status = obj.pop("_status")
        self._send(json.dumps(obj, default=str).encode(), "application/json", status)

    def _unauthorized(self):
        self._json({"error": "unauthorized",
                    "hint": "append ?token=... (printed in the server console)"}, 401)

    MAX_BODY = 16 * 1024 * 1024        # 16 MiB — generous for a chat/sync payload

    def _body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if not n:
            return {}
        if n > self.MAX_BODY:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode() or "{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def _recv_attachment(self):
        """Stream an upload to disk. No size cap, no type check.

        Deliberately NOT going through _body(): that caps at 16 MiB and decodes
        the whole request before anything looks at it, which for a multi-
        gigabyte file would take the app down. Reading in chunks means the file
        never exists in memory, so the only real limit is the device's disk.
        """
        from . import attach
        try:
            declared = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError:
            return {"error": "bad Content-Length"}
        if declared <= 0:
            return {"error": "no body — send the file bytes as the request body"}
        name = (self.headers.get("x-omerta-filename")
                or self._query().get("name", [""])[0] or "attachment")
        project = (self.headers.get("x-omerta-project")
                   or self._query().get("project", [""])[0] or "")
        note = self.headers.get("x-omerta-note", "")

        remaining = {"n": declared}

        def read(size):
            # Never read past Content-Length: the socket does not close after
            # the body, so an over-read would block until the client times out.
            want = min(size, remaining["n"])
            if want <= 0:
                return b""
            chunk = self.rfile.read(want)
            remaining["n"] -= len(chunk)
            return chunk

        return attach.save_stream(read, name, project=project, note=note,
                                  declared_size=declared)

    def _send_attachment(self, aid):
        from . import attach
        p = attach.path_for(aid.strip("/"))
        if p is None:
            return self._json({"error": "no such attachment"}, 404)
        rec = attach.get(aid.strip("/")) or {}
        try:
            size = p.stat().st_size
            self.send_response(200)
            # Every attachment comes back as an opaque download. Anything else
            # would let a stored .html or .svg run as script inside the app's
            # own origin -- which is not a limit on what may be uploaded, only
            # a refusal to execute it here.
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition",
                             'attachment; filename="%s"'
                             % rec.get("name", "attachment").replace('"', ""))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(size))
            self.end_headers()
            with open(p, "rb") as fh:
                while True:
                    chunk = fh.read(attach.CHUNK)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except OSError:
            pass
        return None

    def _serve_asset(self, name):
        path = (config.ASSETS_DIR / name).resolve()
        if config.ASSETS_DIR.resolve() not in path.parents or not path.is_file():
            self._send(b"not found", "text/plain", 404)
            return
        ctype = _CTYPES.get(path.suffix, "application/octet-stream")
        self._send(path.read_bytes(), ctype)

    def _serve_theme_asset(self, name):
        from . import theme as _t
        p = _t.image_path(name)
        if not p:
            return self._send(b"not found", "text/plain", 404)
        ext = os.path.splitext(p)[1].lower()
        ctype = {".png": "image/png", ".jpg": "image/jpeg",
                 ".gif": "image/gif", ".webp": "image/webp"}.get(ext,
                                                                 "image/png")
        with open(p, "rb") as f:
            self._send(f.read(), ctype)

    # -- GET ------------------------------------------------------------------
    def do_GET(self):
        path = urlparse(self.path).path

        # public, unauthenticated
        if path == "/favicon.ico":
            return self._serve_asset("favicon.ico")
        if path == "/icon.svg":
            return self._serve_asset("icon.svg")
        if path.startswith("/assets/"):
            return self._serve_asset(path[len("/assets/"):])
        if path == "/theme.css":
            return self._send(api.theme_css().encode(), "text/css; charset=utf-8")
        if path.startswith("/theme/asset/"):
            return self._serve_theme_asset(path[len("/theme/asset/"):])

        if not self._authorized():
            return self._unauthorized()
        if self._is_local_only(path) and not self._local():
            return self._json({"error": f"{path} is local-only"}, 403)

        if path == "/":
            try:
                html = (config.WEBUI_DIR / "index.html").read_text(encoding="utf-8")
            except (OSError, ValueError) as e:
                # ValueError covers UnicodeDecodeError. Reading the UI without
                # naming an encoding used the locale default, which is cp1252
                # on Windows, and index.html is UTF-8 -- so on Windows this
                # raised straight out of the handler and the browser got an
                # empty reply with no clue why. A 500 that says what happened
                # is worth more than a dropped connection.
                return self._send(f"web UI unreadable: {e}".encode(),
                                  "text/plain", 500)
            return self._send(html.encode(), "text/html; charset=utf-8")
        # Streaming download: the bytes must not be assembled in memory, so it
        # cannot go through the shared dispatcher.
        if path.startswith("/api/attach/"):
            return self._send_attachment(path[len("/api/attach/"):])

        status, payload = dispatch.handle("GET", path, query=self._query(),
                                          local=self._local())
        return self._json(payload, status)

    # -- POST -----------------------------------------------------------------
    def do_POST(self):
        path = urlparse(self.path).path
        if not self._authorized():
            return self._unauthorized()
        if self._is_local_only(path) and not self._local():
            return self._json({"error": f"{path} is local-only"}, 403)
        # Streaming upload: no size cap and nothing held in memory, so it
        # cannot go through the shared dispatcher.
        if path == "/api/attach":
            return self._json(self._recv_attachment())

        status, payload = dispatch.handle("POST", path, body=self._body(),
                                          local=self._local())
        return self._json(payload, status)


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server(host=None, port=None):
    api.boot()
    mcp.connect_all()
    for label, result in api.startup_sync():
        print(f"[{label}]", result)
    host = host or config.SERVER_HOST
    port = int(port or config.SERVER_PORT)
    return _Server((host, port), Handler)


def serve_background(host=None, port=None):
    """Start the server on a daemon thread and return (server, thread, token).
    Used by the Android app, which drives its own UI thread."""
    srv = make_server(host, port)
    t = threading.Thread(target=srv.serve_forever, name="omerta-httpd", daemon=True)
    t.start()
    return srv, t, (auth.get_token() if auth.enabled() else None)


def run(host=None, port=None):
    srv = make_server(host, port)
    h, p = srv.server_address[0], srv.server_address[1]
    print("\n  OMERTA AGENT (stdlib server)")
    if auth.enabled():
        for u in auth.lan_urls(p):
            print(f"    {u}")
        print(f"\n  token: {auth.get_token()}")
        print("  loopback is exempt, so the desktop app and CLI just work.")
    else:
        print("  !! AUTH DISABLED — anyone on this network can run commands.")
        print(f"    http://{h}:{p}")
    print()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    run()
