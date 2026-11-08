// Multitrack timeline: tracks, clips (filmstrips, waveforms), playhead, snapping, trimming, dragging and drops.
import { LiveTakeRow } from './LiveTake.jsx';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Scissors, Trash2, Copy, Undo2, Redo2, Magnet, ZoomIn, ZoomOut, Maximize, Eye, EyeOff, Lock, LockOpen, Volume2, VolumeX, Plus, Film, Music, Type, Layers, Snowflake, Unlink, Pencil, ArrowLeftToLine, ArrowRightToLine, Diamond, Gauge, Blend, Captions, Sparkles, Mic, MoreHorizontal } from 'lucide-preact';
import { project, selection, time, zoom, media, asset, player, history, undo, redo, commit, toast, drag, playing, duration, libraryTab } from '../lib/state.js';
import { splitAt, deleteClips, duplicateClips, copyClips, cutClips, pasteClips, placeClips, trimClip, setTrack, removeTrack, addTrack, closeGaps, detachAudio, addAssets, addText, addSticker, applyEffect, applyFilter, applyTransition, trackOf, overlaps, freeTrack, updateClip } from '../lib/edit.js';
import { clipEnd, trackKindFor, mainTrack, transitionPartner, newClip } from '../../shared/model.mjs';
import { transitionDef, effectDef, filterDef } from '../../shared/catalog.mjs';
import { openMenu, prompt } from './kit.jsx';
import { importFiles } from '../lib/api.js';
import { fitTimeline } from './commands.jsx';
import { addTextTemplate } from './AssetPanel.jsx';
import { openStudio } from './Studio.jsx';
import { TEXT_TEMPLATES } from '../../shared/templates.mjs';
import { shortTime } from '../lib/format.js';
import { keyGain } from '../../shared/audio.mjs';

const HEADER_W = 168, RULER_H = 26;
const H = { video: 58, main: 66, audio: 52, text: 32, effect: 30 };
const trackH = t => (t.main ? H.main : H[t.kind] || 40);
const KIND_ICON = { video: Film, audio: Music, text: Type, effect: Layers };
const scroll = signal({ left: 0, width: 1000 });
const snapLine = signal(null);
const marquee = signal(null);
const dropHint = signal(null);

export function Timeline() {
  const p = project.value, z = zoom.value;
  const sc = useRef();
  const total = Math.max(duration.value + 30, (scroll.value.width / z) * 1.2);
  const width = total * z;
  useEffect(() => {
    const el = sc.current; const update = () => (scroll.value = { left: el.scrollLeft, width: el.clientWidth });
    const ro = new ResizeObserver(update); ro.observe(el); el.addEventListener('scroll', update, { passive: true }); update();
    return () => { ro.disconnect(); el.removeEventListener('scroll', update); };
  }, []);
  // Keep the playhead visible while playing.
  useEffect(() => {
    if (!playing.value) return; const el = sc.current; const x = time.value * z;
    if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  }, [Math.floor(time.value * z / 200), playing.value]);
  const onWheel = e => {
    if (e.ctrlKey) {
      e.preventDefault(); const el = sc.current; const r = el.getBoundingClientRect(); const x = e.clientX - r.left - HEADER_W + el.scrollLeft; const tAt = x / z;
      const nz = Math.min(800, Math.max(4, z * (e.deltaY < 0 ? 1.18 : 1 / 1.18))); zoom.value = nz;
      requestAnimationFrame(() => { el.scrollLeft = tAt * nz - (e.clientX - r.left - HEADER_W); });
    } else if (e.shiftKey) { e.preventDefault(); sc.current.scrollLeft += e.deltaY; }
  };
  const seekAt = clientX => { const el = sc.current; const r = el.getBoundingClientRect(); const t = Math.max(0, (clientX - r.left - HEADER_W + el.scrollLeft) / z); player.current?.seek(snapPlayhead(t)); };
  const snapPlayhead = t => { if (!p.settings.snapping) return t; const pts = snapPoints(p, new Set()); const th = 6 / z; let best = t, d = th; for (const s of pts) if (Math.abs(s - t) < d) { d = Math.abs(s - t); best = s; } return best; };
  const scrub = e => {
    if (e.button !== 0) return; e.preventDefault(); const el = e.currentTarget; el.setPointerCapture(e.pointerId); player.current?.pause(); seekAt(e.clientX);
    const mv = ev => seekAt(ev.clientX), up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };
  // Marquee select on empty space; plain click seeks and clears selection.
  const onBgDown = e => {
    if (e.button !== 0 || e.target.closest('.clip, .track-head')) return;
    const el = sc.current; const r = el.getBoundingClientRect(); const x0 = e.clientX - r.left + el.scrollLeft - HEADER_W, y0 = e.clientY - r.top + el.scrollTop;
    let moved = false; el.setPointerCapture(e.pointerId);
    const mv = ev => { const x1 = ev.clientX - r.left + el.scrollLeft - HEADER_W, y1 = ev.clientY - r.top + el.scrollTop; if (!moved && Math.hypot(x1 - x0, y1 - y0) < 5) return; moved = true; marquee.value = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }; };
    const up = ev => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      if (!moved) { selection.value = ev.ctrlKey || ev.shiftKey ? selection.value : []; seekAt(ev.clientX); return; }
      const m = marquee.value; marquee.value = null; if (!m) return;
      const t0 = m.x / z, t1 = (m.x + m.w) / z; let y = RULER_H; const hit = [];
      for (const t of p.tracks) { const h = trackH(t); if (y + h > m.y && y < m.y + m.h && !t.locked) for (const c of p.clips) if (c.trackId === t.id && c.start < t1 && clipEnd(c) > t0) hit.push(c.id); y += h; }
      selection.value = ev.ctrlKey || ev.shiftKey ? [...new Set([...selection.value, ...hit])] : hit;
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };
  const dropProps = useDrop(sc, z);
  const ph = time.value * z;
  return <div class="timeline">
    <Toolbar />
    <div class="tl-scroll" ref={sc} onWheel={onWheel} onPointerDown={onBgDown} {...dropProps}>
      <div class="tl-inner" style={{ width: width + HEADER_W }}>
        <div class="ruler-row"><div class="corner"><button class="btn ghost sm" onClick={e => openMenu(e, [{ label: 'Add track' }, ...['video', 'audio', 'text', 'effect'].map(k => ({ text: { video: 'Video overlay track', audio: 'Audio track', text: 'Text track', effect: 'Effect track' }[k], icon: KIND_ICON[k], onClick: () => commit('Add track', d => { addTrack(d, k); }) }))], { align: 'below' })}><Plus size={13} />Track</button></div><Ruler width={width} z={z} onPointerDown={scrub} /></div>
        {p.tracks.map(t => <TrackRow key={t.id} t={t} z={z} width={width} />)}
        <LiveTakeRow z={z} width={width} />
        <div class="tl-tail" style={{ width: width + HEADER_W }} />
        {snapLine.value !== null && <div class="snap-line" style={{ left: HEADER_W + snapLine.value * z }} />}
        {dropHint.value && <div class="drop-hint" style={{ left: HEADER_W + dropHint.value.x, top: dropHint.value.y, width: dropHint.value.w, height: dropHint.value.h }} />}
        {marquee.value && <div class="marquee" style={{ left: HEADER_W + marquee.value.x, top: marquee.value.y, width: marquee.value.w, height: marquee.value.h }} />}
        <div class="playhead" style={{ transform: `translateX(${HEADER_W + ph}px)` }}><div class="ph-head" onPointerDown={scrub} /></div>
      </div>
      {!p.clips.length && <div class="tl-empty"><Film size={20} /><div><b>Drag media here to start</b><span>Or double-click a file in the Media panel.</span></div></div>}
    </div>
  </div>;
}

function Ruler({ width, z, onPointerDown }) {
  const { left, width: vw } = scroll.value;
  const steps = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = steps.find(s => s * z >= 90) || 600; const minor = steps.filter(s => s < major).reverse().find(s => major / s >= 4 && s * z >= 10) || major / 2;
  const t0 = Math.max(0, Math.floor((left - HEADER_W) / z / major) * major), t1 = (left + vw) / z + major;
  const ticks = [];
  for (let t = t0; t <= t1; t += minor) { const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6; ticks.push(<div key={t.toFixed(3)} class={`tick ${isMajor ? 'major' : ''}`} style={{ left: t * z }}>{isMajor && <span>{fmtRuler(t, major)}</span>}</div>); }
  return <div class="ruler" style={{ width }} onPointerDown={onPointerDown}>{ticks}{project.value.markers.map((m, i) => <div key={i} class="marker" style={{ left: m.t * z }} data-tip={m.label || 'Marker'} />)}</div>;
}
const fmtRuler = (t, step) => { const m = Math.floor(t / 60), s = t % 60; if (step < 1) return `${m}:${s.toFixed(step < 0.1 ? 2 : 1).padStart(step < 0.1 ? 5 : 4, '0')}`; return `${m}:${String(Math.round(s)).padStart(2, '0')}`; };

function TrackRow({ t, z, width }) {
  const p = project.value; const clips = p.clips.filter(c => c.trackId === t.id);
  const Icon = t.captions ? Captions : KIND_ICON[t.kind];
  const menu = e => openMenu(e, [
    { text: 'Rename…', icon: Pencil, onClick: async () => { const n = await prompt({ title: 'Rename track', label: 'Track name', value: t.name }); if (n?.trim()) setTrack(t.id, { name: n.trim() }, 'Rename track'); } },
    t.kind !== 'audio' && { text: t.hidden ? 'Show track' : 'Hide track', icon: t.hidden ? Eye : EyeOff, onClick: () => setTrack(t.id, { hidden: !t.hidden }, 'Toggle visibility') },
    (t.kind === 'video' || t.kind === 'audio') && { text: t.muted ? 'Unmute track' : 'Mute track', icon: t.muted ? Volume2 : VolumeX, onClick: () => setTrack(t.id, { muted: !t.muted }, 'Toggle mute') },
    { text: t.locked ? 'Unlock track' : 'Lock track', icon: t.locked ? LockOpen : Lock, onClick: () => setTrack(t.id, { locked: !t.locked }, 'Toggle lock') },
    !t.main && { text: 'Close gaps', onClick: () => closeGaps(t.id) },
    { text: 'Select all on track', onClick: () => (selection.value = clips.map(c => c.id)) },
    t.kind === 'audio' && { text: t.voice ? 'Unmark as voice track' : 'Mark as voice track (for ducking)', icon: Mic, onClick: () => setTrack(t.id, { voice: !t.voice }, 'Voice track') },
    { divider: true },
    !t.main && { text: 'Delete track', icon: Trash2, danger: true, onClick: () => removeTrack(t.id) },
  ]);
  return <div class={`track-row k-${t.kind} ${t.main ? 'main' : ''} ${t.hidden ? 'is-hidden' : ''} ${t.locked ? 'is-locked' : ''}`} style={{ height: trackH(t), width: width + HEADER_W }} data-track={t.id}>
    <div class="track-head" onContextMenu={menu}>
      <span class={`th-icon k-${t.kind}`}><Icon size={13} /></span>
      <span class="th-name ellipsis" title={t.name}>{t.main ? 'Main' : t.name}</span>
      <div class="th-btns">
        {t.kind !== 'audio' && <button class={`icon-btn sm ${t.hidden ? 'on' : ''}`} data-tip={t.hidden ? 'Show' : 'Hide'} onClick={() => setTrack(t.id, { hidden: !t.hidden }, 'Toggle visibility')}>{t.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>}
        {(t.kind === 'video' || t.kind === 'audio') && <button class={`icon-btn sm ${t.muted ? 'on' : ''}`} data-tip={t.muted ? 'Unmute' : 'Mute'} onClick={() => setTrack(t.id, { muted: !t.muted }, 'Toggle mute')}>{t.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>}
        <button class={`icon-btn sm ${t.locked ? 'on' : ''}`} data-tip={t.locked ? 'Unlock' : 'Lock'} onClick={() => setTrack(t.id, { locked: !t.locked }, 'Toggle lock')}>{t.locked ? <Lock size={13} /> : <LockOpen size={13} />}</button>
      </div>
    </div>
    <div class="track-lane" style={{ width }}>{clips.map(c => <Clip key={c.id} c={c} t={t} z={z} />)}</div>
  </div>;
}

// Volume envelope: drag points to shape the level, double-click the line to add one, double-click a point to remove it.
const ENV_MAX = 2; // +6 dB at the top
let lastPress = null;
const db = v => (v <= 0.0005 ? '−∞' : (20 * Math.log10(v) >= 0 ? '+' : '') + (20 * Math.log10(v)).toFixed(1)) + ' dB';
function Envelope({ c, w, z, sel }) {
  const keys = c.volumeKeys || [], ref = useRef(null);
  const H = () => ref.current?.getBoundingClientRect().height || 40;
  const yOf = v => (1 - Math.min(ENV_MAX, v) / ENV_MAX) * 100;
  const pts = keys.length ? [{ t: 0, v: keys[0].v }, ...keys, { t: c.duration, v: keys.at(-1).v }] : [{ t: 0, v: 1 }, { t: c.duration, v: 1 }];
  const path = pts.map(k => `${(k.t * z).toFixed(1)},${yOf(k.v).toFixed(2)}`).join(' ');
  const vAt = (e) => { const r = ref.current.getBoundingClientRect(); return { t: Math.min(c.duration, Math.max(0, (e.clientX - r.left) / z)), v: Math.max(0, Math.min(ENV_MAX, (1 - (e.clientY - r.top) / r.height) * ENV_MAX)) }; };
  const save = (fn, label, key) => commit(label, d => { const x = d.clips.find(q => q.id === c.id); if (!x) return false; x.volumeKeys = x.volumeKeys ? [...x.volumeKeys] : []; fn(x); x.volumeKeys.sort((a, b) => a.t - b.t); if (!x.volumeKeys.length) delete x.volumeKeys; }, { key });
  const add = e => { e.stopPropagation(); if (e.target.classList.contains('env-pt')) return; const p = vAt(e); const g = keys.length ? keyGainAt(keys, p.t) : 1; save(x => { x.volumeKeys.push({ t: p.t, v: g }); }, 'Add volume point'); };
  const dragPt = (e, i) => {
    e.stopPropagation(); e.preventDefault(); if (e.button !== 0) return;
    const el = e.currentTarget; el.setPointerCapture(e.pointerId); const lo = i > 0 ? keys[i - 1].t + 0.01 : 0, hi = i < keys.length - 1 ? keys[i + 1].t - 0.01 : c.duration;
    const move = ev => { const p = vAt(ev); save(x => { x.volumeKeys[i] = { t: Math.min(hi, Math.max(lo, p.t)), v: ev.shiftKey ? keys[i].v : Math.round(p.v * 1000) / 1000 }; }, 'Move volume point', 'env:' + c.id + i); el.dataset.tip = db(p.v); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  // The clip captures the pointer on press, so a double-click is detected from two quick presses here.
  const down = e => {
    if (!sel || e.button !== 0 || e.target.classList.contains('env-pt')) return;
    const now = performance.now(), last = lastPress;
    lastPress = { at: now, x: e.clientX, y: e.clientY, id: c.id };
    if (last && last.id === c.id && now - last.at < 400 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6) { lastPress = null; e.preventDefault(); add(e); }
  };
  return <div class={`envelope ${sel ? 'on' : ''}`} ref={ref} onPointerDown={down}>
    <svg width={w} height="100%" viewBox={`0 0 ${w} 100`} preserveAspectRatio="none"><polyline points={path} vector-effect="non-scaling-stroke" /></svg>
    {sel && keys.map((k, i) => <span key={i} class="env-pt" style={{ left: k.t * z, top: yOf(k.v) + '%' }} data-tip={db(k.v)} onPointerDown={e => dragPt(e, i)} onDblClick={e => { e.stopPropagation(); save(x => { x.volumeKeys.splice(i, 1); }, 'Remove volume point'); }} />)}
  </div>;
}
function keyGainAt(k, t) { if (t <= k[0].t) return k[0].v; if (t >= k.at(-1).t) return k.at(-1).v; for (let i = 1; i < k.length; i++) if (t <= k[i].t) { const a = k[i - 1], b = k[i]; return a.v + (b.v - a.v) * (t - a.t) / Math.max(1e-6, b.t - a.t); } return 1; }
function Clip({ c, t, z }) {
  const sel = selection.value.includes(c.id); const d = drag.value;
  let start = c.start, dur = c.duration, shiftY = 0;
  if (d && d.ids.includes(c.id)) {
    if (d.mode === 'move') { start = Math.max(0, c.start + d.dt); shiftY = d.dy || 0; }
    if (d.mode === 'start') { start = d.t; dur = clipEnd(c) - d.t; }
    if (d.mode === 'end') dur = d.t - c.start;
  }
  const a = c.mediaId ? asset(c.mediaId) : null;
  const left = start * z, w = Math.max(2, dur * z);
  const p = project.value;
  const partner = c.kind !== 'audio' && transitionPartner(p, c);
  const label = c.kind === 'text' ? c.text : c.kind === 'sticker' ? (c.sticker?.type === 'emoji' ? c.sticker.value : c.name || 'Sticker') : c.kind === 'adjust' ? [c.filter?.id && filterDef(c.filter.id)?.name, ...(c.effects || []).map(e => effectDef(e.id)?.name)].filter(Boolean).join(' + ') || c.name : c.name || a?.name || 'Clip';
  return <div class={`clip k-${c.kind} ${c.caption ? 'caption' : ''} ${sel ? 'sel' : ''} ${a?.missing ? 'missing' : ''} ${c.muted ? 'muted' : ''} ${d?.ids.includes(c.id) ? 'dragging' : ''}`}
    style={{ transform: `translate(${left}px, ${shiftY}px)`, width: w }} data-clip={c.id}
    onPointerDown={e => clipDown(e, c, t, z)} onContextMenu={e => clipMenu(e, c, t)} onDblClick={() => { if (c.kind === 'text') setTimeout(() => document.querySelector('.insp-text textarea')?.focus(), 30); }}>
    {(c.kind === 'video' || c.kind === 'image') && a && <Filmstrip c={c} a={a} start={start} w={w} z={z} h={trackH(t) - 18} />}
    {(c.kind === 'audio' || (c.kind === 'video' && t.main)) && a?.audio && !c.muted && <Wave c={c} a={a} start={start} w={w} z={z} tall={c.kind === 'audio'} />}
    {((c.kind === 'audio') || (c.kind === 'video' && a?.audio)) && !c.muted && (sel || c.volumeKeys?.length > 0) && <Envelope c={c} w={w} z={z} sel={sel} />}
    <div class="clip-label">
      {c.speed && c.speed !== 1 && <span class="badge"><Gauge size={10} />{+c.speed.toFixed(2)}×</span>}
      {c.muted && <VolumeX size={11} />}
      {c.filter?.id && c.kind !== 'adjust' && <span class="badge">{filterDef(c.filter.id)?.name || 'LUT'}</span>}
      {c.effects?.length > 0 && c.kind !== 'adjust' && <Sparkles size={10} />}
      {c.takes?.length > 1 && <span class="badge" data-tip="Recording takes">{(c.takes.findIndex(k => k.mediaId === c.mediaId) + 1) || 1}/{c.takes.length} takes</span>}
      <span class="ellipsis">{label}</span>
      {w > 90 && c.kind !== 'text' && <span class="dur">{shortTime(dur)}</span>}
    </div>
    {c.keyframes && [...new Set(Object.values(c.keyframes).flat().map(k => +k.t.toFixed(3)))].filter(k => k <= c.duration).map(k => <span key={'k' + k} class="clip-key" style={{ left: k * z }} data-tip="Keyframe · click to jump" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); selection.value = [c.id]; player.current?.seek(c.start + k); }} />)}
    {c.markers?.map((m, i) => <span key={i} class="clip-marker" style={{ left: ((m.t - (c.in || 0)) / (c.speed || 1)) * z }} data-tip={m.label || 'Mistake marker'} />)}
    {partner && <button class={`tr-mark ${c.transition ? 'on' : ''}`} style={{ left: -9 }} data-tip={c.transition ? transitionDef(c.transition.id)?.name + ' · click to edit' : 'Add a transition'} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); selection.value = [c.id]; if (!c.transition) applyTransition('dissolve', c.id); else libraryTab.value = 'transitions'; }}><Blend size={10} /></button>}
    {!trackOf(p, c.trackId)?.locked && <><span class="edge l" onPointerDown={e => edgeDown(e, c, 'start', z)} /><span class="edge r" onPointerDown={e => edgeDown(e, c, 'end', z)} /></>}
  </div>;
}

// Filmstrip: only the tiles inside the visible window are drawn.
function Filmstrip({ c, a, start, w, z, h }) {
  if (a.kind === 'image') return <div class="strip" style={{ backgroundImage: a.thumb ? `url(${a.thumb})` : (a.svg ? `url(${a.url})` : 'none'), backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />;
  const s = a.strip; if (!s) return <div class="strip loading" />;
  const tileW = Math.max(24, h * 16 / 9);
  const { left, width } = scroll.value; const x0 = Math.max(0, left - HEADER_W - start * z), x1 = Math.min(w, left + width - start * z);
  const tiles = [];
  for (let i = Math.floor(x0 / tileW); i * tileW < x1; i++) {
    const src = c.in + ((i + 0.5) * tileW / z) * (c.speed || 1); const idx = Math.min(s.count - 1, Math.max(0, Math.floor(src / s.interval)));
    tiles.push(<i key={i} style={{ left: i * tileW, width: tileW, backgroundImage: `url(${s.url})`, backgroundSize: `${s.count * tileW}px 100%`, backgroundPosition: `${-idx * tileW}px 0` }} />);
  }
  return <div class="strip">{tiles}</div>;
}
const peakCache = new Map();
function usePeaks(url) {
  const [peaks, setPeaks] = useState(() => peakCache.get(url) || null);
  useEffect(() => { if (!url || peakCache.has(url)) { setPeaks(peakCache.get(url) || null); return; } fetch(url).then(r => r.arrayBuffer()).then(b => { const pk = new Uint8Array(b); peakCache.set(url, pk); setPeaks(pk); }).catch(() => {}); }, [url]);
  return peaks;
}
function Wave({ c, a, start, w, z, tall }) {
  const peaks = usePeaks(a.wave); const ref = useRef();
  const { left, width } = scroll.value; const x0 = Math.max(0, Math.floor(left - HEADER_W - start * z)), x1 = Math.min(w, Math.ceil(left + width - start * z)); const vw = Math.max(0, x1 - x0);
  useEffect(() => {
    const cv = ref.current; if (!cv || !peaks || !vw) return; const dpr = window.devicePixelRatio || 1;
    const hh = cv.parentElement.clientHeight; cv.width = Math.ceil(vw * dpr); cv.height = Math.ceil(hh * dpr); const g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = tall ? 'rgba(180,255,220,.75)' : 'rgba(200,220,255,.45)'; const mid = tall ? hh / 2 : hh - 2;
    const keys = c.volumeKeys || c.duckKeys ? null : null;
    for (let x = 0; x < vw; x++) {
      const tl = (x0 + x) / z, src0 = c.in + tl * (c.speed || 1), src1 = c.in + (tl + 1 / z) * (c.speed || 1);
      let m = 0; for (let i = Math.floor(src0 * 100); i <= Math.floor(src1 * 100) && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const gain = Math.min(2, (c.volume ?? 1) * keyGain(c.volumeKeys, tl) * keyGain(c.duckKeys, tl));
      const v = Math.min(1, m / 255 * gain) * (tall ? hh * 0.46 : hh * 0.5);
      if (tall) g.fillRect(x, mid - v, 1, Math.max(1, v * 2)); else g.fillRect(x, mid - v, 1, v);
    }
    if (c.volumeKeys?.length || c.duckKeys?.length) { g.strokeStyle = '#ffd36a'; g.lineWidth = 1.5; g.beginPath(); for (let x = 0; x < vw; x += 2) { const tl = (x0 + x) / z; const v = keyGain(c.volumeKeys, tl) * keyGain(c.duckKeys, tl); const y = hh - 4 - Math.min(1, v / 1.5) * (hh - 8); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  }, [peaks, x0, vw, z, c.in, c.speed, c.volume, c.volumeKeys, c.duckKeys]);
  if (!a.wave) return null;
  return <canvas ref={ref} class={`wave ${tall ? 'tall' : ''}`} style={{ left: x0, width: vw }} />;
}

// ---------- Interactions ----------
function snapPoints(p, exclude) {
  const pts = [0, time.value]; for (const c of p.clips) if (!exclude.has(c.id)) { pts.push(c.start, clipEnd(c)); }
  for (const m of p.markers) pts.push(m.t); return pts;
}
function snap(p, t, exclude, z, alt) {
  if (!p.settings.snapping || alt) { snapLine.value = null; return t; }
  const th = 8 / z; let best = null, d = th;
  for (const s of snapPoints(p, exclude)) if (Math.abs(s - t) < d) { d = Math.abs(s - t); best = s; }
  snapLine.value = best; return best ?? t;
}
function trackAtY(clientY) { const rows = [...document.querySelectorAll('.track-row')]; for (const r of rows) { const b = r.getBoundingClientRect(); if (clientY >= b.top && clientY < b.bottom) return { id: r.dataset.track, el: r, rect: b }; } return null; }

function clipDown(e, c, t, z) {
  if (e.button !== 0 || e.target.closest('.edge, .tr-mark')) return;
  e.stopPropagation();
  const p = project.value;
  if (e.ctrlKey || e.metaKey) { selection.value = selection.value.includes(c.id) ? selection.value.filter(x => x !== c.id) : [...selection.value, c.id]; return; }
  if (e.shiftKey && selection.value.length) { const tr = p.clips.filter(x => x.trackId === c.trackId); const s0 = Math.min(c.start, ...tr.filter(x => selection.value.includes(x.id)).map(x => x.start)); const s1 = Math.max(clipEnd(c), ...tr.filter(x => selection.value.includes(x.id)).map(clipEnd)); selection.value = [...new Set([...selection.value, ...tr.filter(x => x.start >= s0 && clipEnd(x) <= s1).map(x => x.id)])]; return; }
  if (!selection.value.includes(c.id)) selection.value = [c.id];
  if (t.locked) return;
  const ids = selection.value.filter(id => { const x = p.clips.find(k => k.id === id); return x && !trackOf(p, x.trackId)?.locked; });
  const el = e.currentTarget; el.setPointerCapture(e.pointerId);
  const x0 = e.clientX, y0 = e.clientY; let moved = false;
  const excl = new Set(ids); const first = Math.min(...ids.map(id => p.clips.find(k => k.id === id).start));
  const mv = ev => {
    const dx = ev.clientX - x0; if (!moved && Math.abs(dx) < 4 && Math.abs(ev.clientY - y0) < 4) return; moved = true; player.current?.pause();
    let dt = dx / z;
    // snap the dragged clip's edges
    const ns = c.start + dt, ne = ns + c.duration; const s1 = snap(p, ns, excl, z, ev.altKey);
    if (s1 !== ns) dt = s1 - c.start; else { const s2 = snap(p, ne, excl, z, ev.altKey); if (s2 !== ne) dt = s2 - clipEnd(c); }
    if (first + dt < 0) dt = -first;
    const over = trackAtY(ev.clientY); const target = over && trackOf(p, over.id);
    const dy = target && target.kind === t.kind && ids.length === 1 ? over.rect.top - el.closest('.track-row').getBoundingClientRect().top : 0;
    drag.value = { mode: 'move', ids, dt, dy, target: target && target.kind === t.kind ? target.id : null, newTrack: !over && ids.length === 1 ? (ev.clientY < el.closest('.tl-scroll').getBoundingClientRect().top + 60 ? 'top' : 'bottom') : null };
  };
  const up = () => {
    el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); snapLine.value = null;
    const d = drag.value; drag.value = null; if (!moved || !d) return;
    commit(ids.length > 1 ? 'Move clips' : 'Move clip', pp => {
      if (d.newTrack && ids.length === 1) { const tr = addTrack(pp, t.kind === 'video' && t.main ? 'video' : t.kind); d.target = tr.id; }
      const main = mainTrack(pp);
      for (const id of ids) {
        const x = pp.clips.find(k => k.id === id); const dest = ids.length === 1 && d.target ? d.target : x.trackId;
        const destTrack = trackOf(pp, dest); x.start = Math.max(0, x.start + d.dt);
        if (destTrack.kind !== trackKindFor(x.kind)) continue;
        if (destTrack.main) { x.trackId = dest; x.start -= 1e-3; continue; }
        x.trackId = dest;
      }
      for (const id of ids) { const x = pp.clips.find(k => k.id === id); const tr = trackOf(pp, x.trackId); if (!tr.main && overlaps(pp, x.trackId, x.start, clipEnd(x), new Set(ids))) x.trackId = freeTrack(pp, tr.kind, x.start, clipEnd(x), { ignore: new Set(ids) }).id; }
      // magnetic main track: order by new start, then pack
      const mains = pp.clips.filter(k => k.trackId === main.id).sort((a2, b2) => a2.start - b2.start); let tt = 0; if (pp.settings.magnetic) for (const k of mains) { k.start = tt; tt += k.duration; }
      for (const k of pp.clips) if (k.transition && !transitionPartner(pp, k)) k.transition = null;
      pp.tracks = pp.tracks.filter(tr => tr.main || tr.captions || pp.clips.some(k => k.trackId === tr.id) || !tr.autoRemove);
    });
  };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
}
function edgeDown(e, c, edge, z) {
  e.stopPropagation(); e.preventDefault(); if (e.button !== 0) return;
  selection.value = [c.id]; player.current?.pause();
  const el = e.currentTarget; el.setPointerCapture(e.pointerId); const p = project.value; const a = c.mediaId && asset(c.mediaId);
  const speed = c.speed || 1, end = clipEnd(c);
  const minStart = (c.kind === 'video' || c.kind === 'audio') ? c.start - c.in / speed : 0;
  const maxEnd = (c.kind === 'video' || c.kind === 'audio') && a ? c.start + (a.duration - c.in) / speed : Infinity;
  const r0 = el.closest('.track-lane').getBoundingClientRect();
  const mv = ev => {
    let t = (ev.clientX - r0.left) / z; t = snap(p, t, new Set([c.id]), z, ev.altKey);
    if (edge === 'start') t = Math.min(end - 0.05, Math.max(Math.max(0, minStart), t)); else t = Math.max(c.start + 0.05, Math.min(maxEnd, t));
    drag.value = { mode: edge, ids: [c.id], t };
    player.current?.seek(edge === 'start' ? t : t - 1 / 60);
  };
  const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); snapLine.value = null; const d = drag.value; drag.value = null; if (d) trimClip(c.id, edge, d.t); };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
}
function clipMenu(e, c, t) {
  if (!selection.value.includes(c.id)) selection.value = [c.id];
  const n = selection.value.length;
  openMenu(e, [
    { text: 'Split at playhead', icon: Scissors, sc: 'Ctrl+B', onClick: () => splitAt() },
    { text: 'Duplicate', icon: Copy, sc: 'Ctrl+D', onClick: () => duplicateClips() },
    { text: 'Copy', sc: 'Ctrl+C', onClick: () => copyClips() }, { text: 'Cut', sc: 'Ctrl+X', onClick: () => cutClips() }, { text: 'Paste at playhead', sc: 'Ctrl+V', onClick: () => pasteClips() },
    { divider: true },
    c.kind === 'video' && asset(c.mediaId)?.audio && !c.detachedAudio && { text: 'Separate audio', icon: Unlink, onClick: () => detachAudio(c.id) },
    (c.kind === 'video' || c.kind === 'audio') && { text: c.muted ? 'Unmute' : 'Mute', icon: c.muted ? Volume2 : VolumeX, sc: 'Ctrl+M', onClick: () => updateClip(c.id, x => { x.muted = !x.muted; }, { label: 'Mute' }) },
    c.kind !== 'audio' && c.kind !== 'adjust' && transitionPartner(project.value, c) && { text: c.transition ? 'Remove transition' : 'Add transition', icon: Blend, onClick: () => c.transition ? updateClip(c.id, x => { x.transition = null; }, { label: 'Remove transition' }) : applyTransition('dissolve', c.id) },
    { divider: true },
    { text: n > 1 ? `Delete ${n} clips` : 'Delete', icon: Trash2, sc: 'Del', danger: true, onClick: () => deleteClips() },
    !t.main && { text: 'Delete and close gap', sc: 'Shift+Del', danger: true, onClick: () => deleteClips(undefined, { ripple: true }) },
  ]);
}

// ---------- Drops from the asset panel ----------
function useDrop(sc, z) {
  const locate = e => {
    const el = sc.current; const r = el.getBoundingClientRect(); const t = Math.max(0, (e.clientX - r.left - HEADER_W + el.scrollLeft) / z);
    const over = trackAtY(e.clientY); return { t, track: over ? trackOf(project.value, over.id) : null, over };
  };
  return {
    onDragOver: e => {
      const d = window.__fcDrag; if (!d && !e.dataTransfer.types.includes('Files')) return; e.preventDefault();
      const { t, over } = locate(e); const lane = over?.el.querySelector('.track-lane'); const el = sc.current;
      if (over && lane) { const lr = lane.getBoundingClientRect(), sr = el.getBoundingClientRect(); dropHint.value = { x: t * z, y: lr.top - sr.top + el.scrollTop, w: Math.max(30, ((d?.type === 'media' && asset(d.id)?.duration) || 3) * z), h: lr.height }; }
      else dropHint.value = null;
    },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) dropHint.value = null; },
    onDrop: async e => {
      e.preventDefault(); dropHint.value = null; const { t, track } = locate(e); const d = window.__fcDrag; window.__fcDrag = null;
      if (!d) {
        if (!e.dataTransfer.files.length) return;
        try { const r = await importFiles([...e.dataTransfer.files]); const m = new Map(media.value); for (const a of r.assets) m.set(a.id, a); media.value = m; if (r.errors.length) toast(r.errors.map(x => `${x.name}: ${x.error}`).join('\n'), 'error'); addAssets(r.assets, { at: t, trackId: track?.id }); } catch (err) { toast(err.message, 'error'); }
        return;
      }
      const p = project.value;
      if (d.type === 'media') {
        const a = asset(d.id); if (!a) return;
        if (d.asAudio || (track?.kind === 'audio' && a.kind === 'video')) { const c = newClip('audio', { mediaId: a.id, name: a.name.replace(/\.[^.]+$/, '') + (a.kind === 'video' ? ' (audio)' : ''), start: t, duration: a.duration }); commit('Add audio', pp => { c.trackId = freeTrack(pp, 'audio', t, t + a.duration, { prefer: track?.kind === 'audio' ? track.id : null }).id; pp.clips.push(c); if (!pp.mediaIds.includes(a.id)) pp.mediaIds.push(a.id); }, { select: [c.id] }); return; }
        const toMain = track?.main || (!track && a.kind !== 'audio');
        if (toMain) addAssets([a], { at: t }); else addAssets([a], { at: t, trackId: track?.kind === trackKindFor(a.kind === 'image' ? 'image' : a.kind) ? track.id : undefined, overlay: a.kind !== 'audio' });
      }
      if (d.type === 'text') addText({ style: d.style, at: t });
      if (d.type === 'textTemplate') addTextTemplate(TEXT_TEMPLATES.find(x => x.id === d.id), t);
      if (d.type === 'sticker') addSticker(d.sticker, { at: t });
      if (d.type === 'transition') { const target = p.clips.filter(c => c.kind !== 'audio' && (!track || c.trackId === track.id) && transitionPartner(p, c)).sort((a2, b2) => Math.abs(a2.start - t) - Math.abs(b2.start - t))[0]; applyTransition(d.id, target?.id); }
      const onClip = () => { const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.clip'); return el?.dataset.clip; };
      if (d.type === 'effect') { const id = onClip(); if (id) { selection.value = [id]; applyEffect(d.id); } else { selection.value = []; player.current?.seek(t); applyEffect(d.id); } }
      if (d.type === 'filter') { const id = onClip(); if (id) { selection.value = [id]; applyFilter(d.id, d.name); } else { selection.value = []; player.current?.seek(t); applyFilter(d.id, d.name); } }
    },
  };
}

function Toolbar() {
  const p = project.value, h = history.value, sel = selection.value.length > 0, z = zoom.value;
  return <div class="tl-toolbar">
    <button class="icon-btn" data-tip="Undo" data-kbd="Ctrl+Z" disabled={!h.past.length} onClick={() => undo()}><Undo2 size={16} /></button>
    <button class="icon-btn" data-tip="Redo" data-kbd="Ctrl+Y" disabled={!h.future.length} onClick={() => redo()}><Redo2 size={16} /></button>
    <span class="sep" />
    <button class="icon-btn" data-tip="Split at playhead" data-kbd="Ctrl+B" onClick={() => splitAt()}><Scissors size={16} /></button>
    <button class="icon-btn" data-tip="Trim start to playhead" data-kbd="Q" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))}><ArrowLeftToLine size={16} /></button>
    <button class="icon-btn" data-tip="Trim end to playhead" data-kbd="W" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))}><ArrowRightToLine size={16} /></button>
    <button class="icon-btn" data-tip="Delete" data-kbd="Del" disabled={!sel} onClick={() => deleteClips()}><Trash2 size={16} /></button>
    <button class="icon-btn" data-tip="Duplicate" data-kbd="Ctrl+D" disabled={!sel} onClick={() => duplicateClips()}><Copy size={16} /></button>
    <button class="icon-btn" data-tip="Add marker at playhead" data-kbd="" onClick={() => commit('Add marker', d => { d.markers.push({ t: time.value, label: '' }); d.markers.sort((a, b) => a.t - b.t); })}><Diamond size={15} /></button>
    <button class="icon-btn" data-tip="Record voiceover" onClick={openStudio}><Mic size={16} /></button>
    <div class="grow" />
    <button class={`icon-btn ${p.settings.snapping ? 'on' : ''}`} data-tip="Snapping" data-kbd="N" onClick={() => commit('Toggle snapping', d => { d.settings.snapping = !d.settings.snapping; })}><Magnet size={16} /></button>
    <button class={`btn ghost sm ${p.settings.magnetic ? 'on-text' : ''}`} data-tip="Magnetic main track keeps clips together" onClick={() => commit('Toggle magnetic track', d => { d.settings.magnetic = !d.settings.magnetic; })}>Magnetic {p.settings.magnetic ? 'on' : 'off'}</button>
    <span class="sep" />
    <button class="icon-btn" data-tip="Zoom out" data-kbd="−" onClick={() => (zoom.value = Math.max(4, z / 1.4))}><ZoomOut size={16} /></button>
    <input type="range" class="zoom-range" min={Math.log(4)} max={Math.log(800)} step={0.01} value={Math.log(z)} style={{ '--fill': ((Math.log(z) - Math.log(4)) / (Math.log(800) - Math.log(4)) * 100) + '%' }} onInput={e => (zoom.value = Math.exp(+e.target.value))} aria-label="Timeline zoom" />
    <button class="icon-btn" data-tip="Zoom in" data-kbd="=" onClick={() => (zoom.value = Math.min(800, z * 1.4))}><ZoomIn size={16} /></button>
    <button class="icon-btn" data-tip="Fit to window" data-kbd="F" onClick={fitTimeline}><Maximize size={15} /></button>
  </div>;
}
