// Transition controls: placement around the cut, easing presets, strength, motion blur, dip colour and
// smooth audio in the shared plan (preview and export use the same numbers), plus real FFmpeg renders.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startServer } = require('../desktop/server.cjs');
const { run, ffmpeg } = require('../desktop/tools.cjs');
const { newProject, newClip } = require('../shared/model.mjs');
const { buildPlan, layerState } = require('../shared/plan.mjs');
const { TRANSITIONS, TRANSITION_FAMILIES, transitionIn, transitionWindow, transitionCaps } = require('../shared/catalog.mjs');

const json = async r => { const d = await r.json(); if (!r.ok) throw Object.assign(Error(d.error), d); return d; };
const api = base => (url, body, method = body ? 'POST' : 'GET') => fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(json);
async function waitJob(call, id, ms = 120000) { const t = Date.now(); for (;;) { const j = await call('/api/jobs/' + id); if (!['queued', 'running'].includes(j.status)) return j; if (Date.now() - t > ms) throw Error('timeout'); await new Promise(r => setTimeout(r, 100)); } }

const media = { a: { id: 'a', kind: 'video', width: 640, height: 360, duration: 10, audio: true }, b: { id: 'b', kind: 'video', width: 640, height: 360, duration: 10, audio: true } };
function pair(transition) {
  const p = newProject({ ratio: '16:9' });
  const A = newClip('video', { trackId: 'main', mediaId: 'a', start: 0, duration: 4 });
  const B = newClip('video', { trackId: 'main', mediaId: 'b', start: 4, duration: 4, transition });
  p.clips.push(A, B); p.mediaIds.push('a', 'b');
  const plan = buildPlan(p, { W: 640, H: 360, media: id => media[id] });
  return { p, A, B, plan, LA: plan.layers.find(l => l.id === A.id), LB: plan.layers.find(l => l.id === B.id) };
}

test('Catalog: one tile per family, directions where they make sense, old ids still valid', () => {
  for (const id of ['dissolve', 'dip-black', 'dip-white', 'slide-left', 'push-up', 'zoom-in', 'zoom-out', 'spin']) assert.ok(TRANSITIONS.some(t => t.id === id), id + ' kept for saved projects');
  const fam = Object.fromEntries(TRANSITION_FAMILIES.map(f => [f.id, f]));
  assert.deepEqual(fam.whip.dirs, ['left', 'right', 'up', 'down']); assert.deepEqual(fam.dissolve.dirs, []);
  assert.equal(transitionIn('push', 'down').id, 'push-down'); assert.equal(transitionIn('zoom-in').id, 'zoom-in');
  assert.equal(transitionCaps(TRANSITIONS.find(t => t.id === 'dissolve')).motion, false);
  assert.equal(transitionCaps(TRANSITIONS.find(t => t.id === 'dip-black')).dip, true);
  assert.equal(transitionCaps(TRANSITIONS.find(t => t.id === 'zoom-through')).motion, true);
  const c = { start: 4, transition: {} };
  assert.deepEqual(transitionWindow(c, 1), [3.5, 4.5]); c.transition.align = 'end'; assert.deepEqual(transitionWindow(c, 1), [3, 4]); c.transition.align = 'start'; assert.deepEqual(transitionWindow(c, 1), [4, 5]);
});

test('Plan: placement, easing, strength, motion blur, dip colour and smooth audio', () => {
  // Legacy {id, duration} behaves exactly as before: centred on the cut.
  let r = pair({ id: 'dissolve', duration: 1 });
  assert.equal(r.LB.vs, 3.5); assert.equal(r.LA.ve, 4.5); assert.equal(r.LB.fades[0].st, 3.5);
  // Before the cut: the incoming clip starts early, the outgoing one is not extended.
  r = pair({ id: 'dissolve', duration: 1, align: 'end' }); assert.equal(r.LB.vs, 3); assert.equal(r.LA.ve, 4);
  r = pair({ id: 'dissolve', duration: 1, align: 'start' }); assert.equal(r.LB.vs, 4); assert.equal(r.LA.ve, 5, 'outgoing clip held past the cut');
  // Easing: linear is exactly halfway at the midpoint; the default (smooth) curve is too, but not at a quarter.
  const x = (tr, t) => layerState(pair(tr).LB, t).dx;
  assert.ok(Math.abs(x({ id: 'slide-left', duration: 1, ease: 'linear' }, 3.75) - 0.75 * 640) < 1, 'linear: 75% of the way to go at a quarter');
  assert.ok(Math.abs(x({ id: 'slide-left', duration: 1 }, 3.75) - (1 - 4 * 0.25 ** 3) * 640) < 1, 'default ease-in-out');
  assert.ok(x({ id: 'slide-left', duration: 1, ease: 'bounce' }, 4.3) < 0, 'bouncy overshoots past its resting place');
  assert.equal(x({ id: 'slide-left', duration: 1 }, 4.6), 0, 'settled after the window');
  // Strength scales the move.
  assert.ok(Math.abs(x({ id: 'slide-left', duration: 1, strength: 0.5, ease: 'linear' }, 4) - 0.25 * 640) < 1, 'half strength: half the distance at the midpoint');
  const s = tr => layerState(pair(tr).LB, 3.5).s;
  assert.ok(Math.abs((s({ id: 'zoom-in', duration: 1, ease: 'linear', strength: 2 }) - 1) - 2 * (s({ id: 'zoom-in', duration: 1, ease: 'linear' }) - 1)) < 1e-6, 'zoom strength scales the size change');
  // Motion blur: on both clips, peaking mid-move and only inside the window.
  r = pair({ id: 'whip-left', duration: 1 });
  assert.ok(r.LA.blurExpr && r.LB.blurExpr, 'whip has default motion blur'); assert.deepEqual(r.LB.blurWins, [[3.5, 4.5]]);
  const { evaluate } = require('../shared/expr.mjs');
  assert.ok(evaluate(r.LB.blurExpr, { t: 4 }) > 15 && evaluate(r.LB.blurExpr, { t: 3.4 }) === 0 && evaluate(r.LB.blurExpr, { t: 4.6 }) === 0);
  assert.equal(pair({ id: 'whip-left', duration: 1, blur: 0 }).LB.blurExpr, undefined, 'blur can be switched off');
  assert.equal(pair({ id: 'dissolve', duration: 1, blur: 1 }).LB.blurExpr, undefined, 'no motion blur on a dissolve');
  // Dip colour and step timing follow the window.
  r = pair({ id: 'dip-black', duration: 1, color: '#ff0080', align: 'end' });
  const dip = r.plan.layers.find(l => l.type === 'dip'); assert.equal(dip.color, '#ff0080'); assert.equal(dip.vs, 3); assert.equal(r.LB.steps[0].at, 3.5);
  assert.equal(pair({ id: 'dip-black', duration: 1, color: 'javascript:x' }).plan.layers.find(l => l.type === 'dip').color, '#000000', 'only real colours are used');
  // Smooth sound: the outgoing audio fades out into the cut, the incoming one fades in from it.
  r = pair({ id: 'dissolve', duration: 1, audio: 'smooth' });
  const [aa, ab] = [r.plan.audio.find(x => x.id === r.A.id), r.plan.audio.find(x => x.id === r.B.id)];
  assert.equal(aa.fadeOut, 0.5); assert.equal(ab.fadeIn, 0.5);
  assert.equal(pair({ id: 'dissolve', duration: 1 }).plan.audio.find(x => x.id === r.B.id)?.fadeIn ?? 0, 0, 'straight cut by default');
});

test('Export: new transition options render through FFmpeg the way the preview plans them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-tr-')); let s;
  try {
    // Coloured test pattern: solid colour for pixel checks, with detail so motion blur is measurable.
    const mk = async (name, color) => { const f = path.join(dir, name); await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=3', '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-shortest', '-vf', `drawbox=c=${color}@0.8:t=fill`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f]); return f; };
    s = await startServer({ dataDir: path.join(dir, 'data') }); const call = api(s.url);
    const [ra, ba] = (await call('/api/media/import', { paths: [await mk('red.mp4', 'red'), await mk('blue.mp4', 'blue')] })).assets;
    const render = async transition => {
      const p = await call('/api/projects', { name: 'tr' });
      p.clips.push(newClip('video', { trackId: 'main', mediaId: ra.id, start: 0, duration: 3, in: 0 }), newClip('video', { trackId: 'main', mediaId: ba.id, start: 3, duration: 3, in: 0, transition }));
      p.mediaIds.push(ra.id, ba.id); const out = path.join(dir, Math.random().toString(36).slice(2) + '.mp4');
      const j = await waitJob(call, (await call('/api/export', { project: p, rasters: {}, settings: { format: 'mp4', codec: 'h264', resolution: 720, fps: 30, quality: 'high', output: out, hardware: 'off' } })).job);
      assert.equal(j.status, 'done', j.error); return out;
    };
    // Frames are scaled to 640×360 before sampling, so coordinates don't depend on the export size.
    const px = async (file, t, x = 320, y = 180) => [...(await run(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=640:360,crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-'], { encoding: 'buffer' })).out.subarray(0, 3)];
    const sharp = async (file, t) => { const b = (await run(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=640:360,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' })).out; let e = 0; for (let i = 1; i < b.length; i++) e += Math.abs(b[i] - b[i - 1]); return e / b.length; };
    const red = c => c[0] > 150 && c[2] < 100, blue = c => c[2] > 150 && c[0] < 100;
    // Whip placed before the cut, with motion blur: red before, a blend mid-move, blue at the cut.
    const whip = await render({ id: 'whip-left', duration: 1, align: 'end', audio: 'smooth' });
    assert.ok(red(await px(whip, 1.8)), 'still red before the window');
    assert.ok(blue(await px(whip, 3.05)), 'blue once the whip has finished at the cut');
    assert.ok(red(await px(whip, 2.5, 160)) && blue(await px(whip, 2.5, 480)), 'half-way: outgoing on the left, incoming on the right');
    // Motion blur: the same moment rendered without blur has clearly more fine detail.
    const plain = await render({ id: 'whip-left', duration: 1, align: 'end', blur: 0 });
    // Averaged over the move (single frames vary with the encoder's frame types).
    const avg = async f => { let e = 0; for (const t of [2.3, 2.4, 2.6, 2.7]) e += await sharp(f, t); return e / 4; };
    const [eb, ep] = [await avg(whip), await avg(plain)];
    assert.ok(eb < 0.9 * ep, `motion blur softens the moving frames (${eb.toFixed(3)} vs ${ep.toFixed(3)} without)`);
    assert.ok(Math.abs(await sharp(whip, 1.8) - await sharp(plain, 1.8)) < 0.02, 'no blur outside the transition');
    // Pink dip to colour after the cut.
    const dip = await render({ id: 'dip-black', duration: 1, color: '#ff00ff', align: 'start' });
    const m = await px(dip, 3.5); assert.ok(m[0] > 180 && m[2] > 180 && m[1] < 80, 'dips through the chosen colour: ' + m);
    assert.ok(red(await px(dip, 2.8)), 'outgoing clip untouched before an after-cut transition');
  } finally { await s?.close(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});
