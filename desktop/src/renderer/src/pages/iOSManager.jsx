import { useState, useEffect } from 'react'

const ft = window.ft

function Btn({ onClick, disabled, color, children, sm }) {
  const bg = color === 'red' ? 'rgba(248,113,113,0.2)' : color === 'green' ? 'rgba(74,222,128,0.2)' : color === 'blue' ? 'rgba(96,165,250,0.2)' : color === 'accent' ? 'var(--accent)' : 'var(--bg3)'
  const col = color === 'red' ? '#f87171' : color === 'green' ? '#4ade80' : color === 'blue' ? '#60a5fa' : color === 'accent' ? '#000' : 'var(--text)'
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding: sm ? '5px 10px' : '7px 14px', borderRadius:7, fontSize: sm ? 11 : 12, fontWeight:600,
        cursor: disabled ? 'not-allowed' : 'pointer', background: bg, color: col,
        border: `1px solid ${col}44`, opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  )
}

function Progress({ pct, msg }) {
  return (
    <div style={{ marginTop:8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text3)', marginBottom:4 }}>
        <span>{msg}</span><span>{pct}%</span>
      </div>
      <div style={{ background:'var(--bg3)', borderRadius:3, height:5, overflow:'hidden' }}>
        <div style={{ width:pct+'%', height:'100%', background: pct===100 ? '#4ade80' : 'var(--accent)', transition:'width 0.3s' }} />
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
      <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:10 }}>{title}</div>
      {children}
    </div>
  )
}

function InfoRow({ label, value, mono }) {
  if (!value && value !== 0) return null
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
      <span style={{ color:'var(--text3)' }}>{label}</span>
      <span style={{ color:'var(--text2)', fontFamily: mono ? 'monospace' : 'inherit' }}>{String(value)}</span>
    </div>
  )
}

export default function iOSManager({ device, addLog }) {
  const [tab, setTab] = useState('overview')
  const [info, setInfo] = useState(null)
  const [apps, setApps] = useState([])
  const [files, setFiles] = useState([])
  const [filePath, setFilePath] = useState('/')
  const [battery, setBattery] = useState(null)
  const [network, setNetwork] = useState(null)
  const [trustResult, setTrustResult] = useState(null)
  const [progress, setProgress] = useState({ pct:0, msg:'' })
  const [loading, setLoading] = useState(false)
  const [appFilter, setAppFilter] = useState('')
  const [screenshot, setScreenshot] = useState(null)
  const [keychainInfo, setKeychainInfo] = useState(null)

  const udid = device?.udid || device?.serial
  const isIos = device?.type === 'ios' || device?.deviceType === 'ios'

  useEffect(() => {
    const r = ft.on('ios:forensics:progress', p => setProgress({ pct:p.percent||0, msg:p.message||'' }))
    return () => r()
  }, [])

  useEffect(() => {
    if (!isIos || !udid) return
    ft.iosFull.info({ udid }).then(setInfo).catch(() => {})
    ft.iosFull.battery({ udid }).then(setBattery).catch(() => {})
  }, [udid, isIos])

  const loadApps = async () => {
    setLoading(true)
    const list = await ft.iosApps.list({ udid }).catch(e => { addLog(e.message); return [] })
    setApps(list)
    setLoading(false)
  }

  const loadFiles = async (path) => {
    setLoading(true)
    setFilePath(path)
    const list = await ft.iosFiles.list({ udid, path }).catch(e => { addLog(e.message); return [] })
    setFiles(list)
    setLoading(false)
  }

  const forceTrust = async () => {
    setLoading(true)
    setTrustResult(null)
    const r = await ft.iosFull.forceTrust({ udid }).catch(e => ({ success:false, message:e.message }))
    setTrustResult(r)
    addLog(r.message || (r.success ? 'Trust established' : 'Trust failed'))
    setLoading(false)
  }

  const takeScreenshot = async () => {
    const r = await ft.iosFull.screenshot({ udid }).catch(e => ({ error:e.message }))
    if (r?.base64) setScreenshot('data:image/png;base64,' + r.base64)
    else addLog('Screenshot failed: ' + (r?.error || 'unknown'))
  }

  const doForensics = async () => {
    setLoading(true)
    setProgress({ pct:0, msg:'Starting...' })
    const r = await ft.iosFull.forensicsExtract({ udid }).catch(e => ({ error:e.message }))
    setLoading(false)
    if (r.success) addLog('Forensic extraction done: ' + r.destDir)
    else addLog('Extraction failed: ' + r.error)
  }

  const exportMessages = async () => {
    setLoading(true)
    const r = await ft.iosFull.messagesExport({ udid }).catch(e => ({ error:e.message }))
    setLoading(false)
    addLog(r.success ? 'Messages exported to: ' + r.path + ' -- open in SQLite Browser' : 'Export failed: ' + (r.error || r.note))
  }

  const exportContacts = async () => {
    setLoading(true)
    const r = await ft.iosFull.contactsExport({ udid }).catch(e => ({ error:e.message }))
    setLoading(false)
    addLog(r.success ? 'Contacts DB exported: ' + r.path : 'Export failed: ' + r.error)
  }

  const TABS = [['overview','Overview'],['apps','Apps'],['files','Files'],['extract','Extract'],['security','Security'],['trust','Trust']]

  if (!isIos) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:12, color:'var(--text3)' }}>
      <span style={{ fontSize:40 }}> </span>
      <div style={{ fontSize:16, fontWeight:600, color:'var(--text)' }}>No iPhone / iPad connected</div>
      <div style={{ fontSize:13 }}>Connect an iOS device and go to iPhone Setup to trust it.</div>
    </div>
  )

  const visApps = apps.filter(a => !appFilter || a.name?.toLowerCase().includes(appFilter.toLowerCase()) || a.pkg?.toLowerCase().includes(appFilter.toLowerCase()))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>{info?.name || device?.name || 'iOS Device'}</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>iOS {info?.ios || device?.ios}   {info?.model || device?.model}   {udid?.slice(0,16)}...</div>
        </div>
        <Btn onClick={takeScreenshot} sm color="blue">Screenshot</Btn>
      </div>

      {screenshot && (
        <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
          <img src={screenshot} style={{ height:200, borderRadius:10, border:'1px solid var(--border)' }} />
          <Btn onClick={() => setScreenshot(null)} sm>Close</Btn>
        </div>
      )}

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:4, flexWrap:'wrap' }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, minWidth:60, padding:'7px 4px', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', background: tab===id ? 'var(--accent)' : 'transparent', color: tab===id ? '#000' : 'var(--text3)', border:'none' }}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {/* Storage bar */}
          {info?.diskPercent != null && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8, fontSize:13, fontWeight:600 }}>
                <span>Storage</span>
                <span style={{ color:'var(--text3)', fontSize:11 }}>{info.usedDiskGb} GB used of {info.totalDiskGb} GB</span>
              </div>
              <div style={{ background:'var(--bg3)', borderRadius:4, height:8, overflow:'hidden' }}>
                <div style={{ width:info.diskPercent+'%', height:'100%', background: info.diskPercent > 85 ? '#f87171' : info.diskPercent > 60 ? '#f59e0b' : '#4ade80', borderRadius:4, transition:'width 0.5s' }} />
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:5, fontSize:10, color:'var(--text3)' }}>
                <span>{info.usedDiskGb} GB used</span>
                <span>{info.freeDiskGb} GB free</span>
              </div>
            </div>
          )}

          {/* Battery quick view */}
          {info?.batteryLevel != null && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 14px', display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Battery</div>
                <div style={{ background:'var(--bg3)', borderRadius:2, height:6, overflow:'hidden', width:'100%' }}>
                  <div style={{ width:info.batteryLevel+'%', height:'100%', background: info.batteryLevel < 20 ? '#f87171' : info.batteryLevel < 50 ? '#f59e0b' : '#4ade80', borderRadius:2 }} />
                </div>
              </div>
              <span style={{ fontSize:18, fontWeight:700, color: info.batteryLevel < 20 ? '#f87171' : '#4ade80', flexShrink:0 }}>{info.batteryLevel}%</span>
              <span style={{ fontSize:11, color:'var(--text3)', flexShrink:0 }}>{info.chargingState}</span>
            </div>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <Section title="Identity">
              <InfoRow label="Name" value={info?.name || device?.name} />
              <InfoRow label="Model" value={info?.modelName} />
              <InfoRow label="Product Type" value={info?.productType} mono />
              <InfoRow label="Color" value={info?.color} />
              <InfoRow label="Region" value={info?.regionInfo} />
              <InfoRow label="Model No." value={info?.modelNumber} mono />
            </Section>
            <Section title="Software">
              <InfoRow label="iOS Version" value={info?.ios || device?.ios} />
              <InfoRow label="Build" value={info?.build} mono />
              <InfoRow label="Firmware" value={info?.firmwareVersion} mono />
              <InfoRow label="Kernel" value={info?.kernelVersion} mono />
              <InfoRow label="Passcode" value={info?.passcodeState} />
              <InfoRow label="Activation" value={info?.activationState} />
            </Section>
            <Section title="Hardware">
              <InfoRow label="Serial" value={info?.serial} mono />
              <InfoRow label="ECID" value={info?.ecid} mono />
              <InfoRow label="CPU Arch" value={info?.cpuArch} mono />
              <InfoRow label="HW Model" value={info?.hardwareModel} mono />
              <InfoRow label="Encryption" value={info?.supportsEncryption} />
              <InfoRow label="NFC" value={info?.nfcCapable} />
            </Section>
            <Section title="Network / Radio">
              <InfoRow label="IMEI" value={info?.imei} mono />
              <InfoRow label="IMEI 2" value={info?.imei2} mono />
              <InfoRow label="MEID" value={info?.meid} mono />
              <InfoRow label="ICCID" value={info?.iccid} mono />
              <InfoRow label="Wi-Fi MAC" value={info?.wifi} mono />
              <InfoRow label="Bluetooth" value={info?.bluetooth} mono />
            </Section>
            <Section title="Carrier">
              <InfoRow label="Carrier" value={info?.carrier} />
              <InfoRow label="Phone No." value={info?.phoneNumber} mono />
              <InfoRow label="SIM Status" value={info?.simStatus} />
              <InfoRow label="Bundle Ver." value={info?.carrierBundleVersion} mono />
            </Section>
            <Section title="Security">
              <InfoRow label="Passcode" value={info?.passcodeState} />
              <InfoRow label="Data Protection" value={info?.dataProtectionClass} />
              <InfoRow label="Security Domain" value={info?.securityDomain} mono />
              <InfoRow label="Obliteration" value={info?.obliterationRequired} />
              <InfoRow label="Encrypted BU" value={info?.supportsEncryption} />
            </Section>
          </div>

          <Section title="UDID">
            <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--accent)', wordBreak:'break-all', padding:'6px 0', userSelect:'all' }}>{udid}</div>
          </Section>

          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <Btn onClick={() => ft.iosFull.networkInfo({ udid }).then(setNetwork).catch(() => {})} color="blue">Load Network Info</Btn>
            <Btn onClick={takeScreenshot} color="blue">Screenshot</Btn>
            <Btn onClick={() => ft.iosFull.info({ udid }).then(setInfo).catch(() => {})} color="blue">Refresh All</Btn>
            <Btn onClick={() => {
              const text = Object.entries(info || {}).filter(([k]) => !k.startsWith('_')).map(([k,v]) => k+': '+v).join(String.fromCharCode(10))
              navigator.clipboard?.writeText(text)
              addLog('Device info copied to clipboard')
            }} sm>Copy All Info</Btn>
          </div>

          {network && (
            <Section title="Network">
              <InfoRow label="SSID" value={network.ssid} />
              <InfoRow label="IP Address" value={network.ip} />
              <InfoRow label="Proxy" value={network.proxy} />
              <InfoRow label="Carrier" value={network.carrier} />
            </Section>
          )}

          {battery && (
            <Section title="Battery Detail">
              <InfoRow label="Level" value={battery.level != null ? battery.level + '%' : null} />
              <InfoRow label="Status" value={battery.status} />
              <InfoRow label="Cycle Count" value={battery.cycleCount} />
              <InfoRow label="Capacity" value={battery.capacity != null ? battery.capacity + ' mAh' : null} />
              <InfoRow label="Health" value={battery.health} />
              <InfoRow label="Temperature" value={battery.temperature != null ? battery.temperature + ' C' : null} />
            </Section>
          )}
        </div>
      )}

      {tab === 'apps' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'flex', gap:8 }}>
            <input value={appFilter} onChange={e => setAppFilter(e.target.value)} placeholder="Filter apps..." style={{ flex:1 }} />
            <Btn onClick={loadApps} disabled={loading}>{loading ? 'Loading...' : 'Load Apps'}</Btn>
          </div>
          {!apps.length && !loading && <div style={{ textAlign:'center', padding:30, color:'var(--text3)' }}>Click Load Apps to list installed applications</div>}
          <div style={{ fontSize:11, color:'var(--text3)' }}>{apps.length > 0 && visApps.length + ' / ' + apps.length + ' apps'}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {visApps.map((app, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--bg2)', borderRadius:7, border:'1px solid var(--border)' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:500, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{app.name || app.pkg}</div>
                  <div style={{ fontSize:10, color:'var(--text3)', fontFamily:'monospace' }}>{app.pkg} {app.version ? '  v'+app.version : ''}</div>
                </div>
                <div style={{ display:'flex', gap:5, flexShrink:0 }}>
                  <Btn sm color="blue" onClick={() => ft.iosApps.extract({ udid, pkg: app.pkg }).then(r => addLog(r.cancelled ? 'Cancelled' : 'IPA extracted')).catch(e => addLog(e.message))}>Extract IPA</Btn>
                  <Btn sm color="red" onClick={() => ft.iosApps.uninstall({ udid, pkg: app.pkg }).then(() => { addLog('Uninstalled: '+app.name); loadApps() }).catch(e => addLog(e.message))}>Uninstall</Btn>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'files' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <div style={{ fontFamily:'monospace', fontSize:12, color:'var(--accent)', flex:1 }}>{filePath}</div>
            {filePath !== '/' && <Btn sm onClick={() => loadFiles(filePath.split('/').slice(0,-1).join('/') || '/')}>Up</Btn>}
            <Btn sm onClick={() => loadFiles(filePath)}>Refresh</Btn>
            <Btn sm color="blue" onClick={() => ft.iosFiles.push({ udid, remotePath: filePath }).then(r => !r.cancelled && loadFiles(filePath)).catch(e => addLog(e.message))}>Push File</Btn>
          </div>
          {!files.length && filePath === '/' && <div style={{ textAlign:'center', padding:20, color:'var(--text3)', fontSize:12 }}>Click Refresh to browse device files (requires AFC access)</div>}
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {files.map((f, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 10px', borderRadius:6, background:'var(--bg2)', cursor:'pointer' }}
                onClick={() => f.isDir && loadFiles(filePath + '/' + f.name)}>
                <span style={{ fontSize:16, flexShrink:0 }}>{f.isDir ? 'D' : 'F'}</span>
                <div style={{ flex:1, fontSize:12, fontFamily:'monospace', color: f.isDir ? 'var(--accent)' : 'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</div>
                <div style={{ fontSize:10, color:'var(--text3)', flexShrink:0 }}>{f.size ? (f.size/1024).toFixed(0)+'KB' : ''}</div>
                {!f.isDir && (
                  <Btn sm onClick={e => { e.stopPropagation(); ft.iosFiles.pull({ udid, remotePath: filePath+'/'+f.name }).then(r => !r.cancelled && addLog('Pulled: '+f.name)).catch(e => addLog(e.message)) }}>Pull</Btn>
                )}
                <Btn sm color="red" onClick={e => { e.stopPropagation(); ft.iosFiles.delete({ udid, path: filePath+'/'+f.name }).then(() => { addLog('Deleted: '+f.name); loadFiles(filePath) }).catch(e => addLog(e.message)) }}>Del</Btn>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'extract' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ padding:12, background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:8, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            Extract data from your iPhone. Full forensic extraction creates a complete backup plus device info, crash logs, app list, syslog, and screenshot.
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {[
              { label:'Full Forensic Extraction', desc:'Device info, backup, apps, logs, screenshot', action: doForensics, color:'accent' },
              { label:'Messages / SMS', desc:'Extract iMessage + SMS database (SQLite)', action: exportMessages, color:'blue' },
              { label:'Contacts', desc:'Extract AddressBook as SQLite database', action: exportContacts, color:'blue' },
              { label:'Photos', desc:'Sync photos to a folder you choose', action: () => ft.iosFull.photosExport({ udid }).then(r => addLog(r.cancelled ? 'Cancelled' : r.note || r.path)).catch(e => addLog(e.message)), color:'blue' },
              { label:'Create Backup', desc:'Full encrypted backup via idevicebackup2', action: () => ft.iosFull.backupCreate({ udid }).then(r => addLog(r.cancelled ? 'Cancelled' : 'Backup created: '+r.path)).catch(e => addLog(e.message)), color:'green' },
              { label:'Restore from Backup', desc:'Restore a previously created backup', action: () => ft.iosFull.backupRestore({ udid }).then(r => addLog(r.cancelled ? 'Cancelled' : 'Restore complete')).catch(e => addLog(e.message)), color:'amber' },
            ].map((item, i) => (
              <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:4 }}>{item.label}</div>
                <div style={{ fontSize:11, color:'var(--text3)', marginBottom:10, lineHeight:1.5 }}>{item.desc}</div>
                <Btn onClick={item.action} disabled={loading} color={item.color}>{loading ? 'Working...' : 'Run'}</Btn>
              </div>
            ))}
          </div>
          {progress.pct > 0 && <Progress pct={progress.pct} msg={progress.msg} />}
        </div>
      )}

      {tab === 'security' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Section title="Privacy Scan">
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>Scan for tracker libraries and suspicious permissions in installed apps.</div>
            <Btn color="blue" onClick={() => ft.iosFull.privacyScan({ udid }).then(r => addLog(JSON.stringify(r).slice(0,200))).catch(e => addLog(e.message))}>Run Privacy Scan</Btn>
          </Section>
          <Section title="Keychain and Password Extraction">
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>Extract stored passwords, tokens, and certificates from the iOS Keychain.</div>
            <div style={{ display:'flex', gap:8, marginBottom:10 }}>
              <Btn color="blue" onClick={() => ft.iosFull.keychainInfo({ udid }).then(setKeychainInfo).catch(e => addLog(e.message))}>Show Methods</Btn>
              <Btn color="accent" onClick={() => ft.iosFull.keychainExtract({ udid }).then(r => addLog(r.success ? 'Extracted: '+r.path : r.note || r.error)).catch(e => addLog(e.message))}>Try Extract</Btn>
            </div>
            {keychainInfo && (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {(keychainInfo.methods || []).map((m, i) => (
                  <div key={i} style={{ background:'var(--bg2)', borderRadius:8, padding:12, borderLeft:'3px solid var(--accent)' }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--text)', marginBottom:6 }}>{m.name}</div>
                    {m.steps.map((s, j) => (
                      <div key={j} style={{ display:'flex', gap:8, marginBottom:4 }}>
                        <span style={{ color:'var(--accent)', fontWeight:700, flexShrink:0 }}>{j+1}.</span>
                        <span style={{ fontSize:11, color:'var(--text2)', lineHeight:1.6 }}>{s}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="Wi-Fi Passwords">
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>Extract saved Wi-Fi passwords (requires jailbreak or encrypted backup).</div>
            <Btn color="blue" onClick={() => ft.iosFull.wifiExtract({ udid }).then(r => addLog(r.success ? 'Extracted' : (r.note || r.error))).catch(e => addLog(e.message))}>Extract Wi-Fi Passwords</Btn>
          </Section>
        </div>
      )}

      {tab === 'trust' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Section title="Force Trust">
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:10 }}>
              Sends a pairing request using multiple methods simultaneously. Have your iPhone unlocked and nearby -- a Trust popup will appear on the screen.
            </div>
            <div style={{ display:'flex', gap:8, marginBottom:10 }}>
              <Btn color="accent" onClick={forceTrust} disabled={loading}>{loading ? 'Trying...' : 'Force Trust (All Methods)'}</Btn>
              <Btn color="blue" onClick={() => ft.iosUnlock.enterRecovery({ udid }).then(r => addLog(r.note || (r.success ? 'Entering recovery' : r.error))).catch(e => addLog(e.message))}>Enter Recovery</Btn>
              <Btn color="green" onClick={() => ft.iosUnlock.exitRecovery({}).then(() => addLog('Exiting recovery')).catch(e => addLog(e.message))}>Exit Recovery</Btn>
            </div>
            {trustResult && (
              <div style={{ padding:12, borderRadius:8, background: trustResult.success ? 'rgba(74,222,128,0.1)' : trustResult.needsTap ? 'rgba(245,158,11,0.1)' : 'rgba(248,113,113,0.1)', border:'1px solid ' + (trustResult.success ? 'rgba(74,222,128,0.3)' : trustResult.needsTap ? 'rgba(245,158,11,0.3)' : 'rgba(248,113,113,0.3)') }}>
                <div style={{ fontSize:13, fontWeight:600, color: trustResult.success ? '#4ade80' : trustResult.needsTap ? '#f59e0b' : '#f87171', marginBottom:8 }}>
                  {trustResult.success ? 'Trust established' : trustResult.needsTap ? 'Tap Trust on your iPhone now' : 'Trust failed'}
                </div>
                <div style={{ fontSize:12, color:'var(--text2)', marginBottom:8 }}>{trustResult.message}</div>
                {(trustResult.results || []).map((r, i) => (
                  <div key={i} style={{ fontSize:11, color: r.success ? '#4ade80' : '#888', fontFamily:'monospace', marginBottom:2 }}>
                    {r.success ? 'OK' : '--'} {r.method}: {r.output?.slice(0,60) || r.error || ''}
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="Pairing Status">
            <Btn color="blue" onClick={() => ft.iosFull.info({ udid }).then(r => addLog('Device accessible: '+r.name)).catch(() => addLog('Device not accessible - not trusted'))}>Check Trust Status</Btn>
            <div style={{ marginTop:10, fontSize:12, color:'var(--text3)', lineHeight:1.8 }}>
              If trust keeps failing:<br/>
              1. Lock the iPhone and unlock it again with cable plugged in<br/>
              2. Settings &gt; General &gt; Transfer or Reset &gt; Reset &gt; Reset Location and Privacy<br/>
              3. Try a different USB port or cable<br/>
              4. Restart Apple Mobile Device Service: services.msc &gt; Apple Mobile Device Service &gt; Restart
            </div>
          </Section>
        </div>
      )}
    </div>
  )
}
