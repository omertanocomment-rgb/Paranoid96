import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { join, basename, extname } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'

const execAsync = promisify(execFile)
function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}
function adbShell(serial, cmd) {
  return execAsync(bin('adb'), ['-s', serial, 'shell', cmd], { timeout: 15000 })
}

export class MediaTools {
  //    Ringtone maker                                                           
  async createRingtone(inputPath, options = {}, onProgress) {
    const { startTime = 0, duration = 30, fadeIn = 0.5, fadeOut = 1.0, outputName } = options
    const outDir = join(app.getPath('temp'), 'ft_ringtones')
    await fs.ensureDir(outDir)
    const ext = extname(inputPath).toLowerCase()
    const outPath = join(outDir, (outputName || basename(inputPath, ext)) + '_ringtone.mp3')

    onProgress?.({ percent: 10, message: 'Processing audio...' })
    const ffmpeg = bin('ffmpeg')
    if (!await fs.pathExists(ffmpeg)) {
      return { error: 'ffmpeg not found in bin/. Download from: https://www.gyan.dev/ffmpeg/builds/ and place ffmpeg.exe in bin/' }
    }
    const filters = []
    if (fadeIn > 0) filters.push(`afade=t=in:st=${startTime}:d=${fadeIn}`)
    if (fadeOut > 0) filters.push(`afade=t=out:st=${startTime + duration - fadeOut}:d=${fadeOut}`)

    const args = ['-i', inputPath, '-ss', String(startTime), '-t', String(duration), '-acodec', 'libmp3lame', '-ab', '192k', '-ar', '44100']
    if (filters.length) { args.push('-af', filters.join(',')) }
    args.push('-y', outPath)

    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpeg, args)
      let lastLine = ''
      proc.stderr.on('data', d => {
        lastLine = d.toString()
        const m = lastLine.match(/time=(\d+):(\d+):(\d+)/)
        if (m) {
          const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3])
          onProgress?.({ percent: Math.min(90, Math.round(secs / duration * 80) + 10), message: `Processing: ${secs.toFixed(0)}s` })
        }
      })

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', code => {
        if (code === 0) {
          onProgress?.({ percent: 100, message: 'Ringtone created!' })
          resolve({ success: true, path: outPath })
        } else {
          reject(new Error('ffmpeg failed: ' + lastLine))
        }
      })
    })
  }

  async pushRingtone(serial, localPath, type = 'ringtone') {
    const filename = basename(localPath)
    const remotePaths = {
      ringtone: `/sdcard/Ringtones/${filename}`,
      notification: `/sdcard/Notifications/${filename}`,
      alarm: `/sdcard/Alarms/${filename}`
    }
    const remote = remotePaths[type] || remotePaths.ringtone

    await new Promise((res, rej) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'push', localPath, remote])

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', c => c === 0 ? res() : rej(new Error('Push failed')))
    })
    // Trigger media scan so it appears in settings
    await adbShell(serial, `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${remote}`)
    return { success: true, remote }
  }

  //    HEIC   JPG converter                                                     
  async convertHeic(inputPaths, destDir, onProgress) {
    const ffmpeg = bin('ffmpeg')
    if (!await fs.pathExists(ffmpeg)) {
      return { error: 'ffmpeg not found in bin/. Also handles HEIC conversion.' }
    }
    await fs.ensureDir(destDir)
    const results = []
    for (let i = 0; i < inputPaths.length; i++) {
      const inputPath = inputPaths[i]
      const outName = basename(inputPath, extname(inputPath)) + '.jpg'
      const outPath = join(destDir, outName)
      onProgress?.({ percent: Math.round(i / inputPaths.length * 100), message: `Converting ${basename(inputPath)}...` })
      try {
        await new Promise((res, rej) => {
          const p = spawn(ffmpeg, ['-i', inputPath, '-q:v', '2', '-y', outPath])
          p.on('close', c => c === 0 ? res() : rej(new Error('Convert failed')))
        })
        results.push({ input: inputPath, output: outPath, success: true })
      } catch (e) {
        results.push({ input: inputPath, error: e.message, success: false })
      }
    }
    return { results, converted: results.filter(r => r.success).length }
  }

  //    Auto-convert on export                                                   
  async exportWithConvert(serial, remotePaths, destDir, convertHeic = true, onProgress) {
    await fs.ensureDir(destDir)
    const results = []
    for (let i = 0; i < remotePaths.length; i++) {
      const remote = remotePaths[i]
      const filename = remote.split('/').pop()
      const localPath = join(destDir, filename)
      onProgress?.({ percent: Math.round(i / remotePaths.length * 90), message: `Pulling ${filename}...` })
      try {
        await new Promise((res, rej) => {
          const p = spawn(bin('adb'), ['-s', serial, 'pull', remote, localPath])
          p.on('close', c => c === 0 ? res() : rej(new Error('Pull failed')))
        })
        if (convertHeic && (filename.toLowerCase().endsWith('.heic') || filename.toLowerCase().endsWith('.heif'))) {
          await this.convertHeic([localPath], destDir, () => {})
          await fs.remove(localPath)
        }
        results.push({ file: filename, success: true })
      } catch (e) {
        results.push({ file: filename, success: false, error: e.message })
      }
    }
    return { results, success: results.filter(r => r.success).length }
  }

  //    SMS   PDF exporter                                                       
  async exportSmsToHtml(serial, destDir, onProgress) {
    onProgress?.({ percent: 10, message: 'Pulling SMS database...' })
    await fs.ensureDir(destDir)

    // First try content provider approach (no root)
    const raw = await new Promise((res) => {
      const proc = spawn(bin('adb'), ['-s', serial, 'shell',
        'content query --uri content://sms/ --projection address:body:date:type:thread_id --sort "date DESC" 2>/dev/null | head -5000'])
      let out = ''
      proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res(out))
    })

    onProgress?.({ percent: 50, message: 'Parsing messages...' })
    const messages = []
    const threads = new Map()
    for (const line of raw.split('\n').filter(l => l.includes('address='))) {
      const address = line.match(/address=([^,\n]+)/)?.[1]?.trim() || 'Unknown'
      const body = line.match(/body=([^,\n]+)/)?.[1]?.trim() || ''
      const date = parseInt(line.match(/date=(\d+)/)?.[1] || 0)
      const type = line.match(/type=(\d)/)?.[1]
      const threadId = line.match(/thread_id=(\d+)/)?.[1] || '0'
      const msg = { address, body, date: new Date(date), type: type === '1' ? 'received' : 'sent', threadId }
      messages.push(msg)
      if (!threads.has(threadId)) threads.set(threadId, [])
      threads.get(threadId).push(msg)
    }

    onProgress?.({ percent: 70, message: 'Generating HTML export...' })

    // Generate one HTML per thread
    const threadFiles = []
    for (const [threadId, msgs] of threads.entries()) {
      const contact = msgs[0]?.address || 'Unknown'
      const filename = `sms_${contact.replace(/[^a-zA-Z0-9]/g, '_')}_${threadId}.html`
      const sorted = msgs.sort((a, b) => a.date - b.date)
      const html = this._generateSmsHtml(contact, sorted)
      const filePath = join(destDir, filename)
      await fs.writeFile(filePath, html)
      threadFiles.push({ contact, filename, messages: msgs.length, path: filePath })
    }

    // Generate index
    const indexHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SMS Export</title>
<style>body{font-family:sans-serif;max-width:600px;margin:2rem auto;background:#f5f5f5}
h1{color:#333}a{color:#2196F3;text-decoration:none}
.thread{background:#fff;border-radius:8px;padding:12px 16px;margin:8px 0;border-left:3px solid #2196F3}
.meta{font-size:11px;color:#999;margin-top:4px}</style></head><body>
<h1>SMS Export -- ${threads.size} conversations</h1>
${threadFiles.map(t => `<div class="thread"><a href="${t.filename}">${t.contact}</a><div class="meta">${t.messages} messages</div></div>`).join('')}
</body></html>`
    await fs.writeFile(join(destDir, 'index.html'), indexHtml)

    // Also write JSON
    await fs.writeJSON(join(destDir, 'sms_all.json'), messages, { spaces: 2 })

    onProgress?.({ percent: 100, message: `Exported ${messages.length} messages in ${threads.size} threads` })
    return { success: true, dest: destDir, threads: threads.size, messages: messages.length, files: threadFiles }
  }

  _generateSmsHtml(contact, messages) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SMS with ${contact}</title>
<style>
body{font-family:-apple-system,sans-serif;max-width:680px;margin:0 auto;background:#f0f0f0;padding:16px}
.bubble{max-width:75%;margin:4px 0;padding:8px 14px;border-radius:18px;font-size:14px;line-height:1.5;word-wrap:break-word}
.sent{background:#007AFF;color:#fff;margin-left:auto;border-bottom-right-radius:4px}
.received{background:#fff;color:#000;margin-right:auto;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.1)}
.row{display:flex;flex-direction:column;margin:2px 0}
.row.sent-row{align-items:flex-end}.row.recv-row{align-items:flex-start}
.meta{font-size:10px;color:#999;margin:2px 8px}
.date-sep{text-align:center;font-size:11px;color:#999;margin:12px 0}
h2{font-size:15px;color:#333;padding:8px;background:#fff;border-radius:8px;margin:0 0 16px}
</style></head><body>
<h2>Conversation with ${contact} -- ${messages.length} messages</h2>
${messages.map((m, i) => {
  const isNew = i === 0 || new Date(messages[i-1].date).toDateString() !== new Date(m.date).toDateString()
  const sep = isNew ? `<div class="date-sep">${m.date.toLocaleDateString('en-AU', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>` : ''
  return `${sep}<div class="row ${m.type === 'sent' ? 'sent-row' : 'recv-row'}">
<div class="bubble ${m.type}">${m.body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
<div class="meta">${m.date.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})}</div></div>`
}).join('')}
</body></html>`
  }

  //    Contact photo manager                                                     
  async exportContactPhotos(serial, destDir, onProgress) {
    onProgress?.({ percent: 10, message: 'Pulling contacts database...' })
    await fs.ensureDir(destDir)
    const photoDir = join(destDir, 'contact_photos')
    await fs.ensureDir(photoDir)
    try {
      // Pull the contacts db
      const dbPath = '/data/data/com.android.providers.contacts/databases/contacts2.db'
      const localDb = join(app.getPath('temp'), 'ft_contacts.db')
      await new Promise((res, rej) => {
        const p = spawn(bin('adb'), ['-s', serial, 'pull', dbPath, localDb])
        p.on('close', c => c === 0 ? res() : rej(new Error('Need root for contact photos DB')))
      })
      onProgress?.({ percent: 100, message: 'Contacts pulled' })
      return { success: true, path: photoDir }
    } catch {
      return { success: false, error: 'Contact photo access requires root. Non-root: use backup/restore to migrate contacts.' }
    }
  }

  //    Permission reset scheduler                                                 
  async schedulePermissionReset(serial, packageName, permissions, intervalHours) {
    const schedule = {
      serial, packageName, permissions, intervalHours,
      nextReset: new Date(Date.now() + intervalHours * 3600000).toISOString(),
      createdAt: new Date().toISOString()
    }
    // Persist schedule
    const scheduleFile = join(app.getPath('userData'), 'permission_schedules.json')
    let existing = []
    try { existing = await fs.readJSON(scheduleFile) } catch {}
    existing.push(schedule)
    await fs.writeJSON(scheduleFile, existing)
    return { success: true, schedule }
  }

  async runScheduledResets() {
    const scheduleFile = join(app.getPath('userData'), 'permission_schedules.json')
    let schedules = []
    try { schedules = await fs.readJSON(scheduleFile) } catch { return }
    const now = new Date()
    const updated = []
    for (const s of schedules) {
      if (new Date(s.nextReset) <= now) {
        for (const perm of s.permissions) {
          try {
            await execAsync(bin('adb'), ['-s', s.serial, 'shell', `pm revoke ${s.packageName} ${perm}`], { timeout: 5000 })
          } catch {}
        }
        s.lastReset = now.toISOString()
        s.nextReset = new Date(Date.now() + s.intervalHours * 3600000).toISOString()
      }
      updated.push(s)
    }
    await fs.writeJSON(scheduleFile, updated)
  }
}
