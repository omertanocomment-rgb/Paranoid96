/**
 * OMERTA THEME ENGINE
 * Drop this into any Electron+React project.
 * Main process side -- handles file I/O, font loading, persistence.
 */

import { app, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs-extra'
import path from 'path'

//    Default theme                                                               
export const DEFAULT_THEME = {
  id: 'default',
  name: 'Omerta Default',
  version: 1,

  // Colours
  colors: {
    accent:       '#f59e0b',   // amber
    accentDim:    'rgba(245,158,11,0.15)',
    accentBorder: 'rgba(245,158,11,0.35)',
    secondary:    '#60a5fa',   // blue
    success:      '#4ade80',   // green
    danger:       '#f87171',   // red
    warning:      '#fb923c',   // orange

    bg:     '#0d0d0d',
    bg1:    '#131313',
    bg2:    '#1a1a1a',
    bg3:    '#202020',
    bg4:    '#282828',

    border:  '#2a2a2a',
    border2: '#333333',

    text:  '#e8e8e6',
    text2: '#999999',
    text3: '#555555',
  },

  // Typography
  font: {
    sans:   'system-ui, sans-serif',
    mono:   "'Courier New', monospace",
    size:   14,               // base px
    weight: 400,
    customFontName: null,     // loaded custom font
    customFontPath: null,     // path to font file on disk
  },

  // Background
  background: {
    type:       'solid',       // 'solid' | 'gradient' | 'image'
    color:      '#0d0d0d',
    gradient:   'linear-gradient(135deg, #0d0d0d 0%, #1a1a2e 100%)',
    imagePath:  null,
    imageBlur:  0,             // px
    imageOpacity: 0.8,         // 0-1 (how visible the bg image is)
    imageOverlayColor: '#0d0d0d',
    imageOverlayOpacity: 0.5,
  },

  // Branding
  branding: {
    appName:       'Omerta',
    logoPath:      null,       // custom logo image path
    logoSize:      28,         // px
    showLogo:      true,
    showAppName:   true,
    faviconPath:   null,
    thumbnailPath: null,       // taskbar / preview thumbnail
  },

  // Window
  window: {
    style:          'frameless',   // 'frameless' | 'native' | 'glass'
    glassBlur:      20,
    glassOpacity:   0.85,
    borderRadius:   0,             // window corner radius (macOS/Win11)
    titleBarHeight: 40,
    trafficLights:  'default',     // 'default' | 'hidden' | 'custom'
  },

  // Sidebar
  sidebar: {
    width:   200,
    style:   'dark',      // 'dark' | 'accent' | 'transparent' | 'blur'
    compact: false,
  },

  // Animations
  motion: {
    enabled:    true,
    speed:      1.0,        // multiplier -- 0 to disable, 2 for slow
    pageTransition: 'fade', // 'fade' | 'slide' | 'none'
  },

  // Icons
  icons: {
    set:          'lucide',    // 'lucide' | 'material' | 'custom'
    size:         16,
    strokeWidth:  1.5,
  },

  // Custom CSS -- injected after all other styles
  customCss: '',
}

//    Theme store                                                                 
export class ThemeEngine {
  constructor(mainWindow) {
    this.win = mainWindow
    this.storePath = join(app.getPath('userData'), 'theme.json')
    this.fontsDir  = join(app.getPath('userData'), 'fonts')
    this.assetsDir = join(app.getPath('userData'), 'theme-assets')
    this.current   = { ...DEFAULT_THEME }
    this.fontFaces  = []
  }

  async init() {
    await fs.ensureDir(this.fontsDir)
    await fs.ensureDir(this.assetsDir)
    await this.load()
    this.registerIPC()
  }

  async load() {
    try {
      const saved = await fs.readJSON(this.storePath)
      this.current = this.merge(DEFAULT_THEME, saved)
    } catch {
      this.current = { ...DEFAULT_THEME }
    }
    await this.applyToWindow()
  }

  async save() {
    await fs.writeJSON(this.storePath, this.current, { spaces: 2 })
  }

  merge(base, override) {
    const result = { ...base }
    for (const key of Object.keys(override)) {
      if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
        result[key] = this.merge(base[key] || {}, override[key])
      } else {
        result[key] = override[key]
      }
    }
    return result
  }

  send(channel, data) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, data)
    }
  }

  async applyToWindow() {
    // Send theme to renderer
    this.send('theme:current', this.current)

    // Set window title
    if (this.win) {
      this.win.setTitle(this.current.branding.appName || 'Omerta')
    }

    // Apply thumbnail if set
    if (process.platform === 'win32' && this.current.branding.thumbnailPath) {
      try {
        const { nativeImage } = await import('electron')
        const img = nativeImage.createFromPath(this.current.branding.thumbnailPath)
        this.win?.setThumbnailClip({ x: 0, y: 0, width: img.getSize().width, height: img.getSize().height })
      } catch {}
    }
  }

  async installFont(sourcePath) {
    const ext   = path.extname(sourcePath).toLowerCase()
    const name  = path.basename(sourcePath, ext)
    const dest  = join(this.fontsDir, path.basename(sourcePath))
    await fs.copy(sourcePath, dest, { overwrite: true })
    return { name, path: dest, ext: ext.slice(1) }
  }

  async listInstalledFonts() {
    const files = await fs.readdir(this.fontsDir).catch(() => [])
    return files
      .filter(f => /\.(ttf|otf|woff2|woff)$/i.test(f))
      .map(f => ({
        name: f.replace(/\.(ttf|otf|woff2|woff)$/i, ''),
        filename: f,
        path: join(this.fontsDir, f),
        ext: path.extname(f).slice(1)
      }))
  }

  async removeFont(filename) {
    await fs.remove(join(this.fontsDir, filename))
  }

  async saveAsset(sourcePath, type) {
    // type: 'logo' | 'background' | 'favicon' | 'thumbnail'
    const ext  = path.extname(sourcePath)
    const dest = join(this.assetsDir, `${type}${ext}`)
    await fs.copy(sourcePath, dest, { overwrite: true })
    return dest
  }

  async exportTheme(destPath) {
    const exported = {
      ...this.current,
      _exportedAt: new Date().toISOString(),
      _version: 1,
      _format: 'omertheme',
    }
    await fs.writeJSON(destPath, exported, { spaces: 2 })
    return destPath
  }

  async importTheme(sourcePath) {
    const data = await fs.readJSON(sourcePath)
    if (data._format !== 'omertheme') throw new Error('Not a valid .omertheme file')
    this.current = this.merge(DEFAULT_THEME, data)
    await this.save()
    await this.applyToWindow()
    return this.current
  }

  registerIPC() {
    ipcMain.handle('theme:get',    () => this.current)
    ipcMain.handle('theme:defaults', () => DEFAULT_THEME)

    ipcMain.handle('theme:set', async (_, patch) => {
      this.current = this.merge(this.current, patch)
      await this.save()
      await this.applyToWindow()
      return this.current
    })

    ipcMain.handle('theme:reset', async () => {
      this.current = { ...DEFAULT_THEME }
      await this.save()
      await this.applyToWindow()
      return this.current
    })

    ipcMain.handle('theme:export', async () => {
      const { filePath } = await dialog.showSaveDialog({
        defaultPath: `${this.current.branding.appName || 'omerta'}-theme.omertheme`,
        filters: [{ name: 'Omerta Theme', extensions: ['omertheme'] }, { name: 'JSON', extensions: ['json'] }]
      })
      if (!filePath) return { cancelled: true }
      await this.exportTheme(filePath)
      return { success: true, path: filePath }
    })

    ipcMain.handle('theme:import', async () => {
      const { filePaths } = await dialog.showOpenDialog({
        filters: [{ name: 'Omerta Theme', extensions: ['omertheme', 'json'] }],
        properties: ['openFile']
      })
      if (!filePaths?.[0]) return { cancelled: true }
      const theme = await this.importTheme(filePaths[0])
      return { success: true, theme }
    })

    // Font management
    ipcMain.handle('theme:fonts:list', () => this.listInstalledFonts())
    ipcMain.handle('theme:fonts:install', async () => {
      const { filePaths } = await dialog.showOpenDialog({
        filters: [{ name: 'Font Files', extensions: ['ttf', 'otf', 'woff2', 'woff'] }],
        properties: ['openFile', 'multiSelections']
      })
      if (!filePaths?.length) return { cancelled: true }
      const installed = []
      for (const fp of filePaths) {
        const font = await this.installFont(fp)
        installed.push(font)
      }
      return { success: true, fonts: installed }
    })
    ipcMain.handle('theme:fonts:remove', (_, filename) => this.removeFont(filename))
    ipcMain.handle('theme:fonts:dir', () => this.fontsDir)

    // Asset uploads
    ipcMain.handle('theme:upload:logo', async () => {
      const { filePaths } = await dialog.showOpenDialog({
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'ico'] }],
        properties: ['openFile']
      })
      if (!filePaths?.[0]) return { cancelled: true }
      const dest = await this.saveAsset(filePaths[0], 'logo')
      this.current.branding.logoPath = dest
      await this.save()
      await this.applyToWindow()
      return { success: true, path: dest }
    })

    ipcMain.handle('theme:upload:background', async () => {
      const { filePaths } = await dialog.showOpenDialog({
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }],
        properties: ['openFile']
      })
      if (!filePaths?.[0]) return { cancelled: true }
      const dest = await this.saveAsset(filePaths[0], 'background')
      this.current.background.imagePath = dest
      this.current.background.type = 'image'
      await this.save()
      await this.applyToWindow()
      return { success: true, path: dest }
    })

    ipcMain.handle('theme:upload:thumbnail', async () => {
      const { filePaths } = await dialog.showOpenDialog({
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
        properties: ['openFile']
      })
      if (!filePaths?.[0]) return { cancelled: true }
      const dest = await this.saveAsset(filePaths[0], 'thumbnail')
      this.current.branding.thumbnailPath = dest
      await this.save()
      await this.applyToWindow()
      return { success: true, path: dest }
    })

    ipcMain.handle('theme:upload:favicon', async () => {
      const { filePaths } = await dialog.showOpenDialog({
        filters: [{ name: 'Images', extensions: ['ico', 'png'] }],
        properties: ['openFile']
      })
      if (!filePaths?.[0]) return { cancelled: true }
      const dest = await this.saveAsset(filePaths[0], 'favicon')
      this.current.branding.faviconPath = dest
      await this.save()
      return { success: true, path: dest }
    })

    // Read asset file as base64 (for renderer to display without file:// issues)
    ipcMain.handle('theme:asset:read', async (_, filePath) => {
      if (!filePath) return null
      try {
        const data = await fs.readFile(filePath)
        const ext = path.extname(filePath).toLowerCase().slice(1)
        const mime = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', svg:'image/svg+xml', webp:'image/webp', gif:'image/gif', ico:'image/x-icon' }[ext] || 'image/png'
        return { base64: data.toString('base64'), mime, dataUrl: `data:${mime};base64,${data.toString('base64')}` }
      } catch { return null }
    })

    // Read font as base64 for @font-face injection
    ipcMain.handle('theme:fonts:read', async (_, filename) => {
      const fontPath = join(this.fontsDir, filename)
      try {
        const data = await fs.readFile(fontPath)
        const ext  = path.extname(filename).toLowerCase().slice(1)
        const mime = { ttf:'font/ttf', otf:'font/otf', woff:'font/woff', woff2:'font/woff2' }[ext] || 'font/ttf'
        return { base64: data.toString('base64'), mime, dataUrl: `data:${mime};base64,${data.toString('base64')}` }
      } catch { return null }
    })
  }
}
