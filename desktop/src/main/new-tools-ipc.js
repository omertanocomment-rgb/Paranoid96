import {
  LogcatManager, ApkAnalyser, SqliteBrowser, ClipboardSync,
  HardwareDiag, WifiExtractor, CertificateManager, FridaManager,
  IntentSender, LayoutInspector, MockLocation, AppCloner, TrafficMonitor
} from './core/new-tools.js'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'

const logcat     = new LogcatManager()
const apkAnalyser= new ApkAnalyser()
const sqlBrowser = new SqliteBrowser()
const clipboard  = new ClipboardSync()
const hwDiag     = new HardwareDiag()
const wifiEx     = new WifiExtractor()
const certMgr    = new CertificateManager()
const frida      = new FridaManager()
const intents    = new IntentSender()
const layout     = new LayoutInspector()
const mockLoc    = new MockLocation()
const cloner     = new AppCloner()
const traffic    = new TrafficMonitor()

export function registerNewToolHandlers(ipcMain, dialog, mainWindow) {
  function send(ch, data) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data)
  }

  //    Logcat                                                                   
  ipcMain.handle('logcat:snapshot', (_, a) => logcat.getSnapshot(a.serial, a.lines || 500, a.level || 'V'))
  ipcMain.handle('logcat:clear', (_, a) => logcat.clear(a.serial))
  ipcMain.handle('logcat:processes', (_, a) => logcat.getRunningProcesses(a.serial))
  ipcMain.handle('logcat:save', async (_, a) => {
    const { filePath } = await dialog.showSaveDialog({ defaultPath: `logcat_${Date.now()}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (!filePath) return { cancelled: true }
    return logcat.saveToDisk(a.serial, filePath, a.lines || 5000)
  })
  ipcMain.handle('logcat:start', (_, a) => {
    const proc = logcat.start(a.serial, a.options || {})
    proc.stdout.on('data', d => {
      const parsed = logcat.parseLogs(d.toString())
      send('logcat:data', parsed)
    })
    return { started: true }
  })
  ipcMain.handle('logcat:stop', (_, a) => { logcat.stop(a.serial); return { stopped: true } })

  //    APK Analyser                                                             
  ipcMain.handle('apk:analyse', async (_, a) => {
    let apkPath = a.apkPath
    if (!apkPath) {
      const { filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'APK', extensions: ['apk', 'xapk'] }] })
      if (!filePaths?.[0]) return { cancelled: true }
      apkPath = filePaths[0]
    }
    return apkAnalyser.analyse(apkPath)
  })
  ipcMain.handle('apk:compare', async (_, a) => {
    const { filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'APK', extensions: ['apk'] }], properties: ['openFile', 'multiSelections'] })
    if (filePaths?.length !== 2) return { error: 'Select exactly 2 APK files to compare' }
    return apkAnalyser.compareVersions(filePaths[0], filePaths[1])
  })
  ipcMain.handle('apk:extract-from-device', async (_, a) => {
    // Pull APK from device then analyse
    const tmp = join(app.getPath('temp'), `omerta_pull_${Date.now()}.apk`)
    const { spawn } = await import('child_process')
    const path = await new Promise((res, rej) => {
      const proc = spawn(join(process.cwd(), 'bin', process.platform === 'win32' ? 'adb.exe' : 'adb'), ['-s', a.serial, 'shell', `pm path ${a.pkg}`])
      let out = ''
      proc.stdout.on('data', d => out += d)
      proc.on('close', () => res(out.replace('package:', '').trim()))
    })
    if (!path) return { error: 'Could not find APK path for ' + a.pkg }
    await new Promise((res, rej) => {
      const proc = spawn(join(process.cwd(), 'bin', process.platform === 'win32' ? 'adb.exe' : 'adb'), ['-s', a.serial, 'pull', path, tmp])
      proc.on('close', code => code === 0 ? res() : rej(new Error('Pull failed')))
    })
    return apkAnalyser.analyse(tmp)
  })

  //    SQLite Browser                                                            
  ipcMain.handle('sqlite:open', async (_, a) => {
    let dbPath = a.dbPath
    if (!dbPath) {
      const { filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }] })
      if (!filePaths?.[0]) return { cancelled: true }
      dbPath = filePaths[0]
    }
    return sqlBrowser.openFile(dbPath)
  })
  ipcMain.handle('sqlite:query', (_, a) => sqlBrowser.query(a.dbPath, a.sql, a.params))
  ipcMain.handle('sqlite:write', (_, a) => sqlBrowser.queryWrite(a.dbPath, a.sql))
  ipcMain.handle('sqlite:export-csv', async (_, a) => {
    const { filePath } = await dialog.showSaveDialog({ defaultPath: `${a.table}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (!filePath) return { cancelled: true }
    return sqlBrowser.exportToCsv(a.dbPath, a.table, filePath)
  })
  ipcMain.handle('sqlite:find-app-dbs', (_, a) => sqlBrowser.findAppDatabases(a.serial))
  ipcMain.handle('sqlite:pull-and-open', async (_, a) => {
    const { filePaths: [dest] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!dest) return { cancelled: true }
    return sqlBrowser.pullAndOpen(a.serial, a.remotePath, dest)
  })

  //    Clipboard sync                                                            
  ipcMain.handle('clipboard:get', (_, a) => clipboard.getDeviceClipboard(a.serial))
  ipcMain.handle('clipboard:set', (_, a) => clipboard.setDeviceClipboard(a.serial, a.text))
  ipcMain.handle('clipboard:start-sync', (_, a) => {
    clipboard.startPolling(a.serial, (text) => send('clipboard:update', { text }))
    return { started: true }
  })
  ipcMain.handle('clipboard:stop-sync', () => { clipboard.stopPolling(); return { stopped: true } })

  //    Hardware diagnostics                                                     
  ipcMain.handle('hwdiag:sensors', (_, a) => hwDiag.getSensorData(a.serial))
  ipcMain.handle('hwdiag:gpu', (_, a) => hwDiag.getGPUInfo(a.serial))
  ipcMain.handle('hwdiag:usb-speed', (_, a) => hwDiag.runUsbSpeedTest(a.serial, a.sizeMB || 5))
  ipcMain.handle('hwdiag:storage-speed', (_, a) => hwDiag.getStorageSpeed(a.serial))
  ipcMain.handle('hwdiag:display-test', (_, a) => hwDiag.testDisplayColors(a.serial))
  ipcMain.handle('hwdiag:speaker-test', (_, a) => hwDiag.testSpeaker(a.serial))

  //    Wi-Fi passwords                                                           
  ipcMain.handle('wifi:extract', (_, a) => wifiEx.extract(a.serial))
  ipcMain.handle('wifi:export', async (_, a) => {
    const { filePath } = await dialog.showSaveDialog({ defaultPath: 'wifi_passwords.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (!filePath) return { cancelled: true }
    return wifiEx.exportToCsv(a.networks, filePath)
  })

  //    Certificate manager                                                       
  ipcMain.handle('certs:list-user', (_, a) => certMgr.listUserCerts(a.serial))
  ipcMain.handle('certs:list-system', (_, a) => certMgr.listSystemCerts(a.serial))
  ipcMain.handle('certs:install', async (_, a) => {
    let certPath = a.certPath
    if (!certPath) {
      const { filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'Certificate', extensions: ['pem', 'crt', 'cer', 'der'] }] })
      if (!filePaths?.[0]) return { cancelled: true }
      certPath = filePaths[0]
    }
    return certMgr.installUserCert(a.serial, certPath)
  })
  ipcMain.handle('certs:remove', (_, a) => certMgr.removeCert(a.serial, a.certFile))
  ipcMain.handle('certs:mitm-info', (_, a) => certMgr.installMitmCert(a.serial, a.type))

  //    Frida                                                                     
  ipcMain.handle('frida:available', () => frida.isAvailable())
  ipcMain.handle('frida:version', () => frida.getVersion())
  ipcMain.handle('frida:processes', (_, a) => frida.listProcesses(a.serial))
  ipcMain.handle('frida:templates', () => frida.getScriptTemplates())
  ipcMain.handle('frida:push-server', async (_, a) => {
    const { filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'frida-server', extensions: [''] }] })
    if (!filePaths?.[0]) return { cancelled: true }
    return frida.pushServer(a.serial, filePaths[0])
  })
  ipcMain.handle('frida:start-server', (_, a) => frida.startServer(a.serial))
  ipcMain.handle('frida:stop-server', (_, a) => frida.stopServer(a.serial))
  ipcMain.handle('frida:inject', async (_, a) => {
    const tmpScript = join(app.getPath('temp'), 'omerta_frida.js')
    await fs.writeFile(tmpScript, a.script)
    return frida.inject(a.serial, a.target, tmpScript, (out) => send('frida:output', out))
  })

  //    Intent sender                                                             
  ipcMain.handle('intent:send', (_, a) => intents.send(a.serial, a.intent))
  ipcMain.handle('intent:presets', () => intents.getPresets())

  //    Layout inspector                                                          
  ipcMain.handle('layout:dump', (_, a) => layout.dumpHierarchy(a.serial))
  ipcMain.handle('layout:find', (_, a) => layout.findElement(a.serial, a.text))
  ipcMain.handle('layout:screenshot', (_, a) => layout.screenshot(a.serial))

  //    Mock location                                                              
  ipcMain.handle('mockloc:enable', (_, a) => mockLoc.enable(a.serial))
  ipcMain.handle('mockloc:set', (_, a) => mockLoc.setLocation(a.serial, a.lat, a.lng, a.accuracy))
  ipcMain.handle('mockloc:stop', (_, a) => mockLoc.stopMock(a.serial))
  ipcMain.handle('mockloc:presets', () => mockLoc.getPresetLocations())

  //    App cloner                                                                 
  ipcMain.handle('clone:app', async (_, a) => {
    let apkPath = a.apkPath
    if (!apkPath) {
      const { filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'APK', extensions: ['apk'] }] })
      if (!filePaths?.[0]) return { cancelled: true }
      apkPath = filePaths[0]
    }
    return cloner.clone(apkPath, a.suffix || '2')
  })

  //    Traffic monitor                                                            
  ipcMain.handle('traffic:uid', (_, a) => traffic.getUidTraffic(a.serial))
  ipcMain.handle('traffic:connections', (_, a) => traffic.getLiveConnections(a.serial))
  ipcMain.handle('traffic:raw', (_, a) => traffic.getNetworkStats(a.serial))
}
