// Creative Library service: provider search with caching and throttling, previews through a
// bounded cache, rights-checked imports into project-managed media, sticker baking (animated
// GIF / APNG / WebP / Lottie → VP9-with-alpha WebM that preview and export both play), favorites
// and recents. Provider adapters live in ./providers.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { run, ffmpeg, ffprobe } = require('./tools.cjs');
const { toStored, fromStored } = require('./paths.cjs');
const { SafeHttp } = require('./providers/http.cjs');
const { Openverse } = require('./providers/openverse.cjs');
const { Fluent } = require('./providers/fluent.cjs');
const { Pixabay } = require('./providers/pixabay.cjs');
const { SfxKit } = require('./providers/sfxkit.cjs');
const { CcMixter } = require('./providers/ccmixter.cjs');
const { assessRights, verifyLicense, discoverable, includeMode, providerTier, PROVIDERS, APP_NOTICES } = require('../shared/rights.mjs');

const PREVIEW_CAP = 250 * 1024 ** 2;
const STICKER_EXT = /\.(png|apng|gif|webp|svg|json|jpe?g)$/i;
const EXT_FOR = { 'image/svg+xml': '.svg', 'image/gif': '.gif', 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/ogg': '.ogg', 'application/ogg': '.ogg', 'video/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/flac': '.flac', 'audio/x-flac': '.flac', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/opus': '.opus', 'audio/webm': '.webm', 'image/png': '.png', 'image/apng': '.png' };
const safeName = s => String(s || 'asset').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'asset';

class Creative {
  constructor({ dataDir, cacheDir, library, jobs, secrets = null, http = new SafeHttp(), openverseBase, pixabayBase, sfxkitBase, ccmixterBase }) {
    this.library = library; this.jobs = jobs; this.secrets = secrets; this.http = http;
    this.statePath = path.join(dataDir, 'creative.json'); this.dataDir = dataDir;
    this.dirs = { lib: path.join(dataDir, 'media', 'library'), previews: path.join(cacheDir, 'creative', 'previews'), bake: path.join(cacheDir, 'creative', 'bake') };
    this.memCreds = {};
    this.providers = { openverse: new Openverse({ http, base: openverseBase, credentials: () => this.credentials('openverse') }), fluent: new Fluent(), pixabay: new Pixabay({ http, base: pixabayBase, credentials: () => this.credentials('pixabay') }), sfxkit: new SfxKit({ base: sfxkitBase }), ccmixter: new CcMixter({ http, base: ccmixterBase }) };
    this.cache = new Map(); this.known = new Map(); this.inflight = new Map(); this.sessions = new Map(); this.tokens = new Map();
    this.state = { favorites: [], recents: [], imports: {} };
  }
  async init() {
    for (const d of Object.values(this.dirs)) await fsp.mkdir(d, { recursive: true });
    await fsp.rm(this.dirs.bake, { recursive: true, force: true }); await fsp.mkdir(this.dirs.bake, { recursive: true });
    try { this.state = { ...this.state, ...fromStored(JSON.parse(await fsp.readFile(this.statePath, 'utf8')), this.dataDir) }; } catch {}
    this.prunePreviews().catch(() => {});
  }
  persist() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.flush().catch(() => {}), 300); }
  async flush() { const tmp = this.statePath + '.tmp'; await fsp.writeFile(tmp, JSON.stringify(toStored(this.state, this.dataDir))); await fsp.rename(tmp, this.statePath); }
  provider(id) { const p = this.providers[id]; if (!p) throw Object.assign(Error(PROVIDERS[id]?.reason || 'Unknown media source.'), { code: 'unavailable' }); return p; }

  // ----- credentials (kept in the OS credential store via the desktop shell; never sent to the UI) -----
  credentials(id) { try { const v = this.secrets?.get('provider:' + id); return v ? JSON.parse(v) : this.memCreds[id] || null; } catch { return this.memCreds[id] || null; } }
  setCredentials(id, value) {
    if (!['openverse', 'pixabay'].includes(id)) throw Error('This source does not use credentials.');
    let clean;
    if (id === 'pixabay') { const k = String(value?.key || '').trim(); if (k && !/^[\w-]{8,100}$/.test(k)) throw Error('That does not look like a Pixabay API key.'); clean = k ? { key: k } : null; }
    else clean = value && value.clientId && value.clientSecret ? { clientId: String(value.clientId).trim().slice(0, 200), clientSecret: String(value.clientSecret).trim().slice(0, 400) } : null;
    if (this.secrets?.available?.()) this.secrets.set('provider:' + id, clean ? JSON.stringify(clean) : null); else this.memCreds[id] = clean;
    this.providers.openverse.token = null; this.cache.clear();
    return { configured: !!clean, persistent: !!this.secrets?.available?.() };
  }
  status() {
    return {
      openverse: { ...this.providers.openverse.status(), credentials: !!this.credentials('openverse'), secureStore: !!this.secrets?.available?.() },
      pixabay: this.providers.pixabay.status(), notices: APP_NOTICES,
      providers: Object.values(PROVIDERS).map(p => ({ id: p.id, name: p.name, enabled: p.enabled, optional: !!p.optional, configured: p.needsKey ? !!this.providers[p.id]?.configured?.() : null, kinds: p.kinds, reason: p.reason || null, note: p.note || null, home: p.home || null, terms: p.terms || null, tier: providerTier(p.id) })),
    };
  }
  // Providers that can answer a search for this kind in this discovery mode (configured, enabled, right tier).
  searchable(kind, include) {
    return Object.keys(this.providers).filter(id => {
      const pv = PROVIDERS[id], p = this.providers[id];
      if (!pv?.enabled || !pv.kinds.includes(kind)) return false;
      if (pv.needsKey && !p.configured?.()) return false;
      const t = providerTier(id); return !t || t === 'free' || (t === 'credit' && include !== 'free') || include === 'all';
    });
  }

  // ----- search -----
  remember(rec) { const k = rec.provider + ':' + rec.sourceId; this.known.delete(k); this.known.set(k, rec); if (this.known.size > 3000) this.known.delete(this.known.keys().next().value); return rec; }
  decorate(rec) {
    const k = rec.provider + ':' + rec.sourceId, imp = this.state.imports[k], a = imp && this.library.get(imp.mediaId);
    return { ...rec, key: k, favorite: this.state.favorites.some(f => f.key === k), imported: a && !a.missing ? a.id : null, downloadable: !!rec.downloadUrl };
  }
  async search(providerId, params = {}) {
    if (providerId === 'all') return this.searchAll(params);
    const p = this.provider(providerId);
    const q = { q: String(params.q || '').trim().slice(0, 200), kind: params.kind, page: +params.page || 1, usage: params.usage === 'personal' ? 'personal' : 'commercial', length: params.length || '', source: params.source || '', category: params.category || '', include: includeMode(params.include) };
    const key = providerId + JSON.stringify(q);
    const hit = this.cache.get(key);
    let data;
    if (hit && Date.now() - hit.at < (p.cacheTtl || 6 * 3600e3)) data = hit.data;
    else if (this.inflight.has(key)) data = await this.inflight.get(key);
    else {
      const prom = p.search(q); this.inflight.set(key, prom);
      try { data = await prom; } finally { this.inflight.delete(key); }
      this.cache.set(key, { at: Date.now(), data }); if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
    }
    for (const r of data.items) this.remember(r);
    // Only verified items that belong in this discovery mode are shown.
    const items = data.items.filter(r => (!r.licenseCheck || r.licenseCheck.ok) && discoverable(assessRights({ provider: r.provider, license: r.license, licenseVersion: r.licenseVersion, kind: r.kind, usage: q.usage, verification: r.licenseCheck }), q.include));
    return { ...data, items: items.map(r => this.decorate(r)), cached: !!hit, query: q, provider: providerId };
  }
  // One search across every compatible source for a kind. Results are interleaved so no source buries
  // the others, near-duplicates are dropped, and one source failing doesn't hide the rest.
  async searchAll(params = {}) {
    const kind = ['music', 'sfx', 'sticker'].includes(params.kind) ? params.kind : 'sticker'; const include = includeMode(params.include);
    // Bundled-index sources answer an empty query with their whole catalog, so they only join real searches or category browsing.
    const ids = this.searchable(kind, include).filter(id => !['fluent', 'sfxkit'].includes(id) || params.q || params.category);
    // Each source gets a deadline; a slow one is reported (its answer still lands in the cache for next time).
    const deadline = +params.deadline || this.searchDeadline || 9000;
    const settled = await Promise.allSettled(ids.map(id => Promise.race([this.search(id, { ...params, kind, include }), new Promise((_, no) => setTimeout(() => no(Object.assign(Error(`${PROVIDERS[id]?.name || id} is slow to answer right now.`), { code: 'slow' })), deadline))])));
    const ok = [], failed = [];
    settled.forEach((r, i) => { if (r.status === 'fulfilled') ok.push([ids[i], r.value]); else failed.push({ provider: ids[i], name: PROVIDERS[ids[i]]?.name, message: r.reason?.message, code: r.reason?.code || null, retryAfter: r.reason?.retryAfter || null, error: r.reason }); });
    if (!ok.length && failed.length) throw failed[0].error;
    // Near-duplicates (same title and creator) are only merged across sources: within one source,
    // titles can legitimately repeat (Pixabay titles come from tags).
    const keys = new Set(), names = new Map(), items = []; const lists = ok.map(([, d]) => d.items);
    for (let i = 0; lists.some(l => i < l.length); i++) for (const l of lists) {
      const r = l[i]; if (!r || keys.has(r.key)) continue;
      const k = (r.title + '|' + (r.creator || '')).toLowerCase().replace(/[^a-z0-9|]+/g, '');
      if (names.has(k) && names.get(k) !== r.provider) continue;
      keys.add(r.key); names.set(k, r.provider); items.push(r);
    }
    return { items, total: ok.reduce((n, [, d]) => n + (d.total || 0), 0), page: +params.page || 1, pages: Math.max(0, ...ok.map(([, d]) => d.pages || 0)), sources: ok.map(([id, d]) => ({ provider: id, name: PROVIDERS[id]?.name, total: d.total || 0 })), partial: failed.map(({ error, ...f }) => f), provider: 'all' };
  }
  async record(providerId, id, { fresh = false, kind } = {}) {
    const k = providerId + ':' + id;
    if (!fresh && this.known.has(k)) return this.known.get(k);
    return this.remember(await this.provider(providerId).getAsset(id, kind));
  }

  // ----- previews (streamed once, then served from a bounded cache) -----
  async preview(providerId, id, req, res) {
    const rec = await this.record(providerId, id);
    const file = path.join(this.dirs.previews, createHash('sha1').update(providerId + ':' + id).digest('hex').slice(0, 20));
    if (fs.existsSync(file)) { const now = new Date(); fsp.utimes(file, now, now).catch(() => {}); const t = await fsp.readFile(file + '.type', 'utf8').catch(() => null); return res.sendFile(file, { headers: { 'Content-Type': t || (rec.kind === 'sticker' ? 'image/png' : 'audio/mpeg'), 'Cache-Control': 'no-cache' } }); }
    const src = this.provider(providerId).preview(rec);
    let r;
    try { r = await this.http.open(src.url, { accept: src.accept, timeout: src.timeout || 20000 }); }
    catch (e) { if (!src.fallback) throw e; r = await this.http.open(src.fallback, { accept: src.accept, timeout: 20000 }); }
    const type = (r.headers.get('content-type') || '').split(';')[0] || 'application/octet-stream';
    res.setHeader('Content-Type', type === 'application/octet-stream' && rec.kind === 'sticker' ? 'image/png' : type);
    if (r.headers.get('content-length')) res.setHeader('Content-Length', r.headers.get('content-length'));
    const part = file + '.' + process.pid + '.part'; const out = fs.createWriteStream(part); let bytes = 0, ok = true;
    req.on('close', () => { if (!res.writableFinished) { ok = false; r.controller.abort(); } });
    try {
      for await (const chunk of Readable.fromWeb(r.body)) { bytes += chunk.length; if (bytes > src.maxBytes) { ok = false; break; } out.write(chunk); if (!res.write(chunk)) await new Promise(x => res.once('drain', x)); }
    } catch { ok = false; } finally { r.cleanup(); }
    res.end(); await new Promise(x => out.end(x));
    if (ok && bytes) { await fsp.rename(part, file).catch(() => {}); await fsp.writeFile(file + '.type', String(res.getHeader('Content-Type') || '')).catch(() => {}); this.prunePreviews().catch(() => {}); } else await fsp.unlink(part).catch(() => {});
  }
  async prunePreviews() {
    const list = [];
    for (const n of await fsp.readdir(this.dirs.previews).catch(() => [])) { if (n.endsWith('.type')) continue; const st = await fsp.stat(path.join(this.dirs.previews, n)).catch(() => null); if (st) list.push({ n, size: st.size, t: st.mtimeMs }); }
    let total = list.reduce((s, x) => s + x.size, 0); list.sort((a, b) => a.t - b.t);
    while (total > PREVIEW_CAP && list.length) { const x = list.shift(); total -= x.size; await fsp.unlink(path.join(this.dirs.previews, x.n)).catch(() => {}); await fsp.unlink(path.join(this.dirs.previews, x.n + '.type')).catch(() => {}); }
  }

  // ----- import (rights check → download → project media → optional sticker bake) -----
  importAsset({ provider: providerId, id, kind, usage = 'commercial' }) {
    const key = providerId + ':' + id; const prev = this.state.imports[key]; const existing = prev && this.library.get(prev.mediaId);
    if (existing && !existing.missing) { this.touchRecent(key); return { reused: true, asset: this.library.public(existing) }; }
    for (const j of this.jobs.jobs.values()) if (j.meta?.creativeKey === key && ['queued', 'running'].includes(j.status)) return { job: j.id };
    const job = this.jobs.add({ type: 'creative-import', label: 'Adding from library', lane: 'light', meta: { creativeKey: key } }, async ({ signal, progress }) => {
      progress(0.02, 'Checking the license');
      const p = this.provider(providerId);
      const listed = this.known.get(key) || null;
      const rec = await this.record(providerId, id, { fresh: true, kind });
      // Verify the license from the provider's current record (not the search listing) and keep the evidence.
      const licenseRecord = verifyLicense(rec, { listed, method: providerId + '-detail' });
      if (!licenseRecord.ok) throw Object.assign(Error(`“${rec.title}” wasn’t added: ${licenseRecord.problems.map(p => p.text).join(' ')} FrameCut only uses assets whose license it can confirm.`), { code: 'license' });
      const rights = assessRights({ provider: providerId, license: rec.license, licenseVersion: rec.licenseVersion, kind: rec.kind, usage, verification: licenseRecord });
      if (!rights.storage) throw Object.assign(Error(rights.summary), { code: 'license' });
      if (rights.blocked) throw Object.assign(Error(rights.summary), { code: 'license' });
      job.label = 'Adding “' + rec.title + '”';
      const dir = path.join(this.dirs.lib, providerId); await fsp.mkdir(dir, { recursive: true });
      const src = p.download(rec);
      const tmp = path.join(dir, `.${randomUUID()}.download`);
      const dl = await this.http.toFile(src.url, tmp, { accept: src.accept, maxBytes: src.maxBytes, timeout: src.timeout, signal, onProgress: f => progress(0.05 + (f ?? 0.5) * 0.75, 'Downloading') });
      if (rec.expectedSha256 && dl.sha256 !== rec.expectedSha256) { await fsp.unlink(tmp).catch(() => {}); throw Object.assign(Error(`“${rec.title}” didn’t match the file its source published, so it wasn’t added.`), { code: 'corrupt' }); }
      // Same bytes already imported under another listing? Reuse that file.
      const twin = Object.entries(this.state.imports).find(([, v]) => v.sha256 === dl.sha256 && this.library.get(v.mediaId) && !this.library.get(v.mediaId).missing);
      const ext = EXT_FOR[dl.contentType] || (rec.filetype && /^(mp3|ogg|wav|flac|m4a|aac|opus)$/.test(rec.filetype) ? '.' + rec.filetype : rec.filetype === 'mp32' ? '.mp3' : rec.kind === 'sticker' ? '.png' : '.audio');
      const file = path.join(dir, `${safeName(rec.title)}-${String(id).replace(/[^a-z0-9]/gi, '').slice(0, 8)}${ext}`);
      const source = { ...rec, licenseCheck: undefined, licenseRecord: { ...licenseRecord, sha256: dl.sha256, downloadedFrom: dl.finalUrl }, rights: { level: rights.level, tier: rights.tier, badge: rights.badge, summary: rights.summary, attribution: rights.attribution, commercial: rights.commercial, restrictions: rights.restrictions }, usageAtImport: usage, sha256: dl.sha256, bytes: dl.bytes, downloadedFrom: dl.finalUrl, importedAt: new Date().toISOString() };
      let out;
      if (twin) { await fsp.unlink(tmp).catch(() => {}); out = this.library.get(twin[1].mediaId); }
      else {
        await fsp.rename(tmp, file); source.originalFile = file;
        progress(0.85, rec.kind === 'sticker' ? 'Preparing the animation' : 'Reading the file');
        try { out = rec.kind === 'sticker' ? await this.stickerFile(file, { name: rec.title, source, signal }) : await this.library.importPath(file, { name: rec.title + ext, source, role: 'library-audio' }); }
        catch (e) { if (e.cancelled || signal.aborted) throw e; await fsp.unlink(file).catch(() => {}); throw Object.assign(Error('The downloaded file could not be read as ' + (rec.kind === 'sticker' ? 'an animation' : 'audio') + '. It may be damaged or no longer available.'), { code: 'corrupt', cause: e }); }
        if (rec.kind !== 'sticker' && !out.audio) { await this.library.remove(out.id); await fsp.unlink(file).catch(() => {}); throw Object.assign(Error('That download has no playable audio.'), { code: 'corrupt' }); }
      }
      this.state.imports[key] = { mediaId: out.id, sha256: dl.sha256, at: Date.now() };
      this.touchRecent(key, rec); this.persist();
      return { asset: this.library.public(out), record: this.decorate(rec) };
    });
    return { job: job.id };
  }
  touchRecent(key, rec) {
    const old = this.state.recents.find(r => r.key === key); rec ||= old?.record; if (!rec) return;
    this.state.recents = [{ key, record: plain(rec), at: Date.now() }, ...this.state.recents.filter(r => r.key !== key)].slice(0, 60); this.persist();
  }
  toggleFavorite(rec, on) {
    const key = rec.provider + ':' + rec.sourceId;
    this.state.favorites = this.state.favorites.filter(f => f.key !== key);
    if (on) this.state.favorites.unshift({ key, record: plain(rec), at: Date.now() });
    this.persist(); return { favorite: !!on };
  }
  lists(kind) {
    const f = list => list.filter(x => !kind || kindGroup(x.record.kind) === kindGroup(kind)).map(x => this.decorate(x.record));
    return { favorites: f(this.state.favorites), recents: f(this.state.recents) };
  }

  // ----- stickers -----
  async sniff(file) {
    const fd = await fsp.open(file, 'r'); const buf = Buffer.alloc(4096); const { bytesRead } = await fd.read(buf, 0, 4096, 0); await fd.close();
    const b = buf.subarray(0, bytesRead), head = b.toString('latin1');
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif';
    if (b[0] === 0x89 && head.slice(1, 4) === 'PNG') { const idat = head.indexOf('IDAT'), actl = head.indexOf('acTL'); return actl > 0 && (idat < 0 || actl < idat) ? 'apng' : 'png'; }
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return head.includes('ANIM') ? 'webp-anim' : 'webp';
    if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
    const text = head.replace(/^﻿/, '').trimStart();
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text) || (/^<(\?xml|!--|!DOCTYPE\s+svg)/i.test(text) && /<svg[\s>]/i.test(text) && !/<html/i.test(text))) return 'svg';
    if (text.startsWith('{')) return 'lottie';
    if (head.startsWith('PK')) return 'dotlottie';
    return null;
  }
  // Animated GIF / APNG → VP9+alpha WebM at <=512 px, sampled at the source's frame rate (<=30 fps).
  // Static PNG / WebP / JPEG stickers are used as they are.
  async bakeFile(file, { name, source, signal, derivedFrom = null } = {}) {
    const type = await this.sniff(file);
    if (['png', 'webp', 'jpeg'].includes(type)) return this.markSticker(await this.library.importPath(file, { name: name + path.extname(file), role: 'sticker', source }), source);
    if (!['gif', 'apng'].includes(type)) throw Error('This animation format needs to be prepared in the editor window.');
    const fmt = type === 'apng' ? ['-f', 'apng'] : [];
    // Real per-frame timing (GIF/APNG frames can each have their own delay). The last frame's delay is
    // easy to lose when resampling, so it is padded explicitly and the output is cut to the true length.
    const probe = JSON.parse((await run(ffprobe, ['-v', 'quiet', ...fmt, '-i', file, '-show_entries', 'packet=pts_time,duration_time', '-of', 'json'], { signal })).out).packets || [];
    const durs = probe.map(f => +f.duration_time).filter(x => Number.isFinite(x) && x > 0);
    if (!probe.length) throw Error('This animation has no frames.');
    const last = durs.at(-1) || 0.1, total = Math.max(0.05, (+probe.at(-1).pts_time || 0) + last);
    const fps = Math.max(1, Math.min(30, Math.round(probe.length / total) || 24));
    const out = path.join(this.library.dirs.derived, `sticker-${safeName(name).replace(/\s+/g, '-')}-${Date.now()}.webm`);
    await run(ffmpeg, ['-y', '-v', 'error', ...fmt, '-i', file, '-an', '-t', total.toFixed(4),
      '-vf', `tpad=stop_mode=clone:stop_duration=${last.toFixed(4)},fps=${fps},scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2:color=0x00000000,format=yuva420p`,
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '26', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0', '-metadata:s:v:0', 'alpha_mode=1', out], { signal });
    return this.library.importPath(out, { name: name + ' (sticker)', derivedFrom, derivedKind: 'sticker', role: 'sticker', source: source ? { ...source, originalFile: source.originalFile || file } : null, alpha: true, animated: true });
  }
  // Downloaded sticker files: SVG is sanitized and used as vector art, everything else goes through bakeFile.
  async stickerFile(file, { name, source, signal }) {
    if (await this.sniff(file) === 'svg') { const clean = await this.sanitizeSvg(file); await fsp.unlink(file).catch(() => {}); source.originalFile = clean; return this.markSticker(await this.library.importPath(clean, { name: name + '.svg', role: 'sticker', source }), source); }
    return this.bakeFile(file, { name, source, signal });
  }
  markSticker(a, source) { a.role = 'sticker'; if (source && !a.source) a.source = source; a.version = (a.version || 0) + 1; this.library.persist(); return a; }
  // User's own sticker files. Returns ready assets and files the renderer must bake (WebP / Lottie).
  async importStickers(paths) {
    const ready = [], renderer = [], errors = [];
    for (const p of paths.slice(0, 50)) {
      const name = path.basename(p);
      try {
        if (!STICKER_EXT.test(p)) throw Error('Use PNG, GIF, APNG, WebP, SVG or Lottie (.json) files.');
        const st = await fsp.stat(p); if (!st.isFile()) throw Error('Not a file.'); if (st.size > 60 * 1024 ** 2) throw Error('This file is larger than 60 MB.');
        const type = await this.sniff(p);
        if (!type) throw Error('This file is not a supported image or animation.');
        if (type === 'dotlottie') throw Error('.lottie archives are not supported yet. Export the animation as Lottie JSON instead.');
        const own = { provider: 'local', sourceId: 'file:' + p.toLowerCase(), kind: 'sticker', title: name.replace(/\.[^.]+$/, ''), license: null };
        if (type === 'svg') { const clean = await this.sanitizeSvg(p); ready.push(this.library.public(this.markSticker(await this.library.importPath(clean, { name, role: 'sticker', source: own }), own))); continue; }
        if (type === 'lottie') { await validateLottie(p); renderer.push({ token: this.token(p), name, type }); continue; }
        if (type === 'webp-anim') { renderer.push({ token: this.token(p), name, type }); continue; }
        const prev = this.state.imports[own.provider + ':' + own.sourceId]; const had = prev && this.library.get(prev.mediaId);
        if (had && !had.missing && prev.size === st.size && prev.mtime === st.mtimeMs) { ready.push(this.library.public(had)); continue; }
        const a = await this.bakeFile(p, { name: own.title, source: own });
        this.state.imports[own.provider + ':' + own.sourceId] = { mediaId: a.id, size: st.size, mtime: st.mtimeMs, at: Date.now() }; this.persist();
        ready.push(this.library.public(a));
      } catch (e) { errors.push({ name, error: e.message }); }
    }
    return { ready, renderer, errors };
  }
  token(p) { const t = randomUUID(); this.tokens.set(t, { path: p, at: Date.now() }); return t; }
  localFile(t) { const x = this.tokens.get(t); if (!x || Date.now() - x.at > 3600e3) throw Error('That file is no longer available.'); return x.path; }
  // Keep only safe SVG: no scripts, event handlers, foreign content, external references or entities.
  async sanitizeSvg(p) {
    let s = await fsp.readFile(p, 'utf8'); if (s.length > 5 * 1024 ** 2) throw Error('This SVG is too large.');
    // Illustrator and Inkscape exports often carry a DOCTYPE whose internal subset only defines plain text
    // entities (namespace URLs). Those are expanded here and the DOCTYPE dropped; anything else (external
    // SYSTEM/PUBLIC entities, parameter entities, nested references) is refused.
    const dt = /<!DOCTYPE\s+svg\b[^\[>]*(?:\[([\s\S]*?)\])?\s*>/i.exec(s);
    if (dt) {
      const ents = {};
      const rest = (dt[1] || '').replace(/<!ENTITY\s+([\w.-]+)\s+"([^"&%<]{0,500})"\s*>/g, (_, n, v) => { ents[n] = v; return ''; }).replace(/<!--[\s\S]*?-->/g, '').trim();
      if (rest) throw Error('This SVG uses document type declarations, which are not allowed.');
      s = s.slice(0, dt.index) + s.slice(dt.index + dt[0].length);
      if (Object.keys(ents).length) s = s.replace(/&([\w.-]+);/g, (m, n) => (Object.hasOwn(ents, n) ? ents[n] : m));
    }
    if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw Error('This SVG uses document type declarations, which are not allowed.');
    s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<script[^>]*\/>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(\s(?:xlink:)?href\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, attr, _q, a, b) => { const v = (a ?? b ?? '').trim(); return v.startsWith('#') || /^data:image\/(png|jpeg|gif|webp);/i.test(v) ? m : ''; })
      .replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none').replace(/javascript:/gi, '');
    const dir = path.join(this.dirs.lib, 'local-stickers'); await fsp.mkdir(dir, { recursive: true });
    const out = path.join(dir, `${safeName(path.basename(p, path.extname(p)))}-${createHash('sha1').update(s).digest('hex').slice(0, 8)}.svg`);
    await fsp.writeFile(out, s); return out;
  }
  // Renderer-decoded animations arrive as PNG frames and are encoded the same way as GIF/APNG.
  bakeStart({ name, fps = 30, width, height, count, token, source }) {
    fps = Math.max(1, Math.min(60, +fps || 30)); count = Math.max(1, Math.min(1800, count | 0));
    if (!(width > 0 && height > 0 && width <= 1024 && height <= 1024)) throw Error('Animation size is out of range.');
    const id = randomUUID(), dir = path.join(this.dirs.bake, id); fs.mkdirSync(dir, { recursive: true });
    const origin = token ? this.localFile(token) : null;
    this.sessions.set(id, { id, dir, name: safeName(name), fps, width: Math.round(width), height: Math.round(height), count, received: new Set(), origin, source });
    return { id };
  }
  async bakeFrame(id, index, buf) {
    const s = this.sessions.get(id); if (!s) throw Error('That animation session has ended.');
    index |= 0; if (index < 0 || index >= s.count) throw Error('Frame out of range.');
    if (!(buf?.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG')) throw Error('Frames must be PNG images.');
    await fsp.writeFile(path.join(s.dir, String(index).padStart(5, '0') + '.png'), buf); s.received.add(index); return { received: s.received.size };
  }
  bakeFinish(id) {
    const s = this.sessions.get(id); if (!s) throw Error('That animation session has ended.');
    if (s.received.size !== s.count) throw Error(`Only ${s.received.size} of ${s.count} frames arrived.`);
    this.sessions.delete(id);
    return this.jobs.add({ type: 'sticker-bake', label: 'Preparing sticker · ' + s.name, lane: 'light' }, async ({ signal }) => {
      try {
        const own = s.origin ? { provider: 'local', sourceId: 'file:' + s.origin.toLowerCase(), kind: 'sticker', title: s.name, license: null } : (s.source || null);
        if (own && s.origin) own.originalFile = s.origin;
        const out = path.join(this.library.dirs.derived, `sticker-${s.id.slice(0, 8)}-${Date.now()}.webm`);
        await run(ffmpeg, ['-y', '-v', 'error', '-framerate', String(s.fps), '-i', path.join(s.dir, '%05d.png'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2:color=0x00000000,format=yuva420p',
          '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '26', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0', '-metadata:s:v:0', 'alpha_mode=1', out], { signal });
        const a = await this.library.importPath(out, { name: s.name.replace(/\.[^.]+$/, '') + ' (sticker)', derivedFrom: null, derivedKind: 'sticker', role: 'sticker', source: own, alpha: true, animated: true });
        return { asset: this.library.public(a) };
      } finally { await fsp.rm(s.dir, { recursive: true, force: true }); }
    });
  }
  bakeCancel(id) { const s = this.sessions.get(id); if (s) { this.sessions.delete(id); fsp.rm(s.dir, { recursive: true, force: true }).catch(() => {}); } }
}
const kindGroup = k => (k === 'sticker' ? 'sticker' : 'audio');
const plain = rec => JSON.parse(JSON.stringify({ ...rec, key: undefined, favorite: undefined, imported: undefined, downloadable: undefined, downloadUrl: rec.downloadUrl }));

// Lottie JSON validation: structure, size and no external resources (embedded images only).
async function validateLottie(p) {
  let j; try { j = JSON.parse(await fsp.readFile(p, 'utf8')); } catch { throw Error('This JSON file is not a valid Lottie animation.'); }
  if (!j || typeof j !== 'object' || !Array.isArray(j.layers) || !(j.w > 0) || !(j.h > 0) || !(j.fr > 0) || !(j.op > j.ip)) throw Error('This JSON file is not a Lottie animation.');
  if ((j.op - j.ip) / j.fr > 60) throw Error('Lottie animations longer than 60 seconds are not supported.');
  if (j.w > 8192 || j.h > 8192) throw Error('This Lottie animation is too large.');
  for (const a of j.assets || []) if (a.p && !(a.e === 1 || /^data:image\//.test(a.p))) throw Error('This Lottie animation loads external image files. Re-export it with images embedded.');
  if (JSON.stringify(j).includes('"x":"')) { /* expressions present: the light player ignores them */ }
  return j;
}
module.exports = { Creative, validateLottie };
