// Compiles the native audio helper with the C# compiler that ships with Windows (.NET Framework 4).
const { execFileSync } = require('node:child_process');
const path = require('node:path'), fs = require('node:fs');
if (process.platform !== 'win32') { console.log('Native audio helper is Windows-only; skipped.'); process.exit(0); }
const csc = path.join(process.env.WINDIR || 'C:\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!fs.existsSync(csc)) { console.error('csc.exe not found at ' + csc); process.exit(1); }
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'desktop', 'bin'), { recursive: true });
execFileSync(csc, ['-nologo', '-nowarn:675', '-target:exe', '-platform:x64', '-optimize+', '-out:' + path.join(root, 'desktop', 'bin', 'framecut-audio.exe'), path.join(root, 'native', 'framecut-audio.cs')], { stdio: 'inherit' });
console.log('Built desktop/bin/framecut-audio.exe');
