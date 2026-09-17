#!/usr/bin/env python3
"""Propagate pyproject's version into the files that cannot read it themselves.

Gradle, the PDF generator and the packaging scripts all read pyproject.toml
directly. package.json cannot -- electron-builder reads it as data before any
of our code runs -- so its version has to be written in. This writes it, and
verifies the rest, so "the version" stays one fact with one owner.

Run before any packaging step. Exits non-zero if something is out of step and
--check was passed, so a build can refuse to ship a mislabelled artifact.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def version():
    m = re.search(r'^version\s*=\s*"([^"]+)"',
                  (ROOT / "pyproject.toml").read_text(encoding="utf-8"), re.M)
    if not m:
        sys.exit("pyproject.toml has no version")
    return m.group(1)


def sync_package_json(ver, check):
    f = ROOT / "desktop" / "package.json"
    if not f.exists():
        return []
    raw = f.read_text(encoding="utf-8")
    data = json.loads(raw)
    if data.get("version") == ver:
        return []
    if check:
        return [f"{f.relative_to(ROOT)}: {data.get('version')} != {ver}"]
    # Rewrite the one line rather than re-serialising: dumping the whole file
    # would reformat it and bury the real change in whitespace noise.
    new = re.sub(r'("version"\s*:\s*)"[^"]+"', rf'\1"{ver}"', raw, count=1)
    f.write_text(new, encoding="utf-8")
    print(f"  desktop/package.json -> {ver}")
    return []


def verify_no_literals(ver):
    """Catch a hardcoded version that crept back into a build input."""
    stale = []
    watched = ["android-native/app/build.gradle", "scripts/_stage_package.sh",
               "scripts/gen_pdf.py", "packaging/build-deb.sh"]
    for rel in watched:
        f = ROOT / rel
        if not f.exists():
            continue
        text = f.read_text(encoding="utf-8")
        for m in re.finditer(r'"(\d+\.\d+\.\d+)"', text):
            if m.group(1) != ver and "fallback" not in text[max(0, m.start() - 80):m.start()].lower():
                stale.append(f"{rel}: hardcoded {m.group(1)}")
    return stale


def main():
    check = "--check" in sys.argv
    ver = version()
    print(f"version {ver}")
    problems = sync_package_json(ver, check)
    problems += verify_no_literals(ver)
    if problems:
        for p in problems:
            print(f"  ! {p}")
        if check:
            return 1
    print("  version is consistent" if not problems else "  (warnings above)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
