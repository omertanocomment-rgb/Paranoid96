"""
Checkpoints — undo for agent file writes.

Before the agent overwrites any existing file, the previous contents are
snapshotted to data/checkpoints/. You can list and restore them, so an
approved-but-wrong edit is never unrecoverable.
"""
import json
import shutil
import time
from pathlib import Path
from . import config

CP_DIR = config.DATA_DIR / "checkpoints"
INDEX = CP_DIR / "index.jsonl"


def snapshot(path, project="general"):
    p = Path(path)
    if not p.exists() or not p.is_file():
        return None
    CP_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.time()
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(ts))
    dest = CP_DIR / f"{stamp}_{abs(hash(str(p.resolve()))) % 10**8}_{p.name}"
    shutil.copy2(p, dest)
    entry = {"ts": ts, "original": str(p.resolve()), "backup": str(dest),
             "project": project, "size": p.stat().st_size}
    with open(INDEX, "a") as f:
        f.write(json.dumps(entry) + "\n")
    return entry


def history(limit=30, project=None):
    if not INDEX.exists():
        return []
    out = []
    for line in INDEX.read_text().strip().splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if project and e.get("project") != project:
            continue
        out.append(e)
    return out[-limit:]


def restore(backup_path):
    for e in history(limit=10000):
        if e["backup"] == backup_path or Path(e["backup"]).name == backup_path:
            src, dst = Path(e["backup"]), Path(e["original"])
            if not src.exists():
                return {"status": "error", "reason": "backup file is gone"}
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            return {"status": "ok", "restored": str(dst), "from": str(src)}
    return {"status": "error", "reason": f"no checkpoint matching {backup_path}"}


def restore_latest(original_path):
    p = str(Path(original_path).resolve())
    matches = [e for e in history(limit=10000) if e["original"] == p]
    if not matches:
        return {"status": "error", "reason": f"no checkpoint for {original_path}"}
    return restore(matches[-1]["backup"])
