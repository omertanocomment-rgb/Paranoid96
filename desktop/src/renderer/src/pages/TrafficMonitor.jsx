import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner } from './_shared.jsx'


export default function TrafficMonitor({ device, addLog }) {
  const [uidTraffic, setUidTraffic] = useState([])
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('apps')
  const serial = device?.serial

  const refresh = async () => {
    setLoading(true)
    try {
      const [uid, conn] = await Promise.all([
        ft.traffic.uid({ serial }),
        ft.traffic.connections({ serial })
      ])
      setUidTraffic(uid || [])
      setConnections(conn || [])
    } catch(e) { addLog('Traffic: ' + e.message) }
    setLoading(false)
  }

  useEffect(() => { if (serial) refresh() }, [serial])

  const fmt = bytes => {
    if (bytes > 1073741824) return (bytes/1073741824).toFixed(1) + ' GB'
    if (bytes > 1048576) return (bytes/1048576).toFixed(1) + ' MB'
    if (bytes > 1024) return (bytes/1024).toFixed(0) + ' KB'
    return bytes + ' B'
  }

  const maxTraffic = Math.max(...uidTraffic.map(u => u.rx + u.tx), 1)

  return (
    <PageWrap>
      <PageHeader title="Traffic Monitor" icon=" " sub="Per-app data usage and live network connections" />

      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <button className="btn btn-primary btn-sm" onClick={refresh} disabled={loading || !device}>
          {loading ? <Spinner size={14}/> : '  Refresh'}
        </button>
        <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3 }}>
          {[['apps','Per-App Usage'],['live','Live Connections']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding:'5px 10px', borderRadius:5, fontSize:12, cursor:'pointer',
              background: tab===id ? 'var(--bg4)' : 'none', color: tab===id ? 'var(--text)' : 'var(--text3)',
              border: tab===id ? '1px solid var(--border)' : '1px solid transparent'
            }}>{label}</button>
          ))}
        </div>
      </div>

      {tab === 'apps' && (
        <div style={{ display:'flex', flexDirection:'column', gap:4, flex:1, overflowY:'auto' }}>
          {!uidTraffic.length && !loading && <Empty icon=" " text="No traffic data" sub="Requires /proc/net/xt_qtaguid -- may need root" />}
          {uidTraffic.map((u, i) => {
            const total = u.rx + u.tx
            const pct = Math.round(total / maxTraffic * 100)
            return (
              <div key={i} style={{ padding:'8px 12px', background:'var(--bg2)', borderRadius:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:12 }}>
                  <span style={{ fontWeight:500, color:'var(--text)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{u.app}</span>
                  <span style={{ color:'var(--text3)', flexShrink:0, marginLeft:12 }}> {fmt(u.tx)}  {fmt(u.rx)}</span>
                </div>
                <div style={{ background:'var(--bg3)', borderRadius:2, height:4, overflow:'hidden' }}>
                  <div style={{ width:pct+'%', height:'100%', background:'var(--accent)', borderRadius:2 }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'live' && (
        <div style={{ flex:1, overflowY:'auto' }}>
          {!connections.length && !loading && <Empty icon=" " text="No active connections" sub="Click Refresh to check" />}
          <div style={{ fontFamily:'var(--font-mono)', fontSize:11 }}>
            {connections.map((c, i) => (
              <div key={i} style={{ display:'flex', gap:10, padding:'5px 8px', borderBottom:'1px solid var(--border)', color:'var(--text2)' }}>
                <span style={{ color:'var(--text3)', width:50 }}>{c.proto}</span>
                <span style={{ flex:1 }}>{c.local}</span>
                <span style={{ flex:1, color:'var(--accent)' }}>  {c.remote}</span>
                <span style={{ color:'var(--green)' }}>{c.state}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageWrap>
  )
}
