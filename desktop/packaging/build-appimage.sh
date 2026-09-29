#!/usr/bin/env bash
# Wrap the PyInstaller binary in an AppImage (portable, double-click, no install).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(python3 omerta_desktop.py --version | awk '{print $NF}')"
ARCH="$(uname -m)"
APPDIR="build/OmertaAI.AppDir"
[ -f dist/omerta-ai ] || bash packaging/build-binary.sh
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/applications" \
         "$APPDIR/usr/share/icons/hicolor/scalable/apps"
install -m0755 dist/omerta-ai "$APPDIR/usr/bin/omerta-ai"
cp assets/omerta-ai.svg "$APPDIR/omerta-ai.svg"
cp assets/omerta-ai.svg "$APPDIR/usr/share/icons/hicolor/scalable/apps/omerta-ai.svg"
cat > "$APPDIR/omerta-ai.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Omerta AI
Comment=Offline, teachable AI brain
Exec=omerta-ai
Icon=omerta-ai
Terminal=false
Categories=Utility;Education;
DESK
cp "$APPDIR/omerta-ai.desktop" "$APPDIR/usr/share/applications/"
cat > "$APPDIR/AppRun" <<'RUN'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/omerta-ai" "$@"
RUN
chmod +x "$APPDIR/AppRun"
TOOL="build/appimagetool-x86_64.AppImage"
if [ ! -x "$TOOL" ]; then
  curl -sSL -o "$TOOL" "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage" || true
  chmod +x "$TOOL" 2>/dev/null || true
fi
mkdir -p dist
ARCH="$ARCH" "$TOOL" "$APPDIR" "dist/OmertaAI-${VERSION}-${ARCH}.AppImage" \
  || echo "appimagetool unavailable; AppDir ready at $APPDIR"
echo "AppImage: desktop/dist/OmertaAI-${VERSION}-${ARCH}.AppImage"
