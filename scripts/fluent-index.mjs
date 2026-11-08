// Builds shared/fluent-index.json: a small searchable index (names, keywords, groups, file paths)
// of Microsoft's MIT-licensed Fluent Emoji Animated set. Only metadata is stored; the animated
// files themselves are downloaded one at a time, when a user picks one.
// Usage: node scripts/fluent-index.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const REPO = 'microsoft/fluentui-emoji-animated';
const UA = { 'User-Agent': 'FrameCutStudio-index-builder' };
const get = async (url, type = 'json') => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw Error(`${r.status} ${url}`); return type === 'json' ? r.json() : r.text(); };

const commit = (await get(`https://api.github.com/repos/${REPO}/commits/main`)).sha;
const tree = await get(`https://api.github.com/repos/${REPO}/git/trees/${commit}?recursive=1`);
if (tree.truncated) throw Error('Tree listing was truncated');
const files = tree.tree.filter(x => x.type === 'blob');
const dirs = [...new Set(files.filter(f => f.path.endsWith('/metadata.json')).map(f => f.path.split('/')[1]))];
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const out = []; let i = 0;
async function worker() {
  while (i < dirs.length) {
    const dir = dirs[i++];
    const meta = await get(`https://raw.githubusercontent.com/${REPO}/${commit}/assets/${encodeURIComponent(dir)}/metadata.json`).catch(() => null);
    const pngs = files.filter(f => f.path.startsWith(`assets/${dir}/`) && f.path.endsWith('.png'));
    const main = pngs.find(f => f.path.includes('/Default/')) || pngs.find(f => !/\/(Light|Medium-Light|Medium|Medium-Dark|Dark)\//.test(f.path));
    if (!main) continue;
    out.push({ id: slug(dir), name: dir, glyph: meta?.glyph || '', group: meta?.group || 'Other', keywords: (meta?.keywords || []).filter(k => k.toLowerCase() !== dir.toLowerCase()).slice(0, 8), file: main.path.slice('assets/'.length), tones: pngs.length > 1 });
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
const index = { source: `https://github.com/${REPO}`, commit, license: 'MIT', licenseUrl: `https://github.com/${REPO}/blob/main/LICENSE`, holder: 'Microsoft Corporation', built: new Date().toISOString().slice(0, 10), items: out };
const file = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'shared', 'fluent-index.json');
await fs.writeFile(file, JSON.stringify(index));
console.log(`Indexed ${out.length} emoji at ${commit.slice(0, 8)} → ${file}`);
