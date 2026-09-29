import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Spinner, Tag } from './_shared.jsx'


export default function SqliteBrowser({ device, addLog }) {
  const [dbInfo, setDbInfo] = useState(null)
  const [activeTable, setActiveTable] = useState(null)
  const [rows, setRows] = useState([])
  const [sql, setSql] = useState('')
  const [queryResult, setQueryResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('browse')
  const [appDbs, setAppDbs] = useState([])
  const [currentPath, setCurrentPath] = useState('')

  const openFile = async () => {
    setLoading(true)
    try {
      const info = await ft.sqlite.open({})
      if (!info?.cancelled) { setDbInfo(info); setCurrentPath(info.path); setActiveTable(null); setRows([]) }
    } catch (e) { addLog('SQLite: ' + e.message) }
    setLoading(false)
  }

  const loadTable = async (table) => {
    setActiveTable(table)
    setLoading(true)
    try {
      const res = await ft.sqlite.query({ dbPath: currentPath, sql: `SELECT * FROM "${table.name}" LIMIT 500` })
      setRows(res.rows || [])
    } catch (e) { addLog('Query: ' + e.message) }
    setLoading(false)
  }

  const runQuery = async () => {
    if (!sql.trim() || !currentPath) return
    setLoading(true)
    try {
      const isWrite = /^(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)/i.test(sql.trim())
      const res = isWrite ? await ft.sqlite.write({ dbPath: currentPath, sql }) : await ft.sqlite.query({ dbPath: currentPath, sql })
      setQueryResult(res)
    } catch (e) { addLog('Query: ' + e.message) }
    setLoading(false)
  }

  const exportCsv = async () => {
    if (!activeTable) return
    const res = await ft.sqlite.exportCsv({ dbPath: currentPath, table: activeTable.name })
    if (!res?.cancelled) addLog('Exported: ' + res?.path)
  }

  const findDeviceDbs = async () => {
    if (!device?.serial) return
    setLoading(true)
    const dbs = await ft.sqlite.findAppDbs({ serial: device.serial })
    setAppDbs(dbs)
    setLoading(false)
  }

  const pullDb = async (remotePath) => {
    setLoading(true)
    try {
      const res = await ft.sqlite.pullAndOpen({ serial: device?.serial, remotePath })
      if (!res?.cancelled) { setDbInfo(res); setCurrentPath(res.path); setActiveTable(null); setRows([]) }
    } catch (e) { addLog('Pull: ' + e.message) }
    setLoading(false)
  }

  const cols = rows.length > 0 ? Object.keys(rows[0]) : []

  return (
    <PageWrap>
      <PageHeader title="SQLite Browser" icon=" " sub="Browse, query and export any SQLite database" />

      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <button className="btn btn-primary" onClick={openFile} disabled={loading}>  Open DB File</button>
        <button className="btn btn-blue" onClick={findDeviceDbs} disabled={!device || loading}>  Find Device DBs</button>
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3, width:'fit-content' }}>
        {[['browse','Browse'],['query','SQL Query'],['device','Device DBs']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:'6px 12px', borderRadius:6, fontSize:12, fontWeight:500, cursor:'pointer',
            background: tab===id ? 'var(--bg4)' : 'none',
            color: tab===id ? 'var(--text)' : 'var(--text3)',
            border: tab===id ? '1px solid var(--border)' : '1px solid transparent'
          }}>{label}</button>
        ))}
      </div>

      {tab === 'browse' && (
        <div style={{ display:'flex', gap:12, flex:1, minHeight:350, overflow:'hidden' }}>
          {/* Table list */}
          {dbInfo && (
            <div style={{ width:180, flexShrink:0, overflowY:'auto' }}>
              <div style={{ fontSize:11, color:'var(--text3)', fontWeight:700, letterSpacing:'0.08em', marginBottom:8 }}>
                {dbInfo.filename}
              </div>
              {dbInfo.tables?.map(t => (
                <button key={t.name} onClick={() => loadTable(t)} style={{
                  width:'100%', padding:'7px 10px', textAlign:'left', borderRadius:6, fontSize:12, cursor:'pointer', marginBottom:2,
                  background: activeTable?.name === t.name ? 'var(--accent-dim)' : 'var(--bg2)',
                  border: `1px solid ${activeTable?.name === t.name ? 'var(--accent-border)' : 'var(--border)'}`,
                  color: activeTable?.name === t.name ? 'var(--accent)' : 'var(--text2)'
                }}>
                  <div style={{ fontWeight:500 }}>{t.name}</div>
                  <div style={{ fontSize:10, color:'var(--text3)', marginTop:1 }}>{t.rowCount.toLocaleString()} rows   {t.columns.length} cols</div>
                </button>
              ))}
            </div>
          )}

          {/* Table data */}
          <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', gap:8 }}>
            {activeTable && (
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <span style={{ fontSize:13, fontWeight:600 }}>{activeTable.name}</span>
                <Tag color="blue">{rows.length} rows</Tag>
                <button className="btn btn-sm" onClick={exportCsv}>  Export CSV</button>
              </div>
            )}
            {loading && <div className="empty"><Spinner/></div>}
            {!loading && rows.length > 0 && (
              <div style={{ flex:1, overflow:'auto', border:'1px solid var(--border)', borderRadius:8 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, fontFamily:'var(--font-mono)' }}>
                  <thead>
                    <tr style={{ background:'var(--bg2)', position:'sticky', top:0 }}>
                      {cols.map(c => <th key={c} style={{ padding:'6px 10px', textAlign:'left', borderBottom:'1px solid var(--border)', color:'var(--text3)', fontWeight:600, whiteSpace:'nowrap' }}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} style={{ borderBottom:'1px solid var(--border)', background: i%2===0 ? 'transparent' : 'var(--bg2)' }}>
                        {cols.map(c => (
                          <td key={c} style={{ padding:'4px 10px', color:'var(--text2)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
                            title={String(row[c] ?? '')}>
                            {row[c] == null ? <span style={{ color:'var(--text3)' }}>NULL</span> : String(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && !dbInfo && <Empty icon=" " text="Open a SQLite database file" sub="Supports .db .sqlite .sqlite3 .db3" />}
          </div>
        </div>
      )}

      {tab === 'query' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {!currentPath && <div style={{ fontSize:12, color:'var(--text3)' }}>Open a database file first</div>}
          <textarea value={sql} onChange={e => setSql(e.target.value)}
            placeholder="SELECT * FROM users LIMIT 100;"
            style={{ width:'100%', height:120, fontFamily:'var(--font-mono)', fontSize:12, background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:8, padding:10, resize:'vertical' }} />
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-primary" onClick={runQuery} disabled={loading || !currentPath}>  Run</button>
            <span style={{ fontSize:11, color:'var(--text3)', display:'flex', alignItems:'center' }}>Ctrl+Enter to run   SELECT and write statements supported</span>
          </div>
          {queryResult && (
            queryResult.success
              ? queryResult.rows?.length > 0
                ? <div style={{ overflow:'auto', border:'1px solid var(--border)', borderRadius:8, maxHeight:300 }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11, fontFamily:'var(--font-mono)' }}>
                      <thead><tr style={{ background:'var(--bg2)' }}>{Object.keys(queryResult.rows[0]).map(c => <th key={c} style={{ padding:'5px 10px', borderBottom:'1px solid var(--border)', color:'var(--text3)', textAlign:'left' }}>{c}</th>)}</tr></thead>
                      <tbody>{queryResult.rows.map((row, i) => <tr key={i} style={{ borderBottom:'1px solid var(--border)' }}>{Object.values(row).map((v, j) => <td key={j} style={{ padding:'4px 10px', color:'var(--text2)' }}>{v == null ? 'NULL' : String(v)}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                : <div style={{ fontSize:12, color:'var(--green)' }}>  {queryResult.changes ?? 0} rows affected</div>
              : <div style={{ fontSize:12, color:'var(--red)', padding:8, background:'var(--red-dim)', borderRadius:6 }}>{queryResult.error}</div>
          )}
        </div>
      )}

      {tab === 'device' && (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Databases found on connected Android device (root required for /data/data)</div>
          {loading && <Empty icon="" text="Scanning..."><Spinner/></Empty>}
          {appDbs.map((db, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--bg2)', borderRadius:6 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, fontWeight:500 }}>{db.name}</div>
                <div style={{ fontSize:10, fontFamily:'var(--font-mono)', color:'var(--text3)' }}>{db.path}</div>
              </div>
              <Tag color="gray">{db.app}</Tag>
              <button className="btn btn-primary btn-sm" onClick={() => pullDb(db.path)}>Pull & Open</button>
            </div>
          ))}
          {!loading && !appDbs.length && <Empty icon=" " text="Click 'Find Device DBs' to scan" />}
        </div>
      )}
    </PageWrap>
  )
}
