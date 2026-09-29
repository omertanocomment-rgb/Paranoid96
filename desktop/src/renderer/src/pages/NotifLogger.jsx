import { useState, useEffect, useRef } from 'react'
const ft = window.ft

export default function NotifLogger({ device, addLog }) {
  const [entries, setEntries] = useState([])
  const [running, setRunning] = useState(false)
  const [search, setSearch] = useState('')
  const listRef = useRef(null)
  const serial = device?.serial

  useEffect(() => {
    const unsub = ft.on('notif:entry', e => {
      setEntries(prev => [...prev.slice(-499), e])
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    })
    return () => { unsub(); if (serial) ft.notifLogger.stop({ serial }).catch(() => {}) }
  }, [serial])

  const toggle = async () => {
    if (running) {
      await ft.notifLogger.stop({ serial }).catch(() => {})
      setRunning(false)
      addLog('Notification logger stopped')
    } else {
      const r = await ft.notifLogger.start({ serial }).catch(e => ({ error: e.message }))
      if (r.success) { setRunning(true); addLog('Notification logger started') }
      else addLog('Error: ' + r.error)
    }
  }

  const clear = async () => {
    await ft.notifLogger.clear({ serial }).catch(() => {})
    setEntries([])
  }

  const filtered = entries.filter(e => !search || e.raw.toLowerCase().includes(search.toLowerCase()))

  const fmtTime = ts => {
    const d = new Date(ts)
    return d.toTimeString().slice(0, 8)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px', height: '100%', overflowY: 'hidden', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 24 }}> </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>Notification Logger</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>Capture all device notifications in real time</div>
        </div>
        {running && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#4ade80' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80' }} />
          Live
        </div>}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={toggle} disabled={!serial}
          style={{ padding: '8px 18px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: !serial ? 'not-allowed' : 'pointer', background: running ? 'rgba(248,113,113,0.15)' : 'var(--accent)', color: running ? '#f87171' : '#000', border: running ? '1px solid rgba(248,113,113,0.3)' : 'none', opacity: !serial ? 0.5 : 1 }}>
          {running ? 'Stop Logging' : 'Start Logging'}
        </button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter notifications..." style={{ flex: 1 }} />
        {entries.length > 0 && <button onClick={clear} style={{ padding: '7px 12px', borderRadius: 7, fontSize: 11, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border)' }}>Clear ({entries.length})</button>}
      </div>

      {!serial && <div style={{ padding: 14, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, fontSize: 13, color: '#f59e0b' }}>Connect an Android device.</div>}

      {!running && !entries.length && serial && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text3)' }}>Click Start Logging to capture notifications from the device.</div>
      )}

      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, background: '#0a0a0a', border: '1px solid var(--border)', borderRadius: 8, padding: 10, lineHeight: 1.8 }}>
        {filtered.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, borderBottom: '1px solid #ffffff0a', padding: '2px 0' }}>
            <span style={{ color: '#555', flexShrink: 0 }}>{fmtTime(e.ts)}</span>
            <span style={{ color: '#d4d4d4' }}>{e.raw}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
