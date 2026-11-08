// Central command registry: menu bar, keyboard shortcuts and the shortcut reference.
import { Scissors, Copy, ClipboardPaste, Trash2, Undo2, Redo2, Type, Upload, Mic, Captions, ZoomIn, ZoomOut, Maximize, Settings, Keyboard, Download, FolderOpen, Plus, Save, ArrowLeft, Magnet, Sparkles, Film, Blend } from 'lucide-preact';
import { project, selection, player, time, undo, redo, toast, saveNow, closeProject, commit, zoom, libraryTab, duration, primary } from '../lib/state.js';
import { api, native, pickMedia } from '../lib/api.js';
import { splitAt, deleteClips, duplicateClips, copyClips, cutClips, pasteClips, selectAll, addText, addAssets, trimClip, applyTransition, updateClips } from '../lib/edit.js';
import { clipEnd, mainTrack, trackClips, RATIOS, RESOLUTIONS, FRAME_RATES } from '../../shared/model.mjs';
import { showDialog, closeDialog, Modal, Select, Segmented, Color, Slider, Kbd } from './kit.jsx';
import { openExport } from './ExportDialog.jsx';
import { openPreferences } from './Preferences.jsx';
import { createProject } from './Home.jsx';

const fps = () => project.value?.settings.fps || 30;
const seek = t => player.current?.seek(t);
export async function importMedia(opts) { try { const r = await pickMedia(); if (!r) return; if (r.errors.length) toast(r.errors.map(e => `${e.name}: ${e.error}`).join('\n'), 'error'); if (r.assets.length) { commit('Import media', p => { for (const a of r.assets) if (!p.mediaIds.includes(a.id)) p.mediaIds.push(a.id); }); if (opts?.add) addAssets(r.assets); else toast(`${r.assets.length} file${r.assets.length > 1 ? 's' : ''} imported. Drag onto the timeline or press + to add.`); } } catch (e) { toast(e.message, 'error'); } }
function cuts() { const p = project.value; const s = new Set([0]); for (const c of p.clips) { s.add(+c.start.toFixed(4)); s.add(+clipEnd(c).toFixed(4)); } return [...s].sort((a, b) => a - b); }
const zoomBy = k => { zoom.value = Math.min(800, Math.max(4, zoom.value * k)); };
export function fitTimeline() { const el = document.querySelector('.tl-scroll'); const d = Math.max(5, duration.value); if (el) zoom.value = Math.min(800, Math.max(4, (el.clientWidth - 120) / d)); }
function trimTo(edge) { const c = primary.value; if (!c) return toast('Select a clip first.', 'warn'); const t = time.value; if (t <= c.start || t >= clipEnd(c)) return toast('Put the playhead inside the selected clip.', 'warn'); trimClip(c.id, edge, t); if (edge === 'start' && mainTrack(project.value).id === c.trackId) seek(c.start); }
function toggleMute() { const ids = selection.value; if (!ids.length) return toast('Select a clip to mute.', 'warn'); const p = project.value; const anyOn = p.clips.some(c => ids.includes(c.id) && !c.muted); updateClips(ids, c => { if ('muted' in c) c.muted = anyOn; }, { label: anyOn ? 'Mute' : 'Unmute' }); }

export const ACTIONS = [
  { id: 'play', label: 'Play / pause', keys: ['Space'], run: () => player.current?.toggle(), group: 'Playback' },
  { id: 'prev-frame', label: 'Previous frame', keys: ['ArrowLeft'], run: () => player.current?.step(-1), group: 'Playback' },
  { id: 'next-frame', label: 'Next frame', keys: ['ArrowRight'], run: () => player.current?.step(1), group: 'Playback' },
  { id: 'back-1s', label: 'Back 1 second', keys: ['Shift+ArrowLeft'], run: () => seek(time.value - 1), group: 'Playback' },
  { id: 'fwd-1s', label: 'Forward 1 second', keys: ['Shift+ArrowRight'], run: () => seek(time.value + 1), group: 'Playback' },
  { id: 'prev-cut', label: 'Previous cut', keys: ['ArrowUp'], run: () => { const c = cuts().filter(x => x < time.value - 1e-3); seek(c.at(-1) ?? 0); }, group: 'Playback' },
  { id: 'next-cut', label: 'Next cut', keys: ['ArrowDown'], run: () => { const c = cuts().find(x => x > time.value + 1e-3); if (c !== undefined) seek(c); }, group: 'Playback' },
  { id: 'start', label: 'Go to start', keys: ['Home'], run: () => seek(0), group: 'Playback' },
  { id: 'end', label: 'Go to end', keys: ['End'], run: () => seek(duration.value), group: 'Playback' },
  { id: 'shuttle-back', label: 'Play backwards / slower', keys: ['J'], run: () => { player.current?.pause(); seek(time.value - 0.5); }, group: 'Playback' },
  { id: 'shuttle-stop', label: 'Pause', keys: ['K'], run: () => player.current?.pause(), group: 'Playback' },
  { id: 'shuttle-fwd', label: 'Play faster (1×, 2×, 4×)', keys: ['L'], run: () => { const pl = player.current; if (!pl) return; if (!pl.playing) { pl.setRate(1); pl.play(); } else pl.setRate(Math.min(4, pl.rate * 2)); toast(`Playback ${pl.rate}×`); }, group: 'Playback' },
  { id: 'fullscreen', label: 'Full-screen preview', keys: ['Shift+F'], run: () => document.querySelector('.preview')?.requestFullscreen?.(), group: 'Playback' },

  { id: 'split', label: 'Split at playhead', keys: ['Ctrl+B', 'Ctrl+K'], icon: Scissors, run: () => splitAt(), group: 'Edit' },
  { id: 'trim-start', label: 'Trim start to playhead', keys: ['Q'], run: () => trimTo('start'), group: 'Edit' },
  { id: 'trim-end', label: 'Trim end to playhead', keys: ['W'], run: () => trimTo('end'), group: 'Edit' },
  { id: 'delete', label: 'Delete', keys: ['Delete', 'Backspace'], icon: Trash2, run: () => deleteClips(), group: 'Edit' },
  { id: 'ripple-delete', label: 'Delete and close gap', keys: ['Shift+Delete'], run: () => deleteClips(undefined, { ripple: true }), group: 'Edit' },
  { id: 'duplicate', label: 'Duplicate', keys: ['Ctrl+D'], icon: Copy, run: () => duplicateClips(), group: 'Edit' },
  { id: 'copy', label: 'Copy', keys: ['Ctrl+C'], icon: Copy, run: () => copyClips() && toast('Copied.'), group: 'Edit' },
  { id: 'cut', label: 'Cut', keys: ['Ctrl+X'], run: () => cutClips(), group: 'Edit' },
  { id: 'paste', label: 'Paste at playhead', keys: ['Ctrl+V'], icon: ClipboardPaste, run: () => pasteClips(), group: 'Edit' },
  { id: 'select-all', label: 'Select all', keys: ['Ctrl+A'], run: () => selectAll(), group: 'Edit' },
  { id: 'deselect', label: 'Clear selection', keys: ['Escape'], run: () => { selection.value = []; }, group: 'Edit' },
  { id: 'mute', label: 'Mute / unmute clip', keys: ['Ctrl+M'], run: toggleMute, group: 'Edit' },
  { id: 'undo', label: 'Undo', keys: ['Ctrl+Z'], icon: Undo2, run: () => { const l = undo(); if (l) toast('Undid ' + l.toLowerCase()); }, group: 'Edit' },
  { id: 'redo', label: 'Redo', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], icon: Redo2, run: () => { const l = redo(); if (l) toast('Redid ' + l.toLowerCase()); }, group: 'Edit' },

  { id: 'add-text', label: 'Add text', keys: ['T'], icon: Type, run: () => { addText(); libraryTab.value = 'text'; }, group: 'Insert' },
  { id: 'add-video', label: 'Import video & photos', keys: ['V'], icon: Upload, run: () => { libraryTab.value = 'media'; importMedia(); }, group: 'Insert' },
  { id: 'add-audio', label: 'Import audio', keys: ['A'], icon: Upload, run: () => { libraryTab.value = 'audio'; importMedia(); }, group: 'Insert' },
  { id: 'add-sticker', label: 'Stickers', keys: ['S'], run: () => { libraryTab.value = 'stickers'; }, group: 'Insert' },
  { id: 'add-transition', label: 'Add transition at nearest cut', keys: ['R'], icon: Blend, run: () => applyTransition('dissolve'), group: 'Insert' },

  { id: 'zoom-in', label: 'Zoom timeline in', keys: ['=', 'Ctrl+='], icon: ZoomIn, run: () => zoomBy(1.4), group: 'View' },
  { id: 'zoom-out', label: 'Zoom timeline out', keys: ['-', 'Ctrl+-'], icon: ZoomOut, run: () => zoomBy(1 / 1.4), group: 'View' },
  { id: 'zoom-fit', label: 'Fit timeline to window', keys: ['F'], icon: Maximize, run: fitTimeline, group: 'View' },
  { id: 'snap', label: 'Toggle snapping', keys: ['N'], icon: Magnet, run: () => commit('Toggle snapping', p => { p.settings.snapping = !p.settings.snapping; }), group: 'View' },

  { id: 'save', label: 'Save', keys: ['Ctrl+S'], icon: Save, run: async () => { await saveNow(); toast('Saved. FrameCut also saves every change automatically.'); }, group: 'File' },
  { id: 'export', label: 'Export…', keys: ['Ctrl+E'], icon: Download, run: openExport, group: 'File' },
  { id: 'new', label: 'New project', keys: ['Ctrl+N'], icon: Plus, run: async () => { await saveNow(); createProject({ ratio: project.value?.settings.ratio }); }, group: 'File' },
  { id: 'open', label: 'Open project…', keys: ['Ctrl+O'], icon: FolderOpen, run: () => closeProject(), group: 'File' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', keys: ['?', 'Shift+/'], icon: Keyboard, run: () => openShortcuts(), group: 'Help' },
];
const byId = Object.fromEntries(ACTIONS.map(a => [a.id, a]));
export const run = id => byId[id]?.run();
const scOf = id => byId[id]?.keys[0]?.replace('Arrow', '');

function keyName(e) {
  const parts = []; if (e.ctrlKey || e.metaKey) parts.push('Ctrl'); if (e.altKey) parts.push('Alt');
  let k = e.key === ' ' ? 'Space' : e.key === '+' ? '=' : e.key;
  const printable = k.length === 1 && !/[a-z]/i.test(k);
  if (e.shiftKey && !printable) parts.push('Shift');
  if (k.length === 1) k = k.toUpperCase();
  return [...parts, k].join('+');
}
export function installShortcuts() {
  const map = new Map(); for (const a of ACTIONS) for (const k of a.keys) map.set(k.toUpperCase(), a);
  const handler = e => {
    if (document.querySelector('.backdrop, .menu')) return;
    const t = e.target; const typing = t.closest?.('input, textarea, select, [contenteditable]') && !(t.type === 'range');
    if (typing) { if ((e.ctrlKey || e.metaKey) && ['s', 'e'].includes(e.key.toLowerCase())) { e.preventDefault(); t.blur(); } else return; }
    const name = keyName(e); const a = map.get(name.toUpperCase()) || (e.key === '?' ? byId.shortcuts : null);
    if (!a) return;
    e.preventDefault(); e.stopPropagation(); a.run();
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

export function menus() {
  const item = (id, extra = {}) => ({ text: byId[id].label, sc: scOf(id), icon: byId[id].icon, onClick: byId[id].run, ...extra });
  const sel = () => selection.value.length > 0;
  return {
    File: () => [item('new'), item('open', { text: 'Back to projects', icon: ArrowLeft }), { divider: true }, { text: 'Import media…', icon: Upload, sc: 'V', onClick: () => importMedia() }, { text: 'Save project as file…', onClick: saveAsFile }, { text: 'Project settings…', icon: Settings, onClick: openProjectSettings }, { divider: true }, item('save'), item('export'), { divider: true }, { text: 'Preferences…', onClick: openPreferences }],
    Edit: () => [item('undo'), item('redo'), { divider: true }, item('cut', { disabled: !sel() }), item('copy', { disabled: !sel() }), item('paste'), item('duplicate', { disabled: !sel() }), item('delete', { disabled: !sel() }), item('ripple-delete', { disabled: !sel() }), { divider: true }, item('split'), item('trim-start'), item('trim-end'), item('select-all')],
    View: () => [item('zoom-in'), item('zoom-out'), item('zoom-fit'), { divider: true }, { text: 'Snapping', checked: !!project.value?.settings.snapping, onClick: byId.snap.run, sc: 'N' }, { text: 'Magnetic main track', checked: !!project.value?.settings.magnetic, onClick: () => commit('Toggle magnetic track', p => { p.settings.magnetic = !p.settings.magnetic; }) }, { divider: true }, item('fullscreen')],
    Insert: () => [item('add-text'), { text: 'Sticker', onClick: () => (libraryTab.value = 'stickers') }, item('add-transition'), { text: 'Captions…', icon: Captions, onClick: () => (libraryTab.value = 'captions') }, { text: 'Effects', icon: Sparkles, onClick: () => (libraryTab.value = 'effects') }, { text: 'Record voiceover', icon: Mic, onClick: () => (libraryTab.value = 'audio') }, { divider: true }, item('add-video'), item('add-audio')],
    Help: () => [item('shortcuts'), { text: 'Getting started', onClick: openHelp }],
  };
}

async function saveAsFile() {
  const p = project.value; await saveNow();
  if (!native) return toast('Saving project files needs the desktop app.', 'warn');
  const path = await native.saveFile({ title: 'Save project file', defaultPath: p.name + '.framecut', filters: [{ name: 'FrameCut project', extensions: ['framecut'] }] });
  if (!path) return;
  try { await api(`/api/projects/${p.id}/save-as`, { path }); toast('Project file saved. It references your media by location — bring the media along when moving computers.'); } catch (e) { toast(e.message, 'error'); }
}

function ProjectSettingsDialog() {
  const [s, setS] = useState(() => structuredClone(project.value.settings));
  const set = patch => setS(x => ({ ...x, ...patch }));
  return <Modal title="Project settings" footer={<><button class="btn ghost" onClick={() => closeDialog()}>Cancel</button><button class="btn primary" onClick={() => { commit('Project settings', p => { p.settings = s; }); closeDialog(); }}>Apply</button></>}>
    <div class="field"><label>Aspect ratio</label><div class="ratio-grid">{Object.entries(RATIOS).map(([r, info]) => <button key={r} class={`ratio-opt ${s.ratio === r ? 'on' : ''}`} onClick={() => set({ ratio: r })}><b>{r}</b><small>{info.name}</small></button>)}</div></div>
    <div class="field-row">
      <div class="field"><label>Resolution</label><Select value={s.resolution} options={RESOLUTIONS.map(r => [r, r === 2160 ? '4K (2160p)' : r === 4320 ? '8K (4320p)' : r + 'p'])} onChange={v => set({ resolution: +v })} /></div>
      <div class="field"><label>Frame rate</label><Select value={s.fps} options={FRAME_RATES.map(f => [f, f + ' fps'])} onChange={v => set({ fps: +v })} /></div>
    </div>
    <div class="field"><label>Canvas background</label><Segmented value={s.background.type} options={[['black', 'Black'], ['color', 'Color'], ['blur', 'Blurred video']]} onChange={v => set({ background: { ...s.background, type: v } })} /></div>
    {s.background.type === 'color' && <Color label="Background color" value={s.background.color} onChange={v => set({ background: { ...s.background, color: v } })} />}
    {s.background.type === 'blur' && <Slider label="Blur strength" min={4} max={60} step={1} value={s.background.blur} def={24} onChange={v => set({ background: { ...s.background, blur: v } })} />}
  </Modal>;
}
export const openProjectSettings = () => showDialog(() => <ProjectSettingsDialog />);
import { useState } from 'preact/hooks';

export function openShortcuts() {
  const groups = [...new Set(ACTIONS.map(a => a.group))];
  showDialog(() => <Modal title="Keyboard shortcuts" size="wide">
    <div class="shortcut-grid">{groups.map(g => <div key={g}><h4>{g}</h4>{ACTIONS.filter(a => a.group === g).map(a => <div class="shortcut-row" key={a.id}><span>{a.label}</span><span>{a.keys.slice(0, 2).map(k => <Kbd key={k}>{k.replace('Arrow', '').replace('Left', '←').replace('Right', '→').replace('Up', '↑').replace('Down', '↓')}</Kbd>)}</span></div>)}</div>)}</div>
    <p class="muted" style={{ marginTop: 14 }}>Tip: right-click clips, tracks and media for more actions. Hold <Kbd>Alt</Kbd> while dragging to turn off snapping, and use <Kbd>Ctrl</Kbd>+wheel on the timeline to zoom.</p>
  </Modal>);
}
export function openHelp() {
  showDialog(() => <Modal title="Getting started" size="wide">
    <ol class="help-steps">
      <li><b>Import</b> — drop videos, photos and music onto the Media panel (or press <Kbd>V</Kbd>). Files are linked, not copied.</li>
      <li><b>Arrange</b> — drag media to the timeline. The main track snaps clips together; drop above it to layer picture-in-picture.</li>
      <li><b>Cut</b> — move the playhead and press <Kbd>Ctrl+B</Kbd> to split, drag clip edges to trim, <Kbd>Delete</Kbd> to remove.</li>
      <li><b>Style</b> — add text, captions, stickers, transitions, filters and effects from the left panel. Select anything to fine-tune it on the right.</li>
      <li><b>Export</b> — press <Kbd>Ctrl+E</Kbd>, pick a preset and save. What you see in the preview is what you get.</li>
    </ol>
  </Modal>);
}
