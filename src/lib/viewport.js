// Viewport geometry and transform commands: real transformed bounds of visible layers, nudging, align/distribute
// and resets. Positions are written through writeProp, so animated (keyframed) clips get a key at the playhead.
import { project, selection, time, player, commit, toast } from './state.js';
import { layerState } from '../../shared/plan.mjs';
import { propValue, writeProp } from '../../shared/keys.mjs';
import { rotatedBounds, alignBoxes } from '../../shared/snap.mjs';

// Axis-aligned bounds (canvas px) of a plan layer at time t, including animation, keyframes and rotation.
export function layerBox(L, t) {
  const st = layerState(L, t);
  return { ...rotatedBounds(L.cx + st.dx, L.cy + st.dy, L.baseW * st.s, L.baseH * st.s, st.r), st, id: L.id };
}
export const isPositionable = L => (L.type === 'media' || L.type === 'raster') && L.clip.kind !== 'adjust';
export function visibleLayers(plan, t) { return plan ? plan.layers.filter(L => isPositionable(L) && t >= L.vs && t < L.ve) : []; }
const lockedTrack = (p, c) => p.tracks.find(tr => tr.id === c.trackId)?.locked;
export const canMove = (p, c) => c && !c.locked && !lockedTrack(p, c);

// Selected clips that are on screen right now, primary first.
export function selectedLayers() {
  const plan = player.current?.getPlan(); const t = time.value; if (!plan) return [];
  const vis = visibleLayers(plan, t);
  return selection.value.map(id => vis.find(L => L.id === id)).filter(Boolean);
}

// Move clips by canvas pixels (one undo entry per gesture or key-repeat burst).
export function moveBy(ids, dxPx, dyPx, { label = 'Move', key } = {}) {
  const plan = player.current?.getPlan(); if (!plan || !ids.length) return;
  const { W, H } = plan, t = time.value;
  commit(label, p => {
    let any = false;
    for (const id of ids) {
      const x = p.clips.find(c => c.id === id); if (!canMove(p, x)) continue; any = true;
      const u = Math.min(Math.max(0, t - x.start), x.duration);
      if (dxPx) writeProp(x, 'x', round(propValue(x, 'x', u) + dxPx / W), u);
      if (dyPx) writeProp(x, 'y', round(propValue(x, 'y', u) + dyPx / H), u);
    }
    if (!any) return false;
  }, { key });
}
const round = v => Math.round(v * 1e6) / 1e6 || 0;

export function nudge(dx, dy) {
  const p = project.value; const ids = selectedLayers().map(L => L.id).filter(id => canMove(p, p.clips.find(c => c.id === id)));
  if (!ids.length) return false;
  moveBy(ids, dx, dy, { label: 'Nudge', key: 'nudge:' + ids.join(',') });
  return true;
}

// how: left | hcenter | right | top | vcenter | bottom | center | dist-h | dist-v. One object aligns to the frame;
// several align to their combined bounds (or to the frame with toFrame).
export function align(how, { toFrame = false } = {}) {
  const plan = player.current?.getPlan(); if (!plan) return;
  const p = project.value, t = time.value;
  const layers = selectedLayers().filter(L => canMove(p, L.clip));
  if (!layers.length) return toast('Select something in the viewer to align it.', 'warn');
  if (how.startsWith('dist') && layers.length < 3) return toast('Select three or more objects to distribute them.', 'warn');
  const boxes = layers.map(L => layerBox(L, t));
  const frame = toFrame || layers.length === 1 ? { l: 0, r: plan.W, t: 0, b: plan.H } : null;
  const offs = alignBoxes(boxes, how, frame);
  commit(how.startsWith('dist') ? 'Distribute' : 'Align', d => {
    layers.forEach((L, i) => {
      const x = d.clips.find(c => c.id === L.id); if (!x) return; const u = Math.min(Math.max(0, t - x.start), x.duration);
      if (offs[i].dx) writeProp(x, 'x', round(propValue(x, 'x', u) + offs[i].dx / plan.W), u);
      if (offs[i].dy) writeProp(x, 'y', round(propValue(x, 'y', u) + offs[i].dy / plan.H), u);
    });
  });
}

export function resetProps(props, ids = selection.value) {
  const t = time.value; const defs = { x: 0, y: 0, scale: 1, rotation: 0 };
  commit('Reset ' + (props.length > 1 ? 'transform' : props[0] === 'x' ? 'position' : props[0]), d => {
    for (const id of ids) { const x = d.clips.find(c => c.id === id); if (!x || x.kind === 'audio' || !canMove(d, x)) continue; const u = Math.min(Math.max(0, t - x.start), x.duration); for (const k of props) writeProp(x, k, defs[k], u); }
  });
}
export function toggleLock(ids = selection.value) {
  const p = project.value; const cs = p.clips.filter(c => ids.includes(c.id)); if (!cs.length) return;
  const lock = cs.some(c => !c.locked);
  commit(lock ? 'Lock' : 'Unlock', d => { for (const x of d.clips) if (ids.includes(x.id)) x.locked = lock; });
}
