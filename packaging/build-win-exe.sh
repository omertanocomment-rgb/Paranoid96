#!/usr/bin/env bash
# Build the Windows installer (.exe) from the electron-builder output.
#
# Why not electron-builder's own NSIS target: NSIS installers are 32-bit
# executables, and electron-builder has to RUN the installer it just built in
# order to generate the uninstaller. That needs 32-bit Wine, which cannot be
# installed on this build host -- the i386 dependency chain is broken in the
# image. So the installer is assembled the one way that requires executing no
# Windows code at build time: concatenation.
#
# A 7-Zip SFX installer is three files joined end to end -- stub, config,
# payload -- and the result is an ordinary PE that Windows runs. The stub is
# 7-Zip's own, fetched from the LZMA SDK and checksum-pinned.
#
#   bash packaging/build-win-exe.sh   -> dist/OMERTA-AGENT-<ver>-win-x64-setup.exe
set -euo pipefail
cd "$(dirname "$0")/.."

VER="$(python3 -c "import re;print(re.search(r'version\s*=\s*\"([^\"]+)\"',open('pyproject.toml').read()).group(1))")"
UNPACKED="desktop/dist/win-unpacked"
OUT="dist/OMERTA-AGENT-${VER}-win-x64-setup.exe"
CACHE="build_pkg/cache"
SDK="$CACHE/lzma2501.7z"
SFX="$CACHE/7zSD.sfx"
SFX_SHA=18b4c189f195d55fe1e6c08d6a186d31c89d6c3c55afe122a55230078f7ea294

[ -d "$UNPACKED" ] || { echo "no $UNPACKED -- run electron-builder --win first" >&2; exit 1; }
command -v 7z >/dev/null || { echo "7z not found (apt install p7zip-full)" >&2; exit 1; }

mkdir -p "$CACHE" dist
if [ ! -f "$SFX" ]; then
  [ -f "$SDK" ] || curl -sSL -o "$SDK" https://www.7-zip.org/a/lzma2501.7z
  7z e -y "$SDK" bin/7zSD.sfx -o"$CACHE" >/dev/null
fi
GOT=$(sha256sum "$SFX" | cut -d' ' -f1)
if [ "$GOT" != "$SFX_SHA" ]; then
  echo "7zSD.sfx checksum mismatch" >&2
  echo "  want $SFX_SHA" >&2
  echo "  got  $GOT" >&2
  # This stub becomes the first bytes of an executable other people run.
  rm -f "$SFX"
  exit 1
fi

STAGE="build_pkg/win"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -r "$UNPACKED"/. "$STAGE"/

# The SFX unpacks to a temp directory and runs RunProgram there, so the actual
# installing is this script's job.
cat > "$STAGE/install.cmd" <<'CMD'
@echo off
setlocal enableextensions
set "TARGET=%LOCALAPPDATA%\Programs\OMERTA AGENT"
echo Installing OMERTA AGENT to "%TARGET%" ...
if exist "%TARGET%" rd /s /q "%TARGET%" >nul 2>&1
mkdir "%TARGET%" >nul 2>&1
xcopy /e /i /q /y "%~dp0." "%TARGET%\" >nul
if errorlevel 1 (
  echo.
  echo Could not copy the application to "%TARGET%".
  echo Nothing has been installed.
  pause
  exit /b 1
)
del /q "%TARGET%\install.cmd" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell);" ^
  "foreach($d in @([Environment]::GetFolderPath('Desktop'),(Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))){" ^
  "  try{$l=$s.CreateShortcut((Join-Path $d 'OMERTA AGENT.lnk'));" ^
  "  $l.TargetPath=(Join-Path $env:LOCALAPPDATA 'Programs\OMERTA AGENT\OMERTA AGENT.exe');" ^
  "  $l.WorkingDirectory=(Join-Path $env:LOCALAPPDATA 'Programs\OMERTA AGENT');" ^
  "  $l.Save()}catch{}}" >nul 2>&1
echo Done. Starting OMERTA AGENT.
start "" "%TARGET%\OMERTA AGENT.exe"
exit /b 0
CMD

# An uninstaller, because an installer that cannot be undone is not finished.
cat > "$STAGE/uninstall.cmd" <<'CMD'
@echo off
setlocal enableextensions
set "TARGET=%LOCALAPPDATA%\Programs\OMERTA AGENT"
echo This removes OMERTA AGENT from "%TARGET%".
echo Your chats and settings are NOT stored there and are left alone.
choice /c yn /m "Remove it"
if errorlevel 2 exit /b 0
taskkill /im "OMERTA AGENT.exe" /f >nul 2>&1
rd /s /q "%TARGET%" >nul 2>&1
del /q "%USERPROFILE%\Desktop\OMERTA AGENT.lnk" >nul 2>&1
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\OMERTA AGENT.lnk" >nul 2>&1
echo Removed.
pause
CMD

ARCHIVE="build_pkg/omerta-win.7z"
rm -f "$ARCHIVE"
( cd "$STAGE" && 7z a -t7z -mx=7 -ms=on "../omerta-win.7z" . >/dev/null )

CFG="build_pkg/sfx-config.txt"
# CRLF and the exact sentinels are part of the SFX config format.
{
  printf ';!@Install@!UTF-8!\r\n'
  printf 'Title="OMERTA AGENT %s"\r\n' "$VER"
  printf 'BeginPrompt="Install OMERTA AGENT %s?\\n\\nIt installs for this user only, needs no administrator rights, and carries its own Python -- nothing else to install."\r\n' "$VER"
  printf 'RunProgram="install.cmd"\r\n'
  printf ';!@InstallEnd@!\r\n'
} > "$CFG"

cat "$SFX" "$CFG" "$ARCHIVE" > "$OUT"
chmod 0644 "$OUT"
echo "built $OUT ($(du -h "$OUT" | cut -f1))"
