// Pro (native WASAPI) recording in the real app with real Windows capture devices.
// Exclusive mode is exercised on a device that offers 24-bit exclusive formats (e.g. a USB interface,
// or the Steam Streaming Microphone virtual device); raw mode and hardware gain on the default microphone.
// Takes go to a temporary folder that is deleted afterwards; the original input gain is restored.
const { _electron: electron } = require('playwright');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const assert = require('node:assert/strict');
const { run, ffmpeg, ffprobe } = require('../desktop/tools.cjs');
const shots = path.resolve('test-output');
const step = n => console.log('· ' + n);
(async () => {
  if (process.platform !== 'win32') { console.log('SKIP: Windows only'); return; }
  await fs.mkdir(shots, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-native-')); let app, page, restore = null; const errors = [];
  try {
    const clip = path.join(temp, 'Clip.mp4');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
    app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, FRAMECUT_TEST: '1', FRAMECUT_TEST_DIR: temp } });
    page = await app.firstWindow();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
    const list = await page.evaluate(() => window.__fc.api('/api/native-audio/devices'));
    assert.ok(list.available, 'native helper available');
    console.log('  devices: ' + list.devices.map(d => `${d.name} [best ${d.best.mode}${d.best.bits ? ' ' + d.best.rate / 1000 + 'k/' + d.best.bits : ''}${d.capability.limited ? ', limited ' + d.capability.maxRate / 1000 + 'k' : ''}]`).join('; '));
    const exDev = list.devices.find(d => d.best.mode === 'exclusive'), def = list.devices.find(d => d.isDefault);
    await page.evaluate(async f => { const { state, api, edit } = window.__fc; const r = await api('/api/media/import', { paths: [f] }); await state.refreshMedia(); edit.addAssets([r.assets[0]], { at: 0 }); await state.savePrefs({ recording: { engine: 'pro', playVideo: true, countdown: false, preroll: 0, trimSilence: false, monitor: false } }); }, clip);
    // Browser device ids for the chosen endpoints (labels match Windows endpoint names).
    const pick = async name => page.evaluate(async n => { await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())); const d = (await navigator.mediaDevices.enumerateDevices()).find(x => x.kind === 'audioinput' && x.deviceId !== 'default' && x.deviceId !== 'communications' && x.label.replace(/^(Default|Communications) - /, '') === n); return d?.deviceId; }, name);

    const record = async (seconds, at) => {
      await page.evaluate(t => window.__fc.state.player.current.seek(t), at);
      const before = await page.evaluate(() => window.__fc.state.media.value.size);
      await page.keyboard.press('r'); await page.waitForFunction(() => document.querySelector('.rec-btn.stop'), null, { polling: 20 }); const t0 = Date.now();
      await page.locator('.live-row').waitFor({ timeout: 5000 });
      await page.waitForTimeout(seconds * 1000);
      const live = await page.evaluate(() => ({ text: document.querySelector('.live-take-label')?.textContent, w: document.querySelector('.live-take')?.getBoundingClientRect().width }));
      await page.screenshot({ path: path.join(shots, '13-live-take.png') });
      const t1 = Date.now(); await page.keyboard.press('r');
      await page.waitForFunction(n => window.__fc.state.media.value.size > n && !document.querySelector('.rec-btn.stop') && !document.querySelector('.live-row'), before, { timeout: 20000, polling: 100 });
      assert.equal(await page.locator('.live-row').count(), 0, 'live lane removed after stop');
      const r = await page.evaluate(() => { const s = window.__fc.state; const c = s.project.value.clips.find(c => c.id === s.selection.value[0]); return { c, a: s.media.value.get(c.mediaId) }; });
      const file = await page.evaluate(id => window.__fc.api('/api/media').then(l => { const a = l.find(a => a.id === id); return a.folder + '/' + a.fileName; }), r.a.id);
      const pr = JSON.parse((await run(ffprobe, ['-v', 'quiet', '-show_streams', '-of', 'json', file])).out).streams[0];
      return { ...r, live, wall: (t1 - t0) / 1000, pr };
    };

    if (exDev) {
      step('exclusive 24-bit on ' + exDev.name);
      const id = await pick(exDev.name); assert.ok(id, 'browser sees the device');
      await page.evaluate(i => window.__fc.state.savePrefs({ audioInput: i }), id);
      await page.locator('button[data-tip="Record voiceover"]').click(); await page.locator('.studio').waitFor();
      await page.waitForFunction(() => window.__fc.studio.capInfo.value?.engine === 'native', null, { timeout: 15000, polling: 100 });
      console.log('  input: ' + (await page.locator('.input-fmt').innerText()).replace(/\n/g, ' '));
      const r = await record(2, 1);
      console.log(`  take ${r.c.duration.toFixed(2)} s (wall ${r.wall.toFixed(2)}) at ${r.c.start.toFixed(3)} s · live lane "${r.live.text}" ${Math.round(r.live.w)} px · file ${r.pr.codec_name} ${r.pr.sample_rate} Hz ${r.pr.channels} ch · ${JSON.stringify(r.a.recording)}`);
      assert.equal(r.a.recording.engine, 'wasapi'); assert.equal(r.a.recording.mode, 'exclusive');
      assert.equal(r.pr.codec_name, 'pcm_s24le', 'bit-perfect 24-bit'); assert.equal(+r.pr.sample_rate, exDev.best.rate);
      assert.ok(Math.abs(r.c.duration - r.wall) < 0.5, 'take length matches recording time');
      assert.ok(Math.abs(r.c.start - 1) < 0.3, 'take lands at the playhead');
      assert.ok(r.live.w > 20, 'live waveform lane grew while recording');
      await page.locator('button[data-tip="Close studio"]').click();
    } else console.log('  (no device with 24-bit exclusive formats — exclusive step skipped)');

    if (def) {
      step('default microphone: ' + def.name + ' (' + (def.best.mode) + ')');
      const id = await pick(def.name);
      await page.evaluate(i => window.__fc.state.savePrefs({ audioInput: i }), id || 'default');
      await page.locator('button[data-tip="Record voiceover"]').click(); await page.locator('.studio').waitFor();
      await page.waitForFunction(n => window.__fc.studio.capInfo.value?.engine === 'native' && window.__fc.studio.capInfo.value?.label === n, def.name, { timeout: 15000, polling: 100 });
      console.log('  input: ' + (await page.locator('.input-fmt').innerText()).replace(/\n/g, ' '));
      if (def.capability.limited) assert.ok(await page.locator('.input-panel .check.warn').count(), 'low-bandwidth device warning shown');
      if (def.gain) {
        restore = { endpointId: def.id, db: def.gain.db };
        const target = Math.max(def.gain.min, Math.min(def.gain.max, def.gain.db - 3));
        await page.evaluate(async v => { await window.__fc.studio.currentCapture().setGain(v); }, target);
        const now = await page.evaluate(id2 => window.__fc.api('/api/native-audio/gain', { endpointId: id2 }), def.id);
        console.log(`  gain: ${def.gain.db.toFixed(2)} dB → ${now.db.toFixed(2)} dB (requested ${target.toFixed(2)}) · ${def.gain.hardware ? 'hardware' : 'driver'} control`);
        assert.ok(Math.abs(now.db - target) <= Math.max(0.2, def.gain.step), 'endpoint gain applied');
        await page.evaluate(async r2 => window.__fc.api('/api/native-audio/gain', r2), restore); restore = null;
      }
      const r = await record(1.5, 2);
      console.log(`  take ${r.c.duration.toFixed(2)} s · file ${r.pr.codec_name} ${r.pr.sample_rate} Hz ${r.pr.channels} ch · mode ${r.a.recording.mode}`);
      assert.equal(r.a.recording.mode, def.best.mode === 'exclusive' ? 'exclusive' : def.raw ? 'raw' : 'shared');
      await page.screenshot({ path: path.join(shots, '14-native-studio.png') });
    }
    console.log('ERRORS', JSON.stringify(errors));
    assert.deepEqual(errors.filter(e => !/Autofill|DevTools|Security/.test(e)), []);
    console.log('PASS: native');
  } catch (e) { console.error('FAIL', e.message); await page?.screenshot({ path: path.join(shots, 'fail-native.png') }).catch(() => {}); console.log('ERRORS', JSON.stringify(errors)); process.exitCode = 1; }
  finally {
    if (restore) await page?.evaluate(r2 => window.__fc.api('/api/native-audio/gain', r2), restore).catch(() => {});
    await app?.close(); await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
})();
