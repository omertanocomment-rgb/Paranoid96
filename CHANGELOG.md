# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/);
this project adheres to [Semantic Versioning](https://semver.org/).

## [1.9.2] — 2026-09-24

Every provider read "unavailable", including the one that needs no API key.

### Fixed
- **The provider list hid its own diagnosis.** `router.provider_status()` has
  always computed a reason per provider — "no key in $ANTHROPIC_API_KEY", "not
  running at http://127.0.0.1:11434", "no .gguf model on the device yet" — and
  the UI rendered all of them as the word "unavailable". Three unrelated
  problems with three different fixes looked identical. The reason is now shown
  in both the picker and the provider list. Same failure pattern as the 1.9.1
  backend bug: the information existed and was thrown away at the last step.

### Added
- **A fix next to each reason.** An unavailable provider that can be repaired
  offers the action: "get a model" jumps to the on-device catalogue, "add a
  key" opens the secret field with the right variable preselected, "set
  address" the same, "start engine" starts it. A reason with no action beside
  it is still homework.
- **Device fit in the catalogue** (`models._fits`). A 32-bit process cannot
  address the larger weights, so those entries are greyed out and say so rather
  than accepting a multi-gigabyte download that ends in an out-of-memory kill.
  Where fit is not knowable the answer is yes — refusing on a guess is worse.
- **A starting point.** With no model installed, the smallest that fits is
  marked "start here". Four sizes and no guidance is a decision a first-time
  owner has no basis to make.
- **`tests/test_ui_providers.py`** — 13 checks in a real browser: each reason
  reaches the screen, each offers the right action, a ready provider offers
  none, and a reason containing a quote cannot break the click handler. The
  reason is looked up at click time rather than written into an `onclick`
  attribute, and that is what the hostile case pins.

## [1.9.1] — 2026-09-24

The embedded backend starts again. It had not started on any device since
1.6.0.

### Fixed
- **The app's backend never launched (1.6.0 – 1.9.0).** `omerta_android.start()`
  gained a `native_lib_dir` parameter and `OmertaPython.java` was updated to
  pass it, but the Chaquopy shim between them — `omerta_boot.start()` — was
  not. Chaquopy binds `callAttr()` positionally, so every launch raised
  `TypeError` inside the block Java closes with `catch (Throwable)`. The only
  symptom the user ever saw was "Backend didn't come up." Four releases shipped
  with a dead backend on every architecture, because nothing compared the two
  ends of the bridge.
- **A stale `core/build_stamp.json` shadowed a bumped `pyproject.toml`** in a
  source checkout — the exact stale-artifact trap `core/version.py` exists to
  close. A checkout now outranks a stamp, and the disagreement is reported
  (`stale_stamp`) rather than silently resolved. A shipped copy has no
  pyproject, so there the stamp still rules.

### Added
- **On-device launch diagnostics.** A failed launch now names its reason on the
  splash screen and offers **RETRY &amp; SHOW DIAGNOSTICS**, which re-runs the
  launch and reports device, ABI, app version, payload contents, native library
  count, per-import results and the full Python traceback — with COPY and SHARE.
  A failure that only exists in logcat is a failure the owner of the phone
  cannot report.
- **Audit gate: `java/python bridge`.** Checks every `callAttr()` site against
  `omerta_boot`, and `omerta_boot` against `omerta_android`, in both directions
  — arity and dropped parameters. The build refuses to package on a mismatch.
- **`tests/test_bridge.py`** — 26 checks. It reintroduces the original bug in a
  scratch copy of the tree and requires the gate to reject it, then boots the
  real launch path end to end (env, toolbox install, server answering on
  loopback, idempotent restart, clean shutdown). A check that only passes on
  correct code proves nothing.

### Changed
- First-launch extraction reports progress ("unpacking Python… N files") and is
  given five minutes rather than two. The payload now carries a full stdlib;
  on a slow 32-bit phone that is minutes of writes behind what used to be a
  silent splash screen indistinguishable from a hang.
- The extraction marker is written only after a complete extraction, so an
  interrupted first launch redoes the work instead of permanently claiming to
  be complete.
- Asset copy buffer 8 KiB → 64 KiB.

## [1.9.0] — 2026-09-24

### Fixed
- **Universal APK.** Every prior release shipped arm64-v8a binaries only. On an
  `armeabi-v7a` phone the installer refused it outright ("Incompatible CPU
  architecture"). Eight versions shipped 64-bit-only without the ABI ever being
  checked against a real device. BusyBox, python3, git, curl, dropbear and
  llama.cpp are now cross-compiled for both ABIs — 162 binaries.
- llama.cpp on armv7 built with `GGML_LLAMAFILE=OFF`; the fp16 matrix kernel
  uses `vld1q_f16`, which armv7 does not have.
- dropbear on armv7: `#include "android_compat.h"` is applied to `src/cli-auth.c`
  alone. A global `-include` breaks autoconf's undeclared-builtins probe, and
  setting `CFLAGS` at make time breaks libtommath's include path.
- git on armv7: missing `-I$SP/curl-8.11.1/include`.
- The audit gate's per-ABI native check normalises CPython extension triples
  (`_ssl.cpython-313-aarch64-linux-android.so` vs `-arm-linux-androideabi.so`),
  which must differ per ABI and were being reported as a mismatch.

## [1.8.0] — 2026-09-24

### Fixed
- An `--` inside an XML comment is illegal and made the manifest unparseable;
  the merger reported only "Error parsing AndroidManifest.xml".

### Added
- Audit gate check **android xml**: every Android XML must parse. A parser
  catches this in milliseconds; the build was failing late, after the slow parts.

## [1.7.0] — 2026-09-24

### Added
- **Encrypted backup and restore** (`core/backup.py`) — tar.gz sealed with the
  same key derivation as chats. Restore refuses any entry that escapes the
  target directory and any symlink or hardlink.
- **Cost meter** (`core/usage.py`) — per-provider token and spend tracking.
  Local providers are free by definition; an unknown price is counted and
  flagged `priced: false` rather than guessed at.
- **Per-project approval policy** (`core/policy.py`) — a project can be stricter
  than the global dial, never looser.
- **Voice input**, an Android **share target** (SEND / SEND_MULTIPLE /
  PROCESS_TEXT) and a landscape layout.

## [1.6.0] — 2026-09-24

### Added
- **Copy buttons** on every chat message and code block.
- **`core/adbclient.py`** — adb over TCP with a pure-Python RSA implementation
  (Miller-Rabin primes, PKCS#1 v1.5 with a SHA-1 DigestInfo, Android's
  little-endian `RSAPublicKey` blob with its Montgomery constants). No adb
  binary required.
- **A real `python3` in the terminal** — CPython 3.13 cross-compiled for Android,
  installed from the native library directory.

### Fixed
- RSA key generation could produce a 2047-bit modulus (two 1024-bit primes do
  not guarantee 2048 bits), and the Android blob is fixed-width. The top two
  bits of each prime are now set and the width is asserted.
- Bundled `libssl`/`libcrypto`/`libsqlite3` collided with Chaquopy's own 3.11
  builds; renamed with patchelf, including the renamed libraries' own
  `DT_NEEDED` entries.

### Known broken (fixed in 1.9.1)
- This release added `native_lib_dir` to `omerta_android.start()` and to the
  Java call site, but not to the `omerta_boot` shim between them. The embedded
  backend failed to start on every device from here until 1.9.1.

## [1.5.0] — 2026-09-24

### Added
- **Model catalogue** (`core/models.py`, `core/models_catalogue.json`) — four
  Apache-2.0 Qwen2.5 GGUFs, one tap from Settings. Resumable download with HTTP
  Range; SHA-256 is verified before the partial file replaces the destination.
- **Attachments with no type or size restriction** (`core/attach.py`). Uploads
  stream to disk one chunk at a time rather than buffering in memory; filenames
  are stripped of traversal; a short upload is refused and removed.

### Fixed
- **Conversations were never saved.** `/api/chat` never called `core/chats`.
  Chats made before this release are unrecoverable — they were never written.
- The first fix reintroduced the bug: `chats.listing()` returns a dict, not a
  list, and a broad `except` swallowed the `TypeError`. Exceptions are now named
  and a failure to persist surfaces as `persistence_warning`.
- `/api/attach` was in only one server's local-only list — the same class of
  hole as the 1.1.0 remote-code-execution finding. The gate now enforces parity.

## [1.4.0] — 2026-09-24

### Added
- **On-device inference** (`core/localai.py`) — a bundled llama.cpp server. No
  API key, no second machine, no network. Thread count defaults to half the
  cores capped at four; the process is started in its own session so killing it
  cannot signal the app.
- **The audit gate** (`scripts/audit.py`) — eleven checks plus the test suite,
  wired into `build_all.sh`, which refuses to package on a finding.

### Fixed
- The gate's first real find: a fork bomb was classified NORMAL. Denial now
  matches on shape, after whitespace normalisation.

## [1.3.0] — 2026-09-24

### Added
- **The owner's manual** (`scripts/gen_manual.py`) — 18 pages, generated.
- **`core/toolbox.py`** — BusyBox applet farm plus extra programs (curl, git,
  ssh, scp, ssh-keygen). Unsafe applets (`su`, `login`, `passwd`, `init`,
  `reboot`, `chroot`, module loading) are never installed.

### Fixed
- **The terminal had no controlling terminal** — "No controlling tty ... won't
  have full job control". `setsid()` alone is not enough;
  `ioctl(slave_fd, TIOCSCTTY, 0)` is what attaches one.
- BusyBox selects applets by `argv[0]`, so querying the binary directly reports
  "applet not found" for everything and the toolset installed nothing. A
  bootstrap `busybox` symlink is created first.

## [1.2.0] — 2026-09-24

### Added
- **One version source** (`core/version.py`, `pyproject.toml`) and a per-artifact
  build stamp (`core/build_stamp.json`). Six hand-maintained copies of the
  version is how a stale artifact goes unnoticed.

### Fixed
- A malformed build stamp could take the server's startup path down; anything
  that fails a plausibility check is now treated as no stamp at all.
- The Android release build, and a Gradle asset rewire that silently dropped the
  entire payload: `srcDir(tasks.named(...))` runs after AGP freezes the source
  set, so the APK built cleanly with no agent inside it.

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
