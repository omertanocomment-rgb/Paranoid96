import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Progress, TabBar } from './_shared.jsx'


export default function MediaTools({ device, addLog }) {
  const [tab, setTab] = useState('ringtone')
  const [audioFile, setAudioFile] = useState('')
  const [startSec, setStartSec] = useState(0)
  const [durSec, setDurSec] = useState(30)
  const [ringType, setRingType] = useState('ringtone')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ percent:0, message:'' })
  const [heicFiles, setHeicFiles] = useState([])

  useEffect(() => {
    const r = ft.on('media:progress', p => setProgress({ percent:p.percent||0, message:p.message||'' }))
    return r
  }, [])

  const serial = device?.serial

  const pickAudio = async () => {
    const { filePaths } = await ft.dialog.openFile({ filters:[{ name:'Audio', extensions:['mp3','wav','aac','m4a','flac','ogg','opus'] }] })
    if (filePaths?.[0]) setAudioFile(filePaths[0])
  }

  const makeRingtone = async () => {
    if (!audioFile) return addLog('Select an audio file first')
    setBusy(true)
    try {
      const res = await ft.media.ringtone({ inputPath: audioFile, startSec, durationSec: durSec, serial, type: ringType })
      addLog(res.success ? 'Ringtone created: ' + (res.path || '') : res.error)
    } catch (e) { addLog('Ringtone: ' + e.message) }
    setBusy(false)
  }

  const convertHeic = async () => {
    const { filePaths } = await ft.dialog.openFile({ filters:[{ name:'HEIC Images', extensions:['heic','heif','HEIC','HEIF'] }], properties:['openFile','multiSelections'] })
    if (!filePaths?.length) return
    setHeicFiles(filePaths)
    setBusy(true)
    try {
      const res = await ft.media.convertHeic({ inputPaths: filePaths, format:'jpg', quality:92 })
      addLog(`Converted ${res.filter?.(r=>r.success).length || '?'} HEIC files`)
    } catch (e) { addLog('HEIC convert: ' + e.message) }
    setBusy(false)
  }

  const exportSms = async () => {
    if (!serial) return addLog('No device connected')
    setBusy(true)
    try {
      const res = await ft.media.exportSms({ serial })
      addLog(res.success ? `Exported ${res.exported || ''} SMS threads to PDF` : res.error)
    } catch (e) { addLog('SMS export: ' + e.message) }
    setBusy(false)
  }

  return (
    <PageWrap>
      <PageHeader title="Media Tools" icon=" " />
      <TabBar tabs={[['ringtone','Ringtone Maker'],['heic','HEIC   JPG'],['sms','SMS to PDF']]} active={tab} onChange={setTab} />

      {tab === 'ringtone' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>Create ringtone from any audio file</div>
            <div style={{ display:'flex', gap:8, marginBottom:12 }}>
              <div style={{ flex:1, fontSize:12, color:'var(--text3)', padding:'7px 10px', background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {audioFile ? audioFile.split(/[/\\]/).pop() : 'No file selected'}
              </div>
              <button className="btn btn-sm" onClick={pickAudio}>  Browse</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
              <div>
                <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Start (seconds)</div>
                <input type="number" value={startSec} min={0} onChange={e => setStartSec(+e.target.value)} style={{ width:'100%' }} />
              </div>
              <div>
                <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>Duration (seconds)</div>
                <input type="number" value={durSec} min={1} max={180} onChange={e => setDurSec(+e.target.value)} style={{ width:'100%' }} />
              </div>
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:'var(--text3)', marginBottom:6 }}>Type</div>
              <div style={{ display:'flex', gap:6 }}>
                {['ringtone','notification','alarm'].map(t => (
                  <button key={t} onClick={() => setRingType(t)} style={{
                    flex:1, padding:'6px 0', borderRadius:6, fontSize:12, cursor:'pointer', textTransform:'capitalize',
                    background: ringType===t ? 'var(--accent-dim)' : 'var(--bg2)',
                    border:`1px solid ${ringType===t ? 'var(--accent-border)' : 'var(--border)'}`,
                    color: ringType===t ? 'var(--accent)' : 'var(--text2)'
                  }}>{t}</button>
                ))}
              </div>
            </div>
            <button className="btn btn-primary" onClick={makeRingtone} disabled={busy || !audioFile}>
                Create & Push to Device
            </button>
          </div>
          {busy && <Progress {...progress} />}
        </div>
      )}

      {tab === 'heic' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Convert HEIC/HEIF to JPG</div>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:12 }}>iPhone photos use HEIC format. Convert them to JPG for universal compatibility.</div>
            <button className="btn btn-primary" onClick={convertHeic} disabled={busy}>  Select HEIC Files & Convert</button>
          </div>
          {heicFiles.length > 0 && <div style={{ fontSize:12, color:'var(--text3)' }}>{heicFiles.length} file(s) selected</div>}
          {busy && <Progress {...progress} />}
        </div>
      )}

      {tab === 'sms' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card">
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Export SMS to PDF</div>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:12 }}>
              Exports all SMS conversation threads to readable PDF files with timestamps and contact names.
              Each thread becomes its own PDF.
            </div>
            <button className="btn btn-primary" onClick={exportSms} disabled={busy || !device}>
                Export All SMS Threads
            </button>
          </div>
          {busy && <Progress {...progress} />}
        </div>
      )}
    </PageWrap>
  )
}
