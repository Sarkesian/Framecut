// Microphone capture with all browser voice processing disabled. Raw samples stream to the
// FrameCut service, which writes 24-bit WAV directly to disk while you record.
import { api } from '../lib/api.js';
import workletUrl from './capture-worklet.js?url&no-inline';

const db = v => (v > 0 ? 20 * Math.log10(v) : -Infinity);
export class Capture {
  constructor({ onMeter } = {}) { this.onMeter = onMeter; this.queue = Promise.resolve(); this.recId = null; this.bytes = 0; this.error = null; }
  async open(deviceId) {
    this.close();
    const constraints = { audio: { deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 24 }, channelCount: { ideal: 2 } } };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    const track = this.stream.getAudioTracks()[0]; this.track = track;
    const s = track.getSettings();
    this.settings = { sampleSize: s.sampleSize || null, sampleRate: s.sampleRate || 48000, channels: Math.min(2, s.channelCount || 1), latency: s.latency || 0, label: track.label, deviceId: s.deviceId, echoCancellation: s.echoCancellation, noiseSuppression: s.noiseSuppression, autoGainControl: s.autoGainControl };
    this.ctx = new AudioContext({ sampleRate: this.settings.sampleRate, latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(workletUrl);
    await this.ctx.resume().catch(() => {});
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'framecut-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: this.settings.channels, channelCountMode: 'explicit' });
    this.sink = this.ctx.createGain(); this.sink.gain.value = 0; this.node.connect(this.sink).connect(this.ctx.destination); // keeps the worklet running
    this.source.connect(this.node);
    this.monitorGain = this.ctx.createGain(); this.monitorGain.gain.value = 0; this.source.connect(this.monitorGain).connect(this.ctx.destination);
    this.node.port.onmessage = ({ data }) => {
      if (data.type === 'meter') { this.lastMeter = data; this.onMeter?.({ peakDb: db(data.peak), rmsDb: db(data.rms), clip: data.clip, channels: data.channels, wave: data.wave }); }
      if (data.type === 'pcm' && this.recId) { const id = this.recId; const body = data.data; this.bytes += body.byteLength; this.queue = this.queue.then(() => fetch(`/api/record/${id}/chunk`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body }).then(r => { if (!r.ok) throw Error('The recording could not be written to disk.'); })).catch(e => { this.error = e; }); }
      if (data.type === 'started') this._started?.(data);
      if (data.type === 'stopped') this._stopped?.();
    };
    track.addEventListener('ended', () => this.onEnded?.());
    return this.settings;
  }
  async setMonitor(on, sinkId) { if (!this.ctx) return; if (this.ctx.setSinkId && sinkId !== undefined) await this.ctx.setSinkId(sinkId === 'default' ? '' : sinkId).catch(() => {}); this.monitorGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02); }
  // Total input→speaker delay to compensate when recording over playback.
  latency(outputCtx) { return (this.ctx?.baseLatency || 0) + (this.settings?.latency || 0) + (outputCtx?.outputLatency || outputCtx?.baseLatency || 0); }
  async start({ name }) {
    this.error = null; this.bytes = 0;
    const { id } = await api('/api/record/start', { sampleRate: this.settings.sampleRate, channels: this.settings.channels, name, device: this.settings.label });
    this.recId = id; await this.ctx.resume();
    const started = new Promise(r => (this._started = r)); this.node.port.postMessage('start');
    const info = await started; this.startPerf = performance.now(); return info;
  }
  async stop({ discard = false } = {}) {
    if (!this.recId) return null;
    const stopped = new Promise(r => (this._stopped = r)); this.node.port.postMessage('stop'); await stopped;
    await this.queue; const id = this.recId; this.recId = null;
    if (discard) { await api('/api/record/' + id, undefined, 'DELETE'); return null; }
    if (this.error) { await api(`/api/record/${id}/finish`, {}).catch(() => {}); throw this.error; }
    return api(`/api/record/${id}/finish`, {});
  }
  get recording() { return !!this.recId; }
  close() { try { this.node?.disconnect(); this.source?.disconnect(); this.stream?.getTracks().forEach(t => t.stop()); this.ctx?.close(); } catch {} this.node = this.stream = this.ctx = null; }
}

// Microphone check: listens for a few seconds and reports measured levels.
export async function micCheck(capture, seconds = 3) {
  const peaks = [], rms = []; let clip = false;
  const prev = capture.onMeter;
  await new Promise(resolve => { capture.onMeter = m => { prev?.(m); peaks.push(m.peakDb); rms.push(m.rmsDb); clip ||= m.clip; }; setTimeout(resolve, seconds * 1000); });
  capture.onMeter = prev;
  const finite = rms.filter(Number.isFinite).sort((a, b) => a - b);
  const peak = Math.max(...peaks.filter(Number.isFinite), -Infinity), floor = finite.length ? finite[Math.floor(finite.length * 0.1)] : -Infinity;
  return {
    connected: !!capture.track && capture.track.readyState === 'live',
    detected: peak > -55, peakDb: peak, floorDb: floor, clip,
    level: peak > -0.5 ? 'too-loud' : peak > -18 ? 'good' : peak > -30 ? 'quiet' : 'very-quiet',
    noisy: floor > -50,
    processing: { echoCancellation: capture.settings.echoCancellation, noiseSuppression: capture.settings.noiseSuppression, autoGainControl: capture.settings.autoGainControl },
    format: capture.engine === 'native' ? `${{ exclusive: 'Exclusive (bit-perfect)', raw: 'Raw (no driver effects)', shared: 'Shared' }[capture.settings.mode] || 'Pro'} · ${capture.settings.sampleRate / 1000} kHz / ${capture.settings.sampleSize}-bit ${capture.settings.channels === 1 ? 'mono' : 'stereo'} · saved as WAV without conversion` : `Device delivers ${capture.settings.sampleRate / 1000} kHz${capture.settings.sampleSize ? ` / ${capture.settings.sampleSize}-bit` : ""} ${capture.settings.channels === 1 ? "mono" : "stereo"} · saved losslessly as 24-bit WAV`,
  };
}
