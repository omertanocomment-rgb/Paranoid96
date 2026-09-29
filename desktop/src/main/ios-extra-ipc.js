import {
  getDeviceDate, setDeviceDate, renameDevice, pullCrashLogs,
  mountDevDisk, listMountedImages, startPortForward, stopPortForward,
  listPortForwards, sendNotification, enableDeveloperMode,
  usbmuxStatus, checkMDM, respring, getBatteryDetail,
  udidSpooferInfo, findIpaDowngrade, generateAuditReport,
  locationServicesAudit, extractScreenTimeData, extractHealthData,
  exportNotes, listAppDocuments
} from './core/ios-extra.js'
import { join } from 'path'
import { app as ea } from 'electron'
import fs from 'fs-extra'

export function registerIOSExtraHandlers(ipcMain, dialog, shell, mainWindow) {
  function send(ch, data) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data)
  }

  ipcMain.handle('ios:date:get',           async (_, a) => { try { return await getDeviceDate(a?.udid) } catch(e) { return { success:false, error:e.message } } })
  ipcMain.handle('ios:date:set',           async (_, a) => { try { return await setDeviceDate(a?.udid, a.timestamp) } catch(e) { return { success:false, error:e.message } } })
  ipcMain.handle('ios:rename',             (_, a) => renameDevice(a?.udid, a.name))
  ipcMain.handle('ios:crash:pull',         async (_, a) => {
    const dest = a?.dest || join(ea.getPath('userData'), 'ios_crash')
    return pullCrashLogs(a?.udid, dest)
  })
  ipcMain.handle('ios:crash:open',         async (_, a) => {
    const dest = join(ea.getPath('userData'), 'ios_crash')
    await fs.ensureDir(dest)
    shell.openPath(dest)
    return { success: true, path: dest }
  })
  ipcMain.handle('ios:devdisk:list',       (_, a) => listMountedImages(a?.udid))
  ipcMain.handle('ios:devdisk:mount',      async (_, a) => {
    const { filePaths } = await dialog.showOpenDialog({ properties:['openFile'], filters:[{name:'DMG',extensions:['dmg']}] })
    if (!filePaths?.[0]) return { cancelled: true }
    const imgPath = filePaths[0]
    const sigPath = imgPath.replace('.dmg', '.dmg.signature')
    return mountDevDisk(a?.udid, imgPath, sigPath)
  })
  ipcMain.handle('ios:proxy:start',        (_, a) => startPortForward(a?.udid, a.localPort, a.devicePort))
  ipcMain.handle('ios:proxy:stop',         (_, a) => stopPortForward(a.key))
  ipcMain.handle('ios:proxy:list',         ()     => listPortForwards())
  ipcMain.handle('ios:notify:send',        (_, a) => sendNotification(a?.udid, a.bundleId, a.message, a.title))
  
  ipcMain.handle('ios:privacy:location',   (_, a) => locationServicesAudit(a?.udid))
  ipcMain.handle('ios:screentime:extract', async (_, a) => {
    const { filePaths:[dest] } = await dialog.showOpenDialog({ properties:['openDirectory'] })
    if (!dest) return { cancelled: true }
    return extractScreenTimeData(a?.udid, dest)
  })
  ipcMain.handle('ios:health:extract',     async (_, a) => {
    const { filePaths:[dest] } = await dialog.showOpenDialog({ properties:['openDirectory'] })
    if (!dest) return { cancelled: true }
    return extractHealthData(a?.udid, dest)
  })
  ipcMain.handle('ios:notes:export',       async (_, a) => {
    const { filePaths:[dest] } = await dialog.showOpenDialog({ properties:['openDirectory'] })
    if (!dest) return { cancelled: true }
    return exportNotes(a?.udid, dest)
  })
  ipcMain.handle('ios:app:documents',      (_, a) => listAppDocuments(a?.udid, a.bundleId))
}
