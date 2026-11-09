// Audio Studio: record voiceovers (standalone or over the playing video), with device selection,
// live metering, mic check, takes/retakes, mistake markers, script reader and one-click cleanup.
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Mic, Square, RotateCcw, FileText, Wand2, X, Headphones, Speaker, Usb, Monitor, Pin, PinOff, Volume2, Check, TriangleAlert, Activity, Focus, ChevronDown, Flag, Repeat, Scale, Waves, LoaderCircle, Captions } from 'lucide-preact';
import { project, player, time, toast, prefs, savePrefs, commit, media, selection, playing, asset } from '../lib/state.js';
import { api } from '../lib/api.js';
import { freeTrack, addTrack, trackOf, insertCaptions } from '../lib/edit.js';
import { alignScript } from '../../shared/script.mjs';
import { newClip, clipEnd } from '../../shared/model.mjs';
import { profileFx, AUDIO_PROFILES, duckKeys } from '../../shared/audio.mjs';
import { devices, refreshDevices, ensurePermission, setOutput, activeOutput, deviceLabel, iconFor, isSpeaker, testSpeaker, quickSwap } from '../audio/devices.js';
import { setRecordingCheck, stopPreview } from '../lib/creative.js';
import { Capture, micCheck } from '../audio/capture.js';
import { NativeCapture, nativeDevices } from '../audio/native.js';
import { beginLiveTake, pushLivePeaks, endLiveTake } from './LiveTake.jsx';
import { openMenu, Toggle, Slider, Segmented, Select, Section } from './kit.jsx';
import { shortTime } from '../lib/format.js';

export const studioOpen = signal(false);
export const focusMode = signal(false);
export const scriptVisible = signal(false);
const ICONS = { headphones: Headphones, usb: Usb, monitor: Monitor, speaker: Speaker };
let capture = null, headphoneHinted = false;
const recState = signal('idle'); // idle | count | rec | saving
setRecordingCheck(() => recState.value !== 'idle');
export const isRecording = () => recState.value !== 'idle';
const meter = signal({ peakDb: -Infinity, rmsDb: -Infinity, clip: false });
const lastRecording = signal(null); // clip id
const markers = signal([]);

export const currentCapture = () => capture;
export function openStudio() { studioOpen.value = true; }
// Closing while a take is starting, counting down or still being saved would tear the microphone down
// under it (and leak a meter helper that blocks the next exclusive-mode take).
export function closeStudio() { if (recState.value !== 'idle') return toast(recState.value === 'saving' ? 'Saving your take — one moment.' : 'Stop recording first.', 'warn'); studioOpen.value = false; focusMode.value = false; capture?.close(); capture = null; }

// Recording engine: 'pro' = native WASAPI (exclusive / raw), 'browser' = Chromium capture.
let nativeOk = null;
export const capInfo = signal(null); // settings of the open microphone (re-renders the input panel)
const lastTake = signal(null);
async function engineFor() {
  if ((opts().engine || 'pro') === 'browser') return 'browser';
  if (nativeOk === null) nativeOk = !!(await nativeDevices()).available;
  return nativeOk ? 'native' : 'browser';
}
// Opening a microphone takes a while (Pro mode spawns helpers). Overlapping calls (studio mount + a quick
// click on Record / Check microphone / a device pick) share one open instead of orphaning a half-open
// capture that keeps the mic or a meter helper running.
let opening = null;
export function getCapture(deviceId) {
  const run = () => openCapture(deviceId);
  const p = (opening || Promise.resolve()).catch(() => {}).then(run);
  opening = p; p.finally(() => { if (opening === p) opening = null; }).catch(() => {});
  return p;
}
async function openCapture(deviceId) {
  const eng = await engineFor();
  if (capture && capture.settings && (capture.engine || 'browser') === eng && (capture.settings.deviceId === (deviceId || 'default') || capture.settings.deviceId === deviceId || (!deviceId && (capture.ctx || capture.engine === 'native')))) return capture;
  await capture?.close();
  const onMeter = m => { meter.value = m; if (recState.value === 'rec' && m.wave?.length) pushLivePeaks(m.wave); };
  const wire = c => {
    c.onNotice = msg => toast(msg, 'info', { timeout: 7000 });
    c.onWriteError = () => { if (recState.value === 'rec') stopRecording(); }; // stop at the failure; the take so far is kept
    c.onEnded = () => { if (recState.value === 'rec') { stopRecording().then(ok => { if (ok) toast('The microphone was disconnected. Your take up to that moment was saved.', 'warn'); }); } else toast('The microphone was disconnected.', 'warn'); };
    return c;
  };
  capture = wire(eng === 'native' ? new NativeCapture({ onMeter }) : new Capture({ onMeter }));
  try { await capture.open(deviceId); }
  catch (e) {
    if (eng !== 'native') throw e;
    // Pro capture unavailable for this device: fall back to the browser engine rather than failing.
    toast('Direct recording could not open this microphone (' + e.message + '). Using Compatible recording instead.', 'warn');
    await capture.close?.();
    capture = wire(new Capture({ onMeter })); await capture.open(deviceId);
  }
  capInfo.value = { ...capture.settings, engine: capture.engine || 'browser' };
  return capture;
}
const MODE_NAMES = { exclusive: 'Exclusive · bit-perfect', raw: 'Raw · no driver effects', shared: 'Shared', browser: 'Compatible' };
const opts = () => ({ engine: 'pro', playVideo: true, countdown: true, preroll: 0, monitor: false, trimSilence: true, ...(prefs.value.recording || {}) });
const setOpt = patch => savePrefs({ recording: { ...opts(), ...patch } });

// ---- Sync offset: a manual correction per microphone for devices whose reported latency is wrong
// (Bluetooth headsets, some USB interfaces). Stored in ms; positive moves the voice earlier.
const micKey = () => String(capture?.settings?.label || prefs.value.audioInput || 'default').replace(/^(Default|Communications) - /, '').trim().toLowerCase() || 'default';
// Slider drags fire faster than preferences save, so the latest value is held here until it is saved;
// otherwise each move would compute its change from a stale value and move the take too far.
const liveOffsets = signal({});
export const syncOffsetMs = () => { const k = micKey(); return +(k in liveOffsets.value ? liveOffsets.value[k] : (opts().syncOffsets || {})[k] || 0); };
// Changing the offset also re-places the most recent take, so you can adjust it by ear right after a take.
function setSyncOffset(ms) {
  const prev = syncOffsetMs(), delta = (ms - prev) / 1000; if (!delta) return;
  const key = micKey(); liveOffsets.value = { ...liveOffsets.value, [key]: ms };
  setOpt({ syncOffsets: { ...(opts().syncOffsets || {}), ...liveOffsets.value } }).catch(e => toast('The sync offset could not be saved: ' + e.message, 'error'));
  const id = lastRecording.value; if (!id || !project.value?.clips.some(c => c.id === id)) return;
  commit('Adjust take sync', d => {
    const c = d.clips.find(x => x.id === id); const a = c && asset(c.mediaId); if (!c || !a) return false;
    const nin = Math.max(0, Math.min((a.duration || 0) - 0.1, (c.in || 0) + delta)); if (Math.abs(nin - (c.in || 0)) < 1e-6) return false;
    c.in = nin; c.duration = Math.max(0.1, Math.min(c.duration, ((a.duration || 0) - nin) / (c.speed || 1)));
    const take = c.takes?.findLast?.(t => t.mediaId === c.mediaId); if (take) take.in = nin;
  }, { key: 'syncoff:' + id });
}
function SyncOffset() {
  const ms = syncOffsetMs();
  const hint = ms === 0 ? 'Takes are placed using the measured delay of this microphone.' : `Takes from this microphone are placed ${Math.abs(ms)} ms ${ms > 0 ? 'earlier' : 'later'} than measured.`;
  return <div class="field">
    <Slider label="Sync offset (this microphone)" min={-300} max={300} step={5} def={0} value={ms} fmt={v => (v > 0 ? '+' : '') + Math.round(v) + ' ms'} onChange={setSyncOffset} />
    <small class="muted">{hint} If your voice sounds late against the video, move the slider right; if early, move it left. The last take moves with it so you can check by ear.</small>
  </div>;
}

export async function startRecording({ retake = false } = {}) {
  if (recState.value !== 'idle') return;
  // Claim the recorder synchronously: a second press (double click, key repeat) while the microphone
  // opens must not start a parallel take.
  recState.value = 'starting';
  const o = opts();
  try { await getCapture(prefs.value.audioInput); } catch (e) { recState.value = 'idle'; return toast('FrameCut couldn’t open the microphone: ' + (e.message || 'no access') + '. Check the cable and Windows privacy settings.', 'error'); }
  const pl = player.current; const p = project.value;
  const outLabel = deviceLabel(devices.value.outputs, activeOutput.value);
  if (o.playVideo && isSpeaker(outLabel) && p.clips.some(c => c.kind !== 'text') && !headphoneHinted) { headphoneHinted = true; toast('Tip: use headphones so the video’s sound doesn’t leak into your microphone.', 'info', { timeout: 6000 }); }
  // Where the take lands: a retake reuses the last recording's position.
  const prev = retake && lastRecording.value && p.clips.find(c => c.id === lastRecording.value);
  const at = prev ? prev.start : time.value;
  stopPreview(); // library previews never play into a take
  if (o.countdown) { recState.value = 'count'; for (let i = 3; i > 0; i--) { countdown.value = i; await new Promise(r => setTimeout(r, 800)); if (recState.value !== 'count') return; } recState.value = 'starting'; }
  const pre = o.playVideo ? Math.min(o.preroll || 0, at) : 0;
  markers.value = [];
  try {
    if (o.playVideo && pl) { pl.pause(); pl.seek(at - pre); }
    const info = await capture.start({ name: `Voiceover ${new Date().toLocaleString().replace(/[/:]/g, '-')}` });
    recState.value = 'rec'; capInfo.value = { ...capture.settings, engine: capture.engine || 'browser' };
    // Measured device latency plus the user's per-microphone sync offset (positive = place takes earlier).
    const lat = o.playVideo ? capture.latency(pl?.ctx) + syncOffsetMs() / 1000 : 0;
    session = { at, pre, started: performance.now(), latency: lat, retakeOf: prev?.id || null, playing: o.playVideo };
    if (o.playVideo && pl) { pl.play(); session.timelineAtStart = at - pre; }
    // Native capture starts in another process: add the measured gap between capture start and playback start.
    if (o.playVideo && capture.markPlay) session.latency += capture.markPlay();
    beginLiveTake(at - pre - (o.playVideo ? session.latency : 0), null);
    await capture.setMonitor(o.monitor, activeOutput.value);
  } catch (e) { recState.value = 'idle'; toast('Recording could not start: ' + e.message, 'error'); }
}
const countdown = signal(0);
let session = null;
export function markMistake() { if (recState.value !== 'rec' || !session) return; const t = (performance.now() - session.started) / 1000; markers.value = [...markers.value, { t, label: 'Mistake' }]; toast('Marked. You’ll see it on the waveform.', 'info', { timeout: 1500 }); }
export async function stopRecording() {
  if (recState.value === 'count') { recState.value = 'idle'; return; }
  if (recState.value !== 'rec') return false;
  recState.value = 'saving'; const s = session; const pl = player.current;
  try {
    pl?.pause(); await capture.setMonitor(false);
    const r = await capture.stop();
    if (!r?.asset) throw Error('Nothing was recorded.');
    const a = r.asset; const m = new Map(media.value); m.set(a.id, a); media.value = m;
    // Recording time 0 corresponds to timeline (at - pre); compensate measured device latency.
    const comp = s.latency || 0;
    let inPt = s.pre + comp, dur = Math.max(0.1, a.duration - inPt);
    if (opts().trimSilence) {
      try { const { speech } = await api('/api/tools/speech', { mediaId: a.id, threshold: -45, minSilence: 0.4 }); if (speech.length) { const first = Math.max(inPt, speech[0].start - 0.15), last = Math.min(a.duration, speech.at(-1).end + 0.3); if (last > first + 0.2) { inPt = first; dur = last - first; } } } catch {}
    }
    const start = s.at + (inPt - s.pre - comp);
    const fx = profileFx(prefs.value.recordingProfile || 'original', prefs.value.audioProfiles || []);
    const take = { mediaId: a.id, in: inPt, markers: markers.value.map(k => ({ t: k.t, label: k.label })), created: Date.now() };
    let id;
    commit(s.retakeOf ? 'Retake' : 'Record voiceover', p => {
      if (!p.mediaIds.includes(a.id)) p.mediaIds.push(a.id);
      const old = s.retakeOf && p.clips.find(c => c.id === s.retakeOf);
      if (old) {
        old.takes ||= [{ mediaId: old.mediaId, in: old.in, markers: old.markers || [], created: 0 }];
        old.takes.push(take); old.mediaId = a.id; old.in = inPt; old.duration = dur; old.start = Math.max(0, start); old.markers = take.markers; id = old.id; return;
      }
      let track = p.tracks.find(t => t.kind === 'audio' && t.voice && !t.locked && !p.clips.some(c => c.trackId === t.id && c.start < start + dur && clipEnd(c) > start));
      if (!track) { track = freeTrack(p, 'audio', Math.max(0, start), start + dur); track.voice = true; if (/^Audio \d+$/.test(track.name) || track.name === 'Audio') track.name = 'Voiceover'; }
      const c = newClip('audio', { mediaId: a.id, name: 'Voiceover', start: Math.max(0, start), in: inPt, duration: dur, audioFx: fx, takes: [take], markers: take.markers });
      c.trackId = track.id; p.clips.push(c); id = c.id;
    }, { select: [] });
    lastRecording.value = id; selection.value = [id];
    const R = a.recording || {}, fmt = R.sampleRate ? `${R.sampleRate / 1000} kHz · ${R.bits || 24}-bit${R.float ? ' float' : ''} WAV${R.mode ? ' · ' + MODE_NAMES[R.mode] : ''}` : 'WAV';
    lastTake.value = { fmt, clipped: r.clipped || 0, effectiveBits: r.effectiveBits, bits: R.bits, float: R.float, limited: capture?.settings?.capability?.limited };
    toast(`${s.retakeOf ? 'New take' : 'Recording'} saved · ${shortTime(dur)} · ${fmt}${r.clipped ? ` · ${r.clipped} clipped samples — lower your input level` : ''}`, r.clipped ? 'warn' : 'info');
    if (r.interrupted) toast(`${r.interrupted} Everything recorded up to that moment was kept.`, 'warn', { timeout: 9000 });
    if (project.value.settings.ducking?.on) applyDucking();
    return true;
  } catch (e) { toast('The recording could not be saved: ' + e.message, 'error'); return false; }
  finally { recState.value = 'idle'; session = null; endLiveTake(); if (capture?.settings) capInfo.value = { ...capture.settings, engine: capture.engine || 'browser' }; }
}
export function cleanVoice(ids) {
  const p = project.value; const target = ids || (selection.value.length ? selection.value : lastRecording.value ? [lastRecording.value] : []);
  const list = p.clips.filter(c => target.includes(c.id) && (c.kind === 'audio' || c.kind === 'video'));
  if (!list.length) return toast('Select a recording or audio clip to clean up.', 'warn');
  const id = prefs.value.cleanProfile || 'clean';
  commit('Clean voice', d => { for (const c of d.clips) if (list.some(x => x.id === c.id)) c.audioFx = profileFx(id, prefs.value.audioProfiles || []); });
  toast(`Clean Voice applied to ${list.length} clip${list.length > 1 ? 's' : ''}. Use “Compare” in the Audio inspector to hear the original.`);
}

// ---------- Mixing: Auto Balance and Ducking ----------
const voiceClips = p => p.clips.filter(c => (c.kind === 'audio' || c.kind === 'video') && trackOf(p, c.trackId)?.voice && !c.muted);
const backgroundClips = p => p.clips.filter(c => (c.kind === 'audio' || (c.kind === 'video' && asset(c.mediaId)?.audio)) && !trackOf(p, c.trackId)?.voice && !c.muted);
export async function autoBalance(onProgress) {
  const p = project.value; const voices = voiceClips(p), bgs = backgroundClips(p);
  const all = [...voices.map(c => [c, p.settings.mix?.voiceTarget ?? -16]), ...bgs.map(c => [c, voices.length ? p.settings.mix?.musicTarget ?? -26 : -16])];
  if (!all.length) return toast('Add some audio first.', 'warn');
  const gains = {};
  for (let i = 0; i < all.length; i++) {
    const [c, target] = all[i]; onProgress?.((i + 0.5) / all.length);
    try { const r = await api('/api/tools/loudness', { mediaId: c.mediaId, from: c.in, to: c.in + c.duration * (c.speed || 1), clip: c }); if (r.lufs !== null) { let g = Math.pow(10, (target - r.lufs) / 20); if (r.peak !== null && Number.isFinite(r.peak)) g = Math.min(g, Math.pow(10, (-1 - r.peak) / 20) * 2); gains[c.id] = Math.max(0.05, Math.min(4, g)); } } catch {}
  }
  commit('Auto balance', d => { for (const c of d.clips) if (gains[c.id]) c.volume = +gains[c.id].toFixed(3); });
  toast(`Balanced ${Object.keys(gains).length} clip${Object.keys(gains).length === 1 ? '' : 's'}: voices at ${p.settings.mix?.voiceTarget ?? -16} LUFS${voices.length && bgs.length ? `, background at ${p.settings.mix?.musicTarget ?? -26} LUFS` : ''}.`);
}
// Speech intervals (timeline seconds) of the given voice clips.
async function voiceSpeech(voices, { minSilence = 0.35 } = {}) {
  const speech = [];
  for (const v of voices) {
    try { const r = await api('/api/tools/speech', { mediaId: v.mediaId, from: v.in, to: v.in + v.duration * (v.speed || 1), threshold: -42, minSilence }); for (const s of r.speech) { const a = v.start + (s.start - v.in) / (v.speed || 1), b = v.start + (s.end - v.in) / (v.speed || 1); if (b > v.start && a < clipEnd(v)) speech.push({ start: Math.max(v.start, a), end: Math.min(clipEnd(v), b) }); } } catch {}
  }
  return speech.sort((a, b) => a.start - b.start);
}
// Turn the script into captions timed to the recorded voice (pause-based estimate).
export async function scriptToCaptions() {
  const p = project.value, text = p.script?.text || '';
  if (!text.trim()) return toast('Write or import a script first.', 'warn');
  const sel = selection.value.map(id => p.clips.find(c => c.id === id)).filter(c => c && trackOf(p, c.trackId)?.voice);
  const voices = sel.length ? sel : voiceClips(p);
  if (!voices.length) return toast('Record your voiceover first — captions are timed to your voice.', 'warn');
  const speech = await voiceSpeech(voices, { minSilence: 0.25 });
  if (!speech.length) return toast('No speech was detected in the voice track.', 'warn');
  const range = [Math.min(...voices.map(v => v.start)), Math.max(...voices.map(clipEnd))];
  const segs = alignScript(text, speech, { span: range });
  if (!segs.length) return toast('Could not time the script to this recording.', 'warn');
  insertCaptions(segs, { replaceRange: range });
  toast(`Added ${segs.length} captions from your script, timed to your pauses. Check them on the Captions track — for word-exact timing use Auto captions.`);
  return segs;
}
export async function applyDucking() {
  const p = project.value; const d0 = { on: true, amount: -12, speed: 'normal', ...(p.settings.ducking || {}) };
  const voices = voiceClips(p); if (!voices.length) { toast('Ducking needs a voice track. Record a voiceover, or right-click an audio track and mark it as a voice track.', 'warn'); return; }
  const speech = await voiceSpeech(voices);
  const timing = { fast: { attack: 0.12, release: 0.35 }, normal: { attack: 0.25, release: 0.6 }, slow: { attack: 0.5, release: 1.2 } }[d0.speed] || { attack: 0.25, release: 0.6 };
  commit('Auto ducking', d => { d.settings.ducking = d0; for (const c of backgroundClips(d)) c.duckKeys = duckKeys(c, speech, { amount: d0.amount, ...timing }); });
  toast(`Background audio now dips ${Math.abs(d0.amount)} dB while you speak.`);
}
export function clearDucking() { commit('Turn off ducking', d => { d.settings.ducking = { ...(d.settings.ducking || {}), on: false }; for (const c of d.clips) c.duckKeys = null; }); }

// ---------- UI ----------
function DeviceButton({ kind }) {
  const list = kind === 'input' ? devices.value.inputs : devices.value.outputs;
  const id = kind === 'input' ? prefs.value.audioInput || 'default' : activeOutput.value;
  const label = deviceLabel(list, id); const Icon = kind === 'input' ? Mic : ICONS[iconFor(label)];
  const favs = prefs.value[kind === 'input' ? 'favInputs' : 'quickSwap'] || [];
  const pick = async e => {
    await ensurePermission(); const l = kind === 'input' ? devices.value.inputs : devices.value.outputs;
    openMenu(e, [{ label: kind === 'input' ? 'Microphone' : 'Play sound through' },
      ...l.filter(d => !d.isComms).sort((a, b) => (favs.includes(b.id) ? 1 : 0) - (favs.includes(a.id) ? 1 : 0)).map(d => ({ text: (favs.includes(d.id) ? '★ ' : '') + d.label.replace(/^Default - /, 'Windows default · '), checked: d.id === id, onClick: async () => {
        if (kind === 'input') { if (recState.value === 'rec') return toast('The microphone is locked while recording.', 'warn'); await savePrefs({ audioInput: d.id }); try { await getCapture(d.id); toast('Microphone: ' + d.label.replace(/^Default - /, '')); } catch (err) { toast('That microphone is unavailable: ' + err.message, 'error'); } }
        else await setOutput(d.id);
      } })),
      { divider: true },
      { text: favs.includes(id) ? 'Unpin current device' : 'Pin current device as favorite', icon: favs.includes(id) ? PinOff : Pin, onClick: () => savePrefs({ [kind === 'input' ? 'favInputs' : 'quickSwap']: favs.includes(id) ? favs.filter(x => x !== id) : [...favs, id].slice(-2) }) },
      kind === 'output' && { text: 'Play test sound', icon: Volume2, onClick: () => testSpeaker(id) },
      kind === 'output' && favs.length >= 2 && { text: 'Quick swap between favorites', icon: Repeat, onClick: quickSwap },
    ]);
  };
  return <button class="device-btn" onClick={pick} data-tip={kind === 'input' ? 'Choose microphone' : 'Choose speakers or headphones'} disabled={kind === 'input' && recState.value === 'rec'}><Icon size={15} /><span class="ellipsis">{label}</span><ChevronDown size={13} /></button>;
}
export function DeviceBar() { useEffect(() => { refreshDevices(); }, []); return <div class="device-bar"><DeviceButton kind="output" /></div>; }

function Meter() {
  const m = meter.value; const [hold, setHold] = useState({ v: -60, t: 0 }); const [clipHold, setClipHold] = useState(-1e9);
  const pct = d => Math.max(0, Math.min(100, (d + 60) / 60 * 100));
  useEffect(() => { const now = performance.now(); if (m.peakDb > hold.v || now - hold.t > 1500) setHold({ v: Number.isFinite(m.peakDb) ? m.peakDb : -60, t: now }); if (m.clip) setClipHold(now); }, [m]);
  const clipping = performance.now() - clipHold < 2000;
  return <div class="meter" role="meter" aria-label="Input level" aria-valuenow={Math.round(m.peakDb)}>
    <div class="meter-bar"><div class="rms" style={{ width: pct(m.rmsDb) + '%' }} /><div class="peak" style={{ width: pct(m.peakDb) + '%' }} /><div class="hold" style={{ left: pct(hold.v) + '%' }} /><span class="tick" style={{ left: pct(-18) + '%' }} /><span class="tick" style={{ left: pct(-6) + '%' }} /></div>
    <span class={`clip-led ${clipping ? 'on' : ''}`} data-tip="Lights up when the input clips">CLIP</span>
    <span class="mono db">{Number.isFinite(m.peakDb) ? m.peakDb.toFixed(0) : '−∞'} dB</span>
  </div>;
}
// Input format, hardware gain and automatic level setting.
function InputPanel() {
  const s = capInfo.value; const [busy, setBusy] = useState(null); const [gain, setGainState] = useState(null);
  const q = useRef({ pending: null, inflight: false });
  const g = gain ?? s?.gain;
  if (!s) return null;
  const native = s.engine === 'native';
  const setGain = async v => {
    setGainState({ ...(g || {}), db: v }); q.current.pending = v; if (q.current.inflight) return; q.current.inflight = true;
    try { while (q.current.pending !== null) { const x = q.current.pending; q.current.pending = null; const r = await capture.setGain(x); if (q.current.pending === null) setGainState(r); } }
    catch (e) { toast('Could not set the input level: ' + e.message, 'error'); } finally { q.current.inflight = false; }
  };
  const autoLevel = async () => {
    setBusy('auto');
    try {
      let cur = g?.db ?? 0; const target = -10;
      for (let pass = 0; pass < 3; pass++) {
        toast(pass ? 'Once more — keep speaking…' : 'Speak at your normal recording volume for a few seconds…', 'info', { timeout: 3000 });
        const peaks = []; const prev = capture.onMeter; capture.onMeter = m => { prev?.(m); if (Number.isFinite(m.peakDb)) peaks.push(m.peakDb); };
        await new Promise(r => setTimeout(r, 3000)); capture.onMeter = prev;
        const loud = peaks.sort((a, b) => b - a)[Math.floor(peaks.length * 0.03)] ?? -Infinity;
        if (!(loud > -50)) { toast('No speech was detected. Check the microphone and try again.', 'warn'); return; }
        const delta = target - loud; if (Math.abs(delta) < 2) { toast(`Level set: your voice peaks around ${loud.toFixed(0)} dB, with headroom for louder moments.`); return; }
        const next = Math.max(g.min, Math.min(g.max, cur + delta));
        if (Math.abs(next - cur) < 0.1) { toast(delta > 0 ? 'The input is already at maximum. Turn up the gain knob on your microphone or interface, or move closer.' : 'The input is already at minimum. Turn down the gain on your microphone or interface.', 'warn'); return; }
        const r = await capture.setGain(next); setGainState(r); cur = r.db;
      }
      toast('Level adjusted. Check the meter while you speak — peaks around −10 dB are ideal.');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };
  const t = lastTake.value;
  return <div class="input-panel">
    <div class="input-fmt"><span class={`chip ${native ? 'accent' : ''}`}>{native ? MODE_NAMES[s.mode] || 'Direct' : 'Compatible'}</span><span class="muted mono">{s.sampleRate ? s.sampleRate / 1000 + ' kHz' : ''}{s.sampleSize ? ` · ${s.sampleSize}-bit` : ''}{s.channels ? ` · ${s.channels === 1 ? 'mono' : 'stereo'}` : ''}</span></div>
    {s.capability?.limited && <div class="check warn"><TriangleAlert size={13} /><span>{s.capability.note}</span></div>}
    {native && g && <>
      <Slider label={`Input gain${g.hardware ? ' (device)' : ' (driver)'}`} min={g.min} max={g.max} step={Math.max(0.1, g.step || 0.5)} value={g.db} unit=" dB" disabled={recState.value === 'rec'} onChange={setGain} />
      <button class="btn sm" disabled={!!busy || recState.value !== 'idle'} onClick={autoLevel} data-tip="Listens while you speak and sets the input gain so peaks land around −10 dB">{busy === 'auto' ? <LoaderCircle size={13} class="spin" /> : <Activity size={13} />}Set level for me</button>
    </>}
    {!native && <p class="muted hint">Standard recording can’t change the input level — set it in Windows sound settings, or switch to Pro in Recording options.</p>}
    {t && <div class="muted hint last-take">Last take: {t.fmt}{t.clipped ? ` · ${t.clipped} clipped samples` : ' · no clipping'}{t.effectiveBits && !t.float && t.bits && t.effectiveBits < t.bits - 4 ? ` · the device only sends ${t.effectiveBits}-bit detail` : ''}</div>}
  </div>;
}
function MicCheck() {
  const [res, setRes] = useState(null), [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { const c = await getCapture(prefs.value.audioInput); setRes(await micCheck(c, 3)); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } };
  const Row = ({ ok, warn, text }) => <div class={`check ${ok ? 'ok' : warn ? 'warn' : 'bad'}`}>{ok ? <Check size={13} /> : <TriangleAlert size={13} />}<span>{text}</span></div>;
  return <div class="mic-check">
    <button class="btn sm" disabled={busy} onClick={run}>{busy ? <><LoaderCircle size={13} class="spin" />Listening… speak normally</> : <><Activity size={13} />Check microphone</>}</button>
    {res && <div class="checks">
      <Row ok={res.connected} text={res.connected ? 'Microphone connected' : 'No microphone signal path'} />
      <Row ok={res.detected} text={res.detected ? 'Sound detected' : 'No sound detected — is the mic muted?'} />
      <Row ok={res.level === 'good'} warn={res.level === 'quiet'} text={{ good: `Level is good (peaks ${res.peakDb.toFixed(0)} dB)`, quiet: `A bit quiet (peaks ${res.peakDb.toFixed(0)} dB) — move closer or raise the input level in Windows`, 'very-quiet': 'Very quiet — raise the microphone level in Windows sound settings', 'too-loud': 'Too loud — peaks are at the limit; lower the input level' }[res.level]} />
      <Row ok={!res.clip} text={res.clip ? 'Clipping detected' : 'No clipping'} />
      <Row ok={!res.noisy} warn={res.noisy} text={res.noisy ? `Background noise is noticeable (${res.floorDb.toFixed(0)} dB floor). Try Noise Reduction after recording.` : `Quiet background (${Number.isFinite(res.floorDb) ? res.floorDb.toFixed(0) : '−∞'} dB floor)`} />
      <div class="muted fmt">{res.format} · voice processing {Object.values(res.processing).some(Boolean) ? 'partially on (driver)' : 'off'}</div>
    </div>}
  </div>;
}

function Script() {
  const p = project.value; const sc = { text: '', size: 30, speed: 1, autoscroll: false, focus: true, ...(p.script || {}) };
  const [edit, setEdit] = useState(!sc.text); const box = useRef(); const [line, setLine] = useState(0);
  const save = patch => commit('Edit script', d => { d.script = { ...sc, ...patch }; }, { key: 'script' });
  const lines = sc.text.split(/\n+/).filter(Boolean);
  // Auto-scroll at a reading pace while recording/playing.
  useEffect(() => {
    if (!sc.autoscroll || edit) return; let raf, last = performance.now();
    const tick = now => { const el = box.current; if (el && (recState.value === 'rec' || playing.value)) { el.scrollTop += (now - last) / 1000 * 22 * sc.speed; const items = [...el.querySelectorAll('.sline')]; const mid = el.scrollTop + el.clientHeight * 0.35; const idx = items.findIndex(x => x.offsetTop + x.offsetHeight > mid); if (idx >= 0 && idx !== line) setLine(idx); } last = now; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [sc.autoscroll, sc.speed, edit, line]);
  const importText = async () => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.txt,.md,.markdown'; input.onchange = async () => { const t = (await input.files[0].text()).replace(/^#+\s*/gm, '').replace(/[*_`>]/g, ''); save({ text: t }); setEdit(false); }; input.click(); };
  return <div class="script">
    <div class="row script-head"><b class="grow">Script</b>
      <button class="btn ghost sm" onClick={() => setEdit(!edit)}>{edit ? 'Read' : 'Edit'}</button>
      <button class="btn ghost sm" onClick={importText} data-tip="Import a .txt or .md file">Import</button>
      <button class="icon-btn sm" onClick={() => (scriptVisible.value = false)} aria-label="Hide script"><X size={14} /></button></div>
    {edit ? <textarea class="input script-edit" placeholder="Paste or write your script here. It’s saved with the project and never appears in your video." value={sc.text} onInput={e => save({ text: e.target.value })} />
      : !lines.length ? <p class="muted">No script yet. <button class="btn sm" onClick={() => setEdit(true)}>Write one</button></p>
      : <div class={`script-read ${sc.focus ? 'focus' : ''}`} ref={box} style={{ fontSize: sc.size + 'px' }}>{lines.map((l, i) => <p key={i} class={`sline ${i === line ? 'on' : ''}`} onClick={() => setLine(i)}>{l}</p>)}<div style={{ height: '60%' }} /></div>}
    {!edit && lines.length > 0 && <div class="script-opts">
      <Slider label="Text size" min={16} max={64} step={1} value={sc.size} def={30} unit="px" onChange={v => save({ size: v })} />
      <div class="row"><Toggle label="Auto-scroll" on={sc.autoscroll} onChange={v => save({ autoscroll: v })} /><Toggle label="Focus line" on={sc.focus} onChange={v => save({ focus: v })} /></div>
      {sc.autoscroll && <Slider label="Scroll speed" min={0.3} max={3} step={0.05} value={sc.speed} def={1} unit="×" onChange={v => save({ speed: v })} />}
      <button class="btn sm" onClick={scriptToCaptions} data-tip="Adds the script as captions timed to your recorded voice"><Captions size={13} />Captions from script</button>
      <div class="muted hint">~{Math.round(sc.text.split(/\s+/).filter(Boolean).length / 150 * 60)} s at a natural pace · progress {lines.length ? Math.round((line + 1) / lines.length * 100) : 0}%</div>
    </div>}
  </div>;
}

export function StudioPanel() {
  const o = opts(); const st = recState.value; const p = project.value; const [mixBusy, setMixBusy] = useState(null);
  useEffect(() => { getCapture(prefs.value.audioInput).then(() => refreshDevices()).catch(e => toast('Microphone unavailable: ' + e.message + '. Check that one is connected and allowed in Windows privacy settings.', 'warn')); refreshDevices(); }, []);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (st !== 'rec') return; const i = setInterval(() => setElapsed((performance.now() - (session?.started || performance.now())) / 1000), 100); return () => clearInterval(i); }, [st]);
  const last = lastRecording.value && p.clips.find(c => c.id === lastRecording.value);
  const duck = p.settings.ducking || { on: false, amount: -12, speed: 'normal' };
  return <div class="studio">
    <div class="studio-head"><Mic size={16} class="accentc" /><b class="grow">Audio studio</b>
      <button class={`icon-btn sm ${focusMode.value ? 'on' : ''}`} data-tip="Recording focus mode" onClick={() => (focusMode.value = !focusMode.value)}><Focus size={15} /></button>
      <button class="icon-btn sm" data-tip="Close studio" onClick={closeStudio}><X size={15} /></button></div>
    <div class="studio-body">
      <div class="devices"><DeviceButton kind="input" /><DeviceButton kind="output" /></div>
      <Meter />
      <InputPanel />
      <div class="rec-actions">
        {st === 'rec' ? <button class="rec-btn stop" onClick={stopRecording} data-tip="Stop" data-kbd="R"><Square size={18} fill="currentColor" /><span>Stop · {shortTime(elapsed)}</span></button>
          : st === 'count' ? <button class="rec-btn count" onClick={stopRecording}><b>{countdown.value}</b><span>Cancel</span></button>
          : st === 'saving' ? <button class="rec-btn" disabled><LoaderCircle size={18} class="spin" /><span>Saving…</span></button>
          : <button class="rec-btn" onClick={() => startRecording()} data-tip="Record at the playhead" data-kbd="R"><span class="dot" /><span>Record</span></button>}
        <div class="rec-secondary">
          <button class="btn sm" disabled={st !== 'idle' || !last} onClick={() => startRecording({ retake: true })} data-tip="Record a new take in the same place — the old take is kept" data-kbd="Shift+R"><RotateCcw size={13} />Retake</button>
          <button class={`btn sm ${scriptVisible.value ? 'primary' : ''}`} onClick={() => (scriptVisible.value = !scriptVisible.value)}><FileText size={13} />Script</button>
          <button class="btn sm" disabled={st !== 'idle'} onClick={() => cleanVoice()} data-tip="Apply your Clean Voice profile to the selected recording"><Wand2 size={13} />Clean voice</button>
          {st === 'rec' && <button class="btn sm" onClick={markMistake} data-kbd="M"><Flag size={13} />Mark mistake</button>}
        </div>
      </div>
      {st === 'rec' && <div class="rec-note"><span class="rec-dot" />Recording{session?.playing ? ' over your video' : ''} · press <span class="kbd">M</span> to mark a mistake</div>}
      {scriptVisible.value && !focusMode.value && <Script />}
      <Section title="Recording options" open={false}>
        <Toggle label="Play the video while recording" on={o.playVideo} onChange={v => setOpt({ playVideo: v })} />
        <Toggle label="3-second countdown" on={o.countdown} onChange={v => setOpt({ countdown: v })} />
        {o.playVideo && <Slider label="Pre-roll" min={0} max={5} step={0.5} value={o.preroll} def={0} unit=" s" onChange={v => setOpt({ preroll: v })} />}
        {o.playVideo && <SyncOffset />}
        <Toggle label="Trim silence at start and end" on={o.trimSilence} onChange={v => setOpt({ trimSilence: v })} hint="Only the very beginning and end — pauses inside your take are kept" />
        <Toggle label="Hear yourself (monitoring)" on={o.monitor} onChange={v => { if (v && isSpeaker(deviceLabel(devices.value.outputs, activeOutput.value))) toast('Monitoring through speakers can cause feedback. Use headphones.', 'warn'); setOpt({ monitor: v }); capture?.setMonitor(v && recState.value === 'rec', activeOutput.value); }} />
        <div class="field"><label>Profile for new recordings</label><Select value={prefs.value.recordingProfile || 'original'} options={[...AUDIO_PROFILES, ...(prefs.value.audioProfiles || [])].map(x => [x.id, x.name])} onChange={v => savePrefs({ recordingProfile: v })} /></div>
        <MicCheck />
        <div class="field"><label>Recording engine</label><Segmented value={o.engine || 'pro'} options={[['pro', 'Direct (best quality)'], ['browser', 'Compatible']]} onChange={async v => { if (recState.value === 'rec') return; await setOpt({ engine: v }); nativeOk = null; try { await getCapture(prefs.value.audioInput); } catch (e) { toast(e.message, 'error'); } }} />
          <small class="muted">Direct records straight from the Windows audio driver: bit-perfect where the microphone allows it, otherwise with no driver effects. Use Compatible only if Direct can’t open your microphone. Both are free and save uncompressed WAV.</small></div>
        <p class="muted hint">Recordings are saved uncompressed as WAV with all Windows voice processing off.</p>
      </Section>
      <Section title="Mix" open>
        <button class="btn block" disabled={!!mixBusy} onClick={async () => { setMixBusy('bal'); try { await autoBalance(); } finally { setMixBusy(null); } }}>{mixBusy === 'bal' ? <LoaderCircle size={14} class="spin" /> : <Scale size={14} />}Auto balance levels</button>
        <Toggle label="Lower music while speaking (ducking)" on={duck.on} onChange={async v => { setMixBusy('duck'); try { v ? await applyDucking() : clearDucking(); } finally { setMixBusy(null); } }} />
        {duck.on && <><Slider label="Strength" min={-30} max={-3} step={1} value={duck.amount} def={-12} unit=" dB" onChange={v => commit('Ducking strength', d => { d.settings.ducking = { ...duck, amount: v }; }, { key: 'duckamt' })} />
          <div class="field"><Segmented value={duck.speed} options={[['fast', 'Fast'], ['normal', 'Natural'], ['slow', 'Slow']]} onChange={v => commit('Ducking speed', d => { d.settings.ducking = { ...duck, speed: v }; })} /></div>
          <button class="btn sm" onClick={applyDucking}><Waves size={13} />Update ducking</button></>}
      </Section>
      <div class="muted hint shortcuts"><span class="kbd">R</span> record / stop · <span class="kbd">Shift+R</span> retake · <span class="kbd">M</span> mark mistake · <span class="kbd">Space</span> play</div>
    </div>
  </div>;
}
export function FocusScript() { return scriptVisible.value ? <div class="focus-script"><Script /></div> : null; }
export const studioKeys = e => {
  if (!studioOpen.value) return false;
  const live = recState.value !== 'idle';
  // A held key auto-repeats: R must not start and immediately stop a take.
  if (e.repeat && (e.key === 'r' || e.key === 'R' || (live && e.key === ' '))) return true;
  // The take is placed assuming the video plays continuously; pausing it with Space mid-take would put
  // everything after the pause out of sync, so Space does nothing while recording.
  if (e.key === ' ' && live) { if (recState.value === 'rec') toast('Press R or Esc to stop recording.', 'info', { timeout: 1800 }); return true; }
  if (e.key === 'r' || e.key === 'R') { if (e.shiftKey) startRecording({ retake: true }); else recState.value === 'rec' || recState.value === 'count' ? stopRecording() : startRecording(); return true; }
  if ((e.key === 'm' || e.key === 'M') && recState.value === 'rec') { markMistake(); return true; }
  if (e.key === 'Escape' && (recState.value === 'rec' || recState.value === 'count')) { stopRecording(); return true; }
  return false;
};
