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
