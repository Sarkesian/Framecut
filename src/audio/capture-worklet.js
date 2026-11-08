// AudioWorklet: copies raw microphone samples (float32, no processing) to the main thread,
// and reports peak / RMS levels for metering.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.recording = false; this.buf = []; this.frames = 0; this.peak = 0; this.sum = 0; this.n = 0; this.clip = false; this.lastMeter = 0;
    this.port.onmessage = e => { if (e.data === 'start') { this.recording = true; this.startFrame = currentFrame; this.port.postMessage({ type: 'started', frame: currentFrame, time: currentTime }); } if (e.data === 'stop') { this.flush(); this.recording = false; this.port.postMessage({ type: 'stopped' }); } };
  }
  flush() { if (!this.buf.length) return; const total = this.buf.reduce((s, b) => s + b.length, 0); const out = new Float32Array(total); let o = 0; for (const b of this.buf) { out.set(b, o); o += b.length; } this.buf = []; this.frames = 0; this.port.postMessage({ type: 'pcm', data: out }, [out.buffer]); }
  process(inputs) {
    const input = inputs[0]; if (!input || !input.length) return true;
    const ch = input.length, len = input[0].length;
    for (let c = 0; c < ch; c++) { const d = input[c]; for (let i = 0; i < len; i++) { const v = d[i], a = v < 0 ? -v : v; if (a > this.peak) this.peak = a; if (a >= 0.999) this.clip = true; this.sum += v * v; this.n++; } }
    if (this.recording) {
      const inter = new Float32Array(len * ch);
      for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) inter[i * ch + c] = input[c][i];
      this.buf.push(inter); this.frames += len;
      if (this.frames >= sampleRate / 8) this.flush();
    }
    if (currentTime - this.lastMeter > 0.05) { this.port.postMessage({ type: 'meter', peak: this.peak, rms: Math.sqrt(this.sum / Math.max(1, this.n)), clip: this.clip, channels: ch }); this.peak = 0; this.sum = 0; this.n = 0; this.clip = false; this.lastMeter = currentTime; }
    return true;
  }
}
registerProcessor('framecut-capture', CaptureProcessor);
