import { useState } from 'react'
import { ft, PageWrap, PageHeader, Progress, Tag } from './_shared.jsx'


export default function KernelFlasher({ device, addLog }) {
  const [kernelPath, setKernelPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ percent:0, message:'' })

  const serial = device?.serial

  const pick = async () => {
    const { filePaths } = await ft.dialog.openFile({ filters:[{ name:'Kernel/Boot Image', extensions:['zip','img'] }] })
    if (filePaths?.[0]) setKernelPath(filePaths[0])
  }

  const flash = async (method) => {
    if (!kernelPath) return addLog('Select a kernel file first')
    setBusy(true); setProgress({ percent:0, message:'Starting flash...' })
    const r = ft.on('kernel:progress', p => setProgress({ percent:p.percent||0, message:p.message||'' }))
    try {
      let res
      if (method === 'adb') res = await ft.rom.flashAdb({ serial, zipPath: kernelPath })
      else res = await ft.rom.flashFastboot({ serial, romPath: kernelPath })
      addLog(res?.message || 'Flash complete')
    } catch (e) { addLog('Flash: ' + e.message) }
    r(); setBusy(false)
  }

  const SOURCES = [
    { name: 'KernelSU', url: 'https://kernelsu.org', note: 'Root via kernel -- no Magisk needed', tag: 'Root' },
    { name: 'Franco Kernel Manager', url: 'https://play.google.com/store/apps/details?id=com.franco.kernel', note: 'Popular kernel manager app', tag: 'Manager' },
    { name: 'XDA Developers', url: 'https://xda-developers.com', note: 'Custom kernels for your device', tag: 'Community' },
  ]

  return (
    <PageWrap>
      <PageHeader title="Kernel Flasher" icon=" " sub="Flash custom kernels for performance and battery" />

      <div className="card" style={{ background:'var(--red-dim)', border:'1px solid rgba(248,113,113,0.2)' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--red)', marginBottom:4 }}>  Warning</div>
        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>Wrong kernel = bootloop or brick. Verify the kernel matches your exact device model and Android version before flashing. Unlocked bootloader required.</div>
      </div>

      <div className="card">
        <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Kernel File</div>
        <div style={{ display:'flex', gap:8, marginBottom:12 }}>
          <div style={{ flex:1, fontSize:12, color:'var(--text3)', padding:'7px 10px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {kernelPath ? kernelPath.split(/[/\\]/).pop() : 'No file selected'}
          </div>
          <button className="btn btn-sm" onClick={pick}>  Browse</button>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-primary" onClick={() => flash('adb')} disabled={busy || !kernelPath || !device}>
              Flash via ADB Sideload
          </button>
          <button className="btn btn-blue" onClick={() => flash('fastboot')} disabled={busy || !kernelPath || !device}>
              Flash via Fastboot
          </button>
        </div>
      </div>

      {busy && <Progress {...progress} />}

      <div className="card">
        <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Find Kernels</div>
        {SOURCES.map((s, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:500 }}>{s.name}</div>
              <div style={{ fontSize:11, color:'var(--text3)' }}>{s.note}</div>
            </div>
            <Tag color="blue">{s.tag}</Tag>
            <button className="btn btn-sm" onClick={() => ft.openUrl(s.url)}>Open  </button>
          </div>
        ))}
      </div>
    </PageWrap>
  )
}
