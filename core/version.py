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
  1. pyproject.toml          -- a source checkout, if one is present at all
  2. core/build_stamp.json   -- written by the build that produced this copy
  3. omerta_agent.__version__ -- an installed wheel
  4. "0.0.0+unknown"         -- say so rather than invent a number

A shipped copy has no pyproject, so there the stamp is the only evidence and
rules. Where a checkout DOES exist it outranks the stamp, because a stamp left
behind at the previous number after a version bump is the same stale-artifact
trap in miniature. The stamp is still reported -- flagged stale -- so the
disagreement is visible rather than silently resolved.
"""
import json
import os
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAMP = HERE / "build_stamp.json"
FALLBACK = "0.0.0+unknown"


#: A version has to look like a version. A stamp is a file on disk, so it can
#: arrive truncated, half-written or corrupted by a bad copy -- and every
#: module that imports this one would inherit the crash, including the server's
#: startup path. Anything that fails this check is treated as no stamp at all.
_VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$")


def _clean_version(value):
    """The value if it is a plausible version string, else None."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if _VERSION_RE.match(value) else None


def _clean_text(value, limit=200):
    """A short, single-line string -- never a dict, a number or a novel."""
    if not isinstance(value, str):
        return ""
    return value.replace("\n", " ").replace("\r", " ").strip()[:limit]


def _from_stamp():
    try:
        data = json.loads(STAMP.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not _clean_version(data.get("version")):
        return None
    return data


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
_pyproject = _clean_version(_from_pyproject())

#: A stamp outranks everything in a shipped copy -- an APK has no pyproject and
#: no checkout, so the stamp is the only evidence of what is running. But in a
#: SOURCE TREE the stamp is just residue from the last build, and a stamp left
#: at the old number after a version bump is precisely the stale-artifact trap
#: this module exists to close: the tree says 1.9.1, the running code says
#: 1.9.0, and nothing contradicts either. Where both exist and disagree, the
#: checkout is the newer fact, so it wins and the stamp is marked stale.
_stale_stamp = bool(_pyproject and _stamp.get("version")
                    and _clean_version(_stamp.get("version")) != _pyproject)

VERSION = (_pyproject
           or _clean_version(_stamp.get("version"))
           or _clean_version(_from_package())
           or FALLBACK)

#: What produced this copy. Empty values mean "not stamped", never a guess.
BUILD = {
    "version": VERSION,
    "commit": _clean_text(_stamp.get("commit"), 64),
    "built_at": _clean_text(_stamp.get("built_at"), 40),
    "channel": _clean_text(_stamp.get("channel"), 32),
    "stamped": bool(_stamp) and not _stale_stamp,
    "stale_stamp": _stale_stamp,
}


def version_code():
    """A monotonic integer for Android, derived from the version string.

    1.2.0 -> 10200. Android refuses to install an APK whose versionCode is
    lower than the installed one, so this must only ever go up; deriving it
    from the version means it moves exactly when the version does.
    """
    # Bound each component before int(): Python refuses to convert an integer
    # literal beyond ~4300 digits, and a version string is attacker-adjacent
    # input the moment the stamp file is.
    parts = [p[:6] for p in re.findall(r"\d+", VERSION)[:3]]
    while len(parts) < 3:
        parts.append("0")
    major, minor, patch = (min(int(p), 9999) for p in parts)
    return major * 10000 + minor * 100 + patch


def describe():
    """A one-line human-readable build identity."""
    out = f"OMERTA AI {VERSION}"
    if BUILD["commit"]:
        out += f" ({BUILD['commit'][:8]})"
    if BUILD["built_at"]:
        out += f" built {BUILD['built_at']}"
    if BUILD["stale_stamp"]:
        out += " [source tree ahead of its last build stamp]"
    elif not BUILD["stamped"]:
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
