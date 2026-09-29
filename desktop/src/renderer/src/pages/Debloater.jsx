import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner, Checkbox } from './_shared.jsx'


export default function Debloater({ device, addLog }) {
  const [presets, setPresets] = useState([])
  const [active, setActive] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [scanning, setScanning] = useState(false)
  const [found, setFound] = useState([])
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState('disable')
  const [filter, setFilter] = useState('')

  useEffect(() => { ft.debloat.presets().then(setPresets).catch(() => {}) }, [])

  const scan = async () => {
    if (!device) return
    setScanning(true)
    try {
      const f = await ft.debloat.scan({ serial: device.serial })
      setFound(f)
      addLog(`Found ${f.length} bloat packages`)
    } catch (e) { addLog('Scan: ' + e.message) }
    setScanning(false)
  }

  const apply = async () => {
    setBusy(true)
    try {
      const res = await ft.debloat.apply({ serial: device.serial, packages: [...selected], action })
      const ok = res.filter(r => r.success).length
      addLog(`${action}: ${ok}/${res.length} packages`)
      setSelected(new Set())
    } catch (e) { addLog('Apply: ' + e.message) }
    setBusy(false)
  }

  const selectPreset = (p) => {
    setActive(p)
    setSelected(new Set(p.categories.flatMap(c => c.packages)))
  }

  const currentPackages = active
    ? active.categories.flatMap(c => c.packages.map(pkg => ({ pkg, cat: c.name })))
    : found.map(f => ({ pkg: f.pkg || f, cat: 'Detected' }))

  const visible = currentPackages.filter(p => !filter || p.pkg.toLowerCase().includes(filter.toLowerCase()))

  return (
    <PageWrap>
      <PageHeader title="Debloater" icon=" " sub="Remove bloatware -- no root needed for disable" />

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button className="btn btn-primary" onClick={scan} disabled={!device || scanning}>
          {scanning ? <><Spinner size={14} /> Scanning...</> : '  Scan Device'}
        </button>
        {found.length > 0 && <span style={{ fontSize:13, color:'var(--text2)', display:'flex', alignItems:'center' }}>{found.length} packages detected</span>}
      </div>

      <div style={{ display:'flex', gap:12, flex:1, overflow:'hidden', minHeight:350 }}>
        {/* Presets sidebar */}
        <div style={{ width:165, flexShrink:0, overflowY:'auto', display:'flex', flexDirection:'column', gap:3 }}>
          <div style={{ fontSize:10, color:'var(--text3)', fontWeight:600, letterSpacing:'0.08em', padding:'2px 4px' }}>PRESETS</div>
          {presets.map(p => (
            <button key={p.id} onClick={() => selectPreset(p)} style={{
              padding:'7px 10px', borderRadius:6, textAlign:'left', cursor:'pointer', fontSize:12, fontWeight:500,
              background: active?.id === p.id ? 'var(--accent-dim)' : 'var(--bg2)',
              border: `1px solid ${active?.id === p.id ? 'var(--accent-border)' : 'var(--border)'}`,
              color: active?.id === p.id ? 'var(--accent)' : 'var(--text2)'
            }}>
              {p.name}
              <div style={{ fontSize:10, color:'var(--text3)', fontWeight:400, marginTop:1 }}>{p.totalPackages} packages</div>
            </button>
          ))}
          {found.length > 0 && (
            <button onClick={() => { setActive(null); setSelected(new Set(found.map(f => f.pkg||f))) }} style={{
              padding:'7px 10px', borderRadius:6, textAlign:'left', cursor:'pointer', fontSize:12, fontWeight:500,
              background:'var(--red-dim)', border:'1px solid rgba(248,113,113,0.2)', color:'var(--red)'
            }}>Detected ({found.length})</button>
          )}
        </div>

        {/* Package list */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:8, overflow:'hidden' }}>
          {(active || found.length > 0) ? (
            <>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter..." style={{ flex:1, minWidth:120 }} />
                <select value={action} onChange={e => setAction(e.target.value)} style={{ fontSize:12 }}>
                  <option value="disable">Disable (safe, no root)</option>
                  <option value="uninstall">Uninstall for user</option>
                </select>
                <button className="btn btn-sm" onClick={() => setSelected(new Set(visible.map(p => p.pkg)))}>All</button>
                <button className="btn btn-sm" onClick={() => setSelected(new Set())}>None</button>
                <button className="btn btn-primary btn-sm" onClick={apply} disabled={!selected.size || busy}>
                  {busy ? '...' : `Apply (${selected.size})`}
                </button>
              </div>
              <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:2 }}>
                {visible.map(({ pkg, cat }) => (
                  <div key={pkg} onClick={() => setSelected(s => { const n = new Set(s); n.has(pkg) ? n.delete(pkg) : n.add(pkg); return n })}
                    style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:6, cursor:'pointer',
                      background: selected.has(pkg) ? 'var(--red-dim)' : 'transparent', transition:'background 0.1s' }}>
                    <Checkbox checked={selected.has(pkg)} onChange={() => {}} />
                    <span style={{ flex:1, fontSize:12, fontFamily:'var(--mono)', color:'var(--text2)' }}>{pkg}</span>
                    <span style={{ fontSize:10, color:'var(--text3)' }}>{cat}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <Empty icon=" " text="Select a preset or scan your device" />}
        </div>
      </div>
    </PageWrap>
  )
}
