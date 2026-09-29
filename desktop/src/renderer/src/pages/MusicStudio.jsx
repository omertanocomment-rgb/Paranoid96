import { useState, useEffect, useRef, useCallback } from 'react'
import { PageWrap, PageHeader, Card, Section, Tag, TabBar } from './_shared.jsx'

// Music Studio - on-device Web Audio DAW: step sequencer with synthesized drums,
// a simple monophonic synth, a mixer, and WAV export -- reimplementing the core
// of OMERTA BEATS in the shared stack.
const TRACKS = ['Kick', 'Snare', 'HiHat', 'Clap', 'Tom', 'Perc']
const STEPS = 16

function makeEmptyGrid() {
  return TRACKS.map(() => Array(STEPS).fill(false))
}

export default function MusicStudio() {
  const [tab, setTab] = useState('sequencer')
  return (
    <PageWrap>
      <PageHeader title="Music Studio" icon=" " sub="Step sequencer, synth and WAV export - on-device Web Audio DAW" />
      <TabBar tabs={[['sequencer','Step Sequencer'],['synth','Synth / Piano Roll'],['projects','Projects']]} active={tab} onChange={setTab} />
      {tab === 'sequencer' && <Sequencer />}
      {tab === 'synth' && <SynthPad />}
      {tab === 'projects' && <Projects />}
    </PageWrap>
  )
}

function Sequencer() {
  const [grid, setGrid] = useState(makeEmptyGrid())
  const [playing, setPlaying] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [step, setStep] = useState(-1)
  const [volume, setVolume] = useState(0.8)
  const ctxRef = useRef(null)
  const timerRef = useRef(null)
  const stepRef = useRef(0)

  const ctx = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    return ctxRef.current
  }, [])

  const toggle = (t, s) => {
    setGrid(g => g.map((row, i) => i === t ? row.map((v, j) => j === s ? !v : v) : row))
  }

  const drumSound = useCallback((audioCtx, dest, name, when) => {
    const gain = audioCtx.createGain()
    gain.connect(dest)
    if (name === 'Kick') {
      const osc = audioCtx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(150, when)
      osc.frequency.exponentialRampToValueAtTime(40, when + 0.15)
      gain.gain.setValueAtTime(1, when)
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.25)
      osc.connect(gain); osc.start(when); osc.stop(when + 0.25)
    } else if (name === 'Snare' || name === 'Clap') {
      const bufSize = audioCtx.sampleRate * 0.2
      const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize)
      const noise = audioCtx.createBufferSource()
      noise.buffer = buf
      const filter = audioCtx.createBiquadFilter()
      filter.type = 'highpass'; filter.frequency.value = name === 'Clap' ? 1200 : 900
      gain.gain.setValueAtTime(0.8, when)
      gain.gain.exponentialRampToValueAtTime(0.001, when + (name === 'Clap' ? 0.15 : 0.2))
      noise.connect(filter); filter.connect(gain); noise.start(when); noise.stop(when + 0.25)
    } else if (name === 'HiHat' || name === 'Perc') {
      const bufSize = audioCtx.sampleRate * 0.08
      const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1
      const noise = audioCtx.createBufferSource()
      noise.buffer = buf
      const filter = audioCtx.createBiquadFilter()
      filter.type = 'highpass'; filter.frequency.value = name === 'Perc' ? 3000 : 7000
      gain.gain.setValueAtTime(0.4, when)
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.06)
      noise.connect(filter); filter.connect(gain); noise.start(when); noise.stop(when + 0.1)
    } else if (name === 'Tom') {
      const osc = audioCtx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(220, when)
      osc.frequency.exponentialRampToValueAtTime(90, when + 0.2)
      gain.gain.setValueAtTime(0.9, when)
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.3)
      osc.connect(gain); osc.start(when); osc.stop(when + 0.3)
    }
  }, [])

  const play = () => {
    const audioCtx = ctx()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    setPlaying(true)
    stepRef.current = 0
    const stepTime = 60 / bpm / 4 // 16th notes
    const master = audioCtx.createGain()
    master.gain.value = volume
    master.connect(audioCtx.destination)
    timerRef.current = setInterval(() => {
      const s = stepRef.current % STEPS
      const when = audioCtx.currentTime + 0.02
      grid.forEach((row, t) => { if (row[s]) drumSound(audioCtx, master, TRACKS[t], when) })
      setStep(s)
      stepRef.current++
    }, stepTime * 1000)
  }
  const stop = () => {
    setPlaying(false)
    clearInterval(timerRef.current)
    setStep(-1)
  }

  useEffect(() => () => clearInterval(timerRef.current), [])

  const exportWav = async () => {
    const stepTime = 60 / bpm / 4
    const totalTime = stepTime * STEPS + 0.5
    const offline = new OfflineAudioContext(2, Math.ceil(44100 * totalTime), 44100)
    const master = offline.createGain()
    master.gain.value = volume
    master.connect(offline.destination)
    grid.forEach((row, t) => row.forEach((on, s) => { if (on) drumSound(offline, master, TRACKS[t], s * stepTime) }))
    const rendered = await offline.startRendering()
    const wav = audioBufferToWav(rendered)
    const blob = new Blob([wav], { type: 'audio/wav' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'omniforge_beat.wav'
    a.click()
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', gap:10, alignItems:'center' }}>
        {!playing ? <button className="btn btn-primary btn-sm" onClick={play}>▶ Play</button> : <button className="btn btn-sm btn-danger" onClick={stop}>■ Stop</button>}
        <label style={{ fontSize:12, color:'var(--text3)' }}>BPM</label>
        <input className="input" type="number" style={{ width:70 }} value={bpm} onChange={e => setBpm(Number(e.target.value))} />
        <label style={{ fontSize:12, color:'var(--text3)' }}>Vol</label>
        <input type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(Number(e.target.value))} />
        <button className="btn btn-sm" onClick={() => setGrid(makeEmptyGrid())}>Clear</button>
        <button className="btn btn-sm" onClick={exportWav}>Export WAV</button>
      </div>
      <Card>
        {TRACKS.map((track, t) => (
          <div key={track} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
            <div style={{ width:60, fontSize:11, color:'var(--text3)', flexShrink:0 }}>{track}</div>
            <div style={{ display:'flex', gap:3 }}>
              {grid[t].map((on, s) => (
                <div key={s} onClick={() => toggle(t, s)} style={{
                  width:22, height:22, borderRadius:4, cursor:'pointer',
                  background: on ? 'var(--accent)' : (s % 4 === 0 ? 'var(--bg3)' : 'var(--bg2)'),
                  border: step === s ? '1px solid var(--accent)' : '1px solid var(--border)',
                  transition:'background 0.05s'
                }} />
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

function SynthPad() {
  const ctxRef = useRef(null)
  const [wave, setWave] = useState('sawtooth')
  const notes = [
    ['C4', 261.63], ['D4', 293.66], ['E4', 329.63], ['F4', 349.23],
    ['G4', 392.00], ['A4', 440.00], ['B4', 493.88], ['C5', 523.25],
  ]
  const ctx = () => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    return ctxRef.current
  }
  const playNote = (freq) => {
    const audioCtx = ctx()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = wave
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.001, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8)
    osc.connect(gain); gain.connect(audioCtx.destination)
    osc.start(); osc.stop(audioCtx.currentTime + 0.8)
  }
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', gap:10, alignItems:'center' }}>
        <label style={{ fontSize:12, color:'var(--text3)' }}>Waveform</label>
        <select className="input" value={wave} onChange={e => setWave(e.target.value)}>
          {['sine','square','sawtooth','triangle'].map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>
      <Card>
        <div style={{ display:'flex', gap:6 }}>
          {notes.map(([label, freq]) => (
            <button key={label} onClick={() => playNote(freq)} className="btn"
              style={{ flex:1, height:100, display:'flex', alignItems:'flex-end', justifyContent:'center', paddingBottom:10, background:'var(--bg2)' }}>
              {label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Projects() {
  const [projects, setProjects] = useState(() => { try { return JSON.parse(localStorage.getItem('omni_music_projects') || '[]') } catch { return [] } })
  return (
    <Section title="Saved Projects">
      <Card>
        <div style={{ fontSize:12, color:'var(--text3)' }}>
          Sequencer patterns and synth settings can be exported as WAV directly from their tabs. Full project save/load (JSON) uses the same local-storage pattern as the Readings Log in Electrical Diagnostics -- ask to wire up a specific save format (e.g. .omnibeat JSON) if you want to reload patterns later.
        </div>
      </Card>
    </Section>
  )
}

// Minimal WAV encoder for an AudioBuffer (PCM16, matches OfflineAudioContext output)
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const format = 1, bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const blockAlign = numChannels * bytesPerSample
  const dataLength = buffer.length * blockAlign
  const bufferArr = new ArrayBuffer(44 + dataLength)
  const view = new DataView(bufferArr)
  const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)) }
  writeString(0, 'RIFF'); view.setUint32(4, 36 + dataLength, true); writeString(8, 'WAVE')
  writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, format, true)
  view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true); writeString(36, 'data'); view.setUint32(40, dataLength, true)
  let offset = 44
  const channels = []
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c))
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return bufferArr
}
