import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, InfoRow } from './_shared.jsx'


export default function SystemTools({ device, addLog }) {
  const [battery, setBattery] = useState(null)
  const [blStatus, setBlStatus] = useState(null)
  const [dpi, setDpi] = useState(420)

  const serial = device?.serial || device?.udid

  useEffect(() => {
    if (!device) return
    ft.system.batteryInfo({ serial, type: device.deviceType }).then(setBattery).catch(() => {})
    if (device.deviceType === 'android') ft.system.bootloaderStatus({ serial }).then(setBlStatus).catch(() => {})
  }, [device?.serial, device?.udid])

  const run = (label, fn) => fn().then(() => addLog(label + ' done')).catch(e => addLog(label + ': ' + e.message))

  const QUICK = [
    ['Reboot', () => ft.adb.reboot({ serial, mode:'' })],
    ['Reboot   Recovery', () => ft.adb.reboot({ serial, mode:'recovery' })],
    ['Reboot   Fastboot', () => ft.adb.reboot({ serial, mode:'bootloader' })],
    ['Disable animations', () => ft.adb.shell({ serial, cmd:'settings put global animator_duration_scale 0 && settings put global window_animation_scale 0 && settings put global transition_animation_scale 0' })],
    ['Reset animations', () => ft.adb.shell({ serial, cmd:'settings put global animator_duration_scale 1 && settings put global window_animation_scale 1 && settings put global transition_animation_scale 1' })],
  ]

  return (
    <PageWrap>
      <PageHeader title="System Tools" icon=" " />
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>

        {/* DPI */}
        <div className="card">
          <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Display DPI ({dpi})</div>
          <input type="range" min={120} max={640} value={dpi} onChange={e => setDpi(+e.target.value)} style={{ width:'100%', marginBottom:8 }} />
          <div style={{ display:'flex', gap:6 }}>
            <button className="btn btn-primary btn-sm" onClick={() => run('DPI', () => ft.system.dpi({ serial, dpi }))}>Set DPI</button>
            <button className="btn btn-sm" onClick={() => run('Reset display', () => ft.system.resetDisplay({ serial }))}>Reset</button>
          </div>
        </div>

        {/* Battery */}
        {battery && (
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Battery</div>
            {[
              ['Level', battery.level != null ? battery.level + '%' : null],
              ['Status', battery.status],
              ['Temperature', battery.temperature],
              ['Health', battery.health],
              ['Technology', battery.technology],
              ['Cycle Count', battery.cycleCount],
            ].filter(([,v]) => v).map(([k, v]) => <InfoRow key={k} label={k} value={v} />)}
          </div>
        )}

        {/* Bootloader */}
        {blStatus && (
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Bootloader</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <span className={`tag ${blStatus.flashLocked === '0' ? 'tag-green' : 'tag-amber'}`}>
                {blStatus.flashLocked === '0' ? '  Unlocked' : '  Locked'}
              </span>
              {blStatus.verifiedBootState && <span className="tag tag-gray">{blStatus.verifiedBootState}</span>}
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="card">
          <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Quick Actions</div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {QUICK.map(([label, fn]) => (
              <button key={label} className="btn btn-sm" style={{ justifyContent:'flex-start' }} onClick={() => run(label, fn)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </PageWrap>
  )
}
