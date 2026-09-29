import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner, Tag, Progress } from './_shared.jsx'


export default function HardwareDiag({ device, addLog }) {
  const [tab, setTab] = useState('speed')
  const [usbResult, setUsbResult] = useState(null)
  const [storageResult, setStorageResult] = useState(null)
  const [sensors, setSensors] = useState([])
  const [gpu, setGpu] = useState(null)
  const [busy, setBusy] = useState(false)
  const [displayColor, setDisplayColor] = useState(null)
  const [progress, setProgress] = useState({ percent:0, message:'' })
  const serial = device?.serial

  const usbTest = async () => {
    setBusy(true); setUsbResult(null)
    setProgress({ percent:10, message:'Writing 5MB test file...' })
    try {
      const r = await ft.hwdiag.usbSpeed({ serial, sizeMB: 5 })
      setUsbResult(r); addLog(`USB:  ${r.upload.mbps}Mbps  ${r.download.mbps}Mbps`)
    } catch(e) { addLog('USB test: ' + e.message) }
    setBusy(false)
  }

  const storageTest = async () => {
    setBusy(true); setStorageResult(null)
    try {
      const r = await ft.hwdiag.storageSpeed({ serial })
      setStorageResult(r)
    } catch(e) { addLog('Storage: ' + e.message) }
    setBusy(false)
  }

  const loadSensors = async () => {
    setBusy(true)
    const s = await ft.hwdiag.sensors({ serial }).catch(() => [])
    setSensors(s)
    const g = await ft.hwdiag.gpu({ serial }).catch(() => null)
    setGpu(g)
    setBusy(false)
  }

  const speakerTest = async () => {
    const r = await ft.hwdiag.speakerTest({ serial }).catch(e => ({ error: e.message }))
    addLog(r.note || r.error || 'Speaker test launched')
  }

  const COLORS = [
    { label:'Red',    hex:'#ff0000', color:'#ff0000' },
    { label:'Green',  hex:'#00ff00', color:'#00ff00' },
    { label:'Blue',   hex:'#0000ff', color:'#0000ff' },
    { label:'White',  hex:'#ffffff', color:'#ffffff' },
    { label:'Black',  hex:'#000000', color:'#1a1a1a' },
    { label:'Gray',   hex:'#888888', color:'#888888' },
  ]

  return (
    <PageWrap>
      <PageHeader title="Hardware Diagnostics" icon=" " sub="USB speed, storage, sensors, display, speaker" />

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3, width:'fit-content' }}>
        {[['speed','Speed Tests'],['display','Display'],['sensors','Sensors'],['speaker','Audio']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:'6px 12px', borderRadius:6, fontSize:12, fontWeight:500, cursor:'pointer',
            background: tab===id ? 'var(--bg4)' : 'none', color: tab===id ? 'var(--text)' : 'var(--text3)',
            border: tab===id ? '1px solid var(--border)' : '1px solid transparent'
          }}>{label}</button>
        ))}
      </div>

      {tab === 'speed' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {/* USB speed */}
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>USB Transfer Speed</div>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:12 }}>Measures actual throughput of USB cable + controller. Identifies USB 2.0 vs 3.0 cables.</div>
            <button className="btn btn-primary" onClick={usbTest} disabled={busy || !device}>
              {busy ? <><Spinner size={14}/> Testing...</> : '  Run USB Speed Test (5MB)'}
            </button>
            {usbResult && (
              <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
                {[
                  ['Upload', usbResult.upload.mbps + ' Mbps', usbResult.upload.ms + 'ms'],
                  ['Download', usbResult.download.mbps + ' Mbps', usbResult.download.ms + 'ms'],
                  ['Rating', usbResult.rating, ''],
                ].map(([label, val, sub]) => (
                  <div key={label} style={{ padding:12, background:'var(--bg2)', borderRadius:8, textAlign:'center' }}>
                    <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>{label}</div>
                    <div style={{ fontSize:16, fontWeight:700, color:'var(--accent)' }}>{val}</div>
                    {sub && <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>{sub}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Storage speed */}
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Internal Storage Speed</div>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:12 }}>Sequential write speed test via dd. Requires root.</div>
            <button className="btn btn-blue" onClick={storageTest} disabled={busy || !device}>
              {busy ? <><Spinner size={14}/> Testing...</> : '  Test Storage Write Speed'}
            </button>
            {storageResult && (
              <div style={{ marginTop:12 }}>
                {storageResult.mbps
                  ? <div style={{ padding:12, background:'var(--bg2)', borderRadius:8, textAlign:'center' }}>
                      <div style={{ fontSize:24, fontWeight:700, color:'var(--accent)' }}>{storageResult.mbps} MB/s</div>
                      <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>Sequential write</div>
                    </div>
                  : <div className="terminal">{storageResult.raw}</div>
                }
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'display' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Dead Pixel / Colour Test</div>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:12 }}>Fill the window with solid colours to check for dead pixels. Look for spots that don't change.</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:12 }}>
              {COLORS.map(c => (
                <button key={c.label} onClick={() => setDisplayColor(c.hex)}
                  style={{ width:48, height:48, borderRadius:8, border: displayColor===c.hex ? '3px solid var(--accent)' : '1px solid var(--border)', background:c.color, cursor:'pointer' }} />
              ))}
              <button className="btn btn-sm" onClick={() => setDisplayColor(null)}>Reset</button>
            </div>
          </div>

          {displayColor && (
            <div style={{
              position:'fixed', inset:0, background: displayColor, zIndex:9999,
              display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'pointer', flexDirection:'column', gap:12
            }} onClick={() => setDisplayColor(null)}>
              <div style={{ fontSize:16, color: displayColor === '#ffffff' || displayColor === '#ffff00' ? '#000' : '#fff', opacity:0.6 }}>
                Click anywhere to exit
              </div>
              <div style={{ fontSize:13, color: displayColor === '#ffffff' ? '#000' : '#fff', opacity:0.5 }}>
                Look for dead pixels -- spots that don't match the colour
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'sensors' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <button className="btn btn-primary" style={{ width:'fit-content' }} onClick={loadSensors} disabled={busy || !device}>
            {busy ? <><Spinner size={14}/> Scanning...</> : '  Scan Hardware'}
          </button>
          {gpu && (
            <div className="card">
              <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>GPU / Platform</div>
              {[['EGL Driver', gpu.egl], ['Platform', gpu.platform]].filter(([,v]) => v?.trim()).map(([k, v]) => (
                <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                  <span style={{ color:'var(--text3)' }}>{k}</span>
                  <span style={{ fontFamily:'var(--font-mono)', color:'var(--text2)' }}>{v.trim()}</span>
                </div>
              ))}
            </div>
          )}
          {sensors.length > 0 && (
            <div className="card">
              <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Sensors ({sensors.length})</div>
              {sensors.slice(0, 30).map((s, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid var(--border)', fontSize:11 }}>
                  <span style={{ color:'var(--text)' }}>{s.name}</span>
                  <span style={{ color:'var(--text3)' }}>{s.vendor}</span>
                </div>
              ))}
            </div>
          )}
          {!busy && !sensors.length && !gpu && <Empty icon=" " text="Click Scan Hardware to read sensors" />}
        </div>
      )}

      {tab === 'speaker' && (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Audio Test</div>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:12 }}>Opens an audio file in the device's browser to test speaker output.</div>
            <button className="btn btn-primary" onClick={speakerTest} disabled={!device}>  Play Test Audio on Device</button>
          </div>
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>ADB Sound Commands</div>
            {[
              ['Max volume', `media volume --stream 3 --set 15`],
              ['Mute', `media volume --stream 3 --set 0`],
              ['Play beep', `am start -a android.intent.action.VIEW -d "content://settings/system/notification_sound"`],
            ].map(([label, cmd]) => (
              <div key={label} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
                <span style={{ flex:1, fontSize:12 }}>{label}</span>
                <code style={{ fontSize:10 }}>{cmd.slice(0,30)}...</code>
                <button className="btn btn-sm" onClick={() => ft.adb.shell({ serial, cmd }).then(() => addLog(label)).catch(e => addLog(e.message))}>Run</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageWrap>
  )
}
