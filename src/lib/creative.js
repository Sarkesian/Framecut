// Creative Library client: search state that survives panel switches, debounced and cancellable
// queries, audio previews on the chosen output device, rights-checked imports and timeline inserts.
import { signal } from '@preact/signals';
import { api, waitJob, native } from './api.js';
import { project, commit, time, toast, media, asset, player, refreshMedia, prefs } from './state.js';
import { newClip, clipEnd, projectDuration } from '../../shared/model.mjs';
import { assessRights } from '../../shared/rights.mjs';
import { freeTrack, addTrack, trackOf, overlaps } from './edit.js';
import { activeOutput } from '../audio/devices.js';
import { shortTime } from './format.js';

export const audioTab = signal('music');   // music | sfx | mine
export const stickerTab = signal('discover'); // discover | animated | static | mine
export const libStatus = signal(null);
export const busyKeys = signal(new Map()); // key -> progress 0..1 (or null = indeterminate)
export const selectedRecord = signal(null); // detail drawer

const blank = () => ({ q: '', length: '', source: '', category: '', results: [], page: 0, pages: 0, total: 0, status: 'idle', error: null, scroll: 0 });
export const searches = { music: signal(blank()), sfx: signal(blank()), fluent: signal(blank()) };
const PROVIDER = { music: 'openverse', sfx: 'openverse', fluent: 'fluent' };

export const usageMode = () => (project.value?.usageMode === 'personal' ? 'personal' : 'commercial');
export function setUsageMode(mode) {
  commit('Usage: ' + (mode === 'personal' ? 'personal' : 'commercial'), p => { p.usageMode = mode; });
  for (const k of ['music', 'sfx']) if (searches[k].value.results.length || searches[k].value.q) search(k, {}, { now: true });
}
export const rightsOf = rec => assessRights({ provider: rec.provider, license: rec.license, licenseVersion: rec.licenseVersion, kind: rec.kind, usage: usageMode() });

export async function loadStatus() { try { libStatus.value = await api('/api/creative/status'); } catch {} return libStatus.value; }

// ----- search -----
const timers = {}, controllers = {};
export function search(panel, patch = {}, { now = false, more = false } = {}) {
  const s = searches[panel]; s.value = { ...s.value, ...patch };
  clearTimeout(timers[panel]);
  const go = () => runSearch(panel, more);
  if (now || more) go(); else timers[panel] = setTimeout(go, 420);
}
async function runSearch(panel, more) {
  const s = searches[panel], cur = s.value;
  const q = cur.q.trim();
  if (panel !== 'fluent' && !q) { s.value = { ...cur, results: [], status: 'idle', error: null, total: 0, page: 0, pages: 0 }; return; }
  if (panel !== 'fluent' && q.length < 2) return;
  controllers[panel]?.abort(); const ctl = new AbortController(); controllers[panel] = ctl;
  const page = more ? cur.page + 1 : 1;
  s.value = { ...cur, status: more ? 'more' : 'loading', error: null };
  const params = new URLSearchParams({ provider: PROVIDER[panel], kind: panel === 'fluent' ? 'sticker' : panel, q, page: String(page), usage: usageMode(), length: cur.length, source: cur.source, category: cur.category });
  try {
    const r = await fetch('/api/creative/search?' + params, { signal: ctl.signal }); const d = await r.json();
    if (!r.ok) throw Object.assign(Error(d.error), { code: d.code, retryAfter: d.retryAfter });
    if (ctl.signal.aborted) return;
    const seen = new Set(more ? s.value.results.map(x => x.key) : []);
    const items = (more ? s.value.results : []).concat(d.items.filter(x => !seen.has(x.key)));
    s.value = { ...s.value, results: items, page: d.page, pages: d.pages, total: d.total, status: items.length ? 'ok' : 'empty', error: null };
    if (panel !== 'fluent') rememberSearch(panel, q);
  } catch (e) {
    if (e.name === 'AbortError') return;
    s.value = { ...s.value, status: 'error', error: { message: e.message, code: e.code || (navigator.onLine === false ? 'offline' : null), retryAfter: e.retryAfter } };
  }
}
function rememberSearch(panel, q) { try { const k = 'fc:lib-recent-' + panel; const list = [q, ...JSON.parse(localStorage.getItem(k) || '[]').filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8); localStorage.setItem(k, JSON.stringify(list)); } catch {} }
export function recentSearches(panel) { try { return JSON.parse(localStorage.getItem('fc:lib-recent-' + panel) || '[]'); } catch { return []; } }

export const lists = signal({ audio: { favorites: [], recents: [] }, sticker: { favorites: [], recents: [] } });
export async function loadLists() {
  try { const [a, s] = await Promise.all([api('/api/creative/lists?kind=music'), api('/api/creative/lists?kind=sticker')]); lists.value = { audio: a, sticker: s }; } catch {}
}
export async function toggleFavorite(rec) {
  const on = !rec.favorite;
  try {
    await api('/api/creative/favorite', { record: rec, on });
    const flip = x => (x.key === rec.key ? { ...x, favorite: on } : x);
    for (const k of Object.keys(searches)) { const s = searches[k]; if (s.value.results.some(x => x.key === rec.key)) s.value = { ...s.value, results: s.value.results.map(flip) }; }
    if (selectedRecord.value?.key === rec.key) selectedRecord.value = { ...selectedRecord.value, favorite: on };
    loadLists();
    toast(on ? `Saved “${rec.title}” to favorites.` : `Removed “${rec.title}” from favorites.`);
  } catch (e) { toast(e.message, 'error'); }
}

// ----- audio preview (never while recording; follows the editor's output device) -----
export const preview = signal({ key: null, state: 'idle', t: 0, d: 0 });
let audioEl = null, recordingCheck = () => false;
export const setRecordingCheck = fn => { recordingCheck = fn; };
export function stopPreview() { if (audioEl) { audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); } preview.value = { key: null, state: 'idle', t: 0, d: 0 }; }
export async function togglePreview(rec) {
  if (preview.value.key === rec.key) return stopPreview();
  if (recordingCheck()) return toast('Previews are paused while you record, so nothing leaks into your microphone.', 'warn');
  if (!audioEl) {
    audioEl = new Audio(); audioEl.preload = 'auto';
    audioEl.addEventListener('timeupdate', () => { if (preview.value.key) preview.value = { ...preview.value, t: audioEl.currentTime, d: audioEl.duration || preview.value.d }; });
    audioEl.addEventListener('playing', () => { if (preview.value.key) preview.value = { ...preview.value, state: 'playing' }; });
    audioEl.addEventListener('waiting', () => { if (preview.value.key) preview.value = { ...preview.value, state: 'loading' }; });
    audioEl.addEventListener('ended', stopPreview);
    audioEl.addEventListener('error', () => { if (preview.value.key) { toast('This preview could not be played. The file may be unavailable right now.', 'warn'); stopPreview(); } });
  }
  player.current?.pause();
  const sink = activeOutput.value && activeOutput.value !== 'default' ? activeOutput.value : '';
  if (audioEl.setSinkId) await audioEl.setSinkId(sink).catch(() => {});
  audioEl.volume = Math.min(1, Math.max(0, prefs.value.libraryPreviewVolume ?? 0.8));
  audioEl.src = rec.imported && asset(rec.imported) ? asset(rec.imported).url : `/api/creative/preview/${rec.provider}/${encodeURIComponent(rec.sourceId)}`;
  preview.value = { key: rec.key, state: 'loading', t: 0, d: (rec.durationMs || 0) / 1000 };
  audioEl.play().catch(e => { if (e.name !== 'AbortError') { toast('Preview failed to start: ' + e.message, 'warn'); stopPreview(); } });
}
export function setPreviewVolume(v) { if (audioEl) audioEl.volume = v; }
export function seekPreview(frac) { if (audioEl?.duration) audioEl.currentTime = frac * audioEl.duration; }

// ----- import + insert -----
const setBusy = (key, v) => { const m = new Map(busyKeys.value); if (v === undefined) m.delete(key); else m.set(key, v); busyKeys.value = m; };
export async function obtain(rec) {
  if (rec.imported && asset(rec.imported) && !asset(rec.imported).missing) return asset(rec.imported);
  const r = rights(rec);
  if (r.blocked) { toast(r.summary + (r.badge === 'Non-commercial' ? ' Switch the project to personal use if this is a non-commercial video.' : ''), 'warn', { timeout: 9000 }); return null; }
  if (busyKeys.value.has(rec.key)) return null;
  setBusy(rec.key, null);
  try {
    const res = await api('/api/creative/import', { provider: rec.provider, id: rec.sourceId, kind: rec.kind, usage: usageMode() });
    const out = res.asset || (await waitJob(res.job, p => setBusy(rec.key, p))).asset;
    const m = new Map(media.value); m.set(out.id, out); media.value = m;
    markImported(rec.key, out.id); loadLists();
    return out;
  } catch (e) {
    if (!e.cancelled) toast(friendly(e, rec), 'error', { timeout: 9000 });
    return null;
  } finally { setBusy(rec.key); }
}
const rights = rec => rightsOf(rec);
function markImported(key, id) {
  for (const k of Object.keys(searches)) { const s = searches[k]; if (s.value.results.some(x => x.key === key)) s.value = { ...s.value, results: s.value.results.map(x => (x.key === key ? { ...x, imported: id } : x)) }; }
  if (selectedRecord.value?.key === key) selectedRecord.value = { ...selectedRecord.value, imported: id };
}
export function friendly(e, rec) {
  const what = rec ? `“${rec.title}”` : 'That item';
  if (e.code === 'offline') return `${what} could not be downloaded — you appear to be offline.`;
  if (e.code === 'gone') return `${what} is no longer available from its source.`;
  if (e.code === 'quota') return `The library is busy. Try again in ${e.retryAfter || 60} seconds.`;
  if (e.code === 'license') return e.message;
  return `${what} could not be added: ${e.message}`;
}

// Insert music / sound effects on a dedicated audio track; returns the new clip id.
export function insertAudio(a, kind, { at = time.value, trackId } = {}) {
  const p0 = project.value; const end = projectDuration(p0);
  const music = kind === 'music';
  let duration = a.duration, fadeOut = 0;
  // Background music fills the rest of the video (not past it) and fades out at the end.
  if (music && end - at > 2 && a.duration > end - at) { duration = end - at; fadeOut = Math.min(2.5, duration / 4); }
  const name = (a.source?.title || a.name).replace(/\.[^.]+$/, '');
  const c = newClip('audio', { mediaId: a.id, name, start: at, duration, in: 0, volume: music ? 0.7 : 1, fadeIn: music && duration > 6 ? 0.4 : 0, fadeOut });
  const label = music ? 'Music' : 'Sound FX';
  let trackName = label;
  commit(music ? 'Add music' : 'Add sound effect', p => {
    let t = trackId && trackOf(p, trackId)?.kind === 'audio' && !trackOf(p, trackId).locked && !overlaps(p, trackId, at, at + duration) ? trackOf(p, trackId) : null;
    t ||= p.tracks.find(x => x.kind === 'audio' && !x.locked && !x.voice && x.name.startsWith(label) && !overlaps(p, x.id, at, at + duration));
    if (!t) { const used = p.tracks.filter(x => x.kind === 'audio' && x.name.startsWith(label)).length; t = p.tracks.find(x => x.kind === 'audio' && !x.locked && !x.voice && !p.clips.some(o => o.trackId === x.id)); if (!t) t = addTrack(p, 'audio'); t.name = used ? `${label} ${used + 1}` : label; }
    trackName = t.name; c.trackId = t.id; p.clips.push(c); if (!p.mediaIds.includes(a.id)) p.mediaIds.push(a.id);
  }, { select: [c.id] });
  toast(`Added “${name}” to ${trackName} at ${shortTime(at)} · ${shortTime(duration)}${duration < a.duration - 0.05 ? ` (trimmed to fit, fades out)` : ''}. Ctrl+Z to undo.`);
  return c.id;
}
// Stickers go on a free overlay (text) track, centered, looping when animated.
export function insertSticker(a, { at = time.value } = {}) {
  const duration = a.kind === 'video' ? Math.max(3, Math.min(8, a.duration || 3)) : 3;
  const name = (a.source?.title || a.name).replace(/\s*\(sticker\)$/, '').replace(/\.[^.]+$/, '');
  const c = newClip('sticker', { sticker: { type: 'media' }, mediaId: a.id, in: 0, speed: 1, loop: true, start: at, duration, name, transform: { scale: 1 }, animIn: { id: 'pop', duration: 0.3 } });
  let trackName = '';
  commit('Add sticker', p => {
    const t = p.tracks.find(t => t.kind === 'text' && !t.captions && !t.locked && !overlaps(p, t.id, at, at + duration)) || addTrack(p, 'text');
    c.trackId = t.id; trackName = t.name; p.clips.push(c); if (!p.mediaIds.includes(a.id)) p.mediaIds.push(a.id);
  }, { select: [c.id] });
  toast(`Added “${name}” sticker at ${shortTime(at)} for ${shortTime(duration)}${a.animated ? ', looping' : ''}. Drag its corners in the player to resize. Ctrl+Z to undo.`);
  return c.id;
}
// One entry point for clicks, Enter and drops.
export async function useRecord(rec, { at = time.value, trackId } = {}) {
  const a = await obtain(rec); if (!a) return null;
  return rec.kind === 'sticker' ? insertSticker(a, { at }) : insertAudio(a, rec.kind, { at, trackId });
}
// Drag payload understood by the timeline and the player (see Timeline.jsx / Preview.jsx).
export function dragRecord(e, rec) {
  const data = { type: 'library', key: rec.key, duration: rec.kind === 'sticker' ? 3 : (rec.durationMs || 3000) / 1000, drop: ({ at, track } = {}) => useRecord(rec, { at: at ?? time.value, trackId: track?.id }) };
  e.dataTransfer.setData('application/x-framecut', JSON.stringify({ type: 'library', key: rec.key })); e.dataTransfer.effectAllowed = 'copy'; window.__fcDrag = data;
}
export function dragAsset(e, a, kind) {
  const data = { type: 'library', duration: kind === 'sticker' ? 3 : a.duration, drop: ({ at, track } = {}) => (kind === 'sticker' ? insertSticker(a, { at: at ?? time.value }) : insertAudio(a, kind, { at: at ?? time.value, trackId: track?.id })) };
  e.dataTransfer.setData('application/x-framecut', JSON.stringify({ type: 'library' })); e.dataTransfer.effectAllowed = 'copy'; window.__fcDrag = data;
}

// ----- own sticker files -----
export async function importStickerFiles(files) {
  const paths = [], uploads = [];
  for (const f of files) { const p = native?.pathForFile?.(f); if (p) paths.push(p); else uploads.push(f); }
  const res = { ready: [], renderer: [], errors: [] };
  const merge = r => { res.ready.push(...r.ready); res.renderer.push(...r.renderer); res.errors.push(...r.errors); };
  if (paths.length) merge(await api('/api/creative/stickers/import', { paths }));
  if (uploads.length) { const form = new FormData(); for (const f of uploads) form.append('files', f); const r = await fetch('/api/creative/stickers/upload', { method: 'POST', body: form }); const d = await r.json(); if (!r.ok) throw Error(d.error); merge(d); }
  if (res.renderer.length) {
    const { bakeInEditor } = await import('./bake.js');
    for (const item of res.renderer) { try { res.ready.push(await bakeInEditor(item)); } catch (e) { res.errors.push({ name: item.name, error: e.message }); } }
  }
  if (res.ready.length) { await refreshMedia(); commit('Import stickers', p => { for (const a of res.ready) if (!p.mediaIds.includes(a.id)) p.mediaIds.push(a.id); }); }
  if (res.errors.length) toast(res.errors.map(x => `${x.name}: ${x.error}`).join('\n'), 'error', { timeout: 10000 });
  if (res.ready.length) toast(`${res.ready.length} sticker${res.ready.length > 1 ? 's' : ''} ready in My stickers.`);
  return res.ready;
}
export async function pickStickerFiles() {
  if (native) { const paths = await native.openFiles({ title: 'Import stickers', multi: true, filters: [{ name: 'Stickers', extensions: ['png', 'apng', 'gif', 'webp', 'svg', 'json'] }] }); if (!paths?.length) return; const r = await api('/api/creative/stickers/import', { paths }); return finishPicked(r); }
  const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = '.png,.apng,.gif,.webp,.svg,.json,image/*,application/json';
  input.onchange = () => input.files.length && importStickerFiles([...input.files]); input.click();
}
async function finishPicked(r) {
  if (r.renderer.length) { const { bakeInEditor } = await import('./bake.js'); for (const item of r.renderer) { try { r.ready.push(await bakeInEditor(item)); } catch (e) { r.errors.push({ name: item.name, error: e.message }); } } }
  if (r.ready.length) { await refreshMedia(); commit('Import stickers', p => { for (const a of r.ready) if (!p.mediaIds.includes(a.id)) p.mediaIds.push(a.id); }); toast(`${r.ready.length} sticker${r.ready.length > 1 ? 's' : ''} ready in My stickers.`); }
  if (r.errors.length) toast(r.errors.map(x => `${x.name}: ${x.error}`).join('\n'), 'error', { timeout: 10000 });
}

// Loudness-match just the new music clip to the project's mix targets (voice recordings are not touched).
export async function balanceClip(clipId) {
  const p = project.value; const c = p.clips.find(x => x.id === clipId); if (!c) return;
  const voice = p.clips.some(x => trackOf(p, x.trackId)?.voice && !x.muted);
  const target = voice ? p.settings.mix?.musicTarget ?? -26 : -18;
  try {
    const r = await api('/api/tools/loudness', { mediaId: c.mediaId, from: c.in, to: c.in + Math.min(c.duration, 90) * (c.speed || 1), clip: c });
    if (r.lufs === null) return;
    let g = Math.pow(10, (target - r.lufs) / 20); if (Number.isFinite(r.peak)) g = Math.min(g, Math.pow(10, (-1 - r.peak) / 20) * 2);
    g = Math.max(0.05, Math.min(4, g));
    commit('Auto balance music', d => { const x = d.clips.find(k => k.id === clipId); if (x) x.volume = +g.toFixed(3); });
    toast(`Balanced to ${target} LUFS${voice ? ' so your voice stays clear' : ''}.`);
  } catch (e) { toast('Auto balance could not measure this track: ' + e.message, 'warn'); }
}
export const clipsUsing = id => project.value?.clips.filter(c => c.mediaId === id).length || 0;
export const endOf = c => clipEnd(c);
