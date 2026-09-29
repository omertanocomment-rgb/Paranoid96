import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Progress, Checkbox } from './_shared.jsx'


export default function CrossTransfer({ device, addLog }) {
  const [devices, setDevices] = useState([])
  const [source, setSource] = useState(null)
  const [dest, setDest] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ percent:0, message:'' })
  const [opts, setOpts] = useState({ photos:true, contacts:true, sms:true, apps:false, whatsapp:true })

  useEffect(() => {
    ft.transfer.devices().then(setDevices).catch(() => {})
    const r = ft.on('transfer:progress', p => setProgress({ percent:p.percent||0, message:p.message||'' }))
    return r
  }, [])

  const transfer = async () => {
    if (!source || !dest) return addLog('Select source and destination devices')
    setBusy(true); setProgress({ percent:0, message:'Starting transfer...' })
    try {
      const res = await ft.transfer.start({
        sourceSerial: source.serial || source.udid, sourceType: source.deviceType,
        destSerial: dest.serial || dest.udid, destType: dest.deviceType, options: opts
      })
      addLog(res.success ? 'Transfer complete!' : 'Transfer: ' + res.error)
    } catch (e) { addLog('Transfer: ' + e.message) }
    setBusy(false)
  }

  const DeviceBtn = ({ d, active, onClick, label }) => (
    <button onClick={onClick} style={{
      flex:1, padding:14, borderRadius:10, cursor:'pointer', textAlign:'left',
      background: active ? 'var(--accent-dim)' : 'var(--bg2)',
      border:`1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
      color: active ? 'var(--accent)' : 'var(--text2)'
    }}>
      <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>{label}</div>
      {d ? <>
        <div style={{ fontSize:14, fontWeight:600, color: active ? 'var(--accent)' : 'var(--text)' }}>{d.model || d.name || d.serial?.slice(0,12)}</div>
        <div style={{ fontSize:11, marginTop:2 }}>{d.deviceType === 'ios' ? '  iOS' : '  Android'}   {d.ios || d.androidVer || ''}</div>
      </> : <div style={{ fontSize:13, color:'var(--text3)' }}>Select device</div>}
    </button>
  )

  return (
    <PageWrap>
      <PageHeader title="Cross-Device Transfer" icon=" " sub="Move data between any Android and iOS devices" />

      <div style={{ display:'flex', gap:12, alignItems:'center' }}>
        <DeviceBtn d={source} active={!!source} label="SOURCE" onClick={() => {}} />
        <div style={{ fontSize:24, color:'var(--text3)' }}> </div>
        <DeviceBtn d={dest} active={!!dest} label="DESTINATION" onClick={() => {}} />
      </div>

      {devices.length > 0 && (
        <div className="card">
          <div style={{ fontSize:12, fontWeight:600, color:'var(--text3)', marginBottom:8 }}>CONNECTED DEVICES -- click to set source / destination</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {devices.map((d, i) => (
              <div key={i} style={{ display:'flex', gap:8, alignItems:'center', padding:'7px 0', borderBottom:'1px solid var(--border)' }}>
                <span style={{ fontSize:16 }}>{d.deviceType === 'ios' ? ' ' : ' '}</span>
                <span style={{ flex:1, fontSize:13 }}>{d.model || d.name || d.serial?.slice(0,12)}</span>
                <button className="btn btn-sm" onClick={() => setSource(d)}>Set Source</button>
                <button className="btn btn-sm" onClick={() => setDest(d)}>Set Dest</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>What to transfer</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {Object.entries(opts).map(([k, v]) => (
            <Checkbox key={k} checked={v} onChange={() => setOpts(o => ({...o, [k]:!o[k]}))}
              label={{ photos:'Photos & Videos', contacts:'Contacts', sms:'SMS Messages', apps:'Apps', whatsapp:'WhatsApp' }[k] || k} />
          ))}
        </div>
      </div>

      {busy && <Progress {...progress} />}

      <button className="btn btn-primary" style={{ width:'fit-content' }} onClick={transfer} disabled={busy || !source || !dest}>
          Start Transfer
      </button>
    </PageWrap>
  )
}
