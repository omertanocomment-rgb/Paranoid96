#!/usr/bin/env python3
"""
OMERTA AGENT — HTTP server (FastAPI/uvicorn).

Same agent as the CLI; reachable from phone, desktop, or the Electron shell.
All request logic lives in `core/api.py` so this file and the pure-stdlib
embedded server (`core/httpd.py`) stay in lock-step — one approval gate, one
protocol. Use this server on Linux/macOS/Windows/Termux; the embedded app
uses httpd.py because FastAPI's dependency chain (pydantic-core) has no
Android wheel.
"""
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from core import config, auth, mcp, api

app = FastAPI(title="OMERTA AGENT")
api.boot()


def _json(payload: dict):
    """Honor an optional `_status` hint from a core.api result."""
    if isinstance(payload, dict) and "_status" in payload:
        payload = dict(payload)
        code = payload.pop("_status")
        return JSONResponse(payload, status_code=code)
    return JSONResponse(payload)


# The stylesheet and theme images are public like the favicon: a page whose
# CSS 401s is an unreadable page, and none of it is secret.
PUBLIC_PATHS = {"/favicon.ico", "/icon.svg", "/theme.css"}

# Parity with the embedded stdlib server (`httpd.Handler.MAX_BODY`): a request
# body is bounded so one client cannot exhaust memory on the LAN server either.
MAX_BODY = 16 * 1024 * 1024


# Direct-operation surfaces: a shell, the editor's writes, a sandbox that runs
# commands, learning a file by absolute path. None go through the approval gate
# because you drive them yourself — which is why none may be driven remotely.
# /api/chat is deliberately absent: it DOES go through the gate.
LOCAL_ONLY_PREFIXES = ("/api/term", "/api/ws/", "/api/scratch",
                       "/api/learn/path", "/api/localai", "/api/attach",
                       "/api/models")


def _is_local_only(path: str) -> bool:
    return any(path == p.rstrip("/") or path.startswith(p)
               for p in LOCAL_ONLY_PREFIXES)


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    """Token check on every HTTP route. Accepts ?token=, X-Omerta-Token
    header, or the cookie set after a successful query-param handshake."""
    path = request.url.path
    if (path in PUBLIC_PATHS or path.startswith("/assets")
            or path.startswith("/theme/asset/")):
        return await call_next(request)
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        return JSONResponse({"error": "bad content-length"}, status_code=400)
    if declared > MAX_BODY:
        return JSONResponse({"error": f"body too large (max {MAX_BODY} bytes)"},
                            status_code=413)
    client = request.client.host if request.client else ""
    spoofable = any(h in request.headers for h in
                    ("x-forwarded-for", "x-real-ip", "forwarded"))
    tok = (request.query_params.get("token")
           or request.headers.get("x-omerta-token")
           or request.cookies.get(auth.COOKIE))
    if not auth.check(tok, client, spoofable=spoofable):
        return JSONResponse(
            {"error": "unauthorized",
             "hint": "append ?token=... (printed in the server console)"},
            status_code=401)
    if _is_local_only(path) and not auth.is_local_request(client, spoofable):
        return JSONResponse({"error": f"{path} is local-only"}, status_code=403)
    resp = await call_next(request)
    if request.query_params.get("token"):
        resp.set_cookie(auth.COOKIE, request.query_params["token"],
                        httponly=True, samesite="lax", max_age=60 * 60 * 24 * 365)
    return resp


@app.on_event("startup")
def _startup():
    mcp.connect_all()
    for label, result in api.startup_sync():
        print(f"[{label}]", result)


@app.get("/", response_class=HTMLResponse)
def index():
    return (config.WEBUI_DIR / "index.html").read_text()


@app.get("/favicon.ico")
def favicon():
    return FileResponse(config.ASSETS_DIR / "favicon.ico")


@app.get("/icon.svg")
def icon():
    return FileResponse(config.ASSETS_DIR / "icon.svg", media_type="image/svg+xml")


@app.get("/api/status")
def status():
    return api.status_payload()


@app.get("/api/version")
def version():
    return api.version_payload()


@app.get("/api/models")
def models_status():
    return api.models_status()


@app.post("/api/models")
def models_control(payload: dict):
    return api.models_control(payload)


@app.get("/api/attach")
def attachments(project: str = None):
    return api.attachments_payload(project)


@app.get("/api/attach/{aid}")
def attachment_get(aid: str):
    """Always an opaque download, never rendered.

    There is no restriction on what may be uploaded. This is only a refusal to
    execute a stored .html or .svg as script inside the app's own origin.
    """
    from fastapi.responses import FileResponse
    from core import attach as _a
    p = _a.path_for(aid)
    if p is None:
        return JSONResponse({"error": "no such attachment"}, status_code=404)
    rec = _a.get(aid) or {}
    return FileResponse(str(p), media_type="application/octet-stream",
                        filename=rec.get("name", "attachment"),
                        headers={"X-Content-Type-Options": "nosniff"})


@app.post("/api/attach")
async def attachment_put(request: Request):
    """Stream the raw body to disk. No size cap, no type check.

    Not using a parsed body on purpose: that would buffer the whole upload in
    memory, which for a multi-gigabyte file takes the process down.
    """
    from core import attach as _a
    name = (request.headers.get("x-omerta-filename")
            or request.query_params.get("name") or "attachment")
    project = (request.headers.get("x-omerta-project")
               or request.query_params.get("project") or "")
    note = request.headers.get("x-omerta-note", "")
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0

    inc = _a.Incoming(name, project=project, note=note)
    if inc.error:
        return {"error": inc.error}
    try:
        async for chunk in request.stream():
            inc.write(chunk)
            if inc.error:
                break
    except Exception as e:  # noqa: BLE001 — a dropped connection is not a crash
        inc.abort()
        return {"error": f"upload interrupted after {inc.written} bytes: {e}"}
    return inc.finish(declared or None)


@app.post("/api/attach/delete")
def attachment_delete(payload: dict):
    return api.attachment_delete(payload)


@app.get("/api/localai")
def localai_status():
    return api.localai_status()


@app.post("/api/localai")
def localai_control(payload: dict):
    return api.localai_control(payload)


@app.post("/api/chat")
def chat(payload: dict):
    """One chat turn: {project, kind, text|cmd|note} -> full agent result."""
    return api.chat(payload)


@app.post("/api/model")
def set_model(payload: dict):
    return _json(api.set_model(payload))


@app.post("/api/mode")
def set_mode(payload: dict):
    return api.set_mode(payload)


@app.get("/api/memory")
def get_memory(q: str = "", project: str = None, k: int = 25):
    return api.memory_payload(q, project=project, k=k)


@app.get("/api/history")
def get_history(n: int = 50):
    return api.history_payload(n)


@app.get("/api/sync/pull")
def sync_pull(since: float = 0, project: str = None):
    return api.sync_pull(since=since, project=project)


@app.post("/api/sync/push")
async def sync_push(request: Request):
    return api.sync_push(await request.json())


@app.get("/api/sync/status")
def sync_status():
    return api.sync_status()


@app.post("/api/sync/run")
def sync_run(payload: dict):
    return _json(api.sync_run(payload))


@app.post("/api/plugins/reload")
def reload_plugins():
    return api.reload_plugins()


@app.post("/api/connectors/reconnect")
def reconnect():
    return api.reconnect()


@app.get("/api/secret")
def secret_status():
    return api.secret_status()


@app.post("/api/secret")
def set_secret(payload: dict, request: Request):
    # defense in depth: a secret can only be written from the local device,
    # on top of core.api's ALLOW_SECRET_API flag.
    client = request.client.host if request.client else ""
    if not auth.is_local_request(client, auth.forwarded(request.headers)):
        return JSONResponse({"error": "secrets can only be set locally"},
                            status_code=403)
    return _json(api.set_secret(payload))


@app.get("/api/policy")
def policy_status():
    return api.policy_status()


@app.post("/api/policy")
def set_policy(payload: dict):
    return _json(api.set_policy(payload))


@app.get("/api/settings")
def settings_status():
    return api.settings_payload()


@app.post("/api/settings")
def set_settings(payload: dict):
    return _json(api.set_settings(payload))


@app.get("/api/workmode")
def work_mode():
    return api.mode_status()


@app.post("/api/workmode")
def set_work_mode(payload: dict):
    return _json(api.set_work_mode(payload))


@app.get("/api/learn")
def learn_list(project: str = None):
    return api.learn_list(project)


@app.get("/api/learn/doc")
def learn_doc(id: str = ""):
    return _json(api.learn_read(id))


@app.get("/api/learn/behaviour")
def learn_behaviour(project: str = None):
    return api.learned_behaviour(project)


@app.post("/api/learn/upload")
def learn_upload(payload: dict):
    return _json(api.learn_upload(payload))


@app.post("/api/learn/path")
def learn_path(payload: dict):
    return _json(api.learn_add_path(payload))


@app.post("/api/learn/forget")
def learn_forget(payload: dict):
    return _json(api.learn_forget(payload))


@app.get("/api/chats")
def chats_list(project: str = None, archived: bool = False):
    return api.chat_list(project, archived=archived)


@app.get("/api/chats/projects")
def chats_projects():
    return api.chat_projects()


@app.get("/api/chats/open")
def chats_open(id: str = ""):
    return _json(api.chat_open(id))


@app.post("/api/chats/new")
def chats_new(payload: dict):
    return _json(api.chat_new(payload))


@app.get("/theme.css")
def theme_css():
    from fastapi.responses import Response
    return Response(api.theme_css(), media_type="text/css")


@app.get("/theme/asset/{name}")
def theme_asset(name: str):
    from core import theme as _t
    p = _t.image_path(name)
    if not p:
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(p)


@app.get("/api/theme")
def theme_list():
    return api.theme_list()


@app.post("/api/theme/use")
def theme_use(payload: dict):
    return _json(api.theme_use(payload))


@app.post("/api/theme/save")
def theme_save(payload: dict):
    return _json(api.theme_save(payload))


@app.post("/api/theme/delete")
def theme_delete(payload: dict):
    return _json(api.theme_delete(payload))


@app.post("/api/theme/image")
def theme_image(payload: dict):
    return _json(api.theme_image(payload))


@app.post("/api/theme/clear")
def theme_clear(payload: dict):
    return _json(api.theme_clear_image(payload))


@app.get("/api/scratch")
def scratch_list():
    return api.scratch_list()


@app.post("/api/scratch/new")
def scratch_new(payload: dict):
    return _json(api.scratch_new(payload))


@app.post("/api/scratch/run")
def scratch_run(payload: dict):
    return _json(api.scratch_run(payload))


@app.post("/api/scratch/changes")
def scratch_changes(payload: dict):
    return _json(api.scratch_changes(payload))


@app.post("/api/scratch/diff")
def scratch_diff(payload: dict):
    return _json(api.scratch_diff(payload))


@app.post("/api/scratch/propose")
def scratch_propose(payload: dict):
    return _json(api.scratch_propose(payload))


@app.post("/api/scratch/accept")
def scratch_accept(payload: dict):
    return _json(api.scratch_accept(payload))


@app.post("/api/scratch/discard")
def scratch_discard(payload: dict):
    return _json(api.scratch_discard(payload))


@app.get("/api/ws/backups")
def ws_backups():
    return api.ws_backups()


@app.post("/api/ws/tree")
def ws_tree(payload: dict):
    return _json(api.ws_tree(payload))


@app.post("/api/ws/read")
def ws_read(payload: dict):
    return _json(api.ws_read(payload))


@app.post("/api/ws/propose")
def ws_propose(payload: dict):
    return _json(api.ws_propose(payload))


@app.post("/api/ws/commit")
def ws_commit(payload: dict):
    return _json(api.ws_commit(payload))


@app.post("/api/ws/backup")
def ws_backup(payload: dict):
    return _json(api.ws_backup_read(payload))


@app.post("/api/ws/reindex")
def ws_reindex(payload: dict):
    return _json(api.ws_reindex(payload))


@app.post("/api/ws/search")
def ws_search(payload: dict):
    return _json(api.ws_search(payload))


@app.post("/api/chats/export")
def chats_export(payload: dict):
    return _json(api.chat_action({**(payload or {}), "action": "export"}))


@app.post("/api/chats/import")
def chats_import(payload: dict):
    return _json(api.chat_action({**(payload or {}), "action": "import"}))


@app.post("/api/chats/action")
def chats_action(payload: dict):
    return _json(api.chat_action(payload))


# ── terminal ────────────────────────────────────────────────────────────────
# A terminal is a shell on this machine. Chatting with the agent over the LAN
# is one thing; handing a remote client a shell is another, so every terminal
# route is local-only on top of the token check — the same rule the embedded
# server applies.
def _local_only(request: Request):
    client = request.client.host if request.client else ""
    if not auth.is_local_request(client, auth.forwarded(request.headers)):
        return JSONResponse({"error": "the terminal is local-only"},
                            status_code=403)
    return None


@app.get("/api/term")
def term_list(request: Request):
    return _local_only(request) or api.term_list()


@app.get("/api/term/read")
def term_read(request: Request, id: str = "", offset: int = 0):
    return _local_only(request) or _json(api.term_read({"id": id, "offset": offset}))


@app.post("/api/term/open")
def term_open(payload: dict, request: Request):
    return _local_only(request) or _json(api.term_open(payload))


@app.post("/api/term/write")
def term_write(payload: dict, request: Request):
    return _local_only(request) or _json(api.term_write(payload))


@app.post("/api/term/signal")
def term_signal(payload: dict, request: Request):
    return _local_only(request) or _json(api.term_signal(payload))


@app.post("/api/term/resize")
def term_resize(payload: dict, request: Request):
    return _local_only(request) or _json(api.term_resize(payload))


@app.post("/api/term/close")
def term_close(payload: dict, request: Request):
    return _local_only(request) or _json(api.term_close(payload))


if config.ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(config.ASSETS_DIR)), name="assets")


def run():
    import uvicorn
    print("\n  OMERTA AGENT")
    if auth.enabled():
        print("  open one of these (token required from other devices):")
        for u in auth.lan_urls(config.SERVER_PORT):
            print(f"    {u}")
        print(f"\n  token: {auth.get_token()}")
        print("  loopback is exempt, so the desktop app and CLI just work.")
    else:
        print("  !! AUTH DISABLED (OMERTA_NO_AUTH=1) — anyone on this network")
        print("     can approve and run commands on this machine.")
        print(f"    http://{config.SERVER_HOST}:{config.SERVER_PORT}")
    print()
    # proxy_headers=False is a security requirement, not a preference:
    # with it on, uvicorn rewrites the client IP from X-Forwarded-For, so
    # anyone on the LAN could send "X-Forwarded-For: 127.0.0.1", be treated
    # as loopback, and skip the token entirely.
    uvicorn.run(app, host=config.SERVER_HOST, port=config.SERVER_PORT,
                proxy_headers=False, forwarded_allow_ips=[])


if __name__ == "__main__":
    run()
