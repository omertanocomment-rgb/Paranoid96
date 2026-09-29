/**
 * OMERTA THEME CONTEXT
 * Wrap your app with <ThemeProvider> and use useTheme() anywhere.
 * Automatically applies all CSS variables, custom fonts, background.
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'

const ThemeContext = createContext(null)
const ft = window.ft

//    CSS variable map                                                             
function buildCssVars(theme) {
  const c = theme.colors
  const f = theme.font
  const vars = {
    '--accent':        c.accent,
    '--accent-dim':    c.accentDim,
    '--accent-border': c.accentBorder,
    '--secondary':     c.secondary,
    '--green':         c.success,
    '--blue':          c.secondary,
    '--red':           c.danger,
    '--orange':        c.warning,
    '--purple':        '#c084fc',

    '--bg':    c.bg,
    '--bg1':   c.bg1,
    '--bg2':   c.bg2,
    '--bg3':   c.bg3,
    '--bg4':   c.bg4,

    '--border':  c.border,
    '--border2': c.border2,

    '--text':  c.text,
    '--text2': c.text2,
    '--text3': c.text3,

    '--green-dim':    `${c.success}22`,
    '--blue-dim':     `${c.secondary}22`,
    '--red-dim':      `${c.danger}22`,
    '--blue-border':  `${c.secondary}55`,

    '--font-sans': f.customFontName ? `'${f.customFontName}', ${f.sans}` : f.sans,
    '--font-mono': f.mono,
    '--font-size': `${f.size}px`,

    '--sidebar-width':    `${theme.sidebar.width}px`,
    '--titlebar-height':  `${theme.window.titleBarHeight}px`,
    '--border-radius':    `${theme.window.borderRadius}px`,
    '--border-radius-md': `${Math.max(4, theme.window.borderRadius - 2)}px`,
    '--border-radius-lg': `${Math.max(8, theme.window.borderRadius + 2)}px`,

    '--motion-speed':  theme.motion.enabled ? `${theme.motion.speed}` : '0',
    '--icon-size':     `${theme.icons.size}px`,
    '--icon-stroke':   `${theme.icons.strokeWidth}`,
  }
  return vars
}

function applyBackground(theme, rootEl) {
  const bg = theme.background
  if (bg.type === 'solid') {
    rootEl.style.backgroundImage = 'none'
    rootEl.style.backgroundColor = bg.color
    return
  }
  if (bg.type === 'gradient') {
    rootEl.style.backgroundImage = bg.gradient
    rootEl.style.backgroundColor = 'transparent'
    return
  }
  // Image -- handled via CSS pseudo-element injected into <head>
  rootEl.style.backgroundColor = bg.imageOverlayColor
}

function injectStyles(theme, logoDataUrl, bgDataUrl, fontDataUrls) {
  const styleId = 'omerta-theme-styles'
  let el = document.getElementById(styleId)
  if (!el) { el = document.createElement('style'); el.id = styleId; document.head.appendChild(el) }

  const fontFaces = fontDataUrls.map(f => `
    @font-face {
      font-family: '${f.name}';
      src: url('${f.dataUrl}') format('${f.format}');
      font-weight: normal;
      font-style: normal;
      font-display: swap;
    }
  `).join('\n')

  const bgImage = bgDataUrl && theme.background.type === 'image' ? `
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image: url('${bgDataUrl}');
      background-size: cover;
      background-position: center;
      filter: blur(${theme.background.imageBlur}px);
      opacity: ${theme.background.imageOpacity};
      z-index: -2;
      pointer-events: none;
    }
    body::after {
      content: '';
      position: fixed;
      inset: 0;
      background: ${theme.background.imageOverlayColor};
      opacity: ${theme.background.imageOverlayOpacity};
      z-index: -1;
      pointer-events: none;
    }
  ` : ''

  el.textContent = [fontFaces, bgImage, theme.customCss || ''].join('\n')
}

//    Provider                                                                     
export function ThemeProvider({ children }) {
  const [theme, setTheme]     = useState(null)
  const [assets, setAssets]   = useState({ logo: null, bg: null })
  const [fonts, setFonts]     = useState([]) // { name, dataUrl, format }
  const [loading, setLoading] = useState(true)
  const root = document.documentElement

  // Load font data for a given font filename
  const loadFont = useCallback(async (filename) => {
    const data = await ft.theme.fontRead(filename)
    if (!data) return null
    const ext = filename.split('.').pop().toLowerCase()
    const format = { ttf:'truetype', otf:'opentype', woff:'woff', woff2:'woff2' }[ext] || 'truetype'
    const name = filename.replace(/\.[^.]+$/, '')
    return { name, dataUrl: data.dataUrl, format, filename }
  }, [])

  const applyTheme = useCallback(async (t) => {
    if (!t) return
    setTheme(t)

    // Apply CSS variables
    const vars = buildCssVars(t)
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)

    // Set base font size
    root.style.fontSize = `${t.font.size}px`

    // Apply background colour immediately
    applyBackground(t, document.body)

    // Load assets
    const [logoData, bgData] = await Promise.all([
      t.branding.logoPath   ? ft.theme.assetRead(t.branding.logoPath)    : null,
      t.background.imagePath ? ft.theme.assetRead(t.background.imagePath) : null,
    ])

    // Load all installed fonts
    const fontList = await ft.theme.fontsList()
    const loadedFonts = (await Promise.all(fontList.map(f => loadFont(f.filename)))).filter(Boolean)
    setFonts(loadedFonts)

    // Inject @font-face, background image, custom CSS
    injectStyles(t, bgData?.dataUrl, bgData?.dataUrl, loadedFonts)

    // Update assets state for logo display etc
    setAssets({
      logo: logoData?.dataUrl || null,
      bg:   bgData?.dataUrl  || null,
    })

    setLoading(false)
  }, [root, loadFont])

  useEffect(() => {
    // Initial load
    if (ft?.theme?.get) ft.theme.get().then(applyTheme).catch(e => console.warn('Theme load:', e.message))

    // Live updates from main process (when user changes something)
    const off = ft?.on ? ft.on('theme:current', applyTheme) : null
    return off
  }, [applyTheme])

  const update = useCallback(async (patch) => {
    const updated = await ft.theme.set(patch)
    await applyTheme(updated)
    return updated
  }, [applyTheme])

  const reset = useCallback(async () => {
    const t = await ft.theme.reset()
    await applyTheme(t)
  }, [applyTheme])

  return (
    <ThemeContext.Provider value={{ theme, assets, fonts, loading, update, reset }}>
      {loading ? <LoadingScreen /> : children}
    </ThemeContext.Provider>
  )
}

function LoadingScreen() {
  return (
    <div style={{ position:'fixed', inset:0, background:'#0d0d0d', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:32, height:32, borderRadius:'50%', border:'2px solid #333', borderTopColor:'#f59e0b', animation:'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

//    Hook                                                                         
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
