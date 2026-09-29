# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/);
this project adheres to [Semantic Versioning](https://semver.org/).

## [1.12.0] — 2026-09-29

The Android app is native. The WebView is gone.

### Changed
- **The Android interface is Jetpack Compose** — real Android widgets, drawn by
  the platform. No WebView, no HTML, no JavaScript bridge and no HTTP in the
  app. The screens call Python in the same process through `OmertaClient` →
  `core/dispatch`, the same router every other front-end uses, so the approval
  gate and the wire format are unchanged. Chat (streaming, with the approval
  card as a real dialog), Terminal (a real shell with a `^C` key) and Settings
  (providers with the reason each is unavailable and a fix beside it, network
  mode, approval policy, API key, on-device model catalogue).
- `webui/` is no longer staged into the APK. It remains for the desktop app and
  for reaching a backend from a LAN browser.

### Fixed
- **The payload staging task was a `Copy`, which only ever adds.** Removing
  `webui/**` from the include list changed nothing: the stale directory stayed
  in the staging dir and kept shipping. It is a `Sync`, and the APK is verified
  to contain zero HTML files rather than assumed to.

### Added
- **`scripts/release.sh`** — one command builds the `.apk`, the `.deb` and the
  `.exe` and puts all three in one zip with the docs and a `SHA256SUMS`. It
  runs the audit gate first and refuses to package on a finding, then checks
  the APK it actually produced carries both ABIs and contains no HTML.
- **`CLAUDE.md`** — the standing rules, so they survive the session: every
  release ships three executables; do not build a web app; the gate is not
  optional; verify the artifact rather than the source that should have made
  it.

## [1.11.0] — 2026-09-28

Merged with the native console project. What that codebase had and this did not
was streaming and CI; what this had and that did not was the whole on-device
agent. Both now exist in one place.

### Added
- **Replies stream as they are written.** A turn can take a minute, and a
  static "thinking" dot for that long makes a working agent look hung. The
  obvious answer is server-sent events, which needs a live HTTP connection —
  and this agent runs over four transports, three of which have nowhere to put
  one (the app calls Python in-process, the desktop shell talks over a pipe,
  the GTK window answers its own URI scheme). So a turn runs on a thread and
  the client polls by offset (`core/streams.py`, `/api/chat/start`,
  `/api/chat/poll`), exactly as the terminal already streams its output. One
  pattern, every transport, and the poll is exactly-once: a slow or dropped
  poll loses nothing and repeats nothing. A client that ignores streaming gets
  the identical final result.
- **The project's constitution reaches the model** (`core/constitution.py`).
  `OMERTA.md` has been in this repository since early on, stating what the
  agent must always do and never do — and nothing read it. The approval gate
  enforces what can be expressed in code; the rest is behaviour, and behaviour
  comes from the prompt. A repository's own `OMERTA.md` or `CLAUDE.md` is found
  by walking up from the working directory and outranks the shipped charter.
  Bounded, and tighter still for a small local model, so rules can never crowd
  out the conversation — and truncation is stated rather than silently cutting
  a rule in half.
- **CI that builds everything** (`.github/workflows/ci.yml`). The audit gate
  runs first and every build depends on it, mirroring the local rule that
  `scripts/audit.py` refuses to package on a finding. It builds the universal
  APK and *fails the run* if the result is missing `armeabi-v7a` — the bug that
  shipped for eight releases; builds the `.deb`, installs it and starts the
  desktop window under a virtual display; and builds the Windows installer on a
  real Windows runner, which produces a proper NSIS setup.exe that a Linux
  machine cannot (electron-builder has to run the installer it just made, which
  needs 32-bit Wine).
- **`tests/test_streaming.py`** — text is readable *before* the turn ends (a
  test that only checked the final text would pass for a non-streaming
  implementation), offsets never drop or duplicate, and a turn that raises
  reaches the client as data instead of vanishing on a thread.
- **`tests/test_constitution.py`** — the rules reach both prompts, a project's
  own file wins, an enormous one is bounded, and an undecodable one degrades.

### Notes on the merge
The uploaded project's engine is a smaller sibling of `core/` (2,600 lines
against 10,600) and its Android console is a thin client that calls Claude
directly. Its genuinely better ideas were streaming and CI, and both are here.
Its native Compose UI remains the one thing not yet taken: adopting it would
mean rebuilding the terminal, editor, chats, learn and settings tabs that the
current UI already provides, and is a project of its own rather than a merge.

## [1.10.0] — 2026-09-28

The backend is part of the app now, on both platforms. No HTTP server, no port,
no terminal.

### Fixed
- **No model worked, even with an API key.** In auto mode `complete()` asked
  `has_internet()` and, on a False answer, REMOVED every provider marked
  `needs_internet` from the routing order — leaving only local providers, none
  of them running, and reporting "No model available" without ever mentioning
  the cloud provider holding a valid key. The probe opened a raw socket to
  `1.1.1.1:443` and `8.8.8.8:53`; carrier networks, captive portals and phones
  that force their own resolver block both while `api.anthropic.com` stays
  reachable. A guess about the network was overriding a fact about the
  configuration. The probe now resolves DNS first and may only REORDER
  providers, never remove a configured one — whether a provider works is
  decided by calling it. Offline *mode* still excludes them, explicitly,
  because that is an instruction rather than a guess.

### Changed
- **The Android app no longer runs a server.** Routing moved to
  `core/dispatch.py` as plain functions over (method, path, query, body).
  `core/httpd.py` delegates to it (468 → 305 lines) and the app calls it
  directly through Chaquopy. Same routes, same approval gate, same wire format;
  nothing listening on the device. The loopback server remains for reaching the
  backend from the LAN, off unless asked for (`OMERTA_ANDROID_HTTP=1`).
- The page is served from a synthetic `https://omerta.local/` origin via
  `shouldInterceptRequest`, which makes it a **secure context** — so
  `navigator.clipboard` and `getUserMedia` work, where `http://127.0.0.1` left
  both unavailable and the copy buttons needing a fallback.
- The JavaScript bridge is asynchronous. The synchronous form blocks the JS
  thread, and a chat turn can take a minute — on a phone, a frozen app with no
  spinner. Uploads are chunked through it, so a large file is still never
  assembled in memory.
- **One definition of the local-only list**, in `core/dispatch.py`, which every
  transport routes through. Two copies is how `/api/attach` came to be
  local-only on one server and open on the other.

### Added
- **A native Linux desktop application** (`desktop_native/omerta_desktop.py`,
  `omerta-desktop`). A real installed program: applications-menu entry, icons
  at eight sizes, its own GTK window. It registers a private `omerta://` URI
  scheme and answers every request — page, assets and `/api/...` — from
  `core/dispatch` in-process. No HTTP server, no port, no terminal, no browser
  tab. WebKit has handed request bodies to scheme handlers since 2.40, so the
  UI needs no special case at all: `fetch('/api/x')` simply arrives.
- The `.deb` installs that application, depends on `python3-gi`,
  `gir1.2-gtk-3.0` and `gir1.2-webkit2-4.1`, and refreshes the desktop database
  and icon cache so the entry appears without a logout. The launcher explains
  itself if those bindings are missing for the running Python instead of
  printing a traceback about `_gi`.
- **`tests/test_routing.py`** — a keyed provider survives a failed probe, an
  unkeyed one is not attempted, offline mode still excludes cloud providers.
- **`tests/test_ui_bridge.py`** — the UI driven in a real browser against a
  stubbed native interface: requests go through the bridge and *not* HTTP, the
  call is genuinely asynchronous (a synchronous implementation fails the test),
  a 404 arrives as data rather than an exception, and a 1.3 MiB file is sent in
  three slices.
- **`tests/test_desktop_native.py`** — 26 checks, including the real window
  under Xvfb: the UI loads with its tabs, GET and POST both reach the backend
  through the private scheme, the page is a secure context, and path traversal
  out of the served directories is refused.
- The audit gate now also checks the dynamic `py("name", ...)` dispatch in the
  Android bridge, which would otherwise be the only unchecked Java→Python calls
  in the app.

### Notes on verification
The desktop app was installed from the `.deb` and driven from `/opt` under a
virtual display: title, tabs, `/api/version` returning 1.10.0 and a build
channel of "deb", ten providers listed, POST bodies arriving. The APK was
verified to carry `core/dispatch.py` and the compiled bridge entry points. The
Android side has not yet been run on a handset.

## [1.9.3] — 2026-09-28

Desktop packages that work on a machine nobody has prepared. Building them
found that the desktop app could never have started on Windows at all.

### Fixed
- **The backend was unimportable on Windows.** `core/terminal.py` imported
  `fcntl` and `termios` at module scope; both are POSIX-only, and `core/api.py`
  imports terminal, so the whole backend failed at import. The module already
  degrades to pipes when no PTY is available -- it never got the chance. The
  POSIX imports are now guarded, `POSIX_TTY` says which mode is in force, and
  process-group and signal use is feature-checked (`signal.SIGKILL` does not
  exist on Windows).
- **42 text reads and writes named no encoding.** Python falls back to the
  *locale* default: UTF-8 on Linux, cp1252 on Windows. Serving the web UI did
  `index.html.read_text()`, and the UI is UTF-8, so on Windows that raised
  `UnicodeDecodeError` -- a `ValueError`, which the handler's `except OSError`
  did not catch. The browser got an empty reply and no explanation. Every call
  now names UTF-8 explicitly. This was the more dangerous of the two: silent
  and data-dependent, so a chat containing an em-dash would have failed to save
  on some machines and not others.
- **The desktop launcher spawned `server.py`**, which imports FastAPI and
  uvicorn. Nothing in any package installs them, so the backend died on import
  anywhere it had not been pip-installed by hand. It now runs
  `omerta_entry.py serve`, which falls back to the stdlib server -- and
  `omerta_entry.py` was explicitly *excluded* from the packaged resources, so
  the working path was not even shipped.
- **Packages carried the previous build's stamp.** A desktop build reported
  itself as `channel: android`. Both package scripts now stamp before the
  payload is copied.

### Added
- **`.deb` at 1.9.3** -- verified by extracting it and serving from the
  extracted tree: 200 on `/api/status`, the full 90 KB UI on `/`,
  `channel: deb`.
- **`.exe` for Windows x64** -- a self-extracting installer that carries its own
  CPython 3.11.9 (python.org's official embeddable build, checksum-pinned)
  plus `requests` and `pyyaml`. It needs no Python, no admin rights and no
  installer prerequisites; it installs per-user, makes Start Menu and Desktop
  shortcuts, and ships an uninstaller.
- **`scripts/fetch_win_runtime.sh`** and **`packaging/build-win.sh`** -- the
  Windows pipeline as one ordered entry point, because the steps are
  order-dependent in ways that silently produce a wrong artifact.
- **`tests/test_portability.py`** -- no POSIX-only module imported unguarded at
  module scope; every text read/write names an encoding; the UI is genuinely
  UTF-8 and genuinely undecodable as cp1252 (so the bug was real, not
  theoretical); and `core.terminal` and `core.api` both import with
  `fcntl`/`termios`/`pty` blocked, which is what Windows looks like to Python.
- **`tests/test_desktop_launch.py`** -- the launcher runs the entry point that
  degrades, that entry point is packaged, Windows carries an interpreter, and
  the stdlib server really does serve with FastAPI and uvicorn absent.

### Notes on verification
The Windows installer was assembled by concatenation (7-Zip SFX stub + config +
payload) rather than with electron-builder's NSIS target: NSIS installers are
32-bit and electron-builder must *run* the installer it builds to generate the
uninstaller, which needs 32-bit Wine -- unavailable on this host, where the
i386 dependency chain is broken. The payload was then extracted and run under
wine64 using the shipped Windows `python.exe`: `/api/status`, `/api/version`,
`/api/models`, `/api/localai`, `/api/usage` all 200, and `/` served the full
UI. The terminal endpoint returns an honest error there instead of crashing,
which is the degradation working. Not yet run on real Windows hardware.

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
