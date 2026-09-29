import { useState, useEffect, useRef } from 'react'
import { Empty } from './_shared.jsx'
const ft = window.ft

const COMMON_PARTITIONS = [
  { name:'boot',       risk:'medium', desc:'Kernel + ramdisk. Patch with Magisk here.',     icon:'KB' },
  { name:'recovery',   risk:'low',    desc:'Recovery partition. Flash TWRP here.',           icon:'RC' },
  { name:'system',     risk:'high',   desc:'Main Android OS. Wipes if wrong image.',         icon:'SY' },
  { name:'vendor',     risk:'high',   desc:'Hardware drivers and blobs.',                    icon:'VN' },
  { name:'dtbo',       risk:'medium', desc:'Device tree overlay.',                           icon:'DT' },
  { name:'vbmeta',     risk:'high',   desc:'Verified boot metadata. Disable with --disable-verity.', icon:'VM' },
  { name:'userdata',   risk:'high',   desc:'All user data. Wipes everything.',               icon:'UD' },
  { name:'cache',      risk:'low',    desc:'Cache partition. Safe to wipe.',                 icon:'CA' },
  { name:'super',      risk:'high',   desc:'Dynamic partition container (A/B devices).',    icon:'SP' },
  { name:'modem',      risk:'high',   desc:'Baseband/radio firmware.',                      icon:'MD' },
  { name:'persist',    risk:'high',   desc:'Persistent data (IMEI etc). Do not wipe.',      icon:'PS' },
  { name:'metadata',   risk:'medium', desc:'Encryption metadata.',                          icon:'MT' },
]
const RISK = { low:'#4ade80', medium:'#f59e0b', high:'#f87171' }

function PartBtn({ p, onRead, onFlash, selected, onSelect }) {
  return (
    <button onClick={() => onSelect(p.name)}
      style={{ padding:'9px 12px', borderRadius:8, cursor:'pointer', textAlign:'left', background:selected?`${RISK[p.risk]}22`:'var(--bg1)', border:`1px solid ${selected?RISK[p.risk]:'var(--border)'}`, transition:'all 0.15s', width:'100%' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ width:28, height:28, borderRadius:6, background:`${RISK[p.risk]}22`, color:RISK[p.risk], display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:800 }}>{p.icon}</div>
        <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
          <div style={{ fontSize:12, fontWeight:700, color:selected?RISK[p.risk]:'var(--text)' }}>{p.name}</div>
          <div style={{ fontSize:10, color:'var(--text3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.desc}</div>
        </div>
        <span style={{ fontSize:9, padding:'2px 5px', borderRadius:3, fontWeight:700, background:`${RISK[p.risk]}22`, color:RISK[p.risk] }}>{p.risk.toUpperCase()}</span>
      </div>
    </button>
  )
}

function Progress({ pct, msg }) {
  return (
    <div style={{ marginTop:6 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text3)', marginBottom:3 }}><span>{msg}</span><span>{pct}%</span></div>
      <div style={{ height:5, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}>
        <div style={{ height:'100%', width:Math.min(pct,100)+'%', background:pct>=100?'#4ade80':'var(--accent)', transition:'width 0.3s' }} />
      </div>
    </div>
  )
}

export default function NANDEditor({ device, addLog }) {
  const [tab, setTab] = useState('android')
  const [partitions, setPartitions] = useState([])
  const [selected, setSelected] = useState('boot')
  const [loading, setLoading] = useState(null)
  const [progress, setProgress] = useState({ pct:0, msg:'' })
  const [workFiles, setWorkFiles] = useState([])
  const [iosInfo, setIosInfo] = useState(null)
  const [localImg, setLocalImg] = useState(null)

  // Ramdisk file-tree editor state
  const [rdTree, setRdTree] = useState([])
  const [rdOpenFile, setRdOpenFile] = useState(null)
  const [rdContent, setRdContent] = useState('')
  const [rdDirty, setRdDirty] = useState(false)
  const [rdBinary, setRdBinary] = useState(false)
  const [rdNewPath, setRdNewPath] = useState('')

  // iOS SSH ramdisk builder state
  const [iosTools, setIosTools] = useState([])
  const [iosBuildDir, setIosBuildDir] = useState(null)
  const [toolHelpOutput, setToolHelpOutput] = useState(null)

  // Baseband state
  const [bbInfo, setBbInfo] = useState(null)
  const [bbResults, setBbResults] = useState(null)

  // iOS libimobiledevice + ipsw toolkit state
  const [ilTools, setIlTools] = useState([])
  const [ilOutput, setIlOutput] = useState(null)
  const [ipswPath, setIpswPath] = useState(null)
  const [ipswOutput, setIpswOutput] = useState(null)

  const serial = device?.serial
  const udid = device?.udid || device?.serial
  const isIos = device?.deviceType === 'ios'

  useEffect(() => {
    const u = ft.on('nand:progress', p => setProgress({ pct:p.pct||0, msg:p.msg||'' }))
    if (isIos) ft.nand.ios.ramdiskInfo().then(setIosInfo).catch(()=>{})
    return () => u()
  }, [isIos])

  const refreshRdTree = async () => {
    const r = await ft.nand.android.ramdiskTree().catch(e => ({ error: e.message, tree: [] }))
    setRdTree(r.tree || [])
    if (r.error) addLog(r.error)
  }

  const unpackRdCpio = async () => {
    setLoading('cpioExtract')
    setProgress({ pct:0, msg:'Unpacking cpio...' })
    const r = await ft.nand.android.ramdiskCpioExtract().catch(e=>({error:e.message}))
    if (r.success) { addLog('Ramdisk unpacked - browse and edit files below'); await refreshRdTree() }
    else addLog('Unpack error: ' + r.error)
    setLoading(null)
  }

  const openRdFile = async (p) => {
    setRdOpenFile(p)
    setRdDirty(false)
    setRdBinary(false)
    setRdContent('')
    const r = await ft.nand.android.ramdiskReadFile({ path: p }).catch(e=>({success:false,error:e.message}))
    if (!r.success) return addLog('Read error: ' + r.error)
    if (r.binary) { setRdBinary(true); return }
    setRdContent(r.content)
  }

  const saveRdFile = async () => {
    if (!rdOpenFile) return
    const r = await ft.nand.android.ramdiskWriteFile({ path: rdOpenFile, content: rdContent }).catch(e=>({success:false,error:e.message}))
    if (r.success) { setRdDirty(false); addLog('Saved: ' + rdOpenFile) }
    else addLog('Save error: ' + r.error)
  }

  const createRdFile = async () => {
    if (!rdNewPath.trim()) return
    const r = await ft.nand.android.ramdiskNewFile({ path: rdNewPath.trim() }).catch(e=>({success:false,error:e.message}))
    if (r.success) { addLog('Created: ' + rdNewPath); setRdNewPath(''); await refreshRdTree(); openRdFile(rdNewPath.trim()) }
    else addLog('Create error: ' + r.error)
  }

  const deleteRdFile = async (p) => {
    if (!window.confirm(`Delete ${p}?`)) return
    const r = await ft.nand.android.ramdiskDeleteFile({ path: p }).catch(e=>({success:false,error:e.message}))
    if (r.success) { addLog('Deleted: ' + p); if (rdOpenFile===p) setRdOpenFile(null); await refreshRdTree() }
    else addLog('Delete error: ' + r.error)
  }

  const repackRdCpio = async () => {
    setLoading('cpioRepack')
    setProgress({ pct:0, msg:'Repacking cpio...' })
    const r = await ft.nand.android.ramdiskCpioRepack().catch(e=>({error:e.message}))
    addLog(r.success ? 'ramdisk.cpio rebuilt from your edits - click "Repack to new-boot.img" above to finish' : 'Repack error: '+r.error)
    setLoading(null)
  }

  const loadIosTools = async () => {
    setLoading('iosToolCheck')
    const r = await ft.nand.ios.checkRamdiskTools().catch(e=>({tools:[],error:e.message}))
    setIosTools(r.tools || [])
    setLoading(null)
  }

  const stageIosBuild = async () => {
    const r = await ft.nand.ios.stageRamdiskBuild().catch(e=>({success:false,error:e.message}))
    if (r.success) { setIosBuildDir(r.path); addLog('Build folder ready: ' + r.path) }
    else addLog('Stage error: ' + r.error)
  }

  const importIosSource = async () => {
    const r = await ft.nand.ios.importRamdiskSource().catch(e=>({success:false,error:e.message}))
    if (r.cancelled) return
    if (r.success) { setIosBuildDir(r.workDir); addLog('Staged: ' + r.path) }
    else addLog('Import error: ' + r.error)
  }

  const showToolHelp = async (bin) => {
    setToolHelpOutput({ bin, output: 'Loading...' })
    const r = await ft.nand.ios.toolHelp({ bin }).catch(e=>({success:false,error:e.message}))
    setToolHelpOutput({ bin, output: r.success ? r.output : ('Error: ' + r.error) })
  }

  // Baseband handlers
  const loadBbInfo = async () => {
    if (!serial) return addLog('Connect Android device first')
    setLoading('bbInfo')
    const r = await ft.nand.android.basebandInfo({ serial }).catch(e=>({success:false,error:e.message}))
    if (r.success) setBbInfo(r); else addLog('Baseband info error: ' + r.error)
    setLoading(null)
  }

  const extractBaseband = async () => {
    if (!serial) return
    setLoading('bbExtract')
    setBbResults(null)
    setProgress({ pct:0, msg:'Extracting baseband partitions...' })
    const r = await ft.nand.android.basebandExtract({ serial }).catch(e=>({success:false,error:e.message}))
    if (r.success) { setBbResults(r.results); addLog('Baseband extracted to: ' + r.dest) }
    else addLog('Baseband extract error: ' + r.error)
    setLoading(null)
  }

  const flashBaseband = async () => {
    if (!serial) return
    if (!window.confirm('Flashing the wrong baseband image can permanently break cellular/IMEI on this device. Continue?')) return
    setLoading('bbFlash')
    setProgress({ pct:0, msg:'Preparing...' })
    const r = await ft.nand.android.basebandFlash({ serial }).catch(e=>({success:false,error:e.message}))
    if (r.cancelled) { setLoading(null); return }
    addLog(r.success ? 'Baseband flashed from ' + r.path : 'Baseband flash error: ' + r.error)
    setLoading(null)
  }

  const nvBackup = async () => {
    if (!serial) return
    setLoading('nvBackup')
    setBbResults(null)
    setProgress({ pct:0, msg:'Backing up NV/EFS data...' })
    const r = await ft.nand.android.nvBackup({ serial }).catch(e=>({success:false,error:e.message}))
    if (r.success) { setBbResults(r.results); addLog('NV/EFS backup saved to: ' + r.dest) }
    else addLog('NV backup error: ' + r.error)
    setLoading(null)
  }

  // libimobiledevice handlers
  const loadIlTools = async () => {
    setLoading('ilToolsLoad')
    const r = await ft.nand.ios.listLibimobiledeviceTools().catch(e=>({tools:[],error:e.message}))
    setIlTools(r.tools || [])
    setLoading(null)
  }

  const runIlTool = async (t) => {
    if (!udid) return addLog('Connect an iOS device first')
    if (t.confirm && !window.confirm(t.confirm)) return
    setIlOutput({ id: t.id, label: t.label, output: 'Running...' })
    const r = await ft.nand.ios.runLibimobiledevice({ id: t.id, udid }).catch(e=>({success:false,error:e.message}))
    if (r.cancelled) { setIlOutput(null); return }
    if (r.terminal) {
      const term = await ft.terminal.create({ cwd: r.cwd }).catch(()=>null)
      if (term?.id) ft.terminal.write({ id: term.id, data: r.command + '\n' })
      addLog('Opened live terminal: ' + r.command)
      setIlOutput(null)
      return
    }
    if (r.success && r.path) { addLog(t.label + ' saved: ' + r.path); setIlOutput(null); return }
    setIlOutput({ id: t.id, label: t.label, output: r.success ? (r.output || '(no output)') : ('Error: ' + r.error) })
  }

  // IPSW toolkit handlers
  const pickIpsw = async () => {
    const r = await ft.nand.ios.ipswPick().catch(e=>({success:false,error:e.message}))
    if (r.cancelled) return
    if (r.success) { setIpswPath(r.path); addLog('IPSW selected: ' + r.path) }
    else addLog('Pick error: ' + r.error)
  }

  const runIpsw = async (label, args) => {
    setIpswOutput({ label, output: 'Running - this can take a while for large IPSWs...' })
    const r = await ft.nand.ios.ipswRun({ args }).catch(e=>({success:false,error:e.message}))
    setIpswOutput({ label, output: r.success ? (r.output || '(no output)') : ('Error: ' + r.error) })
  }

  const ipswInfo = () => ipswPath && runIpsw('ipsw info', ['info', ipswPath])
  const ipswExtractKernel = async () => {
    if (!ipswPath) return
    const d = await ft.nand.ios.ipswExtractDest().catch(()=>({cancelled:true}))
    if (d.cancelled) return
    runIpsw('extract kernelcache', ['extract', '--kernel', '--output', d.path, ipswPath])
  }
  const ipswExtractDyld = async () => {
    if (!ipswPath) return
    const d = await ft.nand.ios.ipswExtractDest().catch(()=>({cancelled:true}))
    if (d.cancelled) return
    runIpsw('extract dyld_shared_cache', ['extract', '--dyld', '--output', d.path, ipswPath])
  }

  const listPartitions = async () => {
    if (!serial) return addLog('Connect Android device first')
    setLoading('list')
    const r = await ft.nand.android.listPartitions({ serial }).catch(e=>({error:e.message,partitions:[]}))
    if (r.partitions?.length) setPartitions(r.partitions)
    else addLog('Could not list partitions. Device may need root or USB debugging.')
    setLoading(null)
  }

  const readPartition = async () => {
    if (!serial||!selected) return
    setLoading('read')
    setProgress({ pct:0, msg:'Reading '+selected+'...' })
    const r = await ft.nand.android.readPartition({ serial, partition:selected }).catch(e=>({error:e.message}))
    addLog(r.success ? `Read ${selected}: ${(r.size/1e6).toFixed(1)}MB → ${r.path}` : 'Error: '+(r.error||'failed'))
    setLoading(null)
  }

  const flashPartition = async () => {
    if (!serial||!selected) return
    if (!window.confirm(`Flash to ${selected}? This can brick your device if the wrong image is used.`)) return
    setLoading('flash')
    setProgress({ pct:0, msg:'Preparing...' })
    const r = await ft.nand.android.flashPartition({ serial, partition:selected }).catch(e=>({error:e.message}))
    if (r.cancelled) { setLoading(null); return }
    addLog(r.success ? `Flashed ${selected} from ${r.path}` : 'Flash error: '+(r.error||'failed'))
    setLoading(null)
  }

  const extractRadisk = async () => {
    setLoading('extract')
    setProgress({ pct:0, msg:'Pulling boot partition...' })
    const r = await ft.nand.android.ramdiskExtract({ serial, localPath:localImg||null }).catch(e=>({error:e.message}))
    addLog(r.success ? 'Extracted to: '+r.workDir : 'Error: '+r.error)
    if (r.files) setWorkFiles(r.files)
    setLoading(null)
  }

  const repackRamdisk = async () => {
    setLoading('repack')
    setProgress({ pct:0, msg:'Repacking...' })
    const r = await ft.nand.android.ramdiskRepack({}).catch(e=>({error:e.message}))
    addLog(r.success ? 'Repacked: '+r.path : 'Repack error: '+r.error)
    setLoading(null)
  }

  const btn = (label, fn, color, disabled) => (
    <button onClick={fn} disabled={disabled||!!loading}
      style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:disabled||loading?'not-allowed':'pointer',
        background:color==='accent'?'var(--accent)':color==='red'?'rgba(248,113,113,0.15)':color==='green'?'rgba(74,222,128,0.15)':'var(--bg3)',
        color:color==='accent'?'#000':color==='red'?'#f87171':color==='green'?'#4ade80':'var(--text)',
        border:color==='accent'?'none':color==='red'?'1px solid rgba(248,113,113,0.3)':color==='green'?'1px solid rgba(74,222,128,0.3)':'1px solid var(--border)',
        opacity:disabled||loading?0.5:1 }}>
      {label}
    </button>
  )

  const allParts = [...COMMON_PARTITIONS, ...partitions.filter(p => !COMMON_PARTITIONS.find(c=>c.name===p.name)).map(p=>({...p,risk:'medium',desc:p.device||'',icon:p.name.slice(0,2).toUpperCase()}))]
  const selPart = allParts.find(p=>p.name===selected)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}>💾</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>NAND Editor & Ramdisk</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Read, flash and edit Android partitions and iOS ramdisk</div>
        </div>
      </div>

      <div style={{ padding:10, background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, fontSize:12, color:'#f87171', lineHeight:1.7 }}>
        Warning: Flashing wrong images will brick your device. Always have a backup. Read operations are safe on rooted devices.
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3, flexWrap:'wrap' }}>
        {[['android','Android NAND'],['ramdisk','Boot Ramdisk'],['baseband','Baseband'],['ios','iOS Ramdisk'],['iostools','iOS Toolkit']].map(([id,l]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:'1 1 auto', minWidth:100, padding:'7px 8px', borderRadius:7, fontSize:11.5, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>
        ))}
      </div>

      {tab === 'android' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {!serial && <div style={{ padding:12, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>Connect a rooted Android device.</div>}

          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {btn('List Device Partitions', listPartitions, 'green', !serial)}
            {btn('Open Partitions Folder', () => ft.nand.android.openPartitions().then(r=>addLog(r.path)), 'default')}
          </div>

          <div style={{ background:'var(--bg1)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:10, padding:14, borderLeft:'3px solid #4ade80' }}>
            <div style={{ fontSize:13, fontWeight:700, color:'#4ade80', marginBottom:4 }}>One-Click Full Backup</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:10, lineHeight:1.6 }}>
              Reads boot, recovery, dtbo, vbmeta, persist, and modem in one pass — the partitions worth having a copy of before flashing anything. Requires root.
            </div>
            {btn('Backup All Critical Partitions', async () => {
              setLoading('backupAll')
              setProgress({ pct:0, msg:'Starting...' })
              const r = await ft.nand.android.backupAll({ serial }).catch(e => ({ success:false, error:e.message }))
              if (r.success) {
                const ok = r.results.filter(x=>x.success).length
                addLog(`Full backup: ${ok}/${r.results.length} partitions saved to ${r.dest}`)
              } else addLog('Full backup error: ' + r.error)
              setLoading(null)
            }, 'green', !serial)}
            {loading === 'backupAll' && <Progress pct={progress.pct} msg={progress.msg} />}
          </div>

          <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', letterSpacing:'0.05em' }}>SELECT PARTITION</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
            {allParts.map((p,i) => <PartBtn key={i} p={p} selected={selected===p.name} onSelect={setSelected} />)}
          </div>

          {selPart && (
            <div style={{ background:'var(--bg1)', border:`1px solid ${RISK[selPart.risk]}44`, borderRadius:10, padding:14, borderLeft:`3px solid ${RISK[selPart.risk]}` }}>
              <div style={{ fontSize:13, fontWeight:700, color:RISK[selPart.risk], marginBottom:4 }}>{selPart.name}</div>
              <div style={{ fontSize:12, color:'var(--text2)', marginBottom:10 }}>{selPart.desc}</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {btn('Read Partition (Pull to PC)', readPartition, 'green', !serial)}
                {btn('Flash Image to Partition', flashPartition, 'red', !serial)}
              </div>
              {(loading==='read'||loading==='flash') && <Progress pct={progress.pct} msg={progress.msg} />}
            </div>
          )}
        </div>
      )}

      {tab === 'ramdisk' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:8 }}>Boot Image Ramdisk Tool</div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:10 }}>
              Extract the ramdisk from boot.img, edit files (init scripts, fstab, SELinux policies), then repack and flash back. Uses magiskboot.
            </div>
            <div style={{ fontSize:11, color:'var(--text3)', marginBottom:10 }}>
              Source: pull boot partition from device (requires root) or pick a local boot.img file.
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
              {btn('Extract from Device (root)', extractRadisk, 'green', !serial)}
              {btn('Open Work Folder', () => ft.nand.android.openWorkdir().then(r=>{setWorkFiles(r.files);addLog('Workdir: '+r.path)}), 'default')}
            </div>
            {(loading==='extract'||loading==='repack') && <Progress pct={progress.pct} msg={progress.msg} />}
          </div>

          {workFiles.length > 0 && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>EXTRACTED FILES</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:10 }}>
                {workFiles.map((f,i) => (
                  <span key={i} style={{ fontSize:11, padding:'3px 8px', borderRadius:4, background:'var(--bg2)', color:'var(--text2)', border:'1px solid var(--border)', fontFamily:'monospace' }}>{f}</span>
                ))}
              </div>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:10, lineHeight:1.7 }}>
                Key files: <code style={{ color:'var(--accent)' }}>ramdisk.cpio</code>, <code style={{ color:'var(--accent)' }}>kernel</code>, <code style={{ color:'var(--accent)' }}>init</code>. Unpack ramdisk.cpio below to edit its contents directly instead of using an external terminal.
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {btn('Unpack ramdisk.cpio for editing', unpackRdCpio, 'green')}
                {btn('Repack to new-boot.img', repackRamdisk, 'accent')}
              </div>
              {loading==='cpioExtract' && <Progress pct={progress.pct} msg={progress.msg} />}
            </div>
          )}

          {rdTree.length > 0 && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)' }}>RAMDISK FILE EDITOR</div>
                {btn('Open Folder', () => ft.nand.android.ramdiskOpenExtracted(), 'default')}
              </div>

              <div style={{ display:'flex', gap:6, marginBottom:10 }}>
                <input value={rdNewPath} onChange={e=>setRdNewPath(e.target.value)} placeholder="new file path, e.g. etc/new.rc"
                  style={{ flex:1, padding:'6px 10px', borderRadius:6, background:'var(--bg2)', border:'1px solid var(--border)', color:'var(--text)', fontSize:12, fontFamily:'monospace' }} />
                {btn('+ Create', createRdFile, 'default', !rdNewPath.trim())}
              </div>

              <div style={{ display:'flex', gap:10, height:340 }}>
                <div style={{ width:220, flexShrink:0, overflowY:'auto', border:'1px solid var(--border)', borderRadius:8, padding:6 }}>
                  {rdTree.filter(n=>n.type!=='dir').map((n,i) => (
                    <div key={i} onClick={() => openRdFile(n.path)}
                      style={{ display:'flex', justifyContent:'space-between', gap:6, padding:'5px 7px', borderRadius:5, cursor:'pointer', fontSize:11, fontFamily:'monospace',
                        background: rdOpenFile===n.path ? 'var(--accent)' : 'transparent', color: rdOpenFile===n.path ? '#000' : 'var(--text2)' }}>
                      <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.path}</span>
                      <span onClick={(e)=>{e.stopPropagation(); deleteRdFile(n.path)}} style={{ opacity:0.6, flexShrink:0 }}>✕</span>
                    </div>
                  ))}
                </div>
                <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
                  {!rdOpenFile && <Empty icon="📄" text="Select a file to edit" sub="init.rc, fstab.*, default.prop, file_contexts, etc." />}
                  {rdOpenFile && rdBinary && <Empty icon="⚠" text={rdOpenFile} sub="Binary file - open the extracted folder to edit with an external tool" />}
                  {rdOpenFile && !rdBinary && (
                    <>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                        <span style={{ fontSize:11, fontFamily:'monospace', color:'var(--text3)' }}>{rdOpenFile}{rdDirty ? ' *' : ''}</span>
                        {btn('Save', saveRdFile, 'accent', !rdDirty)}
                      </div>
                      <textarea value={rdContent} onChange={e=>{setRdContent(e.target.value); setRdDirty(true)}}
                        spellCheck={false}
                        style={{ flex:1, width:'100%', resize:'none', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:6, color:'var(--text)', fontSize:12, fontFamily:'var(--mono, monospace)', padding:10, boxSizing:'border-box' }} />
                    </>
                  )}
                </div>
              </div>

              <div style={{ marginTop:10, display:'flex', gap:8 }}>
                {btn('Repack Edited Files → ramdisk.cpio', repackRdCpio, 'green')}
              </div>
              {loading==='cpioRepack' && <Progress pct={progress.pct} msg={progress.msg} />}
              <div style={{ marginTop:6, fontSize:11, color:'var(--text3)', lineHeight:1.6 }}>
                After repacking ramdisk.cpio, use "Repack to new-boot.img" above to fold it back into the boot image, then flash via the Android NAND tab.
              </div>
            </div>
          )}

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>COMMON RAMDISK EDITS</div>
            {[
              { file:'fstab.*', edit:'Add ro,remount_flags or disable encryption' },
              { file:'default.prop / build.prop', edit:'Change ro.debuggable=1, ro.secure=0 for root adb shell' },
              { file:'init.rc', edit:'Start/stop services, add commands on boot' },
              { file:'file_contexts (SELinux)', edit:'Add permissions for new files/processes' },
              { file:'ramdisk.cpio', edit:'Full ramdisk archive - extract with: cpio -idm < ramdisk.cpio' },
            ].map((r,i) => (
              <div key={i} style={{ display:'flex', gap:10, padding:'6px 0', borderBottom:'1px solid var(--border)', fontSize:11 }}>
                <span style={{ color:'var(--accent)', fontFamily:'monospace', minWidth:160, flexShrink:0 }}>{r.file}</span>
                <span style={{ color:'var(--text2)' }}>{r.edit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'ios' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:8 }}>iOS Ramdisk Mode</div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:12 }}>
              iOS ramdisk mode boots a minimal OS environment that bypasses the normal iOS passcode. Used for forensic data extraction and device recovery. Requires jailbreak-compatible hardware.
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
              {btn('Enter Recovery Mode', () => ft.nand.ios.enterRecovery({udid}).then(r=>addLog(r.success?'Entered recovery':'Error: '+r.error)).catch(e=>addLog(e.message)), 'green', !udid)}
              {btn('Exit Recovery', () => ft.nand.ios.exitRecovery({udid}).then(r=>addLog(r.success?'Exiting recovery...':'Error: '+r.error)).catch(e=>addLog(e.message)), 'default', !udid)}
              {btn('Full Backup First', () => ft.nand.ios.backupFull({udid}).then(r=>r.cancelled?null:addLog(r.success?'Backup done: '+r.dest:'Backup failed: '+r.error)).catch(e=>addLog(e.message)), 'accent', !udid)}
            </div>
          </div>

          {iosInfo && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {iosInfo.tools?.map((t,i) => (
                <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:9, padding:'12px 14px', display:'flex', gap:10, alignItems:'flex-start' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:3 }}>{t.name}</div>
                    <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.6 }}>{t.desc}</div>
                  </div>
                  {t.url && <button onClick={() => ft.openUrl(t.url)} style={{ padding:'5px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', flexShrink:0 }}>Open</button>}
                  {t.installed && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'rgba(74,222,128,0.15)', color:'#4ade80', fontWeight:700, flexShrink:0 }}>INSTALLED</span>}
                </div>
              ))}
            </div>
          )}

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:10 }}>SSH Ramdisk Workflow (iPhone 6 compatible)</div>
            {[
              'Jailbreak with checkra1n or palera1n (Jailbreak Wizard page)',
              'In checkra1n: enable "Allow Untrusted Hosts" and "Install OpenSSH"',
              'Or in palera1n: use --ramdisk flag to boot SSH ramdisk without full jailbreak',
              'SSH into device: ssh root@<ip> (password: alpine)',
              'Access /private/var/mobile/Media for photos/docs',
              'Access /private/var/mobile/Library for app data, notes, messages',
              'For locked device: ssh ramdisk bypasses passcode entirely on A8-A11',
              'Copy files: scp -r root@<ip>:/private/var/mobile/Media ./iphone_data/',
            ].map((s,i) => (
              <div key={i} style={{ display:'flex', gap:8, marginBottom:8 }}>
                <div style={{ width:22, height:22, borderRadius:'50%', background:'var(--accent)', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, paddingTop:2 }}>{s}</div>
              </div>
            ))}
          </div>

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>Custom SSH Ramdisk Builder</div>
              {btn('Detect Tools', loadIosTools, 'default')}
            </div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:10 }}>
              Building a custom SSH ramdisk (decrypt → patch → repack → boot via DFU) needs external
              signing/exploit tools that OMERTA doesn't bundle or reimplement — each one's exact
              command syntax varies by device/iOS version and changes between tool releases, so this
              panel detects what's on your PATH and stages a working folder rather than guessing flags.
              Use "Show --help" to pull the real usage straight from the installed binary.
            </div>

            {iosTools.length === 0 && (
              <div style={{ fontSize:11, color:'var(--text3)' }}>Click "Detect Tools" to scan PATH for the tools below.</div>
            )}

            {iosTools.length > 0 && (
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:10 }}>
                {iosTools.map((t,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', borderRadius:7, background:'var(--bg2)', border:'1px solid var(--border)' }}>
                    <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, fontWeight:700, flexShrink:0,
                      background: t.installed ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                      color: t.installed ? '#4ade80' : '#f87171' }}>{t.installed ? 'FOUND' : 'MISSING'}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'var(--text)', fontFamily:'monospace' }}>{t.bin}</div>
                      <div style={{ fontSize:11, color:'var(--text3)' }}>{t.desc}</div>
                    </div>
                    {t.installed
                      ? <button onClick={()=>showToolHelp(t.bin)} style={{ padding:'5px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)', flexShrink:0 }}>Show --help</button>
                      : <button onClick={()=>ft.openUrl(t.repo)} style={{ padding:'5px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', flexShrink:0 }}>Get it</button>}
                  </div>
                ))}
              </div>
            )}

            {toolHelpOutput && (
              <div style={{ background:'#000', border:'1px solid var(--border)', borderRadius:8, padding:10, marginBottom:10 }}>
                <div style={{ fontSize:10, color:'var(--text3)', marginBottom:4 }}>{toolHelpOutput.bin} --help</div>
                <pre style={{ margin:0, fontSize:10.5, color:'#4ade80', whiteSpace:'pre-wrap', maxHeight:180, overflowY:'auto', fontFamily:'monospace' }}>{toolHelpOutput.output}</pre>
              </div>
            )}

            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:6 }}>
              {btn('Stage Empty Build Folder', stageIosBuild, 'default')}
              {btn('Import IPSW / Ramdisk File...', importIosSource, 'green')}
              {btn('Open Build Folder in Terminal', () => ft.terminal.create({ cwd: iosBuildDir }).then(()=>addLog('Opened terminal in build folder - run the tool commands shown above')), 'accent', !iosBuildDir)}
            </div>
            {iosBuildDir && <div style={{ fontSize:11, color:'var(--text3)', fontFamily:'monospace' }}>{iosBuildDir}</div>}

            <div style={{ marginTop:10, fontSize:11, color:'var(--text3)', lineHeight:1.7 }}>
              Typical order once tools are installed: decrypt the stock ramdisk .dmg/.im4p with{' '}
              <code style={{ color:'var(--accent)' }}>img4tool</code> using keys from The iPhone Wiki →
              patch it with <code style={{ color:'var(--accent)' }}>iBoot64Patcher</code> to disable
              signature checks and drop in an SSHD/dropbear payload → repack as IMG4 →
              pwn the device into DFU with <code style={{ color:'var(--accent)' }}>gaster pwn</code>{' '}
              (checkm8-vulnerable A9-A11 only) → send components with{' '}
              <code style={{ color:'var(--accent)' }}>irecovery -f</code> and boot. Verify every flag
              against each tool's own --help above before running anything against real hardware.
            </div>
          </div>

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>RECOMMENDED EXTRA iOS TOOLS</div>
            {[
              { name:'gaster', desc:'checkm8 CLI (pwn DFU, decrypt with GID key) for A9-A11 devices - pairs with the ramdisk builder above.' },
              { name:'img4tool / iBoot64Patcher', desc:'tihmstar\'s IMG4 decrypt/repack + iBoot signature-check patcher - the two you\'ll use most for custom boot chains.' },
              { name:'ipsw (blacktop)', desc:'Inspect and extract IPSWs, kernelcaches, and dyld_shared_cache - much faster than doing it by hand.' },
              { name:'apticket / tsschecker', desc:'Fetch or save signing tickets so a custom restore/ramdisk will actually boot on a given ECID.' },
              { name:'plist / bplist tools (libplist)', desc:'You already ship idevice* binaries via libimobiledevice - libplist\'s plistutil is worth bundling alongside for quick plist<->XML conversion in ForensicsExport.' },
              { name:'AFC / iTunes-free file access (ifuse, afcclient)', desc:'For non-jailbroken devices, afcclient/ifuse still exposes the public Media partition - useful fallback in FileManager when SSH ramdisk isn\'t an option.' },
            ].map((r,i) => (
              <div key={i} style={{ padding:'8px 0', borderBottom: i<5 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontSize:12, fontWeight:600, color:'var(--accent)', fontFamily:'monospace', marginBottom:2 }}>{r.name}</div>
                <div style={{ fontSize:11, color:'var(--text2)', lineHeight:1.6 }}>{r.desc}</div>
              </div>
            ))}
          </div>

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>iOS NAND STRUCTURE</div>
            {[
              { part:'NAND', desc:'Raw flash storage — read via specialized hardware (JTAG/ISP) for dead devices' },
              { part:'/private/var', desc:'User data partition — photos, contacts, messages, app data' },
              { part:'/private/var/mobile/Media', desc:'Photos, videos, downloads (accessible via SSH)' },
              { part:'/private/var/Keychains', desc:'Passwords and encryption keys (requires jailbreak)' },
              { part:'/System/Library', desc:'iOS OS files — do not modify' },
              { part:'Secure Enclave', desc:'Hardware chip that stores biometrics and encryption keys — cannot be read' },
            ].map((r,i) => (
              <div key={i} style={{ display:'flex', gap:10, padding:'6px 0', borderBottom:'1px solid var(--border)', fontSize:11 }}>
                <span style={{ color:'var(--accent)', fontFamily:'monospace', minWidth:140, flexShrink:0 }}>{r.part}</span>
                <span style={{ color:'var(--text2)' }}>{r.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'baseband' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {!serial && <div style={{ padding:12, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>Connect a rooted Android device.</div>}

          <div style={{ padding:10, background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, fontSize:12, color:'#f87171', lineHeight:1.7 }}>
            The modem/NV partitions store your device's IMEI calibration data. Always run "Backup NV/EFS" before touching baseband, flash the wrong image here, and cellular can be permanently disabled.
          </div>

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>Baseband Info</div>
              {btn('Read Info', loadBbInfo, 'default', !serial)}
            </div>
            {bbInfo && (
              <div style={{ display:'flex', flexDirection:'column', gap:4, fontSize:12 }}>
                <div><span style={{ color:'var(--text3)' }}>Baseband version: </span><span style={{ color:'var(--text)', fontFamily:'monospace' }}>{bbInfo.baseband || 'unknown'}</span></div>
                <div><span style={{ color:'var(--text3)' }}>RIL impl: </span><span style={{ color:'var(--text)', fontFamily:'monospace' }}>{bbInfo.ril || 'unknown'}</span></div>
                <div><span style={{ color:'var(--text3)' }}>Multi-SIM config: </span><span style={{ color:'var(--text)', fontFamily:'monospace' }}>{bbInfo.multisim || 'unknown'}</span></div>
                <div><span style={{ color:'var(--text3)' }}>Hardware: </span><span style={{ color:'var(--text)', fontFamily:'monospace' }}>{bbInfo.hardware || 'unknown'}</span></div>
                {bbInfo.blocks && <div style={{ marginTop:4 }}><span style={{ color:'var(--text3)' }}>Relevant blocks:</span><pre style={{ margin:'4px 0 0', fontSize:10.5, color:'#4ade80', whiteSpace:'pre-wrap' }}>{bbInfo.blocks}</pre></div>}
              </div>
            )}
          </div>

          <div style={{ background:'var(--bg1)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:10, padding:14, borderLeft:'3px solid #4ade80' }}>
            <div style={{ fontSize:13, fontWeight:700, color:'#4ade80', marginBottom:4 }}>Backup NV/EFS (IMEI-safe)</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:10, lineHeight:1.6 }}>
              Archives /efs, /mnt/vendor/persist and /persist (whichever exist on this device) before you touch anything baseband-related. Do this first, every time.
            </div>
            {btn('Backup NV/EFS Now', nvBackup, 'green', !serial)}
            {loading === 'nvBackup' && <Progress pct={progress.pct} msg={progress.msg} />}
          </div>

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:8 }}>Extract / Flash Baseband</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:10, lineHeight:1.6 }}>
              Reads modem, modemst1, modemst2, fsg and fsc (skipping any not present on this device) to your PC, or pushes a replacement modem image back.
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {btn('Extract Baseband Partitions', extractBaseband, 'green', !serial)}
              {btn('Flash Modem Image', flashBaseband, 'red', !serial)}
            </div>
            {(loading==='bbExtract'||loading==='bbFlash') && <Progress pct={progress.pct} msg={progress.msg} />}
            {bbResults && (
              <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:4 }}>
                {bbResults.map((r,i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:11.5, padding:'5px 8px', borderRadius:5, background:'var(--bg2)' }}>
                    <span style={{ fontFamily:'monospace', color:'var(--text)' }}>{r.partition || r.path}</span>
                    <span style={{ color: r.success ? '#4ade80' : '#f87171' }}>{r.success ? `${((r.size||0)/1e6).toFixed(1)}MB` : (r.error || 'failed')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'iostools' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {!udid && <div style={{ padding:12, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>Connect an iOS device for the libimobiledevice tools below.</div>}

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>libimobiledevice Suite</div>
              {btn('Load Tools', loadIlTools, 'default')}
            </div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6, marginBottom:10 }}>
              One-click wrappers for the standard libimobiledevice CLI - the same binaries OMERTA already uses for recovery mode and backups elsewhere in the app.
            </div>

            {ilTools.length === 0 && <div style={{ fontSize:11, color:'var(--text3)' }}>Click "Load Tools" to check which binaries are installed.</div>}

            {ilTools.length > 0 && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:6 }}>
                {ilTools.map((t,i) => (
                  <button key={i} onClick={() => runIlTool(t)} disabled={!t.installed || !udid}
                    style={{ textAlign:'left', padding:'9px 11px', borderRadius:8, cursor:(!t.installed||!udid)?'not-allowed':'pointer',
                      background:'var(--bg2)', border:'1px solid var(--border)', opacity:(!t.installed||!udid)?0.5:1 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:2 }}>
                      <span style={{ fontSize:12, fontWeight:600, color:'var(--text)' }}>{t.label}</span>
                      <span style={{ fontSize:9, padding:'1px 5px', borderRadius:3, fontWeight:700,
                        background: t.installed ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
                        color: t.installed ? '#4ade80' : '#f87171' }}>{t.installed ? 'OK' : 'MISSING'}</span>
                    </div>
                    <div style={{ fontSize:10.5, color:'var(--text3)', lineHeight:1.4 }}>{t.desc}</div>
                  </button>
                ))}
              </div>
            )}

            {ilOutput && (
              <div style={{ marginTop:10, background:'#000', border:'1px solid var(--border)', borderRadius:8, padding:10 }}>
                <div style={{ fontSize:10, color:'var(--text3)', marginBottom:4 }}>{ilOutput.label}</div>
                <pre style={{ margin:0, fontSize:10.5, color:'#4ade80', whiteSpace:'pre-wrap', maxHeight:220, overflowY:'auto', fontFamily:'monospace' }}>{ilOutput.output}</pre>
              </div>
            )}
          </div>

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>IPSW Builder / Extractor (blacktop/ipsw)</div>
              {btn('Select IPSW File', pickIpsw, 'default')}
            </div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6, marginBottom:10 }}>
              Requires the <code style={{ color:'var(--accent)' }}>ipsw</code> CLI on PATH (get it from{' '}
              <span onClick={()=>ft.openUrl('https://github.com/blacktop/ipsw')} style={{ color:'var(--accent)', cursor:'pointer', textDecoration:'underline' }}>github.com/blacktop/ipsw</span>).
              For downloading a fresh IPSW, use the "Open Build Folder in Terminal" button in the iOS Ramdisk tab and run{' '}
              <code style={{ color:'var(--accent)' }}>ipsw download ipsw --device &lt;identifier&gt; --latest</code> there, since downloads are large and need a live progress view.
            </div>
            {ipswPath && <div style={{ fontSize:11, color:'var(--text3)', fontFamily:'monospace', marginBottom:10 }}>{ipswPath}</div>}
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {btn('Info / Inspect', ipswInfo, 'default', !ipswPath)}
              {btn('Extract Kernelcache', ipswExtractKernel, 'green', !ipswPath)}
              {btn('Extract dyld_shared_cache', ipswExtractDyld, 'green', !ipswPath)}
            </div>
            {ipswOutput && (
              <div style={{ marginTop:10, background:'#000', border:'1px solid var(--border)', borderRadius:8, padding:10 }}>
                <div style={{ fontSize:10, color:'var(--text3)', marginBottom:4 }}>{ipswOutput.label}</div>
                <pre style={{ margin:0, fontSize:10.5, color:'#4ade80', whiteSpace:'pre-wrap', maxHeight:220, overflowY:'auto', fontFamily:'monospace' }}>{ipswOutput.output}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
