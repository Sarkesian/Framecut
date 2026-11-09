// Builds shared/sfxkit-index.json: a compact searchable index of Wyzowl's CC0 SFX Kit
// (https://github.com/wyzowl/sfx-kit), pinned to one commit so file URLs never change under a
// project. Only metadata is stored; each WAV is downloaded when a creator picks it.
// Usage: node scripts/sfxkit-index.mjs [commit]
import fs from 'node:fs/promises';
import path from 'node:path';

const REPO = 'wyzowl/sfx-kit';
const UA = { 'User-Agent': 'FrameCutStudio-index-builder' };
const get = async (url, type = 'json') => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw Error(`${r.status} ${url}`); return type === 'json' ? r.json() : r.text(); };

const commit = process.argv[2] || (await get(`https://api.github.com/repos/${REPO}/commits/main`)).sha;
const license = await get(`https://raw.githubusercontent.com/${REPO}/${commit}/LICENSE`, 'text');
if (!/CC0 1\.0 Universal/.test(license)) throw Error('SFX Kit LICENSE is no longer CC0 1.0 — review before updating the index.');
const kit = await get(`https://raw.githubusercontent.com/${REPO}/${commit}/sounds.json`);
const title = s => s.replace(/(^|-)([a-z])/g, (_, d, c) => (d ? ' ' : '') + c.toUpperCase()).replace(/ And /g, ' & ');
const items = kit.sounds.filter(s => s.id && /^sounds\/[\w./-]+\.wav$/.test(s.file)).map(s => ({
  id: s.id, name: s.name, category: s.category, group: title(s.category), file: s.file, duration: s.duration, tags: (s.tags || []).slice(0, 10),
  description: s.description || '', useFor: (s.use_for || []).slice(0, 4), sync: Number.isFinite(s.sync?.at) ? s.sync.at : null, sha256: s.sha256 || null,
}));
const index = { source: `https://github.com/${REPO}`, commit, license: 'cc0', licenseVersion: '1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', licenseFile: `https://github.com/${REPO}/blob/${commit}/LICENSE`, holder: 'Wyzowl', built: new Date().toISOString().slice(0, 10), items };
const file = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'shared', 'sfxkit-index.json');
await fs.writeFile(file, JSON.stringify(index));
console.log(`Indexed ${items.length} sounds in ${new Set(items.map(i => i.category)).size} categories at ${commit.slice(0, 8)} → ${file}`);
