// FrameCut keeps everything it manages in one folder next to its executable:
//
//   <install folder>\FrameCut Studio.exe, resources\ ...   the application (replaced by updates)
//   <install folder>\data\                                 everything FrameCut writes (kept by updates)
//     projects\  media\          your projects, recordings and downloaded library media
//     profile\                   window/UI state, credentials, built-in AI model cache (Chromium profile)
//     engines\                   the accurate caption engine's Python environment and models
//     cache\  temp\  logs\       rebuildable files; temp is emptied on every start
//     fonts\ luts\ templates\    preferences.json, media.json ...
//
// Nothing goes to AppData, Documents or ProgramData. Paths inside data\ are stored relative (see
// toStored/fromStored) so the whole folder can move to another drive.
const fs = require('node:fs');
const path = require('node:path');

const DATA_TOKEN = '@data/';

// The install root. Packaged: the folder holding the .exe. Development: <repo>/.workspace/app.
function appRoot({ packaged, execPath, devRoot }) { return packaged ? path.dirname(execPath) : devRoot; }

function layout(dataDir) {
  return {
    dataDir,
    profile: path.join(dataDir, 'profile'),
    cache: path.join(dataDir, 'cache'),
    temp: path.join(dataDir, 'temp'),
    logs: path.join(dataDir, 'logs'),
    projects: path.join(dataDir, 'projects'),
    engines: path.join(dataDir, 'engines'),
  };
}

// Can this folder hold FrameCut's data? Protected folders (Program Files, Windows) fail for normal users;
// we never try to loosen their permissions.
function writableProblem(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok'); fs.rmSync(probe, { force: true });
    return null;
  } catch (e) { return e.code || e.message; }
}
function isProtectedLocation(dir, env = process.env) {
  const norm = p => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '') + path.sep;
  const target = norm(dir);
  return [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.SystemRoot, env.ProgramData].filter(Boolean).some(p => target.startsWith(norm(p)));
}

// Empty data\temp of anything a previous run left behind (crash, forced quit).
function resetTemp(temp) { fs.mkdirSync(temp, { recursive: true }); emptyDir(temp); }
// Remove everything inside a folder, entry by entry. The folder itself may be held open by Chromium
// (removing it fails with EPERM), and one busy file must not stop the rest from being cleaned.
function emptyDir(dir) {
  let names = []; try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) try { fs.rmSync(path.join(dir, n), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
}

// Persisted JSON: absolute paths under dataDir become "@data/<relative>", and back again on load.
function toStored(value, dataDir) {
  const base = path.resolve(dataDir).toLowerCase() + path.sep;
  const walk = v => {
    if (typeof v === 'string') return path.isAbsolute(v) && path.resolve(v).toLowerCase().startsWith(base) ? DATA_TOKEN + path.relative(dataDir, v).split(path.sep).join('/') : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}
function fromStored(value, dataDir) {
  const walk = v => {
    if (typeof v === 'string') return v.startsWith(DATA_TOKEN) ? path.join(dataDir, ...v.slice(DATA_TOKEN.length).split('/')) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = walk(v[k]); return v; }
    return v;
  };
  return walk(value);
}

// Environment for every tool FrameCut starts (FFmpeg, Python, pip): temp files and tool caches stay in data\.
function toolEnv(dataDir, extra = {}) {
  const l = layout(dataDir), env = { ...process.env };
  for (const k of ['PYTHONHOME', 'PYTHONPATH', 'PYTHONSTARTUP', 'PIP_CONFIG_FILE', 'VIRTUAL_ENV']) delete env[k];
  return {
    ...env, TEMP: l.temp, TMP: l.temp,
    PIP_NO_CACHE_DIR: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
    XDG_CACHE_HOME: path.join(l.engines, 'cache'), TORCH_HOME: path.join(l.engines, 'torch'), HF_HOME: path.join(l.engines, 'models'),
    ...extra,
  };
}

module.exports = { appRoot, layout, writableProblem, isProtectedLocation, resetTemp, emptyDir, toStored, fromStored, toolEnv, DATA_TOKEN };
