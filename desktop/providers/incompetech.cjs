// Incompetech (https://incompetech.com): Kevin MacLeod's music catalog, about 1,400 finished pieces, all
// offered under CC BY 4.0 ("Creative Commons — Free. Requires that you credit the music"). The site
// publishes a catalog API for automated tools (https://incompetech.com/.well-known/openapi.yaml):
// one JSON list of pieces with genre, feel, instruments, tempo and length. FrameCut fetches that list
// at most once a week, keeps it in the metadata cache and searches it locally, so browsing costs the
// site nothing and works offline once loaded. Only the tracks a user plays or adds are downloaded.
const { verifyLicense } = require('../../shared/rights.mjs');
const { matchesDuration, lensById } = require('../../shared/audio-library.mjs');
const { MetadataCache } = require('./metadata.cjs');

const BASE = 'https://incompetech.com/music/royalty-free';
const WEEK = 7 * 24 * 3600e3;
// Genre ids as published at /genre.json (checked 11 November 2026).
const GENRES = { 2: 'African', 3: 'Blues', 4: 'Classical', 5: 'Contemporary', 6: 'Disco', 7: 'Electronica', 8: 'Funk', 9: 'Holiday', 10: 'Horror', 11: 'Jazz', 12: 'Latin', 13: 'Modern', 14: 'Musical', 15: 'Polka', 16: 'Pop', 18: 'Reggae', 19: 'Rock', 20: 'Silent Film Score', 21: 'Ska', 22: 'Soundtrack', 23: 'Stings', 24: 'Unclassifiable', 25: 'World', 26: 'Urban' };
// Everyday words people browse by, mapped onto the catalog's own "feel" and genre labels. These only
// widen what a word finds; the labels themselves come from the catalog.
const ALSO = {
  humorous: 'funny quirky comedy silly goofy playful cartoon', bouncy: 'playful upbeat happy fun quirky', bright: 'happy upbeat positive cheerful uplifting',
  uplifting: 'inspirational inspiring happy hopeful motivational', calming: 'calm relaxing chill peaceful ambient meditation', relaxed: 'chill calm relaxing lounge easy background',
  dark: 'suspense dramatic', suspenseful: 'suspense tension thriller dramatic', mysterious: 'mystery suspense', epic: 'cinematic trailer dramatic heroic', intense: 'dramatic energetic trailer',
  driving: 'energetic upbeat', action: 'energetic gaming trailer chase', aggressive: 'energetic metal hard', somber: 'sad emotional melancholy', mystical: 'fantasy magical emotional',
  eerie: 'horror scary creepy suspense', unnerving: 'horror scary creepy tension', grooving: 'groove funky upbeat',
  electronica: 'electronic edm synth techno dance', soundtrack: 'cinematic film score background', classical: 'orchestral piano', contemporary: 'modern background', 'silent film score': 'piano vintage comedy ragtime',
  funk: 'funky groove', urban: 'hip hop hip-hop beat', world: 'ethnic folk', stings: 'intro outro jingle logo short', holiday: 'christmas festive', disco: 'dance retro', polka: 'folk comedy', latin: 'salsa dance', african: 'world drums',
  rock: 'guitar', jazz: 'swing lounge', blues: 'guitar', reggae: 'dub', pop: 'upbeat',
};
const seconds = s => String(s || '').split(':').reduce((n, p) => n * 60 + (+p || 0), 0);
const split = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

class Incompetech {
  constructor({ http, base = BASE, cacheFile }) {
    this.id = 'incompetech'; this.http = http; this.base = base.replace(/\/$/, ''); this.cacheTtl = 0; // searched locally: nothing to cache per query
    this.capabilities = new Set(['search', 'categories', 'preview', 'download', 'license-metadata', 'commercial-use', 'offline-search']);
    this.cache = new MetadataCache(cacheFile, { maxEntries: 4 }); this.rows = null; this.rowsAt = 0;
  }
  warm() { this.catalog().catch(() => {}); }
  // The whole catalog, trimmed to the fields FrameCut uses. A stale copy is used when the site can't be reached.
  async catalog() {
    if (this.rows && Date.now() - this.rowsAt < 3600e3) return this.rows;
    const list = await this.cache.get('pieces', async () => {
      const data = await this.http.json(this.base + '/pieces.json', { timeout: 30000 });
      if (!Array.isArray(data) || !data.length) throw Object.assign(Error('Incompetech sent an empty catalog.'), { code: 'http' });
      return data.filter(p => p && p.title && /^[^/\\]+\.mp3$/i.test(p.filename || '') && /^[A-Z0-9]{12}$/i.test(p.isrc || '')).map(p => ({ t: String(p.title).slice(0, 160), f: p.filename, s: seconds(p.length), i: String(p.instruments || '').slice(0, 200), g: GENRES[p.genre] || '', b: +p.bpm || 0, d: String(p.description || '').slice(0, 400), m: String(p.feel || '').slice(0, 120), u: String(p.uploaded || '').slice(0, 10), k: p.isrc.toUpperCase() }));
    }, { ttl: WEEK, stale: true });
    this.rows = list.filter(p => p.s > 0).map(p => {
      const labels = [...split(p.m), p.g].filter(Boolean);
      const text = parts => ' ' + parts.join(' ').toLowerCase().replace(/[^\p{L}\p{N}&'-]+/gu, ' ');
      // `own`: the catalog's words only. `words`: plus the everyday words its labels stand for.
      return { p, own: text([p.t, p.g, p.m, p.i, p.d]), words: text([p.t, p.g, p.m, p.i, p.d, ...labels.map(l => ALSO[l.toLowerCase()] || '')]) };
    // Newest first; the few very long pieces (10 minutes to nearly an hour, up to 116 MB) come after the rest so a
    // category doesn't open on a download that takes minutes.
    }).sort((a, b) => (a.p.s > 600) - (b.p.s > 600) || b.p.u.localeCompare(a.p.u));
    this.byId = new Map(this.rows.map(r => [r.p.k, r.p])); this.rowsAt = Date.now();
    return this.rows;
  }
  async categories() {
    const rows = await this.catalog(); const count = new Map();
    for (const { p } of rows) for (const l of [p.g && 'genre:' + p.g, ...split(p.m).map(m => 'feel:' + m)]) if (l) count.set(l, (count.get(l) || 0) + 1);
    return [...count].filter(([, n]) => n >= 10).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: id.slice(id.indexOf(':') + 1), count: n, group: id.split(':')[0] }));
  }
  async search({ q = '', kind = 'music', page = 1, length = '', category = '', lens = '', pageSize = 20 }) {
    if (kind !== 'music') return { items: [], total: 0, page, pages: 0 };
    const rows = await this.catalog();
    // A browsing lens is answered from the catalog's own genre and feel labels when it has matching ones,
    // otherwise from the lens's words as they appear in the catalog (no widening: “Trance” means trance).
    const L = lens ? lensById(lens) : null, labelled = !!(L && (L.feel || L.genre));
    const feels = new Set((L?.feel || []).map(x => x.toLowerCase())), genres = new Set((L?.genre || []).map(x => x.toLowerCase()));
    if (L && !labelled && L.inc === false) return { items: [], total: 0, page, pages: 0 };
    const words = s => String(s).toLowerCase().split(/[^\p{L}\p{N}&'-]+/u).filter(t => t && !['music', 'and', 'the'].includes(t));
    // An unlabelled lens must match as a phrase ("hip hop"), a typed search word by word.
    const terms = labelled ? [] : L ? [words(L.query.replace(/ music$/, '')).join(' ')] : words(q);
    const field = L ? 'own' : 'words';
    const [group, label] = /^(genre|feel):/.test(category) ? [category.slice(0, category.indexOf(':')), category.slice(category.indexOf(':') + 1).toLowerCase()] : [];
    let hits = rows.filter(r => { const p = r.p; return matchesDuration(p.s * 1000, length) && (!group || (group === 'genre' ? p.g.toLowerCase() === label : split(p.m).some(m => m.toLowerCase() === label))) && (!labelled || genres.has(p.g.toLowerCase()) || split(p.m).some(m => feels.has(m.toLowerCase()))) && terms.every(t => r[field].includes(' ' + t)); }); // word-prefix match: “calm” finds “calming”, “rock” does not find “baroque”
    // A word in the title or the catalog's own labels outranks one found only in the description.
    if (terms.length) hits = hits.map(h => [h, terms.some(t => h.p.t.toLowerCase().includes(t)) ? 0 : terms.some(t => (h.p.g + ' ' + h.p.m).toLowerCase().includes(t)) ? 1 : 2]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    page = Math.max(1, page | 0 || 1); const start = (page - 1) * pageSize;
    return { items: hits.slice(start, start + pageSize).map(h => this.normalize(h.p)), total: hits.length, page, pages: Math.ceil(hits.length / pageSize) };
  }
  async getAsset(id) {
    if (!/^[A-Z0-9]{12}$/.test(String(id))) throw Error('Invalid Incompetech track id.');
    await this.catalog(); const p = this.byId.get(id);
    if (!p) throw Object.assign(Error('This track is no longer in the Incompetech catalog.'), { code: 'gone' });
    return this.normalize(p);
  }
  normalize(p) {
    const page = `${this.base}/index.html?isrc=${p.k}`;
    const rec = {
      provider: 'incompetech', sourceId: p.k, kind: 'music', title: p.t, creator: 'Kevin MacLeod', creatorUrl: 'https://incompetech.com', sourceName: 'Incompetech', sourcePageUrl: page,
      durationMs: p.s * 1000, filetype: 'mp3', bpm: p.b || null, genres: p.g ? [p.g] : [], tags: split(p.m).slice(0, 6), description: [p.d, p.i && 'Instruments: ' + p.i + '.'].filter(Boolean).join(' '),
      license: 'by', licenseVersion: '4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', licenseEvidenceUrl: page, metadataCheckedAt: new Date(this.cache.entries.get('pieces')?.at || Date.now()).toISOString(),
      // The credit wording the composer asks for, in the sentence form FrameCut's credit lists use.
      attribution: `“${p.t}” by Kevin MacLeod (incompetech.com) is licensed under CC BY 4.0.`,
    };
    rec.licenseCheck = verifyLicense(rec, { checkedAt: rec.metadataCheckedAt, method: 'incompetech-catalog' }); rec.tier = 'credit';
    Object.defineProperty(rec, 'downloadUrl', { value: `${this.base}/mp3-royaltyfree/${encodeURIComponent(p.f)}`, enumerable: false });
    return rec;
  }
  // The site serves its MP3s as application/octet-stream.
  download(rec) { return { url: rec.downloadUrl, accept: /^(audio\/|application\/octet-stream|binary\/octet-stream)/i, maxBytes: 200 * 1024 ** 2, timeout: 30000 }; }
  preview(rec) { return this.download(rec); }
  status() { return { tracks: this.rows?.length || 0, loadedAt: this.cache.entries.get('pieces')?.at || null }; }
}
module.exports = { Incompetech, INCOMPETECH_GENRES: GENRES };
