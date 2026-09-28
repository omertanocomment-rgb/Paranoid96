"""
One request layer, independent of how the request arrived.

The agent used to be reachable only over HTTP: even the phone talked to itself
through a loopback socket, because the UI is a web page and a web page fetches
URLs. That works, but it means the app depends on a server coming up, on a
port being free, and on nothing else on the device objecting -- and when any of
that failed the user got "backend didn't come up" with no way in.

So routing lives here instead, as plain functions over (method, path, query,
body). `core/httpd.py` calls it after doing the HTTP-specific work (auth
tokens, streaming bodies); the Android app calls it DIRECTLY through Chaquopy,
with no socket, no port and no server at all. Same routes, same approval gate,
same wire format, whichever way in.

What stays in the transport and is deliberately NOT here:
  * authentication -- a token only means something over a wire. An in-process
    call from the app's own WebView is the device operating itself.
  * streaming -- attachment upload and download move bytes without holding a
    file in memory, which each transport does its own way.

`local` is passed in rather than inferred. Over HTTP it means the peer address
is this machine and nothing was forwarded; in-process it is true by
construction. It gates the surfaces that are direct operation of the device
rather than the agent acting, which must never be drivable from elsewhere.
"""
from . import api

#: Surfaces that are DIRECT OPERATION of this device rather than the agent
#: acting: a shell, the editor's writes, a sandbox that executes commands, and
#: learning a file by absolute path. None of them route through the approval
#: gate, because you are the one driving them -- which is exactly why none of
#: them may be driven from another machine. /api/chat is not here: it goes
#: through the gate, so a token is enough for it.
LOCAL_ONLY = ("/api/term", "/api/ws/", "/api/scratch", "/api/learn/path",
              "/api/localai", "/api/attach",
              "/api/models", "/api/adb",
              "/api/backup")


def is_local_only(path):
    return any(path == p.rstrip("/") or path.startswith(p) for p in LOCAL_ONLY)


def _one(query, key, default=None):
    """First value of a query parameter, given parse_qs-shaped input."""
    vals = (query or {}).get(key)
    if not vals:
        return default
    return vals[0]


def _int(query, key, default):
    try:
        return int(_one(query, key, default))
    except (TypeError, ValueError):
        return default


# ── GET ─────────────────────────────────────────────────────────────────────
# Routes with no parameters at all: path -> api function.
_GET_PLAIN = {
    "/api/status": api.status_payload,
    "/api/version": api.version_payload,
    "/api/localai": api.localai_status,
    "/api/models": api.models_status,
    "/api/sync/status": api.sync_status,
    "/api/secret": api.secret_status,
    "/api/policy": api.policy_status,
    "/api/settings": api.settings_payload,
    "/api/workmode": api.mode_status,
    "/api/theme": api.theme_list,
    "/api/scratch": api.scratch_list,
    "/api/ws/backups": api.ws_backups,
    "/api/chats/projects": api.chat_projects,
    "/api/term": api.term_list,
}


def _get(path, query):
    if path in _GET_PLAIN:
        return 200, _GET_PLAIN[path]()
    if path == "/api/usage":
        return 200, api.usage_summary(days=_int(query, "days", 30),
                                      project=_one(query, "project"))
    if path == "/api/attach":
        return 200, api.attachments_payload(_one(query, "project"))
    if path == "/api/memory":
        return 200, api.memory_payload(_one(query, "q", "") or "",
                                       project=_one(query, "project"),
                                       k=_int(query, "k", 25))
    if path == "/api/history":
        return 200, api.history_payload(_int(query, "n", 50))
    if path == "/api/sync/pull":
        try:
            since = float(_one(query, "since", 0) or 0)
        except (TypeError, ValueError):
            since = 0.0
        return 200, api.sync_pull(since=since, project=_one(query, "project"))
    if path == "/api/learn":
        return 200, api.learn_list(_one(query, "project"))
    if path == "/api/learn/doc":
        return 200, api.learn_read(_one(query, "id", "") or "")
    if path == "/api/learn/behaviour":
        return 200, api.learned_behaviour(_one(query, "project"))
    if path == "/api/chats":
        return 200, api.chat_list(
            _one(query, "project"),
            archived=str(_one(query, "archived", "0")) in ("1", "true"))
    if path == "/api/chats/open":
        return 200, api.chat_open(_one(query, "id", "") or "")
    if path == "/api/chat/poll":
        # Streaming is a poll by offset, exactly like the terminal's, so it
        # works the same over HTTP, the app's in-process bridge, the desktop
        # pipe and the GTK scheme. None of those can hold an SSE stream open.
        return 200, api.chat_poll(_one(query, "id", "") or "",
                                  _int(query, "offset", 0))
    if path == "/api/term/read":
        return 200, api.term_read({"id": _one(query, "id", "") or "",
                                   "offset": _int(query, "offset", 0)})
    return 404, {"error": f"no route {path}"}


# ── POST ────────────────────────────────────────────────────────────────────
# Routes that take the request body and nothing else.
_POST_BODY = {
    "/api/chat": api.chat,
    "/api/chat/start": api.chat_start,
    "/api/chat/cancel": api.chat_cancel,
    "/api/model": api.set_model,
    "/api/mode": api.set_mode,
    "/api/sync/push": api.sync_push,
    "/api/sync/run": api.sync_run,
    "/api/localai": api.localai_control,
    "/api/models": api.models_control,
    "/api/adb": api.adb_control,
    "/api/backup": api.backup_control,
    "/api/usage": api.usage_control,
    "/api/attach/delete": api.attachment_delete,
    "/api/policy": api.set_policy,
    "/api/settings": api.set_settings,
    "/api/workmode": api.set_work_mode,
    "/api/learn/upload": api.learn_upload,
    "/api/learn/path": api.learn_add_path,
    "/api/learn/forget": api.learn_forget,
    "/api/chats/new": api.chat_new,
    "/api/ws/tree": api.ws_tree,
    "/api/ws/read": api.ws_read,
    "/api/ws/propose": api.ws_propose,
    "/api/ws/commit": api.ws_commit,
    "/api/ws/backup": api.ws_backup_read,
    "/api/ws/reindex": api.ws_reindex,
    "/api/ws/search": api.ws_search,
    "/api/chats/action": api.chat_action,
    "/api/term/open": api.term_open,
    "/api/term/write": api.term_write,
    "/api/term/signal": api.term_signal,
    "/api/term/resize": api.term_resize,
    "/api/term/close": api.term_close,
}

_THEME_VERBS = {"use": api.theme_use, "save": api.theme_save,
                "delete": api.theme_delete, "image": api.theme_image,
                "clear": api.theme_clear_image}

_SCRATCH_VERBS = {"new": api.scratch_new, "run": api.scratch_run,
                  "changes": api.scratch_changes, "diff": api.scratch_diff,
                  "propose": api.scratch_propose, "accept": api.scratch_accept,
                  "discard": api.scratch_discard}


def _post(path, body, local):
    body = body or {}
    if path == "/api/secret":
        # Writing a secret is only ever allowed from the local device, on top
        # of core.api's own ALLOW_SECRET_API gate.
        if not local:
            return 403, {"error": "secrets can only be set locally"}
        return 200, api.set_secret(body)
    if path in _POST_BODY:
        return 200, _POST_BODY[path](body)
    if path == "/api/plugins/reload":
        return 200, api.reload_plugins()
    if path == "/api/connectors/reconnect":
        return 200, api.reconnect()
    if path == "/api/chats/export":
        return 200, api.chat_action({**body, "action": "export"})
    if path == "/api/chats/import":
        return 200, api.chat_action({**body, "action": "import"})
    if path.startswith("/api/theme/"):
        fn = _THEME_VERBS.get(path[len("/api/theme/"):])
        if fn:
            return 200, fn(body)
    if path.startswith("/api/scratch/"):
        fn = _SCRATCH_VERBS.get(path[len("/api/scratch/"):])
        if fn:
            return 200, fn(body)
    return 404, {"error": f"no route {path}"}


def handle(method, path, query=None, body=None, local=True):
    """Route one request.

    Returns (status, payload). `payload` is always a JSON-able object, so a
    caller can hand it to json.dumps and be done. Authentication is the
    transport's business and has already happened by the time this is called.
    """
    method = (method or "GET").upper()
    path = path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")

    if is_local_only(path) and not local:
        return 403, {"error": f"{path} is local-only"}

    if method == "GET":
        return _get(path, query or {})
    if method == "POST":
        return _post(path, body, local)
    return 405, {"error": f"{method} not allowed"}
