import { useState } from 'react'
const ft = window.ft

const DANGEROUS_PERMS = {
  'READ_CONTACTS':'Contacts','WRITE_CONTACTS':'Contacts','READ_CALL_LOG':'Call Log',
  'WRITE_CALL_LOG':'Call Log','CALL_PHONE':'Phone','READ_PHONE_STATE':'Phone',
  'SEND_SMS':'SMS','RECEIVE_SMS':'SMS','READ_SMS':'SMS','RECEIVE_MMS':'SMS',
  'ACCESS_FINE_LOCATION':'Location','ACCESS_COARSE_LOCATION':'Location',
  'ACCESS_BACKGROUND_LOCATION':'Location (Background)',
  'CAMERA':'Camera','RECORD_AUDIO':'Microphone',
  'READ_EXTERNAL_STORAGE':'Storage','WRITE_EXTERNAL_STORAGE':'Storage',
  'BODY_SENSORS':'Sensors','ACTIVITY_RECOGNITION':'Activity',
  'READ_CALENDAR':'Calendar','WRITE_CALENDAR':'Calendar',
  'PROCESS_OUTGOING_CALLS':'Phone','USE_BIOMETRIC':'Biometric',
  'USE_FINGERPRINT':'Fingerprint','BLUETOOTH_SCAN':'Bluetooth',
  'BLUETOOTH_CONNECT':'Bluetooth','NEARBY_WIFI_DEVICES':'WiFi',
}
const PERM_COLORS = {
  'Contacts':'#f87171','Call Log':'#f87171','Phone':'#f87171','SMS':'#f87171',
  'Location':'#f59e0b','Location (Background)':'#ef4444',
  'Camera':'#a78bfa','Microphone':'#a78bfa',
  'Storage':'#60a5fa','Sensors':'#4ade80','Activity':'#4ade80',
  'Calendar':'#fb923c','Biometric':'#f59e0b','Fingerprint':'#f59e0b',
  'Bluetooth':'#60a5fa','WiFi':'#60a5fa',
}

function PermBadge({ perm }) {
  const label = DANGEROUS_PERMS[perm] || perm.split('.').pop()
  const color = PERM_COLORS[label] || '#888'
  return <span style={{ display:'inline-block', padding:'2px 7px', borderRadius:4, fontSize:9, fontWeight:700, marginRight:3, marginBottom:3, background:color+'22', color:color, border:`1px solid ${color}44` }}>{label}</span>
}

export default function PermissionScanner({ device, addLog }) {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('dangerous')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('risk')
  const serial = device?.serial

  const scan = async () => {
    if (!serial) return addLog('Connect an Android device first')
    setLoading(true)
    setApps([])
    try {
      const list = await ft.apps.list({ serial }).catch(() => [])
      const detailed = []
      for (const app of list.slice(0, 200)) {
        const permsOut = await ft.adb.shell({ serial, cmd: `dumpsys package ${app.pkg} | grep -E "granted=true|permission\.android" | head -40` }).catch(() => '')
        const perms = [...new Set(permsOut.match(/android\.permission\.(\w+)/g)?.map(p => p.replace('android.permission.','')) || [])]
        const dangerous = perms.filter(p => DANGEROUS_PERMS[p])
        const riskScore = dangerous.length * 2 + (perms.includes('INTERNET') ? 1 : 0)
        if (dangerous.length > 0 || filter === 'all') {
          detailed.push({ ...app, perms, dangerous, riskScore })
        }
      }
      detailed.sort((a,b) => sortBy === 'risk' ? b.riskScore - a.riskScore : a.name?.localeCompare(b.name))
      setApps(detailed)
      addLog(`Scanned ${list.length} apps, ${detailed.length} with dangerous permissions`)
    } catch(e) { addLog('Scan error: ' + e.message) }
    setLoading(false)
  }

  const revokeAll = async (pkg) => {
    const app = apps.find(a => a.pkg === pkg)
    if (!app) return
    for (const perm of app.dangerous) {
      await ft.adb.shell({ serial, cmd: `pm revoke ${pkg} android.permission.${perm}` }).catch(() => {})
    }
    addLog(`Revoked ${app.dangerous.length} permissions from ${pkg}`)
    scan()
  }

  const filtered = apps.filter(a => !search || a.name?.toLowerCase().includes(search.toLowerCase()) || a.pkg?.toLowerCase().includes(search.toLowerCase()))

  const riskColor = score => score >= 8 ? '#f87171' : score >= 4 ? '#f59e0b' : '#4ade80'

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}>  </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Permission Scanner</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Audit app permissions and revoke dangerous access</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button onClick={scan} disabled={loading || !serial}
          style={{ padding:'8px 18px', borderRadius:8, fontSize:13, fontWeight:700, cursor:!serial||loading?'not-allowed':'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>
          {loading ? 'Scanning...' : 'Scan Permissions'}
        </button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter apps..." style={{ flex:1, minWidth:120 }} />
        {['dangerous','all'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding:'6px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:filter===f?'var(--accent-dim)':'var(--bg2)', color:filter===f?'var(--accent)':'var(--text3)', border:`1px solid ${filter===f?'var(--accent-border)':'var(--border)'}` }}>
            {f==='dangerous'?'Dangerous Only':'All Perms'}
          </button>
        ))}
        {['risk','name'].map(s => (
          <button key={s} onClick={() => setSortBy(s)} style={{ padding:'6px 10px', borderRadius:6, fontSize:11, cursor:'pointer', background:sortBy===s?'var(--accent-dim)':'var(--bg2)', color:sortBy===s?'var(--accent)':'var(--text3)', border:`1px solid ${sortBy===s?'var(--accent-border)':'var(--border)'}` }}>
            Sort: {s}
          </button>
        ))}
      </div>

      {!serial && <div style={{ padding:16, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>Connect an Android device to scan permissions.</div>}

      {loading && <div style={{ textAlign:'center', padding:30, color:'var(--text3)' }}>Scanning {apps.length} apps so far... (this takes 1-2 minutes)</div>}

      {apps.length > 0 && (
        <div style={{ fontSize:12, color:'var(--text3)', marginBottom:-4 }}>
          {filtered.length} apps   {filtered.reduce((s,a) => s+a.dangerous.length, 0)} total dangerous permissions
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {filtered.map((app, i) => (
          <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:9, padding:'10px 14px', borderLeft:`3px solid ${riskColor(app.riskScore)}` }}>
            <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{app.name || app.pkg}</span>
                  <span style={{ fontSize:10, padding:'1px 6px', borderRadius:4, fontWeight:700, background:riskColor(app.riskScore)+'22', color:riskColor(app.riskScore) }}>
                    Risk: {app.riskScore >= 8 ? 'HIGH' : app.riskScore >= 4 ? 'MED' : 'LOW'}
                  </span>
                </div>
                <div style={{ fontSize:10, color:'var(--text3)', fontFamily:'monospace', marginBottom:6 }}>{app.pkg}</div>
                <div>{app.dangerous.map((p,j) => <PermBadge key={j} perm={p} />)}</div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
                {app.dangerous.length > 0 && (
                  <button onClick={() => revokeAll(app.pkg)} style={{ padding:'5px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:'rgba(248,113,113,0.15)', color:'#f87171', border:'1px solid rgba(248,113,113,0.3)', whiteSpace:'nowrap' }}>
                    Revoke All
                  </button>
                )}
                <button onClick={() => ft.adb.shell({serial, cmd:`am force-stop ${app.pkg}`}).then(()=>addLog('Stopped: '+app.pkg)).catch(e=>addLog(e.message))}
                  style={{ padding:'5px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)', whiteSpace:'nowrap' }}>
                  Force Stop
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
