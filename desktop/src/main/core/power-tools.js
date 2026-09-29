import axios from 'axios'
import * as cheerio from 'cheerio'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { join, basename } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'

const execFileAsync = promisify(execFile)

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

//                                                                 
// TWRP Manager
//                                                                 
export class TWRPManager {
  async searchDevice(codename) {
    try {
      const res = await axios.get(`https://twrp.me/Devices/`, { timeout: 10000 })
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
        const text = $(el).text().trim()
        if (href && href.endsWith('.img')) {
          links.push({ url: href, filename: basename(href), version: text, type: 'img' })
        }
      })
      return links
    } catch { return [] }
  }

  async flashTwrp(serial, imgPath, onProgress) {
    onProgress?.({ percent: 5, message: 'Rebooting to bootloader...' })
    await new Promise((res, rej) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'reboot', 'bootloader'])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res() : rej(new Error('Reboot failed')))
    })
    await new Promise(r => setTimeout(r, 8000))
    onProgress?.({ percent: 30, message: 'Flashing TWRP recovery...' })
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('fastboot'), ['-s', serial, 'flash', 'recovery', imgPath])
      let out = ''
      proc.stdout.on('data', d => { out += d.toString() })
      proc.stderr.on('data', d => {
        out += d.toString()
        onProgress?.({ percent: 60, message: d.toString().trim() })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async (code) => {
        if (code !== 0) return reject(new Error('Flash failed: ' + out))
        onProgress?.({ percent: 90, message: 'Rebooting to recovery...' })
        await execFileAsync(bin('fastboot'), ['-s', serial, 'reboot', 'recovery'])
        onProgress?.({ percent: 100, message: 'TWRP installed! Device rebooting to recovery.' })
        resolve({ success: true })
      })
    })
  }

  async tempBootTwrp(serial, imgPath, onProgress) {
    onProgress?.({ percent: 10, message: 'Rebooting to bootloader...' })
    await execFileAsync(bin('adb'), ['-s', serial, 'reboot', 'bootloader'])
    await new Promise(r => setTimeout(r, 8000))
    onProgress?.({ percent: 50, message: 'Booting TWRP temporarily (not installing)...' })
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('fastboot'), ['-s', serial, 'boot', imgPath])
      let out = ''
      proc.stderr.on('data', d => { out += d.toString() })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error(out)))
    })
  }
}

//                                                                 
// Magisk Module Manager
//                                                                 
export class MagiskModuleManager {
  async getOfficialModules() {
    try {
      const res = await axios.get('https://raw.githubusercontent.com/Magisk-Modules-Alt-Repo/json/main/modules.json', { timeout: 10000 })
      return (res.data?.modules || []).map(m => ({
        id: m.id, name: m.name, version: m.version, author: m.author,
        description: m.description, stars: m.stars || 0,
        downloadUrl: `https://github.com/${m.author}/${m.id}/releases/latest/download/${m.id}.zip`,
        repoUrl: `https://github.com/${m.author}/${m.id}`,
        category: this.categorize(m.name, m.description)
      })).sort((a, b) => (b.stars || 0) - (a.stars || 0))
    } catch { return this.getBuiltinModuleList() }
  }

  getBuiltinModuleList() {
    return [
      { id: 'LSPosed', name: 'LSPosed Framework', author: 'LSPosed', version: 'v1.9.2', description: 'A Riru/Zygisk based module which provides an ART hooking framework', category: 'Framework', stars: 15000, downloadUrl: 'https://github.com/LSPosed/LSPosed/releases/latest/download/LSPosed-v1.9.2-6765-zygisk-release.zip', repoUrl: 'https://github.com/LSPosed/LSPosed' },
      { id: 'Zygisk-Detach', name: 'Zygisk Detach', author: 'j-hc', version: 'v4.6', description: 'Detach installed apps from Play Store', category: 'System', stars: 3000, downloadUrl: 'https://github.com/j-hc/zygisk-detach/releases/latest/download/zygisk-detach.zip', repoUrl: 'https://github.com/j-hc/zygisk-detach' },
      { id: 'ViPER4Android', name: 'ViPER4Android FX', author: 'programminghoch10', version: 'v14.6', description: 'Audio effects and equalizer for Android', category: 'Audio', stars: 4500, downloadUrl: 'https://github.com/programminghoch10/ViPER4AndroidRepackaged/releases/latest/download/ViPER4AndroidFX.zip', repoUrl: 'https://github.com/programminghoch10/ViPER4AndroidRepackaged' },
      { id: 'MagiskHide-Props-Config', name: 'MagiskHide Props Config', author: 'Didgeridoohan', version: 'v6.1.2', description: 'Change your device props to pass SafetyNet/Play Integrity', category: 'Privacy', stars: 6000, downloadUrl: 'https://github.com/Didgeridoohan/MagiskHide-Props-Config/releases/latest/download/MagiskHidePropsConf-v6.1.2.zip', repoUrl: 'https://github.com/Didgeridoohan/MagiskHide-Props-Config' },
      { id: 'Riru-Core', name: 'Riru', author: 'RikkaApps', version: 'v26.1.7', description: 'Inject into zygote process for modules that require it', category: 'Framework', stars: 5000, downloadUrl: 'https://github.com/RikkaApps/Riru/releases/latest/download/riru-v26.1.7.zip', repoUrl: 'https://github.com/RikkaApps/Riru' },
      { id: 'KernelSU', name: 'KernelSU Next', author: 'backslashxx', version: 'v1.0', description: 'Kernel-based root solution for Android', category: 'Root', stars: 2000, downloadUrl: 'https://github.com/backslashxx/KernelSU/releases/latest', repoUrl: 'https://github.com/backslashxx/KernelSU' },
      { id: 'Shamiko', name: 'Shamiko', author: 'LSPosed', version: 'v0.7.4', description: 'A Zygisk module to hide Magisk root', category: 'Privacy', stars: 8000, downloadUrl: 'https://github.com/LSPosed/LSPosed.github.io/releases/latest/download/Shamiko-v0.7.4-release.zip', repoUrl: 'https://github.com/LSPosed/LSPosed.github.io' },
      { id: 'Busybox', name: 'Busybox for Android NDK', author: 'meefik', version: 'v1.36.1', description: 'Busybox binary for Android', category: 'System', stars: 3000, downloadUrl: 'https://github.com/meefik/busybox/releases/latest/download/busybox-v1.36.1.zip', repoUrl: 'https://github.com/meefik/busybox' },
      { id: 'Universal-SafetyNet-Fix', name: 'Universal SafetyNet Fix', author: 'kdrag0n', version: 'v2.4.0', description: 'A Magisk module that works around Google\'s SafetyNet attestation', category: 'Privacy', stars: 7000, downloadUrl: 'https://github.com/kdrag0n/safetynet-fix/releases/latest/download/safetynet-fix-v2.4.0.zip', repoUrl: 'https://github.com/kdrag0n/safetynet-fix' },
      { id: 'Font-Manager', name: 'Font Manager', author: 'saitamasahil', version: 'v1.6', description: 'Replace system fonts with custom fonts', category: 'Appearance', stars: 1500, downloadUrl: 'https://github.com/saitamasahil/Font-Manager-with-Magisk/releases/latest/download/FontManager.zip', repoUrl: 'https://github.com/saitamasahil/Font-Manager-with-Magisk' },
    ]
  }

  categorize(name, desc) {
    const text = (name + ' ' + desc).toLowerCase()
    if (text.includes('audio') || text.includes('sound') || text.includes('equalizer')) return 'Audio'
    if (text.includes('privacy') || text.includes('hide') || text.includes('safetynet')) return 'Privacy'
    if (text.includes('framework') || text.includes('xposed') || text.includes('riru') || text.includes('zygisk')) return 'Framework'
    if (text.includes('battery') || text.includes('power')) return 'Battery'
    if (text.includes('font') || text.includes('theme') || text.includes('icon') || text.includes('appearance')) return 'Appearance'
    if (text.includes('kernel') || text.includes('cpu') || text.includes('performance') || text.includes('governor')) return 'Performance'
    return 'System'
  }

  async downloadAndInstall(serial, module, adb, onProgress) {
    onProgress?.({ percent: 10, message: `Downloading ${module.name}...` })
    const tmpPath = join(app.getPath('temp'), module.id + '.zip')
    const res = await axios({ url: module.downloadUrl, method: 'GET', responseType: 'stream', timeout: 0 })
    const total = parseInt(res.headers['content-length'] || 0)
    let done = 0
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(tmpPath)
      res.data.on('data', chunk => {
        done += chunk.length
        if (total) onProgress?.({ percent: 10 + Math.round(done / total * 60), message: `Downloading...` })
      })
      res.data.pipe(writer)
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
    onProgress?.({ percent: 75, message: 'Pushing to device...' })
    const remotePath = `/sdcard/Download/${module.id}.zip`
    await adb.push(serial, tmpPath, remotePath)
    onProgress?.({ percent: 90, message: 'Installing via Magisk...' })
    await adb.shell(serial, `su -c "magisk --install-module ${remotePath}"`)
    await fs.remove(tmpPath)
    onProgress?.({ percent: 100, message: 'Module installed! Reboot to activate.' })
    return { success: true, message: 'Reboot device to activate module' }
  }

  async getInstalledModules(serial, adb) {
    try {
      const raw = await adb.shell(serial, 'ls /data/adb/modules/ 2>/dev/null')
      const moduleIds = raw.split('\n').map(l => l.trim()).filter(Boolean)
      const modules = []
      for (const id of moduleIds) {
        try {
          const props = await adb.shell(serial, `cat /data/adb/modules/${id}/module.prop 2>/dev/null`)
          const get = (key) => props.match(new RegExp(`^${key}=(.+)`, 'm'))?.[1]?.trim() || ''
          const disabled = await adb.shell(serial, `ls /data/adb/modules/${id}/disable 2>/dev/null`).then(r => r.includes('disable')).catch(() => false)
          modules.push({ id, name: get('name') || id, version: get('version'), author: get('author'), description: get('description'), disabled })
        } catch {}
      }
      return modules
    } catch { return [] }
  }

  async toggleModule(serial, moduleId, enable, adb) {
    if (enable) await adb.shell(serial, `rm -f /data/adb/modules/${moduleId}/disable`)
    else await adb.shell(serial, `touch /data/adb/modules/${moduleId}/disable`)
    return { success: true }
  }

  async removeModule(serial, moduleId, adb) {
    await adb.shell(serial, `touch /data/adb/modules/${moduleId}/remove`)
    return { success: true, message: 'Module will be removed on next reboot' }
  }
}

//                                                                 
// Bootloader Unlock Wizard
//                                                                 
export class BootloaderWizard {
  getGuide(brand) {
    const guides = {
      google: {
        name: 'Google Pixel',
        supported: true,
        steps: [
          { title: 'Enable OEM Unlock', detail: 'Settings   About Phone   tap Build Number 7 times   Developer Options   OEM Unlocking   ON', automated: false },
          { title: 'Reboot to bootloader', detail: 'Power off   hold Power + Volume Down, OR: adb reboot bootloader', automated: true, cmd: 'adb reboot bootloader' },
          { title: 'Unlock bootloader', detail: 'This wipes all data. Run: fastboot flashing unlock', automated: true, cmd: 'fastboot flashing unlock' },
          { title: 'Confirm on device', detail: 'Use Volume keys to select "Unlock the bootloader", press Power', automated: false },
          { title: 'Wait for wipe & reboot', detail: 'Device wipes and reboots. Setup as new device.', automated: false },
        ],
        warning: 'Wipes all data. Cannot be undone without re-locking.',
        officialUrl: 'https://source.android.com/docs/setup/build/running'
      },
      xiaomi: {
        name: 'Xiaomi / MIUI',
        supported: true,
        requiresApproval: true,
        steps: [
          { title: 'Get Mi Unlock permission', detail: 'miui.com/unlock   sign in with Mi account   apply for unlock permission (may take hours to days)', automated: false, url: 'https://www.miui.com/unlock/download_en.html' },
          { title: 'Enable OEM Unlock in developer options', detail: 'Settings   About Phone   MIUI version (7 taps)   Developer Options   Mi Unlock status   Add account and device', automated: false },
          { title: 'Download Mi Unlock tool', detail: 'Download Mi Unlock from Xiaomi official site', automated: false, url: 'https://miuirom.org/miui/miflash-unlock' },
          { title: 'Reboot to fastboot', detail: 'Power off   hold Power + Volume Down', automated: true, cmd: 'adb reboot bootloader' },
          { title: 'Run Mi Unlock', detail: 'Open Mi Unlock   sign in   click Unlock   wait for approval if needed', automated: false },
        ],
        warning: 'Requires Mi account approval. Some devices have waiting period.',
        notes: 'Newer Xiaomi/HyperOS devices may require 30+ days waiting period.'
      },
      oneplus: {
        name: 'OnePlus OxygenOS',
        supported: true,
        steps: [
          { title: 'Enable Developer Options', detail: 'Settings   About   Software Information   Build Number (7 taps)', automated: false },
          { title: 'Enable OEM Unlock', detail: 'Settings   Developer Options   OEM Unlocking   ON', automated: false },
          { title: 'Reboot to bootloader', detail: 'Run: adb reboot bootloader', automated: true, cmd: 'adb reboot bootloader' },
          { title: 'Unlock', detail: 'Run: fastboot oem unlock', automated: true, cmd: 'fastboot oem unlock' },
          { title: 'Or use newer command', detail: 'On newer devices: fastboot flashing unlock', automated: true, cmd: 'fastboot flashing unlock' },
        ],
        warning: 'Wipes all data.'
      },
      motorola: {
        name: 'Motorola',
        supported: true,
        requiresCode: true,
        steps: [
          { title: 'Get bootloader unlock code', detail: 'Go to Motorola unlock portal -- enter device info to get unlock code', automated: false, url: 'https://motorola-global-portal.custhelp.com/app/standalone/bootloader/unlock-your-device-a' },
          { title: 'Enable OEM Unlock', detail: 'Settings   About   Build Number (7 taps)   Developer Options   OEM Unlock', automated: false },
          { title: 'Reboot to bootloader', detail: 'adb reboot bootloader', automated: true, cmd: 'adb reboot bootloader' },
          { title: 'Flash with unlock code', detail: 'fastboot oem unlock UNIQUE_CODE_FROM_PORTAL', automated: false, cmd: 'fastboot oem unlock [YOUR_CODE]' },
        ],
        warning: 'Requires unique unlock code from Motorola. Some devices not supported.'
      },
      samsung: {
        name: 'Samsung',
        supported: false,
        notes: 'Samsung bootloader unlock permanently trips Knox counter (0x1). Voids warranty and disables Samsung Pay, Knox, Samsung Health features -- permanently, even if re-locked. Supported on US unlocked models only.'
      },
      sony: {
        name: 'Sony Xperia',
        supported: true,
        steps: [
          { title: 'Check if unlockable', detail: 'Go to Sony unlock page and enter IMEI -- not all Xperia devices are unlockable', automated: false, url: 'https://developer.sony.com/develop/open-devices/get-started/unlock-bootloader/' },
          { title: 'Get unlock code', detail: 'Sony provides a unique code per IMEI', automated: false },
          { title: 'Enable USB Debugging', detail: 'Settings   About   Build Number (7 taps)   Developer Options   USB Debugging', automated: false },
          { title: 'Reboot to bootloader', detail: 'Power off, hold Volume Up while connecting USB', automated: false },
          { title: 'Unlock with code', detail: 'fastboot oem unlock 0xYOURCODE', automated: false, cmd: 'fastboot oem unlock 0x[CODE]' },
        ],
        warning: 'Wipes data. Some carrier models not supported.'
      },
      fairphone: {
        name: 'Fairphone',
        supported: true,
        steps: [
          { title: 'Enable OEM Unlock', detail: 'Settings   About   Build Number (7 taps)   Developer Options   OEM Unlocking', automated: false },
          { title: 'Reboot to fastboot', detail: 'adb reboot bootloader', automated: true, cmd: 'adb reboot bootloader' },
          { title: 'Unlock', detail: 'fastboot flashing unlock', automated: true, cmd: 'fastboot flashing unlock' },
        ],
        warning: 'Fairphone officially supports this.'
      },
      nothing: {
        name: 'Nothing Phone',
        supported: true,
        steps: [
          { title: 'Enable Developer Options', detail: 'Settings   About Phone   Build Number (7 taps)', automated: false },
          { title: 'Enable OEM Unlock', detail: 'Developer Options   OEM Unlocking   ON', automated: false },
          { title: 'Reboot to fastboot', detail: 'adb reboot bootloader', automated: true, cmd: 'adb reboot bootloader' },
          { title: 'Unlock', detail: 'fastboot flashing unlock', automated: true, cmd: 'fastboot flashing unlock' },
        ],
        warning: 'Wipes data. Knox-style warning counter is NOT set.'
      }
    }
    return guides[brand?.toLowerCase()] || { name: brand, supported: false, notes: 'This brand is not in our database. Check XDA Developers for device-specific instructions.' }
  }

  async executeStep(serial, cmd, adb) {
    if (cmd.startsWith('adb ')) {
      const parts = cmd.replace('adb ', '').split(' ')
      if (parts[0] === 'reboot') return adb.reboot(serial, parts[1] || '')
    }
    if (cmd.startsWith('fastboot ')) {
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

//                                                                 
// Kernel Flasher
//                                                                 
export class KernelFlasher {
  async getKernelSources(device, androidVersion) {
    const sources = []
    try {
      const res = await axios.get(`https://api.github.com/search/repositories?q=${encodeURIComponent(device + ' kernel android')}&sort=stars&per_page=10`, { timeout: 10000, headers: { 'Accept': 'application/vnd.github.v3+json' } })
      for (const repo of (res.data?.items || []).slice(0, 5)) {
        sources.push({ name: repo.full_name, stars: repo.stargazers_count, description: repo.description, url: repo.html_url, releasesUrl: repo.html_url + '/releases', type: 'github' })
      }
    } catch {}
    sources.push({ name: 'Franco Kernel (universal)', url: 'https://forum.xda-developers.com/t/kernel-franco-kernel-r20121205-exynos-and-qcom.1999595/', type: 'xda' })
    sources.push({ name: 'ElementalX', url: 'https://elementalx.org/', type: 'website' })
    return sources
  }

  async getCurrentKernel(serial, adb) {
    const [version, model, cpu] = await Promise.all([
      adb.shell(serial, 'uname -r'),
      adb.shell(serial, 'getprop ro.product.model'),
      adb.shell(serial, 'getprop ro.board.platform')
    ])
    return { version: version.trim(), model: model.trim(), cpu: cpu.trim() }
  }

  async flashKernel(serial, imgPath, method, adb, onProgress) {
    if (method === 'adb-sideload') {
      onProgress?.({ percent: 10, message: 'Rebooting to recovery...' })
      await adb.reboot(serial, 'recovery')
      await new Promise(r => setTimeout(r, 8000))
      onProgress?.({ percent: 30, message: 'Sideloading kernel zip...' })
      return new Promise((resolve, reject) => {
        const proc = spawn(bin('adb'), ['-s', serial, 'sideload', imgPath])
        proc.stdout.on('data', d => { const m = d.toString().match(/(\d+)%/); if (m) onProgress?.({ percent: 30 + parseInt(m[1]) * 0.6, message: `Flashing: ${m[1]}%` }) })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error('Sideload failed')))
      })
    }
    if (method === 'fastboot') {
      onProgress?.({ percent: 10, message: 'Rebooting to bootloader...' })
      await adb.reboot(serial, 'bootloader')
      await new Promise(r => setTimeout(r, 8000))
      onProgress?.({ percent: 30, message: 'Flashing boot.img...' })
      return new Promise((resolve, reject) => {
        const proc = spawn(bin('fastboot'), ['-s', serial, 'flash', 'boot', imgPath])
        proc.stderr.on('data', d => onProgress?.({ percent: 60, message: d.toString().trim() }))

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => {
          if (code !== 0) return reject(new Error('Fastboot flash failed'))
          spawn(bin('fastboot'), ['-s', serial, 'reboot'])
          resolve({ success: true })
        })
      })
    }
  }
}

//                                                                 
// OTA Interceptor
//                                                                 
export class OTAInterceptor {
  async checkForOTA(serial, adb) {
    try {
      const build = await adb.shell(serial, 'getprop ro.build.fingerprint')
      const device = await adb.shell(serial, 'getprop ro.product.device')
      const brand = await adb.shell(serial, 'getprop ro.product.brand')
      return { build: build.trim(), device: device.trim(), brand: brand.trim() }
    } catch { return null }
  }

  async getGoogleOtaUrl(device, buildId) {
    try {
      const res = await axios.get(`https://developers.google.com/android/ota`, { timeout: 10000 })
      const $ = cheerio.load(res.data)
      const links = []
      $('a[href*="storage.googleapis.com"]').each((_, el) => {
        const href = $(el).attr('href')
        const text = $(el).closest('tr').find('td').first().text()
        if (href && (text.toLowerCase().includes(device.toLowerCase()))) {
          links.push({ url: href, description: text.trim() })
        }
      })
      return links
    } catch { return [] }
  }

  async downloadOta(url, destDir, onProgress) {
    const filename = basename(url.split('?')[0]) || 'ota.zip'
    const destPath = join(destDir, filename)
    const res = await axios({ url, method: 'GET', responseType: 'stream', timeout: 0 })
    const total = parseInt(res.headers['content-length'] || 0)
    let done = 0
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destPath)
      res.data.on('data', chunk => { done += chunk.length; if (total) onProgress?.({ percent: Math.round(done / total * 100), downloaded: done, total }) })
      res.data.pipe(writer)
      writer.on('finish', () => resolve({ success: true, path: destPath }))
      writer.on('error', reject)
    })
  }

  async captureOtaFromDevice(serial, adb) {
    try {
      const otaFiles = await adb.shell(serial, 'find /data/ota_package /cache -name "*.zip" 2>/dev/null')
      return otaFiles.split('\n').filter(f => f.trim() && f.includes('.zip'))
    } catch { return [] }
  }
}

//                                                                 
// ROM Compatibility Checker
//                                                                 
export class ROMCompatChecker {
  async check(romZipPath, deviceInfo) {
    const StreamZip = (await import('node-stream-zip')).default
    const zip = new StreamZip.async({ file: romZipPath })
    const entries = await zip.entries()
    const report = { compatible: true, warnings: [], errors: [], info: {} }

    const fileList = Object.keys(entries)

    // Check META-INF
    if (!fileList.some(f => f.startsWith('META-INF'))) {
      report.errors.push('No META-INF directory -- not a flashable ZIP')
      report.compatible = false
    }

    // Check updater-script for device codename
    const updaterScriptEntry = fileList.find(f => f.includes('updater-script'))
    if (updaterScriptEntry) {
      const data = await zip.entryData(updaterScriptEntry)
      const script = data.toString()
      report.info.updaterScript = script.slice(0, 500)
      if (deviceInfo?.device && !script.includes(deviceInfo.device) && script.includes('getprop("ro.product.device")')) {
        report.warnings.push(`Script checks for device name but "${deviceInfo.device}" not found. May fail device check.`)
      }
      if (script.includes('assert') && deviceInfo?.device) {
        const assertedDevices = script.match(/"([a-zA-Z0-9_]+)"/g)?.map(d => d.replace(/"/g, ''))
        if (assertedDevices?.length) report.info.assertedDevices = assertedDevices
      }
    }

    // Check for treble support
    if (fileList.some(f => f.includes('system.img') || f.startsWith('system/'))) {
      report.info.hasSystem = true
    }
    if (fileList.some(f => f.includes('vendor.img') || f.startsWith('vendor/'))) {
      report.info.hasVendor = true
      if (deviceInfo?.treble === false) report.warnings.push('ROM has separate vendor partition but device may not support Project Treble')
    }

    // Check architecture
    const archFiles = fileList.filter(f => f.includes('arm64') || f.includes('x86_64') || f.includes('armeabi'))
    if (archFiles.length) {
      report.info.architectures = [...new Set(archFiles.map(f => f.includes('arm64') ? 'arm64-v8a' : f.includes('x86_64') ? 'x86_64' : 'armeabi-v7a'))]
      if (deviceInfo?.abi && !report.info.architectures.includes(deviceInfo.abi)) {
        report.warnings.push(`ROM contains ${report.info.architectures.join(', ')} libs but device uses ${deviceInfo.abi}`)
      }
    }

    // Estimate size
    report.info.compressedSize = (Object.values(entries).reduce((s, e) => s + e.compressedSize, 0) / 1024 / 1024 / 1024).toFixed(2) + ' GB'

    await zip.close()
    return report
  }
}
