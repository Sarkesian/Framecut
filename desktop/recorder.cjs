// Streams microphone PCM from the editor straight to disk as 24-bit WAV.
// Samples are appended as they arrive, so a crash loses at most a fraction of a second;
// unfinished takes are recovered on the next launch.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function wavHeader({ sampleRate, channels, bits = 24, dataBytes }) {
  const h = Buffer.alloc(44), blockAlign = channels * bits / 8;
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22); h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * blockAlign, 28); h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(dataBytes, 40); return h;
}
// Float32 interleaved → signed 24-bit little endian (with clipping counted, never wrapped).
function toInt24(f32) {
  const out = Buffer.alloc(f32.length * 3); let clipped = 0, peak = 0;
  for (let i = 0; i < f32.length; i++) {
    let v = f32[i]; const a = Math.abs(v); if (a > peak) peak = a; if (a >= 1) { clipped++; v = v > 0 ? 1 : -1; }
    const n = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388607)));
    out[i * 3] = n & 255; out[i * 3 + 1] = (n >> 8) & 255; out[i * 3 + 2] = (n >> 16) & 255;
  }
  return { buf: out, clipped, peak };
}

class Recorder {
  constructor({ dir, library }) { this.dir = dir; this.library = library; this.sessions = new Map(); }
  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    const recovered = [];
    for (const n of await fsp.readdir(this.dir)) {
      if (!n.endsWith('.rec.json')) continue;
      try { const meta = JSON.parse(await fsp.readFile(path.join(this.dir, n), 'utf8')); const a = await this.finalize(meta, { recovered: true }); if (a) recovered.push(a); } catch {}
    }
    this.recovered = recovered; return recovered;
  }
  async start({ sampleRate = 48000, channels = 1, name = 'Recording', device = '' }) {
    if (!Number.isInteger(+sampleRate) || sampleRate < 8000 || sampleRate > 384000) throw Error('Unsupported sample rate.');
    const id = randomUUID(), base = path.join(this.dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(0, 6)}`);
    const meta = { id, sampleRate: +sampleRate, channels: Math.min(8, Math.max(1, +channels | 0)), name: String(name).slice(0, 80), device: String(device).slice(0, 120), pcm: base + '.pcm', wav: base + '.wav', started: Date.now() };
    await fsp.writeFile(base + '.rec.json', JSON.stringify(meta)); meta.metaFile = base + '.rec.json';
    meta.stream = fs.createWriteStream(meta.pcm, { flags: 'a' }); meta.bytes = 0; meta.clipped = 0; meta.peak = 0;
    this.sessions.set(id, meta); return { id };
  }
  async chunk(id, body) {
    const s = this.sessions.get(id); if (!s) throw Error('That recording is no longer active.');
    const n = Math.floor(body.byteLength / 4);
    // Request bodies may start at any byte offset; Float32Array needs 4-byte alignment.
    const f32 = body.byteOffset % 4 === 0 ? new Float32Array(body.buffer, body.byteOffset, n) : new Float32Array(Uint8Array.prototype.slice.call(body, 0, n * 4).buffer);
    const { buf, clipped, peak } = toInt24(f32); s.clipped += clipped; s.peak = Math.max(s.peak, peak); s.bytes += buf.length;
    await new Promise((res, rej) => s.stream.write(buf, e => (e ? rej(e) : res())));
    return { bytes: s.bytes };
  }
  async finish(id) {
    const s = this.sessions.get(id); if (!s) throw Error('That recording is no longer active.');
    this.sessions.delete(id); await new Promise(r => s.stream.end(r));
    const asset = await this.finalize(s);
    return { asset, clipped: s.clipped, peak: s.peak, seconds: s.bytes / 3 / s.channels / s.sampleRate };
  }
  async discard(id) { const s = this.sessions.get(id); if (!s) return; this.sessions.delete(id); await new Promise(r => s.stream.end(r)); await fsp.rm(s.pcm, { force: true }); await fsp.rm(s.metaFile || s.pcm.replace(/\.pcm$/, '.rec.json'), { force: true }); }
  async finalize(meta, { recovered } = {}) {
    const metaFile = meta.metaFile || meta.pcm.replace(/\.pcm$/, '.rec.json');
    const size = (await fsp.stat(meta.pcm).catch(() => ({ size: 0 }))).size;
    const frame = 3 * meta.channels, dataBytes = size - (size % frame);
    if (dataBytes < frame * 100) { await fsp.rm(meta.pcm, { force: true }); await fsp.rm(metaFile, { force: true }); return null; }
    const out = fs.createWriteStream(meta.wav); out.write(wavHeader({ sampleRate: meta.sampleRate, channels: meta.channels, dataBytes }));
    await new Promise((res, rej) => fs.createReadStream(meta.pcm, { start: 0, end: dataBytes - 1 }).on('error', rej).pipe(out).on('finish', res).on('error', rej));
    await fsp.rm(meta.pcm, { force: true }); await fsp.rm(metaFile, { force: true });
    const a = await this.library.importPath(meta.wav, { name: (recovered ? 'Recovered · ' : '') + meta.name + '.wav', recording: { sampleRate: meta.sampleRate, channels: meta.channels, bits: 24, device: meta.device } });
    return this.library.public(a);
  }
}
module.exports = { Recorder, wavHeader, toInt24 };
