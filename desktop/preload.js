const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setOpacity: (value) => ipcRenderer.invoke('set-opacity', value),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('set-always-on-top', value),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window')
});
