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
  constructor({ canvas, getProject, getMedia, onTime, onPlaying, onError }) {
    this.canvas = canvas; this.getProject = getProject; this.getMedia = getMedia; this.onTime = onTime; this.onPlaying = onPlaying; this.onError = onError;
    this.comp = new Compositor(canvas);
    this.pool = new Map(); this.audioEls = new Map(); this.t = 0; this.playing = false; this.rate = 1;
    this.plan = null; this.dirty = true; this.lutsLoading = new Set(); this.pendingRasters = new Set(); this.processed = new Map();
    this.raf = null; this.loop = this.loop.bind(this);
    this.ctx = null;
    this.drawRequested = false;
  }
  audio() { if (!this.ctx) { this.ctx = new AudioContext({ latencyHint: 'playback' }); this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination); } return this.ctx; }
  invalidate() { this.plan = null; this.requestDraw(); }
  getPlan() {
    if (this.plan) return this.plan;
    const p = this.getProject(); if (!p) return null;
    const [W, H] = dimensions(p.settings.ratio, p.settings.resolution);
    const media = id => this.getMedia(id);
    this.plan = buildPlan(p, { W, H, media, captionPresets: this.captionPresets?.() || [], sizes: (id, info) => { if (info?.eff) { const r = this.capRaster(info, W, H); return r ? { w: r.w, h: r.h, boxes: r.boxes, words: r.words } : null; } const c = p.clips.find(x => x.id === id); const r = c && this.raster(c, W, H); return r ? { w: r.w, h: r.h } : null; } });
    this.plan.bg = p.settings.background?.type === 'color' ? p.settings.background.color : '#000000';
    for (const c of p.clips) if (c.filter?.id) this.loadLut(c.filter.id);
    return this.plan;
  }
  raster(c, W, H, variant = null) {
    const r = rasterSync(c, W, H, variant, id => this.getMedia(id));
    if (r) return r;
    const key = c.id + JSON.stringify(c.sticker || c.mediaId);
    if (!this.pendingRasters.has(key)) { this.pendingRasters.add(key); rasterFor(c, W, H, id => this.getMedia(id)).then(() => { this.pendingRasters.delete(key); this.svgDone ||= new Map(); this.invalidate(); rasterReady.value++; }).catch(() => {}); }
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
    try { const r = await fetch('/api/luts/' + encodeURIComponent(id)); if (!r.ok) throw Error('LUT unavailable'); this.comp.setLut(id, parseCube(await r.text())); this.requestDraw(); }
    catch (e) { this.onError?.('A color filter could not be loaded: ' + e.message); }
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
  pause() { if (!this.playing) return; this.playing = false; this.onPlaying?.(false); for (const e of this.pool.values()) e.el.pause?.(); for (const a of this.audioEls.values()) a.el.pause(); this.requestDraw(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t, { snapFrame = false } = {}) {
    const plan = this.getPlan(); const fps = plan?.fps || 30; let nt = Math.max(0, Math.min(plan?.duration || 0, t));
    if (snapFrame) nt = Math.round(nt * fps) / fps;
    this.t = nt; if (this.playing) { this.clockT = nt; this.clockNow = performance.now(); }
    this.onTime?.(nt); this.requestDraw();
  }
  step(frames) { const fps = this.getPlan()?.fps || 30; this.pause(); this.seek(Math.round(this.t * fps + frames) / fps); }
  setRate(r) { this.rate = r; if (this.playing) { this.clockT = this.t; this.clockNow = performance.now(); } }

  // rAF is paused while the window is occluded or hidden; a timer fallback keeps paused-frame redraws
  // (seeks, edits, snapshots) working there too, whichever fires first wins.
  requestDraw() {
    if (this.playing || this.drawRequested) return; this.drawRequested = true;
    const run = () => { if (!this.drawRequested) return; this.drawRequested = false; clearTimeout(this.drawTimer); this.frame(); };
    requestAnimationFrame(run); this.drawTimer = setTimeout(run, 100);
  }
  loop() {
    if (!this.playing) return;
    const plan = this.getPlan();
    this.t = this.clockT + (performance.now() - this.clockNow) / 1000 * this.rate;
    if (this.t >= plan.duration) { this.t = plan.duration; this.frame(); this.pause(); this.onTime?.(this.t); return; }
    this.frame(); this.onTime?.(this.t);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ----- media pool -----
  element(L) {
    const key = L.clip.id; let e = this.pool.get(key);
    const a = this.getMedia(L.mediaId); if (!a) return null;
    const src = L.image ? a.url : a.proxyUrl || a.url;
    if (e && e.src !== src) { this.release(key); e = null; }
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
        el.addEventListener('loadeddata', () => { e.stamp++; this.requestDraw(); });
        el.addEventListener('error', () => { e.failed = true; this.onError?.(`“${a.name}” can't be previewed yet${a.proxyPending ? ' — FrameCut is preparing a playback copy.' : '.'} It will still export normally.`); });
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
  audioElement(A, url) {
    let e = this.audioEls.get(A.id);
    if (e && e.src !== url) { e.el.pause(); e.node.disconnect(); e.gain.disconnect(); this.audioEls.delete(A.id); e = null; }
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
      else if (Math.abs(el.currentTime - desired) > 0.25) el.currentTime = desired;
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - desired) > 0.02) el.currentTime = desired;
    }
  }
  frame() {
    const plan = this.getPlan(); if (!plan) return;
    const t = this.t, p = this.getProject(), fps = plan.fps;
    const seen = new Set();
    const active = activeLayers(plan, t);
    // Video / image layers (and pre-roll for clips starting soon)
    for (const L of plan.layers) {
      if (L.type !== 'media' && L.type !== 'bgblur') continue;
      const isActive = t >= L.vs && t < L.ve, soon = !isActive && L.vs > t && L.vs - t < 2;
      if (!isActive && !soon) continue;
      const e = this.element(L); if (!e) continue; seen.add(L.clip.id);
      if (L.image || L.type === 'bgblur') continue;
      const at = isActive ? t : L.vs;
      const speed = clipSpeed(L.clip), raw = (L.clip.in || 0) + (at - L.clip.start) * speed, desired = sourceTime(L, at);
      // A 0× sticker is a still frame: keep the element paused on it (the "clamped" path).
      this.syncEl(e.el, desired, isActive, speed, speed === 0 || (!L.loop && Math.abs(raw - desired) > 0.001));
    }
    // Audio
    for (const A of plan.audio) {
      const isActive = t >= A.start && t < A.start + A.duration, soon = !isActive && A.start > t && A.start - t < 2;
      let e, gainNode;
      const asset = this.getMedia(A.mediaId);
      const procUrl = A.processed && !this.bypass?.has(A.id) ? this.processedUrl(A) : null;
      if (A.clip.kind === 'video' && !procUrl) {
        const L = plan.layers.find(l => l.clip.id === A.id && l.type === 'media');
        if (!L) { if (!isActive && !soon) continue; e = this.audioElement(A, asset?.proxyUrl || asset?.url); }
        else { e = this.pool.get(A.id); if (!e || e.image) continue; }
        gainNode = e.gain || (e.el ? this.route(e) : null);
        if (L && !e.gainVideo) e.gainVideo = true;
        if (!L) { const desired = A.srcIn + (t - A.start) * A.speed; this.syncEl(e.el, Math.max(0, desired), isActive, A.speed, false); }
        if (A.clip.kind === 'video' && L) { const v = this.pool.get(A.id); if (v) v.el.muted = false; }
      } else {
        if (!isActive && !soon) { const x = this.audioEls.get(A.id); if (x) { x.el.pause(); x.gain.gain.value = 0; } continue; }
        if (!asset) continue;
        e = this.audioElement(A, procUrl || asset.proxyUrl || asset.url); gainNode = e.gain;
        const desired = A.srcIn + ((isActive ? t : A.start) - A.start) * A.speed;
        this.syncEl(e.el, desired, isActive, A.speed, false);
        if (procUrl) { const v = this.pool.get(A.id); if (v && !v.image) { this.route(v).gain.value = 0; } }
      }
      seen.add('a:' + A.id);
      if (gainNode && this.ctx) gainNode.gain.setTargetAtTime(isActive && this.playing ? audioGain(A, t) : 0, this.ctx.currentTime, 0.008);
    }
    // Silence video elements whose clip has no audible entry (muted clip / track)
    for (const [key, e] of this.pool) if (e.gain && !plan.audio.some(A => A.id === key && !A.processed) && this.ctx) e.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
    // Free elements no longer near the playhead
    if (this.pool.size > 10) for (const [key, e] of this.pool) if (!seen.has(key) && performance.now() - e.used > 4000) this.release(key);
    for (const [key, e] of this.pool) if (!seen.has(key) && !e.image && !e.el.paused) e.el.pause();
    for (const [key, e] of this.audioEls) if (!seen.has('a:' + key)) { e.el.pause(); }

    const [W, H] = [plan.W, plan.H];
    this.comp.render({
      plan, t, bg: plan.bg, source: L => {
        if (L.type === 'raster' && L.cap) { const r = this.capRaster({ clip: L.clip, eff: L.cap.eff, role: L.cap.role, word: L.cap.word }, W, H); return r ? this.comp.source('r:' + r.key, r.canvas, r.key) : null; }
        if (L.type === 'raster') {
          const v = L.variants?.findIndex(x => t >= x.from && t < x.to);
          const r = this.raster(L.clip, W, H, v >= 0 ? v : null); if (!r) return null;
          return this.comp.source('r:' + r.key, r.canvas, r.key);
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
    const key = A.mediaId + '|' + A.processed;
    const s = this.processed.get(key);
    if (s?.url) return s.url;
    if (!s) {
      this.processed.set(key, { pending: true });
      fetch('/api/tools/audiofx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaId: A.mediaId, clip: { audioFx: A.clip.audioFx } }) }).then(r => r.json()).then(async d => {
        if (d.error) throw Error(d.error);
        if (d.url) { this.processed.set(key, { url: d.url }); this.requestDraw(); return; }
        for (;;) { await new Promise(r => setTimeout(r, 400)); const j = await (await fetch('/api/jobs/' + d.job)).json(); if (j.status === 'done') { this.processed.set(key, { url: j.result.url }); this.requestDraw(); return; } if (j.status === 'failed') throw Error(j.error); }
      }).catch(err => { this.processed.delete(key); this.onError?.('Audio effects could not be applied: ' + err.message); });
    }
    return null;
  }
  snapshot(type = 'image/jpeg', q = 0.82) { return this.canvas.toDataURL(type, q); }
  destroy() { this.pause(); cancelAnimationFrame(this.raf); for (const k of [...this.pool.keys()]) this.release(k); for (const e of this.audioEls.values()) { e.el.pause(); e.el.src = ''; } this.ctx?.close(); }
}
