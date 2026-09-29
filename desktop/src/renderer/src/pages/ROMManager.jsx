import { useState, useEffect } from 'react'

const ft = window.ft

const SOURCES = ['LineageOS', 'PixelExperience', 'GrapheneOS', 'crDroid', 'EvolutionX', 'Stock']

export default function ROMManager({ device, addLog }) {
  const [tab, setTab] = useState('browse')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [devices, setDevices] = useState([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const [downloading, setDownloading] = useState(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [flashing, setFlashing] = useState(false)
  const [flashMode, setFlashMode] = useState('adb')
  const [stockBrand, setStockBrand] = useState('samsung')
  const [stockSources, setStockSources] = useState(null)

  useEffect(() => {
    if (device) setSelectedDevice(device.model || device.product || '')
    ft.rom.deviceList({ source: 'lineageos' }).then(setDevices).catch(() => {})
  }, [device])

  useEffect(() => {
    const remove = ft.on('rom:download:progress', p => {
      setDownloadProgress(p.percent)
      if (p.percent >= 100) { setDownloading(null); addLog('Download complete!') }
    })
    const remove2 = ft.on('rom:flash:progress', p => addLog(`Flash: ${p.message || p.percent + '%'}`))
    return () => { remove(); remove2() }
  }, [addLog])

  const search = async () => {
    if (!query && !selectedDevice) return
    setSearching(true)
    try {
      const res = await ft.rom.search({ query, device: selectedDevice })
      setResults(res)
    } catch (e) { addLog('Search error: ' + e.message) }
    setSearching(false)
  }

  const download = async (rom) => {
    setDownloading(rom.filename)
    setDownloadProgress(0)
    try {
      const res = await ft.rom.download({ url: rom.url, name: rom.filename, checksum: rom.sha256 })
      if (res.cancelled) { setDownloading(null); return }
      addLog(`Downloaded: ${res.path}`)
    } catch (e) { addLog('Download failed: ' + e.message); setDownloading(null) }
  }

  const flash = async (rom) => {
    if (!device) return addLog('No device connected')
    setFlashing(true)
    try {
      const serial = device.serial
      let res
      if (flashMode === 'adb') res = await ft.rom.flashAdb({ serial, zipPath: rom.localPath })
      else res = await ft.rom.flashFastboot({ serial, romPath: rom.localPath })
      addLog(res.message || 'Flash complete!')
    } catch (e) { addLog('Flash failed: ' + e.message) }
    setFlashing(false)
  }

  const loadStockSources = async () => {
    const res = await ft.rom.stockSources({ brand: stockBrand, model: selectedDevice })
    setStockSources(res)
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }} className="fade-in">
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>ROM Manager</h2>
        <p style={{ color: 'var(--text3)', fontSize: 13 }}>Browse, download, verify, and flash ROMs for Android devices</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg2)', borderRadius: 8, padding: 4, width: 'fit-content' }}>
        {[['browse', '  Browse ROMs'], ['stock', '  Stock ROMs'], ['flash', '  Flash']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500, background: tab === id ? 'var(--bg4)' : 'none', color: tab === id ? 'var(--text)' : 'var(--text3)', border: tab === id ? '1px solid var(--border)' : '1px solid transparent', cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'browse' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Search */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="ROM name, keyword..." style={{ flex: 1 }} />
            <input value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)} placeholder="Device codename (e.g. cheetah, violet)" style={{ width: 220 }} />
            <button className="btn btn-primary" onClick={search} disabled={searching}>
              {searching ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} /> : '  Search'}
            </button>
          </div>

          {/* Source legend */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SOURCES.map(s => <span key={s} className="tag tag-gray">{s}</span>)}
          </div>

          {/* Results */}
          {results.length === 0 && !searching && (
            <div className="empty">
              <div className="empty-icon"> </div>
              <div>Search for ROMs by device codename or keyword</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>e.g. "cheetah", "violet", "OnePlus 9"</div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map((rom, i) => (
              <div key={i} className="card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{rom.source}</span>
                    <span className="tag tag-blue">{rom.version}</span>
                    {rom.privacyFocused && <span className="tag tag-green">Privacy</span>}
                    <span className="tag tag-gray">{rom.type}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                    {rom.filename || rom.url?.split('/').pop() || '--'}   {rom.size || '--'}   {rom.date || ''}
                  </div>
                  {rom.sha256 && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>SHA256: {rom.sha256.slice(0, 20)}...</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {rom.url && (
                    <button className="btn btn-primary btn-sm" onClick={() => download(rom)} disabled={!!downloading}>
                      {downloading === rom.filename ? `${downloadProgress}%` : '  Download'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {downloading && (
            <div className="card">
              <div style={{ fontSize: 13, marginBottom: 8 }}>Downloading {downloading}...</div>
              <div className="progress-bar progress-bar-blue">
                <div className="progress-bar-fill" style={{ width: downloadProgress + '%', background: 'var(--blue)' }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{downloadProgress}%</div>
            </div>
          )}
        </div>
      )}

      {tab === 'stock' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Brand</div>
              <select value={stockBrand} onChange={e => setStockBrand(e.target.value)} style={{ width: '100%' }}>
                {['samsung', 'xiaomi', 'pixel', 'oneplus', 'motorola', 'nothing'].map(b => <option key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" onClick={loadStockSources}>Find Sources</button>
          </div>

          {stockSources && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{stockSources.name} -- Official Sources</div>
              {(stockSources.methods || []).map((method, i) => (
                <div key={i} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{method.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{method.description || method.type}</div>
                  </div>
                  <span className={`tag ${method.type === 'official' ? 'tag-green' : method.type === 'tool' ? 'tag-blue' : 'tag-gray'}`}>{method.type}</span>
                  <button className="btn btn-sm" onClick={() => ft.openUrl(method.url)}>Open  </button>
                </div>
              ))}
              {stockSources.note && <div style={{ fontSize: 12, color: 'var(--text3)', padding: 12, background: 'var(--bg2)', borderRadius: 8 }}>{stockSources.note}</div>}
            </div>
          )}
        </div>
      )}

      {tab === 'flash' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ background: 'var(--red-dim)', border: '1px solid rgba(248,113,113,0.2)' }}>
            <div style={{ fontSize: 13, color: 'var(--red)', fontWeight: 500, marginBottom: 4 }}>  Flashing Warning</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>Flashing a ROM will wipe your device. Ensure you have a backup. An unlocked bootloader is required. Wrong ROM = brick. You assume all responsibility.</div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Flash method</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['adb', 'ADB Sideload (Recovery)', 'Device in TWRP/recovery'], ['fastboot', 'Fastboot Flash', 'Device in fastboot/bootloader']].map(([id, label, sub]) => (
                <button key={id} onClick={() => setFlashMode(id)}
                  style={{ flex: 1, padding: 12, borderRadius: 8, background: flashMode === id ? 'var(--accent-dim)' : 'var(--bg2)', border: `1px solid ${flashMode === id ? 'var(--accent-border)' : 'var(--border)'}`, color: flashMode === id ? 'var(--accent)' : 'var(--text2)', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: flashMode === id ? 600 : 400 }}>
                  {label}
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, fontWeight: 400 }}>{sub}</div>
                </button>
              ))}
            </div>
          </div>

          <button className="btn btn-primary" style={{ width: 'fit-content' }} onClick={async () => {
            const { filePaths } = await ft.dialog.openFile({ filters: [{ name: 'ROM', extensions: ['zip', 'img'] }] })
            if (!filePaths?.length) return
            setFlashing(true)
            try {
              const res = flashMode === 'adb'
                ? await ft.rom.flashAdb({ serial: device?.serial, zipPath: filePaths[0] })
                : await ft.rom.flashFastboot({ serial: device?.serial, romPath: filePaths[0] })
              addLog(res?.message || 'Flash complete!')
            } catch (e) { addLog('Flash failed: ' + e.message) }
            setFlashing(false)
          }} disabled={flashing || !device}>
            {flashing ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} /> Flashing...</> : '  Choose ROM & Flash'}
          </button>
        </div>
      )}
    </div>
  )
}
