// Discovery labels are explicit search lenses, never invented popularity or genre metadata.
export const AUDIO_DISCOVERY = {
  moods: [
    ['uplifting', 'Happy & uplifting', 'happy uplifting music', 'sunrise'],
    ['calm', 'Calm & relaxing', 'calm ambient music', 'water'],
    ['dramatic', 'Dramatic', 'dramatic cinematic music', 'mountains'],
    ['emotional', 'Emotional', 'emotional piano music', 'heart'],
    ['energetic', 'Energetic', 'energetic music', 'bolt'],
    ['suspense', 'Dark & suspenseful', 'dark suspense music', 'moon'],
    ['inspiring', 'Inspirational', 'inspiring instrumental music', 'stars'],
    ['playful', 'Playful', 'playful music', 'shapes'],
  ],
  genres: [
    ['cinematic', 'Cinematic', 'cinematic', 'film'], ['electronic', 'Electronic', 'electronic', 'waves'],
    ['lofi', 'Lo-fi', 'lofi', 'coffee'], ['hiphop', 'Hip-hop', 'hip hop beat', 'disc'],
    ['rock', 'Rock', 'rock instrumental', 'guitar'], ['orchestral', 'Orchestral', 'orchestral', 'music'],
    ['ambient', 'Ambient', 'ambient', 'cloud'], ['acoustic', 'Acoustic', 'acoustic', 'guitar'],
    ['jazz', 'Jazz', 'jazz', 'music'], ['classical', 'Classical', 'classical music', 'piano'],
  ],
  purposes: [
    ['background', 'Background music', 'background instrumental', 'layers'], ['vlogs', 'Vlogs', 'acoustic upbeat', 'camera'],
    ['gaming', 'Gaming', 'electronic game music', 'gamepad'], ['tutorial', 'Tutorials', 'calm background music', 'book'],
    ['intro', 'Intros & outros', 'intro music', 'play'], ['trailer', 'Trailers', 'trailer cinematic', 'film'],
    ['shorts', 'Short-form', 'upbeat music', 'phone'], ['documentary', 'Documentary', 'documentary ambient', 'globe'],
    ['timelapse', 'Timelapses', 'ambient electronic', 'clock'],
  ],
};
const MUSICAL = /\b(music|musical|song|soundtrack|instrumental|melod(?:y|ic)|piano|guitar|orchestr(?:a|al)|jazz|synth(?:esizer)?|cinematic|lo[ -]?fi|hip[ -]?hop|techno|electronic|acoustic|classical|drum|beat|bass|composition|chord|violin|flute|cello)\b/i;
const SPOKEN = /\b(spoken[ -]?word|speech|speaking|podcast|interview|lecture|audiobook|news[ -]?report|sermon|language[ -]?lesson|radio[ -]?show)\b/i;
export function musicEvidence({ title = '', tags = [], genres = [], description = '', category = '' } = {}) {
  if (SPOKEN.test(title + ' ' + tags.join(' '))) return [];
  const fields = [title, ...tags, ...genres, category, description];
  return [...new Set(fields.flatMap(s => String(s).match(new RegExp(MUSICAL.source, 'ig')) || []).map(s => s.toLowerCase()))].slice(0, 8);
}
export const matchesDuration = (ms, length) => {
  if (!length) return true; if (!Number.isFinite(ms) || ms <= 0) return false;
  return ({ short: ms < 10000, medium: ms >= 10000 && ms < 60000, long: ms >= 60000, clip: ms < 60000, song: ms >= 60000 })[length] ?? true;
};
export const plain = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
export function canonicalAudioUrl(url) { try { const u = new URL(url); return (u.hostname + decodeURIComponent(u.pathname)).toLowerCase(); } catch { return ''; } }
