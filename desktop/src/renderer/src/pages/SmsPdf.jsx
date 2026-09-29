import { useState } from 'react'
import { ft, PageWrap, PageHeader, Progress } from './_shared.jsx'


export default function SmsPdf({ device, addLog }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ percent:0, message:'' })
  const [address, setAddress] = useState('')

  const serial = device?.serial

  const exportAll = async () => {
    if (!serial) return addLog('No device connected')
    setBusy(true); setProgress({ percent:0, message:'Reading SMS...' })
    const r = ft.on('smspdf:progress', p => setProgress({ percent:p.percent||0, message:p.message||'' }))
    try {
      const res = await ft.media.exportSms({ serial, all: true })
      addLog(res.success ? `Exported ${res.exported} threads` : res.error)
    } catch (e) { addLog('SMS export: ' + e.message) }
    r(); setBusy(false)
  }

  const exportOne = async () => {
    if (!address) return addLog('Enter a phone number or contact name')
    setBusy(true)
    try {
      const res = await ft.media.exportSms({ serial, address, all: false })
      addLog(res.success ? 'Exported: ' + res.path : res.error)
    } catch (e) { addLog('SMS export: ' + e.message) }
    setBusy(false)
  }

  return (
    <PageWrap>
      <PageHeader title="SMS to PDF" icon=" " sub="Export message threads as readable PDF files" />

      <div className="card">
        <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Export all threads</div>
        <div style={{ fontSize:12, color:'var(--text3)', marginBottom:12 }}>
          Exports every SMS/MMS conversation to individual PDFs with timestamps and bubble layout.
          Useful for legal records, personal archiving, or changing devices.
        </div>
        <button className="btn btn-primary" onClick={exportAll} disabled={busy || !device}>
            Export All SMS to PDF
        </button>
      </div>

      <div className="card">
        <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Export single conversation</div>
        <div style={{ display:'flex', gap:8 }}>
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Phone number or address" style={{ flex:1 }} />
          <button className="btn btn-primary" onClick={exportOne} disabled={busy || !device}>Export</button>
        </div>
      </div>

      {busy && <Progress {...progress} />}
    </PageWrap>
  )
}
