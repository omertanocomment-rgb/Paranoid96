# OMERTA AGENT - Windows installer
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\install_windows.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host "[*] OMERTA AGENT - Windows install" -ForegroundColor Yellow

function Have($n) { $null -ne (Get-Command $n -ErrorAction SilentlyContinue) }

if (-not (Have python)) {
  if (Have winget) {
    Write-Host "[*] Installing Python via winget..."
    winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path","User")
  } else {
    Write-Host "[!] Install Python 3.12 from python.org (tick 'Add to PATH'), then re-run." -ForegroundColor Red
    exit 1
  }
}

Write-Host "[*] Creating virtualenv..."
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\pip.exe install -r requirements.txt

if (-not (Have ollama)) {
  $a = Read-Host "    Install Ollama for offline inference? [y/N]"
  if ($a -eq "y" -and (Have winget)) { winget install -e --id Ollama.Ollama }
}
if (Have ollama) { ollama pull qwen2.5-coder:7b }

# Start Menu shortcut
$WshShell = New-Object -ComObject WScript.Shell
$lnkDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$lnk = $WshShell.CreateShortcut("$lnkDir\OMERTA AGENT.lnk")
$lnk.TargetPath = (Resolve-Path ".\.venv\Scripts\pythonw.exe").Path
$lnk.Arguments  = '"' + (Resolve-Path ".\server.py").Path + '"'
$lnk.WorkingDirectory = (Get-Location).Path
$lnk.IconLocation = (Resolve-Path ".\assets\icon.ico").Path
$lnk.Save()

Write-Host ""
Write-Host "[*] Done." -ForegroundColor Green
Write-Host "    CLI : .\.venv\Scripts\python.exe cli.py"
Write-Host "    Web : .\.venv\Scripts\python.exe server.py   -> http://localhost:8787"
Write-Host "    Key : setx ANTHROPIC_API_KEY sk-ant-...   (optional, online brain)"
