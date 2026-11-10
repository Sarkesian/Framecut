const { createHash } = require('node:crypto');
const { verifyLicense, assessRights, parseLicenseUrl } = require('../../shared/rights.mjs');
const { matchesDuration, canonicalAudioUrl } = require('../../shared/audio-library.mjs');
const { MetadataCache } = require('./metadata.cjs');
const BASE = 'https://sfxmint.com';
// Published category slugs. Sets below are loaded from the supported API.
const CATEGORIES = [['ui', 'UI & notifications'], ['impact', 'Impacts & hits'], ['magic-scifi', 'Magic & sci-fi'], ['ambience', 'Nature & ambience'], ['retro-game', 'Retro games']];
class SfxMint {
  constructor({ http, base = BASE, credentials = () => null, cacheFile }) {
    this.id = 'sfxmint'; this.http = http; this.base = base.replace(/\/$/, ''); this.credentials = credentials; this.cacheTtl = 0;
    this.cache = new MetadataCache(cacheFile); this.lastError = null;
    this.blockedUntil = 0;
  }
  configured() { return !!this.credentials()?.key; }
  async call(path, { stale = true } = {}) {
    const key = this.credentials()?.key || '';
    const namespace = createHash('sha256').update(key).digest('hex').slice(0, 16);
    const saved = this.cache.entries.get(namespace + ':quota')?.value;
    this.blockedUntil = saved?.until || 0;
    this.lastError = saved?.message || null;
    return this.cache.get(namespace + path, async () => {
      if (Date.now() < this.blockedUntil) throw Object.assign(Error(this.lastError || 'SFXMint’s free lookup allowance is paused. Your other sound sources still work.'), { code: 'quota', retryAfter: Math.ceil((this.blockedUntil - Date.now()) / 1000) });
      try {
        const data = await this.http.json(this.base + '/api/v1' + path, { timeout: 20000, headers: key ? { Authorization: 'Bearer ' + key } : {} });
        this.lastError = null; return data;
      } catch (e) {
        let body; try { body = JSON.parse(e.body || '{}'); } catch {}
        this.lastError = body?.message || e.message;
        if (e.status === 429) {
          const seconds = Math.max(1, +e.retryAfter || +body?.retry_after || 60); this.blockedUntil = Date.now() + seconds * 1000;
          this.cache.set(namespace + ':quota', { until: this.blockedUntil, message: this.lastError });
          throw Object.assign(Error(this.lastError), { code: 'quota', retryAfter: seconds });
        }
        throw e;
      }
    }, { stale, ttl: stale ? 24 * 3600e3 : 0 });
  }
  async categories() {
    const basics = CATEGORIES.map(([id, name]) => ({ id: 'category:' + id, name }));
    try { const sets = await this.call('/sets'); return [...basics, ...(Array.isArray(sets) ? sets : []).map(s => ({ id: 'set:' + s.id, name: s.name, group: 'set', description: s.tagline }))]; }
    catch { return basics; }
  }
  async search({ q = '', kind = 'sfx', page = 1, category = '', length = '' }) {
    if (kind !== 'sfx' || page > 1) return { items: [], total: 0, page, pages: 0 };
    let records, evidenceUrl;
    if (category.startsWith('set:')) {
      const id = category.slice(4); if (!/^[a-z0-9-]+$/.test(id)) throw Error('Invalid SFXMint collection.');
      evidenceUrl = this.base + '/api/v1/sets/' + id + '?format=mp3';
      const data = await this.call('/sets/' + id + '?format=mp3');
      records = Object.values(data.sounds || {}).flatMap(r => [r, ...(r.alternates || [])]);
    } else {
      const params = new URLSearchParams({ q: String(q).slice(0, 200), limit: '50', format: 'mp3' });
      if (category.startsWith('category:')) params.set('category', category.slice(9));
      if (length === 'short') params.set('max_duration_ms', '10000');
      if (length === 'medium') params.set('max_duration_ms', '60000');
      evidenceUrl = this.base + '/api/v1/search?' + params;
      const data = await this.call('/search?' + params); records = Array.isArray(data) ? data : data.candidates || [];
    }
    const items = [], seen = new Set();
    for (const row of records) {
      const r = this.normalize(row, evidenceUrl);
      if (!r || seen.has(r.sourceId) || !matchesDuration(r.durationMs, length)) continue;
      if (q && category.startsWith('set:') && ![r.title, ...r.tags].join(' ').toLowerCase().includes(q.toLowerCase())) continue;
      seen.add(r.sourceId); items.push(r);
    }
    return { items, total: items.length, page: 1, pages: 1, limit: 50, totalExact: false };
  }
  normalize(r, evidenceUrl) {
    if (!r || !/^[a-z0-9][a-z0-9-]{0,159}$/.test(r.slug || '') || !/^cc0(?:-1\.0| 1\.0)?$/i.test(r.license || '')) return null;
    if (r.recommendation_status && r.recommendation_status !== 'eligible') return null;
    if (r.license_url) { const p = parseLicenseUrl(r.license_url); if (p?.code !== 'cc0' || p.version !== '1.0') return null; }
    const format = r.format_metadata?.mp3;
    if (!format || format.decodable === false || format.signal_ok === false || format.signal_nonempty === false) return null;
    let url; try { url = new URL(r.mp3_url); if ((url.protocol !== 'https:' || url.origin !== new URL(this.base).origin || !/^\/dl\/[a-z0-9-]+\.mp3$/.test(url.pathname)) && !this.http.allowLocal) return null; } catch { return null; }
    const ms = +(format.duration_ms || r.duration_ms); if (!Number.isFinite(ms) || ms <= 0) return null;
    const hash = format.sha256 || format.remote_sha256; if (!/^[a-f0-9]{64}$/i.test(hash || '')) return null;
    const rec = { provider: this.id, sourceId: r.slug, kind: 'sfx', title: String(r.title || r.slug).slice(0, 160), creator: 'SFXMint', sourceName: 'SFXMint', sourcePageUrl: r.page_url || this.base + '/sounds/' + r.slug, license: 'cc0', licenseVersion: '1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', licenseEvidenceUrl: evidenceUrl, metadataCheckedAt: new Date().toISOString(), durationMs: ms, filetype: 'mp3', tags: (r.tags || []).map(String).slice(0, 8), description: String(r.description || '').slice(0, 500), category: r.category, acoustics: r.acoustics || null, canonicalKey: canonicalAudioUrl(url.href), previewUrl: url.href };
    rec.licenseCheck = verifyLicense(rec, { method: 'sfxmint-file-metadata' });
    rec.tier = assessRights({ provider: this.id, license: 'cc0', licenseVersion: '1.0', kind: 'sfx', verification: rec.licenseCheck }).tier;
    Object.defineProperty(rec, 'downloadUrl', { value: url.href, enumerable: false }); Object.defineProperty(rec, 'expectedSha256', { value: hash.toLowerCase(), enumerable: false });
    return rec.licenseCheck.ok ? rec : null;
  }
  async getAsset(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,159}$/.test(String(id))) throw Error('Invalid SFXMint sound id.');
    const path = '/sounds/' + encodeURIComponent(id), data = await this.call(path, { stale: false });
    const rec = this.normalize(data, this.base + '/api/v1' + path);
    if (!rec) throw Object.assign(Error('SFXMint did not provide matching CC0 and playable MP3 file evidence for this sound.'), { code: 'license' }); return rec;
  }
  download(rec) { return { url: rec.downloadUrl, accept: /^(audio\/mpeg|audio\/mp3|application\/octet-stream)/i, maxBytes: 25 * 1024 ** 2 }; }
  preview(rec) { return this.download(rec); }
  status() { return { configured: this.configured(), blockedFor: Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / 1000)), lookupLimit: this.configured() ? 100 : 20, downloadLimit: this.configured() ? 20 : 5, error: this.lastError }; }
}
module.exports = { SfxMint };
