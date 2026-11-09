// Native WASAPI capture through the FrameCut service (same interface as Capture in capture.js).
// Exclusive mode records the converter's own format bit-for-bit; raw mode bypasses driver effects.
// While idle it meters in shared mode so the device is not held exclusively.
import { api } from '../lib/api.js';
import { devices } from './devices.js';

export async function nativeDevices(fresh = false) {
  try { return await api('/api/native-audio/devices' + (fresh ? '?fresh=1' : '')); } catch { return { available: false, devices: [] }; }
}
const labelFor = id => (devices.value.inputs.find(d => d.id === (id || 'default'))?.label || '').replace(/^(Default|Communications) - /, '');

export class NativeCapture {
  constructor({ onMeter } = {}) { this.onMeter = onMeter; this.engine = 'native'; this.meterSession = null; this.recSession = null; this.es = null; }
  async open(deviceId) {
    await this.close(); this.closed = false;
    this.label = labelFor(deviceId); this.deviceId = deviceId || 'default';
    const list = (await nativeDevices(true)).devices || [];
    const dev = list.find(d => d.name === this.label) || list.find(d => this.label && (d.name.includes(this.label) || this.label.includes(d.name))) || list.find(d => d.isDefault);
    if (!dev) throw Error('No microphone was found.');
    this.device = dev;
    await this.meter();
    const best = dev.best || {};
    const ex = best.mode === 'exclusive';
    this.settings = {
      engine: 'native', deviceId: this.deviceId, endpointId: dev.id, label: dev.name, mode: best.mode,
      ...(() => { const f = ex ? { rate: best.rate, bits: best.bits, channels: dev.exclusive.find(x => x.rate === best.rate && x.bits === best.bits)?.channels } : best.mode === 'raw' && dev.rawFormat ? dev.rawFormat : dev.shared || {}; return { sampleRate: f.rate, sampleSize: f.float ? 32 : f.bits, float: !!f.float, channels: f.channels || 1 }; })(),
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, capability: dev.capability, gain: dev.gain, latency: 0,
    };
    return this.settings;
  }
  get track() { return { readyState: this.meterSession || this.recSession ? 'live' : 'ended' }; }
  // Shared-mode metering without writing a file.
  async meter() {
    // Once closed, never start (or keep) a meter: an orphaned shared-mode stream would block the next
    // exclusive-mode take with "device in use".
    if (this.meterSession || this.closed) return;
    const r = await api('/api/native-audio/start', { endpointId: this.device.id, mode: 'shared', file: false });
    if (this.closed || this.meterSession) { await api(`/api/native-audio/${r.session}/stop`, {}).catch(() => {}); return; }
    this.meterSession = r.session; this.listen(r.session);
  }
  async stopMeter() { const id = this.meterSession; if (!id) return; this.meterSession = null; this.es?.close(); this.es = null; await api(`/api/native-audio/${id}/stop`, {}).catch(() => {}); }
  listen(id) {
    this.es?.close(); const es = new EventSource(`/api/native-audio/${id}/events`); this.es = es;
    let clipped = 0;
    es.onmessage = ({ data }) => {
      const ev = JSON.parse(data);
      if (ev.type === 'level') {
        const peak = Math.max(...ev.peak), rms = Math.max(...ev.rms);
        const clip = ev.clipped > clipped; clipped = ev.clipped;
        this.onMeter?.({ peakDb: peak <= -199 ? -Infinity : peak, rmsDb: rms <= -199 ? -Infinity : rms, clip, channels: ev.peak.length, wave: ev.wave, seconds: ev.seconds });
      }
      if (ev.type === 'error') { this.lastError = ev.message; if (id === this.recSession) this.onEnded?.(ev.message); }
      if (ev.type === 'closed') es.close();
    };
  }
  async setMonitor(on) { if (on && !this.monitorWarned) { this.monitorWarned = true; this.onNotice?.('Live monitoring isn’t available with pro recording. Use your interface’s or headset’s direct monitoring — it has zero delay.'); } }
  // Input latency of the device; playback start offset is added via markPlay().
  latency(outputCtx) { return (this.started?.latencyMs || 0) / 1000 + (outputCtx?.outputLatency || outputCtx?.baseLatency || 0); }
  markPlay() { return this.started ? Math.max(0, (Date.now() - this.started.t) / 1000) : 0; }
  async start({ name }) {
    await this.stopMeter();
    try {
      const r = await api('/api/native-audio/start', { endpointId: this.device.id, mode: 'auto', name });
      this.recSession = r.session; this.started = r; this.listen(r.session);
      this.settings = { ...this.settings, mode: r.mode, sampleRate: r.rate, sampleSize: r.fileBits, channels: r.channels };
      return r;
    } catch (e) { await this.meter().catch(() => {}); throw e; }
  }
  async stop({ discard = false } = {}) {
    const id = this.recSession; if (!id) return null; this.recSession = null; this.es?.close(); this.es = null;
    try { return await api(`/api/native-audio/${id}/stop`, { discard }); }
    finally { this.meter().catch(() => {}); }
  }
  get recording() { return !!this.recSession; }
  async setGain(db) { const g = await api('/api/native-audio/gain', { endpointId: this.device.id, db }); this.settings = { ...this.settings, gain: g }; this.device.gain = g; return g; }
  async close() { this.closed = true; this.es?.close(); this.es = null; await this.stopMeter(); }
}
