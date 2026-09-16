"""Ollama local provider — offline, unlimited."""
import requests
from .base import ProviderError


def reachable(spec):
    try:
        requests.get(spec["base_url"].rstrip("/") + "/api/tags", timeout=2)
        return True
    except requests.RequestException:
        return False


def list_models(spec):
    try:
        r = requests.get(spec["base_url"].rstrip("/") + "/api/tags", timeout=5)
        return [m["name"] for m in r.json().get("models", [])]
    except requests.RequestException:
        return []


def chat(spec, messages, system="", max_tokens=4096, stream_cb=None):
    payload = {
        "model": spec["model"],
        "messages": ([{"role": "system", "content": system}] if system else []) + messages,
        "stream": False,
        "options": {"num_predict": max_tokens},
    }
    try:
        r = requests.post(spec["base_url"].rstrip("/") + "/api/chat",
                          json=payload, timeout=600)
        r.raise_for_status()
        return r.json()["message"]["content"]
    except (requests.RequestException, KeyError, ValueError) as e:
        raise ProviderError(f"ollama call failed: {e}")
