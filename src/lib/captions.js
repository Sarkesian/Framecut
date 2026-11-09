// Caption editing on top of the shared caption engine: scoped style changes (all captions → track →
// caption → word), presets, transcript corrections that keep word timing, regrouping, generation.
import { signal } from '@preact/signals';
import { project, commit, toast, selection, prefs, savePrefs, time, player } from './state.js';
import { api, waitJob } from './api.js';
import { uid, clipEnd, newClip, dimensions } from '../../shared/model.mjs';
import { resolveCaption, groupWords, groupLimits, breakLines, CAPTION_PRESETS_V2, presetDef, merge, defaultCaptions, POP_INTENSITY } from '../../shared/captions.mjs';
import { addTrack } from './edit.js';

export const capScope = signal('project'); // project | track | caption | word
export const capWord = signal(null); // { clipId, i } selected word in the transcript
export const genState = signal(null); // { stage, progress, message } while generating
export const lastResult = signal(null);

export const userPresets = () => prefs.value.captionPresets || [];
export const allPresets = () => [...userPresets(), ...CAPTION_PRESETS_V2];
export const capTrackOf = p => p.tracks.find(t => t.captions);
export const isCap = (p, c) => c?.kind === 'text' && (c.caption || p.tracks.find(t => t.id === c.trackId)?.captions);
export const captionClips = (p, trackId) => p.clips.filter(c => isCap(p, c) && (!trackId || c.trackId === trackId)).sort((a, b) => a.start - b.start);
export const effOf = (p, c) => resolveCaption(p, c, { presets: userPresets() });
const aspectOf = p => { const [w, h] = dimensions(p.settings.ratio, 1080); return w / h; };
const limitsFor = (p, eff) => groupLimits(eff.layout, { aspect: aspectOf(p), size: eff.style.size });
export const rebuildText = (p, c) => { const eff = effOf(p, c); c.text = breakLines((c.words || []).map(w => w.text), limitsFor(p, eff)); c.name = c.text.replace(/\n/g, ' ').slice(0, 40); };

// ---------------------------------------------------------------- scope + styles
// The clips a style change applies to, given the current scope and selection.
export function scopeTarget(p = project.value) {
  const sel = p.clips.filter(c => selection.value.includes(c.id) && isCap(p, c));
  const scope = capScope.value;
  if (scope === 'word' && capWord.value) return { level: 'word', clipId: capWord.value.clipId, i: capWord.value.i };
  if (scope === 'caption' && sel.length) return { level: 'caption', clipIds: sel.map(c => c.id) };
  if (scope === 'track') return { level: 'track', trackId: (sel[0] || captionClips(p)[0])?.trackId || capTrackOf(p)?.id };
  return { level: 'project' };
}
export const scopeLabel = tgt => tgt.level === 'project' ? 'All captions' : tgt.level === 'track' ? 'This caption track' : tgt.level === 'caption' ? (tgt.clipIds.length > 1 ? `${tgt.clipIds.length} captions` : 'This caption') : 'This word';
// Set one value at the chosen level (section: style | anim.in | anim.emph | anim.out | layout).
export function setCap(section, key, value, { label, coalesce = true } = {}) {
  const tgt = scopeTarget();
  commit(label || `Caption ${key}`, p => {
    const put = obj => { const parts = section.split('.'); let o = obj; for (const k of parts) o = o[k] ||= {}; o[key] = value; };
    if (tgt.level === 'project') { p.captions ||= defaultCaptions(); put(p.captions.overrides ||= {}); }
    else if (tgt.level === 'track') { const t = p.tracks.find(x => x.id === tgt.trackId); if (!t) return false; put(t.captionStyle ||= {}); }
    else if (tgt.level === 'caption') { for (const c of p.clips) if (tgt.clipIds.includes(c.id)) put(c.capStyle ||= {}); }
    else if (tgt.level === 'word') { if (section !== 'style') return false; const c = p.clips.find(x => x.id === tgt.clipId); const w = c?.words?.[tgt.i]; if (!w) return false; (w.style ||= {})[key] = value; }
    if (section === 'layout' || ['size', 'uppercase', 'font', 'weight', 'letterSpacing'].includes(key)) for (const c of captionClips(p)) rebuildText(p, c);
  }, { key: coalesce ? `cap:${tgt.level}:${section}.${key}` : undefined });
}
// Remove overrides at the current level, so values are inherited again.
export function resetScope() {
  const tgt = scopeTarget();
  commit('Reset caption style', p => {
    if (tgt.level === 'project') p.captions.overrides = {};
    else if (tgt.level === 'track') delete p.tracks.find(x => x.id === tgt.trackId).captionStyle;
    else if (tgt.level === 'caption') for (const c of p.clips) if (tgt.clipIds.includes(c.id)) delete c.capStyle;
    else { const w = p.clips.find(x => x.id === tgt.clipId)?.words?.[tgt.i]; if (w) delete w.style; }
    for (const c of captionClips(p)) rebuildText(p, c);
  });
  toast(`${scopeLabel(tgt)}: style reset. The transcript is unchanged.`);
}
// One click: the preset becomes the look of every caption (position tweaks are kept).
export function applyPreset(id) {
  const tgt = scopeTarget(), pr = allPresets().find(x => x.id === id); if (!pr) return;
  commit(`Caption style: ${pr.name}`, p => {
    p.captions ||= defaultCaptions();
    if (tgt.level === 'project' || tgt.level === 'word') {
      const keep = { x: p.captions.overrides?.style?.x, y: p.captions.overrides?.style?.y };
      p.captions.preset = id; p.captions.overrides = {};
      if (keep.x !== undefined || keep.y !== undefined) p.captions.overrides.style = Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined));
      for (const t of p.tracks) delete t.captionStyle; for (const c of p.clips) { delete c.capStyle; for (const w of c.words || []) delete w.style; }
    } else {
      const look = { style: pr.style, anim: pr.anim, layout: pr.layout };
      if (tgt.level === 'track') p.tracks.find(x => x.id === tgt.trackId).captionStyle = structuredClone(look);
      else for (const c of p.clips) if (tgt.clipIds.includes(c.id)) c.capStyle = structuredClone(look);
    }
    for (const c of captionClips(p)) rebuildText(p, c);
  });
}
export function setPopIntensity(level) { const v = POP_INTENSITY[level]; for (const [k, x] of Object.entries(v)) setCap('anim.emph', k, x, { label: 'Word pop: ' + level, coalesce: true }); }
// Custom presets live in preferences, so they are available in every project.
export async function saveAsPreset(name) {
  const p = project.value, eff = effOf(p, captionClips(p)[0] || null);
  const id = 'user-' + uid().slice(0, 8);
  await savePrefs({ captionPresets: [...userPresets(), { id, name: name || 'My style', hint: 'Custom', style: eff.style, anim: eff.anim, layout: eff.layout, custom: true }] });
  commit('Use saved style', d => { d.captions ||= defaultCaptions(); d.captions.preset = id; d.captions.overrides = {}; });
  toast(`Saved “${name}”. It’s available in all your projects.`); return id;
}
export const toggleFavorite = id => savePrefs({ captionFavorites: (prefs.value.captionFavorites || []).includes(id) ? prefs.value.captionFavorites.filter(x => x !== id) : [...(prefs.value.captionFavorites || []), id] });
export const setDefaultPreset = id => { savePrefs({ captionDefault: id }); toast(`${allPresets().find(x => x.id === id)?.name} is now the default for new captions.`); };
export const deletePreset = id => savePrefs({ captionPresets: userPresets().filter(x => x.id !== id), captionFavorites: (prefs.value.captionFavorites || []).filter(x => x !== id) });
let styleClipboard = null;
export function copyStyle() { const p = project.value, c = p.clips.find(x => selection.value.includes(x.id) && isCap(p, x)) || captionClips(p)[0]; if (!c) return; const e = effOf(p, c); styleClipboard = { style: e.style, anim: e.anim }; toast('Caption style copied.'); }
export function pasteStyle() {
  if (!styleClipboard) return toast('Copy a caption style first.', 'warn');
  const tgt = scopeTarget();
  commit('Paste caption style', p => {
    const look = structuredClone(styleClipboard);
    if (tgt.level === 'project' || tgt.level === 'word') { p.captions.overrides = look; for (const c of p.clips) delete c.capStyle; }
    else if (tgt.level === 'track') p.tracks.find(x => x.id === tgt.trackId).captionStyle = look;
    else for (const c of p.clips) if (tgt.clipIds.includes(c.id)) c.capStyle = look;
    for (const c of captionClips(p)) rebuildText(p, c);
  });
}

// ---------------------------------------------------------------- transcript edits (timing preserved)
const findClip = (p, id) => p.clips.find(c => c.id === id);
// Correct a word's spelling; several words typed in its place share its time span.
export function editWord(clipId, i, text) {
  commit('Edit caption word', p => {
    const c = findClip(p, clipId), w = c?.words?.[i]; if (!w) return false;
    const parts = text.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) { c.words.splice(i, 1); if (!c.words.length) p.clips = p.clips.filter(x => x !== c); else rebuildText(p, c); return; }
    w.orig ??= w.text;
    if (parts.length === 1) { w.text = parts[0]; w.edited = true; }
    else { const d = (w.end - w.start) / parts.length; c.words.splice(i, 1, ...parts.map((t, k) => ({ ...w, text: t, start: w.start + d * k, end: w.start + d * (k + 1), edited: true, timing: 'estimated' }))); }
    delete w.flag; rebuildText(p, c);
  }, { key: 'capword:' + clipId + i });
}
export function setWordTiming(clipId, i, start, end) {
  commit('Word timing', p => {
    const c = findClip(p, clipId), w = c?.words?.[i]; if (!w) return false;
    const lo = i ? c.words[i - 1].start + 0.02 : 0, hi = i + 1 < c.words.length ? c.words[i + 1].end - 0.02 : c.duration;
    w.start = Math.max(lo, Math.min(start, end - 0.03)); w.end = Math.min(hi, Math.max(end, w.start + 0.03));
    if (i && c.words[i - 1].end > w.start) c.words[i - 1].end = w.start; if (i + 1 < c.words.length && c.words[i + 1].start < w.end) c.words[i + 1].start = w.end;
    w.timing = 'manual';
  }, { key: 'capwt:' + clipId + i });
}
// Split a caption so word i starts a new one.
export function splitCaption(clipId, i) {
  commit('Split caption', p => {
    const c = findClip(p, clipId); if (!c?.words || i <= 0 || i >= c.words.length) return false;
    const cut = c.words[i].start, right = structuredClone(c); right.id = uid();
    right.start = c.start + cut; right.duration = c.duration - cut; right.words = c.words.slice(i).map(w => ({ ...w, start: w.start - cut, end: w.end - cut }));
    c.words = c.words.slice(0, i); c.duration = cut; rebuildText(p, c); rebuildText(p, right); p.clips.push(right);
  });
}
export function mergeWithNext(clipId) {
  commit('Merge captions', p => {
    const list = captionClips(p), k = list.findIndex(c => c.id === clipId), a = list[k], b = list[k + 1]; if (!a || !b || a.trackId !== b.trackId) return false;
    const off = b.start - a.start; a.words = [...(a.words || []), ...(b.words || []).map(w => ({ ...w, start: w.start + off, end: w.end + off }))];
    a.duration = clipEnd(b) - a.start; p.clips = p.clips.filter(c => c !== b); rebuildText(p, a);
  });
}
export function searchReplace(find, repl, { whole = true, matchCase = false } = {}) {
  if (!find) return 0; let n = 0;
  const re = new RegExp((whole ? '^' : '') + find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (whole ? '([.,!?;:…"\')\\]]*)$' : ''), matchCase ? 'g' : 'gi');
  commit('Replace in captions', p => {
    for (const c of captionClips(p)) {
      let touched = false;
      for (const w of c.words || []) { const nt = whole ? w.text.replace(re, (_m, tail = '') => repl + tail) : w.text.replace(re, repl); if (nt !== w.text) { w.orig ??= w.text; w.text = nt; w.edited = true; n++; touched = true; } }
      if (touched) rebuildText(p, c);
    }
    if (!n) return false;
  });
  return n;
}
// Regroup every caption from its words (e.g. after changing the grouping mode). Word data is kept.
export function regroup(trackId) {
  commit('Regroup captions', p => {
    const t = trackId ? p.tracks.find(x => x.id === trackId) : capTrackOf(p); if (!t) return false;
    const clips = captionClips(p, t.id); if (!clips.length) return false;
    const words = clips.flatMap(c => (c.words || []).map(w => ({ ...w, start: c.start + w.start, end: c.start + w.end })));
    if (!words.length) return false;
    const eff = effOf(p, { trackId: t.id }), groups = groupWords(words, eff.layout, { aspect: aspectOf(p), size: eff.style.size });
    p.clips = p.clips.filter(c => !clips.includes(c));
    for (const g of groups) p.clips.push(newClip('text', { trackId: t.id, caption: true, start: g.start, duration: Math.max(0.2, g.end - g.start), text: g.text, name: g.text.replace(/\n/g, ' ').slice(0, 40), words: g.words.map(w => ({ ...w, start: w.start - g.start, end: w.end - g.start })) }));
  });
}

// ---------------------------------------------------------------- generation
// Which audio to listen to: the voice tracks when there are any (so music is not mixed in), otherwise
// every audible clip; or just the selection / one track / a timeline range.
export function captionSources(p, source) {
  const audible = c => (c.kind === 'audio' || c.kind === 'video') && !c.muted && !p.tracks.find(t => t.id === c.trackId)?.muted && !(c.kind === 'video' && c.detachedAudio);
  let clips;
  if (source === 'selected') clips = p.clips.filter(c => selection.value.includes(c.id) && audible(c));
  else if (source?.startsWith('track:')) clips = p.clips.filter(c => c.trackId === source.slice(6) && audible(c));
  else { const voice = p.clips.filter(c => audible(c) && p.tracks.find(t => t.id === c.trackId)?.voice); clips = voice.length && source !== 'all' ? voice : p.clips.filter(audible); }
  return clips;
}
export async function generateCaptions({ source = 'auto', language = '', quality = 'best', lyrics = true, vocabulary = '', range = null, signal } = {}) {
  const p = project.value, clips = captionSources(p, source);
  if (!clips.length) { toast(source === 'selected' ? 'Select a clip with speech first.' : 'Add a video or audio clip with speech first.', 'warn'); return null; }
  const from = range?.from ?? Math.min(...clips.map(c => c.start)), to = range?.to ?? Math.max(...clips.map(clipEnd));
  genState.value = { stage: 'prepare', progress: 0, message: 'Preparing audio…' };
  const engine = await api('/api/captions/engine').catch(() => ({ ready: false }));
  if (!engine.ready) return builtinCaptions(clips, { from, to, language, signal });
  try {
    const { job } = await api('/api/captions/transcribe', { project: p, clipIds: clips.map(c => c.id), from, to, language, quality, lyrics, vocabulary });
    if (signal) signal.addEventListener('abort', () => api('/api/jobs/' + job, undefined, 'DELETE').catch(() => {}), { once: true });
    const r = await waitJob(job, (pr, msg) => { genState.value = { stage: 'run', progress: pr, message: msg || 'Listening…' }; });
    lastResult.value = r;
    if (!r.words.length) { toast(r.regions?.some(x => x.kind === 'singing') && !lyrics ? 'Only singing was found. Turn on “Include song lyrics” to caption it.' : r.regions?.length ? 'No voice was found — only music or sound effects, so no captions were made.' : 'No speech was found in that audio.', 'warn', { timeout: 9000 }); return r; }
    placeWords(r, { from, to });
    const flagged = r.words.filter(w => w.flag).length;
    toast(`${r.words.length} words in ${r.groups} captions${flagged ? ` · ${flagged} to review (underlined)` : ''}${r.skipped ? ` · ${r.skipped} music or sound section${r.skipped > 1 ? 's' : ''} skipped` : ''}.`, 'info', { timeout: 7000 });
    return r;
  } finally { genState.value = null; }
}
// Fallback when the accurate engine is not installed: the in-app Whisper model, with two safeguards
// against its known failure modes — repetition loops and words where the audio is silent.
async function builtinCaptions(clips, { from, to, language, signal }) {
  const { transcribe } = await import('./whisper.js');
  const all = [];
  try {
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i]; genState.value = { stage: 'run', progress: i / clips.length, message: `Listening (basic engine)… ${i + 1} of ${clips.length}` };
      const srcFrom = c.in, srcTo = c.in + c.duration * (c.speed || 1);
      const r = await transcribe({ mediaId: c.mediaId, from: srcFrom, to: srcTo, model: 'small', language: language ? language.toLowerCase() : undefined, signal, onProgress: d => { genState.value = { stage: 'run', progress: (i + (d.progress ?? 0.5)) / clips.length, message: d.message || 'Listening…' }; } });
      const { speech } = await api('/api/tools/speech', { mediaId: c.mediaId, from: srcFrom, to: srcTo, threshold: -45, minSilence: 0.6 }).catch(() => ({ speech: null }));
      for (const w of r.words) {
        const mid = (w.start + w.end) / 2; if (speech && !speech.some(s => mid >= s.start - 0.3 && mid <= s.end + 0.3)) continue;
        all.push({ text: w.text, start: c.start + (w.start - c.in) / (c.speed || 1), end: c.start + (w.end - c.in) / (c.speed || 1), flag: 'basic' });
      }
    }
  } finally { genState.value = null; }
  const norm = t => t.toLowerCase().replace(/[^\w']/g, '');
  const words = all.sort((a, b) => a.start - b.start).filter(w => w.end > from && w.start < to);
  for (let n = 1; n <= 4; n++) for (let i = 0; i + n * 3 <= words.length; i++) {
    let reps = 1; const g = words.slice(i, i + n).map(w => norm(w.text)).join(' ');
    while (words.slice(i + reps * n, i + (reps + 1) * n).map(w => norm(w.text)).join(' ') === g) reps++;
    if (reps >= 3) words.splice(i + n, (reps - 1) * n);
  }
  if (!words.length) { toast('No speech was found.', 'warn'); return { words: [] }; }
  const r = { words, engine: 'Built-in Whisper (basic)', regions: [] }; lastResult.value = r;
  placeWords(r, { from, to });
  toast(`${words.length} words captioned with the basic engine. For much better accuracy, set up the caption engine in the Generate tab.`, 'warn', { timeout: 9000 });
  return r;
}
// Put recognized words (timeline seconds) on the caption track, replacing captions in [from, to].
export function placeWords(r, { from, to }) {
  commit('Generate captions', p => {
    p.captions ||= defaultCaptions();
    if (p.captions.preset === undefined) p.captions.preset = prefs.value.captionDefault || 'word-pop';
    let t = capTrackOf(p); if (!t) { t = addTrack(p, 'text'); t.captions = true; t.name = 'Captions'; }
    p.clips = p.clips.filter(c => !(c.trackId === t.id && c.start < to && clipEnd(c) > from));
    const eff = effOf(p, { trackId: t.id }), groups = groupWords(r.words, eff.layout, { aspect: aspectOf(p), size: eff.style.size });
    for (const g of groups) p.clips.push(newClip('text', { trackId: t.id, caption: true, start: g.start, duration: Math.max(0.2, g.end - g.start), text: g.text, name: g.text.replace(/\n/g, ' ').slice(0, 40), words: g.words.map(w => ({ text: w.text, start: w.start - g.start, end: w.end - g.start, conf: w.conf, flag: w.flag || undefined, src: w.src })) }));
    r.groups = groups.length;
    (p.captions.transcripts ||= []).push({ id: uid(), at: new Date().toISOString(), from, to, engine: r.engine, language: r.language, text: r.words.map(w => w.text).join(' '), words: r.words.map(w => [w.text, +w.start.toFixed(3), +w.end.toFixed(3)]) });
    p.captions.transcripts = p.captions.transcripts.slice(-5);
  });
}
export const seekWord = (c, w) => player.current?.seek(c.start + w.start + 0.001);
export const nowWord = (c) => { const u = time.value - c.start; return (c.words || []).findIndex(w => u >= w.start && u < w.end); };

// ---------------------------------------------------------------- script reference + re-alignment
const bareTok = t => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
function editDist(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
// Suggestions from the written script: only one-for-one substitutions that look like the same word
// (spelling of names, capitalisation). Words the speaker skipped or added are never changed.
export function scriptSuggestions(p = project.value) {
  const script = String(p.script?.text || '').split(/\s+/).filter(Boolean); if (!script.length) return [];
  const flat = captionClips(p).flatMap(c => (c.words || []).map((w, i) => ({ c, i, w })));
  const A = flat.map(x => bareTok(x.w.text)), B = script.map(bareTok), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { if (flat[i].w.text.replace(/[.,!?;:…]+$/, '') !== script[j].replace(/[.,!?;:…]+$/, '') && A[i] === B[j]) out.push({ ...flat[i], to: script[j], why: 'spelling' }); i++; j++; continue; }
    if (L[i + 1][j + 1] >= Math.max(L[i + 1][j], L[i][j + 1]) - 0 && A[i] && B[j] && editDist(A[i], B[j]) <= Math.max(1, Math.floor(Math.min(A[i].length, B[j].length) / 3))) { out.push({ ...flat[i], to: script[j], why: 'sounds alike' }); i++; j++; continue; }
    if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return out.filter(s => s.to !== s.w.text);
}
export function applySuggestions(list) {
  commit('Use script wording', p => {
    for (const s of list) { const c = p.clips.find(x => x.id === s.c.id), w = c?.words?.[s.i]; if (!w) continue; w.orig ??= w.text; w.text = s.to; w.edited = true; }
    for (const c of captionClips(p)) rebuildText(p, c);
  });
}
// Re-time a caption's (corrected) words against the recording with the forced aligner.
export async function realign(clipId) {
  const p = project.value, c = p.clips.find(x => x.id === clipId); if (!c?.words?.length) return;
  const clips = captionSources(p, 'auto'); if (!clips.length) return toast('No audio to align against.', 'warn');
  const from = Math.max(0, c.start - 0.3), to = clipEnd(c) + 0.3;
  try {
    const { job } = await api('/api/captions/align', { project: p, clipIds: clips.map(x => x.id), from, to, text: c.words.map(w => w.text).join(' '), language: p.captions?.transcripts?.at(-1)?.language || '' });
    const r = await waitJob(job);
    if (r.words.length !== c.words.length) return toast('Could not match every word to the audio; timing left as it was.', 'warn');
    commit('Re-align caption', d => { const x = d.clips.find(k => k.id === clipId); r.words.forEach((w, k) => { Object.assign(x.words[k], { start: Math.max(0, w.start - x.start), end: Math.max(0, w.end - x.start) }); delete x.words[k].timing; }); });
    toast('Word timing re-aligned to the recording.');
  } catch (e) { toast('Re-align failed: ' + e.message, 'error'); }
}
