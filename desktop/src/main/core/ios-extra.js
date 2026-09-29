import { spawn, exec } from 'child_process'
import { join, basename } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import { promisify } from 'util'
const execAsync = promisify(exec)

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath,'bin') : join(process.cwd(),'bin')
  return join(base, process.platform==='win32' ? name+'.exe' : name)
}

function safeSpawn(toolName, args=[], opts={}) {
  return new Promise(async (res) => {
    let proc
    try {
      proc = spawn(bin(toolName), args, { ...opts, env: process.env })
    } catch(e) {
      return res({ success:false, error: `${toolName}: ${e.message}` })
    }
    let out='', err=''
    proc.stdout?.on('data', d => out += d)
    proc.stderr?.on('data', d => err += d)
    proc.on('error', e => res({ success:false, error: e.code==='ENOENT' ? `${toolName}.exe not found in bin/` : e.message }))
    proc.on('close', code => res({ success:code===0, output:out.trim(), error:err.trim()||null, code }))
    if (opts.timeout) setTimeout(() => { try{proc.kill()}catch{} }, opts.timeout)
  })
}

function run(cmd, args=[], opts={}) {
  return new Promise(async (res, rej) => {
    const proc = spawn(cmd, args, { ...opts, env: process.env })
    let out='', err=''
    proc.stdout?.on('data', d => out += d)
    proc.stderr?.on('data', d => err += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => code===0 ? res(out.trim()) : rej(new Error(err.trim()||out.trim()||`exit ${code}`)))
    if (opts.timeout) setTimeout(() => { try { proc.kill() } catch {} }, opts.timeout)
  })
}

function idev(args, udid, timeout=15000) {
  const a = udid ? ['-u', udid, ...args] : args
  return new Promise(async (res) => {
    const proc = spawn(bin(args[0]==='syslog'?'idevicesyslog':args[0]==='screenshot'?'idevicescreenshot':'ideviceinfo'), a.slice(1), { env: process.env })
    let out='', err=''
    proc.stdout?.on('data',d=>out+=d)
    proc.stderr?.on('data',d=>err+=d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => res({ code, out: out.trim(), err: err.trim() }))
    setTimeout(()=>{ try{proc.kill()}catch{} res({ code:-1, out, err:'timeout' }) }, timeout)
  })
}

//    Device date / time                                                    
export async function getDeviceDate(udid) {
  return new Promise(async (res) => {
    try {
      const proc = spawn(bin('idevicedate'), udid ? ['-u', udid] : [])
      let out='', err=''
      proc.stdout?.on('data',d=>out+=d)
      proc.stderr?.on('data',d=>err+=d)
      proc.on('error', e => res({ success:false, error: e.code==='ENOENT' ? 'idevicedate not installed' : e.message }))
      proc.on('close', code => res({ success:code===0, date:out.trim(), error:err.trim()||null }))
    } catch(e) { res({ success:false, error: e.message }) }
  })
}

export async function setDeviceDate(udid, timestamp) {
  const args = udid ? ['-u', udid, '-s', timestamp] : ['-s', timestamp]
  return new Promise(async (res) => {
    const proc = spawn(bin('idevicedate'), args)
    let out='', err=''
    proc.stdout?.on('data',d=>out+=d)
    proc.stderr?.on('data',d=>err+=d)
    proc.on('error', e => res({ success:false, error: e.code==='ENOENT'?'idevicedate not installed':e.message }))
    proc.on('close', code => res({ success:code===0, output:out.trim(), error:err.trim()||null }))
  })
}

//    Device rename                                                         
export async function renameDevice(udid, newName) {
  const args = udid ? ['-u', udid, newName] : [newName]
  return new Promise(async (res) => {
    const proc = spawn(bin('idevicename'), args)
    let out='', err=''
    proc.stdout?.on('data',d=>out+=d)
    proc.stderr?.on('data',d=>err+=d)
    proc.on('error', e => res({ success:false, error: e.code==='ENOENT'?'idevicename not installed':e.message }))
    proc.on('close', code => res({ success:code===0, output:out.trim(), error:err.trim()||null }))
  })
}

//    Crash reports                                                         
export async function pullCrashLogs(udid, destDir) {
  await fs.ensureDir(destDir)
  const args = udid ? ['-u', udid, destDir] : [destDir]
  return new Promise(async (res) => {
    const proc = spawn(bin('idevicecrashreport'), args)
    let out='', err=''
    proc.stdout?.on('data',d=>out+=d)
    proc.stderr?.on('data',d=>err+=d)
    proc.on('error', e => res({ success:false, files:[], error:e.code==='ENOENT'?'idevicecrashreport not installed - run install-remaining.ps1':e.message }))
    proc.on('close', async code => {
      const files = await fs.readdir(destDir).catch(()=>[])
      res({ success:code===0||files.length>0, files, destDir, output:out, error:err||null })
    })
  })
}

//    Developer disk image                                                  
export async function mountDevDisk(udid, imagePath, signaturePath) {
  const toolPath = bin('ideviceimagemounter')
  const { default: fsCheck } = await import('fs-extra')
  if (!await fsCheck.pathExists(toolPath)) {
    return { success:false, error:'ideviceimagemounter not installed - run install-remaining.ps1' }
  }
  const args = udid ? ['-u', udid, 'mount', imagePath, signaturePath] : ['mount', imagePath, signaturePath]
  return new Promise(async (res) => {
    const proc = spawn(toolPath, args)
    let out='', err=''
    proc.stdout?.on('data',d=>out+=d)
    proc.stderr?.on('data',d=>err+=d)
    proc.on('error', e => res({ success:false, error:e.message }))
    proc.on('close', code => res({ success:code===0, output:out.trim(), error:err.trim()||null }))
  })
}

export async function listMountedImages(udid) {
  const toolPath = bin('ideviceimagemounter')
  const { default: fsCheck } = await import('fs-extra')
  if (!await fsCheck.pathExists(toolPath)) {
    return { success:false, error:'ideviceimagemounter not installed - run install-remaining.ps1' }
  }
  const args = udid ? ['-u', udid, 'list'] : ['list']
  return new Promise(async (res) => {
    const proc = spawn(toolPath, args)
    let out='', err=''
    proc.stdout?.on('data',d=>out+=d)
    proc.stderr?.on('data',d=>err+=d)
    proc.on('error', e => res({ success:false, error:e.message }))
    proc.on('close', code => res({ success:code===0, output:out.trim(), error:err.trim()||null }))
  })
}

//    Port forwarding / proxy                                               
let proxyProcs = new Map()
export async function startPortForward(udid, localPort, devicePort) {
  const key = `${udid}:${localPort}:${devicePort}`
  if (proxyProcs.has(key)) return { success:true, already:true, key }
  const args = udid ? ['-u', udid, localPort, devicePort] : [localPort, devicePort]
  const proc = spawn(bin('iproxy'), args.map(String))
  proxyProcs.set(key, proc)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => proxyProcs.delete(key))
  await new Promise(r => setTimeout(r, 500))
  return { success:true, key, localPort, devicePort, pid:proc.pid }
}

export async function stopPortForward(key) {
  const proc = proxyProcs.get(key)
  if (proc) { try { proc.kill() } catch {} ; proxyProcs.delete(key) }
  return { success:true }
}

export async function listPortForwards() {
  return Array.from(proxyProcs.keys()).map(key => {
    const [udid, local, device] = key.split(':')
    return { key, udid, localPort:parseInt(local), devicePort:parseInt(device) }
  })
}

//    Notification                                                          
export async function sendNotification(udid, bundleId, message, title='Omerta') {
  const args = udid
    ? ['-u', udid, 'post', bundleId, title, message]
    : ['post', bundleId, title, message]
  return new Promise(async (res) => {
    const proc = spawn(bin('idevicenotificationproxy'), args)
    let out='', err=''
    proc.stdout?.on('data',d=>out+=d)
    proc.stderr?.on('data',d=>err+=d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => res({ success:code===0, output:out.trim(), error:err.trim()||null }))
  })
}

//    Developer mode                                                        
export async function enableDeveloperMode(udid) {
  return new Promise(async (res) => {
    const proc = spawn(bin('idevicediagnostics'), udid ? ['-u', udid, 'restart'] : ['restart'])
    let out='', err=''
    proc.stdout?.on('data',d=>out+=d)
    proc.stderr?.on('data',d=>err+=d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => res({
      success: code===0,
      output: out.trim(),
      error: err.trim()||null,
      note: 'Developer mode requires iOS 16+. On device: Settings > Privacy > Developer Mode > Enable'
    }))
  })
}

//    USB mux status                                                        
export async function usbmuxStatus(udid) {
  return new Promise(async (res) => {
    const proc = spawn(bin('idevice_id'), ['-l'])
    let out='', err=''
    proc.stdout?.on('data',d=>out+=d)
    proc.stderr?.on('data',d=>err+=d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => {
      const devices = out.split('\n').filter(Boolean)
      const found = udid ? devices.includes(udid) : devices.length > 0
      res({ success:code===0, devices, count:devices.length, found, usbmuxRunning:code===0 })
    })
  })
}

//    Location services audit                                               
export async function locationServicesAudit(udid) {
  return {
    note: 'Location services audit requires jailbreak (Filza access to /var/mobile/Library/Caches/locationd/clients.plist)',
    method: 'Pull /var/mobile/Library/Caches/locationd/clients.plist via AFC2 or SSH, then parse the plist to see which apps have location access.',
    steps: [
      'Jailbroken: Use Filza to navigate to /var/mobile/Library/Caches/locationd/',
      'Copy clients.plist to /var/mobile/Media/',
      'Pull via: idevicebackup2 afc /var/mobile/Media/clients.plist ./output/',
      'Parse the plist to see all app location permissions'
    ],
    nonJailbreak: 'Settings > Privacy & Security > Location Services -- check each app manually'
  }
}

//    Screen time data                                                      
export async function extractScreenTimeData(udid, destDir) {
  await fs.ensureDir(destDir)
  return new Promise(async (res) => {
    const args = udid ? ['-u', udid, 'backup', '--full', destDir] : ['backup', '--full', destDir]
    const proc = spawn(bin('idevicebackup2'), args)
    let out=''
    proc.stdout?.on('data',d=>{ out+=d })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async code => {
      if (code!==0) { res({ success:false, error:'Backup failed' }); return }
      try {
        const dirs = await fs.readdir(destDir)
        const found = []
        for (const dir of dirs) {
          const subDir = join(destDir, dir)
          const stat = await fs.stat(subDir).catch(()=>null)
          if (!stat?.isDirectory()) continue
          const files = await fs.readdir(subDir).catch(()=>[])
          for (const file of files) {
            if (file.includes('ScreenTime') || file.includes('com.apple.ScreenTime')) {
              found.push(join(subDir, file))
            }
          }
        }
        res({ success:true, files:found, destDir, note:'Open SQLite files with Omerta SQLite Browser' })
      } catch(e) { res({ success:false, error:e.message }) }
    })
  })
}

//    Health data                                                           
export async function extractHealthData(udid, destDir) {
  await fs.ensureDir(destDir)
  return new Promise(async (res) => {
    const args = udid ? ['-u', udid, 'backup', '--full', destDir] : ['backup', '--full', destDir]
    const proc = spawn(bin('idevicebackup2'), args)
    proc.stdout?.on('data',()=>{})

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async code => {
      if (code!==0) { res({ success:false, error:'Backup failed - ensure device is trusted' }); return }
      try {
        const dirs = await fs.readdir(destDir)
        const healthFiles = []
        for (const dir of dirs) {
          const sub = join(destDir, dir)
          const stat = await fs.stat(sub).catch(()=>null)
          if (!stat?.isDirectory()) continue
          const files = await fs.readdir(sub).catch(()=>[])
          for (const file of files) {
            const full = join(sub, file)
            const fstat = await fs.stat(full).catch(()=>null)
            if (!fstat) continue
            const content = await fs.readFile(full, 'utf8').catch(()=>'')
            if (content.includes('Health') || content.includes('workout') || content.includes('HKQuantity')) {
              healthFiles.push({ file: full, size: fstat.size })
            }
          }
        }
        res({ success:true, files:healthFiles, note:'Health database is in healthdb.sqlite - open in SQLite Browser' })
      } catch(e) { res({ success:false, error:e.message }) }
    })
  })
}

//    Notes export                                                          
export async function exportNotes(udid, destDir) {
  await fs.ensureDir(destDir)
  return new Promise(async (res) => {
    const args = udid ? ['-u', udid, 'backup', '--full', destDir] : ['backup', '--full', destDir]
    const proc = spawn(bin('idevicebackup2'), args)
    proc.stdout?.on('data',()=>{})

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async code => {
      if (code!==0) { res({ success:false, error:'Backup failed' }); return }
      try {
        const dirs = await fs.readdir(destDir)
        for (const dir of dirs) {
          const sub = join(destDir, dir)
          const stat = await fs.stat(sub).catch(()=>null)
          if (!stat?.isDirectory()) continue
          const files = await fs.readdir(sub).catch(()=>[])
          for (const file of files) {
            try {
              const full = join(sub, file)
              const data = await fs.readFile(full)
              if (data.toString('utf8',0,100).includes('NoteBody') || data.toString('utf8',0,100).includes('ZNOTE')) {
                const dest = join(destDir, 'Notes.sqlite')
                await fs.copy(full, dest)
                res({ success:true, path:dest, note:'Open in SQLite Browser. Table: ZNOTE, column: ZBODY' })
                return
              }
            } catch {}
          }
        }
        res({ success:false, error:'Notes database not found in backup' })
      } catch(e) { res({ success:false, error:e.message }) }
    })
  })
}

//    App document browser                                                  
export async function listAppDocuments(udid, bundleId) {
  return {
    note: `App documents for ${bundleId} are accessible via backup or AFC (jailbroken)`,
    backupPath: `Documents/${bundleId}/`,
    methods: [
      'Create backup with idevicebackup2, find app container in backup',
      'Jailbroken: AFC2 access to /var/mobile/Containers/Data/Application/<UUID>/',
      'Non-jailbroken: encrypted backup + decrypt to access app data',
    ]
  }
}

//    MDM check                                                             
export async function checkMDM(udid) {
  return new Promise(async (res) => {
    const args = udid ? ['-u', udid, '-q', 'com.apple.mdm'] : ['-q', 'com.apple.mdm']
    const proc = spawn(bin('ideviceinfo'), args)
    let out='', err=''
    proc.stdout?.on('data',d=>out+=d)
    proc.stderr?.on('data',d=>err+=d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', async code => {
      const hasMdm = out.includes('ServerURL') || out.includes('MDM') || out.length > 20
      const profiles = await getProfiles(udid)
      res({
        hasMDM: hasMdm,
        mdmOutput: out.trim(),
        profiles: profiles,
        removalOptions: [
          'If you are the device owner: Settings > General > VPN & Device Management > tap profile > Remove',
          'For system MDM (jailbroken): Delete /var/db/ConfigurationProfiles/Settings/ folder contents',
          'Factory reset removes all MDM profiles except DEP (Device Enrollment Program)',
          'DEP MDM re-enrolls on setup - only MDM server admin can remove it'
        ]
      })
    })
  })
}

async function getProfiles(udid) {
  const toolPath = bin('ideviceprovision')
  const { default: fsCheck } = await import('fs-extra')
  if (!await fsCheck.pathExists(toolPath)) {
    return { count:0, profiles:[], error:'ideviceprovision not installed - run install-remaining.ps1' }
  }
  return new Promise(async (res) => {
    const args = udid ? ['-u', udid, 'list', '--all'] : ['list', '--all']
    const proc = spawn(toolPath, args)
    let out='', err=''
    proc.stdout?.on('data',d=>out+=d)
    proc.stderr?.on('data',d=>err+=d)
    proc.on('error', e => res({ count:0, profiles:[], error:e.message }))
    proc.on('close', () => {
      const profiles = out.split('\n').filter(l=>l.trim()).map(l=>l.trim())
      res({ count:profiles.length, profiles, error: err||null })
    })
  })
}

//    Springboard (jailbroken)                                              
export async function respring(udid) {
  return new Promise(async (res) => {
    const proc = spawn(bin('idevicediagnostics'), udid ? ['-u',udid,'restart'] : ['restart'])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => res({ success:code===0, note:'Respring requires jailbreak - use killall SpringBoard via SSH instead for soft respring' }))
  })
}

//    Battery calibration info                                              
export async function getBatteryDetail(udid) {
  return new Promise(async (res) => {
    const proc = spawn(bin('idevicediagnostics'), udid ? ['-u',udid,'sleep'] : ['sleep'])
    let out=''
    proc.stdout?.on('data',d=>out+=d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => {
      const proc2 = spawn(bin('ideviceinfo'), udid ? ['-u',udid,'-q','com.apple.mobile.battery'] : ['-q','com.apple.mobile.battery'])
      let out2=''
      proc2.stdout?.on('data',d=>out2+=d)
      proc2.on('close', code => {
        const getVal = (str, key) => str.match(new RegExp(key+'\\s*=\\s*([^\\n;]+)'))?.[1]?.trim()
        res({
          success: code===0,
          level:          getVal(out2,'BatteryCurrentCapacity'),
          cycleCount:     getVal(out2,'CycleCount'),
          designCapacity: getVal(out2,'DesignCapacity'),
          nominalChargeCapacity: getVal(out2,'NominalChargeCapacity'),
          maximumFCC:     getVal(out2,'MaximumFCC'),
          isCharging:     getVal(out2,'BatteryIsCharging'),
          temperature:    getVal(out2,'Temperature'),
          voltage:        getVal(out2,'Voltage'),
          raw: out2.trim(),
          healthPct: (() => {
            const nom = parseInt(getVal(out2,'NominalChargeCapacity'))
            const des = parseInt(getVal(out2,'DesignCapacity'))
            return nom && des ? Math.round(nom/des*100)+'%' : null
          })()
        })
      })
    })
  })
}

//    UDID spoofer info                                                     
export function udidSpooferInfo() {
  return {
    supported: false,
    note: 'UDID spoofing requires a jailbroken device with specific tweaks',
    methods: [
      { name: 'UDIDFaker (Cydia)', description: 'Deprecated, old iOS only', works: false },
      { name: 'KeychainEditing (Jailbroken)', description: 'Edit /private/var/Keychains/TrustStore.sqlite3 - complex, not recommended', works: false },
      { name: 'Custom IPSW', description: 'Modify UDID in firmware at restore time using custom tools', works: false },
      { name: 'Simulator', description: 'iOS Simulator on macOS has a configurable device identifier', works: true },
    ],
    warning: 'UDID spoofing on physical devices is not reliably possible on modern iOS without deep hardware access'
  }
}

//    IPA downgrade finder                                                  
export async function findIpaDowngrade(appName) {
  const axios = (await import('axios')).default
  try {
    const search = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(appName)}&entity=software&limit=5`, { timeout: 10000 })
    const results = search.data?.results?.map(r => ({
      name: r.trackName,
      bundleId: r.bundleId,
      version: r.version,
      price: r.price===0 ? 'Free' : '$'+r.price,
      appId: r.trackId,
      artworkUrl: r.artworkUrl100,
      minimumOsVersion: r.minimumOsVersion,
    })) || []
    return {
      results,
      note: 'To get older versions: use ipatool (github.com/majd/ipatool) to download specific versions from App Store with your Apple ID',
      ipatoolHint: `ipatool download --bundle-id <bundleId> --output ./app.ipa`
    }
  } catch(e) {
    return { error: e.message, results: [] }
  }
}

//    Full device audit report                                               
export async function generateAuditReport(udid, onProgress) {
  const report = {
    timestamp: new Date().toISOString(),
    sections: {}
  }

  onProgress?.({ percent: 5, message: 'Collecting device info...' })
  try {
    const proc = spawn(bin('ideviceinfo'), udid ? ['-u',udid] : [])
    let out=''
    proc.stdout?.on('data',d=>out+=d)
    await new Promise(res => proc.on('close', res))
    report.sections.deviceInfo = out
  } catch(e) { report.sections.deviceInfo = { error: e.message } }

  onProgress?.({ percent: 20, message: 'Checking installed apps...' })
  try {
    const proc = spawn(bin('ideviceinstaller'), udid ? ['-u',udid,'-l'] : ['-l'])
    let out=''
    proc.stdout?.on('data',d=>out+=d)
    await new Promise(res => proc.on('close', res))
    report.sections.apps = out
  } catch(e) { report.sections.apps = { error: e.message } }

  onProgress?.({ percent: 40, message: 'Reading syslog snapshot...' })
  try {
    const logOut = await new Promise(res => {
      const proc = spawn(bin('idevicesyslog'), udid ? ['-u',udid,'--no-color'] : ['--no-color'])
      let out=''
      proc.stdout?.on('data',d=>out+=d)
      setTimeout(() => { proc.kill(); res(out) }, 3000)
    })
    report.sections.syslog = logOut.slice(-10000)
  } catch(e) { report.sections.syslog = { error: e.message } }

  onProgress?.({ percent: 60, message: 'Battery diagnostics...' })
  try {
    report.sections.battery = await getBatteryDetail(udid)
  } catch(e) { report.sections.battery = { error: e.message } }

  onProgress?.({ percent: 80, message: 'Date and network info...' })
  try {
    report.sections.date = await getDeviceDate(udid)
  } catch(e) { report.sections.date = { error: e.message } }

  onProgress?.({ percent: 95, message: 'Finalizing report...' })
  const destDir = join(app.getPath('userData'), 'ios_audit')
  await fs.ensureDir(destDir)
  const reportPath = join(destDir, `audit_${Date.now()}.json`)
  await fs.writeJson(reportPath, report, { spaces: 2 })

  onProgress?.({ percent: 100, message: 'Report complete!' })
  return { success: true, path: reportPath, sections: Object.keys(report.sections) }
}
