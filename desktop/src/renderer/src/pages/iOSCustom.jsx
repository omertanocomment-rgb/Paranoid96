import { useState, useEffect } from 'react'
const ft = window.ft

function Tag({ label, color }) {
  const c = color || '#60a5fa'
  return <span style={{ fontSize:9, padding:'2px 7px', borderRadius:4, fontWeight:700, background:`${c}22`, color:c, border:`1px solid ${c}44`, marginRight:4 }}>{label}</span>
}

function TweakCard({ t, onInstall }) {
  const CAT_COLORS = { UI:'#a78bfa', Themes:'#f59e0b', System:'#60a5fa', Privacy:'#4ade80', Network:'#06b6d4', Media:'#fb923c', Comms:'#f472b6', Keyboard:'#818cf8' }
  const color = CAT_COLORS[t.cat] || '#888'
  return (
    <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:9, padding:'10px 12px', borderLeft:`3px solid ${color}` }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3, flexWrap:'wrap' }}>
            <span style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{t.name}</span>
            <Tag label={t.cat} color={color} />
            {t.paid && <Tag label="Paid" color="#f59e0b" />}
            {!t.paid && <Tag label="Free" color="#4ade80" />}
          </div>
          <div style={{ fontSize:11, color:'var(--text2)', lineHeight:1.6, marginBottom:4 }}>{t.description}</div>
          <div style={{ fontSize:10, color:'var(--text3)', fontFamily:'monospace' }}>{t.repo}</div>
        </div>
        <button onClick={() => onInstall(t)}
          style={{ padding:'5px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:`${color}22`, color, border:`1px solid ${color}44`, flexShrink:0 }}>
          Install
        </button>
      </div>
    </div>
  )
}

export default function iOSCustom({ device, addLog }) {
  const [tweaks, setTweaks] = useState([])
  const [repos, setRepos] = useState([])
  const [catFilter, setCatFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('tweaks')
  const [onlineQuery, setOnlineQuery] = useState('')
  const [onlineResults, setOnlineResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [cats, setCats] = useState([])

  useEffect(() => {
    ft.iosCustom.tweaks().then(r => { setTweaks(r.tweaks||[]); setCats(['All',...(r.cats||[])]) }).catch(()=>{})
    ft.iosCustom.themeSources().then(r => setRepos(r.sources||[])).catch(()=>{})
  }, [])

  const searchOnline = async () => {
    if (!onlineQuery.trim()) return
    setSearching(true)
    const r = await ft.iosCustom.cydia.search({ query:onlineQuery }).catch(e=>({packages:[],error:e.message}))
    setOnlineResults(r.packages||[])
    if (r.error) addLog('Search error: '+r.error)
    setSearching(false)
  }

  const onInstall = (t) => {
    addLog(`To install ${t.name}: open Sileo/Cydia on device, add repo: ${t.repo}, search for "${t.name}"`)
  }

  const filtered = tweaks.filter(t => {
    if (catFilter !== 'All' && t.cat !== catFilter) return false
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.desc?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const TABS = [['tweaks','Tweaks & Mods'],['repos','Repos & Sources'],['themes','Theme Engines'],['online','Search Online']]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>iOS Customisation</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Tweaks, themes, repos, package manager tools</div>
        </div>
        <div style={{ fontSize:11, padding:'3px 8px', background:'rgba(245,158,11,0.15)', border:'1px solid rgba(245,158,11,0.3)', borderRadius:5, color:'#f59e0b' }}>Requires Jailbreak</div>
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3 }}>
        {TABS.map(([id,l]) => <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'7px 4px', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>)}
      </div>

      {tab === 'tweaks' && (
        <>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search tweaks..." style={{ flex:1, minWidth:120 }} />
            <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
              {cats.map(c => <button key={c} onClick={() => setCatFilter(c)} style={{ padding:'5px 10px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:catFilter===c?'var(--accent-dim)':'var(--bg2)', color:catFilter===c?'var(--accent)':'var(--text3)', border:`1px solid ${catFilter===c?'var(--accent-border)':'var(--border)'}` }}>{c}</button>)}
            </div>
          </div>
          <div style={{ fontSize:11, color:'var(--text3)' }}>{filtered.length} tweaks</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {filtered.map((t,i) => <TweakCard key={i} t={t} onInstall={onInstall} />)}
          </div>
        </>
      )}

      {tab === 'repos' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ padding:10, background:'rgba(96,165,250,0.08)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:8, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            Add these repos in Sileo or Cydia: Open app &gt; Sources tab &gt; + button &gt; paste URL.
          </div>
          {repos.map((r,i) => (
            <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:9, padding:'12px 14px' }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:3 }}>{r.name}</div>
                  <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--accent)', marginBottom:4 }}>{r.url}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{r.desc}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
                  <button onClick={() => { navigator.clipboard.writeText(r.url).catch(()=>{}); addLog('Copied: '+r.url) }} style={{ padding:'4px 10px', borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer', background:'rgba(96,165,250,0.15)', color:'#60a5fa', border:'1px solid rgba(96,165,250,0.3)' }}>Copy URL</button>
                  <button onClick={() => ft.openUrl(r.url)} style={{ padding:'4px 10px', borderRadius:5, fontSize:10, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Open</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'themes' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            { name:'Snowboard', desc:'Modern theme engine. Install themes from Chariz and other repos. Supports icon packs, UI themes.', url:'https://repo.chariz.com/', free:true, ios:'12+',
              install:['Add Chariz repo to Sileo/Cydia','Search Snowboard and install','Open Snowboard from Settings','Apply icon themes from Sources tab']},
            { name:'Anemone 3', desc:'Classic theme engine. Huge library. Works on older iOS. WinterBoard replacement.', url:'https://repo.packix.com/', free:true, ios:'11+',
              install:['Add Packix repo','Install Anemone 3','Download a theme package (look for Anemone-compatible)','Apply in Anemone settings']},
            { name:'Flixy', desc:'Wallpaper engine with live wallpapers, depth effects, weather-reactive.', url:'https://havoc.app/', free:false, ios:'14+',
              install:['Add Havoc repo','Purchase and install Flixy','Apply wallpapers from the Flixy app']},
            { name:'Palette', desc:'Automatic color theming -- extracts colors from wallpaper and applies to entire UI.', url:'https://repo.chariz.com/', free:false, ios:'14+',
              install:['Add Chariz repo','Install Palette','Set wallpaper, colors apply automatically']},
            { name:'Mikoto', desc:'App icon customizer -- apply custom icons per-app without full theme.', url:'https://repo.mikoto.pub/', free:true, ios:'13+',
              install:['Add Mikoto repo','Install Mikoto','Long-press any app icon to change it']},
          ].map((t,i) => (
            <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--text)', marginBottom:4 }}>{t.name}</div>
                  <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:4 }}>
                    <Tag label={t.free?'Free':'Paid'} color={t.free?'#4ade80':'#f59e0b'} />
                    <Tag label={'iOS '+t.ios} color="#a78bfa" />
                  </div>
                  <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>{t.desc}</div>
                </div>
                <button onClick={() => ft.openUrl(t.url)} style={{ padding:'5px 10px', borderRadius:6, fontSize:10, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', flexShrink:0 }}>Repo</button>
              </div>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', marginBottom:6 }}>INSTALL STEPS</div>
              {t.install.map((s,j) => <div key={j} style={{ display:'flex', gap:8, marginBottom:4 }}><span style={{ color:'var(--accent)', fontWeight:700 }}>{j+1}.</span><span style={{ fontSize:11, color:'var(--text2)' }}>{s}</span></div>)}
            </div>
          ))}
        </div>
      )}

      {tab === 'online' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'flex', gap:8 }}>
            <input value={onlineQuery} onChange={e=>setOnlineQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&searchOnline()} placeholder="Search Canister package database..." style={{ flex:1 }} />
            <button onClick={searchOnline} disabled={searching||!onlineQuery} style={{ padding:'8px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>{searching?'Searching...':'Search'}</button>
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {['filza','youtube','tiktok','instagram','bypass','terminal','ssh','theme'].map(q => <button key={q} onClick={() => {setOnlineQuery(q); setTimeout(searchOnline,100)}} style={{ padding:'4px 10px', borderRadius:5, fontSize:11, cursor:'pointer', background:'var(--bg2)', color:'var(--text3)', border:'1px solid var(--border)' }}>{q}</button>)}
          </div>
          {onlineResults.map((p,i) => (
            <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                <span style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{p.name||p.id}</span>
                <span style={{ fontSize:11, color:'var(--text3)' }}>v{p.version}</span>
              </div>
              <div style={{ fontSize:10, color:'var(--accent)', fontFamily:'monospace', marginBottom:3 }}>{p.id}</div>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>{p.description?.slice(0,100)}</div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span style={{ fontSize:10, color:'var(--text3)' }}>{p.repo}</span>
                <Tag label={p.price||'Free'} color={p.price&&p.price!=='Free'?'#f59e0b':'#4ade80'} />
                <button onClick={() => onInstall(p)} style={{ padding:'3px 8px', borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)', marginLeft:'auto' }}>How to install</button>
              </div>
            </div>
          ))}
          {!searching && onlineResults.length===0 && onlineQuery && <div style={{ textAlign:'center', padding:20, color:'var(--text3)' }}>No results. Try a different search term.</div>}
        </div>
      )}
    </div>
  )
}
