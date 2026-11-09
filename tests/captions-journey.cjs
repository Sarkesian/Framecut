// Captions, end to end in the real app with the local speech engine:
// import a video (TTS voice with exact word timing) + loud synth music on its own track → Generate
// captions → accuracy/timing vs ground truth → Word Pop style → fix a word (timing kept) → change the
// font for all captions → save/reopen → export → exported frames match the preview while words pop.
// Needs the speech engine; set FRAMECUT_SPEECH_PYTHON / FRAMECUT_SPEECH_HF to an installed environment.
const { launchApp } = require('./launch.cjs');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const assert = require('node:assert/strict');
const { run, ffmpeg, ffprobe } = require('../desktop/tools.cjs');
const shots = path.resolve('test-output'); const step = n => console.log('· ' + n);
const BENCH = process.env.FRAMECUT_BENCH || 'D:/Projects/ColdFusion/Main/workspace/asr-eval/bench';
const norm = s => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim();
(async () => {
  await fs.mkdir(shots, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-captions-')); let app, page; const errors = [];
  try {
    const cases = JSON.parse(await fs.readFile(path.join(BENCH, 'cases.json'), 'utf8')).cases;
    const voice = cases.find(c => c.id === '14_intentional_pauses'), rapid = cases.find(c => c.id === '09_rapid_speech');
    const vid = path.join(temp, 'Commentary.mp4'), music = path.join(temp, 'Synth bed.wav');
    // Voice: pauses case then rapid case, back to back (ground truth word starts shifted accordingly).
    await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=1280x720:r=30:d=${voice.duration + rapid.duration}`, '-i', path.join(BENCH, 'cases', voice.file), '-i', path.join(BENCH, 'cases', rapid.file), '-filter_complex', '[1:a][2:a]concat=n=2:v=0:a=1[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', vid]);
    await run(ffmpeg, ['-y', '-v', 'error', '-i', path.join(BENCH, 'cases', '06_synth_electronic.wav'), '-t', String(voice.duration + rapid.duration), '-af', 'volume=-3dB', music]);
    const truth = [...voice.words, ...rapid.words.map(w => ({ ...w, start: w.start + voice.duration }))];
    const env = { ...process.env, FRAMECUT_TEST_DIR: temp }; delete env.FRAMECUT_TEST;
    app = await launchApp(env); page = await app.firstWindow();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.getByText('New project').first().waitFor();
    await page.evaluate(async cfg => { await window.__fc.state.savePrefs({ speechEngine: cfg }); }, { python: process.env.FRAMECUT_SPEECH_PYTHON || 'D:/Projects/ColdFusion/Main/workspace/asr-eval/venv/Scripts/python.exe', hfHome: process.env.FRAMECUT_SPEECH_HF || 'D:/Projects/ColdFusion/Main/workspace/asr-eval/hf' });
    await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
    await page.evaluate(async f => { const { state, api, edit } = window.__fc; const r = await api('/api/media/import', { paths: f }); await state.refreshMedia(); edit.addAssets([r.assets[0]], { at: 0 }); edit.addAssets([r.assets[1]], { at: 0 }); }, [vid, music]);

    step('generate captions (Best) from the Captions panel');
    await page.locator('.rail-btn', { hasText: 'Captions' }).click();
    await page.locator('.cap-panel .lib-tabs button', { hasText: 'Generate' }).click();
    await page.locator('.caption-gen .chip', { hasText: 'On this computer' }).waitFor({ timeout: 120000 });
    const t0 = Date.now();
    await page.locator('.caption-gen button', { hasText: 'Generate captions' }).click();
    await page.waitForFunction(() => window.__fc.captions.captionClips(window.__fc.state.project.value).length > 0, null, { timeout: 600000 });
    const secs = (Date.now() - t0) / 1000;
    const caps = await page.evaluate(() => { const p = window.__fc.state.project.value; return window.__fc.captions.captionClips(p).map(c => ({ id: c.id, start: c.start, duration: c.duration, text: c.text, words: c.words })); });
    const words = caps.flatMap(c => c.words.map(w => ({ text: w.text, start: c.start + w.start, end: c.start + w.end, flag: w.flag })));
    const hyp = words.map(w => norm(w.text)).filter(Boolean), ref = truth.map(w => norm(w.text));
    let i = 0, matched = 0, terr = []; for (const w of truth) { const k = hyp.indexOf(norm(w.text), i); if (k >= 0 && k - i < 3) { matched++; terr.push(Math.abs(words[k].start - w.start)); i = k + 1; } }
    const mae = terr.reduce((a, b) => a + b, 0) / Math.max(1, terr.length);
    console.log(`  ${words.length} words in ${caps.length} captions, ${secs.toFixed(1)} s; ${matched}/${ref.length} reference words matched; word start error ${Math.round(mae * 1000)} ms; flagged ${words.filter(w => w.flag).length}`);
    assert.ok(matched / ref.length > 0.9, 'accuracy'); assert.ok(mae < 0.12, 'word timing'); assert.ok(words.length <= ref.length + 3, 'no invented words from the synth bed');
    await page.screenshot({ path: path.join(shots, 'cap-1-generated.png') });

    step('Word Pop style is applied by default; preview shows the active word popping');
    assert.equal(await page.evaluate(() => window.__fc.state.project.value.captions.preset), 'word-pop');
    const wPop = words.find(w => w.start > 2 && w.end - w.start > 0.25) || words[3];
    await page.evaluate(t => { window.__fc.state.selection.value = []; window.__fc.state.player.current.seek(t); }, wPop.start + 0.08); await page.waitForTimeout(1200);
    const layers = await page.evaluate(t => window.__fc.state.player.current.getPlan().layers.filter(L => L.cap && t >= L.vs && t < L.ve).map(L => L.cap.role), wPop.start + 0.08);
    assert.ok(layers.includes('base') && layers.includes('emph'), 'base + popping word overlay: ' + layers);
    await page.screenshot({ path: path.join(shots, 'cap-2-wordpop.png'), clip: { x: 340, y: 40, width: 930, height: 590 } });

    step('fix a word in the transcript: text changes, timing stays');
    await page.locator('.cap-panel .lib-tabs button', { hasText: 'Transcript' }).click();
    const first = page.locator('.cap-word').nth(1); const before = await page.evaluate(id => window.__fc.state.project.value.clips.find(c => c.id === id).words[1], caps[0].id);
    await first.dblclick(); await page.locator('.word-edit').fill('Bonjour'); await page.keyboard.press('Enter');
    const after = await page.evaluate(id => window.__fc.state.project.value.clips.find(c => c.id === id).words[1], caps[0].id);
    assert.equal(after.text, 'Bonjour'); assert.equal(after.start, before.start); assert.equal(after.end, before.end); assert.equal(after.orig, before.text);
    await page.keyboard.press('Control+z'); assert.equal(await page.evaluate(id => window.__fc.state.project.value.clips.find(c => c.id === id).words[1].text, caps[0].id), before.text, 'undo restores the word');

    step('change the font for all captions in one step');
    await page.locator('.cap-panel .lib-tabs button', { hasText: 'Style' }).click();
    await page.locator('.preset-card', { hasText: 'Gaming Commentary' }).click();
    const fonts = await page.evaluate(() => { const p = window.__fc.state.project.value; return [...new Set(window.__fc.captions.captionClips(p).map(c => window.__fc.captions.effOf(p, c).style.font))]; });
    assert.deepEqual(fonts, ['Anton']);
    await page.locator('.preset-card', { hasText: 'Word Pop' }).click();
    await page.locator('.cap-panel').screenshot({ path: path.join(shots, 'cap-3-styles.png') });
    await page.locator('.cap-panel .lib-tabs button', { hasText: 'Animation' }).click();
    await page.locator('.cap-panel').screenshot({ path: path.join(shots, 'cap-4-animation.png') });

    step('save and reopen');
    const pid = await page.evaluate(async () => { await window.__fc.state.saveNow(); return window.__fc.state.project.value.id; });
    const snap = await page.evaluate(() => JSON.stringify(window.__fc.captions.captionClips(window.__fc.state.project.value).map(c => [c.text, c.words.length])));
    await page.evaluate(async id => { await window.__fc.state.closeProject(); await window.__fc.state.openProject(id); }, pid);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__fc.captions.captionClips(window.__fc.state.project.value).map(c => [c.text, c.words.length]))), snap);

    step('export, then compare frames with the preview while words pop');
    const t1 = wPop.start + 0.05, t2 = wPop.start + 0.18;
    const shotsPv = [];
    for (const t of [t1, t2]) { await page.evaluate(t => { window.__fc.state.selection.value = []; window.__fc.state.player.current.seek(t); }, t); await page.waitForTimeout(1500); shotsPv.push(Buffer.from((await page.evaluate(() => window.__fc.state.player.current.canvas.toDataURL('image/png'))).split(',')[1], 'base64')); }
    const out = path.join(temp, 'Captions.mp4');
    await page.keyboard.press('Control+e'); await page.waitForFunction(() => document.querySelector('.modal input[aria-label="Output file"]')?.value);
    await page.locator('.modal input[aria-label="Output file"]').fill(out); await page.locator('.modal-foot .btn.primary').click();
    await page.getByText('Your video is ready').waitFor({ timeout: 300000 });
    const W = 320, H = 180, raw = async a => (await run(ffmpeg, a, { encoding: 'buffer' })).out;
    for (const [k, t] of [[0, t1], [1, t2]]) {
      await fs.writeFile(path.join(shots, `cap-preview-${k}.png`), shotsPv[k]);
      await run(ffmpeg, ['-y', '-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', path.join(shots, `cap-export-${k}.png`)]);
      const e = await raw(['-v', 'error', '-i', path.join(shots, `cap-export-${k}.png`), '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const pv = await raw(['-v', 'error', '-i', path.join(shots, `cap-preview-${k}.png`), '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      // Caption band only (the moving test pattern behind it differs by a frame at most).
      let d = 0, n = 0; for (let y = Math.round(H * 0.55); y < H; y++) for (let x = 0; x < W; x++) for (let ch = 0; ch < 3; ch++) { const j = (y * W + x) * 3 + ch; d += Math.abs(e[j] - pv[j]); n++; }
      console.log(`  t=${t.toFixed(2)} s: preview vs export mean abs diff in the caption band = ${(d / n).toFixed(2)}`);
      assert.ok(d / n < 12, 'preview and export match');
    }
    console.log('ERRORS', JSON.stringify(errors)); assert.deepEqual(errors, []);
    console.log('PASS: captions');
  } catch (e) { console.log('FAIL', e.message); await page?.screenshot({ path: path.join(shots, 'fail-captions.png') }); process.exitCode = 1; }
  finally { await app?.close(); }
})();
