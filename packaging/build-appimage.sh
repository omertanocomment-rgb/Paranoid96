#!/usr/bin/env bash
# Build a FAT AppImage: one file, its own CPython inside, nothing to install on
# the target machine. No system python3, no pip, no Termux, no network at run
# time.
#
#   bash packaging/build-appimage.sh              # -> dist/OMERTA_AGENT-<ver>-<arch>.AppImage
#   OMERTA_APPIMAGE_PY=pyinstaller  bash ...      # force a payload strategy
#   OMERTA_APPIMAGE_PY=standalone   bash ...      # relocatable CPython (needs network)
#   OMERTA_APPIMAGE_PY=host         bash ...      # thin: use the target's python3
#
# The interpreter payload is chosen by falling back, in this order:
#   1. python-build-standalone  — a real, relocatable CPython with a full
#      stdlib and a working pip. The best result; needs network at BUILD time.
#   2. PyInstaller --onedir     — bundles libpython + the stdlib it can see.
#      Fat, offline, and already a dependency of scripts/build_all.sh.
#   3. the host python3          — thin. Only if neither of the above is
#      possible; the AppImage then needs python3 on the target.
#
# appimagetool is likewise acquired by falling back: PATH -> download and run ->
# download and --appimage-extract (for hosts without FUSE) -> if all of that
# fails, emit a self-extracting .run archive instead so there is always a
# single runnable file at the end. Whatever is produced is smoke-tested before
# this script claims success.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

VER="$(grep -oP 'version\s*=\s*"\K[^"]+' pyproject.toml | head -1)"
ARCH="$(uname -m)"
APPDIR="$ROOT/build_pkg/OMERTA.AppDir"
WORK="$ROOT/build_pkg/appimage-work"
DIST="$ROOT/dist"
STRATEGY="${OMERTA_APPIMAGE_PY:-auto}"
mkdir -p "$DIST" "$WORK"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/src" "$APPDIR/usr/bin"

say()  { printf "\033[93m[appimage]\033[0m %s\n" "$1"; }
warn() { printf "\033[91m[appimage]\033[0m %s\n" "$1" >&2; }

# ── 1. the OMERTA payload ────────────────────────────────────────────────────
say "staging OMERTA source"
for d in core tools skills plugins webui assets scripts firmware docs \
         cli.py server.py omerta_entry.py omerta_android.py \
         persona.yaml connectors.yaml requirements.txt pyproject.toml \
         OMERTA.md README.md CHANGELOG.md; do
  [ -e "$d" ] && cp -r "$d" "$APPDIR/usr/src/"
done
find "$APPDIR/usr/src" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
cp assets/icon_256.png "$APPDIR/omerta.png" 2>/dev/null || :

# ── 2. the interpreter ───────────────────────────────────────────────────────
PAYLOAD=""

try_standalone() {
  # python-build-standalone publishes date-tagged releases. There is no stable
  # "latest" asset URL and the API is often unreachable behind a proxy, so try
  # known-good tags newest-first and take the first that downloads.
  local pytag pyver url tarball triple
  case "$ARCH" in
    x86_64)  triple="x86_64-unknown-linux-gnu" ;;
    aarch64) triple="aarch64-unknown-linux-gnu" ;;
    *) warn "no standalone CPython for $ARCH"; return 1 ;;
  esac
  for pytag in 20250818 20250612 20250409 20241206; do
    for pyver in 3.12.11 3.12.8 3.11.13 3.11.11; do
      url="https://github.com/astral-sh/python-build-standalone/releases/download/${pytag}/cpython-${pyver}+${pytag}-${triple}-install_only.tar.gz"
      tarball="$WORK/cpython.tar.gz"
      if curl -fsSL --max-time 180 -o "$tarball" "$url" 2>/dev/null; then
        say "standalone CPython ${pyver} (${pytag})"
        rm -rf "$WORK/python"
        tar -xzf "$tarball" -C "$WORK"          # unpacks to $WORK/python
        [ -x "$WORK/python/bin/python3" ] || { warn "bad tarball"; continue; }
        cp -a "$WORK/python" "$APPDIR/usr/python"
        # deps go INSIDE the bundle, so the target needs no pip
        "$APPDIR/usr/python/bin/python3" -m pip install -q --no-warn-script-location \
            -r requirements.txt 2>/dev/null \
          || "$APPDIR/usr/python/bin/python3" -m pip install -q requests pyyaml 2>/dev/null \
          || warn "deps not bundled; offline/local models still work"
        find "$APPDIR/usr/python" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
        PAYLOAD="standalone"
        return 0
      fi
    done
  done
  warn "could not fetch a relocatable CPython"
  return 1
}

try_pyinstaller() {
  command -v pyinstaller >/dev/null || python3 -m PyInstaller --version >/dev/null 2>&1 || return 1
  local pyi="pyinstaller"
  command -v pyinstaller >/dev/null || pyi="python3 -m PyInstaller"
  say "PyInstaller --onedir (bundles its own libpython)"
  rm -rf "$WORK/pyi"
  $pyi --onedir --name omerta \
    --distpath "$WORK/pyi/dist" --workpath "$WORK/pyi/build" --specpath "$WORK/pyi" \
    --add-data "$ROOT/skills:skills" --add-data "$ROOT/plugins:plugins" \
    --add-data "$ROOT/webui:webui" --add-data "$ROOT/assets:assets" \
    --add-data "$ROOT/scripts:scripts" --add-data "$ROOT/firmware:firmware" \
    --add-data "$ROOT/persona.yaml:." --add-data "$ROOT/connectors.yaml:." \
    --add-data "$ROOT/pyproject.toml:." \
    --paths "$ROOT" \
    --hidden-import=core --hidden-import=tools \
    --collect-submodules core --collect-submodules tools \
    --exclude-module tkinter --exclude-module matplotlib \
    --exclude-module cryptography --exclude-module OpenSSL \
    --noconfirm --log-level WARN omerta_entry.py >"$WORK/pyi.log" 2>&1 || {
      warn "PyInstaller failed:"; sed -n '1,20p' "$WORK/pyi.log" >&2; return 1; }
  [ -x "$WORK/pyi/dist/omerta/omerta" ] || { warn "no PyInstaller bundle produced"; return 1; }
  cp -a "$WORK/pyi/dist/omerta" "$APPDIR/usr/bundle"
  PAYLOAD="pyinstaller"
}

try_host() {
  warn "falling back to the HOST python3 — this AppImage is THIN"
  warn "  the target machine will need python3 installed"
  PAYLOAD="host"
}

case "$STRATEGY" in
  standalone)  try_standalone || { warn "standalone requested but unavailable"; exit 1; } ;;
  pyinstaller) try_pyinstaller || { warn "pyinstaller requested but unavailable"; exit 1; } ;;
  host)        try_host ;;
  *)           try_standalone || try_pyinstaller || try_host ;;
esac
say "interpreter payload: $PAYLOAD"

# ── 3. AppRun ────────────────────────────────────────────────────────────────
case "$PAYLOAD" in
standalone)
  cat > "$APPDIR/AppRun" <<'SH'
#!/bin/sh
# OMERTA AGENT — self-contained. Runs the CPython bundled beside this file.
HERE="$(dirname "$(readlink -f "$0")")"
PY="$HERE/usr/python/bin/python3"
# Source is read-only inside the AppImage; writable state must live elsewhere.
: "${OMERTA_DATA_DIR:=${XDG_DATA_HOME:-$HOME/.local/share}/omerta-agent}"
export OMERTA_DATA_DIR
export OMERTA_HOME="$HERE/usr/src"
export OMERTA_BUNDLED=1
export PYTHONPATH="$HERE/usr/src${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONDONTWRITEBYTECODE=1
mkdir -p "$OMERTA_DATA_DIR"
exec "$PY" "$HERE/usr/src/omerta_entry.py" "$@"
SH
  ;;
pyinstaller)
  cat > "$APPDIR/AppRun" <<'SH'
#!/bin/sh
# OMERTA AGENT — self-contained (PyInstaller bundle, own libpython).
HERE="$(dirname "$(readlink -f "$0")")"
: "${OMERTA_DATA_DIR:=${XDG_DATA_HOME:-$HOME/.local/share}/omerta-agent}"
export OMERTA_DATA_DIR
export OMERTA_BUNDLED=1
mkdir -p "$OMERTA_DATA_DIR"
exec "$HERE/usr/bundle/omerta" "$@"
SH
  ;;
host)
  cat > "$APPDIR/AppRun" <<'SH'
#!/bin/sh
# OMERTA AGENT — thin build: uses the host python3.
HERE="$(dirname "$(readlink -f "$0")")"
command -v python3 >/dev/null || { echo "OMERTA: this thin build needs python3" >&2; exit 1; }
: "${OMERTA_DATA_DIR:=${XDG_DATA_HOME:-$HOME/.local/share}/omerta-agent}"
export OMERTA_DATA_DIR
export OMERTA_HOME="$HERE/usr/src"
export OMERTA_BUNDLED=1
export PYTHONPATH="$HERE/usr/src${PYTHONPATH:+:$PYTHONPATH}"
mkdir -p "$OMERTA_DATA_DIR"
exec python3 "$HERE/usr/src/omerta_entry.py" "$@"
SH
  ;;
esac
chmod +x "$APPDIR/AppRun"

cat > "$APPDIR/omerta.desktop" <<DESK
[Desktop Entry]
Name=OMERTA AGENT
Comment=Offline-capable coding agent that always asks before it acts
Exec=AppRun
Icon=omerta
Type=Application
Categories=Development;Utility;
Terminal=true
X-AppImage-Version=${VER}
DESK
mkdir -p "$APPDIR/usr/share/applications" \
         "$APPDIR/usr/share/icons/hicolor/256x256/apps"
cp "$APPDIR/omerta.desktop" "$APPDIR/usr/share/applications/" 2>/dev/null || :
cp "$APPDIR/omerta.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/" 2>/dev/null || :

# ── 4. smoke-test the AppDir BEFORE packing it ───────────────────────────────
say "smoke-testing the AppDir"
if ! OMERTA_DATA_DIR="$WORK/smoke-data" "$APPDIR/AppRun" --version >"$WORK/smoke.log" 2>&1; then
  warn "AppRun failed — not packing a broken AppImage:"
  sed -n '1,25p' "$WORK/smoke.log" >&2
  exit 1
fi
say "  $(head -1 "$WORK/smoke.log")"

# ── 5. appimagetool, or a self-extracting fallback ───────────────────────────
OUTFILE="$DIST/OMERTA_AGENT-${VER}-${ARCH}.AppImage"
TOOL=""
if command -v appimagetool >/dev/null; then
  TOOL="appimagetool"
else
  TOOLFILE="$WORK/appimagetool-$ARCH.AppImage"
  if [ ! -x "$TOOLFILE" ]; then
    say "fetching appimagetool"
    curl -fsSL --max-time 180 -o "$TOOLFILE" \
      "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage" \
      2>/dev/null && chmod +x "$TOOLFILE" || rm -f "$TOOLFILE"
  fi
  if [ -x "$TOOLFILE" ]; then
    if "$TOOLFILE" --version >/dev/null 2>&1; then
      TOOL="$TOOLFILE"
    else
      say "no FUSE — extracting appimagetool instead"
      ( cd "$WORK" && rm -rf squashfs-root && "$TOOLFILE" --appimage-extract >/dev/null 2>&1 ) \
        && [ -x "$WORK/squashfs-root/AppRun" ] && TOOL="$WORK/squashfs-root/AppRun"
    fi
  fi
fi

if [ -n "$TOOL" ]; then
  say "packing with appimagetool"
  if ( cd "$ROOT" && ARCH="$ARCH" "$TOOL" "$APPDIR" "$OUTFILE" >"$WORK/pack.log" 2>&1 ); then
    chmod +x "$OUTFILE"
    say "built $OUTFILE ($(du -h "$OUTFILE" | cut -f1), payload: $PAYLOAD)"
    exit 0
  fi
  warn "appimagetool failed:"; sed -n '1,20p' "$WORK/pack.log" >&2
fi

# Never leave the user with nothing: a self-extracting archive is a single
# runnable file with the same contents, it just isn't squashfs-mounted.
warn "no usable appimagetool — emitting a self-extracting archive instead"
RUNFILE="$DIST/OMERTA_AGENT-${VER}-${ARCH}.run"
PAYLOAD_TGZ="$WORK/payload.tar.gz"
( cd "$(dirname "$APPDIR")" && tar -czf "$PAYLOAD_TGZ" "$(basename "$APPDIR")" )
cat > "$RUNFILE" <<'STUB'
#!/bin/sh
# OMERTA AGENT — self-extracting bundle (AppImage fallback: same contents,
# unpacked to a cache dir on first run instead of mounted via FUSE).
set -e
# Unpack to a private, user-owned cache. This script execs what it finds there,
# so the directory must not be one another account can write to or pre-seed.
BASE="${XDG_CACHE_HOME:-${HOME:+$HOME/.cache}}"
[ -n "$BASE" ] || BASE="${TMPDIR:-/tmp}/omerta-$(id -u)"
CACHE="$BASE/omerta-agent-bundle"
SELF="$(readlink -f "$0")"
LINE=$(awk '/^__OMERTA_PAYLOAD__$/{print NR+1; exit 0}' "$SELF")
STAMP=$(cksum "$SELF" | cut -d' ' -f1)
DEST="$CACHE/$STAMP"
if [ ! -x "$DEST/OMERTA.AppDir/AppRun" ]; then
  [ ! -e "$CACHE" ] || rm -rf "$CACHE"
  (umask 077; mkdir -p "$DEST")
  tail -n "+$LINE" "$SELF" | tar -xzf - -C "$DEST"
fi
# refuse to exec a tree we do not own (someone else planted it)
if [ ! -O "$DEST/OMERTA.AppDir/AppRun" ]; then
  echo "OMERTA: refusing to run $DEST — not owned by this user" >&2
  exit 1
fi
exec "$DEST/OMERTA.AppDir/AppRun" "$@"
__OMERTA_PAYLOAD__
STUB
cat "$PAYLOAD_TGZ" >> "$RUNFILE"
chmod +x "$RUNFILE"
say "smoke-testing the .run"
OMERTA_DATA_DIR="$WORK/run-smoke-data" "$RUNFILE" --version >"$WORK/runsmoke.log" 2>&1 || {
  warn "self-extracting archive failed its smoke test:"; sed -n '1,20p' "$WORK/runsmoke.log" >&2; exit 1; }
say "  $(head -1 "$WORK/runsmoke.log")"
say "built $RUNFILE ($(du -h "$RUNFILE" | cut -f1), payload: $PAYLOAD)"
