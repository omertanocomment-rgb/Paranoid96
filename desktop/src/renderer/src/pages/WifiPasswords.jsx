import { useState } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner } from './_shared.jsx'


export default function WifiPasswords({ device, addLog }) {
  const [networks, setNetworks] = useState([])
  const [loading, setLoading] = useState(false)
  const [show, setShow] = useState({})

  const extract = async () => {
    if (!device?.serial) return
    setLoading(true)
    const nets = await ft.wifi.extract({ serial: device.serial }).catch(e => { addLog(e.message); return [] })
    setNetworks(nets)
    addLog(`Found ${nets.length} saved networks`)
    setLoading(false)
  }

  const exportCsv = async () => {
    const r = await ft.wifi.export({ networks })
    if (!r?.cancelled) addLog('Exported: ' + r?.path)
  }

  return (
    <PageWrap>
      <PageHeader title="Wi-Fi Passwords" icon=" " sub="Extract saved Wi-Fi passwords from your device" />

      <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', marginBottom:4 }}>Your Device Only</div>
        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
          Extracts saved Wi-Fi passwords from /data/misc/wifi/ or wpa_supplicant.conf on your own device. 
          Requires root access for password extraction on Android 10+.
          On older devices, wpa_supplicant.conf may be accessible without root.
        </div>
      </div>

      <div style={{ display:'flex', gap:8 }}>
        <button className="btn btn-primary" onClick={extract} disabled={loading || !device}>
          {loading ? <><Spinner size={14}/> Extracting...</> : '  Extract Saved Networks'}
        </button>
        {networks.length > 0 && <button className="btn btn-sm" onClick={exportCsv}>  Export CSV</button>}
      </div>

      {networks.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>{networks.length} saved networks found</div>
          {networks.map((n, i) => (
            <div key={i} className="card" style={{ display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:18 }}> </span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:500, color:'var(--text)', marginBottom:2 }}>{n.ssid}</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color: show[i] ? 'var(--accent)' : 'var(--text3)', filter: show[i] ? 'none' : 'blur(4px)', cursor:'pointer', transition:'filter 0.2s' }}
                  onClick={() => setShow(s => ({...s, [i]: !s[i]}))}>
                  {n.password}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => setShow(s => ({...s, [i]: !s[i]}))}>
                {show[i] ? '  Hide' : '  Show'}
              </button>
              <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(n.password); addLog('Copied: ' + n.ssid) }}>Copy</button>
            </div>
          ))}
        </div>
      )}

      {!loading && !networks.length && <Empty icon=" " text="Click Extract to read saved Wi-Fi networks" sub="Root access required for passwords on Android 10+" />}
    </PageWrap>
  )
}
