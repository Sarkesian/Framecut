// Data safety of FrameCut's own JSON files: atomic, ordered writes and recovery from damaged files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../desktop/jsonstore.cjs');
const { Library } = require('../desktop/library.cjs');
const { Projects } = require('../desktop/projects.cjs');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'framecut-persist-'));
const noJobs = { add: () => ({ id: 'x' }) };

test('overlapping writes to one file are applied in order and never interleave', async () => {
  const dir = tmpDir(), file = path.join(dir, 'state.json');
  const big = n => ({ n, pad: 'x'.repeat(2e6) }); // large enough that writeFile needs several chunks
  await Promise.all([1, 2, 3, 4, 5].map(n => store.writeJson(file, big(n))));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 5, 'last write wins');
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')), [], 'no temp files left behind');
});

test('a damaged file falls back to the last good copy and is kept aside, not overwritten', () => {
  const dir = tmpDir(), file = path.join(dir, 'media.json');
  fs.writeFileSync(file, JSON.stringify([{ id: 'a' }]));
  assert.equal(store.readJsonSync(file, []).source, 'file'); // refreshes media.json.bak
  fs.writeFileSync(file, '[{"id": "a"'); // truncated by a crash
  const r = store.readJsonSync(file, []);
  assert.equal(r.source, 'backup');
  assert.deepEqual(r.value, [{ id: 'a' }]);
  assert.ok(r.damaged && fs.readFileSync(r.damaged, 'utf8').startsWith('[{"id"'), 'damaged contents preserved');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [{ id: 'a' }], 'good copy restored in place');
});

test('a damaged media index with no backup is preserved instead of being replaced by an empty library', async () => {
  const dataDir = tmpDir(), cacheDir = path.join(dataDir, 'cache');
  fs.writeFileSync(path.join(dataDir, 'media.json'), '[{"id":"m1","path":"C:/v.mp4"'); // damaged
  const lib = new Library({ dataDir, cacheDir, jobs: noJobs, prefs: () => ({}) });
  await lib.init(); await lib.flush();
  const kept = fs.readdirSync(dataDir).filter(n => n.startsWith('media.json.damaged-'));
  assert.equal(kept.length, 1, 'the damaged index is kept for recovery');
  assert.ok(fs.readFileSync(path.join(dataDir, kept[0]), 'utf8').includes('"m1"'));
});

test('the media index survives a restart after a crash damaged it', async () => {
  const dataDir = tmpDir(), cacheDir = path.join(dataDir, 'cache'), media = path.join(dataDir, 'clip.wav');
  fs.writeFileSync(media, 'not really audio');
  fs.writeFileSync(path.join(dataDir, 'media.json'), JSON.stringify([{ id: 'm1', path: media, name: 'clip.wav', kind: 'audio' }]));
  const lib1 = new Library({ dataDir, cacheDir, jobs: noJobs, prefs: () => ({}) }); await lib1.init();
  fs.writeFileSync(path.join(dataDir, 'media.json'), '{'); // crash mid-write in a later session
  const lib2 = new Library({ dataDir, cacheDir, jobs: noJobs, prefs: () => ({}) }); await lib2.init();
  assert.ok(lib2.get('m1'), 'asset restored from the last good copy');
});

test('rapid saves of one project all succeed and the newest state is on disk', async () => {
  const dataDir = tmpDir(), projects = new Projects({ dataDir }); await projects.init();
  const p = await projects.create({ name: 'Race' });
  const saves = Array.from({ length: 12 }, (_, i) => projects.save({ ...p, name: 'Race ' + i }));
  await Promise.all(saves);
  const loaded = await projects.load(p.id);
  assert.equal(loaded.name, 'Race 11');
  assert.deepEqual(fs.readdirSync(projects.dir(p.id)).filter(n => n.endsWith('.tmp')), []);
});
