# Omerta Personal AI — session handoff / where we left off

Read this first, then `CLAUDE.md` (the enforced build conventions). This file is the
human-readable "what we built and what's next"; `CLAUDE.md` is the rulebook.

## Repo & branch
- Repo: `omertanocomment-rgb/Paranoid96`
- Working branch: **`claude/offline-ai-brain-omerta-s3pu1m`** (all Omerta Personal AI work).
- Everything below is committed and pushed. `git pull` before working, `git push` after.
- Continue in Claude Code: `git clone`, `git checkout claude/offline-ai-brain-omerta-s3pu1m`,
  then run `claude` in the repo root and just say what you want next.

## What this project is
**Omerta Personal AI** — a private, offline-first AI you teach, with a personality.
- **Android app** (`android/`, Kotlin/Compose, package `ai.omerta.assistant`, versionName
  **1.15.0**, versionCode 4). Three engines chosen at runtime (`SettingsStore.EngineMode` /
  `Provider`): EMBEDDED (calls Claude/OpenAI in-process), REMOTE (Node backend), and
  **BRAIN** (fully offline on-device brain — the heart of the product).
- **Desktop app** (`desktop/`) — native Tkinter app of the same offline brain (Linux `.deb`
  + PyInstaller binary/AppImage + Windows `.exe`). Shares the engine with Brain Studio.
- **Brain Studio** (`brain/omerta_brain.py`) — PC CLI: build/edit/chat/push brains.
- **Design system** (`design/`) — single source of truth for theme/logo/slogan; parity-enforced.

## The offline brain (core)
- Engine: `android/.../data/brain/BrainEngine.kt` (pure Kotlin, unit-tested) and the Python
  twin in `brain/omerta_brain.py`. Pipeline: teaching → reflexes → skills (identity, small
  talk, math, date/time) → BM25 knowledge → fuzzy fallback → in-character "I don't know".
- `.brain` file format = JSON `format: "omerta-brain/1"` (`data/brain/Brain.kt`). Portable
  across Android / desktop / Studio.
- Bundled default brain: `android/app/src/main/assets/brains/omerta.brain`, BUILT from
  `brain/sources/omerta/` via `python3 brain/omerta_brain.py build brain/sources/omerta -o
  brain/brains/omerta.brain` then copied into assets. **Rebuild + copy after editing sources.**

## Features shipped (all committed, tests green)
- Teach by talking: `remember that…`, `when I say X, say Y`, `Q: … | A: …`, `always/never…`,
  `wrong, it's…`, `forget…`; upload files to teach (chat paperclip / Brain screen).
- **Starter knowledge pack** (`brain/sources/omerta/qa.txt`) — answers capitals, science,
  units, conversions, how-to offline out of the box.
- **Web search** (opt-in, off by default): `data/brain/WebSearch.kt` + Python `web_lookup`
  (DuckDuckGo Instant Answer → Wikipedia, no key), only on fallback; remembers answers.
- **ONLINE/OFFLINE one-tap chip** (top bar): OFFLINE = local brain, no network; ONLINE =
  prefers a configured Claude/OpenAI key, else brain + web search. `ChatViewModel.toggleOnlineMode`.
- **On-device LLM** (optional): MediaPipe `OnDeviceLlm.kt`; install a `.task`/`.bin` by file
  pick or **paste-a-URL download** (`BrainStore.downloadModel`). Modes OFF/ASSIST/ALWAYS.
- **Agent mode**: `data/agent/DeviceTools.kt` (files, run_shell w/ root/Termux, http, device
  info, packages), `Risk.kt` (LOW/MEDIUM/HIGH + reason), `AgentLog.kt` (on-device audit log).
  Autonomy: AUTO_LOW runs only low-risk unattended; medium/high always ask; high explains.
  **No fully-unattended mode — do not add one.**
- Personality editor, adaptive persona (`observeUser`), per-brain accent, first-run onboarding.
- Data safety: atomic saves + `.bak` recovery, **version history/undo** (`.versions/`),
  backup/restore-all `.zip`, **auto-backup** to a chosen SAF folder, **encrypt-at-rest**
  (`KeyVault.kt`, Android Keystore) for keys, **encrypted `.brain.enc` export** (`BrainCrypto.kt`,
  password AES-GCM). Dedupe-on-teach. Conversation export (share as Markdown).

## Brand / design system (`design/`)
- Source of truth: `design/omerta-design.json` (colors, JetBrains Mono, slogan "Silence is
  golden.", tagline). `python3 design/gen_themes.py --check` must pass (parity across Android
  `Color.kt`, desktop palette, generated files).
- Icons: `python3 design/logo/gen_icons.py` (flagship amber). Per-app: `--name "<App>"` gives
  a distinct thumbnail accent; UI stays amber. Android launcher tint via `-PappAccent=#RRGGBB`.

## Build / test cheatsheet
```bash
# Android (needs Android SDK; CI builds it too — .github/workflows/android.yml)
cd android && echo "sdk.dir=/opt/android-sdk" > local.properties
./gradlew :app:testDebugUnitTest          # 41 tests, must stay green
./gradlew :app:assembleRelease            # → app/build/outputs/apk/release/app-release.apk
./gradlew :app:bundleRelease              # → AAB for Play

# Offline brain engine (pure stdlib)
python3 -m unittest brain/test_omerta_brain.py      # 15 tests
python3 brain/omerta_brain.py build brain/sources/omerta -o brain/brains/omerta.brain
cp brain/brains/omerta.brain android/app/src/main/assets/brains/omerta.brain

# Desktop app
python3 -m unittest desktop/test_desktop.py         # + python3 desktop/omerta_desktop.py --selftest
bash desktop/packaging/build-deb.sh                 # → desktop/dist/*.deb  (headless-OK)
bash desktop/packaging/build-appimage.sh            # needs pyinstaller + tk (CI/desktop)
pwsh desktop/packaging/build-exe.ps1                # Windows .exe (windows-latest CI)

# Design parity (must pass in CI)
python3 design/gen_themes.py --check
```

## Prebuilt artifacts (`dist/`)
- `OmertaPersonalAI-1.15.0.apk` — Android (debug-signed).
- `omerta-ai-desktop_1.1.0_all.deb` — Linux desktop brain app.
- `omerta-ai_1.0.0_amd64.deb`, `OmertaAI-1.0.0-x86_64.AppImage` — OMERTA engine.
- `brains/{omerta,luna,sensei}.brain`.

## Release
- `.github/workflows/release.yml`: push a **`v*` tag** → builds signed APK+AAB, `.deb`,
  AppImage and Windows `.exe` and attaches them to a GitHub Release. Signing secrets:
  `RELEASE_KEYSTORE_BASE64` + `RELEASE_STORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD` (Android),
  `WINDOWS_PFX_BASE64` + `WINDOWS_PFX_PASSWORD` (Windows). Not yet run — no tag cut.

## Open / next steps (nothing broken; these are choices)
1. **Cut `v1.15.0` tag** to produce the full signed installer set (APK+AAB, .deb, AppImage,
   .exe) via the release workflow. Add signing secrets first for real signatures.
2. **Rename/bump the desktop app** to "Omerta Personal AI" 1.15.0 (only Android was renamed;
   desktop still shows Omerta AI 1.1.0).
3. **Verify on a real device** — GUIs (Android screens, desktop window), the on-device LLM
   download+run, SAF auto-backup folder, web search live calls. None emulator-tested here.
4. **Merge the branch** to the default branch when happy (currently all on the feature branch).
5. Bigger bets discussed: real on-device embeddings (true semantic recall vs the fuzzy
   stand-in), voice in/out, home-screen widget, encrypted phone↔desktop sync.

## Guardrails (from CLAUDE.md — keep)
- Everything ships inside the installable executable; must work offline; no required server.
- Theme only from the design system; keep `gen_themes.py --check` green.
- Never commit `*.jks`, `keystore.properties`, `local.properties`, `.env`.
- Model IDs are complete as-is (no date suffixes); default `claude-opus-5`.
- Keep Android `BrainEngine.kt` and Python `omerta_brain.py` behavior-compatible + tests green.
