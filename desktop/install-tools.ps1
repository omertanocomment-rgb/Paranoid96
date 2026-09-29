#Requires -Version 5.0
# Omerta - Windows tool downloader
# Run directly, or via OMERTA.bat option 3/4.
# Each tool is isolated in its own try/catch so one failure never blocks the rest.

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BinDir = Join-Path $PSScriptRoot "bin"
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null

function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "  [..] $msg" -ForegroundColor Yellow }
function Warn($msg) { Write-Host "  [!!] $msg" -ForegroundColor Red }
function Step($msg) { Write-Host "`nREM -- $msg --" -ForegroundColor Cyan }

function Test-BinFile($name) { Test-Path (Join-Path $BinDir $name) }

function Get-LatestGithubAsset($repo, $namePattern) {
    $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -TimeoutSec 20 -Headers @{ "User-Agent" = "Omerta" }
    return $rel.assets | Where-Object { $_.name -like $namePattern } | Select-Object -First 1
}

function Install-FromZip($url, $destExe, $filterExt = $null, $singleFile = $false) {
    $tmpZip = Join-Path $env:TEMP ("omerta_dl_" + [guid]::NewGuid().ToString("N") + ".zip")
    $tmpExt = Join-Path $env:TEMP ("omerta_ext_" + [guid]::NewGuid().ToString("N"))
    try {
        Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing -TimeoutSec 120
        Expand-Archive -Path $tmpZip -DestinationPath $tmpExt -Force
        if ($singleFile) {
            $found = Get-ChildItem $tmpExt -Recurse -Filter (Split-Path $destExe -Leaf) | Select-Object -First 1
            if ($found) { Copy-Item $found.FullName $destExe -Force }
        } else {
            # Copy every matching file (or everything) from the extracted folder tree into bin/
            $items = if ($filterExt) { Get-ChildItem $tmpExt -Recurse -File | Where-Object { $_.Extension -in $filterExt } }
                     else { Get-ChildItem $tmpExt -Recurse -File }
            foreach ($item in $items) { Copy-Item $item.FullName (Join-Path $BinDir $item.Name) -Force }
        }
        return $true
    } finally {
        Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
        Remove-Item $tmpExt -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host " Downloading Tools" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan

# ── ADB / fastboot ────────────────────────────────────────────────────────────
Step "ADB"
if (Test-BinFile "adb.exe") { Ok "ADB already present" }
else {
    Info "Downloading ADB..."
    try {
        $tmpZip = Join-Path $env:TEMP "omerta_platform-tools.zip"
        $tmpExt = Join-Path $env:TEMP "omerta_platform-tools"
        Invoke-WebRequest "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile $tmpZip -UseBasicParsing -TimeoutSec 120
        Expand-Archive $tmpZip $tmpExt -Force
        foreach ($f in @("adb.exe", "fastboot.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll")) {
            $src = Join-Path $tmpExt "platform-tools\$f"
            if (Test-Path $src) { Copy-Item $src (Join-Path $BinDir $f) -Force }
        }
        Remove-Item $tmpZip, $tmpExt -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-BinFile "adb.exe") { Ok "ADB downloaded" } else { Warn "ADB download did not produce adb.exe" }
    } catch { Warn "ADB download failed: $($_.Exception.Message)" }
}

# ── scrcpy ────────────────────────────────────────────────────────────────────
Step "scrcpy"
if (Test-BinFile "scrcpy.exe") { Ok "scrcpy already present" }
else {
    Info "Downloading scrcpy..."
    try {
        $asset = Get-LatestGithubAsset "Genymobile/scrcpy" "*win64*"
        if ($asset) {
            Install-FromZip $asset.browser_download_url $null | Out-Null
            if (Test-BinFile "scrcpy.exe") { Ok "scrcpy downloaded" } else { Warn "scrcpy.exe not found after extraction" }
        } else { Warn "No win64 scrcpy release asset found" }
    } catch { Warn "scrcpy download failed: $($_.Exception.Message)" }
}

# ── iOS tools (libimobiledevice) ────────────────────────────────────────────
Step "iOS tools (libimobiledevice)"
if (Test-BinFile "idevice_id.exe") { Ok "iOS tools already present" }
else {
    Info "Downloading iOS tools..."
    try {
        $asset = Get-LatestGithubAsset "libimobiledevice-win32/imobiledevice-net" "*.zip"
        if ($asset) {
            Install-FromZip $asset.browser_download_url $null @(".exe", ".dll") | Out-Null
            if (Test-BinFile "idevice_id.exe") { Ok "iOS tools downloaded" } else { Warn "idevice_id.exe not found after extraction" }
        } else { Warn "No iOS tools release asset found" }
    } catch { Warn "iOS tools download failed: $($_.Exception.Message)" }
}

# ── ffmpeg ────────────────────────────────────────────────────────────────────
Step "ffmpeg"
if (Test-BinFile "ffmpeg.exe") { Ok "ffmpeg already present" }
else {
    Info "Downloading ffmpeg (~90MB)..."
    try {
        $tmpZip = Join-Path $env:TEMP "omerta_ffmpeg.zip"
        $tmpExt = Join-Path $env:TEMP "omerta_ffmpeg"
        Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile $tmpZip -UseBasicParsing -TimeoutSec 300
        Expand-Archive $tmpZip $tmpExt -Force
        $ffmpeg = Get-ChildItem $tmpExt -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
        $ffprobe = Get-ChildItem $tmpExt -Recurse -Filter "ffprobe.exe" | Select-Object -First 1
        if ($ffmpeg) { Copy-Item $ffmpeg.FullName (Join-Path $BinDir "ffmpeg.exe") -Force }
        if ($ffprobe) { Copy-Item $ffprobe.FullName (Join-Path $BinDir "ffprobe.exe") -Force }
        Remove-Item $tmpZip, $tmpExt -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-BinFile "ffmpeg.exe") { Ok "ffmpeg downloaded" } else { Warn "ffmpeg.exe not found after extraction" }
    } catch { Warn "ffmpeg download failed: $($_.Exception.Message)" }
}

# ── Frida ────────────────────────────────────────────────────────────────────
Step "Frida"
if (Test-BinFile "frida.exe") { Ok "frida already present" }
else {
    Info "Downloading frida..."
    try {
        $asset = Get-LatestGithubAsset "frida/frida" "frida-server*-windows-x86_64.exe*"
        if ($asset -and $asset.name -notlike "*.xz") {
            Invoke-WebRequest $asset.browser_download_url -OutFile (Join-Path $BinDir "frida.exe") -UseBasicParsing -TimeoutSec 120
            if (Test-BinFile "frida.exe") { Ok "frida downloaded" } else { Warn "frida.exe not written" }
        } else { Warn "No plain .exe frida-server asset found (get from github.com/frida/frida/releases)" }
    } catch { Warn "frida download failed: $($_.Exception.Message)" }
}

# ── magiskboot (extracted from the Magisk APK) ─────────────────────────────
Step "magiskboot"
if (Test-BinFile "magiskboot.exe") { Ok "magiskboot already present" }
else {
    Info "Downloading magiskboot from Magisk APK..."
    try {
        $asset = Get-LatestGithubAsset "topjohnwu/Magisk" "Magisk-*.apk"
        if ($asset) {
            $tmpApk = Join-Path $env:TEMP "omerta_magisk.apk"
            $tmpExt = Join-Path $env:TEMP "omerta_magisk"
            Invoke-WebRequest $asset.browser_download_url -OutFile $tmpApk -UseBasicParsing -TimeoutSec 120
            Expand-Archive $tmpApk $tmpExt -Force
            $mb = Get-ChildItem $tmpExt -Recurse -Filter "magiskboot.exe" | Select-Object -First 1
            if ($mb) { Copy-Item $mb.FullName (Join-Path $BinDir "magiskboot.exe") -Force }
            Remove-Item $tmpApk, $tmpExt -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-BinFile "magiskboot.exe") { Ok "magiskboot extracted" } else { Warn "magiskboot.exe not found in APK" }
        } else { Warn "No Magisk APK release asset found" }
    } catch { Warn "magiskboot extraction failed: $($_.Exception.Message)" }
}

# ── apktool ──────────────────────────────────────────────────────────────────
Step "apktool"
if (Test-BinFile "apktool.jar") { Ok "apktool already present" }
else {
    Info "Downloading apktool..."
    try {
        $asset = Get-LatestGithubAsset "iBotPeaches/Apktool" "apktool_*.jar"
        if ($asset) {
            Invoke-WebRequest $asset.browser_download_url -OutFile (Join-Path $BinDir "apktool.jar") -UseBasicParsing -TimeoutSec 60
            @('@echo off', 'java -jar "%~dp0apktool.jar" %*') | Set-Content (Join-Path $BinDir "apktool.bat")
            if (Test-BinFile "apktool.jar") { Ok "apktool downloaded" } else { Warn "apktool.jar not written" }
        } else { Warn "No apktool release asset found" }
    } catch { Warn "apktool download failed: $($_.Exception.Message)" }
}

# ── Rufus ────────────────────────────────────────────────────────────────────
Step "Rufus"
if (Test-BinFile "rufus.exe") { Ok "rufus already present" }
else {
    Info "Downloading Rufus..."
    try {
        $asset = Get-LatestGithubAsset "pbatard/rufus" "rufus-*.exe"
        $asset = $asset | Where-Object { $_.name -notlike "*p.exe" } | Select-Object -First 1
        if ($asset) {
            Invoke-WebRequest $asset.browser_download_url -OutFile (Join-Path $BinDir "rufus.exe") -UseBasicParsing -TimeoutSec 60
            if (Test-BinFile "rufus.exe") { Ok "rufus downloaded" } else { Warn "rufus.exe not written" }
        } else { Warn "No Rufus release asset found" }
    } catch { Warn "rufus download failed: $($_.Exception.Message)" }
}

# ── zsign (iOS IPA signer) ───────────────────────────────────────────────────
Step "zsign"
if (Test-BinFile "zsign.exe") { Ok "zsign already present" }
else {
    Info "Downloading zsign..."
    try {
        $asset = Get-LatestGithubAsset "zhlynn/zsign" "*win*"
        if ($asset) {
            if ($asset.name -like "*.zip") {
                Install-FromZip $asset.browser_download_url (Join-Path $BinDir "zsign.exe") @(".exe") | Out-Null
            } else {
                Invoke-WebRequest $asset.browser_download_url -OutFile (Join-Path $BinDir "zsign.exe") -UseBasicParsing -TimeoutSec 60
            }
            if (Test-BinFile "zsign.exe") { Ok "zsign downloaded" } else { Warn "zsign.exe not written" }
        } else { Warn "No Windows zsign release asset found" }
    } catch { Warn "zsign download failed: $($_.Exception.Message)" }
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host "`n===========================================" -ForegroundColor Cyan
Write-Host " Tools in bin\:" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Get-ChildItem $BinDir -Filter "*.exe" | ForEach-Object {
    $kb = [math]::Round($_.Length / 1KB)
    Write-Host ("   {0,-28} ({1} KB)" -f $_.Name, $kb)
}
Write-Host "`nDone.`n"
