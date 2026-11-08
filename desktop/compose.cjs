// Builds the FFmpeg command for an export from the shared layer plan (shared/plan.mjs).
const path = require('node:path');
const { buildPlan } = require('../shared/plan.mjs');
const { dimensions, normalizeProject } = require('../shared/model.mjs');
const { fx, filterDef } = require('../shared/catalog.mjs');
const { fmtNum: f } = require('../shared/expr.mjs');
const { keyExpr } = require('../shared/audio.mjs');

const tempo = speed => { const parts = []; let s = speed; while (s > 2) { parts.push('atempo=2'); s /= 2; } while (s < 0.5) { parts.push('atempo=0.5'); s *= 2; } parts.push('atempo=' + f(s)); return parts.join(','); };
const even = n => Math.max(2, Math.round(n / 2) * 2);
const hex = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? '0x' + c.slice(1) : '0x000000');

const FORMATS = {
  mp4: { ext: 'mp4', video: true, codecs: ['h264', 'hevc'] }, mov: { ext: 'mov', video: true, codecs: ['h264', 'prores'] },
  mkv: { ext: 'mkv', video: true, codecs: ['h264', 'hevc'] }, webm: { ext: 'webm', video: true, codecs: ['vp9'] },
  avi: { ext: 'avi', video: true, codecs: ['mpeg4'] }, flv: { ext: 'flv', video: true, codecs: ['h264'] }, gif: { ext: 'gif', video: true, codecs: ['gif'] },
  mp3: { ext: 'mp3' }, wav: { ext: 'wav' }, m4a: { ext: 'm4a' }, aac: { ext: 'aac' }, flac: { ext: 'flac' }, ogg: { ext: 'ogg' },
};

// Color + effects chain for a layer at its static display size. Order mirrors the preview shader.
function colorChain(L, { H, luts }) {
  const c = L.clip, col = c.color || {}, out = [];
  if (col.exposure) out.push(`exposure=exposure=${f(col.exposure)}`);
  if (col.temperature || col.tint) out.push(`colorchannelmixer=rr=${f(1 + 0.15 * (col.temperature || 0))}:gg=${f(1 - 0.1 * (col.tint || 0))}:bb=${f(1 - 0.15 * (col.temperature || 0))}`);
  if ((col.brightness || 0) !== 0 || (col.contrast ?? 1) !== 1 || (col.saturation ?? 1) !== 1) out.push(`eq=brightness=${f(col.brightness || 0)}:contrast=${f(col.contrast ?? 1)}:saturation=${f(col.saturation ?? 1)}`);
  if (col.hue) out.push(`hue=h=${f(col.hue)}`);
  const lut = c.filter?.id && luts[c.filter.id];
  const intensity = c.filter?.intensity ?? 1;
  const effects = (c.effects || []).filter(e => e.id !== 'shake');
  const tail = [];
  for (const e of effects) {
    const a = e.amount ?? 0.5;
    if (e.id === 'blur' && a > 0) tail.push(`gblur=sigma=${f(fx.blurSigma(a, H))}`);
    if (e.id === 'sharpen' && a > 0) tail.push(`unsharp=5:5:${f(fx.sharpen(a))}:5:5:0`);
    if (e.id === 'pixelate' && a > 0) { const b = fx.pixelBlock(a, H); tail.push(`scale='max(1,trunc(iw/${b}))':'max(1,trunc(ih/${b}))':flags=neighbor`, `scale=${L.sw}:${L.sh}:flags=neighbor`); }
    if (e.id === 'vignette' && a > 0) tail.push(`vignette=angle=${f(fx.vignetteAngle(a))}`);
    if (e.id === 'grain' && a > 0) tail.push(`noise=alls=${fx.grain(a)}:allf=t`);
    if (e.id === 'rgbsplit' && a > 0) { const n = fx.rgbShift(a, H); tail.push(`rgbashift=rh=${-n}:bh=${n}`); }
    if (e.id === 'glitch' && a > 0) { const n = fx.rgbShift(Math.min(1, a * 2), H); tail.push(`rgbashift=rh=${-n}:bh=${n}:gv=${Math.round(n / 3)}:enable='${fx.glitchOn}'`, `noise=alls=${fx.grain(a)}:allf=t:enable='${fx.glitchOn}'`); }
  }
  return { pre: out, lut: lut ? { file: lut, intensity } : null, tail };
}

function renderPlan(raw, { assets, rasters = {}, luts = {}, processedAudio = {}, settings = {} }) {
  const project = normalizeProject(raw);
  const fmt = FORMATS[settings.format] ? settings.format : 'mp4', spec = FORMATS[fmt];
  const [W, H] = dimensions(project.settings.ratio, settings.resolution || project.settings.resolution);
  const fps = +settings.fps || project.settings.fps || 30;
  // Captions are rendered only when burning in.
  if (settings.subtitles && settings.subtitles !== 'burn') for (const t of project.tracks) if (t.captions) t.hidden = true;
  const media = id => assets.get(id);
  const sizes = id => rasters[id] ? { w: rasters[id].w, h: rasters[id].h } : null;
  const plan = buildPlan(project, { W, H, media, sizes, fps });
  for (const c of project.clips) if ((c.kind === 'video' || c.kind === 'image' || c.kind === 'audio') && !media(c.mediaId)) throw Error(`“${c.name || 'A clip'}” is missing its media file. Relink it, then export again.`);
  if (!plan.duration) throw Error('Your timeline is empty. Add a clip before exporting.');
  const range = settings.range && settings.range.to > settings.range.from ? settings.range : { from: 0, to: plan.duration };
  const total = plan.duration;
  const inputs = [], filters = [];
  const addInput = (args) => { inputs.push(...args); return inputs.filter(a => a === '-i').length - 1; };
  let base = '[base0]', n = 0;
  const next = () => `[base${++n}]`;

  if (spec.video) {
    const bg = project.settings.background || {};
    filters.push(`color=c=${bg.type === 'color' ? hex(bg.color) : '0x000000'}:s=${W}x${H}:r=${fps}:d=${f(total)},format=gbrp,setsar=1[base0]`);
    for (const L of plan.layers) {
      const vs = L.vs, ve = L.ve, dur = ve - vs; if (dur <= 0.001) continue;
      const enable = `enable='gte(t,${f(vs)})*lt(t,${f(ve)})'`;
      if (L.type === 'adjust') {
        L.sw = W; L.sh = H; const cc = colorChain(L, { H, luts }); if (!cc.pre.length && !cc.lut && !cc.tail.length) continue;
        const a = `[adj${n}a]`, b = `[adj${n}b]`, o = `[adj${n}o]`;
        filters.push(`${base}split${a}${b}`);
        let chain = [...cc.pre];
        if (cc.lut && cc.lut.intensity >= 0.999) chain.push(`lut3d=file=${cc.lut.file}`);
        filters.push(`${b}${chain.concat(cc.lut && cc.lut.intensity < 0.999 ? [] : cc.tail).join(',') || 'null'}${o}`);
        let src = o;
        if (cc.lut && cc.lut.intensity < 0.999) { const x = `[adj${n}x]`, y = `[adj${n}y]`, l = `[adj${n}l]`, m = `[adj${n}m]`; filters.push(`${o}split${x}${y}`, `${y}lut3d=file=${cc.lut.file}${l}`, `${x}${l}blend=all_mode=normal:all_opacity=${f(cc.lut.intensity)}${cc.tail.length ? ',' + cc.tail.join(',') : ''}${m}`); src = m; }
        const out = next(); filters.push(`${a}${src}overlay=0:0:format=gbrp:${enable}${out}`); base = out; continue;
      }
      if (L.type === 'dip') {
        const lab = `[dip${n}]`;
        filters.push(`color=c=${hex(L.color)}:s=${W}x${H}:r=${fps}:d=${f(dur)},format=rgba,setpts=PTS+${f(vs)}/TB,${L.fades.map(fd => `fade=t=${fd.dir}:st=${f(fd.st)}:d=${f(Math.max(0.01, fd.d))}:alpha=1`).join(',')}${lab}`);
        const out = next(); filters.push(`${base}${lab}overlay=0:0:eof_action=pass:repeatlast=0:format=gbrp:${enable}${out}`); base = out; continue;
      }
      let idx, chain = [];
      if (L.type === 'raster') {
        const variants = L.variants?.length ? [...(L.variants[0].from > vs + 0.001 ? [{ key: null, from: vs, to: L.variants[0].from }] : []), ...L.variants] : [null];
        // Text variants (word highlight) become separate windows of the same layer.
        for (const v of variants) {
          const r = rasters[L.id]; if (!r) throw Error('Text could not be prepared for export. Try again.');
          const file = v?.key ? r.variants?.[v.key] || r.file : r.file;
          const wvs = v ? Math.max(vs, v.from) : vs, wve = v ? Math.min(ve, v.to) : ve; if (wve - wvs <= 0.001) continue;
          const i = addInput(['-loop', '1', '-framerate', String(fps), '-t', f(wve - wvs + 0.1), '-i', file]);
          emit(L, i, wvs, wve, [`setpts=PTS-STARTPTS`, `scale=${even(L.baseW)}:${even(L.baseH)}`]);
        }
        continue;
      }
      // media (video / image) and blurred canvas background
      const a = media(L.mediaId); const c = L.clip;
      if (L.image) idx = addInput(['-loop', '1', '-framerate', String(fps), '-t', f(dur + 0.1), '-i', a.path]);
      else {
        const speed = c.speed || 1, maxT = Math.max(0, (a.duration || 0) - 0.04);
        const rawA = c.in + (vs - c.start) * speed, rawB = c.in + (ve - c.start) * speed;
        const srcA = Math.min(Math.max(0, rawA), maxT), srcB = Math.min(Math.max(srcA + 0.04, rawB), Math.max(srcA + 0.04, maxT + 0.04));
        const pre = Math.max(0, (0 - rawA) / speed), post = Math.max(0, (rawB - (maxT + 0.04)) / speed);
        idx = addInput([...(a.alpha ? ['-c:v', 'libvpx-vp9'] : []), '-ss', f(srcA), '-t', f(srcB - srcA + 0.25), '-i', a.path]);
        if (!a.colorspace || a.colorspace === 'unknown') chain.push('setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv');
        chain.push(`trim=duration=${f(srcB - srcA)}`, `setpts=(PTS-STARTPTS)/${f(speed)}`, `fps=${fps}`);
        if (pre > 0.001 || post > 0.001) chain.push(`tpad=start_duration=${f(pre)}:stop_duration=${f(post + 0.1)}:start_mode=clone:stop_mode=clone`);
        else chain.push(`tpad=stop_duration=0.1:stop_mode=clone`);
      }
      if (L.image) chain.push('setpts=PTS-STARTPTS');
      if (L.type === 'bgblur') {
        const k = 4, s = Math.max(0.5, L.blur / k);
        chain.push(`scale=${even(W / k)}:${even(H / k)}:force_original_aspect_ratio=increase`, `crop=${even(W / k)}:${even(H / k)}`, `gblur=sigma=${f(s)}`, `scale=${W}:${H}`, 'setsar=1', 'format=gbrp', `setpts=PTS+${f(vs)}/TB`);
        const lab = `[l${n}]`; filters.push(`[${idx}:v:0]${chain.join(',')}${lab}`);
        const out = next(); filters.push(`${base}${lab}overlay=0:0:eof_action=pass:repeatlast=0:format=gbrp:${enable}${out}`); base = out; continue;
      }
      const cr = c.crop || {};
      if (cr.l || cr.t || cr.r || cr.b) chain.push(`crop=iw*${f(1 - (cr.l || 0) - (cr.r || 0))}:ih*${f(1 - (cr.t || 0) - (cr.b || 0))}:iw*${f(cr.l || 0)}:ih*${f(cr.t || 0)}`);
      chain.push(`scale=${even(L.baseW)}:${even(L.baseH)}`, 'setsar=1');
      emit(L, idx, vs, ve, chain);
    }
    function emit(L, idx, vs, ve, chain) {
      const c = L.clip; L.sw = even(L.baseW); L.sh = even(L.baseH);
      if (L.flipH) chain.push('hflip'); if (L.flipV) chain.push('vflip');
      const cc = colorChain(L, { H, luts });
      chain.push(...cc.pre);
      let src = `[${idx}:v:0]`;
      if (cc.lut && cc.lut.intensity >= 0.999) chain.push(`lut3d=file=${cc.lut.file}`);
      else if (cc.lut) {
        const x = `[lx${idx}]`, y = `[ly${idx}]`, l = `[ll${idx}]`, merged = `[lm${idx}]`;
        filters.push(`${src}${chain.join(',')},format=gbrp,split${x}${y}`, `${y}lut3d=file=${cc.lut.file}${l}`, `${x}${l}blend=all_mode=normal:all_opacity=${f(cc.lut.intensity)}${merged}`);
        chain = []; src = merged;
      }
      const post = [...cc.tail, 'format=rgba'];
      if ((L.opacity ?? 1) < 0.999) post.push(`colorchannelmixer=aa=${f(Math.max(0, L.opacity))}`);
      post.push(`setpts=PTS+${f(vs)}/TB`);
      // Animated opacity: per-frame alpha multiply (geq evaluates T in timeline seconds after setpts).
      if (L.alphaExpr) post.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${L.alphaExpr.replace(/\bt\b/g, 'T')})'`);
      for (const fd of L.fades) post.push(`fade=t=${fd.dir}:st=${f(fd.st)}:d=${f(Math.max(0.01, fd.d))}:alpha=1`);
      for (const s of L.steps) post.push(`fade=t=in:st=${f(s.at)}:d=${f(1 / fps)}:alpha=1`);
      const m = L.motion;
      if (m.s) post.push(`scale=w='max(2,trunc(${f(L.sw)}*(${m.s})/2)*2)':h='max(2,trunc(${f(L.sh)}*(${m.s})/2)*2)':eval=frame`);
      const rot = (L.rot0 || 0) !== 0 || m.r;
      if (rot) post.push(`rotate=a='(${f(L.rot0 || 0)}${m.r ? '+' + m.r : ''})*PI/180':c=none:ow='hypot(iw,ih)':oh='hypot(iw,ih)'`);
      const out = `[v${n}_${Math.random().toString(36).slice(2, 7)}]`;
      filters.push(`${src}${[...chain, ...post].join(',')}${out}`);
      const x = `${f(L.cx)}${m.x ? '+' + m.x : ''}-w/2`, y = `${f(L.cy)}${m.y ? '+' + m.y : ''}-h/2`;
      const nb = next(); filters.push(`${base}${out}overlay=x='${x}':y='${y}':eval=frame:eof_action=pass:repeatlast=0:format=gbrp:enable='gte(t,${f(vs)})*lt(t,${f(ve)})'${nb}`); base = nb;
    }
  }

  // Audio
  const mix = [], wantAudio = fmt !== 'gif';
  if (wantAudio) { filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f(total)}[silence]`); mix.push('[silence]'); }
  for (const A of wantAudio ? plan.audio : []) {
    const a = media(A.mediaId); if (!a) continue;
    const file = A.processed ? processedAudio[A.id] : a.path; if (!file) throw Error('Audio effects are still being prepared. Try exporting again in a moment.');
    const len = A.srcOut - A.srcIn;
    const i = addInput(['-ss', f(A.srcIn), '-t', f(len + 0.25), '-i', file]);
    const fi = Math.max(0.012, A.fadeIn || 0), fo = Math.max(0.012, A.fadeOut || 0);
    const lab = `[a${i}]`;
    filters.push(`[${i}:a:0]atrim=duration=${f(len)},asetpts=PTS-STARTPTS,${tempo(A.speed)},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${f(A.volume)},${A.keys?.length ? `volume='${keyExpr(A.keys)}':eval=frame,` : ''}afade=t=in:st=0:d=${f(fi)},afade=t=out:st=${f(Math.max(0, A.duration - fo))}:d=${f(fo)},atrim=duration=${f(A.duration)},adelay=${Math.round(A.start * 1000)}:all=1${lab}`);
    mix.push(lab);
  }
  if (wantAudio) filters.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.891:level=false:attack=2:release=40[amix]`);

  if (spec.video) { filters.push(`${base}scale=out_color_matrix=bt709:out_range=tv,format=${fmt === 'gif' ? 'rgb24' : settings.codec === 'prores' ? 'yuv422p10le' : 'yuv420p'},setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709${fmt === 'gif' ? '' : ':range=tv'}[vfinal]`); base = '[vfinal]'; }
  let vout = base, aout = '[amix]';
  if (range.from > 0 || range.to < total) {
    if (spec.video) { filters.push(`${base}trim=start=${f(range.from)}:end=${f(range.to)},setpts=PTS-STARTPTS[vr]`); vout = '[vr]'; }
    if (wantAudio) filters.push(`[amix]atrim=start=${f(range.from)}:end=${f(range.to)},asetpts=PTS-STARTPTS[ar]`); aout = '[ar]';
  }
  if (fmt === 'gif') { filters.push(`${vout}fps=${Math.min(fps, 20)},split[g1][g2];[g1]palettegen=stats_mode=diff[gp];[g2][gp]paletteuse=dither=bayer:bayer_scale=5[gif]`); vout = '[gif]'; }

  const out = ['-hide_banner', '-y', '-nostdin', ...inputs, '-filter_complex_script', 'graph.txt'];
  if (spec.video) out.push('-map', vout);
  if (fmt !== 'gif') out.push('-map', aout);
  out.push('-t', f(range.to - range.from));
  out.push(...encoderArgs(fmt, settings));
  if (spec.video && fmt !== 'gif') out.push('-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv');
  out.push('-progress', 'pipe:1', '-nostats');
  return { args: out, graph: filters.join(';\n'), duration: range.to - range.from, width: W, height: H, fps, ext: spec.ext, plan };
}

function encoderArgs(fmt, s) {
  const q = { high: 0, balanced: 1, small: 2 }[s.quality] ?? 1;
  const crf = [18, 23, 28][q], cq = [19, 25, 31][q];
  const kbps = +s.bitrate > 0 ? Math.round(+s.bitrate) : 0;
  const ab = [128, 192, 256, 320].includes(+s.audioBitrate) ? +s.audioBitrate : 192;
  const rate = kbps ? ['-b:v', kbps + 'k', '-maxrate', Math.round(kbps * 1.5) + 'k', '-bufsize', kbps * 2 + 'k'] : null;
  const hw = s.hardwareEncoder; // 'nvenc' | 'amf' | 'qsv' | null (resolved by server)
  const aac = ['-c:a', 'aac', '-b:a', ab + 'k'];
  const codec = s.codec;
  const h264 = () => hw === 'nvenc' ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', ...(rate || ['-rc', 'vbr', '-cq', String(cq), '-b:v', '0']), '-pix_fmt', 'yuv420p']
    : hw === 'amf' ? ['-c:v', 'h264_amf', '-quality', 'quality', ...(rate || ['-rc', 'cqp', '-qp_i', String(cq), '-qp_p', String(cq)]), '-pix_fmt', 'yuv420p']
    : hw === 'qsv' ? ['-c:v', 'h264_qsv', ...(rate || ['-global_quality', String(cq)]), '-pix_fmt', 'nv12']
    : ['-c:v', 'libx264', '-preset', 'medium', ...(rate || ['-crf', String(crf)]), '-pix_fmt', 'yuv420p'];
  const hevc = () => hw === 'nvenc' ? ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-tune', 'hq', ...(rate || ['-rc', 'vbr', '-cq', String(cq + 2), '-b:v', '0']), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1']
    : hw === 'amf' ? ['-c:v', 'hevc_amf', ...(rate || ['-rc', 'cqp', '-qp_i', String(cq), '-qp_p', String(cq)]), '-tag:v', 'hvc1']
    : hw === 'qsv' ? ['-c:v', 'hevc_qsv', ...(rate || ['-global_quality', String(cq)]), '-tag:v', 'hvc1']
    : ['-c:v', 'libx265', '-preset', 'medium', ...(rate || ['-crf', String(crf + 4)]), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'];
  switch (fmt) {
    case 'mp4': return [...(codec === 'hevc' ? hevc() : h264()), ...aac, '-movflags', '+faststart'];
    case 'mkv': return [...(codec === 'hevc' ? hevc() : h264()), ...aac];
    case 'flv': return [...h264(), ...aac];
    case 'mov': return codec === 'prores' ? ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s16le'] : [...h264(), ...aac, '-movflags', '+faststart'];
    case 'webm': return ['-c:v', 'libvpx-vp9', ...(rate || ['-crf', String(crf + 10), '-b:v', '0']), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '3', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', Math.min(ab, 256) + 'k'];
    case 'avi': return ['-c:v', 'mpeg4', '-vtag', 'xvid', ...(rate || ['-q:v', String([2, 4, 7][q])]), '-c:a', 'libmp3lame', '-b:a', ab + 'k'];
    case 'gif': return ['-loop', '0'];
    case 'mp3': return ['-c:a', 'libmp3lame', '-b:a', ab + 'k'];
    case 'wav': return ['-c:a', 'pcm_s16le'];
    case 'm4a': case 'aac': return ['-c:a', 'aac', '-b:a', ab + 'k'];
    case 'flac': return ['-c:a', 'flac'];
    case 'ogg': return ['-c:a', 'libvorbis', '-b:a', ab + 'k'];
  }
  return [];
}

module.exports = { renderPlan, FORMATS, tempo };
