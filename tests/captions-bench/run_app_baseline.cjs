// Runs the app's ORIGINAL in-editor captioner (Whisper base via transformers.js, src/lib/whisper.js)
// over the benchmark, in the real desktop app, saving results in the same format as run_models.py.
// Usage: node tests/captions-bench/run_app_baseline.cjs <bench_dir> [model=base]
const { _electron: electron } = require('playwright');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const bench = process.argv[2], model = process.argv[3] || 'base';
(async () => {
  const cases = JSON.parse(await fs.readFile(path.join(bench, 'cases.json'), 'utf8')).cases;
  const out = path.join(bench, 'results', 'app_whisper_' + model); await fs.mkdir(out, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-base-'));
  const app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, FRAMECUT_TEST: '1', FRAMECUT_TEST_DIR: temp } });
  const page = await app.firstWindow(); page.setDefaultTimeout(0);
  await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
  for (const c of cases) {
    const r = await page.evaluate(async ({ file, model }) => {
      const { api, whisper } = window.__fc; const a = (await api('/api/media/import', { paths: [file] })).assets[0];
      const t0 = performance.now(); const res = await whisper.transcribe({ mediaId: a.id, from: 0, to: a.duration, model });
      return { words: res.words.map(w => ({ text: w.text, start: w.start, end: w.end, p: null })), seconds: (performance.now() - t0) / 1000 };
    }, { file: path.join(bench, 'cases', c.file), model });
    await fs.writeFile(path.join(out, c.id + '.json'), JSON.stringify({ words: r.words, info: { engine: 'app whisper-' + model + ' (transformers.js)' }, seconds: r.seconds }));
    console.log(c.id.padEnd(24), r.words.length, 'words', r.seconds.toFixed(1) + 's', c.kind !== 'speech' ? '| ' + r.words.map(w => w.text).join(' ').slice(0, 120) : '');
  }
  await app.close();
})();
