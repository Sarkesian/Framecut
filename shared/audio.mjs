// Audio processing model: the ten essential tools, one-click profiles, volume automation and ducking.
// The chain is rendered by FFmpeg into a cached file that both preview and export play, so they match.

export const AUDIO_DEFAULTS = {
  bypass: false, profile: 'original',
  gain: 0,                                                    // 1 · dB
  level: { on: false, mode: 'loudness', target: -16 },        // 1 · loudness normalise (2-pass) or gentle auto-level
  highpass: { on: false, freq: 80 },                          // 2
  gate: { on: false, threshold: -50, ratio: 2.5, release: 250 }, // 3 · expander (ratio) — never hard-chops speech
  compressor: { on: false, threshold: -20, ratio: 3, attack: 12, release: 160, makeup: 2 }, // 4
  limiter: { on: true, ceiling: -1 },                         // 5 · peak protection
  eq: { on: false, bass: 0, mid: 0, treble: 0, bassFreq: 120, midFreq: 1500, trebleFreq: 6500 }, // 6
  denoise: { on: false, amount: 0.4 },                        // 7
  deesser: { on: false, amount: 0.4 },                        // 8
  creative: { pitch: 0, echo: 0, reverb: 0 },                 // optional extras
};
// 9 (fades & volume automation) lives on the clip: fadeIn, fadeOut, volumeKeys. 10 (ducking) is project-level.

export const AUDIO_PROFILES = [
  { id: 'original', name: 'Natural / Original', hint: 'Untouched except peak protection', fx: {} },
  { id: 'clean', name: 'Clean Voice', hint: 'Balanced speech with light cleanup', fx: { highpass: { on: true, freq: 80 }, denoise: { on: true, amount: 0.3 }, gate: { on: true, threshold: -52, ratio: 2 }, compressor: { on: true, threshold: -20, ratio: 2.5, makeup: 2 }, eq: { on: true, bass: -1, mid: 1, treble: 2 }, level: { on: true, mode: 'loudness', target: -16 } } },
  { id: 'narration', name: 'Professional Narration', hint: 'Consistent, polished voiceover', fx: { highpass: { on: true, freq: 90 }, denoise: { on: true, amount: 0.35 }, gate: { on: true, threshold: -48, ratio: 3 }, deesser: { on: true, amount: 0.45 }, compressor: { on: true, threshold: -22, ratio: 3.5, attack: 8, release: 140, makeup: 3 }, eq: { on: true, bass: 1.5, mid: -1, treble: 2.5 }, level: { on: true, mode: 'loudness', target: -16 } } },
  { id: 'podcast', name: 'Podcast / Commentary', hint: 'Clear, natural spoken audio', fx: { highpass: { on: true, freq: 75 }, denoise: { on: true, amount: 0.25 }, compressor: { on: true, threshold: -18, ratio: 2.5, makeup: 2 }, deesser: { on: true, amount: 0.3 }, eq: { on: true, bass: 0, mid: 1.5, treble: 1 }, level: { on: true, mode: 'loudness', target: -16 } } },
  { id: 'noisy', name: 'Noisy Recording', hint: 'Stronger background cleanup', fx: { highpass: { on: true, freq: 110 }, denoise: { on: true, amount: 0.75 }, gate: { on: true, threshold: -42, ratio: 4 }, compressor: { on: true, threshold: -20, ratio: 3, makeup: 2 }, eq: { on: true, bass: -2, mid: 2, treble: 1 }, level: { on: true, mode: 'loudness', target: -16 } } },
];

const merge = (a, b) => { const o = structuredClone(a); for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(o[k] || {}), ...v } : v; return o; };
export const audioFx = c => merge(AUDIO_DEFAULTS, migrateFx(c?.audioFx));
export function profileFx(id, custom = []) { const p = [...AUDIO_PROFILES, ...custom].find(x => x.id === id); return merge(AUDIO_DEFAULTS, { ...(p?.fx || {}), profile: id }); }
// Old (v1 overhaul draft) flat fields → new structure.
function migrateFx(fx = {}) {
  if (!fx || fx.highpass || fx.limiter) return fx || {};
  const out = { creative: { pitch: fx.pitch || 0, echo: fx.echo || 0, reverb: fx.reverb || 0 } };
  if (fx.denoise) out.denoise = { on: true, amount: fx.denoise };
  if (fx.normalize) out.level = { on: true, mode: 'loudness', target: -16 };
  if (fx.eq && fx.eq !== 'none') out.eq = { on: true, ...({ voice: { bass: -2, mid: 1, treble: 3 }, bass: { bass: 6 }, treble: { treble: 5 }, warm: { bass: 3, treble: -2 } }[fx.eq] || {}) };
  return out;
}
const isDefault = fx => !fx.bypass && !fx.gain && !fx.level.on && !fx.highpass.on && !fx.gate.on && !fx.compressor.on && !fx.eq.on && !fx.denoise.on && !fx.deesser.on && !fx.creative.pitch && !fx.creative.echo && !fx.creative.reverb && fx.limiter.on && fx.limiter.ceiling >= -1.01;
// Does this clip need a processed render? (Plain clips play the source directly.)
export const needsProcessing = c => { const fx = audioFx(c); return !fx.bypass && !isDefault(fx); };
export function fxKey(c) { const fx = audioFx(c); const { profile, bypass, ...rest } = fx; return JSON.stringify(rest); }

const f = n => String(+(+n).toFixed(4));
const dbToLin = db => Math.pow(10, db / 20);
// FFmpeg filter chain (without loudness normalisation, which is a second pass using `levelGain`).
export function audioChain(fx, { levelGain = null } = {}) {
  const p = [];
  if (fx.highpass.on) p.push(`highpass=f=${f(fx.highpass.freq)}:poles=2`);
  if (fx.denoise.on && fx.denoise.amount > 0) p.push(`afftdn=nr=${f(6 + fx.denoise.amount * 30)}:nf=${f(-50 + fx.denoise.amount * 12)}:tn=1`);
  if (fx.gate.on) p.push(`agate=threshold=${f(dbToLin(fx.gate.threshold))}:ratio=${f(fx.gate.ratio)}:attack=5:release=${f(fx.gate.release)}:range=${f(dbToLin(-24))}:knee=4`);
  if (fx.deesser.on && fx.deesser.amount > 0) p.push(`deesser=i=${f(0.2 + fx.deesser.amount * 0.7)}:m=0.5:f=0.5:s=o`);
  if (fx.eq.on) {
    if (fx.eq.bass) p.push(`bass=g=${f(fx.eq.bass)}:f=${f(fx.eq.bassFreq)}`);
    if (fx.eq.mid) p.push(`equalizer=f=${f(fx.eq.midFreq)}:t=q:w=0.9:g=${f(fx.eq.mid)}`);
    if (fx.eq.treble) p.push(`treble=g=${f(fx.eq.treble)}:f=${f(fx.eq.trebleFreq)}`);
  }
  const cr = fx.creative || {};
  if (cr.pitch) p.push(`rubberband=pitch=${f(Math.pow(2, cr.pitch / 12))}`);
  if (cr.echo > 0) p.push(`aecho=0.8:0.8:${Math.round(180 + cr.echo * 520)}:${f(0.2 + cr.echo * 0.4)}`);
  if (cr.reverb > 0) { const r = cr.reverb; p.push(`aecho=0.8:0.85:41|67|97|131:${f(0.32 * r)}|${f(0.25 * r)}|${f(0.18 * r)}|${f(0.12 * r)}`); }
  if (fx.compressor.on) { const c = fx.compressor; p.push(`acompressor=threshold=${f(dbToLin(c.threshold))}:ratio=${f(c.ratio)}:attack=${f(c.attack)}:release=${f(c.release)}:makeup=${f(dbToLin(c.makeup))}:knee=3`); }
  if (fx.level.on && fx.level.mode === 'auto') p.push('dynaudnorm=f=400:g=15:p=0.9:m=8');
  const g = (fx.gain || 0) + (levelGain ?? 0);
  if (g) p.push(`volume=${f(g)}dB`);
  if (fx.limiter.on) p.push(`alimiter=limit=${f(dbToLin(fx.limiter.ceiling))}:level=false:attack=3:release=50`);
  return p.join(',') || 'anull';
}

// ----- Volume automation (keyframes) -----
// keys: [{t (seconds from clip start), v (gain multiplier)}], linear between points, held at the ends.
export function keyGain(keys, t) {
  if (!keys?.length) return 1;
  const k = keys; if (t <= k[0].t) return k[0].v; if (t >= k.at(-1).t) return k.at(-1).v;
  for (let i = 1; i < k.length; i++) if (t <= k[i].t) { const a = k[i - 1], b = k[i]; const u = (t - a.t) / Math.max(1e-6, b.t - a.t); return a.v + (b.v - a.v) * u; }
  return 1;
}
// FFmpeg expression in t (clip-local) equivalent to keyGain. Long key lists are thinned to stay compact.
export function keyExpr(keys) {
  if (!keys?.length) return '1';
  let k = keys; if (k.length > 400) { const step = Math.ceil(k.length / 400); k = k.filter((_, i) => i % step === 0 || i === keys.length - 1); }
  let e = f(k.at(-1).v);
  for (let i = k.length - 1; i >= 1; i--) { const a = k[i - 1], b = k[i]; const lerp = `${f(a.v)}+(${f(b.v - a.v)})*(t-${f(a.t)})/${f(Math.max(1e-6, b.t - a.t))}`; e = `if(lt(t,${f(b.t)}),${lerp},${e})`; }
  return `if(lt(t,${f(k[0].t)}),${f(k[0].v)},${e})`;
}
export function mergeKeys(a, b) { // product of two envelopes, sampled at both key sets' times
  if (!a?.length) return b || null; if (!b?.length) return a;
  const ts = [...new Set([...a.map(k => k.t), ...b.map(k => k.t)])].sort((x, y) => x - y);
  return ts.map(t => ({ t, v: keyGain(a, t) * keyGain(b, t) }));
}
// Ducking envelope for a background clip from speech intervals (timeline seconds).
export function duckKeys(clip, speech, { amount = -12, attack = 0.25, release = 0.6 } = {}) {
  const lo = dbToLin(amount), s = clip.start, e = clip.start + clip.duration;
  const spans = speech.filter(x => x.end > s - release && x.start < e + attack).map(x => ({ a: x.start, b: x.end }));
  // merge gaps shorter than release+attack so the music doesn't pump between words
  const merged = [];
  for (const x of spans) { const last = merged.at(-1); if (last && x.a - last.b < attack + release) last.b = Math.max(last.b, x.b); else merged.push({ ...x }); }
  if (!merged.length) return null;
  const keys = [{ t: 0, v: 1 }];
  for (const m of merged) {
    const pts = [[m.a - attack, 1], [m.a, lo], [m.b, lo], [m.b + release, 1]];
    for (const [t, v] of pts) { const lt = t - s; if (lt < 0 || lt > clip.duration) { if (lt < 0 && v < 1) keys[0] = { t: 0, v: Math.min(keys[0].v, lo) }; continue; } if (lt <= keys.at(-1).t + 1e-4) keys[keys.length - 1] = { t: keys.at(-1).t, v: Math.min(keys.at(-1).v, v) }; else keys.push({ t: lt, v }); }
  }
  if (keys.at(-1).t < clip.duration) keys.push({ t: clip.duration, v: keys.at(-1).v });
  return keys;
}
