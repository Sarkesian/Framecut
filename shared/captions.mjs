// FrameCut caption engine: one style + animation model shared by every caption preset, the live
// preview and the FFmpeg export. Nothing here depends on a particular speech-recognition engine.
//
// Inheritance: engine defaults → preset → project overrides → track overrides → caption → word.
// Animation is described as FFmpeg-compatible expressions of t (timeline seconds), evaluated by the
// preview (shared/expr.mjs) and passed verbatim to FFmpeg, so both render the same motion.
import { fmtNum as f } from './expr.mjs';

// ---------------------------------------------------------------- defaults
export const CAPTION_BASE = {
  style: {
    font: 'Inter', weight: 700, italic: false, size: 0.058, uppercase: false, letterSpacing: 0, wordSpacing: 0, lineHeight: 1.12,
    color: '#ffffff', inactiveOpacity: 1, strokeColor: '#0b0b0f', strokeWidth: 0.1, shadowColor: '#000000', shadowOpacity: 0.55, shadowBlur: 0.35, shadowY: 0.06,
    bgColor: '#000000', bgOpacity: 0, bgRadius: 0.3, bgPadX: 0.4, bgPadY: 0.18, align: 'center',
    activeColor: '#ffe14d', activeBg: '#ff3b6b', activeBgOpacity: 0, activeStrokeColor: null, underline: false, underlineColor: null,
    x: 0, y: 0.34,
  },
  layout: { grouping: 'auto', maxLines: 2, maxWords: 0, maxChars: 0, minDuration: 0.6, gapHold: 0.35 },
  anim: {
    in: { type: 'fade', dur: 0.16, delay: 0, strength: 0.5, ease: 'out', dir: 'up' },
    emph: { type: 'none', dur: 0.12, strength: 0.5, from: 1, peak: 1.18, settle: 1, bounce: 0.45, persist: false, minHold: 0.12, allowOverlap: false },
    out: { type: 'fade', dur: 0.12, strength: 0.5, ease: 'in', dir: 'down' },
  },
};

// Animation catalogue and which parameters matter for each (the UI only shows these).
export const ENTRANCES = [
  { id: 'none', name: 'None', params: [] },
  { id: 'fade', name: 'Fade', params: ['dur', 'delay'] },
  { id: 'pop', name: 'Pop', params: ['dur', 'delay', 'strength', 'bounce'] },
  { id: 'scale', name: 'Scale', params: ['dur', 'delay', 'strength', 'ease'] },
  { id: 'slide', name: 'Slide', params: ['dur', 'delay', 'strength', 'ease', 'dir'] },
  { id: 'bounce', name: 'Bounce', params: ['dur', 'delay', 'strength', 'dir'] },
  { id: 'blur', name: 'Blur reveal', params: ['dur', 'delay', 'strength'] },
  { id: 'type', name: 'Type on', params: ['dur'] },
];
export const EMPHASES = [
  { id: 'none', name: 'None', params: [] },
  { id: 'highlight', name: 'Word highlight', params: ['activeColor', 'persist'] },
  { id: 'pop', name: 'Word pop', params: ['from', 'peak', 'settle', 'dur', 'bounce', 'overlap', 'activeColor'] },
  { id: 'pulse', name: 'Scale pulse', params: ['peak', 'dur', 'bounce', 'overlap'] },
  { id: 'color', name: 'Color change', params: ['activeColor', 'persist'] },
  { id: 'bounce', name: 'Bounce', params: ['strength', 'bounce', 'activeColor'] },
  { id: 'underline', name: 'Underline', params: ['activeColor', 'persist'] },
  { id: 'background', name: 'Background highlight', params: ['activeBg', 'activeBgOpacity', 'activeColor', 'peak', 'overlap'] },
  { id: 'lift', name: 'Subtle lift', params: ['strength'] },
];
export const EXITS = [
  { id: 'none', name: 'None', params: [] },
  { id: 'fade', name: 'Fade', params: ['dur'] },
  { id: 'scale', name: 'Scale down', params: ['dur', 'strength'] },
  { id: 'slide', name: 'Slide', params: ['dur', 'strength', 'dir'] },
  { id: 'shrink', name: 'Shrink', params: ['dur'] },
];
export const EASES = { linear: 'p', out: '1-pow(1-p,3)', in: 'p*p*p', inout: 'if(lt(p,0.5),4*p*p*p,1-pow(-2*p+2,3)/2)', back: '1+2.70158*pow(p-1,3)+1.70158*pow(p-1,2)' };
// Word-pop intensities (Balanced is the default).
export const POP_INTENSITY = {
  subtle: { from: 1, peak: 1.1, settle: 1, dur: 0.12, bounce: 0.25 },
  balanced: { from: 0.92, peak: 1.2, settle: 1.04, dur: 0.1, bounce: 0.45 },
  energetic: { from: 0.8, peak: 1.34, settle: 1.08, dur: 0.08, bounce: 0.7 },
};

// ---------------------------------------------------------------- curated presets
const P = (id, name, hint, style, anim = {}, layout = {}) => ({ id, name, hint, style, anim, layout });
export const CAPTION_PRESETS_V2 = [
  P('clean', 'Clean Modern', 'Readable subtitles for any video',
    { font: 'Inter', weight: 600, size: 0.05, strokeWidth: 0.07, shadowOpacity: 0.6, y: 0.37 },
    { in: { type: 'fade', dur: 0.14 }, emph: { type: 'none' }, out: { type: 'fade', dur: 0.12 } }, { grouping: 'sentence', maxLines: 2 }),
  P('bold', 'Bold Social', 'Big, punchy short-form captions',
    { font: 'Montserrat', weight: 900, size: 0.072, uppercase: true, strokeWidth: 0.15, shadowOpacity: 0.5, activeColor: '#ffe14d', y: 0.24 },
    { in: { type: 'pop', dur: 0.2, strength: 0.4, bounce: 0.35 }, emph: { type: 'highlight' }, out: { type: 'none' } }, { grouping: 'phrase', maxLines: 2, maxWords: 4 }),
  P('word-pop', 'Word Pop', 'Each word pops as it is spoken',
    { font: 'Montserrat', weight: 900, size: 0.078, uppercase: true, strokeWidth: 0.16, shadowOpacity: 0.55, activeColor: '#b6f36a', y: 0.22 },
    { in: { type: 'none' }, emph: { type: 'pop', ...POP_INTENSITY.balanced }, out: { type: 'none' } }, { grouping: 'phrase', maxLines: 1, maxWords: 3 }),
  P('karaoke', 'Karaoke Highlight', 'Words light up as they are sung or said',
    { font: 'Poppins', weight: 700, size: 0.06, inactiveOpacity: 0.55, strokeWidth: 0.1, activeColor: '#ffd23f', y: 0.3 },
    { in: { type: 'fade', dur: 0.12 }, emph: { type: 'color', persist: true }, out: { type: 'fade', dur: 0.12 } }, { grouping: 'sentence', maxLines: 2 }),
  P('soft-bounce', 'Soft Bounce', 'Gentle, friendly motion',
    { font: 'Poppins', weight: 600, size: 0.058, strokeWidth: 0.08, shadowOpacity: 0.45, activeColor: '#ffffff', y: 0.3 },
    { in: { type: 'slide', dur: 0.24, strength: 0.4, dir: 'up' }, emph: { type: 'bounce', strength: 0.35, bounce: 0.4 }, out: { type: 'fade', dur: 0.15 } }, { grouping: 'phrase', maxLines: 2, maxWords: 5 }),
  P('gaming', 'Gaming Commentary', 'Clear over busy gameplay',
    { font: 'Anton', weight: 400, size: 0.074, uppercase: true, letterSpacing: 0.02, strokeWidth: 0.16, shadowOpacity: 0.7, activeColor: '#111111', activeBg: '#ffd400', activeBgOpacity: 1, y: -0.32 },
    { in: { type: 'pop', dur: 0.16, strength: 0.45, bounce: 0.3 }, emph: { type: 'background', peak: 1.06 }, out: { type: 'none' } }, { grouping: 'phrase', maxLines: 1, maxWords: 4 }),
  P('cinematic', 'Cinematic Minimal', 'Restrained, elegant subtitles',
    { font: 'Playfair Display', weight: 500, italic: true, size: 0.044, letterSpacing: 0.02, color: '#f4ecd8', strokeWidth: 0, shadowOpacity: 0.75, shadowBlur: 0.5, y: 0.38 },
    { in: { type: 'fade', dur: 0.35 }, emph: { type: 'none' }, out: { type: 'fade', dur: 0.3 } }, { grouping: 'sentence', maxLines: 2 }),
  P('energy', 'High Energy', 'Expressive, but never cluttered',
    { font: 'Montserrat', weight: 900, size: 0.08, uppercase: true, strokeWidth: 0.16, activeColor: '#ffffff', activeBg: '#ff3b6b', activeBgOpacity: 1, y: 0.2 },
    { in: { type: 'scale', dur: 0.18, strength: 0.6, ease: 'back' }, emph: { type: 'background', ...POP_INTENSITY.energetic }, out: { type: 'shrink', dur: 0.12 } }, { grouping: 'phrase', maxLines: 1, maxWords: 3 }),
];
export const presetDef = id => CAPTION_PRESETS_V2.find(p => p.id === id) || CAPTION_PRESETS_V2[0];
export const DEFAULT_CAPTION_PRESET = 'word-pop';

// ---------------------------------------------------------------- inheritance
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
export function merge(...layers) {
  const out = {};
  for (const l of layers) if (isObj(l)) for (const [k, v] of Object.entries(l)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : isObj(v) ? merge(v) : v;
  return out;
}
const pick = (o, ks) => (o ? Object.fromEntries(ks.filter(k => o[k] !== undefined).map(k => [k, o[k]])) : {});
// Effective {style, layout, anim} for a caption clip (or for the project / a track when clip is omitted).
export function resolveCaption(project, clip = null, { trackId, presets = [] } = {}) {
  const cap = project.captions || {};
  const preset = [...presets, ...CAPTION_PRESETS_V2].find(p => p.id === cap.preset) || presetDef(DEFAULT_CAPTION_PRESET);
  const track = project.tracks?.find(t => t.id === (clip?.trackId ?? trackId));
  return merge(CAPTION_BASE, pick(preset, ['style', 'layout', 'anim']), cap.overrides, track?.captionStyle, clip?.capStyle);
}
// Which level defines a value: 'word' | 'caption' | 'track' | 'project' | 'preset'.
export function sourceOf(project, clip, section, key, wordIndex = null) {
  if (wordIndex !== null && clip?.words?.[wordIndex]?.style?.[key] !== undefined) return 'word';
  if (clip?.capStyle?.[section]?.[key] !== undefined) return 'caption';
  const track = project.tracks?.find(t => t.id === clip?.trackId);
  if (track?.captionStyle?.[section]?.[key] !== undefined) return 'track';
  if (project.captions?.overrides?.[section]?.[key] !== undefined) return 'project';
  return 'preset';
}

// ---------------------------------------------------------------- grouping
const sentenceEnd = w => /[.!?…]["')\]]?$/.test(w);
const clauseEnd = w => /[,;:—–-]["')\]]?$/.test(w);
// Limits for 'auto' grouping, from the aspect ratio and the style's text size.
export function groupLimits(layout, { aspect = 16 / 9, size = 0.058 } = {}) {
  // Characters that fit on one line: ~90% of the frame width at ~0.6 em per character, capped for readability.
  const lineChars = Math.max(8, Math.min(42, Math.floor(0.9 * aspect / (0.6 * size))));
  const mode = layout.grouping || 'auto';
  const maxLines = mode === 'word' ? 1 : layout.maxLines || 2;
  const maxWords = mode === 'word' ? 1 : layout.maxWords || (mode === 'phrase' ? 4 : mode === 'sentence' ? 16 : aspect < 1 ? 5 : 10);
  return { maxChars: layout.maxChars || lineChars * maxLines, lineChars: layout.maxChars ? Math.ceil(layout.maxChars / maxLines) : lineChars, maxLines, maxWords, maxDur: mode === 'sentence' ? 6 : mode === 'phrase' ? 2.4 : 3.6, pause: mode === 'sentence' ? 0.8 : mode === 'phrase' || mode === 'word' ? 0.4 : 0.5 };
}
// Words (absolute times) → caption groups: split on pauses, sentence ends, length and reading time;
// never leave a lone word dangling; keep each group on screen long enough to read.
export function groupWords(words, layout = CAPTION_BASE.layout, opts = {}) {
  const lim = groupLimits(layout, opts); const out = []; let g = [];
  const chars = ws => ws.reduce((n, w) => n + w.text.length + 1, -1);
  const flush = () => { if (g.length) out.push(g); g = []; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i], prev = g.at(-1);
    if (prev && (w.start - prev.end > lim.pause || chars([...g, w]) > lim.maxChars || g.length >= lim.maxWords || w.end - g[0].start > lim.maxDur)) flush();
    g.push(w);
    const next = words[i + 1];
    if (sentenceEnd(w.text) && (layout.grouping !== 'phrase' || g.length > 1)) flush();
    else if (clauseEnd(w.text) && g.length >= Math.max(2, lim.maxWords * 0.6) && next) flush();
  }
  flush();
  // Avoid one-word stragglers: hand a lone trailing word back to its neighbour when it fits.
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    if (b.length === 1 && lim.maxWords > 1 && b[0].start - a.at(-1).end < lim.pause && chars([...a, ...b]) <= lim.maxChars + 4 && a.length < lim.maxWords + 1 && !sentenceEnd(a.at(-1).text)) { a.push(...b); out.splice(i--, 1); }
  }
  return out.map((ws, i) => {
    const next = out[i + 1]?.[0]?.start ?? Infinity;
    const start = ws[0].start, rawEnd = ws.at(-1).end;
    // Readability: stay up at least minDuration and bridge short gaps, but never overlap the next group.
    const end = Math.min(next - 0.02, Math.max(rawEnd + (next - rawEnd < (layout.gapHold ?? 0.35) * 2 ? next - rawEnd : layout.gapHold ?? 0.35), start + (layout.minDuration ?? 0.6)));
    return { start, end: Math.max(end, rawEnd), words: ws, text: breakLines(ws.map(w => w.text), lim) };
  });
}
// Balanced line breaks: the split that makes lines most even without exceeding the line length.
export function breakLines(tokens, { lineChars = 30, maxLines = 2 } = {}) {
  const full = tokens.join(' ');
  if (maxLines < 2 || full.length <= lineChars || tokens.length < 2) return full;
  let best = null;
  for (let k = 1; k < tokens.length; k++) {
    const a = tokens.slice(0, k).join(' '), b = tokens.slice(k).join(' ');
    const over = Math.max(0, a.length - lineChars) + Math.max(0, b.length - lineChars);
    const score = over * 10 + Math.abs(a.length - b.length) + (a.length < b.length ? 0.5 : 0) + (k === 1 || k === tokens.length - 1 ? 6 : 0);
    if (!best || score < best.score) best = { score, text: a + '\n' + b };
  }
  return best.text;
}

// ---------------------------------------------------------------- animation → expressions
const ease = (name, pVar) => (EASES[name] || EASES.out).replace(/\bp\b/g, pVar);
const prog = (t0, d) => `clip((t-${f(t0)})/${f(Math.max(0.001, d))},0,1)`;
// Spring settle from 0 to 1 (overshoot grows with bounce).
const spring = (pv, bounce) => `(1-exp(-${f(5 + 5 * (1 - bounce))}*${pv})*cos(${f(Math.PI * (1.2 + 2.2 * bounce))}*${pv}))`;
const dirVec = d => ({ up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[d] || [0, 1]);

// Base caption motion. Returns {x, y, s, blur} expression lists (x/y as fractions of W/H), fades, hidden.
export function captionMotion(anim, start, end, { W = 1920, H = 1080 } = {}) {
  const m = { x: [], y: [], s: [], blur: null, fades: [], hidden: false };
  const a = anim.in || {}, o = anim.out || {}, len = end - start;
  if (a.type && a.type !== 'none') {
    const d = Math.min(a.dur ?? 0.16, len * 0.6), t0 = start + (a.delay || 0), p = prog(t0, d), k = a.strength ?? 0.5;
    if (a.type === 'type') m.hidden = true;
    else m.fades.push({ dir: 'in', st: t0, d: a.type === 'fade' || a.type === 'blur' ? d : d * 0.55 });
    if (a.type === 'pop') m.s.push(`max(0.02,${f(1 - 0.55 * k)}+${f(0.55 * k)}*${spring(p, a.bounce ?? 0.4)})`);
    if (a.type === 'scale') m.s.push(`max(0.02,${f(1 - 0.45 * k)}+${f(0.45 * k)}*(${ease(a.ease || 'out', p)}))`);
    if (a.type === 'slide' || a.type === 'bounce') {
      const [dx, dy] = dirVec(a.dir), dist = 0.07 * k, e = a.type === 'bounce' ? ease('back', p) : ease(a.ease || 'out', p);
      if (dx) m.x.push(`${f(dx * dist * H / W)}*(1-(${e}))`); if (dy) m.y.push(`${f(dy * dist)}*(1-(${e}))`);
    }
    if (a.type === 'blur') m.blur = `if(lt(t,${f(t0 + d)}),${f(14 * (0.3 + k))}*(1-(${ease('out', p)})),0)`;
  }
  if (o.type && o.type !== 'none') {
    const d = Math.min(o.dur ?? 0.12, len * 0.4), t0 = end - d, p = prog(t0, d), k = o.strength ?? 0.5;
    m.fades.push({ dir: 'out', st: t0, d });
    if (o.type === 'scale') m.s.push(`max(0.02,1-${f(0.35 * k)}*(${ease('in', p)}))`);
    if (o.type === 'shrink') m.s.push(`max(0.02,1-0.98*(${ease('in', p)}))`);
    if (o.type === 'slide') { const [dx, dy] = dirVec(o.dir || 'down'); if (dx) m.x.push(`${f(-dx * 0.07 * k * H / W)}*(${ease('in', p)})`); if (dy) m.y.push(`${f(-dy * 0.07 * k)}*(${ease('in', p)})`); }
  }
  return m;
}
// Per-word overlays for emphasis (and for 'type on' reveal). Times are absolute (timeline seconds).
// Each: {i, role:'reveal'|'emph', from, to, s, y} — s/y are expressions of t (y as a fraction of H).
export function wordOverlays(anim, words, start, end) {
  const out = [], e = anim.emph || {}, a = anim.in || {};
  const minHold = e.minHold ?? 0.12;
  if (a.type === 'type') for (let i = 0; i < words.length; i++) {
    const ws = Math.max(start, words[i].start), d = Math.min(0.12, a.dur ?? 0.1);
    out.push({ i, role: 'reveal', from: ws, to: end, fade: d, s: null, y: null });
  }
  if (!e.type || e.type === 'none') return out;
  for (let i = 0; i < words.length; i++) {
    const ws = Math.max(start, words[i].start), next = words[i + 1]?.start ?? end;
    const to = e.persist ? end : Math.min(end, Math.max(ws + minHold, next, Math.min(words[i].end, end)));
    if (to - ws < 0.02) continue;
    const u = `(t-${f(ws)})`, T1 = Math.max(0.03, Math.min(e.dur ?? 0.1, (to - ws) * 0.6)), b = e.bounce ?? 0.45;
    let s = null, y = null;
    if (e.type === 'pop' || e.type === 'pulse' || (e.type === 'background' && (e.peak ?? 1) !== 1)) {
      const from = e.type === 'pop' ? e.from ?? 0.92 : 1, peak = e.peak ?? 1.2, settle = e.type === 'pop' ? e.settle ?? 1 : 1;
      const k = 10 + 18 * (1 - b), w = Math.PI * 2 * (2 + 3 * b);
      s = `max(0.02,if(lt(${u},${f(T1)}),${f(from)}+${f(peak - from)}*(1-pow(1-${u}/${f(T1)},2)),${f(settle)}+${f(peak - settle)}*exp(-${f(k)}*(${u}-${f(T1)}))*cos(${f(w)}*(${u}-${f(T1)}))))`;
    }
    if (e.type === 'bounce') { const amp = 0.022 * (e.strength ?? 0.5); y = `-${f(amp)}*exp(-${f(6 + 6 * (1 - b))}*${u})*abs(sin(${f(Math.PI * 3.2)}*${u}))`; }
    if (e.type === 'lift') y = `-${f(0.012 * (e.strength ?? 0.5))}*min(1,${u}/0.12)`;
    out.push({ i, role: 'emph', from: ws, to, s, y });
  }
  return out;
}

// ---------------------------------------------------------------- project model helpers
export function defaultCaptions() { return { version: 2, preset: DEFAULT_CAPTION_PRESET, overrides: {}, transcripts: [] }; }
// Bring legacy caption clips (whole-style copies per clip) into the shared model without changing their look.
export function migrateCaptions(p) {
  if (p.captions?.version === 2) return p;
  const capTrackIds = new Set((p.tracks || []).filter(t => t.captions).map(t => t.id));
  const caps = (p.clips || []).filter(c => c.kind === 'text' && (c.caption || capTrackIds.has(c.trackId)));
  p.captions = defaultCaptions();
  if (!caps.length) return p;
  const s = caps[0].style || {};
  const legacy = { font: s.font, weight: s.bold ? 700 : 400, italic: !!s.italic, size: s.size, uppercase: !!s.uppercase, letterSpacing: s.letterSpacing || 0, lineHeight: s.lineHeight, color: s.color, strokeColor: s.strokeColor, strokeWidth: s.strokeWidth, shadowColor: s.shadowColor, shadowOpacity: s.shadowOpacity, shadowBlur: s.shadowBlur, bgColor: s.bgColor, bgOpacity: s.bgOpacity, bgRadius: s.bgRadius, activeColor: s.highlightColor, y: caps[0].transform?.y ?? 0.36 };
  p.captions.preset = 'clean';
  p.captions.overrides = { style: Object.fromEntries(Object.entries(legacy).filter(([, v]) => v !== undefined)), anim: { in: { type: 'none' }, out: { type: 'none' }, emph: { type: s.highlight ? 'highlight' : 'none' } }, layout: { grouping: 'sentence' } };
  for (const c of caps) { c.caption = true; if (c.transform) { c.transform.y = 0; c.transform.x = 0; } }
  return p;
}

// Keep a caption's timed words in step with its text when the text is edited anywhere (viewer,
// inspector, find/replace). Unchanged words keep their timing; new words share the time of the words
// they replace (or interpolate between neighbours) and are marked as estimated.
const tokenize = s => String(s || '').split(/\s+/).filter(Boolean);
const bare = t => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
export function reconcileWords(c) {
  if (!Array.isArray(c.words) || !c.words.length) return false;
  const toks = tokenize(c.text), ws = c.words;
  if (toks.length === ws.length && toks.every((t, i) => t === ws[i].text)) return false;
  if (toks.length === ws.length) { toks.forEach((t, i) => { if (ws[i].text !== t) { ws[i].orig ??= ws[i].text; ws[i].text = t; ws[i].edited = true; } }); return true; }
  // LCS over normalized tokens to keep timing for words that survived the edit.
  const n = ws.length, m = toks.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = bare(ws[i].text) === bare(toks[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const keep = new Array(m).fill(null); let i = 0, j = 0;
  while (i < n && j < m) { if (bare(ws[i].text) === bare(toks[j])) { keep[j] = ws[i]; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  const out = [];
  for (let k = 0; k < m;) {
    if (keep[k]) { out.push({ ...keep[k], text: toks[k] }); k++; continue; }
    let e = k; while (e < m && !keep[e]) e++;
    const a = out.length ? out.at(-1).end : 0, b = e < m ? keep[e].start : c.duration, d = Math.max(0.04, (b - a) / (e - k));
    for (let q = k; q < e; q++) out.push({ text: toks[q], start: a + d * (q - k), end: a + d * (q - k + 1), edited: true, timing: 'estimated' });
    k = e;
  }
  c.words = out; return true;
}
