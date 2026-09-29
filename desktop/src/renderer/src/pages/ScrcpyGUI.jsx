import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Tag } from './_shared.jsx'


export default function ScrcpyGUI({ device, addLog }) {
  const [sessions, setSessions] = useState([])
  const [opts, setOpts] = useState({ maxSize:0, bitrate:8, fps:60, alwaysOnTop:false, noAudio:false, record:false })
  const [busy, setBusy] = useState(false)
  const [recordPath, setRecordPath] = useState('')

  useEffect(() => {
    ft.mirror.list().then(setSessions).catch(() => {})
  }, [])

  const start = async () => {
    if (!device?.serial) return addLog('No Android device connected')
    setBusy(true)
    try {
      await ft.mirror.start({ serial: device.serial, opts })
      addLog('Screen mirror started')
      ft.mirror.list().then(setSessions)
    } catch (e) { addLog('Mirror failed: ' + e.message) }
    setBusy(false)
  }

  const stop = async (sessionId) => {
    try {
      await ft.mirror.stop({ sessionId })
      ft.mirror.list().then(setSessions)
    } catch (e) { addLog(e.message) }
  }

  const record = async () => {
    if (!device?.serial) return addLog('No Android device connected')
    setBusy(true)
    try {
      const res = await ft.mirror.record({ serial: device.serial, opts })
      if (!res?.cancelled) { setRecordPath(res?.path || ''); addLog('Recording saved: ' + res?.path) }
    } catch (e) { addLog('Record failed: ' + e.message) }
    setBusy(false)
  }

  const OPT = (label, key, type, extra={}) => (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
      <span style={{ fontSize:12, color:'var(--text3)' }}>{label}</span>
      {type === 'bool'
        ? <button onClick={() => setOpts(o => ({...o, [key]:!o[key]}))}
            style={{ padding:'3px 10px', borderRadius:4, fontSize:11, border:'1px solid var(--border)', cursor:'pointer',
              background: opts[key] ? 'var(--green-dim)' : 'var(--bg3)', color: opts[key] ? 'var(--green)' : 'var(--text3)' }}>
            {opts[key] ? 'On' : 'Off'}
          </button>
        : <input type="number" value={opts[key]} onChange={e => setOpts(o => ({...o, [key]:+e.target.value}))}
            style={{ width:70, textAlign:'right' }} {...extra} />
      }
    </div>
  )

  return (
    <PageWrap>
      <PageHeader title="Screen Mirror" icon=" " sub="Mirror and control Android screen on PC" />

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <div className="card">
          <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Options</div>
          {OPT('Max size (px, 0=full)', 'maxSize', 'number', { min:0, max:4096 })}
          {OPT('Bitrate (Mbps)', 'bitrate', 'number', { min:1, max:40 })}
          {OPT('Max FPS', 'fps', 'number', { min:15, max:120 })}
          {OPT('Always on top', 'alwaysOnTop', 'bool')}
          {OPT('No audio', 'noAudio', 'bool')}
          <div style={{ marginTop:12, display:'flex', gap:8 }}>
            <button className="btn btn-primary" onClick={start} disabled={busy || !device}>  Mirror</button>
            <button className="btn btn-blue" onClick={record} disabled={busy || !device}>  Record</button>
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Active Sessions ({sessions.length})</div>
          {!sessions.length && <Empty icon=" " text="No active sessions" />}
          {sessions.map((s, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
              <span style={{ flex:1, fontSize:12 }}>{s.serial || 'Session ' + i}</span>
              <Tag color="green">Live</Tag>
              <button className="btn btn-red btn-sm" onClick={() => stop(s.id)}>Stop</button>
            </div>
          ))}
          {recordPath && <div style={{ marginTop:8, fontSize:12, color:'var(--green)' }}>  Saved: {recordPath.split(/[/\\]/).pop()}</div>}
        </div>
      </div>

      <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', marginBottom:4 }}>Setup</div>
        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
          Requires <code style={{ fontFamily:'var(--mono)', background:'var(--bg3)', padding:'1px 4px', borderRadius:3 }}>scrcpy.exe</code> in the <code style={{ fontFamily:'var(--mono)', background:'var(--bg3)', padding:'1px 4px', borderRadius:3 }}>bin\</code> folder.<br />
          Download from: <button onClick={() => ft.openUrl('https://github.com/Genymobile/scrcpy/releases')} className="btn btn-sm" style={{ padding:'1px 6px', fontSize:11 }}>github.com/Genymobile/scrcpy  </button>
        </div>
      </div>
    </PageWrap>
  )
}
