// Native WASAPI recording through the bundled helper (desktop/bin/framecut-audio.exe):
// exclusive (bit-perfect device format), raw (bypasses driver effects) or shared capture,
// real endpoint input gain, and live levels / waveform streamed to the editor.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const exe = path.join(__dirname, 'bin', 'framecut-audio.exe').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const available = () => process.platform === 'win32' && fs.existsSync(exe);

function once(args, timeout = 15000) {
  return new Promise((resolve, reject) => execFile(exe, args, { windowsHide: true, timeout }, (err, stdout) => {
    const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const e = lines.find(l => l.type === 'error'); if (e) return reject(Object.assign(Error(e.message), { code: e.code }));
    if (err && !lines.length) return reject(Error('The audio helper did not respond.'));
    resolve(lines.at(-1));
  }));
}

// Best capture mode for a device: exclusive when it offers at least the shared quality in a true
// 24-bit (or better) format; otherwise raw (no driver effects); otherwise shared.
function bestMode(dev) {
  const rank = b => (b === 24 ? 3 : b === 32 ? 2 : 1); // true 24-bit first: what real converters deliver
  const ex = (dev.exclusive || []).filter(f => !f.float).sort((a, b) => (rank(b.bits) - rank(a.bits)) || (Math.abs(a.rate - 48000) - Math.abs(b.rate - 48000)) || (b.channels - a.channels));
  const top = ex[0];
  if (top && top.bits >= 24 && top.rate >= 44100) return { mode: 'exclusive', rate: top.rate, bits: top.bits };
  return { mode: dev.raw ? 'raw' : 'shared', rate: 0, bits: 0 };
}
// What the hardware itself can deliver (exclusive formats reveal the real native capability).
function capability(dev) {
  const formats = [...(dev.exclusive || [])];
  const maxRate = Math.max(0, ...formats.map(f => f.rate)), maxBits = Math.max(0, ...formats.map(f => f.float ? 24 : f.bits));
  const limited = formats.length > 0 && maxRate <= 24000;
  return { maxRate: maxRate || null, maxBits: maxBits || null, limited, note: limited ? `This microphone only delivers ${maxRate / 1000} kHz audio (typical of Bluetooth headsets). Recordings will sound like a phone call in any app — use a wired USB microphone or audio interface for studio quality.` : null };
}

class NativeAudio {
  constructor({ dir, library }) { this.dir = dir; this.library = library; this.sessions = new Map(); this.cache = null; }
  get available() { return available(); }
  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    // Takes interrupted by a crash: the helper keeps the WAV header current, so the file is usable.
    const recovered = [];
    for (const n of await fsp.readdir(this.dir).catch(() => [])) {
      if (!n.endsWith('.native.json')) continue;
      try { const meta = JSON.parse(await fsp.readFile(path.join(this.dir, n), 'utf8')); await fsp.rm(path.join(this.dir, n), { force: true }); const st = await fsp.stat(meta.wav).catch(() => null); if (st && st.size > 4096) recovered.push(this.library.public(await this.library.importPath(meta.wav, { name: 'Recovered · ' + meta.name + '.wav', recording: { ...meta.recording, recovered: true } }))); } catch {}
    }
    this.recovered = recovered; return recovered;
  }
  async devices({ fresh = false } = {}) {
    if (!available()) return [];
    if (!fresh && this.cache && Date.now() - this.cache.at < 5000) return this.cache.list;
    const r = await once(['list']); const list = (r.devices || []).map(d => ({ ...d, best: bestMode(d), capability: capability(d) }));
    this.cache = { at: Date.now(), list }; return list;
  }
  async resolve({ endpointId, label }) {
    const list = await this.devices();
    if (endpointId && list.some(d => d.id === endpointId)) return endpointId;
    const clean = s => String(s || '').replace(/^(Default|Communications) - /, '').trim().toLowerCase();
    const hit = label && (list.find(d => clean(d.name) === clean(label)) || list.find(d => clean(d.name).includes(clean(label)) || clean(label).includes(clean(d.name))));
    return hit ? hit.id : 'default';
  }
  async gain({ endpointId, label, db }) {
    const id = await this.resolve({ endpointId, label }); this.cache = null;
    const r = await once(db === undefined || db === null ? ['gain', id] : ['gain', id, String(+db)]); return r.gain;
  }
  // Starts capture. With `file: false` it only meters (mic check, gain staging) and writes nothing.
  async start({ endpointId, label, mode = 'auto', rate = 0, bits = 0, name = 'Recording', file = true }) {
    if (!available()) throw Error('Native recording is not available on this system.');
    for (const s of this.sessions.values()) if (s.file && file) throw Error('A recording is already running.');
    const id = await this.resolve({ endpointId, label });
    if (mode === 'auto') { const dev = (await this.devices()).find(d => d.id === id) || (await this.devices()).find(d => d.isDefault); const b = dev ? dev.best : { mode: 'raw', rate: 0, bits: 0 }; mode = b.mode; rate = b.rate; bits = b.bits; }
    const sid = randomUUID(), base = path.join(this.dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${sid.slice(0, 6)}`);
    const s = { id: sid, file, name: String(name).slice(0, 80), wav: file ? base + '.wav' : null, metaFile: file ? base + '.native.json' : null, events: [], clients: new Set(), wave: [], done: null, error: null, started: null };
    const proc = spawn(exe, ['record', id, mode, String(rate | 0), String(bits | 0), file ? s.wav : '-'], { windowsHide: true });
    s.proc = proc; this.sessions.set(sid, s);
    let buf = '';
    const handle = ev => {
      if (ev.type === 'started') s.started = ev;
      if (ev.type === 'level' && ev.wave?.length) s.wave.push(...ev.wave);
      if (ev.type === 'done') s.done = ev;
      if (ev.type === 'error') s.error = ev;
      const line = `data: ${JSON.stringify(ev)}\n\n`; for (const res of s.clients) res.write(line);
    };
    proc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) try { handle(JSON.parse(l)); } catch {} } });
    s.exited = new Promise(r => proc.on('close', code => { s.code = code; if (!s.done && !s.error) handle({ type: 'error', message: 'The audio helper stopped unexpectedly.' }); handle({ type: 'closed' }); for (const res of s.clients) res.end(); r(); }));
    // Wait until capture is running (or failed).
    await new Promise(resolve => { const t = setInterval(() => { if (s.started || s.error || s.code !== undefined) { clearInterval(t); resolve(); } }, 15); });
    if (!s.started) { this.sessions.delete(sid); throw Object.assign(Error(s.error?.message || 'Recording could not start.'), { code: s.error?.code }); }
    if (file) await fsp.writeFile(s.metaFile, JSON.stringify({ wav: s.wav, name: s.name, recording: this.recordingMeta(s) }));
    return { session: sid, ...s.started };
  }
  recordingMeta(s, extra = {}) {
    const st = s.started || {};
    return { engine: 'wasapi', mode: st.mode, sampleRate: st.rate, channels: st.channels, bits: st.fileBits, float: !!st.float, deviceBits: st.bits, device: st.device, latencyMs: st.latencyMs, ...extra };
  }
  events(sid, res) {
    const s = this.sessions.get(sid); if (!s) { res.status(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(s.started)}\n\n`);
    s.clients.add(res); res.on('close', () => s.clients.delete(res));
  }
  async stop(sid, { discard = false } = {}) {
    const s = this.sessions.get(sid); if (!s) throw Error('That recording is no longer active.');
    try { s.proc.stdin.write('stop\n'); } catch {}
    const timer = setTimeout(() => s.proc.kill(), 5000); await s.exited; clearTimeout(timer); this.sessions.delete(sid);
    if (!s.file) return { done: s.done };
    await fsp.rm(s.metaFile, { force: true });
    if (discard || !s.done || s.done.frames < 100) { await fsp.rm(s.wav, { force: true }); if (!discard && !s.done) throw Error(s.error?.message || 'Nothing was recorded.'); return null; }
    const a = await this.library.importPath(s.wav, { name: s.name + '.wav', recording: this.recordingMeta(s, { effectiveBits: s.done.effectiveBits, clipped: s.done.clipped }) });
    return { asset: this.library.public(a), seconds: s.done.seconds, clipped: s.done.clipped, effectiveBits: s.done.effectiveBits, started: s.started };
  }
  async stopAll() { for (const id of [...this.sessions.keys()]) await this.stop(id, { discard: !this.sessions.get(id).file }).catch(() => {}); }
}
module.exports = { NativeAudio, bestMode, capability };
