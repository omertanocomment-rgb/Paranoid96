import axios from 'axios'
import * as cheerio from 'cheerio'
import { spawn } from 'child_process'
import { join, basename } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import archiver from 'archiver'

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

export class TWRPManager {
  async searchDevice(codename) {
    try {
      const res = await axios.get('https://twrp.me/Devices/', { timeout: 10000 })
      const $ = cheerio.load(res.data)
      const results = []
      $('a[href*="/device/"]').each((_, el) => {
        const text = $(el).text().trim()
        const href = $(el).attr('href')
        if (href && (text.toLowerCase().includes(codename.toLowerCase()) || href.includes(codename.toLowerCase()))) {
          results.push({ name: text, url: 'https://twrp.me' + href, codename: href.split('/').filter(Boolean).pop() })
        }
      })
      return results.slice(0, 10)
    } catch { return [] }
  }

  async getDownloadLinks(deviceUrl) {
    try {
      const res = await axios.get(deviceUrl, { timeout: 10000 })
      const $ = cheerio.load(res.data)
      const links = []
      $('a[href*="dl.twrp.me"]').each((_, el) => {
        const href = $(el).attr('href')
        if (href && href.endsWith('.img')) links.push({ url: href, filename: basename(href), type: 'img' })
      })
      return links
    } catch { return [] }
  }

  async download(url, destDir, onProgress) {
    const filename = basename(url)
    const destPath = join(destDir, filename)
    const res = await axios({ url, method: 'GET', responseType: 'stream', timeout: 0 })
    const total = parseInt(res.headers['content-length'] || 0)
    let done = 0
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destPath)
      res.data.on('data', chunk => { done += chunk.length; if (total) onProgress?.({ percent: Math.round(done / total * 100) }) })
      res.data.pipe(writer)
      writer.on('finish', () => resolve({ success: true, path: destPath }))
      writer.on('error', reject)
    })
  }

  async flash(serial, imgPath, permanent, onProgress) {
    onProgress?.({ percent: 10, message: 'Rebooting to bootloader...' })
    await new Promise((res, rej) => { const p = spawn(bin('adb'), ['-s', serial, 'reboot', 'bootloader']); p.on('close', c => c === 0 ? res() : rej()) })
    await new Promise(r => setTimeout(r, 8000))
    onProgress?.({ percent: 40, message: permanent ? 'Flashing TWRP...' : 'Booting TWRP temporarily...' })
    return new Promise((resolve, reject) => {
      const cmd = permanent ? ['flash', 'recovery', imgPath] : ['boot', imgPath]
      const proc = spawn(bin('fastboot'), ['-s', serial, ...cmd])
      let out = ''
      proc.stderr.on('data', d => { out += d.toString(); onProgress?.({ percent: 70, message: d.toString().trim() }) })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async (code) => {
        if (code !== 0) return reject(new Error('Flash failed: ' + out))
        if (permanent) spawn(bin('fastboot'), ['-s', serial, 'reboot', 'recovery'])
        onProgress?.({ percent: 100, message: permanent ? 'TWRP installed!' : 'TWRP booted temporarily!' })
        resolve({ success: true })
      })
    })
  }
}

export class MagiskModuleManager {
  getBuiltinModuleList() {
    return [
      { id: 'LSPosed', name: 'LSPosed Framework', author: 'LSPosed', version: 'v1.9.2', description: 'Xposed-like framework via Zygisk', category: 'Framework', stars: 15000, downloadUrl: 'https://github.com/LSPosed/LSPosed/releases/latest/download/LSPosed-v1.9.2-6765-zygisk-release.zip', repoUrl: 'https://github.com/LSPosed/LSPosed' },
      { id: 'Shamiko', name: 'Shamiko', author: 'LSPosed', version: 'v0.7.4', description: 'Hide Magisk root from apps', category: 'Privacy', stars: 8000, downloadUrl: 'https://github.com/LSPosed/LSPosed.github.io/releases/latest/download/Shamiko-v0.7.4-release.zip', repoUrl: 'https://github.com/LSPosed/LSPosed.github.io' },
      { id: 'ViPER4Android', name: 'ViPER4Android FX', author: 'programminghoch10', version: 'v14.6', description: 'Advanced audio effects & equalizer', category: 'Audio', stars: 4500, downloadUrl: 'https://github.com/programminghoch10/ViPER4AndroidRepackaged/releases/latest/download/ViPER4AndroidFX.zip', repoUrl: 'https://github.com/programminghoch10/ViPER4AndroidRepackaged' },
      { id: 'MagiskHide-Props', name: 'MagiskHide Props Config', author: 'Didgeridoohan', version: 'v6.1.2', description: 'Spoof device props to pass Play Integrity', category: 'Privacy', stars: 6000, downloadUrl: 'https://github.com/Didgeridoohan/MagiskHide-Props-Config/releases/latest/download/MagiskHidePropsConf-v6.1.2.zip', repoUrl: 'https://github.com/Didgeridoohan/MagiskHide-Props-Config' },
      { id: 'SafetyNet-Fix', name: 'Universal SafetyNet Fix', author: 'kdrag0n', version: 'v2.4.0', description: 'Work around SafetyNet/Play Integrity', category: 'Privacy', stars: 7000, downloadUrl: 'https://github.com/kdrag0n/safetynet-fix/releases/latest/download/safetynet-fix-v2.4.0.zip', repoUrl: 'https://github.com/kdrag0n/safetynet-fix' },
      { id: 'Busybox', name: 'Busybox for Android', author: 'meefik', version: 'v1.36.1', description: 'Unix tools for rooted Android', category: 'System', stars: 3000, downloadUrl: 'https://github.com/meefik/busybox/releases/latest/download/busybox-v1.36.1.zip', repoUrl: 'https://github.com/meefik/busybox' },
      { id: 'Font-Manager', name: 'Font Manager', author: 'saitamasahil', version: 'v1.6', description: 'Replace system fonts', category: 'Appearance', stars: 1500, downloadUrl: 'https://github.com/saitamasahil/Font-Manager-with-Magisk/releases/latest/download/FontManager.zip', repoUrl: 'https://github.com/saitamasahil/Font-Manager-with-Magisk' },
      { id: 'Zygisk-Detach', name: 'Zygisk Detach', author: 'j-hc', version: 'v4.6', description: 'Detach apps from Play Store updates', category: 'System', stars: 3000, downloadUrl: 'https://github.com/j-hc/zygisk-detach/releases/latest/download/zygisk-detach.zip', repoUrl: 'https://github.com/j-hc/zygisk-detach' },
      { id: 'Riru', name: 'Riru Core', author: 'RikkaApps', version: 'v26.1.7', description: 'Inject into zygote process', category: 'Framework', stars: 5000, downloadUrl: 'https://github.com/RikkaApps/Riru/releases/latest/download/riru-v26.1.7.zip', repoUrl: 'https://github.com/RikkaApps/Riru' },
      { id: 'KernelSU-Module', name: 'KernelSU Manager', author: 'tiann', version: 'latest', description: 'Kernel-based root for Android', category: 'Root', stars: 12000, downloadUrl: 'https://github.com/tiann/KernelSU/releases/latest', repoUrl: 'https://github.com/tiann/KernelSU' },
    ]
  }

  async downloadAndInstall(serial, module, adb, onProgress) {
    onProgress?.({ percent: 10, message: `Downloading ${module.name}...` })
    const tmpPath = join(app.getPath('temp'), module.id + '.zip')
    const res = await axios({ url: module.downloadUrl, method: 'GET', responseType: 'stream', timeout: 0 })
    const total = parseInt(res.headers['content-length'] || 0)
    let done = 0
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tmpPath)
      res.data.on('data', chunk => { done += chunk.length; if (total) onProgress?.({ percent: 10 + Math.round(done / total * 60) }) })
      res.data.pipe(writer)
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
    onProgress?.({ percent: 75, message: 'Pushing to device...' })
    const remotePath = `/sdcard/Download/${module.id}.zip`
    await adb.push(serial, tmpPath, remotePath)
    onProgress?.({ percent: 90, message: 'Installing module...' })
    await adb.shell(serial, `su -c "magisk --install-module ${remotePath}" 2>/dev/null || true`)
    await fs.remove(tmpPath)
    onProgress?.({ percent: 100, message: 'Installed! Reboot to activate.' })
    return { success: true }
  }

  async getInstalled(serial, adb) {
    try {
      const raw = await adb.shell(serial, 'ls /data/adb/modules/ 2>/dev/null')
      const ids = raw.split('\n').map(l => l.trim()).filter(Boolean)
      const modules = []
      for (const id of ids) {
        try {
          const props = await adb.shell(serial, `cat /data/adb/modules/${id}/module.prop 2>/dev/null`)
          const g = k => props.match(new RegExp(`^${k}=(.+)`, 'm'))?.[1]?.trim() || ''
          const disabled = (await adb.shell(serial, `test -f /data/adb/modules/${id}/disable && echo yes`)).includes('yes')
          modules.push({ id, name: g('name') || id, version: g('version'), author: g('author'), description: g('description'), disabled })
        } catch {}
      }
      return modules
    } catch { return [] }
  }

  async toggle(serial, id, enable, adb) {
    if (enable) await adb.shell(serial, `rm -f /data/adb/modules/${id}/disable`)
    else await adb.shell(serial, `touch /data/adb/modules/${id}/disable`)
    return { success: true }
  }

  async remove(serial, id, adb) {
    await adb.shell(serial, `touch /data/adb/modules/${id}/remove`)
    return { success: true, message: 'Will be removed on next reboot' }
  }
}

export class BootloaderWizard {
  getGuide(brand) {
    const guides = {
      google: { name: 'Google Pixel', supported: true, steps: [{ title: 'Enable OEM Unlock', detail: 'Settings   About Phone   Build Number  7   Developer Options   OEM Unlocking ON', automated: false }, { title: 'Reboot to bootloader', detail: 'Power off, hold Power+Vol Down', automated: true, cmd: 'adb reboot bootloader' }, { title: 'Unlock', detail: 'Wipes all data!', automated: true, cmd: 'fastboot flashing unlock' }, { title: 'Confirm on device', detail: 'Vol keys to select Unlock, Power to confirm', automated: false }], warning: 'Wipes all data permanently.' },
      xiaomi: { name: 'Xiaomi / HyperOS', supported: true, requiresApproval: true, steps: [{ title: 'Apply for unlock permission', detail: 'miui.com/unlock -- sign in, request access (may take days)', automated: false, url: 'https://www.miui.com/unlock/download_en.html' }, { title: 'Enable Mi Unlock in Developer Options', detail: 'Settings   About   MIUI version  7   Developer Options   Mi Unlock status   Add account', automated: false }, { title: 'Reboot to fastboot', automated: true, cmd: 'adb reboot bootloader' }, { title: 'Run Mi Unlock tool', detail: 'Open Mi Unlock app   sign in   Unlock', automated: false, url: 'https://miuirom.org/miui/miflash-unlock' }], warning: 'Requires Mi Account. Some devices have 30-day waiting period.' },
      oneplus: { name: 'OnePlus', supported: true, steps: [{ title: 'Enable OEM Unlock', detail: 'Settings   About   Software Info   Build Number  7   Developer Options   OEM Unlocking', automated: false }, { title: 'Reboot to bootloader', automated: true, cmd: 'adb reboot bootloader' }, { title: 'Unlock', automated: true, cmd: 'fastboot oem unlock' }], warning: 'Wipes all data.' },
      motorola: { name: 'Motorola', supported: true, requiresCode: true, steps: [{ title: 'Get unlock code from Motorola', detail: 'Enter device IMEI on Motorola portal', automated: false, url: 'https://motorola-global-portal.custhelp.com/app/standalone/bootloader/unlock-your-device-a' }, { title: 'Enable OEM Unlock', automated: false }, { title: 'Reboot to bootloader', automated: true, cmd: 'adb reboot bootloader' }, { title: 'Unlock with code', automated: false, cmd: 'fastboot oem unlock [YOUR_CODE]' }], warning: 'Requires unique code from Motorola portal.' },
      samsung: { name: 'Samsung', supported: false, notes: 'Samsung bootloader unlock permanently trips Knox counter -- voids warranty and disables Samsung Pay, Samsung Health, Knox forever even if re-locked. US unlocked models only.' },
      sony: { name: 'Sony Xperia', supported: true, steps: [{ title: 'Check eligibility & get code', automated: false, url: 'https://developer.sony.com/develop/open-devices/get-started/unlock-bootloader/' }, { title: 'Power off, hold Vol Up and connect USB', automated: false }, { title: 'Unlock with code', automated: false, cmd: 'fastboot oem unlock 0x[CODE]' }] },
      nothing: { name: 'Nothing Phone', supported: true, steps: [{ title: 'Enable OEM Unlock', automated: false }, { title: 'Reboot to bootloader', automated: true, cmd: 'adb reboot bootloader' }, { title: 'Unlock', automated: true, cmd: 'fastboot flashing unlock' }], warning: 'Wipes data. No Knox counter.' },
      fairphone: { name: 'Fairphone', supported: true, steps: [{ title: 'Enable OEM Unlock', automated: false }, { title: 'Reboot to bootloader', automated: true, cmd: 'adb reboot bootloader' }, { title: 'Unlock', automated: true, cmd: 'fastboot flashing unlock' }], warning: 'Officially supported by Fairphone.' },
    }
    return guides[brand?.toLowerCase()] || { name: brand || 'Unknown', supported: false, notes: 'Brand not in database. Check XDA Developers for device-specific guide.' }
  }

  async executeCmd(serial, cmd, adb) {
    if (cmd.startsWith('adb reboot')) return adb.reboot(serial, cmd.split(' ')[2] || '')
    if (cmd.startsWith('fastboot')) {
      const parts = cmd.split(' ').slice(1)
      return new Promise((resolve, reject) => {
        const proc = spawn(bin('fastboot'), ['-s', serial, ...parts])
        let out = ''
        proc.stdout.on('data', d => out += d)
        proc.stderr.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true, output: out }) : reject(new Error(out)))
      })
    }
  }
}

export class KernelFlasher {
  async getCurrentInfo(serial, adb) {
    const [version, model, cpu, abi] = await Promise.all([
      adb.shell(serial, 'uname -r').catch(() => ''),
      adb.shell(serial, 'getprop ro.product.model').catch(() => ''),
      adb.shell(serial, 'getprop ro.board.platform').catch(() => ''),
      adb.shell(serial, 'getprop ro.product.cpu.abi').catch(() => ''),
    ])
    return { version: version.trim(), model: model.trim(), cpu: cpu.trim(), abi: abi.trim() }
  }

  getSources() {
    return [
      { name: 'Franco Kernel', url: 'https://franco-lnx.net/', desc: 'Popular custom kernel for multiple devices', supports: ['Pixel', 'OnePlus', 'Xiaomi'] },
      { name: 'ElementalX', url: 'https://elementalx.org/', desc: 'Performance and battery kernels', supports: ['Pixel', 'OnePlus'] },
      { name: 'Sultan Kernel', url: 'https://github.com/kerneltoast', desc: 'Pixel kernels with optimisations', supports: ['Pixel'] },
      { name: 'KernelSU', url: 'https://github.com/tiann/KernelSU', desc: 'Kernel-based root solution', supports: ['Universal'] },
      { name: 'XDA Kernel Forum', url: 'https://forum.xda-developers.com/c/android-software-and-hacking.27/', desc: 'Device-specific kernel threads', supports: ['All'] },
    ]
  }

  async flash(serial, imgPath, method, adb, onProgress) {
    onProgress?.({ percent: 5, message: 'Preparing...' })
    if (method === 'fastboot') {
      await adb.reboot(serial, 'bootloader')
      await new Promise(r => setTimeout(r, 8000))
      onProgress?.({ percent: 30, message: 'Flashing boot.img...' })
      return new Promise((resolve, reject) => {
        const proc = spawn(bin('fastboot'), ['-s', serial, 'flash', 'boot', imgPath])
        proc.stderr.on('data', d => onProgress?.({ percent: 60, message: d.toString().trim() }))

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => {
          if (code !== 0) return reject(new Error('Flash failed'))
          spawn(bin('fastboot'), ['-s', serial, 'reboot'])
          resolve({ success: true })
        })
      })
    }
    if (method === 'sideload') {
      await adb.reboot(serial, 'recovery')
      await new Promise(r => setTimeout(r, 8000))
      return new Promise((resolve, reject) => {
        const proc = spawn(bin('adb'), ['-s', serial, 'sideload', imgPath])
        proc.stdout.on('data', d => { const m = d.toString().match(/(\d+)%/); if (m) onProgress?.({ percent: parseInt(m[1]) }) })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error('Sideload failed')))
      })
    }
  }
}

export class OTAInterceptor {
  async captureFromDevice(serial, adb) {
    const paths = ['/data/ota_package', '/cache', '/sdcard']
    const found = []
    for (const p of paths) {
      try {
        const files = await adb.shell(serial, `find ${p} -name "*.zip" -size +10M 2>/dev/null`)
        found.push(...files.split('\n').filter(f => f.trim()))
      } catch {}
    }
    return found
  }

  async getGoogleOtas(device) {
    try {
      const res = await axios.get('https://developers.google.com/android/ota', { timeout: 10000 })
      const $ = cheerio.load(res.data)
      const results = []
      $('tr').each((_, row) => {
        const cells = $(row).find('td')
        if (cells.length >= 2) {
          const link = $(cells[0]).find('a').attr('href')
          const text = $(cells[0]).text().trim()
          if (link && device && text.toLowerCase().includes(device.toLowerCase())) {
            results.push({ url: link, description: text, checksum: $(cells[1]).text().trim() })
          }
        }
      })
      return results
    } catch { return [] }
  }

  async download(url, destDir, onProgress) {
    const filename = url.split('/').pop().split('?')[0] || 'ota.zip'
    const destPath = join(destDir, filename)
    const res = await axios({ url, method: 'GET', responseType: 'stream', timeout: 0 })
    const total = parseInt(res.headers['content-length'] || 0)
    let done = 0
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destPath)
      res.data.on('data', c => { done += c.length; if (total) onProgress?.({ percent: Math.round(done / total * 100), downloaded: done, total }) })
      res.data.pipe(writer)
      writer.on('finish', () => resolve({ success: true, path: destPath }))
      writer.on('error', reject)
    })
  }
}

export class ROMCompatChecker {
  async check(romPath, deviceInfo) {
    const StreamZip = (await import('node-stream-zip')).default
    const zip = new StreamZip.async({ file: romPath })
    const entries = await zip.entries()
    const files = Object.keys(entries)
    const report = { compatible: true, warnings: [], errors: [], info: {} }
    if (!files.some(f => f.startsWith('META-INF'))) { report.errors.push('No META-INF -- not a flashable ZIP'); report.compatible = false }
    report.info.hasSystem = files.some(f => f.startsWith('system/') || f.includes('system.img'))
    report.info.hasVendor = files.some(f => f.startsWith('vendor/') || f.includes('vendor.img'))
    report.info.hasBoot = files.some(f => f.includes('boot.img'))
    report.info.isPayloadBased = files.some(f => f === 'payload.bin')
    report.info.entryCount = files.length
    report.info.sizeGB = (Object.values(entries).reduce((s, e) => s + e.compressedSize, 0) / 1024 / 1024 / 1024).toFixed(2)
    const updaterEntry = files.find(f => f.includes('updater-script'))
    if (updaterEntry) {
      const script = (await zip.entryData(updaterEntry)).toString()
      if (deviceInfo?.device && script.includes('getprop') && !script.includes(deviceInfo.device)) {
        report.warnings.push(`Script may check for device "${deviceInfo.device}" -- verify compatibility`)
      }
      report.info.scriptPreview = script.slice(0, 300)
    }
    await zip.close()
    return report
  }
}

export class ScrcpyManager {
  async isAvailable() { return fs.pathExists(bin('scrcpy')) }
  getPresets() {
    return [
      { name: 'Default', options: {}, desc: 'Balanced quality' },
      { name: 'Low bandwidth', options: { maxSize: 800, bitrate: 2, fps: 30 }, desc: 'USB2 / slow connection' },
      { name: 'High quality', options: { maxSize: 1920, bitrate: 16, fps: 60 }, desc: 'USB3 / fast connection' },
      { name: 'Record only', options: { noDisplay: true, record: true }, desc: 'Background recording, no window' },
      { name: 'Game mode', options: { maxSize: 1280, bitrate: 8, fps: 60, stayAwake: true }, desc: 'Optimised for gaming' },
      { name: 'Presentation', options: { borderless: true, alwaysOnTop: true, maxSize: 1080 }, desc: 'Borderless overlay' },
    ]
  }

  start(serial, options = {}) {
    const args = ['-s', serial]
    if (options.maxSize) args.push('--max-size', String(options.maxSize))
    if (options.bitrate) args.push('--video-bit-rate', options.bitrate + 'M')
    if (options.fps) args.push('--max-fps', String(options.fps))
    if (options.record && options.recordPath) args.push('--record', options.recordPath)
    if (options.noDisplay) args.push('--no-display')
    if (options.stayAwake) args.push('--stay-awake')
    if (options.borderless) args.push('--window-borderless')
    if (options.alwaysOnTop) args.push('--always-on-top')
    if (options.noAudio) args.push('--no-audio')
    const proc = spawn(bin('scrcpy'), args, { detached: true, stdio: 'ignore' })
    proc.unref()
    return { pid: proc.pid, args }
  }
}

export class ForensicsExport {
  async exportFull(serial, adb, destDir, onProgress) {
    await fs.ensureDir(destDir)
    const report = { deviceInfo: {}, extractedAt: new Date().toISOString(), sections: {} }
    const steps = [
      ['Device info', async () => { report.deviceInfo = await adb.getDeviceInfo(serial) }],
      ['Call log', async () => { report.sections.callLog = await this.exportCallLog(serial, adb, destDir) }],
      ['SMS', async () => { report.sections.sms = await this.exportSMS(serial, adb, destDir) }],
      ['Contacts', async () => { report.sections.contacts = await this.exportContacts(serial, adb, destDir) }],
      ['Browser history', async () => { report.sections.browser = await this.exportBrowserHistory(serial, adb, destDir) }],
      ['Installed apps', async () => { report.sections.apps = await adb.listApps(serial) }],
      ['Accounts', async () => { report.sections.accounts = await this.exportAccounts(serial, adb) }],
      ['Wi-Fi history', async () => { report.sections.wifi = await this.exportWifi(serial, adb) }],
      ['Generate report', async () => { await this.generateReport(report, destDir) }],
    ]
    for (let i = 0; i < steps.length; i++) {
      onProgress?.({ percent: Math.round(i / steps.length * 90), message: steps[i][0] + '...' })
      try { await steps[i][1]() } catch (e) { console.warn(steps[i][0] + ' failed:', e.message) }
    }
    onProgress?.({ percent: 95, message: 'Creating archive...' })
    const zipPath = join(destDir, '..', `forensics_${Date.now()}.zip`)
    await new Promise((res, rej) => {
      const out = fs.createWriteStream(zipPath)
      const arc = archiver('zip', { zlib: { level: 6 } })
      out.on('close', res); arc.on('error', rej)
      arc.pipe(out); arc.directory(destDir, 'forensics'); arc.finalize()
    })
    onProgress?.({ percent: 100, message: 'Complete!' })
    return { success: true, destDir, zipPath }
  }

  async exportCallLog(serial, adb, dir) {
    const raw = await adb.shell(serial, `content query --uri content://call_log/calls/ --projection number:date:duration:type:name 2>/dev/null | head -5000`)
    const rows = raw.split('\n').filter(l => l.includes('number=')).map(l => ({ number: l.match(/number=([^,\n]+)/)?.[1]?.trim() || '', name: l.match(/name=([^,\n]+)/)?.[1]?.trim() || '', date: new Date(parseInt(l.match(/date=(\d+)/)?.[1] || 0)).toISOString(), duration: l.match(/duration=(\d+)/)?.[1] || '0', type: { '1': 'In', '2': 'Out', '3': 'Missed' }[l.match(/type=(\d+)/)?.[1]] || '?' }))
    const csv = ['Number,Name,Date,Duration,Type', ...rows.map(r => `"${r.number}","${r.name}","${r.date}","${r.duration}","${r.type}"`)].join('\n')
    await fs.writeFile(join(dir, 'call_log.csv'), csv)
    return { count: rows.length }
  }

  async exportSMS(serial, adb, dir) {
    const raw = await adb.shell(serial, `content query --uri content://sms/ --projection address:body:date:type 2>/dev/null | head -10000`)
    const rows = raw.split('\n').filter(l => l.includes('address=')).map(l => ({ address: l.match(/address=([^,\n]+)/)?.[1]?.trim() || '', body: l.match(/body=([^,\n]+)/)?.[1]?.trim() || '', date: new Date(parseInt(l.match(/date=(\d+)/)?.[1] || 0)).toISOString(), type: l.match(/type=(\d+)/)?.[1] === '1' ? 'Received' : 'Sent' }))
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SMS</title><style>body{font-family:sans-serif;max-width:800px;margin:2rem auto}.msg{display:flex;margin:6px 0}.recv .b{background:#f0f0f0;margin-right:auto}.sent .b{background:#0084ff;color:#fff;margin-left:auto}.b{padding:8px 14px;border-radius:18px;max-width:70%;word-break:break-word}.t{font-size:10px;opacity:0.6;display:block}</style></head><body><h1>SMS Export (${rows.length} messages)</h1>${rows.map(r => `<div class="msg ${r.type==='Received'?'recv':'sent'}"><div class="b">${r.body.replace(/</g,'&lt;')}<span class="t">${r.address}   ${r.date}</span></div></div>`).join('')}</body></html>`
    await fs.writeFile(join(dir, 'sms.html'), html)
    await fs.writeJSON(join(dir, 'sms.json'), rows)
    return { count: rows.length }
  }

  async exportContacts(serial, adb, dir) {
    const raw = await adb.shell(serial, `content query --uri content://contacts/phones/ --projection display_name:number 2>/dev/null | head -2000`)
    const contacts = raw.split('\n').filter(l => l.includes('display_name=')).map(l => ({ name: l.match(/display_name=([^,\n]+)/)?.[1]?.trim() || '', number: l.match(/number=([^,\n]+)/)?.[1]?.trim() || '' }))
    await fs.writeFile(join(dir, 'contacts.vcf'), contacts.map(c => `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\nTEL:${c.number}\nEND:VCARD`).join('\n\n'))
    await fs.writeJSON(join(dir, 'contacts.json'), contacts)
    return { count: contacts.length }
  }

  async exportBrowserHistory(serial, adb, dir) {
    const raw = await adb.shell(serial, `content query --uri content://browser/bookmarks --projection title:url:visits 2>/dev/null | head -1000`)
    const history = raw.split('\n').filter(l => l.includes('url=')).map(l => ({ title: l.match(/title=([^,\n]+)/)?.[1]?.trim() || '', url: l.match(/url=([^,\n]+)/)?.[1]?.trim() || '', visits: l.match(/visits=(\d+)/)?.[1] || '0' }))
    await fs.writeJSON(join(dir, 'browser_history.json'), history)
    return { count: history.length }
  }

  async exportAccounts(serial, adb) {
    const raw = await adb.shell(serial, 'dumpsys account 2>/dev/null | grep "Account {" | head -50')
    return raw.split('\n').filter(Boolean)
  }

  async exportWifi(serial, adb) {
    const raw = await adb.shell(serial, 'dumpsys wifi | grep SSID 2>/dev/null | head -30')
    return raw.split('\n').filter(Boolean)
  }

  async generateReport(report, dir) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Omerta Forensics Report</title><style>body{font-family:system-ui;max-width:1000px;margin:2rem auto;color:#333}h1{border-bottom:3px solid #f59e0b;padding-bottom:1rem}h2{margin-top:2rem;color:#2d3748}.card{background:#f8f8f8;border:1px solid #e2e8f0;border-radius:8px;padding:1rem;margin:1rem 0}table{width:100%;border-collapse:collapse}th{background:#2d3748;color:#fff;padding:8px}td{padding:6px 8px;border:1px solid #e2e8f0}tr:nth-child(even){background:#f7fafc}</style></head><body>
<h1>Forensics Report</h1><div class="card"><b>Device:</b> ${report.deviceInfo?.brand||''} ${report.deviceInfo?.model||'?'} &nbsp; <b>Android:</b> ${report.deviceInfo?.android||'?'} &nbsp; <b>Extracted:</b> ${report.extractedAt}</div>
<h2>Summary</h2><table><tr><th>Section</th><th>Count</th></tr>
${Object.entries(report.sections).map(([k,v]) => `<tr><td>${k}</td><td>${v?.count || (Array.isArray(v) ? v.length : '--')}</td></tr>`).join('')}
</table>
<h2>Installed Apps (${(report.sections.apps||[]).length})</h2><table><tr><th>Package</th><th>System</th></tr>${(report.sections.apps||[]).slice(0,150).map(a=>`<tr><td>${a.pkg}</td><td>${a.isSystem?'Yes':'No'}</td></tr>`).join('')}</table>
<p style="color:#999;font-size:12px;margin-top:3rem">Generated by Omerta</p></body></html>`
    await fs.writeFile(join(dir, 'report.html'), html)
    await fs.writeJSON(join(dir, 'forensics_full.json'), report, { spaces: 2 })
  }
}

export class TransferWizard {
  getTypes() {
    return [
      { id: 'photos', label: 'Photos & Videos', icon: ' ' },
      { id: 'contacts', label: 'Contacts', icon: ' ' },
      { id: 'sms', label: 'SMS', icon: ' ', androidOnly: true },
      { id: 'whatsapp', label: 'WhatsApp', icon: ' ' },
      { id: 'music', label: 'Music', icon: ' ' },
      { id: 'documents', label: 'Documents', icon: ' ' },
      { id: 'apps', label: 'App APKs', icon: ' ', androidOnly: true },
    ]
  }

  async exportFrom(serial, type, adb, tempDir, onProgress) {
    await fs.ensureDir(tempDir)
    onProgress?.({ percent: 20, message: `Exporting ${type}...` })
    const pull = async (remote, local) => { await fs.ensureDir(local); return new Promise(res => { const p = spawn(bin('adb'), ['-s', serial, 'pull', remote, local]); p.on('close', () => res()) }) }
    if (type === 'photos') { await pull('/sdcard/DCIM', join(tempDir, 'DCIM')); await pull('/sdcard/Pictures', join(tempDir, 'Pictures')) }
    else if (type === 'contacts') { const raw = await adb.shell(serial, `content query --uri content://contacts/phones/ 2>/dev/null`); await fs.writeFile(join(tempDir, 'contacts.vcf'), raw.split('\n').filter(l=>l.includes('display_name=')).map(l=>`BEGIN:VCARD\nVERSION:3.0\nFN:${l.match(/display_name=([^,\n]+)/)?.[1]?.trim()||''}\nTEL:${l.match(/number=([^,\n]+)/)?.[1]?.trim()||''}\nEND:VCARD`).join('\n\n')) }
    else if (type === 'whatsapp') await pull('/sdcard/Android/media/com.whatsapp', join(tempDir, 'WhatsApp'))
    else if (type === 'music') await pull('/sdcard/Music', join(tempDir, 'Music'))
    else if (type === 'documents') { await pull('/sdcard/Documents', join(tempDir, 'Documents')); await pull('/sdcard/Download', join(tempDir, 'Downloads')) }
    onProgress?.({ percent: 100, message: 'Exported' })
    return { success: true, tempDir }
  }

  async importTo(serial, type, tempDir, adb, onProgress) {
    onProgress?.({ percent: 20, message: `Importing ${type}...` })
    const push = async (local, remote) => { if (await fs.pathExists(local)) return new Promise(res => { const p = spawn(bin('adb'), ['-s', serial, 'push', local, remote]); p.on('close', () => res()) }) }
    if (type === 'photos') await push(join(tempDir, 'DCIM'), '/sdcard/DCIM/')
    else if (type === 'contacts') { const vcf = join(tempDir, 'contacts.vcf'); if (await fs.pathExists(vcf)) { await adb.push(serial, vcf, '/sdcard/contacts_import.vcf') } }
    else if (type === 'whatsapp') await push(join(tempDir, 'WhatsApp'), '/sdcard/Android/media/com.whatsapp')
    else if (type === 'music') await push(join(tempDir, 'Music'), '/sdcard/Music/')
    else if (type === 'documents') await push(join(tempDir, 'Documents'), '/sdcard/Documents/')
    await adb.shell(serial, 'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE 2>/dev/null || true')
    onProgress?.({ percent: 100, message: 'Imported' })
    return { success: true }
  }
}

export class RepairMode {
  async enable(serial, adb) {
    try {
      const brand = await adb.shell(serial, 'getprop ro.product.brand')
      if (brand.toLowerCase().includes('samsung')) {
        await adb.shell(serial, 'am start -n com.samsung.android.repairmode/.RepairModeActivity 2>/dev/null')
        return { success: true, method: 'samsung', message: 'Samsung Repair Mode launched.' }
      }
    } catch {}
    try {
      await adb.shell(serial, 'pm create-user --restricted "Repair" 2>/dev/null')
      const users = await adb.shell(serial, 'pm list users')
      const uid = users.match(/\{(\d+):\s*Repair/)?.[1]
      if (uid) { await adb.shell(serial, `am switch-user ${uid}`); return { success: true, method: 'restricted', userId: uid, message: `Switched to restricted user. Main data hidden.` } }
    } catch {}
    return { success: false, message: 'Repair mode not supported. Enable Guest mode manually.' }
  }

  async disable(serial, adb, userId) {
    try { if (userId) { await adb.shell(serial, 'am switch-user 0'); await adb.shell(serial, `pm remove-user ${userId}`) } } catch {}
    return { success: true }
  }
}

export class PermissionScheduler {
  constructor() { this.schedules = new Map() }
  schedule(serial, pkg, permissions, intervalHours, adb) {
    const key = `${serial}:${pkg}`
    if (this.schedules.has(key)) clearInterval(this.schedules.get(key).timer)
    const timer = setInterval(async () => { for (const p of permissions) { try { await adb.shell(serial, `pm revoke ${pkg} ${p}`) } catch {} } }, intervalHours * 3600 * 1000)
    this.schedules.set(key, { timer, pkg, permissions, intervalHours, serial, nextRun: new Date(Date.now() + intervalHours * 3600 * 1000).toISOString() })
    return { success: true, key }
  }
  cancel(key) { const s = this.schedules.get(key); if (s) { clearInterval(s.timer); this.schedules.delete(key) }; return { success: true } }
  list() { return [...this.schedules.entries()].map(([key, s]) => ({ key, pkg: s.pkg, permissions: s.permissions, intervalHours: s.intervalHours, serial: s.serial, nextRun: s.nextRun })) }
}

export class SmsPdfExporter {
  async export(serial, adb, destDir) {
    await fs.ensureDir(destDir)
    const raw = await adb.shell(serial, `content query --uri content://sms/ --projection address:body:date:type --sort "date ASC" 2>/dev/null | head -20000`)
    const rows = raw.split('\n').filter(l => l.includes('address=')).map(l => ({ address: l.match(/address=([^,\n]+)/)?.[1]?.trim() || '', body: l.match(/body=([^,\n]+)/)?.[1]?.trim() || '', date: new Date(parseInt(l.match(/date=(\d+)/)?.[1] || 0)), type: l.match(/type=(\d+)/)?.[1] === '1' ? 'recv' : 'sent' }))
    const threads = {}
    for (const m of rows) { if (!threads[m.address]) threads[m.address] = []; threads[m.address].push(m) }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SMS Export</title><style>*{box-sizing:border-box}body{font-family:system-ui;margin:20px;font-size:13px}.thread{margin-bottom:2rem;page-break-after:always}h2{border-bottom:2px solid #333;padding-bottom:6px}.msg{display:flex;margin:5px 0}.recv .b{background:#f0f0f0;margin-right:auto;border-radius:0 12px 12px 12px}.sent .b{background:#0084ff;color:#fff;margin-left:auto;border-radius:12px 0 12px 12px}.b{padding:7px 12px;max-width:70%;word-break:break-word}.t{font-size:10px;opacity:0.6;display:block;margin-top:3px}@media print{.thread{page-break-after:always}}</style></head><body>
<h1>SMS Export -- ${rows.length} messages   ${Object.keys(threads).length} threads</h1>
${Object.entries(threads).map(([addr, msgs]) => `<div class="thread"><h2>${addr} (${msgs.length})</h2>${msgs.map(m=>`<div class="msg ${m.type}"><div class="b">${m.body.replace(/</g,'&lt;').replace(/>/g,'&gt;')}<span class="t">${m.date.toLocaleString()}</span></div></div>`).join('')}</div>`).join('')}
<p style="color:#999;font-size:11px">Open in browser   Print   Save as PDF</p></body></html>`
    const htmlPath = join(destDir, 'sms_export.html')
    await fs.writeFile(htmlPath, html)
    return { success: true, htmlPath, messageCount: rows.length, threadCount: Object.keys(threads).length }
  }
}
