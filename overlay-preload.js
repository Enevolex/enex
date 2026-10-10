// Oyun içi arayüz penceresinin ön yükleyicisi: ana süreçten gelen veriyi sayfaya iletir.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onConfig: (fn) => ipcRenderer.on('overlay:config', (_e, c) => fn(c)),
  onVoice: (fn) => ipcRenderer.on('overlay:voice', (_e, v) => fn(v)),
  onToast: (fn) => ipcRenderer.on('overlay:toast', (_e, t) => fn(t)),
  reportSize: (s) => ipcRenderer.send('overlay:size', s)
});
