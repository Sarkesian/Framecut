// FrameCut project model (format version 2), defaults, migration and timeline helpers.
import { TEXT_STYLE, CAPTION_STYLE } from './catalog.mjs';
import { migrateCaptions } from './captions.mjs';

export const PROJECT_VERSION = 2;
export const RATIOS = {
  '16:9': { name: 'Landscape', hint: 'YouTube' }, '9:16': { name: 'Vertical', hint: 'TikTok · Reels · Shorts' },
  '1:1': { name: 'Square', hint: 'Instagram' }, '4:5': { name: 'Portrait', hint: 'Instagram feed' },
  '4:3': { name: 'Classic', hint: 'Presentations' }, '3:4': { name: 'Tall', hint: 'Pinterest' },
  '21:9': { name: 'Cinema', hint: 'Widescreen' }, '2:1': { name: 'Wide', hint: 'Univisium' },
  '2.35:1': { name: 'Scope', hint: 'Anamorphic' }, '1.85:1': { name: 'Flat', hint: 'Theatrical' },
};
export const RESOLUTIONS = [480, 720, 1080, 1440, 2160, 4320];
export const FRAME_RATES = [24, 25, 30, 50, 60, 120];
export const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
export const num = (v, min, max, fallback) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(max, Math.max(min, +v)) : fallback);

export function dimensions(ratio, resolution) {
  const [a, b] = String(RATIOS[ratio] ? ratio : '16:9').split(':').map(Number);
  const short = RESOLUTIONS.includes(+resolution) ? +resolution : 1080;
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  return a >= b ? [even(short * a / b), short] : [short, even(short * b / a)];
}

export const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false };
export const DEFAULT_CROP = { l: 0, t: 0, r: 0, b: 0 };
export const DEFAULT_COLOR = { exposure: 0, brightness: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, hue: 0 };
export const DEFAULT_AUDIO_FX = { denoise: 0, normalize: false, eq: 'none', echo: 0, reverb: 0, pitch: 0 };

export function newProject({ name = 'Untitled project', ratio = '16:9', resolution = 1080, fps = 30 } = {}) {
  const now = new Date().toISOString();
  return {
    version: PROJECT_VERSION, id: uid(), name, created: now, modified: now,
    settings: { ratio, resolution, fps, background: { type: 'black', color: '#000000', blur: 24 }, magnetic: true, snapping: true },
    tracks: [
      { id: 'text-1', kind: 'text', name: 'Text' },
      { id: 'main', kind: 'video', name: 'Main', main: true },
      { id: 'audio-1', kind: 'audio', name: 'Audio' },
    ],
    clips: [], mediaIds: [], markers: [], favorites: [],
    export: { format: 'mp4', codec: 'h264', resolution, fps, quality: 'high', hardware: 'auto', audioBitrate: 192, subtitles: 'burn' },
  };
}

const KIND_TRACK = { video: 'video', image: 'video', audio: 'audio', text: 'text', sticker: 'text', adjust: 'effect' };
export const trackKindFor = kind => KIND_TRACK[kind] || 'video';
// Track stacking rule: picture tracks (overlays, text, effects) on top, then the Main track as the bottom
// picture layer, then every audio track. A picture track below Main would be hidden by it, so it never goes there.
const band = t => (t.kind === 'audio' ? 2 : t.main ? 1 : 0);
export const orderTracks = tracks => tracks.map((t, i) => ({ t, i })).sort((a, b) => band(a.t) - band(b.t) || a.i - b.i).map(x => x.t);
// The nearest allowed insert position (a boundary before tracks[index]) for a new or moved track of `kind`.
export function clampTrackIndex(p, kind, index) {
  const m = p.tracks.findIndex(t => t.main); if (m < 0) return index;
  return kind === 'audio' ? Math.max(index, m + 1) : Math.min(index, m);
}
export const isVisual = c => c.kind !== 'audio';
export const hasMedia = c => ['video', 'image', 'audio'].includes(c.kind);
// A sticker from the Creative Library or the user's files: an image or looping transparent video asset.
export const stickerMedia = c => c.kind === 'sticker' && c.sticker?.type === 'media' && !!c.mediaId;
// Playback rate of a clip's source. A sticker may be set to 0×: its animation holds still on one frame.
// Everything else treats a missing or zero speed as normal speed.
export const clipSpeed = c => (c.kind === 'sticker' && c.speed === 0 ? 0 : c.speed || 1);
export const clipEnd = c => c.start + c.duration;
export const srcOut = c => c.in + c.duration * (c.speed || 1);

export function newClip(kind, props = {}) {
  const base = { id: uid(), kind, trackId: null, start: 0, duration: 5, name: '' };
  if (hasMedia({ kind })) Object.assign(base, { mediaId: null, in: 0, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, muted: false, audioFx: { ...DEFAULT_AUDIO_FX } });
  if (kind !== 'audio') Object.assign(base, { transform: { ...DEFAULT_TRANSFORM }, crop: { ...DEFAULT_CROP }, color: { ...DEFAULT_COLOR }, filter: { id: null, intensity: 1 }, effects: [], transition: null, animIn: null, animOut: null, animLoop: null, fit: 'contain' });
  if (kind === 'text') Object.assign(base, { text: 'Your text', style: { ...TEXT_STYLE }, caption: false, words: null });
  if (kind === 'sticker') Object.assign(base, { sticker: { type: 'emoji', value: '⭐' } });
  if (kind === 'adjust') Object.assign(base, { name: 'Adjustment' });
  return deepMerge(base, props);
}

export function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}

// Bring any stored project up to the current version and fill missing fields.
export function normalizeProject(raw) {
  let p = raw && typeof raw === 'object' ? JSON.parse(JSON.stringify(raw)) : newProject();
  if (!p.version || p.version < 2) p = migrateV1(p);
  const base = newProject({ name: p.name, ratio: p.settings?.ratio, resolution: p.settings?.resolution, fps: p.settings?.fps });
  p.settings = deepMerge(base.settings, p.settings || {});
  if (!RATIOS[p.settings.ratio]) p.settings.ratio = '16:9';
  if (!RESOLUTIONS.includes(+p.settings.resolution)) p.settings.resolution = 1080;
  if (!FRAME_RATES.includes(+p.settings.fps)) p.settings.fps = 30;
  p.export = deepMerge(base.export, p.export || {});
  p.id ||= uid(); p.name = String(p.name || 'Untitled project').slice(0, 200);
  p.created ||= new Date().toISOString(); p.modified ||= p.created;
  p.tracks = Array.isArray(p.tracks) && p.tracks.length ? p.tracks : base.tracks;
  if (!p.tracks.some(t => t.main)) { const v = p.tracks.find(t => t.kind === 'video'); if (v) v.main = true; else p.tracks.splice(Math.max(0, p.tracks.findIndex(t => t.kind === 'audio')), 0, { id: 'main', kind: 'video', name: 'Main', main: true }); }
  p.tracks = orderTracks(p.tracks); // repairs projects where a video track ended up under Main (hidden)
  p.mediaIds = Array.isArray(p.mediaIds) ? p.mediaIds : []; p.markers = Array.isArray(p.markers) ? p.markers : []; p.favorites = Array.isArray(p.favorites) ? p.favorites : [];
  // Library license / attribution records (see rights.mjs) travel with the project.
  p.attributions = p.attributions && typeof p.attributions === 'object' && !Array.isArray(p.attributions) ? p.attributions : {};
  const trackIds = new Set(p.tracks.map(t => t.id));
  p.clips = (Array.isArray(p.clips) ? p.clips : []).filter(c => c && c.kind && trackIds.has(c.trackId)).map(c => {
    const full = deepMerge(newClip(c.kind), c);
    full.start = num(full.start, 0, 86400, 0); full.duration = num(full.duration, 0.04, 86400, 1);
    if (hasMedia(full)) { full.in = num(full.in, 0, 86400, 0); full.speed = num(full.speed, 0.1, 10, 1); full.volume = num(full.volume, 0, 16, 1); } // up to +24 dB
    return full;
  });
  for (const c of p.clips) if (c.mediaId && !p.mediaIds.includes(c.mediaId)) p.mediaIds.push(c.mediaId);
  // A link to separated audio that no longer exists: the video simply stays muted (unmute to hear it).
  const ids = new Set(p.clips.map(c => c.id));
  for (const c of p.clips) if (c.detachedAudio && !ids.has(c.detachedAudio)) delete c.detachedAudio;
  migrateCaptions(p);
  return p;
}

export function migrateV1(v1) {
  const p = newProject({ name: v1.name || 'Imported project', ratio: v1.ratio || '16:9', resolution: v1.resolution || 1080, fps: v1.fps || 30 });
  p.migratedFrom = 1;
  p.settings.background = { type: v1.canvasBackground === 'color' ? 'color' : v1.canvasBackground === 'blur' ? 'blur' : 'black', color: v1.canvasColor || '#000000', blur: v1.canvasBlur || 24 };
  p.tracks = [
    { id: 'captions', kind: 'text', name: 'Captions', captions: true, hidden: v1.burnCaptions === false },
    { id: 'text-1', kind: 'text', name: 'Text' },
    { id: 'main', kind: 'video', name: 'Main', main: true },
    { id: 'audio-1', kind: 'audio', name: 'Audio' },
    { id: 'music', kind: 'audio', name: 'Music' },
  ];
  let cursor = 0;
  for (const c of v1.clips || []) {
    const speed = +c.speed || 1, d = Math.max(0.05, ((+c.end || 0) - (+c.start || 0)) / speed);
    const clip = newClip('video', { id: c.id || uid(), trackId: 'main', mediaId: c.mediaId, start: cursor, duration: d, in: +c.start || 0, speed, volume: c.volume ?? 1, fit: v1.fit === 'crop' ? 'cover' : 'contain', color: { brightness: c.brightness || 0, contrast: c.contrast ?? 1, saturation: c.saturation ?? 1 } });
    if (c.fade) { clip.animIn = { id: 'fade', duration: +c.fade }; clip.animOut = { id: 'fade', duration: +c.fade }; }
    p.clips.push(clip); cursor += d;
  }
  for (const a of v1.audioClips || []) {
    const speed = +a.speed || 1;
    p.clips.push(newClip('audio', { id: a.id || uid(), trackId: 'audio-1', mediaId: a.mediaId, start: +a.position || 0, in: +a.start || 0, duration: Math.max(0.05, ((+a.end || 0) - (+a.start || 0)) / speed), speed, volume: a.volume ?? 1, fadeIn: a.fadeIn ?? a.fade ?? 0, fadeOut: a.fadeOut ?? a.fade ?? 0 }));
  }
  if (v1.musicId && cursor > 0) p.pendingMusic = { mediaId: v1.musicId, volume: v1.musicVolume ?? 0.25, until: cursor };
  const cs = { ...CAPTION_STYLE, font: v1.captionFont || 'Arial', size: v1.captionSize || 0.052, color: v1.captionColor || '#ffffff', bold: v1.captionBold !== false, italic: !!v1.captionItalic, uppercase: !!v1.captionUppercase, strokeWidth: (v1.captionOutline ?? 3) / 25, shadowOpacity: v1.captionShadow ? 0.6 : 0, bgOpacity: v1.captionBox ? 0.6 : 0, highlight: v1.captionPreset === 'highlight' };
  const cy = v1.captionPosition === 'top' ? -0.38 : v1.captionPosition === 'middle' ? 0 : 0.36;
  for (const c of v1.captions || []) {
    const start = +c.start || 0, end = +c.end || start + 1;
    p.clips.push(newClip('text', { trackId: 'captions', caption: true, start, duration: Math.max(0.1, end - start), text: c.text || '', style: { ...cs }, transform: { y: cy }, words: c.words?.length ? c.words.map(w => ({ start: w.start - start, end: w.end - start, text: w.text })) : null }));
  }
  for (const c of v1.titles || []) {
    const start = +c.start || 0, end = +c.end || start + 3;
    p.clips.push(newClip('text', { trackId: 'text-1', start, duration: Math.max(0.1, end - start), text: c.text || '', style: { ...TEXT_STYLE, size: 0.065, shadowOpacity: 0.7 }, transform: { y: -0.36 } }));
  }
  p.mediaIds = [...new Set([...(v1.clips || []), ...(v1.audioClips || [])].map(c => c.mediaId).concat(v1.musicId ? [v1.musicId] : []).filter(Boolean))];
  return p;
}

// Expand a migrated looping music bed once media durations are known.
export function resolvePendingMusic(p, media) {
  const m = p.pendingMusic; if (!m) return p; delete p.pendingMusic;
  const asset = media(m.mediaId); if (!asset?.duration) return p;
  for (let t = 0; t < m.until - 0.05; t += asset.duration) p.clips.push(newClip('audio', { trackId: 'music', mediaId: m.mediaId, start: t, in: 0, duration: Math.min(asset.duration, m.until - t), volume: m.volume }));
  return p;
}

export const projectDuration = p => Math.max(0, ...p.clips.map(clipEnd));
export const trackClips = (p, trackId) => p.clips.filter(c => c.trackId === trackId).sort((a, b) => a.start - b.start);
export const mainTrack = p => p.tracks.find(t => t.main);

// Keep the main track gap-free (magnetic timeline).
export function packMain(p) {
  const main = mainTrack(p); if (!main || !p.settings.magnetic) return p;
  let t = 0; for (const c of trackClips(p, main.id)) { c.start = t; t += c.duration; }
  return p;
}

// Linked video + separated audio stay in sync through every edit (moves, trims, ripple, gap closing, gapless
// packing, speed, paste…). After an edit, a pair that came apart is re-aligned: the half that was edited
// leads and the other follows — except a video on the gapless Main track, which can't be moved off its
// packed position, so its audio follows it. A follower that would overlap another clip moves to a free
// track of its own kind (a new one if needed).
const sameTiming = (x, y) => !!x && !!y && Math.abs(x.start - y.start) < 1e-6 && Math.abs(x.duration - y.duration) < 1e-6 && Math.abs((x.in || 0) - (y.in || 0)) < 1e-6 && (x.speed || 1) === (y.speed || 1);
export function syncLinked(prev, p) {
  const before = new Map((prev?.clips || []).map(c => [c.id, c]));
  const main = mainTrack(p);
  for (const v of p.clips) {
    if (v.kind !== 'video' || !v.detachedAudio) continue;
    const a = p.clips.find(x => x.id === v.detachedAudio); if (!a || sameTiming(v, a)) continue;
    const vChanged = !sameTiming(v, before.get(v.id)), aChanged = !sameTiming(a, before.get(a.id));
    const pinned = v.trackId === main?.id && p.settings.magnetic;
    const [src, dst] = aChanged && !vChanged && !pinned ? [a, v] : [v, a];
    dst.start = src.start; dst.duration = src.duration; dst.in = src.in; dst.speed = src.speed;
    const clash = p.clips.some(o => o !== dst && o.trackId === dst.trackId && o.start < clipEnd(dst) - 1e-4 && clipEnd(o) > dst.start + 1e-4);
    if (clash) {
      const kind = dst.kind === 'audio' ? 'audio' : 'video';
      const free = p.tracks.find(t => t.kind === kind && !t.main && !t.locked && !t.captions && !p.clips.some(o => o !== dst && o.trackId === t.id && o.start < clipEnd(dst) - 1e-4 && clipEnd(o) > dst.start + 1e-4));
      if (free) dst.trackId = free.id;
      else {
        const t = { id: kind + '-' + uid().slice(0, 8), kind, name: (kind === 'audio' ? 'Audio ' : 'Video ') + (p.tracks.filter(x => x.kind === kind).length + 1), autoRemove: true };
        const m = p.tracks.findIndex(x => x.main); p.tracks.splice(kind === 'audio' ? p.tracks.length : Math.max(0, m), 0, t); dst.trackId = t.id;
      }
    }
  }
  return p;
}

// After any edit: no clip may point at something that's gone. A link to deleted separated audio is dropped
// (the video stays muted), and a transition whose neighbouring clip moved away or was deleted is removed.
export function cleanRefs(p) {
  const ids = new Set(p.clips.map(c => c.id));
  for (const c of p.clips) {
    if (c.detachedAudio && !ids.has(c.detachedAudio)) delete c.detachedAudio;
    if (c.transition && !transitionPartner(p, c)) c.transition = null;
  }
  return p;
}

// Previous clip on the same track that touches this clip's start (transition partner).
export function transitionPartner(p, clip, eps = 1 / 120) {
  return p.clips.find(c => c !== clip && c.trackId === clip.trackId && isVisual(c) && Math.abs(clipEnd(c) - clip.start) < eps);
}
export function maxTransition(p, clip) {
  const prev = transitionPartner(p, clip); if (!prev) return 0;
  return Math.max(0.1, Math.min(3, clip.duration * 0.9, prev.duration * 0.9));
}
