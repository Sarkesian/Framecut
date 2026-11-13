// Journey for the November 2026 backlog (Framecut Studio sections 1.1 to 1.5 and 1.7), in the real app:
//   1.1 transitions: select / deselect / edit / delete, preview loop that only plays and stops when told to
//   1.2 preview survives heavy cutting, trimming and moving; playhead kept; a failing frame does not freeze it
//   1.3 export file name box          1.7 custom resolution + "fit under a size"
//   1.4 media shelves: remove from project / from library without touching the file on disk
//   1.5 effects: click previews, another click swaps, Apply is deliberate, Remove effect, stacking on request
const { launchApp } = require('./launch.cjs');
const path = require('node:path'), fs = require('node:fs/promises'), fss = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const { run, ffmpeg, ffprobe } = require('../desktop/tools.cjs');
const shots = path.resolve('test-output');
const step = n => console.log('· ' + n);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await fs.mkdir(shots, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-backlog-')); let app, page; const errors = [];
  try {
    const a = path.join(temp, 'Clip A.mp4'), b = path.join(temp, 'Clip B.mp4'), extra = path.join(temp, 'Spare.mp4'), song = path.join(temp, 'Song.wav');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '15', '-c:a', 'aac', a]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'smptebars=s=1280x720:r=30', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', extra]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '14', song]);
    app = await launchApp({ ...process.env, FRAMECUT_TEST: '1', FRAMECUT_TEST_DIR: temp });
    page = await app.firstWindow(); page.setDefaultTimeout(20000);
    await page.route('**/api/creative/search?*', route => route.fulfill({ json: { items: [], page: 1, pages: 0, total: 0 } }));
    await page.route('**/api/creative/warm?*', route => route.fulfill({ json: { ok: true } }));
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Preview frame failed|injected/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.getByText('New project').first().click();
    await page.locator('.editor').waitFor();
    const S = fn => page.evaluate(fn);
    const st = () => S(() => { const s = window.__fc.state, pl = s.player.current; return { t: pl.t, playing: pl.playing, loop: s.previewLoop.value, range: pl.range, sel: s.selection.value.length, tr: s.transitionSel.value, dur: s.duration.value, time: s.time.value }; });
    // Average brightness of the frame the viewer draws right now (0 = black).
    const lit = () => S(async () => { const pl = window.__fc.state.player.current; const img = new Image(); img.src = pl.snapshot('image/png'); await img.decode(); const c = document.createElement('canvas'); c.width = 32; c.height = 18; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 32, 18); const d = g.getImageData(0, 0, 32, 18).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4 * 3); });
    const shows = async (what, ms = 6000) => { const t0 = Date.now(); let v = 0; while (Date.now() - t0 < ms) { v = await lit(); if (v > 25) return v; await sleep(120); } const why = await S(() => { const pl = window.__fc.state.player.current, plan = pl.getPlan(), t = pl.t; return { t, layers: plan.layers.filter(L => t >= L.vs && t < L.ve).map(L => L.type + ':' + L.clip.id.slice(0, 4) + '@' + L.clip.start.toFixed(2)), tex: [...pl.comp.textures].map(([k, x]) => k.slice(0, 6) + ':' + x.ok + ':' + x.stamp + ':' + x.w), L: plan.layers.filter(L => t >= L.vs && t < L.ve).map(L => ({ vs: L.vs, ve: L.ve, op: L.opacity, fades: L.fades, steps: L.steps, alphaExpr: L.alphaExpr || null, cs: L.clip.start, cd: L.clip.duration, cin: L.clip.in })), pool: [...pl.pool].map(([k, e]) => ({ stamp: e.stamp, k: k.slice(0, 4), rs: e.el.readyState, seeking: e.el.seeking, ct: +(e.el.currentTime || 0).toFixed(2), failed: !!e.failed, err: e.el.error?.message || null, net: e.el.networkState })) }; }); throw Error(`viewer is blank ${what} (brightness ${v.toFixed(1)}) ${JSON.stringify(why)}`); };

    step('import three clips and a song; put A, B and the song on the timeline');
    await page.evaluate(async files => { const { state, api } = window.__fc; const r = await api('/api/media/import', { paths: files }); state.commit('Import', p => { for (const x of r.assets) p.mediaIds.push(x.id); }); await state.refreshMedia(); }, [a, b, extra, song]);
    await page.locator('.media-card').nth(3).waitFor();
    await page.locator('.media-card', { hasText: 'Clip A' }).dblclick();
    await page.locator('.media-card', { hasText: 'Clip B' }).dblclick();
    await page.evaluate(() => { const { state, creative } = window.__fc; const s = [...state.media.value.values()].find(x => x.name === 'Song.wav'); state.player.current.seek(0); creative.insertAudio(s, 'music', { at: 0 }); state.selection.value = []; });
    assert.equal(await page.locator('.track-row.main .clip').count(), 2);
    await shows('after adding clips');

    // ------------------------------------------------------------------ 1.1 transitions
    step('1.1 adding a transition selects it and does NOT start playing');
    await S(() => { window.__fc.state.player.current.seek(3); document.activeElement?.blur(); });
    await page.keyboard.press('r');
    await page.locator('.tr-inspector').waitFor();
    await sleep(500);
    let s = await st(); assert.equal(s.playing, false, 'no playback starts by itself'); assert.equal(s.loop, false); assert.ok(Math.abs(s.t - 3) < 0.01, 'playhead stays put');
    step('1.1 Play preview loops inside the transition; hovering a type never changes play state');
    await page.locator('.tr-inspector .tr-play').click();
    await sleep(300); s = await st(); assert.ok(s.playing && s.loop && s.range, 'looping');
    const [r0, r1] = s.range; assert.ok(r0 < 8 && r1 > 8 && r1 - r0 < 3, 'range sits around the cut at 8 s: ' + s.range);
    await sleep((r1 - r0) * 1000 + 700); s = await st(); assert.ok(s.playing && s.loop, 'still looping after one pass'); assert.ok(s.t >= r0 - 0.05 && s.t <= r1 + 0.05, 'playhead stays in the range: ' + s.t);
    step('1.1 Space pauses and it stays paused (hover, wait, edit length)');
    await S(() => document.activeElement?.blur()); await page.keyboard.press('Space');
    await sleep(150); s = await st(); assert.equal(s.playing, false); assert.equal(s.loop, false);
    const pausedAt = s.t;
    await page.locator('.tr-pick-tile').nth(4).hover(); await sleep(500);
    await page.locator('.tr-pick-tile').nth(1).hover(); await sleep(500);
    await page.locator('.tr-inspector .fchip', { hasText: '1 s' }).click(); await sleep(400);
    s = await st(); assert.equal(s.playing, false, 'hovering types and editing never resumes playback'); assert.ok(Math.abs(s.t - pausedAt) < 0.01, 'and never moves the playhead');
    assert.equal(await page.locator('.tr-inspector .tr-play[aria-pressed="true"]').count(), 0, 'button shows Play again');
    step('1.1 Stop button and scrubbing both end the loop; deselecting mid-loop returns the playhead');
    await page.locator('.tr-inspector .tr-play').click(); await sleep(250); assert.ok((await st()).loop);
    await page.locator('.tr-inspector .tr-play').click(); await sleep(150); s = await st(); assert.ok(!s.playing && !s.loop, 'Stop preview stops');
    await S(() => window.__fc.state.player.current.seek(2)); await page.locator('.tr-inspector .tr-play').click(); await sleep(250);
    await S(() => window.__fc.state.player.current.seek(1)); await sleep(100); s = await st(); assert.equal(s.loop, false, 'seeking away ends the loop');
    await S(() => { const pl = window.__fc.state.player.current; pl.pause(); pl.seek(2); });
    await page.locator('.tr-inspector .tr-play').click(); await sleep(300);
    await page.locator('.tr-inspector .tr-done').click(); await sleep(200);
    s = await st(); assert.equal(s.tr, null, 'Done deselects'); assert.equal(await page.locator('.tr-inspector').count(), 0); assert.equal(s.playing, false, 'deselecting stops the loop'); assert.ok(Math.abs(s.t - 2) < 0.02, 'playhead back where it was: ' + s.t);
    step('1.1 select / deselect: click, click again, Esc, empty timeline, empty viewer');
    const block = page.locator('.tr-block');
    await block.click(); assert.equal(await page.locator('.tr-block.sel').count(), 1); await page.locator('.tr-inspector').waitFor();
    await block.click(); assert.equal(await page.locator('.tr-block.sel').count(), 0, 'second click deselects');
    await block.click(); await page.keyboard.press('Escape'); assert.equal((await st()).tr, null, 'Esc deselects');
    await block.click(); const wrap = await page.locator('.stage-wrap').boundingBox(); await page.mouse.click(wrap.x + 6, wrap.y + 6); assert.equal((await st()).tr, null, 'clicking beside the picture deselects');
    step('1.1 edit on the timeline: drag an end of the block to resize');
    const d0 = await S(() => window.__fc.state.project.value.clips.find(c => c.transition).transition.duration);
    const grip = await page.locator('.tr-block .tr-grip.r').boundingBox();
    await page.mouse.move(grip.x + 3, grip.y + grip.height / 2); await page.mouse.down(); await page.mouse.move(grip.x + 43, grip.y + grip.height / 2, { steps: 5 }); await page.mouse.up();
    const d1 = await S(() => window.__fc.state.project.value.clips.find(c => c.transition).transition.duration);
    assert.ok(d1 > d0 + 0.3, `dragging the end made it longer (${d0} -> ${d1})`);
    assert.ok((await st()).tr, 'the resized transition is selected, not toggled off by the drag');
    step('1.1 delete: Delete key, undo, × on the block');
    await S(() => document.activeElement?.blur()); await page.keyboard.press('Delete');
    assert.equal(await S(() => window.__fc.state.project.value.clips.filter(c => c.transition).length), 0, 'Delete removes the selected transition');
    assert.equal(await page.locator('.track-row.main .clip').count(), 2, 'and no clip');
    await page.keyboard.press('Control+z'); assert.equal(await page.locator('.tr-block').count(), 1, 'undo brings it back');
    await page.locator('.tr-block').click(); await page.locator('.tr-block .tr-x').click();
    assert.equal(await page.locator('.tr-block').count(), 0, '× removes it'); assert.equal((await st()).tr, null);
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); // back to: transition added, default length
    await S(() => { window.__fc.state.transitionSel.value = null; });
    s = await st(); assert.equal(s.tr, null); assert.equal(s.playing, false);

    // ------------------------------------------------------------------ 1.2 preview stability
    step('1.2 cut both clips and the song into many pieces; every piece shows a frame');
    await S(() => { const { state, edit } = window.__fc; state.selection.value = []; for (let t = 0.6; t < 13.6; t += 0.9) { state.player.current.seek(t); edit.bladeCut(t); } state.selection.value = []; });
    const pieces = await S(() => window.__fc.state.project.value.clips.length); assert.ok(pieces >= 30, 'cut into ' + pieces + ' pieces');
    for (const t of [0.3, 1.0, 2.9, 4.4, 6.1, 7.8, 8.3, 9.9, 11.2, 13.0, 5.2, 0.7]) { await page.evaluate(t => window.__fc.state.player.current.seek(t), t); await shows('at ' + t + ' s after cutting'); }
    let pool = await S(() => { const pl = window.__fc.state.player.current; return { video: [...pl.pool.values()].filter(e => !e.image).length, audio: pl.audioEls.size }; });
    console.log('  open players after scrubbing ' + pieces + ' pieces: ' + JSON.stringify(pool));
    assert.ok(pool.video <= 5, 'video players stay bounded: ' + pool.video); assert.ok(pool.audio <= 4, 'sound players stay bounded: ' + pool.audio);
    step('1.2 playing across the cuts keeps drawing, and keeps the players bounded');
    await S(() => { const pl = window.__fc.state.player.current; pl.seek(6.5); pl.play(); }); await sleep(2600);
    s = await st(); assert.ok(s.playing && s.t > 8.5, 'played across the A to B cut: ' + s.t); await shows('while playing');
    pool = await S(() => { const pl = window.__fc.state.player.current; return { video: [...pl.pool.values()].filter(e => !e.image).length, audio: pl.audioEls.size }; });
    assert.ok(pool.video <= 5 && pool.audio <= 4, 'bounded while playing: ' + JSON.stringify(pool));
    step('1.2 a frame that throws does not freeze the viewer');
    await S(() => { const pl = window.__fc.state.player.current, real = pl.comp.render.bind(pl.comp); window.__inj = 3; pl.comp.render = (...x) => { if (window.__inj > 0) { window.__inj--; throw Error('injected'); } return real(...x); }; });
    await page.waitForFunction(() => window.__inj === 0, null, { timeout: 15000, polling: 50 }); // three frames in a row have thrown
    const tA = (await st()).t; await sleep(1200); s = await st();
    assert.ok(s.playing && s.t > tA + 0.3, 'still playing after frame errors: ' + JSON.stringify({ tA, s })); await shows('after frame errors');
    await S(() => window.__fc.state.player.current.pause());
    step('1.2 edits keep the playhead; moving a piece to another track, trimming and deleting keep the picture');
    await S(() => { const { state } = window.__fc; state.player.current.seek(4.0); });
    const moved = await S(() => { const { state, edit } = window.__fc; const p = state.project.value; const c = p.clips.find(x => x.trackId === 'main' && x.start <= 4.0 && x.start + x.duration > 4.0); state.commit('Move up', d => { const t = edit.addTrack(d, 'video'); d.clips.find(x => x.id === c.id).trackId = t.id; }); return c.id; });
    s = await st(); assert.ok(moved); await shows('after moving a piece to an overlay track');
    await S(() => { const { state, edit } = window.__fc; const p = state.project.value, t = state.time.value; const c = p.clips.filter(x => x.kind === 'video' && x.start <= t && x.start + x.duration > t).at(-1); edit.trimClip(c.id, 'end', c.start + c.duration - 0.2); edit.trimClip(c.id, 'start', c.start + 0.1); });
    await shows('after trimming under the playhead');
    const before = (await st()).t;
    await S(() => { const { state, edit } = window.__fc; const p = state.project.value; edit.deleteClips([p.clips.filter(x => x.trackId === 'main').sort((x, y) => x.start - y.start)[0].id]); });
    s = await st(); assert.ok(Math.abs(s.t - before) < 0.01, 'deleting a clip elsewhere keeps the playhead'); await shows('after deleting a piece');
    step('1.2 shortening the project past the playhead moves it to the new end, never beyond');
    await S(() => { const { state } = window.__fc; state.player.current.seek(state.duration.value); });
    await S(() => { const { state, edit } = window.__fc; const p = state.project.value; const end = Math.max(...p.clips.map(c => c.start + c.duration)); edit.deleteClips(p.clips.filter(c => c.start + c.duration > end - 2.5).map(c => c.id)); });
    s = await st(); assert.ok(s.t <= s.dur + 1e-3 && s.time <= s.dur + 1e-3, `playhead ${s.t} within new duration ${s.dur}`);
    await S(() => { const { state } = window.__fc; for (let i = 0; i < 80 && state.history.value.past.length > 4; i++) state.undo(); state.player.current.seek(1); state.selection.value = []; });
    await shows('after undoing everything');

    // ------------------------------------------------------------------ 1.5 effects
    step('1.5 clicking an effect only previews it; another click swaps the preview');
    await page.locator('.track-row.main .clip').first().click({ position: { x: 20, y: 30 } });
    const clipId = await S(() => window.__fc.state.selection.value[0]);
    const fxOf = () => page.evaluate(id => (window.__fc.state.project.value.clips.find(c => c.id === id).effects || []).map(e => e.id), clipId);
    await page.locator('.rail-btn', { hasText: 'Effects' }).click();
    const tiles = page.locator('.fx-tab .fx-tile'); await tiles.nth(2).waitFor();
    const undoDepth = () => S(() => window.__fc.state.history.value.past.length);
    const depth0 = await undoDepth();
    await tiles.nth(0).click();
    assert.deepEqual(await fxOf(), [], 'nothing applied by a click'); assert.equal(await undoDepth(), depth0, 'no undo entry either');
    const pick1 = await S(() => window.__fc.state.effectPick.value?.id); assert.ok(pick1, 'a preview is running');
    await page.locator('.fx-trying').waitFor(); await page.locator('.fx-card').waitFor();
    await tiles.nth(1).click(); const pick2 = await S(() => window.__fc.state.effectPick.value?.id);
    assert.ok(pick2 && pick2 !== pick1, 'the second click replaced the preview'); assert.deepEqual(await fxOf(), []);
    step('1.5 Esc cancels the preview and keeps the selection; Apply is the deliberate step');
    await S(() => document.activeElement?.blur()); await page.keyboard.press('Escape');
    assert.equal(await S(() => window.__fc.state.effectPick.value), null); assert.equal((await st()).sel, 1, 'clip still selected');
    await tiles.nth(1).click(); await page.locator('.fx-card .fx-apply').click();
    assert.deepEqual(await fxOf(), [pick2], 'Apply puts it on the clip'); assert.equal(await S(() => window.__fc.state.effectPick.value), null);
    step('1.5 applying another replaces; stacking only on request; Remove effect');
    await tiles.nth(0).click(); assert.deepEqual(await fxOf(), [pick2], 'previewing a second effect changes nothing yet');
    await page.locator('.fx-card .fx-apply', { hasText: 'Replace' }).click();
    assert.deepEqual(await fxOf(), [pick1], 'Replace swaps, it does not pile up');
    await tiles.nth(1).click(); await page.locator('.fx-card .fx-add-top').click();
    assert.deepEqual(await fxOf(), [pick1, pick2], 'Add on top stacks deliberately');
    await page.locator('.fx-applied .fx-remove').first().click();
    assert.deepEqual(await fxOf(), [pick2], 'Remove effect takes one off');
    await page.locator('.insp-tabs button', { hasText: 'Effects' }).click();
    await page.locator('.inspector .fx-remove').first().click();
    assert.deepEqual(await fxOf(), [], 'Remove effect in the inspector too');
    step('1.5 with nothing selected the preview is a whole-frame layer, added only on Apply');
    await S(() => { window.__fc.state.selection.value = []; });
    const clips0 = await S(() => window.__fc.state.project.value.clips.length);
    await tiles.nth(0).click(); assert.equal(await S(() => window.__fc.state.project.value.clips.length), clips0, 'no layer yet');
    await page.locator('.fx-card .fx-apply').click();
    assert.equal(await S(() => window.__fc.state.project.value.clips.filter(c => c.kind === 'adjust').length), 1, 'Apply adds one effect layer');
    await page.keyboard.press('Control+z');

    // ------------------------------------------------------------------ 1.4 media
    step('1.4 two shelves; remove from project keeps the library and the file');
    await page.locator('.rail-btn', { hasText: 'Media' }).click();
    await page.locator('.media-scopes button.on', { hasText: 'This project' }).waitFor();
    assert.equal(await page.locator('.media-card').count(), 4);
    const spare = page.locator('.media-card', { hasText: 'Spare' });
    await spare.hover(); await spare.locator('.rm-btn').click();
    assert.equal(await page.locator('.media-card', { hasText: 'Spare' }).count(), 0, 'gone from this project (unused file: no dialog needed)');
    assert.ok(fss.existsSync(extra), 'file still on disk');
    await page.locator('.media-scopes button', { hasText: 'Library' }).click();
    await page.locator('.media-card', { hasText: 'Spare' }).waitFor();
    step('1.4 removing a file that is on the timeline asks first, removes its clips, and undo restores');
    await page.locator('.media-scopes button', { hasText: 'This project' }).click();
    const nB = await S(() => { const s = window.__fc.state; const m = [...s.media.value.values()].find(x => x.name === 'Clip B.mp4'); return s.project.value.clips.filter(c => c.mediaId === m.id).length; });
    assert.ok(nB >= 1);
    const cardB = page.locator('.media-card', { hasText: 'Clip B' }); await cardB.hover(); await cardB.locator('.rm-btn').click();
    await page.locator('.modal', { hasText: 'from this project?' }).waitFor();
    await page.locator('.modal-foot .btn.ghost').click(); // Cancel changes nothing
    assert.equal(await page.locator('.media-card', { hasText: 'Clip B' }).count(), 1);
    await cardB.hover(); await cardB.locator('.rm-btn').click(); await page.locator('.modal-foot .btn.danger').click();
    assert.equal(await S(() => { const s = window.__fc.state; const m = [...s.media.value.values()].find(x => x.name === 'Clip B.mp4'); return s.project.value.clips.filter(c => c.mediaId === m.id).length + (s.project.value.mediaIds.includes(m.id) ? 100 : 0); }), 0, 'file and its clips are out of the project');
    assert.ok(fss.existsSync(b), 'Clip B file untouched');
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('.media-card', { hasText: 'Clip B' }).count(), 1, 'undo restores it');
    step('1.4 remove from library: confirmation, file on disk untouched');
    await page.locator('.media-scopes button', { hasText: 'Library' }).click();
    const sp = page.locator('.media-card', { hasText: 'Spare' }); await sp.hover(); await sp.locator('.rm-btn').click();
    const dlg = page.locator('.modal', { hasText: 'from the library?' }); await dlg.waitFor();
    assert.match(await dlg.innerText(), /stays exactly where it is/);
    await page.locator('.modal-foot .btn.danger').click();
    await page.waitForFunction(() => ![...window.__fc.state.media.value.values()].some(x => x.name === 'Spare.mp4'));
    assert.ok(fss.existsSync(extra), 'Spare.mp4 is still on disk after leaving the library');
    await page.screenshot({ path: path.join(shots, 'backlog-media.png') });
    await page.locator('.media-scopes button', { hasText: 'This project' }).click();

    // ------------------------------------------------------------------ 1.3 + 1.7 export
    step('1.3 export has a file name box that renames in place');
    const outDir = path.join(temp, 'out');
    await page.keyboard.press('Control+e');
    await page.waitForFunction(() => document.querySelector('.modal input[aria-label="Output file"]')?.value);
    assert.ok((await page.locator('.modal input[aria-label="File name"]').inputValue()).length > 0, 'file name is pre-filled from the project');
    await page.locator('.modal input[aria-label="Output file"]').fill(path.join(outDir, 'First.mp4'));
    assert.equal(await page.locator('.modal input[aria-label="File name"]').inputValue(), 'First');
    await page.locator('.modal input[aria-label="File name"]').fill('Trip: day/one?');
    assert.equal(await page.locator('.modal input[aria-label="File name"]').inputValue(), 'Trip dayone', 'characters Windows refuses are left out');
    await page.locator('.modal input[aria-label="File name"]').fill('Small one');
    assert.equal(await page.locator('.modal input[aria-label="Output file"]').inputValue(), path.join(outDir, 'Small one.mp4'), 'same folder, new name, extension kept');
    step('1.7 resolution presets, custom resolution, target size with an estimate');
    for (const r of ['1080p', '1440p', '4K']) assert.equal(await page.locator('.modal .res-chips .fchip', { hasText: r }).count(), 1, r + ' preset offered');
    await page.locator('.modal .res-chips .fchip', { hasText: '4K' }).click();
    await page.locator('.modal .segmented button', { hasText: 'Fit under a size' }).click();
    await page.locator('.modal input[aria-label="Target file size in megabytes"]').fill('1');
    await page.locator('.modal .size-line.bad, .modal .size-line.warn').waitFor(); // 1 MB cannot carry 4K: it says so and offers a size that works
    await page.locator('.modal .size-line .btn', { hasText: 'Use' }).click();
    await page.locator('.modal .res-chips .fchip', { hasText: 'Custom' }).click();
    await page.locator('.modal input[aria-label="Height in pixels"]').fill('540'); await page.locator('.modal input[aria-label="Height in pixels"]').blur();
    assert.equal(await page.locator('.modal input[aria-label="Width in pixels"]').inputValue(), '960', 'custom size keeps the project shape');
    const estText = await page.locator('.modal .export-est').innerText(); assert.match(estText, /up to/i, 'estimate shown before exporting: ' + estText);
    await page.screenshot({ path: path.join(shots, 'backlog-export.png') });
    const fpsWanted = await S(() => window.__fc.state.project.value.settings.fps);
    await page.locator('.modal-foot .btn.primary').click();
    await page.getByText('Your video is ready').waitFor({ timeout: 180000 });
    const out = path.join(outDir, 'Small one.mp4');
    const info = JSON.parse((await run(ffprobe, ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', out])).out);
    const v = info.streams.find(x => x.codec_type === 'video'); const size = (await fs.stat(out)).size;
    console.log(`  exported ${v.width}x${v.height} @ ${v.r_frame_rate}, ${(size / 1e6).toFixed(2)} MB for ${(+info.format.duration).toFixed(1)} s`);
    assert.equal(v.height, 540); assert.equal(v.width, 960); assert.equal(eval(v.r_frame_rate), fpsWanted, 'frame rate preserved');
    assert.ok(size <= 1e6, `file is under the 1 MB target (${size} bytes)`); assert.ok(size > 0.35e6, 'and uses the budget rather than starving the picture');
    await page.locator('.modal-head .icon-btn').click();

    console.log('ERRORS', JSON.stringify(errors));
    assert.deepEqual(errors.filter(e => !/Autofill|DevTools/.test(e)), []);
    console.log('PASS: backlog journey');
  } catch (e) { console.error('FAIL', e.stack || e.message); await page?.screenshot({ path: path.join(shots, 'backlog-fail.png') }).catch(() => {}); console.log('ERRORS', JSON.stringify(errors)); process.exitCode = 1; }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
})();
