#!/usr/bin/env bash
# Build a Debian .deb wrapping the PyInstaller binary (self-contained; no python dep).
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION="$(python3 -c 'import omerta; print(omerta.__version__)')"
ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
PKG="omerta-ai_${VERSION}_${ARCH}"
ROOT="build/deb/${PKG}"
rm -rf "$ROOT"
mkdir -p "$ROOT/DEBIAN" "$ROOT/usr/bin" "$ROOT/usr/share/applications" \
         "$ROOT/usr/share/omerta-ai" "$ROOT/usr/share/icons/hicolor/scalable/apps"

[ -f dist/omerta ] || bash packaging/pyinstaller/build-binary.sh
install -m0755 dist/omerta "$ROOT/usr/bin/omerta"
cp OMERTA.md "$ROOT/usr/share/omerta-ai/OMERTA.md"
cp packaging/appimage/omerta.svg "$ROOT/usr/share/icons/hicolor/scalable/apps/omerta-ai.svg" 2>/dev/null || true

cat > "$ROOT/usr/share/applications/omerta-ai.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=OMERTA AI
Comment=Evidence-backed engineering agent
Exec=omerta web
Terminal=true
Categories=Development;Utility;
Icon=omerta-ai
DESK

cat > "$ROOT/DEBIAN/control" <<CTRL
Package: omerta-ai
Version: ${VERSION}
Section: devel
Priority: optional
Architecture: ${ARCH}
Maintainer: OMERTA <noreply@omerta.local>
Description: OMERTA AI — evidence-backed engineering / coding / firmware agent
 CLI + web/API engine with SQLite memory, codebase intelligence, sandboxed
 build/test/debug loop, multi-agent orchestration and firmware inspection.
CTRL

mkdir -p dist
dpkg-deb --build --root-owner-group "$ROOT" "dist/${PKG}.deb"
echo "Deb: engine/dist/${PKG}.deb"
