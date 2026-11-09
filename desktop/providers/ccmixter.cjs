// ccMixter (https://ccmixter.org) query API: music uploads with per-upload Creative Commons licenses.
// Attribution-free mode asks only for CC0 uploads ("lic=zero"); credit mode adds CC BY. Every result's
// license is re-read from its own license_url and checked like any other source. No key needed.
// ccMixter tracks are no longer indexed by Openverse, so nothing here is duplicated there.
const { verifyLicense, assessRights, includeMode } = require('../../shared/rights.mjs');

const API = 'https://ccmixter.org/api/query';
const LIC = { free: 'zero', credit: 'zero,by', all: 'zero,by' };
const toMs = ps => { const m = /^(?:(\d+):)?(\d+):(\d{2})$/.exec(String(ps || '').trim()); return m ? ((+(m[1] || 0) * 60 + +m[2]) * 60 + +m[3]) * 1000 : null; };
const CODE = { 'publicdomain/zero': 'cc0', 'licenses/by': 'by', 'licenses/by-nc': 'by-nc', 'licenses/sampling+': 'sampling+', 'licenses/by-sa': 'by-sa', 'licenses/by-nd': 'by-nd', 'licenses/by-nc-sa': 'by-nc-sa', 'licenses/by-nc-nd': 'by-nc-nd', 'licenses/nc-sampling+': 'nc-sampling+' };

class CcMixter {
  constructor({ http, base = API }) {
    this.id = 'ccmixter'; this.http = http; this.base = base;
    this.capabilities = new Set(['search', 'preview', 'download', 'license-metadata', 'commercial-use']);
    this.window = [];
  }
  throttle() {
    const now = Date.now(); this.window = this.window.filter(t => now - t < 60e3);
    if (this.window.length >= 30) throw Object.assign(Error('ccMixter search limit reached for this minute.'), { code: 'quota', retryAfter: Math.ceil((60e3 - (now - this.window[0])) / 1000) });
    this.window.push(now);
  }
  // ccMixter's TLS handshake can take 3–25 s; opening the (kept-alive) connection ahead of the first
  // search hides most of that. Cheap: a count query.
  warm() { if (Date.now() - (this.warmedAt || 0) < 30e3) return; this.warmedAt = Date.now(); this.http.json(this.base + '?f=count&lic=zero', { timeout: 60000 }).catch(() => {}); }
  async query(params) { this.throttle(); const d = await this.http.json(this.base + '?' + new URLSearchParams({ f: 'json', ...params }), { timeout: 60000 }); return Array.isArray(d) ? d : []; }
  async search({ q = '', page = 1, include = 'free', length, pageSize = 20 }) {
    const lic = LIC[includeMode(include)]; page = Math.max(1, Math.min(50, page | 0 || 1));
    const params = { lic, limit: String(pageSize), offset: String((page - 1) * pageSize), sort: 'rank', ord: 'DESC', tags: 'audio' };
    if (q) Object.assign(params, { search: String(q).slice(0, 100), search_type: 'all' });
    const rows = await this.query(params);
    const LEN = { clip: [0, 60e3], song: [60e3, Infinity] }[length];
    const items = rows.map(r => this.normalize(r)).filter(r => r && (!LEN || (r.durationMs != null && r.durationMs >= LEN[0] && r.durationMs < LEN[1])));
    // No separate count request (ccMixter can be slow): another page is offered while pages come back full.
    const more = rows.length >= pageSize;
    return { items, total: (page - 1) * pageSize + rows.length + (more ? 1 : 0), page, pages: more ? page + 1 : page };
  }
  async getAsset(id) {
    if (!/^\d{1,9}$/.test(String(id))) throw Error('Invalid ccMixter id.');
    const rec = (await this.query({ ids: String(id) })).map(r => this.normalize(r)).find(Boolean);
    if (!rec) throw Object.assign(Error('This track is no longer available on ccMixter.'), { code: 'gone' });
    return rec;
  }
  normalize(r) {
    if (!r || !r.upload_id || r.upload_extra?.nsfw) return null;
    const audio = (r.files || []).filter(f => f.file_format_info?.['media-type'] === 'audio' && /^https:\/\//.test(f.download_url || ''));
    const file = audio.find(f => f.file_format_info['default-ext'] === 'mp3') || audio[0]; if (!file) return null;
    let licUrl = null, code = null;
    let version = null;
    try { const u = new URL(r.license_url); u.protocol = 'https:'; licUrl = u.href; const m = /\/(licenses\/[a-z+-]+|publicdomain\/zero)\/(\d\.\d)/.exec(u.pathname); code = m ? CODE[m[1]] : null; version = m?.[2] || null; } catch {}
    const rec = {
      provider: 'ccmixter', sourceId: String(r.upload_id), kind: 'music', title: String(r.upload_name || 'Untitled').slice(0, 200), creator: String(r.user_real_name || r.user_name || '').slice(0, 120), creatorUrl: r.artist_page_url || null,
      sourcePageUrl: r.file_page_url || null, sourceName: 'ccMixter', durationMs: toMs(file.file_format_info.ps), filetype: file.file_format_info['default-ext'] || null,
      tags: String(r.upload_extra?.usertags || '').split(',').filter(t => t && t.length < 24 && !/^\d+bpm$/.test(t)).slice(0, 6), bpm: +r.upload_extra?.bpm || null,
      license: code || String(r.license_name || '').toLowerCase(), licenseVersion: version, licenseUrl: licUrl, attribution: null, licenseEvidenceUrl: r.file_page_url || null, metadataCheckedAt: new Date().toISOString(),
    };
    rec.licenseCheck = verifyLicense(rec, { checkedAt: rec.metadataCheckedAt, method: 'ccmixter-api' });
    rec.tier = assessRights({ provider: 'ccmixter', license: rec.license, licenseVersion: version, kind: 'music', usage: 'commercial', verification: rec.licenseCheck }).tier;
    Object.defineProperty(rec, 'downloadUrl', { value: file.download_url, enumerable: false });
    return rec;
  }
  download(rec) { return { url: rec.downloadUrl, accept: /^(audio\/|application\/ogg|application\/octet-stream|binary\/octet-stream)/i, maxBytes: 200 * 1024 ** 2, timeout: 60000 }; }
  preview(rec) { return this.download(rec); }
}
module.exports = { CcMixter };
