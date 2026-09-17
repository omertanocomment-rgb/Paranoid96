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
  DTB/FDT parser (`analyze_dtb`, no `dtc` needed), Android **boot/vendor_boot/
  dtbo image inspection** (`inspect_image`, header v0–v4 + dt_table) with
  embedded-DTB extraction, evidence→BOARD REPORT (`board_report`), and a
  read-only adb evidence plan, plus **extract** (image parts to disk) and
  **repack** of a classic boot image (v0–v2, SHA1 id recomputed) and **vendor_boot**
  (v3/v4: ramdisk/dtb/table/bootconfig), both round-trip tested; plus **super.img unpack** — Android **sparse** decode and **LP (dynamic-partition) metadata** parse/extract (`omerta firmware super`/`unsparse`) and **super repack** (`lpmake`: fresh LP geometry/metadata with valid SHA-256 checksums, `omerta firmware superpack`) — every field tagged CONFIRMED/LIKELY/INFERRED/UNKNOWN, never guessed.
  `tests/test_firmware.py`.
- **`firmware-bringup` skill** and a **TCL T509K starter device tree**
  (`firmware/t509k/`): AOSP makefiles, discovery-only DTS, evidence/build
  scripts, hardware/firmware/kernel KB, and a device constitution.
- **Codebase index** (`core/index.py`): ast-accurate symbols + import graph for
  Python, regex extractors for js/ts/go/rust/jvm/c/shell; `omerta index/search/
  symbol/deps` and a `code_index` plugin. `tests/test_index.py`.
- **Sandbox isolation + snapshots** (`core/isolate.py`): opt-in `ulimit` +
  bubblewrap/firejail wrapping (network denied, key stores never mounted) and
  workspace snapshot/rollback; `omerta sandbox …`. `tests/test_isolate.py`.
- **Engineering roles** (`core/roles.py`): 10 focus profiles that steer the one
  agent; `omerta agent/plan/review/build/test/debug` and `omerta role`.
  `tests/test_roles.py`.
- **Packaging**: `docker/Dockerfile` (OCI), `packaging/build-deb.sh` (built +
  validated), and a **fat AppImage** (`packaging/build-appimage.sh`) that
  carries its own relocatable CPython 3.12 and dependencies — one file, nothing
  to install on the target. It degrades rather than fails: relocatable CPython
  → PyInstaller bundle → host python, and self-acquires `appimagetool`, falling
  back to a self-extracting `.run` on hosts that have neither it nor FUSE. It
  smoke-tests whatever it produced before reporting success. All four paths
  were built and run. Wired into `scripts/build_all.sh`.
- **Evidence & confidence** (`core/evidence.py`, `plugins/evidence_tools.py`): a general CONFIRMED/LIKELY/INFERRED/UNKNOWN facility — shared record shape, weakest-link combine, and a durable per-project evidence log; `omerta evidence`. Firmware tools reuse it. `tests/test_evidence.py`.
- **Multi-agent orchestration** (`core/orchestrator.py`): sequential role pipelines (`omerta workflow plan|analyze|full`) and a **concurrent** role 'team' (`omerta workflow team`) with thread-local role isolation; `tests/test_orchestrator.py`.
- **Git intelligence** (`core/gitx.py`, `plugins/git_tools.py`): read-only structured `status/diff/log/branch/show/review`; mutating git stays behind the approval gate. `omerta git …`; `tests/test_gitx.py`.
- **New `omerta` verbs** (`core/commands.py`): `firmware`, `teach`, `memory`,
  `forget`, `rules`, `index`, `search`, `symbol`, `deps`, `sandbox`, `role`,
  and the agent verbs above — built on the existing memory/importer/plugin/
  index systems.
- **`OMERTA.md`** project constitution and **`docs/OMERTA_AI_SPEC.md`** — an
  honest spec→implementation map (Implemented / Partial / Planned).
- `docs/AUDIT.md` — security & correctness audit; `tests/test_httpd.py` and
  `tests/test_mode_history.py`.

### Fixed
- `tools/importers.py` used a PEP 701 nested-quote f-string that failed to
  import on Python 3.9–3.11 (the supported range); rewritten portably.
- Per-project dispatch lock and a POST-body size cap in the embedded server.
- `omerta --version` was unreachable: the entry point only treated a *non-flag*
  first argument as a subcommand, so the flag fell through to argparse and died
  as "unrecognized arguments". The version string was also hardcoded — it now
  comes from the installed metadata, falling back to `pyproject.toml`.

### Security
Second audit pass, focused on untrusted input. Full write-up in `docs/AUDIT.md`.
- **Path traversal → arbitrary file write (High, exploit-confirmed)** in
  `super_extract`: a logical-partition name taken from an untrusted super
  image's LP metadata was used directly as a filename, so a partition named
  `../../ESCAPED` wrote outside the output directory. Names are now sanitised
  (`_safe_name`) and every write is containment-checked (`_safe_join`).
- **Unbounded allocation** decoding crafted images: `unsparse`/`parse_super`
  trusted header-declared sizes, so a 40-byte file could claim gigabytes, and a
  zero-length chunk looped forever. Now bounded by `MAX_OUTPUT_BYTES` /
  `MAX_TABLE_ENTRIES` with bounds checks on every chunk, table and extent.
- **Sync bundles from a peer** could crash the merge with an unhandled
  `ProgrammingError`/`AttributeError`/`TypeError`. Every field is now coerced
  and bounded, bundle size is capped, and a DB error rolls back to a clean
  error instead of a traceback.
- Web-UI `esc()` now escapes quotes and covers every `innerHTML`
  interpolation; the LAN server gained the same 16 MiB body cap the embedded
  server already had.

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
