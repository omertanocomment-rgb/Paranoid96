# CLAUDE.md — Omerta AI build conventions

Guidance for any future Claude Code (or human) session working in this repo.
This encodes the OMERTA ground rules: **take every task to a working, packaged
artifact — never hand back a fragment or a TODO. If a step is blocked, build the
workaround immediately.**

## Distribution principle (ALL projects, going forward)
**Everything ships inside the installable executable. No separate web app, and no
terminal/server backend to run.** The engine, data, personality and UI live in the
artifact, and it must work offline. This is the EMBEDDED philosophy applied everywhere:
- Android → the app calls providers in-process, or runs the fully offline on-device brain.
- Desktop (`desktop/`) → a native Tk app (no browser/web view, no server) packaged as a
  `.deb` (Linux Mint/Ubuntu/Debian), a Linux PyInstaller binary / AppImage, and a
  self-contained Windows `.exe` (`packaging/build-exe.ps1`, CI on windows-latest).
- New targets → prefer a native, self-contained installable over anything that needs a
  server or a browser tab. A REMOTE/server mode may exist as an *option*, never a
  requirement to use the product.

## Brand base (ALL projects, going forward)
Every new app starts from the **Omerta AI brand**: the OMERTA Design System theme
(`design/omerta-design.json`), the logo (`design/logo/`, `gen_icons.py`), and the
**slogan "Silence is golden."** with tagline "your offline operator brain" (both in the
design tokens under `brand`, surfaced in `design/generated/*`, Android `strings.xml`, and
the desktop app). Reuse these — don't invent per-app branding.
- **UI is identical across apps** — same near-black theme, JetBrains Mono, and the single
  **amber** UI accent. Do not recolor the UI per app.
- **Only the app THUMBNAIL/icon accent changes per app**, so apps are distinguishable on a
  home screen while staying on the OMERTA hexagon mark. Generate each new app's icons with:
  `python3 design/logo/gen_icons.py --name "<App Name>" --prefix <app> --outdir <path>`
  (the accent is derived deterministically from the name; or pass `--accent "#RRGGBB"` from
  the curated `APP_ACCENTS`). **Omerta AI (flagship) stays amber** — never change it.
  Use the generated PNGs/`.ico` as that app's launcher/desktop/exe icon. On Android the
  adaptive launcher icon's mark is tinted by `-PappAccent=#RRGGBB` at build
  (`resValue` → `@color/omerta_thumbnail_accent`; flagship default amber).

## Release & UI standard (ALL projects, going forward)
Every app is built to a **publishable, signed** standard with a **polished, well-laid-out
UI**, and **every theme is derived from the OMERTA Design System** (`design/`):
- **Theme from the design system.** Colors, JetBrains Mono type, logo, radii and spacing
  come from `design/omerta-design.json`. Never hardcode a new palette — add a token there.
  `python3 design/gen_themes.py --check` must pass, and app icons come from
  `design/logo/gen_icons.py` (the OMERTA mark), (it verifies Android `Color.kt`, the
  desktop palette, and `design/generated/*` all match the tokens). Amber `#FFB300` is the
  only accent; dark operator-console look by default.
- **Polished UI.** Consistent 16px gutters, the shared radii/spacing, real empty/loading/
  error states, works at phone width, dark-first. No unstyled or placeholder screens.
- **Signed, publishable artifact.** Ship the signed release build, versioned, with an app
  icon/adaptive icon and store-ready metadata:
  - Android → signed APK **and** AAB (`scripts/sign/make-android-keystore.sh`, then
    `./gradlew :app:assembleRelease :app:bundleRelease`; CI signs from `RELEASE_*` secrets).
  - Linux/desktop → signed `.deb` (`scripts/sign/sign-deb.sh`) + AppImage.
  - Windows → Authenticode-signed `.exe` (`WINDOWS_PFX_BASE64`/`WINDOWS_PFX_PASSWORD`).
  - **One tag ships everything:** push a `v*` tag → `.github/workflows/release.yml` builds
    the signed APK+AAB, `.deb`, AppImage and `.exe` and attaches them to a GitHub Release.
  - Other targets → the platform's signed, installable format; never an unsigned dev build.
  See `scripts/sign/README.md`. Never commit keystores/keys (git-ignored).
- **Definition of done** for any app = design-system theme + parity check green + polished
  layout + signed installable produced (locally or in CI) + docs updated.

## Personal-data safety (this repo)
- Brain saves are atomic (tmp+rename) **and** keep a last-good `<id>.brain.bak`; loaders fall
  back to `.bak` on corruption (Android `BrainStore`, Python `omerta_brain.load`).
- Backup/restore all brains to one `.zip` (Brain screen: BACK UP ALL / RESTORE; desktop:
  Backup all / Restore; Brain Studio: `pack`). 
- The agent keeps an on-device audit log of every tool call (`data/agent/AgentLog.kt`,
  viewable on the Brain screen). Never send it off-device.
- Secrets (API keys, app token) are encrypted at rest with a hardware-backed Android
  Keystore key (`data/local/KeyVault.kt`, AES-256-GCM); SettingsStore encrypts on write and
  decrypts on read. It degrades to plaintext only if the Keystore is unavailable — never
  log decrypted secrets.
- Encrypted portable export: `data/brain/BrainCrypto.kt` (password AES-256-GCM, PBKDF2) —
  `.brain.enc` files openable on any device with the password (distinct from device-bound
  KeyVault). Desktop/Python encrypted export is not yet implemented (would need a real AES
  lib; don't ship homegrown crypto).
- Version history / undo: `BrainStore` keeps up to 20 timestamped snapshots per brain under
  `.versions/<id>/` and can roll back (the desktop library mirrors this). Restores are
  themselves snapshotted, so a rollback is undoable.
- Fuzzy recall: when BM25 finds nothing solid, `BrainEngine.fuzzyKnowledge` /
  `Engine._fuzzy` re-search with token+char-trigram similarity (`TextKit.fuzzySimilarity`)
  so paraphrases/typos still hit — a model-free stand-in for semantic recall.
- Conversation export: `ChatViewModel.transcriptMarkdown` + the top-bar share action.
- Dedupe on teach: `BrainEngine.addFact` / `add_fact` refresh an existing near-identical
  fact (normalized-equal or fuzzy ≥ 0.9) instead of piling up duplicates.
- Per-brain accent: `Persona.accent` (hex; blank = amber) tints that brain's highlight in
  the UI (Brain header, personality editor accent chips). The UI base stays amber.
- First-run onboarding: a one-time dialog (SettingsStore `onboarded` flag) points to going
  offline, teaching, the Brain screen, and encrypted keys.
- Starter knowledge: the bundled brain (`brain/sources/omerta/qa.txt`) answers common
  questions offline (capitals, basic science, units, conversions, how-to). Rebuild the
  asset after editing sources (see Brain format).
- Web search (opt-in, off by default): `data/brain/WebSearch.kt` (Android) / `web_lookup`
  (Python) look up unknown questions via DuckDuckGo Instant Answer + Wikipedia (no key) and
  remember the answer. Gated by `brainWebSearch` / `BrainLibrary.web_search`; only fires on
  a brain fallback, so the offline promise holds unless the operator enables it.
- On-device LLM model install: `BrainStore.importModel` (pick a file) **or**
  `BrainStore.downloadModel` (paste an https URL, resumable) drop a MediaPipe `.task`/`.bin`
  into the model dir; `OnDeviceLlm` then answers grounded in the brain (ASSIST/ALWAYS).
- Auto-backup: pick a SAF folder once (Brain → AUTO-BACKUP, persisted uri permission);
  `BrainStore.backupAllToTree` writes a timestamped `.zip` of every brain there, keeping the
  latest 10. Runs on launch when due (`ChatViewModel.maybeAutoBackup`, OFF/DAILY/WEEKLY) or
  on demand (BACK UP NOW). No background service — a private, on-open safety net.

## What this repo is
- `android/` — native Android app **Omerta AI** (`ai.omerta.assistant`), Kotlin +
  Jetpack Compose. Dark operator-console theme, amber accent (`#FFB300`), JetBrains
  Mono for all typography.
- `backend/` — Node/Express gateway to the Anthropic Messages API (SSE streaming). Optional
  (REMOTE mode only) — never required to use the app.
- `design/` — **OMERTA Design System**: `omerta-design.json` (source of truth) +
  `gen_themes.py` (generates/enforces every target's theme). All apps theme from here.
- `scripts/sign/` — signing tooling (Android keystore, `.deb` GPG) for publishable builds.
- `desktop/` — **native Linux desktop app** (Tkinter, no browser/server) for the offline
  brain; shares the engine with `brain/omerta_brain.py`. Packaged as `.deb` + AppImage.
  Build: `bash desktop/packaging/build-deb.sh`. Tests: `python3 -m unittest desktop/test_desktop.py`.

## Engine modes (how the app reaches Claude)
The app has a compiled-in engine and picks one at runtime (`EngineMode` in
`SettingsStore.kt`):
- **EMBEDDED (default):** the app calls the Anthropic Messages API **in-process**
  (`data/remote/AnthropicClient.kt`) — there is **no external backend to run**.
  Requires an Anthropic API key on the device (entered in Settings, or baked at build
  time via `-PanthropicApiKey=`). The key ships in the APK / lives on-device and is
  extractable — this is the documented tradeoff for zero-setup operation.
- **REMOTE:** the app calls the `backend/` Node service
  (`data/remote/OmertaApiClient.kt`); the key stays server-side. Use this when the key
  must not be on the device.
- **BRAIN (provider `brain`, fully offline):** `data/brain/` — `BrainEngine` (pure Kotlin
  teach/recall/personality engine, unit-tested on the JVM), `BrainStore` (on-device
  `.brain` library + model files), `OnDeviceLlm` (optional MediaPipe LLM), and
  `BrainRuntime` (process singleton shared by chat and the Brain screen). With
  `offlineFallback` on, any online provider that fails before emitting text is answered
  by the brain instead.
Both engines emit the same `StreamEvent`s; `ChatRepository` selects between them.
The two implementations MUST stay behavior-compatible (thinking/effort/streaming).

## Brain format
- `.brain` = JSON, `format: "omerta-brain/1"` (`data/brain/Brain.kt`). Keep
  `brain/omerta_brain.py` (Brain Studio) in sync with it — both read/write the same file.
- Bundled default brain: `android/app/src/main/assets/brains/omerta.brain`, generated with
  `python3 brain/omerta_brain.py build brain/sources/omerta -o brain/brains/omerta.brain`
  and then copied into assets. Rebuild it when you change `brain/sources/omerta/`.
- Teaching intents, reflexes and corrections are always handled by `BrainEngine`, never by
  the on-device LLM, so what the user teaches is always applied the same way.
- `BrainEngine.observeUser` implements the adaptive persona (mirrors the operator's tone/
  length/emoji into `Persona`), gated by `adaptivePersona`; internal counters live in
  hidden `_style_*` profile keys — never surface `_`-prefixed keys (use `visibleProfile()`).

## Agent autonomy & device tools
- `data/agent/DeviceTools.kt` = the owned-device tools (files, `run_shell` with root/Termux,
  `http_request`, device info, packages). `data/agent/Risk.kt` classifies each call
  LOW/MEDIUM/HIGH with a reason. `ChatViewModel.runAgent` gates every call: in `Autonomy.AUTO_LOW`
  only LOW runs unattended; MEDIUM/HIGH always prompt, HIGH shows the reason. There is
  deliberately **no fully-unattended mode** — do not add one (the safety classifier rejects it,
  and it contradicts the product's "asks first" contract).
- The agent system guidance (`ChatViewModel.agentGuidance`) tells the model to do what the
  operator asks, suggest a better option first (`suggestBetter`), keep risky steps small,
  and never work around the approval prompt.

## Build commands

### Android (local)
```bash
cd android
echo "sdk.dir=/opt/android-sdk" > local.properties     # point at your Android SDK
./gradlew :app:assembleDebug                            # → app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease -PomertaBackendUrl=https://your-backend
./gradlew :app:testDebugUnitTest                        # unit tests
```
- JDK 17, compileSdk/targetSdk 34, minSdk 26.
- Gradle 8.9 (wrapper committed), AGP 8.5.2, Kotlin 2.0.21, Compose BOM 2024.09.03.
- Release signing: create `android/keystore.properties` (git-ignored) with
  `storeFile/storePassword/keyAlias/keyPassword`. If absent, release falls back to
  the debug key so `assembleRelease` still yields an installable APK.
- Backend URL precedence: `-PomertaBackendUrl=…` (build) → in-app Settings (runtime)
  → the compiled `BuildConfig.OMERTA_BACKEND_URL` default.

### Android (CI — no local SDK)
Push to GitHub; `.github/workflows/android.yml` builds debug+release and uploads the
`omerta-ai-apk` artifact. This is the standard escape hatch when a local Android SDK
isn't available. Optional signing secrets: `RELEASE_KEYSTORE_BASE64`,
`RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`.

### Brain Studio (PC, stdlib only)
```bash
python3 brain/omerta_brain.py build brain/sources/omerta -o brain/brains/omerta.brain
python3 brain/omerta_brain.py chat brain/brains/omerta.brain
python3 -m unittest brain/test_omerta_brain.py
```

### Backend
```bash
cd backend
cp .env.example .env    # ANTHROPIC_API_KEY required
npm install && npm start
npm test                # node:test unit tests
```

## Conventions
- **Model IDs are complete as-is — never append date suffixes.** Default `claude-opus-5`,
  adaptive thinking, effort via `output_config.effort`.
- Keep the wire protocol in `android/.../data/model/Models.kt` in sync with
  `backend/src/routes/chat.js`.
- Never commit: `*.jks`, `keystore.properties`, `local.properties`, `.env`.
- UI defaults to the OMERTA look; add themes rather than hardcoding new palettes.
