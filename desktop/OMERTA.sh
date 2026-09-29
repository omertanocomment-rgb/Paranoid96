#!/usr/bin/env bash
# Omerta - Device Management Suite (Linux launcher)
set -e
cd "$(dirname "$0")"

print_menu() {
  clear
  echo ""
  echo " ==========================================="
  echo "  OMERTA - Device Management Suite (Linux)"
  echo " ==========================================="
  echo ""

  NODE_OK=0; NPM_OK=0; TOOLS_OK=0
  command -v node >/dev/null 2>&1 && NODE_OK=1
  [ -f node_modules/electron/package.json ] && NPM_OK=1
  [ -f bin/adb ] && TOOLS_OK=1

  if [ $NODE_OK -eq 1 ]; then echo "  [OK] Node.js found ($(node --version))"; else echo "  [!!] Node.js MISSING - install via your package manager or nodejs.org"; fi
  if [ $NPM_OK -eq 1 ]; then echo "  [OK] npm packages installed"; else echo "  [  ] npm packages not installed"; fi
  if [ $TOOLS_OK -eq 1 ]; then echo "  [OK] ADB present in bin/"; else echo "  [  ] ADB not in bin/"; fi

  echo ""
  echo " -------------------------------------------"
  echo "  1. Launch Omerta (npm run dev)"
  echo "  2. Install / fix npm packages"
  echo "  3. Download tools (ADB, iOS tools, ffmpeg...)"
  echo "  4. Full setup (packages + tools)"
  echo "  5. Build Linux package (AppImage/deb)"
  echo "  6. Exit"
  echo " -------------------------------------------"
  echo ""
}

do_npm() {
  if [ -f node_modules/electron/package.json ]; then
    echo "  node_modules already exists."
    read -p "  Force reinstall? Closes Omerta if open. (y/N): " FORCE
    if [[ ! "$FORCE" =~ ^[Yy]$ ]]; then return; fi
    rm -rf node_modules
  fi
  echo "  Running npm install..."
  npm install
}

do_tools() {
  clear
  echo ""
  echo " ==========================================="
  echo "  Downloading Tools"
  echo " ==========================================="
  echo ""
  mkdir -p bin

  # ADB / fastboot via platform-tools
  if [ -f bin/adb ]; then
    echo "  [OK] ADB already present"
  else
    echo "  [..] Downloading ADB..."
    curl -sL "https://dl.google.com/android/repository/platform-tools-latest-linux.zip" -o /tmp/pt.zip
    unzip -qo /tmp/pt.zip -d /tmp/pt_ext
    cp /tmp/pt_ext/platform-tools/adb bin/adb
    cp /tmp/pt_ext/platform-tools/fastboot bin/fastboot
    chmod +x bin/adb bin/fastboot
    rm -rf /tmp/pt_ext /tmp/pt.zip
    [ -f bin/adb ] && echo "  [OK] ADB downloaded" || echo "  [!!] ADB download failed"
  fi

  # scrcpy
  if [ -f bin/scrcpy ]; then
    echo "  [OK] scrcpy already present"
  else
    echo "  [..] Installing scrcpy via package manager..."
    if command -v apt >/dev/null 2>&1; then
      sudo apt install -y scrcpy 2>/dev/null && cp "$(command -v scrcpy)" bin/scrcpy || echo "  [!!] Run: sudo apt install scrcpy"
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y scrcpy 2>/dev/null && cp "$(command -v scrcpy)" bin/scrcpy || echo "  [!!] Run: sudo dnf install scrcpy"
    elif command -v pacman >/dev/null 2>&1; then
      sudo pacman -S --noconfirm scrcpy 2>/dev/null && cp "$(command -v scrcpy)" bin/scrcpy || echo "  [!!] Run: sudo pacman -S scrcpy"
    else
      echo "  [!!] Unknown package manager - install scrcpy manually"
    fi
  fi

  # libimobiledevice (iOS tools) - usually in repos
  if [ -f bin/idevice_id ]; then
    echo "  [OK] iOS tools already present"
  else
    echo "  [..] Installing libimobiledevice (iOS tools)..."
    if command -v apt >/dev/null 2>&1; then
      sudo apt install -y libimobiledevice6 libimobiledevice-utils usbmuxd ideviceinstaller 2>/dev/null
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y libimobiledevice libimobiledevice-utils usbmuxd 2>/dev/null
    elif command -v pacman >/dev/null 2>&1; then
      sudo pacman -S --noconfirm libimobiledevice usbmuxd 2>/dev/null
    fi
    for tool in idevice_id ideviceinfo idevicebackup2 idevicepair idevicescreenshot idevicesyslog idevicediagnostics ideviceinstaller idevicecrashreport idevicedate idevicename ideviceenterrecovery; do
      p=$(command -v "$tool" 2>/dev/null)
      [ -n "$p" ] && cp "$p" "bin/$tool"
    done
    [ -f bin/idevice_id ] && echo "  [OK] iOS tools installed" || echo "  [!!] iOS tools failed - install libimobiledevice manually"
  fi

  # ffmpeg
  if [ -f bin/ffmpeg ]; then
    echo "  [OK] ffmpeg already present"
  else
    echo "  [..] Installing ffmpeg..."
    if command -v apt >/dev/null 2>&1; then sudo apt install -y ffmpeg 2>/dev/null
    elif command -v dnf >/dev/null 2>&1; then sudo dnf install -y ffmpeg 2>/dev/null
    elif command -v pacman >/dev/null 2>&1; then sudo pacman -S --noconfirm ffmpeg 2>/dev/null
    fi
    p=$(command -v ffmpeg 2>/dev/null); [ -n "$p" ] && cp "$p" bin/ffmpeg
    p=$(command -v ffprobe 2>/dev/null); [ -n "$p" ] && cp "$p" bin/ffprobe
    [ -f bin/ffmpeg ] && echo "  [OK] ffmpeg installed" || echo "  [!!] ffmpeg failed - install manually"
  fi

  # apktool
  if [ -f bin/apktool.jar ]; then
    echo "  [OK] apktool already present"
  else
    echo "  [..] Downloading apktool..."
    LATEST=$(curl -sL https://api.github.com/repos/iBotPeaches/Apktool/releases/latest | grep -o '"browser_download_url": *"[^"]*apktool_[^"]*\.jar"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
    if [ -n "$LATEST" ]; then
      curl -sL "$LATEST" -o bin/apktool.jar
      echo '#!/usr/bin/env bash' > bin/apktool
      echo 'java -jar "$(dirname "$0")/apktool.jar" "$@"' >> bin/apktool
      chmod +x bin/apktool
      echo "  [OK] apktool downloaded"
    else
      echo "  [!!] apktool download failed"
    fi
  fi

  # magiskboot (extract from Magisk APK)
  if [ -f bin/magiskboot ]; then
    echo "  [OK] magiskboot already present"
  else
    echo "  [..] Downloading magiskboot from Magisk APK..."
    APK_URL=$(curl -sL https://api.github.com/repos/topjohnwu/Magisk/releases/latest | grep -o '"browser_download_url": *"[^"]*Magisk-[^"]*\.apk"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
    if [ -n "$APK_URL" ]; then
      curl -sL "$APK_URL" -o /tmp/magisk.apk
      mkdir -p /tmp/mag_ext
      unzip -qo /tmp/magisk.apk -d /tmp/mag_ext
      MB=$(find /tmp/mag_ext -name "magiskboot" -type f | head -1)
      [ -n "$MB" ] && cp "$MB" bin/magiskboot && chmod +x bin/magiskboot
      rm -rf /tmp/mag_ext /tmp/magisk.apk
      [ -f bin/magiskboot ] && echo "  [OK] magiskboot extracted" || echo "  [!!] magiskboot extraction failed"
    fi
  fi

  echo ""
  echo " ==========================================="
  echo "  Tools in bin/:"
  echo " ==========================================="
  ls -la bin/ 2>/dev/null | awk '{print "  "$0}'
}

do_build_linux() {
  echo "  Building Linux packages (AppImage + deb)..."
  npm run build:linux
  echo ""
  echo "  Build complete. Check dist/ folder for AppImage and .deb files."
}

while true; do
  print_menu
  read -p "  Choose (1-6): " CHOICE
  case $CHOICE in
    1) clear; echo "  Launching Omerta..."; npm run dev; read -p "  Press Enter to continue..." ;;
    2) clear; do_npm; read -p "  Press Enter to continue..." ;;
    3) do_tools; read -p "  Press Enter to continue..." ;;
    4) clear; do_npm; do_tools; read -p "  Press Enter to continue..." ;;
    5) clear; do_build_linux; read -p "  Press Enter to continue..." ;;
    6) exit 0 ;;
    *) echo "  Invalid choice" ;;
  esac
done
