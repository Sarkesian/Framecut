// Application state (Preact signals), editing history and autosave.
import { signal, computed, batch, effect } from '@preact/signals';
import { normalizeProject, packMain, projectDuration } from '../../shared/model.mjs';
import { reconcileWords } from '../../shared/captions.mjs';
import { api } from './api.js';
import { ui, setUi } from './uiprefs.js';

export const route = signal({ name: 'home' });
export const prefs = signal({});
export const health = signal({});
export const media = signal(new Map());
export const jobs = signal([]);
export const fonts = signal({ system: [], user: [] });
export const userLuts = signal([]);
export const toasts = signal([]);
export const dialog = signal(null);
export const menu = signal(null);

export const project = signal(null);
export const selection = signal([]); // clip ids, primary first
// The selected transition (id of the clip it leads into). Selecting clips clears it, and vice versa.
export const transitionSel = signal(null);
effect(() => { if (selection.value.length && transitionSel.peek()) transitionSel.value = null; });
export const selectedTrack = signal(null);
export const time = signal(0);
export const playing = signal(false);
export const saveState = signal('saved'); // saved | saving | error | unsaved
export const history = signal({ past: [], future: [] });
export const drag = signal(null); // transient timeline drag/trim preview
export const libraryTab = signal('media');
export const zoom = signal(Math.min(800, Math.max(4, +ui.value.zoom || 80))); // timeline pixels per second
effect(() => { const z = zoom.value; if (ui.peek().zoom !== z) setUi({ zoom: z }); });
export const duration = computed(() => (project.value ? projectDuration(project.value) : 0));
export const primary = computed(() => { const p = project.value, id = selection.value[0]; return p && id ? p.clips.find(c => c.id === id) || null : null; });
export const player = { current: null };

// Pointer gestures: every commit made between a press and its release (plus that release's own handlers)
// belongs to one gesture. Commits with the same key coalesce into ONE undo entry for the whole gesture —
// however long the user pauses mid-drag — and two separate drags never merge. Keyboard/typing edits without
// a gesture coalesce while they keep coming within `window` ms (default 1.2 s).
const gesture = { id: 0, active: false };
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', e => { if (!e.isTrusted) return; gesture.id++; gesture.active = true; }, true);
  const release = e => { if (e.isTrusted) setTimeout(() => { gesture.active = false; }, 0); };
  window.addEventListener('pointerup', release, true); window.addEventListener('pointercancel', release, true);
  // A drag released outside the window never delivers pointerup: end the gesture on blur or on the first
  // move with no button held, so later keyboard edits don't merge into the drag's undo entry.
  window.addEventListener('blur', () => { gesture.active = false; });
  window.addEventListener('pointermove', e => { if (gesture.active && e.buttons === 0) gesture.active = false; }, true);
}
let coalesce = { key: null, at: 0, g: null };
// Apply an edit: fn receives a draft copy; history records the previous version.
export function commit(label, fn, { key = null, select, window: win = 1200 } = {}) {
  const prev = project.value; if (!prev) return;
  const draft = structuredClone(prev);
  const result = fn(draft); if (result === false) return;
  packMain(draft);
  for (const c of draft.clips) if (c.caption && c.words?.length) reconcileWords(c); // text edits anywhere keep word timing
  const now = Date.now(), g = gesture.active ? gesture.id : null;
  const merge = !!key && coalesce.key === key && (g !== null || coalesce.g !== null ? g === coalesce.g : now - coalesce.at < win);
  coalesce = { key, at: now, g };
  batch(() => {
    const h = history.value;
    history.value = { past: merge ? h.past : [...h.past.slice(-149), { project: prev, label, selection: selection.value }], future: [] };
    project.value = draft;
    if (select) selection.value = select;
    else selection.value = selection.value.filter(id => draft.clips.some(c => c.id === id));
  });
  scheduleSave();
  player.current?.invalidate();
}
// Starts a new undo entry for the next commit even if its key matches the previous one.
export const breakCoalesce = () => { coalesce = { key: null, at: 0, g: null }; };
export function undo() {
  const h = history.value; const last = h.past.at(-1); if (!last) return null;
  batch(() => { history.value = { past: h.past.slice(0, -1), future: [{ project: project.value, label: last.label, selection: selection.value }, ...h.future] }; project.value = last.project; selection.value = last.selection.filter(id => last.project.clips.some(c => c.id === id)); });
  coalesce = { key: null, at: 0, g: null }; scheduleSave(); player.current?.invalidate(); return last.label;
}
export function redo() {
  const h = history.value; const next = h.future[0]; if (!next) return null;
  batch(() => { history.value = { past: [...h.past, { project: project.value, label: next.label, selection: selection.value }], future: h.future.slice(1) }; project.value = next.project; selection.value = next.selection; });
  coalesce = { key: null, at: 0, g: null }; scheduleSave(); player.current?.invalidate(); return next.label;
}

let saveTimer, saving = Promise.resolve();
export function scheduleSave(delay = 700) {
  saveState.value = 'unsaved'; clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(), delay);
}
export function saveNow() {
  clearTimeout(saveTimer);
  const p = project.value; if (!p) return saving;
  saving = saving.then(async () => {
    saveState.value = 'saving';
    try { const r = await api(`/api/projects/${p.id}`, p, 'PUT'); if (project.value?.id === p.id) project.value.modified = r.modified; saveState.value = project.value === p ? 'saved' : 'unsaved'; }
    catch (e) { saveState.value = 'error'; toast('Your project could not be saved: ' + e.message, 'error'); }
  });
  return saving;
}
export async function openProject(id) {
  const p = normalizeProject(await api('/api/projects/' + id));
  batch(() => { project.value = p; history.value = { past: [], future: [] }; selection.value = []; time.value = 0; route.value = { name: 'editor', id }; saveState.value = 'saved'; });
  if (p.recovered) toast(`This project was restored from a backup made ${new Date(p.recovered).toLocaleString()}.`, 'warn');
  try { localStorage.setItem('framecut:last', id); } catch {}
}
export async function closeProject() { await saveNow(); player.current?.pause(); batch(() => { route.value = { name: 'home' }; project.value = null; selection.value = []; }); }

let toastId = 0;
export function toast(text, kind = 'info', { action, timeout } = {}) {
  const id = ++toastId;
  toasts.value = [...toasts.value.slice(-3), { id, text, kind, action }];
  setTimeout(() => dismissToast(id), timeout ?? (kind === 'error' ? 9000 : 4500));
  return id;
}
export const dismissToast = id => { toasts.value = toasts.value.filter(t => t.id !== id); };

export async function refreshMedia() {
  const list = await api('/api/media');
  media.value = new Map(list.map(a => [a.id, a]));
  return list;
}
export const asset = id => media.value.get(id);
export async function savePrefs(patch) { prefs.value = await api('/api/preferences', { ...prefs.value, ...patch }, 'PUT'); }
