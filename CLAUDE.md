# CLAUDE.md — Omerta AI build conventions

Guidance for any future Claude Code (or human) session working in this repo.
This encodes the OMERTA ground rules: **take every task to a working, packaged
artifact — never hand back a fragment or a TODO. If a step is blocked, build the
workaround immediately.**

## What this repo is
- `android/` — native Android app **Omerta AI** (`ai.omerta.assistant`), Kotlin +
  Jetpack Compose. Dark operator-console theme, amber accent (`#FFB300`), JetBrains
  Mono for all typography.
- `backend/` — Node/Express gateway to the Anthropic Messages API (SSE streaming).
- The app never calls Anthropic directly; it calls the backend. The API key lives
  only on the backend.

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
