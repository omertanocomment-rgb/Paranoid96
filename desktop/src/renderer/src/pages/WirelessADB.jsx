import { useState } from 'react'
const ft = window.ft

function Step({ n, title, done, children }) {
  return (
    <div style={{ background:'var(--bg1)', border:`1px solid ${done?'rgba(74,222,128,0.4)':'var(--border)'}`, borderRadius:10, padding:14, borderLeft:`3px solid ${done?'#4ade80':'var(--border)'}` }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:children?10:0 }}>
        <div style={{ width:26, height:26, borderRadius:'50%', background:done?'#4ade80':'var(--bg3)', color:done?'#000':'var(--text3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, flexShrink:0 }}>{done?'OK':n}</div>
        <span style={{ fontSize:13, fontWeight:600, color:done?'#4ade80':'var(--text)' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

export default function WirelessADB({ device, addLog }) {
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('5555')
  const [pairPort, setPairPort] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [loading, setLoading] = useState(null)
  const [step, setStep] = useState(1)
  const [detectedIp, setDetectedIp] = useState('')
  const [connected, setConnected] = useState(false)
  const serial = device?.serial

  const getIp = async () => {
    setLoading('ip')
    const r = await ft.wireless.getIp({ serial }).catch(e=>({error:e.message}))
    if (r.ip && r.ip !== 'error') { setDetectedIp(r.ip); setIp(r.ip); setStep(2); addLog('Device IP: ' + r.ip) }
    else addLog('Could not detect IP: ' + (r.error || 'Check WiFi connection'))
    setLoading(null)
  }

  const enableTcpip = async () => {
    setLoading('tcpip')
    const r = await ft.wireless.tcpip({ serial, port: parseInt(port) }).catch(e=>({error:e.message}))
    addLog(r.success ? `ADB TCP/IP enabled on port ${port}` : 'Error: ' + r.error)
    if (r.success) setStep(3)
    setLoading(null)
  }

  const pair = async () => {
    setLoading('pair')
    const r = await ft.wireless.pair({ ip, port: parseInt(pairPort), code: pairCode }).catch(e=>({error:e.message}))
    addLog(r.success ? 'Pairing successful' : 'Pair failed: ' + (r.error || r.output))
    if (r.success) setStep(4)
    setLoading(null)
  }

  const connect = async () => {
    setLoading('connect')
    const r = await ft.wireless.connect({ ip, port: parseInt(port) }).catch(e=>({error:e.message}))
    addLog(r.success ? `Connected wirelessly to ${ip}:${port}` : 'Connect failed: ' + (r.error || r.output))
    if (r.success) { setConnected(true); setStep(5) }
    setLoading(null)
  }

  const disconnect = async () => {
    await ft.wireless.disconnect({ ip, port: parseInt(port) }).catch(()=>{})
    setConnected(false); setStep(1); addLog('Disconnected')
  }

  const android11Plus = true // show both paths

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Wireless ADB</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Connect to your device over WiFi -- no USB needed after setup</div>
        </div>
        {connected && <div style={{ padding:'5px 12px', background:'rgba(74,222,128,0.15)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:7, fontSize:12, color:'#4ade80', fontWeight:700 }}>CONNECTED</div>}
      </div>

      {connected && (
        <div style={{ background:'rgba(74,222,128,0.1)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:10, padding:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:'#4ade80' }}>Wireless connection active</div>
            <div style={{ fontSize:12, color:'var(--text3)' }}>{ip}:{port} -- you can unplug the USB cable now</div>
          </div>
          <button onClick={disconnect} style={{ padding:'8px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'rgba(248,113,113,0.15)', color:'#f87171', border:'1px solid rgba(248,113,113,0.3)' }}>Disconnect</button>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, padding:'10px 14px', background:'var(--bg2)', borderRadius:8, fontSize:11, color:'var(--text3)' }}>
        <div><strong style={{ color:'var(--text)' }}>Android 11+</strong> -- Use wireless debugging pairing with QR/code</div>
        <div><strong style={{ color:'var(--text)' }}>Android 5-10</strong> -- Enable via USB first, then connect wirelessly</div>
      </div>

      {!serial && <div style={{ padding:12, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>Connect device via USB first to enable wireless ADB.</div>}

      <Step n={1} title="Get device IP address" done={step > 1}>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={getIp} disabled={!serial || loading==='ip'} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>
            {loading==='ip' ? 'Detecting...' : 'Auto-detect IP'}
          </button>
          <input value={ip} onChange={e=>setIp(e.target.value)} placeholder="or type IP manually e.g. 192.168.1.50" style={{ flex:1, fontSize:12 }} />
        </div>
        {detectedIp && <div style={{ marginTop:6, fontSize:12, color:'#4ade80' }}>Detected: {detectedIp}</div>}
      </Step>

      <Step n={2} title="Enable TCP/IP mode (Android 5-10) or pair (Android 11+)" done={step > 2}>
        <div style={{ display:'flex', gap:8, marginBottom:10 }}>
          <input value={port} onChange={e=>setPort(e.target.value)} style={{ width:80 }} placeholder="Port" />
          <button onClick={enableTcpip} disabled={!serial || loading==='tcpip'} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>
            {loading==='tcpip' ? 'Enabling...' : 'Enable TCP/IP (Android 5-10)'}
          </button>
        </div>
        <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.7 }}>
          Android 11+: Settings &gt; Developer Options &gt; Wireless Debugging &gt; Enable &gt; Pair device with pairing code
        </div>
      </Step>

      <Step n={3} title="Pair (Android 11+ only)" done={step > 3}>
        <div style={{ fontSize:11, color:'var(--text3)', marginBottom:8, lineHeight:1.7 }}>
          In Developer Options &gt; Wireless Debugging &gt; Pair device with pairing code -- note the IP:port and 6-digit code shown.
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <input value={pairPort} onChange={e=>setPairPort(e.target.value)} placeholder="Pair port" style={{ width:90 }} />
          <input value={pairCode} onChange={e=>setPairCode(e.target.value)} placeholder="6-digit code" style={{ width:110 }} />
          <button onClick={pair} disabled={!pairPort || !pairCode || loading==='pair'} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
            {loading==='pair' ? 'Pairing...' : 'Pair Device'}
          </button>
        </div>
        <button onClick={() => setStep(4)} style={{ marginTop:8, padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Skip (Android 5-10)</button>
      </Step>

      <Step n={4} title="Connect wirelessly" done={step > 4}>
        <div style={{ display:'flex', gap:8 }}>
          <span style={{ fontSize:13, color:'var(--text3)', alignSelf:'center' }}>{ip}:</span>
          <input value={port} onChange={e=>setPort(e.target.value)} style={{ width:80 }} />
          <button onClick={connect} disabled={!ip || loading==='connect'} style={{ padding:'7px 16px', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
            {loading==='connect' ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </Step>

      {connected && (
        <Step n={5} title="Done! Unplug USB cable" done={true}>
          <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            Wireless ADB is active. You can now unplug the USB cable. The connection will persist until you disconnect or the device reboots. To reconnect after reboot, use Connect with the same IP (no need to repeat pairing).
          </div>
        </Step>
      )}
    </div>
  )
}
