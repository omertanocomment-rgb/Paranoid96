import { useState, useEffect, useRef } from 'react'
const ft = window.ft

export default function ProcessManager({ device, addLog }) {
  const [procs, setProcs] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('ram')
  const [auto, setAuto] = useState(false)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const intervalRef = useRef(null)
  const serial = device?.serial

  useEffect(() => () => clearInterval(intervalRef.current), [])

  const load = async () => {
    if (!serial) return
    setLoading(true)
    const r = await ft.proc.list({ serial }).catch(e => ({ error: e.message }))
    if (r.success) setProcs(r.procs)
    else addLog('Error: ' + r.error)
    setLoading(false)
  }

  const toggleAuto = () => {
    if (auto) { clearInterval(intervalRef.current); setAuto(false) }
    else { setAuto(true); load(); intervalRef.current = setInterval(load, 3000) }
  }

  const kill = async (proc) => {
    const r = await ft.proc.kill({ serial, pid: proc.pid, name: proc.name }).catch(e => ({ error: e.message }))
    addLog(r.success ? `Killed PID ${proc.pid} (${proc.name})` : 'Kill failed: ' + r.error)
    load()
  }

  const showDetail = async (proc) => {
    setSelected(proc)
    const r = await ft.proc.detail({ serial, pid: proc.pid }).catch(() => null)
    setDetail(r)
  }

  const sorted = [...procs]
    .filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()) || String(p.pid).includes(search))
    .sort((a, b) => sortBy === 'ram' ? b.ram - a.ram : sortBy === 'cpu' ? b.cpu - a.cpu : sortBy === 'pid' ? a.pid - b.pid : (a.name||'').localeCompare(b.name||''))

  const totalRam = procs.reduce((s, p) => s + p.ram, 0)

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>
      <div style={{ flex:1, display:'flex', flexDirection:'column', padding:'16px 20px', gap:10, overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:22 }}>  </span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:18, fontWeight:700, color:'var(--text)' }}>Process Manager</div>
            <div style={{ fontSize:11, color:'var(--text3)' }}>{procs.length} processes   {Math.round(totalRam/1024)} MB total RSS</div>
          </div>
          <button onClick={toggleAuto} style={{ padding:'6px 12px', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', background:auto?'rgba(74,222,128,0.15)':'var(--bg3)', color:auto?'#4ade80':'var(--text3)', border:`1px solid ${auto?'rgba(74,222,128,0.3)':'var(--border)'}` }}>
            {auto ? '  Stop (3s)' : '  Auto-refresh'}
          </button>
          <button onClick={load} disabled={loading||!serial} style={{ padding:'6px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>

        <div style={{ display:'flex', gap:8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by name or PID..." style={{ flex:1 }} />
          {['ram','cpu','pid','name'].map(s => (
            <button key={s} onClick={() => setSortBy(s)} style={{ padding:'5px 10px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:sortBy===s?'var(--accent-dim)':'var(--bg2)', color:sortBy===s?'var(--accent)':'var(--text3)', border:`1px solid ${sortBy===s?'var(--accent-border)':'var(--border)'}` }}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>

        {!serial && <div style={{ padding:14, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>Connect an Android device.</div>}

        <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:2 }}>
          <div style={{ display:'grid', gridTemplateColumns:'60px 80px 70px 70px 1fr 80px', gap:8, padding:'5px 10px', fontSize:10, fontWeight:700, color:'var(--text3)', letterSpacing:'0.05em', borderBottom:'1px solid var(--border)' }}>
            <span>PID</span><span>USER</span><span>CPU%</span><span>RAM KB</span><span>NAME</span><span></span>
          </div>
          {sorted.map(p => (
            <div key={p.pid} onClick={() => showDetail(p)}
              style={{ display:'grid', gridTemplateColumns:'60px 80px 70px 70px 1fr 80px', gap:8, padding:'5px 10px', borderRadius:6, fontSize:11, cursor:'pointer', background:selected?.pid===p.pid?'var(--accent-dim)':'transparent', border:`1px solid ${selected?.pid===p.pid?'var(--accent-border)':'transparent'}`, alignItems:'center' }}>
              <span style={{ fontFamily:'monospace', color:'var(--text3)' }}>{p.pid}</span>
              <span style={{ color:'var(--text3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:10 }}>{p.user}</span>
              <span style={{ color: p.cpu > 50 ? '#f87171' : p.cpu > 10 ? '#f59e0b' : 'var(--text2)' }}>{p.cpu.toFixed(1)}%</span>
              <span style={{ color: p.ram > 200000 ? '#f87171' : p.ram > 50000 ? '#f59e0b' : 'var(--text2)' }}>{p.ram > 1024 ? Math.round(p.ram/1024)+'M' : p.ram+'K'}</span>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text)', fontWeight:p.cpu>5?600:400 }}>{p.name}</span>
              <button onClick={e => { e.stopPropagation(); kill(p) }} style={{ padding:'3px 8px', borderRadius:4, fontSize:10, fontWeight:600, cursor:'pointer', background:'rgba(248,113,113,0.15)', color:'#f87171', border:'1px solid rgba(248,113,113,0.3)' }}>Kill</button>
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div style={{ width:260, borderLeft:'1px solid var(--border)', padding:16, overflowY:'auto', flexShrink:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>PID {selected.pid}</div>
            <button onClick={() => { setSelected(null); setDetail(null) }} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:16 }}>x</button>
          </div>
          {[['Name', selected.name],['User', selected.user],['CPU', selected.cpu+'%'],['RAM', (selected.ram/1024).toFixed(1)+' MB']].map(([k,v]) => (
            <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
              <span style={{ color:'var(--text3)' }}>{k}</span>
              <span style={{ color:'var(--text2)', fontFamily:'monospace', fontSize:11 }}>{v}</span>
            </div>
          ))}
          {detail?.success && (
            <>
              <div style={{ marginTop:10, fontSize:11, fontWeight:700, color:'var(--text3)' }}>OOM Score: {detail.oom}</div>
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>Memory maps: {detail.maps}</div>
            </>
          )}
          <div style={{ marginTop:12, display:'flex', gap:6 }}>
            <button onClick={() => kill(selected)} style={{ flex:1, padding:'7px', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', background:'rgba(248,113,113,0.15)', color:'#f87171', border:'1px solid rgba(248,113,113,0.3)' }}>Force Kill</button>
          </div>
        </div>
      )}
    </div>
  )
}
