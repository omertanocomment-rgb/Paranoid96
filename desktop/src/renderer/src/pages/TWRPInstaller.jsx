import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Progress, Tag } from './_shared.jsx'


export default function TWRPInstaller({ device, addLog }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [links, setLinks] = useState([])
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ percent:0, message:'' })
  const [mode, setMode] = useState('permanent')

  useEffect(() => {
    if (device?.model) setQuery(device.model.toLowerCase().replace(/\s+/g, '-'))
  }, [device?.model])

  useEffect(() => {
    const r = ft.on('twrp:progress', p => setProgress({ percent:p.percent||0, message:p.message||'' }))
    return r
  }, [])

  const search = async () => {
    if (!query) return
    setBusy(true)
    try {
      const res = await ft.twrp.search({ codename: query })
      setResults(res)
    } catch (e) { addLog('TWRP search: ' + e.message) }
    setBusy(false)
  }

  const getLinks = async (device) => {
    setSelected(device)
    setBusy(true)
    try {
      const res = await ft.twrp.links({ deviceUrl: device.url })
      setLinks(res)
    } catch (e) { addLog('TWRP links: ' + e.message) }
    setBusy(false)
  }

  const flash = async (link) => {
    if (!device?.serial) return addLog('No device connected')
    setBusy(true)
    try {
      if (mode === 'permanent') await ft.twrp.flash({ serial: device.serial, twrpUrl: link.url, filename: link.filename })
      else await ft.twrp.bootTemp({ serial: device.serial, twrpUrl: link.url, filename: link.filename })
      addLog('TWRP flash complete')
    } catch (e) { addLog('Flash failed: ' + e.message) }
    setBusy(false)
  }

  return (
    <PageWrap>
      <PageHeader title="TWRP Installer" icon="  " sub="Find and flash TWRP recovery for your device" />

      <div style={{ display:'flex', gap:8 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key==='Enter' && search()}
          placeholder="Device codename (e.g. cheetah, violet, blueline)" style={{ flex:1 }} />
        <button className="btn btn-primary" onClick={search} disabled={busy}>
          {busy ? '...' : '  Search'}
        </button>
      </div>

      {results.length > 0 && !selected && (
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>{results.length} devices found</div>
          {results.map((r, i) => (
            <div key={i} onClick={() => getLinks(r)}
              style={{ padding:'10px 14px', borderRadius:8, background:'var(--bg2)', border:'1px solid var(--border)', cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'space-between',
                transition:'border-color 0.1s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <span style={{ fontSize:13, fontWeight:500 }}>{r.name}</span>
              <span style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--mono)' }}>{r.codename}</span>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button className="btn btn-sm" onClick={() => { setSelected(null); setLinks([]) }}>  Back</button>
            <span style={{ fontSize:14, fontWeight:600 }}>{selected.name}</span>
          </div>

          <div style={{ display:'flex', gap:8 }}>
            {['permanent','temp'].map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex:1, padding:10, borderRadius:8, cursor:'pointer',
                background: mode===m ? 'var(--accent-dim)' : 'var(--bg2)',
                border:`1px solid ${mode===m ? 'var(--accent-border)' : 'var(--border)'}`,
                color: mode===m ? 'var(--accent)' : 'var(--text2)', fontSize:13
              }}>
                {m === 'permanent' ? 'Flash permanently' : 'Boot once (temp)'}
                <div style={{ fontSize:11, color:'var(--text3)', marginTop:2, fontWeight:400 }}>
                  {m === 'permanent' ? 'Replaces existing recovery' : 'Boots TWRP without installing'}
                </div>
              </button>
            ))}
          </div>

          {!links.length && busy && <Progress {...progress} message="Loading download links..." />}
          {links.map((l, i) => (
            <div key={i} className="card" style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:500 }}>{l.filename}</div>
                <div style={{ fontSize:11, color:'var(--text3)' }}>{l.version}</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => flash(l)} disabled={busy}>
                {busy ? '...' : '  Flash'}
              </button>
            </div>
          ))}
          {!links.length && !busy && <Empty icon=" " text="No download links found" />}
        </>
      )}

      {busy && progress.message && <Progress {...progress} />}

      <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', marginBottom:4 }}>Requirements</div>
        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            Unlocked bootloader required<br />
            Device must be in fastboot mode<br />
            Flashing wrong TWRP can brick device -- verify codename first
        </div>
      </div>
    </PageWrap>
  )
}
