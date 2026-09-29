import { useState } from 'react'
import { ft, PageWrap, PageHeader, Tag } from './_shared.jsx'


export default function RepairMode({ device, addLog }) {
  const [busy, setBusy] = useState(false)

  const serial = device?.serial

  const enable = async (type) => {
    if (!serial) return addLog('No device connected')
    setBusy(true)
    try {
      const res = await ft.repair.enable({ serial, type })
      addLog(res.success ? `Repair mode (${type}) enabled` : res.error || 'Failed')
    } catch (e) { addLog('Repair mode: ' + e.message) }
    setBusy(false)
  }

  const MODES = [
    { id:'samsung', label:'Samsung Repair Mode', icon:' ', desc:'Official Samsung feature. Hides personal data while keeping device functional for repair shop. Reboot to disable.', supported: device?.brand?.toLowerCase() === 'samsung' },
    { id:'adb_only', label:'ADB-only Mode', icon:' ', desc:'Locks device to ADB connections only. No USB storage, no MTP -- repair shop can run diagnostics without accessing files.', supported: true },
    { id:'guest', label:'Guest User Mode', icon:' ', desc:'Switches to a fresh guest account. Repair shop sees empty device. Your data is hidden until you switch back.', supported: device?.deviceType === 'android' },
  ]

  return (
    <PageWrap>
      <PageHeader title="Repair Mode" icon=" " sub="Give repair shops access without exposing your data" />

      <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', marginBottom:4 }}>How it works</div>
        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
          Repair mode lets you hand your phone to a repair shop without them seeing your photos, messages, or apps.
          Your data stays encrypted -- it's just hidden until you re-enable normal mode.
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {MODES.map(m => (
          <div key={m.id} className="card" style={{ display:'flex', gap:14, alignItems:'flex-start', opacity: m.supported ? 1 : 0.5 }}>
            <span style={{ fontSize:24 }}>{m.icon}</span>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <span style={{ fontSize:14, fontWeight:600 }}>{m.label}</span>
                {!m.supported && <Tag color="gray">Not available on this device</Tag>}
              </div>
              <div style={{ fontSize:12, color:'var(--text3)', lineHeight:1.6, marginBottom:8 }}>{m.desc}</div>
              <button className="btn btn-primary btn-sm" onClick={() => enable(m.id)} disabled={busy || !m.supported || !device}>
                Enable
              </button>
            </div>
          </div>
        ))}
      </div>
    </PageWrap>
  )
}
