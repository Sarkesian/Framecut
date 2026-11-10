// Openverse adapter (audio for music / sound effects, transparent-friendly images for stickers):
// search, per-item detail (license re-check before import), and
// optional registered-app credentials. Anonymous access is limited to 20 requests/minute and
// 200/day, so results are cached and the client throttles itself before Openverse has to.
const { licenseFilter, assessRights, verifyLicense, includeMode } = require('../../shared/rights.mjs');
const { musicEvidence, canonicalAudioUrl } = require('../../shared/audio-library.mjs');
const { isWikimediaRecord, assertSourceAllowed } = require('./blocked-sources.cjs');

const API = 'https://api.openverse.org/v1';
const SOURCES = { jamendo: 'Jamendo', freesound: 'Freesound', ccmixter: 'ccMixter', svgsilh: 'SVG Silh', phylopic: 'PhyloPic' };
// Openverse has no CC0 / public-domain items in its "music" category (Jamendo is all CC BY variants),
// so attribution-free music is searched through Freesound without the category
// and short clips are left out.
const FREE_MUSIC_SOURCES = 'freesound';
const FREE_MUSIC_MIN_MS = 20e3;
// Duration filters are applied to the provider's reported durations (Openverse's own buckets are coarse).
const LENGTHS = { short: [0, 10e3], medium: [10e3, 60e3], long: [60e3, Infinity], song: [60e3, Infinity], clip: [0, 60e3] };

class Openverse {
  constructor({ http, credentials = () => null, base = API }) {
    this.id = 'openverse'; this.http = http; this.credentials = credentials; this.base = base;
    this.capabilities = new Set(['search', 'categories', 'preview', 'download', 'license-metadata', 'commercial-use', 'images']);
    this.token = null; this.blockedUntil = 0; this.window = []; this.daily = { day: '', n: 0 }; this.lastLimits = null;
  }
  // Self-throttle: stay under the anonymous burst limit and respect Retry-After.
  throttle() {
    const now = Date.now();
    if (now < this.blockedUntil) throw Object.assign(Error('Openverse asked FrameCut to slow down.'), { code: 'quota', retryAfter: Math.ceil((this.blockedUntil - now) / 1000) });
    this.window = this.window.filter(t => now - t < 60e3);
    const limit = this.token ? 90 : 18;
    if (this.window.length >= limit) throw Object.assign(Error('Search limit reached for this minute.'), { code: 'quota', retryAfter: Math.ceil((60e3 - (now - this.window[0])) / 1000) });
    this.window.push(now);
  }
  async auth() {
    const c = this.credentials(); if (!c?.clientId || !c?.clientSecret) { this.token = null; return {}; }
    if (this.token && this.token.exp > Date.now() + 30e3) return { Authorization: 'Bearer ' + this.token.value };
    const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'client_credentials' });
    const r = await this.http.json(this.base + '/auth_tokens/token/', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    this.token = { value: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
    return { Authorization: 'Bearer ' + this.token.value };
  }
  async call(path) {
    this.throttle();
    try {
      const r = await this.http.json(this.base + path, { headers: await this.auth() }, { onHeaders: h => { this.lastLimits = { burst: h.get('x-ratelimit-available-anon_burst'), daily: h.get('x-ratelimit-available-anon_sustained') }; } });
      return r;
    } catch (e) {
      if (e.status === 429) { const s = Math.max(5, Math.min(3600, +e.retryAfter || 60)); this.blockedUntil = Date.now() + s * 1000; throw Object.assign(Error('Openverse is limiting requests right now.'), { code: 'quota', retryAfter: s }); }
      if (e.code === 'gone') throw Object.assign(Error('This sound is no longer available on Openverse.'), { code: 'gone' });
      if ((e.status === 401 || e.status === 403) && this.token) { this.token = null; throw Object.assign(Error('Openverse rejected the API credentials. Check them in Preferences › Library.'), { code: 'auth' }); }
      throw e;
    }
  }
  async search({ q = '', kind = 'music', page = 1, usage = 'commercial', length, source, pageSize = 20, include = 'free' }) {
    assertSourceAllowed({ source });
    include = includeMode(include);
    const params = new URLSearchParams({ q: String(q).slice(0, 200), page: String(Math.max(1, Math.min(50, page | 0 || 1))), page_size: String(pageSize), license: licenseFilter(usage, kind, include).join(','), mature: 'false' });
    let path = '/audio/?', minMs = 0;
    if (kind === 'sticker') {
      // Stickers: illustrations in formats that can carry transparency.
      path = '/images/?'; params.set('extension', 'png,svg,gif'); params.set('category', 'illustration');
      params.set('source', SOURCES[source] ? source : 'svgsilh,phylopic');
    } else if (kind === 'sfx') params.set('source', SOURCES[source] ? source : 'freesound');
    // Openverse's category field is reliable for music (Jamendo) but empty for most Freesound sounds.
    else if (include === 'free') { params.set('source', SOURCES[source] && source !== 'jamendo' ? source : FREE_MUSIC_SOURCES); minMs = FREE_MUSIC_MIN_MS; }
    else { params.set('category', 'music'); if (SOURCES[source]) params.set('source', source); }
    const data = await this.call(path + params);
    const seen = new Set(); const items = []; let dropped = 0;
    for (const r of data.results || []) {
      const rec = this.normalize(r, kind); if (!rec) continue;
      // Wikimedia Commons lists MIDI and Ogg-container files as audio; neither can be previewed or placed on a timeline.
      if (kind !== 'sticker' && /^(mid|midi|kar|ogx)$/i.test(rec.filetype || '')) continue;
      if (!rec.licenseCheck.ok) { dropped++; continue; } // unknown / contradictory license data is never offered
      if (rec.durationMs != null && rec.durationMs < minMs) continue;
      if (kind === 'music' && (!rec.musicEvidence?.length || !Number.isFinite(rec.durationMs))) continue;
      if (LENGTHS[length] && !(rec.durationMs >= LENGTHS[length][0] && rec.durationMs < LENGTHS[length][1])) continue;
      const dupe = (rec.title + '|' + rec.creator).toLowerCase(); if (seen.has(rec.sourceId) || seen.has(dupe)) continue;
      seen.add(rec.sourceId); seen.add(dupe); items.push(rec);
    }
    return { items, total: data.result_count || 0, page: data.page || page, pages: Math.min(data.page_count || 0, 50), dropped };
  }
  async getAsset(id, kind) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('Invalid Openverse id.');
    const r = await this.call(`/${kind === 'sticker' ? 'images' : 'audio'}/${id}/`);
    const rec = this.normalize(r, kind); if (!rec) throw Object.assign(Error(`This ${kind === 'sticker' ? 'image' : 'sound'} is no longer available on Openverse.`), { code: 'gone' });
    return rec;
  }
  normalize(r, kind) {
    if (!r || !r.id || !r.url || r.mature) return null;
    if (isWikimediaRecord(r)) return null;
    let downloadUrl; try { const u = new URL(r.url); if (u.protocol !== 'https:' && !(this.http.allowLocal && u.hostname === '127.0.0.1')) return null; downloadUrl = u.href; } catch { return null; }
    const k = kind || (r.category === 'sound_effect' ? 'sfx' : 'music'); const image = k === 'sticker';
    const rec = {
      provider: 'openverse', sourceId: r.id, kind: k, title: String(r.title || 'Untitled').replace(/\.(wav|mp3|ogg|flac|aiff?|m4a|opus)$/i, '').slice(0, 200), creator: r.creator ? String(r.creator).slice(0, 120) : '', creatorUrl: safeUrl(r.creator_url),
      sourcePageUrl: safeUrl(r.foreign_landing_url), source: r.source || r.provider, sourceName: SOURCES[r.source] || r.source || r.provider,
      durationMs: !image && Number.isFinite(+r.duration) && +r.duration > 0 ? +r.duration : null, filetype: r.filetype || null,
      ...(image ? { width: +r.width || null, height: +r.height || null, animated: r.filetype === 'gif' } : {}),
      license: String(r.license || '').toLowerCase(), licenseVersion: r.license_version || null, licenseUrl: safeUrl(r.license_url), attribution: r.attribution || null,
      tags: (r.tags || []).map(t => t.name).filter(n => n && n.length < 30 && !/^speed_|^(neutral)$/.test(n)).slice(0, 6), genres: (r.genres || []).slice(0, 4), album: r.audio_set?.title || null,
      licenseEvidenceUrl: safeUrl(r.detail_url), metadataCheckedAt: new Date().toISOString(),
    };
    rec.licenseCheck = verifyLicense(rec, { checkedAt: rec.metadataCheckedAt, method: 'openverse-search' });
    const rights = assessRights({ provider: 'openverse', license: rec.license, licenseVersion: rec.licenseVersion, kind: k, usage: 'personal', verification: rec.licenseCheck });
    rec.tier = rights.tier; rec.localStorageAllowed = rights.storage; rec.exportAllowed = rights.blocked ? false : 'license';
    if (!image) { rec.canonicalKey = canonicalAudioUrl(downloadUrl); rec.musicEvidence = musicEvidence({ ...rec, tags: (r.tags || []).map(t => t.name).filter(Boolean), category: r.category, description: r.description || '' }); }
    Object.defineProperty(rec, 'downloadUrl', { value: downloadUrl, enumerable: false });
    return rec;
  }
  download(rec) {
    assertSourceAllowed(rec);
    if (rec.kind === 'sticker') return { url: rec.downloadUrl, accept: /^(image\/(png|apng|gif|svg\+xml)|application\/octet-stream|binary\/octet-stream)/i, maxBytes: 25 * 1024 ** 2 };
    return { url: rec.downloadUrl, accept: /^(audio\/|application\/ogg|video\/ogg|application\/octet-stream|binary\/octet-stream)/i, maxBytes: 300 * 1024 ** 2 };
  }
  preview(rec) { return this.download(rec); }
  status() { return { anonymous: !this.token, blockedFor: Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / 1000)), limits: this.lastLimits }; }
}
function safeUrl(u) { try { const x = new URL(u); return ['https:', 'http:'].includes(x.protocol) ? x.href : null; } catch { return null; } }
module.exports = { Openverse, SOURCES };
