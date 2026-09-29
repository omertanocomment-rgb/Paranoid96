import { useState, useEffect, useRef, useCallback } from 'react'

const ft = window.ft

// ANSI color parser - converts ANSI escape codes to styled spans
function parseAnsi(text) {
  const ANSI_COLORS = {
    30:'#555', 31:'#f87171', 32:'#4ade80', 33:'#fbbf24',
    34:'#60a5fa', 35:'#c084fc', 36:'#34d399', 37:'#e5e7eb',
    90:'#777', 91:'#ff6b6b', 92:'#6bff6b', 93:'#ffff6b',
    94:'#6b6bff', 95:'#ff6bff', 96:'#6bffff', 97:'#fff',
  }
  const parts = []
  let i = 0
  let currentStyle = {}
  let buf = ''

  while (i < text.length) {
    if (text[i] === '\x1b' && text[i+1] === '[') {
      if (buf) parts.push({ text: buf, style: { ...currentStyle } })
      buf = ''
      i += 2
      let seq = ''
      while (i < text.length && text[i] !== 'm') { seq += text[i++] }
      i++ // skip 'm'
      const codes = seq.split(';').map(Number)
      for (const code of codes) {
        if (code === 0) currentStyle = {}
        else if (code === 1) currentStyle.fontWeight = '700'
        else if (code === 3) currentStyle.fontStyle = 'italic'
        else if (code === 4) currentStyle.textDecoration = 'underline'
        else if (ANSI_COLORS[code]) currentStyle.color = ANSI_COLORS[code]
        else if (code >= 40 && code <= 47) currentStyle.background = ANSI_COLORS[code-10]
      }
    } else {
      buf += text[i++]
    }
  }
  if (buf) parts.push({ text: buf, style: { ...currentStyle } })
  return parts
}

function TermLine({ text }) {
  const parts = parseAnsi(text)
  return (
    <span>
      {parts.map((p, i) => (
        <span key={i} style={p.style}>{p.text}</span>
      ))}
    </span>
  )
}

function TermTab({ id, title, active, onSelect, onClose }) {
  return (
    <div onClick={onSelect} style={{
      display:'flex', alignItems:'center', gap:6, padding:'5px 12px',
      background: active ? 'var(--bg2)' : 'var(--bg)',
      borderRight:'1px solid var(--border)',
      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
      cursor:'pointer', fontSize:12, color: active ? 'var(--text)' : 'var(--text3)',
      userSelect:'none', minWidth:80, flexShrink:0,
    }}>
      <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{title}</span>
      <span onClick={e => { e.stopPropagation(); onClose() }}
        style={{ fontSize:14, color:'var(--text3)', lineHeight:1, padding:'0 2px', borderRadius:3 }}
        onMouseEnter={e => e.target.style.color='var(--red)'}
        onMouseLeave={e => e.target.style.color='var(--text3)'}
      >x</span>
    </div>
  )
}


const CMD_LIST = [
  { cat:'ADB - Device Info', cmds:[
    ['adb devices','List all connected devices'],
    ['adb shell getprop ro.product.model','Device model name'],
    ['adb shell getprop ro.build.version.release','Android version'],
    ['adb shell getprop ro.build.version.sdk','SDK/API level'],
    ['adb shell getprop ro.serialno','Serial number'],
    ['adb shell getprop ro.product.brand','Brand name'],
    ['adb shell cat /proc/cpuinfo','CPU details'],
    ['adb shell cat /proc/meminfo','Memory details'],
    ['adb shell df -h','Disk usage'],
    ['adb shell uptime','System uptime'],
    ['adb shell dumpsys battery','Battery full status'],
    ['adb shell wm size','Screen resolution'],
    ['adb shell wm density','Screen density (DPI)'],
    ['adb shell settings get global airplane_mode_on','Airplane mode state'],
  ]},
  { cat:'ADB - App Management', cmds:[
    ['adb shell pm list packages','All installed apps'],
    ['adb shell pm list packages -3','Third-party apps only'],
    ['adb shell pm list packages -s','System apps only'],
    ['adb shell pm list packages -d','Disabled apps'],
    ['adb shell pm disable-user --user 0 <pkg>','Disable an app'],
    ['adb shell pm enable <pkg>','Enable a disabled app'],
    ['adb shell pm clear <pkg>','Clear app data'],
    ['adb shell pm uninstall -k --user 0 <pkg>','Remove app (keep data)'],
    ['adb shell am force-stop <pkg>','Force stop an app'],
    ['adb shell am start -n <pkg>/<activity>','Launch specific activity'],
    ['adb install -r app.apk','Install APK (replace)'],
    ['adb install -r -d app.apk','Install older version (downgrade)'],
    ['adb shell monkey -p <pkg> 1','Launch app via monkey'],
    ['adb shell dumpsys package <pkg>','Full package details'],
  ]},
  { cat:'ADB - Files', cmds:[
    ['adb push file.txt /sdcard/','Copy file to device'],
    ['adb pull /sdcard/file.txt .','Copy file from device'],
    ['adb sync','Sync local build to device'],
    ['adb shell ls -la /sdcard/','List storage contents'],
    ['adb shell find /sdcard -name "*.jpg"','Find files by name'],
    ['adb shell du -sh /sdcard/*','Folder sizes'],
    ['adb shell rm -rf /sdcard/folder/','Delete folder'],
    ['adb shell mkdir /sdcard/newfolder','Create directory'],
    ['adb shell cat /sdcard/file.txt','Print file contents'],
    ['adb shell cp /sdcard/a.txt /sdcard/b.txt','Copy file on device'],
  ]},
  { cat:'ADB - Network', cmds:[
    ['adb shell ip addr show wlan0','WiFi IP address'],
    ['adb shell ip route','Routing table'],
    ['adb shell netstat -tlnp','Open ports'],
    ['adb shell ping -c 4 8.8.8.8','Ping test'],
    ['adb shell curl -I https://google.com','HTTP request'],
    ['adb shell getprop net.dns1','Primary DNS'],
    ['adb shell settings get global private_dns_mode','Private DNS mode'],
    ['adb forward tcp:8080 tcp:8080','Forward PC port to device'],
    ['adb reverse tcp:8080 tcp:8080','Forward device port to PC'],
    ['adb shell dumpsys wifi | grep mWifiInfo','Connected WiFi info'],
  ]},
  { cat:'ADB - System Control', cmds:[
    ['adb reboot','Reboot device'],
    ['adb reboot recovery','Reboot to recovery'],
    ['adb reboot bootloader','Reboot to fastboot'],
    ['adb shell input keyevent 26','Power button'],
    ['adb shell input keyevent 3','Home button'],
    ['adb shell input keyevent 4','Back button'],
    ['adb shell input keyevent 24','Volume up'],
    ['adb shell input keyevent 25','Volume down'],
    ['adb shell input text "Hello"','Type text'],
    ['adb shell input tap 500 800','Tap at coordinates'],
    ['adb shell input swipe 300 800 300 200','Swipe gesture'],
    ['adb shell screencap -p /sdcard/ss.png','Screenshot'],
    ['adb shell screenrecord /sdcard/rec.mp4','Screen record (Ctrl+C to stop)'],
    ['adb shell settings put system screen_brightness 128','Set brightness (0-255)'],
    ['adb shell svc wifi enable','Enable WiFi'],
    ['adb shell svc wifi disable','Disable WiFi'],
    ['adb shell svc data enable','Enable mobile data'],
    ['adb shell svc data disable','Disable mobile data'],
  ]},
  { cat:'ADB - Debugging', cmds:[
    ['adb logcat','Stream all logs'],
    ['adb logcat -d *:E | tail -50','Error logs only (snapshot)'],
    ['adb logcat -c','Clear log buffer'],
    ['adb logcat -v time','Logs with timestamps'],
    ['adb bugreport','Full bug report'],
    ['adb shell dumpsys activity','Activity manager status'],
    ['adb shell dumpsys meminfo','Memory per process'],
    ['adb shell top -n 1 -b','CPU usage snapshot'],
    ['adb shell ps -ef','All running processes'],
    ['adb shell logcat -d > log.txt','Save log to PC file'],
  ]},
  { cat:'ADB - Permissions', cmds:[
    ['adb shell pm grant <pkg> android.permission.READ_CONTACTS','Grant contact permission'],
    ['adb shell pm revoke <pkg> android.permission.CAMERA','Revoke camera permission'],
    ['adb shell pm grant <pkg> android.permission.ACCESS_FINE_LOCATION','Grant location'],
    ['adb shell dumpsys package <pkg> | grep "granted=true"','Show granted permissions'],
    ['adb shell appops set <pkg> RUN_IN_BACKGROUND deny','Block background run'],
  ]},
  { cat:'Fastboot', cmds:[
    ['fastboot devices','List fastboot devices'],
    ['fastboot flash boot boot.img','Flash boot partition'],
    ['fastboot flash recovery recovery.img','Flash recovery'],
    ['fastboot flash system system.img','Flash system (wipes!)'],
    ['fastboot erase cache','Wipe cache partition'],
    ['fastboot erase userdata','Wipe all user data'],
    ['fastboot oem unlock','Unlock bootloader'],
    ['fastboot oem lock','Re-lock bootloader'],
    ['fastboot flashing unlock','Unlock (A/B devices)'],
    ['fastboot flashing lock','Lock (A/B devices)'],
    ['fastboot getvar all','Get all device variables'],
    ['fastboot getvar slot-count','Number of slots (A/B)'],
    ['fastboot getvar current-slot','Active slot (a or b)'],
    ['fastboot --set-active=a','Set slot A as active'],
    ['fastboot --set-active=b','Set slot B as active'],
    ['fastboot reboot','Reboot to system'],
    ['fastboot reboot recovery','Reboot to recovery'],
    ['fastboot reboot-bootloader','Stay in fastboot'],
    ['fastboot reboot fastboot','Reboot to fastbootd (dynamic)'],
    ['fastboot flash --slot all boot boot.img','Flash both A/B slots'],
  ]},
  { cat:'iOS - idevice Tools', cmds:[
    ['idevice_id -l','List connected iDevices (UDIDs)'],
    ['ideviceinfo -u <udid>','Full device info'],
    ['idevicepair pair','Pair/trust device'],
    ['idevicepair validate','Check pairing status'],
    ['ideviceinstaller -l','List installed apps'],
    ['ideviceinstaller -i app.ipa','Install IPA file'],
    ['ideviceinstaller -U <bundleId>','Uninstall app by bundle ID'],
    ['idevicebackup2 backup --full ./backup/','Full device backup'],
    ['idevicebackup2 restore ./backup/','Restore from backup'],
    ['idevicescreenshot screen.png','Take screenshot'],
    ['idevicesyslog','Stream device syslog'],
    ['idevicediagnostics restart','Restart device'],
    ['idevicediagnostics shutdown','Shutdown device'],
    ['idevicediagnostics sleep','Sleep device'],
    ['iproxy 2222 22','Forward SSH port over USB'],
  ]},
]

export function CommandList({ onInsert }) {
  const [cat, setCat] = useState('ADB - Device Info')
  const [search, setSearch] = useState('')
  const cats = CMD_LIST.map(c => c.cat)
  const visible = CMD_LIST
    .filter(c => !search || c.cat.toLowerCase().includes(search.toLowerCase()) || c.cmds.some(([cmd]) => cmd.toLowerCase().includes(search.toLowerCase())))
    .map(c => ({ ...c, cmds: search ? c.cmds.filter(([cmd,desc]) => cmd.toLowerCase().includes(search.toLowerCase()) || desc.toLowerCase().includes(search.toLowerCase())) : c.cmds }))
    .filter(c => c.cmds.length > 0)

  return (
    <div style={{ display:"flex", height:"100%", gap:0 }}>
      <div style={{ width:160, borderRight:"1px solid var(--border)", overflowY:"auto", flexShrink:0 }}>
        <div style={{ padding:"8px 10px" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." style={{ width:"100%", fontSize:11, padding:"4px 8px" }} />
        </div>
        {cats.map(c => (
          <button key={c} onClick={() => { setCat(c); setSearch('') }}
            style={{ width:"100%", padding:"7px 12px", textAlign:"left", fontSize:10, fontWeight:600, cursor:"pointer", background:cat===c&&!search?"var(--accent-dim)":"transparent", color:cat===c&&!search?"var(--accent)":"var(--text3)", border:"none", borderBottom:"1px solid var(--border)44" }}>
            {c}
          </button>
        ))}
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"8px 12px" }}>
        {(search ? visible : CMD_LIST.filter(c => c.cat === cat)).map((section, i) => (
          <div key={i}>
            {search && <div style={{ fontSize:10, fontWeight:700, color:"var(--text3)", marginBottom:6, marginTop:i>0?12:0 }}>{section.cat}</div>}
            {section.cmds.map(([cmd, desc], j) => (
              <div key={j} style={{ marginBottom:4, display:"flex", alignItems:"center", gap:8, padding:"6px 8px", background:"var(--bg2)", borderRadius:6, cursor:"pointer", border:"1px solid var(--border)" }}
                onClick={() => onInsert?.(cmd)}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"monospace", fontSize:11, color:"var(--accent)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{cmd}</div>
                  <div style={{ fontSize:10, color:"var(--text3)", marginTop:1 }}>{desc}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); onInsert?.(cmd) }} style={{ padding:"2px 8px", borderRadius:4, fontSize:9, cursor:"pointer", background:"var(--accent)", color:"#000", border:"none", flexShrink:0 }}>Use</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Terminal({ device, addLog }) {
  const [tabs, setTabs] = useState([])      // { id, title, shell, lines, input, history, histIdx }
  const [activeTab, setActiveTab] = useState(null)
  const [shells, setShells] = useState([])
  const [showNewMenu, setShowNewMenu] = useState(false)
  const outputRef = useRef(null)
  const inputRef = useRef(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  useEffect(() => {
    ft.terminal.listShells().then(setShells).catch(() => {})

    const rData = ft.on('terminal:data', ({ id, data }) => {
      setTabs(prev => prev.map(t => {
        if (t.id !== id) return t
        // Split into lines, preserving partial lines
        const newLines = (t.pending + data).split(String.fromCharCode(10))
        const pending = newLines.pop() // last element may be incomplete
        const fullLines = newLines.map(l => l.replace(/\r$/, ''))
        return { ...t, lines: [...t.lines, ...fullLines], pending }
      }))
      // Auto-scroll
      setTimeout(() => {
        if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
      }, 20)
    })

    const rExit = ft.on('terminal:exit', ({ id, code }) => {
      setTabs(prev => prev.map(t =>
        t.id === id ? { ...t, lines: [...t.lines, '', `[Process exited with code ${code}]`], dead: true } : t
      ))
    })

    return () => { rData(); rExit() }
  }, [])

  const createTab = useCallback(async (shellInfo) => {
    setShowNewMenu(false)
    let result
    if (shellInfo.id === 'adb') {
      if (!device?.serial) { addLog('Connect a device first'); return }
      result = await ft.terminal.adb({ serial: device.serial }).catch(e => ({ error: e.message }))
    } else {
      result = await ft.terminal.create({ shell: shellInfo.path }).catch(e => ({ error: e.message }))
    }
    if (result?.error) { addLog('Terminal: ' + result.error); return }

    const tab = {
      id: result.id,
      title: shellInfo.name,
      shell: shellInfo.id,
      lines: [],
      pending: '',
      input: '',
      history: [],
      histIdx: -1,
      dead: false,
    }
    setTabs(prev => [...prev, tab])
    setActiveTab(result.id)
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [device])

  const closeTab = useCallback((id) => {
    ft.terminal.kill({ id }).catch(() => {})
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (activeTab === id) setActiveTab(next[next.length - 1]?.id || null)
      return next
    })
  }, [activeTab])

  const sendInput = useCallback((id, line) => {
    ft.terminal.write({ id, data: line + '\n' }).catch(() => {})
    setTabs(prev => prev.map(t => {
      if (t.id !== id) return t
      const history = line.trim() ? [line, ...t.history.slice(0, 99)] : t.history
      return { ...t, input: '', history, histIdx: -1, lines: [...t.lines, '> ' + line] }
    }))
  }, [])

  const handleKey = useCallback((e, tab) => {
    if (e.key === 'Enter') {
      sendInput(tab.id, tab.input)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = Math.min(tab.histIdx + 1, tab.history.length - 1)
      setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, histIdx: idx, input: t.history[idx] || '' } : t))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const idx = Math.max(tab.histIdx - 1, -1)
      setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, histIdx: idx, input: idx === -1 ? '' : t.history[idx] } : t))
    } else if (e.key === 'c' && e.ctrlKey) {
      ft.terminal.write({ id: tab.id, data: '\x03' }).catch(() => {})
    } else if (e.key === 'l' && e.ctrlKey) {
      setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, lines: [] } : t))
    }
  }, [sendInput])

  const activeTabData = tabs.find(t => t.id === activeTab)

  const QUICK_CMDS = [
    { label: 'adb devices', cmd: 'adb devices' },
    { label: 'ipconfig', cmd: 'ipconfig' },
    { label: 'dir', cmd: 'dir' },
    { label: 'tasklist', cmd: 'tasklist | findstr electron' },
    { label: 'whoami', cmd: 'whoami' },
    { label: 'python --version', cmd: 'python --version' },
    { label: 'node --version', cmd: 'node --version' },
    { label: 'git log', cmd: 'git log --oneline -10' },
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)', overflow:'hidden' }}>
      {/* Tab bar */}
      <div style={{ display:'flex', alignItems:'stretch', background:'var(--bg)', borderBottom:'1px solid var(--border)', overflowX:'auto', flexShrink:0 }}>
        {tabs.map(tab => (
          <TermTab key={tab.id} id={tab.id} title={tab.title}
            active={activeTab === tab.id}
            onSelect={() => { setActiveTab(tab.id); setTimeout(() => inputRef.current?.focus(), 50) }}
            onClose={() => closeTab(tab.id)} />
        ))}

        {/* New tab button */}
        <div style={{ position:'relative', flexShrink:0 }}>
          <button onClick={() => setShowNewMenu(m => !m)}
            style={{ height:'100%', padding:'5px 14px', background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:18, lineHeight:1 }}
            title="New terminal">+</button>
          {showNewMenu && (
            <div style={{ position:'absolute', top:'100%', left:0, zIndex:100, background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:8, minWidth:180, boxShadow:'0 8px 24px rgba(0,0,0,0.4)', overflow:'hidden' }}>
              {shells.map(s => (
                <div key={s.id} onClick={() => createTab(s)}
                  style={{ padding:'9px 14px', cursor:'pointer', fontSize:12, display:'flex', gap:10, alignItems:'center', borderBottom:'1px solid var(--border)' }}
                  onMouseEnter={e => e.currentTarget.style.background='var(--bg3)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <span style={{ fontFamily:'monospace', fontWeight:700, color:'var(--accent)', width:30, flexShrink:0 }}>{s.icon}</span>
                  <span style={{ color:'var(--text)' }}>{s.name}</span>
                </div>
              ))}
              {device?.serial && (
                <div onClick={() => createTab({ id:'adb', name:`ADB: ${device.model||device.serial}`, path:'adb', icon:'ADB' })}
                  style={{ padding:'9px 14px', cursor:'pointer', fontSize:12, display:'flex', gap:10, alignItems:'center' }}
                  onMouseEnter={e => e.currentTarget.style.background='var(--bg3)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <span style={{ fontFamily:'monospace', fontWeight:700, color:'#4ade80', width:30, flexShrink:0 }}>ADB</span>
                  <span style={{ color:'var(--text)' }}>ADB Shell ({device.model || device.serial})</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ flex:1 }} onClick={() => setShowNewMenu(false)} />

        {/* Quick clear */}
        {activeTabData && (
          <button onClick={() => setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, lines: [] } : t))}
            style={{ padding:'5px 12px', background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:11 }}
            title="Clear (Ctrl+L)">Clear</button>
        )}
      </div>

      {/* Empty state */}
      {!tabs.length && (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16 }}>
          <div style={{ fontSize:40 }}>&#x276F;</div>
          <div style={{ fontSize:16, fontWeight:600, color:'var(--text)' }}>No terminal open</div>
          <div style={{ fontSize:13, color:'var(--text3)' }}>Click + to open a new terminal</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center', maxWidth:400 }}>
            {shells.slice(0,3).map(s => (
              <button key={s.id} onClick={() => createTab(s)}
                style={{ padding:'8px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)' }}>
                {s.name}
              </button>
            ))}
            {device?.serial && (
              <button onClick={() => createTab({ id:'adb', name:`ADB Shell`, path:'adb', icon:'ADB' })}
                style={{ padding:'8px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'rgba(74,222,128,0.15)', color:'#4ade80', border:'1px solid rgba(74,222,128,0.3)' }}>
                ADB Shell
              </button>
            )}
          </div>
        </div>
      )}

      {/* Terminal output */}
      {activeTabData && (
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }} onClick={() => { setShowNewMenu(false); inputRef.current?.focus() }}>
          <div ref={outputRef} style={{
            flex:1, overflowY:'auto', padding:'8px 12px', fontFamily:'var(--font-mono, monospace)',
            fontSize:12, lineHeight:1.6, color:'#d4d4d4', background:'#0d0d0d', cursor:'text',
          }}>
            {activeTabData.lines.map((line, i) => (
              <div key={i}>
                {line.startsWith('> ') ? (
                  <span><span style={{ color:'var(--accent)', fontWeight:700 }}>&gt; </span><span style={{ color:'#fff' }}>{line.slice(2)}</span></span>
                ) : line.startsWith('[Process exited') ? (
                  <span style={{ color:'#555', fontStyle:'italic' }}>{line}</span>
                ) : (
                  <TermLine text={line} />
                )}
              </div>
            ))}
            {activeTabData.pending && <span style={{ color:'#888' }}>{activeTabData.pending}</span>}
          </div>

          {/* Input row */}
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderTop:'1px solid var(--border)', background:'var(--bg1)', flexShrink:0 }}>
            <span style={{ color:'var(--accent)', fontFamily:'monospace', fontWeight:700, fontSize:13, flexShrink:0 }}>
              {activeTabData.shell === 'adb' ? '$' : activeTabData.shell === 'powershell' || activeTabData.shell === 'pwsh' ? 'PS>' : '>'}
            </span>
            <input
              ref={inputRef}
              value={activeTabData.input}
              onChange={e => setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, input: e.target.value } : t))}
              onKeyDown={e => handleKey(e, activeTabData)}
              disabled={activeTabData.dead}
              placeholder={activeTabData.dead ? 'Process exited' : 'Type a command...'}
              autoFocus
              style={{
                flex:1, background:'transparent', border:'none', outline:'none',
                fontFamily:'var(--font-mono, monospace)', fontSize:12, color:'#fff',
                caretColor:'var(--accent)', padding:0,
              }}
            />
            <span style={{ fontSize:10, color:'#333', flexShrink:0 }}>
              Enter=run  Ctrl+C=break  Ctrl+L=clear  Up/Down=history
            </span>
          </div>
        </div>
      )}

      {/* Quick command bar when terminal is open */}
      {activeTabData && !activeTabData.dead && (
        <div style={{ display:'flex', gap:4, padding:'4px 8px', borderTop:'1px solid var(--border)', background:'var(--bg)', overflowX:'auto', flexShrink:0 }}>
          {QUICK_CMDS.map((q, i) => (
            <button key={i} onClick={() => sendInput(activeTabData.id, q.cmd)}
              style={{ padding:'3px 10px', borderRadius:4, fontSize:10, cursor:'pointer', background:'var(--bg2)', color:'var(--text3)', border:'1px solid var(--border)', whiteSpace:'nowrap', flexShrink:0 }}>
              {q.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
