// Editor preferences that belong to this computer rather than to a project (snapping in the viewer, guides,
// ripple, linked clips, timeline zoom). Stored in localStorage so they are available synchronously at startup.
import { signal, effect } from '@preact/signals';

const KEY = 'fc:ui';
const DEFAULTS = { viewSnap: true, safeArea: false, ripple: false, linked: true, zoom: 80, snapPx: 8 };
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
export const ui = signal({ ...DEFAULTS, ...saved });
export const setUi = patch => { ui.value = { ...ui.value, ...patch }; };
let timer;
effect(() => { const v = ui.value; clearTimeout(timer); timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} }, 150); });
