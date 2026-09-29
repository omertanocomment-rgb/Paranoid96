# Omerta

Free device management suite — Android + iOS. No limits, no cost.

---

## Windows Quick Start (3 steps)

### Step 1 — Extract the ZIP
Right-click `omerta.zip` → Extract All → choose somewhere like `C:\omerta\`

### Step 2 — Run Setup
Open the extracted folder and DOUBLE-CLICK `SETUP.bat`

This automatically:
- Checks for Node.js (tells you where to get it if missing)  
- Downloads ADB + fastboot from Google
- Downloads iOS tools
- Runs npm install
- Creates run.bat

### Step 3 — Launch
Double-click `run.bat`

OR in PowerShell inside the folder:
  npm run dev

---

## Manual Setup (if SETUP.bat fails)

1. Install Node.js from: https://nodejs.org (Windows Installer, all defaults)
2. Open File Explorer, go to the omerta folder
3. Hold SHIFT + Right-click inside folder → "Open PowerShell window here"
4. Run: npm install
5. Run: npm run dev

---

## Connecting Android

1. Settings > About Phone > tap Build Number 7 times
2. Settings > Developer Options > USB Debugging ON
3. Plug in via USB, tap Allow on phone

If not detected: install Universal ADB Driver from https://adb.clockworkmod.com/

## Connecting iPhone/iPad

Just plug in. Tap Trust on the iPhone when prompted.

---

## Optional extras (place in bin\ folder)

scrcpy.exe          Screen mirror     github.com/Genymobile/scrcpy/releases
magiskboot.exe      ROM patching      Extract from Magisk APK
payload-dumper-go   Pixel ROM extract github.com/ssut/payload-dumper-go/releases
palera1n.exe        iOS extraction    palera.in

---

## Fleet Control (remote control every install you own)

Enable the agent (Fleet Control -> This Device) on every machine/phone you own,
pointing them all at the same hub URL + token; then use Fleet Control -> Fleet
Console on any one install to see them all online and run shell/adb/fastboot
commands or trigger the tool installer on any of them. Run the hub yourself by
setting `FLEET_TOKEN` on the Node backend in `../backend/` (see its
`.env.example`) - nothing joins the fleet without that exact token, so it only
ever reaches devices you set it up on.

## Build Windows installer

  npm run package:win
  (output goes to dist\ folder)

---

## Troubleshooting

"npm is not recognized"
  -> Install Node.js from https://nodejs.org

"cannot be loaded because running scripts is disabled"  
  -> Run in PowerShell: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

Phone not detected
  -> Check USB Debugging is on. Try different cable. Install https://adb.clockworkmod.com/

Blank screen / crash
  -> Delete node_modules\ folder, run npm install again
