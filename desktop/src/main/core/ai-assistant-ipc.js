// ai-assistant-ipc.js
// Personal Claude API client (streaming), local key storage, multi-conversation
// history persisted to disk. Mirrors the OMERTA AI project's feature set.
import { app, safeStorage } from 'electron'
import { join } from 'path'
import fs from 'fs-extra'
import https from 'https'

function convosDir() {
  const d = join(app.getPath('userData'), 'ai_conversations')
  fs.ensureDirSync(d)
  return d
}
function keyFile() {
  return join(app.getPath('userData'), 'ai_api_key.dat')
}

function saveKey(plain) {
  fs.ensureDirSync(app.getPath('userData'))
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(keyFile(), safeStorage.encryptString(plain))
  } else {
    fs.writeFileSync(keyFile(), 'plain:' + plain)
  }
}
function loadKey() {
  try {
    const buf = fs.readFileSync(keyFile())
    if (buf.slice(0, 6).toString() === 'plain:') return buf.toString().slice(6)
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf)
    return ''
  } catch { return '' }
}

const MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

export function registerAiAssistantHandlers(ipcMain, dialog, shell, mainWindow) {
  ipcMain.handle('ai:key:get-status', () => ({ hasKey: !!loadKey() }))
  ipcMain.handle('ai:key:set', (e, key) => { saveKey(key || ''); return { ok: true } })
  ipcMain.handle('ai:key:clear', () => { try { fs.removeSync(keyFile()) } catch {}; return { ok: true } })
  ipcMain.handle('ai:models:list', () => MODELS)

  //    Conversation persistence
  ipcMain.handle('ai:convo:list', () => {
    const files = fs.readdirSync(convosDir()).filter(f => f.endsWith('.json'))
    return files.map(f => {
      try {
        const data = fs.readJsonSync(join(convosDir(), f))
        return { id: data.id, title: data.title, updatedAt: data.updatedAt, messageCount: data.messages?.length || 0 }
      } catch { return null }
    }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)
  })

  ipcMain.handle('ai:convo:load', (e, id) => {
    try { return fs.readJsonSync(join(convosDir(), id + '.json')) }
    catch { return null }
  })

  ipcMain.handle('ai:convo:save', (e, convo) => {
    const id = convo.id || ('c_' + Date.now().toString(36))
    const data = { ...convo, id, updatedAt: Date.now() }
    fs.writeJsonSync(join(convosDir(), id + '.json'), data, { spaces: 2 })
    return { ok: true, id }
  })

  ipcMain.handle('ai:convo:delete', (e, id) => {
    try { fs.removeSync(join(convosDir(), id + '.json')) } catch {}
    return { ok: true }
  })

  //    Streaming chat completion -> pushes 'ai:stream:<streamId>' events
  ipcMain.handle('ai:chat:stream', async (e, { streamId, model, system, messages, maxTokens }) => {
    const key = loadKey()
    if (!key) throw new Error('No API key set. Add your Anthropic API key in Settings.')

    const body = JSON.stringify({
      model: model || 'claude-sonnet-5',
      max_tokens: maxTokens || 4096,
      system: system || undefined,
      stream: true,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    })

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-length': Buffer.byteLength(body),
        },
      }, (res) => {
        if (res.statusCode >= 400) {
          let errBody = ''
          res.on('data', d => errBody += d)
          res.on('end', () => reject(new Error(`API error ${res.statusCode}: ${errBody.slice(0, 300)}`)))
          return
        }
        let full = ''
        let buffer = ''
        res.setEncoding('utf8')
        res.on('data', chunk => {
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop()
          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            const jsonStr = line.slice(5).trim()
            if (!jsonStr) continue
            try {
              const evt = JSON.parse(jsonStr)
              if (evt.type === 'content_block_delta' && evt.delta?.text) {
                full += evt.delta.text
                mainWindow?.webContents.send('ai:stream:' + streamId, { type: 'delta', text: evt.delta.text })
              } else if (evt.type === 'message_stop') {
                mainWindow?.webContents.send('ai:stream:' + streamId, { type: 'done', full })
              } else if (evt.type === 'error') {
                mainWindow?.webContents.send('ai:stream:' + streamId, { type: 'error', error: evt.error?.message || 'stream error' })
              }
            } catch {}
          }
        })
        res.on('end', () => resolve({ ok: true, full }))
      })
      req.on('error', (err) => {
        mainWindow?.webContents.send('ai:stream:' + streamId, { type: 'error', error: err.message })
        reject(err)
      })
      req.write(body)
      req.end()
    })
  })
}
