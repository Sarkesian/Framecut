// Wyzowl SFX Kit (CC0 1.0): 320 sound effects for video editing in 28 categories, with descriptions,
// "use for" hints and sync points. Search runs over a bundled metadata index; each WAV is fetched
// individually from GitHub, pinned to the indexed commit (see scripts/sfxkit-index.mjs).
const index = require('../../shared/sfxkit-index.json');
const { verifyLicense } = require('../../shared/rights.mjs');

const RAW = `https://raw.githubusercontent.com/wyzowl/sfx-kit/${index.commit}/`;
const PAGE = `https://github.com/wyzowl/sfx-kit/blob/${index.commit}/`;

class SfxKit {
  constructor({ base = RAW } = {}) {
    this.id = 'sfxkit'; this.base = base; this.local = true;
    this.capabilities = new Set(['search', 'categories', 'preview', 'download', 'license-metadata', 'commercial-use', 'no-attribution', 'offline-search']);
    this.byId = new Map(index.items.map(x => [x.id, x]));
    this.words = index.items.map(x => [x, [x.name, x.group, x.description, ...x.tags, ...x.useFor].join(' ').toLowerCase()]);
  }
  categories() { return [...new Map(index.items.map(x => [x.category, x.group])).entries()].map(([id, name]) => ({ id, name, count: index.items.filter(i => i.category === id).length })); }
  async search({ q = '', category, length, page = 1, pageSize = 40 }) {
    const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean);
    const LEN = { short: [0, 10], medium: [10, 60], long: [60, Infinity] }[length];
    let hits = this.words.filter(([x, w]) => (!category || x.category === category) && (!LEN || (x.duration >= LEN[0] && x.duration < LEN[1])) && terms.every(t => w.includes(t)));
    // Name and tag matches rank above description matches.
    if (terms.length) hits = hits.map(([x]) => [x, x.name.toLowerCase().includes(terms[0]) ? 0 : x.tags.includes(terms[0]) ? 1 : 2]).sort((a, b) => a[1] - b[1]);
    const all = hits.map(h => h[0]); const start = (Math.max(1, page) - 1) * pageSize;
    return { items: all.slice(start, start + pageSize).map(x => this.normalize(x)), total: all.length, page, pages: Math.ceil(all.length / pageSize) };
  }
  async getAsset(id) { const x = this.byId.get(id); if (!x) throw Object.assign(Error('That sound is not in the SFX Kit.'), { code: 'gone' }); return this.normalize(x); }
  normalize(x) {
    const rec = {
      provider: 'sfxkit', sourceId: x.id, kind: 'sfx', title: x.name, creator: 'Wyzowl', sourcePageUrl: PAGE + x.file, sourceName: 'SFX Kit', group: x.group, category: x.category,
      durationMs: Math.round(x.duration * 1000), filetype: 'wav', tags: x.tags.slice(0, 6), description: x.description, useFor: x.useFor, syncAt: x.sync,
      license: 'cc0', licenseVersion: '1.0', licenseUrl: index.licenseUrl, attribution: null, licenseEvidenceUrl: index.licenseFile, metadataCheckedAt: index.built, expectedSha256: x.sha256,
    };
    rec.licenseCheck = verifyLicense(rec, { checkedAt: index.built, method: 'pinned-repository' }); rec.tier = 'free';
    Object.defineProperty(rec, 'downloadUrl', { value: this.base + x.file.split('/').map(encodeURIComponent).join('/'), enumerable: false });
    return rec;
  }
  download(rec) { return { url: rec.downloadUrl, accept: /^(audio\/(wav|x-wav|wave|vnd\.wave)|application\/octet-stream|binary\/octet-stream)/i, maxBytes: 40 * 1024 ** 2 }; }
  preview(rec) { return this.download(rec); }
}
module.exports = { SfxKit, sfxkitIndex: index };
