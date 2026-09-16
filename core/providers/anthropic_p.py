"""
Anthropic / Claude provider.

Uses the official `anthropic` SDK when it's installed, but falls back to
plain `requests` against the same REST endpoint when it isn't. That matters
on Termux: the SDK depends on pydantic -> pydantic-core, which has no
prebuilt Android wheel and needs a Rust toolchain to compile. The API is
just HTTP and JSON, so the fallback is not a degraded path — it's the same
requests, minus a build that can take half an hour on a phone.
"""
import os
import json

import requests

from .base import ProviderError

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"


def _key(spec):
    return os.environ.get(spec.get("api_key_env") or "ANTHROPIC_API_KEY", "")


def reachable(spec):
    return bool(_key(spec))


def _via_sdk(spec, key, messages, system, max_tokens, stream_cb):
    import anthropic
    client = anthropic.Anthropic(api_key=key)
    if stream_cb:
        out = []
        with client.messages.stream(model=spec["model"], max_tokens=max_tokens,
                                    system=system, messages=messages) as s:
            for chunk in s.text_stream:
                out.append(chunk)
                stream_cb(chunk)
        return "".join(out)
    r = client.messages.create(model=spec["model"], max_tokens=max_tokens,
                               system=system, messages=messages, timeout=120.0)
    return "".join(b.text for b in r.content if b.type == "text")


def _via_http(spec, key, messages, system, max_tokens, stream_cb):
    """No SDK needed — pure requests."""
    headers = {"x-api-key": key, "anthropic-version": API_VERSION,
               "content-type": "application/json"}
    payload = {"model": spec["model"], "max_tokens": max_tokens,
               "messages": messages}
    if system:
        payload["system"] = system

    if stream_cb:
        payload["stream"] = True
        out = []
        with requests.post(API_URL, headers=headers, json=payload,
                           timeout=180, stream=True) as r:
            if r.status_code >= 400:
                raise ProviderError(f"HTTP {r.status_code}: {r.text[:300]}")
            for line in r.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data:"):
                    continue
                body = line[5:].strip()
                if body == "[DONE]":
                    break
                try:
                    ev = json.loads(body)
                except json.JSONDecodeError:
                    continue
                if ev.get("type") == "content_block_delta":
                    piece = ev.get("delta", {}).get("text", "")
                    if piece:
                        out.append(piece)
                        stream_cb(piece)
        return "".join(out)

    r = requests.post(API_URL, headers=headers, json=payload, timeout=180)
    if r.status_code >= 400:
        raise ProviderError(f"HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    return "".join(b.get("text", "") for b in data.get("content", [])
                   if b.get("type") == "text")


def chat(spec, messages, system="", max_tokens=4096, stream_cb=None):
    key = _key(spec)
    if not key:
        raise ProviderError(f"no API key in ${spec.get('api_key_env')}")
    try:
        import anthropic  # noqa: F401
        has_sdk = True
    except ImportError:
        has_sdk = False
    try:
        if has_sdk:
            return _via_sdk(spec, key, messages, system, max_tokens, stream_cb)
        return _via_http(spec, key, messages, system, max_tokens, stream_cb)
    except ProviderError:
        raise
    except requests.RequestException as e:
        raise ProviderError(f"anthropic request failed: {e}")
    except Exception as e:  # noqa: BLE001
        raise ProviderError(f"anthropic call failed: {e}")
