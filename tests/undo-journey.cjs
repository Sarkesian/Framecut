// Ctrl+Z is universal: after every kind of action, done through the real UI and with focus left wherever
// the UI leaves it (search boxes, dropdowns, buttons, open menus), Ctrl+Z restores the project exactly,
// and Ctrl+Y brings the change back.
const { _electron: electron } = require('playwright');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const assert = require('node:assert/strict');
const { run, ffmpeg } = require('../desktop/tools.cjs');
const shots = path.resolve('test-output');
(async () => {
  await fs.mkdir(shots, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-undo-')); let app, page; const errors = []; const results = [];
  try {
    const a = path.join(temp, 'Clip A.mp4'), b = path.join(temp, 'Clip B.mp4'), song = path.join(temp, 'Tune.wav');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x406080:s=1280x720:r=30:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', a]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x805040:s=1280x720:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '3', song]);
    const env = { ...process.env, FRAMECUT_TEST_DIR: temp }; delete env.FRAMECUT_TEST;
    app = await electron.launch({ args: [path.resolve('.')], env });
    page = await app.firstWindow();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
    await page.evaluate(async f => { const { state, api } = window.__fc; const r = await api('/api/media/import', { paths: f }); state.commit('Import', p => { for (const x of r.assets) p.mediaIds.push(x.id); }); await state.refreshMedia(); }, [a, b, song]);
    await page.locator('.media-card').nth(1).waitFor();
    const snap = () => page.evaluate(() => { const p = window.__fc.state.project.value; return JSON.stringify({ name: p.name, clips: p.clips, tracks: p.tracks, settings: p.settings, usage: p.usageMode ?? null, markers: p.markers }); });
    // Do an action through the UI, then Ctrl+Z with focus left as-is; expect the exact previous project.
    async function check(label, act, { focusIs } = {}) {
      const before = await snap();
      await act(); await page.waitForTimeout(250);
      const after = await snap(); assert.notEqual(after, before, label + ': the action changed something');
      const focus = await page.evaluate(() => { const e = document.activeElement; return e ? e.tagName.toLowerCase() + (e.type ? '[' + e.type + ']' : '') + (e.className ? '.' + String(e.className).split(' ')[0] : '') : 'none'; });
      if (focusIs) assert.match(focus, focusIs, label + ': focus is where a user would leave it (' + focus + ')');
      await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
      assert.equal(await snap(), before, label + ': Ctrl+Z restores the project');
      await page.keyboard.press('Control+y'); await page.waitForTimeout(200);
      assert.equal(await snap(), after, label + ': Ctrl+Y redoes it');
      results.push(`${label} — focus: ${focus}`);
    }
    await page.locator('.rail-btn', { hasText: 'Media' }).click();
    await check('add clip (double-click media)', () => page.locator('.media-card', { hasText: 'Clip A' }).dblclick());
    await check('add second clip', () => page.locator('.media-card', { hasText: 'Clip B' }).dblclick());
    await check('select + Delete', async () => { await page.locator('.track-row.main .clip').last().click(); await page.keyboard.press('Delete'); });
    await check('split with Ctrl+B', async () => { await page.evaluate(() => window.__fc.state.player.current.seek(2)); await page.locator('.track-row.main .clip').first().click(); await page.keyboard.press('Control+b'); });
    await check('blade cut (toolbar button focused)', async () => { await page.locator('.tl-toolbar button[data-kbd="C"]').click(); const z = await page.evaluate(() => window.__fc.state.zoom.value); await page.locator('.track-row.main .clip').first().click({ position: { x: 1 * z, y: 20 } }); await page.keyboard.press('Escape'); });
    await check('Snap toggle (button focused)', () => page.locator('.tl-toggle', { hasText: 'Snap' }).click(), { focusIs: /button/ });
    await check('track mute button', () => page.locator('.track-row.main button[data-tip*="ute"]').first().click());
    await check('add text with T', async () => { await page.locator('body').click({ position: { x: 800, y: 900 } }); await page.keyboard.press('t'); });
    await check('emoji sticker click', async () => { await page.locator('.rail-btn', { hasText: 'Stickers' }).click(); await page.locator('.lib-tabs button', { hasText: 'Static' }).click(); await page.locator('.fchip', { hasText: 'Smileys' }).click(); await page.locator('.emoji').first().click(); });
    await check('library sticker dragged in while the search box has focus', async () => {
      await page.locator('.lib-tabs button', { hasText: 'Discover' }).click(); await page.locator('.lib-search input').fill('star'); await page.locator('.st-card').first().waitFor({ timeout: 20000 });
      await page.locator('.lib-search input').focus();
      const lane = page.locator('.track-row .track-lane').first(); const lb = await lane.boundingBox();
      const n = await page.evaluate(() => window.__fc.state.project.value.clips.length);
      await page.locator('.st-card').first().dragTo(lane, { targetPosition: { x: 300, y: lb.height / 2 } });
      await page.waitForFunction(n => window.__fc.state.project.value.clips.length > n, n, { timeout: 60000 });
      await page.locator('.lib-search input').focus(); // a user typically clicks back into search
    }, { focusIs: /input\[search\]/ });
    await check('usage dropdown changed (select focused)', async () => { await page.locator('.rail-btn', { hasText: 'Audio' }).click(); await page.locator('.lib-tabs button', { hasText: 'Music' }).click(); await page.locator('.usage select').focus(); await page.locator('.usage select').selectOption('personal'); await page.locator('.usage select').focus(); }, { focusIs: /select/ });
    await check('My audio add', async () => { await page.locator('.lib-tabs button', { hasText: 'My audio' }).click(); await page.locator('.audio-row', { hasText: 'Tune' }).locator('button[aria-label="Add at playhead"]').click(); });
    await page.evaluate(() => window.__fc.state.commit('Make gap', d => { d.settings.magnetic = false; const c = d.clips.filter(x => x.trackId === 'main').sort((a, b) => a.start - b.start).at(-1); c.start += 2; }));
    await check('Close gaps', () => page.locator('.tl-toggle', { hasText: 'Close gaps' }).click());
    await check('rename project', async () => { const t = page.locator('.project-title'); await t.fill('Holiday edit'); await t.press('Enter'); });
    await check('Ctrl+Z with a right-click menu open', async () => { await page.locator('.track-row.main .clip').first().click(); await page.keyboard.press('Control+d'); await page.locator('.track-row.main .clip').first().click({ button: 'right' }); await page.locator('.menu').waitFor(); });
    // Typing that hasn't been applied yet: the first Ctrl+Z undoes the typing in that box, not the project.
    await page.locator('.rail-btn', { hasText: 'Stickers' }).click();
    const box = page.locator('.lib-search input'); await box.fill(''); await box.type('heart');
    const pBefore = await snap(); await page.keyboard.press('Control+z');
    assert.equal(await snap(), pBefore, 'typing-only Ctrl+Z leaves the project alone'); assert.notEqual(await box.inputValue(), 'heart', 'and undoes the typing');
    // …and pressing Ctrl+Z again keeps going: once the typing is undone, the project is next.
    for (let i = 0; i < 8 && (await box.inputValue()) !== 'star'; i++) await page.keyboard.press('Control+z');
    assert.equal(await box.inputValue(), 'star', 'typing fully undone, back to what the box held before'); const pTyped = await snap();
    await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
    assert.notEqual(await snap(), pTyped, 'the next Ctrl+Z, still in the same box, undoes the project');
    results.push('unsaved typing in a text box — Ctrl+Z undoes the typing first, then carries on undoing the project');
    for (const r of results) console.log('  ✓ ' + r);
    console.log('ERRORS', JSON.stringify(errors)); assert.deepEqual(errors, []);
    console.log('PASS: undo');
  } catch (e) { for (const r of results) console.log('  ✓ ' + r); console.log('FAIL', e.message); await page?.screenshot({ path: path.join(shots, 'fail-undo.png') }); process.exitCode = 1; }
  finally { await app?.close(); }
})();
