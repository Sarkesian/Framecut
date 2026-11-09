// Pixabay adapter: transparent illustrations and vectors for stickers (the official API serves images
// and video only — no music or sound effects). Everything on Pixabay is under the Pixabay Content
// License: commercial use, no attribution. API rules followed here (https://pixabay.com/api/docs/):
// a per-user API key, results cached for 24 hours, at most 100 requests a minute, the source shown with
// every result, files downloaded into the project rather than hotlinked, and no bulk downloading
// (only items the creator picks are fetched).
const { verifyLicense, assessRights, PROVIDERS } = require('../../shared/rights.mjs');

const API = 'https://pixabay.com/api/';
const CATEGORIES = ['backgrounds', 'fashion', 'nature', 'science', 'education', 'feelings', 'health', 'people', 'religion', 'places', 'animals', 'industry', 'computer', 'food', 'sports', 'transportation', 'travel', 'buildings', 'business', 'music'];

class Pixabay {
  constructor({ http, credentials = () => null, base = API }) {
    this.id = 'pixabay'; this.http = http; this.credentials = credentials; this.base = base;
    this.capabilities = new Set(['search', 'categories', 'preview', 'download', 'license-metadata', 'commercial-use', 'no-attribution']);
    this.cacheTtl = 24 * 3600e3; this.window = []; this.blockedUntil = 0;
  }
  configured() { return !!this.credentials()?.key; }
  categories() { return CATEGORIES; }
  throttle() {
    const now = Date.now();
    if (now < this.blockedUntil) throw Object.assign(Error('Pixabay asked FrameCut to slow down.'), { code: 'quota', retryAfter: Math.ceil((this.blockedUntil - now) / 1000) });
    this.window = this.window.filter(t => now - t < 60e3);
    if (this.window.length >= 90) throw Object.assign(Error('Pixabay search limit reached for this minute.'), { code: 'quota', retryAfter: Math.ceil((60e3 - (now - this.window[0])) / 1000) });
    this.window.push(now);
  }
  async call(params) {
    const key = this.credentials()?.key;
    if (!key) throw Object.assign(Error('Add your free Pixabay API key in Preferences › Library to search Pixabay.'), { code: 'auth' });
    this.throttle();
    try { return await this.http.json(this.base + '?' + new URLSearchParams({ key, ...params })); }
    catch (e) {
      if (e.status === 429) { const s = Math.max(5, Math.min(3600, +e.retryAfter || 60)); this.blockedUntil = Date.now() + s * 1000; throw Object.assign(Error('Pixabay is limiting requests right now.'), { code: 'quota', retryAfter: s }); }
      if (e.status === 400 && /key/i.test(e.body || '')) throw Object.assign(Error('Pixabay rejected the API key. Check it in Preferences › Library.'), { code: 'auth' });
      throw e;
    }
  }
  async search({ q = '', page = 1, category = '', pageSize = 40 }) {
    const params = { q: String(q).slice(0, 100), image_type: 'illustration', colors: 'transparent', safesearch: 'true', per_page: String(pageSize), page: String(Math.max(1, Math.min(12, page | 0 || 1))) };
    if (CATEGORIES.includes(category)) params.category = category;
    const data = await this.call(params);
    const items = (data.hits || []).map(h => this.normalize(h)).filter(Boolean);
    const hits = Math.min(+data.totalHits || 0, 500);
    return { items, total: hits, page, pages: Math.ceil(hits / pageSize) };
  }
  async getAsset(id) {
    if (!/^\d{1,12}$/.test(String(id))) throw Error('Invalid Pixabay id.');
    const data = await this.call({ id: String(id) });
    const rec = data.hits?.[0] && this.normalize(data.hits[0]);
    if (!rec) throw Object.assign(Error('This image is no longer available on Pixabay, or it has no transparent version.'), { code: 'gone' });
    return rec;
  }
  // Only PNG results are offered: a JPEG cannot carry the transparency a sticker needs.
  normalize(h) {
    if (!h || !h.id) return null;
    const file = safeUrl(h.largeImageURL || h.webformatURL); const thumb = safeUrl(h.previewURL || h.webformatURL);
    if (!file || !/\.png(\?|$)/i.test(file)) return null;
    const tags = String(h.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const title = tags[0] ? tags[0][0].toUpperCase() + tags[0].slice(1) : 'Pixabay illustration';
    const pv = PROVIDERS.pixabay;
    const rec = {
      provider: 'pixabay', sourceId: String(h.id), kind: 'sticker', title, creator: h.user ? String(h.user).slice(0, 80) : '', creatorUrl: h.user && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : null,
      sourcePageUrl: safeUrl(h.pageURL), sourceName: 'Pixabay', tags: tags.slice(0, 6), width: +h.imageWidth || null, height: +h.imageHeight || null, mimeType: 'image/png',
      license: pv.license.id, licenseVersion: null, licenseUrl: pv.license.url, attribution: null, licenseEvidenceUrl: pv.license.url, metadataCheckedAt: new Date().toISOString(),
    };
    rec.licenseCheck = verifyLicense(rec, { checkedAt: rec.metadataCheckedAt, method: 'pixabay-api' });
    const rights = assessRights({ provider: 'pixabay', license: rec.license, kind: 'sticker', verification: rec.licenseCheck });
    rec.tier = rights.tier; rec.localStorageAllowed = true; rec.exportAllowed = !rights.blocked;
    Object.defineProperty(rec, 'downloadUrl', { value: file, enumerable: false });
    if (thumb) Object.defineProperty(rec, 'thumbUrl', { value: thumb, enumerable: false });
    return rec;
  }
  download(rec) { return { url: rec.downloadUrl, accept: /^(image\/png|application\/octet-stream)/i, maxBytes: 25 * 1024 ** 2 }; }
  preview(rec) { return rec.thumbUrl ? { url: rec.thumbUrl, fallback: rec.downloadUrl, accept: /^image\//i, maxBytes: 8 * 1024 ** 2 } : this.download(rec); }
  status() { return { configured: this.configured(), blockedFor: Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / 1000)) }; }
}
function safeUrl(u) { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : null; } catch { return null; } }
module.exports = { Pixabay, CATEGORIES };
