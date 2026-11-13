// Audio library in the real app, against the REAL sources (needs internet): browse music by category with a
// click, preview, add to the timeline with its credit recorded, see a missing item explained, browse sound
// effects by category, collections and favorites. The window stays hidden (FRAMECUT_TEST).
// Usage: npm run build && node tests/audio-library-journey.cjs   → screenshots in test-output/audio-library-*.png
const { launchApp } = require('./launch.cjs');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const assert = require('node:assert/strict');
const shots = path.resolve('test-output');
const step = n => console.log('· ' + n);
(async () => {
  await fs.mkdir(shots, { recursive: true });
  const temp = process.env.FRAMECUT_TEST_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-audio-')); let app, page; const errors = [];
  try {
    app = await launchApp({ ...process.env, FRAMECUT_TEST: '1', FRAMECUT_TEST_DIR: temp });
    page = await app.firstWindow(); page.setDefaultTimeout(45000);
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
    const music = () => page.evaluate(() => { const s = window.__fc.creative.searches.music.value; return { status: s.status, lens: s.lens, n: s.results.length, providers: [...new Set(s.results.map(r => r.provider))], credit: s.results.filter(r => r.license !== 'cc0').length, partial: (s.partial || []).map(p => p.provider + ':' + p.code), error: s.error?.message || null }; });
    const settled = (panel, test = 's.results.length > 0') => page.waitForFunction(new Function('return (() => { const s = window.__fc.creative.searches.' + panel + '.value; return s.status === "ok" && (' + test + '); })()'), null, { timeout: 45000 });
    // Click a category chip; long shelves keep their later chips behind "All N".
    const pick = async name => { const chip = page.locator('.chip-shelf .fchip', { hasText: name }).first(); if (!(await chip.count())) await page.locator('.chip-shelf .fchip.more').click(); await chip.click(); };
    const toastText = () => page.locator('.toast').allInnerTexts().then(t => t.join(' | '));

    step('Audio › Music opens populated, no typing needed');
    await page.locator('.rail-btn', { hasText: 'Audio' }).click();
    await page.locator('.lib-tabs button', { hasText: 'Music' }).click();
    await settled('music'); let m = await music(); console.log('  ', JSON.stringify(m));
    assert.equal(await page.evaluate(() => window.__fc.creative.includeFor('music')), 'credit', 'credited music is part of the default view');
    assert.ok(m.n >= 15, 'a full first page of music'); assert.ok(m.providers.length >= 2, 'more than one source fills the list');
    await page.screenshot({ path: path.join(shots, 'audio-library-music.png') });

    step('browse by genre, mood and use with a click');
    for (const [group, chip, lens] of [['Genre', 'Jazz', 'jazz'], ['Mood', 'Calm & relaxing', 'calm'], ['Made for', 'Trailers', 'trailer']]) {
      await page.locator('.music-groups button', { hasText: group }).click();
      await pick(chip);
      await settled('music', `s.lens === ${JSON.stringify(lens)}`); m = await music(); console.log(`   ${chip}:`, JSON.stringify(m));
      assert.ok(m.n >= 10, chip + ' returns a healthy list');
    }
    assert.ok(await page.locator('.audio-row .lic-copy').count() > 0, 'credit-required tracks carry a Credit badge');
    await page.screenshot({ path: path.join(shots, 'audio-library-category.png') });

    step('collection: film & video scores');
    await page.locator('.music-groups button', { hasText: 'Collections' }).click();
    await pick('Film & video scores');
    await settled('music', 's.source === "incompetech"'); m = await music(); console.log('  ', JSON.stringify(m));
    assert.deepEqual(m.providers, ['incompetech']); assert.ok(m.n >= 15);

    step('preview a track');
    await page.locator('.audio-row .lib-play').first().click();
    await page.waitForFunction(() => window.__fc.creative.preview.value.state === 'playing', null, { timeout: 45000 });
    await page.waitForFunction(() => window.__fc.creative.previewTime.value > 0.5, null, { timeout: 20000 });
    console.log('   playing:', await page.evaluate(() => window.__fc.creative.preview.value.title));
    await page.evaluate(() => window.__fc.creative.stopPreview());

    step('copy its credit from the badge, then add it to the timeline');
    await page.locator('.audio-row .lic-copy').first().click(); await page.waitForTimeout(300); console.log('   toast:', await toastText());
    const before = await page.evaluate(() => window.__fc.state.project.value.clips.filter(c => c.kind === 'audio').length);
    await page.locator('.audio-row').first().locator('button.add').click();
    await page.waitForFunction(n => window.__fc.state.project.value.clips.filter(c => c.kind === 'audio').length > n, before, { timeout: 120000 });
    const added = await page.evaluate(() => { const p = window.__fc.state.project.value; const c = p.clips.filter(x => x.kind === 'audio').at(-1); const a = window.__fc.state.media.value.get(c.mediaId); return { clip: c.name, duration: a.duration, license: a.source.license, creator: a.source.creator, record: Object.values(p.attributions || {}).some(r => r.mediaIds.includes(a.id)), file: a.fileName }; });
    console.log('  ', JSON.stringify(added));
    assert.equal(added.license, 'by'); assert.equal(added.record, true, 'the credit record travels with the project'); assert.ok(added.duration > 5); assert.match(added.file, /\.mp3$/);

    step('an item that is gone says so, and is greyed out');
    await page.evaluate(() => { const c = window.__fc.creative; const ghost = { provider: 'ccmixter', sourceId: '999999999', key: 'ccmixter:999999999', kind: 'music', title: 'Ghost track', license: 'by', licenseVersion: '3.0', sourceName: 'ccMixter' }; const s = c.searches.music; s.value = { ...s.value, results: [ghost, ...s.value.results] }; });
    await page.locator('.audio-row', { hasText: 'Ghost track' }).locator('.lib-play').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Ghost track|no longer available/.test(t.textContent)), null, { timeout: 60000 });
    const said = await toastText(); console.log('   toast:', said); assert.match(said, /can’t be played: it is no longer available from ccMixter/);
    await page.locator('.audio-row.unavailable', { hasText: 'Ghost track' }).waitFor({ timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__fc.creative.preview.value.state), 'idle', 'no spinner left behind');
    await page.screenshot({ path: path.join(shots, 'audio-library-unavailable.png') });

    step('favorites keep what you heart');
    await page.locator('.audio-row .fav-btn:not(.on)').first().click(); await page.waitForFunction(() => window.__fc.creative.lists.value.audio.favorites.length > 0);
    await page.locator('.lib-tabs button', { hasText: 'Favorites' }).click();
    await page.locator('.audio-row').first().waitFor(); assert.ok(await page.locator('.audio-row').count() >= 1);

    step('sound effects by category');
    await page.locator('.lib-tabs button', { hasText: 'Sound FX' }).click();
    for (const chip of ['Whooshes & transitions', 'Doors', 'Clicks & interface']) {
      await pick(chip);
      await settled('sfx', 's.category.startsWith("fx:")'); const fx = await page.evaluate(() => { const s = window.__fc.creative.searches.sfx.value; return { category: s.category, n: s.results.length, providers: [...new Set(s.results.map(r => r.provider))], partial: (s.partial || []).map(p => p.provider + ':' + p.code) }; });
      console.log(`   ${chip}:`, JSON.stringify(fx)); assert.ok(fx.n >= 10, chip + ' returns a healthy list');
    }
    // A sound effect can be over in a quarter of a second, so the playing state is recorded rather than polled for.
    await page.evaluate(() => { window.__played = false; window.__fc.creative.preview.subscribe(v => { if (v.state === 'playing') window.__played = true; }); });
    await page.locator('.audio-row .lib-play').first().click();
    await page.waitForFunction(() => window.__played, null, { timeout: 45000 });
    await page.evaluate(() => window.__fc.creative.stopPreview());
    await page.screenshot({ path: path.join(shots, 'audio-library-sfx.png') });

    step('Discover shows categories and collections');
    await page.locator('.lib-tabs button', { hasText: 'Discover' }).click();
    await page.locator('.audio-collections button').first().waitFor();
    await page.screenshot({ path: path.join(shots, 'audio-library-discover.png') });
    assert.deepEqual(errors, [], 'no page errors');
    console.log('AUDIO LIBRARY JOURNEY PASSED');
  } catch (e) { console.error('FAILED:', e.message); if (errors.length) console.error(errors.join('\n')); await page?.screenshot({ path: path.join(shots, 'audio-library-failure.png') }).catch(() => {}); process.exitCode = 1; }
  finally { await app?.close().catch(() => {}); if (!process.env.FRAMECUT_TEST_DIR) await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
})();
