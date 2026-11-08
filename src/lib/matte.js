// Background removal driver: streams frames from the local service through the MODNet worker and
// uploads the masks; the service then builds a full-resolution VP9 cutout with transparency.
import { api, waitJob } from './api.js';

export const MATTE_MODEL = { id: 'Xenova/modnet', name: 'MODNet portrait matting', license: 'Apache-2.0', size: '≈25 MB' };
let worker = null, seq = 0; const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../matte.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; if (data.type === 'progress') return p.onProgress?.(data); pending.delete(data.id); data.type === 'error' ? p.reject(Error(data.message)) : p.resolve(data); };
  worker.onerror = e => { for (const p of pending.values()) p.reject(Error(e.message || 'Background removal stopped.')); pending.clear(); worker = null; };
  return worker;
}
const call = (msg, transfer = [], onProgress) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject, onProgress }); getWorker().postMessage({ id, ...msg }, transfer); });

export async function matteStatus() {
  try { const c = await caches.open('transformers-cache'); return (await c.keys()).some(r => r.url.includes(MATTE_MODEL.id) && r.url.endsWith('.onnx')); } catch { return false; }
}
export async function deleteMatteModel() {
  const c = await caches.open('transformers-cache'); for (const r of await c.keys()) if (r.url.includes(MATTE_MODEL.id)) await c.delete(r);
  worker?.terminate(); worker = null;
}

// Test hook: a deterministic matte (centred ellipse) used by the automated tests instead of the model.
const synthetic = (w, h) => { const m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = ((x - w / 2) / (w * 0.28)) ** 2 + ((y - h / 2) / (h * 0.4)) ** 2 < 1 ? 255 : 0; return m; };

export async function removeBackground({ mediaId, from, to, fps, onProgress = () => {}, signal }) {
  const fake = window.__fc?.matteEngine === 'synthetic';
  let device = 'test';
  if (!fake) { onProgress({ message: 'Preparing background removal…' }); device = (await call({ type: 'load' }, [], onProgress)).device; await call({ type: 'reset' }); }
  const s = await api('/api/tools/matte/start', { mediaId, from, to, fps });
  const cancel = () => api(`/api/tools/matte/${s.session}`, undefined, 'DELETE').catch(() => {});
  try {
    const frameBytes = s.mw * s.mh * 3, res = await fetch(`/api/tools/matte/${s.session}/frames`, { signal });
    if (!res.ok) throw Error('Could not read the video frames.');
    const reader = res.body.getReader(); let buf = new Uint8Array(0), done = 0, batch = [];
    const upload = async () => { if (!batch.length) return; const body = new Uint8Array(batch.length * s.mw * s.mh); batch.forEach((m, i) => body.set(m, i * m.length)); batch = []; await fetch(`/api/tools/matte/${s.session}/mask`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body, signal }).then(r => { if (!r.ok) throw Error('Could not save the mask.'); }); };
    const t0 = performance.now();
    for (;;) {
      const { value, done: end } = await reader.read(); if (signal?.aborted) throw Object.assign(Error('Cancelled'), { cancelled: true });
      if (value) { const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb; }
      while (buf.length >= frameBytes) {
        const rgb = buf.slice(0, frameBytes); buf = buf.subarray(frameBytes);
        const mask = fake ? synthetic(s.mw, s.mh) : (await call({ type: 'frame', rgb, w: s.mw, h: s.mh }, [rgb.buffer])).mask;
        batch.push(mask); done++;
        if (batch.length >= 30) await upload();
        const rate = done / ((performance.now() - t0) / 1000);
        onProgress({ progress: 0.9 * done / s.frames, message: `Finding the subject · frame ${done} of ${s.frames}${rate > 0 ? ` · ${rate.toFixed(1)} fps` : ''} (${device === 'webgpu' ? 'GPU' : device === 'wasm' ? 'CPU' : device})` });
      }
      if (end) break;
    }
    await upload();
    if (!done) throw Error('No frames could be read from this clip.');
    onProgress({ progress: 0.9, message: 'Building the cutout…' });
    const { job } = await api(`/api/tools/matte/${s.session}/finish`, {});
    const r = await waitJob(job, p => onProgress({ progress: 0.9 + 0.1 * (p || 0), message: 'Building the cutout…' }), signal);
    return { ...r, device };
  } catch (e) { await cancel(); throw e; }
}
