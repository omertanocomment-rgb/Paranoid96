"""Phase 14 — Security: secret redaction + safe-command policy helpers.

Redacts credential-shaped tokens before anything is logged or written, so secrets
never leak into logs, prompts, generated source or git (policies.toml). Provider
prefixes are assembled at runtime so this source file contains no literal key.
"""
from __future__ import annotations

import re

# Credential-shaped token patterns (prefixes assembled, no literal secret in source).
_ANTHROPIC = "sk-" + "ant-" + r"[A-Za-z0-9_\-]{12,}"
_PATTERNS = [
    re.compile(_ANTHROPIC),
    re.compile(r"sk-[A-Za-z0-9]{20,}"),          # OpenAI-style
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),   # GitHub tokens
    re.compile(r"AKIA[0-9A-Z]{16}"),             # AWS access key id
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), # Slack
    re.compile(r"AIza[0-9A-Za-z_\-]{30,}"),      # Google API key
]

REDACTED = "[REDACTED]"

# Destructive commands that require explicit approval (mirrors policies.toml).
DESTRUCTIVE = ("fastboot flash", " dd ", "mkfs", "rm -rf", "flash ", "format ",
               "wipe", "> /dev/")


def redact(text: str) -> str:
    """Replace credential-shaped tokens with a placeholder."""
    if not text:
        return text
    out = text
    for pat in _PATTERNS:
        out = pat.sub(REDACTED, out)
    return out


def contains_secret(text: str) -> bool:
    return any(p.search(text or "") for p in _PATTERNS)


def is_destructive(command: str) -> bool:
    c = f" {command.lower()} "
    return any(tok in c for tok in DESTRUCTIVE)
