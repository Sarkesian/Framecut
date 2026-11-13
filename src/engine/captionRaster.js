// Caption rasters for the shared caption engine. A caption group renders once as a stable base image
// (all words, inactive look) plus small per-word images (active look) that animate on top. Word
// positions come from real text metrics, so overlays land exactly on their words and the line never
// shifts while words pop. The same canvases feed the WebGL preview and the FFmpeg export (as PNGs).
import { hexA } from './raster.js';
const cache = new Map();
export const captionFont = (s, px) => `${s.italic ? 'italic ' : ''}${s.weight || 700} ${px}px "${String(s.font || 'Inter').replace(/"/g, '')}", "Segoe UI", "Segoe UI Emoji", "Nirmala UI", "Yu Gothic UI", "Malgun Gothic", sans-serif`;
const loaded = new Set();
export async function ensureFont(s) {
  const k = captionFont(s, 40); if (loaded.has(k) || typeof document === 'undefined' || !document.fonts) return;
  try { await document.fonts.load(k, 'Aa'); } catch {} loaded.add(k);
}
const tokens = clip => String(clip.text || '').split(/(\n)|\s+/).filter(Boolean);
// Text tokens per line, with the index of each word in clip.words (when word timing exists).
function lines(clip, s) {
  const out = [[]]; let wi = 0;
  for (const t of tokens(clip)) { if (t === '\n') { out.push([]); continue; } out.at(-1).push({ text: s.uppercase ? t.toUpperCase() : t, wi: wi++ }); }
  return out.filter(l => l.length);
}
function metrics(s, H) {
  const px = Math.max(4, s.size * H), stroke = (s.strokeWidth || 0) * px;
  const shadow = (s.shadowOpacity || 0) > 0 ? (s.shadowBlur || 0) * px * 0.7 + Math.abs(s.shadowY || 0) * px : 0;
  const box = (s.bgOpacity || 0) > 0, padX = box ? px * (s.bgPadX ?? 0.4) : 0, padY = box ? px * (s.bgPadY ?? 0.18) : 0;
  return { px, stroke, shadow, box, padX, padY, margin: Math.ceil(stroke + shadow + 2), lineH: px * (s.lineHeight || 1.12) };
}
function glyphs(ctx, s, px, text, x, y, color, alpha) {
  const stroke = (s.strokeWidth || 0) * px;
  if ((s.shadowOpacity || 0) > 0) {
    ctx.save(); ctx.shadowColor = hexA(s.shadowColor, (s.shadowOpacity || 0) * alpha); ctx.shadowBlur = (s.shadowBlur || 0) * px * 0.7; ctx.shadowOffsetY = (s.shadowY ?? 0.06) * px;
    if (stroke) { ctx.strokeStyle = hexA(s.strokeColor, alpha); ctx.lineWidth = stroke * 2; ctx.strokeText(text, x, y); } else { ctx.fillStyle = hexA(color, alpha); ctx.fillText(text, x, y); }
    ctx.restore();
  }
  if (stroke) { ctx.strokeStyle = hexA(s.strokeColor, alpha); ctx.lineWidth = stroke * 2; ctx.strokeText(text, x, y); }
  ctx.fillStyle = hexA(color, alpha); ctx.fillText(text, x, y);
}
// Per-word overrides that keep metrics stable (colors only), so a styled word never moves its line.
const WORD_KEYS = ['color', 'activeColor', 'strokeColor', 'activeBg', 'shadowColor'];
const wordStyle = (clip, wi, s) => { const o = clip.words?.[wi]?.style; return o ? { ...s, ...Object.fromEntries(WORD_KEYS.filter(k => o[k] !== undefined).map(k => [k, o[k]])) } : s; };
const keyOf = (clip, s, H, extra) => JSON.stringify(['cap', clip.text, s, H, extra ?? null, (clip.words || []).map(w => w.style || 0)]);

// Base image of a caption group. boxes[wi] = {x, y, w, h} word centres relative to the image centre.
export function renderCaptionBase(clip, eff, W, H) {
  const s = eff.style, key = keyOf(clip, s, H); if (cache.has(key)) return cache.get(key);
  const m = metrics(s, H), font = captionFont(s, m.px);
  const c = document.createElement('canvas'); let ctx = c.getContext('2d'); ctx.font = font; ctx.letterSpacing = `${(s.letterSpacing || 0) * m.px}px`;
  const L = lines(clip, s), space = ctx.measureText(' ').width + (s.wordSpacing || 0) * m.px;
  const widths = L.map(l => l.reduce((a, t, i) => a + ctx.measureText(t.text).width + (i ? space : 0), 0));
  const blockW = Math.max(m.px * 0.5, ...widths), blockH = L.length * m.lineH;
  const w = Math.ceil(blockW + m.padX * 2 + m.margin * 2), h = Math.ceil(blockH + m.padY * 2 + m.margin * 2);
  c.width = w; c.height = h; ctx = c.getContext('2d');
  ctx.font = font; ctx.letterSpacing = `${(s.letterSpacing || 0) * m.px}px`; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  if (m.box) { ctx.fillStyle = hexA(s.bgColor, s.bgOpacity); ctx.beginPath(); ctx.roundRect(m.margin, m.margin, blockW + m.padX * 2, blockH + m.padY * 2, Math.min((s.bgRadius || 0) * m.px, (blockH + m.padY * 2) / 2)); ctx.fill(); }
  const boxes = []; const asc = m.px * 0.5;
  L.forEach((line, li) => {
    let x = m.margin + m.padX + (s.align === 'left' ? 0 : s.align === 'right' ? blockW - widths[li] : (blockW - widths[li]) / 2);
    const y = m.margin + m.padY + m.lineH * (li + 0.5);
    for (const t of line) {
      const tw = ctx.measureText(t.text).width;
      const ws = wordStyle(clip, t.wi, s); glyphs(ctx, ws, m.px, t.text, x, y, ws.color, s.inactiveOpacity ?? 1);
      boxes[t.wi] = { x: x + tw / 2 - w / 2, y: y - h / 2, w: tw, h: asc * 2, line: li };
      x += tw + space;
    }
    // Room each word has to grow before touching its neighbours (or, at line ends, a little margin).
    line.forEach((t, k) => { const b = boxes[t.wi]; b.gapL = k ? space : m.px * 0.6; b.gapR = k < line.length - 1 ? space : m.px * 0.6; });
  });
  const out = { canvas: c, w, h, key, boxes, words: L.flat().length };
  if (cache.size > 600) cache.delete(cache.keys().next().value);
  cache.set(key, out); return out;
}
// One word in its active (role 'emph') or revealed (role 'reveal') look, centred on its box.
// Rendered at `res` × size so it stays sharp when popped up; w/h are the logical (1×) size.
export function renderCaptionWord(clip, eff, wi, W, H, role = 'emph') {
  const s = wordStyle(clip, wi, eff.style), e = eff.anim?.emph || {}, res = role === 'emph' ? Math.max(1, e.peak || 1, e.from || 1) : 1;
  const key = keyOf(clip, s, H, [wi, role, e.type, res]); if (cache.has(key)) return cache.get(key);
  const base = renderCaptionBase(clip, eff, W, H), b = base.boxes[wi]; if (!b) return null;
  const word = lines(clip, s).flat().find(t => t.wi === wi)?.text || '';
  const m = metrics(s, H), px = m.px * res;
  const bg = role === 'emph' && (e.type === 'background' || (s.activeBgOpacity || 0) > 0);
  const padX = bg ? m.px * 0.22 : 0, padY = bg ? m.px * 0.1 : 0, ul = role === 'emph' && e.type === 'underline' ? m.px * 0.12 : 0;
  const lw = b.w + padX * 2 + m.margin * 2, lh = b.h + padY * 2 + m.margin * 2 + ul * 2;
  const c = document.createElement('canvas'); c.width = Math.ceil(lw * res); c.height = Math.ceil(lh * res);
  const ctx = c.getContext('2d'); ctx.font = captionFont(s, px); ctx.letterSpacing = `${(s.letterSpacing || 0) * px}px`; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  const cx = c.width / 2, cy = c.height / 2;
  if (bg) { ctx.fillStyle = hexA(s.activeBg || '#ff3b6b', s.activeBgOpacity ?? 1); ctx.beginPath(); ctx.roundRect(cx - (b.w / 2 + padX) * res, cy - (b.h / 2 + padY) * res, (b.w + padX * 2) * res, (b.h + padY * 2) * res, m.px * 0.18 * res); ctx.fill(); }
  const color = role === 'reveal' ? s.color : e.type === 'pulse' || e.type === 'lift' ? s.color : s.activeColor || s.color;
  const ss = role === 'emph' && s.activeStrokeColor ? { ...s, strokeColor: s.activeStrokeColor } : bg ? { ...s, strokeWidth: 0, shadowOpacity: 0 } : s;
  ctx.textAlign = 'center'; glyphs(ctx, ss, px, word, cx, cy, color, 1);
  if (ul) { ctx.fillStyle = hexA(s.underlineColor || s.activeColor || s.color, 1); ctx.beginPath(); ctx.roundRect(cx - b.w / 2 * res, cy + (b.h / 2 + ul * 0.3) * res, b.w * res, ul * res, ul * res / 2); ctx.fill(); }
  const out = { canvas: c, w: lw, h: lh, key, res };
  if (cache.size > 600) cache.delete(cache.keys().next().value);
  cache.set(key, out); return out;
}
