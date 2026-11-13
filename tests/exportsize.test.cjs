// Export size planning: the estimate shown in the dialog and the bitrate the renderer uses come from the
// same function, a target size is honoured with room to spare, and custom resolutions are valid frame sizes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { targetPlan, estimateBytes, qualityKbps, canTarget, cleanShort, codecFor } = require('../shared/exportsize.mjs');
const { dimensions } = require('../shared/model.mjs');
const { encoderArgs } = require('../desktop/compose.cjs');

test('Target size: video + audio stay under the limit, for short and long videos', () => {
  for (const [targetMB, duration] of [[300, 600], [25, 60], [100, 3600], [8, 20]]) {
    const t = targetPlan({ targetMB, duration, W: 1920, H: 1080, fps: 30 });
    const bytes = (t.videoKbps + t.audioKbps) * 125 * duration;
    assert.ok(bytes < targetMB * 1e6, `${targetMB} MB over ${duration}s: planned ${Math.round(bytes / 1e4) / 100} MB`);
    assert.ok(t.capped || bytes > targetMB * 1e6 * 0.85, 'and the budget is actually used');
    assert.ok(t.bytes <= targetMB * 1e6 * 1.001, 'the estimate shown never exceeds the limit');
  }
});

test('Target size: judges the picture and suggests a resolution that fits instead of silently wrecking it', () => {
  const tight = targetPlan({ targetMB: 300, duration: 1800, W: 3840, H: 2160, fps: 30 });
  assert.ok(['soft', 'poor'].includes(tight.grade), '300 MB is thin for 30 minutes of 4K: ' + tight.grade);
  assert.ok(tight.suggest && tight.suggest < 2160, 'a smaller size is offered: ' + tight.suggest);
  const fine = targetPlan({ targetMB: 300, duration: 600, W: 1920, H: 1080, fps: 30 });
  assert.ok(['good', 'great'].includes(fine.grade)); assert.equal(fine.suggest, null);
  // HEVC needs fewer bits for the same picture, so the same budget grades better.
  const hevc = targetPlan({ targetMB: 300, duration: 1800, W: 3840, H: 2160, fps: 30, codec: 'hevc' });
  assert.ok(hevc.bpp > tight.bpp);
  assert.equal(targetPlan({ targetMB: 0.2, duration: 600, W: 1920, H: 1080, fps: 30 }).grade, 'impossible');
});

test('Target size: a limit far above what the video needs is not padded out', () => {
  const t = targetPlan({ targetMB: 5000, duration: 30, W: 1280, H: 720, fps: 30 });
  assert.ok(t.capped, 'capped at the best-quality rate'); assert.ok(t.bytes < 100e6, 'comes out small: ' + t.bytes);
});

test('Target size: a retry scale lowers the rate, and frame rate is part of the maths (never changed by it)', () => {
  const a = targetPlan({ targetMB: 50, duration: 120, W: 1920, H: 1080, fps: 30 }), b = targetPlan({ targetMB: 50, duration: 120, W: 1920, H: 1080, fps: 30, scale: 0.9 });
  assert.ok(b.videoKbps < a.videoKbps);
  const f60 = targetPlan({ targetMB: 50, duration: 120, W: 1920, H: 1080, fps: 60 });
  assert.equal(f60.videoKbps, a.videoKbps, 'same budget at 60 fps'); assert.ok(f60.bpp < a.bpp, 'spread over twice the frames');
});

test('Estimate: quality modes order sensibly and HEVC is the smaller file', () => {
  const base = { format: 'mp4', codec: 'h264', fps: 30, audioBitrate: 192 };
  const high = estimateBytes({ ...base, quality: 'high' }, 1920, 1080, 60), bal = estimateBytes({ ...base, quality: 'balanced' }, 1920, 1080, 60);
  const smaller = estimateBytes({ ...base, codec: 'hevc', quality: 'balanced' }, 1920, 1080, 60);
  assert.ok(high > bal && bal > smaller, `${high} > ${bal} > ${smaller}`);
  assert.ok(smaller < high * 0.55, 'the Smaller file mode is about half the size or less');
  assert.equal(estimateBytes({ ...base, sizeMode: 'target', targetMB: 20 }, 1920, 1080, 60) <= 20e6, true);
  assert.equal(qualityKbps({ format: 'mp3' }, 1920, 1080, 30), 0);
});

test('Which exports can take a size limit', () => {
  assert.ok(canTarget('mp4', 'h264')); assert.ok(canTarget('mkv', 'hevc')); assert.ok(canTarget('webm'));
  assert.ok(!canTarget('gif')); assert.ok(!canTarget('mp3')); assert.ok(!canTarget('mov', 'prores'));
  assert.equal(codecFor('webm', 'h264'), 'vp9');
});

test('Custom resolution: any even size in range, in the project shape; odd or wild values are repaired', () => {
  assert.deepEqual(dimensions('16:9', 1080), [1920, 1080]);
  assert.deepEqual(dimensions('16:9', 540), [960, 540]);
  assert.deepEqual(dimensions('9:16', 540), [540, 960]);
  assert.deepEqual(dimensions('16:9', 1440), [2560, 1440]);
  assert.deepEqual(dimensions('16:9', 2160), [3840, 2160]);
  const [w, h] = dimensions('16:9', 601); assert.equal(w % 2, 0); assert.equal(h % 2, 0);
  assert.deepEqual(dimensions('16:9', 'nonsense'), [1920, 1080]); assert.deepEqual(dimensions('16:9', 99999), [1920, 1080]);
  assert.equal(cleanShort(719), 720); assert.equal(cleanShort(10), 144); assert.equal(cleanShort(1e6), 4320);
});

test('Encoder: a size limit means a hard rate with tight peaks; normal exports keep constant quality', () => {
  const tight = encoderArgs('mp4', { codec: 'h264', bitrate: 3000, tight: true, audioBitrate: 96 });
  assert.equal(tight[tight.indexOf('-b:v') + 1], '3000k'); assert.equal(tight[tight.indexOf('-maxrate') + 1], '3750k');
  assert.equal(tight[tight.indexOf('-preset') + 1], 'slow'); assert.equal(tight[tight.indexOf('-b:a') + 1], '96k');
  const normal = encoderArgs('mp4', { codec: 'h264', quality: 'high', audioBitrate: 192 });
  assert.ok(normal.includes('-crf') && !normal.includes('-b:v')); assert.equal(normal[normal.indexOf('-preset') + 1], 'medium');
});
