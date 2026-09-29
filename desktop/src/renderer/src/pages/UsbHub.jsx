import { useState, useEffect, useCallback } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner, Tag, Progress } from './_shared.jsx'


//    Helpers                                                                   
const fmtSize = b => b > 1e9 ? (b/1e9).toFixed(1)+' GB' : b > 1e6 ? (b/1e6).toFixed(0)+' MB' : b > 1e3 ? (b/1e3).toFixed(0)+' KB' : b+' B'

const TAG_COLORS = { latest:'green', lts:'blue', recommended:'green', stable:'gray', beginner:'green', 'beginner-friendly':'green', gaming:'amber', security:'red', pentest:'red', privacy:'blue', server:'blue', recovery:'amber', lightweight:'gray', rolling:'amber', advanced:'red', tiny:'gray', live:'gray', ltsc:'blue', clean:'green' }
const tagColor = t => TAG_COLORS[t] || 'gray'

function DriveCard({ drive, onFormat, onWrite, onHealth }) {
  const usedGb = drive.sizeGb && drive.freeGb ? (parseFloat(drive.sizeGb) - parseFloat(drive.freeGb)).toFixed(1) : null
  const pct = drive.sizeGb && drive.freeGb ? Math.round((parseFloat(drive.sizeGb) - parseFloat(drive.freeGb)) / parseFloat(drive.sizeGb) * 100) : null
  return (
    <div className="card" style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:28 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:600, color:'var(--text)' }}>{drive.label || drive.name}</div>
          <div style={{ fontSize:12, color:'var(--text3)', marginTop:1 }}>{drive.device}   {drive.fs}   {drive.sizeGb} GB</div>
        </div>
        <div style={{ textAlign:'right', fontSize:11, color:'var(--text3)' }}>
          <div>{drive.freeGb} GB free</div>
          <div>{drive.mountPoint}</div>
        </div>
      </div>
      {pct !== null && (
        <div>
          <div style={{ background:'var(--bg3)', borderRadius:2, height:4, overflow:'hidden' }}>
            <div style={{ width:pct+'%', height:'100%', background: pct>85 ? 'var(--red)' : pct>60 ? 'var(--accent)' : 'var(--green)', borderRadius:2 }} />
          </div>
          <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>{usedGb}GB used of {drive.sizeGb}GB</div>
        </div>
      )}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <button className="btn btn-sm" onClick={() => onWrite(drive)}>  Write ISO</button>
        <button className="btn btn-sm" onClick={() => onFormat(drive)}>  Format</button>
        <button className="btn btn-sm" onClick={() => onHealth(drive)}>  Health</button>
      </div>
    </div>
  )
}

function ToolCard({ tool, onDownload, onLaunch, onWebsite, downloading }) {
  return (
    <div className="card" style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
        <span style={{ fontSize:28, flexShrink:0 }}>{tool.icon}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
            <span style={{ fontSize:15, fontWeight:600, color:'var(--text)' }}>{tool.name}</span>
            <Tag color="gray">v{tool.version}</Tag>
            {tool.installed && <Tag color="green">Installed</Tag>}
          </div>
          <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6, marginBottom:6 }}>{tool.description}</div>
          <div style={{ fontSize:11, color:'var(--text3)' }}>Best for: {tool.bestFor}</div>
        </div>
      </div>
      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
        {tool.features.slice(0,4).map((f,i) => <Tag key={i} color="gray">{f}</Tag>)}
      </div>
      <div style={{ display:'flex', gap:6 }}>
        {tool.installed
          ? <button className="btn btn-primary btn-sm" onClick={() => onLaunch(tool.id)}>  Launch</button>
          : tool.downloadUrl
            ? <button className="btn btn-primary btn-sm" onClick={() => onDownload(tool.id)} disabled={downloading === tool.id}>
                {downloading === tool.id ? <><Spinner size={12}/> Downloading...</> : '  Download'}
              </button>
            : <Tag color="gray">Built-in</Tag>
        }
        {tool.websiteUrl && <button className="btn btn-sm" onClick={() => onWebsite(tool.id)}>  Website</button>}
        {tool.command && <code style={{ fontSize:10, flex:1, padding:'4px 8px', background:'var(--bg)', borderRadius:4, color:'#a8ff78', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tool.command}</code>}
      </div>
    </div>
  )
}

function OsEntry({ entry, onDownload, onAddToLibrary, downloading }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'var(--bg2)', cursor:'pointer' }} onClick={() => setExpanded(e=>!e)}>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
            <span style={{ fontSize:14, fontWeight:600, color:'var(--text)' }}>{entry.name}</span>
            {entry.tags?.slice(0,3).map(t => <Tag key={t} color={tagColor(t)}>{t}</Tag>)}
          </div>
          <div style={{ fontSize:11, color:'var(--text3)' }}>{entry.arch?.join('   ')}   {entry.size}   {entry.type?.toUpperCase()}</div>
        </div>
        <div style={{ display:'flex', gap:5, flexShrink:0 }}>
          {entry.type === 'guide'
            ? <button className="btn btn-sm btn-blue" onClick={e => { e.stopPropagation(); ft.openUrl(entry.url) }}>  Guide  </button>
            : entry.directUrl
              ? <button className="btn btn-primary btn-sm" onClick={e => { e.stopPropagation(); onDownload(entry) }} disabled={downloading === entry.id}>
                  {downloading === entry.id ? <><Spinner size={12}/> Downloading...</> : '  Download'}
                </button>
              : null
          }
          {entry.url && entry.type !== 'guide' && <button className="btn btn-sm" onClick={e => { e.stopPropagation(); ft.openUrl(entry.url) }}>  Site  </button>}
          <span style={{ fontSize:16, color:'var(--text3)', padding:'4px' }}>{expanded ? ' ' : ' '}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding:'10px 14px', background:'var(--bg1)', borderTop:'1px solid var(--border)' }}>
          {entry.notes && <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>{entry.notes}</div>}
          {entry.directUrl && <div style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text3)', wordBreak:'break-all' }}>{entry.directUrl}</div>}
          {entry.sha256url && <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>SHA256 checksum available at: {entry.sha256url}</div>}
        </div>
      )}
    </div>
  )
}

//    Main Page                                                                  
export default function UsbHub({ addLog }) {
  const [tab, setTab] = useState('drives')
  const [drives, setDrives] = useState([])
  const [tools, setTools] = useState([])
  const [catalog, setCatalog] = useState({})
  const [isoLibrary, setIsoLibrary] = useState([])
  const [downloading, setDownloading] = useState(null)
  const [dlProgress, setDlProgress] = useState({ percent:0, message:'', speedMbps:'' })
  const [loading, setLoading] = useState(false)
  const [healthResult, setHealthResult] = useState(null)
  const [writeTarget, setWriteTarget] = useState(null)
  const [selectedIso, setSelectedIso] = useState(null)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [verifying, setVerifying] = useState(null)

  useEffect(() => {
    const rTool = ft.on('usb:tools:progress', p => setDlProgress({ percent:p.percent||0, message:p.message||'' }))
    const rIso  = ft.on('usb:iso:progress', p => setDlProgress({ percent:p.percent||0, speedMbps:p.speedMbps||'', eta:p.eta||0, message:`${fmtSize(p.downloaded||0)} / ${fmtSize(p.total||0)}` }))
    const rWrite = ft.on('usb:write:progress', p => setDlProgress(prev => ({ ...prev, message: (prev.message + '\n' + p.message).slice(-500) })))
    return () => { rTool(); rIso(); rWrite() }
  }, [])

  const refreshDrives = useCallback(async () => {
    setLoading(true)
    const list = await ft.usb.drives.list().catch(e => { addLog('USB scan: ' + e.message); return [] })
    setDrives(list)
    setLoading(false)
  }, [])

  const loadTools = useCallback(async () => {
    const list = await ft.usb.tools.list().catch(() => [])
    setTools(list)
  }, [])

  const loadCatalog = useCallback(async () => {
    const cat = await ft.usb.catalog.all().catch(() => ({}))
    setCatalog(cat)
  }, [])

  const loadIsos = useCallback(async () => {
    const list = await ft.usb.iso.list().catch(() => [])
    setIsoLibrary(list)
  }, [])

  useEffect(() => {
    refreshDrives()
    loadTools()
    loadCatalog()
    loadIsos()
  }, [])

  const downloadTool = async (toolId) => {
    setDownloading(toolId)
    try {
      const r = await ft.usb.tools.download({ toolId })
      if (r.success) { addLog(tools.find(t=>t.id===toolId)?.name + ' downloaded'); loadTools() }
      else addLog('Download failed: ' + r.error)
    } catch (e) { addLog('Download: ' + e.message) }
    setDownloading(null)
  }

  const downloadIso = async (entry) => {
    if (!entry.directUrl) return ft.openUrl(entry.url)
    setDownloading(entry.id)
    setDlProgress({ percent:0, message:'Starting...', speedMbps:'' })
    try {
      const r = await ft.usb.iso.download({ url: entry.directUrl, filename: entry.name.replace(/[^a-z0-9.]/gi,'_') + '.iso' })
      if (r.success) { addLog('Downloaded: ' + entry.name); loadIsos(); setTab('library') }
      else addLog('ISO download failed: ' + r.error)
    } catch (e) { addLog('ISO download: ' + e.message) }
    setDownloading(null)
  }

  const formatDrive = async (drive) => {
    const r = await ft.usb.drives.format({ device:drive.device, letter:drive.letter, label:drive.label, fs:'FAT32', newLabel:'USB' })
    if (r?.cancelled) return
    addLog(r.success ? 'Formatted: ' + drive.device : 'Format failed: ' + r.output)
    refreshDrives()
  }

  const checkHealth = async (drive) => {
    setHealthResult({ loading: true, drive })
    const r = await ft.usb.drives.health({ device: drive.device }).catch(e => ({ error: e.message }))
    setHealthResult({ ...r, drive })
  }

  const writeIsoToDrive = async (iso, drive) => {
    setDlProgress({ percent:0, message:'Preparing...' })
    setDownloading('write')
    const r = await ft.usb.write({ isoPath: iso.path, device: drive.device }).catch(e => ({ error: e.message }))
    if (!r?.cancelled) addLog(r.success ? 'Write complete: ' + iso.filename : 'Write failed: ' + (r.error || r.output?.slice(-200)))
    setDownloading(null)
    setWriteTarget(null)
  }

  const verifyIso = async (iso) => {
    setVerifying(iso.filename)
    const sha = await ft.usb.iso.verify({ isoPath: iso.path, sha256: null }).catch(() => null)
    setVerifying(null)
    if (sha) addLog(`SHA256: ${sha.actual}`)
  }

  const copyToVentoy = async (iso) => {
    if (!drives.length) { addLog('No USB drives detected'); return }
    const ventoyDrive = drives.find(d => d.mountPoint)
    if (!ventoyDrive) { addLog('No USB drive mounted'); return }
    setDownloading('ventoy_copy')
    const r = await ft.usb.ventoy.copyIso({ isoPath: iso.path, mountPoint: ventoyDrive.mountPoint }).catch(e => ({ error: e.message }))
    addLog(r.success ? 'Copied to Ventoy USB: ' + iso.filename : 'Copy failed: ' + r.error)
    setDownloading(null)
  }

  // Flat list of all OS entries
  const allEntries = Object.entries(catalog).flatMap(([catId, cat]) =>
    (cat.entries || []).map(e => ({ ...e, catId, catName: cat.name, catIcon: cat.icon }))
  )
  const filteredEntries = allEntries.filter(e => {
    if (categoryFilter !== 'all' && e.catId !== categoryFilter) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase()) && !e.tags?.some(t => t.includes(search.toLowerCase()))) return false
    return true
  })

  const TABS = [['drives','  USB Drives'],['tools','  Tools'],['catalog','  OS Catalog'],['library','  ISO Library']]

  return (
    <PageWrap>
      <PageHeader title="USB Device Hub" icon=" " sub="Bootable USB, OS downloads, Ventoy, Rufus, Etcher -- all in one place" />

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3, flexWrap:'wrap' }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:'7px 14px', borderRadius:6, fontSize:13, fontWeight:500, cursor:'pointer',
            background: tab===id ? 'var(--accent)' : 'none',
            color: tab===id ? '#000' : 'var(--text3)',
            border: tab===id ? '1px solid var(--accent)' : '1px solid transparent'
          }}>{label}</button>
        ))}
      </div>

      {/*    USB DRIVES                                                       */}
      {tab === 'drives' && (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-primary btn-sm" onClick={refreshDrives} disabled={loading}>
              {loading ? <Spinner size={14}/> : '  Refresh Drives'}
            </button>
            {writeTarget && selectedIso && (
              <button className="btn btn-red btn-sm" onClick={() => writeIsoToDrive(selectedIso, writeTarget)}>
                  Write {selectedIso.filename.slice(0,25)}... to {writeTarget.label}
              </button>
            )}
          </div>

          {!drives.length && !loading && (
            <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)', padding:20 }}>
              <div style={{ fontSize:14, fontWeight:600, color:'var(--blue)', marginBottom:6 }}>No USB drives detected</div>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
                  Plug in a USB drive<br/>
                  Windows: drive must appear in File Explorer<br/>
                  Linux/macOS: drive must be mounted or visible in lsblk<br/>
                  Click Refresh after plugging in
              </div>
            </div>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {drives.map((d, i) => (
              <DriveCard key={i} drive={d}
                onFormat={() => formatDrive(d)}
                onWrite={() => { setWriteTarget(d); setTab('library') }}
                onHealth={() => checkHealth(d)} />
            ))}
          </div>

          {healthResult && (
            <div className="card" style={{ background: healthResult.loading ? 'var(--bg2)' : healthResult.health === 'PASSED' ? 'var(--green-dim)' : 'var(--red-dim)', border:`1px solid ${healthResult.health === 'PASSED' ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{healthResult.drive?.label} -- Drive Health</div>
                <button className="btn btn-sm" onClick={() => setHealthResult(null)}> </button>
              </div>
              {healthResult.loading ? <Spinner /> :
                healthResult.available === false ? <div style={{ fontSize:12, color:'var(--text2)' }}>{healthResult.note}</div> : (
                  <div>
                    <div style={{ fontSize:16, fontWeight:700, color: healthResult.health === 'PASSED' ? 'var(--green)' : 'var(--red)', marginBottom:6 }}>{healthResult.health}</div>
                    {healthResult.reallocatedSectors != null && <div style={{ fontSize:12 }}>Reallocated Sectors: <strong>{healthResult.reallocatedSectors}</strong> {healthResult.reallocatedSectors > 0 ? '  Replace soon' : ' '}</div>}
                    {healthResult.powerOnHours && <div style={{ fontSize:12 }}>Power-on Hours: {healthResult.powerOnHours}</div>}
                  </div>
                )
              }
            </div>
          )}

          {downloading === 'write' && (
            <div className="card" style={{ padding:14 }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>Writing ISO to drive...</div>
              <div className="terminal" style={{ maxHeight:150, overflowY:'auto', fontSize:11 }}>{dlProgress.message}</div>
            </div>
          )}
        </div>
      )}

      {/*    TOOLS                                                            */}
      {tab === 'tools' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)' }}>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', marginBottom:4 }}>  Which tool should I use?</div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.8 }}>
              <strong>Ventoy</strong> -- multiple ISOs on one USB, just drag &amp; drop. Best choice.<br/>
              <strong>Rufus</strong> -- fastest, best for Windows USB, includes TPM bypass. Windows only.<br/>
              <strong>Etcher</strong> -- simplest UI, auto-validates. Best for Raspberry Pi images.<br/>
              <strong>dd</strong> -- built-in on Linux/macOS. Fastest raw write. No GUI.
            </div>
          </div>
          {!tools.length && <div className="empty"><Spinner /></div>}
          {tools.map((tool, i) => (
            <ToolCard key={i} tool={tool} downloading={downloading}
              onDownload={downloadTool}
              onLaunch={id => ft.usb.tools.launch({ toolId:id }).then(r => r.error ? addLog(r.error) : null)}
              onWebsite={id => ft.usb.tools.openWebsite({ toolId:id })} />
          ))}
          {downloading && downloading !== 'write' && (
            <div className="card">
              <div style={{ fontSize:13, marginBottom:6 }}>{dlProgress.message}</div>
              <div style={{ background:'var(--bg3)', borderRadius:2, height:4, overflow:'hidden' }}>
                <div style={{ width:dlProgress.percent+'%', height:'100%', background:'var(--accent)', transition:'width 0.2s' }} />
              </div>
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:3 }}>{dlProgress.percent}%</div>
            </div>
          )}
        </div>
      )}

      {/*    OS CATALOG                                                       */}
      {tab === 'catalog' && (
        <div style={{ display:'flex', gap:12, flex:1, overflow:'hidden' }}>
          {/* Category sidebar */}
          <div style={{ width:160, flexShrink:0, overflowY:'auto', display:'flex', flexDirection:'column', gap:3 }}>
            <button onClick={() => setCategoryFilter('all')} style={{
              padding:'7px 10px', borderRadius:6, textAlign:'left', cursor:'pointer', fontSize:12, fontWeight:500,
              background: categoryFilter==='all' ? 'var(--accent-dim)' : 'var(--bg2)',
              border:`1px solid ${categoryFilter==='all' ? 'var(--accent-border)' : 'var(--border)'}`,
              color: categoryFilter==='all' ? 'var(--accent)' : 'var(--text2)'
            }}>
                All ({allEntries.length})
            </button>
            {Object.entries(catalog).map(([catId, cat]) => (
              <button key={catId} onClick={() => setCategoryFilter(catId)} style={{
                padding:'7px 10px', borderRadius:6, textAlign:'left', cursor:'pointer', fontSize:12, fontWeight:500,
                background: categoryFilter===catId ? 'var(--accent-dim)' : 'var(--bg2)',
                border:`1px solid ${categoryFilter===catId ? 'var(--accent-border)' : 'var(--border)'}`,
                color: categoryFilter===catId ? 'var(--accent)' : 'var(--text2)'
              }}>
                {cat.icon} {cat.name}
                <div style={{ fontSize:10, color:'var(--text3)', fontWeight:400 }}>{cat.entries?.length} distros</div>
              </button>
            ))}
          </div>

          {/* OS list */}
          <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:6 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search OS, tags (gaming, server, privacy...)" />
            <div style={{ fontSize:11, color:'var(--text3)', marginBottom:2 }}>{filteredEntries.length} distros</div>
            {filteredEntries.map((entry, i) => (
              <OsEntry key={entry.id || i} entry={entry} downloading={downloading}
                onDownload={downloadIso}
                onAddToLibrary={() => {}} />
            ))}
            {!filteredEntries.length && <Empty icon=" " text="No results" />}
          </div>
        </div>
      )}

      {/*    ISO LIBRARY                                                      */}
      {tab === 'library' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={() => ft.usb.iso.add().then(r => { if(!r?.cancelled) { loadIsos(); addLog('Added to library') } })}>+ Add ISO File</button>
            <button className="btn btn-sm" onClick={() => { ft.usb.iso.openDir(); addLog('Opened ISO library folder') }}>  Open Folder</button>
            {writeTarget && <span className="tag tag-amber">Writing to: {writeTarget.label}</span>}
            <span style={{ fontSize:11, color:'var(--text3)', marginLeft:'auto' }}>{isoLibrary.length} ISOs   {isoLibrary.reduce((a,b) => a + b.size, 0) > 0 ? fmtSize(isoLibrary.reduce((a,b) => a+b.size, 0)) : ''}</span>
          </div>

          {downloading && downloading !== 'write' && (
            <div className="card" style={{ padding:14 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}><Spinner/> <span style={{ fontSize:13 }}>Downloading... {dlProgress.speedMbps ? dlProgress.speedMbps + ' MB/s' : ''}</span></div>
              <div style={{ background:'var(--bg3)', borderRadius:2, height:6, overflow:'hidden' }}>
                <div style={{ width:dlProgress.percent+'%', height:'100%', background:'var(--accent)', transition:'width 0.5s' }} />
              </div>
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>{dlProgress.percent}% -- {dlProgress.message}</div>
            </div>
          )}

          {!isoLibrary.length && (
            <Empty icon=" " text="No ISOs in library" sub="Download from the OS Catalog tab or add an existing ISO file" />
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {isoLibrary.map((iso, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderRadius:8, background:'var(--bg2)', border:`2px solid ${selectedIso?.path === iso.path ? 'var(--accent)' : 'var(--border)'}`, cursor:'pointer', transition:'border-color 0.1s' }}
                onClick={() => setSelectedIso(selectedIso?.path === iso.path ? null : iso)}>
                <span style={{ fontSize:20 }}> </span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:500, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{iso.filename}</div>
                  <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>{iso.sizeGb} GB   {new Date(iso.modified).toLocaleDateString()}</div>
                </div>
                {selectedIso?.path === iso.path && <Tag color="amber">Selected</Tag>}
                <div style={{ display:'flex', gap:5, flexShrink:0 }} onClick={e => e.stopPropagation()}>
                  {drives.length > 0 && (
                    <div style={{ position:'relative' }}>
                      <select onChange={e => { if(e.target.value) writeIsoToDrive(iso, drives.find(d=>d.device===e.target.value)) }}
                        style={{ fontSize:11, padding:'4px 6px' }} defaultValue="">
                        <option value="" disabled>Write to...</option>
                        {drives.map((d,i) => <option key={i} value={d.device}>{d.label} ({d.sizeGb}GB) {d.letter}</option>)}
                      </select>
                    </div>
                  )}
                  <button className="btn btn-sm" onClick={() => copyToVentoy(iso)} disabled={!!downloading} title="Copy to Ventoy USB"> </button>
                  <button className="btn btn-sm" onClick={() => verifyIso(iso)} disabled={verifying === iso.filename}>
                    {verifying === iso.filename ? <Spinner size={12}/> : '  SHA256'}
                  </button>
                  <button className="btn btn-red btn-sm" onClick={() => ft.usb.iso.delete({ isoPath:iso.path }).then(() => loadIsos())}> </button>
                </div>
              </div>
            ))}
          </div>

          {isoLibrary.length > 0 && (
            <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)' }}>
              <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', marginBottom:4 }}>  Ventoy Tip</div>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
                Install Ventoy on a USB drive once using the Tools tab, then use the <strong> </strong> button next to any ISO to copy it.
                No re-flashing -- just copy ISOs and boot. Supports hundreds of ISOs on one drive.
              </div>
            </div>
          )}
        </div>
      )}
    </PageWrap>
  )
}
