import { useState, useEffect, useRef, useCallback } from 'react'
import { ft, PageWrap, PageHeader, Card, Section, Empty, Tag, Spinner, TabBar } from './_shared.jsx'

export default function AIAssistant() {
  const [tab, setTab] = useState('chat')
  const [hasKey, setHasKey] = useState(false)
  const [models, setModels] = useState([])
  const [convos, setConvos] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [model, setModel] = useState('claude-sonnet-5')
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [draft, setDraft] = useState('')
  const scrollRef = useRef(null)
  const streamIdRef = useRef(null)

  const refreshConvos = useCallback(async () => setConvos(await ft.ai.convoList()), [])

  useEffect(() => {
    ft.ai.keyStatus().then(s => setHasKey(s.hasKey))
    ft.ai.modelsList().then(setModels)
    refreshConvos()
  }, [refreshConvos])

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [messages, draft])

  const newConvo = () => { setActiveId(null); setMessages([]); setDraft('') }
  const loadConvo = async (id) => {
    const c = await ft.ai.convoLoad(id)
    if (c) { setActiveId(c.id); setMessages(c.messages || []); setModel(c.model || model) }
  }
  const deleteConvo = async (id) => { await ft.ai.convoDelete(id); if (id === activeId) newConvo(); refreshConvos() }

  const send = async () => {
    if (!input.trim() || streaming) return
    if (!hasKey) { setTab('settings'); return }
    const userMsg = { role: 'user', content: input }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setStreaming(true)
    setDraft('')
    const streamId = 's_' + Date.now().toString(36)
    streamIdRef.current = streamId
    let full = ''
    const off = ft.ai.onStream(streamId, (evt) => {
      if (evt.type === 'delta') { full += evt.text; setDraft(full) }
      else if (evt.type === 'done') {
        setStreaming(false)
        const finalMsgs = [...nextMessages, { role: 'assistant', content: full || evt.full }]
        setMessages(finalMsgs)
        setDraft('')
        off && off()
        persist(finalMsgs)
      } else if (evt.type === 'error') {
        setStreaming(false)
        setMessages([...nextMessages, { role: 'assistant', content: `[Error] ${evt.error}` }])
        setDraft('')
        off && off()
      }
    })
    try {
      await ft.ai.chatStream({ streamId, model, messages: nextMessages, maxTokens: 4096 })
    } catch (e) {
      setStreaming(false)
      setMessages([...nextMessages, { role: 'assistant', content: `[Error] ${e.message}` }])
    }
  }

  const persist = async (msgs) => {
    const title = msgs[0]?.content?.slice(0, 48) || 'New conversation'
    const res = await ft.ai.convoSave({ id: activeId, title, model, messages: msgs })
    setActiveId(res.id)
    refreshConvos()
  }

  return (
    <PageWrap>
      <PageHeader title="AI Assistant" icon=" " sub="Personal Claude API client - streaming chat with local conversation history" />
      <TabBar tabs={[['chat','Chat'],['settings','Settings']]} active={tab} onChange={setTab} />
      {tab === 'settings' && <SettingsTab hasKey={hasKey} setHasKey={setHasKey} />}
      {tab === 'chat' && (
        <div style={{ display:'flex', gap:16, height:'100%' }}>
          <div style={{ width:220, flexShrink:0, display:'flex', flexDirection:'column', gap:8 }}>
            <button className="btn btn-primary btn-sm" onClick={newConvo}>+ New chat</button>
            <select className="input" value={model} onChange={e => setModel(e.target.value)}>
              {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <div style={{ overflowY:'auto', flex:1 }}>
              {convos.map(c => (
                <div key={c.id} onClick={() => loadConvo(c.id)} style={{
                  padding:'8px 10px', borderRadius:6, cursor:'pointer', marginBottom:4,
                  background: c.id === activeId ? 'var(--accent-dim)' : 'var(--bg2)',
                  fontSize:12, display:'flex', justifyContent:'space-between', alignItems:'center', gap:6
                }}>
                  <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.title}</span>
                  <span onClick={(e) => { e.stopPropagation(); deleteConvo(c.id) }} style={{ opacity:0.5, cursor:'pointer' }}>×</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
            {!hasKey && (
              <Card style={{ marginBottom:10 }} accent="amber">
                No API key set. Go to the Settings tab to add your Anthropic API key.
              </Card>
            )}
            <div ref={scrollRef} style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:10, paddingBottom:10 }}>
              {!messages.length && !draft && <Empty icon=" " text="Start a conversation" />}
              {messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)}
              {draft && <Bubble role="assistant" content={draft} streaming />}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <textarea className="input" rows={2} style={{ flex:1, resize:'none' }} value={input}
                placeholder="Ask anything..."
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
              <button className="btn btn-primary" onClick={send} disabled={streaming}>{streaming ? <Spinner size={14} /> : 'Send'}</button>
            </div>
          </div>
        </div>
      )}
    </PageWrap>
  )
}

function Bubble({ role, content, streaming }) {
  const isUser = role === 'user'
  return (
    <div style={{ display:'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth:'75%', padding:'10px 14px', borderRadius:12,
        background: isUser ? 'var(--accent-dim)' : 'var(--bg2)',
        color: isUser ? 'var(--accent)' : 'var(--text2)',
        fontSize:13, lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word',
        border: streaming ? '1px solid var(--accent)' : '1px solid transparent'
      }}>
        {content}{streaming && <span style={{ opacity:0.5 }}> ▍</span>}
      </div>
    </div>
  )
}

function SettingsTab({ hasKey, setHasKey }) {
  const [key, setKey] = useState('')
  const [saved, setSaved] = useState(false)
  const save = async () => { await ft.ai.keySet(key); setHasKey(true); setSaved(true); setKey(''); setTimeout(() => setSaved(false), 2000) }
  const clear = async () => { await ft.ai.keyClear(); setHasKey(false) }
  return (
    <Section title="Anthropic API Key">
      <Card>
        <div style={{ fontSize:12, color:'var(--text3)', marginBottom:10 }}>
          Stored locally (encrypted via OS keychain when available). Never leaves this machine except to call api.anthropic.com directly.
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <input className="input" style={{ flex:1 }} type="password" placeholder="sk-ant-..." value={key} onChange={e => setKey(e.target.value)} />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={!key}>Save Key</button>
          {hasKey && <button className="btn btn-sm btn-danger" onClick={clear}>Clear</button>}
        </div>
        <div style={{ marginTop:10 }}>
          <Tag color={hasKey ? 'green' : 'gray'}>{hasKey ? 'Key configured' : 'No key set'}</Tag>
          {saved && <Tag color="green">Saved</Tag>}
        </div>
      </Card>
    </Section>
  )
}
