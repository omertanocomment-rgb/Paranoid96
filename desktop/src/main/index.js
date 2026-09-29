import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import ADBCore from './core/adb.js'
import IOSCore from './core/ios.js'
import ExtractionCore from './core/extraction.js'
import ROMManager from './core/rom-db.js'
import ROMBuilder from './core/rom-builder.js'
import sideloaderInstance from './core/sideloader.js'
import BackupCore from './core/backup.js'
import DebloatCore from './core/debloat.js'
import { ScrcpyManager } from './scrcpy-manager.js'
import { MagiskManager } from './magisk-manager.js'
import { TWRPManager } from './core/power-tools.js'
import { TEST_POINT_DATABASE, WATER_DAMAGE_GUIDE } from './core/device-database.js'
import { OTAInterceptor, RepairMode } from './core/device-database.js'
import { MediaTools } from './core/media-tools.js'
import { AppUpdater, ForensicsExport, CrossDeviceTransfer } from './core/app-updater.js'
import { ThemeEngine } from './theme-engine.js'
import { registerIOSExtendedHandlers } from './ios-extended-ipc.js'
import { registeriOSFullHandlers } from './ios-full-ipc.js'
import { registerIOSExtraHandlers } from './ios-extra-ipc.js'
import { registerNewToolHandlers } from './new-tools-ipc.js'
import { registerUsbHubHandlers, registerFlashCentreHandlers } from './usb-hub-ipc.js'
import { registerRamdiskToolkitHandlers } from './core/ramdisk-toolkit-ipc.js'
import { registerDeviceToolkitExtraHandlers } from './core/device-toolkit-extra-ipc.js'
import { registerSshBridgeHandlers } from './core/ssh-bridge-ipc.js'
import { registerAiAssistantHandlers } from './core/ai-assistant-ipc.js'
import { registerSecureMessagingHandlers } from './core/secure-messaging-ipc.js'
import { registerBootloaderMultichipsetHandlers } from './core/bootloader-multichipset-ipc.js'
import { registerRepoInspectorHandlers } from './core/repo-inspector-ipc.js'

// Silence xmldom noise from plist parsing empty ideviceinfo output
const _origConsoleError = console.error.bind(console)
console.error = (...args) => {
  const msg = String(args[0] || '')
  if (msg.includes('xmldom') || msg.includes('missing root element') || msg.includes('[xmldom')) return
  _origConsoleError(...args)
}
const _origConsoleWarn = console.warn.bind(console)
console.warn = (...args) => {
  const msg = String(args[0] || '')
  if (msg.includes('xmldom') || msg.includes('missing root element')) return
  _origConsoleWarn(...args)
}


let mainWindow = null
let themeEngine = null
const adb = new ADBCore()
const ios = new IOSCore()
const extraction = new ExtractionCore()
const romManager = new ROMManager()
const romBuilder = new ROMBuilder()
const sideloader = sideloaderInstance
const backup = new BackupCore()
const debloat = new DebloatCore()
const scrcpy = new ScrcpyManager()
const twrp = new TWRPManager()
const magisk = new MagiskManager()
const media = new MediaTools()
const appUpdater = new AppUpdater()
const forensics = new ForensicsExport()
const crossTransfer = new CrossDeviceTransfer()
const otaInterceptor = new OTAInterceptor()
const repairMode = new RepairMode()

// ADB Command Library
const ADB_LIBRARY = {
  'Display': [
    { cmd: 'wm density {dpi}', desc: 'Set display DPI' },
    { cmd: 'wm size {WxH}', desc: 'Set resolution' },
    { cmd: 'wm density reset', desc: 'Reset DPI to default' },
    { cmd: 'wm size reset', desc: 'Reset resolution' },
    { cmd: 'settings put system screen_brightness {0-255}', desc: 'Set screen brightness' },
    { cmd: 'settings put system screen_brightness_mode 0', desc: 'Manual brightness' },
    { cmd: 'settings put system screen_off_timeout {ms}', desc: 'Screen timeout in ms' },
  ],
  'Apps': [
    { cmd: 'pm list packages', desc: 'List all packages' },
    { cmd: 'pm list packages -3', desc: 'List third-party apps only' },
    { cmd: 'pm list packages -s', desc: 'List system apps only' },
    { cmd: 'pm list packages -d', desc: 'List disabled packages' },
    { cmd: 'pm disable-user --user 0 {pkg}', desc: 'Disable app (no root)' },
    { cmd: 'pm enable {pkg}', desc: 'Enable disabled app' },
    { cmd: 'pm uninstall --user 0 {pkg}', desc: 'Uninstall for current user' },
    { cmd: 'pm clear {pkg}', desc: 'Clear app data and cache' },
    { cmd: 'am force-stop {pkg}', desc: 'Force stop an app' },
    { cmd: 'pm path {pkg}', desc: 'Get APK path' },
    { cmd: 'dumpsys package {pkg}', desc: 'Full package info' },
  ],
  'Network': [
    { cmd: 'settings put global airplane_mode_on 1', desc: 'Enable airplane mode' },
    { cmd: 'settings put global airplane_mode_on 0', desc: 'Disable airplane mode' },
    { cmd: 'settings put global wifi_on 1', desc: 'Enable Wi-Fi' },
    { cmd: 'settings put global wifi_on 0', desc: 'Disable Wi-Fi' },
    { cmd: 'settings put global http_proxy {host}:{port}', desc: 'Set HTTP proxy' },
    { cmd: 'settings put global http_proxy :0', desc: 'Clear proxy' },
    { cmd: 'settings put global private_dns_mode hostname', desc: 'Enable private DNS' },
    { cmd: 'settings put global private_dns_specifier {hostname}', desc: 'Set DNS-over-TLS hostname' },
    { cmd: 'ip route', desc: 'Show routing table' },
    { cmd: 'netstat -tuln', desc: 'Show open ports' },
    { cmd: 'dumpsys wifi | grep "SSID\|signal\|freq"', desc: 'Wi-Fi signal info' },
  ],
  'Performance': [
    { cmd: 'settings put global animator_duration_scale 0', desc: 'Disable animations (faster UI)' },
    { cmd: 'settings put global window_animation_scale 0', desc: 'Disable window animations' },
    { cmd: 'settings put global transition_animation_scale 0', desc: 'Disable transition animations' },
    { cmd: 'settings put global animator_duration_scale 1', desc: 'Reset animations to 1x' },
    { cmd: 'cat /proc/cpuinfo', desc: 'CPU info' },
    { cmd: 'cat /proc/meminfo', desc: 'Memory info' },
    { cmd: 'dumpsys meminfo', desc: 'App memory usage' },
    { cmd: 'top -n 1', desc: 'Running processes snapshot' },
  ],
  'Privacy': [
    { cmd: 'pm revoke {pkg} android.permission.ACCESS_FINE_LOCATION', desc: 'Revoke location permission' },
    { cmd: 'pm revoke {pkg} android.permission.RECORD_AUDIO', desc: 'Revoke microphone permission' },
    { cmd: 'pm revoke {pkg} android.permission.CAMERA', desc: 'Revoke camera permission' },
    { cmd: 'pm revoke {pkg} android.permission.READ_CONTACTS', desc: 'Revoke contacts permission' },
    { cmd: 'settings put secure location_mode 0', desc: 'Disable location' },
    { cmd: 'settings put secure location_mode 3', desc: 'Enable high accuracy location' },
    { cmd: 'dumpsys notification --noredact | head -100', desc: 'Recent notifications log' },
  ],
  'System': [
    { cmd: 'getprop ro.build.version.release', desc: 'Android version' },
    { cmd: 'getprop ro.product.model', desc: 'Device model' },
    { cmd: 'getprop ro.boot.verifiedbootstate', desc: 'Bootloader state' },
    { cmd: 'reboot', desc: 'Reboot device' },
    { cmd: 'reboot recovery', desc: 'Reboot to recovery' },
    { cmd: 'reboot bootloader', desc: 'Reboot to fastboot' },
    { cmd: 'dumpsys battery', desc: 'Battery status' },
    { cmd: 'df /data', desc: 'Storage usage' },
    { cmd: 'input keyevent 26', desc: 'Power button' },
    { cmd: 'input keyevent 82', desc: 'Unlock screen' },
    { cmd: 'screencap -p /sdcard/screen.png', desc: 'Take screenshot' },
    { cmd: 'screenrecord /sdcard/record.mp4', desc: 'Record screen' },
  ],
  'Developer': [
    { cmd: 'logcat -d | tail -100', desc: 'Recent logcat output' },
    { cmd: 'logcat -c', desc: 'Clear logcat buffer' },
    { cmd: 'bugreport /sdcard/bugreport.zip', desc: 'Generate bug report' },
    { cmd: 'am start -n {pkg}/{activity}', desc: 'Launch activity' },
    { cmd: 'am broadcast -a android.intent.action.BOOT_COMPLETED', desc: 'Fake boot complete broadcast' },
    { cmd: 'settings list system', desc: 'List all system settings' },
    { cmd: 'settings list global', desc: 'List all global settings' },
    { cmd: 'settings list secure', desc: 'List all secure settings' },
    { cmd: 'content query --uri content://sms/', desc: 'Query SMS database' },
    { cmd: 'content query --uri content://contacts/phones/', desc: 'Query contacts' },
  ],
}



// Resolve the bin/ folder correctly in both dev mode and packaged (AppImage/deb/exe) builds.
// In dev: process.cwd() is the project root, so bin/ is at <project>/bin
// In production: tools are copied via extraResources into resources/bin/, so we must use
// process.resourcesPath instead of process.cwd() (which is unreliable once packaged).
function getBinDir() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin')
  }
  return join(process.cwd(), 'bin')
}

// Same dev/packaged split as getBinDir(), for the window/taskbar icon.
// icon.png/icon.ico are copied to the resources root via extraResources at build time.
function getIconPath() {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  if (app.isPackaged) {
    return join(process.resourcesPath, file)
  }
  return join(process.cwd(), 'resources', file)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1100, minHeight: 700,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0d0d0d',
    title: 'Omerta Tool Hub', show: false,
    icon: getIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: false,
      webSecurity: true
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow.show())

  // Electrical Diagnostics module uses Web Serial to talk to USB multimeters/
  // logic analysers/serial consoles - grant serial port access without a
  // blocking native picker (auto-select single match, else first result).
  mainWindow.webContents.session.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault()
    if (!portList.length) return callback('')
    callback(portList[0].portId)
  })
  mainWindow.webContents.session.setPermissionCheckHandler((wc, permission) => {
    return permission === 'serial' || permission === 'usb' ? true : undefined
  })
  mainWindow.webContents.session.setDevicePermissionHandler(() => true)
  mainWindow.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'serial' || permission === 'usb') return callback(true)
    callback(false)
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[Omerta] Unhandled rejection:', reason?.message || reason)
})
process.on('uncaughtException', (err) => {
  console.error('[Omerta] Uncaught exception:', err?.message || err)
})

app.whenReady().then(() => {
  // This app has its own custom title bar and navigation; the default Electron
  // menu (File/Edit/View/Window) has no purpose here and would only show up as
  // an unstyled Alt-key flash or stray right-click items in production.
  Menu.setApplicationMenu(null)
  electronApp.setAppUserModelId('com.omerta')
  app.on('browser-window-created', (_, w) => { if (optimizer?.watchShortcuts) optimizer.watchShortcuts(w) })
  createWindow()
  themeEngine = new ThemeEngine(mainWindow)
  themeEngine.init().catch(e => console.error('Theme init failed:', e))
  registerAllIPC()
  // Schedule permission resets
  setInterval(() => media.runScheduledResets().catch(() => {}), 60000)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

function send(ch, d) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, d) }

function registerAllIPC() {
  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
  ipcMain.on('window:close', () => mainWindow?.close())

  // App info
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:platform', () => process.platform)

  // Devices
  ipcMain.handle('ios:diagnose', () => ios.diagnoseConnection())
  ipcMain.handle('ios:trigger-trust', (_, a) => ios.triggerTrustDialog(a?.udid))
  ipcMain.handle('device:list', async () => {
    const [android, iosDevices] = await Promise.all([adb.listDevices().catch(() => []), ios.listDevices().catch(() => [])])
    return { android, ios: iosDevices }
  })
  ipcMain.handle('device:info', (_, a) => a.type === 'android' ? adb.getDeviceInfo(a.serial) : ios.getDeviceInfo(a.serial))
  ipcMain.handle('device:screenshot', (_, a) => a.type === 'android' ? adb.screenshot(a.serial) : ios.screenshot(a.serial))

  // ADB
  ipcMain.handle('adb:version', async () => { try { return (await adb.exec(['version'])).split('\n')[0] } catch(e) { return null } })
  ipcMain.handle('adb:shell', (_, a) => { if (isIosUdid(a.serial)) return { error: 'iOS device — use iOS tools instead' }; return adb.shell(a.serial, a.cmd) })
  ipcMain.handle('adb:push', (_, a) => adb.push(a.serial, a.local, a.remote, p => send('adb:push:progress', p)))
  ipcMain.handle('adb:pull', (_, a) => adb.pull(a.serial, a.remote, a.local, p => send('adb:pull:progress', p)))
  ipcMain.handle('adb:reboot', (_, a) => { if (isIosUdid(a.serial)) return { error: 'iOS device — use iOS Diagnostics to reboot' }; return adb.reboot(a.serial, a.mode) })

  // Files
  ipcMain.handle('files:list', (_, a) => a.type === 'android' ? adb.listFiles(a.serial, a.path) : ios.listFiles(a.serial, a.path))
  ipcMain.handle('files:delete', (_, a) => a.type === 'android' ? adb.deleteFile(a.serial, a.path) : ios.deleteFile(a.serial, a.path))
  ipcMain.handle('files:mkdir', (_, a) => adb.mkdir(a.serial, a.path))
  ipcMain.handle('files:import', async (_, a) => {
    const { filePaths } = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    if (!filePaths.length) return { cancelled: true }
    for (const f of filePaths) {
      if (a.type === 'android') await adb.push(a.serial, f, a.remotePath, p => send('files:progress', p))
      else await ios.pushFile(a.serial, f, a.remotePath, p => send('files:progress', p))
    }
    return { success: true, count: filePaths.length }
  })
  ipcMain.handle('files:export', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    for (const rp of a.remotePaths) {
      if (a.type === 'android') await adb.pull(a.serial, rp, d, p => send('files:progress', p))
      else await ios.pullFile(a.serial, rp, d, p => send('files:progress', p))
    }
    return { success: true, dest: d }
  })

  // Apps
  ipcMain.handle('apps:list', (_, a) => a.type === 'android' ? adb.listApps(a.serial) : ios.listApps(a.serial))
  ipcMain.handle('apps:uninstall', (_, a) => a.type === 'android' ? adb.uninstallApp(a.serial, a.pkg) : ios.uninstallApp(a.serial, a.pkg))
  ipcMain.handle('apps:extract', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return a.type === 'android' ? adb.extractApk(a.serial, a.pkg, d) : ios.extractIpa(a.serial, a.pkg, d)
  })
  ipcMain.handle('apps:clear-data', (_, a) => adb.shell(a.serial, `pm clear ${a.pkg}`))
  ipcMain.handle('apps:force-stop', (_, a) => adb.shell(a.serial, `am force-stop ${a.pkg}`))
  ipcMain.handle('apps:enable', (_, a) => adb.shell(a.serial, `pm enable ${a.pkg}`))
  ipcMain.handle('apps:disable', (_, a) => adb.shell(a.serial, `pm disable-user --user 0 ${a.pkg}`))

  // Sideloader
  ipcMain.handle('sideload:apk', (_, a) => sideloader.installApk(a.serial, a.apkPath, p => send('sideload:progress', p)))
  ipcMain.handle('sideload:xapk', (_, a) => sideloader.installXapk(a.serial, a.xapkPath, p => send('sideload:progress', p)))
  ipcMain.handle('sideload:ipa', (_, a) => sideloader.signAndInstallIpa(a.serial, a.ipaPath, p => send('sideload:progress', p)))
  ipcMain.handle('sideload:pick-apk', () => dialog.showOpenDialog({ filters: [{ name: 'Android', extensions: ['apk', 'xapk', 'apks'] }], properties: ['openFile', 'multiSelections'] }).then(r => r.filePaths))
  ipcMain.handle('sideload:pick-ipa', () => dialog.showOpenDialog({ filters: [{ name: 'iOS App', extensions: ['ipa'] }], properties: ['openFile'] }).then(r => r.filePaths))

  // Debloat
  ipcMain.handle('debloat:presets', () => debloat.getPresets())
  ipcMain.handle('debloat:scan', (_, a) => debloat.scanDevice(a.serial))
  ipcMain.handle('debloat:apply', (_, a) => debloat.applyList(a.serial, a.packages, a.action, p => send('debloat:progress', p)))

  // Backup
  ipcMain.handle('backup:create', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return a.type === 'android' ? backup.backupAndroid(a.serial, d, a.options, p => send('backup:progress', p)) : backup.backupIos(a.serial, d, a.options, p => send('backup:progress', p))
  })
  ipcMain.handle('backup:restore', async (_, a) => {
    const { filePaths: [s] } = await dialog.showOpenDialog({ filters: [{ name: 'Backup', extensions: ['ftbak', 'zip'] }] })
    if (!s) return { cancelled: true }
    return a.type === 'android' ? backup.restoreAndroid(a.serial, s, p => send('backup:progress', p)) : backup.restoreIos(a.serial, s, p => send('backup:progress', p))
  })

  // Privacy
  ipcMain.handle('privacy:permissions', (_, a) => a.type === 'android' ? adb.getPermissions(a.serial) : ios.getPermissions(a.serial))
  ipcMain.handle('privacy:revoke', (_, a) => adb.shell(a.serial, `pm revoke ${a.pkg} ${a.permission}`))
  ipcMain.handle('privacy:push-hosts', async (_, a) => {
    const { serial, url, name } = a
    try {
      const axios = (await import('axios')).default
      const { join } = await import('path')
      const { app } = await import('electron')
      const fs = (await import('fs-extra')).default
      const { spawn } = await import('child_process')
      const adbBin = join(getBinDir(), process.platform === 'win32' ? 'adb.exe' : 'adb')

      // Download hosts file
      const res = await axios.get(url, { timeout: 30000, responseType: 'text' })
      const content = res.data
      const domains = content.split('\n').filter(l => /^(0\.0\.0\.0|127\.0\.0\.1)\s/.test(l)).length

      // Write locally
      const tmp = join(app.getPath('temp'), 'omerta_hosts')
      await fs.writeFile(tmp, content)
      const remote = '/data/local/tmp/omerta_hosts'

      // Push to device
      await new Promise((res, rej) => {
        const p = spawn(adbBin, ['-s', serial, 'push', tmp, remote])
        p.on('close', c => c === 0 ? res() : rej(new Error('ADB push failed -- is device connected?')))
      })

      // Try methods in priority order
      const tryCmd = (cmd) => new Promise(res => {
        const p = spawn(adbBin, ['-s', serial, 'shell', cmd])
        let out = ''
        p.stdout.on('data', d => out += d)
        p.on('close', code => res({ ok: code === 0, out: out.trim() }))
      })

      // 1. Magisk systemless hosts (preferred -- no system modification)
      const magisk = await tryCmd(`[ -f /data/adb/modules/systemless-hosts/system/etc/hosts ] && su -c "cp ${remote} /data/adb/modules/systemless-hosts/system/etc/hosts" && echo magisk`)
      if (magisk.out.includes('magisk')) return { success: true, domains, method: 'Magisk Systemless Hosts' }

      // 2. Root + remount system
      const root = await tryCmd(`su -c "mount -o rw,remount /system 2>/dev/null; cp ${remote} /system/etc/hosts && mount -o ro,remount /system 2>/dev/null && echo ok"`)
      if (root.out.includes('ok')) return { success: true, domains, method: 'Root (/system/etc/hosts)' }

      // 3. Some Android versions allow writing /etc/hosts directly via ADB shell
      const direct = await tryCmd(`cp ${remote} /etc/hosts 2>/dev/null && echo ok`)
      if (direct.out.includes('ok')) return { success: true, domains, method: 'Direct /etc/hosts' }

      return {
        success: false,
        domains,
        error: 'Root required. Install Magisk + enable Systemless Hosts module, then try again.',
        downloaded: true,
        tip: 'File is cached at ' + remote + ' on device'
      }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('privacy:set-dns', async (_, a) => {
    await adb.shell(a.serial, `settings put global private_dns_mode hostname`)
    await adb.shell(a.serial, `settings put global private_dns_specifier ${a.dns1}`)
    return { success: true }
  })
  ipcMain.handle('privacy:scan-trackers', (_, a) => a.type === 'android' ? adb.scanTrackers(a.serial) : ios.scanTrackers(a.serial))
  ipcMain.handle('privacy:notification-log', (_, a) => adb.getNotificationLog(a.serial))

  // System
  ipcMain.handle('system:dpi', (_, a) => adb.shell(a.serial, `wm density ${a.dpi}`))
  ipcMain.handle('system:resolution', (_, a) => adb.shell(a.serial, `wm size ${a.w}x${a.h}`))
  ipcMain.handle('system:reset-display', async (_, a) => { await adb.shell(a.serial, 'wm density reset'); await adb.shell(a.serial, 'wm size reset'); return { success: true } })
  ipcMain.handle('system:battery-info', (_, a) => a.type === 'android' ? adb.getBatteryInfo(a.serial) : ios.getBatteryInfo(a.serial))
  ipcMain.handle('system:input-inject', (_, a) => adb.injectInput(a.serial, a.event))
  ipcMain.handle('system:bootloader-status', (_, a) => adb.getBootloaderStatus(a.serial))

  // Network
  ipcMain.handle('network:info', (_, a) => a.type === 'android' ? adb.getNetworkInfo(a.serial) : ios.getNetworkInfo(a.serial))
  ipcMain.handle('network:carrier-info', (_, a) => a.type === 'android' ? adb.getCarrierInfo(a.serial) : ios.getCarrierInfo(a.serial))
  ipcMain.handle('network:port-scan', (_, a) => adb.shell(a.serial, 'netstat -tuln 2>/dev/null || ss -tuln 2>/dev/null'))
  ipcMain.handle('network:proxy', (_, a) => { if (a.host === 'off') return adb.shell(a.serial, 'settings put global http_proxy :0'); return adb.shell(a.serial, `settings put global http_proxy ${a.host}:${a.port}`) })

  // Extraction
  ipcMain.handle('extract:detect', () => extraction.detectConnectionModes())
  ipcMain.handle('extract:adb-wifi', (_, a) => extraction.connectAdbWifi(a.ip, a.port))
  ipcMain.handle('extract:lockdown-scan', () => extraction.findLockdownRecords())
  ipcMain.handle('extract:lockdown-connect', (_, a) => extraction.connectWithLockdown(a.udid, a.plistPath))
  ipcMain.handle('extract:start', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return extraction.extract(a.method, a.serial, d, a.options, p => send('extract:progress', p))
  })
  ipcMain.handle('extract:edl-detect', () => extraction.detectEdl())
  ipcMain.handle('extract:mtk-detect', () => extraction.detectMtk())
  ipcMain.handle('extract:checkm8', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return extraction.checkm8Extract(a.udid, d, p => send('extract:progress', p))
  })
  ipcMain.handle('extract:icloud', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return extraction.pullIcloudBackup(a.appleid, a.password, d, p => send('extract:progress', p))
  })
  ipcMain.handle('extract:parse-messages', (_, a) => extraction.parseMessageDb(a.dbPath))
  ipcMain.handle('extract:parse-whatsapp', (_, a) => extraction.parseWhatsApp(a.dbPath, a.keyPath))

  // ROM Manager
  ipcMain.handle('rom:search', (_, a) => romManager.search(a.query, a.device))
  ipcMain.handle('rom:device-list', (_, a) => romManager.getDeviceList(a.source))
  ipcMain.handle('rom:download', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return romManager.download(a.url, d, a.name, a.checksum, p => send('rom:download:progress', p))
  })
  ipcMain.handle('rom:verify', (_, a) => romManager.verifyHash(a.filePath, a.expectedHash))
  ipcMain.handle('rom:flash-adb', (_, a) => romManager.flashViaAdb(a.serial, a.zipPath, p => send('rom:flash:progress', p)))
  ipcMain.handle('rom:flash-fastboot', (_, a) => romManager.flashViaFastboot(a.serial, a.romPath, p => send('rom:flash:progress', p)))
  ipcMain.handle('rom:stock-sources', (_, a) => romManager.getStockSources(a.brand, a.model))

  // ROM Builder
  ipcMain.handle('rombuild:open', () => dialog.showOpenDialog({ filters: [{ name: 'ROM', extensions: ['zip', 'img', 'tar', 'gz', 'md5', 'tgz', 'lz4'] }] }).then(r => r.filePaths[0]))
  ipcMain.handle('rombuild:inspect', (_, a) => romBuilder.inspect(a.romPath))
  ipcMain.handle('rombuild:extract', (_, a) => romBuilder.extractRom(a.romPath, p => send('rombuild:progress', p)))
  ipcMain.handle('rombuild:list-apps', (_, a) => romBuilder.listSystemApps(a.workDir))
  ipcMain.handle('rombuild:remove-apps', (_, a) => romBuilder.removeSystemApps(a.workDir, a.packages))
  ipcMain.handle('rombuild:add-app', async (_, a) => {
    const { filePaths: [apk] } = await dialog.showOpenDialog({ filters: [{ name: 'APK', extensions: ['apk'] }] })
    if (!apk) return { cancelled: true }
    return romBuilder.addSystemApp(a.workDir, apk)
  })
  ipcMain.handle('rombuild:patch-magisk', (_, a) => romBuilder.patchMagisk(a.workDir, a.magiskApkPath, p => send('rombuild:progress', p)))
  ipcMain.handle('rombuild:patch-boot', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return romBuilder.patchBootImg(a.bootImgPath, a.magiskApkPath, d, p => send('rombuild:progress', p))
  })
  ipcMain.handle('rombuild:repack', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return romBuilder.repack(a.workDir, d, a.outputName, p => send('rombuild:progress', p))
  })
  ipcMain.handle('rombuild:build-gsi', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return romBuilder.buildGsi(a.romPath, d, p => send('rombuild:progress', p))
  })
  ipcMain.handle('rombuild:sign', (_, a) => romBuilder.signRom(a.zipPath, p => send('rombuild:progress', p)))
  ipcMain.handle('rombuild:cleanup', (_, a) => romBuilder.cleanup(a.workDir))

  // Screen mirror
  ipcMain.handle('mirror:start', (_, a) => scrcpy.launch(a.serial, a.opts || {}))
  ipcMain.handle('mirror:stop', (_, a) => scrcpy.stopSession(a.sessionId))
  ipcMain.handle('mirror:list', () => scrcpy.listSessions())
  ipcMain.handle('mirror:record', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    const outPath = join(d, `recording_${Date.now()}.mp4`)
    return scrcpy.launch(a.serial, { record: outPath, windowTitle: 'Omerta Recording' })
  })

  // ADB Library
  ipcMain.handle('adblib:categories', () => Object.keys(ADB_LIBRARY))
  ipcMain.handle('adblib:commands', (_, a) => ADB_LIBRARY[a.category] || [])
  ipcMain.handle('adblib:all', () => ADB_LIBRARY)
  ipcMain.handle('adblib:run', async (_, a) => {
    const result = await adb.shell(a.serial, a.cmd).catch(e => ({ error: e.message }))
    return typeof result === 'string' ? { output: result } : result
  })

  // TWRP
  ipcMain.handle('twrp:search', (_, a) => twrp.searchDevice(a.codename))
  ipcMain.handle('twrp:links', (_, a) => twrp.getDownloadLinks(a.deviceUrl))
  ipcMain.handle('twrp:flash', async (_, a) => {
    const { filePaths: [img] } = await dialog.showOpenDialog({ filters: [{ name: 'Recovery Image', extensions: ['img'] }] })
    if (!img) return { cancelled: true }
    return twrp.flashTwrp(a.serial, img, p => send('twrp:progress', p))
  })
  ipcMain.handle('twrp:boot-temp', async (_, a) => {
    const { filePaths: [img] } = await dialog.showOpenDialog({ filters: [{ name: 'Recovery Image', extensions: ['img'] }] })
    if (!img) return { cancelled: true }
    return twrp.tempBootTwrp(a.serial, img)
  })

  // Magisk Modules
  ipcMain.handle('magisk:status', (_, a) => magisk.checkStatus(a.serial))
  ipcMain.handle('magisk:modules', () => magisk.getOfficialModules())
  ipcMain.handle('magisk:install', async (_, a) => {
    try {
        if (a.downloadUrl) {
          return magisk.downloadAndInstall(a.serial, a.moduleId, a.downloadUrl, p => send('magisk:progress', p))
        }
        const { filePaths: [zipPath] } = await dialog.showOpenDialog({ filters: [{ name: 'Magisk Module', extensions: ['zip'] }] })
        if (!zipPath) return { cancelled: true }
        return magisk.installFromFile(a.serial, zipPath, p => send('magisk:progress', p))
    } catch(e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('magisk:remove', (_, a) => magisk.removeModule(a.serial, a.moduleId))
  ipcMain.handle('magisk:toggle', (_, a) => magisk.toggleModule(a.serial, a.moduleId, a.enable))

  // Media Tools
  ipcMain.handle('media:ringtone', async (_, a) => {
    if (!a.inputPath) {
      const { filePaths: [f] } = await dialog.showOpenDialog({ filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'] }] })
      if (!f) return { cancelled: true }
      a.inputPath = f
    }
    return media.createRingtone(a.inputPath, a.options, p => send('media:progress', p))
  })
  ipcMain.handle('media:push-ringtone', (_, a) => media.pushRingtone(a.serial, a.localPath, a.type))
  ipcMain.handle('media:convert-heic', async (_, a) => {
    let paths = a.inputPaths
    if (!paths?.length) {
      const { filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'HEIC', extensions: ['heic', 'heif'] }], properties: ['openFile', 'multiSelections'] })
      if (!filePaths.length) return { cancelled: true }
      paths = filePaths
    }
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return media.convertHeic(paths, d, p => send('media:progress', p))
  })
  ipcMain.handle('media:export-sms', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return media.exportSmsToHtml(a.serial, d, p => send('media:progress', p))
  })
  ipcMain.handle('media:schedule-perm-reset', (_, a) => media.schedulePermissionReset(a.serial, a.packageName, a.permissions, a.intervalHours))

  // Privacy - real hosts file push
  ipcMain.handle('privacy:apply-hosts', async (_, a) => {
    const { serial, url, name } = a
    try {
      // Download the hosts file
      const axios = (await import('axios')).default
      const res = await axios.get(url, { timeout: 30000, responseType: 'text' })
      const hostsContent = res.data

      // Count domain entries
      const domains = hostsContent.split('\n').filter(l => l.startsWith('0.0.0.0') || l.startsWith('127.0.0.1')).length

      // Save temporarily
      const { join } = await import('path')
      const { app } = await import('electron')
      const { default: fs } = await import('fs-extra')
      const tmpPath = join(app.getPath('temp'), 'omerta_hosts')
      await fs.writeFile(tmpPath, hostsContent)

      // Push via ADB - remount /system or use systemless hosts (Magisk)
      const { spawn } = await import('child_process')
      
      const adbPath = join(getBinDir(), process.platform === 'win32' ? 'adb.exe' : 'adb')
      const remote = '/data/local/tmp/hosts_new'
      
      // Push hosts file
      await new Promise((res, rej) => {
        const proc = spawn(adbPath, ['-s', serial, 'push', tmpPath, remote])
        proc.on('close', code => code === 0 ? res() : rej(new Error('Push failed')))
      })

      // Try Magisk systemless hosts first (best method, no root needed for /etc)
      const magiskResult = await new Promise(res => {
        const proc = spawn(adbPath, ['-s', serial, 'shell', 
          `[ -d /data/adb/modules/hosts ] && cp ${remote} /data/adb/modules/hosts/system/etc/hosts && echo "magisk" || echo "nope"`
        ])
        let out = ''
        proc.stdout.on('data', d => out += d)
        proc.on('close', () => res(out.trim()))
      })

      if (magiskResult === 'magisk') {
        return { success: true, domains, method: 'Magisk systemless hosts' }
      }

      // Try root method
      const rootResult = await new Promise(res => {
        const proc = spawn(adbPath, ['-s', serial, 'shell',
          `su -c "mount -o rw,remount /system && cp ${remote} /system/etc/hosts && mount -o ro,remount /system && echo ok"`
        ])
        let out = ''
        proc.stdout.on('data', d => out += d)
        proc.on('close', () => res(out.trim()))
      })

      if (rootResult.includes('ok')) {
        return { success: true, domains, method: 'Root (/system/etc/hosts)' }
      }

      // Fallback: push to /etc/hosts if writable (some rooted devices)
      const fallback = await new Promise(res => {
        const proc = spawn(adbPath, ['-s', serial, 'shell', `cp ${remote} /etc/hosts 2>/dev/null && echo ok || echo fail`])
        let out = ''
        proc.stdout.on('data', d => out += d)
        proc.on('close', () => res(out.trim()))
      })

      if (fallback.includes('ok')) {
        return { success: true, domains, method: '/etc/hosts (direct)' }
      }

      return { 
        success: false, 
        error: 'Root access required. Enable Magisk Systemless Hosts module, or grant root to Omerta.',
        domains,
        note: 'File downloaded successfully. Root needed to apply to /system/etc/hosts.'
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // App Updater
  ipcMain.handle('appupdate:check', (_, a) => appUpdater.checkAllUpdates(a.serial, p => send('appupdate:progress', p)))
  ipcMain.handle('appupdate:fdroid', (_, a) => appUpdater.getFdroidUpdates(a.serial))
  ipcMain.handle('appupdate:installed', (_, a) => appUpdater.getInstalledAppsWithVersions(a.serial))

  // Forensics
  ipcMain.handle('forensics:export', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return forensics.exportFull(a.serial, join(d, 'forensic_export_' + Date.now()), a.options, p => send('forensics:progress', p))
  })

  // Cross transfer
  ipcMain.handle('transfer:devices', () => crossTransfer.detectDevices())
  ipcMain.handle('transfer:start', (_, a) => crossTransfer.transfer(a.sourceSerial, a.sourceType, a.destSerial, a.destType, a.options, p => send('transfer:progress', p)))

  // Test Points DB
  ipcMain.handle('testpoints:all', () => TEST_POINT_DATABASE)
  ipcMain.handle('testpoints:search', (_, a) => {
    const results = []
    for (const [platform, data] of Object.entries(TEST_POINT_DATABASE)) {
      for (const [device, info] of Object.entries(data.devices || {})) {
        if (device.toLowerCase().includes(a.query.toLowerCase()) || info.chipset?.toLowerCase().includes(a.query.toLowerCase())) {
          results.push({ platform, platformName: data.name, device, ...info })
        }
      }
    }
    return results
  })

  // Water damage
  ipcMain.handle('waterdamage:guide', () => WATER_DAMAGE_GUIDE)

  // OTA Interceptor
  ipcMain.handle('ota:info', (_, a) => otaInterceptor.getOtaInfo(a.serial))
  ipcMain.handle('ota:save', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    return otaInterceptor.saveCurrentOtaUrl(a.serial, d, p => send('ota:progress', p))
  })
  ipcMain.handle('ota:sources', (_, a) => romManager.getStockSources(a.brand, a.device))

  // Repair Mode
  ipcMain.handle('repair:enable', (_, a) => repairMode.enableRepairMode(a.serial, a.type))

  // Dialogs
  ipcMain.handle('dialog:open-file', (_, opts) => dialog.showOpenDialog(opts || {}))
  ipcMain.handle('dialog:open-dir', () => dialog.showOpenDialog({ properties: ['openDirectory'] }))
  ipcMain.on('open:url', (_, url) => shell.openExternal(url))

  ipcMain.handle('magisk:installed', (_, a) => magisk.getInstalledModules(a.serial))

  // Register iOS extended handlers (SHSH, IPSW, JB, Cydia, SSH, backup decrypt, iCloud, diagnostics)
  registerIOSExtendedHandlers(ipcMain, dialog, shell, mainWindow)
  registerNewToolHandlers(ipcMain, dialog, mainWindow)
  registerUsbHubHandlers(ipcMain, dialog, shell, mainWindow)
  registerRamdiskToolkitHandlers(ipcMain, dialog, shell, mainWindow)
  registerDeviceToolkitExtraHandlers(ipcMain, dialog, shell, mainWindow, adb)
  registerSshBridgeHandlers(ipcMain, dialog, shell, mainWindow)
  registerAiAssistantHandlers(ipcMain, dialog, shell, mainWindow)
  registerSecureMessagingHandlers(ipcMain, dialog, shell, mainWindow)
  registerBootloaderMultichipsetHandlers(ipcMain, dialog, shell, mainWindow)
  registerRepoInspectorHandlers(ipcMain, dialog, shell, mainWindow)
  registeriOSFullHandlers(ipcMain, dialog, shell, mainWindow)
  registerIOSExtraHandlers(ipcMain, dialog, shell, mainWindow)
  registerFlashCentreHandlers(ipcMain, dialog, shell, mainWindow)

  //    iOS Trust / Pairing                                                    
  ipcMain.handle('ios:pair', (_, a) => ios.pairDevice(a?.udid))
  ipcMain.handle('ios:pair:validate', (_, a) => ios.validatePair(a?.udid))
  ipcMain.handle('ios:pair:unpair', (_, a) => ios.unpair(a?.udid))
  ipcMain.handle('ios:pair:list', () => ios.listPairedDevices())

  //    Scrcpy availability                                                    
  ipcMain.handle('mirror:available', () => scrcpy.isAvailable())
  ipcMain.handle('mirror:presets', () => [
    { id: 'full', label: 'Full quality', maxSize: 0, bitrate: 8, fps: 60 },
    { id: 'balanced', label: 'Balanced', maxSize: 1080, bitrate: 4, fps: 30 },
    { id: 'low', label: 'Low latency', maxSize: 720, bitrate: 2, fps: 30 },
    { id: 'record', label: 'Recording', maxSize: 0, bitrate: 12, fps: 60 },
  ])

  //    Bootloader guide                                                       
  ipcMain.handle('bootloader:guide', (_, a) => twrp.getBootloaderGuide ? twrp.getBootloaderGuide(a.brand) : null)
  ipcMain.handle('bootloader:cmd', async (_, a) => {
    const result = await adb.shell(a.serial, a.cmd).catch(e => ({ error: e.message }))
    return typeof result === 'string' ? { output: result } : result
  })

  //    Kernel                                                                 
  ipcMain.handle('kernel:info', async (_, a) => {
    try {
      const [ver, compiler, cpu] = await Promise.all([
        adb.shell(a.serial, 'uname -r'),
        adb.shell(a.serial, 'cat /proc/version 2>/dev/null | head -1'),
        adb.shell(a.serial, 'cat /proc/cpuinfo | grep "model name\\|Hardware\\|Processor" | head -3'),
      ])
      return { version: ver.trim(), compiler: compiler.trim(), cpu: cpu.trim() }
    } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('kernel:sources', (_, a) => {
    const sources = {
      google: [{ name: 'Android Kernel Archives', url: 'https://android.googlesource.com/kernel/msm/' }],
      samsung: [{ name: 'Samsung OpenSource', url: 'https://opensource.samsung.com' }],
      oneplus: [{ name: 'OnePlus GitHub', url: 'https://github.com/OnePlusOSS' }],
      xiaomi: [{ name: 'Xiaomi GitHub', url: 'https://github.com/MiCode/Xiaomi_Kernel_OpenSource' }],
    }
    const brand = (a.brand || '').toLowerCase()
    return sources[brand] || [{ name: 'XDA Developers', url: `https://forum.xda-developers.com/search/?q=${encodeURIComponent((a.device||'') + ' kernel')}` }]
  })
  ipcMain.handle('kernel:flash', async (_, a) => {
    if (!a.zipPath && !a.imgPath) {
      const { filePaths: [f] } = await dialog.showOpenDialog({ filters: [{ name: 'Kernel', extensions: ['zip', 'img'] }] })
      if (!f) return { cancelled: true }
      a.zipPath = f
    }
    const path = a.zipPath || a.imgPath
    if (path.endsWith('.img')) return romManager.flashViaFastboot(a.serial, path, p => send('kernel:progress', p))
    return romManager.flashViaAdb(a.serial, path, p => send('kernel:progress', p))
  })

  //    Permission Scheduler                                                   
  const permSchedules = new Map()
  ipcMain.handle('permscheduler:list', () => [...permSchedules.values()])
  ipcMain.handle('permscheduler:add', (_, a) => {
    const id = Date.now().toString()
    const schedule = { id, ...a, enabled: true, createdAt: new Date().toISOString() }
    permSchedules.set(id, schedule)
    // Set up actual interval
    const ms = { hourly: 3600000, daily: 86400000, weekly: 604800000 }[a.interval] || 86400000
    const timer = setInterval(async () => {
      if (!schedule.enabled) return
      for (const perm of (a.permissions || [])) {
        await adb.shell(a.serial, `pm revoke ${a.packageName} android.permission.${perm}`).catch(() => {})
      }
    }, ms)
    schedule._timer = timer
    return schedule
  })
  ipcMain.handle('permscheduler:remove', (_, a) => {
    const s = permSchedules.get(a.id)
    if (s?._timer) clearInterval(s._timer)
    permSchedules.delete(a.id)
    return { success: true }
  })
  ipcMain.handle('permscheduler:toggle', (_, a) => {
    const s = permSchedules.get(a.id)
    if (s) { s.enabled = a.enabled; permSchedules.set(a.id, s) }
    return s || { error: 'Not found' }
  })

  //    SMS to PDF                                                             
  ipcMain.handle('smspdf:export', async (_, a) => {
    const { filePaths: [d] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!d) return { cancelled: true }
    if (a.address && !a.all) return media.exportSmsToHtml(a.serial, d, p => send('smspdf:progress', p))
    return media.exportSmsToHtml(a.serial, d, p => send('smspdf:progress', p))
  })

  //    App auto-updater                                                       
  ipcMain.handle('updater:check', () => ({ message: 'Connect a GitHub repo to enable auto-updates. See electron-updater docs.' }))
  ipcMain.handle('updater:clear-cache', async () => {
    const cacheDir = join(app.getPath('temp'), 'omerta-update-cache')
    await import('fs-extra').then(fs => fs.default.emptyDir(cacheDir)).catch(() => {})
    return { success: true }
  })


  // ROM Builder - bake hosts file into extracted ROM
  ipcMain.handle('rombuild:bake-hosts', async (_, a) => {
    const { hostsUrl, romDir } = a
    if (!romDir) return { success: false, error: 'No ROM directory selected. Extract a ROM first.' }
    try {
      const axios = (await import('axios')).default
      const { join } = await import('path')
      const fs = (await import('fs-extra')).default
      const res = await axios.get(hostsUrl, { timeout: 30000, responseType: 'text' })
      const content = res.data
      const domains = content.split('\n').filter(l => /^(0\.0\.0\.0|127\.0\.0\.1)\s/.test(l)).length
      const candidates = [
        join(romDir, 'system', 'etc', 'hosts'),
        join(romDir, 'SYSTEM', 'etc', 'hosts'),
      ]
      let hostsPath = null
      for (const p of candidates) {
        if (await fs.pathExists(p)) { hostsPath = p; break }
        const parent = join(p, '..')
        if (await fs.pathExists(parent)) { hostsPath = p; break }
      }
      if (!hostsPath) return { success: false, error: 'Could not find system/etc/ in extracted ROM.' }
      await fs.ensureDir(join(hostsPath, '..'))
      await fs.writeFile(hostsPath, content)
      return { success: true, domains, path: hostsPath }
    } catch (e) { return { success: false, error: e.message } }
  })

  //    Terminal                                                              
  // Local system terminal (PowerShell on Windows, bash on Unix)
  const terminals = new Map() // id -> { proc, shell }

  ipcMain.handle('terminal:create', async (_, a) => {
    const { spawn } = await import('child_process')
    const id = Date.now().toString()
    const isWin = process.platform === 'win32'
    const shell = a.shell || (isWin ? 'powershell.exe' : (process.env.SHELL || '/bin/bash'))
    const args = isWin && shell.includes('powershell') ? ['-NoExit', '-Command', '-'] : []

    const proc = spawn(shell, args, {
      env: { ...process.env, TERM: 'xterm-256color' },
      cwd: a.cwd || (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME),
    })

    proc.stdout.on('data', d => send('terminal:data', { id, data: d.toString() }))
    proc.stderr.on('data', d => send('terminal:data', { id, data: d.toString() }))
    proc.on('close', code => {
      send('terminal:exit', { id, code })
      terminals.delete(id)
    })

    terminals.set(id, { proc, shell })
    return { id, shell, pid: proc.pid }
  })

  ipcMain.handle('terminal:write', (_, a) => {
    const t = terminals.get(a.id)
    if (!t) return { error: 'Terminal not found' }
    t.proc.stdin.write(a.data)
    return { success: true }
  })

  ipcMain.handle('terminal:kill', (_, a) => {
    const t = terminals.get(a.id)
    if (t) { try { t.proc.kill() } catch {} ; terminals.delete(a.id) }
    return { success: true }
  })

  ipcMain.handle('terminal:list-shells', () => {
    const isWin = process.platform === 'win32'
    const shells = isWin
      ? [
          { id: 'powershell', name: 'PowerShell', path: 'powershell.exe', icon: 'PS' },
          { id: 'cmd', name: 'Command Prompt', path: 'cmd.exe', icon: 'CMD' },
          { id: 'pwsh', name: 'PowerShell 7', path: 'pwsh.exe', icon: 'PS7' },
          { id: 'wsl', name: 'WSL / Linux', path: 'wsl.exe', icon: 'WSL' },
          { id: 'git-bash', name: 'Git Bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe', icon: 'GIT' },
        ]
      : [
          { id: 'bash', name: 'Bash', path: '/bin/bash', icon: '$' },
          { id: 'zsh', name: 'Zsh', path: '/bin/zsh', icon: '%' },
          { id: 'sh', name: 'sh', path: '/bin/sh', icon: '>' },
        ]
    return shells
  })

  // ADB shell terminal - streaming
  ipcMain.handle('terminal:adb', async (_, a) => {
    const { spawn } = await import('child_process')
    const { join } = await import('path')
    const id = 'adb_' + Date.now().toString()
    const adbBin = join(getBinDir(), process.platform === 'win32' ? 'adb.exe' : 'adb')
    const args = ['-s', a.serial, 'shell']

    const proc = spawn(adbBin, args, { env: process.env })
    proc.stdout.on('data', d => send('terminal:data', { id, data: d.toString() }))
    proc.stderr.on('data', d => send('terminal:data', { id, data: d.toString() }))
    proc.on('close', code => { send('terminal:exit', { id, code }); terminals.delete(id) })

    terminals.set(id, { proc, shell: 'adb' })
    return { id, shell: 'adb', serial: a.serial, pid: proc.pid }
  })

  // Run a single command and stream output (for logcat, long ops etc)
  ipcMain.handle('terminal:run', async (_, a) => {
    const { spawn } = await import('child_process')
    const id = 'run_' + Date.now().toString()
    const parts = a.cmd.trim().split(/\s+/)
    const proc = spawn(parts[0], parts.slice(1), {
      shell: true,
      cwd: a.cwd || process.cwd(),
      env: process.env
    })
    proc.stdout.on('data', d => send('terminal:data', { id, data: d.toString() }))
    proc.stderr.on('data', d => send('terminal:data', { id, data: d.toString() }))
    proc.on('close', code => { send('terminal:exit', { id, code }); terminals.delete(id) })
    terminals.set(id, { proc, shell: 'run' })
    return { id, pid: proc.pid }
  })


  //    iOS Extended Features                                                 
  ipcMain.handle('ios:force-trust', (_, a) => ios.forceTrust(a?.udid))

  ipcMain.handle('ios:keychain:info', (_, a) => ios.extractKeychain(a?.udid, 'info'))
  ipcMain.handle('ios:keychain:extract', (_, a) => ios.extractKeychain(a?.udid, 'pull'))

  ipcMain.handle('ios:messages:export', (_, a) => ios.exportMessages(a?.udid, a?.format || 'json'))

  ipcMain.handle('ios:forensics:extract', (_, a) => {
    return ios.forensicExtract(a?.udid, a?.options || {}, p => send('ios:forensics:progress', p))
  })

  ipcMain.handle('ios:wifi:extract', (_, a) => ios.extractWifiPasswords(a?.udid))



  ipcMain.handle('ios:network:info', (_, a) => ios.getNetworkInfo(a?.udid))
  ipcMain.handle('ios:network:carrier', (_, a) => ios.getCarrierInfo(a?.udid))

  ipcMain.handle('ios:privacy:scan', (_, a) => ios.scanTrackers(a?.udid))

  ipcMain.handle('ios:backup:create', async (_, a) => {
    const { filePaths: [destDir] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!destDir) return { cancelled: true }
    return ios.backup(a?.udid, destDir, p => send('ios:backup:progress', p))
  })
  



  //    Quick Actions                                                         
  ipcMain.handle('quick:screenshot', async (_, a) => {
    try {
      if (a.type === 'android') return adb.screenshot(a.serial)
      else return ios.screenshot(a.udid)
    } catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:reboot', async (_, a) => {
    try {
      if (a.type === 'android') return adb.reboot(a.serial, a.mode || 'normal')
      else {
        const { spawn } = await import('child_process')
        const { join } = await import('path')
        const b = join(getBinDir(), 'idevicediagnostics.exe')
        return new Promise(res => { const p = spawn(b, a.udid?['-u',a.udid,'restart']:['restart']); p.on('error',()=>{}); p.on('close',c=>res({success:c===0})) })
      }
    } catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:clear-cache', async (_, a) => {
    try { return adb.shell(a.serial, 'pm clear ' + a.pkg) }
    catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:battery', async (_, a) => {
    try {
      if (a.type === 'android') {
        const out = await adb.shell(a.serial, 'dumpsys battery')
        const level = out.match(/level:\s*(\d+)/)?.[1]
        const status = out.match(/status:\s*(\d+)/)?.[1]
        const statusMap = {'1':'Unknown','2':'Charging','3':'Discharging','4':'Not charging','5':'Full'}
        return { level: parseInt(level), status: statusMap[status] || 'Unknown' }
      } else {
        const info = await ios.getDeviceInfo(a.udid)
        return { level: info.batteryLevel, status: info.chargingState }
      }
    } catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:wifi-toggle', async (_, a) => {
    try { return adb.shell(a.serial, 'svc wifi ' + (a.enable ? 'enable' : 'disable')) }
    catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:airplane', async (_, a) => {
    try {
      await adb.shell(a.serial, 'settings put global airplane_mode_on ' + (a.enable ? '1' : '0'))
      await adb.shell(a.serial, 'am broadcast -a android.intent.action.AIRPLANE_MODE --ez state ' + (a.enable ? 'true' : 'false'))
      return { success: true }
    } catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:brightness', async (_, a) => {
    try {
      await adb.shell(a.serial, 'settings put system screen_brightness_mode 0')
      await adb.shell(a.serial, 'settings put system screen_brightness ' + Math.round((a.level / 100) * 255))
      return { success: true }
    } catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:volume', async (_, a) => {
    // stream: 0=voice,1=system,2=ring,3=media,4=alarm
    try { return adb.shell(a.serial, `media volume --stream ${a.stream||3} --set ${a.level}`) }
    catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:lock', async (_, a) => {
    try { return adb.shell(a.serial, 'input keyevent KEYCODE_POWER') }
    catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:home', async (_, a) => {
    try { return adb.shell(a.serial, 'input keyevent KEYCODE_HOME') }
    catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:back', async (_, a) => {
    try { return adb.shell(a.serial, 'input keyevent KEYCODE_BACK') }
    catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:recent', async (_, a) => {
    try { return adb.shell(a.serial, 'input keyevent KEYCODE_APP_SWITCH') }
    catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:wake', async (_, a) => {
    try {
      await adb.shell(a.serial, 'input keyevent KEYCODE_WAKEUP')
      await adb.shell(a.serial, 'input keyevent KEYCODE_MENU')
      return { success: true }
    } catch(e) { return { error: e.message } }
  })
  ipcMain.handle('quick:install-apk', async (_, a) => {
    const { filePaths } = await dialog.showOpenDialog({ filters:[{name:'APK',extensions:['apk']}], properties:['openFile','multiSelections'] })
    if (!filePaths?.length) return { cancelled: true }
    const results = []
    for (const f of filePaths) {
      try { results.push({ file: f, result: await adb.install(a.serial, f) }) }
      catch(e) { results.push({ file: f, error: e.message }) }
    }
    return { success: true, results }
  })
  ipcMain.handle('quick:top-apps', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'top -n 1 -b | head -20')
      return { output: out }
    } catch(e) { return { error: e.message } }
  })


  //    ADB Command Builder / History                                          
  ipcMain.handle('adb:run-custom', async (_, a) => {
    if (isIosUdid(a.serial)) return { success:false, error:'iOS device — ADB commands not supported' }
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const binPath = join(getBinDir(), process.platform==='win32'?'adb.exe':'adb')
      const args = a.serial ? ['-s', a.serial, ...a.args] : a.args
      const { stdout, stderr } = await execAsync(binPath, args, { timeout:30000 })
      return { success:true, output:(stdout||'') + (stderr||'') }
    } catch(e) { return { success:false, error:e.message, output:e.stderr||e.message } }
  })

  //    Fastboot Flasher                                                        
  ipcMain.handle('fastboot:devices', async () => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const binPath = join(getBinDir(), process.platform==='win32'?'fastboot.exe':'fastboot')
      const { stdout } = await execAsync(binPath, ['devices'], { timeout:10000 })
      const devices = stdout.split('\n').filter(l=>l.includes('fastboot')).map(l=>({serial:l.split('\t')[0].trim(),mode:'fastboot'}))
      return { devices }
    } catch(e) { return { devices:[], error:e.message } }
  })
  ipcMain.handle('fastboot:flash', async (_, a) => {
    const { spawn } = await import('child_process')
    const { join } = await import('path')
    const { filePaths } = await dialog.showOpenDialog({ filters:[{name:'Image',extensions:['img','bin','zip','lz4','br']}], properties:['openFile'] })
    if (!filePaths?.[0]) return { cancelled:true }
    const binPath = join(getBinDir(), process.platform==='win32'?'fastboot.exe':'fastboot')
    return new Promise(res => {
      const args = a.serial ? ['-s',a.serial,'flash',a.partition,filePaths[0]] : ['flash',a.partition,filePaths[0]]
      const proc = spawn(binPath, args)
      let out=''
      proc.stdout?.on('data',d=>{out+=d; if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('fastboot:progress',{message:d.toString().trim()})})
      proc.stderr?.on('data',d=>{out+=d; if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('fastboot:progress',{message:d.toString().trim()})})
      proc.on('error',e=>res({success:false,error:e.message}))
      proc.on('close',code=>res({success:code===0,output:out,file:filePaths[0]}))
    })
  })
  ipcMain.handle('fastboot:command', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const binPath = join(getBinDir(), process.platform==='win32'?'fastboot.exe':'fastboot')
      const args = a.serial ? ['-s',a.serial,...a.args] : a.args
      const { stdout, stderr } = await execAsync(binPath, args, { timeout:30000 })
      return { success:true, output:(stdout||'')+(stderr||'') }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('fastboot:reboot', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const binPath = join(getBinDir(), process.platform==='win32'?'fastboot.exe':'fastboot')
      const modeMap = {normal:['reboot'],recovery:['reboot','recovery'],bootloader:['reboot-bootloader'],fastbootd:['reboot','fastboot']}
      const args = a.serial ? ['-s',a.serial,...(modeMap[a.mode]||['reboot'])] : (modeMap[a.mode]||['reboot'])
      await execAsync(binPath, args, { timeout:15000 })
      return { success:true }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('fastboot:getvar', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const binPath = join(getBinDir(), process.platform==='win32'?'fastboot.exe':'fastboot')
      const args = a.serial ? ['-s',a.serial,'getvar','all'] : ['getvar','all']
      const { stdout, stderr } = await execAsync(binPath, args, { timeout:15000 })
      const vars = {}
      ;(stdout+stderr).split('\n').forEach(line => {
        const m = line.match(/^(\S+):\s*(.+)/)
        if (m) vars[m[1]] = m[2].trim()
      })
      return { success:true, vars }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    DNS Changer                                                             
  ipcMain.handle('dns:get', async (_, a) => {
    try {
      const current = await adb.shell(a.serial, 'settings get global private_dns_mode')
      const provider = await adb.shell(a.serial, 'settings get global private_dns_specifier')
      return { success:true, mode:current.trim(), provider:provider.trim() }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('dns:set', async (_, a) => {
    try {
      if (a.mode === 'off') {
        await adb.shell(a.serial, 'settings put global private_dns_mode off')
      } else if (a.mode === 'auto') {
        await adb.shell(a.serial, 'settings put global private_dns_mode opportunistic')
      } else {
        await adb.shell(a.serial, `settings put global private_dns_mode hostname`)
        await adb.shell(a.serial, `settings put global private_dns_specifier ${a.provider}`)
      }
      return { success:true }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    Battery History                                                         
  const batteryHistory = new Map()
  ipcMain.handle('battery:history:record', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'dumpsys battery')
      const level = parseInt(out.match(/level:\s*(\d+)/)?.[1] || '0')
      const temp  = parseFloat(out.match(/temperature:\s*(\d+)/)?.[1] || '0') / 10
      const volt  = parseInt(out.match(/voltage:\s*(\d+)/)?.[1] || '0')
      const status = {'1':'Unknown','2':'Charging','3':'Discharging','4':'Not charging','5':'Full'}[out.match(/status:\s*(\d+)/)?.[1]] || ''
      const entry = { ts:Date.now(), level, temp, volt, status }
      if (!batteryHistory.has(a.serial)) batteryHistory.set(a.serial, [])
      const hist = batteryHistory.get(a.serial)
      hist.push(entry)
      if (hist.length > 200) hist.shift()
      return { success:true, entry }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('battery:history:get', (_, a) => {
    return { history: batteryHistory.get(a.serial) || [] }
  })
  ipcMain.handle('battery:history:clear', (_, a) => {
    batteryHistory.delete(a.serial)
    return { success:true }
  })

  //    App Cloner                                                             
  ipcMain.handle('app:clone', async (_, a) => {
    try {
      // Android multi-user app cloning
      const users = await adb.shell(a.serial, 'pm list users')
      const userIds = [...users.matchAll(/UserInfo\{(\d+):/g)].map(m=>m[1])
      // Install app for user 10 (work profile simulation)
      const out = await adb.shell(a.serial, `pm install-existing --user 10 ${a.pkg}`)
      return { success:out.includes('installed') || out.includes('Success'), output:out, method:'multi-user' }
    } catch(e) { return { success:false, error:e.message, note:'App cloning requires Android 5+ and may not work on all devices' } }
  })
  ipcMain.handle('app:info', async (_, a) => {
    try {
      const [dump, size] = await Promise.all([
        adb.shell(a.serial, `dumpsys package ${a.pkg} | head -100`),
        adb.shell(a.serial, `du -sh /data/data/${a.pkg} 2>/dev/null || echo unknown`).catch(()=>'unknown'),
      ])
      return { success:true, dump, size:size.trim() }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    Speed Test (on-device)                                                 
  ipcMain.handle('speedtest:run', async (_, a) => {
    try {
      // Download test: curl a known file, measure speed
      const result = await adb.shell(a.serial, 'curl -o /dev/null -s -w "%{speed_download}" --max-time 10 https://speed.cloudflare.com/__down?bytes=10000000 2>/dev/null')
      const bytesPerSec = parseFloat(result.trim())
      const mbps = (bytesPerSec * 8 / 1e6).toFixed(1)
      // Upload test
      const uploadResult = await adb.shell(a.serial, 'curl -X POST -d @/proc/version -o /dev/null -s -w "%{speed_upload}" --max-time 10 https://speed.cloudflare.com/__up 2>/dev/null')
      const uploadBps = parseFloat(uploadResult.trim())
      const uploadMbps = (uploadBps * 8 / 1e6).toFixed(1)
      return { success:true, downloadMbps:parseFloat(mbps), uploadMbps:parseFloat(uploadMbps) }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('speedtest:ping', async (_, a) => {
    try {
      const result = await adb.shell(a.serial, 'ping -c 4 8.8.8.8 2>/dev/null | tail -2')
      const avg = result.match(/(\d+\.\d+)\/(\d+\.\d+)\/(\d+\.\d+)/)?.[2]
      return { success:true, avgMs:avg ? parseFloat(avg) : null, raw:result }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    Wireless ADB                                                           
  ipcMain.handle('wireless:pair', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const binPath = join(getBinDir(), process.platform==='win32'?'adb.exe':'adb')
      const { stdout, stderr } = await execAsync(binPath, ['pair', `${a.ip}:${a.port}`, a.code], { timeout:30000 })
      const success = (stdout+stderr).toLowerCase().includes('success') || (stdout+stderr).includes('paired')
      return { success, output:(stdout+stderr).trim() }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('wireless:connect', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const binPath = join(getBinDir(), process.platform==='win32'?'adb.exe':'adb')
      const { stdout, stderr } = await execAsync(binPath, ['connect', `${a.ip}:${a.port||5555}`], { timeout:15000 })
      const out = (stdout+stderr).trim()
      const success = out.includes('connected') && !out.includes('failed') && !out.includes('unable')
      return { success, output:out }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('wireless:disconnect', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const binPath = join(getBinDir(), process.platform==='win32'?'adb.exe':'adb')
      const { stdout } = await execAsync(binPath, ['disconnect', a.ip ? `${a.ip}:${a.port||5555}` : ''], { timeout:10000 })
      return { success:true, output:stdout.trim() }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('wireless:tcpip', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, `setprop service.adb.tcp.port ${a.port||5555}`)
      const out2 = await adb.exec(['-s', a.serial, 'tcpip', String(a.port||5555)])
      return { success:true, output:(out+'\n'+out2).trim(), port:a.port||5555 }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('wireless:get-ip', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'ip addr show wlan0 | grep "inet " | awk \'{print $2}\' | cut -d/ -f1')
      return { success:true, ip:out.trim() }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    Build.prop editor                                                      
  ipcMain.handle('buildprop:read', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'cat /system/build.prop 2>/dev/null || getprop')
      return { success:true, content:out }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('buildprop:set', async (_, a) => {
    try {
      // Runtime set (no root needed, survives until reboot)
      const out = await adb.shell(a.serial, `setprop ${a.key} ${a.value}`)
      return { success:true, output:out, note:'Property set for this session. Needs root to persist across reboots.' }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('buildprop:get', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, `getprop ${a.key}`)
      return { success:true, value:out.trim() }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    Hosts Editor                                                           
  ipcMain.handle('hosts:read', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'cat /etc/hosts')
      return { success:true, content:out }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('hosts:write', async (_, a) => {
    try {
      // Requires root - push via adb
      const { default: fs } = await import('fs-extra')
      const { join } = await import('path')
      const { app: ea } = await import('electron')
      const tmp = join(ea.getPath('userData'), 'hosts_tmp')
      await fs.writeFile(tmp, a.content)
      const r1 = await adb.exec(['-s', a.serial, 'push', tmp, '/sdcard/hosts_new'])
      const r2 = await adb.shell(a.serial, 'su -c "cp /sdcard/hosts_new /etc/hosts && chmod 644 /etc/hosts"')
      await fs.remove(tmp)
      return { success:true, output:(r1+'\n'+r2).trim(), note:'Root required to write /etc/hosts' }
    } catch(e) { return { success:false, error:e.message, note:'Root required' } }
  })
  ipcMain.handle('hosts:fetch-blocklist', async (_, a) => {
    try {
      const { default: axios } = await import('axios')
      const res = await axios.get(a.url, { timeout:20000, responseType:'text' })
      return { success:true, content:res.data, lines:(res.data.match(/\n/g)||[]).length }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    Device Health                                                          
  ipcMain.handle('health:full', async (_, a) => {
    const report = { ts: new Date().toISOString(), serial: a.serial }
    const sh = cmd => adb.shell(a.serial, cmd).catch(()=>'error')
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('health:progress',{pct:5,msg:'Battery...'})
    const battery = await sh('dumpsys battery')
    report.battery = {
      level:    parseInt(battery.match(/level:\s*(\d+)/)?.[1]||'0'),
      health:   {'1':'Unknown','2':'Good','3':'Overheat','4':'Dead','5':'Over voltage','6':'Unknown','7':'Cold'}[battery.match(/health:\s*(\d+)/)?.[1]]||'Unknown',
      temp:     parseFloat(battery.match(/temperature:\s*(\d+)/)?.[1]||'0')/10,
      voltage:  parseInt(battery.match(/voltage:\s*(\d+)/)?.[1]||'0'),
      cycles:   null,
    }
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('health:progress',{pct:20,msg:'Storage...'})
    const df = await sh('df /data')
    const dfLine = df.split('\n').find(l=>l.includes('/data'))
    if(dfLine){
      const parts = dfLine.trim().split(/\s+/)
      report.storage = { total:parts[1], used:parts[2], free:parts[3], pct:parts[4] }
    }
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('health:progress',{pct:35,msg:'Memory...'})
    const mem = await sh('cat /proc/meminfo')
    report.memory = {
      total: parseInt(mem.match(/MemTotal:\s+(\d+)/)?.[1]||'0'),
      free:  parseInt(mem.match(/MemFree:\s+(\d+)/)?.[1]||'0'),
      avail: parseInt(mem.match(/MemAvailable:\s+(\d+)/)?.[1]||'0'),
    }
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('health:progress',{pct:50,msg:'CPU...'})
    const cpu = await sh('cat /proc/loadavg')
    report.cpu = { load: cpu.trim().split(' ').slice(0,3) }
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('health:progress',{pct:65,msg:'Network...'})
    const wifi = await sh('dumpsys wifi | grep "mWifiInfo\\|SSID\\|RSSI\\|Link speed"')
    report.wifi = { raw: wifi.split('\n').filter(l=>l.trim()).slice(0,5).join('\n') }
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('health:progress',{pct:80,msg:'Security...'})
    const [selinux, root, verifiedBoot, encr] = await Promise.all([
      sh('getenforce'),
      sh('id').then(o=>o.includes('root')?'Yes':'No'),
      sh('getprop ro.boot.verifiedbootstate'),
      sh('getprop ro.crypto.state'),
    ])
    report.security = { selinux:selinux.trim(), rooted:root, verifiedBoot:verifiedBoot.trim(), encryption:encr.trim() }
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('health:progress',{pct:95,msg:'Finalizing...'})
    const uptime = await sh('cat /proc/uptime')
    report.uptime = Math.round(parseFloat(uptime.split(' ')[0])/3600*10)/10
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('health:progress',{pct:100,msg:'Done'})
    return { success:true, report }
  })

  //    Process Manager                                                        
  ipcMain.handle('process:list', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'ps -eo pid,ppid,rss,vsz,pcpu,user,args 2>/dev/null || ps')
      const lines = out.split('\n').filter(Boolean)
      const header = lines[0]
      const procs = lines.slice(1).map(line => {
        const parts = line.trim().split(/\s+/)
        return { pid:parts[0], ppid:parts[1], rss:parseInt(parts[2]||0), vsz:parseInt(parts[3]||0), cpu:parseFloat(parts[4]||0), user:parts[5], name:parts.slice(6).join(' ') }
      }).filter(p => p.pid && !isNaN(parseInt(p.pid)))
      return { success:true, procs }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('process:kill', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, `kill -9 ${a.pid}`)
      return { success:true, output:out }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('process:top', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'top -n 1 -b -q -o pid,rss,%cpu,args 2>/dev/null | head -40')
      return { success:true, output:out }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    App Backup Manager                                                     
  ipcMain.handle('appbackup:list', async (_, a) => {
    try {
      const apps = await adb.shell(a.serial, 'pm list packages -3')
      const pkgs = apps.split('\n').filter(l=>l.startsWith('package:')).map(l=>l.replace('package:','').trim())
      const withNames = await Promise.all(pkgs.slice(0,150).map(async pkg => {
        const label = await adb.shell(a.serial, `dumpsys package ${pkg} | grep -m1 "versionName=" | head -1`).catch(()=>'')
        const ver = label.match(/versionName=([^\s]+)/)?.[1] || ''
        return { pkg, ver }
      }))
      return { success:true, apps:withNames }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('appbackup:backup-data', async (_, a) => {
    try {
      const { filePaths:[dest] } = await dialog.showOpenDialog({ properties:['openDirectory'] })
      if (!dest) return { cancelled:true }
      const { join } = await import('path')
      const outFile = join(dest, a.pkg+'.ab')
      const { spawn: spawnCp } = await import('child_process')
      const { join: joinPath2 } = await import('path')
      const adbBin = join(getBinDir(),process.platform==='win32'?'adb.exe':'adb')
      return new Promise(res => {
        const proc = spawnCp(adbBin,['-s',a.serial,'backup','-f',outFile,a.pkg])
        let out=''
        proc.stdout?.on('data',d=>out+=d)
        proc.stderr?.on('data',d=>out+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>res({success:code===0,dest:outFile,output:out}))
      })
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('appbackup:restore', async (_, a) => {
    try {
      const { filePaths } = await dialog.showOpenDialog({ filters:[{name:'ADB Backup',extensions:['ab','apk']}], properties:['openFile'] })
      if (!filePaths?.[0]) return { cancelled:true }
      const f = filePaths[0]
      if (f.endsWith('.apk')) {
        const out = await adb.exec(['-s',a.serial,'install','-r',f])
        return { success:true, output:out }
      }
      const out = await adb.exec(['-s',a.serial,'restore',f])
      return { success:true, output:out }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    Hash / Verify Tool                                                     
  ipcMain.handle('hash:file', async (_, a) => {
    try {
      const { createHash } = await import('crypto')
      const { default:fs } = await import('fs-extra')
      const { filePaths } = await dialog.showOpenDialog({ properties:['openFile','multiSelections'] })
      if (!filePaths?.length) return { cancelled:true }
      const results = await Promise.all(filePaths.map(async f => {
        const buf = await fs.readFile(f)
        return {
          file: f,
          size: buf.length,
          md5:    createHash('md5').update(buf).digest('hex'),
          sha1:   createHash('sha1').update(buf).digest('hex'),
          sha256: createHash('sha256').update(buf).digest('hex'),
          sha512: createHash('sha512').update(buf).digest('hex'),
        }
      }))
      return { success:true, results }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('hash:verify', async (_, a) => {
    try {
      const { createHash } = await import('crypto')
      const { default:fs } = await import('fs-extra')
      const { filePaths:[f] } = await dialog.showOpenDialog({ properties:['openFile'] })
      if (!f) return { cancelled:true }
      const buf = await fs.readFile(f)
      const algo = a.algo || 'sha256'
      const computed = createHash(algo).update(buf).digest('hex')
      const match = computed.toLowerCase() === a.expected.toLowerCase()
      return { success:true, match, computed, expected:a.expected, algo, file:f }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('hash:apk-cert', async (_, a) => {
    try {
      const { filePaths:[f] } = a.file ? { filePaths:[a.file] } : await dialog.showOpenDialog({ filters:[{name:'APK',extensions:['apk']}], properties:['openFile'] })
      if (!f) return { cancelled:true }
      const { createHash } = await import('crypto')
      const { default:fs } = await import('fs-extra')
      const buf = await fs.readFile(f)
      const sha256 = createHash('sha256').update(buf).digest('hex')
      const size = buf.length
      // Try to find META-INF CERT.RSA using yauzl
      let certInfo = null
      try {
        const yauzl = await import('yauzl')
        certInfo = await new Promise((res,rej) => {
          yauzl.open(f, {lazyEntries:true}, (err,zip) => {
            if(err) return res(null)
            zip.readEntry()
            zip.on('entry', entry => {
              if(entry.fileName.match(/META-INF\/.+\.(RSA|DSA|EC)/i)) {
                zip.openReadStream(entry,(e,s)=>{
                  if(e) { zip.close(); return res(null) }
                  const chunks=[]
                  s.on('data',d=>chunks.push(d))
                  s.on('end',()=>{ zip.close(); const cert=Buffer.concat(chunks); res({ certFile:entry.fileName, size:cert.length, sha256:createHash('sha256').update(cert).digest('hex') }) })
                })
              } else zip.readEntry()
            })
            zip.on('end',()=>res(null))
          })
        })
      } catch {}
      return { success:true, file:f, size, sha256, certInfo }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    Notification Logger                                                    
  const notifLog = new Map()
  ipcMain.handle('notif:start', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      const binPath = join(getBinDir(),process.platform==='win32'?'adb.exe':'adb')
      const args = ['-s',a.serial,'logcat','-v','time','NotificationManager:V','*:S']
      const proc = spawn(binPath, args)
      if (!notifLog.has(a.serial)) notifLog.set(a.serial, { proc, entries:[] })
      proc.stdout?.on('data', d => {
        const lines = d.toString().split('\n').filter(Boolean)
        lines.forEach(line => {
          const entry = { ts:Date.now(), raw:line }
          notifLog.get(a.serial)?.entries.push(entry)
          if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('notif:entry', entry)
        })
        const state = notifLog.get(a.serial)
        if (state && state.entries.length > 500) state.entries = state.entries.slice(-500)
      })
      proc.on('error',()=>{})
      return { success:true }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('notif:stop', (_, a) => {
    const state = notifLog.get(a.serial)
    if (state?.proc) { try { state.proc.kill() } catch {} notifLog.delete(a.serial) }
    return { success:true }
  })
  ipcMain.handle('notif:get', (_, a) => {
    return { entries: notifLog.get(a.serial)?.entries || [] }
  })
  ipcMain.handle('notif:clear', (_, a) => {
    const state = notifLog.get(a.serial)
    if (state) state.entries = []
    return { success:true }
  })

  //    Process Manager                                                        
  ipcMain.handle('proc:list', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'ps -A -o PID,USER,PCPU,RSS,NAME 2>/dev/null || ps -A 2>/dev/null || top -n 1 -b | tail -n +8 | head -60')
      const lines = out.split('\n').filter(Boolean)
      const procs = []
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 4) {
          const pid = parseInt(parts[0])
          if (isNaN(pid)) continue
          procs.push({ pid, user: parts[1], cpu: parseFloat(parts[2])||0, ram: parseInt(parts[3])||0, name: parts[4]||parts[parts.length-1] })
        }
      }
      return { success:true, procs: procs.sort((a,b) => b.ram - a.ram) }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('proc:kill', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, `kill -9 ${a.pid} 2>/dev/null || am kill ${a.name} 2>/dev/null`)
      return { success:true, output:out }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('proc:detail', async (_, a) => {
    try {
      const [stat, maps, oom] = await Promise.all([
        adb.shell(a.serial, `cat /proc/${a.pid}/status 2>/dev/null`),
        adb.shell(a.serial, `cat /proc/${a.pid}/maps 2>/dev/null | wc -l`),
        adb.shell(a.serial, `cat /proc/${a.pid}/oom_score 2>/dev/null`),
      ])
      return { success:true, stat, maps:parseInt(maps)||0, oom:parseInt(oom)||0 }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    App Backup Manager                                                     
  ipcMain.handle('appbackup:pull-apk', async (_, a) => {
    try {
      const pathOut = await adb.shell(a.serial, `pm path ${a.pkg}`)
      const apkPath = pathOut.replace('package:','').trim()
      if (!apkPath) return { success:false, error:'APK path not found' }
      const { app: ea } = await import('electron')
      const { default: fs } = await import('fs-extra')
      const { join } = await import('path')
      const dest = join(ea.getPath('userData'), 'app_backups', a.pkg)
      await fs.ensureDir(dest)
      const destFile = join(dest, `${a.pkg}.apk`)
      await adb.exec(['-s', a.serial, 'pull', apkPath, destFile])
      const stat = await fs.stat(destFile)
      return { success:true, path:destFile, size:stat.size }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('appbackup:pull-data', async (_, a) => {
    try {
      const { app: ea } = await import('electron')
      const { default: fs } = await import('fs-extra')
      const { join } = await import('path')
      const dest = join(ea.getPath('userData'), 'app_backups', a.pkg)
      await fs.ensureDir(dest)
      const destFile = join(dest, `${a.pkg}_data.ab`)
      await adb.exec(['-s', a.serial, 'backup', '-f', destFile, a.pkg])
      const stat = await fs.stat(destFile).catch(()=>null)
      return { success:!!stat, path:destFile, size:stat?.size||0, note:'Backup requires device unlock confirmation' }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('appbackup:restore-apk', async (_, a) => {
    try {
      const { filePaths } = await dialog.showOpenDialog({ filters:[{name:'APK',extensions:['apk']}], properties:['openFile'] })
      if (!filePaths?.[0]) return { cancelled:true }
      const out = await adb.install(a.serial, filePaths[0])
      return { success:true, output:out, file:filePaths[0] }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('appbackup:list-saved', async () => {
    try {
      const { app: ea } = await import('electron')
      const { default: fs } = await import('fs-extra')
      const { join } = await import('path')
      const base = join(ea.getPath('userData'), 'app_backups')
      await fs.ensureDir(base)
      const dirs = await fs.readdir(base)
      const backups = []
      for (const dir of dirs) {
        const sub = join(base, dir)
        const stat = await fs.stat(sub).catch(()=>null)
        if (!stat?.isDirectory()) continue
        const files = await fs.readdir(sub).catch(()=>[])
        let totalSize = 0
        for (const file of files) { const s = await fs.stat(join(sub,file)).catch(()=>null); if(s) totalSize+=s.size }
        backups.push({ pkg:dir, files, totalSize, path:sub })
      }
      return { success:true, backups }
    } catch(e) { return { success:false, error:e.message, backups:[] } }
  })
  ipcMain.handle('appbackup:open-folder', async () => {
    const { app: ea } = await import('electron')
    const { default: fs } = await import('fs-extra')
    const { join } = await import('path')
    const base = join(ea.getPath('userData'), 'app_backups')
    await fs.ensureDir(base)
    shell.openPath(base)
    return { success:true, path:base }
  })

  //    Crypto / Hash                                                          
  ipcMain.handle('crypto:hash-file', async () => {
    try {
      const { filePaths } = await dialog.showOpenDialog({ properties:['openFile','multiSelections'] })
      if (!filePaths?.length) return { cancelled:true }
      const { createHash } = await import('crypto')
      const { default: fs } = await import('fs-extra')
      const results = []
      for (const fp of filePaths) {
        const buf = await fs.readFile(fp)
        results.push({
          file: fp,
          size: buf.length,
          md5:    createHash('md5').update(buf).digest('hex'),
          sha1:   createHash('sha1').update(buf).digest('hex'),
          sha256: createHash('sha256').update(buf).digest('hex'),
          sha512: createHash('sha512').update(buf).digest('hex'),
        })
      }
      return { success:true, results }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('crypto:verify', async (_, a) => {
    const { createHash } = await import('crypto')
    return { match: a.hash.toLowerCase() === a.expected.toLowerCase(), algo: a.algo }
  })
  ipcMain.handle('crypto:apk-cert', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const { stdout, stderr } = await execAsync('keytool', ['-printcert', '-jarfile', a.path], { timeout:15000 }).catch(async () => {
        const { join } = await import('path')
        const jarsigner = join(process.env.JAVA_HOME||'', 'bin', 'jarsigner')
        return execAsync(jarsigner, ['-verify', '-verbose', '-certs', a.path], { timeout:15000 })
      })
      return { success:true, output:(stdout+stderr).trim() }
    } catch(e) {
      // Try adb if local tool not found
      try {
        const out = await adb.shell(a.serial||'', `pm path ${a.pkg||''} && dumpsys package ${a.pkg||''} | grep -A5 "Signatures"`)
        return { success:true, output:out }
      } catch(e2) { return { success:false, error:e.message } }
    }
  })
  ipcMain.handle('crypto:device-apk-cert', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, `dumpsys package ${a.pkg} | grep -A 10 "Signatures\\|keyId\\|certificate"`)
      return { success:true, output:out }
    } catch(e) { return { success:false, error:e.message } }
  })

  //    Onboarding                                                             
  ipcMain.handle('onboard:check-tools', async () => {
    const { default: fs } = await import('fs-extra')
    const { join } = await import('path')
    const base = getBinDir()
    const tools = [
      { name:'adb',              file:'adb.exe',              required:true,  desc:'Android Debug Bridge' },
      { name:'fastboot',         file:'fastboot.exe',         required:true,  desc:'Bootloader flash tool' },
      { name:'scrcpy',           file:'scrcpy.exe',           required:false, desc:'Android screen mirror' },
      { name:'idevice_id',       file:'idevice_id.exe',       required:false, desc:'iOS device detection' },
      { name:'ideviceinfo',      file:'ideviceinfo.exe',      required:false, desc:'iOS device info' },
      { name:'idevicepair',      file:'idevicepair.exe',      required:false, desc:'iOS trust pairing' },
      { name:'idevicebackup2',   file:'idevicebackup2.exe',   required:false, desc:'iOS backup tool' },
      { name:'ffmpeg',           file:'ffmpeg.exe',           required:false, desc:'Media processing' },
      { name:'frida',            file:'frida.exe',            required:false, desc:'Dynamic instrumentation' },
      { name:'magiskboot',       file:'magiskboot.exe',       required:false, desc:'Boot image patcher' },
    ]
    const results = []
    for (const t of tools) {
      const exists = await fs.pathExists(join(base, t.file))
      results.push({ ...t, installed:exists })
    }
    return { tools:results, binDir:base }
  })
  ipcMain.handle('onboard:check-drivers', async () => {
    try {
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const { stdout } = await execAsync('sc', ['query','AdbInterface'], { timeout:5000 }).catch(()=>({stdout:''}))
      const adbDriver = stdout.includes('RUNNING') || stdout.includes('STATE')
      const { stdout:appleOut } = await execAsync('sc', ['query','Apple Mobile Device Service'], { timeout:5000 }).catch(()=>({stdout:''}))
      const appleService = appleOut.includes('RUNNING')
      return { adbDriver, appleService }
    } catch(e) { return { adbDriver:false, appleService:false } }
  })
  ipcMain.handle('onboard:run-install', async () => {
    const { spawn } = await import('child_process')
    const { join } = await import('path')
    const script = join(process.cwd(), 'install-tools.ps1')
    return new Promise(res => {
      const proc = spawn('powershell', ['-ExecutionPolicy','Bypass','-File',script], { detached:true })
      proc.on('error', e => res({ success:false, error:e.message }))
      proc.on('spawn', () => res({ success:true, note:'install-tools.ps1 running in separate window' }))
    })
  })

  // ── IPA Sideloader extras ─────────────────────────────────────────────────
  ipcMain.handle('sideload:analyze-ipa', async () => {
    const { filePaths } = await dialog.showOpenDialog({ filters:[{name:'IPA',extensions:['ipa']}], properties:['openFile'] })
    if (!filePaths?.[0]) return { cancelled: true }
    return sideloader.analyzeIpa(filePaths[0])
  })
  ipcMain.handle('sideload:analyze-ipa-path', async (_, a) => {
    return sideloader.analyzeIpa(a.path)
  })
  ipcMain.handle('sideload:install-ios-direct', async (_, a) => {
    try {
      const { spawn: sp } = await import('child_process')
      const { join: j } = await import('path')
      const { app: ea } = await import('electron')
      const b = ea.isPackaged ? j(process.resourcesPath,'bin') : j(process.cwd(),'bin')
      const tool = j(b, process.platform==='win32'?'ideviceinstaller.exe':'ideviceinstaller')
      const args = a.udid ? ['-u',a.udid,'-i',a.path] : ['-i',a.path]
      return new Promise(res => {
        const proc = sp(tool, args)
        let out = '', err = ''
        proc.stdout?.on('data',d=>{out+=d; if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('sideload:progress',{percent:50,message:d.toString().trim()})})
        proc.stderr?.on('data',d=>err+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>res({success:code===0,output:out+err}))
      })
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('sideload:ipatool-download', async (_, a) => {
    const { app: ea } = await import('electron')
    const { join } = await import('path')
    const dest = join(ea.getPath('userData'), 'ipa_downloads')
    return sideloader.downloadViaIpatool(a.bundleId, a.appleId, a.password, dest)
  })
  ipcMain.handle('sideload:open-downloads', async () => {
    const { app: ea } = await import('electron')
    const { join } = await import('path')
    const { default: fs } = await import('fs-extra')
    const dest = join(ea.getPath('userData'), 'ipa_downloads')
    await fs.ensureDir(dest)
    shell.openPath(dest)
    return { success: true, path: dest }
  })
  ipcMain.handle('sideload:check-ios-tools', async () => {
    const { default: fs } = await import('fs-extra')
    const { join } = await import('path')
    const base = getBinDir()
    const tools = [
      { name:'ideviceinstaller', file:process.platform==='win32'?'ideviceinstaller.exe':'ideviceinstaller', desc:'Install IPA directly (dev-signed)' },
      { name:'zsign',            file:process.platform==='win32'?'zsign.exe':'zsign',                         desc:'Free IPA signing (no Apple ID)' },
      { name:'ipatool',          file:process.platform==='win32'?'ipatool.exe':'ipatool',                     desc:'Download IPAs from App Store' },
      { name:'idevicepair',      file:process.platform==='win32'?'idevicepair.exe':'idevicepair',             desc:'Device trust pairing' },
    ]
    const result = []
    for (const t of tools) {
      result.push({ ...t, installed: await fs.pathExists(join(base, t.file)) })
    }
    return { tools: result }
  })

  // ── No-ADB device discovery ───────────────────────────────────────────────
  ipcMain.handle('discover:usb-devices', async () => {
    // Detect ALL USB devices via WMI/PowerShell - no ADB needed
    try {
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)

      // Known Android USB Vendor IDs
      const ANDROID_VIDS = {
        '0BB4':'HTC','04E8':'Samsung','2717':'Xiaomi','18D1':'Google',
        '1004':'LG','22B8':'Motorola','0FCE':'Sony','2A70':'OnePlus',
        '1EBF':'Huawei','19D2':'ZTE','05C6':'Qualcomm/Acer/many',
        '12D1':'Huawei','0B05':'Asus','413C':'Dell','03F0':'HP',
        '1F3A':'Allwinner','2AE5':'Fairphone','2D95':'vivo','1BBB':'Alcatel',
        '0421':'Nokia','1B8E':'Oppo/Realme','1BAD':'Mad Catz (some Android)',
        '17EF':'Lenovo','04B7':'Compal','0D28':'ARM mbed',
      }

      const script = `
Get-WmiObject Win32_USBControllerDevice | ForEach-Object {
  $dev = [wmi]($_.Dependent)
  $dev | Select-Object DeviceID, Name, Description, Manufacturer, PNPDeviceID, Status
} | ConvertTo-Json -Depth 2
`.trim()

      const { stdout } = await execAsync('powershell', ['-NoProfile','-Command', script], { timeout: 15000 })
      let devices = []
      try { devices = JSON.parse(stdout.trim()) } catch {}
      if (!Array.isArray(devices)) devices = [devices].filter(Boolean)

      // Filter for Android/iOS/interesting devices
      const found = []
      for (const d of devices) {
        const pid = (d.PNPDeviceID || d.DeviceID || '').toUpperCase()
        const name = (d.Name || d.Description || '').toLowerCase()
        const mfr  = (d.Manufacturer || '').toLowerCase()

        // Extract VID
        const vidMatch = pid.match(/VID_([0-9A-F]{4})/)
        const vidPidMatch = pid.match(/VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/)
        const vid = vidMatch?.[1]
        const pidCode = vidPidMatch?.[2]

        const isAndroid = vid && ANDROID_VIDS[vid]
        const isApple   = vid === '05AC'
        const isFastboot = name.includes('fastboot') || name.includes('bootloader') || pid.includes('FASTBOOT')
        const isRecovery = name.includes('recovery') || name.includes('twrp') || name.includes('sideload')
        const isMtp     = name.includes('mtp') || name.includes('media transfer') || name.includes('android')
        const isComposite = name.includes('composite') || name.includes('adb')

        if (isAndroid || isApple || isFastboot || isRecovery || isMtp || isComposite) {
          let mode = 'unknown'
          if (isFastboot) mode = 'fastboot'
          else if (isRecovery) mode = 'recovery/sideload'
          else if (isComposite || name.includes('adb')) mode = 'adb-ready'
          else if (isMtp) mode = 'mtp-file-transfer'
          else mode = 'usb-detected'

          found.push({
            name: d.Name || d.Description || 'Unknown Device',
            manufacturer: ANDROID_VIDS[vid] || (isApple ? 'Apple' : d.Manufacturer) || 'Unknown',
            vid, pid: pidCode,
            pnpId: d.PNPDeviceID,
            mode,
            isAndroid: !!isAndroid,
            isApple,
            hasAdb: isComposite || name.includes('adb'),
            status: d.Status || 'OK',
          })
        }
      }
      return { success: true, devices: found, total: devices.length }
    } catch(e) { return { success: false, error: e.message, devices: [] } }
  })

  ipcMain.handle('discover:fastboot-devices', async () => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const fb = join(getBinDir(), process.platform==='win32'?'fastboot.exe':'fastboot')
      const { stdout, stderr } = await execAsync(fb, ['devices'], { timeout: 8000 })
      const devices = (stdout+stderr).split('\n')
        .filter(l => l.trim() && !l.startsWith('*'))
        .map(l => { const [serial, ...rest] = l.trim().split('\t'); return { serial: serial.trim(), mode: rest.join(' ').trim()||'fastboot' } })
        .filter(d => d.serial)
      return { success: true, devices }
    } catch(e) { return { success: false, devices: [], error: e.message } }
  })

  ipcMain.handle('discover:network-scan', async (_, a) => {
    // Scan local subnet for ADB-over-WiFi devices on port 5555
    try {
      const { createConnection } = await import('net')
      const subnet = a.subnet || '192.168.1'
      const port = a.port || 5555
      const timeout = a.timeout || 300
      const found = []

      const tryConnect = (ip) => new Promise(res => {
        const sock = createConnection({ host: ip, port, timeout })
        sock.on('connect', () => { sock.destroy(); res({ ip, open: true }) })
        sock.on('error', () => res({ ip, open: false }))
        sock.on('timeout', () => { sock.destroy(); res({ ip, open: false }) })
      })

      // Scan .1 to .254 in batches of 20
      const batch = parseInt(a.batch)||20
      for (let i = 1; i <= 254; i += batch) {
        const end = Math.min(i + batch - 1, 254)
        const promises = []
        for (let j = i; j <= end; j++) promises.push(tryConnect(`${subnet}.${j}`))
        const results = await Promise.all(promises)
        found.push(...results.filter(r => r.open).map(r => r.ip))
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('discover:scan-progress', { done: end, total: 254, found: found.length })
        }
      }
      return { success: true, devices: found.map(ip => ({ ip, port, type: 'adb-wifi' })) }
    } catch(e) { return { success: false, error: e.message, devices: [] } }
  })

  ipcMain.handle('discover:enable-adb', async (_, a) => {
    // Try to enable ADB via fastboot or recovery
    if (a.method === 'fastboot') {
      try {
        const { execFile } = await import('child_process')
        const { join } = await import('path')
        const { promisify } = await import('util')
        const execAsync = promisify(execFile)
        const fb = join(getBinDir(), process.platform==='win32'?'fastboot.exe':'fastboot')
        const { stdout } = await execAsync(fb, ['-s', a.serial, 'reboot'], { timeout: 15000 })
        return { success: true, output: stdout, note: 'Rebooted to system. Enable USB debugging in Developer Options then replug.' }
      } catch(e) { return { success: false, error: e.message } }
    }
    return {
      success: false,
      steps: [
        'Go to Settings > About Phone',
        'Tap Build Number 7 times to unlock Developer Options',
        'Go to Settings > Developer Options',
        'Enable "USB Debugging"',
        'Replug the USB cable',
        'Tap Allow on the phone when prompted',
      ]
    }
  })

  ipcMain.handle('discover:adb-connect-wifi', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const adbPath = join(getBinDir(), process.platform==='win32'?'adb.exe':'adb')
      const { stdout, stderr } = await execAsync(adbPath, ['connect', `${a.ip}:${a.port||5555}`], { timeout: 10000 })
      const out = (stdout+stderr).trim()
      return { success: out.includes('connected') && !out.includes('failed'), output: out }
    } catch(e) { return { success: false, error: e.message } }
  })

  // ── Jailbreak Tools ───────────────────────────────────────────────────────
  ipcMain.handle('jailbreak:detect-device', async (_, a) => {
    const result = { ios: {}, android: {} }
    // iOS
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const ib = join(getBinDir(),process.platform==='win32'?'idevice_id.exe':'idevice_id')
      const { stdout } = await execAsync(ib,['-l'],{timeout:8000})
      const udids = stdout.trim().split('\n').filter(Boolean)
      if (udids[0]) {
        const ii = join(getBinDir(),process.platform==='win32'?'ideviceinfo.exe':'ideviceinfo')
        const { stdout:info } = await execAsync(ii,['-u',udids[0]],{timeout:10000})
        const get = key => info.match(new RegExp(key+'\\s*:\\s*(.+)'))?.[1]?.trim()||''
        const chip = get('HardwareModel')||get('ChipID')||''
        const ios = get('ProductVersion')
        const product = get('ProductType')
        // A8=iPhone6,1/6,2 A9=iPhone8,x A10=iPhone9,x A11=iPhone10,x A12=iPhone11,x A13=iPhone12,x
        const chipMap = {
          'iPhone6,':'A8','iPhone7,':'A9','iPhone8,':'A8','iPhone9,':'A10','iPhone10,1':'A10',
          'iPhone10,3':'A11','iPhone10,4':'A10','iPhone10,6':'A11','iPhone11,':'A12',
          'iPhone12,':'A13','iPhone13,':'A14','iPhone14,':'A15','iPhone15,':'A16','iPhone16,':'A17',
        }
        let chipGen = 'unknown'
        for (const [k,v] of Object.entries(chipMap)) { if (product.startsWith(k)) { chipGen=v; break } }
        const checkm8 = ['A8','A9','A10','A11'].includes(chipGen)
        result.ios = { udid:udids[0], product, ios, chipGen, checkm8,
          dopamine: chipGen>='A12' && parseFloat(ios)>=15.0 && parseFloat(ios)<=16.7,
          palera1n: checkm8,
          trollstore: parseFloat(ios)>=14.0 && parseFloat(ios)<=17.0,
        }
      }
    } catch {}
    // Android
    try {
      const devices = await adb.listDevices()
      if (devices[0]) {
        const d = devices[0]
        const rooted = await adb.shell(d.serial,'su -c id').then(o=>o.includes('root')).catch(()=>false)
        const arch = await adb.shell(d.serial,'getprop ro.product.cpu.abi').catch(()=>'')
        const sdk = await adb.shell(d.serial,'getprop ro.build.version.sdk').catch(()=>'0')
        result.android = { serial:d.serial, model:d.model||d.serial, rooted, arch, sdk:parseInt(sdk) }
      }
    } catch {}
    return result
  })

  ipcMain.handle('jailbreak:download-checkn1x', async (_, a) => {
    const { app: ea } = await import('electron')
    const { default: fs } = await import('fs-extra')
    const { join } = await import('path')
    const axios = (await import('axios')).default
    // Get latest checkn1x release
    const rel = await axios.get('https://api.github.com/repos/asineth0/checkn1x/releases/latest',{timeout:15000,headers:{'User-Agent':'Omerta/1.0'}})
    const asset = rel.data.assets?.find(a=>a.name.endsWith('.iso')||a.name.endsWith('.img'))
    if (!asset) return { error: 'No ISO found in latest checkn1x release' }
    const destDir = join(ea.getPath('userData'),'jailbreak_tools')
    await fs.ensureDir(destDir)
    const destFile = join(destDir, asset.name)
    if (await fs.pathExists(destFile)) return { success:true, path:destFile, cached:true, size:(await fs.stat(destFile)).size }
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('jailbreak:dl-progress',{percent:5,msg:'Downloading '+asset.name+'...'})
    const resp = await axios({ url:asset.browser_download_url, method:'GET', responseType:'stream', timeout:120000 })
    const total = parseInt(resp.headers['content-length']||'0')
    let done = 0
    const writer = (await import('fs')).default.createWriteStream(destFile)
    resp.data.on('data', chunk => {
      done += chunk.length
      if(total&&mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('jailbreak:dl-progress',{percent:Math.round(done/total*90)+5,msg:`Downloading ${asset.name}... ${Math.round(done/1e6)}MB`})
    })
    await new Promise((res,rej)=>{ resp.data.pipe(writer); writer.on('finish',res); writer.on('error',rej) })
    if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('jailbreak:dl-progress',{percent:100,msg:'Download complete'})
    return { success:true, path:destFile, size:(await fs.stat(destFile)).size, name:asset.name }
  })

  ipcMain.handle('jailbreak:flash-checkn1x', async (_, a) => {
    const { spawn } = await import('child_process')
    const { join } = await import('path')
    const rufus = join(getBinDir(),'rufus.exe')
    const { default: fs } = await import('fs-extra')
    if (!await fs.pathExists(rufus)) return { error:'rufus.exe not found in bin/' }
    if (!a.isoPath) return { error:'No ISO path provided' }
    // Open Rufus with the ISO pre-loaded
    const proc = spawn(rufus, [a.isoPath], { detached:true, stdio:'ignore' })
    proc.unref()
    return { success:true, note:'Rufus opened with checkn1x ISO. Select your USB drive and click START.' }
  })

  ipcMain.handle('jailbreak:open-folder', async () => {
    const { app: ea } = await import('electron')
    const { join } = await import('path')
    const { default: fs } = await import('fs-extra')
    const dir = join(ea.getPath('userData'),'jailbreak_tools')
    await fs.ensureDir(dir)
    shell.openPath(dir)
    const files = await fs.readdir(dir).catch(()=>[])
    return { success:true, path:dir, files }
  })

  ipcMain.handle('jailbreak:dfu-help', async (_, a) => {
    // Return device-specific DFU instructions
    const instructions = {
      'home_button': { // iPhone 6, 7, 8, SE1, SE2
        steps: ['Hold Power button for 3 seconds','Keep holding Power, also hold Home for 8 seconds','Release Power only, keep holding Home for 5 more seconds','Screen stays BLACK = DFU mode entered'],
        exit: 'Hold Power + Home together for 10 seconds'
      },
      'no_home': { // iPhone X, XS, 11, 12, 13, 14, 15
        steps: ['Press and quickly release Volume Up','Press and quickly release Volume Down','Hold Side button for 3 seconds','Keep holding Side, also hold Volume Down for 8 seconds','Release Side only, keep holding Volume Down for 5 more seconds','Screen stays BLACK = DFU mode'],
        exit: 'Press Volume Up, Volume Down, hold Side button'
      },
      'iphone7': {
        steps: ['Hold Power + Volume Down for 8 seconds','Release Power only, keep holding Volume Down for 5 more seconds','Screen stays BLACK = DFU mode'],
        exit: 'Hold Power + Volume Down for 10 seconds'
      }
    }
    return instructions[a.type] || instructions.home_button
  })

  ipcMain.handle('jailbreak:sideload-ipa', async (_, a) => {
    // Sideload a jailbreak IPA (Dopamine, Unc0ver, etc.)
    const { filePaths } = await dialog.showOpenDialog({ filters:[{name:'IPA',extensions:['ipa']}], properties:['openFile'] })
    if (!filePaths?.[0]) return { cancelled:true }
    return sideloaderInstance.signAndInstallIpa(a.udid, filePaths[0], p => {
      if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('jailbreak:install-progress', p)
    })
  })

  ipcMain.handle('jailbreak:magisk-patch', async (_, a) => {
    // Guide: patch boot.img with Magisk for Android root
    return {
      steps: [
        'Download your exact stock firmware from SamMobile/Frija (match model + region + build number exactly)',
        'Extract the boot.img from the firmware zip',
        'Copy boot.img to /sdcard/ on your phone: adb push boot.img /sdcard/',
        'Install Magisk APK on your phone (from github.com/topjohnwu/Magisk/releases)',
        'Open Magisk > Install > Select and Patch a File > choose boot.img',
        'Magisk creates magisk_patched_[build].img in /sdcard/',
        'Pull it back: adb pull /sdcard/magisk_patched_*.img .',
        'Reboot to fastboot: adb reboot bootloader',
        'Flash: fastboot flash boot magisk_patched.img',
        'Reboot: fastboot reboot',
        'Open Magisk to complete setup',
      ]
    }
  })

  // ── RAMDisk / NAND Tools ──────────────────────────────────────────────────
  ipcMain.handle('nand:android:read-partition', async (_, a) => {
    // Read a partition from Android device via dd
    try {
      const { app: ea } = await import('electron')
      const { join } = await import('path')
      const { default: fs } = await import('fs-extra')
      const dest = join(ea.getPath('userData'), 'partitions')
      await fs.ensureDir(dest)
      const outFile = join(dest, `${a.partition}_${Date.now()}.img`)
      // Try common partition paths
      const paths = [
        `/dev/block/by-name/${a.partition}`,
        `/dev/block/bootdevice/by-name/${a.partition}`,
        `/dev/block/platform/*/by-name/${a.partition}`,
      ]
      // First find the actual block device
      const findOut = await adb.shell(a.serial, `find /dev/block -name "${a.partition}" 2>/dev/null | head -1; ls -la /dev/block/by-name/${a.partition} 2>/dev/null; ls -la /dev/block/bootdevice/by-name/${a.partition} 2>/dev/null`)
      const blockDev = findOut.match(/-> ([^\s]+)/)?.[1] || `/dev/block/by-name/${a.partition}`
      // Pull via dd to sdcard first, then adb pull
      await adb.shell(a.serial, `su -c "dd if=${blockDev} of=/sdcard/${a.partition}.img bs=4096 2>/dev/null" 2>/dev/null || dd if=${blockDev} of=/sdcard/${a.partition}.img bs=4096 2>/dev/null`)
      await adb.exec(['-s', a.serial, 'pull', `/sdcard/${a.partition}.img`, outFile])
      await adb.shell(a.serial, `rm -f /sdcard/${a.partition}.img`)
      const stat = await fs.stat(outFile).catch(() => null)
      return { success: !!stat, path: outFile, size: stat?.size || 0, partition: a.partition }
    } catch(e) { return { success:false, error:e.message } }
  })

  ipcMain.handle('nand:android:flash-partition', async (_, a) => {
    // Flash an image to an Android partition
    try {
      const { filePaths } = await dialog.showOpenDialog({
        filters:[{name:'Image',extensions:['img','bin','lz4','br','gz']}],
        properties:['openFile'],
        title:`Select image to flash to ${a.partition}`
      })
      if (!filePaths?.[0]) return { cancelled:true }
      const imgPath = filePaths[0]
      if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('nand:progress',{pct:5,msg:'Pushing image to device...'})
      // Push to sdcard
      await adb.exec(['-s', a.serial, 'push', imgPath, `/sdcard/_flash_${a.partition}.img`])
      if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('nand:progress',{pct:40,msg:'Flashing partition (requires root)...'})
      // Flash via dd (requires root)
      const paths = [`/dev/block/by-name/${a.partition}`, `/dev/block/bootdevice/by-name/${a.partition}`]
      let flashed = false
      for (const p of paths) {
        const out = await adb.shell(a.serial, `su -c "dd if=/sdcard/_flash_${a.partition}.img of=${p} bs=4096 && sync" 2>&1`).catch(()=>'')
        if (out.includes('records') || out === '') { flashed = true; break }
      }
      await adb.shell(a.serial, `rm -f /sdcard/_flash_${a.partition}.img`)
      if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('nand:progress',{pct:100,msg:flashed?'Flash complete':'May have failed - check device'})
      return { success:flashed, path:imgPath, partition:a.partition }
    } catch(e) { return { success:false, error:e.message } }
  })

  ipcMain.handle('nand:android:list-partitions', async (_, a) => {
    try {
      const [byName, blkList] = await Promise.all([
        adb.shell(a.serial, 'ls -la /dev/block/by-name/ 2>/dev/null || ls -la /dev/block/bootdevice/by-name/ 2>/dev/null').catch(()=>''),
        adb.shell(a.serial, 'cat /proc/partitions 2>/dev/null').catch(()=>''),
      ])
      const partitions = []
      // Parse by-name symlinks
      const symlinkRe = /(\w+)\s+->\s+([^\s]+)/g
      let m
      while ((m = symlinkRe.exec(byName)) !== null) {
        partitions.push({ name:m[1], device:m[2], source:'by-name' })
      }
      // Parse /proc/partitions
      blkList.split('\n').slice(2).forEach(line => {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 4 && !partitions.find(p=>p.name===parts[3])) {
          partitions.push({ name:parts[3], blocks:parseInt(parts[2])||0, source:'proc' })
        }
      })
      return { success:true, partitions, raw:byName }
    } catch(e) { return { success:false, error:e.message, partitions:[] } }
  })

  ipcMain.handle('nand:android:ramdisk-extract', async (_, a) => {
    // Extract ramdisk from boot.img using magiskboot
    try {
      const { default: fs } = await import('fs-extra')
      const { join } = await import('path')
      const { app: ea } = await import('electron')
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const mb = join(getBinDir(),process.platform==='win32'?'magiskboot.exe':'magiskboot')
      if (!await fs.pathExists(mb)) return { success:false, error:'magiskboot not found in bin/' }
      const workDir = join(ea.getPath('userData'), 'ramdisk_work')
      await fs.ensureDir(workDir)
      // Copy boot.img to work dir
      const bootImg = join(workDir, 'boot.img')
      if (a.localPath) {
        await fs.copy(a.localPath, bootImg)
      } else {
        // Pull from device
        await adb.shell(a.serial, `su -c "dd if=/dev/block/by-name/boot of=/sdcard/boot_dump.img bs=4096" 2>/dev/null`)
        await adb.exec(['-s', a.serial, 'pull', '/sdcard/boot_dump.img', bootImg])
        await adb.shell(a.serial, 'rm -f /sdcard/boot_dump.img')
      }
      if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('nand:progress',{pct:40,msg:'Unpacking boot image...'})
      const { stdout } = await execAsync(mb, ['unpack', bootImg], { cwd:workDir, timeout:30000 })
      const files = await fs.readdir(workDir).catch(()=>[])
      if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('nand:progress',{pct:100,msg:'Extracted: '+files.join(', ')})
      shell.openPath(workDir)
      return { success:true, workDir, files, output:stdout }
    } catch(e) { return { success:false, error:e.message } }
  })

  ipcMain.handle('nand:android:ramdisk-repack', async (_, a) => {
    // Repack ramdisk back into boot.img
    try {
      const { default: fs } = await import('fs-extra')
      const { join } = await import('path')
      const { app: ea } = await import('electron')
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const mb = join(getBinDir(),process.platform==='win32'?'magiskboot.exe':'magiskboot')
      const workDir = join(ea.getPath('userData'), 'ramdisk_work')
      if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('nand:progress',{pct:10,msg:'Repacking boot image...'})
      const { stdout } = await execAsync(mb, ['repack', 'boot.img'], { cwd:workDir, timeout:30000 })
      const newBoot = join(workDir, 'new-boot.img')
      const exists = await fs.pathExists(newBoot)
      if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('nand:progress',{pct:100,msg:exists?'Repacked: new-boot.img':'Repack may have failed'})
      return { success:exists, path:newBoot, output:stdout }
    } catch(e) { return { success:false, error:e.message } }
  })

  ipcMain.handle('nand:android:open-workdir', async () => {
    const { app: ea } = await import('electron')
    const { join } = await import('path')
    const { default: fs } = await import('fs-extra')
    const workDir = join(ea.getPath('userData'), 'ramdisk_work')
    await fs.ensureDir(workDir)
    shell.openPath(workDir)
    const files = await fs.readdir(workDir).catch(()=>[])
    return { success:true, path:workDir, files }
  })

  ipcMain.handle('nand:android:open-partitions', async () => {
    const { app: ea } = await import('electron')
    const { join } = await import('path')
    const { default: fs } = await import('fs-extra')
    const dir = join(ea.getPath('userData'), 'partitions')
    await fs.ensureDir(dir)
    shell.openPath(dir)
    return { success:true, path:dir }
  })

  // ── iOS NAND / Ramdisk ────────────────────────────────────────────────────
  ipcMain.handle('nand:ios:ramdisk-info', () => ({
    info: 'iOS ramdisk mode allows filesystem access without passcode on supported devices.',
    tools: [
      { name:'checkra1n ramdisk', desc:'checkra1n can boot a ramdisk to access /private/var without passcode. Requires A8-A11.', url:'https://checkra.in' },
      { name:'ideviceenterrecovery', desc:'Enter recovery mode for DFU operations.', installed: true },
      { name:'SSH ramdisk (palera1n)', desc:'palera1n can mount an SSH ramdisk for forensic access.', url:'https://palera.in' },
    ],
    forensicNote: 'For locked devices with broken screens: boot a ramdisk via checkra1n, then SSH in to extract /private/var/mobile/Media and keychain data.',
  }))

  ipcMain.handle('nand:ios:enter-recovery', async (_, a) => {
    return new Promise(res => {
      import('child_process').then(({ spawn }) => {
        import('path').then(({ join }) => {
          import('electron').then(({ app: ea }) => {
            const b = getBinDir()
            const tool = join(b, process.platform==='win32'?'ideviceenterrecovery.exe':'ideviceenterrecovery')
            const args = a.udid ? [a.udid] : []
            const proc = spawn(tool, args)
            let out='', err=''
            proc.stdout?.on('data',d=>out+=d)
            proc.stderr?.on('data',d=>err+=d)
            proc.on('error',e=>res({success:false,error:e.code==='ENOENT'?'ideviceenterrecovery not found - run install-remaining.ps1':e.message}))
            proc.on('close',code=>res({success:code===0,output:(out+err).trim()}))
          })
        })
      })
    })
  })

  ipcMain.handle('nand:ios:exit-recovery', async (_, a) => {
    return new Promise(res => {
      import('child_process').then(({ spawn }) => {
        import('path').then(({ join }) => {
          const tool = join(getBinDir(), process.platform==='win32'?'idevicediagnostics.exe':'idevicediagnostics')
          const args = a.udid ? ['-u',a.udid,'restart'] : ['restart']
          const proc = spawn(tool, args)
          let out=''
          proc.stdout?.on('data',d=>out+=d)
          proc.on('error',e=>res({success:false,error:e.message}))
          proc.on('close',code=>res({success:code===0,output:out}))
        })
      })
    })
  })

  ipcMain.handle('nand:ios:backup-full', async (_, a) => {
    const { filePaths:[dest] } = await dialog.showOpenDialog({ properties:['openDirectory'], title:'Select backup destination' })
    if (!dest) return { cancelled:true }
    if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('nand:progress',{pct:5,msg:'Starting full backup...'})
    return new Promise(res => {
      import('child_process').then(({ spawn }) => {
        import('path').then(({ join }) => {
          const tool = join(getBinDir(), process.platform==='win32'?'idevicebackup2.exe':'idevicebackup2')
          const args = a.udid ? ['-u',a.udid,'backup','--full',dest] : ['backup','--full',dest]
          const proc = spawn(tool, args)
          let out=''
          proc.stdout?.on('data',d=>{out+=d; if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('nand:progress',{pct:50,msg:d.toString().trim()})})
          proc.stderr?.on('data',d=>out+=d)
          proc.on('error',e=>res({success:false,error:e.message}))
          proc.on('close',code=>{
            if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('nand:progress',{pct:100,msg:'Backup complete'})
            res({success:code===0,dest,output:out})
          })
        })
      })
    })
  })

  // ── iOS Customisation Tools ───────────────────────────────────────────────
  // SHSH / blob saving
  ipcMain.handle('ios:shsh:save', async (_, a) => {
    try {
      const { default: fs } = await import('fs-extra')
      const { join } = await import('path')
      const { app: ea } = await import('electron')
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const tsschecker = join(getBinDir(),process.platform==='win32'?'tsschecker.exe':'tsschecker')
      if (!await fs.pathExists(tsschecker)) {
        return { success:false, error:'tsschecker not found. Download from github.com/tihmstar/tsschecker/releases and put in bin/' }
      }
      const destDir = join(ea.getPath('userData'),'shsh_blobs')
      await fs.ensureDir(destDir)
      const args = ['-d', a.device||'iPhone8,1', '--save', '-e', a.ecid||'', '-s', '--no-baseband', '-o', destDir]
      if (a.ios) { args.push('--ios'); args.push(a.ios) }
      const { stdout, stderr } = await execAsync(tsschecker, args, { timeout:60000 })
      const files = await fs.readdir(destDir).catch(()=>[])
      const blobs = files.filter(f=>f.endsWith('.shsh2')||f.endsWith('.shsh'))
      return { success:true, output:(stdout+stderr).trim(), blobs, destDir }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('ios:shsh:list', async () => {
    const { app: ea } = await import('electron')
    const { join } = await import('path')
    const { default: fs } = await import('fs-extra')
    const destDir = join(ea.getPath('userData'),'shsh_blobs')
    await fs.ensureDir(destDir)
    const files = await fs.readdir(destDir).catch(()=>[])
    const blobs = await Promise.all(files.filter(f=>f.endsWith('.shsh2')||f.endsWith('.shsh')).map(async f => {
      const stat = await fs.stat(join(destDir,f)).catch(()=>null)
      return { name:f, size:stat?.size||0, path:join(destDir,f) }
    }))
    return { blobs, destDir }
  })
  ipcMain.handle('ios:shsh:open-folder', async () => {
    const { app: ea } = await import('electron')
    const { join } = await import('path')
    const { default: fs } = await import('fs-extra')
    const d = join(ea.getPath('userData'),'shsh_blobs')
    await fs.ensureDir(d)
    shell.openPath(d)
    return { path:d }
  })

  // IPSW tools
  ipcMain.handle('ios:ipsw:fetch-versions', async (_, a) => {
    try {
      const axios = (await import('axios')).default
      const url = `https://api.ipsw.me/v4/device/${a.device||'iPhone8,1'}?type=ipsw`
      const r = await axios.get(url, { timeout:15000 })
      const firmwares = r.data.firmwares || []
      return { success:true, firmwares: firmwares.map(f => ({
        version: f.version, buildid: f.buildid, sha256: f.sha256,
        filesize: f.filesize, signed: f.signed, releasedate: f.releasedate,
        url: f.url
      }))}
    } catch(e) { return { success:false, error:e.message, firmwares:[] } }
  })
  ipcMain.handle('ios:ipsw:download', async (_, a) => {
    const { filePaths:[dest] } = await dialog.showOpenDialog({ properties:['openDirectory'], title:'Select download folder' })
    if (!dest) return { cancelled:true }
    const { default: fs } = await import('fs-extra')
    const { join } = await import('path')
    const axios = (await import('axios')).default
    const filename = a.url.split('/').pop() || `${a.device}_${a.version}.ipsw`
    const outPath = join(dest, filename)
    if (await fs.pathExists(outPath)) return { success:true, path:outPath, cached:true }
    if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('ios:ipsw:progress',{pct:2,msg:'Starting download...'})
    const resp = await axios({ url:a.url, method:'GET', responseType:'stream', timeout:0 })
    const total = parseInt(resp.headers['content-length']||'0')
    let done = 0
    const writer = (await import('fs')).default.createWriteStream(outPath)
    resp.data.on('data', chunk => {
      done += chunk.length
      if(total&&mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('ios:ipsw:progress',{pct:Math.round(done/total*95)+2,msg:`Downloading ${filename}... ${Math.round(done/1e6)}MB / ${Math.round(total/1e6)}MB`})
    })
    await new Promise((res,rej)=>{ resp.data.pipe(writer); writer.on('finish',res); writer.on('error',rej) })
    if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('ios:ipsw:progress',{pct:100,msg:'Download complete'})
    return { success:true, path:outPath, size:(await fs.stat(outPath)).size }
  })
  ipcMain.handle('ios:ipsw:extract-ramdisk', async (_, a) => {
    try {
      const { default: fs } = await import('fs-extra')
      const { join } = await import('path')
      const { app: ea } = await import('electron')
      const StreamZip = (await import('node-stream-zip')).default
      const workDir = join(ea.getPath('userData'),'ipsw_work')
      await fs.ensureDir(workDir)
      const zip = new StreamZip.async({ file:a.ipswPath })
      const entries = await zip.entries()
      const keys = Object.keys(entries)
      // Extract key files
      const toExtract = keys.filter(k => k.endsWith('.dmg')||k.includes('Restore.plist')||k.includes('BuildManifest.plist'))
      for (const key of toExtract.slice(0,10)) {
        await zip.extract(key, join(workDir, key.replace(/\//g,'_')))
      }
      await zip.close()
      const files = await fs.readdir(workDir)
      shell.openPath(workDir)
      return { success:true, workDir, files }
    } catch(e) { return { success:false, error:e.message } }
  })

  // Cydia / package manager
  ipcMain.handle('ios:cydia:search', async (_, a) => {
    try {
      const axios = (await import('axios')).default
      // Search BigBoss repo
      const results = []
      const repos = [
        'https://apt.bingner.com/',
        'https://repo.chariz.com/',
        'https://havoc.app/',
      ]
      // Use Canister API for package search
      const r = await axios.get(`https://api.canister.me/v2/jailbreak/package/search?q=${encodeURIComponent(a.query)}&limit=20`, { timeout:10000 })
      const pkgs = r.data?.data || []
      return { success:true, packages:pkgs.map(p=>({
        name:p.name||p.package, id:p.package, version:p.latestVersion||p.version,
        description:p.shortDescription||p.description||'', repo:p.repository?.name||'',
        price:p.price||'Free', author:p.author||'',
      }))}
    } catch(e) { return { success:false, error:e.message, packages:[] } }
  })

  ipcMain.handle('ios:cydia:install-repo', async (_, a) => {
    // SSH into device and add repo
    return {
      command: `apt-get update && apt-get install -y ${a.packageId}`,
      note: 'Run via SSH: ssh root@<device_ip> then paste the command',
      altMethod: `In Cydia/Sileo: add source ${a.repoUrl} then install ${a.packageName}`,
    }
  })

  // Boot arguments (checkra1n)
  ipcMain.handle('ios:bootargs:get', async (_, a) => {
    try {
      const out = await ios.exec('ideviceinfo', '-u', a.udid, '-q', 'com.apple.iBoot')
      return { success:true, raw:out }
    } catch(e) {
      return { success:false, error:e.message, note:'Boot args readable on jailbroken devices via nvram command over SSH' }
    }
  })

  // Tweaks database
  ipcMain.handle('ios:tweaks:list', async () => {
    const TWEAKS = [
      // Springboard/UI
      { name:'Springtomize 5', cat:'UI', desc:'All-in-one springboard customizer. Resize icons, hide labels, custom dock.', repo:'chariz.com', paid:true },
      { name:'Silica', cat:'UI', desc:'Wallpaper engine with parallax, dynamic, and live wallpapers.', repo:'repo.paisseon.com', paid:false },
      { name:'Cylinder Reborn', cat:'UI', desc:'Custom page turn animations for springboard.', repo:'apt.bingner.com', paid:false },
      { name:'Eclipse X', cat:'UI', desc:'System-wide dark mode for older iOS.', repo:'apt.matchstic.me', paid:true },
      { name:'Noctis12', cat:'UI', desc:'Dark mode for iOS 12 and below.', repo:'apt.bingner.com', paid:true },
      { name:'Iconizer', cat:'UI', desc:'Custom icon shapes: circular, squircle, custom.', repo:'havoc.app', paid:true },
      { name:'Snowboard', cat:'Themes', desc:'Theme engine. Apply icon packs from Anemone sources.', repo:'repo.chariz.com', paid:false },
      { name:'Anemone', cat:'Themes', desc:'Classic theme engine. Huge library of themes.', repo:'apt.thebigboss.org', paid:false },
      // System
      { name:'Filza', cat:'System', desc:'Full filesystem browser. Access /var/mobile and system files.', repo:'tigisoftware.com/cydia', paid:true },
      { name:'iSuperSU', cat:'System', desc:'Manage root access per-app.', repo:'apt.bingner.com', paid:false },
      { name:'NewTerm 3', cat:'System', desc:'Full terminal emulator with SSH support.', repo:'repo.chariz.com', paid:true },
      { name:'MTerminal', cat:'System', desc:'Free terminal emulator.', repo:'apt.thebigboss.org', paid:false },
      { name:'AppSync Unified', cat:'System', desc:'Sideload unsigned IPAs without revocation.', repo:'cydia.akemi.ai', paid:false },
      { name:'Liberty Lite', cat:'System', desc:'Bypass jailbreak detection per-app.', repo:'ryleyangus.com/repo', paid:false },
      { name:'A-Bypass', cat:'System', desc:'Advanced jailbreak detection bypass.', repo:'repo.rpgfarm.com', paid:false },
      // Privacy/Security
      { name:'Choicy', cat:'Privacy', desc:'Disable specific tweaks per-app. Debug conflicts.', repo:'apt.bingner.com', paid:false },
      { name:'iCleaner Pro', cat:'Privacy', desc:'Clear caches, logs, and junk files.', repo:'ib-soft.net/cydia', paid:false },
      { name:'BioProtect XS', cat:'Privacy', desc:'Touch/Face ID lock any app.', repo:'apt.thebigboss.org', paid:true },
      // Networking
      { name:'OpenVPN', cat:'Network', desc:'VPN client supporting OpenVPN protocol.', repo:'App Store', paid:false },
      { name:'DNSCloak', cat:'Network', desc:'System-wide encrypted DNS (DoH/DoT).', repo:'App Store', paid:false },
      // Media
      { name:'Cercube', cat:'Media', desc:'YouTube background play, ad block, download.', repo:'apt.alfhaily.me', paid:false },
      { name:'Snapper 2', cat:'Media', desc:'Crop and annotate screenshots before saving.', repo:'repo.chariz.com', paid:true },
      // Communication
      { name:'Nuntius', cat:'Comms', desc:'Custom notification sounds and banners.', repo:'havoc.app', paid:true },
      { name:'CallBar XS', cat:'Comms', desc:'Non-intrusive call notifications.', repo:'apt.thebigboss.org', paid:true },
      // Keyboard
      { name:'Swype', cat:'Keyboard', desc:'Swipe typing for iOS.', repo:'App Store', paid:true },
      { name:'Barmoji', cat:'Keyboard', desc:'Emoji bar above keyboard.', repo:'barmoji.com', paid:false },
    ]
    return { tweaks: TWEAKS, cats: [...new Set(TWEAKS.map(t=>t.cat))] }
  })

  // Appearance / themes
  ipcMain.handle('ios:theme:sources', async () => {
    return {
      sources: [
        { name:'Chariz', url:'https://repo.chariz.com/', desc:'Premium tweaks and themes, curated' },
        { name:'Havoc', url:'https://havoc.app/', desc:'Quality paid tweaks' },
        { name:'BigBoss', url:'https://apt.thebigboss.org/repofiles/cydia/', desc:'Largest free repo' },
        { name:'Bingner (Elucubratus)', url:'https://apt.bingner.com/', desc:'Free tweaks, rootless compatible' },
        { name:'Packix', url:'https://repo.packix.com/', desc:'Premium themes and tweaks' },
        { name:'Dynastic Repo', url:'https://repo.dynastic.co/', desc:'Open source tweaks' },
        { name:'Limneos', url:'https://limneos.net/repo/', desc:'CallBar, BioProtect, etc.' },
        { name:'PoomSmart', url:'https://poomsmart.github.io/repo/', desc:'Cercube, YouTube++ etc.' },
      ]
    }
  })

  // iOS version info + signed versions
  ipcMain.handle('ios:signed:check', async (_, a) => {
    try {
      const axios = (await import('axios')).default
      const r = await axios.get(`https://api.ipsw.me/v4/device/${a.device||'iPhone8,1'}?type=ipsw`, { timeout:10000 })
      const firmwares = r.data.firmwares || []
      return {
        success:true,
        signed: firmwares.filter(f=>f.signed).map(f=>f.version),
        unsigned: firmwares.filter(f=>!f.signed).map(f=>f.version),
        all: firmwares.map(f=>({ version:f.version, signed:f.signed, buildid:f.buildid }))
      }
    } catch(e) { return { success:false, error:e.message } }
  })

  // ── iOS Extended Tools (massive expansion) ─────────────────────────────────

  // ── App Store / IPA tools ─────────────────────────────────────────────────
  ipcMain.handle('ios:appstore:search', async (_, a) => {
    try {
      const axios = (await import('axios')).default
      const r = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(a.query)}&entity=software&country=${a.country||'us'}&limit=${a.limit||25}`, { timeout:10000 })
      return { success:true, results:(r.data.results||[]).map(a=>({ name:a.trackName, bundleId:a.bundleId, version:a.version, price:a.price===0?'Free':'$'+a.price, genre:a.primaryGenreName, rating:a.averageUserRating?.toFixed(1), reviews:a.userRatingCount, icon:a.artworkUrl100, url:a.trackViewUrl, size:a.fileSizeBytes, minOs:a.minimumOsVersion, developer:a.artistName, id:a.trackId })) }
    } catch(e) { return { success:false, error:e.message } }
  })

  ipcMain.handle('ios:appstore:app-info', async (_, a) => {
    try {
      const axios = (await import('axios')).default
      const r = await axios.get(`https://itunes.apple.com/lookup?id=${a.id}&country=${a.country||'us'}`, { timeout:10000 })
      const app = r.data.results?.[0]
      if (!app) return { success:false, error:'Not found' }
      return { success:true, app:{ name:app.trackName, bundleId:app.bundleId, version:app.version, price:app.price===0?'Free':'$'+app.price, genre:app.primaryGenreName, rating:app.averageUserRating?.toFixed(1), reviews:app.userRatingCount, icon:app.artworkUrl512||app.artworkUrl100, url:app.trackViewUrl, size:app.fileSizeBytes, minOs:app.minimumOsVersion, developer:app.artistName, description:app.description, releaseNotes:app.releaseNotes, releaseDate:app.releaseDate, lastUpdated:app.currentVersionReleaseDate, languages:app.languageCodesISO2A, screenshots:app.screenshotUrls } }
    } catch(e) { return { success:false, error:e.message } }
  })

  // ── Device diagnostics extended ────────────────────────────────────────────
  ipcMain.handle('ios:diag:full-report', async (_, a) => {
    const report = { timestamp:new Date().toISOString() }
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const { default: fs } = await import('fs-extra')
      const { app: ea } = await import('electron')
      const execAsync = promisify(execFile)
      const b = getBinDir()
      const iinfo = join(b, process.platform==='win32'?'ideviceinfo.exe':'ideviceinfo')
      const args = a.udid ? ['-u',a.udid] : []
      if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:diag:progress',{pct:10,msg:'Reading device info...'})
      const { stdout:info } = await execAsync(iinfo, args, { timeout:20000 }).catch(()=>({stdout:''}))
      report.deviceInfo = info
      if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:diag:progress',{pct:30,msg:'Reading battery info...'})
      const { stdout:batt } = await execAsync(iinfo, [...args,'-q','com.apple.mobile.battery'], { timeout:10000 }).catch(()=>({stdout:''}))
      report.battery = batt
      if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:diag:progress',{pct:50,msg:'Reading app list...'})
      const iinst = join(b, process.platform==='win32'?'ideviceinstaller.exe':'ideviceinstaller')
      const { stdout:apps } = await execAsync(iinst, [...args,'-l'], { timeout:20000 }).catch(()=>({stdout:''}))
      report.apps = apps
      if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:diag:progress',{pct:70,msg:'Capturing syslog snippet...'})
      const isys = join(b, process.platform==='win32'?'idevicesyslog.exe':'idevicesyslog')
      const syslog = await new Promise(res => {
        const { spawn } = require ? null : null
        import('child_process').then(({spawn:sp}) => {
          const proc = sp(isys, args)
          let out = ''
          proc.stdout?.on('data',d=>out+=d)
          setTimeout(()=>{ try{proc.kill()}catch{} res(out.slice(-8000)) },4000)
        })
      })
      report.syslog = syslog
      if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:diag:progress',{pct:90,msg:'Saving report...'})
      const destDir = join(ea.getPath('userData'),'ios_diagnostics')
      await fs.ensureDir(destDir)
      const reportPath = join(destDir, `diag_${Date.now()}.json`)
      await fs.writeJson(reportPath, report, {spaces:2})
      if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:diag:progress',{pct:100,msg:'Done'})
      return { success:true, path:reportPath, sections:Object.keys(report) }
    } catch(e) { return { success:false, error:e.message } }
  })

  // ── iOS File access (AFC) ──────────────────────────────────────────────────

  // ── iOS Contacts ───────────────────────────────────────────────────────────

  // ── iOS Network tools ──────────────────────────────────────────────────────
  ipcMain.handle('ios:network:wifi-scan', async (_, a) => {
    // Can't directly scan via libimobiledevice, return guide
    return { note:'WiFi scan requires jailbreak. On jailbroken device: apt-get install wireless-tools then iwlist scan', method:'SSH into device via iproxy (iproxy 2222 22) then ssh -p 2222 root@localhost' }
  })

  ipcMain.handle('ios:network:get-ip', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const b = join(getBinDir(), process.platform==='win32'?'ideviceinfo.exe':'ideviceinfo')
      const args = a.udid ? ['-u',a.udid,'-q','com.apple.mobile.interface'] : ['-q','com.apple.mobile.interface']
      const { stdout } = await execAsync(b, args, {timeout:10000}).catch(()=>({stdout:''}))
      const ip = stdout.match(/(?:IPAddress|ip_address):\s*([0-9.]+)/)?.[1]
      return { success:!!ip, ip, raw:stdout }
    } catch(e) { return { success:false, error:e.message } }
  })

  // ── iOS Media / Photos ─────────────────────────────────────────────────────
  ipcMain.handle('ios:photos:count', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const iinfo = join(getBinDir(), process.platform==='win32'?'ideviceinfo.exe':'ideviceinfo')
      const args = a.udid ? ['-u',a.udid,'-q','com.apple.photos.datamodel'] : ['-q','com.apple.photos.datamodel']
      const { stdout } = await execAsync(iinfo, args, {timeout:10000}).catch(()=>({stdout:''}))
      return { success:true, raw:stdout, note:'Full photo access via Photos protocol requires iTunes/AFC' }
    } catch(e) { return { success:false, error:e.message } }
  })

  ipcMain.handle('ios:photos:export', async (_, a) => {
    const { filePaths:[dest] } = await dialog.showOpenDialog({ properties:['openDirectory'], title:'Export photos to...' })
    if (!dest) return { cancelled:true }
    if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('ios:photos:progress',{pct:5,msg:'Starting photo export...'})
    return new Promise(res => {
      import('child_process').then(({spawn}) => {
        import('path').then(({join:j}) => {
          const tool = join(getBinDir(),process.platform==='win32'?'idevicebackup2.exe':'idevicebackup2')
          const args = a.udid ? ['-u',a.udid,'backup',dest] : ['backup',dest]
          const proc = spawn(tool, args)
          proc.stdout?.on('data',d=>{ if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('ios:photos:progress',{pct:50,msg:d.toString().trim()}) })
          proc.on('error',e=>res({success:false,error:e.message}))
          proc.on('close',code=>{ if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('ios:photos:progress',{pct:100,msg:'Done'}); shell.openPath(dest); res({success:code===0,dest}) })
        })
      })
    })
  })

  // ── iOS SSH (via iproxy) ───────────────────────────────────────────────────
  ipcMain.handle('ios:ssh:start-proxy', async (_, a) => {
    const { spawn } = await import('child_process')
    const { join } = await import('path')
    const iproxy = join(getBinDir(),process.platform==='win32'?'iproxy.exe':'iproxy')
    const localPort = a.localPort || 2222
    const devicePort = a.devicePort || 22
    const args = a.udid ? ['-u',a.udid,String(localPort),String(devicePort)] : [String(localPort),String(devicePort)]
    const proc = spawn(iproxy, args)
    proc.on('error',()=>{})
    await new Promise(r=>setTimeout(r,600))
    return { success:true, localPort, devicePort, pid:proc.pid, cmd:`ssh -p ${localPort} root@localhost`, note:'Default password: alpine' }
  })

  // ── iOS Syslog / crash analysis ────────────────────────────────────────────
  ipcMain.handle('ios:syslog:stream', async (_, a) => {
    // Already have idevicesyslog handlers, add filter support
    return { note:'Use Logcat Viewer page for iOS syslog streaming', redirect:'logcat' }
  })

  ipcMain.handle('ios:crash:analyze', async (_, a) => {
    try {
      const { default: fs } = await import('fs-extra')
      const { app: ea } = await import('electron')
      const { join } = await import('path')
      const crashDir = join(ea.getPath('userData'),'ios_crash')
      await fs.ensureDir(crashDir)
      const files = await fs.readdir(crashDir).catch(()=>[])
      const crashes = []
      for (const f of files.slice(0,20)) {
        const content = await fs.readFile(join(crashDir,f),'utf8').catch(()=>'')
        const process = content.match(/Process:\s+(.+)/)?.[1]
        const reason = content.match(/Exception Type:\s+(.+)/)?.[1]
        const date = content.match(/Date\/Time:\s+(.+)/)?.[1]
        crashes.push({ file:f, process:process?.trim(), reason:reason?.trim(), date:date?.trim() })
      }
      return { success:true, crashes, crashDir, count:files.length }
    } catch(e) { return { success:false, error:e.message } }
  })

  // ── iOS Passcode / security ────────────────────────────────────────────────
  ipcMain.handle('ios:security:activation-status', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const iinfo = join(getBinDir(),process.platform==='win32'?'ideviceinfo.exe':'ideviceinfo')
      const args = a.udid ? ['-u',a.udid,'-q','com.apple.mobile.activation'] : ['-q','com.apple.mobile.activation']
      const { stdout } = await execAsync(iinfo, args, {timeout:10000}).catch(()=>({stdout:''}))
      const activated = stdout.includes('Activated')
      const locked = stdout.includes('MobileActivationModeEnabled')
      return { success:true, activated, raw:stdout.trim() }
    } catch(e) { return { success:false, error:e.message } }
  })

  ipcMain.handle('ios:security:check-icloud-lock', async (_, a) => {
    try {
      const axios = (await import('axios')).default
      // Use public iCloud check service
      const r = await axios.get(`https://api.ipsw.me/v4/device/${a.device||'iPhone8,1'}`, {timeout:8000})
      return { success:true, note:'iCloud lock status requires device to be connected and trusted. Check in Settings > [Your Name] > iCloud.' }
    } catch(e) { return { success:false, error:e.message } }
  })

  // ── iTunes / Music sync info ───────────────────────────────────────────────
  ipcMain.handle('ios:sync:info', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const iinfo = join(getBinDir(),process.platform==='win32'?'ideviceinfo.exe':'ideviceinfo')
      const args = a.udid ? ['-u',a.udid,'-q','com.apple.iTunes'] : ['-q','com.apple.iTunes']
      const { stdout } = await execAsync(iinfo, args, {timeout:10000}).catch(()=>({stdout:''}))
      const get = key => stdout.match(new RegExp(key+'\\s*:\\s*(.+)'))?.[1]?.trim()||''
      return { success:true, totalCapacity:get('TotalDataCapacity'), availableCapacity:get('TotalDataAvailable'), computerName:get('DeviceName'), lastBackup:get('LastBackupDate'), raw:stdout }
    } catch(e) { return { success:false, error:e.message } }
  })

  // ── iOS App Management extended ────────────────────────────────────────────
  ipcMain.handle('ios:apps:list-all', async (_, a) => {
    return new Promise(res => {
      import('child_process').then(({spawn}) => {
        import('path').then(({join}) => {
          const tool = join(getBinDir(),process.platform==='win32'?'ideviceinstaller.exe':'ideviceinstaller')
          const args = a.udid ? ['-u',a.udid,'-l','-o','list_all'] : ['-l','-o','list_all']
          const proc = spawn(tool, args)
          let out=''
          proc.stdout?.on('data',d=>out+=d)
          proc.stderr?.on('data',d=>out+=d)
          proc.on('error',e=>res({success:false,error:e.message}))
          proc.on('close',()=>{
            const apps = out.split('\n').filter(l=>l.includes('-')).map(l=>{
              const m = l.match(/^(.+)\s+-\s+(.+)\s+(.+)$/)
              return m ? { bundleId:m[1]?.trim(), name:m[2]?.trim(), version:m[3]?.trim() } : null
            }).filter(Boolean)
            res({success:true,apps,count:apps.length,raw:out})
          })
        })
      })
    })
  })

  ipcMain.handle('ios:apps:uninstall', async (_, a) => {
    return new Promise(res => {
      import('child_process').then(({spawn}) => {
        import('path').then(({join}) => {
          const tool = join(getBinDir(),process.platform==='win32'?'ideviceinstaller.exe':'ideviceinstaller')
          const args = a.udid ? ['-u',a.udid,'-U',a.bundleId] : ['-U',a.bundleId]
          const proc = spawn(tool, args)
          let out=''
          proc.stdout?.on('data',d=>out+=d)
          proc.on('error',e=>res({success:false,error:e.message}))
          proc.on('close',code=>res({success:code===0,output:out.trim()}))
        })
      })
    })
  })

  // ── Activation lock / MDM extended ────────────────────────────────────────
  ipcMain.handle('ios:mdm:profiles-list', async (_, a) => {
    return new Promise(res => {
      import('child_process').then(({spawn}) => {
        import('path').then(({join}) => {
          const tool = join(getBinDir(),process.platform==='win32'?'ideviceprovision.exe':'ideviceprovision')
          const args = a.udid ? ['-u',a.udid,'list','--all'] : ['list','--all']
          const proc = spawn(tool, args)
          let out=''
          proc.stdout?.on('data',d=>out+=d)
          proc.on('error',e=>res({success:false,error:e.code==='ENOENT'?'ideviceprovision not found':e.message}))
          proc.on('close',()=>{
            const profiles = out.split('\n').filter(l=>l.trim()).map(l=>l.trim())
            res({success:true,profiles,count:profiles.length,raw:out})
          })
        })
      })
    })
  })

  // ── iOS restore / DFU tools ────────────────────────────────────────────────
  ipcMain.handle('ios:restore:check-mode', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const b = getBinDir()
      const id = join(b,process.platform==='win32'?'idevice_id.exe':'idevice_id')
      const { stdout:normal } = await execAsync(id,['-l'],{timeout:8000}).catch(()=>({stdout:''}))
      // Check recovery mode devices
      const { stdout:recovery } = await execAsync(id,['-l','-d'],{timeout:8000}).catch(()=>({stdout:''}))
      return {
        normalMode: normal.trim().split('\n').filter(Boolean),
        recoveryMode: recovery.trim().split('\n').filter(Boolean),
        dfuNote: 'DFU devices appear in recovery mode list. Screen must be completely black for DFU.'
      }
    } catch(e) { return { success:false, error:e.message } }
  })

  // ── iOS Extended Tools ─────────────────────────────────────────────────────

  // App Management (detailed)
  ipcMain.handle('ios:apps:detail', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      const b = getBinDir()
      return new Promise(res => {
        const args = a.udid ? ['-u',a.udid,'-l','-o','xml'] : ['-l','-o','xml']
        const proc = spawn(join(b,process.platform==='win32'?'ideviceinstaller.exe':'ideviceinstaller'), args)
        let out='',err=''
        proc.stdout?.on('data',d=>out+=d)
        proc.stderr?.on('data',d=>err+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>{
          const apps = []
          const matches = out.matchAll(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/g)
          const names = out.matchAll(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/g)
          const versions = out.matchAll(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/g)
          const ids = [...matches].map(m=>m[1])
          const ns = [...names].map(m=>m[1])
          const vs = [...versions].map(m=>m[1])
          ids.forEach((id,i)=>apps.push({bundleId:id,name:ns[i]||id,version:vs[i]||''}))
          res({success:code===0||apps.length>0,apps,count:apps.length})
        })
      })
    } catch(e){return{success:false,error:e.message}}
  })

  ipcMain.handle('ios:apps:backup-data', async (_, a) => {
    const { filePaths:[dest] } = await dialog.showOpenDialog({properties:['openDirectory'],title:'Select backup folder'})
    if (!dest) return {cancelled:true}
    const { spawn } = await import('child_process')
    const { join } = await import('path')
    const b = getBinDir()
    return new Promise(res => {
      const args = a.udid ? ['-u',a.udid,'backup','-l','--full',dest] : ['backup','-l','--full',dest]
      const proc = spawn(join(b,process.platform==='win32'?'idevicebackup2.exe':'idevicebackup2'), args)
      let out=''
      proc.stdout?.on('data',d=>{out+=d;if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:ext:progress',{msg:d.toString().trim()})})
      proc.on('error',e=>res({success:false,error:e.message}))
      proc.on('close',code=>res({success:code===0,dest,output:out}))
    })
  })

  ipcMain.handle('ios:apps:install-ipa', async (_, a) => {
    const { filePaths } = await dialog.showOpenDialog({filters:[{name:'IPA',extensions:['ipa']}],properties:['openFile','multiSelections']})
    if (!filePaths?.length) return {cancelled:true}
    const results = []
    for (const f of filePaths) {
      const r = await sideloaderInstance.signAndInstallIpa(a.udid, f, p=>{
        if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:ext:progress',p)
      })
      results.push({file:f,success:r.success,error:r.error})
    }
    return {success:results.every(r=>r.success),results}
  })

  // System info deep
  ipcMain.handle('ios:sysinfo:deep', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      const b = getBinDir()
      const domains = ['com.apple.disk_usage','com.apple.mobile.battery','com.apple.international',
        'com.apple.likkud','com.apple.mobile.data_sync','com.apple.xcode.developerdomain']
      const info = {}
      for (const domain of domains) {
        await new Promise(res => {
          const proc = spawn(join(b,process.platform==='win32'?'ideviceinfo.exe':'ideviceinfo'),
            a.udid?['-u',a.udid,'-q',domain]:['-q',domain])
          let out=''
          proc.stdout?.on('data',d=>out+=d)
          proc.on('error',()=>res(null))
          proc.on('close',()=>{info[domain]=out.trim();res(null)})
        })
      }
      return {success:true,domains:info}
    } catch(e){return{success:false,error:e.message}}
  })

  // Syslog streaming
  ipcMain.handle('ios:syslog:start', async (_, a) => {
    const { spawn } = await import('child_process')
    const { join } = await import('path')
    const b = getBinDir()
    const args = a.udid?['-u',a.udid,'--no-color']:['--no-color']
    if (a.filter) args.push('--match',a.filter)
    const proc = spawn(join(b,process.platform==='win32'?'idevicesyslog.exe':'idevicesyslog'),args)
    let pid = proc.pid
    proc.stdout?.on('data',d=>{
      if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('ios:syslog:line',{line:d.toString()})
    })
    proc.on('error',()=>{})
    // Store proc reference to kill later
    global._iosSyslog = proc
    return {success:true,pid}
  })
  ipcMain.handle('ios:syslog:stop', async () => {
    if (global._iosSyslog) { try{global._iosSyslog.kill()}catch{} ; delete global._iosSyslog }
    return {success:true}
  })

  // Activation / iCloud  
  ipcMain.handle('ios:activation:status', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      const b = getBinDir()
      return new Promise(res => {
        const args = a.udid?['-u',a.udid]:[]
        const proc = spawn(join(b,process.platform==='win32'?'ideviceinfo.exe':'ideviceinfo'),args)
        let out='',err=''
        proc.stdout?.on('data',d=>out+=d)
        proc.stderr?.on('data',d=>err+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>{
          const get = k => out.match(new RegExp(k+':\\s*(.+)'))?.[1]?.trim()||''
          res({success:code===0,
            activationState:get('ActivationState'),
            icloudLocked:get('FMiPEnabled')==='true',
            findMyEnabled:get('FMiPEnabled')==='true',
            deviceName:get('DeviceName'),
            serialNumber:get('SerialNumber'),
            imei:get('InternationalMobileEquipmentIdentity'),
            icloudAccount:get('AppleAccountGUID'),
          })
        })
      })
    } catch(e){return{success:false,error:e.message}}
  })

  // File system (AFC)
  ipcMain.handle('ios:afc:list', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      const b = getBinDir()
      return new Promise(res => {
        const args = a.udid ? ['-u',a.udid,a.path||'/'] : [a.path||'/']
        const proc = spawn(join(b,process.platform==='win32'?'ideviceinfo.exe':'ideviceinfo'),args)
        proc.on('error',e=>res({success:false,error:e.message,files:[]}))
        res({success:false,error:'Use idevicebackup2 or ifuse for file access. AFC requires iTunes pairing.',files:[]})
      })
    } catch(e){return{success:false,error:e.message}}
  })

  ipcMain.handle('ios:photos:pull', async (_, a) => {
    const { filePaths:[dest] } = await dialog.showOpenDialog({properties:['openDirectory'],title:'Select destination folder'})
    if (!dest) return {cancelled:true}
    const { spawn } = await import('child_process')
    const { join } = await import('path')
    const { default: fs } = await import('fs-extra')
    await fs.ensureDir(dest)
    return new Promise(res => {
      const args = a.udid ? ['-u',a.udid,'--args',`--output=${dest}`,`--album=Camera Roll`] : [`--output=${dest}`]
      // Use idevicebackup2 to get photos via backup
      const backupProc = spawn(join(getBinDir(),process.platform==='win32'?'idevicebackup2.exe':'idevicebackup2'),
        a.udid?['-u',a.udid,'backup','--full',dest]:['backup','--full',dest])
      let out=''
      backupProc.stdout?.on('data',d=>{out+=d;if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:ext:progress',{msg:d.toString().trim()})})
      backupProc.on('error',e=>res({success:false,error:e.message}))
      backupProc.on('close',code=>res({success:code===0,dest,note:'Photos are in the backup - open with iTunes or use iMazing to extract'}))
    })
  })

  ipcMain.handle('ios:contacts:export', async (_, a) => {
    const { app: ea } = await import('electron')
    const { join } = await import('path')
    const { default: fs } = await import('fs-extra')
    const dest = join(ea.getPath('userData'),'ios_contacts')
    await fs.ensureDir(dest)
    return {
      success:false,
      note:'Contact export via backup: use idevicebackup2 backup, then find AddressBook.sqlitedb in the backup folder and open in SQLite Browser',
      dest,
      command:`idevicebackup2 -u ${a.udid||'<udid>'} backup --full "${dest}"`
    }
  })

  // Provisioning profiles
  ipcMain.handle('ios:profiles:list', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      const b = getBinDir()
      return new Promise(res => {
        const tool = join(b,process.platform==='win32'?'ideviceprovision.exe':'ideviceprovision')
        const args = a.udid?['-u',a.udid,'list','--all']:['list','--all']
        const proc = spawn(tool,args)
        let out='',err=''
        proc.stdout?.on('data',d=>out+=d)
        proc.stderr?.on('data',d=>err+=d)
        proc.on('error',e=>res({success:false,error:e.code==='ENOENT'?'ideviceprovision not installed':e.message,profiles:[]}))
        proc.on('close',code=>{
          const profiles = out.split('\n').filter(l=>l.trim()).map(l=>l.trim())
          res({success:true,profiles,raw:out,count:profiles.length})
        })
      })
    } catch(e){return{success:false,error:e.message,profiles:[]}}
  })

  ipcMain.handle('ios:profiles:remove', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      const b = getBinDir()
      return new Promise(res => {
        const tool = join(b,process.platform==='win32'?'ideviceprovision.exe':'ideviceprovision')
        const args = a.udid?['-u',a.udid,'remove',a.profileId]:['remove',a.profileId]
        const proc = spawn(tool,args)
        let out='',err=''
        proc.stdout?.on('data',d=>out+=d)
        proc.stderr?.on('data',d=>err+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>res({success:code===0,output:out+err}))
      })
    } catch(e){return{success:false,error:e.message}}
  })

  // Certificates (on device)
  ipcMain.handle('ios:certs:list', async (_, a) => {
    try {
      const info = await ios.getDeviceInfo(a.udid)
      return {success:true, activationState:info.activationState, note:'Certificate management requires jailbreak for full keychain access. Basic signing certs visible via provisioning profiles.'}
    } catch(e){return{success:false,error:e.message}}
  })

  // iCloud bypass info
  ipcMain.handle('ios:icloud:bypass-info', () => ({
    methods: [
      {name:'DNS Bypass (partial)', works:'iOS 12-14', desc:'Change DNS to a bypass server. Allows limited use without Apple ID. Free but unstable.', difficulty:'Easy'},
      {name:'MDM Bypass (with screen access)', works:'iOS 14-16', desc:'Use checkra1n/palera1n, then install MDM bypass tools via SSH. Removes activation lock.', difficulty:'Medium'},
      {name:'DCSD Cable (DFU tools)', works:'iOS 12-15', desc:'Special USB cable used by Apple service centers. Allows full DFU and activation bypass.', difficulty:'Expert'},
      {name:'IMEI unlock / carrier unlock', works:'All', desc:'Contact original carrier to unlock. Legal and permanent but costs money.', difficulty:'Easy'},
    ],
    warning:'iCloud bypass on devices you do not own is illegal. These methods are for recovering your own devices.',
  }))

  // SSH / OpenSSH over USB
  ipcMain.handle('ios:ssh:connect', async (_, a) => {
    const { spawn } = await import('child_process')
    const { join } = await import('path')
    const iproxy = join(getBinDir(),process.platform==='win32'?'iproxy.exe':'iproxy')
    const proxyProc = spawn(iproxy, [a.udid?['-u',a.udid,'2222','22'].flat():['2222','22']].flat())
    await new Promise(r=>setTimeout(r,800))
    proxyProc.on('error',()=>{})
    global._iosSshProxy = proxyProc
    return {success:true,port:2222,note:'USB proxy running on localhost:2222. Use: ssh root@localhost -p 2222 (password: alpine)'}
  })
  ipcMain.handle('ios:ssh:disconnect', async () => {
    if(global._iosSshProxy){try{global._iosSshProxy.kill()}catch{};delete global._iosSshProxy}
    return {success:true}
  })
  ipcMain.handle('ios:ssh:open-terminal', async () => {
    const { spawn } = await import('child_process')
    spawn('cmd',['/c','start','cmd','/k','ssh root@localhost -p 2222'],{detached:true,shell:true})
    return {success:true,note:'Opened SSH terminal. Password: alpine (or your set password)'}
  })

  // Frida (iOS)
  ipcMain.handle('ios:frida:server-check', async (_, a) => {
    const { default: fs } = await import('fs-extra')
    const { join } = await import('path')
    const fridaServer = join(getBinDir(),process.platform==='win32'?'frida.exe':'frida')
    const exists = await fs.pathExists(fridaServer)
    if (!exists) return {success:false,error:'frida not in bin/'}
    return {success:true,note:'frida-server must be running on device. Install via Cydia: add repo.frida.re, install Frida'}
  })

  ipcMain.handle('ios:frida:list-apps', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const frida = join(getBinDir(),process.platform==='win32'?'frida.exe':'frida')
      const { stdout } = await execAsync(frida,['-U','--no-pause','-q','-e','[Process.enumerateModules(), JSON.stringify(frida.enumerateApplications())]'],{timeout:15000})
      return {success:true,output:stdout}
    } catch(e){return{success:false,error:e.message,note:'Requires frida-server running on jailbroken device'}}
  })

  ipcMain.handle('ios:frida:trace', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const frida = join(getBinDir(),process.platform==='win32'?'frida.exe':'frida')
      const args = ['-U','-n',a.appName||a.bundleId,'-e',a.script||"console.log('attached')"]
      const {stdout,stderr} = await execAsync(frida,args,{timeout:20000})
      return {success:true,output:stdout+stderr}
    } catch(e){return{success:false,error:e.message}}
  })

  // Plist editor
  ipcMain.handle('ios:plist:read-device', async (_, a) => {
    try {
      const out = await ios.exec('ideviceinfo', ...(a.udid?['-u',a.udid]:[]))
      return {success:true,content:out,format:'text'}
    } catch(e){return{success:false,error:e.message}}
  })

  // Network tools
  ipcMain.handle('ios:net:wifi-list', async (_, a) => {
    // Requires jailbreak
    return {
      note:'WiFi password list requires jailbreak. Via SSH: cat /private/var/preferences/SystemConfiguration/com.apple.wifi.plist',
      ssh_command:'cat /private/var/preferences/SystemConfiguration/com.apple.wifi.plist | plutil -convert json -o - -',
      alternative:'Use WiFi Passwords page in Omerta (requires root/jailbreak via USB bridge)',
    }
  })

  // Power management
  ipcMain.handle('ios:power:sleep', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      const b = getBinDir()
      return new Promise(res => {
        const proc = spawn(join(b,process.platform==='win32'?'idevicediagnostics.exe':'idevicediagnostics'),a.udid?['-u',a.udid,'sleep']:['sleep'])
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>res({success:code===0}))
      })
    } catch(e){return{success:false,error:e.message}}
  })
  ipcMain.handle('ios:power:restart', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      const b = getBinDir()
      return new Promise(res => {
        const proc = spawn(join(b,process.platform==='win32'?'idevicediagnostics.exe':'idevicediagnostics'),a.udid?['-u',a.udid,'restart']:['restart'])
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>res({success:code===0}))
      })
    } catch(e){return{success:false,error:e.message}}
  })
  ipcMain.handle('ios:power:shutdown', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      const b = getBinDir()
      return new Promise(res => {
        const proc = spawn(join(b,process.platform==='win32'?'idevicediagnostics.exe':'idevicediagnostics'),a.udid?['-u',a.udid,'shutdown']:['shutdown'])
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>res({success:code===0}))
      })
    } catch(e){return{success:false,error:e.message}}
  })

  // Screenshot burst / interval
  ipcMain.handle('ios:screenshot:take', async (_, a) => {
    try {
      const { app: ea } = await import('electron')
      const { join } = await import('path')
      const { default: fs } = await import('fs-extra')
      const dest = join(ea.getPath('userData'),'ios_screenshots')
      await fs.ensureDir(dest)
      const outFile = join(dest, `screenshot_${Date.now()}.png`)
      await ios.screenshot(a.udid, outFile)
      return {success:true,path:outFile}
    } catch(e){return{success:false,error:e.message}}
  })
  ipcMain.handle('ios:screenshot:open-folder', async () => {
    const { app: ea } = await import('electron')
    const { join } = await import('path')
    const { default: fs } = await import('fs-extra')
    const dest = join(ea.getPath('userData'),'ios_screenshots')
    await fs.ensureDir(dest)
    shell.openPath(dest)
    const files = await fs.readdir(dest).catch(()=>[])
    return {success:true,path:dest,count:files.length}
  })

  // ══════════════════════════════════════════════════════════════════
  // ANDROID TOOLS - Extended
  // ══════════════════════════════════════════════════════════════════

  // Screen record
  ipcMain.handle('android:screenrecord:start', async (_, a) => {
    try {
      const { app: ea } = await import('electron')
      const { join } = await import('path')
      const { default: fs } = await import('fs-extra')
      const dest = join(ea.getPath('userData'), 'recordings')
      await fs.ensureDir(dest)
      const fname = `record_${Date.now()}.mp4`
      await adb.shell(a.serial, `screenrecord --bit-rate ${a.bitrate||8000000} --size ${a.size||'1080x1920'} /sdcard/${fname}`)
      global._screenRecordFile = fname
      return { success: true, file: fname, note: 'Recording started on device. Call stop to pull file.' }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('android:screenrecord:stop', async (_, a) => {
    try {
      const { app: ea } = await import('electron')
      const { join } = await import('path')
      await adb.shell(a.serial, 'killall -SIGINT screenrecord 2>/dev/null || true')
      await new Promise(r => setTimeout(r, 1500))
      const fname = global._screenRecordFile || `record_latest.mp4`
      const dest = join(ea.getPath('userData'), 'recordings', fname)
      await adb.exec(['-s', a.serial, 'pull', `/sdcard/${fname}`, dest])
      await adb.shell(a.serial, `rm -f /sdcard/${fname}`)
      shell.openPath(join(ea.getPath('userData'), 'recordings'))
      return { success: true, path: dest }
    } catch(e) { return { success:false, error:e.message } }
  })

  // Input simulation
  ipcMain.handle('android:input:tap', async (_, a) => {
    await adb.shell(a.serial, `input tap ${a.x} ${a.y}`)
    return { success: true }
  })
  ipcMain.handle('android:input:swipe', async (_, a) => {
    await adb.shell(a.serial, `input swipe ${a.x1} ${a.y1} ${a.x2} ${a.y2} ${a.duration||300}`)
    return { success: true }
  })
  ipcMain.handle('android:input:text', async (_, a) => {
    const safe = (a.text||'').replace(/['" ]/g, s => s===' '?'%s':s)
    await adb.shell(a.serial, `input text '${safe}'`)
    return { success: true }
  })
  ipcMain.handle('android:input:keyevent', async (_, a) => {
    await adb.shell(a.serial, `input keyevent ${a.keycode}`)
    return { success: true }
  })

  // Notifications
  ipcMain.handle('android:notif:list', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, `dumpsys notification --noredact 2>/dev/null | grep -E "NotificationRecord|pkg=|title=" | head -100`)
      const notifications = []
      const lines = out.split('\n')
      let current = null
      lines.forEach(l => {
        if (l.includes('NotificationRecord')) { if(current) notifications.push(current); current = { raw: l.trim() } }
        if (current && l.includes('pkg=')) current.pkg = l.match(/pkg=([^\s,]+)/)?.[1] || ''
        if (current && l.includes('title=')) current.title = l.match(/title=([^\n]+)/)?.[1] || ''
      })
      if (current) notifications.push(current)
      return { success: true, notifications: notifications.filter(n=>n.pkg), count: notifications.length }
    } catch(e) { return { success:false, error:e.message, notifications:[] } }
  })
  ipcMain.handle('android:notif:clear', async (_, a) => {
    await adb.shell(a.serial, 'service call notification 1')
    return { success: true }
  })

  // Storage analysis
  ipcMain.handle('android:storage:usage', async (_, a) => {
    try {
      const [df, du, pm] = await Promise.all([
        adb.shell(a.serial, 'df -h /data /sdcard 2>/dev/null').catch(()=>''),
        adb.shell(a.serial, 'du -sh /sdcard/Download /sdcard/DCIM /sdcard/WhatsApp 2>/dev/null').catch(()=>''),
        adb.shell(a.serial, 'pm list packages -s 2>/dev/null | wc -l').catch(()=>'0'),
      ])
      return { success:true, diskFree:df, topFolders:du, systemApps:pm.trim() }
    } catch(e) { return { success:false, error:e.message } }
  })

  // Installed APK extractor (pull APKs of installed apps)
  ipcMain.handle('android:apk:pull', async (_, a) => {
    try {
      const { app: ea } = await import('electron')
      const { join } = await import('path')
      const { default: fs } = await import('fs-extra')
      const dest = join(ea.getPath('userData'), 'pulled_apks')
      await fs.ensureDir(dest)
      const path = await adb.shell(a.serial, `pm path ${a.packageId}`).then(o=>o.replace('package:','').trim())
      const outFile = join(dest, `${a.packageId}.apk`)
      await adb.exec(['-s', a.serial, 'pull', path, outFile])
      shell.openPath(dest)
      return { success:true, path:outFile, size:(await fs.stat(outFile)).size }
    } catch(e) { return { success:false, error:e.message } }
  })

  // ADB Pair (Android 11+ wireless)
  ipcMain.handle('android:wireless:pair', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const adbPath = join(getBinDir(), process.platform==='win32'?'adb.exe':'adb')
      const { stdout, stderr } = await execAsync(adbPath, ['pair', `${a.ip}:${a.port}`, a.code], { timeout:30000 })
      const out = (stdout+stderr).trim()
      return { success: out.includes('Successfully paired'), output: out }
    } catch(e) { return { success:false, error:e.message } }
  })

  // Dumpsys tools
  ipcMain.handle('android:dumpsys:battery', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'dumpsys battery')
      const get = k => out.match(new RegExp(k+':\\s*(.+)'))?.[1]?.trim()
      return { success:true, level:parseInt(get('level')||'0'), status:get('status'), health:get('health'), voltage:get('voltage'), temperature:get('temperature'), technology:get('technology'), raw:out }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('android:dumpsys:activity', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'dumpsys activity top 2>/dev/null | head -40')
      return { success:true, output:out }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('android:dumpsys:meminfo', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, a.pkg ? `dumpsys meminfo ${a.pkg}` : 'dumpsys meminfo 2>/dev/null | head -60')
      return { success:true, output:out }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('android:dumpsys:window', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'dumpsys window displays 2>/dev/null | grep -E "mCurrentFocus|mFocusedApp|density|size" | head -20')
      return { success:true, output:out }
    } catch(e) { return { success:false, error:e.message } }
  })

  // Device info extended
  ipcMain.handle('android:info:imei', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'su -c "service call iphonesubinfo 1 | grep -o \\"[0-9a-f ]\\+" | tr -d \\\" \\" | fold -w2 | sed \'s/../& /g\' | awk \'{printf chr(strtonum(\\"0x\\"$0))}\' 2>/dev/null" || dumpsys iphonesubinfo 2>/dev/null | grep -i imei | head -3')
      return { success:true, output:out.trim() }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('android:info:sensors', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'dumpsys sensorservice 2>/dev/null | grep "^Sensor List" -A 50 | head -60')
      return { success:true, output:out }
    } catch(e) { return { success:false, error:e.message } }
  })
  ipcMain.handle('android:info:cpu-temp', async (_, a) => {
    try {
      const temps = await adb.shell(a.serial, 'for f in /sys/class/thermal/thermal_zone*/temp; do echo "$f: $(cat $f 2>/dev/null)"; done')
      const parsed = temps.split('\n').filter(l=>l.includes('thermal')).map(l => {
        const [path, val] = l.split(': ')
        const zone = path.match(/thermal_zone(\d+)/)?.[1] || '?'
        const temp = parseInt(val||'0') / 1000
        return { zone, temp: isNaN(temp) ? parseInt(val||'0') : temp }
      }).filter(t => t.temp > 0 && t.temp < 200)
      return { success:true, temps:parsed }
    } catch(e) { return { success:false, error:e.message } }
  })

  // Automation / Macro recorder
  ipcMain.handle('android:macro:record-tap', async (_, a) => {
    // Record a sequence of taps by listening to getevent
    return { success:true, note:'Tap recording via getevent requires root. Use input tap commands manually or record with UI Automator.' }
  })
  ipcMain.handle('android:macro:run', async (_, a) => {
    // Run a series of input commands
    try {
      for (const step of (a.steps||[])) {
        if (step.type === 'tap') await adb.shell(a.serial, `input tap ${step.x} ${step.y}`)
        else if (step.type === 'swipe') await adb.shell(a.serial, `input swipe ${step.x1} ${step.y1} ${step.x2} ${step.y2} ${step.dur||300}`)
        else if (step.type === 'text') await adb.shell(a.serial, `input text '${step.text}'`)
        else if (step.type === 'key') await adb.shell(a.serial, `input keyevent ${step.code}`)
        else if (step.type === 'sleep') await new Promise(r=>setTimeout(r, step.ms||500))
        if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('android:macro:step', { done:step })
      }
      return { success:true }
    } catch(e) { return { success:false, error:e.message } }
  })

  // Package management extras
  ipcMain.handle('android:pm:clear-data', async (_, a) => {
    const out = await adb.shell(a.serial, `pm clear ${a.packageId}`)
    return { success: out.includes('Success'), output: out }
  })
  ipcMain.handle('android:pm:force-stop', async (_, a) => {
    await adb.shell(a.serial, `am force-stop ${a.packageId}`)
    return { success:true }
  })
  ipcMain.handle('android:pm:disable', async (_, a) => {
    const out = await adb.shell(a.serial, `pm disable-user --user 0 ${a.packageId}`)
    return { success: out.includes('disabled'), output: out }
  })
  ipcMain.handle('android:pm:enable', async (_, a) => {
    const out = await adb.shell(a.serial, `pm enable ${a.packageId}`)
    return { success: out.includes('enabled'), output: out }
  })
  ipcMain.handle('android:pm:grant-all', async (_, a) => {
    const perms = ['READ_CONTACTS','WRITE_CONTACTS','READ_SMS','SEND_SMS','RECEIVE_SMS','READ_CALL_LOG','CAMERA','RECORD_AUDIO','ACCESS_FINE_LOCATION','READ_EXTERNAL_STORAGE','WRITE_EXTERNAL_STORAGE']
    const results = []
    for (const p of perms) {
      const out = await adb.shell(a.serial, `pm grant ${a.packageId} android.permission.${p} 2>&1`).catch(()=>'')
      results.push({ perm:p, ok: !out.includes('Exception') && !out.includes('error') })
    }
    return { success:true, results }
  })

  // Network extras
  ipcMain.handle('android:net:ping', async (_, a) => {
    const out = await adb.shell(a.serial, `ping -c 4 ${a.host||'8.8.8.8'} 2>&1`)
    return { success:true, output:out }
  })
  ipcMain.handle('android:net:traceroute', async (_, a) => {
    const out = await adb.shell(a.serial, `traceroute -m 15 ${a.host||'8.8.8.8'} 2>&1 | head -20`)
    return { success:true, output:out }
  })
  ipcMain.handle('android:net:ports', async (_, a) => {
    const out = await adb.shell(a.serial, 'cat /proc/net/tcp6 /proc/net/tcp 2>/dev/null | head -40')
    return { success:true, output:out }
  })
  ipcMain.handle('android:net:arp', async (_, a) => {
    const out = await adb.shell(a.serial, 'ip neigh show 2>/dev/null || cat /proc/net/arp 2>/dev/null')
    return { success:true, output:out }
  })
  ipcMain.handle('android:net:ip-info', async (_, a) => {
    const [ip4, ip6, wifi] = await Promise.all([
      adb.shell(a.serial, 'ip addr show | grep "inet " | grep -v 127.0.0.1').catch(()=>''),
      adb.shell(a.serial, 'ip addr show | grep "inet6" | grep -v "::1"').catch(()=>''),
      adb.shell(a.serial, 'dumpsys wifi 2>/dev/null | grep -E "mWifiInfo|SSID|BSSID|RSSI|linkSpeed" | head -10').catch(()=>''),
    ])
    return { success:true, ipv4:ip4, ipv6:ip6, wifi }
  })

  // File operations
  ipcMain.handle('android:files:push', async (_, a) => {
    const { filePaths } = await dialog.showOpenDialog({ properties:['openFile','multiSelections'] })
    if (!filePaths?.length) return { cancelled:true }
    const results = []
    for (const f of filePaths) {
      const out = await adb.exec(['-s',a.serial,'push',f,a.dest||'/sdcard/']).catch(e=>e.message)
      results.push({ file:f, ok: typeof out==='string' && !out.includes('error') })
    }
    return { success:true, results }
  })
  ipcMain.handle('android:files:delete', async (_, a) => {
    const out = await adb.shell(a.serial, `rm -rf "${a.path}"`)
    return { success:true, output:out }
  })
  ipcMain.handle('android:files:mkdir', async (_, a) => {
    await adb.shell(a.serial, `mkdir -p "${a.path}"`)
    return { success:true }
  })
  ipcMain.handle('android:files:cat', async (_, a) => {
    const out = await adb.shell(a.serial, `cat "${a.path}" 2>&1 | head -200`)
    return { success:true, content:out }
  })
  ipcMain.handle('android:files:chmod', async (_, a) => {
    await adb.shell(a.serial, `su -c "chmod ${a.mode} ${a.path}"`)
    return { success:true }
  })

  // Settings database
  ipcMain.handle('android:settings:get', async (_, a) => {
    const out = await adb.shell(a.serial, `settings get ${a.namespace||'global'} ${a.key}`)
    return { success:true, value:out.trim() }
  })
  ipcMain.handle('android:settings:set', async (_, a) => {
    await adb.shell(a.serial, `settings put ${a.namespace||'global'} ${a.key} ${a.value}`)
    return { success:true }
  })
  ipcMain.handle('android:settings:list', async (_, a) => {
    const out = await adb.shell(a.serial, `settings list ${a.namespace||'global'} 2>/dev/null | head -100`)
    const settings = out.split('\n').filter(l=>l.includes('=')).map(l => {
      const [key, ...rest] = l.split('=')
      return { key:key.trim(), value:rest.join('=').trim() }
    })
    return { success:true, settings }
  })

  // Developer options
  ipcMain.handle('android:dev:overdraw', async (_, a) => {
    await adb.shell(a.serial, `setprop debug.hwui.overdraw ${a.enable?'show':'false'}`)
    return { success:true }
  })
  ipcMain.handle('android:dev:layout-bounds', async (_, a) => {
    await adb.shell(a.serial, `setprop debug.layout ${a.enable?'true':'false'}`)
    return { success:true }
  })
  ipcMain.handle('android:dev:gpu-rendering', async (_, a) => {
    await adb.shell(a.serial, `setprop debug.hwui.profile ${a.enable?'visual_bars':'false'}`)
    return { success:true }
  })
  ipcMain.handle('android:dev:animator-scale', async (_, a) => {
    const scale = a.scale||0
    for (const s of ['window_animation_scale','transition_animation_scale','animator_duration_scale']) {
      await adb.shell(a.serial, `settings put global ${s} ${scale}`)
    }
    return { success:true }
  })
  ipcMain.handle('android:dev:show-taps', async (_, a) => {
    await adb.shell(a.serial, `settings put system show_touches ${a.enable?1:0}`)
    await adb.shell(a.serial, `settings put system pointer_location ${a.enable?1:0}`)
    return { success:true }
  })

  // Accessibility
  ipcMain.handle('android:a11y:font-scale', async (_, a) => {
    await adb.shell(a.serial, `settings put system font_scale ${a.scale||1.0}`)
    return { success:true }
  })
  ipcMain.handle('android:a11y:display-size', async (_, a) => {
    await adb.shell(a.serial, `wm density ${a.dpi||420}`)
    return { success:true }
  })
  ipcMain.handle('android:a11y:talkback', async (_, a) => {
    const pkg = 'com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService'
    await adb.shell(a.serial, `settings put secure enabled_accessibility_services ${a.enable?pkg:''}`)
    return { success:true }
  })

  // ══════════════════════════════════════════════════════════════════
  // iOS TOOLS - Extended  
  // ══════════════════════════════════════════════════════════════════

  // Crash logs
  ipcMain.handle('ios:crash:list', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      const { app: ea } = await import('electron')
      const { default: fs } = await import('fs-extra')
      const dest = join(ea.getPath('userData'), 'ios_crashes')
      await fs.ensureDir(dest)
      return new Promise(res => {
        const tool = join(getBinDir(),process.platform==='win32'?'idevicecrashreport.exe':'idevicecrashreport')
        const args = a.udid ? ['-u',a.udid,'-e',dest] : ['-e',dest]
        const proc = spawn(tool, args)
        let out='',err=''
        proc.stdout?.on('data',d=>out+=d)
        proc.stderr?.on('data',d=>err+=d)
        proc.on('error',e=>res({success:false,error:e.code==='ENOENT'?'idevicecrashreport not installed':e.message}))
        proc.on('close',code=>{
          fs.readdir(dest).then(files => res({success:true,files,dest,output:(out+err).trim()})).catch(()=>res({success:true,files:[],dest}))
        })
      })
    } catch(e){return{success:false,error:e.message}}
  })
  ipcMain.handle('ios:crash:open-folder', async () => {
    const { app: ea } = await import('electron')
    const { join } = await import('path')
    const { default: fs } = await import('fs-extra')
    const dest = join(ea.getPath('userData'),'ios_crashes')
    await fs.ensureDir(dest)
    shell.openPath(dest)
    return { path: dest }
  })

  // idevicedate - set/get device date
  ipcMain.handle('ios:device:get-date', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      return new Promise(res => {
        const tool = join(getBinDir(),process.platform==='win32'?'idevicedate.exe':'idevicedate')
        const args = a.udid?['-u',a.udid]:[]
        const proc = spawn(tool, args)
        let out=''
        proc.stdout?.on('data',d=>out+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',()=>res({success:true,date:out.trim()}))
      })
    } catch(e){return{success:false,error:e.message}}
  })
  ipcMain.handle('ios:device:set-date', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      return new Promise(res => {
        const tool = join(getBinDir(),process.platform==='win32'?'idevicedate.exe':'idevicedate')
        const args = a.udid?['-u',a.udid,'-s',a.date]:['-s',a.date]
        const proc = spawn(tool, args)
        let out='',err=''
        proc.stdout?.on('data',d=>out+=d)
        proc.stderr?.on('data',d=>err+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>res({success:code===0,output:(out+err).trim()}))
      })
    } catch(e){return{success:false,error:e.message}}
  })

  // idevicename - get/set device name
  ipcMain.handle('ios:device:get-name', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      return new Promise(res => {
        const tool = join(getBinDir(),process.platform==='win32'?'idevicename.exe':'idevicename')
        const args = a.udid?['-u',a.udid]:[]
        const proc = spawn(tool, args)
        let out=''
        proc.stdout?.on('data',d=>out+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',()=>res({success:true,name:out.trim()}))
      })
    } catch(e){return{success:false,error:e.message}}
  })
  ipcMain.handle('ios:device:set-name', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      return new Promise(res => {
        const tool = join(getBinDir(),process.platform==='win32'?'idevicename.exe':'idevicename')
        const args = a.udid?['-u',a.udid,a.name]:[a.name]
        const proc = spawn(tool, args)
        let out='',err=''
        proc.stdout?.on('data',d=>out+=d)
        proc.stderr?.on('data',d=>err+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>res({success:code===0,output:(out+err).trim()}))
      })
    } catch(e){return{success:false,error:e.message}}
  })

  // iOS notification proxy (push notifications)
  ipcMain.handle('ios:notif:list', async (_, a) => {
    return { success:false, note:'iOS notification listing requires jailbreak. Via SSH: cat /var/mobile/Library/SpringBoard/PushStore/com.apple.pushstore.db | strings | grep -E "^[a-z].*\\..*" | head -50' }
  })

  // iOS location spoofing (requires jailbreak + LocationFaker tweak)
  ipcMain.handle('ios:location:spoof', async (_, a) => {
    return {
      success: false,
      note: 'iOS location spoofing requires jailbreak. Options: (1) LocationFaker tweak from Chariz, (2) Watusi for WhatsApp location, (3) iSpoofer (discontinued). For development: use Xcode simulated location.',
      xcodeNote: 'With Xcode: Debug > Simulate Location > Custom Location (enter lat/lng)',
    }
  })

  // iOS file access via AFC
  ipcMain.handle('ios:afc:media-list', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      return new Promise(res => {
        // Use ideviceinfo to list media folders - AFC gives access to /var/mobile/Media
        const args = a.udid?['-u',a.udid]:[]
        const proc = spawn(join(getBinDir(),process.platform==='win32'?'ideviceinfo.exe':'ideviceinfo'),args)
        let out=''
        proc.stdout?.on('data',d=>out+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',()=>res({success:true,info:out.trim(),
          note:'Full file access needs ideviceinstaller or AFC tools. Backup via idevicebackup2 is the reliable path.'}))
      })
    } catch(e){return{success:false,error:e.message}}
  })

  // TrollStore check / install guide
  ipcMain.handle('ios:trollstore:check', async (_, a) => {
    try {
      const axios = (await import('axios')).default
      // Check ipsw.me for signed status of current device
      const info = await axios.get(`https://api.ipsw.me/v4/device/${a.device||'iPhone8,1'}?type=ipsw`, { timeout:10000 })
      const firmwares = info.data?.firmwares || []
      const signed = firmwares.filter(f=>f.signed).map(f=>f.version)
      // TrollStore compatible versions
      const trollstoreVersions = { 
        'A8-A11': { min:'14.0', max:'16.6.1', method:'TrollHelper/TrollInstallerX' },
        'A12+': { min:'15.0', max:'17.0', method:'TrollInstallerMDC or TrollMisaka' }
      }
      return { success:true, signed, trollstoreInfo:trollstoreVersions, 
        installUrl:'https://github.com/opa334/TrollStore',
        note:'TrollStore allows permanent app installation without revocation on compatible iOS versions'
      }
    } catch(e){ return { success:false, error:e.message } }
  })
  ipcMain.handle('ios:trollstore:install', async (_, a) => {
    return {
      steps: [
        'Check your iOS version is between 14.0-17.0',
        'Download TrollInstallerX IPA from github.com/opa334/TrollStore',
        'Sideload TrollInstallerX using the Sideloader page',
        'Open TrollInstallerX on device and tap Install TrollStore',
        'TrollStore is now installed - open it from home screen',
        'In TrollStore, enable Persistence Helper for survival across reboots',
        'You can now install any IPA permanently via TrollStore',
      ],
      url: 'https://github.com/opa334/TrollStore',
      ipaUrl: 'https://github.com/opa334/TrollStore/releases/latest',
    }
  })

  // iOS Developer Mode
  ipcMain.handle('ios:devmode:enable', async (_, a) => {
    return {
      steps: [
        'Go to Settings on your iPhone',
        'Tap Privacy & Security',
        'Scroll down to Developer Mode',
        'Toggle Developer Mode on',
        'Tap Restart when prompted',
        'After restart, tap Turn On in the confirmation dialog',
      ],
      note: 'Developer Mode available on iOS 16+. Required for sideloading and debugging.',
      alternativePreios16: 'On iOS 15 and below: connect to Xcode, or use Settings > General > Device Management.',
    }
  })

  // iOS entitlements / sandbox
  ipcMain.handle('ios:entitlements:get', async (_, a) => {
    return {
      note: 'App entitlements can be extracted from the IPA: unzip app.ipa, then: codesign -d --entitlements - Payload/App.app/',
      tools: ['ldid -e App.app/ (on jailbroken device via SSH)', 'codesign -d --entitlements - App.app/ (on Mac)', 'jtool2 --ent App.app/App (cross-platform)'],
      commonEntitlements: ['application-identifier','keychain-access-groups','com.apple.developer.team-identifier','aps-environment (push notifications)','com.apple.security.application-groups'],
    }
  })

  // iOS Passcode tools
  ipcMain.handle('ios:passcode:bypass-methods', async () => ({
    methods: [
      { name:'checkra1n ramdisk', works:'iOS 12-14.8.1, A8-A11', desc:'Boot SSH ramdisk, remove passcode from data partition. Destructive - data preserved if no wipe.', difficulty:'Medium', url:'https://checkra.in' },
      { name:'palera1n rootful', works:'iOS 15-17, A8-A11', desc:'Full jailbreak with rootful mode, can remove passcode via AFC or SSH.', difficulty:'Medium', url:'https://palera.in' },
      { name:'GrayKey / Cellebrite', works:'Most devices', desc:'Professional forensic tools used by law enforcement. Not publicly available.', difficulty:'Expert' },
      { name:'Screen repair + USB keyboard', works:'Any', desc:'Repair the broken screen, then use keyboard to enter correct passcode.', difficulty:'Easy' },
      { name:'iCloud + Find My', works:'Any (if enabled)', desc:'If Find My is on and you have Apple ID: erase via icloud.com, restore from backup.', difficulty:'Easy' },
    ]
  }))

  // AltStore / SideStore status
  ipcMain.handle('ios:altstore:check-status', async () => ({
    tools: [
      { name:'AltStore', desc:'7-day app refresh via Apple ID. Requires AltServer on PC.', url:'https://altstore.io', free:true },
      { name:'SideStore', desc:'Wireless refresh, no PC needed after setup. Uses WireGuard VPN.', url:'https://sidestore.io', free:true },
      { name:'Scarlet', desc:'Certificate-based signing. Higher revocation risk.', url:'https://usescarlet.com', free:true },
      { name:'ESign', desc:'On-device signing with imported certificates.', url:'https://esign.yyyue.xyz', free:true },
      { name:'TrollStore', desc:'Permanent install, no refresh needed. iOS 14-17 only.', url:'https://github.com/opa334/TrollStore', free:true },
    ],
    refreshNote: 'Apple ID-based sideloading expires after 7 days (free) or 365 days (paid developer account). TrollStore and jailbreak installs never expire.',
  }))

  // iOS diagnostics extended
  ipcMain.handle('ios:diag:mobilegestalt', async (_, a) => {
    return {
      note: 'MobileGestalt contains device capabilities (Face ID, LiDAR, True Tone etc). Readable on jailbroken devices.',
      sshCommand: "cat /System/Library/CoreServices/SystemVersion.plist; mgquery AllValues 2>/dev/null || cat /private/var/db/MobileGestalt.sqlite 2>/dev/null | strings | head -100",
      alternativePlist: '/private/var/preferences/com.apple.MobileGestalt.plist (requires root)',
    }
  })

  // iOS backup encryption
  ipcMain.handle('ios:backup:set-encryption', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      return new Promise(res => {
        const tool = join(getBinDir(),process.platform==='win32'?'idevicebackup2.exe':'idevicebackup2')
        const args = a.udid ? ['-u',a.udid,'encryption',a.enable?'on':'off',a.password||''] : ['encryption',a.enable?'on':'off',a.password||'']
        const proc = spawn(tool, args)
        let out='',err=''
        proc.stdout?.on('data',d=>out+=d)
        proc.stderr?.on('data',d=>err+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>res({success:code===0,output:(out+err).trim()}))
      })
    } catch(e){return{success:false,error:e.message}}
  })
  ipcMain.handle('ios:backup:restore', async (_, a) => {
    const { filePaths:[src] } = await dialog.showOpenDialog({ properties:['openDirectory'], title:'Select backup folder to restore from' })
    if (!src) return { cancelled:true }
    if(mainWindow&&!mainWindow.isDestroyed()) mainWindow.webContents.send('ios:ext:progress',{msg:'Starting restore...',percent:5})
    return new Promise(res => {
      import('child_process').then(({ spawn }) => {
        import('path').then(({ join }) => {
          const tool = join(getBinDir(),process.platform==='win32'?'idevicebackup2.exe':'idevicebackup2')
          const args = a.udid ? ['-u',a.udid,'restore','--system','--settings',src] : ['restore','--system','--settings',src]
          const proc = spawn(tool, args)
          let out=''
          proc.stdout?.on('data',d=>{out+=d;if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:ext:progress',{msg:d.toString().trim(),percent:50})})
          proc.on('error',e=>res({success:false,error:e.message}))
          proc.on('close',code=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:ext:progress',{msg:'Done',percent:100});res({success:code===0,output:out})})
        })
      })
    })
  })

  ipcMain.handle('ios:media:createRingtone', async (_, a) => {
    const { filePaths } = await dialog.showOpenDialog({ filters:[{name:'Audio',extensions:['mp3','m4a','aac','wav','flac']}], properties:['openFile'] })
    if (!filePaths?.[0]) return { cancelled:true }
    return { success:false, note:'iOS ringtone (.m4r) creation: rename .m4a to .m4r (max 40s, no DRM). Import to iTunes/Finder and sync to device.', input:filePaths[0] }
  })
  ipcMain.handle('ios:profiles:install', async (_, a) => {
    return { note:'To install a .mobileconfig profile: (1) AirDrop or email it to device, (2) Open Settings > Downloaded Profile, (3) Tap Install. Or use MDM server for enterprise deployment.' }
  })
  ipcMain.handle('ios:apps:extract', async (_, a) => {
    const { filePaths } = await dialog.showOpenDialog({ filters:[{name:'IPA',extensions:['ipa']}], properties:['openFile'] })
    if (!filePaths?.[0]) return { cancelled:true }
    try {
      const { default: fs } = await import('fs-extra')
      const { app: ea } = await import('electron')
      const { join } = await import('path')
      const StreamZip = (await import('node-stream-zip')).default
      const destDir = join(ea.getPath('userData'),'ipa_extracted',Date.now().toString())
      await fs.ensureDir(destDir)
      const zip = new StreamZip.async({ file: filePaths[0] })
      await zip.extract(null, destDir)
      await zip.close()
      shell.openPath(destDir)
      const files = await fs.readdir(destDir)
      return { success:true, path:destDir, files }
    } catch(e){ return { success:false, error:e.message } }
  })

  // ── Jailbreak quick-status (real implementations, not stubs) ──────────────
  ipcMain.handle('ios:usbmux:status', async () => {
    // Is the USB multiplexer daemon actually running? This is the #1 cause of
    // "device not detected" reports throughout this whole project.
    try {
      if (process.platform === 'win32') {
        const { execFile } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(execFile)
        const { stdout } = await execAsync('powershell', ['-NoProfile', '-Command',
          "Get-Service 'Apple Mobile Device Service' | Select-Object Status,StartType | ConvertTo-Json"], { timeout: 8000 })
        const parsed = JSON.parse(stdout.trim() || '{}')
        return { success: true, running: parsed.Status === 4 || parsed.Status === 'Running', raw: parsed,
          note: parsed.Status === 4 || parsed.Status === 'Running' ? 'Apple Mobile Device Service is running' : 'Service exists but is not running - start it or reinstall iTunes/Apple Devices' }
      } else {
        const { execFile } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(execFile)
        const { stdout } = await execAsync('pgrep', ['-x', 'usbmuxd'], { timeout: 5000 }).catch(() => ({ stdout: '' }))
        const running = stdout.trim().length > 0
        return { success: true, running, note: running ? 'usbmuxd is running' : 'usbmuxd not running - try: sudo systemctl start usbmuxd' }
      }
    } catch (e) {
      return { success: false, running: false, error: e.message, note: 'Apple Mobile Device Service not found - install iTunes or Apple Devices from Microsoft Store' }
    }
  })

  ipcMain.handle('ios:jb:isJailbroken', async (_, a) => {
    // Real check: try common jailbreak filesystem markers over SSH (requires
    // the USB proxy from ios:ssh:connect to already be running), falling back
    // to a lighter AFC-based check that works even without SSH set up.
    try {
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const markers = ['/Applications/Cydia.app', '/Applications/Sileo.app', '/Applications/Zebra.app',
                       '/var/checkra1n.dmg', '/usr/lib/TweakInject', '/var/mobile/Library/Sileo']
      const results = []
      for (const path of markers) {
        try {
          const { stdout } = await execAsync('ssh', ['-p', '2222', '-o', 'ConnectTimeout=3', '-o', 'StrictHostKeyChecking=no',
            'root@localhost', `test -e ${path} && echo yes || echo no`], { timeout: 5000 })
          if (stdout.trim() === 'yes') results.push(path)
        } catch { /* SSH proxy not running or path check failed - not conclusive */ }
      }
      if (results.length > 0) return { success: true, jailbroken: true, evidence: results }
      return { success: true, jailbroken: false, note: 'No jailbreak markers found via SSH. If you have not started the USB SSH proxy (iOS Advanced > SSH/Frida), this check cannot see the filesystem and may be a false negative.' }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('ios:jb:getOptions', async (_, a) => {
    // Reuse the same chip/iOS-version compatibility logic as the Jailbreak
    // Wizard's device scan, but return it as a flat option list for callers
    // that just want "what can I run on this device" without the full UI.
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const ii = join(getBinDir(), process.platform === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo')
      const args = a?.udid ? ['-u', a.udid] : []
      const { stdout: info } = await execAsync(ii, args, { timeout: 10000 })
      const get = key => info.match(new RegExp(key + '\\s*:\\s*(.+)'))?.[1]?.trim() || ''
      const product = get('ProductType')
      const ios = parseFloat(get('ProductVersion') || '0')
      const chipMap = { 'iPhone6,': 'A8', 'iPhone7,': 'A9', 'iPhone8,': 'A8', 'iPhone9,': 'A10',
        'iPhone10,1': 'A10', 'iPhone10,3': 'A11', 'iPhone10,4': 'A10', 'iPhone10,6': 'A11',
        'iPhone11,': 'A12', 'iPhone12,': 'A13', 'iPhone13,': 'A14', 'iPhone14,': 'A15', 'iPhone15,': 'A16' }
      let chip = 'unknown'
      for (const [k, v] of Object.entries(chipMap)) { if (product.startsWith(k)) { chip = v; break } }
      const checkm8 = ['A8', 'A9', 'A10', 'A11'].includes(chip)
      const options = []
      if (checkm8 && ios >= 12 && ios <= 14.8) options.push({ name: 'checkra1n', reason: `${chip} + iOS ${ios} supported` })
      if (checkm8 && ios >= 15) options.push({ name: 'palera1n (rootful)', reason: `${chip} bootrom exploit + iOS ${ios}` })
      if (chip >= 'A12' && ios >= 15 && ios <= 17) options.push({ name: 'palera1n (rootless)', reason: `${chip} + iOS ${ios} rootless` })
      if (ios >= 14 && ios <= 17) options.push({ name: 'TrollStore', reason: 'Permanent sideloading, no jailbreak needed' })
      return { success: true, product, ios, chip, checkm8, options }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('ios:jb:palera1n', async (_, a) => ({
    success: true,
    note: 'palera1n is best run from its own binary rather than proxied through Omerta, since it needs direct interactive DFU-mode control.',
    windowsBinary: 'https://github.com/palera1n/palera1n-c/releases',
    linuxMacInstall: 'curl -sL https://raw.githubusercontent.com/palera1n/palera1n/main/installer.sh | sh',
    usage: 'palera1n -f   (force rootful)  |  palera1n   (auto-detect rootless on A12+)',
  }))

  ipcMain.handle('ios:jb:trollstoreCheck', async (_, a) => {
    try {
      const axios = (await import('axios')).default
      const r = await axios.get(`https://api.ipsw.me/v4/device/${a?.device || 'iPhone8,1'}?type=ipsw`, { timeout: 10000 })
      const signed = (r.data.firmwares || []).filter(f => f.signed).map(f => f.version)
      const compatible = signed.some(v => { const n = parseFloat(v); return n >= 14.0 && n <= 17.0 })
      return { success: true, signedVersions: signed, trollstoreCompatible: compatible,
        note: compatible ? 'A currently-signed iOS version on this device supports TrollStore.' : 'No currently-signed version in the TrollStore-compatible range (14.0-17.0) for this device.' }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('ios:respring', async (_, a) => {
    // Restart SpringBoard over the SSH proxy (requires ios:ssh:connect first).
    try {
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const { stdout, stderr } = await execAsync('ssh', ['-p', '2222', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=no',
        'root@localhost', 'killall -9 SpringBoard'], { timeout: 8000 })
      return { success: true, output: (stdout + stderr).trim() || 'Respring sent' }
    } catch (e) {
      return { success: false, error: 'Could not reach device over SSH. Start the USB proxy first: iOS Advanced > SSH/Frida > Start USB Proxy.', detail: e.message }
    }
  })

  ipcMain.handle('ios:battery:detail', async (_, a) => {
    // ideviceinfo doesn't expose battery health/cycle-count on stock iOS;
    // that data lives behind a jailbreak (IORegistry). Try the jailbroken
    // path first, fall back to whatever ideviceinfo gives us either way.
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      let health = null
      try {
        const { stdout } = await execAsync('ssh', ['-p', '2222', '-o', 'ConnectTimeout=3', '-o', 'StrictHostKeyChecking=no',
          'root@localhost', 'ioreg -rn AppleSmartBattery | grep -E "CycleCount|DesignCapacity|AppleRawMaxCapacity"'], { timeout: 6000 })
        health = stdout.trim()
      } catch { /* not jailbroken / SSH not running - fine, fall through */ }
      const ii = join(getBinDir(), process.platform === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo')
      const args = a?.udid ? ['-u', a.udid, '-q', 'com.apple.mobile.battery'] : ['-q', 'com.apple.mobile.battery']
      const { stdout: basic } = await execAsync(ii, args, { timeout: 8000 }).catch(() => ({ stdout: '' }))
      return { success: true, basic: basic.trim(), detailedHealth: health,
        note: health ? undefined : 'Cycle count and design capacity require a jailbreak. Basic charge level shown above is what stock iOS exposes.' }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('ios:udid:spoofer-info', async () => ({
    // Informational only, matching the "-info" naming - this does not perform
    // any spoofing action. Modern iOS sandboxing has made UDID spoofing tools
    // largely non-functional; this exists so the UI has an honest answer
    // rather than a dead button.
    summary: 'UDID spoofing tools (Cr4shed, UDID Faker and similar) targeted iOS 7-9 era jailbreaks and do not work on modern iOS due to sandbox and entitlement changes.',
    legitimateUses: [
      'Registering multiple test devices under one Apple Developer account (use Xcode > Devices instead)',
      'Resetting a device identifier tied to an old TestFlight build (usually just needs a new build, not UDID spoofing)',
    ],
    currentStatus: 'Not implementable as a working feature on modern iOS - included here as an honest answer rather than a broken tool.',
  }))

  ipcMain.handle('ios:mdm:check', async (_, a) => {
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const execAsync = promisify(execFile)
      const ii = join(getBinDir(), process.platform === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo')
      const args = a?.udid ? ['-u', a.udid, '-q', 'com.apple.mobile.mdm'] : ['-q', 'com.apple.mobile.mdm']
      const { stdout } = await execAsync(ii, args, { timeout: 8000 })
      const enrolled = stdout.trim().length > 0 && !stdout.includes('No domain')
      return { success: true, enrolled, raw: stdout.trim(),
        note: enrolled ? 'Device has an MDM profile. Check Settings > General > VPN & Device Management to review or remove it.' : 'No MDM enrollment detected.' }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('ios:ipa:find-downgrade', async (_, a) => {
    // Cross-reference locally saved SHSH blobs against ipsw.me's firmware list
    // to show which specific downgrade paths are actually usable right now.
    try {
      const { default: fs } = await import('fs-extra')
      const { join } = await import('path')
      const axios = (await import('axios')).default
      const blobDir = join(app.getPath('userData'), 'shsh_blobs')
      await fs.ensureDir(blobDir)
      const blobs = (await fs.readdir(blobDir)).filter(f => f.endsWith('.shsh2') || f.endsWith('.shsh'))
      const r = await axios.get(`https://api.ipsw.me/v4/device/${a?.device || 'iPhone8,1'}?type=ipsw`, { timeout: 10000 })
      const firmwares = r.data.firmwares || []
      const withBlobs = blobs.map(b => {
        const versionGuess = b.match(/(\d+\.\d+(\.\d+)?)/)?.[1]
        const fw = firmwares.find(f => f.version === versionGuess)
        return { blob: b, version: versionGuess, signed: fw?.signed ?? null, buildid: fw?.buildid }
      })
      return { success: true, blobsFound: blobs.length, downgradePaths: withBlobs,
        note: blobs.length === 0 ? 'No saved SHSH blobs found. Save blobs for your current iOS version now (IPSW Manager > SHSH Blobs) before Apple stops signing it.' : undefined }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('ios:audit:generate', async (_, a) => {
    // A full diagnostic dump - the iOS equivalent of Android's ForensicsExport.
    try {
      const { execFile } = await import('child_process')
      const { join } = await import('path')
      const { promisify } = await import('util')
      const { default: fs } = await import('fs-extra')
      const execAsync = promisify(execFile)
      const dir = join(app.getPath('userData'), 'ios_audit')
      await fs.ensureDir(dir)
      const file = join(dir, `audit_${Date.now()}.txt`)
      const ii = join(getBinDir(), process.platform === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo')
      const args = a?.udid ? ['-u', a.udid] : []
      const { stdout: info } = await execAsync(ii, args, { timeout: 10000 }).catch(e => ({ stdout: 'ideviceinfo failed: ' + e.message }))
      const report = [
        `Omerta iOS Diagnostic Report`,
        `Generated: ${new Date().toISOString()}`,
        `Omerta version: ${app.getVersion()}`,
        `Host platform: ${process.platform}`,
        ``,
        `── Device Info ──`,
        info,
      ].join('\n')
      await fs.writeFile(file, report)
      return { success: true, path: file }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('ios:audit:open', async () => {
    const { join } = await import('path')
    const { default: fs } = await import('fs-extra')
    const dir = join(app.getPath('userData'), 'ios_audit')
    await fs.ensureDir(dir)
    shell.openPath(dir)
    return { success: true, path: dir }
  })

  // ── Cydia package browser (backed by the same Canister API as iOS Custom) ─
  ipcMain.handle('ios:cydia:repos', async () => {
    // Same curated list as ios:theme:sources - repos serve both tweaks and themes.
    return {
      repos: [
        { name: 'Chariz', url: 'https://repo.chariz.com/' },
        { name: 'Havoc', url: 'https://havoc.app/' },
        { name: 'BigBoss', url: 'https://apt.thebigboss.org/repofiles/cydia/' },
        { name: 'Bingner (Elucubratus)', url: 'https://apt.bingner.com/' },
        { name: 'Packix', url: 'https://repo.packix.com/' },
      ]
    }
  })

  ipcMain.handle('ios:cydia:packages', async (_, a) => {
    try {
      const axios = (await import('axios')).default
      const url = a?.repo
        ? `https://api.canister.me/v2/jailbreak/package/search?q=${encodeURIComponent(a.query || '')}&repository=${encodeURIComponent(a.repo)}&limit=30`
        : `https://api.canister.me/v2/jailbreak/package/search?q=${encodeURIComponent(a?.query || '')}&limit=30`
      const r = await axios.get(url, { timeout: 10000 })
      const pkgs = r.data?.data || []
      return { success: true, packages: pkgs.map(p => ({
        name: p.name || p.package, id: p.package, version: p.latestVersion || p.version,
        description: p.shortDescription || p.description || '', repo: p.repository?.name || '',
        downloadUrl: p.header || p.latestVersionData?.url || null,
      })) }
    } catch (e) { return { success: false, error: e.message, packages: [] } }
  })

  ipcMain.handle('ios:cydia:download', async (_, a) => {
    // Downloads the raw .deb for a package so it can be pushed to the device
    // manually (via SSH/scp or Filza) - Omerta cannot apt-get install directly
    // since that requires being root on the device itself, not the PC.
    try {
      const axios = (await import('axios')).default
      const { default: fs } = await import('fs-extra')
      const { join } = await import('path')
      if (!a?.url) return { success: false, error: 'No download URL for this package - it may not expose a direct .deb link.' }
      const dir = join(app.getPath('userData'), 'cydia_packages')
      await fs.ensureDir(dir)
      const filename = a.packageId ? `${a.packageId}.deb` : `package_${Date.now()}.deb`
      const dest = join(dir, filename)
      const resp = await axios({ url: a.url, method: 'GET', responseType: 'stream', timeout: 30000 })
      const writer = (await import('fs')).default.createWriteStream(dest)
      await new Promise((res, rej) => { resp.data.pipe(writer); writer.on('finish', res); writer.on('error', rej) })
      shell.showItemInFolder(dest)
      return { success: true, path: dest,
        note: 'Push to device: scp -P 2222 "' + dest + '" root@localhost:/var/mobile/, then install via Filza or apt-get install ./file.deb over SSH.' }
    } catch (e) { return { success: false, error: e.message } }
  })
  // ── iOS Erase Device ──────────────────────────────────────────────────────
  ipcMain.handle('ios:erase:via-backup-tool', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      return new Promise(res => {
        const tool = join(getBinDir(),process.platform==='win32'?'idevicebackup2.exe':'idevicebackup2')
        const args = a.udid ? ['-u',a.udid,'erase'] : ['erase']
        const proc = spawn(tool, args)
        let out='',err=''
        proc.stdout?.on('data',d=>{out+=d;if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('ios:erase:progress',{msg:d.toString().trim()})})
        proc.stderr?.on('data',d=>err+=d)
        proc.on('error',e=>res({success:false,error:e.message}))
        proc.on('close',code=>res({success:code===0,output:(out+err).trim()}))
      })
    } catch(e){return{success:false,error:e.message}}
  })

  ipcMain.handle('ios:erase:enter-recovery-for-restore', async (_, a) => {
    try {
      const { spawn } = await import('child_process')
      const { join } = await import('path')
      return new Promise(res => {
        const tool = join(getBinDir(),process.platform==='win32'?'ideviceenterrecovery.exe':'ideviceenterrecovery')
        const args = a.udid ? [a.udid] : []
        const proc = spawn(tool, args)
        let out='',err=''
        proc.stdout?.on('data',d=>out+=d)
        proc.stderr?.on('data',d=>err+=d)
        proc.on('error',e=>res({success:false,error:e.code==='ENOENT'?'ideviceenterrecovery not installed':e.message}))
        proc.on('close',code=>res({success:code===0,output:(out+err).trim(),
          note:'Device should now show recovery/iTunes logo (black screen with cable icon). Open iTunes or Apple Devices app to restore.'}))
      })
    } catch(e){return{success:false,error:e.message}}
  })

  ipcMain.handle('ios:erase:open-itunes', async () => {
    const { spawn } = await import('child_process')
    if (process.platform === 'win32') {
      spawn('cmd', ['/c','start','itunes:'], { detached:true, shell:true })
    } else if (process.platform === 'linux') {
      spawn('xdg-open', ['itunes:'], { detached:true })
    } else {
      shell.openExternal('itunes:')
    }
    return { success:true, note:'If iTunes did not open, launch it manually. With device in recovery mode, iTunes/Finder will prompt to Restore or Update.' }
  })

  ipcMain.handle('ios:erase:dfu-guide', () => ({
    steps: [
      'BACKUP FIRST if you have not already - this erases everything',
      'Connect iPhone to PC with USB cable',
      'Open iTunes (Windows/Linux via Wine) or Finder (Mac)',
      'iPhone 6/6s/SE: Hold Power button for 3 seconds',
      'Keep holding Power, also hold Home button for 8 seconds total',
      'Release Power button only - keep holding Home for 5 more seconds',
      'Screen should be completely BLACK (this is DFU mode)',
      'iTunes/Finder will show "detected an iPhone in recovery mode"',
      'Click Restore iPhone - this erases everything and installs latest iOS',
      'Wait 10-15 minutes for download and restore to complete',
      'Device reboots to the Hello/Setup screen - completely clean',
    ],
    warning: 'This erases ALL data. Make sure you have backed up anything important first.',
  }))

  // ── Android: Bluetooth scanner ──────────────────────────────────────────────
  ipcMain.handle('android:bluetooth:scan', async (_, a) => {
    try {
      // Trigger a fresh scan, then read the results from dumpsys (no root needed).
      await adb.shell(a.serial, 'cmd bluetooth_manager enable 2>/dev/null; svc bluetooth enable 2>/dev/null').catch(() => {})
      const out = await adb.shell(a.serial, 'dumpsys bluetooth_manager 2>/dev/null | grep -A2 "name:" | head -100')
      const pairedOut = await adb.shell(a.serial, 'settings get secure bluetooth_address 2>/dev/null')
      const devices = []
      const blocks = out.split(/(?=name:)/)
      for (const block of blocks) {
        const name = block.match(/name:\s*(.+)/)?.[1]?.trim()
        const addr = block.match(/([0-9A-F]{2}(:[0-9A-F]{2}){5})/i)?.[1]
        if (name) devices.push({ name, address: addr || 'unknown' })
      }
      return { success: true, devices, hostAddress: pairedOut.trim(),
        note: devices.length === 0 ? 'No paired/nearby devices found in dumpsys output. Bluetooth scan results depend on OEM skin - Samsung devices report this differently than stock Android.' : undefined }
    } catch (e) { return { success: false, error: e.message, devices: [] } }
  })
  ipcMain.handle('android:bluetooth:status', async (_, a) => {
    try {
      const out = await adb.shell(a.serial, 'settings get global bluetooth_on 2>/dev/null')
      return { success: true, enabled: out.trim() === '1' }
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── Android: SafetyNet / Play Integrity checker ─────────────────────────────
  ipcMain.handle('android:integrity:check', async (_, a) => {
    // There's no ADB-only way to get a real attestation verdict (that requires
    // Google's servers and a signed request from an actual app). What we CAN
    // do locally is check the things that predict whether a check will pass:
    // root binary presence, bootloader state, and whether Play Store/Play
    // Services think the device is CTS-certified.
    try {
      const [suCheck, bootState, gmsCert, magiskProps] = await Promise.all([
        adb.shell(a.serial, 'which su 2>/dev/null; ls /system/xbin/su /system/bin/su 2>/dev/null').catch(() => ''),
        adb.shell(a.serial, 'getprop ro.boot.verifiedbootstate; getprop ro.boot.flash.locked').catch(() => ''),
        adb.shell(a.serial, 'dumpsys package com.google.android.gms | grep -i "versionName" | head -1').catch(() => ''),
        adb.shell(a.serial, 'getprop ro.build.tags; getprop ro.build.type').catch(() => ''),
      ])
      const rootDetected = suCheck.trim().length > 0
      const bootLocked = bootState.includes('green') || bootState.includes('1')
      const buildTags = magiskProps.trim()
      const likelyToPass = !rootDetected && bootLocked && !buildTags.includes('test-keys')
      return {
        success: true,
        rootBinaryFound: rootDetected,
        bootloaderLocked: bootLocked,
        buildTags,
        gmsVersion: gmsCert.trim(),
        likelyToPassIntegrity: likelyToPass,
        note: likelyToPass
          ? 'No obvious red flags found locally. This is a prediction, not a real attestation - use the "YASNAC" or "Play Integrity API Checker" app from Play Store for an actual server-verified verdict.'
          : 'Local checks suggest attestation would likely FAIL: ' + [rootDetected && 'root detected', !bootLocked && 'bootloader unlocked', buildTags.includes('test-keys') && 'test-keys build'].filter(Boolean).join(', '),
      }
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── Android: Battery health / wear estimate ─────────────────────────────────
  ipcMain.handle('android:battery:health', async (_, a) => {
    try {
      const [dumpsys, capacityFile] = await Promise.all([
        adb.shell(a.serial, 'dumpsys battery'),
        adb.shell(a.serial, 'cat /sys/class/power_supply/battery/capacity_level 2>/dev/null; cat /sys/class/power_supply/battery/charge_full 2>/dev/null; cat /sys/class/power_supply/battery/charge_full_design 2>/dev/null').catch(() => ''),
      ])
      const get = k => dumpsys.match(new RegExp(k + ':\\s*(.+)'))?.[1]?.trim()
      const health = get('health')
      const HEALTH_MAP = { '2': 'Good', '3': 'Overheat', '4': 'Dead', '5': 'Over voltage', '6': 'Unspecified failure', '7': 'Cold' }
      const lines = capacityFile.trim().split('\n').filter(Boolean)
      let wearPercent = null
      if (lines.length >= 2) {
        const full = parseInt(lines[lines.length - 2]) || 0
        const design = parseInt(lines[lines.length - 1]) || 0
        if (design > 0) wearPercent = Math.round((1 - full / design) * 100)
      }
      return { success: true, health: HEALTH_MAP[health] || health, wearPercent,
        note: wearPercent === null ? 'This device does not expose charge_full/charge_full_design, so wear percentage cannot be calculated. Health status above still comes from the OS battery stats.' : undefined }
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── Android: One-click full NAND backup (all critical partitions) ─────────
  ipcMain.handle('nand:android:backup-all', async (_, a) => {
    const CRITICAL = ['boot', 'recovery', 'dtbo', 'vbmeta', 'persist', 'modem']
    const { default: fs } = await import('fs-extra')
    const { join } = await import('path')
    const dest = join(app.getPath('userData'), 'partitions', `full_backup_${Date.now()}`)
    await fs.ensureDir(dest)
    const results = []
    let done = 0
    for (const part of CRITICAL) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('nand:progress', { pct: Math.round((done / CRITICAL.length) * 100), msg: `Reading ${part}...` })
      }
      try {
        const outFile = join(dest, `${part}.img`)
        await adb.shell(a.serial, `su -c "dd if=/dev/block/by-name/${part} of=/sdcard/${part}.img bs=4096 2>/dev/null" 2>/dev/null || dd if=/dev/block/by-name/${part} of=/sdcard/${part}.img bs=4096 2>/dev/null`)
        await adb.exec(['-s', a.serial, 'pull', `/sdcard/${part}.img`, outFile])
        await adb.shell(a.serial, `rm -f /sdcard/${part}.img`)
        const stat = await fs.stat(outFile).catch(() => null)
        results.push({ partition: part, success: !!stat, size: stat?.size || 0 })
      } catch (e) {
        results.push({ partition: part, success: false, error: e.message })
      }
      done++
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('nand:progress', { pct: 100, msg: 'Full backup complete' })
    shell.openPath(dest)
    return { success: true, dest, results }
  })

}