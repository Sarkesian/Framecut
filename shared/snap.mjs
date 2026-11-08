// Snapping math shared by the timeline and the viewport. Pure functions so they are unit-tested directly.
import { clipEnd } from './model.mjs';

// ---------- Time ----------
export const toFrame = (t, fps) => Math.round(t * fps) / fps;

// A duration d such that start + d === end exactly in floating point, so a snapped edge lands on the
// target's exact value instead of 1 ulp beside it.
export function spanTo(start, end) {
  let d = end - start;
  for (let i = 0; i < 4 && start + d !== end; i++) d += (end - (start + d));
  if (start + d !== end) { const u = Math.max(Number.EPSILON, Math.abs(end) * Number.EPSILON); d += start + d < end ? u : -u; }
  return d;
}

// Snap targets on the timeline: project start/end, clip edges on every track, markers and the playhead.
// `exclude` holds ids of clips being dragged (their own edges are never targets).
export function timelineTargets(p, { exclude = new Set(), playhead = null } = {}) {
  const out = [{ t: 0, kind: 'start' }];
  let end = 0;
  for (const c of p.clips) {
    if (exclude.has(c.id)) continue;
    end = Math.max(end, clipEnd(c));
    out.push({ t: c.start, kind: 'edge', clipId: c.id }, { t: clipEnd(c), kind: 'edge', clipId: c.id });
  }
  if (end > 0) out.push({ t: end, kind: 'end' });
  for (const m of p.markers || []) out.push({ t: m.t, kind: 'marker' });
  if (playhead !== null && Number.isFinite(playhead)) out.push({ t: playhead, kind: 'playhead' });
  return out;
}

// Snap one or more candidate edges (e.g. a moved clip's start and end) to the nearest target.
// threshold is in seconds (callers pass pixels / zoom so it feels the same at every zoom level).
// `prev` is the previous result: a target that is already engaged keeps hold until the pointer leaves
// 1.5× the threshold, which removes flicker between two close targets.
// Returns { delta, target, edge } or null. Edge i snapped: candidate[i] + delta === target.t
export function snapEdges(candidates, targets, threshold, prev = null) {
  if (prev?.target) {
    const i = prev.edge, d = prev.target.t - candidates[i];
    if (i < candidates.length && Math.abs(d) <= threshold * 1.5 && targets.some(t => t.t === prev.target.t)) return { delta: d, target: prev.target, edge: i };
  }
  let best = null;
  candidates.forEach((c, i) => {
    for (const t of targets) {
      const d = t.t - c; const ad = Math.abs(d);
      if (ad > threshold) continue;
      // Prefer the closest; on a tie prefer clip edges over the playhead (more deliberate targets).
      if (!best || ad < Math.abs(best.delta) - 1e-9 || (Math.abs(ad - Math.abs(best.delta)) <= 1e-9 && best.target.kind === 'playhead')) best = { delta: d, target: t, edge: i };
    }
  });
  return best;
}

// ---------- Viewport ----------
// Axis-aligned bounds of a w×h box centred at (cx, cy) rotated by r degrees: the visual extent used for alignment.
export function rotatedBounds(cx, cy, w, h, r = 0) {
  const a = r * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hw = (w * c + h * s) / 2, hh = (w * s + h * c) / 2;
  return { l: cx - hw, r: cx + hw, t: cy - hh, b: cy + hh, cx, cy, w: hw * 2, h: hh * 2 };
}

// Targets in canvas pixels: frame edges and centre, optional safe area, and other visible objects' edges and centres.
export function viewportTargets(W, H, { safe = null, others = [] } = {}) {
  const x = [{ v: 0, kind: 'frame' }, { v: W / 2, kind: 'center' }, { v: W, kind: 'frame' }];
  const y = [{ v: 0, kind: 'frame' }, { v: H / 2, kind: 'center' }, { v: H, kind: 'frame' }];
  if (safe) for (const m of [].concat(safe)) { x.push({ v: W * m, kind: 'safe' }, { v: W * (1 - m), kind: 'safe' }); y.push({ v: H * m, kind: 'safe' }, { v: H * (1 - m), kind: 'safe' }); }
  for (const o of others) {
    for (const v of [o.l, o.cx, o.r]) x.push({ v, kind: 'object', box: o });
    for (const v of [o.t, o.cy, o.b]) y.push({ v, kind: 'object', box: o });
  }
  return { x, y };
}

// Snap a moving box. threshold is in canvas pixels (callers convert from screen pixels using the preview scale,
// so snapping feels the same at every viewport zoom). Returns the offset to apply and the guides to draw.
export function snapBox(box, targets, threshold, prev = null) {
  const axis = (edges, list, prevHit) => {
    if (prevHit) {
      const d = prevHit.v - edges[prevHit.edge];
      if (Math.abs(d) <= threshold * 1.5 && list.some(t => t.v === prevHit.v)) return { ...prevHit, d };
    }
    let best = null;
    edges.forEach((e, i) => { for (const t of list) { const d = t.v - e; if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d) - 1e-9 || (Math.abs(Math.abs(d) - Math.abs(best.d)) <= 1e-9 && rank(t) > rank(best)))) best = { d, v: t.v, edge: i, kind: t.kind, box: t.box }; } });
    return best;
  };
  const hx = axis([box.l, box.cx, box.r], targets.x, prev?.x), hy = axis([box.t, box.cy, box.b], targets.y, prev?.y);
  return { dx: hx ? hx.d : 0, dy: hy ? hy.d : 0, x: hx, y: hy };
}
const rank = t => (t.kind === 'center' ? 3 : t.kind === 'frame' ? 2 : t.kind === 'object' ? 1 : 0);

// Align/distribute boxes (canvas px). Returns per-box {dx, dy} offsets.
export function alignBoxes(boxes, how, frame) {
  const ref = frame || (boxes.length > 1 ? { l: Math.min(...boxes.map(b => b.l)), r: Math.max(...boxes.map(b => b.r)), t: Math.min(...boxes.map(b => b.t)), b: Math.max(...boxes.map(b => b.b)) } : null);
  if (!ref) return boxes.map(() => ({ dx: 0, dy: 0 }));
  const rcx = (ref.l + ref.r) / 2, rcy = (ref.t + ref.b) / 2;
  if (how === 'dist-h' || how === 'dist-v') {
    const h = how === 'dist-h', order = boxes.map((b, i) => ({ b, i })).sort((a, z) => (h ? a.b.cx - z.b.cx : a.b.cy - z.b.cy));
    const out = boxes.map(() => ({ dx: 0, dy: 0 })); if (boxes.length < 3) return out;
    const first = order[0].b, last = order.at(-1).b;
    const total = order.reduce((s, o) => s + (h ? o.b.r - o.b.l : o.b.b - o.b.t), 0);
    const gap = ((h ? last.r - first.l : last.b - first.t) - total) / (order.length - 1);
    let cur = h ? first.l : first.t;
    for (const { b, i } of order) { const size = h ? b.r - b.l : b.b - b.t; if (h) out[i].dx = cur - b.l; else out[i].dy = cur - b.t; cur += size + gap; }
    return out;
  }
  return boxes.map(b => ({
    dx: how === 'left' ? ref.l - b.l : how === 'right' ? ref.r - b.r : how === 'hcenter' || how === 'center' ? rcx - b.cx : 0,
    dy: how === 'top' ? ref.t - b.t : how === 'bottom' ? ref.b - b.b : how === 'vcenter' || how === 'center' ? rcy - b.cy : 0,
  }));
}
