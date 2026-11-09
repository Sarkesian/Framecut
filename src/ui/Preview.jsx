// Center: WebGL preview with transport controls and on-canvas transform handles.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Play, Pause, SkipBack, SkipForward, Maximize, ChevronDown, Grid2x2, Magnet, Lock, AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, RotateCcw, LockOpen, Crosshair } from 'lucide-preact';
import { project, media, time, playing, player, selection, primary, commit, toast, duration, asset, transitionHover, lookPick } from '../lib/state.js';
import { SocialOverlay, SocialButton } from './SocialOverlay.jsx';
import { Player, rasterReady } from '../engine/player.js';
import { dimensions, RATIOS } from '../../shared/model.mjs';
import { propValue, writeProp } from '../../shared/keys.mjs';
import { TEXT_STYLE, CAPTION_STYLE } from '../../shared/catalog.mjs';
import { viewportTargets, snapBox } from '../../shared/snap.mjs';
import { openMenu } from './kit.jsx';
import { timecode } from '../lib/format.js';
import { addAssets, addText, addSticker, applyEffect, applyFilter, setClipText, appendToText } from '../lib/edit.js';
import { beginDrag } from '../lib/drag.js';
import { ui, setUi } from '../lib/uiprefs.js';
import { layerBox, visibleLayers, selectedLayers, canMove, align, resetProps, toggleLock } from '../lib/viewport.js';
import { fontString, textMetrics } from '../engine/raster.js';
import { addTextTemplate, withLookPreview, previewedLook } from './AssetPanel.jsx';
import { TEXT_TEMPLATES } from '../../shared/templates.mjs';
import { DeviceBar } from './Studio.jsx';

const SAFE = [0.05, 0.1]; // action-safe and title-safe margins
const SNAP_PX = 6; // screen pixels, converted to canvas pixels with the preview scale
const guides = signal(null); // { x, y } snap hits while moving an object
const editing = signal(null); // clip id being edited in the viewer

// The project as the viewer shows it: a hovered transition type stands in for the clip's real one.
let hoverMemo = { p: null, o: null, r: null };
function withHoveredTransition(p) {
  const o = transitionHover.value; if (!o || !p) return p;
  if (hoverMemo.p !== p || hoverMemo.o !== o) hoverMemo = { p, o, r: { ...p, clips: p.clips.map(c => (c.id === o.clipId && c.transition ? { ...c, transition: { ...c.transition, id: o.id } } : c)) } };
  return hoverMemo.r;
}

export function Preview() {
  const p = project.value;
  const wrap = useRef(), canvas = useRef(), [box, setBox] = useState({ w: 0, h: 0 }), [zoom, setZoom] = useState('fit'), [over, setOver] = useState(false);
  const safe = ui.value.safeArea;
  // A look being tried out is shown (frame shape included) without being on the project; the stage is view-only meanwhile.
  const shown = withLookPreview(p), trying = previewedLook(p);
  const [W, H] = dimensions(shown.settings.ratio, shown.settings.resolution);
  useEffect(() => {
    const pl = new Player({ canvas: canvas.current, getProject: () => withLookPreview(withHoveredTransition(project.value)), getMedia: id => media.value.get(id), onTime: t => (time.value = t), onPlaying: v => (playing.value = v), onError: m => toast(m, 'warn') });
    player.current = pl; pl.seek(time.value);
    return () => { pl.destroy(); player.current = null; };
  }, []);
  useEffect(() => { player.current?.invalidate(); }, [media.value, transitionHover.value, lookPick.value]);
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
    // Where on the frame it was dropped, as offsets from the centre (fractions of width / height).
    const r = canvas.current?.getBoundingClientRect();
    const pos = r && r.width ? { x: Math.max(-0.5, Math.min(0.5, (e.clientX - r.left) / r.width - 0.5)), y: Math.max(-0.5, Math.min(0.5, (e.clientY - r.top) / r.height - 0.5)) } : undefined;
    if (d.type === 'media') { const a = asset(d.id); if (a) addAssets([a], { overlay: project.value.clips.some(c => c.start <= time.value && c.start + c.duration > time.value && c.kind !== 'audio') && a.kind !== 'audio' }); }
    if (d.type === 'text') addText({ style: d.style });
    // An emoji dropped on a text joins that text (same font size, style and animation); elsewhere it's a sticker.
    const onText = d.type === 'sticker' && d.sticker?.type === 'emoji' && r?.width ? textAt((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H) : null;
    if (onText) appendToText(onText.id, d.sticker.value);
    else if (d.type === 'sticker') addSticker(d.sticker, { pos });
    if (d.type === 'library') d.drop({ pos });
    if (d.type === 'effect') applyEffect(d.id);
    if (d.type === 'filter') applyFilter(d.id, d.name);
    if (d.type === 'textTemplate') addTextTemplate(d.tpl || TEXT_TEMPLATES.find(t => t.id === d.id));
  };
  const empty = !shown.clips.length;
  return <div class="preview">
    <div class="preview-head">
      <span class="label">Player</span><div class="grow" />
      <button class="btn ghost sm" onClick={e => openMenu(e, Object.entries(RATIOS).map(([r, i]) => ({ text: `${r}  ·  ${i.name}`, checked: p.settings.ratio === r, onClick: () => commit('Change aspect ratio', d => { d.settings.ratio = r; }) })), { align: 'below' })} data-tip="Aspect ratio">{p.settings.ratio}<ChevronDown size={13} /></button>
      <button class="btn ghost sm" onClick={e => openMenu(e, [['fit', 'Fit'], ['0.25', '25%'], ['0.5', '50%'], ['1', '100%']].map(([v, l]) => ({ text: l, checked: zoom === v, onClick: () => setZoom(v) })), { align: 'below' })} data-tip="Preview zoom">{zoom === 'fit' ? 'Fit' : Math.round(+zoom * 100) + '%'}<ChevronDown size={13} /></button>
      <button class={`icon-btn sm ${ui.value.viewSnap ? 'on' : ''}`} aria-pressed={ui.value.viewSnap} data-tip={`Snap objects to the frame, safe areas and each other (${ui.value.viewSnap ? 'on' : 'off'}) · hold Alt to bypass`} data-kbd="Shift+N" onClick={() => setUi({ viewSnap: !ui.value.viewSnap })}><Magnet size={15} /></button>
      <button class={`icon-btn sm ${safe ? 'on' : ''}`} aria-pressed={safe} data-tip="Safe-area guides (objects also snap to them)" data-kbd="'" onClick={() => setUi({ safeArea: !safe })}><Grid2x2 size={15} /></button>
      <SocialButton />
    </div>
    <div class={`stage-wrap ${over ? 'drop-over' : ''}`} ref={wrap} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop} onPointerDown={e => { if (e.target === e.currentTarget) { selection.value = []; editing.value = null; } }}>
      <div class="stage" style={{ width: cw, height: ch }}>
        <canvas ref={canvas} class="stage-canvas" style={{ width: cw, height: ch }} aria-label="Video preview" onPointerDown={e => pickAt(e, cw, ch, W, H)} onContextMenu={e => { pickAt(e, cw, ch, W, H, true); if (selection.value.length) objectMenu(e); }} onDblClick={() => player.current?.toggle()} />
        {safe && <div class="guides"><div class="safe action" /><div class="safe title" /><div class="cross" /></div>}
        <SocialOverlay cw={cw} ch={ch} />
        <Others cw={cw} W={W} />
        <SnapGuides cw={cw} ch={ch} W={W} />
        <Gizmo cw={cw} ch={ch} W={W} H={H} />
        {trying && <div class="look-veil" onPointerDown={e => e.stopPropagation()}><span><b>Preview</b> {trying.name} · not applied</span></div>}
        {empty && <div class="stage-empty"><b>Your video appears here</b><span>Import media on the left, then drag it to the timeline.</span></div>}
      </div>
    </div>
    <Transport />
  </div>;
}

// Click on the canvas selects the topmost visual under the cursor; Shift/Ctrl+click adds or removes it.
// The topmost (non-caption, unlocked) text clip under frame point (x, y), if any.
function textAt(x, y) {
  const plan = player.current?.getPlan(); if (!plan) return null; const t = time.value, p = project.value;
  for (const L of visibleLayers(plan, t).reverse()) {
    const c = L.clip; if (c.kind !== 'text' || c.caption || p.tracks.find(t2 => t2.id === c.trackId)?.locked) continue;
    const b = layerBox(L, t), st = b.st, a = -st.r * Math.PI / 180, dx = x - b.cx, dy = y - b.cy;
    if (Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= L.baseW * st.s / 2 && Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= L.baseH * st.s / 2) return c;
  }
  return null;
}
function pickAt(e, cw, ch, W, H, keep = false) {
  if (e.button !== 0 && !keep) return;
  const pl = player.current; const plan = pl?.getPlan(); if (!plan) return;
  const r = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - r.left) / cw * W, y = (e.clientY - r.top) / ch * H; const t = time.value;
  const add = e.shiftKey || e.ctrlKey || e.metaKey;
  for (const L of visibleLayers(plan, t).reverse()) {
    const b = layerBox(L, t), st = b.st; const cx = b.cx, cy = b.cy, a = -st.r * Math.PI / 180;
    const dx = x - cx, dy = y - cy, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= L.baseW * st.s / 2 && Math.abs(ly) <= L.baseH * st.s / 2) {
      const tr = project.value.tracks.find(t2 => t2.id === L.clip.trackId); if (tr?.locked) continue;
      if (keep && selection.value.includes(L.id)) return;
      if (add) selection.value = selection.value.includes(L.id) ? selection.value.filter(id => id !== L.id) : [...selection.value, L.id];
      else selection.value = [L.id];
      // Pressing on an object and dragging moves it right away (no separate select click needed).
      if (!add && !keep && e.button === 0) setTimeout(() => document.querySelector('.gizmo')?.dispatchEvent(new PointerEvent('pointerdown', e)), 0);
      return;
    }
  }
  if (!add && !keep) selection.value = [];
}

// Right-click menu for objects in the viewer: alignment, distribution, resets and locking.
function objectMenu(e) {
  const layers = selectedLayers(); const n = layers.length; if (!n) return;
  const many = n > 1, locked = layers.every(L => L.clip.locked);
  openMenu(e, [
    { label: many ? `Align ${n} objects` : 'Align to frame' },
    { text: 'Left', icon: AlignStartVertical, onClick: () => align('left') },
    { text: 'Center horizontally', icon: AlignCenterVertical, onClick: () => align('hcenter') },
    { text: 'Right', icon: AlignEndVertical, onClick: () => align('right') },
    { text: 'Top', icon: AlignStartHorizontal, onClick: () => align('top') },
    { text: 'Center vertically', icon: AlignCenterHorizontal, onClick: () => align('vcenter') },
    { text: 'Bottom', icon: AlignEndHorizontal, onClick: () => align('bottom') },
    { text: 'Center in frame', icon: Crosshair, onClick: () => align('center', { toFrame: true }) },
    many && { divider: true },
    many && { text: 'Distribute horizontally', icon: AlignHorizontalDistributeCenter, disabled: n < 3, onClick: () => align('dist-h') },
    many && { text: 'Distribute vertically', icon: AlignVerticalDistributeCenter, disabled: n < 3, onClick: () => align('dist-v') },
    { divider: true },
    { text: 'Reset position', icon: RotateCcw, onClick: () => resetProps(['x', 'y']) },
    { text: 'Reset scale', onClick: () => resetProps(['scale']) },
    { text: 'Reset rotation', onClick: () => resetProps(['rotation']) },
    { divider: true },
    { text: locked ? 'Unlock clip' : 'Lock clip', icon: locked ? LockOpen : Lock, sc: 'Ctrl+L', onClick: () => toggleLock(layers.map(L => L.id)) },
  ]);
}

// Thin outlines for the other selected objects (the primary one has the full gizmo).
function Others({ cw, W }) {
  const sel = selection.value; time.value; project.value;
  if (sel.length < 2) return null;
  const k = cw / W, t = time.value;
  return selectedLayers().slice(1).map(L => { const b = layerBox(L, t); return <div key={L.id} class="sel-outline" style={{ left: (b.cx - L.baseW * b.st.s / 2) * k, top: (b.cy - L.baseH * b.st.s / 2) * k, width: L.baseW * b.st.s * k, height: L.baseH * b.st.s * k, transform: `rotate(${b.st.r}deg)` }} />; });
}

// Alignment guides: a line across the frame for frame/safe targets, or spanning both objects for object targets.
function SnapGuides({ cw, ch, W }) {
  const g = guides.value; if (!g) return null;
  const k = cw / W, out = [];
  if (g.x) { const o = g.x.box, b = g.box; const t0 = o ? Math.min(o.t, b.t) * k : 0, t1 = o ? Math.max(o.b, b.b) * k : ch; out.push(<div key="x" class={`snap-guide v k-${g.x.kind}`} style={{ left: g.x.v * k, top: t0, height: t1 - t0 }} />); }
  if (g.y) { const o = g.y.box, b = g.box; const l0 = o ? Math.min(o.l, b.l) * k : 0, l1 = o ? Math.max(o.r, b.r) * k : cw; out.push(<div key="y" class={`snap-guide h k-${g.y.kind}`} style={{ top: g.y.v * k, left: l0, width: l1 - l0 }} />); }
  return <>{out}</>;
}

// Move / scale / rotate the selected visual directly on the canvas.
function Gizmo({ cw, ch, W, H }) {
  const c = primary.value; time.value; rasterReady.value; // re-render on time for animated clips, and once a sticker/text raster is measured
  const pl = player.current; const plan = pl?.getPlan();
  if (!c || c.kind === 'audio' || c.kind === 'adjust' || !plan) return null;
  const L = plan.layers.find(l => l.id === c.id); if (!L) return null;
  const t = time.value; if (t < L.vs || t >= L.ve) return null;
  const k = cw / W, b0 = layerBox(L, t), st = b0.st;
  const w = L.baseW * st.s * k, h = L.baseH * st.s * k, cx = b0.cx * k, cy = b0.cy * k;
  const p = project.value, locked = !canMove(p, c), isEditing = editing.value === c.id && c.kind === 'text';
  const begin = (e, mode) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    if (locked) { toast(c.locked ? 'This clip is locked. Right-click → Unlock clip (Ctrl+L) to move it.' : 'This clip is on a locked track. Unlock the track (lock icon on the track name) to move it.', 'warn'); return; }
    if (isEditing) return;
    const u = Math.min(Math.max(0, t - c.start), c.duration), start = { x: propValue(c, 'x', u), y: propValue(c, 'y', u), scale: propValue(c, 'scale', u), rotation: propValue(c, 'rotation', u) }, sx = e.clientX, sy = e.clientY;
    const rect = e.currentTarget.closest('.stage').getBoundingClientRect(); const ox = rect.left + cx, oy = rect.top + cy;
    const a0 = Math.atan2(sy - oy, sx - ox), d0 = Math.hypot(sx - ox, sy - oy);
    // Moving several selected objects moves them together; snapping uses the primary object's bounds.
    const group = mode === 'move' ? selectedLayers().filter(x => canMove(p, x.clip)).map(x => ({ id: x.id, x: propValue(x.clip, 'x', Math.min(Math.max(0, t - x.clip.start), x.clip.duration)), y: propValue(x.clip, 'y', Math.min(Math.max(0, t - x.clip.start), x.clip.duration)) })) : [];
    const others = mode === 'move' ? visibleLayers(plan, t).filter(x => !group.some(gp => gp.id === x.id) && x.id !== c.id).map(x => layerBox(x, t)) : [];
    const targets = viewportTargets(W, H, { safe: ui.value.safeArea ? SAFE : null, others });
    let prev = null;
    const key = 'gizmo:' + mode + c.id;
    beginDrag(e, {
      threshold: mode === 'move' ? 3 : 1,
      cursor: mode === 'rotate' ? 'grabbing' : mode === 'move' ? 'move' : null,
      move: ev => {
        if (mode === 'move') {
          let dx = (ev.clientX - sx) / cw, dy = (ev.clientY - sy) / ch;
          // Shift keeps the move horizontal or vertical (whichever is larger).
          if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
          let snap = null;
          if (ui.value.viewSnap && !ev.altKey) {
            const bx = { ...b0, l: b0.l + dx * W, r: b0.r + dx * W, cx: b0.cx + dx * W, t: b0.t + dy * H, b: b0.b + dy * H, cy: b0.cy + dy * H };
            snap = snapBox(bx, targets, SNAP_PX / k, prev); prev = snap;
            if (ev.shiftKey) { if (dy === 0) { snap.dy = 0; snap.y = null; } else { snap.dx = 0; snap.x = null; } }
            dx += snap.dx / W; dy += snap.dy / H;
            guides.value = snap.x || snap.y ? { x: snap.x, y: snap.y, box: { l: bx.l + snap.dx, r: bx.r + snap.dx, t: bx.t + snap.dy, b: bx.b + snap.dy } } : null;
          } else guides.value = null;
          const list = group.length ? group : [{ id: c.id, x: start.x, y: start.y }];
          commit('Move', d => {
            for (const it of list) { const x = d.clips.find(q => q.id === it.id); if (!x) continue; const ux = Math.min(Math.max(0, t - x.start), x.duration); writeProp(x, 'x', rnd(it.x + dx), ux); writeProp(x, 'y', rnd(it.y + dy), ux); }
          }, { key });
          return;
        }
        commit(mode === 'rotate' ? 'Rotate' : 'Resize', d => {
          const x = d.clips.find(q => q.id === c.id); if (!x) return false; const put = (k2, v) => writeProp(x, k2, v, u);
          if (mode === 'rotate') {
            let r = start.rotation + (Math.atan2(ev.clientY - oy, ev.clientX - ox) - a0) * 180 / Math.PI;
            if (ev.shiftKey) r = Math.round(r / 15) * 15; else if (!ev.altKey) for (const s of [0, 90, -90, 180, -180]) if (Math.abs(r - s) < 3) r = s;
            put('rotation', Math.round(r * 10) / 10);
          } else {
            // Corner handles scale uniformly (aspect ratio is always kept); Shift snaps to 5% steps.
            let s = start.scale * Math.hypot(ev.clientX - ox, ev.clientY - oy) / Math.max(4, d0);
            if (ev.shiftKey) s = Math.round(s * 20) / 20; else if (!ev.altKey && Math.abs(s - 1) < 0.02) s = 1;
            put('scale', Math.max(0.02, Math.min(10, Math.round(s * 1000) / 1000)));
          }
        }, { key });
      },
      end: () => { guides.value = null; },
    });
  };
  const startEdit = () => { if (c.kind !== 'text' || locked) return; player.current?.pause(); editing.value = c.id; };
  return <div class={`gizmo ${locked ? 'locked' : ''} ${isEditing ? 'editing' : ''}`} style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h, transform: `rotate(${st.r}deg)` }}
    onPointerDown={e => begin(e, 'move')} onDblClick={e => { e.stopPropagation(); startEdit(); }} onContextMenu={e => { e.stopPropagation(); objectMenu(e); }}
    data-tip={c.kind === 'text' && !isEditing ? 'Drag to move · double-click to edit text · right-click to align' : undefined}>
    {isEditing ? <TextEditBox c={c} L={L} w={w} W={W} H={H} />
      : locked ? <span class="gizmo-lock"><Lock size={11} /></span>
      : <>{['nw', 'ne', 'sw', 'se'].map(k2 => <span key={k2} class={`handle ${k2}`} onPointerDown={e => begin(e, 'scale')} />)}
        <span class="handle rot" data-tip="Rotate (Shift snaps to 15°)" onPointerDown={e => begin(e, 'rotate')} /></>}
  </div>;
}
const rnd = v => Math.round(v * 1e6) / 1e6 || 0; // no -0

// In-viewer text editing: a transparent textarea laid exactly over the rendered text, so the live canvas render
// shows through while the caret and selection come from the textarea. Enter adds a line; Esc or clicking away finishes.
function TextEditBox({ c, L, w, W, H }) {
  const ref = useRef(); const session = useRef(Date.now());
  const r = player.current?.raster(c, W, H); // the raster the preview draws (canvas resolution)
  const s = { ...(c.caption ? CAPTION_STYLE : TEXT_STYLE), ...c.style }, m = textMetrics(s, H);
  const sf = r ? w / r.w : w / L.baseW;
  useLayoutEffect(() => { const el = ref.current; if (!el) return; el.focus(); el.select(); }, []);
  const done = () => { if (editing.value === c.id) editing.value = null; };
  return <textarea ref={ref} class="gizmo-edit" aria-label="Edit text in viewer" spellcheck={false} value={c.text}
    style={{ font: fontString(s, m.px * sf), letterSpacing: `${(s.letterSpacing || 0) * m.px * sf}px`, lineHeight: `${m.lineH * sf}px`, padding: `${(m.margin + m.padY) * sf}px ${(m.margin + m.padX) * sf}px`, textAlign: s.align || 'center', textTransform: s.uppercase ? 'uppercase' : 'none', whiteSpace: c.caption ? 'pre-wrap' : 'pre' }}
    onPointerDown={e => e.stopPropagation()} onDblClick={e => e.stopPropagation()}
    onInput={e => setClipText(c.id, e.currentTarget.value, session.current)}
    onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); } }}
    onBlur={done} />;
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
