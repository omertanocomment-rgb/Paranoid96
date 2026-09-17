#!/usr/bin/env python3
"""The bundled command-line toolset.

The device-side half of this cannot be tested here -- the binary is aarch64 and
Android's execution rules only exist on Android. What IS testable, and worth
testing, is everything around it: that the applet list comes from the binary
rather than a list that can drift, that applets which would shadow `su` or the
shell are never linked, that a stale farm left by a previous install is
repaired rather than trusted, and that a missing toolset degrades to a working
terminal instead of an exception.
"""
import os
import stat
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

fails = []


def check(label, cond):
    print(f"  {'✓' if cond else '✗'} {label}")
    if not cond:
        fails.append(label)


# Behaves like BusyBox in the one way that matters here: it dispatches on
# argv[0] and refuses to do anything when invoked by its packaged name. A fake
# that ignored argv[0] hid a real bug -- the installer queried the binary
# directly as libbusybox.so, which the real BusyBox answers with "applet not
# found" for every argument, including --list.
FAKE = """#!/bin/sh
self=$(basename "$0")
case "$self" in
  busybox) ;;
  *) echo "$self: applet not found"; exit 1 ;;
esac
if [ "$1" = "--list" ]; then
  printf '%s\\n' wget tar sed awk unzip vi less su sh ash login init reboot ls
  exit 0
fi
echo "BusyBox v9.9.9 (fake) multi-call binary."
"""


def main():
    print("=== bundled toolset ===")
    from core import toolbox

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        libdir = tmp / "lib"
        libdir.mkdir()
        binary = libdir / toolbox.LIB_NAME
        binary.write_text(FAKE)
        binary.chmod(binary.stat().st_mode | stat.S_IEXEC)
        os.environ["OMERTA_NATIVE_LIB_DIR"] = str(libdir)

        data = tmp / "data"
        bin_dir = toolbox.install(str(data))
        check("install() returns a bin dir", bool(bin_dir))
        bd = Path(bin_dir) if bin_dir else tmp / "nope"

        # the useful applets are there, as symlinks to the one binary
        for name in ("wget", "tar", "sed", "awk", "unzip", "vi", "less"):
            link = bd / name
            ok = link.is_symlink() and os.readlink(link) == str(binary)
            check(f"{name} links to the binary", ok)

        # the ones that would shadow something that matters are not
        for name in ("su", "sh", "ash", "login", "init", "reboot"):
            check(f"{name} is NOT linked", not (bd / name).exists())

        # the list came from the binary: 'ls' was in its output, so it is here,
        # and nothing appears that the binary never claimed
        check("applet list comes from the binary", (bd / "ls").is_symlink())
        # The bootstrap link must exist: it is the only argv[0] the binary
        # answers questions on.
        check("busybox bootstrap link is created", (bd / "busybox").is_symlink())
        extra = {p.name for p in bd.iterdir()} - {
            "wget", "tar", "sed", "awk", "unzip", "vi", "less", "ls", "busybox"}
        check("no applet invented by the installer", not extra)

        # a stale farm from a previous install must be repaired, not trusted:
        # after an app update the old target is gone and the link still looks fine
        (bd / "wget").unlink()
        (bd / "wget").symlink_to(tmp / "gone" / "libbusybox.so")
        check("stale link is detected as dangling", not (bd / "wget").exists())
        toolbox.install(str(data))
        check("stale link is repaired on reinstall",
              os.readlink(bd / "wget") == str(binary))

        # PATH handling
        path = toolbox.path_with_tools("/system/bin:/system/xbin")
        check("tools come first on PATH", path.split(os.pathsep)[0] == str(bd))
        check("original PATH is preserved", "/system/bin" in path)
        twice = toolbox.path_with_tools(path)
        check("re-applying PATH does not duplicate",
              twice.split(os.pathsep).count(str(bd)) == 1)

        st = toolbox.stats()
        check("stats reports available", st["available"] is True)
        check("stats counts the links", st["count"] == 8)
        check("TOOLS.txt is written", (Path(str(bd)).parent / "TOOLS.txt").exists())
        check("summary is a one-liner", "\n" not in toolbox.summary())

    # no binary at all -> honest, and never an exception
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["OMERTA_NATIVE_LIB_DIR"] = str(Path(tmp) / "absent")
        for mod in [m for m in list(sys.modules) if m.startswith("core")]:
            del sys.modules[mod]
        from core import toolbox as t2
        try:
            got = t2.install(tmp)
            check("missing binary returns None", got is None)
            check("missing binary explains itself", bool(t2.stats()["reason"]))
            check("missing binary leaves PATH usable",
                  t2.path_with_tools("/system/bin") == "/system/bin")
            check("summary says unavailable", "unavailable" in t2.summary())
        except Exception as e:  # noqa: BLE001
            check(f"missing binary must not raise (got {type(e).__name__})", False)

    os.environ.pop("OMERTA_NATIVE_LIB_DIR", None)
    print()
    if fails:
        print(f"TOOLBOX TESTS FAILED: {len(fails)}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("TOOLBOX TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
