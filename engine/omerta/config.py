"""Phase 2 — Configuration.

Config lives in ~/.config/omerta/ (overridable via $OMERTA_HOME). Reads TOML with
the stdlib tomllib; writes with a minimal, dependency-free TOML serializer that
covers our flat-table schema. Secrets are read from the environment, never stored.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

try:
    import tomllib  # py3.11+
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None  # type: ignore


def home_dir() -> Path:
    base = os.environ.get("OMERTA_HOME")
    if base:
        return Path(base).expanduser()
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "omerta"


DEFAULT_MODEL = "claude-opus-5"
DEFAULT_EFFORT = "high"


@dataclass
class Config:
    default_provider: str = "anthropic"
    default_model: str = DEFAULT_MODEL
    effort: str = DEFAULT_EFFORT
    sandbox_backend: str = "auto"          # auto|docker|podman|bubblewrap|none
    sandbox_network: str = "deny"          # deny|allow
    approval_required: bool = True          # approve destructive/host ops
    web_host: str = "127.0.0.1"
    web_port: int = 8787

    # ---- persistence ----
    @classmethod
    def load(cls) -> "Config":
        path = home_dir() / "config.toml"
        if path.exists() and tomllib is not None:
            with open(path, "rb") as fh:
                data = tomllib.load(fh)
            core = data.get("core", {})
            sb = data.get("sandbox", {})
            web = data.get("web", {})
            return cls(
                default_provider=core.get("default_provider", cls.default_provider),
                default_model=core.get("default_model", cls.default_model),
                effort=core.get("effort", cls.effort),
                sandbox_backend=sb.get("backend", cls.sandbox_backend),
                sandbox_network=sb.get("network", cls.sandbox_network),
                approval_required=sb.get("approval_required", cls.approval_required),
                web_host=web.get("host", cls.web_host),
                web_port=int(web.get("port", cls.web_port)),
            )
        return cls()

    def save(self) -> Path:
        d = home_dir()
        d.mkdir(parents=True, exist_ok=True)
        (d / "logs").mkdir(exist_ok=True)
        path = d / "config.toml"
        path.write_text(self._to_toml())
        return path

    def _to_toml(self) -> str:
        def val(v: Any) -> str:
            if isinstance(v, bool):
                return "true" if v else "false"
            if isinstance(v, (int, float)):
                return str(v)
            return f'"{v}"'
        return (
            "# OMERTA AI configuration\n"
            "[core]\n"
            f'default_provider = {val(self.default_provider)}\n'
            f'default_model = {val(self.default_model)}\n'
            f'effort = {val(self.effort)}\n\n'
            "[sandbox]\n"
            f'backend = {val(self.sandbox_backend)}\n'
            f'network = {val(self.sandbox_network)}\n'
            f'approval_required = {val(self.approval_required)}\n\n'
            "[web]\n"
            f'host = {val(self.web_host)}\n'
            f'port = {val(self.web_port)}\n'
        )


# Provider credentials come from the environment only.
PROVIDER_ENV = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
}


def provider_key(provider: str) -> str:
    return os.environ.get(PROVIDER_ENV.get(provider, ""), "")
