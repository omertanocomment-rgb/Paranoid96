"""Multi-provider model layer. Every provider exposes chat(messages, system) -> str."""
from . import anthropic_p, openai_p, ollama_p, llamacpp_p
from .base import ProviderError

KINDS = {
    "anthropic": anthropic_p.chat,
    "openai": openai_p.chat,
    "ollama": ollama_p.chat,
    "llamacpp": llamacpp_p.chat,
}

REACHABLE = {
    "anthropic": anthropic_p.reachable,
    "openai": openai_p.reachable,
    "ollama": ollama_p.reachable,
    "llamacpp": llamacpp_p.reachable,
}
