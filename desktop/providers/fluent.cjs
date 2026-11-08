// Microsoft Fluent Emoji Animated (MIT). Search runs over a bundled metadata index; each animated
// APNG is fetched individually from GitHub's LFS media host, pinned to the indexed commit.
const index = require('../../shared/fluent-index.json');

const MEDIA = `https://media.githubusercontent.com/media/microsoft/fluentui-emoji-animated/${index.commit}/assets/`;
const PAGE = 'https://github.com/microsoft/fluentui-emoji-animated/tree/main/assets/';

class Fluent {
  constructor() {
    this.id = 'fluent'; this.capabilities = new Set(['search', 'categories', 'preview', 'download', 'license-metadata', 'animated', 'commercial-use']);
    this.byId = new Map(index.items.map(x => [x.id, x]));
    this.words = index.items.map(x => [x, [x.name, ...x.keywords, x.group].join(' ').toLowerCase()]);
  }
  categories() { return [...new Set(index.items.map(x => x.group))]; }
  async search({ q = '', category, page = 1, pageSize = 60 }) {
    const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean);
    let hits = this.words.filter(([x, w]) => (!category || x.group === category) && terms.every(t => w.includes(t)));
    if (terms.length) hits = hits.map(([x, w]) => [x, (x.name.toLowerCase().startsWith(terms[0]) ? 0 : x.name.toLowerCase().includes(terms[0]) ? 1 : 2)]).sort((a, b) => a[1] - b[1]);
    const all = hits.map(h => h[0]); const start = (Math.max(1, page) - 1) * pageSize;
    return { items: all.slice(start, start + pageSize).map(x => this.normalize(x)), total: all.length, page, pages: Math.ceil(all.length / pageSize) };
  }
  async getAsset(id) { const x = this.byId.get(id); if (!x) throw Object.assign(Error('That emoji is not in the Fluent set.'), { code: 'gone' }); return this.normalize(x); }
  normalize(x) {
    const rec = {
      provider: 'fluent', sourceId: x.id, kind: 'sticker', animated: true, title: x.name, glyph: x.glyph, group: x.group, tags: x.keywords.slice(0, 5),
      creator: 'Microsoft', sourcePageUrl: PAGE + encodeURIComponent(x.name), sourceName: 'Fluent Emoji', width: 256, height: 256, mimeType: 'image/apng',
      license: 'mit', licenseVersion: null, licenseUrl: index.licenseUrl, holder: index.holder, attribution: null,
      localStorageAllowed: true, exportAllowed: true, licenseEvidenceUrl: index.licenseUrl, metadataCheckedAt: index.built,
    };
    Object.defineProperty(rec, 'downloadUrl', { value: MEDIA + x.file.split('/').map(encodeURIComponent).join('/'), enumerable: false });
    return rec;
  }
  download(rec) { return { url: rec.downloadUrl, accept: /^(image\/png|image\/apng|application\/octet-stream)/i, maxBytes: 20 * 1024 ** 2 }; }
  preview(rec) { return this.download(rec); }
}
module.exports = { Fluent, fluentIndex: index };
