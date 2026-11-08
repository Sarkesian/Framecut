// Generates small preview images for filters and effects from a real frame (or a sample scene).
import { FILTERS } from '../../shared/catalog.mjs';
const W = 120, H = 72;
const cache = new Map();
function sampleScene() {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#5aa9e6'); sky.addColorStop(0.55, '#f7c59f'); sky.addColorStop(1, '#2a6f6f'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffd166'; g.beginPath(); g.arc(W * 0.72, H * 0.42, 9, 0, 7); g.fill();
  g.fillStyle = '#1b4332'; g.beginPath(); g.moveTo(0, H * 0.75); g.lineTo(W * 0.3, H * 0.45); g.lineTo(W * 0.55, H * 0.72); g.lineTo(W * 0.8, H * 0.5); g.lineTo(W, H * 0.7); g.lineTo(W, H); g.lineTo(0, H); g.fill();
  g.fillStyle = '#e63946'; g.fillRect(W * 0.12, H * 0.62, 10, 16); g.fillStyle = '#f1faee'; g.beginPath(); g.arc(W * 0.12 + 5, H * 0.58, 5, 0, 7); g.fill();
  return c;
}
async function sourceCanvas(src) {
  if (!src) return sampleScene();
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const k = Math.max(W / img.naturalWidth, H / img.naturalHeight); const w = img.naturalWidth * k, h = img.naturalHeight * k;
    g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); return c;
  } catch { return sampleScene(); }
}
export async function filterPreviews(src) {
  const key = 'f:' + (src || 'sample'); if (cache.has(key)) return cache.get(key);
  const base = await sourceCanvas(src); const data = base.getContext('2d').getImageData(0, 0, W, H);
  const out = { none: base.toDataURL('image/jpeg', 0.8) };
  for (const f of FILTERS) {
    const d = new ImageData(new Uint8ClampedArray(data.data), W, H);
    for (let i = 0; i < d.data.length; i += 4) {
      let c = [d.data[i] / 255, d.data[i + 1] / 255, d.data[i + 2] / 255];
      for (const op of f.recipe) c = op(c).map(v => Math.min(1, Math.max(0, v)));
      d.data[i] = c[0] * 255; d.data[i + 1] = c[1] * 255; d.data[i + 2] = c[2] * 255;
    }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').putImageData(d, 0, 0); out[f.id] = cv.toDataURL('image/jpeg', 0.8);
  }
  cache.set(key, out); return out;
}
export async function effectPreviews(src) {
  const key = 'e:' + (src || 'sample'); if (cache.has(key)) return cache.get(key);
  const base = await sourceCanvas(src); const out = {};
  const mk = fn => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); fn(g, c); return c.toDataURL('image/jpeg', 0.8); };
  out.blur = mk(g => { g.filter = 'blur(3px)'; g.drawImage(base, -6, -6, W + 12, H + 12); });
  out.sharpen = mk(g => { g.filter = 'contrast(1.25) saturate(1.1)'; g.drawImage(base, 0, 0); });
  out.vignette = mk(g => { g.drawImage(base, 0, 0); const r = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.6); r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, 'rgba(0,0,0,.85)'); g.fillStyle = r; g.fillRect(0, 0, W, H); });
  out.grain = mk(g => { g.drawImage(base, 0, 0); const d = g.getImageData(0, 0, W, H); for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() - 0.5) * 60; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } g.putImageData(d, 0, 0); });
  out.rgbsplit = mk(g => { g.globalCompositeOperation = 'lighter'; for (const [dx, col] of [[-3, 'red'], [0, 'lime'], [3, 'blue']]) { const t = document.createElement('canvas'); t.width = W; t.height = H; const tg = t.getContext('2d'); tg.drawImage(base, 0, 0); tg.globalCompositeOperation = 'multiply'; tg.fillStyle = col; tg.fillRect(0, 0, W, H); g.drawImage(t, dx, 0); } });
  out.glitch = mk(g => { g.drawImage(base, 0, 0); for (let i = 0; i < 6; i++) { const y = Math.random() * H, h = 3 + Math.random() * 8; g.drawImage(base, 0, y, W, h, (Math.random() - 0.5) * 20, y, W, h); } g.globalCompositeOperation = 'screen'; g.fillStyle = 'rgba(255,0,80,.18)'; g.fillRect(0, 0, W, H); });
  out.pixelate = mk(g => { g.imageSmoothingEnabled = false; const t = document.createElement('canvas'); t.width = 16; t.height = 10; t.getContext('2d').drawImage(base, 0, 0, 16, 10); g.drawImage(t, 0, 0, W, H); });
  out.shake = mk(g => { g.globalAlpha = 0.5; g.drawImage(base, -3, 1); g.drawImage(base, 3, -1); });
  cache.set(key, out); return out;
}
