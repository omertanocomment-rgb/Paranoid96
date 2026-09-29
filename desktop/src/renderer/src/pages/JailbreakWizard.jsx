import { useState, useEffect, useRef } from 'react'
const ft = window.ft

function Badge({ label, color }) {
  return <span style={{ fontSize:10, padding:'2px 8px', borderRadius:4, fontWeight:700, background:`${color}22`, color, border:`1px solid ${color}44` }}>{label}</span>
}

function Card({ title, icon, children, color }) {
  return (
    <div style={{ background:'var(--bg1)', border:`1px solid ${color||'var(--border)'}44`, borderRadius:10, padding:14, borderLeft:`3px solid ${color||'var(--border)'}` }}>
      {title && <div style={{ fontSize:12, fontWeight:700, color:color||'var(--text3)', letterSpacing:'0.05em', marginBottom:10 }}>{icon&&<span style={{marginRight:6}}>{icon}</span>}{title}</div>}
      {children}
    </div>
  )
}

function Progress({ pct, msg }) {
  return (
    <div style={{ marginTop:8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text3)', marginBottom:4 }}><span>{msg}</span><span>{pct}%</span></div>
      <div style={{ height:6, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}>
        <div style={{ height:'100%', width:Math.min(pct,100)+'%', background:pct>=100?'#4ade80':'var(--accent)', transition:'width 0.3s' }} />
      </div>
    </div>
  )
}

const IOS_JBS = [
  {
    name:'checkra1n / checkn1x',
    chips:'A8-A11 (iPhone 6 - iPhone X)',
    ios:'iOS 12-14.8.1',
    type:'Semi-tethered',
    permanent:false,
    platform:'Linux/macOS (checkn1x bootable USB for Windows)',
    color:'#4ade80',
    url:'https://checkra.in',
    steps:['Download checkn1x ISO below','Flash to USB with Rufus (button below)','Boot PC from USB, follow on-screen guide','DFU mode your iPhone (guide below)','checkra1n runs automatically'],
    note:'Best option for iPhone 6. checkn1x creates a bootable Linux USB that runs checkra1n. No Mac needed.',
  },
  {
    name:'palera1n',
    chips:'A8-A16 (rootless for A12+)',
    ios:'iOS 15-17.x',
    type:'Semi-tethered',
    permanent:false,
    platform:'Linux/macOS/Windows (beta)',
    color:'#60a5fa',
    url:'https://palera.in',
    steps:['Windows: use palera1n-c from github.com/palera1n/palera1n-c','Run palera1n.exe in CMD or PowerShell','DFU mode your device','palera1n patches and jailbreaks automatically'],
    note:'Has a Windows binary. Good for iOS 15-17.',
  },
  {
    name:'Dopamine',
    chips:'A12-A15',
    ios:'iOS 15.0-16.6.1',
    type:'Semi-untethered',
    permanent:false,
    platform:'On-device (no PC after install)',
    color:'#a78bfa',
    url:'https://dopamineapp.com',
    steps:['Install TrollStore first (required)','Download Dopamine IPA','Install via TrollStore or Sideloader page','Run Dopamine on device and tap Jailbreak'],
    note:'No PC needed after install. Re-run Dopamine after reboot.',
  },
  {
    name:'unc0ver',
    chips:'A12-A14',
    ios:'iOS 11.0-14.8',
    type:'Semi-untethered',
    permanent:false,
    platform:'On-device (sideload IPA)',
    color:'#f59e0b',
    url:'https://unc0ver.dev',
    steps:['Download unc0ver IPA from unc0ver.dev','Use Sideloader page to install','Run unc0ver on device and tap Jailbreak'],
    note:'Classic jailbreak. Very reliable for iOS 14.',
  },
]

const ANDROID_JBS = [
  {
    name:'Magisk (root via boot patch)',
    desc:'Systemless root. Works on most Android devices with unlocked bootloader.',
    color:'#f59e0b',
    risk:'Medium — bootloader unlock wipes data',
    steps:'magisk',
  },
  {
    name:'KernelSU',
    desc:'Kernel-level root for GKI kernels (Android 12+ with GKI). More stealth than Magisk.',
    color:'#4ade80',
    url:'https://kernelsu.org',
    risk:'Advanced',
  },
]

export default function JailbreakWizard({ device, addLog }) {
  const [tab, setTab] = useState('detect')
  const [detected, setDetected] = useState(null)
  const [realStatus, setRealStatus] = useState(null)
  const [trollCheck, setTrollCheck] = useState(null)
  const [statusChecking, setStatusChecking] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [dlProgress, setDlProgress] = useState({ pct:0, msg:'' })
  const [downloading, setDownloading] = useState(false)
  const [isoPath, setIsoPath] = useState(null)
  const [dfuType, setDfuType] = useState('home_button')
  const [dfuSteps, setDfuSteps] = useState(null)
  const [installProgress, setInstallProgress] = useState({ pct:0, msg:'' })
  const [magiskSteps, setMagiskSteps] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    const u1 = ft.on('jailbreak:dl-progress', p => setDlProgress({ pct:p.percent||0, msg:p.msg||'' }))
    const u2 = ft.on('jailbreak:install-progress', p => setInstallProgress({ pct:p.percent||0, msg:p.message||'' }))
    return () => { u1(); u2() }
  }, [])

  const detect = async () => {
    setDetecting(true)
    const r = await ft.jailbreak.detectDevice().catch(e => ({ error: e.message }))
    setDetected(r)
    addLog('Device scan complete')
    setDetecting(false)
  }

  const checkRealStatus = async () => {
    if (!detected?.ios?.udid) return
    setStatusChecking(true)
    const [status, troll] = await Promise.all([
      ft.ios.jb.isJailbroken({ udid: detected.ios.udid }).catch(e => ({ jailbroken:false, note:'Check failed: '+e.message })),
      ft.ios.jb.trollstoreCheck({ udid: detected.ios.udid, device: detected.ios.product }).catch(() => null),
    ])
    setRealStatus(status)
    setTrollCheck(troll)
    setStatusChecking(false)
  }

  const downloadCheckn1x = async () => {
    setDownloading(true)
    setDlProgress({ pct:0, msg:'Fetching release info...' })
    const r = await ft.jailbreak.downloadCheckn1x().catch(e => ({ error: e.message }))
    if (r.success) {
      setIsoPath(r.path)
      addLog((r.cached ? 'Cached: ' : 'Downloaded: ') + r.path)
    } else { addLog('Download failed: ' + r.error) }
    setDownloading(false)
  }

  const flashToUsb = async () => {
    if (!isoPath) { addLog('Download checkn1x first'); return }
    const r = await ft.jailbreak.flashCheckn1x({ isoPath }).catch(e => ({ error: e.message }))
    addLog(r.success ? r.note : 'Error: ' + r.error)
  }

  const loadDfuSteps = async () => {
    const r = await ft.jailbreak.dfuHelp({ type: dfuType }).catch(() => null)
    if (r) setDfuSteps(r)
  }

  const loadMagiskSteps = async () => {
    const r = await ft.jailbreak.magiskPatch().catch(() => null)
    if (r) setMagiskSteps(r.steps)
  }

  const sideloadJb = async (jb) => {
    const udid = detected?.ios?.udid || device?.udid
    const r = await ft.jailbreak.sideloadIpa({ udid }).catch(e => ({ error: e.message }))
    if (r.cancelled) return
    addLog(r.success ? 'Installed: ' + jb.name : 'Failed: ' + (r.error||'unknown'))
  }

  const ios = detected?.ios
  const android = detected?.android

  const TABS = [['detect','Device Scan'],['ios','iOS Jailbreak'],['android','Android Root'],['dfu','DFU Mode Guide']]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}>🔓</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Jailbreak Wizard</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>iOS jailbreak and Android root — detect, download, install</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3 }}>
        {TABS.map(([id,l]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'7px 4px', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>
        ))}
      </div>

      {tab === 'detect' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <button onClick={detect} disabled={detecting} style={{ padding:'10px', borderRadius:9, fontSize:13, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
            {detecting ? 'Scanning...' : 'Scan Connected Devices'}
          </button>
          {ios?.udid && (
            <Card title="iPhone / iPad Detected" color="#a78bfa">
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:8 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{ios.product}</div>
                <Badge label={'iOS ' + ios.ios} color="#a78bfa" />
                <Badge label={ios.chipGen} color="#60a5fa" />
              </div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 }}>
                {ios.checkm8 && <Badge label="checkra1n compatible" color="#4ade80" />}
                {ios.dopamine && <Badge label="Dopamine compatible" color="#a78bfa" />}
                {ios.trollstore && <Badge label="TrollStore compatible" color="#f59e0b" />}
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button onClick={() => setTab('ios')} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
                  Show compatible jailbreaks
                </button>
                <button onClick={checkRealStatus} disabled={statusChecking} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'rgba(74,222,128,0.15)', color:'#4ade80', border:'1px solid rgba(74,222,128,0.3)' }}>
                  {statusChecking ? 'Checking...' : 'Check Current Status'}
                </button>
              </div>
              {realStatus && (
                <div style={{ marginTop:10, padding:'10px 12px', background:'var(--bg1)', borderRadius:8, border:'1px solid var(--border)' }}>
                  <div style={{ fontSize:12, color: realStatus.jailbroken ? '#4ade80' : 'var(--text2)', fontWeight:600, marginBottom:realStatus.evidence?6:0 }}>
                    {realStatus.jailbroken ? 'Jailbreak markers found' : (realStatus.note || 'No jailbreak markers found')}
                  </div>
                  {realStatus.evidence && <div style={{ fontSize:11, color:'var(--text3)', fontFamily:'monospace' }}>{realStatus.evidence.join(', ')}</div>}
                  {trollCheck && <div style={{ fontSize:11, color: trollCheck.trollstoreCompatible?'#4ade80':'var(--text3)', marginTop:6 }}>{trollCheck.note}</div>}
                </div>
              )}
            </Card>
          )}
          {android?.serial && (
            <Card title="Android Device Detected" color="#4ade80">
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:8 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{android.model}</div>
                <Badge label={'Android API ' + android.sdk} color="#4ade80" />
                <Badge label={android.arch} color="#60a5fa" />
                {android.rooted && <Badge label="Already Rooted" color="#4ade80" />}
              </div>
              <button onClick={() => setTab('android')} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
                Show root options
              </button>
            </Card>
          )}
          {detected && !ios?.udid && !android?.serial && (
            <div style={{ padding:14, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>
              No devices found. Plug in device and ensure it is trusted/ADB enabled.
            </div>
          )}
        </div>
      )}

      {tab === 'ios' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {/* checkn1x / Rufus workflow */}
          <Card title="checkn1x — Flash to USB and Jailbreak (Windows compatible)" color="#4ade80">
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:10 }}>
              checkn1x is a bootable Linux USB that runs checkra1n automatically. Works for iPhone 6 through iPhone X (A8-A11). No Mac needed — just a USB stick.
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
              <button onClick={downloadCheckn1x} disabled={downloading} style={{ padding:'8px 16px', borderRadius:7, fontSize:12, fontWeight:700, cursor:downloading?'not-allowed':'pointer', background:isoPath?'rgba(74,222,128,0.2)':'var(--accent)', color:isoPath?'#4ade80':'#000', border:isoPath?'1px solid rgba(74,222,128,0.4)':'none' }}>
                {downloading ? 'Downloading...' : isoPath ? 'checkn1x Downloaded' : 'Download checkn1x ISO'}
              </button>
              <button onClick={flashToUsb} disabled={!isoPath} style={{ padding:'8px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:!isoPath?'not-allowed':'pointer', background:'rgba(96,165,250,0.15)', color:'#60a5fa', border:'1px solid rgba(96,165,250,0.3)', opacity:!isoPath?0.5:1 }}>
                Flash to USB with Rufus
              </button>
              <button onClick={() => ft.jailbreak.openFolder().then(r=>addLog('Folder: '+r.path))} style={{ padding:'8px 12px', borderRadius:7, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Open Folder</button>
            </div>
            {downloading && <Progress pct={dlProgress.pct} msg={dlProgress.msg} />}
            {isoPath && <div style={{ fontSize:11, color:'#4ade80', marginBottom:8 }}>ISO ready: {(isoPath||'').split(/[\/]/).filter(Boolean).pop()}</div>}
            <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.8 }}>
              After flashing: restart PC, boot from USB (press F12/F2/Del), plug in iPhone, follow checkra1n UI.
            </div>
          </Card>

          {/* palera1n Windows */}
          <Card title="palera1n — Has a Windows binary" color="#60a5fa">
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
              palera1n-c has a Windows .exe. Works on A8-A11 (iOS 15+) and A12+ rootless (iOS 15-17).
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={() => ft.openUrl('https://github.com/palera1n/palera1n-c/releases')} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'rgba(96,165,250,0.15)', color:'#60a5fa', border:'1px solid rgba(96,165,250,0.3)' }}>Download palera1n-c</button>
              <button onClick={() => ft.openUrl('https://palera.in')} style={{ padding:'7px 12px', borderRadius:7, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Guide</button>
            </div>
          </Card>

          {/* All jailbreaks */}
          {IOS_JBS.map((jb,i) => (
            <div key={i} style={{ background:'var(--bg1)', border:`1px solid ${jb.color}33`, borderRadius:10, padding:14, borderLeft:`3px solid ${jb.color}` }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:8 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--text)', marginBottom:4 }}>{jb.name}</div>
                  <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:4 }}>
                    <Badge label={jb.chips} color={jb.color} />
                    <Badge label={jb.ios} color="#888" />
                    <Badge label={jb.type} color={jb.type.includes('un')?'#4ade80':'#f59e0b'} />
                  </div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>Platform: {jb.platform}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
                  <button onClick={() => ft.openUrl(jb.url)} style={{ padding:'5px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:`${jb.color}22`, color:jb.color, border:`1px solid ${jb.color}44` }}>Website</button>
                  {jb.platform.includes('On-device') && <button onClick={() => sideloadJb(jb)} style={{ padding:'5px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Sideload IPA</button>}
                </div>
              </div>
              {jb.note && <div style={{ fontSize:11, color:'#4ade80', marginBottom:8, padding:'5px 8px', background:'rgba(74,222,128,0.08)', borderRadius:5 }}>{jb.note}</div>}
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {jb.steps.map((s,j) => (
                  <div key={j} style={{ display:'flex', gap:8, fontSize:11 }}>
                    <span style={{ color:jb.color, fontWeight:700, flexShrink:0 }}>{j+1}.</span>
                    <span style={{ color:'var(--text2)' }}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'android' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Card title="Magisk Root — Boot Image Patch" color="#f59e0b">
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:10 }}>
              The most common Android root method. Patch your stock boot.img with Magisk, flash it via fastboot. Works on most unlocked Android devices.
            </div>
            <button onClick={loadMagiskSteps} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'rgba(245,158,11,0.15)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.3)', marginBottom:10 }}>Show Step-by-Step Guide</button>
            {magiskSteps && (
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {magiskSteps.map((s,i) => (
                  <div key={i} style={{ display:'flex', gap:8 }}>
                    <div style={{ width:22, height:22, borderRadius:'50%', background:'#f59e0b', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, paddingTop:2 }}>{s}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
              <button onClick={() => ft.openUrl('https://github.com/topjohnwu/Magisk/releases')} style={{ padding:'6px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'rgba(245,158,11,0.15)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.3)' }}>Magisk Releases</button>
              <button onClick={() => ft.openUrl('https://www.sammobile.com/samsung/firmware/')} style={{ padding:'6px 12px', borderRadius:6, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>SamMobile Firmware</button>
            </div>
          </Card>
          <Card title="Go to Magisk Modules" color="#4ade80">
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:8 }}>After rooting, manage Magisk modules from the Modules page.</div>
            <div style={{ fontSize:11, color:'var(--text3)' }}>Sidebar: ROM section &gt; Magisk</div>
          </Card>
        </div>
      )}

      {tab === 'dfu' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>DFU (Device Firmware Update) mode bypasses iOS and is required for checkra1n. Select your device type:</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {[['home_button','iPhone 6/7/8/SE'],['iphone7','iPhone 7 only'],['no_home','iPhone X and newer']].map(([t,l]) => (
              <button key={t} onClick={() => { setDfuType(t); setDfuSteps(null) }} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:dfuType===t?'var(--accent-dim)':'var(--bg2)', color:dfuType===t?'var(--accent)':'var(--text3)', border:`1px solid ${dfuType===t?'var(--accent-border)':'var(--border)'}` }}>{l}</button>
            ))}
          </div>
          <button onClick={loadDfuSteps} style={{ padding:'8px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', width:'fit-content' }}>Show DFU Steps</button>
          {dfuSteps && (
            <Card title="DFU Mode Entry Steps" color="#a78bfa">
              {dfuSteps.steps.map((s,i) => (
                <div key={i} style={{ display:'flex', gap:10, marginBottom:10 }}>
                  <div style={{ width:26, height:26, borderRadius:'50%', background:'#a78bfa', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                  <div style={{ fontSize:13, color:'var(--text)', lineHeight:1.7, fontWeight: s.includes('BLACK')||s.includes('DFU')?700:400 }}>{s}</div>
                </div>
              ))}
              <div style={{ padding:'8px 12px', background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:7, fontSize:12, color:'#f87171', marginTop:8 }}>
                Screen should be completely BLACK (not Apple logo). If Apple logo appears, you are in recovery mode not DFU — try again.
              </div>
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:8 }}>Exit DFU: {dfuSteps.exit}</div>
            </Card>
          )}
          <Card title="How to tell DFU vs Recovery" color="#888">
            <div style={{ display:'flex', gap:20, flexWrap:'wrap', fontSize:12 }}>
              <div>
                <div style={{ fontWeight:700, color:'#4ade80', marginBottom:4 }}>DFU Mode (correct)</div>
                <div style={{ color:'var(--text2)', lineHeight:1.7 }}>Screen completely black<br/>iTunes/Finder shows "recovery" mode<br/>checkra1n shows "DFU" device</div>
              </div>
              <div>
                <div style={{ fontWeight:700, color:'#f87171', marginBottom:4 }}>Recovery Mode (wrong)</div>
                <div style={{ color:'var(--text2)', lineHeight:1.7 }}>Shows Apple logo or iTunes logo<br/>checkra1n shows "recovery" device<br/>Try DFU entry again more carefully</div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
