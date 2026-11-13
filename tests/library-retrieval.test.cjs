// Music & sound retrieval: the causes found when "some samples can't be grabbed" was investigated
// (see docs/library-sources.md), each pinned by a fast check. No network: sources are a local mock.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { startServer } = require('../desktop/server.cjs');
const { SafeHttp } = require('../desktop/providers/http.cjs');
const { explain } = require('../desktop/creative.cjs');
const { Incompetech } = require('../desktop/providers/incompetech.cjs');
const { CcMixter } = require('../desktop/providers/ccmixter.cjs');
const { run, ffmpeg } = require('../desktop/tools.cjs');
const { canonicalAudioUrl, AUDIO_DISCOVERY, AUDIO_LENSES, SFX_CATEGORIES, lensById } = require('../shared/audio-library.mjs');
const { creditLine, assessRights } = require('../shared/rights.mjs');

const json = async r => { const d = await r.json(); if (!r.ok) throw Object.assign(Error(d.error), d); return d; };
const api = base => (url, body) => fetch(base + url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(json);
async function waitJob(call, id) { for (let i = 0; i < 300; i++) { const j = await call('/api/jobs/' + id); if (!['queued', 'running'].includes(j.status)) return j; await new Promise(r => setTimeout(r, 50)); } throw Error('timeout'); }

test('Failures are explained in words a person can act on, and every category is wired to something', () => {
  const rec = { title: 'Night Drive', sourceName: 'Jamendo', kind: 'music' };
  const gone = explain(Object.assign(Error('The media service answered 404.'), { status: 404, code: 'gone' }), rec, 'add');
  assert.match(gone.message, /“Night Drive” wasn’t added: it is no longer available from Jamendo/); assert.equal(gone.code, 'gone');
  assert.match(explain(Object.assign(Error('x'), { status: 403, code: 'forbidden' }), rec, 'play').message, /can’t be played: Jamendo refused the download \(error 403\)/);
  assert.match(explain(Object.assign(Error('x'), { code: 'quota', retryAfter: 600 }), rec).message, /limiting downloads right now\. Try again in about 10 minutes/);
  // A source's own explanation of its limit is passed on rather than replaced.
  // SFXMint's real over-limit answer is long and arrives cut off; its first sentence is what the user needs.
  const mint = explain(Object.assign(Error('x'), { code: 'quota', status: 429, retryAfter: 74766, body: '{"error":"download_limit","message":"Daily keyless download limit reached: 5 sounds a day per network. A free SFXMint account\'s API key raises it to 20 a day (https://sfxmint.com/signup?next=%2Fdash' }), { title: 'Pop', sourceName: 'SFXMint', provider: 'sfxmint' });
  assert.equal(mint.message, '“Pop” wasn’t added yet. SFXMint says: Daily keyless download limit reached: 5 sounds a day per network. Try again in about 21 hours. A free key in Preferences › Library raises the limit.');
  assert.match(explain(Object.assign(Error('x'), { code: 'timeout' }), rec, 'play').message, /stopped answering/);
  assert.equal(explain(Object.assign(Error('Cancelled'), { cancelled: true }), rec).message, 'Cancelled');
  // Jamendo addresses every track as "/?trackid=…": the duplicate key must tell them apart (it didn't, so a
  // combined search kept one Jamendo track per page).
  assert.notEqual(canonicalAudioUrl('https://prod-1.storage.jamendo.com/?trackid=1&format=mp32'), canonicalAudioUrl('https://prod-1.storage.jamendo.com/?trackid=2&format=mp32'));
  assert.equal(canonicalAudioUrl('https://cdn.example.org/A/b.mp3'), canonicalAudioUrl('https://CDN.example.org/a/B.mp3'));
  for (const l of Object.values(AUDIO_DISCOVERY).flat()) assert.ok(lensById(l[0]).query, l[0]);
  for (const id of Object.keys(AUDIO_LENSES)) assert.ok(lensById(id), 'lens mapping without a lens: ' + id);
  for (const c of SFX_CATEGORIES) assert.ok(c[2].q && (c[2].kit || c[2].mint || c[2].q), c[0]);
});

test('Incompetech: catalog fetched once, browsed by its own genre and feel labels, credit written the way the composer asks', async () => {
  let hits = 0;
  const pieces = [
    { title: 'Bright Idea', filename: 'Bright Idea.mp3', length: '00:02:10', instruments: 'Piano, Drums', genre: '16', bpm: '120', description: 'A cheerful tune.', feel: 'Bright, Bouncy', uploaded: '2026-01-02', isrc: 'USUAN2600001' },
    { title: 'This House', filename: 'This House.mp3', length: '00:03:00', instruments: 'Strings', genre: '10', bpm: '0', description: 'Creeping dread.', feel: 'Eerie, Dark', uploaded: '2026-01-01', isrc: 'USUAN2600002' },
    { title: 'No file', filename: '../evil.mp3', length: '00:01:00', genre: '4', feel: 'Bright', isrc: 'USUAN2600003' },
  ];
  const p = new Incompetech({ http: { json: async url => { hits++; assert.match(url, /\/pieces\.json$/); return pieces; } }, base: 'https://incompetech.com/music/royalty-free' });
  const all = await p.search({ q: '' }); assert.equal(all.total, 2, 'entries with unsafe file names are dropped');
  assert.deepEqual((await p.search({ lens: 'uplifting' })).items.map(r => r.title), ['Bright Idea'], 'a mood lens uses the catalog’s feel labels');
  assert.deepEqual((await p.search({ lens: 'horror' })).items.map(r => r.title), ['This House'], 'a genre lens uses the catalog’s genre');
  assert.equal((await p.search({ lens: 'house' })).total, 0, 'a title coincidence is not house music');
  assert.deepEqual((await p.search({ q: 'happy piano' })).items.map(r => r.title), ['Bright Idea'], 'everyday words reach the catalog’s labels');
  assert.equal(hits, 1, 'searching never re-fetches the catalog');
  const rec = await p.getAsset('USUAN2600001');
  assert.equal(rec.licenseCheck.ok, true); assert.equal(rec.license, 'by'); assert.equal(p.download(rec).url, 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Bright%20Idea.mp3');
  assert.match(creditLine(rec), /^“Bright Idea” by Kevin MacLeod \(incompetech\.com\) is licensed under CC BY 4\.0 \(https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/\)/);
  const rights = assessRights({ provider: 'incompetech', license: rec.license, licenseVersion: rec.licenseVersion, kind: 'music', usage: 'commercial', verification: rec.licenseCheck });
  assert.equal(rights.tier, 'credit'); assert.equal(rights.attribution, true); assert.equal(rights.blocked, false);
});

test('ccMixter: genre lenses use uploader tags, and bare vocal takes are not offered as music', async () => {
  const asked = [];
  const up = (id, ccud, o = {}) => ({ upload_id: id, upload_name: 'Tune ' + id, user_name: 'u', file_page_url: 'https://ccmixter.org/files/u/' + id, license_url: 'http://creativecommons.org/licenses/by/3.0/', upload_extra: { ccud, usertags: 'hip_hop' }, files: [{ download_url: `https://ccmixter.org/content/u/${id}.mp3`, file_format_info: { 'media-type': 'audio', 'default-ext': 'mp3', ps: '3:00' } }], ...o });
  const p = new CcMixter({ http: { json: async url => { asked.push(new URL(url).searchParams); return [up(1, 'media,remix'), up(2, 'media,acappella'), up(3, 'media,sample'), up(4, 'site_promo'), up(5, 'media,remix,acappella')]; } } });
  const r = await p.search({ lens: 'hiphop', include: 'credit' });
  assert.equal(asked[0].get('tags'), 'hip_hop'); assert.equal(asked[0].get('search'), null); assert.equal(asked[0].get('lic'), 'zero,by');
  assert.deepEqual(r.items.map(x => x.sourceId), ['1', '3', '5'], 'finished tracks and instrumental samples stay; a cappellas and promos go');
  assert.equal((await p.search({ q: 'acappella vocals', include: 'credit' })).items.length, 5, 'asking for vocals still finds them');
  assert.equal(asked[1].get('search'), 'acappella vocals');
});

test('Retrieval end to end (mock sources): quota fallback, dead items, clear reasons, preview reuse, real file types, saved searches', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-ret-')); let s, srv;
  try {
    const tone = path.join(dir, 'tone.mp3'), m4a = path.join(dir, 'tone.m4a');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:a', 'libmp3lame', '-b:a', '64k', tone]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100', '-t', '1', '-c:a', 'aac', '-b:a', '64k', m4a]);
    const bytes = { ok: await fs.readFile(tone), late: await fs.readFile(tone), m4a: await fs.readFile(m4a) };
    let base = ''; const hits = { search: 0, file: {} }; let detailLimited = false;
    const names = ['ok', 'gone', 'm4a', 'page', 'late'];
    const uuid = n => `00000000-0000-0000-0000-00000000000${names.indexOf(n) + 1}`;
    const item = n => ({ id: uuid(n), title: 'Sound ' + n, url: `${base}/file/${n}`, creator: 'Tester', foreign_landing_url: 'https://example.org/s/' + n, license: 'cc0', license_version: '1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', source: 'freesound', provider: 'freesound', duration: 1000, filetype: 'mp3', tags: [{ name: 'beep' }] });
    srv = http.createServer((req, res) => {
      const u = new URL(req.url, base); const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
      if (u.pathname === '/v1/audio/') { hits.search++; return send(200, 'application/json', JSON.stringify({ result_count: names.length, page_count: 1, page: 1, results: names.map(item) })); }
      const d = /^\/v1\/audio\/([0-9a-f-]{36})\/$/.exec(u.pathname);
      if (d) { if (detailLimited) { res.writeHead(429, { 'Retry-After': '3600', 'Content-Type': 'application/json' }); return res.end('{}'); } return send(200, 'application/json', JSON.stringify(item(names.find(n => uuid(n) === d[1])))); }
      const f = /^\/file\/(\w+)$/.exec(u.pathname);
      if (f) {
        hits.file[f[1]] = (hits.file[f[1]] || 0) + 1;
        if (f[1] === 'gone') return send(404, 'text/plain', 'not here');
        if (f[1] === 'page') return send(200, 'audio/mpeg', '<!DOCTYPE html><html><body>Please sign in to download.</body></html>');
        return send(200, 'audio/mpeg', bytes[f[1]]); // the m4a is deliberately mislabelled, as the Internet Archive does
      }
      send(404, 'text/plain', '');
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}`;
    const start = () => startServer({ dataDir: path.join(dir, 'data'), creative: { http: new SafeHttp({ allowLocal: true }), openverseBase: base + '/v1', audioProviders: false } });
    s = await start(); let call = api(s.url); s.creative.retryDelay = 10;
    const find = async () => (await call('/api/creative/search?provider=openverse&kind=sfx&q=beep')).items;
    assert.equal((await find()).length, 5);
    const add = async n => waitJob(call, (await call('/api/creative/import', { provider: 'openverse', id: uuid(n), kind: 'sfx' })).job);

    // The catalog is rate limited (every import asks it once more for the license): the listing verified a
    // moment ago stands in, so a file that is there can still be added.
    detailLimited = true;
    let j = await add('ok'); assert.equal(j.status, 'done', j.error);
    assert.equal(j.result.asset.source.licenseRecord.method, 'openverse-listing'); assert.equal(j.result.asset.source.licenseRecord.ok, true);
    detailLimited = false; s.creative.providers.openverse.blockedUntil = 0;

    // A file that is gone: one clear sentence, a reason code on the job, and the item leaves later results.
    j = await add('gone'); assert.equal(j.status, 'failed');
    assert.match(j.error, /“Sound gone” wasn’t added: it is no longer available from Freesound\. It is marked unavailable/);
    assert.deepEqual(j.meta.failure, { code: 'gone', retryAfter: null, dead: true });
    assert.deepEqual((await find()).map(r => r.title), ['Sound ok', 'Sound m4a', 'Sound page', 'Sound late']);
    // Asking to play it gives the same reason without troubling the host again.
    const before = hits.file.gone;
    await assert.rejects(call(`/api/creative/preview/openverse/${uuid('gone')}`), e => e.code === 'gone' && /no longer available/.test(e.error || e.message));
    assert.equal(hits.file.gone, before);

    // A web page where audio should be (sign-in wall): refused, said plainly, nothing left on disk.
    j = await add('page'); assert.equal(j.status, 'failed'); assert.match(j.error, /Freesound refused the download/); assert.equal(j.meta.failure.code, 'forbidden');

    // The file's own bytes decide its type: AAC in an MP4 container sent as "audio/mpeg" is stored as .m4a.
    j = await add('m4a'); assert.equal(j.status, 'done', j.error); assert.match(j.result.asset.fileName, /\.m4a$/);

    // Listening first, then adding: the preview is the same file and is not downloaded twice.
    const pv = await fetch(`${s.url}/api/creative/preview/openverse/${uuid('late')}`); assert.equal(pv.status, 200); assert.equal((await pv.arrayBuffer()).byteLength, bytes.late.length);
    for (let i = 0; i < 100 && !require('node:fs').existsSync(s.creative.previewPath('openverse', uuid('late'))); i++) await new Promise(r => setTimeout(r, 20));
    j = await add('late'); assert.equal(j.status, 'done', j.error); assert.equal(hits.file.late, 1, 'one download serves preview and import');

    // Search answers survive a restart, so reopening a category costs the source nothing.
    await s.close(); s = await start(); call = api(s.url);
    assert.equal((await find()).length, 5); assert.equal(hits.search, 1);
  } finally { await s?.close(); srv?.close(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});
