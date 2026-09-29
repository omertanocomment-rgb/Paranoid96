import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Tag } from './_shared.jsx'


export default function ClipboardSync({ device, addLog }) {
  const [deviceText, setDeviceText] = useState('')
  const [pcText, setPcText] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [history, setHistory] = useState([])
  const serial = device?.serial

  useEffect(() => {
    const r = ft.on('clipboard:update', ({ text }) => {
      setDeviceText(text)
      setHistory(h => [{ text, time: new Date().toLocaleTimeString(), from: 'device' }, ...h.slice(0, 19)])
    })
    return () => { r(); if (syncing) ft.clipboard.stopSync() }
  }, [syncing])

  const getClip = async () => {
    const text = await ft.clipboard.get({ serial }).catch(e => { addLog(e.message); return null })
    if (text) { setDeviceText(text); setHistory(h => [{ text, time: new Date().toLocaleTimeString(), from: 'device' }, ...h.slice(0,19)]) }
    else addLog('Could not read device clipboard (may require accessibility service)')
  }

  const push = async () => {
    if (!pcText) return
    await ft.clipboard.set({ serial, text: pcText }).catch(e => addLog(e.message))
    addLog('Text pushed to device clipboard')
    setHistory(h => [{ text: pcText, time: new Date().toLocaleTimeString(), from: 'pc' }, ...h.slice(0,19)])
  }

  const toggleSync = async () => {
    if (syncing) { await ft.clipboard.stopSync(); setSyncing(false); addLog('Clipboard sync stopped') }
    else { await ft.clipboard.startSync({ serial }); setSyncing(true); addLog('Clipboard sync started') }
  }

  return (
    <PageWrap>
      <PageHeader title="Clipboard Sync" icon=" " sub="Share clipboard between device and PC in real time" />

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={getClip} disabled={!device}>  Get from Device</button>
        <button className="btn btn-sm" onClick={toggleSync} disabled={!device}
          style={{ background: syncing ? 'var(--green-dim)' : undefined, color: syncing ? 'var(--green)' : undefined }}>
          {syncing ? '  Stop Sync' : '  Start Auto-Sync'}
        </button>
        {syncing && <Tag color="green">  Live</Tag>}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <div className="card">
          <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Device Clipboard</div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text2)', background:'var(--bg)', padding:10, borderRadius:6, minHeight:80, whiteSpace:'pre-wrap', wordBreak:'break-all' }}>
            {deviceText || <span style={{ color:'var(--text3)' }}>Empty -- click Get from Device</span>}
          </div>
          {deviceText && <button className="btn btn-sm" style={{ marginTop:8 }} onClick={() => navigator.clipboard?.writeText(deviceText)}>Copy to PC</button>}
        </div>
        <div className="card">
          <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>PC   Device</div>
          <textarea value={pcText} onChange={e => setPcText(e.target.value)} placeholder="Type text to push to device..." style={{ width:'100%', height:80, fontFamily:'var(--font-mono)', fontSize:12, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:6, padding:8, resize:'none' }} />
          <button className="btn btn-primary btn-sm" style={{ marginTop:8 }} onClick={push} disabled={!device || !pcText}>Push to Device</button>
        </div>
      </div>

      {history.length > 0 && (
        <div>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>History</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {history.map((h, i) => (
              <div key={i} style={{ display:'flex', gap:10, alignItems:'center', padding:'6px 10px', background:'var(--bg2)', borderRadius:6 }}>
                <Tag color={h.from==='device' ? 'blue' : 'green'}>{h.from==='device' ? ' ' : ' '}</Tag>
                <span style={{ flex:1, fontSize:12, fontFamily:'var(--font-mono)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'var(--text2)' }}>{h.text}</span>
                <span style={{ fontSize:10, color:'var(--text3)', flexShrink:0 }}>{h.time}</span>
                <button className="btn btn-sm" style={{ padding:'2px 6px', fontSize:10 }} onClick={() => navigator.clipboard?.writeText(h.text)}>Copy</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageWrap>
  )
}
