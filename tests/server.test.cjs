// HTTP service: import by path, derivatives, projects (save/reopen/backups/legacy migration), tools, export.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startServer } = require('../desktop/server.cjs');
const { run, ffmpeg, ffprobe } = require('../desktop/tools.cjs');
const { newClip } = require('../shared/model.mjs');

const json = async (r) => { const d = await r.json(); if (!r.ok) throw Error(d.error); return d; };
const api = (base) => (url, body, method = body ? 'POST' : 'GET') => fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(json);
async function waitJob(call, id, ms = 60000) { const t = Date.now(); for (;;) { const j = await call('/api/jobs/' + id); if (!['queued', 'running'].includes(j.status)) return j; if (Date.now() - t > ms) throw Error('timeout'); await new Promise(r => setTimeout(r, 150)); } }

test('Service: legacy migration, import in place, derivatives, projects, tools and export', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-svc-')); let s;
  try {
    const src = path.join(dir, 'source'); await fs.mkdir(src);
    const clip = path.join(src, 'Beach day.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
    const data = path.join(dir, 'data');
    await fs.mkdir(data, { recursive: true });
    await fs.writeFile(path.join(data, 'project.json'), JSON.stringify({ version: 1, name: 'Legacy', ratio: '9:16', clips: [], audioClips: [], captions: [{ start: 0, end: 1, text: 'hi' }], titles: [] }));
    s = await startServer({ dataDir: data });
    const call = api(s.url);
    const list = await call('/api/projects');
    assert.equal(list.length, 1, 'legacy project migrated'); assert.equal(list[0].name, 'Legacy');
    assert.ok(fss.existsSync(path.join(data, 'project.v1-backup.json')));

    const imported = await call('/api/media/import', { paths: [src] });
    assert.equal(imported.assets.length, 1); const m = imported.assets[0];
    assert.equal(m.kind, 'video'); assert.ok(Math.abs(m.duration - 3) < 0.1);
    assert.ok(!fss.readdirSync(path.join(data, 'media')).some(n => n.endsWith('.mp4')), 'media is referenced, not copied');
    const again = await call('/api/media/import', { paths: [clip] }); assert.equal(again.assets[0].id, m.id, 'reimport dedupes');
    for (let i = 0; i < 100; i++) { const a = (await call('/api/media')).find(x => x.id === m.id); if (a.strip && a.wave && a.thumb) break; await new Promise(r => setTimeout(r, 100)); }
    const ready = (await call('/api/media')).find(x => x.id === m.id);
    assert.ok(ready.strip && ready.wave && ready.thumb, 'filmstrip, waveform and thumbnail generated');
    assert.equal((await fetch(s.url + ready.wave)).status, 200);
    const range = await fetch(s.url + ready.url, { headers: { Range: 'bytes=0-99' } }); assert.equal(range.status, 206, 'media supports range requests');

    const p = await call('/api/projects', { name: 'Trip', ratio: '16:9', resolution: 720 });
    p.clips.push(newClip('video', { trackId: 'main', mediaId: m.id, duration: 2, in: 0.5 }));
    p.mediaIds.push(m.id);
    await call('/api/projects/' + p.id, p, 'PUT');
    const reopened = await call('/api/projects/' + p.id);
    assert.equal(reopened.clips.length, 1); assert.equal(reopened.clips[0].in, 0.5);
    assert.ok((await call('/api/projects/' + p.id + '/backups')).length >= 1);
    // damaged file falls back to the backup
    await fs.writeFile(path.join(data, 'projects', p.id, 'project.json'), '{broken');
    const recovered = await call('/api/projects/' + p.id); assert.ok(recovered.recovered); assert.equal(recovered.clips.length, 1);

    const sil = await call('/api/tools/silence', { mediaId: m.id }); assert.ok(Array.isArray(sil.intervals));
    const fr = await call('/api/tools/freeze', { mediaId: m.id, time: 1 }); assert.equal(fr.asset.kind, 'image');
    const rev = await waitJob(call, (await call('/api/tools/reverse', { mediaId: m.id, from: 0, to: 2 })).job);
    assert.equal(rev.status, 'done', rev.error); assert.ok(Math.abs(rev.result.asset.duration - 2) < 0.15);
    const fx = await call('/api/tools/audiofx', { mediaId: m.id, clip: { audioFx: { denoise: 0.5, eq: 'voice', pitch: 2 } } });
    if (fx.job) assert.equal((await waitJob(call, fx.job)).status, 'done');

    const output = path.join(dir, 'out', 'Trip.mp4');
    const exp = await call('/api/export', { project: reopened, rasters: {}, settings: { format: 'mp4', codec: 'h264', resolution: 720, fps: 30, quality: 'balanced', output } });
    const job = await waitJob(call, exp.job); assert.equal(job.status, 'done', job.error);
    const info = JSON.parse((await run(ffprobe, ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', output])).out);
    assert.equal(info.streams.find(x => x.codec_type === 'video').height, 720);
    assert.ok(Math.abs(+info.format.duration - 2) < 0.12);
    assert.ok(!fss.readdirSync(path.dirname(output)).some(n => n.includes('framecut-part')), 'no partial files left');

    const denied = await fetch(s.url + '/api/projects', { headers: { Origin: 'https://evil.example' } }); assert.equal(denied.status, 403);
  } finally { await s?.close(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});

test('Proxies: 4K and unplayable files get playback copies; export still uses the originals', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-proxy-')); let s;
  try {
    const uhd = path.join(dir, 'Drone 4K.mp4'), avi = path.join(dir, 'Old camera.avi');
    // Fine 2-pixel checkerboard over a test pattern: detail a downscaled proxy cannot carry.
    const pat = path.join(dir, 'pattern.png');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=3840x2160', '-frames:v', '1', '-vf', "geq=r='if(mod(floor(X/2)+floor(Y/2),2),r(X,Y),255-r(X,Y))':g='g(X,Y)':b='b(X,Y)'", pat]);
    await run(ffmpeg, ['-y', '-loop', '1', '-framerate', '30', '-i', pat, '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p', uhd]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100', '-t', '2', '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', avi]);
    s = await startServer({ dataDir: path.join(dir, 'data') }); const call = api(s.url);
    const { assets } = await call('/api/media/import', { paths: [uhd, avi] });
    assert.equal(assets.length, 2); assert.ok(assets.every(a => a.needsProxy), 'both need a playback copy');
    let list; for (let i = 0; i < 600; i++) { list = await call('/api/media'); if (list.every(a => a.proxyUrl)) break; await new Promise(r => setTimeout(r, 200)); }
    for (const a of list) {
      assert.ok(a.proxyUrl && !a.proxyPending, a.name + ' proxy ready');
      const r = await fetch(s.url + a.proxyUrl, { headers: { Range: 'bytes=0-15' } }); assert.equal(r.status, 206, 'proxy streams with ranges');
      const file = path.join(dir, 'p-' + a.id + '.mp4'); await fs.writeFile(file, Buffer.from(await (await fetch(s.url + a.proxyUrl)).arrayBuffer()));
      const st = JSON.parse((await run(ffprobe, ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', file])).out);
      const v = st.streams.find(x => x.codec_type === 'video');
      assert.equal(v.codec_name, 'h264'); assert.ok(v.width <= 1280, 'proxy is small: ' + v.width); assert.ok(Math.abs(+st.format.duration - 2) < 0.15);
      if (a.name.startsWith('Old')) assert.ok(st.streams.some(x => x.codec_type === 'audio' && x.codec_name === 'aac'), 'proxy has browser-playable audio');
    }
    const big = list.find(a => a.width === 3840), p = await call('/api/projects', { name: 'Proxy', ratio: '16:9' });
    p.settings.resolution = 2160; p.clips.push(newClip('video', { trackId: 'main', mediaId: big.id, start: 0, duration: 1, in: 0 }));
    const output = path.join(dir, 'uhd.mp4');
    const job = await waitJob(call, (await call('/api/export', { project: p, rasters: {}, settings: { format: 'mp4', codec: 'h264', resolution: 2160, fps: 30, quality: 'high', hardware: false, output } })).job, 180000);
    assert.equal(job.status, 'done', job.error);
    // Full-resolution export must match the 4K original closely (a 1280-wide proxy upscaled would not).
    const psnrOf = async (file, pre = '') => { const { err } = await run(ffmpeg, ['-hide_banner', '-i', file, '-i', uhd, '-frames:v', '10', '-lavfi', `[0:v]${pre}format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]psnr`, '-f', 'null', '-']); return +/average:([\d.]+|inf)/.exec(err)[1].replace('inf', '99'); };
    const exported = await psnrOf(output), viaProxy = await psnrOf(path.join(dir, 'p-' + big.id + '.mp4'), 'scale=3840:2160:flags=bicubic,');
    console.log(`  PSNR vs 4K original: export ${exported.toFixed(1)} dB, upscaled proxy ${viaProxy.toFixed(1)} dB`);
    assert.ok(exported > viaProxy + 4, 'export rendered from the original, not the proxy');
  } finally { await s?.close(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});

test('Background removal pipeline: frames out, masks in, VP9 alpha cutout that composites in export', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-matte-')); let s;
  try {
    const clip = path.join(dir, 'Person.mp4'), bg = path.join(dir, 'Red.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=1280x720:r=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', bg]);
    s = await startServer({ dataDir: path.join(dir, 'data') }); const call = api(s.url);
    const { assets } = await call('/api/media/import', { paths: [clip, bg] }); const m = assets.find(a => a.name.startsWith('Person')), red = assets.find(a => a.name.startsWith('Red'));
    const sess = await call('/api/tools/matte/start', { mediaId: m.id, from: 0.5, to: 1.5, fps: 30 });
    assert.equal(sess.mw % 32, 0); assert.equal(sess.mh % 32, 0); assert.equal(sess.frames, 30);
    const raw = Buffer.from(await (await fetch(`${s.url}/api/tools/matte/${sess.session}/frames`)).arrayBuffer());
    assert.equal(raw.length, sess.mw * sess.mh * 3 * sess.frames, 'all frames streamed at mask size');
    // Synthetic matte: keep a centred circle (stands in for the model's output).
    const mask = Buffer.alloc(sess.mw * sess.mh); for (let y = 0; y < sess.mh; y++) for (let x = 0; x < sess.mw; x++) mask[y * sess.mw + x] = Math.hypot(x - sess.mw / 2, y - sess.mh / 2) < sess.mh * 0.3 ? 255 : 0;
    for (let i = 0; i < sess.frames; i += 10) await fetch(`${s.url}/api/tools/matte/${sess.session}/mask`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.concat(Array(10).fill(mask)) });
    const job = await waitJob(call, (await call(`/api/tools/matte/${sess.session}/finish`, {})).job, 120000);
    assert.equal(job.status, 'done', job.error);
    const cut = job.result.asset; assert.ok(cut.alpha, 'cutout is detected as having transparency'); assert.ok(Math.abs(cut.duration - 1) < 0.1, 'duration ' + cut.duration);
    // Composite the cutout over red: centre shows the picture, corners show red.
    const p = await call('/api/projects', { name: 'Cutout', ratio: '16:9' });
    p.tracks.unshift({ id: 'over', kind: 'video', name: 'Overlay' });
    p.clips.push(newClip('video', { trackId: 'main', mediaId: red.id, start: 0, duration: 1 }), newClip('video', { trackId: 'over', mediaId: cut.id, start: 0, duration: 1 }));
    const output = path.join(dir, 'comp.mp4');
    const ej = await waitJob(call, (await call('/api/export', { project: p, rasters: {}, settings: { format: 'mp4', resolution: 720, fps: 30, output } })).job, 120000);
    assert.equal(ej.status, 'done', ej.error);
    const { out: px } = await run(ffmpeg, ['-v', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' });
    const at = (x, y) => [...px.slice((y * 64 + x) * 3, (y * 64 + x) * 3 + 3)];
    const corner = at(3, 3), centre = at(32, 18);
    assert.ok(corner[0] > 200 && corner[1] < 50 && corner[2] < 50, 'corner is the red background: ' + corner);
    assert.ok(!(centre[0] > 200 && centre[1] < 50 && centre[2] < 50), 'centre is the kept subject: ' + centre);
    const bad = await fetch(`${s.url}/api/tools/matte/${sess.session}/frames`); assert.equal(bad.status >= 400, true, 'finished session is closed');
  } finally { await s?.close(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});
