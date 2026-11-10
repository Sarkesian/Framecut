const { verifyLicense, assessRights, parseLicenseUrl } = require('../../shared/rights.mjs');
const { musicEvidence, matchesDuration, plain, canonicalAudioUrl } = require('../../shared/audio-library.mjs');
const { MetadataCache } = require('./metadata.cjs');
const duration = x => typeof x === 'number' || /^\d+(\.\d+)?$/.test(String(x)) ? +x : String(x || '').split(':').reduce((n, p) => n * 60 + (+p || 0), 0);
const list = x => (Array.isArray(x) ? x : x ? [x] : []);
const cc0 = url => { const p = parseLicenseUrl(url); return p?.code === 'cc0' && p.version === '1.0'; };
class Archive {
  constructor({ http, base = 'https://archive.org', cacheFile }) {
    this.id = 'archive'; this.http = http; this.base = base.replace(/\/$/, ''); this.cacheTtl = 0;
    this.cache = new MetadataCache(cacheFile); this.queries = new Map(); this.blockedUntil = 0; this.nextCall = 0; this.chain = Promise.resolve();
  }
  async call(path, { fresh = false } = {}) {
    const url = this.base + path;
    return this.cache.get(url, () => {
      const next = this.chain.catch(() => {}).then(async () => {
        if (Date.now() < this.blockedUntil) throw Object.assign(Error('Internet Archive is taking a short break.'), { code: 'quota', retryAfter: Math.ceil((this.blockedUntil - Date.now()) / 1000) });
        const wait = this.nextCall - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); this.nextCall = Date.now() + 1000;
        try { const d = await this.http.json(url, { timeout: 30000, headers: { 'User-Agent': 'FrameCutStudio/1.0 (local video editor; user-initiated CC0 music discovery)' } }); if (d.error) throw Error(d.error); return d; }
        catch (e) { if (e.status === 429) { const seconds = Math.max(5, +e.retryAfter || 60); this.blockedUntil = Date.now() + seconds * 1000; e.code = 'quota'; e.retryAfter = seconds; } throw e; }
      });
      this.chain = next; return next;
    }, { stale: !fresh, ttl: fresh ? 0 : 24 * 3600e3 });
  }
  async search({ q = '', kind = 'music', page = 1, length = '', pageSize = 20 }) {
    if (kind !== 'music') return { items: [], total: 0, page, pages: 0 };
    const key = JSON.stringify([q, length]); let state = this.queries.get(key);
    if (!state) {
      state = { items: [], seen: new Set(), docs: [], sourcePage: 1, done: false, lock: Promise.resolve(), scanned: 0, offsets: new Map([[1, 0]]) };
      this.queries.set(key, state); if (this.queries.size > 24) this.queries.delete(this.queries.keys().next().value);
    }
    const run = state.lock.catch(() => {}).then(async () => {
      let scanned = 0;
      const from = state.offsets.get(page) ?? (page - 1) * pageSize;
      while (state.items.length < from + pageSize && (!state.done || state.docs.length) && scanned < 12) {
        if (!state.docs.length) {
          const terms = String(q).replace(/[":{}|\\]/g, ' ').trim() || 'instrumental';
          const query = `mediatype:audio AND licenseurl:("http://creativecommons.org/publicdomain/zero/1.0/" OR "https://creativecommons.org/publicdomain/zero/1.0/") AND creator:* AND (${terms}) AND NOT collection:(librivoxaudio OR podcasts)`;
          const data = await this.call('/advancedsearch.php?' + new URLSearchParams({ q: query, 'fl[]': 'identifier', rows: '12', page: String(state.sourcePage), output: 'json' }));
          state.sourcePage++;
          state.docs = data.response?.docs || []; state.done = (data.response?.start || 0) + state.docs.length >= (data.response?.numFound || 0);
          if (!state.docs.length) break;
        }
        const row = state.docs.shift(); scanned++; state.scanned++;
        if (!/^[a-zA-Z0-9][\w.-]{0,199}$/.test(row.identifier || '')) continue;
        let data; try { data = await this.call('/metadata/' + encodeURIComponent(row.identifier)); } catch (e) { if (e.code === 'gone') continue; state.docs.unshift(row); throw e; }
        for (const rec of this.records(data, row.identifier)) if (!state.seen.has(rec.sourceId) && matchesDuration(rec.durationMs, length)) { state.seen.add(rec.sourceId); state.items.push(rec); }
      }
      const end = Math.min(state.items.length, from + pageSize); state.offsets.set(page + 1, end);
      const more = !state.done || state.docs.length > 0 || state.items.length > end;
      return { items: state.items.slice(from, end), total: state.items.length, page, pages: more ? page + 1 : page, totalExact: !more };
    });
    state.lock = run; return run;
  }
  records(data, identifier) {
    const m = data.metadata || {}, licenses = list(m.licenseurl);
    if (data.is_dark || m.mediatype !== 'audio' || !licenses.length || !licenses.every(cc0)) return [];
    const creator = plain(list(m.creator).join(', ')); if (!creator || /^(unknown|various|various artists|n\/?a)$/i.test(creator)) return [];
    const subjects = list(m.subject).flatMap(s => String(s).split(';')).map(plain);
    const evidence = musicEvidence({ title: plain(m.title), tags: subjects, description: plain(m.description) }); if (!evidence.length) return [];
    const files = Array.isArray(data.files) ? data.files : [], byName = new Map(files.map(f => [f.name, f]));
    const chosen = new Map();
    for (const f of files) {
      if (!/\.(mp3|ogg|oga|flac|wav|m4a|opus)$/i.test(f.name || '') || f.private === true || f.private === 'true' || !(+f.size > 0) || +f.size > 250 * 1024 ** 2) continue;
      const original = f.source === 'original' ? f : byName.get(f.original); if (!original) continue;
      if ([f.licenseurl, original.licenseurl].some(v => v && !list(v).every(cc0))) continue;
      const seconds = duration(f.length || original.length); if (!(seconds >= 20) || !Number.isFinite(seconds)) continue;
      const rank = /\.mp3$/i.test(f.name) ? 0 : /\.(ogg|oga|opus)$/i.test(f.name) ? 1 : /\.m4a$/i.test(f.name) ? 2 : 3;
      const old = chosen.get(original.name); if (!old || rank < old.rank) chosen.set(original.name, { f, original, rank, seconds });
    }
    return [...chosen.values()].map(({ f, original, seconds }) => {
      const title = plain(f.title || original.title || (chosen.size === 1 ? m.title : f.name.replace(/\.[^.]+$/, '').replace(/^\d+[ ._-]+/, '')));
      const url = this.base + '/download/' + encodeURIComponent(identifier) + '/' + f.name.split('/').map(encodeURIComponent).join('/');
      const rec = { provider: this.id, sourceId: identifier + '~' + Buffer.from(f.name).toString('base64url'), kind: 'music', title, creator, album: plain(m.title), sourceName: 'Internet Archive', sourcePageUrl: this.base + '/details/' + encodeURIComponent(identifier), license: 'cc0', licenseVersion: '1.0', licenseUrl: licenses[0], licenseEvidenceUrl: this.base + '/metadata/' + encodeURIComponent(identifier), metadataCheckedAt: new Date().toISOString(), durationMs: Math.round(seconds * 1000), filetype: f.name.split('.').at(-1).toLowerCase(), tags: subjects.slice(0, 6), description: plain(m.description).slice(0, 500), musicEvidence: evidence, canonicalKey: canonicalAudioUrl(url), originalFileName: original.name, sourceFileName: f.name };
      rec.licenseCheck = verifyLicense(rec, { method: 'archive-item-and-file-metadata' });
      rec.tier = assessRights({ provider: this.id, license: 'cc0', licenseVersion: '1.0', verification: rec.licenseCheck }).tier;
      Object.defineProperty(rec, 'downloadUrl', { value: url, enumerable: false });
      if (/^[0-9a-f]{40}$/i.test(f.sha1 || '')) Object.defineProperty(rec, 'expectedSha1', { value: f.sha1.toLowerCase(), enumerable: false });
      return rec;
    }).filter(r => r.licenseCheck.ok);
  }
  async getAsset(id) {
    const [identifier, encoded] = String(id).split('~');
    if (!/^[a-zA-Z0-9][\w.-]{0,199}$/.test(identifier || '') || !/^[\w-]+$/.test(encoded || '')) throw Error('Invalid Internet Archive audio id.');
    const data = await this.call('/metadata/' + encodeURIComponent(identifier), { fresh: true });
    const rec = this.records(data, identifier).find(r => r.sourceId === id);
    if (!rec) throw Object.assign(Error('This file no longer has eligible CC0 music metadata.'), { code: 'license' }); return rec;
  }
  download(rec) { return { url: rec.downloadUrl, accept: /^(audio\/|application\/ogg|application\/octet-stream)/i, maxBytes: 250 * 1024 ** 2 }; }
  preview(rec) { return this.download(rec); }
  status() { return { blockedFor: Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / 1000)) }; }
}
module.exports = { Archive };
