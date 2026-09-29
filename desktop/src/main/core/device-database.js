import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import axios from 'axios'

const execAsync = promisify(execFile)
function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

//    Test Point Database                                                         
// Real test point data for major chipsets and devices
export const TEST_POINT_DATABASE = {
  qualcomm: {
    name: 'Qualcomm EDL (9008 mode)',
    description: 'Emergency Download Mode -- exposes raw eMMC/UFS over USB at VID:05C6 PID:9008',
    triggerMethods: [
      'Short TP (test point) to GND while holding Vol+ and plugging USB',
      'ADB reboot edl command (if ADB access available)',
      'Deep flash cable (automatically shorts TP)',
      'edl.py from bkerler/edl Python tool'
    ],
    devices: {
      'Samsung Galaxy S20 (SM-G980F)': {
        chipset: 'Snapdragon 865',
        testPoint: 'TP19 near battery connector, short to GND',
        notes: 'Remove back cover. TP19 is near the NFC antenna. Short while connecting USB.',
        diagramUrl: 'https://xdaforums.com/t/galaxy-s20-edl',
        difficulty: 'Medium'
      },
      'Xiaomi Mi 9 (cepheus)': {
        chipset: 'Snapdragon 855',
        testPoint: 'Short EDL pad near SIM slot to GND',
        notes: 'Remove back glass. EDL pad is near SIM tray.',
        difficulty: 'Easy'
      },
      'Xiaomi Redmi Note 7 (lavender)': {
        chipset: 'Snapdragon 660',
        testPoint: 'R15 test point near battery connector',
        notes: 'Very accessible. No glue on back cover.',
        difficulty: 'Easy'
      },
      'OnePlus 6 (enchilada)': {
        chipset: 'Snapdragon 845',
        testPoint: 'TP49 on motherboard',
        notes: 'Disassembly required. Near charging IC.',
        difficulty: 'Hard'
      },
      'Motorola Moto G7 (river)': {
        chipset: 'Snapdragon 632',
        testPoint: 'Short marked TP near USB port',
        notes: 'Bottom of the board, accessible after back cover removal.',
        difficulty: 'Easy'
      },
      'Samsung Galaxy A51 (SM-A515F)': {
        chipset: 'Exynos 9611',
        testPoint: 'Not Qualcomm -- uses Samsung ODIN/Heimdall instead',
        notes: 'Use Odin or Heimdall for flashing.',
        difficulty: 'N/A'
      },
      'Xiaomi Poco X3 (surya)': {
        chipset: 'Snapdragon 732G',
        testPoint: 'TP34 near speaker connector',
        notes: 'Back glass is glued, heat before removal.',
        difficulty: 'Medium'
      },
      'Realme 6 (RMX2001)': {
        chipset: 'MediaTek Helio G90T',
        testPoint: 'MTK BROM -- see MediaTek section',
        notes: 'Not Qualcomm. Uses MediaTek boot ROM.',
        difficulty: 'Easy'
      },
    }
  },
  mediatek: {
    name: 'MediaTek BROM (Boot ROM Mode)',
    description: 'Boot ROM mode -- device appears as USB VID:0E8D PID:0003 or 2000',
    triggerMethods: [
      'Short BOOT_MODE / TP to GND while plugging USB (Vol down combo on some)',
      'Hold Vol- while plugging USB (works on many MT6xxx devices)',
      'Use SP Flash Tool with MTK USB driver',
      'bkerler/mtkclient Python tool'
    ],
    devices: {
      'Realme C3 (RMX2020)': {
        chipset: 'MediaTek Helio G70',
        testPoint: 'Vol- + plug USB (no physical TP needed)',
        notes: 'Software method works. No disassembly required.',
        difficulty: 'Easy'
      },
      'Xiaomi Redmi 9 (lancelot)': {
        chipset: 'MediaTek Helio G80',
        testPoint: 'Short C19 cap to GND near battery connector',
        notes: 'Remove battery and short while plugging USB.',
        difficulty: 'Medium'
      },
      'Samsung Galaxy A02 (SM-A022F)': {
        chipset: 'MediaTek MT6739',
        testPoint: 'TP near SIM slot, short to GND',
        notes: 'Very accessible. Back cover snaps off.',
        difficulty: 'Easy'
      },
      'OPPO A53 (CPH2127)': {
        chipset: 'MediaTek MT6765',
        testPoint: 'Short capacitor C1204 near charging port',
        notes: 'Access via disassembly. See XDA thread.',
        difficulty: 'Medium'
      },
      'Nokia 2.4 (TA-1270)': {
        chipset: 'MediaTek MT6762',
        testPoint: 'Vol- + plug USB',
        notes: 'Software BROM trigger. Easy.',
        difficulty: 'Easy'
      },
    }
  },
  samsung_odin: {
    name: 'Samsung Download Mode (Odin / Heimdall)',
    description: 'Samsung\'s proprietary flash mode. No test point needed.',
    triggerMethods: [
      'Power off   Hold Vol Down + USB connect',
      'Vol Down + Bixby/Home + Power (older devices)',
      'ADB: adb reboot download',
      'Works with Odin (Windows) or Heimdall (cross-platform)'
    ],
    devices: {
      'Samsung Galaxy S series': { notes: 'Vol Down + USB = download mode on all modern Samsung', difficulty: 'Easy' },
      'Samsung Galaxy A series': { notes: 'Same as S series. Vol Down + USB.', difficulty: 'Easy' },
      'Samsung Galaxy Note series': { notes: 'Same. Vol Down + USB or Vol Down + Home + Power on older.', difficulty: 'Easy' },
    }
  }
}

//    Water Damage Recovery Guide                                                 
export const WATER_DAMAGE_GUIDE = {
  immediateSteps: [
    { step: 1, time: '0-30 seconds', action: 'Power off immediately', detail: 'If still on, hold power and shut down NOW. Do not try to check if it works. Short circuits while wet cause permanent damage.', critical: true },
    { step: 2, time: '0-2 minutes', action: 'Remove case, SIM, SD card', detail: 'Get everything out. Water hides under cases. SIM and SD can trap water and corrode contacts.', critical: true },
    { step: 3, time: '0-5 minutes', action: 'Remove battery if accessible', detail: 'Non-sealed phones: get the battery out. Sealed phones: leave it, powering on is more dangerous.', critical: true },
    { step: 4, time: '0-10 minutes', action: 'Pat dry gently', detail: 'Use a soft cloth or paper towel. Pat, do not wipe. Wiping pushes water deeper into ports.', critical: false },
    { step: 5, time: '0-10 minutes', action: 'Shake water out of ports', detail: 'Hold phone port-side down and gently tap to shake water out of USB, headphone, and speaker holes.', critical: false },
    { step: 6, time: 'Ongoing', action: 'Do NOT use rice', detail: 'Rice is a myth. It does nothing useful in the timeframe that matters and can leave starch residue. Use silica gel or desiccant instead.', critical: false },
    { step: 7, time: '24-48 hours', action: 'Dry with desiccant or airflow', detail: 'Place in a bag with silica gel packets, or use a fan blowing over it. Do not use a hair dryer -- heat warps components.', critical: false },
    { step: 8, time: '48-72 hours', action: 'Isopropyl alcohol flush (for saltwater/poolwater)', detail: '90%+ IPA is safe for electronics. Dip a toothbrush and gently scrub the board to displace mineral deposits. Let dry completely.', critical: false },
    { step: 9, time: '72+ hours', action: 'Attempt power on', detail: 'Only power on after at least 72 hours of drying. Check for screen discolouration, distorted audio, or unusual heat.', critical: false },
  ],
  repairChecklist: [
    { component: 'Charging port', symptoms: 'Won\'t charge, intermittent charge', fix: 'Clean with IPA + toothbrush. Ultrasonic cleaner if available. Replace port if corroded.' },
    { component: 'Speakers', symptoms: 'Muffled sound, crackling', fix: 'Usually resolves after drying. Silica gel for 48h. Replace if still muffled.' },
    { component: 'Microphone', symptoms: 'Can\'t hear on calls, recording silent', fix: 'Clean port. Dry thoroughly. Often recovers. Replace if not.' },
    { component: 'Screen', symptoms: 'Water under display, dark spots', fix: 'Heat slightly (40 C) to evaporate trapped moisture. Full drying. Replace screen if spots remain.' },
    { component: 'Battery', symptoms: 'Won\'t charge, dies instantly', fix: 'Water-damaged batteries are dangerous. Replace immediately if swollen or won\'t hold charge.' },
    { component: 'Motherboard', symptoms: 'Won\'t boot, bootloop, no signal', fix: 'IPA clean + ultrasonic. Professional reflow soldering may be needed. Data may still be recoverable even if board is dead.' },
    { component: 'Camera', symptoms: 'Foggy photos, won\'t focus', fix: 'Moisture in lens module. Dry and wait. Often recovers. Replace module if fog persists.' },
    { component: 'Buttons', symptoms: 'Stuck, double-press, unresponsive', fix: 'IPA flush under buttons. Often fixes corrosion on button contacts.' },
  ],
  successRate: {
    freshwater: '70-80% full recovery if powered off within 30 seconds',
    saltwater: '40-60% -- saltwater is conductive and corrosive, act faster',
    chlorinePool: '50-70% -- chlorine deposits cause issues but less conductive than saltwater',
    seawater: '30-50% -- worst case, immediate IPA flush improves chances significantly',
    beerAlcohol: '60-75% -- sugary residue causes corrosion but less conductive',
  }
}

//    OTA Interceptor                                                             
export class OTAInterceptor {
  async getOtaInfo(serial) {
    try {
      const { execFile: ef } = await import('child_process')
      const { promisify: pfy } = await import('util')
      const efAsync = pfy(ef)
      const { stdout } = await efAsync(bin('adb'), ['-s', serial, 'shell', [
        'getprop ro.build.version.release',
        '&& getprop ro.build.fingerprint',
        '&& getprop ro.product.device',
        '&& getprop ro.build.id',
      ].join(' && ')], { timeout: 8000 })
      const lines = stdout.trim().split('\n')
      return {
        androidVersion: lines[0]?.trim(),
        fingerprint: lines[1]?.trim(),
        device: lines[2]?.trim(),
        buildId: lines[3]?.trim()
      }
    } catch { return {} }
  }

  async checkGoogleOta(device, fingerprint) {
    // Google publishes OTA metadata -- we can check what's available
    if (!device) return null
    try {
      const res = await axios.get(`https://developers.google.com/android/ota`, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } })
      const rows = []
      const regex = new RegExp(`${device}.*?<a href="(https://[^"]+\\.zip)"`, 'gi')
      let match
      while ((match = regex.exec(res.data)) !== null) {
        rows.push({ url: match[1], filename: match[1].split('/').pop() })
      }
      return rows.slice(0, 5)
    } catch { return null }
  }

  async saveCurrentOtaUrl(serial, destDir, onProgress) {
    // Pull OTA cache from device (if queued OTA exists)
    onProgress?.({ percent: 10, message: 'Checking for queued OTA on device...' })
    try {
      const { execFile: ef } = await import('child_process')
      const { promisify: pfy } = await import('util')
      const efAsync = pfy(ef)
      // Android stores OTA downloads in /data/ota_package/ or /cache/
      const { stdout } = await efAsync(bin('adb'), ['-s', serial, 'shell', 'ls -la /data/ota_package/ 2>/dev/null || ls -la /cache/*.zip 2>/dev/null || echo NONE'], { timeout: 8000 })
      if (stdout.includes('NONE') || !stdout.trim()) {
        return { found: false, message: 'No queued OTA found on device' }
      }
      const files = stdout.trim().split('\n').filter(l => l.includes('.zip') || l.includes('.br'))
      if (!files.length) return { found: false, message: 'No OTA packages found' }
      onProgress?.({ percent: 40, message: `Found OTA: ${files[0].split(' ').pop()}` })

      const remotePath = files[0].split(' ').pop()
      const filename = remotePath.split('/').pop()
      const localPath = join(destDir, filename)

      await fs.ensureDir(destDir)
      onProgress?.({ percent: 50, message: 'Pulling OTA package...' })
      await new Promise((res, rej) => {
        const proc = spawn(bin('adb'), ['-s', serial, 'pull', remotePath, localPath])
        proc.stderr.on('data', d => {
          const m = d.toString().match(/\[.*?(\d+)%\]/)
          if (m) onProgress?.({ percent: 50 + Math.round(parseInt(m[1]) * 0.45), message: `Pulling: ${m[1]}%` })
        })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', c => c === 0 ? res() : rej(new Error('Pull failed')))
      })
      onProgress?.({ percent: 100, message: 'OTA saved!' })
      return { found: true, path: localPath, filename }
    } catch (e) {
      return { found: false, error: e.message }
    }
  }

  getManualSources(brand, device) {
    const sources = {
      google: [
        { name: 'Google Factory Images', url: 'https://developers.google.com/android/images' },
        { name: 'Google OTA Images', url: 'https://developers.google.com/android/ota' },
      ],
      samsung: [
        { name: 'SamFW Firmware', url: `https://samfw.com/firmware/${device || ''}` },
        { name: 'SamMobile', url: 'https://www.sammobile.com/samsung/firmware/' },
      ],
      xiaomi: [
        { name: 'MIUI Downloads', url: `https://c.mi.com/global/miuidownload/index` },
        { name: 'XiaomiFirmwareUpdater', url: `https://xiaomifirmwareupdater.com/archive/miui/${device || ''}` },
      ],
      oneplus: [
        { name: 'OxygenUpdater App', url: 'https://oxygenupdater.com/' },
        { name: 'OnePlus Support', url: 'https://www.oneplus.com/support/softwareupgrade' },
      ],
      motorola: [
        { name: 'Motorola Firmware', url: 'https://mirrors.lolinet.com/firmware/motorola/' },
        { name: 'Motorola Official', url: 'https://motorola-global-portal.custhelp.com' },
      ],
    }
    return sources[brand?.toLowerCase()] || [{ name: 'XDA Developers', url: `https://xdaforums.com/search/#q=${device}&type=post` }]
  }
}

//    Repair Mode                                                                 
export class RepairMode {
  async enableRepairMode(serial, type) {
    // Samsung has native Repair Mode. For others, simulate via restricted profile
    if (type === 'samsung') {
      const { execFile: ef } = await import('child_process')
      const { promisify: pfy } = await import('util')
      const efAsync = pfy(ef)
      const { stdout } = await efAsync(bin('adb'), ['-s', serial, 'shell', 'pm list packages | grep repairmode'], { timeout: 5000 })
      if (stdout.includes('repairmode')) {
        await efAsync(bin('adb'), ['-s', serial, 'shell', 'am start -n com.samsung.android.repairmode/.MainActivity'], { timeout: 5000 })
        return { success: true, method: 'native' }
      }
    }
    // Generic: create guest/restricted profile via ADB
    try {
      const { execFile: ef } = await import('child_process')
      const { promisify: pfy } = await import('util')
      const efAsync = pfy(ef)
      await efAsync(bin('adb'), ['-s', serial, 'shell', 'pm create-user --restricted "Repair Mode"'], { timeout: 8000 })
      return { success: true, method: 'restricted_profile', note: 'Created restricted profile. Switch to it for repair access.' }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }
}
