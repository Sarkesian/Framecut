// Multitrack timeline: tracks, clips (filmstrips, waveforms), playhead, snapping, trimming, dragging and drops.
import { LiveTakeRow } from './LiveTake.jsx';
import { useEffect, useRef, useState, useMemo } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Scissors, Trash2, Copy, Undo2, Redo2, Magnet, ZoomIn, ZoomOut, Maximize, Eye, EyeOff, Lock, LockOpen, Volume2, VolumeX, Plus, Film, Music, Type, Layers, Snowflake, Unlink, Link2, Pencil, ArrowLeftRight, ArrowLeftToLine, ArrowRightToLine, Diamond, Gauge, Blend, Captions, Sparkles, Mic, MoreHorizontal } from 'lucide-preact';
import { project, selection, time, zoom, media, asset, player, history, undo, redo, commit, toast, drag, playing, duration, libraryTab } from '../lib/state.js';
import { splitAt, deleteClips, duplicateClips, copyClips, cutClips, pasteClips, placeClips, trimClips, trimLimits, setTrack, removeTrack, addTrack, closeGaps, closeGap, trackGaps, detachAudio, addAssets, addText, addSticker, applyEffect, applyFilter, applyTransition, trackOf, overlaps, freeTrack, updateClip, partnerOf, unlinkClip } from '../lib/edit.js';
import { beginDrag } from '../lib/drag.js';
import { timelineTargets, snapEdges, toFrame } from '../../shared/snap.mjs';
import { keySel, keyDrag, keyTimes, isKeySelected, toggleKey, clearKeys, moveKeys, deleteKeys, setKeyEasing, copyKeys, pasteKeys } from '../lib/keyedit.js';
import { EASINGS } from '../../shared/keys.mjs';
import { ui, setUi } from '../lib/uiprefs.js';
import { timecode } from '../lib/format.js';
import { clipEnd, trackKindFor, mainTrack, transitionPartner, newClip, uid } from '../../shared/model.mjs';
import { transitionDef, effectDef, filterDef } from '../../shared/catalog.mjs';
import { openMenu, prompt } from './kit.jsx';
import { importFiles } from '../lib/api.js';
import { fitTimeline, zoomAround } from './commands.jsx';
import { addTextTemplate } from './AssetPanel.jsx';
import { openStudio } from './Studio.jsx';
import { TEXT_TEMPLATES } from '../../shared/templates.mjs';
import { shortTime } from '../lib/format.js';
import { keyGain } from '../../shared/audio.mjs';

const HEADER_W = 168, RULER_H = 26;
const H = { video: 58, main: 66, audio: 52, text: 32, effect: 30 };
const trackH = t => (t.main ? H.main : H[t.kind] || 40);
const KIND_ICON = { video: Film, audio: Music, text: Type, effect: Layers };
const scroll = signal({ left: 0, width: 1000, top: 0 });
const snapLine = signal(null); // { t, kind } while an edge is snapped
const readout = signal(null); // { t, text } floating timecode/duration readout while scrubbing, moving or trimming
const marquee = signal(null);
const dropHint = signal(null);

export function Timeline() {
  const p = project.value, z = zoom.value;
  const sc = useRef();
  const total = Math.max(duration.value + 30, (scroll.value.width / z) * 1.2);
  const width = total * z;
  useEffect(() => {
    const el = sc.current; const update = () => (scroll.value = { left: el.scrollLeft, width: el.clientWidth, top: el.scrollTop });
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
      // Zoom around the time under the cursor.
      e.preventDefault(); const el = sc.current; const r = el.getBoundingClientRect();
      zoomAround(e.deltaY < 0 ? 1.18 : 1 / 1.18, (e.clientX - r.left - HEADER_W + el.scrollLeft) / z, e.clientX - r.left - HEADER_W);
    } else if (e.shiftKey) { e.preventDefault(); sc.current.scrollLeft += e.deltaY; }
  };
  const timeAt = clientX => { const el = sc.current; const r = el.getBoundingClientRect(); return Math.max(0, (clientX - r.left - HEADER_W + el.scrollLeft) / z); };
  // Playhead position for a pointer x: frame-exact, snapped to edges/markers unless Alt is held or snapping is off.
  const scrubTime = (clientX, alt, prev) => {
    const raw = timeAt(clientX), fps = p.settings.fps;
    if (p.settings.snapping && !alt) {
      const hit = snapEdges([raw], timelineTargets(p), ui.value.snapPx / z, prev);
      if (hit) return { t: Math.min(duration.value, hit.target.t), hit };
    }
    return { t: Math.min(duration.value, toFrame(raw, fps)), hit: null };
  };
  // Click to seek, drag to scrub, release to stop. The playhead never follows the pointer after release.
  const scrub = e => {
    if (e.button !== 0) return; e.preventDefault();
    const wasPlaying = playing.value; player.current?.pause();
    let last = null;
    // The press itself seeks exactly where clicked; snapping only assists while dragging.
    const go = (ev, first) => {
      last = scrubTime(ev.clientX, first === true || ev.altKey, last?.hit || null);
      snapLine.value = last.hit ? { t: last.t, kind: last.hit.target.kind } : null;
      player.current?.seek(last.t); readout.value = { t: last.t, text: timecode(last.t, p.settings.fps) };
    };
    const ctl = beginDrag(e, { cursor: 'ew-resize', move: go, end: () => { snapLine.value = null; readout.value = null; if (wasPlaying) player.current?.play(); } });
    if (ctl) go(e, true);
  };
  // Marquee select on empty space (clips and keyframes); a plain click seeks and clears the selection.
  const onBgDown = e => {
    if (e.button !== 0 || e.target.closest('.clip, .track-head, .ruler, .ph-head, .corner')) return;
    const el = sc.current; const r = el.getBoundingClientRect(); const x0 = e.clientX - r.left + el.scrollLeft - HEADER_W, y0 = e.clientY - r.top + el.scrollTop;
    beginDrag(e, {
      threshold: 5, capture: el,
      move: ev => { const x1 = ev.clientX - r.left + el.scrollLeft - HEADER_W, y1 = ev.clientY - r.top + el.scrollTop; marquee.value = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }; },
      cancel: () => { marquee.value = null; },
      end: (ev, { moved }) => {
        if (!moved) { if (!(ev.ctrlKey || ev.shiftKey)) { selection.value = []; clearKeys(); } player.current?.seek(Math.min(duration.value, toFrame(timeAt(ev.clientX), p.settings.fps))); return; }
        const m = marquee.value; marquee.value = null; if (!m) return;
        const t0 = m.x / z, t1 = (m.x + m.w) / z; let y = RULER_H; const hit = [], keys = [];
        for (const t of project.value.tracks) {
          const h = trackH(t);
          if (y + h > m.y && y < m.y + m.h && !t.locked) for (const c of project.value.clips) if (c.trackId === t.id && c.start < t1 && clipEnd(c) > t0) {
            hit.push(c.id);
            // Diamonds sit along the bottom of the clip: include them when the box reaches that band.
            if (y + h - 16 < m.y + m.h) for (const k of keyTimes(c)) if (c.start + k >= t0 && c.start + k <= t1) keys.push({ id: c.id, t: k });
          }
          y += h;
        }
        const add = ev.ctrlKey || ev.shiftKey;
        selection.value = add ? [...new Set([...selection.value, ...hit])] : hit;
        keySel.value = add ? [...keySel.value, ...keys.filter(k => !isKeySelected(k.id, k.t))] : keys;
      },
    });
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
        {snapLine.value && <div class={`snap-line k-${snapLine.value.kind}`} style={{ left: HEADER_W + snapLine.value.t * z }} />}
        {readout.value && <div class="tl-readout mono" style={{ left: HEADER_W + readout.value.t * z, top: scroll.value.top + RULER_H + 4 }}>{readout.value.text}</div>}
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
    <div class="track-lane" style={{ width }}>{clips.map(c => <Clip key={c.id} c={c} t={t} z={z} />)}<Gaps t={t} z={z} /></div>
  </div>;
}

// Empty space between clips: shown subtly so accidental gaps are easy to spot; right-click or double-click closes one.
function Gaps({ t, z }) {
  const p = project.value; if (t.hidden || (t.main && p.settings.magnetic)) return null;
  const min = 1 / fpsOf(p) - 1e-6;
  return trackGaps(p, t.id, min).filter(g => (g.end - g.start) * z >= 3 && (g.start > 0 || t.main)).map(g => <div key={g.start} class="gap" style={{ left: g.start * z, width: (g.end - g.start) * z }}
    data-tip={`Gap · ${durText(g.end - g.start, fpsOf(p))} — double-click to close`} onDblClick={e => { e.stopPropagation(); closeGap(t.id, (g.start + g.end) / 2); }}
    onContextMenu={e => openMenu(e, [{ text: 'Close gap', onClick: () => closeGap(t.id, (g.start + g.end) / 2) }, { text: 'Close all gaps on track', onClick: () => closeGaps(t.id) }])} />);
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
    const el = e.currentTarget; const lo = i > 0 ? keys[i - 1].t + 0.01 : 0, hi = i < keys.length - 1 ? keys[i + 1].t - 0.01 : c.duration;
    // Shift locks the level (move in time only).
    beginDrag(e, { threshold: 2, move: ev => { const p = vAt(ev); save(x => { x.volumeKeys[i] = { t: Math.min(hi, Math.max(lo, p.t)), v: ev.shiftKey ? keys[i].v : Math.round(p.v * 1000) / 1000 }; }, 'Move volume point', 'env:' + c.id + i); el.dataset.tip = db(p.v); } });
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
    if (d.mode === 'move') { start = Math.max(0, c.start + d.dt); shiftY = d.dyId === c.id ? d.dy || 0 : 0; }
    // A ripple start-trim keeps the clip in place (later clips close up on release).
    if (d.mode === 'trim' && d.edge === 'start') { start = d.ripple && !t.main ? c.start : c.start + d.dt; dur = c.duration - d.dt; }
    if (d.mode === 'trim' && d.edge === 'end') dur = c.duration + d.dt;
  }
  const a = c.mediaId ? asset(c.mediaId) : null;
  const left = start * z, w = Math.max(2, dur * z);
  const p = project.value;
  const partner = c.kind !== 'audio' && transitionPartner(p, c);
  const label = c.kind === 'text' ? c.text : c.kind === 'sticker' ? (c.sticker?.type === 'emoji' ? c.sticker.value : c.name || 'Sticker') : c.kind === 'adjust' ? [c.filter?.id && filterDef(c.filter.id)?.name, ...(c.effects || []).map(e => effectDef(e.id)?.name)].filter(Boolean).join(' + ') || c.name : c.name || a?.name || 'Clip';
  return <div class={`clip k-${c.kind} ${c.caption ? 'caption' : ''} ${sel ? 'sel' : ''} ${a?.missing ? 'missing' : ''} ${c.muted ? 'muted' : ''} ${d?.ids.includes(c.id) ? 'dragging' : ''} ${d?.copy && d.ids.includes(c.id) ? 'copying' : ''} ${c.locked ? 'locked' : ''}`}
    style={{ transform: `translate(${left}px, ${shiftY}px)`, width: w }} data-clip={c.id}
    onPointerDown={e => clipDown(e, c, t, z)} onContextMenu={e => clipMenu(e, c, t)} onDblClick={() => { if (c.kind === 'text') setTimeout(() => document.querySelector('.insp-text textarea')?.focus(), 30); }}>
    {(c.kind === 'video' || c.kind === 'image') && a && <Filmstrip c={c} a={a} start={start} w={w} z={z} h={trackH(t) - 18} />}
    {(c.kind === 'audio' || (c.kind === 'video' && t.main)) && a?.audio && !c.muted && <Wave c={c} a={a} start={start} w={w} z={z} tall={c.kind === 'audio'} />}
    {((c.kind === 'audio') || (c.kind === 'video' && a?.audio)) && !c.muted && (sel || c.volumeKeys?.length > 0) && <Envelope c={c} w={w} z={z} sel={sel} />}
    <div class="clip-label">
      {c.speed && c.speed !== 1 && <span class="badge"><Gauge size={10} />{+c.speed.toFixed(2)}×</span>}
      {c.locked && <Lock size={10} />}
      {c.muted && <VolumeX size={11} />}
      {c.detachedAudio && ui.value.linked && <Link2 size={10} />}
      {c.filter?.id && c.kind !== 'adjust' && <span class="badge">{filterDef(c.filter.id)?.name || 'LUT'}</span>}
      {c.effects?.length > 0 && c.kind !== 'adjust' && <Sparkles size={10} />}
      {c.takes?.length > 1 && <span class="badge" data-tip="Recording takes">{(c.takes.findIndex(k => k.mediaId === c.mediaId) + 1) || 1}/{c.takes.length} takes</span>}
      <span class="ellipsis">{label}</span>
      {w > 90 && c.kind !== 'text' && <span class="dur">{shortTime(dur)}</span>}
    </div>
    {c.keyframes && keyTimes(c).map(k => { const on = isKeySelected(c.id, k), kd = keyDrag.value; const kt = on && kd ? Math.min(c.duration, Math.max(0, k + kd.dt)) : k; return <span key={'k' + k} class={`clip-key ${on ? 'sel' : ''}`} style={{ left: kt * z }} data-tip="Keyframe · click to jump, Shift+click to multi-select, drag to move" onPointerDown={e => keyDown(e, c, k, z)} onContextMenu={e => { e.stopPropagation(); keyMenu(e, c, k); }} />; })}
    {c.markers?.map((m, i) => <span key={i} class="clip-marker" style={{ left: ((m.t - (c.in || 0)) / (c.speed || 1)) * z }} data-tip={m.label || 'Mistake marker'} />)}
    {partner && <button class={`tr-mark ${c.transition ? 'on' : ''}`} style={{ left: -9 }} data-tip={c.transition ? transitionDef(c.transition.id)?.name + ' · click to edit' : 'Add a transition'} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); selection.value = [c.id]; if (!c.transition) applyTransition('dissolve', c.id); else libraryTab.value = 'transitions'; }}><Blend size={10} /></button>}
    {!trackOf(p, c.trackId)?.locked && !c.locked && <><span class="edge l" onPointerDown={e => edgeDown(e, c, 'start', z)} /><span class="edge r" onPointerDown={e => edgeDown(e, c, 'end', z)} /></>}
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
// All drags go through beginDrag (src/lib/drag.js): they end on release anywhere, never leave listeners behind,
// and only one runs at a time. Snapping is frame-exact, measured in screen pixels (same feel at every zoom),
// holds an engaged target with hysteresis (no jitter) and is bypassed with Alt.
const fpsOf = p => p.settings.fps || 30;
const durText = (d, fps) => timecode(Math.max(0, d), fps).slice(3);
function snapDelta(p, candidates, exclude, z, alt, prev) {
  if (!p.settings.snapping || alt) { snapLine.value = null; return null; }
  const hit = snapEdges(candidates, timelineTargets(p, { exclude, playhead: time.value }), ui.value.snapPx / z, prev);
  snapLine.value = hit ? { t: hit.target.t, kind: hit.target.kind } : null;
  return hit;
}
function trackAtY(clientY) { const rows = [...document.querySelectorAll('.track-row')]; for (const r of rows) { const b = r.getBoundingClientRect(); if (clientY >= b.top && clientY < b.bottom) return { id: r.dataset.track, el: r, rect: b }; } return null; }
const movable = (p, id) => { const x = p.clips.find(k => k.id === id); return x && !x.locked && !trackOf(p, x.trackId)?.locked; };
// Linked audio/video halves travel together while linking is on.
function withPartners(p, ids, alignedEdge) {
  if (!ui.value.linked) return ids;
  const out = new Set(ids);
  for (const id of ids) {
    const c = p.clips.find(k => k.id === id), o = partnerOf(p, c); if (!o || !movable(p, o.id)) continue;
    if (alignedEdge && Math.abs((alignedEdge === 'start' ? o.start - c.start : clipEnd(o) - clipEnd(c))) > 1e-3) continue;
    out.add(o.id);
  }
  return [...out];
}
const endDragUi = () => { drag.value = null; snapLine.value = null; readout.value = null; };

function clipDown(e, c, t, z) {
  if (e.button !== 0 || e.target.closest('.edge, .tr-mark, .clip-key, .env-pt')) return;
  e.stopPropagation();
  const p = project.value, fps = fpsOf(p), toggle = e.ctrlKey || e.metaKey;
  if (e.shiftKey && selection.value.length) { const tr = p.clips.filter(x => x.trackId === c.trackId); const s0 = Math.min(c.start, ...tr.filter(x => selection.value.includes(x.id)).map(x => x.start)); const s1 = Math.max(clipEnd(c), ...tr.filter(x => selection.value.includes(x.id)).map(clipEnd)); selection.value = [...new Set([...selection.value, ...tr.filter(x => x.start >= s0 && clipEnd(x) <= s1).map(x => x.id)])]; return; }
  clearKeys();
  // Ctrl+click toggles selection on release; Ctrl+drag duplicates the selection.
  const toggled = selection.value.includes(c.id) ? selection.value.filter(x => x !== c.id) : [...selection.value, c.id];
  if (!toggle && !selection.value.includes(c.id)) selection.value = [c.id];
  const pressed = toggle && !selection.value.includes(c.id) ? [...selection.value, c.id] : selection.value;
  const base = pressed.filter(id => movable(p, id));
  if (!base.includes(c.id)) { if (toggle) beginDrag(e, { threshold: 4, end: (_, { moved }) => { if (!moved) selection.value = toggled; } }); return; }
  const ids = withPartners(p, base);
  const el = e.currentTarget, x0 = e.clientX;
  const first = Math.min(...ids.map(id => p.clips.find(k => k.id === id).start)), last = Math.max(...ids.map(id => clipEnd(p.clips.find(k => k.id === id))));
  let prev = null;
  beginDrag(e, {
    threshold: 4,
    move: ev => {
      player.current?.pause();
      const raw = (ev.clientX - x0) / z, edges = [c.start, clipEnd(c), first, last];
      const hit = snapDelta(p, edges.map(x => x + raw), toggle ? new Set() : new Set(ids), z, ev.altKey, prev); prev = hit;
      let dt = hit ? hit.target.t - edges[hit.edge] : toFrame(first + raw, fps) - first;
      if (first + dt < 0) { dt = -first; snapLine.value = null; }
      const over = trackAtY(ev.clientY); const target = over && trackOf(p, over.id);
      const okTrack = target && target.kind === t.kind && !target.locked && base.length === 1;
      const dy = okTrack ? over.rect.top - el.closest('.track-row').getBoundingClientRect().top : 0;
      // Dropping in the timeline's empty space above/below the tracks makes a new track; outside the timeline it doesn't.
      const sr = el.closest('.tl-scroll').getBoundingClientRect(), inside = ev.clientX >= sr.left && ev.clientX <= sr.right && ev.clientY >= sr.top && ev.clientY <= sr.bottom;
      drag.value = { mode: 'move', ids, dt, dy, dyId: c.id, copy: toggle, target: okTrack ? target.id : null, newTrack: !over && inside && base.length === 1 ? (ev.clientY < sr.top + 60 ? 'top' : 'bottom') : null };
      readout.value = { t: c.start + dt, text: `${timecode(c.start + dt, fps)}  ${dt >= 0 ? '+' : '−'}${durText(Math.abs(dt), fps)}${toggle ? '  copy' : ''}` };
    },
    cancel: endDragUi,
    end: (_, { moved }) => {
      const d = drag.value; endDragUi();
      if (!moved || !d) { if (toggle) selection.value = toggled; else if (selection.value.length > 1) selection.value = [c.id]; return; }
      let out = null;
      commit(d.copy ? (ids.length > 1 ? 'Duplicate clips' : 'Duplicate clip') : ids.length > 1 ? 'Move clips' : 'Move clip', pp => {
        let work = ids;
        if (d.copy) {
          const map = new Map(ids.map(id => [id, uid()]));
          for (const id of ids) { const cp = structuredClone(pp.clips.find(k => k.id === id)); cp.id = map.get(id); cp.transition = null; if (cp.detachedAudio) { if (map.has(cp.detachedAudio)) cp.detachedAudio = map.get(cp.detachedAudio); else delete cp.detachedAudio; } pp.clips.push(cp); }
          work = ids.map(id => map.get(id)); out = work.filter((_, i) => base.includes(ids[i]));
        }
        const lead = work[ids.indexOf(c.id)];
        if (d.newTrack) { const tr = addTrack(pp, t.kind === 'video' && t.main ? 'video' : t.kind); d.target = tr.id; }
        const before = new Map(work.map(id => [id, pp.clips.find(k => k.id === id).start]));
        const main = mainTrack(pp);
        for (const id of work) {
          const x = pp.clips.find(k => k.id === id); const dest = id === lead && d.target ? d.target : x.trackId;
          const destTrack = trackOf(pp, dest); x.start = Math.max(0, x.start + d.dt);
          if (destTrack.kind !== trackKindFor(x.kind)) continue;
          if (destTrack.main) { x.trackId = dest; x.start -= 1e-3; continue; }
          x.trackId = dest;
        }
        const keep = new Set(work);
        for (const id of work) { const x = pp.clips.find(k => k.id === id); const tr = trackOf(pp, x.trackId); if (!tr.main && overlaps(pp, x.trackId, x.start, clipEnd(x), keep)) x.trackId = freeTrack(pp, tr.kind, x.start, clipEnd(x), { ignore: keep }).id; }
        // magnetic main track: order by new start, then pack
        const mains = pp.clips.filter(k => k.trackId === main.id).sort((a2, b2) => a2.start - b2.start); let tt = 0; if (pp.settings.magnetic) for (const k of mains) { k.start = tt; tt += k.duration; }
        // Linked halves keep their offset to the half on the (packed) main track.
        for (const id of work) {
          const x = pp.clips.find(k => k.id === id), o = partnerOf(pp, x);
          if (!o || !keep.has(o.id) || x.trackId !== main.id || !pp.settings.magnetic) continue;
          o.start = Math.max(0, x.start + (before.get(o.id) - before.get(id)));
          const tr = trackOf(pp, o.trackId); if (!tr.main && overlaps(pp, o.trackId, o.start, clipEnd(o), new Set([o.id]))) o.trackId = freeTrack(pp, tr.kind, o.start, clipEnd(o), { ignore: new Set([o.id]) }).id;
        }
        for (const k of pp.clips) if (k.transition && !transitionPartner(pp, k)) k.transition = null;
        pp.tracks = pp.tracks.filter(tr => tr.main || tr.captions || pp.clips.some(k => k.trackId === tr.id) || !tr.autoRemove);
      });
      if (out) selection.value = out;
    },
  });
}

// Trim handles. Every selected clip's same edge moves by the same amount (multi-trim); linked halves whose
// edge lines up follow. Shows the edge timecode and the resulting duration while dragging.
function edgeDown(e, c, edge, z) {
  e.stopPropagation(); e.preventDefault(); if (e.button !== 0) return;
  const p = project.value, fps = fpsOf(p); clearKeys();
  if (c.locked) return;
  if (!selection.value.includes(c.id)) selection.value = [c.id];
  let base = selection.value.filter(id => movable(p, id));
  if (!base.includes(c.id)) base = [c.id];
  const ids = withPartners(p, base, edge), clips = ids.map(id => p.clips.find(k => k.id === id));
  const lim = new Map(clips.map(x => [x.id, trimLimits(x)]));
  const e0 = edge === 'start' ? c.start : clipEnd(c);
  const r0 = e.currentTarget.closest('.track-lane').getBoundingClientRect();
  let prev = null;
  beginDrag(e, {
    threshold: 2, cursor: 'ew-resize',
    move: ev => {
      player.current?.pause();
      const raw = (ev.clientX - r0.left) / z;
      const hit = snapDelta(p, [raw], new Set(ids), z, ev.altKey, prev); prev = hit;
      let dt = (hit ? hit.target.t : toFrame(raw, fps)) - e0;
      for (const x of clips) {
        const L = lim.get(x.id), cur = edge === 'start' ? x.start : clipEnd(x);
        dt = Math.min((edge === 'start' ? L.maxStart : L.maxEnd) - cur, Math.max((edge === 'start' ? L.minStart : L.minEnd) - cur, dt));
      }
      const exact = hit && Math.abs(e0 + dt - hit.target.t) < 1e-9 ? hit.target.t : null;
      if (hit && exact === null) snapLine.value = null;
      const nt = exact ?? e0 + dt, dur = edge === 'start' ? clipEnd(c) - nt : nt - c.start;
      drag.value = { mode: 'trim', edge, ids, dt, exact, ripple: ui.value.ripple };
      readout.value = { t: nt, text: `${edge === 'start' ? 'In' : 'Out'} ${timecode(nt, fps)} · ${durText(dur, fps)}` };
      player.current?.seek(edge === 'start' ? nt : Math.max(c.start, nt - 1 / fps));
    },
    cancel: endDragUi,
    end: () => {
      const d = drag.value; endDragUi(); if (!d || !d.dt) return;
      trimClips(clips.map(x => ({ id: x.id, edge, t: x.id === c.id && d.exact !== null ? d.exact : (edge === 'start' ? x.start : clipEnd(x)) + d.dt })), { ripple: ui.value.ripple, key: null });
    },
  });
}

// Keyframe diamonds: click selects (and jumps there), Shift/Ctrl+click adds, drag moves every selected key in time.
function keyDown(e, c, k, z) {
  e.stopPropagation(); if (e.button !== 0) return; e.preventDefault();
  const p = project.value, fps = fpsOf(p), add = e.shiftKey || e.ctrlKey || e.metaKey, was = isKeySelected(c.id, k);
  if (!was) toggleKey(c.id, k, add);
  if (!selection.value.includes(c.id)) selection.value = add ? [...selection.value, c.id] : [c.id];
  const x0 = e.clientX;
  const sel = keySel.value.map(s => ({ ...s, dur: p.clips.find(x => x.id === s.id)?.duration ?? 0 }));
  beginDrag(e, {
    threshold: 3, cursor: 'ew-resize',
    move: ev => {
      let dt = Math.round((ev.clientX - x0) / z * fps) / fps;
      for (const s of sel) dt = Math.min(s.dur - s.t, Math.max(-s.t, dt));
      keyDrag.value = { dt }; readout.value = { t: c.start + k + dt, text: `${timecode(c.start + k + dt, fps)}  ${dt >= 0 ? '+' : '−'}${durText(Math.abs(dt), fps)}` };
    },
    cancel: () => { keyDrag.value = null; readout.value = null; },
    end: (_, { moved }) => {
      const d = keyDrag.value; keyDrag.value = null; readout.value = null;
      if (moved) { if (d?.dt) moveKeys(d.dt); return; }
      if (add && was) toggleKey(c.id, k, true);
      else if (!add) { keySel.value = [{ id: c.id, t: k }]; player.current?.seek(c.start + k); }
    },
  });
}
function keyMenu(e, c, k) {
  if (!isKeySelected(c.id, k)) keySel.value = [{ id: c.id, t: k }];
  const n = keySel.value.length;
  openMenu(e, [
    { label: n > 1 ? `${n} keyframes` : 'Keyframe' },
    ...EASINGS.map(es => ({ text: 'Easing: ' + es.name, onClick: () => setKeyEasing(es.id) })),
    { divider: true },
    { text: 'Copy', sc: 'Ctrl+C', onClick: () => copyKeys() },
    { text: 'Paste at playhead', sc: 'Ctrl+V', onClick: () => pasteKeys() },
    { text: n > 1 ? `Delete ${n} keyframes` : 'Delete keyframe', icon: Trash2, sc: 'Del', danger: true, onClick: () => deleteKeys() },
  ]);
}
function clipMenu(e, c, t) {
  if (!selection.value.includes(c.id)) selection.value = [c.id];
  const n = selection.value.length, p = project.value, partner = partnerOf(p, c);
  openMenu(e, [
    { text: 'Split at playhead', icon: Scissors, sc: 'Ctrl+B', onClick: () => splitAt() },
    { text: 'Duplicate', icon: Copy, sc: 'Ctrl+D', onClick: () => duplicateClips() },
    { text: 'Copy', sc: 'Ctrl+C', onClick: () => copyClips() }, { text: 'Cut', sc: 'Ctrl+X', onClick: () => cutClips() }, { text: 'Paste at playhead', sc: 'Ctrl+V', onClick: () => pasteClips() }, { text: 'Paste in place', sc: 'Ctrl+Shift+V', onClick: () => pasteClips(undefined, { inPlace: true }) },
    { divider: true },
    c.kind === 'video' && asset(c.mediaId)?.audio && !c.detachedAudio && { text: 'Separate audio', icon: Unlink, onClick: () => detachAudio(c.id) },
    partner && { text: 'Unlink audio and video', icon: Unlink, onClick: () => unlinkClip(c.id) },
    (c.kind === 'video' || c.kind === 'audio') && { text: c.muted ? 'Unmute' : 'Mute', icon: c.muted ? Volume2 : VolumeX, sc: 'Ctrl+M', onClick: () => updateClip(c.id, x => { x.muted = !x.muted; }, { label: 'Mute' }) },
    c.kind !== 'audio' && c.kind !== 'adjust' && transitionPartner(project.value, c) && { text: c.transition ? 'Remove transition' : 'Add transition', icon: Blend, onClick: () => c.transition ? updateClip(c.id, x => { x.transition = null; }, { label: 'Remove transition' }) : applyTransition('dissolve', c.id) },
    { text: c.locked ? 'Unlock clip' : 'Lock clip', icon: c.locked ? LockOpen : Lock, onClick: () => updateClip(c.id, x => { x.locked = !x.locked; }, { label: c.locked ? 'Unlock clip' : 'Lock clip' }) },
    { divider: true },
    { text: n > 1 ? `Delete ${n} clips` : 'Delete', icon: Trash2, sc: 'Del', danger: true, onClick: () => deleteClips(undefined, { ripple: ui.value.ripple && !t.main }) },
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
    <button class={`icon-btn ${p.settings.snapping ? 'on' : ''}`} aria-pressed={!!p.settings.snapping} data-tip="Snapping (hold Alt while dragging to bypass)" data-kbd="N" onClick={() => commit('Toggle snapping', d => { d.settings.snapping = !d.settings.snapping; })}><Magnet size={16} /></button>
    <button class={`btn ghost sm ${p.settings.magnetic ? 'on-text' : ''}`} data-tip="Magnetic main track keeps clips together" onClick={() => commit('Toggle magnetic track', d => { d.settings.magnetic = !d.settings.magnetic; })}>Magnetic {p.settings.magnetic ? 'on' : 'off'}</button>
    <button class={`icon-btn ${ui.value.ripple ? 'on' : ''}`} aria-pressed={ui.value.ripple} data-tip={`Ripple edits ${ui.value.ripple ? 'on' : 'off'} — trimming and deleting closes or opens space on other tracks too`} onClick={() => setUi({ ripple: !ui.value.ripple })}><ArrowLeftRight size={16} /></button>
    <button class={`icon-btn ${ui.value.linked ? 'on' : ''}`} aria-pressed={ui.value.linked} data-tip={`Linked audio/video ${ui.value.linked ? 'on' : 'off'} — separated audio moves and trims with its video`} onClick={() => setUi({ linked: !ui.value.linked })}><Link2 size={16} /></button>
    <span class="sep" />
    <button class="icon-btn" data-tip="Zoom out" data-kbd="−" onClick={() => zoomAround(1 / 1.4)}><ZoomOut size={16} /></button>
    <input type="range" class="zoom-range" min={Math.log(4)} max={Math.log(800)} step={0.01} value={Math.log(z)} style={{ '--fill': ((Math.log(z) - Math.log(4)) / (Math.log(800) - Math.log(4)) * 100) + '%' }} onInput={e => zoomAround(Math.exp(+e.target.value) / zoom.value)} aria-label="Timeline zoom" />
    <button class="icon-btn" data-tip="Zoom in" data-kbd="=" onClick={() => zoomAround(1.4)}><ZoomIn size={16} /></button>
    <button class="icon-btn" data-tip="Fit to window" data-kbd="F" onClick={fitTimeline}><Maximize size={15} /></button>
  </div>;
}
