"""`omerta doctor` — detect required/optional dependencies and provider readiness."""
from __future__ import annotations

import shutil
import sys
from dataclasses import dataclass

from .config import Config
from .models.router import Router
from .sandbox.runner import detect_backend

REQUIRED = ["git"]
OPTIONAL = ["rg", "docker", "podman", "bwrap", "jq", "unzip", "zip", "clang", "gcc",
            "ninja", "sqlite3"]


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


def run() -> list[Check]:
    checks: list[Check] = []
    checks.append(Check("python", True, sys.version.split()[0]))
    # The engine needs the sqlite3 *module* (stdlib), not the CLI binary.
    try:
        import sqlite3  # noqa: F401
        checks.append(Check("sqlite3(module)", True, "stdlib"))
    except Exception as e:  # noqa: BLE001
        checks.append(Check("sqlite3(module)", False, f"MISSING (required): {e}"))
    for t in REQUIRED:
        path = shutil.which(t)
        checks.append(Check(t, path is not None, path or "MISSING (required)"))
    for t in OPTIONAL:
        path = shutil.which(t)
        checks.append(Check(t, path is not None, path or "not installed (optional)"))

    cfg = Config.load()
    backend = detect_backend(cfg.sandbox_backend)
    checks.append(Check("sandbox", backend != "none", f"backend={backend}"))

    for name, ok, reason in Router(cfg).status():
        checks.append(Check(f"provider:{name}", ok, reason))
    return checks


def render(checks: list[Check]) -> str:
    lines = ["OMERTA AI — doctor", "=" * 40]
    for c in checks:
        mark = "OK " if c.ok else "XX "
        lines.append(f"[{mark}] {c.name:<18} {c.detail}")
    required_names = set(REQUIRED) | {"sqlite3(module)", "python"}
    required_ok = all(c.ok for c in checks if c.name in required_names)
    lines.append("=" * 40)
    lines.append("Result: " + ("required dependencies present"
                               if required_ok else "MISSING required dependencies"))
    return "\n".join(lines)
