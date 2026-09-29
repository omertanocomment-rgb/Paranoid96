#!/usr/bin/env bash
# Build a native, double-click-installable .deb for Linux Mint / Ubuntu / Debian.
# The whole app is inside the package: the offline brain engine + a native Tk GUI.
# No web app, no server, no terminal backend. Depends only on python3 + python3-tk
# (both preinstalled or one apt away on Mint). For a zero-dependency single binary,
# use build-appimage.sh / build-binary.sh instead.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOTDIR="$(pwd)"
VERSION="$(python3 omerta_desktop.py --version | awk '{print $NF}')"
ARCH="all"
PKG="omerta-ai-desktop_${VERSION}_${ARCH}"
BUILD="build/${PKG}"
APPDIR="/usr/share/omerta-ai-desktop"

rm -rf "$BUILD"
mkdir -p "$BUILD/DEBIAN" "$BUILD/usr/bin" "$BUILD${APPDIR}" \
         "$BUILD/usr/share/applications" "$BUILD/usr/share/icons/hicolor/scalable/apps"

# App code + shared engine + bundled default brain (all offline).
install -m0644 omerta_desktop.py "$BUILD${APPDIR}/omerta_desktop.py"
install -m0644 ../brain/omerta_brain.py "$BUILD${APPDIR}/omerta_brain.py"
if [ -f ../brain/brains/omerta.brain ]; then
  install -m0644 ../brain/brains/omerta.brain "$BUILD${APPDIR}/omerta.brain"
fi
install -m0644 assets/omerta-ai.svg "$BUILD/usr/share/icons/hicolor/scalable/apps/omerta-ai.svg"
[ -f ../design/logo/omerta-256.png ] && install -m0644 ../design/logo/omerta-256.png "$BUILD${APPDIR}/omerta-256.png" || true
for sz in 16 32 64 256; do
  if [ -f "../design/logo/omerta-$sz.png" ]; then
    mkdir -p "$BUILD/usr/share/icons/hicolor/${sz}x${sz}/apps"
    install -m0644 "../design/logo/omerta-$sz.png" "$BUILD/usr/share/icons/hicolor/${sz}x${sz}/apps/omerta-ai.png"
  fi
done

# Launcher.
cat > "$BUILD/usr/bin/omerta-ai" <<'LAUNCH'
#!/bin/sh
exec python3 /usr/share/omerta-ai-desktop/omerta_desktop.py "$@"
LAUNCH
chmod 0755 "$BUILD/usr/bin/omerta-ai"

# Desktop menu entry (Terminal=false → real windowed app, not a terminal backend).
cat > "$BUILD/usr/share/applications/omerta-ai.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Omerta AI
GenericName=Offline AI brain
Comment=Your teachable, offline AI brain — runs entirely on this computer
Exec=omerta-ai
Icon=omerta-ai
Terminal=false
Categories=Utility;Education;Development;
Keywords=AI;assistant;offline;brain;chat;
DESK

INSTALLED_KB="$(du -sk "$BUILD${APPDIR}" | cut -f1)"
cat > "$BUILD/DEBIAN/control" <<CTRL
Package: omerta-ai-desktop
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Depends: python3 (>= 3.8), python3-tk
Installed-Size: ${INSTALLED_KB}
Maintainer: OMERTA <noreply@omerta.local>
Description: Omerta AI — offline, teachable AI brain (native desktop app)
 A native Linux desktop app (Tk, no browser) for the offline Omerta brain: chat,
 teach it by talking, load documents, give it a personality, and import/export
 portable .brain files. Everything runs on-device — no server, no web app, no
 network. Brains are compatible with the Omerta AI Android app.
CTRL

cat > "$BUILD/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi
exit 0
POST
chmod 0755 "$BUILD/DEBIAN/postinst"

mkdir -p dist
dpkg-deb --build --root-owner-group "$BUILD" "dist/${PKG}.deb" >/dev/null
echo "Deb: desktop/dist/${PKG}.deb"
