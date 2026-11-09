// Safe JSON files for FrameCut's indexes (media.json, creative.json, preferences.json, framecut-config.json).
//
// - Writes go to a uniquely named temporary file that then replaces the original, so a crash or power
//   loss mid-write never leaves a half-written file, and two overlapping writes can't interleave.
// - Writes to the same file are serialised: the last write always wins, in order.
// - Reads fall back to the last known-good copy (<file>.bak, refreshed on each successful start-up read).
//   A damaged file is set aside as <file>.damaged-<time> instead of being silently replaced, so whatever
//   it held can still be recovered by hand.
const fs = require('node:fs');
const fsp = require('node:fs/promises');

let seq = 0;
const tmpName = file => `${file}.${process.pid}-${Date.now()}-${++seq}.tmp`;
const chains = new Map();

// Windows: antivirus/indexers can briefly hold the target open; retry the replace a few times.
async function replace(tmp, file) {
  for (let i = 0; ; i++) {
    try { return await fsp.rename(tmp, file); }
    catch (e) { if (i >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { await fsp.unlink(tmp).catch(() => {}); throw e; } await new Promise(r => setTimeout(r, 40 * (i + 1))); }
  }
}
function replaceSync(tmp, file) {
  for (let i = 0; ; i++) {
    try { return fs.renameSync(tmp, file); }
    catch (e) { if (i >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch {} throw e; } const until = Date.now() + 40 * (i + 1); while (Date.now() < until); }
  }
}

// Atomically write text; overlapping calls for the same file run one after another.
function writeAtomic(file, text) {
  const prev = chains.get(file) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => { const tmp = tmpName(file); await fsp.writeFile(tmp, text); await replace(tmp, file); });
  chains.set(file, next);
  next.finally(() => { if (chains.get(file) === next) chains.delete(file); }).catch(() => {});
  return next;
}
const writeJson = (file, value, space) => writeAtomic(file, JSON.stringify(value, null, space));
function writeJsonSync(file, value, space) { const tmp = tmpName(file); fs.writeFileSync(tmp, JSON.stringify(value, null, space)); replaceSync(tmp, file); }
// Resolves once every pending write (to any file) has finished.
const settle = () => Promise.allSettled([...chains.values()]);

// Read JSON with recovery. Returns { value, source: 'file' | 'backup' | 'none', damaged? }.
// `fallback` is returned (source 'none') when neither the file nor its backup exists or parses.
function readJsonSync(file, fallback = null, { keepBackup = true } = {}) {
  const parse = f => JSON.parse(fs.readFileSync(f, 'utf8'));
  let damaged = null;
  if (fs.existsSync(file)) {
    try {
      const value = parse(file);
      if (keepBackup) try { fs.copyFileSync(file, file + '.bak'); } catch {}
      return { value, source: 'file' };
    } catch {
      damaged = `${file}.damaged-${Date.now()}`;
      try { fs.renameSync(file, damaged); } catch { damaged = null; }
    }
  }
  try { const value = parse(file + '.bak'); try { fs.copyFileSync(file + '.bak', file); } catch {} return { value, source: 'backup', damaged }; } catch {}
  return { value: fallback, source: 'none', damaged };
}

module.exports = { writeAtomic, writeJson, writeJsonSync, readJsonSync, settle };
