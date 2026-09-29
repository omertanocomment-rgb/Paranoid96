#!/data/data/com.termux/files/usr/bin/bash
# ============================================================================
#  OMERTA - Termux Automated Setup
#  Installs everything needed to run Omerta as a web server on Android.
#  Run inside Termux: bash setup.sh
# ============================================================================
set +e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG="$SCRIPT_DIR/termux-install.log"
exec > >(tee -a "$LOG") 2>&1

ok()   { echo "  [OK] $1"; }
info() { echo "  [..] $1"; }
warn() { echo "  [!!] $1"; }
step() { echo ""; echo "=========================================="; echo " $1"; echo "=========================================="; }

step "OMERTA Termux Installer - $(date)"
echo "Project: $PROJECT_DIR"
echo "Log: $LOG"

# ── 1. Termux storage permission ────────────────────────────────────────────
step "[1/7] Termux storage"
if [ ! -d "$HOME/storage" ]; then
  info "Requesting storage permission (tap Allow in the popup)..."
  termux-setup-storage
  sleep 3
else
  ok "Storage already set up"
fi

# ── 2. Update packages ───────────────────────────────────────────────────────
step "[2/7] Update Termux packages"
info "Updating package index..."
pkg update -y 2>&1 | tail -3
ok "Package index updated"

# ── 3. Install system packages ──────────────────────────────────────────────
step "[3/7] System packages"
PACKAGES="nodejs npm python3 git curl wget unzip tar openssh adb android-tools"
for pkg in $PACKAGES; do
  if pkg list-installed 2>/dev/null | grep -q "^$pkg/"; then
    ok "$pkg"
  else
    info "Installing $pkg..."
    pkg install -y "$pkg" 2>&1 | tail -3
    pkg list-installed 2>/dev/null | grep -q "^$pkg/" && ok "$pkg" || warn "$pkg may not be available"
  fi
done

# Check node
node --version &>/dev/null && ok "Node.js $(node --version)" || warn "Node.js not found"
npm --version &>/dev/null && ok "npm $(npm --version)" || warn "npm not found"

# ── 4. npm dependencies ──────────────────────────────────────────────────────
step "[4/7] npm dependencies"
cd "$PROJECT_DIR"
if [ -f node_modules/.package-lock.json ]; then
  ok "node_modules already installed"
else
  info "Running npm install..."
  npm install --no-audit --no-fund 2>&1 | tail -10
  ok "npm install complete"
fi

# Install server-specific packages if missing
info "Ensuring server dependencies..."
npm list express &>/dev/null || npm install --save-dev express ws multer 2>&1 | tail -3
ok "Server dependencies ready"

# ── 5. Download tools into bin/ ─────────────────────────────────────────────
step "[5/7] Downloading device-management tools"
BINDIR="$PROJECT_DIR/bin"
mkdir -p "$BINDIR"

# ADB - try system first, then direct install
if [ -f "$BINDIR/adb" ]; then ok "adb"
elif command -v adb &>/dev/null; then
  cp "$(command -v adb)" "$BINDIR/adb"; ok "adb (system copy)"
else
  info "ADB not found - install via: pkg install android-tools"
  warn "adb missing"
fi

# libimobiledevice (limited support in Termux)
LIBIMOBILE_TOOLS="idevice_id ideviceinfo idevicepair idevicebackup2 idevicescreenshot idevicesyslog ideviceinstaller ideviceenterrecovery"
MISSING=0
for t in $LIBIMOBILE_TOOLS; do [ -f "$BINDIR/$t" ] || MISSING=1; done
if [ "$MISSING" -eq 0 ]; then
  ok "iOS tools"
else
  info "Checking iOS tools (libimobiledevice support in Termux is limited)..."
  if pkg list-installed 2>/dev/null | grep -q "libimobiledevice"; then
    for t in $LIBIMOBILE_TOOLS; do
      p=$(command -v "$t" 2>/dev/null); [ -n "$p" ] && cp "$p" "$BINDIR/$t"
    done
    [ -f "$BINDIR/idevice_id" ] && ok "iOS tools" || warn "iOS tools: not available in Termux - use Linux host for iOS features"
  else
    pkg install -y libimobiledevice 2>&1 | tail -2 || warn "libimobiledevice unavailable in Termux"
  fi
fi

# ffmpeg
if [ -f "$BINDIR/ffmpeg" ]; then ok "ffmpeg"
elif command -v ffmpeg &>/dev/null; then
  cp "$(command -v ffmpeg)" "$BINDIR/ffmpeg" 2>/dev/null
  cp "$(command -v ffprobe)" "$BINDIR/ffprobe" 2>/dev/null
  ok "ffmpeg"
else
  info "Installing ffmpeg..."
  pkg install -y ffmpeg 2>&1 | tail -3
  command -v ffmpeg &>/dev/null && { cp "$(command -v ffmpeg)" "$BINDIR/ffmpeg"; ok "ffmpeg"; } || warn "ffmpeg not available"
fi

# scrcpy
if [ -f "$BINDIR/scrcpy" ]; then ok "scrcpy"
elif command -v scrcpy &>/dev/null; then
  cp "$(command -v scrcpy)" "$BINDIR/scrcpy" 2>/dev/null; ok "scrcpy"
else
  pkg install -y scrcpy 2>&1 | tail -3
  command -v scrcpy &>/dev/null && ok "scrcpy" || warn "scrcpy not available on arm - use host machine"
fi

echo "  --- bin/ contents ---"
ls -lh "$BINDIR/" 2>/dev/null | awk '{print "  "$0}'

# ── 6. Create Termux service and launcher ────────────────────────────────────
step "[6/7] Setting up Termux launcher"

# Create the start script
cat > "$SCRIPT_DIR/start.sh" << 'START'
#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")/.."
PORT=${OMERTA_PORT:-3000}
export OMERTA_TERMUX=1
echo ""
echo "  ================================"
echo "   OMERTA - Starting web server"
echo "  ================================"
echo "  Port: $PORT"
echo "  Open in browser: http://localhost:$PORT"
echo "  Press Ctrl+C to stop"
echo ""
node termux/server.js
START
chmod +x "$SCRIPT_DIR/start.sh"
ok "start.sh created"

# Create termux-url-opener friendly shortcut
mkdir -p "$HOME/.shortcuts"
cat > "$HOME/.shortcuts/Omerta" << SHORTCUT
#!/data/data/com.termux/files/usr/bin/bash
cd ~/Downloads/freetoolz
bash termux/start.sh
SHORTCUT
chmod +x "$HOME/.shortcuts/Omerta"
ok "Termux:Widget shortcut created (install Termux:Widget from F-Droid to use)"

# ── 7. Done ──────────────────────────────────────────────────────────────────
step "[7/7] Installation complete!"
echo ""
echo "  To start Omerta:"
echo "    cd ~/Downloads/freetoolz && bash termux/start.sh"
echo ""
echo "  Then open in Android browser:"
echo "    http://localhost:3000"
echo ""
echo "  Or install Termux:Widget (F-Droid) and tap the 'Omerta' shortcut"
echo ""
read -p "  Start server now? (y/N): " START_NOW
if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
  cd "$PROJECT_DIR"
  bash "$SCRIPT_DIR/start.sh"
fi
