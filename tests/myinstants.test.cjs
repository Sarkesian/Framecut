const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { MyInstants } = require('../desktop/providers/myinstants.cjs');
const { Creative } = require('../desktop/creative.cjs');
const { assessRights } = require('../shared/rights.mjs');
const row = (slug = 'vine-boom-123') => ({ slug, name: 'Vine boom', sound: 'https://www.myinstants.com/media/sounds/vine-boom.mp3', description: 'A reaction sound.', tags: 'meme, reaction' });

test('Curated meme collections keep editorial order, paginate completely and leave global search intact', async () => {
  const { MEME_COLLECTIONS, MEME_SOUNDS } = require('../shared/meme-library.mjs');
  let hits = 0;
  const p = new MyInstants({ http: { json: async url => { hits++; assert.equal(new URL(url).searchParams.get('name'), 'bruh'); return { count: 1, next: null, results: [row()] }; } } });
  assert.equal(new Set(MEME_SOUNDS.map(r => r.slug)).size, MEME_SOUNDS.length);
  for (const group of MEME_COLLECTIONS) {
    const ids = []; const first = await p.search({ collection: group.id });
    for (let page = 1; page <= first.pages; page++) ids.push(...(await p.search({ collection: group.id, page })).items.map(r => r.sourceId));
    assert.deepEqual(ids, group.slugs); assert.equal(first.total, group.slugs.length);
  }
  assert.equal(hits, 0);
  await p.search({ q: 'bruh', collection: 'gaming' }); assert.equal(hits, 1);
  await assert.rejects(p.search({ collection: 'invalid' }), /Unknown meme collection/);
});
test('MyInstants preserves official API pagination and caches shared name searches', async () => {
  let hits = 0; const p = new MyInstants({ http: { json: async url => { hits++; const page = +new URL(url).searchParams.get('page'); return { count: 31, next: page < 4 ? `https://www.myinstants.com/api/v1/instants/?page=${page + 1}` : null, results: [row('sound-' + page)] }; } } });
  const [a, b] = await Promise.all([p.search({ q: 'boom' }), p.search({ q: 'boom' })]);
  assert.equal(hits, 1); assert.deepEqual(a.items.map(r => r.sourceId), b.items.map(r => r.sourceId)); assert.equal(a.items[0].rightsUnverified, true); assert.equal(a.items[0].licenseCheck.ok, false);
  const ids = new Set(a.items.map(r => r.sourceId)); for (let page = 2; page <= 4; page++) { const r = await p.search({ q: 'boom', page }); r.items.forEach(x => ids.add(x.sourceId)); if (page === 4) assert.equal(r.pages, 4); }
  assert.equal(ids.size, 4);
  assert.equal(p.normalize({ ...row(), sound: 'http://127.0.0.1/private.mp3' }), null);
  assert.equal(p.normalize({ ...row(), slug: '../bad' }), null);
});
test('MyInstants enforces anonymous quotas across queries and process restarts, while cached pages remain available', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-myinstants-')); const cacheFile = path.join(dir, 'cache.json'); let hits = 0;
  const http = { json: async () => { hits++; return { count: 1, next: null, results: [row()] }; } };
  try {
    const p = new MyInstants({ http, cacheFile }); for (let i = 0; i < 10; i++) await p.search({ q: 'q' + i });
    await assert.rejects(p.search({ q: 'extra' }), e => e.code === 'quota'); assert.equal(hits, 10);
    await p.cache.flush(); const reopened = new MyInstants({ http, cacheFile });
    await assert.rejects(reopened.search({ q: 'another' }), e => e.code === 'quota');
    await reopened.search({ q: 'q0' }); assert.equal(hits, 10); await reopened.cache.flush();
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('MyInstants respects Retry-After globally and rejects hostile pagination', async () => {
  let hits = 0; const p = new MyInstants({ http: { json: async () => { hits++; throw Object.assign(Error('quota'), { status: 429, retryAfter: '120' }); } } });
  await assert.rejects(p.search({ q: 'a' }), e => e.code === 'quota' && e.retryAfter === 120);
  await assert.rejects(p.search({ q: 'b' }), e => e.code === 'quota'); assert.equal(hits, 1);
  const hostile = new MyInstants({ http: { json: async () => ({ count: 20, next: 'https://evil.example/api/v1/instants/?page=2', results: [row()] }) } });
  await assert.rejects(hostile.search({}), /unexpected next page/);
});
test('MyInstants stays outside the CC0 catalog; imports require user direction and never imply verified rights', async () => {
  const c = new Creative({ dataDir: '.', cacheDir: '.', library: { get: () => null }, jobs: { jobs: new Map(), add: () => ({ id: 'user-import' }) } });
  c.providers.myinstants = new MyInstants({ http: { json: async () => ({ count: 1, next: null, results: [row()] }) } });
  const r = await c.search('myinstants', { kind: 'sfx' }); assert.equal(r.items.length, 1); assert.equal(r.items[0].downloadable, true);
  assert.ok(!c.searchable('sfx', 'all').includes('myinstants'));
  assert.throws(() => c.importAsset({ provider: 'myinstants', id: row().slug, kind: 'sfx' }), e => e.code === 'license');
  assert.deepEqual(c.importAsset({ provider: 'myinstants', id: row().slug, kind: 'sfx', acknowledgeUnknownRights: true }), { job: 'user-import' });
  const rights = assessRights({ provider: 'myinstants', license: 'cc0', kind: 'sfx' });
  assert.equal(rights.export, true); assert.equal(rights.level, 'caution'); assert.equal(rights.commercial, 'unknown'); assert.equal(rights.badge, 'Rights unverified');
});
