# Omerta AI

**Operator-grade AI assistant — a native Android app wired to a Claude-powered backend.**

Omerta AI is the conversational front-end for the OMERTA toolkit — a Kotlin/Jetpack
Compose Android app (dark operator console, amber accent, JetBrains Mono) powered by
the Anthropic **Messages API** (default model `claude-opus-5`, adaptive thinking, SSE
streaming).

**The backend is built into the app.** By default the app runs in **EMBEDDED** mode
and calls Claude in-process — open the app, add your Anthropic API key once (or bake it
in at build time), and it just works. No server to start, no commands to run.

```
EMBEDDED (default — nothing to run):
┌────────────────────┐        HTTPS / SSE (in-process)        ┌───────────┐
│  Omerta AI (APK)   │ ─────────────────────────────────────▶ │  Claude   │
│  Kotlin + Compose  │ ◀───────────────────────────────────── │ (Opus 5)  │
└────────────────────┘         streamed deltas                 └───────────┘

REMOTE (optional — key stays off-device):
┌────────────────────┐   HTTPS/SSE   ┌──────────────────────┐   Anthropic API   ┌───────────┐
│  Omerta AI (APK)   │ ────────────▶ │  Node/Express backend │ ────────────────▶ │  Claude   │
└────────────────────┘               │  /api/chat[/stream]   │                   └───────────┘
                                      └──────────────────────┘
```

> Embedded mode keeps the API key on the device (it's extractable from the APK). If the
> key must stay off-device, switch to **REMOTE** in Settings and run `backend/`.

## Repository layout

| Path | What |
|------|------|
| `android/`  | Kotlin + Jetpack Compose app (`ai.omerta.assistant`). Chat UI, streaming, settings. |
| `backend/`  | Node/Express gateway to the Anthropic Messages API (SSE streaming, auth, health). |
| `.github/workflows/` | CI: builds the APK (`android.yml`) and tests the backend (`backend.yml`). |
| `docs/AUDIT.md` | Audit of the Omerta AI / OMERTA ecosystem and how this repo fits. |
| `scripts/` | Helper scripts (local build, run backend, adb wiring). |

## Quick start (embedded — nothing to run)

```bash
cd android
# Option A: install, then paste your Anthropic API key in the app's Settings screen.
./gradlew :app:assembleRelease
# Option B: bake the key in at build time for zero in-app setup:
./gradlew :app:assembleRelease -PanthropicApiKey=YOUR_ANTHROPIC_KEY
# → android/app/build/outputs/apk/release/app-release.apk
adb install -r android/app/build/outputs/apk/release/app-release.apk
```
Open the app → it's ready. The **Settings** screen switches engine (Embedded/Remote),
key, model, effort, streaming, and system prompt at runtime.

## Optional: REMOTE mode with the Node backend
Use this only if you want the API key off the device.
```bash
cd backend
cp .env.example .env          # set ANTHROPIC_API_KEY (and optionally OMERTA_APP_TOKEN)
npm install && npm start      # listens on :8080  →  GET /health
```
Then in the app's Settings, choose **REMOTE** and set the backend URL. A one-click
`render.yaml` and a `Dockerfile` are included. You can also bake the URL at build time
with `-PomertaBackendUrl=https://your-backend`.
- Emulator → host backend: `http://10.0.2.2:8080` (whitelisted for cleartext).
- Physical device over USB: `adb reverse tcp:8080 tcp:8080`, then `http://localhost:8080`.

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
- **EMBEDDED mode:** the Anthropic API key is stored on-device (DataStore) and/or baked
  into the APK — it is **extractable**. Prefer a scoped/limited key, and use **REMOTE**
  mode when the key must never leave a server.
- **REMOTE mode:** the key lives only on the backend and is never shipped in the APK.
- Keystores, `keystore.properties`, `local.properties`, and `.env` are git-ignored; a
  baked `-PanthropicApiKey` is compiled into `BuildConfig`, so don't commit built APKs
  that contain a real key.

See `docs/AUDIT.md` for the ecosystem audit and `CLAUDE.md` for build conventions.
