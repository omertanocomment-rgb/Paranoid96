import { useState, useEffect } from 'react'
const ft = window.ft

const COMMON_PROPS = [
  { cat:'Performance', props:[
    { key:'ro.config.hw_quickpoweron',      val:'true',   desc:'Faster power on' },
    { key:'ro.ril.disable.power.collapse',  val:'1',      desc:'Prevent modem sleep issues' },
    { key:'windowsmgr.max_events_per_sec',  val:'60',     desc:'Smoother touch response' },
    { key:'ro.min_pointer_dur',             val:'0',      desc:'Remove touch latency' },
    { key:'debug.performance.tuning',       val:'1',      desc:'Enable performance tuning' },
    { key:'video.accelerate.hw',            val:'1',      desc:'Hardware video acceleration' },
    { key:'ro.config.nocheckin',            val:'true',   desc:'Disable Google checkin' },
  ]},
  { cat:'Display', props:[
    { key:'ro.sf.lcd_density',              val:'480',    desc:'Screen density (DPI) - change carefully' },
    { key:'persist.sys.ui.hw',              val:'true',   desc:'Hardware UI rendering' },
    { key:'debug.egl.hw',                   val:'1',      desc:'Hardware EGL' },
    { key:'debug.sf.hw',                    val:'1',      desc:'Hardware surface flinger' },
  ]},
  { cat:'Camera', props:[
    { key:'camera.disable_zsl_mode',        val:'1',      desc:'Disable zero shutter lag' },
    { key:'ro.media.enc.jpeg.quality',      val:'100',    desc:'Max JPEG quality' },
    { key:'camera2.portability.force_api',  val:'1',      desc:'Force Camera2 API' },
  ]},
  { cat:'Network', props:[
    { key:'net.tcp.buffersize.default',     val:'4096,87380,256960,4096,16384,256960', desc:'TCP buffer sizes' },
    { key:'net.tcp.buffersize.wifi',        val:'524288,1048576,2097152,262144,524288,1048576', desc:'WiFi TCP buffers (large)' },
    { key:'persist.sys.purgeable_assets',   val:'1',      desc:'Purge assets to free RAM' },
  ]},
  { cat:'Developer', props:[
    { key:'ro.debuggable',                  val:'1',      desc:'Mark build as debuggable (root)' },
    { key:'ro.secure',                      val:'0',      desc:'Insecure mode - ADB root (root needed)' },
    { key:'ro.allow.mock.location',         val:'1',      desc:'Allow mock locations without settings' },
    { key:'debug.layout',                   val:'true',   desc:'Show layout bounds' },
  ]},
]

export default function BuildProp({ device, addLog }) {
  const [content, setContent] = useState('')
  const [search, setSearch] = useState('')
  const [customKey, setCustomKey] = useState('')
  const [customVal, setCustomVal] = useState('')
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('live')
  const serial = device?.serial

  const loadProps = async () => {
    setLoading(true)
    const r = await ft.buildprop.read({ serial }).catch(e=>({error:e.message}))
    if (r.success) setContent(r.content)
    else addLog('Error: ' + r.error)
    setLoading(false)
  }

  const setProp = async (key, val) => {
    const r = await ft.buildprop.set({ serial, key, value: val }).catch(e=>({error:e.message}))
    addLog(r.success ? `Set ${key} = ${val}` : 'Error: ' + r.error)
    if (r.success) loadProps()
  }

  const lines = content.split(String.fromCharCode(10)).filter(l => l.trim() && !l.startsWith('#'))
  const filtered = search ? lines.filter(l => l.toLowerCase().includes(search.toLowerCase())) : lines

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Build.prop Editor</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>View and modify system properties live</div>
        </div>
      </div>

      <div style={{ padding:10, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:12, color:'#f59e0b', lineHeight:1.7 }}>
        Runtime changes apply immediately but reset on reboot. Persistent changes to /system/build.prop require root. Some props may cause instability.
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3 }}>
        {[['live','Live Props'],['presets','Presets'],['custom','Custom']].map(([id,l]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'7px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>
        ))}
      </div>

      {tab === 'live' && (
        <>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={loadProps} disabled={loading||!serial} style={{ padding:'7px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>{loading?'Loading...':'Load Props'}</button>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter properties..." style={{ flex:1 }} />
          </div>
          {!serial && <div style={{ padding:12, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:12, color:'#f59e0b' }}>Connect an Android device.</div>}
          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
            {filtered.slice(0,200).map((line,i) => {
              const [k,...rest] = line.split('='); const v = rest.join('=')
              return (
                <div key={i} style={{ display:'flex', gap:8, padding:'6px 10px', background:'var(--bg1)', borderRadius:6, border:'1px solid var(--border)', fontSize:11 }}>
                  <span style={{ color:'var(--text3)', fontFamily:'monospace', minWidth:200, flexShrink:0 }}>{k}</span>
                  <span style={{ color:'var(--accent)', fontFamily:'monospace', flex:1 }}>{v}</span>
                </div>
              )
            })}
            {filtered.length > 200 && <div style={{ fontSize:11, color:'var(--text3)', textAlign:'center', padding:8 }}>Showing 200 of {filtered.length} props. Use search to filter.</div>}
          </div>
        </>
      )}

      {tab === 'presets' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {COMMON_PROPS.map((cat,i) => (
            <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>{cat.cat.toUpperCase()}</div>
              {cat.props.map((p,j) => (
                <div key={j} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:'1px solid var(--border)44' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--accent)' }}>{p.key}</div>
                    <div style={{ fontSize:10, color:'var(--text3)' }}>{p.desc} -- value: <span style={{ color:'#4ade80' }}>{p.val}</span></div>
                  </div>
                  <button onClick={() => setProp(p.key, p.val)} disabled={!serial} style={{ padding:'4px 10px', borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1, flexShrink:0 }}>Set</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'custom' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:10 }}>SET CUSTOM PROPERTY</div>
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <input value={customKey} onChange={e=>setCustomKey(e.target.value)} placeholder="Property key e.g. ro.product.model" style={{ flex:2, fontFamily:'monospace', fontSize:12 }} />
              <input value={customVal} onChange={e=>setCustomVal(e.target.value)} placeholder="Value" style={{ flex:1, fontFamily:'monospace', fontSize:12 }} />
              <button onClick={() => setProp(customKey, customVal)} disabled={!serial||!customKey} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Set</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
