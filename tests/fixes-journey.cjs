// User-testing fixes, in the real app: stickers dropped on the player appear immediately where dropped;
// the blade tool and "Split here" cut clips; Snap and Gapless-main are distinct labelled toggles;
// Close gaps closes every gap at once (and undoes in one step).
const { _electron: electron } = require('playwright');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const assert = require('node:assert/strict');
const { run, ffmpeg } = require('../desktop/tools.cjs');
const shots = path.resolve('test-output');
const step = n => console.log('· ' + n);
(async () => {
  await fs.mkdir(shots, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-fixes-')); let app, page; const errors = [];
  try {
    const a = path.join(temp, 'A.mp4'), b = path.join(temp, 'B.mp4'), song = path.join(temp, 'Song.wav');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x406080:s=1280x720:r=30:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', a]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x805040:s=1280x720:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '4', song]);
    const env = { ...process.env, FRAMECUT_TEST_DIR: temp }; delete env.FRAMECUT_TEST; // visible window: real rendering
    app = await electron.launch({ args: [path.resolve('.')], env });
    page = await app.firstWindow();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
    const ids = await page.evaluate(async f => { const { state, api, edit } = window.__fc; const r = await api('/api/media/import', { paths: f }); await state.refreshMedia(); edit.addAssets([r.assets[0], r.assets[1]], { at: 0 }); return r.assets.map(x => x.id); }, [a, b, song]);
    const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fc.state.project.value)));

    step('sticker dropped on the player: visible at once, where it was dropped');
    await page.evaluate(() => window.__fc.state.player.current.seek(1)); await page.waitForTimeout(500);
    await page.locator('.rail-btn', { hasText: 'Stickers' }).click();
    await page.locator('.lib-tabs button', { hasText: 'Static' }).click(); await page.locator('.fchip', { hasText: 'Smileys' }).click();
    const sb = await page.locator('.stage-canvas').boundingBox(), wb = await page.locator('.stage-wrap').boundingBox();
    await page.locator('.emoji').first().dragTo(page.locator('.stage-wrap'), { targetPosition: { x: sb.x - wb.x + sb.width * 0.25, y: sb.y - wb.y + sb.height * 0.3 } });
    await page.waitForTimeout(800);
    let st = (await P()).clips.find(c => c.kind === 'sticker');
    assert.ok(st, 'sticker added'); assert.equal(st.start, 1); assert.ok(!st.animIn, 'no entrance animation hides it on the drop frame');
    assert.ok(Math.abs(st.transform.x + 0.25) < 0.03 && Math.abs(st.transform.y + 0.2) < 0.03, 'placed where dropped: ' + JSON.stringify(st.transform));
    const vis = await page.evaluate(id => { const pl = window.__fc.state.player.current; const L = pl.getPlan().layers.find(x => x.id === id); return { s: L.motion.s, fades: L.fades.length, active: pl.t >= L.vs && pl.t < L.ve }; }, st.id);
    assert.deepEqual(vis, { s: null, fades: 0, active: true }, 'full size and opaque on the frame it was dropped');
    await page.waitForTimeout(500);
    const fit = await page.evaluate(() => { const g = document.querySelector('.gizmo').getBoundingClientRect(); return g.width / g.height; });
    assert.ok(Math.abs(fit - 1) < 0.1, 'selection box matches the square emoji, ratio ' + fit.toFixed(2));
    await page.screenshot({ path: path.join(shots, 'fix-1-sticker-drop.png'), clip: { x: 340, y: 40, width: 930, height: 590 } });

    step('toolbar: Snap and Gapless main are separate, labelled toggles');
    const snapBtn = page.locator('.tl-toggle', { hasText: 'Snap' }), magBtn = page.locator('.tl-toggle', { hasText: 'Gapless main' });
    await snapBtn.waitFor(); await magBtn.waitFor();
    await snapBtn.click(); assert.equal((await P()).settings.snapping, false); assert.equal((await P()).settings.magnetic, true, 'snap toggle leaves the main track alone');
    await snapBtn.click(); assert.equal((await P()).settings.snapping, true);
    await page.locator('.tl-toolbar').screenshot({ path: path.join(shots, 'fix-3-toolbar.png') });

    step('blade: C, click a clip to cut it there; Shift+click cuts all tracks; Esc leaves');
    await page.keyboard.press('Escape'); await page.evaluate(() => { window.__fc.state.selection.value = []; });
    await page.keyboard.press('c');
    assert.equal(await page.evaluate(() => document.querySelector('.timeline').classList.contains('blade-on')), true);
    const z = await page.evaluate(() => window.__fc.state.zoom.value);
    const clipA = page.locator('.track-row.main .clip').first(); const ca = await clipA.boundingBox();
    await clipA.hover({ position: { x: 2.5 * z, y: ca.height / 2 } });
    assert.ok(await page.locator('.blade-line').isVisible(), 'cut line follows the pointer');
    await clipA.click({ position: { x: 2.5 * z, y: ca.height / 2 } });
    let p = await P(); let mains = p.clips.filter(c => c.trackId === 'main').sort((x, y) => x.start - y.start);
    assert.equal(mains.length, 3, 'clip cut in two'); assert.ok(Math.abs(mains[0].duration - 2.5) < 0.05, 'cut where clicked: ' + mains[0].duration);
    // A sticker spans 1–4 s: Shift+click at 3 s cuts the main clip and the sticker.
    const lane = page.locator('.track-row.main .track-lane'); const lb = await lane.boundingBox();
    await page.mouse.move(lb.x + 3.2 * z, lb.y + lb.height / 2); await page.keyboard.down('Shift'); await page.mouse.down(); await page.mouse.up(); await page.keyboard.up('Shift');
    p = await P(); assert.equal(p.clips.filter(c => c.kind === 'sticker').length, 2, 'Shift+click cuts other tracks too'); assert.equal(p.clips.filter(c => c.trackId === 'main').length, 4);
    await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.querySelector('.timeline').classList.contains('blade-on')), false, 'Esc turns the blade off');
    await page.locator('.timeline').screenshot({ path: path.join(shots, 'fix-2-blade.png') });

    step('right-click → Split here');
    const last = page.locator('.track-row.main .clip').last(); const lbx = await last.boundingBox();
    await last.click({ button: 'right', position: { x: lbx.width / 2, y: lbx.height / 2 } });
    await page.locator('.menu button', { hasText: 'Split here' }).click();
    assert.equal((await P()).clips.filter(c => c.trackId === 'main').length, 5);

    step('Close gaps closes every gap in one step');
    await page.evaluate(id => { const { state, edit } = window.__fc; state.commit('Gaps', d => { d.settings.magnetic = false; const m = d.clips.filter(c => c.trackId === 'main').sort((a, b) => a.start - b.start); m[1].start += 1; m[2].start += 2.5; m[3].start += 3; m[4].start += 4; }); edit.addAssets([state.media.value.get(id)], { at: 6 }); }, ids[2]);
    const gapsBefore = await page.evaluate(() => { const p = window.__fc.state.project.value; return p.tracks.reduce((n, t) => n + window.__fc.edit.trackGaps(p, t.id).length, 0); });
    assert.ok(gapsBefore >= 5, 'gaps set up: ' + gapsBefore);
    await page.locator('.tl-toggle', { hasText: 'Close gaps' }).click();
    p = await P();
    const gapsAfter = await page.evaluate(() => { const p = window.__fc.state.project.value; return p.tracks.filter(t => !t.captions).reduce((n, t) => n + window.__fc.edit.trackGaps(p, t.id).length, 0); });
    assert.equal(gapsAfter, 0, 'no gaps left');
    mains = p.clips.filter(c => c.trackId === 'main').sort((x, y) => x.start - y.start); for (let i = 1; i < mains.length; i++) assert.ok(Math.abs(mains[i].start - (mains[i - 1].start + mains[i - 1].duration)) < 1e-6);
    assert.ok(await page.locator('.toast', { hasText: /Closed \d+ gaps/ }).first().isVisible());
    await page.keyboard.press('Control+z');
    const undone = await page.evaluate(() => { const p = window.__fc.state.project.value; return p.tracks.reduce((n, t) => n + window.__fc.edit.trackGaps(p, t.id).length, 0); });
    assert.equal(undone, gapsBefore, 'one undo restores every gap');
    await page.keyboard.press('Alt+g'); assert.equal(await page.evaluate(() => { const p = window.__fc.state.project.value; return p.tracks.filter(t => !t.captions).reduce((n, t) => n + window.__fc.edit.trackGaps(p, t.id).length, 0); }), 0, 'Alt+G shortcut');
    console.log('ERRORS', JSON.stringify(errors)); assert.deepEqual(errors, []);
    console.log('PASS: fixes');
  } catch (e) { console.log('FAIL', e.message); await page?.screenshot({ path: path.join(shots, 'fail-fixes.png') }); process.exitCode = 1; }
  finally { await app?.close(); }
})();
