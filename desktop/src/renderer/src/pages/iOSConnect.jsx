import { useState, useEffect } from 'react'

const ft = window.ft

export default function iOSConnect({ device, addLog }) {
  const [diag, setDiag] = useState(null)
  const [running, setRunning] = useState(false)
  const [trusting, setTrusting] = useState(false)

  useEffect(() => {
    if (device?.type === 'ios') {
      setDiag({ device_found: true, device_trusted: true })
    }
  }, [device])

  const runDiag = async () => {
    setRunning(true)
    setDiag(null)
    const r = await ft.iosDiag.run().catch(e => ({ error: e.message, steps: [] }))
    setDiag(r)
    setRunning(false)
    if (r.device_trusted) addLog('iPhone connected and trusted: ' + (r.udids?.[0] || ''))
    else if (r.device_found) addLog('iPhone found but not trusted - tap Trust on device')
    else addLog('iPhone not detected: ' + (r.error || 'unknown'))
  }

  const triggerTrust = async () => {
    setTrusting(true)
    addLog('Sending pair request to iPhone...')
    const udid = diag?.udids?.[0]
    const r = await ft.iosDiag.triggerTrust({ udid }).catch(e => ({ msg: e.message }))
    addLog(r.msg || 'Done')
    setTrusting(false)
    if (r.success) setTimeout(runDiag, 1000)
  }

  const isConnected = device?.type === 'ios' || diag?.device_trusted

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>iPhone / iPad Setup</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Diagnose and fix iPhone connection issues</div>
        </div>
      </div>

      {isConnected ? (
        <div style={{ padding:16, background:'rgba(74,222,128,0.1)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:10 }}>
          <div style={{ fontSize:15, fontWeight:700, color:'#4ade80', marginBottom:4 }}>iPhone Connected</div>
          <div style={{ fontSize:13, color:'var(--text2)' }}>{device?.name || 'iOS Device'} - iOS {device?.ios} - {device?.model}</div>
          <div style={{ fontSize:12, color:'var(--text3)', marginTop:4 }}>All iOS features available in the sidebar.</div>
        </div>
      ) : (
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={runDiag} disabled={running}
            style={{ padding:'9px 20px', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
            {running ? 'Diagnosing...' : 'Run Diagnostic'}
          </button>
          {diag?.device_found && !diag?.device_trusted && (
            <button onClick={triggerTrust} disabled={trusting}
              style={{ padding:'9px 20px', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', background:'rgba(96,165,250,0.2)', color:'#60a5fa', border:'1px solid rgba(96,165,250,0.4)' }}>
              {trusting ? 'Sending...' : 'Trigger Trust Dialog on iPhone'}
            </button>
          )}
        </div>
      )}

      {diag && !isConnected && (
        <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Diagnostic Results</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {(diag.steps || []).map((s, i) => (
              <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start', padding:'7px 10px', borderRadius:7, background: s.ok ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)', border:'1px solid ' + (s.ok ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)') }}>
                <span style={{ fontSize:14, flexShrink:0 }}>{s.ok ? 'OK' : 'XX'}</span>
                <span style={{ fontSize:12, color:'var(--text2)' }}>{s.msg}</span>
              </div>
            ))}
          </div>
          {diag.error && (
            <div style={{ marginTop:10, padding:'10px 14px', background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.3)', borderRadius:8, fontSize:13, fontWeight:600, color:'#f87171' }}>
              {diag.error}
            </div>
          )}
        </div>
      )}

      <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
        <div style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>Step by Step</div>
        {[
          {
            n:1, title:'Install Apple Devices (or iTunes)',
            body:'Required for Windows to communicate with iPhone. Download Apple Devices from the Microsoft Store or iTunes from apple.com.',
            btn:'Open Microsoft Store', url:'ms-windows-store://search/?query=Apple+Devices'
          },
          {
            n:2, title:'Restart Apple Mobile Device Service',
            body:'Sometimes the service gets stuck. Open Services (Win+R, type services.msc), find "Apple Mobile Device Service", right-click, Restart.',
            btn:'Open Services', url:'services.msc'
          },
          {
            n:3, title:'Plug in with original Apple cable',
            body:'Cheap third-party cables often charge but do not carry data. Use the original Apple cable or a certified MFi cable.',
          },
          {
            n:4, title:'Unlock iPhone then tap Trust',
            body:'iPhone must be unlocked when you plug in. A popup says "Trust This Computer?" - tap Trust and enter your passcode. If you missed it, unplug and replug.',
          },
          {
            n:5, title:'Click Run Diagnostic above',
            body:'The diagnostic will tell you exactly what step failed. If the iPhone is found but not trusted, use the Trigger Trust Dialog button.',
          },
        ].map(s => (
          <div key={s.n} style={{ display:'flex', gap:12, marginBottom:14, alignItems:'flex-start' }}>
            <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--accent)', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, flexShrink:0 }}>{s.n}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:4 }}>{s.title}</div>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom: s.btn ? 8 : 0 }}>{s.body}</div>
              {s.btn && <button onClick={() => {
                if (s.url.startsWith('ms-windows-store')) ft.openUrl(s.url)
                else ft.adb?.shell && require && ft.openUrl('https://support.apple.com/downloads/itunes')
                ft.openUrl(s.url.startsWith('http') ? s.url : 'https://support.apple.com/downloads/itunes')
              }} style={{ padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>{s.btn}</button>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Common Issues</div>
        {[
          ['Trust popup not appearing', 'Unplug iPhone, lock it, plug back in, then unlock it. The popup appears fresh on each unlock after plugging in.'],
          ['Was working before, stopped', 'iPhone: Settings > General > Transfer or Reset iPhone > Reset > Reset Location and Privacy. Replug and trust again.'],
          ['Apple Devices installed but still fails', 'Win+R > services.msc > Apple Mobile Device Service > Restart. Also try a different USB port directly on the PC (not a hub).'],
          ['Device shows in Device Manager with warning', 'Win+X > Device Manager > Universal Serial Bus > Apple Mobile Device USB Driver > right-click > Update Driver > Search Automatically.'],
          ['iOS 17+ not detected', 'iOS 17 changed the pairing protocol. Make sure you have the latest libimobiledevice. Re-run install-tools.ps1 to update.'],
        ].map(([q, a], i) => (
          <div key={i} style={{ padding:'9px 12px', background:'var(--bg2)', borderRadius:7, border:'1px solid var(--border)', marginBottom:6 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--text)', marginBottom:3 }}>{q}</div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>{a}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
