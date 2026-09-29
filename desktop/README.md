# Omerta AI — native Linux desktop app

The offline Omerta brain as a real native-window Linux app (Tk — **no browser, no web
view, no server, no terminal backend**). Everything is in the executable; it runs with
zero network. Brains are the same `.brain` files the Android app and Brain Studio use, so
they move between desktop, PC and phone unchanged.

## Install on Linux Mint (or Ubuntu / Debian)

**The `.deb` (recommended):**
```bash
sudo apt install ./omerta-ai-desktop_1.1.0_all.deb
```
Then launch **Omerta AI** from the menu, or run `omerta-ai`. (`apt install ./file.deb`
pulls in `python3-tk` automatically. With `dpkg -i` instead, run `sudo apt -f install`
once to grab it.)

**Fully self-contained binary / AppImage** (no `python3-tk` needed at all):
```bash
chmod +x OmertaAI-1.1.0-x86_64.AppImage
./OmertaAI-1.1.0-x86_64.AppImage
```

## Windows

A self-contained `OmertaAI.exe` (bundles Python + Tk + the brain + icon — nothing to
install) is built by CI on every push and uploaded as the **omerta-ai-desktop-windows**
artifact. To build locally on Windows:
```powershell
pip install pyinstaller
./desktop/packaging/build-exe.ps1        # → desktop/dist/OmertaAI.exe
```
Set `WINDOWS_PFX_BASE64` + `WINDOWS_PFX_PASSWORD` (repo secrets or env) to Authenticode-sign
it to publishable standard.

## Use it
- **Chat** offline in a native window. Teach it by talking: `remember that…`,
  `when I say X, say Y`, `Q: … | A: …`, `always …`, `wrong, it's …`, `forget …`.
- **＋ Upload files** — teach it from `.txt/.md/.csv/.html` files, or install a `.brain`.
- **Personality** — name, tagline, greeting, description, traits, tone, catchphrases, emoji.
- **New / Switch / Import / Export / Delete** — keep several brains and move them around.

Brains are stored in `~/.local/share/omerta-ai/brains/`.

## Build from source
```bash
python3 desktop/omerta_desktop.py            # run directly (needs python3-tk)
python3 desktop/omerta_desktop.py --selftest # headless logic check
python3 -m unittest desktop/test_desktop.py

bash desktop/packaging/build-deb.sh          # → desktop/dist/*.deb   (native, needs only dpkg)
bash desktop/packaging/build-binary.sh       # → desktop/dist/omerta-ai (PyInstaller onefile)
bash desktop/packaging/build-appimage.sh     # → desktop/dist/*.AppImage (portable)
python3 design/logo/gen_icons.py             # → design/logo/*.png + omerta.ico (brand icons)
# Windows:
pwsh desktop/packaging/build-exe.ps1         # → desktop/dist/OmertaAI.exe
```
CI (`.github/workflows/desktop.yml`) builds the `.deb`, the binary and the AppImage on
every push and uploads them as the `omerta-ai-desktop-linux` artifact.

## Distribution principle
This app follows the OMERTA rule for every project going forward: **the whole thing ships
inside the installable executable — no separate web app and no terminal/server backend to
run.** The brain engine, the knowledge, the personality and the UI are all in the package,
and it works with no network.
