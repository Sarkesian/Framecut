// Editing stress test: hundreds of everyday edits — splitting, blade cuts, deleting (with and without ripple),
// separating / unlinking audio, duplicating, cut/copy/paste, speed, transitions, gaps, gapless main, track
// deletes / mute / lock, templates, plus real mouse drags (move, move to another track or a new one, trim,
// Ctrl+drag copy, track reorder) — across video with sound, silent video, photos, music, text, stickers and
// captions. After EVERY step the whole project is checked for corruption, the preview plan is rebuilt, and
// undo must restore the exact previous project and redo the exact next one.
//
// Usage: node tests/edit-stress-journey.cjs [randomSteps=300] [seed]
const { launchApp } = require('./launch.cjs');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const { run, ffmpeg } = require('../desktop/tools.cjs');

const STEPS = +(process.argv[2] || 300), SEED = +(process.argv[3] || Date.now() % 100000);
const shots = path.resolve('test-output');

// ---------- In-page helpers (installed once as window.__stress) ----------
const PAGE = () => {
  const { state, edit } = window.__fc;
  const EPS = 2e-3;
  const P = () => state.project.value;
  const kindFor = k => ({ video: 'video', image: 'video', audio: 'audio', text: 'text', sticker: 'text', adjust: 'effect' })[k] || 'video';
  const end = c => c.start + c.duration;
  const band = t => (t.kind === 'audio' ? 2 : t.main ? 1 : 0);
  const asset = id => state.media.value.get(id);
  const hasSound = c => c.kind === 'audio' || (c.kind === 'video' && !!asset(c.mediaId)?.audio);
  function problems() {
    const p = P(), out = [], tr = new Map(p.tracks.map(t => [t.id, t]));
    if (tr.size !== p.tracks.length) out.push('duplicate track ids');
    if (p.tracks.filter(t => t.main).length !== 1) out.push('not exactly one main track');
    for (let i = 1; i < p.tracks.length; i++) if (band(p.tracks[i]) < band(p.tracks[i - 1])) out.push(`track order: ${p.tracks[i].name} (${p.tracks[i].kind}) is below/above Main wrongly`);
    const ids = new Set();
    for (const c of p.clips) {
      if (ids.has(c.id)) out.push('duplicate clip id ' + c.id); ids.add(c.id);
      const t = tr.get(c.trackId); if (!t) { out.push(`clip ${c.name || c.kind} on missing track`); continue; }
      if (kindFor(c.kind) !== t.kind) out.push(`${c.kind} clip “${c.name}” on a ${t.kind} track`);
      if (!(c.start >= -1e-9) || !Number.isFinite(c.start)) out.push(`bad start ${c.start} on ${c.name}`);
      if (!(c.duration > 0.02) || !Number.isFinite(c.duration)) out.push(`bad duration ${c.duration} on ${c.name}`);
      if (c.mediaId && (c.kind === 'video' || c.kind === 'audio')) {
        const a = asset(c.mediaId); if (!a) out.push('missing asset for ' + c.name);
        else { if (c.in < -1e-6) out.push(`negative in-point on ${c.name}`); const so = c.in + c.duration * (c.speed || 1); if (so > a.duration + 0.06) out.push(`${c.name} runs past its media (${so.toFixed(3)} > ${a.duration.toFixed(3)})`); }
      }
      if (c.detachedAudio) {
        const a = p.clips.find(x => x.id === c.detachedAudio);
        if (!a) out.push(`${c.name}: link to missing audio`); else {
          if (a.kind !== 'audio') out.push(`${c.name}: linked to a non-audio clip`);
          if (!c.muted) out.push(`${c.name}: separated video is not muted (sound would play twice)`);
          if (Math.abs(a.start - c.start) > EPS || Math.abs(a.duration - c.duration) > EPS || Math.abs((a.in || 0) - (c.in || 0)) > EPS) out.push(`${c.name}: linked audio out of sync (v ${c.start.toFixed(3)}+${c.duration.toFixed(3)}@${(c.in || 0).toFixed(3)} / a ${a.start.toFixed(3)}+${a.duration.toFixed(3)}@${(a.in || 0).toFixed(3)})`);
        }
        if (p.clips.filter(x => x.detachedAudio === c.detachedAudio).length > 1) out.push('two videos share one separated audio clip');
      }
      if (c.transition && !p.clips.some(o => o.id !== c.id && o.trackId === c.trackId && Math.abs(end(o) - c.start) < 1e-3 && o.kind !== 'audio')) out.push(`${c.name}: transition with no clip before it`);
    }
    for (const t of p.tracks) {
      const cs = p.clips.filter(c => c.trackId === t.id).sort((a, b) => a.start - b.start);
      for (let i = 1; i < cs.length; i++) if (cs[i].start < end(cs[i - 1]) - EPS) out.push(`overlap on ${t.name}: “${cs[i - 1].name}” and “${cs[i].name}”`);
      if (t.main && p.settings.magnetic && cs.length) { if (cs[0].start > EPS) out.push('gapless main does not start at 0'); for (let i = 1; i < cs.length; i++) if (cs[i].start - end(cs[i - 1]) > EPS) out.push('gap on gapless main track'); }
      if (t.autoRemove && !cs.length) out.push(`empty auto-created track ${t.name} left behind`);
    }
    for (const id of state.selection.value) if (!ids.has(id)) out.push('selection points at a deleted clip');
    // The preview's render plan must build and contain every audible clip exactly once.
    try {
      const pl = state.player.current; pl.invalidate(); const plan = pl.getPlan();
      for (const L of plan.layers) if (L.clip && !ids.has(L.clip.id)) out.push('plan layer for a deleted clip');
      for (const c of p.clips) {
        const t = tr.get(c.trackId); const audible = hasSound(c) && !c.muted && !t?.muted && !(c.kind === 'video' && c.detachedAudio);
        const n = plan.audio.filter(A => A.id === c.id).length;
        if (audible && n !== 1) out.push(`audible clip “${c.name}” has ${n} audio entries`);
        if (!audible && n) out.push(`silent/muted clip “${c.name}” still plays audio`);
      }
    } catch (e) { out.push('render plan failed: ' + e.message); }
    return out;
  }
  const snap = () => { const p = P(); return JSON.stringify({ clips: p.clips, tracks: p.tracks, settings: p.settings, markers: p.markers }); };
  // Seeded random
  let s = 1; const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const media = () => [...state.media.value.values()];
  const byName = n => media().find(a => a.name.startsWith(n));
  const dur = () => Math.max(1, ...P().clips.map(end));
  const unlocked = () => P().clips.filter(c => !c.locked && !P().tracks.find(t => t.id === c.trackId)?.locked);
  const seek = t => state.player.current.seek(t);
  // API-level operations (each returns a label, or null when it doesn't apply right now).
  const ops = {
    addVideo() { const a = byName(pick(['Talk', 'Talk', 'Short', 'Silent'])); seek(rnd() * dur()); edit.addAssets([a], { overlay: rnd() < 0.3 }); return 'add video ' + a.name; },
    addMusic() { const a = byName('Song'); seek(rnd() * dur()); edit.addAssets([a]); return 'add music'; },
    addPhoto() { const a = byName('Photo'); seek(rnd() * dur()); edit.addAssets([a], { overlay: rnd() < 0.5 }); return 'add photo'; },
    addText() { seek(rnd() * dur()); edit.addText({ text: pick(['Hello', 'Title 😀', 'Big news', 'Part 2']) }); return 'add text'; },
    addSticker() { seek(rnd() * dur()); edit.addSticker({ type: 'emoji', value: pick(['🔥', '⭐', '😂']) }); return 'add sticker'; },
    captions() { const t0 = rnd() * dur(); edit.insertCaptions([{ start: t0, end: t0 + 1.2, text: 'first line' }, { start: t0 + 1.3, end: t0 + 2.4, text: 'second line' }], { replaceRange: [t0, t0 + 2.4] }); return 'insert captions'; },
    split() { const cs = unlocked(); if (!cs.length) return null; const c = pick(cs); const t = c.start + c.duration * (0.15 + rnd() * 0.7); seek(t); state.selection.value = rnd() < 0.5 ? [c.id] : []; edit.splitAt(t); return `split ${c.kind} “${c.name}”`; },
    blade() { const cs = unlocked(); if (!cs.length) return null; const c = pick(cs); edit.bladeCut(c.start + c.duration * (0.2 + rnd() * 0.6), rnd() < 0.2 ? undefined : [c.id]); return `blade ${c.kind}`; },
    del() { const cs = unlocked(); if (!cs.length) return null; const sel = cs.filter(() => rnd() < 0.25); if (!sel.length) sel.push(pick(cs)); edit.deleteClips(sel.map(c => c.id), { ripple: rnd() < 0.4 }); return `delete ${sel.length} (${sel.map(c => c.kind).join(',')})`; },
    separate() { const vs = unlocked().filter(c => c.kind === 'video' && !c.detachedAudio && asset(c.mediaId)?.audio); if (!vs.length) return null; edit.detachAudio(pick(vs).id); return 'separate audio'; },
    unlink() { const vs = P().clips.filter(c => c.detachedAudio); if (!vs.length) return null; const v = pick(vs); edit.unlinkClip(rnd() < 0.5 ? v.id : v.detachedAudio); return 'unlink audio'; },
    duplicate() { const cs = unlocked(); if (!cs.length) return null; const sel = [pick(cs)]; edit.duplicateClips(sel.map(c => c.id)); return 'duplicate ' + sel[0].kind; },
    copyPaste() { const cs = unlocked(); if (!cs.length) return null; edit.copyClips([pick(cs).id]); seek(rnd() * dur()); edit.pasteClips(undefined, { inPlace: rnd() < 0.3 }); return 'copy + paste'; },
    cutPaste() { const cs = unlocked(); if (!cs.length) return null; state.selection.value = [pick(cs).id]; edit.cutClips(); seek(rnd() * dur()); edit.pasteClips(); return 'cut + paste'; },
    speed() { const cs = unlocked().filter(c => c.kind === 'video' || c.kind === 'audio'); if (!cs.length) return null; const c = pick(cs); edit.setSpeed(c.id, pick([0.5, 1.5, 2, 1])); return 'speed ' + c.kind; },
    gaps() { edit.closeAllGaps(); return 'close all gaps'; },
    magnetic() { state.commit('Toggle gapless main track', d => { d.settings.magnetic = !d.settings.magnetic; }); return 'toggle gapless main'; },
    transition() { const cs = unlocked().filter(c => c.kind !== 'audio' && c.kind !== 'adjust'); if (!cs.length) return null; const c = pick(cs); if (c.transition) { edit.removeTransition(c.id); return 'remove transition'; } edit.applyTransition(pick(['dissolve', 'dip-black', 'zoom-in', 'spin']), c.id); state.transitionSel.value = null; return 'add transition'; },
    removeTrack() { const ts = P().tracks.filter(t => !t.main && !t.locked); if (!ts.length) return null; edit.removeTrack(pick(ts).id); return 'delete track'; },
    trackToggle() { const t = pick(P().tracks); const k = pick(['muted', 'hidden', 'locked']); edit.setTrack(t.id, { [k]: !t[k] }, 'toggle ' + k); return `track ${k}`; },
    unlockAll() { if (!P().tracks.some(t => t.locked) && !P().clips.some(c => c.locked)) return null; state.commit('Unlock all', d => { for (const t of d.tracks) t.locked = false; for (const c of d.clips) c.locked = false; }); return 'unlock all'; },
    mute() { const cs = unlocked().filter(c => c.kind === 'audio' || (c.kind === 'video' && asset(c.mediaId)?.audio && !c.detachedAudio)); if (!cs.length) return null; const c = pick(cs); edit.updateClip(c.id, x => { x.muted = !x.muted; }, { label: 'Mute' }); return 'mute toggle'; },
  };
  return { problems, snap, rnd, pick, ops, seed: v => { s = v; }, P, end, dur };
};

(async () => {
  await fs.mkdir(shots, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-stress-')); let app, page; const errors = []; const log = [];
  let failed = false;
  try {
    const f = n => path.join(temp, n);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=8', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:d=8', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f('Talk.mp4')]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'smptebars=s=640x360:r=30:d=5', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:d=5', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f('Short.mp4')]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x336699:s=640x360:r=30:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f('Silent.mp4')]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0x993366:s=640x360:d=1', '-frames:v', '1', f('Photo.png')]);
    await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '10', f('Song.wav')]);
    const env = { ...process.env, FRAMECUT_TEST_DIR: temp }; delete env.FRAMECUT_TEST;
    app = await launchApp(env); page = await app.firstWindow();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.evaluate(() => { localStorage.setItem('fc:timeline', '640'); localStorage.setItem('fc:ui', JSON.stringify({ linked: true, ripple: false })); });
    await page.getByText('New project').first().click(); await page.locator('.editor').waitFor();
    await page.evaluate(async files => { const { state, api } = window.__fc; const r = await api('/api/media/import', { paths: files }); state.commit('Import', p => { for (const x of r.assets) p.mediaIds.push(x.id); }); await state.refreshMedia(); }, ['Talk.mp4', 'Short.mp4', 'Silent.mp4', 'Photo.png', 'Song.wav'].map(f));
    await page.evaluate(`window.__stress = (${PAGE.toString()})()`);
    await page.evaluate(s => window.__stress.seed(s), SEED);
    console.log('seed', SEED);

    const fit = () => page.evaluate(() => { const { state } = window.__fc; const el = document.querySelector('.tl-scroll'); const d = Math.max(5, ...state.project.value.clips.map(c => c.start + c.duration)); state.zoom.value = Math.min(800, Math.max(4, (el.clientWidth - 168 - 60) / d)); el.scrollLeft = 0; el.scrollTop = 0; });
    // Do one step, then verify the project, undo (exact previous state) and redo (exact next state).
    async function step(label, act) {
      await page.evaluate(() => window.__fc.state.breakCoalesce());
      const before = await page.evaluate(() => window.__stress.snap());
      const name = await act(); if (!name) return false;
      await page.waitForTimeout(60);
      const after = await page.evaluate(() => window.__stress.snap());
      log.push(name);
      let bad = await page.evaluate(() => window.__stress.problems());
      if (bad.length) throw Object.assign(Error(`after “${name}”:\n  - ` + bad.join('\n  - ')), { stage: 'invariants' });
      if (after !== before) {
        // Some steps are several user actions (cut then paste): undo them one at a time, checking each state.
        let n = 0;
        while (n < 4) {
          await page.evaluate(() => window.__fc.state.undo()); n++;
          bad = await page.evaluate(() => window.__stress.problems()); if (bad.length) throw Error(`after undo #${n} of “${name}”:\n  - ` + bad.join('\n  - '));
          if (await page.evaluate(() => window.__stress.snap()) === before) break;
        }
        if (await page.evaluate(() => window.__stress.snap()) !== before) throw Error(`undo of “${name}” did not restore the previous project`);
        for (let i = 0; i < n; i++) await page.evaluate(() => window.__fc.state.redo());
        if (await page.evaluate(() => window.__stress.snap()) !== after) throw Error(`redo of “${name}” did not bring the change back`);
      }
      if (errors.length) throw Error(`page error during “${name}”: ${errors.join(' | ')}`);
      return true;
    }
    const api = name => () => page.evaluate(n => window.__stress.ops[n](), name);
    // ---- Mouse operations through the real timeline ----
    const rect = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);
    const pickClip = () => page.evaluate(() => { const st = window.__stress, p = st.P(); const sc = document.querySelector('.tl-scroll').getBoundingClientRect(); const els = [...document.querySelectorAll('.clip[data-clip]')].filter(e => { const r = e.getBoundingClientRect(); const c = p.clips.find(x => x.id === e.dataset.clip); const t = c && p.tracks.find(t => t.id === c.trackId); return c && !c.locked && !t?.locked && r.width > 14 && r.left > sc.left + 170 && r.right < sc.right - 4 && r.top > sc.top + 28 && r.bottom < sc.bottom; }); if (!els.length) return null; const e = st.pick(els), r = e.getBoundingClientRect(), c = p.clips.find(x => x.id === e.dataset.clip); return { id: c.id, kind: c.kind, name: c.name, x: r.left, y: r.top, w: r.width, h: r.height }; });
    const rows = () => page.evaluate(() => [...document.querySelectorAll('.track-row[data-track]')].map(e => { const r = e.getBoundingClientRect(); return { id: e.dataset.track, y: r.top, h: r.height, main: e.classList.contains('main') }; }));
    async function drag(x0, y0, x1, y1, { ctrl = false } = {}) {
      if (ctrl) await page.keyboard.down('Control');
      await page.mouse.move(x0, y0); await page.mouse.down();
      for (let i = 1; i <= 8; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8); await page.waitForTimeout(12); }
      await page.mouse.up(); if (ctrl) await page.keyboard.up('Control'); await page.waitForTimeout(80);
    }
    const rnd = () => page.evaluate(() => window.__stress.rnd());
    const mouseOps = {
      async moveH() { await fit(); const c = await pickClip(); if (!c) return null; const dx = (await rnd() - 0.5) * 300; await drag(c.x + Math.min(30, c.w / 2), c.y + c.h / 2, c.x + Math.min(30, c.w / 2) + dx, c.y + c.h / 2); return `drag ${c.kind} sideways`; },
      async moveV() { await fit(); const c = await pickClip(); if (!c) return null; const rs = await rows(); const r = rs[Math.floor(await rnd() * rs.length)]; const where = await rnd(); const y = where < 0.3 ? r.y + 2 : where < 0.6 ? r.y + r.h / 2 : where < 0.8 ? r.y + r.h - 2 : (where < 0.9 ? rs[0].y - 8 : rs.at(-1).y + rs.at(-1).h + 12); await drag(c.x + Math.min(30, c.w / 2), c.y + c.h / 2, c.x + Math.min(30, c.w / 2) + (await rnd() - 0.5) * 80, y); return `drag ${c.kind} to another track / new track`; },
      async copyDrag() { await fit(); const c = await pickClip(); if (!c) return null; await drag(c.x + Math.min(30, c.w / 2), c.y + c.h / 2, c.x + Math.min(30, c.w / 2) + 120, c.y + c.h / 2, { ctrl: true }); return `ctrl+drag copy ${c.kind}`; },
      async trim() { await fit(); const c = await pickClip(); if (!c || c.w < 40) return null; const right = await rnd() < 0.5; const ex = right ? c.x + c.w - 3 : c.x + 3; await drag(ex, c.y + c.h / 2, ex + (await rnd() - 0.5) * 140, c.y + c.h / 2); return `trim ${right ? 'end' : 'start'} of ${c.kind}`; },
      async reorder() { const rs = (await rows()).filter(r => !r.main); if (!rs.length) return null; const r = rs[Math.floor(await rnd() * rs.length)]; const all = await rows(); const to = all[Math.floor(await rnd() * all.length)]; await drag(r ? 70 : 0, r.y + r.h / 2, 70, to.y + (await rnd() < 0.5 ? 3 : to.h - 3)); return 'reorder track'; },
      async keys() { await fit(); const c = await pickClip(); if (!c) return null; await page.mouse.click(c.x + Math.min(20, c.w / 2), c.y + c.h / 2); const k = await page.evaluate(() => window.__stress.pick(['Control+b', 'Delete', 'Shift+Delete', 'Control+d', 'Control+m', 'Control+l'])); await page.evaluate(t => window.__fc.state.player.current.seek(t), c ? 0 : 0); await page.keyboard.press(k); await page.waitForTimeout(60); return `select ${c.kind} + ${k}`; },
      async template() { await page.locator('.rail-btn', { hasText: 'Templates' }).click(); const tiles = page.locator('.text-tile'); const n = await tiles.count(); if (!n) return null; const i = Math.floor(await rnd() * n); await tiles.nth(i).click(); return 'add template #' + i; },
    };
    // ---------- 1) Scripted scenarios: the common workflows, in order ----------
    const scripted = [
      ['addVideo'], ['addVideo'], ['addVideo'], ['addMusic'], ['addPhoto'], ['addText'], ['addSticker'], ['captions'],
      ['split'], ['split'], ['separate'], ['split'], ['blade'], ['moveH'], ['moveV'], ['moveV'], ['trim'], ['trim'],
      ['separate'], ['del'], ['unlink'], ['copyPaste'], ['cutPaste'], ['duplicate'], ['copyDrag'], ['speed'],
      ['transition'], ['transition'], ['magnetic'], ['moveV'], ['split'], ['gaps'], ['magnetic'], ['reorder'], ['reorder'],
      ['template'], ['template'], ['keys'], ['keys'], ['keys'], ['removeTrack'], ['trackToggle'], ['unlockAll'], ['mute'], ['del'],
    ];
    for (const [op] of scripted) await step(op, mouseOps[op] || api(op));
    console.log(`scripted: ${log.length} steps OK`);
    // ---------- 2) Randomized: everything mixed, many times ----------
    const weights = { addVideo: 6, addMusic: 2, addPhoto: 2, addText: 3, addSticker: 2, captions: 1, split: 10, blade: 6, del: 7, separate: 5, unlink: 2, duplicate: 3, copyPaste: 3, cutPaste: 2, speed: 2, gaps: 2, magnetic: 2, transition: 3, removeTrack: 1, trackToggle: 2, unlockAll: 2, mute: 2, moveH: 8, moveV: 8, copyDrag: 3, trim: 8, reorder: 3, keys: 6, template: 1 };
    const bag = Object.entries(weights).flatMap(([k, w]) => Array(w).fill(k));
    let done = 0;
    for (let i = 0; i < STEPS; i++) {
      const op = bag[Math.floor(await rnd() * bag.length)];
      // Keep projects a manageable size: start over (cleanly, through undo-able deletes) when it grows large.
      if ((await page.evaluate(() => window.__stress.P().clips.length)) > 40) await step('reset', async () => { await page.evaluate(() => { window.__fc.state.commit('Clear', d => { d.clips = []; d.tracks = d.tracks.filter(t => t.main || !t.autoRemove); for (const t of d.tracks) t.locked = false; }); }); return 'clear project'; });
      if (await step(op, mouseOps[op] || api(op))) done++;
      if (i % 50 === 49) console.log(`random: ${i + 1}/${STEPS}`);
    }
    console.log(`random: ${done} steps applied OK`);
    console.log('PASS: edit stress (seed ' + SEED + ', ' + log.length + ' steps)');
  } catch (e) {
    failed = true;
    console.log('FAIL (seed ' + SEED + '):', e.message);
    console.log('last steps:\n  ' + log.slice(-15).join('\n  '));
    try { await page?.screenshot({ path: path.join(shots, 'fail-edit-stress.png') }); const dump = await page.evaluate(() => JSON.stringify({ tracks: window.__stress.P().tracks, clips: window.__stress.P().clips.map(c => ({ id: c.id.slice(0, 6), kind: c.kind, name: c.name, track: c.trackId, start: c.start, duration: c.duration, in: c.in, speed: c.speed, muted: c.muted, link: c.detachedAudio?.slice(0, 6), tr: !!c.transition })) }, null, 1)); await fs.writeFile(path.join(shots, 'fail-edit-stress.json'), dump); } catch {}
    process.exitCode = 1;
  } finally { await app?.close().catch(() => {}); await fs.rm(temp, { recursive: true, force: true }).catch(() => {}); }
})();
