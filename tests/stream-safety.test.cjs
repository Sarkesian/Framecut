const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { Readable, Writable } = require('node:stream');
const { writeStreamedFile } = require('../desktop/streams.cjs');
const { SafeHttp } = require('../desktop/providers/http.cjs');
const { Openverse } = require('../desktop/providers/openverse.cjs');
const { Creative } = require('../desktop/creative.cjs');

test('asynchronous destroyed-stream write failures are rejected, never uncaught', async () => {
  const original = fs.createWriteStream;
  fs.createWriteStream = () => new Writable({ write(_chunk, _enc, done) {
    setImmediate(() => done(Object.assign(Error('Cannot call write after a stream was destroyed'), { code: 'ERR_STREAM_DESTROYED' })));
  } });
  try { await assert.rejects(writeStreamedFile(Readable.from([Buffer.alloc(65536), Buffer.alloc(65536)]), 'unused'), e => e.code === 'ERR_STREAM_DESTROYED'); }
  finally { fs.createWriteStream = original; }
  await new Promise(r => setTimeout(r, 25));
});

test('cancelling a preview and immediately restarting it cannot share a partial file', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fc-stream-safe-')); let number = 0;
  const c = Object.create(Creative.prototype);
  c.previewPath = () => path.join(dir, 'preview'); c.prunePreviews = async () => {};
  c.providers = { sample: { preview: () => ({ url: 'https://example.org/test.mp3', maxBytes: 100000 }) } };
  c.http = { open: async () => {
    const n = ++number; let sent = 0, cancelled = false;
    const body = new ReadableStream({ async pull(control) {
      await new Promise(r => setTimeout(r, 2)); if (cancelled) return;
      if (sent++ === 12) control.close(); else control.enqueue(Buffer.alloc(1024, n));
    }, cancel() { cancelled = true; } });
    return { body, headers: new Headers({ 'content-type': 'audio/mpeg' }), cleanup() {} };
  } };
  try {
    const first = c.flight('sample', 'same-id', { kind: 'music' }); first.subs.add(() => {}); await first.head;
    first.abort();
    const next = c.flight('sample', 'same-id', { kind: 'music' }); next.subs.add(() => {}); await next.head;
    assert.equal(await first.finished, false); assert.equal(await next.finished, true);
    const bytes = await fsp.readFile(path.join(dir, 'preview'));
    assert.equal(bytes.length, 12 * 1024); assert.ok(bytes.every(b => b === 2));
    assert.equal((await fsp.readdir(dir)).filter(n => n.endsWith('.part')).length, 0);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('Wikimedia is rejected at the index, saved-record, download and redirect host boundaries', async () => {
  const p = new Openverse({ http: { json: async () => ({ results: [], page: 1, page_count: 1, result_count: 0 }) } });
  assert.equal(p.normalize({ id: 'id', title: 'Test', source: 'wikimedia', url: 'https://example.org/a.png' }, 'sticker'), null);
  assert.equal(p.normalize({ id: 'id', title: 'Test', source: 'svgsilh', url: 'https://upload.wikimedia.org/a.svg' }, 'sticker'), null);
  assert.throws(() => p.download({ sourceName: 'Wikimedia Commons', downloadUrl: 'https://example.org/a.mp3' }), /removed/);
  await assert.rejects(p.search({ q: 'piano', source: 'wikimedia_audio' }), /removed/);
  await assert.rejects(new SafeHttp().check('https://upload.wikimedia.org/a.svg'), /removed/);
  const c = Object.create(Creative.prototype); c.known = new Map([['openverse:old', { provider: 'openverse', sourceName: 'Wikimedia Commons' }]]);
  await assert.rejects(c.record('openverse', 'old'), /removed/);
  const urls = []; p.http.json = async url => { urls.push(new URL(url)); return { results: [] }; };
  await p.search({ q: 'star', kind: 'sticker' }); await p.search({ q: 'piano', kind: 'music' });
  assert.equal(urls[0].searchParams.get('source'), 'svgsilh,phylopic'); assert.equal(urls[1].searchParams.get('source'), 'freesound');
});
