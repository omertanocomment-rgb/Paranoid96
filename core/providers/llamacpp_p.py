"""Raw llama.cpp server provider — offline, unlimited."""
import requests
from .base import ProviderError


def reachable(spec):
    try:
        requests.get(spec["base_url"].rstrip("/") + "/health", timeout=2)
        return True
    except requests.RequestException:
        return False


def chat(spec, messages, system="", max_tokens=4096, stream_cb=None):
    prompt = (system + "\n\n") if system else ""
    for m in messages:
        prompt += f"<|{m['role']}|>\n{m['content']}\n"
    prompt += "<|assistant|>\n"
    try:
        r = requests.post(spec["base_url"].rstrip("/") + "/completion",
                          json={"prompt": prompt, "n_predict": max_tokens,
                                "temperature": 0.4, "stop": ["<|user|>"]},
                          timeout=600)
        r.raise_for_status()
        return r.json().get("content", "")
    except (requests.RequestException, ValueError) as e:
        raise ProviderError(f"llama.cpp call failed: {e}")
