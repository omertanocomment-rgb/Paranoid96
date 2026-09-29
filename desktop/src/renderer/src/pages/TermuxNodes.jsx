import { useState, useEffect, useCallback } from 'react'
import { ft, PageWrap, PageHeader, Card, Section, Empty, Tag, Spinner } from './_shared.jsx'

// Termux Node Manager - registry + remote command runner for headless Termux
// nodes (repurposed phones/tablets reachable over wireless ADB + SSH), built
// on the shared SSH backend. Reimplements the tab-node-kit / termux-setup
// workflow: register a node, run a command, watch the result.
export default function TermuxNodes() {
  const [hosts, setHosts] = useState([])
  const [form, setForm] = useState({ label: '', host: '', port: 8022, username: 'u0_a1', password: '', notes: '' })
  const [selected, setSelected] = useState(null)
  const [cmd, setCmd] = useState('uname -a && termux-info | head -5')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])

  const refresh = useCallback(async () => {
    const all = await ft.ssh.hostsList()
    setHosts(all.filter(h => h.kind === 'termux'))
  }, [])
  useEffect(() => { refresh() }, [refresh])

  const save = async () => {
    if (!form.host) return
    await ft.ssh.hostsSave({ ...form, kind: 'termux' })
    setForm({ label: '', host: '', port: 8022, username: 'u0_a1', password: '', notes: '' })
    refresh()
  }
  const del = async (id) => { await ft.ssh.hostsDelete(id); refresh() }

  const run = async () => {
    if (!selected) return
    setRunning(true); setResult(null)
    try {
      const r = await ft.ssh.exec({ hostId: selected.id, cmd, timeout: 30000 })
      setResult(r)
      setHistory(h => [{ cmd, ...r, ts: Date.now() }, ...h].slice(0, 50))
    } catch (e) { setResult({ code: -1, stderr: e.message, stdout: '' }) }
    setRunning(false)
  }

  const QUICK_COMMANDS = [
    ['System info', 'uname -a && termux-info | head -20'],
    ['Battery', 'termux-battery-status'],
    ['Wireless ADB check', 'ip addr show wlan0 | grep inet'],
    ['Storage', 'df -h $HOME'],
    ['Running procs', 'ps -ef | head -30'],
    ['Uptime', 'uptime'],
  ]

  return (
    <PageWrap>
      <PageHeader title="Termux Node Manager" icon=" " sub="Registry and remote runner for headless Termux devices reached over wireless ADB + SSH" />

      <div style={{ display:'flex', gap:16 }}>
        <div style={{ flex:1 }}>
          <Section title="Register Node">
            <Card>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <LabeledInput label="Label" value={form.label} onChange={v => setForm({ ...form, label: v })} placeholder="Galaxy Tab node" />
                <LabeledInput label="Host / IP" value={form.host} onChange={v => setForm({ ...form, host: v })} placeholder="192.168.1.60" />
                <LabeledInput label="SSH Port" value={form.port} onChange={v => setForm({ ...form, port: v })} type="number" />
                <LabeledInput label="Username" value={form.username} onChange={v => setForm({ ...form, username: v })} />
                <LabeledInput label="Password" value={form.password} onChange={v => setForm({ ...form, password: v })} type="password" />
                <LabeledInput label="Notes" value={form.notes} onChange={v => setForm({ ...form, notes: v })} placeholder="Broken LCD, headless build node" />
              </div>
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:8 }}>
                Termux default SSH port is 8022. Run <code>pkg install openssh && sshd</code> on the node first.
              </div>
              <button className="btn btn-primary" style={{ marginTop:12 }} onClick={save}>Register Node</button>
            </Card>
          </Section>

          <Section title="Registered Nodes">
            {!hosts.length ? <Empty icon=" " text="No Termux nodes registered yet" /> : hosts.map(h => (
              <Card key={h.id} style={{ marginBottom:8, cursor:'pointer', border: selected?.id === h.id ? '1px solid var(--accent)' : undefined }} >
                <div onClick={() => setSelected(h)} style={{ display:'flex', justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontWeight:600, fontSize:13 }}>{h.label}</div>
                    <div style={{ fontSize:11, color:'var(--text3)' }}>{h.username}@{h.host}:{h.port}</div>
                    {h.notes && <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>{h.notes}</div>}
                  </div>
                  <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); del(h.id) }}>Remove</button>
                </div>
              </Card>
            ))}
          </Section>
        </div>

        <div style={{ flex:1 }}>
          <Section title="Remote Command Runner">
            <Card>
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>
                Target: {selected ? <Tag color="green">{selected.label}</Tag> : <Tag color="gray">no node selected</Tag>}
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:8 }}>
                {QUICK_COMMANDS.map(([label, c]) => (
                  <button key={label} className="btn btn-sm" onClick={() => setCmd(c)}>{label}</button>
                ))}
              </div>
              <textarea className="input" style={{ width:'100%', fontFamily:'var(--font-mono)', fontSize:12 }} rows={3} value={cmd} onChange={e => setCmd(e.target.value)} />
              <button className="btn btn-primary btn-sm" style={{ marginTop:8 }} disabled={!selected || running} onClick={run}>
                {running ? <Spinner size={12} /> : 'Run Command'}
              </button>
              {result && (
                <div style={{ marginTop:12 }}>
                  <Tag color={result.code === 0 ? 'green' : 'red'}>exit {result.code}</Tag>
                  <pre style={{ background:'#000', color:'#6ee7b7', padding:10, borderRadius:8, fontSize:11, marginTop:6, maxHeight:200, overflow:'auto', whiteSpace:'pre-wrap' }}>
                    {result.stdout}{result.stderr ? '\n' + result.stderr : ''}
                  </pre>
                </div>
              )}
            </Card>
          </Section>

          <Section title="Run History">
            {!history.length ? <Empty text="No commands run yet" /> : (
              <Card>
                {history.map((h, i) => (
                  <div key={i} style={{ padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
                    <div style={{ fontSize:11, fontFamily:'var(--font-mono)', color:'var(--text2)' }}>{h.cmd}</div>
                    <div style={{ fontSize:10, color:'var(--text3)' }}>{new Date(h.ts).toLocaleTimeString()} · exit {h.code}</div>
                  </div>
                ))}
              </Card>
            )}
          </Section>
        </div>
      </div>
    </PageWrap>
  )
}

function LabeledInput({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div>
      <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>{label}</div>
      <input className="input" style={{ width:'100%' }} type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
