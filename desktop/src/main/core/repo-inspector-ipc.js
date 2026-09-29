// repo-inspector-ipc.js
// Repository browser + IPA inspector, mirroring RepoTweaks' repo/package
// browsing feature set: browse a Cydia/Sileo-style repo (Packages index),
// and inspect .ipa files (Info.plist, provisioning). APK inspection is
// intentionally excluded - OMERTA's existing APK Analyser page covers it.
import fs from 'fs-extra'
import https from 'https'
import http from 'http'
import StreamZip from 'node-stream-zip'
import plist from 'plist'

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    lib.get(url, { headers: { 'user-agent': 'OmniForge/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchText(res.headers.location))
      }
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => resolve(body))
    }).on('error', reject)
  })
}

// Parses a Debian-style "Packages" control file (Cydia/Sileo/APT repo format)
function parsePackagesIndex(text) {
  const blocks = text.split(/\n\n+/).map(b => b.trim()).filter(Boolean)
  return blocks.map(block => {
    const pkg = {}
    let lastKey = null
    for (const line of block.split('\n')) {
      const m = line.match(/^([A-Za-z0-9-]+):\s?(.*)$/)
      if (m) { lastKey = m[1]; pkg[m[1]] = m[2] }
      else if (lastKey && line.startsWith(' ')) pkg[lastKey] += '\n' + line.trim()
    }
    return pkg
  }).filter(p => p.Package)
}

export function registerRepoInspectorHandlers(ipcMain, dialog, shell, mainWindow) {
  //    Repo browsing (Cydia/Sileo/APT-style repos)
  ipcMain.handle('repo:fetch', async (e, { baseUrl }) => {
    const url = baseUrl.replace(/\/$/, '')
    const candidates = [`${url}/Packages`, `${url}/./Packages`, `${url}/dists/./main/binary-iphoneos-arm/Packages`]
    let text = null, usedUrl = null
    for (const c of candidates) {
      try {
        const t = await fetchText(c)
        if (t && t.includes('Package:')) { text = t; usedUrl = c; break }
      } catch {}
    }
    if (!text) throw new Error('Could not find a Packages index at that repo URL')
    const packages = parsePackagesIndex(text)
    return { url: usedUrl, count: packages.length, packages: packages.slice(0, 500) }
  })

  ipcMain.handle('repo:releases-info', async (e, { baseUrl }) => {
    try {
      const text = await fetchText(baseUrl.replace(/\/$/, '') + '/Release')
      return { ok: true, text }
    } catch (e2) { return { ok: false, error: e2.message } }
  })

  //    IPA inspection
  ipcMain.handle('repo:pick-ipa', async () => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'IPA', extensions: ['ipa'] }] })
    if (!filePaths?.length) return null
    return filePaths[0]
  })

  ipcMain.handle('repo:inspect-ipa', async (e, filePath) => {
    const zip = new StreamZip.async({ file: filePath })
    try {
      const entries = await zip.entries()
      const names = Object.keys(entries)
      const infoPlistEntry = names.find(n => /^Payload\/[^/]+\.app\/Info\.plist$/.test(n))
      let info = null
      if (infoPlistEntry) {
        const buf = await zip.entryData(infoPlistEntry)
        try { info = plist.parse(buf.toString('utf8')) } catch { info = { raw: buf.toString('utf8').slice(0, 2000) } }
      }
      const entitlementsEntry = names.find(n => /embedded\.mobileprovision$/.test(n))
      const size = fs.statSync(filePath).size
      return {
        ok: true,
        fileCount: names.length,
        sizeBytes: size,
        appPath: names.find(n => /^Payload\/[^/]+\.app\/$/.test(n)) || null,
        info: info ? {
          bundleId: info.CFBundleIdentifier,
          version: info.CFBundleShortVersionString,
          build: info.CFBundleVersion,
          name: info.CFBundleDisplayName || info.CFBundleName,
          minOS: info.MinimumOSVersion,
          executable: info.CFBundleExecutable,
        } : null,
        hasProvisioningProfile: !!entitlementsEntry,
        topLevelEntries: names.filter(n => n.split('/').length <= 3).slice(0, 100),
      }
    } finally { await zip.close() }
  })

  // Note: APK inspection is intentionally not duplicated here - OMERTA's
  // existing Android - Dev - "APK Analyser" page (apps:*/apkanalyse IPC)
  // already covers manifest/permission inspection for .apk files.
}
