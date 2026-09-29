import { spawn, execFile } from 'child_process'
import { join, basename } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import { promisify } from 'util'
const execFileAsync = promisify(execFile)

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  const ext = process.platform === 'win32' ? '.exe' : ''
  return join(base, name + ext)
}

function spawnAsync(cmd, args, onData) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { env: process.env })
    let out = '', err = ''
    proc.stdout?.on('data', d => { out += d; onData?.(d.toString()) })
    proc.stderr?.on('data', d => { err += d; onData?.(d.toString()) })
    proc.on('error', e => reject(e))
    proc.on('close', code => code === 0 ? resolve(out) : reject(new Error(err || out || 'exit ' + code)))
  })
}

export class Sideloader {
  // ── Android APK ──────────────────────────────────────────────────────────
  async installApk(serial, apkPath, onProgress) {
    onProgress?.({ percent: 10, message: 'Installing APK...' })
    return new Promise((resolve) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'install', '-r', '-d', apkPath])
      let out = ''
      proc.stdout?.on('data', d => { out += d; onProgress?.({ percent: 50, message: d.toString().trim() }) })
      proc.stderr?.on('data', d => { out += d })
      proc.on('error', e => resolve({ success: false, error: e.message }))
      proc.on('close', code => {
        onProgress?.({ percent: 100, message: code === 0 ? 'Done' : 'Failed' })
        resolve({ success: code === 0 || out.includes('Success'), output: out })
      })
    })
  }

  async installXapk(serial, xapkPath, onProgress) {
    onProgress?.({ percent: 5, message: 'Extracting XAPK...' })
    try {
      const { default: StreamZip } = await import('node-stream-zip')
      const tmpDir = join(app.getPath('userData'), 'xapk_tmp_' + Date.now())
      await fs.ensureDir(tmpDir)
      const zip = new StreamZip.async({ file: xapkPath })
      await zip.extract(null, tmpDir)
      await zip.close()
      const files = await fs.readdir(tmpDir)
      const apks = files.filter(f => f.endsWith('.apk')).map(f => join(tmpDir, f))
      if (!apks.length) return { success: false, error: 'No APK found inside XAPK' }
      onProgress?.({ percent: 30, message: `Installing ${apks.length} APK(s)...` })
      if (apks.length === 1) return this.installApk(serial, apks[0], onProgress)
      return new Promise(resolve => {
        const proc = spawn(bin('adb'), ['-s', serial, 'install-multiple', '-r', ...apks])
        let out = ''
        proc.stdout?.on('data', d => { out += d; onProgress?.({ percent: 70, message: d.toString().trim() }) })
        proc.stderr?.on('data', d => { out += d })
        proc.on('error', e => resolve({ success: false, error: e.message }))
        proc.on('close', async code => {
          await fs.remove(tmpDir).catch(() => {})
          onProgress?.({ percent: 100, message: code === 0 ? 'Done' : 'Failed' })
          resolve({ success: code === 0 || out.includes('Success'), output: out })
        })
      })
    } catch (e) { return { success: false, error: e.message } }
  }

  // ── iOS IPA ───────────────────────────────────────────────────────────────
  async signAndInstallIpa(udid, ipaPath, onProgress) {
    // Method 1: Direct install via ideviceinstaller (works for developer-signed IPAs)
    onProgress?.({ percent: 5, message: 'Trying direct install...' })
    const installerExists = await fs.pathExists(bin('ideviceinstaller'))
    if (!installerExists) {
      return { success: false, error: 'ideviceinstaller not found. Run install-tools.ps1', method: 'none' }
    }

    // Try direct install first (works for: dev-signed, enterprise, already-signed IPAs)
    const directResult = await this._ideviceInstallerInstall(udid, ipaPath, onProgress)
    if (directResult.success) return { ...directResult, method: 'direct' }

    // Method 2: zsign (open source, no Apple ID needed for personal certs)
    onProgress?.({ percent: 20, message: 'Trying zsign...' })
    const zsignExists = await fs.pathExists(bin('zsign'))
    if (zsignExists) {
      const zsignResult = await this._zsignInstall(udid, ipaPath, onProgress)
      if (zsignResult.success) return { ...zsignResult, method: 'zsign' }
    }

    // Nothing worked - return helpful error
    return {
      success: false,
      error: directResult.error || 'Install failed',
      method: 'failed',
      suggestions: [
        'For already-signed IPAs: ensure device is trusted and ideviceinstaller is installed',
        'For unsigned IPAs: install zsign (bin/zsign.exe) for free signing without Apple ID',
        'For permanent install: use TrollStore if your iOS version is supported',
        'For AltStore method: install AltServer on PC and use AltStore on device',
        'For enterprise IPAs: the IPA may need a valid provisioning profile',
      ]
    }
  }

  async _ideviceInstallerInstall(udid, ipaPath, onProgress) {
    return new Promise(resolve => {
      const args = udid ? ['-u', udid, '-i', ipaPath] : ['-i', ipaPath]
      const proc = spawn(bin('ideviceinstaller'), args)
      let out = '', err = ''
      proc.stdout?.on('data', d => { out += d; onProgress?.({ percent: 60, message: d.toString().trim() }) })
      proc.stderr?.on('data', d => { err += d })
      proc.on('error', e => resolve({ success: false, error: e.message }))
      proc.on('close', code => {
        const combined = out + err
        const success = code === 0 && (combined.includes('Complete') || combined.includes('Install') || !combined.includes('Error'))
        onProgress?.({ percent: 100, message: success ? 'Installed' : 'Failed' })
        resolve({ success, output: combined, error: success ? null : combined.trim() })
      })
    })
  }

  async _zsignInstall(udid, ipaPath, onProgress) {
    try {
      const tmpDir = join(app.getPath('userData'), 'zsign_tmp')
      await fs.ensureDir(tmpDir)
      const signedPath = join(tmpDir, basename(ipaPath).replace('.ipa', '_signed.ipa'))
      onProgress?.({ percent: 40, message: 'Signing with zsign...' })
      await spawnAsync(bin('zsign'), ['-z', '9', '-o', signedPath, ipaPath], msg => {
        onProgress?.({ percent: 55, message: msg.trim() })
      })
      onProgress?.({ percent: 70, message: 'Installing signed IPA...' })
      const result = await this._ideviceInstallerInstall(udid, signedPath, onProgress)
      await fs.remove(tmpDir).catch(() => {})
      return result
    } catch (e) { return { success: false, error: e.message } }
  }

  // ── IPA analysis ──────────────────────────────────────────────────────────
  async analyzeIpa(ipaPath) {
    try {
      const { default: StreamZip } = await import('node-stream-zip')
      const zip = new StreamZip.async({ file: ipaPath })
      const entries = await zip.entries()
      const keys = Object.keys(entries)

      // Find Info.plist
      const plistEntry = keys.find(k => k.match(/Payload\/[^/]+\.app\/Info\.plist$/))
      if (!plistEntry) { await zip.close(); return { error: 'No Info.plist found in IPA' } }

      const plistBuf = await zip.entryData(plistEntry)
      let info = {}
      try {
        const plistLib = await import('plist')
        info = plistLib.default.parse(plistBuf.toString())
      } catch {}

      const size = (await fs.stat(ipaPath)).size
      await zip.close()

      return {
        success: true,
        bundleId:    info.CFBundleIdentifier || 'unknown',
        name:        info.CFBundleDisplayName || info.CFBundleName || 'unknown',
        version:     info.CFBundleShortVersionString || '',
        build:       info.CFBundleVersion || '',
        minIos:      info.MinimumOSVersion || '',
        platform:    info.CFBundleSupportedPlatforms?.join(', ') || '',
        entitlements: keys.some(k => k.includes('entitlements')),
        hasProvision: keys.some(k => k.includes('embedded.mobileprovision')),
        fileSize:    size,
        fileSizeMb:  (size / 1e6).toFixed(1),
      }
    } catch (e) { return { success: false, error: e.message } }
  }

  // ── ipatool download ──────────────────────────────────────────────────────
  async downloadViaIpatool(bundleId, appleId, password, destDir) {
    const ipatool = bin('ipatool')
    if (!await fs.pathExists(ipatool)) {
      return { success: false, error: 'ipatool not found. Download from github.com/majd/ipatool/releases' }
    }
    await fs.ensureDir(destDir)
    return spawnAsync(ipatool, ['download', '--bundle-id', bundleId, '--output', join(destDir, bundleId + '.ipa'),
      '--apple-id', appleId, '--password', password])
      .then(() => ({ success: true, path: join(destDir, bundleId + '.ipa') }))
      .catch(e => ({ success: false, error: e.message }))
  }
}

export default new Sideloader()
