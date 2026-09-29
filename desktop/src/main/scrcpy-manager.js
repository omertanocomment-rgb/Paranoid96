import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

const sessions = new Map()

export class ScrcpyManager {
  async isAvailable() { return fs.pathExists(bin('scrcpy')) }

  async launch(serial, opts = {}) {
    const available = await this.isAvailable()
    if (!available) return {
      error: 'scrcpy not found in bin/',
      download: 'https://github.com/Genymobile/scrcpy/releases',
      hint: 'Download scrcpy for your platform and place the binary in the bin/ folder'
    }
    const args = ['-s', serial]
    if (opts.maxSize && opts.maxSize > 0) args.push('--max-size', String(opts.maxSize))
    if (opts.bitrate) args.push('--video-bit-rate', `${opts.bitrate}M`)
    if (opts.fps) args.push('--max-fps', String(opts.fps))
    if (opts.alwaysOnTop) args.push('--always-on-top')
    if (opts.noAudio) args.push('--no-audio')
    if (opts.record) { args.push('--record', opts.record); args.push('--record-format', 'mp4') }
    args.push('--window-title', opts.windowTitle || `Omerta -- ${serial}`)
    const sessionId = `${serial}_${Date.now()}`
    const proc = spawn(bin('scrcpy'), args, { detached: false })
    sessions.set(sessionId, { proc, serial, pid: proc.pid, startedAt: Date.now(), recording: !!opts.record, recordPath: opts.record })
    proc.on('close', () => sessions.delete(sessionId))
    proc.on('error', () => sessions.delete(sessionId))
    return { success: true, sessionId, pid: proc.pid }
  }

  async stopSession(sessionId) {
    const s = sessions.get(sessionId)
    if (!s) return { error: 'Session not found' }
    try { s.proc.kill('SIGTERM'); sessions.delete(sessionId); return { success: true } }
    catch (e) { return { error: e.message } }
  }

  listSessions() {
    return [...sessions.entries()].map(([id, s]) => ({
      id, serial: s.serial, pid: s.pid, startedAt: s.startedAt,
      recording: s.recording, recordPath: s.recordPath
    }))
  }

  async record(serial, outputPath, opts = {}) {
    return this.launch(serial, { ...opts, record: outputPath })
  }
}
