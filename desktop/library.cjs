// Media library: assets are referenced in place (no copying) and get cached thumbnails,
// filmstrips, waveforms and (when needed) lightweight preview proxies.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { run, ffmpeg, probeMedia, detectEncoders } = require('./tools.cjs');
const { toStored, fromStored } = require('./paths.cjs');

const PLAYABLE_V = new Set(['h264', 'vp8', 'vp9', 'av1', 'hevc', 'mjpeg', 'png', 'gif', 'webp', 'bmp']);
const PLAYABLE_A = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_u8', 'pcm_s32le', 'alac']);
const PLAYABLE_EXT = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']);
const MEDIA_EXT = /\.(mp4|m4v|mov|avi|mkv|webm|flv|wmv|mpg|mpeg|ts|mts|m2ts|3gp|mxf|mp3|wav|aac|ogg|oga|opus|flac|m4a|wma|aif|aiff|jpg|jpeg|png|gif|bmp|webp|svg|tif|tiff)$/i;

// Provenance shown to the UI: who made it, where it came from and under which license (no internal URLs).
const SOURCE_FIELDS = ['provider', 'sourceId', 'kind', 'title', 'creator', 'creatorUrl', 'sourcePageUrl', 'sourceName', 'license', 'licenseVersion', 'licenseUrl', 'attribution', 'holder', 'rights', 'importedAt', 'metadataCheckedAt', 'licenseEvidenceUrl', 'licenseRecord', 'glyph', 'durationMs'];
const publicSource = s => Object.fromEntries(SOURCE_FIELDS.filter(k => s[k] !== undefined && s[k] !== null).map(k => [k, s[k]]));

class Library {
  constructor({ dataDir, cacheDir, jobs, prefs }) {
    this.dataDir = dataDir; this.cacheDir = cacheDir; this.jobs = jobs; this.prefs = prefs;
    this.indexPath = path.join(dataDir, 'media.json'); this.assets = new Map();
    this.dirs = { media: path.join(dataDir, 'media'), thumbs: path.join(cacheDir, 'thumbs'), strips: path.join(cacheDir, 'filmstrips'), waves: path.join(cacheDir, 'waveforms'), proxies: path.join(cacheDir, 'proxies'), derived: path.join(dataDir, 'media', 'derived'), audio: path.join(cacheDir, 'audio') };
    this.saveTimer = null;
  }
  async init() {
    for (const d of Object.values(this.dirs)) await fsp.mkdir(d, { recursive: true });
    try {
      for (const a of fromStored(JSON.parse(await fsp.readFile(this.indexPath, 'utf8')), this.dataDir)) {
        if (!a.kind) a.kind = a.video ? 'video' : 'audio'; // v1 assets
        a.missing = !fs.existsSync(a.path); this.assets.set(a.id, a);
      }
    } catch {}
    for (const a of this.assets.values()) if (!a.missing) this.ensureDerivatives(a);
  }
  persist() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.flush().catch(() => {}), 200); }
  async flush() { const tmp = this.indexPath + '.tmp'; await fsp.writeFile(tmp, JSON.stringify(toStored([...this.assets.values()].map(a => ({ ...a, missing: undefined })), this.dataDir), null, 1)); await fsp.rename(tmp, this.indexPath); }
  get(id) { return this.assets.get(id); }
  public(a) {
    if (!a) return null;
    const v = a.version || 0;
    return {
      id: a.id, name: a.name, kind: a.kind, duration: a.duration, width: a.width, height: a.height, fps: a.fps, video: a.video, audio: a.audio, alpha: !!a.alpha, svg: !!a.svg,
      bytes: a.bytes, imported: a.imported, fileName: path.basename(a.path), recording: a.recording || null, missing: !!a.missing, derivedFrom: a.derivedFrom || null, derivedKind: a.derivedKind || null, folder: path.dirname(a.path),
      url: `/media/${a.id}?v=${v}`, proxyUrl: a.proxy ? `/proxy/${a.id}?v=${v}` : null, thumb: a.thumb ? `/cache/thumbs/${path.basename(a.thumb)}?v=${v}` : null,
      strip: a.strip ? { url: `/cache/filmstrips/${path.basename(a.strip.file)}?v=${v}`, count: a.strip.count, w: a.strip.w, h: a.strip.h, interval: a.strip.interval } : null,
      wave: a.wave ? `/cache/waveforms/${path.basename(a.wave)}?v=${v}` : null, needsProxy: !!a.needsProxy, proxyPending: !!a.needsProxy && !a.proxy,
      role: a.role || null, animated: !!a.animated, source: a.source ? publicSource(a.source) : null,
    };
  }
  list() { return [...this.assets.values()].map(a => this.public(a)); }

  async importPath(file, extra = {}) {
    const abs = path.resolve(file);
    const st = await fsp.stat(abs).catch(() => null); if (!st || !st.isFile()) throw Error('File not found: ' + path.basename(abs));
    for (const a of this.assets.values()) if (a.path.toLowerCase() === abs.toLowerCase() && !extra.derivedFrom) { if (a.missing) { a.missing = false; this.ensureDerivatives(a); } return a; }
    const info = await probeMedia(abs);
    const a = { id: randomUUID(), path: abs, name: extra.name || path.basename(abs), bytes: st.size, imported: new Date().toISOString(), ...info, ...extra };
    a.needsProxy = this.wantsProxy(a);
    this.assets.set(a.id, a); this.persist(); this.ensureDerivatives(a);
    return a;
  }
  // Expand folders and filter to media files.
  async expand(paths) {
    const out = [];
    const walk = async (p, depth) => {
      const st = await fsp.stat(p).catch(() => null); if (!st) return;
      if (st.isDirectory() && depth < 3) for (const n of await fsp.readdir(p)) await walk(path.join(p, n), depth + 1);
      else if (st.isFile() && MEDIA_EXT.test(p)) out.push(p);
    };
    for (const p of paths) await walk(p, 0);
    return out.slice(0, 500);
  }
  wantsProxy(a) {
    if (a.kind !== 'video') return false;
    const mode = this.prefs().proxies || 'auto'; if (mode === 'off') return !this.playable(a);
    if (mode === 'always') return true;
    return !this.playable(a) || a.width * a.height > 2560 * 1440;
  }
  playable(a) {
    const ext = path.extname(a.path).toLowerCase();
    if (!PLAYABLE_EXT.has(ext)) return false;
    if (a.video && a.kind !== 'image' && !PLAYABLE_V.has(a.vcodec)) return false;
    if (a.audio && a.acodec && !PLAYABLE_A.has(a.acodec)) return false;
    return true;
  }
  key(a, extra = '') { return createHash('sha1').update(a.path + '|' + a.bytes + '|' + (a.duration || 0) + extra).digest('hex').slice(0, 16); }

  ensureDerivatives(a) {
    const k = this.key(a);
    if (a.video && !a.svg) {
      const thumb = path.join(this.dirs.thumbs, k + '.jpg');
      if (fs.existsSync(thumb)) a.thumb = thumb;
      else this.jobs.add({ type: 'thumbnail', label: 'Preparing ' + a.name, lane: 'light', hidden: true }, async ({ signal }) => {
        const at = a.kind === 'image' ? [] : ['-ss', String(Math.min(a.duration / 3, 1))];
        await run(ffmpeg, ['-y', '-v', 'error', ...at, '-i', a.path, '-frames:v', '1', '-vf', 'scale=320:320:force_original_aspect_ratio=decrease', '-q:v', '4', thumb], { signal });
        a.thumb = thumb; a.version = (a.version || 0) + 1; this.persist();
      });
    }
    if (a.kind === 'video') {
      const count = Math.max(6, Math.min(80, Math.ceil(a.duration / 1.5))), interval = a.duration / count;
      const file = path.join(this.dirs.strips, k + '.jpg');
      if (fs.existsSync(file)) a.strip = { file, count, w: 160, h: 90, interval };
      else this.jobs.add({ type: 'filmstrip', label: 'Building filmstrip · ' + a.name, lane: 'light', hidden: true, meta: { mediaId: a.id } }, async ({ signal }) => {
        const fast = a.duration > 40 ? ['-skip_frame', 'nokey'] : [];
        await run(ffmpeg, ['-y', '-v', 'error', ...fast, '-i', a.path, '-an', '-vf', `fps=${(count / a.duration).toFixed(6)},scale=160:90:force_original_aspect_ratio=increase,crop=160:90,tile=${count}x1`, '-frames:v', '1', '-q:v', '5', file], { signal });
        a.strip = { file, count, w: 160, h: 90, interval }; a.version = (a.version || 0) + 1; this.persist();
      });
    }
    if (a.audio) {
      const file = path.join(this.dirs.waves, k + '.peaks');
      if (fs.existsSync(file)) a.wave = file;
      else this.jobs.add({ type: 'waveform', label: 'Reading audio · ' + a.name, lane: 'light', hidden: true, meta: { mediaId: a.id } }, async ({ signal }) => {
        // 100 peaks per second, stored as unsigned bytes.
        const peaks = []; let acc = 0, cnt = 0, leftover = Buffer.alloc(0);
        await run(ffmpeg, ['-v', 'error', '-i', a.path, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], {
          signal, onStdout: d => {
            const buf = leftover.length ? Buffer.concat([leftover, d]) : d; const n = buf.length >> 1;
            for (let i = 0; i < n; i++) { const v = Math.abs(buf.readInt16LE(i * 2)); if (v > acc) acc = v; if (++cnt === 80) { peaks.push(Math.min(255, Math.round(Math.sqrt(acc / 32768) * 255))); acc = 0; cnt = 0; } }
            leftover = buf.subarray(n * 2);
          },
        });
        await fsp.writeFile(file, Buffer.from(peaks)); a.wave = file; a.version = (a.version || 0) + 1; this.persist();
      });
    }
    if (a.needsProxy) {
      const file = path.join(this.dirs.proxies, k + '.mp4');
      if (fs.existsSync(file)) a.proxy = file;
      else this.makeProxy(a, file);
    }
  }
  makeProxy(a, file) {
    return this.jobs.add({ type: 'proxy', label: 'Optimizing for smooth playback · ' + a.name, lane: 'heavy', meta: { mediaId: a.id } }, async ({ signal, progress }) => {
      const enc = await detectEncoders();
      const v = enc.nvenc ? ['-c:v', 'h264_nvenc', '-preset', 'p3', '-cq', '27', '-b:v', '0'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25'];
      const tmp = file + '.part.mp4';
      await run(ffmpeg, ['-y', '-v', 'error', '-i', a.path, '-vf', "scale='min(1280,iw)':-2,format=yuv420p", ...v, '-g', '15', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', '-progress', 'pipe:1', tmp], {
        signal, onStdout: d => { const m = [...String(d).matchAll(/out_time_us=(\d+)/g)].at(-1); if (m) progress(+m[1] / 1e6 / a.duration); },
      });
      await fsp.rename(tmp, file); a.proxy = file; a.version = (a.version || 0) + 1; this.persist();
    });
  }
  async relink(id, newPath) {
    const a = this.assets.get(id); if (!a) throw Error('That media is no longer in the library.');
    const info = await probeMedia(newPath);
    if (a.duration && Math.abs(info.duration - a.duration) > Math.max(1, a.duration * 0.05) && a.kind !== 'image') throw Error(`That file is ${info.duration.toFixed(1)}s long, but the original was ${a.duration.toFixed(1)}s. Choose the matching file.`);
    const st = await fsp.stat(newPath);
    Object.assign(a, info, { path: path.resolve(newPath), bytes: st.size, missing: false, thumb: null, strip: null, wave: null, proxy: null, version: (a.version || 0) + 1 });
    a.needsProxy = this.wantsProxy(a); this.ensureDerivatives(a); this.persist(); return a;
  }
  // Look for missing files by name inside a folder (bulk relink).
  async relinkFolder(folder) {
    const files = await this.expand([folder]); const fixed = [];
    for (const a of this.assets.values()) if (a.missing) {
      const hit = files.find(f => path.basename(f).toLowerCase() === a.name.toLowerCase());
      if (hit) { try { await this.relink(a.id, hit); fixed.push(a.id); } catch {} }
    }
    return fixed;
  }
  async remove(id) {
    const a = this.assets.get(id); if (!a) return;
    this.assets.delete(id); this.persist();
    // Only files FrameCut created (recordings, derived clips) are deleted; user media is never touched.
    const owned = [this.dirs.derived, path.join(this.dirs.media, 'recordings')].some(d => a.path.startsWith(d + path.sep));
    if (owned) await fsp.unlink(a.path).catch(() => {});
  }
}
module.exports = { Library, MEDIA_EXT };
