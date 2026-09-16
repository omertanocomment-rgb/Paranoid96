# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/);
this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-09-16

First complete release.

### Added
- Agent core with model-agnostic ReAct tool loop (`core/agent.py`)
- Always-ask approval gate enforced in control flow, with `[ RUN | EDIT | REFUSE ]`
- Nine model providers: Claude, Claude Opus, OpenAI, OpenRouter, Groq, Gemini,
  Ollama, llama.cpp, LM Studio — auto-routing with offline fallback
- Anthropic provider works without the SDK (pure `requests`), so Termux needs
  no Rust toolchain for `pydantic-core`
- Persistent memory with preference learning from approvals/denials/edits
- Cross-device sync: LAN peer and shared-folder transports, tombstoned
  deletions, idempotent merges
- Token auth for the network server, hardened against `X-Forwarded-For`
  loopback spoofing
- Tolerant tool-call parser for small local models (16 malformed-output cases)
- Compact prompt mode (~90% token reduction) for low-RAM devices
- Skills (8), plugins (5), MCP connectors (7 presets)
- Android APK (WebView shell, auto-starts backend via Termux RUN_COMMAND)
- Electron desktop app, PyInstaller standalone binary, pip wheel
- Six test suites: approval, tool parsing, integration, flash gating, auth, sync

### Security
- Hard-deny list that cannot be approved
- Automatic file backups before any mutation
- Full audit log of every proposal and decision
