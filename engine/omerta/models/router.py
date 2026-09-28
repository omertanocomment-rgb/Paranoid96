"""Phase 4 — Model router.

Selects a provider/model by task category, availability and config. Keeps OMERTA
independent of a single vendor: Anthropic (default), OpenAI, and local Ollama are all
first-class. Models may be given as "provider:model" (e.g. "openai:gpt-4o",
"ollama:llama3.1", "anthropic:claude-opus-5"); a bare id uses the default provider.

Reads ~/.config/omerta/providers.toml when present: [<provider>].enabled /
default_model / host_env, and a [routing] table mapping category -> "provider:model".
"""
from __future__ import annotations

import os

from ..config import Config, provider_key, home_dir
from .anthropic_provider import AnthropicProvider
from .openai_provider import OpenAIProvider
from .ollama_provider import OllamaProvider
from .base import Provider

try:
    import tomllib  # py3.11+
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None  # type: ignore

# Task categories from the spec (Phase 4).
CATEGORIES = (
    "planning", "coding", "large-context", "debugging", "review",
    "documentation", "local", "utility",
)


def _load_providers_toml() -> dict:
    path = home_dir() / "providers.toml"
    if path.exists() and tomllib is not None:
        try:
            with open(path, "rb") as fh:
                return tomllib.load(fh)
        except Exception:  # noqa: BLE001
            return {}
    return {}


class _Disabled(Provider):
    def __init__(self, name: str):
        self.name = name

    def available(self):
        return False, f"{self.name} disabled in providers.toml"


class Router:
    def __init__(self, config: Config | None = None):
        self.config = config or Config.load()
        self._toml = _load_providers_toml()
        self._routing = self._toml.get("routing", {})

        def enabled(name: str) -> bool:
            return bool(self._toml.get(name, {}).get("enabled", True))

        def default_model(name: str, fallback: str) -> str:
            return self._toml.get(name, {}).get("default_model", fallback)

        openai_default = default_model("openai", "gpt-4o")
        ollama_default = default_model("ollama", "llama3.1")

        self._providers: dict[str, Provider] = {
            "anthropic": AnthropicProvider(provider_key("anthropic")) if enabled("anthropic")
                else _Disabled("anthropic"),
            "openai": OpenAIProvider(provider_key("openai"), openai_default) if enabled("openai")
                else _Disabled("openai"),
            "ollama": OllamaProvider(default_model=ollama_default) if enabled("ollama")
                else _Disabled("ollama"),
        }
        # Anthropic default model can be overridden in providers.toml too.
        self._anthropic_default = default_model("anthropic", self.config.default_model)

    def provider(self, name: str | None = None) -> Provider:
        return self._providers.get(name or self.config.default_provider,
                                   self._providers["anthropic"])

    def model_for(self, category: str) -> str:
        """Category routing from providers.toml [routing]; else the config default."""
        routed = self._routing.get(category, "")
        if isinstance(routed, str) and routed.strip():
            return routed.strip()
        return self._anthropic_default if self.config.default_provider == "anthropic" \
            else self.config.default_model

    def resolve(self, spec: str | None) -> tuple[Provider, str]:
        """Turn a model spec into (provider, model). Accepts 'provider:model'."""
        spec = spec or self.model_for("coding")
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
