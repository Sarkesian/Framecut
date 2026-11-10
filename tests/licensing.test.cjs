// Unified licensing: labels, verification of license metadata, discovery modes, credits in every
// format, project-held attribution records, export delivery checks, and the federated sticker search
// across Openverse images, Pixabay and Fluent against mock services.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { startServer } = require('../desktop/server.cjs');
const { SafeHttp } = require('../desktop/providers/http.cjs');
const { run, ffmpeg } = require('../desktop/tools.cjs');
const R = require('../shared/rights.mjs');
const { newProject, newClip, normalizeProject } = require('../shared/model.mjs');

const json = async r => { const d = await r.json(); if (!r.ok) throw Object.assign(Error(d.error), d); return d; };
const api = base => (url, body, method = body ? 'POST' : 'GET') => fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(json);
async function waitJob(call, id, ms = 60000) { const t = Date.now(); for (;;) { const j = await call('/api/jobs/' + id); if (!['queued', 'running'].includes(j.status)) return j; if (Date.now() - t > ms) throw Error('timeout'); await new Promise(r => setTimeout(r, 100)); } }
const cc = (license, v = '4.0', extra = {}) => ({ provider: 'openverse', sourceId: 'id-' + license + v, title: 'Song ' + license, creator: 'Ann', license, licenseVersion: v, licenseUrl: R.licenseUrlFor(license, v), sourcePageUrl: 'https://example.org/' + license, kind: 'music', ...extra });

test('Labels: every asset maps to No credit needed / Credits handled automatically / Restricted usage', () => {
  const a = (o, usage = 'commercial') => R.assessRights({ kind: 'music', usage, ...o });
  assert.equal(a({ provider: 'openverse', license: 'cc0' }).label, 'No credit needed');
  assert.equal(a({ provider: 'openverse', license: 'pdm' }).tier, 'free');
  assert.equal(a({ provider: 'openverse', license: 'by', licenseVersion: '4.0' }).label, 'Credits handled automatically');
  assert.equal(a({ provider: 'openverse', license: 'by-sa', licenseVersion: '4.0' }).label, 'Restricted usage');
  assert.equal(a({ provider: 'openverse', license: 'by-nc' }).reason, 'non-commercial');
  assert.equal(a({ provider: 'openverse', license: 'by-nc' }, 'personal').tier, 'restricted', 'NC is usable for personal videos but still restricted');
  assert.equal(a({ provider: 'openverse', license: '' }).tier, 'restricted'); assert.equal(a({ provider: 'openverse', license: '' }).blocked, true, 'unknown license is never permission');
  const mit = R.assessRights({ provider: 'fluent', license: 'mit', kind: 'sticker' });
  assert.equal(mit.tier, 'free', 'MIT notice is carried at app level'); assert.equal(mit.notice, true); assert.equal(mit.attribution, false);
  const px = R.assessRights({ provider: 'pixabay', kind: 'sticker' });
  assert.equal(px.tier, 'free'); assert.ok(px.restrictions.some(r => /standalone|unchanged/i.test(r)), 'Pixabay usage restrictions are explicit');
  assert.ok(a({ provider: 'openverse', license: 'cc0' }).restrictions.includes('Commercial and personal use allowed.'));
  assert.ok(R.APP_NOTICES.some(n => n.provider === 'fluent' && /Microsoft Corporation/.test(n.text)), 'Fluent MIT notice ships with the app');
  for (const p of ['mixkit', 'pixabay-audio', 'lottiefiles', 'uppbeat', 'giphy', 'tenor']) assert.equal(R.assessRights({ provider: p, license: 'cc0' }).blocked, true, p);
});

test('Verification: unknown, incomplete and contradictory license data is refused, with reasons kept', () => {
  assert.equal(R.verifyLicense(cc('by')).status, 'verified');
  assert.equal(R.verifyLicense(cc('cc0', '1.0', { licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' })).status, 'verified');
  assert.equal(R.verifyLicense(cc('by', '4.0', { licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/' })).status, 'contradictory');
  assert.equal(R.verifyLicense(cc('by', '4.0', { licenseUrl: 'https://creativecommons.org/licenses/by/3.0/' })).status, 'contradictory', 'version mismatch');
  assert.equal(R.verifyLicense(cc('cc0', '1.0', { licenseUrl: 'https://example.com/free' })).status, 'contradictory', 'license link must be Creative Commons');
  assert.equal(R.verifyLicense(cc('cc0', '1.0', { attribution: '"Song" by Ann is licensed under CC BY-NC 4.0.' })).status, 'contradictory', 'credit text disagrees');
  assert.equal(R.verifyLicense(cc('by', null, { licenseUrl: null })).status, 'incomplete', 'no version → cannot link exact terms');
  assert.equal(R.verifyLicense(cc('by', '4.0', { title: '', creator: '' })).status, 'incomplete');
  assert.equal(R.verifyLicense(cc('whatever')).status, 'unknown');
  assert.equal(R.verifyLicense({ provider: 'pixabay', sourceId: '1', title: 'x', license: 'by' }).status, 'contradictory', 'item disagreeing with the provider-wide license');
  assert.equal(R.verifyLicense({ provider: 'pixabay', sourceId: '1', title: 'x', license: 'pixabay' }).status, 'verified');
  const changed = R.verifyLicense(cc('by'), { listed: { license: 'cc0' } }); assert.equal(changed.ok, true); assert.ok(changed.changedSinceListing, 'a license change since search is recorded');
  const v = R.verifyLicense(cc('by', '4.0', { licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' }));
  const r = R.assessRights({ provider: 'openverse', license: 'by', licenseVersion: '4.0', verification: v });
  assert.equal(r.blocked, true); assert.match(r.details.join(' '), /link is for CC BY-SA/);
  assert.deepEqual(R.licenseInText('"CC0 Song" by X is licensed under CC BY-NC-SA 4.0. To view…'), { code: 'by-nc-sa', version: '4.0' }, 'title text is not mistaken for the license');
});

test('Discovery: attribution-free by default; credit-required and restricted only when asked for', () => {
  assert.deepEqual(R.licenseFilter('commercial', 'music', 'free'), ['cc0']);
  assert.deepEqual(R.licenseFilter('commercial', 'music', 'credit'), ['cc0', 'pdm', 'by']);
  assert.ok(R.licenseFilter('commercial', 'music', 'all').includes('by-sa'));
  assert.ok(!R.licenseFilter('commercial', 'music', 'all').some(l => /nc|nd/.test(l)));
  const t = lic => R.assessRights({ provider: 'openverse', license: lic, licenseVersion: '4.0' });
  assert.equal(R.discoverable(t('cc0'), 'free'), true); assert.equal(R.discoverable(t('by'), 'free'), false); assert.equal(R.discoverable(t('by'), 'credit'), true);
  assert.equal(R.discoverable(t('by-sa'), 'credit'), false); assert.equal(R.discoverable(t('by-sa'), 'all'), true); assert.equal(R.discoverable(t('by-nc'), 'all'), false, 'blocked never shows');
  assert.equal(R.providerTier('fluent'), 'free'); assert.equal(R.providerTier('pixabay'), 'free'); assert.equal(R.providerTier('openverse'), null);
});

test('Credits: YouTube, short-form, credits file and on-screen sequence; notices and evidence kept', () => {
  const song = { ...cc('by'), attribution: '"Song by" by Ann is licensed under CC BY 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/.', licenseRecord: { checkedAt: '2026-11-08T10:00:00Z', evidenceUrl: 'https://api.openverse.org/v1/audio/x/' } };
  const sound = { ...cc('by', '3.0'), sourceId: 's', title: 'Boom', creator: 'Bo', kind: 'sfx' };
  const emoji = { provider: 'fluent', sourceId: 'party', title: 'Party popper', creator: 'Microsoft', license: 'mit', kind: 'sticker' };
  const yt = R.creditsFor([song, sound, song], { projectName: 'Demo', format: 'youtube' });
  assert.equal(yt.match(/•/g).length, 2, 'each source once'); assert.match(yt, /^Demo — Credits/); assert.match(yt, /Music\n• "Song by" by Ann is licensed under CC BY 4\.0 \(https:\/\/creativecommons/);
  assert.match(yt, /Sound effects\n• “Boom” by Bo is licensed under CC BY 3\.0 \(https:\/\/creativecommons\.org\/licenses\/by\/3\.0\/\)/); assert.doesNotMatch(yt, /To view/); assert.match(yt, /trimmed, faded or mixed/);
  const social = R.creditsFor([song, sound], { format: 'social' });
  assert.ok(social.length < 400); assert.match(social, /Music: “Song by” by Ann \(CC BY 4\.0 creativecommons\.org\/licenses\/by\/4\.0\)/);
  const seq = R.creditsFor([song, sound], { format: 'sequence' }).split('\n');
  assert.equal(seq[0], 'Credits'); assert.ok(seq.includes('“Boom” by Bo')); assert.ok(seq.every(l => l.length <= 60), 'short lines for the screen');
  const file = R.creditsFor([song], { format: 'text', notices: [emoji], date: new Date('2026-11-08') });
  assert.match(file, /License notices\n\n--- Microsoft Corporation \(MIT\) ---\nCopyright \(c\) Microsoft Corporation/);
  assert.match(file, /Permission is hereby granted/); assert.match(file, /checked 2026-11-08 — https:\/\/api\.openverse\.org/);
  const onlyNotices = R.creditsFor([], { format: 'text', notices: [emoji] }); assert.match(onlyNotices, /No credits are required/); assert.match(onlyNotices, /MIT/);
  assert.equal(R.creditsFor([], { format: 'youtube', notices: [emoji] }), '', 'nothing to paste when nothing needs credit');
});

test('Project records: attributions are saved with the project and drive the export check', () => {
  const p = newProject({ name: 'Trip' });
  const music = newClip('audio', { mediaId: 'm1', trackId: 'audio-1', start: 0, duration: 10 });
  const fx = newClip('audio', { mediaId: 'm2', trackId: 'audio-1', start: 20, duration: 1 });
  const st = newClip('sticker', { sticker: { type: 'media' }, mediaId: 'm3', trackId: 'text-1', start: 2, duration: 3 });
  p.clips.push(music, fx, st);
  R.recordAttribution(p, 'm1', { ...cc('by'), licenseRecord: { status: 'verified' } });
  R.recordAttribution(p, 'm2', { ...cc('cc0', '1.0'), sourceId: 'free', kind: 'sfx' });
  R.recordAttribution(p, 'm3', { provider: 'fluent', sourceId: 'party', title: 'Party popper', license: 'mit', kind: 'sticker' });
  R.recordAttribution(p, 'mX', { provider: 'local', sourceId: 'file:x' });
  const back = normalizeProject(JSON.parse(JSON.stringify(p)));
  assert.equal(Object.keys(back.attributions).length, 3, 'records survive save/load; own files are not recorded');
  // The library no longer knows these assets (moved project): the project's records still produce credits.
  const pf = R.preflight(back, () => null);
  assert.equal(pf.items.length, 3); assert.equal(pf.creditSources.length, 1); assert.equal(pf.noticeSources.length, 1); assert.equal(pf.free.length, 2);
  assert.match(pf.credits, /Song by/); assert.doesNotMatch(pf.credits, /Party popper/, 'MIT emoji need no on-video credit');
  assert.equal(R.preflight(back, () => null, { range: { from: 15, to: 30 } }).creditSources.length, 0, 'only clips inside the exported range count');
  // A stored failed verification makes the asset unusable at export.
  back.attributions['openverse:id-by4.0'].licenseRecord = { status: 'contradictory', problems: [{ code: 'contradictory', text: 'Mismatch.' }] };
  assert.equal(R.preflight(back, () => null).blocked.length, 1);
});

test('Delivery: required credits can never silently disappear from an export', () => {
  const p = newProject(); p.clips.push(newClip('audio', { mediaId: 'm1', trackId: 'audio-1', duration: 5 })); R.recordAttribution(p, 'm1', cc('by'));
  const pf = R.preflight(p, () => null);
  let d = R.creditDelivery(pf, { destination: 'youtube' });
  assert.equal(d.ok, false); assert.equal(d.warnings[0].code, 'undelivered');
  assert.equal(R.creditDelivery(pf, { destination: 'youtube', copied: true }).ok, true);
  assert.deepEqual(R.creditDelivery(pf, { destination: 'youtube', copied: true, saveFile: true }).methods, ['description', 'file']);
  d = R.creditDelivery(pf, { destination: 'audio', copied: true }); assert.equal(d.ok, false, 'audio files have no description to paste into'); assert.ok(d.warnings.some(w => w.code === 'no-screen'));
  assert.ok(R.creditDelivery(pf, { destination: 'gif', saveFile: true }).warnings.some(w => w.code === 'no-description'));
  assert.equal(R.creditDelivery(pf, { destination: 'gif', sequence: { present: true, inRange: true, current: true } }).ok, true);
  d = R.creditDelivery(pf, { destination: 'file', sequence: { present: true, inRange: true, current: false } }); assert.equal(d.ok, false); assert.ok(d.warnings.some(w => w.code === 'sequence-stale'));
  assert.ok(R.creditDelivery(pf, { destination: 'file', saveFile: true, sequence: { present: true, inRange: false } }).warnings.some(w => w.code === 'sequence-outside'));
  assert.ok(R.creditDelivery(pf, { destination: 'social', copied: true }).warnings.some(w => w.code === 'no-links'));
  for (let i = 2; i < 60; i++) { p.clips.push(newClip('audio', { mediaId: 'm' + i, trackId: 'audio-1', start: i * 5, duration: 5 })); R.recordAttribution(p, 'm' + i, { ...cc('by'), sourceId: 'x' + i, title: 'A rather long track title number ' + i, creator: 'Someone with a long name' }); }
  assert.ok(R.creditDelivery(R.preflight(p, () => null), { destination: 'social', copied: true }).warnings.some(w => w.code === 'too-long'));
  assert.equal(R.destinationFor({ preset: 'youtube4k', format: 'mp4' }), 'youtube'); assert.equal(R.destinationFor({ preset: 'tiktok' }), 'social'); assert.equal(R.destinationFor({ format: 'wav' }), 'audio');
  const none = newProject(); assert.equal(R.creditDelivery(R.preflight(none, () => null)).ok, true);
});

test('Sticker search across Openverse images, Pixabay and Fluent: tiers, dedupe, partial failure, verified imports', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-lic-')); let s, srv;
  try {
    const png = (await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red@0.5:s=64x64,format=rgba', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], { encoding: 'buffer' })).out;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>x()</script><circle r="5" cx="5" cy="5" fill="teal"/></svg>';
    let base = ''; const seen = { ov: 0, px: 0 }; let pxDown = false; const keys = [];
    const uuid = n => `0000000${n}-1111-2222-3333-444444444444`.slice(-36);
    const ovItem = (n, o = {}) => ({ id: uuid(n), title: `Cat silhouette ${n}`, url: `${base}/img/${n}.${n === 2 ? 'svg' : 'png'}`, thumbnail: `${base}/thumb/${n}`, creator: 'SVG Silh', foreign_landing_url: `https://svgsilh.com/${n}`, license: 'cc0', license_version: '1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: `"Cat silhouette ${n}" by SVG Silh is marked with CC0 1.0.`, source: 'svgsilh', filetype: n === 2 ? 'svg' : 'png', width: 64, height: 64, ...o });
    const ovList = () => [ovItem(1), ovItem(2), ovItem(3, { license: 'by', license_version: '4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/', attribution: '"Cat silhouette 3" by SVG Silh is licensed under CC BY 4.0.' }), ovItem(4, { license_url: 'https://creativecommons.org/licenses/by-nc/4.0/' }), ovItem(5, { title: 'Party popper', creator: 'Microsoft' })];
    const pxHit = (id, ext = 'png') => ({ id, pageURL: `https://pixabay.com/illustrations/cat-${id}/`, tags: 'cat, cute, cartoon', previewURL: `${base}/px/${id}_150.${ext}`, webformatURL: `${base}/px/${id}_640.${ext}`, largeImageURL: `${base}/px/${id}_1280.${ext}`, imageWidth: 1280, imageHeight: 1280, user: 'Artist', user_id: 42 });
    srv = http.createServer((req, res) => {
      const u = new URL(req.url, base); const j = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      if (u.pathname === '/v1/images/') { seen.ov++; assert.equal(u.searchParams.get('extension'), 'png,svg,gif'); return j(200, { result_count: 5, page_count: 1, page: 1, results: ovList().filter(x => u.searchParams.get('license').split(',').includes(x.license)) }); }
      const m = /^\/v1\/images\/([0-9a-f-]{36})\/$/.exec(u.pathname); if (m) { const it = ovList().find(x => x.id === m[1]); return it ? j(200, it) : j(404, {}); }
      if (u.pathname === '/px/api/') {
        seen.px++; keys.push(u.searchParams.get('key'));
        if (pxDown) return j(503, { error: 'down' });
        if (u.searchParams.get('id')) return j(200, { total: 1, totalHits: 1, hits: [pxHit(+u.searchParams.get('id'))] });
        assert.equal(u.searchParams.get('colors'), 'transparent'); return j(200, { total: 3, totalHits: 3, hits: [pxHit(7), pxHit(8, 'jpg'), pxHit(9)] });
      }
      if (/^\/img\/2\.svg$/.test(u.pathname)) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(svg); }
      if (/^\/(img|thumb|px)\//.test(u.pathname)) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png); }
      res.writeHead(404); res.end();
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}`;
    s = await startServer({ dataDir: path.join(dir, 'data'), creative: { http: new SafeHttp({ allowLocal: true }), openverseBase: base + '/v1', pixabayBase: base + '/px/api/', audioProviders: false } });
    const call = api(s.url);
    // Default: attribution-free only. Pixabay has no key yet, so only Openverse + Fluent answer.
    let r = await call('/api/creative/search?provider=openverse&kind=sticker&q=cat');
    assert.equal(seen.px, 0, 'Pixabay is not called without the creator’s own key');
    assert.deepEqual(r.items.filter(x => x.provider === 'openverse' && /silhouette/.test(x.title)).map(x => x.title).sort(), ['Cat silhouette 1', 'Cat silhouette 2'], 'credit-required and contradictory items are not shown by default');
    assert.ok(r.items.every(x => x.tier === 'free'));
    // Credit mode adds CC BY; the contradictory item (CC0 field, BY-NC link) never appears.
    r = await call('/api/creative/search?provider=openverse&kind=sticker&q=cat&include=credit');
    assert.ok(r.items.some(x => x.title === 'Cat silhouette 3')); assert.ok(!r.items.some(x => x.sourceId === uuid(4)));
    // Party popper from Openverse duplicates Fluent's emoji by title+creator → listed once.
    r = await call('/api/creative/search?provider=all&kind=sticker&q=party');
    assert.equal(r.items.filter(x => x.title === 'Party popper').length, 1);
    // Add a Pixabay key: PNG results join (JPEG has no transparency and is skipped), the source is named.
    await assert.rejects(call('/api/creative/credentials/pixabay', { key: 'bad key!' }, 'PUT'), /does not look like/);
    await call('/api/creative/credentials/pixabay', { key: 'test-key-123456' }, 'PUT');
    r = await call('/api/creative/search?provider=all&kind=sticker&q=dog');
    const px = r.items.filter(x => x.provider === 'pixabay'); assert.deepEqual(px.map(x => x.sourceId), ['7', '9']); assert.equal(px[0].sourceName, 'Pixabay'); assert.equal(px[0].license, 'pixabay');
    assert.deepEqual(r.sources.map(x => x.provider).sort(), ['fluent', 'pixabay']); assert.ok(keys.every(k => k === 'test-key-123456'));
    assert.equal(new Set(r.items.slice(0, 3).map(x => x.provider)).size, 2, 'sources are interleaved');
    const before = seen.px; await call('/api/creative/search?provider=all&kind=sticker&q=dog'); assert.equal(seen.px, before, 'Pixabay results are cached (24 h rule)');
    // One source failing leaves the others working, and says so.
    pxDown = true; r = await call('/api/creative/search?provider=all&kind=sticker&q=bird');
    assert.ok(r.items.length > 0); assert.equal(r.partial[0].provider, 'pixabay');
    pxDown = false;
    // Imports: license re-verified from the detail record and the evidence saved with the asset.
    let j = await waitJob(call, (await call('/api/creative/import', { provider: 'openverse', id: uuid(2), kind: 'sticker' })).job);
    assert.equal(j.status, 'done', j.error); const vec = j.result.asset;
    assert.equal(vec.role, 'sticker'); assert.equal(vec.source.licenseRecord.status, 'verified'); assert.match(vec.source.licenseRecord.sha256, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(await fs.readFile(path.join(vec.folder, vec.fileName), 'utf8'), /script/, 'downloaded SVG is sanitized');
    j = await waitJob(call, (await call('/api/creative/import', { provider: 'pixabay', id: '7', kind: 'sticker' })).job);
    assert.equal(j.status, 'done', j.error); assert.equal(j.result.asset.source.license, 'pixabay'); assert.equal(j.result.asset.source.licenseRecord.evidenceUrl, 'https://pixabay.com/service/license-summary/');
    j = await waitJob(call, (await call('/api/creative/import', { provider: 'openverse', id: uuid(4), kind: 'sticker' })).job);
    assert.equal(j.status, 'failed'); assert.match(j.error, /link is for CC BY-NC/); assert.match(j.error, /only uses assets whose license it can confirm/);
    // Preview of an image sticker uses the thumbnail and keeps its type when served from cache.
    for (let i = 0; i < 2; i++) { const pr = await fetch(`${s.url}/api/creative/preview/openverse/${uuid(1)}`); assert.equal(pr.status, 200); assert.match(pr.headers.get('content-type'), /image\/png/); await pr.arrayBuffer(); }
    const st = await call('/api/creative/status'); assert.equal(st.pixabay.configured, true); assert.ok(st.notices.some(n => n.provider === 'fluent'));
    assert.ok(st.providers.find(p => p.id === 'mixkit' && !p.enabled));
  } finally { await s?.close(); srv?.close(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});

test('Free music & SFX sources: SFX Kit (pinned, fingerprint-checked) and ccMixter CC0, slow sources, Illustrator SVGs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-free-')); let s, srv;
  try {
    const { sfxkitIndex } = require('../desktop/providers/sfxkit.cjs');
    const wav = path.join(dir, 'w.wav'); await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '0.3', wav]);
    const wavBytes = await fs.readFile(wav); const sha = require('node:crypto').createHash('sha256').update(wavBytes).digest('hex');
    let base = ''; let slow = false;
    const up = (id, lic, o = {}) => ({ upload_id: id, upload_name: `Tune ${id}`, user_name: 'u' + id, user_real_name: 'Artist ' + id, file_page_url: `https://ccmixter.org/files/u/${id}`, artist_page_url: 'https://ccmixter.org/people/u', license_url: lic, license_name: 'x', upload_extra: { usertags: 'piano,chill,120bpm', nsfw: false }, files: [{ download_url: `https://ccmixter.org/content/u/${id}.mp3`, file_format_info: { 'media-type': 'audio', 'default-ext': 'mp3', ps: '1:05' } }], ...o });
    srv = http.createServer((req, res) => {
      const u = new URL(req.url, base); const j = d => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
      if (u.pathname === '/v1/audio/') return j({ result_count: 0, page_count: 0, page: 1, results: [] });
      if (u.pathname === '/kit/sounds/whooshes/whoosh-fast-hard.wav') { res.writeHead(200, { 'Content-Type': 'audio/wav' }); return res.end(wavBytes); }
      if (u.pathname.startsWith('/kit/')) { res.writeHead(200, { 'Content-Type': 'audio/wav' }); return res.end(wavBytes); }
      if (u.pathname === '/cc/api') {
        if (slow) return setTimeout(() => j([]), 1500);
        const lic = u.searchParams.get('lic'); const ids = u.searchParams.get('ids');
        const all = [up(1, 'http://creativecommons.org/publicdomain/zero/1.0/'), up(2, 'http://creativecommons.org/licenses/by/3.0/'), up(3, 'http://creativecommons.org/licenses/by-nc/3.0/'), up(4, 'http://creativecommons.org/publicdomain/zero/1.0/', { upload_extra: { nsfw: true } }), up(5, 'http://example.com/whatever')];
        if (ids) return j(all.filter(x => String(x.upload_id) === ids));
        assert.equal(u.searchParams.get('f'), 'json');
        return j(all.filter(x => (lic.includes('zero') && /zero/.test(x.license_url)) || (lic.includes('by') && /licenses\/by\//.test(x.license_url)) || x.upload_id === 3 || x.upload_id === 5));
      }
      res.writeHead(404); res.end();
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}`;
    s = await startServer({ dataDir: path.join(dir, 'data'), creative: { http: new SafeHttp({ allowLocal: true }), openverseBase: base + '/v1', sfxkitBase: base + '/kit/', ccmixterBase: base + '/cc/api', audioProviders: false } });
    const call = api(s.url);
    // SFX Kit: offline index search, categories and CC0 without credit.
    assert.ok(sfxkitIndex.items.length >= 300 && /^[0-9a-f]{40}$/.test(sfxkitIndex.commit), 'index pinned to a commit');
    const kit = await call('/api/creative/search?provider=sfxkit&kind=sfx&q=whoosh');
    assert.ok(kit.items.length >= 5); assert.equal(kit.items[0].tier, 'free'); assert.equal(kit.items[0].sourceName, 'SFX Kit'); assert.ok(kit.items[0].description);
    const cat = await call('/api/creative/search?provider=sfxkit&kind=sfx&category=notifications'); assert.ok(cat.items.length > 10 && cat.items.every(x => x.category === 'notifications'));
    // Fingerprint: the published sha256 is checked on download.
    const idx = sfxkitIndex.items.find(x => x.id === 'whoosh-fast-hard'); const realSha = idx.sha256; idx.sha256 = sha;
    let j = await waitJob(call, (await call('/api/creative/import', { provider: 'sfxkit', id: 'whoosh-fast-hard', kind: 'sfx' })).job);
    assert.equal(j.status, 'done', 'sfxkit import: ' + j.error); assert.equal(j.result.asset.source.licenseRecord.status, 'verified'); assert.equal(j.result.asset.source.license, 'cc0'); idx.sha256 = realSha;
    j = await waitJob(call, (await call('/api/creative/import', { provider: 'sfxkit', id: 'whoosh-fast-soft', kind: 'sfx' })).job);
    assert.equal(j.status, 'failed'); assert.match(j.error, /didn’t match the file its source published/);
    // ccMixter: default mode is CC0 only; NC, NSFW and unrecognised licenses never appear.
    let cc = await call('/api/creative/search?provider=ccmixter&kind=music&q=piano').catch(e => { throw Object.assign(Error('ccmixter search: ' + e.message), e); });
    assert.deepEqual(cc.items.map(x => x.sourceId), ['1']); assert.equal(cc.items[0].license, 'cc0'); assert.equal(cc.items[0].durationMs, 65000); assert.equal(cc.items[0].licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/');
    cc = await call('/api/creative/search?provider=ccmixter&kind=music&q=piano&include=credit');
    assert.deepEqual(cc.items.map(x => x.sourceId).sort(), ['1', '2']);
    // Combined music search: a slow source is reported, the others still answer.
    slow = true; s.creative.searchDeadline = 300;
    const all = await call('/api/creative/search?provider=all&kind=music&q=slowtest');
    assert.equal(all.partial.find(p => p.provider === 'ccmixter')?.code, 'slow');
    // Illustrator-style SVG with a harmless internal DOCTYPE is accepted; external entities are not.
    const ai = path.join(dir, 'Star.svg'); await fs.writeFile(ai, '<?xml version="1.0"?>\n<!-- Generator: Adobe Illustrator -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n\t<!ENTITY ns_flows "http://ns.adobe.com/Flows/1.0/">\n]>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="&ns_flows;" viewBox="0 0 10 10"><rect width="10" height="10" fill="gold"/></svg>');
    const xxe = path.join(dir, 'Bad.svg'); await fs.writeFile(xxe, '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>');
    const r = await call('/api/creative/stickers/import', { paths: [ai, xxe] });
    assert.deepEqual(r.errors.map(e => e.name), ['Bad.svg']); const clean = await fs.readFile(path.join(r.ready[0].folder, r.ready[0].fileName), 'utf8');
    assert.doesNotMatch(clean, /DOCTYPE|ENTITY|&ns_flows;/); assert.match(clean, /xmlns:x="http:\/\/ns\.adobe\.com\/Flows\/1\.0\/"/);
  } finally { await s?.close(); srv?.close(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});

test('Removed sticker sources stay unavailable without breaking saved media rights', async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fc-retired-')); let s;
 try {
  s=await startServer({dataDir:path.join(dir,'data'),creative:{audioProviders:false}}); const call=api(s.url);
  for(const endpoint of ['/api/creative/search?provider=assetpolish&kind=sticker','/api/creative/categories?provider=assetpolish']) await assert.rejects(call(endpoint), /removed/);
  await assert.rejects(call('/api/creative/import',{provider:'assetpolish',id:'gold-star',kind:'sticker'}),/removed/);
  const st=await call('/api/creative/status'); assert.ok(!st.providers.some(p=>p.id==='assetpolish'));
  assert.equal(R.assessRights({provider:'assetpolish',license:'cc0',licenseVersion:'1.0',kind:'sticker'}).export,true);
  assert.deepEqual(s.creative.searchable('sticker','free'),['fluent']);
  await assert.rejects(new SafeHttp().check('https://www.assetpolish.com/x.svg'),/removed/);
 } finally { await s?.close(); await fs.rm(dir,{recursive:true,force:true}); }
});

test('Previews: at most two downloads per host at once, and a 429 pauses that host instead of hammering it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-pace-')); let s, srv;
  try {
    let base = '', live = 0, peak = 0, hits = 0, limit = false;
    const uuid = n => `0000000${n}-1111-2222-3333-444444444444`.slice(-36);
    const item = n => ({ id: uuid(n), title: `Shape ${n}`, url: `${base}/img/${n}.png`, creator: 'X', foreign_landing_url: `https://example.org/${n}`, license: 'cc0', license_version: '1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', source: 'svgsilh', filetype: 'png' });
    srv = http.createServer((req, res) => {
      const u = new URL(req.url, base);
      if (u.pathname === '/v1/images/') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ result_count: 8, page_count: 1, page: 1, results: [1, 2, 3, 4, 5, 6, 7, 8].map(item) })); }
      if (u.pathname.startsWith('/img/')) {
        hits++; if (limit) { res.writeHead(429, { 'Retry-After': '120' }); return res.end(); }
        live++; peak = Math.max(peak, live); setTimeout(() => { live--; res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.from('89504e470d0a1a0a', 'hex')); }, 120); return;
      }
      res.writeHead(404); res.end();
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}`;
    s = await startServer({ dataDir: path.join(dir, 'data'), creative: { http: new SafeHttp({ allowLocal: true }), openverseBase: base + '/v1', audioProviders: false } });
    const r = await api(s.url)('/api/creative/search?provider=openverse&kind=sticker&q=shape');
    const ids = r.items.map(x => x.sourceId);
    await Promise.all(ids.slice(0, 6).map(id => fetch(`${s.url}/api/creative/preview/openverse/${id}`).then(x => x.arrayBuffer())));
    assert.ok(peak <= 2, `at most two at once per host (saw ${peak})`); assert.equal(hits, 6);
    limit = true; const before = hits;
    const res7 = await fetch(`${s.url}/api/creative/preview/openverse/${ids[6]}`); assert.notEqual(res7.status, 200);
    const res8 = await fetch(`${s.url}/api/creative/preview/openverse/${ids[7]}`); assert.notEqual(res8.status, 200);
    assert.equal(hits, before + 1, 'after a 429 the host is left alone until its Retry-After');
  } finally { await s?.close(); srv?.close(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});
