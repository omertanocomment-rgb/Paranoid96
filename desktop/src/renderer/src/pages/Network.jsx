import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, InfoRow } from './_shared.jsx'


export default function Network({ device, addLog }) {
  const [carrier, setCarrier] = useState(null)
  const [ports, setPorts] = useState('')
  const [proxyHost, setProxyHost] = useState('')
  const [proxyPort, setProxyPort] = useState('8080')

  const serial = device?.serial || device?.udid

  useEffect(() => {
    if (!device) return
    ft.network.carrierInfo({ serial, type: device.deviceType }).then(setCarrier).catch(() => {})
  }, [device?.serial, device?.udid])

  const DNS_OPTS = [
    ['Cloudflare 1.1.1.1', 'one.one.one.one'],
    ['AdGuard', 'dns.adguard.com'],
    ['Google 8.8.8.8', 'dns.google'],
    ['NextDNS', 'dns.nextdns.io'],
  ]

  return (
    <PageWrap>
      <PageHeader title="Network" icon=" " />
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>

        {carrier && (
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Carrier Info</div>
            {[['Name', carrier.carrier], ['Network', carrier.mnc], ['MCC/MNC', carrier.mcc]].filter(([,v]) => v).map(([k, v]) => <InfoRow key={k} label={k} value={v} />)}
          </div>
        )}

        <div className="card">
          <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>HTTP Proxy</div>
          <div style={{ display:'flex', gap:6, marginBottom:8 }}>
            <input value={proxyHost} onChange={e => setProxyHost(e.target.value)} placeholder="Host (192.168.1.x)" style={{ flex:1 }} />
            <input value={proxyPort} onChange={e => setProxyPort(e.target.value)} style={{ width:70 }} />
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <button className="btn btn-primary btn-sm" onClick={() => ft.network.proxy({ serial, host: proxyHost, port: proxyPort }).then(() => addLog('Proxy set')).catch(e => addLog(e.message))}>Set</button>
            <button className="btn btn-sm" onClick={() => ft.network.proxy({ serial, host:'off' }).then(() => addLog('Proxy cleared')).catch(e => addLog(e.message))}>Clear</button>
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Private DNS (DoT)</div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {DNS_OPTS.map(([label, hostname]) => (
              <div key={hostname} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:12 }}>{label}</div>
                  <div style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--mono)' }}>{hostname}</div>
                </div>
                <button className="btn btn-sm btn-blue" onClick={() => ft.privacy.setDns({ serial, dns1: hostname }).then(() => addLog('DNS: ' + hostname)).catch(e => addLog(e.message))}>Apply</button>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ gridColumn:'1 / -1' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <div style={{ fontSize:13, fontWeight:600 }}>Open Ports</div>
            <button className="btn btn-sm" onClick={() => ft.network.portScan({ serial }).then(setPorts).catch(e => addLog(e.message))}>Scan</button>
          </div>
          {ports
            ? <div className="terminal selectable" style={{ maxHeight:200, overflowY:'auto' }}>{ports}</div>
            : <div style={{ fontSize:12, color:'var(--text3)' }}>Click Scan to list open ports on the device</div>}
        </div>
      </div>
    </PageWrap>
  )
}
