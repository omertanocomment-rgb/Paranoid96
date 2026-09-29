"""
Destroying everything, on purpose.

The threat this answers is simple and not hypothetical: the device is about to
be in someone else's hands and what is on it must not be. Chats, memory, the
learning shelf, attachments, keys, the audit log -- all of it, now.

Three rules, all of them deliberate:

  * It is NOT behind the approval gate. A panic action that stops to ask is a
    panic action that does not work. The confirmation is the phrase, typed at
    the moment, and nothing else.
  * It reports what it could not remove rather than claiming success. A file
    held open, a read-only mount, a permission -- pretending those were wiped
    is the single worst lie this program could tell.
  * It never touches the application itself, only its data. Bricking the
    install would leave no way to see the report of what was wiped.
"""
import shutil
import time
from pathlib import Path

from . import config, sandbox

#: Typed by the user, at the moment, in full. No default, no checkbox.
PHRASE = "WIPE EVERYTHING"

#: Names under DATA_DIR that hold something private. Listed explicitly rather
#: than wiping the directory wholesale, so a future file is not silently
#: included in something this destructive without somebody deciding it should
#: be.
TARGETS = (
    "chats", "learned", "attachments", "scratch", "backups", "themes",
    "checkpoints", "snapshots", "index", "plugins", "skills",
    "memory.sqlite3", "memory.sqlite3-wal", "memory.sqlite3-shm",
    "command_log.jsonl", "audit_head.json", "schedules.json",
    "secrets.json", "settings.json", "usage.json", "sync_state.json",
    "auth.json", "device.json", "connectors.yaml", "models",
)


def estimate():
    base = Path(config.DATA_DIR)
    items, total = [], 0
    for name in TARGETS:
        p = base / name
        if not p.exists():
            continue
        if p.is_dir():
            files = [f for f in p.rglob("*") if f.is_file()]
            n = sum(f.stat().st_size for f in files)
            count = len(files)
        else:
            n, count = p.stat().st_size, 1
        items.append({"name": name, "bytes": n, "files": count})
        total += n
    return {"status": "ok", "items": items, "bytes": total,
            "dir": str(base), "phrase": PHRASE,
            "note": "This cannot be undone and is not backed up first. Make a "
                    "backup before wiping if you want one — doing it "
                    "automatically would defeat the point."}


def wipe(payload=None):
    p = payload or {}
    if str(p.get("confirm", "")).strip() != PHRASE:
        return {"status": "error",
                "reason": f"type exactly: {PHRASE}",
                "_status": 400}

    base = Path(config.DATA_DIR)
    removed, failed = [], []
    for name in TARGETS:
        target = base / name
        if not target.exists():
            continue
        try:
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
            removed.append(name)
        except OSError as e:
            failed.append({"name": name, "reason": str(e)})

    # The log of the wipe is written after the log was deleted, on purpose:
    # the new log begins with the fact that everything before it is gone.
    sandbox.log_event({"kind": "panic_wipe", "removed": len(removed),
                       "failed": len(failed), "ts": time.time()})
    out = {"status": "ok" if not failed else "partial",
           "removed": removed, "failed": failed,
           "note": "Restart OMERTA. What is still in memory in this process "
                   "was not on disk to delete and goes when it exits."}
    if failed:
        out["reason"] = (f"{len(failed)} item(s) could not be removed — they "
                         "are listed, not glossed over")
    return out
