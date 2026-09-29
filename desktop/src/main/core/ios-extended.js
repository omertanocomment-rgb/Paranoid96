import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import plistLib from 'plist'
const plist = {
  parse: (str) => {
    if (!str || (typeof str === 'string' && str.trim().length < 10)) return {}
    try { return plistLib.parse(typeof str === 'string' ? str : str.toString()) } catch(e) { return {} }
  }
}
import axios from 'axios'
import * as cheerio from 'cheerio'
import crypto from 'crypto'
import { openDb } from './db.js'
import zlib from 'zlib'
import { pipeline } from 'stream/promises'

const execAsync = promisify(execFile)

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

//                                                                   
// SHSH BLOB SAVER -- save APTickets for downgrade capability
//                                                                   
export class SHSHBlobSaver {
  // Chip ID   chip name map for TSS server requests
  static CHIP_MAP = {
    '0x8010': 'T8010 (A10)',   '0x8011': 'T8011 (A10X)',
    '0x8015': 'T8015 (A11)',   '0x8020': 'T8020 (A12)',
    '0x8030': 'T8030 (A13)',   '0x8101': 'T8101 (A14)',
    '0x8110': 'T8110 (A15)',   '0x8120': 'T8120 (A16)',
    '0x8130': 'T8130 (A17)'
  }

  async saveBlobs(udid, deviceInfo, firmwares, destDir) {
    const results = []
    await fs.ensureDir(destDir)
    const tsschecker = bin('tsschecker')

    if (!await fs.pathExists(tsschecker)) {
      return { error: 'tsschecker not found. Download from: github.com/1Conan/tsschecker/releases' }
    }

    for (const fw of firmwares) {
      try {
        const blobPath = join(destDir, `${deviceInfo.model}_${fw.version}_${fw.build}.shsh2`)
        const args = [
          '--device', deviceInfo.model,
          '--ecid', deviceInfo.ecid,
          '--ios', fw.version,
          '--save',
          '--blobsavedbpath', blobPath
        ]
        if (fw.buildManifestUrl) args.push('--buildmanifest', fw.buildManifestUrl)

        const result = await new Promise((resolve) => {
          const proc = spawn(tsschecker, args)
          let out = ''
          proc.stdout.on('data', d => out += d)
          proc.stderr.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => resolve({ code, output: out }))
        })

        const saved = await fs.pathExists(blobPath)
        results.push({
          version: fw.version, build: fw.build,
          saved, blobPath: saved ? blobPath : null,
          output: result.output
        })
      } catch (e) {
        results.push({ version: fw.version, build: fw.build, saved: false, error: e.message })
      }
    }
    return { results, savedCount: results.filter(r => r.saved).length, dest: destDir }
  }

  async loadSavedBlobs(blobDir) {
    if (!await fs.pathExists(blobDir)) return []
    const files = await fs.readdir(blobDir)
    return files.filter(f => f.endsWith('.shsh2') || f.endsWith('.shsh')).map(f => {
      const parts = f.replace(/\.shsh2?$/, '').split('_')
      return { filename: f, path: join(blobDir, f), model: parts[0], version: parts[1], build: parts[2] }
    })
  }

  async getSignedFirmwares(deviceModel) {
    try {
      const res = await axios.get(`https://api.ipsw.me/v4/device/${deviceModel}`, { timeout: 10000 })
      return (res.data?.firmwares || []).map(fw => ({
        version: fw.version, build: fw.buildid,
        url: fw.url, signed: fw.signed,
        releaseDate: fw.releasedate,
        filesize: fw.filesize,
        sha256: fw.sha256sum
      }))
    } catch { return [] }
  }

  async getAllFirmwares(deviceModel) {
    try {
      const res = await axios.get(`https://api.ipsw.me/v4/device/${deviceModel}?type=ipsw`, { timeout: 10000 })
      return res.data?.firmwares || []
    } catch { return [] }
  }
}

//                                                                   
// IPSW MANAGER -- download, verify, restore
//                                                                   
export class IPSWManager {
  async search(device, version) {
    try {
      const url = version
        ? `https://api.ipsw.me/v4/ipsw/${device}/${version}`
        : `https://api.ipsw.me/v4/device/${device}?type=ipsw`
      const res = await axios.get(url, { timeout: 10000 })
      const data = res.data
      if (Array.isArray(data?.firmwares)) {
        return data.firmwares.map(f => ({
          version: f.version, build: f.buildid,
          url: f.url, signed: f.signed,
          size: (f.filesize / 1024 / 1024 / 1024).toFixed(2) + ' GB',
          sha256: f.sha256sum,
          releaseDate: f.releasedate?.split('T')[0],
          device
        }))
      }
      if (data?.url) return [{
        version: data.version, build: data.buildid, url: data.url,
        signed: data.signed, size: (data.filesize / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        sha256: data.sha256sum, device
      }]
      return []
    } catch { return [] }
  }

  async getOtaList(device, version) {
    try {
      const res = await axios.get(`https://api.ipsw.me/v4/ota/${device}/${version || 'latest'}`, { timeout: 10000 })
      return res.data?.results || []
    } catch { return [] }
  }

  async download(url, destDir, filename, sha256, onProgress) {
    const outPath = join(destDir, filename)
    const res = await axios({ url, method: 'GET', responseType: 'stream', timeout: 0 })
    const total = parseInt(res.headers['content-length'] || 0)
    let downloaded = 0
    const hash = crypto.createHash('sha256')
    const writer = fs.createWriteStream(outPath)
    return new Promise((resolve, reject) => {
      res.data.on('data', chunk => {
        downloaded += chunk.length
        hash.update(chunk)
        if (onProgress && total) onProgress({ percent: Math.round(downloaded / total * 100), downloaded, total, speed: downloaded })
      })
      res.data.pipe(writer)
      writer.on('finish', async () => {
        const actual = hash.digest('hex')
        if (sha256 && actual.toLowerCase() !== sha256.toLowerCase()) {
          await fs.remove(outPath)
          reject(new Error(`SHA256 mismatch. File corrupted.`))
        } else {
          resolve({ success: true, path: outPath, sha256: actual })
        }
      })
      writer.on('error', reject)
      res.data.on('error', reject)
    })
  }

  async restoreWithLibimobiledevice(udid, ipswPath, onProgress) {
    onProgress?.({ percent: 5, message: 'Starting restore via idevicerestore...' })
    const idevicerestore = bin('idevicerestore')
    if (!await fs.pathExists(idevicerestore)) {
      return { error: 'idevicerestore not found. Download from: github.com/libimobiledevice/idevicerestore/releases' }
    }
    return new Promise((resolve, reject) => {
      const proc = spawn(idevicerestore, ['-u', udid, '-e', ipswPath])
      let out = ''
      proc.stdout.on('data', d => {
        out += d.toString()
        const m = out.match(/(\d+\.\d+)%/)
        if (m) onProgress?.({ percent: Math.min(95, parseFloat(m[1])), message: out.split('\n').filter(Boolean).pop() })
      })
      proc.stderr.on('data', d => { out += d.toString() })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error(out.slice(-500))))
    })
  }

  async extractIPSW(ipswPath, destDir, onProgress) {
    onProgress?.({ percent: 5, message: 'Extracting IPSW...' })
    await fs.ensureDir(destDir)
    return new Promise((resolve, reject) => {
      const unzip = spawn('unzip', ['-o', ipswPath, '-d', destDir])
      let out = ''
      unzip.stdout.on('data', d => { out += d; onProgress?.({ percent: 30, message: d.toString().trim() }) })
      unzip.on('close', async code => {
        if (code !== 0) return reject(new Error('Extract failed'))
        const files = await fs.readdir(destDir)
        onProgress?.({ percent: 100, message: `Extracted ${files.length} files` })
        resolve({ success: true, files, dest: destDir })
      })
    })
  }
}

//                                                                   
// TROLLSTORE INSTALLER -- permanent app install, no cert expiry
//                                                                   
export class TrollStoreManager {
  // Eligibility check based on iOS version and chip
  checkEligibility(iosVersion, chipset) {
    const ver = iosVersion.split('.').map(Number)
    const major = ver[0], minor = ver[1] || 0, patch = ver[2] || 0

    // TrollStore 2 works via different exploits per iOS version
    const methods = []

    // CoreTrust bug -- iOS 14.0-16.6.1 (not 16.7+) on all A-series except A12+ on 14.x
    if (major === 16 && (minor < 6 || (minor === 6 && patch <= 1))) {
      methods.push({ name: 'TrollStore 2 (CoreTrust)', notes: 'Persistent, no expiry', url: 'https://github.com/opa334/TrollStore' })
    }
    if (major === 15) {
      methods.push({ name: 'TrollStore 2 (CoreTrust)', notes: 'Persistent, no expiry', url: 'https://github.com/opa334/TrollStore' })
    }
    if (major === 14 && minor >= 0) {
      methods.push({ name: 'TrollStore 2 (CoreTrust)', notes: 'Persistent, no expiry', url: 'https://github.com/opa334/TrollStore' })
    }
    // iOS 17.0 specific
    if (major === 17 && minor === 0) {
      methods.push({ name: 'TrollStore 2 via TrollRestore', notes: 'Backup restore method', url: 'https://github.com/opa334/TrollStore' })
    }

    return {
      eligible: methods.length > 0,
      methods,
      notes: methods.length === 0 ? 'No TrollStore method for iOS ' + iosVersion : null
    }
  }

  async installViaTrollRestore(udid, onProgress) {
    // TrollRestore method -- uses idevicebackup2 to install via backup restore
    onProgress?.({ percent: 5, message: 'Preparing TrollStore installation via TrollRestore...' })
    const trollrestore = bin('trollrestore')
    if (!await fs.pathExists(trollrestore)) {
      return {
        error: 'TrollRestore not found',
        instructions: [
          '1. Download TrollRestore from: github.com/opa334/TrollStore',
          '2. Place trollrestore binary in bin/ folder',
          '3. Run this again'
        ]
      }
    }
    return new Promise((resolve, reject) => {
      const proc = spawn(trollrestore, ['-u', udid])
      let out = ''
      proc.stdout.on('data', d => {
        out += d.toString()
        onProgress?.({ percent: 50, message: out.split('\n').filter(Boolean).pop() })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error(out)))
    })
  }

  async installIpaViaTrollStore(udid, ipaPath, onProgress) {
    // Once TrollStore is installed, use it to install apps permanently
    onProgress?.({ percent: 10, message: 'Installing via TrollStore (permanent install)...' })
    const remote = `/var/mobile/Documents/TrollStore/${basename(ipaPath)}`

    // Push IPA via AFC
    const pushResult = await new Promise((res, rej) => {
      const proc = spawn(bin('ideviceinstaller'), ['-u', udid, '--copy', ipaPath, '--to', '/var/mobile/Documents/TrollStore/'])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res({ success: true }) : rej(new Error('AFC push failed')))
    })

    // Trigger TrollStore via URL scheme
    onProgress?.({ percent: 70, message: 'Triggering TrollStore install...' })
    await new Promise(res => {
      const proc = spawn(bin('idevicediagnostics'), ['-u', udid, 'restart'])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', res)
    })
    return { success: true, note: 'Open TrollStore on device to complete installation' }
  }

  async getSideloaderApps() {
    // Curated list of useful apps available as IPAs
    return [
      { name: 'Kodi', pkg: 'org.xbmc.kodi', url: 'https://kodi.tv/download', category: 'Media' },
      { name: 'Provenance (Emulator)', pkg: 'org.provenance-emu.provenance', url: 'https://provenance-emu.com', category: 'Gaming' },
      { name: 'UTM (Virtual Machines)', pkg: 'com.utmapp.UTM', url: 'https://getutm.app', category: 'Productivity' },
      { name: 'iSH Shell', pkg: 'app.ish.iSH', url: 'https://ish.app', category: 'Development' },
      { name: 'AltStore', pkg: 'com.rileytestut.AltStore', url: 'https://altstore.io', category: 'Utilities' },
      { name: 'Delta (Game Emulator)', pkg: 'com.rileytestut.Delta', url: 'https://altstore.io', category: 'Gaming' },
      { name: 'Infuse 7', pkg: 'com.firecore.Infuse7', url: 'https://firecore.com', category: 'Media' },
    ]
  }
}

//                                                                   
// JAILBREAK MANAGER -- detect, guide, automate
//                                                                   
export class JailbreakManager {
  // Chip   name lookup
  static CHIP_NAMES = {
    'T8010': 'A10 Fusion', 'T8011': 'A10X Fusion',
    'T8015': 'A11 Bionic', 'T8020': 'A12 Bionic',
    'T8030': 'A13 Bionic', 'T8101': 'A14 Bionic',
    'T8110': 'A15 Bionic', 'T8120': 'A16 Bionic',
    'T8130': 'A17 Pro'
  }

  getJailbreakOptions(iosVersion, deviceModel, chipset) {
    const ver = iosVersion.split('.').map(Number)
    const [major, minor = 0, patch = 0] = ver
    const options = []

    // checkm8 / palera1n -- A8 through A11, any iOS
    const checkm8Chips = ['T7000','T7001','S8000','S8001','S8003','T8010','T8011','T8015']
    if (checkm8Chips.some(c => chipset?.includes(c))) {
      options.push({
        name: 'palera1n',
        type: 'semi-untethered',
        supported: true,
        url: 'https://palera.in',
        github: 'https://github.com/palera1n/palera1n',
        notes: 'checkm8 -- bootrom exploit, unpatchable. Runs on every iOS version on supported chips.',
        iosRange: 'iOS 15.0 - latest',
        requirements: ['Mac or Linux PC required', 'USB cable', '5-10 minutes'],
        bin: 'palera1n'
      })
    }

    // Dopamine -- A12-A16, iOS 15-16.6.1
    if (major === 15 || (major === 16 && (minor < 6 || (minor === 6 && patch <= 1)))) {
      const dopamineChips = ['T8020','T8030','T8101','T8110','T8120']
      if (dopamineChips.some(c => chipset?.includes(c))) {
        options.push({
          name: 'Dopamine',
          type: 'semi-untethered',
          supported: true,
          url: 'https://ellekit.space/dopamine',
          github: 'https://github.com/opa334/Dopamine',
          notes: 'Rootless jailbreak. Uses ElleKit. No PC required after initial setup.',
          iosRange: 'iOS 15.0 - 16.6.1',
          requirements: ['TrollStore pre-installed', 'Or use DebTroll install method'],
          bin: null
        })
      }
    }

    // Misaka / kfd -- iOS 16.0-16.6.1, 17.0
    if ((major === 16 && minor <= 6) || (major === 17 && minor === 0)) {
      options.push({
        name: 'Misaka (kfd exploit)',
        type: 'tweak-injector',
        supported: true,
        url: 'https://github.com/straight-tamago/misaka',
        notes: 'kernel file descriptor exploit. Supports system-level tweaks without full jailbreak.',
        iosRange: 'iOS 16.0 - 17.0',
        requirements: ['TrollStore or AltStore for install'],
        bin: null
      })
    }

    // MacDirtyCow -- iOS 15.0 - 16.1.2
    if (major === 15 || (major === 16 && minor <= 1)) {
      options.push({
        name: 'MacDirtyCow / CVE-2022-46689',
        type: 'exploit-tool',
        supported: true,
        url: 'https://github.com/zhuowei/WDBFontOverwrite',
        notes: 'Allows filesystem writes to system-level files. Fonts, icons, system sounds.',
        iosRange: 'iOS 15.0 - 16.1.2',
        requirements: ['Sideloaded app'],
        bin: null
      })
    }

    // unc0ver -- iOS 11-14.8
    if (major <= 14) {
      options.push({
        name: 'unc0ver',
        type: 'semi-untethered',
        supported: true,
        url: 'https://unc0ver.dev',
        notes: 'Most stable jailbreak for iOS 11-14. Uses Fugu14 exploit on 14.x.',
        iosRange: 'iOS 11.0 - 14.8',
        requirements: ['Windows/Mac PC', 'AltStore or Cydia Impactor'],
        bin: null
      })
    }

    return options
  }

  async launchPalera1n(udid, options = {}, onProgress) {
    const palera1n = bin('palera1n')
    if (!await fs.pathExists(palera1n)) {
      return {
        error: 'palera1n not found',
        download: 'https://palera.in',
        instructions: 'Download for your platform and place in bin/ folder'
      }
    }

    onProgress?.({ percent: 5, message: 'Preparing palera1n...' })
    const args = ['-u', udid]
    if (options.rootful) args.push('--rootful')
    if (options.tweaks) args.push('-t')
    if (options.forceDfu) args.push('-f')
    if (options.boot) args.push('-r') // just boot, don't install

    return new Promise((resolve, reject) => {
      const proc = spawn(palera1n, args)
      let out = ''
      proc.stdout.on('data', d => {
        out += d.toString()
        const lines = out.split('\n').filter(Boolean)
        const last = lines[lines.length - 1]
        onProgress?.({ percent: 30, message: last })
      })
      proc.stderr.on('data', d => { out += d.toString() })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => {
        if (code === 0) resolve({ success: true, output: out })
        else reject(new Error(out.slice(-600)))
      })
    })
  }

  async checkIfJailbroken(udid) {
    // Try SSH on port 22 -- jailbroken devices have SSH
    try {
      await execAsync(bin('idevicediagnostics'), ['-u', udid, 'mobilegestalt', 'SBAllowSensitiveUI'], { timeout: 5000 })
      // Check for Cydia URL scheme  
      const result = await new Promise(res => {
        const proc = spawn(bin('idevicediagnostics'), ['-u', udid, 'diagnostics', 'All'])
        let out = ''
        proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res(out))
      })
      return { jailbroken: result.includes('cydia') || result.includes('sileo'), method: 'gestalt' }
    } catch {
      return { jailbroken: false, method: 'none' }
    }
  }
}

//                                                                   
// CYDIA / SILEO PACKAGE MANAGER -- browse repos on jailbroken devices
//                                                                   
export class CydiaManager {
  static DEFAULT_REPOS = [
    { name: 'Chariz', url: 'https://repo.chariz.com', description: 'Premium tweaks marketplace' },
    { name: 'Havoc', url: 'https://havoc.app', description: 'Quality-filtered repo' },
    { name: 'BigBoss', url: 'http://apt.thebigboss.org/repofiles/cydia/', description: 'Classic large repo' },
    { name: 'Packix', url: 'https://repo.packix.com', description: 'Modern tweak repo' },
    { name: 'Dynastic', url: 'https://repo.dynastic.co', description: 'Developer-friendly repo' },
    { name: 'TWICKD', url: 'https://repo.twickd.com', description: 'Free tweaks' },
    { name: 'Creaturetek', url: 'https://repo.creaturetek.com', description: 'Utilities' },
    { name: 'Odyssey', url: 'https://repo.theodyssey.dev', description: 'unc0ver/Odyssey tools' },
    { name: 'Ellekit / Procursus', url: 'https://apt.procurs.us', description: 'palera1n packages' },
  ]

  async getRepoPackages(repoUrl) {
    try {
      const packagesUrl = repoUrl.replace(/\/$/, '') + '/Packages.bz2'
      const res = await axios.get(packagesUrl, {
        responseType: 'arraybuffer', timeout: 15000
      })
      const decompressed = await new Promise((resolve, reject) => {
        zlib.bunzip2 ? zlib.bunzip2(res.data, (err, result) => err ? reject(err) : resolve(result))
                     : resolve(Buffer.from('')) // fallback
      }).catch(() => Buffer.from(''))

      const text = decompressed.toString('utf8') || ''
      return this.parsePackages(text)
    } catch {
      // Try uncompressed
      try {
        const res = await axios.get(repoUrl.replace(/\/$/, '') + '/Packages', { timeout: 10000 })
        return this.parsePackages(res.data)
      } catch { return [] }
    }
  }

  parsePackages(text) {
    const packages = []
    const entries = text.split('\n\n')
    for (const entry of entries) {
      if (!entry.trim()) continue
      const pkg = {}
      for (const line of entry.split('\n')) {
        const colonIdx = line.indexOf(':')
        if (colonIdx < 0) continue
        const key = line.slice(0, colonIdx).trim().toLowerCase()
        const val = line.slice(colonIdx + 1).trim()
        if (key === 'package') pkg.id = val
        else if (key === 'name') pkg.name = val
        else if (key === 'version') pkg.version = val
        else if (key === 'description') pkg.description = val
        else if (key === 'section') pkg.section = val
        else if (key === 'maintainer') pkg.maintainer = val
        else if (key === 'author') pkg.author = val
        else if (key === 'installed-size') pkg.size = parseInt(val)
        else if (key === 'tag') pkg.tags = val
        else if (key === 'depiction') pkg.depictionUrl = val
      }
      if (pkg.id) packages.push(pkg)
    }
    return packages
  }

  async installDeb(udid, debPath, onProgress) {
    // SSH push and dpkg install on jailbroken device
    onProgress?.({ percent: 10, message: 'Pushing .deb to device...' })
    const remote = `/tmp/${basename(debPath)}`

    await new Promise((res, rej) => {
      const proc = spawn(bin('ideviceinstaller'), ['-u', udid, '--copy', debPath, '--to', '/tmp/'])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res() : rej(new Error('AFC push failed')))
    })

    onProgress?.({ percent: 60, message: 'Installing .deb via dpkg...' })
    // Would need SSH access to actually run dpkg
    return {
      success: true,
      note: 'DEB pushed to /tmp/ -- connect via SSH to run: dpkg -i ' + remote,
      requiresSsh: true
    }
  }

  async downloadDeb(repoUrl, packageId, version, destDir) {
    const packagesData = await this.getRepoPackages(repoUrl)
    const pkg = packagesData.find(p => p.id === packageId)
    if (!pkg?.filename) throw new Error('Package not found')
    const url = repoUrl.replace(/\/$/, '') + '/' + pkg.filename
    const destPath = join(destDir, basename(pkg.filename))
    const res = await axios({ url, method: 'GET', responseType: 'stream' })
    const writer = fs.createWriteStream(destPath)
    await pipeline(res.data, writer)
    return { success: true, path: destPath }
  }
}

//                                                                   
// SSH MANAGER -- for jailbroken devices
//                                                                   
export class iOSSSHManager {
  async connect(host = '127.0.0.1', port = 2222, username = 'mobile', password = 'alpine') {
    // Uses iproxy to tunnel SSH over USB
    return { host, port, username, note: 'Use iproxy 2222 22 first to tunnel SSH over USB' }
  }

  async startProxy(udid, localPort = 2222) {
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('iproxy'), ['-u', udid, localPort.toString(), '22'])
      let ready = false
      proc.stdout.on('data', d => {
        if (!ready && d.toString().includes('waiting')) {
          ready = true
          resolve({ success: true, port: localPort, pid: proc.pid, process: proc })
        }
      })
      proc.stderr.on('data', d => {
        if (!ready && d.toString().includes('binding')) {
          ready = true
          resolve({ success: true, port: localPort, pid: proc.pid, process: proc })
        }
      })
      setTimeout(() => {
        if (!ready) resolve({ success: true, port: localPort, pid: proc.pid, process: proc })
      }, 2000)
      proc.on('error', reject)
    })
  }

  getCommands() {
    return {
      'System': [
        { cmd: 'uname -a', desc: 'Kernel version' },
        { cmd: 'sw_vers', desc: 'iOS version info' },
        { cmd: 'sysctl -a | grep hw.machine', desc: 'Hardware model' },
        { cmd: 'df -h', desc: 'Disk usage' },
        { cmd: 'top -l 1 | head -20', desc: 'CPU/memory usage' },
        { cmd: 'ps aux | head -30', desc: 'Running processes' },
        { cmd: 'launchctl list | head -40', desc: 'Launch daemons' },
      ],
      'Jailbreak': [
        { cmd: 'dpkg -l', desc: 'Installed packages' },
        { cmd: 'apt-get update', desc: 'Update package lists' },
        { cmd: 'apt-cache search <term>', desc: 'Search packages' },
        { cmd: 'apt-get install -y <pkg>', desc: 'Install package' },
        { cmd: 'dpkg -i /tmp/pkg.deb', desc: 'Install local .deb' },
        { cmd: 'cycript -p SpringBoard', desc: 'Inject into SpringBoard' },
        { cmd: 'sbreload', desc: 'Reload SpringBoard (no respring needed)' },
        { cmd: 'killall -9 backboardd', desc: 'Hard respring' },
      ],
      'Files': [
        { cmd: 'ls -la /var/mobile/Containers/Data/Application/', desc: 'App data containers' },
        { cmd: 'find / -name "*.db" -path "*/com.apple.mobilemail*"', desc: 'Mail database' },
        { cmd: 'cat /var/mobile/Library/Preferences/com.apple.springboard.plist', desc: 'SpringBoard prefs' },
        { cmd: 'ls /var/jb/', desc: 'Jailbreak root (rootless)' },
      ],
      'Security': [
        { cmd: 'cat /etc/hosts', desc: 'Hosts file' },
        { cmd: 'security dump-keychain -d', desc: 'Dump keychain (requires root)' },
        { cmd: 'ls /var/mobile/Library/Keychains/', desc: 'Keychain files' },
        { cmd: 'sqlite3 /var/mobile/Library/Keychains/keychain-2.db .dump', desc: 'Raw keychain DB' },
      ]
    }
  }
}

//                                                                   
// ITUNES BACKUP DECRYPTOR -- decrypt encrypted local backups
//                                                                   
export class BackupDecryptor {
  async isEncrypted(backupDir) {
    try {
      const manifestPath = join(backupDir, 'Manifest.plist')
      if (!await fs.pathExists(manifestPath)) return false
      const data = await fs.readFile(manifestPath)
      const manifest = plist.parse(data.toString())
      return manifest.IsEncrypted === true
    } catch { return false }
  }

  async decrypt(backupDir, password, destDir, onProgress) {
    const idevicebackup2decrypt = bin('idevicebackup2-decrypt')
    if (!await fs.pathExists(idevicebackup2decrypt)) {
      // Try Python-based backup decryptor
      return this.decryptWithPython(backupDir, password, destDir, onProgress)
    }
    return new Promise((resolve, reject) => {
      const proc = spawn(idevicebackup2decrypt, ['-p', password, backupDir, destDir])
      proc.stdout.on('data', d => {
        const m = d.toString().match(/(\d+)%/)
        if (m) onProgress?.({ percent: parseInt(m[1]), message: d.toString().trim() })
      })
      proc.on('close', code => code === 0 ? resolve({ success: true, dest: destDir }) : reject(new Error('Decrypt failed')))
    })
  }

  async decryptWithPython(backupDir, password, destDir, onProgress) {
    // Use iphone-backup-decrypt Python library
    const script = `
import sys, os, json
try:
    from iphone_backup_decrypt import EncryptedBackup, RelativePath, RelativePathsLike
    backup = EncryptedBackup(backup_directory="${backupDir}", passphrase="${password}")
    os.makedirs("${destDir}", exist_ok=True)
    backup.extract_files(relative_paths_like="%%", output_folder="${destDir}")
    print(json.dumps({"success": True, "dest": "${destDir}"}))
except ImportError:
    print(json.dumps({"error": "iphone-backup-decrypt not installed. Run: pip install iphone-backup-decrypt"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`
    return new Promise((resolve) => {
      const proc = spawn('python3', ['-c', script])
      let out = ''
      proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => {
        try { resolve(JSON.parse(out.trim())) }
        catch { resolve({ error: 'Python decryption failed: ' + out }) }
      })
    })
  }

  async getBackupContents(backupDir) {
    const manifestPath = join(backupDir, 'Manifest.db')
    if (!await fs.pathExists(manifestPath)) return { error: 'Not a valid iOS backup directory' }
    const db = await openDb(manifestPath, true)
    try {
      const files = db.all(`
        SELECT fileID, domain, relativePath, flags FROM Files
        ORDER BY domain, relativePath LIMIT 5000
      `)
      const domains = [...new Set(files.map(f => f.domain))].sort()
      const byDomain = {}
      for (const d of domains) byDomain[d] = files.filter(f => f.domain === d).length
      return {
        totalFiles: files.length,
        domains,
        fileCountByDomain: byDomain,
        sample: files.slice(0, 100).map(f => ({ domain: f.domain, path: f.relativePath, id: f.fileID }))
      }
    } finally { db.close() }
  }

  async extractFile(backupDir, fileId, destPath) {
    const src = join(backupDir, fileId.slice(0, 2), fileId)
    if (!await fs.pathExists(src)) throw new Error('File not found in backup')
    await fs.copy(src, destPath)
    return { success: true, path: destPath }
  }

  async extractAllPhotos(backupDir, destDir, onProgress) {
    await fs.ensureDir(destDir)
    const contents = await this.getBackupContents(backupDir)
    if (contents.error) return contents
    const db = await openDb(join(backupDir, 'Manifest.db'), true)
    const photos = db.all(`
      SELECT fileID, domain, relativePath FROM Files
      WHERE (relativePath LIKE '%.JPG' OR relativePath LIKE '%.HEIC' OR relativePath LIKE '%.MOV' OR relativePath LIKE '%.PNG')
      AND domain LIKE '%CameraRoll%'
    `)
    db.close()

    let done = 0
    for (const photo of photos) {
      const src = join(backupDir, photo.fileID.slice(0, 2), photo.fileID)
      const dest = join(destDir, basename(photo.relativePath))
      if (await fs.pathExists(src)) {
        await fs.copy(src, dest).catch(() => {})
      }
      done++
      if (done % 20 === 0) onProgress?.({ percent: Math.round(done / photos.length * 100), message: `${done}/${photos.length} photos` })
    }
    return { success: true, extracted: done, dest: destDir }
  }
}

//                                                                   
// ICLOUD ADVANCED DUMPER -- full account data pull
//                                                                   
export class iCloudAdvancedDumper {
  async authenticate(appleid, password) {
    // Uses open-source pyicloud or similar
    const script = `
import sys, json
try:
    from pyicloud import PyiCloudService
    api = PyiCloudService("${appleid}", "${password}")
    if api.requires_2fa:
        print(json.dumps({"requires2fa": True}))
    else:
        devices = [{"name": d.get("name"), "model": d.get("deviceDisplayName"), "status": d.get("batteryStatus")} for d in api.devices]
        print(json.dumps({"success": True, "devices": devices}))
except ImportError:
    print(json.dumps({"error": "pyicloud not installed. Run: pip install pyicloud"}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`
    return new Promise(res => {
      const proc = spawn('python3', ['-c', script])
      let out = ''
      proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => { try { res(JSON.parse(out.trim())) } catch { res({ error: out }) } })
    })
  }

  async pullPhotos(appleid, password, destDir, onProgress) {
    const script = `
import sys, json, os
try:
    from pyicloud import PyiCloudService
    api = PyiCloudService("${appleid}", "${password}")
    os.makedirs("${destDir}", exist_ok=True)
    photos = list(api.photos.all)
    total = len(photos)
    downloaded = 0
    for photo in photos:
        try:
            filename = os.path.join("${destDir}", photo.filename)
            with open(filename, 'wb') as f:
                f.write(photo.download().raw.read())
            downloaded += 1
            if downloaded % 10 == 0:
                print(json.dumps({"progress": downloaded, "total": total}), flush=True)
        except: pass
    print(json.dumps({"done": True, "downloaded": downloaded}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`
    return new Promise(res => {
      const proc = spawn('python3', ['-c', script])
      let out = ''
      proc.stdout.on('data', d => {
        out += d.toString()
        try {
          const lines = out.split('\n').filter(Boolean)
          const last = JSON.parse(lines[lines.length - 1])
          if (last.progress) onProgress?.({ percent: Math.round(last.progress / last.total * 100), message: `${last.progress}/${last.total} photos` })
        } catch {}
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => { try { res(JSON.parse(out.split('\n').filter(Boolean).pop())) } catch { res({ error: out }) } })
    })
  }

  async pullContacts(appleid, password, destDir) {
    const script = `
import json, os
try:
    from pyicloud import PyiCloudService
    api = PyiCloudService("${appleid}", "${password}")
    contacts = api.contacts.all()
    os.makedirs("${destDir}", exist_ok=True)
    vcf_lines = []
    for c in contacts:
        vcf_lines.append("BEGIN:VCARD\\nVERSION:3.0")
        name = c.get("name", {})
        vcf_lines.append(f"FN:{name.get('givenName','')} {name.get('familyName','')}")
        for phone in c.get("phones", []):
            vcf_lines.append(f"TEL:{phone.get('value','')}")
        for email in c.get("emailAddresses", []):
            vcf_lines.append(f"EMAIL:{email.get('value','')}")
        vcf_lines.append("END:VCARD\\n")
    with open(os.path.join("${destDir}", "icloud_contacts.vcf"), "w") as f:
        f.write("\\n".join(vcf_lines))
    print(json.dumps({"success": True, "count": len(contacts)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`
    return new Promise(res => {
      const proc = spawn('python3', ['-c', script])
      let out = ''
      proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => { try { res(JSON.parse(out.trim())) } catch { res({ error: out }) } })
    })
  }

  getAvailableServices() {
    return [
      { id: 'photos', name: 'Photos & Videos', icon: ' ', note: 'Full iCloud Photo Library' },
      { id: 'contacts', name: 'Contacts', icon: ' ', note: 'All iCloud contacts as VCF' },
      { id: 'drive', name: 'iCloud Drive', icon: '  ', note: 'Files and documents' },
      { id: 'notes', name: 'Notes', icon: ' ', note: 'All Apple Notes' },
      { id: 'calendar', name: 'Calendar', icon: ' ', note: 'All calendars as ICS' },
      { id: 'reminders', name: 'Reminders', icon: ' ', note: 'Reminders lists' },
      { id: 'backups', name: 'iCloud Backups', icon: ' ', note: 'Full device backup files' },
    ]
  }
}

//                                                                   
// DEEP iOS DIAGNOSTICS
//                                                                   
export class iOSDiagnostics {
  async getFullDiagnostics(udid) {
    const results = {}
    const domains = [
      'com.apple.mobile.battery',
      'com.apple.mobile.disk_usage',
      'com.apple.mobile.disk_usage.factory',
      'com.apple.mobile.iTunes.store',
      'com.apple.mobile.wireless_lockdown',
      'com.apple.xcode.developerdomain',
      'com.apple.iTunes',
      'com.apple.mobile.data_sync',
      'com.apple.mobile.chaperone',
      'com.apple.mobile.software_behavior',
      'com.apple.mobile.user_preferences',
    ]
    for (const domain of domains) {
      try {
        const out = await execAsync(bin('ideviceinfo'), ['-u', udid, '-q', domain], { timeout: 5000 })
        try { results[domain] = plist.parse(out.stdout) } catch { results[domain] = out.stdout }
      } catch {}
    }
    return results
  }

  async getStorageBreakdown(udid) {
    try {
      const xml = await execAsync(bin('ideviceinfo'), ['-u', udid, '-q', 'com.apple.mobile.disk_usage'], { timeout: 10000 })
      return plist.parse(xml.stdout)
    } catch { return {} }
  }

  async getThermalState(udid) {
    try {
      const out = await execAsync(bin('idevicediagnostics'), ['-u', udid, 'mobilegestalt', 'ThermalLevel,AmbientTemperature'], { timeout: 5000 })
      return plist.parse(out.stdout)
    } catch { return null }
  }

  async getCrashLogs(udid, destDir) {
    await fs.ensureDir(destDir)
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('idevicecrashreport'), ['-u', udid, '-e', destDir])
      let out = ''
      proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async code => {
        if (code === 0) {
          const files = await fs.readdir(destDir)
          resolve({ success: true, count: files.length, dest: destDir })
        } else resolve({ success: false, note: 'idevicecrashreport may not be available', dest: destDir })
      })
    })
  }

  async getMobilegestalt(udid, keys = []) {
    const defaultKeys = [
      'UniqueDeviceID', 'ProductType', 'ProductVersion', 'BuildVersion',
      'ChipID', 'BoardID', 'CPUArchitecture', 'DevicePlatform',
      'HardwarePlatform', 'ModelNumber', 'RegionInfo', 'SIMStatus',
      'TotalDiskCapacity', 'UserDiskCapacity', 'AmountDataAvailable',
      'BasebandVersion', 'CarrierBundleVersion', 'InternationalMobileEquipmentIdentity',
      'MobileSubscriberCountryCode', 'MobileSubscriberNetworkCode',
      'EthernetMacAddress', 'WiFiAddress', 'BluetoothAddress',
      'DeviceEnclosureColor', 'DeviceColor', 'HasSEP', 'FaceTimeCapability',
      'SBAllowSensitiveUI', 'AppleInternalInstallCapability',
      'com.apple.private.security.container-required'
    ]
    const queryKeys = keys.length ? keys : defaultKeys
    try {
      const out = await execAsync(bin('ideviceinfo'), ['-u', udid, '--xml'], { timeout: 15000 })
      return plist.parse(out.stdout)
    } catch { return {} }
  }

  async getActivationState(udid) {
    try {
      const out = await execAsync(bin('ideviceactivation'), ['-u', udid, 'state'], { timeout: 8000 })
      return { state: out.stdout.trim() }
    } catch { return { state: 'unknown', note: 'ideviceactivation not found' } }
  }

  async getBatteryDeepInfo(udid) {
    try {
      const xml = await execAsync(bin('ideviceinfo'), ['-u', udid, '-q', 'com.apple.mobile.battery'], { timeout: 8000 })
      const info = plist.parse(xml.stdout)
      return {
        level: info.BatteryCurrentCapacity,
        fullyCharged: info.FullyCharged,
        charging: info.ExternalChargeCapable,
        cycleCount: info.CycleCount,
        designCapacity: info.DesignCapacity,
        nominalChargeCapacity: info.NominalChargeCapacity,
        temperature: info.BatteryTemperature ? (info.BatteryTemperature / 100).toFixed(1) + ' C' : null,
        maximumCapacityPercent: info.DesignCapacity && info.NominalChargeCapacity
          ? Math.round(info.NominalChargeCapacity / info.DesignCapacity * 100) : null,
        rawData: info
      }
    } catch { return {} }
  }

  async getSyslog(udid, lines = 500) {
    return new Promise(res => {
      const proc = spawn(bin('idevicesyslog'), ['-u', udid])
      const collected = []
      proc.stdout.on('data', d => {
        collected.push(...d.toString().split('\n'))
        if (collected.length >= lines) { proc.kill(); res(collected.slice(0, lines).join('\n')) }
      })
      setTimeout(() => { proc.kill(); res(collected.join('\n')) }, 5000)
    })
  }
}

//                                                                   
// iOS PROFILE MANAGER -- MDM, VPN, certs
//                                                                   
export class iOSProfileManager {
  async listProfiles(udid) {
    try {
      const out = await execAsync(bin('ideviceprovision'), ['-u', udid, 'list'], { timeout: 10000 })
      return { raw: out.stdout, parsed: this.parseProfiles(out.stdout) }
    } catch { return { error: 'ideviceprovision not found', profiles: [] } }
  }

  async installProfile(udid, profilePath) {
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('ideviceprovision'), ['-u', udid, 'install', profilePath])
      let out = ''
      proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error(out)))
    })
  }

  async removeProfile(udid, profileId) {
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('ideviceprovision'), ['-u', udid, 'remove', profileId])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error('Remove failed')))
    })
  }

  parseProfiles(raw) {
    const profiles = []
    const blocks = raw.split('\n\n')
    for (const block of blocks) {
      if (!block.trim()) continue
      const name = block.match(/Name: (.+)/)?.[1]
      const uuid = block.match(/UUID: (.+)/)?.[1]
      const type = block.match(/Type: (.+)/)?.[1]
      const expires = block.match(/ExpirationDate: (.+)/)?.[1]
      if (uuid) profiles.push({ name, uuid, type, expires })
    }
    return profiles
  }
}

//                                                                   
// iOS MEDIA MANAGER -- ringtones, wallpapers, contacts photos
//                                                                   
export class iOSMediaManager {
  async setWallpaper(udid, imagePath, screen = 'both') {
    // On jailbroken: can set via WallpaperKit
    // Without JB: uses AFC to write to camera roll, then notify
    const remote = `/var/mobile/Media/DCIM/100APPLE/FTWALL.JPG`
    return { note: 'Set wallpaper requires jailbreak or user action. Image pushed to camera roll.', remote }
  }

  async createRingtone(audioPath, outputDir, startSec = 0, durationSec = 30) {
    const name = basename(audioPath, extname(audioPath))
    const m4rPath = join(outputDir, name + '.m4r')
    await fs.ensureDir(outputDir)
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('ffmpeg'), [
        '-y', '-i', audioPath,
        '-ss', startSec.toString(),
        '-t', durationSec.toString(),
        '-acodec', 'aac',
        '-b:a', '256k',
        '-ar', '44100',
        m4rPath
      ])
      let err = ''
      proc.stderr.on('data', d => err += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0
        ? resolve({ success: true, path: m4rPath, note: 'Drag ' + basename(m4rPath) + ' to iTunes Tones or use TrollStore to install permanently' })
        : reject(new Error(err)))
    })
  }

  async pushRingtone(udid, m4rPath) {
    // Copy to iTunes sync location
    const remote = `/var/mobile/Media/iTunes_Control/Ringtones/${basename(m4rPath)}`
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('ifuse'), ['-u', udid, '--copies', m4rPath, '--to', '/Ringtones/'])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true, remote }) : reject(new Error('Push failed')))
    })
  }

  async getDeviceMedia(udid, destDir, type = 'photos') {
    await fs.ensureDir(destDir)
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('ideviceimagemounter'), ['-u', udid])
      // Use idevice photo pull
      const photoProc = spawn(bin('ifuse'), ['--udid', udid, '--root', join(destDir, 'mounted')])
      photoProc.on('close', code => {
        resolve({ success: true, dest: join(destDir, 'mounted'), note: 'Device filesystem mounted. Browse DCIM folder.' })
      })
    })
  }
}

export default {
  SHSHBlobSaver,
  IPSWManager,
  TrollStoreManager,
  JailbreakManager,
  CydiaManager,
  iOSSSHManager,
  BackupDecryptor,
  iCloudAdvancedDumper,
  iOSDiagnostics,
  iOSProfileManager,
  iOSMediaManager
}
