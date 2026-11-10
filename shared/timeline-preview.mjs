// Timeline imagery is anchored to source time, independently of the visible clip edge.
import { keyGain } from './audio.mjs';

export function sliceGainKeys(keys, offset, duration) {
  if (!keys?.length) return keys;
  return [{ t: 0, v: keyGain(keys, offset) }, ...keys.filter(k => k.t > offset + 1e-8 && k.t < offset + duration - 1e-8).map(k => ({ ...k, t: k.t - offset })), { t: duration, v: keyGain(keys, offset + duration) }];
}

export function timelinePreviewClip(c, drag, main = false) {
  if (!drag?.ids?.includes(c.id)) return c;
  if (drag.mode === 'move') return { ...c, start: Math.max(0, c.start + drag.dt) };
  if (drag.mode !== 'trim') return c;
  if (drag.edge === 'end') return { ...c, duration: c.duration + drag.dt };
  const offset = drag.dt, duration = c.duration - offset;
  return { ...c, start: drag.ripple && !main ? c.start : c.start + offset, duration,
    in: c.mediaId ? Math.max(0, (c.in || 0) + offset * (c.speed || 1)) : c.in,
    volumeKeys: sliceGainKeys(c.volumeKeys, offset, duration), duckKeys: sliceGainKeys(c.duckKeys, offset, duration) };
}

export function filmstripTiles(c, s, { zoom, height, from = 0, to = c.duration * zoom }) {
  if (!(zoom > 0 && height > 0 && s?.count > 0 && s.interval > 0 && to > from)) return [];
  const width = height * (s.w / s.h), speed = c.speed || 1;
  const sourcePixels = (c.in || 0) / speed * zoom, clipWidth = c.duration * zoom;
  const first = Math.floor((Math.max(0, from) + sourcePixels) / width), out = [];
  for (let i = first; i * width - sourcePixels < Math.min(clipWidth, to); i++) {
    const left = i * width - sourcePixels;
    // Only boundary tiles adjust their representative time. Interior frames stay
    // fixed as a trim reveals or hides them; tile dimensions never stretch.
    const visibleStart = Math.max(0, left), visibleEnd = Math.min(clipWidth, left + width);
    const sourceTime = (c.in || 0) + (visibleStart + visibleEnd) / 2 / zoom * speed;
    const index = Math.min(s.count - 1, Math.max(0, s.sampleStart === 0 ? Math.round(sourceTime / s.interval) : Math.floor(sourceTime / s.interval)));
    out.push({ id: i, left, width, sourceTime, index });
  }
  return out;
}
