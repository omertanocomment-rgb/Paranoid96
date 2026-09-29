import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner } from './_shared.jsx'


export default function FileManager({ device, addLog }) {
  const [path, setPath] = useState('/sdcard')
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(new Set())

  const serial = device?.serial || device?.udid

  const load = async (p = path) => {
    if (!device) return
    setLoading(true)
    try {
      const list = await ft.files.list({ serial, type: device.deviceType, path: p })
      setFiles(list || [])
      setPath(p)
      setSelected(new Set())
    } catch (e) { addLog('Files: ' + e.message) }
    setLoading(false)
  }

  useEffect(() => { load() }, [device?.serial, device?.udid])

  const goUp = () => {
    const parts = path.split('/')
    if (parts.length > 2) load(parts.slice(0, -1).join('/'))
  }

  const toggle = name => setSelected(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n })

  const importFiles = async () => {
    try {
      const r = await ft.files.import({ serial, type: device.deviceType, remotePath: path })
      if (!r?.cancelled) { addLog(`Imported ${r.count} file(s)`); load() }
    } catch (e) { addLog('Import: ' + e.message) }
  }

  const exportFiles = async () => {
    const paths = files.filter(f => selected.has(f.name)).map(f => f.path)
    try {
      const r = await ft.files.export({ serial, type: device.deviceType, remotePaths: paths })
      if (!r?.cancelled) addLog('Exported to: ' + r.dest)
    } catch (e) { addLog('Export: ' + e.message) }
  }

  const deleteFiles = async () => {
    for (const name of selected) {
      await ft.files.delete({ serial, type: device.deviceType, path: path + '/' + name }).catch(() => {})
    }
    setSelected(new Set())
    load()
  }

  const fmt = size => {
    if (!size) return ''
    if (size > 1048576) return (size / 1048576).toFixed(1) + ' MB'
    if (size > 1024) return (size / 1024).toFixed(0) + ' KB'
    return size + ' B'
  }

  return (
    <PageWrap>
      <PageHeader title="File Manager" icon=" " />

      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <button className="btn btn-sm" onClick={goUp}>  Up</button>
        <div style={{ flex:1, fontFamily:'var(--mono)', fontSize:12, color:'var(--text3)', padding:'5px 10px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{path}</div>
        <button className="btn btn-sm" onClick={() => load()}> </button>
        <button className="btn btn-sm" onClick={importFiles}>  Import</button>
        {selected.size > 0 && <>
          <button className="btn btn-sm btn-blue" onClick={exportFiles}>  Export ({selected.size})</button>
          <button className="btn btn-sm btn-red" onClick={deleteFiles}>  Delete</button>
        </>}
      </div>

      <div style={{ flex:1, overflowY:'auto', minHeight:300, display:'flex', flexDirection:'column', gap:1 }}>
        {loading && <Empty icon="" text="Loading..." />}
        {!loading && !files.length && <Empty icon=" " text="Empty folder" />}
        {files.map(f => (
          <div key={f.name}
            style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 10px', borderRadius:6,
              background: selected.has(f.name) ? 'var(--accent-dim)' : 'transparent',
              cursor:'pointer', transition:'background 0.1s' }}
            onDoubleClick={() => f.isDir && load(f.path)}>
            <div onClick={e => { e.stopPropagation(); toggle(f.name) }}
              style={{ width:16, height:16, borderRadius:4, flexShrink:0, background: selected.has(f.name) ? 'var(--accent)' : 'var(--bg2)', border:`1px solid ${selected.has(f.name) ? 'var(--accent)' : 'var(--border2)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {selected.has(f.name) && <span style={{ color:'#000', fontSize:9 }}> </span>}
            </div>
            <span style={{ fontSize:15, width:20, textAlign:'center' }}>{f.isDir ? ' ' : f.isSymlink ? ' ' : ' '}</span>
            <span style={{ flex:1, fontSize:12, color:'var(--text)', fontFamily:'var(--mono)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
            <span style={{ fontSize:11, color:'var(--text3)', flexShrink:0 }}>{fmt(f.size)}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize:11, color:'var(--text3)' }}>{files.length} items   double-click folders to open</div>
    </PageWrap>
  )
}
