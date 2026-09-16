"""OpenAI Chat Completions adapter (stdlib only).

One of the "different AIs" the router can select. Enabled when OPENAI_API_KEY is set.
Use models via the router as "openai:<model>" (e.g. openai:gpt-4o).
"""
from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from typing import Iterable

from .base import Provider, Message, Completion

API_URL = "https://api.openai.com/v1/chat/completions"
MODELS_URL = "https://api.openai.com/v1/models"


class OpenAIProvider(Provider):
    name = "openai"

    def __init__(self, api_key: str = "", default_model: str = "gpt-4o"):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.default_model = default_model

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "content-type": "application/json"}

    def available(self) -> tuple[bool, str]:
        if not self.api_key:
            return False, "OPENAI_API_KEY not set"
        try:
            req = urllib.request.Request(MODELS_URL, headers=self._headers(), method="GET")
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.status == 200, f"HTTP {resp.status}"
        except urllib.error.HTTPError as e:
            return False, f"HTTP {e.code}"
        except Exception as e:  # noqa: BLE001
            return False, str(e)

    def _payload(self, messages, model, system, stream) -> bytes:
        msgs = ([{"role": "system", "content": system}] if system else []) + \
               [{"role": m.role, "content": m.content} for m in messages
                if m.role in ("user", "assistant", "system")]
        body = {"model": model or self.default_model, "messages": msgs}
        if stream:
            body["stream"] = True
        return json.dumps(body).encode()

    def complete(self, messages, model, system="", effort="high", max_tokens=16000) -> Completion:
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY not set")
        req = urllib.request.Request(API_URL, data=self._payload(messages, model, system, False),
                                     headers=self._headers(), method="POST")
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read().decode())
        text = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        return Completion(text=text, model=data.get("model", model or self.default_model),
                          stop_reason=data["choices"][0].get("finish_reason"),
                          input_tokens=usage.get("prompt_tokens", 0),
                          output_tokens=usage.get("completion_tokens", 0), provider=self.name)

    def stream(self, messages, model, system="", effort="high", max_tokens=16000) -> Iterable[str]:
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY not set")
        req = urllib.request.Request(API_URL, data=self._payload(messages, model, system, True),
                                     headers=self._headers(), method="POST")
        with urllib.request.urlopen(req, timeout=300) as resp:
            for raw in resp:
                line = raw.decode(errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    obj = json.loads(data)
                    delta = obj["choices"][0]["delta"].get("content")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
