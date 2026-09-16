"""
Evidence & confidence — a general facility, not just for firmware.

The constitution says: never guess, and tag every claim with a confidence
(CONFIRMED > LIKELY > INFERRED > UNKNOWN). This module makes that reusable
across all engineering: a standard record shape, a way to combine confidences
(an overall claim is only as strong as its weakest support), and a durable,
per-project evidence log backed by the same memory that syncs across devices.

`plugins/firmware_bringup.py` emits the same record shape; this generalises it.
"""
from . import memory

# low → high
LEVELS = ["UNKNOWN", "INFERRED", "LIKELY", "CONFIRMED"]


def norm(c):
    c = str(c or "").upper()
    return c if c in LEVELS else "UNKNOWN"


def rank(c):
    return LEVELS.index(norm(c))


def record(value, confidence, source="", notes=""):
    """The standard evidence record used everywhere."""
    return {"value": value, "confidence": norm(confidence),
            "source": source, "notes": notes}


def combine(records):
    """Overall confidence of a claim built from several records: the weakest of
    its supports (a chain is as strong as its weakest link). Empty → UNKNOWN."""
    recs = [r for r in records if r]
    if not recs:
        return "UNKNOWN"
    return min((r.get("confidence", "UNKNOWN") for r in recs), key=rank)


class EvidenceLog:
    """Collect records for one claim/report and summarise them."""

    def __init__(self):
        self.records = []

    def add(self, value, confidence, source="", notes=""):
        r = record(value, confidence, source, notes)
        self.records.append(r)
        return r

    def overall(self):
        return combine(self.records)

    def unknown(self):
        return [r for r in self.records if r["confidence"] == "UNKNOWN"]

    def report(self):
        return {"overall": self.overall(),
                "records": self.records,
                "unknown_count": len(self.unknown())}


# ── durable, per-project evidence (memory-backed, syncs across devices) ──────
def note(value, confidence, source="", project="general", notes=""):
    """Persist an evidence record so it survives and syncs. Read-committed into
    the agent's own memory, like remember()."""
    r = record(value, confidence, source, notes)
    memory.remember(
        f"[{r['confidence']}] {value}"
        + (f" — source: {source}" if source else "")
        + (f" — {notes}" if notes else ""),
        project=project, kind="evidence", tags="evidence " + r["confidence"].lower(),
        weight=1.0 + rank(r["confidence"]) * 0.25)
    return r


def log(project=None, top_k=100):
    """Return stored evidence, grouped by confidence (best first)."""
    hits = memory.recall("", project=project, top_k=top_k, kind="evidence")
    groups = {lvl: [] for lvl in reversed(LEVELS)}
    for h in hits:
        content = h["content"]
        lvl = "UNKNOWN"
        if content.startswith("[") and "]" in content:
            cand = content[1:content.index("]")]
            lvl = norm(cand)
        groups.setdefault(lvl, []).append(content)
    return {"project": project or "all", "total": len(hits),
            "by_confidence": {k: v for k, v in groups.items() if v}}
