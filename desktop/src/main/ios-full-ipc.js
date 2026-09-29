import { ForceTrust, KeychainExtractor, iOSSyslog, iOSAppManager, iOSFileManager, iOSSystemTools, iOSNetworkTools } from './core/ios-full.js'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'

const trust    = new ForceTrust()
const keychain = new KeychainExtractor()
const syslog   = new iOSSyslog()
const appMgr   = new iOSAppManager()
const fileMgr  = new iOSFileManager()
const sysTool  = new iOSSystemTools()
const netTool  = new iOSNetworkTools()

export function registeriOSFullHandlers(ipcMain, dialog, shell, mainWindow, iosCore) {
  function send(ch, data) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data)
  }

  //    Force Trust                                                          
  ipcMain.handle('ios:forcetrust:pair',    (_, a) => trust.pair(a?.udid))
  ipcMain.handle('ios:forcetrust:validate',(_, a) => trust.validate(a?.udid))
  ipcMain.handle('ios:forcetrust:list',    ()     => trust.listPairingRecords())
  ipcMain.handle('ios:forcetrust:export',  async (_, a) => {
    const { filePaths: [destDir] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!destDir) return { cancelled: true }
    return trust.exportPairingRecord(a?.udid, destDir)
  })
  ipcMain.handle('ios:forcetrust:import',  async () => {
    const { filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'Pairing Record', extensions: ['plist'] }] })
    if (!filePaths?.[0]) return { cancelled: true }
    const udid = filePaths[0].split(/[\\/]/).pop().replace('.plist','')
    return trust.importPairingRecord(filePaths[0], udid)
  })

  //    Keychain / Password Extraction                                       
  ipcMain.handle('ios:keychain:backup', async (_, a) => {
    const { filePaths: [destDir] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!destDir) return { cancelled: true }
    return keychain.extractViaBackup(a?.udid, destDir)
  })
  ipcMain.handle('ios:keychain:jailbroken', async (_, a) => {
    const destDir = join(app.getPath('userData'), 'ios_keychain')
    return keychain.extractJailbroken(a?.udid, p => send('ios:keychain:progress', p))
  })
  ipcMain.handle('ios:keychain:summarize', async (_, a) => {
    return keychain.summarizeKeychain(a.dbPath)
  })
  ipcMain.handle('ios:keychain:open-dir', () => {
    const dir = join(app.getPath('userData'), 'ios_keychain')
    fs.ensureDirSync(dir); shell.openPath(dir)
    return { success: true, path: dir }
  })

  //    Syslog                                                                
  
  
  ipcMain.handle('ios:syslog:snapshot', (_, a) => syslog.getSnapshot(a?.udid, a?.lines || 300))
  ipcMain.handle('ios:syslog:save',     async (_, a) => {
    const { filePath } = await dialog.showSaveDialog({ defaultPath: `ios_syslog_${Date.now()}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (!filePath) return { cancelled: true }
    return syslog.saveToDisk(a?.udid, filePath)
  })

  //    App Manager                                                           
  ipcMain.handle('ios:apps:list',      (_, a) => appMgr.list(a?.udid))
  ipcMain.handle('ios:apps:install',   async (_, a) => {
    let ipaPath = a?.ipaPath
    if (!ipaPath) {
      const { filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'IPA', extensions: ['ipa'] }] })
      if (!filePaths?.[0]) return { cancelled: true }
      ipaPath = filePaths[0]
    }
    return appMgr.install(a?.udid, ipaPath, p => send('ios:apps:progress', p))
  })
  

  //    File Manager                                                          
  ipcMain.handle('ios:files:list', (_, a) => fileMgr.list(a?.udid, a?.path || '/'))
  ipcMain.handle('ios:files:pull', async (_, a) => {
    const { filePaths: [destDir] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!destDir) return { cancelled: true }
    return fileMgr.pull(a?.udid, a.remotePath, destDir, p => send('ios:files:progress', p))
  })
  ipcMain.handle('ios:files:push', async (_, a) => {
    const { filePaths } = await dialog.showOpenDialog()
    if (!filePaths?.[0]) return { cancelled: true }
    return fileMgr.push(a?.udid, filePaths[0], a.remotePath, p => send('ios:files:progress', p))
  })
  ipcMain.handle('ios:files:delete',  async (_, a) => {
    try { return await fileMgr.deleteFile(a?.udid, a.path) }
    catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('ios:files:photos', async (_, a) => {
    const { filePaths: [destDir] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!destDir) return { cancelled: true }
    return fileMgr.pullPhotos(a?.udid, destDir, p => send('ios:files:progress', p))
  })

  //    System Tools                                                           
  ipcMain.handle('ios:system:info',       (_, a) => iosCore ? iosCore.getDeviceInfo(a?.udid) : sysTool.getDetailedInfo(a?.udid))
  ipcMain.handle('ios:system:screenshot', async (_, a) => {
    const tmp = join(app.getPath('temp'), `ios_ss_${Date.now()}.png`)
    return sysTool.screenshot(a?.udid, tmp)
  })
  ipcMain.handle('ios:system:restart',    (_, a) => sysTool.restartDevice(a?.udid))
  ipcMain.handle('ios:system:shutdown',   (_, a) => sysTool.shutdownDevice(a?.udid))
  ipcMain.handle('ios:system:battery',    (_, a) => sysTool.getSleepWakeUsage(a?.udid))
  ipcMain.handle('ios:system:setname',    (_, a) => sysTool.setDeviceName(a?.udid, a.name))

  //    Network Tools                                                          
  ipcMain.handle('ios:net:proxy',   (_, a) => netTool.startProxy(a?.udid, a?.localPort, a?.devicePort))
  ipcMain.handle('ios:net:info',    (_, a) => netTool.getNetworkInfo(a?.udid))
}
