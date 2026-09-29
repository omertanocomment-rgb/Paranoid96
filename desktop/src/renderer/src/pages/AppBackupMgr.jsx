import { useState, useEffect } from 'react'
const ft = window.ft

function fmt(bytes) {
  if (!bytes) return '0 B'
  if (bytes > 1e6) return (bytes/1e6).toFixed(1)+' MB'
  if (bytes > 1e3) return (bytes/1e3).toFixed(0)+' KB'
  return bytes+' B'
}

export default function AppBackupMgr({ device, addLog }) {
  const [apps, setApps] = useState([])
  const [saved, setSaved] = useState([])
  const [loading, setLoading] = useState(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('backup')
  const serial = device?.serial

  useEffect(() => { loadSaved() }, [])

  const loadApps = async () => {
    if (!serial) return addLog('Connect a device')
    setLoading('apps')
    const list = await ft.apps.list({ serial }).catch(() => [])
    setApps(list.filter(a => !a.system))
    setLoading(null)
  }

  const loadSaved = async () => {
    const r = await ft.appBackup.listSaved().catch(() => ({ backups:[] }))
    setSaved(r.backups || [])
  }

  const pullApk = async (app) => {
    setLoading(app.pkg)
    const r = await ft.appBackup.pullApk({ serial, pkg: app.pkg }).catch(e => ({ error:e.message }))
    addLog(r.success ? `APK saved: ${app.name} (${fmt(r.size)})` : 'Error: '+r.error)
    setLoading(null)
    loadSaved()
  }

  const pullData = async (app) => {
    setLoading(app.pkg+'_data')
    addLog('Starting backup for '+app.name+' -- confirm on device screen...')
    const r = await ft.appBackup.pullData({ serial, pkg: app.pkg }).catch(e => ({ error:e.message }))
    addLog(r.success ? `Data backed up: ${app.name} (${fmt(r.size)})` : 'Error: '+r.error)
    setLoading(null)
    loadSaved()
  }

  const restoreApk = async () => {
    const r = await ft.appBackup.restoreApk({ serial }).catch(e => ({ error:e.message }))
    if (r.cancelled) return
    addLog(r.success ? 'APK installed from backup' : 'Install failed: '+r.error)
  }

  const filtered = apps.filter(a => !search || a.name?.toLowerCase().includes(search.toLowerCase()) || a.pkg?.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>App Backup Manager</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Per-app APK and data backup -- no root required for APKs</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3 }}>
        {[['backup','Backup'],['saved','Saved Backups']].map(([id,l]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'7px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>
        ))}
      </div>

      {tab === 'backup' && (
        <>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={loadApps} disabled={!serial||loading==='apps'} style={{ padding:'7px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>
              {loading==='apps'?'Loading...':'Load Apps'}
            </button>
            <button onClick={restoreApk} disabled={!serial} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'rgba(74,222,128,0.15)', color:'#4ade80', border:'1px solid rgba(74,222,128,0.3)', opacity:!serial?0.5:1 }}>
              Install APK from Backup
            </button>
            {apps.length > 0 && <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search apps..." style={{ flex:1 }} />}
          </div>
          {!serial && <div style={{ padding:12, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:12, color:'#f59e0b' }}>Connect an Android device.</div>}
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {filtered.map((app, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'var(--bg1)', borderRadius:8, border:'1px solid var(--border)' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{app.name||app.pkg}</div>
                  <div style={{ fontSize:10, color:'var(--text3)', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{app.pkg}</div>
                  <div style={{ fontSize:10, color:'var(--text3)' }}>v{app.version||'?'}   {app.size||'?'}</div>
                </div>
                <button onClick={() => pullApk(app)} disabled={loading===app.pkg} style={{ padding:'5px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:'rgba(96,165,250,0.15)', color:'#60a5fa', border:'1px solid rgba(96,165,250,0.3)', flexShrink:0 }}>
                  {loading===app.pkg ? '...' : 'Save APK'}
                </button>
                <button onClick={() => pullData(app)} disabled={!!loading} style={{ padding:'5px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:'rgba(167,139,250,0.15)', color:'#a78bfa', border:'1px solid rgba(167,139,250,0.3)', flexShrink:0 }}>
                  {loading===app.pkg+'_data' ? '...' : 'Backup Data'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'saved' && (
        <>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={loadSaved} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Refresh</button>
            <button onClick={() => ft.appBackup.openFolder()} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>Open Folder</button>
          </div>
          {!saved.length && <div style={{ textAlign:'center', padding:30, color:'var(--text3)' }}>No backups yet. Backup some apps first.</div>}
          {saved.map((b, i) => (
            <div key={i} style={{ padding:'12px 14px', background:'var(--bg1)', borderRadius:9, border:'1px solid var(--border)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', fontFamily:'monospace' }}>{b.pkg}</div>
                <div style={{ fontSize:11, color:'var(--text3)' }}>{fmt(b.totalSize)}</div>
              </div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {b.files.map((f,j) => (
                  <span key={j} style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>
                    {f.endsWith('.apk') ? 'APK' : f.endsWith('.ab') ? 'DATA' : f}
                  </span>
                ))}
              </div>
              {b.files.some(f=>f.endsWith('.apk')) && serial && (
                <button onClick={() => restoreApk()} style={{ marginTop:8, padding:'5px 12px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:'rgba(74,222,128,0.15)', color:'#4ade80', border:'1px solid rgba(74,222,128,0.3)' }}>Reinstall APK</button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
