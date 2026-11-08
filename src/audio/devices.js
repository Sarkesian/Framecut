// Audio device management: real device lists, hot-plug detection, remembered choices and output switching.
import { signal } from '@preact/signals';
import { prefs, savePrefs, toast, player } from '../lib/state.js';

export const devices = signal({ inputs: [], outputs: [], permitted: false });
export const activeOutput = signal('default');
let permitted = false, listening = false;

export async function ensurePermission() {
  if (permitted) return true;
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); s.getTracks().forEach(t => t.stop()); permitted = true; await refreshDevices(); return true; }
  catch { return false; }
}
export async function refreshDevices() {
  const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const map = kind => list.filter(d => d.kind === kind).map(d => ({ id: d.deviceId, label: d.label || (kind === 'audioinput' ? 'Microphone' : 'Speakers'), group: d.groupId, isDefault: d.deviceId === 'default', isComms: d.deviceId === 'communications' }));
  const prev = devices.value;
  devices.value = { inputs: map('audioinput'), outputs: map('audiooutput'), permitted: permitted || list.some(d => d.label) };
  if (!listening) { listening = true; navigator.mediaDevices.addEventListener('devicechange', onChange); }
  return { prev };
}
async function onChange() {
  const before = devices.value; await refreshDevices(); const now = devices.value;
  const added = now.outputs.filter(o => !before.outputs.some(b => b.id === o.id)).concat(now.inputs.filter(o => !before.inputs.some(b => b.id === o.id)));
  const removed = before.outputs.filter(o => !now.outputs.some(b => b.id === o.id)).concat(before.inputs.filter(o => !now.inputs.some(b => b.id === o.id)));
  const out = prefs.value.audioOutput;
  if (out && out !== 'default' && removed.some(r => r.id === out)) { await setOutput('default', { remember: false }); toast(`${removed.find(r => r.id === out).label} was disconnected. Playing through the Windows default instead.`, 'warn'); }
  else if (out && out !== 'default' && added.some(a => a.id === out)) { await setOutput(out, { remember: false }); toast(`${added.find(a => a.id === out).label} is back — switched to it.`); }
  else if (added.length && !removed.length) toast(`${added[0].label.replace(/^Default - /, '')} connected.`);
}
export const deviceLabel = (list, id) => (list.find(d => d.id === (id || 'default'))?.label || 'Windows default').replace(/^Default - /, 'Default · ');
export const iconFor = label => /headphone|headset|earbud|airpods|buds/i.test(label) ? 'headphones' : /usb|interface|focusrite|scarlett|audient|motu|presonus|behringer|zoom|steinberg|rode|shure|yeti|blue/i.test(label) ? 'usb' : /monitor|display|hdmi|nvidia|displayport/i.test(label) ? 'monitor' : 'speaker';
export const isSpeaker = label => !/headphone|headset|earbud|airpods|buds/i.test(label || '');

// Route all editor playback to an output device without touching the project mix.
export async function setOutput(id, { remember = true } = {}) {
  const sink = id === 'default' ? '' : id;
  const pl = player.current;
  try {
    if (pl?.ctx?.setSinkId) await pl.ctx.setSinkId(sink);
    for (const el of document.querySelectorAll('audio, video')) if (el.setSinkId) await el.setSinkId(sink).catch(() => {});
    activeOutput.value = id;
    if (remember) await savePrefs({ audioOutput: id });
    return true;
  } catch (e) { toast('Could not switch to that output: ' + e.message, 'error'); return false; }
}
export async function applySavedOutput() {
  const id = prefs.value.audioOutput; if (!id || id === 'default') return;
  await refreshDevices(); if (devices.value.outputs.some(o => o.id === id)) await setOutput(id, { remember: false });
}
export async function quickSwap() {
  const pair = (prefs.value.quickSwap || []).filter(id => devices.value.outputs.some(o => o.id === id));
  if (pair.length < 2) return toast('Pin two outputs as favorites to swap between them.', 'warn');
  const next = activeOutput.value === pair[0] ? pair[1] : pair[0]; await setOutput(next); toast('Now playing through ' + deviceLabel(devices.value.outputs, next));
}
export async function testSpeaker(id) {
  const ctx = new AudioContext(); if (ctx.setSinkId && id && id !== 'default') await ctx.setSinkId(id).catch(() => {});
  const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 660; g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05); g.gain.setValueAtTime(0.2, ctx.currentTime + 0.35); g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
  o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.55); setTimeout(() => ctx.close(), 800);
}
