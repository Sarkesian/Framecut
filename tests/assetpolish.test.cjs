const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { AssetPolish } = require('../desktop/providers/assetpolish.cjs');
const fixture = Array.from({ length: 85 }, (_, i) => ({ id: 'asset-' + i, name: 'Design ' + i, license: 'CC0-1.0', url: '/assets/test/' + i + '.svg', packName: ['Garden', 'Party', 'Travel'][i % 3], subjects: [i % 2 ? 'Nature' : 'Celebrations'], assetType: 'Sticker', tags: ['art'] }));

test('empty-query browsing spans collections and every page without duplicate assets', async () => {
  let calls = 0;
  const p = new AssetPolish({ http: { json: async () => { calls++; return [...fixture, fixture[0], { ...fixture[1], id: 'not-cc0', license: 'CC-BY-4.0' }]; } } });
  const first = await p.search({});
  assert.equal(first.total, 85); assert.equal(first.pages, 3);
  assert.equal(new Set(first.items.slice(0, 3).map(r => r.category)).size, 3);
  const second = await p.search({ page: 2 }), last = await p.search({ page: 3 });
  assert.equal(last.items.length, 5);
  assert.equal(new Set([...first.items, ...second.items, ...last.items].map(r => r.sourceId)).size, 85);
  assert.equal(calls, 1, 'pagination does not redownload the catalog');
  assert.equal((await p.search({ category: 'topic:Nature' })).total, 42);
  assert.equal((await p.search({ collection: 'collection:Garden' })).total, 29);
  assert.ok((await p.search({ q: 'design 84', collection: 'collection:Garden' })).items.some(r => r.sourceId === 'asset-84'));
  const categories = await p.categories();
  assert.equal(categories.find(c => c.group === 'all').count, 85);
  assert.equal(categories.find(c => c.id === 'topic:Nature').count, 42);
  assert.equal(categories.find(c => c.id === 'collection:Garden').count, 29);
});

test('a saved catalog restores offline, and a failed refresh cannot empty it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-ap-cache-'));
  const catalogFile = path.join(dir, 'catalog.json');
  try {
    const p = new AssetPolish({ catalogFile, http: { json: async () => fixture } });
    await p.catalog();
    let calls = 0;
    const offline = new AssetPolish({ catalogFile, http: { json: async () => { calls++; throw Error('offline'); } } });
    assert.equal((await offline.search({})).total, 85); assert.equal(calls, 0);
    offline.loadedAt = Date.now() - 25 * 3600e3;
    assert.equal((await offline.search({})).total, 85);
    await offline.loading;
    assert.equal((await offline.search({ page: 2 })).items.length, 40);
    assert.equal(calls, 1, 'failed refresh is not repeated for each catalog page');
    assert.equal(offline.status().stale, true);
    assert.equal(offline.status().error, 'offline');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
