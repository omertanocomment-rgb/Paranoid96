"""Project Constitution (OMERTA.md) loader — Phase 2 / section 20."""
from __future__ import annotations

from pathlib import Path

TEMPLATE = """# OMERTA AI Project Constitution

## Mission
Build reliable software, applications and firmware through evidence-backed engineering.

## Default behavior
Direct. Technical. Concise. No filler.

## Engineering
Inspect before modifying. Build after meaningful changes. Test before claiming success.
Record failures. Never invent missing hardware or source information.

## Sandbox
Execute builds/tests in the sandbox by default.

## Git
Protect user changes. Use branches/snapshots for risky work.

## Learning
Only explicit teachings and verified project facts become durable project rules.

## Firmware
Never flash hardware automatically. Require explicit authorization for physical-device writes.

## Evidence
No evidence = UNKNOWN.
"""


def find(start: Path | None = None) -> Path | None:
    p = (start or Path.cwd()).resolve()
    for d in [p, *p.parents]:
        cand = d / "OMERTA.md"
        if cand.exists():
            return cand
    return None


def init(directory: Path | None = None, force: bool = False) -> Path:
    path = (directory or Path.cwd()) / "OMERTA.md"
    if path.exists() and not force:
        return path
    path.write_text(TEMPLATE)
    return path


def load(start: Path | None = None) -> str:
    path = find(start)
    return path.read_text() if path else ""
