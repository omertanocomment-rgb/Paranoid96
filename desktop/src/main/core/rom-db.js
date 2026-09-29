import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import crypto from 'crypto'
import axios from 'axios'

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

//    Known ROM source APIs                                                   
export const ROM_SOURCES = {
  lineageos: {
    name: 'LineageOS',
    deviceListUrl: 'https://download.lineageos.org/api/v1/devices',
    buildUrlTemplate: 'https://download.lineageos.org/api/v1/builds/{device}',
    logo: 'lineageos'
  },
  pixelexperience: {
    name: 'PixelExperience',
    deviceListUrl: 'https://download.pixelexperience.org/devices',
    logo: 'pixelexperience'
  },
  crdroid: {
    name: 'crDroid',
    deviceListUrl: 'https://crdroid.net/api/devices',
    logo: 'crdroid'
  },
  evolutionx: {
    name: 'Evolution X',
    deviceListUrl: 'https://api.github.com/repos/Evolution-X-Devices/official_devices/contents/devices',
    logo: 'evolutionx'
  },
  grapheneos: {
    name: 'GrapheneOS',
    supported: ['Pixel 6', 'Pixel 7', 'Pixel 8', 'Pixel 9'],
    baseUrl: 'https://releases.grapheneos.org',
    logo: 'grapheneos'
  },
  calyx: {
    name: 'CalyxOS',
    baseUrl: 'https://calyxos.org/update',
    logo: 'calyx'
  }
}

//    Stock ROM sources by brand                                              
export const STOCK_SOURCES = {
  samsung: {
    name: 'Samsung',
    methods: [
      { name: 'SamFW.com', url: 'https://samfw.com/firmware/{model}/{region}', type: 'site' },
      { name: 'SamMobile', url: 'https://www.sammobile.com/samsung/firmware/{model}/{region}/', type: 'site' },
      { name: 'Frija / Samloader', url: 'https://github.com/jesec/SamloaderKotlin', type: 'tool', description: 'Open-source Samsung firmware downloader' }
    ]
  },
  xiaomi: {
    name: 'Xiaomi / MIUI',
    methods: [
      { name: 'MIUI Downloads', url: 'https://c.mi.com/global/miuidownload/index', type: 'site' },
      { name: 'XiaomiFirmwareUpdater', url: 'https://xiaomifirmwareupdater.com/archive/miui/{device}/', type: 'site' },
      { name: 'miui.eu', url: 'https://sourceforge.net/projects/xiaomi-eu-multilang-miui-roms/', type: 'site' }
    ]
  },
  pixel: {
    name: 'Google Pixel',
    methods: [
      { name: 'Google Factory Images', url: 'https://developers.google.com/android/images', type: 'official' },
      { name: 'Google OTA Images', url: 'https://developers.google.com/android/ota', type: 'official' },
      { name: 'Android Flash Tool', url: 'https://flash.android.com', type: 'tool' }
    ]
  },
  oneplus: {
    name: 'OnePlus',
    methods: [
      { name: 'OnePlus Software Update', url: 'https://www.oneplus.com/support/softwareupgrade', type: 'official' },
      { name: 'OnePlus Firmware', url: 'https://oxygenupdater.com/', type: 'site' }
    ]
  },
  motorola: {
    name: 'Motorola',
    methods: [
      { name: 'Motorola Support', url: 'https://motorola-global-portal.custhelp.com/app/software-upgrade-individualSU', type: 'official' },
      { name: 'Motorola Firmware', url: 'https://mirrors.lolinet.com/firmware/motorola/', type: 'site' }
    ]
  },
  nothing: {
    name: 'Nothing Phone',
    methods: [
      { name: 'Nothing OTA', url: 'https://nothing.tech/pages/update', type: 'official' }
    ]
  }
}

export default class ROMManager {
  async search(query, device) {
    const results = []
    if (!query && !device) return results

    // LineageOS
    try {
      const devEncoded = encodeURIComponent(device || query)
      const res = await axios.get(`https://download.lineageos.org/api/v1/builds/${devEncoded}`, { timeout: 8000 })
      if (res.data?.response?.length) {
        res.data.response.slice(0, 3).forEach(build => {
          results.push({
            source: 'LineageOS', version: build.version,
            date: new Date(build.datetime * 1000).toLocaleDateString(),
            size: (build.size / 1024 / 1024 / 1024).toFixed(2) + ' GB',
            url: build.url, filename: build.filename,
            sha256: build.sha256, device: build.romtype,
            type: 'custom'
          })
        })
      }
    } catch {}

    // PixelExperience
    try {
      const res = await axios.get(`https://download.pixelexperience.org/api/v1/updates/${device || query}`, { timeout: 8000 })
      if (res.data?.filename) {
        const d = res.data
        results.push({
          source: 'PixelExperience', version: d.version,
          date: new Date(d.datetime * 1000).toLocaleDateString(),
          size: (d.size / 1024 / 1024 / 1024).toFixed(2) + ' GB',
          url: d.url, filename: d.filename, sha256: d.sha256,
          device: device || query, type: 'custom'
        })
      }
    } catch {}

    // GrapheneOS (Pixel only)
    if ((device || query).toLowerCase().includes('pixel')) {
      try {
        const res = await axios.get('https://releases.grapheneos.org/releases', { timeout: 8000 })
        const lines = res.data.split('\n').filter(l => l.includes(device || query))
        if (lines.length) {
          const parts = lines[0].split(' ')
          results.push({
            source: 'GrapheneOS', version: parts[1] || 'latest',
            date: new Date(parseInt(parts[0]) * 1000).toLocaleDateString(),
            url: `https://releases.grapheneos.org/${device}-ota_update-${parts[1]}.zip`,
            device: device || query, type: 'custom', privacyFocused: true
          })
        }
      } catch {}
    }

    return results
  }

  async getDeviceList(source = 'lineageos') {
    try {
      if (source === 'lineageos') {
        const res = await axios.get('https://download.lineageos.org/api/v1/devices', { timeout: 10000 })
        return Object.keys(res.data || {}).map(codename => ({
          codename, name: res.data[codename]?.name || codename,
          vendor: res.data[codename]?.vendor || '',
          source: 'LineageOS'
        }))
      }
    } catch {}
    return []
  }

  async download(url, destDir, filename, expectedChecksum, onProgress) {
    const destPath = join(destDir, filename)
    const res = await axios({ url, method: 'GET', responseType: 'stream', timeout: 0 })
    const total = parseInt(res.headers['content-length'] || 0)
    let downloaded = 0
    const writer = fs.createWriteStream(destPath)
    const hash = crypto.createHash('sha256')
    return new Promise((resolve, reject) => {
      res.data.on('data', chunk => {
        downloaded += chunk.length
        hash.update(chunk)
        if (onProgress && total) onProgress({ percent: Math.round(downloaded / total * 100), downloaded, total })
      })
      res.data.pipe(writer)
      writer.on('finish', async () => {
        const actualHash = hash.digest('hex')
        if (expectedChecksum && actualHash !== expectedChecksum) {
          await fs.remove(destPath)
          reject(new Error(`Checksum mismatch. Expected: ${expectedChecksum}, got: ${actualHash}`))
        } else {
          resolve({ success: true, path: destPath, sha256: actualHash })
        }
      })
      writer.on('error', reject)
      res.data.on('error', reject)
    })
  }

  async verifyHash(filePath, expectedHash) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const stream = fs.createReadStream(filePath)
      stream.on('data', d => hash.update(d))
      stream.on('end', () => {
        const actual = hash.digest('hex')
        resolve({ match: actual === expectedHash, actual, expected: expectedHash })
      })
      stream.on('error', reject)
    })
  }

  async flashViaAdb(serial, zipPath, onProgress) {
    onProgress?.({ percent: 5, message: 'Rebooting to recovery...' })
    await new Promise((res, rej) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'reboot', 'recovery'])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res() : rej(new Error('Reboot failed')))
    })
    await new Promise(res => setTimeout(res, 8000))
    onProgress?.({ percent: 20, message: 'Sideloading ROM...' })
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'sideload', zipPath])
      let out = ''
      proc.stdout.on('data', d => {
        out += d.toString()
        const m = out.match(/serving:.*?(\d+)%/)
        if (m) onProgress?.({ percent: 20 + Math.round(parseInt(m[1]) * 0.75), message: `Flashing: ${m[1]}%` })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0
        ? resolve({ success: true, message: 'Flash complete. Reboot your device.' })
        : reject(new Error('Sideload failed: ' + out)))
    })
  }

  async flashViaFastboot(serial, romPath, onProgress) {
    onProgress?.({ percent: 5, message: 'Checking fastboot connection...' })
    const { stdout } = await new Promise((res, rej) => {
      const proc = spawn(bin('fastboot'), ['devices'])
      let out = ''
      proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res({ stdout: out }))
    })
    if (!stdout.includes(serial) && !stdout.trim()) {
      return { success: false, error: 'Device not found in fastboot mode' }
    }
    onProgress?.({ percent: 20, message: 'Flashing ROM...' })
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('fastboot'), ['update', romPath])
      let out = ''
      proc.stdout.on('data', d => {
        out += d.toString()
        onProgress?.({ percent: 20, message: out.split('\n').filter(Boolean).pop() })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0
        ? resolve({ success: true })
        : reject(new Error('Fastboot flash failed: ' + out)))
    })
  }

  getStockSources(brand, model) {
    const brandKey = brand?.toLowerCase()
    const source = STOCK_SOURCES[brandKey]
    if (!source) return { methods: [], note: 'Brand not in database -- try searching XDA Developers' }
    return source
  }
}
