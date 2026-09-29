import { useState } from 'react'
import { ft, PageWrap, PageHeader, Card, Section, Empty, Tag, TabBar, Spinner } from './_shared.jsx'

// Repo Browser + IPA Inspector - browse Cydia/Sileo/APT-style repos and
// inspect .ipa archives, reimplementing RepoTweaks' core feature set.
// APK inspection is intentionally excluded here - OMERTA's existing APK
// Analyser page already covers that ground, so this stays iOS/repo-focused.
export default function RepoBrowser() {
  const [tab, setTab] = useState('repo')
  return (
    <PageWrap>
      <PageHeader title="Repo Browser" icon=" " sub="Cydia/Sileo repo browser + IPA package inspector" />
      <TabBar tabs={[['repo','Repo Browser'],['ipa','IPA Inspector']]} active={tab} onChange={setTab} />
      {tab === 'repo' && <RepoTab />}
      {tab === 'ipa' && <IpaTab />}
    </PageWrap>
  )
}

function RepoTab() {
  const [url, setUrl] = useState('https://')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')

  const fetch_ = async () => {
    setLoading(true); setError(''); setResult(null)
    try { setResult(await ft.repo.fetch({ baseUrl: url })) }
    catch (e) { setError(e.message) }
    setLoading(false)
  }

  const filtered = result?.packages?.filter(p =>
    !filter || p.Package?.toLowerCase().includes(filter.toLowerCase()) || p.Name?.toLowerCase().includes(filter.toLowerCase())
  ) || []

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', gap:8 }}>
        <input className="input" style={{ flex:1 }} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://repo.example.com" onKeyDown={e => e.key === 'Enter' && fetch_()} />
        <button className="btn btn-primary btn-sm" onClick={fetch_}>{loading ? <Spinner size={12} /> : 'Fetch'}</button>
      </div>
      {error && <Card accent="red">{error}</Card>}
      {result && (
        <>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <Tag color="blue">{result.count} packages</Tag>
            <input className="input" style={{ flex:1 }} placeholder="Filter by name..." value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
          <Card>
            {filtered.slice(0, 200).map((p, i) => (
              <div key={i} style={{ padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ fontWeight:600, fontSize:13 }}>{p.Name || p.Package}</span>
                  <span style={{ fontSize:11, color:'var(--text3)' }}>{p.Version}</span>
                </div>
                <div style={{ fontSize:11, color:'var(--text3)' }}>{p.Package} · {p.Author || p.Maintainer || 'unknown author'}</div>
                {p.Description && <div style={{ fontSize:11, color:'var(--text2)', marginTop:2 }}>{p.Description.slice(0,140)}</div>}
              </div>
            ))}
          </Card>
        </>
      )}
      {!result && !loading && !error && <Empty text="Enter a repo base URL and click Fetch" sub="Looks for a Packages control-file index at the standard paths" />}
    </div>
  )
}

function IpaTab() {
  const [path, setPath] = useState('')
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const pick = async () => {
    const p = await ft.repo.pickIpa()
    if (!p) return
    setPath(p); setLoading(true)
    try { setInfo(await ft.repo.inspectIpa(p)) } catch (e) { setInfo({ ok: false, error: e.message }) }
    setLoading(false)
  }
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <button className="btn btn-primary btn-sm" onClick={pick} style={{ alignSelf:'flex-start' }}>Choose .ipa File</button>
      {path && <div style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)' }}>{path}</div>}
      {loading && <Spinner />}
      {info?.ok && (
        <Card>
          <InfoLine label="Bundle ID" value={info.info?.bundleId} />
          <InfoLine label="Name" value={info.info?.name} />
          <InfoLine label="Version" value={`${info.info?.version} (${info.info?.build})`} />
          <InfoLine label="Min iOS" value={info.info?.minOS} />
          <InfoLine label="Executable" value={info.info?.executable} />
          <InfoLine label="Size" value={fmtSize(info.sizeBytes)} />
          <InfoLine label="Files" value={info.fileCount} />
          <InfoLine label="Provisioning profile" value={info.hasProvisioningProfile ? 'present (sideloadable/dev-signed)' : 'none embedded'} />
        </Card>
      )}
      {info && !info.ok && <Card accent="red">{info.error}</Card>}
      {!path && <Empty text="No IPA selected" />}
    </div>
  )
}

function InfoLine({ label, value }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
      <span style={{ color:'var(--text3)' }}>{label}</span>
      <span style={{ fontFamily:'var(--font-mono)', textAlign:'right', wordBreak:'break-all' }}>{value ?? '--'}</span>
    </div>
  )
}
function fmtSize(n) {
  if (!n) return '--'
  if (n < 1024*1024) return (n/1024).toFixed(0) + ' KB'
  return (n/1024/1024).toFixed(1) + ' MB'
}
