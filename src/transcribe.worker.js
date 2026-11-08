// Local speech recognition with Whisper (transformers.js). GPU (WebGPU) when available, otherwise WASM.
import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = '/ort/';
env.backends.onnx.wasm.numThreads = 1;
const loaded = new Map();
let last = 0, sawTotal = false;
async function load(model, post) {
  if (loaded.has(model)) return loaded.get(model);
  // transformers.js reports aggregate download progress as 'progress_total' (per-file 'progress' events are skipped).
  const progress_callback = p => { const total = p.status === 'progress_total'; if (p.status === 'progress' || (!total && sawTotal) || (total && Date.now() - last < 250 && p.progress < 100)) return; if (total) sawTotal = true; last = Date.now(); post({ type: 'progress', stage: 'download', progress: total ? (p.progress || 0) / 100 : null, message: total && p.progress >= 100 ? 'Loading the model…' : total ? `Downloading speech model · ${Math.round(p.progress || 0)}%${p.total ? ` of ${Math.round(p.total / 1048576)} MB` : ''}` : 'Preparing speech model…' }); };
  let pipe, device = 'wasm';
  if (self.navigator?.gpu) {
    try { pipe = await pipeline('automatic-speech-recognition', model, { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback }); device = 'webgpu'; } catch { pipe = null; }
  }
  if (!pipe) pipe = await pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback });
  const entry = { pipe, device }; loaded.set(model, entry); return entry;
}
self.onmessage = async ({ data }) => {
  const post = m => self.postMessage({ id: data.id, ...m });
  try {
    const { pipe, device } = await load(data.model, post);
    post({ type: 'progress', stage: 'transcribe', message: `Listening… (${device === 'webgpu' ? 'GPU' : 'CPU'})` });
    const result = await pipe(data.audio, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word', ...(data.language && !data.model.endsWith('.en') ? { language: data.language, task: 'transcribe' } : {}) });
    post({ type: 'done', result, device });
  } catch (error) { post({ type: 'error', message: error?.message || String(error) }); }
};
