#!/usr/bin/env bash
# ============================================================================
#  OMERTA - Complete Start-to-Finish Linux Installer
#  Run this once on a fresh machine. It will:
#    1. Detect your distro and package manager
#    2. Install Node.js if missing
#    3. Install system dependencies (FUSE, libusb, etc.)
#    4. Run npm install
#    5. Set up udev rules so ADB/USB devices work without sudo
#    6. Download all device-management tools into bin/
#    7. Offer to launch or build the app
#
#  Safe to re-run any time - every step skips work that is already done.
# ============================================================================

set +e   # Don't abort on individual command failures - we handle errors per-step
cd "$(dirname "$0")"
LOG="install-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

BINDIR="$(pwd)/bin"
mkdir -p "$BINDIR"

ok()   { echo "  [OK] $1"; }
info() { echo "  [..] $1"; }
warn() { echo "  [!!] $1"; }
step() { echo ""; echo "=========================================="; echo " $1"; echo "=========================================="; }

step "OMERTA Installer - $(date)"
echo "Log saved to: $LOG"

# ── 1. Detect package manager ───────────────────────────────────────────────
step "[1/7] Detecting system"
if command -v apt-get &>/dev/null; then PKG_MGR="apt"
elif command -v dnf &>/dev/null; then PKG_MGR="dnf"
elif command -v pacman &>/dev/null; then PKG_MGR="pacman"
elif command -v zypper &>/dev/null; then PKG_MGR="zypper"
else PKG_MGR="unknown"; fi
ok "Package manager: $PKG_MGR"
ok "OS: $(uname -srm)"

pkg_install() {
  # Usage: pkg_install pkgname1 pkgname2 ...  (best-effort, never aborts the script)
  case "$PKG_MGR" in
    apt)    sudo apt-get install -y "$@" 2>&1 | tail -5 ;;
    dnf)    sudo dnf install -y "$@" 2>&1 | tail -5 ;;
    pacman) sudo pacman -S --noconfirm "$@" 2>&1 | tail -5 ;;
    zypper) sudo zypper install -y "$@" 2>&1 | tail -5 ;;
    *)      warn "Unknown package manager - install manually: $*" ;;
  esac
}

# ── 2. Node.js ───────────────────────────────────────────────────────────────
step "[2/7] Node.js"
if command -v node &>/dev/null && [ "$(node -v | sed 's/v//;s/\..*//')" -ge 18 ]; then
  ok "Node.js $(node --version) already installed"
else
  info "Installing Node.js 20 via nvm..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install 20 && nvm use 20
  if command -v node &>/dev/null; then ok "Node.js $(node --version) installed"
  else warn "Node.js install failed - install manually from nodejs.org"; fi
fi
echo "  npm: $(npm --version 2>/dev/null || echo 'not found')"

# ── 3. System dependencies ────────────────────────────────────────────────────
step "[3/7] System dependencies (best-effort, skips already-installed)"
if [ "$PKG_MGR" = "apt" ]; then
  sudo apt-get update -q -o Acquire::ForceIPv4=true 2>&1 | tail -3
  for pkg in build-essential libusb-1.0-0-dev libudev-dev fakeroot rpm \
             android-tools-adb android-tools-fastboot scrcpy ffmpeg \
             libimobiledevice6 libimobiledevice-utils usbmuxd ideviceinstaller \
             ifuse unzip wget curl python3 java-common default-jre; do
    dpkg -s "$pkg" &>/dev/null && { ok "$pkg"; continue; }
    info "Installing $pkg..."
    pkg_install "$pkg" || warn "$pkg not available - continuing"
  done
  # FUSE - needed to run AppImages (renamed in some distros)
  if ! dpkg -s libfuse2 &>/dev/null && ! dpkg -s libfuse2t64 &>/dev/null; then
    pkg_install libfuse2t64 || pkg_install libfuse2 || warn "libfuse2 unavailable - run AppImage with --appimage-extract-and-run instead"
  fi
elif [ "$PKG_MGR" = "dnf" ]; then
  pkg_install gcc-c++ make libusb-devel systemd-devel fuse fakeroot rpm-build \
    android-tools scrcpy ffmpeg libimobiledevice libimobiledevice-utils usbmuxd \
    ifuse unzip wget curl python3 java-latest-openjdk
elif [ "$PKG_MGR" = "pacman" ]; then
  pkg_install base-devel libusb fuse2 android-tools scrcpy ffmpeg \
    libimobiledevice usbmuxd ifuse unzip wget curl python jdk-openjdk
fi

# ── 4. npm install ─────────────────────────────────────────────────────────────
step "[4/7] npm dependencies"
if [ -f node_modules/electron/package.json ]; then
  ok "node_modules already installed"
else
  info "Running npm install (this can take a few minutes)..."
  npm install
  if [ $? -eq 0 ]; then ok "npm install complete"
  else warn "npm install had errors - check $LOG"; fi
fi

# ── 5. udev rules for USB device access without sudo ────────────────────────
step "[5/7] udev rules (USB permissions for Android/iOS devices)"
UDEV_FILE="/etc/udev/rules.d/51-android.rules"
if [ -f "$UDEV_FILE" ]; then
  ok "udev rules already present"
else
  info "Installing udev rules..."
  sudo tee "$UDEV_FILE" > /dev/null << 'UDEV'
# Android vendors
SUBSYSTEM=="usb", ATTR{idVendor}=="18d1", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="04e8", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="22b8", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="2717", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="12d1", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="0bb4", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="19d2", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="0fce", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="05c6", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="0b05", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="17ef", MODE="0666", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="1004", MODE="0666", GROUP="plugdev"
# Apple
SUBSYSTEM=="usb", ATTR{idVendor}=="05ac", MODE="0666", GROUP="plugdev"
UDEV
  sudo udevadm control --reload-rules && sudo udevadm trigger
  sudo usermod -aG plugdev "$USER"
  ok "udev rules installed (log out/in for group change to take effect)"
fi

# ── 6. Download tools into bin/ ──────────────────────────────────────────────
step "[6/7] Downloading device-management tools into bin/"

dl() { # dl <url> <dest>  - quiet download with progress, returns 0/1
  curl -fL --progress-bar -o "$2" "$1" 2>&1 | tail -1
  [ -s "$2" ]
}

# ADB + fastboot (also covers fallback if apt package wasn't found above)
if [ -f "$BINDIR/adb" ]; then ok "adb"
else
  info "ADB/fastboot..."
  if command -v adb &>/dev/null; then
    cp "$(command -v adb)" "$BINDIR/adb"; ok "adb (system)"
  else
    dl "https://dl.google.com/android/repository/platform-tools-latest-linux.zip" /tmp/pt.zip \
      && unzip -qo /tmp/pt.zip -d /tmp/pt_ext \
      && cp /tmp/pt_ext/platform-tools/adb "$BINDIR/adb" \
      && chmod +x "$BINDIR/adb" && ok "adb (downloaded)" || warn "adb failed"
    rm -rf /tmp/pt_ext /tmp/pt.zip
  fi
fi
if [ -f "$BINDIR/fastboot" ]; then ok "fastboot"
else
  command -v fastboot &>/dev/null && { cp "$(command -v fastboot)" "$BINDIR/fastboot"; ok "fastboot (system)"; } \
    || warn "fastboot not found - install android-tools-fastboot"
fi

# scrcpy
if [ -f "$BINDIR/scrcpy" ]; then ok "scrcpy"
else command -v scrcpy &>/dev/null && { cp "$(command -v scrcpy)" "$BINDIR/scrcpy"; ok "scrcpy (system)"; } || warn "scrcpy not found"
fi

# libimobiledevice (iOS tools)
IOS_TOOLS="idevice_id ideviceinfo idevicebackup2 idevicepair idevicescreenshot idevicesyslog idevicediagnostics ideviceinstaller idevicecrashreport idevicedate idevicename ideviceenterrecovery idevicenotificationproxy ideviceprovision ideviceactivation idevicedebug ideviceimagemounter"
MISSING_IOS=0
for tool in $IOS_TOOLS; do [ -f "$BINDIR/$tool" ] || MISSING_IOS=1; done
if [ "$MISSING_IOS" -eq 0 ]; then ok "iOS tools (all present)"
else
  info "iOS tools (libimobiledevice)..."
  for tool in $IOS_TOOLS; do
    [ -f "$BINDIR/$tool" ] && continue
    p=$(command -v "$tool" 2>/dev/null)
    [ -n "$p" ] && cp "$p" "$BINDIR/$tool" && chmod +x "$BINDIR/$tool"
  done
  [ -f "$BINDIR/idevice_id" ] && ok "iOS tools copied from system" \
    || warn "iOS tools missing - run: sudo apt install libimobiledevice-utils ideviceinstaller"
fi

# ffmpeg / ffprobe
if [ -f "$BINDIR/ffmpeg" ] && [ -f "$BINDIR/ffprobe" ]; then ok "ffmpeg/ffprobe"
else
  info "ffmpeg..."
  if command -v ffmpeg &>/dev/null; then
    cp "$(command -v ffmpeg)" "$BINDIR/ffmpeg"
    cp "$(command -v ffprobe)" "$BINDIR/ffprobe" 2>/dev/null
    ok "ffmpeg/ffprobe (system)"
  else
    info "Downloading static ffmpeg build (~40MB, may take a while)..."
    dl "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" /tmp/ffm.tar.xz \
      && tar xf /tmp/ffm.tar.xz -C /tmp \
      && cp /tmp/ffmpeg-*-static/ffmpeg /tmp/ffmpeg-*-static/ffprobe "$BINDIR/" \
      && chmod +x "$BINDIR/ffmpeg" "$BINDIR/ffprobe" \
      && ok "ffmpeg/ffprobe (downloaded)" || warn "ffmpeg download failed"
    rm -rf /tmp/ffmpeg-*-static /tmp/ffm.tar.xz
  fi
fi

# apktool
if [ -f "$BINDIR/apktool.jar" ]; then ok "apktool"
else
  info "apktool..."
  URL=$(curl -fsL https://api.github.com/repos/iBotPeaches/Apktool/releases/latest \
    | grep -o '"browser_download_url": *"[^"]*apktool_[^"]*\.jar"' | head -1 \
    | sed 's/.*"\(https[^"]*\)"/\1/')
  if [ -n "$URL" ]; then
    dl "$URL" "$BINDIR/apktool.jar" && {
      printf '#!/usr/bin/env bash\njava -jar "%s/apktool.jar" "$@"\n' "$BINDIR" > "$BINDIR/apktool"
      chmod +x "$BINDIR/apktool"
      ok "apktool"
    } || warn "apktool download failed"
  else warn "apktool: could not resolve download URL"; fi
fi

# magiskboot (extracted from Magisk APK)
if [ -f "$BINDIR/magiskboot" ]; then ok "magiskboot"
else
  info "magiskboot (from Magisk APK)..."
  APK_URL=$(curl -fsL https://api.github.com/repos/topjohnwu/Magisk/releases/latest \
    | grep -o '"browser_download_url": *"[^"]*Magisk-[^"]*\.apk"' | head -1 \
    | sed 's/.*"\(https[^"]*\)"/\1/')
  if [ -n "$APK_URL" ]; then
    dl "$APK_URL" /tmp/magisk.apk \
      && unzip -qo /tmp/magisk.apk -d /tmp/mag_ext \
      && MB=$(find /tmp/mag_ext -name "magiskboot" -type f | head -1) \
      && [ -n "$MB" ] && cp "$MB" "$BINDIR/magiskboot" && chmod +x "$BINDIR/magiskboot" \
      && ok "magiskboot" || warn "magiskboot extraction failed"
    rm -rf /tmp/mag_ext /tmp/magisk.apk
  else warn "magiskboot: could not resolve Magisk APK URL"; fi
fi

# zsign (iOS IPA signer)
if [ -f "$BINDIR/zsign" ]; then ok "zsign"
else
  info "zsign (iOS IPA signer)..."
  URL=$(curl -fsL https://api.github.com/repos/zhlynn/zsign/releases/latest \
    | grep -o '"browser_download_url": *"[^"]*linux[^"]*"' | head -1 \
    | sed 's/.*"\(https[^"]*\)"/\1/')
  if [ -n "$URL" ]; then
    dl "$URL" "$BINDIR/zsign" && chmod +x "$BINDIR/zsign" && ok "zsign" || warn "zsign download failed"
  else warn "zsign: no Linux binary in latest release - build from source if needed"; fi
fi

# Done with tools
echo ""
echo "  --- bin/ contents ---"
ls -lh "$BINDIR" | awk '{print "  "$0}'

# ── 7. Finish ─────────────────────────────────────────────────────────────────
step "[7/7] Done!"
echo "Install log: $LOG"
echo ""
echo "Next steps:"
echo "  npm run dev              # launch in development mode"
echo "  npm run build:linux      # build AppImage + deb + tar.gz"
echo ""
read -p "Launch Omerta now? (y/N): " LAUNCH
if [[ "$LAUNCH" =~ ^[Yy]$ ]]; then
  npm run dev
fi
