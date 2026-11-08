// Launches the real desktop app, walks the core journey, captures screenshots and renderer errors.
const { _electron: electron } = require('playwright');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const { run, ffmpeg } = require('../desktop/tools.cjs');
const shots = path.resolve('test-output'); 
(async () => {
  await fs.mkdir(shots, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'framecut-ui-')); let app;
  const errors = [];
  try {
    const clip = path.join(temp, 'Sunset drive.mp4'), clip2 = path.join(temp, 'City lights.mp4'), song = path.join(temp, 'Song.wav');
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'mandelbrot=s=1280x720:r=30', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip2]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '10', song]);
    app = await electron.launch({ args: [path.resolve('.')], env: { ...process.env, FRAMECUT_TEST: '1', FRAMECUT_TEST_DIR: temp } });
    const page = await app.firstWindow();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.setViewportSize({ width: 1600, height: 960 });
    await page.getByText('New project').first().waitFor({ timeout: 20000 });
    await page.screenshot({ path: path.join(shots, '01-home.png') });
    await page.getByText('New project').first().click();
    await page.locator('.editor').waitFor();
    // import by path through the API (equivalent to the native picker)
    await page.evaluate(async files => { const r = await fetch('/api/media/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: files }) }); return r.json(); }, [clip, clip2, song]);
    await page.evaluate(() => window.__fcTest?.refresh?.());
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(shots, '02-editor-empty.png') });
    console.log('ERRORS', JSON.stringify(errors, null, 1));
  } catch (e) { console.error(e); errors.push(String(e)); await (await app?.firstWindow())?.screenshot({ path: path.join(shots, 'fail.png') }).catch(() => {}); console.log('ERRORS', JSON.stringify(errors, null, 1)); process.exitCode = 1; }
  finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
})();
