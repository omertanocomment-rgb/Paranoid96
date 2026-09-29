import { useState } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner } from './_shared.jsx'


export default function LayoutInspector({ device, addLog }) {
  const [hierarchy, setHierarchy] = useState(null)
  const [screenshot, setScreenshot] = useState(null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const serial = device?.serial

  const dump = async () => {
    setLoading(true); setHierarchy(null); setResults(null)
    try {
      const [hier, ss] = await Promise.all([
        ft.layout.dump({ serial }),
        ft.layout.screenshot({ serial })
      ])
      if (!hier.error) setHierarchy(hier)
      else addLog(hier.error)
      if (ss?.base64) setScreenshot(`data:image/png;base64,${ss.base64}`)
    } catch(e) { addLog('Layout: ' + e.message) }
    setLoading(false)
  }

  const findEl = async () => {
    if (!search) return
    setLoading(true)
    const found = await ft.layout.find({ serial, text: search }).catch(e => { addLog(e.message); return [] })
    setResults(found)
    setLoading(false)
  }

  const nodes = hierarchy?.parsed || []
  const visible = search
    ? nodes.filter(n => n.text?.toLowerCase().includes(search.toLowerCase()) || n['resource-id']?.toLowerCase().includes(search.toLowerCase()) || n['content-desc']?.toLowerCase().includes(search.toLowerCase()))
    : nodes.slice(0, 100)

  return (
    <PageWrap>
      <PageHeader title="Layout Inspector" icon=" " sub="Inspect the view hierarchy of any running app" />

      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <button className="btn btn-primary" onClick={dump} disabled={!device || loading}>
          {loading ? <><Spinner size={14}/> Dumping...</> : '  Dump UI Hierarchy'}
        </button>
        <div style={{ display:'flex', gap:6, flex:1 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key==='Enter' && findEl()} placeholder="Search by text, resource-id, content-desc..." style={{ flex:1 }} />
          <button className="btn btn-sm" onClick={findEl} disabled={!serial}>Find</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:14, flex:1, overflow:'hidden', minHeight:350 }}>
        {/* Screenshot */}
        {screenshot && (
          <div style={{ width:200, flexShrink:0, position:'relative' }}>
            <img src={screenshot} style={{ width:'100%', borderRadius:8, border:'1px solid var(--border)' }} />
          </div>
        )}

        {/* Node list */}
        <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:2 }}>
          {!hierarchy && !loading && <Empty icon=" " text="Click 'Dump UI Hierarchy'" sub="Screen must be on and unlocked" />}
          {visible.map((node, i) => (
            <div key={i} onClick={() => setSelected(selected === i ? null : i)}
              style={{ padding:'6px 10px', borderRadius:6, cursor:'pointer', fontSize:11,
                background: selected===i ? 'var(--accent-dim)' : 'var(--bg2)',
                border:`1px solid ${selected===i ? 'var(--accent-border)' : 'transparent'}` }}>
              <div style={{ fontWeight:500, color: selected===i ? 'var(--accent)' : 'var(--text)', marginBottom:2 }}>
                {node.class?.split('.').pop() || 'View'}
              </div>
              {node.text && <div style={{ color:'var(--text2)' }}>"{node.text}"</div>}
              {node['resource-id'] && <div style={{ color:'var(--text3)', fontFamily:'var(--font-mono)' }}>{node['resource-id']}</div>}
              {node.bounds && <div style={{ color:'var(--text3)' }}>{node.bounds}</div>}
              {selected === i && (
                <div style={{ marginTop:8, padding:8, background:'var(--bg)', borderRadius:6, display:'flex', flexDirection:'column', gap:4 }}>
                  {Object.entries(node).map(([k,v]) => v ? (
                    <div key={k} style={{ display:'flex', gap:8, fontSize:10 }}>
                      <span style={{ color:'var(--text3)', minWidth:100, flexShrink:0 }}>{k}</span>
                      <span style={{ color:'var(--text2)', wordBreak:'break-all' }}>{v}</span>
                    </div>
                  ) : null)}
                </div>
              )}
            </div>
          ))}
          {hierarchy && nodes.length > 100 && !search && (
            <div style={{ fontSize:11, color:'var(--text3)', padding:8 }}>Showing 100 of {nodes.length} nodes. Use search to filter.</div>
          )}
        </div>
      </div>
    </PageWrap>
  )
}
