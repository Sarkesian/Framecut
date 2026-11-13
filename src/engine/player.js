// Playback engine: keeps a pool of media elements in sync with the timeline clock, mixes audio
// through Web Audio (gain > 100%, fades) and draws frames with the WebGL compositor.
import { buildPlan, activeLayers, sourceTime, audioGain } from '../../shared/plan.mjs';
import { dimensions, clipSpeed } from '../../shared/model.mjs';
import { parseCube } from '../../shared/catalog.mjs';
import { Compositor } from './compositor.js';
import { signal } from '@preact/signals';

// Bumped whenever a text/sticker raster finishes, so on-canvas handles can re-measure the layer.
export const rasterReady = signal(0);
import { rasterSync, rasterFor } from './raster.js';
import { renderCaptionBase, renderCaptionWord, ensureFont } from './captionRaster.js';

export class Player {
  constructor({ canvas, getProject, getMedia, onTime, onPlaying, onError, onRange }) {
    this.canvas = canvas; this.getProject = getProject; this.getMedia = getMedia; this.onTime = onTime; this.onPlaying = onPlaying; this.onError = onError; this.onRange = onRange;
    this.range = null; this.faults = new Map(); this.badFrames = 0;
    this.comp = new Compositor(canvas);
    this.pool = new Map(); this.audioEls = new Map(); this.t = 0; this.playing = false; this.rate = 1;
    this.plan = null; this.lutsLoading = new Set(); this.pendingRasters = new Set(); this.processed = new Map(); this.layerRasters = new WeakMap();
    this.raf = null; this.loop = this.loop.bind(this);
    this.ctx = null;
    this.drawRequested = false;
    this.lifecycle = new AbortController(); this.destroyed = false;
  }
  audio() { if (!this.ctx) { this.ctx = new AudioContext({ latencyHint: 'playback' }); this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination); } return this.ctx; }
  // The project changed. The playhead is kept where it is; only when the edit made the project shorter than
  // the playhead (deleting or trimming the last clip) does it move, to the new end, so the viewer never sits
  // on a time that no longer exists.
  invalidate() {
    this.plan = null;
    if (this.destroyed) return;
    let plan = null; try { plan = this.getPlan(); } catch (e) { console.error('Preview plan failed:', e); }
    if (plan && this.t > plan.duration + 1e-6) { this.t = plan.duration; if (this.playing) { this.clockT = this.t; this.clockNow = performance.now(); } this.onTime?.(this.t); }
    if (plan && this.range && this.range[0] >= plan.duration - 0.02) this.setRange(null);
    this.requestDraw();
  }
  getPlan() {
    if (this.plan) return this.plan;
    const p = this.getProject(); if (!p) return null;
    const [W, H] = dimensions(p.settings.ratio, p.settings.resolution);
    const media = id => this.getMedia(id);
    const byId = new Map(p.clips.map(c => [c.id, c]));
    const plan = this.plan = buildPlan(p, { W, H, media, captionPresets: this.captionPresets?.() || [], sizes: (id, info) => { if (info?.eff) { const r = this.capRaster(info, W, H); return r ? { w: r.w, h: r.h, boxes: r.boxes, words: r.words } : null; } const c = byId.get(id); const r = c && this.raster(c, W, H); return r ? { w: r.w, h: r.h } : null; } });
    plan.bg = p.settings.background?.type === 'color' ? p.settings.background.color : '#000000';
    // Lookups every frame needs, worked out once per plan instead of once per frame.
    plan.clips = p.clips; plan.follows = new Map();
    plan.mediaLayers = plan.layers.filter(L => L.type === 'media' || L.type === 'bgblur');
    plan.videoLayer = new Map(); for (const L of plan.layers) if (L.type === 'media' && !plan.videoLayer.has(L.clip.id)) plan.videoLayer.set(L.clip.id, L);
    plan.plainAudio = new Set(); for (const A of plan.audio) if (!A.processed) plan.plainAudio.add(A.id);
    for (const c of p.clips) if (c.filter?.id) this.loadLut(c.filter.id);
    return this.plan;
  }
  raster(c, W, H, variant = null) {
    const r = rasterSync(c, W, H, variant, id => this.getMedia(id));
    if (r) return r;
    const key = c.id + JSON.stringify(c.sticker || c.mediaId);
    if (!this.pendingRasters.has(key)) { this.pendingRasters.add(key); rasterFor(c, W, H, id => this.getMedia(id)).then(() => { this.pendingRasters.delete(key); this.invalidate(); rasterReady.value++; }).catch(() => {}); }
    return null;
  }
  // Caption rasters (base image or one word); fonts load first, so the first draw may come a frame later.
  capRaster(info, W, H) {
    const fontKey = JSON.stringify([info.eff.style.font, info.eff.style.weight, info.eff.style.italic]);
    if (!this.fontsReady?.has(fontKey)) {
      this.fontsReady ||= new Set(); this.fontsPending ||= new Set();
      if (!this.fontsPending.has(fontKey)) { this.fontsPending.add(fontKey); ensureFont(info.eff.style).then(() => { this.fontsReady.add(fontKey); this.invalidate(); rasterReady.value++; }); }
      return null;
    }
    return info.role === 'base' ? renderCaptionBase(info.clip, info.eff, W, H) : renderCaptionWord(info.clip, info.eff, info.word, W, H, info.role);
  }
  async loadLut(id) {
    if (this.comp.luts.has(id) || this.lutsLoading.has(id)) return; this.lutsLoading.add(id);
    try { const r = await fetch('/api/luts/' + encodeURIComponent(id), { signal: this.lifecycle.signal }); if (!r.ok) throw Error('LUT unavailable'); const cube = await r.text(); if (this.destroyed) return; this.comp.setLut(id, parseCube(cube)); this.requestDraw(); }
    catch (e) { if (!this.destroyed) this.onError?.('A color filter could not be loaded: ' + e.message); }
    finally { this.lutsLoading.delete(id); }
  }
  duration() { return this.getPlan()?.duration || 0; }

  // ----- transport -----
  play() {
    const plan = this.getPlan(); if (!plan || !plan.duration) return;
    if (this.t >= plan.duration - 0.02) this.t = 0;
    this.audio().resume().catch(() => {});
    this.playing = true; this.clockT = this.t; this.clockNow = performance.now();
    this.onPlaying?.(true); cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(this.loop);
  }
  // Pausing always ends a preview loop, whoever asked for the pause (Space, the transport button, a scrub,
  // an edit). A loop therefore can never start playing again by itself.
  pause() { this.setRange(null); if (!this.playing) return; this.playing = false; this.onPlaying?.(false); for (const e of this.pool.values()) e.el.pause?.(); for (const a of this.audioEls.values()) a.el.pause(); this.requestDraw(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t, { snapFrame = false } = {}) {
    const plan = this.getPlan(); const fps = plan?.fps || 30; let nt = Math.max(0, Math.min(plan?.duration || 0, t));
    if (snapFrame) nt = Math.round(nt * fps) / fps;
    // Jumping out of a looping range ends the loop: playback carries on from where the user went.
    if (this.range && (nt < this.range[0] - 1e-3 || nt > this.range[1] + 1e-3)) this.setRange(null);
    this.t = nt; if (this.playing) { this.clockT = nt; this.clockNow = performance.now(); }
    this.onTime?.(nt); this.requestDraw();
  }
  // ----- preview loop: play [from, to) over and over until anything pauses or seeks away -----
  setRange(r) {
    const next = r && r[1] - r[0] > 0.04 ? [Math.max(0, r[0]), r[1]] : null;
    const was = !!this.range; this.range = next;
    if (was !== !!next) this.onRange?.(!!next);
  }
  playRange(from, to, { restart = true } = {}) {
    const plan = this.getPlan(); if (!plan || !plan.duration) return false;
    const a = Math.max(0, Math.min(from, plan.duration - 0.05)), b = Math.min(to, plan.duration);
    if (!(b - a > 0.04)) return false;
    this.setRange(null);
    if (restart || this.t < a || this.t >= b - 0.02) this.seek(a);
    this.setRange([a, b]); this.play();
    return true;
  }
  // Keeps a running loop on the same thing while its length or placement is being edited.
  updateRange(from, to) { if (this.range) { const d = this.duration(); this.setRange([Math.min(from, Math.max(0, d - 0.05)), Math.min(to, d)]); } }
  step(frames) { const fps = this.getPlan()?.fps || 30; this.pause(); this.seek(Math.round(this.t * fps + frames) / fps); }
  setRate(r) { this.rate = r; if (this.playing) { this.clockT = this.t; this.clockNow = performance.now(); } }

  // Coalesce paused redraws within the current event. Unlike rAF and timers,
  // microtasks also run reliably when Windows occludes the editor window.
  requestDraw() {
    if (this.destroyed || this.playing || this.drawRequested) return; this.drawRequested = true;
    queueMicrotask(() => { if (!this.drawRequested || this.destroyed) return; this.drawRequested = false; try { this.frame(); this.badFrames = 0; } catch (e) { this.fault(e); } });
  }
  // A frame that throws must never take the viewer down with it: playback keeps its clock and tries the
  // next frame. (Before, one exception ended the frame loop while the player still counted as playing, so
  // the picture froze and paused redraws were ignored until the next pause.) Only a run of failures stops it.
  fault(e) {
    console.error('Preview frame failed:', e);
    if (++this.badFrames < 30) return;
    this.badFrames = 0; const was = this.playing; this.pause();
    if (was || !this.faultTold) { this.faultTold = true; this.onError?.('The preview hit a problem and was paused. Press Play to carry on; your project is safe.'); }
  }
  loop() {
    if (!this.playing) return;
    try {
      const plan = this.getPlan();
      if (!plan || !plan.duration) { this.pause(); return; }
      this.t = this.clockT + (performance.now() - this.clockNow) / 1000 * this.rate;
      const r = this.range;
      if (r && this.t >= Math.min(r[1], plan.duration)) { this.t = r[0]; this.clockT = r[0]; this.clockNow = performance.now(); }
      else if (this.t >= plan.duration) { this.t = plan.duration; this.frame(); this.pause(); this.onTime?.(this.t); return; }
      this.frame(); this.onTime?.(this.t); this.badFrames = 0;
    } catch (e) { this.fault(e); }
    if (this.playing) this.raf = requestAnimationFrame(this.loop);
  }

  // ----- media pool -----
  // wanted: ids of every clip that needs an element for this frame. A clip without one first takes over an
  // element nobody needs any more that already plays the same file (the piece left of a cut, a clip that
  // was just deleted or moved away), so cutting, trimming and moving show the next frame at once instead of
  // loading the file again, and the number of open files stays small however many pieces a clip is cut into.
  element(L, wanted = null, desired = 0) {
    const key = L.clip.id; let e = this.pool.get(key);
    const a = this.getMedia(L.mediaId); if (!a) return null;
    const src = L.image ? a.url : a.proxyUrl || a.url;
    if (e && e.src !== src) { this.release(key); e = null; }
    // A file that failed to open is tried again a few times (a busy disk, or the decoder being reclaimed).
    if (e?.failed) { const s = this.faults.get(src); if (s && s.n < 3 && performance.now() - s.at > 300 * s.n) { this.release(key); e = null; } }
    if (!e && wanted && !L.image) {
      let best = null, bestKey = null;
      for (const [k, o] of this.pool) if (!o.image && !o.failed && o.src === src && !wanted.has(k) && (!best || Math.abs(o.el.currentTime - desired) < Math.abs(best.el.currentTime - desired))) { best = o; bestKey = k; }
      if (best) { this.pool.delete(bestKey); this.comp.drop('m:' + bestKey); best.el.loop = !!L.loop; this.pool.set(key, best); e = best; }
    }
    if (!e) {
      let el;
      if (L.image) { el = new Image(); el.decoding = 'async'; el.onload = () => this.requestDraw(); el.src = src; }
      else {
        el = document.createElement('video'); el.preload = 'auto'; el.playsInline = true; el.disablePictureInPicture = true; el.src = src; el.loop = !!L.loop;
        // Silent until its sound is routed through the mixer (route()): otherwise a video whose audio was
        // separated or muted played its own soundtrack straight to the speakers, past every volume control.
        el.muted = true;
        // 'seeked' can fire before the decoded frame is uploadable, and detached videos don't reliably get
        // frame callbacks, so redraw again shortly after to pick up the settled frame.
        el.addEventListener('seeked', () => { e.stamp++; this.requestDraw(); for (const ms of [40, 120, 300]) setTimeout(() => { if (!el.seeking) { e.stamp++; this.requestDraw(); } }, ms); });
        el.addEventListener('loadeddata', () => { e.stamp++; this.faults.delete(src); this.requestDraw(); });
        el.addEventListener('error', () => {
          if (this.destroyed || !el.getAttribute('src')) return; // released on purpose
          e.failed = true; const s = this.faults.get(src) || { n: 0 }; s.n++; s.at = performance.now(); this.faults.set(src, s);
          if (s.n < 3) { setTimeout(() => this.requestDraw(), 300 * s.n + 30); return; }
          if (!s.told) { s.told = true; this.onError?.(`“${a.name}” can't be previewed yet${a.proxyPending ? ' — FrameCut is preparing a playback copy.' : '.'} It will still export normally.`); }
        });
        const tick = () => { e.stamp++; if (!this.playing) this.requestDraw(); el.requestVideoFrameCallback(tick); };
        el.requestVideoFrameCallback?.(tick);
      }
      e = { el, src, stamp: 0, image: L.image, used: 0 }; this.pool.set(key, e);
    }
    e.used = performance.now(); return e;
  }
  release(key) { const e = this.pool.get(key); if (!e) return; if (!e.image) { e.el.pause(); e.el.removeAttribute('src'); e.el.load(); } e.node?.disconnect(); e.gain?.disconnect(); this.pool.delete(key); this.comp.drop('m:' + key); }
  route(e) {
    // Connect a media element's sound to the mixer once.
    if (e.gain) return e.gain;
    const ctx = this.audio(); e.node = ctx.createMediaElementSource(e.el); e.gain = ctx.createGain(); e.gain.gain.value = 0; e.node.connect(e.gain).connect(this.master);
    e.el.muted = false; // from here on its level is the gain node's, which follows the clip's volume and mute
    return e.gain;
  }
  dropAudio(id) { const e = this.audioEls.get(id); if (!e) return; this.audioEls.delete(id); e.el.pause(); e.node.disconnect(); e.gain.disconnect(); e.el.removeAttribute('src'); e.el.load(); }
  audioElement(A, url, wanted = null) {
    let e = this.audioEls.get(A.id);
    if (e && e.src !== url) { this.dropAudio(A.id); e = null; }
    // Same idea as element(): the piece right of a cut carries on with the player the left piece had.
    if (!e && wanted) for (const [k, o] of this.audioEls) if (o.src === url && !wanted.has(k)) { this.audioEls.delete(k); o.gain.gain.value = 0; this.audioEls.set(A.id, o); e = o; break; }
    if (!e) {
      const el = new Audio(); el.preload = 'auto'; el.src = url; const ctx = this.audio();
      const node = ctx.createMediaElementSource(el), gain = ctx.createGain(); gain.gain.value = 0; node.connect(gain).connect(this.master);
      e = { el, src: url, node, gain }; this.audioEls.set(A.id, e);
    }
    e.used = performance.now(); return e;
  }
  syncEl(el, desired, active, speed, clamped) {
    if (!el || el.readyState === 0) { if (el && el.currentTime !== desired) try { el.currentTime = desired; } catch {} return; }
    if (this.playing && active && !clamped) {
      const rate = Math.min(16, Math.max(0.0625, speed * this.rate)); if (el.playbackRate !== rate) el.playbackRate = rate;
      if (el.paused) { try { el.currentTime = desired; } catch {} el.play().catch(() => {}); }
      else if (!el.seeking && Math.abs(el.currentTime - desired) > 0.25) el.currentTime = desired;
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - desired) > 0.02) el.currentTime = desired;
    }
  }
  frame() {
    const plan = this.getPlan(); if (!plan) return;
    const t = this.t;
    const seen = new Set();
    // Video / image layers (and pre-roll for clips starting soon)
    // A piece that simply carries on where the piece before it stops (the two halves of a cut) needs no
    // player of its own ahead of time: at the cut it takes over the one already playing that file, in sync.
    const follows = (c, list) => list.some(o => o !== c && o.mediaId === c.mediaId && o.trackId === c.trackId && Math.abs(o.start + o.duration - c.start) < 1e-3 && clipSpeed(o) === clipSpeed(c) && Math.abs((o.in || 0) + o.duration * clipSpeed(o) - (c.in || 0)) < 0.05);
    const cont = plan.follows, continues = c => { let v = cont.get(c.id); if (v === undefined) cont.set(c.id, v = follows(c, plan.clips)); return v; };
    // "On screen" uses the same edges as the compositor (activeLayers), so a playhead sitting exactly on a
    // cut always has an element for the piece that is drawn there.
    const near = L => (t >= L.vs - 1e-6 && t < L.ve - 1e-6 ? 1 : L.vs > t && L.vs - t < 2 && !(L.vs >= L.clip.start - 1e-6 && continues(L.clip)) ? 2 : 0);
    const nearAudio = A => (t >= A.start && t < A.start + A.duration ? 1 : A.start > t && A.start - t < 2 && !continues(A.clip) ? 2 : 0);
    const wanted = new Set(), wantedAudio = new Set();
    for (const L of plan.mediaLayers) if (near(L)) wanted.add(L.clip.id);
    for (const A of plan.audio) if (nearAudio(A)) wantedAudio.add(A.id);
    for (const L of plan.mediaLayers) {
      const state = near(L); if (!state) continue;
      const isActive = state === 1, at = isActive ? t : L.vs;
      const e = this.element(L, wanted, L.image ? 0 : sourceTime(L, at)); if (!e) continue; seen.add(L.clip.id);
      if (L.image || L.type === 'bgblur') continue;
      const speed = clipSpeed(L.clip), raw = (L.clip.in || 0) + (at - L.clip.start) * speed, desired = sourceTime(L, at);
      // A 0× sticker is a still frame: keep the element paused on it (the "clamped" path).
      this.syncEl(e.el, desired, isActive, speed, speed === 0 || (!L.loop && Math.abs(raw - desired) > 0.001));
    }
    // Audio
    for (const A of plan.audio) {
      const isActive = t >= A.start && t < A.start + A.duration, soon = nearAudio(A) === 2;
      let e, gainNode;
      const asset = this.getMedia(A.mediaId);
      const procUrl = A.processed && !this.bypass?.has(A.id) ? this.processedUrl(A) : null;
      if (A.clip.kind === 'video' && !procUrl) {
        const L = plan.videoLayer.get(A.id);
        if (!L) { if (!isActive && !soon) continue; e = this.audioElement(A, asset?.proxyUrl || asset?.url, wantedAudio); }
        else { e = this.pool.get(A.id); if (!e || e.image) continue; }
        gainNode = e.gain || (e.el ? this.route(e) : null);
        if (!L) { const desired = A.srcIn + (t - A.start) * A.speed; this.syncEl(e.el, Math.max(0, desired), isActive, A.speed, false); }
        if (L) e.el.muted = false;
      } else {
        if (!isActive && !soon) { const x = this.audioEls.get(A.id); if (x) { x.el.pause(); x.gain.gain.value = 0; } continue; }
        if (!asset) continue;
        e = this.audioElement(A, procUrl || asset.proxyUrl || asset.url, wantedAudio); gainNode = e.gain;
        const desired = A.srcIn + ((isActive ? t : A.start) - A.start) * A.speed;
        this.syncEl(e.el, desired, isActive, A.speed, false);
        if (procUrl) { const v = this.pool.get(A.id); if (v && !v.image) { this.route(v).gain.value = 0; } }
      }
      seen.add('a:' + A.id);
      if (gainNode && this.ctx) gainNode.gain.setTargetAtTime(isActive && this.playing ? audioGain(A, t) : 0, this.ctx.currentTime, 0.008);
    }
    // Silence video elements whose clip has no audible entry (muted clip / track)
    if (this.ctx) for (const [key, e] of this.pool) if (e.gain && !plan.plainAudio.has(key)) e.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
    // Free elements no longer near the playhead. Every open video or sound holds a connection and a
    // decoder; left to pile up (one per piece of every cut clip, and sounds were never let go at all) the
    // next clip could not open its file and the viewer went blank until something else was closed. So only
    // a few idle ones are kept for quick reuse, the rest go at once.
    const now = performance.now();
    let idle = null; for (const entry of this.pool) if (!seen.has(entry[0])) (idle ||= []).push(entry);
    if (idle) {
      idle.sort((x, y) => y[1].used - x[1].used);
      let keptVideo = 0, keptImage = 0;
      for (const [key, e] of idle) {
        if (!e.image && !e.el.paused) e.el.pause();
        const keep = e.image ? keptImage++ < 16 : !e.failed && now - e.used < 8000 && keptVideo++ < 2;
        if (!keep) this.release(key);
      }
    }
    let idleAudio = null; for (const entry of this.audioEls) if (!seen.has('a:' + entry[0])) (idleAudio ||= []).push(entry);
    if (idleAudio) {
      idleAudio.sort((x, y) => y[1].used - x[1].used); let keptAudio = 0;
      for (const [key, e] of idleAudio) { e.el.pause(); if (!(now - e.used < 8000 && keptAudio++ < 2)) this.dropAudio(key); }
    }

    const [W, H] = [plan.W, plan.H];
    this.comp.render({
      plan, t, bg: plan.bg, source: L => {
        // A layer's raster cannot change while its plan lives (any edit, loaded font or finished raster
        // makes a new plan), so it is looked up once per layer rather than re-keyed on every frame.
        if (L.type === 'raster') {
          const v = L.cap || !L.variants ? -1 : L.variants.findIndex(x => t >= x.from && t < x.to);
          let slots = this.layerRasters.get(L); if (!slots) this.layerRasters.set(L, slots = []);
          const r = slots[v + 1] ||= L.cap ? this.capRaster({ clip: L.clip, eff: L.cap.eff, role: L.cap.role, word: L.cap.word }, W, H) : this.raster(L.clip, W, H, v >= 0 ? v : null);
          return r ? this.comp.source('r:' + r.key, r.canvas, r.key) : null;
        }
        const e = this.pool.get(L.clip.id); if (!e) return null;
        if (e.image) return e.el.complete && e.el.naturalWidth ? this.comp.source('m:' + L.clip.id, e.el, 'img') : null;
        if (e.el.readyState >= 2) return this.comp.source('m:' + L.clip.id, e.el, e.stamp);
        const last = this.comp.textures.get('m:' + L.clip.id); return last?.ok ? last : null;
      },
    });
    if (Math.random() < 0.01) this.comp.gc();
  }
  processedUrl(A) {
    if (this.destroyed) return null;
    const key = A.mediaId + '|' + A.processed;
    const s = this.processed.get(key);
    if (s?.url) return s.url;
    if (!s || (s.retryAt && Date.now() >= s.retryAt)) {
      this.processed.set(key, { pending: true });
      const signal = this.lifecycle.signal;
      fetch('/api/tools/audiofx', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaId: A.mediaId, clip: { audioFx: A.clip.audioFx } }) }).then(r => { if (!r.ok) throw Error('Audio processing request failed (' + r.status + ')'); return r.json(); }).then(async d => {
        if (signal.aborted) return;
        if (d.error) throw Error(d.error);
        if (d.url) { this.processed.set(key, { url: d.url }); this.requestDraw(); return; }
        if (!d.job) throw Error('Audio processing did not return a task.');
        while (!signal.aborted) {
          await new Promise(r => setTimeout(r, 400)); if (signal.aborted) return;
          const r = await fetch('/api/jobs/' + d.job, { signal }); if (!r.ok) throw Error('Audio processing task is unavailable (' + r.status + ')');
          const j = await r.json(); if (signal.aborted) return;
          if (j.status === 'done') { if (!j.result?.url) throw Error('Audio processing returned no file.'); this.processed.set(key, { url: j.result.url }); this.requestDraw(); return; }
          if (j.status === 'failed' || j.status === 'cancelled') throw Error(j.error || 'Audio processing was cancelled.');
          if (!['queued', 'running'].includes(j.status)) throw Error('Audio processing returned an unknown task state.');
        }
      }).catch(err => { if (signal.aborted) return; this.processed.set(key, { retryAt: Date.now() + 10000 }); this.onError?.('Audio effects could not be applied: ' + err.message); });
    }
    return null;
  }
  snapshot(type = 'image/jpeg', q = 0.82) { this.frame(); return this.canvas.toDataURL(type, q); }
  destroy() { this.destroyed = true; this.lifecycle.abort(); this.pause(); cancelAnimationFrame(this.raf); this.drawRequested = false; for (const k of [...this.pool.keys()]) this.release(k); for (const k of [...this.audioEls.keys()]) this.dropAudio(k); this.processed.clear(); this.ctx?.close(); }
}
