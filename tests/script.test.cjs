// Script → captions timing and transform keyframe expressions (pure functions).
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Script lines are split readably and timed over speech, never inside pauses', async () => {
  const { captionUnits, alignScript } = await import('../shared/script.mjs');
  const text = 'Welcome to FrameCut. This line is quite a bit longer than the others and needs wrapping into two lines!\nShort one.';
  const units = captionUnits(text);
  assert.ok(units.every(u => u.length <= 54), 'lines stay short: ' + JSON.stringify(units));
  assert.equal(units[0], 'Welcome to FrameCut.'); assert.equal(units.at(-1), 'Short one.');
  const speech = [{ start: 1, end: 2.2 }, { start: 3, end: 7.5 }, { start: 8.4, end: 9.2 }];
  const caps = alignScript(text, speech);
  assert.equal(caps.length, units.length);
  for (let i = 0; i < caps.length; i++) {
    assert.ok(caps[i].end > caps[i].start); if (i) assert.ok(caps[i].start >= caps[i - 1].end - 1e-9, 'no overlap');
    assert.ok(speech.some(s => caps[i].start >= s.start - 1e-6 && caps[i].start <= s.end), `line ${i} starts inside speech`);
  }
  assert.ok(Math.abs(caps[0].start - 1) < 1e-6, 'first caption starts with the voice');
  assert.ok(caps.at(-1).end <= 9.2 + 1e-6, 'last caption ends with the voice');
  assert.deepEqual(alignScript('', speech), []); assert.deepEqual(alignScript(text, []), []);
});

test('Keyframe expressions evaluate identically to the JS interpolation', async () => {
  const { keyExpr, keyValue } = await import('../shared/keys.mjs');
  const { evaluate } = await import('../shared/expr.mjs');
  const keys = [{ t: 0.5, v: -0.3, e: 'smooth' }, { t: 1.5, v: 0.2, e: 'hold' }, { t: 2.5, v: 0.6, e: 'linear' }, { t: 4, v: 0 }];
  const start = 2, ex = keyExpr(keys, start);
  for (let u = 0; u <= 4.5; u += 0.0625) assert.ok(Math.abs(evaluate(ex, { t: start + u }) - keyValue(keys, u)) < 1e-6, 'u=' + u);
});

test('Very short detected speech still yields readable, non-overlapping captions inside the voice span', async () => {
  const { alignScript } = await import('../shared/script.mjs');
  const caps = alignScript('One. Two two. Three three three.', [{ start: 1, end: 1.1 }, { start: 2, end: 2.1 }, { start: 2.8, end: 2.95 }]);
  assert.equal(caps.length, 3);
  for (let i = 0; i < caps.length; i++) { assert.ok(caps[i].end - caps[i].start >= 0.2, 'readable'); if (i) assert.ok(caps[i].start >= caps[i - 1].end - 1e-9, 'no overlap'); }
  assert.ok(caps[0].start >= 1 - 1e-9 && caps.at(-1).end <= 2.95 + 1e-9, JSON.stringify(caps));
});
