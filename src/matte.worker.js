// Background removal with MODNet (Apache-2.0, ONNX via transformers.js). GPU (WebGPU) when available, otherwise WASM.
// Input: RGB24 frames at the model size. Output: 8-bit alpha masks of the same size.
import { AutoModel, Tensor, env } from '@huggingface/transformers';
env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = '/ort/';
env.backends.onnx.wasm.numThreads = Math.min(4, self.navigator?.hardwareConcurrency || 2);
const MODEL_ID = 'Xenova/modnet';
let model = null, device = null, last = 0, prev = null;

async function load(post) {
  if (model) return;
  const progress_callback = p => { if (Date.now() - last < 250) return; last = Date.now(); post({ type: 'progress', stage: 'download', progress: p.status === 'progress' ? (p.progress || 0) / 100 : null, message: p.status === 'progress' ? `Downloading background removal model · ${Math.round(p.progress || 0)}%` : 'Preparing background removal…' }); };
  if (self.navigator?.gpu) { try { model = await AutoModel.from_pretrained(MODEL_ID, { device: 'webgpu', dtype: 'fp32', progress_callback }); device = 'webgpu'; } catch { model = null; } }
  if (!model) { model = await AutoModel.from_pretrained(MODEL_ID, { device: 'wasm', dtype: 'fp32', progress_callback }); device = 'wasm'; }
}

async function matte(rgb, w, h, smooth) {
  const n = w * h, data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { data[i] = rgb[i * 3] / 127.5 - 1; data[n + i] = rgb[i * 3 + 1] / 127.5 - 1; data[2 * n + i] = rgb[i * 3 + 2] / 127.5 - 1; }
  const out = await model({ input: new Tensor('float32', data, [1, 3, h, w]) });
  const t = out.output ?? Object.values(out)[0]; const a = t.data;
  const mask = new Uint8Array(n), cur = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = a[i];
    // Anti-flicker: blend with the previous frame only where the matte barely changed (no ghosting on motion).
    if (smooth && prev && Math.abs(v - prev[i]) < 0.12) v = 0.6 * v + 0.4 * prev[i];
    cur[i] = v; mask[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  prev = smooth ? cur : null;
  return mask;
}

self.onmessage = async ({ data }) => {
  const post = (m, transfer) => self.postMessage({ id: data.id, ...m }, transfer || []);
  try {
    if (data.type === 'load') { await load(post); post({ type: 'ready', device }); return; }
    if (data.type === 'reset') { prev = null; post({ type: 'ok' }); return; }
    if (data.type === 'frame') { await load(post); const mask = await matte(data.rgb, data.w, data.h, data.smooth !== false); post({ type: 'mask', mask }, [mask.buffer]); }
  } catch (error) { post({ type: 'error', message: error?.message || String(error) }); }
};
