import { useState } from 'react'
const ft = window.ft

export default function AppBackupManager({ device, addLog }) {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(new Set())
  const serial = device?.serial

  const loadApps = async () => {
    if (!serial) return addLog('Connect a device first')
    setLoading(true)
    const r = await ft.appBackup.list({ serial }).catch(e => ({ error: e.message }))
    if (r.success) setApps(r.apps)
    else addLog('Error: ' + r.error)
    setLoading(false)
  }

  const toggle = (pkg) => setSelected(prev => {
    const next = new Set(prev)
    next.has(pkg) ? next.delete(pkg) : next.add(pkg)
    return next
  })

  const selectAll = () => setSelected(new Set(filtered.map(a => a.pkg)))
  const clearSel = () => setSelected(new Set())

  const pullApk = async (pkg) => {
    setWorking(pkg)
    const r = await ft.appBackup.pullApk({ serial, pkg }).catch(e => ({ error: e.message }))
    addLog(r.cancelled ? 'Cancelled' : r.success ? `APK saved: ${r.dest}` : 'Error: ' + r.error)
    setWorking(null)
  }

  const backupData = async (pkg) => {
    setWorking(pkg + '_data')
    const r = await ft.appBackup.backupData({ serial, pkg }).catch(e => ({ error: e.message }))
    addLog(r.cancelled ? 'Cancelled' : r.success ? `Data backup saved: ${r.dest}` : 'Error: ' + r.error)
    setWorking(null)
  }

  const bulkPullApks = async () => {
    const pkgs = [...selected]
    addLog(`Pulling ${pkgs.length} APKs...`)
    for (const pkg of pkgs) {
      setWorking(pkg)
      const r = await ft.appBackup.pullApk({ serial, pkg }).catch(e => ({ error: e.message }))
      addLog(r.cancelled ? 'Cancelled' : r.success ? `Saved: ${pkg}` : `Failed: ${pkg} - ${r.error}`)
      if (r.cancelled) break
    }
    setWorking(null)
    addLog('Bulk APK pull done')
  }

  const restore = async () => {
    const r = await ft.appBackup.restore({ serial }).catch(e => ({ error: e.message }))
    addLog(r.cancelled ? 'Cancelled' : r.success ? 'Restored successfully' : 'Error: ' + r.error)
  }

  const filtered = apps.filter(a => !search || a.pkg.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 24 }}> </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>App Backup Manager</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Extract APKs and backup app data individually</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={loadApps} disabled={loading || !serial} style={{ padding: '7px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--accent)', color: '#000', border: 'none', opacity: !serial ? 0.5 : 1 }}>
          {loading ? 'Loading...' : 'Load Apps'}
        </button>
        {apps.length > 0 && <>
          <button onClick={selectAll} style={{ padding: '7px 12px', borderRadius: 7, fontSize: 11, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)' }}>Select All</button>
          <button onClick={clearSel} style={{ padding: '7px 12px', borderRadius: 7, fontSize: 11, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)' }}>Clear</button>
          {selected.size > 0 && <button onClick={bulkPullApks} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}>
            Pull {selected.size} APK{selected.size > 1 ? 's' : ''}
          </button>}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter packages..." style={{ flex: 1, minWidth: 140 }} />
        </>}
        <button onClick={restore} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)' }}>
          Restore from File
        </button>
      </div>

      {!serial && <div style={{ padding: 14, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, fontSize: 13, color: '#f59e0b' }}>Connect an Android device.</div>}

      {apps.length > 0 && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{filtered.length} apps   {selected.size} selected</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map((app, i) => {
          const isSel = selected.has(app.pkg)
          const isWorking = working === app.pkg || working === app.pkg + '_data'
          return (
            <div key={i} onClick={() => toggle(app.pkg)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: isSel ? 'rgba(var(--accent-rgb),0.08)' : 'var(--bg1)', borderRadius: 8, border: `1px solid ${isSel ? 'var(--accent-border)' : 'var(--border)'}`, cursor: 'pointer' }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`, background: isSel ? 'var(--accent)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isSel && <span style={{ fontSize: 10, color: '#000', fontWeight: 700 }}>v</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.pkg}</div>
                {app.ver && <div style={{ fontSize: 10, color: 'var(--text3)' }}>v{app.ver}</div>}
              </div>
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                <button onClick={e => { e.stopPropagation(); pullApk(app.pkg) }} disabled={isWorking}
                  style={{ padding: '4px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}>
                  {working === app.pkg ? '...' : 'APK'}
                </button>
                <button onClick={e => { e.stopPropagation(); backupData(app.pkg) }} disabled={isWorking}
                  style={{ padding: '4px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)' }}>
                  {working === app.pkg + '_data' ? '...' : 'Data'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
