@echo off
setlocal enabledelayedexpansion
title OMERTA Setup and Launcher
cd /d "%~dp0"

:MENU
cls
echo.
echo  ===========================================
echo   OMERTA - Device Management Suite
echo  ===========================================
echo.

REM -- Check environment --------------------------------------------
set NODE_OK=0
set NPM_OK=0
set TOOLS_OK=0

node --version >nul 2>&1 && set NODE_OK=1
if exist node_modules\electron\package.json set NPM_OK=1
if exist bin\adb.exe set TOOLS_OK=1

if %NODE_OK%==1 (echo   [OK] Node.js found) else (echo   [!!] Node.js MISSING)
if %NPM_OK%==1  (echo   [OK] npm packages installed) else (echo   [  ] npm packages not installed)
if %TOOLS_OK%==1 (echo   [OK] ADB present in bin\) else (echo   [  ] ADB not in bin\)

echo.
echo  -------------------------------------------
echo   1. Launch Omerta (npm run dev)
echo   2. Install / fix npm packages
echo   3. Download tools (ADB, iOS tools, ffmpeg...)
echo   4. Full setup (packages + tools)
echo   5. Build Windows Installer (.exe)
echo   6. Exit
echo  -------------------------------------------
echo.
set /p CHOICE=  Choose (1-6): 

if "%CHOICE%"=="1" goto LAUNCH
if "%CHOICE%"=="2" goto INSTALL_NPM
if "%CHOICE%"=="3" goto INSTALL_TOOLS
if "%CHOICE%"=="4" goto FULL_SETUP
if "%CHOICE%"=="5" goto BUILD_WIN
if "%CHOICE%"=="6" exit /b 0
goto MENU

REM ----------------------------------------------
:LAUNCH
cls
echo.
echo  Launching Omerta...
echo  Press Ctrl+C to stop.
echo.
npm run dev
echo.
echo  Omerta exited.
pause
goto MENU

REM ------------------------------------------
:BUILD_WIN
cls
echo.
echo  Building Windows installer (.exe)...
echo  This produces dist\Omerta-Setup-VERSION.exe
echo.
if exist node_modules\electron\package.json goto BUILD_WIN_RUN
echo  [!!] npm packages not installed yet. Run option 2 or 4 first.
pause
goto MENU

:BUILD_WIN_RUN
call npm run build:win
if errorlevel 1 goto BUILD_WIN_FAIL
echo.
echo  [OK] Build complete. Check the dist folder for the installer.
if exist dist start "" explorer "dist"
pause
goto MENU

:BUILD_WIN_FAIL
echo.
echo  [!!] Build failed - see errors above.
pause
goto MENU

REM ----------------------------------------------
:INSTALL_NPM
cls
echo.
echo  Installing npm packages...
echo  This takes 2-5 minutes on first run.
echo.
if exist node_modules\electron\package.json (
    echo  node_modules already exists.
    set /p FORCE=  Force reinstall? Closes Omerta if open. (Y/N): 
    if /i not "!FORCE!"=="Y" goto MENU
    echo  Removing node_modules...
    rmdir /s /q node_modules 2>nul
    if exist node_modules\electron\package.json (
        echo  [!!] Cannot delete - Omerta may still be running. Close it first.
        pause
        goto MENU
    )
)
echo  Running npm install...
npm install
if errorlevel 1 (
    echo.
    echo  [!!] npm install failed. Make sure Omerta is closed.
) else (
    echo.
    echo  [OK] Packages installed successfully.
)
pause
goto MENU

REM ----------------------------------------------
:FULL_SETUP
call :DO_NPM
call :DO_TOOLS
echo.
echo  Full setup complete. Choose option 1 to launch.
pause
goto MENU

REM ----------------------------------------------
:INSTALL_TOOLS
cls
call :DO_TOOLS
pause
goto MENU

:DO_NPM
if not exist node_modules\electron\package.json (
    echo  Installing npm packages...
    npm install
)
goto :eof

:DO_TOOLS
if not exist "%~dp0install-tools.ps1" (
    echo  [!!] install-tools.ps1 not found next to OMERTA.bat
    goto :eof
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-tools.ps1"
goto :eof
