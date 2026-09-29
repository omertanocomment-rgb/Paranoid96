import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import plistLib from 'plist'
const plist = {
  parse: (str) => {
    if (!str || str.trim().length < 10) return {}
    try { return plistLib.parse(str) } catch(e) { return {} }
  }
}

const execFileAsync = promisify(execFile)

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  const suffix = process.platform === 'win32' ? '.exe' : ''
  return join(base, name + suffix)
}

export default class IOSCore {
  async exec(tool, ...args) {
    const { stdout } = await execFileAsync(bin(tool), args, { timeout: 30000 })
    return stdout.trim()
  }

  //    Device listing                                                       
  async listDevices() {
    try {
      const out = await this.exec('idevice_id', '-l')
      const udids = out.split('\n').filter(Boolean)
      if (!udids.length) return []
      return Promise.all(udids.map(udid => this.getDeviceInfo(udid)))
    } catch (e) {
      // idevice_id failed - common causes on Windows:
      // 1. iTunes/Apple Mobile Device Service not running
      // 2. iPhone not trusted (tap Trust on device)
      // 3. usbmuxd not available
      return []
    }
  }

  async diagnoseConnection() {
    const results = {
      idevice_id_exists: false,
      idevice_id_runs: false,
      usbmuxd_running: false,
      device_found: false,
      device_trusted: false,
      udids: [],
      raw_output: '',
      error: null,
      steps: []
    }

    // Step 1: Check binary exists
    try {
      await fs.pathExists(bin('idevice_id'))
      results.idevice_id_exists = await fs.pathExists(bin('idevice_id'))
    } catch {}

    if (!results.idevice_id_exists) {
      results.error = 'idevice_id.exe not found in bin/ folder. Run install-tools.ps1 first.'
      results.steps.push({ ok: false, msg: 'idevice_id.exe missing from bin/' })
      return results
    }
    results.steps.push({ ok: true, msg: 'idevice_id.exe found in bin/' })

    // Step 2: Try running idevice_id -l
    try {
      const out = await this.exec('idevice_id', '-l')
      results.idevice_id_runs = true
      results.raw_output = out
      const udids = out.split('\n').filter(Boolean)
      results.udids = udids
      results.device_found = udids.length > 0
      results.usbmuxd_running = true

      if (udids.length === 0) {
        results.steps.push({ ok: false, msg: 'idevice_id runs but found 0 devices' })
        results.error = 'iPhone not detected. Try: 1) Unplug and replug 2) Unlock iPhone first 3) Restart Apple Mobile Device Service'
      } else {
        results.steps.push({ ok: true, msg: 'Found ' + udids.length + ' device(s): ' + udids.join(', ') })

        // Step 3: Try to read device info (requires trust)
        try {
          const info = await this.exec('ideviceinfo', '-u', udids[0], '-k', 'DeviceName')
          results.device_trusted = true
          results.steps.push({ ok: true, msg: 'Device trusted. Name: ' + info.trim() })
        } catch (e2) {
          results.device_trusted = false
          const msg = e2.message || ''
          if (msg.includes('passcode') || msg.includes('password') || msg.includes('lockdown')) {
            results.error = 'iPhone is locked. Unlock it first, then try again.'
            results.steps.push({ ok: false, msg: 'Device locked - unlock iPhone screen first' })
          } else {
            results.error = 'Device found but not trusted. On your iPhone, look for "Trust This Computer?" and tap Trust.'
            results.steps.push({ ok: false, msg: 'Not trusted - tap Trust on iPhone popup' })
          }
        }
      }
    } catch (e) {
      results.idevice_id_runs = false
      results.raw_output = e.message
      const msg = e.message || ''
      results.steps.push({ ok: false, msg: 'idevice_id failed: ' + msg.slice(0, 100) })

      if (msg.includes('usbmuxd') || msg.includes('No such file') || msg.includes('connect')) {
        results.error = 'Cannot connect to Apple USB service (usbmuxd). Install iTunes or Apple Devices from Microsoft Store, then restart your PC.'
        results.usbmuxd_running = false
      } else if (msg.includes('DLL') || msg.includes('module')) {
        results.error = 'Missing DLL - libimobiledevice files may be incomplete. Re-run install-tools.ps1.'
      } else {
        results.error = 'idevice_id error: ' + msg.slice(0, 200)
      }
    }

    return results
  }

  // Try to trigger the trust dialog by running idevicepair pair
  async triggerTrustDialog(udid) {
    return new Promise(async (resolve) => {
      const args = udid ? ['-u', udid, 'pair'] : ['pair']
      const proc = spawn(bin('idevicepair'), args)
      let out = ''
      proc.stdout.on('data', d => out += d)
      proc.stderr.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => {
        const lower = out.toLowerCase()
        if (lower.includes('success')) resolve({ success: true, msg: 'Paired successfully' })
        else if (lower.includes('dialog') || lower.includes('trust')) resolve({ success: false, msg: 'Trust dialog shown on iPhone - tap Trust now', needsTap: true })
        else if (lower.includes('passcode')) resolve({ success: false, msg: 'Unlock your iPhone first, then try again' })
        else resolve({ success: code === 0, msg: out.trim().slice(0, 200) })
      })
      setTimeout(() => proc.kill(), 15000)
    })
  }

  async getDeviceInfo(udid) {
    try {
      // Pull all domains for maximum info
      const args = udid ? ['-u', udid] : []
      const xml = await this.exec('ideviceinfo', ...args)
      if (!xml || xml.trim().length < 10) return { udid, type:'ios', name:'iOS Device', error:'No data returned' }
      const info = plist.parse(xml)

      // Pull extra domains
      const domains = ['com.apple.mobile.battery', 'com.apple.disk_usage', 'com.apple.mobile.data_sync']
      const extra = {}
      for (const domain of domains) {
        try {
          const domArgs = udid ? ['-u', udid, '-q', domain] : ['-q', domain]
          const domXml = await this.exec('ideviceinfo', ...domArgs)
          if (domXml && domXml.trim().length > 10) Object.assign(extra, plist.parse(domXml))
        } catch {}
      }

      // Map human-readable model names
      const MODEL_MAP = {
        'iPhone1,1':'iPhone 2G','iPhone1,2':'iPhone 3G','iPhone2,1':'iPhone 3GS',
        'iPhone3,1':'iPhone 4','iPhone3,3':'iPhone 4 (CDMA)','iPhone4,1':'iPhone 4S',
        'iPhone5,1':'iPhone 5','iPhone5,2':'iPhone 5','iPhone5,3':'iPhone 5C','iPhone5,4':'iPhone 5C',
        'iPhone6,1':'iPhone 5S','iPhone6,2':'iPhone 5S','iPhone7,1':'iPhone 6 Plus','iPhone7,2':'iPhone 6',
        'iPhone8,1':'iPhone 6S','iPhone8,2':'iPhone 6S Plus','iPhone8,4':'iPhone SE (1st)',
        'iPhone9,1':'iPhone 7','iPhone9,3':'iPhone 7','iPhone9,2':'iPhone 7 Plus','iPhone9,4':'iPhone 7 Plus',
        'iPhone10,1':'iPhone 8','iPhone10,4':'iPhone 8','iPhone10,2':'iPhone 8 Plus','iPhone10,5':'iPhone 8 Plus',
        'iPhone10,3':'iPhone X','iPhone10,6':'iPhone X',
        'iPhone11,2':'iPhone XS','iPhone11,4':'iPhone XS Max','iPhone11,6':'iPhone XS Max','iPhone11,8':'iPhone XR',
        'iPhone12,1':'iPhone 11','iPhone12,3':'iPhone 11 Pro','iPhone12,5':'iPhone 11 Pro Max','iPhone12,8':'iPhone SE (2nd)',
        'iPhone13,1':'iPhone 12 mini','iPhone13,2':'iPhone 12','iPhone13,3':'iPhone 12 Pro','iPhone13,4':'iPhone 12 Pro Max',
        'iPhone14,2':'iPhone 13 Pro','iPhone14,3':'iPhone 13 Pro Max','iPhone14,4':'iPhone 13 mini','iPhone14,5':'iPhone 13',
        'iPhone14,6':'iPhone SE (3rd)','iPhone14,7':'iPhone 14','iPhone14,8':'iPhone 14 Plus',
        'iPhone15,2':'iPhone 14 Pro','iPhone15,3':'iPhone 14 Pro Max',
        'iPhone15,4':'iPhone 15','iPhone15,5':'iPhone 15 Plus',
        'iPhone16,1':'iPhone 15 Pro','iPhone16,2':'iPhone 15 Pro Max',
        'iPhone17,1':'iPhone 16 Pro','iPhone17,2':'iPhone 16 Pro Max','iPhone17,3':'iPhone 16','iPhone17,4':'iPhone 16 Plus',
        'iPad1,1':'iPad 1','iPad2,1':'iPad 2','iPad3,1':'iPad 3','iPad4,1':'iPad Air',
        'iPad5,3':'iPad Air 2','iPad6,11':'iPad 5','iPad7,5':'iPad 6','iPad7,11':'iPad 7',
        'iPad11,6':'iPad 8','iPad12,1':'iPad 9','iPad13,18':'iPad 10',
        'iPad6,3':'iPad Pro 9.7','iPad7,3':'iPad Pro 10.5','iPad8,1':'iPad Pro 11 (1st)',
        'iPad8,9':'iPad Pro 11 (2nd)','iPad13,4':'iPad Pro 11 (3rd)','iPad14,3':'iPad Pro 11 (4th)',
        'iPad6,7':'iPad Pro 12.9 (1st)','iPad7,1':'iPad Pro 12.9 (2nd)','iPad8,5':'iPad Pro 12.9 (3rd)',
        'iPad8,11':'iPad Pro 12.9 (4th)','iPad13,8':'iPad Pro 12.9 (5th)','iPad14,5':'iPad Pro 12.9 (6th)',
        'iPad5,1':'iPad mini 4','iPad11,1':'iPad mini 5','iPad14,1':'iPad mini 6',
      }

      const productType = info.ProductType || ''
      const modelName = MODEL_MAP[productType] || info.HardwareModel || productType

      // Storage
      const totalBytes = extra.TotalDiskCapacity || info.TotalDiskCapacity || 0
      const freeBytes = extra.AmountDataAvailable || info.AmountDataAvailable || 0
      const usedBytes = totalBytes - freeBytes

      // Battery
      const battPct = extra.BatteryCurrentCapacity ?? info.BatteryCurrentCapacity ?? null

      return {
        // Identity
        udid: info.UniqueDeviceID || udid,
        type: 'ios',
        name: info.DeviceName || 'iOS Device',
        productType,
        modelName,
        deviceClass: info.DeviceClass || '',  // iPhone, iPad, iPod

        // Software
        ios: info.ProductVersion || '',
        build: info.BuildVersion || '',
        firmwareVersion: info.FirmwareVersion || '',
        kernelVersion: info.KernelVersion || '',
        jailbroken: false,

        // Hardware
        serial: info.SerialNumber || '',
        ecid: info.UniqueChipID ? info.UniqueChipID.toString(16).toUpperCase() : '',
        cpuArch: info.CPUArchitecture || '',
        hardwareModel: info.HardwareModel || '',
        boardConfig: info.BoardId?.toString(16) || '',

        // Network / Radio
        imei: info.InternationalMobileEquipmentIdentity || info.IMEI || '',
        imei2: info.InternationalMobileEquipmentIdentity2 || '',
        meid: info.MobileEquipmentIdentifier || '',
        iccid: info.IntegratedCircuitCardIdentity || '',
        wifi: info.WiFiAddress || '',
        bluetooth: info.BluetoothAddress || '',

        // Storage
        totalDisk: totalBytes,
        freeDisk: freeBytes,
        usedDisk: usedBytes,
        totalDiskGb: totalBytes ? (totalBytes/1e9).toFixed(1) : null,
        freeDiskGb: freeBytes ? (freeBytes/1e9).toFixed(1) : null,
        usedDiskGb: usedBytes ? (usedBytes/1e9).toFixed(1) : null,
        diskPercent: totalBytes ? Math.round(usedBytes/totalBytes*100) : null,

        // Battery
        batteryLevel: battPct,
        chargingState: extra.BatteryIsCharging ? 'Charging' : 'On battery',

        // Security / Activation
        activationState: info.ActivationState || '',
        passcodeState: info.PasswordProtected ? 'Enabled' : 'Disabled',
        dataProtectionClass: info.DataProtectionClass || '',
        securityDomain: info.SecurityDomain?.toString() || '',
        supportsEncryption: info.SupportsEncryptedBackups ? 'Yes' : 'Unknown',
        obliterationRequired: info.ObliterationRequired ? 'Yes' : 'No',

        // Carrier
        carrier: info.CarrierName || '',
        carrierBundleVersion: info.CarrierBundleVersion || '',
        simStatus: info.SIMStatus || '',
        phoneNumber: info.PhoneNumber || '',

        // Capabilities
        supportsWifi: info.WiFiAddress ? 'Yes' : 'Unknown',
        supportsCamera: info.HasSinaWeibo !== undefined ? 'Yes' : 'Unknown',
        supportsGPS: info.GPSCapability ? 'Yes' : 'Unknown',
        nfcCapable: info.NFCCapable ? 'Yes' : 'No',
        supportsHEVC: info.SupportsHEVC ? 'Yes' : 'Unknown',

        // Misc
        color: info.DeviceColor || '',
        enclosureColor: info.EnclosureColor || '',
        regionInfo: info.RegionInfo || '',
        modelNumber: info.ModelNumber || '',

        // Raw plist for advanced users
        _raw: info,
      }
    } catch (e) {
      return { udid, type: 'ios', name: 'iOS Device', error: e.message }
    }
  }

  //    File operations                                                       
  async listFiles(udid, path = '/') {
    try {
      const out = await this.exec('ifuse', '--udid', udid, '--list', path)
      return out.split('\n').filter(Boolean).map(line => {
        const [perms, , , , size, ...nameParts] = line.split(/\s+/)
        return {
          name: nameParts.join(' '),
          size: parseInt(size) || 0,
          isDir: perms.startsWith('d'),
          permissions: perms,
          path: `${path}/${nameParts.join(' ')}`
        }
      })
    } catch { return [] }
  }

  async pushFile(udid, localPath, remotePath, onProgress) {
    return new Promise(async (resolve, reject) => {
      const proc = spawn(bin('ideviceinstaller'), ['--udid', udid, '--copy', localPath, '--to', remotePath])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error('Push failed')))
      if (onProgress) {
        let done = 0, total = fs.statSync(localPath).size
        proc.stdout.on('data', d => { done += d.length; onProgress({ percent: Math.min(99, Math.round(done / total * 100)) }) })
      }
    })
  }

  async pullFile(udid, remotePath, localDir, onProgress) {
    const filename = remotePath.split('/').pop()
    const dest = join(localDir, filename)
    return new Promise(async (resolve, reject) => {
      const proc = spawn(bin('ifuse'), ['--udid', udid, '--copy', remotePath, '--to', dest])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true, dest }) : reject(new Error('Pull failed')))
    })
  }

  async deleteFile(udid, path) {
    return this.exec('ifuse', '--udid', udid, '--delete', path)
  }

  //    App management                                                        
  async listApps(udid) {
    try {
      const out = await this.exec('ideviceinstaller', '-u', udid, '-l', '-o', 'list_all')
      return out.split('\n').slice(1).filter(Boolean).map(line => {
        const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
        return { pkg: parts[0], name: parts[1] || parts[0], version: parts[2] || '' }
      })
    } catch { return [] }
  }

  async uninstallApp(udid, pkg) {
    return this.exec('ideviceinstaller', '-u', udid, '-U', pkg)
  }

  async extractIpa(udid, pkg, destDir) {
    const outPath = join(destDir, pkg + '.ipa')
    await this.exec('ideviceinstaller', '-u', udid, '-c', pkg, '-o', 'copy', '-o', outPath)
    return { success: true, path: outPath }
  }

  //    Backup & Restore                                                       
  async backup(udid, destDir, onProgress) {
    return new Promise(async (resolve, reject) => {
      const proc = spawn(bin('idevicebackup2'), ['backup', '--full', '--udid', udid, destDir])
      let output = ''
      proc.stdout.on('data', d => {
        output += d.toString()
        const m = output.match(/(\d+(\.\d+)?)\s*%/)
        if (m && onProgress) onProgress({ percent: parseFloat(m[1]), message: output.split('\n').pop() })
      })
      proc.stderr.on('data', d => { output += d.toString() })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true, dest: destDir }) : reject(new Error(output)))
    })
  }

  async restore(udid, backupDir, onProgress) {
    return new Promise(async (resolve, reject) => {
      const proc = spawn(bin('idevicebackup2'), ['restore', '--udid', udid, backupDir])
      proc.stdout.on('data', d => {
        const m = d.toString().match(/(\d+(\.\d+)?)\s*%/)
        if (m && onProgress) onProgress({ percent: parseFloat(m[1]) })
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error('Restore failed')))
    })
  }

  //    Battery info                                                           
  async getBatteryInfo(udid) {
    try {
      const xml = await this.exec('ideviceinfo', '-u', udid, '-q', 'com.apple.mobile.battery')
      const info = plist.parse(xml)
      return {
        level: info.BatteryCurrentCapacity || 0,
        charging: info.ExternalChargeCapable || false,
        cycleCount: info.CycleCount || 0,
        designCapacity: info.DesignCapacity || 0,
        fullyCharged: info.FullyCharged || false,
        temperature: ((info.BatteryTemperature || 0) / 100).toFixed(1) + ' C'
      }
    } catch { return {} }
  }

  //    Screenshot                                                             
  async screenshot(udid) {
    const tmp = join(app.getPath('temp'), 'ft_ios_ss.png')
    await this.exec('idevicescreenshot', '-u', udid, tmp)
    const data = await fs.readFile(tmp)
    return { base64: data.toString('base64'), mimeType: 'image/png' }
  }

  //    Permissions                                                           
  async getPermissions(udid) {
    return []
  }

  //    Network                                                               
  async getNetworkInfo(udid) {
    try {
      const xml = await this.exec('ideviceinfo', '-u', udid, '-q', 'com.apple.wifi')
      return plist.parse(xml)
    } catch { return {} }
  }

  async getCarrierInfo(udid) {
    try {
      const xml = await this.exec('ideviceinfo', '-u', udid, '-q', 'com.apple.carrier')
      return plist.parse(xml)
    } catch { return {} }
  }

  //    Tracker scan                                                          
  async scanTrackers(udid) {
    const apps = await this.listApps(udid)
    const trackerKeywords = ['analytics', 'tracking', 'amplitude', 'mixpanel', 'braze', 'appsflyer', 'adjust', 'firebase']
    return apps.filter(a => trackerKeywords.some(k => a.pkg.toLowerCase().includes(k)))
  }

  //    Trust / Pairing                                                       
  async pairDevice(udid) {
    // idevicepair pair -- initiates the trust handshake
    // On a broken-screen device this completes without needing screen interaction
    // IF the device was previously trusted OR if it's in recovery/DFU mode
    return new Promise(async (resolve) => {
      const proc = spawn(bin('idevicepair'), udid ? ['-u', udid, 'pair'] : ['pair'])
      let out = ''
      proc.stdout.on('data', d => out += d.toString())
      proc.stderr.on('data', d => out += d.toString())

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => {
        const success = out.toLowerCase().includes('success') || code === 0
        const needsTrust = out.toLowerCase().includes('dialog') || out.toLowerCase().includes('trust')
        const locked = out.toLowerCase().includes('password protected') || out.toLowerCase().includes('passcode')
        resolve({ success, needsTrust, locked, output: out.trim(), code })
      })
    })
  }

  async validatePair(udid) {
    return new Promise(async (resolve) => {
      const proc = spawn(bin('idevicepair'), udid ? ['-u', udid, 'validate'] : ['validate'])
      let out = ''
      proc.stdout.on('data', d => out += d.toString())
      proc.stderr.on('data', d => out += d.toString())

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => {
        resolve({
          trusted: code === 0 && out.toLowerCase().includes('success'),
          output: out.trim(), code
        })
      })
    })
  }

  async unpair(udid) {
    return new Promise(async (resolve) => {
      const proc = spawn(bin('idevicepair'), udid ? ['-u', udid, 'unpair'] : ['unpair'])
      let out = ''
      proc.stdout.on('data', d => out += d.toString())

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => resolve({ success: code === 0, output: out.trim() }))
    })
  }

  async listPairedDevices() {
    // idevicepair list -- shows all paired device UDIDs
    return new Promise(async (resolve) => {
      const proc = spawn(bin('idevicepair'), ['list'])
      let out = ''
      proc.stdout.on('data', d => out += d.toString())

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => resolve(out.split('\n').filter(Boolean)))
    })
  }

  // Wireless pairing via idevicepair over network (iOS 16+)
  async startWirelessPairing(udid) {
    return new Promise(async (resolve) => {
      const proc = spawn(bin('idevicepair'), ['-u', udid, 'pair', '-n'])
      let out = ''
      proc.stdout.on('data', d => out += d.toString())

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => resolve({ success: code === 0, output: out.trim() }))
    })
  }


  //    Force Trust (multiple methods)                                      
  async forceTrust(udid) {
    const results = []

    // Method 1: idevicepair pair
    try {
      const r1 = await new Promise(res => {
        const proc = spawn(bin('idevicepair'), udid ? ['-u', udid, 'pair'] : ['pair'])
        let out = ''
        proc.stdout.on('data', d => out += d)
        proc.stderr.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => res({ code, out: out.trim() }))
        setTimeout(() => { proc.kill(); res({ code: -1, out: 'timeout' }) }, 10000)
      })
      const success = r1.code === 0 && r1.out.toLowerCase().includes('success')
      const needsTap = r1.out.toLowerCase().includes('dialog') || r1.out.toLowerCase().includes('trust')
      results.push({ method: 'idevicepair', success, needsTap, output: r1.out })
      if (success) return { success: true, method: 'idevicepair', results }
    } catch (e) { results.push({ method: 'idevicepair', success: false, error: e.message }) }

    // Method 2: idevicepair with network flag (iOS 16+)
    try {
      const r2 = await new Promise(res => {
        const proc = spawn(bin('idevicepair'), udid ? ['-u', udid, 'pair', '-n'] : ['pair', '-n'])
        let out = ''
        proc.stdout.on('data', d => out += d)
        proc.stderr.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => res({ code, out: out.trim() }))
        setTimeout(() => { proc.kill(); res({ code: -1, out: 'timeout' }) }, 10000)
      })
      results.push({ method: 'idevicepair-network', success: r2.code === 0, output: r2.out })
    } catch (e) { results.push({ method: 'idevicepair-network', success: false, error: e.message }) }

    // Method 3: ideviceinfo to trigger lockdown connection
    try {
      const r3 = await new Promise(res => {
        const proc = spawn(bin('ideviceinfo'), udid ? ['-u', udid] : [])
        let out = ''
        proc.stdout.on('data', d => out += d)
        proc.stderr.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => res({ code, out: out.slice(0, 200) }))
        setTimeout(() => { proc.kill(); res({ code: -1, out: 'timeout' }) }, 8000)
      })
      results.push({ method: 'ideviceinfo-connect', success: r3.code === 0, output: r3.out })
      if (r3.code === 0) return { success: true, method: 'ideviceinfo', results }
    } catch (e) { results.push({ method: 'ideviceinfo', success: false, error: e.message }) }

    const anySuccess = results.some(r => r.success)
    const needsTap = results.some(r => r.needsTap)
    return {
      success: anySuccess,
      needsTap,
      results,
      message: needsTap
        ? 'Trust dialog sent to iPhone - tap Trust and enter passcode on device'
        : anySuccess
          ? 'Trust established'
          : 'Could not establish trust - unlock iPhone, plug in, and try again'
    }
  }

  //    Keychain / Password Extraction (jailbroken only)                    
  async extractKeychain(udid, method = 'keychain-dumper') {
    // Uses keychain-dumper on jailbroken device via SSH/AFC
    const note = 'Requires jailbroken device with keychain-dumper installed'

    if (method === 'info') {
      return {
        available: false,
        note,
        methods: [
          {
            name: 'keychain-dumper (Cydia)',
            steps: [
              'Install keychain-dumper from Cydia (add repo: https://github.com/ptoomey3/keychain-dumper)',
              'In Omerta Terminal: SSH to device via iproxy',
              'Run: /usr/bin/keychain-dumper',
              'Output contains all stored passwords, certificates, keys'
            ]
          },
          {
            name: 'idevicebackup2 (no jailbreak - limited)',
            steps: [
              'Create encrypted backup: idevicebackup2 backup --full ./backup',
              'Use Omerta SHSH - Backup Decrypt to open it',
              'Keychain items in encrypted backups can be decrypted with the backup password',
              'Note: Only items marked "ThisDeviceOnly" cannot be extracted'
            ]
          },
          {
            name: 'Filza File Manager (jailbroken)',
            steps: [
              'Install Filza from Cydia/Sileo',
              'Navigate to /private/var/Keychains/',
              'Copy keychain-2.db to /var/mobile/Media/',
              'Pull via: idevicebackup2 or idevicectl'
            ]
          }
        ]
      }
    }

    // Try to pull keychain DB via idevicebackup2 if available
    try {
      const keychainPath = '/private/var/Keychains/keychain-2.db'
      const destDir = join(app.getPath('userData'), 'ios_keychain')
      await fs.ensureDir(destDir)

      return new Promise(async (res) => {
        const proc = spawn(bin('idevicebackup2'), udid
          ? ['-u', udid, 'afc', keychainPath, destDir]
          : ['afc', keychainPath, destDir])
        let out = ''
        proc.stdout.on('data', d => out += d)
        proc.stderr.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => res({
          success: code === 0,
          path: code === 0 ? join(destDir, 'keychain-2.db') : null,
          output: out,
          note: code !== 0 ? 'Direct keychain access requires jailbreak. Use backup method instead.' : 'Keychain DB extracted'
        }))
      })
    } catch (e) {
      return { success: false, error: e.message, note }
    }
  }

  //    SMS / Messages Export                                               
  async exportMessages(udid, format = 'json') {
    const { app: electronApp } = await import('electron')
    const destDir = join(electronApp.getPath('userData'), 'ios_messages')
    await fs.ensureDir(destDir)

    // Pull SMS database from backup
    // sms.db is at Library/SMS/sms.db in the backup
    const backupDir = join(electronApp.getPath('userData'), 'ios_backup_temp')

    return new Promise(async (res) => {
      // Create a minimal backup to extract SMS
      const proc = spawn(bin('idevicebackup2'), udid
        ? ['-u', udid, 'backup', '--full', backupDir]
        : ['backup', '--full', backupDir])

      let progress = 0
      proc.stdout.on('data', d => {
        const m = d.toString().match(/(\d+)%/)
        if (m) progress = parseInt(m[1])
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async code => {
        if (code !== 0) {
          res({ success: false, error: 'Backup failed - check device is trusted' })
          return
        }

        // Find SMS db in backup (hash-based path)
        try {
          const files = await fs.readdir(backupDir)
          const backupSubDir = files.find(f => /[a-f0-9]{40}/.test(f))
          if (backupSubDir) {
            const smsHashPath = join(backupDir, backupSubDir)
            // SMS db hash is 3d0d7e5fb2ce288813306e4d4636395e047a3d28
            const smsDb = join(smsHashPath, '3d0d7e5fb2ce288813306e4d4636395e047a3d28')
            if (await fs.pathExists(smsDb)) {
              const dest = join(destDir, 'sms.db')
              await fs.copy(smsDb, dest)
              res({ success: true, path: dest, format: 'SQLite', note: 'Open in Omerta SQLite Browser to read messages' })
              return
            }
          }
          res({ success: false, error: 'SMS database not found in backup', backupDir })
        } catch (e) {
          res({ success: false, error: e.message })
        }
      })
    })
  }

  //    Full iOS Forensic Extraction                                        
  async forensicExtract(udid, options = {}, onProgress) {
    const { app: electronApp, dialog: electronDialog } = await import('electron')
    const destDir = options.destDir || join(electronApp.getPath('userData'), 'ios_forensic_' + Date.now())
    await fs.ensureDir(destDir)
    const results = { destDir, files: [], errors: [] }

    onProgress?.({ percent: 5, message: 'Starting iOS forensic extraction...' })

    // 1. Device info
    try {
      const xml = await this.exec('ideviceinfo', ...(udid ? ['-u', udid] : []))
      await fs.writeFile(join(destDir, 'device_info.plist'), xml)
      results.files.push('device_info.plist')
      onProgress?.({ percent: 10, message: 'Device info extracted' })
    } catch (e) { results.errors.push('device_info: ' + e.message) }

    // 2. Crash logs
    try {
      const crashDir = join(destDir, 'crash_logs')
      await fs.ensureDir(crashDir)
      await new Promise(res => {
        const proc = spawn(bin('idevicecrashreport'), udid ? ['-u', udid, crashDir] : [crashDir])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', res)
      })
      results.files.push('crash_logs/')
      onProgress?.({ percent: 20, message: 'Crash logs extracted' })
    } catch (e) { results.errors.push('crash_logs: ' + e.message) }

    // 3. Syslog snapshot
    try {
      const logOut = await new Promise(res => {
        const proc = spawn(bin('idevicesyslog'), udid ? ['-u', udid, '--no-color'] : ['--no-color'])
        let out = ''
        proc.stdout.on('data', d => out += d)
        setTimeout(() => { proc.kill(); res(out) }, 3000)
      })
      await fs.writeFile(join(destDir, 'syslog.txt'), logOut)
      results.files.push('syslog.txt')
      onProgress?.({ percent: 30, message: 'Syslog captured' })
    } catch (e) { results.errors.push('syslog: ' + e.message) }

    // 4. App list
    try {
      const apps = await this.listApps(udid)
      await fs.writeJson(join(destDir, 'installed_apps.json'), apps, { spaces: 2 })
      results.files.push('installed_apps.json')
      onProgress?.({ percent: 40, message: `App list extracted (${apps.length} apps)` })
    } catch (e) { results.errors.push('apps: ' + e.message) }

    // 5. Full backup (main data extraction)
    onProgress?.({ percent: 45, message: 'Starting full backup (this takes a while)...' })
    try {
      const backupDir = join(destDir, 'backup')
      await fs.ensureDir(backupDir)
      await new Promise(async (res, rej) => {
        const args = udid ? ['-u', udid, 'backup', '--full', backupDir] : ['backup', '--full', backupDir]
        const proc = spawn(bin('idevicebackup2'), args)
        proc.stdout.on('data', d => {
          const m = d.toString().match(/(\d+)%/)
          if (m) onProgress?.({ percent: 45 + Math.round(parseInt(m[1]) * 0.4), message: 'Backup: ' + m[1] + '%' })
        })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? res() : rej(new Error('Backup failed')))
      })
      results.files.push('backup/')
      onProgress?.({ percent: 85, message: 'Backup complete' })
    } catch (e) { results.errors.push('backup: ' + e.message) }

    // 6. Screenshot
    try {
      const ssData = await this.screenshot(udid)
      if (ssData?.base64) {
        await fs.writeFile(join(destDir, 'screenshot.png'), Buffer.from(ssData.base64, 'base64'))
        results.files.push('screenshot.png')
      }
      onProgress?.({ percent: 90, message: 'Screenshot taken' })
    } catch (e) { results.errors.push('screenshot: ' + e.message) }

    // 7. Network info
    try {
      const net = await this.getNetworkInfo(udid)
      await fs.writeJson(join(destDir, 'network_info.json'), net, { spaces: 2 })
      results.files.push('network_info.json')
    } catch (e) {}

    onProgress?.({ percent: 100, message: 'Extraction complete!' })

    // Write manifest
    await fs.writeJson(join(destDir, 'extraction_manifest.json'), {
      timestamp: new Date().toISOString(),
      files: results.files,
      errors: results.errors
    }, { spaces: 2 })

    return { ...results, success: true }
  }

  //    WiFi Passwords (jailbroken)                                         
  async extractWifiPasswords(udid) {
    // Try to pull wifi plist from device
    // Requires root/jailbreak or it will be in the backup

    // Method 1: Pull from backup (non-jailbreak)
    const backupNote = 'Wi-Fi passwords are stored in com.apple.wifi.plist - accessible via encrypted backup (requires backup password)'

    // Method 2: Direct pull (jailbroken)
    const wifiPlist = '/private/var/preferences/SystemConfiguration/com.apple.wifi.known-networks.plist'
    return new Promise(async (res) => {
      const proc = spawn(bin('idevicebackup2'), udid ? ['-u', udid, 'afc', wifiPlist, '/tmp/'] : ['afc', wifiPlist, '/tmp/'])
      let out = ''
      proc.stdout.on('data', d => out += d)
      proc.stderr.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async code => {
        if (code !== 0) {
          res({
            success: false,
            note: backupNote,
            methods: [
              'Jailbroken: Pull /private/var/preferences/SystemConfiguration/com.apple.wifi.known-networks.plist',
              'Non-jailbroken: Create encrypted backup, decrypt with Omerta Backup Decrypt, find wifi plist',
              'Non-jailbroken: Settings > Wi-Fi > tap (i) next to any network to see password on iOS 16+'
            ]
          })
          return
        }
        res({ success: true, note: 'Wi-Fi plist extracted', path: '/tmp/com.apple.wifi.known-networks.plist' })
      })
    })
  }

  //    Contacts Export                                                     
  async exportContacts(udid) {
    const { app: electronApp } = await import('electron')
    const destDir = join(electronApp.getPath('userData'), 'ios_contacts')
    await fs.ensureDir(destDir)

    return new Promise(async (res) => {
      const proc = spawn(bin('idevicebackup2'), udid
        ? ['-u', udid, 'backup', '--full', destDir]
        : ['backup', '--full', destDir])
      let out = ''
      proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async code => {
        if (code !== 0) { res({ success: false, error: 'Backup failed' }); return }
        // AddressBook.sqlitedb hash: 31bb7ba8914766d4ba40d6dfb6113c8b614be442
        try {
          const dirs = await fs.readdir(destDir)
          for (const dir of dirs) {
            const ab = join(destDir, dir, '31bb7ba8914766d4ba40d6dfb6113c8b614be442')
            if (await fs.pathExists(ab)) {
              const dest = join(destDir, 'AddressBook.sqlitedb')
              await fs.copy(ab, dest)
              res({ success: true, path: dest, note: 'Open in Omerta SQLite Browser. Table: ABPerson' })
              return
            }
          }
          res({ success: false, error: 'AddressBook not found in backup' })
        } catch (e) { res({ success: false, error: e.message }) }
      })
    })
  }

  //    Photos Export                                                       
  async exportPhotos(udid, destDir) {
    const { app: electronApp } = await import('electron')
    const dest = destDir || join(electronApp.getPath('userData'), 'ios_photos')
    await fs.ensureDir(dest)

    return new Promise(async (res) => {
      // Use ifuse or idevicephotosync if available, else fall back to backup
      const proc = spawn(bin('idevicescreenshot'), udid ? ['-u', udid, join(dest, 'screenshot.png')] : [join(dest, 'screenshot.png')])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async () => {
        // Try idevicephotosync
        const sync = spawn(bin('idevicephotosync'), udid ? ['-u', udid, dest] : [dest])
        let out = ''
        sync.stdout.on('data', d => out += d)
        sync.stderr.on('data', d => out += d)
        sync.on('close', code => res({
          success: code === 0,
          path: dest,
          output: out,
          note: code !== 0 ? 'idevicephotosync not available. Use Backup Decrypt in SHSH page to extract photos from backup.' : 'Photos synced'
        }))
      })
    })
  }

}
