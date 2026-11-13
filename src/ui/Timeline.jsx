// Multitrack timeline: tracks, clips (filmstrips, waveforms), playhead, snapping, trimming, dragging and drops.
import { LiveTakeRow } from './LiveTake.jsx';
import { Component } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { signal, computed, effect } from '@preact/signals';
import { Slice, FoldHorizontal, GalleryHorizontalEnd, ChevronDown, CopyPlus, Link2Off, X } from 'lucide-preact';
import { Scissors, Trash2, Copy, Undo2, Redo2, Magnet, ZoomIn, ZoomOut, Maximize, Eye, EyeOff, Lock, LockOpen, Volume2, VolumeX, Plus, Film, Music, Type, Layers, Unlink, Link2, Pencil, ArrowLeftRight, ArrowLeftToLine, ArrowRightToLine, Diamond, Gauge, Blend, Captions, Sparkles, Mic } from 'lucide-preact';
import { project, selection, time, zoom, media, asset, player, history, undo, redo, commit, toast, drag, playing, duration, transitionSel, rememberMedia, trackImport, tentativeIds, refreshMedia, effectPick } from '../lib/state.js';
import { closeAllGaps, bladeCut } from '../lib/edit.js';
import { splitAt, trimClips, trimLimits, setTrack, removeTrack, addTrack, closeGap, trackGaps, detachAudio, addAssets, addText, addSticker, applyEffect, applyFilter, applyTransition, selectTransition, removeTransition, trackOf, overlaps, freeTrack, updateClip, partnerOf, unlinkClip, insertTrack, pruneTracks, moveTrack, appendToText } from '../lib/edit.js';
import { beginDrag } from '../lib/drag.js';
import { timelineTargets, snapEdges, toFrame } from '../../shared/snap.mjs';
import { keySel, keyDrag, keyTimes, isKeySelected, toggleKey, clearKeys, moveKeys, deleteKeys, setKeyEasing, copyKeys, pasteKeys } from '../lib/keyedit.js';
import { EASINGS } from '../../shared/keys.mjs';
import { ui, setUi } from '../lib/uiprefs.js';
import { timecode } from '../lib/format.js';
import { clipEnd, trackKindFor, mainTrack, transitionPartner, maxTransition, newClip, uid, clampTrackIndex } from '../../shared/model.mjs';
import { transitionDef, effectDef, filterDef, transitionWindow } from '../../shared/catalog.mjs';
import { openMenu, prompt } from './kit.jsx';
import { importFiles, api, waitJob } from '../lib/api.js';
import { fitTimeline, zoomAround, run } from './commands.jsx';
import { addTextTemplate } from './AssetPanel.jsx';
import { openStudio } from './Studio.jsx';
import { TEXT_TEMPLATES } from '../../shared/templates.mjs';
import { shortTime } from '../lib/format.js';
import { keyGain } from '../../shared/audio.mjs';
import { timelinePreviewClip, filmstripTiles } from '../../shared/timeline-preview.mjs';

const HEADER_W = 168, RULER_H = 26;
const H = { video: 58, main: 66, audio: 52, text: 32, effect: 30 };
const trackH = t => (t.main ? H.main : H[t.kind] || 40);
// A clip whose own sound plays: audio clips, and videos with an audio stream that wasn't separated off.
const hasSound = c => c.kind === 'audio' || (c.kind === 'video' && !!asset(c.mediaId)?.audio && !c.detachedAudio);
// Video tracks only get mute controls while something on them makes sound (audio tracks always do).
const trackHasSound = (p, t) => t.kind === 'audio' || (t.kind === 'video' && p.clips.some(c => c.trackId === t.id && hasSound(c)));
const KIND_ICON = { video: Film, audio: Music, text: Type, effect: Layers };
const scroll = signal({ left: 0, width: 1000, top: 0 });
// What is drawn inside clips (filmstrip tiles, waveforms) and on the ruler follows the scroll position in
// steps, so scrolling redraws them when the view crosses a step instead of on every scroll event.
const VIEW_STEP = 256;
const viewLeft = computed(() => Math.floor(scroll.value.left / VIEW_STEP) * VIEW_STEP);
const viewSpan = computed(() => Math.ceil(scroll.value.width / VIEW_STEP) * VIEW_STEP + VIEW_STEP); // always covers the real view
const viewWidth = computed(() => scroll.value.width);
// Rows and clips only render again when what they are given changes (or a signal they read does), not
// every time the timeline around them does.
const memo = Inner => class extends Component {
  shouldComponentUpdate(next) { const prev = this.props; for (const k in next) if (next[k] !== prev[k]) return true; for (const k in prev) if (!(k in next)) return true; return false; }
  render(props) { return <Inner {...props} />; }
};
const snapLine = signal(null); // { t, kind } while an edge is snapped
const bladeLine = signal(null); // timeline time under the pointer while the blade tool is on
const readout = signal(null); // { t, text } floating timecode/duration readout while scrubbing, moving or trimming
const marquee = signal(null);
const dropHint = signal(null);
const SNAP_NAMES = { edge: 'Cut', start: 'Start', end: 'End', marker: 'Marker', playhead: 'Playhead' };
const insertLine = signal(null); // { y } where a new track will open (clip drag) or a dragged track will land
const trDrag = signal(null); // { id, d } while a transition's length is being dragged on the timeline

export function Timeline() {
  const p = project.value, z = zoom.value;
  const sc = useRef();
  const total = Math.max(duration.value + 30, (viewWidth.value / z) * 1.2);
  const width = total * z;
  useEffect(() => {
    const el = sc.current; const update = () => (scroll.value = { left: el.scrollLeft, width: el.clientWidth, top: el.scrollTop });
    const ro = new ResizeObserver(update); ro.observe(el); el.addEventListener('scroll', update, { passive: true }); update();
    return () => { ro.disconnect(); el.removeEventListener('scroll', update); };
  }, []);
  // Keep the playhead visible while playing (checked each time it has travelled 200 px). The timeline itself
  // does not follow the clock: only the playhead does, so playback never re-renders the tracks and clips.
  useEffect(() => {
    const travelled = computed(() => Math.floor(time.value * zoom.value / 200));
    return effect(() => {
      travelled.value; if (!playing.value) return; const el = sc.current; if (!el) return; const x = time.peek() * zoom.peek();
      if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
    });
  }, []);
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
        if (!moved) { if (!(ev.ctrlKey || ev.shiftKey)) { selection.value = []; transitionSel.value = null; clearKeys(); } player.current?.seek(Math.min(duration.value, toFrame(timeAt(ev.clientX), p.settings.fps))); return; }
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
  return <div class={`timeline ${ui.value.blade ? 'blade-on' : ''}`}>
    <Toolbar />
    <div class="tl-scroll" ref={sc} onWheel={onWheel} onPointerDown={onBgDown} {...dropProps}>
      <div class="tl-inner" style={{ width: width + HEADER_W }}>
        <div class="ruler-row"><div class="corner"><button class="btn ghost sm" onClick={e => openMenu(e, [{ label: 'Add track' }, ...['video', 'audio', 'text', 'effect'].map(k => ({ text: { video: 'Video overlay track', audio: 'Audio track', text: 'Text track', effect: 'Effect track' }[k], icon: KIND_ICON[k], onClick: () => commit('Add track', d => { addTrack(d, k); }) }))], { align: 'below' })}><Plus size={13} />Track</button></div><Ruler width={width} z={z} onPointerDown={scrub} /></div>
        {p.tracks.map(t => <TrackRow key={t.id} t={t} z={z} width={width} />)}
        <LiveTakeRow z={z} width={width} />
        <div class="tl-tail" style={{ width: width + HEADER_W }} />
        <Overlays z={z} width={width} fps={fpsOf(p)} />
        <Playhead z={z} onPointerDown={scrub} />
      </div>
      {!p.clips.length && <div class="tl-empty"><Film size={20} /><div><b>Drag media here to start</b><span>Or double-click a file in the Media panel.</span></div></div>}
    </div>
  </div>;
}

// Guides drawn over the tracks while something is being dragged, snapped, cut or dropped.
function Overlays({ z, width, fps }) {
  const sn = snapLine.value, blade = ui.value.blade ? bladeLine.value : null, ro = readout.value, hint = dropHint.value, ins = insertLine.value, mq = marquee.value;
  const top = sn || ro ? scroll.value.top : 0;
  return <>
    {sn && <div class={`snap-line k-${sn.kind} ${sn.near ? 'near' : ''}`} style={{ left: HEADER_W + sn.t * z }} />}
    {sn && !sn.near && <div class={`snap-tag k-${sn.kind}`} style={{ left: HEADER_W + sn.t * z, top: top + 3 }}>{SNAP_NAMES[sn.kind] || 'Snap'}</div>}
    {blade !== null && <div class="blade-line" style={{ left: HEADER_W + blade * z }}><span class="mono">{timecode(blade, fps)}{sn && Math.abs(sn.t - blade) < 1e-6 ? ' · ' + ({ edge: 'clip edge', marker: 'marker', playhead: 'playhead', end: 'project end', start: 'start' }[sn.kind] || 'snap') : ''}</span></div>}
    {ro && <div class="tl-readout mono" style={{ left: HEADER_W + ro.t * z, top: top + RULER_H + 4 }}>{ro.text}</div>}
    {hint && <div class="drop-hint" style={{ left: HEADER_W + hint.x, top: hint.y, width: hint.w, height: hint.h }} />}
    {ins && <div class="track-insert" style={{ top: ins.y, width: width + HEADER_W }} />}
    {mq && <div class="marquee" style={{ left: HEADER_W + mq.x, top: mq.y, width: mq.w, height: mq.h }} />}
  </>;
}
// The only part of the timeline that follows the clock.
function Playhead({ z, onPointerDown }) {
  const ph = time.value * z;
  return <div class="playhead" style={{ transform: `translateX(${HEADER_W + ph}px)`, visibility: ph < scroll.value.left - 1 ? 'hidden' : undefined }}><div class="ph-head" onPointerDown={onPointerDown} /></div>;
}

function Ruler({ width, z, onPointerDown }) {
  const left = viewLeft.value, vw = viewSpan.value;
  const steps = [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const major = steps.find(s => s * z >= 90) || 600; const minor = steps.filter(s => s < major).reverse().find(s => major / s >= 4 && s * z >= 10) || major / 2;
  const t0 = Math.max(0, Math.floor((left - HEADER_W) / z / major) * major), t1 = (left + vw) / z + major;
  const ticks = [];
  for (let t = t0; t <= t1; t += minor) { const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6; ticks.push(<div key={t.toFixed(3)} class={`tick ${isMajor ? 'major' : ''}`} style={{ left: t * z }}>{isMajor && <span>{fmtRuler(t, major)}</span>}</div>); }
  return <div class="ruler" style={{ width }} onPointerDown={onPointerDown}>{ticks}{project.value.markers.map((m, i) => <div key={i} class="marker" style={{ left: m.t * z }} data-tip={(m.label || 'Marker') + ' · right-click to rename or delete'} onPointerDown={e => e.button === 2 && e.stopPropagation()} onContextMenu={e => markerMenu(e, i)} />)}</div>;
}
// Project markers: right-click on the ruler to jump to, rename or delete one.
function markerMenu(e, i) {
  e.preventDefault(); e.stopPropagation();
  const m = project.value.markers[i]; if (!m) return;
  openMenu(e, [
    { label: (m.label || 'Marker') + ' · ' + timecode(m.t, fpsOf(project.value)) },
    { text: 'Go to marker', onClick: () => player.current?.seek(m.t) },
    { text: 'Rename…', icon: Pencil, onClick: async () => { const v = await prompt({ title: 'Rename marker', label: 'Marker name', value: m.label || '' }); if (v !== null && v !== undefined) commit('Rename marker', d => { if (d.markers[i]) d.markers[i].label = v.trim(); }); } },
    { divider: true },
    { text: 'Delete marker', icon: Trash2, danger: true, onClick: () => commit('Delete marker', d => { d.markers.splice(i, 1); }) },
  ]);
}
const fmtRuler = (t, step) => { const m = Math.floor(t / 60), s = t % 60; if (step < 1) return `${m}:${s.toFixed(step < 0.1 ? 2 : 1).padStart(step < 0.1 ? 5 : 4, '0')}`; return `${m}:${String(Math.round(s)).padStart(2, '0')}`; };

const TrackRow = memo(function TrackRow({ t, z, width }) {
  const p = project.value; const clips = p.clips.filter(c => c.trackId === t.id);
  // A drag or a snap is handed only to the clips it concerns, so the others are left alone while it moves.
  const d = drag.value, sn = snapLine.value, snapId = sn && !sn.near ? sn.clipId : null;
  const Icon = t.captions ? Captions : KIND_ICON[t.kind];
  const menu = e => openMenu(e, [
    { text: 'Rename…', icon: Pencil, onClick: async () => { const n = await prompt({ title: 'Rename track', label: 'Track name', value: t.name }); if (n?.trim()) setTrack(t.id, { name: n.trim() }, 'Rename track'); } },
    t.kind !== 'audio' && { text: t.hidden ? 'Show track' : 'Hide track', icon: t.hidden ? Eye : EyeOff, onClick: () => setTrack(t.id, { hidden: !t.hidden }, 'Toggle visibility') },
    (trackHasSound(p, t) || t.muted) && { text: t.muted ? 'Unmute track' : 'Mute track', icon: t.muted ? Volume2 : VolumeX, onClick: () => setTrack(t.id, { muted: !t.muted }, 'Toggle mute') },
    { text: t.locked ? 'Unlock track' : 'Lock track', icon: t.locked ? LockOpen : Lock, onClick: () => setTrack(t.id, { locked: !t.locked }, 'Toggle lock') },
    !t.locked && !t.captions && !(t.main && p.settings.magnetic) && { text: 'Close gaps on this track', icon: FoldHorizontal, onClick: () => closeAllGaps({ trackIds: [t.id] }) },
    { text: 'Select all on track', onClick: () => (selection.value = clips.map(c => c.id)) },
    t.kind === 'audio' && { text: t.voice ? 'Unmark as voice track' : 'Mark as voice track (for ducking)', icon: Mic, onClick: () => setTrack(t.id, { voice: !t.voice }, 'Voice track') },
    { divider: true },
    !t.main && { text: 'Delete track', icon: Trash2, danger: true, onClick: () => removeTrack(t.id) },
  ]);
  return <div class={`track-row k-${t.kind} ${t.main ? 'main' : ''} ${t.hidden ? 'is-hidden' : ''} ${t.locked ? 'is-locked' : ''}`} style={{ height: trackH(t), width: width + HEADER_W }} data-track={t.id}>
    <div class={`track-head ${t.main ? 'fixed' : ''}`} onContextMenu={menu} onPointerDown={e => headDown(e, t)} data-tip={t.main ? 'Main track — the base picture layer. Overlays and text sit above it, audio below.' : t.kind === 'audio' ? 'Drag to reorder audio tracks' : 'Drag to reorder — higher tracks are drawn on top'}>
      <span class={`th-icon k-${t.kind}`}><Icon size={13} /></span>
      <span class="th-name ellipsis" title={t.name}>{t.main ? 'Main' : t.name}</span>
      <div class="th-btns">
        {t.kind !== 'audio' && <button class={`icon-btn sm ${t.hidden ? 'on' : ''}`} data-tip={t.hidden ? 'Show track' : 'Hide track'} aria-label={t.hidden ? 'Show track' : 'Hide track'} aria-pressed={!!t.hidden} onClick={() => setTrack(t.id, { hidden: !t.hidden }, 'Toggle visibility')}>{t.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>}
        {(trackHasSound(p, t) || t.muted) && <button class={`icon-btn sm ${t.muted ? 'on' : ''}`} data-tip={t.muted ? 'Unmute track' : 'Mute track'} aria-label={t.muted ? 'Unmute track' : 'Mute track'} aria-pressed={!!t.muted} onClick={() => setTrack(t.id, { muted: !t.muted }, 'Toggle mute')}>{t.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>}
        <button class={`icon-btn sm ${t.locked ? 'on' : ''}`} data-tip={t.locked ? 'Unlock track' : 'Lock track'} aria-label={t.locked ? 'Unlock track' : 'Lock track'} aria-pressed={!!t.locked} onClick={() => setTrack(t.id, { locked: !t.locked }, 'Toggle lock')}>{t.locked ? <Lock size={13} /> : <LockOpen size={13} />}</button>
      </div>
    </div>
    <div class="track-lane" style={{ width }}>{clips.map(c => <Clip key={c.id} c={c} t={t} z={z} d={d && d.ids.includes(c.id) ? d : null} snapT={snapId === c.id ? sn.t : null} />)}<Gaps t={t} z={z} /></div>
  </div>;
});

// Empty space between clips: shown subtly so accidental gaps are easy to spot; right-click or double-click closes one.
function Gaps({ t, z }) {
  const p = project.value; if (t.hidden || t.locked || t.captions || (t.main && p.settings.magnetic)) return null;
  const min = 1 / fpsOf(p) - 1e-6;
  return trackGaps(p, t.id, min).filter(g => (g.end - g.start) * z >= 3 && (g.start > 0 || t.main)).map(g => <div key={g.start} class="gap" style={{ left: g.start * z, width: (g.end - g.start) * z }}
    data-tip={`Gap · ${durText(g.end - g.start, fpsOf(p))} — double-click to close`} onDblClick={e => { e.stopPropagation(); closeGap(t.id, (g.start + g.end) / 2); }}
    onContextMenu={e => openMenu(e, [{ text: 'Close gap', onClick: () => closeGap(t.id, (g.start + g.end) / 2) }, { text: 'Close all gaps on this track', onClick: () => closeAllGaps({ trackIds: [t.id] }) }])} />);
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
    // Envelope drags commit as they go (one coalesced undo entry). Escape / Ctrl+Z mid-drag cancels the
    // drag, so roll that entry back like every other timeline drag does.
    let saved = false;
    beginDrag(e, { threshold: 2, cancel: () => { if (saved) undo(); }, move: ev => { const p = vAt(ev); saved = true; save(x => { x.volumeKeys[i] = { t: Math.min(hi, Math.max(lo, p.t)), v: ev.shiftKey ? keys[i].v : Math.round(p.v * 1000) / 1000 }; }, 'Move volume point', 'env:' + c.id + i); el.dataset.tip = db(p.v); } });
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
const Clip = memo(function Clip({ c, t, z, d, snapT }) {
  const sel = selection.value.includes(c.id);
  const visual = timelinePreviewClip(c, d, !!t.main);
  let start = c.start, dur = c.duration, shiftY = 0;
  if (d) {
    if (d.mode === 'move') { start = Math.max(0, c.start + d.dt); shiftY = d.dyId === c.id ? d.dy || 0 : 0; }
    // A ripple start-trim keeps the clip in place (later clips close up on release).
    if (d.mode === 'trim' && d.edge === 'start') { start = d.ripple && !t.main ? c.start : c.start + d.dt; dur = c.duration - d.dt; }
    if (d.mode === 'trim' && d.edge === 'end') dur = c.duration + d.dt;
  }
  const a = c.mediaId ? asset(c.mediaId) : null;
  const left = start * z, w = Math.max(2, dur * z);
  const p = project.value;
  const partner = c.kind !== 'audio' && c.kind !== 'adjust' && transitionPartner(p, c);
  // The edge another clip is snapping to glows, so you can see exactly which cut it lines up with.
  const snapSide = snapT !== null ? (Math.abs(snapT - c.start) < 1e-6 ? 'snap-l' : Math.abs(snapT - clipEnd(c)) < 1e-6 ? 'snap-r' : '') : '';
  const label = c.kind === 'text' ? c.text : c.kind === 'sticker' ? (c.sticker?.type === 'emoji' ? c.sticker.value : c.name || 'Sticker') : c.kind === 'adjust' ? [c.filter?.id && filterDef(c.filter.id)?.name, ...(c.effects || []).map(e => effectDef(e.id)?.name)].filter(Boolean).join(' + ') || c.name : c.name || a?.name || 'Clip';
  return <div class={`clip k-${c.kind} ${tentativeIds.value.includes(c.id) ? 'tentative' : ''} ${c.caption ? 'caption' : ''} ${sel ? 'sel' : ''} ${a?.missing ? 'missing' : ''} ${c.muted ? 'muted' : ''} ${d ? 'dragging' : ''} ${d?.copy ? 'copying' : ''} ${c.locked ? 'locked' : ''} ${snapSide}`}
    style={{ transform: `translate(${left}px, ${shiftY}px)`, width: w }} data-clip={c.id}
    onPointerDown={e => clipDown(e, c, t, z)} onPointerMove={e => { if (ui.value.blade) bladeLine.value = bladeTimeAt(e, z); }} onPointerLeave={() => { if (ui.value.blade) { bladeLine.value = null; snapLine.value = null; bladePrev = null; } }} onContextMenu={e => clipMenu(e, c, t, bladeTimeAt(e, z))} onDblClick={() => { if (c.kind === 'text') setTimeout(() => document.querySelector('.insp-text textarea')?.focus(), 30); }}>
    {(c.kind === 'video' || c.kind === 'image') && a && <Filmstrip c={visual} a={a} start={start} w={w} z={z} h={trackH(t) - 6 - 17} />}
    {(c.kind === 'audio' || (c.kind === 'video' && t.main)) && a?.audio && !c.muted && <Wave c={visual} a={a} start={start} w={w} z={z} tall={c.kind === 'audio'} h={trackH(t)} />}
    {hasSound(c) && !c.muted && (sel || c.volumeKeys?.length > 0) && <Envelope c={visual} w={w} z={z} sel={sel} />}
    <div class="clip-label">
      {c.speed && c.speed !== 1 && <span class="badge"><Gauge size={10} />{+c.speed.toFixed(2)}×</span>}
      {c.locked && <Lock size={10} />}
      {c.muted && <VolumeX size={11} />}
      {ui.value.linked && (c.detachedAudio || c.kind === 'audio') && partnerOf(p, c) && <span data-tip={c.kind === 'audio' ? 'Linked to its video — moves, trims, splits with it' : 'Sound separated — linked audio moves, trims and splits with this clip'}><Link2 size={10} /></span>}
      {c.filter?.id && c.kind !== 'adjust' && <span class="badge">{filterDef(c.filter.id)?.name || 'LUT'}</span>}
      {c.effects?.length > 0 && c.kind !== 'adjust' && <Sparkles size={10} />}
      {c.takes?.length > 1 && <span class="badge" data-tip="Recording takes">{(c.takes.findIndex(k => k.mediaId === c.mediaId) + 1) || 1}/{c.takes.length} takes</span>}
      <span class="ellipsis">{label}</span>
      {w > 90 && c.kind !== 'text' && <span class="dur">{shortTime(dur)}</span>}
    </div>
    {c.keyframes && keyTimes(c).map(k => { const on = isKeySelected(c.id, k), kd = keyDrag.value; const kt = on && kd ? Math.min(c.duration, Math.max(0, k + kd.dt)) : k; return <span key={'k' + k} class={`clip-key ${on ? 'sel' : ''}`} style={{ left: kt * z }} data-tip="Keyframe · click to jump, Shift+click to multi-select, drag to move" onPointerDown={e => keyDown(e, c, k, z)} onContextMenu={e => { e.stopPropagation(); keyMenu(e, c, k); }} />; })}
    {c.markers?.map((m, i) => <span key={i} class="clip-marker" style={{ left: ((m.t - (visual.in || 0)) / (c.speed || 1)) * z }} data-tip={m.label || 'Mistake marker'} />)}
    {partner && !c.transition && <button class="tr-mark" style={{ left: -9 }} data-tip="Add a transition" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); applyTransition('dissolve', c.id); }}><Blend size={10} /></button>}
    {partner && c.transition && <TransitionBlock c={c} start={start} z={z} p={p} />}
    {!trackOf(p, c.trackId)?.locked && !c.locked && <><span class="edge l" onPointerDown={e => edgeDown(e, c, 'start', z)} /><span class="edge r" onPointerDown={e => edgeDown(e, c, 'end', z)} /></>}
  </div>;
});

// A transition on the timeline: a block over the cut, as long as the transition, placed where it plays
// (before, on or after the cut). One click selects it (its settings open on the right), a second click, Esc,
// the panel's Done button or a click on empty timeline deselects it. Drag either end to change its length.
// Delete, the × on the selected block or the right-click menu removes it.
function TransitionBlock({ c, start, z, p }) {
  const def = transitionDef(c.transition.id), max = Math.max(0.1, maxTransition(p, c));
  const live = trDrag.value?.id === c.id ? trDrag.value.d : null;
  const d = Math.min(live ?? (c.transition.duration || 0.6), max);
  const [T0, T1] = transitionWindow(c, d); const w = Math.max(24, (T1 - T0) * z); const on = transitionSel.value === c.id;
  const locked = c.locked || trackOf(p, c.trackId)?.locked;
  const toggle = () => { if (on) transitionSel.value = null; else selectTransition(c.id); };
  const resize = (e, side) => {
    if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
    if (!on) selectTransition(c.id);
    // Centred transitions grow on both sides of the cut, so the edge under the pointer moves half as fast.
    const d0 = d, x0 = e.clientX, fps = fpsOf(p), k = (c.transition.align || 'center') === 'center' ? 2 : 1;
    beginDrag(e, {
      threshold: 2, cursor: 'ew-resize',
      move: ev => {
        const dx = (ev.clientX - x0) / z * (side === 'l' ? -1 : 1);
        const nd = Math.min(max, Math.max(0.1, Math.round((d0 + dx * k) * fps) / fps));
        trDrag.value = { id: c.id, d: nd }; readout.value = { t: c.start, text: `Transition ${nd.toFixed(2)} s${nd >= max - 1e-6 ? ' · longest these clips allow' : ''}` };
      },
      cancel: () => { trDrag.value = null; readout.value = null; },
      end: () => {
        const v = trDrag.value; trDrag.value = null; readout.value = null;
        if (v && Math.abs(v.d - d0) > 1e-4) updateClip(c.id, x => { if (!x.transition) return false; x.transition.duration = v.d; }, { label: 'Transition length' });
      },
    });
  };
  const menu = e => { e.preventDefault(); e.stopPropagation(); if (!on) selectTransition(c.id); openMenu(e, [{ label: `${def?.name || 'Transition'} · ${d.toFixed(2).replace(/0$/, '')} s` }, { text: 'Edit transition', icon: Blend, onClick: () => selectTransition(c.id) }, { text: 'Deselect', sc: 'Esc', onClick: () => { transitionSel.value = null; } }, { divider: true }, { text: 'Remove transition', icon: Trash2, sc: 'Delete', danger: true, onClick: () => removeTransition(c.id) }]); };
  return <div class={`tr-block ${on ? 'sel' : ''} ${live !== null ? 'resizing' : ''}`} style={{ left: (T0 - c.start) * z - (w - (T1 - T0) * z) / 2, width: w }} role="button" tabIndex={0} aria-pressed={on}
    aria-label={`${def?.name || 'Transition'}, ${d.toFixed(2)} seconds${on ? ', selected' : ''}`}
    data-tip={on ? `${def?.name || 'Transition'} · ${d.toFixed(2).replace(/0$/, '')} s · click again or Esc to deselect · Delete removes it` : `${def?.name || 'Transition'} · ${d.toFixed(2).replace(/0$/, '')} s · click to edit · drag an end to resize`}
    onPointerDown={e => e.stopPropagation()} onDblClick={e => e.stopPropagation()}
    onClick={e => { e.stopPropagation(); toggle(); }}
    onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); } }}
    onContextMenu={menu}>
    {!locked && <span class="tr-grip l" onPointerDown={e => resize(e, 'l')} onClick={e => e.stopPropagation()} />}
    <Blend size={11} />{w > 84 && <span class="ellipsis">{def?.name}</span>}
    {on && !locked && <span class="tr-x" role="button" aria-label="Remove transition" data-tip="Remove transition" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); removeTransition(c.id); }}><X size={10} /></span>}
    {!locked && <span class="tr-grip r" onPointerDown={e => resize(e, 'r')} onClick={e => e.stopPropagation()} />}
  </div>;
}

// Filmstrip: only the tiles inside the visible window are drawn.
function Filmstrip({ c, a, start, w, z, h }) {
  const stripRef = useRef(), [actualHeight, setActualHeight] = useState(h);
  useLayoutEffect(() => {
    const el = stripRef.current; if (!el) return;
    const measure = () => { const height = el.getBoundingClientRect().height; if (height > 0) setActualHeight(height); };
    const observer = new ResizeObserver(measure); observer.observe(el); measure();
    return () => observer.disconnect();
  }, [h]);
  const left = viewLeft.value, width = viewSpan.value; const x0 = Math.max(0, left - start * z), x1 = Math.min(w, left + width - HEADER_W - start * z);
  const visible = x1 > x0;
  useEffect(() => {
    if (a.kind !== 'video' || a.strip?.version === 2 || !visible) return;
    api(`/api/media/${a.id}/filmstrip`, {}).then(async r => { if (r.job) await waitJob(r.job); await refreshMedia(); }).catch(() => {});
  }, [a.id, a.strip?.version, visible]);
  if (a.kind === 'image') return <div ref={stripRef} class="strip" style={{ backgroundImage: a.thumb ? `url(${a.thumb})` : (a.svg ? `url(${a.url})` : 'none'), backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />;
  const s = a.strip; if (!s) return <div ref={stripRef} class="strip loading" />;
  const tiles = filmstripTiles(c, s, { zoom: z, height: actualHeight, from: x0, to: x1 }).map(tile => <i key={tile.id} data-source-time={tile.sourceTime} data-frame-index={tile.index} style={{ left: tile.left, width: tile.width, backgroundImage: `url(${s.url})`, backgroundSize: `${s.count * tile.width}px 100%`, backgroundPosition: `${-tile.index * tile.width}px 0` }} />);
  return <div ref={stripRef} class="strip">{tiles}</div>;
}
const peakCache = new Map();
function usePeaks(url) {
  const [result, setResult] = useState(() => ({ url, peaks: peakCache.get(url) || null }));
  useEffect(() => {
    let current = true;
    if (!url || peakCache.has(url)) { setResult({ url, peaks: peakCache.get(url) || null }); return; }
    fetch(url).then(r => { if (!r.ok) throw Error('Waveform unavailable'); return r.arrayBuffer(); }).then(b => {
      const peaks = new Uint8Array(b); peakCache.set(url, peaks);
      if (peakCache.size > 128) peakCache.delete(peakCache.keys().next().value);
      if (current) setResult({ url, peaks });
    }).catch(() => {});
    return () => { current = false; };
  }, [url]);
  return result.url === url ? result.peaks : peakCache.get(url) || null;
}
function Wave({ c, a, start, w, z, tall, h }) {
  const peaks = usePeaks(a.wave); const ref = useRef();
  const left = viewLeft.value, width = viewSpan.value; const x0 = Math.max(0, Math.floor(left - start * z)), x1 = Math.min(w, Math.ceil(left + width - HEADER_W - start * z)); const vw = Math.max(0, x1 - x0);
  useLayoutEffect(() => {
    const cv = ref.current; if (!cv) return;
    if (!peaks || !vw) { cv.width = 0; return; }
    const dpr = window.devicePixelRatio || 1;
    // The canvas's own CSS box (below the label for audio clips), so the drawing never spills outside the clip.
    const hh = cv.clientHeight; if (!hh) return; cv.width = Math.ceil(vw * dpr); cv.height = Math.ceil(hh * dpr); const g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = tall ? 'rgba(180,255,220,.75)' : 'rgba(200,220,255,.45)'; const mid = tall ? hh / 2 : hh - 2;
    for (let x = 0; x < vw; x++) {
      const tl = (x0 + x) / z, src0 = c.in + tl * (c.speed || 1), src1 = c.in + (tl + 1 / z) * (c.speed || 1);
      let m = 0; for (let i = Math.max(0, Math.floor(src0 * 100)); i < Math.ceil(src1 * 100) && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const gain = Math.min(2, (c.volume ?? 1) * keyGain(c.volumeKeys, tl) * keyGain(c.duckKeys, tl));
      const v = Math.min(1, m / 255 * gain) * (tall ? hh * 0.46 : hh * 0.5);
      if (tall) g.fillRect(x, mid - v, 1, Math.max(1, v * 2)); else g.fillRect(x, mid - v, 1, v);
    }
    // Automatic ducking as a dashed line on the same scale as the volume envelope (whose own line is drawn by <Envelope>).
    if (c.duckKeys?.length) { g.strokeStyle = 'rgba(255,211,106,.7)'; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); for (let x = 0; x < vw; x += 2) { const tl = (x0 + x) / z; const v = keyGain(c.volumeKeys, tl) * keyGain(c.duckKeys, tl); const y = 1 + (1 - Math.min(ENV_MAX, v) / ENV_MAX) * (hh - 2); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  }, [peaks, x0, vw, z, h, c.in, c.speed, c.volume, c.volumeKeys, c.duckKeys]);
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
  const targets = timelineTargets(p, { exclude, playhead: time.value }), th = ui.value.snapPx / z;
  const hit = snapEdges(candidates, targets, th, prev);
  if (hit) snapLine.value = { t: hit.target.t, kind: hit.target.kind, clipId: hit.target.clipId };
  else {
    // Not snapped yet but close: a faint guide shows which cut is about to catch the edge.
    let near = null;
    for (const c of candidates) for (const x of targets) { const d = Math.abs(x.t - c); if (d <= th * 3 && (!near || d < near.d)) near = { d, x }; }
    snapLine.value = near ? { t: near.x.t, kind: near.x.kind, clipId: near.x.clipId, near: true } : null;
  }
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
const endDragUi = () => { drag.value = null; snapLine.value = null; readout.value = null; insertLine.value = null; };

// Track rows on screen, top to bottom, with their index in p.tracks.
const trackRows = (sc, p) => [...sc.querySelectorAll('.track-row[data-track]')].map(el => ({ id: el.dataset.track, el, rect: el.getBoundingClientRect(), index: p.tracks.findIndex(t => t.id === el.dataset.track) })).filter(r => r.index >= 0);
const boundaryIndex = (p, rows, i) => (i < rows.length ? rows[i].index : p.tracks.length);
// Screen y of the boundary before p.tracks[index] (the bottom of the last row past the end).
const boundaryY = (rows, index) => { const r = rows.find(x => x.index >= index); return r ? r.rect.top : rows.at(-1).rect.bottom; };
const yInContent = (sc, clientY) => clientY - sc.getBoundingClientRect().top + sc.scrollTop;

// Where a clip dragged up or down should go. Over a track that takes this kind of clip: that track. Over
// the seam between two tracks, over a track of another kind, or above/below every track: a new track of
// the right kind opens there (shown by the insert line). Caption clips stay on their caption track.
function verticalTarget(ev, p, c, t, el, ids) {
  if (c.caption) return null;
  const sc = el.closest('.tl-scroll'), sr = sc.getBoundingClientRect();
  if (ev.clientX < sr.left || ev.clientX > sr.right || ev.clientY < sr.top || ev.clientY > sr.bottom) return null;
  const rows = trackRows(sc, p), own = rows.find(r => r.id === t.id); if (!own) return null;
  const kind = trackKindFor(c.kind), y = ev.clientY, EDGE = 7;
  // Taking the only clip(s) off a track and opening a new track right beside it would change nothing.
  const alone = !t.main && p.clips.every(k => k.trackId !== t.id || ids.includes(k.id));
  // i: a boundary between on-screen rows. It is moved to the nearest place this kind of track may go
  // (picture above Main, sound below it), and the line is drawn where the track will really open.
  const insert = i => {
    const at = clampTrackIndex(p, kind, boundaryIndex(p, rows, i));
    if (alone && (at === own.index || at === own.index + 1)) return null;
    const by = boundaryY(rows, at);
    return { insertAt: at, dy: by - own.rect.top - own.rect.height / 2, lineY: yInContent(sc, by) };
  };
  if (y < rows[0].rect.top) return insert(0);
  if (y >= rows.at(-1).rect.bottom) return insert(rows.length);
  const i = rows.findIndex(r => y >= r.rect.top && y < r.rect.bottom); if (i < 0) return null;
  const r = rows[i], tr = trackOf(p, r.id);
  const nearEdge = y - r.rect.top < EDGE || r.rect.bottom - y <= EDGE;
  if (r.id === t.id) return null;
  if (tr && tr.kind === kind && !tr.locked && !tr.captions && !nearEdge) return { target: tr.id, dy: r.rect.top - own.rect.top };
  return insert(y < r.rect.top + r.rect.height / 2 ? i : i + 1);
}

// Drag a track's header up or down to restack it.
function headDown(e, t) {
  if (e.button !== 0 || e.target.closest('button') || t.main) return; // Main is the fixed base layer
  const sc = e.currentTarget.closest('.tl-scroll'), row = e.currentTarget.closest('.track-row');
  let at = null;
  const stop = () => { insertLine.value = null; row.classList.remove('reordering'); };
  beginDrag(e, {
    threshold: 4, cursor: 'grabbing',
    move: ev => {
      const p = project.value, rows = trackRows(sc, p), sr = sc.getBoundingClientRect();
      if (ev.clientY < sr.top + 34) sc.scrollTop -= 10; else if (ev.clientY > sr.bottom - 20) sc.scrollTop += 10;
      let i = rows.findIndex(r => ev.clientY < r.rect.top + r.rect.height / 2); if (i < 0) i = rows.length;
      const own = p.tracks.findIndex(x => x.id === t.id); row.classList.add('reordering');
      const want = clampTrackIndex(p, t.kind, boundaryIndex(p, rows, i));
      if (want === own || want === own + 1) { at = null; insertLine.value = null; return; }
      at = want; insertLine.value = { y: yInContent(sc, boundaryY(rows, want)) };
    },
    cancel: stop,
    end: () => { stop(); if (at !== null) commit('Reorder tracks', d => moveTrack(d, t.id, at)); },
  });
}

// Time under the pointer inside a clip lane, frame-exact. With snapping on (Alt bypasses) the blade pulls to
// anything worth cutting at: edges of clips on every other track (cut video to the end of the music, a
// voiceover to the end of a shot…), markers, mistake markers inside the clip and the playhead. A target
// only counts if it falls strictly inside the clip being cut, and an engaged target holds with hysteresis.
let bladePrev = null;
function bladeTimeAt(e, z) {
  const lane = e.currentTarget.closest('.track-lane'); if (!lane) return null;
  const p = project.value, fps = fpsOf(p); const raw = Math.max(0, (e.clientX - lane.getBoundingClientRect().left) / z);
  const id = e.currentTarget.closest('[data-clip]')?.dataset.clip, c = id && p.clips.find(x => x.id === id);
  if (p.settings.snapping && !e.altKey && c) {
    const lo = c.start + 0.5 / fps, hi = clipEnd(c) - 0.5 / fps;
    const targets = timelineTargets(p, { exclude: new Set([c.id]), playhead: time.value }).filter(x => x.t > lo && x.t < hi);
    for (const m of c.markers || []) { const t = c.start + (m.t - (c.in || 0)) / (c.speed || 1); if (t > lo && t < hi) targets.push({ t, kind: 'marker' }); }
    const hit = snapEdges([raw], targets, ui.value.snapPx / z, bladePrev);
    bladePrev = hit; snapLine.value = hit ? { t: hit.target.t, kind: hit.target.kind } : null;
    if (hit) return hit.target.t;
  } else { bladePrev = null; snapLine.value = null; }
  return Math.round(raw * fps) / fps;
}
function clipDown(e, c, t, z) {
  if (e.button === 0 && ui.value.blade) { e.stopPropagation(); e.preventDefault(); const at = bladeTimeAt(e, z); if (at !== null) bladeCut(at, e.shiftKey ? undefined : [c.id]); return; }
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
      // Up/down: onto another track, or into a new track between tracks (one clip at a time).
      const v = base.length === 1 ? verticalTarget(ev, p, c, t, el, ids) : null;
      insertLine.value = v?.lineY !== undefined ? { y: v.lineY } : null;
      drag.value = { mode: 'move', ids, dt, dy: v?.dy || 0, dyId: c.id, copy: toggle, target: v?.target || null, insertAt: v?.insertAt ?? null };
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
        const from = d.copy ? [] : work.map(id => pp.clips.find(k => k.id === id).trackId);
        if (d.insertAt !== null) d.target = insertTrack(pp, trackKindFor(c.kind), d.insertAt).id;
        const before = new Map(work.map(id => [id, pp.clips.find(k => k.id === id).start]));
        const main = mainTrack(pp);
        for (const id of work) {
          const x = pp.clips.find(k => k.id === id); const dest = id === lead && d.target ? d.target : x.trackId;
          const destTrack = trackOf(pp, dest); x.start = Math.max(0, x.start + d.dt);
          if (destTrack.kind !== trackKindFor(x.kind)) continue;
          // Magnetic main: a tiny lead orders the dropped clip before the one it lands on; packing removes it.
          // Without gapless packing that offset would stay (off-frame, overlapping), so it is not applied.
          if (destTrack.main) { x.trackId = dest; if (pp.settings.magnetic) x.start -= 1e-3; continue; }
          x.trackId = dest;
        }
        const keep = new Set(work);
        if (!pp.settings.magnetic) {
          const bad = work.some(id => { const x = pp.clips.find(k => k.id === id); return x.trackId === main.id && pp.clips.some(o => o.id !== x.id && o.trackId === main.id && o.start < clipEnd(x) - 1e-4 && clipEnd(o) > x.start + 1e-4); });
          if (bad) { toast('Clips on the main track can’t overlap. Drop it in a gap, or turn on Gapless main.', 'warn'); return false; }
        }
        // Every moved clip already has its final time, so each only ignores itself: two clips from the same drag
        // (or a copy and its original) can never end up on top of each other.
        for (const id of work) { const x = pp.clips.find(k => k.id === id); const tr = trackOf(pp, x.trackId); const self = new Set([x.id]); if (!tr.main && overlaps(pp, x.trackId, x.start, clipEnd(x), self)) x.trackId = freeTrack(pp, tr.kind, x.start, clipEnd(x), { ignore: self }).id; }
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
        // Tracks this move left empty close up (CapCut-style); main, caption and locked tracks stay.
        pruneTracks(pp, from);
      });
      // Only select the copies if the edit went through (a refused drop creates nothing).
      if (out) { const live = out.filter(id => project.value.clips.some(k => k.id === id)); if (live.length) selection.value = live; }
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
  const lim = new Map(clips.map(x => [x.id, trimLimits(x, undefined, { ripple: ui.value.ripple })]));
  const e0 = edge === 'start' ? c.start : clipEnd(c);
  const r0 = e.currentTarget.closest('.track-lane').getBoundingClientRect();
  // The playhead never moves while trimming: the edge timecode and length show in the readout instead.
  // Playback pauses for the drag and carries on afterwards.
  const wasPlaying = playing.value; let paused = false;
  const restore = () => { if (paused && wasPlaying) player.current?.play(); };
  let prev = null;
  beginDrag(e, {
    threshold: 2, cursor: 'ew-resize',
    move: ev => {
      if (!paused) { player.current?.pause(); paused = true; }
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
    },
    cancel: () => { endDragUi(); restore(); },
    end: () => {
      const d = drag.value; endDragUi();
      if (d?.dt) trimClips(clips.map(x => ({ id: x.id, edge, t: x.id === c.id && d.exact !== null ? d.exact : (edge === 'start' ? x.start : clipEnd(x)) + d.dt })), { ripple: ui.value.ripple, key: null });
      restore();
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
function clipMenu(e, c, t, at = null) {
  if (!selection.value.includes(c.id)) selection.value = [c.id];
  const n = selection.value.length, p = project.value, partner = partnerOf(p, c);
  openMenu(e, [
    at !== null && at > c.start + 0.03 && at < clipEnd(c) - 0.03 && { text: 'Split here', icon: Slice, onClick: () => bladeCut(at, [c.id]) },
    { text: 'Split at playhead', icon: Scissors, sc: 'Ctrl+B', disabled: !(time.value > c.start + 0.03 && time.value < clipEnd(c) - 0.03), onClick: () => run('split') },
    { text: 'Duplicate', icon: CopyPlus, sc: 'Ctrl+D', onClick: () => run('duplicate') },
    { text: 'Copy', icon: Copy, sc: 'Ctrl+C', onClick: () => run('copy') }, { text: 'Cut', sc: 'Ctrl+X', onClick: () => run('cut') }, { text: 'Paste at playhead', sc: 'Ctrl+V', onClick: () => run('paste') }, { text: 'Paste in place', sc: 'Ctrl+Shift+V', onClick: () => run('paste-in-place') },
    { divider: true },
    c.kind === 'video' && asset(c.mediaId)?.audio && !c.detachedAudio && { text: 'Separate audio', icon: Unlink, onClick: () => detachAudio(c.id) },
    partner && { text: 'Unlink audio and video', icon: Link2Off, onClick: () => unlinkClip(c.id) },
    hasSound(c) && { text: c.muted ? 'Unmute' : 'Mute', icon: c.muted ? Volume2 : VolumeX, sc: 'Ctrl+M', onClick: () => run('mute') },
    c.kind !== 'audio' && c.kind !== 'adjust' && transitionPartner(project.value, c) && c.transition && { text: 'Edit transition', icon: Blend, onClick: () => selectTransition(c.id) },
    c.kind !== 'audio' && c.kind !== 'adjust' && transitionPartner(project.value, c) && { text: c.transition ? 'Remove transition' : 'Add transition', icon: c.transition ? Trash2 : Blend, onClick: () => c.transition ? removeTransition(c.id) : applyTransition('dissolve', c.id) },
    { text: c.locked ? 'Unlock clip' : 'Lock clip', icon: c.locked ? LockOpen : Lock, sc: 'Ctrl+L', onClick: () => run('lock') },
    { divider: true },
    { text: n > 1 ? `Delete ${n} clips` : 'Delete', icon: Trash2, sc: 'Delete', danger: true, onClick: () => run('delete') },
    !(t.main && p.settings.magnetic) && { text: 'Delete and close gap', sc: 'Shift+Delete', danger: true, onClick: () => run('ripple-delete') },
  ]);
  // Right-click works out a cut position for "Split here"; don't leave its snap guide on screen afterwards.
  if (!ui.value.blade) { snapLine.value = null; bladePrev = null; }
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
      if (over && lane) { const lr = lane.getBoundingClientRect(), sr = el.getBoundingClientRect(); dropHint.value = { x: t * z, y: lr.top - sr.top + el.scrollTop, w: Math.max(30, (d?.duration || (d?.type === 'media' && asset(d.id)?.duration) || 3) * z), h: lr.height }; }
      else dropHint.value = null;
    },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) dropHint.value = null; },
    onDrop: async e => {
      e.preventDefault(); dropHint.value = null; const { t, track } = locate(e); const d = window.__fcDrag; window.__fcDrag = null;
      if (!d) {
        if (!e.dataTransfer.files.length) return;
        const files = [...e.dataTransfer.files];
        try { const r = await trackImport(files.length, () => importFiles(files)); rememberMedia(r.assets); if (r.errors.length) toast(r.errors.map(x => `${x.name}: ${x.error}`).join('\n'), 'error'); addAssets(r.assets, { at: t, trackId: track?.id }); } catch (err) { toast(err.message, 'error'); }
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
      if (d.type === 'textTemplate') addTextTemplate(d.tpl || TEXT_TEMPLATES.find(x => x.id === d.id), t);
      const textClip = () => { const id = document.elementFromPoint(e.clientX, e.clientY)?.closest('.clip.k-text:not(.caption)')?.dataset.clip; return id && p.clips.find(c => c.id === id); };
      if (d.type === 'sticker' && d.sticker?.type === 'emoji' && textClip()) appendToText(textClip().id, d.sticker.value); // emoji dropped on a text clip joins its text
      else if (d.type === 'sticker') addSticker(d.sticker, { at: t });
      if (d.type === 'library') d.drop({ at: t, track });
      if (d.type === 'transition') { const target = p.clips.filter(c => c.kind !== 'audio' && (!track || c.trackId === track.id) && transitionPartner(p, c)).sort((a2, b2) => Math.abs(a2.start - t) - Math.abs(b2.start - t))[0]; applyTransition(d.id, target?.id); }
      const onClip = () => { const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.clip'); return el?.dataset.clip; };
      if (d.type === 'effect') { effectPick.value = null; const id = onClip(); if (id) { selection.value = [id]; applyEffect(d.id); } else { selection.value = []; player.current?.seek(t); applyEffect(d.id); } }
      if (d.type === 'filter') { const id = onClip(); if (id) { selection.value = [id]; applyFilter(d.id, d.name); } else { selection.value = []; player.current?.seek(t); applyFilter(d.id, d.name); } }
    },
  };
}

function Toolbar() {
  const p = project.value, h = history.value, sel = selection.value.length > 0, z = zoom.value;
  return <div class="tl-toolbar">
    <button class="icon-btn" data-tip="Undo" aria-label="Undo" data-kbd="Ctrl+Z" disabled={!h.past.length} onClick={() => run('undo')}><Undo2 size={16} /></button>
    <button class="icon-btn" data-tip="Redo" aria-label="Redo" data-kbd="Ctrl+Y" disabled={!h.future.length} onClick={() => run('redo')}><Redo2 size={16} /></button>
    <span class="sep" />
    <button class="icon-btn" data-tip="Split at playhead" data-kbd="Ctrl+B" onClick={() => splitAt()}><Scissors size={16} /></button>
    <button class={`icon-btn ${ui.value.blade ? 'on' : ''}`} aria-pressed={ui.value.blade} data-tip={ui.value.blade ? 'Blade on — click a clip to cut it there, Shift+click cuts every track. Press C or Esc to stop.' : 'Blade — click anywhere on a clip to cut it'} aria-label="Blade tool" data-kbd="C" onClick={() => run('blade')}><Slice size={16} /></button>
    <button class="icon-btn" data-tip="Trim start to playhead" aria-label="Trim start to playhead" data-kbd="Q" onClick={() => run('trim-start')}><ArrowLeftToLine size={16} /></button>
    <button class="icon-btn" data-tip="Trim end to playhead" aria-label="Trim end to playhead" data-kbd="W" onClick={() => run('trim-end')}><ArrowRightToLine size={16} /></button>
    <button class="icon-btn" data-tip="Delete" aria-label="Delete" data-kbd="Delete" disabled={!(sel || transitionSel.value || keySel.value.length)} onClick={() => run('delete')}><Trash2 size={16} /></button>
    <button class="icon-btn" data-tip="Duplicate" aria-label="Duplicate" data-kbd="Ctrl+D" disabled={!sel} onClick={() => run('duplicate')}><CopyPlus size={16} /></button>
    <button class="icon-btn" data-tip="Add marker at playhead — right-click a marker on the ruler to rename or delete it" aria-label="Add marker" onClick={() => commit('Add marker', d => { if (d.markers.some(m => Math.abs(m.t - time.value) < 1 / fpsOf(d))) return false; d.markers.push({ t: time.value, label: '' }); d.markers.sort((a, b) => a.t - b.t); })}><Diamond size={15} /></button>
    <button class="icon-btn" data-tip="Record voiceover" onClick={openStudio}><Mic size={16} /></button>
    <div class="grow" />
    <span class="tl-gaps"><button class="tl-toggle" data-tip="Close every gap on every track (captions and locked tracks stay put). Ctrl+Z undoes it." data-kbd="Alt+G" onClick={() => closeAllGaps()}><FoldHorizontal size={14} />Close gaps</button><button class="tl-toggle tl-more" aria-label="Close gaps options" onClick={e => openMenu(e, [{ text: 'Close gaps on all tracks', onClick: () => closeAllGaps() }, { text: 'Close gaps on the main track', onClick: () => closeAllGaps({ trackIds: [mainTrack(p).id] }) }, { text: 'Close gaps on the selected clips’ tracks', disabled: !sel, onClick: () => closeAllGaps({ trackIds: [...new Set(p.clips.filter(c => selection.value.includes(c.id)).map(c => c.trackId))] }) }], { align: 'below' })}><ChevronDown size={12} /></button></span>
    <span class="sep" />
    <button class={`tl-toggle ${p.settings.snapping ? 'on' : ''}`} aria-pressed={!!p.settings.snapping} data-tip={`Snap ${p.settings.snapping ? 'on' : 'off'} — while dragging, clip edges stick to other edges, the playhead and markers. Hold Alt to bypass.`} data-kbd="N" onClick={() => commit('Toggle snapping', d => { d.settings.snapping = !d.settings.snapping; })}><Magnet size={14} />Snap</button>
    <button class={`tl-toggle ${p.settings.magnetic ? 'on' : ''}`} aria-pressed={!!p.settings.magnetic} data-tip={`Gapless main track ${p.settings.magnetic ? 'on' : 'off'} — clips on the Main track always sit end to end; removing one pulls the rest left.`} onClick={() => commit('Toggle gapless main track', d => { d.settings.magnetic = !d.settings.magnetic; })}><GalleryHorizontalEnd size={14} />Gapless main</button>
    <span class="sep" />
    <button class={`icon-btn ${ui.value.ripple ? 'on' : ''}`} aria-pressed={ui.value.ripple} data-tip={`Ripple edits ${ui.value.ripple ? 'on' : 'off'} — trimming or deleting a clip closes or opens space after it on the same track`} aria-label="Ripple edits" onClick={() => setUi({ ripple: !ui.value.ripple })}><ArrowLeftRight size={16} /></button>
    <button class={`icon-btn ${ui.value.linked ? 'on' : ''}`} aria-pressed={ui.value.linked} data-tip={`Linked audio/video ${ui.value.linked ? 'on' : 'off'} — separated audio moves, trims, splits and deletes with its video. Off: edit them independently.`} onClick={() => setUi({ linked: !ui.value.linked })}><Link2 size={16} /></button>
    <span class="sep" />
    <button class="icon-btn" data-tip="Zoom out" aria-label="Zoom out" data-kbd="-" onClick={() => zoomAround(1 / 1.4)}><ZoomOut size={16} /></button>
    <input type="range" class="zoom-range" min={Math.log(4)} max={Math.log(800)} step={0.01} value={Math.log(z)} style={{ '--fill': ((Math.log(z) - Math.log(4)) / (Math.log(800) - Math.log(4)) * 100) + '%' }} onInput={e => zoomAround(Math.exp(+e.target.value) / zoom.value)} aria-label="Timeline zoom" />
    <button class="icon-btn" data-tip="Zoom in" data-kbd="=" onClick={() => zoomAround(1.4)}><ZoomIn size={16} /></button>
    <button class="icon-btn" data-tip="Fit to window" data-kbd="F" onClick={fitTimeline}><Maximize size={15} /></button>
  </div>;
}
