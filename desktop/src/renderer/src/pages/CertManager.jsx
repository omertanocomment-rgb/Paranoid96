import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Tag } from './_shared.jsx'


export default function CertManager({ device, addLog }) {
  const [userCerts, setUserCerts] = useState([])
  const [sysCerts, setSysCerts] = useState([])
  const [tab, setTab] = useState('user')
  const serial = device?.serial

  const load = async () => {
    const [u, s] = await Promise.all([
      ft.certs.listUser({ serial }).catch(() => []),
      ft.certs.listSystem({ serial }).catch(() => [])
    ])
    setUserCerts(u); setSysCerts(s)
  }

  useEffect(() => { if (serial) load() }, [serial])

  const install = async () => {
    const r = await ft.certs.install({ serial }).catch(e => ({ error: e.message }))
    if (!r?.cancelled) { addLog(r.note || r.error || 'Certificate install initiated'); load() }
  }

  const remove = async (certFile) => {
    await ft.certs.remove({ serial, certFile })
    addLog('Removed: ' + certFile)
    load()
  }

  const mitmInfo = async (type) => {
    const r = await ft.certs.mitmInfo({ serial, type })
    addLog(r.note || 'Done')
  }

  const certs = tab === 'user' ? userCerts : sysCerts.slice(0, 20)

  return (
    <PageWrap>
      <PageHeader title="Certificate Manager" icon=" " sub="Install and manage CA certificates for proxy/testing" />

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={install} disabled={!device}>+ Install Certificate</button>
        <button className="btn btn-sm" onClick={load} disabled={!device}>  Refresh</button>
      </div>

      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        {['charles','burp','mitmproxy'].map(t => (
          <button key={t} className="btn btn-sm" onClick={() => mitmInfo(t)} style={{ textTransform:'capitalize' }}>
              {t} Setup Guide
          </button>
        ))}
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3, width:'fit-content' }}>
        {[['user',`User (${userCerts.length})`],['system',`System (${sysCerts.length})`]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:'6px 12px', borderRadius:6, fontSize:12, cursor:'pointer',
            background: tab===id ? 'var(--bg4)' : 'none', color: tab===id ? 'var(--text)' : 'var(--text3)',
            border: tab===id ? '1px solid var(--border)' : '1px solid transparent'
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:4, flex:1, overflowY:'auto' }}>
        {!certs.length && <Empty icon=" " text="No certificates" sub={tab==='user' ? 'Install user certificates via button above' : 'System certs shown here'} />}
        {certs.map((c, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--bg2)', borderRadius:6 }}>
            <span style={{ fontSize:18 }}> </span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text)' }}>{c.file}</div>
              <Tag color={c.type==='user' ? 'amber' : 'gray'}>{c.type}</Tag>
            </div>
            {c.type === 'user' && <button className="btn btn-red btn-sm" onClick={() => remove(c.file)}>Remove</button>}
          </div>
        ))}
      </div>
    </PageWrap>
  )
}
