# Omerta AI

**Operator-grade AI assistant — a native Android app wired to a Claude-powered backend.**

Omerta AI is the conversational front-end for the OMERTA toolkit. A Kotlin/Jetpack
Compose Android app (dark operator console, amber accent, JetBrains Mono) talks over
HTTPS to a small Node/Express backend that proxies the Anthropic **Messages API**
(default model `claude-opus-5`, adaptive thinking, SSE streaming).

```
┌────────────────────┐     HTTPS / SSE      ┌──────────────────────┐   Anthropic API   ┌───────────┐
│  Omerta AI (APK)   │ ───────────────────▶ │  Node/Express backend │ ────────────────▶ │  Claude   │
│  Kotlin + Compose  │ ◀─────────────────── │  /api/chat[/stream]   │ ◀──────────────── │  (Opus 5) │
└────────────────────┘   deltas / done      └──────────────────────┘    streamed        └───────────┘
```

## Repository layout

| Path | What |
|------|------|
| `android/`  | Kotlin + Jetpack Compose app (`ai.omerta.assistant`). Chat UI, streaming, settings. |
| `backend/`  | Node/Express gateway to the Anthropic Messages API (SSE streaming, auth, health). |
| `.github/workflows/` | CI: builds the APK (`android.yml`) and tests the backend (`backend.yml`). |
| `docs/AUDIT.md` | Audit of the Omerta AI / OMERTA ecosystem and how this repo fits. |
| `scripts/` | Helper scripts (local build, run backend, adb wiring). |

## Quick start

### 1. Backend
```bash
cd backend
cp .env.example .env          # set ANTHROPIC_API_KEY (and optionally OMERTA_APP_TOKEN)
npm install
npm start                     # listens on :8080  →  GET /health
```
Deploy anywhere Node runs. A one-click `render.yaml` and a `Dockerfile` are included.

### 2. App
```bash
cd android
# Bake in your backend URL at build time (or set it later in the app's Settings screen):
./gradlew :app:assembleRelease -PomertaBackendUrl=https://your-backend.example.com
# → android/app/build/outputs/apk/release/app-release.apk
```
Debug build: `./gradlew :app:assembleDebug`. The app's **Settings** screen lets you
change the backend URL, app token, model, effort, streaming, and system prompt at runtime.

### 3. Local device wiring (emulator/USB)
- Emulator → host backend: use `http://10.0.2.2:8080` (already whitelisted for cleartext).
- Physical device over USB: `adb reverse tcp:8080 tcp:8080`, then use `http://localhost:8080`.

## Building the APK in CI (no local Android SDK needed)

Push to GitHub and the **Build Omerta AI APK** workflow assembles debug + release APKs
and uploads them as the `omerta-ai-apk` artifact. Trigger manually via *Actions →
Build Omerta AI APK → Run workflow* and optionally pass a `backendUrl`.

To ship a properly signed release, add these repo secrets (otherwise CI signs the
release build with the debug key so the artifact is still installable):
`RELEASE_KEYSTORE_BASE64`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`.

## Wire protocol (app ↔ backend)

| Endpoint | Method | Body / result |
|----------|--------|---------------|
| `/health` | GET | `{status, model, uptime, key_configured}` |
| `/api/config` | GET | `{version, default_model, models[], thinking_enabled}` |
| `/api/chat` | POST | `{messages[], model?, system?, effort?}` → `{content, model, stop_reason, usage}` |
| `/api/chat/stream` | POST | same body → SSE events: `delta`, `thinking`, `done`, `error` |

Auth (optional): set `OMERTA_APP_TOKEN` on the backend and the app sends it as the
`x-omerta-key` header (constant-time compared).

## Security notes
- Production traffic is HTTPS-only; cleartext is permitted **only** to `localhost`,
  `127.0.0.1`, and the emulator loopback `10.0.2.2` (see `network_security_config.xml`).
- The Anthropic API key lives **only** on the backend — it is never shipped in the APK.
- Keystores, `keystore.properties`, `local.properties`, and `.env` are git-ignored.

See `docs/AUDIT.md` for the ecosystem audit and `CLAUDE.md` for build conventions.
