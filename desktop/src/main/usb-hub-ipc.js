import { join, basename } from 'path'
import { UsbDriveDetector, OsCatalog, UsbToolManager, IsoManager } from './core/usb-hub.js'
import { app } from 'electron'
import fs from 'fs-extra'

const drives  = new UsbDriveDetector()
const catalog = new OsCatalog()
const tools   = new UsbToolManager()
const isos    = new IsoManager()

export function registerUsbHubHandlers(ipcMain, dialog, shell, mainWindow) {
  function send(ch, data) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data)
  }

  //    Drive detection                                                       
  ipcMain.handle('usb:drives:list', () => drives.list())
  ipcMain.handle('usb:drives:health', (_, a) => drives.getDriveHealth(a.device))
  ipcMain.handle('usb:drives:format', async (_, a) => {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Format', 'Cancel'],
      title: 'Format Drive',
      message: `Format ${a.device} (${a.label})?\n\nALL DATA WILL BE ERASED.`,
      defaultId: 1
    })
    if (response !== 0) return { cancelled: true }

    const plat = process.platform
    let cmd, args
    if (plat === 'win32') {
      // Use PowerShell Format-Volume
      const letter = a.letter?.replace(':','')
      cmd = 'powershell'
      args = ['-Command', `Format-Volume -DriveLetter ${letter} -FileSystem ${a.fs || 'FAT32'} -NewFileSystemLabel "${a.newLabel || 'USB'}" -Confirm:$false`]
    } else if (plat === 'darwin') {
      cmd = 'diskutil'
      args = ['eraseDisk', a.fs || 'FAT32', a.newLabel || 'USB', a.device]
    } else {
      cmd = 'mkfs.fat'
      args = ['-F', '32', '-n', a.newLabel || 'USB', a.partition || a.device]
    }

    const { spawn: spawnChild } = await import('child_process')
    return new Promise(resolve => {
      const proc = spawnChild(cmd, args)
      let out = ''
      proc.stdout?.on('data', d => out += d)
      proc.stderr?.on('data', d => out += d)
      proc.on('close', code => resolve({ success: code === 0, output: out, code }))
    })
  })

  //    OS Catalog                                                           
  ipcMain.handle('usb:catalog:all', () => catalog.getAll())
  ipcMain.handle('usb:catalog:latest', (_, a) => catalog.getLatestVersion(a.distroId))

  //    USB Tools                                                            
  ipcMain.handle('usb:tools:list', async () => {
    const toolList = tools.getTools()
    return tools.checkInstalled(toolList)
  })
  ipcMain.handle('usb:tools:download', async (_, a) => {
    const toolList = tools.getTools()
    return tools.downloadTool(a.toolId, toolList, p => send('usb:tools:progress', p))
  })
  ipcMain.handle('usb:tools:launch', async (_, a) => {
    const toolList = tools.getTools()
    return tools.launchTool(a.toolId, toolList)
  })
  ipcMain.handle('usb:tools:open-website', (_, a) => {
    const toolList = tools.getTools()
    const tool = toolList.find(t => t.id === a.toolId)
    if (tool?.websiteUrl) shell.openExternal(tool.websiteUrl)
    return { success: true }
  })

  //    ISO Manager                                                           
  ipcMain.handle('usb:iso:list', () => isos.list())
  ipcMain.handle('usb:iso:download', async (_, a) => {
    return isos.download(a.url, a.filename, p => send('usb:iso:progress', p))
  })
  ipcMain.handle('usb:iso:add', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'Disk Images', extensions: ['iso','img','img.xz','img.gz'] }],
      properties: ['openFile']
    })
    if (!filePaths?.[0]) return { cancelled: true }
    // Copy to ISO library
    const dest = join(app.getPath('userData'), 'isos', path.basename(filePaths[0]))
    await fs.copy(filePaths[0], dest)
    return { success: true, path: dest }
  })
  ipcMain.handle('usb:iso:verify', async (_, a) => isos.verify(a.isoPath, a.sha256))
  ipcMain.handle('usb:iso:delete', (_, a) => isos.delete(a.isoPath))
  ipcMain.handle('usb:iso:dir', () => isos.isoDir)
  ipcMain.handle('usb:iso:open-dir', () => { shell.openPath(isos.isoDir); return { success: true } })

  //    Ventoy integration                                                    
  ipcMain.handle('usb:ventoy:check', (_, a) => isos.getVentoyDir(a.mountPoint))
  ipcMain.handle('usb:ventoy:copy-iso', async (_, a) => {
    return isos.copyIsoToVentoy(a.isoPath, a.mountPoint, p => send('usb:iso:copy-progress', p))
  })
  ipcMain.handle('usb:ventoy:install', async (_, a) => {
    // Only works if ventoy binary is in tools dir
    const toolDir = join(app.getPath('userData'), 'tools', 'ventoy')
    const files = await fs.readdir(toolDir).catch(() => [])
    const ventoyBin = files.find(f => f.includes('Ventoy2Disk') || f.includes('ventoy.sh') || f === 'ventoy')
    if (!ventoyBin) return { error: 'Ventoy not downloaded. Use the Tools tab to download it first.' }
    const { spawn } = await import('child_process')
    const proc = spawn(join(toolDir, ventoyBin), ['-i', a.device, '-s'])
    let out = ''
    proc.stdout.on('data', d => { out += d; send('usb:ventoy:output', d.toString()) })
    return new Promise(resolve => proc.on('close', code => resolve({ success: code === 0, output: out })))
  })

  //    Write ISO to USB (dd equivalent)                                     
  ipcMain.handle('usb:write', async (_, a) => {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Write', 'Cancel'],
      title: 'Write ISO to USB',
      message: `Write ${path.basename(a.isoPath)} to ${a.device}?\n\nALL DATA ON THE DRIVE WILL BE ERASED.`,
      defaultId: 1,
      cancelId: 1
    })
    if (response !== 0) return { cancelled: true }

    const { spawn } = await import('child_process')
    const plat = process.platform
    let proc

    if (plat === 'win32') {
      // Use PowerShell to write
      const script = `
        $disk = [int]"${a.device}".Replace('\\\\.\\PhysicalDrive','')
        $iso  = "${a.isoPath.replace(/\\/g, '\\\\')}"
        Get-Partition -DiskNumber $disk | Remove-Partition -Confirm:$false -ErrorAction SilentlyContinue
        Clear-Disk -Number $disk -RemoveData -Confirm:$false -ErrorAction SilentlyContinue
        $isoBytes = [System.IO.File]::ReadAllBytes($iso)
        $drive = New-Object System.IO.FileStream("${a.device.replace(/\\/g, '\\\\')}", [System.IO.FileMode]::Open, [System.IO.FileAccess]::Write)
        $drive.Write($isoBytes, 0, $isoBytes.Length)
        $drive.Flush(); $drive.Close()
        Write-Host "Done"
      `
      proc = spawn('powershell', ['-NoProfile', '-Command', script])
    } else {
      proc = spawn('dd', [`if=${a.isoPath}`, `of=${a.device}`, 'bs=4M', 'status=progress', 'oflag=sync'])
    }

    let out = ''
    proc.stdout?.on('data', d => { out += d.toString(); send('usb:write:progress', { message: d.toString() }) })
    proc.stderr?.on('data', d => { out += d.toString(); send('usb:write:progress', { message: d.toString() }) })

    return new Promise(resolve => proc.on('close', code => resolve({ success: code === 0, output: out, code })))
  })
}

// ---- Flash Centre IPC ----
import { FlashToolRegistry, WriteEngine, FlashWizard } from './core/usb-flash-centre.js'
const flashReg   = new FlashToolRegistry()
const writeEng   = new WriteEngine()
const wizard     = new FlashWizard()

export function registerFlashCentreHandlers(ipcMain, dialog, shell, mainWindow) {
  function send(ch, d) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, d) }

  ipcMain.handle('flash:tools:list',    async () => { const t = flashReg.getAll(); return flashReg.checkInstalled(t) })
  ipcMain.handle('flash:wizard:cases',  () => wizard.getUseCases())
  ipcMain.handle('flash:wizard:keys',   () => wizard.getBootKeys())
  ipcMain.handle('flash:tool:open',     (_, a) => { if (a.url) shell.openExternal(a.url); return { success: true } })
  ipcMain.handle('flash:tool:download', async (_, a) => {
    const { filePaths:[dest] } = await dialog.showOpenDialog({ properties:['openDirectory'] })
    if (!dest) return { cancelled: true }
    const { default: axios } = await import('axios')
    const res = await axios({ url: a.url, method:'GET', responseType:'stream', timeout:300000 })
    const total = parseInt(res.headers['content-length'] || 0)
    let done = 0
    const { createWriteStream } = await import('fs')
    const pathMod = await import('path')
    const outPath = pathMod.join(dest, a.filename)
    const writer = createWriteStream(outPath)
    res.data.on('data', chunk => { done += chunk.length; if (total) send('flash:dl:progress', { percent: Math.round(done/total*100) }) })
    await new Promise((resolve, reject) => { res.data.pipe(writer); writer.on('finish', resolve); writer.on('error', reject) })
    return { success: true, path: outPath }
  })
  ipcMain.handle('flash:write', async (_, a) => {
    const { response } = await dialog.showMessageBox({ type:'warning', buttons:['Write','Cancel'], defaultId:1, cancelId:1, title:'Write ISO to USB', message:`Write ${a.isoName} to ${a.driveName}?\n\nALL DATA WILL BE ERASED.` })
    if (response !== 0) return { cancelled: true }
    return writeEng.smartWrite(a.isoPath, a.drive, p => send('flash:write:progress', p)).catch(e => ({ success: false, error: e.message }))
  })
  ipcMain.handle('flash:write:cancel', () => { writeEng.cancel(); return { success: true } })
  ipcMain.handle('flash:write:verify', async (_, a) => {
    return writeEng.verify(a.isoPath, a.device, p => send('flash:verify:progress', p)).catch(e => ({ success: false, error: e.message }))
  })
}
