import { useState, useEffect } from 'react'

const ft = window.ft

const STEPS = ['open', 'inspect', 'apps', 'patch', 'repack']
const STEP_LABELS = { open: 'Open ROM', inspect: 'Inspect', apps: 'System Apps', patch: 'Patch & Modify', repack: 'Repack & Sign' }

export default function ROMBuilder({ device, addLog }) {
  const [step, setStep] = useState('open')
  const [romPath, setRomPath] = useState(null)
  const [info, setInfo] = useState(null)
  const [workDir, setWorkDir] = useState(null)
  const [systemApps, setSystemApps] = useState([])
  const [selectedApps, setSelectedApps] = useState(new Set())
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [outputName, setOutputName] = useState('Omerta_Custom_ROM')
  const [filter, setFilter] = useState('')
  const [showBloatOnly, setShowBloatOnly] = useState(false)
  const [magiskPath, setMagiskPath] = useState(null)
  const [bootImgPath, setBootImgPath] = useState(null)
  const [gsiMode, setGsiMode] = useState(false)

  useEffect(() => {
    const remove = ft.on('rombuild:progress', p => {
      setProgress(p.percent || 0)
      setProgressMsg(p.message || '')
    })
    return remove
  }, [])

  const openRom = async () => {
    const path = await ft.rombuild.open()
    if (!path) return
    setRomPath(path)
    setBusy(true)
    try {
      const i = await ft.rombuild.inspect({ romPath: path })
      setInfo(i)
      setOutputName('Omerta_' + path.split(/[/\\]/).pop().replace('.zip', '') + '_Custom')
      setStep('inspect')
    } catch (e) { addLog('Inspect failed: ' + e.message) }
    setBusy(false)
  }

  const extractRom = async () => {
    setBusy(true)
    setProgress(0)
    try {
      const res = await ft.rombuild.extract({ romPath })
      setWorkDir(res.workDir)
      addLog(`Extracted to: ${res.workDir}`)
      setStep('apps')
      setBusy(true)
      const apps = await ft.rombuild.listApps({ workDir: res.workDir })
      setSystemApps(apps)
      const bloat = new Set(apps.filter(a => a.isBloat).map(a => a.path))
      setSelectedApps(bloat)
    } catch (e) { addLog('Extract failed: ' + e.message) }
    setBusy(false)
  }

  const removeApps = async () => {
    if (!selectedApps.size) return
    setBusy(true)
    const toRemove = systemApps.filter(a => selectedApps.has(a.path))
    try {
      const res = await ft.rombuild.removeApps({ workDir, packages: toRemove })
      addLog(`Removed ${res.removed.length} apps`)
      setSystemApps(apps => apps.filter(a => !selectedApps.has(a.path)))
      setSelectedApps(new Set())
    } catch (e) { addLog('Remove failed: ' + e.message) }
    setBusy(false)
  }

  const addApp = async () => {
    setBusy(true)
    try {
      const res = await ft.rombuild.addApp({ workDir })
      if (!res.cancelled) { addLog(`Added: ${res.name}`); const apps = await ft.rombuild.listApps({ workDir }); setSystemApps(apps) }
    } catch (e) { addLog('Add failed: ' + e.message) }
    setBusy(false)
  }

  const patchMagisk = async () => {
    setBusy(true)
    setProgress(0)
    try {
      const res = await ft.rombuild.patchMagisk({ workDir, magiskApkPath: magiskPath })
      if (res.error) addLog('Magisk patch: ' + res.error)
      else addLog('Magisk patched boot.img successfully!')
    } catch (e) { addLog('Magisk patch failed: ' + e.message) }
    setBusy(false)
  }

  const patchBootStandalone = async () => {
    if (!bootImgPath) return
    setBusy(true)
    setProgress(0)
    try {
      const res = await ft.rombuild.patchBoot({ bootImgPath, magiskApkPath: magiskPath })
      if (res.error) addLog('Boot patch error: ' + res.error)
      else addLog('Patched boot saved to: ' + res.path)
    } catch (e) { addLog('Boot patch failed: ' + e.message) }
    setBusy(false)
  }

  const repack = async () => {
    setBusy(true)
    setProgress(0)
    try {
      const res = gsiMode
        ? await ft.rombuild.buildGsi({ romPath })
        : await ft.rombuild.repack({ workDir, outputName })
      if (res.error) addLog('Repack error: ' + res.error)
      else addLog(`Output: ${res.path}${res.note ? ' -- ' + res.note : ''}`)
    } catch (e) { addLog('Repack failed: ' + e.message) }
    setBusy(false)
  }

  const cleanup = async () => {
    if (workDir) { await ft.rombuild.cleanup({ workDir }); addLog('Workspace cleaned') }
    setStep('open'); setRomPath(null); setInfo(null); setWorkDir(null)
    setSystemApps([]); setSelectedApps(new Set()); setProgress(0)
  }

  const visibleApps = systemApps.filter(a => {
    if (showBloatOnly && !a.isBloat) return false
    if (filter && !a.name.toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  const stepIndex = STEPS.indexOf(step)

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflowY: 'auto' }} className="fade-in">
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>ROM Builder</h2>
        <p style={{ color: 'var(--text3)', fontSize: 13 }}>Inspect, debloat, patch with Magisk, and repack flashable ROMs</p>
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
            <div style={{ display: 'flex', flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, background: stepIndex > i ? 'var(--green)' : stepIndex === i ? 'var(--accent)' : 'var(--bg3)', color: stepIndex >= i ? '#000' : 'var(--text3)', border: `1px solid ${stepIndex >= i ? 'transparent' : 'var(--border)'}`, transition: 'all 0.2s' }}>
                {stepIndex > i ? ' ' : i + 1}
              </div>
              <div style={{ fontSize: 10, color: stepIndex === i ? 'var(--accent)' : 'var(--text3)', whiteSpace: 'nowrap' }}>{STEP_LABELS[s]}</div>
            </div>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: stepIndex > i ? 'var(--green)' : 'var(--border)', margin: '0 6px', marginBottom: 14 }} />}
          </div>
        ))}
      </div>

      {/* Progress */}
      {busy && (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div className="spinner" />
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>{progressMsg || 'Processing...'}</span>
          </div>
          <div className="progress-bar"><div className="progress-bar-fill" style={{ width: progress + '%' }} /></div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{progress}%</div>
        </div>
      )}

      {/* Step: Open */}
      {step === 'open' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Load a ROM to customize</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[['ZIP (flashable)', 'Standard recovery flashable ZIP'], ['payload.bin / img', 'Pixel factory image or raw partition'], ['Samsung TAR/MD5', 'Samsung firmware package'], ['OTA ZIP', 'OTA update package']].map(([t, d]) => (
                <div key={t} className="card" style={{ padding: 12, background: 'var(--bg2)' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{t}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{d}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-primary" style={{ width: 'fit-content' }} onClick={openRom} disabled={busy}>
                Open ROM File
            </button>
          </div>

          {/* Standalone boot patcher */}
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Standalone Boot.img Patcher</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>Patch a boot.img with Magisk without modifying the full ROM</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={async () => {
                const { filePaths } = await ft.dialog.openFile({ filters: [{ name: 'Boot Image', extensions: ['img'] }] })
                if (filePaths?.[0]) setBootImgPath(filePaths[0])
              }}>{bootImgPath ? '  ' + bootImgPath.split(/[/\\]/).pop() : '  Select boot.img'}</button>
              <button className="btn btn-sm" onClick={async () => {
                const { filePaths } = await ft.dialog.openFile({ filters: [{ name: 'Magisk APK', extensions: ['apk'] }] })
                if (filePaths?.[0]) setMagiskPath(filePaths[0])
              }}>{magiskPath ? '  ' + magiskPath.split(/[/\\]/).pop() : '  Select Magisk APK (optional)'}</button>
              <button className="btn btn-primary btn-sm" onClick={patchBootStandalone} disabled={!bootImgPath || busy}>  Patch Boot</button>
            </div>
          </div>
        </div>
      )}

      {/* Step: Inspect */}
      {step === 'inspect' && info && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>ROM Analysis</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                ['File', info.filename], ['Size', info.size], ['Format', info.format],
                ['Entries', info.entryCount?.toLocaleString() || '--'],
                ['Type', info.isPayloadBased ? 'Payload-based (Pixel)' : info.isFlashableZip ? 'Flashable ZIP (TWRP)' : 'Raw image'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>{k}</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              {[['system', info.hasSystem], ['boot.img', info.hasBootImg], ['vendor', info.hasVendor], ['META-INF', info.hasMetaInf], ['payload.bin', info.hasPayload], ['dtbo', info.hasDtbo]].filter(([,v]) => v).map(([k]) => (
                <span key={k} className="tag tag-green">{k}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={extractRom} disabled={busy}>
              {busy ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} /> Extracting...</> : '  Extract & Continue'}
            </button>
            {info.hasSystem && (
              <button className="btn btn-blue" onClick={() => { setGsiMode(true); setStep('repack') }}>  Build GSI directly</button>
            )}
            <button className="btn" onClick={cleanup}>  Cancel</button>
          </div>
        </div>
      )}

      {/* Step: Apps */}
      {step === 'apps' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter apps..." style={{ flex: 1, minWidth: 160 }} />
            <button className="btn btn-sm" onClick={() => setShowBloatOnly(b => !b)} style={{ background: showBloatOnly ? 'var(--accent-dim)' : undefined, color: showBloatOnly ? 'var(--accent)' : undefined }}>
                Bloat Only
            </button>
            <button className="btn btn-sm" onClick={() => { const all = new Set(visibleApps.map(a => a.path)); setSelectedApps(all) }}>Select All</button>
            <button className="btn btn-sm" onClick={() => setSelectedApps(new Set())}>Clear</button>
            <button className="btn btn-red btn-sm" onClick={removeApps} disabled={!selectedApps.size || busy}>  Remove {selectedApps.size || ''}</button>
            <button className="btn btn-green btn-sm" onClick={addApp} disabled={busy}>+ Add APK</button>
            <button className="btn btn-primary btn-sm" onClick={() => setStep('patch')}>Next  </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{visibleApps.length} apps shown   {systemApps.length} total   {systemApps.filter(a => a.isBloat).length} flagged as bloat</div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {visibleApps.map(a => (
              <div key={a.path} onClick={() => setSelectedApps(sel => { const n = new Set(sel); n.has(a.path) ? n.delete(a.path) : n.add(a.path); return n })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 6, background: selectedApps.has(a.path) ? 'var(--red-dim)' : 'var(--bg2)', border: `1px solid ${selectedApps.has(a.path) ? 'rgba(248,113,113,0.2)' : 'transparent'}`, cursor: 'pointer', transition: 'all 0.1s' }}>
                <div className={`checkbox ${selectedApps.has(a.path) ? 'checked' : ''}`} style={{ background: selectedApps.has(a.path) ? 'var(--red)' : undefined, borderColor: selectedApps.has(a.path) ? 'var(--red)' : undefined }}>
                  {selectedApps.has(a.path) && <span style={{ color: '#fff', fontSize: 10 }}> </span>}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{a.systemDir}   {a.sizeHuman}</div>
                </div>
                {a.isBloat && <span className="tag tag-amber">bloat</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step: Patch */}
      {step === 'patch' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Magisk Root Patch</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>Injects Magisk into the ROM's boot.img. Requires magiskboot binary (extract from Magisk APK: rename to .zip   find lib/x86_64/libmagiskboot.so)</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-sm" onClick={async () => {
                const { filePaths } = await ft.dialog.openFile({ filters: [{ name: 'Magisk APK', extensions: ['apk'] }] })
                if (filePaths?.[0]) setMagiskPath(filePaths[0])
              }}>{magiskPath ? '  ' + magiskPath.split(/[/\\]/).pop() : '  Select Magisk APK (optional)'}</button>
              <button className="btn btn-primary btn-sm" onClick={patchMagisk} disabled={busy}>  Patch Magisk into ROM</button>
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Custom hosts (Ad blocking)</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>Bakes a hosts file into /system/etc/hosts in the ROM for system-level blocking -- active even without root</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { name: 'StevenBlack Unified', url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts' },
                { name: 'AdAway', url: 'https://adaway.org/hosts.txt' },
                { name: 'MVPS Hosts', url: 'https://winhelp2002.mvps.org/hosts.txt' },
              ].map(preset => (
                <button key={preset.name} className="btn btn-sm" onClick={async () => {
                  addLog('Downloading ' + preset.name + '...')
                  const r = await ft.rombuild.bakeHosts({ hostsUrl: preset.url, romDir: romDir }).catch(e => ({ error: e.message }))
                  addLog(r.success ? `  ${preset.name} baked into ROM (${r.domains} domains)` : '  ' + r.error)
                }}>{preset.name}</button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={() => setStep('repack')}>Next: Repack  </button>
            <button className="btn" onClick={() => setStep('apps')}>  Back</button>
          </div>
        </div>
      )}

      {/* Step: Repack */}
      {step === 'repack' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Output Settings</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Output filename</div>
                <input value={outputName} onChange={e => setOutputName(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {[['Normal ZIP', false], ['GSI Image', true]].map(([label, val]) => (
                  <button key={label} onClick={() => setGsiMode(val)}
                    style={{ flex: 1, padding: 10, borderRadius: 8, background: gsiMode === val ? 'var(--accent-dim)' : 'var(--bg2)', border: `1px solid ${gsiMode === val ? 'var(--accent-border)' : 'var(--border)'}`, color: gsiMode === val ? 'var(--accent)' : 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>
                    {label}
                  </button>
                ))}
              </div>
              {gsiMode && <div style={{ fontSize: 12, color: 'var(--text3)', padding: 10, background: 'var(--blue-dim)', borderRadius: 6, border: '1px solid var(--blue-border)' }}>GSI output can be flashed to any Project Treble-compatible device via: <span style={{ fontFamily: 'var(--mono)', color: 'var(--blue)' }}>fastboot flash system system_gsi.img</span></div>}
            </div>
          </div>

          {!gsiMode && (
            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Summary</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>  {systemApps.length} system apps in modified ROM</div>
                <div>  Will be signed with test keys (TWRP-compatible)</div>
                <div>  Output: {outputName}.zip</div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={repack} disabled={busy}>
              {busy ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} /> {progressMsg || 'Building...'}</> : `  ${gsiMode ? 'Build GSI' : 'Repack & Sign ROM'}`}
            </button>
            {!gsiMode && <button className="btn" onClick={() => setStep('patch')}>  Back</button>}
            <button className="btn btn-red" onClick={cleanup}>  Start Over</button>
          </div>

          {busy && (
            <div className="progress-bar" style={{ height: 6 }}>
              <div className="progress-bar-fill" style={{ width: progress + '%' }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
