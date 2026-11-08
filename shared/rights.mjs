// Rights model for library assets: provider policies, per-item license assessment and credits.
// Engineering guidance only — FrameCut never claims an asset is legally safe; it reports what the
// source says, flags conflicts with the project's usage mode and keeps the evidence.

// What each provider allows FrameCut to do. Preview, local storage and export are separate rights.
export const PROVIDERS = {
  openverse: {
    id: 'openverse', name: 'Openverse', kinds: ['music', 'sfx'], enabled: true,
    home: 'https://openverse.org', terms: 'https://docs.openverse.org/terms_of_service.html',
    note: 'Openverse indexes openly licensed audio hosted by Jamendo, Freesound, Wikimedia Commons and others. It is a search index, not a guarantee of rights — check the original source page.',
    preview: true, storage: 'license', export: 'license',
  },
  fluent: {
    id: 'fluent', name: 'Microsoft Fluent Emoji', kinds: ['sticker'], enabled: true,
    home: 'https://github.com/microsoft/fluentui-emoji-animated', terms: 'https://github.com/microsoft/fluentui-emoji-animated/blob/main/LICENSE',
    note: 'Animated emoji released by Microsoft under the MIT license. Only the emoji you use are downloaded.',
    preview: true, storage: true, export: true, license: { id: 'mit', url: 'https://github.com/microsoft/fluentui-emoji-animated/blob/main/LICENSE', holder: 'Microsoft Corporation' },
  },
  local: { id: 'local', name: 'Your files', kinds: ['music', 'sfx', 'sticker'], enabled: true, preview: true, storage: true, export: true, note: 'Files you imported yourself. You are responsible for having the rights to use them.' },
  // Evaluated and deliberately not enabled. Shown only as information, never as working sources.
  iconscout: { id: 'iconscout', name: 'IconScout', kinds: ['sticker'], enabled: false, reason: 'Its API agreement forbids storing or caching assets locally, which saved projects and offline editing need. Requires written permission from IconScout first.' },
  epidemic: { id: 'epidemic', name: 'Epidemic Sound', kinds: ['music', 'sfx'], enabled: false, reason: 'The free API tier is for prototyping and grants no publishing rights. Needs a paid partner agreement.' },
  freesound: { id: 'freesound', name: 'Freesound (direct)', kinds: ['sfx'], enabled: false, reason: 'The direct API is free for non-commercial use only. Freesound sounds are still searchable here through Openverse.' },
  jamendo: { id: 'jamendo', name: 'Jamendo (direct)', kinds: ['music'], enabled: false, reason: 'API terms are non-commercial and restrict offline caching. Jamendo tracks are still searchable here through Openverse.' },
  giphy: { id: 'giphy', name: 'GIPHY', kinds: ['sticker'], enabled: false, reason: 'API rules forbid caching media, so stickers could not be saved in projects or exported.' },
  tenor: { id: 'tenor', name: 'Tenor', kinds: ['sticker'], enabled: false, reason: 'Tenor stopped accepting new API clients in January 2026.' },
};
export const providerInfo = id => PROVIDERS[id] || null;

const CC = {
  cc0: { name: 'CC0', commercial: true, adapt: true, attribution: false, sa: false },
  pdm: { name: 'Public Domain Mark', commercial: true, adapt: true, attribution: false, sa: false },
  by: { name: 'CC BY', commercial: true, adapt: true, attribution: true, sa: false },
  'by-sa': { name: 'CC BY-SA', commercial: true, adapt: true, attribution: true, sa: true },
  'by-nd': { name: 'CC BY-ND', commercial: true, adapt: false, attribution: true, sa: false },
  'by-nc': { name: 'CC BY-NC', commercial: false, adapt: true, attribution: true, sa: false },
  'by-nc-sa': { name: 'CC BY-NC-SA', commercial: false, adapt: true, attribution: true, sa: true },
  'by-nc-nd': { name: 'CC BY-NC-ND', commercial: false, adapt: false, attribution: true, sa: false },
  'sampling+': { name: 'CC Sampling+', commercial: true, adapt: true, attribution: true, sa: false, caution: 'Sampling+ allows remixing but not advertising use or copying the whole work.' },
  'nc-sampling+': { name: 'CC NC-Sampling+', commercial: false, adapt: true, attribution: true, sa: false, caution: 'Sampling+ allows remixing but not copying the whole work.' },
  mit: { name: 'MIT', commercial: true, adapt: true, attribution: true, sa: false, notice: true },
};
export const licenseName = (id, version) => { const d = CC[String(id || '').toLowerCase()]; return d ? `${d.name}${version && !['cc0', 'pdm', 'mit'].includes(id) ? ' ' + version : id === 'cc0' && version ? ' ' + version : ''}` : id ? String(id).toUpperCase() : 'Unknown license'; };

// Assess one asset. kind: music | sfx | sticker. usage: personal | commercial.
// Returns { level, badge, summary, details[], commercial, storage, export, attribution, blocked }
//   level: ok | credit | caution | blocked | unknown | own
export function assessRights({ provider, license, licenseVersion, kind = 'music', usage = 'commercial' } = {}) {
  const pv = PROVIDERS[provider];
  if (provider === 'local') return { level: 'own', badge: 'Your file', summary: 'You imported this file. Make sure you have the rights to use it.', details: [], commercial: 'unknown', storage: true, export: true, attribution: false, blocked: false };
  if (!pv || !pv.enabled) return { level: 'blocked', badge: 'Unavailable', summary: pv?.reason || 'This source is not available.', details: [], commercial: false, storage: false, export: false, attribution: false, blocked: true };
  const id = String(license || '').toLowerCase(); const d = CC[id];
  if (!d) return { level: 'unknown', badge: 'License unclear', summary: 'The source did not give a recognizable license. Treat it as not cleared until you confirm the rights yourself.', details: ['Open the source page and look for the license before publishing.'], commercial: 'unknown', storage: false, export: false, attribution: false, blocked: true };
  const name = licenseName(id, licenseVersion); const details = []; let level = d.attribution ? 'credit' : 'ok'; let blocked = false; let summary;
  const audio = kind === 'music' || kind === 'sfx';
  if (id === 'cc0') summary = 'The source says the creator waived their rights (CC0). FrameCut cannot verify who owns it.';
  else if (id === 'pdm') summary = 'Marked as public domain by the source. FrameCut cannot verify that claim.';
  else if (id === 'mit') summary = 'MIT license: free to use, including commercially. Keep the copyright notice in your credits.';
  else summary = `${name}: credit the creator.`;
  if (d.sa) { level = 'caution'; details.push('Share-alike: if your video counts as an adaptation, it may need to be shared under the same license.'); }
  if (d.caution) { level = 'caution'; details.push(d.caution); }
  if (!d.adapt) {
    if (audio) { level = 'blocked'; blocked = true; summary = `${name}: “No derivatives”. Putting this ${kind === 'music' ? 'music' : 'sound'} under video counts as an adaptation, which this license does not allow.`; }
    else { level = 'caution'; details.push('No derivatives: use it unmodified (no cropping, recoloring or editing).'); }
  }
  if (!d.commercial) {
    if (usage === 'commercial') { level = 'blocked'; blocked = true; summary = `${name}: non-commercial only. This project is set to commercial or monetized use.`; }
    else { if (level !== 'blocked') level = 'caution'; details.push('Non-commercial only — you cannot use it in monetized, sponsored or client videos.'); }
  }
  if (d.attribution && !blocked) details.unshift('Credit required — FrameCut adds it to your credits automatically.');
  const badge = blocked ? (!d.commercial && usage === 'commercial' ? 'Non-commercial' : 'Not for video') : !d.commercial ? 'Non-commercial' : d.sa ? 'Credit · share-alike' : d.attribution ? 'Credit required' : 'No credit needed';
  return { level, badge, name, summary, details, commercial: d.commercial, storage: true, export: !blocked, attribution: d.attribution, blocked };
}

// Openverse filter params for the usage mode (metadata-based, not a legal guarantee).
export const openverseLicenseFilter = (usage, kind) => {
  const ok = usage === 'commercial' ? ['cc0', 'pdm', 'by', 'by-sa', 'sampling+'] : ['cc0', 'pdm', 'by', 'by-sa', 'by-nc', 'by-nc-sa', 'sampling+', 'nc-sampling+'];
  return (kind === 'music' || kind === 'sfx') ? ok : [...ok, 'by-nd', ...(usage === 'commercial' ? [] : ['by-nc-nd'])];
};

// One credit line per source (assets used more than once are listed once).
export function creditLine(src) {
  if (!src) return '';
  if (src.attribution) return src.attribution.replace(/\s+To view a copy of this license, visit \S+\.?$/, '').trim() + (src.licenseUrl ? ` (${src.licenseUrl})` : '') + (src.sourcePageUrl ? ` — ${src.sourcePageUrl}` : '');
  const by = src.creator ? ` by ${src.creator}` : '';
  const lic = licenseName(src.license, src.licenseVersion);
  if (src.license === 'mit') return `“${src.title}”${by} — ${lic}${src.holder ? `, © ${src.holder}` : ''}${src.licenseUrl ? ` (${src.licenseUrl})` : ''}`;
  return `“${src.title}”${by} is licensed under ${lic}${src.licenseUrl ? ` (${src.licenseUrl})` : ''}${src.sourcePageUrl ? ` — ${src.sourcePageUrl}` : ''}`;
}
export function creditsText(sources, { projectName } = {}) {
  const seen = new Set(), lines = [];
  for (const s of sources) { const k = s.provider + ':' + s.sourceId; if (seen.has(k)) continue; seen.add(k); lines.push(creditLine(s)); }
  if (!lines.length) return '';
  const via = [...new Set(sources.map(s => PROVIDERS[s.provider]?.name).filter(Boolean))];
  return `${projectName ? projectName + ' — ' : ''}Credits\n\n${lines.map(l => '• ' + l).join('\n')}\n\nFound with ${via.join(' and ')} in FrameCut Studio.\n`;
}

// Export preflight over the clips that are actually on the timeline.
// sourceOf(mediaId) returns the asset's provenance record (or null for own files).
export function preflight(project, sourceOf) {
  const usage = project.usageMode === 'personal' ? 'personal' : 'commercial';
  const items = new Map();
  for (const c of project.clips) {
    const id = c.mediaId || (c.sticker?.type === 'media' ? c.sticker.mediaId : null); if (!id) continue;
    const src = sourceOf(id); if (!src || src.provider === 'local') continue;
    const key = src.provider + ':' + src.sourceId; if (items.has(key)) { items.get(key).clips++; continue; }
    const r = assessRights({ provider: src.provider, license: src.license, licenseVersion: src.licenseVersion, kind: src.kind, usage });
    items.set(key, { key, mediaId: id, source: src, rights: r, clips: 1 });
  }
  const list = [...items.values()];
  return { usage, items: list, blocked: list.filter(i => i.rights.blocked), caution: list.filter(i => i.rights.level === 'caution'), credits: creditsText(list.filter(i => i.rights.attribution || i.source.license === 'mit').map(i => i.source), { projectName: project.name }) };
}
