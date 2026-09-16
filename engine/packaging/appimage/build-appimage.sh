#!/usr/bin/env bash
# Build an AppImage from the PyInstaller binary.
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION="$(python3 -c 'import omerta; print(omerta.__version__)')"
ARCH="$(uname -m)"
APPDIR="build/OmertaAI.AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/applications" \
         "$APPDIR/usr/share/icons/hicolor/scalable/apps"

[ -f dist/omerta ] || bash packaging/pyinstaller/build-binary.sh
install -m0755 dist/omerta "$APPDIR/usr/bin/omerta"
cp packaging/appimage/omerta.svg "$APPDIR/omerta-ai.svg"
cp packaging/appimage/omerta.svg "$APPDIR/usr/share/icons/hicolor/scalable/apps/omerta-ai.svg"

cat > "$APPDIR/omerta-ai.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=OMERTA AI
Exec=omerta web
Terminal=true
Categories=Development;Utility;
Icon=omerta-ai
DESK
cp "$APPDIR/omerta-ai.desktop" "$APPDIR/usr/share/applications/"

cat > "$APPDIR/AppRun" <<'RUN'
#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/omerta" "$@"
RUN
chmod +x "$APPDIR/AppRun"

# Fetch appimagetool if not present.
TOOL="build/appimagetool-x86_64.AppImage"
if [ ! -x "$TOOL" ]; then
  curl -sSL -o "$TOOL" \
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage" || true
  chmod +x "$TOOL" 2>/dev/null || true
fi
mkdir -p dist
# FUSE is usually unavailable in CI/sandboxes; extract-and-run avoids it.
if [ -x "$TOOL" ]; then
  ARCH="$ARCH" APPIMAGE_EXTRACT_AND_RUN=1 "$TOOL" "$APPDIR" "dist/OmertaAI-${VERSION}-${ARCH}.AppImage"
  echo "AppImage: engine/dist/OmertaAI-${VERSION}-${ARCH}.AppImage"
else
  echo "appimagetool unavailable; AppDir prepared at $APPDIR (build in CI)"; exit 1
fi
