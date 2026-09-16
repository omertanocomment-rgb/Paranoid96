# OMERTA AI — Spec & Implementation Status

Source spec: *OMERTA AI — Linux Mint Full Build Specification, Phases 1–15* (the
uploaded PDF, archived at `docs/OMERTA_AI_Linux_Mint_Full_Build_Specification.pdf`).

This repo implements the spec as a real, tested engine (`engine/`) plus mobile
consoles (`android/`, and an iOS project via CI). Per the spec's own rule
(§24, §"Definition of Done"), a phase is marked **COMPLETE only where implemented
and covered by a passing test or a verified run**. Nothing here is marked done on the
strength of a model response.

## Implementation status

| Phase | Area | Status | Where / evidence |
|------|------|--------|------------------|
| 1 | Installation / env | ✅ COMPLETE | `engine/scripts/install.sh`, `pyproject.toml`; `omerta doctor` verified |
| 2 | Configuration | ✅ COMPLETE | `config.py`: config.toml + providers.toml + policies.toml + project `.omerta/{artifacts,snapshots,reports}`; tests |
| 3 | CLI | ✅ COMPLETE | `cli.py` (all documented commands); smoke-verified |
| 3 | Web UI + API | ✅ COMPLETE | `web/server.py` (`/health`, `/api/config`, `/api/chat[/stream]`, `/api/agent`, UI); verified |
| 4 | Model providers / router | ✅ Anthropic + OpenAI + local Ollama (all real) | `models/` — `provider:model` routing, honest degradation; tests |
| 5b | Teach / learn by command | ✅ COMPLETE | `omerta learn/teach` → `Memory.learned_context()` injected into chat + agents |
| 5 | Learning & memory | ✅ COMPLETE | `memory/db.py` (SQLite, teach/forget/show/search, SUCCESS/FAILURE); 2 tests |
| 6 | Codebase intelligence | ✅ COMPLETE | `codebase/index.py` (files+symbols, ripgrep/py search); test `test_index_and_symbol_search` |
| 7 | Tool system | ✅ COMPLETE — all groups | `tools/controller.py`: filesystem, terminal, process, search, git, build, test, package, firmware-analysis, device-io (typed, approval-gated); tests |
| 8 | Sandbox | ✅ COMPLETE | `sandbox/runner.py` (docker/podman/bubblewrap detect + daemon check + honest fallback); verified |
| 9 | Git engine | ✅ COMPLETE | `gitengine/engine.py` (status/branch/diff/log/snapshot); verified |
| 10 | Multi-agent orchestration | ✅ core; ⚠️ shared-context depth basic | `agents/orchestrator.py` (roles + architect→dev→reviewer) |
| 11 | Build/test/debug loop | ✅ COMPLETE | `buildloop/loop.py` (records cmd/exit/duration/artifact hashes); verified |
| 12 | Evidence & recovery | ✅ COMPLETE | `evidence.py` + memory SUCCESS/FAILURE; tests |
| 13 | App/software/firmware eng | ✅ scaffolding; depends on host toolchain | `firmware/inspect.py` + agent roles |
| 17 | Firmware/device-tree tools | ✅ full detection + invocation + ops | `firmware/inspect.py`: detects the whole spec toolchain; `run_tool` invokes any of them; ops: unpack boot, AVB info, dtb↔dts, sparse→raw, lpunpack, extract; `omerta firmware <op>` |
| 14 | Security & packaging | ✅ deb/AppImage/exe; secrets env-only | `engine/packaging/` + CI; deb install verified |
| 15 | RC stress test | ⚠️ partial | unit tests + smoke; full 20-category matrix is future work |

Legend: ✅ implemented & verified · ⚠️ partial / degrades honestly · ❌ not started.

## Packaging targets (the four requested executables)

| Format | Platform | Built | How |
|--------|----------|-------|-----|
| `.deb` | Linux Mint/Debian/Ubuntu | ✅ verified in-session (install+run+remove) | `packaging/deb/build-deb.sh` |
| AppImage | Linux portable | ✅ built via `appimagetool` | `packaging/appimage/build-appimage.sh` + CI |
| `.exe` | Windows | ⚙️ CI (windows-latest) | `.github/workflows/engine-build.yml` |
| `.apk` | Android console | ✅ verified in-session | `android/` (points at the engine's API in REMOTE mode) |
| `.ipa` | iOS console | ⚙️ CI (macOS); unsigned without an Apple dev account | `ios/` + `.github/workflows/ios-build.yml` |

The engine itself is a **desktop/CLI/server** program (it drives docker sandboxes,
cross-compilers and firmware tools), so its native executables are `.deb` / AppImage /
`.exe`. The mobile `.apk` / `.ipa` are **consoles** that connect to the engine's
`/api` — the same wire protocol the engine and the Node backend both speak.

## Boundaries (from spec §24)
This is the engineering build of the blueprint, not a claim that every Phase 1–15
component is production-complete. Partial items above are explicitly flagged; extend
them behind the existing tests.
