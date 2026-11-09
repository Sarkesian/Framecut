// Accurate caption engine setup in an installed build: the bundled Python creates the private environment,
// pip installs PyTorch + the speech packages and the models download — all inside <install>\data\engines,
// with no pip, Hugging Face or PyTorch caches written to the user profile. Downloads several GB.
//   node tests/engine-journey.cjs "<install folder>"
const { _electron: electron } = require('playwright');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const DIR = path.resolve(process.argv[2]);
const step = n => console.log('· ' + n);
// Size/mtime fingerprint of the user-profile caches a careless Python setup would fill.
const PROFILE_CACHES = [path.join(process.env.LOCALAPPDATA, 'pip', 'cache'), path.join(os.homedir(), '.cache', 'huggingface'), path.join(os.homedir(), '.cache', 'torch'), path.join(process.env.LOCALAPPDATA, 'torch')];
function fingerprint(dir) {
  let files = 0, newest = 0;
  const walk = d => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { files++; try { newest = Math.max(newest, fs.statSync(p).mtimeMs); } catch {} } } };
  walk(dir); return { files, newest };
}
(async () => {
  const before = Object.fromEntries(PROFILE_CACHES.map(d => [d, fingerprint(d)]));
  const started = Date.now();
  const env = { ...process.env, FRAMECUT_TEST: '1', FRAMECUT_NO_IMPORT: '1' }; delete env.FRAMECUT_TEST_DIR;
  const app = await electron.launch({ executablePath: path.join(DIR, 'FrameCut Studio.exe'), args: [], env });
  try {
    const page = await app.firstWindow(); await page.getByText('New project').first().waitFor({ timeout: 60000 });
    const api = (url, body) => page.evaluate(([u, b]) => window.__fc.api(u, b), [url, body]);
    const status0 = await api('/api/captions/engine?refresh=1');
    console.log('  before:', JSON.stringify(status0));
    step('install the engine from the app (bundled Python → private venv → pip → models)');
    const { job } = await api('/api/captions/engine/install', {});
    let j, last = '';
    for (;;) {
      j = await api('/api/jobs/' + job);
      const line = `${Math.round((j.progress || 0) * 100)}% ${j.message || ''}`; if (line !== last) { console.log('   ', line.slice(0, 110)); last = line; }
      if (!['queued', 'running'].includes(j.status)) break;
      await new Promise(r => setTimeout(r, 5000));
    }
    assert.equal(j.status, 'done', 'engine install: ' + (j.error || j.status));
    assert.equal(j.result?.ready, true, 'engine ready after install');
    console.log('  after:', JSON.stringify(j.result), `(${Math.round((Date.now() - started) / 60000)} min)`);
    const cfg = fs.readFileSync(path.join(DIR, 'data/engines/speech/pyvenv.cfg'), 'utf8');
    assert.match(cfg, new RegExp('home\\s*=\\s*' + path.join(DIR, 'resources', 'python').replace(/[\\.()]/g, '\\$&'), 'i'), 'venv built on the bundled Python');
    assert.ok(fs.readdirSync(path.join(DIR, 'data/engines/models/hub')).some(n => /Qwen3-ASR/.test(n)), 'models stored in data\\engines\\models');
  } finally { await app.close().catch(() => {}); }
  for (const d of PROFILE_CACHES) {
    const after = fingerprint(d);
    assert.ok(after.files <= before[d].files && after.newest <= Math.max(before[d].newest, started), `nothing written to ${d}`);
  }
  console.log('engine journey: all checks passed');
})().catch(e => { console.error('FAILED:', e); process.exitCode = 1; });
