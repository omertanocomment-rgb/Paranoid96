import { useState } from 'react'
const ft = window.ft
function fmt(b){if(!b)return'';if(b>1e9)return(b/1e9).toFixed(1)+' GB';if(b>1e6)return(b/1e6).toFixed(0)+' MB';return(b/1024).toFixed(0)+' KB'}
export default function AppStoreBrowser({ device, addLog }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)
  const [country, setCountry] = useState('us')
  const COUNTRIES = [['us','USA'],['gb','UK'],['au','Australia'],['ca','Canada'],['de','Germany'],['jp','Japan'],['fr','France'],['es','Spain']]
  const search = async () => {
    if(!q.trim())return
    setLoading(true);setResults([]);setSelected(null)
    const r = await ft.iosTools.appstore.search({query:q,country,limit:30}).catch(e=>({results:[],error:e.message}))
    setResults(r.results||[])
    addLog(`App Store: ${r.results?.length||0} results for "${q}"`)
    setLoading(false)
  }
  const getInfo = async (app) => {
    setLoading(true)
    const r = await ft.iosTools.appstore.appInfo({id:app.id,country}).catch(e=>({error:e.message}))
    if(r.success)setSelected(r.app)
    setLoading(false)
  }
  return (
    <div style={{display:'flex',flexDirection:'column',gap:12,padding:'16px 20px',height:'100%',overflowY:'auto',boxSizing:'border-box'}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:24}}> </span>
        <div style={{flex:1}}><div style={{fontSize:19,fontWeight:700,color:'var(--text)'}}>App Store Browser</div><div style={{fontSize:12,color:'var(--text3)'}}>Search iOS apps, check versions, compatibility</div></div>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&search()} placeholder="Search apps..." style={{flex:1,minWidth:150}}/>
        <select value={country} onChange={e=>setCountry(e.target.value)} style={{padding:'7px 10px',borderRadius:7,background:'var(--bg2)',color:'var(--text)',border:'1px solid var(--border)',fontSize:12}}>
          {COUNTRIES.map(([c,l])=><option key={c} value={c}>{l}</option>)}
        </select>
        <button onClick={search} disabled={loading||!q} style={{padding:'8px 16px',borderRadius:7,fontSize:12,fontWeight:600,cursor:'pointer',background:'var(--accent)',color:'#000',border:'none'}}>{loading?'Searching...':'Search'}</button>
      </div>
      <div style={{display:'flex',gap:12,flex:1,minHeight:0}}>
        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:6}}>
          {results.map((app,i)=>(
            <div key={i} onClick={()=>getInfo(app)} style={{display:'flex',gap:10,padding:'10px 12px',background:selected?.bundleId===app.bundleId?'var(--accent-dim)':'var(--bg1)',borderRadius:9,border:`1px solid ${selected?.bundleId===app.bundleId?'var(--accent-border)':'var(--border)'}`,cursor:'pointer'}}>
              {app.icon&&<img src={app.icon} style={{width:44,height:44,borderRadius:10,flexShrink:0}} onError={e=>e.target.style.display='none'} alt=""/>}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{app.name}</div>
                <div style={{fontSize:10,color:'var(--text3)',marginBottom:2}}>{app.developer}</div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  <span style={{fontSize:10,color:app.price==='Free'?'#4ade80':'#f59e0b',fontWeight:600}}>{app.price}</span>
                  {app.rating&&<span style={{fontSize:10,color:'var(--text3)'}}>{' '.repeat(Math.round(app.rating))} {app.rating}</span>}
                  <span style={{fontSize:10,color:'var(--text3)'}}>{app.genre}</span>
                </div>
              </div>
            </div>
          ))}
          {!loading&&results.length===0&&q&&<div style={{textAlign:'center',padding:20,color:'var(--text3)'}}>No results</div>}
        </div>
        {selected&&(
          <div style={{width:280,overflowY:'auto',background:'var(--bg1)',borderRadius:10,border:'1px solid var(--border)',padding:14,flexShrink:0}}>
            {selected.icon&&<img src={selected.icon} style={{width:80,height:80,borderRadius:16,display:'block',margin:'0 auto 10px'}} alt=""/>}
            <div style={{fontSize:15,fontWeight:700,color:'var(--text)',textAlign:'center',marginBottom:4}}>{selected.name}</div>
            <div style={{fontSize:11,color:'var(--text3)',textAlign:'center',marginBottom:10}}>{selected.developer}</div>
            {[['Bundle ID',selected.bundleId,true],['Version',selected.version],['Price',selected.price],['Genre',selected.genre],['Min iOS',selected.minOs],['Size',fmt(selected.size)],['Rating',selected.rating&&selected.rating+'  ('+selected.reviews?.toLocaleString()+' reviews)'],].map(([k,v,mono])=>v&&(
              <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:'1px solid var(--border)',fontSize:11}}>
                <span style={{color:'var(--text3)'}}>{k}</span><span style={{color:'var(--text2)',fontFamily:mono?'monospace':'inherit',fontSize:10}}>{v}</span>
              </div>
            ))}
            {selected.description&&<div style={{fontSize:11,color:'var(--text3)',lineHeight:1.6,marginTop:8}}>{selected.description?.slice(0,200)}...</div>}
            <button onClick={()=>ft.openUrl(selected.url)} style={{width:'100%',marginTop:10,padding:'7px',borderRadius:7,fontSize:12,fontWeight:600,cursor:'pointer',background:'var(--accent)',color:'#000',border:'none'}}>Open in App Store</button>
          </div>
        )}
      </div>
    </div>
  )
}
