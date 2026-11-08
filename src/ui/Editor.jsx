// Editor workspace: asset browser | preview | inspector over a multitrack timeline.
import { useEffect, useRef, useState } from 'preact/hooks';
import { ArrowLeft, Undo2, Redo2, Download, Check, LoaderCircle, TriangleAlert, Keyboard, Settings, ChevronDown } from 'lucide-preact';
import { project, saveState, history, undo, redo, closeProject, commit, toast, player, time, selection, saveNow, jobs } from '../lib/state.js';
import { native } from '../lib/api.js';
import { openMenu, useDraft } from './kit.jsx';
import { Logo } from './Logo.jsx';
import { AssetPanel } from './AssetPanel.jsx';
import { Preview } from './Preview.jsx';
import { Inspector } from './Inspector.jsx';
import { Timeline } from './Timeline.jsx';
import { openExport } from './ExportDialog.jsx';
import { openPreferences } from './Preferences.jsx';
import { openShortcuts, installShortcuts, menus } from './commands.jsx';
import { TaskIndicator } from './Tasks.jsx';
import { studioOpen, focusMode, StudioPanel, FocusScript } from './Studio.jsx';
import { WaveEditor } from './WaveEditor.jsx';
import { applySavedOutput } from '../audio/devices.js';

function usePanelSize(key, initial, min, max) {
  const [size, setSize] = useState(() => { try { return Math.min(max, Math.max(min, +localStorage.getItem('fc:' + key) || initial)); } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem('fc:' + key, size); } catch {} }, [size]);
  return [size, setSize];
}
function Splitter({ dir, onDrag, onReset, label }) {
  const start = e => {
    e.preventDefault(); const el = e.currentTarget; el.setPointerCapture(e.pointerId); el.classList.add('active');
    let last = dir === 'v' ? e.clientX : e.clientY;
    const move = ev => { const p = dir === 'v' ? ev.clientX : ev.clientY; onDrag(p - last); last = p; };
    const up = () => { el.classList.remove('active'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); window.dispatchEvent(new Event('resize')); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  return <div class={`splitter ${dir}`} role="separator" aria-label={label} onPointerDown={start} onDblClick={onReset} />;
}

export function Editor() {
  const p = project.value;
  const [left, setLeft] = usePanelSize('left', 340, 260, 560), [right, setRight] = usePanelSize('right', 330, 280, 520), [bottom, setBottom] = usePanelSize('timeline', 330, 180, 700);
  useEffect(() => installShortcuts(), []);
  useEffect(() => { native?.setTitleColors?.({ color: '#0b0c10', symbolColor: '#c9ccd6' }); const beforeUnload = () => { saveNow(); }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, []);
  if (!p) return null;
  useEffect(() => { setTimeout(() => applySavedOutput().catch(() => {}), 500); }, []);
  const studio = studioOpen.value, focus = studio && focusMode.value;
  return <div class={`editor ${focus ? 'focus' : ''}`} style={{ '--left': (studio ? Math.max(left, 360) : left) + 'px', '--right': right + 'px', '--bottom': bottom + 'px' }}>
    <TopBar />
    <div class="workspace">
      <aside class="panel left">{studio ? <StudioPanel /> : <AssetPanel />}</aside>
      <Splitter dir="v" label="Resize media panel" onDrag={d => setLeft(s => Math.min(560, Math.max(260, s + d)))} onReset={() => setLeft(340)} />
      <section class="panel center"><div class="center-stack"><div class="center-main"><Preview />{focus && <FocusScript />}</div>{studio && !focus && <WaveEditor />}</div></section>
      <Splitter dir="v" label="Resize inspector" onDrag={d => setRight(s => Math.min(520, Math.max(280, s - d)))} onReset={() => setRight(330)} />
      <aside class="panel right"><Inspector /></aside>
    </div>
    <Splitter dir="h" label="Resize timeline" onDrag={d => setBottom(s => Math.min(window.innerHeight - 300, Math.max(180, s - d)))} onReset={() => setBottom(330)} />
    <section class="timeline-wrap"><Timeline /></section>
  </div>;
}

function SaveStatus() {
  const s = saveState.value;
  if (s === 'error') return <button class="save-status error" onClick={() => saveNow()} data-tip="Click to retry"><TriangleAlert size={13} />Not saved</button>;
  if (s === 'saving' || s === 'unsaved') return <span class="save-status"><LoaderCircle size={13} class="spin" />Saving…</span>;
  return <span class="save-status ok" data-tip="FrameCut saves every change automatically"><Check size={13} />Saved</span>;
}
function TopBar() {
  const p = project.value, h = history.value;
  const [name, setName] = useDraft(p.name);
  const rename = e => { const v = (e?.target?.value ?? name).trim() || 'Untitled project'; if (v !== p.name) commit('Rename project', d => { d.name = v; }); else setName(p.name); };
  return <header class="titlebar editor-bar">
    <button class="icon-btn" data-tip="Back to projects" onClick={closeProject}><ArrowLeft size={17} /></button>
    <Logo size={20} />
    <nav class="menubar">{Object.entries(menus()).map(([label, items]) => <button key={label} class="menubar-item" onClick={e => openMenu(e, items(), { align: 'below' })}>{label}</button>)}</nav>
    <div class="grow drag" />
    <input class="project-title" aria-label="Project name" value={name} onInput={e => setName(e.target.value)} onBlur={rename} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setName(p.name); e.target.blur(); } }} />
    <SaveStatus />
    <div class="grow drag" />
    <TaskIndicator />
    <button class="icon-btn" data-tip="Undo" data-kbd="Ctrl+Z" disabled={!h.past.length} onClick={() => { const l = undo(); if (l) toast('Undid ' + l.toLowerCase()); }}><Undo2 size={17} /></button>
    <button class="icon-btn" data-tip="Redo" data-kbd="Ctrl+Y" disabled={!h.future.length} onClick={() => { const l = redo(); if (l) toast('Redid ' + l.toLowerCase()); }}><Redo2 size={17} /></button>
    <button class="icon-btn" data-tip="Keyboard shortcuts" data-kbd="?" onClick={openShortcuts}><Keyboard size={17} /></button>
    <button class="icon-btn" data-tip="Preferences" onClick={openPreferences}><Settings size={17} /></button>
    <button class="btn primary export-btn" data-tip="Export your video" data-kbd="Ctrl+E" onClick={openExport}><Download size={16} />Export</button>
  </header>;
}
