import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty } from './_shared.jsx'


export default function ADBLibrary({ device, addLog }) {
  const [library, setLibrary] = useState({})
  const [activeGroup, setActiveGroup] = useState('')
  const [filter, setFilter] = useState('')
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(null)

  useEffect(() => {
    ft.adblib.all().then(lib => {
      setLibrary(lib)
      setActiveGroup(Object.keys(lib)[0] || '')
    }).catch(() => {})
  }, [])

  const run = async (cmd) => {
    if (!device?.serial) return addLog('No Android device connected')
    setRunning(cmd)
    try {
      const result = await ft.adb.shell({ serial: device.serial, cmd })
      setOutput(result)
      addLog('Ran: ' + cmd.slice(0, 40))
    } catch (e) { setOutput('Error: ' + e.message) }
    setRunning(null)
  }

  const groups = Object.keys(library)
  const commands = (library[activeGroup] || []).filter(c =>
    !filter || c.cmd.toLowerCase().includes(filter.toLowerCase()) || c.desc.toLowerCase().includes(filter.toLowerCase()))

  return (
    <PageWrap>
      <PageHeader title="ADB Command Library" icon=" " sub="200+ commands -- click to run on connected device" />
      <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search commands..." />

      <div style={{ display:'flex', gap:12, flex:1, overflow:'hidden', minHeight:350 }}>
        {/* Groups */}
        <div style={{ width:140, flexShrink:0, display:'flex', flexDirection:'column', gap:3 }}>
          {groups.map(g => (
            <button key={g} onClick={() => setActiveGroup(g)} style={{
              padding:'7px 10px', borderRadius:6, fontSize:12, fontWeight:500, textAlign:'left', cursor:'pointer',
              background: activeGroup===g ? 'var(--accent-dim)' : 'var(--bg2)',
              border: `1px solid ${activeGroup===g ? 'var(--accent-border)' : 'var(--border)'}`,
              color: activeGroup===g ? 'var(--accent)' : 'var(--text2)'
            }}>{g}</button>
          ))}
        </div>

        {/* Commands */}
        <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
          {!commands.length && <Empty icon=" " text="No commands match" />}
          {commands.map((c, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--bg2)', borderRadius:6 }}>
              <code style={{ flex:1, fontFamily:'var(--mono)', fontSize:12, color:'#a8ff78' }}>{c.cmd}</code>
              <span style={{ fontSize:11, color:'var(--text3)', flexShrink:0, maxWidth:200, textAlign:'right' }}>{c.desc}</span>
              <button className="btn btn-sm" style={{ padding:'3px 8px', fontSize:11 }}
                onClick={() => navigator.clipboard?.writeText(c.cmd)}>Copy</button>
              <button className="btn btn-primary btn-sm" style={{ padding:'3px 8px', fontSize:11 }}
                disabled={!!running} onClick={() => run(c.cmd)}>
                {running === c.cmd ? '...' : 'Run'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {output && (
        <div>
          <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>Output</div>
          <div className="terminal selectable" style={{ maxHeight:150, overflowY:'auto' }}>{output}</div>
        </div>
      )}
    </PageWrap>
  )
}
