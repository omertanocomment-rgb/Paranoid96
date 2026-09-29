import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner, Tag } from './_shared.jsx'


export default function AppManager({ device, addLog }) {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!device) return
    setLoading(true)
    try {
      const list = await ft.apps.list({ serial: device.serial || device.udid, type: device.deviceType })
      setApps(list || [])
    } catch (e) { addLog('Apps: ' + e.message) }
    setLoading(false)
  }

  useEffect(() => { load() }, [device?.serial, device?.udid])

  const visible = apps.filter(a => {
    if (!showSystem && a.isSystem) return false
    if (filter && !a.pkg?.toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  const act = async (label, fn) => {
    setBusy(true)
    try { await fn(); addLog(`${label}: ${selected.pkg}`); load() }
    catch (e) { addLog(`${label} failed: ${e.message}`) }
    setBusy(false)
  }

  const serial = device?.serial || device?.udid

  return (
    <PageWrap>
      <PageHeader title="App Manager" icon=" " sub={device ? `${apps.length} apps on ${device.model || device.name}` : 'No device'} />

      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter packages..." style={{ flex:1 }} />
        <button className="btn btn-sm" onClick={() => setShowSystem(s => !s)}
          style={{ background: showSystem ? 'var(--accent-dim)' : undefined, color: showSystem ? 'var(--accent)' : undefined }}>
          System
        </button>
        <button className="btn btn-sm" onClick={load}>{loading ? '...' : ' '}</button>
      </div>

      <div style={{ display:'flex', gap:12, flex:1, overflow:'hidden', minHeight:300 }}>
        <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:2 }}>
          {loading && <Empty icon="" text="Loading..." />}
          {!loading && !visible.length && <Empty icon=" " text="No apps found" />}
          {visible.map(a => (
            <div key={a.pkg} onClick={() => setSelected(a)}
              style={{ padding:'7px 12px', borderRadius:6, cursor:'pointer', display:'flex', alignItems:'center', gap:8,
                background: selected?.pkg === a.pkg ? 'var(--accent-dim)' : 'var(--bg2)',
                border: `1px solid ${selected?.pkg === a.pkg ? 'var(--accent-border)' : 'transparent'}`,
                transition:'all 0.1s' }}>
              <span style={{ flex:1, fontSize:12, fontFamily:'var(--mono)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text)' }}>{a.pkg}</span>
              {a.isSystem && <Tag>sys</Tag>}
              {a.isDisabled && <Tag color="red">off</Tag>}
            </div>
          ))}
        </div>

        {selected && (
          <div className="card" style={{ width:200, flexShrink:0, display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ fontSize:11, fontFamily:'var(--mono)', color:'var(--text2)', wordBreak:'break-all', marginBottom:4 }}>{selected.pkg}</div>
            {[
              ['Force Stop', () => ft.apps.forceStop({ serial, pkg: selected.pkg })],
              ['Clear Data', () => ft.apps.clearData({ serial, pkg: selected.pkg })],
              [selected.isDisabled ? 'Enable' : 'Disable', () => selected.isDisabled ? ft.apps.enable({ serial, pkg: selected.pkg }) : ft.apps.disable({ serial, pkg: selected.pkg })],
              ['Extract APK', () => ft.apps.extract({ serial, type: device.deviceType, pkg: selected.pkg })],
              ['Uninstall', () => ft.apps.uninstall({ serial, type: device.deviceType, pkg: selected.pkg })],
            ].map(([label, fn]) => (
              <button key={label} disabled={busy}
                className={`btn btn-sm ${label === 'Uninstall' ? 'btn-red' : label === 'Extract APK' ? 'btn-blue' : ''}`}
                style={{ width:'100%', justifyContent:'center' }}
                onClick={() => act(label, fn)}>{busy ? '...' : label}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize:11, color:'var(--text3)' }}>{visible.length} of {apps.length} apps shown</div>
    </PageWrap>
  )
}
