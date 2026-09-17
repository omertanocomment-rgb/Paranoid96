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
import threading

from . import (config, memory, router, sandbox, skills, plugins, mcp, sync,
               policy, terminal, modes, learn, chats, workspace,
               index as codeindex, scratch, theme, version)
from .agent import Agent

# One agent per project, shared across connections to that project so the
# conversation and its pending-approval state survive a reconnect.
_agents: dict[str, Agent] = {}
_agent_locks: dict[str, threading.Lock] = {}
_registry_lock = threading.Lock()


def get_agent(project: str) -> Agent:
    with _registry_lock:
        if project not in _agents:
            _agents[project] = Agent(project=project)
            _agent_locks[project] = threading.Lock()
        return _agents[project]


def _lock_for(project: str) -> threading.Lock:
    with _registry_lock:
        return _agent_locks.setdefault(project, threading.Lock())


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
def version_payload() -> dict:
    """Which build this actually is.

    Deliberately reachable on its own as well as inside /api/status: when you
    are asking "did the new build install?" you want one small answer, not a
    page of provider state to read it out of.
    """
    return version.info()


def status_payload() -> dict:
    return {
        "build": version.info(),
        "providers": router.provider_status(),
        "active": config.get("OMERTA_PROVIDER", config.ACTIVE_PROVIDER),
        "mode": config._norm_mode(config.get("OMERTA_MODE", config.MODE)),
        "always_ask": config.ALWAYS_ASK,
        "policy": policy.explain(),
        "work_mode": modes.explain(),
        "learned": learn.stats(),
        "chats": chats.stats(),
        "scratch": scratch.stats(),
        "workspace": workspace.stats(),
        "theme": theme.stats(),
        "terminal": {"shell": terminal._shell(),
                     "guard": terminal.guarded(),
                     "sessions": len(terminal.SESSIONS)},
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


def set_mode(payload: dict) -> dict:
    mode = config._norm_mode((payload or {}).get("mode", "auto"))
    config.set_setting("OMERTA_MODE", mode)
    return {"ok": True, "mode": mode}


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
    """Full chat entry point: pick the project's agent and dispatch one turn.

    Serialized per project: the server is multi-threaded, and an Agent mutates
    its own history and pending-approval state, so two overlapping requests for
    the same project must not interleave. Different projects run concurrently.
    """
    payload = payload or {}
    project = payload.get("project", "general")
    agent = get_agent(project)
    with _lock_for(project):
        return dispatch(agent, payload)


# ── approval policy ─────────────────────────────────────────────────────────
def policy_status() -> dict:
    return policy.explain()


def set_policy(payload: dict) -> dict:
    """Change how often OMERTA interrupts you.

    It cannot be loosened past HIGH_RISK: `core/policy` has no rank for that
    tier, so every policy still stops there, and DENY is refused regardless.
    """
    name = (payload or {}).get("policy", policy.ALWAYS)
    before = policy.current()
    after = policy.set_policy(name)
    sandbox.log_event({"kind": "policy_change", "from": before, "to": after})
    return {"ok": True, **policy.explain(after)}


# ── settings ────────────────────────────────────────────────────────────────
# Only these are writable over the API. Anything not on this list cannot be set
# remotely, so a compromised UI cannot, say, repoint the data directory or turn
# off auth.
WRITABLE_SETTINGS = {
    "OMERTA_APPROVAL_POLICY": ("Approval policy", "choice",
                               list(policy.POLICIES)),
    "OMERTA_MODE": ("Model mode", "choice", ["auto", "offline", "online"]),
    "OMERTA_PROVIDER": ("Preferred brain", "text", None),
    "OMERTA_THEME": ("UI theme", "choice", ["omerta", "black"]),
    "OMERTA_COMPACT": ("Compact prompt (low-RAM devices)", "bool", None),
    "OMERTA_HISTORY_LIMIT": ("Context window (messages kept)", "int", None),
    "OMERTA_STRICT_PROJECT": ("Recall only this project (hide shared)", "bool", None),
    "OMERTA_TERM_GUARD": ("Terminal refuses hard-deny commands", "bool", None),
    "OMERTA_TERM_SHELL": ("Terminal shell", "text", None),
    "OMERTA_TERM_CWD": ("Terminal start directory", "text", None),
    "OMERTA_TERM_FONT_SIZE": ("Terminal font size", "int", None),
    "OMERTA_AUTORUN_MCP": ("Let connectors run without asking", "bool", None),
    "OMERTA_ISOLATE": ("Sandbox commands (bubblewrap/firejail)", "bool", None),
    "OMERTA_ISOLATE_NET": ("Allow network inside the sandbox", "bool", None),
    "OMERTA_SYNC_DIR": ("Sync folder", "text", None),
    "OMERTA_SYNC_PEERS": ("Sync peers (host:port, comma separated)", "text", None),
    "OMERTA_SYNC_ON_START": ("Sync on startup", "bool", None),
    "OMERTA_KEEP_AWAKE": ("Keep the screen on while working", "bool", None),
    "OMERTA_HAPTICS": ("Vibrate when approval is needed", "bool", None),
}


def settings_payload() -> dict:
    out = {}
    for key, (label, kind, choices) in WRITABLE_SETTINGS.items():
        out[key] = {"label": label, "kind": kind, "choices": choices,
                    "value": config.get(key, "")}
    return {"settings": out, "policy": policy.explain(),
            "data_dir": str(config.DATA_DIR)}


def set_settings(payload: dict) -> dict:
    """Write one or more settings. Unknown keys are reported, not silently
    dropped — a typo that quietly does nothing is worse than an error."""
    payload = (payload or {}).get("settings", payload) or {}
    if not isinstance(payload, dict):
        return {"error": "expected an object of setting -> value", "_status": 400}
    written, rejected = {}, {}
    for key, value in payload.items():
        spec = WRITABLE_SETTINGS.get(key)
        if not spec:
            rejected[key] = "not a writable setting"
            continue
        _label, kind, choices = spec
        if kind == "choice" and choices and str(value) not in choices:
            rejected[key] = f"must be one of {choices}"
            continue
        if kind == "bool":
            value = "1" if config.truthy(value) else "0"
        if kind == "int":
            try:
                value = str(int(value))
            except (TypeError, ValueError):
                rejected[key] = "must be a whole number"
                continue
        config.set_setting(key, str(value))
        written[key] = str(value)
    if written:
        sandbox.log_event({"kind": "settings_change", "keys": sorted(written)})
    out = {"ok": not rejected, "written": written, "rejected": rejected}
    out.update(settings_payload())
    return out


# ── terminal ────────────────────────────────────────────────────────────────
# A thin pass-through: the logic, the guard and the audit trail all live in
# core/terminal, so every transport behaves identically.
def term_open(payload: dict) -> dict:
    return terminal.open_session(payload)


def term_read(payload: dict) -> dict:
    return terminal.read(payload)


def term_write(payload: dict) -> dict:
    return terminal.write(payload)


def term_signal(payload: dict) -> dict:
    return terminal.signal_session(payload)


def term_resize(payload: dict) -> dict:
    return terminal.resize(payload)


def term_close(payload: dict) -> dict:
    return terminal.close_session(payload)


def term_list(payload=None) -> dict:
    return terminal.list_sessions(payload)


# ── work modes ──────────────────────────────────────────────────────────────
def mode_status() -> dict:
    return modes.explain()


def set_work_mode(payload: dict) -> dict:
    before = modes.current()
    after = modes.set_mode((payload or {}).get("mode", modes.BUILD))
    sandbox.log_event({"kind": "work_mode_change", "from": before, "to": after})
    return {"ok": True, **modes.explain(after)}


# ── learning shelf ──────────────────────────────────────────────────────────
def learn_upload(payload: dict) -> dict:
    """Take a file in as base64, so one plain JSON POST covers every client."""
    import base64
    p = payload or {}
    name = p.get("name") or "document"
    raw = p.get("content_b64") or p.get("content")
    if raw is None:
        return {"error": "nothing to learn: send content_b64", "_status": 400}
    try:
        blob = base64.b64decode(raw) if p.get("content_b64") else str(raw).encode()
    except Exception as e:                         # noqa: BLE001
        return {"error": f"bad base64: {e}", "_status": 400}
    return learn.learn_bytes(name, blob, project=p.get("project", "general"),
                             note=p.get("note", ""))


def learn_add_path(payload: dict) -> dict:
    p = payload or {}
    target = p.get("path", "")
    import os
    if os.path.isdir(target):
        return learn.learn_dir(target, project=p.get("project", "general"),
                               note=p.get("note", ""))
    return learn.learn_path(target, project=p.get("project", "general"),
                            note=p.get("note", ""))


def learn_list(project=None) -> dict:
    return learn.documents(project=project)


def learn_read(doc_id: str) -> dict:
    return learn.read_document(doc_id)


def learn_forget(payload: dict) -> dict:
    p = payload or {}
    if p.get("doc"):
        return learn.forget_document(p["doc"])
    return learn.forget_behaviour(p)


def learned_behaviour(project=None) -> dict:
    return learn.learned_behaviour(project=project)


# ── chats / projects ────────────────────────────────────────────────────────
def chat_list(project=None, archived=False) -> dict:
    return chats.listing(project=project, include_archived=archived)


def chat_projects() -> dict:
    return chats.projects()


def chat_open(chat_id: str) -> dict:
    return chats.load(chat_id)


def chat_new(payload: dict) -> dict:
    p = payload or {}
    return chats.create(title=p.get("title"), project=p.get("project", "general"),
                        passcode=p.get("passcode"))


def chat_action(payload: dict) -> dict:
    """One endpoint for the chat verbs, so transports stay thin."""
    p = payload or {}
    cid, act = p.get("id"), p.get("action")
    verbs = {
        "branch": lambda: chats.branch(cid, at=p.get("at"), title=p.get("title")),
        "rename": lambda: chats.rename(cid, p.get("title", "")),
        "move": lambda: chats.move(cid, p.get("project", "general")),
        "archive": lambda: chats.archive(cid, p.get("archived", True)),
        "delete": lambda: chats.delete(cid),
        "unlock": lambda: chats.unlock(cid, p.get("passcode", "")),
        "lock": lambda: chats.lock(cid),
        "lock_all": lambda: chats.lock(None),
        "enqueue": lambda: chats.enqueue(cid, p.get("text", "")),
        "dequeue": lambda: chats.dequeue(cid),
        "queue": lambda: chats.queue_list(cid),
        "queue_clear": lambda: chats.queue_clear(cid, p.get("item")),
        "append": lambda: chats.append(cid, p.get("message") or {}),
        "new_project": lambda: chats.create_project(p.get("project", "")),
        "export": lambda: chats.export_chat(
            cid, include_branches=p.get("branches", True)),
        "import": lambda: chats.import_chats(p.get("bundle"),
                                             project=p.get("project")),
    }
    fn = verbs.get(act)
    if not fn:
        return {"error": f"unknown chat action {act!r}",
                "actions": sorted(verbs), "_status": 400}
    return fn()


# ── workspace / editor ──────────────────────────────────────────────────────
# Saves from the editor route through the SAME approval gate as everything
# else: propose_save returns awaiting_approval and writes nothing; only
# ws_commit writes, and the UI only calls it after you approve.
def ws_tree(payload=None) -> dict:
    return workspace.tree(payload)


def ws_read(payload=None) -> dict:
    return workspace.read(payload)


def ws_propose(payload=None) -> dict:
    return workspace.propose_save(payload)


def ws_commit(payload=None) -> dict:
    return workspace.commit_save(payload)


def ws_backups(payload=None) -> dict:
    return workspace.backups(payload)


def ws_backup_read(payload=None) -> dict:
    return workspace.read_backup(payload)


def ws_reindex(payload=None) -> dict:
    p = payload or {}
    root = p.get("root") or (workspace.roots() or ["."])[0]
    try:
        out = codeindex.build(root=root, save=True)
    except Exception as e:                         # noqa: BLE001
        return {"status": "error", "reason": str(e)}
    # index.build returns the file LIST and the symbol TABLE; a UI wants
    # counts, and shipping the whole index back would be ~80 KB of paths.
    def _n(v):
        return len(v) if isinstance(v, (list, dict)) else (v or 0)
    return {"status": "ok", "root": root,
            "files": _n(out.get("files")), "symbols": _n(out.get("symbols")),
            "languages": out.get("languages")}


def ws_search(payload=None) -> dict:
    p = payload or {}
    root = p.get("root") or (workspace.roots() or ["."])[0]
    q = p.get("q", "")
    if not q:
        return {"status": "error", "reason": "nothing to search for", "_status": 400}
    try:
        if p.get("symbol"):
            hit = codeindex.symbol(q, root=root)
            return {"status": "ok", "kind": "symbol", "root": root,
                    "results": hit.get("definitions", []), "count": hit.get("count", 0)}
        hit = codeindex.search(q, root=root)
        # symbol matches first: an exact definition beats a mention of the word
        results = list(hit.get("symbols", [])) + list(hit.get("files", []))
        return {"status": "ok", "kind": "search", "root": root,
                "results": results, "counts": hit.get("counts", {})}
    except Exception as e:                         # noqa: BLE001
        return {"status": "error", "reason": str(e)}


# ── scratch sandboxes ───────────────────────────────────────────────────────
# Build and run for real; the project tree only changes when you accept.
def scratch_list(payload=None) -> dict:
    return scratch.listing(payload)


def scratch_new(payload=None) -> dict:
    return scratch.create(payload)


def scratch_run(payload=None) -> dict:
    return scratch.run(payload)


def scratch_changes(payload=None) -> dict:
    return scratch.changes(payload)


def scratch_diff(payload=None) -> dict:
    return scratch.diff(payload)


def scratch_propose(payload=None) -> dict:
    return scratch.propose_accept(payload)


def scratch_accept(payload=None) -> dict:
    return scratch.accept(payload)


def scratch_discard(payload=None) -> dict:
    return scratch.discard(payload)


# ── themes ──────────────────────────────────────────────────────────────────
def theme_css(name=None) -> str:
    return theme.css(name)


def theme_list(payload=None) -> dict:
    return theme.listing()


def theme_use(payload=None) -> dict:
    return theme.use((payload or {}).get("name"))


def theme_save(payload=None) -> dict:
    return theme.save(payload)


def theme_delete(payload=None) -> dict:
    return theme.delete((payload or {}).get("name"))


def theme_image(payload=None) -> dict:
    return theme.put_image(payload)


def theme_clear_image(payload=None) -> dict:
    return theme.clear_image(payload)
