// Discovery labels are explicit search lenses, never invented popularity or genre metadata.
export const AUDIO_DISCOVERY = {
  moods: [
    ['funny', 'Goofy & funny', 'quirky', 'smile'],
    ['uplifting', 'Happy & uplifting', 'uplifting', 'sunrise'],
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
    ['synthwave', 'Synthwave', 'synthwave', 'waves'], ['chiptune', 'Chiptune & 8-bit', 'chiptune', 'gamepad'],
    ['lofi', 'Lo-fi', 'lo-fi', 'coffee'], ['hiphop', 'Hip-hop', 'hip hop', 'disc'],
    ['rock', 'Rock', 'rock', 'guitar'], ['orchestral', 'Orchestral', 'orchestral', 'music'],
    ['ambient', 'Ambient', 'ambient', 'cloud'], ['acoustic', 'Acoustic', 'acoustic', 'guitar'],
    ['jazz', 'Jazz', 'jazz', 'music'], ['classical', 'Classical', 'classical', 'piano'],
    ['pop', 'Pop', 'pop music', 'music'], ['funk', 'Funk', 'funk', 'disc'],
    ['blues', 'Blues', 'blues music', 'guitar'], ['country', 'Country', 'country music', 'guitar'],
    ['folk', 'Folk', 'folk music', 'guitar'], ['reggae', 'Reggae', 'reggae', 'disc'],
    ['metal', 'Metal', 'metal music', 'guitar'], ['world', 'World', 'world music', 'globe'],
    ['soul', 'Soul', 'soul music', 'music'], ['rnb', 'R&B', 'rnb', 'disc'],
  ],
  purposes: [
    ['comedy', 'Comedy & silly edits', 'quirky', 'smile'],
    ['background', 'Background music', 'background', 'layers'], ['vlogs', 'Vlogs', 'upbeat', 'camera'],
    ['gaming', 'Gaming', 'gaming', 'gamepad'], ['tutorial', 'Tutorials', 'calm', 'book'],
    ['intro', 'Intros & outros', 'intro', 'play'], ['trailer', 'Trailers', 'trailer', 'film'],
    ['shorts', 'Short-form', 'upbeat', 'phone'], ['documentary', 'Documentary', 'ambient', 'globe'],
    ['timelapse', 'Timelapses', 'electronic', 'clock'],
  ],
};
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
export function canonicalAudioUrl(url) { try { const u = new URL(url); return (u.hostname + decodeURIComponent(u.pathname)).toLowerCase(); } catch { return ''; } }
