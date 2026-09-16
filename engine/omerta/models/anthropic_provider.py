"""Anthropic Messages API adapter (stdlib only — no external SDK).

Uses the current Messages API surface: adaptive thinking, effort via
output_config, x-api-key + anthropic-version headers. Model IDs are used verbatim
(never date-suffixed). Default model claude-opus-5.
"""
from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from typing import Iterable

from .base import Provider, Message, Completion

API_URL = "https://api.anthropic.com/v1/messages"
MODELS_URL = "https://api.anthropic.com/v1/models"
API_VERSION = "2023-06-01"


class AnthropicProvider(Provider):
    name = "anthropic"

    def __init__(self, api_key: str = ""):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")

    def _headers(self, stream: bool = False) -> dict:
        h = {
            "x-api-key": self.api_key,
            "anthropic-version": API_VERSION,
            "content-type": "application/json",
        }
        if stream:
            h["accept"] = "text/event-stream"
        return h

    def available(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "ANTHROPIC_API_KEY not set"
        try:
            req = urllib.request.Request(MODELS_URL, headers=self._headers(), method="GET")
            with urllib.request.urlopen(req, timeout=15) as resp:
                return (resp.status == 200), f"HTTP {resp.status}"
        except urllib.error.HTTPError as e:
            return False, f"HTTP {e.code}"
        except Exception as e:  # noqa: BLE001
            return False, str(e)

    def _thinking(self, model: str, stream: bool) -> dict:
        if model.startswith("claude-haiku"):
            return {"type": "enabled", "budget_tokens": 2048}
        t = {"type": "adaptive"}
        if stream:
            t["display"] = "summarized"
        return t

    def _body(self, messages: list[Message], model: str, system: str,
              effort: str, max_tokens: int, stream: bool) -> bytes:
        payload: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "thinking": self._thinking(model, stream),
            "output_config": {"effort": effort},
            "messages": [{"role": m.role, "content": m.content}
                         for m in messages if m.role in ("user", "assistant")],
        }
        sys_parts = [m.content for m in messages if m.role == "system"]
        if system:
            sys_parts.insert(0, system)
        if sys_parts:
            payload["system"] = "\n\n".join(sys_parts)
        if stream:
            payload["stream"] = True
        return json.dumps(payload).encode()

    def complete(self, messages, model, system="", effort="high", max_tokens=16000) -> Completion:
        if not self.api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        req = urllib.request.Request(
            API_URL, data=self._body(messages, model, system, effort, max_tokens, False),
            headers=self._headers(), method="POST")
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read().decode())
        text = "".join(b.get("text", "") for b in data.get("content", [])
                       if b.get("type") == "text")
        usage = data.get("usage", {})
        return Completion(
            text=text, model=data.get("model", model),
            stop_reason=data.get("stop_reason"),
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            provider=self.name,
        )

    def stream(self, messages, model, system="", effort="high", max_tokens=16000) -> Iterable[str]:
        if not self.api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        req = urllib.request.Request(
            API_URL, data=self._body(messages, model, system, effort, max_tokens, True),
            headers=self._headers(stream=True), method="POST")
        with urllib.request.urlopen(req, timeout=300) as resp:
            event = ""
            for raw in resp:
                line = raw.decode(errors="replace").rstrip("\n")
                if line.startswith("event:"):
                    event = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    data = line.split(":", 1)[1].strip()
                    if not data:
                        continue
                    try:
                        obj = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if obj.get("type") == "content_block_delta":
                        delta = obj.get("delta", {})
                        if delta.get("type") == "text_delta":
                            yield delta.get("text", "")
                    elif obj.get("type") == "message_stop" or event == "message_stop":
                        return
