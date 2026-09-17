#!/usr/bin/env python3
"""Stamp this build so the artifact can say what it is.

Run before packaging. Writes core/build_stamp.json, which core/version.py
reads. Without it an installed copy -- an APK especially -- cannot tell you
which build it came from, and "did that actually rebuild?" becomes a question
nobody can answer from the device.

The stamp records only build identity: version, commit, dirty flag, UTC build
time, channel. No paths, no usernames, no hostnames -- this file ships inside
every artifact, and build machines leak details you did not mean to publish.
"""
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAMP = ROOT / "core" / "build_stamp.json"


def git(*args):
    try:
        out = subprocess.run(["git", "-C", str(ROOT), *args],
                             capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.strip() if out.returncode == 0 else ""


def version():
    m = re.search(r'^version\s*=\s*"([^"]+)"',
                  (ROOT / "pyproject.toml").read_text(encoding="utf-8"), re.M)
    if not m:
        sys.exit("pyproject.toml has no version -- refusing to invent one")
    return m.group(1)


def main():
    channel = sys.argv[1] if len(sys.argv) > 1 else "release"
    dirty = bool(git("status", "--porcelain"))
    stamp = {
        "version": version(),
        "commit": git("rev-parse", "HEAD"),
        "dirty": dirty,
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "channel": channel,
    }
    STAMP.write_text(json.dumps(stamp, indent=2) + "\n", encoding="utf-8")
    print(f"stamped {stamp['version']} {stamp['commit'][:8]}"
          f"{' (dirty)' if dirty else ''} {stamp['built_at']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
