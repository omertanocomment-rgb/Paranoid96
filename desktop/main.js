/**
 * OMERTA AGENT — Electron desktop shell (Windows / macOS / Linux).
 *
 * Spawns the Python backend as a child process, waits for it to bind,
 * then loads the same web UI the phone uses. One codebase, every platform.
 */
const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = process.env.OMERTA_PORT || 8787;
let backend = null;
let win = null;

function appRoot() {
  // packaged: resources/app ; dev: parent of desktop/
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..');
}

/**
 * The interpreter that runs the backend.
 *
 * A bundled runtime is preferred over anything on PATH: it is the one this
 * build was tested against, and on Windows it is usually the only one there
 * is. Shipping it is what makes this an application rather than a
 * prerequisite -- the previous version put up a dialog telling the owner to
 * go and install Python from python.org, which is the same "install this
 * other thing first" problem the APK removed by embedding CPython.
 */
function bundledPython() {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'pyruntime')
    : path.join(__dirname, 'runtime', process.platform === 'win32'
        ? 'win-x64' : 'none');
  const exe = path.join(dir, process.platform === 'win32' ? 'python.exe' : 'bin/python3');
  try {
    if (fs.existsSync(exe)) return exe;
  } catch (e) { /* fall through to PATH */ }
  return null;
}

function findPython() {
  const bundled = bundledPython();
  if (bundled) return bundled;
  const candidates = process.platform === 'win32'
    ? ['python', 'py -3', 'python3']
    : ['python3', 'python'];
  for (const c of candidates) {
    try {
      execSync(`${c} --version`, { stdio: 'ignore' });
      return c;
    } catch (e) { /* try next */ }
  }
  return null;
}

function startBackend() {
  const py = findPython();
  if (!py) {
    dialog.showErrorBox('Python not found',
      'OMERTA AGENT needs Python 3.9+ on PATH.\n\n' +
      'This build was expected to carry its own interpreter; if you are\n' +
      'seeing this, it was packaged without one.\n\n' +
      'Windows: install from python.org and tick "Add to PATH".\n' +
      'macOS:   brew install python\n' +
      'Linux:   sudo apt install python3 python3-pip');
    app.quit();
    return;
  }
  const root = appRoot();
  const [cmd, ...pre] = py.split(' ');
  // omerta_entry.py, NOT server.py. server.py imports FastAPI and uvicorn,
  // which nothing here installs, so it fails on any machine that has not been
  // set up by hand. omerta_entry falls back to core/httpd -- same protocol,
  // same approval gate, stdlib only -- when they are absent.
  backend = spawn(cmd, [...pre, path.join(root, 'omerta_entry.py'), 'serve'], {
    cwd: root,
    env: { ...process.env, OMERTA_PORT: String(PORT), PYTHONUNBUFFERED: '1' },
  });
  backend.stdout.on('data', d => console.log(`[backend] ${d}`));
  backend.stderr.on('data', d => console.error(`[backend] ${d}`));
  backend.on('exit', code => console.log(`[backend] exited ${code}`));
}

function waitForBackend(tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      http.get(`http://127.0.0.1:${PORT}/api/status`, res => {
        res.resume(); resolve();
      }).on('error', () => {
        if (n <= 0) return reject(new Error('backend never came up'));
        setTimeout(() => attempt(n - 1), 500);
      });
    };
    attempt(tries);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 780, minWidth: 420, minHeight: 520,
    backgroundColor: '#0b0a08',
    title: 'OMERTA AGENT',
    icon: process.platform === 'linux'
      ? path.join(appRoot(), 'assets', 'icon_512.png') : undefined,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(`http://127.0.0.1:${PORT}/`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'OMERTA', submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'quit' }] },
    { label: 'Edit', submenu: [
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' }] },
  ]));
  startBackend();
  try {
    await waitForBackend();
  } catch (e) {
    dialog.showErrorBox('Backend failed to start',
      'The Python backend did not start.\n\nRun this in the app folder:\n' +
      '  pip install -r requirements.txt\n\n' + e.message);
    app.quit(); return;
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function stopBackend() {
  if (!backend) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${backend.pid} /T /F`);
    else backend.kill('SIGTERM');
  } catch (e) { /* already dead */ }
  backend = null;
}

app.on('window-all-closed', () => { stopBackend(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', stopBackend);
process.on('exit', stopBackend);
