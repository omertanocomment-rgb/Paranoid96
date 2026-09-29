/**
 * OMERTA -- New Tools Backend
 * All new feature modules in one file for easy integration
 */

import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import { openDb } from './db.js'

const execAsync = promisify(execFile)

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

function adbShell(serial, cmd) {
  return new Promise(async (resolve, reject) => {
    const proc = spawn(bin('adb'), ['-s', serial, 'shell', cmd])
    let out = '', err = ''
    proc.stdout.on('data', d => out += d)
    proc.stderr.on('data', d => err += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err || out)))
  })
}

//                                                                               
// LOGCAT VIEWER
//                                                                               
export class LogcatManager {
  constructor() { this.sessions = new Map() }

  start(serial, options = {}) {
    const existing = this.sessions.get(serial)
    if (existing) { existing.proc.kill(); this.sessions.delete(serial) }

    const args = ['-s', serial, 'logcat', '-v', 'time']
    if (options.pid)      args.push('--pid', options.pid)
    if (options.tags)     args.push(...options.tags.map(t => t + ':V'))
    if (options.level)    args.push('*:' + options.level.toUpperCase())
    if (options.clear)    { spawn(bin('adb'), ['-s', serial, 'logcat', '-c']); }

    const proc = spawn(bin('adb'), args)
    const session = { proc, serial, buffer: [], started: Date.now() }
    this.sessions.set(serial, session)

    return proc
  }

  stop(serial) {
    const s = this.sessions.get(serial)
    if (s) { try { s.proc.kill() } catch {} ; this.sessions.delete(serial) }
  }

  async getSnapshot(serial, lines = 500, level = 'V') {
    const out = await new Promise(res => {
      const proc = spawn(bin('adb'), ['-s', serial, 'logcat', '-d', '-v', 'time', '-t', String(lines), `*:${level}`])
      let data = ''
      proc.stdout.on('data', d => data += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res(data))
    })
    return this.parseLogs(out)
  }

  parseLogs(raw) {
    const lines = raw.split('\n').filter(Boolean)
    return lines.map(line => {
      // Format: MM-DD HH:MM:SS.mmm PID TID LEVEL TAG: message
      const m = line.match(/^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.+?):\s*(.*)$/)
      if (!m) return { raw: line, level: 'V', tag: 'unknown', message: line, pid: '', time: '' }
      return { time: m[1], pid: m[2], tid: m[3], level: m[4], tag: m[5].trim(), message: m[6], raw: line }
    })
  }

  async clear(serial) {
    return new Promise(async (res) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'logcat', '-c'])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res({ success: true }))
    })
  }

  async getRunningProcesses(serial) {
    const out = await adbShell(serial, 'ps -A 2>/dev/null | head -100').catch(() => '')
    return out.split('\n').filter(Boolean).slice(1).map(line => {
      const parts = line.trim().split(/\s+/)
      return { user: parts[0], pid: parts[1], name: parts[parts.length - 1] }
    }).filter(p => p.pid && p.name)
  }

  async saveToDisk(serial, destPath, lines = 5000) {
    const logs = await this.getSnapshot(serial, lines, 'V')
    const text = logs.map(l => l.raw).join('\n')
    await fs.writeFile(destPath, text)
    return { success: true, lines: logs.length, path: destPath }
  }
}

//                                                                               
// APK ANALYSER (static analysis without external tools)
//                                                                               
export class ApkAnalyser {
  async analyse(apkPath) {
    const result = {
      path: apkPath,
      filename: basename(apkPath),
      size: (await fs.stat(apkPath)).size,
      permissions: [],
      activities: [],
      services: [],
      receivers: [],
      providers: [],
      intentFilters: [],
      trackers: [],
      networkHosts: [],
      strings: [],
      certificates: [],
      minSdk: null,
      targetSdk: null,
      versionName: null,
      versionCode: null,
      packageName: null,
      deepLinks: [],
    }

    // Extract APK (it's a zip)
    const tmpDir = join(app.getPath('temp'), 'omerta_apk_' + Date.now())
    await fs.ensureDir(tmpDir)

    try {
      const StreamZip = (await import('node-stream-zip')).default
      const zip = new StreamZip.async({ file: apkPath })
      
      // Extract AndroidManifest.xml (binary XML - need aapt or manual parse)
      const entries = await zip.entries()
      const entryList = Object.keys(entries)
      result.totalFiles = entryList.length

      // Try aapt2 first for manifest parsing
      const aaptPath = bin('aapt2')
      if (await fs.pathExists(aaptPath)) {
        const aaptOut = await execAsync(aaptPath, ['dump', 'badging', apkPath], { timeout: 15000 })
          .then(r => r.stdout).catch(() => '')
        result.permissions = this._parseAaptPermissions(aaptOut)
        result.packageName = aaptOut.match(/package: name='([^']+)'/)?.[1] || null
        result.versionName = aaptOut.match(/versionName='([^']+)'/)?.[1] || null
        result.versionCode = aaptOut.match(/versionCode='([^']+)'/)?.[1] || null
        result.minSdk = aaptOut.match(/sdkVersion:'([^']+)'/)?.[1] || null
        result.targetSdk = aaptOut.match(/targetSdkVersion:'([^']+)'/)?.[1] || null
        result.activities = [...aaptOut.matchAll(/launchable-activity: name='([^']+)'/g)].map(m => m[1])
        result.deepLinks = [...aaptOut.matchAll(/android\.intent\.action\.VIEW.*?android:scheme='([^']+)'/g)].map(m => m[1])
      }

      // Scan DEX files for strings and known tracker signatures
      const dexFiles = entryList.filter(e => e.endsWith('.dex'))
      for (const dex of dexFiles.slice(0, 3)) { // max 3 dex files
        const data = await zip.entryData(dex)
        const text = data.toString('utf8', 0, Math.min(data.length, 500000))
        
        // Extract readable strings (URLs, class names)
        const urls = [...text.matchAll(/https?:\/\/[^\s"'<>]{4,100}/g)].map(m => m[0])
        result.networkHosts = [...new Set([...result.networkHosts, ...urls.map(u => {
          try { return new URL(u).hostname } catch { return null }
        }).filter(Boolean)])]

        // Known tracker signatures
        const TRACKERS = {
          'Firebase': ['com/google/firebase', 'firebase.google.com'],
          'Facebook': ['com/facebook/analytics', 'graph.facebook.com'],
          'Amplitude': ['com/amplitude', 'api.amplitude.com'],
          'Mixpanel': ['com/mixpanel', 'api.mixpanel.com'],
          'Appsflyer': ['com/appsflyer', 'appsflyer.com'],
          'Adjust': ['com/adjust', 'adjust.com'],
          'Branch': ['io/branch', 'api.branch.io'],
          'Crashlytics': ['com/crashlytics', 'settings.crashlytics.com'],
          'Sentry': ['io/sentry', 'sentry.io'],
          'OneSignal': ['com/onesignal', 'onesignal.com'],
          'Braze': ['com/braze', 'sdk.iad-01.braze.com'],
          'Segment': ['com/segment', 'api.segment.io'],
          'DataDog': ['com/datadog', 'logs.datadog.com'],
        }
        for (const [name, signatures] of Object.entries(TRACKERS)) {
          if (signatures.some(sig => text.includes(sig)) && !result.trackers.includes(name)) {
            result.trackers.push(name)
          }
        }
      }

      // Check certificate
      const certFiles = entryList.filter(e => e.match(/META-INF\/.+\.(RSA|DSA|EC)/i))
      if (certFiles.length > 0) {
        const certData = await zip.entryData(certFiles[0])
        result.certificates.push({
          file: certFiles[0],
          sha256: crypto.createHash('sha256').update(certData).digest('hex'),
          size: certData.length
        })
      }

      await zip.close()
    } catch (e) {
      result.error = e.message
    } finally {
      await fs.remove(tmpDir).catch(() => {})
    }

    return result
  }

  _parseAaptPermissions(aaptOut) {
    const perms = []
    for (const m of aaptOut.matchAll(/uses-permission: name='([^']+)'/g)) {
      const perm = m[1].replace('android.permission.', '')
      const dangerous = ['READ_CONTACTS','WRITE_CONTACTS','READ_SMS','SEND_SMS',
        'ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION','CAMERA','RECORD_AUDIO',
        'READ_EXTERNAL_STORAGE','WRITE_EXTERNAL_STORAGE','READ_CALL_LOG',
        'READ_PHONE_STATE','CALL_PHONE','PROCESS_OUTGOING_CALLS','BODY_SENSORS',
        'ACCESS_BACKGROUND_LOCATION','READ_MEDIA_IMAGES','READ_MEDIA_VIDEO'].includes(perm)
      perms.push({ name: perm, full: m[1], dangerous })
    }
    return perms
  }

  async compareVersions(apkPath1, apkPath2) {
    const [a, b] = await Promise.all([this.analyse(apkPath1), this.analyse(apkPath2)])
    return {
      a: { version: a.versionName, permissions: a.permissions.length, trackers: a.trackers },
      b: { version: b.versionName, permissions: b.permissions.length, trackers: b.trackers },
      newPermissions: b.permissions.filter(p => !a.permissions.find(ap => ap.name === p.name)).map(p => p.name),
      removedPermissions: a.permissions.filter(p => !b.permissions.find(bp => bp.name === p.name)).map(p => p.name),
      newTrackers: b.trackers.filter(t => !a.trackers.includes(t)),
      removedTrackers: a.trackers.filter(t => !b.trackers.includes(t)),
    }
  }
}

//                                                                               
// SQLITE DATABASE BROWSER
//                                                                               
export class SqliteBrowser {
  async openFile(dbPath) {
    const db = await openDb(dbPath, true)
    try {
      const tables = db.all("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
      const info = { path: dbPath, filename: basename(dbPath), tables: [] }
      for (const t of tables) {
        const cols = db.all(`PRAGMA table_info("${t.name}")`)
        const count = db.get(`SELECT COUNT(*) as n FROM "${t.name}"`)
        info.tables.push({ name: t.name, type: t.type, columns: cols, rowCount: count?.n || 0 })
      }
      db.close()
      return info
    } catch (e) { db.close(); throw e }
  }

  async query(dbPath, sql, params = []) {
    const db = await openDb(dbPath, true)
    try {
      const rows = db.all(sql, params)
      db.close()
      return { success: true, rows, count: rows.length }
    } catch (e) {
      db.close()
      return { success: false, error: e.message }
    }
  }

  async queryWrite(dbPath, sql) {
    const db = await openDb(dbPath, false)
    try {
      const result = db.run(sql)
      db.close()
      return { success: true, changes: result.changes }
    } catch (e) {
      db.close()
      return { success: false, error: e.message }
    }
  }

  async pullAndOpen(serial, remotePath, destDir) {
    await fs.ensureDir(destDir)
    const localPath = join(destDir, basename(remotePath))
    await new Promise(async (res, rej) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'pull', remotePath, localPath])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res() : rej(new Error('Pull failed')))
    })
    return this.openFile(localPath)
  }

  async exportToCsv(dbPath, tableName, destPath) {
    const db = await openDb(dbPath, true)
    try {
      const rows = db.all(`SELECT * FROM "${tableName}" LIMIT 50000`)
      db.close()
      if (!rows.length) { await fs.writeFile(destPath, ''); return { success: true, rows: 0 } }
      const headers = Object.keys(rows[0]).join(',')
      const csv = [headers, ...rows.map(r => Object.values(r).map(v =>
        v == null ? '' : typeof v === 'string' ? `"${v.replace(/"/g,'""')}"` : v
      ).join(','))].join('\n')
      await fs.writeFile(destPath, csv)
      return { success: true, rows: rows.length, path: destPath }
    } catch (e) { db.close(); return { success: false, error: e.message } }
  }

  async findAppDatabases(serial) {
    const out = await adbShell(serial, 'find /data/data -name "*.db" 2>/dev/null | head -100').catch(() => '')
    const pubOut = await adbShell(serial, 'find /sdcard -name "*.db" 2>/dev/null | head -50').catch(() => '')
    return [...out.split('\n'), ...pubOut.split('\n')].filter(Boolean)
      .map(p => ({ path: p, app: p.split('/')[3] || 'storage', name: basename(p) }))
  }
}

//                                                                               
// CLIPBOARD SYNC
//                                                                               
export class ClipboardSync {
  constructor() { this.polling = null }

  async getDeviceClipboard(serial) {
    try {
      const out = await adbShell(serial, 'am broadcast -a clipper.get 2>/dev/null | grep -oP "(?<=data=\")[^\"]*"')
      if (out) return out
      // Fallback: use input service on Android 12-
      const out2 = await adbShell(serial, 'service call clipboard 2 s16 com.android.shell 2>/dev/null | grep -oP "(?<=\\(\\\")(.*?)(?=\\\"\\))"')
      return out2 || null
    } catch { return null }
  }

  async setDeviceClipboard(serial, text) {
    const escaped = text.replace(/'/g, "'\\''")
    await adbShell(serial, `am broadcast -a clipper.set -e text '${escaped}' 2>/dev/null || true`)
    // Modern approach via input
    await adbShell(serial, `input text '${escaped.slice(0, 500)}' 2>/dev/null || true`)
    return { success: true }
  }

  async pushPcToDevice(serial, text) {
    return this.setDeviceClipboard(serial, text)
  }

  startPolling(serial, onUpdate, intervalMs = 2000) {
    let lastValue = null
    this.polling = setInterval(async () => {
      try {
        const val = await this.getDeviceClipboard(serial)
        if (val && val !== lastValue) {
          lastValue = val
          onUpdate(val)
        }
      } catch {}
    }, intervalMs)
    return () => clearInterval(this.polling)
  }

  stopPolling() {
    if (this.polling) { clearInterval(this.polling); this.polling = null }
  }
}

//                                                                               
// HARDWARE DIAGNOSTICS
//                                                                               
export class HardwareDiag {
  async getSensorData(serial) {
    const sensorOut = await adbShell(serial, 'dumpsys sensorservice 2>/dev/null | head -80').catch(() => '')
    const sensors = []
    for (const line of sensorOut.split('\n')) {
      const m = line.match(/\d+\)\s+(.+?)\s*\|.*?vendor=(.+?)\|.*?type=(.+?)\|/)
      if (m) sensors.push({ name: m[1].trim(), vendor: m[2].trim(), type: m[3].trim() })
    }
    return sensors
  }

  async getLiveAccelerometer(serial) {
    const out = await adbShell(serial, "dumpsys sensorservice | grep -A5 'Acc'").catch(() => '')
    return out
  }

  async testDisplayColors(serial) {
    // Turn screen solid colours to test for dead pixels
    const colors = ['#FF0000','#00FF00','#0000FF','#FFFFFF','#000000']
    return { colors, instruction: 'Use the colour cycle buttons below to check for dead pixels' }
  }

  async getGPUInfo(serial) {
    const out = await adbShell(serial, 'dumpsys gpu 2>/dev/null | head -30').catch(() => '')
    const gfxInfo = await adbShell(serial, 'getprop ro.hardware.egl 2>/dev/null').catch(() => '')
    const gpu = await adbShell(serial, 'getprop ro.board.platform 2>/dev/null').catch(() => '')
    return { raw: out, egl: gfxInfo, platform: gpu }
  }

  async runUsbSpeedTest(serial, sizeMB = 10) {
    const tmpFile = join(app.getPath('temp'), 'omerta_speedtest.bin')
    // Write test file
    const buf = Buffer.alloc(sizeMB * 1024 * 1024)
    await fs.writeFile(tmpFile, buf)

    const remote = `/data/local/tmp/omerta_speedtest.bin`

    // Upload speed
    const uploadStart = Date.now()
    await new Promise(async (res, rej) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'push', tmpFile, remote])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res() : rej(new Error('Upload failed')))
    })
    const uploadMs = Date.now() - uploadStart
    const uploadMbps = (sizeMB * 8 / (uploadMs / 1000)).toFixed(1)

    // Download speed
    const downloadStart = Date.now()
    await new Promise(async (res, rej) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'pull', remote, tmpFile + '.dl'])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res() : rej(new Error('Download failed')))
    })
    const downloadMs = Date.now() - downloadStart
    const downloadMbps = (sizeMB * 8 / (downloadMs / 1000)).toFixed(1)

    // Cleanup
    await adbShell(serial, `rm -f ${remote}`).catch(() => {})
    await fs.remove(tmpFile).catch(() => {})
    await fs.remove(tmpFile + '.dl').catch(() => {})

    return {
      sizeMB,
      upload: { ms: uploadMs, mbps: parseFloat(uploadMbps) },
      download: { ms: downloadMs, mbps: parseFloat(downloadMbps) },
      rating: parseFloat(uploadMbps) > 200 ? 'USB 3.0+' : parseFloat(uploadMbps) > 40 ? 'USB 2.0' : 'USB 1.1 / Bad cable'
    }
  }

  async getStorageSpeed(serial) {
    const out = await adbShell(serial, `
      dd if=/dev/zero of=/data/local/tmp/omerta_dd bs=1m count=50 2>&1 | tail -3;
      rm -f /data/local/tmp/omerta_dd
    `).catch(() => '')
    const mbps = out.match(/([\d.]+)\s+MB\/s/)
    return { raw: out, mbps: mbps ? parseFloat(mbps[1]) : null }
  }

  async testSpeaker(serial) {
    // Play test tone via media player
    await adbShell(serial, 'am start -a android.intent.action.VIEW -d "https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav" --ez create_new_tab false 2>/dev/null || true').catch(() => {})
    return { success: true, note: 'Opened audio test -- check if device plays sound' }
  }
}

//                                                                               
// WIFI PASSWORD EXTRACTOR
//                                                                               
export class WifiExtractor {
  async extract(serial) {
    const networks = []

    // Android 10+ stores in /data/misc/apexdata/com.android.wifi/WifiConfigStore.xml
    const paths = [
      '/data/misc/apexdata/com.android.wifi/WifiConfigStore.xml',
      '/data/misc/wifi/WifiConfigStore.xml',
      '/data/misc/wifi/wpa_supplicant.conf',
    ]

    for (const wifiPath of paths) {
      const content = await adbShell(serial, `cat "${wifiPath}" 2>/dev/null`).catch(() => '')
      if (!content) continue

      if (wifiPath.includes('WifiConfigStore')) {
        // XML format
        const ssidMatches = [...content.matchAll(/<string name="SSID">&quot;([^&]+)&quot;<\/string>/g)]
        const passMatches = [...content.matchAll(/<string name="PreSharedKey">&quot;([^&]+)&quot;<\/string>/g)]
        ssidMatches.forEach((m, i) => {
          networks.push({
            ssid: m[1],
            password: passMatches[i]?.[1] || '(open/WPA-Enterprise)',
            source: wifiPath
          })
        })
      } else if (wifiPath.includes('wpa_supplicant')) {
        // wpa_supplicant.conf format
        const blocks = content.split('network={')
        for (const block of blocks.slice(1)) {
          const ssid = block.match(/ssid="([^"]+)"/)?.[1]
          const psk = block.match(/psk="([^"]+)"/)?.[1] || block.match(/psk=([^\n]+)/)?.[1]
          if (ssid) networks.push({ ssid, password: psk || '(open)', source: wifiPath })
        }
      }
    }

    // Android 12+ with root: try newer format
    if (!networks.length) {
      const out = await adbShell(serial, 'cmd wifi list-networks 2>/dev/null').catch(() => '')
      if (out) {
        for (const line of out.split('\n').filter(l => l.includes('SSID'))) {
          const ssid = line.match(/SSID:\s*(.+)/)?.[1]
          if (ssid) networks.push({ ssid: ssid.trim(), password: '(requires root for password)', source: 'cmd wifi' })
        }
      }
    }

    return networks
  }

  async exportToCsv(networks, destPath) {
    const csv = ['SSID,Password,Source',
      ...networks.map(n => `"${n.ssid}","${n.password || ''}","${n.source}"`)
    ].join('\n')
    await fs.writeFile(destPath, csv)
    return { success: true, count: networks.length, path: destPath }
  }
}

//                                                                               
// CERTIFICATE MANAGER
//                                                                               
export class CertificateManager {
  async listUserCerts(serial) {
    const out = await adbShell(serial, 'ls /data/misc/user/0/cacerts-added/ 2>/dev/null').catch(() => '')
    return out.split('\n').filter(Boolean).map(f => ({ file: f, type: 'user', path: `/data/misc/user/0/cacerts-added/${f}` }))
  }

  async listSystemCerts(serial) {
    const out = await adbShell(serial, 'ls /system/etc/security/cacerts/ 2>/dev/null | head -20').catch(() => '')
    return out.split('\n').filter(Boolean).map(f => ({ file: f, type: 'system', path: `/system/etc/security/cacerts/${f}` }))
  }

  async installUserCert(serial, certPath) {
    // Push to /sdcard then use Android cert install
    const remote = `/sdcard/omerta_cert_${Date.now()}.pem`
    await new Promise(async (res, rej) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'push', certPath, remote])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res() : rej(new Error('Push failed')))
    })
    // Open Android cert installer
    await adbShell(serial, `am start -n com.android.settings/.security.CertInstaller -a android.intent.action.VIEW -d file://${remote} --es android.intent.extra.CERTIFICATE_INSTALL_ACTION install 2>/dev/null || am start -a android.security.INSTALL_CERTIFICATE -n com.android.settings/.security.CertInstaller 2>/dev/null || true`)
    return { success: true, note: 'Certificate install dialog opened on device. Follow prompts.' }
  }

  async removeCert(serial, certFile) {
    await adbShell(serial, `rm -f /data/misc/user/0/cacerts-added/${certFile} 2>/dev/null`)
    return { success: true }
  }

  async installMitmCert(serial, type = 'charles') {
    // Download well-known proxy CA certs
    const urls = {
      charles: 'https://www.charlesproxy.com/ssl.crt',
      burp: 'https://portswigger.net/burp/application-security-testing/burp-suite-community',
    }
    return { note: `Download the ${type} root CA from ${urls[type] || 'the proxy tool'}, then use Install Certificate above.` }
  }
}

//                                                                               
// FRIDA MANAGER
//                                                                               
export class FridaManager {
  fridaPath() { return bin('frida') }
  fridaServerPath() { return bin('frida-server') }

  async isAvailable() {
    return fs.pathExists(this.fridaPath())
  }

  async getVersion() {
    const out = await execAsync(this.fridaPath(), ['--version']).then(r => r.stdout.trim()).catch(() => null)
    return out
  }

  async pushServer(serial, serverBinary) {
    const remote = '/data/local/tmp/frida-server'
    await new Promise(async (res, rej) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'push', serverBinary, remote])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res() : rej(new Error('Push failed')))
    })
    await adbShell(serial, `chmod 755 ${remote}`)
    return { success: true, path: remote }
  }

  async startServer(serial) {
    // Start frida-server on device via ADB (requires root)
    const proc = spawn(bin('adb'), ['-s', serial, 'shell', 'su -c "/data/local/tmp/frida-server &"'])
    await new Promise(res => setTimeout(res, 2000))
    proc.kill()
    // Verify it started
    const running = await adbShell(serial, 'pgrep -x frida-server').catch(() => '')
    return { success: !!running.trim(), pid: running.trim() }
  }

  async stopServer(serial) {
    await adbShell(serial, 'pkill -f frida-server 2>/dev/null || true')
    return { success: true }
  }

  async listProcesses(serial) {
    const ver = await this.getVersion()
    if (!ver) return { error: 'Frida not found in bin/ -- download from frida.re/releases' }
    return new Promise(async (resolve) => {
      const proc = spawn(this.fridaPath(), ['-U', '-D', serial, '--no-pause', '-q', '--eval', 'JSON.stringify(Process.enumerateModulesSync())'])
      // Use frida-ps instead
      const ps = spawn(this.fridaPath().replace('frida', 'frida-ps') || this.fridaPath(), ['-U'])
      let out = ''
      ps.stdout.on('data', d => out += d)
      ps.on('close', () => {
        const lines = out.split('\n').slice(1).filter(Boolean)
        resolve(lines.map(l => {
          const parts = l.trim().split(/\s+/)
          return { pid: parts[0], name: parts.slice(1).join(' ') }
        }))
      })
    })
  }

  async inject(serial, target, scriptPath, onOutput) {
    const ver = await this.getVersion()
    if (!ver) return { error: 'Frida not found. Download frida CLI from frida.re/releases and place in bin/' }

    const scriptContent = await fs.readFile(scriptPath, 'utf8')
    const tmpScript = join(app.getPath('temp'), 'omerta_frida_script.js')
    await fs.writeFile(tmpScript, scriptContent)

    const args = ['-U']
    if (/^\d+$/.test(String(target))) args.push('-p', String(target))
    else args.push('-n', String(target))
    args.push('-l', tmpScript)

    const proc = spawn(this.fridaPath(), args)
    proc.stdout.on('data', d => onOutput?.({ type: 'stdout', data: d.toString() }))
    proc.stderr.on('data', d => onOutput?.({ type: 'stderr', data: d.toString() }))

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => onOutput?.({ type: 'exit', code }))

    return { success: true, pid: proc.pid, kill: () => proc.kill() }
  }

  getScriptTemplates() {
    return [
      {
        name: 'Log all HTTP requests',
        description: 'Intercept and log OkHttp/HTTPSURLConnection calls',
        code: `Java.perform(function() {
  var OkHttpClient = Java.use('okhttp3.OkHttpClient');
  var Request = Java.use('okhttp3.Request');
  OkHttpClient.newCall.overload('okhttp3.Request').implementation = function(req) {
    console.log('[HTTP] ' + req.method() + ' ' + req.url().toString());
    return this.newCall(req);
  };
});`
      },
      {
        name: 'Bypass SSL pinning (OkHttp)',
        description: 'Bypass certificate pinning in apps using OkHttp',
        code: `Java.perform(function() {
  try {
    var CertPinner = Java.use('okhttp3.CertificatePinner');
    CertPinner.check.overload('java.lang.String', 'java.util.List').implementation = function() {
      console.log('[SSL Pin Bypass] Bypassed for: ' + arguments[0]);
      return;
    };
  } catch(e) { console.log('CertPinner not found: ' + e); }
});`
      },
      {
        name: 'Log SharedPreferences reads',
        description: 'Monitor what prefs keys an app reads',
        code: `Java.perform(function() {
  var SP = Java.use('android.app.SharedPreferencesImpl');
  SP.getString.overload('java.lang.String', 'java.lang.String').implementation = function(key, def) {
    var val = this.getString(key, def);
    console.log('[SharedPrefs] getString(' + key + ') = ' + val);
    return val;
  };
});`
      },
      {
        name: 'Bypass root detection',
        description: 'Hook common root detection methods',
        code: `Java.perform(function() {
  var RootBeer = null;
  try { RootBeer = Java.use('com.scottyab.rootbeer.RootBeer'); } catch(e) {}
  if (RootBeer) {
    RootBeer.isRooted.implementation = function() { return false; };
    console.log('[Root Bypass] RootBeer bypassed');
  }
  var File = Java.use('java.io.File');
  File.exists.implementation = function() {
    var name = this.getAbsolutePath();
    if (name.includes('su') || name.includes('busybox') || name.includes('Magisk')) {
      console.log('[Root Bypass] Blocked exists() for: ' + name);
      return false;
    }
    return this.exists();
  };
});`
      },
      {
        name: 'Dump all classes',
        description: 'List all loaded Java classes (slow on large apps)',
        code: `Java.perform(function() {
  Java.enumerateLoadedClasses({
    onMatch: function(name) { console.log(name); },
    onComplete: function() { console.log('Done'); }
  });
});`
      },
    ]
  }
}

//                                                                               
// INTENT SENDER
//                                                                               
export class IntentSender {
  async send(serial, intent) {
    const { action, component, data, category, flags, extras, type } = intent
    const cmd = ['am']
    cmd.push(type === 'activity' ? 'start' : type === 'service' ? 'startservice' : 'broadcast')
    if (action)    cmd.push('-a', action)
    if (component) cmd.push('-n', component)
    if (data)      cmd.push('-d', data)
    if (category)  cmd.push('-c', category)
    if (flags)     cmd.push('-f', flags)
    if (extras) {
      for (const [k, v] of Object.entries(extras)) {
        if (typeof v === 'boolean') cmd.push('--ez', k, String(v))
        else if (typeof v === 'number' && Number.isInteger(v)) cmd.push('--ei', k, String(v))
        else if (typeof v === 'number') cmd.push('--ef', k, String(v))
        else cmd.push('--es', k, String(v))
      }
    }
    const result = await adbShell(serial, cmd.join(' ')).catch(e => e.message)
    return { success: !result?.includes('Error'), output: result, command: cmd.join(' ') }
  }

  getPresets() {
    return [
      { name: 'Open URL in browser',       type:'activity',  action:'android.intent.action.VIEW', data:'https://example.com' },
      { name: 'Fake boot complete',         type:'broadcast', action:'android.intent.action.BOOT_COMPLETED' },
      { name: 'Trigger media scan',         type:'broadcast', action:'android.intent.action.MEDIA_MOUNTED', data:'file:///sdcard' },
      { name: 'Open Wi-Fi settings',        type:'activity',  action:'android.settings.WIFI_SETTINGS' },
      { name: 'Open developer options',     type:'activity',  action:'android.settings.APPLICATION_DEVELOPMENT_SETTINGS' },
      { name: 'Simulate low battery',       type:'broadcast', action:'android.intent.action.BATTERY_LOW' },
      { name: 'Open app settings for pkg',  type:'activity',  action:'android.settings.APPLICATION_DETAILS_SETTINGS', data:'package:{pkg}' },
      { name: 'Force crash target app',     type:'activity',  action:'android.intent.action.MAIN', component:'{pkg}/.CrashActivity' },
      { name: 'Toggle airplane mode',       type:'broadcast', action:'android.intent.action.AIRPLANE_MODE', extras:{ state: true } },
      { name: 'Clear notifications',        type:'broadcast', action:'android.service.notification.HINT_HOST_CONNECTED' },
    ]
  }
}

//                                                                               
// LAYOUT INSPECTOR (view hierarchy dumper)
//                                                                               
export class LayoutInspector {
  async dumpHierarchy(serial) {
    const remote = '/data/local/tmp/omerta_window_dump.xml'
    await adbShell(serial, `uiautomator dump ${remote} 2>/dev/null`)
    const content = await adbShell(serial, `cat ${remote} 2>/dev/null`)
    await adbShell(serial, `rm -f ${remote}`)
    if (!content) return { error: 'Failed to dump UI hierarchy. Make sure screen is on and unlocked.' }
    return { success: true, xml: content, parsed: this.parseXml(content) }
  }

  parseXml(xml) {
    // Parse uiautomator XML dump into tree structure
    const nodes = []
    const regex = /<node[^>]+>/g
    let match
    while ((match = regex.exec(xml)) !== null) {
      const node = {}
      const attrs = match[0].match(/(\w+)="([^"]*)"/g) || []
      for (const attr of attrs) {
        const [k, v] = attr.split('="')
        node[k] = v?.replace(/"$/, '')
      }
      nodes.push(node)
    }
    return nodes
  }

  async findElement(serial, text) {
    const hierarchy = await this.dumpHierarchy(serial)
    if (!hierarchy.parsed) return hierarchy
    return hierarchy.parsed.filter(n =>
      n.text?.toLowerCase().includes(text.toLowerCase()) ||
      n['content-desc']?.toLowerCase().includes(text.toLowerCase()) ||
      n['resource-id']?.toLowerCase().includes(text.toLowerCase())
    )
  }

  async screenshot(serial) {
    const remote = '/sdcard/omerta_hier_ss.png'
    await adbShell(serial, `screencap -p ${remote}`)
    const local = join(app.getPath('temp'), 'omerta_hier_ss.png')
    await new Promise(async (res, rej) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'pull', remote, local])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res() : rej())
    })
    await adbShell(serial, `rm -f ${remote}`)
    const data = await fs.readFile(local)
    return { base64: data.toString('base64'), mimeType: 'image/png' }
  }
}

//                                                                               
// MOCK LOCATION
//                                                                               
export class MockLocation {
  async enable(serial) {
    // Enable mock location permission
    await adbShell(serial, 'settings put secure mock_location 1 2>/dev/null || true')
    await adbShell(serial, 'settings put global development_settings_enabled 1')
    return { success: true, note: 'Enable "Mock location app" in Developer Options and select a GPS mock app' }
  }

  async setLocation(serial, lat, lng, accuracy = 5) {
    // Use geo fix for emulators
    await adbShell(serial, `geo fix ${lng} ${lat} ${accuracy} 2>/dev/null || true`)
    // Use telnet for AVD
    // For real devices, use a mock location app via ADB
    await adbShell(serial, `am broadcast -a android.intent.action.MOCK_LOCATION_CHANGED --ef latitude ${lat} --ef longitude ${lng} 2>/dev/null || true`)
    return { success: true, lat, lng, note: 'Location set. App using mock location provider will see this position.' }
  }

  async stopMock(serial) {
    await adbShell(serial, 'settings put secure mock_location 0 2>/dev/null || true')
    return { success: true }
  }

  getPresetLocations() {
    return [
      { name: 'Sydney, Australia',     lat: -33.8688, lng: 151.2093 },
      { name: 'London, UK',            lat: 51.5074,  lng: -0.1278  },
      { name: 'New York, USA',         lat: 40.7128,  lng: -74.0060 },
      { name: 'Tokyo, Japan',          lat: 35.6762,  lng: 139.6503 },
      { name: 'Dubai, UAE',            lat: 25.2048,  lng: 55.2708  },
      { name: 'Null Island (0,0)',      lat: 0,        lng: 0        },
      { name: 'North Pole',            lat: 90,       lng: 0        },
      { name: 'Bermuda Triangle',      lat: 25.0,     lng: -71.0    },
    ]
  }
}

//                                                                               
// APP CLONER
//                                                                               
export class AppCloner {
  async clone(serial, sourceApk, newPkgSuffix = '2') {
    // Pull APK, repackage with new package ID
    const tmpDir = join(app.getPath('temp'), 'omerta_clone_' + Date.now())
    await fs.ensureDir(tmpDir)

    try {
      // For basic clone we patch the manifest package name
      // Real implementation needs apktool or aapt2 for proper repackaging
      const apktool = bin('apktool')
      if (!await fs.pathExists(apktool)) {
        return {
          error: 'apktool not found',
          note: 'App cloning requires apktool. Download from apktool.ibotpeaches.com and place in bin/',
          alternative: 'Use parallel space apps like "Parallel Space" (F-Droid) on the device instead'
        }
      }

      const decodedDir = join(tmpDir, 'decoded')
      await execAsync(apktool, ['d', sourceApk, '-o', decodedDir, '-f'], { timeout: 60000 })

      // Read and patch manifest
      const manifestPath = join(decodedDir, 'AndroidManifest.xml')
      let manifest = await fs.readFile(manifestPath, 'utf8')
      const originalPkg = manifest.match(/package="([^"]+)"/)?.[1]
      if (!originalPkg) throw new Error('Could not find package name in manifest')
      const newPkg = originalPkg + '.' + newPkgSuffix
      manifest = manifest.replace(new RegExp(originalPkg.replace('.', '\\.'), 'g'), newPkg)
      await fs.writeFile(manifestPath, manifest)

      // Rebuild
      const outApk = join(tmpDir, 'cloned.apk')
      await execAsync(apktool, ['b', decodedDir, '-o', outApk], { timeout: 120000 })

      return { success: true, path: outApk, originalPkg, newPkg, note: 'Install the cloned APK -- you can have both versions installed simultaneously.' }
    } finally {
      // Keep tmpDir -- user needs to install the APK
    }
  }
}

//                                                                               
// TRAFFIC MONITOR
//                                                                               
export class TrafficMonitor {
  async getNetworkStats(serial) {
    const out = await adbShell(serial, 'cat /proc/net/xt_qtaguid/stats 2>/dev/null || cat /proc/net/dev 2>/dev/null').catch(() => '')
    return out
  }

  async getUidTraffic(serial) {
    // Map UID to app traffic
    const stats = await adbShell(serial, 'cat /proc/net/xt_qtaguid/stats 2>/dev/null').catch(() => '')
    const uidMap = await this.getUidMap(serial)
    const traffic = {}

    for (const line of stats.split('\n').slice(1).filter(Boolean)) {
      const parts = line.split(/\s+/)
      if (parts.length < 8) continue
      const uid = parts[3]
      const rxBytes = parseInt(parts[5]) || 0
      const txBytes = parseInt(parts[7]) || 0
      if (!traffic[uid]) traffic[uid] = { rx: 0, tx: 0, app: uidMap[uid] || `UID:${uid}` }
      traffic[uid].rx += rxBytes
      traffic[uid].tx += txBytes
    }

    return Object.entries(traffic)
      .map(([uid, data]) => ({ uid, ...data }))
      .sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx))
      .slice(0, 30)
  }

  async getUidMap(serial) {
    const out = await adbShell(serial, 'pm list packages --uid 2>/dev/null | head -200').catch(() => '')
    const map = {}
    for (const line of out.split('\n').filter(Boolean)) {
      const m = line.match(/package:(.+)\s+uid:(\d+)/)
      if (m) map[m[2]] = m[1]
    }
    return map
  }

  async getLiveConnections(serial) {
    const out = await adbShell(serial, 'ss -tunapH 2>/dev/null || netstat -tuanp 2>/dev/null | head -50').catch(() => '')
    return out.split('\n').filter(l => l.includes('ESTAB') || l.includes('ESTABLISHED')).map(line => {
      const parts = line.trim().split(/\s+/)
      return { proto: parts[0], local: parts[4], remote: parts[5], state: parts[1], pid: parts[parts.length-1] }
    })
  }
}

export default {
  LogcatManager, ApkAnalyser, SqliteBrowser, ClipboardSync,
  HardwareDiag, WifiExtractor, CertificateManager, FridaManager,
  IntentSender, LayoutInspector, MockLocation, AppCloner, TrafficMonitor
}
