"""A real command-line toolset inside the app.

Android gives an app a very thin userland: `/system/bin` is toybox, and it is
missing most of what a terminal is actually for -- no wget, no tar that can
write, no awk, no vi, no less, no unzip. So OMERTA ships its own: a static
aarch64 BusyBox, 305 applets, about 1 MB.

WHERE IT HAS TO LIVE, AND WHY
-----------------------------
You cannot simply drop a binary in the app's data directory and run it. Since
Android 10 (API 29) SELinux denies execve() on any file in an app's writable
home, which is why "just download busybox" does not work and why Termux ships
its binaries the way it does. The one directory an app may execute from is the
native library directory, which the package installer unpacks from the APK and
mounts read-only. So BusyBox is packaged as `libbusybox.so` under jniLibs, and
`extractNativeLibs` is on so it lands as a real file rather than staying
compressed inside the APK.

BusyBox decides which applet to run from argv[0], so a directory of symlinks
named `wget`, `tar`, `awk`... all pointing at that one binary gives real
commands with real names. The symlinks live in the data dir, which is fine:
execve resolves the link and checks the target, and the target is executable.

WHAT IS DELIBERATELY NOT LINKED
-------------------------------
Some applets would shadow something that matters or cannot work unprivileged:

  su, login, passwd    BusyBox's need setuid root. On a rooted phone linking
                       these would shadow the real `su` and break root; on an
                       unrooted one they fail confusingly either way.
  sh, ash              the session's shell is chosen deliberately elsewhere;
                       silently replacing it is not this module's call.
  init, reboot, halt,  need privileges no app has, and the failure mode of
  poweroff,            trying is worse than the command simply not existing.
  switch_root,
  pivot_root

Everything else is linked. The list is read from the binary itself rather than
hardcoded here, so it stays true if the binary is ever replaced.
"""
import os
import subprocess
from pathlib import Path

LIB_NAME = "libbusybox.so"
BIN_DIRNAME = "bin"

#: Applets we do not put on PATH -- see the module docstring.
UNSAFE = {
    "su", "login", "passwd", "sulogin", "vlock",
    "sh", "ash",
    "init", "reboot", "halt", "poweroff", "shutdown",
    "switch_root", "pivot_root", "chroot",
    "insmod", "rmmod", "modprobe", "depmod",
}

_state = {"bin_dir": None, "count": 0, "version": "", "reason": ""}


def _candidates():
    """Where the native library might be, most reliable first."""
    env = os.environ.get("OMERTA_NATIVE_LIB_DIR")
    if env:
        yield Path(env) / LIB_NAME
    # A source checkout or a desktop test run: use the staged copy.
    here = Path(__file__).resolve().parent.parent
    yield here / "android-native/app/src/main/jniLibs/arm64-v8a" / LIB_NAME
    # Last resort: the installer's own layout, if the env var never arrived.
    for pat in ("/data/app/*/lib/arm64/", "/data/app/*/*/lib/arm64/"):
        try:
            for p in Path("/").glob(pat.lstrip("/") + LIB_NAME):
                yield p
        except OSError:
            pass


def locate():
    """The BusyBox binary, or None with the reason recorded."""
    tried = []
    for p in _candidates():
        tried.append(str(p))
        if p.is_file():
            return p
    _state["reason"] = "libbusybox.so not found; looked in: " + ", ".join(tried[:3])
    return None


def _bootstrap_link(binary, bin_dir):
    """A symlink named `busybox`, which is the only way to ask it anything.

    BusyBox picks its applet from argv[0]. Invoked by its packaged path it sees
    argv[0] = "libbusybox.so", which is not an applet, and answers "applet not
    found" to everything -- including --list. So the first link has to exist
    before the binary can be queried about which links to make.
    """
    link = bin_dir / "busybox"
    try:
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(binary)
        return link
    except OSError:
        return None


def _applets(entry):
    """Ask the binary what it can do, rather than trusting a list in here."""
    if entry is None:
        _state["reason"] = "could not create the busybox symlink"
        return []
    try:
        out = subprocess.run([str(entry), "--list"], capture_output=True,
                             text=True, timeout=20)
    except (OSError, subprocess.SubprocessError) as e:
        _state["reason"] = f"could not run {entry}: {e}"
        return []
    if out.returncode != 0:
        _state["reason"] = f"{entry} --list exited {out.returncode}"
        return []
    if "applet not found" in (out.stdout + out.stderr):
        _state["reason"] = f"{entry} did not dispatch on argv[0]"
        return []
    return [a.strip() for a in out.stdout.split() if a.strip()]


def _version(entry):
    if entry is None:
        return ""
    try:
        out = subprocess.run([str(entry)], capture_output=True, text=True,
                             timeout=20)
        first = (out.stdout or out.stderr).splitlines()[0]
        return first.strip()
    except Exception:  # noqa: BLE001
        return ""


def install(data_dir=None):
    """Build (or refresh) the symlink farm. Returns the bin dir, or None.

    Safe to call on every start: relinking is cheap and self-healing if the app
    was updated and the native library moved, which it does on every install.
    """
    binary = locate()
    if binary is None:
        return None

    base = Path(data_dir or os.environ.get("OMERTA_DATA_DIR")
                or os.path.expanduser("~"))
    bin_dir = base / BIN_DIRNAME
    try:
        bin_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        _state["reason"] = f"cannot create {bin_dir}: {e}"
        return None

    entry = _bootstrap_link(binary, bin_dir)
    applets = _applets(entry)
    if not applets:
        return None

    linked = 0
    for name in applets:
        if name in UNSAFE or "/" in name:
            continue
        link = bin_dir / name
        try:
            # Always repoint: after an app update the old target is gone, and a
            # dangling symlink is indistinguishable from a working one until
            # you try to run it.
            if link.is_symlink() or link.exists():
                if link.is_symlink() and os.readlink(link) == str(binary):
                    linked += 1
                    continue
                link.unlink()
            link.symlink_to(binary)
            linked += 1
        except OSError:
            continue

    _state.update(bin_dir=str(bin_dir), count=linked,
                  version=_version(entry), reason="")
    _write_manifest(base, applets, linked)
    return str(bin_dir)


def _write_manifest(base, applets, linked):
    """Leave a readable note of what is here -- `less ../TOOLS.txt` from bin.

    Discoverability matters more than usual on a phone: there is no man page,
    no package manager to ask, and a 300-command toolset you cannot enumerate
    is not much better than no toolset.
    """
    usable = sorted(a for a in applets if a not in UNSAFE)
    skipped = sorted(a for a in applets if a in UNSAFE)
    lines = [
        f"OMERTA toolset — {linked} commands",
        _state["version"] or "busybox",
        "",
        "All of these are on PATH in the terminal. They are one BusyBox binary",
        "reached through symlinks, so they are smaller and a little simpler",
        "than their GNU equivalents; `<command> --help` tells you what each",
        "one actually supports.",
        "",
        "AVAILABLE",
        "---------",
    ]
    for i in range(0, len(usable), 8):
        lines.append("  " + "  ".join(f"{a:<14}" for a in usable[i:i + 8]).rstrip())
    lines += [
        "",
        "NOT LINKED, AND WHY",
        "-------------------",
        "  " + " ".join(skipped),
        "",
        "  su, login, passwd    need setuid root. On a rooted phone linking",
        "                       these would shadow the real /system/bin/su and",
        "                       break root; use that one instead. There is no",
        "                       working `sudo` on an unrooted Android and",
        "                       shipping one that always fails would be worse",
        "                       than not shipping it.",
        "  sh, ash              the session shell is chosen deliberately;",
        "                       run `ash` explicitly if you want BusyBox's.",
        "  init, reboot, halt,  require privileges no app has.",
        "  poweroff, chroot,",
        "  switch_root, insmod",
        "",
        "KNOWN LIMITS",
        "------------",
        "  wget https://...     works, but BusyBox's TLS DOES NOT VALIDATE",
        "                       CERTIFICATES -- it will say so itself. Treat it",
        "                       as unauthenticated transport: fine for fetching",
        "                       something you will checksum, not fine for",
        "                       anything secret. Ask the agent to fetch instead",
        "                       when it matters; it uses Python's TLS, which",
        "                       does validate.",
        "  no python3           the app embeds CPython in-process, not as a",
        "                       separate executable. Use the CODE tab, or ask",
        "                       the agent to run Python for you.",
        "  no adb, no           both need USB host access that Android will not",
        "  libimobiledevice     give an app without the USB Host API and a",
        "                       user-granted device permission, and neither",
        "                       works as a plain command-line binary here.",
        "  no dpkg/apt          there is no Debian root filesystem underneath;",
        "                       `dpkg-deb`-style extraction of a .deb is just",
        "                       `ar` + `tar`, both of which you have.",
        "",
    ]
    try:
        (base / "TOOLS.txt").write_text("\n".join(lines), encoding="utf-8")
    except OSError:
        pass


def bin_dir():
    """The installed bin dir, installing it on first use."""
    return _state["bin_dir"] or install()


def path_with_tools(path=None):
    """PATH with the toolset in front, or the original PATH unchanged.

    In front rather than behind on purpose: where BusyBox and toybox both
    provide a command, BusyBox's is the more complete one, and a terminal that
    silently gives you the weaker `sed` is the sort of thing you only discover
    halfway through a command that matters.
    """
    path = path or os.environ.get("PATH", "/system/bin:/system/xbin")
    d = bin_dir()
    if not d:
        return path
    parts = [p for p in path.split(os.pathsep) if p and p != d]
    return os.pathsep.join([d] + parts)


def stats():
    """What the terminal and /api/status report."""
    return {
        "available": bool(_state["bin_dir"]) and _state["count"] > 0,
        "count": _state["count"],
        "bin": _state["bin_dir"] or "",
        "version": _state["version"],
        "reason": _state["reason"],
    }


def summary():
    """One line for the terminal banner."""
    s = stats()
    if not s["available"]:
        return "toolset unavailable" + (f" ({s['reason']})" if s["reason"] else "")
    ver = s["version"].split(" (")[0] if s["version"] else "busybox"
    return f"{s['count']} tools ({ver})"
