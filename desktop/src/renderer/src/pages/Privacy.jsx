import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner, TabBar, Tag } from './_shared.jsx'


export default function Privacy({ device, addLog }) {
  const [tab, setTab] = useState('perms')
  const [perms, setPerms] = useState([])
  const [trackers, setTrackers] = useState([])
  const [loading, setLoading] = useState(false)

  const serial = device?.serial || device?.udid

  useEffect(() => {
    if (tab === 'perms' && device) {
      setLoading(true)
      ft.privacy.permissions({ serial, type: device.deviceType }).then(setPerms).catch(() => {}).finally(() => setLoading(false))
    }
  }, [tab, device?.serial, device?.udid])

  const DNS_PRESETS = [
    { name: 'Cloudflare (fast)', hostname: 'one.one.one.one' },
    { name: 'AdGuard (blocks ads)', hostname: 'dns.adguard.com' },
    { name: 'NextDNS (configurable)', hostname: 'dns.nextdns.io' },
    { name: 'Google', hostname: 'dns.google' },
  ]

  const [applyingHosts, setApplyingHosts] = useState(null)

  const applyHosts = async (preset) => {
    if (!serial) return addLog('No device connected')
    setApplyingHosts(preset.name)
    try {
      const r = await ft.privacy.pushHosts({ serial, url: preset.url, name: preset.name })
      addLog(r.success ? `Applied ${preset.name}: ${r.domains} domains blocked` : 'Failed: ' + r.error)
    } catch (e) { addLog('Hosts: ' + e.message) }
    setApplyingHosts(null)
  }

  const HOSTS_PRESETS = [
    { name: 'StevenBlack Unified', url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts', note: '100k+ domains' },
    { name: 'AdAway', url: 'https://adaway.org/hosts.txt', note: 'Lightweight' },
    { name: 'OISD', url: 'https://hosts.oisd.nl', note: 'Comprehensive' },
  ]

  return (
    <PageWrap>
      <PageHeader title="Privacy Tools" icon=" " />
      <TabBar tabs={[['perms','Permissions'],['adblock','Ad Block'],['dns','DNS'],['trackers','Trackers']]} active={tab} onChange={setTab} />

      {tab === 'perms' && (
        <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:8 }}>
          {loading && <Empty icon="" text="Scanning permissions..." />}
          {!loading && !perms.length && <Empty icon=" " text="No dangerous permissions detected" sub="Scan only checks user-installed apps" />}
          {perms.map(a => (
            <div key={a.pkg} className="card">
              <div style={{ fontSize:12, fontFamily:'var(--mono)', color:'var(--text)', marginBottom:8 }}>{a.pkg}</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                {a.permissions.map(p => (
                  <span key={p} onClick={() => ft.privacy.revoke({ serial, pkg:a.pkg, permission:`android.permission.${p}` }).then(() => addLog(`Revoked ${p}`)).catch(e => addLog(e.message))}
                    style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'var(--red-dim)', color:'var(--red)', border:'1px solid rgba(248,113,113,0.2)', cursor:'pointer' }}
                    title="Click to revoke">{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'adblock' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>System-wide hosts file blocking</div>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:12 }}>Pushes a hosts file to /system/etc/hosts via ADB -- blocks ads in all apps.</div>
            {HOSTS_PRESETS.map(h => (
              <div key={h.name} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:500 }}>{h.name}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{h.note}</div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => applyHosts(h)} disabled={!!applyingHosts}>
                {applyingHosts === h.name ? 'Applying...' : 'Apply'}
              </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'dns' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {DNS_PRESETS.map(d => (
            <div key={d.name} className="card" style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:500 }}>{d.name}</div>
                <div style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--mono)' }}>{d.hostname}</div>
              </div>
              <button className="btn btn-blue btn-sm" onClick={() =>
                ft.privacy.setDns({ serial, dns1: d.hostname }).then(() => addLog('DNS set: ' + d.hostname)).catch(e => addLog(e.message))}>
                Apply
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'trackers' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <button className="btn btn-primary" style={{ width:'fit-content' }} onClick={() => {
            setLoading(true)
            ft.privacy.scanTrackers({ serial, type: device?.deviceType }).then(t => { setTrackers(t); addLog(`${t.length} trackers found`) }).catch(e => addLog(e.message)).finally(() => setLoading(false))
          }}>
            {loading ? <Spinner size={14} /> : '  Scan for Trackers'}
          </button>
          {trackers.length > 0
            ? trackers.map((t, i) => <div key={i} className="card"><span style={{ fontSize:12, fontFamily:'var(--mono)', color:'var(--red)' }}>{t.pkg || t}</span></div>)
            : !loading && <Empty icon="  " text="Click scan to detect tracking frameworks" />}
        </div>
      )}
    </PageWrap>
  )
}
