# OMERTA AGENT — native Android app

A minimal WebView shell. **No Capacitor, no node_modules, no native libs** —
which is exactly why it builds cleanly where a Capacitor project fights you
on Termux. The whole APK is ~93KB.

## What it is (and isn't)

The APK is the *interface*. The agent runs as a Python backend with a real
shell — in Termux on this phone, or on a machine over your LAN. An Android
app sandbox can't spawn `git`, `adb`, `fastboot` or a build toolchain, so
the brain deliberately stays where it can actually work.

Launch → enter backend address → connect. It remembers the address and
token and reconnects on next launch. Back button backs out to the connect
screen so you can repoint it at a different machine.

## Install the prebuilt APK

```bash
adb install -r omerta-agent-1.0.0-debug.apk
# or copy to the phone and tap it (allow "install unknown apps")
```

Then in Termux:
```bash
omerta serve
```
and connect the app to `127.0.0.1:8787` — localhost needs no token.

To use a machine on your LAN instead, run `omerta serve` there and use its
IP plus the token the server prints.

## Build it yourself

```bash
export ANDROID_HOME=~/Omerta/android-sdk      # or wherever yours lives
echo "sdk.dir=$ANDROID_HOME" > local.properties
gradle assembleDebug
```
Output: `app/build/outputs/apk/debug/app-debug.apk`

Needs a full **JDK** (not a JRE) — the Android Gradle plugin calls `jlink`,
and a JRE-only install fails with "jlink executable does not exist". On
Termux: `pkg install openjdk-21`.

## Release build

```bash
keytool -genkey -v -keystore omerta.keystore -alias omerta \
  -keyalg RSA -keysize 2048 -validity 10000
gradle assembleRelease
apksigner sign --ks omerta.keystore \
  --out omerta-release.apk app/build/outputs/apk/release/app-release-unsigned.apk
```

## Why targetSdk 34 / minSdk 24

minSdk 24 (Android 7.0) covers essentially every device that can run Termux.
`usesCleartextTraffic` is on because the backend speaks plain HTTP on
localhost/LAN — the token, not TLS, is what protects it there.
