// Puente seguro entre la interfaz y Windows
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  readData: () => ipcRenderer.invoke('data:read'),
  writeData: (text) => ipcRenderer.invoke('data:write', text),
  writeDataSync: (text) => ipcRenderer.sendSync('data:writeSync', text),
  saveFile: (id, b64) => ipcRenderer.invoke('file:save', id, b64),
  readFile: (id) => ipcRenderer.invoke('file:read', id),
  deleteFile: (id) => ipcRenderer.invoke('file:delete', id),
  openFile: (id, name) => ipcRenderer.invoke('file:open', id, name),
  exportFile: (filename, text) => ipcRenderer.invoke('export:save', filename, text),
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
  setAutostart: (on) => ipcRenderer.invoke('autostart', on),
  setCloseToTray: (on) => ipcRenderer.invoke('closeToTray', on),
});
