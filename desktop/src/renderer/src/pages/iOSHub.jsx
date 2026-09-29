import { useState, useEffect } from 'react'

const ft = window.ft

function Btn({ onClick, disabled, color, children, sm, full }) {
  const styles = {
    red:    { bg:'rgba(248,113,113,0.15)', color:'#f87171', border:'rgba(248,113,113,0.3)' },
    green:  { bg:'rgba(74,222,128,0.15)',  color:'#4ade80', border:'rgba(74,222,128,0.3)' },
    blue:   { bg:'rgba(96,165,250,0.15)',  color:'#60a5fa', border:'rgba(96,165,250,0.3)' },
    amber:  { bg:'rgba(245,158,11,0.15)',  color:'#f59e0b', border:'rgba(245,158,11,0.3)' },
    accent: { bg:'var(--accent)',          color:'#000',    border:'transparent' },
  }
  const s = styles[color] || { bg:'var(--bg3)', color:'var(--text)', border:'var(--border)' }
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: sm ? '5px 10px' : '7px 14px', borderRadius:7, fontSize: sm ? 11 : 12, fontWeight:600,
        cursor: disabled ? 'not-allowed' : 'pointer', background: s.bg, color: s.color,
        border: `1px solid ${s.border}`, opacity: disabled ? 0.5 : 1,
        width: full ? '100%' : undefined }}>
      {children}
    </button>
  )
}

function Card({ title, icon, children }) {
  return (
    <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
      <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', letterSpacing:'0.06em', marginBottom:10 }}>
        {icon && <span style={{ marginRight:6 }}>{icon}</span>}{title}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, mono }) {
  if (!value && value !== 0) return null
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
      <span style={{ color:'var(--text3)' }}>{label}</span>
      <span style={{ color:'var(--text2)', fontFamily: mono ? 'monospace' : 'inherit' }}>{String(value)}</span>
    </div>
  )
}

function Progress({ pct, msg }) {
  return (
    <div style={{ marginTop:8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text3)', marginBottom:4 }}>
        <span>{msg}</span><span>{pct}%</span>
      </div>
      <div style={{ background:'var(--bg3)', borderRadius:3, height:5, overflow:'hidden' }}>
        <div style={{ width:Math.min(pct,100)+'%', height:'100%', background:pct===100?'#4ade80':'var(--accent)', transition:'width 0.3s' }} />
      </div>
    </div>
  )
}

const TABS = [
  ['device',  'Device'],
  ['data',    'Data Export'],
  ['network', 'Network'],
  ['tools',   'Tools'],
  ['jailbreak','Jailbreak'],
  ['audit',   'Audit'],
]

export default function iOSHub({ device, addLog }) {
  const [tab, setTab] = useState('device')
  const [loading, setLoading] = useState(null)
  const [progress, setProgress] = useState({ pct:0, msg:'' })

  // Device state
  const [date, setDate] = useState(null)
  const [newName, setNewName] = useState('')
  const [crashFiles, setCrashFiles] = useState([])
  const [devdisks, setDevdisks] = useState(null)
  const [battery, setBattery] = useState(null)
  const [usbmux, setUsbmux] = useState(null)
  const [mdm, setMdm] = useState(null)

  // Network state
  const [proxies, setProxies] = useState([])
  const [proxyLocal, setProxyLocal] = useState('2222')
  const [proxyDevice, setProxyDevice] = useState('22')
  const [notifyBundle, setNotifyBundle] = useState('com.apple.mobilecal')
  const [notifyMsg, setNotifyMsg] = useState('Hello from Omerta')
  const [notifyTitle, setNotifyTitle] = useState('Omerta')

  // Tools state
  const [ipaSearch, setIpaSearch] = useState('')
  const [ipaResults, setIpaResults] = useState(null)
  const [udidInfo, setUdidInfo] = useState(null)
  const [locationInfo, setLocationInfo] = useState(null)

  // Audit
  const [auditReports, setAuditReports] = useState([])

  const udid = device?.udid || device?.serial

  useEffect(() => {
    const r = ft.on('ios:audit:progress', p => setProgress({ pct:p.percent||0, msg:p.message||'' }))
    return () => r()
  }, [])

  const run = async (label, fn) => {
    setLoading(label)
    try { await fn() } catch(e) { addLog(`${label}: ${e.message}`) }
    setLoading(null)
  }

  const getDate = () => run('date', async () => {
    const r = await ft.iosExtra.date.get({ udid }).catch(e => ({ success:false, error:e.message }))
    setDate(r)
    if (!r.success) addLog('Date tool not available: ' + (r.error || 'idevicedate.exe not in bin/'))
    else addLog('Device date: ' + r.date)
  })

  const rename = () => run('rename', async () => {
    const r = await ft.iosExtra.rename({ udid, name: newName })
    addLog(r.success ? 'Renamed to: ' + newName : r.error)
  })

  const pullCrash = () => run('crash', async () => {
    const r = await ft.iosExtra.crash.pull({ udid })
    setCrashFiles(r.files || [])
    addLog(r.success ? `Pulled ${r.files.length} crash reports to ${r.destDir}` : r.error)
  })

  const getBattery = () => run('battery', async () => {
    const r = await ft.iosExtra.battery({ udid })
    setBattery(r)
  })

  const checkUsbmux = () => run('usbmux', async () => {
    const r = await ft.iosExtra.usbmux({ udid })
    setUsbmux(r)
  })

  const checkMdm = () => run('mdm', async () => {
    const r = await ft.iosExtra.mdm({ udid })
    setMdm(r)
  })

  const loadProxies = async () => {
    const list = await ft.iosExtra.proxy.list().catch(()=>[])
    setProxies(list)
  }

  const startProxy = () => run('proxy', async () => {
    const r = await ft.iosExtra.proxy.start({ udid, localPort: parseInt(proxyLocal), devicePort: parseInt(proxyDevice) })
    addLog(r.success ? `Port forward started: localhost:${proxyLocal} -> device:${proxyDevice}` : r.error)
    loadProxies()
  })

  const stopProxy = async (key) => {
    await ft.iosExtra.proxy.stop({ key })
    loadProxies()
  }

  const sendNotify = () => run('notify', async () => {
    const r = await ft.iosExtra.notify({ udid, bundleId: notifyBundle, message: notifyMsg, title: notifyTitle })
    addLog(r.success ? 'Notification sent' : r.error || 'Failed')
  })

  const searchIpa = () => run('ipa', async () => {
    const r = await ft.iosExtra.ipaFind({ appName: ipaSearch })
    setIpaResults(r)
  })

  const getUdidInfo = async () => {
    const r = await ft.iosExtra.udidInfo()
    setUdidInfo(r)
  }

  const getLocationInfo = async () => {
    const r = await ft.iosExtra.location({ udid })
    setLocationInfo(r)
  }

  const runAudit = () => run('audit', async () => {
    setProgress({ pct:0, msg:'Starting...' })
    const r = await ft.iosExtra.audit.generate({ udid })
    addLog(r.success ? 'Audit report: ' + r.path : r.error)
    setAuditReports(r.sections || [])
  })

  const exportData = (type) => run(type, async () => {
    let r
    if (type === 'screentime') r = await ft.iosExtra.screentime({ udid })
    else if (type === 'health')  r = await ft.iosExtra.health({ udid })
    else if (type === 'notes')   r = await ft.iosExtra.notes({ udid })
    if (r?.cancelled) return
    addLog(r.success ? `${type} exported: ` + (r.path || r.destDir) : r.error || 'Failed')
  })

  const isConnected = device?.type === 'ios' || device?.deviceType === 'ios'

  if (!isConnected) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:12, color:'var(--text3)' }}>
      <div style={{ fontSize:40 }}> </div>
      <div style={{ fontSize:16, fontWeight:600, color:'var(--text)' }}>No iPhone connected</div>
      <div style={{ fontSize:13 }}>Connect and trust your iPhone first.</div>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>iOS Tools Hub</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Every iOS tool in one place</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3, flexWrap:'wrap' }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, minWidth:60, padding:'7px 4px', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{label}</button>
        ))}
      </div>

      {tab === 'device' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <Card title="DATE AND TIME" icon=" ">
              <Btn onClick={getDate} disabled={loading==='date'} color="blue" full>{loading==='date'?'Reading...':'Get Device Date/Time'}</Btn>
              {date?.success && <div style={{ marginTop:8, fontFamily:'monospace', fontSize:12, color:'var(--accent)' }}>{date.date}</div>}
              {date?.error && <div style={{ marginTop:6, fontSize:11, color:'#f87171' }}>{date.error}</div>}
            </Card>
            <Card title="RENAME DEVICE" icon="  ">
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="New device name" style={{ width:'100%', marginBottom:8 }} />
              <Btn onClick={rename} disabled={!newName||loading==='rename'} color="accent" full>{loading==='rename'?'Renaming...':'Rename'}</Btn>
            </Card>
            <Card title="BATTERY HEALTH" icon=" ">
              <Btn onClick={getBattery} disabled={loading==='battery'} color="green" full>{loading==='battery'?'Reading...':'Get Battery Detail'}</Btn>
              {battery && <div style={{ marginTop:8 }}>
                <Row label="Level" value={battery.level ? battery.level+'%' : null} />
                <Row label="Health" value={battery.healthPct} />
                <Row label="Cycle Count" value={battery.cycleCount} />
                <Row label="Max Capacity" value={battery.maximumFCC ? battery.maximumFCC+' mAh' : null} />
                <Row label="Design Cap." value={battery.designCapacity ? battery.designCapacity+' mAh' : null} />
                <Row label="Temperature" value={battery.temperature} mono />
                <Row label="Voltage" value={battery.voltage} mono />
              </div>}
            </Card>
            <Card title="CRASH REPORTS" icon=" ">
              <div style={{ display:'flex', gap:6, marginBottom:8 }}>
                <Btn onClick={pullCrash} disabled={loading==='crash'} color="amber">{loading==='crash'?'Pulling...':'Pull Crash Logs'}</Btn>
                <Btn onClick={() => ft.iosExtra.crash.open({})} sm>Open Folder</Btn>
              </div>
              {crashFiles.length > 0 && <div style={{ fontSize:11, color:'var(--text3)' }}>{crashFiles.length} crash logs pulled</div>}
            </Card>
            <Card title="MDM CHECK" icon=" ">
              <Btn onClick={checkMdm} disabled={loading==='mdm'} color="blue" full>{loading==='mdm'?'Checking...':'Check MDM / Profiles'}</Btn>
              {mdm && <div style={{ marginTop:8 }}>
                <div style={{ fontSize:12, fontWeight:600, color: mdm.hasMDM ? '#f87171' : '#4ade80', marginBottom:6 }}>
                  {mdm.hasMDM ? 'MDM Detected' : 'No MDM Detected'}
                </div>
                {mdm.removalOptions?.slice(0,2).map((o,i) => <div key={i} style={{ fontSize:11, color:'var(--text3)', marginBottom:3 }}>{i+1}. {o}</div>)}
              </div>}
            </Card>
            <Card title="USEBMUX STATUS" icon=" ">
              <Btn onClick={checkUsbmux} disabled={loading==='usbmux'} color="blue" full>Check USB Connection</Btn>
              {usbmux && <div style={{ marginTop:8 }}>
                <Row label="Devices found" value={usbmux.count} />
                <Row label="usbmuxd" value={usbmux.usbmuxRunning ? 'Running' : 'Not running'} />
                {usbmux.devices?.map((d,i) => <div key={i} style={{ fontFamily:'monospace', fontSize:10, color:'var(--accent)', padding:'3px 0' }}>{d}</div>)}
              </div>}
            </Card>
          </div>
          <Card title="POWER CONTROLS" icon=" ">
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <Btn onClick={()=>ft.iosExtra.date.get({udid}).then(()=>ft.iosExtra.respring({udid})).catch(e=>addLog(e.message))} color="amber">Respring (Jailbreak)</Btn>
              <Btn onClick={()=>ft.iosExtra.devmode.enable({udid}).then(r=>addLog(r.note||'Done')).catch(e=>addLog(e.message))} color="blue">Enable Dev Mode</Btn>
            </div>
          </Card>
          <Card title="DEVELOPER DISK IMAGE" icon=" ">
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>Mount a developer disk image to enable instruments, debugging, and developer features.</div>
            <div style={{ display:'flex', gap:8 }}>
              <Btn onClick={()=>ft.iosExtra.devdisk.list({udid}).then(r=>addLog(r.output||'No images mounted')).catch(e=>addLog(e.message))} color="blue">List Mounted</Btn>
              <Btn onClick={()=>ft.iosExtra.devdisk.mount({udid}).then(r=>addLog(r.cancelled?'Cancelled':r.success?'Mounted':'Failed: '+r.error)).catch(e=>addLog(e.message))} color="green">Mount Image</Btn>
            </div>
          </Card>
        </div>
      )}

      {tab === 'data' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ padding:12, background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:8, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            All exports work via encrypted backup -- no jailbreak required. Choose a destination folder when prompted.
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {[
              { id:'screentime', title:'Screen Time Data', icon:' ', desc:'Extract Screen Time usage database (SQLite)' },
              { id:'health',     title:'Health Data',      icon:'  ', desc:'Extract Health app database with all metrics' },
              { id:'notes',      title:'Notes',            icon:' ', desc:'Export Notes as SQLite database' },
            ].map(item => (
              <Card key={item.id} title={item.title} icon={item.icon}>
                <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>{item.desc}</div>
                <Btn onClick={() => exportData(item.id)} disabled={loading===item.id} color="blue" full>
                  {loading===item.id ? 'Exporting...' : 'Export'}
                </Btn>
              </Card>
            ))}
            <Card title="CALENDAR" icon=" ">
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>Calendar is stored in Calendar.sqlitedb in backups</div>
              <Btn onClick={() => ft.iosFull.contactsExport({udid}).then(r=>addLog(r.success?'Calendar: '+r.path:r.error)).catch(e=>addLog(e.message))} color="blue" full>Export Calendar DB</Btn>
            </Card>
            <Card title="CONTACTS" icon=" ">
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>Export AddressBook SQLite database</div>
              <Btn onClick={() => ft.iosFull.contactsExport({udid}).then(r=>addLog(r.success?'Contacts: '+r.path:r.error)).catch(e=>addLog(e.message))} color="blue" full>Export Contacts DB</Btn>
            </Card>
            <Card title="MESSAGES / SMS" icon=" ">
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>Export iMessage + SMS as sms.db SQLite</div>
              <Btn onClick={() => ft.iosFull.messagesExport({udid}).then(r=>addLog(r.success?'SMS: '+r.path:r.error||r.note)).catch(e=>addLog(e.message))} color="blue" full>Export Messages</Btn>
            </Card>
            <Card title="PHOTOS" icon="  ">
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>Sync photos to a folder you choose</div>
              <Btn onClick={() => ft.iosFull.photosExport({udid}).then(r=>addLog(r.cancelled?'Cancelled':r.note||r.path)).catch(e=>addLog(e.message))} color="blue" full>Export Photos</Btn>
            </Card>
          </div>
        </div>
      )}

      {tab === 'network' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Card title="USB PORT FORWARDING (iproxy)" icon=" ">
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:10 }}>
              Forward a port from your PC to the iPhone over USB. Essential for SSH, debugging, custom services.
            </div>
            <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center', flexWrap:'wrap' }}>
              <div>
                <div style={{ fontSize:11, color:'var(--text3)', marginBottom:3 }}>Local port</div>
                <input value={proxyLocal} onChange={e=>setProxyLocal(e.target.value)} style={{ width:80 }} />
              </div>
              <div style={{ color:'var(--text3)', alignSelf:'flex-end', marginBottom:8 }}> </div>
              <div>
                <div style={{ fontSize:11, color:'var(--text3)', marginBottom:3 }}>Device port</div>
                <input value={proxyDevice} onChange={e=>setProxyDevice(e.target.value)} style={{ width:80 }} />
              </div>
              <Btn onClick={startProxy} disabled={loading==='proxy'} color="green" style={{ alignSelf:'flex-end' }}>
                {loading==='proxy' ? 'Starting...' : 'Start Forward'}
              </Btn>
              <Btn onClick={loadProxies} sm>Refresh</Btn>
            </div>
            <div style={{ fontSize:11, color:'var(--text3)', marginBottom:8 }}>
              Common: SSH=22, AFC=62078, lockdown=62078, App debug=12345
            </div>
            {proxies.length > 0 && (
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {proxies.map((p,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 10px', background:'var(--bg2)', borderRadius:7, border:'1px solid var(--border)' }}>
                    <span style={{ fontFamily:'monospace', fontSize:12, color:'var(--accent)', flex:1 }}>localhost:{p.localPort}   device:{p.devicePort}</span>
                    <Btn sm color="red" onClick={() => stopProxy(p.key)}>Stop</Btn>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="PUSH NOTIFICATION" icon=" ">
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>Send a notification to any app on the device (requires trusted connection)</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:8 }}>
              <input value={notifyTitle}  onChange={e=>setNotifyTitle(e.target.value)}  placeholder="Title" />
              <input value={notifyMsg}    onChange={e=>setNotifyMsg(e.target.value)}    placeholder="Message" />
              <input value={notifyBundle} onChange={e=>setNotifyBundle(e.target.value)} placeholder="Bundle ID (e.g. com.apple.mobilecal)" />
            </div>
            <Btn onClick={sendNotify} disabled={loading==='notify'} color="accent">
              {loading==='notify' ? 'Sending...' : 'Send Notification'}
            </Btn>
          </Card>

          <Card title="NETWORK INFO" icon=" ">
            <Btn onClick={() => ft.iosFull.networkInfo({udid}).then(r=>addLog(JSON.stringify(r).slice(0,300))).catch(e=>addLog(e.message))} color="blue" full>Get Network Info</Btn>
            <div style={{ marginTop:8, fontSize:12, color:'var(--text3)', lineHeight:1.7 }}>
              Returns Wi-Fi SSID, IP address, carrier, and connection type.
            </div>
          </Card>
        </div>
      )}

      {tab === 'tools' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Card title="IPA VERSION FINDER" icon=" ">
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>Search App Store and get ipatool download commands for specific versions.</div>
            <div style={{ display:'flex', gap:8, marginBottom:10 }}>
              <input value={ipaSearch} onChange={e=>setIpaSearch(e.target.value)} placeholder="App name..." style={{ flex:1 }} />
              <Btn onClick={searchIpa} disabled={loading==='ipa'||!ipaSearch} color="blue">{loading==='ipa'?'Searching...':'Search'}</Btn>
            </div>
            {ipaResults && <>
              {ipaResults.results?.map((r,i) => (
                <div key={i} style={{ padding:'8px 12px', background:'var(--bg2)', borderRadius:7, marginBottom:6, border:'1px solid var(--border)' }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:3 }}>{r.name}</div>
                  <div style={{ fontSize:11, color:'var(--text3)', fontFamily:'monospace' }}>{r.bundleId}   v{r.version}   {r.price}</div>
                  <div style={{ fontSize:11, color:'var(--accent)', marginTop:4, fontFamily:'monospace' }}>
                    ipatool download --bundle-id {r.bundleId} --output ./app.ipa
                  </div>
                </div>
              ))}
              {ipaResults.note && <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.7, padding:'6px 0' }}>{ipaResults.note}</div>}
            </>}
          </Card>

          <Card title="LOCATION SERVICES AUDIT" icon=" ">
            <Btn onClick={getLocationInfo} color="blue" full>Show Location Audit Guide</Btn>
            {locationInfo && (
              <div style={{ marginTop:10 }}>
                <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>{locationInfo.note}</div>
                {locationInfo.steps?.map((s,i) => (
                  <div key={i} style={{ display:'flex', gap:8, marginBottom:6 }}>
                    <span style={{ color:'var(--accent)', fontWeight:700, flexShrink:0 }}>{i+1}.</span>
                    <span style={{ fontSize:12, color:'var(--text2)' }}>{s}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="UDID SPOOFER INFO" icon=" ">
            <Btn onClick={getUdidInfo} color="blue" full>Get Spoofer Info</Btn>
            {udidInfo && (
              <div style={{ marginTop:10 }}>
                <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>{udidInfo.note}</div>
                {udidInfo.methods?.map((m,i) => (
                  <div key={i} style={{ padding:'7px 10px', background:'var(--bg2)', borderRadius:6, marginBottom:4, display:'flex', gap:8, alignItems:'center', border:'1px solid var(--border)' }}>
                    <span style={{ fontSize:18 }}>{m.works ? 'OK' : 'NO'}</span>
                    <div>
                      <div style={{ fontSize:12, fontWeight:600, color: m.works ? '#4ade80' : 'var(--text3)' }}>{m.name}</div>
                      <div style={{ fontSize:11, color:'var(--text3)' }}>{m.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'jailbreak' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            {
              name: 'checkra1n / checkm8', chips: 'A5-A11 (iPhone 4S - iPhone X)', status: 'Active',
              desc: 'Hardware-level exploit. Semi-tethered (re-jailbreak on boot). Supported on: iPhone 5S through iPhone X, iPad Air through iPad 7, iPod Touch 7.',
              tools: ['checkra1n (macOS/Linux)', 'checkn1x (bootable USB)', 'iPwnder'],
              url: 'https://checkra.in'
            },
            {
              name: 'palera1n', chips: 'A8-A16 (some)', status: 'Active',
              desc: 'Modern jailbreak using the checkm8 bootrom exploit for A8-A11 (rootless for A12+). Semi-tethered. Best option for iOS 15-16.',
              tools: ['palera1n CLI', 'Palen1x (bootable ISO)'],
              url: 'https://palera.in'
            },
            {
              name: 'Dopamine', chips: 'A12-A15', status: 'Active',
              desc: 'Rootless semi-untethered jailbreak for iOS 15-16 on A12-A15 devices. Uses CVE exploits. No computer needed after initial install.',
              tools: ['Dopamine IPA', 'TrollStore to install'],
              url: 'https://dopamineapp.com'
            },
            {
              name: 'Unc0ver', chips: 'A12-A14', status: 'Legacy (iOS 11-14)',
              desc: 'Classic jailbreak supporting iOS 11.0 through 14.8. Semi-untethered. Install via AltStore or Cydia Impactor.',
              tools: ['unc0ver IPA', 'AltStore'],
              url: 'https://unc0ver.dev'
            },
            {
              name: 'TrollStore', chips: 'A12+ (specific iOS)', status: 'Active - not a jailbreak',
              desc: 'NOT a jailbreak - permanently signs any IPA with root-level entitlements. Supported on specific iOS versions only. Essential for Dopamine installation.',
              tools: ['TrollInstallerX', 'TrollStore Helper'],
              url: 'https://github.com/opa334/TrollStore'
            },
          ].map((jb, i) => (
            <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14, borderLeft:`3px solid ${jb.status==='Active'?'#4ade80':jb.status.includes('Legacy')?'#f59e0b':'#60a5fa'}` }}>
              <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:8 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--text)', marginBottom:3 }}>{jb.name}</div>
                  <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>{jb.chips}</div>
                  <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, fontWeight:600, background:jb.status==='Active'?'rgba(74,222,128,0.2)':'rgba(245,158,11,0.2)', color:jb.status==='Active'?'#4ade80':'#f59e0b' }}>{jb.status}</span>
                </div>
                <Btn sm color="blue" onClick={() => ft.openUrl(jb.url)}>Website</Btn>
              </div>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>{jb.desc}</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {jb.tools.map((t,j) => <span key={j} style={{ fontSize:10, padding:'2px 8px', borderRadius:4, background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>{t}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'audit' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ padding:12, background:'rgba(74,222,128,0.1)', border:'1px solid rgba(74,222,128,0.2)', borderRadius:8, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            Generate a full device audit report: device info, installed apps, syslog snapshot, battery health, date/time. Saved as JSON.
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={runAudit} disabled={loading==='audit'} color="accent">
              {loading==='audit' ? 'Generating...' : 'Generate Full Audit Report'}
            </Btn>
            <Btn onClick={() => ft.iosExtra.audit.open().then(r=>addLog('Audit folder: '+r.path))} color="blue">Open Reports Folder</Btn>
          </div>
          {loading==='audit' && <Progress pct={progress.pct} msg={progress.msg} />}
          {auditReports.length > 0 && (
            <Card title="LAST REPORT SECTIONS" icon=" ">
              {auditReports.map((s,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                  <span style={{ color:'#4ade80' }}>OK</span>
                  <span style={{ color:'var(--text2)' }}>{s}</span>
                </div>
              ))}
            </Card>
          )}
          <Card title="QUICK DIAGNOSTICS" icon=" ">
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {[
                { label:'Device Info',   fn:()=>ft.iosFull.info({udid}).then(r=>addLog('Info: '+r.name+' iOS '+r.ios)).catch(e=>addLog(e.message)) },
                { label:'Battery',       fn:()=>getBattery() },
                { label:'USB Status',    fn:()=>checkUsbmux() },
                { label:'MDM Check',     fn:()=>checkMdm() },
                { label:'Date/Time',     fn:()=>getDate() },
                { label:'Crash Logs',    fn:()=>pullCrash() },
              ].map((item,i) => (
                <Btn key={i} sm color="blue" onClick={item.fn}>{item.label}</Btn>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
