import { useState } from 'react'
const ft = window.ft

export default function SpeedTest({ device, addLog }) {
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [ping, setPing] = useState(null)
  const serial = device?.serial

  const runTest = async () => {
    if (!serial) return addLog('Connect a device')
    setRunning(true)
    setResult(null)
    addLog('Running speed test (10-15 seconds)...')
    const [sp, pi] = await Promise.all([
      ft.speedtest.run({ serial }).catch(e => ({ error:e.message })),
      ft.speedtest.ping({ serial }).catch(e => ({ error:e.message })),
    ])
    setResult(sp)
    setPing(pi)
    if (sp.success) addLog(`Speed: Down ${sp.downloadMbps} Mbps / Up ${sp.uploadMbps} Mbps | Ping: ${pi.avgMs}ms`)
    else addLog('Speed test failed: ' + sp.error)
    setRunning(false)
  }

  const bar = (val, max) => Math.min((val / max) * 100, 100)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Device Speed Test</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Test download, upload and ping from the device over its connection</div>
        </div>
      </div>
      <div style={{ padding:10, background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:8, fontSize:12, color:'var(--text2)' }}>
        Tests network speed from the Android device using curl (must be installed). Tests against Cloudflare speed servers.
      </div>
      <button onClick={runTest} disabled={running||!serial}
        style={{ padding:'12px', borderRadius:10, fontSize:14, fontWeight:700, cursor:!serial||running?'not-allowed':'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>
        {running ? 'Testing...' : 'Run Speed Test'}
      </button>
      {running && <div style={{ textAlign:'center', padding:20, color:'var(--text3)', fontSize:13 }}>Downloading 10MB test file from Cloudflare...</div>}
      {result?.success && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            { label:'Download', value:result.downloadMbps, unit:'Mbps', color:'#4ade80', max:500 },
            { label:'Upload',   value:result.uploadMbps,  unit:'Mbps', color:'#60a5fa', max:200 },
            { label:'Ping',     value:ping?.avgMs,         unit:'ms',   color:'#f59e0b', max:200, invert:true },
          ].map(s => s.value != null && (
            <div key={s.label} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                <span style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{s.label}</span>
                <span style={{ fontSize:18, fontWeight:700, color:s.color }}>{parseFloat(s.value).toFixed(1)} <span style={{ fontSize:11 }}>{s.unit}</span></span>
              </div>
              <div style={{ height:8, background:'var(--bg3)', borderRadius:4, overflow:'hidden' }}>
                <div style={{ height:'100%', width:bar(s.invert?Math.max(0,s.max-s.value):s.value,s.max)+'%', background:s.color, borderRadius:4, transition:'width 1s ease-out' }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {result?.error && <div style={{ padding:12, background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, fontSize:12, color:'#f87171' }}>{result.error}<br/>Note: curl must be available on the device. Not all Android versions include it.</div>}
      {!serial && <div style={{ padding:14, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>Connect an Android device.</div>}
    </div>
  )
}
