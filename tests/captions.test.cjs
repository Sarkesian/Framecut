// Caption engine: grouping, line breaks, inheritance, word reconciliation, animation curves and
// legacy-project migration. (Recognition accuracy is measured separately: tests/captions-bench.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/captions.mjs');
const { evaluate } = require('../shared/expr.mjs');
const { buildPlan } = require('../shared/plan.mjs');
const { newProject, newClip, normalizeProject } = require('../shared/model.mjs');

const words = (text, t0 = 0, dur = 0.3, gap = 0.05) => text.split(' ').map((w, i) => ({ text: w, start: t0 + i * (dur + gap), end: t0 + i * (dur + gap) + dur }));

test('Grouping: pauses, sentences, limits, no stragglers, readable durations', () => {
  const ws = [...words('So here is the plan. We grab the loot and we sprint to the extraction point', 0), ...words('Ready?', 6), ...words('Go!', 9)];
  const groups = C.groupWords(ws, { grouping: 'phrase', maxLines: 1, maxWords: 4, minDuration: 0.6, gapHold: 0.35 }, { aspect: 9 / 16, size: 0.078 });
  assert.ok(groups.every(g => g.words.length <= 5), 'phrase groups stay short');
  assert.ok(groups.some(g => /plan\.$/.test(g.text)), 'sentence end closes a group');
  assert.ok(groups.every((g, i) => g.end - g.start >= 0.6 - 1e-9 || (groups[i + 1] && groups[i + 1].start - g.end < 0.03)), 'every group stays up long enough to read (or until the next one starts)');
  for (let i = 1; i < groups.length; i++) assert.ok(groups[i].start >= groups[i - 1].end, 'groups never overlap');
  assert.equal(groups.find(g => g.text === 'Ready?').words.length, 1, 'a long pause isolates a word');
  const one = C.groupWords(words('one two three'), { grouping: 'word' });
  assert.deepEqual(one.map(g => g.text), ['one', 'two', 'three']);
  const sent = C.groupWords(words('this is a fairly long sentence that should wrap onto two balanced lines nicely'), { grouping: 'sentence', maxLines: 2 }, { aspect: 16 / 9, size: 0.058 });
  assert.equal(sent.length, 1); const [a, b] = sent[0].text.split('\n'); assert.ok(a && b && Math.abs(a.length - b.length) < 12, 'balanced two-line break: ' + sent[0].text);
});

test('Inheritance: preset → project → track → caption, with the source of each value', () => {
  const p = newProject(); p.tracks.unshift({ id: 'cap', kind: 'text', name: 'Captions', captions: true });
  p.captions = { version: 2, preset: 'word-pop', overrides: { style: { color: '#ff0000' } } };
  const c = newClip('text', { trackId: 'cap', caption: true, text: 'hi', capStyle: { style: { size: 0.1 } } });
  p.tracks[0].captionStyle = { anim: { emph: { peak: 1.3 } } };
  const e = C.resolveCaption(p, c);
  assert.equal(e.style.font, 'Montserrat', 'from the preset'); assert.equal(e.style.color, '#ff0000', 'project override'); assert.equal(e.anim.emph.peak, 1.3, 'track override'); assert.equal(e.style.size, 0.1, 'caption override');
  assert.equal(C.sourceOf(p, c, 'style', 'color'), 'project'); assert.equal(C.sourceOf(p, c, 'anim', 'emph'), 'track'); assert.equal(C.sourceOf(p, c, 'style', 'font'), 'preset');
  assert.equal(C.CAPTION_PRESETS_V2.length, 8, 'a small, curated set');
});

test('Editing text keeps timing for unchanged words and estimates only new ones', () => {
  const c = { duration: 3, text: 'hello brave new world', words: [{ text: 'hello', start: 0, end: 0.5 }, { text: 'big', start: 0.6, end: 1 }, { text: 'world', start: 1.2, end: 2 }] };
  C.reconcileWords(c);
  assert.deepEqual(c.words.map(w => w.text), ['hello', 'brave', 'new', 'world']);
  assert.equal(c.words[0].start, 0); assert.equal(c.words[3].start, 1.2); assert.equal(c.words[1].timing, 'estimated');
  const d = { duration: 2, text: 'Hello, World', words: [{ text: 'hello', start: 0.1, end: 0.5 }, { text: 'world', start: 0.6, end: 1 }] };
  C.reconcileWords(d); assert.equal(d.words[1].text, 'World'); assert.equal(d.words[1].start, 0.6); assert.equal(d.words[1].orig, 'world');
});

test('Word pop: time-based curve (same at any frame rate), settles without jitter, never overlaps neighbours', () => {
  const anim = C.merge(C.CAPTION_BASE.anim, C.presetDef('word-pop').anim);
  const ov = C.wordOverlays(anim, words('make it pop', 1), 1, 3);
  assert.equal(ov.length, 3); assert.ok(ov.every(o => o.role === 'emph' && o.s));
  const s = t => evaluate(ov[1].s, { t }), ws = ov[1].from;
  assert.ok(Math.abs(s(ws) - 0.92) < 1e-6, 'starts at the initial size'); assert.ok(Math.abs(s(ws + 0.1) - 1.2) < 1e-6, 'peaks on time');
  const tail = [0.3, 0.32, 0.34].map(u => s(ws + u)); assert.ok(tail.every(v => Math.abs(v - 1.04) < 0.02), 'settles at the final size: ' + tail);
  // Frame-rate independence: sampling at 24/30/60 fps hits the same curve values at the same times.
  for (const fps of [24, 30, 60]) for (let k = 0; k < 10; k++) { const t = ws + k / fps; assert.equal(evaluate(ov[1].s, { t }), s(t)); }
  // Overlap cap: a long word between close neighbours grows less than its peak.
  const p = newProject(); p.tracks.unshift({ id: 'cap', kind: 'text', name: 'Captions', captions: true }); p.captions = { version: 2, preset: 'word-pop', overrides: {} };
  p.clips.push(newClip('text', { trackId: 'cap', caption: true, start: 1, duration: 2, text: 'EXTRAORDINARY a b', words: words('EXTRAORDINARY a b', 0) }));
  const sizes = (id, i) => i.role === 'base' ? { w: 900, h: 100, words: 3, boxes: [{ x: -200, y: 0, w: 500, h: 80, gapL: 40, gapR: 20 }, { x: 100, y: 0, w: 40, h: 80, gapL: 20, gapR: 20 }, { x: 160, y: 0, w: 40, h: 80, gapL: 20, gapR: 40 }] } : { w: 520, h: 100 };
  const plan = buildPlan(p, { W: 1920, H: 1080, sizes });
  const big = plan.layers.find(l => l.id.endsWith(':emph0')), small = plan.layers.find(l => l.id.endsWith(':emph1'));
  const peakBig = Math.max(...Array.from({ length: 40 }, (_, k) => evaluate(big.motion.s, { t: big.vs + k * 0.005 })));
  const peakSmall = Math.max(...Array.from({ length: 40 }, (_, k) => evaluate(small.motion.s, { t: small.vs + k * 0.005 })));
  assert.ok(500 * (peakBig - 1) / 2 <= 20 * 1.35 / 2 + 1, 'long word stays within its gap: peak ' + peakBig.toFixed(3));
  assert.ok(peakSmall > peakBig, 'short words still pop fully');
});

test('Entrance/exit motion and blur reveal are expressed once for preview and export', () => {
  const m = C.captionMotion({ in: { type: 'blur', dur: 0.3, strength: 0.5 }, out: { type: 'shrink', dur: 0.2 } }, 1, 3);
  assert.ok(m.blur && evaluate(m.blur, { t: 1 }) > 5 && evaluate(m.blur, { t: 1.31 }) === 0, 'blur clears when the entrance ends');
  assert.ok(Math.abs(evaluate(m.s[0], { t: 3 }) - 0.02) < 1e-6 && evaluate(m.s[0], { t: 2.5 }) === 1, 'shrink exit');
  const t = C.captionMotion({ in: { type: 'type' } }, 0, 2); assert.equal(t.hidden, true, 'type-on reveals word by word');
});

test('Old projects: captions migrate into the shared style without changing their look', () => {
  const old = { version: 2, name: 'Old', settings: { ratio: '16:9', resolution: 1080, fps: 30 }, tracks: [{ id: 'captions', kind: 'text', name: 'Captions', captions: true }, { id: 'main', kind: 'video', name: 'Main', main: true }],
    clips: [{ id: 'c1', kind: 'text', trackId: 'captions', caption: true, start: 0, duration: 1, text: 'hello there', words: [{ start: 0, end: 0.4, text: 'hello' }, { start: 0.5, end: 0.9, text: 'there' }], style: { font: 'Georgia', size: 0.05, color: '#f5e6c4', highlight: true, highlightColor: '#b9f675', bold: true }, transform: { y: 0.36 } }] };
  const p = normalizeProject(old);
  assert.equal(p.captions.version, 2); const e = C.resolveCaption(p, p.clips[0]);
  assert.equal(e.style.font, 'Georgia'); assert.equal(e.style.color, '#f5e6c4'); assert.equal(e.style.activeColor, '#b9f675'); assert.equal(e.anim.emph.type, 'highlight'); assert.equal(e.style.y, 0.36);
  assert.equal(p.clips[0].words.length, 2, 'words kept');
  const again = normalizeProject(p); assert.deepEqual(again.captions, p.captions, 'migration runs once');
});

test('Word pop overlap is a setting: allowed overlap reaches the full peak', () => {
  const p = newProject(); p.tracks.unshift({ id: 'cap', kind: 'text', name: 'Captions', captions: true });
  p.captions = { version: 2, preset: 'word-pop', overrides: { anim: { emph: { allowOverlap: true } } } };
  p.clips.push(newClip('text', { trackId: 'cap', caption: true, start: 1, duration: 2, text: 'EXTRAORDINARY a', words: words('EXTRAORDINARY a', 0) }));
  const sizes = (id, i) => i.role === 'base' ? { w: 700, h: 100, words: 2, boxes: [{ x: -100, y: 0, w: 500, h: 80, gapL: 40, gapR: 20 }, { x: 200, y: 0, w: 40, h: 80, gapL: 20, gapR: 40 }] } : { w: 520, h: 100 };
  const big = buildPlan(p, { W: 1920, H: 1080, sizes }).layers.find(l => l.id.endsWith(':emph0'));
  assert.ok(Math.abs(evaluate(big.motion.s, { t: big.vs + 0.1 }) - 1.2) < 1e-6, 'full peak when overlap is allowed');
});
