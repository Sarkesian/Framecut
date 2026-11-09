// Fetches the portable CPython that ships inside the installer (resources/python), so the accurate caption
// engine never needs a separate python.org install. Uses uv's python-build-standalone builds (PSF licence,
// redistributable). Run once per build machine; `npm run dist` calls it and it is a no-op when present.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = '3.11';
const root = path.join(__dirname, '..');
const out = path.join(root, 'build', 'python');
const stage = path.join(root, 'build', '.python-stage');

if (fs.existsSync(path.join(out, 'python.exe')) && !process.argv.includes('--force')) {
  console.log('Bundled Python already present:', out); process.exit(0);
}
fs.rmSync(stage, { recursive: true, force: true });
const env = { ...process.env, UV_PYTHON_INSTALL_DIR: stage, UV_CACHE_DIR: path.join(stage, '.cache'), UV_PYTHON_PREFERENCE: 'only-managed' };
execFileSync('uv', ['python', 'install', VERSION, '--no-bin'], { env, stdio: 'inherit' });
const dir = fs.readdirSync(stage).map(n => path.join(stage, n)).find(d => fs.existsSync(path.join(d, 'python.exe')));
if (!dir) throw Error('uv did not produce a Python install in ' + stage);

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(dir, out, { recursive: true });
// Not needed to run pip/venv or the speech worker; keeps the installer smaller.
for (const rel of ['Lib/test', 'Lib/idlelib', 'Lib/tkinter', 'Lib/turtledemo', 'tcl', 'Lib/lib2to3/tests']) fs.rmSync(path.join(out, rel), { recursive: true, force: true });
for (const f of fs.readdirSync(out)) if (/^(EXTERNALLY-MANAGED)$/.test(f)) fs.rmSync(path.join(out, f));
// Test suites bundled inside pip/setuptools are the deepest paths in the tree; drop them.
const dropTests = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { const p = path.join(d, e.name); if (e.name === 'tests') fs.rmSync(p, { recursive: true, force: true }); else dropTests(p); } };
dropTests(path.join(out, 'Lib', 'site-packages'));
fs.rmSync(stage, { recursive: true, force: true });
console.log('Bundled Python', execFileSync(path.join(out, 'python.exe'), ['-I', '-c', 'import sys, venv, ensurepip; print(sys.version.split()[0])']).toString().trim(), '→', out);
