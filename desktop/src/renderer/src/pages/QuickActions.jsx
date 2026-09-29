import { useState, useEffect } from 'react'

const ft = window.ft

export function QuickActions({ device, addLog }) {
  const [battery, setBattery] = useState(null)
  const [screenshot, setScreenshot] = useState(null)
  const [brightness, setBrightness] = useState(50)
  const [expanded, setExpanded] = useState(false)

  const serial = device?.serial || device?.udid
  const isIosDevice = type === 'ios' || (serial && /^[0-9a-f]{40}$/i.test((serial||'').replace(/-/g,'')))
  const type = device?.deviceType || device?.type || 'android'
  const isAndroid = type === 'android'

  useEffect(() => {
    if (!serial || isIosDevice) return
    ft.quick.battery({ serial, udid: serial, type }).then(r => {
      if (!r?.error) setBattery(r)
    }).catch(() => {})
  }, [serial, isIosDevice])

  if (!device) return null

  const btn = (label, fn, color, title) => (
    <button onClick={fn} title={title || label}
      style={{ padding:'5px 8px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer',
        background:color?`rgba(${color},0.15)`:'var(--bg3)',
        color:color?`rgb(${color})`:'var(--text3)',
        border:`1px solid ${color?`rgba(${color},0.3)`:'var(--border)'}`,
        flex:1, minWidth:40, whiteSpace:'nowrap' }}>
      {label}
    </button>
  )

  const action = async (fn, msg) => {
    try {
      const r = await fn()
      if (r?.error) addLog('Error: ' + r.error)
      else if (msg) addLog(msg)
    } catch(e) { addLog('Error: ' + e.message) }
  }

  return (
    <div style={{ borderTop:'1px solid var(--border)', padding:'8px 10px', background:'var(--bg1)', flexShrink:0 }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom: expanded ? 8 : 0 }}>
        <span style={{ fontSize:10, fontWeight:700, color:'var(--text3)', letterSpacing:'0.05em', flex:1 }}>QUICK ACTIONS</span>
        {battery && <span style={{ fontSize:10, color: battery.level < 20 ? '#f87171' : '#4ade80' }}>{battery.level}%</span>}
        <button onClick={() => setExpanded(e=>!e)} style={{ fontSize:11, background:'none', border:'none', color:'var(--text3)', cursor:'pointer' }}>
          {expanded ? ' ' : ' '}
        </button>
      </div>

      {expanded && (
        <>
          {/* Screenshot */}
          <div style={{ marginBottom:6 }}>
            <button onClick={async () => {
              const r = await ft.quick.screenshot({ serial, udid: serial, type }).catch(e=>({error:e.message}))
              if (r?.base64) setScreenshot('data:image/png;base64,'+r.base64)
              else addLog(r?.error || 'Screenshot failed')
            }} style={{ width:'100%', padding:'6px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', marginBottom:4 }}>
              Screenshot
            </button>
            {screenshot && (
              <div style={{ position:'relative', marginBottom:4 }}>
                <img src={screenshot} style={{ width:'100%', borderRadius:6, border:'1px solid var(--border)' }} />
                <button onClick={() => setScreenshot(null)} style={{ position:'absolute', top:4, right:4, padding:'2px 6px', borderRadius:4, fontSize:10, cursor:'pointer', background:'rgba(0,0,0,0.6)', color:'#fff', border:'none' }}>x</button>
              </div>
            )}
          </div>

          {/* Navigation buttons - Android only */}
          {isAndroid && (
            <div style={{ display:'flex', gap:4, marginBottom:6 }}>
              {btn('Back', () => action(() => ft.quick.back({serial})), null, 'Back button')}
              {btn('Home', () => action(() => ft.quick.home({serial})), null, 'Home button')}
              {btn('Recent', () => action(() => ft.quick.recent({serial})), null, 'Recent apps')}
              {btn('Wake', () => action(() => ft.quick.wake({serial}), 'Wake screen'), '96,165,250')}
              {btn('Lock', () => action(() => ft.quick.lock({serial}), 'Screen locked'), '248,113,113')}
            </div>
          )}

          {/* Reboot options */}
          <div style={{ display:'flex', gap:4, marginBottom:6 }}>
            {btn('Reboot', () => action(() => ft.quick.reboot({serial, udid:serial, type}), 'Rebooting...'), '245,158,11')}
            {isAndroid && btn('Recovery', () => action(() => ft.quick.reboot({serial, mode:'recovery'}), 'Rebooting to recovery...'), '248,113,113')}
            {isAndroid && btn('Fastboot', () => action(() => ft.quick.reboot({serial, mode:'bootloader'}), 'Rebooting to fastboot...'), '248,113,113')}
          </div>

          {/* Android extras */}
          {isAndroid && (
            <>
              <div style={{ display:'flex', gap:4, marginBottom:6 }}>
                {btn('WiFi ON', () => action(() => ft.quick.wifiToggle({serial, enable:true}), 'WiFi enabled'), '74,222,128')}
                {btn('WiFi OFF', () => action(() => ft.quick.wifiToggle({serial, enable:false}), 'WiFi disabled'), '248,113,113')}
                {btn('Airplane', () => action(() => ft.quick.airplane({serial, enable:true}), 'Airplane mode on'), '245,158,11')}
                {btn('Install APK', () => ft.quick.installApk({serial}).then(r => !r.cancelled && addLog('Installed: '+r.results?.length+' APK(s)')).catch(e=>addLog(e.message)), '96,165,250')}
              </div>
              <div style={{ marginBottom:4 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text3)', marginBottom:3 }}>
                  <span>Brightness</span><span>{brightness}%</span>
                </div>
                <input type="range" min={0} max={100} value={brightness} onChange={e => setBrightness(parseInt(e.target.value))}
                  onMouseUp={() => ft.quick.brightness({serial, level:brightness}).catch(()=>{})}
                  style={{ width:'100%', accentColor:'var(--accent)' }} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
