import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import axios from 'axios'
import crypto from 'crypto'

function binDir() { return app.isPackaged ? join(process.resourcesPath,'bin') : join(process.cwd(),'bin') }

export class FlashToolRegistry {
  getAll() {
    const plat = process.platform
    const all = [
      { id:'ventoy',        category:'Multi-boot',   icon:'F', name:'Ventoy',                   tagline:'Put 100s of ISOs on one USB. Copy files, done.',       description:'Install Ventoy once, then drag and drop any ISO. Boot any from menu. No reformatting ever again. Supports 1000+ ISO formats, UEFI+Legacy, Secure Boot, persistence.',         bestFor:'Multiple OSes on one USB',                    pros:['No re-flash when adding ISOs','UEFI + Legacy + Secure Boot','1000+ supported ISOs','Persistence support','100% free and open source'],cons:['Slight overhead vs raw write','Some ISOs need workarounds'], rating:5, tags:['recommended','multiboot','free','open-source'],githubRepo:'ventoy/Ventoy',          websiteUrl:'https://www.ventoy.net',            platforms:['win32','linux','darwin'],launchBin:'ventoy\\Ventoy2Disk.exe', openInBrowser:false, isIso:false },
      { id:'yumi',          category:'Multi-boot',   icon:'Y', name:'YUMI Multiboot',            tagline:'Classic multiboot USB with built-in distro downloader', description:'YUMI creates a multiboot USB with integrated distro download list. Simpler than Ventoy for beginners. Casper persistence support. Downloads ISOs for you.',             bestFor:'Multiboot with built-in distro downloader',   pros:['Downloads ISOs automatically','150+ distros built-in','Persistence support','UEFI + Legacy'],cons:['Windows only','Less maintained now'],           rating:4, tags:['multiboot','downloader','windows-only'],websiteUrl:'https://www.pendrivelinux.com/yumi-multiboot-usb-creator/',            platforms:['win32'],                            launchBin:'YUMI.exe',               openInBrowser:false, isIso:false },
      { id:'rufus',         category:'ISO Flasher',  icon:'R', name:'Rufus',                    tagline:'Fastest Windows USB creator. TPM bypass built-in.',    description:'Gold standard for Windows USB creation. Single portable EXE, no install. Fastest write speed. Includes Windows 11 TPM/Secure Boot bypass. Bad sector detection. FAT32/NTFS/ext4.',          bestFor:'Windows 10/11 install USB, speed',            pros:['Fastest write speed','Win 11 TPM bypass','No install (portable)','Bad sector check','FAT32/NTFS/ext4'],       cons:['Windows only','Single ISO only'],               rating:5, tags:['recommended','windows-only','fast','portable'],githubRepo:'pbatard/rufus',         websiteUrl:'https://rufus.ie',                  platforms:['win32'],                            launchBin:'rufus.exe',              openInBrowser:false, isIso:false },
      { id:'etcher',        category:'ISO Flasher',  icon:'E', name:'Balena Etcher',            tagline:'Simplest flasher. Select, pick drive, flash.',         description:'Most beginner-friendly flasher. Three clicks. Auto-decompresses .xz/.gz images. Validates write when done. Clone drive to drive. Perfect for Raspberry Pi images.',           bestFor:'Beginners, Raspberry Pi, cross-platform',     pros:['Extremely simple','Auto-validates','Handles compressed images','Clone drive feature','Cross-platform'],     cons:['Slower than Rufus','Large download (~160MB)'],  rating:4, tags:['beginner','cross-platform','validates'],githubRepo:'balena-io/etcher',      websiteUrl:'https://etcher.balena.io',          platforms:['win32','linux','darwin'],launchBin:'balenaEtcher.exe',       openInBrowser:false, isIso:false },
      { id:'win32diskimager',category:'ISO Flasher', icon:'W', name:'Win32 Disk Imager',        tagline:'Write and backup raw .img images on Windows',          description:'Writes raw disk images (.img) to USB/SD cards. Also reads drives to .img files. Essential for Raspberry Pi, Android ROMs, and partition images that are not ISO format.',    bestFor:'Raw .img files, drive backups, SD cards',     pros:['Raw .img write','Drive backup to image','Lightweight','Simple'],                                           cons:['Windows only','No .iso format'],                rating:3, tags:['raw-img','backup','windows-only'],   websiteUrl:'https://sourceforge.net/projects/win32diskimager/',                    platforms:['win32'],                            launchBin:'Win32DiskImager.exe',    openInBrowser:false, isIso:false },
      { id:'unetbootin',    category:'ISO Flasher',  icon:'U', name:'UNetbootin',               tagline:'Downloads and flashes Linux in one step',              description:'Built-in catalog of 100+ Linux distros. Downloads ISO and writes to USB automatically. Also supports persistence. Good for first-time Linux users.',                            bestFor:'One-click Linux download and flash',          pros:['Downloads ISOs for you','Cross-platform','Persistence','150+ distro catalog'],                            cons:['Some distros need repair after','Slower'],     rating:3, tags:['downloader','cross-platform','persistence'],githubRepo:'unetbootin/unetbootin',websiteUrl:'https://unetbootin.github.io',      platforms:['win32','linux','darwin'],launchBin:'unetbootin.exe',         openInBrowser:false, isIso:false },
      { id:'rpi-imager',    category:'Specialist',   icon:'S', name:'Raspberry Pi Imager',      tagline:'Official Pi tool. Pre-configures WiFi and SSH.',       description:'Official Raspberry Pi Foundation flasher. Pre-configure WiFi credentials, SSH, hostname and user before writing. Includes every Pi OS variant. Validates after write. No extra steps.',    bestFor:'All Raspberry Pi boards',                     pros:['Official tool','Pre-configure WiFi/SSH/hostname','All Pi OS variants','Validates write','Cross-platform'], cons:['Pi only'],                                     rating:5, tags:['raspberry-pi','official','recommended'],githubRepo:'raspberrypi/rpi-imager', websiteUrl:'https://www.raspberrypi.com/software/',platforms:['win32','linux','darwin'],launchBin:'rpi-imager.exe',         openInBrowser:false, isIso:false },
      { id:'android-flash', category:'Specialist',   icon:'A', name:'Android Flash Tool',       tagline:'Flash Pixel phones via browser. No drivers needed.',   description:"Google's official web-based flashing tool for Pixel phones. Connects via WebUSB directly from Chrome. Flashes factory images. No software install. Works on all Pixel models.",    bestFor:'Google Pixel phones',                         pros:['No install needed','Official Google tool','All Pixel models','WebUSB via Chrome'],                         cons:['Pixel only','Needs Chrome','Needs internet'],  rating:5, tags:['pixel','google','web-only'],          websiteUrl:'https://flash.android.com',         platforms:['win32','linux','darwin'],launchBin:null,              openInBrowser:true,  isIso:false },
      { id:'odin',          category:'Specialist',   icon:'O', name:'Odin (Samsung)',            tagline:'Flash firmware and ROMs to Samsung devices',           description:'Samsung official (leaked) flashing tool. Flashes .tar.md5 and .zip packages to Samsung phones in Download Mode. Used for stock firmware restore, root, and custom ROMs.',           bestFor:'Samsung firmware and custom ROM flashing',    pros:['All Samsung devices','Stock + custom firmware','Fast Download Mode flash'],                               cons:['Windows only','Samsung only','Leaked tool'],   rating:4, tags:['samsung','firmware','specialist'],    websiteUrl:'https://samsungodin.com',           platforms:['win32'],                            launchBin:'Odin3.exe',              openInBrowser:false, isIso:false },
      { id:'sp-flash-tool', category:'Specialist',   icon:'M', name:'SP Flash Tool (MediaTek)',  tagline:'Flash and unbrick MTK Android devices via BROM',      description:'Essential for MediaTek chip Android phones. Flashes scatter files for stock recovery, custom ROMs, and unbrick operations even when device does not boot at all.',             bestFor:'MediaTek phones -- flash and unbrick',        pros:['Works on bricked devices','Full ROM flashing','No boot needed'],                                           cons:['MTK only','Complex UI','Driver issues on Win11'],rating:4,tags:['mediatek','mtk','unbrick','specialist'], websiteUrl:'https://spflashtool.com',           platforms:['win32','linux'],                    launchBin:'flash_tool.exe',         openInBrowser:false, isIso:false },
      { id:'mi-flash',      category:'Specialist',   icon:'X', name:'MiFlash (Xiaomi)',          tagline:'Official Xiaomi EDL and fastboot firmware tool',       description:'Xiaomi official tool for flashing .tgz firmware via fastboot or EDL (9008) mode. Required for Xiaomi stock restore and MIUI flashing. Includes EDL port detection.',               bestFor:'Xiaomi / MIUI firmware and stock restore',    pros:['Official Xiaomi tool','EDL + fastboot','Easy stock restore'],                                              cons:['Xiaomi only','Windows only'],                  rating:3, tags:['xiaomi','miui','edl'],               websiteUrl:'https://www.xiaomiflash.com',        platforms:['win32'],                            launchBin:'MiFlash.exe',            openInBrowser:false, isIso:false },
      { id:'qfil',          category:'Specialist',   icon:'Q', name:'QFIL (Qualcomm EDL)',       tagline:'Flash Snapdragon devices via EDL 9008 mode',           description:'Qualcomm official tool for flashing via Emergency Download Mode (port 9008). Flashes Snapdragon device firmware, unbricks, full partition access. Works when device is completely dead.',bestFor:'Qualcomm Snapdragon -- firmware and unbrick',  pros:['Works on bricked devices','Full partition access','Official Qualcomm tool'],                               cons:['Qualcomm only','Windows only','Complex'],       rating:4, tags:['qualcomm','snapdragon','edl','unbrick'],websiteUrl:'https://qfil.download',             platforms:['win32'],                            launchBin:'QFIL.exe',               openInBrowser:false, isIso:false },
      { id:'heimdall',      category:'Specialist',   icon:'H', name:'Heimdall (Samsung OSS)',    tagline:'Open-source Samsung flashing for Linux and macOS',     description:'Free open-source alternative to Odin for Samsung. Cross-platform. Flashes .pit partition tables and partition files. Best choice for Samsung flashing on Linux or macOS.',       bestFor:'Samsung flashing on Linux and macOS',         pros:['Open source','Cross-platform','No proprietary deps'],                                                     cons:['Less reliable than Odin','Fewer features'],    rating:3, tags:['samsung','open-source','linux','macos'],githubRepo:'Benjamin-Dobell/Heimdall',websiteUrl:'https://glassechidna.com.au/heimdall/',platforms:['win32','linux','darwin'],launchBin:'heimdall-frontend.exe',  openInBrowser:false, isIso:false },
      { id:'idevicerestore',category:'Specialist',   icon:'I', name:'idevicerestore',            tagline:'Restore iOS devices to any IPSW without iTunes',       description:'Command-line restore for iOS devices. Works without iTunes. Supports tethered restores with SHSH2 blobs via FutureRestore. All iOS versions. Essential for downgrading.',          bestFor:'iOS firmware restore, downgrade with blobs',  pros:['iTunes-free','All IPSW versions','Tethered restore with blobs'],                                          cons:['CLI only','Complex'],                          rating:4, tags:['ios','ipsw','restore'],               websiteUrl:'https://github.com/libimobiledevice/idevicerestore', platforms:['win32','linux','darwin'],launchBin:'idevicerestore.exe',     openInBrowser:false, isIso:false },
      { id:'hddrawcopy',    category:'Drive Utility',icon:'C', name:'HDD Raw Copy Tool',        tagline:'Sector-by-sector cloning, even damaged drives',        description:'Creates exact sector-by-sector copies of drives and USB sticks including bad sectors. Works on drives with damaged file systems. Good for forensic backups and data recovery.',  bestFor:'Drive cloning, forensic copies, damaged drives',pros:['Sector copy','Damaged drive support','All formats'],con:['Windows only','Slow'],                         rating:4, tags:['clone','forensic','recovery'],       websiteUrl:'https://hddguru.com/software/HDD-Raw-Copy-Tool/', platforms:['win32'],                            launchBin:'HDDRawCopy.exe',         openInBrowser:false, isIso:false },
      { id:'gparted-live',  category:'Drive Utility',icon:'G', name:'GParted Live (bootable)',  tagline:'Boot from USB to partition any drive on any PC',      description:'Bootable Linux OS focused on disk partitioning. Boot it to resize, move and fix partitions on any disk including your boot drive. Fix corrupt partition tables. Supports all filesystems.',bestFor:'Partitioning the drive you are currently using',pros:['Works on any PC','Resizes NTFS live','Fixes partition tables'],cons:['Must boot from USB'],           rating:5, tags:['partition','bootable','repair','free'],websiteUrl:'https://gparted.org/livecd.php',    platforms:['win32','linux','darwin'],launchBin:null,              openInBrowser:false, isIso:true  },
    ]
    return all.filter(t => t.platforms.includes(plat))
  }

  async checkInstalled(tools) {
    const bd = binDir()
    return Promise.all(tools.map(async t => {
      if (t.isInBin || t.openInBrowser || !t.launchBin) return { ...t, installed: t.openInBrowser || false }
      const p = join(bd, t.launchBin)
      const ok = await fs.pathExists(p)
      return { ...t, installed: ok, localPath: ok ? p : null }
    }))
  }
}

export class WriteEngine {
  constructor() { this.proc = null }

  async smartWrite(isoPath, drive, onProgress) {
    const plat = process.platform
    onProgress?.({ percent: 1, message: 'Preparing write...' })
    if (plat === 'win32') return this._writePS(isoPath, drive.device, onProgress)
    return this._writeDd(isoPath, drive.device, onProgress)
  }

  async _writePS(isoPath, device, onProgress) {
    const script = `
$src = [System.IO.File]::OpenRead('${isoPath.replace(/\\/g, '\\\\')}')
$dst = [System.IO.File]::OpenWrite('${device.replace(/\\/g, '\\\\')}')
$buf = New-Object byte[] 4194304
$total = $src.Length; $done = 0
while(($r = $src.Read($buf,0,$buf.Length)) -gt 0){$dst.Write($buf,0,$r);$done+=$r;Write-Host "P:$([int]($done*100/$total))"}
$dst.Flush(); $src.Close(); $dst.Close(); Write-Host "DONE"
`
    const tmp = join(app.getPath('temp'), 'omerta_write.ps1')
    await fs.writeFile(tmp, script)
    return new Promise((resolve, reject) => {
      this.proc = spawn('powershell', ['-NoProfile','-ExecutionPolicy','Bypass','-File',tmp])
      let out = ''
      this.proc.stdout.on('data', d => {
        out += d
        const m = out.match(/P:(\d+)/)
        if (m) onProgress?.({ percent: parseInt(m[1]), message: `Writing... ${m[1]}%` })
        if (out.includes('DONE')) onProgress?.({ percent: 99, message: 'Flushing...' })
      })
      this.proc.on('close', code => { fs.remove(tmp).catch(() => {}); code === 0 ? resolve({ success: true }) : reject(new Error(out.slice(-400))) })
    })
  }

  async _writeDd(isoPath, device, onProgress) {
    const stat = await fs.stat(isoPath)
    return new Promise((resolve, reject) => {
      this.proc = spawn('dd', [`if=${isoPath}`,`of=${device}`,'bs=4M','status=progress','oflag=sync'])
      let out = ''
      this.proc.stderr.on('data', d => {
        out += d
        const m = out.match(/(\d+) bytes/)
        if (m && stat.size) onProgress?.({ percent: Math.min(99, Math.round(parseInt(m[1])/stat.size*100)), message: d.toString().trim() })
      })
      this.proc.on('close', code => code === 0 ? resolve({ success: true }) : reject(new Error(out.slice(-300))))
    })
  }

  async verify(isoPath, device, onProgress) {
    const stat = await fs.stat(isoPath)
    const hashFile = chunk => new Promise((res, rej) => {
      const h = crypto.createHash('sha256')
      const s = fs.createReadStream(chunk.path, chunk.opts)
      s.on('data', d => h.update(d)); s.on('end', () => res(h.digest('hex'))); s.on('error', rej)
    })
    onProgress?.({ percent: 20, message: 'Hashing ISO...' })
    const isoHash = await hashFile({ path: isoPath, opts: {} })
    onProgress?.({ percent: 60, message: 'Hashing USB drive...' })
    const usbHash = await hashFile({ path: device, opts: { end: stat.size - 1 } })
    onProgress?.({ percent: 100, message: 'Done' })
    return { match: isoHash === usbHash, isoHash, usbHash }
  }

  cancel() { if (this.proc) { try { this.proc.kill() } catch {} ; this.proc = null } }
}

export class FlashWizard {
  getUseCases() {
    return [
      { id:'windows_install',   icon:'F', name:'Install Windows',              desc:'Create a bootable Windows 10 or 11 USB',                  recommendedTool:'rufus',        minGb:8,  steps:['Download Windows ISO from Microsoft','Open Rufus and select the ISO','Select your USB drive','Click Start -- Rufus handles TPM bypass automatically','Boot from USB: restart, press F12 (or F9/Del), select USB'] },
      { id:'linux_try',         icon:'L', name:'Try Linux without installing',  desc:'Boot Linux from USB, nothing installed on your PC',       recommendedTool:'etcher',       minGb:4,  steps:['Pick a distro from the OS Catalog (Ubuntu or Mint for beginners)','Download the ISO','Flash with Etcher -- select ISO, select USB, flash','Restart, press F12, boot from USB','Select "Try Ubuntu" (or similar) -- runs without touching your hard drive'] },
      { id:'multiboot',         icon:'M', name:'Multiple OSes on one USB',      desc:'Carry many operating systems on a single USB drive',       recommendedTool:'ventoy',       minGb:16, steps:['Download Ventoy and install it to USB (one-time)','Copy any ISO files to the USB drive root','Add more ISOs any time -- just copy them','Boot from USB -- Ventoy shows a menu of all ISOs'] },
      { id:'raspberry_pi',      icon:'P', name:'Set up Raspberry Pi',           desc:'Flash Pi OS to SD card with WiFi and SSH pre-configured', recommendedTool:'rpi-imager',   minGb:8,  steps:['Download Raspberry Pi Imager','Select OS (Raspberry Pi OS recommended)','Click the gear icon to pre-set WiFi, SSH, hostname, and username','Select your SD card or USB','Write -- it validates automatically'] },
      { id:'recovery_usb',      icon:'A', name:'System recovery USB',           desc:'Fix a broken PC by booting from a rescue drive',          recommendedTool:'etcher',       minGb:4,  steps:['Download SystemRescue or Hirens BootCD from the OS Catalog','Flash with Etcher or Rufus','Take the USB to the broken PC','Restart and press F12 to boot from USB','Use the recovery tools to repair the system'] },
      { id:'android_stock',     icon:'R', name:'Restore Android to stock',      desc:'Flash official firmware back to an Android phone',         recommendedTool:'android-flash',minGb:0,  steps:['Enable USB Debugging: Settings > About > tap Build Number x7','For Pixel: use Android Flash Tool (browser-based, no install)','For Samsung: use Odin with a .tar.md5 stock firmware package','For Xiaomi: use MiFlash with a .tgz package','For others: use fastboot flash with official factory image'] },
      { id:'ventoy_persistent', icon:'V', name:'Persistent Linux on USB',       desc:'Run Linux from USB with your files saved between reboots',  recommendedTool:'ventoy',       minGb:16, steps:['Install Ventoy on USB','Download Ubuntu or Kali ISO','Create a persistence file: ventoyplugson.json or use Ventoy tools','Copy ISO to USB','Boot from USB and select persistence option from boot menu','Changes are saved between reboots'] },
      { id:'ios_restore',       icon:'I', name:'Restore iPhone without iTunes', desc:'Flash any iOS firmware directly without Apple restrictions', recommendedTool:'idevicerestore',minGb:0, steps:['Download the IPSW file from Omerta iOS Hub or ipsw.me','Put iPhone into DFU or Recovery mode','Run idevicerestore with the IPSW path','Wait for restore to complete -- device reboots automatically','Note: only currently signed firmwares restore without SHSH blobs'] },
    ]
  }

  getBootKeys() {
    return [
      { brand:'ASUS',     keys:'F8 or Esc' },
      { brand:'Acer',     keys:'F12' },
      { brand:'Dell',     keys:'F12' },
      { brand:'HP',       keys:'F9 or Esc then F9' },
      { brand:'Lenovo',   keys:'F12 or Novo button' },
      { brand:'MSI',      keys:'F11' },
      { brand:'Gigabyte', keys:'F12' },
      { brand:'Samsung',  keys:'F10 or Esc' },
      { brand:'Toshiba',  keys:'F12' },
      { brand:'Surface',  keys:'Volume Down while powering on' },
      { brand:'MacBook',  keys:'Hold Option at startup' },
      { brand:'Any',      keys:'Try F12, F10, F9, Del, or Esc' },
    ]
  }
}

export default { FlashToolRegistry, WriteEngine, FlashWizard }
