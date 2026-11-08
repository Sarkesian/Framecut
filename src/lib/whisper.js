// Auto-captions: extracts speech audio, runs Whisper locally, and groups words into caption lines.
import { api } from './api.js';
export const WHISPER_MODELS = { tiny: { id: 'onnx-community/whisper-tiny_timestamped', name: 'Whisper Tiny (fast)' }, base: { id: 'onnx-community/whisper-base_timestamped', name: 'Whisper Base (balanced)' }, small: { id: 'onnx-community/whisper-small_timestamped', name: 'Whisper Small (accurate)' } };
let worker, seq = 0; const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../transcribe.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; if (data.type === 'progress') p.onProgress?.(data); else { pending.delete(data.id); data.type === 'done' ? p.resolve(data) : p.reject(Error(data.message)); } };
  worker.onerror = e => { for (const p of pending.values()) p.reject(Error(e.message || 'Speech engine stopped.')); pending.clear(); worker = null; };
  return worker;
}
export async function whisperStatus() {
  let keys = [];
  try { const c = await caches.open('transformers-cache'); keys = (await c.keys()).map(r => r.url); } catch {}
  return Object.entries(WHISPER_MODELS).map(([k, m]) => ({ key: k, ...m, cached: keys.some(u => u.includes(m.id)) }));
}
// Transcribe part of a media file. Returns word list with source-relative times.
export async function transcribe({ mediaId, from, to, model = 'base', language, onProgress, signal }) {
  onProgress?.({ message: 'Preparing audio…' });
  const audio = await api('/api/tools/speech-audio', { mediaId, from, to });
  const bytes = await (await fetch(audio.url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 16000, 16000);
  const buf = await ctx.decodeAudioData(bytes);
  const samples = new Float32Array(buf.getChannelData(0));
  const id = ++seq; const w = getWorker();
  const done = new Promise((resolve, reject) => { pending.set(id, { resolve, reject, onProgress }); signal?.addEventListener('abort', () => { pending.delete(id); worker?.terminate(); worker = null; reject(Object.assign(Error('Cancelled'), { cancelled: true })); }); });
  w.postMessage({ id, audio: samples, model: (WHISPER_MODELS[model] || WHISPER_MODELS.base).id, language }, [samples.buffer]);
  const { result } = await done;
  const words = (result.chunks || []).map(c => ({ start: from + (c.timestamp?.[0] ?? 0), end: from + (c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0), text: String(c.text || '').trim() })).filter(w => w.text);
  for (let i = 0; i < words.length; i++) if (!(words[i].end > words[i].start)) words[i].end = words[i + 1]?.start ?? words[i].start + 0.3;
  return { words, text: result.text };
}
// Group words into readable caption lines (max ~6 words / 2.6 s, break on punctuation and pauses).
export function groupWords(words, { maxWords = 6, maxDur = 2.6 } = {}) {
  const out = []; let g = [];
  const flush = () => { if (!g.length) return; out.push({ start: g[0].start, end: g.at(-1).end, text: g.map(w => w.text).join(' '), words: g }); g = []; };
  for (const w of words) {
    if (g.length && (w.start - g.at(-1).end > 0.7)) flush();
    g.push(w);
    if (g.length >= maxWords || w.end - g[0].start > maxDur || /[.!?…]$/.test(w.text)) flush();
  }
  flush(); return out;
}
