"""
Scratch sandboxes — build it for real, decide afterwards.

A scratch is a working copy of your project that builds and runs exactly like
the original, because it *is* the original's files, copied. Everything the
agent (or you) does happens in there: edits, `npm install`, gradle, tests, a
half-finished refactor that turns out to be wrong. The project tree does not
change. When you are done you look at what actually changed and take some of
it, all of it, or none of it.

Why a copy rather than a mount: overlayfs and bubblewrap need privileges that
an unrooted phone does not give an app, and a sandbox that only works on a
workstation is not much use in something whose point is running on a handset.
A copy works everywhere. It costs disk and a few seconds; the cost of the
alternative is discovering your project tree is full of a failed experiment.

A scratch protects your project from your experiment. It also, where the
platform allows it, protects the DEVICE from what runs inside: commands are
executed through `core/isolate`, which by default gives the sandbox its own
mount, network, PID, IPC and UTS namespaces, a read-only system, no view of
your home directory, no network, and no access to your API keys.

That containment is not uniform, so `run()` reports the level it actually
achieved — `strict`, `relaxed` or `limits` — rather than implying the best one.
On an unrooted Android app there are no namespaces to be had (the kernel and
SELinux deny them), so the level there is `limits`: resource caps and a
scrubbed environment, on top of the app sandbox the OS already enforces. Saying
that plainly matters more than the feature does; a sandbox you over-trust is
worse than one you know the edges of.

Commands still go through the approval gate either way.
"""
import difflib
import hashlib
import json
import os
import shutil
import time
import uuid

from . import config, isolate, sandbox

ROOT = config.DATA_DIR / "scratch"
INDEX_FILE = ROOT / "index.json"

SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv",
             ".gradle", ".idea", "build", "dist", "build_pkg", ".mypy_cache",
             ".pytest_cache", ".cache", "artifacts", "scratch"}

MAX_COPY_BYTES = int(config.get("OMERTA_SCRATCH_MAX_BYTES", 512 * 1024 * 1024))
MAX_COPY_FILES = int(config.get("OMERTA_SCRATCH_MAX_FILES", 20000))
MAX_DIFF_BYTES = int(config.get("OMERTA_SCRATCH_MAX_DIFF", 400_000))


def _ensure():
    ROOT.mkdir(parents=True, exist_ok=True)


def _index():
    _ensure()
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text())
        except (OSError, ValueError):
            pass
    return {"sandboxes": {}}


def _save(idx):
    _ensure()
    tmp = INDEX_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(idx, indent=2))
    os.replace(tmp, INDEX_FILE)


def _skip(name):
    return name in SKIP_DIRS or name.endswith(".pyc")


def _walk(base):
    """Relative paths of every file under `base`, minus the junk."""
    out = []
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if not _skip(d)]
        for f in files:
            if f.endswith(".pyc"):
                continue
            full = os.path.join(root, f)
            if os.path.islink(full):
                continue
            out.append(os.path.relpath(full, base))
    return out


def _digest(path):
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
    except OSError:
        return None
    return h.hexdigest()


def create(args=None):
    """Copy a source tree into a fresh scratch."""
    a = args or {}
    src = os.path.realpath(os.path.expanduser(
        a.get("source") or str(config.RES_DIR)))
    if not os.path.isdir(src):
        return {"status": "error", "reason": f"not a directory: {src}"}

    # bound the copy before starting it, not halfway through
    total = count = 0
    for rel in _walk(src):
        count += 1
        try:
            total += os.path.getsize(os.path.join(src, rel))
        except OSError:
            pass
        if count > MAX_COPY_FILES or total > MAX_COPY_BYTES:
            return {"status": "error",
                    "reason": f"{src} is too large to sandbox "
                              f"({count}+ files, {total} bytes). Point it at a "
                              "subdirectory, or raise OMERTA_SCRATCH_MAX_BYTES."}

    sid = uuid.uuid4().hex[:12]
    dest = ROOT / sid / "work"
    _ensure()
    try:
        shutil.copytree(src, dest, symlinks=True,
                        ignore=shutil.ignore_patterns(*SKIP_DIRS, "*.pyc"))
    except Exception as e:                         # noqa: BLE001
        shutil.rmtree(ROOT / sid, ignore_errors=True)
        return {"status": "error", "reason": f"could not copy: {e}"}

    # a manifest of what we started from, so "changed" means changed-by-you
    manifest = {rel: _digest(os.path.join(dest, rel)) for rel in _walk(dest)}
    (ROOT / sid / "manifest.json").write_text(json.dumps(manifest))

    idx = _index()
    rec = {"id": sid, "source": src, "path": str(dest),
           "name": a.get("name") or os.path.basename(src) or "scratch",
           "created": time.time(), "files": len(manifest),
           "bytes": total, "commands": []}
    idx["sandboxes"][sid] = rec
    _save(idx)
    sandbox.log_event({"kind": "scratch_create", "id": sid, "source": src,
                       "files": len(manifest)})
    return {"status": "ok", **rec}


def listing(args=None):
    idx = _index()
    rows = sorted(idx["sandboxes"].values(),
                  key=lambda r: r.get("created", 0), reverse=True)
    for r in rows:
        r["exists"] = os.path.isdir(r["path"])
    return {"status": "ok", "count": len(rows), "sandboxes": rows,
            "dir": str(ROOT)}


def _get(sid):
    return _index()["sandboxes"].get(sid)


def _manifest(sid):
    try:
        return json.loads((ROOT / sid / "manifest.json").read_text())
    except (OSError, ValueError):
        return {}


def run(args=None):
    """Run a command inside the scratch, contained.

    Goes through sandbox.run like every other command, so it is gated, tiered
    and audited identically — being in a scratch makes it reversible, not
    unsupervised. On top of that it is wrapped by core/isolate, so the command
    also cannot reach your files, your network or your keys.

    Network is off by default. Pass net=true for the cases that genuinely need
    it (installing dependencies), and it is then the only thing opened.
    """
    a = args or {}
    rec = _get(a.get("id"))
    if not rec:
        return {"status": "error", "reason": "no such sandbox"}
    if not os.path.isdir(rec["path"]):
        return {"status": "error", "reason": "this sandbox's files are gone"}
    cmd = a.get("cmd", "")
    if not str(cmd).strip():
        return {"status": "error", "reason": "nothing to run"}

    contained = config.flag("OMERTA_SCRATCH_ISOLATE", "1")
    jailed = None
    if contained:
        jailed = isolate.jail(cmd, workdir=rec["path"],
                              net=bool(a.get("net")),
                              level=a.get("level"),
                              allow_read=a.get("allow_read") or ())
        run_cmd = jailed["cmd"]
    else:
        run_cmd = cmd

    # The user approves the command THEY asked for, not the bwrap incantation
    # wrapped around it — an approval prompt full of mount flags is one nobody
    # reads. sandbox.run classifies and displays `cmd`; `exec_cmd` is what runs.
    res = sandbox.run(cmd, cwd=rec["path"], project=a.get("project", "general"),
                      exec_cmd=run_cmd)
    idx = _index()
    entry = {"cmd": cmd, "at": time.time(),
             "status": res.get("status"), "code": res.get("returncode")}
    idx["sandboxes"][rec["id"]].setdefault("commands", []).append(entry)
    idx["sandboxes"][rec["id"]]["commands"] = \
        idx["sandboxes"][rec["id"]]["commands"][-50:]
    _save(idx)
    out = dict(res)
    out["sandbox"] = rec["id"]
    if jailed:
        out["isolation"] = {"level": jailed["level"], "network": jailed["net"],
                            "backend": jailed["backend"]}
        if jailed["level"] == "limits":
            out["isolation"]["note"] = jailed.get(
                "note", "no namespace support on this device")
    else:
        out["isolation"] = {"level": "off", "network": True,
                            "note": "OMERTA_SCRATCH_ISOLATE=0"}
    return out


def changes(args=None):
    """What actually differs from the source tree."""
    a = args or {}
    rec = _get(a.get("id"))
    if not rec:
        return {"status": "error", "reason": "no such sandbox"}
    work, src = rec["path"], rec["source"]
    if not os.path.isdir(work):
        return {"status": "error", "reason": "this sandbox's files are gone"}
    started = _manifest(rec["id"])
    now = {rel: _digest(os.path.join(work, rel)) for rel in _walk(work)}

    added = sorted(set(now) - set(started))
    removed = sorted(set(started) - set(now))
    modified = sorted(r for r in set(now) & set(started) if now[r] != started[r])

    rows = []
    for rel in added + modified:
        try:
            size = os.path.getsize(os.path.join(work, rel))
        except OSError:
            size = 0
        rows.append({"path": rel, "kind": "added" if rel in added else "modified",
                     "size": size})
    rows += [{"path": rel, "kind": "removed", "size": 0} for rel in removed]
    rows.sort(key=lambda r: r["path"])
    return {"status": "ok", "id": rec["id"], "source": src, "work": work,
            "added": len(added), "modified": len(modified),
            "removed": len(removed), "changes": rows,
            "clean": not rows}


def diff(args=None):
    """A unified diff for one changed file."""
    a = args or {}
    rec = _get(a.get("id"))
    if not rec:
        return {"status": "error", "reason": "no such sandbox"}
    rel = str(a.get("path", "")).replace("\\", "/").lstrip("/")
    if ".." in rel.split("/"):
        return {"status": "error", "reason": "bad path"}
    work = os.path.join(rec["path"], rel)
    orig = os.path.join(rec["source"], rel)

    def _text(p):
        if not os.path.isfile(p):
            return None
        if os.path.getsize(p) > MAX_DIFF_BYTES:
            return "<too large to diff>"
        try:
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                return f.read()
        except OSError:
            return None

    a_txt, b_txt = _text(orig), _text(work)
    if a_txt is None and b_txt is None:
        return {"status": "error", "reason": f"no such file in either tree: {rel}"}
    d = list(difflib.unified_diff((a_txt or "").splitlines(),
                                  (b_txt or "").splitlines(),
                                  fromfile=f"project/{rel}",
                                  tofile=f"scratch/{rel}", lineterm="", n=3))
    return {"status": "ok", "path": rel, "diff": "\n".join(d[:2000]),
            "created": a_txt is None, "deleted": b_txt is None,
            "content": b_txt or ""}


def propose_accept(args=None):
    """What accepting would do. Writes nothing.

    Accepting is the one moment a scratch touches your real tree, so it gets
    the same treatment as any other mutation: a description first, the write
    only after you approve.
    """
    a = args or {}
    rec = _get(a.get("id"))
    if not rec:
        return {"status": "error", "reason": "no such sandbox"}
    ch = changes({"id": rec["id"]})
    if ch.get("status") != "ok":
        return ch
    want = a.get("paths")
    rows = ch["changes"] if not want else [r for r in ch["changes"]
                                           if r["path"] in set(want)]
    if not rows:
        return {"status": "unchanged",
                "note": "nothing selected to accept" if want else
                        "the sandbox matches the project exactly"}
    verb = "all changes" if not want else f"{len(rows)} selected file(s)"
    return {"status": "awaiting_approval", "id": rec["id"],
            "action": f"copy {verb} from sandbox {rec['name']} into {rec['source']}",
            "files": rows, "count": len(rows),
            "deletes": [r["path"] for r in rows if r["kind"] == "removed"],
            "note": "Nothing has been written to the project yet."}


def accept(args=None):
    """Copy selected (or all) changes back into the source tree.

    Every file replaced is backed up first via the same mechanism that backs
    up every other edit, so accepting is itself undoable.
    """
    a = args or {}
    rec = _get(a.get("id"))
    if not rec:
        return {"status": "error", "reason": "no such sandbox"}
    ch = changes({"id": rec["id"]})
    if ch.get("status") != "ok":
        return ch
    want = set(a.get("paths") or [])
    rows = ch["changes"] if not want else [r for r in ch["changes"]
                                           if r["path"] in want]
    if not rows:
        return {"status": "error", "reason": "nothing to accept"}

    from tools import fileops
    written, deleted, failed = [], [], []
    for row in rows:
        rel = row["path"]
        dest = os.path.join(rec["source"], rel)
        srcf = os.path.join(rec["path"], rel)
        try:
            if row["kind"] == "removed":
                if os.path.isfile(dest):
                    fileops.backup(dest)
                    os.remove(dest)
                    deleted.append(rel)
                continue
            os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
            if os.path.isfile(dest):
                fileops.backup(dest)
            shutil.copy2(srcf, dest)
            written.append(rel)
        except OSError as e:
            failed.append({"path": rel, "reason": str(e)})

    sandbox.log_event({"kind": "scratch_accept", "id": rec["id"],
                       "written": len(written), "deleted": len(deleted),
                       "failed": len(failed), "into": rec["source"]})

    # accepted files are the new baseline, so a partial accept leaves the rest
    # still showing as changed instead of looking like it was all taken
    man = _manifest(rec["id"])
    for rel in written:
        man[rel] = _digest(os.path.join(rec["path"], rel))
    for rel in deleted:
        man.pop(rel, None)
    (ROOT / rec["id"] / "manifest.json").write_text(json.dumps(man))

    return {"status": "ok", "written": written, "deleted": deleted,
            "failed": failed, "count": len(written) + len(deleted),
            "partial": bool(want),
            "remaining": changes({"id": rec["id"]})["changes"]}


def discard(args=None):
    """Throw the sandbox away. The project is untouched by definition."""
    a = args or {}
    idx = _index()
    rec = idx["sandboxes"].pop(a.get("id"), None)
    if not rec:
        return {"status": "error", "reason": "no such sandbox"}
    shutil.rmtree(ROOT / rec["id"], ignore_errors=True)
    _save(idx)
    sandbox.log_event({"kind": "scratch_discard", "id": rec["id"]})
    return {"status": "ok", "discarded": rec["id"], "name": rec.get("name")}


def stats():
    idx = _index()
    caps = isolate.capabilities()
    return {"sandboxes": len(idx["sandboxes"]), "dir": str(ROOT),
            "isolation": config.flag("OMERTA_SCRATCH_ISOLATE", "1"),
            "level": caps["best"], "backend": caps["backend"],
            "reason": caps["reason"]}
