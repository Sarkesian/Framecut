// Editing tools that produce new, non-destructive media (reverse, freeze frame, stabilize,
// smooth slow motion, processed audio) plus analysis tools (silence, scene detection) and export.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { run, ffmpeg, detectEncoders, friendlyError } = require('./tools.cjs');
const { renderPlan } = require('./compose.cjs');
const { normalizeProject } = require('../shared/model.mjs');
const { lutCube, filterDef } = require('../shared/catalog.mjs');
const { buildPlan, hasAudioFx, audioFxKey } = require('../shared/plan.mjs');
const { audioFx: fxOf, audioChain } = require('../shared/audio.mjs');
const { spawn } = require('node:child_process');

const f = n => String(+(+n).toFixed(4));
const progressFrom = (dur, progress) => d => { const m = [...String(d).matchAll(/out_time_us=(\d+)/g)].at(-1); if (m && dur > 0) progress(+m[1] / 1e6 / dur); };


class Studio {
  constructor({ library, jobs, cacheDir, dataDir, prefs }) { this.library = library; this.jobs = jobs; this.cacheDir = cacheDir; this.dataDir = dataDir; this.prefs = prefs; }
  derivedPath(name) { return path.join(this.library.dirs.derived, name); }
  async videoEncoder() { const e = await detectEncoders(); return e.nvenc && this.prefs().hardware !== 'off' ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '18', '-b:v', '0'] : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '17']; }
  asset(id) { const a = this.library.get(id); if (!a) throw Error('That media is no longer in your library.'); if (a.missing) throw Error(`“${a.name}” is missing. Relink it first.`); return a; }

  processedAudioPath(a, clip) { return path.join(this.library.dirs.audio, `${this.library.key(a)}_${audioFxKey(clip)}.wav`); }
  // Render the clip's audio chain for the whole source file. Loudness normalisation is a measured second pass.
  async ensureProcessedAudio(a, clip, { signal, progress } = {}) {
    const file = this.processedAudioPath(a, clip); if (fs.existsSync(file)) return file;
    const fx = fxOf(clip), tmp = `${file}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.part.wav`; // unique: preview and export may render the same file at once
    const pass = (chain, out, p0, p1) => run(ffmpeg, ['-y', '-v', 'error', '-i', a.path, '-vn', '-af', chain, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', '-progress', 'pipe:1', out], { signal, onStdout: progress && progressFrom(a.duration, p => progress(p0 + p * (p1 - p0))) });
    if (fx.level.on && fx.level.mode === 'loudness') {
      const lufs = await this.measureLoudness(a.path, audioChain({ ...fx, limiter: { on: false } }), { signal });
      const gain = Number.isFinite(lufs) ? Math.max(-30, Math.min(30, fx.level.target - lufs)) : 0;
      await pass(audioChain({ ...fx, limiter: { on: true, ceiling: fx.limiter.on ? fx.limiter.ceiling : -1 } }, { levelGain: gain }), tmp, 0.3, 1);
    } else await pass(audioChain(fx), tmp, 0, 1);
    await fsp.rename(tmp, file); return file;
  }
  async measureLoudness(file, chain = 'anull', { signal, from, to } = {}) {
    const range = from !== undefined ? ['-ss', f(from), '-t', f(Math.max(0.05, to - from))] : [];
    const { err } = await run(ffmpeg, ['-hide_banner', '-nostats', ...range, '-i', file, '-vn', '-af', `${chain},ebur128=peak=true`, '-f', 'null', '-'], { signal });
    const i = [...err.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1); const pk = [...err.matchAll(/Peak:\s+(-?[\d.]+|-inf) dBFS/g)].at(-1);
    this.lastPeak = pk ? +pk[1] : null; return i ? +i[1] : NaN;
  }
  audioFx({ mediaId, clip }) {
    const a = this.asset(mediaId);
    const file = this.processedAudioPath(a, clip);
    if (fs.existsSync(file)) return { done: true, url: `/cache/audio/${path.basename(file)}` };
    const job = this.jobs.add({ type: 'audiofx', label: 'Applying audio effects · ' + a.name, lane: 'light', meta: { mediaId } }, async ctx => { const out = await this.ensureProcessedAudio(a, clip, ctx); return { url: `/cache/audio/${path.basename(out)}` }; });
    return { job: job.id };
  }

  reverse({ mediaId, from, to }) {
    const a = this.asset(mediaId); const len = Math.max(0.1, to - from);
    if (len > 180) throw Error('Reverse works on up to 3 minutes at a time. Split the clip first.');
    return this.jobs.add({ type: 'reverse', label: 'Reversing ' + a.name, lane: 'heavy', meta: { mediaId } }, async ({ signal, progress }) => {
      const out = this.derivedPath(`${a.id}-rev-${Date.now()}.mp4`), enc = await this.videoEncoder();
      const af = a.audio ? ['-af', 'areverse', '-c:a', 'aac', '-b:a', '256k'] : ['-an'];
      await run(ffmpeg, ['-y', '-v', 'error', '-ss', f(from), '-t', f(len), '-i', a.path, '-vf', "scale='min(1920,iw)':-2,reverse,format=yuv420p", ...af, ...enc, '-progress', 'pipe:1', out], { signal, onStdout: progressFrom(len, progress) });
      const asset = await this.library.importPath(out, { name: a.name.replace(/(\.[^.]+)?$/, ' (reversed)$1'), derivedFrom: a.id, derivedKind: 'reversed', derivedRange: [from, to] });
      return { asset: this.library.public(asset) };
    });
  }
  async freeze({ mediaId, time }) {
    const a = this.asset(mediaId);
    const out = this.derivedPath(`${a.id}-frame-${Math.round(time * 1000)}-${Date.now()}.png`);
    await run(ffmpeg, ['-y', '-v', 'error', '-ss', f(Math.max(0, Math.min(time, a.duration - 0.05))), '-i', a.path, '-frames:v', '1', out]);
    const asset = await this.library.importPath(out, { name: a.name.replace(/(\.[^.]+)?$/, ` (frame ${time.toFixed(2)}s)`), derivedFrom: a.id, derivedKind: 'freeze' });
    return { asset: this.library.public(asset) };
  }
  stabilize({ mediaId, from, to, strength = 0.5 }) {
    const a = this.asset(mediaId); const len = Math.max(0.2, to - from);
    return this.jobs.add({ type: 'stabilize', label: 'Stabilizing ' + a.name, lane: 'heavy', meta: { mediaId } }, async ({ signal, progress }) => {
      const dir = await fsp.mkdtemp(path.join(this.cacheDir, 'stab-'));
      try {
        await run(ffmpeg, ['-y', '-v', 'error', '-ss', f(from), '-t', f(len), '-i', a.path, '-vf', `vidstabdetect=shakiness=${Math.round(4 + strength * 6)}:accuracy=12:result=t.trf`, '-f', 'null', '-progress', 'pipe:1', '-'], { cwd: dir, signal, onStdout: progressFrom(len, p => progress(p * 0.5, 'Analyzing motion…')) });
        const out = this.derivedPath(`${a.id}-stab-${Date.now()}.mp4`), enc = await this.videoEncoder();
        const af = a.audio ? ['-c:a', 'aac', '-b:a', '256k'] : ['-an'];
        await run(ffmpeg, ['-y', '-v', 'error', '-ss', f(from), '-t', f(len), '-i', a.path, '-vf', `vidstabtransform=input=t.trf:smoothing=${Math.round(10 + strength * 40)}:zoom=0:optzoom=1,unsharp=5:5:0.6:3:3:0.3,format=yuv420p`, ...af, ...enc, '-progress', 'pipe:1', out], { cwd: dir, signal, onStdout: progressFrom(len, p => progress(0.5 + p * 0.5, 'Smoothing camera motion…')) });
        const asset = await this.library.importPath(out, { name: a.name.replace(/(\.[^.]+)?$/, ' (stabilized)$1'), derivedFrom: a.id, derivedKind: 'stabilized', derivedRange: [from, to] });
        return { asset: this.library.public(asset) };
      } finally { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
    });
  }
  smoothSlowmo({ mediaId, from, to, speed, fps }) {
    const a = this.asset(mediaId); const len = Math.max(0.2, to - from);
    if (len > 30) throw Error('Smooth slow motion works on up to 30 seconds of source footage. Trim the clip first.');
    const target = Math.min(240, Math.ceil((fps || 30) / Math.max(0.1, speed || 0.5)));
    return this.jobs.add({ type: 'interpolate', label: 'Creating smooth slow motion · ' + a.name, lane: 'heavy', meta: { mediaId } }, async ({ signal, progress }) => {
      const out = this.derivedPath(`${a.id}-smooth-${Date.now()}.mp4`), enc = await this.videoEncoder();
      const af = a.audio ? ['-c:a', 'aac', '-b:a', '256k'] : ['-an'];
      await run(ffmpeg, ['-y', '-v', 'error', '-ss', f(from), '-t', f(len), '-i', a.path, '-vf', `scale='min(1920,iw)':-2,minterpolate=fps=${target}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p`, ...af, ...enc, '-progress', 'pipe:1', out], { signal, onStdout: progressFrom(len, progress) });
      const asset = await this.library.importPath(out, { name: a.name.replace(/(\.[^.]+)?$/, ' (smooth)$1'), derivedFrom: a.id, derivedKind: 'smooth', derivedRange: [from, to] });
      return { asset: this.library.public(asset) };
    });
  }
  async silence({ mediaId, from = 0, to, threshold = -35, minSilence = 0.4 }) {
    const a = this.asset(mediaId); if (!a.audio) throw Error('This clip has no audio to analyze.');
    const len = (to ?? a.duration) - from;
    const { err } = await run(ffmpeg, ['-hide_banner', '-ss', f(from), '-t', f(len), '-i', a.path, '-vn', '-af', `silencedetect=noise=${f(Math.max(-70, Math.min(-10, threshold)))}dB:d=${f(minSilence)}`, '-f', 'null', '-']);
    const intervals = []; let start = null;
    for (const line of err.split('\n')) {
      let m = /silence_start: (-?[\d.]+)/.exec(line); if (m) start = Math.max(0, +m[1]);
      m = /silence_end: ([\d.]+)/.exec(line); if (m && start !== null) { intervals.push({ start: from + start, end: from + +m[1] }); start = null; }
    }
    if (start !== null) intervals.push({ start: from + start, end: from + len });
    return { intervals };
  }
  scenes({ mediaId, from = 0, to, threshold = 0.3 }) {
    const a = this.asset(mediaId); if (!a.video || a.kind === 'image') throw Error('Choose a video clip to detect scenes.');
    const len = (to ?? a.duration) - from;
    return this.jobs.add({ type: 'scenes', label: 'Detecting scenes · ' + a.name, lane: 'heavy', meta: { mediaId } }, async ({ signal, progress }) => {
      const { out } = await run(ffmpeg, ['-hide_banner', '-v', 'error', '-ss', f(from), '-t', f(len), '-i', a.path, '-an', '-vf', `scale=256:-2,select='gt(scene,${f(threshold)})',metadata=print:file=-`, '-f', 'null', '-progress', 'pipe:2', '-'], {
        signal, onStderr: d => { const m = [...String(d).matchAll(/out_time_us=(\d+)/g)].at(-1); if (m) progress(+m[1] / 1e6 / len); },
      });
      const times = [...out.matchAll(/pts_time:([\d.]+)/g)].map(m => from + +m[1]).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 0.5);
      return { times };
    });
  }
  // ----- Background removal (matting) -----
  // The app streams small frames to its AI worker and sends back one 8-bit mask per frame;
  // the masks are upscaled and merged as alpha onto the full-resolution original (VP9 + alpha).
  matteStart({ mediaId, from = 0, to, fps }) {
    const a = this.asset(mediaId); if (!a.video || a.kind === 'image') throw Error('Background removal works on video clips.');
    const A = Math.max(0, from), B = Math.min(a.duration || to, to ?? a.duration), len = B - A;
    if (!(len > 0.05)) throw Error('That clip is too short.'); if (len > 600) throw Error('Remove backgrounds in parts of up to 10 minutes. Split the clip first.');
    const rate = Math.max(1, Math.min(60, Math.round(+fps || a.fps || 30)));
    // Model input: long side 512, both sides multiples of 32 (MODNet).
    const k = 512 / Math.max(a.width, a.height), r32 = v => Math.max(32, Math.round(v * k / 32) * 32);
    const id = require('node:crypto').randomUUID(), dir = this.library.dirs.derived;
    const sess = { id, mediaId, from: A, to: B, fps: rate, mw: r32(a.width), mh: r32(a.height), frames: Math.max(1, Math.round(len * rate)), mask: path.join(dir, `${a.id}-matte-${id.slice(0, 8)}.gray`), received: 0 };
    fs.writeFileSync(sess.mask, Buffer.alloc(0)); (this.mattes ||= new Map()).set(id, sess);
    return { session: id, mw: sess.mw, mh: sess.mh, fps: rate, frames: sess.frames };
  }
  matteSession(id) { const s = this.mattes?.get(id); if (!s) throw Error('That background removal session has ended.'); return s; }
  // Raw RGB24 frames at mask size, streamed in order.
  matteFrames(id, res) {
    const s = this.matteSession(id), a = this.asset(s.mediaId);
    const { spawn } = require('node:child_process');
    const p = spawn(ffmpeg, ['-v', 'error', '-ss', f(s.from), '-t', f(s.to - s.from), '-i', a.path, '-an', '-vf', `fps=${s.fps},scale=${s.mw}:${s.mh}:flags=area,format=rgb24`, '-frames:v', String(s.frames), '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true });
    res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('X-Frame-Bytes', String(s.mw * s.mh * 3));
    p.stdout.pipe(res); res.on('close', () => p.kill());
  }
  async matteMask(id, body) {
    const s = this.matteSession(id), size = s.mw * s.mh;
    if (body.length % size) throw Error('Mask data is incomplete.');
    await fsp.appendFile(s.mask, body); s.received += body.length / size; return { received: s.received };
  }
  matteCancel(id) { const s = this.mattes?.get(id); if (!s) return; this.mattes.delete(id); fs.rmSync(s.mask, { force: true }); }
  matteFinish(id) {
    const s = this.matteSession(id), a = this.asset(s.mediaId); this.mattes.delete(id);
    if (s.received < 1) { fs.rmSync(s.mask, { force: true }); throw Error('No frames were processed.'); }
    return this.jobs.add({ type: 'matte', label: 'Removing background · ' + a.name, lane: 'heavy', meta: { mediaId: a.id } }, async ({ signal, progress }) => {
      const len = s.received / s.fps, out = this.derivedPath(`${a.id}-cutout-${Date.now()}.webm`);
      const W = Math.min(1920, a.width % 2 ? a.width - 1 : a.width), H = Math.round(W * a.height / a.width / 2) * 2;
      const af = a.audio ? ['-map', '0:a:0?', '-c:a', 'libopus', '-b:a', '192k'] : [];
      try {
        await run(ffmpeg, ['-y', '-v', 'error', '-ss', f(s.from), '-t', f(len), '-i', a.path,
          '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${s.mw}x${s.mh}`, '-r', String(s.fps), '-i', s.mask,
          '-filter_complex', `[0:v]fps=${s.fps},scale=${W}:${H},format=yuv420p[c];[1:v]scale=${W}:${H}:flags=bicubic,format=gray[m];[c][m]alphamerge,format=yuva420p[v]`,
          '-map', '[v]', ...af, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '24', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0',
          '-metadata:s:v:0', 'alpha_mode=1', '-t', f(len), '-progress', 'pipe:1', out], { signal, onStdout: progressFrom(len, progress) });
      } finally { fs.rmSync(s.mask, { force: true }); }
      const asset = await this.library.importPath(out, { name: a.name.replace(/(\.[^.]+)?$/, ' (cutout)'), derivedFrom: a.id, derivedKind: 'cutout', derivedRange: [s.from, s.from + len] });
      return { asset: this.library.public(asset), from: s.from };
    });
  }
  async speechAudio({ mediaId, from = 0, to }) {
    const a = this.asset(mediaId); if (!a.audio) throw Error('This clip has no audio.');
    const len = Math.max(0.1, (to ?? a.duration) - from);
    const out = path.join(this.library.dirs.audio, `${a.id}-speech-${Math.round(from * 1000)}-${Math.round(len * 1000)}.wav`);
    if (!fs.existsSync(out)) await run(ffmpeg, ['-y', '-v', 'error', '-ss', f(from), '-t', f(len), '-i', a.path, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
    return { url: `/cache/audio/${path.basename(out)}`, duration: len, file: out };
  }
  async lutFile(id) {
    if (id.startsWith('user:')) {
      const file = path.join(this.dataDir, 'luts', id.slice(5).replace(/[^a-z0-9_.-]/gi, '') + '.cube');
      if (!fs.existsSync(file)) throw Error('A LUT used in this project is missing.');
      return file;
    }
    if (!filterDef(id)) throw Error('Unknown filter: ' + id);
    const file = path.join(this.cacheDir, 'luts', id + '.cube');
    if (!fs.existsSync(file)) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, lutCube(id)); }
    return file;
  }

  // ---------- Export ----------
  exportVideo({ project: raw, rasters = {}, settings = {} }) {
    const project = normalizeProject(raw);
    const output = settings.output ? path.resolve(String(settings.output)) : ''; if (!output) throw Error('Choose where to save your video.');
    if (!path.extname(output)) throw Error('Add a file extension to the file name (for example .mp4).');
    // Never write over media the editor uses: the export replaces the file at the very end, which would
    // destroy a source clip (or a recording) still referenced by this or another project.
    const same = p => !!p && path.resolve(p).toLowerCase() === output.toLowerCase();
    const used = [...this.library.assets.values()].find(a => same(a.path) || same(a.proxy));
    if (used) throw Object.assign(Error(`“${path.basename(output)}” is a media file in your library (${used.name}). Choose a different file name for the export.`), { code: 'source' });
    if (!settings.overwrite && fs.existsSync(output)) throw Object.assign(Error(`“${path.basename(output)}” already exists in that folder.`), { code: 'exists' });
    // Side files (temp, .srt, credits) sit next to the output: derive them from the file's own stem only.
    const stem = output.slice(0, output.length - path.extname(output).length);
    settings = { ...settings, output };
    return this.jobs.add({ type: 'export', label: 'Exporting ' + project.name, lane: 'export', meta: { projectId: project.id, output } }, async ({ signal, progress }) => {
      const dir = await fsp.mkdtemp(path.join(this.cacheDir, 'export-'));
      try {
        progress(0, 'Preparing media…');
        await fsp.mkdir(path.dirname(output), { recursive: true });
        // Text, stickers and vector images are rasterized by the editor at export size.
        const rasterFiles = {};
        for (const [id, r] of Object.entries(rasters)) {
          const save = async (dataUrl, name) => { const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || ''); if (!m) throw Error('Text could not be prepared.'); const file = path.join(dir, name); await fsp.writeFile(file, Buffer.from(m[1], 'base64')); return file; };
          const safe = id.replace(/[^a-z0-9-]/gi, '');
          rasterFiles[id] = { w: r.w, h: r.h, boxes: r.boxes, words: r.words, file: await save(r.png, `r-${safe}.png`), variants: {} };
          for (const [k, png] of Object.entries(r.variants || {})) rasterFiles[id].variants[k] = await save(png, `r-${safe}-${k.replace(/[^a-z0-9]/gi, '')}.png`);
        }
        const assets = new Map();
        for (const c of project.clips) if (c.mediaId && !assets.has(c.mediaId)) {
          const a = this.library.get(c.mediaId); if (!a || a.missing) throw Error(`“${a?.name || 'A media file'}” is missing. Relink it from the media panel, then export again.`);
          assets.set(c.mediaId, a);
        }
        const luts = {};
        for (const c of project.clips) if (c.filter?.id && !luts[c.filter.id]) { const src = await this.lutFile(c.filter.id); const name = 'lut-' + c.filter.id.replace(/[^a-z0-9-]/gi, '') + '.cube'; await fsp.copyFile(src, path.join(dir, name)); luts[c.filter.id] = name; }
        const processedAudio = {};
        for (const c of project.clips) if (hasAudioFx(c) && (c.kind === 'video' || c.kind === 'audio')) { progress(0, 'Applying audio effects…'); processedAudio[c.id] = await this.ensureProcessedAudio(assets.get(c.mediaId), c, { signal }); }
        const enc = await detectEncoders();
        const hw = settings.hardware === 'off' || this.prefs().hardware === 'off' ? null : enc.preferred;
        const ext = path.extname(output).slice(1).toLowerCase();
        const tmp = `${stem}.framecut-part.${ext || 'mp4'}`;
        const attempt = async hardwareEncoder => {
          const plan = renderPlan(project, { assets, rasters: rasterFiles, luts, processedAudio, settings: { ...settings, hardwareEncoder }, captionPresets: this.prefs().captionPresets || [] });
          await fsp.writeFile(path.join(dir, 'graph.txt'), plan.graph);
          progress(0, 'Rendering…');
          await new Promise((resolve, reject) => {
            const child = spawn(ffmpeg, [...plan.args, tmp], { cwd: dir, windowsHide: true }); let log = '';
            const abort = () => child.kill('SIGKILL'); signal.addEventListener('abort', abort, { once: true });
            child.stdout.on('data', progressFrom(plan.duration, p => progress(Math.min(0.995, p), 'Rendering…')));
            child.stderr.on('data', d => { log = (log + d).slice(-20000); });
            child.on('error', reject);
            child.on('close', code => { signal.removeEventListener('abort', abort); if (signal.aborted) return reject(Object.assign(Error('Export cancelled.'), { cancelled: true })); code === 0 ? resolve() : reject(Object.assign(Error(friendlyError(log) || 'Export failed.'), { log })); });
          });
          return plan;
        };
        let plan;
        try { plan = await attempt(hw); }
        catch (e) { if (!hw || e.cancelled) throw e; progress(0, 'Hardware encoder unavailable, using software encoder…'); plan = await attempt(null); }
        // rename replaces an existing file in one step (the user confirmed overwriting it); no separate delete.
        await fsp.rename(tmp, output);
        if (settings.subtitles === 'srt') await fsp.writeFile(stem + '.srt', toSrt(project, settings.range));
        // Credits for licensed library assets (CC BY etc.), saved next to the video when asked.
        let creditsFile = null;
        if (typeof settings.credits === 'string' && settings.credits.trim()) { creditsFile = stem + ' - credits.txt'; await fsp.writeFile(creditsFile, settings.credits.slice(0, 200000).replace(/\r?\n/g, '\r\n')); }
        const st = await fsp.stat(output);
        return { output, bytes: st.size, duration: plan.duration, width: plan.width, height: plan.height, creditsFile };
      } catch (e) {
        await fsp.rm(`${stem}.framecut-part.${path.extname(output).slice(1).toLowerCase() || 'mp4'}`, { force: true }).catch(() => {});
        throw e;
      } finally { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
    });
  }
}

function srtTime(s) { const ms = Math.max(0, Math.round(s * 1000)); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; }
function toSrt(project, range) {
  const from = range?.from || 0, to = range?.to || Infinity;
  const caps = project.clips.filter(c => c.kind === 'text' && project.tracks.find(t => t.id === c.trackId)?.captions).sort((a, b) => a.start - b.start)
    .filter(c => c.start + c.duration > from && c.start < to);
  return caps.map((c, i) => `${i + 1}\n${srtTime(Math.max(0, c.start - from))} --> ${srtTime(Math.min(to, c.start + c.duration) - from)}\n${c.text}\n`).join('\n');
}
module.exports = { Studio, toSrt };
