import { useState, useEffect } from 'react'
const ft = window.ft

function Btn({ children, onClick, color, disabled, sm }) {
  const s={accent:{bg:'var(--accent)',fg:'#000',bd:'transparent'},green:{bg:'rgba(74,222,128,0.15)',fg:'#4ade80',bd:'rgba(74,222,128,0.3)'},blue:{bg:'rgba(96,165,250,0.15)',fg:'#60a5fa',bd:'rgba(96,165,250,0.3)'},red:{bg:'rgba(248,113,113,0.15)',fg:'#f87171',bd:'rgba(248,113,113,0.3)'},amber:{bg:'rgba(245,158,11,0.15)',fg:'#f59e0b',bd:'rgba(245,158,11,0.3)'},purple:{bg:'rgba(167,139,250,0.15)',fg:'#a78bfa',bd:'rgba(167,139,250,0.3)'}}
  const c=s[color]||{bg:'var(--bg3)',fg:'var(--text)',bd:'var(--border)'}
  return <button onClick={onClick} disabled={disabled} style={{padding:sm?'5px 10px':'7px 14px',borderRadius:7,fontSize:sm?11:12,fontWeight:600,cursor:disabled?'not-allowed':'pointer',background:c.bg,color:c.fg,border:`1px solid ${c.bd}`,opacity:disabled?0.5:1,whiteSpace:'nowrap'}}>{children}</button>
}

function Card({ title, color, children }) {
  return <div style={{background:'var(--bg1)',border:`1px solid ${color||'var(--border)'}33`,borderRadius:10,padding:14,borderLeft:`3px solid ${color||'var(--border)'}`}}>
    {title&&<div style={{fontSize:11,fontWeight:700,color:color||'var(--text3)',letterSpacing:'0.06em',marginBottom:10}}>{title}</div>}
    {children}
  </div>
}

const TABS=[['device','Device'],['backup','Backup'],['trollstore','TrollStore'],['passcode','Passcode'],['altstore','Sideloading'],['crash','Crash Logs'],['devmode','Dev Mode']]

export default function iOSToolbox({ device, addLog }) {
  const udid = device?.udid || device?.serial
  const isIos = device?.deviceType==='ios'
  const [tab, setTab] = useState('device')
  const [deviceName, setDeviceName] = useState('')
  const [newName, setNewName] = useState('')
  const [deviceDate, setDeviceDate] = useState('')
  const [newDate, setNewDate] = useState('')
  const [crashes, setCrashes] = useState([])
  const [trollInfo, setTrollInfo] = useState(null)
  const [trollSteps, setTrollSteps] = useState(null)
  const [altInfo, setAltInfo] = useState(null)
  const [passcodeInfo, setPasscodeInfo] = useState(null)
  const [encPass, setEncPass] = useState('')
  const [output, setOutput] = useState('')
  const [progress, setProgress] = useState({pct:0,msg:''})
  const [connDoctor, setConnDoctor] = useState(null)
  const [battDetail, setBattDetail] = useState(null)

  useEffect(() => {
    const u = ft.on('ios:ext:progress', p => setProgress({pct:p.percent||p.pct||50,msg:p.message||p.msg||''}))
    return () => u()
  }, [])

  if (!isIos && udid) {
    // still show if we have a udid
  } else if (!udid) {
    return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:10,color:'var(--text3)'}}><div style={{fontSize:40}}>📱</div><div style={{fontSize:15,fontWeight:600,color:'var(--text)'}}>Connect an iPhone or iPad</div></div>
  }

  const loadName = () => ft.iosExtra.device.getName({udid}).then(r=>{if(r.success)setDeviceName(r.name);else addLog('Error: '+r.error)}).catch(e=>addLog(e.message))
  const loadDate = () => ft.iosExtra.device.getDate({udid}).then(r=>{if(r.success)setDeviceDate(r.date);else addLog('Error: '+r.error)}).catch(e=>addLog(e.message))
  const loadCrashes = () => ft.iosExtra.crash.list({udid}).then(r=>{if(r.success){setCrashes(r.files||[]);addLog(`${r.files?.length||0} crash reports`)}else addLog('Error: '+r.error)}).catch(e=>addLog(e.message))

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10,padding:'16px 20px',height:'100%',overflowY:'auto',boxSizing:'border-box'}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:22}}>🧰</span>
        <div style={{flex:1}}>
          <div style={{fontSize:18,fontWeight:700,color:'var(--text)'}}>iOS Toolbox</div>
          <div style={{fontSize:12,color:'var(--text3)'}}>Device, backup, TrollStore, passcode, crash logs</div>
        </div>
        {udid&&<span style={{fontSize:11,padding:'3px 8px',background:'rgba(167,139,250,0.15)',borderRadius:5,color:'#a78bfa'}}>{udid.slice(0,12)}</span>}
      </div>

      <div style={{display:'flex',gap:2,background:'var(--bg2)',borderRadius:9,padding:3,flexWrap:'wrap'}}>
        {TABS.map(([id,l])=><button key={id} onClick={()=>setTab(id)} style={{flex:1,minWidth:70,padding:'6px 4px',borderRadius:7,fontSize:10,fontWeight:600,cursor:'pointer',background:tab===id?'var(--accent)':'transparent',color:tab===id?'#000':'var(--text3)',border:'none'}}>{l}</button>)}
      </div>

      {tab==='device' && (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <Card title="CONNECTION DOCTOR" color="#4ade80">
            <div style={{fontSize:12,color:'var(--text2)',lineHeight:1.7,marginBottom:10}}>Checks whether the USB device daemon (usbmuxd / Apple Mobile Device Service) is actually running — the #1 cause of "device not found".</div>
            <Btn color="green" onClick={()=>ft.iosExtra.usbmux({udid}).then(setConnDoctor).catch(e=>addLog(e.message))}>Check Connection</Btn>
            {connDoctor && (
              <div style={{marginTop:10,padding:'8px 10px',borderRadius:6,background:connDoctor.running?'rgba(74,222,128,0.1)':'rgba(248,113,113,0.1)',border:`1px solid ${connDoctor.running?'rgba(74,222,128,0.3)':'rgba(248,113,113,0.3)'}`,fontSize:12,color:connDoctor.running?'#4ade80':'#f87171'}}>
                {connDoctor.note}
              </div>
            )}
          </Card>
          <Card title="RESPRING" color="#f59e0b">
            <div style={{fontSize:12,color:'var(--text2)',lineHeight:1.7,marginBottom:10}}>Restarts SpringBoard (the home screen) without a full reboot. Requires the USB SSH proxy running (SSH/Frida tab in iOS Advanced) and a jailbroken device.</div>
            <Btn color="amber" onClick={()=>ft.iosExtra.respring({udid}).then(r=>addLog(r.success?'Respring sent':'Error: '+r.error)).catch(e=>addLog(e.message))}>Respring Device</Btn>
          </Card>
          <Card title="DEVICE NAME" color="#60a5fa">
            <div style={{display:'flex',gap:8,marginBottom:8}}>
              <Btn color="blue" onClick={loadName}>Get Name</Btn>
              {deviceName&&<span style={{fontSize:13,color:'var(--text)',alignSelf:'center',fontWeight:600}}>{deviceName}</span>}
            </div>
            <div style={{display:'flex',gap:8}}>
              <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="New device name" style={{flex:1}} />
              <Btn color="accent" onClick={()=>ft.iosExtra.device.setName({udid,name:newName}).then(r=>addLog(r.success?'Name set to: '+newName:'Error: '+r.output)).catch(e=>addLog(e.message))}>Set Name</Btn>
            </div>
          </Card>
          <Card title="DEVICE DATE/TIME" color="#4ade80">
            <div style={{display:'flex',gap:8,marginBottom:8}}>
              <Btn color="green" onClick={loadDate}>Get Date</Btn>
              {deviceDate&&<span style={{fontSize:12,color:'var(--text)',alignSelf:'center',fontFamily:'monospace'}}>{deviceDate}</span>}
            </div>
            <div style={{display:'flex',gap:8}}>
              <input value={newDate} onChange={e=>setNewDate(e.target.value)} placeholder="e.g. 2026-01-15 12:00:00" style={{flex:1,fontFamily:'monospace',fontSize:11}} />
              <Btn color="accent" onClick={()=>ft.iosExtra.device.setDate({udid,date:newDate}).then(r=>addLog(r.success?'Date set':'Error: '+r.output)).catch(e=>addLog(e.message))}>Set Date</Btn>
            </div>
            <div style={{fontSize:10,color:'var(--text3)',marginTop:6}}>Requires special entitlement. Works on jailbroken devices via SSH: idevicedate -s "date string"</div>
          </Card>
          <Card title="DIAGNOSTICS" color="#a78bfa">
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <Btn sm color="purple" onClick={()=>ft.iosExtra.diag({udid}).then(r=>setOutput(r.sshCommand||r.note||'')).catch(e=>addLog(e.message))}>MobileGestalt Info</Btn>
              <Btn sm color="purple" onClick={()=>ft.iosExtra.entitlements({udid}).then(r=>setOutput(r.tools?.join(String.fromCharCode(10))||r.note||'')).catch(e=>addLog(e.message))}>Entitlements Guide</Btn>
              <Btn sm color="purple" onClick={()=>ft.iosExtra.battery({udid}).then(setBattDetail).catch(e=>addLog(e.message))}>Battery Detail</Btn>
            </div>
            {battDetail && (
              <div style={{marginTop:10,fontSize:12,color:'var(--text2)',lineHeight:1.7}}>
                <div><span style={{color:'var(--text3)'}}>Basic: </span>{battDetail.basic || '(none)'}</div>
                {battDetail.detailedHealth && <div style={{marginTop:4,fontFamily:'monospace',fontSize:11,color:'#4ade80'}}>{battDetail.detailedHealth}</div>}
                {battDetail.note && <div style={{marginTop:4,fontSize:11,color:'var(--text3)'}}>{battDetail.note}</div>}
              </div>
            )}
            {output&&<pre style={{fontFamily:'monospace',fontSize:10,color:'#d4d4d4',background:'#0a0a0a',borderRadius:7,padding:'8px 10px',whiteSpace:'pre-wrap',maxHeight:120,overflowY:'auto',marginTop:8}}>{output}</pre>}
          </Card>
        </div>
      )}

      {tab==='backup' && (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <Card title="BACKUP ENCRYPTION" color="#4ade80">
            <div style={{fontSize:12,color:'var(--text2)',marginBottom:10,lineHeight:1.7}}>Encrypted backups include keychain, Health data, saved passwords. Strongly recommended.</div>
            <div style={{display:'flex',gap:8,marginBottom:8}}>
              <input value={encPass} onChange={e=>setEncPass(e.target.value)} placeholder="Backup password" type="password" style={{flex:1}} />
            </div>
            <div style={{display:'flex',gap:8}}>
              <Btn color="green" onClick={()=>ft.iosExtra.backup.setEncryption({udid,enable:true,password:encPass}).then(r=>addLog(r.success?'Encryption ON':'Error: '+r.output)).catch(e=>addLog(e.message))}>Enable Encryption</Btn>
              <Btn color="red" sm onClick={()=>ft.iosExtra.backup.setEncryption({udid,enable:false,password:encPass}).then(r=>addLog(r.success?'Encryption OFF':'Error: '+r.output)).catch(e=>addLog(e.message))}>Disable</Btn>
            </div>
          </Card>
          <Card title="RESTORE FROM BACKUP" color="#f59e0b">
            <div style={{fontSize:12,color:'var(--text2)',marginBottom:10,lineHeight:1.7}}>Restore from a previous idevicebackup2 backup. Device must be paired and trusted.</div>
            <Btn color="amber" onClick={()=>ft.iosExtra.backup.restore({udid}).then(r=>r.cancelled?null:addLog(r.success?'Restore complete':'Failed: '+r.output)).catch(e=>addLog(e.message))}>Select Backup Folder and Restore</Btn>
            {progress.pct>0&&<div style={{marginTop:8}}><div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--text3)',marginBottom:3}}><span>{progress.msg}</span><span>{progress.pct}%</span></div><div style={{height:5,background:'var(--bg3)',borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:progress.pct+'%',background:'var(--accent)',transition:'width 0.3s'}}/></div></div>}
          </Card>
        </div>
      )}

      {tab==='trollstore' && (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <div style={{padding:12,background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.3)',borderRadius:8,fontSize:13,color:'#4ade80',fontWeight:600}}>
            TrollStore installs apps permanently — no 7-day expiry, no revocation. Works on iOS 14.0 through 17.0.
          </div>
          <div style={{display:'flex',gap:8}}>
            <Btn color="green" onClick={()=>ft.iosExtra.trollstore.check({udid,device:device?.product||'iPhone8,1'}).then(r=>{setTrollInfo(r);addLog('Signed: '+r.signed?.join(', '))}).catch(e=>addLog(e.message))}>Check Compatibility</Btn>
            <Btn color="accent" onClick={()=>ft.iosExtra.trollstore.install({udid}).then(r=>setTrollSteps(r.steps)).catch(e=>addLog(e.message))}>Show Install Steps</Btn>
            <Btn color="blue" sm onClick={()=>ft.openUrl('https://github.com/opa334/TrollStore')}>GitHub</Btn>
          </div>
          {trollInfo?.signed?.length>0&&<div style={{padding:10,background:'rgba(74,222,128,0.08)',borderRadius:8,border:'1px solid rgba(74,222,128,0.2)',fontSize:12,color:'var(--text2)'}}>Signed iOS versions: <span style={{color:'#4ade80',fontWeight:600}}>{trollInfo.signed.join(', ')}</span></div>}
          {trollSteps&&<div style={{display:'flex',flexDirection:'column',gap:6}}>{trollSteps.map((s,i)=><div key={i} style={{display:'flex',gap:8}}><div style={{width:22,height:22,borderRadius:'50%',background:'#4ade80',color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,flexShrink:0}}>{i+1}</div><div style={{fontSize:12,color:'var(--text2)',lineHeight:1.7,paddingTop:2}}>{s}</div></div>)}</div>}
          <Card title="WHAT CAN TROLLSTORE INSTALL" color="#4ade80">
            {['UTM (QEMU virtual machines on iPhone)','Delta emulator (Nintendo, SNES, GBA)','Filza file manager','DiskDiag storage analyser','AppsDump app data extractor','Jaildiscord patched Discord','Cowabunga system customization (no jailbreak)','Rhino YouTube client','Balatro, emulators, other PC ports'].map((s,i)=><div key={i} style={{display:'flex',gap:8,padding:'4px 0',borderBottom:'1px solid var(--border)',fontSize:12}}><span style={{color:'#4ade80'}}>✓</span><span style={{color:'var(--text2)'}}>{s}</span></div>)}
          </Card>
        </div>
      )}

      {tab==='passcode' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <div style={{padding:10,background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.2)',borderRadius:8,fontSize:12,color:'#f87171'}}>Only use these methods to recover your own device. Bypassing someone else's passcode is illegal.</div>
          <Btn color="red" onClick={()=>ft.iosExtra.passcode().then(r=>setPasscodeInfo(r)).catch(e=>addLog(e.message))}>Show Bypass Methods</Btn>
          {passcodeInfo?.methods?.map((m,i)=>(
            <div key={i} style={{background:'var(--bg1)',border:'1px solid var(--border)',borderRadius:9,padding:'12px 14px',borderLeft:`3px solid ${m.difficulty==='Easy'?'#4ade80':m.difficulty==='Medium'?'#f59e0b':'#f87171'}`}}>
              <div style={{display:'flex',gap:8,marginBottom:4,alignItems:'center'}}>
                <span style={{fontSize:13,fontWeight:600,color:'var(--text)',flex:1}}>{m.name}</span>
                <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:'var(--bg3)',color:'var(--text3)'}}>{m.works}</span>
                <span style={{fontSize:10,padding:'2px 6px',borderRadius:4,fontWeight:700,background:m.difficulty==='Easy'?'rgba(74,222,128,0.15)':m.difficulty==='Medium'?'rgba(245,158,11,0.15)':'rgba(248,113,113,0.15)',color:m.difficulty==='Easy'?'#4ade80':m.difficulty==='Medium'?'#f59e0b':'#f87171'}}>{m.difficulty}</span>
              </div>
              <div style={{fontSize:12,color:'var(--text3)',lineHeight:1.6}}>{m.desc}</div>
              {m.url&&<button onClick={()=>ft.openUrl(m.url)} style={{marginTop:6,padding:'4px 10px',borderRadius:5,fontSize:10,fontWeight:600,cursor:'pointer',background:'var(--accent)',color:'#000',border:'none'}}>Open</button>}
            </div>
          ))}
        </div>
      )}

      {tab==='altstore' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <Btn color="blue" onClick={()=>ft.iosExtra.altstore().then(r=>setAltInfo(r)).catch(e=>addLog(e.message))}>Load Sideloading Options</Btn>
          {altInfo&&(
            <>
              <div style={{padding:10,background:'rgba(96,165,250,0.08)',borderRadius:8,border:'1px solid rgba(96,165,250,0.2)',fontSize:12,color:'var(--text2)',lineHeight:1.7}}>{altInfo.refreshNote}</div>
              {altInfo.tools?.map((t,i)=>(
                <div key={i} style={{background:'var(--bg1)',border:'1px solid var(--border)',borderRadius:9,padding:'12px 14px',display:'flex',gap:10}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:'var(--text)',marginBottom:3}}>{t.name}</div>
                    <div style={{fontSize:11,color:'var(--text3)',lineHeight:1.6}}>{t.desc}</div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0,alignItems:'flex-end'}}>
                    <span style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:'rgba(74,222,128,0.15)',color:'#4ade80',fontWeight:700}}>{t.free?'Free':'Paid'}</span>
                    <button onClick={()=>ft.openUrl(t.url)} style={{padding:'4px 10px',borderRadius:5,fontSize:10,fontWeight:600,cursor:'pointer',background:'var(--accent)',color:'#000',border:'none'}}>Open</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab==='crash' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <div style={{fontSize:12,color:'var(--text2)',lineHeight:1.7}}>Pull crash logs from device using idevicecrashreport. Includes all app crashes, kernel panics, and system logs.</div>
          <div style={{display:'flex',gap:8}}>
            <Btn color="red" onClick={loadCrashes}>Pull Crash Reports</Btn>
            <Btn color="blue" sm onClick={()=>ft.iosExtra.crash.openFolder().then(r=>addLog('Opened: '+r.path)).catch(e=>addLog(e.message))}>Open Folder</Btn>
          </div>
          {crashes.length>0&&<div style={{fontSize:11,color:'var(--text3)',marginBottom:4}}>{crashes.length} crash files pulled</div>}
          <div style={{display:'flex',flexDirection:'column',gap:3}}>
            {crashes.slice(0,20).map((f,i)=>(
              <div key={i} style={{padding:'6px 10px',background:'var(--bg1)',borderRadius:7,border:'1px solid var(--border)',fontSize:11,fontFamily:'monospace',color:f.includes('panic')||f.includes('Kernel')?'#f87171':f.includes('.ips')||f.includes('.crash')?'#f59e0b':'var(--text2)'}}>{f}</div>
            ))}
          </div>
        </div>
      )}

      {tab==='devmode' && (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <Card title="DEVELOPER MODE (iOS 16+)" color="#60a5fa">
            <div style={{fontSize:12,color:'var(--text2)',marginBottom:10,lineHeight:1.7}}>Required for sideloading, running debug builds, and USB debugging. Enable once and it persists.</div>
            <Btn color="blue" onClick={()=>ft.iosExtra.devMode().then(r=>setOutput(r.steps?.join(String.fromCharCode(10))||r.note||'')).catch(e=>addLog(e.message))}>Show Enable Steps</Btn>
            {output&&<div style={{marginTop:10}}>{output.split(String.fromCharCode(10)).map((s,i)=><div key={i} style={{display:'flex',gap:8,marginBottom:6}}><div style={{width:22,height:22,borderRadius:'50%',background:'#60a5fa',color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,flexShrink:0}}>{i+1}</div><div style={{fontSize:12,color:'var(--text2)',lineHeight:1.7,paddingTop:2}}>{s}</div></div>)}</div>}
          </Card>
          <Card title="LOCATION SPOOFING" color="#4ade80">
            <Btn color="green" onClick={()=>ft.iosExtra.location({udid}).then(r=>setOutput(r.note+String.fromCharCode(10)+r.xcodeNote)).catch(e=>addLog(e.message))}>Show Location Spoof Methods</Btn>
            {output&&<pre style={{fontFamily:'monospace',fontSize:10,color:'#d4d4d4',background:'#0a0a0a',borderRadius:7,padding:'8px 10px',whiteSpace:'pre-wrap',maxHeight:120,overflowY:'auto',marginTop:8}}>{output}</pre>}
          </Card>
        </div>
      )}
    </div>
  )
}
