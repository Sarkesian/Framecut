// Self-contained layout: relative persistence, protected-folder detection, contained tool environment.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('../desktop/paths.cjs');

test('paths inside data are stored relative and survive moving the folder to another drive', () => {
  const a = 'D:\\Apps\\FrameCut Studio\\data', b = 'E:\\Portable\\FrameCut\\data';
  const asset = { path: a + '\\media\\recordings\\take 1.wav', thumb: a + '\\cache\\thumbs\\x.jpg', strip: { file: a + '\\cache\\filmstrips\\x.jpg' }, outside: 'C:\\Users\\me\\Videos\\clip.mp4', list: [a + '\\fonts\\f.ttf'], n: 3 };
  const stored = P.toStored(asset, a);
  assert.equal(stored.path, '@data/media/recordings/take 1.wav');
  assert.equal(stored.strip.file, '@data/cache/filmstrips/x.jpg');
  assert.equal(stored.outside, asset.outside, 'external media keeps its absolute path');
  assert.ok(!JSON.stringify(stored).includes('D:'), 'no drive letter for internal files');
  const back = P.fromStored(JSON.parse(JSON.stringify(stored)), b);
  assert.equal(back.path, path.join(b, 'media', 'recordings', 'take 1.wav'));
  assert.equal(back.list[0], path.join(b, 'fonts', 'f.ttf'));
  assert.equal(back.n, 3);
  // A sibling folder whose name merely starts with "data" is not inside data.
  assert.equal(P.toStored(a + '2\\x.mp4', a), a + '2\\x.mp4');
});

test('protected Windows folders are recognised', () => {
  const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', SystemRoot: 'C:\\Windows', ProgramData: 'C:\\ProgramData' };
  assert.ok(P.isProtectedLocation('C:\\Program Files\\FrameCut Studio', env));
  assert.ok(P.isProtectedLocation('c:\\program files (x86)\\FrameCut Studio', env));
  assert.ok(!P.isProtectedLocation('C:\\Program Files Extra\\FrameCut', env));
  assert.ok(!P.isProtectedLocation('D:\\Apps\\FrameCut Studio', env));
});

test('writable check and tool environment stay inside data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-paths-'));
  try {
    assert.equal(P.writableProblem(path.join(dir, 'with space', 'data')), null);
    const env = P.toolEnv(path.join(dir, 'data'), { HF_HOME: 'x' });
    assert.equal(env.TEMP, path.join(dir, 'data', 'temp'));
    assert.equal(env.TMP, env.TEMP);
    assert.equal(env.HF_HOME, 'x');
    assert.ok(env.TORCH_HOME.startsWith(path.join(dir, 'data')));
    assert.equal(env.PIP_NO_CACHE_DIR, '1');
    assert.equal(env.PYTHONPATH, undefined);
    P.resetTemp(env.TEMP); fs.writeFileSync(path.join(env.TEMP, 'left-over'), 'x'); P.resetTemp(env.TEMP);
    assert.deepEqual(fs.readdirSync(env.TEMP), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
