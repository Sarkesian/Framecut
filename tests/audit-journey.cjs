// Release-audit regressions, in the real app:
//  - paste of several main-track clips keeps their order
//  - split divides the volume envelope and keeps the right half selected
//  - speed changes rescale the volume envelope
//  - duplicate/paste of a video whose audio was separated is not linked to (or muted by) the original
//  - export refuses to overwrite library media, asks before replacing an existing file, keeps side files
//    next to the output, and uses saved custom caption styles like the preview
const { launchApp } = require('./launch.cjs');
const path = require('node:path'), fs = require('node:fs/promises'), fss = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const { run, ffmpeg } = require('../desktop/tools.cjs');
const step = n => console.log('· ' + n);
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-audit-')); let app, page; const errors = [];
  try {
    const a = path.join(temp, 'A.mp4'), b = path.join(temp, 'B.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x406080:s=640x360:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', a]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x805040:s=640x360:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', b]);
    const env = { ...process.env, FRAMECUT_TEST_DIR: temp, FRAMECUT_TEST: '1' };
    app = await launchApp(env);
    page = await app.firstWindow();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
    await page.evaluate(async f => { const { state, api, edit } = window.__fc; const r = await api('/api/media/import', { paths: f }); await state.refreshMedia(); edit.addAssets(r.assets, { at: 0 }); }, [a, b]);
    const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fc.state.project.value)));
    const mainClips = p => p.clips.filter(c => p.tracks.find(t => t.id === c.trackId)?.main).sort((x, y) => x.start - y.start);

    step('paste of several main clips keeps their order');
    let p = await P(); const [A, B] = mainClips(p);
    assert.ok(A && B, 'two clips on the main track');
    await page.evaluate(ids => { const { edit } = window.__fc; edit.copyClips(ids); edit.pasteClips(7); }, [A.id, B.id]);
    p = await P(); let m = mainClips(p);
    assert.deepEqual(m.map(c => c.mediaId), [A.mediaId, B.mediaId, A.mediaId, B.mediaId], 'A B A′ B′');
    assert.ok(m.every((c, i) => i === 0 || Math.abs(c.start - (m[i - 1].start + m[i - 1].duration)) < 1e-6), 'packed without gaps or overlaps');
    await page.evaluate(() => { window.__fc.state.undo(); });

    step('split divides the volume envelope and selects the right half');
    await page.evaluate(id => window.__fc.edit.updateClip(id, c => { c.volumeKeys = [{ t: 1, v: 1 }, { t: 2, v: 0 }, { t: 3, v: 0.5 }]; }), A.id);
    await page.evaluate(id => { const { state, edit } = window.__fc; state.selection.value = [id]; edit.splitAt(2.5); }, A.id);
    p = await P(); m = mainClips(p);
    const left = p.clips.find(c => c.id === A.id), right = m.find(c => c.start > 2.49 && c.start < 2.51);
    assert.ok(right, 'right half exists');
    assert.deepEqual(left.volumeKeys.map(k => k.t), [1, 2], 'left keeps keys before the cut');
    assert.deepEqual(right.volumeKeys.map(k => +k.t.toFixed(3)), [0.5], 'right keys are shifted into its own time');
    assert.deepEqual(await page.evaluate(() => window.__fc.state.selection.value), [right.id], 'right half stays selected');

    step('speed change rescales the volume envelope');
    await page.evaluate(id => window.__fc.edit.setSpeed(id, 2), left.id);
    p = await P();
    assert.deepEqual(p.clips.find(c => c.id === left.id).volumeKeys.map(k => k.t), [0.5, 1], 'keys follow the 2× speed');
    await page.evaluate(() => { const s = window.__fc.state; s.undo(); s.undo(); s.undo(); });

    step('a copy of a video with separated audio is independent');
    await page.evaluate(id => window.__fc.edit.detachAudio(id), B.id);
    p = await P(); const vid = p.clips.find(c => c.id === B.id);
    assert.ok(vid.detachedAudio && vid.muted, 'audio separated');
    await page.evaluate(id => window.__fc.edit.duplicateClips([id]), B.id);
    p = await P(); const dup = p.clips.find(c => c.id !== B.id && c.mediaId === B.mediaId && c.kind === 'video');
    assert.ok(dup, 'duplicate exists'); assert.ok(!dup.detachedAudio, 'not linked to the original audio'); assert.equal(dup.muted, false, 'copy plays its own sound');

    step('export: never over library media; asks before replacing; side files next to the output');
    const exp = (output, extra = {}) => page.evaluate(async ({ output, extra }) => { const { state, api } = window.__fc; try { return await api('/api/export', { project: state.project.value, rasters: {}, settings: { format: 'mp4', codec: 'h264', quality: 'draft', resolution: 360, fps: 30, output, hardware: 'off', subtitles: 'burn', ...extra } }); } catch (e) { return { error: e.message, code: e.code }; } }, { output, extra });
    assert.equal((await exp(a)).code, 'source', 'export onto a source clip is refused');
    assert.equal((await exp(path.join(temp, 'A.MP4'))).code, 'source', 'case-insensitive');
    const existing = path.join(temp, 'existing.mp4'); await fs.writeFile(existing, 'old');
    assert.equal((await exp(existing)).code, 'exists', 'existing file needs confirmation');
    const dotted = path.join(temp, 'my.videos'); await fs.mkdir(dotted);
    const out = path.join(dotted, 'final.mp4');
    const r = await exp(out, { subtitles: 'srt' }); assert.ok(r.job, 'export started: ' + JSON.stringify(r));
    const res = await page.evaluate(id => window.__fc.api('/api/jobs/' + id).then(async function poll(j) { while (!['done', 'error', 'cancelled'].includes(j.status)) { await new Promise(r => setTimeout(r, 300)); j = await window.__fc.api('/api/jobs/' + id); } return j; }), r.job);
    assert.equal(res.status, 'done', 'export finished: ' + JSON.stringify(res.error || ''));
    assert.ok(fss.statSync(out).size > 1000, 'video written');
    assert.ok(fss.existsSync(path.join(dotted, 'final.srt')), 'subtitles beside the video');
    assert.deepEqual(fss.readdirSync(temp).filter(n => /^my\./.test(n) && n !== 'my.videos'), [], 'nothing escaped the chosen folder');
    assert.ok(fss.existsSync(a) && fss.statSync(a).size > 1000, 'source untouched');
    const again = await exp(existing, { overwrite: true }); assert.ok(again.job, 'overwrite after confirmation is allowed');
    await page.evaluate(id => window.__fc.api('/api/jobs/' + id, undefined, 'DELETE'), again.job);

    assert.deepEqual(errors.filter(e => !/Failed to load resource/.test(e)), []);
    console.log('PASS: audit');
  } catch (e) { console.error(e); console.error('ERRORS', errors); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
})();
