// Creative catalog shared by the editor preview and the FFmpeg export pipeline.
// Motion is described with FFmpeg-compatible expressions (see expr.mjs).
//   p  : progress 0..1 of a transition / in-out animation     u : seconds since the clip started
//   e  : cubic ease-in-out(p)   eo : ease-out(p)   ei : ease-in(p)   b : back-ease (overshoot)
// Offsets x / y are fractions of the canvas width / height, s multiplies scale, r is degrees.
// alpha: 'ramp' (linear fade over the window) | 'step' (switch at the midpoint)

// Transitions. B is the incoming clip, A the outgoing one. Directional types share a `family` and differ
// by `dir`, so the editor shows one tile plus a direction control. `blur` is a default motion-blur peak
// (0..1) for fast moves. Old ids stay valid in saved projects.
const DIRS = { left: ['1-e', 0, '-e', 0], right: ['-(1-e)', 0, 'e', 0], up: [0, '1-e', 0, '-e'], down: [0, '-(1-e)', 0, 'e'] };
const dirMove = (family, dir, { push = false, blur = 0, name, group = 'Slide', ease } = {}) => {
  const [bx, by, ax, ay] = DIRS[dir];
  const B = {}, A = {}; if (bx) B.x = bx; if (by) B.y = by; if (push) { if (ax) A.x = ax; if (ay) A.y = ay; }
  return { id: `${family}-${dir}`, family, dir, name: `${name} ${dir}`, group, B, ...(push ? { A } : {}), ...(blur ? { blur } : {}), ...(ease ? { ease } : {}) };
};
export const TRANSITIONS = [
  { id: 'dissolve', family: 'dissolve', name: 'Dissolve', group: 'Basic', B: { alpha: 'ramp' } },
  { id: 'dip-black', family: 'dip', name: 'Fade to black', group: 'Basic', B: { alpha: 'step' }, dip: '#000000' },
  { id: 'dip-white', family: 'flash', name: 'Flash white', group: 'Basic', B: { alpha: 'step' }, dip: '#ffffff' },
  ...['left', 'right', 'up', 'down'].map(d => dirMove('slide', d, { name: 'Slide' })),
  ...['left', 'right', 'up', 'down'].map(d => dirMove('push', d, { name: 'Push', push: true })),
  ...['left', 'right', 'up', 'down'].map(d => dirMove('whip', d, { name: 'Whip', push: true, blur: 0.7, group: 'Motion', ease: 'snappy' })),
  { id: 'zoom-in', family: 'zoom-in', name: 'Zoom in', group: 'Zoom', B: { s: '1.45-0.45*e', alpha: 'ramp' } },
  { id: 'zoom-out', family: 'zoom-out', name: 'Zoom out', group: 'Zoom', B: { s: '0.55+0.45*e', alpha: 'ramp' } },
  { id: 'zoom-through', family: 'zoom-through', name: 'Zoom through', group: 'Zoom', A: { s: '1+0.8*e' }, B: { s: '0.7+0.3*e', alpha: 'ramp' }, blur: 0.35 },
  { id: 'spin', family: 'spin', name: 'Spin', group: 'Zoom', B: { r: '-90*(1-e)', s: 'max(0.02,0.4+0.6*e)', alpha: 'ramp' } },
  { id: 'spin-zoom', family: 'spin-zoom', name: 'Spin zoom', group: 'Motion', A: { r: '120*e', s: '1+0.6*e' }, B: { r: '-120*(1-e)', s: 'max(0.02,1.6-0.6*e)', alpha: 'ramp' }, blur: 0.5 },
  { id: 'drop', family: 'drop', name: 'Drop in', group: 'Motion', B: { y: '-(1-b)' } },
  { id: 'rise', family: 'rise', name: 'Rise up', group: 'Motion', B: { y: '1-b', alpha: 'ramp' } },
];
// One entry per family, in display order, with the directions it offers.
export const TRANSITION_FAMILIES = [...new Map(TRANSITIONS.map(t => [t.family, { id: t.family, name: t.dir ? t.name.replace(/ (left|right|up|down)$/, '') : t.name, group: t.group, dirs: TRANSITIONS.filter(x => x.family === t.family && x.dir).map(x => x.dir), first: t.id }])).values()];
export const transitionIn = (family, dir) => TRANSITIONS.find(t => t.family === family && (!dir || t.dir === dir)) || TRANSITIONS.find(t => t.family === family);
// Easing presets for transitions. 'auto' keeps each transition's own curve.
export const TRANSITION_EASES = [['auto', 'Natural'], ['smooth', 'Smooth'], ['linear', 'Linear'], ['in', 'Speed up'], ['out', 'Slow down'], ['snappy', 'Snappy'], ['bounce', 'Bouncy']];
// Where the transition sits relative to the cut.
export const TRANSITION_ALIGN = [['end', 'Before cut'], ['center', 'On the cut'], ['start', 'After cut']];
export const transitionWindow = (c, d) => { const a = c.transition?.align; return a === 'end' ? [c.start - d, c.start] : a === 'start' ? [c.start, c.start + d] : [c.start - d / 2, c.start + d / 2]; };
// What a transition type can be tuned with.
export const transitionCaps = def => ({ motion: !!(def && ['x', 'y', 's', 'r'].some(k => def.A?.[k] || def.B?.[k])), dip: !!def?.dip, dirs: def?.family ? TRANSITIONS.filter(x => x.family === def.family && x.dir).map(x => x.dir) : [] });

export const ANIMATIONS = {
  in: [
    { id: 'fade', name: 'Fade in', alpha: 'ramp' },
    { id: 'slide-up', name: 'Rise', y: '0.12*(1-eo)', alpha: 'ramp' },
    { id: 'slide-down', name: 'Drop in', y: '-0.12*(1-eo)', alpha: 'ramp' },
    { id: 'slide-left', name: 'Slide in left', x: '0.18*(1-eo)', alpha: 'ramp' },
    { id: 'slide-right', name: 'Slide in right', x: '-0.18*(1-eo)', alpha: 'ramp' },
    { id: 'zoom', name: 'Zoom in', s: 'max(0.02,0.4+0.6*eo)', alpha: 'ramp' },
    { id: 'pop', name: 'Pop', s: 'max(0.02,b)', alpha: 'ramp' },
    { id: 'spin', name: 'Spin in', r: '-180*(1-eo)', s: 'max(0.02,eo)' },
  ],
  out: [
    { id: 'fade', name: 'Fade out', alpha: 'ramp' },
    { id: 'slide-up', name: 'Float away', y: '-0.12*ei', alpha: 'ramp' },
    { id: 'slide-down', name: 'Sink', y: '0.12*ei', alpha: 'ramp' },
    { id: 'slide-left', name: 'Slide out left', x: '-0.18*ei', alpha: 'ramp' },
    { id: 'slide-right', name: 'Slide out right', x: '0.18*ei', alpha: 'ramp' },
    { id: 'zoom', name: 'Zoom out', s: 'max(0.02,1-0.6*ei)', alpha: 'ramp' },
    { id: 'pop', name: 'Shrink', s: 'max(0.02,1-ei)' },
    { id: 'spin', name: 'Spin out', r: '180*ei', s: 'max(0.02,1-ei)' },
  ],
  loop: [
    { id: 'bounce', name: 'Bounce', y: '-0.03*abs(sin(u*PI*1.6))' },
    { id: 'pulse', name: 'Pulse', s: '1+0.06*sin(u*PI*2)' },
    { id: 'heartbeat', name: 'Heartbeat', s: '1+0.1*pow(abs(sin(u*PI*1.2)),8)' },
    { id: 'float', name: 'Float', y: '0.02*sin(u*PI)' },
    { id: 'wiggle', name: 'Wiggle', r: '7*sin(u*PI*4)' },
    { id: 'spin', name: 'Rotate', r: 'u*120' },
    { id: 'shake', name: 'Shake', x: '0.008*sin(u*61)', y: '0.008*sin(u*47+1)' },
  ],
};

// Effects operate on a clip (or, on an effect track, on everything beneath it).
export const EFFECTS = [
  { id: 'blur', name: 'Blur', group: 'Basic', params: [{ key: 'amount', label: 'Strength', min: 0, max: 1, step: 0.01, value: 0.35 }] },
  { id: 'sharpen', name: 'Sharpen', group: 'Basic', params: [{ key: 'amount', label: 'Strength', min: 0, max: 1, step: 0.01, value: 0.5 }] },
  { id: 'vignette', name: 'Vignette', group: 'Lens', params: [{ key: 'amount', label: 'Strength', min: 0, max: 1, step: 0.01, value: 0.55 }] },
  { id: 'grain', name: 'Film grain', group: 'Film', params: [{ key: 'amount', label: 'Strength', min: 0, max: 1, step: 0.01, value: 0.4 }] },
  { id: 'rgbsplit', name: 'Chromatic aberration', group: 'Lens', params: [{ key: 'amount', label: 'Offset', min: 0, max: 1, step: 0.01, value: 0.4 }] },
  { id: 'glitch', name: 'Glitch', group: 'Retro', params: [{ key: 'amount', label: 'Intensity', min: 0, max: 1, step: 0.01, value: 0.6 }] },
  { id: 'pixelate', name: 'Pixelate', group: 'Retro', params: [{ key: 'amount', label: 'Block size', min: 0, max: 1, step: 0.01, value: 0.35 }] },
  { id: 'shake', name: 'Camera shake', group: 'Motion', clipOnly: true, params: [{ key: 'amount', label: 'Intensity', min: 0, max: 1, step: 0.01, value: 0.5 }] },
];
export const effectDef = id => EFFECTS.find(e => e.id === id);
export const transitionDef = id => TRANSITIONS.find(t => t.id === id);
export const animDef = (kind, id) => ANIMATIONS[kind]?.find(a => a.id === id);

// Derived effect numbers, shared so preview and export agree. h = output canvas height in pixels.
export const fx = {
  blurSigma: (a, h) => a * 22 * h / 1080,
  sharpen: a => a * 1.6,
  vignetteAngle: a => a * Math.PI / 2.2,
  grain: a => Math.round(a * 32),
  rgbShift: (a, h) => Math.max(1, Math.round(a * 14 * h / 1080)),
  pixelBlock: (a, h) => Math.max(2, Math.round((3 + a * 40) * h / 1080)),
  glitchOn: 'lt(mod(t,0.73),0.11)+between(mod(t,2.1),1.2,1.27)',
  shakeX: a => `${(0.012 * a).toFixed(4)}*sin(u*61)`,
  shakeY: a => `${(0.012 * a).toFixed(4)}*sin(u*47+1)`,
};

// ---------- Color filters (3D LUTs generated from these recipes) ----------
const clamp = v => Math.min(1, Math.max(0, v));
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ops = {
  sat: k => ([r, g, b]) => { const l = luma(r, g, b); return [l + (r - l) * k, l + (g - l) * k, l + (b - l) * k]; },
  contrast: k => c => c.map(v => (v - 0.5) * k + 0.5),
  scurve: k => c => c.map(v => { const s = v * v * (3 - 2 * v); return v + (s - v) * k; }),
  fade: k => c => c.map(v => k + v * (1 - k)),
  bright: k => c => c.map(v => v + k),
  temp: k => ([r, g, b]) => [r * (1 + k), g * (1 + k * 0.15), b * (1 - k)],
  tint: k => ([r, g, b]) => [r * (1 + k * 0.5), g * (1 - k), b * (1 + k * 0.5)],
  mono: () => ([r, g, b]) => { const l = luma(r, g, b); return [l, l, l]; },
  sepia: () => ([r, g, b]) => [r * 0.393 + g * 0.769 + b * 0.189, r * 0.349 + g * 0.686 + b * 0.168, r * 0.272 + g * 0.534 + b * 0.131],
  split: (sh, hi, k = 0.12) => ([r, g, b]) => { const l = luma(r, g, b), ws = (1 - l) * (1 - l) * k, wh = l * l * k; return [r + (sh[0] - 0.5) * ws + (hi[0] - 0.5) * wh, g + (sh[1] - 0.5) * ws + (hi[1] - 0.5) * wh, b + (sh[2] - 0.5) * ws + (hi[2] - 0.5) * wh]; },
  green: k => ([r, g, b]) => [r * (1 - k * 0.3), g * (1 + k * 0.4), b * (1 - k * 0.2)],
  gamma: k => c => c.map(v => Math.pow(clamp(v), k)),
};
export const FILTERS = [
  { id: 'vivid', name: 'Vivid', group: 'Popular', recipe: [ops.sat(1.35), ops.contrast(1.1)] },
  { id: 'golden', name: 'Golden', group: 'Popular', recipe: [ops.temp(0.12), ops.sat(1.08), ops.scurve(0.3)] },
  { id: 'nordic', name: 'Nordic', group: 'Popular', recipe: [ops.temp(-0.1), ops.sat(0.9), ops.fade(0.03)] },
  { id: 'teal-orange', name: 'Teal & Orange', group: 'Cinematic', recipe: [ops.split([0.2, 0.75, 0.85], [1, 0.62, 0.28], 0.55), ops.sat(1.1), ops.scurve(0.35)] },
  { id: 'film', name: 'Film', group: 'Cinematic', recipe: [ops.scurve(0.5), ops.fade(0.045), ops.split([0.45, 0.55, 0.6], [0.65, 0.55, 0.4], 0.35), ops.sat(0.92)] },
  { id: 'moody', name: 'Moody', group: 'Cinematic', recipe: [ops.bright(-0.04), ops.sat(0.78), ops.split([0.3, 0.45, 0.65], [0.55, 0.5, 0.45], 0.5), ops.scurve(0.4)] },
  { id: 'bleach', name: 'Bleach bypass', group: 'Cinematic', recipe: [ops.sat(0.45), ops.contrast(1.25)] },
  { id: 'vintage', name: 'Vintage', group: 'Retro', recipe: [ops.fade(0.09), ops.sat(0.72), ops.temp(0.07), ops.split([0.4, 0.6, 0.45], [0.6, 0.55, 0.42], 0.4), ops.contrast(0.92)] },
  { id: 'matte', name: 'Matte', group: 'Retro', recipe: [ops.fade(0.13), ops.contrast(0.9)] },
  { id: 'pastel', name: 'Pastel', group: 'Retro', recipe: [ops.sat(0.7), ops.fade(0.1), ops.bright(0.04)] },
  { id: 'sepia', name: 'Sepia', group: 'Retro', recipe: [ops.sepia(), ops.contrast(0.95)] },
  { id: 'cyber', name: 'Cyber', group: 'Bold', recipe: [ops.split([0.55, 0.2, 0.8], [0.2, 0.85, 0.9], 0.6), ops.sat(1.2), ops.contrast(1.08)] },
  { id: 'sunset', name: 'Sunset', group: 'Bold', recipe: [ops.temp(0.2), ops.tint(0.06), ops.split([0.55, 0.35, 0.5], [1, 0.6, 0.35], 0.4)] },
  { id: 'forest', name: 'Forest', group: 'Bold', recipe: [ops.green(0.25), ops.temp(0.04), ops.scurve(0.25)] },
  { id: 'noir', name: 'Noir', group: 'Black & white', recipe: [ops.mono(), ops.scurve(0.8), ops.contrast(1.2)] },
  { id: 'mono', name: 'Mono', group: 'Black & white', recipe: [ops.mono()] },
  { id: 'silver', name: 'Silver', group: 'Black & white', recipe: [ops.mono(), ops.fade(0.08), ops.gamma(0.9)] },
];
export const filterDef = id => FILTERS.find(f => f.id === id);

export function lutCube(id, size = 33) {
  const def = filterDef(id); if (!def) throw Error('Unknown filter ' + id);
  let out = `TITLE "FrameCut ${def.name}"\nLUT_3D_SIZE ${size}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n`;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    let c = [r / (size - 1), g / (size - 1), b / (size - 1)];
    for (const op of def.recipe) c = op(c).map(clamp);
    out += `${c[0].toFixed(5)} ${c[1].toFixed(5)} ${c[2].toFixed(5)}\n`;
  }
  return out;
}

// Parse a .cube file into {size, data: Float32Array(size^3*3)} with red varying fastest.
export function parseCube(text) {
  let size = 0; const data = []; let min = [0, 0, 0], max = [1, 1, 1];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'LUT_3D_SIZE') size = +parts[1];
    else if (parts[0] === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
    else if (parts[0] === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
    else if (/^[-\d.]/.test(parts[0]) && parts.length >= 3) data.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size || data.length !== size * size * size * 3) throw Error('This LUT file is not a valid 3D .cube LUT.');
  for (let i = 0; i < data.length; i++) { const k = i % 3; data[i] = (data[i] - min[k]) / ((max[k] - min[k]) || 1); }
  return { size, data: new Float32Array(data) };
}

// ---------- Text ----------
export const TEXT_STYLE = {
  font: 'Segoe UI', size: 0.075, color: '#ffffff', bold: true, italic: false, align: 'center', lineHeight: 1.15, letterSpacing: 0,
  strokeColor: '#000000', strokeWidth: 0, shadowColor: '#000000', shadowBlur: 0.35, shadowOpacity: 0, bgColor: '#000000', bgOpacity: 0, bgRadius: 0.25, uppercase: false,
};
export const TEXT_PRESETS = [
  { id: 'plain', name: 'Default', style: {} },
  { id: 'shadow', name: 'Soft shadow', style: { shadowOpacity: 0.8, shadowBlur: 0.4 } },
  { id: 'outline', name: 'Outline', style: { strokeWidth: 0.1, strokeColor: '#000000' } },
  { id: 'impact', name: 'Meme', style: { font: 'Impact', bold: false, uppercase: true, strokeWidth: 0.12, size: 0.09 } },
  { id: 'yellow', name: 'Highlighter', style: { color: '#ffe14d', strokeWidth: 0.1, strokeColor: '#111111', uppercase: true } },
  { id: 'boxed', name: 'Boxed', style: { bgOpacity: 0.85, bgColor: '#111111', bgRadius: 0.3 } },
  { id: 'label', name: 'Label', style: { bgOpacity: 1, bgColor: '#ff4d6d', color: '#ffffff', bgRadius: 0.5, size: 0.055 } },
  { id: 'white-box', name: 'Clean card', style: { bgOpacity: 1, bgColor: '#ffffff', color: '#111111', bgRadius: 0.2, size: 0.055 } },
  { id: 'neon', name: 'Neon', style: { color: '#7ef9ff', shadowColor: '#00c8ff', shadowOpacity: 1, shadowBlur: 1.2 } },
  { id: 'pink-neon', name: 'Neon pink', style: { color: '#ffd1f1', shadowColor: '#ff2bd6', shadowOpacity: 1, shadowBlur: 1.2 } },
  { id: 'cinema', name: 'Cinema', style: { font: 'Georgia', bold: false, italic: true, color: '#f5e6c4', letterSpacing: 0.04, size: 0.065 } },
  { id: 'mono', name: 'Typewriter', style: { font: 'Consolas', bold: false, color: '#ffffff', size: 0.055, bgOpacity: 0.6, bgRadius: 0 } },
  { id: 'title', name: 'Big title', style: { size: 0.13, bold: true, letterSpacing: 0.02, shadowOpacity: 0.6, uppercase: true } },
];
export const CAPTION_STYLE = { ...TEXT_STYLE, size: 0.052, strokeWidth: 0.12, strokeColor: '#101010', shadowOpacity: 0.6, shadowBlur: 0.3, highlight: false, highlightColor: '#ffe14d' };
export const CAPTION_PRESETS = [
  { id: 'clean', name: 'Clean', style: {} },
  { id: 'bold', name: 'Bold pop', style: { font: 'Impact', bold: false, uppercase: true, color: '#fff175', strokeWidth: 0.16, size: 0.06 } },
  { id: 'boxed', name: 'Boxed', style: { strokeWidth: 0, shadowOpacity: 0, bgOpacity: 0.72, bgColor: '#000000', bgRadius: 0.25 } },
  { id: 'karaoke', name: 'Word highlight', style: { highlight: true, highlightColor: '#b9f675', strokeWidth: 0.14 } },
  { id: 'minimal', name: 'Minimal', style: { bold: false, strokeWidth: 0.04, shadowOpacity: 0.8, size: 0.045 } },
  { id: 'cinema', name: 'Cinema', style: { font: 'Georgia', bold: false, italic: true, color: '#f5e6c4', strokeWidth: 0.05 } },
];

// ---------- Stickers ----------
export const EMOJI = {
  Smileys: '😀 😂 🤣 😍 🥰 😎 🤩 🥳 😭 😱 🤯 😴 🤔 🙄 😅 😇 🤗 😤 😈 👻 💀 🤖 👽 🙈'.split(' '),
  Gestures: '👍 👎 👏 🙌 🙏 💪 👉 👈 👆 👇 ✌️ 🤞 🤙 👋 ✋ 🫶 🤝 ☝️'.split(' '),
  Hearts: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💖 💗 💓 💕 💔 ❣️'.split(' '),
  Celebrate: '🎉 🎊 🎁 🎂 🏆 🥇 ⭐ 🌟 ✨ 💫 🔥 💥 💯 🚀 🎈 🎵 🎶 📣'.split(' '),
  Nature: '☀️ 🌙 🌈 ⚡ ❄️ 🌊 🌸 🌻 🍀 🌴 🐶 🐱 🦊 🐼 🦄 🐝'.split(' '),
  Objects: '📷 🎬 🎥 🎧 🎮 💡 📌 📍 🔔 💰 💎 ⏰ 📱 💻 ☕ 🍕 🍔 🍿'.split(' '),
  Symbols: '✅ ❌ ⚠️ ❓ ❗ ➡️ ⬅️ ⬆️ ⬇️ 🔴 🟢 🔵 ⭕ 🆕 🆗 🔝'.split(' '),
};
const svg = (body, vb = '0 0 200 200') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`;
export const SHAPE_STICKERS = [
  { id: 'arrow', name: 'Arrow', svg: svg('<path d="M20 112 C60 40 120 40 158 80" fill="none" stroke="#ffe14d" stroke-width="16" stroke-linecap="round"/><path d="M128 58 L170 92 L122 112 Z" fill="#ffe14d" stroke="#ffe14d" stroke-width="8" stroke-linejoin="round"/>') },
  { id: 'circle', name: 'Circle', svg: svg('<ellipse cx="100" cy="100" rx="84" ry="70" fill="none" stroke="#ff3b5c" stroke-width="12" stroke-dasharray="460 60" transform="rotate(-12 100 100)"/>') },
  { id: 'burst', name: 'Star burst', svg: svg('<path d="M100 8 L118 64 L176 40 L144 92 L196 118 L138 130 L150 190 L100 152 L50 190 L62 130 L4 118 L56 92 L24 40 L82 64 Z" fill="#ffcf33" stroke="#1a1a1a" stroke-width="6" stroke-linejoin="round"/><text x="100" y="118" font-family="Impact,Arial Black,sans-serif" font-size="40" text-anchor="middle" fill="#1a1a1a">WOW</text>') },
  { id: 'bubble', name: 'Speech bubble', svg: svg('<path d="M30 30 H170 Q186 30 186 46 V118 Q186 134 170 134 H86 L46 172 L56 134 H30 Q14 134 14 118 V46 Q14 30 30 30 Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="6" stroke-linejoin="round"/>') },
  { id: 'subscribe', name: 'Subscribe', svg: svg('<rect x="6" y="18" width="288" height="84" rx="42" fill="#ff2d2d"/><text x="150" y="74" font-family="Segoe UI,Arial,sans-serif" font-weight="800" font-size="40" text-anchor="middle" fill="#fff">SUBSCRIBE</text>', '0 0 300 120') },
  { id: 'like', name: 'Like', svg: svg('<circle cx="100" cy="100" r="88" fill="#2d7dff"/><path d="M62 96 H82 V150 H62 Z M90 150 V96 L112 52 Q124 50 124 66 L120 88 H146 Q160 90 156 106 L146 140 Q142 150 130 150 Z" fill="#fff"/>') },
  { id: 'heart', name: 'Heart', svg: svg('<path d="M100 176 C40 130 10 98 10 64 C10 36 32 16 58 16 C76 16 92 26 100 42 C108 26 124 16 142 16 C168 16 190 36 190 64 C190 98 160 130 100 176 Z" fill="#ff3b6b"/><ellipse cx="60" cy="58" rx="16" ry="10" fill="#fff" opacity=".45" transform="rotate(-30 60 58)"/>') },
  { id: 'check', name: 'Check', svg: svg('<circle cx="100" cy="100" r="88" fill="#1fbf75"/><path d="M58 104 L88 134 L146 70" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>') },
  { id: 'pin', name: 'Location', svg: svg('<path d="M100 190 C70 140 40 110 40 72 A60 60 0 0 1 160 72 C160 110 130 140 100 190 Z" fill="#ff4d4d"/><circle cx="100" cy="72" r="24" fill="#fff"/>') },
  { id: 'sparkle', name: 'Sparkles', svg: svg('<path d="M90 20 Q98 80 150 90 Q98 100 90 160 Q82 100 30 90 Q82 80 90 20 Z" fill="#fff6b0"/><path d="M155 120 Q159 146 182 150 Q159 154 155 180 Q151 154 128 150 Q151 146 155 120 Z" fill="#fff6b0"/>') },
  { id: 'new', name: 'New badge', svg: svg('<path d="M100 6 L124 30 L158 24 L164 58 L194 76 L178 106 L194 136 L164 154 L158 188 L124 182 L100 206 L76 182 L42 188 L36 154 L6 136 L22 106 L6 76 L36 58 L42 24 L76 30 Z" fill="#7c4dff" transform="translate(0 -6)"/><text x="100" y="114" font-family="Segoe UI,Arial,sans-serif" font-weight="900" font-size="46" text-anchor="middle" fill="#fff">NEW</text>') },
  { id: 'underline', name: 'Scribble', svg: svg('<path d="M10 70 C60 50 140 50 290 62 M30 86 C100 72 180 74 270 84" fill="none" stroke="#ffe14d" stroke-width="10" stroke-linecap="round"/>', '0 0 300 120') },
];
export const stickerDef = id => SHAPE_STICKERS.find(s => s.id === id);
