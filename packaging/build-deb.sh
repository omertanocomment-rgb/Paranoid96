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
PKG="omerta-agent_${VER}_all"
ROOT="build_pkg/deb/${PKG}"
rm -rf "$ROOT"
mkdir -p "$ROOT/DEBIAN" "$ROOT/opt/omerta-agent" "$ROOT/usr/bin"

# payload: the source the launcher runs (skip heavy/dev dirs)
for d in core tools skills plugins webui assets scripts firmware \
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

INSTALLED_KB=$(du -ks "$ROOT/opt" | cut -f1)
cat > "$ROOT/DEBIAN/control" <<CTL
Package: omerta-agent
Version: ${VER}
Section: devel
Priority: optional
Architecture: all
Depends: python3 (>= 3.9), python3-requests, python3-yaml
Recommends: python3-rich, git, adb, fastboot, device-tree-compiler
Installed-Size: ${INSTALLED_KB}
Maintainer: OMERTA
Description: Offline-capable coding & firmware agent that asks before it acts
 Model-agnostic engineering agent with an always-ask approval gate, persistent
 memory, cross-device sync, MCP connectors, and firmware bring-up tooling.
 Run: omerta  (interactive) | omerta serve | omerta doctor.
CTL

mkdir -p dist
dpkg-deb --build --root-owner-group "$ROOT" "dist/${PKG}.deb"
echo "built dist/${PKG}.deb"
