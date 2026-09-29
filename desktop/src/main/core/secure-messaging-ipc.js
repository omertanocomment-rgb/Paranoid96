// secure-messaging-ipc.js
// Lightweight E2E-ish encrypted messaging over a WebSocket relay (no central server
// bundled -- user points it at their own relay, e.g. a cheap Railway/Render websocket
// echo-relay, mirroring the OMERTA FTP / Phantom project's deployment target) plus a
// local crypto address book with public-explorer balance lookups (no private keys ever
// leave the device; this is an address book, not a signing wallet).
import { app } from 'electron'
import { join } from 'path'
import fs from 'fs-extra'
import crypto from 'crypto'
import https from 'https'
import WebSocket from 'ws'

function dataFile(name) {
  fs.ensureDirSync(app.getPath('userData'))
  return join(app.getPath('userData'), name)
}

//    Simple local identity keypair (X25519-like via Node's built-in EC)
function identityFile() { return dataFile('messaging_identity.json') }
function loadOrCreateIdentity() {
  try { return fs.readJsonSync(identityFile()) } catch {}
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')
  const id = {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    createdAt: Date.now(),
  }
  fs.writeJsonSync(identityFile(), id, { spaces: 2 })
  return id
}

function deriveSharedKey(myPrivPem, theirPubPem) {
  const priv = crypto.createPrivateKey(myPrivPem)
  const pub = crypto.createPublicKey(theirPubPem)
  const secret = crypto.diffieHellman({ privateKey: priv, publicKey: pub })
  return crypto.createHash('sha256').update(secret).digest() // 32-byte AES key
}

function encryptMsg(key, plaintext) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}
function decryptMsg(key, payload) {
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

//    Contacts + wallet address book
function contactsFile() { return dataFile('messaging_contacts.json') }
function loadContacts() { try { return fs.readJsonSync(contactsFile()) } catch { return [] } }
function saveContacts(list) { fs.writeJsonSync(contactsFile(), list, { spaces: 2 }) }

function walletFile() { return dataFile('wallet_addressbook.json') }
function loadWallet() { try { return fs.readJsonSync(walletFile()) } catch { return [] } }
function saveWallet(list) { fs.writeJsonSync(walletFile(), list, { spaces: 2 }) }

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'OmniForge/1.0', ...headers } }, (res) => {
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (e) { reject(new Error('Bad response: ' + body.slice(0, 200))) }
      })
    }).on('error', reject)
  })
}

let ws = null
const relayMessages = []

export function registerSecureMessagingHandlers(ipcMain, dialog, shell, mainWindow) {
  //    Identity
  ipcMain.handle('msg:identity:get', () => {
    const id = loadOrCreateIdentity()
    return { publicKey: id.publicKey, createdAt: id.createdAt }
  })

  //    Contacts
  ipcMain.handle('msg:contacts:list', () => loadContacts())
  ipcMain.handle('msg:contacts:save', (e, contact) => {
    const list = loadContacts()
    const id = contact.id || ('ct_' + Date.now().toString(36))
    const idx = list.findIndex(c => c.id === id)
    const rec = { ...contact, id }
    if (idx >= 0) list[idx] = rec; else list.push(rec)
    saveContacts(list)
    return { ok: true, id }
  })
  ipcMain.handle('msg:contacts:delete', (e, id) => {
    saveContacts(loadContacts().filter(c => c.id !== id))
    return { ok: true }
  })

  //    Chat history (per-contact, stored encrypted-at-rest is out of scope;
  //    stored locally in userData, same trust boundary as the rest of the app)
  function historyFile(contactId) { return dataFile('msg_history_' + contactId + '.json') }
  ipcMain.handle('msg:history:load', (e, contactId) => {
    try { return fs.readJsonSync(historyFile(contactId)) } catch { return [] }
  })
  ipcMain.handle('msg:history:append', (e, { contactId, message }) => {
    const list = (() => { try { return fs.readJsonSync(historyFile(contactId)) } catch { return [] } })()
    list.push(message)
    fs.writeJsonSync(historyFile(contactId), list.slice(-2000), { spaces: 2 })
    return { ok: true }
  })

  //    Relay connection (WebSocket) - user supplies their own relay URL
  ipcMain.handle('msg:relay:connect', async (e, { url }) => {
    return new Promise((resolve) => {
      try {
        if (ws) { try { ws.close() } catch {} }
        ws = new WebSocket(url)
        ws.on('open', () => {
          mainWindow?.webContents.send('msg:relay:status', { connected: true })
          resolve({ ok: true })
        })
        ws.on('message', (data) => {
          try {
            const parsed = JSON.parse(data.toString())
            mainWindow?.webContents.send('msg:relay:message', parsed)
          } catch {}
        })
        ws.on('close', () => mainWindow?.webContents.send('msg:relay:status', { connected: false }))
        ws.on('error', (err) => {
          mainWindow?.webContents.send('msg:relay:status', { connected: false, error: err.message })
          resolve({ ok: false, error: err.message })
        })
      } catch (err) { resolve({ ok: false, error: err.message }) }
    })
  })

  ipcMain.handle('msg:relay:disconnect', () => {
    try { ws?.close() } catch {}
    ws = null
    return { ok: true }
  })

  ipcMain.handle('msg:relay:send', (e, { toPublicKey, plaintext }) => {
    if (!ws || ws.readyState !== 1) throw new Error('Not connected to a relay')
    const id = loadOrCreateIdentity()
    const key = deriveSharedKey(id.privateKey, toPublicKey)
    const encrypted = encryptMsg(key, plaintext)
    const envelope = { from: id.publicKey, to: toPublicKey, ciphertext: encrypted, ts: Date.now() }
    ws.send(JSON.stringify(envelope))
    return { ok: true, ts: envelope.ts }
  })

  ipcMain.handle('msg:decrypt', (e, { fromPublicKey, ciphertext }) => {
    const id = loadOrCreateIdentity()
    const key = deriveSharedKey(id.privateKey, fromPublicKey)
    return { plaintext: decryptMsg(key, ciphertext) }
  })

  //    Wallet address book + public balance lookups (read-only, no keys)
  ipcMain.handle('wallet:list', () => loadWallet())
  ipcMain.handle('wallet:save', (e, entry) => {
    const list = loadWallet()
    const id = entry.id || ('w_' + Date.now().toString(36))
    const idx = list.findIndex(w => w.id === id)
    const rec = { ...entry, id }
    if (idx >= 0) list[idx] = rec; else list.push(rec)
    saveWallet(list)
    return { ok: true, id }
  })
  ipcMain.handle('wallet:delete', (e, id) => {
    saveWallet(loadWallet().filter(w => w.id !== id))
    return { ok: true }
  })

  ipcMain.handle('wallet:balance', async (e, { chain, address }) => {
    try {
      if (chain === 'BTC') {
        const j = await fetchJson(`https://blockstream.info/api/address/${encodeURIComponent(address)}`)
        const sats = (j.chain_stats?.funded_txo_sum || 0) - (j.chain_stats?.spent_txo_sum || 0)
        return { ok: true, balance: sats / 1e8, unit: 'BTC' }
      }
      if (chain === 'ETH') {
        const j = await fetchJson(`https://api.blockcypher.com/v1/eth/main/addrs/${encodeURIComponent(address)}/balance`)
        return { ok: true, balance: (j.balance || 0) / 1e18, unit: 'ETH' }
      }
      if (chain === 'USDC' || chain === 'ERC20') {
        return { ok: false, error: 'Token balances need a specific contract lookup - use a block explorer link instead' }
      }
      return { ok: false, error: `Balance lookup not wired for chain ${chain} yet - address book entry is still saved` }
    } catch (err) { return { ok: false, error: err.message } }
  })
}
