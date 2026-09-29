import { useState, useEffect, useRef } from 'react'

const ft = window.ft
const STARS = n => Array(5).fill(0).map((_,i) => i < (n||3) ? '\u2605' : '\u2606').join('')
const clamp = (n,a,b) => Math.min(b, Math.max(a, n||0))
const CAT_COLOR = {'Multi-boot':'#4ade80','ISO Flasher':'#60a5fa','Specialist':'#f87171','Drive Utility':'#fb923c'}
const TAG_COLOR = {recommended:'#4ade80',free:'#60a5fa','open-source':'#a78bfa','windows-only':'#fb923c',fast:'#facc15',beginner:'#4ade80',specialist:'#f87171',samsung:'#60a5fa',mediatek:'#fb923c',qualcomm:'#f87171',ios:'#c4b5fd',pixel:'#4ade80',partition:'#facc15',bootable:'#4ade80',portable:'#facc15','cross-platform':'#4ade80','raspberry-pi':'#e879f9'}

function Tag({ t }) {
  const c = TAG_COLOR[t] || '#888'
  return <span style={{ display:'inline-block', padding:'2px 7px', borderRadius:4, fontSize:10, fontWeight:600, marginRight:3, marginBottom:3, background:c+'22', color:c, border:`1px solid ${c}44` }}>{t}</span>
}

function Bar({ pct, color }) {
  return <div style={{ background:'var(--bg3)', borderRadius:3, height:6, overflow:'hidden' }}>
    <div style={{ width:clamp(pct,0,100)+'%', height:'100%', background:color||'var(--accent)', borderRadius:3, transition:'width 0.3s' }} />
  </div>
}

function ToolCard({ tool, onLaunch, onDownload, onSite, busy }) {
  const [open, setOpen] = useState(false)
  const cc = CAT_COLOR[tool.category] || '#888'
  return (
    <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}
      onMouseEnter={e=>e.currentTarget.style.borderColor='var(--border2)'}
      onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
      <div style={{ padding:'12px 14px', display:'flex', gap:12, alignItems:'flex-start' }}>
        <div style={{ width:44, height:44, borderRadius:10, background:cc+'22', border:`1px solid ${cc}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:700, color:cc, flexShrink:0 }}>{tool.icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3, flexWrap:'wrap' }}>
            <span style={{ fontSize:15, fontWeight:700, color:'var(--text)' }}>{tool.name}</span>
            <span style={{ fontSize:10, padding:'2px 6px', borderRadius:4, background:cc+'22', color:cc, fontWeight:600 }}>{tool.category}</span>
            {tool.installed && <span style={{ fontSize:10, padding:'2px 6px', borderRadius:4, background:'#4ade8022', color:'#4ade80', fontWeight:600 }}>Installed</span>}
            {!tool.installed && !tool.openInBrowser && <span style={{ fontSize:10, padding:'2px 6px', borderRadius:4, background:'#fb923c22', color:'#fb923c', fontWeight:600 }}>Not installed</span>}
            {tool.openInBrowser && <span style={{ fontSize:10, padding:'2px 6px', borderRadius:4, background:'#60a5fa22', color:'#60a5fa', fontWeight:600 }}>Web app</span>}
          </div>
          <div style={{ fontSize:12, color:'var(--text2)', marginBottom:3 }}>{tool.tagline}</div>
          <div style={{ fontSize:10, color:'var(--text3)' }}>{STARS(tool.rating)}</div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:5, flexShrink:0, alignItems:'flex-end' }}>
          {tool.installed && !tool.openInBrowser && <button onClick={() => onLaunch(tool)} disabled={!!busy} style={{ padding:'6px 14px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Launch</button>}
          {tool.openInBrowser && <button onClick={() => onSite(tool)} style={{ padding:'6px 14px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', background:'#60a5fa33', color:'#60a5fa', border:'1px solid #60a5fa44' }}>Open</button>}
          {!tool.installed && !tool.openInBrowser && <button onClick={() => onDownload(tool)} disabled={!!busy} style={{ padding:'6px 14px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', background:'#4ade8022', color:'#4ade80', border:'1px solid #4ade8044' }}>{busy===tool.id ? '...' : 'Download'}</button>}
          {tool.websiteUrl && <button onClick={() => onSite(tool)} style={{ padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Website</button>}
          <button onClick={() => setOpen(o=>!o)} style={{ padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>{open ? 'Less' : 'Details'}</button>
        </div>
      </div>
      <div style={{ padding:'0 14px 8px' }}>{tool.tags?.map(t => <Tag key={t} t={t} />)}</div>
      {open && (
        <div style={{ borderTop:'1px solid var(--border)', padding:'12px 14px', background:'var(--bg2)', display:'flex', gap:16, flexWrap:'wrap' }}>
          <div style={{ flex:2, minWidth:180 }}>
            <p style={{ margin:'0 0 10px', fontSize:12, color:'var(--text2)', lineHeight:1.8 }}>{tool.description}</p>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--text3)', marginBottom:4 }}>BEST FOR</div>
            <div style={{ fontSize:12, color:'var(--accent)' }}>{tool.bestFor}</div>
          </div>
          <div style={{ flex:1, minWidth:160 }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#4ade80', marginBottom:4 }}>PROS</div>
            {tool.pros?.map((p,i) => <div key={i} style={{ fontSize:11, color:'var(--text2)', marginBottom:2 }}>+ {p}</div>)}
            <div style={{ fontSize:11, fontWeight:600, color:'#f87171', marginTop:8, marginBottom:4 }}>CONS</div>
            {tool.cons?.map((p,i) => <div key={i} style={{ fontSize:11, color:'var(--text2)', marginBottom:2 }}>- {p}</div>)}
          </div>
        </div>
      )}
    </div>
  )
}

function WizardCard({ uc, tools, onUse }) {
  const [open, setOpen] = useState(false)
  const tool = tools.find(t => t.id === uc.recommendedTool)
  return (
    <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', cursor:'pointer' }} onClick={() => setOpen(o=>!o)}>
      <div style={{ padding:'12px 14px', display:'flex', gap:12, alignItems:'center' }}>
        <div style={{ width:40, height:40, borderRadius:8, background:'var(--accent-dim)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0 }}>{uc.icon}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:2 }}>{uc.name}</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>{uc.desc}</div>
          <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>Tool: <span style={{ color:'var(--accent)' }}>{tool?.name || uc.recommendedTool}</span>{uc.minGb > 0 && <span> &middot; {uc.minGb}GB+ USB</span>}</div>
        </div>
        <span style={{ color:'var(--text3)', fontSize:16 }}>{open ? ' ' : ' '}</span>
      </div>
      {open && (
        <div style={{ borderTop:'1px solid var(--border)', padding:'14px', background:'var(--bg2)' }} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--text3)', marginBottom:10, letterSpacing:'0.05em' }}>STEP BY STEP</div>
          {uc.steps.map((step, i) => (
            <div key={i} style={{ display:'flex', gap:10, marginBottom:10 }}>
              <div style={{ width:24, height:24, borderRadius:'50%', background:'var(--accent)', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0 }}>{i+1}</div>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, paddingTop:3 }}>{step}</div>
            </div>
          ))}
          {tool && (
            <div style={{ marginTop:4 }}>
              {!tool.openInBrowser && <button onClick={() => onUse(tool)} style={{ padding:'7px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background: tool.installed ? 'var(--accent)' : '#4ade8022', color: tool.installed ? '#000' : '#4ade80', border: tool.installed ? 'none' : '1px solid #4ade8044' }}>{tool.installed ? 'Launch' : 'Download'} {tool.name}</button>}
              {tool.openInBrowser && <button onClick={() => ft.openUrl(tool.websiteUrl)} style={{ padding:'7px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'#60a5fa33', color:'#60a5fa', border:'1px solid #60a5fa44' }}>Open {tool.name}</button>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function UsbFlashCentre({ addLog }) {
  const [tab, setTab] = useState('tools')
  const [tools, setTools] = useState([])
  const [useCases, setUseCases] = useState([])
  const [bootKeys, setBootKeys] = useState([])
  const [drives, setDrives] = useState([])
  const [isoLib, setIsoLib] = useState([])
  const [selIso, setSelIso] = useState(null)
  const [selDrive, setSelDrive] = useState(null)
  const [writing, setWriting] = useState(false)
  const [writeP, setWriteP] = useState({ percent:0, msg:'' })
  const [writeLog, setWriteLog] = useState([])
  const [verifying, setVerifying] = useState(false)
  const [verifyR, setVerifyR] = useState(null)
  const [busy, setBusy] = useState(null)
  const [dlP, setDlP] = useState({ percent:0, msg:'' })
  const [cat, setCat] = useState('All')
  const [q, setQ] = useState('')
  const logEl = useRef(null)

  useEffect(() => {
    loadAll()
    const r1 = ft.on('flash:write:progress', p => {
      setWriteP({ percent:p.percent||0, msg:p.message||'' })
      if (p.message) { setWriteLog(prev => [...prev.slice(-400), p.message]); setTimeout(() => { if (logEl.current) logEl.current.scrollTop = logEl.current.scrollHeight }, 50) }
    })
    const r2 = ft.on('usb:tools:progress', p => setDlP({ percent:p.percent||0, msg:p.message||'' }))
    return () => { r1(); r2() }
  }, [])

  const loadAll = async () => {
    const [t,u,k,d,i] = await Promise.all([
      ft.flash.tools.list().catch(()=>[]),
      ft.flash.wizard.cases().catch(()=>[]),
      ft.flash.wizard.keys().catch(()=>[]),
      ft.usb.drives.list().catch(()=>[]),
      ft.usb.iso.list().catch(()=>[]),
    ])
    setTools(t); setUseCases(u); setBootKeys(k); setDrives(d); setIsoLib(i)
  }

  const launchTool = async tool => {
    const r = await ft.flash.tools.launch({ url: tool.websiteUrl, localPath: tool.localPath, toolId: tool.id }).catch(e => ({ error: e.message }))
    addLog(r?.error ? `${tool.name}: ${r.error}` : `Launched ${tool.name}`)
  }

  const downloadTool = async tool => {
    setBusy(tool.id); setDlP({ percent:0, msg:`Downloading ${tool.name}...` })
    const r = await ft.usb.tools.download({ toolId: tool.id }).catch(e => ({ error: e.message }))
    setBusy(null)
    if (r?.success) { addLog(`Downloaded ${tool.name}`); loadAll() }
    else addLog(`Download failed: ${r?.error || 'Unknown'}`)
  }

  const startWrite = async () => {
    if (!selIso || !selDrive) return addLog('Select an ISO and a USB drive first')
    setWriting(true); setWriteLog([]); setVerifyR(null); setWriteP({ percent:0, msg:'Starting...' })
    try {
      const r = await ft.flash.write.start({ isoPath: selIso.path, device: selDrive.device })
      setWriteP({ percent: r.success ? 100 : 0, msg: r.success ? 'Write complete!' : 'Write failed' })
      addLog(r.success ? `Write complete: ${selIso.filename}` : `Write failed`)
    } catch (e) { setWriteP({ percent:0, msg:'Error: ' + e.message }); addLog('Write error: ' + e.message) }
    setWriting(false)
  }

  const doVerify = async () => {
    if (!selIso || !selDrive) return
    setVerifying(true); setVerifyR(null)
    const r = await ft.flash.write.verify({ isoPath: selIso.path, device: selDrive.device }).catch(e => ({ error: e.message }))
    setVerifyR(r); setVerifying(false)
    addLog(r.match ? 'Verify: PASSED' : `Verify: FAILED`)
  }

  const cats = ['All', ...new Set(tools.map(t => t.category).filter(Boolean))]
  const vis = tools.filter(t => {
    if (cat !== 'All' && t.category !== cat) return false
    if (q && !t.name.toLowerCase().includes(q.toLowerCase()) && !t.tagline?.toLowerCase().includes(q.toLowerCase()) && !t.tags?.some(tg => tg.includes(q.toLowerCase()))) return false
    return true
  })

  const TABS = [['tools','Tools'],['flash','Quick Flash'],['wizard','Guide Me'],['bootkeys','Boot Keys']]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>USB Flash Centre</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Every flashing tool in one place -- launch, download, write, guide</div>
        </div>
        <button onClick={loadAll} style={{ padding:'6px 12px', borderRadius:7, fontSize:12, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Refresh</button>
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:4 }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'8px 6px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background: tab===id ? 'var(--accent)' : 'transparent', color: tab===id ? '#000' : 'var(--text3)', border:'none' }}>{label}</button>
        ))}
      </div>

      {tab === 'tools' && <>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search tools..." style={{ flex:1, minWidth:150, padding:'7px 10px', fontSize:13, background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:7, color:'var(--text)' }} />
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {cats.map(c => <button key={c} onClick={() => setCat(c)} style={{ padding:'5px 10px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background: cat===c ? 'var(--accent-dim)' : 'var(--bg2)', color: cat===c ? 'var(--accent)' : 'var(--text3)', border:`1px solid ${cat===c ? 'var(--accent-border)' : 'var(--border)'}` }}>{c}</button>)}
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {vis.map(tool => <ToolCard key={tool.id} tool={tool} busy={busy} onLaunch={launchTool} onDownload={downloadTool} onSite={t => ft.openUrl(t.websiteUrl)} />)}
          {!vis.length && <div style={{ textAlign:'center', padding:40, color:'var(--text3)' }}>No tools match</div>}
        </div>
        {busy && <div style={{ padding:12, background:'var(--bg2)', borderRadius:8, border:'1px solid var(--border)' }}>
          <div style={{ fontSize:12, marginBottom:6 }}>{dlP.msg}</div>
          <Bar pct={dlP.percent} />
          <div style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>{dlP.percent}%</div>
        </div>}
      </>}

      {tab === 'flash' && <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:8, padding:12, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
          Direct write without an external tool. For features like TPM bypass, persistence, or per-device firmware, use a tool from the Tools tab.
        </div>
        <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:10 }}>
            <div style={{ width:26, height:26, borderRadius:'50%', background:'var(--accent)', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700 }}>1</div>
            <span style={{ fontSize:14, fontWeight:600 }}>Select ISO</span>
            {selIso && <span style={{ fontSize:11, color:'var(--accent)', marginLeft:4 }}>{selIso.filename}</span>}
            <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
              <button onClick={async () => { const r = await ft.usb.iso.add().catch(()=>null); if (!r?.cancelled) { const i = await ft.usb.iso.list(); setIsoLib(i) } }} style={{ padding:'5px 10px', borderRadius:6, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>+ Add</button>
              <button onClick={() => ft.usb.iso.openDir()} style={{ padding:'5px 10px', borderRadius:6, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Folder</button>
            </div>
          </div>
          {isoLib.map((iso, i) => (
            <div key={i} onClick={() => setSelIso(iso)} style={{ padding:'9px 12px', borderRadius:7, cursor:'pointer', display:'flex', alignItems:'center', gap:10, marginBottom:4, background: selIso?.path===iso.path ? 'var(--accent-dim)' : 'var(--bg2)', border:`1px solid ${selIso?.path===iso.path ? 'var(--accent-border)' : 'var(--border)'}` }}>
              <span style={{ fontSize:18 }}> </span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color: selIso?.path===iso.path ? 'var(--accent)' : 'var(--text)' }}>{iso.filename}</div>
                <div style={{ fontSize:10, color:'var(--text3)' }}>{iso.sizeGb} GB</div>
              </div>
              {selIso?.path===iso.path && <span style={{ color:'var(--accent)' }}>checkmark</span>}
            </div>
          ))}
          {!isoLib.length && <div style={{ fontSize:12, color:'var(--text3)' }}>No ISOs. Add a file or download from USB Hub.</div>}
        </div>
        <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:10 }}>
            <div style={{ width:26, height:26, borderRadius:'50%', background:'var(--accent)', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700 }}>2</div>
            <span style={{ fontSize:14, fontWeight:600 }}>Select USB Drive</span>
            {selDrive && <span style={{ fontSize:11, color:'var(--accent)', marginLeft:4 }}>{selDrive.label}</span>}
            <button onClick={async () => { const d = await ft.usb.drives.list().catch(()=>[]); setDrives(d) }} style={{ marginLeft:'auto', padding:'5px 10px', borderRadius:6, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Refresh</button>
          </div>
          {drives.length ? drives.map((d, i) => (
            <div key={i} onClick={() => setSelDrive(d)} style={{ padding:'10px 12px', borderRadius:7, cursor:'pointer', display:'flex', alignItems:'center', gap:12, marginBottom:4, background: selDrive?.device===d.device ? 'var(--accent-dim)' : 'var(--bg2)', border:`2px solid ${selDrive?.device===d.device ? 'var(--accent)' : 'var(--border)'}` }}>
              <span style={{ fontSize:22 }}> </span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color: selDrive?.device===d.device ? 'var(--accent)' : 'var(--text)' }}>{d.label || d.name}</div>
                <div style={{ fontSize:11, color:'var(--text3)' }}>{d.device}   {d.fs}   {d.sizeGb} GB</div>
              </div>
              {selDrive?.device===d.device && <span style={{ color:'var(--accent)', fontSize:18 }}>OK</span>}
            </div>
          )) : <div style={{ fontSize:12, color:'var(--text3)' }}>No USB drives detected. Plug in and click Refresh.</div>}
        </div>
        <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12 }}>
            <div style={{ width:26, height:26, borderRadius:'50%', background:'var(--accent)', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700 }}>3</div>
            <span style={{ fontSize:14, fontWeight:600 }}>Write</span>
          </div>
          {(selIso || selDrive) && (
            <div style={{ padding:10, background:'var(--bg2)', borderRadius:8, marginBottom:12, fontSize:12 }}>
              <div style={{ marginBottom:3 }}><span style={{ color:'var(--text3)', minWidth:50, display:'inline-block' }}>ISO:</span> <span style={{ color: selIso ? 'var(--accent)' : 'var(--text3)' }}>{selIso?.filename || 'Not selected'}</span></div>
              <div><span style={{ color:'var(--text3)', minWidth:50, display:'inline-block' }}>Drive:</span> <span style={{ color: selDrive ? 'var(--accent)' : 'var(--text3)' }}>{selDrive ? `${selDrive.label} (${selDrive.device})` : 'Not selected'}</span></div>
            </div>
          )}
          <div style={{ padding:'8px 12px', background:'#f8717115', border:'1px solid #f8717133', borderRadius:6, fontSize:11, color:'#f87171', marginBottom:12 }}>
            All data on the selected USB drive will be permanently erased.
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={startWrite} disabled={writing || !selIso || !selDrive} style={{ padding:'10px 20px', borderRadius:8, fontSize:13, fontWeight:700, cursor:(!selIso||!selDrive||writing)?'not-allowed':'pointer', background:(!selIso||!selDrive)?'var(--bg3)':'var(--accent)', color:(!selIso||!selDrive)?'var(--text3)':'#000', border:'none' }}>
              {writing ? 'Writing...' : 'Write ISO to USB'}
            </button>
            {writing && <button onClick={() => ft.flash.write.cancel()} style={{ padding:'10px 16px', borderRadius:8, fontSize:13, cursor:'pointer', background:'#f8717122', color:'#f87171', border:'1px solid #f8717144', fontWeight:600 }}>Cancel</button>}
            {!writing && writeP.percent === 100 && <button onClick={doVerify} disabled={verifying} style={{ padding:'10px 16px', borderRadius:8, fontSize:13, cursor:'pointer', background:'#60a5fa22', color:'#60a5fa', border:'1px solid #60a5fa44', fontWeight:600 }}>{verifying ? 'Verifying...' : 'Verify (SHA256)'}</button>}
          </div>
          {writeP.percent > 0 && <div style={{ marginTop:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text3)', marginBottom:4 }}><span>{writeP.msg}</span><span>{writeP.percent}%</span></div>
            <Bar pct={writeP.percent} color={writeP.percent===100 ? '#4ade80' : 'var(--accent)'} />
          </div>}
          {writeLog.length > 0 && <div ref={logEl} style={{ marginTop:10, fontFamily:'monospace', fontSize:10, background:'var(--bg)', border:'1px solid var(--border)', borderRadius:6, padding:8, maxHeight:120, overflowY:'auto', color:'#a8ff78', lineHeight:1.7 }}>{writeLog.map((l,i) => <div key={i}>{l}</div>)}</div>}
          {verifyR && <div style={{ marginTop:10, padding:10, borderRadius:8, background: verifyR.match ? '#4ade8022' : '#f8717122', border:`1px solid ${verifyR.match ? '#4ade8044' : '#f8717144'}` }}>
            <div style={{ fontSize:13, fontWeight:700, color: verifyR.match ? '#4ade80' : '#f87171', marginBottom:6 }}>{verifyR.match ? 'Verify PASSED' : 'Verify FAILED'}</div>
            <div style={{ fontFamily:'monospace', fontSize:10, color:'var(--text3)', lineHeight:1.8 }}><div>ISO: {verifyR.isoHash}</div><div>USB: {verifyR.usbHash}</div></div>
          </div>}
        </div>
      </div>}

      {tab === 'wizard' && <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.7 }}>Pick what you want to do. Get step-by-step instructions and the right tool.</div>
        {useCases.map(uc => <WizardCard key={uc.id} uc={uc} tools={tools} onUse={t => { if (t.installed) launchTool(t); else downloadTool(t) }} />)}
      </div>}

      {tab === 'bootkeys' && <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Boot Menu Keys</div>
          <div style={{ fontSize:12, color:'var(--text3)', marginBottom:14 }}>Press immediately after power button -- before Windows logo appears.</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:8 }}>
            {bootKeys.map((k,i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', background:'var(--bg2)', borderRadius:8, border:'1px solid var(--border)' }}>
                <span style={{ fontSize:14, fontWeight:600 }}>{k.brand}</span>
                <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:700, color:'var(--accent)', background:'var(--accent-dim)', padding:'4px 10px', borderRadius:5 }}>{k.keys}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:10 }}>Troubleshooting</div>
          {[
            ['USB not in boot list', 'Go into BIOS (Del or F2) and move USB to top of boot order. Save and exit.'],
            ['F12 does nothing', 'Try Del, Esc, F2, F10 rapidly right after pressing power. Every board differs.'],
            ['Secure Boot blocking', 'BIOS > Security > Secure Boot > Disable. Needed for unsigned Linux ISOs.'],
            ['Fast Boot blocking USB', 'BIOS > Fast Boot > Disable. Some boards skip USB detection with it on.'],
            ['Windows 11 BIOS shortcut', 'Shift + Restart > Troubleshoot > Advanced > UEFI Firmware Settings.'],
            ['MacBook boot picker', 'Hold Option (Alt) on power. Keep holding until disk selector appears.'],
            ['CSM / Legacy needed', 'Some older ISOs need CSM on. UEFI-only ISOs need CSM off.'],
          ].map(([title, detail], i) => (
            <div key={i} style={{ padding:'10px 14px', background:'var(--bg2)', borderRadius:8, border:'1px solid var(--border)', marginBottom:6 }}>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:4 }}>{title}</div>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>{detail}</div>
            </div>
          ))}
        </div>
      </div>}
    </div>
  )
}
