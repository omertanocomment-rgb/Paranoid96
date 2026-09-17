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

from . import config, auth, mcp, api

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

    # Surfaces that are DIRECT OPERATION of this device rather than the agent
    # acting: a shell, the editor's writes, a sandbox that executes commands,
    # and learning a file by absolute path. None of them route through the
    # approval gate, because you are the one driving them -- which is exactly
    # why none of them may be driven from another machine. /api/chat is not
    # here: it goes through the gate, so a token is enough for it.
    LOCAL_ONLY = ("/api/term", "/api/ws/", "/api/scratch", "/api/learn/path")

    def _is_local_only(self, path):
        return any(path == p.rstrip("/") or path.startswith(p)
                   for p in self.LOCAL_ONLY)

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
                html = (config.WEBUI_DIR / "index.html").read_text()
            except OSError as e:
                return self._send(f"web UI missing: {e}".encode(), "text/plain", 500)
            return self._send(html.encode(), "text/html; charset=utf-8")
        if path == "/api/status":
            return self._json(api.status_payload())
        if path == "/api/version":
            return self._json(api.version_payload())
        if path == "/api/memory":
            q = self._query()
            return self._json(api.memory_payload(
                (q.get("q") or [""])[0], project=(q.get("project") or [None])[0],
                k=int((q.get("k") or [25])[0])))
        if path == "/api/history":
            n = int((self._query().get("n") or [50])[0])
            return self._json(api.history_payload(n))
        if path == "/api/sync/pull":
            q = self._query()
            return self._json(api.sync_pull(
                since=float((q.get("since") or [0])[0]),
                project=(q.get("project") or [None])[0]))
        if path == "/api/sync/status":
            return self._json(api.sync_status())
        if path == "/api/secret":
            return self._json(api.secret_status())
        if path == "/api/policy":
            return self._json(api.policy_status())
        if path == "/api/settings":
            return self._json(api.settings_payload())
        if path == "/api/workmode":
            return self._json(api.mode_status())
        if path == "/api/learn":
            q = self._query()
            return self._json(api.learn_list((q.get("project") or [None])[0]))
        if path == "/api/learn/doc":
            return self._json(api.learn_read((self._query().get("id") or [""])[0]))
        if path == "/api/learn/behaviour":
            q = self._query()
            return self._json(api.learned_behaviour((q.get("project") or [None])[0]))
        if path == "/api/chats":
            q = self._query()
            return self._json(api.chat_list(
                (q.get("project") or [None])[0],
                archived=(q.get("archived") or ["0"])[0] in ("1", "true")))
        if path == "/api/theme":
            return self._json(api.theme_list())
        if path == "/api/scratch":
            return self._json(api.scratch_list())
        if path == "/api/ws/backups":
            return self._json(api.ws_backups())
        if path == "/api/chats/projects":
            return self._json(api.chat_projects())
        if path == "/api/chats/open":
            return self._json(api.chat_open((self._query().get("id") or [""])[0]))
        if path.startswith("/api/term"):
            if path == "/api/term":
                return self._json(api.term_list())
            if path == "/api/term/read":
                q = self._query()
                return self._json(api.term_read(
                    {"id": (q.get("id") or [""])[0],
                     "offset": int((q.get("offset") or [0])[0])}))
        return self._json({"error": f"no route {path}"}, 404)

    # -- POST -----------------------------------------------------------------
    def do_POST(self):
        path = urlparse(self.path).path
        if not self._authorized():
            return self._unauthorized()
        if self._is_local_only(path) and not self._local():
            return self._json({"error": f"{path} is local-only"}, 403)
        if path == "/api/chat":
            return self._json(api.chat(self._body()))
        if path == "/api/model":
            return self._json(api.set_model(self._body()))
        if path == "/api/mode":
            return self._json(api.set_mode(self._body()))
        if path == "/api/sync/push":
            return self._json(api.sync_push(self._body()))
        if path == "/api/sync/run":
            return self._json(api.sync_run(self._body()))
        if path == "/api/plugins/reload":
            return self._json(api.reload_plugins())
        if path == "/api/connectors/reconnect":
            return self._json(api.reconnect())
        if path == "/api/secret":
            # writing a secret is only ever allowed from the local device,
            # in addition to core.api's ALLOW_SECRET_API gate.
            if not self._local():
                return self._json({"error": "secrets can only be set locally"}, 403)
            return self._json(api.set_secret(self._body()))
        if path == "/api/policy":
            return self._json(api.set_policy(self._body()))
        if path == "/api/settings":
            return self._json(api.set_settings(self._body()))
        if path == "/api/workmode":
            return self._json(api.set_work_mode(self._body()))
        if path == "/api/learn/upload":
            return self._json(api.learn_upload(self._body()))
        if path == "/api/learn/path":
            return self._json(api.learn_add_path(self._body()))
        if path == "/api/learn/forget":
            return self._json(api.learn_forget(self._body()))
        if path == "/api/chats/new":
            return self._json(api.chat_new(self._body()))
        if path.startswith("/api/theme/"):
            verbs = {"use": api.theme_use, "save": api.theme_save,
                     "delete": api.theme_delete, "image": api.theme_image,
                     "clear": api.theme_clear_image}
            fn = verbs.get(path[len("/api/theme/"):])
            if fn:
                return self._json(fn(self._body()))
        if path.startswith("/api/scratch/"):
            verbs = {"new": api.scratch_new, "run": api.scratch_run,
                     "changes": api.scratch_changes, "diff": api.scratch_diff,
                     "propose": api.scratch_propose, "accept": api.scratch_accept,
                     "discard": api.scratch_discard}
            fn = verbs.get(path[len("/api/scratch/"):])
            if fn:
                return self._json(fn(self._body()))
        if path == "/api/ws/tree":
            return self._json(api.ws_tree(self._body()))
        if path == "/api/ws/read":
            return self._json(api.ws_read(self._body()))
        if path == "/api/ws/propose":
            return self._json(api.ws_propose(self._body()))
        if path == "/api/ws/commit":
            return self._json(api.ws_commit(self._body()))
        if path == "/api/ws/backup":
            return self._json(api.ws_backup_read(self._body()))
        if path == "/api/ws/reindex":
            return self._json(api.ws_reindex(self._body()))
        if path == "/api/ws/search":
            return self._json(api.ws_search(self._body()))
        if path == "/api/chats/export":
            return self._json(api.chat_action(
                {**(self._body() or {}), "action": "export"}))
        if path == "/api/chats/import":
            return self._json(api.chat_action(
                {**(self._body() or {}), "action": "import"}))
        if path == "/api/chats/action":
            return self._json(api.chat_action(self._body()))
        # A terminal is a shell on this device. It is local-only on every
        # transport, regardless of whether a LAN client holds a valid token:
        # handing a remote client a shell is a different thing entirely from
        # letting them chat with the agent.
        if path.startswith("/api/term"):
            routes = {"/api/term/open": api.term_open,
                      "/api/term/write": api.term_write,
                      "/api/term/signal": api.term_signal,
                      "/api/term/resize": api.term_resize,
                      "/api/term/close": api.term_close}
            fn = routes.get(path)
            if fn:
                return self._json(fn(self._body()))
        return self._json({"error": f"no route {path}"}, 404)


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
