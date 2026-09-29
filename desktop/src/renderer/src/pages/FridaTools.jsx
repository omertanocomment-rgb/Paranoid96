import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner, Tag } from './_shared.jsx'


export default function FridaTools({ device, addLog }) {
  const [available, setAvailable] = useState(null)
  const [version, setVersion] = useState(null)
  const [processes, setProcesses] = useState([])
  const [templates, setTemplates] = useState([])
  const [script, setScript] = useState('')
  const [target, setTarget] = useState('')
  const [output, setOutput] = useState([])
  const [serverRunning, setServerRunning] = useState(false)
  const [tab, setTab] = useState('inject')
  const [filter, setFilter] = useState('')
  const serial = device?.serial

  useEffect(() => {
    ft.frida.available().then(setAvailable).catch(() => setAvailable(false))
    ft.frida.version().then(setVersion).catch(() => {})
    ft.frida.templates().then(setTemplates).catch(() => {})
    const r = ft.on('frida:output', o => setOutput(prev => [...prev.slice(-500), o]))
    return r
  }, [])

  const loadProcesses = async () => {
    const procs = await ft.frida.processes({ serial }).catch(e => { addLog(e.message); return [] })
    setProcesses(procs)
  }

  const inject = async () => {
    if (!script || !target) return addLog('Enter target process and script')
    setOutput([])
    const res = await ft.frida.inject({ serial, target, script }).catch(e => ({ error: e.message }))
    if (res?.error) addLog('Frida: ' + res.error)
    else addLog('Frida injected into ' + target)
  }

  const startServer = async () => {
    const res = await ft.frida.startServer({ serial }).catch(e => ({ error: e.message }))
    if (res?.success) { setServerRunning(true); addLog('frida-server started (PID: ' + res.pid + ')') }
    else addLog('Server start failed: ' + (res?.error || 'Unknown'))
  }

  const stopServer = async () => {
    await ft.frida.stopServer({ serial })
    setServerRunning(false)
    addLog('frida-server stopped')
  }

  const visible = processes.filter(p => !filter || p.name?.toLowerCase().includes(filter.toLowerCase()) || p.pid?.includes(filter))

  return (
    <PageWrap>
      <PageHeader title="Frida Tools" icon=" " sub="Dynamic instrumentation -- hook and inspect running apps" />

      {/* Availability banner */}
      <div className="card" style={{ background: available ? 'var(--green-dim)' : 'var(--red-dim)', border: `1px solid ${available ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:20 }}>{available ? ' ' : ' '}</span>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color: available ? 'var(--green)' : 'var(--red)' }}>
              {available ? `Frida ${version || ''} ready` : 'Frida not found'}
            </div>
            {!available && <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>Download from <button onClick={() => ft.openUrl('https://frida.re/releases')} style={{ background:'none', border:'none', color:'var(--blue)', cursor:'pointer', fontSize:12, padding:0 }}>frida.re/releases  </button> and place frida CLI in bin/</div>}
          </div>
        </div>
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3, width:'fit-content' }}>
        {[['inject','Inject Script'],['server','Server'],['templates','Templates']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:'6px 12px', borderRadius:6, fontSize:12, fontWeight:500, cursor:'pointer',
            background: tab===id ? 'var(--bg4)' : 'none', color: tab===id ? 'var(--text)' : 'var(--text3)',
            border: tab===id ? '1px solid var(--border)' : '1px solid transparent'
          }}>{label}</button>
        ))}
      </div>

      {tab === 'inject' && (
        <div style={{ display:'flex', gap:14, flex:1, overflow:'hidden', minHeight:350 }}>
          {/* Process picker */}
          <div style={{ width:180, flexShrink:0, display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ display:'flex', gap:4 }}>
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter..." style={{ flex:1, fontSize:11 }} />
              <button className="btn btn-sm" onClick={loadProcesses} disabled={!device}> </button>
            </div>
            <div style={{ flex:1, overflowY:'auto' }}>
              {visible.map(p => (
                <div key={p.pid} onClick={() => setTarget(p.pid)}
                  style={{ padding:'5px 8px', borderRadius:5, cursor:'pointer', marginBottom:2, fontSize:11,
                    background: target===p.pid ? 'var(--accent-dim)' : 'var(--bg2)',
                    border:`1px solid ${target===p.pid ? 'var(--accent-border)' : 'transparent'}` }}>
                  <div style={{ fontWeight:500, color: target===p.pid ? 'var(--accent)' : 'var(--text)' }}>{p.name}</div>
                  <div style={{ color:'var(--text3)', fontSize:10 }}>PID {p.pid}</div>
                </div>
              ))}
              {!processes.length && <div style={{ fontSize:11, color:'var(--text3)', padding:8 }}>Click   to load processes</div>}
            </div>
            <div style={{ display:'flex', gap:4 }}>
              <input value={target} onChange={e => setTarget(e.target.value)} placeholder="PID or name" style={{ flex:1, fontSize:11 }} />
            </div>
          </div>

          {/* Script editor + output */}
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:8 }}>
            <textarea value={script} onChange={e => setScript(e.target.value)}
              placeholder="// Frida script -- Java.perform(function() { ... })"
              style={{ height:180, fontFamily:'var(--font-mono)', fontSize:12, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:8, padding:10, resize:'none' }} />
            <button className="btn btn-primary" style={{ width:'fit-content' }} onClick={inject} disabled={!available || !target || !script || !device}>
                Inject into {target || 'target'}
            </button>
            <div className="terminal" style={{ flex:1, minHeight:100, maxHeight:200, overflowY:'auto' }}>
              {output.length ? output.map((o, i) => (
                <div key={i} style={{ color: o.type === 'stderr' ? 'var(--red)' : o.type === 'exit' ? 'var(--text3)' : '#a8ff78' }}>
                  {o.type === 'exit' ? `[process exited with code ${o.code}]` : o.data}
                </div>
              )) : <span style={{ color:'var(--text3)' }}>Output will appear here...</span>}
            </div>
          </div>
        </div>
      )}

      {tab === 'server' && (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>frida-server on Device</div>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:12 }}>frida-server must run on the device (requires root). Download the matching version from frida.re/releases for your device architecture.</div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-sm" onClick={() => ft.frida.pushServer({ serial }).then(r => addLog(r.error || 'Pushed to ' + r.path)).catch(e => addLog(e.message))}>
                  Push frida-server to Device
              </button>
              {!serverRunning
                ? <button className="btn btn-primary btn-sm" onClick={startServer} disabled={!device}>  Start Server</button>
                : <button className="btn btn-red btn-sm" onClick={stopServer}>  Stop Server</button>
              }
            </div>
            {serverRunning && <div style={{ marginTop:8, fontSize:12, color:'var(--green)' }}>  frida-server running on device</div>}
          </div>
          <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)' }}>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', marginBottom:6 }}>Architecture Guide</div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.8 }}>
              arm64-v8a   frida-server-*-android-arm64<br/>
              armeabi-v7a   frida-server-*-android-arm<br/>
              x86_64   frida-server-*-android-x86_64 (emulator)<br/>
              Check your device: Settings   About   CPU Architecture
            </div>
          </div>
        </div>
      )}

      {tab === 'templates' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {templates.map((t, i) => (
            <div key={i} className="card">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600 }}>{t.name}</div>
                  <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>{t.description}</div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => { setScript(t.code); setTab('inject'); addLog('Template loaded: ' + t.name) }}>Use</button>
              </div>
              <pre style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'#a8ff78', background:'var(--bg)', padding:10, borderRadius:6, overflow:'auto', maxHeight:120, margin:0 }}>{t.code}</pre>
            </div>
          ))}
        </div>
      )}
    </PageWrap>
  )
}
