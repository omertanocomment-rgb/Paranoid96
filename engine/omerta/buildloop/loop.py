"""Phase 11/12 — Build / Test / Debug loop with evidence collection.

Runs a command, records command/env/exit/stdout/stderr/duration/artifact hashes,
and stores a SUCCESS/FAILURE into recovery memory. A green model response is never
treated as evidence — only the recorded run is.
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..evidence import Evidence, EvidenceRecord
from ..memory.db import Memory
from ..sandbox.runner import Sandbox


@dataclass
class BuildEvidence:
    command: list[str]
    exit_code: int
    duration: float
    stdout_tail: str
    stderr_tail: str
    backend: str
    isolated: bool
    artifacts: dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.exit_code == 0

    def evidence(self) -> EvidenceRecord:
        level = Evidence.CONFIRMED if self.ok else Evidence.CONFIRMED  # observed either way
        verdict = "succeeded" if self.ok else f"failed (exit {self.exit_code})"
        return EvidenceRecord(
            claim=f"`{' '.join(self.command)}` {verdict}",
            level=level, source="buildloop",
            detail=f"backend={self.backend} isolated={self.isolated} dur={self.duration:.1f}s",
        )


def _tail(s: str, n: int = 4000) -> str:
    return s[-n:]


class BuildLoop:
    def __init__(self, root: Path | None = None, memory: Memory | None = None):
        self.root = (root or Path.cwd()).resolve()
        self.sandbox = Sandbox(workspace=self.root)
        self.memory = memory

    def run(self, command: list[str], artifacts: list[str] | None = None,
            timeout: int = 1800) -> BuildEvidence:
        res = self.sandbox.run(command, timeout=timeout)
        hashes: dict[str, str] = {}
        for rel in artifacts or []:
            p = self.root / rel
            if p.exists():
                hashes[rel] = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
        ev = BuildEvidence(
            command=command, exit_code=res.exit_code, duration=res.duration,
            stdout_tail=_tail(res.stdout), stderr_tail=_tail(res.stderr),
            backend=res.backend, isolated=res.isolated, artifacts=hashes,
        )
        if self.memory:
            self.memory.record_outcome(
                ev.ok, key=" ".join(command),
                value=("ok" if ev.ok else f"exit {ev.exit_code}: {_tail(res.stderr, 300)}"),
            )
        return ev
