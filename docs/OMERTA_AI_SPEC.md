# OMERTA AI spec → implementation map

An honest map of the OMERTA AI v1.0 specification onto this repository. Per the
constitution, nothing here is claimed as done without it being real in the
code. Status is one of **Implemented**, **Partial**, or **Planned**.

## Core engineering workflow

| Spec | Status | Where |
|---|---|---|
| INSPECT→PLAN→MODIFY→BUILD→TEST→DEBUG→REVIEW→VERIFY loop | Implemented | `core/agent.py` (ReAct loop + persistence in `core/executor.py`) |
| Always-ask approval gate, enforced in control flow | Implemented | `core/agent.py`, `core/sandbox.py`; tests `tests/test_approval.py` |
| Hard-deny list (unrecoverable ops refused) | Implemented | `core/config.py` DENY_PATTERNS; `tests/test_flash.py` |
| Direct / evidence-first output; no fake success | Implemented (policy) | persona + constitution `OMERTA.md`; firmware tools return UNKNOWN not guesses |
| Project Constitution (`OMERTA.md`) | Implemented | `OMERTA.md`, `firmware/t509k/OMERTA.md` |

## Model providers & modes

| Spec | Status | Where |
|---|---|---|
| Provider abstraction (OpenAI/Anthropic/local/future) | Implemented | `core/providers/*`, `core/router.py` — 8 providers |
| Offline / Online / Auto, clean failure handling | Implemented | `core/router.py` mode filter; `/api/mode`; `tests/test_mode_history.py` |
| Local-model support (Ollama/llama.cpp/LM Studio) | Implemented | `core/providers/{ollama,llamacpp}_p.py`, openai-compat |

## Memory, learning, evidence

| Spec | Status | Where |
|---|---|---|
| Persistent memory + preference learning | Implemented | `core/memory.py` (SQLite+FTS5) |
| Explicit teaching (`omerta teach`, scopes, `memory`, `forget`, `rules`) | Implemented | `core/commands.py`, `core/memory.py` |
| Failure memory (don't retry a known-failed fix) | Implemented | `core/executor.py` AttemptTracker + `error_fix` memories |
| Evidence confidence (CONFIRMED/LIKELY/INFERRED/UNKNOWN) | Implemented (firmware) / Partial (general) | `plugins/firmware_bringup.py`; general policy in constitution |
| Unlimited chats with bounded context | Implemented | `core/agent.py` `_trim_history`, `HISTORY_LIMIT` |

## Tools, sandbox, git, build

| Spec | Status | Where |
|---|---|---|
| Tool system with risk levels & audit record | Implemented | `core/agent.py` tiers; `data/command_log.jsonl` |
| Sandbox: approvals, backups/snapshots, tiered exec | Implemented | approval gate + `tools/fileops.py` backups + `core/checkpoint.py` + `core/isolate.py` workspace snapshot/rollback |
| Sandbox: isolation + resource limits (opt-in) | Implemented | `core/isolate.py` — ulimit + bubblewrap/firejail wrap, net denied by default; `OMERTA_ISOLATE=1`; `tests/test_isolate.py` |
| Git intelligence (status/diff/commit/…); git safety | Partial | via shell `git` tool through the gate; `git push --force`/`reset --hard` are HIGH_RISK |
| Build / test discovery + fix loop | Implemented | `tools/devtools.py`, executor retry loop, skills |
| Codebase index / search / symbol / deps / calls | Implemented | `core/index.py` — ast symbols + import graph + Python call graph (py), regex symbols for js/ts/go/rust/jvm/c/shell; `omerta index/search/symbol/deps/calls`; `plugins/code_index.py`; `tests/test_index.py` |

## Firmware / Android / AOSP

| Spec | Status | Where |
|---|---|---|
| Firmware command builders (cross-compile, flash gating) | Implemented | `tools/firmware.py`, `tools/devtools.py` |
| `omerta firmware analyze/dtb` (decode a DTB) | Implemented | `plugins/firmware_bringup.py` (pure-Python FDT parser); `tests/test_firmware.py` |
| `omerta device report` (evidence → BOARD REPORT) | Implemented | `plugins/firmware_bringup.py` `board_report` |
| Evidence collection plan (read-only adb) | Implemented | `collect_evidence_plan`; `firmware/t509k/scripts/collect-t509k-evidence.sh` |
| Device-tree bring-up workflow + starter tree | Implemented | skill `skills/firmware-bringup`, `firmware/t509k/` |
| `omerta firmware inspect` boot/vendor_boot/dtbo images | Implemented | `plugins/firmware_bringup.py` `inspect_image` (header v0–v4, dt_table); `tests/test_firmware.py` |
| Analyze DTB embedded in boot.img (v2) / dtbo entry | Implemented | `analyze_dtb` container dispatch; `tests/test_firmware.py` |
| Extract image parts to disk (kernel/ramdisk/dtb, per-entry dtb) | Implemented | `extract_image`; `omerta firmware extract`; `tests/test_firmware.py` |
| Full boot/vendor_boot/super **repack** | Planned | inspect/decode/extract done; writing a new image back is a follow-up |

## Interfaces, security, packaging

| Spec | Status | Where |
|---|---|---|
| CLI (`doctor/agent/plan/build/test/debug/review/teach/firmware/index/sandbox/role/…`) | Implemented | `cli.py` + `core/commands.py`; agent verbs run role-focused one-shots |
| Web UI (chat/settings/mode/model access) | Implemented | `webui/index.html`, `core/api.py` |
| Self-contained mobile app (embedded Python, no Termux) | Implemented | `android-native/` (Chaquopy) |
| Token auth, spoof-proof, on-device secrets | Implemented | `core/auth.py`; `docs/AUDIT.md`; tests on both servers |
| Secret scanning in CI | Implemented | `.github/workflows/ci.yml` gitleaks |
| Packaging: wheel/sdist, Electron, APK, Docker/OCI, .deb | Implemented | `scripts/build_all.sh`, `docker/Dockerfile`, `packaging/build-deb.sh` (built + validated) |
| AppImage | Partial (recipe) | `packaging/build-appimage.sh` — thin AppImage, needs `appimagetool` |
| Engineering roles (Architect/Developer/Reviewer/…) | Implemented (as focus profiles) | `core/roles.py` — 10 roles steer the one agent; `omerta plan/review/build/test/debug`, `omerta role`; `tests/test_roles.py` |
| Parallel multi-agent orchestration | Planned | roles focus one agent; concurrent orchestrated agents are a follow-up |

## Not yet built (tracked, not claimed)

- Parallel multi-agent orchestration (roles focus a single agent today).
- Firmware image **repack** (writing a modified boot/vendor_boot back out; inspect, decode and extract are done).
- Fat AppImage bundling its own Python (a thin, host-python recipe exists).

These are honest gaps. OMERTA should say so rather than imply they exist.
