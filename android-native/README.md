# OMERTA AGENT — native Android app (self-contained)

The agent backend runs **inside the app**. No Termux, no terminal, nothing
external to install: tap the icon and the agent is running.

## How it works

[Chaquopy](https://chaquo.com/chaquopy/) embeds a full CPython 3.11 plus the
agent's pure-Python dependencies (`requests`, `pyyaml`) into the APK. On
launch a foreground service (`BackendService`) starts `core/httpd.py` — the
dependency-free, stdlib-only HTTP server — bound to `127.0.0.1`. The WebView
then loads the same web UI every other platform uses. Chat is plain
`POST /api/chat` (no websocket, nothing to configure).

The Python you run is byte-for-byte the repo's `core/` and `tools/`: they're
staged into the APK as an asset payload at build time (`stageOmertaPayload`)
and extracted to the app's private files dir on first launch, so the approval
gate and hard-deny list are identical to desktop — there is no Android fork of
the agent.

```
Java (thin)                     Python (the agent)
──────────                      ──────────────────
MainActivity ──starts──▶ BackendService
                              │ Chaquopy: Python.start()
                              ▼
                         omerta_boot.start(filesDir, homeDir, port)
                              │ sys.path += extracted payload
                              ▼
                         omerta_android.start() ─▶ core.httpd (127.0.0.1)
                              ▲
WebView ◀──http://127.0.0.1:8787/──┘   (loopback: no token needed)
```

## Giving it a brain

On first run, open the **☰ menu → MODE / MODEL ACCESS**:

- **Online:** paste an API key (Anthropic, OpenAI, OpenRouter, Groq, Gemini).
  Stored `0600` on the device only; it never leaves the phone.
- **Offline:** point OMERTA at a local model server on your LAN or device
  (Ollama / llama.cpp / LM Studio) — unlimited, no key, no billing.
- **Auto** uses online when reachable and falls back to local automatically.

Chats are unlimited; long conversations are compacted into a bounded context
window so they never hit a wall.

## What it can actually do on a phone

A stock, non-rooted Android device has no `git`/`adb`/`fastboot`/build
toolchain, and an app sandbox can't run one. OMERTA reports that honestly
rather than faking it — on such a device you get the model, memory, skills and
the approval workflow. On a rooted/dev device (or when you point the app at a
machine on your LAN via **Advanced**), the full shell-backed agent is available.

## Build it yourself

Needs a JDK 17, the Android SDK, and a host Python 3.8–3.13 on `PATH`
(Chaquopy runs `pip` on the host to assemble the in-APK Python).

```bash
export ANDROID_HOME=~/Android/sdk           # or wherever yours lives
echo "sdk.dir=$ANDROID_HOME" > local.properties
gradle assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

The APK is larger than the old WebView-only shell (~tens of MB) because it now
contains a CPython runtime per ABI (`arm64-v8a`, `armeabi-v7a`, `x86_64`).

## Release build

```bash
keytool -genkey -v -keystore omerta.keystore -alias omerta \
  -keyalg RSA -keysize 2048 -validity 10000
# put storeFile/storePassword/keyAlias/keyPassword in keystore.properties
gradle assembleRelease
# -> app/build/outputs/apk/release/app-release.apk (signed if keystore present)
```

`keystore.properties` and `*.keystore` are git-ignored — never commit them.

## Why minSdk 24 / targetSdk 34, cleartext on

minSdk 24 (Android 7.0) covers the vast majority of devices. `usesCleartextTraffic`
is on because the backend speaks plain HTTP on `127.0.0.1` (and optionally your
LAN); the token, not TLS, is what protects a LAN backend, and loopback traffic
never leaves the device.
