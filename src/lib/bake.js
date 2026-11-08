// Decodes animations FFmpeg cannot read here (animated WebP via WebCodecs' ImageDecoder, Lottie via
// the light canvas player — no expressions/eval) into evenly timed PNG frames. The service encodes
// them exactly like GIF/APNG stickers, so preview and export share one transparent video.
import { api, waitJob } from './api.js';

const MAX_SIDE = 512, MAX_FRAMES = 900;
const fit = (w, h) => { const k = Math.min(1, MAX_SIDE / Math.max(w, h)); return [Math.max(2, Math.round(w * k / 2) * 2), Math.max(2, Math.round(h * k / 2) * 2)]; };

async function webpFrames(blob) {
  if (typeof ImageDecoder === 'undefined') throw Error('Animated WebP needs a newer Chromium.');
  const dec = new ImageDecoder({ data: await blob.arrayBuffer(), type: 'image/webp' }); await dec.tracks.ready; await dec.completed;
  const track = dec.tracks.selectedTrack; const n = track.frameCount; const frames = []; let t = 0;
  for (let i = 0; i < n; i++) { const { image } = await dec.decode({ frameIndex: i }); const d = Math.max(0.02, (image.duration || 100000) / 1e6); frames.push({ image, start: t, end: t + d }); t += d; }
  const first = frames[0].image; const [w, h] = fit(first.displayWidth, first.displayHeight);
  const fps = Math.min(30, Math.max(1, Math.round(1 / Math.min(...frames.map(f => f.end - f.start))))), count = Math.min(MAX_FRAMES, Math.max(1, Math.round(t * fps)));
  return { w, h, fps, count, draw: (ctx, i) => { const at = (i + 0.5) / fps; const f = frames.find(x => at >= x.start && at < x.end) || frames.at(-1); ctx.clearRect(0, 0, w, h); ctx.drawImage(f.image, 0, 0, w, h); }, done: () => { for (const f of frames) f.image.close(); dec.close(); } };
}
async function lottieFrames(blob) {
  const data = JSON.parse(await blob.text());
  const { default: lottie } = await import('lottie-web/build/player/lottie_light_canvas');
  const [w, h] = fit(data.w, data.h);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d');
  const holder = document.createElement('div');
  const anim = lottie.loadAnimation({ container: holder, renderer: 'canvas', loop: false, autoplay: false, animationData: data, rendererSettings: { context: ctx, clearCanvas: true, preserveAspectRatio: 'xMidYMid meet' } });
  await new Promise((res, rej) => { if (anim.isLoaded) res(); anim.addEventListener('DOMLoaded', res); anim.addEventListener('data_failed', () => rej(Error('This Lottie file could not be read.'))); setTimeout(res, 3000); });
  anim.resize?.(w, h);
  const total = (data.op - data.ip) / data.fr, fps = Math.min(30, Math.round(data.fr)), count = Math.min(MAX_FRAMES, Math.max(1, Math.round(total * fps)));
  return { w, h, fps, count, canvas, draw: (out, i) => { anim.goToAndStop(data.ip + (i / fps) * data.fr, true); out.clearRect(0, 0, w, h); out.drawImage(canvas, 0, 0); }, done: () => anim.destroy() };
}

export async function bakeInEditor({ token, name, type }, onProgress) {
  const blob = await (await fetch('/api/creative/local/' + token)).blob();
  const src = type === 'lottie' ? await lottieFrames(blob) : await webpFrames(blob);
  const out = document.createElement('canvas'); out.width = src.w; out.height = src.h; const ctx = out.getContext('2d');
  const { id } = await api('/api/creative/bake/start', { name, fps: src.fps, width: src.w, height: src.h, count: src.count, token });
  try {
    for (let i = 0; i < src.count; i++) {
      src.draw(ctx, i);
      const png = await new Promise(r => out.toBlob(r, 'image/png'));
      const r = await fetch(`/api/creative/bake/${id}/frame/${i}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
      if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || 'A frame could not be saved.');
      onProgress?.((i + 1) / src.count * 0.8);
    }
    const { job } = await api(`/api/creative/bake/${id}/finish`, {});
    return (await waitJob(job, p => onProgress?.(0.8 + p * 0.2))).asset;
  } catch (e) { api('/api/creative/bake/' + id, undefined, 'DELETE').catch(() => {}); throw e; }
  finally { src.done(); }
}
