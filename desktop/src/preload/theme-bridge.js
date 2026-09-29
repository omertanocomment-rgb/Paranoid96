/**
 * OMERTA THEME -- Preload Bridge Additions
 * Add this `theme` object to your contextBridge.exposeInMainWorld call.
 *
 * Usage in preload/index.js:
 *   contextBridge.exposeInMainWorld('ft', {
 *     ...existingApis,
 *     theme: themeBridge,
 *   })
 */

import { ipcRenderer } from 'electron'
const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a)
const on     = (ch, cb) => { ipcRenderer.on(ch, (_, d) => cb(d)); return () => ipcRenderer.removeAllListeners(ch) }

export const themeBridge = {
  // Core
  get:      ()    => invoke('theme:get'),
  defaults: ()    => invoke('theme:defaults'),
  set:      patch => invoke('theme:set', patch),
  reset:    ()    => invoke('theme:reset'),

  // Import / Export
  export: () => invoke('theme:export'),
  import: () => invoke('theme:import'),

  // Font management
  fontsList:    ()         => invoke('theme:fonts:list'),
  fontsInstall: ()         => invoke('theme:fonts:install'),
  fontsRemove:  filename   => invoke('theme:fonts:remove', filename),
  fontsDir:     ()         => invoke('theme:fonts:dir'),
  fontRead:     filename   => invoke('theme:fonts:read', filename),

  // Asset uploads
  uploadLogo:       () => invoke('theme:upload:logo'),
  uploadBackground: () => invoke('theme:upload:background'),
  uploadThumbnail:  () => invoke('theme:upload:thumbnail'),
  uploadFavicon:    () => invoke('theme:upload:favicon'),

  // Read asset as base64
  assetRead: filePath => invoke('theme:asset:read', filePath),

  // Live updates listener
  onChange: cb => on('theme:current', cb),
}
