// Sync controls, in the real app:
//  - Voiceover sync offset (per microphone): saved, applied to new takes, and re-places the last take
//  - Compatible engine compensates the gap between capture start and video start (like Direct)
//  - Caption timing moves every caption together (undoable, never before 0 s) and is kept by regeneration
const { launchApp } = require('./launch.cjs');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const assert = require('node:assert/strict');
const { run, ffmpeg } = require('../desktop/tools.cjs');
const step = n => console.log('· ' + n);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-sync-')); let app, page; const errors = [];
  try {
    const clip = path.join(temp, 'Clip.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-t', '8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
    app = await launchApp({ ...process.env, FRAMECUT_TEST: '1', FRAMECUT_TEST_DIR: temp, FRAMECUT_FAKE_MEDIA: '1' });
    page = await app.firstWindow();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
    await page.evaluate(async f => { const { state, api, edit } = window.__fc; const r = await api('/api/media/import', { paths: [f] }); await state.refreshMedia(); edit.addAssets(r.assets, { at: 0 }); }, clip);
    const P = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fc.state.project.value)));

    step('engine names: Direct / Compatible (no "Pro")');
    await page.evaluate(() => window.__fc.state.savePrefs({ recording: { engine: 'browser', playVideo: true, countdown: false, preroll: 0, trimSilence: false, monitor: false } }));
    await page.locator('button[data-tip="Record voiceover"]').click(); await page.locator('.studio').waitFor();
    await page.locator('.insp-section header', { hasText: 'Recording options' }).click();
    const opts = await page.locator('.studio').innerText();
    assert.ok(/Direct \(best quality\)/.test(opts) && /Compatible/.test(opts), 'new engine labels shown');
    assert.ok(!/Pro \(WASAPI\)/.test(opts), 'old "Pro" label gone');

    step('record a take over the video; the start gap is compensated');
    await page.evaluate(() => window.__fc.state.player.current.seek(1));
    await page.keyboard.press('r'); await page.waitForFunction(() => document.querySelector('.rec-btn.stop'), null, { polling: 20 });
    await page.waitForTimeout(1500); await page.keyboard.press('r');
    await page.waitForFunction(() => window.__fc.state.project.value.clips.some(c => c.name === 'Voiceover'), null, { timeout: 20000, polling: 100 });
    let v = (await P()).clips.find(c => c.name === 'Voiceover');
    near(v.start, 1, 0.02, 'take placed at the playhead');
    assert.ok(v.in > 0, 'in-point includes the measured delay and start gap: ' + v.in);
    const in0 = v.in;

    step('sync offset: +120 ms moves the last take 120 ms earlier and is remembered for this mic');
    const box = page.getByLabel('Sync offset (this microphone) value');
    await box.click(); await box.fill('120'); await box.press('Enter');
    v = (await P()).clips.find(c => c.name === 'Voiceover');
    near(v.in, in0 + 0.12, 0.002, 'last take re-placed'); near(v.start, 1, 1e-6, 'its position on the timeline is unchanged');
    await page.waitForFunction(() => window.__fc.state.prefs.value.recording?.syncOffsets, null, { timeout: 5000, polling: 50 });
    const saved = await page.evaluate(() => window.__fc.state.prefs.value.recording.syncOffsets);
    assert.equal(Object.values(saved)[0], 120, 'offset saved per microphone: ' + JSON.stringify(saved));
    step('fast slider drags move the take by exactly the final offset');
    // A new gesture: edits of the same kind within 1.2 s coalesce into one undo step (state.commit), and a
    // visible window runs the typed value and this drag closer together than that.
    await page.waitForTimeout(1400);
    await page.evaluate(() => { const r = document.querySelector('input[aria-label="Sync offset (this microphone)"]'); for (const x of [130, 145, 160, 175, 190, 200]) { r.value = String(x); r.dispatchEvent(new Event('input', { bubbles: true })); } });
    near((await P()).clips.find(c => c.name === 'Voiceover').in, in0 + 0.2, 0.002, 'no drift from rapid changes');
    await page.evaluate(() => { const s = window.__fc.state; s.undo(); });
    near((await P()).clips.find(c => c.name === 'Voiceover').in, in0 + 0.12, 0.002, 'the whole drag is one undo step');
    await page.evaluate(() => { const s = window.__fc.state; s.undo(); });
    near((await P()).clips.find(c => c.name === 'Voiceover').in, in0, 0.002, 'undo restores the take');
    const box2 = page.getByLabel('Sync offset (this microphone) value'); await box2.click(); await box2.fill('120'); await box2.press('Enter');
    await page.evaluate(() => window.__fc.state.undo()); // keep the offset at 120, take back at in0

    step('the offset applies to the next take');
    await page.evaluate(() => { window.__fc.state.player.current.seek(4); window.__fc.state.selection.value = []; });
    await page.keyboard.press('r'); await page.waitForFunction(() => document.querySelector('.rec-btn.stop'), null, { polling: 20 });
    await page.waitForTimeout(1200); await page.keyboard.press('r');
    await page.waitForFunction(() => window.__fc.state.project.value.clips.filter(c => c.name === 'Voiceover').length === 2, null, { timeout: 20000, polling: 100 });
    const v2 = (await P()).clips.filter(c => c.name === 'Voiceover').sort((a, b) => b.start - a.start)[0];
    assert.ok(v2.in >= 0.12, 'new take skips the 120 ms offset as well: ' + v2.in);
    await page.locator('.studio button[data-tip="Close"], .studio .icon-btn[aria-label="Close"]').first().click().catch(() => page.evaluate(() => window.__fc.studio.closeStudio()));

    step('caption timing moves all captions together');
    await page.evaluate(() => window.__fc.edit.insertCaptions([{ start: 0.1, end: 1, text: 'one two', words: [{ text: 'one', start: 0, end: 0.4 }, { text: 'two', start: 0.4, end: 0.9 }] }, { start: 2, end: 3, text: 'three', words: [{ text: 'three', start: 0, end: 1 }] }]));
    await page.locator('.rail-btn', { hasText: 'Captions' }).click();
    await page.locator('.cap-panel .lib-tabs button', { hasText: 'Transcript' }).click();
    const cbox = page.getByLabel('Caption timing (all captions) value');
    await cbox.click(); await cbox.fill('250'); await cbox.press('Enter');
    let caps = (await P()).clips.filter(c => c.caption).sort((a, b) => a.start - b.start);
    near(caps[0].start, 0.35, 1e-4, 'first caption later'); near(caps[1].start, 2.25, 1e-4, 'second caption later');
    assert.deepEqual(caps[0].words.map(w => w.start), [0, 0.4], 'word timing inside the caption is unchanged');
    await cbox.click(); await cbox.fill('-1000'); await cbox.press('Enter');
    caps = (await P()).clips.filter(c => c.caption).sort((a, b) => a.start - b.start);
    near(caps[0].start, 0, 1e-4, 'never earlier than 0 s'); near(caps[1].start, 1.9, 1e-4, 'others keep their spacing');
    assert.equal((await P()).settings.captionShift, -100, 'the applied total is remembered');

    step('regenerated captions keep the chosen timing');
    await page.evaluate(() => window.__fc.captions.placeWords({ words: [{ text: 'hello', start: 5, end: 5.5 }, { text: 'there', start: 5.5, end: 6 }], engine: 'test' }, { from: 4.5, to: 7 }));
    caps = (await P()).clips.filter(c => c.caption && /hello/.test(c.text));
    near(caps[0].start, 4.9, 1e-4, 'new captions shifted by the same −100 ms');

    assert.deepEqual(errors.filter(e => !/Failed to load resource/.test(e)), []);
    console.log('PASS: sync');
  } catch (e) { console.error(e); console.error('ERRORS', errors); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
})();
