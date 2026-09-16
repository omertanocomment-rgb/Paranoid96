#!/usr/bin/env bash
# Build a "thin" AppImage: bundles the OMERTA source and an AppRun that uses the
# host python3 (+ requests/pyyaml). Needs `appimagetool` on PATH.
#
#   bash packaging/build-appimage.sh     # -> dist/OMERTA_AGENT-<ver>-x86_64.AppImage
set -euo pipefail
cd "$(dirname "$0")/.."
command -v appimagetool >/dev/null || { echo "install appimagetool first"; exit 1; }
VER="$(grep -oP 'version\s*=\s*"\K[^"]+' pyproject.toml | head -1)"
APPDIR="build_pkg/OMERTA.AppDir"
rm -rf "$APPDIR"; mkdir -p "$APPDIR/usr/src" "$APPDIR/usr/share/icons"
for d in core tools skills plugins webui assets scripts firmware \
         cli.py server.py omerta_entry.py persona.yaml connectors.yaml requirements.txt; do
  [ -e "$d" ] && cp -r "$d" "$APPDIR/usr/src/"
done
cp assets/icon_256.png "$APPDIR/omerta.png" 2>/dev/null || true
cat > "$APPDIR/AppRun" <<'SH'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec python3 "$HERE/usr/src/omerta_entry.py" "$@"
SH
chmod +x "$APPDIR/AppRun"
cat > "$APPDIR/omerta.desktop" <<'DESK'
[Desktop Entry]
Name=OMERTA AGENT
Exec=AppRun
Icon=omerta
Type=Application
Categories=Development;
Terminal=true
DESK
mkdir -p dist
ARCH=x86_64 appimagetool "$APPDIR" "dist/OMERTA_AGENT-${VER}-x86_64.AppImage"
echo "built dist/OMERTA_AGENT-${VER}-x86_64.AppImage"
