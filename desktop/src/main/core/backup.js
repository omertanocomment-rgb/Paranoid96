import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import archiver from 'archiver'

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

export default class BackupCore {
  async backupAndroid(serial, destDir, options = {}, onProgress) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = join(destDir, `android_backup_${ts}`)
    await fs.ensureDir(backupDir)

    // 1. ADB backup (apps + data)
    onProgress?.({ percent: 5, message: 'Starting ADB backup...' })
    const abFile = join(backupDir, 'apps.ab')
    await new Promise((resolve, reject) => {
      const flags = ['-f', abFile, '-shared']
      if (options.allApps !== false) flags.push('-all')
      if (options.apks !== false) flags.push('-apk')
      if (!options.system) flags.push('-nosystem')
      const proc = spawn(bin('adb'), ['-s', serial, 'backup', ...flags])
      let out = ''
      proc.stdout.on('data', d => { out += d.toString() })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => {
        onProgress?.({ percent: 35, message: 'ADB backup done' })
        resolve()
      })
    })

    // 2. Pull media
    onProgress?.({ percent: 40, message: 'Pulling media files...' })
    const mediaDir = join(backupDir, 'media')
    await fs.ensureDir(mediaDir)
    const mediaPaths = ['/sdcard/DCIM', '/sdcard/Pictures', '/sdcard/Download', '/sdcard/Documents', '/sdcard/Music']
    for (let i = 0; i < mediaPaths.length; i++) {
      onProgress?.({ percent: 40 + i * 8, message: `Pulling ${mediaPaths[i]}...` })
      await new Promise((res) => {
        const proc = spawn(bin('adb'), ['-s', serial, 'pull', mediaPaths[i], mediaDir])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res())
      })
    }

    // 3. Contacts & SMS
    onProgress?.({ percent: 82, message: 'Backing up contacts & SMS...' })
    try {
      const contacts = await new Promise((res) => {
        const proc = spawn(bin('adb'), ['-s', serial, 'shell', 'content query --uri content://contacts/phones/ 2>/dev/null'])
        let out = ''
        proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res(out))
      })
      await fs.writeFile(join(backupDir, 'contacts.txt'), contacts)
    } catch {}

    // 4. ZIP everything
    onProgress?.({ percent: 88, message: 'Creating backup archive...' })
    const outPath = join(destDir, `Omerta_Android_${ts}.ftbak`)
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outPath)
      const archive = archiver('zip', { zlib: { level: 3 } })
      archive.on('progress', p => onProgress?.({ percent: 88 + Math.round(p.entries.processed / (p.entries.total || 1) * 10), message: 'Compressing...' }))
      output.on('close', resolve)
      archive.on('error', reject)
      archive.pipe(output)
      archive.directory(backupDir, false)
      archive.finalize()
    })
    await fs.remove(backupDir)
    onProgress?.({ percent: 100, message: 'Backup complete!' })
    return { success: true, path: outPath }
  }

  async backupIos(udid, destDir, options = {}, onProgress) {
    onProgress?.({ percent: 5, message: 'Starting iOS backup...' })
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('idevicebackup2'), ['backup', '--full', '--udid', udid, destDir])
      proc.stdout.on('data', d => {
        const m = d.toString().match(/(\d+(\.\d+)?)%/)
        if (m) onProgress?.({ percent: parseFloat(m[1]), message: d.toString().trim() })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0
        ? resolve({ success: true, dest: destDir })
        : reject(new Error('iOS backup failed')))
    })
  }

  async restoreAndroid(serial, backupPath, onProgress) {
    onProgress?.({ percent: 5, message: 'Restoring Android backup...' })
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'restore', backupPath])
      proc.stdout.on('data', d => {
        const m = d.toString().match(/(\d+)%/)
        if (m) onProgress?.({ percent: parseInt(m[1]), message: 'Restoring...' })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error('Restore failed')))
    })
  }

  async restoreIos(udid, backupDir, onProgress) {
    onProgress?.({ percent: 5, message: 'Restoring iOS backup...' })
    return new Promise((resolve, reject) => {
      const proc = spawn(bin('idevicebackup2'), ['restore', '--reboot', '--udid', udid, backupDir])
      proc.stdout.on('data', d => {
        const m = d.toString().match(/(\d+(\.\d+)?)%/)
        if (m) onProgress?.({ percent: parseFloat(m[1]), message: 'Restoring...' })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error('iOS restore failed')))
    })
  }
}
