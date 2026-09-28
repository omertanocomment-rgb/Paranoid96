/**
 * The page's way into the backend, with no network in between.
 *
 * The window used to load http://127.0.0.1:8787/ from a server this same app
 * had just started. That put a listening socket on the machine for a
 * conversation between two processes that already have a pipe between them,
 * and it meant the UI could not open unless that socket bound.
 *
 * Now the main process owns a Python child speaking JSON over stdin/stdout,
 * and this exposes it to the page as `window.OmertaNative` -- the same name
 * the Android app uses, so the UI has one native path rather than two.
 *
 * Context isolation stays ON. The page gets these functions and nothing else:
 * no ipcRenderer, no require, no Node. Each returns a Promise, because the
 * reply comes back over IPC.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('OmertaNative', {
  /** One request. Resolves to the JSON string {"status":..,"body":..}. */
  invoke: (method, path, body) =>
    ipcRenderer.invoke('omerta:request', method, path, body),

  /** Start a chunked upload. Resolves to JSON {"id":..} or {"error":..}. */
  attachBegin: (name, project, note) =>
    ipcRenderer.invoke('omerta:attach-begin', name, project, note),

  /** Append one base64 slice. */
  attachChunk: (uploadId, b64) =>
    ipcRenderer.invoke('omerta:attach-chunk', uploadId, b64),

  /** Finish and register the attachment. */
  attachEnd: (uploadId, size) =>
    ipcRenderer.invoke('omerta:attach-end', uploadId, size),

  /** Abandon a part-written upload. */
  attachAbort: (uploadId) =>
    ipcRenderer.invoke('omerta:attach-abort', uploadId),

  /** Is the backend process up and past its own start-up? */
  ready: () => ipcRenderer.invoke('omerta:ready'),

  /** Why it is not, or an empty string. */
  lastError: () => ipcRenderer.invoke('omerta:last-error'),
});
