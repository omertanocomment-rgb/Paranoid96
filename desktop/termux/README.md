# Omerta - Termux / Android Setup

## What this is
Omerta can run entirely inside Termux (Android terminal emulator).
Instead of Electron, it uses a Node.js web server. Open the UI in any browser.

## Quick start (copy-paste into Termux)

```bash
cd ~/Downloads/freetoolz
bash termux/setup.sh
```

That one script does everything. When it finishes, say **y** to start the server,
then open http://localhost:3000 in your Android browser.

## Manual steps

```bash
# 1. Install packages
pkg install nodejs npm adb git unzip

# 2. npm install
cd ~/Downloads/freetoolz
npm install

# 3. Build the renderer
npm run build:web

# 4. Start server
bash termux/start.sh
```

## Access from another device (same WiFi)

Start the server, then find your IP:
```bash
ip addr show | grep "inet " | grep -v 127
```

Open `http://<your-ip>:3000` on any browser on the same network.

## As a home screen icon (Android)

1. Install **Termux:Widget** from F-Droid
2. Long-press home screen → Widgets → Termux Widget → Shortcut
3. Select **Omerta** — it starts the server automatically

## Custom port
```bash
OMERTA_PORT=8080 bash termux/start.sh
```

## Tools available in Termux mode

| Tool | Status |
|------|--------|
| ADB (Android debugging) | ✅ Full support |
| fastboot | ✅ Full support |
| scrcpy | ⚠️ ARM only, may not be available |
| ffmpeg | ✅ `pkg install ffmpeg` |
| iOS tools (libimobiledevice) | ⚠️ Limited - use Linux host for iOS |
| apktool | ✅ Requires Java (`pkg install default-jre`) |
| magiskboot | ✅ If built from source on arm |

## iOS features on Android

iOS features (idevicebackup2, idevicepair etc.) work best from a Linux PC.
In Termux, iOS tool coverage depends on what's in the Termux package repos.
If you need full iOS support, run Omerta on Linux and connect from your Android browser.
