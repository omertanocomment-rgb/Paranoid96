import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Progress, Tag } from './_shared.jsx'


export default function OTAInterceptor({ device, addLog }) {
  const [otaInfo, setOtaInfo] = useState(null)
  const [sources, setSources] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ percent:0, message:'' })

  const serial = device?.serial

  useEffect(() => {
    if (!device) return
    const r = ft.on('ota:progress', p => setProgress({ percent:p.percent||0, message:p.message||'' }))
    ft.ota.info({ serial }).then(setOtaInfo).catch(() => {})
    return r
  }, [serial])

  const save = async () => {
    if (!otaInfo?.url) return addLog('No OTA URL detected')
    setBusy(true)
    try {
      const res = await ft.ota.save({ serial, url: otaInfo.url, filename: otaInfo.filename })
      addLog(res.success ? 'OTA saved: ' + res.path : 'Save failed: ' + res.error)
    } catch (e) { addLog('OTA save: ' + e.message) }
    setBusy(false)
  }

  const loadSources = async () => {
    if (!device) return
    try {
      const info = await ft.device.info({ serial, type: device.deviceType })
      const res = await ft.ota.sources({ brand: info.brand, device: info.model })
      setSources(res)
    } catch (e) { addLog('Sources: ' + e.message) }
  }

  return (
    <PageWrap>
      <PageHeader title="OTA Interceptor" icon=" " sub="Capture and save OTA update packages before they expire" />

      <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', marginBottom:4 }}>Why save OTA packages?</div>
        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
          OTA packages can be used to downgrade or sideload firmware. Once a version is no longer signed, you can't get it from official sources. Save it now.
        </div>
      </div>

      {otaInfo ? (
        <div className="card">
          <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Detected OTA Update</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:12 }}>
            {[['Version', otaInfo.version], ['Size', otaInfo.size], ['Type', otaInfo.type]].filter(([,v]) => v).map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ fontSize:12, color:'var(--text3)' }}>{k}</span>
                <span style={{ fontSize:12, color:'var(--text2)' }}>{v}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={save} disabled={busy}>  Save OTA Package</button>
        </div>
      ) : (
        <div className="card">
          <div style={{ fontSize:13, color:'var(--text3)', marginBottom:8 }}>No pending OTA detected on device.</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Check Settings   System   Software Update on your device to trigger one, then come back here.</div>
        </div>
      )}

      {busy && <Progress {...progress} />}

      <div className="card">
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
          <div style={{ fontSize:13, fontWeight:600 }}>Manual OTA Sources</div>
          <button className="btn btn-sm" onClick={loadSources}>Load</button>
        </div>
        {sources ? (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {(sources.methods || []).map((m, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13 }}>{m.name}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{m.description || m.type}</div>
                </div>
                <button className="btn btn-sm" onClick={() => ft.openUrl(m.url)}>Open  </button>
              </div>
            ))}
          </div>
        ) : <div style={{ fontSize:12, color:'var(--text3)' }}>Click Load to see OTA sources for your device</div>}
      </div>
    </PageWrap>
  )
}
