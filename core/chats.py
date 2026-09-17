"""
Chats, projects, branches, queues — and the locked ones.

A conversation is not a scrollback buffer, it is a thing you come back to. So:

  * **Recent chats** persist across restarts, grouped under **projects**.
  * **Branch** forks a chat at any message. You keep the original and get a new
    chat seeded with everything up to that point, so you can try the other
    approach without losing the thread you already have.
  * **Queue** lets you line up messages while the agent is busy. They run in
    order, one at a time — useful when you already know the next three things
    you want and do not want to babysit each one.
  * **Archive** hides a chat without destroying it. Deleting is separate and
    explicit.
  * **Private chats** are locked behind a passcode and *encrypted at rest*, not
    merely hidden behind a boolean. A flag in a JSON file stops nobody who has
    the file.

On the crypto, plainly: this uses PBKDF2-HMAC-SHA256 (a high iteration count)
to derive a key, and encrypts with AES-GCM when `cryptography` is available,
falling back to HMAC-SHA256 keystream + a separate HMAC tag when it is not, so
the phone build works with no native dependency. Both give confidentiality and
tamper-detection at rest. Neither protects a running, unlocked session, and
nothing here defends against someone who already controls the device. If you
forget the passcode the content is gone — there is no recovery, which is the
point of a passcode.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import uuid

from . import config

CHATS_DIR = config.DATA_DIR / "chats"
INDEX_FILE = CHATS_DIR / "index.json"
KDF_ROUNDS = int(config.get("OMERTA_CHAT_KDF_ROUNDS", 200_000))

# unlocked chat id -> derived key, for this process only. Never persisted.
_unlocked = {}


def _ensure():
    CHATS_DIR.mkdir(parents=True, exist_ok=True)


def _index():
    _ensure()
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text())
        except (OSError, ValueError):
            pass
    return {"chats": {}, "projects": {"general": {"name": "general",
                                                  "created": time.time()}}}


def _save(idx):
    _ensure()
    tmp = INDEX_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(idx, indent=2))
    os.replace(tmp, INDEX_FILE)


def _path(chat_id):
    return CHATS_DIR / f"{chat_id}.json"


# ── encryption for private chats ────────────────────────────────────────────
def _derive(passcode, salt):
    return hashlib.pbkdf2_hmac("sha256", str(passcode).encode(), salt, KDF_ROUNDS, 32)


_AESGCM_PROBE = []          # cached: importing this is not always cheap or safe


def _aesgcm():
    """AES-GCM if this machine really has it, else None.

    Caught as BaseException on purpose. A broken `cryptography` install does
    not raise ImportError — its Rust bindings raise pyo3's PanicException,
    which inherits from BaseException, so `except Exception` sails straight
    past it and takes the process down. The whole point of having a fallback
    is that this path must never be able to fail.
    """
    if _AESGCM_PROBE:
        return _AESGCM_PROBE[0]
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        AESGCM(secrets.token_bytes(32)).encrypt(secrets.token_bytes(12), b"x", None)
        _AESGCM_PROBE.append(AESGCM)
    except BaseException:                          # noqa: BLE001
        _AESGCM_PROBE.append(None)
    return _AESGCM_PROBE[0]


def _encrypt(key, plaintext):
    """AES-GCM where available; an HMAC keystream + tag where it is not."""
    nonce = secrets.token_bytes(12)
    AESGCM = _aesgcm()
    if AESGCM:
        return {"alg": "AESGCM", "nonce": base64.b64encode(nonce).decode(),
                "ct": base64.b64encode(
                    AESGCM(key).encrypt(nonce, plaintext, None)).decode()}
    stream = b""
    counter = 0
    while len(stream) < len(plaintext):
        stream += hmac.new(key, nonce + counter.to_bytes(4, "big"),
                           hashlib.sha256).digest()
        counter += 1
    ct = bytes(a ^ b for a, b in zip(plaintext, stream))
    tag = hmac.new(key, nonce + ct, hashlib.sha256).digest()
    return {"alg": "HMAC-CTR", "nonce": base64.b64encode(nonce).decode(),
            "ct": base64.b64encode(ct).decode(),
            "tag": base64.b64encode(tag).decode()}


def _decrypt(key, blob):
    nonce = base64.b64decode(blob["nonce"])
    ct = base64.b64decode(blob["ct"])
    if blob.get("alg") == "AESGCM":
        AESGCM = _aesgcm()
        if not AESGCM:
            raise ValueError("this chat was encrypted with AES-GCM, which is "
                             "unavailable here — open it on a build that has it")
        try:
            return AESGCM(key).decrypt(nonce, ct, None)
        except Exception as e:                     # noqa: BLE001
            raise ValueError("wrong passcode, or the chat has been "
                             "tampered with") from e
    expect = base64.b64decode(blob["tag"])
    actual = hmac.new(key, nonce + ct, hashlib.sha256).digest()
    if not hmac.compare_digest(expect, actual):
        raise ValueError("wrong passcode, or the chat has been tampered with")
    stream = b""
    counter = 0
    while len(stream) < len(ct):
        stream += hmac.new(key, nonce + counter.to_bytes(4, "big"),
                           hashlib.sha256).digest()
        counter += 1
    return bytes(a ^ b for a, b in zip(ct, stream))


# ── chat storage ────────────────────────────────────────────────────────────
def _write_body(chat_id, body, key=None):
    data = json.dumps(body).encode()
    if key:
        payload = {"private": True, **_encrypt(key, data)}
    else:
        payload = {"private": False, "body": body}
    tmp = _path(chat_id).with_suffix(".tmp")
    tmp.write_text(json.dumps(payload))
    os.replace(tmp, _path(chat_id))


def _read_body(chat_id, key=None):
    try:
        payload = json.loads(_path(chat_id).read_text())
    except (OSError, ValueError):
        return None
    if not payload.get("private"):
        return payload.get("body")
    if not key:
        raise PermissionError("this chat is locked")
    return json.loads(_decrypt(key, payload))


def create(title=None, project="general", parent=None, messages=None,
           passcode=None):
    idx = _index()
    cid = uuid.uuid4().hex[:12]
    now = time.time()
    key = salt = None
    if passcode:
        salt = secrets.token_bytes(16)
        key = _derive(passcode, salt)
        _unlocked[cid] = key
    body = {"messages": list(messages or [])}
    _write_body(cid, body, key)
    rec = {"id": cid, "title": title or "new chat", "project": project,
           "parent": parent, "created": now, "updated": now,
           "archived": False, "private": bool(passcode),
           "salt": base64.b64encode(salt).decode() if salt else None,
           "messages": len(body["messages"]), "queue": []}
    idx["chats"][cid] = rec
    idx["projects"].setdefault(project, {"name": project, "created": now})
    _save(idx)
    return {"status": "ok", **_public(rec)}


def _public(rec):
    """Index metadata, minus anything that would help crack a locked chat."""
    out = {k: v for k, v in rec.items() if k != "salt"}
    out["locked"] = bool(rec.get("private")) and rec["id"] not in _unlocked
    return out


def listing(project=None, include_archived=False, limit=100):
    idx = _index()
    rows = [r for r in idx["chats"].values()
            if (include_archived or not r.get("archived"))
            and (project is None or r.get("project") == project)]
    rows.sort(key=lambda r: r.get("updated", 0), reverse=True)
    return {"status": "ok", "chats": [_public(r) for r in rows[:limit]],
            "projects": sorted(idx["projects"]),
            "count": len(rows)}


def projects():
    idx = _index()
    counts = {}
    for r in idx["chats"].values():
        counts[r.get("project", "general")] = counts.get(
            r.get("project", "general"), 0) + 1
    return {"status": "ok",
            "projects": [{"name": name, "chats": counts.get(name, 0), **meta}
                         for name, meta in sorted(idx["projects"].items())]}


def create_project(name):
    idx = _index()
    name = str(name or "").strip()
    if not name:
        return {"status": "error", "reason": "a project needs a name"}
    if name in idx["projects"]:
        return {"status": "ok", "already": True, "name": name}
    idx["projects"][name] = {"name": name, "created": time.time()}
    _save(idx)
    return {"status": "ok", "name": name}


def unlock(chat_id, passcode):
    idx = _index()
    rec = idx["chats"].get(chat_id)
    if not rec:
        return {"status": "error", "reason": "no such chat"}
    if not rec.get("private"):
        return {"status": "ok", "locked": False}
    key = _derive(passcode, base64.b64decode(rec["salt"]))
    try:
        _read_body(chat_id, key)
    except Exception:                              # noqa: BLE001
        return {"status": "error", "reason": "wrong passcode"}
    _unlocked[chat_id] = key
    return {"status": "ok", "locked": False, "id": chat_id}


def lock(chat_id=None):
    """Forget the derived key. Locking everything is the panic button."""
    if chat_id:
        _unlocked.pop(chat_id, None)
        return {"status": "ok", "locked": chat_id}
    _unlocked.clear()
    return {"status": "ok", "locked": "all"}


def _key_for(chat_id, rec):
    if not rec.get("private"):
        return None
    key = _unlocked.get(chat_id)
    if not key:
        raise PermissionError("this chat is locked")
    return key


def load(chat_id):
    idx = _index()
    rec = idx["chats"].get(chat_id)
    if not rec:
        return {"status": "error", "reason": "no such chat"}
    try:
        body = _read_body(chat_id, _key_for(chat_id, rec))
    except PermissionError:
        return {"status": "locked", "id": chat_id, "title": rec["title"]}
    except Exception as e:                         # noqa: BLE001
        return {"status": "error", "reason": str(e)}
    return {"status": "ok", **_public(rec), "messages": body.get("messages", [])}


def append(chat_id, message):
    idx = _index()
    rec = idx["chats"].get(chat_id)
    if not rec:
        return {"status": "error", "reason": "no such chat"}
    try:
        key = _key_for(chat_id, rec)
        body = _read_body(chat_id, key) or {"messages": []}
    except PermissionError:
        return {"status": "locked", "id": chat_id}
    body["messages"].append(message)
    _write_body(chat_id, body, key)
    rec["messages"] = len(body["messages"])
    rec["updated"] = time.time()
    if rec["title"] == "new chat" and message.get("role") == "user":
        rec["title"] = str(message.get("content", ""))[:60].strip() or "new chat"
    _save(idx)
    return {"status": "ok", "messages": rec["messages"], "title": rec["title"]}


def branch(chat_id, at=None, title=None):
    """Fork a chat at message `at` (default: the whole thing).

    The parent is untouched. This is for 'what if I had gone the other way'
    without having to choose between the two answers.
    """
    src = load(chat_id)
    if src.get("status") != "ok":
        return src
    msgs = src["messages"]
    cut = len(msgs) if at is None else max(0, min(int(at), len(msgs)))
    return create(title=title or f"branch of {src['title']}"[:60],
                  project=src.get("project", "general"),
                  parent=chat_id, messages=msgs[:cut])


def rename(chat_id, title):
    idx = _index()
    rec = idx["chats"].get(chat_id)
    if not rec:
        return {"status": "error", "reason": "no such chat"}
    rec["title"] = str(title)[:120]
    rec["updated"] = time.time()
    _save(idx)
    return {"status": "ok", **_public(rec)}


def move(chat_id, project):
    idx = _index()
    rec = idx["chats"].get(chat_id)
    if not rec:
        return {"status": "error", "reason": "no such chat"}
    rec["project"] = str(project or "general")
    idx["projects"].setdefault(rec["project"],
                               {"name": rec["project"], "created": time.time()})
    rec["updated"] = time.time()
    _save(idx)
    return {"status": "ok", **_public(rec)}


def archive(chat_id, archived=True):
    idx = _index()
    rec = idx["chats"].get(chat_id)
    if not rec:
        return {"status": "error", "reason": "no such chat"}
    rec["archived"] = bool(archived)
    rec["updated"] = time.time()
    _save(idx)
    return {"status": "ok", **_public(rec)}


def delete(chat_id):
    idx = _index()
    rec = idx["chats"].pop(chat_id, None)
    if not rec:
        return {"status": "error", "reason": "no such chat"}
    _unlocked.pop(chat_id, None)
    try:
        os.remove(_path(chat_id))
    except OSError:
        pass
    _save(idx)
    return {"status": "ok", "deleted": chat_id, "title": rec.get("title")}


# ── queued messages ─────────────────────────────────────────────────────────
def enqueue(chat_id, text):
    idx = _index()
    rec = idx["chats"].get(chat_id)
    if not rec:
        return {"status": "error", "reason": "no such chat"}
    rec.setdefault("queue", []).append({"id": uuid.uuid4().hex[:8],
                                        "text": str(text),
                                        "queued": time.time()})
    _save(idx)
    return {"status": "ok", "queued": len(rec["queue"]), "queue": rec["queue"]}


def dequeue(chat_id):
    """Take the next queued message. Returns None when the queue is empty."""
    idx = _index()
    rec = idx["chats"].get(chat_id)
    if not rec or not rec.get("queue"):
        return {"status": "ok", "next": None, "remaining": 0}
    item = rec["queue"].pop(0)
    _save(idx)
    return {"status": "ok", "next": item, "remaining": len(rec["queue"])}


def queue_list(chat_id):
    idx = _index()
    rec = idx["chats"].get(chat_id)
    if not rec:
        return {"status": "error", "reason": "no such chat"}
    return {"status": "ok", "queue": rec.get("queue", [])}


def queue_clear(chat_id, item_id=None):
    idx = _index()
    rec = idx["chats"].get(chat_id)
    if not rec:
        return {"status": "error", "reason": "no such chat"}
    if item_id:
        rec["queue"] = [q for q in rec.get("queue", []) if q["id"] != item_id]
    else:
        rec["queue"] = []
    _save(idx)
    return {"status": "ok", "queue": rec["queue"]}


def stats():
    idx = _index()
    rows = list(idx["chats"].values())
    return {"chats": len(rows),
            "archived": sum(1 for r in rows if r.get("archived")),
            "private": sum(1 for r in rows if r.get("private")),
            "queued": sum(len(r.get("queue", [])) for r in rows),
            "projects": len(idx["projects"]),
            "unlocked_now": len(_unlocked)}
