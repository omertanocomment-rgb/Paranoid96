"""Local Ollama adapter (stdlib only) — run your own models with no external limits.

Talks to a local Ollama server (default http://localhost:11434). This is the
"base my own / no-limits" provider: everything stays on your machine. Select via the
router as "ollama:<model>" (e.g. ollama:llama3.1).
"""
from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from typing import Iterable

from .base import Provider, Message, Completion


class OllamaProvider(Provider):
    name = "ollama"

    def __init__(self, host: str = "", default_model: str = "llama3.1"):
        self.host = (host or os.environ.get("OLLAMA_HOST", "http://localhost:11434")).rstrip("/")
        self.default_model = os.environ.get("OLLAMA_MODEL", default_model)

    def available(self) -> tuple[bool, str]:
        try:
            with urllib.request.urlopen(f"{self.host}/api/tags", timeout=5) as resp:
                return resp.status == 200, f"{self.host} ({resp.status})"
        except Exception as e:  # noqa: BLE001
            return False, f"no local Ollama at {self.host} ({e})"

    def _payload(self, messages, model, system, stream) -> bytes:
        msgs = ([{"role": "system", "content": system}] if system else []) + \
               [{"role": m.role, "content": m.content} for m in messages
                if m.role in ("user", "assistant", "system")]
        return json.dumps({"model": model or self.default_model, "messages": msgs,
                           "stream": stream}).encode()

    def complete(self, messages, model, system="", effort="high", max_tokens=16000) -> Completion:
        req = urllib.request.Request(f"{self.host}/api/chat",
                                     data=self._payload(messages, model, system, False),
                                     headers={"content-type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read().decode())
        return Completion(text=data.get("message", {}).get("content", ""),
                          model=data.get("model", model or self.default_model),
                          stop_reason="stop" if data.get("done") else None,
                          input_tokens=data.get("prompt_eval_count", 0),
                          output_tokens=data.get("eval_count", 0), provider=self.name)

    def stream(self, messages, model, system="", effort="high", max_tokens=16000) -> Iterable[str]:
        req = urllib.request.Request(f"{self.host}/api/chat",
                                     data=self._payload(messages, model, system, True),
                                     headers={"content-type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=300) as resp:
            for raw in resp:
                line = raw.decode(errors="replace").strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    chunk = obj.get("message", {}).get("content")
                    if chunk:
                        yield chunk
                    if obj.get("done"):
                        return
                except json.JSONDecodeError:
                    continue
