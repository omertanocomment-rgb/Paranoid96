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

function Row({ label, value, mono, color }) {
  if (value===null || value===undefined || value==='') return null
  return <div style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid var(--border)',fontSize:12}}>
    <span style={{color:'var(--text3)'}}>{label}</span>
    <span style={{color:color||'var(--text2)',fontFamily:mono?'monospace':'inherit',fontSize:mono?11:12}}>{String(value)}</span>
  </div>
}

function Out({ text }) {
  if (!text) return null
  return <pre style={{fontFamily:'monospace',fontSize:10,color:'#d4d4d4',background:'#0a0a0a',borderRadius:7,padding:'8px 10px',whiteSpace:'pre-wrap',wordBreak:'break-all',maxHeight:180,overflowY:'auto',margin:'8px 0 0',lineHeight:1.7}}>{text}</pre>
}

const KEYCODES = [{k:'KEYCODE_HOME',n:'Home'},{k:'KEYCODE_BACK',n:'Back'},{k:'KEYCODE_MENU',n:'Menu'},{k:'KEYCODE_POWER',n:'Power'},{k:'KEYCODE_VOLUME_UP',n:'Vol+'},{k:'KEYCODE_VOLUME_DOWN',n:'Vol-'},{k:'KEYCODE_CAMERA',n:'Camera'},{k:'KEYCODE_NOTIFICATION',n:'Notif'},{k:'KEYCODE_MEDIA_PLAY_PAUSE',n:'Play/Pause'},{k:'KEYCODE_SCREENSHOT',n:'Screenshot'}]

const TABS=[['input','Input & Record'],['dumpsys','Dumpsys'],['network','Network'],['storage','Storage'],['devtools','Dev Tools'],['settings','Settings DB'],['packages','Packages'],['sensors','Sensors'],['bluetooth','Bluetooth'],['integrity','Integrity Check']]

export default function AndroidToolbox({ device, addLog }) {
  const serial = device?.serial
  const [tab, setTab] = useState('input')
  const [output, setOutput] = useState('')
  const [recording, setRecording] = useState(false)
  const [tapX, setTapX] = useState('540')
  const [tapY, setTapY] = useState('960')
  const [swipe, setSwipe] = useState({x1:'200',y1:'960',x2:'800',y2:'960',dur:'300'})
  const [inputText, setInputText] = useState('')
  const [pingHost, setPingHost] = useState('8.8.8.8')
  const [settingsNs, setSettingsNs] = useState('global')
  const [settingsKey, setSettingsKey] = useState('')
  const [settingsVal, setSettingsVal] = useState('')
  const [settingsList, setSettingsList] = useState([])
  const [pkgId, setPkgId] = useState('')
  const [tempData, setTempData] = useState([])
  const [notifs, setNotifs] = useState([])
  const [macroSteps, setMacroSteps] = useState([])
  const [animScale, setAnimScale] = useState('0')
  const [btDevices, setBtDevices] = useState([])
  const [btOn, setBtOn] = useState(null)
  const [integrityResult, setIntegrityResult] = useState(null)
  const [batteryHealth, setBatteryHealth] = useState(null)

  useEffect(() => {
    const u = ft.on('android:macro:step', s => addLog('Step: '+JSON.stringify(s.done)))
    return () => u()
  }, [])

  const run = async (fn) => { try { const r = await fn(); setOutput(r?.output||r?.raw||JSON.stringify(r,null,2)||'Done'); return r } catch(e) { setOutput('Error: '+e.message); return null } }

  if (!serial) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:10,color:'var(--text3)'}}><div style={{fontSize:40}}>🤖</div><div style={{fontSize:15,fontWeight:600,color:'var(--text)'}}>Connect an Android device</div></div>

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10,padding:'16px 20px',height:'100%',overflowY:'auto',boxSizing:'border-box'}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:22}}>🧰</span>
        <div style={{flex:1}}>
          <div style={{fontSize:18,fontWeight:700,color:'var(--text)'}}>Android Toolbox</div>
          <div style={{fontSize:12,color:'var(--text3)'}}>Input, dumpsys, network, storage, developer tools</div>
        </div>
        <span style={{fontSize:11,padding:'3px 8px',background:'rgba(74,222,128,0.15)',borderRadius:5,color:'#4ade80'}}>{serial?.slice(0,12)}</span>
      </div>

      <div style={{display:'flex',gap:2,background:'var(--bg2)',borderRadius:9,padding:3,flexWrap:'wrap'}}>
        {TABS.map(([id,l])=><button key={id} onClick={()=>setTab(id)} style={{flex:1,minWidth:70,padding:'6px 4px',borderRadius:7,fontSize:10,fontWeight:600,cursor:'pointer',background:tab===id?'var(--accent)':'transparent',color:tab===id?'#000':'var(--text3)',border:'none'}}>{l}</button>)}
      </div>

      {tab==='input' && (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <Card title="KEYBOARD SHORTCUTS" color="#60a5fa">
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              {KEYCODES.map(({k,n})=><Btn key={k} sm color="blue" onClick={()=>ft.android.input.keyevent({serial,keycode:k}).then(()=>addLog(n)).catch(e=>addLog(e.message))}>{n}</Btn>)}
            </div>
          </Card>
          <Card title="TAP" color="#4ade80">
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <input value={tapX} onChange={e=>setTapX(e.target.value)} placeholder="X" style={{width:70,fontFamily:'monospace'}} />
              <input value={tapY} onChange={e=>setTapY(e.target.value)} placeholder="Y" style={{width:70,fontFamily:'monospace'}} />
              <Btn color="green" onClick={()=>ft.android.input.tap({serial,x:parseInt(tapX),y:parseInt(tapY)}).then(()=>addLog(`Tapped ${tapX},${tapY}`)).catch(e=>addLog(e.message))}>Tap</Btn>
            </div>
          </Card>
          <Card title="SWIPE" color="#f59e0b">
            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
              {[['x1','X1'],['y1','Y1'],['x2','X2'],['y2','Y2'],['dur','ms']].map(([k,l])=><div key={k} style={{display:'flex',flexDirection:'column',gap:2}}><span style={{fontSize:9,color:'var(--text3)'}}>{l}</span><input value={swipe[k]} onChange={e=>setSwipe(s=>({...s,[k]:e.target.value}))} style={{width:55,fontFamily:'monospace'}} /></div>)}
              <Btn color="amber" onClick={()=>ft.android.input.swipe({serial,...Object.fromEntries(Object.entries(swipe).map(([k,v])=>[k,parseInt(v)]))}).then(()=>addLog('Swiped')).catch(e=>addLog(e.message))}>Swipe</Btn>
            </div>
          </Card>
          <Card title="TYPE TEXT" color="#a78bfa">
            <div style={{display:'flex',gap:8}}>
              <input value={inputText} onChange={e=>setInputText(e.target.value)} placeholder="Text to type on device..." style={{flex:1}} />
              <Btn color="purple" onClick={()=>ft.android.input.text({serial,text:inputText}).then(()=>addLog('Typed')).catch(e=>addLog(e.message))}>Type</Btn>
            </div>
          </Card>
          <Card title="SCREEN RECORD" color="#f87171">
            <div style={{display:'flex',gap:8,marginBottom:8}}>
              {!recording ? <Btn color="red" onClick={async()=>{const r=await ft.android.screenrecord.start({serial}).catch(e=>({error:e.message}));if(r.success){setRecording(true);addLog('Recording started')}else addLog('Error: '+r.error)}}>Start Recording</Btn>
              : <Btn color="accent" onClick={async()=>{const r=await ft.android.screenrecord.stop({serial}).catch(e=>({error:e.message}));setRecording(false);addLog(r.success?'Saved: '+r.path:'Error: '+r.error)}}>Stop & Save</Btn>}
              {recording && <span style={{fontSize:12,color:'#f87171',alignSelf:'center'}}>● Recording...</span>}
            </div>
            <div style={{fontSize:11,color:'var(--text3)'}}>Records screen to /sdcard/ then pulls to PC. Requires Android 4.4+.</div>
          </Card>
          <Card title="NOTIFICATIONS" color="#f59e0b">
            <div style={{display:'flex',gap:8,marginBottom:8}}>
              <Btn color="amber" onClick={()=>ft.android.notif.list({serial}).then(r=>{setNotifs(r.notifications||[]);addLog(`${r.count||0} notifications`)}).catch(e=>addLog(e.message))}>List</Btn>
              <Btn color="red" sm onClick={()=>ft.android.notif.clear({serial}).then(()=>addLog('Cleared')).catch(e=>addLog(e.message))}>Clear All</Btn>
            </div>
            {notifs.slice(0,10).map((n,i)=><div key={i} style={{padding:'4px 0',borderBottom:'1px solid var(--border)',fontSize:11}}><span style={{color:'var(--accent)',marginRight:8}}>{n.pkg?.split('.').pop()}</span><span style={{color:'var(--text2)'}}>{n.title||'(no title)'}</span></div>)}
          </Card>
        </div>
      )}

      {tab==='dumpsys' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[
            ['Battery Info','amber',()=>run(()=>ft.android.dumpsys.battery({serial}))],
            ['Current Activity','blue',()=>run(()=>ft.android.dumpsys.activity({serial}))],
            ['Memory Info','purple',()=>run(()=>ft.android.dumpsys.meminfo({serial}))],
            ['Display / Window','green',()=>run(()=>ft.android.dumpsys.window({serial}))],
            ['CPU Temperatures','red',()=>run(()=>ft.android.info.cpuTemp({serial}).then(r=>{if(r.temps)setTempData(r.temps);return r}))],
            ['IMEI / Device ID','amber',()=>run(()=>ft.android.info.imei({serial}))],
          ].map(([label,color,fn])=><Btn key={label} color={color} onClick={fn}>{label}</Btn>)}
          {tempData.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:5}}>{tempData.map((t,i)=><div key={i} style={{padding:'4px 8px',borderRadius:5,background:t.temp>80?'rgba(248,113,113,0.2)':t.temp>60?'rgba(245,158,11,0.2)':'rgba(74,222,128,0.2)',color:t.temp>80?'#f87171':t.temp>60?'#f59e0b':'#4ade80',fontSize:11,fontFamily:'monospace'}}>Z{t.zone}: {t.temp.toFixed(1)}°C</div>)}</div>}
          <Out text={output} />
        </div>
      )}

      {tab==='network' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <div style={{display:'flex',gap:8}}>
            <input value={pingHost} onChange={e=>setPingHost(e.target.value)} placeholder="Host to ping" style={{flex:1,fontFamily:'monospace'}} />
            <Btn color="green" onClick={()=>run(()=>ft.android.net.ping({serial,host:pingHost}))}>Ping</Btn>
            <Btn color="blue" sm onClick={()=>run(()=>ft.android.net.traceroute({serial,host:pingHost}))}>Trace</Btn>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <Btn color="blue" sm onClick={()=>run(()=>ft.android.net.ipInfo({serial}))}>IP Info</Btn>
            <Btn color="amber" sm onClick={()=>run(()=>ft.android.net.ports({serial}))}>Open Ports</Btn>
            <Btn color="purple" sm onClick={()=>run(()=>ft.android.net.arp({serial}))}>ARP Table</Btn>
          </div>
          <Out text={output} />
        </div>
      )}

      {tab==='storage' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <Btn color="blue" onClick={()=>run(()=>ft.android.storage({serial}))}>Scan Storage Usage</Btn>
          <Card title="PULL APK FROM DEVICE" color="#4ade80">
            <div style={{display:'flex',gap:8}}>
              <input value={pkgId} onChange={e=>setPkgId(e.target.value)} placeholder="com.example.app" style={{flex:1,fontFamily:'monospace',fontSize:11}} />
              <Btn color="green" onClick={()=>ft.android.apk.pull({serial,packageId:pkgId}).then(r=>addLog(r.success?'Pulled: '+r.path:'Error: '+r.error)).catch(e=>addLog(e.message))}>Pull APK</Btn>
            </div>
          </Card>
          <Card title="FILE OPS (root required for system paths)" color="#f59e0b">
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <Btn sm color="blue" onClick={()=>ft.android.files.push({serial,dest:'/sdcard/'}).then(r=>addLog(r.cancelled?'Cancelled':r.results?.length+' file(s) pushed')).catch(e=>addLog(e.message))}>Push Files</Btn>
              <Btn sm color="amber" onClick={()=>run(()=>ft.android.files.cat({serial,path:'/sdcard/'}))}>Cat File</Btn>
            </div>
          </Card>
          <Out text={output} />
        </div>
      )}

      {tab==='devtools' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <Card title="ANIMATION SPEED" color="#a78bfa">
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              {['0','0.5','1','2'].map(v=><Btn key={v} sm color={animScale===v?'accent':'purple'} onClick={()=>{setAnimScale(v);ft.android.dev.animScale({serial,scale:parseFloat(v)}).then(()=>addLog(`Animations: ${v===0?'off':v+'x'}`)).catch(e=>addLog(e.message))}}>{v==='0'?'Off':v+'x'}</Btn>)}
            </div>
            <div style={{fontSize:11,color:'var(--text3)',marginTop:6}}>0 = no animations (fastest). Restart apps to take effect.</div>
          </Card>
          <Card title="VISUAL DEBUG" color="#60a5fa">
            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              <Btn sm color="blue" onClick={()=>ft.android.dev.showTaps({serial,enable:true}).then(()=>addLog('Show taps ON')).catch(e=>addLog(e.message))}>Show Taps ON</Btn>
              <Btn sm color="blue" onClick={()=>ft.android.dev.showTaps({serial,enable:false}).then(()=>addLog('Show taps OFF')).catch(e=>addLog(e.message))}>Show Taps OFF</Btn>
              <Btn sm color="blue" onClick={()=>ft.android.dev.layoutBounds({serial,enable:true}).then(()=>addLog('Layout bounds ON')).catch(e=>addLog(e.message))}>Layout Bounds</Btn>
              <Btn sm color="blue" onClick={()=>ft.android.dev.gpuRendering({serial,enable:true}).then(()=>addLog('GPU profiling ON')).catch(e=>addLog(e.message))}>GPU Profiling</Btn>
              <Btn sm color="blue" onClick={()=>ft.android.dev.overdraw({serial,enable:true}).then(()=>addLog('Overdraw ON')).catch(e=>addLog(e.message))}>Show Overdraw</Btn>
            </div>
          </Card>
          <Card title="DISPLAY" color="#4ade80">
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <Btn sm color="green" onClick={()=>ft.android.a11y.displaySize({serial,dpi:320}).then(()=>addLog('DPI 320')).catch(e=>addLog(e.message))}>DPI 320</Btn>
              <Btn sm color="green" onClick={()=>ft.android.a11y.displaySize({serial,dpi:420}).then(()=>addLog('DPI 420')).catch(e=>addLog(e.message))}>DPI 420</Btn>
              <Btn sm color="green" onClick={()=>ft.android.a11y.displaySize({serial,dpi:560}).then(()=>addLog('DPI 560')).catch(e=>addLog(e.message))}>DPI 560</Btn>
              <Btn sm color="amber" onClick={()=>ft.android.a11y.fontScale({serial,scale:1.0}).then(()=>addLog('Font normal')).catch(e=>addLog(e.message))}>Font Normal</Btn>
              <Btn sm color="amber" onClick={()=>ft.android.a11y.fontScale({serial,scale:1.3}).then(()=>addLog('Font large')).catch(e=>addLog(e.message))}>Font Large</Btn>
              <Btn sm color="amber" onClick={()=>ft.android.a11y.talkback({serial,enable:true}).then(()=>addLog('TalkBack ON')).catch(e=>addLog(e.message))}>TalkBack ON</Btn>
            </div>
          </Card>
        </div>
      )}

      {tab==='settings' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <div style={{display:'flex',gap:6}}>
            {['global','system','secure'].map(ns=><button key={ns} onClick={()=>setSettingsNs(ns)} style={{padding:'5px 12px',borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',background:settingsNs===ns?'var(--accent)':'var(--bg2)',color:settingsNs===ns?'#000':'var(--text3)',border:'none'}}>{ns}</button>)}
          </div>
          <div style={{display:'flex',gap:8}}>
            <input value={settingsKey} onChange={e=>setSettingsKey(e.target.value)} placeholder="Key" style={{flex:1,fontFamily:'monospace',fontSize:11}} />
            <input value={settingsVal} onChange={e=>setSettingsVal(e.target.value)} placeholder="Value (for set)" style={{flex:1,fontFamily:'monospace',fontSize:11}} />
            <Btn sm color="blue" onClick={()=>run(()=>ft.android.settings.get({serial,namespace:settingsNs,key:settingsKey}))}>Get</Btn>
            <Btn sm color="accent" onClick={()=>run(()=>ft.android.settings.set({serial,namespace:settingsNs,key:settingsKey,value:settingsVal}))}>Set</Btn>
          </div>
          <Btn color="green" onClick={()=>ft.android.settings.list({serial,namespace:settingsNs}).then(r=>{setSettingsList(r.settings||[]);addLog(`${r.settings?.length||0} settings`)}).catch(e=>addLog(e.message))}>List All {settingsNs} Settings</Btn>
          {settingsList.slice(0,50).map((s,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'4px 6px',background:'var(--bg1)',borderRadius:5,fontSize:11,borderBottom:'1px solid var(--border)',cursor:'pointer'}} onClick={()=>{setSettingsKey(s.key);setSettingsVal(s.value)}}><span style={{color:'var(--accent)',fontFamily:'monospace'}}>{s.key}</span><span style={{color:'var(--text3)',fontFamily:'monospace',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'60%'}}>{s.value}</span></div>)}
          <Out text={output} />
        </div>
      )}

      {tab==='packages' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <div style={{display:'flex',gap:8}}>
            <input value={pkgId} onChange={e=>setPkgId(e.target.value)} placeholder="com.example.app" style={{flex:1,fontFamily:'monospace',fontSize:11}} />
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <Btn sm color="red" onClick={()=>ft.android.pm.disable({serial,packageId:pkgId}).then(r=>addLog(r.success?'Disabled':'Error: '+r.output)).catch(e=>addLog(e.message))}>Disable</Btn>
            <Btn sm color="green" onClick={()=>ft.android.pm.enable({serial,packageId:pkgId}).then(r=>addLog(r.success?'Enabled':'Error: '+r.output)).catch(e=>addLog(e.message))}>Enable</Btn>
            <Btn sm color="amber" onClick={()=>ft.android.pm.clearData({serial,packageId:pkgId}).then(r=>addLog(r.success?'Data cleared':'Error: '+r.output)).catch(e=>addLog(e.message))}>Clear Data</Btn>
            <Btn sm color="red" onClick={()=>ft.android.pm.forceStop({serial,packageId:pkgId}).then(()=>addLog('Force stopped')).catch(e=>addLog(e.message))}>Force Stop</Btn>
            <Btn sm color="purple" onClick={()=>ft.android.pm.grantAll({serial,packageId:pkgId}).then(r=>addLog(`Granted ${r.results?.filter(x=>x.ok).length||0} permissions`)).catch(e=>addLog(e.message))}>Grant All Perms</Btn>
            <Btn sm color="blue" onClick={()=>ft.android.apk.pull({serial,packageId:pkgId}).then(r=>addLog(r.success?'Saved: '+r.path:'Error: '+r.error)).catch(e=>addLog(e.message))}>Pull APK</Btn>
          </div>
          <Out text={output} />
        </div>
      )}

      {tab==='sensors' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <Btn color="blue" onClick={()=>run(()=>ft.android.info.sensors({serial}))}>List All Sensors</Btn>
          <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
            {tempData.map((t,i)=><div key={i} style={{padding:'6px 12px',borderRadius:7,background:t.temp>80?'rgba(248,113,113,0.2)':t.temp>60?'rgba(245,158,11,0.2)':'rgba(74,222,128,0.15)',border:`1px solid ${t.temp>80?'rgba(248,113,113,0.3)':t.temp>60?'rgba(245,158,11,0.3)':'rgba(74,222,128,0.2)'}`,color:t.temp>80?'#f87171':t.temp>60?'#f59e0b':'#4ade80',fontFamily:'monospace',fontSize:12}}>Zone {t.zone}: {typeof t.temp==='number'?t.temp.toFixed(1):t.temp}°C</div>)}
          </div>
          {!tempData.length&&<Btn color="red" onClick={()=>ft.android.info.cpuTemp({serial}).then(r=>{if(r.temps)setTempData(r.temps)}).catch(e=>addLog(e.message))}>Read CPU Temps</Btn>}
          <Out text={output} />
        </div>
      )}

      {tab==='bluetooth' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <Btn color="blue" onClick={()=>ft.android.bluetooth.status({serial}).then(r=>setBtOn(r.enabled)).catch(e=>addLog(e.message))}>Check Status</Btn>
            <Btn color="green" onClick={()=>ft.android.bluetooth.scan({serial}).then(r=>{setBtDevices(r.devices||[]);addLog(`${r.devices?.length||0} device(s) found`);if(r.note)addLog(r.note)}).catch(e=>addLog(e.message))}>Scan Devices</Btn>
          </div>
          {btOn!==null && <div style={{fontSize:12,color:btOn?'#4ade80':'#f87171'}}>Bluetooth is {btOn?'ON':'OFF'}</div>}
          <div style={{display:'flex',flexDirection:'column',gap:4}}>
            {btDevices.map((d,i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 10px',background:'var(--bg1)',borderRadius:7,border:'1px solid var(--border)',fontSize:12}}>
                <span style={{color:'var(--text)',fontWeight:600}}>{d.name}</span>
                <span style={{color:'var(--text3)',fontFamily:'monospace',fontSize:11}}>{d.address}</span>
              </div>
            ))}
            {!btDevices.length && <div style={{textAlign:'center',padding:16,color:'var(--text3)',fontSize:12}}>No scan run yet</div>}
          </div>
        </div>
      )}

      {tab==='integrity' && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <Card title="SAFETYNET / PLAY INTEGRITY PREDICTION" color="#a78bfa">
            <div style={{fontSize:12,color:'var(--text2)',lineHeight:1.7,marginBottom:10}}>Checks local red flags (root, unlocked bootloader, test-keys) that predict whether Play Integrity attestation would pass. This is a local prediction, not a real server-verified verdict.</div>
            <Btn color="purple" onClick={()=>ft.android.integrity.check({serial}).then(setIntegrityResult).catch(e=>addLog(e.message))}>Run Local Check</Btn>
            {integrityResult && (
              <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:6}}>
                <Row label="Root binary found" value={integrityResult.rootBinaryFound?'YES':'No'} color={integrityResult.rootBinaryFound?'#f87171':'#4ade80'} />
                <Row label="Bootloader locked" value={integrityResult.bootloaderLocked?'Yes':'NO'} color={integrityResult.bootloaderLocked?'#4ade80':'#f87171'} />
                <Row label="Build tags" value={integrityResult.buildTags} mono />
                <Row label="Prediction" value={integrityResult.likelyToPassIntegrity?'Likely PASS':'Likely FAIL'} color={integrityResult.likelyToPassIntegrity?'#4ade80':'#f87171'} />
                <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>{integrityResult.note}</div>
              </div>
            )}
          </Card>
          <Card title="BATTERY HEALTH" color="#4ade80">
            <div style={{fontSize:12,color:'var(--text2)',lineHeight:1.7,marginBottom:10}}>Charge cycle wear estimate, where the device exposes it.</div>
            <Btn color="green" onClick={()=>ft.android.battery.health({serial}).then(setBatteryHealth).catch(e=>addLog(e.message))}>Check Battery Health</Btn>
            {batteryHealth && (
              <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:6}}>
                <Row label="Health status" value={batteryHealth.health} />
                <Row label="Estimated wear" value={batteryHealth.wearPercent!==null?`${batteryHealth.wearPercent}%`:'Not available'} color={batteryHealth.wearPercent>20?'#f59e0b':'#4ade80'} />
                {batteryHealth.note && <div style={{fontSize:11,color:'var(--text3)'}}>{batteryHealth.note}</div>}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
