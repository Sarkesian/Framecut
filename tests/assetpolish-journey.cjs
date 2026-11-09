// Real internet + real Electron UI + FFmpeg export. No provider or thumbnail mocks.
const { launchApp } = require('./launch.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { run, ffmpeg, ffprobe } = require('../desktop/tools.cjs');
const out = path.resolve(process.env.FRAMECUT_QA_OUT || 'test-output/assetpolish');
const step = text => console.log('· ' + text);
const json = async r => { const d = await r.json(); if (!r.ok) throw Error(d.error); return d; };
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-ap-live-')); let app;
  const evidence = { checkedAt: new Date().toISOString(), assets: [], errors: [] };
  try {
    await fs.mkdir(out, { recursive: true });
    const bg = path.join(temp, 'Background.mp4');
    await run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x384858:s=1280x720:r=30:d=9', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', bg]);
    app = await launchApp({ ...process.env, FRAMECUT_TEST: '1', FRAMECUT_TEST_DIR: temp });
    const page = await app.firstWindow();
    page.on('pageerror', e => evidence.errors.push(e.message));
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
    await page.evaluate(async bg => {
      const { state, edit, api } = window.__fc;
      state.commit('Demo settings', p => { p.name = 'AssetPolish verified collection'; p.settings.resolution = 720; });
      const r = await api('/api/media/import', { paths: [bg] }); await state.refreshMedia(); edit.addAssets(r.assets, { at: 0 });
      state.time.value = 1; state.player.current.seek(1);
    }, bg);
    step('open Stickers without entering a search term');
    await page.getByRole('button', { name: 'Stickers', exact: true }).click();
    await page.waitForFunction(() => window.__fc.creative.searches.stickers.value.status === 'ok', { timeout: 60000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.img-card img')].filter(i => i.complete && i.naturalWidth > 0).length >= 8, { timeout: 60000 });
    const initial = await page.evaluate(() => {
      const s = window.__fc.creative.searches.stickers.value;
      return { q: s.q, total: s.total, count: s.results.length, providers: [...new Set(s.results.map(r => r.provider))], collections: [...new Set(s.results.map(r => r.category))], rendered: [...document.querySelectorAll('.img-card img')].filter(i => i.complete && i.naturalWidth > 0).length };
    });
    assert.equal(initial.q, ''); assert.ok(initial.total > 3800); assert.ok(initial.count >= 40);
    assert.deepEqual(initial.providers, ['assetpolish']); assert.ok(initial.collections.length >= 10);
    evidence.initial = initial;
    await page.screenshot({ path: path.join(out, '01-expanded-library.png') });
    console.log(JSON.stringify(initial));

    step('Show more visibly adds a second page');
    await page.getByRole('button', { name: 'Show more', exact: true }).click();
    await page.waitForFunction(() => window.__fc.creative.searches.stickers.value.results.length >= 80);
    assert.equal(await page.locator('.img-card').count(), 80);
    evidence.afterShowMore = 80;

    step('enumerate every catalog page: no duplicates, gaps or hidden cap');
    const base = new URL(page.url()).origin;
    const seen = new Set(), pages = [];
    for (let n = 1; ; n++) {
      const data = await fetch(base + '/api/creative/search?provider=assetpolish&kind=sticker&page=' + n).then(json);
      for (const r of data.items) { assert.equal(seen.has(r.sourceId), false, r.sourceId); seen.add(r.sourceId); }
      pages.push(data.items.length);
      if (n >= data.pages) { assert.equal(seen.size, data.total); evidence.catalog = { total: data.total, pages: data.pages, uniqueIds: seen.size, lastPage: data.items.length }; break; }
    }
    console.log(JSON.stringify(evidence.catalog));

    step('browse three collections, see real thumbnails, click assets onto the timeline');
    const collections = ['Animal Pals', 'Food counter', 'Travel light'];
    for (let i = 0; i < collections.length; i++) {
      await page.getByRole('combobox', { name: 'Sticker source' }).selectOption('assetpolish');
      await page.locator('.lib-collections').evaluate(el => { el.open = true; });
      await page.getByRole('combobox', { name: 'Sticker collection' }).selectOption('collection:' + collections[i]);
      await page.waitForFunction(name => {
        const s = window.__fc.creative.searches.stickers.value;
        return s.status === 'ok' && s.results.length && s.results.every(r => r.category === name);
      }, collections[i]);
      const tile = page.locator('.img-card').first(); await tile.scrollIntoViewIfNeeded();
      await tile.locator('img').evaluate(img => img.decode());
      const record = await page.evaluate(() => structuredClone(window.__fc.creative.searches.stickers.value.results[0]));
      await page.evaluate(at => { window.__fc.state.time.value = at; window.__fc.state.player.current.seek(at); }, i * 3);
      await tile.click();
      await page.waitForFunction(n => window.__fc.state.project.value.clips.filter(c => c.kind === 'sticker').length === n, i + 1, { timeout: 60000 });
      await page.evaluate(t => { window.__fc.state.selection.value = []; window.__fc.state.player.current.seek(t); }, i * 3 + 1);
      await page.waitForFunction(() => {
        const pl = window.__fc.state.player.current;
        return pl.getPlan().layers.some(l => l.type === 'raster' && pl.t >= l.vs && pl.t < l.ve && [...pl.comp.textures.keys()].some(k => k.startsWith('r:')));
      });
      await page.waitForTimeout(400);
      const data = await page.evaluate(id => {
        const { state } = window.__fc; const c = state.project.value.clips.find(c => c.kind === 'sticker' && state.media.value.get(c.mediaId)?.source?.sourceId === id);
        const a = state.media.value.get(c.mediaId);
        return { clipId: c.id, mediaId: a.id, title: a.source.title, sourceId: a.source.sourceId, provider: a.source.provider, license: a.source.license, sha256: a.source.licenseRecord.sha256, missing: a.missing, alpha: a.alpha };
      }, record.sourceId);
      assert.equal(data.provider, 'assetpolish'); assert.equal(data.license, 'cc0'); assert.equal(data.missing, false);
      evidence.assets.push({ ...data, collection: collections[i] });
      await page.screenshot({ path: path.join(out, `0${i + 2}-asset-${i + 1}-timeline.png`) });
      const png = await page.evaluate(() => window.__fc.state.player.current.snapshot('image/png'));
      await fs.writeFile(path.join(out, `preview-${i + 1}.png`), Buffer.from(png.split(',')[1], 'base64'));
    }

    step('search a known asset by its exact name');
    await page.getByRole('combobox', { name: 'Sticker collection' }).selectOption('');
    await page.getByRole('searchbox', { name: /Search stickers/ }).fill(evidence.assets[0].title);
    await page.waitForFunction(id => { const s = window.__fc.creative.searches.stickers.value; return s.status === 'ok' && s.results.some(r => r.sourceId === id); }, evidence.assets[0].sourceId);
    evidence.searchVerified = evidence.assets[0].title;

    step('export all three genuine stickers through the Export dialog');
    const video = path.join(out, 'AssetPolish-verified.mp4');
    await fs.unlink(video).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await page.keyboard.press('Control+e');
    await page.waitForFunction(() => document.querySelector('.modal input[aria-label="Output file"]')?.value);
    await page.locator('.modal input[aria-label="Output file"]').fill(video);
    await page.locator('.modal-foot .btn.primary').click();
    await page.getByText('Your video is ready').waitFor({ timeout: 180000 });
    await page.screenshot({ path: path.join(out, '05-export-complete.png') });
    const info = JSON.parse((await run(ffprobe, ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', video])).out);
    assert.ok(Math.abs(+info.format.duration - 9) < 0.15);
    evidence.export = { duration: +info.format.duration, width: info.streams.find(s => s.codec_type === 'video').width, height: info.streams.find(s => s.codec_type === 'video').height, comparisons: [] };
    const pixels = async file => (await run(ffmpeg, ['-v', 'error', '-i', file, '-vf', 'scale=160:90', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' })).out;
    for (let i = 0; i < 3; i++) {
      const frame = path.join(out, `export-${i + 1}.png`);
      await run(ffmpeg, ['-y', '-v', 'error', '-ss', String(i * 3 + 1), '-i', video, '-frames:v', '1', frame]);
      const [preview, exported] = await Promise.all([pixels(path.join(out, `preview-${i + 1}.png`)), pixels(frame)]);
      let diff = 0, visible = 0;
      for (let p = 0; p < preview.length; p++) { diff += Math.abs(preview[p] - exported[p]); if (Math.abs(exported[p] - exported[p % 3]) > 10) visible++; }
      diff /= preview.length;
      assert.ok(diff < 8, 'preview/export difference: ' + diff);
      assert.ok(visible > 150, 'sticker visibly changes the exported frame: ' + visible);
      evidence.export.comparisons.push({ asset: evidence.assets[i].title, meanDifference: diff, visibleSamples: visible });
    }
    assert.deepEqual(evidence.errors, []);
    await page.evaluate(() => window.__fc.state.saveNow());
    evidence.passed = true;
    console.log('PASS real AssetPolish journey');
  } finally {
    await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(evidence, null, 2));
    if (app) await app.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
