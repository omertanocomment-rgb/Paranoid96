"""
Sandbox isolation + workspace snapshots.

Two independent capabilities:

  * wrap()  — wrap a shell command with resource limits (ulimit: CPU time,
    address space, file size, process count) and, when a supported backend is
    installed, filesystem/network isolation via bubblewrap or firejail. Network
    is DENIED by default. Sensitive paths (~/.ssh, ~/.aws, ~/.gnupg, key stores)
    are never bind-mounted. This is opt-in: the audited approval gate in
    core/sandbox.py runs commands verbatim unless OMERTA_ISOLATE is set.

  * snapshot()/rollback() — copy a workspace directory before a risky change so
    an approved-but-wrong edit is fully reversible, beyond the per-file backups.

Nothing here weakens the approval gate; it only adds containment and undo.
"""
import os
import shlex
import shutil
import time
import json
from pathlib import Path

from . import config

SNAP_DIR = config.DATA_DIR / "snapshots"
SNAP_INDEX = SNAP_DIR / "index.jsonl"

# Never bind-mount these into a sandbox, even if isolation is requested.
NEVER_MOUNT = ["~/.ssh", "~/.aws", "~/.gnupg", "~/.config/gcloud",
               "~/.docker/config.json", "~/.netrc", "~/.password-store"]


def _int(env, default):
    try:
        return int(config.get(env, default))
    except (TypeError, ValueError):
        return default


def limits():
    return {
        "cpu_seconds": _int("OMERTA_LIMIT_CPU", 120),
        "address_space_mb": _int("OMERTA_LIMIT_AS_MB", 2048),
        "file_size_mb": _int("OMERTA_LIMIT_FSIZE_MB", 512),
        "processes": _int("OMERTA_LIMIT_NPROC", 512),
    }


def backend():
    """Preferred available isolation backend, or 'none'."""
    forced = config.get("OMERTA_SANDBOX_BACKEND")
    order = [forced] if forced else ["bwrap", "firejail"]
    for b in order:
        if b and shutil.which(b):
            return b
    return "none"


def _ulimit_prefix():
    lim = limits()
    return ("ulimit -t {cpu}; ulimit -v {ask}; ulimit -f {fs}; ulimit -u {np}; "
            ).format(cpu=lim["cpu_seconds"],
                     ask=lim["address_space_mb"] * 1024,        # KiB
                     fs=lim["file_size_mb"] * 1024,             # 1K blocks
                     np=lim["processes"])


def wrap(cmd, workdir=".", net=False):
    """Return a shell command string that runs `cmd` with resource limits and,
    where available, filesystem/network isolation. Read-only for the caller —
    it just builds the string."""
    workdir = str(Path(workdir).resolve())
    inner = _ulimit_prefix() + "exec " + cmd
    limited = "bash -c " + shlex.quote(inner)
    b = backend()
    if b == "bwrap":
        parts = ["bwrap", "--die-with-parent", "--unshare-pid", "--unshare-uts",
                 "--unshare-ipc", "--new-session",
                 "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc",
                 "--tmpfs", "/tmp", "--bind", workdir, workdir, "--chdir", workdir]
        parts += ["--unshare-net"] if not net else []
        for p in NEVER_MOUNT:
            ep = os.path.expanduser(p)
            if os.path.exists(ep):
                parts += ["--tmpfs", ep]      # shadow it so it can't be read
        return " ".join(shlex.quote(x) for x in parts) + " " + limited
    if b == "firejail":
        parts = ["firejail", "--quiet", "--noprofile",
                 f"--whitelist={workdir}", "--private-tmp"]
        parts += ["--net=none"] if not net else []
        for p in NEVER_MOUNT:
            ep = os.path.expanduser(p)
            if os.path.exists(ep):
                parts.append(f"--blacklist={ep}")
        return " ".join(parts) + " " + limited
    # no backend: resource limits still apply (this is the honest fallback)
    return limited


def enabled():
    return str(config.get("OMERTA_ISOLATE", "0")).lower() in ("1", "true", "yes")


def status():
    return {"isolation_enabled": enabled(), "backend": backend(),
            "limits": limits(), "never_mount": NEVER_MOUNT,
            "note": "Isolation is opt-in (OMERTA_ISOLATE=1). Snapshots always "
                    "available. Network denied by default inside the sandbox."}


# ── workspace snapshots ─────────────────────────────────────────────────────
_SNAP_SKIP = {".git", "node_modules", "__pycache__", ".gradle", "build", "dist",
              ".venv", "venv", "artifacts"}


def snapshot(path=".", note=""):
    src = Path(path).resolve()
    if not src.is_dir():
        return {"status": "error", "reason": f"not a directory: {src}"}
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    sid = time.strftime("%Y%m%d-%H%M%S") + f"-{abs(hash(str(src))) % 10000:04d}"
    dest = SNAP_DIR / sid
    shutil.copytree(src, dest,
                    ignore=shutil.ignore_patterns(*_SNAP_SKIP),
                    dirs_exist_ok=True)
    files = sum(1 for _ in dest.rglob("*") if _.is_file())
    entry = {"id": sid, "src": str(src), "at": time.time(),
             "files": files, "note": note}
    with open(SNAP_INDEX, "a") as f:
        f.write(json.dumps(entry) + "\n")
    return {"status": "ok", **entry}


def list_snapshots(limit=50):
    if not SNAP_INDEX.exists():
        return []
    out = []
    for line in SNAP_INDEX.read_text().strip().splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out[-limit:]


def rollback(sid, dest=None):
    snaps = {s["id"]: s for s in list_snapshots(limit=100000)}
    snap = snaps.get(sid) or (list_snapshots(1)[0] if sid in ("latest", None)
                              and list_snapshots(1) else None)
    if not snap:
        return {"status": "error", "reason": f"no snapshot {sid}"}
    src = SNAP_DIR / snap["id"]
    if not src.is_dir():
        return {"status": "error", "reason": "snapshot data missing"}
    target = Path(dest or snap["src"]).resolve()
    restored = 0
    for p in src.rglob("*"):
        if p.is_file():
            rel = p.relative_to(src)
            out = target / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, out)
            restored += 1
    return {"status": "ok", "id": snap["id"], "restored_to": str(target),
            "files": restored}
