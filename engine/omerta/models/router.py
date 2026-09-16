"""Phase 4 — Model router.

Selects a provider/model by task category, availability and config. Keeps OMERTA
independent of a single vendor. OpenAI/local adapters are declared but report
unavailable until configured, so the router degrades honestly.
"""
from __future__ import annotations

from ..config import Config, provider_key
from .anthropic_provider import AnthropicProvider
from .base import Provider

# Task categories from the spec (Phase 4).
CATEGORIES = (
    "planning", "coding", "large-context", "debugging", "review",
    "documentation", "local", "utility",
)


class _Unavailable(Provider):
    def __init__(self, name: str, reason: str):
        self.name = name
        self._reason = reason

    def available(self):
        return False, self._reason


class Router:
    def __init__(self, config: Config | None = None):
        self.config = config or Config.load()
        self._providers: dict[str, Provider] = {
            "anthropic": AnthropicProvider(provider_key("anthropic")),
            "openai": _Unavailable("openai", "OpenAI adapter not configured (set OPENAI_API_KEY)"),
            "local": _Unavailable("local", "No local inference backend configured"),
        }

    def provider(self, name: str | None = None) -> Provider:
        return self._providers.get(name or self.config.default_provider,
                                   self._providers["anthropic"])

    def model_for(self, category: str) -> str:
        # A single strong default; categories can be tuned later without API churn.
        return self.config.default_model

    def status(self) -> list[tuple[str, bool, str]]:
        out = []
        for name, p in self._providers.items():
            ok, reason = p.available()
            out.append((name, ok, reason))
        return out
