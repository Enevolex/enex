const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  getSources: () => ipcRenderer.invoke('picker:get-sources'),
  choose: (id) => ipcRenderer.send('picker:choose', id)
});
