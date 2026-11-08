// Multi-select keyframe editing on the timeline. A "key" here is one diamond: every transform property's
// keyframe at that clip-local time on one clip. Selection entries are { id, t } (clip id, clip-local seconds).
import { signal } from '@preact/signals';
import { project, commit, time, toast, primary } from './state.js';
import { KEY_PROPS } from '../../shared/keys.mjs';
import { clipEnd } from '../../shared/model.mjs';

export const keySel = signal([]);
export const keyDrag = signal(null); // { dt } while dragging selected diamonds
const SAME = 1 / 240;
export const sameKey = (a, b) => a.id === b.id && Math.abs(a.t - b.t) < SAME;
export const isKeySelected = (id, t) => keySel.value.some(k => k.id === id && Math.abs(k.t - t) < SAME);
export const keyTimes = c => [...new Set(KEY_PROPS.flatMap(p => (c.keyframes?.[p] || []).map(k => +k.t.toFixed(4))))].sort((a, b) => a - b).filter(t => t <= c.duration + 1e-6);

export function toggleKey(id, t, additive) {
  const hit = keySel.value.some(k => sameKey(k, { id, t }));
  if (!additive) keySel.value = [{ id, t }];
  else keySel.value = hit ? keySel.value.filter(k => !sameKey(k, { id, t })) : [...keySel.value, { id, t }];
}
export const clearKeys = () => { if (keySel.value.length) keySel.value = []; };

// Applies fn(list, entry, clip) to every property key under the selected diamonds, inside one commit.
function eachSelected(d, fn) {
  for (const s of keySel.value) {
    const c = d.clips.find(x => x.id === s.id); if (!c?.keyframes) continue;
    for (const p of KEY_PROPS) { const list = c.keyframes[p]; if (!list) continue; for (const k of list) if (Math.abs(k.t - s.t) < SAME) fn(k, p, c); }
  }
}
function tidy(c) {
  for (const p of KEY_PROPS) {
    const list = c.keyframes?.[p]; if (!list) continue;
    list.sort((a, b) => a.t - b.t);
    // Keys that now share a time: the moved one (marked) wins.
    const out = []; for (const k of list) { const prev = out.at(-1); if (prev && Math.abs(prev.t - k.t) < 1 / 60) { if (k._moved || !prev._moved) out[out.length - 1] = k; } else out.push(k); }
    for (const k of out) delete k._moved;
    if (out.length) c.keyframes[p] = out; else delete c.keyframes[p];
  }
  if (c.keyframes && !Object.keys(c.keyframes).length) delete c.keyframes;
}

// Shift selected diamonds by dt seconds (clamped per clip). One undo entry.
export function moveKeys(dt) {
  if (!keySel.value.length || !dt) return;
  const next = [];
  commit(keySel.value.length > 1 ? 'Move keyframes' : 'Move keyframe', d => {
    const touched = new Set();
    for (const s of keySel.value) {
      const c = d.clips.find(x => x.id === s.id); if (!c?.keyframes) continue;
      const nt = Math.min(c.duration, Math.max(0, s.t + dt));
      for (const p of KEY_PROPS) for (const k of c.keyframes[p] || []) if (Math.abs(k.t - s.t) < SAME && !k._done) { k.t = nt; k._moved = true; k._done = true; }
      touched.add(c); next.push({ id: s.id, t: +nt.toFixed(4) });
    }
    for (const c of touched) { for (const p of KEY_PROPS) for (const k of c.keyframes?.[p] || []) delete k._done; tidy(c); }
  });
  keySel.value = next;
}
export function deleteKeys() {
  const n = keySel.value.length; if (!n) return false;
  commit(n > 1 ? `Delete ${n} keyframes` : 'Delete keyframe', d => {
    const touched = new Set();
    for (const s of keySel.value) {
      const c = d.clips.find(x => x.id === s.id); if (!c?.keyframes) continue;
      for (const p of KEY_PROPS) {
        const list = c.keyframes[p]; if (!list) continue;
        // Removing the last key of a property keeps the value it had there as the static value.
        const rest = list.filter(k => Math.abs(k.t - s.t) >= SAME);
        if (!rest.length) { c.transform ||= {}; c.transform[p] = list[0].v; }
        c.keyframes[p] = rest;
      }
      touched.add(c);
    }
    for (const c of touched) tidy(c);
  });
  keySel.value = [];
  return true;
}
export function setKeyEasing(e) {
  if (!keySel.value.length) return;
  commit('Keyframe easing', d => { eachSelected(d, k => { k.e = e; }); });
}

// Copy/paste of keys: times relative to the earliest copied key, pasted onto the selected clip at the playhead.
let keyClipboard = null;
export const lastCopy = { kind: null };
export function copyKeys() {
  const p = project.value; if (!keySel.value.length) return false;
  const base = Math.min(...keySel.value.map(s => s.t)); const out = [];
  for (const s of keySel.value) { const c = p.clips.find(x => x.id === s.id); if (!c?.keyframes) continue; for (const pr of KEY_PROPS) for (const k of c.keyframes[pr] || []) if (Math.abs(k.t - s.t) < SAME) out.push({ p: pr, t: k.t - base, v: k.v, e: k.e }); }
  keyClipboard = out; lastCopy.kind = 'keys'; return out.length > 0;
}
export function pasteKeys() {
  const c = primary.value; if (!keyClipboard?.length) return false;
  if (!c || c.kind === 'audio') { toast('Select a clip to paste keyframes onto.', 'warn'); return true; }
  const u0 = time.value - c.start;
  if (u0 < -1e-6 || time.value > clipEnd(c) + 1e-6) { toast('Put the playhead over the selected clip to paste keyframes there.', 'warn'); return true; }
  const added = [];
  commit('Paste keyframes', d => {
    const x = d.clips.find(k => k.id === c.id); x.keyframes ||= {};
    for (const k of keyClipboard) {
      const t = u0 + k.t; if (t > x.duration + 1e-6) continue;
      const list = (x.keyframes[k.p] ||= []);
      list.push({ t, v: k.v, e: k.e || 'smooth', _moved: true }); added.push(+t.toFixed(4));
    }
    tidy(x);
  });
  keySel.value = [...new Set(added)].map(t => ({ id: c.id, t }));
  return true;
}
