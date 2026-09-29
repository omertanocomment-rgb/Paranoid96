import { useState, useEffect } from 'react'
const ft = window.ft

function Btn({ children, onClick, color, disabled }) {
  const s={accent:{bg:'var(--accent)',fg:'#000',bd:'transparent'},green:{bg:'rgba(74,222,128,0.15)',fg:'#4ade80',bd:'rgba(74,222,128,0.3)'},red:{bg:'rgba(248,113,113,0.15)',fg:'#f87171',bd:'rgba(248,113,113,0.3)'},amber:{bg:'rgba(245,158,11,0.15)',fg:'#f59e0b',bd:'rgba(245,158,11,0.3)'},blue:{bg:'rgba(96,165,250,0.15)',fg:'#60a5fa',bd:'rgba(96,165,250,0.3)'}}
  const c=s[color]||{bg:'var(--bg3)',fg:'var(--text)',bd:'var(--border)'}
  return <button onClick={onClick} disabled={disabled} style={{padding:'8px 16px',borderRadius:7,fontSize:12,fontWeight:600,cursor:disabled?'not-allowed':'pointer',background:c.bg,color:c.fg,border:`1px solid ${c.bd}`,opacity:disabled?0.5:1}}>{children}</button>
}

export default function EraseDevice({ device, addLog }) {
  const udid = device?.udid || device?.serial
  const [confirmed, setConfirmed] = useState(false)
  const [backedUp, setBackedUp] = useState(false)
  const [guide, setGuide] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  useEffect(() => {
    const u = ft.on('ios:erase:progress', p => setProgress(p.msg||''))
    ft.iosErase.dfuGuide().then(setGuide).catch(()=>{})
    return () => u()
  }, [])

  const doBackup = async () => {
    setBusy(true)
    const r = await ft.nand.ios.backupFull({udid}).catch(e=>({error:e.message}))
    if (r.cancelled) { setBusy(false); return }
    if (r.success) { setBackedUp(true); addLog('Backup complete: '+r.dest) }
    else addLog('Backup failed: '+r.error)
    setBusy(false)
  }

  const doEraseViaTool = async () => {
    if (!confirmed) return addLog('Please confirm you understand this erases all data')
    setBusy(true)
    const r = await ft.iosErase.viaBackupTool({udid}).catch(e=>({error:e.message}))
    addLog(r.success ? 'Erase command sent. Device should be wiping now.' : 'Error: '+(r.error||r.output))
    setBusy(false)
  }

  const enterRecoveryMode = async () => {
    setBusy(true)
    const r = await ft.iosErase.enterRecovery({udid}).catch(e=>({error:e.message}))
    addLog(r.success ? r.note : 'Error: '+r.error)
    setBusy(false)
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14,padding:'16px 20px',height:'100%',overflowY:'auto',boxSizing:'border-box'}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:24}}>🗑️</span>
        <div style={{flex:1}}>
          <div style={{fontSize:19,fontWeight:700,color:'var(--text)'}}>Erase Device</div>
          <div style={{fontSize:12,color:'var(--text3)'}}>Factory reset to a clean state</div>
        </div>
      </div>

      <div style={{padding:14,background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.3)',borderRadius:9,fontSize:13,color:'#f87171',fontWeight:600,lineHeight:1.7}}>
        Warning: This permanently erases ALL data on the device - photos, messages, contacts, apps, everything. There is no undo. Back up first.
      </div>

      <div style={{background:'var(--bg1)',border:'1px solid var(--border)',borderRadius:10,padding:14}}>
        <div style={{fontSize:13,fontWeight:700,color:'var(--text)',marginBottom:10}}>Step 1: Backup (strongly recommended)</div>
        <div style={{display:'flex',gap:10,alignItems:'center'}}>
          <Btn color={backedUp?'green':'blue'} onClick={doBackup} disabled={busy}>{backedUp?'Backup Complete ✓':busy?'Backing up...':'Run Full Backup First'}</Btn>
          {progress && <span style={{fontSize:11,color:'var(--text3)'}}>{progress}</span>}
        </div>
      </div>

      <div style={{background:'var(--bg1)',border:'1px solid var(--border)',borderRadius:10,padding:14}}>
        <div style={{fontSize:13,fontWeight:700,color:'var(--text)',marginBottom:10}}>Step 2: Choose Erase Method</div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:600,color:'#4ade80',marginBottom:6}}>Method A — Direct erase (if device is paired and responsive)</div>
          <div style={{fontSize:12,color:'var(--text2)',marginBottom:8,lineHeight:1.6}}>Uses idevicebackup2 to send an erase command directly. Works on trusted, paired devices.</div>
          <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,fontSize:12,color:'var(--text2)'}}>
            <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />
            I understand this permanently erases all data and cannot be undone
          </label>
          <Btn color="red" onClick={doEraseViaTool} disabled={busy||!confirmed}>{busy?'Erasing...':'Erase Now'}</Btn>
        </div>

        <div style={{borderTop:'1px solid var(--border)',paddingTop:14}}>
          <div style={{fontSize:12,fontWeight:600,color:'#f59e0b',marginBottom:6}}>Method B — DFU + iTunes restore (works even if screen is broken)</div>
          <div style={{fontSize:12,color:'var(--text2)',marginBottom:8,lineHeight:1.6}}>Boots device to recovery mode, then iTunes/Finder performs a full restore. Most reliable method, works on any device.</div>
          <div style={{display:'flex',gap:8}}>
            <Btn color="amber" onClick={enterRecoveryMode} disabled={busy}>Enter Recovery Mode</Btn>
            <Btn color="blue" onClick={()=>ft.iosErase.openItunes().then(r=>addLog(r.note)).catch(e=>addLog(e.message))}>Open iTunes</Btn>
          </div>
        </div>
      </div>

      {guide && (
        <div style={{background:'var(--bg1)',border:'1px solid var(--border)',borderRadius:10,padding:14}}>
          <div style={{fontSize:13,fontWeight:700,color:'var(--text)',marginBottom:10}}>Manual DFU Restore Guide (iPhone 6/6s/SE)</div>
          {guide.steps.map((s,i) => (
            <div key={i} style={{display:'flex',gap:8,marginBottom:8}}>
              <div style={{width:22,height:22,borderRadius:'50%',background:'#f59e0b',color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,flexShrink:0}}>{i+1}</div>
              <div style={{fontSize:12,color:'var(--text2)',lineHeight:1.7,paddingTop:2,fontWeight:s.includes('BLACK')||s.includes('BACKUP')?700:400}}>{s}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{background:'var(--bg1)',border:'1px solid var(--border)',borderRadius:10,padding:14}}>
        <div style={{fontSize:12,fontWeight:700,color:'var(--text3)',marginBottom:8}}>iTunes/Finder NOT INSTALLED?</div>
        <div style={{fontSize:12,color:'var(--text2)',lineHeight:1.7}}>
          Windows: download iTunes from apple.com/itunes, or Apple Devices from Microsoft Store.<br/>
          Linux: iTunes is not officially supported. Use libimobiledevice tools above (Method A), or run iTunes via Wine/Bottles, or use a Windows/Mac for the final restore step.<br/>
          Mac: Finder handles this natively, no extra software needed.
        </div>
      </div>
    </div>
  )
}
