// Transform keyframes. Times are clip-local seconds (0 = clip start on the timeline).
// The same key list becomes an FFmpeg expression for export and is evaluated directly for the preview.
import { fmtNum as f } from './expr.mjs';

export const KEY_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'];
export const EASINGS = [{ id: 'smooth', name: 'Smooth' }, { id: 'linear', name: 'Linear' }, { id: 'hold', name: 'Hold' }];
const EPS = 1 / 240;

const sorted = keys => (keys || []).slice().sort((a, b) => a.t - b.t);
const ease = (e, p) => (e === 'hold' ? 0 : e === 'linear' ? p : p * p * (3 - 2 * p));

export function keyValue(keys, u, fallback) {
  const k = sorted(keys); if (!k.length) return fallback;
  if (u <= k[0].t) return k[0].v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (u < b.t) { const p = Math.min(1, Math.max(0, (u - a.t) / Math.max(EPS, b.t - a.t))); return a.v + (b.v - a.v) * ease(a.e, p); }
  }
  return k[k.length - 1].v;
}

// FFmpeg expression of absolute time t for a key list on a clip that starts at `start`.
export function keyExpr(keys, start) {
  const k = sorted(keys); if (!k.length) return null;
  const u = `(t-${f(start)})`;
  let expr = f(k[k.length - 1].v);
  for (let i = k.length - 2; i >= 0; i--) {
    const a = k[i], b = k[i + 1], dv = b.v - a.v;
    const P = `clip((${u}-${f(a.t)})/${f(Math.max(EPS, b.t - a.t))},0,1)`;
    const seg = a.e === 'hold' || Math.abs(dv) < 1e-9 ? f(a.v) : a.e === 'linear' ? `${f(a.v)}+${f(dv)}*${P}` : `${f(a.v)}+${f(dv)}*${P}*${P}*(3-2*${P})`;
    expr = `if(lt(${u},${f(b.t)}),${seg},${expr})`;
  }
  return expr;
}

export const hasKeys = (c, prop) => !!c.keyframes?.[prop]?.length;
export const anyKeys = c => KEY_PROPS.some(p => hasKeys(c, p));
export const keyAt = (c, prop, u) => (c.keyframes?.[prop] || []).find(k => Math.abs(k.t - u) < 1 / 60);
export const baseValue = (c, prop) => { const T = c.transform || {}; return T[prop] ?? (prop === 'scale' || prop === 'opacity' ? 1 : 0); };
export const propValue = (c, prop, u) => keyValue(c.keyframes?.[prop], u, baseValue(c, prop));

// Mutating helpers (call inside a commit draft).
export function setKey(c, prop, u, v, e) {
  u = Math.min(Math.max(0, u), c.duration);
  c.keyframes ||= {}; const list = (c.keyframes[prop] ||= []);
  const hit = list.find(k => Math.abs(k.t - u) < 1 / 60);
  if (hit) { hit.v = v; if (e) hit.e = e; } else list.push({ t: u, v, e: e || 'smooth' });
  list.sort((a, b) => a.t - b.t);
}
export function removeKey(c, prop, u) {
  if (!c.keyframes?.[prop]) return;
  c.keyframes[prop] = c.keyframes[prop].filter(k => Math.abs(k.t - u) >= 1 / 60);
  if (!c.keyframes[prop].length) { c.transform ||= {}; delete c.keyframes[prop]; }
}
// Writes a transform value: updates/creates the key at u when the property is animated, otherwise the static value.
export function writeProp(c, prop, v, u) {
  if (hasKeys(c, prop)) setKey(c, prop, u, v); else { c.transform ||= {}; c.transform[prop] = v; }
}
// Move every key by d seconds (trim from the start), sampling the edge so motion stays continuous.
export function shiftKeys(c, d, duration = c.duration) {
  if (!c.keyframes) return;
  for (const p of Object.keys(c.keyframes)) {
    const old = c.keyframes[p]; const v0 = keyValue(old, d), v1 = keyValue(old, d + duration);
    let next = old.map(k => ({ ...k, t: k.t - d })).filter(k => k.t > EPS && k.t < duration - EPS);
    const firstOld = sorted(old)[0], lastOld = sorted(old).at(-1);
    if (firstOld.t - d <= EPS) next.unshift({ t: 0, v: v0, e: segEase(old, d) });
    if (lastOld.t - d >= duration - EPS) next.push({ t: duration, v: v1, e: 'smooth' });
    if (!next.length) next = [{ t: 0, v: v0, e: 'smooth' }];
    c.keyframes[p] = next;
  }
}
function segEase(keys, u) { const k = sorted(keys); let e = k[0].e; for (const x of k) if (x.t <= u) e = x.e; return e; }
