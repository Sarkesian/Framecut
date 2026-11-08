const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('node:path');
const { startServer } = require('./server.cjs');
let service;
app.whenReady().then(async () => {
  if (process.env.FRAMECUT_TEST_DIR) app.setPath('userData', process.env.FRAMECUT_TEST_DIR);
  service = await startServer({ dataDir: path.join(app.getPath('userData'), 'workspace'), saveDialog: async (name) => {
    const result = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('videos'), name) });
    return result.canceled ? null : result.filePath;
  }});
  const win = new BrowserWindow({ show: !process.env.FRAMECUT_TEST, width: 1480, height: 960, minWidth: 1080, minHeight: 740, backgroundColor: '#101315', title: 'FrameCut Studio', autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(service.url + '/')) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  await win.loadURL(service.url);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => service?.close());
