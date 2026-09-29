import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Tag } from './_shared.jsx'


export default function TestPoints({ device, addLog }) {
  const [db, setDb] = useState({})
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    ft.testpoints.all().then(setDb).catch(() => {})
    if (device?.model) setQuery(device.model)
  }, [device?.model])

  const search = async () => {
    if (!query.trim()) return
    setSearched(true)
    try {
      const res = await ft.testpoints.search({ query: query.trim() })
      setResults(res || [])
    } catch (e) { addLog('Search: ' + e.message) }
  }

  const platforms = Object.entries(db)

  return (
    <PageWrap>
      <PageHeader title="Test Point Database" icon=" " sub="EDL / BROM test points for major device models" />

      <div className="card" style={{ background:'var(--accent-dim)', border:'1px solid var(--accent-border)' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--accent)', marginBottom:4 }}>  Hardware Procedure</div>
        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
          Test point shorts must be done carefully -- wrong contact can cause permanent damage.
          Use ESD protection. Only use on devices you own.
        </div>
      </div>

      {/* Search */}
      <div style={{ display:'flex', gap:8 }}>
        <input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Search device (e.g. Samsung S20, Xiaomi Note 7, OnePlus 6)" style={{ flex:1 }} />
        <button className="btn btn-primary" onClick={search}>  Search</button>
      </div>

      {/* Platform browser if no search */}
      {!searched && (
        <div>
          <div style={{ fontSize:12, color:'var(--text3)', marginBottom:10 }}>
            Database covers {Object.values(db).reduce((a, p) => a + Object.keys(p.devices || {}).length, 0)} devices across {platforms.length} platforms
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {platforms.map(([key, platform]) => (
              <div key={key} className="card" style={{ cursor:'pointer', transition:'border-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                onClick={() => { setQuery(platform.name); search() }}>
                <div style={{ fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:4 }}>{platform.name}</div>
                <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.5, marginBottom:8 }}>{platform.description?.slice(0, 80)}...</div>
                <Tag color="blue">{Object.keys(platform.devices || {}).length} devices</Tag>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search results */}
      {searched && (
        <div style={{ display:'flex', gap:14, flex:1, minHeight:300, overflow:'hidden' }}>
          <div style={{ width:220, flexShrink:0, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
            {!results.length && (
              <Empty icon=" " text="No devices found" sub={`Try searching brand name, model, or chipset`} />
            )}
            {results.map((r, i) => (
              <div key={i} onClick={() => setSelected(r)}
                style={{ padding:'9px 12px', borderRadius:7, cursor:'pointer', transition:'all 0.1s',
                  background: selected === r ? 'var(--accent-dim)' : 'var(--bg2)',
                  border: `1px solid ${selected === r ? 'var(--accent-border)' : 'var(--border)'}` }}>
                <div style={{ fontSize:12, fontWeight:500, color: selected === r ? 'var(--accent)' : 'var(--text)', marginBottom:2 }}>{r.device}</div>
                <div style={{ fontSize:10, color:'var(--text3)' }}>{r.chipset}   {r.platformName}</div>
                <Tag color={r.difficulty === 'Easy' ? 'green' : r.difficulty === 'Medium' ? 'amber' : 'red'} style={{ marginTop:4 }}>
                  {r.difficulty || 'Unknown'}
                </Tag>
              </div>
            ))}
          </div>

          {selected ? (
            <div className="card" style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:12 }}>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:'var(--text)', marginBottom:4 }}>{selected.device}</div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {selected.chipset && <Tag color="blue">{selected.chipset}</Tag>}
                  {selected.platformName && <Tag color="gray">{selected.platformName}</Tag>}
                  {selected.difficulty && <Tag color={selected.difficulty === 'Easy' ? 'green' : selected.difficulty === 'Medium' ? 'amber' : 'red'}>{selected.difficulty}</Tag>}
                </div>
              </div>

              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--text3)', marginBottom:6 }}>TEST POINT</div>
                <div style={{ fontSize:14, fontWeight:600, color:'var(--accent)', padding:'10px 14px', background:'var(--accent-dim)', borderRadius:8, border:'1px solid var(--accent-border)' }}>
                  {selected.testPoint}
                </div>
              </div>

              {selected.notes && (
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--text3)', marginBottom:6 }}>NOTES</div>
                  <div style={{ fontSize:13, color:'var(--text2)', lineHeight:1.7 }}>{selected.notes}</div>
                </div>
              )}

              <div>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--text3)', marginBottom:8 }}>TRIGGER METHODS</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {(selected.triggerMethods || db[selected.platform]?.triggerMethods || []).map((m, i) => (
                    <div key={i} style={{ display:'flex', gap:10, padding:'7px 10px', background:'var(--bg2)', borderRadius:6, fontSize:12, color:'var(--text2)', lineHeight:1.5 }}>
                      <span style={{ color:'var(--accent)', fontWeight:700, flexShrink:0 }}>{i+1}.</span>
                      {m}
                    </div>
                  ))}
                </div>
              </div>

              {selected.diagramUrl && (
                <button className="btn btn-sm" onClick={() => ft.openUrl(selected.diagramUrl)}>
                    View Diagram / XDA Thread  
                </button>
              )}
            </div>
          ) : (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Empty icon=" " text="Select a device to see test point details" />
            </div>
          )}
        </div>
      )}
    </PageWrap>
  )
}
