/**
 * OMERTA - Patch renderer for web mode
 * Run: node termux/patch-renderer.js
 * Patches out/renderer/index.html to inject the web preload bridge.
 * Run this after every build:linux to make the web version work.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const htmlPath = join(ROOT, 'out', 'renderer', 'index.html')
const preloadPath = join(__dirname, 'preload-web.js')
const preloadDest = join(ROOT, 'out', 'renderer', 'preload-web.js')

if (!existsSync(htmlPath)) {
  console.error('ERROR: out/renderer/index.html not found.')
  console.error('Run: npm run build:linux  (or electron-vite build) first.')
  process.exit(1)
}

// Copy preload-web.js into renderer output
copyFileSync(preloadPath, preloadDest)

let html = readFileSync(htmlPath, 'utf8')

// Remove any previous injection
html = html.replace(/<!-- OMERTA WEB BRIDGE -->[\s\S]*?<!-- END OMERTA WEB BRIDGE -->/g, '')

// Inject before closing </head>
const injection = `<!-- OMERTA WEB BRIDGE -->
  <script src="/preload-web.js"></script>
<!-- END OMERTA WEB BRIDGE -->`

if (html.includes('</head>')) {
  html = html.replace('</head>', `  ${injection}\n</head>`)
} else {
  html = injection + html
}

writeFileSync(htmlPath, html)
console.log('[OK] Patched out/renderer/index.html with web bridge')
console.log('[OK] Copied preload-web.js to renderer output')
console.log('')
console.log('Now start the server:')
console.log('  node termux/server.js')
console.log('  # or in Termux:')
console.log('  bash termux/start.sh')
