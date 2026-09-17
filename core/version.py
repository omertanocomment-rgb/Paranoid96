"""One place that knows what build this is.

The version used to be written out by hand in six files -- pyproject, the
gradle config, package.json, the packaging scripts and the PDF generator. Six
copies of one fact is how a stale artifact goes unnoticed: you rebuild, one of
the six does not move, and nothing in the running app contradicts you. So the
version now lives in pyproject.toml alone and everything else derives it.

At build time `scripts/stamp_build.py` writes `core/build_stamp.json` next to
this file, recording the commit and the build time. That file is what makes an
installed copy self-identifying: an APK on a phone has no pyproject and no git
checkout, so without a stamp there is no way to tell which build is running
short of diffing it. `/api/version` serves this, and the UI shows it.

Resolution order, most to least trustworthy:
  1. core/build_stamp.json   -- written by the build that produced this copy
  2. pyproject.toml          -- a source checkout
  3. omerta_agent.__version__ -- an installed wheel
  4. "0.0.0+unknown"         -- say so rather than invent a number
"""
import json
import os
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAMP = HERE / "build_stamp.json"
FALLBACK = "0.0.0+unknown"


def _from_stamp():
    try:
        data = json.loads(STAMP.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("version") else None


def _from_pyproject():
    for root in (HERE.parent, HERE.parent.parent):
        f = root / "pyproject.toml"
        try:
            m = re.search(r'^version\s*=\s*"([^"]+)"',
                          f.read_text(encoding="utf-8"), re.M)
        except OSError:
            continue
        if m:
            return m.group(1)
    return None


def _from_package():
    try:
        from omerta_agent import __version__
        return __version__
    except Exception:
        return None


_stamp = _from_stamp() or {}
VERSION = (_stamp.get("version") or _from_pyproject()
           or _from_package() or FALLBACK)

#: What produced this copy. Empty values mean "not stamped", never a guess.
BUILD = {
    "version": VERSION,
    "commit": _stamp.get("commit", ""),
    "built_at": _stamp.get("built_at", ""),
    "channel": _stamp.get("channel", ""),
    "stamped": bool(_stamp),
}


def version_code():
    """A monotonic integer for Android, derived from the version string.

    1.2.0 -> 10200. Android refuses to install an APK whose versionCode is
    lower than the installed one, so this must only ever go up; deriving it
    from the version means it moves exactly when the version does.
    """
    parts = re.findall(r"\d+", VERSION)[:3]
    while len(parts) < 3:
        parts.append("0")
    major, minor, patch = (int(p) for p in parts)
    return major * 10000 + minor * 100 + patch


def describe():
    """A one-line human-readable build identity."""
    out = f"OMERTA AI {VERSION}"
    if BUILD["commit"]:
        out += f" ({BUILD['commit'][:8]})"
    if BUILD["built_at"]:
        out += f" built {BUILD['built_at']}"
    if not BUILD["stamped"]:
        out += " [unstamped source tree]"
    return out


def info():
    """The dict served over /api/version."""
    d = dict(BUILD)
    d["version_code"] = version_code()
    d["describe"] = describe()
    d["platform"] = "android" if os.environ.get("OMERTA_ANDROID") else "desktop"
    return d


if __name__ == "__main__":
    print(describe())
