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
| Evidence confidence (CONFIRMED/LIKELY/INFERRED/UNKNOWN) | Implemented | `core/evidence.py` — shared record/combine (weakest-link) + durable per-project log; `plugins/evidence_tools.py`, `omerta evidence`; firmware reuses the shape; `tests/test_evidence.py` |
| Unlimited chats with bounded context | Implemented | `core/agent.py` `_trim_history`, `HISTORY_LIMIT` |

## Tools, sandbox, git, build

| Spec | Status | Where |
|---|---|---|
| Tool system with risk levels & audit record | Implemented | `core/agent.py` tiers; `data/command_log.jsonl` |
| Sandbox: approvals, backups/snapshots, tiered exec | Implemented | approval gate + `tools/fileops.py` backups + `core/checkpoint.py` + `core/isolate.py` workspace snapshot/rollback |
| Sandbox: isolation + resource limits (opt-in) | Implemented | `core/isolate.py` — ulimit + bubblewrap/firejail wrap, net denied by default; `OMERTA_ISOLATE=1`; `tests/test_isolate.py` |
| Git intelligence (status/diff/log/branch/review); git safety | Implemented | `core/gitx.py` read-only structured queries + `plugins/git_tools.py` + `omerta git`; mutating git (commit/reset/push) stays HIGH_RISK behind the gate; `tests/test_gitx.py` |
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
| Classic boot image **repack** (v0–v2) | Implemented | `repack_image` rebuilds the image + recomputes the SHA1 id; round-trip tested |
| vendor_boot repack (v3/v4) | Implemented | `repack_image` rebuilds vendor_boot (ramdisk/dtb/table/bootconfig); round-trip tested |
| super.img unpack (sparse decode + LP metadata) | Implemented | `unsparse` + `parse_super`/`super_list`/`super_extract`; `omerta firmware super`/`unsparse`; `tests/test_firmware.py` |
| super.img repack (lpmake) | Implemented | `lpmake`/`super_repack` rebuild LP geometry+metadata with valid SHA-256 checksums; `omerta firmware superpack`; round-trip tested |

## Interfaces, security, packaging

| Spec | Status | Where |
|---|---|---|
| CLI (`doctor/agent/plan/build/test/debug/review/teach/firmware/index/sandbox/role/…`) | Implemented | `cli.py` + `core/commands.py`; agent verbs run role-focused one-shots |
| Web UI (chat/settings/mode/model access) | Implemented | `webui/index.html`, `core/api.py` |
| Self-contained mobile app (embedded Python, no Termux) | Implemented | `android-native/` (Chaquopy) |
| Token auth, spoof-proof, on-device secrets | Implemented | `core/auth.py`; `docs/AUDIT.md`; tests on both servers |
| Secret scanning in CI | Implemented | `.github/workflows/ci.yml` gitleaks |
| Packaging: wheel/sdist, Electron, APK, Docker/OCI, .deb | Implemented | `scripts/build_all.sh`, `docker/Dockerfile`, `packaging/build-deb.sh` (built + validated) |
| AppImage (fat — bundles its own Python) | Implemented | `packaging/build-appimage.sh` — relocatable CPython 3.12 + deps inside; falls back to PyInstaller, then host-python; self-acquires `appimagetool` and emits a self-extracting `.run` if it can't; smoke-tests what it builds |
| Engineering roles (Architect/Developer/Reviewer/…) | Implemented (as focus profiles) | `core/roles.py` — 10 roles steer the one agent; `omerta plan/review/build/test/debug`, `omerta role`; `tests/test_roles.py` |
| Multi-role pipeline (sequential) | Implemented | `core/orchestrator.py` — plan→review etc., feeds output forward, halts on approval; `omerta workflow`; `tests/test_orchestrator.py` |
| Parallel/concurrent multi-agent orchestration | Implemented | `core/orchestrator.py` `run_parallel` — a role 'team' runs concurrently (thread-local roles); `omerta workflow team`; `tests/test_orchestrator.py` |

## Not yet built (tracked, not claimed)

Nothing outstanding from the v1.0 specification: **41 Implemented, 0 Partial,
0 Planned.** The last gap (a fat AppImage carrying its own Python) closed with
the build above, verified by running the produced AppImage on a machine whose
system Python is a *different* version (3.11) from the bundled one (3.12).

Known environment-dependent behavior, stated rather than hidden:

- The AppImage's own runtime prints `No suitable fusermount binary found` on
  hosts without FUSE and then transparently extracts-and-runs. It works; the
  message is the AppImage runtime's, not OMERTA's. Set
  `APPIMAGE_EXTRACT_AND_RUN=1` to silence it.
- The PyInstaller fallback excludes `cryptography`: OMERTA never imports it,
  and its PyInstaller hook imports a Rust binding that hard-panics on some
  distributions' system packages.
- Cross-building is still a platform limit, not a choice — an APK needs the
  Android SDK, a macOS app needs a Mac. `scripts/build_all.sh` says so per
  artifact instead of failing silently.
