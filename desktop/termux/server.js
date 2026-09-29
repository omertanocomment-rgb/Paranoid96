/**
 * OMERTA - Termux Web Server
 * Replaces Electron IPC with HTTP+WebSocket so the app runs in any browser.
 * On Android: start this in Termux, open http://localhost:3000 in browser.
 */

import { createServer } from 'http'
import { createReadStream, existsSync, mkdirSync, statSync } from 'fs'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { exec, spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { WebSocketServer } from 'ws'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BIN = join(ROOT, 'bin')
const PORT = process.env.OMERTA_PORT || 3000
const IS_ANDROID = process.env.OMERTA_TERMUX === '1' || existsSync('/data/data/com.termux')

// ── Tool path resolver (mirrors getBinDir() from Electron main) ──────────────
function tool(name) {
  const inBin = join(BIN, name)
  if (existsSync(inBin)) return inBin
  // Fall back to system PATH
  return name
}

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  '.html':'text/html', '.js':'application/javascript', '.mjs':'application/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2'
}

// ── Serve built renderer files ─────────────────────────────────────────────
const RENDERER_DIR = join(ROOT, 'out', 'renderer')

function serveFile(res, filePath) {
  if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return }
  const ext = extname(filePath)
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  res.setHeader('Cache-Control', 'no-cache')
  createReadStream(filePath).pipe(res)
}

// ── IPC handler registry ───────────────────────────────────────────────────
const handlers = {}
function handle(channel, fn) { handlers[channel] = fn }

// ── Core handlers ─────────────────────────────────────────────────────────
handle('device:list', async () => {
  try {
    const { stdout } = await execFileAsync(tool('adb'), ['devices', '-l'], { timeout:8000 })
    const android = stdout.split('\n').slice(1)
      .filter(l => l.trim() && !l.startsWith('*') && l.includes('\t'))
      .map(l => {
        const [serial, ...rest] = l.split('\t')
        const info = rest.join(' ')
        const model = info.match(/model:(\S+)/)?.[1] || ''
        const product = info.match(/product:(\S+)/)?.[1] || ''
        return { serial: serial.trim(), model, product, type: 'android' }
      })
    return { android, ios: [] }
  } catch(e) { return { android: [], ios: [], error: e.message } }
})

handle('adb:shell', async ({ serial, cmd }) => {
  try {
    const args = serial ? ['-s', serial, 'shell', cmd] : ['shell', cmd]
    const { stdout, stderr } = await execFileAsync(tool('adb'), args, { timeout:15000 })
    return (stdout + stderr).trim()
  } catch(e) { return { error: e.message } }
})

handle('adb:version', async () => {
  try {
    const { stdout } = await execFileAsync(tool('adb'), ['version'], { timeout:5000 })
    return stdout.split('\n')[0]
  } catch(e) { return null }
})

handle('quick:battery', async ({ serial }) => {
  try {
    const args = serial ? ['-s', serial, 'shell', 'dumpsys battery'] : ['shell', 'dumpsys battery']
    const { stdout } = await execFileAsync(tool('adb'), args, { timeout:10000 })
    const get = k => stdout.match(new RegExp(k + ':\\s*(\\d+)'))?.[1]
    return { level: parseInt(get('level')||'0'), status: get('status'), health: get('health'),
             voltage: parseInt(get('voltage')||'0'), temperature: parseInt(get('temperature')||'0') }
  } catch(e) { return { error: e.message } }
})

handle('quick:screenshot', async ({ serial }) => {
  try {
    const dest = join(ROOT, 'screenshots')
    mkdirSync(dest, { recursive: true })
    const file = join(dest, `screenshot_${Date.now()}.png`)
    const args = serial ? ['-s', serial, 'shell', 'screencap', '-p', '/sdcard/_omerta_ss.png'] : ['shell', 'screencap', '-p', '/sdcard/_omerta_ss.png']
    await execFileAsync(tool('adb'), args, { timeout:15000 })
    const pullArgs = serial ? ['-s', serial, 'pull', '/sdcard/_omerta_ss.png', file] : ['pull', '/sdcard/_omerta_ss.png', file]
    await execFileAsync(tool('adb'), pullArgs, { timeout:15000 })
    return { success: true, path: file }
  } catch(e) { return { success: false, error: e.message } }
})

handle('quick:reboot', async ({ serial, mode }) => {
  try {
    const modeArg = mode && mode !== 'normal' ? mode : null
    const baseArgs = serial ? ['-s', serial, 'reboot'] : ['reboot']
    const args = modeArg ? [...baseArgs, modeArg] : baseArgs
    await execFileAsync(tool('adb'), args, { timeout:10000 })
    return { success: true }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:info:cpu-temp', async ({ serial }) => {
  try {
    const args = serial ? ['-s', serial, 'shell', 'cat /sys/class/thermal/thermal_zone*/temp'] : ['shell', 'cat /sys/class/thermal/thermal_zone*/temp']
    const { stdout } = await execFileAsync(tool('adb'), args, { timeout:10000 })
    const temps = stdout.trim().split('\n').map((v,i) => ({ zone: i, temp: parseInt(v)||0 })).filter(t => t.temp > 0 && t.temp < 200000)
    return { success: true, temps: temps.map(t => ({ ...t, temp: t.temp > 1000 ? t.temp/1000 : t.temp })) }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:dumpsys:battery', async ({ serial }) => {
  try {
    const args = serial ? ['-s', serial, 'shell', 'dumpsys battery'] : ['shell', 'dumpsys battery']
    const { stdout } = await execFileAsync(tool('adb'), args, { timeout:10000 })
    const get = k => stdout.match(new RegExp(k + ':\\s*(.+)'))?.[1]?.trim()
    return { success: true, level: parseInt(get('level')||'0'), status: get('status'),
             health: get('health'), voltage: get('voltage'), temperature: get('temperature'),
             technology: get('technology'), raw: stdout }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:dumpsys:meminfo', async ({ serial, pkg }) => {
  try {
    const cmd = pkg ? `dumpsys meminfo ${pkg}` : 'dumpsys meminfo 2>/dev/null | head -60'
    const args = serial ? ['-s', serial, 'shell', cmd] : ['shell', cmd]
    const { stdout } = await execFileAsync(tool('adb'), args, { timeout:10000 })
    return { success: true, output: stdout }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:net:ip-info', async ({ serial }) => {
  try {
    const run = async cmd => {
      const args = serial ? ['-s', serial, 'shell', cmd] : ['shell', cmd]
      return execFileAsync(tool('adb'), args, { timeout:8000 }).then(r => r.stdout).catch(()=>'')
    }
    const [ipv4, wifi] = await Promise.all([
      run('ip addr show | grep "inet " | grep -v 127.0.0.1'),
      run('dumpsys wifi 2>/dev/null | grep -E "SSID|BSSID|RSSI|linkSpeed" | head -5')
    ])
    return { success: true, ipv4, wifi }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:pm:list', async ({ serial }) => {
  try {
    const args = serial ? ['-s', serial, 'shell', 'pm list packages -3'] : ['shell', 'pm list packages -3']
    const { stdout } = await execFileAsync(tool('adb'), args, { timeout:15000 })
    const packages = stdout.trim().split('\n').map(l => l.replace('package:','').trim()).filter(Boolean)
    return { success: true, packages, count: packages.length }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:pm:clear-data', async ({ serial, packageId }) => {
  try {
    const args = serial ? ['-s', serial, 'shell', `pm clear ${packageId}`] : ['shell', `pm clear ${packageId}`]
    const { stdout } = await execFileAsync(tool('adb'), args, { timeout:15000 })
    return { success: stdout.includes('Success'), output: stdout }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:settings:list', async ({ serial, namespace }) => {
  try {
    const ns = namespace || 'global'
    const args = serial ? ['-s', serial, 'shell', `settings list ${ns}`] : ['shell', `settings list ${ns}`]
    const { stdout } = await execFileAsync(tool('adb'), args, { timeout:15000 })
    const settings = stdout.split('\n').filter(l => l.includes('=')).map(l => {
      const [key, ...rest] = l.split('=')
      return { key: key.trim(), value: rest.join('=').trim() }
    })
    return { success: true, settings }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:settings:set', async ({ serial, namespace, key, value }) => {
  try {
    const ns = namespace || 'global'
    const args = serial ? ['-s', serial, 'shell', `settings put ${ns} ${key} ${value}`] : ['shell', `settings put ${ns} ${key} ${value}`]
    await execFileAsync(tool('adb'), args, { timeout:10000 })
    return { success: true }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:dev:animator-scale', async ({ serial, scale }) => {
  try {
    for (const s of ['window_animation_scale','transition_animation_scale','animator_duration_scale']) {
      const args = serial ? ['-s', serial, 'shell', `settings put global ${s} ${scale}`] : ['shell', `settings put global ${s} ${scale}`]
      await execFileAsync(tool('adb'), args, { timeout:5000 })
    }
    return { success: true }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:input:tap', async ({ serial, x, y }) => {
  try {
    const args = serial ? ['-s', serial, 'shell', `input tap ${x} ${y}`] : ['shell', `input tap ${x} ${y}`]
    await execFileAsync(tool('adb'), args, { timeout:5000 })
    return { success: true }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:input:text', async ({ serial, text }) => {
  try {
    const safe = text.replace(/['" ]/g, s => s===' ' ? '%s' : s)
    const args = serial ? ['-s', serial, 'shell', `input text '${safe}'`] : ['shell', `input text '${safe}'`]
    await execFileAsync(tool('adb'), args, { timeout:5000 })
    return { success: true }
  } catch(e) { return { success: false, error: e.message } }
})

handle('android:net:ping', async ({ serial, host }) => {
  try {
    const h = host || '8.8.8.8'
    const args = serial ? ['-s', serial, 'shell', `ping -c 4 ${h}`] : ['shell', `ping -c 4 ${h}`]
    const { stdout } = await execFileAsync(tool('adb'), args, { timeout:20000 })
    return { success: true, output: stdout }
  } catch(e) { return { success: false, error: e.message } }
})

handle('fastboot:devices', async () => {
  try {
    const { stdout } = await execFileAsync(tool('fastboot'), ['devices'], { timeout:8000 })
    const devices = stdout.split('\n').filter(l => l.trim() && !l.startsWith('*'))
      .map(l => { const [serial, ...rest] = l.split('\t'); return { serial: serial.trim(), mode: rest.join(' ').trim()||'fastboot' } })
      .filter(d => d.serial)
    return { success: true, devices }
  } catch(e) { return { success: false, devices: [], error: e.message } }
})

handle('discover:usb-devices', async () => {
  if (IS_ANDROID) {
    try {
      const { stdout } = await execFileAsync(tool('adb'), ['devices', '-l'], { timeout:8000 })
      const devices = stdout.split('\n').slice(1)
        .filter(l => l.trim() && !l.startsWith('*') && l.includes('\t'))
        .map(l => {
          const [serial, rest] = l.split('\t')
          return { serial: serial.trim(), mode: rest?.includes('unauthorized') ? 'usb-detected' : 'adb-ready', isAndroid: true }
        })
      return { success: true, devices }
    } catch(e) { return { success: false, devices: [], error: e.message } }
  }
  return { success: false, error: 'USB scan via WMI only available on Windows', devices: [] }
})

// iOS stubs (limited in Termux)
handle('ios:shsh:list', async () => ({ blobs: [], note: 'iOS tools have limited support in Termux. Use the Linux/Windows version for full iOS features.' }))
handle('ios:signed:check', async ({ device }) => {
  try {
    const { default: https } = await import('https')
    return new Promise(res => {
      https.get(`https://api.ipsw.me/v4/device/${device||'iPhone8,1'}?type=ipsw`, r => {
        let d = ''; r.on('data', c => d+=c); r.on('end', () => {
          try {
            const fw = JSON.parse(d).firmwares||[]
            res({ success:true, signed: fw.filter(f=>f.signed).map(f=>f.version), all: fw.map(f=>({version:f.version,signed:f.signed})) })
          } catch(e) { res({ success:false, error:e.message }) }
        })
      }).on('error', e => res({ success:false, error:e.message }))
    })
  } catch(e) { return { success:false, error:e.message } }
})

// Catch-all stub for unimplemented handlers
const STUB = () => ({ success: false, error: 'Not available in Termux web mode' })
const STUBS = ['ios:apps:detail','ios:sysinfo:deep','ios:syslog:start','ios:syslog:stop',
  'ios:activation:status','ios:profiles:list','ios:profiles:remove','ios:icloud:bypass-info',
  'ios:ssh:connect','ios:ssh:disconnect','ios:ssh:open-terminal','ios:frida:check',
  'ios:power:restart','ios:power:shutdown','ios:power:sleep','ios:screenshot:take',
  'ios:crash:list','ios:backup:restore','ios:erase:via-backup-tool','ios:erase:enter-recovery-for-restore',
  'android:screenrecord:start','android:screenrecord:stop','nand:android:list-partitions',
  'nand:android:read-partition','nand:android:flash-partition']
STUBS.forEach(ch => handle(ch, STUB))

// ── Origin check ──────────────────────────────────────────────────────────
// This server binds to 0.0.0.0 so it's reachable from other devices on the
// same LAN (by design - see termux/README.md). But a browser `Origin` header
// only gets sent for cross-origin script-initiated requests (fetch/XHR/WS),
// never for a person directly navigating to the page - so rejecting a
// mismatched Origin blocks a random website from silently driving this API
// via the visitor's browser (CSRF / DNS-rebinding style), without blocking
// the documented "open http://<phone-ip>:3000 in another device's browser"
// use case at all.
function isAllowedOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const origin = req.headers.origin
  const originOk = isAllowedOrigin(req)
  if (origin && originOk) res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (!originOk) {
    res.writeHead(403, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Cross-origin request blocked' }))
    return
  }

  // ── REST API: POST /api/:channel ──────────────────────────────────────────
  if (req.method === 'POST' && req.url.startsWith('/api/')) {
    const channel = req.url.slice(5)
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      let args = {}
      try { args = JSON.parse(body || '{}') } catch {}
      if (!handlers[channel]) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `No handler for channel: ${channel}` }))
        return
      }
      try {
        const result = await handlers[channel](args)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result ?? null))
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  // ── Serve screenshot files ─────────────────────────────────────────────────
  if (req.url.startsWith('/screenshots/')) {
    serveFile(res, join(ROOT, req.url))
    return
  }

  // ── Serve renderer static files ───────────────────────────────────────────
  let filePath = req.url === '/' ? '/index.html' : req.url
  filePath = join(RENDERER_DIR, filePath)

  // Strip query strings
  filePath = filePath.split('?')[0]

  if (!existsSync(filePath)) {
    // SPA fallback
    filePath = join(RENDERER_DIR, 'index.html')
  }
  serveFile(res, filePath)
})

// ── WebSocket for real-time events (syslog, progress, etc.) ─────────────────
const wss = new WebSocketServer({ server })
const clients = new Set()
wss.on('connection', (ws, req) => {
  if (!isAllowedOrigin(req)) { ws.close(1008, 'Cross-origin connection blocked'); return }
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
  ws.on('message', async data => {
    try {
      const { id, channel, args } = JSON.parse(data)
      if (handlers[channel]) {
        const result = await handlers[channel](args || {})
        ws.send(JSON.stringify({ id, result }))
      } else {
        ws.send(JSON.stringify({ id, error: `No handler: ${channel}` }))
      }
    } catch(e) {
      try { ws.send(JSON.stringify({ error: e.message })) } catch {}
    }
  })
})

// Broadcast function (used by handlers to send events like syslog lines)
global.broadcast = (event, data) => {
  const msg = JSON.stringify({ event, data })
  clients.forEach(ws => { try { ws.send(msg) } catch {} })
}

// ── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log('')
  console.log('  ┌─────────────────────────────────────┐')
  console.log('  │  OMERTA - Web Server Running         │')
  console.log('  ├─────────────────────────────────────┤')
  console.log(`  │  Local:   http://localhost:${PORT}        │`)
  console.log('  │  Network: http://<your-ip>:' + PORT + '       │')
  console.log(`  │  Mode:    ${IS_ANDROID ? 'Termux/Android      ' : 'Linux desktop         '}    │`)
  console.log('  │  Handlers: ' + Object.keys(handlers).length + ' registered          │')
  console.log('  └─────────────────────────────────────┘')
  console.log('')
  console.log('  Press Ctrl+C to stop')
  console.log('')
})

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: OMERTA_PORT=3001 node termux/server.js`)
  } else {
    console.error('Server error:', e)
  }
  process.exit(1)
})

// Additional handlers for termux mode
