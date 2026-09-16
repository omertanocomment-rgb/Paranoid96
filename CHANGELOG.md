# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/);
this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-09-16

Self-contained mobile app and a normal, dependency-free backend.

### Added
- **Embedded Android backend — no Termux.** Chaquopy bundles CPython 3.11 +
  pure-Python deps into the APK; a foreground service runs the agent in-process
  and the WebView loads it on loopback (`android-native/`).
- **`core/httpd.py`** — stdlib-only HTTP server (no FastAPI/uvicorn/pydantic,
  nothing to install). Chat is a plain `POST /api/chat` request/response — no
  websocket. It is what the APK runs and a drop-in `omerta serve` fallback.
- **`core/api.py`** — one request layer shared by every front-end, so there is
  exactly one approval gate and one wire protocol.
- **Offline / Online / Auto mode** switch (`/api/mode`, UI toggle): offline
  never touches the network, online uses cloud APIs, auto switches on its own.
- **Unlimited chats** — no message cap; conversation history is compacted to a
  bounded context window so endless sessions never overflow the model.
- On-device **API-key / local-host storage** (`secrets.json`, `0600`) via a
  loopback-only, opt-in secret API surfaced in the web UI.
- **Firmware bring-up tooling** (`plugins/firmware_bringup.py`): a pure-Python
  DTB/FDT parser (`analyze_dtb`, no `dtc` needed), evidence→BOARD REPORT
  (`board_report`), and a read-only adb evidence plan — every field tagged
  CONFIRMED/LIKELY/INFERRED/UNKNOWN, never guessed. `tests/test_firmware.py`.
- **`firmware-bringup` skill** and a **TCL T509K starter device tree**
  (`firmware/t509k/`): AOSP makefiles, discovery-only DTS, evidence/build
  scripts, hardware/firmware/kernel KB, and a device constitution.
- **New `omerta` verbs** (`core/commands.py`): `firmware`, `teach`, `memory`,
  `forget`, `rules`, `index`, `search` — built on the existing memory/importer/
  plugin systems.
- **`OMERTA.md`** project constitution and **`docs/OMERTA_AI_SPEC.md`** — an
  honest spec→implementation map (Implemented / Partial / Planned).
- `docs/AUDIT.md` — security & correctness audit; `tests/test_httpd.py` and
  `tests/test_mode_history.py`.

### Fixed
- `tools/importers.py` used a PEP 701 nested-quote f-string that failed to
  import on Python 3.9–3.11 (the supported range); rewritten portably.
- Per-project dispatch lock and a POST-body size cap in the embedded server.

### Changed
- `server.py` refactored onto `core/api.py`; websocket route removed in favor
  of `POST /api/chat`. The Android app no longer uses Termux or `RUN_COMMAND`.

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
