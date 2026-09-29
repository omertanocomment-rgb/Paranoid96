import { useState, useEffect, useRef } from 'react'
const ft = window.ft

function Btn({ children, onClick, color, disabled, sm }) {
  const s = { accent:{bg:'var(--accent)',fg:'#000',bd:'transparent'}, green:{bg:'rgba(74,222,128,0.15)',fg:'#4ade80',bd:'rgba(74,222,128,0.3)'}, blue:{bg:'rgba(96,165,250,0.15)',fg:'#60a5fa',bd:'rgba(96,165,250,0.3)'}, red:{bg:'rgba(248,113,113,0.15)',fg:'#f87171',bd:'rgba(248,113,113,0.3)'}, amber:{bg:'rgba(245,158,11,0.15)',fg:'#f59e0b',bd:'rgba(245,158,11,0.3)'}, purple:{bg:'rgba(167,139,250,0.15)',fg:'#a78bfa',bd:'rgba(167,139,250,0.3)'} }
  const c = s[color] || {bg:'var(--bg3)',fg:'var(--text)',bd:'var(--border)'}
  return <button onClick={onClick} disabled={disabled} style={{ padding:sm?'5px 10px':'7px 14px', borderRadius:7, fontSize:sm?11:12, fontWeight:600, cursor:disabled?'not-allowed':'pointer', background:c.bg, color:c.fg, border:`1px solid ${c.bd}`, opacity:disabled?0.5:1, whiteSpace:'nowrap' }}>{children}</button>
}

function Card({ title, icon, children, color }) {
  return <div style={{ background:'var(--bg1)', border:`1px solid ${color||'var(--border)'}33`, borderRadius:10, padding:14, borderLeft:`3px solid ${color||'var(--border)'}` }}>
    {title && <div style={{ fontSize:11, fontWeight:700, color:color||'var(--text3)', letterSpacing:'0.06em', marginBottom:10 }}>{icon&&<span style={{marginRight:6}}>{icon}</span>}{title}</div>}
    {children}
  </div>
}

function Row({ label, value, mono, color }) {
  if (!value && value!==0) return null
  return <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
    <span style={{ color:'var(--text3)' }}>{label}</span>
    <span style={{ color:color||'var(--text2)', fontFamily:mono?'monospace':'inherit', fontSize:mono?11:12 }}>{String(value)}</span>
  </div>
}

function Progress({ pct, msg }) {
  return <div style={{ marginTop:6 }}>
    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text3)', marginBottom:3 }}><span>{msg}</span><span>{pct}%</span></div>
    <div style={{ height:5, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}><div style={{ height:'100%', width:Math.min(pct,100)+'%', background:pct>=100?'#4ade80':'var(--accent)', transition:'width 0.3s' }} /></div>
  </div>
}

const TABS = [['apps','Apps'],['system','System'],['syslog','Syslog'],['ssh','SSH/Frida'],['profiles','Profiles'],['icloud','iCloud'],['power','Power'],['screenshots','Screenshots']]

export default function iOSAdvanced({ device, addLog }) {
  const [tab, setTab] = useState('apps')
  const [apps, setApps] = useState([])
  const [activation, setActivation] = useState(null)
  const [sysinfo, setSysinfo] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [mdmStatus, setMdmStatus] = useState(null)
  const [icloudInfo, setIcloudInfo] = useState(null)
  const [syslogLines, setSyslogLines] = useState([])
  const [syslogRunning, setSyslogRunning] = useState(false)
  const [syslogFilter, setSyslogFilter] = useState('')
  const [screenshots, setScreenshots] = useState([])
  const [loading, setLoading] = useState(null)
  const [progress, setProgress] = useState({ pct:0, msg:'' })
  const [sshActive, setSshActive] = useState(false)
  const syslogRef = useRef(null)
  const udid = device?.udid || device?.serial
  const isIos = device?.deviceType === 'ios' || device?.type === 'ios'

  useEffect(() => {
    const u1 = ft.on('ios:ext:progress', p => setProgress({ pct:p.percent||p.pct||50, msg:p.message||p.msg||'' }))
    const u2 = ft.on('ios:syslog:line', d => { setSyslogLines(prev => [...prev.slice(-500), d.line]); if(syslogRef.current) syslogRef.current.scrollTop=syslogRef.current.scrollHeight })
    return () => { u1(); u2() }
  }, [])

  const run = async (label, fn) => { setLoading(label); try { await fn() } catch(e) { addLog(label+' error: '+e.message) } setLoading(null) }

  const loadApps = () => run('apps', async () => {
    const r = await ft.iosExt.apps.detail({ udid }).catch(e=>({error:e.message}))
    if (r.success) { setApps(r.apps||[]); addLog(`${r.count} apps loaded`) } else addLog('Error: '+(r.error||'failed'))
  })
  const loadActivation = () => run('activation', async () => { const r = await ft.iosExt.activation({udid}).catch(e=>({error:e.message})); if(r.success) setActivation(r); else addLog('Error: '+(r.error||'failed')) })
  const loadSysinfo = () => run('sysinfo', async () => { const r = await ft.iosExt.sysinfo({udid}).catch(e=>({error:e.message})); if(r.success) setSysinfo(r.domains); else addLog('Error: '+(r.error||'failed')) })
  const loadProfiles = () => run('profiles', async () => { const r = await ft.iosExt.profiles.list({udid}).catch(e=>({error:e.message})); if(r.success) setProfiles(r.profiles||[]); else addLog('Profiles: '+(r.error||'failed')) })
  const startSyslog = async () => { const r = await ft.iosExt.syslog.start({udid,filter:syslogFilter}).catch(e=>({error:e.message})); if(r.success) { setSyslogRunning(true); addLog('Syslog started') } else addLog('Syslog error: '+(r.error||'failed')) }
  const stopSyslog = async () => { await ft.iosExt.syslog.stop(); setSyslogRunning(false); addLog('Syslog stopped') }
  const takeScreenshot = () => run('screenshot', async () => { const r = await ft.iosExt.screenshot.take({udid}).catch(e=>({error:e.message})); if(r.success) { setScreenshots(prev=>[r.path,...prev]); addLog('Screenshot: '+r.path) } else addLog('Screenshot error: '+r.error) })
  const connectSsh = async () => { const r = await ft.iosExt.ssh.connect({udid}).catch(e=>({error:e.message})); if(r.success){setSshActive(true);addLog(r.note)} else addLog('SSH error: '+(r.error||'failed')) }
  const disconnectSsh = async () => { await ft.iosExt.ssh.disconnect(); setSshActive(false); addLog('SSH proxy stopped') }

  if (!isIos) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', flexDirection:'column', gap:10, color:'var(--text3)' }}><div style={{ fontSize:40 }}>📱</div><div style={{ fontSize:15, fontWeight:600, color:'var(--text)' }}>Connect an iPhone or iPad</div></div>

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:22 }}>🔬</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:18, fontWeight:700, color:'var(--text)' }}>iOS Advanced Tools</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Apps, system info, syslog, SSH, profiles, power</div>
        </div>
        {device && <div style={{ fontSize:11, padding:'3px 8px', background:'rgba(96,165,250,0.15)', borderRadius:5, color:'#60a5fa' }}>{device.name||device.model||udid?.slice(0,12)}</div>}
      </div>

      <div style={{ display:'flex', gap:2, background:'var(--bg2)', borderRadius:9, padding:3, flexWrap:'wrap' }}>
        {TABS.map(([id,l]) => <button key={id} onClick={() => setTab(id)} style={{ flex:1, minWidth:70, padding:'6px 4px', borderRadius:7, fontSize:10, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>)}
      </div>

      {tab === 'apps' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            <Btn onClick={loadApps} disabled={loading==='apps'} color="blue">{loading==='apps'?'Loading...':'Load Installed Apps'}</Btn>
            <Btn onClick={() => ft.iosExt.apps.installIpa({udid}).then(r=>addLog(r.cancelled?'Cancelled':r.success?'Installed':'Failed')).catch(e=>addLog(e.message))} color="accent">Install IPA</Btn>
            <Btn onClick={() => ft.iosExt.apps.backupData({udid}).then(r=>r.cancelled?null:addLog(r.success?'Backed up to: '+r.dest:'Backup failed')).catch(e=>addLog(e.message))} color="green">Backup App Data</Btn>
          </div>
          {apps.length > 0 && <div style={{ fontSize:11, color:'var(--text3)' }}>{apps.length} apps installed</div>}
          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
            {apps.slice(0,100).map((a,i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', background:'var(--bg1)', borderRadius:7, border:'1px solid var(--border)', fontSize:11 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.name||a.bundleId}</div>
                  <div style={{ color:'var(--text3)', fontFamily:'monospace', fontSize:10, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.bundleId}</div>
                </div>
                <span style={{ color:'var(--text3)', fontSize:10, flexShrink:0 }}>v{a.version}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'system' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            <Btn onClick={loadActivation} disabled={loading==='activation'} color="blue">{loading==='activation'?'...':'Load Activation Info'}</Btn>
            <Btn onClick={loadSysinfo} disabled={loading==='sysinfo'} color="blue">{loading==='sysinfo'?'...':'Deep System Info'}</Btn>
          </div>
          {activation && <Card title="DEVICE STATUS" icon="📱" color="#60a5fa">
            <Row label="Device Name" value={activation.deviceName} />
            <Row label="Serial" value={activation.serialNumber} mono />
            <Row label="IMEI" value={activation.imei} mono />
            <Row label="Activation" value={activation.activationState} color={activation.activationState==='Activated'?'#4ade80':'#f87171'} />
            <Row label="Find My" value={activation.findMyEnabled?'Enabled':'Disabled'} color={activation.findMyEnabled?'#f59e0b':'#4ade80'} />
            <Row label="iCloud Locked" value={activation.icloudLocked?'YES':'No'} color={activation.icloudLocked?'#f87171':'#4ade80'} />
          </Card>}
          {sysinfo && Object.entries(sysinfo).slice(0,4).map(([domain,content],i) => (
            <Card key={i} title={domain.split('.').pop().toUpperCase()} color="#60a5fa">
              <pre style={{ fontFamily:'monospace', fontSize:10, color:'var(--text2)', whiteSpace:'pre-wrap', wordBreak:'break-all', maxHeight:100, overflowY:'auto', margin:0 }}>{content.slice(0,500)}</pre>
            </Card>
          ))}
        </div>
      )}

      {tab === 'syslog' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8, height:'100%' }}>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            <input value={syslogFilter} onChange={e=>setSyslogFilter(e.target.value)} placeholder="Filter (e.g. SpringBoard)" style={{ flex:1, fontSize:12 }} />
            {!syslogRunning ? <Btn onClick={startSyslog} color="green">Start Syslog</Btn> : <Btn onClick={stopSyslog} color="red">Stop</Btn>}
            <Btn sm onClick={() => setSyslogLines([])} color="amber">Clear</Btn>
          </div>
          {syslogRunning && <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'#4ade80' }}><div style={{ width:7, height:7, borderRadius:'50%', background:'#4ade80' }} />Streaming live... {syslogLines.length} lines</div>}
          <div ref={syslogRef} style={{ flex:1, fontFamily:'monospace', fontSize:10, background:'#0a0a0a', border:'1px solid var(--border)', borderRadius:8, padding:10, overflowY:'auto', color:'#d4d4d4', lineHeight:1.7, whiteSpace:'pre-wrap', wordBreak:'break-all', minHeight:200 }}>
            {syslogLines.filter(l=>!syslogFilter||l.toLowerCase().includes(syslogFilter.toLowerCase())).slice(-200).join('')||'No logs yet. Start syslog and interact with the device.'}
          </div>
        </div>
      )}

      {tab === 'ssh' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Card title="SSH OVER USB (iproxy)" icon="🔌" color="#4ade80">
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:10 }}>
              Tunnel SSH through USB — no WiFi needed. Requires OpenSSH installed on device (via Cydia/Sileo).
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
              {!sshActive ? <Btn onClick={connectSsh} color="green">Start USB Proxy (port 2222)</Btn> : <Btn onClick={disconnectSsh} color="red">Stop Proxy</Btn>}
              {sshActive && <Btn onClick={() => ft.iosExt.ssh.openTerminal().then(r=>addLog(r.note)).catch(e=>addLog(e.message))} color="accent">Open SSH Terminal</Btn>}
            </div>
            {sshActive && <div style={{ padding:'7px 10px', background:'rgba(74,222,128,0.1)', borderRadius:6, border:'1px solid rgba(74,222,128,0.3)', fontSize:11, color:'#4ade80' }}>
              Proxy active: ssh root@localhost -p 2222 (password: alpine)
            </div>}
            <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--accent)', padding:'6px 8px', background:'var(--bg2)', borderRadius:5, marginTop:8 }}>ssh root@localhost -p 2222</div>
          </Card>
          <Card title="FRIDA DYNAMIC INSTRUMENTATION" icon="🔬" color="#a78bfa">
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:10 }}>
              Hook into any app, trace function calls, bypass protections. Requires frida-server on device (Cydia: add repo.frida.re).
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <Btn onClick={() => ft.iosExt.frida.check({udid}).then(r=>addLog(r.success?'Frida OK: '+r.note:r.error)).catch(e=>addLog(e.message))} color="purple" sm>Check Frida</Btn>
              <Btn onClick={() => ft.iosExt.frida.listApps({udid}).then(r=>addLog(r.output?.slice(0,200)||r.error)).catch(e=>addLog(e.message))} color="purple" sm>List Apps</Btn>
              <Btn onClick={() => ft.openUrl('https://frida.re/docs/ios/')} color="purple" sm>Frida iOS Docs</Btn>
            </div>
            <div style={{ marginTop:10, fontFamily:'monospace', fontSize:10, color:'#d4d4d4', background:'#0a0a0a', borderRadius:6, padding:'8px 10px', lineHeight:2 }}>
              {['frida -U -l script.js -n SpringBoard','frida-trace -U -i "open" -n SpringBoard','frida -U --codeshare mrmacete/osx-find-app-name'].join(String.fromCharCode(10))}
            </div>
          </Card>
        </div>
      )}

      {tab === 'profiles' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={loadProfiles} disabled={loading==='profiles'} color="blue">{loading==='profiles'?'Loading...':'List Profiles'}</Btn>
            <Btn onClick={() => ft.iosExtra.mdm({udid}).then(setMdmStatus).catch(e=>addLog(e.message))} color="purple">Check MDM Enrollment</Btn>
          </div>
          {mdmStatus && (
            <div style={{ padding:'8px 10px', borderRadius:6, background: mdmStatus.enrolled?'rgba(245,158,11,0.1)':'rgba(74,222,128,0.1)', border:`1px solid ${mdmStatus.enrolled?'rgba(245,158,11,0.3)':'rgba(74,222,128,0.3)'}`, fontSize:12, color: mdmStatus.enrolled?'#f59e0b':'#4ade80' }}>
              {mdmStatus.note}
            </div>
          )}
          <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.7 }}>Provisioning profiles and configuration profiles installed on the device.</div>
          {profiles.length > 0 ? profiles.map((p,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', background:'var(--bg1)', borderRadius:8, border:'1px solid var(--border)' }}>
              <div style={{ flex:1, color:'var(--text2)', fontFamily:'monospace', fontSize:11, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p}</div>
              <Btn sm color="red" onClick={() => ft.iosExt.profiles.remove({udid,profileId:p}).then(r=>{ addLog(r.success?'Removed: '+p:'Error: '+r.error); loadProfiles() }).catch(e=>addLog(e.message))}>Remove</Btn>
            </div>
          )) : <div style={{ textAlign:'center', padding:20, color:'var(--text3)' }}>Click List Profiles to load.</div>}
          <Card title="CONFIGURATION PROFILE NOTE" color="#f59e0b">
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
              Settings &gt; General &gt; VPN &amp; Device Management shows all installed profiles. MDM profiles from schools/work can be removed here if you are the device owner.
            </div>
          </Card>
        </div>
      )}

      {tab === 'icloud' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Btn onClick={() => ft.iosExt.activation({udid}).then(r=>{ setActivation(r); setTab('icloud') }).catch(e=>addLog(e.message))} color="blue">Check iCloud Lock Status</Btn>
          {activation && <Card title="iCLOUD STATUS" color={activation.icloudLocked?'#f87171':'#4ade80'}>
            <Row label="iCloud Locked" value={activation.icloudLocked?'YES - Activation Lock Active':'No lock detected'} color={activation.icloudLocked?'#f87171':'#4ade80'} />
            <Row label="Find My" value={activation.findMyEnabled?'Enabled':'Disabled'} />
            <Row label="Activation" value={activation.activationState} />
          </Card>}
          <Btn onClick={() => ft.iosExt.icloud().then(r=>setIcloudInfo(r))} color="amber">Show Bypass Methods</Btn>
          {icloudInfo && (
            <>
              <div style={{ padding:10, background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, fontSize:12, color:'#f87171' }}>{icloudInfo.warning}</div>
              {icloudInfo.methods?.map((m,i) => (
                <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:9, padding:'10px 14px', borderLeft:`3px solid ${m.difficulty==='Easy'?'#4ade80':m.difficulty==='Medium'?'#f59e0b':'#f87171'}` }}>
                  <div style={{ display:'flex', gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:600, color:'var(--text)', flex:1 }}>{m.name}</span>
                    <span style={{ fontSize:10, padding:'2px 6px', borderRadius:4, background:'var(--bg3)', color:'var(--text3)' }}>{m.works}</span>
                    <span style={{ fontSize:10, padding:'2px 6px', borderRadius:4, background:m.difficulty==='Easy'?'rgba(74,222,128,0.15)':m.difficulty==='Medium'?'rgba(245,158,11,0.15)':'rgba(248,113,113,0.15)', color:m.difficulty==='Easy'?'#4ade80':m.difficulty==='Medium'?'#f59e0b':'#f87171', fontWeight:700 }}>{m.difficulty}</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--text3)' }}>{m.desc}</div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'power' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Card title="POWER CONTROLS" icon="⚡" color="#f59e0b">
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <Btn onClick={() => ft.iosExt.power.restart({udid}).then(()=>addLog('Restarting...')).catch(e=>addLog(e.message))} color="amber">Restart</Btn>
              <Btn onClick={() => ft.iosExt.power.shutdown({udid}).then(()=>addLog('Shutting down...')).catch(e=>addLog(e.message))} color="red">Shutdown</Btn>
              <Btn onClick={() => ft.iosExt.power.sleep({udid}).then(()=>addLog('Sleep sent')).catch(e=>addLog(e.message))} color="blue">Sleep</Btn>
            </div>
          </Card>
          <Card title="RECOVERY MODE" icon="🔄" color="#a78bfa">
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:8 }}>Enter recovery mode for restores, updates, and DFU operations.</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <Btn onClick={() => ft.nand.ios.enterRecovery({udid}).then(r=>addLog(r.success?'Entering recovery...':r.error)).catch(e=>addLog(e.message))} color="amber">Enter Recovery</Btn>
              <Btn onClick={() => ft.nand.ios.exitRecovery({udid}).then(r=>addLog(r.success?'Exiting recovery...':r.error)).catch(e=>addLog(e.message))} color="green">Exit Recovery</Btn>
            </div>
          </Card>
          <Card title="BACKUP" icon="💾" color="#4ade80">
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:8 }}>Full encrypted backup via idevicebackup2.</div>
            <Btn onClick={() => ft.nand.ios.backupFull({udid}).then(r=>r.cancelled?null:addLog(r.success?'Backup done: '+r.dest:'Failed: '+r.error)).catch(e=>addLog(e.message))} color="green">Full Backup</Btn>
          </Card>
        </div>
      )}

      {tab === 'screenshots' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <Btn onClick={takeScreenshot} disabled={loading==='screenshot'} color="accent">{loading==='screenshot'?'Taking...':'Take Screenshot'}</Btn>
            <Btn onClick={() => ft.iosExt.screenshot.openFolder().then(r=>addLog(`${r.count} screenshots in ${r.path}`)).catch(e=>addLog(e.message))} color="blue">Open Folder</Btn>
          </div>
          {screenshots.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {screenshots.slice(0,10).map((p,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 10px', background:'var(--bg1)', borderRadius:7, border:'1px solid var(--border)', fontSize:12 }}>
                  <span style={{ color:'var(--text3)' }}>{i+1}.</span>
                  <span style={{ color:'var(--text2)', fontFamily:'monospace', fontSize:10, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p}</span>
                </div>
              ))}
            </div>
          )}
          {!screenshots.length && <div style={{ textAlign:'center', padding:24, color:'var(--text3)' }}>Click Take Screenshot to capture the device screen.</div>}
        </div>
      )}
    </div>
  )
}
