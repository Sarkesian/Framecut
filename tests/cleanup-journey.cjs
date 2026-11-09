// Cleanup regressions run against the real Electron renderer and local service.
const { launchApp } = require('./launch.cjs');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const { newClip } = require('../shared/model.mjs');
const out = path.resolve(process.env.FRAMECUT_QA_OUT || 'test-output/cleanup');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-cleanup-')); let app;
  const errors = [];
  try {
    await fs.mkdir(out, { recursive: true });
    app = await launchApp({ ...process.env, FRAMECUT_TEST: '1', FRAMECUT_TEST_DIR: temp });
    const page = await app.firstWindow();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/creative/warm?*', route => route.fulfill({ json: { ok: true } }));
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
    await page.evaluate(() => { window.__fc.state.libraryTab.value = 'audio'; });
    await page.locator('.lib-mix').waitFor();
    console.log('· mix labels stay inside their buttons at narrow and wide panel sizes');
    for (const width of [230, 250, 280, 340]) {
      const result = await page.evaluate(w => {
        const panel = document.querySelector('.asset-content'); panel.style.width = w + 'px'; panel.style.flex = 'none';
        const row = document.querySelector('.lib-mix'), bounds = row.getBoundingClientRect();
        return [...row.querySelectorAll('button')].map(b => {
          const r = b.getBoundingClientRect(); const text = document.createRange(); text.selectNodeContents(b);
          const t = text.getBoundingClientRect();
          return { text: b.textContent, fits: t.left >= r.left && t.right <= r.right + 1 && t.top >= r.top && t.bottom <= r.bottom + 1, inRow: r.left >= bounds.left && r.right <= bounds.right + 1 };
        });
      }, width);
      assert.ok(result.every(r => r.fits && r.inRow), JSON.stringify({ width, result }));
      if (width === 230) await page.locator('.asset-content').screenshot({ path: path.join(out, 'sound-controls-narrow.png') });
    }
    await page.evaluate(() => { document.querySelector('.asset-content').removeAttribute('style'); });

    console.log('· concurrent preference edits both persist');
    const settings = await page.evaluate(async () => {
      const { state, api } = window.__fc;
      await state.savePrefs({ libraryBalance: false, libraryDuck: false });
      await Promise.all([state.savePrefs({ libraryBalance: true }), state.savePrefs({ libraryDuck: true })]);
      return api('/api/preferences');
    });
    assert.equal(settings.libraryBalance, true); assert.equal(settings.libraryDuck, true);

    console.log('· stale searches, single-letter queries and duplicate pagination');
    const searchResults = await page.evaluate(async () => {
      const c = window.__fc.creative, original = window.fetch, pending = [];
      window.fetch = (url, options) => String(url).startsWith('/api/creative/search?') ? new Promise(resolve => pending.push({ url, options, resolve })) : original(url, options);
      const answer = (i, title) => pending[i].resolve(new Response(JSON.stringify({ items: [{ key: title, title, provider: 'openverse', kind: 'music', license: 'cc0' }], page: 1, pages: 3, total: 3 }), { status: 200 }));
      const flush = () => new Promise(r => setTimeout(r, 30));
      try {
        c.search('music', { q: 'old' }, { now: true });
        c.search('music', { q: 'n' });
        const abortedImmediately = pending[0].options.signal.aborted;
        answer(0, 'stale'); await new Promise(r => setTimeout(r, 480));
        const short = structuredClone(c.searches.music.value);
        c.search('music', { q: 'new' }, { now: true }); answer(1, 'current'); await flush();
        c.search('music', {}, { more: true }); c.search('music', {}, { more: true });
        const requests = pending.length; answer(2, 'next'); await flush();
        c.search('music', { q: 'clear-me' }, { now: true });
        c.search('music', { q: '' }, { now: true }); answer(3, 'must-not-return'); await flush();
        return { abortedImmediately, short, requests, cleared: structuredClone(c.searches.music.value) };
      } finally { window.fetch = original; }
    });
    assert.equal(searchResults.abortedImmediately, true);
    assert.equal(searchResults.short.status, 'idle'); assert.deepEqual(searchResults.short.results, []);
    assert.equal(searchResults.requests, 3, 'only one pagination request');
    assert.equal(searchResults.cleared.status, 'idle'); assert.deepEqual(searchResults.cleared.results, []);

    console.log('· ducking can be enabled again after it was turned off');
    await page.route('**/api/tools/speech', route => route.fulfill({ json: { speech: [{ start: 1, end: 3 }] } }));
    const clips = [newClip('audio', { id: 'voice', mediaId: 'voice-file', trackId: 'voice-track', duration: 5 }), newClip('audio', { id: 'music', mediaId: 'music-file', trackId: 'music-track', duration: 5 })];
    const ducking = await page.evaluate(async clips => {
      const { state, studio } = window.__fc;
      state.commit('Test mix', p => { p.tracks.push({ id: 'voice-track', kind: 'audio', voice: true }, { id: 'music-track', kind: 'audio' }); p.clips.push(...clips); p.settings.ducking = { on: false, amount: -12, speed: 'normal' }; });
      await studio.applyDucking();
      const enabled = state.project.value.settings.ducking.on;
      const keys = state.project.value.clips.find(c => c.id === 'music').duckKeys;
      studio.clearDucking(); await studio.applyDucking();
      return { enabled, keys, reenabled: state.project.value.settings.ducking.on };
    }, clips);
    assert.equal(ducking.enabled, true); assert.equal(ducking.reenabled, true); assert.ok(ducking.keys.some(k => k.v < 1));

    console.log('· cancelled audio processing stops polling and closing cancels pending requests');
    const playback = await page.evaluate(async () => {
      const original = window.fetch, notices = []; let posts = 0, polls = 0, mode = 'cancelled';
      const Player = window.__fc.state.player.current.constructor;
      const make = () => new Player({ canvas: document.createElement('canvas'), getProject: () => null, getMedia: () => null, onError: m => notices.push(m) });
      const a = { mediaId: 'test-file', processed: 'test-fx', clip: { audioFx: { denoise: 0.5 } } };
      const p = make(), other = make();
      window.fetch = async (url, opts) => {
        if (url === '/api/tools/audiofx') { posts++; return new Response(JSON.stringify({ job: 'test-job' })); }
        if (url === '/api/jobs/test-job') { polls++; return new Response(JSON.stringify({ status: mode })); }
        return original(url, opts);
      };
      try {
        p.processedUrl(a); await new Promise(r => setTimeout(r, 550));
        for (let i = 0; i < 10; i++) p.processedUrl(a);
        const cancelled = { posts, polls, notices: notices.length };
        mode = 'running'; other.processedUrl(a); await new Promise(r => setTimeout(r, 50)); other.destroy();
        const before = polls; await new Promise(r => setTimeout(r, 500));
        return { cancelled, before, after: polls };
      } finally { p.destroy(); other.destroy(); window.fetch = original; }
    });
    assert.deepEqual(playback.cancelled, { posts: 1, polls: 1, notices: 1 });
    assert.equal(playback.before, playback.after);

    console.log('· a completed library download cannot insert into a different project');
    const switched = await page.evaluate(async () => {
      const { state, creative: c } = window.__fc, original = window.fetch; let resolveImport;
      window.fetch = (url, options) => url === '/api/creative/import' ? new Promise(resolve => { resolveImport = resolve; }) : original(url, options);
      try {
        const work = c.useRecord({ key: 'test-download', provider: 'openverse', sourceId: 'test', kind: 'music', title: 'Download', license: 'cc0' });
        await Promise.resolve();
        const next = await window.__fc.api('/api/projects', { name: 'Other project' }); await state.openProject(next.id);
        resolveImport(new Response(JSON.stringify({ asset: { id: 'download-file', name: 'Download.wav', duration: 5, kind: 'audio' } }), { status: 200 }));
        return { id: await work, clips: state.project.value.clips.length, inLibrary: state.media.value.has('download-file') };
      } finally { window.fetch = original; }
    });
    assert.equal(switched.id, null); assert.equal(switched.clips, 0); assert.equal(switched.inLibrary, true);
    const base = new URL(page.url()).origin;
    assert.equal((await fetch(base + '/api/preferences', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(base + '/api/preferences', { headers: { Origin: base + '5' } })).status, 403);
    assert.deepEqual(errors, []);
    console.log('PASS cleanup journey');
  } finally { if (app) await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
