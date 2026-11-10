// Official MyInstants API. Catalog/preview access is separate from reuse rights:
// the API supplies no per-sound license. Imports are user-directed and never
// represented as independently cleared or CC0.
const { MetadataCache } = require('./metadata.cjs');
const { plain } = require('../../shared/audio-library.mjs');
const { MEME_COLLECTIONS, MEME_SOUNDS } = require('../../shared/meme-library.mjs');
class MyInstants {
  constructor({ http, base = 'https://www.myinstants.com', cacheFile }) {
    this.id = 'myinstants'; this.http = http; this.base = base.replace(/\/$/, ''); this.cacheTtl = 0;
    this.cache = new MetadataCache(cacheFile, { maxEntries: 160, maxBytes: 4 * 1024 ** 2 });
  }
  async call(path) {
    return this.cache.get(path, async () => {
      const now = Date.now(), budget = this.cache.entries.get('_budget')?.value || {};
      const times = (Array.isArray(budget.times) ? budget.times : []).filter(t => Number.isFinite(t) && now - t < 60000);
      const until = Math.max(budget.until || 0, times.length >= 10 ? times[0] + 60000 : 0);
      if (until > now) throw Object.assign(Error('MyInstants allows 10 API requests per minute. Cached searches and your other libraries still work.'), { code: 'quota', retryAfter: Math.ceil((until - now) / 1000) });
      times.push(now); this.cache.set('_budget', { times, until: 0 });
      try { return await this.http.json(this.base + '/api/v1' + path, { timeout: 20000 }); }
      catch (e) {
        if (e.status === 429) {
          const seconds = Math.max(1, +e.retryAfter || Math.ceil((Date.parse(e.retryAfter) - now) / 1000) || 60);
          this.cache.set('_budget', { times, until: now + seconds * 1000 });
          throw Object.assign(Error('MyInstants asked FrameCut to pause API requests.'), { code: 'quota', retryAfter: seconds });
        }
        throw e;
      }
    }, { ttl: 6 * 3600e3, stale: false });
  }
  async search({ q = '', page = 1, collection = '' }) {
    page = Math.max(1, Math.floor(+page || 1));
    if (!String(q).trim() && collection) {
      const group = MEME_COLLECTIONS.find(g => g.id === collection);
      if (!group) throw Error('Unknown meme collection.');
      const items = group.slugs.map(id => this.normalize(MEME_SOUNDS.find(r => r.slug === id))).filter(Boolean);
      const size = 12;
      return { items: items.slice((page - 1) * size, page * size), total: items.length, page, pages: Math.ceil(items.length / size), curated: true, rightsUnverified: true };
    }
    const data = await this.call('/instants/?' + new URLSearchParams({ name: String(q).slice(0, 160), page: String(page), format: 'json' }));
    if (!Array.isArray(data.results) || !Number.isFinite(data.count)) throw Error('MyInstants returned an unreadable catalog response.');
    if (data.next) {
      const next = new URL(data.next, this.base);
      if (next.origin !== new URL(this.base).origin || next.pathname !== '/api/v1/instants/' || +next.searchParams.get('page') !== page + 1) throw Error('MyInstants returned an unexpected next page.');
    }
    const seen = new Set(), items = data.results.map(r => this.normalize(r)).filter(r => r && !seen.has(r.sourceId) && seen.add(r.sourceId));
    return { items, total: data.count, page, pages: data.next ? Math.max(page + 1, Math.ceil(data.count / Math.max(1, data.results.length))) : page, rightsUnverified: true };
  }
  normalize(r) {
    if (!r || !/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(r.slug || '')) return null;
    let url; try {
      url = new URL(r.sound);
      if (!['https://www.myinstants.com', 'https://myinstants.com'].includes(url.origin) || !/^\/media\/sounds\/[^/]+\.mp3$/i.test(url.pathname) || url.username || url.password) return null;
    } catch { return null; }
    const rec = { provider: this.id, sourceId: r.slug, kind: 'sfx', title: plain(r.name || r.slug).slice(0, 200), creator: '', sourceName: 'MyInstants',
      sourcePageUrl: this.base + '/en/instant/' + encodeURIComponent(r.slug) + '/', previewUrl: url.href, rightsUnverified: true,
      description: plain(r.description).slice(0, 1000), tags: String(r.tags || '').split(/[,;]+/).map(plain).filter(Boolean).slice(0, 10),
      license: '', licenseVersion: null, licenseUrl: null, licenseEvidenceUrl: this.base + '/api/v1/instants/' + encodeURIComponent(r.slug) + '/', metadataCheckedAt: new Date().toISOString(),
      licenseCheck: { ok: false, status: 'unknown', problems: [{ code: 'unknown', text: 'MyInstants provides this preview, but its API does not supply a reuse license for the recording.' }] } };
    Object.defineProperty(rec, 'downloadUrl', { value: url.href, enumerable: false }); return rec;
  }
  async getAsset(id) {
    if (!/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(String(id))) throw Error('Invalid MyInstants sound identifier.');
    const r = this.normalize(await this.call('/instants/' + encodeURIComponent(id) + '/?format=json'));
    if (!r) throw Error('MyInstants no longer provides a playable preview for this sound.'); return r;
  }
  download(rec) { return { url: rec.downloadUrl, accept: /^(audio\/|application\/octet-stream)/i, maxBytes: 30 * 1024 ** 2 }; }
}
module.exports = { MyInstants };
