import { useState, useEffect } from 'react'
const ft = window.ft
const PRESETS = [
  { name:'Cloudflare',    host:'one.one.one.one',                color:'#f59e0b', desc:'Fast, privacy-first DNS',            icon:'CF' },
  { name:'Cloudflare +', host:'security.cloudflare-dns.com',    color:'#f59e0b', desc:'Cloudflare with malware blocking',    icon:'CF' },
  { name:'AdGuard',       host:'dns.adguard-dns.com',           color:'#4ade80', desc:'DNS-level ad and tracker blocking',   icon:'AG' },
  { name:'AdGuard Fam',   host:'family.adguard-dns.com',        color:'#4ade80', desc:'Ad block + adult content filter',     icon:'AG' },
  { name:'NextDNS',       host:'dns.nextdns.io',                color:'#60a5fa', desc:'Configurable DNS with analytics',     icon:'ND' },
  { name:'Google',        host:'dns.google',                    color:'#a78bfa', desc:'Google Public DNS',                   icon:'GG' },
  { name:'Quad9',         host:'dns.quad9.net',                 color:'#fb923c', desc:'Security-focused, threat blocking',   icon:'Q9' },
  { name:'OpenDNS',       host:'doh.opendns.com',               color:'#06b6d4', desc:'Cisco OpenDNS Family Shield',         icon:'OD' },
  { name:'Mullvad',       host:'dns.mullvad.net',               color:'#f87171', desc:'No-log, ad-blocking by Mullvad VPN',  icon:'MV' },
  { name:'Off',           host:'',                              color:'#888',    desc:'Use default carrier/DHCP DNS',        icon:'--' },
]

export default function DNSChanger({ device, addLog }) {
  const [current, setCurrent] = useState(null)
  const [custom, setCustom] = useState('')
  const [loading, setLoading] = useState(null)
  const serial = device?.serial

  useEffect(() => { if (serial) fetchCurrent() }, [serial])

  const fetchCurrent = async () => {
    const r = await ft.dns.get({ serial }).catch(() => null)
    if (r) setCurrent(r)
  }

  const setDns = async (preset) => {
    if (!serial) return addLog('Connect an Android device')
    setLoading(preset.name)
    let r
    if (!preset.host) r = await ft.dns.set({ serial, mode:'off' }).catch(e => ({ error:e.message }))
    else r = await ft.dns.set({ serial, mode:'hostname', provider:preset.host }).catch(e => ({ error:e.message }))
    addLog(r.success ? `DNS set to ${preset.name} (${preset.host || 'off'})` : 'Error: ' + r.error)
    await fetchCurrent()
    setLoading(null)
  }

  const setCustomDns = async () => {
    if (!custom.trim()) return
    await setDns({ name:'Custom', host:custom.trim() })
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>DNS Changer</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Set private DNS with ad-blocking, security, and privacy presets</div>
        </div>
      </div>

      {current && (
        <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>CURRENT DNS</div>
          <div style={{ display:'flex', gap:20, fontSize:13 }}>
            <div><span style={{ color:'var(--text3)' }}>Mode: </span><span style={{ color:'var(--accent)', fontWeight:600 }}>{current.mode || 'default'}</span></div>
            <div><span style={{ color:'var(--text3)' }}>Provider: </span><span style={{ color:'var(--text2)', fontFamily:'monospace' }}>{current.provider || 'none'}</span></div>
          </div>
          <div style={{ marginTop:6, fontSize:11, color:'var(--text3)' }}>Note: Private DNS changes take effect immediately on Android 9+. May need WiFi reconnect on older devices.</div>
        </div>
      )}

      {!serial && <div style={{ padding:14, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b' }}>Connect an Android device (Android 9+) to change DNS.</div>}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
        {PRESETS.map(p => {
          const isActive = current?.provider === p.host || (!p.host && current?.mode === 'off')
          return (
            <button key={p.name} onClick={() => setDns(p)} disabled={loading === p.name || !serial}
              style={{ padding:'12px 14px', borderRadius:10, cursor:!serial?'not-allowed':'pointer', textAlign:'left', background: isActive ? `${p.color}22` : 'var(--bg1)', border:`1px solid ${isActive ? p.color : 'var(--border)'}`, opacity:!serial?0.5:1, transition:'all 0.15s' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <div style={{ width:28, height:28, borderRadius:6, background:`${p.color}33`, color:p.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700 }}>{p.icon}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color: isActive ? p.color : 'var(--text)' }}>{p.name}</div>
                  {isActive && <div style={{ fontSize:9, color:p.color, fontWeight:700 }}>ACTIVE</div>}
                </div>
                {loading === p.name && <div style={{ width:12, height:12, borderRadius:'50%', border:'2px solid var(--text3)', borderTopColor:'var(--accent)', animation:'spin 1s linear infinite' }} />}
              </div>
              <div style={{ fontSize:11, color:'var(--text3)' }}>{p.desc}</div>
              {p.host && <div style={{ fontSize:9, fontFamily:'monospace', color:'var(--text3)', marginTop:3 }}>{p.host}</div>}
            </button>
          )
        })}
      </div>

      <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>CUSTOM DNS HOSTNAME</div>
        <div style={{ display:'flex', gap:8 }}>
          <input value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => e.key==='Enter' && setCustomDns()}
            placeholder="e.g. your-profile.dns.nextdns.io" style={{ flex:1, fontFamily:'monospace', fontSize:12 }} />
          <button onClick={setCustomDns} disabled={!serial||!custom.trim()} style={{ padding:'8px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>Set</button>
        </div>
        <div style={{ fontSize:11, color:'var(--text3)', marginTop:6 }}>Enter any private DNS hostname (RFC 7858 DoT compatible)</div>
      </div>
    </div>
  )
}
