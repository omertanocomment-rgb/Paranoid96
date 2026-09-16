"""Phase 4 — Model router.

Selects a provider/model by task category, availability and config. Keeps OMERTA
independent of a single vendor: Anthropic (default), OpenAI, and local Ollama are all
first-class. Models may be given as "provider:model" (e.g. "openai:gpt-4o",
"ollama:llama3.1", "anthropic:claude-opus-5"); a bare id uses the default provider.
"""
from __future__ import annotations

from ..config import Config, provider_key
from .anthropic_provider import AnthropicProvider
from .openai_provider import OpenAIProvider
from .ollama_provider import OllamaProvider
from .base import Provider

# Task categories from the spec (Phase 4).
CATEGORIES = (
    "planning", "coding", "large-context", "debugging", "review",
    "documentation", "local", "utility",
)


class Router:
    def __init__(self, config: Config | None = None):
        self.config = config or Config.load()
        self._providers: dict[str, Provider] = {
            "anthropic": AnthropicProvider(provider_key("anthropic")),
            "openai": OpenAIProvider(provider_key("openai")),
            "ollama": OllamaProvider(),
        }

    def provider(self, name: str | None = None) -> Provider:
        return self._providers.get(name or self.config.default_provider,
                                   self._providers["anthropic"])

    def model_for(self, category: str) -> str:
        # A single strong default; categories can be tuned later without API churn.
        return self.config.default_model

    def resolve(self, spec: str | None) -> tuple[Provider, str]:
        """Turn a model spec into (provider, model). Accepts 'provider:model'."""
        spec = spec or self.config.default_model
        if ":" in spec and spec.split(":", 1)[0] in self._providers:
            pname, model = spec.split(":", 1)
            return self._providers[pname], model
        return self.provider(), spec

    def status(self) -> list[tuple[str, bool, str]]:
        out = []
        for name, p in self._providers.items():
            ok, reason = p.available()
            out.append((name, ok, reason))
        return out
