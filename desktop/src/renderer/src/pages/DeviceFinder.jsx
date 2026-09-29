import { useState, useEffect, useRef } from 'react'
const ft = window.ft

const ANDROID_VIDS = {
  '0BB4':'HTC','04E8':'Samsung','2717':'Xiaomi','18D1':'Google','1004':'LG',
  '22B8':'Motorola','0FCE':'Sony','2A70':'OnePlus','19D2':'ZTE','05C6':'Qualcomm',
  '12D1':'Huawei','0B05':'Asus','1EBF':'Huawei','2AE5':'Fairphone','2D95':'vivo',
  '1BBB':'Alcatel','17EF':'Lenovo',
}

const MODE_INFO = {
  'adb-ready':       { color:'#4ade80', label:'ADB Ready',      icon:'OK', desc:'USB debugging is on' },
  'mtp-file-transfer':{ color:'#60a5fa', label:'MTP Mode',       icon:'MTP',desc:'File transfer — debugging OFF' },
  'fastboot':        { color:'#f59e0b', label:'Fastboot',        icon:'FB', desc:'In fastboot/bootloader mode' },
  'recovery/sideload':{ color:'#a78bfa', label:'Recovery',       icon:'REC',desc:'In recovery or sideload mode' },
  'usb-detected':    { color:'#f59e0b', label:'USB Detected',    icon:'USB',desc:'Device detected, mode unclear' },
  'unknown':         { color:'#888',    label:'Unknown',         icon:'?',  desc:'Unknown connection state' },
}

function DevicePill({ d }) {
  const m = MODE_INFO[d.mode] || MODE_INFO.unknown
  return (
    <div style={{ background:'var(--bg1)', border:`1px solid ${m.color}44`, borderRadius:10, padding:'12px 14px', borderLeft:`3px solid ${m.color}` }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
        <div style={{ width:36, height:36, borderRadius:8, background:`${m.color}22`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:m.color, flexShrink:0 }}>{m.icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:2 }}>{d.name}</div>
          <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>{d.manufacturer}{d.vid?` · VID:${d.vid}`:''}  {d.pid?`PID:${d.pid}`:''}</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:`${m.color}22`, color:m.color, fontWeight:700 }}>{m.label}</span>
            <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'var(--bg2)', color:'var(--text3)', border:'1px solid var(--border)' }}>{m.desc}</span>
            {d.isApple && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'rgba(96,165,250,0.15)', color:'#60a5fa', fontWeight:600 }}>iOS</span>}
          </div>
        </div>
      </div>
      {d.mode === 'mtp-file-transfer' && (
        <div style={{ marginTop:10, padding:'8px 10px', background:'rgba(245,158,11,0.1)', borderRadius:7, border:'1px solid rgba(245,158,11,0.2)', fontSize:11, color:'#f59e0b', lineHeight:1.7 }}>
          Device found in MTP mode but USB debugging is OFF. To enable ADB:
          <br/>Settings &gt; About Phone &gt; Build Number x7 &gt; Developer Options &gt; USB Debugging
        </div>
      )}
      {d.mode === 'fastboot' && (
        <div style={{ marginTop:10, padding:'8px 10px', background:'rgba(245,158,11,0.1)', borderRadius:7, border:'1px solid rgba(245,158,11,0.2)', fontSize:11, color:'#f59e0b' }}>
          Device in fastboot mode — use Fastboot Flasher page for partition operations.
        </div>
      )}
    </div>
  )
}

function StepCard({ n, title, done, children }) {
  return (
    <div style={{ background:'var(--bg1)', border:`1px solid ${done?'rgba(74,222,128,0.3)':'var(--border)'}`, borderRadius:9, padding:'12px 14px', borderLeft:`3px solid ${done?'#4ade80':'var(--border)'}` }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:children?8:0 }}>
        <div style={{ width:24, height:24, borderRadius:'50%', background:done?'#4ade80':'var(--bg3)', color:done?'#000':'var(--text3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0 }}>{done?'✓':n}</div>
        <span style={{ fontSize:13, fontWeight:600, color:done?'#4ade80':'var(--text)' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

const TABS = [['usb','USB Scan'],['network','Network Scan'],['fastboot','Fastboot'],['guide','Enable ADB Guide']]

export default function DeviceFinder({ device, addLog }) {
  const [tab, setTab] = useState('usb')
  const [usbDevices, setUsbDevices] = useState([])
  const [fbDevices, setFbDevices] = useState([])
  const [netDevices, setNetDevices] = useState([])
  const [scanning, setScanning] = useState(false)
  const [netProgress, setNetProgress] = useState({ done:0, total:254, found:0 })
  const [subnet, setSubnet] = useState('192.168.1')
  const [connectIp, setConnectIp] = useState('')
  const intervalRef = useRef(null)

  useEffect(() => {
    const u = ft.on('discover:scan-progress', p => setNetProgress(p))
    scanUsb()
    return () => { u(); clearInterval(intervalRef.current) }
  }, [])

  const scanUsb = async () => {
    setScanning(true)
    const r = await ft.discover.usbDevices().catch(e => ({ devices:[], error:e.message }))
    setUsbDevices(r.devices || [])
    if (!r.success && r.error) addLog('USB scan: ' + r.error)
    setScanning(false)
  }

  const scanFastboot = async () => {
    setScanning(true)
    const r = await ft.discover.fastboot().catch(e => ({ devices:[] }))
    setFbDevices(r.devices || [])
    addLog(`Fastboot: ${r.devices?.length||0} device(s) found`)
    setScanning(false)
  }

  const scanNetwork = async () => {
    setScanning(true)
    setNetDevices([])
    setNetProgress({ done:0, total:254, found:0 })
    addLog(`Scanning ${subnet}.1-254 on port 5555...`)
    const r = await ft.discover.networkScan({ subnet }).catch(e => ({ devices:[], error:e.message }))
    setNetDevices(r.devices || [])
    addLog(`Network scan: ${r.devices?.length||0} ADB device(s) found`)
    setScanning(false)
  }

  const connectWifi = async (ip) => {
    const r = await ft.discover.connectWifi({ ip, port:5555 }).catch(e => ({ error:e.message }))
    addLog(r.success ? `Connected: ${ip}:5555` : `Connect failed: ${r.output||r.error}`)
  }

  const adbSteps = [
    'Go to Settings',
    'Tap "About Phone" (or "About Device")',
    'Find "Build Number" — tap it 7 times quickly',
    'Enter your PIN if prompted',
    'Go back to Settings — "Developer Options" now appears',
    'Open Developer Options',
    'Scroll to find "USB Debugging" and enable it',
    'Plug in via USB — tap ALLOW on the phone when a popup appears',
  ]

  const mtpDevices = usbDevices.filter(d => d.mode === 'mtp-file-transfer')
  const adbDevices = usbDevices.filter(d => d.mode === 'adb-ready')
  const otherDevices = usbDevices.filter(d => !['mtp-file-transfer','adb-ready'].includes(d.mode))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}>🔍</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Device Finder</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Find devices with or without USB debugging enabled</div>
        </div>
        {usbDevices.length > 0 && (
          <div style={{ padding:'5px 12px', background:'rgba(74,222,128,0.15)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:7, fontSize:12, color:'#4ade80', fontWeight:700 }}>
            {usbDevices.length} USB device{usbDevices.length!==1?'s':''} detected
          </div>
        )}
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3 }}>
        {TABS.map(([id,l]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'7px 4px', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>
        ))}
      </div>

      {tab === 'usb' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ padding:12, background:'rgba(96,165,250,0.08)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:8, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            Scans Windows USB for all connected devices — works even without USB debugging. Detects MTP, fastboot, recovery, and ADB modes.
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={scanUsb} disabled={scanning} style={{ padding:'8px 18px', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
              {scanning ? 'Scanning...' : 'Scan USB'}
            </button>
          </div>

          {usbDevices.length === 0 && !scanning && (
            <div style={{ textAlign:'center', padding:30, color:'var(--text3)', fontSize:13 }}>No Android or iOS devices detected. Plug in a device and scan.</div>
          )}

          {adbDevices.length > 0 && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:'#4ade80', letterSpacing:'0.05em' }}>ADB READY</div>
              {adbDevices.map((d,i) => <DevicePill key={i} d={d} />)}
            </>
          )}

          {mtpDevices.length > 0 && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:'#f59e0b', letterSpacing:'0.05em', marginTop:4 }}>DETECTED — USB DEBUGGING OFF</div>
              {mtpDevices.map((d,i) => <DevicePill key={i} d={d} />)}
              <div style={{ padding:12, background:'rgba(74,222,128,0.08)', border:'1px solid rgba(74,222,128,0.2)', borderRadius:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#4ade80', marginBottom:6 }}>Your device is connected. USB debugging just needs to be turned on.</div>
                <div style={{ fontSize:12, color:'var(--text2)' }}>Click the "Enable ADB Guide" tab for step-by-step instructions.</div>
              </div>
            </>
          )}

          {otherDevices.length > 0 && (
            <>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', letterSpacing:'0.05em', marginTop:4 }}>OTHER DETECTED</div>
              {otherDevices.map((d,i) => <DevicePill key={i} d={d} />)}
            </>
          )}
        </div>
      )}

      {tab === 'network' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ padding:12, background:'rgba(96,165,250,0.08)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:8, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            Scans your local network for devices with ADB-over-WiFi (port 5555). Device must have "Wireless Debugging" or "ADB over network" enabled. Same WiFi network required.
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <input value={subnet} onChange={e=>setSubnet(e.target.value)} style={{ width:130, fontFamily:'monospace', fontSize:12 }} placeholder="192.168.1" />
            <span style={{ color:'var(--text3)', fontSize:12 }}>.1 - .254</span>
            <button onClick={scanNetwork} disabled={scanning} style={{ padding:'8px 18px', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
              {scanning ? 'Scanning...' : 'Scan Network'}
            </button>
          </div>

          {scanning && (
            <div style={{ background:'var(--bg1)', borderRadius:8, padding:12, border:'1px solid var(--border)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text3)', marginBottom:6 }}>
                <span>Scanning {subnet}.{netProgress.done}/254...</span>
                <span style={{ color:'#4ade80' }}>{netProgress.found} found</span>
              </div>
              <div style={{ height:5, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', width:((netProgress.done/254)*100)+'%', background:'var(--accent)', transition:'width 0.2s' }} />
              </div>
            </div>
          )}

          {/* Manual connect */}
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:9, padding:12 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>CONNECT MANUALLY</div>
            <div style={{ display:'flex', gap:8 }}>
              <input value={connectIp} onChange={e=>setConnectIp(e.target.value)} onKeyDown={e=>e.key==='Enter'&&connectWifi(connectIp)} placeholder="192.168.1.50" style={{ flex:1, fontFamily:'monospace', fontSize:12 }} />
              <button onClick={() => connectWifi(connectIp)} disabled={!connectIp} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Connect</button>
            </div>
            <div style={{ fontSize:10, color:'var(--text3)', marginTop:6 }}>ADB connects to port 5555 by default. Enter IP address of your device.</div>
          </div>

          {netDevices.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#4ade80', letterSpacing:'0.05em' }}>ADB-WIFI DEVICES FOUND</div>
              {netDevices.map((d,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'var(--bg1)', borderRadius:8, border:'1px solid rgba(74,222,128,0.3)' }}>
                  <span style={{ fontFamily:'monospace', fontSize:13, color:'var(--accent)', flex:1 }}>{d.ip}:{d.port}</span>
                  <button onClick={() => connectWifi(d.ip)} style={{ padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Connect</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'fastboot' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ padding:12, background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            Fastboot mode works without USB debugging. Boot your device to fastboot by holding Power + Volume Down, then scan here.
          </div>
          <button onClick={scanFastboot} disabled={scanning} style={{ padding:'8px 18px', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', width:'fit-content' }}>
            {scanning ? 'Scanning...' : 'Scan Fastboot Devices'}
          </button>
          {fbDevices.length === 0 && !scanning && (
            <div style={{ textAlign:'center', padding:24, color:'var(--text3)', fontSize:13 }}>No fastboot devices. Boot device to fastboot: hold Power + Volume Down.</div>
          )}
          {fbDevices.map((d,i) => (
            <div key={i} style={{ padding:'12px 14px', background:'var(--bg1)', borderRadius:9, border:'1px solid rgba(245,158,11,0.4)', borderLeft:'3px solid #f59e0b' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#f59e0b', marginBottom:4 }}>Fastboot Device</div>
              <div style={{ fontFamily:'monospace', fontSize:12, color:'var(--text2)', marginBottom:8 }}>Serial: {d.serial}</div>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:8 }}>In fastboot — no ADB debugging needed. Use Fastboot Flasher for partition operations.</div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => ft.fastboot.reboot({serial:d.serial,mode:'normal'}).then(()=>addLog('Rebooting to system...')).catch(e=>addLog(e.message))} style={{ padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'rgba(74,222,128,0.15)', color:'#4ade80', border:'1px solid rgba(74,222,128,0.3)' }}>Reboot System</button>
                <button onClick={() => ft.fastboot.getvar({serial:d.serial}).then(r=>addLog('Vars: '+JSON.stringify(r.vars||{}).slice(0,200))).catch(e=>addLog(e.message))} style={{ padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'rgba(96,165,250,0.15)', color:'#60a5fa', border:'1px solid rgba(96,165,250,0.3)' }}>Get Variables</button>
              </div>
            </div>
          ))}
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>FASTBOOT BOOT COMBOS</div>
            {[
              ['Samsung','Power + Volume Down (Download Mode, then use Odin)'],
              ['Google Pixel','Power + Volume Down'],
              ['OnePlus','Power + Volume Up'],
              ['Xiaomi / POCO','Power + Volume Down'],
              ['Sony','Volume Up while plugging in USB'],
              ['Motorola','Power + Volume Down'],
              ['LG','Power + Volume Down'],
              ['Via ADB (debug on)','adb reboot bootloader'],
            ].map(([brand,combo],i) => (
              <div key={i} style={{ display:'flex', gap:12, padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                <span style={{ color:'var(--accent)', fontWeight:600, minWidth:100, flexShrink:0 }}>{brand}</span>
                <span style={{ color:'var(--text2)' }}>{combo}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'guide' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {mtpDevices.length > 0 && (
            <div style={{ padding:12, background:'rgba(74,222,128,0.1)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:8, fontSize:13, color:'#4ade80', fontWeight:600 }}>
              Your device is connected (detected in MTP mode). Just enable USB Debugging below.
            </div>
          )}
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--text)', marginBottom:12 }}>Enable USB Debugging — Step by Step</div>
            {adbSteps.map((step,i) => (
              <div key={i} style={{ display:'flex', gap:10, marginBottom:12 }}>
                <div style={{ width:26, height:26, borderRadius:'50%', background:'var(--accent)', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                <div style={{ fontSize:13, color:'var(--text2)', lineHeight:1.7, paddingTop:3 }}>{step}</div>
              </div>
            ))}
          </div>
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:10 }}>Manufacturer Variations</div>
            {[
              { brand:'Samsung',  path:'Settings > About Phone > Software Info > Build Number x7' },
              { brand:'Xiaomi',   path:'Settings > About Phone > MIUI Version x7' },
              { brand:'OnePlus',  path:'Settings > About Device > Build Number x7' },
              { brand:'Huawei',   path:'Settings > About Phone > Build Number x7' },
              { brand:'Oppo',     path:'Settings > About Phone > Version > Build Number x7' },
              { brand:'Vivo',     path:'Settings > About Phone > Software > Build Version x7' },
              { brand:'Sony',     path:'Settings > About Phone > Build Number x7' },
              { brand:'LG',       path:'Settings > About Phone > Software Info > Build Number x7' },
            ].map((d,i) => (
              <div key={i} style={{ display:'flex', gap:12, padding:'6px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                <span style={{ color:'var(--accent)', fontWeight:600, minWidth:80, flexShrink:0 }}>{d.brand}</span>
                <span style={{ color:'var(--text2)' }}>{d.path}</span>
              </div>
            ))}
          </div>
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:8 }}>Alternative: Wireless Debugging (Android 11+)</div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.8 }}>
              No USB cable needed at all after initial setup.<br/>
              1. Developer Options &gt; Wireless Debugging &gt; Enable<br/>
              2. Note the IP address shown<br/>
              3. Use the Network Scan tab to find and connect<br/>
              4. Or use the Wireless ADB page for guided setup
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
