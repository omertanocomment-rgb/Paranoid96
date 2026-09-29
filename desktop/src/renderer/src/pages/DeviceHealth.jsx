import { useState, useEffect } from 'react'
const ft = window.ft

function Score({ label, value, max, color, unit }) {
  const pct = Math.min((value/max)*100, 100)
  return (
    <div style={{ background:'var(--bg2)', borderRadius:8, padding:10, border:'1px solid var(--border)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5, fontSize:12 }}>
        <span style={{ color:'var(--text3)', fontWeight:600 }}>{label}</span>
        <span style={{ color, fontWeight:700 }}>{typeof value==='number'?value.toLocaleString():value}{unit}</span>
      </div>
      {typeof value==='number' && <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}>
        <div style={{ height:'100%', width:pct+'%', background:color, borderRadius:3, transition:'width 0.8s' }} />
      </div>}
    </div>
  )
}

export default function DeviceHealth({ device, addLog }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ pct:0, msg:'' })
  const serial = device?.serial

  useEffect(() => {
    const unsub = ft.on('health:progress', p => setProgress({ pct:p.pct||0, msg:p.msg||'' }))
    return () => unsub()
  }, [])

  const runHealth = async () => {
    if (!serial) return addLog('Connect an Android device')
    setLoading(true); setReport(null); setProgress({ pct:0, msg:'Starting...' })
    const r = await ft.deviceHealth.full({ serial }).catch(e=>({ error:e.message }))
    if (r.success) { setReport(r.report); addLog('Health check complete') }
    else addLog('Error: ' + r.error)
    setLoading(false)
  }

  const b = report?.battery
  const m = report?.memory
  const battColor = b?.level < 20 ? '#f87171' : b?.level < 50 ? '#f59e0b' : '#4ade80'
  const tempColor = b?.temp > 42 ? '#f87171' : b?.temp > 37 ? '#f59e0b' : '#4ade80'
  const memUsed = m ? Math.round(((m.total-m.avail)/m.total)*100) : 0
  const memColor = memUsed > 85 ? '#f87171' : memUsed > 65 ? '#f59e0b' : '#4ade80'

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Device Health</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Full hardware and software health report</div>
        </div>
      </div>

      <button onClick={runHealth} disabled={loading||!serial} style={{ padding:'10px', borderRadius:9, fontSize:13, fontWeight:700, cursor:!serial||loading?'not-allowed':'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>
        {loading ? 'Scanning...' : 'Run Health Check'}
      </button>

      {loading && (
        <div style={{ background:'var(--bg1)', borderRadius:8, padding:14, border:'1px solid var(--border)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--text3)', marginBottom:6 }}>
            <span>{progress.msg}</span><span>{progress.pct}%</span>
          </div>
          <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}>
            <div style={{ height:'100%', width:progress.pct+'%', background:'var(--accent)', borderRadius:3, transition:'width 0.4s' }} />
          </div>
        </div>
      )}

      {report && (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <Score label="Battery" value={b.level} max={100} color={battColor} unit="%" />
            <Score label="Temperature" value={b.temp} max={60} color={tempColor} unit="C" />
            <Score label="Voltage" value={b.voltage} max={4500} color="#a78bfa" unit=" mV" />
            <Score label="Memory Used" value={memUsed} max={100} color={memColor} unit="%" />
          </div>

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>BATTERY</div>
            {[['Health', b.health],['Status', 'Discharging'],['Uptime', report.uptime + ' hours']].map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid var(--border)44', fontSize:12 }}>
                <span style={{ color:'var(--text3)' }}>{k}</span>
                <span style={{ color: k==='Health'&&v!=='Good'?'#f87171':'var(--text2)' }}>{v}</span>
              </div>
            ))}
          </div>

          {m && <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>MEMORY</div>
            {[['Total',Math.round(m.total/1024)+' MB'],['Available',Math.round(m.avail/1024)+' MB'],['Used',Math.round((m.total-m.avail)/1024)+' MB ('+memUsed+'%)']].map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid var(--border)44', fontSize:12 }}>
                <span style={{ color:'var(--text3)' }}>{k}</span>
                <span style={{ color:'var(--text2)' }}>{v}</span>
              </div>
            ))}
          </div>}

          {report.storage && <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>STORAGE (/data)</div>
            {Object.entries(report.storage).map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid var(--border)44', fontSize:12 }}>
                <span style={{ color:'var(--text3)' }}>{k}</span>
                <span style={{ color:'var(--text2)' }}>{v}</span>
              </div>
            ))}
          </div>}

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>SECURITY</div>
            {[['SELinux', report.security.selinux],['Rooted', report.security.rooted],['Verified Boot', report.security.verifiedBoot],['Encryption', report.security.encryption]].map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid var(--border)44', fontSize:12 }}>
                <span style={{ color:'var(--text3)' }}>{k}</span>
                <span style={{ color: (k==='Rooted'&&v==='Yes')||k==='SELinux'&&v==='Permissive'?'#f59e0b':k==='SELinux'&&v==='Enforcing'?'#4ade80':'var(--text2)' }}>{v}</span>
              </div>
            ))}
          </div>

          {report.cpu && <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>CPU LOAD</div>
            <div style={{ display:'flex', gap:12 }}>
              {['1m','5m','15m'].map((t,i) => (
                <div key={t} style={{ textAlign:'center' }}>
                  <div style={{ fontSize:16, fontWeight:700, color: parseFloat(report.cpu.load[i])>2?'#f87171':parseFloat(report.cpu.load[i])>1?'#f59e0b':'#4ade80' }}>{report.cpu.load[i]}</div>
                  <div style={{ fontSize:10, color:'var(--text3)' }}>{t} avg</div>
                </div>
              ))}
            </div>
          </div>}
        </>
      )}
      {!serial && <div style={{ padding:14, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>Connect an Android device.</div>}
    </div>
  )
}
