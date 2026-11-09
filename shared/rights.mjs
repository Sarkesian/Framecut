// Unified license model for every library asset (music, sound effects, stickers, animated stickers):
// provider policies, license verification, per-item assessment, discovery filters, credits in every
// format a creator needs, and an export check that never lets a required credit disappear silently.
// Engineering guidance only — FrameCut never claims an asset is legally safe; it reports what the
// source says, refuses anything unknown or contradictory, and keeps the evidence with the project.

// The three labels creators see. Everything maps onto one of them (plus "Your file" for imports).
export const LABELS = { free: 'No credit needed', credit: 'Credits handled automatically', restricted: 'Restricted usage', own: 'Your file' };
// Discovery modes: what the library shows. Default is attribution-free only.
export const INCLUDE = [['free', 'No credit needed'], ['credit', 'Also show credit-required (credits automatic)'], ['all', 'Everything usable (incl. restricted)']];
export const includeMode = v => (['free', 'credit', 'all'].includes(v) ? v : 'free');

// What each provider allows FrameCut to do. Preview, local storage and export are separate rights.
// `license` marks providers whose whole catalog is under one license (verified against their terms).
export const PROVIDERS = {
  openverse: {
    id: 'openverse', name: 'Openverse', kinds: ['music', 'sfx', 'sticker'], enabled: true,
    home: 'https://openverse.org', terms: 'https://docs.openverse.org/terms_of_service.html',
    note: 'Openverse indexes openly licensed audio and images hosted by Freesound, Jamendo, Wikimedia Commons, SVG Silh and others. FrameCut re-reads each item’s license from Openverse before adding it and keeps that record.',
    preview: true, storage: 'license', export: 'license',
  },
  sfxkit: {
    id: 'sfxkit', name: 'SFX Kit', kinds: ['sfx'], enabled: true,
    home: 'https://github.com/wyzowl/sfx-kit', terms: 'https://github.com/wyzowl/sfx-kit/blob/main/LICENSE',
    note: '320 sound effects made for video editing (whooshes, UI, risers, hits, logo stings…) released by Wyzowl under CC0. Each file is fetched from a pinned version and checked against its published fingerprint.',
    preview: true, storage: true, export: true, license: { id: 'cc0', version: '1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', holder: null },
  },
  ccmixter: {
    id: 'ccmixter', name: 'ccMixter', kinds: ['music'], enabled: true,
    home: 'https://ccmixter.org', terms: 'https://ccmixter.org/terms',
    note: 'Community music with per-track Creative Commons licenses. Attribution-free mode shows only tracks their creators released under CC0; each license is re-read from ccMixter before adding.',
    preview: true, storage: 'license', export: 'license',
  },
  pixabay: {
    id: 'pixabay', name: 'Pixabay', kinds: ['sticker'], enabled: true, needsKey: true, optional: true,
    home: 'https://pixabay.com', terms: 'https://pixabay.com/api/docs/',
    note: 'Transparent illustrations and vectors under the Pixabay Content License: free for commercial use, no credit needed. Optional: it needs a free Pixabay account and API key (Preferences › Library), so it is off until you add one. Pixabay’s API has no music or sound effects.',
    preview: true, storage: true, export: true, license: { id: 'pixabay', url: 'https://pixabay.com/service/license-summary/', holder: null },
  },
  fluent: {
    id: 'fluent', name: 'Microsoft Fluent Emoji', kinds: ['sticker'], enabled: true,
    home: 'https://github.com/microsoft/fluentui-emoji-animated', terms: 'https://github.com/microsoft/fluentui-emoji-animated/blob/main/LICENSE',
    note: 'Animated emoji released by Microsoft under the MIT license. Its copyright notice ships with FrameCut (Preferences › Library › Licenses), so videos need no credit. Only the emoji you use are downloaded.',
    preview: true, storage: true, export: true, license: { id: 'mit', url: 'https://github.com/microsoft/fluentui-emoji-animated/blob/main/LICENSE', holder: 'Microsoft Corporation' },
  },
  local: { id: 'local', name: 'Your files', kinds: ['music', 'sfx', 'sticker'], enabled: true, preview: true, storage: true, export: true, note: 'Files you imported yourself. You are responsible for having the rights to use them.' },
  // Evaluated and deliberately not enabled. Shown only as information, never as working sources.
  iconscout: { id: 'iconscout', name: 'IconScout', kinds: ['sticker'], enabled: false, reason: 'Its API agreement forbids storing or caching assets locally, which saved projects and offline editing need. Requires written permission from IconScout first.' },
  epidemic: { id: 'epidemic', name: 'Epidemic Sound', kinds: ['music', 'sfx'], enabled: false, reason: 'The free API tier is for prototyping and grants no publishing rights. Needs a paid partner agreement.' },
  freesound: { id: 'freesound', name: 'Freesound (direct)', kinds: ['sfx'], enabled: false, reason: 'The direct API is free for non-commercial use only. Freesound sounds (including its large CC0 collection) are still searchable here through Openverse.' },
  jamendo: { id: 'jamendo', name: 'Jamendo (direct)', kinds: ['music'], enabled: false, reason: 'API terms are non-commercial and restrict offline caching. Jamendo tracks are still searchable here through Openverse.' },
  mixkit: { id: 'mixkit', name: 'Mixkit', kinds: ['music', 'sfx'], enabled: false, reason: 'No public API, and its license does not allow offering its files through another app or library.' },
  lottiefiles: { id: 'lottiefiles', name: 'LottieFiles', kinds: ['sticker'], enabled: false, reason: 'Its license forbids collecting its files into another service, and API access terms are not public.' },
  uppbeat: { id: 'uppbeat', name: 'Uppbeat', kinds: ['music'], enabled: false, reason: 'No open API (waitlist only), and free tracks need a per-video credit code tied to the creator’s own account.' },
  'pixabay-audio': { id: 'pixabay-audio', name: 'Pixabay music & sound effects', kinds: ['music', 'sfx'], enabled: false, reason: 'Pixabay’s API only serves images and videos; its audio cannot be searched or downloaded by apps.' },
  giphy: { id: 'giphy', name: 'GIPHY', kinds: ['sticker'], enabled: false, reason: 'API rules forbid caching media, so stickers could not be saved in projects or exported.' },
  tenor: { id: 'tenor', name: 'Tenor', kinds: ['sticker'], enabled: false, reason: 'Tenor stopped accepting new API clients in January 2026.' },
};
export const providerInfo = id => PROVIDERS[id] || null;

// License facts. `cc` licenses are verified against their canonical creativecommons.org address.
const LICENSES = {
  cc0: { name: 'CC0', cc: 'publicdomain/zero', commercial: true, adapt: true, attribution: false, sa: false },
  pdm: { name: 'Public Domain Mark', cc: 'publicdomain/mark', commercial: true, adapt: true, attribution: false, sa: false },
  by: { name: 'CC BY', cc: 'licenses/by', commercial: true, adapt: true, attribution: true, sa: false },
  'by-sa': { name: 'CC BY-SA', cc: 'licenses/by-sa', commercial: true, adapt: true, attribution: true, sa: true },
  'by-nd': { name: 'CC BY-ND', cc: 'licenses/by-nd', commercial: true, adapt: false, attribution: true, sa: false },
  'by-nc': { name: 'CC BY-NC', cc: 'licenses/by-nc', commercial: false, adapt: true, attribution: true, sa: false },
  'by-nc-sa': { name: 'CC BY-NC-SA', cc: 'licenses/by-nc-sa', commercial: false, adapt: true, attribution: true, sa: true },
  'by-nc-nd': { name: 'CC BY-NC-ND', cc: 'licenses/by-nc-nd', commercial: false, adapt: false, attribution: true, sa: false },
  'sampling+': { name: 'CC Sampling+', cc: 'licenses/sampling+', commercial: true, adapt: true, attribution: true, sa: false, caution: 'Sampling+ allows remixing but not advertising use or copying the whole work.' },
  'nc-sampling+': { name: 'CC NC-Sampling+', cc: 'licenses/nc-sampling+', commercial: false, adapt: true, attribution: true, sa: false, caution: 'Sampling+ allows remixing but not copying the whole work.' },
  // MIT asks that its copyright notice accompany copies of the files. FrameCut carries that notice at
  // application level (the open-source notices screen) and in every credits file, so videos need no credit.
  mit: { name: 'MIT', commercial: true, adapt: true, attribution: false, sa: false, notice: true },
  pixabay: {
    name: 'Pixabay Content License', commercial: true, adapt: true, attribution: false, sa: false,
    restrictions: ['Don’t sell or redistribute it unchanged on its own (as a stock file, print, sticker pack or similar).', 'People, logos or brands shown in it may need their own permission for some uses.'],
  },
};
export const licenseName = (id, version) => {
  const k = String(id || '').toLowerCase(); const d = LICENSES[k];
  if (!d) return id ? String(id).toUpperCase() : 'Unknown license';
  return d.cc && version ? `${d.name} ${version}` : d.name;
};
export const licenseUrlFor = (id, version) => { const d = LICENSES[String(id || '').toLowerCase()]; return d?.cc && version ? `https://creativecommons.org/${d.cc}/${version}/` : null; };

// ---------------------------------------------------------------- verification
// Parse a creativecommons.org license address into { code, version }.
export function parseLicenseUrl(u) {
  let x; try { x = new URL(u); } catch { return null; }
  if (!/(^|\.)creativecommons\.org$/i.test(x.hostname)) return null;
  const m = /^\/(licenses\/([a-z+-]+)|publicdomain\/(zero|mark))\/(\d+(?:\.\d+)?)\/?/i.exec(x.pathname);
  if (!m) return null;
  return { code: m[2] ? m[2].toLowerCase() : m[3].toLowerCase() === 'zero' ? 'cc0' : 'pdm', version: m[4] };
}
// The license a human-readable attribution string claims ("… is licensed under CC BY-NC 4.0").
export function licenseInText(text) {
  const t = String(text || ''); const at = t.search(/\b(licensed under|marked with|dedicated to)\b/i); if (at < 0) return null;
  const m = /\b(CC0|Public Domain Mark|CC[ -](NC-)?SAMPLING\+|CC BY(?:-NC)?(?:-SA|-ND)?)\s*(\d+(?:\.\d+)?)?/i.exec(t.slice(at)); if (!m) return null;
  const w = m[1].toUpperCase();
  const code = w === 'CC0' ? 'cc0' : w === 'PUBLIC DOMAIN MARK' ? 'pdm' : /SAMPLING/.test(w) ? (m[2] ? 'nc-sampling+' : 'sampling+') : w.replace(/^CC /, '').toLowerCase();
  return { code, version: m[3] || null };
}
// Check an item's license data for internal consistency (code, version, link, attribution text) and
// against the provider's published policy. Anything unknown, incomplete or contradictory fails.
// Returns a record that is stored with the asset as evidence.
export function verifyLicense(rec = {}, { listed = null, checkedAt = new Date().toISOString(), method = 'provider-api' } = {}) {
  const pv = PROVIDERS[rec.provider]; const id = String(rec.license || '').toLowerCase(); const problems = [];
  const bad = (code, text) => problems.push({ code, text });
  let licenseUrl = rec.licenseUrl || null, evidenceUrl = rec.licenseEvidenceUrl || null;
  if (pv?.license) {
    if (pv.license.version && rec.licenseVersion && String(rec.licenseVersion) !== pv.license.version) bad('contradictory', `The item lists version ${rec.licenseVersion}, but ${pv.name} publishes version ${pv.license.version}.`);
    if (id && id !== pv.license.id) bad('contradictory', `The item lists ${licenseName(id)}, but ${pv.name} publishes everything under ${licenseName(pv.license.id)}.`);
    licenseUrl = pv.license.url; evidenceUrl ||= pv.license.url;
  } else {
    const d = LICENSES[id];
    if (!d) bad('unknown', id ? `“${rec.license}” is not a license FrameCut recognises.` : 'The source gives no license.');
    else if (d.cc) {
      const canonical = licenseUrlFor(id, rec.licenseVersion);
      if (!rec.licenseVersion) bad('incomplete', `The ${d.name} version is missing, so the exact terms can’t be linked.`);
      if (rec.licenseUrl) {
        const got = parseLicenseUrl(rec.licenseUrl);
        if (!got) bad('contradictory', 'The license link does not point to Creative Commons.');
        else if (got.code !== id) bad('contradictory', `The license is listed as ${d.name}, but its link is for ${licenseName(got.code)}.`);
        else if (rec.licenseVersion && got.version !== String(rec.licenseVersion)) bad('contradictory', `The license version (${rec.licenseVersion}) does not match its link (${got.version}).`);
      }
      const said = licenseInText(rec.attribution);
      if (said && said.code !== id) bad('contradictory', `The credit text says ${licenseName(said.code)}, but the license field says ${d.name}.`);
      else if (said?.version && rec.licenseVersion && said.version !== String(rec.licenseVersion)) bad('contradictory', `The credit text names version ${said.version}, the license field ${rec.licenseVersion}.`);
      licenseUrl = canonical || licenseUrl;
    }
    if (d?.attribution && !rec.title && !rec.creator) bad('incomplete', 'There is no title or creator to credit.');
  }
  const changed = listed && (String(listed.license || '').toLowerCase() !== id || String(listed.licenseVersion || '') !== String(rec.licenseVersion || ''));
  const status = problems.some(p => p.code === 'contradictory') ? 'contradictory' : problems.some(p => p.code === 'unknown') ? 'unknown' : problems.length ? 'incomplete' : 'verified';
  return {
    status, ok: status === 'verified', problems, checkedAt, method, provider: rec.provider || null, evidenceUrl, providerTerms: pv?.terms || null,
    license: id || null, licenseVersion: rec.licenseVersion || null, licenseUrl,
    ...(changed ? { changedSinceListing: { from: licenseName(listed.license, listed.licenseVersion), to: licenseName(id, rec.licenseVersion) } } : {}),
  };
}

// ---------------------------------------------------------------- assessment
// Assess one asset. kind: music | sfx | sticker. usage: personal | commercial.
// `verification`: a stored verifyLicense() record; a failed one makes the asset unusable.
// Returns { level, tier, label, badge, reason, name, summary, details[], restrictions[], commercial, storage, export, attribution, notice, blocked }
//   level: ok | credit | caution | blocked | unknown | own      tier: free | credit | restricted | own
export function assessRights({ provider, license, licenseVersion, kind = 'music', usage = 'commercial', verification = null } = {}) {
  const pv = PROVIDERS[provider];
  const out = (level, o) => { const tier = level === 'own' ? 'own' : level === 'ok' ? 'free' : level === 'credit' ? 'credit' : 'restricted'; return { level, tier, label: LABELS[tier], badge: LABELS[tier], reason: null, name: null, details: [], restrictions: [], commercial: false, storage: false, export: false, attribution: false, notice: false, blocked: false, ...o }; };
  if (provider === 'local') return out('own', { summary: 'You imported this file. Make sure you have the rights to use it.', commercial: 'unknown', storage: true, export: true });
  if (!pv || !pv.enabled) return out('blocked', { reason: 'unavailable', summary: pv?.reason || 'This source is not available.', blocked: true });
  const id = String(license || (pv.license ? pv.license.id : '')).toLowerCase(); const d = LICENSES[id];
  if (verification && verification.status && verification.status !== 'verified') return out('unknown', { reason: 'unclear', summary: 'The license information is ' + (verification.status === 'contradictory' ? 'contradictory' : verification.status === 'incomplete' ? 'incomplete' : 'unclear') + ', so FrameCut treats it as not cleared.', details: (verification.problems || []).map(p => p.text), blocked: true });
  if (!d) return out('unknown', { reason: 'unclear', summary: 'The source did not give a recognizable license. Treat it as not cleared until you confirm the rights yourself.', details: ['Open the source page and look for the license before publishing.'], commercial: 'unknown', blocked: true });
  const name = licenseName(id, licenseVersion); const details = []; const restrictions = [...(d.restrictions || [])]; let level = d.attribution ? 'credit' : 'ok'; let blocked = false; let summary; let reason = null;
  const audio = kind === 'music' || kind === 'sfx';
  if (id === 'cc0') summary = 'The creator waived their rights (CC0): free for any use, no credit needed. FrameCut cannot verify who owns it.';
  else if (id === 'pdm') summary = 'Marked as public domain by the source: free for any use, no credit needed. FrameCut cannot verify that claim.';
  else if (id === 'mit') summary = 'MIT license: free for any use, including commercially, no credit needed. FrameCut carries the required copyright notice for you.';
  else if (id === 'pixabay') summary = 'Pixabay Content License: free for commercial and personal use, no credit needed.';
  else summary = `${name}: the creator must be credited — FrameCut writes the credit for you.`;
  if (d.sa) { level = 'caution'; reason = 'share-alike'; details.push('Share-alike: if your video counts as an adaptation, it may need to be shared under the same license.'); }
  if (d.caution) { level = 'caution'; reason = 'sampling'; details.push(d.caution); }
  if (!d.adapt) {
    if (audio) { level = 'blocked'; blocked = true; reason = 'no-derivatives'; summary = `${name}: “No derivatives”. Putting this ${kind === 'music' ? 'music' : 'sound'} under video counts as an adaptation, which this license does not allow.`; }
    else { level = 'caution'; reason = 'no-derivatives'; details.push('No derivatives: use it unmodified (no cropping, recoloring or editing).'); }
  }
  if (!d.commercial) {
    reason = 'non-commercial'; restrictions.unshift('Personal, non-commercial videos only.');
    if (usage === 'commercial') { level = 'blocked'; blocked = true; summary = `${name}: non-commercial only. This project is set to commercial or monetized use.`; }
    else { if (level !== 'blocked') level = 'caution'; details.push('Non-commercial only — you cannot use it in monetized, sponsored or client videos.'); }
  } else restrictions.unshift('Commercial and personal use allowed.');
  if (d.attribution && !blocked) details.unshift('Credit required — FrameCut adds it to your credits automatically.');
  return out(level, { reason, name, summary, details, restrictions, commercial: d.commercial, storage: true, export: !blocked, attribution: d.attribution, notice: !!d.notice, blocked });
}

// ---------------------------------------------------------------- discovery
// Licenses to ask Openverse for in each discovery mode (metadata-based, re-checked on import).
export function licenseFilter(usage, kind, include = 'all') {
  const free = ['cc0', 'pdm'];
  if (include === 'free') return free;
  if (include === 'credit') return [...free, 'by'];
  const ok = usage === 'commercial' ? [...free, 'by', 'by-sa', 'sampling+'] : [...free, 'by', 'by-sa', 'by-nc', 'by-nc-sa', 'sampling+', 'nc-sampling+'];
  return (kind === 'music' || kind === 'sfx') ? ok : [...ok, 'by-nd', ...(usage === 'commercial' ? [] : ['by-nc-nd'])];
}
export const openverseLicenseFilter = (usage, kind, include = 'all') => licenseFilter(usage, kind, include);
// Does an assessed item belong in the library view for this discovery mode?
export const discoverable = (rights, include = 'free') => !rights.blocked && (rights.tier === 'free' || (rights.tier === 'credit' && include !== 'free') || (rights.tier === 'restricted' && include === 'all'));
// Tier of a provider whose catalog has a single license (null when it varies per item).
export const providerTier = id => (PROVIDERS[id]?.license ? assessRights({ provider: id, license: PROVIDERS[id].license.id, kind: 'sticker' }).tier : null);

// ---------------------------------------------------------------- credits
const KIND_TITLES = { music: 'Music', sfx: 'Sound effects', sticker: 'Stickers & graphics', other: 'Other media' };
const kindGroup = k => (KIND_TITLES[k] ? k : 'other');
const shortUrl = u => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const MIT_NOTICE = holder => `Copyright (c) ${holder || 'the copyright holder'}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

// Does this source need anything in the credits (attribution or a license notice)?
export const needsCredit = src => !!src && src.provider !== 'local' && !!(LICENSES[String(src.license || PROVIDERS[src.provider]?.license?.id || '').toLowerCase()]?.attribution);
// Structured credit for one source: everything a credit line or notice can be built from.
export function creditEntry(src) {
  const id = String(src.license || PROVIDERS[src.provider]?.license?.id || '').toLowerCase();
  const holder = src.holder || PROVIDERS[src.provider]?.license?.holder || null;
  return {
    key: src.provider + ':' + src.sourceId, kind: kindGroup(src.kind), title: src.title || 'Untitled', creator: src.creator || null, creatorUrl: src.creatorUrl || null,
    source: src.sourceName || PROVIDERS[src.provider]?.name || null, sourceUrl: src.sourcePageUrl || null, license: id, licenseName: licenseName(id, src.licenseVersion),
    licenseUrl: licenseUrlFor(id, src.licenseVersion) || src.licenseUrl || PROVIDERS[src.provider]?.license?.url || null, holder, notice: id === 'mit' ? MIT_NOTICE(holder) : null,
    cc: !!LICENSES[id]?.cc, verifiedAt: src.licenseRecord?.checkedAt || src.metadataCheckedAt || null, evidenceUrl: src.licenseRecord?.evidenceUrl || src.licenseEvidenceUrl || null,
  };
}
// One credit line per source (assets used more than once are listed once).
export function creditLine(src) {
  if (!src) return '';
  if (src.attribution && licenseInText(src.attribution)) return src.attribution.replace(/\s+To view a (copy|terms)[^]*$/i, '').trim().replace(/\.$/, '') + (src.licenseUrl ? ` (${src.licenseUrl})` : '') + (src.sourcePageUrl ? ` — ${src.sourcePageUrl}` : '');
  const e = creditEntry(src); const by = e.creator ? ` by ${e.creator}` : '';
  if (e.license === 'mit') return `“${e.title}”${by} — MIT${e.holder ? `, © ${e.holder}` : ''}${e.licenseUrl ? ` (${e.licenseUrl})` : ''}`;
  return `“${e.title}”${by} is licensed under ${e.licenseName}${e.licenseUrl ? ` (${e.licenseUrl})` : ''}${e.sourceUrl ? ` — ${e.sourceUrl}` : ''}`;
}
const uniqueSources = sources => { const seen = new Set(), out = []; for (const s of sources) { if (!s) continue; const k = s.provider + ':' + s.sourceId; if (!seen.has(k)) { seen.add(k); out.push(s); } } return out; };

// Credits in the format each destination needs:
//   youtube — full lines with links, grouped (descriptions allow 5,000 characters, links are clickable)
//   social  — compact lines for TikTok / Reels / Shorts captions (short limits, links not clickable)
//   text    — the credits file saved next to the export: full lines, required license notices, evidence
//   sequence — the on-screen credits roll added to the end of the video
// `notices`: sources whose license notice FrameCut carries at app level (e.g. MIT) — text file only.
export function creditsFor(sources, { projectName, format = 'youtube', date = new Date(), notices = [] } = {}) {
  const list = uniqueSources(sources);
  const noticeBlock = extra => [...new Set(extra.filter(e => e.notice).map(e => `--- ${e.holder || e.title} (${e.licenseName}) ---\n${e.notice}`))].join('\n\n');
  if (!list.length) {
    const ns = format === 'text' ? noticeBlock(uniqueSources(notices).map(creditEntry)) : '';
    return ns ? `${projectName ? projectName + ' — ' : ''}License notices\n\nNo credits are required for this video. These open-source notices are included for completeness:\n\n${ns}\n` : '';
  }
  const entries = list.map(s => ({ src: s, e: creditEntry(s) }));
  const groups = Object.keys(KIND_TITLES).map(k => [k, entries.filter(x => x.e.kind === k)]).filter(([, xs]) => xs.length);
  const edited = entries.some(x => x.e.cc);
  const via = [...new Set(list.map(s => PROVIDERS[s.provider]?.name).filter(Boolean))];
  if (format === 'social') {
    const lines = entries.map(({ e }) => `${KIND_TITLES[e.kind].replace(/ &.*/, '')}: “${e.title}”${e.creator ? ' by ' + e.creator : ''} (${e.licenseName}${e.licenseUrl ? ' ' + shortUrl(e.licenseUrl) : ''})`);
    return `Credits: ${lines.join(' · ')}${edited ? ' · Edited for this video.' : ''}`;
  }
  if (format === 'sequence') {
    const out = ['Credits'];
    for (const [k, xs] of groups) { out.push('', KIND_TITLES[k]); for (const { e } of xs) out.push(`“${e.title}”${e.creator ? ' by ' + e.creator : ''}`, `${e.licenseName}${e.holder && e.license === 'mit' ? ' · © ' + e.holder : ''}${e.licenseUrl ? ' · ' + shortUrl(e.licenseUrl) : ''}`); }
    if (edited) out.push('', 'Works were trimmed or edited for this video.');
    return out.join('\n');
  }
  const head = `${projectName ? projectName + ' — ' : ''}Credits`;
  const body = groups.map(([k, xs]) => (groups.length > 1 ? KIND_TITLES[k] + '\n' : '') + xs.map(({ src }) => '• ' + creditLine(src)).join('\n')).join('\n\n');
  const foot = (edited ? 'Works were trimmed, faded or mixed for this video.\n' : '') + `Found with ${via.join(' and ')} in FrameCut Studio.`;
  if (format !== 'text') return `${head}\n\n${body}\n\n${foot}\n`;
  const nb = noticeBlock([...entries.map(x => x.e), ...uniqueSources(notices).map(creditEntry)]);
  const evidence = entries.map(({ e }) => `• ${e.title}: ${e.licenseName}${e.verifiedAt ? `, checked ${String(e.verifiedAt).slice(0, 10)}` : ''}${e.evidenceUrl ? ` — ${e.evidenceUrl}` : ''}`);
  return `${head}\n\n${body}\n\n${foot}\n${nb ? `\nLicense notices\n\n${nb}\n` : ''}\nLicense records (generated ${date.toISOString().slice(0, 10)})\n${evidence.join('\n')}\n`;
}
export const creditsText = (sources, opts = {}) => creditsFor(sources, { ...opts, format: 'youtube' });

// Open-source notices FrameCut carries at application level for its default libraries.
export const APP_NOTICES = Object.values(PROVIDERS).filter(p => p.enabled && p.license && LICENSES[p.license.id]?.notice).map(p => ({ provider: p.id, name: p.name, license: licenseName(p.license.id), url: p.license.url, text: p.license.id === 'mit' ? MIT_NOTICE(p.license.holder) : null }));

// ---------------------------------------------------------------- project records
// Attribution records live in the project file, so credits survive moving the project or losing the
// library index. Keys are provider:sourceId; each record lists the project media that use it.
const RECORD_FIELDS = ['provider', 'sourceId', 'kind', 'title', 'creator', 'creatorUrl', 'sourcePageUrl', 'sourceName', 'license', 'licenseVersion', 'licenseUrl', 'attribution', 'holder', 'licenseEvidenceUrl', 'metadataCheckedAt', 'importedAt', 'licenseRecord'];
export function recordAttribution(p, mediaId, src) {
  if (!src || !src.provider || src.provider === 'local' || !src.sourceId) return null;
  p.attributions ||= {}; const key = src.provider + ':' + src.sourceId; const prev = p.attributions[key];
  const rec = { ...(prev || {}), ...Object.fromEntries(RECORD_FIELDS.filter(k => src[k] !== undefined && src[k] !== null).map(k => [k, src[k]])), mediaIds: [...new Set([...(prev?.mediaIds || []), mediaId].filter(Boolean))] };
  p.attributions[key] = rec; return rec;
}
export const attributionFor = (p, mediaId) => Object.values(p?.attributions || {}).find(r => r.mediaIds?.includes(mediaId)) || null;

// ---------------------------------------------------------------- export check
// Export preflight over the clips that are actually on the timeline (within `range` when given).
// sourceOf(mediaId) returns the asset's provenance record (or null for own files); the project's own
// attribution records fill in when the library no longer knows the asset.
export function preflight(project, sourceOf, { range = null } = {}) {
  const usage = project.usageMode === 'personal' ? 'personal' : 'commercial';
  const items = new Map();
  for (const c of project.clips) {
    if (range && (c.start >= range.to || c.start + c.duration <= range.from)) continue;
    const id = c.mediaId || (c.sticker?.type === 'media' ? c.sticker.mediaId : null); if (!id) continue;
    const src = sourceOf(id) || attributionFor(project, id); if (!src || src.provider === 'local') continue;
    const key = src.provider + ':' + src.sourceId; if (items.has(key)) { items.get(key).clips++; continue; }
    const r = assessRights({ provider: src.provider, license: src.license, licenseVersion: src.licenseVersion, kind: src.kind, usage, verification: src.licenseRecord || null });
    items.set(key, { key, mediaId: id, source: src, rights: r, clips: 1, credit: needsCredit(src) });
  }
  const list = [...items.values()];
  const creditSources = list.filter(i => i.credit).map(i => i.source);
  const noticeSources = list.filter(i => i.rights.notice).map(i => i.source);
  return {
    usage, items: list, blocked: list.filter(i => i.rights.blocked), caution: list.filter(i => i.rights.level === 'caution'), free: list.filter(i => i.rights.tier === 'free'),
    creditSources, noticeSources, credits: creditsFor(creditSources, { projectName: project.name, format: 'youtube' }),
    sequence: creditSources.length ? creditsFor(creditSources, { format: 'sequence' }) : '',
  };
}

// Where an export is going, and what that destination can carry.
export const DESTINATIONS = {
  youtube: { name: 'YouTube', limit: 5000, description: true, links: true, video: true, format: 'youtube' },
  social: { name: 'TikTok, Reels or Shorts', limit: 2200, description: true, links: false, video: true, format: 'social' },
  file: { name: 'a video file', limit: null, description: false, links: false, video: true, format: 'text' },
  gif: { name: 'a GIF', limit: null, description: false, links: false, video: true, format: 'text' },
  audio: { name: 'an audio file', limit: null, description: false, links: false, video: false, format: 'text' },
};
export const destinationFor = ({ preset, format } = {}) => (['mp3', 'wav', 'm4a', 'flac', 'ogg'].includes(format) ? 'audio' : format === 'gif' ? 'gif' : /^youtube/.test(preset || '') ? 'youtube' : ['tiktok', 'instagram'].includes(preset) ? 'social' : 'file');

// Can the required credits reach viewers through this export? Never silently drops a requirement:
// `ok` is false until at least one delivery method is in place.
//   sequence: { present, inRange, current }   copied: credits were copied for a description
export function creditDelivery(pf, { destination = 'file', saveFile = false, copied = false, sequence = {} } = {}) {
  const n = pf.creditSources.length; const d = DESTINATIONS[destination] || DESTINATIONS.file;
  if (!n) return { needed: 0, ok: true, methods: [], warnings: [], format: d.format };
  const methods = []; const warnings = [];
  const text = creditsFor(pf.creditSources, { format: d.format });
  const video = sequence.present && sequence.inRange !== false && sequence.current !== false;
  if (video) methods.push('video');
  if (d.description && copied) methods.push('description');
  if (saveFile) methods.push('file');
  if (sequence.present && sequence.current === false) warnings.push({ level: 'warn', code: 'sequence-stale', text: 'The credits at the end of the video are out of date. Update them so every asset is named.' });
  if (sequence.present && sequence.inRange === false) warnings.push({ level: 'warn', code: 'sequence-outside', text: 'The credits sequence is outside the part you are exporting, so it won’t be in this file.' });
  if (!d.video) warnings.push({ level: video || saveFile ? 'info' : 'warn', code: 'no-screen', text: `${d.name[0].toUpperCase() + d.name.slice(1)} can’t show credits on screen. Publish the credits text wherever you share it.` });
  else if (!d.description && !video) warnings.push({ level: 'warn', code: 'no-description', text: `${d.name[0].toUpperCase() + d.name.slice(1)} usually travels without a description. Add the credits sequence so the credit stays with the video.` });
  if (d.limit && text.length > d.limit) warnings.push({ level: 'warn', code: 'too-long', text: `The credits are ${text.length.toLocaleString()} characters — over ${d.name}’s ${d.limit.toLocaleString()}-character description limit. Add the credits sequence to the video${d.format === 'youtube' ? '' : ' or shorten other caption text'}.` });
  if (d.description && !d.links) warnings.push({ level: 'info', code: 'no-links', text: `Links in ${d.name} captions aren’t clickable, so the short credits name each license with its web address.` });
  if (!methods.length) warnings.unshift({ level: 'error', code: 'undelivered', text: `${n} asset${n > 1 ? 's need' : ' needs'} a credit. Copy the credits for your description, save the credits file, or add the credits sequence before exporting.` });
  return { needed: n, ok: methods.length > 0, methods, warnings, format: d.format, text };
}
