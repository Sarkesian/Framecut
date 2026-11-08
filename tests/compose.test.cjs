// Real FFmpeg renders of the v2 layer plan: transitions, text, effects, LUT filters, adjustment layers, audio.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { run, ffmpeg, ffprobe } = require('../desktop/tools.cjs');
const { renderPlan } = require('../desktop/compose.cjs');
const { newProject, newClip, migrateV1, normalizeProject } = require('../shared/model.mjs');
const { lutCube } = require('../shared/catalog.mjs');

async function probe(file) { return JSON.parse((await run(ffprobe, ['-v', 'quiet', '-show_format', '-show_streams', '-of', 'json', file])).out); }
async function frameRGB(file, t, w = 64, h = 36) {
  const { out } = await run(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' });
  return out;
}
const mean = (buf, ch) => { let s = 0, n = 0; for (let i = ch; i < buf.length; i += 3) { s += buf[i]; n++; } return s / n; };

async function fixtures(dir) {
  const red = path.join(dir, 'red.mp4'), blue = path.join(dir, 'blue.mp4'), tone = path.join(dir, 'tone.wav'), text = path.join(dir, 'text.png');
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', red]);
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=360x640:r=30', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', blue]);
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '6', tone]);
  await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=white:s=200x60', '-frames:v', '1', text]);
  const assets = new Map([
    ['red', { path: red, kind: 'video', video: true, audio: true, duration: 4, width: 640, height: 360 }],
    ['blue', { path: blue, kind: 'video', video: true, audio: false, duration: 4, width: 360, height: 640 }],
    ['tone', { path: tone, kind: 'audio', video: false, audio: true, duration: 6 }],
  ]);
  return { assets, text };
}

test('Composite export: transition, text, effects, filter, adjustment layer and audio mix', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-compose-'));
  try {
    const { assets, text } = await fixtures(dir);
    const p = newProject({ ratio: '16:9', resolution: 480 });
    p.tracks = [{ id: 'fx', kind: 'effect', name: 'Effects' }, { id: 'text-1', kind: 'text', name: 'Text' }, { id: 'main', kind: 'video', name: 'Main', main: true }, { id: 'audio-1', kind: 'audio', name: 'Audio' }];
    p.clips.push(newClip('video', { trackId: 'main', mediaId: 'red', start: 0, duration: 3, in: 0.5, color: { saturation: 1.2 }, effects: [{ id: 'vignette', amount: 0.5 }], filter: { id: 'vivid', intensity: 0.6 } }));
    p.clips.push(newClip('video', { trackId: 'main', mediaId: 'blue', start: 3, duration: 3, transition: { id: 'push-left', duration: 1 }, animLoop: { id: 'pulse' }, transform: { rotation: 10 } }));
    p.clips.push(newClip('text', { trackId: 'text-1', start: 0.5, duration: 2, text: 'Hello', animIn: { id: 'pop', duration: 0.4 }, animOut: { id: 'fade', duration: 0.4 } }));
    p.clips.push(newClip('adjust', { trackId: 'fx', start: 4.5, duration: 1, effects: [{ id: 'grain', amount: 0.5 }, { id: 'glitch', amount: 0.6 }], filter: { id: 'noir', intensity: 1 } }));
    p.clips.push(newClip('audio', { trackId: 'audio-1', mediaId: 'tone', start: 1, duration: 4, in: 0.5, speed: 1.25, volume: 0.6, fadeIn: 0.5, fadeOut: 0.5 }));
    for (const id of ['vivid', 'noir']) await fs.writeFile(path.join(dir, `lut-${id}.cube`), lutCube(id));
    const plan = renderPlan(p, { assets, rasters: { [p.clips[2].id]: { file: text, w: 200, h: 60 } }, luts: { vivid: 'lut-vivid.cube', noir: 'lut-noir.cube' }, settings: { format: 'mp4', resolution: 480, fps: 30, quality: 'balanced' } });
    await fs.writeFile(path.join(dir, 'graph.txt'), plan.graph);
    const out = path.join(dir, 'out.mp4');
    await run(ffmpeg, [...plan.args, out], { cwd: dir });
    const info = await probe(out);
    const v = info.streams.find(s => s.codec_type === 'video');
    assert.equal(v.width, 854); assert.equal(v.height, 480);
    assert.ok(info.streams.some(s => s.codec_type === 'audio'));
    assert.ok(Math.abs(+info.format.duration - 6) < 0.15, 'duration ' + info.format.duration);
    const early = await frameRGB(out, 1.0), late = await frameRGB(out, 4.0), noir = await frameRGB(out, 5.0);
    assert.ok(mean(early, 0) > 120 && mean(early, 2) < 80, 'first clip is red');
    assert.ok(mean(late, 2) > mean(late, 0), 'second clip is blue after the transition');
    assert.ok(Math.abs(mean(noir, 0) - mean(noir, 2)) < 12, 'adjustment layer applies black & white');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('All export containers produce playable files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-formats-'));
  try {
    const { assets } = await fixtures(dir);
    const p = newProject({ ratio: '9:16', resolution: 480 });
    p.clips.push(newClip('video', { trackId: 'main', mediaId: 'red', start: 0, duration: 1.5 }));
    for (const [format, codec] of [['mp4', 'h264'], ['mp4', 'hevc'], ['mov', 'prores'], ['webm', 'vp9'], ['mkv', 'h264'], ['avi', 'mpeg4'], ['flv', 'h264'], ['gif', 'gif'], ['mp3'], ['wav'], ['m4a'], ['flac'], ['ogg']]) {
      const plan = renderPlan(p, { assets, settings: { format, codec, resolution: 480, fps: 30, quality: 'small' } });
      await fs.writeFile(path.join(dir, 'graph.txt'), plan.graph);
      const out = path.join(dir, `out-${format}-${codec || 'a'}.${plan.ext}`);
      await run(ffmpeg, [...plan.args, out], { cwd: dir });
      const info = await probe(out);
      const hasVideo = info.streams.some(s => s.codec_type === 'video');
      assert.equal(hasVideo, ['mp4', 'mov', 'webm', 'mkv', 'avi', 'flv', 'gif'].includes(format), format);
      if (format !== 'gif') assert.ok(info.streams.some(s => s.codec_type === 'audio'), format + ' has audio');
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('Version 1 projects migrate to the multitrack format', () => {
  const v1 = { version: 1, name: 'Old', ratio: '9:16', fit: 'contain', resolution: 1080, fps: 30, clips: [{ id: 'a', mediaId: 'm', start: 2, end: 6, speed: 2, volume: 0.5, fade: 0.25, brightness: 0.1, contrast: 1, saturation: 1 }], audioClips: [{ id: 'b', mediaId: 'm', start: 0, end: 3, speed: 1, position: 1, volume: 0.7, fadeIn: 0.3, fadeOut: 0 }], captions: [{ start: 0, end: 1, text: 'Hi', words: [{ start: 0, end: 1, text: 'Hi' }] }], titles: [{ start: 0, end: 2, text: 'Title' }], burnCaptions: true, canvasBackground: 'blur', canvasBlur: 28 };
  const p = normalizeProject(v1);
  assert.equal(p.version, 2); assert.equal(p.settings.ratio, '9:16'); assert.equal(p.settings.background.type, 'blur');
  const main = p.clips.find(c => c.trackId === 'main');
  assert.equal(main.duration, 2); assert.equal(main.in, 2); assert.equal(main.animIn.id, 'fade');
  assert.equal(p.clips.filter(c => c.kind === 'text').length, 2);
  assert.equal(p.clips.find(c => c.kind === 'audio').start, 1);
  assert.deepEqual(migrateV1(v1).mediaIds, ['m']);
});

test('Keyframes: position, scale and opacity animate identically in the plan and the export', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-keys-'));
  try {
    const { assets } = await fixtures(dir);
    const { buildPlan, layerState } = await import('../shared/plan.mjs');
    const p = newProject({ ratio: '16:9', resolution: 480 });
    p.settings.background = { type: 'color', color: '#000000' };
    // A red box moves from left to right, grows and fades out over 4 s.
    const c = newClip('video', { trackId: 'main', mediaId: 'red', start: 0, duration: 4, fit: 'contain', transform: { scale: 0.25 } });
    c.keyframes = { x: [{ t: 0.5, v: -0.3, e: 'linear' }, { t: 3.5, v: 0.3, e: 'linear' }], scale: [{ t: 0, v: 0.2, e: 'smooth' }, { t: 4, v: 0.4 }], opacity: [{ t: 2.5, v: 1, e: 'linear' }, { t: 3.5, v: 0.2 }] };
    p.clips.push(c);
    const plan = renderPlan(p, { assets, rasters: {}, luts: {}, settings: { format: 'mp4', resolution: 480, fps: 30, quality: 'balanced' } });
    await fs.writeFile(path.join(dir, 'graph.txt'), plan.graph);
    const out = path.join(dir, 'keys.mp4');
    await run(ffmpeg, [...plan.args, out], { cwd: dir });
    const W = 854, H = 480, pp = buildPlan(p, { W, H, media: id => assets.get(id) }), L = pp.layers.find(l => l.id === c.id);
    for (const t of [0.5, 2, 3.5]) {
      const st = layerState(L, t), buf = await frameRGB(out, t, W, H);
      let sx = 0, n = 0, maxR = 0;
      for (let i = 0; i < W * H; i++) { const r = buf[i * 3]; if (r > 40) { sx += i % W; n++; } if (r > maxR) maxR = r; }
      const cx = sx / n, expectX = L.cx + st.dx, expectW = L.baseW * st.s;
      const width = n / (L.baseH * st.s);
      assert.ok(Math.abs(cx - expectX) < 4, `t=${t} centre ${cx.toFixed(1)} vs ${expectX.toFixed(1)}`);
      assert.ok(Math.abs(width - expectW) / expectW < 0.06, `t=${t} width ${width.toFixed(1)} vs ${expectW.toFixed(1)}`);
      assert.ok(Math.abs(maxR / 255 - st.alpha * 0.92) < 0.12, `t=${t} brightness ${maxR} vs alpha ${st.alpha.toFixed(2)}`);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('Keyframes survive split, trim and speed changes without jumps', async () => {
  const { shiftKeys, propValue } = await import('../shared/keys.mjs');
  const c = newClip('video', { start: 0, duration: 4, transform: { x: 0 } });
  c.keyframes = { x: [{ t: 0, v: -0.5, e: 'linear' }, { t: 4, v: 0.5, e: 'linear' }] };
  const before = propValue(c, 'x', 1.5);
  const right = structuredClone(c); shiftKeys(right, 1, 3); right.duration = 3;
  assert.ok(Math.abs(propValue(right, 'x', 0.5) - before) < 1e-9, 'value preserved after trimming 1 s from the start');
  assert.ok(Math.abs(propValue(right, 'x', 3) - 0.5) < 1e-9, 'end value preserved');
});
