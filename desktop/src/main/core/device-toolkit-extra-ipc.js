// ── Extra Device Toolkit ───────────────────────────────────────────────────
// Android: baseband/modem partition extractor + NV/EFS backup (IMEI-safe).
// iOS:     one-click wrappers for the standard libimobiledevice CLI suite,
//          plus a thin wrapper around blacktop/ipsw for inspecting, extracting
//          from, and diffing IPSW firmware files. Matches the same
//          detect-don't-guess philosophy as ramdisk-toolkit-ipc.js: this
//          module only ever calls documented, stable subcommands of tools
//          that ship their own --help, and falls back to an embedded
//          terminal for anything long-running (downloads, live log streams).

const LIBIMOBILEDEVICE_TOOLS = [
  { id: 'ideviceinfo',        bin: 'ideviceinfo',        label: 'Device Info',       desc: 'Full property dump (model, iOS version, serial, capacity)', kind: 'oneshot', args: u => ['-u', u] },
  { id: 'idevicename',        bin: 'idevicename',        label: 'Device Name',       desc: 'Print the device\'s given name',                            kind: 'oneshot', args: u => ['-u', u] },
  { id: 'idevicedate',        bin: 'idevicedate',        label: 'Device Date/Time',  desc: 'Print the device\'s current date and time',                  kind: 'oneshot', args: u => ['-u', u] },
  { id: 'idevicepair',        bin: 'idevicepair',        label: 'Pairing Status',    desc: 'Validate whether this PC is paired with the device',         kind: 'oneshot', args: u => ['-u', u, 'validate'] },
  { id: 'ideviceinstaller',   bin: 'ideviceinstaller',   label: 'List Installed Apps', desc: 'List all installed apps with bundle IDs and versions',     kind: 'oneshot', args: u => ['-u', u, '-l'] },
  { id: 'ideviceimagemounter',bin: 'ideviceimagemounter',label: 'Mounted DDIs',      desc: 'List developer disk images currently mounted',                kind: 'oneshot', args: u => ['-u', u, '-l'] },
  { id: 'idevicediagnostics_battery', bin: 'idevicediagnostics', label: 'Battery Diagnostics', desc: 'IORegistry battery info (charge, cycle count, health)', kind: 'oneshot', args: u => ['-u', u, 'ioregistry', '-k', 'IOPMPowerSource'] },
  { id: 'idevicediagnostics_sleep', bin: 'idevicediagnostics', label: 'Put Device to Sleep', desc: 'Sends the sleep diagnostics command',                  kind: 'oneshot', args: u => ['-u', u, 'sleep'], confirm: 'Put the device to sleep now?' },
  { id: 'idevicediagnostics_shutdown', bin: 'idevicediagnostics', label: 'Shutdown Device', desc: 'Cleanly powers the device off',                          kind: 'oneshot', args: u => ['-u', u, 'shutdown'], confirm: 'Shut the device down now?' },
  { id: 'idevicescreenshot',  bin: 'idevicescreenshot',  label: 'Take Screenshot',   desc: 'Capture the current screen and save as PNG',                  kind: 'screenshot' },
  { id: 'idevicecrashreport', bin: 'idevicecrashreport', label: 'Pull Crash Reports',desc: 'Extract on-device crash logs to a folder you choose',         kind: 'crashreport' },
  { id: 'idevicesyslog',      bin: 'idevicesyslog',      label: 'Live Syslog',       desc: 'Streams the device system log - opens in an embedded terminal', kind: 'terminal' },
  { id: 'idevicenotificationproxy', bin: 'idevicenotificationproxy', label: 'Observe Notifications', desc: 'Watch for Apple system notifications (screen lock, sync, etc) - opens in terminal', kind: 'terminal', terminalArgs: u => `idevicenotificationproxy -u ${u} -o com.apple.mobile.lockstate` },
]

const CRITICAL_NV_PATHS = ['/efs', '/mnt/vendor/persist', '/persist']

export function registerDeviceToolkitExtraHandlers(ipcMain, dialog, shell, mainWindow, adb) {
  function send(ch, data) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data)
  }

  // ── Android: baseband / modem / NV toolkit ────────────────────────────────

  ipcMain.handle('nand:android:baseband-info', async (_, a) => {
    try {
      const out = await adb.shell(a.serial,
        'getprop gsm.version.baseband; echo ---; getprop gsm.version.ril-impl; echo ---; ' +
        'getprop persist.radio.multisim.config; echo ---; getprop ro.boot.hardware; echo ---; ' +
        'ls -la /dev/block/by-name/ 2>/dev/null | grep -iE "modem|efs|persist|nvdata|fsg"'
      ).catch(e => 'error: ' + e.message)
      const [baseband, ril, multisim, hw, blocks] = out.split('---').map(s => (s || '').trim())
      return { success: true, baseband, ril, multisim, hardware: hw, blocks }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('nand:android:baseband-extract', async (_, a) => {
    try {
      const fs = (await import('fs-extra')).default
      const { join } = await import('path')
      const { app } = await import('electron')
      const dest = join(app.getPath('userData'), 'baseband', `baseband_${Date.now()}`)
      await fs.ensureDir(dest)
      const targets = ['modem', 'modemst1', 'modemst2', 'fsg', 'fsc']
      const results = []
      let done = 0
      for (const part of targets) {
        send('nand:progress', { pct: Math.round((done / targets.length) * 90), msg: `Reading ${part}...` })
        try {
          const findOut = await adb.shell(a.serial, `ls -la /dev/block/by-name/${part} 2>/dev/null || ls -la /dev/block/bootdevice/by-name/${part} 2>/dev/null`)
          if (!findOut || !findOut.trim()) { results.push({ partition: part, success: false, error: 'not present on this device' }); done++; continue }
          const outFile = join(dest, `${part}.img`)
          await adb.shell(a.serial, `su -c "dd if=/dev/block/by-name/${part} of=/sdcard/_bb_${part}.img bs=4096 2>/dev/null" 2>/dev/null || dd if=/dev/block/by-name/${part} of=/sdcard/_bb_${part}.img bs=4096 2>/dev/null`)
          await adb.exec(['-s', a.serial, 'pull', `/sdcard/_bb_${part}.img`, outFile])
          await adb.shell(a.serial, `rm -f /sdcard/_bb_${part}.img`)
          const stat = await fs.stat(outFile).catch(() => null)
          results.push({ partition: part, success: !!stat, path: outFile, size: stat?.size || 0 })
        } catch (e) {
          results.push({ partition: part, success: false, error: e.message })
        }
        done++
      }
      send('nand:progress', { pct: 100, msg: 'Baseband extraction complete' })
      shell.openPath(dest)
      return { success: true, dest, results }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('nand:android:baseband-flash', async (_, a) => {
    try {
      const { filePaths } = await dialog.showOpenDialog({
        title: 'Select modem/baseband image to flash',
        filters: [{ name: 'Image', extensions: ['img', 'bin', 'mbn'] }],
        properties: ['openFile'],
      })
      if (!filePaths?.[0]) return { cancelled: true }
      const imgPath = filePaths[0]
      send('nand:progress', { pct: 10, msg: 'Pushing baseband image...' })
      await adb.exec(['-s', a.serial, 'push', imgPath, '/sdcard/_flash_modem.img'])
      send('nand:progress', { pct: 50, msg: 'Flashing modem partition (requires root)...' })
      const out = await adb.shell(a.serial, `su -c "dd if=/sdcard/_flash_modem.img of=/dev/block/by-name/modem bs=4096 && sync" 2>&1`).catch(() => '')
      await adb.shell(a.serial, 'rm -f /sdcard/_flash_modem.img')
      const flashed = out.includes('records') || out === ''
      send('nand:progress', { pct: 100, msg: flashed ? 'Baseband flashed' : 'May have failed - check device signal' })
      return { success: flashed, path: imgPath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('nand:android:nv-backup', async (_, a) => {
    try {
      const fs = (await import('fs-extra')).default
      const { join } = await import('path')
      const { app } = await import('electron')
      const dest = join(app.getPath('userData'), 'nv_backups')
      await fs.ensureDir(dest)
      const ts = Date.now()
      const results = []
      for (const remotePath of CRITICAL_NV_PATHS) {
        const exists = await adb.shell(a.serial, `su -c "[ -d ${remotePath} ] && echo yes" 2>/dev/null`).catch(() => '')
        if (!exists.includes('yes')) { results.push({ path: remotePath, success: false, error: 'not present' }); continue }
        send('nand:progress', { pct: 30, msg: `Archiving ${remotePath}...` })
        const tarName = remotePath.replace(/\//g, '_').replace(/^_/, '') + '.tar.gz'
        await adb.shell(a.serial, `su -c "tar -czf /sdcard/${tarName} ${remotePath} 2>/dev/null"`)
        const localFile = join(dest, `${ts}_${tarName}`)
        await adb.exec(['-s', a.serial, 'pull', `/sdcard/${tarName}`, localFile]).catch(() => {})
        await adb.shell(a.serial, `rm -f /sdcard/${tarName}`)
        const stat = await fs.stat(localFile).catch(() => null)
        results.push({ path: remotePath, success: !!stat, local: localFile, size: stat?.size || 0 })
      }
      send('nand:progress', { pct: 100, msg: 'NV/EFS backup complete - keep this safe, it contains your IMEI calibration data' })
      shell.openPath(dest)
      return { success: true, dest, results }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ── iOS: libimobiledevice suite ────────────────────────────────────────────

  ipcMain.handle('nand:ios:list-libimobiledevice-tools', async () => {
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(execFile)
    const isWin = process.platform === 'win32'
    const uniqueBins = [...new Set(LIBIMOBILEDEVICE_TOOLS.map(t => t.bin))]
    const installedMap = {}
    await Promise.all(uniqueBins.map(async bin => {
      try { await execAsync(isWin ? 'where' : 'which', [bin]); installedMap[bin] = true }
      catch { installedMap[bin] = false }
    }))
    return { tools: LIBIMOBILEDEVICE_TOOLS.map(t => ({ ...t, args: undefined, terminalArgs: undefined, installed: installedMap[t.bin] })) }
  })

  ipcMain.handle('nand:ios:run-libimobiledevice', async (_, a) => {
    const def = LIBIMOBILEDEVICE_TOOLS.find(t => t.id === a.id)
    if (!def) return { success: false, error: 'Unknown tool id' }

    if (def.kind === 'screenshot') {
      const { filePath } = await dialog.showSaveDialog({ defaultPath: `screenshot_${Date.now()}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] })
      if (!filePath) return { cancelled: true }
      return new Promise(resolve => {
        import('child_process').then(({ spawn }) => {
          const proc = spawn('idevicescreenshot', ['-u', a.udid, filePath])
          let err = ''
          proc.stderr?.on('data', d => err += d)
          proc.on('error', e => resolve({ success: false, error: e.code === 'ENOENT' ? 'idevicescreenshot not found' : e.message }))
          proc.on('close', code => resolve({ success: code === 0, path: filePath, output: err.trim() }))
        })
      })
    }

    if (def.kind === 'crashreport') {
      const { filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Select folder to save crash reports' })
      if (!filePaths?.[0]) return { cancelled: true }
      return new Promise(resolve => {
        import('child_process').then(({ spawn }) => {
          const proc = spawn('idevicecrashreport', ['-u', a.udid, '--extract', filePaths[0]])
          let out = ''
          proc.stdout?.on('data', d => out += d)
          proc.stderr?.on('data', d => out += d)
          proc.on('error', e => resolve({ success: false, error: e.message }))
          proc.on('close', code => resolve({ success: code === 0, dest: filePaths[0], output: out.trim() }))
        })
      })
    }

    if (def.kind === 'terminal') {
      const { app } = await import('electron')
      const { join } = await import('path')
      return { success: true, terminal: true, cwd: app.getPath('userData'), command: def.terminalArgs ? def.terminalArgs(a.udid) : `${def.bin} -u ${a.udid}` }
    }

    // oneshot
    const args = def.args(a.udid)
    return new Promise(resolve => {
      import('child_process').then(({ spawn }) => {
        const proc = spawn(def.bin, args)
        let out = ''
        proc.stdout?.on('data', d => out += d)
        proc.stderr?.on('data', d => out += d)
        proc.on('error', e => resolve({ success: false, error: e.code === 'ENOENT' ? `${def.bin} not found - install libimobiledevice tools` : e.message }))
        proc.on('close', () => resolve({ success: true, output: out.trim() || '(no output)' }))
        setTimeout(() => { try { proc.kill() } catch {}; resolve({ success: true, output: out.trim() || '(timed out)' }) }, 8000)
      })
    })
  })

  // ── iOS: IPSW (blacktop/ipsw) toolkit ───────────────────────────────────────

  ipcMain.handle('nand:ios:ipsw-run', async (_, a) => {
    return new Promise(resolve => {
      import('child_process').then(({ spawn }) => {
        const proc = spawn('ipsw', a.args || [])
        let out = ''
        proc.stdout?.on('data', d => { out += d; send('nand:progress', { pct: 50, msg: d.toString().trim().slice(0, 120) }) })
        proc.stderr?.on('data', d => out += d)
        proc.on('error', e => resolve({ success: false, error: e.code === 'ENOENT' ? 'ipsw not found - get it from https://github.com/blacktop/ipsw' : e.message }))
        proc.on('close', code => resolve({ success: code === 0, output: out.trim() || '(no output)' }))
      })
    })
  })

  ipcMain.handle('nand:ios:ipsw-pick', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      title: 'Select an IPSW file',
      filters: [{ name: 'IPSW', extensions: ['ipsw'] }],
      properties: ['openFile'],
    })
    if (!filePaths?.[0]) return { cancelled: true }
    return { success: true, path: filePaths[0] }
  })

  ipcMain.handle('nand:ios:ipsw-extract-dest', async () => {
    const { filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Select extraction output folder' })
    if (!filePaths?.[0]) return { cancelled: true }
    return { success: true, path: filePaths[0] }
  })
}
