const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('framecut', {
  native: true,
  pathForFile: file => { try { return webUtils.getPathForFile(file) || null; } catch { return null; } },
  openMedia: () => ipcRenderer.invoke('open-media'),
  openFiles: opts => ipcRenderer.invoke('open-files', opts),
  chooseFolder: opts => ipcRenderer.invoke('choose-folder', opts),
  saveFile: opts => ipcRenderer.invoke('save-file', opts),
  showInFolder: p => ipcRenderer.invoke('show-in-folder', p),
  openPath: p => ipcRenderer.invoke('open-path', p),
  getStorage: () => ipcRenderer.invoke('get-storage'),
  setStorage: s => ipcRenderer.invoke('set-storage', s),
  relaunch: () => ipcRenderer.invoke('relaunch'),
  setTitleColors: c => ipcRenderer.invoke('set-title-colors', c),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
});
