import { useState } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner, Tag, Progress } from './_shared.jsx'


export default function ApkAnalyser({ device, addLog }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('overview')
  const [compareResult, setCompareResult] = useState(null)
  const [appFilter, setAppFilter] = useState('')

  const analyse = async (fromDevice = false) => {
    setLoading(true); setResult(null); setCompareResult(null)
    try {
      let res
      if (fromDevice) {
        const apps = await ft.apps.list({ serial: device?.serial, type: 'android' })
        const filtered = apps.filter(a => !appFilter || a.pkg.includes(appFilter)).slice(0, 1)
        if (!filtered.length) { addLog('Select a package first'); setLoading(false); return }
        res = await ft.apk.extractFromDevice({ serial: device?.serial, pkg: filtered[0].pkg })
      } else {
        res = await ft.apk.analyse({})
      }
      if (!res?.cancelled) { setResult(res); setTab('overview') }
    } catch (e) { addLog('APK analyse: ' + e.message) }
    setLoading(false)
  }

  const compare = async () => {
    setLoading(true)
    try {
      const res = await ft.apk.compare({})
      if (!res?.cancelled && !res?.error) setCompareResult(res)
      else if (res?.error) addLog(res.error)
    } catch (e) { addLog('Compare: ' + e.message) }
    setLoading(false)
  }

  const TABS = [['overview','Overview'],['permissions','Permissions'],['trackers','Trackers'],['network','Network'],['certs','Certificate']]

  return (
    <PageWrap>
      <PageHeader title="APK Analyser" icon=" " sub="Static analysis -- permissions, trackers, network calls, certificates" />

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button className="btn btn-primary" onClick={() => analyse(false)} disabled={loading}>
          {loading ? <Spinner size={14}/> : '  Analyse APK File'}
        </button>
        <button className="btn btn-blue" onClick={() => analyse(true)} disabled={loading || !device}>
            Analyse from Device
        </button>
        <button className="btn btn-sm" onClick={compare} disabled={loading}>
            Compare 2 APKs
        </button>
      </div>

      {loading && <div className="card" style={{ display:'flex', gap:10, alignItems:'center', padding:14 }}><Spinner/>  <span style={{ fontSize:13 }}>Analysing APK...</span></div>}

      {compareResult && (
        <div className="card">
          <div style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>Comparison Results</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            {['a','b'].map(v => (
              <div key={v} style={{ padding:10, background:'var(--bg2)', borderRadius:8 }}>
                <div style={{ fontSize:12, fontWeight:600, marginBottom:6 }}>Version {compareResult[v].version}</div>
                <div style={{ fontSize:11, color:'var(--text3)' }}>{compareResult[v].permissions} permissions   {compareResult[v].trackers.length} trackers</div>
              </div>
            ))}
          </div>
          {compareResult.newPermissions.length > 0 && (
            <div style={{ marginTop:10 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'var(--red)', marginBottom:4 }}>  NEW permissions in v2:</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>{compareResult.newPermissions.map(p => <Tag key={p} color="red">{p}</Tag>)}</div>
            </div>
          )}
          {compareResult.newTrackers.length > 0 && (
            <div style={{ marginTop:8 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'var(--red)', marginBottom:4 }}>  NEW trackers in v2:</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>{compareResult.newTrackers.map(t => <Tag key={t} color="red">{t}</Tag>)}</div>
            </div>
          )}
          {compareResult.newPermissions.length === 0 && compareResult.newTrackers.length === 0 && (
            <div style={{ marginTop:8, color:'var(--green)', fontSize:13 }}>  No new permissions or trackers in the newer version</div>
          )}
        </div>
      )}

      {result && !result.cancelled && (
        <>
          <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3, flexWrap:'wrap' }}>
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding:'6px 10px', borderRadius:6, fontSize:12, fontWeight:500, cursor:'pointer',
                background: tab===id ? 'var(--bg4)' : 'none',
                color: tab===id ? 'var(--text)' : 'var(--text3)',
                border: tab===id ? '1px solid var(--border)' : '1px solid transparent'
              }}>{label}</button>
            ))}
          </div>

          {tab === 'overview' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div className="card">
                <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Package Info</div>
                {[['Package', result.packageName], ['Version', result.versionName], ['Version Code', result.versionCode],
                  ['Min SDK', result.minSdk ? `API ${result.minSdk}` : null], ['Target SDK', result.targetSdk ? `API ${result.targetSdk}` : null],
                  ['Size', result.size ? (result.size/1024/1024).toFixed(1) + ' MB' : null],
                  ['Total Files', result.totalFiles]
                ].filter(([,v]) => v).map(([k,v]) => (
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                    <span style={{ color:'var(--text3)' }}>{k}</span>
                    <span style={{ color:'var(--text2)', fontFamily:'var(--font-mono)' }}>{v}</span>
                  </div>
                ))}
              </div>
              <div className="card">
                <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Security Summary</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:12, color:'var(--text3)' }}>Dangerous permissions</span>
                    <Tag color={result.permissions?.filter(p=>p.dangerous).length > 5 ? 'red' : 'amber'}>{result.permissions?.filter(p=>p.dangerous).length || 0}</Tag>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:12, color:'var(--text3)' }}>Trackers detected</span>
                    <Tag color={result.trackers?.length > 3 ? 'red' : result.trackers?.length > 0 ? 'amber' : 'green'}>{result.trackers?.length || 0}</Tag>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:12, color:'var(--text3)' }}>Network hosts</span>
                    <Tag color="blue">{result.networkHosts?.length || 0}</Tag>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:12, color:'var(--text3)' }}>Certificate</span>
                    <Tag color={result.certificates?.length ? 'green' : 'gray'}>{result.certificates?.length ? 'Present' : 'Not found'}</Tag>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'permissions' && (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>{result.permissions?.length} permissions total   {result.permissions?.filter(p=>p.dangerous).length} dangerous</div>
              {result.permissions?.sort((a,b) => b.dangerous - a.dangerous).map((p, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 12px', background:'var(--bg2)', borderRadius:6,
                  borderLeft: p.dangerous ? '3px solid var(--red)' : '3px solid var(--border)' }}>
                  <span style={{ fontSize:12, fontFamily:'var(--font-mono)', flex:1, color:'var(--text)' }}>{p.name}</span>
                  {p.dangerous && <Tag color="red">Dangerous</Tag>}
                </div>
              ))}
            </div>
          )}

          {tab === 'trackers' && (
            <div>
              {!result.trackers?.length
                ? <div className="card" style={{ background:'var(--green-dim)', border:'1px solid rgba(74,222,128,0.2)' }}>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--green)' }}>  No known trackers detected</div>
                  </div>
                : <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {result.trackers.map((t, i) => (
                      <div key={i} className="card" style={{ display:'flex', alignItems:'center', gap:12, borderLeft:'3px solid var(--red)' }}>
                        <span style={{ fontSize:16 }}> </span>
                        <div><div style={{ fontSize:14, fontWeight:500 }}>{t}</div><div style={{ fontSize:11, color:'var(--text3)' }}>Tracking/analytics SDK detected in DEX</div></div>
                      </div>
                    ))}
                  </div>
              }
            </div>
          )}

          {tab === 'network' && (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>{result.networkHosts?.length} unique hosts found in DEX</div>
              {result.networkHosts?.map((host, i) => (
                <div key={i} style={{ padding:'6px 12px', background:'var(--bg2)', borderRadius:6, fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text2)' }}>
                  {host}
                </div>
              ))}
              {!result.networkHosts?.length && <Empty icon=" " text="No network hosts detected" />}
            </div>
          )}

          {tab === 'certs' && (
            <div>
              {result.certificates?.length ? result.certificates.map((cert, i) => (
                <div key={i} className="card">
                  <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Signing Certificate</div>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text2)', wordBreak:'break-all' }}>SHA256: {cert.sha256}</div>
                  <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>{cert.file}   {cert.size} bytes</div>
                </div>
              )) : <Empty icon=" " text="No certificate found" />}
            </div>
          )}
        </>
      )}

      {!result && !loading && !compareResult && (
        <Empty icon=" " text="Select an APK file to analyse" sub="Static analysis -- no device needed for file-based analysis" />
      )}
    </PageWrap>
  )
}
