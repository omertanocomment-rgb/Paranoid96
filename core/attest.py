"""
Proving the audit log has not been edited.

The log is the only record of what this agent did to a device, and it is a
plain file on that same device -- which means anything that can write to the
device can rewrite history. That is not fixable locally: a signature made with
a key stored beside the log can be forged by whoever can read the key.

So this does the one thing that IS honest. Each export carries a chain: every
entry's digest includes the digest before it, so a line cannot be altered or
removed without breaking every digest after it, and the head digest is
something you can write down somewhere the device cannot reach. Compare the
head against what you wrote down last time and you learn whether the middle
was touched. That is tamper EVIDENCE, not tamper proofing, and it is labelled
as exactly that in the export rather than as "signed".
"""
import hashlib
import hmac
import json
import time

from . import config, memory, sandbox

#: Where the chain head is kept between exports, so a later export can say
#: whether the log it is reading still contains the one it read before.
HEAD_FILE = config.DATA_DIR / "audit_head.json"


def _digest(prev, entry):
    blob = json.dumps(entry, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256((prev + "\n" + blob).encode("utf-8")).hexdigest()


def _device_key():
    """A per-device key. It proves same-device, not same-person."""
    seed = str(memory.device()).encode("utf-8")
    return hashlib.sha256(b"omerta-audit-v1" + seed).digest()


def chain(entries):
    prev = "0" * 64
    out = []
    for e in entries:
        prev = _digest(prev, e)
        out.append({"digest": prev, "entry": e})
    return prev, out


def export(payload=None):
    """The whole audit log, hash-chained, with the previous head to compare."""
    p = payload or {}
    n = int(p.get("n") or 100000)
    entries = sandbox.history(n)
    head, rows = chain(entries)

    previous = None
    try:
        previous = json.loads(HEAD_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = None

    # Continuity: the earlier head must still appear in this chain, or lines
    # before it were changed or removed.
    continuous = None
    if previous and previous.get("head"):
        continuous = any(r["digest"] == previous["head"] for r in rows)

    mac = hmac.new(_device_key(), head.encode("utf-8"), hashlib.sha256).hexdigest()
    out = {
        "status": "ok",
        "exported": time.time(),
        "count": len(rows),
        "head": head,
        "device_mac": mac,
        "device": memory.device(),
        "previous_head": (previous or {}).get("head"),
        "previous_at": (previous or {}).get("at"),
        "continuous": continuous,
        "entries": rows if p.get("full", True) else [],
        "note": "Tamper EVIDENCE, not tamper proofing. The key lives on this "
                "device, so anything that can rewrite the log can also "
                "recompute the chain. Write the head down somewhere this "
                "device cannot reach; comparing it later is what makes this "
                "worth anything.",
    }
    if continuous is False:
        out["warning"] = ("the head recorded at the last export is not in this "
                          "log — entries before it were changed or removed")
    HEAD_FILE.write_text(json.dumps({"head": head, "at": out["exported"]}),
                         encoding="utf-8")
    return out


def verify(payload=None):
    """Re-derive the chain of an export and say whether it holds together."""
    p = payload or {}
    rows = p.get("entries") or []
    if not isinstance(rows, list):
        return {"status": "error", "reason": "entries must be a list"}
    prev = "0" * 64
    for i, row in enumerate(rows):
        entry = row.get("entry") if isinstance(row, dict) else None
        if entry is None:
            return {"status": "error", "reason": f"row {i} has no entry"}
        prev = _digest(prev, entry)
        if row.get("digest") != prev:
            return {"status": "error", "broken_at": i,
                    "reason": f"row {i} does not follow from the one before it"}
    ok = (not p.get("head")) or p["head"] == prev
    return {"status": "ok" if ok else "error", "head": prev,
            "matches_claimed_head": ok,
            "count": len(rows)}


def stats():
    try:
        prev = json.loads(HEAD_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"exported": False}
    return {"exported": True, "head": prev.get("head", "")[:16],
            "at": prev.get("at")}
