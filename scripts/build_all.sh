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

# Each stage stamps for itself. The stamp records a channel, and the Android
# build writes its own ("android") from inside Gradle -- so a later desktop
# stage that did not re-stamp would ship an artifact labelled android. Cheap
# to redo, and the whole point of the stamp is that it is not a guess.
stamp() { python3 scripts/stamp_build.py "$1" >/dev/null; }
python3 scripts/sync_version.py

# The audit gate runs BEFORE anything is packaged, and a failure stops the
# build. A build that skipped the gate is not a release -- and an artifact is
# the worst place to discover a finding, because by then it has your name on
# it and may already be on a phone.
say "0/6  audit gate"
if ! python3 scripts/audit.py --phase "pre-build"; then
  echo
  echo "  BUILD REFUSED: the audit gate found problems (above)."
  echo "  Fix every one, re-run the gate on the same phase until it is clean,"
  echo "  then build. OMERTA_SKIP_AUDIT=1 overrides this, and should not be"
  echo "  used for anything you intend to ship."
  [ "${OMERTA_SKIP_AUDIT:-0}" = "1" ] || exit 1
  echo "  OMERTA_SKIP_AUDIT=1 set — continuing with a KNOWN-BAD build."
fi

say "1/5  python wheel + sdist (universal)"
stamp release
if python3 -c "import build" 2>/dev/null; then
  rm -rf build_pkg/dist
  bash scripts/_stage_package.sh
  (cd build_pkg && python3 -m build --wheel --sdist)
  cp build_pkg/dist/*.whl build_pkg/dist/*.tar.gz "$OUT"/ 2>/dev/null || true
else
  echo "  skipped — pip install build"
fi

say "2/5  standalone binary for $(uname -s)-$(uname -m)"
stamp release
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
stamp desktop
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

say "5/6  packages (docker / deb / appimage)"
stamp release
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  docker build -t omerta-agent:latest -f docker/Dockerfile . && \
    echo "  built docker image omerta-agent:latest"
else
  echo "  docker: skipped (no running daemon)"
fi
if command -v dpkg-deb >/dev/null; then
  bash packaging/build-deb.sh && cp dist/omerta-agent_*_all.deb "$OUT"/ 2>/dev/null || true
else
  echo "  deb: skipped (install dpkg-deb)"
fi
# The AppImage recipe is self-sufficient: it fetches its own relocatable
# CPython and its own appimagetool, and emits a self-extracting .run if
# appimagetool cannot be had. It smoke-tests whatever it produces.
if bash packaging/build-appimage.sh; then
  cp dist/OMERTA_AGENT-*.AppImage "$OUT"/ 2>/dev/null || true
  cp dist/OMERTA_AGENT-*.run "$OUT"/ 2>/dev/null || true
else
  echo "  appimage: failed (see output above)"
fi

say "6/6  checksums"
(cd "$OUT" && sha256sum * > SHA256SUMS 2>/dev/null || shasum -a 256 * > SHA256SUMS)
ls -lh "$OUT"
printf "\n\033[92mdone\033[0m — artifacts in %s\n" "$OUT"
