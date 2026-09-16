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


PUBLIC_PATHS = {"/favicon.ico", "/icon.svg"}

# Parity with the embedded stdlib server (`httpd.Handler.MAX_BODY`): a request
# body is bounded so one client cannot exhaust memory on the LAN server either.
MAX_BODY = 16 * 1024 * 1024


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    """Token check on every HTTP route. Accepts ?token=, X-Omerta-Token
    header, or the cookie set after a successful query-param handshake."""
    path = request.url.path
    if path in PUBLIC_PATHS or path.startswith("/assets"):
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
    if not auth.is_loopback(client):
        return JSONResponse({"error": "secrets can only be set locally"},
                            status_code=403)
    return _json(api.set_secret(payload))


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
