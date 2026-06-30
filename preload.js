'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit IPC surface exposed to the renderer. No Node access leaks.
contextBridge.exposeInMainWorld('mm', {
  openFile: () => ipcRenderer.invoke('open-file'),
  saveFile: (payload) => ipcRenderer.invoke('save-file', payload),
  saveFileAs: (payload) => ipcRenderer.invoke('save-file-as', payload),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  setTitle: (title) => ipcRenderer.invoke('set-title', title),
  // Files handed to us from the command line at startup.
  onFileOpened: (cb) =>
    ipcRenderer.on('file-opened', (_evt, data) => cb(data))
});
