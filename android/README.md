# Android app (Capacitor)

Gives OMERTA AGENT a real launcher icon on your phone instead of a browser tab.

The app is a thin shell: it points at a backend (`python server.py`) running
either in Termux on the same phone, or on your Kali box / desktop over WiFi.
The agent itself doesn't run inside the APK — Android app sandboxes can't
spawn `git`, `adb`, `fastboot` or a build toolchain, so the backend stays in
Termux where it actually has a shell.

## Build

```bash
cd android
npm install
npx cap add android
bash ../scripts/android_icons.sh   # install the blackletter O as launcher icon
npm run build:debug                # -> android/app/build/outputs/apk/debug/
```

Install it:
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Release build

```bash
keytool -genkey -v -keystore omerta.keystore -alias omerta \
  -keyalg RSA -keysize 2048 -validity 10000
npm run build:release
```
Then sign with `apksigner`. See `skills/android-build/SKILL.md`.

## Usage

Launch → enter backend address → connect. It remembers the address and token
and auto-connects on subsequent launches.

- Backend in Termux on this phone: `127.0.0.1:8787`, no token needed.
- Backend elsewhere: that machine's LAN IP plus the token the server printed.
