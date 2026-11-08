// Waveform editor for the selected audio clip: zoom, drag-select a range, then split, delete, silence,
// trim or adjust volume. Every operation is non-destructive (splits, trims and volume keyframes).
import { useEffect, useRef, useState } from 'preact/hooks';
import { Scissors, Trash2, VolumeX, Crop, Play, ZoomIn, ZoomOut, Minus, Plus } from 'lucide-preact';
import { project, primary, time, player, commit, toast, asset, selection } from '../lib/state.js';
import { splitAt } from '../lib/edit.js';
import { clipEnd, uid } from '../../shared/model.mjs';
import { keyGain } from '../../shared/audio.mjs';
import { beginDrag } from '../lib/drag.js';

const peaksCache = new Map();
export function WaveEditor() {
  const c = primary.value; const a = c && (c.kind === 'audio' || c.kind === 'video') ? asset(c.mediaId) : null;
  const cv = useRef(); const [peaks, setPeaks] = useState(null); const [sel, setSel] = useState(null); const [zoom, setZoom] = useState(1); const [scroll, setScroll] = useState(0);
  useEffect(() => { setSel(null); setZoom(1); setScroll(0); }, [c?.id]);
  useEffect(() => { if (!a?.wave) return; if (peaksCache.has(a.wave)) return setPeaks(peaksCache.get(a.wave)); fetch(a.wave).then(r => r.arrayBuffer()).then(b => { const pk = new Uint8Array(b); peaksCache.set(a.wave, pk); setPeaks(pk); }); }, [a?.wave]);
  const view = c ? { t0: scroll, t1: scroll + c.duration / zoom } : null; // clip-local seconds
  useEffect(() => {
    const el = cv.current; if (!el || !c || !peaks) return; const dpr = window.devicePixelRatio || 1; const w = el.clientWidth, h = el.clientHeight;
    el.width = w * dpr; el.height = h * dpr; const g = el.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const span = view.t1 - view.t0, sp = c.speed || 1, mid = h / 2;
    if (sel) { g.fillStyle = 'rgba(182,243,106,.16)'; const x0 = (sel[0] - view.t0) / span * w, x1 = (sel[1] - view.t0) / span * w; g.fillRect(x0, 0, x1 - x0, h); }
    g.fillStyle = '#5fe0b8';
    for (let x = 0; x < w; x++) {
      const tl0 = view.t0 + x / w * span, tl1 = view.t0 + (x + 1) / w * span; const s0 = c.in + tl0 * sp, s1 = c.in + tl1 * sp;
      let m = 0; for (let i = Math.floor(s0 * 100); i <= Math.floor(s1 * 100) && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const gain = Math.min(2, (c.volume ?? 1) * keyGain(c.volumeKeys, tl0) * keyGain(c.duckKeys, tl0));
      const v = Math.min(1, m / 255 * gain) * mid * 0.92; g.fillRect(x, mid - v, 1, Math.max(1, v * 2));
    }
    g.strokeStyle = '#ffd36a'; g.lineWidth = 1.5; g.beginPath();
    for (let x = 0; x <= w; x += 2) { const tl = view.t0 + x / w * span; const v = keyGain(c.volumeKeys, tl); const y = h - 6 - Math.min(1, v / 2) * (h - 12); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    for (const m of c.markers || []) { const tl = (m.t - c.in) / sp; if (tl < view.t0 || tl > view.t1) continue; const x = (tl - view.t0) / span * w; g.fillStyle = '#ff5f70'; g.fillRect(x - 1, 0, 2, h); g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7); g.fill(); }
    const ph = time.value - c.start; if (ph >= view.t0 && ph <= view.t1) { g.fillStyle = '#fff'; g.fillRect((ph - view.t0) / span * w - 1, 0, 2, h); }
  }, [c, peaks, sel, zoom, scroll, time.value]);
  if (!c || !a) return <div class="wave-editor empty"><span class="muted">Select a recording or audio clip to edit its waveform.</span></div>;
  if (!a.audio) return <div class="wave-editor empty"><span class="muted">This clip has no sound.</span></div>;
  const toLocal = e => { const r = cv.current.getBoundingClientRect(); return Math.max(0, Math.min(c.duration, view.t0 + (e.clientX - r.left) / r.width * (view.t1 - view.t0))); };
  const down = e => {
    if (e.button !== 0) return;
    const t0 = toLocal(e);
    beginDrag(e, {
      threshold: 3,
      move: ev => { const t1 = toLocal(ev); setSel([Math.min(t0, t1), Math.max(t0, t1)]); },
      end: (_, { moved }) => { if (!moved) { setSel(null); player.current?.seek(c.start + t0); } },
    });
  };
  const wheel = e => { if (!e.ctrlKey) { e.preventDefault(); setScroll(s => Math.max(0, Math.min(c.duration - c.duration / zoom, s + e.deltaY / 400 * (c.duration / zoom)))); return; } e.preventDefault(); const z2 = Math.max(1, Math.min(200, zoom * (e.deltaY < 0 ? 1.25 : 0.8))); const at = toLocal(e); setZoom(z2); setScroll(Math.max(0, Math.min(c.duration - c.duration / z2, at - (at - view.t0) * zoom / z2))); };
  const need = () => { if (!sel) { toast('Drag across the waveform to select a part first.', 'warn'); return false; } return true; };
  const keysWith = (keys, from, to, v) => { // set gain v inside [from,to] with short ramps, keeping the existing envelope outside
    const r = 0.015; const base = keys?.length ? keys : [{ t: 0, v: 1 }, { t: c.duration, v: 1 }];
    const outside = base.filter(k => k.t < from - r || k.t > to + r);
    return [...outside, { t: Math.max(0, from - r), v: keyGain(base, from - r) }, { t: from, v }, { t: to, v }, { t: Math.min(c.duration, to + r), v: keyGain(base, to + r) }].sort((x, y) => x.t - y.t);
  };
  const silence = () => need() && commit('Silence selection', p => { const x = p.clips.find(k => k.id === c.id); x.volumeKeys = keysWith(x.volumeKeys, sel[0], sel[1], 0); });
  const gainSel = db => need() && commit(db > 0 ? 'Louder selection' : 'Quieter selection', p => { const x = p.clips.find(k => k.id === c.id); const v = keyGain(x.volumeKeys, (sel[0] + sel[1]) / 2) * Math.pow(10, db / 20); x.volumeKeys = keysWith(x.volumeKeys, sel[0], sel[1], Math.min(4, v)); });
  const splitSel = () => { if (!need()) return; splitAt(c.start + sel[1], [c.id]); splitAt(c.start + sel[0], [c.id]); setSel(null); };
  const deleteSel = () => {
    if (!need()) return; const [s0, s1] = sel; const len = s1 - s0;
    commit('Delete selection', p => {
      const x = p.clips.find(k => k.id === c.id); const right = structuredClone(x); right.id = uid();
      const sp = x.speed || 1; right.start = x.start + s0; right.in = x.in + s1 * sp; right.duration = x.duration - s1; right.takes = null; right.fadeIn = 0.01;
      x.duration = s0; x.fadeOut = 0.01;
      for (const k of p.clips) if (k.trackId === x.trackId && k.id !== x.id && k.start >= x.start + s1 - 1e-4) k.start -= len;
      const fixKeys = (keys, off, max) => keys ? keys.map(k => ({ ...k, t: k.t - off })).filter(k => k.t >= 0 && k.t <= max) : null;
      right.volumeKeys = fixKeys(x.volumeKeys, s1, right.duration); x.volumeKeys = fixKeys(x.volumeKeys, 0, s0); right.duckKeys = null;
      if (right.duration > 0.02) p.clips.push(right); if (x.duration < 0.02) p.clips = p.clips.filter(k => k.id !== x.id);
    });
    setSel(null);
  };
  const trimSel = () => need() && commit('Trim to selection', p => { const x = p.clips.find(k => k.id === c.id); const sp = x.speed || 1; x.in += sel[0] * sp; x.start += sel[0]; x.duration = sel[1] - sel[0]; if (x.volumeKeys) x.volumeKeys = x.volumeKeys.map(k => ({ ...k, t: k.t - sel[0] })).filter(k => k.t >= 0 && k.t <= x.duration); setSel(null); });
  const playSel = () => { const pl = player.current; if (!pl) return; const [s0, s1] = sel || [time.value - c.start, c.duration]; pl.seek(c.start + s0); pl.play(); if (sel) { const stopAt = c.start + s1; const chk = () => { if (!pl.playing) return; if (pl.t >= stopAt) pl.pause(); else requestAnimationFrame(chk); }; requestAnimationFrame(chk); } };
  return <div class="wave-editor">
    <div class="we-bar"><b class="ellipsis">{c.name || 'Audio'}</b><span class="muted mono">{sel ? `${(sel[1] - sel[0]).toFixed(2)} s selected` : 'Drag to select · Ctrl+wheel to zoom'}</span><div class="grow" />
      <button class="icon-btn sm" data-tip="Play selection" onClick={playSel}><Play size={14} /></button>
      <button class="icon-btn sm" data-tip="Split at selection edges" onClick={splitSel}><Scissors size={14} /></button>
      <button class="icon-btn sm" data-tip="Delete selection and close the gap" onClick={deleteSel}><Trash2 size={14} /></button>
      <button class="icon-btn sm" data-tip="Silence selection" onClick={silence}><VolumeX size={14} /></button>
      <button class="icon-btn sm" data-tip="Keep only the selection" onClick={trimSel}><Crop size={14} /></button>
      <button class="icon-btn sm" data-tip="Selection 3 dB quieter" onClick={() => gainSel(-3)}><Minus size={14} /></button>
      <button class="icon-btn sm" data-tip="Selection 3 dB louder" onClick={() => gainSel(3)}><Plus size={14} /></button>
      <span class="sep" />
      <button class="icon-btn sm" data-tip="Zoom out" onClick={() => setZoom(z => Math.max(1, z / 1.5))}><ZoomOut size={14} /></button>
      <button class="icon-btn sm" data-tip="Zoom in" onClick={() => setZoom(z => Math.min(200, z * 1.5))}><ZoomIn size={14} /></button>
    </div>
    <canvas ref={cv} class="we-canvas" onPointerDown={down} onWheel={wheel} />
  </div>;
}
