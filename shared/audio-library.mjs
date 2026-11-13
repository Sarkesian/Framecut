// Discovery labels are explicit search lenses, never invented popularity or genre metadata.
// Each entry: [id, title, search words, icon]. The search words are what a source without labels of its own is asked for.
export const AUDIO_DISCOVERY = {
  moods: [
    ['funny', 'Goofy & funny', 'funny', 'smile'],
    ['uplifting', 'Happy & uplifting', 'happy', 'sunrise'],
    ['calm', 'Calm & relaxing', 'calm', 'water'],
    ['dramatic', 'Dramatic', 'dramatic', 'mountains'],
    ['emotional', 'Emotional', 'emotional', 'heart'],
    ['energetic', 'Energetic', 'energetic', 'bolt'],
    ['suspense', 'Dark & suspenseful', 'suspense', 'moon'],
    ['inspiring', 'Inspirational', 'inspirational', 'stars'],
    ['playful', 'Playful', 'playful', 'shapes'],
  ],
  genres: [
    ['cinematic', 'Cinematic', 'cinematic', 'film'], ['electronic', 'Electronic', 'electronic', 'waves'],
    ['techno', 'Techno', 'techno', 'waves'], ['trance', 'Trance', 'trance', 'waves'],
    ['house', 'House', 'house music', 'waves'], ['edm', 'Dance & EDM', 'edm', 'waves'],
    ['dnb', 'Drum & bass', 'drum and bass', 'disc'], ['dubstep', 'Dubstep', 'dubstep', 'waves'],
    ['chiptune', 'Chiptune & 8-bit', 'chiptune', 'gamepad'],
    ['lofi', 'Lo-fi', 'lo-fi', 'coffee'], ['hiphop', 'Hip-hop', 'hip hop', 'disc'],
    ['rock', 'Rock', 'rock', 'guitar'], ['orchestral', 'Orchestral', 'orchestral', 'music'],
    ['ambient', 'Ambient', 'ambient', 'cloud'], ['acoustic', 'Acoustic', 'acoustic', 'guitar'],
    ['piano', 'Piano', 'piano', 'piano'],
    ['jazz', 'Jazz', 'jazz', 'music'], ['classical', 'Classical', 'classical', 'piano'],
    ['pop', 'Pop', 'pop music', 'music'], ['funk', 'Funk', 'funk', 'disc'],
    ['blues', 'Blues', 'blues music', 'guitar'], ['country', 'Country', 'country music', 'guitar'],
    ['folk', 'Folk', 'folk music', 'guitar'], ['reggae', 'Reggae', 'reggae', 'disc'],
    ['latin', 'Latin', 'latin', 'globe'],
    ['metal', 'Metal', 'metal music', 'guitar'], ['world', 'World', 'world music', 'globe'],
    ['soul', 'Soul & R&B', 'soul music', 'music'],
    ['horror', 'Horror & spooky', 'horror', 'moon'], ['holiday', 'Holiday', 'christmas', 'stars'],
  ],
  purposes: [
    ['comedy', 'Comedy & silly edits', 'comedy', 'smile'],
    ['background', 'Background music', 'background', 'layers'], ['vlogs', 'Vlogs', 'upbeat', 'camera'],
    ['gaming', 'Gaming', 'video game', 'gamepad'], ['tutorial', 'Tutorials', 'calm', 'book'],
    ['intro', 'Intros & outros', 'intro', 'play'], ['trailer', 'Trailers', 'trailer', 'film'],
    ['shorts', 'Short-form', 'upbeat', 'phone'], ['documentary', 'Documentary', 'ambient', 'globe'],
    ['timelapse', 'Timelapses', 'electronic', 'clock'],
  ],
};
// How a lens maps onto the labels two catalogs publish themselves, so a category is answered from real genre
// and mood data where that exists instead of a word search:
//   cc     ccMixter uploader tag (counted on 11 November 2026, see docs/library-sources.md); ccq: words to search there instead
//   feel   Incompetech "feel" labels          genre   Incompetech genre names
//   inc: false   leave Incompetech out (its only matches would be title coincidences, like "This House" for house music)
//   ov     words for the song catalog (Jamendo), where a plain genre word works better than "… music"
// A lens with no entry for a source is answered there with its search words.
// Lenses that came back thin when every one was checked against the live sources were dropped (Synthwave: 6
// tracks in all) or merged (R&B, 8 tracks, into Soul).
export const AUDIO_LENSES = {
  funny: { feel: ['Humorous'], cc: 'funny' }, uplifting: { feel: ['Uplifting', 'Bright'], cc: 'happy' }, calm: { feel: ['Calming', 'Relaxed'], cc: 'chill' },
  dramatic: { feel: ['Epic', 'Intense'] }, emotional: { feel: ['Somber', 'Mystical'], cc: 'sad' }, energetic: { feel: ['Driving', 'Action'], cc: 'upbeat' },
  suspense: { feel: ['Suspenseful', 'Eerie', 'Unnerving'], cc: 'dark' }, inspiring: { feel: ['Uplifting'] }, playful: { feel: ['Bouncy'] },
  cinematic: { genre: ['Soundtrack'], cc: 'music_for_film' }, electronic: { genre: ['Electronica'], cc: 'electronic' }, techno: { cc: 'techno' }, trance: { cc: 'trance' }, house: { cc: 'house', ov: 'house', inc: false },
  edm: { cc: 'dance', ov: 'dance' }, dnb: { cc: 'dnb', inc: false }, dubstep: { cc: 'dubstep' }, lofi: { cc: 'lofi', ov: 'lofi' }, hiphop: { genre: ['Urban'], cc: 'hip_hop' }, rock: { genre: ['Rock'], cc: 'rock' },
  orchestral: { genre: ['Classical'], cc: 'orchestral' }, ambient: { cc: 'ambient' }, acoustic: { cc: 'acoustic' }, piano: { cc: 'piano' }, jazz: { genre: ['Jazz'], cc: 'jazz' }, classical: { genre: ['Classical'], cc: 'classical' },
  pop: { genre: ['Pop'], cc: 'pop', ov: 'pop' }, funk: { genre: ['Funk', 'Disco'], cc: 'funk' }, blues: { genre: ['Blues'], cc: 'blues', ov: 'blues' }, country: { cc: 'country', ov: 'country' }, folk: { cc: 'folk', ov: 'folk' }, reggae: { genre: ['Reggae', 'Ska'], cc: 'reggae' },
  latin: { genre: ['Latin'], cc: 'latin' }, metal: { cc: 'heavy_metal', ov: 'metal', inc: false }, world: { genre: ['World', 'African'], cc: 'world', ov: 'world' }, soul: { cc: 'soul', ov: 'soul', inc: false }, horror: { genre: ['Horror'] }, holiday: { genre: ['Holiday'], cc: 'christmas' },
  comedy: { feel: ['Humorous'], genre: ['Silent Film Score', 'Polka'], cc: 'funny' }, background: { feel: ['Relaxed'], cc: 'music_for_video' }, vlogs: { feel: ['Bright', 'Bouncy'], cc: 'upbeat' }, gaming: { feel: ['Action'], ccq: 'game', ov: 'game' },
  tutorial: { feel: ['Calming'], cc: 'downtempo' }, intro: { genre: ['Stings'] }, trailer: { feel: ['Epic'], ccq: 'epic' }, shorts: { feel: ['Bouncy', 'Driving'], cc: 'upbeat' }, documentary: { feel: ['Mysterious'], cc: 'ambient' }, timelapse: { genre: ['Electronica'], cc: 'electronic' },
};
// Sound-effect categories as an editor thinks of them. Each is answered by every source that has something for
// it: SFX Kit's own categories (kit), an SFXMint category (mint) and a Freesound search (q).
export const SFX_CATEGORIES = [
  ['transitions', 'Whooshes & transitions', { kit: ['whooshes', 'swishes-and-zips', 'swipes', 'reverse-whooshes'], mint: 'transition', q: 'whoosh' }],
  ['risers', 'Risers & build-ups', { kit: ['risers-and-fallers'], q: 'riser' }],
  ['impacts', 'Impacts & hits', { kit: ['impacts', 'cinematic-hits', 'booms-and-bass'], mint: 'impact', q: 'impact hit' }],
  ['pops', 'Pops & movement', { kit: ['pops', 'appear-and-vanish', 'shape-changes', 'bounce-spin-zoom'], q: 'pop' }],
  ['ui', 'Clicks & interface', { kit: ['interface', 'digital', 'data'], mint: 'ui', q: 'click' }],
  ['notifications', 'Notifications & alerts', { kit: ['notifications', 'tones', 'phone'], mint: 'feedback', q: 'notification' }],
  ['typing', 'Typing & writing', { kit: ['keyboard', 'writing-and-drawing'], mint: 'office', q: 'typing' }],
  ['logos', 'Logo stings & sparkle', { kit: ['logo-stings', 'shimmers', 'celebration'], q: 'sparkle' }],
  ['cartoon', 'Cartoon & funny', { mint: 'cartoon', q: 'cartoon' }],
  ['foley', 'Foley & everyday', { kit: ['foley', 'everyday-props', 'mechanical', 'time', 'money'], mint: 'household', q: 'foley' }],
  ['footsteps', 'Footsteps', { mint: 'footsteps', q: 'footsteps' }],
  ['doors', 'Doors', { mint: 'door', q: 'door' }],
  ['nature', 'Nature & weather', { mint: 'ambience', q: 'rain' }],
  ['water', 'Water', { mint: 'water', q: 'water splash' }],
  ['animals', 'Animals', { mint: 'animal', q: 'animal' }],
  ['crowd', 'Crowds & applause', { mint: 'crowd', q: 'applause' }],
  ['people', 'Voices & reactions', { mint: 'human', q: 'laugh' }],
  ['vehicles', 'Vehicles', { mint: 'vehicle', q: 'car' }],
  ['scifi', 'Magic & sci-fi', { mint: 'magic-scifi', q: 'sci-fi' }],
  ['horror', 'Horror & suspense', { mint: 'horror', q: 'horror' }],
  ['retro', 'Retro games', { mint: 'retro-game', q: '8-bit' }],
  ['fire', 'Fire & electricity', { mint: 'fire-electric', q: 'fire' }],
  ['glass', 'Glass & breaking', { mint: 'glass', q: 'glass break' }],
  ['instruments', 'Drums & instrument hits', { mint: 'instrument', q: 'drum hit' }],
];
export const sfxCategory = id => { const c = SFX_CATEGORIES.find(x => x[0] === id); return c ? { id: c[0], title: c[1], ...c[2] } : null; };
export const lensById = id => { for (const g of Object.values(AUDIO_DISCOVERY)) { const l = g.find(x => x[0] === id); if (l) return { id, title: l[1], query: l[2], ...(AUDIO_LENSES[id] || {}) }; } return null; };
const MUSICAL = /\b(music|musical|song|soundtrack|instrumental|melod(?:y|ic)|piano|guitar|orchestr(?:a|al)|jazz|synth(?:esizer)?|cinematic|lo[ -]?fi|hip[ -]?hop|techno|electronic|acoustic|classical|drum|beat|bass|composition|chord|violin|flute|cello)\b/i;
const SPOKEN = /\b(spoken[ -]?word|speech|speaking|podcast|interview|lecture|audiobook|news[ -]?report|sermon|language[ -]?lesson|radio[ -]?show)\b/i;
export function musicEvidence({ title = '', tags = [], genres = [], description = '', category = '' } = {}) {
  if (SPOKEN.test(title + ' ' + tags.join(' '))) return [];
  const fields = [title, ...tags, ...genres, category === 'music' ? '' : category, description];
  const text = fields.join(' ');
  // An instrument name or "electronic" alone can describe a single sound effect.
  if (!/\b(music|musical|song|soundtrack|instrumental|melody|melodic|composition|orchestra|orchestral|jazz|classical|lo[ -]?fi|hip[ -]?hop|techno)\b/i.test(text) && !(/\b(loop|rhythm|groove|beat|chord|arpeggiator)\b/i.test(text) && MUSICAL.test(text))) return [];
  if (/\b(harsh|noise|bubbling|sound[ -]?effect)\b/i.test(title + ' ' + tags.join(' ')) && !/\b(music|song|melody|melodic|instrumental)\b/i.test(title + ' ' + tags.join(' '))) return [];
  return [...new Set(fields.flatMap(s => String(s).match(new RegExp(MUSICAL.source, 'ig')) || []).map(s => s.toLowerCase()))].slice(0, 8);
}
export const matchesDuration = (ms, length) => {
  if (!length) return true; if (!Number.isFinite(ms) || ms <= 0) return false;
  return ({ short: ms < 10000, medium: ms >= 10000 && ms < 60000, long: ms >= 60000, clip: ms < 60000, song: ms >= 60000 })[length] ?? true;
};
export const plain = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
// One key per audio file, for dropping the same file listed by two sources. The query string is part of it:
// Jamendo addresses every track as "/?trackid=…", so without it a whole page of Jamendo music looked like one
// file and all but the first track were dropped from combined results.
export function canonicalAudioUrl(url) { try { const u = new URL(url); u.searchParams.sort(); return (u.hostname + decodeURIComponent(u.pathname) + u.search).toLowerCase(); } catch { return ''; } }
