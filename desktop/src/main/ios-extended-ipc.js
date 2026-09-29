import { join, basename } from 'path'
// iOS Extended IPC handlers -- add these to main/index.js registerAllIPC()

import {
  SHSHBlobSaver, IPSWManager, TrollStoreManager, JailbreakManager,
  CydiaManager, iOSSSHManager, BackupDecryptor,
  iCloudAdvancedDumper, iOSDiagnostics, iOSProfileManager, iOSMediaManager
} from './core/ios-extended.js'

export function registerIOSExtendedHandlers(ipcMain, dialog, shell, mainWindow) {
  function send(ch, data) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data)
  }

  const shsh = new SHSHBlobSaver()
  const ipsw = new IPSWManager()
  const trollstore = new TrollStoreManager()
  const jailbreak = new JailbreakManager()
  const cydia = new CydiaManager()
  const ssh = new iOSSSHManager()
  const backupDecrypt = new BackupDecryptor()
  const icloud = new iCloudAdvancedDumper()
  const diagnostics = new iOSDiagnostics()
  const profiles = new iOSProfileManager()
  const media = new iOSMediaManager()

  //    SHSH Blobs                                                             
  ipcMain.handle('ios:shsh:getFirmwares', (_, a) => shsh.getAllFirmwares(a.model))
  ipcMain.handle('ios:shsh:getSigned', (_, a) => shsh.getSignedFirmwares(a.model))
  
  ipcMain.handle('ios:shsh:listSaved', async () => {
    const app = (await import('electron')).app
    const { join } = await import('path')
    const dir = join(app.getPath('userData'), 'shsh_blobs')
    return shsh.loadSavedBlobs(dir)
  })

  //    IPSW                                                                   
  ipcMain.handle('ios:ipsw:search', (_, a) => ipsw.search(a.device, a.version))
  ipcMain.handle('ios:ipsw:getOta', (_, a) => ipsw.getOtaList(a.device, a.version))
  
  ipcMain.handle('ios:ipsw:restore', (_, a) => ipsw.restoreWithLibimobiledevice(a.udid, a.ipswPath, p => send('ipsw:restore:progress', p)))
  ipcMain.handle('ios:ipsw:extract', async (_, a) => {
    const { filePaths: [dest] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!dest) return { cancelled: true }
    return ipsw.extractIPSW(a.ipswPath, dest, p => send('ipsw:extract:progress', p))
  })

  //    TrollStore                                                             
  
  ipcMain.handle('ios:cydia:install', (_, a) => cydia.installDeb(a.udid, a.debPath, p => send('cydia:progress', p)))

  //    SSH                                                                     
  ipcMain.handle('ios:ssh:startProxy', (_, a) => ssh.startProxy(a.udid, a.localPort))
  ipcMain.handle('ios:ssh:commands', () => ssh.getCommands())

  //    Backup decrypt                                                         
  ipcMain.handle('ios:backup:isEncrypted', (_, a) => backupDecrypt.isEncrypted(a.backupDir))
  ipcMain.handle('ios:backup:decrypt', async (_, a) => {
    const { filePaths: [dest] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!dest) return { cancelled: true }
    return backupDecrypt.decrypt(a.backupDir, a.password, dest, p => send('backup:decrypt:progress', p))
  })
  ipcMain.handle('ios:backup:contents', (_, a) => backupDecrypt.getBackupContents(a.backupDir))
  ipcMain.handle('ios:backup:extractPhotos', async (_, a) => {
    const { filePaths: [dest] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!dest) return { cancelled: true }
    return backupDecrypt.extractAllPhotos(a.backupDir, dest, p => send('backup:photos:progress', p))
  })

  //    iCloud dump                                                            
  ipcMain.handle('ios:icloud:authenticate', (_, a) => icloud.authenticate(a.appleid, a.password))
  ipcMain.handle('ios:icloud:pull', async (_, a) => {
    const { filePaths: [dest] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!dest) return { cancelled: true }
    if (a.service === 'photos') return icloud.pullPhotos(a.appleid, a.password, dest, p => send('icloud:progress', p))
    if (a.service === 'contacts') return icloud.pullContacts(a.appleid, a.password, dest)
    return { error: 'Service not yet implemented: ' + a.service }
  })
  ipcMain.handle('ios:icloud:services', () => icloud.getAvailableServices())

  //    Deep diagnostics                                                       
  ipcMain.handle('ios:diagnostics:battery', (_, a) => diagnostics.getBatteryDeepInfo(a.udid))
  ipcMain.handle('ios:diagnostics:storage', (_, a) => diagnostics.getStorageBreakdown(a.udid))
  ipcMain.handle('ios:diagnostics:gestalt', (_, a) => diagnostics.getMobilegestalt(a.udid))
  ipcMain.handle('ios:diagnostics:thermal', (_, a) => diagnostics.getThermalState(a.udid))
  ipcMain.handle('ios:diagnostics:syslog', (_, a) => diagnostics.getSyslog(a.udid))
  ipcMain.handle('ios:diagnostics:crashLogs', async (_, a) => {
    const { filePaths: [dest] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!dest) return { cancelled: true }
    return diagnostics.getCrashLogs(a.udid, dest)
  })
  ipcMain.handle('ios:diagnostics:activation', (_, a) => diagnostics.getActivationState(a.udid))
  ipcMain.handle('ios:diagnostics:full', (_, a) => diagnostics.getFullDiagnostics(a.udid))

  //    Profile manager                                                        
  
  
  ipcMain.handle('ios:media:pushRingtone', (_, a) => media.pushRingtone(a.udid, a.m4rPath))
  ipcMain.handle('ios:media:mountMedia', async (_, a) => {
    const { filePaths: [dest] } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!dest) return { cancelled: true }
    return media.getDeviceMedia(a.udid, dest, a.type)
  })

//    Passcode / Lock bypass (own device only)                               
ipcMain.handle('ios:unlock:methods', (_, a) => {
  const ver = parseFloat(a.iosVersion || '0')
  const methods = []

  // Method 1: idevicebackup2 backup/restore trick (iOS 11+)
  methods.push({
    id: 'backup-restore',
    name: 'Backup & Restore (no passcode needed)',
    works: true,
    requiresJailbreak: false,
    requiresItunes: false,
    description: 'Create an encrypted backup, then restore -- iOS prompts to disable passcode on restore when encryption password is set differently. Works on all iOS versions.',
    steps: [
      'Connect device to PC via USB, tap Trust if prompted',
      'Run: idevicebackup2 -u <UDID> backup --full ./backup_temp',
      'Then: idevicebackup2 -u <UDID> restore --system --reboot ./backup_temp',
      'During restore, iOS may allow changing passcode',
    ],
    tool: 'idevicebackup2',
  })

  // Method 2: Recovery/DFU restore (erases device)
  methods.push({
    id: 'dfu-restore',
    name: 'DFU Restore (erases all data)',
    works: true,
    requiresJailbreak: false,
    requiresItunes: false,
    description: 'Full erase and restore via DFU mode. Removes passcode but erases all data. Works on any iOS version. Use idevicerestore or iTunes/Finder.',
    steps: [
      'Put device in DFU mode (hold Power + Home for 10s, release Power, keep Home 5s)',
      'Run: idevicerestore --erase <path-to-ipsw>',
      'Or use iTunes/Finder: it will detect DFU device and offer restore',
      'Device restores to factory state with no passcode',
    ],
    tool: 'idevicerestore',
  })

  // Method 3: checkm8 / palera1n (A8-A11, tethered)
  if (ver <= 17.0) {
    methods.push({
      id: 'checkm8',
      name: 'checkm8 Exploit (A8-A11 chips only)',
      works: true,
      requiresJailbreak: true,
      requiresItunes: false,
      description: 'Hardware exploit. Works on iPhone 6-X and equivalent iPads. Completely bypasses software passcode. Tethered -- device needs to be connected on each reboot.',
      steps: [
        'Check your device chip: iPhone X = A11, iPhone 8/8+ = A11, iPhone 7/7+ = A10, iPhone 6S/SE = A9, iPhone 6 = A8',
        'If A11 or older: run palera1n in DFU mode',
        'After jailbreak: install Filza, navigate to /private/var/Keychains/',
        'Delete keychain-2.db -- this resets the passcode to none',
        'Reboot (tethered -- must reconnect to palera1n to boot)',
      ],
      tool: 'palera1n',
    })
  }

  // Method 4: Brute force via lockdown (disabled after iOS 11.4.1)
  if (ver < 11.4) {
    methods.push({
      id: 'bruteforce',
      name: 'USB Brute Force (iOS < 11.4.1 only)',
      works: ver < 11.4,
      requiresJailbreak: false,
      requiresItunes: false,
      description: 'Before iOS 11.4.1, USB data transfer was not disabled after 1 hour. Tools could brute-force the passcode via USB. Apple patched this with USB Restricted Mode.',
      steps: [
        'Only works on iOS < 11.4.1',
        'Device must have been connected to trusted PC within last hour',
        'Use idevicebackup2 connection exploit',
        'Note: Apple patched this with USB Restricted Mode in iOS 11.4.1',
      ],
      tool: 'idevicebackup2',
    })
  }

  return methods
})

ipcMain.handle('ios:unlock:enter-dfu', async (_, a) => {
  const { udid } = a
  // Guide only - DFU requires physical button presses
  return {
    steps: {
      iphone6s_older: ['Hold Home + Power for 10 seconds', 'Release Power, keep holding Home for 5 more seconds', 'Screen stays black -- DFU mode active'],
      iphone7: ['Hold Volume Down + Power for 10 seconds', 'Release Power, keep holding Volume Down for 5 more seconds', 'Screen stays black -- DFU mode active'],
      iphone8_plus: ['Quick press Volume Up, quick press Volume Down, hold Side button until screen goes black, keep holding Side button', 'Connect to PC while holding', 'Release when iTunes/Finder says DFU mode'],
      iphoneX_plus: ['Quick press Volume Up, quick press Volume Down, hold Side button until screen goes black', 'Connect to PC while holding', 'Keep holding Side until iTunes/Finder detects'],
    }
  }
})

ipcMain.handle('ios:unlock:enter-recovery', async (_, a) => {
  const { udid } = a
  const { spawn } = await import('child_process')
  const { join } = await import('path')
  const { app: electronApp } = await import('electron')
  const binBase = electronApp.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  const tool = join(binBase, process.platform === 'win32' ? 'ideviceenterrecovery.exe' : 'ideviceenterrecovery')

  const { default: fs } = await import('fs-extra')
  if (!await fs.pathExists(tool)) {
    // Try via idevicediagnostics
    const diag = join(binBase, process.platform === 'win32' ? 'idevicediagnostics.exe' : 'idevicediagnostics')
    return new Promise(res => {
      const proc = spawn(diag, ['-u', udid, 'restart'])
      proc.on('close', () => res({ success: true, note: 'Sent restart -- hold Home/Volume Down while restarting to enter Recovery' }))
    })
  }

  return new Promise(res => {
    const proc = spawn(tool, [udid])
    proc.on('close', code => res({ success: code === 0 }))
  })
})

ipcMain.handle('ios:unlock:exit-recovery', async (_, a) => {
  const { spawn } = await import('child_process')
  const { join } = await import('path')
  const { app: electronApp } = await import('electron')
  const binBase = electronApp.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  const tool = join(binBase, process.platform === 'win32' ? 'ideviceenterrecovery.exe' : 'ideviceenterrecovery')

  return new Promise(res => {
    // irecovery -n exits recovery
    const proc = spawn(join(binBase, 'irecovery'), ['-n'])
    let out = ''
    proc.stdout?.on('data', d => out += d)
    proc.stderr?.on('data', d => out += d)
    proc.on('close', code => res({ success: code === 0, output: out }))
  })
})

//    SHSH Blob full manager                                                 
ipcMain.handle('ios:shsh:openDir', async () => {
  const { join } = await import('path')
  const { app: electronApp, shell: electronShell } = await import('electron')
  const { default: fs } = await import('fs-extra')
  const dir = join(electronApp.getPath('userData'), 'shsh_blobs')
  await fs.ensureDir(dir)
  electronShell.openPath(dir)
  return { success: true, path: dir }
})

ipcMain.handle('ios:shsh:import', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    filters: [{ name: 'SHSH Blobs', extensions: ['shsh2', 'shsh'] }],
    properties: ['openFile', 'multiSelections'],
  })
  if (!filePaths?.length) return { cancelled: true }
  const { join } = await import('path')
  const { app: electronApp } = await import('electron')
  const { default: fs } = await import('fs-extra')
  const dest = join(electronApp.getPath('userData'), 'shsh_blobs')
  await fs.ensureDir(dest)
  for (const f of filePaths) {
    await fs.copy(f, join(dest, basename(f)))
  }
  return { success: true, count: filePaths.length }
})

//    Activation Lock checker                                                
ipcMain.handle('ios:activation:check', async (_, a) => {
  const axios = (await import('axios')).default
  // Apple's public activation lock check via IMEI/serial
  try {
    const resp = await axios.get(
      `https://fmiip.apple.com/fmipservice/device/${a.serial}/getState`,
      { timeout: 10000, headers: { 'User-Agent': 'Omerta/1.0' } }
    )
    return { locked: resp.data?.locked !== false, raw: resp.data }
  } catch {
    // Fallback: check via device directly
    const { spawn } = await import('child_process')
    const { join } = await import('path')
    const { app: electronApp } = await import('electron')
    const binBase = electronApp.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
    const ideviceinfo = join(binBase, process.platform === 'win32' ? 'ideviceinfo.exe' : 'ideviceinfo')
    return new Promise(res => {
      const proc = spawn(ideviceinfo, a.udid ? ['-u', a.udid, '-q', 'com.apple.mobile.activation_state'] : ['-q', 'com.apple.mobile.activation_state'])
      let out = ''
      proc.stdout.on('data', d => out += d)
      proc.on('close', () => {
        const locked = out.includes('ActivationState') && !out.includes('Activated')
        res({ locked, raw: out, note: 'Checked via ideviceinfo activation state domain' })
      })
    })
  }
})

ipcMain.handle('ios:bypass:methods', () => {
  return [
    {
      id: 'mdm-bypass',
      name: 'MDM Profile Removal',
      type: 'MDM Lock',
      description: 'Remove MDM (Mobile Device Management) profiles from your own device. Does NOT bypass iCloud Activation Lock.',
      steps: [
        'Jailbreak required for system MDM profiles',
        'On jailbroken device: install Filza > navigate to /var/db/ConfigurationProfiles/',
        'Delete all .plist files in Settings/ folder',
        'Respring device -- MDM profile removed',
        'For non-jailbroken: MDM can only be removed by the MDM server admin or via factory restore',
      ],
      requiresJailbreak: true,
    },
    {
      id: 'icloud-bypass-info',
      name: 'iCloud Activation Lock',
      type: 'Activation Lock',
      description: 'iCloud Activation Lock cannot be bypassed on modern devices without the Apple ID credentials. The only legitimate options are: Apple Support with proof of purchase, or selling for parts.',
      steps: [
        'Option 1: Contact original owner for Apple ID credentials',
        'Option 2: Contact Apple Support with proof of purchase',
        'Option 3: If you purchased used -- seller can remove via iCloud.com > Find My > Remove device',
        'Note: Tools claiming to bypass activation lock on iOS 12+ are scams -- the hardware-level check cannot be bypassed',
        'Exception: Some very old devices (pre-A7) have documented exploits but these are obsolete',
      ],
      requiresJailbreak: false,
    },
    {
      id: 'screen-time-bypass',
      name: 'Screen Time PIN Reset',
      type: 'Screen Time',
      description: 'Reset forgotten Screen Time passcode via Apple ID or backup restore.',
      steps: [
        'Method 1: Settings > Screen Time > Change Screen Time Passcode > Forgot Passcode > use Apple ID',
        'Method 2: On jailbroken device - delete /var/mobile/Library/Preferences/com.apple.springboard.plist (contains hashed PIN)',
        'Method 3: Restore from an iCloud/iTunes backup made before Screen Time was enabled',
      ],
      requiresJailbreak: false,
    },
  ]
})

}