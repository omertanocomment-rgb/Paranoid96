"""
Sandbox isolation + workspace snapshots.

Two independent capabilities:

  * jail()/wrap() — run a command with resource limits and, where the platform
    allows it, real containment: its own mount, network, PID, IPC and UTS
    namespaces, a read-only system, and nothing of yours visible except the
    directory it is working in.

  * snapshot()/rollback() — copy a workspace before a risky change so an
    approved-but-wrong edit is reversible beyond the per-file backups.

ON WHAT "ISOLATED" HONESTLY MEANS HERE

The containment you get depends on the machine, and this module reports which
level it actually achieved rather than implying the best one:

  strict     bubblewrap (or firejail): separate namespaces, read-only system,
             only the work directory writable, network denied. A hostile
             program cannot read your home directory, reach the network, see
             your other processes, or write anywhere but its own tree.
  relaxed    the filesystem is readable but read-only, the work directory is
             writable, key stores are shadowed, network denied. Use when a
             build genuinely needs to read things outside its tree.
  limits     resource limits and a scrubbed environment only — no namespaces.
             This is what an unrooted Android app gets, because the kernel and
             SELinux deny an app the ability to create namespaces. The Android
             app sandbox still confines the process to the app's own UID and
             data directory, which is real but is the OS's doing, not ours.

`capabilities()` says which of these this device can do, and every result
carries the level that was actually used. A sandbox that claims more than it
delivers is worse than none, because you would trust it.

Nothing here weakens the approval gate; it only adds containment and undo.
"""
import os
import shlex
import shutil
import subprocess
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


def _userns_works():
    """Can this kernel actually give an unprivileged process a namespace?

    Asking the kernel beats reading sysctls: Android blocks this through
    SELinux rather than through a flag, and some hardened kernels disable it
    in ways no single file reveals.
    """
    if not shutil.which("unshare"):
        return False
    try:
        return subprocess.run(["unshare", "--user", "--map-root-user", "--net",
                               "true"], capture_output=True, timeout=10
                              ).returncode == 0
    except Exception:                              # noqa: BLE001
        return False


_CAPS = []


def capabilities(refresh=False):
    """What containment this device can genuinely provide."""
    if _CAPS and not refresh:
        return _CAPS[0]
    b = backend()
    userns = _userns_works()
    if b in ("bwrap", "firejail") and userns:
        best, why = "strict", f"{b} with unprivileged namespaces"
    elif b in ("bwrap", "firejail"):
        best, why = "relaxed", f"{b} present but namespaces are restricted"
    elif userns:
        best, why = "relaxed", "namespaces available but no bubblewrap/firejail"
    else:
        best, why = "limits", ("no namespace support — on Android this is "
                               "expected; the OS app sandbox still applies")
    caps = {"best": best, "backend": b, "namespaces": userns, "reason": why,
            "android": bool(config.get("OMERTA_ANDROID")
                            or os.environ.get("ANDROID_ROOT")),
            "levels": ["strict", "relaxed", "limits"]}
    _CAPS.clear()
    _CAPS.append(caps)
    return caps


# System paths a program needs in order to run at all. Bound READ-ONLY, and
# only these -- everything else is absent rather than merely unwritable.
SYSTEM_PATHS = ["/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64",
                "/etc/alternatives", "/etc/ssl", "/etc/ca-certificates",
                "/opt"]

# Environment variables never passed into a sandbox. A contained process that
# still holds your API keys is not contained in the way that matters.
SECRET_ENV_HINTS = ("KEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL",
                    "SESSION", "COOKIE", "AUTH")


# What a build legitimately needs to know about its environment. Anything not
# on this list is simply absent inside a strict jail rather than filtered,
# because an allow-list cannot be defeated by a variable name nobody predicted.
PASSTHROUGH_ENV = ("LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ", "SHELL",
                   "JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT",
                   "GRADLE_USER_HOME", "npm_config_cache", "CI",
                   "PYTHONDONTWRITEBYTECODE", "PYTHONUNBUFFERED",
                   "NO_COLOR", "FORCE_COLOR", "COLUMNS", "LINES")


def _passthrough_env():
    return {k: v for k, v in os.environ.items() if k in PASSTHROUGH_ENV}


def safe_env(base=None):
    """A minimal environment with anything secret-looking removed."""
    src = dict(base or os.environ)
    out = {}
    for k, v in src.items():
        if any(h in k.upper() for h in SECRET_ENV_HINTS):
            continue
        out[k] = v
    out.setdefault("PATH", "/usr/local/bin:/usr/bin:/bin")
    out.pop("OMERTA_TOKEN", None)
    return out


def _ulimit_prefix():
    lim = limits()
    return ("ulimit -t {cpu}; ulimit -v {ask}; ulimit -f {fs}; ulimit -u {np}; "
            "ulimit -c 0; "
            ).format(cpu=lim["cpu_seconds"],
                     ask=lim["address_space_mb"] * 1024,        # KiB
                     fs=lim["file_size_mb"] * 1024,             # 1K blocks
                     np=lim["processes"])


def jail(cmd, workdir=".", net=False, level=None, allow_read=()):
    """Build a contained command line, and say what containment it achieved.

    Returns {"cmd": <shell string>, "level": ..., "net": ..., "backend": ...}.
    The level is what was ACTUALLY applied, not what was asked for.
    """
    workdir = str(Path(workdir).resolve())
    want = (level or config.get("OMERTA_ISOLATE_LEVEL", "strict")).lower()
    caps = capabilities()
    best = caps["best"]
    # never claim more than the device can do
    order = {"limits": 0, "relaxed": 1, "strict": 2}
    got = want if order.get(want, 0) <= order[best] else best

    inner = _ulimit_prefix() + "exec " + cmd
    limited = "bash -c " + shlex.quote(inner)
    b = caps["backend"]

    if got == "strict" and b == "bwrap":
        parts = ["bwrap", "--die-with-parent", "--new-session",
                 "--unshare-pid", "--unshare-uts", "--unshare-ipc",
                 "--unshare-cgroup-try",
                 "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"]
        for sp in SYSTEM_PATHS:
            if os.path.exists(sp):
                parts += ["--ro-bind", sp, sp]
        for extra in allow_read:
            ep = os.path.realpath(os.path.expanduser(str(extra)))
            if os.path.exists(ep):
                parts += ["--ro-bind", ep, ep]
        if not net:
            parts += ["--unshare-net"]
        elif os.path.exists("/etc/resolv.conf"):
            parts += ["--ro-bind", "/etc/resolv.conf", "/etc/resolv.conf"]
        parts += ["--bind", workdir, workdir, "--chdir", workdir]
        # --clearenv first, THEN set what the sandbox is allowed to see.
        # Without it bwrap inherits the parent environment, so a "contained"
        # process still holds your API keys — which is the one thing the
        # containment was for.
        parts += ["--clearenv"]
        for k, v in sorted(safe_env(_passthrough_env()).items()):
            parts += ["--setenv", k, v]
        parts += ["--setenv", "HOME", workdir,
                  "--setenv", "TMPDIR", "/tmp",
                  "--setenv", "PWD", workdir,
                  "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin"]
        return {"cmd": " ".join(shlex.quote(x) for x in parts) + " " + limited,
                "level": "strict", "net": bool(net), "backend": "bwrap"}

    if got in ("strict", "relaxed") and b == "bwrap":
        # readable system, writable work dir, key stores shadowed
        parts = ["bwrap", "--die-with-parent", "--new-session",
                 "--unshare-pid", "--unshare-uts", "--unshare-ipc",
                 "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc",
                 "--tmpfs", "/tmp",
                 "--bind", workdir, workdir, "--chdir", workdir]
        if not net:
            parts += ["--unshare-net"]
        for pth in NEVER_MOUNT:
            ep = os.path.expanduser(pth)
            if os.path.exists(ep):
                parts += ["--tmpfs", ep]
        return {"cmd": " ".join(shlex.quote(x) for x in parts) + " " + limited,
                "level": "relaxed", "net": bool(net), "backend": "bwrap"}

    if b == "firejail":
        parts = ["firejail", "--quiet", "--noprofile",
                 f"--whitelist={workdir}", "--private-tmp", "--caps.drop=all",
                 "--nonewprivs", "--seccomp"]
        parts += ["--net=none"] if not net else []
        for pth in NEVER_MOUNT:
            ep = os.path.expanduser(pth)
            if os.path.exists(ep):
                parts.append(f"--blacklist={ep}")
        return {"cmd": " ".join(parts) + " " + limited,
                "level": "relaxed", "net": bool(net), "backend": "firejail"}

    # No backend. Resource limits and a scrubbed environment are what is left,
    # and saying so plainly is the point.
    return {"cmd": limited, "level": "limits", "net": True, "backend": "none",
            "note": caps["reason"]}


def wrap(cmd, workdir=".", net=False):
    """Backwards-compatible string form of jail()."""
    return jail(cmd, workdir=workdir, net=net)["cmd"]


def enabled():
    return config.flag("OMERTA_ISOLATE")


def status():
    caps = capabilities()
    return {"isolation_enabled": enabled(), "backend": caps["backend"],
            "best_level": caps["best"], "namespaces": caps["namespaces"],
            "reason": caps["reason"], "limits": limits(),
            "never_mount": NEVER_MOUNT,
            "note": "Network is denied inside a sandbox by default. The level "
                    "reported is what this device can actually enforce."}


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
