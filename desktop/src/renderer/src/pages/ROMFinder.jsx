import { useState, useEffect } from 'react'

const ft = window.ft

function Tag({ label, color }) {
  const c = color || '#60a5fa'
  return <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:4, fontSize:10, fontWeight:600, marginRight:4, marginBottom:4, background:c+'22', color:c, border:`1px solid ${c}44` }}>{label}</span>
}

function RomCard({ rom, device, onFlash, onDownload }) {
  const [expanded, setExpanded] = useState(false)
  const compatible = rom.compatible !== false
  return (
    <div style={{ background:'var(--bg1)', border:`1px solid ${compatible?'var(--border)':'rgba(248,113,113,0.2)'}`, borderRadius:10, overflow:'hidden', borderLeft:`3px solid ${rom.type==='official'?'#4ade80':rom.type==='gsi'?'#60a5fa':rom.type==='custom'?'#f59e0b':'#888'}` }}>
      <div style={{ padding:'12px 14px', display:'flex', gap:12, alignItems:'flex-start' }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
            <span style={{ fontSize:14, fontWeight:700, color:'var(--text)' }}>{rom.name}</span>
            <Tag label={rom.type.toUpperCase()} color={rom.type==='official'?'#4ade80':rom.type==='gsi'?'#60a5fa':'#f59e0b'} />
            {rom.android && <Tag label={'Android '+rom.android} color="#a78bfa" />}
            {rom.status && <Tag label={rom.status} color={rom.status==='Active'?'#4ade80':'#888'} />}
            {!compatible && <Tag label="INCOMPATIBLE" color="#f87171" />}
          </div>
          <div style={{ fontSize:12, color:'var(--text2)', marginBottom:4, lineHeight:1.6 }}>{rom.description}</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {rom.features?.slice(0,4).map((f,i) => <Tag key={i} label={f} />)}
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:5, flexShrink:0 }}>
          {rom.downloadUrl && <button onClick={() => onDownload(rom)} style={{ padding:'6px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'rgba(74,222,128,0.15)', color:'#4ade80', border:'1px solid rgba(74,222,128,0.3)' }}>Download</button>}
          {rom.installable && device && <button onClick={() => onFlash(rom)} style={{ padding:'6px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>Flash</button>}
          <button onClick={() => setExpanded(e=>!e)} style={{ padding:'4px 8px', borderRadius:5, fontSize:11, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)' }}>{expanded?'Less':'More'}</button>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop:'1px solid var(--border)', padding:'12px 14px', background:'var(--bg2)', display:'flex', gap:16, flexWrap:'wrap' }}>
          <div style={{ flex:2, minWidth:180 }}>
            {rom.requirements && <>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--text3)', marginBottom:4 }}>REQUIREMENTS</div>
              {rom.requirements.map((r,i) => <div key={i} style={{ fontSize:11, color:'var(--text2)', marginBottom:2 }}>  {r}</div>)}
            </>}
            {rom.installSteps && <>
              <div style={{ fontSize:11, fontWeight:600, color:'var(--text3)', marginBottom:4, marginTop:8 }}>INSTALL STEPS</div>
              {rom.installSteps.map((s,i) => <div key={i} style={{ display:'flex', gap:6, marginBottom:4 }}><span style={{ color:'var(--accent)', fontWeight:700 }}>{i+1}.</span><span style={{ fontSize:11, color:'var(--text2)' }}>{s}</span></div>)}
            </>}
          </div>
          <div style={{ flex:1, minWidth:140 }}>
            {rom.pros && <>
              <div style={{ fontSize:11, fontWeight:600, color:'#4ade80', marginBottom:4 }}>PROS</div>
              {rom.pros.map((p,i) => <div key={i} style={{ fontSize:11, color:'var(--text2)', marginBottom:2 }}>+ {p}</div>)}
            </>}
            {rom.cons && <>
              <div style={{ fontSize:11, fontWeight:600, color:'#f87171', marginBottom:4, marginTop:6 }}>CONS</div>
              {rom.cons.map((p,i) => <div key={i} style={{ fontSize:11, color:'var(--text2)', marginBottom:2 }}>- {p}</div>)}
            </>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ROMFinder({ device, addLog }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [deviceRoms, setDeviceRoms] = useState(null)
  const [loading, setLoading] = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')
  const [tab, setTab] = useState('finder')

  useEffect(() => {
    if (device?.model || device?.device) {
      autoFindRoms()
    }
  }, [device?.serial, device?.udid])

  const autoFindRoms = async () => {
    if (!device) return
    setLoading(true)
    const info = device
    const brand = (info.brand || info.manufacturer || '').toLowerCase()
    const model = info.model || info.device || ''
    const android = info.android || ''
    const codename = info.device || info.name || ''

    const roms = buildRomList(brand, model, codename, android)
    setDeviceRoms(roms)
    setLoading(false)
    addLog(`Found ${roms.length} ROM options for ${model}`)
  }

  const buildRomList = (brand, model, codename, currentAndroid) => {
    const roms = []
    const modelLower = model.toLowerCase()
    const codenameClean = codename.toLowerCase()

    // Official stock - always available
    roms.push({
      name: `${brand.charAt(0).toUpperCase()+brand.slice(1)} Stock ROM`,
      type: 'official',
      android: currentAndroid,
      status: 'Active',
      description: `Official firmware from ${brand}. Factory reset to this if experiencing issues. Maintains warranty.`,
      features: ['Official', 'Stable', 'OTA updates', 'Warranty safe'],
      pros: ['Most stable', 'Full OTA support', 'Warranty maintained', 'No risk'],
      cons: ['Bloatware', 'No root', 'Limited customization'],
      requirements: ['Locked bootloader OK', 'No special requirements'],
      installSteps: [
        'Download from official ' + brand + ' support page',
        'Use ' + (brand==='samsung'?'Odin':brand==='xiaomi'?'MiFlash':brand==='google'?'Android Flash Tool':'brand flash tool'),
        'Boot to download mode',
        'Flash official firmware',
      ],
      downloadUrl: brand==='samsung' ? 'https://www.sammobile.com/samsung/firmware/' :
                   brand==='google' ? 'https://developers.google.com/android/images' :
                   brand==='xiaomi' ? 'https://c.mi.com/global/miuidownload/' :
                   brand==='oneplus' ? 'https://service.oneplus.com/global/search/search-detail' :
                   'https://www.getdroidtips.com/stock-firmware/',
      compatible: true,
    })

    // LineageOS
    roms.push({
      name: 'LineageOS',
      type: 'custom',
      android: '14',
      status: 'Active',
      description: 'Most popular open-source Android distribution. Clean Android experience with monthly security patches. Officially supports hundreds of devices.',
      features: ['Open source', 'Monthly patches', 'No Google apps required', 'Privacy focused'],
      pros: ['Latest Android', 'Clean UI', 'Long device support life', 'Privacy features'],
      cons: ['Needs unlocked bootloader', 'No official warranty', 'GApps install separate'],
      requirements: ['Unlocked bootloader', 'Custom recovery (TWRP/LineageOS recovery)', 'Device on official support list'],
      installSteps: [
        'Unlock bootloader (see Bootloader page)',
        'Flash TWRP or LineageOS recovery',
        'Wipe data/cache/system',
        'Flash LineageOS zip',
        'Flash GApps if needed',
        'Reboot',
      ],
      downloadUrl: 'https://wiki.lineageos.org/devices/',
      compatible: true,
    })

    // /e/OS
    roms.push({
      name: '/e/OS (Murena)',
      type: 'custom',
      android: '14',
      status: 'Active',
      description: 'Privacy-focused Android fork with deGoogled apps and microG. Based on LineageOS with built-in privacy features. Supports 200+ devices.',
      features: ['DeGoogled', 'Privacy', 'microG', 'App store'],
      pros: ['Maximum privacy', 'No Google tracking', 'Clean interface', 'Own cloud'],
      cons: ['App compatibility issues', 'Smaller community', 'Needs unlocked bootloader'],
      requirements: ['Unlocked bootloader', 'TWRP or /e/OS recovery'],
      installSteps: [
        'Check device support at doc.e.foundation',
        'Unlock bootloader',
        'Flash /e/OS recovery',
        'Flash /e/OS zip from recovery',
      ],
      downloadUrl: 'https://doc.e.foundation/devices',
      compatible: true,
    })

    // GrapheneOS for Pixels
    if (brand === 'google' || codenameClean.includes('pixel')) {
      roms.push({
        name: 'GrapheneOS',
        type: 'custom',
        android: '15',
        status: 'Active',
        description: 'Most secure Android OS. Pixel-only. Hardened Android with verified boot, memory safety features, and privacy sandbox. Recommended for high-security use.',
        features: ['Maximum security', 'Pixel only', 'Verified boot', 'Hardened'],
        pros: ['Best security', 'Latest patches', 'Sandboxed Google Play available', 'Active development'],
        cons: ['Pixel devices only', 'No other OEM support', 'Different UX'],
        requirements: ['Pixel 6 or newer recommended', 'Unlocked bootloader', 'Web installer available'],
        installSteps: [
          'Visit grapheneos.org/install/web',
          'Use WebUSB installer in Chrome',
          'Bootloader will re-lock after install',
        ],
        downloadUrl: 'https://grapheneos.org/install/',
        compatible: true,
      })
    }

    // CalyxOS for Pixels and Fairphone
    if (brand === 'google' || brand === 'fairphone' || codenameClean.includes('pixel')) {
      roms.push({
        name: 'CalyxOS',
        type: 'custom',
        android: '14',
        status: 'Active',
        description: 'Privacy-focused Android with microG for app compatibility. Supports Pixels, Fairphone and Motorola. Includes firewall, VPN, and encrypted cloud.',
        features: ['Privacy', 'microG', 'Firewall', 'Verified boot'],
        pros: ['Good app compatibility', 'Monthly updates', 'Re-lockable bootloader'],
        cons: ['Limited device support', 'microG not 100% compatible'],
        downloadUrl: 'https://calyxos.org/install/',
        compatible: true,
      })
    }

    // MIUI/HyperOS for Xiaomi
    if (brand === 'xiaomi' || brand === 'redmi' || brand === 'poco') {
      roms.push({
        name: 'Xiaomi HyperOS (Stock)',
        type: 'official',
        android: '14',
        status: 'Active',
        description: 'Latest Xiaomi official ROM. HyperOS replaces MIUI. Includes full ecosystem integration and official updates.',
        features: ['Official', 'HyperOS', 'Ecosystem', 'OTA'],
        downloadUrl: 'https://c.mi.com/global/miuidownload/',
        compatible: true,
      })
    }

    // Samsung OneUI
    if (brand === 'samsung') {
      roms.push({
        name: 'Samsung OneUI (Odin flash)',
        type: 'official',
        android: '14',
        status: 'Active',
        description: 'Official Samsung firmware via Odin flash tool. Use to downgrade, fix bootloop, or restore factory software. Region-specific builds available.',
        features: ['Official', 'Odin', 'Region builds', 'All models'],
        downloadUrl: 'https://www.sammobile.com/samsung/firmware/',
        compatible: true,
      })
    }

    // GSI roms
    roms.push({
      name: 'Generic System Image (GSI)',
      type: 'gsi',
      android: '14',
      status: 'Active',
      description: 'Generic Android builds that work on any Project Treble compatible device (Android 8+). Phh-Treble GSI and others. Wide device support.',
      features: ['Project Treble', 'Any device', 'AOSP base', 'Wide support'],
      pros: ['Works on almost any device', 'Multiple flavors', 'Latest Android features'],
      cons: ['May have hardware bugs', 'Camera issues common', 'No device-specific optimizations'],
      requirements: ['Android 8.0+ device', 'Project Treble support', 'Unlocked bootloader', 'A/B or A-only partition'],
      installSteps: [
        'Check Treble support: adb shell getprop ro.treble.enabled',
        'Check partition scheme: adb shell getprop ro.boot.slot_suffix',
        'Download correct GSI variant (arm64, A-only or A/B)',
        'Flash via fastboot: fastboot flash system <gsi.img>',
      ],
      downloadUrl: 'https://github.com/phhusson/treble_experimentations/releases',
      compatible: true,
    })

    return roms
  }

  const searchOnline = async () => {
    if (!searchQuery.trim()) return
    setLoading(true)
    // Build smart search results based on query
    const q = searchQuery.toLowerCase()
    const mockResults = buildRomList(
      q.includes('samsung') ? 'samsung' : q.includes('pixel') ? 'google' : q.includes('xiaomi') ? 'xiaomi' : 'android',
      searchQuery,
      searchQuery,
      '13'
    )
    setSearchResults(mockResults)
    setLoading(false)
    addLog('Searched for: ' + searchQuery)
  }

  const onDownload = (rom) => {
    if (rom.downloadUrl) ft.openUrl(rom.downloadUrl)
    addLog('Opening: ' + rom.name + ' download page')
  }

  const onFlash = (rom) => {
    addLog('To flash: go to ROM Manager page and use the Flash ZIP option with ' + rom.name)
  }

  const displayRoms = (tab === 'finder' ? deviceRoms : searchResults) || []
  const filtered = typeFilter === 'all' ? displayRoms : displayRoms.filter(r => r.type === typeFilter)

  const TABS = [['finder','My Device'],['search','Search ROMs'],['guide','Flash Guide']]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'16px 20px', height:'100%', overflowY:'auto', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:'var(--text)' }}>ROM Finder</div>
          <div style={{ fontSize:12, color:'var(--text3)' }}>Auto-detect compatible ROMs for your device</div>
        </div>
        {device && (
          <div style={{ padding:'6px 14px', background:'rgba(74,222,128,0.15)', border:'1px solid rgba(74,222,128,0.3)', borderRadius:8, fontSize:12, color:'#4ade80', fontWeight:600 }}>
            {device.brand ? `${device.brand} ${device.model}` : device.model || 'Device connected'}
          </div>
        )}
      </div>

      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:9, padding:4 }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:'8px 4px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:tab===id?'var(--accent)':'transparent', color:tab===id?'#000':'var(--text3)', border:'none' }}>{label}</button>
        ))}
      </div>

      {tab === 'finder' && (
        <>
          {!device && (
            <div style={{ padding:16, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, fontSize:13, color:'#f59e0b', lineHeight:1.7 }}>
              Connect an Android device to auto-detect compatible ROMs. Or use the Search tab to find ROMs by device name.
            </div>
          )}
          {device && (
            <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Detected Device</div>
              <div style={{ display:'flex', gap:20, flexWrap:'wrap', fontSize:12 }}>
                <div><span style={{ color:'var(--text3)' }}>Model: </span><span style={{ color:'var(--accent)' }}>{device.brand} {device.model}</span></div>
                <div><span style={{ color:'var(--text3)' }}>Android: </span><span style={{ color:'var(--text2)' }}>{device.android}</span></div>
                <div><span style={{ color:'var(--text3)' }}>Codename: </span><span style={{ color:'var(--text2)', fontFamily:'monospace' }}>{device.device}</span></div>
                <div><span style={{ color:'var(--text3)' }}>Chipset: </span><span style={{ color:'var(--text2)' }}>{device.chipset || device.soc || 'unknown'}</span></div>
                <div><span style={{ color:'var(--text3)' }}>Rooted: </span><span style={{ color: device.rooted==='Yes'?'#4ade80':'var(--text2)' }}>{device.rooted || 'No'}</span></div>
              </div>
              <button onClick={autoFindRoms} disabled={loading} style={{ marginTop:10, padding:'6px 14px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
                {loading ? 'Finding ROMs...' : 'Refresh ROM List'}
              </button>
            </div>
          )}

          {filtered.length > 0 && (
            <>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {['all','official','custom','gsi'].map(t => (
                  <button key={t} onClick={() => setTypeFilter(t)} style={{ padding:'5px 10px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', background:typeFilter===t?'var(--accent-dim)':'var(--bg2)', color:typeFilter===t?'var(--accent)':'var(--text3)', border:`1px solid ${typeFilter===t?'var(--accent-border)':'var(--border)'}` }}>
                    {t.toUpperCase()}
                  </button>
                ))}
                <span style={{ fontSize:11, color:'var(--text3)', alignSelf:'center', marginLeft:4 }}>{filtered.length} ROMs</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {filtered.map((rom,i) => <RomCard key={i} rom={rom} device={device} onFlash={onFlash} onDownload={onDownload} />)}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'search' && (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'flex', gap:8 }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key==='Enter' && searchOnline()}
              placeholder="Search device name e.g. Samsung Galaxy S22, Pixel 7a..."
              style={{ flex:1 }} />
            <button onClick={searchOnline} disabled={loading || !searchQuery} style={{ padding:'8px 16px', borderRadius:7, fontSize:12, fontWeight:600, cursor:'pointer', background:'var(--accent)', color:'#000', border:'none' }}>
              {loading ? 'Searching...' : 'Find ROMs'}
            </button>
          </div>

          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {['LineageOS','GrapheneOS','CalyxOS','/e/OS','GSI'].map(q => (
              <button key={q} onClick={() => { setSearchQuery(q); }} style={{ padding:'5px 10px', borderRadius:6, fontSize:11, cursor:'pointer', background:'var(--bg2)', color:'var(--text3)', border:'1px solid var(--border)' }}>{q}</button>
            ))}
          </div>

          {searchResults && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {searchResults.map((rom,i) => <RomCard key={i} rom={rom} device={device} onFlash={onFlash} onDownload={onDownload} />)}
            </div>
          )}

          <div style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14, marginTop:4 }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Direct ROM Resources</div>
            {[
              ['XDA Forums',          'xda-developers.com',       'Largest Android development community. Find device-specific ROMs, kernels, mods'],
              ['LineageOS Devices',   'wiki.lineageos.org/devices', 'Official LineageOS supported device list with install guides'],
              ['GrapheneOS',          'grapheneos.org',            'Best security OS for Pixel devices'],
              ['/e/OS Devices',       'doc.e.foundation/devices',  'Privacy-focused Android for 200+ devices'],
              ['Pixel Factory Images','developers.google.com/android/images', 'Official Google Pixel firmware'],
              ['SamMobile',           'sammobile.com',             'Samsung firmware database with all regions'],
              ['TWRP Devices',        'twrp.me/Devices',           'Check if your device has official TWRP support'],
            ].map(([name, url, desc],i) => (
              <div key={i} style={{ padding:'8px 0', borderBottom:'1px solid var(--border)', display:'flex', gap:12, alignItems:'flex-start' }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--accent)', cursor:'pointer' }} onClick={() => ft.openUrl('https://'+url)}>{name}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{desc}</div>
                </div>
                <button onClick={() => ft.openUrl('https://'+url)} style={{ padding:'4px 8px', borderRadius:5, fontSize:10, cursor:'pointer', background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border)', flexShrink:0 }}>Open</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'guide' && (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            { title:'Before You Flash', color:'#f59e0b', steps:[
              'Backup everything - photos, contacts, apps, WhatsApp chats',
              'Charge to at least 70% battery',
              'Note your current Android version and IMEI (Settings > About)',
              'Read the XDA thread for your exact device model',
              'Check if your bootloader can be re-locked (important for security)',
            ]},
            { title:'Unlock Bootloader', color:'#60a5fa', steps:[
              'Go to Bootloader Wizard page for your device-specific steps',
              'Most brands: Settings > About > Build Number x7 > Developer Options > OEM Unlocking',
              'Samsung: use Download mode + Odin (different process)',
              'Warning: unlocking wipes all data',
            ]},
            { title:'Install Custom Recovery', color:'#a78bfa', steps:[
              'Download TWRP or LineageOS recovery for your exact device',
              'Boot to fastboot: hold Power + Volume Down',
              'Flash: fastboot flash recovery recovery.img',
              'Or use Omerta Bootloader Wizard for guided process',
            ]},
            { title:'Flash ROM', color:'#4ade80', steps:[
              'Boot into recovery (Power + Volume Up from off)',
              'Wipe: Factory Reset, then Wipe > Advanced > Dalvik + Cache',
              'Flash ROM zip file',
              'Flash GApps if needed (before first boot)',
              'Reboot system',
            ]},
          ].map((section,i) => (
            <div key={i} style={{ background:'var(--bg1)', border:'1px solid var(--border)', borderRadius:10, padding:14, borderLeft:`3px solid ${section.color}` }}>
              <div style={{ fontSize:13, fontWeight:700, color:section.color, marginBottom:10 }}>{section.title}</div>
              {section.steps.map((step,j) => (
                <div key={j} style={{ display:'flex', gap:10, marginBottom:8 }}>
                  <div style={{ width:22, height:22, borderRadius:'50%', background:section.color, color:'#000', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0 }}>{j+1}</div>
                  <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.7, paddingTop:2 }}>{step}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
