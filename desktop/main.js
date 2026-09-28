/**
 * OMERTA AGENT — Electron desktop shell (Windows / macOS / Linux).
 *
 * Spawns the Python backend as a child process, waits for it to bind,
 * then loads the same web UI the phone uses. One codebase, every platform.
 */
const { app, BrowserWindow, shell, dialog, Menu, ipcMain, protocol, net } =
  require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { pathToFileURL } = require('url');

// The UI is served from this process, not fetched over a network. A custom
// scheme registered as standard AND secure gives the page a secure context,
// which is what navigator.clipboard and getUserMedia require -- on
// http://127.0.0.1 both were unavailable and the copy buttons needed a
// fallback.
const SCHEME = 'omerta';
const BASE = `${SCHEME}://app/`;

let backend = null;       // the Python child, speaking JSON over stdio
let win = null;
let ready = false;
let lastError = '';
let nextId = 1;
const pending = new Map();

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
    lastError = 'no Python interpreter found';
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
  // `bridge`, not `serve`: the backend talks to THIS process over a pipe.
  // There is no port, nothing listening, and nothing for anything else on the
  // machine to connect to.
  backend = spawn(cmd, [...pre, path.join(root, 'omerta_entry.py'), 'bridge'], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // One JSON object per line. Replies carry the id of their request, so they
  // may arrive in any order -- which they will, because a slow chat turn must
  // not hold up the status poll behind it.
  readline.createInterface({ input: backend.stdout }).on('line', line => {
    let msg;
    try { msg = JSON.parse(line); } catch (e) { return; }
    if (msg.id === null || msg.id === undefined) {
      if (msg.body && msg.body.ready) ready = true;
      return;
    }
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    slot(JSON.stringify({ status: msg.status, body: msg.body }));
  });

  backend.stderr.on('data', d => console.error(`[backend] ${d}`));
  backend.on('exit', code => {
    ready = false;
    lastError = `backend exited with code ${code}`;
    // Fail every request still waiting, or the UI hangs with no explanation.
    for (const [id, slot] of pending) {
      slot(JSON.stringify({ status: 500, body: { error: lastError } }));
      pending.delete(id);
    }
  });
}

/** Send one message to the Python child and resolve with its reply. */
function ask(msg) {
  return new Promise(resolve => {
    if (!backend || backend.exitCode !== null) {
      return resolve(JSON.stringify({
        status: 500, body: { error: lastError || 'the backend is not running' },
      }));
    }
    const id = nextId++;
    pending.set(id, resolve);
    try {
      backend.stdin.write(JSON.stringify({ ...msg, id }) + '\n');
    } catch (e) {
      pending.delete(id);
      resolve(JSON.stringify({ status: 500, body: { error: String(e) } }));
    }
  });
}

/** Wait for the child to announce itself, so the window opens on a live app. */
function waitForBackend(tries = 120) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      if (ready) return resolve();
      if (backend && backend.exitCode !== null) {
        return reject(new Error(lastError || 'the backend exited at start-up'));
      }
      if (n <= 0) return reject(new Error('the backend did not start in time'));
      setTimeout(() => attempt(n - 1), 500);
    };
    attempt(tries);
  });
}

// ── serving the UI, in-process ───────────────────────────────────────────
const CTYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function serveFile(pathname) {
  const root = appRoot();
  let rel;
  if (pathname === '/' || pathname === '/index.html') rel = 'webui/index.html';
  else if (pathname.startsWith('/assets/')) rel = 'assets' + pathname.slice(7);
  else if (pathname === '/icon.svg' || pathname === '/favicon.ico')
    rel = 'assets' + pathname;
  else if (pathname.startsWith('/webui/')) rel = 'webui' + pathname.slice(6);
  else return null;

  const full = path.resolve(root, rel);
  // A served directory plus "../" is how a UI bug becomes "read any file on
  // the machine", so anything that climbed out is simply not found.
  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return { body: fs.readFileSync(full),
           type: CTYPES[path.extname(full).toLowerCase()]
                 || 'application/octet-stream' };
}

function registerScheme() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    // The theme stylesheet and its images are generated, so they come from the
    // backend; everything else is a file next to the app.
    if (url.pathname === '/theme.css' || url.pathname.startsWith('/theme/asset/')) {
      const raw = await ask({ op: 'asset', path: url.pathname });
      try {
        const env = JSON.parse(raw);
        const b = env.body || {};
        if (b.data) {
          return new Response(Buffer.from(b.data, 'base64'),
                              { headers: { 'content-type': b.ctype || 'text/plain' } });
        }
      } catch (e) { /* fall through to 404 */ }
      return new Response('', { status: 404 });
    }
    const got = serveFile(url.pathname);
    if (!got) return new Response('not found', { status: 404 });
    return new Response(got.body, { headers: { 'content-type': got.type } });
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,                 // preload needs require('electron')
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadURL(BASE);
  // Test hook: run a probe script once loaded and exit with its output.
  // Only in a development checkout. It executes a file named by an
  // environment variable, and while anyone who can set the environment of a
  // packaged app can already run code, there is no reason to ship the
  // shortcut.
  if (process.env.OMERTA_E2E && !app.isPackaged) {
    win.webContents.on('console-message', (_e, _l, msg) => {
      if (String(msg).startsWith('PROBE ')) { console.log(msg); app.exit(0); }
    });
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => win.webContents.executeJavaScript(
        require('fs').readFileSync(process.env.OMERTA_E2E, 'utf8')), 1500);
    });
    setTimeout(() => { console.log('PROBE {"error":"timeout"}'); app.exit(1); }, 60000);
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); return { action: 'deny' };
  });
}

// Must be declared before the app is ready. `standard` makes relative URLs and
// fetch() behave normally; `secure` is what makes the page a secure context.
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true,
                corsEnabled: true, stream: true },
}]);

function wireIpc() {
  ipcMain.handle('omerta:request', (_e, method, path_, body) => {
    let parsed = null;
    if (body) { try { parsed = JSON.parse(body); } catch (e) { parsed = null; } }
    return ask({ method, path: path_, body: parsed });
  });
  ipcMain.handle('omerta:attach-begin', (_e, name, project, note) =>
    ask({ op: 'attach_begin', name, project, note }).then(unwrap));
  ipcMain.handle('omerta:attach-chunk', (_e, upload, data) =>
    ask({ op: 'attach_chunk', upload, data }).then(unwrap));
  ipcMain.handle('omerta:attach-end', (_e, upload, size) =>
    ask({ op: 'attach_end', upload, size }).then(unwrap));
  ipcMain.handle('omerta:attach-abort', (_e, upload) =>
    ask({ op: 'attach_abort', upload }).then(unwrap));
  ipcMain.handle('omerta:ready', () => ready);
  ipcMain.handle('omerta:last-error', () => lastError);
}

/** The upload calls answer with the payload itself, not the envelope. */
function unwrap(raw) {
  try { return JSON.stringify(JSON.parse(raw).body || {}); }
  catch (e) { return raw; }
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
  registerScheme();
  wireIpc();
  startBackend();
  try {
    await waitForBackend();
  } catch (e) {
    dialog.showErrorBox('Backend failed to start',
      'The agent did not start.\n\n' + e.message +
      '\n\nIf this build was packaged without its own Python, install the\n' +
      'dependencies in the app folder:\n  pip install -r requirements.txt');
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
