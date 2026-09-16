"""Phase 4 — Model provider abstraction."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional


@dataclass
class Message:
    role: str   # user | assistant | system
    content: str


@dataclass
class Completion:
    text: str
    model: str
    stop_reason: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    provider: str = ""


class Provider:
    """Base provider interface. Adapters implement complete()/stream()."""
    name = "base"

    def available(self) -> tuple[bool, str]:
        """Return (ok, reason). Adapters check credentials/reachability."""
        return False, "not implemented"

    def complete(self, messages: list[Message], model: str, system: str = "",
                 effort: str = "high", max_tokens: int = 8192) -> Completion:
        raise NotImplementedError

    def stream(self, messages: list[Message], model: str, system: str = "",
               effort: str = "high", max_tokens: int = 16000) -> Iterable[str]:
        # Default: fall back to a single complete() call.
        yield self.complete(messages, model, system, effort, max_tokens).text
