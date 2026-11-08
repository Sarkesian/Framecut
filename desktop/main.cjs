const { app, BrowserWindow, dialog, shell, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { startServer } = require('./server.cjs');

let service, win;
const testDir = process.env.FRAMECUT_TEST_DIR;
if (testDir) app.setPath('userData', testDir);
if (process.env.FRAMECUT_FAKE_MEDIA) { app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); }
if (!testDir && !app.requestSingleInstanceLock()) app.quit();

const configPath = () => path.join(app.getPath('userData'), 'framecut-config.json');
function readConfig() { try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; } }
function writeConfig(c) { fs.writeFileSync(configPath(), JSON.stringify(c, null, 2)); }

const MEDIA_FILTERS = [
  { name: 'Media', extensions: ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', 'mxf', 'mp3', 'wav', 'aac', 'ogg', 'opus', 'flac', 'm4a', 'wma', 'aif', 'aiff', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tif', 'tiff'] },
  { name: 'All files', extensions: ['*'] },
];

function registerIpc() {
  ipcMain.handle('open-media', async () => (await dialog.showOpenDialog(win, { title: 'Import media', properties: ['openFile', 'multiSelections'], filters: MEDIA_FILTERS })).filePaths);
  ipcMain.handle('open-files', async (_e, { title, filters, multi }) => (await dialog.showOpenDialog(win, { title, properties: ['openFile', ...(multi ? ['multiSelections'] : [])], filters })).filePaths);
  ipcMain.handle('choose-folder', async (_e, { title, defaultPath } = {}) => (await dialog.showOpenDialog(win, { title: title || 'Choose a folder', defaultPath, properties: ['openDirectory', 'createDirectory'] })).filePaths[0] || null);
  ipcMain.handle('save-file', async (_e, { title, defaultPath, filters }) => { const r = await dialog.showSaveDialog(win, { title, defaultPath, filters }); return r.canceled ? null : r.filePath; });
  ipcMain.handle('show-in-folder', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });
  ipcMain.handle('open-path', (_e, p) => (typeof p === 'string' && fs.existsSync(p) ? shell.openPath(p) : 'Not found'));
  ipcMain.handle('get-storage', () => ({ ...defaults(), ...readConfig() }));
  ipcMain.handle('set-storage', (_e, next) => {
    const cfg = readConfig(), old = { ...defaults(), ...cfg };
    const target = { dataDir: next.dataDir || old.dataDir, cacheDir: next.cacheDir || old.cacheDir };
    // Carry small, important files to a new data location; media stays where it is (it is referenced by path).
    if (target.dataDir !== old.dataDir) {
      fs.mkdirSync(target.dataDir, { recursive: true });
      for (const name of ['projects', 'fonts', 'luts', 'templates']) { const src = path.join(old.dataDir, name); if (fs.existsSync(src)) fs.cpSync(src, path.join(target.dataDir, name), { recursive: true, force: false, errorOnExist: false }); }
      for (const name of ['media.json', 'preferences.json']) { const src = path.join(old.dataDir, name), dst = path.join(target.dataDir, name); if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst); }
    }
    writeConfig({ ...cfg, ...target }); return target;
  });
  ipcMain.handle('relaunch', () => { app.relaunch(); app.exit(0); });
  ipcMain.handle('set-title-colors', (_e, { color, symbolColor }) => { try { win.setTitleBarOverlay({ color, symbolColor, height: 40 }); } catch {} });
  ipcMain.handle('toggle-fullscreen', () => win.setFullScreen(!win.isFullScreen()));
}
function defaults() { const ud = app.getPath('userData'); return { dataDir: path.join(ud, 'workspace'), cacheDir: path.join(ud, 'workspace', 'cache') }; }

app.whenReady().then(async () => {
  registerIpc();
  const cfg = { ...defaults(), ...readConfig() };
  service = await startServer({ dataDir: cfg.dataDir, cacheDir: cfg.cacheDir, native: true });
  const bounds = cfg.window && screen.getAllDisplays().some(d => { const a = d.workArea; return cfg.window.x >= a.x - 50 && cfg.window.y >= a.y - 50 && cfg.window.x < a.x + a.width && cfg.window.y < a.y + a.height; }) ? cfg.window : { width: 1560, height: 960 };
  win = new BrowserWindow({
    ...bounds, show: false, minWidth: 1100, minHeight: 700, backgroundColor: '#0e0f13', title: 'FrameCut Studio', icon: path.join(__dirname, 'icon.ico'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0e0f13', symbolColor: '#c9ccd6', height: 40 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs'), spellcheck: false, backgroundThrottling: false },
  });
  if (cfg.maximized && !testDir) win.maximize();
  win.once('ready-to-show', () => { if (!process.env.FRAMECUT_TEST) win.show(); });
  const saveBounds = () => { if (testDir) return; const c = readConfig(); c.maximized = win.isMaximized(); if (!win.isMaximized() && !win.isFullScreen()) c.window = win.getBounds(); writeConfig(c); };
  win.on('resize', debounce(saveBounds, 600)); win.on('move', debounce(saveBounds, 600)); win.on('close', saveBounds);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url) && !url.startsWith(service.url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(service.url + '/')) event.preventDefault(); });
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const local = details.requestingUrl?.startsWith(service.url);
    if (local && permission === 'media' && (details.mediaTypes || []).every(t => t === 'audio')) return callback(true);
    if (local && ['clipboard-sanitized-write', 'fullscreen'].includes(permission)) return callback(true);
    callback(false);
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => origin?.startsWith(service.url) && ['media', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  win.webContents.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') setTimeout(() => win.reload(), 300); });
  await win.loadURL(service.url);
});
function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => service?.close());
