import { useState, useEffect, useRef } from 'react'
const ft = window.ft

const DEVICES = [
  { label:'iPhone 6', id:'iPhone7,2' },
  { label:'iPhone 6 Plus', id:'iPhone7,1' },
  { label:'iPhone 6s', id:'iPhone8,1' },
  { label:'iPhone 7', id:'iPhone9,1' },
  { label:'iPhone 8', id:'iPhone10,4' },
  { label:'iPhone X', id:'iPhone10,6' },
  { label:'iPhone XS', id:'iPhone11,2' },
  { label:'iPhone 11', id:'iPhone12,1' },
  { label:'iPhone 12', id:'iPhone13,2' },
  { label:'iPhone 13', id:'iPhone14,5' },
  { label:'iPhone 14', id:'iPhone15,2' },
  { label:'iPhone 15', id:'iPhone16,1' },
  { label:'iPad Air 2', id:'iPad5,3' },
  { label:'iPad mini 4', id:'iPad5,1' },
  { label:'iPad Pro 12.9"', id:'iPad6,7' },
]

function fmt(bytes) {
  if (!bytes) return ''
  if (bytes > 1e9) return (bytes/1e9).toFixed(1)+' GB'
  return (bytes/1e6).toFixed(0)+' MB'
}

export default function IPSWManager({ device, addLog }) {
  const [selectedDevice, setSelectedDevice] = useState(DEVICES[0].id)
  const [firmwares, setFirmwares] = useState([])
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(null)
  const [progress, setProgress] = useState({ pct:0, msg:'' })
  const [blobs, setBlobs] = useState([])
  const [tab, setTab] = useState('ipsw')

  useEffect(() => {
    const u = ft.on('ios:ipsw:progress', p => setProgress({ pct:p.pct||0, msg:p.msg||'' }))
    ft.iosCustom.shsh.list().then(r => setBlobs(r.blobs||[])).catch(()=>{})
    return () => u()
  }, [])

  const fetchVersions = async () => {
    setLoading(true)
    setFirmwares([])
    const r = await ft.iosCustom.ipsw.fetchVersions({ device: selectedDevice }).catch(e=>({firmwares:[],error:e.message}))
    setFirmwares(r.firmwares||[])
    if (r.error) addLog('Error: '+r.error)
    setLoading(false)
  }

  const download = async (fw) => {
    setDownloading(fw.version)
    setProgress({ pct:0, msg:'Starting...' })
    const r = await ft.iosCustom.ipsw.download({ url:fw.url, device:selectedDevice, version:fw.version }).catch(e=>({error:e.message}))
    if (r.cancelled) { setDownloading(null); return }
    addLog(r.success ? `Downloaded iOS ${fw.version} IPSW: ${r.path}` : 'Download failed: '+r.error)
    setDownloading(null)
  }

  const saveBlob = async () => {
    const device2 = device?.udid ? device : null
    const ecid = device2?.ecid || ''
    const r = await ft.iosCustom.shsh.save({ device:selectedDevice, ecid }).catch(e=>({error:e.message}))
    addLog(r.success ? `Saved ${r.blobs?.length||0} SHSH blob(s)` : 'SHSH save failed: '+(r.error||'check tsschecker'))
    ft.iosCustom.shsh.list().then(r2=>setBlobs(r2.blobs||[])).catch(()=>{})
  }

  const signed = firmwares.filter(f=>f.signed)
  const unsigned = firmwares.filter(f=>!f.signed)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>IPSW Manager</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Download firmware, save SHSH blobs, manage iOS versions</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3 }}>
        {[['ipsw','IPSW Download'],['shsh','SHSH Blobs'],['guide','Downgrade Guide']].map(([id,l]) => <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'7px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>)}
      </div>

      {tab === 'ipsw' && (
        <>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
            <select value={selectedDevice} onChange={e=>setSelectedDevice(e.target.value)} style={{ flex:1, padding:'8px 10px', borderRadius:7, background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)', fontSize:12 }}>
              {DEVICES.map(d => <option key={d.id} value={d.id}>{d.label} ({d.id})</option>)}
            </select>
            <button onClick={fetchVersions} disabled={loading} style={{ padding:'8px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>{loading?'Loading...':'Fetch Versions'}</button>
          </div>

          {signed.length > 0 && (
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'#4ade80', letterSpacing:'0.05em', marginBottom:6 }}>CURRENTLY SIGNED (can restore)</div>
              {signed.map((fw,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', background:'rgba(74,222,128,0.05)', borderRadius:8, border:'1px solid rgba(74,222,128,0.2)', marginBottom:4 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'#4ade80' }}>iOS {fw.version}</div>
                    <div style={{ fontSize:10, color:'var(--text3)' }}>Build: {fw.buildid} &nbsp; {fmt(fw.filesize)}</div>
                  </div>
                  <button onClick={() => download(fw)} disabled={!!downloading} style={{ padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
                    {downloading===fw.version ? 'Downloading...' : 'Download'}
                  </button>
                </div>
              ))}
              {downloading && <div style={{ marginTop:6 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text3)', marginBottom:3 }}><span>{progress.msg}</span><span>{progress.pct}%</span></div>
                <div style={{ height:5, background:'var(--bg3)', borderRadius:3, overflow:'hidden' }}><div style={{ height:'100%', width:progress.pct+'%', background:'var(--accent)', transition:'width 0.3s' }} /></div>
              </div>}
            </div>
          )}

          {unsigned.length > 0 && (
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', letterSpacing:'0.05em', marginBottom:6 }}>UNSIGNED (need SHSH blobs to restore)</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                {unsigned.map((fw,i) => (
                  <div key={i} style={{ padding:'5px 10px', borderRadius:6, background:'var(--bg2)', border:'1px solid var(--border)', fontSize:12 }}>
                    <span style={{ color:'var(--text3)' }}>iOS {fw.version}</span>
                    <span style={{ fontSize:10, color:'var(--text3)', marginLeft:6 }}>{fw.buildid}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'shsh' && (
        <>
          <div style={{ padding:12, background:'rgba(167,139,250,0.08)', border:'1px solid rgba(167,139,250,0.2)', borderRadius:8, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            SHSH2 blobs are cryptographic tokens that let you restore to unsigned iOS versions. Save them NOW for currently-signed versions before Apple stops signing them. Requires tsschecker in bin/.
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={saveBlob} style={{ padding:'8px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'rgba(167,139,250,0.2)', color:'#a78bfa', border:'1px solid rgba(167,139,250,0.4)' }}>
              Save SHSH Blobs Now
            </button>
            <button onClick={() => ft.iosCustom.shsh.openFolder().then(r=>addLog('Blobs folder: '+r.path))} style={{ padding:'8px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>
              Open Blobs Folder
            </button>
          </div>
          {blobs.length > 0 ? (
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text3)', marginBottom:6 }}>{blobs.length} SAVED BLOB(S)</div>
              {blobs.map((b,i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'7px 10px', background:'var(--bg1)', borderRadius:7, border:'1px solid var(--border)', marginBottom:4, fontSize:12 }}>
                  <span style={{ color:'var(--text2)', fontFamily:'monospace', fontSize:11 }}>{b.name}</span>
                  <span style={{ color:'var(--text3)' }}>{(b.size/1024).toFixed(0)} KB</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign:'center', padding:20, color:'var(--text3)' }}>No blobs saved yet. Click Save SHSH Blobs Now.</div>
          )}
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:8 }}>HOW TO USE BLOBS TO DOWNGRADE</div>
            {[
              'Save SHSH blobs for current iOS version NOW (above)',
              'When Apple stops signing the old version, blobs let you still restore to it',
              'Use futurerestore to restore: futurerestore --latest-sep --latest-baseband -t blob.shsh2 firmware.ipsw',
              'futurerestore works on A9 and below (iPhone 6s and older)',
              'For A10+: downgrade via palerain (needs more specific conditions)',
            ].map((s,i) => <div key={i} style={{ display:'flex', gap:8, marginBottom:6 }}><span style={{ color:'#a78bfa', fontWeight:700 }}>{i+1}.</span><span style={{ fontSize:11, color:'var(--text2)' }}>{s}</span></div>)}
          </div>
        </>
      )}

      {tab === 'guide' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            { title:'Can I downgrade iOS?', color:'#f59e0b', content:'Apple only signs the latest iOS version (and sometimes the previous one for a few weeks). To downgrade you need either: (1) SHSH blobs saved while that version was signed + futurerestore, or (2) a checkm8/checkra1n compatible device (A8-A11) which can boot any iOS version using a ramdisk approach.' },
            { title:'iPhone 6 / 6s downgrade (A8/A9)', color:'#4ade80', content:'iPhone 6 (A8) is a checkm8 device. You can boot any iOS version using palera1n or checkra1n ramdisk. Use the SSH ramdisk method to access data without restoring. To actually restore to older iOS: save SHSH blobs + use futurerestore. The iPhone 6 can run iOS 12 which has much better jailbreak support.' },
            { title:'A12+ devices (iPhone XS, 11, 12+)', color:'#60a5fa', content:'No bootrom exploit exists for A12+. Downgrade requires SHSH blobs AND Apple must still be signing (for official restore). Unsigned downgrade is currently not possible on A12+ without a future exploit. Keep your device on a jailbreakable version and save blobs.' },
            { title:'futurerestore', color:'#a78bfa', content:'futurerestore is the tool that uses SHSH blobs to restore to unsigned firmware. Works best on A9 and below. Requires: IPSW file, SHSH2 blobs, and careful matching of SEP and baseband versions. Download from github.com/s0uthwest/futurerestore.' },
          ].map((s,i) => (
            <div key={i} style={{ background:'var(--bg1)', border:`1px solid ${s.color}33`, borderRadius:10, padding:14, borderLeft:`3px solid ${s.color}` }}>
              <div style={{ fontSize:13, fontWeight:700, color:s.color, marginBottom:8 }}>{s.title}</div>
              <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.8 }}>{s.content}</div>
            </div>
          ))}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {[['futurerestore','https://github.com/s0uthwest/futurerestore'],['IPSW.me','https://ipsw.me'],['Canister','https://canister.me']].map(([l,u]) => <button key={l} onClick={()=>ft.openUrl(u)} style={{ padding:'7px 14px', borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', background:'var(--bg2)', color:'var(--text3)', border:'1px solid var(--border)' }}>{l}</button>)}
          </div>
        </div>
      )}
    </div>
  )
}
