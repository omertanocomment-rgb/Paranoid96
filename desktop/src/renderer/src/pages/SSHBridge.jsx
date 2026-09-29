import { useState, useEffect, useRef, useCallback } from 'react'
import { ft, PageWrap, PageHeader, TabBar, Card, Section, Empty, Tag, Spinner } from './_shared.jsx'

export default function SSHBridge() {
  const [tab, setTab] = useState('hosts')
  const [hosts, setHosts] = useState([])
  const [activeHost, setActiveHost] = useState(null)

  const refresh = useCallback(async () => {
    try { setHosts(await ft.ssh.hostsList()) } catch {}
  }, [])
  useEffect(() => { refresh() }, [refresh])

  return (
    <PageWrap>
      <PageHeader title="SSH Bridge" icon=" " sub="Terminal + SFTP bridge for jailbroken iPhones (palera1n/checkra1n), Termux nodes, and any generic SSH host" />
      <TabBar tabs={[['hosts','Saved Hosts'],['terminal','Terminal'],['sftp','SFTP Browser']]} active={tab} onChange={setTab} />
      {tab === 'hosts' && <HostsTab hosts={hosts} refresh={refresh} onOpen={(h) => { setActiveHost(h); setTab('terminal') }} />}
      {tab === 'terminal' && <TerminalTab hosts={hosts} activeHost={activeHost} setActiveHost={setActiveHost} />}
      {tab === 'sftp' && <SftpTab hosts={hosts} activeHost={activeHost} setActiveHost={setActiveHost} />}
    </PageWrap>
  )
}

function HostsTab({ hosts, refresh, onOpen }) {
  const [form, setForm] = useState({ label: '', host: '', port: 22, username: 'root', password: '', privateKey: '', kind: 'ios-jailbreak', notes: '' })
  const [testing, setTesting] = useState(null)
  const [status, setStatus] = useState({})

  const save = async () => {
    if (!form.host) return
    await ft.ssh.hostsSave(form)
    setForm({ label: '', host: '', port: 22, username: 'root', password: '', privateKey: '', kind: 'ios-jailbreak', notes: '' })
    refresh()
  }
  const test = async (h) => {
    setTesting(h.id)
    const r = await ft.ssh.test({ hostId: h.id })
    setStatus(s => ({ ...s, [h.id]: r }))
    setTesting(null)
  }
  const del = async (id) => { await ft.ssh.hostsDelete(id); refresh() }

  return (
    <div style={{ display:'flex', gap:16 }}>
      <div style={{ flex:1 }}>
        <Section title="Add Host">
          <Card>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <Field label="Label" value={form.label} onChange={v => setForm({ ...form, label: v })} placeholder="Jailbroken iPhone 6" />
              <Field label="Kind">
                <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="input">
                  <option value="ios-jailbreak">iOS Jailbreak (palera1n/checkra1n)</option>
                  <option value="termux">Termux Node</option>
                  <option value="generic">Generic SSH</option>
                </select>
              </Field>
              <Field label="Host / IP" value={form.host} onChange={v => setForm({ ...form, host: v })} placeholder="192.168.1.50 or omertaiphone.duckdns.org" />
              <Field label="Port" value={form.port} onChange={v => setForm({ ...form, port: v })} type="number" />
              <Field label="Username" value={form.username} onChange={v => setForm({ ...form, username: v })} placeholder="root / mobile" />
              <Field label="Password" value={form.password} onChange={v => setForm({ ...form, password: v })} type="password" />
              <div style={{ gridColumn:'1 / -1' }}>
                <Field label="Private Key (optional, overrides password)" value={form.privateKey} onChange={v => setForm({ ...form, privateKey: v })} textarea />
              </div>
              <div style={{ gridColumn:'1 / -1' }}>
                <Field label="Notes" value={form.notes} onChange={v => setForm({ ...form, notes: v })} />
              </div>
            </div>
            <button className="btn btn-primary" style={{ marginTop:12 }} onClick={save}>Save Host</button>
          </Card>
        </Section>
      </div>
      <div style={{ flex:1 }}>
        <Section title="Saved Hosts">
          {!hosts.length ? <Empty icon=" " text="No hosts saved yet" /> : hosts.map(h => (
            <Card key={h.id} style={{ marginBottom:8 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:13 }}>{h.label}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{h.username}@{h.host}:{h.port}</div>
                </div>
                <Tag color={h.kind === 'ios-jailbreak' ? 'blue' : h.kind === 'termux' ? 'green' : 'gray'}>{h.kind}</Tag>
              </div>
              <div style={{ display:'flex', gap:6, marginTop:10 }}>
                <button className="btn btn-sm" onClick={() => onOpen(h)}>Open Terminal</button>
                <button className="btn btn-sm" onClick={() => test(h)}>{testing === h.id ? <Spinner size={12} /> : 'Test'}</button>
                <button className="btn btn-sm btn-danger" onClick={() => del(h.id)}>Delete</button>
                {status[h.id] && <Tag color={status[h.id].ok ? 'green' : 'red'}>{status[h.id].ok ? 'reachable' : status[h.id].error}</Tag>}
              </div>
            </Card>
          ))}
        </Section>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', textarea, placeholder, children }) {
  return (
    <div>
      <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>{label}</div>
      {children ? children : textarea ? (
        <textarea className="input" rows={4} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ width:'100%', fontFamily:'var(--font-mono)', fontSize:11 }} />
      ) : (
        <input className="input" type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ width:'100%' }} />
      )}
    </div>
  )
}

function TerminalTab({ hosts, activeHost, setActiveHost }) {
  const [lines, setLines] = useState([])
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const sessionIdRef = useRef('term_' + Math.random().toString(36).slice(2))
  const scrollRef = useRef(null)

  useEffect(() => {
    const off1 = ft.ssh.onShellData(sessionIdRef.current, (data) => {
      setLines(l => [...l.slice(-2000), data])
    })
    const off2 = ft.ssh.onShellClosed(sessionIdRef.current, () => setConnected(false))
    return () => { off1 && off1(); off2 && off2() }
  }, [])

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [lines])

  const connect = async () => {
    if (!activeHost) return
    setLines([])
    try {
      await ft.ssh.shellOpen({ sessionId: sessionIdRef.current, hostId: activeHost.id })
      setConnected(true)
    } catch (e) { setLines([`Connection failed: ${e.message}`]) }
  }
  const send = async () => {
    if (!connected) return
    await ft.ssh.shellWrite({ sessionId: sessionIdRef.current, data: input + '\n' })
    setInput('')
  }
  const disconnect = async () => { await ft.ssh.shellClose({ sessionId: sessionIdRef.current }); setConnected(false) }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, height:'100%' }}>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <select className="input" value={activeHost?.id || ''} onChange={e => setActiveHost(hosts.find(h => h.id === e.target.value))} style={{ minWidth:220 }}>
          <option value="">Select a saved host...</option>
          {hosts.map(h => <option key={h.id} value={h.id}>{h.label} ({h.host})</option>)}
        </select>
        {!connected ? (
          <button className="btn btn-primary btn-sm" disabled={!activeHost} onClick={connect}>Connect</button>
        ) : (
          <button className="btn btn-sm btn-danger" onClick={disconnect}>Disconnect</button>
        )}
        <Tag color={connected ? 'green' : 'gray'}>{connected ? 'connected' : 'disconnected'}</Tag>
      </div>
      <div ref={scrollRef} style={{
        flex:1, background:'#000', color:'#6ee7b7', fontFamily:'var(--font-mono)', fontSize:12,
        padding:12, borderRadius:8, overflowY:'auto', whiteSpace:'pre-wrap', minHeight:340, border:'1px solid var(--border)'
      }}>
        {lines.length ? lines.join('') : <span style={{ opacity:0.4 }}>Not connected. Select a host and hit Connect.</span>}
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <input className="input" style={{ flex:1, fontFamily:'var(--font-mono)' }} value={input}
          placeholder={connected ? 'Type a command and press Enter...' : 'Connect first...'}
          disabled={!connected}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }} />
        <button className="btn btn-sm" disabled={!connected} onClick={send}>Send</button>
      </div>
    </div>
  )
}

function SftpTab({ hosts, activeHost, setActiveHost }) {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)

  const list = useCallback(async (p) => {
    if (!activeHost) return
    setLoading(true)
    try { setEntries(await ft.ssh.sftpList({ hostId: activeHost.id, remotePath: p })) }
    catch (e) { setEntries([]); }
    setLoading(false)
  }, [activeHost])

  useEffect(() => { if (activeHost) list(path) }, [activeHost])

  const enter = (name, type) => {
    if (type !== 'd') return
    const np = (path.endsWith('/') ? path : path + '/') + name
    setPath(np); list(np)
  }
  const up = () => {
    const np = path.split('/').slice(0, -1).join('/') || '/'
    setPath(np); list(np)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <select className="input" value={activeHost?.id || ''} onChange={e => { const h = hosts.find(x => x.id === e.target.value); setActiveHost(h); setPath('/') }} style={{ minWidth:220 }}>
          <option value="">Select a saved host...</option>
          {hosts.map(h => <option key={h.id} value={h.id}>{h.label} ({h.host})</option>)}
        </select>
        <button className="btn btn-sm" onClick={up} disabled={!activeHost}>Up</button>
        <input className="input" style={{ flex:1, fontFamily:'var(--font-mono)' }} value={path} onChange={e => setPath(e.target.value)} onKeyDown={e => e.key === 'Enter' && list(path)} />
        <button className="btn btn-sm" onClick={() => list(path)} disabled={!activeHost}>Go</button>
        <button className="btn btn-sm" onClick={async () => { await ft.ssh.sftpUpload({ hostId: activeHost.id, remoteDir: path }); list(path) }} disabled={!activeHost}>Upload</button>
      </div>
      {loading ? <div style={{ padding:20 }}><Spinner /></div> : !entries.length ? <Empty text="Empty or unreachable" /> : (
        <Card>
          {entries.map(f => (
            <div key={f.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 4px', borderBottom:'1px solid var(--border)', cursor: f.type === 'd' ? 'pointer' : 'default' }}
              onClick={() => enter(f.name, f.type)}>
              <span style={{ fontSize:12 }}>{f.type === 'd' ? ' ' : ' '} {f.name}</span>
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <span style={{ fontSize:11, color:'var(--text3)' }}>{f.type === 'd' ? '' : fmtSize(f.size)}</span>
                {f.type !== 'd' && (
                  <>
                    <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); ft.ssh.sftpDownload({ hostId: activeHost.id, remotePath: path.replace(/\/$/,'') + '/' + f.name }) }}>Get</button>
                    <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); ft.ssh.sftpDelete({ hostId: activeHost.id, remotePath: path.replace(/\/$/,'') + '/' + f.name }).then(() => list(path)) }}>Del</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function fmtSize(n) {
  if (n == null) return ''
  if (n < 1024) return n + 'B'
  if (n < 1024*1024) return (n/1024).toFixed(1) + 'KB'
  return (n/1024/1024).toFixed(1) + 'MB'
}
