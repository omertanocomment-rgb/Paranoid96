import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { join, basename } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import plistLib from 'plist'
const plist = {
  parse: (str) => {
    if (!str || (typeof str === 'string' && str.trim().length < 10)) return {}
    try { return plistLib.parse(typeof str === 'string' ? str : str.toString()) } catch(e) { return {} }
  }
}
import { openDb } from './db.js'
import os from 'os'

const execFileAsync = promisify(execFile)

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

export default class ExtractionCore {

  //    Connection mode detection                                              
  async detectConnectionModes() {
    const modes = []
    try {
      const { stdout } = await execFileAsync(bin('adb'), ['devices'], { timeout: 5000 })
      const lines = stdout.split('\n').slice(1).filter(l => l.trim() && !l.startsWith('*'))
      for (const line of lines) {
        const [serial, state] = line.split(/\s+/)
        modes.push({ type: 'adb', serial, state, label: 'ADB ' + state })
      }
    } catch {}

    try {
      const { stdout } = await execFileAsync(bin('idevice_id'), ['-l'], { timeout: 5000 })
      const udids = stdout.split('\n').filter(Boolean)
      for (const udid of udids) modes.push({ type: 'ios', serial: udid, state: 'connected', label: 'iOS device' })
    } catch {}

    modes.push(...await this.detectEdl())
    modes.push(...await this.detectMtk())
    return modes
  }

  async detectEdl() {
    try {
      const { stdout } = await execFileAsync(bin('adb'), ['devices'], { timeout: 3000 })
      if (stdout.includes('9008') || stdout.toLowerCase().includes('qualcomm')) {
        return [{ type: 'edl', state: 'detected', label: 'Qualcomm EDL (9008)' }]
      }
    } catch {}
    return []
  }

  async detectMtk() {
    try {
      const { stdout } = await execFileAsync(bin('adb'), ['devices'], { timeout: 3000 })
      if (stdout.includes('0003') || stdout.toLowerCase().includes('mediatek')) {
        return [{ type: 'mtk', state: 'detected', label: 'MediaTek BROM' }]
      }
    } catch {}
    return []
  }

  //    ADB Wi-Fi connection                                                   
  async connectAdbWifi(ip, port = 5555) {
    try {
      const { stdout } = await execFileAsync(bin('adb'), ['connect', `${ip}:${port}`], { timeout: 10000 })
      return { success: stdout.includes('connected'), message: stdout.trim() }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }

  //    iOS pairing record scan                                                 
  async findLockdownRecords() {
    const paths = []
    if (process.platform === 'win32') {
      paths.push('C:\\ProgramData\\Apple\\Lockdown')
    } else if (process.platform === 'darwin') {
      paths.push('/var/db/lockdown', join(os.homedir(), 'Library/Lockdown'))
    } else {
      paths.push('/var/lib/lockdown', join(os.homedir(), '.config/lockdown'))
    }
    const records = []
    for (const dir of paths) {
      if (!await fs.pathExists(dir)) continue
      const files = await fs.readdir(dir).catch(() => [])
      for (const f of files.filter(f => f.endsWith('.plist'))) {
        try {
          const data = await fs.readFile(join(dir, f))
          const info = plist.parse(data.toString())
          records.push({
            udid: f.replace('.plist', ''),
            path: join(dir, f),
            hostId: info.HostID,
            deviceName: info.DeviceName || 'Unknown Device',
            created: info.RootPrivateKey ? 'Has root cert' : 'User cert'
          })
        } catch {}
      }
    }
    return records
  }

  async connectWithLockdown(udid, plistPath) {
    try {
      const { stdout } = await execFileAsync(
        bin('ideviceinfo'), ['-u', udid, '--key', 'DeviceName'], { timeout: 10000 }
      )
      return { success: true, deviceName: stdout.trim() }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }

  //    Main extraction dispatcher                                             
  async extract(method, serial, destDir, options = {}, onProgress) {
    await fs.ensureDir(destDir)
    switch (method) {
      case 'adb-backup': return this.adbBackupExtract(serial, destDir, options, onProgress)
      case 'adb-pull': return this.adbPullExtract(serial, destDir, options, onProgress)
      case 'ios-backup': return this.iosBackupExtract(serial, destDir, options, onProgress)
      case 'ios-lockdown': return this.iosLockdownExtract(serial, destDir, options, onProgress)
      default: throw new Error(`Unknown extraction method: ${method}`)
    }
  }

  async adbBackupExtract(serial, destDir, options, onProgress) {
    onProgress?.({ percent: 5, message: 'Starting ADB backup...' })
    const bakFile = join(destDir, 'adb_backup.ab')
    return new Promise((resolve, reject) => {
      const args = ['-s', serial, 'backup', '-f', bakFile, '-all', '-apk', '-shared', '-system', '-nosystem']
      if (!options.includeSystem) args.splice(args.indexOf('-system'), 1)
      const proc = spawn(bin('adb'), args)
      let out = ''
      proc.stdout.on('data', d => { out += d.toString() })
      proc.stderr.on('data', d => {
        out += d.toString()
        const m = out.match(/(\d+)%/)
        if (m) onProgress?.({ percent: parseInt(m[1]), message: 'Backing up...' })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async (code) => {
        if (code === 0) {
          onProgress?.({ percent: 90, message: 'Converting backup...' })
          await this.convertAbToDir(bakFile, destDir, onProgress)
          resolve({ success: true, dest: destDir })
        } else reject(new Error('ADB backup failed: ' + out))
      })
    })
  }

  async adbPullExtract(serial, destDir, options, onProgress) {
    const targets = []
    if (options.photos !== false) targets.push({ remote: '/sdcard/DCIM', local: 'DCIM' })
    if (options.downloads !== false) targets.push({ remote: '/sdcard/Download', local: 'Downloads' })
    if (options.whatsapp !== false) targets.push({ remote: '/sdcard/Android/media/com.whatsapp', local: 'WhatsApp' })
    if (options.telegram !== false) targets.push({ remote: '/sdcard/Telegram', local: 'Telegram' })
    if (options.documents !== false) targets.push({ remote: '/sdcard/Documents', local: 'Documents' })
    if (options.music !== false) targets.push({ remote: '/sdcard/Music', local: 'Music' })

    for (let i = 0; i < targets.length; i++) {
      const { remote, local } = targets[i]
      onProgress?.({ percent: Math.round(i / targets.length * 80), message: `Pulling ${local}...` })
      const localDir = join(destDir, local)
      await fs.ensureDir(localDir)
      try {
        await new Promise((res, rej) => {
          const proc = spawn(bin('adb'), ['-s', serial, 'pull', remote, localDir])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res() : rej(new Error(`Failed: ${remote}`)))
        })
      } catch (e) { console.warn('Pull failed (may not exist):', e.message) }
    }

    if (options.contacts !== false) {
      onProgress?.({ percent: 82, message: 'Extracting contacts...' })
      await this.extractContacts(serial, destDir)
    }
    if (options.sms !== false) {
      onProgress?.({ percent: 88, message: 'Extracting SMS...' })
      await this.extractSms(serial, destDir)
    }
    if (options.callLog !== false) {
      onProgress?.({ percent: 93, message: 'Extracting call log...' })
      await this.extractCallLog(serial, destDir)
    }
    onProgress?.({ percent: 100, message: 'Done!' })
    return { success: true, dest: destDir }
  }

  async iosBackupExtract(udid, destDir, options, onProgress) {
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('idevicebackup2'), ['backup', '--full', '--udid', udid, destDir])
      let out = ''
      proc.stdout.on('data', d => {
        out += d.toString()
        const m = out.match(/(\d+(\.\d+)?)\s*%/)
        if (m) onProgress?.({ percent: parseFloat(m[1]), message: out.split('\n').filter(Boolean).pop() })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async (code) => {
        if (code === 0) {
          onProgress?.({ percent: 95, message: 'Processing backup...' })
          await this.processIosBackup(destDir, onProgress)
          resolve({ success: true, dest: destDir })
        } else reject(new Error('iOS backup failed'))
      })
    })
  }

  async iosLockdownExtract(udid, destDir, options, onProgress) {
    return this.iosBackupExtract(udid, destDir, options, onProgress)
  }

  //    checkm8 exploitation (palera1n)                                        
  async checkm8Extract(udid, destDir, onProgress) {
    onProgress?.({ percent: 5, message: 'Checking palera1n availability...' })
    const palera1n = bin('palera1n')
    if (!await fs.pathExists(palera1n)) {
      return { success: false, error: 'palera1n binary not found. Download from palera.in and place in bin/ directory.' }
    }
    onProgress?.({ percent: 10, message: 'Booting jailbreak ramdisk (do not disconnect device)...' })
    return new Promise((resolve, reject) => {
      const proc = spawn(palera1n, ['-r', '-E', '--udid', udid])
      let out = ''
      proc.stdout.on('data', d => {
        out += d.toString()
        const last = out.split('\n').filter(Boolean).pop()
        if (last) onProgress?.({ percent: 30, message: last })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async (code) => {
        if (code === 0) {
          onProgress?.({ percent: 60, message: 'Jailbreak active, extracting filesystem...' })
          await this.iosBackupExtract(udid, destDir, {}, onProgress)
          resolve({ success: true, dest: destDir })
        } else reject(new Error('palera1n failed: ' + out))
      })
    })
  }

  //    iCloud backup pull                                                     
  async pullIcloudBackup(appleid, password, destDir, onProgress) {
    onProgress?.({ percent: 5, message: 'Authenticating with iCloud...' })
    const icloudBin = bin('icloud_dump')
    if (!await fs.pathExists(icloudBin)) {
      return { success: false, error: 'icloud_dump tool not found. Build from: github.com/hackappcom/iLoot' }
    }
    return new Promise((resolve, reject) => {
      const proc = spawn(icloudBin, ['-u', appleid, '-p', password, '-d', destDir])
      proc.stdout.on('data', d => {
        const m = d.toString().match(/(\d+)%/)
        if (m) onProgress?.({ percent: parseInt(m[1]), message: d.toString().trim() })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0
        ? resolve({ success: true, dest: destDir })
        : reject(new Error('iCloud pull failed -- check credentials or 2FA')))
    })
  }

  //    Data parsers                                                           
  async parseMessageDb(dbPath) {
    const db = await openDb(dbPath, true)
    try {
      const rows = db.all(`
        SELECT m.rowid, m.date, m.text, m.is_from_me, h.id as handle
        FROM message m LEFT JOIN handle h ON m.handle_id = h.rowid
        ORDER BY m.date ASC LIMIT 10000
      `)
      return rows.map(r => ({
        id: r.rowid,
        date: new Date(978307200000 + r.date / 1000000).toISOString(),
        text: r.text,
        fromMe: r.is_from_me === 1,
        handle: r.handle
      }))
    } finally { db.close() }
  }

  async parseWhatsApp(dbPath, keyPath) {
    if (keyPath) {
      const decryptedPath = dbPath.replace('.db', '_decrypted.db')
      await execFileAsync(bin('whatsapp-db-decrypt'), ['-k', keyPath, '-i', dbPath, '-o', decryptedPath], { timeout: 30000 })
      dbPath = decryptedPath
    }
    const db = await openDb(dbPath, true)
    try {
      const rows = db.all(`
        SELECT m._id, m.key_remote_jid, m.data, m.timestamp, m.key_from_me, m.status
        FROM messages m ORDER BY m.timestamp ASC LIMIT 20000
      `)
      return rows.map(r => ({
        id: r._id, contact: r.key_remote_jid,
        text: r.data,
        date: new Date(r.timestamp).toISOString(),
        fromMe: r.key_from_me === 1,
        status: r.status
      }))
    } finally { db.close() }
  }

  async extractContacts(serial, destDir) {
    try {
      const raw = await new Promise((res, rej) => {
        const proc = spawn(bin('adb'), ['-s', serial, 'shell', `
          content query --uri content://contacts/phones/ --projection display_name:number:type 2>/dev/null
        `])
        let out = ''
        proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res(out))
      })
      const contacts = raw.split('\n').filter(l => l.includes('display_name=')).map(l => {
        const name = l.match(/display_name=([^,]+)/)?.[1] || ''
        const number = l.match(/number=([^,]+)/)?.[1] || ''
        return `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL:${number}\nEND:VCARD`
      })
      await fs.writeFile(join(destDir, 'contacts.vcf'), contacts.join('\n\n'))
    } catch (e) { console.warn('Contact extract failed:', e.message) }
  }

  async extractSms(serial, destDir) {
    try {
      const raw = await new Promise((res, rej) => {
        const proc = spawn(bin('adb'), ['-s', serial, 'shell',
          'content query --uri content://sms/ --projection address:body:date:type --sort date 2>/dev/null | head -2000'])
        let out = ''
        proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res(out))
      })
      const rows = raw.split('\n').filter(l => l.includes('address=')).map(l => ({
        address: l.match(/address=([^,]+)/)?.[1] || '',
        body: l.match(/body=([^,]+)/)?.[1] || '',
        date: new Date(parseInt(l.match(/date=(\d+)/)?.[1] || 0)).toISOString(),
        type: l.match(/type=(\d+)/)?.[1] === '1' ? 'Received' : 'Sent'
      }))
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SMS Export</title>
      <style>body{font-family:sans-serif;max-width:700px;margin:2rem auto}
      .msg{margin:8px 0;padding:10px 14px;border-radius:12px}
      .recv{background:#f0f0f0;text-align:left}.sent{background:#0084ff;color:#fff;text-align:right;margin-left:auto}
      .meta{font-size:11px;opacity:0.6;margin-top:4px}</style></head><body>
      <h2>SMS Export -- ${rows.length} messages</h2>
      ${rows.map(r => `<div class="msg ${r.type === 'Received' ? 'recv' : 'sent'}">
        <div class="addr">${r.type === 'Received' ? r.address : 'Me'}</div>
        <div>${r.body}</div><div class="meta">${r.date}</div></div>`).join('')}
      </body></html>`
      await fs.writeFile(join(destDir, 'sms.html'), html)
      await fs.writeJSON(join(destDir, 'sms.json'), rows, { spaces: 2 })
    } catch (e) { console.warn('SMS extract failed:', e.message) }
  }

  async extractCallLog(serial, destDir) {
    try {
      const raw = await new Promise((res) => {
        const proc = spawn(bin('adb'), ['-s', serial, 'shell',
          'content query --uri content://call_log/calls/ --projection number:date:duration:type 2>/dev/null | head -1000'])
        let out = ''
        proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res(out))
      })
      const rows = raw.split('\n').filter(l => l.includes('number=')).map(l => ({
        number: l.match(/number=([^,]+)/)?.[1] || '',
        date: new Date(parseInt(l.match(/date=(\d+)/)?.[1] || 0)).toISOString(),
        duration: l.match(/duration=(\d+)/)?.[1] + 's' || '',
        type: { '1': 'Incoming', '2': 'Outgoing', '3': 'Missed', '5': 'Rejected' }[l.match(/type=(\d+)/)?.[1]] || 'Unknown'
      }))
      const csv = ['Number,Date,Duration,Type',
        ...rows.map(r => `${r.number},${r.date},${r.duration},${r.type}`)].join('\n')
      await fs.writeFile(join(destDir, 'call_log.csv'), csv)
    } catch (e) { console.warn('Call log extract failed:', e.message) }
  }

  async convertAbToDir(abFile, destDir) {
    // Convert ADB backup (.ab) to a directory using dd + zlib
    try {
      const extractDir = join(destDir, 'backup_contents')
      await fs.ensureDir(extractDir)
      // Strip 24-byte header then decompress
      const { createReadStream, createWriteStream } = await import('fs')
      const { createInflate } = await import('zlib')
      const { pipeline } = await import('stream/promises')
      const rs = createReadStream(abFile, { start: 24 })
      const inflate = createInflate()
      const ws = createWriteStream(join(extractDir, 'backup.tar'))
      await pipeline(rs, inflate, ws)
    } catch (e) { console.warn('AB conversion failed:', e.message) }
  }

  async processIosBackup(backupDir, onProgress) {
    // iOS backups are in a flat structure with Manifest.db
    // Reorganise into human-readable folder structure
    const manifestPath = join(backupDir, 'Manifest.db')
    if (!await fs.pathExists(manifestPath)) return
    try {
      const db = await openDb(manifestPath, true)
      const files = db.all(`
        SELECT fileID, domain, relativePath FROM Files
        WHERE relativePath LIKE '%.jpg' OR relativePath LIKE '%.png'
           OR relativePath LIKE '%.MOV' OR relativePath LIKE '%.mp4'
           OR relativePath LIKE '%.vcf' OR relativePath LIKE 'Library/SMS%'
        LIMIT 5000
      `)
      db.close()
      const photoDir = join(backupDir, 'Photos')
      await fs.ensureDir(photoDir)
      let done = 0
      for (const file of files) {
        const src = join(backupDir, file.fileID.slice(0, 2), file.fileID)
        const destFile = join(photoDir, basename(file.relativePath))
        if (await fs.pathExists(src)) await fs.copy(src, destFile).catch(() => {})
        done++
        if (done % 50 === 0) onProgress?.({ percent: 95 + Math.round(done / files.length * 4), message: `Processing ${done}/${files.length}` })
      }
    } catch (e) { console.warn('iOS backup processing failed:', e.message) }
  }
}
