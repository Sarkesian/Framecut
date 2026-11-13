// Media library removal: FrameCut forgets a file without ever deleting the user's own media, refuses while
// another project still uses it, and only deletes files it created itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startServer } = require('../desktop/server.cjs');
const { run, ffmpeg } = require('../desktop/tools.cjs');
const { newClip } = require('../shared/model.mjs');

const call = base => async (url, body, method = body ? 'POST' : 'GET') => { const r = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };

test('Removing media from the library never deletes the user\'s file and respects other projects', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-rm-')); let s;
  try {
    const mine = path.join(dir, 'My holiday.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mine]);
    s = await startServer({ dataDir: path.join(dir, 'data') });
    const api = call(s.url);
    const [asset] = (await api('/api/media/import', { paths: [mine] })).body.assets;
    assert.equal(asset.owned, false, 'an imported file is the user\'s, not FrameCut\'s');

    // Two projects use it.
    const mk = async name => { const p = (await api('/api/projects', { name })).body; p.clips.push(newClip('video', { trackId: 'main', mediaId: asset.id, start: 0, duration: 1 })); p.mediaIds.push(asset.id); await api('/api/projects/' + p.id, p, 'PUT'); return p; };
    const a = await mk('Open project'), b = await mk('Other project');
    const usage = (await api(`/api/media/${asset.id}/usage`)).body;
    assert.deepEqual(usage.projects.map(p => p.name).sort(), ['Open project', 'Other project']); assert.equal(usage.owned, false);

    // Refused while another project (not the one being edited) still uses it.
    const refused = await api(`/api/media/${asset.id}?except=${a.id}`, undefined, 'DELETE');
    assert.equal(refused.status, 409); assert.equal(refused.body.code, 'in-use'); assert.match(refused.body.error, /Other project/);
    assert.ok((await api('/api/media')).body.some(m => m.id === asset.id), 'still in the library');

    // Once the other project lets go of it, the library forgets it; the file stays on disk.
    const pb = (await api('/api/projects/' + b.id)).body; pb.clips = []; pb.mediaIds = []; await api('/api/projects/' + b.id, pb, 'PUT');
    const ok = await api(`/api/media/${asset.id}?except=${a.id}`, undefined, 'DELETE');
    assert.equal(ok.status, 200); assert.equal(ok.body.removed, true); assert.equal(ok.body.deletedFile, false);
    assert.ok(!(await api('/api/media')).body.some(m => m.id === asset.id));
    assert.ok(fss.existsSync(mine), 'the user\'s file was not touched');

    // It can simply be imported again.
    const again = (await api('/api/media/import', { paths: [mine] })).body.assets[0];
    assert.ok(again?.id, 're-import works');
    assert.equal((await api('/api/media/nope/usage')).status, 404);
  } finally { await s?.close?.(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
});
