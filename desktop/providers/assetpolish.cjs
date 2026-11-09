// AssetPolish (https://www.assetpolish.com): a catalog of CC0 vector stickers, illustrations and icons.
// There is no search API; the site publishes its whole catalog as one static JSON file with a direct
// file address and a SHA-256 fingerprint per asset. FrameCut fetches that file at most once a day,
// searches it locally, and downloads only the items a creator adds (each checked against its fingerprint).
//
// Everything is CC0 1.0 by the site's own license page; items the catalog does not mark CC0 are dropped.
// The animated assets are SVGs animated with CSS, which FrameCut's sticker renderer does not play yet, so
// their still version is offered instead.
const { verifyLicense, assessRights, PROVIDERS } = require('../../shared/rights.mjs');
const { readJsonSync, writeJson } = require('../jsonstore.cjs');

const BASE = 'https://www.assetpolish.com';
const TTL = 24 * 3600e3;
// Stickers and illustrations first; plain interface icons last.
const RANK = { 'Sticker': 0, 'Animated sticker': 0, 'Vector illustration': 1, 'Animated icon': 2, 'Icon': 3 };

class AssetPolish {
  constructor({ http, base = BASE, catalogFile }) {
    this.id = 'assetpolish'; this.http = http; this.base = String(base).replace(/\/+$/, '');
    this.capabilities = new Set(['search', 'preview', 'download', 'license-metadata', 'commercial-use', 'no-attribution']);
    // Searches are local and cheap; only the catalog has a TTL. A second search
    // cache must not hide newly refreshed catalog entries for another day.
    this.cacheTtl = 0; this.items = null; this.loadedAt = 0; this.loading = null;
    this.catalogFile = catalogFile; this.retryAt = 0; this.lastError = null;
    if (catalogFile) {
      const { value } = readJsonSync(catalogFile, null);
      if (value?.base === this.base && Array.isArray(value.items) && Number.isFinite(value.at)) {
        try { this.acceptCatalog(value.items, Math.min(Date.now(), value.at)); } catch {}
      }
    }
  }
  warm() { this.catalog().catch(() => {}); }
  // The whole catalog, refreshed daily. If a refresh fails, yesterday's copy keeps working.
  async catalog() {
    if (this.items) {
      // A saved catalog stays browsable on restart or offline. Refresh stale data
      // in the background; repeated pages must not repeat a failing download.
      if (Date.now() - this.loadedAt >= TTL && Date.now() >= this.retryAt) this.refresh().catch(() => {});
      return this.items;
    }
    return this.refresh();
  }
  acceptCatalog(raw, at) {
    const items = [...new Map(raw.map(a => this.normalize(a, at)).filter(Boolean).map(r => [r.sourceId, r])).values()];
    if (!items.length) throw Object.assign(Error('AssetPolish sent an empty catalog. Try again later.'), { code: 'http' });
    this.items = items; this.byId = new Map(items.map(r => [r.sourceId, r])); this.loadedAt = at;
  }
  async refresh() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const raw = await this.http.json(this.base + '/catalog.json', { timeout: 30000 });
        if (!Array.isArray(raw)) throw Object.assign(Error('AssetPolish sent an unreadable catalog.'), { code: 'http' });
        this.acceptCatalog(raw, Date.now()); this.lastError = null; this.retryAt = 0;
        if (this.catalogFile) await writeJson(this.catalogFile, { base: this.base, at: this.loadedAt, items: raw }).catch(() => {});
      } catch (e) { this.retryAt = Date.now() + 60000; this.lastError = e.message; if (!this.items) throw e; }
      return this.items;
    })();
    try { return await this.loading; } finally { this.loading = null; }
  }
  async categories() {
    const all = await this.catalog(); const groups = new Map();
    for (const r of all) for (const [group, values] of [['topic', r.subjects], ['collection', [r.category]]]) {
      for (const name of new Set(values.filter(Boolean))) {
        const id = group + ':' + name;
        const c = groups.get(id) || { id, name, group, count: 0 }; c.count++; groups.set(id, c);
      }
    }
    return [{ id: '', name: 'All assets', group: 'all', count: all.length }, ...[...groups.values()].sort((a, b) => a.name.localeCompare(b.name))];
  }
  async search({ q = '', page = 1, pageSize = 40, category = '', collection = '' }) {
    const all = await this.catalog();
    const words = String(q).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6);
    // Every word must match somewhere; a hit in the name counts most, then tags, then the collection.
    const scored = [];
    for (const r of all) {
      if (category && !r.subjects.includes(String(category).replace(/^topic:/, ''))) continue;
      if (collection && r.category !== String(collection).replace(/^collection:/, '')) continue;
      let score = 0, ok = true;
      for (const w of words) { const s = r._name.includes(w) ? 3 : r._tags.includes(w) ? 2 : r._more.includes(w) ? 1 : 0; if (!s) { ok = false; break; } score += s; }
      if (ok) scored.push([score - r._rank, r]);
    }
    // Round-robin collections for an empty browse, instead of filling the first
    // screen with 33 versions from the first pack in the publisher's file.
    scored.sort((a, b) => b[0] - a[0]);
    let ordered = scored.map(x => x[1]);
    if (!words.length && !collection) {
      const packs = new Map();
      for (const r of ordered) { if (!packs.has(r.category)) packs.set(r.category, []); packs.get(r.category).push(r); }
      ordered = []; const lists = [...packs.values()];
      for (let i = 0; lists.some(l => i < l.length); i++) for (const list of lists) if (list[i]) ordered.push(list[i]);
    }
    page = Math.max(1, page | 0 || 1);
    return { items: ordered.slice((page - 1) * pageSize, page * pageSize), total: ordered.length, page, pages: Math.ceil(ordered.length / pageSize) };
  }
  async getAsset(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,159}$/.test(String(id))) throw Error('Invalid AssetPolish id.');
    await this.catalog();
    const rec = this.byId.get(String(id));
    if (!rec) throw Object.assign(Error('This asset is no longer in the AssetPolish catalog.'), { code: 'gone' });
    return rec;
  }
  normalize(a, checkedAt = Date.now()) {
    if (!a || typeof a.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,159}$/.test(a.id) || a.license !== 'CC0-1.0') return null;
    // Animated SVGs: the still version, until CSS-animated SVG can be rendered to frames.
    const still = a.animated === true && a.staticUrl; const rel = still ? a.staticUrl : a.url;
    const file = this.fileUrl(rel); if (!file) return null;
    const pv = PROVIDERS.assetpolish; const tags = (Array.isArray(a.tags) ? a.tags : []).map(t => String(t).toLowerCase()).filter(t => t && t.length < 24 && t !== 'animated' && t !== 'motion');
    const rec = {
      provider: 'assetpolish', sourceId: a.id, kind: 'sticker', title: String(a.name || a.id).slice(0, 120), creator: String(a.author || 'AssetPolish').slice(0, 80), creatorUrl: null,
      sourcePageUrl: a.pack ? `${BASE}/collections/${encodeURIComponent(a.pack)}/` : BASE + '/', sourceName: 'AssetPolish', tags: tags.slice(0, 6), category: a.packName || null, subjects: Array.isArray(a.subjects) ? a.subjects.map(String) : [], animated: false, stillFromAnimation: !!still, mimeType: 'image/svg+xml', filetype: 'svg',
      license: pv.license.id, licenseVersion: pv.license.version, licenseUrl: pv.license.url, attribution: null, licenseEvidenceUrl: BASE + '/licenses/', metadataCheckedAt: new Date(checkedAt).toISOString(),
    };
    rec.licenseCheck = verifyLicense(rec, { checkedAt: rec.metadataCheckedAt, method: 'assetpolish-catalog' });
    const rights = assessRights({ provider: 'assetpolish', license: rec.license, licenseVersion: rec.licenseVersion, kind: 'sticker', verification: rec.licenseCheck });
    rec.tier = rights.tier; rec.localStorageAllowed = true; rec.exportAllowed = !rights.blocked;
    const hide = (k, v) => Object.defineProperty(rec, k, { value: v, enumerable: false });
    hide('downloadUrl', file);
    // The published fingerprint belongs to the main file, so it is only checked when that is the file fetched.
    if (!still && /^[0-9a-f]{64}$/.test(a.sha256 || '')) hide('expectedSha256', a.sha256);
    hide('_name', rec.title.toLowerCase()); hide('_tags', ' ' + (Array.isArray(a.tags) ? a.tags : []).join(' ').toLowerCase() + ' ');
    hide('_more', [a.packName, a.assetType, a.style, ...(Array.isArray(a.subjects) ? a.subjects : []), ...(Array.isArray(a.useCases) ? a.useCases : [])].filter(Boolean).join(' ').toLowerCase());
    hide('_rank', (RANK[a.assetType] ?? 2) * 0.5);
    return rec;
  }
  // Only plain .svg paths under /assets/ on the catalog's own host.
  fileUrl(rel) { if (typeof rel !== 'string' || !/^\/assets\/[a-z0-9._/-]+\.svg$/i.test(rel) || rel.includes('..')) return null; return this.base + rel; }
  download(rec) { return { url: rec.downloadUrl, accept: /^(image\/svg\+xml|text\/plain|application\/octet-stream|binary\/octet-stream)/i, maxBytes: 2 * 1024 ** 2 }; }
  preview(rec) { return this.download(rec); }
  status() { return { loaded: this.items?.length || 0, loadedAt: this.loadedAt || null, stale: !!this.items && Date.now() - this.loadedAt >= TTL, refreshing: !!this.loading, error: this.lastError }; }
}
module.exports = { AssetPolish };
