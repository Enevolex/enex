const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  getState: () => ipcRenderer.invoke('studio:get-state'),
  set: (patch) => ipcRenderer.invoke('studio:set', patch),
  pickWallpaper: () => ipcRenderer.invoke('studio:pick-wallpaper'),
  testDpi: () => ipcRenderer.invoke('studio:dpi-test'),
  researchDpi: () => ipcRenderer.invoke('studio:dpi-research'),
  onDpi: (fn) => ipcRenderer.on('studio:dpi', (_e, s) => fn(s)),
  onState: (fn) => ipcRenderer.on('studio:state', (_e, s) => fn(s))
});
