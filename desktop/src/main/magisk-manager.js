import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import axios from 'axios'

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

function adb(...args) {
  return new Promise(async (resolve, reject) => {
    const proc = spawn(bin('adb'), args)
    let out = '', err = ''
    proc.stdout.on('data', d => out += d)
    proc.stderr.on('data', d => err += d)
    proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err || out)))
  })
}

const CURATED_MODULES = [
  { id: 'zygisk-lsposed', name: 'LSPosed (Zygisk)', author: 'LSPosed', version: 'latest', description: 'Xposed framework for Android 8.1+. Hook into any app.', githubRepo: 'LSPosed/LSPosed', assetPattern: 'release.zip', category: 'Framework' },
  { id: 'shamiko', name: 'Shamiko', author: 'LSPosed', version: 'latest', description: 'Hide Magisk from apps using Play Integrity/SafetyNet checks.', githubRepo: 'LSPosed/shamiko', assetPattern: '.zip', category: 'Root Hide' },
  { id: 'magiskhide-props', name: 'MagiskHide Props', author: 'Didgeridoohan', version: '6.1.2', description: 'Spoof device fingerprint to pass SafetyNet.', downloadUrl: 'https://github.com/Magisk-Modules-Alt-Repo/MagiskHide-Props-Config/releases/latest/download/MagiskHide-Props-Config.zip', category: 'Root Hide' },
  { id: 'busybox-ndk', name: 'Busybox NDK', author: 'osm0sis', version: '1.36.1', description: '~300 Unix utilities for Android.', downloadUrl: 'https://github.com/Magisk-Modules-Alt-Repo/busybox-ndk/releases/latest/download/busybox-ndk.zip', category: 'Utilities' },
  { id: 'font-manager', name: 'Font Manager', author: 'Skittles9823', version: '3.2', description: 'System-wide font replacement without ROM flash.', downloadUrl: 'https://github.com/Magisk-Modules-Alt-Repo/FontManager/releases/latest/download/FontManager.zip', category: 'Customisation' },
  { id: 'zram-writeback', name: 'ZRAM Writeback', author: 'olegos2', version: '2.0', description: 'Reduces memory pressure on low-RAM devices.', downloadUrl: 'https://github.com/Magisk-Modules-Alt-Repo/zram-writeback/releases/latest/download/zram-writeback.zip', category: 'Performance' },
  { id: 'systemless-hosts', name: 'Systemless Hosts', author: 'Magisk Team', version: 'builtin', description: 'Enables /etc/hosts for AdAway and DNS-level blocking.', downloadUrl: null, category: 'Network' },
  { id: 'open-fonts', name: 'Open Fonts', author: 'Community', version: '3.1', description: 'Replaces system fonts with Roboto, Inter, JetBrains Mono, etc.', downloadUrl: 'https://github.com/Magisk-Modules-Alt-Repo/open_fonts/releases/latest/download/open_fonts.zip', category: 'Customisation' },
  { id: 'audio-misc', name: 'Audio Misc Settings', author: 'Community', version: '2.4', description: 'Enable USB audio, spatial audio tweaks, fix outputs.', downloadUrl: 'https://github.com/Magisk-Modules-Alt-Repo/audio-misc-settings/releases/latest/download/audio-misc-settings.zip', category: 'Audio' },
  { id: 'kernelsu', name: 'KernelSU', author: 'tiann', version: '0.9.5', description: 'Kernel-based root -- no boot image patching required.', downloadUrl: 'https://github.com/tiann/KernelSU/releases/latest', category: 'Root' },
]

export class MagiskManager {
  async checkStatus(serial) {
    try {
      const [appOut, daemonOut, suOut, verOut] = await Promise.all([
        adb('-s', serial, 'shell', 'pm list packages 2>/dev/null | grep magisk').catch(() => ''),
        adb('-s', serial, 'shell', 'pgrep -x magiskd 2>/dev/null').catch(() => ''),
        adb('-s', serial, 'shell', 'which su 2>/dev/null').catch(() => ''),
        adb('-s', serial, 'shell', 'magisk --version 2>/dev/null').catch(() => ''),
      ])
      const installed = appOut.includes('magisk') || !!daemonOut.trim() || !!suOut.trim()
      const zygiskOut = await adb('-s', serial, 'shell', 'magisk --sqlite "select value from settings where key=\'zygisk\'" 2>/dev/null').catch(() => '')
      return {
        installed,
        version: verOut.trim() || (installed ? 'Detected' : null),
        zygisk: zygiskOut.trim() === '1',
        suBinary: suOut.trim() || null,
        daemonRunning: !!daemonOut.trim()
      }
    } catch (e) { return { installed: false, error: e.message } }
  }

  async getInstalledModules(serial) {
    try {
      const listOut = await adb('-s', serial, 'shell', 'ls /data/adb/modules 2>/dev/null').catch(() => '')
      const ids = listOut.split('\n').map(s => s.trim()).filter(Boolean)
      const modules = []
      for (const id of ids) {
        const propOut = await adb('-s', serial, 'shell', `cat /data/adb/modules/${id}/module.prop 2>/dev/null`).catch(() => '')
        const disabledOut = await adb('-s', serial, 'shell', `test -f /data/adb/modules/${id}/disable && echo yes`).catch(() => '')
        const props = {}
        for (const line of propOut.split('\n')) {
          const eq = line.indexOf('=')
          if (eq > 0) props[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
        }
        modules.push({ id, name: props.name || id, version: props.version || '?', author: props.author || '', description: props.description || '', enabled: !disabledOut.trim() })
      }
      return modules
    } catch { return [] }
  }

  getOfficialModules() { return CURATED_MODULES }

  async downloadAndInstall(serial, moduleId, downloadUrl, onProgress) {
    // Look up module definition
    const moduleDef = MODULES.find(m => m.id === moduleId)
    // Resolve dynamic GitHub releases if no direct URL
    if (!downloadUrl && moduleDef?.githubRepo) {
      try {
        const axiosLib = (await import('axios')).default
        // Use GitHub API to get latest release
        const rel = await axiosLib.get(
          `https://api.github.com/repos/${moduleDef.githubRepo}/releases/latest`,
          { timeout: 15000, headers: { 'User-Agent': 'Omerta/1.0' } }
        )
        const assets = rel.data.assets || []
        const pattern = moduleDef.assetPattern || '.zip'
        // Find the right asset - prefer zygisk variants
        const asset = assets.find(a => a.name.includes('zygisk') && a.name.endsWith('.zip'))
                    || assets.find(a => a.name.includes(pattern) && a.name.endsWith('.zip'))
                    || assets.find(a => a.name.endsWith('.zip'))
        if (asset) {
          downloadUrl = asset.browser_download_url
        } else {
          return { error: `No .zip asset found in latest release of ${moduleDef.githubRepo}. Assets: ${assets.map(a=>a.name).join(', ')}` }
        }
      } catch(e) {
        const msg = e.response?.status === 404
          ? `Repo ${moduleDef.githubRepo} not found or has no releases. Download manually.`
          : `Could not fetch release info: ${e.message}`
        return { error: msg }
      }
    }
    if (!downloadUrl) return { error: 'No download URL -- download the .zip manually and use Install from file.' }
    onProgress?.({ percent: 5, message: 'Downloading...' })
    const tmpPath = join(app.getPath('temp'), `magisk_${moduleId}.zip`)
    const axiosDl = (await import('axios')).default
    const res = await axiosDl({ url: downloadUrl, method: 'GET', responseType: 'stream', timeout: 60000 })
    const total = parseInt(res.headers['content-length'] || 0)
    let done = 0
    await new Promise(async (resolve, reject) => {
      const writer = fs.createWriteStream(tmpPath)
      res.data.on('data', c => { done += c.length; if (total) onProgress?.({ percent: 5 + Math.round(done / total * 50), message: 'Downloading...' }) })
      res.data.pipe(writer)
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
    return this.installFromFile(serial, tmpPath, onProgress)
  }

  async installFromFile(serial, zipPath, onProgress) {
    onProgress?.({ percent: 60, message: 'Pushing to device...' })
    const remote = `/data/local/tmp/omerta_module_${Date.now()}.zip`
    await new Promise(async (res, rej) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'push', zipPath, remote])
      proc.on('close', code => code === 0 ? res() : rej(new Error('Push failed')))
    })
    onProgress?.({ percent: 80, message: 'Installing...' })
    const result = await adb('-s', serial, 'shell', `magisk --install-module ${remote} 2>&1`).catch(async () => {
      return adb('-s', serial, 'shell', `unzip -o ${remote} -d /data/adb/modules/$(basename ${remote} .zip) 2>&1`).catch(e => e.message)
    })
    await adb('-s', serial, 'shell', `rm -f ${remote}`).catch(() => {})
    onProgress?.({ percent: 100, message: 'Done -- reboot to activate.' })
    return { success: true, message: 'Installed. Reboot to activate.', output: result }
  }

  async toggleModule(serial, moduleId, enable) {
    const f = `/data/adb/modules/${moduleId}/disable`
    if (enable) await adb('-s', serial, 'shell', `rm -f ${f}`).catch(() => {})
    else await adb('-s', serial, 'shell', `touch ${f}`).catch(() => {})
    return { success: true, moduleId, enabled: enable }
  }

  async removeModule(serial, moduleId) {
    await adb('-s', serial, 'shell', `touch /data/adb/modules/${moduleId}/remove`).catch(() => {})
    return { success: true, message: `${moduleId} will be removed on next reboot.` }
  }
}
