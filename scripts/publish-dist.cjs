// Puts the freshly built installer where it is easy to find: one folder, shared by every checkout of the
// project, holding FrameCutStudio-<version>-setup.exe and its SHA-256. Runs at the end of `npm run package`.
// The folder is ../dist (next to the checkout) unless FRAMECUT_DIST names another one.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const built = path.join(root, 'release', 'FrameCutStudio-Setup.exe');
const out = path.resolve(process.env.FRAMECUT_DIST || path.join(root, '..', 'dist'));
const name = `FrameCutStudio-${version}-setup.exe`;

if (!fs.existsSync(built)) { console.error('No installer at ' + built + '. Run `npm run package` first.'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(built, path.join(out, name));
const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex');
fs.writeFileSync(path.join(out, `SHA256SUMS-${version}.txt`), `${sha}  ${name}\n`);
console.log(`Installer: ${path.join(out, name)} (${(fs.statSync(built).size / 1048576).toFixed(0)} MB)`);
