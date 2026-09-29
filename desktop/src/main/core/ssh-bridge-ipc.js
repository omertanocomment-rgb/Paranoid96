// ssh-bridge-ipc.js
// SSH/SFTP bridge for jailbroken iPhones (palera1n/checkra1n), headless Termux nodes,
// and any generic SSH host. Backs both the SSH Bridge page and the Termux Node Manager page.
import { app, safeStorage } from 'electron'
import { join } from 'path'
import fs from 'fs-extra'
import { Client } from 'ssh2'
import SftpClient from 'ssh2-sftp-client'

function storeFile() {
  return join(app.getPath('userData'), 'ssh_hosts.json')
}

function loadHostsRaw() {
  try {
    return fs.readJsonSync(storeFile())
  } catch {
    return []
  }
}

function saveHostsRaw(hosts) {
  fs.ensureDirSync(app.getPath('userData'))
  fs.writeJsonSync(storeFile(), hosts, { spaces: 2 })
}

function encryptSecret(plain) {
  if (!plain) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(plain).toString('base64')
    }
  } catch {}
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
}

function decryptSecret(stored) {
  if (!stored) return ''
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
  } catch {}
  return ''
}

// Active interactive shell sessions keyed by sessionId
const sessions = new Map()

export function registerSshBridgeHandlers(ipcMain, dialog, shell, mainWindow) {
  //    Host / node registry (shared by SSH Bridge + Termux Node Manager)
  ipcMain.handle('ssh:hosts:list', () => {
    return loadHostsRaw().map(h => ({ ...h, password: undefined, privateKey: undefined, hasPassword: !!h.password, hasKey: !!h.privateKey }))
  })

  ipcMain.handle('ssh:hosts:save', (e, host) => {
    const hosts = loadHostsRaw()
    const id = host.id || ('h_' + Date.now().toString(36))
    const encoded = {
      id,
      label: host.label || host.host,
      host: host.host,
      port: host.port || 22,
      username: host.username || 'root',
      password: host.password ? encryptSecret(host.password) : (hosts.find(h => h.id === id)?.password || ''),
      privateKey: host.privateKey ? encryptSecret(host.privateKey) : (hosts.find(h => h.id === id)?.privateKey || ''),
      kind: host.kind || 'generic', // 'ios-jailbreak' | 'termux' | 'generic'
      notes: host.notes || '',
      createdAt: hosts.find(h => h.id === id)?.createdAt || Date.now(),
    }
    const idx = hosts.findIndex(h => h.id === id)
    if (idx >= 0) hosts[idx] = encoded
    else hosts.push(encoded)
    saveHostsRaw(hosts)
    return { ok: true, id }
  })

  ipcMain.handle('ssh:hosts:delete', (e, id) => {
    const hosts = loadHostsRaw().filter(h => h.id !== id)
    saveHostsRaw(hosts)
    return { ok: true }
  })

  function resolveAuth(hostRec, override) {
    const opts = {
      host: override?.host || hostRec.host,
      port: override?.port || hostRec.port || 22,
      username: override?.username || hostRec.username || 'root',
      readyTimeout: 12000,
    }
    const pass = override?.password || decryptSecret(hostRec.password)
    const key = override?.privateKey || decryptSecret(hostRec.privateKey)
    if (key) opts.privateKey = key
    else if (pass) opts.password = pass
    return opts
  }

  //    One-shot exec (used by Termux Node Manager for remote command runs)
  ipcMain.handle('ssh:exec', async (e, { hostId, host, cmd, timeout }) => {
    const hosts = loadHostsRaw()
    const rec = hostId ? hosts.find(h => h.id === hostId) : null
    if (!rec && !host) throw new Error('No host specified')
    const opts = resolveAuth(rec || {}, host)
    return new Promise((resolve, reject) => {
      const conn = new Client()
      const timer = setTimeout(() => { conn.end(); reject(new Error('SSH exec timed out')) }, timeout || 20000)
      conn.on('ready', () => {
        conn.exec(cmd, (err, stream) => {
          if (err) { clearTimeout(timer); conn.end(); return reject(err) }
          let stdout = '', stderr = ''
          stream.on('data', d => stdout += d.toString())
          stream.stderr.on('data', d => stderr += d.toString())
          stream.on('close', (code) => {
            clearTimeout(timer)
            conn.end()
            resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() })
          })
        })
      }).on('error', (err) => { clearTimeout(timer); reject(err) })
        .connect(opts)
    })
  })

  //    Interactive shell session (xterm-style, streamed via events)
  ipcMain.handle('ssh:shell:open', async (e, { sessionId, hostId, host }) => {
    const hosts = loadHostsRaw()
    const rec = hostId ? hosts.find(h => h.id === hostId) : null
    if (!rec && !host) throw new Error('No host specified')
    const opts = resolveAuth(rec || {}, host)
    return new Promise((resolve, reject) => {
      const conn = new Client()
      conn.on('ready', () => {
        conn.shell({ term: 'xterm-256color', cols: 120, rows: 32 }, (err, stream) => {
          if (err) { conn.end(); return reject(err) }
          sessions.set(sessionId, { conn, stream })
          stream.on('data', d => {
            mainWindow?.webContents.send('ssh:shell:data:' + sessionId, d.toString('utf8'))
          })
          stream.stderr?.on('data', d => {
            mainWindow?.webContents.send('ssh:shell:data:' + sessionId, d.toString('utf8'))
          })
          stream.on('close', () => {
            mainWindow?.webContents.send('ssh:shell:closed:' + sessionId)
            sessions.delete(sessionId)
            conn.end()
          })
          resolve({ ok: true })
        })
      }).on('error', (err) => reject(err))
        .connect(opts)
    })
  })

  ipcMain.handle('ssh:shell:write', (e, { sessionId, data }) => {
    const s = sessions.get(sessionId)
    if (!s) return { ok: false, error: 'No active session' }
    s.stream.write(data)
    return { ok: true }
  })

  ipcMain.handle('ssh:shell:resize', (e, { sessionId, cols, rows }) => {
    const s = sessions.get(sessionId)
    if (!s) return { ok: false }
    s.stream.setWindow(rows, cols)
    return { ok: true }
  })

  ipcMain.handle('ssh:shell:close', (e, { sessionId }) => {
    const s = sessions.get(sessionId)
    if (s) { s.stream.end(); s.conn.end(); sessions.delete(sessionId) }
    return { ok: true }
  })

  //    SFTP browser
  ipcMain.handle('ssh:sftp:list', async (e, { hostId, host, remotePath }) => {
    const hosts = loadHostsRaw()
    const rec = hostId ? hosts.find(h => h.id === hostId) : null
    const opts = resolveAuth(rec || {}, host)
    const sftp = new SftpClient()
    try {
      await sftp.connect(opts)
      const list = await sftp.list(remotePath || '/')
      return list.map(f => ({ name: f.name, type: f.type, size: f.size, modifyTime: f.modifyTime }))
    } finally { try { await sftp.end() } catch {} }
  })

  ipcMain.handle('ssh:sftp:download', async (e, { hostId, host, remotePath }) => {
    const hosts = loadHostsRaw()
    const rec = hostId ? hosts.find(h => h.id === hostId) : null
    const opts = resolveAuth(rec || {}, host)
    const { filePath } = await dialog.showSaveDialog(mainWindow, { defaultPath: remotePath.split('/').pop() })
    if (!filePath) return { ok: false, cancelled: true }
    const sftp = new SftpClient()
    try {
      await sftp.connect(opts)
      await sftp.get(remotePath, filePath)
      return { ok: true, filePath }
    } finally { try { await sftp.end() } catch {} }
  })

  ipcMain.handle('ssh:sftp:upload', async (e, { hostId, host, remoteDir }) => {
    const hosts = loadHostsRaw()
    const rec = hostId ? hosts.find(h => h.id === hostId) : null
    const opts = resolveAuth(rec || {}, host)
    const { filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] })
    if (!filePaths?.length) return { ok: false, cancelled: true }
    const sftp = new SftpClient()
    try {
      await sftp.connect(opts)
      const remote = (remoteDir || '/').replace(/\/$/, '') + '/' + filePaths[0].split('/').pop()
      await sftp.put(filePaths[0], remote)
      return { ok: true, remote }
    } finally { try { await sftp.end() } catch {} }
  })

  ipcMain.handle('ssh:sftp:mkdir', async (e, { hostId, host, remotePath }) => {
    const hosts = loadHostsRaw()
    const rec = hostId ? hosts.find(h => h.id === hostId) : null
    const opts = resolveAuth(rec || {}, host)
    const sftp = new SftpClient()
    try { await sftp.connect(opts); await sftp.mkdir(remotePath, true); return { ok: true } }
    finally { try { await sftp.end() } catch {} }
  })

  ipcMain.handle('ssh:sftp:delete', async (e, { hostId, host, remotePath, isDir }) => {
    const hosts = loadHostsRaw()
    const rec = hostId ? hosts.find(h => h.id === hostId) : null
    const opts = resolveAuth(rec || {}, host)
    const sftp = new SftpClient()
    try {
      await sftp.connect(opts)
      if (isDir) await sftp.rmdir(remotePath, true)
      else await sftp.delete(remotePath)
      return { ok: true }
    } finally { try { await sftp.end() } catch {} }
  })

  //    Quick connectivity test (used by both pages)
  ipcMain.handle('ssh:test', async (e, { hostId, host }) => {
    try {
      const hosts = loadHostsRaw()
      const rec = hostId ? hosts.find(h => h.id === hostId) : null
      const opts = resolveAuth(rec || {}, host)
      return await new Promise((resolve) => {
        const conn = new Client()
        const t = setTimeout(() => { conn.end(); resolve({ ok: false, error: 'timeout' }) }, 8000)
        conn.on('ready', () => { clearTimeout(t); conn.end(); resolve({ ok: true }) })
          .on('error', (err) => { clearTimeout(t); resolve({ ok: false, error: err.message }) })
          .connect(opts)
      })
    } catch (err) { return { ok: false, error: err.message } }
  })
}
