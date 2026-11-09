// Installer lifecycle on this machine with the real packaged installer:
//   protected folder refused → install to a secondary drive path with spaces → use the app (project,
//   import, export) → nothing written outside the install folder → upgrade keeps data → Standard
//   uninstall keeps projects → Complete removal (keep projects) → Complete removal with a running app
//   and deleting projects → no FrameCut files, shortcuts or registry entries left.
//
//   node tests/install-journey.cjs [release/FrameCutStudio-Setup.exe] [next-version-setup.exe]
//   FRAMECUT_INSTALL_DIR overrides the install folder (default: test-output\install test\Apps\FrameCut Studio)
const { _electron: electron } = require('playwright');
const { spawnSync, execFileSync } = require('node:child_process');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const { run, ffmpeg } = require('../desktop/tools.cjs');

const SETUP = path.resolve(process.argv[2] || 'release/FrameCutStudio-Setup.exe');
const NEXT = process.argv[3] ? path.resolve(process.argv[3]) : null;
const DIR = path.resolve(process.env.FRAMECUT_INSTALL_DIR || 'test-output/install test/Apps/FrameCut Studio');
const EXE = path.join(DIR, 'FrameCut Studio.exe'), UNINST = path.join(DIR, 'Uninstall FrameCut Studio.exe');
const WORK = path.resolve('test-output/install test/work');
const step = n => console.log('· ' + n);
const env = process.env, home = os.homedir();
const shellFolder = name => { try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', `[Environment]::GetFolderPath('${name}')`]).toString().trim(); } catch { return null; } };
const DESKTOP = shellFolder('DesktopDirectory'), DOCS = shellFolder('MyDocuments');
const STARTMENU = path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Everything outside the install folder where an app could leave files or registrations.
function snapshot() {
  const ls = d => { try { return fs.readdirSync(d).map(n => path.join(d, n)); } catch { return []; } };
  const reg = key => { try { return execFileSync('reg', ['query', key], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/).filter(l => l.startsWith('HKEY_')); } catch { return []; } };
  return new Set([
    ...[env.APPDATA, env.LOCALAPPDATA, path.join(env.LOCALAPPDATA, 'Programs'), env.ProgramData, DOCS, DESKTOP, STARTMENU, home, os.tmpdir()].flatMap(ls),
    ...['HKCU\\Software', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU\\Software\\Classes', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'].flatMap(reg),
  ]);
}
const added = (before, after) => [...after].filter(x => !before.has(x));
// Additions that look like FrameCut's (temp noise from other programs is ignored unless it names us).
// Test runs in other FrameCut checkouts make mkdtemp folders (framecut-<name>-XXXXXX) in the system temp
// folder; the installed app never writes there, so those are not counted as leaks.
const otherTests = x => path.dirname(x).toLowerCase() === os.tmpdir().toLowerCase() && /^(framecut|fc)-[\w-]+-[A-Za-z0-9]{6}$/.test(path.basename(x));
const ours = list => list.filter(x => !otherTests(x)).filter(x => /framecut|frame cut|ns[a-z]?\w*\.tmp|~nsu|electron/i.test(path.basename(x)) || /\{[0-9a-f-]{36}\}$/i.test(x) && /Uninstall/.test(x));

function runInstaller(exe, args) {
  const r = spawnSync(`"${exe}" ${args}`, { shell: true, windowsHide: true, stdio: 'inherit' });
  return r.status;
}
// The full Uninstall registry entry for FrameCut Studio ('' when not installed).
const uninstallKey = () => {
  const q = args => { try { return execFileSync('reg', ['query', ...args], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return ''; } };
  const key = q(['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', 'FrameCut Studio', '/d']).split(/\r?\n/).find(l => l.startsWith('HKEY_'));
  return key ? q([key]) : '';
};
async function uninstall(args = '') {
  // The uninstaller copies itself to %TEMP% and returns at once; wait for that copy to finish.
  const code = runInstaller(UNINST, `/S ${args}`.trim()); assert.equal(code, 0, 'uninstaller exit code');
  for (let i = 0; i < 240; i++) {
    const busy = execFileSync('tasklist', ['/FO', 'CSV', '/NH']).toString().split(/\r?\n/).some(l => /^"Un_[A-Z]\.exe"/i.test(l));
    if (!busy && !fs.existsSync(EXE)) return;
    await sleep(500);
  }
  throw Error('Uninstaller did not finish in 2 minutes');
}
const exists = rel => fs.existsSync(path.join(DIR, rel));
const lnk = () => [DESKTOP && path.join(DESKTOP, 'FrameCut Studio.lnk'), path.join(STARTMENU, 'FrameCut Studio.lnk')].filter(Boolean);

const opened = new Set();
async function openApp(extraEnv = {}) {
  const e = { ...process.env, FRAMECUT_TEST: '1', FRAMECUT_NO_IMPORT: '1', ...extraEnv }; delete e.FRAMECUT_TEST_DIR; delete e.ELECTRON_RUN_AS_NODE;
  for (const [k, v] of Object.entries(e)) if (v === null) delete e[k];
  const app = await electron.launch({ executablePath: EXE, args: [], env: e }); opened.add(app);
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1500, height: 920 });
  await page.getByText('New project').first().waitFor({ timeout: 60000 });
  return { app, page };
}
// Close the window like a user does (Playwright's close() kills the process, skipping FrameCut's quit cleanup).
async function closeApp(app) {
  const proc = app.process(), exited = proc.exitCode !== null ? Promise.resolve() : new Promise(r => proc.once('exit', r));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.close())).catch(() => {});
  await Promise.race([exited, sleep(20000)]); await app.close().catch(() => {}); await sleep(500);
}

(async () => {
  assert.ok(fs.existsSync(SETUP), 'installer not found: ' + SETUP);
  assert.ok(!fs.existsSync(DIR) || !fs.readdirSync(DIR).length, 'install folder must start empty: ' + DIR);
  assert.equal(uninstallKey(), '', 'FrameCut Studio is already installed for this user; uninstall it first');
  fs.mkdirSync(WORK, { recursive: true });
  const clip = path.join(WORK, 'Beach day.mp4');
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
  const base = snapshot();

  step('a protected folder is refused (silent install into Program Files)');
  const pf = path.join(env.ProgramFiles, 'FrameCut Install Test');
  assert.equal(runInstaller(SETUP, `/S /D=${pf}`), 2, 'installer must refuse Program Files');
  assert.ok(!fs.existsSync(pf), 'nothing created in Program Files');

  step(`install to ${DIR}`);
  assert.equal(runInstaller(SETUP, `/S /D=${DIR}`), 0);
  for (const rel of ['FrameCut Studio.exe', 'Uninstall FrameCut Studio.exe', 'resources/app.asar', 'resources/python/python.exe', 'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe', 'resources/app.asar.unpacked/desktop/bin/framecut-audio.exe']) assert.ok(exists(rel), 'missing ' + rel);
  assert.ok(!exists('resources/app.asar.unpacked/node_modules/ffprobe-static/bin/darwin'), 'only Windows binaries are installed');
  for (const l of lnk()) assert.ok(fs.existsSync(l), 'shortcut ' + l);
  assert.match(uninstallKey(), /FrameCut Studio/);
  assert.ok(!fs.existsSync(path.join(env.LOCALAPPDATA, 'framecut-studio-updater')), 'no installer copy in LocalAppData');
  execFileSync(path.join(DIR, 'resources/python/python.exe'), ['-I', '-c', 'import venv, ensurepip, ssl, sqlite3']);

  // The old portable FrameCut kept its workspace in %APPDATA%; the first start imports a copy of it.
  const legacy = ['framecut-studio', 'FrameCut Studio'].map(n => path.join(env.APPDATA, n, 'workspace')).find(d => fs.existsSync(path.join(d, 'projects')));
  if (legacy) {
    step('first start imports the old portable workspace (copy only)');
    const want = fs.readdirSync(path.join(legacy, 'projects')).filter(n => !n.startsWith('.')).length;
    let { app } = await openApp({ FRAMECUT_NO_IMPORT: null });
    await closeApp(app);
    assert.equal(fs.readdirSync(path.join(DIR, 'data/projects')).filter(n => !n.startsWith('.')).length, want, 'projects imported');
    assert.ok(fs.existsSync(path.join(legacy, 'projects')), 'old workspace left in place');
  }

  step('use the installed app: project, import, export');
  const out = path.join(WORK, 'exports', 'Beach day.mp4');
  let { app, page } = await openApp();
  const health = await page.evaluate(() => window.__fc.api('/api/health'));
  assert.ok(health.ffmpeg && health.ffprobe, 'bundled FFmpeg/FFprobe');
  assert.equal(path.resolve(health.dataDir).toLowerCase(), path.join(DIR, 'data').toLowerCase());
  const engine = await page.evaluate(() => window.__fc.api('/api/captions/engine?refresh=1'));
  assert.ok(engine.ready || /GB/.test(engine.download || ''), 'caption engine is ready or offers its one-time setup');
  await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
  await page.evaluate(async f => { const { state, api, edit } = window.__fc; const r = await api('/api/media/import', { paths: [f] }); await state.refreshMedia(); edit.addAssets([r.assets[0]], { at: 0 }); }, clip);
  await page.waitForFunction(() => window.__fc.state.project.value.clips.length > 0);
  await page.keyboard.press('Control+e');
  await page.waitForFunction(() => document.querySelector('.modal input[aria-label="Output file"]')?.value);
  await page.locator('.modal input[aria-label="Output file"]').fill(out);
  await page.locator('.modal-foot .btn.primary').click();
  await page.getByText('Your video is ready').waitFor({ timeout: 180000 });
  assert.ok(fs.statSync(out).size > 10000, 'export written');
  const projectId = await page.evaluate(() => window.__fc.state.project.value.id);
  await page.evaluate(() => window.__fc.state.flush?.());
  await sleep(1500);
  await closeApp(app);
  for (const rel of ['data/profile', 'data/cache', 'data/projects/' + projectId, 'data/media.json', 'data/preferences.json', 'data/README.txt']) assert.ok(exists(rel), 'expected ' + rel);
  assert.ok(!JSON.stringify(JSON.parse(fs.readFileSync(path.join(DIR, 'data/media.json'), 'utf8'))).includes(path.join(DIR, 'data').replace(/\\/g, '\\\\')), 'internal paths are stored relative');
  assert.deepEqual(fs.readdirSync(path.join(DIR, 'data/temp')).filter(n => !n.startsWith('.')), [], 'temp emptied on quit');
  const leaked = ours(added(base, snapshot())).filter(x => !lnk().includes(x) && !/Uninstall\\/.test(x) && !/Software\\(Classes\\)?\{?[0-9a-f-]{36}/i.test(x));
  const knownInstall = added(base, snapshot()).filter(x => /^HKEY_CURRENT_USER\\Software\\[0-9a-f-]{36}$/i.test(x));
  console.log('  registry written by the installer:', knownInstall);
  assert.deepEqual(leaked, [], 'FrameCut wrote outside its folder');
  // A model file stands in for downloaded AI models: updates must keep exactly one copy.
  fs.mkdirSync(path.join(DIR, 'data/engines/models'), { recursive: true }); fs.writeFileSync(path.join(DIR, 'data/engines/models/model.bin'), Buffer.alloc(1 << 20, 7));

  if (NEXT) {
    step('upgrade to the next version over the top');
    assert.equal(runInstaller(NEXT, '/S'), 0);
    assert.match(uninstallKey(), /DisplayVersion\s+REG_SZ\s+1\.0\.1/);
    assert.ok(exists('data/engines/models/model.bin') && exists('data/projects/' + projectId) && exists('data/preferences.json'), 'update kept data');
    ({ app, page } = await openApp());
    const list = await page.evaluate(() => window.__fc.api('/api/projects'));
    assert.ok(list.some(p => p.id === projectId), 'project reopens after update');
    await closeApp(app);
  }

  step('reinstalling into another folder (another drive letter works the same) brings the data along');
  const DIR2 = path.join(path.dirname(path.dirname(DIR)), 'Moved Apps', 'FrameCut Studio');
  assert.equal(runInstaller(SETUP, `/S /D=${DIR2}`), 0);
  assert.ok(!fs.existsSync(DIR), 'old folder emptied');
  for (const rel of ['data/engines/models/model.bin', 'data/projects/' + projectId, 'data/preferences.json', 'FrameCut Studio.exe']) assert.ok(fs.existsSync(path.join(DIR2, rel)), 'moved ' + rel);
  assert.match(uninstallKey(), /Moved Apps/);
  assert.equal(runInstaller(SETUP, `/S /D=${DIR}`), 0);
  assert.ok(!fs.existsSync(DIR2) && exists('data/engines/models/model.bin') && exists('data/projects/' + projectId), 'moved back');

  step('Standard uninstall keeps projects and media, removes the rest');
  await uninstall();
  assert.ok(!exists('FrameCut Studio.exe') && !exists('resources') && !exists('Uninstall FrameCut Studio.exe'), 'app files removed');
  for (const rel of ['data/profile', 'data/engines', 'data/cache', 'data/temp', 'data/logs', 'data/preferences.json', 'data/framecut-config.json']) assert.ok(!exists(rel), 'should be removed: ' + rel);
  for (const rel of ['data/projects/' + projectId, 'data/media.json']) assert.ok(exists(rel), 'should be kept: ' + rel);
  assert.ok(fs.existsSync(out) && fs.existsSync(clip), 'export and original media untouched');
  assert.equal(uninstallKey(), ''); for (const l of lnk()) assert.ok(!fs.existsSync(l), 'shortcut removed ' + l);

  step('reinstall into the same folder: kept projects come back');
  assert.equal(runInstaller(SETUP, `/S /D=${DIR}`), 0);
  ({ app, page } = await openApp());
  assert.ok((await page.evaluate(() => window.__fc.api('/api/projects'))).some(p => p.id === projectId), 'kept project listed');
  await closeApp(app);

  step('Complete removal without confirming project deletion keeps projects');
  await uninstall('--complete');
  assert.ok(exists('data/projects/' + projectId) && !exists('data/profile') && !exists('resources'));

  step('Complete removal while the app is running, deleting projects too');
  assert.equal(runInstaller(SETUP, `/S /D=${DIR}`), 0);
  ({ app, page } = await openApp());
  await uninstall('--complete --delete-projects');
  await app.close().catch(() => {});
  assert.ok(!fs.existsSync(DIR), 'install folder removed completely');
  assert.ok(fs.existsSync(out) && fs.existsSync(clip), 'export and original media untouched');
  await sleep(1000);
  const left = ours(added(base, snapshot()));
  assert.deepEqual(left, [], 'nothing FrameCut-owned left outside');
  console.log('install journey: all checks passed');
})().catch(async e => { console.error('FAILED:', e); process.exitCode = 1; for (const a of opened) await a.close().catch(() => {}); });
