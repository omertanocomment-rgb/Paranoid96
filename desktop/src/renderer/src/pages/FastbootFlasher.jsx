import { useState, useEffect, useRef } from 'react'
const ft = window.ft

const PARTITIONS = [
  { name:'boot',       desc:'Boot image - kernel + ramdisk',            risk:'medium', color:'#f59e0b' },
  { name:'recovery',   desc:'Recovery partition (TWRP etc)',             risk:'low',    color:'#4ade80' },
  { name:'system',     desc:'Main Android OS partition',                 risk:'high',   color:'#f87171' },
  { name:'vendor',     desc:'Vendor blobs and drivers',                  risk:'high',   color:'#f87171' },
  { name:'dtbo',       desc:'Device tree blob overlay',                  risk:'medium', color:'#f59e0b' },
  { name:'vbmeta',     desc:'Verified boot metadata',                    risk:'high',   color:'#f87171' },
  { name:'bootloader', desc:'Bootloader/UEFI firmware',                  risk:'critical',color:'#ef4444'},
  { name:'radio',      desc:'Modem/baseband firmware',                   risk:'high',   color:'#f87171' },
  { name:'cache',      desc:'Cache partition (safe to wipe)',             risk:'low',    color:'#4ade80' },
  { name:'userdata',   desc:'User data (wipes everything)',               risk:'high',   color:'#f87171' },
  { name:'super',      desc:'Dynamic partition container (A/B devices)', risk:'high',   color:'#f87171' },
  { name:'product',    desc:'Product partition (Android 10+)',            risk:'medium', color:'#f59e0b' },
]

const RISK_COLORS = { low:'#4ade80', medium:'#f59e0b', high:'#f87171', critical:'#ef4444' }

export default function FastbootFlasher({ device, addLog }) {
  const [fbDevices, setFbDevices] = useState([])
  const [vars, setVars] = useState({})
  const [partition, setPartition] = useState('boot')
  const [logs, setLogs] = useState([])
  const [running, setRunning] = useState(false)
  const [customCmd, setCustomCmd] = useState('')
  const [tab, setTab] = useState('flash')
  const logRef = useRef(null)

  useEffect(() => {
    const unsub = ft.on('fastboot:progress', d => {
      setLogs(prev => [...prev.slice(-200), d.message])
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })
    return () => unsub()
  }, [])

  const scanDevices = async () => {
    const r = await ft.fastboot.devices().catch(() => ({ devices:[] }))
    setFbDevices(r.devices || [])
    if (!r.devices?.length) addLog('No fastboot devices found. Boot device to fastboot mode first.')
    else addLog(`Found ${r.devices.length} fastboot device(s)`)
  }

  const getVars = async () => {
    const serial = fbDevices[0]?.serial
    const r = await ft.fastboot.getvar({ serial }).catch(e => ({ error: e.message }))
    if (r.vars) setVars(r.vars)
    addLog('Variables loaded')
  }

  const flash = async () => {
    const selected = PARTITIONS.find(p => p.name === partition)
    if (selected?.risk === 'critical') {
      if (!window.confirm(`WARNING: Flashing ${partition} can brick your device. Continue?`)) return
    }
    setRunning(true)
    setLogs([])
    const serial = fbDevices[0]?.serial
    const r = await ft.fastboot.flash({ serial, partition }).catch(e => ({ error: e.message }))
    if (r.cancelled) { setRunning(false); return }
    addLog(r.success ? `Flashed ${partition} successfully` : `Flash failed: ${r.error}`)
    setRunning(false)
  }

  const runCmd = async (args) => {
    setRunning(true)
    const serial = fbDevices[0]?.serial
    const r = await ft.fastboot.command({ serial, args: args.split(' ') }).catch(e => ({ error: e.message }))
    setLogs(prev => [...prev, ...(r.output || r.error || '').split(String.fromCharCode(10)).filter(Boolean)])
    addLog(r.success ? 'Done' : r.error)
    setRunning(false)
  }

  const reboot = (mode) => ft.fastboot.reboot({ serial: fbDevices[0]?.serial, mode }).then(() => addLog('Rebooting: ' + mode)).catch(e => addLog(e.message))

  const sel = PARTITIONS.find(p => p.name === partition)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Fastboot Flasher</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Flash partitions, run fastboot commands, manage bootloader</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3 }}>
        {[['flash','Flash'],['vars','Variables'],['cmds','Commands'],['guide','Guide']].map(([id,l]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'7px 4px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, alignItems:'center', background:'var(--bg1)', borderRadius:8, padding:'10px 14px', border:'1px solid var(--border)' }}>
        <div style={{ flex:1, fontSize:12, color:'var(--text3)' }}>
          {fbDevices.length === 0 ? 'No fastboot devices detected' : fbDevices.map(d => d.serial).join(', ')}
        </div>
        <button onClick={scanDevices} style={{ padding:'6px 14px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Scan</button>
        {fbDevices.length > 0 && (
          <>
            <button onClick={() => reboot('normal')} style={{ padding:'6px 12px', borderRadius:6, fontSize:11, cursor:'pointer', background:'rgba(74,222,128,0.15)', color:'#4ade80', border:'1px solid rgba(74,222,128,0.3)' }}>Reboot System</button>
            <button onClick={() => reboot('recovery')} style={{ padding:'6px 12px', borderRadius:6, fontSize:11, cursor:'pointer', background:'rgba(245,158,11,0.15)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.3)' }}>Reboot Recovery</button>
          </>
        )}
      </div>

      {tab === 'flash' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ fontSize:12, color:'var(--text3)', background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, padding:10 }}>
            Warning: Incorrect flashing can brick your device. Only flash images built for your exact device model.
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            {PARTITIONS.map(p => (
              <button key={p.name} onClick={() => setPartition(p.name)}
                style={{ padding:'10px 12px', borderRadius:8, cursor:'pointer', textAlign:'left', background: partition===p.name ? `${RISK_COLORS[p.risk]}22` : 'var(--bg1)', border:`1px solid ${partition===p.name ? RISK_COLORS[p.risk] : 'var(--border)'}`, transition:'all 0.15s' }}>
                <div style={{ fontSize:12, fontWeight:700, color: partition===p.name ? RISK_COLORS[p.risk] : 'var(--text)' }}>{p.name}</div>
                <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>{p.desc}</div>
                <div style={{ fontSize:9, fontWeight:700, color:RISK_COLORS[p.risk], marginTop:3, textTransform:'uppercase' }}>Risk: {p.risk}</div>
              </button>
            ))}
          </div>
          <button onClick={flash} disabled={running || !fbDevices.length}
            style={{ padding:'10px', borderRadius:8, fontSize:13, fontWeight:700, cursor:running||!fbDevices.length?'not-allowed':'pointer', background: sel ? RISK_COLORS[sel.risk]+'22' : 'var(--accent)', color: sel ? RISK_COLORS[sel.risk] : '#000', border:`1px solid ${sel ? RISK_COLORS[sel.risk]+'66' : 'transparent'}`, opacity:!fbDevices.length?0.5:1 }}>
            {running ? 'Flashing...' : `Flash ${partition} partition`}
          </button>
          {logs.length > 0 && (
            <div ref={logRef} style={{ fontFamily:'monospace', fontSize:11, background:'#0a0a0a', border:'1px solid var(--border)', borderRadius:8, padding:10, maxHeight:200, overflowY:'auto', color:'#d4d4d4', lineHeight:1.8, whiteSpace:'pre-wrap' }}>
              {logs.join(String.fromCharCode(10))}
            </div>
          )}
        </div>
      )}

      {tab === 'vars' && (
        <div>
          <button onClick={getVars} disabled={!fbDevices.length} style={{ marginBottom:10, padding:'7px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Load Variables</button>
          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
            {Object.entries(vars).map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:'var(--bg1)', borderRadius:6, fontSize:12, border:'1px solid var(--border)' }}>
                <span style={{ color:'var(--text3)', fontFamily:'monospace' }}>{k}</span>
                <span style={{ color:'var(--accent)', fontFamily:'monospace' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'cmds' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', gap:8 }}>
            <input value={customCmd} onChange={e => setCustomCmd(e.target.value)} onKeyDown={e => e.key==='Enter' && runCmd(customCmd)}
              placeholder="fastboot command (e.g. oem unlock)" style={{ flex:1, fontFamily:'monospace', fontSize:12 }} />
            <button onClick={() => runCmd(customCmd)} disabled={running} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Run</button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            {[
              ['oem unlock','Unlock bootloader (wipes data)','#f87171'],
              ['oem lock','Re-lock bootloader','#f87171'],
              ['flashing unlock','Unlock (A/B devices)','#f87171'],
              ['flashing lock','Re-lock (A/B devices)','#f87171'],
              ['format userdata','Wipe all user data','#f87171'],
              ['erase cache','Wipe cache partition','#4ade80'],
              ['getvar all','Get all device variables','#60a5fa'],
              ['devices','List fastboot devices','#60a5fa'],
              ['reboot','Reboot to system','#4ade80'],
              ['reboot recovery','Reboot to recovery','#f59e0b'],
              ['reboot-bootloader','Stay in fastboot','#f59e0b'],
              ['set_active a','Set slot A active (A/B)','#a78bfa'],
              ['set_active b','Set slot B active (A/B)','#a78bfa'],
              ['reboot fastboot','Reboot to fastbootd','#a78bfa'],
            ].map(([c,desc,color]) => (
              <button key={c} onClick={() => runCmd(c)} disabled={running||!fbDevices.length}
                style={{ padding:'8px 12px', borderRadius:7, cursor:'pointer', textAlign:'left', background:`${color}11`, border:`1px solid ${color}33` }}>
                <div style={{ fontSize:11, fontFamily:'monospace', fontWeight:600, color }}>{c}</div>
                <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>{desc}</div>
              </button>
            ))}
          </div>
          {logs.length > 0 && (
            <div ref={logRef} style={{ fontFamily:'monospace', fontSize:11, background:'#0a0a0a', borderRadius:8, padding:10, maxHeight:160, overflowY:'auto', color:'#d4d4d4', lineHeight:1.8, whiteSpace:'pre-wrap', border:'1px solid var(--border)' }}>
              {logs.join(String.fromCharCode(10))}
            </div>
          )}
        </div>
      )}

      {tab === 'guide' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            { title:'Boot to Fastboot Mode', steps:['Power off device completely','Hold Power + Volume Down (most devices)','Or: adb reboot bootloader','Screen should show "FASTBOOT" or Android logo with text','Scan for devices in Omerta'] },
            { title:'A/B Device Notes', steps:['Modern devices have two slots (A and B)','use "fastboot flash boot_a" and "boot_b" to flash both','Or use "fastboot flash boot" which flashes active slot','Always flash both slots to avoid boot issues','Check active slot: fastboot getvar current-slot'] },
            { title:'Safety Checklist', steps:['Only flash images made for your EXACT model','Verify image with sha256 checksum before flashing','Keep battery above 50%','Have recovery image as backup plan','Know how to restore stock firmware via Odin/MiFlash/etc'] },
          ].map((s,i) => (
            <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:10 }}>{s.title}</div>
              {s.steps.map((step,j) => (
                <div key={j} style={{ display:'flex', gap:8, marginBottom:6 }}>
                  <div style={{ width:20, height:20, borderRadius:'50%', background:'var(--accent)', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>{j+1}</div>
                  <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, paddingTop:1 }}>{step}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
