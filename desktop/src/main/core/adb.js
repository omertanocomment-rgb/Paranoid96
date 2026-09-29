import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'

const execFileAsync = promisify(execFile)

function adbBin() {
  const platform = process.platform
  const base = app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(process.cwd(), 'bin')
  if (platform === 'win32') return join(base, 'adb.exe')
  if (platform === 'darwin') return join(base, 'adb-mac')
  return join(base, 'adb-linux')
}

export default class ADBCore {
  async exec(...args) {
    try {
      const { stdout, stderr } = await execFileAsync(adbBin(), args, { timeout: 30000 })
      return stdout.trim()
    } catch (e) {
      throw new Error(e.stderr || e.message)
    }
  }

  async shell(serial, cmd) {
    return this.exec('-s', serial, 'shell', cmd)
  }

  spawnShell(serial, cmd) {
    return spawn(adbBin(), ['-s', serial, 'shell', cmd])
  }

  //    Device listing                                                       
  async listDevices() {
    let out
    try {
      out = await this.exec('devices', '-l')
    } catch(e) {
      return []
    }
    const lines = out.split('\n').slice(1).filter(l => l.trim() && !l.startsWith('*'))
    return Promise.all(lines.map(async (line) => {
      const [serial, state] = line.trim().split(/\s+/)
      if (state !== 'device') return { serial, state, name: 'Unknown', model: '', brand: '' }
      try {
        const [brand, model, androidVer, sdk, product] = await Promise.all([
          this.shell(serial, 'getprop ro.product.brand'),
          this.shell(serial, 'getprop ro.product.model'),
          this.shell(serial, 'getprop ro.build.version.release'),
          this.shell(serial, 'getprop ro.build.version.sdk'),
          this.shell(serial, 'getprop ro.product.name')
        ])
        return { serial, state, brand: brand.trim(), model: model.trim(), androidVer: androidVer.trim(), sdk: sdk.trim(), product: product.trim(), type: 'android' }
      } catch { return { serial, state, name: 'Unknown', type: 'android' } }
    }))
  }

  async getDeviceInfo(serial) {
    const props = [
      // Identity
      ['brand',          'ro.product.brand'],
      ['manufacturer',   'ro.product.manufacturer'],
      ['model',          'ro.product.model'],
      ['marketName',     'ro.product.marketname'],
      ['device',         'ro.product.device'],
      ['name',           'ro.product.name'],
      // Software
      ['android',        'ro.build.version.release'],
      ['androidFull',    'ro.build.version.release_or_codename'],
      ['sdk',            'ro.build.version.sdk'],
      ['build',          'ro.build.id'],
      ['buildDisplay',   'ro.build.display.id'],
      ['buildType',      'ro.build.type'],
      ['buildTags',      'ro.build.tags'],
      ['buildDate',      'ro.build.date'],
      ['fingerprint',    'ro.build.fingerprint'],
      ['securityPatch',  'ro.build.version.security_patch'],
      ['kernelVersion',  'ro.kernel.version'],
      ['kernelFull',     'ro.build.linux.version'],
      // Hardware
      ['chipset',        'ro.board.platform'],
      ['hardware',       'ro.hardware'],
      ['soc',            'ro.soc.model'],
      ['socMfr',         'ro.soc.manufacturer'],
      ['abi',            'ro.product.cpu.abi'],
      ['abi2',           'ro.product.cpu.abi2'],
      ['abiList',        'ro.product.cpu.abilist'],
      ['serial',         'ro.serialno'],
      ['bootloader',     'ro.bootloader'],
      ['revision',       'ro.revision'],
      // Radio / modem
      ['baseband',       'ro.baseband'],
      ['basebandFull',   'gsm.version.baseband'],
      ['rfChipset',      'ro.rf_chipset.name'],
      // Display
      ['displayDensity', 'ro.sf.lcd_density'],
      ['displaySize',    'ro.product.screen_density'],
      // Battery
      ['batteryTech',    'ro.battery.technology'],
      // Misc
      ['timezone',       'persist.sys.timezone'],
      ['locale',         'persist.sys.locale'],
      ['country',        'ro.product.locale.country'],
      ['language',       'ro.product.locale.language'],
      ['deviceType',     'ro.build.characteristics'],
      ['encrypted',      'ro.crypto.state'],
      ['verifiedBoot',   'ro.boot.verifiedbootstate'],
      ['avbVersion',     'ro.boot.avb_version'],
      ['dmVerity',       'ro.boot.dm-verity.enabled'],
      ['selinux',        'ro.boot.selinux'],
      ['treble',         'ro.treble.enabled'],
      ['projectCodename','ro.build.project_codename'],
    ]

    const info = { serial, type: 'android' }

    // Batch getprop - much faster than individual calls
    try {
      const allProps = await this.shell(serial, 'getprop')
      const propMap = {}
      for (const line of allProps.split('\n')) {
        const m = line.match(/^\[([^\]]+)\]:\s*\[(.*)\]$/)
        if (m) propMap[m[1]] = m[2].trim()
      }
      for (const [key, prop] of props) {
        info[key] = propMap[prop] || ''
      }
      // Extra props from the batch
      info.imei1 = propMap['persist.radio.imei'] || propMap['ril.imei'] || propMap['gsm.imei'] || ''
      info.imei2 = propMap['persist.radio.imei2'] || propMap['ril.imei2'] || ''
      info.iccid = propMap['persist.radio.iccid'] || propMap['ril.iccid1'] || ''
      info.phoneNumber = propMap['ril.msisdn'] || propMap['gsm.sim.operator.alpha'] || ''
      info.carrierName = propMap['gsm.operator.alpha'] || propMap['ro.carrier'] || ''
      info.simOperator = propMap['gsm.sim.operator.numeric'] || ''
      info.wifiMac = propMap['ro.boot.wifimacaddr'] || propMap['wifi.interface'] || ''
      info.btMac = propMap['ro.boot.btmacaddr'] || ''
      info.netType = propMap['gsm.network.type'] || ''
      info.emmc = propMap['ro.boot.emmc'] || ''
      info.screenDensity = propMap['ro.sf.lcd_density'] || propMap['ro.screen.density'] || ''
      info.screenSize = propMap['ro.config.display_size'] || ''
      info.javaHeap = propMap['dalvik.vm.heapsize'] || ''
      info.totalHeap = propMap['dalvik.vm.heapgrowthlimit'] || ''
      info.glesVersion = propMap['ro.opengles.version'] || ''
      info.vulkan = propMap['ro.vulkan.version'] || ''
    } catch {
      // Fallback: individual calls
      await Promise.all(props.map(async ([key, prop]) => {
        try { info[key] = (await this.shell(serial, `getprop ${prop}`)).trim() } catch { info[key] = '' }
      }))
    }

    // Clean up brand name
    if (info.brand) info.brand = info.brand.charAt(0).toUpperCase() + info.brand.slice(1)

    // Full device name
    info.displayName = [info.brand, info.marketName || info.model].filter(Boolean).join(' ')

    // Memory
    try {
      const mem = await this.shell(serial, 'cat /proc/meminfo')
      const total = mem.match(/MemTotal:\s+(\d+)/)?.[1]
      const free  = mem.match(/MemAvailable:\s+(\d+)/)?.[1]
      const swap  = mem.match(/SwapTotal:\s+(\d+)/)?.[1]
      if (total) {
        info.ramTotalMb  = Math.round(parseInt(total) / 1024)
        info.ramTotal    = info.ramTotalMb + ' MB'
        info.ramNice     = info.ramTotalMb >= 1024 ? (info.ramTotalMb/1024).toFixed(1) + ' GB' : info.ramTotal
      }
      if (free) {
        info.ramFreeMb   = Math.round(parseInt(free) / 1024)
        info.ramFree     = info.ramFreeMb + ' MB'
        info.ramUsedMb   = info.ramTotalMb - info.ramFreeMb
        info.ramUsed     = info.ramUsedMb + ' MB'
        info.ramPercent  = Math.round(info.ramUsedMb / info.ramTotalMb * 100)
      }
      if (swap) info.swapTotal = Math.round(parseInt(swap) / 1024) + ' MB'
    } catch {}

    // Storage
    try {
      const df = await this.shell(serial, 'df /data 2>/dev/null | tail -1')
      const parts = df.trim().split(/\s+/)
      if (parts.length >= 4) {
        const total = parseInt(parts[1])
        const used  = parseInt(parts[2])
        const free  = parseInt(parts[3])
        if (total > 0) {
          info.storageTotalGb  = (total / 1024 / 1024).toFixed(1)
          info.storageUsedGb   = (used  / 1024 / 1024).toFixed(1)
          info.storageFreeGb   = (free  / 1024 / 1024).toFixed(1)
          info.storagePercent  = Math.round(used / total * 100)
          // Nice display
          const fmt = n => n >= 1024*1024 ? (n/1024/1024).toFixed(1)+' GB' : (n/1024).toFixed(0)+' MB'
          info.storageTotal = fmt(total)
          info.storageUsed  = fmt(used)
          info.storageFree  = fmt(free)
        }
      }
    } catch {}

    // External SD card
    try {
      const sdDf = await this.shell(serial, 'df /sdcard 2>/dev/null | tail -1')
      const sdParts = sdDf.trim().split(/\s+/)
      if (sdParts.length >= 4) {
        info.sdTotal = (parseInt(sdParts[1]) / 1024 / 1024).toFixed(1) + ' GB'
        info.sdFree  = (parseInt(sdParts[3]) / 1024 / 1024).toFixed(1) + ' GB'
      }
    } catch {}

    // Battery full detail
    try {
      const bat = await this.shell(serial, 'dumpsys battery')
      info.batteryLevel     = bat.match(/level:\s*(\d+)/)?.[1] ? parseInt(bat.match(/level:\s*(\d+)/)[1]) : null
      info.batteryStatus    = { 1:'Unknown',2:'Charging',3:'Discharging',4:'Not Charging',5:'Full' }[bat.match(/status:\s*(\d+)/)?.[1]] || ''
      info.batteryHealth    = { 1:'Unknown',2:'Good',3:'Overheat',4:'Dead',5:'Over Voltage',6:'Unspecified Failure',7:'Cold' }[bat.match(/health:\s*(\d+)/)?.[1]] || ''
      info.batteryPlugged   = { 0:'Unplugged',1:'AC',2:'USB',4:'Wireless' }[bat.match(/plugged:\s*(\d+)/)?.[1]] || ''
      info.batteryVoltage   = bat.match(/voltage:\s*(\d+)/)?.[1] ? (parseInt(bat.match(/voltage:\s*(\d+)/)[1]) / 1000).toFixed(2) + ' V' : ''
      info.batteryTemp      = bat.match(/temperature:\s*(\d+)/)?.[1] ? (parseInt(bat.match(/temperature:\s*(\d+)/)[1]) / 10).toFixed(1) + ' C' : ''
      info.batteryTechnology= bat.match(/technology:\s*(\S+)/)?.[1] || ''
    } catch {}

    // Screen resolution
    try {
      const wm = await this.shell(serial, 'wm size')
      const res = wm.match(/(\d+x\d+)/)
      if (res) info.resolution = res[1]
      const wmDpi = await this.shell(serial, 'wm density')
      const dpi = wmDpi.match(/Physical density:\s*(\d+)/)?.[1]
      if (dpi) info.dpi = dpi + ' dpi'
    } catch {}

    // CPU info
    try {
      const cpu = await this.shell(serial, 'cat /proc/cpuinfo | grep -E "Hardware|processor|model name|cpu MHz" | head -20')
      const hwLine = cpu.match(/Hardware\s*:\s*(.+)/)?.[1]
      if (hwLine && !info.hardware) info.hardware = hwLine.trim()
      const coreCount = (cpu.match(/^processor/gm) || []).length
      if (coreCount) info.cpuCores = coreCount
      const mhz = cpu.match(/cpu MHz\s*:\s*([\d.]+)/)?.[1]
      if (mhz) info.cpuMhz = parseFloat(mhz).toFixed(0) + ' MHz'
    } catch {}

    // Uptime
    try {
      const up = await this.shell(serial, 'cat /proc/uptime')
      const secs = parseFloat(up.split(' ')[0])
      const h = Math.floor(secs / 3600)
      const m = Math.floor((secs % 3600) / 60)
      info.uptime = h > 24 ? `${Math.floor(h/24)}d ${h%24}h` : `${h}h ${m}m`
    } catch {}

    // Root status
    try {
      const su = await this.shell(serial, 'which su 2>/dev/null || su -c id 2>/dev/null | head -1')
      info.rooted = su.includes('uid=0') || su.includes('/su') || su.includes('/sbin/su') ? 'Yes' : 'No'
    } catch { info.rooted = 'No' }

    // SELinux status
    try {
      const sel = await this.shell(serial, 'getenforce 2>/dev/null')
      info.selinuxStatus = sel.trim()
    } catch {}

    // Network info
    try {
      const ip = await this.shell(serial, "ip route get 1.1.1.1 2>/dev/null | grep src")
      info.ipAddress = ip.trim()
      const wifiInfo = await this.shell(serial, 'dumpsys wifi | grep "mWifiInfo" | head -1')
      const ssid = wifiInfo.match(/SSID:\s*([^,]+)/)?.[1]?.replace(/"/g, '')
      if (ssid && ssid !== '<unknown ssid>') info.wifiSsid = ssid
    } catch {}

    // Bootloader / security
    try {
      const bl = await this.shell(serial, 'getprop ro.boot.flash.locked')
      info.bootloaderLocked = bl.trim() === '1' ? 'Locked' : bl.trim() === '0' ? 'Unlocked' : ''
    } catch {}

    return info
  }

  //    File operations                                                       
  async listFiles(serial, path = '/sdcard') {
    try {
      const out = await this.shell(serial, `ls -la "${path}" 2>/dev/null`)
      return out.split('\n').slice(1).filter(Boolean).map(line => {
        const parts = line.split(/\s+/)
        const perms = parts[0] || ''
        const size = parts[4] || '0'
        const name = parts.slice(7).join(' ')
        return {
          name, size: parseInt(size) || 0, isDir: perms.startsWith('d'),
          isSymlink: perms.startsWith('l'), permissions: perms,
          date: `${parts[5]} ${parts[6]}`, path: `${path}/${name}`
        }
      }).filter(f => f.name && f.name !== '.' && f.name !== '..')
    } catch { return [] }
  }

  async deleteFile(serial, path) {
    return this.shell(serial, `rm -rf "${path}"`)
  }

  async mkdir(serial, path) {
    return this.shell(serial, `mkdir -p "${path}"`)
  }

  async push(serial, localPath, remotePath, onProgress) {
    return new Promise((resolve, reject) => {
      const proc = spawn(adbBin(), ['-s', serial, 'push', localPath, remotePath])
      let out = ''
      proc.stdout.on('data', d => {
        out += d.toString()
        const m = out.match(/\[(\s*\d+)%\]/)
        if (m && onProgress) onProgress({ percent: parseInt(m[1]) })
      })
      proc.stderr.on('data', d => { out += d.toString() })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error(out)))
    })
  }

  async pull(serial, remotePath, localDir, onProgress) {
    return new Promise((resolve, reject) => {
      const proc = spawn(adbBin(), ['-s', serial, 'pull', remotePath, localDir])
      let out = ''
      proc.stdout.on('data', d => {
        out += d.toString()
        const m = out.match(/\[(\s*\d+)%\]/)
        if (m && onProgress) onProgress({ percent: parseInt(m[1]) })
      })
      proc.stderr.on('data', d => { out += d.toString() })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code === 0 ? resolve({ success: true, dest: localDir }) : reject(new Error(out)))
    })
  }

  //    App management                                                        
  async listApps(serial) {
    const [all, system, disabled] = await Promise.all([
      this.shell(serial, 'pm list packages -f').catch(() => ''),
      this.shell(serial, 'pm list packages -f -s').catch(() => ''),
      this.shell(serial, 'pm list packages -d').catch(() => '')
    ])
    const systemPkgs = new Set(system.split('\n').map(l => l.split(':')[1]?.split('=').pop()?.trim()).filter(Boolean))
    const disabledPkgs = new Set(disabled.split('\n').map(l => l.split(':')[1]?.trim()).filter(Boolean))
    const apps = all.split('\n').filter(l => l.startsWith('package:')).map(l => {
      const match = l.match(/package:(.+)=(.+)/)
      if (!match) return null
      const [, apkPath, pkg] = match
      return { pkg, apkPath: apkPath.trim(), isSystem: systemPkgs.has(pkg), isDisabled: disabledPkgs.has(pkg) }
    }).filter(Boolean)
    const sizes = await this.shell(serial, 'pm list packages -f --show-versioncode 2>/dev/null').catch(() => '')
    return apps
  }

  async uninstallApp(serial, pkg) {
    return this.shell(serial, `pm uninstall --user 0 ${pkg}`)
  }

  async extractApk(serial, pkg, destDir) {
    const path = await this.shell(serial, `pm path ${pkg}`)
    const apkPath = path.replace('package:', '').trim()
    const filename = pkg + '.apk'
    await this.pull(serial, apkPath, join(destDir, filename))
    return { success: true, path: join(destDir, filename) }
  }

  //    Battery                                                               
  async getBatteryInfo(serial) {
    const raw = await this.shell(serial, 'dumpsys battery')
    const parse = (key) => raw.match(new RegExp(`${key}:\\s*(.+)`))?.[1]?.trim() || ''
    return {
      level: parse('level'), voltage: parse('voltage'),
      temperature: (parseInt(parse('temperature') || 0) / 10).toFixed(1) + ' C',
      health: parse('health'), status: parse('status'),
      technology: parse('technology'), present: parse('present'),
      plugged: parse('plugged'), scale: parse('scale')
    }
  }

  //    Permissions                                                           
  async getPermissions(serial) {
    const packages = await this.listApps(serial)
    const dangerous = [
      'READ_CONTACTS', 'WRITE_CONTACTS', 'READ_CALL_LOG', 'WRITE_CALL_LOG',
      'READ_SMS', 'SEND_SMS', 'READ_PHONE_STATE', 'CALL_PHONE',
      'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION',
      'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'CAMERA', 'RECORD_AUDIO',
      'BODY_SENSORS', 'READ_CALENDAR', 'WRITE_CALENDAR', 'PROCESS_OUTGOING_CALLS',
      'RECEIVE_SMS', 'RECEIVE_MMS', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO',
      'BLUETOOTH_CONNECT', 'BLUETOOTH_SCAN', 'USE_BIOMETRIC', 'USE_FINGERPRINT'
    ]
    const result = []
    const pkgSample = packages.filter(p => !p.isSystem).slice(0, 40)
    for (const app of pkgSample) {
      try {
        const info = await this.shell(serial, `dumpsys package ${app.pkg} | grep -A2 "granted=true"`)
        const granted = dangerous.filter(p => info.includes(p))
        if (granted.length > 0) result.push({ pkg: app.pkg, permissions: granted })
      } catch {}
    }
    return result
  }

  //    Reboot                                                                 
  async reboot(serial, mode = '') {
    if (mode) return this.exec('-s', serial, 'reboot', mode)
    return this.exec('-s', serial, 'reboot')
  }

  //    Screenshot                                                             
  async screenshot(serial) {
    const tmpPath = '/sdcard/omerta_ss.png'
    await this.shell(serial, `screencap -p ${tmpPath}`)
    const tmp = join(app.getPath('temp'), 'ft_ss.png')
    await this.pull(serial, tmpPath, tmp)
    await this.shell(serial, `rm ${tmpPath}`)
    const data = await fs.readFile(tmp)
    return { base64: data.toString('base64'), mimeType: 'image/png' }
  }

  //    Network info                                                          
  async getNetworkInfo(serial) {
    const [wifi, ip, dns] = await Promise.all([
      this.shell(serial, 'dumpsys wifi | grep "mWifiInfo\\|SSID\\|BSSID\\|Frequency\\|signal\\|ipaddr"').catch(() => ''),
      this.shell(serial, 'ip addr show wlan0 2>/dev/null').catch(() => ''),
      this.shell(serial, 'getprop net.dns1').catch(() => '')
    ])
    return { wifi, ip, dns }
  }

  async getCarrierInfo(serial) {
    const [carrier, mcc, mnc, imei] = await Promise.all([
      this.shell(serial, 'getprop gsm.operator.alpha').catch(() => ''),
      this.shell(serial, 'getprop gsm.operator.numeric').catch(() => ''),
      this.shell(serial, 'getprop gsm.network.type').catch(() => ''),
      this.shell(serial, 'service call iphonesubinfo 1 | grep -oE "[0-9a-f]{8}" | head -4').catch(() => '')
    ])
    return { carrier, mcc, mnc, imei }
  }

  //    Input injection                                                        
  async injectInput(serial, event) {
    if (event.type === 'tap') return this.shell(serial, `input tap ${event.x} ${event.y}`)
    if (event.type === 'swipe') return this.shell(serial, `input swipe ${event.x1} ${event.y1} ${event.x2} ${event.y2} ${event.duration || 300}`)
    if (event.type === 'key') return this.shell(serial, `input keyevent ${event.keycode}`)
    if (event.type === 'text') return this.shell(serial, `input text "${event.text}"`)
  }

  //    Bootloader status                                                      
  async getBootloaderStatus(serial) {
    try {
      const status = await this.exec('-s', serial, 'shell', 'getprop ro.boot.verifiedbootstate').catch(() => '')
      const unlocked = await this.exec('-s', serial, 'shell', 'getprop ro.boot.flash.locked').catch(() => '')
      return { verifiedBootState: status.trim(), flashLocked: unlocked.trim() }
    } catch { return {} }
  }

  //    Tracker scan                                                          
  async scanTrackers(serial) {
    const knownTrackers = [
      'com.google.android.gms', 'com.facebook.katana', 'com.amazon.mShop',
      'com.adjust.sdk', 'io.branch.referral', 'com.appsflyer',
      'com.onesignal', 'com.mixpanel', 'com.braze.ui',
      'com.mopub', 'net.openid', 'com.crashlytics',
      'com.bugsnag', 'com.datadog', 'io.sentry'
    ]
    const installed = await this.listApps(serial)
    const pkgs = installed.map(a => a.pkg)
    const found = []
    for (const tracker of knownTrackers) {
      if (pkgs.some(p => p.includes(tracker.replace(/^com\./, '')))) {
        found.push(tracker)
      }
    }
    return found
  }

  //    Notification log                                                      
  async getNotificationLog(serial) {
    const raw = await this.shell(serial, 'dumpsys notification --noredact 2>/dev/null | head -500')
    return raw
  }
}
