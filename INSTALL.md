# Install

Pick whichever matches how you work. All of them share memory once you set
up sync (`docs/SYNC.md`).

## 1. pip — works everywhere (Linux, macOS, Windows, Termux)

```bash
pip install omerta_agent-1.0.0-py3-none-any.whl[all]
omerta            # interactive
omerta serve      # web UI on :8787
omerta doctor     # what works, what's missing
omerta sync       # share memory with your other devices
```

The universal option. On Termux this is the one to use.

Data lives outside the install, so `pip install -U` never destroys your
memory or tokens:

| OS | location |
|---|---|
| Linux / Termux | `~/.local/share/omerta-agent/` |
| macOS | `~/Library/Application Support/OmertaAgent/` |
| Windows | `%APPDATA%\OmertaAgent\` |

Override with `OMERTA_DATA_DIR`.

## 2. Standalone binary — no Python needed

```bash
chmod +x omerta-linux-x86_64
./omerta-linux-x86_64 doctor
```

One file, ~47MB, zero dependencies. Drop it on a box you don't want to
install Python on. Build one for your own OS with `scripts/build_all.sh`.

## 3. Desktop app

```bash
chmod +x "OMERTA-AGENT-1.0.0-x86_64.AppImage"
./OMERTA-AGENT-1.0.0-x86_64.AppImage
```

Spawns the Python backend and opens the UI in a real window with the
blackletter O as its icon. Needs Python 3.9+ on PATH — it tells you clearly
if that's missing.

## 4. Android app (self-contained — no Termux)

Install `omerta-agent-*.apk` and open it. The app **embeds Python** and runs
the agent backend in-process (Chaquopy + a foreground service); there is
nothing else to install. Give it a brain in **☰ → MODE / MODEL ACCESS**: paste
a cloud API key (online) or point it at a local model server (offline). Build
it yourself per `android-native/README.md`.

> The pip route (option 1) still works on Termux if you prefer a terminal, and
> the app can also connect to a backend running on another machine on your LAN
> (**Advanced** on the launch screen).

## 5. From source

```bash
bash scripts/install_termux.sh     # Android (Termux, optional — the APK needs none of this)
bash scripts/install_linux.sh      # Linux / Kali
bash scripts/install_macos.sh      # macOS
powershell -ExecutionPolicy Bypass -File scripts\install_windows.ps1
```

## Give it a brain

Either works; both is better.

```bash
export ANTHROPIC_API_KEY=sk-ant-...            # online
ollama serve && ollama pull qwen2.5-coder:7b   # offline, unlimited
```

`omerta doctor` will tell you exactly what's reachable.

---

# Building the artifacts yourself

```bash
bash scripts/build_all.sh      # builds everything possible on this host
```

Cross-platform builds have hard limits that aren't a matter of effort:

| artifact | buildable on | notes |
|---|---|---|
| wheel / sdist | anywhere | pure Python, installs on all four platforms |
| standalone binary | the target OS | PyInstaller can't cross-compile; run the script on each OS |
| Electron Linux | any Linux | AppImage, deb, tar.gz |
| Electron Windows | Windows, or Linux + wine | `npx electron-builder --win` |
| Electron macOS | a Mac only | Apple's signing/notarization tools are mac-only |
| Android APK | any host with the Android SDK + host Python 3.8–3.13 | embeds Python via Chaquopy; see `android-native/README.md` |

The ones I built and tested here are Linux-host artifacts plus the universal
wheel. For Windows `.exe`, macOS `.dmg`, and the APK, run the same script on
that platform — it's the identical config, just executed where the toolchain
can legally run.
