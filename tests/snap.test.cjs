// Snapping math shared by the timeline and the viewer (shared/snap.mjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../shared/snap.mjs');

const proj = clips => ({ tracks: [{ id: 'main', kind: 'video', main: true }, { id: 'text-1', kind: 'text' }], clips, markers: [{ t: 7.25 }] });

test('spanTo makes start + duration land exactly on the target', async () => {
  const { spanTo } = await load();
  for (const [s, e] of [[0.5, 23.45], [0.1, 0.3], [1 / 3, 23.450000000000003], [12.345678, 98.7654321], [0, 1e-3]]) assert.equal(s + spanTo(s, e), e, `${s} → ${e}`);
});

test('timeline targets: project start/end, clip edges, markers and playhead; dragged clips excluded', async () => {
  const { timelineTargets } = await load();
  const p = proj([{ id: 'v', trackId: 'main', start: 0, duration: 23.45 }, { id: 't', trackId: 'text-1', start: 2, duration: 3 }]);
  const ts = timelineTargets(p, { exclude: new Set(['t']), playhead: 4 });
  const at = ts.map(x => x.t);
  assert.ok(at.includes(0) && at.includes(23.45) && at.includes(7.25) && at.includes(4));
  assert.ok(!at.includes(2) && !at.includes(5), 'own edges are not targets');
  assert.ok(ts.some(x => x.kind === 'end' && x.t === 23.45));
});

test('snapEdges snaps the nearest candidate edge within the threshold, exactly', async () => {
  const { snapEdges, timelineTargets } = await load();
  const p = proj([{ id: 'v', trackId: 'main', start: 0, duration: 23.45 }]);
  const targets = timelineTargets(p);
  // A text overlay's end dragged to 23.41 with an 8 px threshold at 80 px/s (0.1 s) snaps to the video end.
  const hit = snapEdges([23.41], targets, 8 / 80);
  assert.equal(hit.target.t, 23.45); assert.equal(23.41 + hit.delta, 23.41 + (23.45 - 23.41));
  // Same pixel distance at a different zoom: 3 px away at 400 px/s snaps; 12 px away does not.
  assert.ok(snapEdges([23.45 - 3 / 400], targets, 8 / 400));
  assert.equal(snapEdges([23.45 - 12 / 400], targets, 8 / 400), null);
  // With two candidates (clip start and end) the closer edge wins.
  const two = snapEdges([7.2, 23.40], targets, 0.1);
  assert.equal(two.target.t, 7.25); assert.equal(two.edge, 0);
});

test('snapEdges holds an engaged target (hysteresis) so it does not flicker between close targets', async () => {
  const { snapEdges } = await load();
  const targets = [{ t: 10, kind: 'edge' }, { t: 10.12, kind: 'edge' }];
  const first = snapEdges([10.02], targets, 0.1);
  assert.equal(first.target.t, 10);
  // Pointer moves to 10.07: the nearest target is now 10.12, but 10 stays engaged within 1.5× threshold.
  const held = snapEdges([10.07], targets, 0.1, first);
  assert.equal(held.target.t, 10);
  // Past 1.5× threshold it releases and picks the nearest.
  const moved = snapEdges([10.16], targets, 0.1, held);
  assert.equal(moved.target.t, 10.12);
});

test('toFrame rounds to the project frame grid', async () => {
  const { toFrame } = await load();
  assert.equal(toFrame(1.01, 30), 1); assert.equal(toFrame(1.02, 30), 31 / 30); assert.equal(toFrame(2.51, 25), 2.52);
});

test('rotatedBounds gives the true extent of a rotated box', async () => {
  const { rotatedBounds } = await load();
  const b = rotatedBounds(100, 50, 40, 20, 90);
  assert.ok(Math.abs(b.l - 90) < 1e-9 && Math.abs(b.r - 110) < 1e-9 && Math.abs(b.t - 30) < 1e-9 && Math.abs(b.b - 70) < 1e-9);
  const d = rotatedBounds(0, 0, 10, 10, 45); assert.ok(Math.abs(d.w - 10 * Math.SQRT2) < 1e-9);
});

test('snapBox centres an object near the middle and aligns edges to the frame and to other objects', async () => {
  const { snapBox, viewportTargets, rotatedBounds } = await load();
  const W = 1920, H = 1080;
  const tg = viewportTargets(W, H, { safe: [0.05], others: [rotatedBounds(400, 300, 200, 100, 0)] });
  // 4 px off-centre horizontally and 3 px vertically → snaps to exact centre on both axes.
  const c = snapBox(rotatedBounds(W / 2 + 4, H / 2 - 3, 300, 80, 0), tg, 8);
  assert.equal(c.dx, -4); assert.equal(c.dy, 3); assert.equal(c.x.kind, 'center'); assert.equal(c.y.kind, 'center');
  // Left edge 5 px from the frame's left edge → snaps to 0.
  const l = snapBox(rotatedBounds(155, 700, 300, 80, 0), tg, 8);
  assert.equal(l.dx, -5); assert.equal(l.x.kind, 'frame');
  // Right edge near the safe-area line at 95 %.
  const s = snapBox(rotatedBounds(W * 0.95 - 150 + 6, 700, 300, 80, 0), tg, 8);
  assert.equal(s.dx, -6); assert.equal(s.x.kind, 'safe');
  // Top edge aligned with another object's top.
  const o = snapBox(rotatedBounds(1200, 250 + 40 + 4, 300, 80, 0), tg, 8);
  assert.equal(o.dy, -4); assert.equal(o.y.kind, 'object');
  // Far from everything: no snap.
  const n = snapBox(rotatedBounds(700, 760, 300, 80, 0), tg, 8);
  assert.equal(n.dx, 0); assert.equal(n.dy, 0); assert.equal(n.x, null); assert.equal(n.y, null);
});

test('alignBoxes aligns to a frame and distributes with equal gaps', async () => {
  const { alignBoxes, rotatedBounds } = await load();
  const frame = { l: 0, r: 1000, t: 0, b: 500 };
  const [a] = alignBoxes([rotatedBounds(300, 200, 100, 50, 0)], 'right', frame); assert.equal(a.dx, 650);
  const [m] = alignBoxes([rotatedBounds(300, 200, 100, 50, 0)], 'center', frame); assert.equal(m.dx, 200); assert.equal(m.dy, 50);
  const boxes = [rotatedBounds(50, 0, 100, 10, 0), rotatedBounds(200, 0, 100, 10, 0), rotatedBounds(950, 0, 100, 10, 0)];
  const d = alignBoxes(boxes, 'dist-h');
  const ls = boxes.map((b, i) => b.l + d[i].dx); assert.deepEqual(ls, [0, 450, 900]);
});
