// Rasterizes text, stickers and vector images. The same canvases are shown in the preview
// and sent to FFmpeg as PNG overlays, so typography always matches the export exactly.
import { TEXT_STYLE, stickerDef } from '../../shared/catalog.mjs';

const cache = new Map();
const imageCache = new Map();
const hexA = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); const n = m ? parseInt(m[1], 16) : 0; return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

export function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve, reject) => { const img = new Image(); img.decoding = 'async'; img.onload = () => resolve(img); img.onerror = () => reject(Error('Image failed to load')); img.src = src; });
  imageCache.set(src, p); return p;
}
export const svgUrl = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

function fontString(s, px) { return `${s.italic ? 'italic ' : ''}${s.bold ? '700' : '400'} ${px}px "${String(s.font || 'Segoe UI').replace(/"/g, '')}", "Segoe UI Emoji", sans-serif`; }

// Lays out words into lines, honoring explicit newlines and an optional max width.
function layout(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean); if (!words.length) { lines.push([]); continue; }
    let line = [];
    for (const w of words) {
      const test = [...line, w].join(' ');
      if (maxWidth && line.length && ctx.measureText(test).width > maxWidth) { lines.push(line); line = [w]; } else line.push(w);
    }
    lines.push(line);
  }
  return lines;
}

export function textKey(clip, H, variant) { return JSON.stringify([clip.text, clip.style, clip.caption, H, variant ?? null, clip.caption ? clip.words?.map(w => w.text) : null]); }

// Returns {canvas, w, h} for a text clip at canvas height H. variant = index of highlighted word.
export function renderText(clip, W, H, variant = null) {
  const key = textKey(clip, H, variant); if (cache.has(key)) return cache.get(key);
  const s = { ...TEXT_STYLE, ...(clip.style || {}) };
  const px = Math.max(4, s.size * H);
  const c = document.createElement('canvas'); let ctx = c.getContext('2d');
  ctx.font = fontString(s, px); ctx.letterSpacing = `${(s.letterSpacing || 0) * px}px`;
  const text = s.uppercase ? String(clip.text || '').toUpperCase() : String(clip.text || '');
  const lines = layout(ctx, text, clip.caption ? W * 0.86 : 0);
  const lineH = px * (s.lineHeight || 1.15);
  const space = ctx.measureText(' ').width;
  const widths = lines.map(l => ctx.measureText(l.join(' ')).width);
  const blockW = Math.max(px * 0.5, ...widths), blockH = lines.length * lineH;
  const stroke = (s.strokeWidth || 0) * px, shadow = (s.shadowOpacity || 0) > 0 ? (s.shadowBlur || 0) * px * 0.6 + px * 0.08 : 0;
  const box = (s.bgOpacity || 0) > 0;
  const padX = box ? px * 0.38 : 0, padY = box ? px * 0.16 : 0;
  const margin = Math.ceil(stroke + shadow + 2);
  const w = Math.ceil(blockW + padX * 2 + margin * 2), h = Math.ceil(blockH + padY * 2 + margin * 2);
  c.width = w; c.height = h; ctx = c.getContext('2d');
  ctx.font = fontString(s, px); ctx.letterSpacing = `${(s.letterSpacing || 0) * px}px`; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  if (box) {
    ctx.fillStyle = hexA(s.bgColor, s.bgOpacity); const r = Math.min((s.bgRadius || 0) * px, (blockH + padY * 2) / 2);
    ctx.beginPath(); ctx.roundRect(margin, margin, blockW + padX * 2, blockH + padY * 2, r); ctx.fill();
  }
  const wordsFlat = lines.flat();
  const highlight = s.highlight && variant !== null && clip.words?.length === wordsFlat.length;
  let wordIndex = 0;
  const drawPass = mode => {
    wordIndex = 0;
    lines.forEach((line, i) => {
      const lw = widths[i]; let x = margin + padX + (s.align === 'left' ? 0 : s.align === 'right' ? blockW - lw : (blockW - lw) / 2);
      const y = margin + padY + lineH * (i + 0.5);
      for (const word of line) {
        const ww = ctx.measureText(word).width;
        if (mode === 'stroke') ctx.strokeText(word, x, y);
        else { ctx.fillStyle = highlight && wordIndex === variant ? s.highlightColor || '#ffe14d' : s.color; ctx.fillText(word, x, y); }
        x += ww + space; wordIndex++;
      }
    });
  };
  if (shadow) { ctx.save(); ctx.shadowColor = hexA(s.shadowColor, s.shadowOpacity); ctx.shadowBlur = (s.shadowBlur || 0) * px * 0.6; ctx.shadowOffsetY = px * 0.05; if (stroke) { ctx.strokeStyle = s.strokeColor; ctx.lineWidth = stroke * 2; drawPass('stroke'); } else { ctx.fillStyle = s.color; drawPass('fill'); } ctx.restore(); }
  if (stroke) { ctx.strokeStyle = s.strokeColor; ctx.lineWidth = stroke * 2; drawPass('stroke'); }
  drawPass('fill');
  const out = { canvas: c, w, h, key };
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  cache.set(key, out); return out;
}

export async function renderSticker(clip, W, H) {
  const st = clip.sticker || {};
  const key = JSON.stringify(['st', st, H]); if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); let out;
  if (st.type === 'emoji') {
    const px = Math.round(H * 0.22);
    c.width = Math.ceil(px * 1.35); c.height = Math.ceil(px * 1.35);
    const ctx = c.getContext('2d'); ctx.font = `${px}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(st.value || '⭐', c.width / 2, c.height / 2 + px * 0.06);
  } else {
    const def = stickerDef(st.value); const img = await loadImage(svgUrl(def?.svg || ''));
    const hh = Math.round(H * 0.3), ww = Math.round(hh * (img.naturalWidth || 1) / (img.naturalHeight || 1));
    c.width = Math.max(2, ww); c.height = Math.max(2, hh); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  }
  out = { canvas: c, w: c.width, h: c.height, key }; cache.set(key, out); return out;
}

export async function renderSvgImage(url, W, H) {
  const key = JSON.stringify(['svg', url, W, H]); if (cache.has(key)) return cache.get(key);
  const img = await loadImage(url);
  const nw = img.naturalWidth || 1000, nh = img.naturalHeight || 1000, k = Math.min(W / nw, H / nh);
  const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(nw * k)); c.height = Math.max(2, Math.round(nh * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const out = { canvas: c, w: c.width, h: c.height, key }; cache.set(key, out); return out;
}

// Raster for any raster clip; resolves async resources first.
const isMediaSticker = c => c.kind === 'sticker' && c.sticker?.type === 'media';
export async function rasterFor(clip, W, H, media, variant = null) {
  if (clip.kind === 'text') return renderText(clip, W, H, variant);
  if (isMediaSticker(clip)) return renderSvgImage(media(clip.mediaId).url, H, H);
  if (clip.kind === 'sticker') return renderSticker(clip, W, H);
  const a = media(clip.mediaId); return renderSvgImage(a.url, W, H);
}
export function rasterSync(clip, W, H, variant = null, media = null) {
  if (clip.kind === 'text') return renderText(clip, W, H, variant);
  if (isMediaSticker(clip)) { const a = media?.(clip.mediaId); return a ? cache.get(JSON.stringify(['svg', a.url, H, H])) || null : null; }
  const st = clip.sticker || {};
  const key = clip.kind === 'sticker' ? JSON.stringify(['st', st, H]) : null;
  return key ? cache.get(key) || null : null;
}

// Rasters for export: PNG data URLs at export size, including word-highlight variants.
export async function exportRasters(project, W, H, media) {
  const out = {};
  for (const c of project.clips) {
    const a = c.mediaId && media(c.mediaId);
    if (!(c.kind === 'text' || (c.kind === 'sticker' && !isMediaSticker(c)) || ((c.kind === 'image' || isMediaSticker(c)) && a?.svg))) continue;
    const r = await rasterFor(c, W, H, media);
    const entry = { w: r.w, h: r.h, png: r.canvas.toDataURL('image/png'), variants: {} };
    if (c.kind === 'text' && c.style?.highlight && c.words?.length) c.words.forEach((_, i) => { entry.variants['w' + i] = renderText(c, W, H, i).canvas.toDataURL('image/png'); });
    out[c.id] = entry;
  }
  return out;
}
