import { useState } from 'react'
const ft = window.ft

const BLOCKLISTS = [
  { name:'StevenBlack Unified',  url:'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',                        desc:'Ads + malware, 100k+ hosts' },
  { name:'StevenBlack + Social', url:'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/social/hosts',     desc:'Ads + social media blocked' },
  { name:'StevenBlack + Porn',   url:'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn/hosts',       desc:'Ads + adult content blocked' },
  { name:'AdGuard DNS',          url:'https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt',                     desc:'AdGuard curated blocklist' },
  { name:'OISD Small',           url:'https://small.oisd.nl/hosts',                                                            desc:'Light blocklist, minimal breakage' },
  { name:'OISD Big',             url:'https://big.oisd.nl/hosts',                                                              desc:'Comprehensive blocklist' },
]

export default function HostsEditor({ device, addLog }) {
  const [content, setContent] = useState('')
  const [edited, setEdited] = useState('')
  const [loading, setLoading] = useState(null)
  const [tab, setTab] = useState('editor')
  const serial = device?.serial

  const readHosts = async () => {
    setLoading('read')
    const r = await ft.hosts.read({ serial }).catch(e=>({error:e.message}))
    if (r.success) { setContent(r.content); setEdited(r.content) }
    else addLog('Error: ' + r.error + ' (root may be required)')
    setLoading(null)
  }

  const writeHosts = async () => {
    setLoading('write')
    const r = await ft.hosts.write({ serial, content: edited }).catch(e=>({error:e.message}))
    addLog(r.success ? 'Hosts file updated' : 'Error: ' + r.error)
    setLoading(null)
  }

  const fetchBlocklist = async (bl) => {
    setLoading(bl.name)
    addLog('Downloading ' + bl.name + '...')
    const r = await ft.hosts.fetchBlocklist({ url: bl.url }).catch(e=>({error:e.message}))
    if (r.success) {
      const NL = String.fromCharCode(10)
      const baseHosts = ['127.0.0.1 localhost', '::1 localhost', ''].join(NL)
      const blockLines = r.content.split(NL).filter(function(l) { return l.startsWith('0.0.0.0') || l.startsWith('127.0.0.1') }).join(NL)
      setEdited(baseHosts + NL + blockLines)
      addLog('Loaded ' + bl.name + ': ' + String(r.lines) + ' lines')
    } else { addLog('Download failed: ' + r.error) }
    setLoading(null)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Hosts Editor</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Edit /etc/hosts and apply DNS blocklists on-device</div>
        </div>
      </div>

      <div style={{ padding:10, background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, fontSize:12, color:'#f87171', lineHeight:1.7 }}>
        Writing to /etc/hosts requires root. Reading is available on all devices. Blocklists are applied by replacing the hosts file.
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3 }}>
        {[['editor','Editor'],['blocklists','Blocklists']].map(([id,l]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'7px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>
        ))}
      </div>

      {tab === 'editor' && (
        <>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={readHosts} disabled={!serial||loading==='read'} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>{loading==='read'?'Reading...':'Read /etc/hosts'}</button>
            <button onClick={writeHosts} disabled={!serial||!edited||loading==='write'} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'rgba(74,222,128,0.15)', color:'#4ade80', border:'1px solid rgba(74,222,128,0.3)', opacity:!serial?0.5:1 }}>{loading==='write'?'Writing...':'Write to Device (Root)'}</button>
            <button onClick={() => setEdited(content)} disabled={!content} style={{ padding:'7px 10px', borderRadius:7, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Revert</button>
          </div>
          <textarea value={edited} onChange={e=>setEdited(e.target.value)} style={{ flex:1, minHeight:300, fontFamily:'monospace', fontSize:11, padding:12, background:'#0a0a0a', color:'#d4d4d4', border:'1px solid var(--border)', borderRadius:8, resize:'vertical', lineHeight:1.8 }} placeholder="127.0.0.1 localhost&#10;::1 localhost&#10;&#10;# Add block rules here:&#10;0.0.0.0 ads.example.com" />
          {edited && <div style={{ fontSize:11, color:'var(--text3)' }}>{edited.split(String.fromCharCode(10)).length.toLocaleString()} lines   {edited.length.toLocaleString()} bytes</div>}
        </>
      )}

      {tab === 'blocklists' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.7 }}>Download a pre-built blocklist to block ads, trackers and malware system-wide. After loading, switch to Editor tab and write to device (requires root).</div>
          {BLOCKLISTS.map((bl,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'var(--bg1)', borderRadius:9, border:'1px solid var(--border)' }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{bl.name}</div>
                <div style={{ fontSize:11, color:'var(--text3)' }}>{bl.desc}</div>
              </div>
              <button onClick={() => fetchBlocklist(bl)} disabled={!!loading} style={{ padding:'6px 14px', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', flexShrink:0 }}>
                {loading===bl.name ? 'Downloading...' : 'Load'}
              </button>
            </div>
          ))}
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>CUSTOM RULE</div>
            <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
              In the Editor, add lines like:<br/>
              <code style={{ color:'var(--accent)' }}>0.0.0.0 ads.tracking.com</code><br/>
              <code style={{ color:'var(--accent)' }}>127.0.0.1 unwanted-site.com</code>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
