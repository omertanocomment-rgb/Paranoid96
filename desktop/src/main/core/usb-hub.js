/**
 * OMERTA -- USB Device Hub Backend
 * Drive detection, bootable USB tools, OS catalog, ISO management
 */

import { spawn, execFile } from 'child_process'
import plistLib from 'plist'
const plist = {
  parse: (str) => {
    if (!str || (typeof str === 'string' && str.trim().length < 10)) return {}
    try { return plistLib.parse(typeof str === 'string' ? str : str.toString()) } catch(e) { return {} }
  }
}
import { promisify } from 'util'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'

const execAsync = promisify(execFile)

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

//                                                                               
// USB DRIVE DETECTOR -- list all connected removable drives
//                                                                               
export class UsbDriveDetector {
  async list() {
    const plat = process.platform
    try {
      if (plat === 'win32') return await this.listWindows()
      if (plat === 'darwin') return await this.listMac()
      return await this.listLinux()
    } catch (e) {
      console.error('Drive list failed:', e.message)
      return []
    }
  }

  async listWindows() {
    // Use PowerShell Get-Volume + Get-Disk (works on all modern Windows, no wmic needed)
    const script = `
$results = @()
Get-Volume | Where-Object { $_.DriveType -eq 'Removable' -or $_.DriveType -eq 'Fixed' } | ForEach-Object {
  $vol = $_
  if ($vol.DriveLetter) {
    $letter = "$($vol.DriveLetter):"
    $disk = Get-Partition -DriveLetter $vol.DriveLetter -ErrorAction SilentlyContinue | Get-Disk -ErrorAction SilentlyContinue
    $isUsb = $disk.BusType -eq 'USB' -or $vol.DriveType -eq 'Removable'
    if ($isUsb) {
      $results += [PSCustomObject]@{
        Letter     = $letter
        Label      = if ($vol.FileSystemLabel) { $vol.FileSystemLabel } else { 'USB Drive' }
        FileSystem = $vol.FileSystem
        SizeBytes  = $vol.Size
        FreeBytes  = $vol.SizeRemaining
        Model      = if ($disk) { $disk.FriendlyName } else { 'Removable Drive' }
        DeviceId   = if ($disk) { "\\.\\PhysicalDrive$($disk.Number)" } else { $letter }
      }
    }
  }
}
$results | ConvertTo-Json -Depth 2`

    const result = await new Promise(async (resolve) => {
      const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])
      let out = ''
      proc.stdout.on('data', d => out += d)
      proc.stderr.on('data', () => {})

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => resolve(out.trim()))
    })

    if (!result || result === 'null') return []

    try {
      const data = JSON.parse(result)
      const arr = Array.isArray(data) ? data : [data]
      return arr.filter(Boolean).map(d => ({
        device: d.DeviceId || d.Letter || '',
        name: d.Model || 'USB Drive',
        label: d.Label || 'Removable',
        size: parseInt(d.SizeBytes) || 0,
        sizeGb: d.SizeBytes ? (parseInt(d.SizeBytes) / 1e9).toFixed(1) : '?',
        freeGb: d.FreeBytes ? (parseInt(d.FreeBytes) / 1e9).toFixed(1) : '?',
        letter: d.Letter || '',
        fs: d.FileSystem || 'Unknown',
        mountPoint: d.Letter || '',
        platform: 'win32'
      }))
    } catch {
      return []
    }
  }

  parseWmicOutput(csv) {
    const lines = csv.split('\n').filter(l => l.trim() && !l.startsWith('Node'))
    return lines.map(line => {
      const parts = line.split(',')
      if (parts.length < 5) return null
      return {
        device: parts[1] || '',
        letter: parts[1] || '',
        mountPoint: parts[1] || '',
        name: 'USB Drive',
        label: parts[5]?.trim() || 'Removable',
        size: parseInt(parts[4]) || 0,
        sizeGb: parts[4] ? (parseInt(parts[4]) / 1e9).toFixed(1) : '?',
        freeGb: parts[2] ? (parseInt(parts[2]) / 1e9).toFixed(1) : '?',
        fs: parts[3]?.trim() || 'Unknown',
        platform: 'win32'
      }
    }).filter(Boolean)
  }

  async listMac() {
    const out = await execAsync('diskutil', ['list', '-plist']).then(r => r.stdout).catch(() => '')
    // Parse plist output for external drives
    try {
      const { default: plist } = await import('plist')
      const data = plist.parse(out)
      const external = (data.AllDisksAndPartitions || []).filter(d => d.Content !== 'GUID_partition_scheme' || true)
      const drives = []
      for (const disk of external) {
        try {
          const info = await execAsync('diskutil', ['info', '-plist', disk.DeviceIdentifier]).then(r => r.stdout)
          const diskInfo = plist.parse(info)
          if (diskInfo.RemovableMediaOrExternalDevice || diskInfo.Ejectable) {
            drives.push({
              device: '/dev/' + disk.DeviceIdentifier,
              name: diskInfo.MediaName || 'USB Drive',
              label: diskInfo.VolumeName || diskInfo.MediaName || 'Removable',
              size: diskInfo.TotalSize || 0,
              sizeGb: diskInfo.TotalSize ? (diskInfo.TotalSize / 1e9).toFixed(1) : '?',
              freeGb: diskInfo.FreeSpace ? (diskInfo.FreeSpace / 1e9).toFixed(1) : '?',
              mountPoint: diskInfo.MountPoint || '',
              fs: diskInfo.FilesystemType || diskInfo.FilesystemName || 'Unknown',
              platform: 'darwin'
            })
          }
        } catch {}
      }
      return drives
    } catch {
      // Fallback diskutil list parsing
      const listOut = await execAsync('diskutil', ['list']).then(r => r.stdout).catch(() => '')
      return this.parseDiskutilList(listOut)
    }
  }

  parseDiskutilList(out) {
    const drives = []
    const externalMatch = out.match(/\/dev\/disk\d+[^\n]*external[^\n]*/gi) || []
    for (const line of externalMatch) {
      const dev = line.match(/\/dev\/disk\d+/)?.[0]
      if (dev) drives.push({ device: dev, name: 'USB Drive', label: 'External', sizeGb: '?', freeGb: '?', mountPoint: dev, platform: 'darwin' })
    }
    return drives
  }

  async listLinux() {
    const out = await execAsync('lsblk', ['-J', '-o', 'NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT,HOTPLUG,VENDOR,MODEL,TRAN']).then(r => r.stdout).catch(() => '')
    try {
      const data = JSON.parse(out)
      const drives = []
      for (const dev of (data.blockdevices || [])) {
        if (dev.hotplug === '1' || dev.hotplug === true || dev.tran === 'usb') {
          drives.push({
            device: '/dev/' + dev.name,
            name: [dev.vendor, dev.model].filter(Boolean).join(' ').trim() || 'USB Drive',
            label: dev.label || 'Removable',
            size: 0,
            sizeGb: dev.size || '?',
            freeGb: '?',
            mountPoint: dev.mountpoint || '',
            fs: dev.fstype || 'Unknown',
            platform: 'linux',
            children: dev.children
          })
        }
      }
      return drives
    } catch {
      // Fallback: parse df
      const df = await execAsync('df', ['-h', '--output=source,size,avail,fstype,target']).then(r => r.stdout).catch(() => '')
      return df.split('\n').filter(l => l.includes('/dev/sd') || l.includes('/dev/disk')).map(line => {
        const parts = line.trim().split(/\s+/)
        return { device: parts[0], sizeGb: parts[1], freeGb: parts[2], fs: parts[3], mountPoint: parts[4], name: 'USB Drive', label: 'Removable', platform: 'linux' }
      })
    }
  }

  async getDriveHealth(device) {
    // Run smartctl if available
    const out = await execAsync('smartctl', ['-a', device]).then(r => r.stdout).catch(() => '')
    if (!out) return { available: false, note: 'smartctl not installed. Install: apt install smartmontools' }

    const health = out.includes('PASSED') ? 'PASSED' : out.includes('FAILED') ? 'FAILED' : 'Unknown'
    const reallocated = out.match(/Reallocated_Sector_Ct.*?(\d+)/)?.[1]
    const powerOn = out.match(/Power_On_Hours.*?(\d+)/)?.[1]
    return {
      available: true,
      health,
      reallocatedSectors: reallocated ? parseInt(reallocated) : null,
      powerOnHours: powerOn ? parseInt(powerOn) : null,
      raw: out.slice(0, 2000)
    }
  }
}

//                                                                               
// OS CATALOG -- every major OS with download links and metadata
//                                                                               
export class OsCatalog {
  getAll() {
    return {
      windows: {
        name: 'Windows',
        icon: ' ',
        entries: [
          { id: 'win11', name: 'Windows 11', version: '24H2', size: '5.4 GB', arch: ['x64', 'ARM64'], url: 'https://www.microsoft.com/software-download/windows11', directUrl: null, sha256: null, type: 'iso', notes: 'TPM 2.0 required. Use Rufus with bypass for unsupported hardware.', tags: ['stable','latest'] },
          { id: 'win10', name: 'Windows 10', version: '22H2', size: '5.1 GB', arch: ['x64','x86'], url: 'https://www.microsoft.com/software-download/windows10', directUrl: null, sha256: null, type: 'iso', notes: 'Support ends Oct 2025. Still the most compatible version.', tags: ['stable','lts'] },
          { id: 'win10ltsc', name: 'Windows 10 LTSC 2021', version: '21H2', size: '4.7 GB', arch: ['x64'], url: 'https://www.microsoft.com/en-us/evalcenter/download-windows-10-enterprise', directUrl: null, sha256: null, type: 'iso', notes: 'Long-term servicing. No bloatware. Business/enterprise focus.', tags: ['ltsc','clean'] },
          { id: 'winpe', name: 'Windows PE (Recovery)', version: 'ADK 11', size: '650 MB', arch: ['x64'], url: 'https://docs.microsoft.com/windows-hardware/manufacture/desktop/winpe-create-usb-bootable-drive', directUrl: null, type: 'guide', notes: 'Minimal Windows for recovery. Requires Windows ADK.', tags: ['recovery','tools'] },
        ]
      },
      ubuntu: {
        name: 'Ubuntu',
        icon: ' ',
        entries: [
          { id: 'ubuntu2404', name: 'Ubuntu 24.04 LTS', version: '24.04', size: '5.7 GB', arch: ['x64','ARM64'], url: 'https://ubuntu.com/download/desktop', directUrl: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-desktop-amd64.iso', sha256url: 'https://releases.ubuntu.com/24.04/SHA256SUMS', type: 'iso', tags: ['stable','lts','recommended'] },
          { id: 'ubuntu2310', name: 'Ubuntu 23.10', version: '23.10', size: '5.0 GB', arch: ['x64'], url: 'https://ubuntu.com/download/desktop', directUrl: 'https://releases.ubuntu.com/23.10/ubuntu-23.10-desktop-amd64.iso', type: 'iso', tags: ['stable'] },
          { id: 'ubuntu-server', name: 'Ubuntu Server 24.04 LTS', version: '24.04', size: '2.6 GB', arch: ['x64','ARM64'], url: 'https://ubuntu.com/download/server', directUrl: 'https://releases.ubuntu.com/24.04/ubuntu-24.04-live-server-amd64.iso', type: 'iso', tags: ['server','lts'] },
          { id: 'lubuntu', name: 'Lubuntu 24.04', version: '24.04', size: '3.0 GB', arch: ['x64'], url: 'https://lubuntu.me/downloads/', directUrl: 'https://cdimage.ubuntu.com/lubuntu/releases/24.04/release/lubuntu-24.04-desktop-amd64.iso', type: 'iso', notes: 'Lightweight. Ideal for old hardware.', tags: ['lightweight','lts'] },
        ]
      },
      debian: {
        name: 'Debian',
        icon: ' ',
        entries: [
          { id: 'debian12', name: 'Debian 12 (Bookworm)', version: '12.5', size: '3.7 GB', arch: ['x64','ARM64','i386'], url: 'https://www.debian.org/download', directUrl: 'https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/debian-12.5.0-amd64-DVD-1.iso', sha256url: 'https://cdimage.debian.org/debian-cd/current/amd64/iso-dvd/SHA256SUMS', type: 'iso', tags: ['stable','reliable'] },
          { id: 'debian-live', name: 'Debian 12 Live (Gnome)', version: '12.5', size: '3.4 GB', arch: ['x64'], url: 'https://www.debian.org/CD/live/', directUrl: 'https://cdimage.debian.org/debian-cd/current-live/amd64/iso-hybrid/debian-live-12.5.0-amd64-gnome.iso', type: 'iso', tags: ['live','desktop'] },
          { id: 'debian-netinst', name: 'Debian 12 Netinstall', version: '12.5', size: '0.7 GB', arch: ['x64'], directUrl: 'https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.5.0-amd64-netinst.iso', type: 'iso', notes: 'Minimal installer, downloads packages from internet.', tags: ['minimal','server'] },
        ]
      },
      fedora: {
        name: 'Fedora',
        icon: ' ',
        entries: [
          { id: 'fedora40', name: 'Fedora 40 Workstation', version: '40', size: '2.2 GB', arch: ['x64'], url: 'https://fedoraproject.org/workstation/download', directUrl: 'https://download.fedoraproject.org/pub/fedora/linux/releases/40/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-40-1.14.iso', type: 'iso', tags: ['stable','gnome','cutting-edge'] },
          { id: 'fedora-server', name: 'Fedora 40 Server', version: '40', size: '0.9 GB', arch: ['x64'], directUrl: 'https://download.fedoraproject.org/pub/fedora/linux/releases/40/Server/x86_64/iso/Fedora-Server-dvd-x86_64-40-1.14.iso', type: 'iso', tags: ['server'] },
          { id: 'fedora-kde', name: 'Fedora 40 KDE Spin', version: '40', size: '2.6 GB', arch: ['x64'], directUrl: 'https://download.fedoraproject.org/pub/fedora/linux/releases/40/Spins/x86_64/iso/Fedora-KDE-Live-x86_64-40-1.14.iso', type: 'iso', tags: ['kde','desktop'] },
        ]
      },
      mint: {
        name: 'Linux Mint',
        icon: ' ',
        entries: [
          { id: 'mint21-cinnamon', name: 'Linux Mint 21.3 Cinnamon', version: '21.3', size: '2.8 GB', arch: ['x64'], url: 'https://linuxmint.com/download.php', directUrl: 'https://mirrors.edge.kernel.org/linuxmint/stable/21.3/linuxmint-21.3-cinnamon-64bit.iso', sha256url: 'https://linuxmint.com/verify/', type: 'iso', notes: 'Best for Windows users switching to Linux.', tags: ['beginner-friendly','stable','lts'] },
          { id: 'mint21-xfce', name: 'Linux Mint 21.3 Xfce', version: '21.3', size: '2.7 GB', arch: ['x64'], directUrl: 'https://mirrors.edge.kernel.org/linuxmint/stable/21.3/linuxmint-21.3-xfce-64bit.iso', type: 'iso', notes: 'Lighter than Cinnamon. Good for older machines.', tags: ['lightweight','lts'] },
          { id: 'lmde6', name: 'LMDE 6 (Debian-based)', version: '6', size: '2.2 GB', arch: ['x64'], url: 'https://linuxmint.com/download_lmde.php', type: 'iso', notes: 'Linux Mint but based on Debian instead of Ubuntu.', tags: ['debian','stable'] },
        ]
      },
      arch: {
        name: 'Arch Linux',
        icon: ' ',
        entries: [
          { id: 'arch', name: 'Arch Linux', version: 'Rolling', size: '0.9 GB', arch: ['x64','ARM64'], url: 'https://archlinux.org/download/', directUrl: 'https://geo.mirror.pkgbuild.com/iso/latest/archlinux-x86_64.iso', sha256url: 'https://archlinux.org/download/', type: 'iso', notes: 'DIY. You build it from scratch. Use archinstall script for guided setup.', tags: ['advanced','rolling'] },
          { id: 'endeavouros', name: 'EndeavourOS', version: '2024.01', size: '2.2 GB', arch: ['x64'], url: 'https://endeavouros.com/', directUrl: 'https://github.com/endeavouros-team/releases/releases/latest', type: 'iso', notes: 'Arch-based but with a real installer. Best of both worlds.', tags: ['arch','beginner-friendly','rolling'] },
          { id: 'manjaro-kde', name: 'Manjaro KDE', version: '24.0', size: '4.2 GB', arch: ['x64'], url: 'https://manjaro.org/products/download/x86/', type: 'iso', notes: 'Arch-based, beginner friendly, rolling release.', tags: ['arch','kde','rolling'] },
          { id: 'garuda', name: 'Garuda Linux Gaming', version: 'Rolling', size: '3.8 GB', arch: ['x64'], url: 'https://garudalinux.org/downloads.html', type: 'iso', notes: 'Gaming-focused Arch. Pre-configured for performance.', tags: ['gaming','arch','kde'] },
        ]
      },
      security: {
        name: 'Security & Privacy',
        icon: ' ',
        entries: [
          { id: 'kali', name: 'Kali Linux 2024.1', version: '2024.1', size: '3.9 GB', arch: ['x64','ARM64'], url: 'https://www.kali.org/get-kali/', directUrl: 'https://cdimage.kali.org/current/kali-linux-2024.1-installer-amd64.iso', sha256url: 'https://cdimage.kali.org/current/SHA256SUMS', type: 'iso', notes: '600+ penetration testing tools. Not for beginners.', tags: ['security','pentest','stable'] },
          { id: 'kali-live', name: 'Kali Linux 2024.1 Live', version: '2024.1', size: '4.1 GB', arch: ['x64'], directUrl: 'https://cdimage.kali.org/current/kali-linux-2024.1-live-amd64.iso', type: 'iso', notes: 'Run Kali without installing. With optional persistence.', tags: ['security','live','pentest'] },
          { id: 'parrot-sec', name: 'ParrotOS Security', version: '6.0', size: '3.9 GB', arch: ['x64'], url: 'https://parrotsec.org/download/', type: 'iso', notes: 'Kali alternative. More RAM efficient. MATE desktop.', tags: ['security','pentest'] },
          { id: 'parrot-home', name: 'ParrotOS Home', version: '6.0', size: '2.8 GB', arch: ['x64'], url: 'https://parrotsec.org/download/', type: 'iso', notes: 'Privacy-focused daily driver. No pentest tools.', tags: ['privacy','desktop'] },
          { id: 'tails', name: 'Tails OS 6.3', version: '6.3', size: '1.4 GB', arch: ['x64'], url: 'https://tails.net/install/', directUrl: 'https://download.tails.net/tails/stable/tails-amd64-6.3/tails-amd64-6.3.img', sha256url: 'https://tails.net/torrents/files/tails-amd64-6.3.img.sha256', type: 'img', notes: 'Privacy OS. Routes all traffic through Tor. Leaves no trace. Amnesic.', tags: ['privacy','tor','amnesic','security'] },
          { id: 'whonix', name: 'Whonix Gateway + Workstation', version: '17', size: '1.8 GB', arch: ['x64'], url: 'https://www.whonix.org/wiki/Download', type: 'iso', notes: 'Two-VM Tor architecture. Strongest anonymity for desktop use.', tags: ['privacy','tor','vm'] },
          { id: 'qubes', name: 'Qubes OS 4.2', version: '4.2', size: '5.4 GB', arch: ['x64'], url: 'https://www.qubes-os.org/downloads/', directUrl: 'https://ftp.qubes-os.org/iso/Qubes-R4.2.0-x86_64.iso', type: 'iso', notes: 'Security by compartmentalisation. Each app in its own VM. Xen-based.', tags: ['security','advanced','vm'] },
        ]
      },
      lightweight: {
        name: 'Lightweight / Old Hardware',
        icon: ' ',
        entries: [
          { id: 'puppy', name: 'Puppy Linux (BionicPup)', version: '9.5', size: '0.4 GB', arch: ['x64'], url: 'https://puppylinux-woof-ce.github.io/', type: 'iso', notes: 'Runs entirely in RAM. Boots on very old hardware. 200MB ISO.', tags: ['tiny','oldpc','ramboot'] },
          { id: 'antiX', name: 'antiX 23', version: '23', size: '0.9 GB', arch: ['x64','x86'], url: 'https://antixlinux.com/download/', type: 'iso', notes: 'Systemd-free, very fast, works on 256MB RAM.', tags: ['lightweight','systemd-free','oldpc'] },
          { id: 'slax', name: 'Slax 15.0', version: '15.0', size: '0.3 GB', arch: ['x64'], url: 'https://slax.org/', type: 'iso', notes: 'Pocket OS. 300MB. Debian-based. Modular.', tags: ['tiny','portable'] },
          { id: 'tinycorelinux', name: 'Tiny Core Linux 15', version: '15', size: '0.018 GB', arch: ['x64'], url: 'http://www.tinycorelinux.net/downloads.html', type: 'iso', notes: '18MB. Smallest functional Linux. Loads entirely into RAM.', tags: ['tiny','18mb'] },
          { id: 'q4os', name: 'Q4OS 5.6', version: '5.6', size: '1.1 GB', arch: ['x64','x86'], url: 'https://q4os.org/downloads2.html', type: 'iso', notes: 'Debian-based, Trinity desktop. Perfect for Windows XP refugees.', tags: ['lightweight','windowslike','oldpc'] },
        ]
      },
      specialty: {
        name: 'Specialty / Server',
        icon: ' ',
        entries: [
          { id: 'proxmox', name: 'Proxmox VE 8.2', version: '8.2', size: '1.2 GB', arch: ['x64'], url: 'https://www.proxmox.com/proxmox-virtual-environment/get-started', directUrl: 'https://enterprise.proxmox.com/iso/proxmox-ve_8.2-1.iso', type: 'iso', notes: 'Bare-metal hypervisor. Manage VMs and containers. Open source.', tags: ['server','vm','homelab'] },
          { id: 'truenas-scale', name: 'TrueNAS SCALE 24.04', version: '24.04', size: '2.3 GB', arch: ['x64'], url: 'https://www.truenas.com/download-truenas-scale/', type: 'iso', notes: 'NAS OS. ZFS storage, Docker containers, Kubernetes. Brilliant for homelab.', tags: ['nas','server','homelab'] },
          { id: 'truenas-core', name: 'TrueNAS CORE 13.0', version: '13.0', size: '1.0 GB', arch: ['x64'], url: 'https://www.truenas.com/download-truenas-core/', type: 'iso', notes: 'FreeBSD-based NAS. Rock solid. ZFS native.', tags: ['nas','server','freebsd'] },
          { id: 'opnsense', name: 'OPNsense 24.1', version: '24.1', size: '0.6 GB', arch: ['x64'], url: 'https://opnsense.org/download/', type: 'iso', notes: 'FreeBSD-based firewall/router OS. pfSense alternative.', tags: ['firewall','router','network'] },
          { id: 'pfsense', name: 'pfSense CE 2.7', version: '2.7', size: '0.8 GB', arch: ['x64'], url: 'https://www.pfsense.org/download/', type: 'iso', notes: 'Enterprise-grade firewall. Gold standard for home/business routing.', tags: ['firewall','router','network'] },
          { id: 'pihole', name: 'Pi-hole + Dietpi', version: 'Latest', size: '0.5 GB', arch: ['x64','ARM64'], url: 'https://dietpi.com/#download', type: 'iso', notes: 'Run Pi-hole on x86. DietPi is minimal Debian. Auto-installs Pi-hole.', tags: ['adblock','network','server'] },
          { id: 'raspios', name: 'Raspberry Pi OS (64-bit)', version: 'Bookworm', size: '1.2 GB', arch: ['ARM64'], url: 'https://www.raspberrypi.com/software/operating-systems/', directUrl: 'https://downloads.raspberrypi.com/raspios_arm64/images/raspios_arm64-2024-03-15/2024-03-15-raspios-bookworm-arm64.img.xz', type: 'img', notes: 'Official Pi OS. Use Raspberry Pi Imager for verified write.', tags: ['raspberrypi','arm'] },
          { id: 'chromeosflex', name: 'ChromeOS Flex', version: 'Latest', size: '1.2 GB', arch: ['x64'], url: 'https://chromeenterprise.google/os/chromeosflex/', type: 'guide', notes: 'Chrome OS on any x86 PC. Use Chrome browser Chromebook Recovery Utility.', tags: ['chromeos','lightweight'] },
          { id: 'freebsd', name: 'FreeBSD 14.1', version: '14.1', size: '1.0 GB', arch: ['x64','ARM64'], url: 'https://www.freebsd.org/where/', directUrl: 'https://download.freebsd.org/releases/amd64/amd64/ISO-IMAGES/14.1/FreeBSD-14.1-RELEASE-amd64-disc1.iso', type: 'iso', notes: 'Not Linux. Rock-solid UNIX. Superior ZFS implementation.', tags: ['bsd','server','advanced'] },
          { id: 'alpine', name: 'Alpine Linux 3.20', version: '3.20', size: '0.2 GB', arch: ['x64','ARM64'], url: 'https://alpinelinux.org/downloads/', directUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/x86_64/alpine-standard-3.20.0-x86_64.iso', type: 'iso', notes: 'Tiny (200MB). musl libc. Used heavily in Docker containers.', tags: ['server','tiny','docker','container'] },
          { id: 'nixos', name: 'NixOS 24.05', version: '24.05', size: '2.5 GB', arch: ['x64'], url: 'https://nixos.org/download/', directUrl: 'https://channels.nixos.org/nixos-24.05/latest-nixos-gnome-x86_64-linux.iso', type: 'iso', notes: 'Declarative, reproducible OS config. Cutting edge concept. Steep learning curve.', tags: ['advanced','reproducible','rolling'] },
        ]
      },
      recovery: {
        name: 'Recovery & Rescue',
        icon: ' ',
        entries: [
          { id: 'gparted', name: 'GParted Live 1.6', version: '1.6', size: '0.6 GB', arch: ['x64','x86'], url: 'https://gparted.org/livecd.php', directUrl: 'https://downloads.sourceforge.net/gparted/gparted-live-1.6.0-3-amd64.iso', type: 'iso', notes: 'Boot to partition any disk. Resize, format, clone partitions.', tags: ['recovery','partition','rescue'] },
          { id: 'clonezilla', name: 'Clonezilla Live 3.1', version: '3.1', size: '0.5 GB', arch: ['x64'], url: 'https://clonezilla.org/downloads.php', directUrl: 'https://downloads.sourceforge.net/project/clonezilla/clonezilla_live_stable/3.1.2-9/clonezilla-live-3.1.2-9-amd64.iso', type: 'iso', notes: 'Disk imaging and cloning. One of the best free backup tools.', tags: ['recovery','backup','clone'] },
          { id: 'hirens', name: "Hiren's BootCD PE 1.0.2", version: '1.0.2', size: '2.5 GB', arch: ['x64'], url: 'https://www.hirensbootcd.org/download/', type: 'iso', notes: 'Windows PE with 100+ recovery tools. Password reset, antivirus, disk tools.', tags: ['rescue','windows','recovery'] },
          { id: 'systemrescue', name: 'SystemRescue 11.02', version: '11.02', size: '1.1 GB', arch: ['x64'], url: 'https://www.system-rescue.org/Download/', directUrl: 'https://fastly-cdn.system-rescue.org/releases/11.02/systemrescue-11.02-amd64.iso', type: 'iso', notes: 'Arch-based rescue. TestDisk, fsck, chroot repair, hardware test.', tags: ['rescue','recovery','tools'] },
          { id: 'memtest', name: 'Memtest86+ v7.00', version: '7.00', size: '0.01 GB', arch: ['x64'], url: 'https://memtest.org/#downiso', directUrl: 'https://www.memtest.org/download/v7.00/mt86plus_7.00_64.iso.zip', type: 'iso', notes: 'RAM tester. Run for hours to detect faulty memory. No OS needed.', tags: ['hardware','diagnostics','ram'] },
          { id: 'supergrub', name: 'Super Grub2 Disk 2.06', version: '2.06', size: '0.03 GB', arch: ['x64'], url: 'https://www.supergrubdisk.org/', directUrl: 'https://sourceforge.net/projects/supergrub2/files/2.06s4/supergrub2-2.06s4-multiarch-USB.iso', type: 'iso', notes: 'Rescue broken GRUB. Boot any OS even if bootloader is broken.', tags: ['recovery','grub','boot'] },
        ]
      },
      gaming: {
        name: 'Gaming',
        icon: ' ',
        entries: [
          { id: 'steamos', name: 'SteamOS 3.x (Steam Deck Image)', version: '3.x', size: '10 GB', arch: ['x64'], url: 'https://help.steampowered.com/en/faqs/view/1B71-EDF2-EB6D-2BB3', type: 'guide', notes: 'Steam Deck recovery image. Can be installed on other hardware experimentally.', tags: ['gaming','steam','arch'] },
          { id: 'nobara', name: 'Nobara 40', version: '40', size: '3.6 GB', arch: ['x64'], url: 'https://nobaraproject.org/', type: 'iso', notes: 'Fedora-based gaming distro by GloriousEggroll. Best Linux for gaming.', tags: ['gaming','fedora','proton'] },
          { id: 'batocera', name: 'Batocera.linux 39', version: '39', size: '2.3 GB', arch: ['x64','ARM64'], url: 'https://batocera.org/download', directUrl: 'https://mirrors.o2switch.fr/batocera/x86_64/stable/last/batocera-x86_64-39-20240301.img.gz', type: 'img', notes: 'Retro gaming console OS. Plug in controller and play. Emulates 100+ consoles.', tags: ['gaming','retro','emulation','turnkey'] },
          { id: 'lakka', name: 'Lakka 5.0', version: '5.0', size: '1.1 GB', arch: ['x64','ARM64','RPI'], url: 'https://www.lakka.tv/get/', type: 'img', notes: 'RetroArch OS. Turns any PC into a retro console. LibreELEC-based.', tags: ['gaming','retro','emulation','lightweight'] },
        ]
      }
    }
  }

  async getLatestVersion(distroId) {
    // Try to fetch latest version from distro APIs
    const apiMap = {
      ubuntu2404: async () => {
        const r = await axios.get('https://api.ubuntu.com/v1/releases', { timeout: 5000 })
        return r.data?.filter(v => v.is_lts)?.[0]?.version
      },
    }
    if (apiMap[distroId]) {
      try { return await apiMap[distroId]() } catch {}
    }
    return null
  }
}

//                                                                               
// USB TOOL MANAGER -- detect and manage Ventoy, Rufus, Etcher etc.
//                                                                               
export class UsbToolManager {
  getTools() {
    const plat = process.platform
    return [
      {
        id: 'ventoy',
        name: 'Ventoy',
        version: '1.0.99',
        description: 'Put multiple ISOs on one USB. Boot any ISO directly. No re-flashing needed. Just copy ISOs.',
        bestFor: 'Multi-boot USB with many ISOs',
        platforms: ['win32', 'linux', 'darwin'],
        downloadUrl: {
          win32: 'https://github.com/ventoy/Ventoy/releases/latest/download/ventoy-1.0.99-windows.zip',
          linux: 'https://github.com/ventoy/Ventoy/releases/latest/download/ventoy-1.0.99-linux.tar.gz',
          darwin: 'https://github.com/ventoy/Ventoy/releases/latest/download/ventoy-1.0.99-linux.tar.gz',
        }[plat],
        websiteUrl: 'https://www.ventoy.net',
        githubUrl: 'https://github.com/ventoy/Ventoy',
        features: ['Multi-boot (hundreds of ISOs)', 'Legacy + UEFI', 'Persistence support', 'Secure Boot', 'Auto-detect ISOs', 'No format needed when adding ISOs'],
        icon: ' ',
        binName: plat === 'win32' ? 'Ventoy2Disk.exe' : 'ventoy.sh',
        installed: false,
      },
      {
        id: 'rufus',
        name: 'Rufus',
        version: '4.5',
        description: 'Fast, reliable Windows USB creator. Best tool for creating Windows 10/11 bootable drives. Includes bypass for Windows 11 TPM requirement.',
        bestFor: 'Windows installation USB, fast write speed',
        platforms: ['win32'],
        downloadUrl: 'https://github.com/pbatard/rufus/releases/latest/download/rufus-4.5.exe',
        websiteUrl: 'https://rufus.ie',
        githubUrl: 'https://github.com/pbatard/rufus',
        features: ['Windows 11 TPM bypass', 'No install needed (portable)', 'FAT32/NTFS/ext', 'Legacy + UEFI + CSM', 'Bad sector check', 'Very fast'],
        icon: ' ',
        binName: 'rufus.exe',
        installed: false,
      },
      {
        id: 'etcher',
        name: 'Balena Etcher',
        version: '1.19.21',
        description: 'Simplest USB flasher. Open ISO, pick drive, flash. Validates after write. Cross-platform.',
        bestFor: 'Simplicity, Linux/macOS, Raspberry Pi images',
        platforms: ['win32', 'linux', 'darwin'],
        downloadUrl: {
          win32: 'https://github.com/balena-io/etcher/releases/latest/download/balenaEtcher-Setup-1.19.21.exe',
          linux: 'https://github.com/balena-io/etcher/releases/latest/download/balena-etcher-1.19.21-x64.AppImage',
          darwin: 'https://github.com/balena-io/etcher/releases/latest/download/balenaEtcher-1.19.21.dmg',
        }[plat],
        websiteUrl: 'https://etcher.balena.io',
        githubUrl: 'https://github.com/balena-io/etcher',
        features: ['Very easy UI', 'Built-in verification', 'Compresses (.xz, .gz) auto-decompressed', 'Cross-platform', 'Validates after write'],
        icon: ' ',
        binName: plat === 'win32' ? 'balenaEtcher.exe' : 'etcher.AppImage',
        installed: false,
      },
      {
        id: 'unetbootin',
        name: 'UNetbootin',
        version: '702',
        description: 'Cross-platform USB flasher with built-in distro downloader. Downloads ISOs directly.',
        bestFor: 'Built-in OS downloader, Linux only USB creation',
        platforms: ['win32', 'linux', 'darwin'],
        downloadUrl: { win32: 'https://github.com/unetbootin/unetbootin/releases/latest/download/unetbootin-windows-702.exe', linux: 'https://github.com/unetbootin/unetbootin/releases/latest/download/unetbootin-linux-702', darwin: 'https://github.com/unetbootin/unetbootin/releases/latest/download/unetbootin-mac-702' }[plat],
        websiteUrl: 'https://unetbootin.github.io',
        githubUrl: 'https://github.com/unetbootin/unetbootin',
        features: ['Integrated distro download', 'Persistence option', 'Cross-platform'],
        icon: ' ',
        binName: plat === 'win32' ? 'unetbootin.exe' : 'unetbootin',
        installed: false,
      },
      {
        id: 'win32diskimager',
        name: 'Win32 Disk Imager',
        version: '1.0',
        description: 'Write raw disk images (.img) to USB drives on Windows. Essential for Raspberry Pi and raw images.',
        bestFor: 'Raw .img files on Windows (Raspberry Pi, etc.)',
        platforms: ['win32'],
        downloadUrl: 'https://sourceforge.net/projects/win32diskimager/files/latest/download',
        websiteUrl: 'https://sourceforge.net/projects/win32diskimager/',
        features: ['Raw .img write', 'Backup USB to .img', 'Simple UI'],
        icon: ' ',
        binName: 'Win32DiskImager.exe',
        installed: false,
      },
      {
        id: 'dd',
        name: 'dd (built-in)',
        version: 'System',
        description: 'Unix built-in. Writes any image to any device. No GUI. Extremely powerful and dangerous.',
        bestFor: 'Linux/macOS advanced users',
        platforms: ['linux', 'darwin'],
        downloadUrl: null,
        websiteUrl: null,
        features: ['Built into all Unix systems', 'Any format', 'Compress/decompress pipe', 'Status progress with status=progress'],
        icon: ' ',
        binName: 'dd',
        installed: process.platform !== 'win32',
        command: 'sudo dd if=image.iso of=/dev/sdX bs=4M status=progress oflag=sync',
      },
      {
        id: 'yumi',
        name: 'YUMI - Multiboot USB Creator',
        version: '2.0.9.0',
        description: 'Create multiboot USB drives with multiple ISOs. Alternative to Ventoy with menu customisation and persistence setup built-in.',
        bestFor: 'Multiboot USB with custom boot menu, older hardware',
        platforms: ['win32'],
        downloadUrl: 'https://yumiusb.com/downloads/YUMI/YUMI-exFAT-1.0.2.7.exe',
        websiteUrl: 'https://yumiusb.com',
        features: ['Multiple ISOs', 'Custom boot menu', 'Persistence setup', 'UEFI + Legacy', 'exFAT support'],
        icon: ' ',
        binName: 'YUMI-exFAT.exe',
        installed: false,
      },
      {
        id: 'wintousb',
        name: 'WinToUSB',
        version: '8.5',
        description: 'Install and run Windows from a USB drive. Creates Windows To Go drives. Supports Windows 7/8/10/11.',
        bestFor: 'Windows To Go - run full Windows from USB',
        platforms: ['win32'],
        downloadUrl: 'https://www.easyuefi.com/wintousb/res/download/WinToUSB-Free.exe',
        websiteUrl: 'https://www.easyuefi.com/wintousb/',
        features: ['Windows To Go', 'Clone Windows to USB', 'UEFI + Legacy', 'BitLocker support'],
        icon: ' ',
        binName: 'WinToUSB.exe',
        installed: false,
      },
      {
        id: 'rescuezilla',
        name: 'Rescuezilla',
        version: '2.5',
        description: 'Disk imaging and cloning. GUI-based Clonezilla alternative. Backup and restore entire drives or partitions.',
        bestFor: 'Easy disk backup, cloning, disaster recovery',
        platforms: ['win32', 'linux', 'darwin'],
        downloadUrl: 'https://github.com/rescuezilla/rescuezilla/releases/latest',
        websiteUrl: 'https://rescuezilla.com',
        githubUrl: 'https://github.com/rescuezilla/rescuezilla',
        features: ['GUI disk imaging', 'Clone drives', 'Network backup', 'Restore to different hardware', 'Supports 100+ filesystems'],
        icon: ' ',
        binName: null,
        installed: false,
        type: 'iso',
        note: 'Boot from USB - not a Windows app'
      },
      {
        id: 'ventoy-web',
        name: 'VentoyWeb (GUI for Ventoy)',
        version: 'Built-in',
        description: 'Web-based GUI frontend for Ventoy. Opens in browser, no separate app needed. Much easier than command line.',
        bestFor: 'Easy Ventoy setup via browser UI',
        platforms: ['win32', 'linux', 'darwin'],
        downloadUrl: null,
        websiteUrl: 'https://www.ventoy.net/en/index.html',
        features: ['Browser-based GUI', 'Install Ventoy', 'Update Ventoy', 'Change partition style', 'Secure Boot config'],
        icon: ' ',
        binName: 'VentoyWeb.exe',
        installed: false,
        note: 'Included with Ventoy download in bin/ventoy/'
      },
      {
        id: 'mediatools',
        name: 'Microsoft Media Creation Tool',
        version: 'Latest',
        description: 'Official Microsoft tool to download and create Windows 10/11 installation USB. Ensures genuine, up-to-date ISO.',
        bestFor: 'Official Windows 10/11 USB (guaranteed genuine)',
        platforms: ['win32'],
        downloadUrl: 'https://go.microsoft.com/fwlink/?LinkId=691209',
        websiteUrl: 'https://www.microsoft.com/software-download/windows11',
        features: ['Official Microsoft tool', 'Downloads latest Windows', 'Creates bootable USB', 'Or saves as ISO'],
        icon: ' ',
        binName: 'MediaCreationTool.exe',
        installed: false,
      },
    ].filter(t => t.platforms.includes(plat))
  }

  async checkInstalled(tools) {
    const result = []
    for (const tool of tools) {
      const toolBin = bin(tool.binName || '')
      const sysBin = await execAsync('which', [tool.binName || '']).then(r => !!r.stdout.trim()).catch(() => false)
      const localBin = await fs.pathExists(toolBin)
      result.push({ ...tool, installed: sysBin || localBin, localPath: localBin ? toolBin : null })
    }
    return result
  }

  async downloadTool(toolId, tools, onProgress) {
    const tool = tools.find(t => t.id === toolId)
    if (!tool?.downloadUrl) return { error: 'No download URL for this tool on your platform' }
    const destDir = join(app.getPath('userData'), 'tools', toolId)
    await fs.ensureDir(destDir)
    const filename = basename(tool.downloadUrl)
    const destPath = join(destDir, filename)
    onProgress?.({ percent: 5, message: `Downloading ${tool.name}...` })
    const res = await axios({ url: tool.downloadUrl, method: 'GET', responseType: 'stream', timeout: 300000 })
    const total = parseInt(res.headers['content-length'] || 0)
    let done = 0
    await new Promise(async (resolve, reject) => {
      const writer = fs.createWriteStream(destPath)
      res.data.on('data', chunk => { done += chunk.length; if (total) onProgress?.({ percent: 5 + Math.round(done / total * 90), message: `Downloading ${tool.name}...` }) })
      res.data.pipe(writer)
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
    onProgress?.({ percent: 100, message: 'Done' })
    // Make executable on Unix
    if (process.platform !== 'win32') await fs.chmod(destPath, 0o755).catch(() => {})
    return { success: true, path: destPath }
  }

  async launchTool(toolId, tools) {
    const tool = tools.find(t => t.id === toolId)
    const toolPath = join(app.getPath('userData'), 'tools', toolId)
    const files = await fs.readdir(toolPath).catch(() => [])
    const exe = files.find(f => f.endsWith('.exe') || f.endsWith('.AppImage') || f === 'etcher')
    if (!exe) return { error: 'Tool not downloaded yet' }
    const { shell } = await import('electron')
    shell.openPath(join(toolPath, exe))
    return { success: true }
  }
}

//                                                                               
// ISO MANAGER -- download, verify, manage ISO collection
//                                                                               
export class IsoManager {
  constructor() {
    this.isoDir = join(app.getPath('userData'), 'isos')
  }

  async ensureDir() { await fs.ensureDir(this.isoDir) }

  async list() {
    await this.ensureDir()
    const files = await fs.readdir(this.isoDir)
    const isos = []
    for (const f of files.filter(f => f.match(/\.(iso|img|img\.xz|img\.gz)$/i))) {
      const stat = await fs.stat(join(this.isoDir, f))
      isos.push({ filename: f, path: join(this.isoDir, f), size: stat.size, sizeGb: (stat.size / 1e9).toFixed(2), modified: stat.mtime })
    }
    return isos
  }

  async download(url, filename, onProgress) {
    await this.ensureDir()
    const destPath = join(this.isoDir, filename || basename(url))
    const res = await axios({ url, method: 'GET', responseType: 'stream', timeout: 0, maxRedirects: 10 })
    const total = parseInt(res.headers['content-length'] || 0)
    let done = 0
    const startTime = Date.now()
    await new Promise(async (resolve, reject) => {
      const writer = fs.createWriteStream(destPath)
      res.data.on('data', chunk => {
        done += chunk.length
        if (total) {
          const elapsed = (Date.now() - startTime) / 1000
          const speed = done / elapsed / 1024 / 1024
          onProgress?.({ percent: Math.round(done / total * 100), downloaded: done, total, speedMbps: speed.toFixed(1), eta: Math.round((total - done) / (done / elapsed)) })
        }
      })
      res.data.pipe(writer)
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
    return { success: true, path: destPath, size: done }
  }

  async verify(isoPath, expectedSha256) {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(isoPath)
    await new Promise(async (resolve, reject) => { stream.on('data', d => hash.update(d)); stream.on('end', resolve); stream.on('error', reject) })
    const actual = hash.digest('hex').toLowerCase()
    return { match: actual === expectedSha256?.toLowerCase(), actual, expected: expectedSha256 }
  }

  async delete(isoPath) {
    await fs.remove(isoPath)
    return { success: true }
  }

  async getVentoyDir(usbMount) {
    // Ventoy USB has a /ventoy folder and /images or root for ISOs
    const ventoyDir = join(usbMount, 'ventoy')
    const exists = await fs.pathExists(ventoyDir)
    return { isVentoy: exists, ventoyDir, isoDir: usbMount }
  }

  async copyIsoToVentoy(isoPath, usbMount, onProgress) {
    const dest = join(usbMount, basename(isoPath))
    const stat = await fs.stat(isoPath)
    const total = stat.size
    let done = 0
    const reader = fs.createReadStream(isoPath)
    const writer = fs.createWriteStream(dest)
    reader.on('data', chunk => { done += chunk.length; onProgress?.({ percent: Math.round(done / total * 100), done, total }) })
    await new Promise(async (resolve, reject) => { reader.pipe(writer); writer.on('finish', resolve); writer.on('error', reject) })
    return { success: true, dest }
  }
}

export default { UsbDriveDetector, OsCatalog, UsbToolManager, IsoManager }
