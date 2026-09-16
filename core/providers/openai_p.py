"""OpenAI-compatible provider — also serves OpenRouter, Groq, Gemini, LM Studio."""
import os
import requests
from .base import ProviderError


def _key(spec):
    env = spec.get("api_key_env")
    return os.environ.get(env, "") if env else ""


def reachable(spec):
    if spec.get("api_key_env") and not _key(spec):
        return False
    if not spec.get("needs_internet"):   # local OpenAI-compatible server
        try:
            requests.get(spec["base_url"].rstrip("/") + "/models", timeout=2)
            return True
        except requests.RequestException:
            return False
    return True


def chat(spec, messages, system="", max_tokens=4096, stream_cb=None):
    headers = {"Content-Type": "application/json"}
    k = _key(spec)
    if k:
        headers["Authorization"] = f"Bearer {k}"
    elif spec.get("api_key_env"):
        raise ProviderError(f"no API key in ${spec['api_key_env']}")
    payload = {
        "model": spec["model"],
        "messages": ([{"role": "system", "content": system}] if system else []) + messages,
        "max_tokens": max_tokens,
    }
    try:
        r = requests.post(spec["base_url"].rstrip("/") + "/chat/completions",
                          json=payload, headers=headers, timeout=180)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
    except (requests.RequestException, KeyError, ValueError) as e:
        raise ProviderError(f"openai-compatible call failed: {e}")
