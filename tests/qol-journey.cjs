// Editing quality-of-life journey in the real desktop app, driven with real mouse/keyboard input:
// stuck-drag regressions (click-to-seek, scrub, release outside, lost release, rapid clicks, scrubbing during
// playback, Escape mid-drag), magnetic timeline snapping (frame-exact, zoom-independent, Alt bypass, toggle,
// one undo per trim), live text editing (inspector and in-viewer), viewer snapping/alignment/nudging/locking,
// multi-select keyframe editing, Ctrl+drag duplicate, zoom around the cursor and gap highlighting.
const { launchApp } = require('./launch.cjs');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const assert = require('node:assert/strict');
const { run, ffmpeg } = require('../desktop/tools.cjs');
const shots = path.resolve('test-output');
const step = n => console.log('· ' + n);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);
(async () => {
  await fs.mkdir(shots, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-qol-')); let app, page; const errors = [];
  try {
    const clip = path.join(temp, 'A.mp4'), clip2 = path.join(temp, 'B.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'mandelbrot=s=1280x720:r=30', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip2]);
    app = await launchApp({ ...process.env, FRAMECUT_TEST: '1', FRAMECUT_TEST_DIR: temp });
    page = await app.firstWindow();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
    const ids = await page.evaluate(async files => {
      const { state, api, edit } = window.__fc; const r = await api('/api/media/import', { paths: files }); await state.refreshMedia();
      edit.addAssets([r.assets[0]], { at: 0 }); edit.addAssets([r.assets[1]], { at: 8 });
      state.player.current.seek(1); const textId = edit.addText({ text: 'Title', at: 1, duration: 2 });
      state.zoom.value = 80; document.querySelector('.tl-scroll').scrollLeft = 0;
      const p = state.project.value; return { a: p.clips.find(c => c.kind === 'video' && c.start === 0).id, text: textId };
    }, [clip, clip2]);
    await page.locator('.track-row.main .clip').nth(1).waitFor();
    const S = () => page.evaluate(() => { const s = window.__fc.state; return { t: s.time.value, playing: s.playing.value, dragging: window.__fc.drag.isDragging(), drag: s.drag.value, fps: s.project.value.settings.fps }; });
    const clipOf = id => page.evaluate(i => { const c = window.__fc.state.project.value.clips.find(x => x.id === i); return c && JSON.parse(JSON.stringify(c)); }, id);
    const geo = () => page.evaluate(() => { const el = document.querySelector('.tl-scroll'), r = el.getBoundingClientRect(), ru = document.querySelector('.ruler').getBoundingClientRect(); return { x0: r.left + 168 - el.scrollLeft, z: window.__fc.state.zoom.value, ry: ru.top + ru.height / 2 }; });
    let g = await geo(); const xOf = t => g.x0 + t * g.z;
    const frameExact = (t, fps) => Math.abs(t * fps - Math.round(t * fps)) < 1e-6;

    // ---------------- Stuck drag / playhead ----------------
    step('click on the ruler seeks exactly there (frame-exact) and the playhead does not follow the pointer afterwards');
    await page.mouse.click(xOf(2.0), g.ry);
    let s = await S(); near(s.t, 2.0, 1 / 30 + 1e-6, 'click-to-seek'); assert.ok(frameExact(s.t, s.fps), 'frame exact'); assert.equal(s.dragging, false);
    await page.mouse.move(xOf(4.5), g.ry, { steps: 8 }); await page.mouse.move(xOf(0.7), g.ry, { steps: 8 });
    assert.equal((await S()).t, s.t, 'hovering the ruler after release must not move the playhead (the original stuck-playhead bug)');

    step('drag to scrub, release stops exactly at the release point');
    await page.mouse.move(xOf(1), g.ry); await page.mouse.down(); await page.mouse.move(xOf(3.3), g.ry, { steps: 12 });
    near((await S()).t, 3.3, 1 / 30 + 1e-6, 'scrubbing follows during the drag');
    assert.ok(await page.locator('.tl-readout').isVisible(), 'timecode readout while scrubbing');
    await page.mouse.up(); s = await S(); near(s.t, 3.3, 1 / 30 + 1e-6, 'release position'); assert.equal(s.dragging, false);
    assert.equal(await page.locator('.tl-readout').count(), 0, 'readout hidden after release');
    await page.mouse.move(xOf(5), g.ry, { steps: 6 }); assert.equal((await S()).t, s.t, 'no following after scrub release');

    step('release outside the window ends the drag');
    await page.mouse.move(xOf(1), g.ry); await page.mouse.down(); await page.mouse.move(xOf(2.5), g.ry, { steps: 5 });
    await page.mouse.move(-60, g.ry - 400, { steps: 5 }); await page.mouse.up();
    s = await S(); assert.equal(s.dragging, false, 'drag ended outside the window');
    await page.mouse.move(xOf(6), g.ry, { steps: 6 }); assert.equal((await S()).t, s.t, 'no following after an outside release');

    step('a release that never arrives (move with no button) and pointercancel both end the drag');
    await page.mouse.move(xOf(1), g.ry); await page.mouse.down(); await page.mouse.move(xOf(2), g.ry, { steps: 4 });
    await page.evaluate(x => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: x, clientY: 10, bubbles: true })), xOf(5));
    assert.equal((await S()).dragging, false, 'buttonless move ends the drag'); await page.mouse.up();
    const t0 = (await S()).t; await page.mouse.move(xOf(4), g.ry, { steps: 4 }); assert.equal((await S()).t, t0);
    await page.mouse.move(xOf(1), g.ry); await page.mouse.down(); await page.mouse.move(xOf(1.5), g.ry, { steps: 3 });
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true })));
    assert.equal((await S()).dragging, false, 'pointercancel ends the drag'); await page.mouse.up();

    step('rapid repeated clicks, then dragging the playhead handle');
    for (const t of [0.5, 4, 1.2, 6.5, 2.2, 7.1, 3.4]) await page.mouse.click(xOf(t), g.ry);
    s = await S(); near(s.t, 3.4, 1 / 30 + 1e-6, 'last click wins'); assert.equal(s.dragging, false);
    const ph = await page.locator('.ph-head').boundingBox();
    await page.mouse.move(ph.x + ph.width / 2, ph.y + ph.height / 2); await page.mouse.down(); await page.mouse.move(xOf(5.2), ph.y + 4, { steps: 8 }); await page.mouse.up();
    s = await S(); near(s.t, 5.2, 1 / 30 + 1e-6, 'playhead handle drag'); await page.mouse.move(xOf(1), g.ry, { steps: 4 }); assert.equal((await S()).t, s.t);

    step('scrubbing while playing: playback pauses during the scrub and resumes from the release point');
    await page.evaluate(() => { window.__fc.state.player.current.seek(0.2); window.__fc.state.player.current.play(); }); await page.waitForTimeout(300);
    await page.mouse.move(xOf(2), g.ry); await page.mouse.down(); assert.equal((await S()).playing, false, 'paused while scrubbing');
    await page.mouse.move(xOf(6), g.ry, { steps: 6 }); await page.mouse.up();
    s = await S(); near(s.t, 6, 0.15, 'resumes from the release point'); assert.equal(s.playing, true, 'playback resumed');
    await page.evaluate(() => window.__fc.state.player.current.pause());
    const tp = (await S()).t; await page.mouse.move(xOf(1), g.ry, { steps: 5 }); assert.equal((await S()).t, tp, 'no following after playback scrub');

    step('clip drag released outside the window and Escape mid-drag');
    const nTracks = () => page.evaluate(() => window.__fc.state.project.value.tracks.length); const tracks0 = await nTracks();
    const tb = await page.locator(`.clip[data-clip="${ids.text}"]`).boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.mouse.down(); await page.mouse.move(tb.x + tb.width / 2 + 40, tb.y + tb.height / 2, { steps: 5 });
    await page.mouse.move(1700, 1100, { steps: 4 }); await page.mouse.up();
    s = await S(); assert.equal(s.dragging, false); assert.equal(s.drag, null, 'no drag preview left');
    assert.equal(await nTracks(), tracks0, 'releasing outside the timeline does not create a track');
    let tc = await clipOf(ids.text); const startAfter = tc.start;
    await page.mouse.move(tb.x + 300, tb.y + 10, { steps: 5 }); assert.equal((await clipOf(ids.text)).start, startAfter, 'clip does not follow after release');
    await page.evaluate(() => window.__fc.state.undo());
    tc = await clipOf(ids.text); near(tc.start, 1, 1e-9, 'undo restores');
    const tb2 = await page.locator(`.clip[data-clip="${ids.text}"]`).boundingBox();
    await page.mouse.move(tb2.x + tb2.width / 2, tb2.y + tb2.height / 2); await page.mouse.down(); await page.mouse.move(tb2.x + tb2.width / 2 + 120, tb2.y + tb2.height / 2, { steps: 6 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    s = await S(); assert.equal(s.dragging, false); assert.equal(s.drag, null);
    assert.equal((await clipOf(ids.text)).start, 1, 'Escape cancels the move');
    await page.screenshot({ path: path.join(shots, 'qol-01-timeline.png') });

    // ---------------- Magnetic timeline snapping ----------------
    step('trim a text overlay end to the exact (non-frame-aligned) end of a video, at two zoom levels; one undo per trim');
    await page.evaluate(id => { const { edit } = window.__fc; edit.trimClip(id, 'end', 5.4567, { key: null }); }, ids.a);
    const vEnd = await page.evaluate(id => { const c = window.__fc.state.project.value.clips.find(x => x.id === id); return c.start + c.duration; }, ids.a);
    near(vEnd, 5.4567, 1e-9, 'video trimmed');
    for (const z of [40, 300]) {
      await page.evaluate(z2 => { window.__fc.state.zoom.value = z2; document.querySelector('.tl-scroll').scrollLeft = 0; window.__fc.state.selection.value = []; }, z); await page.waitForTimeout(150); g = await geo();
      const e = await page.locator(`.clip[data-clip="${ids.text}"] .edge.r`).boundingBox();
      const before = await clipOf(ids.text);
      await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2); await page.mouse.down();
      await page.mouse.move(xOf(vEnd) - 5, e.y + e.height / 2, { steps: 10 }); // 5 screen px short of the video end
      assert.equal(await page.locator('.snap-line').count(), 1, 'snap indicator shown');
      const ro = await page.locator('.tl-readout').textContent(); assert.match(ro, /Out .* · /, 'trim readout shows timecode and duration');
      await page.mouse.up();
      const after = await clipOf(ids.text);
      assert.equal(after.start + after.duration, vEnd, `text end === video end exactly at zoom ${z}`);
      assert.equal(await page.locator('.snap-line').count(), 0, 'indicator cleared');
      await page.keyboard.press('Control+z');
      const back = await clipOf(ids.text); assert.equal(back.duration, before.duration, 'a single undo reverses the whole trim');
    }
    await page.evaluate(() => { window.__fc.state.zoom.value = 80; document.querySelector('.tl-scroll').scrollLeft = 0; }); await page.waitForTimeout(120); g = await geo();

    step('Alt bypasses snapping (frame-exact result), N turns snapping off');
    for (const mode of ['alt', 'off']) {
      if (mode === 'off') await page.keyboard.press('n');
      const e = await page.locator(`.clip[data-clip="${ids.text}"] .edge.r`).boundingBox();
      await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2); await page.mouse.down();
      if (mode === 'alt') await page.keyboard.down('Alt');
      await page.mouse.move(xOf(vEnd) - 3, e.y + e.height / 2, { steps: 8 });
      assert.equal(await page.locator('.snap-line').count(), 0, 'no indicator when bypassed');
      await page.mouse.up(); if (mode === 'alt') await page.keyboard.up('Alt');
      const c = await clipOf(ids.text), end = c.start + c.duration;
      assert.notEqual(end, vEnd, `${mode}: not snapped`); assert.ok(frameExact(end, 30), `${mode}: still frame-exact (${end})`);
      await page.keyboard.press('Control+z');
    }
    await page.keyboard.press('n'); assert.equal(await page.evaluate(() => window.__fc.state.project.value.settings.snapping), true);

    step('moving a clip snaps its start to the playhead');
    await page.evaluate(() => window.__fc.state.player.current.seek(2.5));
    const mb = await page.locator(`.clip[data-clip="${ids.text}"]`).boundingBox();
    await page.mouse.move(mb.x + 20, mb.y + mb.height / 2); await page.mouse.down(); await page.mouse.move(mb.x + 20 + (2.5 - 1) * g.z - 4, mb.y + mb.height / 2, { steps: 10 }); await page.mouse.up();
    assert.equal((await clipOf(ids.text)).start, 2.5, 'start snapped exactly to the playhead');
    await page.keyboard.press('Control+z'); assert.equal((await clipOf(ids.text)).start, 1);

    // ---------------- Live text editing ----------------
    step('typing in the inspector updates the preview on every keystroke, keeps focus/caret, one undo for the session');
    await page.evaluate(id => { const s = window.__fc.state; s.selection.value = [id]; s.player.current.seek(1.5); }, ids.text);
    const ta = page.locator('.insp-text textarea'); await ta.waitFor(); await ta.click(); await page.keyboard.press('End');
    await page.waitForTimeout(400);
    const pix = () => page.evaluate(() => window.__fc.state.player.current.canvas.toDataURL('image/png').length);
    const w0 = await page.evaluate(id => window.__fc.state.player.current.getPlan().layers.find(l => l.id === id).baseW, ids.text);
    const p0 = await pix();
    await page.keyboard.type(' live!', { delay: 60 });
    assert.equal((await clipOf(ids.text)).text, 'Title live!', 'project text updated without blur');
    const w1 = await page.evaluate(id => window.__fc.state.player.current.getPlan().layers.find(l => l.id === id).baseW, ids.text);
    assert.ok(w1 > w0 + 10, `text raster widened while typing (${w0} → ${w1})`);
    await page.waitForTimeout(300); assert.notEqual(await pix(), p0, 'preview redrawn while typing');
    const focus = await page.evaluate(() => ({ inTa: document.activeElement?.matches('.insp-text textarea'), sel: document.activeElement?.selectionStart, len: document.activeElement?.value.length }));
    assert.ok(focus.inTa, 'focus kept'); assert.equal(focus.sel, focus.len, 'caret stays at the end');
    await page.keyboard.press('Enter'); await page.keyboard.type('Line 2');
    assert.equal((await clipOf(ids.text)).text, 'Title live!\nLine 2', 'multiline');
    await ta.blur(); await page.keyboard.press('Control+z');
    assert.equal((await clipOf(ids.text)).text, 'Title', 'one undo reverts the whole typing session');
    await page.keyboard.press('Control+y'); assert.equal((await clipOf(ids.text)).text, 'Title live!\nLine 2');
    await page.keyboard.press('Control+z');

    step('style changes are live (size slider) and coalesce into one undo per drag');
    const size0 = (await clipOf(ids.text)).style.size;
    const range = page.locator('.insp-text .slider', { hasText: 'Size' }).locator('input[type=range]'); const rb = await range.boundingBox();
    await page.mouse.move(rb.x + rb.width * 0.2, rb.y + rb.height / 2); await page.mouse.down(); await page.mouse.move(rb.x + rb.width * 0.35, rb.y + rb.height / 2, { steps: 4 });
    await page.waitForTimeout(1400); // a pause longer than the 1.2 s typing window inside one drag
    await page.mouse.move(rb.x + rb.width * 0.5, rb.y + rb.height / 2, { steps: 4 }); await page.mouse.up();
    assert.ok((await clipOf(ids.text)).style.size > size0, 'size changed live');
    await page.keyboard.press('Control+z'); assert.equal((await clipOf(ids.text)).style.size, size0, 'one undo for the whole slider drag, even with a pause');

    step('double-click the text in the viewer edits it in place');
    const gz = await page.locator('.gizmo').boundingBox();
    await page.mouse.dblclick(gz.x + gz.width / 2, gz.y + gz.height / 2);
    await page.locator('.gizmo-edit').waitFor();
    await page.keyboard.type('Hello');
    assert.equal((await clipOf(ids.text)).text, 'Hello', 'in-viewer typing replaces the selected text live');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.gizmo-edit').count(), 0, 'Escape finishes editing');
    await page.screenshot({ path: path.join(shots, 'qol-02-text.png') });

    // ---------------- Viewer snapping & alignment ----------------
    step('dragging text near the centre snaps it exactly to the centre, with a guide; Alt bypasses');
    const pos = () => page.evaluate(id => { const v = window.__fc.viewport, s = window.__fc.state; const L = s.player.current.getPlan().layers.find(l => l.id === id); const b = v.layerBox(L, s.time.value); const c = s.project.value.clips.find(x => x.id === id); return { x: c.transform.x, y: c.transform.y, b, W: s.player.current.getPlan().W, H: s.player.current.getPlan().H }; }, ids.text);
    await page.evaluate(id => window.__fc.edit.updateClip(id, x => { x.transform.x = 0.2; x.transform.y = -0.25; }), ids.text);
    const stage = await page.locator('.stage').boundingBox(); const k = stage.width / (await pos()).W;
    const dragGizmo = async (dx, dy, { alt, shift, hold } = {}) => {
      const b = await page.locator('.gizmo').boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      await page.mouse.move(cx, cy); await page.mouse.down(); if (alt) await page.keyboard.down('Alt'); if (shift) await page.keyboard.down('Shift');
      await page.mouse.move(cx + dx * 0.5, cy + dy * 0.5, { steps: 6 }); if (hold) await page.waitForTimeout(hold); await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
      const guidesShown = await page.locator('.snap-guide').count();
      await page.mouse.up(); if (alt) await page.keyboard.up('Alt'); if (shift) await page.keyboard.up('Shift');
      return guidesShown;
    };
    // Move by the exact offset to the centre plus 3 screen px of error on each axis.
    let q = await pos(); let shown = await dragGizmo(-0.2 * q.W * k + 3, 0.25 * q.H * k - 3, { hold: 1400 });
    q = await pos(); assert.equal(q.x, 0, 'x snapped to centre'); assert.equal(q.y, 0, 'y snapped to centre'); assert.ok(shown >= 1, 'alignment guide shown');
    assert.equal(Math.abs(q.b.cx - q.W / 2) < 1e-6 && Math.abs(q.b.cy - q.H / 2) < 1e-6, true, 'actual bounds centred');
    await page.keyboard.press('Control+z'); q = await pos(); assert.equal(q.x, 0.2, 'one undo reverts the whole move (even with a long pause)');
    shown = await dragGizmo(-0.2 * q.W * k + 3, 0.25 * q.H * k - 3, { alt: true }); q = await pos();
    assert.notEqual(q.x, 0, 'Alt bypasses snapping'); assert.equal(shown, 0, 'no guides with Alt'); await page.keyboard.press('Control+z');

    step('the left edge snaps to the frame edge using the real transformed bounds');
    q = await pos(); await dragGizmo(-q.b.l * k + 4, 0); q = await pos();
    near(q.b.l, 0, 0.01, 'left edge on the frame edge (canvas px)'); await page.keyboard.press('Control+z');

    step('viewer snapping toggle; Shift constrains the axis');
    await page.locator('.preview-head button[aria-pressed]').first().click(); // viewer snapping off
    q = await pos(); await dragGizmo(-0.2 * q.W * k + 3, 0.25 * q.H * k - 3); q = await pos(); assert.notEqual(q.x, 0, 'snapping off'); await page.keyboard.press('Control+z');
    await page.locator('.preview-head button[aria-pressed]').first().click();
    q = await pos(); const y0 = q.y; await dragGizmo(80, 25, { shift: true }); q = await pos(); assert.equal(q.y, y0, 'Shift keeps the move horizontal'); assert.ok(q.x > 0.2); await page.keyboard.press('Control+z');

    step('arrow keys nudge in the viewer (1 px, Shift 10 px) without moving the playhead');
    q = await pos(); const tNow = (await S()).t;
    await page.mouse.click(stage.x + 5, stage.y + stage.height - 5); // focus the viewer (selects nothing there: reselect)
    await page.evaluate(id => { window.__fc.state.selection.value = [id]; }, ids.text);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowUp');
    const q2 = await pos(); near((q2.x - q.x) * q.W, 11, 0.01, 'nudged 11 px right'); near((q.y - q2.y) * q.H, 10, 0.01, 'nudged 10 px up');
    assert.equal((await S()).t, tNow, 'arrows did not step frames while working in the viewer');

    step('right-click → Center in frame; lock prevents moving');
    const gb = await page.locator('.gizmo').boundingBox(); await page.mouse.click(gb.x + gb.width / 2, gb.y + gb.height / 2, { button: 'right' });
    await page.locator('.menu-item', { hasText: 'Center in frame' }).click(); q = await pos();
    near(q.b.cx, q.W / 2, 0.01, 'centred x'); near(q.b.cy, q.H / 2, 0.01, 'centred y');
    await page.keyboard.press('Control+l'); assert.equal((await clipOf(ids.text)).locked, true);
    await dragGizmo(100, 50); q = await pos(); near(q.b.cx, q.W / 2, 0.01, 'locked object did not move');
    await page.keyboard.press('Control+l');
    await page.screenshot({ path: path.join(shots, 'qol-03-viewer.png') });

    // ---------------- Keyframes ----------------
    step('multi-select keyframes: Shift+click, drag both in time (one undo), easing for all, delete');
    await page.evaluate(id => window.__fc.edit.updateClip(id, x => { x.keyframes = { x: [{ t: 0.5, v: 0, e: 'smooth' }, { t: 1.0, v: 0.1, e: 'smooth' }, { t: 1.5, v: 0.2, e: 'smooth' }], opacity: [{ t: 1.0, v: 1, e: 'smooth' }] }; }), ids.text);
    const keys = page.locator(`.clip[data-clip="${ids.text}"] .clip-key`); await keys.nth(2).waitFor();
    await keys.nth(0).click(); await keys.nth(1).click({ modifiers: ['Shift'] });
    assert.equal(await page.evaluate(() => window.__fc.keys.keySel.value.length), 2);
    assert.equal(await page.locator('.clip-key.sel').count(), 2);
    const kb = await keys.nth(1).boundingBox();
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2); await page.mouse.down(); await page.mouse.move(kb.x + kb.width / 2 + 0.25 * g.z, kb.y + kb.height / 2, { steps: 6 }); await page.mouse.up();
    let kc = await clipOf(ids.text);
    const xs = kc.keyframes.x.map(k2 => k2.t); near(xs[0] - 0.5, xs[1] - 1.0, 1e-9, 'both selected keys moved by the same amount'); assert.ok(xs[0] > 0.6, 'moved later'); assert.equal(xs[2], 1.5, 'unselected key untouched');
    near(kc.keyframes.opacity[0].t, xs[1], 1e-9, 'all properties under a diamond move together');
    await page.keyboard.press('Control+z'); kc = await clipOf(ids.text); assert.deepEqual(kc.keyframes.x.map(k2 => k2.t), [0.5, 1.0, 1.5], 'one undo for the key drag');
    await page.evaluate(id => { window.__fc.keys.keySel.value = [{ id, t: 0.5 }, { id, t: 1 }]; window.__fc.keys.setKeyEasing('linear'); }, ids.text);
    kc = await clipOf(ids.text); assert.deepEqual(kc.keyframes.x.map(k2 => k2.e), ['linear', 'linear', 'smooth']);
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('Delete');
    kc = await clipOf(ids.text); assert.deepEqual(kc.keyframes.x.map(k2 => k2.t), [1.5], 'Delete removes the selected keys, not the clip');
    assert.ok(!kc.keyframes.opacity, 'empty property removed'); assert.ok(await clipOf(ids.text), 'clip still exists');
    await page.keyboard.press('Control+z');

    step('copy/paste keyframes at the playhead');
    await page.evaluate(id => { window.__fc.keys.keySel.value = [{ id, t: 0.5 }, { id, t: 1 }]; }, ids.text);
    await page.keyboard.press('Control+c'); await page.evaluate(id => { window.__fc.state.selection.value = [id]; window.__fc.state.player.current.seek(1 + 1.8); }, ids.text);
    await page.keyboard.press('Control+v'); kc = await clipOf(ids.text);
    assert.ok(kc.keyframes.x.some(k2 => Math.abs(k2.t - 1.8) < 1e-6) && kc.keyframes.x.some(k2 => Math.abs(k2.t - 1.95) > 0), 'keys pasted at the playhead');
    await page.keyboard.press('Control+z');

    // ---------------- Other QoL ----------------
    step('Ctrl+drag duplicates a clip; Ctrl+click without moving toggles selection');
    const n0 = await page.evaluate(() => window.__fc.state.project.value.clips.length);
    const db = await page.locator(`.clip[data-clip="${ids.text}"]`).boundingBox();
    await page.keyboard.down('Control'); await page.mouse.move(db.x + 30, db.y + db.height / 2); await page.mouse.down(); await page.mouse.move(db.x + 30 + 3 * g.z, db.y + db.height / 2, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Control');
    const after = await page.evaluate(() => window.__fc.state.project.value.clips.length); assert.equal(after, n0 + 1, 'copy created');
    assert.equal((await clipOf(ids.text)).start, 1, 'original stays');
    await page.keyboard.press('Control+z');

    step('Ctrl+wheel zooms around the cursor; gaps are highlighted');
    g = await geo(); const atX = xOf(4); const before = await page.evaluate(() => window.__fc.state.zoom.value);
    await page.mouse.move(atX, g.ry + 60); await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control'); await page.waitForTimeout(150);
    const z2 = await page.evaluate(() => window.__fc.state.zoom.value); assert.ok(z2 > before, 'zoomed in');
    g = await geo(); near(xOf(4), atX, 2, 'time under the cursor stays under the cursor');
    await page.evaluate(() => window.__fc.state.commit('Magnetic off', d => { d.settings.magnetic = false; }));
    await page.evaluate(() => { const s = window.__fc.state; const m = s.project.value.clips.filter(c => c.trackId === 'main').sort((a, b) => a.start - b.start)[1]; s.commit('Gap', d => { d.clips.find(c => c.id === m.id).start += 1; }); });
    await page.locator('.track-row.main .gap').first().waitFor(); assert.ok(await page.locator('.track-row.main .gap').count() >= 1, 'gap highlighted');
    await page.locator('.track-row.main .gap').first().dblclick();
    assert.equal(await page.locator('.track-row.main .gap').count(), 0, 'double-click closes the gap');

    step('Ctrl+click toggles clips in the selection');
    await page.evaluate(id => { window.__fc.state.selection.value = [id]; document.querySelector('.tl-scroll').scrollLeft = 0; }, ids.a); await page.waitForTimeout(100);
    const tcb = await page.locator(`.clip[data-clip="${ids.text}"]`).boundingBox();
    await page.keyboard.down('Control'); await page.mouse.click(tcb.x + 15, tcb.y + tcb.height / 2); await page.keyboard.up('Control');
    assert.deepEqual(await page.evaluate(() => window.__fc.state.selection.value), [ids.a, ids.text], 'added');
    await page.keyboard.down('Control'); await page.mouse.click(tcb.x + 15, tcb.y + tcb.height / 2); await page.keyboard.up('Control');
    assert.deepEqual(await page.evaluate(() => window.__fc.state.selection.value), [ids.a], 'removed');

    step('linked audio follows its video when the video is reordered on the magnetic main track; unlink separates them');
    await page.evaluate(id => { const { state, edit } = window.__fc; state.commit('Magnetic on', d => { d.settings.magnetic = true; }); edit.detachAudio(id); state.zoom.value = 80; document.querySelector('.tl-scroll').scrollLeft = 0; }, ids.a);
    await page.waitForTimeout(150); g = await geo();
    const audioId = (await clipOf(ids.a)).detachedAudio; assert.ok(audioId, 'audio separated');
    const ab = await page.locator(`.clip[data-clip="${ids.a}"]`).boundingBox();
    await page.mouse.move(ab.x + 30, ab.y + ab.height / 2); await page.mouse.down(); await page.mouse.move(ab.x + 30 + 7 * g.z, ab.y + ab.height / 2, { steps: 10 }); await page.mouse.up();
    const va = await clipOf(ids.a), au = await clipOf(audioId);
    assert.ok(va.start > 4, `video moved after the other clip (${va.start})`); assert.equal(au.start, va.start, 'linked audio kept in sync');
    await page.keyboard.press('Control+z'); assert.equal((await clipOf(audioId)).start, 0, 'one undo restores both');
    await page.evaluate(id => window.__fc.edit.unlinkClip(id), ids.a); assert.ok(!(await clipOf(ids.a)).detachedAudio, 'unlinked');

    step('ripple trim closes up later clips on the same track');
    const t2 = await page.evaluate(() => { const { edit, state } = window.__fc; state.player.current.seek(6); return edit.addText({ text: 'Second', at: 4, duration: 1 }); });
    await page.evaluate(() => window.__fc.ui.setUi({ ripple: true }));
    const re = await page.locator(`.clip[data-clip="${ids.text}"] .edge.r`).boundingBox();
    await page.keyboard.down('Alt'); await page.mouse.move(re.x + re.width / 2, re.y + re.height / 2); await page.mouse.down(); await page.mouse.move(re.x + re.width / 2 - 0.5 * g.z, re.y + re.height / 2, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Alt');
    const f1 = await clipOf(ids.text), f2 = await clipOf(t2);
    assert.ok(f1.duration < 2, 'trimmed'); near(f2.start, 4 - (2 - f1.duration), 1e-9, 'later clip moved by the trimmed amount');
    await page.keyboard.press('Control+z'); assert.equal((await clipOf(t2)).start, 4, 'undo restores the rippled clip too');

    step('preferences persist (viewer snapping, ripple, zoom)');
    const stored = await page.evaluate(async () => { window.__fc.ui.setUi({ ripple: true }); await new Promise(r => setTimeout(r, 300)); return JSON.parse(localStorage.getItem('fc:ui')); });
    assert.equal(stored.ripple, true); assert.ok(stored.zoom > 0);
    await page.screenshot({ path: path.join(shots, 'qol-04-end.png') });
    assert.equal((await S()).dragging, false, 'no drag left active');
    console.log('ERRORS', JSON.stringify(errors));
    assert.deepEqual(errors.filter(e => !/Autofill|DevTools/.test(e)), []);
    console.log('PASS: qol journey');
  } catch (e) { console.error('FAIL', e.stack || e.message); await page?.screenshot({ path: path.join(shots, 'qol-fail.png') }).catch(() => {}); console.log('ERRORS', JSON.stringify(errors)); process.exitCode = 1; }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
})();
