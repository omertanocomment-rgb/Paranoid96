#!/usr/bin/env python3
"""
OMERTA AGENT — HTTP/WebSocket server.
Same agent as the CLI; reachable from phone, desktop, or the Electron shell.
"""
import json
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from core.agent import Agent
from core import config, memory, router, sandbox, skills, plugins, mcp, auth, sync

app = FastAPI(title="OMERTA AGENT")
HERE = Path(__file__).parent
memory.init()
plugins.load_all()
_agents: dict[str, Agent] = {}


def get_agent(project):
    if project not in _agents:
        _agents[project] = Agent(project=project)
    return _agents[project]


PUBLIC_PATHS = {"/favicon.ico", "/icon.svg"}


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    """Token check on every HTTP route. Accepts ?token=, X-Omerta-Token
    header, or the cookie set after a successful query-param handshake."""
    path = request.url.path
    if path in PUBLIC_PATHS or path.startswith("/assets"):
        return await call_next(request)
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
    if config.SYNC_ON_START:
        if config.SYNC_DIR:
            print("[sync]", sync.sync_file(config.SYNC_DIR).get("status"))
        for peer in [p.strip() for p in str(config.SYNC_PEERS).split(",") if p.strip()]:
            print(f"[sync] {peer}:", sync.sync_peer(peer).get("status"))


@app.get("/", response_class=HTMLResponse)
def index():
    return (HERE / "webui" / "index.html").read_text()


@app.get("/favicon.ico")
def favicon():
    return FileResponse(HERE / "assets" / "favicon.ico")


@app.get("/icon.svg")
def icon():
    return FileResponse(HERE / "assets" / "icon.svg", media_type="image/svg+xml")


@app.get("/api/status")
def status():
    return {
        "providers": router.provider_status(),
        "active": config.get("OMERTA_PROVIDER", config.ACTIVE_PROVIDER),
        "always_ask": config.ALWAYS_ASK,
        "memory": memory.stats(),
        "skills": [{"name": s["name"], "description": s["description"]}
                   for s in skills.load_all()],
        "plugins": {n: {"description": d["manifest"].get("description", ""),
                        "tools": d["tools"], "failed": "error" in d}
                    for n, d in plugins.loaded().items()},
        "connectors": mcp.status(),
    }


@app.post("/api/model")
def set_model(payload: dict):
    pid = payload.get("provider", "auto")
    if pid != "auto" and pid not in config.PROVIDERS:
        return JSONResponse({"error": "unknown provider"}, status_code=400)
    config.set_setting("OMERTA_PROVIDER", pid)
    return {"ok": True, "provider": pid}


@app.get("/api/memory")
def get_memory(q: str = "", project: str = None, k: int = 25):
    return {"results": memory.recall(q, project=project, top_k=k),
            "preferences": memory.preference_block(project=project)}


@app.get("/api/history")
def get_history(n: int = 50):
    return {"history": sandbox.history(n)}


@app.get("/api/sync/pull")
def sync_pull(since: float = 0, project: str = None):
    """A peer asks for everything we've learned since `since`."""
    return sync.export_bundle(since=since, project=project)


@app.post("/api/sync/push")
async def sync_push(request: Request):
    """A peer sends us what it learned. Merged idempotently."""
    return sync.merge_bundle(await request.json())


@app.get("/api/sync/status")
def sync_status():
    return sync.status()


@app.post("/api/sync/run")
def sync_run(payload: dict):
    """Trigger a sync from the UI. {"peer": "host:port"} or {"dir": "/path"}"""
    if payload.get("peer"):
        return sync.sync_peer(payload["peer"], token=payload.get("token"),
                              full=payload.get("full", False))
    target = payload.get("dir") or config.SYNC_DIR
    if not target:
        return JSONResponse({"error": "no peer or dir given, and OMERTA_SYNC_DIR unset"},
                            status_code=400)
    return sync.sync_file(target, full=payload.get("full", False))


@app.post("/api/plugins/reload")
def reload_plugins():
    plugins.load_all()
    return {"ok": True, "plugins": list(plugins.loaded())}


@app.post("/api/connectors/reconnect")
def reconnect():
    mcp.disconnect_all()
    return {"results": mcp.connect_all()}


@app.websocket("/ws/{project}")
async def ws(websocket: WebSocket, project: str):
    client = websocket.client.host if websocket.client else ""
    spoofable = any(h in websocket.headers for h in
                    ("x-forwarded-for", "x-real-ip", "forwarded"))
    tok = (websocket.query_params.get("token")
           or websocket.cookies.get(auth.COOKIE))
    if not auth.check(tok, client, spoofable=spoofable):
        await websocket.close(code=4401, reason="unauthorized")
        return
    await websocket.accept()
    agent = get_agent(project)
    try:
        while True:
            msg = json.loads(await websocket.receive_text())
            kind = msg.get("kind", "message")
            if kind == "message":
                res = agent.turn(msg["text"])
            elif kind == "approve":
                res = agent.approve()
            elif kind == "deny":
                res = agent.deny(note=msg.get("note", ""))
            elif kind == "edit":
                res = agent.edit_and_approve(msg["cmd"])
            elif kind == "reset":
                agent.reset(); res = {"text": "Conversation cleared. Memory kept.",
                                      "pending": None, "tool_log": []}
            else:
                res = {"text": f"unknown action '{kind}'", "pending": None, "tool_log": []}
            await websocket.send_text(json.dumps(res, default=str))
    except WebSocketDisconnect:
        pass


if (HERE / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(HERE / "assets")), name="assets")

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
