const { app, BrowserWindow, dialog, shell, ipcMain, screen, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { startServer } = require('./server.cjs');
const P = require('./paths.cjs');
const { readJsonSync, writeJsonSync } = require('./jsonstore.cjs');

let service, win;
const testDir = process.env.FRAMECUT_TEST_DIR;
// Everything FrameCut writes lives in <install folder>\data (see paths.cjs). Tests use their own folder.
const root = P.appRoot({ packaged: app.isPackaged, execPath: process.execPath, devRoot: path.join(__dirname, '..', '.workspace', 'app') });
const L = P.layout(testDir || path.join(root, 'data'));
const rootProblem = P.writableProblem(L.dataDir);
if (!rootProblem) {
  for (const d of [L.profile, L.logs]) fs.mkdirSync(d, { recursive: true });
  P.resetTemp(L.temp);
  app.setPath('userData', L.profile); app.setPath('sessionData', L.profile); app.setPath('temp', L.temp);
  app.setPath('crashDumps', path.join(L.logs, 'crashes')); app.setAppLogsPath(L.logs);
  // Node, Chromium and every tool we start (FFmpeg, Python, pip) put temporary files in data\temp.
  Object.assign(process.env, { TEMP: L.temp, TMP: L.temp });
}
const README = [
  'This folder holds everything FrameCut Studio manages, so the app needs nothing else on this computer.',
  '',
  '  projects        your projects (unless you chose another folder in Preferences > Storage)',
  '  media           recordings, downloaded music/stickers/sound effects and processed audio',
  '  templates, fonts, luts, media.json, creative.json   things your projects use',
  '  profile         settings, window layout, saved credentials and the built-in AI model cache',
  '  engines         the accurate caption engine and its AI models (downloaded on first use)',
  '  cache, temp, logs   rebuildable thumbnails, waveforms and playback copies; safe to clear',
  '',
  'Updates never change this folder. Uninstalling keeps your projects and media unless you choose',
  'Complete removal and confirm deleting them.',
].join('\r\n');
if (!rootProblem && !testDir) try { fs.writeFileSync(path.join(L.dataDir, 'README.txt'), README); } catch {}
if (process.env.FRAMECUT_FAKE_MEDIA) { app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); }
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!rootProblem && !testDir && !app.requestSingleInstanceLock()) app.quit();

const configPath = () => path.join(L.dataDir, 'framecut-config.json');
// The config holds a custom projects folder; losing it would make every project there seem to vanish, so it
// is written atomically and read with a fallback to the last good copy.
function readConfig() { try { const { value } = readJsonSync(configPath(), null, { keepBackup: false }); return value && typeof value === 'object' ? P.fromStored(value, L.dataDir) : {}; } catch { return {}; } }
function writeConfig(c) { const file = configPath(); writeJsonSync(file, P.toStored(c, L.dataDir), 2); try { fs.copyFileSync(file, file + '.bak'); } catch {} }
const projectsDir = () => readConfig().projectsDir || L.projects;

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
  ipcMain.handle('get-storage', () => ({ dataDir: L.dataDir, projectsDir: projectsDir(), defaultProjectsDir: L.projects }));
  // Projects may live anywhere the user likes (another drive, a synced folder). Moving them carries every
  // project folder across; nothing is overwritten and the originals are removed only after a full copy.
  ipcMain.handle('set-storage', (_e, { projectsDir: next } = {}) => {
    const from = projectsDir(), to = path.resolve(String(next || L.projects));
    if (to.toLowerCase() === from.toLowerCase()) return { projectsDir: from };
    const problem = P.writableProblem(to); if (problem) throw Error(`FrameCut can’t write to ${to} (${problem}). Choose a folder in your user profile or on another drive.`);
    const rel = path.relative(from, to);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) throw Error('Choose a folder outside the current projects folder.');
    // Project folders are small (media stays where it is), so: copy everything, switch, then remove the
    // originals. If any copy fails, the copies made so far are removed and nothing changes.
    const kept = [], copied = [];
    for (const name of fs.existsSync(from) ? fs.readdirSync(from) : []) {
      const src = path.join(from, name), dst = path.join(to, name);
      // Same name already there: leave both untouched (never merge or overwrite) and report it.
      if (fs.existsSync(dst)) { if (!name.startsWith('.')) kept.push(name); continue; }
      try { fs.cpSync(src, dst, { recursive: true, errorOnExist: true, force: false }); copied.push(name); }
      catch (e) {
        for (const n of [...copied, name]) try { fs.rmSync(path.join(to, n), { recursive: true, force: true }); } catch {}
        throw Error(`Moving projects failed (${e.code || e.message}). Nothing was changed; your projects are still in ${from}.`);
      }
    }
    const cfg = readConfig(); if (to === L.projects) delete cfg.projectsDir; else cfg.projectsDir = to; writeConfig(cfg);
    for (const n of copied) try { fs.rmSync(path.join(from, n), { recursive: true, force: true }); } catch {}
    return { projectsDir: to, keptInOldFolder: kept.length ? { folder: from, count: kept.length } : null };
  });
  ipcMain.handle('open-data-folder', () => shell.openPath(L.dataDir));
  ipcMain.handle('relaunch', () => { app.relaunch(); app.quit(); }); // quit (not exit) so the service shuts down cleanly
  ipcMain.handle('set-title-colors', (_e, { color, symbolColor }) => { try { win.setTitleBarOverlay({ color, symbolColor, height: 40 }); } catch {} });
  ipcMain.handle('toggle-fullscreen', () => win.setFullScreen(!win.isFullScreen()));
}
// Provider credentials, encrypted with the OS credential store (DPAPI on Windows). Never in the UI bundle.
function secretStore() {
  const file = path.join(L.profile, 'secrets.bin');
  const read = () => { try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(file))); } catch { return {}; } };
  return {
    available: () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } },
    get: name => read()[name] ?? null,
    set(name, value) { const all = read(); if (value === null || value === undefined) delete all[name]; else all[name] = value; fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(all))); },
  };
}
// One-time import from the old portable FrameCut, which kept its workspace in %APPDATA%. Copies only;
// the old folder is left untouched (it belongs to that copy of FrameCut).
function importLegacyWorkspace() {
  if (testDir || fs.existsSync(path.join(L.dataDir, 'preferences.json')) || fs.existsSync(path.join(L.dataDir, 'media.json'))) return;
  const old = ['framecut-studio', 'FrameCut Studio'].map(n => path.join(app.getPath('appData'), n, 'workspace')).find(d => fs.existsSync(path.join(d, 'projects')));
  if (!old) return;
  try {
    for (const name of ['projects', 'media', 'fonts', 'luts', 'templates']) { const src = path.join(old, name); if (fs.existsSync(src)) fs.cpSync(src, path.join(L.dataDir, name), { recursive: true, force: false, errorOnExist: false }); }
    for (const name of ['preferences.json', 'media.json', 'creative.json']) {
      const src = path.join(old, name); if (!fs.existsSync(src)) continue;
      // Re-point paths that were inside the old workspace at the copies in data\.
      const moved = P.fromStored(P.toStored(JSON.parse(fs.readFileSync(src, 'utf8')), old), L.dataDir);
      fs.writeFileSync(path.join(L.dataDir, name), JSON.stringify(P.toStored(moved, L.dataDir), null, 1));
    }
    console.log('Imported the previous FrameCut workspace from', old);
  } catch (e) { console.error('Importing the previous FrameCut workspace failed:', e.message); }
}

app.whenReady().then(async () => {
  if (rootProblem) {
    dialog.showErrorBox('FrameCut Studio can’t start from this folder', `FrameCut keeps its settings, models and projects next to the app, so its folder must be writable:

${L.dataDir}

Protected folders such as Program Files and Windows can’t be used. Reinstall FrameCut Studio into a folder in your user profile (the installer’s default) or on another drive, for example D:\\Apps\\FrameCut Studio.

(${rootProblem})`);
    return app.exit(1);
  }
  registerIpc();
  importLegacyWorkspace();
  const cfg = readConfig();
  service = await startServer({ dataDir: L.dataDir, cacheDir: L.cache, projectsDir: projectsDir(), native: true, secrets: secretStore() });
  const bounds = cfg.window && screen.getAllDisplays().some(d => { const a = d.workArea; return cfg.window.x >= a.x - 50 && cfg.window.y >= a.y - 50 && cfg.window.x < a.x + a.width && cfg.window.y < a.y + a.height; }) ? cfg.window : { width: 1560, height: 960 };
  win = new BrowserWindow({
    ...bounds, show: false, minWidth: 1100, minHeight: 700, backgroundColor: '#0e0f13', title: 'FrameCut Studio', icon: path.join(__dirname, 'icon.ico'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0e0f13', symbolColor: '#c9ccd6', height: 40 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs'), spellcheck: false, backgroundThrottling: false },
  });
  if (cfg.maximized && !testDir) win.maximize();
  win.once('ready-to-show', () => { if (!process.env.FRAMECUT_TEST) win.show(); });
  const saveBounds = () => { if (testDir) return; const c = readConfig(); c.maximized = win.isMaximized(); if (!win.isMaximized() && !win.isFullScreen()) c.window = win.getBounds(); writeConfig(c); };
  win.on('resize', debounce(saveBounds, 600)); win.on('move', debounce(saveBounds, 600));
  // Closing asks the editor first: it flushes the autosave and warns about anything that would be lost
  // (a failed save, a recording or an export in progress). A hung or crashed page never blocks quitting.
  let allowClose = false, asking = false, hung = false;
  win.webContents.on('unresponsive', () => { hung = true; }); win.webContents.on('responsive', () => { hung = false; });
  win.on('close', e => {
    saveBounds();
    if (allowClose || testDir || hung || win.webContents.isCrashed()) return;
    e.preventDefault(); if (asking) return; asking = true;
    win.webContents.executeJavaScript('window.__framecutCanClose ? window.__framecutCanClose() : true', true)
      .then(ok => { asking = false; if (ok !== false) { allowClose = true; win.close(); } })
      .catch(() => { asking = false; allowClose = true; win.close(); });
  });
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
  // Reload after a renderer crash, but don't spin forever if the page crashes on every load.
  const crashes = [];
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit' || win.isDestroyed()) return;
    const now = Date.now(); crashes.push(now); while (crashes.length && now - crashes[0] > 60e3) crashes.shift();
    if (crashes.length <= 3) return setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 300);
    dialog.showErrorBox('FrameCut Studio stopped working', `The editor crashed repeatedly (${d.reason}). Your project is autosaved; restart FrameCut Studio to continue. Details are in ${L.logs}.`);
    app.quit();
  });
  await win.loadURL(service.url);
});
function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
// Quitting waits (briefly) for the service to stop recordings and write its indexes; otherwise a media
// import or finished take from the last moments could be missing from media.json next time.
let closing = null;
app.on('before-quit', e => {
  if (!service || closing === 'done') return;
  e.preventDefault(); if (closing) return;
  closing = Promise.race([service.close(), new Promise(r => setTimeout(r, 5000))])
    .catch(err => console.error('Shutting down the FrameCut service failed:', err.message))
    .finally(() => { closing = 'done'; app.quit(); });
});
// Leave data\temp empty when FrameCut closes.
app.on('quit', () => { if (!rootProblem) try { fs.rmSync(L.temp, { recursive: true, force: true }); } catch {} });
