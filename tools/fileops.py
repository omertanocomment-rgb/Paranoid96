"""File read/write/patch tools, with automatic backups before mutation."""
import difflib
import shutil
import time
from pathlib import Path

from core import config

BACKUP_DIR = config.DATA_DIR / "backups"


def _backup(p: Path):
    """Snapshot a file before we change it — cheap undo."""
    if not p.exists():
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = BACKUP_DIR / f"{p.name}.{stamp}.bak"
    shutil.copy2(p, dest)
    return str(dest)


def read_file(path, max_bytes=60000):
    p = Path(path)
    if not p.exists():
        return {"status": "error", "reason": f"no such file: {path}"}
    data = p.read_bytes()
    truncated = len(data) > max_bytes
    try:
        text = data[:max_bytes].decode("utf-8")
    except UnicodeDecodeError:
        return {"status": "ok", "binary": True, "bytes": len(data),
                "note": "binary file — use a shell tool to inspect"}
    return {"status": "ok", "path": path, "bytes": len(data),
            "truncated": truncated, "content": text}


def write_file(path, content, make_dirs=True):
    p = Path(path)
    if make_dirs:
        p.parent.mkdir(parents=True, exist_ok=True)
    backup = _backup(p)
    p.write_text(content, encoding="utf-8")
    return {"status": "ok", "wrote": path, "bytes": len(content), "backup": backup}


def apply_patch(path, old, new):
    """Targeted replace — safer than rewriting a whole file."""
    p = Path(path)
    if not p.exists():
        return {"status": "error", "reason": f"no such file: {path}"}
    text = p.read_text(encoding="utf-8")
    n = text.count(old)
    if n == 0:
        return {"status": "error", "reason": "old text not found — read the file again"}
    if n > 1:
        return {"status": "error", "reason": f"old text matches {n} places; make it unique"}
    backup = _backup(p)
    p.write_text(text.replace(old, new), encoding="utf-8")
    return {"status": "ok", "patched": path, "backup": backup}


def delete_file(path):
    p = Path(path)
    if not p.exists():
        return {"status": "error", "reason": f"no such file: {path}"}
    backup = _backup(p)
    p.unlink()
    return {"status": "ok", "deleted": path, "backup": backup}


def diff_files(path, new_content):
    p = Path(path)
    old = p.read_text(encoding="utf-8").splitlines(keepends=True) if p.exists() else []
    d = "".join(difflib.unified_diff(old, new_content.splitlines(keepends=True),
                                     fromfile=f"a/{path}", tofile=f"b/{path}"))
    return {"status": "ok", "diff": d or "(no changes)"}


def list_dir(path=".", depth=2):
    root = Path(path)
    if not root.exists():
        return {"status": "error", "reason": f"no such dir: {path}"}
    skip = {"node_modules", "build", "__pycache__", ".git", "dist", ".gradle", "venv"}
    out = []
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if len(rel.parts) > depth or any(s in rel.parts for s in skip):
            continue
        if any(part.startswith(".") for part in rel.parts):
            continue
        out.append(str(rel) + ("/" if p.is_dir() else ""))
    return {"status": "ok", "path": str(root), "entries": out[:400]}


def restore_backup(backup_path, dest):
    shutil.copy2(backup_path, dest)
    return {"status": "ok", "restored": dest, "from": backup_path}


def list_backups():
    if not BACKUP_DIR.exists():
        return {"status": "ok", "backups": []}
    return {"status": "ok",
            "backups": sorted(p.name for p in BACKUP_DIR.glob("*.bak"))[-50:]}
