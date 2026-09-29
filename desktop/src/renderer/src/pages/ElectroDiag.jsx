import { useState, useEffect, useRef, useCallback } from 'react'
import { PageWrap, PageHeader, Card, Section, Empty, Tag, TabBar } from './_shared.jsx'

// Electrical Diagnostics - Web Serial based console for USB multimeters, logic
// analysers, and generic serial devices (Arduino, ESP32, UART bridges, etc.),
// reimplementing the core of the ElectroDiag desktop app's serial + USB tooling.
export default function ElectroDiag() {
  const [tab, setTab] = useState('serial')
  const [supported, setSupported] = useState(true)

  useEffect(() => { setSupported(!!navigator.serial) }, [])

  return (
    <PageWrap>
      <PageHeader title="Electrical Diagnostics" icon=" " sub="Serial console, USB device detection, and readings log for hardware diagnostics" />
      {!supported && (
        <Card accent="red">Web Serial isn't available in this window. Re-open OmniForge if this persists.</Card>
      )}
      <TabBar tabs={[['serial','Serial Console'],['usb','USB Devices'],['log','Readings Log']]} active={tab} onChange={setTab} />
      {tab === 'serial' && <SerialConsole supported={supported} />}
      {tab === 'usb' && <UsbDevices supported={supported} />}
      {tab === 'log' && <ReadingsLog />}
    </PageWrap>
  )
}

const READING_RE = /(-?\d+(?:\.\d+)?)\s*(V|mV|A|mA|Ω|ohm|Hz|°C|%)/i

function SerialConsole({ supported }) {
  const [port, setPort] = useState(null)
  const [connected, setConnected] = useState(false)
  const [baud, setBaud] = useState(115200)
  const [lines, setLines] = useState([])
  const [input, setInput] = useState('')
  const readerRef = useRef(null)
  const writerRef = useRef(null)
  const scrollRef = useRef(null)

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight) }, [lines])

  const connect = async () => {
    try {
      const p = await navigator.serial.requestPort()
      await p.open({ baudRate: Number(baud) })
      setPort(p)
      setConnected(true)
      const textDecoder = new TextDecoderStream()
      p.readable.pipeTo(textDecoder.writable)
      const reader = textDecoder.readable.getReader()
      readerRef.current = reader
      const textEncoder = new TextEncoderStream()
      textEncoder.readable.pipeTo(p.writable)
      writerRef.current = textEncoder.writable.getWriter()
      pump(reader)
    } catch (e) {
      setLines(l => [...l, `[error] ${e.message}`])
    }
  }

  const pump = async (reader) => {
    let buf = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        const parts = buf.split('\n')
        buf = parts.pop()
        if (parts.length) {
          setLines(l => [...l.slice(-1000), ...parts])
          const readings = JSON.parse(localStorage.getItem('omni_electro_readings') || '[]')
          let changed = false
          for (const p of parts) {
            const m = p.match(READING_RE)
            if (m) { readings.push({ t: Date.now(), value: parseFloat(m[1]), unit: m[2], raw: p.trim() }); changed = true }
          }
          if (changed) localStorage.setItem('omni_electro_readings', JSON.stringify(readings.slice(-500)))
        }
      }
    } catch {}
  }

  const disconnect = async () => {
    try {
      await readerRef.current?.cancel()
      await port?.close()
    } catch {}
    setConnected(false)
    setPort(null)
  }

  const send = async () => {
    if (!writerRef.current) return
    await writerRef.current.write(input + '\n')
    setInput('')
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <select className="input" value={baud} onChange={e => setBaud(e.target.value)} disabled={connected}>
          {[9600, 19200, 38400, 57600, 115200, 230400].map(b => <option key={b} value={b}>{b} baud</option>)}
        </select>
        {!connected ? (
          <button className="btn btn-primary btn-sm" onClick={connect} disabled={!supported}>Select & Connect Serial Device</button>
        ) : (
          <button className="btn btn-sm btn-danger" onClick={disconnect}>Disconnect</button>
        )}
        <Tag color={connected ? 'green' : 'gray'}>{connected ? 'connected' : 'disconnected'}</Tag>
      </div>
      <div ref={scrollRef} style={{
        background:'#000', color:'#6ee7b7', fontFamily:'var(--font-mono)', fontSize:12,
        padding:12, borderRadius:8, minHeight:320, maxHeight:400, overflowY:'auto', border:'1px solid var(--border)'
      }}>
        {lines.length ? lines.map((l, i) => <div key={i}>{l}</div>) : <span style={{ opacity:0.4 }}>No data yet. Connect a device (multimeter, logic analyser, Arduino/ESP32 UART, etc).</span>}
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <input className="input" style={{ flex:1, fontFamily:'var(--font-mono)' }} value={input} disabled={!connected}
          placeholder="Send a command..." onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
        <button className="btn btn-sm" disabled={!connected} onClick={send}>Send</button>
      </div>
    </div>
  )
}

function UsbDevices({ supported }) {
  const [devices, setDevices] = useState([])
  const [usbSupported, setUsbSupported] = useState(true)
  useEffect(() => { setUsbSupported(!!navigator.usb) }, [])

  const request = async () => {
    try {
      const d = await navigator.usb.requestDevice({ filters: [] })
      setDevices(prev => [...prev.filter(x => x.serialNumber !== d.serialNumber), d])
    } catch (e) { /* user cancelled or none available */ }
  }
  const refreshKnown = async () => { setDevices(await navigator.usb.getDevices()) }
  useEffect(() => { if (usbSupported) refreshKnown() }, [usbSupported])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div>
        <button className="btn btn-primary btn-sm" onClick={request} disabled={!usbSupported}>Detect USB Device</button>
      </div>
      {!devices.length ? <Empty icon=" " text="No USB devices detected yet" sub="Click Detect and pick a device from the browser prompt" /> : (
        <Card>
          {devices.map((d, i) => (
            <div key={i} style={{ padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontWeight:600, fontSize:13 }}>{d.productName || 'Unknown device'}</div>
              <div style={{ fontSize:11, color:'var(--text3)' }}>
                VID:{d.vendorId?.toString(16)} PID:{d.productId?.toString(16)} · {d.manufacturerName || 'unknown vendor'} · serial:{d.serialNumber || 'n/a'}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function ReadingsLog() {
  const [readings, setReadings] = useState([])
  useEffect(() => {
    const load = () => { try { setReadings(JSON.parse(localStorage.getItem('omni_electro_readings') || '[]').slice().reverse()) } catch { setReadings([]) } }
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])
  const clear = () => { localStorage.setItem('omni_electro_readings', '[]'); setReadings([]) }
  const exportCsv = () => {
    const csv = 'time,value,unit,raw\n' + readings.map(r => `${new Date(r.t).toISOString()},${r.value},${r.unit},"${r.raw.replace(/"/g,'""')}"`).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'electro_readings.csv'
    a.click()
  }
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', gap:8 }}>
        <button className="btn btn-sm" onClick={exportCsv} disabled={!readings.length}>Export CSV</button>
        <button className="btn btn-sm btn-danger" onClick={clear} disabled={!readings.length}>Clear</button>
      </div>
      {!readings.length ? <Empty text="No readings parsed yet" sub="Readings are auto-detected from serial console lines (e.g. '12.3V', '450mA')" /> : (
        <Card>
          {readings.slice(0, 200).map((r, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
              <span style={{ color:'var(--text3)' }}>{new Date(r.t).toLocaleTimeString()}</span>
              <span style={{ fontFamily:'var(--font-mono)' }}>{r.value} {r.unit}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
