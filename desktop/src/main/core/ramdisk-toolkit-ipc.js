// ── Ramdisk Customisation Toolkit ──────────────────────────────────────────
// Android: unpack/repack the ramdisk.cpio produced by magiskboot into a real
//          editable file tree (init.rc, fstab, build.prop, etc), edit inline,
//          repack back into ramdisk.cpio ready for `nand:android:ramdisk-repack`.
// iOS:     staging + tool-detection for building a custom SSH ramdisk. This
//          module does not implement any exploit/signing logic itself - it
//          detects which external tools (gaster, img4tool, iBoot64Patcher,
//          irecovery, tsschecker, idevicerestore, ipsw) are on PATH, stages a
//          working directory, and lets the user run each tool's own
//          documented commands in an embedded terminal (ft.terminal.create)
//          so nothing here has to guess at flags that differ per tool version.

const RAMDISK_TOOLS = [
  { id: 'gaster',          bin: 'gaster',          desc: 'checkm8 DFU exploit + pwned-mode helper (A9-A11)', repo: 'https://github.com/plooploops/gaster' },
  { id: 'img4tool',        bin: 'img4tool',        desc: 'Decrypt/inspect/repack IMG4 (im4p/im4m) components', repo: 'https://github.com/tihmstar/img4tool' },
  { id: 'iBoot64Patcher',  bin: 'iBoot64Patcher',  desc: 'Patches iBSS/iBEC signature checks for custom boot chains', repo: 'https://github.com/tihmstar/iBoot64Patcher' },
  { id: 'irecovery',       bin: 'irecovery',       desc: 'Send files / commands to a device in DFU or Recovery mode', repo: 'https://github.com/libimobiledevice/libirecovery' },
  { id: 'tsschecker',      bin: 'tsschecker',      desc: 'Fetch signing tickets (APTicket/SHSH2) needed to boot custom images', repo: 'https://github.com/1Conan/tsschecker' },
  { id: 'idevicerestore',  bin: 'idevicerestore',  desc: 'Drive a full restore/boot sequence against a connected device', repo: 'https://github.com/libimobiledevice/idevicerestore' },
  { id: 'ipsw',            bin: 'ipsw',            desc: 'blacktop/ipsw - IPSW/firmware inspection, extraction, kernelcache tools', repo: 'https://github.com/blacktop/ipsw' },
]

function isSafeChildPath(baseDir, target, path) {
  const resolved = path.resolve(baseDir, target)
  return resolved === baseDir || resolved.startsWith(baseDir + path.sep)
}

export function registerRamdiskToolkitHandlers(ipcMain, dialog, shell, mainWindow) {
  function send(ch, data) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data)
  }

  async function getWorkDirs() {
    const { app } = await import('electron')
    const { join } = await import('path')
    const workDir = join(app.getPath('userData'), 'ramdisk_work')
    const extractDir = join(workDir, 'ramdisk_extracted')
    return { workDir, extractDir }
  }

  // ── Android: cpio file-tree editor ────────────────────────────────────────

  ipcMain.handle('nand:android:ramdisk-cpio-extract', async () => {
    try {
      const fs = (await import('fs-extra')).default
      const path = await import('path')
      const { spawn } = await import('child_process')
      const { workDir, extractDir } = await getWorkDirs()
      const cpioPath = path.join(workDir, 'ramdisk.cpio')
      if (!await fs.pathExists(cpioPath)) {
        return { success: false, error: 'ramdisk.cpio not found - run "Extract from Device" first to unpack boot.img' }
      }
      await fs.remove(extractDir)
      await fs.ensureDir(extractDir)
      send('nand:progress', { pct: 20, msg: 'Unpacking ramdisk.cpio...' })
      await new Promise((resolve, reject) => {
        const proc = spawn('bash', ['-lc', `cpio -idm --no-absolute-filenames < "${cpioPath}"`], { cwd: extractDir })
        let err = ''
        proc.stderr?.on('data', d => err += d)
        proc.on('error', reject)
        proc.on('close', code => code === 0 || code === 2 /* cpio warns on some entries but still extracts */
          ? resolve() : reject(new Error(err || `cpio exited ${code}`)))
      })
      send('nand:progress', { pct: 100, msg: 'Ramdisk unpacked - ready to edit' })
      return { success: true, extractDir }
    } catch (e) {
      return { success: false, error: e.message + ' (is `cpio` installed? sudo apt install cpio)' }
    }
  })

  ipcMain.handle('nand:android:ramdisk-tree', async () => {
    try {
      const fs = (await import('fs-extra')).default
      const path = await import('path')
      const { extractDir } = await getWorkDirs()
      if (!await fs.pathExists(extractDir)) return { success: false, error: 'No extracted ramdisk yet', tree: [] }

      const tree = []
      const MAX_ENTRIES = 4000
      async function walk(dir, rel) {
        if (tree.length >= MAX_ENTRIES) return
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
          if (tree.length >= MAX_ENTRIES) return
          const relPath = rel ? `${rel}/${entry.name}` : entry.name
          const abs = path.join(dir, entry.name)
          if (entry.isSymbolicLink()) {
            tree.push({ path: relPath, type: 'symlink' })
          } else if (entry.isDirectory()) {
            tree.push({ path: relPath, type: 'dir' })
            await walk(abs, relPath)
          } else {
            const stat = await fs.stat(abs).catch(() => null)
            tree.push({ path: relPath, type: 'file', size: stat?.size || 0 })
          }
        }
      }
      await walk(extractDir, '')
      return { success: true, extractDir, tree, truncated: tree.length >= MAX_ENTRIES }
    } catch (e) {
      return { success: false, error: e.message, tree: [] }
    }
  })

  ipcMain.handle('nand:android:ramdisk-read-file', async (_, a) => {
    try {
      const fs = (await import('fs-extra')).default
      const path = await import('path')
      const { extractDir } = await getWorkDirs()
      if (!isSafeChildPath(extractDir, a.path, path)) return { success: false, error: 'Invalid path' }
      const abs = path.resolve(extractDir, a.path)
      const stat = await fs.stat(abs)
      if (stat.size > 1024 * 1024) return { success: false, error: 'File too large to edit inline (>1MB) - open the work folder instead' }
      const buf = await fs.readFile(abs)
      const isBinary = buf.subarray(0, 8000).includes(0)
      if (isBinary) return { success: true, binary: true, size: stat.size }
      return { success: true, binary: false, content: buf.toString('utf8'), size: stat.size }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('nand:android:ramdisk-write-file', async (_, a) => {
    try {
      const fs = (await import('fs-extra')).default
      const path = await import('path')
      const { extractDir } = await getWorkDirs()
      if (!isSafeChildPath(extractDir, a.path, path)) return { success: false, error: 'Invalid path' }
      const abs = path.resolve(extractDir, a.path)
      await fs.outputFile(abs, a.content ?? '', 'utf8')
      return { success: true, path: abs }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('nand:android:ramdisk-new-file', async (_, a) => {
    try {
      const fs = (await import('fs-extra')).default
      const path = await import('path')
      const { extractDir } = await getWorkDirs()
      if (!isSafeChildPath(extractDir, a.path, path)) return { success: false, error: 'Invalid path' }
      const abs = path.resolve(extractDir, a.path)
      if (await fs.pathExists(abs)) return { success: false, error: 'Already exists' }
      if (a.isDir) await fs.ensureDir(abs)
      else await fs.outputFile(abs, '', 'utf8')
      return { success: true, path: abs }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('nand:android:ramdisk-delete-file', async (_, a) => {
    try {
      const fs = (await import('fs-extra')).default
      const path = await import('path')
      const { extractDir } = await getWorkDirs()
      if (!isSafeChildPath(extractDir, a.path, path)) return { success: false, error: 'Invalid path' }
      const abs = path.resolve(extractDir, a.path)
      await fs.remove(abs)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('nand:android:ramdisk-cpio-repack', async () => {
    try {
      const fs = (await import('fs-extra')).default
      const path = await import('path')
      const { spawn } = await import('child_process')
      const { workDir, extractDir } = await getWorkDirs()
      if (!await fs.pathExists(extractDir)) return { success: false, error: 'Nothing extracted yet' }
      send('nand:progress', { pct: 30, msg: 'Repacking edited files into ramdisk.cpio...' })
      const outCpio = path.join(workDir, 'ramdisk.cpio')
      await new Promise((resolve, reject) => {
        const proc = spawn('bash', ['-lc', `find . | cpio -o -H newc > "${outCpio}"`], { cwd: extractDir })
        let err = ''
        proc.stderr?.on('data', d => err += d)
        proc.on('error', reject)
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(err || `cpio exited ${code}`)))
      })
      send('nand:progress', { pct: 100, msg: 'ramdisk.cpio rebuilt - now click "Repack to new-boot.img"' })
      return { success: true, path: outCpio }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('nand:android:ramdisk-open-extracted', async () => {
    const { extractDir } = await getWorkDirs()
    const fs = (await import('fs-extra')).default
    await fs.ensureDir(extractDir)
    shell.openPath(extractDir)
    return { success: true, path: extractDir }
  })

  // ── iOS: SSH ramdisk build staging + tool detection ───────────────────────

  ipcMain.handle('nand:ios:check-ramdisk-tools', async () => {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(execFile)
    const isWin = process.platform === 'win32'
    const results = await Promise.all(RAMDISK_TOOLS.map(async t => {
      try {
        const { stdout } = await execAsync(isWin ? 'where' : 'which', [t.bin])
        return { ...t, installed: true, path: stdout.trim().split('\n')[0] }
      } catch {
        return { ...t, installed: false, path: null }
      }
    }))
    return { tools: results }
  })

  ipcMain.handle('nand:ios:tool-help', async (_, a) => {
    return new Promise(resolve => {
      import('child_process').then(({ spawn }) => {
        const proc = spawn(a.bin, [a.flag || '--help'])
        let out = ''
        proc.stdout?.on('data', d => out += d)
        proc.stderr?.on('data', d => out += d)
        proc.on('error', e => resolve({ success: false, error: e.code === 'ENOENT' ? `${a.bin} not found on PATH` : e.message }))
        proc.on('close', () => resolve({ success: true, output: out.trim() || '(no output)' }))
        setTimeout(() => { try { proc.kill() } catch {}; resolve({ success: true, output: out.trim() || '(timed out waiting for output)' }) }, 4000)
      })
    })
  })

  ipcMain.handle('nand:ios:stage-ramdisk-build', async () => {
    const fs = (await import('fs-extra')).default
    const { app } = await import('electron')
    const { join } = await import('path')
    const dir = join(app.getPath('userData'), 'ios_ramdisk_build')
    await fs.ensureDir(dir)
    shell.openPath(dir)
    return { success: true, path: dir }
  })

  ipcMain.handle('nand:ios:import-ramdisk-source', async (_, a) => {
    const fs = (await import('fs-extra')).default
    const { app } = await import('electron')
    const { join, basename } = await import('path')
    const { filePaths } = await dialog.showOpenDialog({
      title: 'Select IPSW or ramdisk .dmg / .im4p component to stage',
      filters: [{ name: 'Firmware / Ramdisk', extensions: ['ipsw', 'dmg', 'im4p', 'img4', 'img3'] }],
      properties: ['openFile'],
    })
    if (!filePaths?.[0]) return { cancelled: true }
    const dir = join(app.getPath('userData'), 'ios_ramdisk_build')
    await fs.ensureDir(dir)
    const dest = join(dir, basename(filePaths[0]))
    await fs.copy(filePaths[0], dest)
    return { success: true, path: dest, workDir: dir }
  })
}
