// preload.js — puente seguro entre renderer y main
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { STATES } = require('./enhance');

contextBridge.exposeInMainWorld('api', {
  // contrato de estados compartido con el motor (premiere-plugin/js/phonos.js)
  STATES,
  // Electron ≥32 eliminó File.path: la ruta de un archivo arrastrado se obtiene acá.
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  connectAdobe: () => ipcRenderer.invoke('connect-adobe'),
  tokenStatus: () => ipcRenderer.invoke('token-status'),
  getQueue: () => ipcRenderer.invoke('get-queue'),
  saveQueue: (q) => ipcRenderer.invoke('save-queue', q),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  startBatch: (payload) => ipcRenderer.invoke('start-batch', payload),
  stopBatch: () => ipcRenderer.invoke('stop-batch'),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  onStatus: (cb) => ipcRenderer.on('status', (_e, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on('done', (_e, d) => cb(d)),
  onLimit: (cb) => ipcRenderer.on('limit', (_e, d) => cb(d)),
  onLimitClear: (cb) => ipcRenderer.on('limit-clear', (_e, d) => cb(d)),
  onConn: (cb) => ipcRenderer.on('conn', (_e, d) => cb(d)),
  onAuthExpired: (cb) => ipcRenderer.on('auth-expired', (_e, d) => cb(d)),
});
