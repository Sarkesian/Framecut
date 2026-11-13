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
test('Adding a listed MyInstants sound downloads the listed file without another catalog lookup, even when the listing has since been dropped', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-myinstants-import-')); let lookups = 0, fetched = null;
  try {
    const http = {
      json: async url => { lookups++; if (/\/instants\/[^/?]+\/\?/.test(url)) throw Object.assign(Error('The media service answered 404.'), { status: 404, code: 'gone' }); return { count: 250, next: null, results: [row()] }; },
      toFile: async (url, file) => { fetched = url; await fs.writeFile(file, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)])); return { bytes: 67, sha256: 'a'.repeat(64), sha1: 'b'.repeat(40), contentType: 'audio/mpeg', finalUrl: url }; },
    };
    const assets = new Map();
    const library = { get: id => assets.get(id) || null, public: a => a, importPath: async (file, { name }) => { const a = { id: 'm1', name, file, audio: true }; assets.set(a.id, a); return a; } };
    const c = new Creative({ dataDir: dir, cacheDir: dir, library, jobs: { jobs: new Map() }, http });
    c.providers.myinstants = new MyInstants({ http });
    const found = await c.search('myinstants', { kind: 'sfx', q: 'vine' }); assert.equal(found.capped, true); assert.equal(lookups, 1);
    const key = 'myinstants:' + row().slug, ctx = { signal: new AbortController().signal, progress() {} };
    const out = await c.importJob({ providerId: 'myinstants', id: row().slug, kind: 'sfx', usage: 'commercial', key, listed: c.known.get(key), job: {} }, ctx);
    assert.equal(lookups, 1); assert.equal(fetched, row().sound); assert.equal(out.asset.audio, true);
    // Without a listing (say, after a restart) the catalog is asked, and its "not found" is still reported as gone.
    await assert.rejects(c.importJob({ providerId: 'myinstants', id: 'some-removed-sound', kind: 'sfx', usage: 'commercial', key: 'myinstants:some-removed-sound', listed: null, job: {} }, ctx), e => e.code === 'gone');
    clearTimeout(c.saveTimer);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('Built-in picks resolve from their own entry when the catalog drops the listing or is rate limited, and every pick is importable', async () => {
  const { MEME_COLLECTIONS, MEME_SOUNDS } = require('../shared/meme-library.mjs');
  for (const code of ['gone', 'quota']) {
    const p = new MyInstants({ http: { json: async () => { throw Object.assign(Error('no'), { code, status: code === 'gone' ? 404 : 0 }); } } });
    const r = await p.getAsset(MEME_SOUNDS[0].slug); assert.equal(r.downloadUrl, MEME_SOUNDS[0].sound);
    await assert.rejects(p.getAsset('not-a-built-in-pick'), e => e.code === code);
  }
  const p = new MyInstants({ http: {} });
  for (const s of MEME_SOUNDS) assert.ok(p.normalize(s)?.downloadUrl, s.slug);
  for (const g of MEME_COLLECTIONS) for (const slug of g.slugs) assert.ok(MEME_SOUNDS.some(s => s.slug === slug), `${g.id}: ${slug}`);
});
test('MyInstants searches the site’s own pages: ranked results that name their file, open-ended paging, API only as the fallback', async () => {
  const card = (slug, name, file = slug) => `<div class="instant">\n<button class="small-button" onclick="play('/media/sounds/${file}.mp3', 'loader-1', '${slug}')" title="Play"></button>\n<a href="/en/instant/${slug}/" class="instant-link link-secondary">${name}</a>\n</div>`;
  const full = n => Array.from({ length: 36 }, (_, i) => card(`s${n}-${i}`, 'Sound ' + i)).join('');
  const asked = []; let api = 0;
  const http = {
    json: async () => { api++; return { count: 250, next: null, results: [row()] }; },
    text: async url => {
      const u = new URL(url); asked.push(u.pathname + u.search); const page = +u.searchParams.get('page') || 1;
      if (u.pathname === '/en/trending/us/') return full('t' + page);
      if (u.searchParams.get('name') === 'broken') return '<html>redesigned</html>';
      if (page === 1) return '<div class="instants result-page">' + card('tom-jerry-1', 'Tom &amp; Jerry &#x27;scream&#x27;', 'tom_x') + card('../evil', 'bad', 'evil') + full(1).split('<div class="instant">').slice(0, 35).join('<div class="instant">');
      if (page === 2) return card('last-one', 'Last');
      throw Object.assign(Error('The media service answered 404.'), { status: 404, code: 'gone' });
    },
  };
  const p = new MyInstants({ http });
  const a = await p.search({ q: 'tom & jerry' });
  assert.equal(asked[0], '/en/search/?name=tom+%26+jerry'); assert.equal(a.live, true); assert.equal(a.pages, 2); assert.equal(api, 0);
  assert.equal(a.items[0].sourceId, 'tom-jerry-1'); assert.equal(a.items[0].title, "Tom & Jerry 'scream'"); assert.equal(a.items[0].downloadUrl, 'https://www.myinstants.com/media/sounds/tom_x.mp3');
  assert.ok(!a.items.some(r => r.sourceId.includes('evil')));
  const b = await p.search({ q: 'tom & jerry', page: 2 }); assert.equal(b.items.length, 1); assert.equal(b.pages, 2);
  await p.search({ q: 'tom & jerry' }); assert.equal(asked.length, 2); // cached
  const t = await p.search({ page: 2 }); assert.equal(asked.at(-1), '/en/trending/us/?page=2'); assert.equal(t.items.length, 36); assert.equal(t.pages, 3);
  assert.deepEqual((await p.search({ q: 'nothing', page: 3 })).items, []);
  const f = await p.search({ q: 'broken' }); assert.equal(api, 1); assert.equal(f.capped, true); assert.equal(f.items.length, 1);
  const down = new MyInstants({ http: { ...http, text: async () => { throw Object.assign(Error('offline'), { code: 'offline' }); } } });
  await assert.rejects(down.search({ q: 'x' }), e => e.code === 'offline');
});
