import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { app, dialog } from 'electron'

log.transports.file.level = 'info'
autoUpdater.logger = log
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

export function initAutoUpdater(mainWindow) {
  const send = (event, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(event, data)
    }
  }

  autoUpdater.on('checking-for-update', () => {
    send('updater:checking', {})
  })

  autoUpdater.on('update-available', (info) => {
    send('updater:available', info)
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `Omerta ${info.version} is available`,
      detail: `Current: ${app.getVersion()}\nNew: ${info.version}\n\nDownload now?`,
      buttons: ['Download', 'Later'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate()
        send('updater:downloading', {})
      }
    })
  })

  autoUpdater.on('update-not-available', () => {
    send('updater:up-to-date', { version: app.getVersion() })
  })

  autoUpdater.on('download-progress', (progress) => {
    send('updater:progress', progress)
  })

  autoUpdater.on('update-downloaded', (info) => {
    send('updater:downloaded', info)
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: `Omerta ${info.version} downloaded`,
      detail: 'Restart now to install the update?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    })
  })

  autoUpdater.on('error', (err) => {
    log.error('AutoUpdater error:', err)
    send('updater:error', { message: err.message })
  })

  // Check for updates 30 seconds after launch, then every 4 hours
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(e => log.warn('Update check failed:', e.message))
  }, 30000)

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(e => log.warn('Update check failed:', e.message))
  }, 4 * 60 * 60 * 1000)

  return {
    checkNow: () => autoUpdater.checkForUpdates(),
    download: () => autoUpdater.downloadUpdate(),
    install: () => autoUpdater.quitAndInstall()
  }
}
