/**
 * OMERTA THEME EDITOR PAGE
 * Drop this into any app's page router as the "Theme" page.
 * Shows live preview of all changes.
 */

import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '../theme/ThemeContext.jsx'

const ft = window.ft

//    Helpers                                                                    
const Row = ({ label, sub, children }) => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 0', borderBottom:'1px solid var(--border)', gap:16 }}>
    <div style={{ flexShrink:0 }}>
      <div style={{ fontSize:13, color:'var(--text)' }}>{label}</div>
      {sub && <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>{sub}</div>}
    </div>
    <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>{children}</div>
  </div>
)

const Section = ({ title, icon, children }) => (
  <div style={{ marginBottom:24 }}>
    <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.1em', color:'var(--text3)', marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
      {icon && <span style={{ fontSize:14 }}>{icon}</span>}
      {title.toUpperCase()}
    </div>
    <div className="card" style={{ padding:'0 16px' }}>{children}</div>
  </div>
)

const ColorSwatch = ({ value, onChange, label }) => (
  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
    {label && <span style={{ fontSize:12, color:'var(--text3)' }}>{label}</span>}
    <div style={{ position:'relative', width:32, height:32, borderRadius:6, border:'1px solid var(--border2)', overflow:'hidden', cursor:'pointer' }}>
      <div style={{ position:'absolute', inset:0, background:value }} />
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        style={{ position:'absolute', inset:0, opacity:0, cursor:'pointer', width:'100%', height:'100%' }} />
    </div>
    <input value={value} onChange={e => onChange(e.target.value)}
      style={{ width:88, fontFamily:'var(--font-mono)', fontSize:11 }} />
  </div>
)

const Slider = ({ value, min, max, step=1, onChange, unit='' }) => (
  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width:120 }} />
    <span style={{ fontSize:12, color:'var(--text2)', minWidth:36, textAlign:'right' }}>{value}{unit}</span>
  </div>
)

const Toggle = ({ value, onChange }) => (
  <button onClick={() => onChange(!value)} style={{
    width:40, height:22, borderRadius:11, border:'none', cursor:'pointer', position:'relative',
    background: value ? 'var(--accent)' : 'var(--bg3)', transition:'background 0.2s'
  }}>
    <div style={{
      position:'absolute', top:3, left: value ? 20 : 3, width:16, height:16,
      borderRadius:'50%', background:'#fff', transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.3)'
    }} />
  </button>
)

const Select = ({ value, options, onChange }) => (
  <select value={value} onChange={e => onChange(e.target.value)} style={{ fontSize:12, padding:'4px 8px' }}>
    {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
  </select>
)

const UploadBtn = ({ label, onClick, hasValue, onClear }) => (
  <div style={{ display:'flex', gap:6 }}>
    <button className="btn btn-sm" onClick={onClick}>{hasValue ? '  Replace' : `  ${label}`}</button>
    {hasValue && <button className="btn btn-sm btn-red" onClick={onClear} style={{ padding:'4px 8px' }}> </button>}
  </div>
)

//    Main Editor                                                                 
export default function ThemeEditor() {
  const { theme, assets, fonts, update, reset } = useTheme()
  const [installedFonts, setInstalledFonts] = useState([])
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('colours')
  const [previewMsg, setPreviewMsg] = useState(null)

  useEffect(() => {
    ft.theme.fontsList().then(setInstalledFonts).catch(() => {})
  }, [])

  if (!theme) return <div style={{ padding:24, color:'var(--text3)' }}>Loading theme...</div>

  const set = async (path, value) => {
    // path like 'colors.accent' or 'font.size'
    const [section, key] = path.split('.')
    await update({ [section]: { [key]: value } })
    setPreviewMsg('Saved')
    setTimeout(() => setPreviewMsg(null), 1200)
  }

  const setNested = async (section, obj) => {
    await update({ [section]: obj })
  }

  const uploadLogo = async () => {
    const r = await ft.theme.uploadLogo()
    if (!r.cancelled) { setPreviewMsg('Logo updated'); setTimeout(() => setPreviewMsg(null), 1200) }
  }

  const uploadBackground = async () => {
    const r = await ft.theme.uploadBackground()
    if (!r.cancelled) setPreviewMsg('Background updated')
    setTimeout(() => setPreviewMsg(null), 1200)
  }

  const uploadThumbnail = async () => {
    const r = await ft.theme.uploadThumbnail()
    if (!r.cancelled) setPreviewMsg('Thumbnail updated')
    setTimeout(() => setPreviewMsg(null), 1200)
  }

  const installFont = async () => {
    const r = await ft.theme.fontsInstall()
    if (!r.cancelled) {
      setInstalledFonts(await ft.theme.fontsList())
      setPreviewMsg(`Installed ${r.fonts?.length} font(s)`)
      setTimeout(() => setPreviewMsg(null), 1200)
    }
  }

  const removeFont = async (filename) => {
    await ft.theme.fontsRemove(filename)
    setInstalledFonts(await ft.theme.fontsList())
  }

  const exportTheme = async () => {
    const r = await ft.theme.export()
    if (r.success) setPreviewMsg('Theme exported')
  }

  const importTheme = async () => {
    const r = await ft.theme.import()
    if (r.success) setPreviewMsg('Theme imported')
  }

  const TABS = [
    ['colours', '  Colours'],
    ['typography', '  Typography'],
    ['background', '  Background'],
    ['branding', '  Branding'],
    ['layout', '  Layout'],
    ['motion', '  Motion'],
    ['custom', '  Custom CSS'],
  ]

  return (
    <div style={{ padding:24, display:'flex', flexDirection:'column', gap:16, overflowY:'auto', height:'100%' }} className="fade-in">
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:600, color:'var(--text)', margin:0 }}>Theme Editor</h2>
          <p style={{ color:'var(--text3)', fontSize:13, marginTop:4 }}>Customise every aspect of the UI -- changes apply instantly</p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {previewMsg && <span style={{ fontSize:12, color:'var(--accent)' }}>  {previewMsg}</span>}
          <button className="btn btn-sm" onClick={importTheme}>  Import</button>
          <button className="btn btn-sm" onClick={exportTheme}>  Export .omertheme</button>
          <button className="btn btn-sm btn-red" onClick={() => { if (confirm('Reset all settings to default?')) reset() }}>  Reset</button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3, flexWrap:'wrap' }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:'6px 12px', borderRadius:6, fontSize:12, fontWeight:500, cursor:'pointer',
            background: tab===id ? 'var(--bg4)' : 'none',
            color: tab===id ? 'var(--text)' : 'var(--text3)',
            border: tab===id ? '1px solid var(--border)' : '1px solid transparent'
          }}>{label}</button>
        ))}
      </div>

      {/*    COLOURS                                                             */}
      {tab === 'colours' && (
        <div>
          <Section title="Accent & Brand Colours" icon=" ">
            <Row label="Primary Accent" sub="Buttons, highlights, active states">
              <ColorSwatch value={theme.colors.accent} onChange={v => set('colors.accent', v)} />
            </Row>
            <Row label="Secondary / Blue" sub="Info tags, links">
              <ColorSwatch value={theme.colors.secondary} onChange={v => set('colors.secondary', v)} />
            </Row>
            <Row label="Success / Green" sub="Confirmed, active, positive states">
              <ColorSwatch value={theme.colors.success} onChange={v => set('colors.success', v)} />
            </Row>
            <Row label="Danger / Red" sub="Errors, destructive actions">
              <ColorSwatch value={theme.colors.danger} onChange={v => set('colors.danger', v)} />
            </Row>
            <Row label="Warning / Orange" sub="Caution, edge cases">
              <ColorSwatch value={theme.colors.warning} onChange={v => set('colors.warning', v)} />
            </Row>
          </Section>
          <Section title="Background Layers" icon=" ">
            <Row label="Base Background" sub="Deepest layer"><ColorSwatch value={theme.colors.bg} onChange={v => set('colors.bg', v)} /></Row>
            <Row label="Surface 1" sub="Cards, panels"><ColorSwatch value={theme.colors.bg1} onChange={v => set('colors.bg1', v)} /></Row>
            <Row label="Surface 2" sub="Inputs, list rows"><ColorSwatch value={theme.colors.bg2} onChange={v => set('colors.bg2', v)} /></Row>
            <Row label="Surface 3" sub="Hover states"><ColorSwatch value={theme.colors.bg3} onChange={v => set('colors.bg3', v)} /></Row>
            <Row label="Surface 4" sub="Selected / pressed"><ColorSwatch value={theme.colors.bg4} onChange={v => set('colors.bg4', v)} /></Row>
          </Section>
          <Section title="Borders & Text" icon=" ">
            <Row label="Border Subtle"><ColorSwatch value={theme.colors.border} onChange={v => set('colors.border', v)} /></Row>
            <Row label="Border Strong"><ColorSwatch value={theme.colors.border2} onChange={v => set('colors.border2', v)} /></Row>
            <Row label="Text Primary"><ColorSwatch value={theme.colors.text} onChange={v => set('colors.text', v)} /></Row>
            <Row label="Text Secondary"><ColorSwatch value={theme.colors.text2} onChange={v => set('colors.text2', v)} /></Row>
            <Row label="Text Tertiary" sub="Placeholders, hints"><ColorSwatch value={theme.colors.text3} onChange={v => set('colors.text3', v)} /></Row>
          </Section>

          {/* Quick presets */}
          <Section title="Quick Presets" icon=" ">
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', padding:'10px 0' }}>
              {[
                { name:'Omerta Dark', colors:{ accent:'#f59e0b', bg:'#0d0d0d', bg1:'#131313', bg2:'#1a1a1a' }},
                { name:'Deep Purple', colors:{ accent:'#a855f7', bg:'#0a0a0f', bg1:'#110f1a', bg2:'#1a1626' }},
                { name:'Midnight Blue', colors:{ accent:'#3b82f6', bg:'#050d1a', bg1:'#0a1628', bg2:'#0f2040' }},
                { name:'Forest', colors:{ accent:'#22c55e', bg:'#0a0f0a', bg1:'#111811', bg2:'#182018' }},
                { name:'Blood Red', colors:{ accent:'#ef4444', bg:'#0f0a0a', bg1:'#1a0e0e', bg2:'#201414' }},
                { name:'Light Mode', colors:{ accent:'#f59e0b', bg:'#f8f8f8', bg1:'#ffffff', bg2:'#f0f0f0', bg3:'#e8e8e8', bg4:'#dcdcdc', text:'#111111', text2:'#444444', text3:'#888888', border:'#ddd', border2:'#ccc' }},
              ].map(preset => (
                <button key={preset.name} className="btn btn-sm" onClick={() => update({ colors: preset.colors })}
                  style={{ background: preset.colors.bg, border:`1px solid ${preset.colors.accent}`, color: preset.colors.text || '#e8e8e6' }}>
                  {preset.name}
                </button>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/*    TYPOGRAPHY                                                          */}
      {tab === 'typography' && (
        <div>
          <Section title="Fonts" icon=" ">
            <Row label="Base font size" sub="Applied to entire UI">
              <Slider value={theme.font.size} min={11} max={18} onChange={v => set('font.size', v)} unit="px" />
            </Row>
            <Row label="Sans-serif fallback" sub="Used when no custom font is set">
              <Select value={theme.font.sans}
                options={[
                  ['system-ui, sans-serif','System Default'],
                  ['Inter, system-ui, sans-serif','Inter'],
                  ['"Segoe UI", sans-serif','Segoe UI'],
                  ['"SF Pro Display", system-ui, sans-serif','SF Pro'],
                  ['Roboto, sans-serif','Roboto'],
                ]}
                onChange={v => set('font.sans', v)} />
            </Row>
            <Row label="Monospace font">
              <Select value={theme.font.mono}
                options={[
                  ['"Courier New", monospace','Courier New'],
                  ['"JetBrains Mono", monospace','JetBrains Mono'],
                  ['"Fira Code", monospace','Fira Code'],
                  ['"Cascadia Code", monospace','Cascadia Code'],
                  ['"Source Code Pro", monospace','Source Code Pro'],
                  ['Consolas, monospace','Consolas'],
                ]}
                onChange={v => set('font.mono', v)} />
            </Row>
            {theme.font.customFontName && (
              <Row label="Active custom font" sub="Loaded from your font file">
                <span style={{ fontSize:13, fontFamily:`'${theme.font.customFontName}'`, color:'var(--accent)' }}>{theme.font.customFontName}</span>
                <button className="btn btn-sm btn-red" onClick={() => setNested('font', { customFontName: null, customFontPath: null })}>Remove</button>
              </Row>
            )}
          </Section>

          <Section title="Installed Custom Fonts" icon=" ">
            <div style={{ padding:'10px 0' }}>
              <button className="btn btn-primary btn-sm" onClick={installFont} style={{ marginBottom:12 }}>
                + Install Font (TTF / OTF / WOFF2)
              </button>
              {!installedFonts.length && (
                <div style={{ fontSize:12, color:'var(--text3)' }}>No custom fonts installed. Install a font file to use it across the whole UI.</div>
              )}
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {installedFonts.map(f => (
                  <div key={f.filename} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ flex:1, fontSize:14, fontFamily:`'${f.name}'` }}>{f.name}</span>
                    <span style={{ fontSize:11, color:'var(--text3)' }}>{f.ext.toUpperCase()}</span>
                    <button className="btn btn-primary btn-sm" onClick={() => setNested('font', { customFontName: f.name, customFontPath: f.path })}>
                      Use
                    </button>
                    <button className="btn btn-sm btn-red" onClick={() => removeFont(f.filename)}> </button>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        </div>
      )}

      {/*    BACKGROUND                                                          */}
      {tab === 'background' && (
        <div>
          <Section title="Background Type" icon=" ">
            <Row label="Type">
              <Select value={theme.background.type}
                options={[['solid','Solid Colour'],['gradient','Gradient'],['image','Image']]}
                onChange={v => set('background.type', v)} />
            </Row>

            {theme.background.type === 'solid' && (
              <Row label="Background colour">
                <ColorSwatch value={theme.background.color} onChange={v => set('background.color', v)} />
              </Row>
            )}

            {theme.background.type === 'gradient' && (
              <Row label="Gradient CSS" sub="Any valid CSS gradient">
                <input value={theme.background.gradient} onChange={e => set('background.gradient', e.target.value)}
                  style={{ width:300, fontFamily:'var(--font-mono)', fontSize:11 }} />
              </Row>
            )}

            {theme.background.type === 'image' && (
              <>
                <Row label="Background image" sub="JPG, PNG, WebP, GIF">
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {assets.bg && <img src={assets.bg} style={{ width:48, height:32, objectFit:'cover', borderRadius:4, border:'1px solid var(--border)' }} />}
                    <UploadBtn label="Upload Image" onClick={uploadBackground} hasValue={!!theme.background.imagePath}
                      onClear={() => setNested('background', { imagePath: null, type: 'solid' })} />
                  </div>
                </Row>
                <Row label="Blur" sub="Gaussian blur on the image">
                  <Slider value={theme.background.imageBlur} min={0} max={40} onChange={v => set('background.imageBlur', v)} unit="px" />
                </Row>
                <Row label="Image opacity">
                  <Slider value={Math.round(theme.background.imageOpacity * 100)} min={0} max={100} onChange={v => set('background.imageOpacity', v/100)} unit="%" />
                </Row>
                <Row label="Overlay colour">
                  <ColorSwatch value={theme.background.imageOverlayColor} onChange={v => set('background.imageOverlayColor', v)} />
                </Row>
                <Row label="Overlay opacity">
                  <Slider value={Math.round(theme.background.imageOverlayOpacity * 100)} min={0} max={100} onChange={v => set('background.imageOverlayOpacity', v/100)} unit="%" />
                </Row>
              </>
            )}
          </Section>
        </div>
      )}

      {/*    BRANDING                                                            */}
      {tab === 'branding' && (
        <div>
          <Section title="App Identity" icon=" ">
            <Row label="App name" sub="Shown in titlebar and window title">
              <input value={theme.branding.appName}
                onChange={e => set('branding.appName', e.target.value)}
                style={{ width:200 }} />
            </Row>
            <Row label="Show app name in titlebar">
              <Toggle value={theme.branding.showAppName} onChange={v => set('branding.showAppName', v)} />
            </Row>
            <Row label="Show logo in titlebar">
              <Toggle value={theme.branding.showLogo} onChange={v => set('branding.showLogo', v)} />
            </Row>
            <Row label="Logo size">
              <Slider value={theme.branding.logoSize} min={16} max={48} onChange={v => set('branding.logoSize', v)} unit="px" />
            </Row>
          </Section>

          <Section title="Images" icon=" ">
            <Row label="Logo" sub="PNG or SVG -- shown in titlebar / sidebar">
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {assets.logo && <img src={assets.logo} style={{ width:32, height:32, objectFit:'contain' }} />}
                <UploadBtn label="Upload Logo" onClick={uploadLogo} hasValue={!!theme.branding.logoPath}
                  onClear={() => setNested('branding', { logoPath: null })} />
              </div>
            </Row>
            <Row label="Taskbar Thumbnail" sub="Windows taskbar preview thumbnail">
              <UploadBtn label="Upload Thumbnail" onClick={uploadThumbnail} hasValue={!!theme.branding.thumbnailPath}
                onClear={() => setNested('branding', { thumbnailPath: null })} />
            </Row>
          </Section>
        </div>
      )}

      {/*    LAYOUT                                                              */}
      {tab === 'layout' && (
        <div>
          <Section title="Window" icon=" ">
            <Row label="Window style">
              <Select value={theme.window.style}
                options={[['frameless','Frameless (custom chrome)'],['native','Native OS chrome'],['glass','Frosted glass / acrylic']]}
                onChange={v => set('window.style', v)} />
            </Row>
            <Row label="Titlebar height">
              <Slider value={theme.window.titleBarHeight} min={28} max={60} onChange={v => set('window.titleBarHeight', v)} unit="px" />
            </Row>
            <Row label="Corner radius" sub="Window border radius (Win11 / macOS)">
              <Slider value={theme.window.borderRadius} min={0} max={20} onChange={v => set('window.borderRadius', v)} unit="px" />
            </Row>
            {theme.window.style === 'glass' && (
              <>
                <Row label="Glass blur radius">
                  <Slider value={theme.window.glassBlur} min={0} max={80} onChange={v => set('window.glassBlur', v)} unit="px" />
                </Row>
                <Row label="Glass opacity">
                  <Slider value={Math.round(theme.window.glassOpacity * 100)} min={20} max={100} onChange={v => set('window.glassOpacity', v/100)} unit="%" />
                </Row>
              </>
            )}
          </Section>

          <Section title="Sidebar" icon=" ">
            <Row label="Width">
              <Slider value={theme.sidebar.width} min={140} max={280} onChange={v => set('sidebar.width', v)} unit="px" />
            </Row>
            <Row label="Style">
              <Select value={theme.sidebar.style}
                options={[['dark','Dark'],['accent','Accent colour'],['transparent','Transparent'],['blur','Blur']]}
                onChange={v => set('sidebar.style', v)} />
            </Row>
            <Row label="Compact mode" sub="Smaller text and padding">
              <Toggle value={theme.sidebar.compact} onChange={v => set('sidebar.compact', v)} />
            </Row>
          </Section>

          <Section title="Icons" icon=" ">
            <Row label="Icon set">
              <Select value={theme.icons.set}
                options={[['lucide','Lucide (default)'],['material','Material Icons'],['custom','Custom SVG pack']]}
                onChange={v => set('icons.set', v)} />
            </Row>
            <Row label="Icon size">
              <Slider value={theme.icons.size} min={12} max={24} onChange={v => set('icons.size', v)} unit="px" />
            </Row>
            <Row label="Stroke width" sub="Lucide icons only">
              <Slider value={theme.icons.strokeWidth} min={1} max={3} step={0.25} onChange={v => set('icons.strokeWidth', v)} unit="px" />
            </Row>
          </Section>
        </div>
      )}

      {/*    MOTION                                                              */}
      {tab === 'motion' && (
        <div>
          <Section title="Animations" icon=" ">
            <Row label="Enable animations">
              <Toggle value={theme.motion.enabled} onChange={v => set('motion.enabled', v)} />
            </Row>
            <Row label="Animation speed" sub="1.0 = normal, 0.5 = fast, 2.0 = slow">
              <Slider value={theme.motion.speed} min={0.25} max={3} step={0.25} onChange={v => set('motion.speed', v)} />
            </Row>
            <Row label="Page transition">
              <Select value={theme.motion.pageTransition}
                options={[['fade','Fade'],['slide','Slide'],['scale','Scale'],['none','None']]}
                onChange={v => set('motion.pageTransition', v)} />
            </Row>
          </Section>
        </div>
      )}

      {/*    CUSTOM CSS                                                          */}
      {tab === 'custom' && (
        <div>
          <Section title="Custom CSS Injection" icon=" ">
            <div style={{ padding:'10px 0' }}>
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:8, lineHeight:1.6 }}>
                Write any valid CSS. Uses CSS variables like <code style={{ fontFamily:'var(--font-mono)', background:'var(--bg3)', padding:'1px 4px', borderRadius:3 }}>var(--accent)</code>.
                Applied after all other styles -- full override power.
              </div>
              <textarea
                value={theme.customCss}
                onChange={e => update({ customCss: e.target.value })}
                placeholder={`/* Example: hide scrollbars */\n::-webkit-scrollbar { display: none; }\n\n/* Make cards have a glow */\n.card {\n  box-shadow: 0 0 20px var(--accent-dim);\n}`}
                style={{
                  width: '100%', height: 260, fontFamily: 'var(--font-mono)', fontSize: 12,
                  background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)',
                  borderRadius: 8, padding: 12, resize: 'vertical', lineHeight: 1.7
                }}
              />
            </div>
          </Section>
        </div>
      )}

      {/*    Live preview strip                                                   */}
      <div className="card" style={{ padding:16 }}>
        <div style={{ fontSize:11, color:'var(--text3)', fontWeight:700, letterSpacing:'0.08em', marginBottom:12 }}>LIVE PREVIEW</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <button className="btn btn-primary btn-sm">Primary Button</button>
          <button className="btn btn-blue btn-sm">Secondary</button>
          <button className="btn btn-sm">Default</button>
          <button className="btn btn-red btn-sm">Danger</button>
          <span className="tag tag-amber">Accent Tag</span>
          <span className="tag tag-green">Success</span>
          <span className="tag tag-blue">Info</span>
          <span className="tag tag-red">Error</span>
          <span className="tag tag-gray">Neutral</span>
        </div>
        <div style={{ marginTop:10, display:'flex', gap:10 }}>
          <input placeholder="Text input preview" style={{ flex:1 }} />
          <select style={{ flex:0 }}><option>Select preview</option></select>
        </div>
        <div style={{ marginTop:10, fontFamily:'var(--font-sans)', fontSize:'var(--font-size)', color:'var(--text)' }}>
          Current font: <strong style={{ color:'var(--accent)' }}>{theme.font.customFontName || theme.font.sans.split(',')[0]}</strong>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text3)', marginLeft:12 }}>Monospace: 0x00FF ff</span>
        </div>
      </div>
    </div>
  )
}
