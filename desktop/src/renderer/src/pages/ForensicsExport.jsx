import { useState } from 'react'
import { ft, PageWrap, PageHeader, Progress, Checkbox, Tag } from './_shared.jsx'


export default function ForensicsExport({ device, addLog }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ percent:0, message:'' })
  const [opts, setOpts] = useState({ photos:true, contacts:true, sms:true, callLog:true, whatsapp:true, appData:false, keychain:false })
  const [format, setFormat] = useState('organized')

  const serial = device?.serial || device?.udid

  const run = async () => {
    setBusy(true); setProgress({ percent:0, message:'Starting...' })
    const r = ft.on('forensics:progress', p => setProgress({ percent:p.percent||0, message:p.message||'' }))
    try {
      const res = await ft.forensics.export({ serial, type: device?.deviceType, options: opts, format })
      addLog(res.success ? 'Forensics export saved to: ' + res.dest : 'Export failed: ' + res.error)
    } catch (e) { addLog('Export: ' + e.message) }
    r(); setBusy(false)
  }

  return (
    <PageWrap>
      <PageHeader title="Forensics Export" icon=" " sub="Export device data in structured format" />

      <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', marginBottom:4 }}>What this does</div>
        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
          Exports selected data categories from your device into an organised folder structure.
          Forensic firms charge $300-$2000 for this. Omerta does it for free, on your own device.
        </div>
      </div>

      <div className="card">
        <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>Data to export</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {Object.entries(opts).map(([k, v]) => (
            <Checkbox key={k} checked={v} onChange={() => setOpts(o => ({...o, [k]:!o[k]}))}
              label={{
                photos:'Photos & Videos', contacts:'Contacts (VCF)', sms:'SMS to HTML + JSON',
                callLog:'Call Log (CSV)', whatsapp:'WhatsApp', appData:'App Data (root)',
                keychain:'Keychain (jailbroken)'
              }[k] || k} />
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Output format</div>
        <div style={{ display:'flex', gap:8 }}>
          {[['organized','Organised folders'],['timeline','Timeline view'],['cellebrite','Cellebrite-compatible']].map(([id, label]) => (
            <button key={id} onClick={() => setFormat(id)} style={{
              flex:1, padding:10, borderRadius:8, fontSize:12, cursor:'pointer',
              background: format===id ? 'var(--accent-dim)' : 'var(--bg2)',
              border:`1px solid ${format===id ? 'var(--accent-border)' : 'var(--border)'}`,
              color: format===id ? 'var(--accent)' : 'var(--text2)'
            }}>{label}</button>
          ))}
        </div>
      </div>

      {busy && <Progress {...progress} />}

      <button className="btn btn-primary" style={{ width:'fit-content' }} onClick={run} disabled={busy || !device}>
          Export Now
      </button>
    </PageWrap>
  )
}
