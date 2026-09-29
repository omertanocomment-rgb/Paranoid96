import { useState, useEffect } from 'react'
const ft = window.ft

function ToolRow({ tool }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--bg2)', borderRadius:7, border:`1px solid ${tool.installed?'rgba(74,222,128,0.2)':'rgba(248,113,113,0.15)'}` }}>
      <div style={{ width:10, height:10, borderRadius:'50%', background:tool.installed?'#4ade80':'#f87171', flexShrink:0 }} />
      <div style={{ flex:1 }}>
        <div style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{tool.name}</div>
        <div style={{ fontSize:10, color:'var(--text3)' }}>{tool.desc}</div>
      </div>
      <span style={{ fontSize:10, fontWeight:700, color:tool.installed?'#4ade80':'#f87171' }}>{tool.installed?'OK':'MISSING'}</span>
      {tool.required && !tool.installed && <span style={{ fontSize:9, padding:'2px 5px', borderRadius:3, background:'rgba(248,113,113,0.2)', color:'#f87171', fontWeight:700 }}>REQUIRED</span>}
    </div>
  )
}

const STEPS = ['Welcome','Tools','Drivers','Android','iPhone','Done']

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0)
  const [tools, setTools] = useState([])
  const [drivers, setDrivers] = useState(null)
  const [installing, setInstalling] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => { if (step === 1) checkTools() }, [step])
  useEffect(() => { if (step === 2) checkDrivers() }, [step])

  const checkTools = async () => {
    setChecking(true)
    const r = await ft.onboard.checkTools().catch(() => ({ tools:[] }))
    setTools(r.tools || [])
    setChecking(false)
  }

  const checkDrivers = async () => {
    setChecking(true)
    const r = await ft.onboard.checkDrivers().catch(() => ({}))
    setDrivers(r)
    setChecking(false)
  }

  const runInstall = async () => {
    setInstalling(true)
    await ft.onboard.runInstall().catch(() => {})
    setTimeout(() => { checkTools(); setInstalling(false) }, 3000)
  }

  const allRequired = tools.filter(t=>t.required).every(t=>t.installed)
  const installed = tools.filter(t=>t.installed).length

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-start', height:'100%', overflowY:'auto', padding:'30px 20px', boxSizing:'border-box' }}>
      <div style={{ width:'100%', maxWidth:600 }}>

        {/* Progress */}
        <div style={{ display:'flex', gap:0, marginBottom:30, background:'var(--bg2)', borderRadius:30, padding:4 }}>
          {STEPS.map((s,i) => (
            <div key={i} style={{ flex:1, textAlign:'center', padding:'6px 4px', borderRadius:26, fontSize:10, fontWeight:700, background:i===step?'var(--accent)':i<step?'rgba(74,222,128,0.2)':'transparent', color:i===step?'#000':i<step?'#4ade80':'var(--text3)', cursor:i<step?'pointer':'default', transition:'all 0.2s' }} onClick={() => i<step&&setStep(i)}>
              {i<step?'OK ':''}{s}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:60, marginBottom:16 }}> </div>
            <div style={{ fontSize:28, fontWeight:800, color:'var(--text)', marginBottom:8 }}>Welcome to Omerta</div>
            <div style={{ fontSize:14, color:'var(--text3)', lineHeight:1.8, marginBottom:30 }}>
              The complete Android and iPhone management suite. This wizard will check your tools, drivers, and help you connect your first device. It takes about 2 minutes.
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:30, textAlign:'left' }}>
              {[
                ['Android','ADB shell, app manager, file manager, ROM flashing, root tools'],
                ['iPhone','Backup, restore, syslog, trust pairing, iOS tools'],
                ['Privacy','Permission scanner, hosts editor, DNS changer, debloater'],
                ['Recovery','Broken device repair, water damage, ROM finder, TWRP'],
              ].map(([title,desc]) => (
                <div key={title} style={{ padding:12, background:'var(--bg1)', borderRadius:9, border:'1px solid var(--border)' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--accent)', marginBottom:4 }}>{title}</div>
                  <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.6 }}>{desc}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setStep(1)} style={{ padding:'12px 32px', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Get Started</button>
          </div>
        )}

        {step === 1 && (
          <div>
            <div style={{ fontSize:22, fontWeight:700, color:'var(--text)', marginBottom:6 }}>Tool Check</div>
            <div style={{ fontSize:13, color:'var(--text3)', marginBottom:16, lineHeight:1.7 }}>Checking which tools are installed in your bin/ folder. Required tools must be installed to use core features.</div>
            {checking && <div style={{ textAlign:'center', padding:20, color:'var(--text3)' }}>Checking...</div>}
            <div style={{ display:'flex', flexDirection:'column', gap:5, marginBottom:16 }}>
              {tools.map((t,i) => <ToolRow key={i} tool={t} />)}
            </div>
            {tools.length > 0 && (
              <div style={{ marginBottom:16, padding:12, background: allRequired?'rgba(74,222,128,0.1)':'rgba(245,158,11,0.1)', border:`1px solid ${allRequired?'rgba(74,222,128,0.3)':'rgba(245,158,11,0.3)'}`, borderRadius:8, fontSize:13, color:allRequired?'#4ade80':'#f59e0b' }}>
                {installed}/{tools.length} tools installed. {allRequired ? 'All required tools present.' : 'Some required tools are missing.'}
              </div>
            )}
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={runInstall} disabled={installing} style={{ padding:'9px 20px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
                {installing ? 'Running install-tools.ps1...' : 'Install Missing Tools'}
              </button>
              <button onClick={checkTools} style={{ padding:'9px 16px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>Recheck</button>
              <button onClick={() => setStep(2)} style={{ padding:'9px 20px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', background:allRequired?'var(--accent)':'var(--bg2)', color:allRequired?'#000':'var(--text3)', border:'none', marginLeft:'auto' }}>Next</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize:22, fontWeight:700, color:'var(--text)', marginBottom:6 }}>Driver Check</div>
            <div style={{ fontSize:13, color:'var(--text3)', marginBottom:16, lineHeight:1.7 }}>Device drivers are needed for USB communication with Android and iPhone.</div>
            {checking && <div style={{ textAlign:'center', padding:20, color:'var(--text3)' }}>Checking services...</div>}
            {drivers && (
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:20 }}>
                {[
                  { label:'ADB Interface Driver', ok:drivers.adbDriver, fix:'Install Universal ADB Driver from adb.clockworkmod.com or run UniversalAdbDriverSetup.msi from bin/' },
                  { label:'Apple Mobile Device Service', ok:drivers.appleService, fix:'Install iTunes from apple.com/itunes -- this installs the Apple USB driver for iPhone' },
                ].map((d,i) => (
                  <div key={i} style={{ padding:'12px 14px', borderRadius:8, border:`1px solid ${d.ok?'rgba(74,222,128,0.3)':'rgba(248,113,113,0.2)'}`, background:d.ok?'rgba(74,222,128,0.05)':'rgba(248,113,113,0.05)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom: d.ok?0:8 }}>
                      <div style={{ width:10, height:10, borderRadius:'50%', background:d.ok?'#4ade80':'#f87171', flexShrink:0 }} />
                      <span style={{ fontSize:13, fontWeight:600, color:'var(--text)', flex:1 }}>{d.label}</span>
                      <span style={{ fontSize:11, fontWeight:700, color:d.ok?'#4ade80':'#f87171' }}>{d.ok?'Running':'Not found'}</span>
                    </div>
                    {!d.ok && <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.7, marginLeft:18 }}>{d.fix}</div>}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={checkDrivers} style={{ padding:'9px 16px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>Recheck</button>
              <button onClick={() => ft.openUrl('https://www.apple.com/itunes/download/win64')} style={{ padding:'9px 14px', borderRadius:8, fontSize:11, cursor:'pointer', background:'var(--bg2)', color:'var(--text3)', border:'1px solid var(--border)' }}>Download iTunes</button>
              <button onClick={() => setStep(3)} style={{ padding:'9px 20px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', marginLeft:'auto' }}>Next</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ fontSize:22, fontWeight:700, color:'var(--text)', marginBottom:16 }}>Connect Android</div>
            {[
              ['Enable Developer Options','Settings > About Phone > tap Build Number 7 times'],
              ['Enable USB Debugging','Settings > Developer Options > USB Debugging > ON'],
              ['Plug in via USB','Use a data cable -- charge-only cables will not work'],
              ['Tap Allow on the phone','A popup asks "Allow USB Debugging?" -- tap Allow'],
              ['Verify connection','Run: .\bin\adb.exe devices -- should show your serial'],
            ].map(([title,desc],i) => (
              <div key={i} style={{ display:'flex', gap:12, marginBottom:14, padding:'12px 14px', background:'var(--bg1)', borderRadius:9, border:'1px solid var(--border)' }}>
                <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--accent)', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:3 }}>{title}</div>
                  <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.6 }}>{desc}</div>
                </div>
              </div>
            ))}
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setStep(2)} style={{ padding:'9px 14px', borderRadius:8, fontSize:12, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>Back</button>
              <button onClick={() => setStep(4)} style={{ padding:'9px 20px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', marginLeft:'auto' }}>Next</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <div style={{ fontSize:22, fontWeight:700, color:'var(--text)', marginBottom:16 }}>Connect iPhone</div>
            {[
              ['Install iTunes or Apple Devices','Required for Apple USB driver on Windows. Download from apple.com/itunes'],
              ['Unlock your iPhone','The screen must be ON and unlocked before plugging in'],
              ['Plug in via Lightning or USB-C','Use the original Apple cable or MFi-certified cable'],
              ['Tap Trust This Computer','A popup appears on your iPhone -- tap Trust and enter passcode'],
              ['Verify detection','Run: .\bin\idevice_id.exe -l -- should show your UDID'],
            ].map(([title,desc],i) => (
              <div key={i} style={{ display:'flex', gap:12, marginBottom:14, padding:'12px 14px', background:'var(--bg1)', borderRadius:9, border:'1px solid var(--border)' }}>
                <div style={{ width:28, height:28, borderRadius:'50%', background:'var(--accent)', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:3 }}>{title}</div>
                  <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.6 }}>{desc}</div>
                </div>
              </div>
            ))}
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setStep(3)} style={{ padding:'9px 14px', borderRadius:8, fontSize:12, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>Back</button>
              <button onClick={() => setStep(5)} style={{ padding:'9px 20px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', marginLeft:'auto' }}>Finish Setup</button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:60, marginBottom:16 }}> </div>
            <div style={{ fontSize:26, fontWeight:800, color:'#4ade80', marginBottom:8 }}>Setup Complete</div>
            <div style={{ fontSize:14, color:'var(--text3)', lineHeight:1.8, marginBottom:30 }}>
              Omerta is ready. Connect a device and it will appear in the sidebar automatically. The scan runs every 6 seconds.
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:30, textAlign:'left' }}>
              {[
                ['Dashboard','Start here -- overview of connected device'],
                ['Device Finder','If your device is not showing up'],
                ['ADB Builder','Run custom ADB commands'],
                ['iOS Hub','All iPhone tools in one place'],
              ].map(([page,desc]) => (
                <div key={page} style={{ padding:12, background:'var(--bg1)', borderRadius:9, border:'1px solid var(--border)' }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--accent)', marginBottom:3 }}>{page}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{desc}</div>
                </div>
              ))}
            </div>
            <button onClick={() => onComplete?.()} style={{ padding:'12px 32px', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
              Launch Omerta
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
