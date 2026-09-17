"""
The workspace — browsing, reading and editing files from the app.

This is the editor half of the IDE: a bounded file tree, file reads, saves, and
the archive of automatic backups that every mutation already produces. Search
and symbol lookup come from `core/index`; this module does not duplicate them.

Two rules shape the whole file:

  * **A save is a side effect, so it goes through the same gate as everything
    else.** The editor does not get a private write path. `save()` produces a
    proposal; `commit()` is what actually writes, and only the approval layer
    calls it. An editor that could quietly write files would make the approval
    gate a decoration.
  * **Roots are explicit.** Browsing is confined to declared roots (the project
    directory, and whatever you add), and every path is resolved and checked
    against them, so a symlink or a `..` cannot walk out. The agent's
    `read_file` is deliberately unconfined — that is a considered choice for a
    coding agent — but a *browser* handing back arbitrary paths to a UI is a
    different thing, and a narrower one is the right default here.
"""
import os
import time
from pathlib import Path

from . import config, sandbox

SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv", "build",
             "dist", ".gradle", ".idea", "build_pkg", ".mypy_cache",
             ".pytest_cache", "artifacts", ".cache"}

MAX_READ = int(config.get("OMERTA_EDIT_MAX_BYTES", 2 * 1024 * 1024))
MAX_ENTRIES = int(config.get("OMERTA_TREE_MAX_ENTRIES", 4000))

TEXT_SUFFIXES = {
    ".txt", ".md", ".rst", ".log", ".csv", ".json", ".yaml", ".yml", ".toml",
    ".ini", ".cfg", ".conf", ".xml", ".html", ".css", ".py", ".js", ".ts",
    ".tsx", ".jsx", ".java", ".kt", ".kts", ".c", ".h", ".cpp", ".hpp", ".rs",
    ".go", ".rb", ".php", ".sh", ".bash", ".zsh", ".sql", ".gradle", ".dts",
    ".dtsi", ".mk", ".patch", ".diff", ".properties", ".pro", ".env", "",
}


def roots():
    """Directories the editor may browse. Configurable, never empty."""
    raw = config.get("OMERTA_WORKSPACE_ROOTS", "")
    out = []
    for part in str(raw).split(os.pathsep):
        part = part.strip()
        if part and os.path.isdir(os.path.expanduser(part)):
            out.append(os.path.realpath(os.path.expanduser(part)))
    if not out:
        out = [os.path.realpath(str(config.RES_DIR))]
        home = os.path.realpath(os.path.expanduser("~"))
        if home not in out and os.path.isdir(home):
            out.append(home)
    # de-duplicate while keeping order
    seen, uniq = set(), []
    for r in out:
        if r not in seen:
            seen.add(r)
            uniq.append(r)
    return uniq


def _resolve(path):
    """Resolve `path` and confirm it is inside a declared root.

    realpath first, so a symlink pointing outside is caught by where it LANDS
    rather than by how it is spelled.
    """
    p = os.path.realpath(os.path.expanduser(str(path or "")))
    for r in roots():
        if p == r or p.startswith(r + os.sep):
            return p
    raise PermissionError(f"outside the workspace: {path}")


def _is_text(p):
    if os.path.splitext(p)[1].lower() not in TEXT_SUFFIXES:
        return False
    try:
        with open(p, "rb") as f:
            head = f.read(8192)
    except OSError:
        return False
    if b"\x00" in head:
        return False
    try:
        head.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


def tree(args=None):
    """One directory level. Lazy by design: walking a whole source tree on a
    phone to render a sidebar is how you make a file browser feel broken."""
    a = args or {}
    target = a.get("path")
    if not target:
        rs = roots()
        return {"status": "ok", "path": None, "roots": rs,
                "entries": [{"name": os.path.basename(r) or r, "path": r,
                             "dir": True, "size": 0} for r in rs]}
    try:
        p = _resolve(target)
    except PermissionError as e:
        return {"status": "error", "reason": str(e)}
    if not os.path.isdir(p):
        return {"status": "error", "reason": f"not a directory: {target}"}
    entries = []
    try:
        for name in sorted(os.listdir(p), key=lambda n: n.lower()):
            if name.startswith(".") and name not in (".github", ".claude"):
                continue
            full = os.path.join(p, name)
            is_dir = os.path.isdir(full)
            if is_dir and name in SKIP_DIRS:
                continue
            try:
                size = 0 if is_dir else os.path.getsize(full)
            except OSError:
                size = 0
            entries.append({"name": name, "path": full, "dir": is_dir,
                            "size": size,
                            "text": False if is_dir else _is_text(full)})
            if len(entries) >= MAX_ENTRIES:
                break
    except OSError as e:
        return {"status": "error", "reason": str(e)}
    parent = os.path.dirname(p)
    try:
        _resolve(parent)
    except PermissionError:
        parent = None
    return {"status": "ok", "path": p, "parent": parent,
            "entries": entries, "count": len(entries), "roots": roots()}


def read(args=None):
    a = args or {}
    try:
        p = _resolve(a.get("path"))
    except PermissionError as e:
        return {"status": "error", "reason": str(e)}
    if not os.path.isfile(p):
        return {"status": "error", "reason": f"no such file: {a.get('path')}"}
    size = os.path.getsize(p)
    if size > MAX_READ:
        return {"status": "error",
                "reason": f"{size} bytes is larger than the {MAX_READ} byte "
                          "editor limit — open it in the terminal instead"}
    if not _is_text(p):
        return {"status": "ok", "path": p, "binary": True, "size": size,
                "content": "", "note": "binary file — not editable here"}
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    return {"status": "ok", "path": p, "binary": False, "size": size,
            "content": content, "lines": content.count("\n") + 1,
            "mtime": os.path.getmtime(p)}


def propose_save(args=None):
    """Describe a save without performing it.

    Returns the same shape the agent's approval flow uses, so the editor's
    saves appear in the same place, with the same buttons, as everything else
    the system does.
    """
    a = args or {}
    try:
        p = _resolve(a.get("path"))
    except PermissionError as e:
        return {"status": "error", "reason": str(e)}
    new = a.get("content", "")
    existed = os.path.isfile(p)
    old = ""
    if existed:
        try:
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                old = f.read()
        except OSError as e:
            return {"status": "error", "reason": str(e)}
    if existed and old == new:
        return {"status": "unchanged", "path": p,
                "note": "the file already has exactly this content"}

    import difflib
    diff = list(difflib.unified_diff(
        old.splitlines(), new.splitlines(),
        fromfile=f"a/{os.path.basename(p)}", tofile=f"b/{os.path.basename(p)}",
        lineterm="", n=2))
    added = sum(1 for d in diff if d.startswith("+") and not d.startswith("+++"))
    removed = sum(1 for d in diff if d.startswith("-") and not d.startswith("---"))
    return {"status": "awaiting_approval", "path": p,
            "action": f"write {p} ({'+%d/-%d' % (added, removed)})"
                      if existed else f"create {p} ({len(new)} bytes)",
            "created": not existed, "added": added, "removed": removed,
            "diff": "\n".join(diff[:400]),
            "note": "Nothing has been written. Approve to save."}


def commit_save(args=None):
    """Actually write. Only called once a save has been approved."""
    a = args or {}
    try:
        p = _resolve(a.get("path"))
    except PermissionError as e:
        return {"status": "error", "reason": str(e)}
    from tools import fileops
    res = fileops.write_file(p, a.get("content", ""))
    sandbox.log_event({"kind": "editor_save", "path": p,
                       "bytes": len(a.get("content", "")),
                       "backup": res.get("backup") if isinstance(res, dict) else None})
    out = {"status": "ok", "path": p, "saved": True}
    if isinstance(res, dict):
        out.update({k: v for k, v in res.items() if k != "status"})
    return out


def backups(args=None):
    """The archive: every automatic backup taken before a mutation.

    Reads the backup directory directly. `fileops.list_backups` returns bare
    filenames capped at 50, which is right for a tool result the model reads
    but not enough to browse — the archive needs paths, sizes and times, and
    the original filename the backup came from.
    """
    from tools import fileops
    base = fileops.BACKUP_DIR
    items = []
    try:
        names = sorted(os.listdir(base))
    except OSError:
        names = []
    for name in names:
        if not name.endswith(".bak"):
            continue
        full = os.path.join(str(base), name)
        try:
            st = os.stat(full)
        except OSError:
            continue
        # "<original name>.<YYYYmmdd-HHMMSS>.bak"
        stem = name[:-4]
        origin, _, stamp = stem.rpartition(".")
        items.append({"path": full, "name": name, "origin": origin or stem,
                      "stamp": stamp, "size": st.st_size, "mtime": st.st_mtime})
    items.sort(key=lambda x: x["mtime"], reverse=True)
    return {"status": "ok", "count": len(items), "backups": items[:200],
            "dir": str(base)}


def read_backup(args=None):
    """Read an archived copy. Confined to the backup directory, not the
    workspace roots — these live under the agent's own data dir."""
    a = args or {}
    base = os.path.realpath(str(config.DATA_DIR / "backups"))
    p = os.path.realpath(os.path.expanduser(str(a.get("path", ""))))
    if p != base and not p.startswith(base + os.sep):
        return {"status": "error", "reason": "not an OMERTA backup"}
    if not os.path.isfile(p):
        return {"status": "error", "reason": "no such backup"}
    if os.path.getsize(p) > MAX_READ:
        return {"status": "error", "reason": "backup too large to display"}
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        return {"status": "ok", "path": p, "content": f.read(),
                "mtime": os.path.getmtime(p)}


def stats():
    return {"roots": roots(), "max_bytes": MAX_READ}
