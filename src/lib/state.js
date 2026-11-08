// Application state (Preact signals), editing history and autosave.
import { signal, computed, batch } from '@preact/signals';
import { normalizeProject, packMain, projectDuration } from '../../shared/model.mjs';
import { api } from './api.js';

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
export const selectedTrack = signal(null);
export const time = signal(0);
export const playing = signal(false);
export const saveState = signal('saved'); // saved | saving | error | unsaved
export const history = signal({ past: [], future: [] });
export const drag = signal(null); // transient timeline drag/trim preview
export const libraryTab = signal('media');
export const zoom = signal(80); // timeline pixels per second
export const duration = computed(() => (project.value ? projectDuration(project.value) : 0));
export const primary = computed(() => { const p = project.value, id = selection.value[0]; return p && id ? p.clips.find(c => c.id === id) || null : null; });
export const player = { current: null };

let coalesce = { key: null, at: 0 };
// Apply an edit: fn receives a draft copy; history records the previous version.
export function commit(label, fn, { key = null, select } = {}) {
  const prev = project.value; if (!prev) return;
  const draft = structuredClone(prev);
  const result = fn(draft); if (result === false) return;
  packMain(draft);
  const now = Date.now();
  const merge = key && coalesce.key === key && now - coalesce.at < 1200;
  coalesce = { key, at: now };
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
export function undo() {
  const h = history.value; const last = h.past.at(-1); if (!last) return null;
  batch(() => { history.value = { past: h.past.slice(0, -1), future: [{ project: project.value, label: last.label, selection: selection.value }, ...h.future] }; project.value = last.project; selection.value = last.selection.filter(id => last.project.clips.some(c => c.id === id)); });
  coalesce = { key: null, at: 0 }; scheduleSave(); player.current?.invalidate(); return last.label;
}
export function redo() {
  const h = history.value; const next = h.future[0]; if (!next) return null;
  batch(() => { history.value = { past: [...h.past, { project: project.value, label: next.label, selection: selection.value }], future: h.future.slice(1) }; project.value = next.project; selection.value = next.selection; });
  scheduleSave(); player.current?.invalidate(); return next.label;
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
