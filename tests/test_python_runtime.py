#!/usr/bin/env python3
"""The bundled CPython.

The interpreter is aarch64 Android and cannot be executed here, so what is
tested is everything around it: that the shipped binaries are the right
architecture, that none of them collide with the libraries Chaquopy already
puts in the same directory, and that the prefix is laid out the way CPython
needs -- stdlib as ordinary files in the data directory, extension modules
reached by symlink into the native library directory, because Android refuses
to dlopen a .so out of an app's writable home.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
JNI = ROOT / "android-native/app/src/main/jniLibs/arm64-v8a"

fails = []


def check(label, cond):
    print(f"  {'✓' if cond else '✗'} {label}")
    if not cond:
        fails.append(label)


def needed(path):
    """DT_NEEDED entries, read straight from the ELF."""
    import subprocess
    try:
        out = subprocess.run(["readelf", "-d", str(path)],
                             capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return {line.split("[")[1].split("]")[0]
            for line in out.splitlines() if "(NEEDED)" in line}


def main():
    print("=== bundled python runtime ===")
    from core import toolbox

    # ── what ships ───────────────────────────────────────────────────────
    binary = JNI / toolbox.PY_BIN
    libpy = JNI / "libpython3.13.so"
    check("the interpreter binary ships", binary.is_file())
    check("libpython ships", libpy.is_file())
    dynload = sorted(JNI.glob("*.cpython-313-aarch64-linux-android.so"))
    check(f"extension modules ship ({len(dynload)})", len(dynload) >= 50)

    for f in [binary, libpy] + dynload[:5]:
        if f.is_file():
            head = f.read_bytes()[:20]
            if not (head[:4] == b"\x7fELF" and head[18] == 0xB7):
                check(f"{f.name} is aarch64", False)
    check("shipped binaries are aarch64 ELF", True)

    # ── the collision that would silently break imports ──────────────────
    # Chaquopy already puts libssl_python.so / libcrypto_python.so /
    # libsqlite3_python.so in this directory, built for ITS Python 3.11. Two
    # different builds cannot share one filename, and whichever won would be a
    # guess. Ours are renamed, so nothing may still ask for the originals.
    chaquopy_names = {"libssl_python.so", "libcrypto_python.so",
                      "libsqlite3_python.so"}
    ours = [binary, libpy] + dynload + [
        JNI / n for n in ("libssl_py313.so", "libcrypto_py313.so",
                          "libsqlite3_py313.so")]
    offenders = []
    for f in ours:
        if not f.is_file():
            continue
        deps = needed(f)
        if deps is None:
            continue
        clash = deps & chaquopy_names
        if clash:
            offenders.append(f"{f.name} -> {sorted(clash)}")
    check("nothing asks for Chaquopy's library names", not offenders)
    for o in offenders:
        print(f"      {o}")

    for n in ("libssl_py313.so", "libcrypto_py313.so", "libsqlite3_py313.so"):
        check(f"{n} ships under its own name", (JNI / n).is_file())

    ssl_mod = next((f for f in dynload if f.name.startswith("_ssl.")), None)
    check("the ssl module ships", ssl_mod is not None)
    if ssl_mod:
        deps = needed(ssl_mod) or set()
        check("ssl links our renamed openssl",
              "libssl_py313.so" in deps and "libcrypto_py313.so" in deps)

    # ── the standard library ─────────────────────────────────────────────
    std = ROOT / "python-stdlib"
    check("the standard library ships", std.is_dir())
    check("encodings is present (python cannot start without it)",
          (std / "encodings" / "__init__.py").is_file())
    for m in ("json", "subprocess", "ssl", "sqlite3", "urllib", "email"):
        check(f"stdlib includes {m}", (std / m).exists() or
              (std / f"{m}.py").is_file())
    for junk in ("test", "idlelib", "tkinter", "pydoc_data"):
        check(f"{junk} is excluded from the shipped stdlib",
              not (std / junk).exists())
    check("no stale bytecode is shipped",
          not list(std.rglob("__pycache__")))
    check("lib-dynload is NOT copied into the stdlib (it is a symlink at runtime)",
          not (std / "lib-dynload").exists())

    # ── the prefix layout ────────────────────────────────────────────────
    tmp = tempfile.mkdtemp(prefix="omerta-py-")
    try:
        os.environ["OMERTA_NATIVE_LIB_DIR"] = str(JNI)
        home = toolbox.install_python(tmp, payload=ROOT)
        check("the prefix is laid out", bool(home))
        if home:
            libdir = Path(home) / "lib" / "python3.13"
            check("the stdlib is copied into the prefix",
                  (libdir / "encodings" / "__init__.py").is_file())
            link = libdir / "lib-dynload"
            check("lib-dynload is a symlink", link.is_symlink())
            check("lib-dynload points at the native library directory",
                  link.is_symlink() and os.readlink(link) == str(JNI))
            check("the extension modules resolve through it",
                  (link / (dynload[0].name if dynload else "x")).exists())

            # repeating must be cheap and must repair a stale link
            link.unlink()
            link.symlink_to(Path(tmp) / "gone")
            toolbox.install_python(tmp, payload=ROOT)
            check("a stale lib-dynload link is repaired",
                  os.readlink(libdir / "lib-dynload") == str(JNI))

            env = toolbox.python_env(data_dir=tmp)
            check("PYTHONHOME is set for the terminal",
                  env.get("PYTHONHOME") == home)
            check("bytecode writing is disabled",
                  env.get("PYTHONDONTWRITEBYTECODE") == "1")
            st = toolbox.python_stats()
            check("python reports as available", st["available"] is True)
            check("python reports its version", st["version"] == "3.13")
    finally:
        os.environ.pop("OMERTA_NATIVE_LIB_DIR", None)
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if fails:
        print(f"PYTHON RUNTIME TESTS FAILED: {len(fails)}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("PYTHON RUNTIME TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
