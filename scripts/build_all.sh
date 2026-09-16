#!/usr/bin/env bash
# Build every distributable artifact.
#
# What can be built WHERE (this is a platform limitation, not a choice):
#   wheel/sdist      -> anywhere. Installs on Linux, macOS, Windows, Termux.
#   standalone bin   -> builds for the OS you run it on. Run on each target.
#   Electron Linux   -> any Linux host.
#   Electron Windows -> a Windows host, or Linux + wine.
#   Electron macOS   -> a Mac (Apple's signing tools are mac-only).
#   Android APK      -> any host WITH the Android SDK installed.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(pwd)/artifacts"
mkdir -p "$OUT"
say() { printf "\n\033[93m[build]\033[0m %s\n" "$1"; }

say "1/5  python wheel + sdist (universal)"
if python3 -c "import build" 2>/dev/null; then
  rm -rf build_pkg/dist
  bash scripts/_stage_package.sh
  (cd build_pkg && python3 -m build --wheel --sdist)
  cp build_pkg/dist/*.whl build_pkg/dist/*.tar.gz "$OUT"/ 2>/dev/null || true
else
  echo "  skipped — pip install build"
fi

say "2/5  standalone binary for $(uname -s)-$(uname -m)"
if command -v pyinstaller >/dev/null; then
  pyinstaller --onefile --name omerta \
    --add-data "skills:skills" --add-data "plugins:plugins" \
    --add-data "webui:webui" --add-data "assets:assets" --add-data "scripts:scripts" \
    --add-data "persona.yaml:." --add-data "connectors.yaml:." \
    --hidden-import=core --hidden-import=tools \
    --hidden-import=uvicorn --hidden-import=fastapi \
    --collect-submodules core --collect-submodules tools \
    --exclude-module tkinter --exclude-module matplotlib \
    --noconfirm omerta_entry.py
  cp dist/omerta "$OUT/omerta-$(uname -s|tr A-Z a-z)-$(uname -m)" 2>/dev/null || \
    cp dist/omerta.exe "$OUT/omerta-windows.exe"
else
  echo "  skipped — pip install pyinstaller"
fi

say "3/5  electron desktop app"
if command -v npm >/dev/null; then
  (cd desktop && npm install --no-audit --no-fund)
  case "$(uname -s)" in
    Linux)  (cd desktop && npx electron-builder --linux AppImage deb tar.gz) ;;
    Darwin) (cd desktop && npx electron-builder --mac dmg zip) ;;
    *)      (cd desktop && npx electron-builder --win nsis portable) ;;
  esac
  find desktop/dist -maxdepth 1 -type f \
    \( -name "*.AppImage" -o -name "*.deb" -o -name "*.dmg" -o -name "*.exe" \
       -o -name "*.zip" -o -name "*.tar.gz" \) -exec cp {} "$OUT"/ \;
else
  echo "  skipped — install Node.js"
fi

say "4/5  android apk (self-contained — embeds Python via Chaquopy, no Termux)"
if [ -n "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ] && command -v python3 >/dev/null; then
  # Chaquopy runs pip on this host to assemble the in-APK Python, so a host
  # python3 (3.8-3.13) must be present alongside the Android SDK + JDK 17.
  GRADLE="gradle"; [ -x android-native/gradlew ] && GRADLE="./gradlew"
  (cd android-native && $GRADLE assembleDebug --no-daemon)
  find android-native -name "*.apk" -path "*debug*" \
    -exec cp {} "$OUT/omerta-agent-debug.apk" \;
else
  echo "  skipped — set ANDROID_HOME and install python3 (see android-native/README.md)"
fi

say "5/5  checksums"
(cd "$OUT" && sha256sum * > SHA256SUMS 2>/dev/null || shasum -a 256 * > SHA256SUMS)
ls -lh "$OUT"
printf "\n\033[92mdone\033[0m — artifacts in %s\n" "$OUT"
