import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Tag } from './_shared.jsx'


export default function BootloaderWizard({ device, addLog }) {
  const [status, setStatus] = useState(null)
  const [brand, setBrand] = useState('')

  const serial = device?.serial

  useEffect(() => {
    if (!serial) return
    ft.system.bootloaderStatus({ serial }).then(setStatus).catch(() => {})
    if (device?.brand) setBrand(device.brand.toLowerCase())
  }, [serial])

  const GUIDES = {
    google: {
      name: 'Google Pixel',
      steps: ['Enable Developer Options: Settings   About   tap Build Number 7 times','Enable OEM Unlocking: Developer Options   OEM Unlocking','Boot to fastboot: adb reboot bootloader','Run: fastboot flashing unlock','Confirm on device screen'],
      official: 'https://source.android.com/docs/setup/build/running'
    },
    xiaomi: {
      name: 'Xiaomi / MIUI',
      steps: ['Add Mi Account in Settings   Mi Account','Apply for unlock at: unlock.update.miui.com','Wait for approval (up to 30 days for new accounts)','Download Mi Flash Unlock tool','Connect in fastboot mode and unlock'],
      official: 'https://unlock.update.miui.com'
    },
    motorola: {
      name: 'Motorola',
      steps: ['Get unlock code at: motorola-global-portal.custhelp.com','Enable Developer Options','Enable OEM Unlocking','Boot to fastboot: adb reboot bootloader','Run: fastboot oem unlock UNIQUE_KEY'],
      official: 'https://motorola-global-portal.custhelp.com/app/software-upgrade-individualSU'
    },
    samsung: {
      name: 'Samsung (Knox void -- US models mostly locked)',
      steps: ['Enable Developer Options + OEM Unlocking','Boot to Download Mode: hold Vol Down + Bixby + Power','Long press Vol Up to unlock','Warning: Knox e-fuse permanently trips, voiding warranty'],
      official: 'https://www.samsung.com/us/support/'
    },
    oneplus: {
      name: 'OnePlus',
      steps: ['Enable Developer Options','Enable OEM Unlocking','Boot to fastboot: adb reboot bootloader','Run: fastboot oem unlock','Confirm on device'],
      official: 'https://www.oneplus.com/support'
    },
  }

  const guide = GUIDES[brand] || null

  return (
    <PageWrap>
      <PageHeader title="Bootloader Unlock Wizard" icon=" " sub="Step-by-step guide for your device" />

      {status && (
        <div className="card" style={{
          background: status.flashLocked === '0' ? 'var(--green-dim)' : 'var(--bg2)',
          border: `1px solid ${status.flashLocked === '0' ? 'rgba(74,222,128,0.2)' : 'var(--border)'}`
        }}>
          <div style={{ fontSize:14, fontWeight:600 }}>
            {status.flashLocked === '0' ? '  Bootloader is UNLOCKED' : '  Bootloader is LOCKED'}
          </div>
          {status.verifiedBootState && <div style={{ fontSize:12, color:'var(--text3)', marginTop:4 }}>State: {status.verifiedBootState}</div>}
        </div>
      )}

      <div>
        <div style={{ fontSize:12, color:'var(--text3)', marginBottom:6 }}>Select your brand</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {Object.keys(GUIDES).map(b => (
            <button key={b} onClick={() => setBrand(b)} style={{
              padding:'6px 12px', borderRadius:6, fontSize:12, cursor:'pointer', textTransform:'capitalize',
              background: brand===b ? 'var(--accent-dim)' : 'var(--bg2)',
              border:`1px solid ${brand===b ? 'var(--accent-border)' : 'var(--border)'}`,
              color: brand===b ? 'var(--accent)' : 'var(--text2)'
            }}>{GUIDES[b].name}</button>
          ))}
        </div>
      </div>

      {guide && (
        <div className="card">
          <div style={{ fontSize:14, fontWeight:600, marginBottom:12 }}>{guide.name}</div>
          {guide.steps.map((s, i) => (
            <div key={i} style={{ display:'flex', gap:12, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
              <span style={{ color:'var(--accent)', fontWeight:700, flexShrink:0, fontSize:13 }}>{i+1}</span>
              <span style={{ fontSize:13, color:'var(--text2)' }}>{s}</span>
            </div>
          ))}
          <button className="btn btn-sm" style={{ marginTop:12 }} onClick={() => ft.openUrl(guide.official)}>
            Official Guide  
          </button>
        </div>
      )}

      <div className="card" style={{ background:'var(--red-dim)', border:'1px solid rgba(248,113,113,0.2)' }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--red)', marginBottom:4 }}>  This wipes your device</div>
        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>
          Unlocking the bootloader does a factory reset. Back up everything first. Some carriers and manufacturers permanently flag the device (Samsung Knox, etc.).
        </div>
      </div>
    </PageWrap>
  )
}
