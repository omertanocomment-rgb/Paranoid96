import { useState } from 'react'
const ft = window.ft

export default function CryptoTool({ device, addLog }) {
  const [results, setResults] = useState([])
  const [verify, setVerify] = useState({ hash:'', expected:'', algo:'SHA-256' })
  const [verifyResult, setVerifyResult] = useState(null)
  const [certOutput, setCertOutput] = useState('')
  const [pkgInput, setPkgInput] = useState('')
  const [loading, setLoading] = useState(null)
  const [tab, setTab] = useState('hash')
  const serial = device?.serial

  const hashFiles = async () => {
    setLoading('hash')
    const r = await ft.crypto.hashFile().catch(e => ({ error:e.message }))
    if (r.cancelled) { setLoading(null); return }
    if (r.success) { setResults(r.results); addLog(`Hashed ${r.results.length} file(s)`) }
    else addLog('Error: ' + r.error)
    setLoading(null)
  }

  const doVerify = () => {
    const match = verify.hash.trim().toLowerCase() === verify.expected.trim().toLowerCase()
    setVerifyResult({ match, hash: verify.hash.trim(), expected: verify.expected.trim() })
  }

  const getApkCert = async () => {
    if (!pkgInput.trim() || !serial) return
    setLoading('cert')
    const r = await ft.crypto.deviceApkCert({ serial, pkg: pkgInput.trim() }).catch(e => ({ error:e.message }))
    setCertOutput(r.output || r.error || 'No output')
    addLog(r.success ? 'Certificate info retrieved' : 'Error: '+r.error)
    setLoading(null)
  }

  const getLocalCert = async () => {
    setLoading('localcert')
    const r = await ft.crypto.apkCert({}).catch(e => ({ error:e.message }))
    if (!r.cancelled) setCertOutput(r.output || r.error)
    setLoading(null)
  }

  const copy = (text) => { navigator.clipboard.writeText(text).catch(()=>{}); addLog('Copied') }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Crypto & Hash Tool</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Verify ROM integrity, check APK signatures, hash any file</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:3 }}>
        {[['hash','File Hash'],['verify','Verify'],['cert','APK Cert']].map(([id,l]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'7px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{l}</button>
        ))}
      </div>

      {tab === 'hash' && (
        <>
          <button onClick={hashFiles} disabled={loading==='hash'} style={{ padding:'10px', borderRadius:9, fontSize:13, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
            {loading==='hash' ? 'Hashing...' : 'Choose File(s) to Hash'}
          </button>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Supports any file type. Drag ROMs, APKs, ZIPs here or click to browse. Calculates MD5, SHA-1, SHA-256, SHA-512.</div>
          {results.map((r, i) => (
            <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text)', marginBottom:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.file.replace(/.*[\/\\]/, '')}</div>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:8 }}>Size: {(r.size/1e6).toFixed(2)} MB</div>
              {[['MD5',r.md5],['SHA-1',r.sha1],['SHA-256',r.sha256],['SHA-512',r.sha512]].map(([algo,hash]) => (
                <div key={algo} style={{ marginBottom:6 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'var(--text3)', marginBottom:2 }}>{algo}</div>
                  <div style={{ display:'flex', gap:6 }}>
                    <div style={{ fontFamily:'monospace', fontSize:10, color:'var(--accent)', wordBreak:'break-all', flex:1, padding:'4px 8px', background:'var(--bg2)', borderRadius:5, border:'1px solid var(--border)' }}>{hash}</div>
                    <button onClick={() => copy(hash)} style={{ padding:'4px 8px', borderRadius:5, fontSize:9, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)', flexShrink:0 }}>Copy</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {tab === 'verify' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:10 }}>VERIFY FILE INTEGRITY</div>
            <div style={{ marginBottom:8 }}>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Your hash (paste from hash tab above)</div>
              <textarea value={verify.hash} onChange={e=>setVerify(v=>({...v,hash:e.target.value}))} rows={2} style={{ width:'100%', fontFamily:'monospace', fontSize:11, padding:8, background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:6, resize:'none', boxSizing:'border-box' }} placeholder="Paste computed hash here..." />
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Expected hash (from download page / release notes)</div>
              <textarea value={verify.expected} onChange={e=>setVerify(v=>({...v,expected:e.target.value}))} rows={2} style={{ width:'100%', fontFamily:'monospace', fontSize:11, padding:8, background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:6, resize:'none', boxSizing:'border-box' }} placeholder="Paste expected hash here..." />
            </div>
            <button onClick={doVerify} disabled={!verify.hash||!verify.expected} style={{ padding:'8px 18px', borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Verify</button>
          </div>
          {verifyResult && (
            <div style={{ padding:16, borderRadius:10, border:`2px solid ${verifyResult.match?'#4ade80':'#f87171'}`, background:verifyResult.match?'rgba(74,222,128,0.1)':'rgba(248,113,113,0.1)', textAlign:'center' }}>
              <div style={{ fontSize:32, marginBottom:8 }}>{verifyResult.match ? ' ' : ' '}</div>
              <div style={{ fontSize:16, fontWeight:700, color:verifyResult.match?'#4ade80':'#f87171' }}>{verifyResult.match ? 'MATCH -- File is genuine' : 'MISMATCH -- File may be corrupted or tampered'}</div>
              {!verifyResult.match && <div style={{ fontSize:12, color:'var(--text3)', marginTop:8 }}>Do NOT flash this ROM. Re-download from official source.</div>}
            </div>
          )}
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            <strong style={{ color:'var(--text)' }}>Why verify?</strong> Always verify SHA-256 hashes of ROMs before flashing. A corrupted or tampered ROM can brick your device or install malware. Official sources (LineageOS, GrapheneOS, Google) publish SHA-256 checksums next to downloads.
          </div>
        </div>
      )}

      {tab === 'cert' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', marginBottom:10 }}>APK CERTIFICATE (ON DEVICE)</div>
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <input value={pkgInput} onChange={e=>setPkgInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&getApkCert()} placeholder="com.example.app" style={{ flex:1, fontFamily:'monospace', fontSize:12 }} />
              <button onClick={getApkCert} disabled={!serial||!pkgInput||loading==='cert'} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none', opacity:!serial?0.5:1 }}>{loading==='cert'?'...':'Get Cert'}</button>
            </div>
            <button onClick={getLocalCert} disabled={loading==='localcert'} style={{ padding:'6px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)' }}>
              {loading==='localcert'?'...':'Inspect local APK file...'}
            </button>
          </div>
          {certOutput && (
            <div style={{ fontFamily:'monospace', fontSize:11, background:'#0a0a0a', border:'1px solid var(--border)', borderRadius:8, padding:12, whiteSpace:'pre-wrap', wordBreak:'break-all', color:'#d4d4d4', lineHeight:1.8, maxHeight:300, overflowY:'auto' }}>
              {certOutput}
            </div>
          )}
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14, fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
            <strong style={{ color:'var(--text)' }}>APK signing</strong> -- Every APK is signed with a certificate. Verify that updates are signed by the same key as the original install to detect supply chain attacks. Signature mismatch = reject the update.
          </div>
        </div>
      )}
    </div>
  )
}
