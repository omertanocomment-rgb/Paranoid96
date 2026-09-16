"""Phase 12 — Evidence engine.

Every claim OMERTA makes carries an evidence level. A green model response is
NOT evidence; only observed/verified results are CONFIRMED.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import time


class Evidence(str, Enum):
    CONFIRMED = "CONFIRMED"   # directly observed / verified
    LIKELY = "LIKELY"         # strong interpretation
    INFERRED = "INFERRED"     # model / tool inference
    UNKNOWN = "UNKNOWN"       # insufficient evidence

    def tag(self) -> str:
        return f"[{self.value}]"


@dataclass
class EvidenceRecord:
    """A single observed fact with provenance."""
    claim: str
    level: Evidence
    source: str = "omerta"
    detail: str = ""
    ts: float = field(default_factory=time.time)

    def render(self) -> str:
        line = f"{self.level.tag()} {self.claim}"
        if self.detail:
            line += f"\n    ↳ {self.detail}"
        return line


def confirmed(claim: str, **kw) -> EvidenceRecord:
    return EvidenceRecord(claim, Evidence.CONFIRMED, **kw)


def unknown(claim: str, **kw) -> EvidenceRecord:
    return EvidenceRecord(claim, Evidence.UNKNOWN, **kw)
