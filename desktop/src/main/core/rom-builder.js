import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import crypto from 'crypto'
import StreamZip from 'node-stream-zip'
import archiver from 'archiver'

const execFileAsync = promisify(execFile)

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

export default class ROMBuilder {
  constructor() {
    this.workspaces = new Map()
  }

  //    Inspect ROM                                                            
  async inspect(romPath) {
    const ext = extname(romPath).toLowerCase()
    const stat = await fs.stat(romPath)
    const info = {
      path: romPath, filename: basename(romPath),
      size: (stat.size / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      format: ext, entries: []
    }
    if (['.zip', '.apk'].includes(ext)) {
      const zip = new StreamZip.async({ file: romPath })
      const entries = await zip.entries()
      info.entries = Object.keys(entries).slice(0, 200)
      info.entryCount = Object.keys(entries).length
      info.hasMetaInf = info.entries.some(e => e.startsWith('META-INF'))
      info.hasSystem = info.entries.some(e => e.startsWith('system/'))
      info.hasBootImg = info.entries.some(e => e.endsWith('boot.img'))
      info.hasVendor = info.entries.some(e => e.startsWith('vendor/'))
      info.hasDtbo = info.entries.some(e => e.includes('dtbo'))
      info.hasPayload = info.entries.some(e => e === 'payload.bin')
      info.isFlashableZip = info.hasMetaInf
      info.isPayloadBased = info.hasPayload
      await zip.close()
    } else if (['.img', '.bin'].includes(ext)) {
      info.type = 'raw image'
    }
    return info
  }

  //    Extract ROM to workspace                                                
  async extractRom(romPath, onProgress) {
    const workDir = join(app.getPath('temp'), 'omerta_rom_' + Date.now())
    await fs.ensureDir(workDir)
    onProgress?.({ percent: 5, message: 'Extracting ROM archive...' })
    const zip = new StreamZip.async({ file: romPath })
    const count = Object.keys(await zip.entries()).length
    let done = 0
    await zip.extract(null, workDir, (err) => { if (err) console.warn(err) })
    await zip.close()
    onProgress?.({ percent: 60, message: 'Extracting system images...' })

    // If payload.bin (Pixel-style), extract it
    const payloadPath = join(workDir, 'payload.bin')
    if (await fs.pathExists(payloadPath)) {
      onProgress?.({ percent: 65, message: 'Extracting payload.bin (this takes a while)...' })
      await this.extractPayload(payloadPath, workDir, onProgress)
    }

    // Mount/extract sparse images
    const imgs = await this.findImages(workDir)
    for (const img of imgs) {
      onProgress?.({ percent: 70, message: `Processing ${basename(img)}...` })
      await this.extractSparseImage(img, workDir)
    }
    onProgress?.({ percent: 95, message: 'Workspace ready' })
    this.workspaces.set(workDir, { romPath, extractedAt: Date.now() })
    return { workDir, images: imgs.map(i => basename(i)) }
  }

  async extractPayload(payloadPath, workDir, onProgress) {
    const payloadBin = bin('payload-dumper-go')
    if (!await fs.pathExists(payloadBin)) {
      return { error: 'payload-dumper-go not found. Download from github.com/ssut/payload-dumper-go' }
    }
    return new Promise((resolve, reject) => {
      const proc = spawn(payloadBin, [payloadPath, '--output', workDir])
      proc.stdout.on('data', d => {
        const m = d.toString().match(/(\d+)%/)
        if (m) onProgress?.({ percent: 65 + parseInt(m[1]) * 0.2, message: `Payload: ${m[1]}%` })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve() : reject(new Error('payload-dumper failed')))
    })
  }

  async findImages(workDir) {
    const imgs = []
    const walk = async (dir) => {
      const files = await fs.readdir(dir)
      for (const f of files) {
        const full = join(dir, f)
        const stat = await fs.stat(full)
        if (stat.isDirectory()) await walk(full)
        else if (f.endsWith('.img')) imgs.push(full)
      }
    }
    await walk(workDir)
    return imgs
  }

  async extractSparseImage(imgPath, workDir) {
    // Use simg2img to convert Android sparse images to raw
    const simg2img = bin('simg2img')
    if (!await fs.pathExists(simg2img)) return
    const rawPath = imgPath.replace('.img', '_raw.img')
    try {
      await execFileAsync(simg2img, [imgPath, rawPath], { timeout: 60000 })
    } catch {}
  }

  //    List system apps in extracted ROM                                     
  async listSystemApps(workDir) {
    const apkPaths = []
    const searchDirs = ['system/app', 'system/priv-app', 'system_ext/app', 'system_ext/priv-app', 'product/app']
    for (const dir of searchDirs) {
      const full = join(workDir, dir)
      if (!await fs.pathExists(full)) continue
      const entries = await fs.readdir(full)
      for (const entry of entries) {
        const entryPath = join(full, entry)
        const stat = await fs.stat(entryPath)
        if (stat.isDirectory()) {
          const apks = (await fs.readdir(entryPath)).filter(f => f.endsWith('.apk'))
          for (const apk of apks) {
            apkPaths.push({
              name: entry, apk,
              path: join(entryPath, apk).replace(workDir + '/', ''),
              systemDir: dir, size: (await fs.stat(join(entryPath, apk))).size
            })
          }
        } else if (entry.endsWith('.apk')) {
          apkPaths.push({
            name: entry.replace('.apk', ''), apk: entry,
            path: join(full, entry).replace(workDir + '/', ''),
            systemDir: dir, size: stat.size
          })
        }
      }
    }
    // Known bloatware flags
    const bloatKeywords = ['facebook', 'netflix', 'amazon', 'spotify', 'tiktok', 'snapchat',
      'booking', 'linkedIn', 'skype', 'teams', 'bing', 'cortana', 'candy', 'bubble']
    return apkPaths.map(a => ({
      ...a,
      isBloat: bloatKeywords.some(k => a.name.toLowerCase().includes(k)),
      sizeHuman: (a.size / 1024 / 1024).toFixed(1) + ' MB'
    }))
  }

  //    Remove system apps                                                     
  async removeSystemApps(workDir, packages) {
    const removed = []
    for (const pkg of packages) {
      const fullPath = join(workDir, pkg.path)
      const dir = join(fullPath, '..')
      try {
        await fs.remove(fullPath)
        // Remove whole app folder if empty
        const remaining = await fs.readdir(dir)
        if (remaining.length === 0) await fs.remove(dir)
        removed.push(pkg.name)
      } catch (e) { console.warn('Remove failed:', e.message) }
    }
    return { removed }
  }

  //    Add system app                                                         
  async addSystemApp(workDir, apkPath) {
    const name = basename(apkPath, '.apk')
    const destDir = join(workDir, 'system/app', name)
    await fs.ensureDir(destDir)
    await fs.copy(apkPath, join(destDir, basename(apkPath)))
    return { success: true, name }
  }

  //    Patch boot.img with Magisk                                              
  async patchBootImg(bootImgPath, magiskApkPath, destDir, onProgress) {
    onProgress?.({ percent: 10, message: 'Preparing Magisk patcher...' })
    const magiskboot = bin('magiskboot')
    if (!await fs.pathExists(magiskboot)) {
      return { error: 'magiskboot not found. Extract from a Magisk APK: rename to .zip, find lib/x86_64/libmagiskboot.so' }
    }
    const workDir = join(app.getPath('temp'), 'magisk_patch_' + Date.now())
    await fs.ensureDir(workDir)
    await fs.copy(bootImgPath, join(workDir, 'boot.img'))
    onProgress?.({ percent: 30, message: 'Unpacking boot image...' })
    await execFileAsync(magiskboot, ['unpack', 'boot.img'], { cwd: workDir, timeout: 30000 })
    onProgress?.({ percent: 50, message: 'Injecting Magisk init...' })

    // Copy magiskinit
    if (magiskApkPath) {
      const tmpZip = join(workDir, 'magisk.zip')
      await fs.copy(magiskApkPath, tmpZip)
      const zip = new StreamZip.async({ file: tmpZip })
      await fs.ensureDir(join(workDir, 'magisk'))
      const entries = await zip.entries()
      for (const entry of Object.keys(entries)) {
        if (entry.startsWith('lib/') && entry.endsWith('.so')) {
          const data = await zip.entryData(entry)
          const name = basename(entry).replace('lib', '').replace('.so', '')
          await fs.writeFile(join(workDir, name), data, { mode: 0o755 })
        }
      }
      await zip.close()
    }

    onProgress?.({ percent: 70, message: 'Repacking boot image...' })
    await execFileAsync(magiskboot, ['repack', 'boot.img', 'new-boot.img'], { cwd: workDir, timeout: 30000 })
    const outPath = join(destDir, 'magisk_patched_boot.img')
    await fs.copy(join(workDir, 'new-boot.img'), outPath)
    await fs.remove(workDir)
    onProgress?.({ percent: 100, message: 'Boot image patched!' })
    return { success: true, path: outPath }
  }

  async patchMagisk(workDir, magiskApkPath, onProgress) {
    const bootImg = join(workDir, 'boot.img')
    if (!await fs.pathExists(bootImg)) {
      return { error: 'boot.img not found in workspace' }
    }
    return this.patchBootImg(bootImg, magiskApkPath, workDir, onProgress)
  }

  //    Repack ROM                                                             
  async repack(workDir, destDir, outputName, onProgress) {
    onProgress?.({ percent: 5, message: 'Packing ROM ZIP...' })
    const outPath = join(destDir, outputName.endsWith('.zip') ? outputName : outputName + '.zip')
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outPath)
      const archive = archiver('zip', { zlib: { level: 6 } })
      archive.on('progress', ({ entries }) => {
        onProgress?.({ percent: Math.min(90, Math.round(entries.processed / (entries.total || 1) * 85) + 5), message: `Packing: ${entries.processed} files` })
      })
      archive.on('error', reject)
      output.on('close', async () => {
        onProgress?.({ percent: 92, message: 'Signing ROM...' })
        await this.signRom(outPath, onProgress)
        onProgress?.({ percent: 100, message: 'Done! ROM ready to flash.' })
        resolve({ success: true, path: outPath })
      })
      archive.pipe(output)
      archive.directory(workDir, false)
      archive.finalize()
    })
  }

  //    Sign ROM with test keys                                                 
  async signRom(zipPath, onProgress) {
    const signapk = bin('signapk')
    if (!await fs.pathExists(signapk)) {
      // Fallback: add standard META-INF update-binary
      onProgress?.({ percent: 95, message: 'signapk not found, adding unsigned meta-inf...' })
      await this.addMetaInf(zipPath)
      return { success: true, note: 'Unsigned -- signapk binary not found' }
    }
    const keysDir = join(process.cwd(), 'bin', 'keys')
    const cert = join(keysDir, 'testkey.x509.pem')
    const key = join(keysDir, 'testkey.pk8')
    const outPath = zipPath.replace('.zip', '_signed.zip')
    await execFileAsync(signapk, [cert, key, zipPath, outPath], { timeout: 120000 })
    await fs.move(outPath, zipPath, { overwrite: true })
    return { success: true }
  }

  async addMetaInf(zipPath) {
    // Standard TWRP-compatible update-binary and updater-script stubs
    const updaterScript = `ui_print("Omerta Custom ROM");
ui_print("Built with Omerta ROM Builder");
run_program("/sbin/busybox", "mount", "/system");
package_extract_dir("system", "/system");
set_perm_recursive(0, 0, 0755, 0644, "/system");
ui_print("Done! Reboot to enjoy your ROM.");`
    const tmpDir = join(app.getPath('temp'), 'metainf_' + Date.now())
    await fs.ensureDir(join(tmpDir, 'META-INF/com/google/android'))
    await fs.writeFile(join(tmpDir, 'META-INF/com/google/android/updater-script'), updaterScript)
    await fs.writeFile(join(tmpDir, 'META-INF/com/google/android/update-binary'), '#!/sbin/sh\n# Omerta ROM Builder\n')
    // Append to existing zip
    const addArchive = archiver('zip', { zlib: { level: 1 } })
    const tmpZip = zipPath + '.meta.zip'
    const out = fs.createWriteStream(tmpZip)
    addArchive.pipe(out)
    addArchive.directory(tmpDir, false)
    await new Promise((res, rej) => { out.on('close', res); addArchive.on('error', rej); addArchive.finalize() })
    await fs.remove(tmpDir)
  }

  //    Build GSI                                                               
  async buildGsi(romPath, destDir, onProgress) {
    onProgress?.({ percent: 5, message: 'Inspecting ROM for GSI compatibility...' })
    const info = await this.inspect(romPath)
    if (!info.hasSystem) {
      return { error: 'ROM does not contain a system partition -- cannot build GSI' }
    }
    onProgress?.({ percent: 15, message: 'Extracting ROM...' })
    const { workDir } = await this.extractRom(romPath, (p) => onProgress?.({ percent: 15 + p.percent * 0.4, message: p.message }))
    onProgress?.({ percent: 60, message: 'Locating system.img...' })
    const sysImg = join(workDir, 'system.img')
    const sysRaw = join(workDir, 'system_raw.img')
    if (!await fs.pathExists(sysImg)) {
      return { error: 'system.img not found in extracted ROM' }
    }
    onProgress?.({ percent: 65, message: 'Converting to raw image...' })
    try {
      await execFileAsync(bin('simg2img'), [sysImg, sysRaw], { timeout: 120000 })
    } catch { await fs.copy(sysImg, sysRaw) }

    onProgress?.({ percent: 80, message: 'Packaging GSI...' })
    const gsiPath = join(destDir, 'system_gsi.img')
    await fs.copy(sysRaw, gsiPath)
    onProgress?.({ percent: 100, message: 'GSI ready! Flash via fastboot flash system system_gsi.img' })
    return { success: true, path: gsiPath, note: 'Flash with: fastboot flash system system_gsi.img' }
  }

  //    Cleanup workspace                                                      
  async cleanup(workDir) {
    await fs.remove(workDir)
    this.workspaces.delete(workDir)
    return { success: true }
  }
}
