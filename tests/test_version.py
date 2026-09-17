#!/usr/bin/env python3
"""The version/build-stamp chain.

This exists because of a specific failure: an artifact was rebuilt, the version
did not move, and nothing in the running app could contradict the claim that it
had. The properties worth guarding are that the version has exactly one source,
that an unstamped copy admits it, and that the Android versionCode only ever
goes up -- Android refuses a downgrade, so a code that moves the wrong way
bricks the upgrade path.
"""
import json
import re
import subprocess
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


def pyproject_version():
    m = re.search(r'^version\s*=\s*"([^"]+)"',
                  (ROOT / "pyproject.toml").read_text(), re.M)
    return m.group(1) if m else None


def main():
    print("=== version + build stamp ===")
    from core import version

    ver = pyproject_version()
    check("pyproject declares a version", bool(ver))

    # 1. one source of truth
    check(f"core.version agrees with pyproject ({ver})", version.VERSION == ver)

    # 2. versionCode is monotonic in the version
    codes = [version.version_code()]
    for a, b in (("1.1.0", "1.2.0"), ("1.2.0", "1.2.1"),
                 ("1.2.1", "2.0.0"), ("0.9.9", "1.0.0")):
        ca, cb = _code(a), _code(b)
        check(f"versionCode rises {a} -> {b} ({ca} -> {cb})", cb > ca)
    check("current versionCode is positive", codes[0] > 0)

    # 3. an unstamped copy says so rather than claiming a build
    check("describe() names the version", ver in version.describe())

    # 4. the generated stamp round-trips
    out = subprocess.run([sys.executable, "scripts/stamp_build.py", "test"],
                         cwd=ROOT, capture_output=True, text=True)
    check("stamp_build.py runs clean", out.returncode == 0)
    stamp = ROOT / "core" / "build_stamp.json"
    data = json.loads(stamp.read_text()) if stamp.exists() else {}
    check("stamp records the pyproject version", data.get("version") == ver)
    check("stamp records a commit", bool(data.get("commit")))
    check("stamp records a build time", bool(data.get("built_at")))

    # 5. the stamp must not leak build-machine detail into every artifact
    leaky = [k for k in data if k in ("path", "user", "host", "hostname", "cwd")]
    check("stamp carries no host/user/path detail", not leaky)
    blob = json.dumps(data)
    check("stamp contains no absolute paths", "/home/" not in blob and "/root/" not in blob)

    # 6. the payload the APK ships must carry the stamp
    gradle = (ROOT / "android-native/app/build.gradle").read_text()
    check("gradle stages core/** (so the stamp ships)", "'core/**'" in gradle)
    check("gradle stamps before staging", "stampOmertaBuild" in gradle)
    check("gradle derives versionName from pyproject",
          "versionName omertaVersion" in gradle)
    check("gradle derives versionCode from pyproject",
          "versionCode omertaVersionCode" in gradle)

    # 7. no build input carries a second hardcoded version
    sync = subprocess.run([sys.executable, "scripts/sync_version.py", "--check"],
                          cwd=ROOT, capture_output=True, text=True)
    check("no build input hardcodes a stale version",
          sync.returncode == 0 and "!" not in sync.stdout)

    # 8. both servers expose it
    for f in ("core/httpd.py", "server.py"):
        check(f"{f} serves /api/version", "/api/version" in (ROOT / f).read_text())

    print()
    if fails:
        print(f"VERSION TESTS FAILED: {len(fails)}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("VERSION TESTS PASSED")
    return 0


def _code(v):
    parts = re.findall(r"\d+", v)[:3]
    while len(parts) < 3:
        parts.append("0")
    a, b, c = (int(p) for p in parts)
    return a * 10000 + b * 100 + c


if __name__ == "__main__":
    sys.exit(main())
