import { useState, useEffect, useCallback } from 'react'
import { ft, PageWrap, PageHeader, Card, Section, Empty, Tag, Spinner } from './_shared.jsx'

// Multi-chipset Bootloader Toolkit - Unisoc, MediaTek, Qualcomm, Samsung/Exynos,
// generic AOSP fastboot, reimplementing RootForge / omerta-bootloader-toolkit's
// identify.sh + master.sh flow as a guided UI.
export default function BootloaderMultichipset() {
  const [chipsets, setChipsets] = useState([])
  const [selected, setSelected] = useState(null)
  const [detected, setDetected] = useState([])
  const [detecting, setDetecting] = useState(false)
  const [output, setOutput] = useState('')
  const [confirmUnlock, setConfirmUnlock] = useState(false)

  useEffect(() => { ft.blt.chipsetsList().then(setChipsets) }, [])

  const detect = async () => {
    setDetecting(true)
    try { setDetected(await ft.blt.detect()) } catch {}
    setDetecting(false)
  }
  useEffect(() => { detect() }, [])

  const getvar = async () => { const r = await ft.blt.fastbootGetvar(); setOutput(r.output || r.error) }
  const unlock = async () => {
    if (!confirmUnlock) return
    const r = await ft.blt.fastbootUnlock({ confirm: true })
    setOutput(r.output || r.error)
  }
  const flash = async (partition) => {
    const r = await ft.blt.fastbootFlash({ partition, confirm: true })
    setOutput(JSON.stringify(r, null, 2))
  }
  const heimdallDetect = async () => { const r = await ft.blt.heimdallDetect(); setOutput(r.output || r.error) }
  const mtkPrintgpt = async () => { const r = await ft.blt.mtkRun({ args: ['printgpt'] }); setOutput(r.output || r.error) }

  return (
    <PageWrap>
      <PageHeader title="Bootloader Toolkit" icon=" " sub="Unisoc · MediaTek · Qualcomm · Samsung/Exynos · Generic AOSP -- identify, unlock, and flash" />

      <Section title="Detected Modes" action={<button className="btn btn-sm" onClick={detect}>{detecting ? <Spinner size={12} /> : 'Rescan'}</button>}>
        {!detected.length ? <Empty text="No bootloader/EDL/BROM/Download-mode devices detected" sub="Boot the target device into the relevant mode first" /> : (
          <Card>
            {detected.map((d, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                <span>{d.chipset?.toUpperCase()} - {d.mode}</span>
                <span style={{ color:'var(--text3)', fontFamily:'var(--font-mono)' }}>{d.serial || d.raw || ''}</span>
              </div>
            ))}
          </Card>
        )}
      </Section>

      <Section title="Chipset Families">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:10 }}>
          {chipsets.map(c => (
            <Card key={c.id} style={{ cursor:'pointer', border: selected?.id === c.id ? `1px solid ${c.color}` : undefined }} accent={undefined}>
              <div onClick={() => setSelected(c)}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <span style={{ width:10, height:10, borderRadius:'50%', background:c.color, display:'inline-block' }} />
                  <span style={{ fontWeight:600, fontSize:13 }}>{c.label}</span>
                </div>
                <div style={{ fontSize:11, color:'var(--text3)' }}>{c.detectHint}</div>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {selected && (
        <Section title={`${selected.label} - Workflow`}>
          <Card>
            <ol style={{ margin:0, paddingLeft:18, fontSize:13, color:'var(--text2)', lineHeight:1.8 }}>
              {selected.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <div style={{ display:'flex', gap:8, marginTop:14, flexWrap:'wrap' }}>
              {selected.id === 'aosp' && (
                <>
                  <button className="btn btn-sm" onClick={getvar}>fastboot getvar all</button>
                  <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                    <input type="checkbox" checked={confirmUnlock} onChange={e => setConfirmUnlock(e.target.checked)} />
                    I understand this wipes user data
                  </label>
                  <button className="btn btn-sm btn-danger" disabled={!confirmUnlock} onClick={unlock}>fastboot flashing unlock</button>
                  <button className="btn btn-sm" onClick={() => flash('boot')}>Flash boot.img</button>
                  <button className="btn btn-sm" onClick={() => flash('recovery')}>Flash recovery.img</button>
                </>
              )}
              {selected.id === 'exynos' && (
                <>
                  <button className="btn btn-sm" onClick={heimdallDetect}>heimdall detect</button>
                  <button className="btn btn-sm" onClick={async () => { const r = await ft.blt.heimdallPrintPit(); setOutput(JSON.stringify(r, null, 2)) }}>heimdall print-pit</button>
                </>
              )}
              {selected.id === 'mediatek' && (
                <button className="btn btn-sm" onClick={mtkPrintgpt}>mtkclient printgpt</button>
              )}
              {(selected.id === 'unisoc' || selected.id === 'qualcomm') && (
                <Tag color="amber">No open-source CLI bundled for this family yet -- see the workflow steps for the vendor-tool path (SPD Flash Tool / QFIL)</Tag>
              )}
            </div>
          </Card>
        </Section>
      )}

      {output && (
        <Section title="Output">
          <pre style={{ background:'#000', color:'#6ee7b7', padding:12, borderRadius:8, fontSize:11, overflow:'auto', maxHeight:300 }}>{output}</pre>
        </Section>
      )}
    </PageWrap>
  )
}
