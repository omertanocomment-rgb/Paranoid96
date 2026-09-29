# Build a self-contained Windows .exe of Omerta AI (offline brain) with PyInstaller.
# Bundles Python + Tk + the app + the default brain + the OMERTA icon. No install needed.
#   pip install pyinstaller ; ./desktop/packaging/build-exe.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)   # desktop/
Set-Location $root
New-Item -ItemType Directory -Force -Path build\bundle | Out-Null
Copy-Item omerta_desktop.py, ..\brain\omerta_brain.py build\bundle\ -Force
if (Test-Path ..\brain\brains\omerta.brain) { Copy-Item ..\brain\brains\omerta.brain build\bundle\ -Force }
Copy-Item ..\design\logo\omerta.ico, ..\design\logo\omerta-256.png build\bundle\ -Force
Set-Location build\bundle
$data = @("--add-data", "omerta-256.png;.")
if (Test-Path omerta.brain) { $data += @("--add-data", "omerta.brain;.") }
pyinstaller --onefile --noconsole --name "OmertaAI" --icon omerta.ico `
  --hidden-import tkinter @data omerta_desktop.py
New-Item -ItemType Directory -Force -Path ..\..\dist | Out-Null
Copy-Item dist\OmertaAI.exe ..\..\dist\OmertaAI.exe -Force
Write-Host "Built: desktop/dist/OmertaAI.exe"
# Optional Authenticode signing when a cert is provided (publishable standard):
if ($env:WINDOWS_PFX_BASE64 -and $env:WINDOWS_PFX_PASSWORD) {
  [IO.File]::WriteAllBytes("$env:TEMP\omerta.pfx", [Convert]::FromBase64String($env:WINDOWS_PFX_BASE64))
  $st = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -EA SilentlyContinue | Select-Object -Last 1
  if ($st) {
    & $st.FullName sign /f "$env:TEMP\omerta.pfx" /p $env:WINDOWS_PFX_PASSWORD `
      /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 ..\..\dist\OmertaAI.exe
    Write-Host "Signed OmertaAI.exe"
  }
}
