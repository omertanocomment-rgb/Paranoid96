import React, { useState, useEffect, useCallback, Component } from 'react'
import Dashboard from './pages/Dashboard'
import FileManager from './pages/FileManager'
import AppManager from './pages/AppManager'
import Sideloader from './pages/Sideloader'
import Backup from './pages/Backup'
import Debloater from './pages/Debloater'
import Privacy from './pages/Privacy'
import SystemTools from './pages/SystemTools'
import Network from './pages/Network'
import BrokenDevice from './pages/BrokenDevice'
import ROMManager from './pages/ROMManager'
import ROMBuilder from './pages/ROMBuilder'
import ScrcpyGUI from './pages/ScrcpyGUI'
import ADBLibrary from './pages/ADBLibrary'
import TWRPInstaller from './pages/TWRPInstaller'
import MagiskModules from './pages/MagiskModules'
import MediaTools from './pages/MediaTools'
import AppUpdater from './pages/AppUpdater'
import TestPoints from './pages/TestPoints'
import ForensicsExport from './pages/ForensicsExport'
import CrossTransfer from './pages/CrossTransfer'
import WaterDamage from './pages/WaterDamage'
import OTAInterceptor from './pages/OTAInterceptor'
import KernelFlasher from './pages/KernelFlasher'
import RepairMode from './pages/RepairMode'
import PermScheduler from './pages/PermScheduler'
import SmsPdf from './pages/SmsPdf'
import BootloaderWizard from './pages/BootloaderWizard'
import iOSHub from './pages/iOSHub'
import ThemeEditor from './pages/ThemeEditor'
import LogcatViewer from './pages/LogcatViewer'
import ApkAnalyser from './pages/ApkAnalyser'
import SqliteBrowser from './pages/SqliteBrowser'
import HardwareDiag from './pages/HardwareDiag'
import FridaTools from './pages/FridaTools'
import IntentSender from './pages/IntentSender'
import LayoutInspector from './pages/LayoutInspector'
import MockLocation from './pages/MockLocation'
import TrafficMonitor from './pages/TrafficMonitor'
import ClipboardSync from './pages/ClipboardSync'
import WifiPasswords from './pages/WifiPasswords'
import CertManager from './pages/CertManager'
import UsbHub from './pages/UsbHub'
import iOSUnlock from './pages/iOSUnlock'
import iOSConnect from './pages/iOSConnect'
import iOSManager from './pages/iOSManager'
import SHSHManager from './pages/SHSHManager'
import Terminal from './pages/Terminal'
import DeviceFinder from './pages/DeviceFinder'
import PermissionScanner from './pages/PermissionScanner'
import { QuickActions } from './pages/QuickActions'
import ROMFinder from './pages/ROMFinder'
import EraseDevice from './pages/EraseDevice'
import AndroidToolbox from './pages/AndroidToolbox'
import iOSAdvanced from './pages/iOSAdvanced'
import iOSToolbox from './pages/iOSToolbox'
import AppStoreBrowser from './pages/AppStoreBrowser'
import IPSWManager from './pages/IPSWManager'
import iOSCustom from './pages/iOSCustom'
import NANDEditor from './pages/NANDEditor'
import JailbreakWizard from './pages/JailbreakWizard'
import Onboarding from './pages/Onboarding'
import CryptoTool from './pages/CryptoTool'
import AppBackupMgr from './pages/AppBackupMgr'
import NotifLogger from './pages/NotifLogger'
import HashVerify from './pages/HashVerify'
import AppBackupManager from './pages/AppBackupManager'
import ProcessManager from './pages/ProcessManager'
import DeviceHealth from './pages/DeviceHealth'
import HostsEditor from './pages/HostsEditor'
import BuildProp from './pages/BuildProp'
import WirelessADB from './pages/WirelessADB'
import SpeedTest from './pages/SpeedTest'
import DNSChanger from './pages/DNSChanger'
import AppCloner from './pages/AppCloner'
import BatteryHistory from './pages/BatteryHistory'
import FastbootFlasher from './pages/FastbootFlasher'
import ADBBuilder from './pages/ADBBuilder'
import UsbFlashCentre from './pages/UsbFlashCentre'

// ─── OMNI (unified-app additions beyond core Android/iOS device mgmt) ──────
import SSHBridge from './pages/SSHBridge'
import AIAssistant from './pages/AIAssistant'
import ElectroDiag from './pages/ElectroDiag'
import MusicStudio from './pages/MusicStudio'
import SecureMessaging from './pages/SecureMessaging'
import BootloaderMultichipset from './pages/BootloaderMultichipset'
import RepoBrowser from './pages/RepoBrowser'
import TermuxNodes from './pages/TermuxNodes'

const ft = window.ft

const NAV = [
  // ─── ANDROID ─────────────────────────────────────────────────────────────
  { id: 'dashboard',   label: 'Dashboard',       icon: 'DB', group: 'Android - Device' },
  { id: 'devicefinder',label: 'Device Finder',   icon: 'DF', group: 'Android - Device' },
  { id: 'wireless',    label: 'Wireless ADB',     icon: 'WF', group: 'Android - Device' },
  { id: 'health',      label: 'Device Health',    icon: 'DH', group: 'Android - Device' },
  { id: 'procmgr',     label: 'Process Mgr',      icon: 'PM', group: 'Android - Device' },
  { id: 'mirror',      label: 'Screen Mirror',    icon: 'SC', group: 'Android - Device' },
  { id: 'files',       label: 'File Manager',     icon: 'FM', group: 'Android - Device' },
  { id: 'apps',        label: 'App Manager',      icon: 'AM', group: 'Android - Device' },
  { id: 'appbackup',   label: 'App Backup',       icon: 'AB', group: 'Android - Device' },
  { id: 'appcloner',   label: 'App Cloner',       icon: 'AC', group: 'Android - Device' },
  { id: 'backup',      label: 'Backup',           icon: 'BK', group: 'Android - Device' },
  { id: 'transfer',    label: 'Cross Transfer',   icon: 'CT', group: 'Android - Device' },

  { id: 'debloat',     label: 'Debloater',        icon: 'DL', group: 'Android - Tweaks' },
  { id: 'permscanner', label: 'Perm Scanner',     icon: 'PS', group: 'Android - Tweaks' },
  { id: 'privacy',     label: 'Privacy',          icon: 'PV', group: 'Android - Tweaks' },
  { id: 'system',      label: 'System Tools',     icon: 'SY', group: 'Android - Tweaks' },
  { id: 'buildprop',   label: 'Build.prop',       icon: 'BP', group: 'Android - Tweaks' },
  { id: 'dns',         label: 'DNS Changer',      icon: 'DC', group: 'Android - Tweaks' },
  { id: 'hosts',       label: 'Hosts Editor',     icon: 'HE', group: 'Android - Tweaks' },
  { id: 'network',     label: 'Network',          icon: 'NW', group: 'Android - Tweaks' },
  { id: 'speedtest',   label: 'Speed Test',       icon: 'ST', group: 'Android - Tweaks' },
  { id: 'batteryhist', label: 'Battery History',  icon: 'BH', group: 'Android - Tweaks' },
  { id: 'permsch',     label: 'Perm Scheduler',   icon: 'PH', group: 'Android - Tweaks' },
  { id: 'media',       label: 'Media Tools',      icon: 'MD', group: 'Android - Tweaks' },
  { id: 'mockloc',     label: 'Mock Location',    icon: 'ML', group: 'Android - Tweaks' },

  { id: 'sideload',    label: 'Sideloader',       icon: 'SL', group: 'Android - ROM' },
  { id: 'fastboot',    label: 'Fastboot',         icon: 'FB', group: 'Android - ROM' },
  { id: 'romfinder',   label: 'ROM Finder',       icon: 'RF', group: 'Android - ROM' },
  { id: 'rom',         label: 'ROM Manager',      icon: 'RM', group: 'Android - ROM' },
  { id: 'rombuild',    label: 'ROM Builder',      icon: 'RB', group: 'Android - ROM' },
  { id: 'nand',        label: 'NAND Editor',      icon: 'ND', group: 'Android - ROM' },
  { id: 'twrp',        label: 'TWRP',             icon: 'TW', group: 'Android - ROM' },
  { id: 'magisk',      label: 'Magisk',           icon: 'MK', group: 'Android - ROM' },
  { id: 'bootloader',  label: 'Bootloader',       icon: 'BL', group: 'Android - ROM' },
  { id: 'kernel',      label: 'Kernel Flasher',   icon: 'KN', group: 'Android - ROM' },
  { id: 'ota',         label: 'OTA Intercept',    icon: 'OT', group: 'Android - ROM' },
  { id: 'repair',      label: 'Repair Mode',      icon: 'RP', group: 'Android - ROM' },

  { id: 'androidtoolbox', label: 'Android Toolbox', icon: 'AT', group: 'Android - Dev' },
  { id: 'adbbuilder',  label: 'ADB Builder',      icon: 'AB', group: 'Android - Dev' },
  { id: 'adblib',      label: 'ADB Library',      icon: 'AL', group: 'Android - Dev' },
  { id: 'logcat',      label: 'Logcat',           icon: 'LC', group: 'Android - Dev' },
  { id: 'apkanalyse',  label: 'APK Analyser',     icon: 'AK', group: 'Android - Dev' },
  { id: 'sqlite',      label: 'SQLite Browser',   icon: 'SQ', group: 'Android - Dev' },
  { id: 'layout',      label: 'Layout Inspector', icon: 'LI', group: 'Android - Dev' },
  { id: 'intent',      label: 'Intent Sender',    icon: 'IT', group: 'Android - Dev' },
  { id: 'frida',       label: 'Frida',            icon: 'FR', group: 'Android - Dev' },
  { id: 'traffic',     label: 'Traffic Monitor',  icon: 'TM', group: 'Android - Dev' },
  { id: 'clipboard',   label: 'Clipboard Sync',   icon: 'CB', group: 'Android - Dev' },
  { id: 'terminal',    label: 'Terminal',         icon: 'TR', group: 'Android - Dev' },
  { id: 'hwdiag',      label: 'HW Diagnostics',   icon: 'HW', group: 'Android - Dev' },

  { id: 'crypto',      label: 'Hash and Verify',  icon: 'HV', group: 'Android - Security' },
  { id: 'wifi',        label: 'Wi-Fi Passwords',  icon: 'WP', group: 'Android - Security' },
  { id: 'certs',       label: 'Certificates',     icon: 'CE', group: 'Android - Security' },

  { id: 'extract',     label: 'Broken Device',    icon: 'BD', group: 'Android - Recovery' },
  { id: 'water',       label: 'Water Damage',     icon: 'WD', group: 'Android - Recovery' },
  { id: 'testpoints',  label: 'Test Points',      icon: 'TP', group: 'Android - Recovery' },
  { id: 'forensics',   label: 'Forensics',        icon: 'FO', group: 'Android - Recovery' },
  { id: 'smspdf',      label: 'SMS to PDF',       icon: 'SP', group: 'Android - Recovery' },
  { id: 'updater',     label: 'App Updates',      icon: 'AU', group: 'Android - Recovery' },

  // ─── iOS ─────────────────────────────────────────────────────────────────
  { id: 'ios',         label: 'iOS Hub',          icon: 'iO', group: 'iOS - Main' },
  { id: 'iosmgr',      label: 'iOS Manager',      icon: 'iM', group: 'iOS - Main' },
  { id: 'iosconn',     label: 'iPhone Setup',     icon: 'IC', group: 'iOS - Main' },
  { id: 'iostoolbox',     label: 'iOS Toolbox',     icon: 'iT', group: 'iOS - Main' },
  { id: 'erasedevice', label: 'Erase Device', icon: 'ER', group: 'iOS - Main' },
  { id: 'iosadvanced', label: 'iOS Advanced',     icon: 'IA', group: 'iOS - Main' },
  { id: 'iosunlock',   label: 'iOS Unlock',       icon: 'UL', group: 'iOS - Main' },

  { id: 'ioscustom',   label: 'Tweaks and Themes',icon: 'TT', group: 'iOS - Customise' },
  { id: 'ipsw',        label: 'IPSW Manager',     icon: 'IW', group: 'iOS - Customise' },
  { id: 'shsh',        label: 'SHSH Blobs',       icon: 'SH', group: 'iOS - Customise' },

  { id: 'jailbreak',   label: 'Jailbreak Wizard', icon: 'JB', group: 'iOS - Jailbreak' },
  { id: 'nandios',     label: 'iOS Ramdisk',      icon: 'RD', group: 'iOS - Jailbreak' },

  { id: 'brokenios',   label: 'Broken iPhone',    icon: 'Bi', group: 'iOS - Recovery' },

  // ─── Tools ───────────────────────────────────────────────────────────────
  { id: 'usb',         label: 'USB Hub',          icon: 'UH', group: 'Tools' },
  { id: 'usbflash',    label: 'Flash Centre',     icon: 'FC', group: 'Tools' },
  { id: 'onboarding',  label: 'Setup Wizard',     icon: 'SW', group: 'Tools' },
  { id: 'theme',       label: 'Theme Editor',     icon: 'TH', group: 'Tools' },

  // ─── OMNI ────────────────────────────────────────────────────────────────
  { id: 'aiassistant', label: 'AI Assistant',     icon: 'AI', group: 'Omni - Suite' },
  { id: 'sshbridge',   label: 'SSH Bridge',       icon: 'SB', group: 'Omni - Suite' },
  { id: 'termuxnodes', label: 'Termux Nodes',     icon: 'TN', group: 'Omni - Suite' },
  { id: 'bltmulti',    label: 'Multi-Chip Boot',  icon: 'MC', group: 'Omni - Suite' },
  { id: 'repobrowser', label: 'Repo Browser',     icon: 'RB', group: 'Omni - Suite' },
  { id: 'electrodiag', label: 'Electrical Diag',  icon: 'ED', group: 'Omni - Suite' },
  { id: 'musicstudio', label: 'Music Studio',     icon: 'MS', group: 'Omni - Suite' },
  { id: 'securemsg',   label: 'Secure Messaging', icon: 'SM', group: 'Omni - Suite' },
]

const PAGES = {
  dashboard:  Dashboard,
  files:      FileManager,
  apps:       AppManager,
  sideload:   Sideloader,
  backup:     Backup,
  mirror:     ScrcpyGUI,
  debloat:    Debloater,
  privacy:    Privacy,
  system:     SystemTools,
  network:    Network,
  adblib:     ADBLibrary,
  media:      MediaTools,
  permsch:    PermScheduler,
  extract:    BrokenDevice,
  water:      WaterDamage,
  testpoints: TestPoints,
  forensics:  ForensicsExport,
  transfer:   CrossTransfer,
  smspdf:     SmsPdf,
  rom:        ROMManager,
  rombuild:   ROMBuilder,
  twrp:       TWRPInstaller,
  magisk:     MagiskModules,
  bootloader: BootloaderWizard,
  kernel:     KernelFlasher,
  ota:        OTAInterceptor,
  updater:    AppUpdater,
  repair:     RepairMode,
  ios:        iOSHub,
  theme:      ThemeEditor,
  logcat:     LogcatViewer,
  apkanalyse: ApkAnalyser,
  sqlite:     SqliteBrowser,
  hwdiag:     HardwareDiag,
  frida:      FridaTools,
  intent:     IntentSender,
  layout:     LayoutInspector,
  mockloc:    MockLocation,
  traffic:    TrafficMonitor,
  clipboard:  ClipboardSync,
  wifi:       WifiPasswords,
  certs:      CertManager,
  usb:        UsbHub,
  terminal:   Terminal,
  devicefinder: DeviceFinder,
  permscanner: PermissionScanner,
  romfinder:  ROMFinder,
  erasedevice: EraseDevice,
  androidtoolbox: AndroidToolbox,
  iosadvanced: iOSAdvanced,
  iostoolbox: iOSToolbox,
  appstore: AppStoreBrowser,
  ipsw: IPSWManager,
  ioscustom: iOSCustom,
  jailbreak: JailbreakWizard,
  nand: NANDEditor,
  nandios: NANDEditor,
  onboarding: Onboarding,
  crypto: CryptoTool,
  appbackup: AppBackupMgr,
  notiflog: NotifLogger,
  hashverify: HashVerify,
  appbkup: AppBackupManager,
  procmgr: ProcessManager,
  hosts: HostsEditor,
  buildprop: BuildProp,
  health: DeviceHealth,
  wireless: WirelessADB,
  speedtest:  SpeedTest,
  dns:  DNSChanger,
  appcloner:  AppCloner,
  batteryhist:  BatteryHistory,
  fastboot:  FastbootFlasher,
  adbbuilder:  ADBBuilder,
  usbflash:   UsbFlashCentre,
  iosconn:    iOSConnect,
  iosmgr:     iOSManager,
  iosunlock:  iOSUnlock,
  shsh:       SHSHManager,
  aiassistant: AIAssistant,
  sshbridge:   SSHBridge,
  termuxnodes: TermuxNodes,
  bltmulti:    BootloaderMultichipset,
  repobrowser: RepoBrowser,
  electrodiag: ElectroDiag,
  musicstudio: MusicStudio,
  securemsg:   SecureMessaging,
}

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [devices, setDevices] = useState({ android: [], ios: [] })
  const [activeDevice, setActiveDevice] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [logs, setLogs] = useState([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => { ft.app.version().then(setAppVersion).catch(() => {}) }, [])

  const addLog = useCallback((msg) =>
    setLogs(l => [...l.slice(-200), `[${new Date().toLocaleTimeString()}] ${msg}`])
  , [])

  const scanDevices = useCallback(async () => {
    setScanning(true)
    try {
      const result = await ft.device.list()
      setDevices(result)
      const allFound = [
        ...result.android.map(d => ({ ...d, deviceType: 'android' })),
        ...result.ios.map(d => ({ ...d, deviceType: 'ios' })),
      ]
      setActiveDevice(prev => {
        // If no device was selected, auto-select first found
        if (!prev && allFound.length) return allFound[0]
        // If current device is still connected, keep it
        if (prev && allFound.find(d => d.serial === prev.serial || d.udid === prev.udid)) return prev
        // Current device disconnected - auto-select next available or null
        if (allFound.length) return allFound[0]
        return null
      })
    } catch (e) { addLog('Scan: ' + e.message) }
    setScanning(false)
  }, [addLog])

  useEffect(() => {
    scanDevices()
    const t = setInterval(scanDevices, 6000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!ft?.on) return
    try {
      const cleanups = [
        ft.on('extract:progress',      p => addLog(`[Extract] ${p.message || p.percent + '%'}`)),
        ft.on('rom:download:progress', p => addLog(`[ROM] ${p.percent}%`)),
        ft.on('rombuild:progress',     p => addLog(`[Build] ${p.message || p.percent + '%'}`)),
        ft.on('backup:progress',       p => addLog(`[Backup] ${p.message || p.percent + '%'}`)),
        ft.on('magisk:progress',       p => addLog(`[Magisk] ${p.message || p.percent + '%'}`)),
        ft.on('twrp:progress',         p => addLog(`[TWRP] ${p.message || p.percent + '%'}`)),
        ft.on('forensics:progress',    p => addLog(`[Forensics] ${p.message || p.percent + '%'}`)),
        ft.on('transfer:progress',     p => addLog(`[Transfer] ${p.message || p.percent + '%'}`)),
        ft.on('appupdate:progress',    p => addLog(`[Update] ${p.percent}% -- ${p.pkg || ''}`)),
      ]
      return () => cleanups.forEach(fn => typeof fn === 'function' && fn())
    } catch(e) { console.error('Event listener setup failed:', e) }
  }, [addLog])

  const allDevices = [
    ...devices.android.map(d => ({ ...d, deviceType: 'android' })),
    ...devices.ios.map(d => ({ ...d, deviceType: 'ios' })),
  ]

  const PageComponent = PAGES[page] || Dashboard
  const groups = [...new Set(NAV.map(n => n.group))]

  return (
    <div style={{ display:'flex', height:'100vh', background:'var(--bg)', flexDirection:'column' }}>

      {/*    Titlebar                                                     */}
      <TitleBar appName="Omerta Tool Hub" />

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/*    Sidebar                                                  */}
        <Sidebar
          nav={NAV}
          groups={groups}
          page={page}
          setPage={setPage}
          allDevices={allDevices}
          activeDevice={activeDevice}
          setActiveDevice={setActiveDevice}
          scanning={scanning}
          scanDevices={scanDevices}
          logs={logs}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          appVersion={appVersion}
        />

        {/*    Main content                                             */}
        <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', minWidth:0 }}>
          <ErrorBoundary name={page}>
            <PageComponent device={activeDevice} addLog={addLog} />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  )
}

/*    Titlebar                                                                */
function TitleBar({ appName }) {
  const handleWin = (action) => {
    if (action === 'min') ft.window.minimize()
    else if (action === 'max') ft.window.maximize()
    else ft.window.close()
  }

  return (
    <div style={{
      height:'var(--titlebar-height, 40px)', background:'var(--bg1)',
      borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center',
      paddingLeft:14, WebkitAppRegion:'drag', flexShrink:0, gap:10, userSelect:'none'
    }}>
      <span style={{ fontSize:13, fontWeight:700, color:'var(--accent)', letterSpacing:'0.08em' }}>
        {appName.toUpperCase()}
      </span>
      <span style={{ fontSize:11, color:'var(--text3)', fontStyle:'italic' }}>Silence Is The Only Unbreakable Code</span>
      <div style={{ flex:1 }} />
      <div style={{ WebkitAppRegion:'no-drag', display:'flex' }}>
        {[['-','min','#555'],[' ','max','#555'],[' ','close','#c0392b']].map(([label, action, hoverBg]) => (
          <button key={action} onClick={() => handleWin(action)}
            style={{ width:38, height:'var(--titlebar-height, 40px)', background:'none', border:'none', color:'var(--text2)', fontSize:12, cursor:'pointer', transition:'background 0.1s' }}
            onMouseEnter={e => e.target.style.background = hoverBg}
            onMouseLeave={e => e.target.style.background = 'none'}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

/*    Sidebar                                                                 */
function Sidebar({ nav, groups, page, setPage, allDevices, activeDevice, setActiveDevice, scanning, scanDevices, logs, collapsed, setCollapsed, appVersion }) {
  const w = collapsed ? 52 : 'var(--sidebar-width, 200px)'

  return (
    <div style={{
      width:w, background:'var(--bg1)', borderRight:'1px solid var(--border)',
      display:'flex', flexDirection:'column', flexShrink:0, overflowY:'auto',
      overflowX:'hidden', transition:'width 0.2s', minHeight:0
    }}>
      {/* Collapse toggle */}
      <button onClick={() => setCollapsed(c => !c)} style={{
        width:'100%', padding:'8px 0', background:'none', border:'none', borderBottom:'1px solid var(--border)',
        color:'var(--text3)', cursor:'pointer', fontSize:14, flexShrink:0
      }}>{collapsed ? ' ' : ' '}</button>

      {/* Device list */}
      {!collapsed && (
        <div style={{ padding:'10px 8px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <div style={{ fontSize:10, color:'var(--text3)', fontWeight:700, letterSpacing:'0.08em', marginBottom:6, paddingLeft:4 }}>DEVICES</div>
          {allDevices.length === 0 ? (
            <div style={{ fontSize:11, color:'var(--text3)', padding:'4px', display:'flex', alignItems:'center', gap:6 }}>
              {scanning && <span style={{ width:10, height:10, borderRadius:'50%', border:'1.5px solid var(--border2)', borderTopColor:'var(--accent)', animation:'spin 0.7s linear infinite', display:'inline-block' }} />}
              {scanning ? 'Scanning...' : 'None found'}
            </div>
          ) : allDevices.map(d => (
            <button key={d.udid || d.serial} onClick={() => setActiveDevice(d)}
              style={{
                width:'100%', display:'flex', alignItems:'center', gap:8, padding:'6px 8px',
                borderRadius:6, border:'none', cursor:'pointer', textAlign:'left', fontSize:11,
                background: (activeDevice?.serial === d.serial || activeDevice?.udid === d.udid) ? 'var(--accent-dim)' : 'none',
                color: (activeDevice?.serial === d.serial || activeDevice?.udid === d.udid) ? 'var(--accent)' : 'var(--text2)',
                transition:'all 0.1s'
              }}>
              <span>{d.deviceType === 'ios' ? ' ' : ' '}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:500, fontSize:11, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{d.model || d.name || (d.serial || '').slice(0,10)}</div>
                <div style={{ fontSize:9, color:'var(--text3)' }}>{d.state || 'connected'}</div>
              </div>
            </button>
          ))}
          <button onClick={scanDevices} style={{
            width:'100%', marginTop:5, padding:'4px 0', background:'var(--bg3)', border:'1px solid var(--border)',
            borderRadius:5, fontSize:11, color:'var(--text3)', cursor:'pointer'
          }}>{scanning ? '...' : '  Refresh'}</button>
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex:1, padding:'6px 6px', minHeight:0, overflowY:'auto' }}>
        {(() => {
          // Determine major section breaks
          let lastMajor = null
          const elements = []
          groups.forEach(group => {
            const items = nav.filter(n => n.group === group)
            if (!items.length) return
            const major = group.split(' - ')[0]
            if (major !== lastMajor) {
              lastMajor = major
              if (!collapsed) {
                const isIos = major === 'iOS'
                const isAndroid = major === 'Android'
                elements.push(
                  <div key={'MAJOR_'+major} style={{
                    margin:'10px 0 4px', padding:'5px 8px',
                    background: isIos ? 'rgba(167,139,250,0.12)' : isAndroid ? 'rgba(74,222,128,0.1)' : 'var(--bg2)',
                    borderRadius:6, border: `1px solid ${isIos ? 'rgba(167,139,250,0.25)' : isAndroid ? 'rgba(74,222,128,0.2)' : 'var(--border)'}`,
                    display:'flex', alignItems:'center', gap:6
                  }}>
                    <span style={{ fontSize:12 }}>{isIos ? '' : isAndroid ? '' : ''}</span>
                    <span style={{ fontSize:10, fontWeight:800, letterSpacing:'0.1em', color: isIos ? '#a78bfa' : isAndroid ? '#4ade80' : 'var(--text3)' }}>
                      {major.toUpperCase()}
                    </span>
                  </div>
                )
              } else {
                elements.push(
                  <div key={'MAJOR_'+major} style={{ margin:'6px 0 2px', height:1, background:'var(--border)' }} />
                )
              }
            }
            const sub = group.includes(' - ') ? group.split(' - ')[1] : null
            elements.push(
              <div key={group} style={{ marginBottom:2 }}>
                {!collapsed && sub && (
                  <div style={{ fontSize:9, color:'var(--text3)', fontWeight:700, letterSpacing:'0.07em', padding:'5px 8px 2px', opacity:0.7 }}>
                    {sub.toUpperCase()}
                  </div>
                )}
                {items.map(n => (
                  <button key={n.id} onClick={() => setPage(n.id)}
                    title={collapsed ? n.label : undefined}
                    style={{
                      width:'100%', display:'flex', alignItems:'center', gap:collapsed ? 0 : 8,
                      padding: collapsed ? '8px 0' : '6px 8px',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      borderRadius:6, border:'none', cursor:'pointer', fontSize:11,
                      background: page === n.id ? 'var(--accent-dim)' : 'none',
                      color: page === n.id ? 'var(--accent)' : 'var(--text2)',
                      transition:'all 0.1s', fontWeight: page===n.id ? 600 : 400,
                    }}>
                    <span style={{ fontSize:11, flexShrink:0, fontFamily:'monospace', opacity:0.7 }}>{n.icon}</span>
                    {!collapsed && <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.label}</span>}
                  </button>
                ))}
              </div>
            )
          })
          return elements
        })()}
      </nav>

      {/* Log strip */}
      {!collapsed && (
        <div style={{ borderTop:'1px solid var(--border)', padding:'6px 8px', flexShrink:0 }}>
          <div style={{ fontSize:9, color:'var(--text3)', fontWeight:700, letterSpacing:'0.06em', marginBottom:3 }}>LOG</div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'#6ee7b7', lineHeight:1.6, maxHeight:70, overflowY:'auto' }}>
            {logs.slice(-6).map((l, i) => <div key={i} style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{l}</div>)}
            {!logs.length && <div style={{ color:'var(--text3)' }}>No activity</div>}
          </div>
        </div>
      )}

      {/* Version footer */}
      <div style={{
        borderTop:'1px solid var(--border)', padding: collapsed ? '6px 0' : '5px 8px',
        flexShrink:0, textAlign: collapsed ? 'center' : 'left',
        fontSize:9, color:'var(--text3)', letterSpacing:'0.03em'
      }}>
        {collapsed ? (appVersion ? `v${appVersion.split('.')[0]}` : '') : (appVersion ? `Omerta Tool Hub v${appVersion}` : 'Omerta Tool Hub')}
      </div>
    </div>
  )
}

/*    Error Boundary                                                           */
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  componentDidCatch(e, info) { console.error('Page error:', e, info) }
  componentDidUpdate(prev) { if (prev.name !== this.props.name) this.setState({ error: null }) }
  render() {
    if (this.state.error) return (
      <div style={{ padding:32, display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ fontSize:16, fontWeight:600, color:'var(--red)' }}>  Page Error</div>
        <div style={{ fontSize:12, color:'var(--text3)', fontFamily:'var(--font-mono)', background:'var(--bg2)', padding:12, borderRadius:8, whiteSpace:'pre-wrap', maxHeight:200, overflow:'auto' }}>
          {this.state.error.message}{'\n\n'}{this.state.error.stack?.split('\n').slice(0,8).join('\n')}
        </div>
        <button className="btn btn-sm" onClick={() => this.setState({ error: null })}>  Retry</button>
      </div>
    )
    return this.props.children
  }
}
