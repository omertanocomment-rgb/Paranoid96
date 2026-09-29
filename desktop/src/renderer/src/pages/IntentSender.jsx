import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty } from './_shared.jsx'


export default function IntentSender({ device, addLog }) {
  const [presets, setPresets] = useState([])
  const [action, setAction] = useState('')
  const [component, setComponent] = useState('')
  const [data, setData] = useState('')
  const [type, setType] = useState('activity')
  const [extras, setExtras] = useState([{ key:'', value:'', vtype:'string' }])
  const [output, setOutput] = useState('')
  const serial = device?.serial

  useEffect(() => { ft.intent.presets().then(setPresets).catch(() => {}) }, [])

  const send = async () => {
    const extraObj = {}
    for (const e of extras) { if (e.key && e.value) extraObj[e.key] = e.vtype==='boolean' ? e.value==='true' : e.vtype==='number' ? Number(e.value) : e.value }
    const res = await ft.intent.send({ serial, intent: { action, component, data, type, extras: Object.keys(extraObj).length ? extraObj : undefined } })
    setOutput(res.output || '')
    addLog(`Intent ${res.success ? 'sent' : 'failed'}: ${action || component}`)
  }

  const loadPreset = (p) => {
    setAction(p.action || '')
    setComponent(p.component || '')
    setData(p.data || '')
    setType(p.type || 'activity')
    setExtras(p.extras ? Object.entries(p.extras).map(([k,v]) => ({ key:k, value:String(v), vtype:typeof v })) : [{ key:'', value:'', vtype:'string' }])
  }

  return (
    <PageWrap>
      <PageHeader title="Intent Sender" icon=" " sub="Send Android Intents to any app or system component" />
      <div style={{ display:'flex', gap:14, flex:1, overflow:'hidden', minHeight:300 }}>
        {/* Presets */}
        <div style={{ width:200, flexShrink:0, overflowY:'auto' }}>
          <div style={{ fontSize:10, color:'var(--text3)', fontWeight:700, letterSpacing:'0.08em', marginBottom:8 }}>PRESETS</div>
          {presets.map((p, i) => (
            <button key={i} onClick={() => loadPreset(p)} style={{
              width:'100%', padding:'7px 10px', textAlign:'left', borderRadius:6, fontSize:11, cursor:'pointer', marginBottom:3,
              background:'var(--bg2)', border:'1px solid var(--border)', color:'var(--text2)'
            }}>{p.name}</button>
          ))}
        </div>

        {/* Builder */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'flex', gap:8 }}>
            {['activity','broadcast','service'].map(t => (
              <button key={t} onClick={() => setType(t)} style={{
                flex:1, padding:'7px', borderRadius:7, fontSize:12, cursor:'pointer', textTransform:'capitalize',
                background: type===t ? 'var(--accent-dim)' : 'var(--bg2)',
                border:`1px solid ${type===t ? 'var(--accent-border)' : 'var(--border)'}`,
                color: type===t ? 'var(--accent)' : 'var(--text2)'
              }}>{t}</button>
            ))}
          </div>
          <div><div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Action</div><input value={action} onChange={e => setAction(e.target.value)} placeholder="android.intent.action.VIEW" style={{ width:'100%' }} /></div>
          <div><div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Component (optional)</div><input value={component} onChange={e => setComponent(e.target.value)} placeholder="com.example/.MainActivity" style={{ width:'100%' }} /></div>
          <div><div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Data URI (optional)</div><input value={data} onChange={e => setData(e.target.value)} placeholder="https://example.com" style={{ width:'100%' }} /></div>
          <div>
            <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Extras</div>
            {extras.map((ex, i) => (
              <div key={i} style={{ display:'flex', gap:6, marginBottom:4 }}>
                <input value={ex.key} onChange={e => setExtras(prev => prev.map((x,j) => j===i ? {...x,key:e.target.value}:x))} placeholder="key" style={{ flex:1, fontSize:12 }} />
                <input value={ex.value} onChange={e => setExtras(prev => prev.map((x,j) => j===i ? {...x,value:e.target.value}:x))} placeholder="value" style={{ flex:1, fontSize:12 }} />
                <select value={ex.vtype} onChange={e => setExtras(prev => prev.map((x,j) => j===i ? {...x,vtype:e.target.value}:x))} style={{ fontSize:11 }}>
                  <option value="string">String</option><option value="number">Int</option><option value="boolean">Bool</option>
                </select>
                <button className="btn btn-sm" onClick={() => setExtras(prev => prev.filter((_,j) => j!==i))}> </button>
              </div>
            ))}
            <button className="btn btn-sm" onClick={() => setExtras(prev => [...prev, {key:'',value:'',vtype:'string'}])}>+ Extra</button>
          </div>
          <button className="btn btn-primary" style={{ width:'fit-content' }} onClick={send} disabled={!device || (!action && !component)}>  Send Intent</button>
          {output && <div className="terminal" style={{ maxHeight:100 }}>{output}</div>}
        </div>
      </div>
    </PageWrap>
  )
}
