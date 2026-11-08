// WebGL2 compositor for the preview. Its colour and effect math mirrors the FFmpeg filters used
// at export (exposure → channel mixer → eq → hue → LUT → effects) so the preview matches the file.
import { layerState, activeLayers } from '../../shared/plan.mjs';
import { fx } from '../../shared/catalog.mjs';
import { evaluate } from '../../shared/expr.mjs';

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
uniform vec2 uCanvas, uCenter, uHalf; uniform float uRot;
void main(){ vUv = aPos*0.5+0.5; vec2 p = aPos*uHalf; float c=cos(uRot), s=sin(uRot);
  vec2 q = vec2(p.x*c - p.y*s, p.x*s + p.y*c) + uCenter; vec2 clip = q/uCanvas*2.0-1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform sampler3D uLut; uniform float uLutMix, uLutN;
uniform vec4 uCrop; uniform vec2 uFlip, uSize; uniform float uAlpha;
uniform float uExposure, uBright, uContrast, uSat, uHue; uniform vec3 uMix;
uniform float uVignette, uGrain, uShift, uShiftV, uPixel, uSharpen, uTime, uOpaque;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
vec4 samp(vec2 uv){ return texture(uTex, mix(uCrop.xy, uCrop.zw, clamp(uv, 0.0, 1.0))); }
void main(){
  vec2 uv = vUv; if (uFlip.x > 0.5) uv.x = 1.0-uv.x; if (uFlip.y > 0.5) uv.y = 1.0-uv.y;
  if (uPixel > 0.0) uv = (floor(uv*uSize/uPixel)+0.5)*uPixel/uSize;
  vec4 base = samp(uv); vec3 c = base.rgb;
  if (uShift > 0.0) { vec2 dx = vec2(uShift/uSize.x, 0.0); c.r = samp(uv+dx).r; c.b = samp(uv-dx).b; c.g = samp(uv+vec2(0.0, uShiftV/uSize.y)).g; }
  if (uSharpen > 0.0) { vec3 acc = vec3(0.0); for (int y=-2;y<=2;y++) for (int x=-2;x<=2;x++) acc += samp(uv+vec2(float(x),float(y))/uSize).rgb; c = c + uSharpen*(c - acc/25.0); }
  c *= exp2(uExposure); c *= uMix;
  float Y = dot(c, vec3(0.299, 0.587, 0.114));
  float vY = uContrast*((16.0+219.0*Y)/255.0 - 0.5) + 0.5 + uBright;
  float Y2 = (vY*255.0-16.0)/219.0;
  vec3 ch = (c - Y)*uSat;
  if (uHue != 0.0) { float cb = ch.b*0.564, cr = ch.r*0.713, s = sin(uHue), k = cos(uHue); float cb2 = cb*k - cr*s, cr2 = cb*s + cr*k; ch = vec3(1.403*cr2, -0.344*cb2 - 0.714*cr2, 1.773*cb2); }
  c = clamp(Y2 + ch, 0.0, 1.0);
  if (uLutMix > 0.0) { vec3 l = texture(uLut, c*(uLutN-1.0)/uLutN + 0.5/uLutN).rgb; c = mix(c, l, uLutMix); }
  if (uVignette > 0.0) { vec2 d = (vUv-0.5)*uSize; float dn = length(d)/length(uSize*0.5); float f = dn > 1.0 ? 0.0 : pow(cos(uVignette*dn), 4.0); c *= f; }
  if (uGrain > 0.0) c += (hash(floor(vUv*uSize) + fract(uTime*7.31)*97.0) - 0.5)*2.0*uGrain/255.0;
  o = vec4(clamp(c, 0.0, 1.0), (uOpaque > 0.5 ? 1.0 : base.a)*uAlpha);
}`;

const BLUR_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uDir; uniform float uSigma; uniform vec4 uCrop;
void main(){ vec4 acc = vec4(0.0); float wsum = 0.0; int r = int(min(30.0, ceil(uSigma*2.5)));
  for (int i=-30;i<=30;i++){ if (i<-r||i>r) continue; float fi=float(i); float w = exp(-fi*fi/(2.0*uSigma*uSigma)); vec2 uv = clamp(vUv + uDir*fi, 0.0, 1.0); acc += texture(uTex, mix(uCrop.xy, uCrop.zw, uv))*w; wsum += w; }
  o = acc/wsum; }`;

const SOLID_FS = `#version 300 es
precision highp float; out vec4 o; uniform vec4 uColor; void main(){ o = uColor; }`;

function compile(gl, vs, fs) {
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}
const hexRGB = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export class Compositor {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, powerPreference: 'high-performance' });
    if (!gl) throw Error('WebGL2 is not available, so the preview cannot be shown.');
    this.gl = gl;
    this.prog = compile(gl, VS, FS); this.blur = compile(gl, VS, BLUR_FS); this.solid = compile(gl, VS, SOLID_FS);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.textures = new Map(); this.fbos = new Map(); this.luts = new Map();
    const empty = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, empty); gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); this.emptyLut = empty;
  }
  tex(w, h) { const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); this.params(); return t; }
  params() { const gl = this.gl; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
  fbo(name, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let f = this.fbos.get(name); const gl = this.gl;
    if (f && f.w === w && f.h === h) return f;
    if (f) { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fb); }
    const tex = this.tex(w, h), fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    f = { tex, fb, w, h }; this.fbos.set(name, f); return f;
  }
  // Upload (or reuse) a texture for an image source. stamp lets callers skip unchanged frames.
  source(key, el, stamp) {
    const gl = this.gl; let e = this.textures.get(key);
    if (!e) { e = { tex: gl.createTexture(), stamp: null }; gl.bindTexture(gl.TEXTURE_2D, e.tex); this.params(); this.textures.set(key, e); }
    if (stamp === undefined || e.stamp !== stamp) {
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el); e.stamp = stamp; e.w = el.videoWidth || el.naturalWidth || el.width; e.h = el.videoHeight || el.naturalHeight || el.height; e.ok = true; }
      catch { e.ok = false; }
    }
    e.used = performance.now(); return e.ok ? e : null;
  }
  drop(key) { const e = this.textures.get(key); if (e) { this.gl.deleteTexture(e.tex); this.textures.delete(key); } }
  gc() { const now = performance.now(); for (const [k, e] of this.textures) if (now - e.used > 20000) this.drop(k); }
  setLut(id, cube) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, cube.size, cube.size, cube.size, 0, gl.RGB, gl.FLOAT, cube.data);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.luts.set(id, { tex: t, size: cube.size });
  }
  quad(prog, target, { cx, cy, hw, hh, rot = 0 }) {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    const w = target ? target.w : this.canvas.width, h = target ? target.h : this.canvas.height;
    gl.viewport(0, 0, w, h); gl.useProgram(prog.p);
    gl.uniform2f(prog.u.uCanvas, w, h); gl.uniform2f(prog.u.uCenter, cx, cy); gl.uniform2f(prog.u.uHalf, hw, hh); gl.uniform1f(prog.u.uRot, rot);
    return prog.u;
  }
  blurTex(tex, crop, w, h, sigma, name) {
    const gl = this.gl; const d = sigma > 24 ? 8 : sigma > 12 ? 4 : sigma > 5 ? 2 : 1;
    const bw = Math.max(1, w / d), bh = Math.max(1, h / d), s = Math.max(0.5, sigma / d);
    const a = this.fbo(name + 'a', bw, bh), b = this.fbo(name + 'b', bw, bh);
    gl.disable(gl.BLEND);
    let u = this.quad(this.blur, a, { cx: a.w / 2, cy: a.h / 2, hw: a.w / 2, hh: a.h / 2 });
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.uTex, 0); gl.uniform4f(u.uCrop, ...crop); gl.uniform2f(u.uDir, 1 / a.w, 0); gl.uniform1f(u.uSigma, s); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    u = this.quad(this.blur, b, { cx: b.w / 2, cy: b.h / 2, hw: b.w / 2, hh: b.h / 2 });
    gl.bindTexture(gl.TEXTURE_2D, a.tex); gl.uniform1i(u.uTex, 0); gl.uniform4f(u.uCrop, 0, 0, 1, 1); gl.uniform2f(u.uDir, 0, 1 / b.h); gl.uniform1f(u.uSigma, s); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return b.tex;
  }
  // Draw one frame. ctx: {plan, t, scale (canvas px per project px), bg, source(L) → {tex,w,h} | null}
  render({ plan, t, bg = '#000000', source }) {
    const gl = this.gl, Wc = this.canvas.width, Hc = this.canvas.height, k = Wc / plan.W, H = plan.H;
    let cur = this.fbo('compA', Wc, Hc), other = this.fbo('compB', Wc, Hc);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fb); gl.viewport(0, 0, Wc, Hc);
    const [r, g, b] = hexRGB(bg); gl.clearColor(r, g, b, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const glitch = evaluate(fx.glitchOn, { t }) > 0;
    for (const L of activeLayers(plan, t)) {
      const st = layerState(L, t); if (st.alpha <= 0.002 && L.type !== 'adjust') continue;
      if (L.type === 'dip') {
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        const u = this.quad(this.solid, cur, { cx: Wc / 2, cy: Hc / 2, hw: Wc / 2, hh: Hc / 2 }); gl.uniform4f(u.uColor, ...hexRGB(L.color), st.alpha); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); continue;
      }
      if (L.type === 'adjust') {
        gl.disable(gl.BLEND);
        this.drawLayer(L, { tex: cur.tex, w: Wc, h: Hc, crop: [0, 1, 1, 0], displayW: Wc, displayH: Hc, target: other, geom: { cx: Wc / 2, cy: Hc / 2, hw: Wc / 2, hh: Hc / 2, rot: 0 }, alpha: 1, t, k, H, glitch, opaque: true });
        [cur, other] = [other, cur]; continue;
      }
      const src = source(L); if (!src) continue;
      if (L.type === 'bgblur') {
        // cover-fit the clip into the canvas, then blur it
        const sw = src.w, sh = src.h, kk = Math.max(Wc / sw, Hc / sh), vw = Wc / (sw * kk), vh = Hc / (sh * kk);
        const crop = [(1 - vw) / 2, (1 - vh) / 2, (1 + vw) / 2, (1 + vh) / 2];
        const blurred = this.blurTex(src.tex, crop, Wc, Hc, L.blur * k, 'bg');
        gl.disable(gl.BLEND);
        this.drawLayer({ clip: { color: {}, effects: [] } }, { tex: blurred, crop: [0, 0, 1, 1], displayW: Wc, displayH: Hc, target: cur, geom: { cx: Wc / 2, cy: Hc / 2, hw: Wc / 2, hh: Hc / 2, rot: 0 }, alpha: 1, t, k, H, glitch, opaque: true, noFx: true });
        continue;
      }
      const c = L.clip, cr = c.crop || {};
      const crop = L.type === 'raster' ? [0, 0, 1, 1] : [cr.l || 0, cr.t || 0, 1 - (cr.r || 0), 1 - (cr.b || 0)];
      const dw = L.baseW * k, dh = L.baseH * k;
      const blur = (c.effects || []).find(e => e.id === 'blur' && e.amount > 0);
      let tex = src.tex, useCrop = crop;
      if (blur) { tex = this.blurTex(src.tex, crop, dw, dh, fx.blurSigma(blur.amount, H) * k, 'lb'); useCrop = [0, 0, 1, 1]; }
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.drawLayer(L, { tex, crop: useCrop, displayW: dw, displayH: dh, target: cur, geom: { cx: (L.cx + st.dx) * k, cy: (L.cy + st.dy) * k, hw: dw * st.s / 2, hh: dh * st.s / 2, rot: st.r * Math.PI / 180 }, alpha: st.alpha, t, k, H, glitch });
    }
    // present
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, cur.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, Wc, Hc, 0, 0, Wc, Hc, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  drawLayer(L, o) {
    const gl = this.gl, c = L.clip, col = c.color || {};
    const u = this.quad(this.prog, o.target, o.geom);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, o.tex); gl.uniform1i(u.uTex, 0);
    // crop as (u0, v0, u1, v1) in texture space; adjust layers read the FBO which is stored bottom-up
    if (o.opaque && o.crop[1] === 1) gl.uniform4f(u.uCrop, 0, 1, 1, 0); else gl.uniform4f(u.uCrop, ...o.crop);
    gl.uniform2f(u.uFlip, L.flipH ? 1 : 0, L.flipV ? 1 : 0); gl.uniform2f(u.uSize, o.displayW, o.displayH); gl.uniform1f(u.uAlpha, o.alpha); gl.uniform1f(u.uOpaque, o.opaque ? 1 : 0);
    const fxOn = !o.noFx;
    gl.uniform1f(u.uExposure, fxOn ? col.exposure || 0 : 0);
    gl.uniform3f(u.uMix, fxOn ? 1 + 0.15 * (col.temperature || 0) : 1, fxOn ? 1 - 0.1 * (col.tint || 0) : 1, fxOn ? 1 - 0.15 * (col.temperature || 0) : 1);
    gl.uniform1f(u.uBright, fxOn ? col.brightness || 0 : 0); gl.uniform1f(u.uContrast, fxOn ? col.contrast ?? 1 : 1); gl.uniform1f(u.uSat, fxOn ? col.saturation ?? 1 : 1); gl.uniform1f(u.uHue, fxOn ? (col.hue || 0) * Math.PI / 180 : 0);
    const lut = fxOn && c.filter?.id && this.luts.get(c.filter.id);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, lut ? lut.tex : this.emptyLut); gl.uniform1i(u.uLut, 1);
    gl.uniform1f(u.uLutMix, lut ? c.filter.intensity ?? 1 : 0); gl.uniform1f(u.uLutN, lut ? lut.size : 1);
    let vig = 0, grain = 0, shift = 0, shiftV = 0, pixel = 0, sharpen = 0;
    if (fxOn) for (const e of c.effects || []) {
      const a = e.amount ?? 0.5; if (!(a > 0)) continue;
      if (e.id === 'vignette') vig = fx.vignetteAngle(a);
      if (e.id === 'grain') grain = Math.max(grain, fx.grain(a));
      if (e.id === 'rgbsplit') shift = Math.max(shift, fx.rgbShift(a, o.H) * o.k);
      if (e.id === 'pixelate') pixel = fx.pixelBlock(a, o.H) * o.k;
      if (e.id === 'sharpen') sharpen = fx.sharpen(a);
      if (e.id === 'glitch' && o.glitch) { const n = fx.rgbShift(Math.min(1, a * 2), o.H); shift = Math.max(shift, n * o.k); shiftV = Math.round(n / 3) * o.k; grain = Math.max(grain, fx.grain(a)); }
    }
    gl.uniform1f(u.uVignette, vig); gl.uniform1f(u.uGrain, grain); gl.uniform1f(u.uShift, shift); gl.uniform1f(u.uShiftV, shiftV); gl.uniform1f(u.uPixel, pixel); gl.uniform1f(u.uSharpen, sharpen); gl.uniform1f(u.uTime, o.t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
