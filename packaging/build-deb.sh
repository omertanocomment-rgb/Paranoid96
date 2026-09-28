#!/usr/bin/env bash
# Build a .deb that installs OMERTA to /opt and a /usr/bin/omerta launcher.
# Runs from the repo source against the system python3 + its deps.
#
#   bash packaging/build-deb.sh            # -> dist/omerta-agent_<ver>_all.deb
set -euo pipefail
cd "$(dirname "$0")/.."
VER="$(python3 - <<'PY'
import re
m=re.search(r'version\s*=\s*"([^"]+)"', open("pyproject.toml").read())
if not m:
    raise SystemExit("pyproject.toml has no version -- refusing to label the "
                     "package with a guess")
print(m.group(1))
PY
)"
# Stamp before the payload is copied, or the .deb ships whichever channel the
# previous build left in core/build_stamp.json.
python3 scripts/stamp_build.py deb

PKG="omerta-agent_${VER}_all"
ROOT="build_pkg/deb/${PKG}"
rm -rf "$ROOT"
mkdir -p "$ROOT/DEBIAN" "$ROOT/opt/omerta-agent" "$ROOT/usr/bin"

# payload: the source the launcher runs (skip heavy/dev dirs)
for d in core tools skills plugins webui assets scripts firmware desktop_native \
         cli.py server.py omerta_entry.py persona.yaml connectors.yaml \
         requirements.txt README.md LICENSE OMERTA.md; do
  [ -e "$d" ] && cp -r "$d" "$ROOT/opt/omerta-agent/"
done

# This install has no pyproject.toml and is not pip-installed, so neither of
# the usual version sources is available to `omerta --version`. Ship the file.
printf '%s\n' "$VER" > "$ROOT/opt/omerta-agent/VERSION"

cat > "$ROOT/usr/bin/omerta" <<'SH'
#!/bin/sh
exec python3 /opt/omerta-agent/omerta_entry.py "$@"
SH
chmod 0755 "$ROOT/usr/bin/omerta"

# The desktop application. It is a real installed program with a menu entry
# and its own window: no terminal to keep open, no browser tab, and no HTTP
# server -- the window serves the UI from this process over a private URI
# scheme and calls core/dispatch directly, exactly as the Android app does.
cat > "$ROOT/usr/bin/omerta-desktop" <<'SH'
#!/bin/sh
exec python3 /opt/omerta-agent/desktop_native/omerta_desktop.py "$@"
SH
chmod 0755 "$ROOT/usr/bin/omerta-desktop"

mkdir -p "$ROOT/usr/share/applications"
cp packaging/omerta.desktop "$ROOT/usr/share/applications/omerta-agent.desktop"

# Icons at every size the shell may ask for, so the launcher is not a blank
# square in the applications menu.
for px in 16 24 32 48 64 128 256 512; do
  src="assets/icon_${px}.png"
  [ -f "$src" ] || continue
  dst="$ROOT/usr/share/icons/hicolor/${px}x${px}/apps"
  mkdir -p "$dst"
  cp "$src" "$dst/omerta-agent.png"
done
if [ -f assets/icon.svg ]; then
  mkdir -p "$ROOT/usr/share/icons/hicolor/scalable/apps"
  cp assets/icon.svg "$ROOT/usr/share/icons/hicolor/scalable/apps/omerta-agent.svg"
fi

INSTALLED_KB=$(du -ks "$ROOT/opt" | cut -f1)
cat > "$ROOT/DEBIAN/control" <<CTL
Package: omerta-agent
Version: ${VER}
Section: devel
Priority: optional
Architecture: all
Depends: python3 (>= 3.9), python3-requests, python3-yaml,
 python3-gi, gir1.2-gtk-3.0, gir1.2-webkit2-4.1 | gir1.2-webkit2-4.0
Recommends: python3-rich, git, adb, fastboot, device-tree-compiler
Installed-Size: ${INSTALLED_KB}
Maintainer: OMERTA
Description: Offline-capable coding & firmware agent that asks before it acts
 Model-agnostic engineering agent with an always-ask approval gate, persistent
 memory, cross-device sync, MCP connectors, and firmware bring-up tooling.
 Run: omerta-desktop (windowed app) | omerta (interactive) | omerta doctor.
CTL

# Refresh the desktop database and icon cache so the entry appears without a
# logout. Both are best-effort: a missing tool is not a failed install.
mkdir -p "$ROOT/DEBIAN"
cat > "$ROOT/DEBIAN/postinst" <<'SH'
#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
exit 0
SH
chmod 0755 "$ROOT/DEBIAN/postinst"
cp "$ROOT/DEBIAN/postinst" "$ROOT/DEBIAN/postrm"

mkdir -p dist
dpkg-deb --build --root-owner-group "$ROOT" "dist/${PKG}.deb"
echo "built dist/${PKG}.deb"
