import { useState } from 'react'
const ft = window.ft

export default function HashVerify({ device, addLog }) {
  const [results, setResults] = useState([])
  const [verifyHash, setVerifyHash] = useState('')
  const [verifyAlgo, setVerifyAlgo] = useState('sha256')
  const [verifyResult, setVerifyResult] = useState(null)
  const [loading, setLoading] = useState(null)

  const hashFiles = async () => {
    setLoading('hash')
    const r = await ft.hashTool.file({}).catch(e => ({ error: e.message }))
    if (r.cancelled) { setLoading(null); return }
    if (r.success) { setResults(r.results); addLog(`Hashed ${r.results.length} file(s)`) }
    else addLog('Error: ' + r.error)
    setLoading(null)
  }

  const verify = async () => {
    if (!verifyHash.trim()) return
    setLoading('verify')
    setVerifyResult(null)
    const r = await ft.hashTool.verify({ algo: verifyAlgo, expected: verifyHash.trim() }).catch(e => ({ error: e.message }))
    if (r.cancelled) { setLoading(null); return }
    setVerifyResult(r)
    addLog(r.success ? (r.match ? 'MATCH - file is intact' : 'MISMATCH - file may be corrupted or tampered') : 'Error: ' + r.error)
    setLoading(null)
  }

  const checkApk = async () => {
    setLoading('apk')
    const r = await ft.hashTool.apkCert({}).catch(e => ({ error: e.message }))
    if (r.cancelled) { setLoading(null); return }
    if (r.success) {
      setResults([{ file: r.file, size: r.size, sha256: r.sha256, apkCert: r.certInfo }])
      addLog('APK cert checked: ' + r.file.split(/[\/]/).pop())
    } else addLog('Error: ' + r.error)
    setLoading(null)
  }

  const copy = (text) => { navigator.clipboard.writeText(text).catch(() => {}); addLog('Copied to clipboard') }

  const fmtSize = b => b > 1e9 ? (b/1e9).toFixed(2)+' GB' : b > 1e6 ? (b/1e6).toFixed(1)+' MB' : (b/1e3).toFixed(0)+' KB'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 24 }}> </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>Hash Verify</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Verify ROM and APK integrity before flashing</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={hashFiles} disabled={loading === 'hash'} style={{ padding: '8px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--accent)', color: '#000', border: 'none' }}>
          {loading === 'hash' ? 'Hashing...' : 'Hash Files'}
        </button>
        <button onClick={checkApk} disabled={loading === 'apk'} style={{ padding: '8px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.3)' }}>
          {loading === 'apk' ? 'Checking...' : 'Check APK Signature'}
        </button>
        {results.length > 0 && <button onClick={() => setResults([])} style={{ padding: '8px 12px', borderRadius: 7, fontSize: 11, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border)' }}>Clear</button>}
      </div>

      <div style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', marginBottom: 10 }}>VERIFY HASH</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>Paste expected hash from ROM site, then select file to verify</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <select value={verifyAlgo} onChange={e => setVerifyAlgo(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12 }}>
            {['md5', 'sha1', 'sha256', 'sha512'].map(a => <option key={a} value={a}>{a.toUpperCase()}</option>)}
          </select>
          <input value={verifyHash} onChange={e => setVerifyHash(e.target.value)} placeholder="Paste expected hash here..." style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }} />
          <button onClick={verify} disabled={loading === 'verify' || !verifyHash.trim()} style={{ padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--accent)', color: '#000', border: 'none' }}>
            {loading === 'verify' ? 'Verifying...' : 'Verify File'}
          </button>
        </div>
        {verifyResult && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: verifyResult.match ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${verifyResult.match ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}` }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: verifyResult.match ? '#4ade80' : '#f87171', marginBottom: 6 }}>
              {verifyResult.match ? 'VERIFIED - File is intact' : 'MISMATCH - File may be corrupted or tampered'}
            </div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text3)' }}>
              <div>Expected: <span style={{ color: 'var(--text2)' }}>{verifyResult.expected}</span></div>
              <div>Computed: <span style={{ color: verifyResult.match ? '#4ade80' : '#f87171' }}>{verifyResult.computed}</span></div>
            </div>
          </div>
        )}
      </div>

      {results.map((r, i) => (
        <div key={i} style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{r.file.split(/[\/]/).pop()}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>{fmtSize(r.size)}</div>
          {r.apkCert && (
            <div style={{ padding: '8px 12px', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 7, marginBottom: 10, fontSize: 11 }}>
              <div style={{ color: '#a78bfa', fontWeight: 600, marginBottom: 4 }}>APK Certificate</div>
              <div style={{ color: 'var(--text3)' }}>Cert file: {r.apkCert.certFile}</div>
              <div style={{ color: 'var(--text3)', fontFamily: 'monospace', fontSize: 10, marginTop: 3 }}>{r.apkCert.sha256}</div>
            </div>
          )}
          {['md5', 'sha1', 'sha256', 'sha512'].filter(a => r[a]).map(algo => (
            <div key={algo} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)44' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', width: 48, flexShrink: 0 }}>{algo.toUpperCase()}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--accent)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r[algo]}</span>
              <button onClick={() => copy(r[algo])} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border)', flexShrink: 0 }}>Copy</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
