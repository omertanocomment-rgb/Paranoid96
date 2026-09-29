import { useState, useEffect, useRef, useCallback } from 'react'
import { ft, PageWrap, PageHeader, Card, Section, Empty, Tag, TabBar, Spinner } from './_shared.jsx'

// Secure Messaging - E2E encrypted chat over a user-supplied WebSocket relay
// (X25519 + AES-256-GCM, keys never leave the device) plus a crypto address
// book with public balance lookups. Reimplements the core of OMERTA FTP
// (formerly Phantom) in the shared stack, without bundling a hosted backend.
export default function SecureMessaging() {
  const [tab, setTab] = useState('chat')
  return (
    <PageWrap>
      <PageHeader title="Secure Messaging" icon=" " sub="End-to-end encrypted relay chat + a read-only crypto address book" />
      <TabBar tabs={[['chat','Chat'],['contacts','Contacts'],['wallet','Wallet Address Book'],['identity','My Identity']]} active={tab} onChange={setTab} />
      {tab === 'chat' && <ChatTab />}
      {tab === 'contacts' && <ContactsTab />}
      {tab === 'wallet' && <WalletTab />}
      {tab === 'identity' && <IdentityTab />}
    </PageWrap>
  )
}

function ChatTab() {
  const [relayUrl, setRelayUrl] = useState('wss://')
  const [connected, setConnected] = useState(false)
  const [contacts, setContacts] = useState([])
  const [active, setActive] = useState(null)
  const [history, setHistory] = useState([])
  const [input, setInput] = useState('')

  useEffect(() => { ft.msg.contactsList().then(setContacts) }, [])
  useEffect(() => {
    const off1 = ft.msg.onRelayStatus(s => setConnected(!!s.connected))
    const off2 = ft.msg.onRelayMessage(async (envelope) => {
      if (!active) return
      try {
        const { plaintext } = await ft.msg.decrypt({ fromPublicKey: envelope.from, ciphertext: envelope.ciphertext })
        const msg = { from: 'them', text: plaintext, ts: envelope.ts }
        setHistory(h => [...h, msg])
        ft.msg.historyAppend({ contactId: active.id, message: msg })
      } catch {}
    })
    return () => { off1 && off1(); off2 && off2() }
  }, [active])

  const connect = async () => { await ft.msg.relayConnect({ url: relayUrl }) }
  const disconnect = async () => { await ft.msg.relayDisconnect() }
  const openContact = async (c) => { setActive(c); setHistory(await ft.msg.historyLoad(c.id)) }

  const send = async () => {
    if (!input.trim() || !active) return
    try {
      const r = await ft.msg.relaySend({ toPublicKey: active.publicKey, plaintext: input })
      const msg = { from: 'me', text: input, ts: r.ts }
      setHistory(h => [...h, msg])
      ft.msg.historyAppend({ contactId: active.id, message: msg })
      setInput('')
    } catch (e) { alert(e.message) }
  }

  return (
    <div style={{ display:'flex', gap:16, height:'100%' }}>
      <div style={{ width:240, flexShrink:0, display:'flex', flexDirection:'column', gap:8 }}>
        <Card>
          <div style={{ fontSize:11, color:'var(--text3)', marginBottom:6 }}>Relay URL (your own websocket relay)</div>
          <input className="input" style={{ width:'100%', marginBottom:6, fontFamily:'var(--font-mono)', fontSize:11 }} value={relayUrl} onChange={e => setRelayUrl(e.target.value)} />
          {!connected ? <button className="btn btn-primary btn-sm" style={{ width:'100%' }} onClick={connect}>Connect</button>
            : <button className="btn btn-sm btn-danger" style={{ width:'100%' }} onClick={disconnect}>Disconnect</button>}
          <div style={{ marginTop:6 }}><Tag color={connected ? 'green' : 'gray'}>{connected ? 'relay connected' : 'offline'}</Tag></div>
        </Card>
        <div style={{ overflowY:'auto', flex:1 }}>
          {!contacts.length ? <Empty text="No contacts yet" sub="Add one in the Contacts tab" /> : contacts.map(c => (
            <div key={c.id} onClick={() => openContact(c)} style={{
              padding:'8px 10px', borderRadius:6, cursor:'pointer', marginBottom:4, fontSize:12,
              background: active?.id === c.id ? 'var(--accent-dim)' : 'var(--bg2)'
            }}>{c.name}</div>
          ))}
        </div>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column' }}>
        {!active ? <Empty icon=" " text="Select a contact to start chatting" /> : (
          <>
            <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:8, paddingBottom:10 }}>
              {history.map((m, i) => (
                <div key={i} style={{ display:'flex', justifyContent: m.from === 'me' ? 'flex-end' : 'flex-start' }}>
                  <div style={{ maxWidth:'70%', padding:'8px 12px', borderRadius:10, fontSize:13,
                    background: m.from === 'me' ? 'var(--accent-dim)' : 'var(--bg2)', color: m.from === 'me' ? 'var(--accent)' : 'var(--text2)' }}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <input className="input" style={{ flex:1 }} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Encrypted message..." />
              <button className="btn btn-sm" onClick={send} disabled={!connected}>Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ContactsTab() {
  const [contacts, setContacts] = useState([])
  const [form, setForm] = useState({ name: '', publicKey: '' })
  const refresh = useCallback(() => ft.msg.contactsList().then(setContacts), [])
  useEffect(() => { refresh() }, [refresh])
  const save = async () => { if (!form.name || !form.publicKey) return; await ft.msg.contactsSave(form); setForm({ name: '', publicKey: '' }); refresh() }
  const del = async (id) => { await ft.msg.contactsDelete(id); refresh() }
  return (
    <div style={{ display:'flex', gap:16 }}>
      <Card style={{ flex:1 }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Add Contact</div>
        <input className="input" style={{ width:'100%', marginBottom:8 }} placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <textarea className="input" style={{ width:'100%', marginBottom:8, fontFamily:'var(--font-mono)', fontSize:10 }} rows={5} placeholder="Their public key (PEM, shared out-of-band)" value={form.publicKey} onChange={e => setForm({ ...form, publicKey: e.target.value })} />
        <button className="btn btn-primary btn-sm" onClick={save}>Save Contact</button>
      </Card>
      <div style={{ flex:1 }}>
        {!contacts.length ? <Empty text="No contacts saved" /> : contacts.map(c => (
          <Card key={c.id} style={{ marginBottom:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <div style={{ fontWeight:600, fontSize:13 }}>{c.name}</div>
              <button className="btn btn-sm btn-danger" onClick={() => del(c.id)}>Remove</button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function WalletTab() {
  const [entries, setEntries] = useState([])
  const [form, setForm] = useState({ label: '', chain: 'BTC', address: '' })
  const [balances, setBalances] = useState({})
  const refresh = useCallback(() => ft.wallet.list().then(setEntries), [])
  useEffect(() => { refresh() }, [refresh])
  const save = async () => { if (!form.address) return; await ft.wallet.save(form); setForm({ label: '', chain: 'BTC', address: '' }); refresh() }
  const del = async (id) => { await ft.wallet.delete(id); refresh() }
  const checkBalance = async (e) => {
    setBalances(b => ({ ...b, [e.id]: { loading: true } }))
    const r = await ft.wallet.balance({ chain: e.chain, address: e.address })
    setBalances(b => ({ ...b, [e.id]: r }))
  }
  return (
    <div style={{ display:'flex', gap:16 }}>
      <Card style={{ flex:1 }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Add Address</div>
        <input className="input" style={{ width:'100%', marginBottom:8 }} placeholder="Label" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} />
        <select className="input" style={{ width:'100%', marginBottom:8 }} value={form.chain} onChange={e => setForm({ ...form, chain: e.target.value })}>
          {['BTC','ETH','XMR','USDC','OMRT'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="input" style={{ width:'100%', marginBottom:8, fontFamily:'var(--font-mono)', fontSize:11 }} placeholder="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
        <button className="btn btn-primary btn-sm" onClick={save}>Save Address</button>
        <div style={{ fontSize:11, color:'var(--text3)', marginTop:10 }}>Read-only address book -- no private keys are ever stored or requested here.</div>
      </Card>
      <div style={{ flex:1 }}>
        {!entries.length ? <Empty text="No addresses saved" /> : entries.map(e => (
          <Card key={e.id} style={{ marginBottom:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontWeight:600, fontSize:13 }}>{e.label || e.chain} <Tag color="blue">{e.chain}</Tag></div>
                <div style={{ fontSize:11, color:'var(--text3)', fontFamily:'var(--font-mono)', wordBreak:'break-all' }}>{e.address}</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:6, marginTop:8, alignItems:'center' }}>
              <button className="btn btn-sm" onClick={() => checkBalance(e)}>Check Balance</button>
              <button className="btn btn-sm btn-danger" onClick={() => del(e.id)}>Remove</button>
              {balances[e.id]?.loading && <Spinner size={12} />}
              {balances[e.id]?.ok && <Tag color="green">{balances[e.id].balance} {balances[e.id].unit}</Tag>}
              {balances[e.id] && !balances[e.id].loading && !balances[e.id].ok && <Tag color="red">{balances[e.id].error}</Tag>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function IdentityTab() {
  const [id, setId] = useState(null)
  useEffect(() => { ft.msg.identityGet().then(setId) }, [])
  return (
    <Section title="My Identity">
      <Card>
        <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8 }}>
          Share this public key with contacts out-of-band (in person, over an already-trusted channel) so they can add you as a contact. The matching private key never leaves this device.
        </div>
        {id ? (
          <textarea readOnly className="input" style={{ width:'100%', fontFamily:'var(--font-mono)', fontSize:10 }} rows={8} value={id.publicKey} />
        ) : <Spinner />}
      </Card>
    </Section>
  )
}
