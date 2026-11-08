// Renders the FrameCut icon SVGs to PNGs at every size and packs a multi-resolution Windows .ico.
// Run with Electron (already a dev dependency):  npm run build:icons
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const brand = path.join(root, 'assets', 'brand');
const big = fs.readFileSync(path.join(brand, 'framecut-icon.svg'), 'utf8');
const small = fs.readFileSync(path.join(brand, 'framecut-icon-small.svg'), 'utf8');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024];
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const svgFor = s => (s <= 40 ? small : big); // fine details only where they survive

// ICO container with PNG-compressed entries (supported since Windows Vista).
function ico(pngs) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length); let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16; dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3); dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8); dir.writeUInt32LE(offset, o + 12); offset += data.length;
  });
  return Buffer.concat([head, dir, ...pngs.map(p => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const out = {};
  for (const s of SIZES) {
    const url = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image(); img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svgFor(s)).toString('base64'))};
      await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = ${s};
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, ${s}, ${s});
      return c.toDataURL('image/png');
    })()`);
    out[s] = Buffer.from(url.split(',')[1], 'base64');
  }
  const dirs = { build: path.join(root, 'build'), pngs: path.join(root, 'build', 'icons') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  for (const s of SIZES) fs.writeFileSync(path.join(dirs.pngs, `${s}x${s}.png`), out[s]);
  const icoBuf = ico(ICO_SIZES.map(s => ({ size: s, data: out[s] })));
  fs.writeFileSync(path.join(dirs.build, 'icon.ico'), icoBuf);
  fs.writeFileSync(path.join(dirs.build, 'icon.png'), out[1024]);
  fs.writeFileSync(path.join(root, 'desktop', 'icon.ico'), icoBuf); // window/taskbar icon when running from source
  fs.writeFileSync(path.join(root, 'desktop', 'icon.png'), out[256]);
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'favicon.svg'), small);
  fs.writeFileSync(path.join(root, 'public', 'favicon.png'), out[64]);
  console.log(`Icons written: ${SIZES.length} PNG sizes, icon.ico (${ICO_SIZES.join(', ')} px), favicon.`);
  app.quit();
});
