import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { join, basename } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import axios from 'axios'
import archiver from 'archiver'

const execAsync = promisify(execFile)
function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}
function adb(...args) { return execAsync(bin('adb'), args, { timeout: 15000 }) }
function adbShell(serial, cmd) { return adb('-s', serial, 'shell', cmd) }

//    App Updater                                                                
export class AppUpdater {
  async getInstalledAppsWithVersions(serial) {
    const { stdout: packages } = await adbShell(serial, 'pm list packages -3')
    const pkgList = packages.trim().split('\n').filter(Boolean).map(l => l.replace('package:', '').trim())
    const apps = []
    // Get version codes in batches
    const batchSize = 15
    for (let i = 0; i < pkgList.length; i += batchSize) {
      const batch = pkgList.slice(i, i + batchSize)
      try {
        const cmds = batch.map(p => `pm dump ${p} | grep -m1 versionName`).join(' && ')
        const { stdout } = await adbShell(serial, cmds)
        const lines = stdout.trim().split('\n')
        batch.forEach((pkg, j) => {
          const line = lines[j] || ''
          const version = line.match(/versionName=([^\s]+)/)?.[1] || 'unknown'
          apps.push({ pkg, version })
        })
      } catch {
        batch.forEach(pkg => apps.push({ pkg, version: 'unknown' }))
      }
    }
    return apps
  }

  async checkApkMirror(pkg, currentVersion) {
    // APKMirror has an unofficial API via their website
    try {
      const searchName = pkg.split('.').pop().replace(/_/g, '-')
      const res = await axios.get(`https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s=${encodeURIComponent(pkg)}`, {
        timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      })
      const versionMatch = res.data.match(/class="infoslide-value">([^<]+)<\/span>/g)
      if (versionMatch) {
        const latestVersion = versionMatch[0]?.replace(/<[^>]+>/g, '').trim()
        return {
          pkg,
          currentVersion,
          latestVersion,
          hasUpdate: latestVersion && latestVersion !== currentVersion,
          source: 'APKMirror',
          searchUrl: `https://www.apkmirror.com/?s=${encodeURIComponent(pkg)}`
        }
      }
    } catch {}
    return { pkg, currentVersion, latestVersion: null, hasUpdate: false }
  }

  async checkApkPure(pkg, currentVersion) {
    try {
      const res = await axios.get(`https://apkpure.com/${pkg.replace(/\./g, '-')}/${pkg}`, {
        timeout: 6000, headers: { 'User-Agent': 'Mozilla/5.0' }
      })
      const versionMatch = res.data.match(/"version":"([^"]+)"/)?.[1]
      return {
        pkg, currentVersion, latestVersion: versionMatch || null,
        hasUpdate: versionMatch && versionMatch !== currentVersion,
        source: 'APKPure',
        searchUrl: `https://apkpure.com/search?q=${encodeURIComponent(pkg)}`
      }
    } catch {
      return { pkg, currentVersion, latestVersion: null, hasUpdate: false }
    }
  }

  async checkAllUpdates(serial, onProgress) {
    onProgress?.({ percent: 5, message: 'Getting installed apps...' })
    const apps = await this.getInstalledAppsWithVersions(serial)
    const results = []
    const sample = apps.slice(0, 60) // Check top 60 user apps
    for (let i = 0; i < sample.length; i++) {
      const { pkg, version } = sample[i]
      onProgress?.({ percent: 10 + Math.round(i / sample.length * 85), message: `Checking ${pkg}...` })
      const result = await this.checkApkMirror(pkg, version).catch(() => ({ pkg, currentVersion: version, hasUpdate: false }))
      if (result.hasUpdate) results.push(result)
    }
    onProgress?.({ percent: 100, message: `Found ${results.length} updates` })
    return { updates: results, checked: sample.length }
  }

  async getFdroidUpdates(serial) {
    try {
      const res = await axios.get('https://f-droid.org/api/v1/packages/', { timeout: 8000 })
      const { stdout: installed } = await adbShell(serial, 'pm list packages -3')
      const pkgs = new Set(installed.trim().split('\n').map(l => l.replace('package:', '').trim()))
      const updates = []
      for (const [pkg, info] of Object.entries(res.data || {})) {
        if (pkgs.has(pkg) && info.latestVersionCode) {
          updates.push({ pkg, source: 'F-Droid', version: info.latestVersionName || '', url: `https://f-droid.org/en/packages/${pkg}/` })
        }
      }
      return updates
    } catch { return [] }
  }
}

//    Forensics Export                                                           
export class ForensicsExport {
  async exportFull(serial, destDir, options = {}, onProgress) {
    await fs.ensureDir(destDir)
    const manifest = {
      exportedAt: new Date().toISOString(),
      device: serial,
      tool: 'Omerta v1.0',
      format: 'Omerta Forensic Export v1',
      contents: []
    }

    onProgress?.({ percent: 5, message: 'Collecting device info...' })
    try {
      const { stdout: props } = await adbShell(serial, 'getprop')
      await fs.writeFile(join(destDir, 'device_properties.txt'), props)
      manifest.contents.push('device_properties.txt')
    } catch {}

    if (options.sms !== false) {
      onProgress?.({ percent: 15, message: 'Extracting SMS/MMS...' })
      const smsData = await this._extractSms(serial)
      await fs.writeJSON(join(destDir, 'sms.json'), smsData, { spaces: 2 })
      manifest.contents.push('sms.json')
    }

    if (options.callLog !== false) {
      onProgress?.({ percent: 25, message: 'Extracting call log...' })
      const calls = await this._extractCallLog(serial)
      await fs.writeJSON(join(destDir, 'call_log.json'), calls, { spaces: 2 })
      manifest.contents.push('call_log.json')
    }

    if (options.contacts !== false) {
      onProgress?.({ percent: 35, message: 'Extracting contacts...' })
      const contacts = await this._extractContacts(serial)
      await fs.writeFile(join(destDir, 'contacts.vcf'), contacts)
      manifest.contents.push('contacts.vcf')
    }

    if (options.apps !== false) {
      onProgress?.({ percent: 45, message: 'Extracting app list...' })
      const { stdout: appList } = await adbShell(serial, 'pm list packages -f -3').catch(() => ({ stdout: '' }))
      await fs.writeFile(join(destDir, 'installed_apps.txt'), appList)
      manifest.contents.push('installed_apps.txt')
    }

    if (options.media !== false) {
      onProgress?.({ percent: 55, message: 'Pulling media files...' })
      const mediaDir = join(destDir, 'media')
      await fs.ensureDir(mediaDir)
      for (const folder of ['/sdcard/DCIM', '/sdcard/Pictures', '/sdcard/Download']) {
        await new Promise(res => {
          const p = spawn(bin('adb'), ['-s', serial, 'pull', folder, mediaDir])
          p.on('close', () => res())
        })
      }
      manifest.contents.push('media/')
    }

    if (options.browserHistory !== false) {
      onProgress?.({ percent: 70, message: 'Extracting browser history...' })
      const history = await this._extractBrowserHistory(serial)
      if (history.length) {
        await fs.writeJSON(join(destDir, 'browser_history.json'), history, { spaces: 2 })
        manifest.contents.push('browser_history.json')
      }
    }

    if (options.wifiNetworks !== false) {
      onProgress?.({ percent: 80, message: 'Extracting Wi-Fi networks...' })
      const wifi = await this._extractWifiNetworks(serial)
      await fs.writeJSON(join(destDir, 'wifi_networks.json'), wifi, { spaces: 2 })
      manifest.contents.push('wifi_networks.json')
    }

    onProgress?.({ percent: 88, message: 'Writing manifest...' })
    await fs.writeJSON(join(destDir, 'manifest.json'), manifest, { spaces: 2 })

    // Generate HTML report
    onProgress?.({ percent: 92, message: 'Generating report...' })
    const reportHtml = this._generateReport(manifest, destDir)
    await fs.writeFile(join(destDir, 'report.html'), reportHtml)

    // ZIP everything
    onProgress?.({ percent: 94, message: 'Creating archive...' })
    const zipPath = destDir + '_forensic_export.zip'
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath)
      const archive = archiver('zip', { zlib: { level: 6 } })
      output.on('close', resolve)
      archive.on('error', reject)
      archive.pipe(output)
      archive.directory(destDir, false)
      archive.finalize()
    })

    onProgress?.({ percent: 100, message: 'Export complete!' })
    return { success: true, dest: destDir, archive: zipPath, contents: manifest.contents }
  }

  async _extractSms(serial) {
    const { stdout } = await adbShell(serial,
      'content query --uri content://sms/ --projection address:body:date:type --sort "date DESC" 2>/dev/null | head -10000'
    ).catch(() => ({ stdout: '' }))
    return stdout.split('\n').filter(l => l.includes('address=')).map(l => ({
      address: l.match(/address=([^,\n]+)/)?.[1]?.trim() || '',
      body: l.match(/body=([^,\n]+)/)?.[1]?.trim() || '',
      date: new Date(parseInt(l.match(/date=(\d+)/)?.[1] || 0)).toISOString(),
      type: l.match(/type=(\d)/)?.[1] === '1' ? 'received' : 'sent'
    }))
  }

  async _extractCallLog(serial) {
    const { stdout } = await adbShell(serial,
      'content query --uri content://call_log/calls/ --projection number:date:duration:type --sort "date DESC" 2>/dev/null | head -2000'
    ).catch(() => ({ stdout: '' }))
    return stdout.split('\n').filter(l => l.includes('number=')).map(l => ({
      number: l.match(/number=([^,\n]+)/)?.[1]?.trim() || '',
      date: new Date(parseInt(l.match(/date=(\d+)/)?.[1] || 0)).toISOString(),
      duration: parseInt(l.match(/duration=(\d+)/)?.[1] || 0),
      type: { '1': 'INCOMING', '2': 'OUTGOING', '3': 'MISSED', '5': 'REJECTED' }[l.match(/type=(\d)/)?.[1]] || 'UNKNOWN'
    }))
  }

  async _extractContacts(serial) {
    const { stdout } = await adbShell(serial,
      'content query --uri content://contacts/phones/ --projection display_name:number 2>/dev/null | head -2000'
    ).catch(() => ({ stdout: '' }))
    const entries = stdout.split('\n').filter(l => l.includes('display_name=')).map(l => {
      const name = l.match(/display_name=([^,\n]+)/)?.[1]?.trim() || ''
      const number = l.match(/number=([^,\n]+)/)?.[1]?.trim() || ''
      return `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;TYPE=CELL:${number}\nEND:VCARD`
    })
    return entries.join('\n\n')
  }

  async _extractBrowserHistory(serial) {
    const browsers = [
      'com.android.chrome',
      'org.mozilla.firefox',
      'com.brave.browser',
    ]
    const results = []
    for (const browser of browsers) {
      try {
        const { stdout } = await adbShell(serial,
          `content query --uri content://com.android.browser.history/history/ --projection url:title:date 2>/dev/null | head -500`
        ).catch(() => ({ stdout: '' }))
        const entries = stdout.split('\n').filter(l => l.includes('url=')).map(l => ({
          browser,
          url: l.match(/url=([^,\n]+)/)?.[1]?.trim() || '',
          title: l.match(/title=([^,\n]+)/)?.[1]?.trim() || '',
          date: new Date(parseInt(l.match(/date=(\d+)/)?.[1] || 0)).toISOString()
        }))
        results.push(...entries)
      } catch {}
    }
    return results
  }

  async _extractWifiNetworks(serial) {
    const { stdout } = await adbShell(serial,
      'cat /data/misc/wifi/WifiConfigStore.xml 2>/dev/null | head -200'
    ).catch(() => ({ stdout: '' }))
    const networks = []
    const ssidMatches = stdout.matchAll(/SSID value="([^"]+)"/g)
    for (const m of ssidMatches) {
      networks.push({ ssid: m[1] })
    }
    return networks
  }

  _generateReport(manifest, destDir) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Omerta Forensic Report</title>
<style>body{font-family:monospace;background:#1a1a2e;color:#e0e0e0;padding:2rem;max-width:900px;margin:0 auto}
h1{color:#00d4ff;border-bottom:1px solid #333;padding-bottom:1rem}
h2{color:#00d4ff;margin-top:2rem}.info{color:#aaa;font-size:13px}
.item{padding:6px 0;border-bottom:1px solid #333}.tag{background:#00d4ff22;color:#00d4ff;padding:2px 8px;border-radius:4px;font-size:12px}
</style></head><body>
<h1>Omerta Forensic Export Report</h1>
<div class="info">Device: ${manifest.device}</div>
<div class="info">Exported: ${new Date(manifest.exportedAt).toLocaleString()}</div>
<div class="info">Tool: ${manifest.tool}</div>
<h2>Contents</h2>
${manifest.contents.map(c => `<div class="item"><span class="tag">${c.includes('.json') ? 'JSON' : c.includes('.vcf') ? 'VCard' : c.includes('/') ? 'DIR' : 'TXT'}</span> ${c}</div>`).join('')}
<h2>Usage</h2>
<p>This export is compatible with standard forensic review. JSON files can be opened in any text editor or imported into forensic tools. The report.html file provides a human-readable summary.</p>
</body></html>`
  }
}

//    Cross-Device Transfer                                                      
export class CrossDeviceTransfer {
  async detectDevices() {
    const devices = []
    try {
      const { stdout } = await execAsync(bin('adb'), ['devices', '-l'], { timeout: 5000 })
      const lines = stdout.split('\n').slice(1).filter(l => l.trim() && !l.startsWith('*'))
      for (const line of lines) {
        const [serial, state] = line.trim().split(/\s+/)
        if (state === 'device') {
          const { stdout: model } = await execAsync(bin('adb'), ['-s', serial, 'shell', 'getprop ro.product.model'], { timeout: 3000 })
          devices.push({ serial, type: 'android', model: model.trim(), state })
        }
      }
    } catch {}
    try {
      const { stdout } = await execAsync(bin('idevice_id'), ['-l'], { timeout: 5000 })
      const udids = stdout.trim().split('\n').filter(Boolean)
      for (const udid of udids) {
        devices.push({ serial: udid, type: 'ios', model: 'iOS Device', state: 'connected' })
      }
    } catch {}
    return devices
  }

  async transfer(sourceSerial, sourceType, destSerial, destType, options, onProgress) {
    const tmpDir = join(app.getPath('temp'), 'ft_transfer_' + Date.now())
    await fs.ensureDir(tmpDir)

    onProgress?.({ percent: 5, message: 'Starting data extraction from source...' })

    // Pull from source
    const categories = []
    if (options.photos !== false) categories.push({ remote: sourceType === 'ios' ? 'DCIM' : '/sdcard/DCIM', local: 'DCIM' })
    if (options.downloads !== false) categories.push({ remote: '/sdcard/Download', local: 'Downloads' })
    if (options.documents !== false) categories.push({ remote: '/sdcard/Documents', local: 'Documents' })
    if (options.whatsapp !== false) categories.push({ remote: '/sdcard/Android/media/com.whatsapp', local: 'WhatsApp' })

    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i]
      onProgress?.({ percent: 10 + Math.round(i / categories.length * 40), message: `Pulling ${cat.local}...` })
      const localDir = join(tmpDir, cat.local)
      await fs.ensureDir(localDir)
      try {
        if (sourceType === 'android') {
          await new Promise(res => {
            const p = spawn(bin('adb'), ['-s', sourceSerial, 'pull', cat.remote, localDir])
            p.on('close', () => res())
          })
        }
      } catch {}
    }

    // Handle contacts
    if (options.contacts !== false) {
      onProgress?.({ percent: 55, message: 'Exporting contacts...' })
      const { stdout: contacts } = await adbShell(sourceSerial,
        'content query --uri content://contacts/phones/ --projection display_name:number 2>/dev/null').catch(() => ({ stdout: '' }))
      const vcf = contacts.split('\n').filter(l => l.includes('display_name=')).map(l => {
        const name = l.match(/display_name=([^,\n]+)/)?.[1]?.trim() || ''
        const number = l.match(/number=([^,\n]+)/)?.[1]?.trim() || ''
        return `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL:${number}\nEND:VCARD`
      }).join('\n\n')
      await fs.writeFile(join(tmpDir, 'contacts.vcf'), vcf)
    }

    onProgress?.({ percent: 60, message: 'Pushing to destination device...' })

    // Push to destination
    if (destType === 'android') {
      for (const dir of await fs.readdir(tmpDir)) {
        const localPath = join(tmpDir, dir)
        const stat = await fs.stat(localPath)
        if (stat.isDirectory()) {
          onProgress?.({ percent: 65, message: `Pushing ${dir}...` })
          await new Promise(res => {
            const p = spawn(bin('adb'), ['-s', destSerial, 'push', localPath, `/sdcard/${dir}`])
            p.on('close', () => res())
          })
        }
      }
    }

    onProgress?.({ percent: 95, message: 'Cleaning up...' })
    await fs.remove(tmpDir)
    onProgress?.({ percent: 100, message: 'Transfer complete!' })
    return { success: true }
  }
}
