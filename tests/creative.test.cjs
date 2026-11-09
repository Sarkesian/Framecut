// Creative Library: rights rules, provider adapter against a mock Openverse (rate limits, license
// re-checks, bad downloads, dedupe), safe HTTP, sticker baking and frame-accurate looping stickers
// whose exported phase matches the preview's plan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { startServer } = require('../desktop/server.cjs');
const { SafeHttp } = require('../desktop/providers/http.cjs');
const { run, ffmpeg, ffprobe } = require('../desktop/tools.cjs');
const { assessRights, creditsText, preflight, openverseLicenseFilter } = require('../shared/rights.mjs');
const { newProject, newClip } = require('../shared/model.mjs');
const { buildPlan, sourceTime, STICKER_BOX } = require('../shared/plan.mjs');

const json = async r => { const d = await r.json(); if (!r.ok) throw Object.assign(Error(d.error), d); return d; };
const api = base => (url, body, method = body ? 'POST' : 'GET') => fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(json);
async function waitJob(call, id, ms = 60000) { const t = Date.now(); for (;;) { const j = await call('/api/jobs/' + id); if (!['queued', 'running'].includes(j.status)) return j; if (Date.now() - t > ms) throw Error('timeout'); await new Promise(r => setTimeout(r, 100)); } }
// RGB of one pixel of a video frame at time t.
async function pixel(file, t, x, y) {
  const r = await run(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=1:1:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-'], { encoding: 'buffer' });
  const buf = r.out;
  return [...buf.subarray(0, 3)];
}
// Colour class of a pixel (encoding shifts exact values, e.g. pure green → 0,212,0 in limited-range H.264).
const cls = px => { const [r, g, b] = px, mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx - mn < 30) return 'gray'; return r === mx ? 'red' : g === mx ? 'green' : 'blue'; };
const near = (a, b) => cls(a) === cls(b);

test('Rights: licenses are judged per usage mode, never shown as safer than the source says', () => {
  const r = (license, kind = 'music', usage = 'commercial') => assessRights({ provider: 'openverse', license, licenseVersion: '4.0', kind, usage });
  assert.equal(r('cc0').level, 'ok'); assert.equal(r('cc0').attribution, false);
  assert.equal(r('by').level, 'credit'); assert.equal(r('by').export, true);
  assert.equal(r('by-sa').level, 'caution');
  assert.equal(r('by-nc').blocked, true, 'NC blocked for commercial'); assert.equal(r('by-nc', 'music', 'personal').blocked, false, 'NC fine for personal');
  assert.equal(r('by-nd', 'music', 'personal').blocked, true, 'ND music cannot be synced to video');
  assert.equal(r('by-nd', 'sfx', 'personal').blocked, true);
  assert.equal(r('by-nd', 'sticker', 'commercial').blocked, false, 'ND images may be used unmodified');
  assert.equal(r('by-nc-nd', 'music', 'personal').blocked, true);
  const unknown = r(''); assert.equal(unknown.level, 'unknown'); assert.equal(unknown.storage, false); assert.equal(unknown.export, false);
  assert.equal(r('something-odd').level, 'unknown');
  assert.equal(assessRights({ provider: 'fluent', license: 'mit', kind: 'sticker' }).export, true);
  for (const p of ['iconscout', 'epidemic', 'giphy', 'tenor', 'freesound', 'jamendo']) assert.equal(assessRights({ provider: p, license: 'cc0' }).blocked, true, p + ' must not be usable');
  assert.ok(!openverseLicenseFilter('commercial', 'music').some(l => l.includes('nc') || l.includes('nd')));
  assert.ok(openverseLicenseFilter('personal', 'music').includes('by-nc') && !openverseLicenseFilter('personal', 'music').includes('by-nd'));
  // Credits: one line per source, Openverse attribution preferred, MIT notice kept.
  const src = [
    { provider: 'openverse', sourceId: 'a', title: 'Song', creator: 'Ann', license: 'by', licenseVersion: '4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourcePageUrl: 'https://example.org/song', attribution: '"Song" by Ann is licensed under CC BY 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/.' },
    { provider: 'openverse', sourceId: 'a', title: 'Song' },
    { provider: 'fluent', sourceId: 'party-popper', title: 'Party popper', creator: 'Microsoft', license: 'mit', holder: 'Microsoft Corporation', licenseUrl: 'https://github.com/microsoft/fluentui-emoji-animated/blob/main/LICENSE' },
  ];
  const text = creditsText(src, { projectName: 'Demo' });
  assert.equal(text.match(/•/g).length, 2); assert.match(text, /"Song" by Ann is licensed under CC BY 4\.0/); assert.doesNotMatch(text, /To view a copy/); assert.match(text, /MIT, © Microsoft Corporation/);
  // Preflight follows the project's usage mode and ignores own files.
  const p = newProject(); p.usageMode = 'commercial';
  p.clips.push(newClip('audio', { mediaId: 'm1', trackId: 'audio-1' }), newClip('audio', { mediaId: 'm2', trackId: 'audio-1' }), newClip('audio', { mediaId: 'm3', trackId: 'audio-1' }));
  const sources = { m1: { provider: 'openverse', sourceId: 'x', title: 'NC song', license: 'by-nc', kind: 'music' }, m2: { provider: 'openverse', sourceId: 'y', title: 'BY sound', license: 'by', kind: 'sfx', creator: 'Bo' }, m3: { provider: 'local', sourceId: 'file:a' } };
  let pf = preflight(p, id => sources[id]);
  assert.equal(pf.items.length, 2); assert.equal(pf.blocked.length, 1); assert.equal(pf.blocked[0].source.title, 'NC song'); assert.match(pf.credits, /BY sound/); assert.match(pf.credits, /NC song/, 'flagged assets still need their credit if exported with separate permission');
  p.usageMode = 'personal'; pf = preflight(p, id => sources[id]); assert.equal(pf.blocked.length, 0); assert.equal(pf.caution.length, 1);
});

test('Safe HTTP: private addresses, plain http, oversize and wrong types are refused', async () => {
  const srv = http.createServer((req, res) => { if (req.url === '/big') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(3000)); } else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>'); } });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-http-'));
  try {
    const strict = new SafeHttp();
    await assert.rejects(strict.open(base + '/big'), e => e.code === 'unsafe', 'plain http rejected');
    await assert.rejects(strict.open('https://127.0.0.1/x'), e => e.code === 'unsafe', 'loopback rejected');
    await assert.rejects(strict.open('https://192.168.1.10/x'), e => e.code === 'unsafe', 'LAN rejected');
    const local = new SafeHttp({ allowLocal: true });
    await assert.rejects(local.toFile(base + '/big', path.join(dir, 'a'), { maxBytes: 1000, accept: /^audio\// }), e => e.code === 'size');
    assert.ok(!fss.existsSync(path.join(dir, 'a')) && !fss.existsSync(path.join(dir, 'a.part')), 'no partial file left');
    await assert.rejects(local.toFile(base + '/page', path.join(dir, 'b'), { accept: /^audio\// }), e => e.code === 'type');
  } finally { srv.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('Openverse adapter: search, rate limits, license re-check, bad downloads and dedupe (mock service)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-ov-')); let s, srv;
  try {
    const tone = path.join(dir, 'tone.mp3'); await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:a', 'libmp3lame', '-b:a', '96k', tone]);
    const toneBytes = await fs.readFile(tone);
    let base = ''; const hits = { search: 0 }; let limited = false; const licenses = { a: 'by', b: 'by', c: 'cc0', d: 'cc0', e: 'by' };
    const item = id => ({ id: `0000000${id}-0000-0000-0000-000000000000`.slice(-36).replace(/^0+/, m => '0'.repeat(m.length)), title: `Track ${id}.wav`, url: `${base}/file/${id}`, creator: 'Tester', creator_url: 'https://example.org/t', foreign_landing_url: `https://example.org/track/${id}`, license: licenses[id], license_version: licenses[id] === 'cc0' ? '1.0' : '4.0', license_url: licenses[id] === 'cc0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : `https://creativecommons.org/licenses/${licenses[id]}/4.0/`, source: 'freesound', provider: 'freesound', duration: 2000, filetype: 'mp3', tags: [{ name: 'whoosh' }], attribution: licenses[id] === 'cc0' ? `"Track ${id}" by Tester is marked with CC0 1.0.` : `"Track ${id}" by Tester is licensed under CC ${licenses[id].toUpperCase()} 4.0.` });
    const ids = ['a', 'b', 'c', 'd', 'e']; const uuid = id => item(id).id;
    srv = http.createServer((req, res) => {
      const u = new URL(req.url, base);
      if (u.pathname === '/v1/audio/') {
        hits.search++; if (limited) { res.writeHead(429, { 'Retry-After': '42', 'Content-Type': 'application/json' }); return res.end('{"detail":"throttled"}'); }
        assert.equal(u.searchParams.get('page_size'), '20'); assert.match(u.searchParams.get('license'), /by/);
        const results = [...ids.map(item), { id: 'bad', title: 'No url' }, { ...item('a') }, { ...item('b'), id: 'ffffffff-0000-0000-0000-000000000000', mature: true }];
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ result_count: 5, page_count: 1, page: 1, results }));
      }
      const m = /^\/v1\/audio\/([0-9a-f-]{36})\/$/.exec(u.pathname);
      if (m) { const id = ids.find(i => uuid(i) === m[1]); if (!id || id === 'e') { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{}'); } res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(item(id))); }
      const f = /^\/file\/(\w)$/.exec(u.pathname);
      if (f) {
        if (f[1] === 'd') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return res.end(Buffer.from('this is not audio at all, just text pretending')); }
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': toneBytes.length }); return res.end(toneBytes);
      }
      res.writeHead(404); res.end();
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}`;
    s = await startServer({ dataDir: path.join(dir, 'data'), creative: { http: new SafeHttp({ allowLocal: true }), openverseBase: base + '/v1', assetpolishBase: false } });
    const call = api(s.url);
    const r1 = await call('/api/creative/search?provider=openverse&kind=sfx&include=credit&q=whoosh');
    assert.equal(r1.items.length, 5, 'malformed, mature and duplicate results are dropped');
    assert.equal(r1.items[0].title, 'Track a', 'file extension stripped from titles');
    assert.ok(!('downloadUrl' in r1.items[0]), 'download URLs stay on the service');
    await call('/api/creative/search?provider=openverse&kind=sfx&include=credit&q=whoosh'); assert.equal(hits.search, 1, 'repeated searches are served from cache');
    limited = true;
    await assert.rejects(call('/api/creative/search?provider=openverse&kind=sfx&include=credit&q=other'), e => e.code === 'quota' && e.retryAfter === 42);
    await assert.rejects(call('/api/creative/search?provider=openverse&kind=sfx&include=credit&q=third'), e => e.code === 'quota', 'client backs off without calling again');
    assert.equal(hits.search, 2);
    s.creative.providers.openverse.blockedUntil = 0; limited = false; // the back-off window has been shown to work; continue
    // Import: license is re-checked from the detail endpoint; a changed license blocks the import.
    licenses.b = 'by-nc';
    let j = await waitJob(call, (await call('/api/creative/import', { provider: 'openverse', id: uuid('b'), kind: 'sfx', usage: 'commercial' })).job);
    assert.equal(j.status, 'failed'); assert.match(j.error, /non-commercial/i);
    j = await waitJob(call, (await call('/api/creative/import', { provider: 'openverse', id: uuid('e'), kind: 'sfx' })).job);
    assert.equal(j.status, 'failed'); assert.match(j.error, /no longer available/i);
    j = await waitJob(call, (await call('/api/creative/import', { provider: 'openverse', id: uuid('d'), kind: 'sfx' })).job);
    assert.equal(j.status, 'failed'); assert.match(j.error, /could not be read/i);
    assert.equal((await fs.readdir(path.join(dir, 'data', 'media', 'library', 'openverse'))).filter(n => !n.startsWith('.')).length, 0, 'corrupt download removed');
    // A good import keeps provenance and a license snapshot, and lands in project-managed media.
    j = await waitJob(call, (await call('/api/creative/import', { provider: 'openverse', id: uuid('a'), kind: 'sfx', usage: 'commercial' })).job);
    assert.equal(j.status, 'done', j.error); const a = j.result.asset;
    assert.equal(a.kind, 'audio'); assert.ok(Math.abs(a.duration - 2) < 0.15); assert.equal(a.source.license, 'by'); assert.equal(a.source.creator, 'Tester'); assert.equal(a.role, 'library-audio');
    assert.ok(a.folder.startsWith(path.join(dir, 'data', 'media', 'library')), 'stored under the data folder, not elsewhere');
    // Same item again → reused without downloading; same bytes under another id → same file.
    const again = await call('/api/creative/import', { provider: 'openverse', id: uuid('a'), kind: 'sfx' }); assert.equal(again.reused, true); assert.equal(again.asset.id, a.id);
    j = await waitJob(call, (await call('/api/creative/import', { provider: 'openverse', id: uuid('c'), kind: 'sfx' })).job);
    assert.equal(j.result.asset.id, a.id, 'identical content is deduplicated by hash');
    const r2 = await call('/api/creative/search?provider=openverse&kind=sfx&include=credit&q=whoosh'); assert.equal(r2.items.find(x => x.sourceId === uuid('a')).imported, a.id);
    // Favorites and recents persist across restarts; the downloaded file keeps working offline.
    await call('/api/creative/favorite', { record: r2.items[0], on: true });
    await s.close(); srv.close(); srv = null;
    s = await startServer({ dataDir: path.join(dir, 'data'), creative: { http: new SafeHttp({ allowLocal: true }), openverseBase: 'http://127.0.0.1:9/v1', assetpolishBase: false } });
    const call2 = api(s.url); const lists = await call2('/api/creative/lists?kind=sfx');
    assert.equal(lists.favorites.length, 1); assert.ok(lists.recents.length >= 1);
    const media = await call2('/api/media'); const back = media.find(m => m.id === a.id); assert.ok(back && !back.missing, 'library asset available offline');
    await assert.rejects(call2('/api/creative/search?provider=openverse&kind=sfx&q=new'), e => e.code === 'offline');
    await assert.rejects(call2('/api/creative/search?provider=giphy&q=x'), /not available|forbid|caching/i);
  } finally { await s?.close(); srv?.close(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});

test('Stickers: GIF / APNG bake to transparent loops; SVG is sanitized; Lottie is validated', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-st-')); let s;
  try {
    // 3-frame animation at 1 fps: red, green, blue 64 px squares on a transparent 128 px canvas.
    const frames = `color=c=red:s=64x64:d=1:r=10[a];color=c=lime:s=64x64:d=1:r=10[b];color=c=blue:s=64x64:d=1:r=10[c];[a][b][c]concat=n=3:v=1,format=rgba,pad=128:128:32:32:color=0x00000000`;
    const apng = path.join(dir, 'Traffic.png'), gif = path.join(dir, 'Blink.gif');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'nullsrc=s=16x16:d=1', '-filter_complex', frames, '-plays', '0', '-f', 'apng', apng]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'nullsrc=s=16x16:d=1', '-filter_complex', frames + ',split[x][y];[x]palettegen=reserve_transparent=1[p];[y][p]paletteuse=alpha_threshold=128', '-loop', '0', gif]);
    const svg = path.join(dir, 'Star.svg');
    await fs.writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><image xlink:href="https://evil.example/x.png"/><rect width="10" height="10" fill="gold" style="fill:url(https://evil.example/f)"/></svg>');
    const bad = path.join(dir, 'Bad.json'); await fs.writeFile(bad, JSON.stringify({ v: '5.7', fr: 30, ip: 0, op: 60, w: 100, h: 100, layers: [], assets: [{ id: 'i', p: 'https://evil.example/img.png', u: '' }] }));
    const good = path.join(dir, 'Wave.json'); await fs.writeFile(good, JSON.stringify({ v: '5.7', fr: 30, ip: 0, op: 30, w: 100, h: 100, layers: [], assets: [] }));
    const doctype = path.join(dir, 'Xxe.svg'); await fs.writeFile(doctype, '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>');
    s = await startServer({ dataDir: path.join(dir, 'data') });
    const call = api(s.url);
    const r = await call('/api/creative/stickers/import', { paths: [apng, gif, svg, bad, good, doctype] });
    assert.deepEqual(r.errors.map(e => e.name).sort(), ['Bad.json', 'Xxe.svg']);
    assert.equal(r.renderer.length, 1, 'Lottie goes to the editor for frame rendering'); assert.equal(r.renderer[0].type, 'lottie');
    const [pa, ga, sa] = r.ready;
    for (const a of [pa, ga]) { assert.equal(a.kind, 'video'); assert.equal(a.alpha, true); assert.equal(a.role, 'sticker'); assert.ok(Math.abs(a.duration - 3) < 0.2, 'duration kept: ' + a.duration); }
    const clean = await fs.readFile(path.join(sa.folder, sa.fileName), 'utf8');
    assert.doesNotMatch(clean, /script|onload|evil\.example/); assert.match(clean, /fill="gold"/);
    // Re-importing the same file reuses the baked sticker.
    const again = await call('/api/creative/stickers/import', { paths: [apng] }); assert.equal(again.ready[0].id, pa.id);
    // Frames posted by the editor (Lottie / animated WebP path) become the same kind of sticker.
    const tok = r.renderer[0].token; const { id } = await call('/api/creative/bake/start', { name: 'Wave', fps: 10, width: 64, height: 64, count: 5, token: tok });
    for (let i = 0; i < 5; i++) {
      const png = (await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=0x${(i * 40).toString(16).padStart(2, '0')}80ff@0.5:s=64x64,format=rgba`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], { encoding: 'buffer' })).out;
      await fetch(`${s.url}/api/creative/bake/${id}/frame/${i}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png }).then(json);
    }
    await assert.rejects(fetch(`${s.url}/api/creative/bake/${id}/frame/9`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from('nope') }).then(json));
    const jb = await waitJob(call, (await call(`/api/creative/bake/${id}/finish`, {})).job);
    assert.equal(jb.status, 'done', jb.error); assert.equal(jb.result.asset.alpha, true); assert.ok(Math.abs(jb.result.asset.duration - 0.5) < 0.12);

    // Looping sticker over a gray background: export frames show the animation at the plan's phase.
    const bg = path.join(dir, 'Gray.mp4'); await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x808080:s=640x360:r=30:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', bg]);
    const bgA = (await call('/api/media/import', { paths: [bg] })).assets[0];
    const proj = await call('/api/projects', { name: 'Sticker loop' });
    const v = newClip('video', { mediaId: bgA.id, trackId: 'main', start: 0, duration: 8, in: 0 });
    const st = newClip('sticker', { sticker: { type: 'media' }, mediaId: pa.id, trackId: 'text-1', start: 0.5, duration: 6, in: 0, speed: 1, loop: true });
    const st2 = newClip('sticker', { sticker: { type: 'media' }, mediaId: ga.id, trackId: 'text-1', start: 6.5, duration: 1.5, in: 1, speed: 2, loop: true, transform: { x: 0.3, scale: 0.5 } });
    proj.clips.push(v, st, st2); proj.mediaIds.push(bgA.id, pa.id, ga.id);
    // Preview plan: phase and geometry.
    const plan = buildPlan(proj, { W: 1280, H: 720, media: id => [bgA, pa, ga].find(x => x.id === id) });
    const L = plan.layers.find(x => x.id === st.id); assert.equal(L.type, 'media'); assert.equal(L.loop, true);
    assert.ok(Math.abs(L.baseH - STICKER_BOX * 720) < 1, 'default sticker size');
    assert.ok(Math.abs(sourceTime(L, 4.0) - 0.5) < 1e-6, 'looped phase'); // (4.0-0.5) mod 3 = 0.5
    const out = path.join(dir, 'loop.mp4');
    const job = await waitJob(call, (await call('/api/export', { project: proj, rasters: {}, settings: { format: 'mp4', codec: 'h264', resolution: 720, fps: 30, quality: 'high', output: out, hardware: 'off' } })).job, 120000);
    assert.equal(job.status, 'done', job.error);
    const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255], GRAY = [128, 128, 128];
    // Sticker covers ~259 px centered at (640,360); its colored square is the middle half.
    const checks = [[0.25, GRAY], [1.0, RED], [2.0, GREEN], [3.0, BLUE], [4.0, RED], [5.2, GREEN], [6.2, BLUE]];
    for (const [t, want] of checks) {
      const ph = sourceTime(L, t); const exp = t < 0.5 ? GRAY : [RED, GREEN, BLUE][Math.floor(ph + 1e-6) % 3];
      assert.deepEqual(want, exp, 'test table agrees with the plan at ' + t);
      const got = await pixel(out, t, 640, 360); assert.ok(near(got, want), `t=${t}: expected ${want} got ${got}`);
      assert.ok(near(await pixel(out, t, 640 - 100, 360), GRAY), `transparent margin shows the background at t=${t}`);
    }
    // Second sticker: GIF source, starts mid-animation (in=1 → green) and plays at 2× → blue after 0.5 s.
    const L2 = buildPlan(proj, { W: 1280, H: 720, media: id => [bgA, pa, ga].find(x => x.id === id) }).layers.find(x => x.id === st2.id);
    const cx = Math.round(640 + 0.3 * 1280);
    assert.ok(near(await pixel(out, 6.7, cx, 360), [GREEN, BLUE, RED][0]), 'GIF sticker at in-point'); assert.equal(Math.floor(sourceTime(L2, 6.7)), 1);
    assert.ok(near(await pixel(out, 7.3, cx, 360), BLUE), 'GIF sticker at 2× speed'); assert.equal(Math.floor(sourceTime(L2, 7.3)), 2);
    // Reopen: the project and its sticker assets reload from disk.
    await call(`/api/projects/${proj.id}`, proj, 'PUT');
    const re = await call(`/api/projects/${proj.id}`); assert.equal(re.clips.filter(c => c.kind === 'sticker').length, 2); assert.ok(re.mediaIds.includes(pa.id));
  } finally { await s?.close(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});
