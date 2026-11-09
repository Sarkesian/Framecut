// Turns a project into a list of time-windowed layers. The WebGL preview and the FFmpeg export
// both consume this plan, so positioning, timing, transitions and animations are computed once.
import { substitute, EASE, evaluate, fmtNum } from './expr.mjs';
import { transitionDef, animDef, effectDef, fx } from './catalog.mjs';
import { clipEnd, srcOut, isVisual, transitionPartner, stickerMedia } from './model.mjs';
import { resolveCaption, captionMotion, wordOverlays } from './captions.mjs';

// Library stickers start at this fraction of the canvas height (longest side), before the clip's scale.
export const STICKER_BOX = 0.36;
import { needsProcessing, fxKey, keyGain, mergeKeys } from './audio.mjs';
import { keyExpr as transformKeyExpr, baseValue } from './keys.mjs';

const f = fmtNum;
function bake(expr, { T0, D, start }) {
  // easing helpers are defined in terms of p; expand them, then bind p and u to the clip timing.
  let s = substitute(expr, { e: EASE.inout, eo: EASE.out, ei: EASE.in, b: EASE.back });
  const map = {}; if (D !== undefined) map.p = `clip((t-${f(T0)})/${f(D)},0,1)`; if (start !== undefined) map.u = `(t-${f(start)})`;
  return substitute(s, map);
}

export const hasAudioFx = c => needsProcessing(c);
// Short stable key for the processed-audio cache.
export function audioFxKey(c) { const str = fxKey(c); let h1 = 0x811c9dc5, h2 = 0; for (let i = 0; i < str.length; i++) { h1 = Math.imul(h1 ^ str.charCodeAt(i), 16777619) >>> 0; h2 = (h2 * 31 + str.charCodeAt(i)) >>> 0; } return h1.toString(36) + h2.toString(36); }

export function buildPlan(project, { W, H, media = () => null, sizes = () => null, fps = project.settings.fps, captionPresets = [] } = {}) {
  const capTracks = new Set(project.tracks.filter(t => t.captions).map(t => t.id));
  const isCaption = c => c.kind === 'text' && (c.caption || capTracks.has(c.trackId));
  const layers = [], audio = [];
  const tracks = project.tracks;
  const visualTracks = tracks.filter(t => t.kind !== 'audio').slice().reverse(); // bottom → top
  const byTrack = id => project.clips.filter(c => c.trackId === id).sort((a, b) => a.start - b.start);
  const bg = project.settings.background || {};
  const motion = new Map(); // clipId -> {x:[], y:[], s:[], r:[], fades:[], steps:[]}
  const M = id => { if (!motion.has(id)) motion.set(id, { x: [], y: [], s: [], r: [], fades: [], steps: [], vs: null, ve: null, alpha: null }); return motion.get(id); };

  // Pass 1: timing windows, transitions and animations.
  for (const c of project.clips) {
    if (!isVisual(c)) continue;
    const m = M(c.id); m.vs = c.start; m.ve = clipEnd(c);
    const add = (def, timing, target = m) => {
      for (const k of ['x', 'y', 's', 'r']) if (def[k]) target[k].push(bake(def[k], timing));
    };
    if (c.animIn?.id && c.kind !== 'adjust') {
      const d = Math.min(c.animIn.duration || 0.5, c.duration), def = animDef('in', c.animIn.id);
      if (def) { add(def, { T0: c.start, D: d, start: c.start }); if (def.alpha === 'ramp') m.fades.push({ dir: 'in', st: c.start, d }); }
    }
    if (c.animOut?.id && c.kind !== 'adjust') {
      const d = Math.min(c.animOut.duration || 0.5, c.duration), def = animDef('out', c.animOut.id), T0 = clipEnd(c) - d;
      if (def) { add(def, { T0, D: d, start: c.start }); if (def.alpha === 'ramp') m.fades.push({ dir: 'out', st: T0, d }); }
    }
    if (c.animLoop?.id && c.kind !== 'adjust') { const def = animDef('loop', c.animLoop.id); if (def) add(def, { start: c.start }); }
    // Keyframes replace the static value: expressed as offsets/factors on top of the base transform.
    if (c.keyframes && c.kind !== 'adjust') {
      const K = p => (c.keyframes[p]?.length ? transformKeyExpr(c.keyframes[p], c.start) : null);
      const kx = K('x'), ky = K('y'), ks = K('scale'), kr = K('rotation'), ko = K('opacity');
      if (kx) m.x.push(`(${kx})-(${f(baseValue(c, 'x'))})`);
      if (ky) m.y.push(`(${ky})-(${f(baseValue(c, 'y'))})`);
      if (ks) m.s.push(`max(0.01,${ks})/${f(Math.max(0.01, baseValue(c, 'scale')))}`);
      if (kr) m.r.push(`(${kr})-(${f(baseValue(c, 'rotation'))})`);
      if (ko) m.alpha = `clip(${ko},0,1)`;
    }
    for (const e of c.effects || []) if (e.id === 'shake') { m.x.push(bake(fx.shakeX(e.amount ?? 0.5), { start: c.start })); m.y.push(bake(fx.shakeY(e.amount ?? 0.5), { start: c.start })); }
  }
  const dips = [];
  for (const c of project.clips) {
    if (!isVisual(c) || c.kind === 'adjust' || !c.transition?.id) continue;
    const def = transitionDef(c.transition.id), a = transitionPartner(project, c); if (!def || !a) continue;
    const d = Math.max(0.05, Math.min(c.transition.duration || 0.6, c.duration * 0.9, a.duration * 0.9));
    const T0 = c.start - d / 2, timing = { T0, D: d, start: c.start };
    const mb = M(c.id), ma = M(a.id);
    mb.vs = Math.min(mb.vs, T0); ma.ve = Math.max(ma.ve, c.start + d / 2);
    for (const k of ['x', 'y', 's', 'r']) { if (def.B?.[k]) mb[k].push(bake(def.B[k], timing)); if (def.A?.[k]) ma[k].push(bake(def.A[k], timing)); }
    if (def.B?.alpha === 'ramp') mb.fades.push({ dir: 'in', st: T0, d });
    if (def.B?.alpha === 'step') mb.steps.push({ at: c.start });
    if (def.dip) dips.push({ after: c.id, trackId: c.trackId, color: def.dip, st: T0, d });
  }

  // Pass 2: geometry and stacking. Text, stickers and vector images are drawn from rasters.
  // Library stickers (sticker.type 'media') are image / looping-video layers; SVG ones are rasterized.
  const isRaster = c => c.kind === 'text' || (c.kind === 'sticker' && !stickerMedia(c)) || ((c.kind === 'image' || stickerMedia(c)) && !!media(c.mediaId)?.svg);
  const geometry = c => {
    const t = c.transform || {};
    let nw, nh;
    if (isRaster(c)) { const s = sizes(c.id) || { w: W * 0.3, h: H * 0.1 }; nw = s.w; nh = s.h; if (stickerMedia(c)) { const k = STICKER_BOX * H / Math.max(1, nw, nh); nw *= k; nh *= k; } }
    else if (c.kind === 'adjust') { nw = W; nh = H; }
    else {
      const a = media(c.mediaId) || {}; const cr = c.crop || {};
      nw = Math.max(2, (a.width || W) * (1 - (cr.l || 0) - (cr.r || 0))); nh = Math.max(2, (a.height || H) * (1 - (cr.t || 0) - (cr.b || 0)));
      const k = stickerMedia(c) ? STICKER_BOX * H / Math.max(nw, nh) : c.fit === 'cover' ? Math.max(W / nw, H / nh) : Math.min(W / nw, H / nh); nw *= k; nh *= k;
    }
    const scale = c.kind === 'adjust' ? 1 : Math.max(0.01, t.scale ?? 1);
    return { baseW: nw * scale, baseH: nh * scale, cx: W / 2 + (t.x || 0) * W, cy: H / 2 + (t.y || 0) * H, rot0: t.rotation || 0, opacity: t.opacity ?? 1, flipH: !!t.flipH, flipV: !!t.flipV };
  };
  const exprOf = m => ({
    x: m.x.length ? `${f(W)}*(${m.x.join('+')})` : null,
    y: m.y.length ? `${f(H)}*(${m.y.join('+')})` : null,
    s: m.s.length ? m.s.map(s => `(${s})`).join('*') : null,
    r: m.r.length ? m.r.join('+') : null,
  });
  // Captions (shared caption engine): a stable base image per group plus per-word overlays that follow
  // the base motion. Rasters are looked up by layer id: <clip> for the base, <clip>:<role><word> for words.
  const captionLayers = (c, track) => {
    const eff = resolveCaption(project, c, { presets: captionPresets }), st = eff.style, tr = c.transform || {};
    const info = sizes(c.id, { clip: c, eff, role: 'base' }) || { w: W * 0.4, h: H * 0.08, boxes: [] };
    const k0 = Math.max(0.01, tr.scale ?? 1), start = c.start, end = clipEnd(c);
    const cx = W / 2 + ((st.x || 0) + (tr.x || 0)) * W, cy = H / 2 + ((st.y || 0) + (tr.y || 0)) * H;
    const mo = captionMotion(eff.anim, start, end, { W, H });
    const sExpr = mo.s.length ? mo.s.map(s => `(${s})`).join('*') : null;
    const motion = { x: mo.x.length ? `${f(W)}*(${mo.x.join('+')})` : null, y: mo.y.length ? `${f(H)}*(${mo.y.join('+')})` : null, s: sExpr, r: null };
    const common = { clip: c, trackId: track.id, rot0: tr.rotation || 0, opacity: tr.opacity ?? 1, flipH: false, flipV: false, steps: [], cap: { eff } };
    const out = [];
    const baseL = { ...common, id: c.id, type: 'raster', vs: start, ve: end, baseW: info.w * k0, baseH: info.h * k0, cx, cy, motion, fades: mo.fades, cap: { eff, role: 'base' } };
    if (mo.blur) baseL.blurExpr = mo.blur;
    if (!mo.hidden) out.push(baseL);
    const abs = (c.words || []).map(w => ({ ...w, start: start + w.start, end: start + w.end }));
    if (abs.length && abs.length === (info.words ?? abs.length)) for (const ov of wordOverlays(eff.anim, abs, start, end)) {
      const b = info.boxes?.[ov.i]; if (!b) continue;
      const id = `${c.id}:${ov.role}${ov.i}`, ws = sizes(id, { clip: c, eff, role: ov.role, word: ov.i }) || { w: b.w, h: b.h };
      const bx = b.x * k0, by = b.y * k0;
      // Follow the base: offset scales with the base, plus the word's own motion.
      const xs = [motion.x, sExpr && bx ? `${f(bx)}*((${sExpr})-1)` : null].filter(Boolean), ys = [motion.y, sExpr && by ? `${f(by)}*((${sExpr})-1)` : null, ov.y ? `${f(H)}*(${ov.y})` : null].filter(Boolean);
      // Never let a popping word overlap its neighbours: cap its growth to the gap around it.
      let os = ov.s; const peak = Math.max(1, eff.anim.emph?.peak ?? 1);
      if (os && peak > 1 && b.gapL !== undefined && !eff.anim.emph?.allowOverlap) { const smax = 1 + 1.35 * Math.min(b.gapL, b.gapR) / Math.max(1, b.w); if (smax < peak) os = `1+((${os})-1)*${f(Math.max(0, (smax - 1) / (peak - 1)))}`; }
      const ss = [sExpr, os].filter(Boolean);
      const fades = mo.fades.filter(fd => fd.dir === 'out' || ov.role !== 'reveal').concat(ov.fade ? [{ dir: 'in', st: ov.from, d: ov.fade }] : []);
      out.push({ ...common, id, type: 'raster', vs: ov.from, ve: ov.to, baseW: ws.w * k0, baseH: ws.h * k0, cx: cx + bx, cy: cy + by, motion: { x: xs.length ? xs.join('+') : null, y: ys.length ? ys.join('+') : null, s: ss.length ? ss.map(s => `(${s})`).join('*') : null, r: null }, fades, blurExpr: ov.role === 'reveal' ? null : baseL.blurExpr, cap: { eff, role: ov.role, word: ov.i } });
    }
    return out;
  };
  const mediaLayer = (c, track) => {
    const m = M(c.id), a = media(c.mediaId) || {};
    const L = { id: c.id, type: isRaster(c) ? 'raster' : c.kind === 'adjust' ? 'adjust' : 'media', clip: c, trackId: track.id, vs: m.vs, ve: m.ve, ...geometry(c), motion: exprOf(m), fades: m.fades, steps: m.steps };
    if (m.alpha) { L.alphaExpr = m.alpha; L.opacity = 1; }
    if (L.type === 'media') { L.mediaId = c.mediaId; L.image = c.kind === 'image' || a.kind === 'image'; L.srcDuration = a.duration || 0; if (stickerMedia(c) && !L.image) L.loop = c.loop !== false; }
    if (c.kind === 'text' && c.style?.highlight && c.words?.length) L.variants = c.words.map((w, i) => ({ key: 'w' + i, from: c.start + w.start, to: i + 1 < c.words.length ? c.start + c.words[i + 1].start : clipEnd(c) }));
    return L;
  };
  for (const track of visualTracks) {
    if (track.hidden) continue;
    const clips = byTrack(track.id);
    if (track.main && bg.type === 'blur') for (const c of clips) if (c.kind === 'video' || c.kind === 'image') {
      const m = M(c.id), a = media(c.mediaId) || {};
      layers.push({ id: c.id + ':bg', type: 'bgblur', clip: c, trackId: track.id, vs: m.vs, ve: m.ve, mediaId: c.mediaId, image: c.kind === 'image', srcDuration: a.duration || 0, blur: fx.blurSigma(Math.min(1, (bg.blur || 24) / 60), H) * 1.6, fades: [], steps: [], motion: { x: null, y: null, s: null, r: null } });
    }
    for (const c of clips) {
      if (isCaption(c)) { layers.push(...captionLayers(c, track)); continue; }
      layers.push(mediaLayer(c, track));
      for (const d of dips) if (d.after === c.id) layers.push({ id: c.id + ':dip', type: 'dip', clip: c, trackId: track.id, vs: d.st, ve: d.st + d.d, color: d.color, fades: [{ dir: 'in', st: d.st, d: d.d / 2 }, { dir: 'out', st: d.st + d.d / 2, d: d.d / 2 }], steps: [], motion: { x: null, y: null, s: null, r: null } });
    }
  }

  // Audio
  for (const c of project.clips) {
    const track = tracks.find(t => t.id === c.trackId); if (!track || track.muted || c.muted) continue;
    if (!(c.kind === 'video' || c.kind === 'audio') || !(c.volume > 0)) continue;
    const a = media(c.mediaId); if (a && !a.audio) continue;
    audio.push({ id: c.id, clip: c, mediaId: c.mediaId, processed: hasAudioFx(c) ? audioFxKey(c) : null, keys: mergeKeys(c.volumeKeys, c.duckKeys), srcIn: c.in, srcOut: srcOut(c), start: c.start, duration: c.duration, speed: c.speed || 1, volume: c.volume, fadeIn: Math.min(c.fadeIn || 0, c.duration / 2), fadeOut: Math.min(c.fadeOut || 0, c.duration / 2) });
  }
  const duration = Math.max(0, ...project.clips.map(clipEnd));
  return { W, H, fps, duration, layers, audio };
}

// ----- Evaluation helpers used by the preview -----
export function layerState(L, t) {
  const vars = { t };
  let alpha = L.alphaExpr ? Math.min(1, Math.max(0, evaluate(L.alphaExpr, vars))) : L.opacity ?? 1;
  for (const fd of L.fades) {
    const k = fd.d > 0 ? Math.min(1, Math.max(0, (t - fd.st) / fd.d)) : 1;
    alpha *= fd.dir === 'in' ? k : 1 - k;
  }
  for (const s of L.steps) if (t < s.at) alpha = 0;
  return {
    alpha,
    dx: L.motion.x ? evaluate(L.motion.x, vars) : 0,
    dy: L.motion.y ? evaluate(L.motion.y, vars) : 0,
    s: L.motion.s ? Math.max(0.001, evaluate(L.motion.s, vars)) : 1,
    r: (L.rot0 || 0) + (L.motion.r ? evaluate(L.motion.r, vars) : 0),
  };
}
export const activeLayers = (plan, t) => plan.layers.filter(L => t >= L.vs - 1e-6 && t < L.ve - 1e-6);
// Source time for a media layer at timeline time t (frozen at the source's edges for transition handles).
export function sourceTime(L, t) {
  const c = L.clip; if (L.image) return 0;
  const raw = (c.in || 0) + (t - c.start) * (c.speed || 1);
  if (L.loop && L.srcDuration > 0) { const d = L.srcDuration; return ((raw % d) + d) % d; }
  return Math.min(Math.max(0, raw), Math.max(0, (L.srcDuration || Infinity) - 0.04));
}
export function audioGain(A, t) {
  const local = t - A.start, rem = A.duration - local, edge = 0.012;
  let g = A.volume * keyGain(A.keys, local);
  g *= Math.min(1, local / Math.max(edge, A.fadeIn || 0), rem / Math.max(edge, A.fadeOut || 0));
  return Math.max(0, g);
}
export { effectDef };
