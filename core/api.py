"""
Shared application logic for every front-end.

The FastAPI server (`server.py`), the pure-stdlib embedded server
(`core/httpd.py`, used inside the Android app), and any future transport all
call the functions here. Keeping the logic in one place means there is exactly
ONE approval gate, ONE status view and ONE websocket protocol — a front-end
cannot accidentally diverge from the safety contract enforced in
`core/agent.py`.

Nothing here is transport-specific: every function takes plain Python values
and returns plain dicts, so it works behind ASGI, behind `http.server`, or
from a test harness with no server at all.
"""
from . import (config, memory, router, sandbox, skills, plugins, mcp, sync)
from .agent import Agent

# One agent per project, shared across connections to that project so the
# conversation and its pending-approval state survive a websocket reconnect.
_agents: dict[str, Agent] = {}


def get_agent(project: str) -> Agent:
    if project not in _agents:
        _agents[project] = Agent(project=project)
    return _agents[project]


def boot():
    """Initialise subsystems once at process start. Idempotent."""
    memory.init()
    plugins.load_all()


def startup_sync():
    """Optional start-of-run sync, mirrors server.py's startup hook."""
    lines = []
    if config.SYNC_ON_START:
        if config.SYNC_DIR:
            lines.append(("sync", sync.sync_file(config.SYNC_DIR).get("status")))
        for peer in [p.strip() for p in str(config.SYNC_PEERS).split(",") if p.strip()]:
            lines.append((f"sync {peer}", sync.sync_peer(peer).get("status")))
    return lines


# ── read views ────────────────────────────────────────────────────────────
def status_payload() -> dict:
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


def memory_payload(q="", project=None, k=25) -> dict:
    return {"results": memory.recall(q, project=project, top_k=k),
            "preferences": memory.preference_block(project=project)}


def history_payload(n=50) -> dict:
    return {"history": sandbox.history(n)}


# ── mutations ───────────────────────────────────────────────────────────────
def set_model(payload: dict) -> dict:
    pid = (payload or {}).get("provider", "auto")
    if pid != "auto" and pid not in config.PROVIDERS:
        return {"error": "unknown provider", "_status": 400}
    config.set_setting("OMERTA_PROVIDER", pid)
    return {"ok": True, "provider": pid}


def reload_plugins() -> dict:
    plugins.load_all()
    return {"ok": True, "plugins": list(plugins.loaded())}


def reconnect() -> dict:
    mcp.disconnect_all()
    return {"results": mcp.connect_all()}


# ── secrets (API keys / local hosts) ────────────────────────────────────────
def secret_status() -> dict:
    """Which secrets are configured — booleans only, never the values."""
    import os
    return {"allowed": sorted(config.ALLOWED_SECRET_KEYS),
            "set": {k: bool(os.environ.get(k)) for k in config.ALLOWED_SECRET_KEYS},
            "enabled": config.ALLOW_SECRET_API}


def set_secret(payload: dict) -> dict:
    if not config.ALLOW_SECRET_API:
        return {"error": "secret API disabled on this server", "_status": 403}
    payload = payload or {}
    key = payload.get("key")
    if key not in config.ALLOWED_SECRET_KEYS:
        return {"error": f"'{key}' is not a writable secret", "_status": 400}
    try:
        config.put_secret(key, payload.get("value", ""))
    except ValueError as e:
        return {"error": str(e), "_status": 400}
    return {"ok": True, "key": key, "set": bool(payload.get("value"))}


# ── sync ────────────────────────────────────────────────────────────────────
def sync_pull(since=0.0, project=None) -> dict:
    return sync.export_bundle(since=since, project=project)


def sync_push(bundle: dict) -> dict:
    return sync.merge_bundle(bundle)


def sync_status() -> dict:
    return sync.status()


def sync_run(payload: dict) -> dict:
    payload = payload or {}
    if payload.get("peer"):
        return sync.sync_peer(payload["peer"], token=payload.get("token"),
                              full=payload.get("full", False))
    target = payload.get("dir") or config.SYNC_DIR
    if not target:
        return {"error": "no peer or dir given, and OMERTA_SYNC_DIR unset",
                "_status": 400}
    return sync.sync_file(target, full=payload.get("full", False))


# ── chat protocol (plain request/response) ──────────────────────────────────
def dispatch(agent: Agent, msg: dict) -> dict:
    """Turn one inbound chat message into an agent action + result.

    Plain request/response — one POST in, one JSON reply out, no streaming and
    no socket. Each turn already returns the agent's full result (including any
    pending approval), so nothing is lost by not streaming. This is the single
    implementation of the chat protocol; every side effect the agent proposes
    still suspends for approval inside `agent`. This only routes the user's
    intent (send / approve / deny / edit / reset).
    """
    kind = (msg or {}).get("kind", "message")
    if kind == "message":
        return agent.turn(msg.get("text", ""))
    if kind == "approve":
        return agent.approve()
    if kind == "deny":
        return agent.deny(note=msg.get("note", ""))
    if kind == "edit":
        return agent.edit_and_approve(msg.get("cmd", ""))
    if kind == "reset":
        agent.reset()
        return {"text": "Conversation cleared. Memory kept.",
                "pending": None, "tool_log": []}
    return {"text": f"unknown action '{kind}'", "pending": None, "tool_log": []}


def chat(payload: dict) -> dict:
    """Full chat entry point: pick the project's agent and dispatch one turn."""
    payload = payload or {}
    agent = get_agent(payload.get("project", "general"))
    return dispatch(agent, payload)
