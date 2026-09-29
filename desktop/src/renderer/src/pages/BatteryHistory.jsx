import { useState, useEffect, useRef } from 'react'
const ft = window.ft

function MiniChart({ data, field, color, label, unit }) {
  if (!data.length) return null
  const vals = data.map(d => d[field]).filter(v => v !== null && v !== undefined)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const W = 360, H = 80, PAD = 8
  const pts = data.map((d, i) => {
    const x = PAD + (i / (data.length - 1 || 1)) * (W - PAD * 2)
    const y = H - PAD - ((d[field] - min) / range) * (H - PAD * 2)
    return `${x},${y}`
  }).join(' ')
  const last = vals[vals.length - 1]
  return (
    <div style={{ background:'var(--bg2)', borderRadius:8, padding:10, border:'1px solid var(--border)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontSize:11 }}>
        <span style={{ color:'var(--text3)', fontWeight:600 }}>{label}</span>
        <span style={{ color, fontWeight:700 }}>{last?.toFixed(1)}{unit}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:'block' }}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        <polyline points={`${PAD},${H} ${pts} ${W-PAD},${H}`} fill={color + '22'} stroke="none" />
      </svg>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'var(--text3)', marginTop:2 }}>
        <span>{min.toFixed(0)}{unit}</span><span>{max.toFixed(0)}{unit}</span>
      </div>
    </div>
  )
}

export default function BatteryHistory({ device, addLog }) {
  const [history, setHistory] = useState([])
  const [recording, setRecording] = useState(false)
  const intervalRef = useRef(null)
  const serial = device?.serial

  useEffect(() => () => clearInterval(intervalRef.current), [])

  const record = async () => {
    if (!serial) return addLog('Connect an Android device')
    const r = await ft.batteryHist.record({ serial }).catch(e => ({ error: e.message }))
    if (!r.error) {
      setHistory(prev => [...prev, r.entry])
      return r.entry
    }
  }

  const toggleRecording = () => {
    if (recording) {
      clearInterval(intervalRef.current)
      setRecording(false)
      addLog('Battery recording stopped')
    } else {
      setRecording(true)
      record()
      intervalRef.current = setInterval(record, 30000)
      addLog('Battery recording started (every 30s)')
    }
  }

  const loadHistory = async () => {
    if (!serial) return
    const r = await ft.batteryHist.get({ serial }).catch(() => ({ history:[] }))
    setHistory(r.history || [])
  }

  const clearHistory = async () => {
    await ft.batteryHist.clear({ serial }).catch(() => {})
    setHistory([])
    addLog('Battery history cleared')
  }

  const fmtTime = ts => {
    const d = new Date(ts)
    return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0')
  }

  const latest = history[history.length - 1]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Battery History</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Track battery level, temperature and voltage over time</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button onClick={toggleRecording} disabled={!serial}
          style={{ padding:'8px 18px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', background:recording?'rgba(248,113,113,0.15)':'var(--accent)', color:recording?'#f87171':'#000', border:recording?'1px solid rgba(248,113,113,0.4)':'none' }}>
          {recording ? 'Stop Recording' : 'Start Recording'}
        </button>
        <button onClick={record} disabled={!serial} style={{ padding:'8px 14px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>Record Now</button>
        <button onClick={loadHistory} disabled={!serial} style={{ padding:'8px 14px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>Load Saved</button>
        {history.length > 0 && <button onClick={clearHistory} style={{ padding:'8px 14px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', background:'rgba(248,113,113,0.1)', color:'#f87171', border:'1px solid rgba(248,113,113,0.3)' }}>Clear</button>}
        {recording && <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#4ade80' }}>
          <div style={{ width:8, height:8, borderRadius:'50%', background:'#4ade80', animation:'pulse 1s infinite' }} />
          Recording every 30s ({history.length} points)
        </div>}
      </div>

      {latest && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8 }}>
          {[
            { label:'Level', value: latest.level + '%', color: latest.level < 20 ? '#f87171' : latest.level < 50 ? '#f59e0b' : '#4ade80' },
            { label:'Status', value: latest.status, color:'#60a5fa' },
            { label:'Temp', value: latest.temp + ' C', color: latest.temp > 40 ? '#f87171' : '#f59e0b' },
            { label:'Voltage', value: (latest.volt/1000).toFixed(2) + ' V', color:'#a78bfa' },
          ].map((s,i) => (
            <div key={i} style={{ background:'var(--bg1)', borderRadius:8, padding:10, border:'1px solid var(--border)', textAlign:'center' }}>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>{s.label}</div>
              <div style={{ fontSize:16, fontWeight:700, color:s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {history.length > 1 && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <MiniChart data={history} field="level" color="#4ade80" label="Battery Level" unit="%" />
          <MiniChart data={history} field="temp" color="#f59e0b" label="Temperature" unit=" C" />
          <MiniChart data={history} field="volt" color="#a78bfa" label="Voltage" unit=" mV" />
        </div>
      )}

      {history.length > 0 && (
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', marginBottom:6 }}>RAW LOG</div>
          <div style={{ maxHeight:200, overflowY:'auto', display:'flex', flexDirection:'column', gap:3 }}>
            {[...history].reverse().map((h,i) => (
              <div key={i} style={{ display:'flex', gap:12, padding:'5px 10px', background:'var(--bg1)', borderRadius:6, fontSize:11, border:'1px solid var(--border)' }}>
                <span style={{ color:'var(--text3)', fontFamily:'monospace' }}>{fmtTime(h.ts)}</span>
                <span style={{ color:'#4ade80', fontWeight:600 }}>{h.level}%</span>
                <span style={{ color:'#60a5fa' }}>{h.status}</span>
                <span style={{ color:'#f59e0b' }}>{h.temp}C</span>
                <span style={{ color:'#a78bfa' }}>{(h.volt/1000).toFixed(2)}V</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!serial && <div style={{ padding:16, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>Connect an Android device to track battery history.</div>}
      {serial && !history.length && !recording && <div style={{ textAlign:'center', padding:30, color:'var(--text3)' }}>Click Start Recording or Record Now to begin tracking battery data.</div>}
    </div>
  )
}
