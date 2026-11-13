// Creative Library client: search state that survives panel switches, debounced and cancellable
// queries, audio previews on the chosen output device, rights-checked imports and timeline inserts.
import { signal, effect } from '@preact/signals';
import { api, waitJob, native } from './api.js';
import { project, commit, time, toast, media, asset, player, refreshMedia, prefs, playing } from './state.js';
import { newClip, projectDuration } from '../../shared/model.mjs';
import { assessRights, recordAttribution } from '../../shared/rights.mjs';
import { addTrack, trackOf, overlaps } from './edit.js';
import { activeOutput } from '../audio/devices.js';
import { shortTime } from './format.js';

export const audioTab = signal('discover'); // discover | music | sfx | favorites | recent | mine
export const sfxSection = signal('effects'); // effects | memes
export const stickerTab = signal('discover'); // discover | animated | static | mine
export const libStatus = signal(null);
export const busyKeys = signal(new Map()); // key -> progress 0..1 (or null = indeterminate)
export const selectedRecord = signal(null); // detail drawer

const blank = () => ({ q: '', length: '', source: '', category: '', collection: '', lens: '', browseQuery: '', browseTitle: '', browseAll: false, sort: 'relevance', results: [], page: 0, pages: 0, total: 0, status: 'idle', error: null, scroll: 0 });
export const searches = { music: signal(blank()), sfx: signal(blank()), memes: signal({ ...blank(), collection: 'popular' }), fluent: signal(blank()), stickers: signal(blank()) };
// Music, sound effects and the sticker search ask every free source at once ('all'); the server merges
// them. The Animated tab browses Fluent Emoji only. Picking a source in the filter narrows to it.
const PROVIDER = { music: 'all', sfx: 'all', memes: 'myinstants', fluent: 'fluent', stickers: 'all' };
const KIND = { music: 'music', sfx: 'sfx', memes: 'sfx', fluent: 'sticker', stickers: 'sticker' };
const OWN_SOURCES = ['incompetech', 'ccmixter', 'sfxkit', 'sfxmint', 'archive', 'pixabay', 'openverse', 'fluent']; // source filter values that are whole providers
// Category browsing (no search words) is answered by the source that owns the categories.
const CATEGORY_PROVIDER = { sfx: 'sfxkit', fluent: 'fluent' };

// Which licenses the music views show. The default includes music that asks for a credit (CC BY): that is where
// almost all finished music is, and FrameCut writes the credit and checks it again at export. Sound effects stay
// on "no credit needed", where the choice is already wide. The user's pick is remembered.
export function includeFor(panel, cur = searches[panel]?.value) {
  if (cur?.include) return cur.include;
  if (panel !== 'music') return 'free';
  try { const v = localStorage.getItem('fc:music-include'); if (['free', 'credit', 'all'].includes(v)) return v; } catch {}
  return 'credit';
}
export function setMusicInclude(v, patch = {}) { try { localStorage.setItem('fc:music-include', v); } catch {} search('music', { include: v, ...patch }, { now: true }); }
export const usageMode = () => (project.value?.usageMode === 'personal' ? 'personal' : 'commercial');
export function setUsageMode(mode) {
  commit('Usage: ' + (mode === 'personal' ? 'personal' : 'commercial'), p => { p.usageMode = mode; });
  for (const k of ['music', 'sfx', 'stickers']) if (searches[k].value.results.length || searches[k].value.q) search(k, {}, { now: true });
}
export const rightsOf = rec => assessRights({ provider: rec.provider, license: rec.license, licenseVersion: rec.licenseVersion, kind: rec.kind, usage: usageMode(), verification: rec.licenseRecord || rec.licenseCheck || null });

export async function loadStatus() { try { libStatus.value = await api('/api/creative/status'); } catch {} return libStatus.value; }

// ----- search -----
const timers = {}, controllers = {}, retries = {}, revisions = {};
export function search(panel, patch = {}, { now = false, more = false } = {}) {
  const s = searches[panel];
  if (more && ['loading', 'more'].includes(s.value.status)) return;
  // Invalidate at the keystroke, before the debounce: an older response must never
  // populate a new query, including when the user clears it or types one character.
  controllers[panel]?.abort(); clearTimeout(retries[panel]);
  const revision = revisions[panel] = (revisions[panel] || 0) + 1;
  s.value = { ...s.value, ...patch, ...(!more ? { status: 'loading', error: null } : {}) };
  clearTimeout(timers[panel]);
  const go = () => runSearch(panel, more, false, revision);
  if (now || more) go(); else timers[panel] = setTimeout(go, 420);
}
async function runSearch(panel, more, retried = false, revision = revisions[panel]) {
  if (revision !== revisions[panel]) return;
  const s = searches[panel], cur = s.value;
  const q = cur.q.trim();
  const stickerBrowse = panel === 'stickers';
  const audioBrowse = panel === 'music' || panel === 'sfx' || panel === 'memes';
  const browsing = stickerBrowse || audioBrowse || (!q && cur.category && CATEGORY_PROVIDER[panel]);
  if (panel !== 'fluent' && ((!q && !browsing) || (!stickerBrowse && q && q.length < 2))) { s.value = { ...cur, results: [], status: 'idle', error: null, total: 0, page: 0, pages: 0, partial: [], sources: [] }; return; }
  controllers[panel]?.abort(); const ctl = new AbortController(); controllers[panel] = ctl;
  const page = more ? cur.page + 1 : 1;
  s.value = { ...cur, status: more ? 'more' : 'loading', error: null };
  const own = OWN_SOURCES.includes(cur.source);
  const shelf = /^fx:/.test(cur.category); // a sound-effect category that every source helps fill
  const provider = panel === 'memes' ? 'myinstants' : stickerBrowse && !cur.source ? 'fluent' : own ? cur.source : shelf ? 'all' : cur.category && CATEGORY_PROVIDER[panel] ? CATEGORY_PROVIDER[panel] : cur.source ? 'openverse' : PROVIDER[panel];
  const effectiveQuery = q || (panel === 'music' ? cur.browseAll ? '' : cur.browseQuery || '' : panel === 'sfx' && !cur.category && !['sfxkit', 'sfxmint'].includes(cur.source) ? cur.browseQuery || 'whoosh' : '');
  const params = new URLSearchParams({ provider, kind: KIND[panel], q: effectiveQuery, page: String(page), usage: usageMode(), include: includeFor(panel, cur), length: cur.length, source: own ? '' : cur.source, category: cur.category, ...(panel === 'music' && !q && !cur.browseAll && cur.lens ? { lens: cur.lens } : {}), ...(stickerBrowse || panel === 'memes' ? { collection: cur.collection } : {}), ...(audioBrowse && provider === 'all' ? { deadline: '4000' } : {}) });
  try {
    const r = await fetch('/api/creative/search?' + params, { signal: ctl.signal }); const d = await r.json();
    if (!r.ok) throw Object.assign(Error(d.error), { code: d.code, retryAfter: d.retryAfter });
    if (ctl.signal.aborted || revision !== revisions[panel]) return;
    const seen = new Set(more ? s.value.results.map(x => x.key) : []);
    const items = (more ? s.value.results : []).concat(d.items.filter(x => !seen.has(x.key)));
    s.value = { ...s.value, results: items, page: d.page, pages: d.pages, total: d.total, capped: !!d.capped, status: items.length ? 'ok' : 'empty', error: null, sources: d.sources || [{ provider: d.provider || provider, total: d.total }], partial: d.partial || [] };
    if (panel !== 'fluent' && q) rememberSearch(panel, q);
    // A slow source keeps working in the background and caches its answer: ask once more so it fills in.
    if (!more && !retried && d.partial?.some(p => p.code === 'slow')) retries[panel] = setTimeout(() => { if (revision === revisions[panel] && s.value.page <= 1) runSearch(panel, false, true, revision); }, 7000);
  } catch (e) {
    if (ctl.signal.aborted || revision !== revisions[panel] || e.name === 'AbortError') return;
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
// One shared preview player for every library list. Clicking the playing item pauses it; clicking it
// again resumes from the same spot. `previewTime` ticks every frame while playing, kept apart from
// `preview` so only the progress ring and the bar re-render, not every row in the list.
export const preview = signal({ key: null, state: 'idle', d: 0, title: '' }); // state: idle | loading | playing | paused
export const previewTime = signal(0);
let audioEl = null, recordingCheck = () => false, raf = 0;
export const setRecordingCheck = fn => { recordingCheck = fn; };
const tick = () => { cancelAnimationFrame(raf); if (!audioEl || audioEl.paused || !preview.value.key) return; previewTime.value = audioEl.currentTime; raf = requestAnimationFrame(tick); };
const patch = x => { if (preview.value.key) preview.value = { ...preview.value, ...x }; };
export function stopPreview() { cancelAnimationFrame(raf); clearTimeout(watchdog); previewRec = null; if (audioEl) { audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); } preview.value = { key: null, state: 'idle', d: 0, title: '' }; previewTime.value = 0; }
export function pausePreview() { if (audioEl && preview.value.key && !audioEl.paused) audioEl.pause(); }
const previewUrl = rec => `/api/creative/preview/${rec.provider}/${encodeURIComponent(rec.sourceId)}`;
// The player gave up on a preview. Formats it cannot decode (or that the source labels wrongly) are tried once
// more as MP3, converted by FrameCut; if that fails too, the message says what actually went wrong.
const DEAD_CODES = ['gone', 'forbidden', 'type', 'corrupt'];
let previewRec = null, watchdog = 0;
// A preview that shows "loading" with nothing arriving for this long is treated as failed instead of spinning on.
const armWatchdog = () => { clearTimeout(watchdog); watchdog = setTimeout(() => { if (preview.value.key && preview.value.state === 'loading') previewFailed({ stalled: true }); }, 30000); };
async function previewFailed({ stalled = false } = {}) {
  clearTimeout(watchdog);
  const key = preview.value.key, rec = previewRec, src = audioEl.getAttribute('src') || ''; if (!key) return;
  const proxied = rec?.provider && rec.sourceId ? previewUrl(rec) : null;
  if (!stalled) {
    // Played straight from its source (a direct address) and that failed: fetch it through FrameCut instead.
    if (proxied && !src.startsWith('/api/creative/preview/') && src === rec.previewUrl) { patch({ state: 'loading' }); audioEl.src = proxied; armWatchdog(); audioEl.play().catch(() => {}); return; }
    // Formats the player cannot decode (or that the source labels wrongly) are tried once more as MP3.
    if (src.startsWith('/api/creative/preview/') && !src.includes('as=mp3')) { patch({ state: 'loading' }); audioEl.src = src + (src.includes('?') ? '&' : '?') + 'as=mp3'; armWatchdog(); audioEl.play().catch(() => {}); return; }
  }
  const title = `“${preview.value.title || 'This preview'}”`;
  let message = stalled ? `${title} is taking too long to start. Its source is slow or not answering right now; try again in a moment.` : `${title} can’t be played right now. The file may be unavailable.`, code = null;
  // Ask FrameCut why: the answer says what happened at the source (gone, refused, rate limit, offline) and what to do.
  if (!stalled && src.startsWith('/api/creative/preview/')) try {
    const ctl = new AbortController(), r = await fetch(src.replace(/[?&]as=mp3/, ''), { signal: ctl.signal });
    if (!r.ok) { const d = await r.json().catch(() => null); message = d?.error || message; code = d?.code || null; }
    else { ctl.abort(); message = `${title} is in a format the preview player can’t play. You can still add it to the timeline.`; }
  } catch { if (navigator.onLine === false) message = `${title} can’t be played: you appear to be offline.`; }
  if (DEAD_CODES.includes(code)) markUnavailable(key, message);
  if (preview.value.key !== key) return;
  toast(message, 'warn', { timeout: 9000 }); stopPreview();
}
// An item whose file is gone or refused is greyed out wherever it is listed, with the reason, so it isn't tried again.
function markUnavailable(key, message) {
  const flag = x => (x.key === key ? { ...x, unavailable: message } : x);
  for (const k of Object.keys(searches)) { const s = searches[k]; if (s.value.results.some(x => x.key === key)) s.value = { ...s.value, results: s.value.results.map(flag) }; }
  const l = lists.value; lists.value = { audio: { favorites: l.audio.favorites.map(flag), recents: l.audio.recents.map(flag) }, sticker: { favorites: l.sticker.favorites.map(flag), recents: l.sticker.recents.map(flag) } };
  if (selectedRecord.value?.key === key) selectedRecord.value = { ...selectedRecord.value, unavailable: message };
}
// Pointing at a result starts fetching its preview, so the click that follows plays almost at once.
let warmTimer, warmed = new Set();
export function warmPreview(rec, delay = 160) {
  clearTimeout(warmTimer);
  if (!rec || rec.url || rec.previewUrl || rec.imported || !rec.provider || warmed.has(rec.key) || preview.value.key === rec.key) return;
  warmTimer = setTimeout(() => { if (warmed.size > 400) warmed = new Set(); warmed.add(rec.key); api('/api/creative/warm-preview', { provider: rec.provider, id: rec.sourceId }).catch(() => {}); }, delay);
}
// rec: a library record, or { key, url, title, durationMs } for a file that is already local.
export async function togglePreview(rec) {
  if (preview.value.key === rec.key && audioEl) {
    if (preview.value.state === 'paused') { if (recordingCheck()) return toast('Previews are paused while you record, so nothing leaks into your microphone.', 'warn'); player.current?.pause(); audioEl.play().catch(() => {}); }
    else if (preview.value.state === 'loading') stopPreview();
    else pausePreview();
    return;
  }
  if (recordingCheck()) return toast('Previews are paused while you record, so nothing leaks into your microphone.', 'warn');
  if (rec.unavailable) return toast(rec.unavailable, 'warn', { timeout: 8000 });
  if (!audioEl) {
    audioEl = new Audio(); audioEl.preload = 'auto';
    audioEl.addEventListener('loadedmetadata', () => { if (Number.isFinite(audioEl.duration)) patch({ d: audioEl.duration }); });
    audioEl.addEventListener('playing', () => { clearTimeout(watchdog); patch({ state: 'playing' }); tick(); });
    audioEl.addEventListener('progress', () => { if (preview.value.state === 'loading') armWatchdog(); });
    audioEl.addEventListener('pause', () => { if (preview.value.key && audioEl.getAttribute('src')) { patch({ state: 'paused' }); previewTime.value = audioEl.currentTime; } });
    audioEl.addEventListener('waiting', () => { patch({ state: 'loading' }); armWatchdog(); });
    audioEl.addEventListener('seeked', () => { previewTime.value = audioEl.currentTime; });
    audioEl.addEventListener('ended', stopPreview);
    audioEl.addEventListener('error', () => previewFailed());
  }
  player.current?.pause();
  audioEl.pause();
  audioEl.removeAttribute('src'); audioEl.load();
  const key = rec.key;
  preview.value = { key, state: 'loading', d: (rec.durationMs || 0) / 1000, title: rec.title || '' }; previewTime.value = 0; previewRec = rec; armWatchdog();
  const sink = activeOutput.value && activeOutput.value !== 'default' ? activeOutput.value : '';
  if (audioEl.setSinkId) await audioEl.setSinkId(sink).catch(() => {});
  if (preview.value.key !== key) return; // another item was clicked while switching outputs
  if (recordingCheck() || playing.value) { stopPreview(); return; }
  audioEl.volume = Math.min(1, Math.max(0, prefs.value.libraryPreviewVolume ?? 0.8));
  audioEl.src = rec.url || (rec.imported && asset(rec.imported) ? asset(rec.imported).url : rec.previewUrl || previewUrl(rec));
  // A file the player cannot load is reported through its 'error' event (previewFailed), which retries as MP3.
  audioEl.play().catch(e => { if (preview.value.key === key && e.name !== 'AbortError' && e.name !== 'NotSupportedError') { toast('Preview failed to start: ' + e.message, 'warn'); stopPreview(); } });
}
// Starting the timeline pauses a preview, so two things never play over each other.
effect(() => { if (playing.value) pausePreview(); });
effect(() => { const sink = activeOutput.value; if (audioEl?.setSinkId) audioEl.setSinkId(sink && sink !== 'default' ? sink : '').catch(() => {}); });
export function setPreviewVolume(v) { if (audioEl && Number.isFinite(v)) audioEl.volume = Math.max(0, Math.min(1, v)); }
export function seekPreview(frac) { if (Number.isFinite(audioEl?.duration) && Number.isFinite(frac)) { audioEl.currentTime = Math.max(0, Math.min(1, frac)) * audioEl.duration; previewTime.value = audioEl.currentTime; } }

// ----- import + insert -----
const setBusy = (key, v) => { const m = new Map(busyKeys.value); if (v === undefined) m.delete(key); else m.set(key, v); busyKeys.value = m; };
export async function obtain(rec) {
  if (rec.imported && asset(rec.imported) && !asset(rec.imported).missing) return asset(rec.imported);
  const r = rights(rec);
  if (r.blocked) { toast(r.summary + (r.badge === 'Non-commercial' ? ' Switch the project to personal use if this is a non-commercial video.' : ''), 'warn', { timeout: 9000 }); return null; }
  if (rec.unavailable) { toast(rec.unavailable, 'warn', { timeout: 9000 }); return null; }
  if (busyKeys.value.has(rec.key)) return null;
  setBusy(rec.key, null); let last = null;
  // Adding from the library downloads the file first; say so, since a long track can take a moment.
  toast(`Downloading “${rec.title}”… it is added as soon as it arrives.`, 'info', { timeout: 3500 });
  try {
    const res = await api('/api/creative/import', { provider: rec.provider, id: rec.sourceId, kind: rec.kind, usage: usageMode(), ...(rec.provider === 'myinstants' ? { acknowledgeUnknownRights: true } : {}) });
    const out = res.asset || (await waitJob(res.job, (p, _message, job) => { setBusy(rec.key, p); last = job; })).asset;
    const m = new Map(media.value); m.set(out.id, out); media.value = m;
    markImported(rec.key, out.id); loadLists();
    return out;
  } catch (e) {
    // A failed job ends with a full sentence from FrameCut (what happened, what to do) and a reason code.
    const failure = last?.status === 'failed' ? last.meta?.failure : null;
    if (failure?.dead) markUnavailable(rec.key, e.message);
    if (!e.cancelled) toast(failure ? e.message : friendly(e, rec), failure?.code === 'quota' ? 'warn' : 'error', { timeout: 10000 });
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
    recordAttribution(p, a.id, a.source); // license record travels with the project
  }, { select: [c.id] });
  toast(`Added “${name}” to ${trackName} at ${shortTime(at)} · ${shortTime(duration)}${duration < a.duration - 0.05 ? ` (trimmed to fit, fades out)` : ''}. Ctrl+Z to undo.`);
  return c.id;
}
// Stickers go on a free overlay (text) track, centered, looping when animated.
export function insertSticker(a, { at = time.value, pos } = {}) {
  const duration = a.kind === 'video' ? Math.max(3, Math.min(8, a.duration || 3)) : 3;
  const name = (a.source?.title || a.name).replace(/\s*\(sticker\)$/, '').replace(/\.[^.]+$/, '');
  const c = newClip('sticker', { sticker: { type: 'media' }, mediaId: a.id, in: 0, speed: 1, loop: true, start: at, duration, name, transform: { scale: 1, ...(pos ? { x: pos.x, y: pos.y } : {}) } });
  let trackName = '';
  commit('Add sticker', p => {
    const t = p.tracks.find(t => t.kind === 'text' && !t.captions && !t.locked && !overlaps(p, t.id, at, at + duration)) || addTrack(p, 'text');
    c.trackId = t.id; trackName = t.name; p.clips.push(c); if (!p.mediaIds.includes(a.id)) p.mediaIds.push(a.id);
    recordAttribution(p, a.id, a.source);
  }, { select: [c.id] });
  toast(`Added “${name}” sticker at ${shortTime(at)} for ${shortTime(duration)}${a.animated ? ', looping' : ''}. Drag its corners in the player to resize. Ctrl+Z to undo.`);
  return c.id;
}
// One entry point for clicks, Enter and drops.
export async function useRecord(rec, { at = time.value, trackId, pos } = {}) {
  const projectId = project.value?.id; if (!projectId) return null;
  const a = await obtain(rec); if (!a) return null;
  if (project.value?.id !== projectId) { toast('Download saved to the library. Open the intended project to add it.', 'info'); return null; }
  return rec.kind === 'sticker' ? insertSticker(a, { at, pos }) : insertAudio(a, rec.kind, { at, trackId });
}
// Drag payload understood by the timeline and the player (see Timeline.jsx / Preview.jsx).
export function dragRecord(e, rec) {
  const data = { type: 'library', key: rec.key, duration: rec.kind === 'sticker' ? 3 : (rec.durationMs || 3000) / 1000, drop: ({ at, track, pos } = {}) => useRecord(rec, { at: at ?? time.value, trackId: track?.id, pos }) };
  e.dataTransfer.setData('application/x-framecut', JSON.stringify({ type: 'library', key: rec.key })); e.dataTransfer.effectAllowed = 'copy'; window.__fcDrag = data;
}
export function dragAsset(e, a, kind) {
  const data = { type: 'library', duration: kind === 'sticker' ? 3 : a.duration, drop: ({ at, track, pos } = {}) => (kind === 'sticker' ? insertSticker(a, { at: at ?? time.value, pos }) : insertAudio(a, kind, { at: at ?? time.value, trackId: track?.id })) };
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
  const p = project.value; const c = p?.clips.find(x => x.id === clipId); if (!c) return;
  const voice = p.clips.some(x => trackOf(p, x.trackId)?.voice && !x.muted);
  const target = voice ? p.settings.mix?.musicTarget ?? -26 : -18;
  try {
    const r = await api('/api/tools/loudness', { mediaId: c.mediaId, from: c.in, to: c.in + Math.min(c.duration, 90) * (c.speed || 1), clip: c });
    if (project.value?.id !== p.id || !project.value.clips.some(x => x.id === clipId)) return;
    if (!Number.isFinite(r.lufs)) return toast('This track has no measurable audio to balance.', 'warn');
    let g = Math.pow(10, (target - r.lufs) / 20); if (Number.isFinite(r.peak)) g = Math.min(g, Math.pow(10, (-1 - r.peak) / 20) * 2);
    g = Math.max(0.05, Math.min(4, g));
    commit('Auto balance music', d => { const x = d.clips.find(k => k.id === clipId); if (x) x.volume = +g.toFixed(3); });
    toast(`Balanced to ${target} LUFS${voice ? ' so your voice stays clear' : ''}.`);
  } catch (e) { toast('Auto balance could not measure this track: ' + e.message, 'warn'); }
}
