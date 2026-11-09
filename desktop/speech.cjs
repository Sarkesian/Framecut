// Local speech engine manager. Spawns desktop/speech/worker.py in its own Python environment (created
// on first use under <data>/engines/speech, or an existing one configured in preferences), keeps it
// warm while you edit, unloads models after 10 idle minutes, and runs one transcription at a time.
//
// Why these models (tests/captions-bench, 18 cases, ~27 min of audio, see tests/captions-bench/README.md):
//   Qwen3-ASR 1.7B + Qwen3-ForcedAligner had the best accuracy on accented conversation, the tightest word
//   timing (~26 ms), and invented no words on music/SFX/silence. The full FrameCut pipeline (speech/music
//   analysis, region-only recognition, checks, Parakeet TDT v3 verification) is the default "Best".
const { spawn, execFile } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { run, ffmpeg } = require('./tools.cjs');
const { renderPlan } = require('./compose.cjs');

const PKGS = ['qwen-asr==0.0.6', 'onnx-asr[cpu,hub]==0.12.0', 'silero-vad', 'soundfile', 'scipy'];
const IDLE_MS = 10 * 60e3;

class Speech {
  constructor({ dataDir, cacheDir, jobs, prefs, library }) {
    this.dataDir = dataDir; this.cacheDir = cacheDir; this.jobs = jobs; this.prefs = prefs; this.library = library;
    this.envDir = path.join(dataDir, 'engines', 'speech'); this.modelsDir = path.join(dataDir, 'engines', 'models');
    this.proc = null; this.pending = new Map(); this.seq = 0; this.idle = null; this.checked = null;
  }
  config() {
    const p = this.prefs().speechEngine || {};
    const python = p.python || path.join(this.envDir, 'Scripts', 'python.exe');
    return { python, hfHome: p.hfHome || this.modelsDir };
  }
  // Is the accurate engine usable? Cached for a minute.
  async status(force = false) {
    if (!force && this.checked && Date.now() - this.checked.at < 60e3) return this.checked.value;
    const { python } = this.config(); let value;
    if (!fs.existsSync(python)) value = { ready: false, name: 'Built-in engine (basic)', setup: 'Install FrameCut’s accurate caption engine once. It runs entirely on this computer and avoids captions being made up from music.', download: await this.downloadSize() };
    else value = await new Promise(resolve => execFile(python, ['-I', '-c', 'import torch, qwen_asr, onnx_asr, silero_vad; print(torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")'], { timeout: 120000, windowsHide: true }, (err, out) => {
      if (err) return resolve({ ready: false, name: 'Built-in engine (basic)', setup: 'The caption engine needs repairing. Run setup again.', download: 'repair' });
      const [cuda, gpu] = String(out).trim().split(/\s+(.*)/);
      resolve({ ready: true, name: 'Qwen3-ASR + ForcedAligner (local)', detail: cuda === 'True' ? `GPU: ${gpu}` : 'CPU (slower)', gpu: cuda === 'True' });
    }));
    this.checked = { at: Date.now(), value }; return value;
  }
  async downloadSize() { return (await hasNvidia()) ? 'about 7 GB, one time' : 'about 4 GB, one time'; }

  // ---------- setup: private Python environment + models ----------
  install() {
    return this.jobs.add({ type: 'speech-install', label: 'Setting up the caption engine', lane: 'heavy' }, async ({ signal, progress }) => {
      const sys = await findPython(); if (!sys) throw Error('Python 3.10 or newer is needed for the accurate caption engine. Install it from python.org (tick “Add to PATH”), then try again.');
      await fsp.mkdir(this.envDir, { recursive: true }); await fsp.mkdir(this.modelsDir, { recursive: true });
      const py = path.join(this.envDir, 'Scripts', 'python.exe');
      if (!fs.existsSync(py)) { progress(0.02, 'Creating a private Python environment…'); await run(sys, ['-m', 'venv', this.envDir], { signal }); }
      const pip = (args, msg, p0, p1) => { progress(p0, msg); return run(py, ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', ...args], { signal, onStdout: d => { const l = String(d).trim().split('\n').at(-1); if (/^(Collecting|Downloading|Installing)/.test(l)) progress(p0 + (p1 - p0) * 0.5, l.slice(0, 90)); } }); };
      const gpu = await hasNvidia();
      await pip(['torch', 'torchaudio', ...(gpu ? ['--index-url', 'https://download.pytorch.org/whl/cu128'] : ['--index-url', 'https://download.pytorch.org/whl/cpu'])], 'Downloading PyTorch' + (gpu ? ' for your NVIDIA GPU…' : '…'), 0.05, 0.45);
      await pip(PKGS, 'Installing the speech models’ code…', 0.45, 0.6);
      progress(0.6, 'Downloading the speech models…');
      await run(py, ['-I', '-c', [
        'from huggingface_hub import snapshot_download as s',
        "for r in ['Qwen/Qwen3-ASR-1.7B','Qwen/Qwen3-ASR-0.6B','Qwen/Qwen3-ForcedAligner-0.6B','MIT/ast-finetuned-audioset-10-10-0.4593','istupakov/parakeet-tdt-0.6b-v3-onnx']: s(r); print('got', r, flush=True)",
      ].join('\n')], { signal, env: { ...process.env, HF_HOME: this.modelsDir }, onStdout: d => { const n = (String(d).match(/got/g) || []).length; if (n) progress(Math.min(0.98, 0.6 + 0.08 * (this._got = (this._got || 0) + n)), 'Downloading the speech models…'); } });
      this.checked = null; this.stop();
      return this.status(true);
    });
  }

  // ---------- worker process ----------
  // The worker connects back over a private localhost socket (never stdin; see worker.py main()).
  start() {
    if (this.proc) return this.proc;
    const { python, hfHome } = this.config();
    let buf = ''; this.err = ''; this.sockReady = new Promise(resolve => { this.sockResolve = resolve; });
    const server = net.createServer(sock => {
      server.close(); this.sock = sock; sock.setEncoding('utf8');
      sock.on('data', onData); sock.on('error', () => {}); this.sockResolve(sock);
    }).listen(0, '127.0.0.1');
    const port = () => server.address()?.port;
    const onData = d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; }
        const p = this.pending.get(m.id); if (!p) continue;
        if (m.type === 'progress') p.onProgress?.(m.progress, m.message);
        else { this.pending.delete(m.id); m.type === 'result' ? p.resolve(m) : p.reject(Object.assign(Error(m.message), { cancelled: !!m.cancelled })); this.touch(); }
      }
    };
    const proc = { kill: () => {} }; this.proc = proc;
    server.once('listening', () => {
      const child = spawn(python, ['-I', path.join(__dirname, 'speech', 'worker.py').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`), '--port', String(port())], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, HF_HOME: hfHome, PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_SYMLINKS_WARNING: '1', TRANSFORMERS_VERBOSITY: 'error' } });
      proc.kill = () => child.kill(); proc.child = child;
      child.stderr.on('data', d => { this.err = (this.err + d).slice(-8000); });
      child.on('exit', code => onExit(code));
    });
    const onExit = code => { server.close(); this.sock = null; if (this.proc === proc) this.proc = null; for (const p of this.pending.values()) p.reject(Error('The caption engine stopped unexpectedly' + (this.err ? ': ' + this.err.trim().split('\n').at(-1) : ` (code ${code}).`))); this.pending.clear(); };
    return proc;
  }
  touch() { clearTimeout(this.idle); this.idle = setTimeout(() => { if (!this.pending.size) this.request({ op: 'unload' }).catch(() => {}); }, IDLE_MS); }
  request(msg, { onProgress, signal } = {}) {
    this.start(); const id = ++this.seq, ready = this.sockReady;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      signal?.addEventListener('abort', () => { ready.then(s => s.write(JSON.stringify({ op: 'cancel', target: id }) + '\n')).catch(() => {}); }, { once: true });
      ready.then(s => s.write(JSON.stringify({ ...msg, id }) + '\n'));
    });
  }
  stop() { if (this.proc) { try { this.proc.kill(); } catch {} this.proc = null; } }

  // ---------- audio for captions: a mix of exactly the chosen clips, in timeline time ----------
  async mixdown(project, clipIds, from, to, signal) {
    const keep = new Set(clipIds);
    const p = JSON.parse(JSON.stringify(project));
    p.clips = p.clips.filter(c => keep.has(c.id)).map(c => ({ ...c, volume: Math.max(0.5, Math.min(1.5, c.volume ?? 1)), duckKeys: null, volumeKeys: null, muted: false }));
    for (const t of p.tracks) { t.muted = false; t.hidden = false; }
    const assets = new Map(); for (const c of p.clips) { const a = this.library.get(c.mediaId); if (!a || a.missing) throw Error(`“${c.name || 'A clip'}” is missing its media file.`); assets.set(c.mediaId, a); }
    const key = createHash('sha1').update(JSON.stringify([p.clips.map(c => [c.mediaId, c.in, c.start, c.duration, c.speed, c.volume, c.audioFx]), from, to, [...assets.values()].map(a => [a.path, a.bytes])])).digest('hex').slice(0, 16);
    const dir = path.join(this.cacheDir, 'captions'); await fsp.mkdir(dir, { recursive: true });
    const out = path.join(dir, `mix-${key}.wav`);
    if (fs.existsSync(out)) return { file: out, key };
    // Leading silence keeps the mix in timeline time: t=0 in the file is t=0 on the timeline.
    const plan = renderPlan(p, { assets, settings: { format: 'wav', range: { from: 0, to } } });
    const work = await fsp.mkdtemp(path.join(dir, 'mix-')); try {
      await fsp.writeFile(path.join(work, 'graph.txt'), plan.graph);
      const args = plan.args.filter((a, i, arr) => !(a === '-progress' || arr[i - 1] === '-progress' || a === '-nostats')).map(a => (a === 'pcm_s16le' ? 'pcm_s16le' : a));
      const tmp = path.join(work, 'mix.wav');
      await run(ffmpeg, [...args.slice(0, args.indexOf('-c:a')), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', tmp], { cwd: work, signal });
      await fsp.rename(tmp, out);
    } finally { await fsp.rm(work, { recursive: true, force: true }).catch(() => {}); }
    return { file: out, key };
  }

  // Transcribe the chosen clips; words come back in timeline seconds (cached per mix + settings).
  transcribe({ project, clipIds, from = 0, to, language = '', quality = 'best', lyrics = true, vocabulary = '' }) {
    return this.jobs.add({ type: 'captions', label: 'Generating captions', lane: 'heavy' }, async ({ signal, progress }) => {
      let last = 0.01; progress(0.01, 'Preparing audio…');
      const st = await this.status(); if (!st.ready) throw Object.assign(Error('The caption engine is not set up yet.'), { code: 'setup' });
      const mix = await this.mixdown(project, clipIds, from, to, signal);
      const ckey = createHash('sha1').update(JSON.stringify([mix.key, language, quality, lyrics, vocabulary, 3])).digest('hex').slice(0, 16);
      const cache = path.join(this.cacheDir, 'captions', `result-${ckey}.json`);
      let r;
      if (fs.existsSync(cache)) r = JSON.parse(await fsp.readFile(cache, 'utf8'));
      else {
        progress(0.03, 'Starting the caption engine…');
        r = await this.request({ op: 'transcribe', audio: mix.file, quality, language, lyrics, vocabulary }, { signal, onProgress: (p, m) => { if (p != null) last = p; progress(last, m); } });
        delete r.id; delete r.type; await fsp.writeFile(cache, JSON.stringify(r));
      }
      const words = r.words.filter(w => w.end > from && w.start < to);
      // Where each word came from (media + source time), so captions can follow later timeline edits.
      for (const w of words) {
        const c = project.clips.find(k => clipIds.includes(k.id) && w.start >= k.start - 0.05 && w.start < k.start + k.duration);
        if (c) w.src = { mediaId: c.mediaId, t: +(c.in + (w.start - c.start) * (c.speed || 1)).toFixed(3) };
      }
      return { ...r, words };
    });
  }
  align({ project, clipIds, from, to, text, language }) {
    return this.jobs.add({ type: 'captions-align', label: 'Re-aligning captions', lane: 'heavy' }, async ({ signal, progress }) => {
      let last = 0.05; const mix = await this.mixdown(project, clipIds, 0, to, signal);
      const part = path.join(this.cacheDir, 'captions', `part-${mix.key}-${Math.round(from * 1000)}-${Math.round(to * 1000)}.wav`);
      if (!fs.existsSync(part)) await run(ffmpeg, ['-y', '-v', 'error', '-ss', String(from), '-t', String(to - from), '-i', mix.file, '-c:a', 'pcm_s16le', part], { signal });
      const r = await this.request({ op: 'align', audio: part, text, language: language || 'English' }, { signal, onProgress: (p, m) => { if (p != null) last = p; progress(last, m); } });
      return { words: r.words.map(w => ({ ...w, start: w.start + from, end: w.end + from })) };
    });
  }
}
let nvidia;
async function hasNvidia() { if (nvidia !== undefined) return nvidia; nvidia = await new Promise(r => execFile('nvidia-smi', ['-L'], { windowsHide: true, timeout: 8000 }, err => r(!err))); return nvidia; }
async function findPython() {
  for (const [cmd, args] of [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3.10']], ['python', []], ['python3', []]]) {
    const exe = await new Promise(r => execFile(cmd, [...args, '-c', 'import sys;print(sys.executable if sys.version_info>=(3,10) else "")'], { windowsHide: true, timeout: 15000 }, (e, out) => r(e ? '' : String(out).trim())));
    if (exe) return exe;
  }
  return null;
}
module.exports = { Speech };
