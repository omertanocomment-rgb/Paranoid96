import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Tag } from './_shared.jsx'


export default function MockLocation({ device, addLog }) {
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [accuracy, setAccuracy] = useState(5)
  const [presets, setPresets] = useState([])
  const [active, setActive] = useState(false)
  const serial = device?.serial

  useEffect(() => { ft.mockloc.presets().then(setPresets).catch(() => {}) }, [])

  const enable = async () => {
    const r = await ft.mockloc.enable({ serial }).catch(e => ({ error: e.message }))
    addLog(r.note || r.error || 'Mock location enabled')
  }

  const setLoc = async () => {
    if (!lat || !lng) return addLog('Enter latitude and longitude')
    const r = await ft.mockloc.set({ serial, lat: parseFloat(lat), lng: parseFloat(lng), accuracy }).catch(e => ({ error: e.message }))
    if (!r.error) { setActive(true); addLog(`Location set: ${lat}, ${lng}`) }
    else addLog('Set location: ' + r.error)
  }

  const stop = async () => {
    await ft.mockloc.stop({ serial })
    setActive(false)
    addLog('Mock location stopped')
  }

  return (
    <PageWrap>
      <PageHeader title="Mock Location" icon=" " sub="Set fake GPS coordinates for testing" />

      <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', marginBottom:4 }}>Setup Required</div>
        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>Enable Developer Options on the device, then set a mock location app in Settings   Developer Options   Mock location app. After that, use the controls below.
        </div>
        <button className="btn btn-sm btn-blue" style={{ marginTop:8 }} onClick={enable} disabled={!device}>Enable on Device</button>
      </div>

      <div className="card">
        <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>Set Location</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:8, marginBottom:10 }}>
          <div><div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Latitude</div><input value={lat} onChange={e => setLat(e.target.value)} placeholder="-33.8688" style={{ width:'100%' }} /></div>
          <div><div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Longitude</div><input value={lng} onChange={e => setLng(e.target.value)} placeholder="151.2093" style={{ width:'100%' }} /></div>
          <div><div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Accuracy (m)</div><input type="number" value={accuracy} onChange={e => setAccuracy(+e.target.value)} style={{ width:70 }} /></div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-primary" onClick={setLoc} disabled={!device}>  Set Location</button>
          {active && <button className="btn btn-red" onClick={stop}>  Stop Mock</button>}
          {active && <Tag color="green">  Active</Tag>}
        </div>
      </div>

      <div>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Preset Locations</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
          {presets.map((p, i) => (
            <button key={i} onClick={() => { setLat(String(p.lat)); setLng(String(p.lng)) }}
              style={{ padding:'10px 14px', textAlign:'left', borderRadius:8, cursor:'pointer',
                background:'var(--bg2)', border:'1px solid var(--border)', color:'var(--text2)', fontSize:12,
                transition:'all 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor='var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}>
              <div style={{ fontWeight:500, color:'var(--text)', marginBottom:2 }}>{p.name}</div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)' }}>{p.lat}, {p.lng}</div>
            </button>
          ))}
        </div>
      </div>
    </PageWrap>
  )
}
