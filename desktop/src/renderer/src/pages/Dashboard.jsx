import { useState, useEffect } from 'react'

const ft = window.ft

function InfoRow({ label, value, mono, copy, accent }) {
  if (!value && value !== 0) return null
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid var(--border)', gap:8 }}>
      <span style={{ fontSize:11, color:'var(--text3)', flexShrink:0 }}>{label}</span>
      <span style={{ fontSize:12, color: accent ? 'var(--accent)' : 'var(--text2)', fontFamily: mono ? 'monospace' : 'inherit', textAlign:'right', wordBreak:'break-all', cursor: copy ? 'pointer' : 'default' }}
        onClick={copy ? () => { navigator.clipboard?.writeText(String(value)); } : undefined}
        title={copy ? 'Click to copy' : undefined}>
        {String(value)}
      </span>
    </div>
  )
}

function Section({ title, icon, children }) {
  return (
    <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
      <div style={{ fontSize:12, fontWeight:700, color:'var(--text3)', letterSpacing:'0.06em', marginBottom:10 }}>{icon} {title}</div>
      {children}
    </div>
  )
}

function Bar({ pct, color, height }) {
  return (
    <div style={{ background:'var(--bg3)', borderRadius:3, height: height||6, overflow:'hidden' }}>
      <div style={{ width:Math.min(pct||0,100)+'%', height:'100%', background: color || 'var(--accent)', borderRadius:3, transition:'width 0.5s' }} />
    </div>
  )
}

export default function Dashboard({ device, addLog }) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [screenshot, setScreenshot] = useState(null)
  const [tab, setTab] = useState('overview')

  const serial = device?.serial || device?.udid

  useEffect(() => {
    if (!device) return
    setLoading(true)
    ft.device.info({ serial, type: device.deviceType }).catch(() => null).then(d => { setInfo(d); setLoading(false) })
  }, [serial])

  const refresh = () => {
    if (!device) return
    setLoading(true)
    ft.device.info({ serial, type: device.deviceType }).catch(() => null).then(d => { setInfo(d); setLoading(false) })
  }

  const takeScreenshot = async () => {
    if (!device) return
    try {
      const ss = await ft.device.screenshot({ serial, type: device.deviceType })
      setScreenshot(`data:${ss.mimeType};base64,${ss.base64}`)
    } catch (e) { addLog('Screenshot: ' + e.message) }
  }

  const reboot = async (mode) => {
    if (!device) return
    try {
      await ft.adb.reboot({ serial, mode: mode || 'normal' })
      addLog('Rebooting' + (mode ? ' to ' + mode : ''))
    } catch (e) { addLog('Reboot: ' + e.message) }
  }

  const copyAll = () => {
    if (!info) return
    const text = Object.entries(info).filter(([k]) => !k.startsWith('_') && typeof info[k] !== 'object').map(([k,v]) => `${k}: ${v}`).join(String.fromCharCode(10))
    navigator.clipboard?.writeText(text)
    addLog('Device info copied to clipboard')
  }

  if (!device) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:12, color:'var(--text3)' }}>
      <div style={{ fontSize:40 }}> </div>
      <div style={{ fontSize:16, fontWeight:600, color:'var(--text)' }}>No device connected</div>
      <div style={{ fontSize:13 }}>Connect an Android phone or iPhone to get started.</div>
    </div>
  )

  const TABS = [['overview','Overview'],['hardware','Hardware'],['software','Software'],['network','Network'],['security','Security']]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>

      {/* Device header */}
      <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
        <div style={{ width:52, height:52, borderRadius:14, background:'var(--accent-dim)', border:'1px solid var(--accent-border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:26, flexShrink:0 }}>
          {device.deviceType === 'ios' ? ' ' : ' '}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:18, fontWeight:700, color:'var(--text)', marginBottom:2 }}>
            {info?.displayName || info?.name || `${info?.brand || ''} ${info?.model || device?.model || 'Device'}`.trim() || 'Device'}
          </div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>
            {device.deviceType === 'android'
              ? `Android ${info?.android || ''}   SDK ${info?.sdk || ''}   ${serial}`
              : `iOS ${info?.ios || ''}   ${serial?.slice(0,16)}...`}
          </div>
          <div style={{ display:'flex', gap:6, marginTop:6, flexWrap:'wrap' }}>
            {info?.rooted === 'Yes' && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'rgba(248,113,113,0.2)', color:'#f87171', fontWeight:600 }}>Rooted</span>}
            {info?.bootloaderLocked === 'Unlocked' && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'rgba(245,158,11,0.2)', color:'#f59e0b', fontWeight:600 }}>BL Unlocked</span>}
            {info?.activationState && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'rgba(74,222,128,0.2)', color:'#4ade80', fontWeight:600 }}>{info.activationState}</span>}
            {info?.encrypted && <span style={{ fontSize:10, padding:'2px 7px', borderRadius:4, background:'rgba(96,165,250,0.2)', color:'#60a5fa', fontWeight:600 }}>{info.encrypted === 'encrypted' ? 'Encrypted' : info.encrypted}</span>}
          </div>
        </div>
        <div style={{ display:'flex', flex:'column', gap:5, flexShrink:0 }}>
          <button onClick={takeScreenshot} style={{ padding:'6px 12px', borderRadius:6, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)', display:'block', marginBottom:4 }}>Screenshot</button>
          <button onClick={refresh} style={{ padding:'6px 12px', borderRadius:6, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)', display:'block', marginBottom:4 }}>Refresh</button>
          <button onClick={copyAll} style={{ padding:'6px 12px', borderRadius:6, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)', display:'block' }}>Copy All</button>
        </div>
      </div>

      {screenshot && (
        <div style={{ display:'flex', gap:10 }}>
          <img src={screenshot} style={{ height:220, borderRadius:10, border:'1px solid var(--border)' }} />
          <button onClick={() => setScreenshot(null)} style={{ alignSelf:'flex-start', padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>Close</button>
        </div>
      )}

      {/* Storage + Battery bars */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        {info?.storagePercent != null && (
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:6 }}>
              <span style={{ color:'var(--text3)', fontWeight:600 }}>STORAGE</span>
              <span style={{ color:'var(--text3)' }}>{info.storageUsed} / {info.storageTotal}</span>
            </div>
            <Bar pct={info.storagePercent} color={info.storagePercent > 85 ? '#f87171' : info.storagePercent > 65 ? '#f59e0b' : '#4ade80'} />
            <div style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>{info.storageFree} free   {info.storagePercent}% used</div>
          </div>
        )}
        {info?.batteryLevel != null && (
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:6 }}>
              <span style={{ color:'var(--text3)', fontWeight:600 }}>BATTERY</span>
              <span style={{ color: info.batteryLevel < 20 ? '#f87171' : '#4ade80', fontWeight:700 }}>{info.batteryLevel}%</span>
            </div>
            <Bar pct={info.batteryLevel} color={info.batteryLevel < 20 ? '#f87171' : info.batteryLevel < 50 ? '#f59e0b' : '#4ade80'} />
            <div style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>{info.batteryStatus} {info.batteryPlugged ? '  ' + info.batteryPlugged : ''} {info.batteryTemp ? '  ' + info.batteryTemp : ''}</div>
          </div>
        )}
        {info?.ramPercent != null && (
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:6 }}>
              <span style={{ color:'var(--text3)', fontWeight:600 }}>RAM</span>
              <span style={{ color:'var(--text3)' }}>{info.ramUsed} / {info.ramNice || info.ramTotal}</span>
            </div>
            <Bar pct={info.ramPercent} color={info.ramPercent > 85 ? '#f87171' : '#60a5fa'} />
            <div style={{ fontSize:10, color:'var(--text3)', marginTop:4 }}>{info.ramFree} free   {info.ramPercent}% used</div>
          </div>
        )}
        {info?.uptime && (
          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:12, display:'flex', flexDirection:'column', justifyContent:'center' }}>
            <div style={{ fontSize:11, color:'var(--text3)', fontWeight:600, marginBottom:4 }}>UPTIME</div>
            <div style={{ fontSize:20, fontWeight:700, color:'var(--accent)' }}>{info.uptime}</div>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3 }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'6px 4px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background: tab===id ? 'var(--accent)' : 'transparent', color: tab===id ? '#000' : 'var(--text3)', border:'none' }}>{label}</button>
        ))}
      </div>

      {loading && <div style={{ textAlign:'center', padding:20, color:'var(--text3)', fontSize:13 }}>Loading device info...</div>}

      {!loading && info && (
        <>
          {tab === 'overview' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <Section title="IDENTITY" icon=" ">
                <InfoRow label="Brand" value={info.brand} />
                <InfoRow label="Model Name" value={info.marketName || info.model} />
                <InfoRow label="Device" value={info.device} mono />
                <InfoRow label="Manufacturer" value={info.manufacturer} />
                <InfoRow label="Serial" value={info.serial} mono copy />
                <InfoRow label="Screen" value={info.resolution} />
                <InfoRow label="Density" value={info.dpi || (info.screenDensity ? info.screenDensity + ' dpi' : null)} />
              </Section>
              <Section title="BATTERY" icon=" ">
                <InfoRow label="Level" value={info.batteryLevel != null ? info.batteryLevel + '%' : null} accent={info.batteryLevel < 20} />
                <InfoRow label="Status" value={info.batteryStatus} />
                <InfoRow label="Plugged" value={info.batteryPlugged} />
                <InfoRow label="Health" value={info.batteryHealth} />
                <InfoRow label="Voltage" value={info.batteryVoltage} />
                <InfoRow label="Temperature" value={info.batteryTemp} />
                <InfoRow label="Technology" value={info.batteryTechnology} />
              </Section>
              <Section title="STORAGE" icon=" ">
                <InfoRow label="Total" value={info.storageTotal} />
                <InfoRow label="Used" value={info.storageUsed} />
                <InfoRow label="Free" value={info.storageFree} />
                <InfoRow label="SD Card Total" value={info.sdTotal} />
                <InfoRow label="SD Card Free" value={info.sdFree} />
              </Section>
              <Section title="MEMORY" icon=" ">
                <InfoRow label="Total RAM" value={info.ramNice || info.ramTotal} />
                <InfoRow label="Used RAM" value={info.ramUsed} />
                <InfoRow label="Free RAM" value={info.ramFree} />
                <InfoRow label="Swap" value={info.swapTotal} />
                <InfoRow label="Java Heap" value={info.javaHeap} />
                <InfoRow label="Max Heap" value={info.totalHeap} />
              </Section>
            </div>
          )}

          {tab === 'hardware' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <Section title="PROCESSOR" icon=" ">
                <InfoRow label="Chipset" value={info.soc || info.chipset} />
                <InfoRow label="SoC Maker" value={info.socMfr} />
                <InfoRow label="Hardware" value={info.hardware} />
                <InfoRow label="Architecture" value={info.abi} mono />
                <InfoRow label="ABI List" value={info.abiList} mono />
                <InfoRow label="CPU Cores" value={info.cpuCores} />
                <InfoRow label="Max Freq" value={info.cpuMhz} />
              </Section>
              <Section title="GRAPHICS" icon=" ">
                <InfoRow label="OpenGL ES" value={info.glesVersion ? ('0x' + parseInt(info.glesVersion).toString(16)) : null} />
                <InfoRow label="Vulkan" value={info.vulkan} />
              </Section>
              <Section title="RADIO" icon=" ">
                <InfoRow label="IMEI 1" value={info.imei1} mono copy />
                <InfoRow label="IMEI 2" value={info.imei2} mono copy />
                <InfoRow label="ICCID" value={info.iccid} mono />
                <InfoRow label="Baseband" value={info.basebandFull || info.baseband} mono />
                <InfoRow label="RF Chipset" value={info.rfChipset} />
              </Section>
              <Section title="IDENTIFIERS" icon=" ">
                <InfoRow label="Serial" value={info.serial} mono copy />
                <InfoRow label="Bootloader" value={info.bootloader} mono />
                <InfoRow label="Board" value={info.revision} mono />
                <InfoRow label="Fingerprint" value={info.fingerprint?.split('/').pop()} mono />
              </Section>
            </div>
          )}

          {tab === 'software' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <Section title="ANDROID" icon=" ">
                <InfoRow label="Version" value={info.androidFull || info.android} accent />
                <InfoRow label="SDK Level" value={info.sdk} />
                <InfoRow label="Build ID" value={info.build} mono />
                <InfoRow label="Build Display" value={info.buildDisplay} mono />
                <InfoRow label="Build Type" value={info.buildType} />
                <InfoRow label="Build Tags" value={info.buildTags} />
                <InfoRow label="Build Date" value={info.buildDate} />
              </Section>
              <Section title="SECURITY" icon=" ">
                <InfoRow label="Security Patch" value={info.securityPatch} accent />
                <InfoRow label="Verified Boot" value={info.verifiedBoot} />
                <InfoRow label="AVB Version" value={info.avbVersion} />
                <InfoRow label="SELinux" value={info.selinuxStatus || info.selinux} />
                <InfoRow label="Encryption" value={info.encrypted} />
                <InfoRow label="Treble" value={info.treble === 'true' ? 'Enabled' : info.treble} />
              </Section>
              <Section title="KERNEL" icon=" ">
                <InfoRow label="Version" value={info.kernelFull || info.kernelVersion} mono />
              </Section>
              <Section title="LOCALE" icon=" ">
                <InfoRow label="Language" value={info.locale || info.language} />
                <InfoRow label="Country" value={info.country} />
                <InfoRow label="Timezone" value={info.timezone} />
                <InfoRow label="Device Type" value={info.deviceType} />
              </Section>
              <Section title="BUILD FINGERPRINT" icon=" ">
                <div style={{ fontFamily:'monospace', fontSize:10, color:'var(--text3)', wordBreak:'break-all', lineHeight:1.7, userSelect:'all' }}>{info.fingerprint}</div>
              </Section>
            </div>
          )}

          {tab === 'network' && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <Section title="WIFI" icon=" ">
                <InfoRow label="SSID" value={info.wifiSsid} accent />
                <InfoRow label="IP Address" value={info.ipAddress} mono />
                <InfoRow label="MAC" value={info.wifiMac} mono />
              </Section>
              <Section title="CELLULAR" icon=" ">
                <InfoRow label="Carrier" value={info.carrierName} />
                <InfoRow label="Operator Code" value={info.simOperator} mono />
                <InfoRow label="Network Type" value={info.netType} />
                <InfoRow label="Phone Number" value={info.phoneNumber} mono />
                <InfoRow label="IMEI 1" value={info.imei1} mono copy />
                <InfoRow label="IMEI 2" value={info.imei2} mono copy />
                <InfoRow label="ICCID" value={info.iccid} mono />
              </Section>
              <Section title="BLUETOOTH" icon=" ">
                <InfoRow label="BT MAC" value={info.btMac} mono />
              </Section>
            </div>
          )}

          {tab === 'security' && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <Section title="BOOTLOADER" icon=" ">
                  <InfoRow label="Status" value={info.bootloaderLocked} accent={info.bootloaderLocked === 'Unlocked'} />
                  <InfoRow label="Version" value={info.bootloader} mono />
                  <InfoRow label="Verified Boot" value={info.verifiedBoot} />
                  <InfoRow label="AVB" value={info.avbVersion} mono />
                </Section>
                <Section title="SYSTEM" icon=" ">
                  <InfoRow label="Root Access" value={info.rooted} accent={info.rooted === 'Yes'} />
                  <InfoRow label="SELinux" value={info.selinuxStatus} />
                  <InfoRow label="Encryption" value={info.encrypted} />
                  <InfoRow label="DM-Verity" value={info.dmVerity} />
                  <InfoRow label="Treble" value={info.treble === 'true' ? 'Enabled' : info.treble} />
                </Section>
              </div>
              <Section title="PATCH LEVEL" icon=" ">
                <InfoRow label="Security Patch" value={info.securityPatch} accent />
                <InfoRow label="Build Type" value={info.buildType} />
                <InfoRow label="Build Tags" value={info.buildTags} />
              </Section>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button onClick={() => ft.adb.shell({ serial, cmd: 'getenforce' }).then(r => addLog('SELinux: ' + r)).catch(e => addLog(e.message))} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)', fontWeight:500 }}>Check SELinux</button>
                <button onClick={() => ft.adb.shell({ serial, cmd: 'id' }).then(r => addLog('User: ' + r)).catch(e => addLog(e.message))} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, cursor:'pointer', background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)', fontWeight:500 }}>Check UID</button>
                <button onClick={() => reboot('bootloader')} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, cursor:'pointer', background:'rgba(245,158,11,0.15)', color:'#f59e0b', border:'1px solid rgba(245,158,11,0.3)', fontWeight:500 }}>Reboot Bootloader</button>
                <button onClick={() => reboot('recovery')} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, cursor:'pointer', background:'rgba(96,165,250,0.15)', color:'#60a5fa', border:'1px solid rgba(96,165,250,0.3)', fontWeight:500 }}>Reboot Recovery</button>
                <button onClick={() => reboot()} style={{ padding:'7px 14px', borderRadius:7, fontSize:12, cursor:'pointer', background:'rgba(248,113,113,0.15)', color:'#f87171', border:'1px solid rgba(248,113,113,0.3)', fontWeight:500 }}>Reboot</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
