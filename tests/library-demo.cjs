// End-to-end demonstration with REAL providers (needs internet): background music and a sound effect
// found on Openverse, a Microsoft Fluent animated sticker, and an imported voice track (Windows speech
// synthesis). The project is saved, reopened with the library offline, exported, and the result is
// checked: duration, streams, audible SFX, sticker present with transparency, credits file.
// Usage: node tests/library-demo.cjs  → writes test-output/library-demo/
const path = require('node:path'), fs = require('node:fs/promises'), fss = require('node:fs'), os = require('node:os');
const assert = require('node:assert/strict');
const { startServer } = require('../desktop/server.cjs');
const { run, ffmpeg, ffprobe } = require('../desktop/tools.cjs');
const { newClip } = require('../shared/model.mjs');
const { preflight } = require('../shared/rights.mjs');
const out = path.resolve('test-output', 'library-demo');
const step = n => console.log('· ' + n);
const json = async r => { const d = await r.json(); if (!r.ok) throw Object.assign(Error(d.error), d); return d; };
const api = base => (url, body, method = body ? 'POST' : 'GET') => fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(json);
async function waitJob(call, id, ms = 180000) { const t = Date.now(); for (;;) { const j = await call('/api/jobs/' + id); if (!['queued', 'running'].includes(j.status)) { if (j.status !== 'done') throw Error(j.error || j.status); return j.result; } if (Date.now() - t > ms) throw Error('timeout'); await new Promise(r => setTimeout(r, 200)); } }
async function crop(file, t, x, y, w, h) { return (await run(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y},format=gray`, '-f', 'rawvideo', '-'], { encoding: 'buffer' })).out; }
const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
async function rms(file, from, dur) { const r = await run(ffmpeg, ['-v', 'info', '-ss', String(from), '-t', String(dur), '-i', file, '-vn', '-af', 'astats=metadata=0:reset=0', '-f', 'null', '-']).catch(e => ({ err: e.message })); const m = /RMS level dB:\s*(-?[\d.inf]+)/.exec(r.err || ''); return m ? +m[1] : -Infinity; }

(async () => {
  await fs.rm(out, { recursive: true, force: true }); await fs.mkdir(out, { recursive: true });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-demo-')); const data = path.join(dir, 'data'); let s;
  try {
    s = await startServer({ dataDir: data }); let call = api(s.url);
    step('music from Openverse');
    const music = (await call('/api/creative/search?provider=openverse&kind=music&q=calm%20piano&usage=commercial')).items.find(x => x.durationMs > 40000 && ['cc0', 'by', 'pdm'].includes(x.license));
    assert.ok(music, 'a CC0/BY music result'); console.log(`  “${music.title}” by ${music.creator} · ${music.license.toUpperCase()} · ${music.sourceName}`);
    const musicA = (await waitJob(call, (await call('/api/creative/import', { provider: 'openverse', id: music.sourceId, kind: 'music', usage: 'commercial' })).job)).asset;
    step('sound effect from Openverse');
    const sfx = (await call('/api/creative/search?provider=openverse&kind=sfx&q=whoosh&length=short&usage=commercial')).items.find(x => x.durationMs && x.durationMs < 6000) ;
    assert.ok(sfx, 'a short SFX'); console.log(`  “${sfx.title}” by ${sfx.creator} · ${sfx.license.toUpperCase()} · ${(sfx.durationMs / 1000).toFixed(1)} s`);
    const sfxR = await call('/api/creative/import', { provider: 'openverse', id: sfx.sourceId, kind: 'sfx', usage: 'commercial' }); const sfxA = sfxR.asset || (await waitJob(call, sfxR.job)).asset;
    step('animated sticker from Fluent Emoji');
    const st = (await call('/api/creative/search?provider=fluent&q=party%20popper')).items[0];
    const stA = (await waitJob(call, (await call('/api/creative/import', { provider: 'fluent', id: st.sourceId })).job)).asset;
    assert.equal(stA.alpha, true); console.log(`  ${stA.name} · ${stA.width}×${stA.height} · ${stA.duration.toFixed(2)} s · alpha`);
    step('voice track (Windows speech synthesis, imported like a user file)');
    const voice = path.join(dir, 'Voiceover.wav');
    await run('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${voice}'); $s.Speak('Welcome to FrameCut. This video uses free music, a sound effect, and an animated sticker.'); $s.Dispose()`]);
    const bg = path.join(dir, 'Background.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', bg]);
    const [voiceA, bgA] = (await call('/api/media/import', { paths: [voice, bg] })).assets;
    step('build, save');
    const p = await call('/api/projects', { name: 'Library demo' }); p.usageMode = 'commercial';
    p.tracks.push({ id: 'voice', kind: 'audio', name: 'Voiceover', voice: true }, { id: 'music', kind: 'audio', name: 'Music' }, { id: 'sfx', kind: 'audio', name: 'Sound FX' });
    p.clips.push(
      newClip('video', { mediaId: bgA.id, trackId: 'main', start: 0, duration: 12, in: 0, volume: 0 }),
      newClip('audio', { mediaId: voiceA.id, trackId: 'voice', start: 1, duration: Math.min(9, voiceA.duration), in: 0, name: 'Voiceover' }),
      newClip('audio', { mediaId: musicA.id, trackId: 'music', start: 0, duration: 12, in: 5, volume: 0.35, fadeOut: 2, name: music.title }),
      newClip('audio', { mediaId: sfxA.id, trackId: 'sfx', start: 10.5, duration: Math.min(1.5, sfxA.duration), in: 0, volume: 1, name: sfx.title }),
      newClip('sticker', { sticker: { type: 'media' }, mediaId: stA.id, trackId: 'text-1', start: 2, duration: 5, in: 0, speed: 1, loop: true, transform: { x: 0.3, y: -0.2, scale: 1.2 }, name: st.title }),
    );
    p.mediaIds.push(bgA.id, voiceA.id, musicA.id, sfxA.id, stA.id);
    await call(`/api/projects/${p.id}`, p, 'PUT');
    await s.close();
    step('reopen with the online library unreachable');
    s = await startServer({ dataDir: data, creative: { openverseBase: 'https://127.0.0.1:9/v1' } }); call = api(s.url);
    const re = await call(`/api/projects/${p.id}`); const media = await call('/api/media');
    for (const id of re.mediaIds) assert.ok(media.find(m => m.id === id && !m.missing), 'media available offline: ' + id);
    await assert.rejects(call('/api/creative/search?provider=openverse&kind=music&q=more'), 'online search reports it is unavailable');
    const pf = preflight(re, id => media.find(m => m.id === id)?.source);
    assert.equal(pf.blocked.length, 0); console.log('  rights: ' + pf.items.map(i => `${i.source.title} → ${i.rights.badge}`).join(' | '));
    step('export');
    const file = path.join(out, 'Library demo.mp4');
    const res = await waitJob(call, (await call('/api/export', { project: re, rasters: {}, settings: { format: 'mp4', codec: 'h264', resolution: 720, fps: 30, quality: 'high', output: file, hardware: 'off', credits: pf.credits } })).job, 300000);
    // Same project without the sticker, to isolate it in the frame comparison.
    const bare = structuredClone(re); bare.clips = bare.clips.filter(c => c.kind !== 'sticker' && c.trackId !== 'sfx'); // no sticker, no SFX
    const ref = path.join(dir, 'ref.mp4'); await waitJob(call, (await call('/api/export', { project: bare, rasters: {}, settings: { format: 'mp4', codec: 'h264', resolution: 720, fps: 30, quality: 'high', output: ref, hardware: 'off' } })).job, 300000);
    step('verify');
    const info = JSON.parse((await run(ffprobe, ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', file])).out);
    const dur = +info.format.duration; assert.ok(Math.abs(dur - 12) < 0.15, 'duration ' + dur);
    assert.ok(info.streams.some(x => x.codec_type === 'video' && x.width === 1280) && info.streams.some(x => x.codec_type === 'audio'));
    // Sticker box: 0.36*720*1.2 ≈ 311 px centred at (1280*0.8, 720*0.3).
    const cx = 1024, cy = 216, hb = 150;
    const inside = mad(await crop(file, 4, cx - 60, cy - 60, 120, 120), await crop(ref, 4, cx - 60, cy - 60, 120, 120));
    const before = mad(await crop(file, 1, cx - 60, cy - 60, 120, 120), await crop(ref, 1, cx - 60, cy - 60, 120, 120));
    const corner = mad(await crop(file, 4, cx - hb, cy - hb, 24, 24), await crop(ref, 4, cx - hb, cy - hb, 24, 24));
    const shots = []; for (const t of [2.2, 2.6, 3.0, 3.4, 3.8]) shots.push(await crop(file, t, cx - 60, cy - 60, 120, 120));
    const anim = Math.max(...shots.slice(1).map((x, i) => mad(x, shots[i])));
    console.log(`  sticker vs no-sticker (0-255): inside ${inside.toFixed(1)} · before start ${before.toFixed(1)} · transparent corner ${corner.toFixed(1)} · animates ${anim.toFixed(1)}`);
    assert.ok(inside > 15, 'sticker visible'); assert.ok(before < 4, 'nothing before it starts'); assert.ok(corner < 4, 'transparent corners show the video'); assert.ok(anim > 3, 'sticker animates');
    const sfxOn = await rms(file, 10.5, 0.6), sfxOff = await rms(ref, 10.5, 0.6), voiceLvl = await rms(file, 2, 2), musicOnly = await rms(file, 0.1, 0.8);
    console.log(`  RMS dB: music-only ${musicOnly.toFixed(1)} · with voice ${voiceLvl.toFixed(1)} · at SFX ${sfxOn.toFixed(1)} vs same moment without the SFX ${sfxOff.toFixed(1)}`);
    assert.ok(musicOnly > -60, 'music audible'); assert.ok(voiceLvl > musicOnly, 'voice adds level'); assert.ok(sfxOn > sfxOff + 1, 'sound effect audible');
    assert.ok(res.creditsFile && fss.existsSync(res.creditsFile)); const credits = await fs.readFile(res.creditsFile, 'utf8');
    if (['by', 'by-sa'].includes(music.license)) assert.ok(credits.includes(music.creator || music.title));
    assert.match(credits, /Party popper.*MIT/);
    for (const t of [1, 3, 4, 6]) await run(ffmpeg, ['-y', '-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', path.join(out, `frame-${t}s.png`)]);
    await fs.writeFile(path.join(out, 'project.json'), JSON.stringify(re, null, 1));
    console.log('\nCredits file:\n' + credits);
    console.log('PASS: library demo →', out);
  } catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  finally { await s?.close(); }
})();
