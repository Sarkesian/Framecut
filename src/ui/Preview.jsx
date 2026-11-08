// Center: WebGL preview with transport controls and on-canvas transform handles.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Play, Pause, SkipBack, SkipForward, Maximize, ChevronDown, Grid2x2, Magnet } from 'lucide-preact';
import { project, media, time, playing, player, selection, primary, commit, toast, duration, asset } from '../lib/state.js';
import { Player } from '../engine/player.js';
import { dimensions, RATIOS } from '../../shared/model.mjs';
import { layerState } from '../../shared/plan.mjs';
import { openMenu } from './kit.jsx';
import { timecode } from '../lib/format.js';
import { addAssets, addText, addSticker, applyEffect, applyFilter } from '../lib/edit.js';
import { addTextTemplate } from './AssetPanel.jsx';
import { TEXT_TEMPLATES } from '../../shared/templates.mjs';
import { DeviceBar } from './Studio.jsx';

export function Preview() {
  const p = project.value;
  const wrap = useRef(), canvas = useRef(), [box, setBox] = useState({ w: 0, h: 0 }), [zoom, setZoom] = useState('fit'), [guides, setGuides] = useState(false), [over, setOver] = useState(false);
  const [W, H] = dimensions(p.settings.ratio, p.settings.resolution);
  useEffect(() => {
    const pl = new Player({ canvas: canvas.current, getProject: () => project.value, getMedia: id => media.value.get(id), onTime: t => (time.value = t), onPlaying: v => (playing.value = v), onError: m => toast(m, 'warn') });
    player.current = pl; pl.seek(time.value);
    return () => { pl.destroy(); player.current = null; };
  }, []);
  useEffect(() => { player.current?.invalidate(); }, [media.value]);
  // Fit the canvas into the available area at the project's aspect ratio.
  useEffect(() => {
    const ro = new ResizeObserver(() => { const r = wrap.current.getBoundingClientRect(); setBox({ w: r.width, h: r.height }); });
    ro.observe(wrap.current); return () => ro.disconnect();
  }, []);
  const fit = Math.min((box.w - 24) / W, (box.h - 24) / H);
  const scale = zoom === 'fit' ? fit : +zoom;
  const cw = Math.max(16, Math.round(W * scale)), ch = Math.max(16, Math.round(H * scale));
  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = canvas.current; const tw = Math.min(W, Math.round(cw * dpr)), th = Math.round(tw * H / W);
    if (c.width !== tw || c.height !== th) { c.width = tw; c.height = th; player.current?.requestDraw(); }
  }, [cw, ch, W, H]);
  const onDrop = e => {
    e.preventDefault(); setOver(false);
    const d = window.__fcDrag; window.__fcDrag = null; if (!d) return;
    if (d.type === 'media') { const a = asset(d.id); if (a) addAssets([a], { overlay: project.value.clips.some(c => c.start <= time.value && c.start + c.duration > time.value && c.kind !== 'audio') && a.kind !== 'audio' }); }
    if (d.type === 'text') addText({ style: d.style });
    if (d.type === 'sticker') addSticker(d.sticker);
    if (d.type === 'effect') applyEffect(d.id);
    if (d.type === 'filter') applyFilter(d.id, d.name);
    if (d.type === 'textTemplate') addTextTemplate(TEXT_TEMPLATES.find(t => t.id === d.id));
  };
  const empty = !p.clips.length;
  return <div class="preview">
    <div class="preview-head">
      <span class="label">Player</span><div class="grow" />
      <button class="btn ghost sm" onClick={e => openMenu(e, Object.entries(RATIOS).map(([r, i]) => ({ text: `${r}  ·  ${i.name}`, checked: p.settings.ratio === r, onClick: () => commit('Change aspect ratio', d => { d.settings.ratio = r; }) })), { align: 'below' })} data-tip="Aspect ratio">{p.settings.ratio}<ChevronDown size={13} /></button>
      <button class="btn ghost sm" onClick={e => openMenu(e, [['fit', 'Fit'], ['0.25', '25%'], ['0.5', '50%'], ['1', '100%']].map(([v, l]) => ({ text: l, checked: zoom === v, onClick: () => setZoom(v) })), { align: 'below' })} data-tip="Preview zoom">{zoom === 'fit' ? 'Fit' : Math.round(+zoom * 100) + '%'}<ChevronDown size={13} /></button>
      <button class={`icon-btn sm ${guides ? 'on' : ''}`} data-tip="Safe-area guides" onClick={() => setGuides(!guides)}><Grid2x2 size={15} /></button>
    </div>
    <div class={`stage-wrap ${over ? 'drop-over' : ''}`} ref={wrap} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop} onPointerDown={e => { if (e.target === e.currentTarget) selection.value = []; }}>
      <div class="stage" style={{ width: cw, height: ch }}>
        <canvas ref={canvas} class="stage-canvas" style={{ width: cw, height: ch }} aria-label="Video preview" onPointerDown={e => pickAt(e, cw, ch, W, H)} onDblClick={() => player.current?.toggle()} />
        <Gizmo cw={cw} ch={ch} W={W} H={H} />
        {guides && <div class="guides"><div class="safe action" /><div class="safe title" /><div class="cross" /></div>}
        {empty && <div class="stage-empty"><b>Your video appears here</b><span>Import media on the left, then drag it to the timeline.</span></div>}
      </div>
    </div>
    <Transport />
  </div>;
}

// Click on the canvas selects the topmost visual under the cursor.
function pickAt(e, cw, ch, W, H) {
  const pl = player.current; const plan = pl?.getPlan(); if (!plan) return;
  const r = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - r.left) / cw * W, y = (e.clientY - r.top) / ch * H; const t = time.value;
  const hits = plan.layers.filter(L => (L.type === 'media' || L.type === 'raster') && t >= L.vs && t < L.ve).reverse();
  for (const L of hits) {
    const st = layerState(L, t); const cx = L.cx + st.dx, cy = L.cy + st.dy, a = -st.r * Math.PI / 180;
    const dx = x - cx, dy = y - cy, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= L.baseW * st.s / 2 && Math.abs(ly) <= L.baseH * st.s / 2) {
      const tr = project.value.tracks.find(t => t.id === L.clip.trackId); if (tr?.locked) continue;
      selection.value = [L.clip.id]; return;
    }
  }
  selection.value = [];
}

// Move / scale / rotate the selected visual directly on the canvas.
function Gizmo({ cw, ch, W, H }) {
  const c = primary.value; time.value; // re-render on time for animated clips
  const pl = player.current; const plan = pl?.getPlan();
  if (!c || c.kind === 'audio' || c.kind === 'adjust' || !plan) return null;
  const L = plan.layers.find(l => l.id === c.id); if (!L) return null;
  const t = time.value; if (t < L.vs || t >= L.ve) return null;
  const k = cw / W, st = layerState(L, t);
  const w = L.baseW * st.s * k, h = L.baseH * st.s * k, cx = (L.cx + st.dx) * k, cy = (L.cy + st.dy) * k;
  const begin = (e, mode) => {
    e.preventDefault(); e.stopPropagation(); const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    const start = structuredClone(c.transform), sx = e.clientX, sy = e.clientY;
    const rect = el.closest('.stage').getBoundingClientRect(); const ox = rect.left + cx, oy = rect.top + cy;
    const a0 = Math.atan2(sy - oy, sx - ox), d0 = Math.hypot(sx - ox, sy - oy);
    const move = ev => {
      commit(mode === 'move' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Resize', p => {
        const x = p.clips.find(q => q.id === c.id); if (!x) return false; const T = x.transform;
        if (mode === 'move') {
          let nx = start.x + (ev.clientX - sx) / cw, ny = start.y + (ev.clientY - sy) / ch;
          if (!ev.altKey) { if (Math.abs(nx) < 0.012) nx = 0; if (Math.abs(ny) < 0.012) ny = 0; }
          T.x = nx; T.y = ny;
        } else if (mode === 'rotate') {
          let r = start.rotation + (Math.atan2(ev.clientY - oy, ev.clientX - ox) - a0) * 180 / Math.PI;
          if (ev.shiftKey) r = Math.round(r / 15) * 15; else for (const snap of [0, 90, -90, 180, -180]) if (Math.abs(r - snap) < 3) r = snap;
          T.rotation = Math.round(r * 10) / 10;
        } else T.scale = Math.max(0.02, Math.min(10, start.scale * Math.hypot(ev.clientX - ox, ev.clientY - oy) / Math.max(4, d0)));
      }, { key: 'gizmo:' + mode + c.id });
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  return <div class="gizmo" style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h, transform: `rotate(${st.r}deg)` }} onPointerDown={e => begin(e, 'move')} onDblClick={() => c.kind === 'text' && document.querySelector('.insp-text textarea')?.focus()}>
    {['nw', 'ne', 'sw', 'se'].map(k2 => <span key={k2} class={`handle ${k2}`} onPointerDown={e => begin(e, 'scale')} />)}
    <span class="handle rot" data-tip="Rotate (Shift snaps to 15°)" onPointerDown={e => begin(e, 'rotate')} />
  </div>;
}

function Transport() {
  const fps = project.value.settings.fps;
  const [, force] = useState(0);
  return <div class="transport">
    <span class="tc mono"><b>{timecode(time.value, fps)}</b><span class="muted"> / {timecode(duration.value, fps)}</span></span>
    <div class="grow" />
    <button class="icon-btn" data-tip="Previous frame" data-kbd="←" onClick={() => player.current?.step(-1)}><SkipBack size={17} /></button>
    <button class="play-btn" data-tip={playing.value ? 'Pause' : 'Play'} data-kbd="Space" aria-label={playing.value ? 'Pause' : 'Play'} onClick={() => player.current?.toggle()}>{playing.value ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
    <button class="icon-btn" data-tip="Next frame" data-kbd="→" onClick={() => player.current?.step(1)}><SkipForward size={17} /></button>
    <div class="grow" />
    <button class="btn ghost sm mono" data-tip="Playback speed" onClick={e => openMenu(e, [0.25, 0.5, 1, 1.5, 2].map(r => ({ text: r + '×', checked: (player.current?.rate || 1) === r, onClick: () => { player.current?.setRate(r); force(x => x + 1); } })), { align: 'below' })}>{player.current?.rate || 1}×</button>
    <DeviceBar />
    <button class="icon-btn" data-tip="Full screen" data-kbd="Shift+F" onClick={() => document.querySelector('.preview')?.requestFullscreen?.()}><Maximize size={16} /></button>
  </div>;
}
