import { useState, useEffect } from 'react'
const ft = window.ft

function ToolBadge({ name, installed, desc }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', background:'var(--bg2)', borderRadius:7, border:`1px solid ${installed?'rgba(74,222,128,0.2)':'rgba(248,113,113,0.2)'}` }}>
      <div style={{ width:8, height:8, borderRadius:'50%', background:installed?'#4ade80':'#f87171', flexShrink:0 }} />
      <span style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{name}</span>
      <span style={{ fontSize:10, color:'var(--text3)', flex:1 }}>{desc}</span>
      <span style={{ fontSize:10, fontWeight:700, color:installed?'#4ade80':'#f87171' }}>{installed?'OK':'MISSING'}</span>
    </div>
  )
}

function InfoRow({ label, value, mono, color }) {
  if (!value) return null
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
      <span style={{ color:'var(--text3)' }}>{label}</span>
      <span style={{ color:color||'var(--text2)', fontFamily:mono?'monospace':'inherit' }}>{value}</span>
    </div>
  )
}

const INSTALL_METHODS = [
  { id:'direct',      label:'Direct Install',    desc:'Already-signed IPAs — dev certs, enterprise, AdHoc',    color:'#4ade80' },
  { id:'zsign',       label:'zsign (Free)',       desc:'Sign any IPA without Apple ID — install zsign.exe',     color:'#60a5fa' },
  { id:'trollstore',  label:'TrollStore',         desc:'Permanent install on supported iOS versions (on device)',color:'#a78bfa' },
  { id:'altstore',    label:'AltStore / SideStore',desc:'7-day signing via Apple ID — requires AltServer PC app',color:'#f59e0b' },
  { id:'ipatool',     label:'ipatool Download',   desc:'Download paid/free apps from App Store with Apple ID',  color:'#fb923c' },
]

export default function Sideloader({ device, addLog }) {
  const [tab, setTab] = useState('ios')
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState({ pct:0, msg:'' })
  const [history, setHistory] = useState([])
  const [ipaInfo, setIpaInfo] = useState(null)
  const [tools, setTools] = useState([])
  const [ipatool, setIpatool] = useState({ bundleId:'', appleId:'', password:'' })
  const [method, setMethod] = useState('direct')

  const serial = device?.serial
  const udid = device?.udid || device?.serial
  const isIos = device?.deviceType === 'ios' || device?.type === 'ios'
  const isAndroid = device?.deviceType === 'android'

  useEffect(() => {
    const r = ft.on('sideload:progress', p => setProgress({ pct:p.percent||0, msg:p.message||'' }))
    ft.sideload.checkIosTools().then(r => setTools(r.tools||[])).catch(()=>{})
    return () => r()
  }, [])

  // ── Android APK ────────────────────────────────────────────────────────────
  const installApk = async () => {
    if (!serial) return addLog('Connect Android device first')
    const files = await ft.sideload.pickApk().catch(()=>[])
    if (!files?.length) return
    setInstalling(true)
    for (const f of files) {
      const name = f.split('\\').pop().split('/').pop()
      setProgress({ pct:0, msg:'Installing '+name })
      const isXapk = name.match(/\.xapk$|\.apks$/i)
      const r = await (isXapk
        ? ft.sideload.xapk({ serial, xapkPath: f })
        : ft.sideload.apk({ serial, apkPath: f })
      ).catch(e => ({ success:false, error:e.message }))
      const status = r.success ? 'success' : 'error'
      setHistory(h => [...h, { name, status, error:r.error }])
      addLog(r.success ? 'Installed: ' + name : 'Failed: ' + (r.error||'unknown error'))
    }
    setInstalling(false)
  }

  // ── iOS IPA ────────────────────────────────────────────────────────────────
  const analyzeIpa = async () => {
    const r = await ft.sideload.analyzeIpa().catch(e => ({ error: e.message }))
    if (r.cancelled) return
    if (r.success) { setIpaInfo(r); addLog('IPA analyzed: ' + r.name) }
    else addLog('Analyze failed: ' + r.error)
  }

  const installIpa = async () => {
    const files = await ft.sideload.pickIpa().catch(()=>[])
    if (!files?.length) return
    const f = files[0]
    const name = f.split('\\').pop().split('/').pop()
    setInstalling(true)
    setProgress({ pct:5, msg:'Starting install...' })

    // Analyze first
    const info = await ft.sideload.analyzeIpaPath({ path: f }).catch(()=>null)
    if (info?.success) setIpaInfo(info)

    const r = await ft.sideload.ipa({ serial: udid, ipaPath: f })
      .catch(e => ({ success:false, error:e.message }))

    setHistory(h => [...h, { name, status:r.success?'success':'error', method:r.method, error:r.error }])

    if (r.success) {
      addLog('IPA installed: ' + name + (r.method?' via '+r.method:''))
    } else {
      addLog('IPA install failed: ' + (r.error||'unknown'))
      if (r.suggestions) r.suggestions.forEach(s => addLog('  Tip: ' + s))
    }
    setInstalling(false)
  }

  const downloadIpatool = async () => {
    if (!ipatool.bundleId||!ipatool.appleId||!ipatool.password) return addLog('Fill in all ipatool fields')
    setInstalling(true)
    setProgress({ pct:10, msg:'Downloading from App Store...' })
    const r = await ft.sideload.ipatoolDownload(ipatool).catch(e=>({error:e.message}))
    if (r.success) { addLog('Downloaded: '+r.path); ft.sideload.openDownloads() }
    else addLog('ipatool failed: '+r.error)
    setInstalling(false)
  }

  const idevInstalled = tools.find(t=>t.name==='ideviceinstaller')?.installed
  const zsignInstalled = tools.find(t=>t.name==='zsign')?.installed
  const ipatoolInstalled = tools.find(t=>t.name==='ipatool')?.installed

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}>📲</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Sideloader</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Install APK, XAPK and IPA files without app stores</div>
        </div>
        {device && <div style={{ fontSize:11, padding:'4px 10px', background:isIos?'rgba(96,165,250,0.15)':'rgba(74,222,128,0.15)', border:`1px solid ${isIos?'rgba(96,165,250,0.3)':'rgba(74,222,128,0.3)'}`, borderRadius:6, color:isIos?'#60a5fa':'#4ade80', fontWeight:600 }}>
          {isIos ? 'iPhone' : 'Android'}: {device.model||device.name||serial?.slice(0,10)}
        </div>}
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3 }}>
        {[['ios','iPhone / iPad'],['android','Android'],['tools','Tools & Info']].map(([id,l]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'8px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>
        ))}
      </div>

      {tab === 'ios' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

          {/* Method selector */}
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', marginBottom:6 }}>INSTALL METHOD</div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {INSTALL_METHODS.map(m => (
                <button key={m.id} onClick={() => setMethod(m.id)}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, cursor:'pointer', textAlign:'left', background: method===m.id ? `${m.color}15` : 'var(--bg1)', border:`1px solid ${method===m.id ? m.color : 'var(--border)'}`, transition:'all 0.15s' }}>
                  <div style={{ width:10, height:10, borderRadius:'50%', background: method===m.id ? m.color : 'var(--bg3)', border:`2px solid ${m.color}`, flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:700, color: method===m.id ? m.color : 'var(--text)' }}>{m.label}</div>
                    <div style={{ fontSize:10, color:'var(--text3)' }}>{m.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Direct install */}
          {method === 'direct' && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:10 }}>
                Installs via ideviceinstaller. Works for: developer-signed IPAs, enterprise distribution, AdHoc signed, apps from AltStore export. The IPA must already be signed with a valid certificate.
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={analyzeIpa} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>Analyze IPA</button>
                <button onClick={installIpa} disabled={installing||!idevInstalled} style={{ padding:'8px 18px', borderRadius:7, fontSize:13, fontWeight:700, cursor:installing||!idevInstalled?'not-allowed':'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!idevInstalled?0.5:1 }}>
                  {installing ? 'Installing...' : 'Choose IPA and Install'}
                </button>
              </div>
              {!idevInstalled && <div style={{ marginTop:8, fontSize:11, color:'#f87171' }}>ideviceinstaller missing — run install-tools.ps1</div>}
            </div>
          )}

          {/* zsign */}
          {method === 'zsign' && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:10 }}>
                zsign signs the IPA with a self-signed certificate and installs it. No Apple ID needed. Apps expire after 7 days unless device is jailbroken or using TrollStore.
              </div>
              {!zsignInstalled && (
                <div style={{ padding:10, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:7, fontSize:12, color:'#f59e0b', marginBottom:10 }}>
                  zsign.exe not found in bin/. Download from github.com/zhlynn/zsign/releases and put zsign.exe in your bin/ folder.
                  <button onClick={() => ft.openUrl('https://github.com/zhlynn/zsign/releases')} style={{ display:'block', marginTop:6, padding:'4px 10px', borderRadius:5, fontSize:10, cursor:'pointer', background:'rgba(245,158,11,0.2)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.3)' }}>Open zsign releases</button>
                </div>
              )}
              <button onClick={installIpa} disabled={installing||!zsignInstalled||!idevInstalled} style={{ padding:'8px 18px', borderRadius:7, fontSize:13, fontWeight:700, cursor:'pointer', background:'#60a5fa22', color:'#60a5fa', border:'1px solid rgba(96,165,250,0.4)', opacity:(!zsignInstalled||!idevInstalled)?0.5:1 }}>
                {installing ? 'Signing + Installing...' : 'Choose IPA, Sign and Install'}
              </button>
            </div>
          )}

          {/* TrollStore */}
          {method === 'trollstore' && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:12 }}>
                TrollStore installs apps permanently with root-level entitlements — no 7-day expiry, no Apple ID. It must be installed on the device first. Supported on specific iOS versions only.
              </div>
              {[
                { ios:'iOS 14.0 - 16.6.1', method:'TrollInstallerX', url:'https://github.com/alfiecg24/TrollInstallerX' },
                { ios:'iOS 15.0 - 16.6.1 (A12+)', method:'TrollStar', url:'https://github.com/34306/TrollStar' },
                { ios:'iOS 14.0 (older)', method:'IPATool + OTA URL method', url:'https://github.com/opa334/TrollStore' },
              ].map((s,i) => (
                <div key={i} style={{ display:'flex', gap:10, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{s.ios}</div>
                    <div style={{ fontSize:11, color:'var(--text3)' }}>Install via: {s.method}</div>
                  </div>
                  <button onClick={() => ft.openUrl(s.url)} style={{ padding:'4px 10px', borderRadius:5, fontSize:10, cursor:'pointer', background:'rgba(167,139,250,0.15)', color:'#a78bfa', border:'1px solid rgba(167,139,250,0.3)', flexShrink:0 }}>Guide</button>
                </div>
              ))}
              <div style={{ marginTop:12, fontSize:11, color:'var(--text3)', lineHeight:1.7 }}>
                Once TrollStore is installed: open TrollStore on device, tap the + button, choose an IPA from Files app. Or use the URL scheme: trollstore:///install?url=...
              </div>
            </div>
          )}

          {/* AltStore */}
          {method === 'altstore' && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:12 }}>
                AltStore and SideStore sign apps with your Apple ID. Apps expire every 7 days. AltServer must be running on your PC. SideStore works without a PC after initial setup.
              </div>
              {[
                { name:'AltStore', desc:'PC companion app required, reliable', url:'https://altstore.io' },
                { name:'SideStore', desc:'No PC needed after initial install', url:'https://sidestore.io' },
                { name:'ESign (On-device)', desc:'Sign IPAs directly on device (jailbreak or TrollStore)', url:'https://esign.yyyue.xyz' },
              ].map((s,i) => (
                <div key={i} style={{ display:'flex', gap:10, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{s.name}</div>
                    <div style={{ fontSize:11, color:'var(--text3)' }}>{s.desc}</div>
                  </div>
                  <button onClick={() => ft.openUrl(s.url)} style={{ padding:'4px 10px', borderRadius:5, fontSize:10, cursor:'pointer', background:'rgba(245,158,11,0.15)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.3)', flexShrink:0 }}>Open</button>
                </div>
              ))}
            </div>
          )}

          {/* ipatool */}
          {method === 'ipatool' && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:10 }}>
                ipatool downloads purchased or free App Store apps as IPA files using your Apple ID. Requires ipatool.exe in bin/.
              </div>
              {!ipatoolInstalled && <div style={{ padding:8, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:6, fontSize:11, color:'#f59e0b', marginBottom:10 }}>
                ipatool.exe missing. <button onClick={() => ft.openUrl('https://github.com/majd/ipatool/releases')} style={{ background:'none', border:'none', color:'#f59e0b', cursor:'pointer', textDecoration:'underline', fontSize:11 }}>Download from GitHub</button> and put in bin/
              </div>}
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:10 }}>
                <input value={ipatool.bundleId} onChange={e=>setIpatool(v=>({...v,bundleId:e.target.value}))} placeholder="Bundle ID e.g. com.apple.Pages" style={{ fontFamily:'monospace', fontSize:12 }} />
                <input value={ipatool.appleId} onChange={e=>setIpatool(v=>({...v,appleId:e.target.value}))} placeholder="Apple ID email" style={{ fontSize:12 }} />
                <input value={ipatool.password} onChange={e=>setIpatool(v=>({...v,password:e.target.value}))} type="password" placeholder="Apple ID password" style={{ fontSize:12 }} />
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={downloadIpatool} disabled={installing||!ipatoolInstalled} style={{ padding:'8px 16px', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', background:'rgba(251,146,60,0.2)', color:'#fb923c', border:'1px solid rgba(251,146,60,0.4)', opacity:!ipatoolInstalled?0.5:1 }}>
                  {installing ? 'Downloading...' : 'Download IPA'}
                </button>
                <button onClick={() => ft.sideload.openDownloads()} style={{ padding:'8px 12px', borderRadius:7, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Open Downloads</button>
              </div>
            </div>
          )}

          {/* Progress */}
          {installing && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:8, padding:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text3)', marginBottom:6 }}>
                <span>{progress.msg}</span><span>{progress.pct}%</span>
              </div>
              <div style={{ height:5, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', width:Math.min(progress.pct,100)+'%', background:'var(--accent)', borderRadius:3, transition:'width 0.3s' }} />
              </div>
            </div>
          )}

          {/* IPA info */}
          {ipaInfo && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>IPA INFO</div>
              <InfoRow label="Name" value={ipaInfo.name} />
              <InfoRow label="Bundle ID" value={ipaInfo.bundleId} mono />
              <InfoRow label="Version" value={ipaInfo.version + ' (' + ipaInfo.build + ')'} />
              <InfoRow label="Min iOS" value={ipaInfo.minIos} />
              <InfoRow label="File size" value={ipaInfo.fileSizeMb + ' MB'} />
              <InfoRow label="Signed" value={ipaInfo.hasProvision ? 'Has provisioning profile' : 'No provisioning profile'} color={ipaInfo.hasProvision?'#4ade80':'#f59e0b'} />
            </div>
          )}
        </div>
      )}

      {tab === 'android' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ padding:12, background:'rgba(74,222,128,0.08)', border:'1px solid rgba(74,222,128,0.2)', borderRadius:8, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            Supports APK, XAPK (split APKs) and APKS bundle files. USB debugging must be enabled on the device.
          </div>
          <button onClick={installApk} disabled={installing||!serial} style={{ padding:'12px', borderRadius:9, fontSize:14, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>
            {installing ? 'Installing...' : 'Choose APK / XAPK and Install'}
          </button>
          {!serial && <div style={{ fontSize:12, color:'#f59e0b' }}>Connect an Android device first.</div>}
          {installing && (
            <div style={{ background:'var(--bg1)', borderRadius:8, padding:12, border:'1px solid var(--border)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text3)', marginBottom:6 }}>
                <span>{progress.msg}</span><span>{progress.pct}%</span>
              </div>
              <div style={{ height:5, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', width:progress.pct+'%', background:'var(--accent)', transition:'width 0.3s' }} />
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'tools' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', marginBottom:6 }}>IOS TOOL STATUS</div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {tools.map((t,i) => <ToolBadge key={i} {...t} />)}
            </div>
          </div>
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:10 }}>Method Comparison</div>
            {[
              { method:'Direct (ideviceinstaller)', noJB:'Signed only', jb:'Any', expiry:'Never', appleId:'No',  noRoot:'Yes' },
              { method:'zsign',                    noJB:'7 days',       jb:'Any', expiry:'7 days',  appleId:'No',  noRoot:'Yes' },
              { method:'TrollStore',               noJB:'Never',        jb:'N/A', expiry:'Never',  appleId:'No',  noRoot:'No (TrollStore needed)' },
              { method:'AltStore',                 noJB:'7 days',       jb:'Any', expiry:'7 days',  appleId:'Yes', noRoot:'Yes' },
              { method:'ipatool',                  noJB:'Download only',jb:'N/A', expiry:'N/A',    appleId:'Yes', noRoot:'Yes' },
            ].map((r,i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr 1fr 1fr', gap:8, padding:'7px 0', borderBottom:'1px solid var(--border)', fontSize:11 }}>
                <span style={{ fontWeight:600, color:'var(--text)' }}>{r.method}</span>
                <span style={{ color:'var(--text3)' }}>Expiry: {r.expiry}</span>
                <span style={{ color:'var(--text3)' }}>Apple ID: {r.appleId}</span>
                <span style={{ color:'var(--text3)' }}>No root: {r.noRoot}</span>
              </div>
            ))}
          </div>
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:8 }}>Get Missing Tools</div>
            {[
              { name:'zsign', desc:'Free IPA signing CLI', url:'https://github.com/zhlynn/zsign/releases' },
              { name:'ipatool', desc:'App Store IPA downloader', url:'https://github.com/majd/ipatool/releases' },
              { name:'TrollStore', desc:'Permanent app installer (device)', url:'https://github.com/opa334/TrollStore' },
            ].map((t,i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{t.name}</div>
                  <div style={{ fontSize:10, color:'var(--text3)' }}>{t.desc}</div>
                </div>
                <button onClick={() => ft.openUrl(t.url)} style={{ padding:'4px 10px', borderRadius:5, fontSize:10, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Download</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', marginBottom:6 }}>INSTALL LOG</div>
          {[...history].reverse().slice(0,8).map((h,i) => (
            <div key={i} style={{ display:'flex', gap:8, padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:11 }}>
              <span style={{ color:h.status==='success'?'#4ade80':'#f87171', fontWeight:700 }}>{h.status==='success'?'OK':'ERR'}</span>
              <span style={{ color:'var(--text2)', flex:1 }}>{h.name}</span>
              {h.method && <span style={{ color:'var(--text3)' }}>{h.method}</span>}
              {h.error && <span style={{ color:'#f87171', fontSize:10 }}>{h.error.slice(0,40)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
