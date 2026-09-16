# Omerta AI — Project Audit

_Audit performed as part of "audit and build APK with backend wired into APK."_

## 1. Starting state

- The GitHub repo **`omertanocomment-rgb/Paranoid96`** was an **empty repository**
  (no commits, no branches) at the start of this work — nothing to build against.
- "Omerta AI" is a **Claude project**: the OMERTA toolkit ecosystem, which is spread
  across the account's Drive, Replit, and sibling GitHub repos rather than living in
  this repo. Discovered assets:
  - **Drive** `Omerta/` folder + related files: `omerta-user-guide.pdf`, multiple
    Termux setup scripts (`omerta_unified_termux_setup.sh`, `omerta_termux_bridge_setup.sh`),
    and prebuilt APKs (`OMERTA-FLASHFORGE`, `OMERTA-UNLOCKKIT`, `OMERTA-FREEDOMSHELL`,
    `OMERTA-iOS-Bridge`, `omerta-flash-debug`).
  - **Replit** apps under `@Omerta96`: *Jailbreak Hub*, *Firmware Exploiter*.
  - **Sibling repos**: `phone-lab`, `ios`, `Mobile-pentest`, `ios-tooling-builder`,
    `mobile-pentest-1785822259` (not in this session's scope).
- Toolchain in the build sandbox: JDK 21, Gradle 8.14.3, Node 22, Python 3.11,
  `keytool` — but **no Android SDK** preinstalled.

## 2. Gaps identified

1. No source of truth for an "Omerta AI" app in this repo — it had to be built.
2. No backend: the OMERTA assets are scripts/APKs with no AI service wiring.
3. No Android SDK locally, and the project skill notes `dl.google.com` is often
   firewalled — a build path was needed either way.

## 3. Actions taken

- Verified `dl.google.com` **is** reachable from this sandbox and installed the
  Android SDK (cmdline-tools, platform-tools, `platforms;android-34`,
  `build-tools;34.0.0`) so a real APK could be assembled in-session.
- Built **Omerta AI**, a native Kotlin/Jetpack Compose Android app
  (`ai.omerta.assistant`) in the OMERTA house style (dark console, amber accent,
  JetBrains Mono), with streaming chat, connection status, and a full settings screen.
- Built the **Omerta AI backend** (Node/Express) that proxies the Anthropic Messages
  API with SSE streaming, optional shared-secret auth, health/config endpoints, a
  Dockerfile, and a Render deploy config.
- **Wired the app into the backend**: `BuildConfig.OMERTA_BACKEND_URL` (build-time,
  overridable at runtime), an OkHttp SSE client matching the backend's event protocol,
  and a network-security config that keeps production HTTPS-only.
- Assembled and signed the APK locally, added CI workflows that reproduce the build,
  and committed unit tests on both sides.

## 4. Build verification

- `./gradlew :app:assembleDebug` → `app-debug.apk` ✅
- `./gradlew :app:assembleRelease` (R8 minify + shrink, signed) → `app-release.apk` ✅
- `./gradlew :app:testDebugUnitTest` ✅  ·  backend `npm test` ✅
- Backend smoke test: `/health`, `/api/config` respond; `/api/chat` fails gracefully
  without an API key. ✅
- APK signature verified with `apksigner`; `aapt dump badging` confirms package
  `ai.omerta.assistant`, label "Omerta AI", target SDK 34.

## 5. Security posture

- Anthropic API key is **backend-only**; it is never present in the APK.
- App→backend auth via optional `x-omerta-key` shared secret (constant-time compare).
- Cleartext HTTP allowed only to loopback/emulator hosts; all else HTTPS.
- Signing keystore, `keystore.properties`, `local.properties`, `.env` are git-ignored.

## 6. Recommended follow-ups

- Deploy the backend (Render/Docker) and rebuild the release APK with
  `-PomertaBackendUrl=<deployed-url>` (or set it in-app).
- Add the four `RELEASE_*` signing secrets to GitHub for CI-signed releases.
- Optional: on-device history persistence, a thinking pane (the `thinking` SSE
  channel is already emitted), and a shared MCP/tool bridge to the OMERTA scripts.

## 7. Follow-up: backend embedded into the app

Per request ("no additional backend commands once the app is opened"), the gateway is
now **compiled into the app**. A Kotlin in-process engine (`AnthropicClient`) calls the
Anthropic Messages API directly, selected by an `EngineMode` setting:
- **EMBEDDED** (default) — no server to run; needs an on-device/baked API key.
- **REMOTE** — the original Node backend, for keeping the key off-device.

The Node `backend/` remains fully supported for REMOTE deployments. Security tradeoff of
the embedded key (extractable from the APK) is documented in the README and Settings UI.
