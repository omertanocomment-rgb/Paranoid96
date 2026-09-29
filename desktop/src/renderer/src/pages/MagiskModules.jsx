import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Progress, Tag } from './_shared.jsx'


export default function MagiskModules({ device, addLog }) {
  const [status, setStatus] = useState(null)
  const [modules, setModules] = useState([])
  const [installed, setInstalled] = useState([])
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ percent:0, message:'' })
  const [tab, setTab] = useState('browse')

  const serial = device?.serial

  useEffect(() => {
    ft.magisk.modules().then(setModules).catch(() => {})
    if (serial) ft.magisk.status({ serial }).then(s => { setStatus(s); setInstalled(s.installedModules || []) }).catch(() => {})
  }, [serial])

  useEffect(() => {
    const r = ft.on('magisk:progress', p => setProgress({ percent:p.percent||0, message:p.message||'' }))
    return r
  }, [])

  const install = async (module) => {
    if (!serial) return addLog('No device connected')
    setBusy(true)
    try {
      await ft.magisk.install({ serial, moduleId: module.id, downloadUrl: module.downloadUrl })
      addLog('Installed: ' + module.name)
      ft.magisk.status({ serial }).then(s => setInstalled(s.installedModules || []))
    } catch (e) { addLog('Install failed: ' + e.message) }
    setBusy(false)
  }

  const toggle = async (moduleId, enable) => {
    try {
      await ft.magisk.toggle({ serial, moduleId, enable })
      addLog((enable ? 'Enabled' : 'Disabled') + ': ' + moduleId)
      ft.magisk.status({ serial }).then(s => setInstalled(s.installedModules || []))
    } catch (e) { addLog(e.message) }
  }

  const remove = async (moduleId) => {
    try {
      await ft.magisk.remove({ serial, moduleId })
      addLog('Removed: ' + moduleId)
      setInstalled(ins => ins.filter(m => m.id !== moduleId))
    } catch (e) { addLog(e.message) }
  }

  const visible = modules.filter(m => !filter || m.name.toLowerCase().includes(filter.toLowerCase()) || m.description?.toLowerCase().includes(filter.toLowerCase()))

  return (
    <PageWrap>
      <PageHeader title="Magisk Modules" icon=" " sub="Browse and manage Magisk modules" />

      {status && (
        <div className="card" style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:11, color:'var(--text3)' }}>Magisk Version</div>
            <div style={{ fontSize:16, fontWeight:600, color: status.installed ? 'var(--green)' : 'var(--red)' }}>
              {status.installed ? status.version || 'Installed' : 'Not detected'}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text3)' }}>ZygiskEnabled</div>
            <div style={{ fontSize:14, color: status.zygisk ? 'var(--green)' : 'var(--text3)' }}>{status.zygisk ? 'Yes' : 'No'}</div>
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--text3)' }}>Modules installed</div>
            <div style={{ fontSize:14, color:'var(--text)' }}>{installed.length}</div>
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3, width:'fit-content' }}>
        {[['browse','Browse'],['installed','Installed']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:'6px 12px', borderRadius:6, fontSize:12, fontWeight:500, cursor:'pointer',
            background: tab===id ? 'var(--bg4)' : 'none',
            color: tab===id ? 'var(--text)' : 'var(--text3)',
            border: tab===id ? '1px solid var(--border)' : '1px solid transparent'
          }}>{label} {id === 'installed' ? `(${installed.length})` : ''}</button>
        ))}
      </div>

      {tab === 'browse' && (
        <>
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search modules..." />
          <div style={{ flex:1, overflowY:'auto', minHeight:200, display:'flex', flexDirection:'column', gap:6 }}>
            {!visible.length && <Empty icon=" " text="No modules found" />}
            {visible.map((m, i) => (
              <div key={i} className="card" style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:500, marginBottom:2 }}>{m.name}</div>
                  <div style={{ fontSize:12, color:'var(--text3)', marginBottom:6 }}>{m.description}</div>
                  <div style={{ display:'flex', gap:4 }}>
                    {m.version && <Tag>{m.version}</Tag>}
                    {m.author && <Tag color="blue">{m.author}</Tag>}
                  </div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => install(m)} disabled={busy || !serial}>
                  Install
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'installed' && (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {!installed.length && <Empty icon=" " text="No modules installed" sub="Browse and install modules from the Browse tab" />}
          {installed.map((m, i) => (
            <div key={i} className="card" style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:500 }}>{m.name || m.id}</div>
                <div style={{ fontSize:11, color:'var(--text3)' }}>{m.version}</div>
              </div>
              <Tag color={m.enabled ? 'green' : 'gray'}>{m.enabled ? 'On' : 'Off'}</Tag>
              <button className="btn btn-sm" onClick={() => toggle(m.id, !m.enabled)}>{m.enabled ? 'Disable' : 'Enable'}</button>
              <button className="btn btn-red btn-sm" onClick={() => remove(m.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {busy && <Progress {...progress} />}
    </PageWrap>
  )
}
