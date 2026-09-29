import { useState, useEffect } from 'react'
const ft = window.ft

function StepCard({ n, title, sub, children, color, done }) {
  const c = color || (done ? '#4ade80' : 'var(--border)')
  return (
    <div style={{ background:'var(--bg1)', border:`1px solid ${c}44`, borderRadius:10, padding:'12px 14px', borderLeft:`3px solid ${c}` }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:children?10:0 }}>
        <div style={{ width:26, height:26, borderRadius:'50%', background:done?'#4ade80':`${c}33`, color:done?'#000':c, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, flexShrink:0 }}>{done?'OK':n}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:700, color:done?'#4ade80':'var(--text)' }}>{title}</div>
          {sub && <div style={{ fontSize:11, color:'var(--text3)' }}>{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}

function Btn({ onClick, disabled, color, children, sm }) {
  const colors = {
    green:  { bg:'rgba(74,222,128,0.15)',  fg:'#4ade80',  bd:'rgba(74,222,128,0.3)' },
    blue:   { bg:'rgba(96,165,250,0.15)',  fg:'#60a5fa',  bd:'rgba(96,165,250,0.3)' },
    amber:  { bg:'rgba(245,158,11,0.15)',  fg:'#f59e0b',  bd:'rgba(245,158,11,0.3)' },
    red:    { bg:'rgba(248,113,113,0.15)', fg:'#f87171',  bd:'rgba(248,113,113,0.3)' },
    accent: { bg:'var(--accent)',          fg:'#000',     bd:'transparent' },
  }
  const s = colors[color] || { bg:'var(--bg3)', fg:'var(--text)', bd:'var(--border)' }
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ padding:sm?'5px 10px':'7px 14px', borderRadius:7, fontSize:sm?11:12, fontWeight:600, cursor:disabled?'not-allowed':'pointer', background:s.bg, color:s.fg, border:`1px solid ${s.bd}`, opacity:disabled?0.5:1, whiteSpace:'nowrap' }}>
      {children}
    </button>
  )
}

const SCENARIOS = [
  { id:'screen_debug_on',  label:'Broken screen, USB debugging WAS on',  icon:'OK', color:'#4ade80' },
  { id:'screen_debug_off', label:'Broken screen, USB debugging NOT on',   icon:'!!', color:'#f59e0b' },
  { id:'screen_samsung',   label:'Samsung broken screen (any state)',      icon:'S',  color:'#60a5fa' },
  { id:'bootloop',         label:'Bootloop / stuck on logo',               icon:'L',  color:'#f87171' },
  { id:'forgotten_pin',    label:'Forgotten PIN / locked out',             icon:'PIN',color:'#a78bfa' },
  { id:'usb_broken',       label:'USB port broken',                        icon:'USB',color:'#f59e0b' },
  { id:'water',            label:'Water damage recovery',                  icon:'W',  color:'#60a5fa' },
  { id:'ios_broken_screen',label:'iPhone broken screen - extract data',       icon:'iOS',color:'#a78bfa' },
  { id:'ios_screen',       label:'iPhone broken screen — extract data',       icon:'iOS',color:'#a78bfa' },
  { id:'ios_trusted',      label:'iPhone already trusted on this PC',         icon:'OK', color:'#4ade80' },
]

export default function BrokenDevice({ device, addLog }) {
  const [scenario, setScenario] = useState(null)
  const [adbResult, setAdbResult] = useState(null)
  const [step, setStep] = useState(0)
  const [checking, setChecking] = useState(false)
  const serial = device?.serial

  const checkAdb = async () => {
    setChecking(true)
    const r = await ft.device.list().catch(() => ({ android:[], ios:[] }))
    const found = r.android?.length > 0
    setAdbResult({ found, devices: r.android })
    addLog(found ? `ADB: found ${r.android.length} device(s)` : 'ADB: no devices found')
    setChecking(false)
  }

  const checkFastboot = async () => {
    setChecking(true)
    const r = await ft.fastboot.devices().catch(() => ({ devices:[] }))
    setAdbResult({ found: r.devices?.length > 0, devices: r.devices, mode:'fastboot' })
    addLog(`Fastboot: ${r.devices?.length || 0} device(s)`)
    setChecking(false)
  }

  const downloadMode = () => addLog('Samsung Download Mode: Power off > hold Vol Down + plug USB. Odin will detect it.')

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}>🔧</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>Broken Device Recovery</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Recover data and control devices with broken screens</div>
        </div>
      </div>

      {!scenario ? (
        <>
          <div style={{ fontSize:13, color:'var(--text2)', marginBottom:4 }}>What is your situation?</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {SCENARIOS.map(s => (
              <button key={s.id} onClick={() => { setScenario(s.id); setStep(0); setAdbResult(null) }}
                style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderRadius:9, cursor:'pointer', textAlign:'left', background:'var(--bg1)', border:`1px solid ${s.color}44`, borderLeft:`3px solid ${s.color}`, transition:'all 0.15s' }}>
                <div style={{ width:32, height:32, borderRadius:7, background:`${s.color}22`, color:s.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, flexShrink:0 }}>{s.icon}</div>
                <span style={{ fontSize:13, fontWeight:600, color:'var(--text)' }}>{s.label}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button onClick={() => setScenario(null)} style={{ alignSelf:'flex-start', padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer', background:'var(--bg2)', color:'var(--text3)', border:'1px solid var(--border)' }}>
            Back to scenarios
          </button>

          {/* ── USB debugging WAS on ── */}
          {scenario === 'screen_debug_on' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ padding:12, background:'rgba(74,222,128,0.1)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:8, fontSize:13, color:'#4ade80', fontWeight:600 }}>
                Good news — if USB debugging was on, you can control the phone fully without seeing the screen.
              </div>
              <StepCard n={1} title="Plug in the phone via USB">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>Use a working data cable. If the "Allow USB Debugging" dialog appeared before, it may auto-approve since the PC is already trusted.</div>
                <div style={{ display:'flex', gap:8, marginTop:8 }}>
                  <Btn onClick={checkAdb} disabled={checking} color="green">{checking?'Checking...':'Check ADB Connection'}</Btn>
                </div>
                {adbResult && (
                  <div style={{ marginTop:8, padding:'8px 10px', borderRadius:6, background: adbResult.found?'rgba(74,222,128,0.1)':'rgba(248,113,113,0.1)', border:`1px solid ${adbResult.found?'rgba(74,222,128,0.3)':'rgba(248,113,113,0.3)'}`, fontSize:12, color:adbResult.found?'#4ade80':'#f87171' }}>
                    {adbResult.found ? `Device found: ${adbResult.devices?.[0]?.serial || 'connected'}` : 'Device not found. Try: replug cable, check it powers on.'}
                  </div>
                )}
              </StepCard>
              <StepCard n={2} title="Mirror screen with scrcpy" sub="See and control phone on your PC">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>scrcpy mirrors the Android screen to your PC even if the physical screen is broken. You can tap using your mouse.</div>
                <Btn onClick={() => { ft.scrcpy?.launch({serial}).catch(()=>{}); addLog('Launching scrcpy screen mirror...') }} color="accent">Launch Screen Mirror</Btn>
                <div style={{ marginTop:6, fontSize:11, color:'var(--text3)' }}>Or use the ScrcpyGUI page for more options (bitrate, window size, etc.)</div>
              </StepCard>
              <StepCard n={3} title="Back up your data">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>With ADB working, you can pull everything off the phone.</div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  <Btn sm color="blue" onClick={() => { ft.adb.shell({serial, cmd:'content query --uri content://contacts/phones/'}).then(r=>addLog(r?.slice(0,200)||'done')).catch(e=>addLog(e.message)) }}>Test ADB Shell</Btn>
                  <Btn sm color="blue" onClick={() => addLog('Go to Backup page for full device backup')}>Full Backup</Btn>
                  <Btn sm color="blue" onClick={() => addLog('Go to File Manager to pull specific files')}>Pull Files</Btn>
                </div>
              </StepCard>
            </div>
          )}

          {/* ── Broken screen, USB debugging OFF (Samsung S24 FE specific) ── */}
          {(scenario === 'screen_debug_off' || scenario === 'screen_samsung') && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {scenario === 'screen_samsung' && (
                <div style={{ padding:12, background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.3)', borderRadius:8, fontSize:12, color:'#60a5fa', lineHeight:1.7 }}>
                  Samsung S24 FE / Galaxy specific options available. Samsung has more recovery paths than most Android phones.
                </div>
              )}

              <StepCard n={1} title="Check if ADB already works" sub="Plug in and test first">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>Even without seeing the screen, USB debugging may already be on from before. Try it first.</div>
                <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                  <Btn onClick={checkAdb} disabled={checking} color="green">{checking?'Checking...':'Check ADB'}</Btn>
                </div>
                {adbResult?.found && (
                  <div style={{ marginTop:8, padding:8, borderRadius:6, background:'rgba(74,222,128,0.1)', border:'1px solid rgba(74,222,128,0.3)', fontSize:12, color:'#4ade80' }}>
                    ADB is working! Go to the "Broken screen, USB debugging WAS on" scenario above.
                  </div>
                )}
              </StepCard>

              <StepCard n={2} title="USB-C mouse or OTG adapter" color="#f59e0b" sub="Navigate the phone blind or with a mouse">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  Get a USB-C to USB-A OTG adapter, plug in a mouse. You can now navigate the phone without seeing the screen:
                </div>
                {[
                  'Plug in OTG adapter + USB mouse',
                  'Move mouse to bottom of screen and click - this triggers navigation bar',
                  'Navigate: Settings > About Phone > Build Number (click 7 times)',
                  'Go back to Settings > Developer Options',
                  'Scroll down and click USB Debugging toggle area (roughly center-right)',
                  'A dialog appears - click OK/Allow (usually bottom-right button)',
                  'Unplug mouse, plug in PC USB cable',
                  'ADB should now work',
                ].map((s,i) => (
                  <div key={i} style={{ display:'flex', gap:8, marginBottom:6 }}>
                    <div style={{ width:20, height:20, borderRadius:'50%', background:'#f59e0b', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>{s}</div>
                  </div>
                ))}
              </StepCard>

              <StepCard n={3} title="Samsung Find My Mobile (remote ADB enable)" color="#60a5fa" sub="Requires Samsung account was set up on phone">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  If you had a Samsung account logged in, you can remotely unlock and enable ADB.
                </div>
                {[
                  { label:'Open Find My Mobile', url:'https://findmymobile.samsung.com/' },
                  { label:'Samsung Members', url:'https://members.samsung.com/' },
                ].map((l,i) => (
                  <button key={i} onClick={() => ft.openUrl(l.url)} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', width:'100%', padding:'8px 10px', borderRadius:7, cursor:'pointer', background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.2)', marginBottom:6 }}>
                    <span style={{ fontSize:12, color:'#60a5fa', fontWeight:600 }}>{l.label}</span>
                    <span style={{ fontSize:10, color:'var(--text3)' }}>Open</span>
                  </button>
                ))}
                <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.7 }}>
                  Find My Mobile can: unlock screen remotely, back up data, locate device. Use "Unlock" to dismiss the screen lock so OTG mouse works better.
                </div>
              </StepCard>

              <StepCard n={4} title="Samsung Download Mode + Smart Switch" color="#60a5fa" sub="Extract data via official Samsung method">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  Even with broken screen and no USB debugging, Samsung Download Mode still works.
                </div>
                {[
                  'Power off the phone completely',
                  'Hold Volume Down and plug in USB cable to PC',
                  'Samsung Download Mode activates (blue screen)',
                  'Install Samsung Smart Switch on PC',
                  'Open Smart Switch — it will detect the phone',
                  'Use Smart Switch to back up all data',
                ].map((s,i) => (
                  <div key={i} style={{ display:'flex', gap:8, marginBottom:6 }}>
                    <div style={{ width:20, height:20, borderRadius:'50%', background:'#60a5fa', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>{s}</div>
                  </div>
                ))}
                <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                  <Btn onClick={checkFastboot} disabled={checking} color="blue">{checking?'Checking...':'Check Download Mode'}</Btn>
                  <Btn onClick={() => ft.openUrl('https://www.samsung.com/us/support/owners/app/smart-switch')} color="blue" sm>Get Smart Switch</Btn>
                </div>
                {adbResult?.mode === 'fastboot' && adbResult.found && (
                  <div style={{ marginTop:8, padding:8, borderRadius:6, background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.3)', fontSize:12, color:'#60a5fa' }}>
                    Device detected in fastboot/download mode!
                  </div>
                )}
              </StepCard>

              <StepCard n={5} title="Screen replacement or repair" color="#888">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
                  Samsung S24 FE screen replacements are widely available. Cost is typically $80-150 for the part + labor. A working screen gives full access. Samsung authorized service centers can also transfer data during repair.
                </div>
              </StepCard>
            </div>
          )}

          {/* ── Bootloop ── */}
          {scenario === 'bootloop' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <StepCard n={1} title="Try ADB in recovery sideload mode" color="#f87171">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>Boot to recovery: hold Power + Volume Up. Then select Apply update from ADB.</div>
                <Btn onClick={checkAdb} disabled={checking} color="green">{checking?'Checking...':'Check ADB/Recovery'}</Btn>
              </StepCard>
              <StepCard n={2} title="Try Fastboot / Download Mode" color="#f59e0b">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>Power off completely (hold power 10s). Then enter fastboot/download mode.</div>
                <Btn onClick={checkFastboot} disabled={checking} color="amber">{checking?'Checking...':'Check Fastboot'}</Btn>
              </StepCard>
              <StepCard n={3} title="Flash stock firmware (Samsung: Odin)" color="#888">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
                  Download firmware from SamMobile or Frija. Flash via Odin in Download Mode. This usually fixes bootloops from bad updates or ROMs.
                </div>
                <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                  <Btn sm color="blue" onClick={() => ft.openUrl('https://www.sammobile.com/samsung/firmware/')}>SamMobile Firmware</Btn>
                  <Btn sm color="blue" onClick={() => ft.openUrl('https://github.com/zacharee/SamloaderKotlin/releases')}>Frija Downloader</Btn>
                </div>
              </StepCard>
            </div>
          )}

          {/* ── Forgotten PIN ── */}
          {scenario === 'forgotten_pin' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ padding:12, background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, fontSize:12, color:'#f87171', lineHeight:1.7 }}>
                Note: Bypassing a screen lock without the owner's authorization is illegal. These methods are for recovering your own device.
              </div>
              <StepCard n={1} title="Samsung Find My Mobile — Remote Unlock" color="#60a5fa">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>If Samsung account was set up, you can unlock remotely.</div>
                <Btn onClick={() => ft.openUrl('https://findmymobile.samsung.com/')} color="blue">Open Find My Mobile</Btn>
              </StepCard>
              <StepCard n={2} title="Google Account Recovery" color="#60a5fa">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>After too many failed PIN attempts, Android shows "Forgot PIN?" — sign in with Google account.</div>
                <Btn onClick={() => ft.openUrl('https://myaccount.google.com/')} color="blue">Google Account</Btn>
              </StepCard>
              <StepCard n={3} title="Factory Reset (last resort — data loss)" color="#f87171">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>Boot to recovery (Power + Vol Up for Samsung), select Wipe data / Factory reset. All data lost.</div>
              </StepCard>
            </div>
          )}

          {/* ── USB broken ── */}
          {scenario === 'usb_broken' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <StepCard n={1} title="ADB over Wi-Fi (if debugging was on)" color="#4ade80">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>If Wireless Debugging or ADB-over-WiFi was enabled, you can connect without USB.</div>
                <div style={{ display:'flex', gap:8 }}>
                  <Btn onClick={() => addLog('Use Network Scan tab in Device Finder to find the device on WiFi')} color="green" sm>Scan Network</Btn>
                </div>
              </StepCard>
              <StepCard n={2} title="Wireless file sync apps" color="#60a5fa">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>Apps like AirDroid, LocalSend, or FTP Server apps let you access files over WiFi from any browser on the same network.</div>
              </StepCard>
              <StepCard n={3} title="Cloud backup (Google / Samsung Cloud)" color="#888">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>Enable Google Backup or Samsung Cloud from Settings to sync contacts, photos, and app data wirelessly.</div>
              </StepCard>
            </div>
          )}

          {/* ── iOS broken screen ── */}
          {scenario === 'ios_screen' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ padding:12, background:'rgba(167,139,250,0.1)', border:'1px solid rgba(167,139,250,0.3)', borderRadius:8, fontSize:12, color:'#a78bfa', lineHeight:1.7 }}>
                iPhone 6 has an A8 chip which is permanently exploitable via checkm8. Several paths exist to extract all data.
              </div>

              <StepCard n={1} title="Check if already trusted on this PC" color="#4ade80" sub="Fastest path — try this first">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  If this iPhone was ever connected and trusted on this PC, you can backup the entire device right now without touching the screen.
                </div>
                <Btn onClick={async () => { setChecking(true); const r = await ft.iosDiag.run().catch(()=>({})); setAdbResult({found:r.device_trusted, ios:true, trusted:r.device_trusted, detected:r.device_found}); addLog(r.device_trusted?'iPhone trusted - can backup now!':r.device_found?'iPhone detected but not trusted':'iPhone not detected'); setChecking(false) }} disabled={checking} color="green">{checking?'Checking...':'Check Trust Status'}</Btn>
                {adbResult?.ios && (
                  <div style={{ marginTop:8, padding:'8px 10px', borderRadius:6, background:adbResult.trusted?'rgba(74,222,128,0.1)':'rgba(245,158,11,0.1)', border:`1px solid ${adbResult.trusted?'rgba(74,222,128,0.3)':'rgba(245,158,11,0.3)'}`, fontSize:12, color:adbResult.trusted?'#4ade80':'#f59e0b', lineHeight:1.7 }}>
                    {adbResult.trusted ? 'TRUSTED - Go to scenario "iPhone already trusted on this PC" to extract everything!' : adbResult.detected ? 'iPhone detected but NOT trusted on this PC. Follow steps below.' : 'iPhone not detected. Make sure it is plugged in and powered on.'}
                  </div>
                )}
              </StepCard>

              <StepCard n={2} title="Siri workaround (no screen needed)" color="#a78bfa" sub="iPhone 6 - Siri works from lock screen">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  Hold the Home button. When Siri activates (you will hear a chime), say:
                </div>
                {[
                  '"Turn on USB accessories" — disables USB Restricted Mode',
                  '"Open Settings" — navigate to Developer Options via voice',
                  'Or: connect a Bluetooth keyboard and type PIN to unlock',
                ].map((s,i) => (
                  <div key={i} style={{ display:'flex', gap:8, marginBottom:5 }}>
                    <span style={{ color:'#a78bfa', fontWeight:700, flexShrink:0 }}>{i+1}.</span>
                    <span style={{ fontSize:12, color:'var(--text2)' }}>{s}</span>
                  </div>
                ))}
              </StepCard>

              <StepCard n={3} title="checkra1n jailbreak (iPhone 6 A8 — no screen needed)" color="#f59e0b" sub="Permanent exploit — full filesystem access">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  iPhone 6 uses the A8 chip which has a permanent hardware bootrom exploit (checkm8). You can jailbreak it in DFU mode entirely from your PC, then extract all files including the Documents folder.
                </div>
                {[
                  { step:'Enter DFU mode (no screen needed)', detail:'Hold Power button 3 seconds, then hold Home+Power 10 seconds, release Power but keep holding Home 5 seconds. Screen stays black in DFU.' },
                  { step:'Install checkra1n on Linux/macOS (or use palen1x USB)', detail:'checkra1n does not run on Windows. Boot a Linux live USB (palen1x from USB Hub) and run checkra1n from there.' },
                  { step:'Once jailbroken — SSH over USB', detail:'iproxy 22 22 then SSH to localhost as root. Full filesystem access.' },
                  { step:'Or use AFC2 (Apple File Conduit 2)', detail:'Install AFC2 via Cydia/Sileo, then use Omerta File Manager to browse entire filesystem.' },
                  { step:'Extract Documents folder', detail:'All app Documents are at /var/mobile/Containers/Data/Application/[UUID]/Documents/' },
                ].map((s,i) => (
                  <div key={i} style={{ padding:'8px 10px', background:'var(--bg2)', borderRadius:7, marginBottom:5, border:'1px solid var(--border)' }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'#f59e0b', marginBottom:3 }}>{i+1}. {s.step}</div>
                    <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.6 }}>{s.detail}</div>
                  </div>
                ))}
                <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                  <Btn sm color="amber" onClick={() => ft.openUrl('https://github.com/palera1n/palen1x/releases')}>palen1x (bootable USB)</Btn>
                  <Btn sm color="amber" onClick={() => ft.openUrl('https://checkra.in')}>checkra1n</Btn>
                </div>
              </StepCard>

              <StepCard n={4} title="Screen replacement — iPhone 6" color="#888" sub="Cheapest option — $15-25">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
                  iPhone 6 screens are extremely cheap and widely available. Replacement takes 15 minutes with basic tools. Once screen works: approve Trust, run backup, done. Search "iPhone 6 screen replacement" on YouTube for a guide.
                </div>
                <Btn sm color="blue" onClick={() => ft.openUrl('https://www.ifixit.com/Guide/iPhone+6+Screen+Replacement/25505')} style={{ marginTop:8 }}>iFixit Repair Guide</Btn>
              </StepCard>
            </div>
          )}

          {/* ── iOS already trusted ── */}
          {scenario === 'ios_trusted' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ padding:12, background:'rgba(74,222,128,0.1)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:8, fontSize:13, color:'#4ade80', fontWeight:600 }}>
                Your iPhone is trusted on this PC. You can extract all data right now with no screen interaction.
              </div>
              <StepCard n={1} title="Full encrypted backup (fastest)" color="#4ade80">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  Creates a complete backup: photos, messages, contacts, notes, app data, documents. Run from PowerShell in the freetoolz folder:
                </div>
                <div style={{ fontFamily:'monospace', fontSize:11, background:'#0a0a0a', borderRadius:6, padding:10, color:'#d4d4d4', lineHeight:1.8, border:'1px solid var(--border)', userSelect:'text' }}>
                  .\bin\idevicebackup2.exe backup --full C:\Users\omert\Desktop\iphone_backup
                </div>
                <div style={{ fontSize:11, color:'var(--text3)', marginTop:6 }}>Takes 5-30 minutes depending on storage. Backup will be at the path above.</div>
              </StepCard>
              <StepCard n={2} title="Extract specific files (faster)" color="#60a5fa">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  Pull just the files you need without a full backup.
                </div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  <Btn sm color="blue" onClick={() => { ft.iosExtra.notes({}).then(r=>addLog(r.path?'Notes: '+r.path:r.error||'done')).catch(e=>addLog(e.message)) }}>Export Notes</Btn>
                  <Btn sm color="blue" onClick={() => addLog('Use iOS Hub > Data Export > Photos to pull photos')}>Pull Photos</Btn>
                  <Btn sm color="blue" onClick={() => addLog('Use iOS Hub > Data Export > Health for health data')}>Health Data</Btn>
                  <Btn sm color="blue" onClick={() => addLog('Use Backup page for selective app backup')}>App Backup</Btn>
                </div>
              </StepCard>
              <StepCard n={3} title="Browse backup with SQLite Browser" color="#60a5fa">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
                  After backup, use Omerta SQLite Browser to open backup databases and read messages, notes, contacts directly.
                </div>
              </StepCard>
            </div>
          )}

          {/* ── iOS broken screen ── */}
          {scenario === 'ios_broken_screen' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ padding:12, background:'rgba(167,139,250,0.1)', border:'1px solid rgba(167,139,250,0.3)', borderRadius:8, fontSize:13, color:'#a78bfa', fontWeight:600 }}>
                iPhone 6 (A8 chip) — checkra1n jailbreak works without touching the screen. Even with a broken screen, full data extraction is possible.
              </div>

              <StepCard n={1} title="Try existing pairing record first" color="#4ade80" sub="If this PC was trusted before — fastest path">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  If you ever connected this iPhone to this PC and tapped Trust, a pairing record exists. The backup will work immediately without any screen interaction.
                </div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                  <Btn onClick={checkAdb} disabled={checking} color="green">{checking?'Checking...':'Detect iPhone'}</Btn>
                </div>
                <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.7 }}>
                  Pairing records are stored at:<br/>
                  <code style={{ color:'#a78bfa' }}>C:\ProgramData\Apple\Lockdown\</code><br/>
                  If a file named after your UDID exists there, you can backup right now.
                </div>
                <button onClick={() => ft.openUrl('C:\ProgramData\Apple\Lockdown')} style={{ marginTop:8, padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer', background:'rgba(167,139,250,0.15)', color:'#a78bfa', border:'1px solid rgba(167,139,250,0.3)' }}>Open Lockdown folder in Explorer</button>
              </StepCard>

              <StepCard n={2} title="Run backup NOW if paired" color="#4ade80" sub="No screen needed — works with existing trust">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  If the iPhone is detected, run a full backup immediately. Plug in, wait 30 seconds, then:
                </div>
                <div style={{ fontFamily:'monospace', fontSize:11, padding:'8px 12px', background:'#0a0a0a', borderRadius:7, color:'#d4d4d4', marginBottom:8, lineHeight:1.9 }}>
                  .\bin\idevice_id.exe -l<br/>
                  .\bin\idevicebackup2.exe backup --full C:\iPhone6_backup
                </div>
                <div style={{ fontSize:11, color:'var(--text3)' }}>Backup includes: photos, contacts, messages, notes, app data, call history, voicemail.</div>
              </StepCard>

              <StepCard n={3} title="iPhone not paired? Use VoiceOver + Siri" color="#f59e0b" sub="Approve Trust without seeing screen">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  If the iPhone has not been trusted on this PC, you need to approve the Trust dialog blindly:
                </div>
                {[
                  'Plug in the iPhone and wait 10 seconds for the Trust dialog to appear',
                  'Triple-press Home button — this activates VoiceOver (if enabled in accessibility)',
                  'Or: hold Home button to activate Siri, say "Turn on VoiceOver"',
                  'With VoiceOver on: the Trust dialog reads aloud — double-tap to confirm',
                  'If Siri can reach the internet, say "Trust this computer" (sometimes works)',
                  'Alternative: plug in external keyboard via Lightning adapter, press Tab then Space to click Trust',
                ].map((s,i) => (
                  <div key={i} style={{ display:'flex', gap:8, marginBottom:6 }}>
                    <div style={{ width:20, height:20, borderRadius:'50%', background:'#f59e0b', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>{s}</div>
                  </div>
                ))}
              </StepCard>

              <StepCard n={4} title="checkra1n jailbreak (no screen needed)" color="#a78bfa" sub="iPhone 6 = A8 chip = fully supported">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  checkra1n uses a hardware bootrom exploit that requires NO screen interaction. It runs entirely from PC/Mac. After jailbreak, you get SSH access and can extract everything.
                </div>
                <div style={{ padding:'8px 12px', background:'rgba(167,139,250,0.1)', borderRadius:7, border:'1px solid rgba(167,139,250,0.3)', marginBottom:8 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#a78bfa', marginBottom:4 }}>Requirements</div>
                  <div style={{ fontSize:11, color:'var(--text2)', lineHeight:1.8 }}>
                    macOS or Linux (checkra1n has no Windows binary)<br/>
                    OR: Windows + WSL2 + checkn1x bootable USB<br/>
                    iPhone 6 on iOS 12 = fully supported
                  </div>
                </div>
                {[
                  'On Linux/Mac: download checkra1n from checkra.in',
                  'Put iPhone into DFU mode: hold Power + Home for 8s, release Power but keep holding Home for 5s',
                  'Run: ./checkra1n (it will detect the phone in DFU automatically)',
                  'After jailbreak: install OpenSSH from Cydia',
                  'SSH into phone: ssh root@<ip> (password: alpine)',
                  'Pull everything: scp -r root@<ip>:/var/mobile/Media ./backup/',
                  'For app data: scp -r root@<ip>:/var/mobile/Containers/Data/Application/ ./apps/',
                ].map((s,i) => (
                  <div key={i} style={{ display:'flex', gap:8, marginBottom:6 }}>
                    <div style={{ width:20, height:20, borderRadius:'50%', background:'#a78bfa', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>{s}</div>
                  </div>
                ))}
                <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                  <Btn sm color="blue" onClick={() => ft.openUrl('https://checkra.in')}>checkra1n download</Btn>
                  <Btn sm color="blue" onClick={() => ft.openUrl('https://github.com/asineth0/checkn1x/releases')}>checkn1x (bootable USB)</Btn>
                </div>
              </StepCard>

              <StepCard n={5} title="DFU mode backup via iTunes" color="#60a5fa" sub="Works without screen — no passcode needed for DFU restore">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
                  DFU mode bypasses iOS completely. If you just want an encrypted backup that you can decrypt later, iTunes can sometimes trigger a backup when the phone is in DFU. Note: DFU mode restore will erase the phone — only use for data recovery after jailbreak.
                </div>
              </StepCard>

              <StepCard n={6} title="Professional data recovery" color="#888">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
                  If all else fails: phone repair shops with NAND chip readers can extract data directly from the storage chip, even on a completely dead phone. Cost: $100-500 depending on damage.
                </div>
              </StepCard>

              <div style={{ padding:12, background:'rgba(74,222,128,0.08)', border:'1px solid rgba(74,222,128,0.2)', borderRadius:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#4ade80', marginBottom:6 }}>Quick command to run right now:</div>
                <div style={{ fontFamily:'monospace', fontSize:12, color:'#d4d4d4', background:'#0a0a0a', padding:'8px 12px', borderRadius:6, lineHeight:1.9 }}>
                  cd C:\Users\omert\Desktop\freetoolz<br/>
                  .\bin\idevice_id.exe -l<br/>
                  .\bin\idevicepair.exe pair<br/>
                  .\bin\idevicebackup2.exe backup --full C:\iPhone6_Backup
                </div>
              </div>
            </div>
          )}

        {/* ── Water damage ── */}          {/* ── iOS broken screen ── */}
          {scenario === 'ios_broken_screen' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ padding:12, background:'rgba(167,139,250,0.1)', border:'1px solid rgba(167,139,250,0.3)', borderRadius:8, fontSize:13, color:'#a78bfa', fontWeight:600 }}>
                iPhone 6 (A8 chip) — checkra1n jailbreak works without touching the screen. Even with a broken screen, full data extraction is possible.
              </div>

              <StepCard n={1} title="Try existing pairing record first" color="#4ade80" sub="If this PC was trusted before — fastest path">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  If you ever connected this iPhone to this PC and tapped Trust, a pairing record exists. The backup will work immediately without any screen interaction.
                </div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                  <Btn onClick={checkAdb} disabled={checking} color="green">{checking?'Checking...':'Detect iPhone'}</Btn>
                </div>
                <div style={{ fontSize:11, color:'var(--text3)', lineHeight:1.7 }}>
                  Pairing records are stored at:<br/>
                  <code style={{ color:'#a78bfa' }}>C:\ProgramData\Apple\Lockdown\</code><br/>
                  If a file named after your UDID exists there, you can backup right now.
                </div>
                <button onClick={() => ft.openUrl('C:\ProgramData\Apple\Lockdown')} style={{ marginTop:8, padding:'5px 12px', borderRadius:6, fontSize:11, cursor:'pointer', background:'rgba(167,139,250,0.15)', color:'#a78bfa', border:'1px solid rgba(167,139,250,0.3)' }}>Open Lockdown folder in Explorer</button>
              </StepCard>

              <StepCard n={2} title="Run backup NOW if paired" color="#4ade80" sub="No screen needed — works with existing trust">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  If the iPhone is detected, run a full backup immediately. Plug in, wait 30 seconds, then:
                </div>
                <div style={{ fontFamily:'monospace', fontSize:11, padding:'8px 12px', background:'#0a0a0a', borderRadius:7, color:'#d4d4d4', marginBottom:8, lineHeight:1.9 }}>
                  .\bin\idevice_id.exe -l<br/>
                  .\bin\idevicebackup2.exe backup --full C:\iPhone6_backup
                </div>
                <div style={{ fontSize:11, color:'var(--text3)' }}>Backup includes: photos, contacts, messages, notes, app data, call history, voicemail.</div>
              </StepCard>

              <StepCard n={3} title="iPhone not paired? Use VoiceOver + Siri" color="#f59e0b" sub="Approve Trust without seeing screen">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  If the iPhone has not been trusted on this PC, you need to approve the Trust dialog blindly:
                </div>
                {[
                  'Plug in the iPhone and wait 10 seconds for the Trust dialog to appear',
                  'Triple-press Home button — this activates VoiceOver (if enabled in accessibility)',
                  'Or: hold Home button to activate Siri, say "Turn on VoiceOver"',
                  'With VoiceOver on: the Trust dialog reads aloud — double-tap to confirm',
                  'If Siri can reach the internet, say "Trust this computer" (sometimes works)',
                  'Alternative: plug in external keyboard via Lightning adapter, press Tab then Space to click Trust',
                ].map((s,i) => (
                  <div key={i} style={{ display:'flex', gap:8, marginBottom:6 }}>
                    <div style={{ width:20, height:20, borderRadius:'50%', background:'#f59e0b', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>{s}</div>
                  </div>
                ))}
              </StepCard>

              <StepCard n={4} title="checkra1n jailbreak (no screen needed)" color="#a78bfa" sub="iPhone 6 = A8 chip = fully supported">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>
                  checkra1n uses a hardware bootrom exploit that requires NO screen interaction. It runs entirely from PC/Mac. After jailbreak, you get SSH access and can extract everything.
                </div>
                <div style={{ padding:'8px 12px', background:'rgba(167,139,250,0.1)', borderRadius:7, border:'1px solid rgba(167,139,250,0.3)', marginBottom:8 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#a78bfa', marginBottom:4 }}>Requirements</div>
                  <div style={{ fontSize:11, color:'var(--text2)', lineHeight:1.8 }}>
                    macOS or Linux (checkra1n has no Windows binary)<br/>
                    OR: Windows + WSL2 + checkn1x bootable USB<br/>
                    iPhone 6 on iOS 12 = fully supported
                  </div>
                </div>
                {[
                  'On Linux/Mac: download checkra1n from checkra.in',
                  'Put iPhone into DFU mode: hold Power + Home for 8s, release Power but keep holding Home for 5s',
                  'Run: ./checkra1n (it will detect the phone in DFU automatically)',
                  'After jailbreak: install OpenSSH from Cydia',
                  'SSH into phone: ssh root@<ip> (password: alpine)',
                  'Pull everything: scp -r root@<ip>:/var/mobile/Media ./backup/',
                  'For app data: scp -r root@<ip>:/var/mobile/Containers/Data/Application/ ./apps/',
                ].map((s,i) => (
                  <div key={i} style={{ display:'flex', gap:8, marginBottom:6 }}>
                    <div style={{ width:20, height:20, borderRadius:'50%', background:'#a78bfa', color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>{s}</div>
                  </div>
                ))}
                <div style={{ display:'flex', gap:8, marginTop:8, flexWrap:'wrap' }}>
                  <Btn sm color="blue" onClick={() => ft.openUrl('https://checkra.in')}>checkra1n download</Btn>
                  <Btn sm color="blue" onClick={() => ft.openUrl('https://github.com/asineth0/checkn1x/releases')}>checkn1x (bootable USB)</Btn>
                </div>
              </StepCard>

              <StepCard n={5} title="DFU mode backup via iTunes" color="#60a5fa" sub="Works without screen — no passcode needed for DFU restore">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
                  DFU mode bypasses iOS completely. If you just want an encrypted backup that you can decrypt later, iTunes can sometimes trigger a backup when the phone is in DFU. Note: DFU mode restore will erase the phone — only use for data recovery after jailbreak.
                </div>
              </StepCard>

              <StepCard n={6} title="Professional data recovery" color="#888">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>
                  If all else fails: phone repair shops with NAND chip readers can extract data directly from the storage chip, even on a completely dead phone. Cost: $100-500 depending on damage.
                </div>
              </StepCard>

              <div style={{ padding:12, background:'rgba(74,222,128,0.08)', border:'1px solid rgba(74,222,128,0.2)', borderRadius:8 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#4ade80', marginBottom:6 }}>Quick command to run right now:</div>
                <div style={{ fontFamily:'monospace', fontSize:12, color:'#d4d4d4', background:'#0a0a0a', padding:'8px 12px', borderRadius:6, lineHeight:1.9 }}>
                  cd C:\Users\omert\Desktop\freetoolz<br/>
                  .\bin\idevice_id.exe -l<br/>
                  .\bin\idevicepair.exe pair<br/>
                  .\bin\idevicebackup2.exe backup --full C:\iPhone6_Backup
                </div>
              </div>
            </div>
          )}

        {/* ── Water damage ── */}
          {scenario === 'water' && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ padding:12, background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:8, fontSize:12, color:'#60a5fa', lineHeight:1.7 }}>
                Do NOT plug in water-damaged devices. Let them dry completely first (24-72 hours in silica gel or rice).
              </div>
              <StepCard n={1} title="Dry the device first" color="#60a5fa">
                {['Power off immediately','Remove SIM and SD card','Do NOT use a hairdryer (heat damages components)','Submerge in silica gel packets or dry rice for 24-72 hours','Place near (not on) a fan in a warm dry room'].map((s,i) => (
                  <div key={i} style={{ display:'flex', gap:8, marginBottom:5 }}>
                    <span style={{ color:'#60a5fa', fontWeight:700 }}>{i+1}.</span>
                    <span style={{ fontSize:12, color:'var(--text2)' }}>{s}</span>
                  </div>
                ))}
              </StepCard>
              <StepCard n={2} title="After drying — try ADB" color="#4ade80">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, marginBottom:8 }}>If the phone powers on, check ADB connection.</div>
                <Btn onClick={checkAdb} disabled={checking} color="green">{checking?'Checking...':'Check ADB'}</Btn>
              </StepCard>
              <StepCard n={3} title="Professional repair" color="#888">
                <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7 }}>Board-level water damage repair requires ultrasonic cleaning and component replacement. Most repair shops offer data recovery services even for severely damaged boards.</div>
              </StepCard>
            </div>
          )}
        </>
      )}
    </div>
  )
}
