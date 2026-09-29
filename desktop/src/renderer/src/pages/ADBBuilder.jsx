import { useState, useEffect, useRef } from 'react'
const ft = window.ft

const COMMAND_LIBRARY = [
  { cat:'Device Info', cmds:[
    { label:'Device info',      cmd:'shell getprop ro.product.model', desc:'Get device model name' },
    { label:'Android version',  cmd:'shell getprop ro.build.version.release', desc:'Current Android version' },
    { label:'All props',        cmd:'shell getprop', desc:'Dump all system properties' },
    { label:'Serial number',    cmd:'shell getprop ro.serialno', desc:'Device serial number' },
    { label:'CPU info',         cmd:'shell cat /proc/cpuinfo', desc:'Processor details' },
    { label:'Memory info',      cmd:'shell cat /proc/meminfo', desc:'RAM usage breakdown' },
    { label:'Storage info',     cmd:'shell df -h', desc:'Disk usage by partition' },
    { label:'Battery',          cmd:'shell dumpsys battery', desc:'Full battery status' },
    { label:'Display info',     cmd:'shell wm size && wm density', desc:'Screen resolution and DPI' },
    { label:'Uptime',           cmd:'shell cat /proc/uptime', desc:'Time since last boot' },
    { label:'Kernel version',   cmd:'shell uname -a', desc:'Linux kernel version' },
    { label:'SELinux status',   cmd:'shell getenforce', desc:'SELinux enforcing/permissive' },
    { label:'Root check',       cmd:'shell id', desc:'Check if running as root' },
  ]},
  { cat:'Apps', cmds:[
    { label:'List all apps',    cmd:'shell pm list packages', desc:'All installed package names' },
    { label:'List 3rd party',   cmd:'shell pm list packages -3', desc:'User-installed apps only' },
    { label:'List system apps', cmd:'shell pm list packages -s', desc:'System apps only' },
    { label:'App info',         cmd:'shell dumpsys package com.example.app', desc:'Replace with bundle ID' },
    { label:'Force stop',       cmd:'shell am force-stop com.example.app', desc:'Kill app process' },
    { label:'Clear data',       cmd:'shell pm clear com.example.app', desc:'Wipe app data' },
    { label:'Uninstall',        cmd:'shell pm uninstall -k com.example.app', desc:'Remove app (keep data)' },
    { label:'Disable app',      cmd:'shell pm disable-user com.example.app', desc:'Disable without uninstall' },
    { label:'Enable app',       cmd:'shell pm enable com.example.app', desc:'Re-enable disabled app' },
    { label:'Top processes',    cmd:'shell top -n 1 -b | head -20', desc:'CPU usage by process' },
    { label:'Running services', cmd:'shell dumpsys activity services', desc:'Active Android services' },
  ]},
  { cat:'Network', cmds:[
    { label:'IP address',       cmd:'shell ip addr show wlan0', desc:'WiFi IP address' },
    { label:'WiFi info',        cmd:'shell dumpsys wifi | grep "mWifiInfo"', desc:'Connected network details' },
    { label:'All interfaces',   cmd:'shell ip link show', desc:'All network interfaces' },
    { label:'DNS servers',      cmd:'shell getprop net.dns1 && getprop net.dns2', desc:'Current DNS servers' },
    { label:'Network stats',    cmd:'shell cat /proc/net/dev', desc:'Data usage per interface' },
    { label:'Open ports',       cmd:'shell netstat -tlnp 2>/dev/null || ss -tlnp', desc:'Listening network ports' },
    { label:'Ping Google',      cmd:'shell ping -c 4 8.8.8.8', desc:'Internet connectivity test' },
    { label:'Route table',      cmd:'shell ip route', desc:'Network routing table' },
  ]},
  { cat:'Files', cmds:[
    { label:'List sdcard',      cmd:'shell ls -la /sdcard/', desc:'Files on internal storage' },
    { label:'Find large files', cmd:'shell find /sdcard -size +100M 2>/dev/null', desc:'Files over 100MB' },
    { label:'Disk usage',       cmd:'shell du -sh /sdcard/* 2>/dev/null', desc:'Folder sizes on sdcard' },
    { label:'Download folder',  cmd:'shell ls -la /sdcard/Download/', desc:'Downloads directory' },
  ]},
  { cat:'System Control', cmds:[
    { label:'Reboot',           cmd:'reboot', desc:'Reboot device' },
    { label:'Reboot recovery',  cmd:'reboot recovery', desc:'Boot into recovery' },
    { label:'Reboot fastboot',  cmd:'reboot bootloader', desc:'Boot into fastboot/bootloader' },
    { label:'Screenshot',       cmd:'shell screencap -p /sdcard/screen.png', desc:'Take screenshot (saves to device)' },
    { label:'Screen record',    cmd:'shell screenrecord /sdcard/recording.mp4', desc:'Record screen (press Ctrl+C to stop)' },
    { label:'Input text',       cmd:'shell input text "Hello World"', desc:'Type text on screen' },
    { label:'Tap screen',       cmd:'shell input tap 500 800', desc:'Tap at X=500 Y=800 coordinates' },
    { label:'Swipe',            cmd:'shell input swipe 100 800 100 200', desc:'Swipe from bottom to top' },
    { label:'Volume up',        cmd:'shell input keyevent 24', desc:'Press volume up button' },
    { label:'Volume down',      cmd:'shell input keyevent 25', desc:'Press volume down button' },
    { label:'Back button',      cmd:'shell input keyevent 4', desc:'Press back key' },
    { label:'Home button',      cmd:'shell input keyevent 3', desc:'Press home key' },
    { label:'Power button',     cmd:'shell input keyevent 26', desc:'Press power button' },
    { label:'Unlock screen',    cmd:'shell input keyevent 82', desc:'Swipe to unlock' },
  ]},
  { cat:'Debugging', cmds:[
    { label:'Logcat',           cmd:'logcat -d | tail -100', desc:'Last 100 log lines' },
    { label:'Crash logs',       cmd:'shell logcat -d *:E | tail -50', desc:'Error logs only' },
    { label:'ANR traces',       cmd:'shell cat /data/anr/traces.txt 2>/dev/null | head -100', desc:'App not responding traces' },
    { label:'Bugreport',        cmd:'bugreport', desc:'Full system bug report (slow)' },
    { label:'CPU governor',     cmd:'shell cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', desc:'Current CPU governor' },
    { label:'Thermal info',     cmd:'shell cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null', desc:'Temperature sensors' },
  ]},
  { cat:'Permissions', cmds:[
    { label:'Grant permission', cmd:'shell pm grant com.example.app android.permission.READ_CONTACTS', desc:'Grant a permission to app' },
    { label:'Revoke permission',cmd:'shell pm revoke com.example.app android.permission.READ_CONTACTS', desc:'Remove a permission from app' },
    { label:'App permissions',  cmd:'shell dumpsys package com.example.app | grep permission', desc:'All permissions of an app' },
  ]},
]

export default function ADBBuilder({ device, addLog }) {
  const [cmd, setCmd] = useState('')
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState([])
  const [histIdx, setHistIdx] = useState(-1)
  const [catFilter, setCatFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('builder')
  const outRef = useRef(null)
  const serial = device?.serial

  const run = async (command) => {
    const c = command || cmd
    if (!c.trim()) return
    if (!serial) return addLog('Connect an Android device first')
    setRunning(true)
    setOutput('')
    const args = c.trim().split(/\s+/)
    const r = await ft.adbBuilder.run({ serial, args }).catch(e => ({ error: e.message, output: e.message }))
    const out = r.output || r.error || 'No output'
    setOutput(out)
    setHistory(prev => [c, ...prev.filter(h => h !== c)].slice(0, 50))
    setHistIdx(-1)
    setRunning(false)
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run() }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = Math.min(histIdx + 1, history.length - 1)
      setHistIdx(idx); setCmd(history[idx] || '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const idx = Math.max(histIdx - 1, -1)
      setHistIdx(idx); setCmd(idx === -1 ? '' : history[idx])
    }
  }

  const cats = ['All', ...COMMAND_LIBRARY.map(c => c.cat)]
  const visLib = COMMAND_LIBRARY
    .filter(c => catFilter === 'All' || c.cat === catFilter)
    .map(c => ({ ...c, cmds: c.cmds.filter(cmd => !search || cmd.label.toLowerCase().includes(search.toLowerCase()) || cmd.cmd.toLowerCase().includes(search.toLowerCase())) }))
    .filter(c => c.cmds.length > 0)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}>  </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>ADB Command Builder</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Build, run and save ADB commands with autocomplete library</div>
        </div>
        {serial && <div style={{ fontSize:11, padding:'4px 10px', background:'rgba(74,222,128,0.15)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:6, color:'#4ade80' }}>{device.model || serial}</div>}
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3 }}>
        {[['builder','Command'],['library','Library'],['history','History']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'7px 4px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{label}</button>
        ))}
      </div>

      {tab === 'builder' && (
        <>
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:11, color:'var(--text3)', marginBottom:6 }}>ADB command (without "adb" prefix) -- Up/Down arrow for history</div>
            <div style={{ display:'flex', gap:8 }}>
              <input value={cmd} onChange={e => setCmd(e.target.value)} onKeyDown={onKey}
                placeholder="shell getprop ro.product.model"
                style={{ flex:1, fontFamily:'monospace', fontSize:13 }} />
              <button onClick={() => run()} disabled={running || !serial || !cmd.trim()}
                style={{ padding:'8px 18px', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
                {running ? 'Running...' : 'Run'}
              </button>
              <button onClick={() => setOutput('')} style={{ padding:'8px 10px', borderRadius:7, fontSize:12, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Clear</button>
            </div>
          </div>

          {output && (
            <div ref={outRef} style={{ fontFamily:'monospace', fontSize:11, background:'#0a0a0a', border:'1px solid var(--border)', borderRadius:8, padding:12, maxHeight:300, overflowY:'auto', color:'#d4d4d4', lineHeight:1.7, whiteSpace:'pre-wrap', wordBreak:'break-all' }}>
              {output}
            </div>
          )}

          {!serial && <div style={{ padding:12, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:12, color:'#f59e0b' }}>Connect an Android device to run commands.</div>}
        </>
      )}

      {tab === 'library' && (
        <>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search commands..." style={{ flex:1, minWidth:120 }} />
            <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
              {cats.map(c => (
                <button key={c} onClick={() => setCatFilter(c)} style={{ padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:catFilter===c?'var(--accent-dim)':'var(--bg2)', color:catFilter===c?'var(--accent)':'var(--text3)', border:`1px solid ${catFilter===c?'var(--accent-border)':'var(--border)'}` }}>{c}</button>
              ))}
            </div>
          </div>
          {visLib.map((cat, i) => (
            <div key={i}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', letterSpacing:'0.06em', marginBottom:6 }}>{cat.cat}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {cat.cmds.map((c, j) => (
                  <div key={j} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--bg1)', borderRadius:7, border:'1px solid var(--border)', cursor:'pointer' }}
                    onClick={() => { setCmd(c.cmd); setTab('builder') }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'var(--text)', marginBottom:2 }}>{c.label}</div>
                      <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--accent)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>adb {c.cmd}</div>
                      <div style={{ fontSize:10, color:'var(--text3)' }}>{c.desc}</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); setCmd(c.cmd); run(c.cmd) }}
                      style={{ padding:'4px 10px', borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', flexShrink:0 }}>
                      Run
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === 'history' && (
        <div>
          {!history.length && <div style={{ textAlign:'center', padding:30, color:'var(--text3)' }}>No commands run yet</div>}
          {history.map((h, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--bg1)', borderRadius:7, border:'1px solid var(--border)', marginBottom:4 }}>
              <span style={{ fontFamily:'monospace', fontSize:12, color:'var(--text2)', flex:1 }}>adb {h}</span>
              <button onClick={() => { setCmd(h); setTab('builder') }} style={{ padding:'4px 8px', borderRadius:5, fontSize:10, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)', flexShrink:0 }}>Use</button>
              <button onClick={() => { setCmd(h); run(h) }} style={{ padding:'4px 8px', borderRadius:5, fontSize:10, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', flexShrink:0 }}>Run</button>
            </div>
          ))}
          {history.length > 0 && <button onClick={() => setHistory([])} style={{ marginTop:8, padding:'6px 14px', borderRadius:6, fontSize:11, cursor:'pointer', background:'rgba(248,113,113,0.15)', color:'#f87171', border:'1px solid rgba(248,113,113,0.3)' }}>Clear History</button>}
        </div>
      )}
    </div>
  )
}
