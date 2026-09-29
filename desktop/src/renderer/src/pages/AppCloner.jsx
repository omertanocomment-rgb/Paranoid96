import { useState } from 'react'
const ft = window.ft

export default function AppCloner({ device, addLog }) {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(false)
  const [cloning, setCloning] = useState(null)
  const [search, setSearch] = useState('')
  const serial = device?.serial

  const loadApps = async () => {
    if (!serial) return addLog('Connect a device first')
    setLoading(true)
    const list = await ft.apps.list({ serial }).catch(() => [])
    setApps(list.filter(a => !a.system))
    setLoading(false)
  }

  const clone = async (app) => {
    setCloning(app.pkg)
    const r = await ft.appClone.clone({ serial, pkg: app.pkg }).catch(e => ({ error: e.message }))
    addLog(r.success ? `Cloned ${app.name || app.pkg}` : (r.error || r.note || 'Clone failed'))
    setCloning(null)
  }

  const filtered = apps.filter(a => !search || a.name?.toLowerCase().includes(search.toLowerCase()) || a.pkg?.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>App Cloner</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Run two instances of any app using Android multi-user</div>
        </div>
      </div>
      <div style={{ padding:10, background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:8, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
        Uses Android multi-user (user profile 10) to create a second app instance. Requires Android 5+. Not all apps support cloning. Alternative: use Parallel Space or Dual Space apps from Play Store.
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={loadApps} disabled={loading||!serial} style={{ padding:'8px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
          {loading ? 'Loading...' : 'Load Apps'}
        </button>
        {apps.length > 0 && <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search apps..." style={{ flex:1 }} />}
      </div>
      {!serial && <div style={{ padding:14, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>Connect an Android device.</div>}
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {filtered.map((app, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', background:'var(--bg1)', borderRadius:8, border:'1px solid var(--border)' }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{app.name || app.pkg}</div>
              <div style={{ fontSize:10, color:'var(--text3)', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{app.pkg}</div>
            </div>
            <button onClick={() => clone(app)} disabled={cloning===app.pkg}
              style={{ padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'rgba(96,165,250,0.15)', color:'#60a5fa', border:'1px solid rgba(96,165,250,0.3)', flexShrink:0 }}>
              {cloning===app.pkg ? 'Cloning...' : 'Clone'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
