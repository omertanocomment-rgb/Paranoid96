import { useState, useEffect, useRef } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner, Tag } from './_shared.jsx'


const LEVEL_COLORS = { V:'#888', D:'#60a5fa', I:'#4ade80', W:'#fb923c', E:'#f87171', F:'#e879f9' }
const LEVEL_BG = { V:'transparent', D:'rgba(96,165,250,0.05)', I:'rgba(74,222,128,0.05)', W:'rgba(251,146,60,0.08)', E:'rgba(248,113,113,0.1)', F:'rgba(232,121,249,0.12)' }

export default function LogcatViewer({ device, addLog }) {
  const [logs, setLogs] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState('V')
  const [tagFilter, setTagFilter] = useState('')
  const [processes, setProcesses] = useState([])
  const [pidFilter, setPidFilter] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [loading, setLoading] = useState(false)
  const [pause, setPause] = useState(false)
  const bottomRef = useRef(null)
  const pauseRef = useRef(false)
  pauseRef.current = pause
  const serial = device?.serial

  useEffect(() => {
    const r = ft.on('logcat:data', (entries) => {
      if (pauseRef.current) return
      setLogs(prev => [...prev.slice(-2000), ...entries])
    })
    return r
  }, [])

  useEffect(() => {
    if (autoScroll && !pause) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, autoScroll, pause])

  const loadSnapshot = async () => {
    if (!serial) return
    setLoading(true)
    try {
      const entries = await ft.logcat.snapshot({ serial, lines: 500, level: levelFilter })
      setLogs(entries)
    } catch (e) { addLog('Logcat: ' + e.message) }
    setLoading(false)
  }

  const startStream = async () => {
    if (!serial) return
    setStreaming(true)
    setLogs([])
    await ft.logcat.start({ serial, options: { level: levelFilter, pid: pidFilter || undefined } })
    addLog('Logcat streaming started')
  }

  const stopStream = async () => {
    await ft.logcat.stop({ serial })
    setStreaming(false)
    addLog('Logcat stopped')
  }

  const clear = async () => {
    setLogs([])
    await ft.logcat.clear({ serial }).catch(() => {})
  }

  const save = async () => {
    const r = await ft.logcat.save({ serial, lines: 5000 })
    if (!r?.cancelled) addLog('Saved: ' + r?.path)
  }

  const loadProcs = async () => {
    const procs = await ft.logcat.processes({ serial }).catch(() => [])
    setProcesses(procs)
  }

  useEffect(() => { if (serial) loadSnapshot() }, [serial])

  const visible = logs.filter(l => {
    if (levelFilter !== 'V' && 'VDIWEF'.indexOf(l.level) < 'VDIWEF'.indexOf(levelFilter)) return false
    if (tagFilter && !l.tag?.toLowerCase().includes(tagFilter.toLowerCase())) return false
    if (pidFilter && l.pid !== pidFilter) return false
    if (filter && !l.message?.toLowerCase().includes(filter.toLowerCase()) && !l.tag?.toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  return (
    <PageWrap>
      <PageHeader title="Logcat Viewer" icon=" " sub="Real-time Android system logs" />

      {/* Controls */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
        {!streaming
          ? <button className="btn btn-primary btn-sm" onClick={startStream} disabled={!device}>  Stream</button>
          : <button className="btn btn-red btn-sm" onClick={stopStream}>  Stop</button>
        }
        <button className="btn btn-sm" onClick={loadSnapshot} disabled={loading || !device}>
          {loading ? <Spinner size={14}/> : '  Snapshot'}
        </button>
        <button className="btn btn-sm" onClick={clear}>  Clear</button>
        <button className="btn btn-sm" onClick={save} disabled={!serial}>  Save</button>
        <button className="btn btn-sm" onClick={loadProcs}>  Processes</button>
        <button className="btn btn-sm" onClick={() => setPause(p => !p)}
          style={{ background: pause ? 'var(--accent-dim)' : undefined, color: pause ? 'var(--accent)' : undefined }}>
          {pause ? '  Resume' : '  Pause'}
        </button>
        <div style={{ flex:1 }} />
        <span style={{ fontSize:11, color:'var(--text3)' }}>{visible.length}/{logs.length} entries</span>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
        {['V','D','I','W','E','F'].map(l => (
          <button key={l} onClick={() => setLevelFilter(l)}
            style={{ padding:'3px 8px', borderRadius:4, fontSize:12, fontWeight:700, border:'none', cursor:'pointer',
              background: levelFilter === l ? LEVEL_COLORS[l] : 'var(--bg3)',
              color: levelFilter === l ? '#000' : LEVEL_COLORS[l] }}>
            {l}
          </button>
        ))}
        <input value={tagFilter} onChange={e => setTagFilter(e.target.value)} placeholder="Tag filter" style={{ width:110, fontSize:12 }} />
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search messages..." style={{ flex:1, minWidth:140, fontSize:12 }} />
        {processes.length > 0 && (
          <select value={pidFilter} onChange={e => setPidFilter(e.target.value)} style={{ fontSize:12 }}>
            <option value="">All PIDs</option>
            {processes.map(p => <option key={p.pid} value={p.pid}>{p.pid} -- {p.name}</option>)}
          </select>
        )}
        <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:'var(--text3)', cursor:'pointer' }}>
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>

      {/* Log output */}
      <div style={{ flex:1, overflowY:'auto', minHeight:300, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:8, fontFamily:'var(--font-mono)', fontSize:11, lineHeight:1.6 }}>
        {!visible.length && !loading && <Empty icon=" " text="No logs" sub={serial ? "Click Snapshot or Stream" : "Connect an Android device"} />}
        {visible.map((l, i) => (
          <div key={i} style={{ display:'flex', gap:8, padding:'1px 8px', background: LEVEL_BG[l.level] || 'transparent', borderBottom:'1px solid rgba(255,255,255,0.02)' }}>
            <span style={{ color:'var(--text3)', flexShrink:0, width:72 }}>{l.time?.slice(5)}</span>
            <span style={{ color:'var(--text3)', flexShrink:0, width:40 }}>{l.pid}</span>
            <span style={{ color: LEVEL_COLORS[l.level] || '#888', fontWeight:700, flexShrink:0, width:10 }}>{l.level}</span>
            <span style={{ color:'#60a5fa', flexShrink:0, width:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.tag}</span>
            <span style={{ color:'var(--text2)', flex:1, whiteSpace:'pre-wrap', wordBreak:'break-all' }}>{l.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </PageWrap>
  )
}
