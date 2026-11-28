// Puente de la carita chiquita (ventana flotante del PC)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bubble', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onLevel: (cb) => ipcRenderer.on('level', (_e, l) => cb(l)),
  close: () => ipcRenderer.send('bubble:close'),
  expand: () => ipcRenderer.send('bubble:expand'),
  move: (dx, dy) => ipcRenderer.send('bubble:move', dx, dy),
  mouse: (ignore) => ipcRenderer.send('bubble:mouse', ignore),
});
