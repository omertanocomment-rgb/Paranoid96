import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Progress, Checkbox } from './_shared.jsx'


export default function Backup({ device, addLog }) {
  const [tab, setTab] = useState('backup')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ percent:0, message:'' })
  const [opts, setOpts] = useState({ allApps:true, apks:true, media:true, contacts:true, sms:true })

  useEffect(() => {
    const r = ft.on('backup:progress', p => setProgress({ percent:p.percent||0, message:p.message||'' }))
    return r
  }, [])

  const serial = device?.serial || device?.udid

  const doBackup = async () => {
    setBusy(true); setProgress({ percent:0, message:'Starting...' })
    try {
      const r = await ft.backup.create({ serial, type: device.deviceType, options: opts })
      if (!r?.cancelled) addLog('Backup saved: ' + r.path)
    } catch (e) { addLog('Backup failed: ' + e.message) }
    setBusy(false)
  }

  const doRestore = async () => {
    setBusy(true)
    try {
      const r = await ft.backup.restore({ serial, type: device.deviceType })
      if (!r?.cancelled) addLog('Restore complete')
    } catch (e) { addLog('Restore failed: ' + e.message) }
    setBusy(false)
  }

  return (
    <PageWrap>
      <PageHeader title="Backup & Restore" icon=" " sub="Local backup -- no cloud required" />

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3, width:'fit-content' }}>
        {[['backup','  Backup'],['restore','  Restore']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:'6px 14px', borderRadius:6, fontSize:13, fontWeight:500, cursor:'pointer',
            background: tab===id ? 'var(--bg4)' : 'none',
            color: tab===id ? 'var(--text)' : 'var(--text3)',
            border: tab===id ? '1px solid var(--border)' : '1px solid transparent'
          }}>{label}</button>
        ))}
      </div>

      {tab === 'backup' && (
        <>
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>What to include</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {Object.entries(opts).map(([k, v]) => (
                <Checkbox key={k} checked={v} onChange={() => setOpts(o => ({...o, [k]:!o[k]}))}
                  label={k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())} />
              ))}
            </div>
          </div>
          {busy && <Progress {...progress} />}
          <button className="btn btn-primary" style={{ width:'fit-content' }} onClick={doBackup} disabled={busy || !device}>
            {busy ? 'Backing up...' : '  Create Backup'}
          </button>
        </>
      )}

      {tab === 'restore' && (
        <>
          <div className="card" style={{ background:'var(--red-dim)', border:'1px solid rgba(248,113,113,0.2)' }}>
            <div style={{ fontSize:13, color:'var(--red)', fontWeight:600, marginBottom:4 }}>  Warning</div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>Restoring overwrites data on the device. Make sure you select the correct backup file.</div>
          </div>
          <button className="btn btn-primary" style={{ width:'fit-content' }} onClick={doRestore} disabled={busy || !device}>
              Choose Backup & Restore
          </button>
        </>
      )}
    </PageWrap>
  )
}
