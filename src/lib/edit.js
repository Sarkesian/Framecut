// Editing commands. Each runs inside commit(), so everything is undoable and autosaved.
import { shiftKeys } from '../../shared/keys.mjs';
import { spanTo } from '../../shared/snap.mjs';
import { newClip, uid, clipEnd, srcOut, trackClips, mainTrack, transitionPartner, maxTransition, hasMedia, trackKindFor, clipSpeed, clampTrackIndex } from '../../shared/model.mjs';
import { CAPTION_STYLE, TEXT_STYLE, effectDef } from '../../shared/catalog.mjs';
import { commit, project, selection, time, asset, toast, player, transitionSel } from './state.js';
import { ui } from './uiprefs.js';

const EPS = 1e-4;
const KIND_NAMES = { video: 'Video', audio: 'Audio', text: 'Text', effect: 'Effects' };
export const trackOf = (p, id) => p.tracks.find(t => t.id === id);
export const overlaps = (p, trackId, start, end, ignore = new Set()) => p.clips.some(c => c.trackId === trackId && !ignore.has(c.id) && c.start < end - EPS && clipEnd(c) > start + EPS);

export function addTrack(p, kind, { above } = {}) {
  const n = p.tracks.filter(t => t.kind === kind).length + 1;
  const t = { id: kind + '-' + uid().slice(0, 8), kind, name: `${KIND_NAMES[kind]} ${n}` };
  let at;
  if (above) at = p.tracks.findIndex(x => x.id === above);
  else if (kind === 'effect') at = 0;
  else if (kind === 'text') at = p.tracks.findIndex(x => x.kind === 'text' || x.kind === 'video');
  else if (kind === 'video') at = p.tracks.findIndex(x => x.kind === 'video');
  else at = p.tracks.length;
  p.tracks.splice(Math.max(0, at), 0, t); return t;
}
// A new track at an exact position in the stack (0 = top layer). Tracks made this way go away again when
// they end up empty.
export function insertTrack(p, kind, index) {
  const t = addTrack(p, kind); p.tracks.splice(p.tracks.indexOf(t), 1);
  t.autoRemove = true; p.tracks.splice(Math.max(0, Math.min(p.tracks.length, clampTrackIndex(p, kind, index))), 0, t); return t;
}
// Remove tracks an edit just emptied: the given tracks (where clips were taken from) and any auto-made
// track. The main track, caption tracks and locked tracks always stay.
export function pruneTracks(p, emptied = []) {
  const from = new Set(emptied);
  p.tracks = p.tracks.filter(t => t.main || t.captions || t.locked || p.clips.some(c => c.trackId === t.id) || !(t.autoRemove || from.has(t.id)));
}
// Main stays put (it is the boundary); other tracks move within their band (see clampTrackIndex).
export function moveTrack(p, id, index) {
  const i = p.tracks.findIndex(t => t.id === id); if (i < 0 || p.tracks[i].main) return false;
  index = clampTrackIndex(p, p.tracks[i].kind, index);
  const [t] = p.tracks.splice(i, 1); const at = index > i ? index - 1 : index;
  if (at === i) { p.tracks.splice(i, 0, t); return false; }
  p.tracks.splice(Math.max(0, Math.min(p.tracks.length, at)), 0, t);
}
// A track of `kind` with room for [start, end), creating one if needed.
export function freeTrack(p, kind, start, end, { prefer, ignore = new Set(), allowMain = false } = {}) {
  const candidates = p.tracks.filter(t => t.kind === kind && !t.locked && (allowMain || !t.main));
  if (prefer) { const t = trackOf(p, prefer); if (t && t.kind === kind && !t.locked && !overlaps(p, t.id, start, end, ignore)) return t; }
  for (const t of kind === 'audio' ? candidates : [...candidates].reverse()) if (!overlaps(p, t.id, start, end, ignore)) return t;
  return addTrack(p, kind);
}
const defaultName = a => a?.name?.replace(/\.[^.]+$/, '') || 'Clip';

export function clipForAsset(a, props = {}) {
  const kind = a.kind === 'image' ? 'image' : a.kind === 'audio' ? 'audio' : 'video';
  return newClip(kind, { mediaId: a.id, name: defaultName(a), duration: kind === 'image' ? 5 : a.duration, in: 0, ...props });
}

// Insert media at the playhead (main track for visuals, a free audio track for sound).
export function addAssets(assets, { at = time.value, trackId, overlay = false } = {}) {
  if (!assets.length) return;
  const ids = []; let endAt = null;
  commit(assets.length > 1 ? `Add ${assets.length} clips` : 'Add clip', p => {
    const main = mainTrack(p);
    const toMain = a => a.kind !== 'audio' && !overlay && !(trackId && !trackOf(p, trackId)?.main);
    const mainLen = assets.filter(toMain).reduce((s, a) => s + (a.kind === 'image' ? 5 : a.duration), 0);
    // On the magnetic main track, insert at the nearest cut to the playhead and push later clips right.
    const mains = trackClips(p, main.id);
    const under = mains.find(c => at >= c.start && at < clipEnd(c));
    let cursor = under ? (at - under.start < under.duration / 2 ? under.start : clipEnd(under)) : mains.length ? clipEnd(mains.at(-1)) : 0;
    if (mainLen) for (const c of mains) if (c.start >= cursor - EPS) c.start += mainLen;
    for (const a of assets) {
      const c = clipForAsset(a);
      if (a.kind === 'audio') { const t = freeTrack(p, 'audio', at, at + c.duration, { prefer: trackId }); c.trackId = t.id; c.start = at; }
      else if (!toMain(a)) { const t = freeTrack(p, 'video', at, at + c.duration, { prefer: trackId }); c.trackId = t.id; c.start = at; if (overlay) c.transform.scale = 0.5; }
      else { c.trackId = main.id; c.start = cursor; cursor += c.duration; }
      if (!p.mediaIds.includes(a.id)) p.mediaIds.push(a.id);
      p.clips.push(c); ids.push(c.id);
    }
    endAt = cursor;
  }, { select: ids });
  if (endAt !== null && assets.some(a => a.kind !== 'audio') && !overlay && !trackId) player.current?.seek(endAt);
  return ids;
}
export function addText({ text = 'Your text', style = {}, at = time.value, duration = 3, anim, transform } = {}) {
  const c = newClip('text', { text, style: { ...TEXT_STYLE, ...style }, start: at, duration, name: text.slice(0, 40), ...(transform ? { transform } : {}) });
  if (anim?.in) c.animIn = anim.in; if (anim?.out) c.animOut = anim.out; if (anim?.loop) c.animLoop = anim.loop;
  commit('Add text', p => { c.trackId = freeTrack(p, 'text', at, at + duration, { ignore: new Set() }).id; if (trackOf(p, c.trackId).captions) c.trackId = addTrack(p, 'text').id; p.clips.push(c); }, { select: [c.id] });
  return c.id;
}
// New stickers are visible on the frame you drop them on (no automatic entrance animation; add one in
// Animation), placed where they were dropped on the player when a position is given.
export function addSticker(sticker, { at = time.value, duration = 3, pos } = {}) {
  const c = newClip('sticker', { sticker, start: at, duration, name: sticker.type === 'emoji' ? sticker.value : sticker.name || 'Sticker', transform: { scale: 1, ...(pos ? { x: pos.x, y: pos.y } : {}) } });
  delete c.sticker.name;
  commit('Add sticker', p => { const t = p.tracks.find(t => t.kind === 'text' && !t.captions && !t.locked && !overlaps(p, t.id, at, at + duration)) || addTrack(p, 'text'); c.trackId = t.id; p.clips.push(c); }, { select: [c.id] });
}
export function addAdjustment({ effects = [], filter = null, name = 'Adjustment', at = time.value, duration } = {}) {
  const p0 = project.value; const end = Math.max(...p0.clips.map(clipEnd), at + 3);
  const d = duration || Math.max(1, Math.min(5, end - at));
  const c = newClip('adjust', { name, start: at, duration: d, effects, filter: filter || { id: null, intensity: 1 } });
  commit('Add ' + name.toLowerCase(), p => { c.trackId = freeTrack(p, 'effect', at, at + d).id; p.clips.push(c); }, { select: [c.id] });
}

// Apply to selected visual clips; if none, add as an adjustment layer at the playhead.
export function applyEffect(id) {
  const def = effectDef(id); const targets = selectedClips().filter(c => c.kind !== 'audio');
  const params = Object.fromEntries(def.params.map(x => [x.key, x.value]));
  if (!targets.length) { if (def.clipOnly) return toast('Select a clip to add camera shake.', 'warn'); return addAdjustment({ name: def.name, effects: [{ id, ...params }] }); }
  commit('Add ' + def.name, p => { for (const c of p.clips) if (targets.some(t => t.id === c.id)) { c.effects = (c.effects || []).filter(e => e.id !== id); c.effects.push({ id, ...params }); } });
}
// Filter layers (adjustment clips that only carry a filter) covering time t.
export const filterLayersAt = (p, t) => p.clips.filter(c => c.kind === 'adjust' && c.filter?.id && !(c.effects || []).length && c.start <= t + 1e-3 && clipEnd(c) > t);
export function applyFilter(id, name) {
  const targets = selectedClips().filter(c => c.kind !== 'audio' && c.kind !== 'text');
  if (!targets.length) {
    // Trying one filter after another swaps the filter layer under the playhead instead of piling up a new layer per click.
    const layer = filterLayersAt(project.value, time.value).at(-1);
    if (!layer) return addAdjustment({ name: name + ' filter', filter: { id, intensity: 1 } });
    return commit('Apply ' + name, p => { const c = p.clips.find(x => x.id === layer.id); c.filter = { id, intensity: c.filter?.intensity ?? 1 }; c.name = name + ' filter'; }, { select: [layer.id] });
  }
  commit('Apply ' + name, p => { for (const c of p.clips) if (targets.some(t => t.id === c.id)) c.filter = { id, intensity: c.filter?.intensity ?? 1 }; });
}
// Takes the filter off the selected clips. A filter layer is removed altogether (an empty layer does nothing),
// and with nothing selected every filter layer under the playhead goes, so no earlier one shows through.
export function removeFilter() {
  const p0 = project.value, sel = selectedClips().filter(c => c.kind !== 'audio' && c.kind !== 'text' && c.filter?.id);
  const ids = (sel.length ? sel : filterLayersAt(p0, time.value)).map(c => c.id); if (!ids.length) return;
  commit('Remove filter', p => {
    const gone = new Set();
    for (const c of p.clips) if (ids.includes(c.id)) { if (c.kind === 'adjust' && !(c.effects || []).length) gone.add(c.id); else c.filter = { id: null, intensity: 1 }; }
    if (!gone.size) return;
    const tracks = new Set(p.clips.filter(c => gone.has(c.id)).map(c => c.trackId));
    p.clips = p.clips.filter(c => !gone.has(c.id));
    p.tracks = p.tracks.filter(t => !(t.kind === 'effect' && tracks.has(t.id) && !p.clips.some(c => c.trackId === t.id)));
  });
}
// Transition at the start of `clipId`, or at the cut nearest the playhead on the main track.
export function applyTransition(id, clipId) {
  const p0 = project.value; let target = clipId ? p0.clips.find(c => c.id === clipId) : null;
  if (!target || !transitionPartner(p0, target)) {
    const sel = primarySel();
    if (sel && transitionPartner(p0, sel)) target = sel;
    else { const main = trackClips(p0, mainTrack(p0).id); target = main.slice(1).sort((a, b) => Math.abs(a.start - time.value) - Math.abs(b.start - time.value))[0]; }
  }
  if (!target || !transitionPartner(p0, target)) return toast('Transitions go between two touching clips. Put two clips next to each other first.', 'warn');
  // Changing the type keeps any timing / look settings already made; the new transition opens in the panel.
  commit('Add transition', p => { const c = p.clips.find(x => x.id === target.id); c.transition = { ...(c.transition || {}), id, duration: c.transition?.duration || Math.min(0.6, maxTransition(p, c)) }; }, { select: [] });
  selectTransition(target.id);
}
export function selectTransition(clipId) { selection.value = []; transitionSel.value = clipId; }
export function removeTransition(clipId) {
  updateClip(clipId, x => { if (!x.transition) return false; x.transition = null; }, { label: 'Remove transition' });
  if (transitionSel.value === clipId) transitionSel.value = null;
}
// Copies a transition (type, length and every setting) to every other cut on the same track.
// Returns how many cuts received it. Lengths are clamped to what each pair of clips allows.
export function transitionToAllCuts(clipId) {
  const src = project.value.clips.find(c => c.id === clipId)?.transition; if (!src) return 0;
  let n = 0;
  commit('Apply transition to all cuts', p => {
    const me = p.clips.find(c => c.id === clipId);
    for (const c of p.clips) if (c !== me && c.trackId === me.trackId && c.kind !== 'audio' && c.kind !== 'adjust' && transitionPartner(p, c)) { c.transition = { ...structuredClone(src), duration: Math.min(src.duration || 0.6, maxTransition(p, c)) }; n++; }
    if (!n) return false;
  });
  return n;
}

export const selectedClips = () => { const p = project.value; return p ? p.clips.filter(c => selection.value.includes(c.id)) : []; };
const primarySel = () => selectedClips()[0];

export function splitAt(t = time.value, ids) {
  const p0 = project.value;
  let targets = (ids || selection.value).map(id => p0.clips.find(c => c.id === id)).filter(c => c && t > c.start + 0.03 && t < clipEnd(c) - 0.03);
  if (!targets.length) targets = p0.clips.filter(c => t > c.start + 0.03 && t < clipEnd(c) - 0.03 && trackOf(p0, c.trackId)?.main);
  if (!targets.length) { const any = p0.clips.filter(c => t > c.start + 0.03 && t < clipEnd(c) - 0.03 && !trackOf(p0, c.trackId)?.locked); targets = any; }
  if (!targets.length) return toast('Move the playhead over a clip to split it.', 'warn');
  // Linked video + separated audio are cut together, so each piece keeps its own sound in sync.
  if (ui.value.linked) for (const c of [...targets]) { const o = partnerOf(p0, c); if (o && !targets.includes(o) && t > o.start + 0.03 && t < clipEnd(o) - 0.03 && !trackOf(p0, o.trackId)?.locked) targets.push(o); }
  const right = [];
  commit('Split', p => {
    const rightOf = new Map();
    for (const t0 of targets) {
      const c = p.clips.find(x => x.id === t0.id); if (!c || trackOf(p, c.trackId)?.locked) continue;
      const r = cutClip(p, c, t - c.start); if (r) { right.push(r.id); rightOf.set(c.id, r); }
    }
    if (!right.length) return false; // nothing unlocked to split: no empty undo entry
    // Left pieces keep their link; right pieces are linked to each other.
    for (const [id, r] of rightOf) { const c = p.clips.find(x => x.id === id); if (c.detachedAudio && rightOf.has(c.detachedAudio)) r.detachedAudio = rightOf.get(c.detachedAudio).id; }
  });
  // Keep the right-hand piece selected (computed after the commit ran) so the Inspector stays open.
  if (right.length) { const p1 = project.value; selection.value = [right.find(id => p1.clips.find(c => c.id === id)?.kind !== 'audio') || right[0]]; }
}
// Split clip `c` (inside a commit draft) at clip-local time `local`. Returns the new right-hand clip, or
// null when the cut would leave a piece shorter than 0.03 s. Everything time-based is divided between the
// halves: media in-point, caption words, keyframes, volume envelope. Fades/animations stay on the outer
// edges only, and the separated-audio link stays with the left half.
const MIN_PIECE = 0.03;
export function cutClip(p, c, local) {
  if (!(local > MIN_PIECE && local < c.duration - MIN_PIECE)) return null;
  const r = structuredClone(c); r.id = uid(); r.start = c.start + local; r.duration = c.duration - local; r.transition = null; r.animIn = null;
  delete r.detachedAudio;
  if (hasMedia(c) || c.sticker?.type === 'media') r.in = (c.in || 0) + local * clipSpeed(c);
  if (c.words) { r.words = c.words.filter(w => w.start >= local).map(w => ({ ...w, start: w.start - local, end: w.end - local })); c.words = c.words.filter(w => w.start < local); }
  if (c.keyframes) { shiftKeys(r, local, r.duration); shiftKeys(c, 0, local); }
  if (c.volumeKeys) {
    r.volumeKeys = c.volumeKeys.map(k => ({ ...k, t: k.t - local })).filter(k => k.t >= 0 && k.t <= r.duration);
    c.volumeKeys = c.volumeKeys.filter(k => k.t <= local);
    if (!r.volumeKeys.length) delete r.volumeKeys; if (!c.volumeKeys.length) delete c.volumeKeys;
  }
  if (c.duckKeys) { delete c.duckKeys; delete r.duckKeys; } // automatic ducking is recomputed, not carried over
  c.duration = local; c.animOut = null; c.fadeOut = 0; r.fadeIn = 0;
  p.clips.push(r); return r;
}
// A copy of a clip must not stay linked to (and silenced by) the original's separated audio.
function unlinkCopy(c) { if (c.detachedAudio) { delete c.detachedAudio; c.muted = false; } }
export function deleteClips(ids = selection.value, { ripple = false } = {}) {
  const p0 = project.value; ids = ids.filter(id => { const c = p0.clips.find(x => x.id === id); return c && !trackOf(p0, c.trackId)?.locked; });
  if (!ids.length) return;
  // Deleting a video takes its linked (separated) audio with it. Deleting only the audio leaves the video
  // muted — unmute it to hear its original sound again.
  if (ui.value.linked) for (const id of [...ids]) { const c = p0.clips.find(x => x.id === id); const o = c?.detachedAudio && partnerOf(p0, c); if (o && !ids.includes(o.id) && !trackOf(p0, o.trackId)?.locked) ids.push(o.id); }
  commit(ids.length > 1 ? `Delete ${ids.length} clips` : 'Delete clip', p => {
    const removed = p.clips.filter(c => ids.includes(c.id));
    p.clips = p.clips.filter(c => !ids.includes(c.id));
    for (const c of p.clips) if (c.detachedAudio && !p.clips.some(x => x.id === c.detachedAudio)) delete c.detachedAudio;
    if (ripple) for (const r of removed.sort((a, b) => b.start - a.start)) for (const c of p.clips) if (c.trackId === r.trackId && c.start >= clipEnd(r) - EPS) c.start -= r.duration;
    for (const c of p.clips) if (c.transition && !transitionPartner(p, c)) c.transition = null;
    pruneTracks(p, removed.map(c => c.trackId));
  }, { select: [] });
}
export function duplicateClips(ids = selection.value) {
  const p0 = project.value; const src = p0.clips.filter(c => ids.includes(c.id)); if (!src.length) return;
  const out = [];
  commit('Duplicate', p => {
    for (const s of src) {
      const c = structuredClone(s); c.id = uid(); c.transition = null; unlinkCopy(c);
      const t = trackOf(p, s.trackId);
      if (t.main) { c.start = clipEnd(s) - 1e-3; for (const x of p.clips) if (x.trackId === t.id && x.start >= clipEnd(s) - EPS) x.start += c.duration; c.start = clipEnd(s); }
      else { c.start = clipEnd(s); c.trackId = freeTrack(p, t.kind, c.start, c.start + c.duration, { prefer: t.id }).id; }
      p.clips.push(c); out.push(c.id);
    }
  }, { select: out });
}
let clipboard = null, clipboardBase = 0;
export const hasClipboard = () => !!clipboard?.length;
export function copyClips(ids = selection.value) { const p = project.value; const src = p.clips.filter(c => ids.includes(c.id)); if (!src.length) return false; const base = Math.min(...src.map(c => c.start)); clipboardBase = base; clipboard = src.map(c => ({ ...structuredClone(c), _offset: c.start - base, _kind: trackOf(p, c.trackId)?.kind, _main: !!trackOf(p, c.trackId)?.main })); return true; }
export function cutClips() { if (copyClips()) deleteClips(); }
// Paste at the playhead (default) or, with inPlace, at the time the clips were copied from.
export function pasteClips(at = time.value, { inPlace = false } = {}) {
  if (!clipboard?.length) return toast('Nothing to paste yet. Copy a clip with Ctrl+C.', 'warn');
  if (inPlace) at = clipboardBase;
  const out = [];
  commit('Paste', p => {
    // Make room on the main track once, for all pasted main clips together, so they keep their order.
    const main = mainTrack(p), mainLen = clipboard.filter(s => s._main).reduce((n, s) => n + s.duration, 0);
    // Pasting onto Main with the playhead inside a clip goes in after that clip, never on top of it.
    const under = p.clips.find(x => x.trackId === main.id && x.start < at - EPS && clipEnd(x) > at + EPS);
    const mainStart = under ? clipEnd(under) : at;
    if (mainLen) for (const x of p.clips) if (x.trackId === main.id && x.start >= mainStart - EPS) x.start += mainLen;
    let mainAt = mainStart;
    for (const s of [...clipboard].sort((a, b) => a._offset - b._offset)) {
      const c = structuredClone(s); delete c._offset; delete c._kind; delete c._main; c.id = uid(); c.start = at + s._offset; c.transition = null; unlinkCopy(c);
      if (s._main) { c.trackId = main.id; c.start = mainAt; mainAt += c.duration; }
      else c.trackId = freeTrack(p, s._kind || trackKindFor(c.kind), c.start, c.start + c.duration).id;
      p.clips.push(c); out.push(c.id);
    }
  }, { select: out });
}
// Move a clip; on collision it lands on a free track of the same kind.
export function placeClips(moves, { label = 'Move clip' } = {}) {
  commit(label, p => {
    const ids = new Set(moves.map(m => m.id));
    for (const m of moves) {
      const c = p.clips.find(x => x.id === m.id); if (!c) continue;
      const target = trackOf(p, m.trackId) || trackOf(p, c.trackId);
      if (target.kind !== trackKindFor(c.kind)) continue;
      c.start = Math.max(0, m.start);
      if (target.main) { c.trackId = target.id; c.start = m.mainIndexTime ?? c.start; }
      else c.trackId = overlaps(p, target.id, c.start, c.start + c.duration, ids) ? freeTrack(p, target.kind, c.start, c.start + c.duration, { ignore: ids }).id : target.id;
    }
    // Reorder main track by requested position (magnetic insert)
    const main = mainTrack(p); const mains = p.clips.filter(c => c.trackId === main.id);
    mains.sort((a, b) => a.start - b.start || (ids.has(a.id) ? -1 : 1));
    let t = 0; for (const c of mains) { c.start = t; t += c.duration; }
    for (const c of p.clips) if (c.transition && !transitionPartner(p, c)) c.transition = null;
  });
}
// Where an edge can go: media clips can't reveal source before 0 or past the file's end; every clip keeps ≥ 0.05 s.
// An edge also can't be stretched over the neighbouring clip on its track — unless ripple is on (later clips
// make room) or it is the gapless Main track (which re-packs itself).
export function trimLimits(c, a = c.mediaId ? asset(c.mediaId) : null, { p = project.value, ripple = false } = {}) {
  const speed = c.speed || 1, end = clipEnd(c), media = hasMedia(c) && c.kind !== 'image';
  const L = {
    minStart: Math.max(0, media ? c.start - c.in / speed : 0), maxStart: end - 0.05,
    minEnd: c.start + 0.05, maxEnd: media && a ? c.start + (a.duration - c.in) / speed : Infinity,
  };
  const tr = p && trackOf(p, c.trackId);
  if (tr && !(tr.main && p.settings.magnetic)) {
    const others = p.clips.filter(o => o.trackId === c.trackId && o.id !== c.id);
    if (!(ripple && !tr.main)) L.minStart = Math.max(L.minStart, ...others.filter(o => clipEnd(o) <= c.start + EPS).map(clipEnd));
    if (!ripple) L.maxEnd = Math.min(L.maxEnd, ...others.filter(o => o.start >= end - EPS).map(o => o.start));
  }
  return L;
}
// Trim an edge to a new timeline time.
export function trimClip(id, edge, t, { ripple = false, key } = {}) { return trimClips([{ id, edge, t }], { ripple, key: key === undefined ? 'trim:' + id + edge : key }); }
// Trim several edges in one undo entry. Ripple shifts later clips on the same track by the length change.
export function trimClips(list, { ripple = false, key = null, label = 'Trim' } = {}) {
  commit(list.length > 1 ? label + ' clips' : label, p => {
    let any = false;
    for (const { id, edge, t } of list) {
      const c = p.clips.find(x => x.id === id); if (!c) continue; any = true;
      const L = trimLimits(c, undefined, { p, ripple }), speed = c.speed || 1, end = clipEnd(c);
      if (edge === 'start') {
        const ns = Math.min(L.maxStart, Math.max(L.minStart, t));
        const d = ns - c.start;
        if (hasMedia(c)) c.in = Math.max(0, c.in + d * speed);
        if (c.keyframes) shiftKeys(c, d, end - ns);
        if (c.words) c.words = c.words.map(w => ({ ...w, start: w.start - d, end: w.end - d })).filter(w => w.end > 0);
        if (c.volumeKeys) { c.volumeKeys = c.volumeKeys.map(k => ({ ...k, t: k.t - d })).filter(k => k.t >= 0 && k.t <= end - ns); if (!c.volumeKeys.length) delete c.volumeKeys; }
        if (ripple && !trackOf(p, c.trackId)?.main) {
          // Ripple: the clip keeps its position and later clips close up (or make room).
          c.duration = end - ns;
          for (const x of p.clips) if (x.trackId === c.trackId && x.id !== c.id && x.start >= end - EPS && !list.some(l => l.id === x.id)) x.start = Math.max(0, x.start - d);
        } else { c.start = ns; c.duration = spanTo(ns, end); }
      } else {
        const ne = Math.max(L.minEnd, Math.min(L.maxEnd, t));
        const delta = ne - end; c.duration = spanTo(c.start, ne);
        if (ripple) for (const x of p.clips) if (x.trackId === c.trackId && x.id !== c.id && x.start >= end - EPS && !list.some(l => l.id === x.id)) x.start += delta;
      }
    }
    if (!any) return false;
    for (const x of p.clips) if (x.transition && !transitionPartner(p, x)) x.transition = null;
  }, { key });
}
// The other half of a video whose sound was separated (kept in sync while linking is on).
export function partnerOf(p, c) {
  if (!c) return null;
  if (c.detachedAudio) return p.clips.find(x => x.id === c.detachedAudio) || null;
  return p.clips.find(x => x.detachedAudio === c.id) || null;
}
export function unlinkClip(id) { commit('Unlink audio', p => { const c = p.clips.find(x => x.id === id); const o = partnerOf(p, c); if (!o) return false; const v = c.detachedAudio ? c : o; delete v.detachedAudio; }); }
// Gaps between clips on a track (and before the first clip), in timeline seconds.
export function trackGaps(p, trackId, min = 1e-3) {
  const out = []; let t = 0;
  for (const c of trackClips(p, trackId)) { if (c.start - t > min) out.push({ start: t, end: c.start }); t = Math.max(t, clipEnd(c)); }
  return out;
}
export function closeGap(trackId, at) {
  commit('Close gap', p => {
    const g = trackGaps(p, trackId).find(x => at >= x.start - EPS && at <= x.end + EPS); if (!g) return false;
    const d = g.end - g.start; for (const c of p.clips) if (c.trackId === trackId && c.start >= g.end - EPS) c.start = Math.max(0, c.start - d);
  });
}
export function setSpeed(id, speed) {
  speed = Number(speed);
  if (!Number.isFinite(speed) || speed < 0.1 || speed > 10) return toast('Choose a playback speed between 0.1× and 10×.', 'warn');
  commit('Change speed', p => {
    const c = p.clips.find(x => x.id === id); if (!c) return false;
    if (c.locked || trackOf(p, c.trackId)?.locked) return false;
    const minimum = Math.max(0.04, 1 / (p.settings.fps || 30));
    if (c.duration * (c.speed || 1) / speed < minimum - 1e-8) { toast('This cut is too short for that speed. Keep at least ' + Math.ceil(minimum * 1000) + ' ms on the timeline.', 'warn'); return false; }
    const srcLen = c.duration * (c.speed || 1), k = (c.speed || 1) / speed, oldEnd = clipEnd(c); c.speed = speed; c.duration = srcLen / speed;
    // On Main, the clips after it make room (or close up) by the change in length, so nothing overlaps.
    if (trackOf(p, c.trackId).main) { const d = clipEnd(c) - oldEnd; for (const x of p.clips) if (x.id !== c.id && x.trackId === c.trackId && x.start >= oldEnd - EPS) x.start += d; }
    if (c.keyframes) for (const p2 of Object.keys(c.keyframes)) c.keyframes[p2] = c.keyframes[p2].map(x => ({ ...x, t: x.t * k }));
    // The volume envelope and caption words are clip-local times too: they follow the new speed.
    if (c.volumeKeys) c.volumeKeys = c.volumeKeys.map(x => ({ ...x, t: x.t * k }));
    if (c.duckKeys) delete c.duckKeys;
    if (!trackOf(p, c.trackId).main) { const ignore = new Set([c.id]); if (overlaps(p, c.trackId, c.start, clipEnd(c), ignore)) c.trackId = freeTrack(p, trackKindFor(c.kind), c.start, clipEnd(c), { ignore }).id; }
  }, { key: 'speed:' + id });
}
export function detachAudio(id) {
  const p0 = project.value; const c = p0.clips.find(x => x.id === id); const a = c && asset(c.mediaId);
  if (!c || c.kind !== 'video' || !a?.audio) return toast('Select a video with sound to separate its audio.', 'warn');
  const nid = uid();
  commit('Separate audio', p => {
    const v = p.clips.find(x => x.id === id);
    const au = newClip('audio', { id: nid, mediaId: v.mediaId, name: v.name + ' audio', start: v.start, duration: v.duration, in: v.in, speed: v.speed, volume: v.volume, fadeIn: v.fadeIn, fadeOut: v.fadeOut, audioFx: structuredClone(v.audioFx) });
    au.trackId = freeTrack(p, 'audio', au.start, clipEnd(au)).id; p.clips.push(au); v.muted = true; v.detachedAudio = nid;
  }, { select: [nid] });
}
// Close every gap on the given tracks (default: all unlocked tracks except captions). Clips keep their
// order and slide left; returns { gaps, tracks } so the UI can say exactly what changed.
export function closeAllGaps({ trackIds } = {}) {
  const p0 = project.value;
  const targets = p0.tracks.filter(t => !t.locked && !t.captions && (!trackIds || trackIds.includes(t.id)));
  let gaps = 0, tracks = 0;
  for (const t of targets) { const n = trackGaps(p0, t.id).length; if (n) { gaps += n; tracks++; } }
  if (!gaps) { toast(trackIds ? 'There are no gaps on that track.' : 'There are no gaps to close.'); return { gaps: 0, tracks: 0 }; }
  commit(gaps > 1 ? 'Close all gaps' : 'Close gap', p => {
    for (const tr of targets) { let t = 0; for (const c of trackClips(p, tr.id)) { if (c.start > t + EPS) c.start = t; t = Math.max(t, clipEnd(c)); } }
    for (const c of p.clips) if (c.transition && !transitionPartner(p, c)) c.transition = null;
  });
  toast(`Closed ${gaps} gap${gaps > 1 ? 's' : ''}${tracks > 1 ? ` on ${tracks} tracks` : ''}. Ctrl+Z to undo.`);
  return { gaps, tracks };
}
// Blade: split the given clips (or every clip under t on unlocked tracks) at time t.
export function bladeCut(t, ids) {
  const p = project.value;
  const under = p.clips.filter(c => t > c.start + 0.03 && t < clipEnd(c) - 0.03 && !trackOf(p, c.trackId)?.locked);
  const targets = ids ? under.filter(c => ids.includes(c.id)) : under;
  if (!targets.length) return toast('Click inside a clip, away from its edges, to cut it.', 'warn');
  splitAt(t, targets.map(c => c.id));
}
export function closeGaps(trackId) {
  commit('Close gaps', p => { let t = 0; for (const c of trackClips(p, trackId)) { c.start = t; t += c.duration; } });
}
export function setTrack(trackId, patch, label = 'Track change') { commit(label, p => { Object.assign(trackOf(p, trackId), patch); }); }
export function removeTrack(trackId) {
  commit('Delete track', p => { const t = trackOf(p, trackId); if (!t || t.main) return false; p.clips = p.clips.filter(c => c.trackId !== trackId); p.tracks = p.tracks.filter(x => x.id !== trackId); });
}
export function updateClip(id, fn, { label = 'Edit clip', key, window } = {}) { commit(label, p => { const c = p.clips.find(x => x.id === id); if (!c) return false; return fn(c, p); }, { key, window }); }
export function updateClips(ids, fn, { label = 'Edit clips', key, window } = {}) { commit(label, p => { for (const c of p.clips) if (ids.includes(c.id)) fn(c, p); }, { key, window }); }
// Add an emoji (or any string) to the end of a text clip; it takes the text's style and animation.
export function appendToText(id, str) {
  updateClip(id, x => { if (x.kind !== 'text') return false; const sep = x.text && !/\s$/.test(x.text) ? ' ' : ''; x.text = (x.text || '') + sep + str; x.name = x.text.split('\n')[0].slice(0, 40); x.words = null; }, { label: 'Add emoji to text' });
  selection.value = [id];
}
// Live text edit: every keystroke updates the clip (and the preview); one undo entry per editing session.
export function setClipText(id, v, session) {
  updateClip(id, x => { if (x.text === v) return false; x.text = v; x.name = v.split('\n')[0].slice(0, 40); if (x.words && x.words.length !== v.split(/\s+/).filter(Boolean).length) x.words = null; }, { label: 'Edit text', key: 'text:' + id + ':' + session, window: Infinity });
}

export function insertCaptions(segments, { replaceRange, trackName = 'Captions', style } = {}) {
  commit('Add captions', p => {
    let t = p.tracks.find(t => t.captions);
    if (!t) { t = addTrack(p, 'text'); t.captions = true; t.name = trackName; }
    const existing = p.clips.find(c => c.trackId === t.id);
    const st = { ...CAPTION_STYLE, ...(existing?.style || {}), ...(style || {}) }, tr = existing?.transform ? { ...existing.transform } : { y: 0.36 };
    if (replaceRange) p.clips = p.clips.filter(c => !(c.trackId === t.id && c.start < replaceRange[1] && clipEnd(c) > replaceRange[0]));
    for (const s of segments) p.clips.push(newClip('text', { trackId: t.id, caption: true, start: s.start, duration: Math.max(0.2, s.end - s.start), text: s.text, words: s.words || null, style: { ...st }, transform: { ...tr }, name: s.text.slice(0, 40) }));
  });
}
export function selectAll() { const p = project.value; selection.value = p.clips.filter(c => !trackOf(p, c.trackId)?.locked).map(c => c.id); }
export const sourceEnd = srcOut;
