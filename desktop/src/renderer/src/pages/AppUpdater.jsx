import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner, Tag } from './_shared.jsx'


export default function AppUpdater({ device, addLog }) {
  const [installed, setInstalled] = useState([])
  const [updates, setUpdates] = useState([])
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState({ current:0, total:0, pkg:'' })

  const serial = device?.serial

  useEffect(() => {
    const r = ft.on('appupdate:progress', p => setProgress(p))
    return r
  }, [])

  const loadInstalled = async () => {
    if (!serial) return
    try {
      const list = await ft.appupdate.installed({ serial })
      setInstalled(list || [])
    } catch (e) { addLog('Load apps: ' + e.message) }
  }

  useEffect(() => { loadInstalled() }, [serial])

  const checkUpdates = async () => {
    if (!serial) return addLog('No device connected')
    setChecking(true)
    setUpdates([])
    try {
      const res = await ft.appupdate.check({ serial })
      setUpdates(res || [])
      addLog(`${(res||[]).filter(u=>u.hasUpdate).length} updates found`)
    } catch (e) { addLog('Update check: ' + e.message) }
    setChecking(false)
  }

  const checkFdroid = async () => {
    setChecking(true)
    try {
      const res = await ft.appupdate.fdroid({ serial })
      setUpdates(res || [])
      addLog(`F-Droid: ${(res||[]).length} updates`)
    } catch (e) { addLog('F-Droid: ' + e.message) }
    setChecking(false)
  }

  const withUpdates = updates.filter(u => u.hasUpdate)
  const upToDate = updates.filter(u => !u.hasUpdate && u.checked)

  return (
    <PageWrap>
      <PageHeader title="App Updates" icon=" " sub="Check for updates outside the Play Store" />

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button className="btn btn-primary" onClick={checkUpdates} disabled={checking || !device}>
          {checking ? <><Spinner size={14} /> Checking...</> : '  Check All Apps'}
        </button>
        <button className="btn btn-blue" onClick={checkFdroid} disabled={checking || !device}>
            F-Droid Updates
        </button>
        <span style={{ fontSize:12, color:'var(--text3)', display:'flex', alignItems:'center' }}>
          {installed.length} apps installed
        </span>
      </div>

      {checking && progress.total > 0 && (
        <div style={{ fontSize:12, color:'var(--text3)' }}>
          Checking {progress.current}/{progress.total}: {progress.pkg}
        </div>
      )}

      {withUpdates.length > 0 && (
        <div>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:8 }}>
            Updates Available ({withUpdates.length})
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {withUpdates.map((u, i) => (
              <div key={i} className="card" style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderLeft:'3px solid var(--accent)' }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:500, fontFamily:'var(--mono)' }}>{u.pkg}</div>
                  <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
                    Current: {u.currentVersion}   New: {u.version}   {u.source}
                  </div>
                </div>
                {u.downloadUrl && <button className="btn btn-primary btn-sm" onClick={() => ft.openUrl(u.downloadUrl)}>Download  </button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!checking && updates.length > 0 && withUpdates.length === 0 && (
        <div className="card" style={{ background:'var(--green-dim)', border:'1px solid rgba(74,222,128,0.2)' }}>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--green)' }}>  All apps are up to date</div>
        </div>
      )}

      {!updates.length && !checking && <Empty icon=" " text="Click Check to scan installed apps for updates" sub="Checks APKMirror, APKPure, and F-Droid" />}
    </PageWrap>
  )
}
