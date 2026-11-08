// Starter templates. Project templates set up format, titles, captions style and looks;
// text templates insert ready-made, animated title combinations.
import { newProject, newClip } from './model.mjs';
import { TEXT_STYLE, CAPTION_STYLE } from './catalog.mjs';

const T = (props) => newClip('text', props);
export const TEXT_TEMPLATES = [
  { id: 'headline', name: 'Headline', items: [{ text: 'BIG HEADLINE', style: { size: 0.12, uppercase: true, shadowOpacity: 0.7, letterSpacing: 0.02 }, animIn: { id: 'pop', duration: 0.45 }, animOut: { id: 'fade', duration: 0.35 } }] },
  { id: 'lower-third', name: 'Lower third', items: [
    { text: 'Alex Morgan', style: { size: 0.055, bgOpacity: 1, bgColor: '#111318', bgRadius: 0.15, align: 'left' }, transform: { x: -0.28, y: 0.3 }, animIn: { id: 'slide-right', duration: 0.4 }, animOut: { id: 'slide-left', duration: 0.3 } },
    { text: 'Creative director', style: { size: 0.036, bold: false, bgOpacity: 1, bgColor: '#b6f36a', color: '#10180a', bgRadius: 0.15, align: 'left' }, transform: { x: -0.3, y: 0.38 }, animIn: { id: 'slide-right', duration: 0.5 }, animOut: { id: 'slide-left', duration: 0.3 } },
  ] },
  { id: 'subscribe', name: 'Call to action', items: [{ text: 'Follow for more ✨', style: { size: 0.06, bgOpacity: 1, bgColor: '#ff3b5c', bgRadius: 0.6 }, transform: { y: 0.33 }, animIn: { id: 'pop', duration: 0.4 }, animLoop: { id: 'pulse' } }] },
  { id: 'quote', name: 'Quote', items: [
    { text: '“Make something\nyou are proud of.”', style: { font: 'Georgia', size: 0.07, bold: false, italic: true, color: '#f5e6c4', lineHeight: 1.25 }, animIn: { id: 'fade', duration: 0.8 }, animOut: { id: 'fade', duration: 0.6 } },
    { text: '— Your name', style: { size: 0.035, bold: false, color: '#c9ccd6', letterSpacing: 0.1 }, transform: { y: 0.14 }, animIn: { id: 'slide-up', duration: 0.8 } },
  ] },
  { id: 'neon-title', name: 'Neon sign', items: [{ text: 'OPEN LATE', style: { size: 0.11, color: '#ffd1f1', shadowColor: '#ff2bd6', shadowOpacity: 1, shadowBlur: 1.4, letterSpacing: 0.08 }, animIn: { id: 'fade', duration: 0.3 }, animLoop: { id: 'heartbeat' } }] },
  { id: 'chapter', name: 'Chapter card', items: [
    { text: 'CHAPTER ONE', style: { size: 0.035, color: '#b6f36a', letterSpacing: 0.3 }, transform: { y: -0.06 }, animIn: { id: 'fade', duration: 0.6 } },
    { text: 'The Beginning', style: { size: 0.09, font: 'Georgia', bold: false }, transform: { y: 0.03 }, animIn: { id: 'slide-up', duration: 0.7 }, animOut: { id: 'fade', duration: 0.5 } },
  ] },
  { id: 'countdown', name: 'Countdown 3-2-1', sequence: true, items: ['3', '2', '1'].map(n => ({ text: n, duration: 1, style: { size: 0.3, shadowOpacity: 0.6 }, animIn: { id: 'pop', duration: 0.3 }, animOut: { id: 'zoom', duration: 0.25 } })) },
];

export function textTemplateClips(tpl, at) {
  let t = at;
  return tpl.items.map(it => {
    const d = it.duration || 4;
    const c = T({ text: it.text, style: { ...TEXT_STYLE, ...it.style }, start: tpl.sequence ? t : at, duration: d, name: it.text.split('\n')[0].slice(0, 40), transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, ...(it.transform || {}) }, animIn: it.animIn || null, animOut: it.animOut || null, animLoop: it.animLoop || null });
    if (tpl.sequence) t += d; return c;
  });
}

export const PROJECT_TEMPLATES = [
  { id: 'blank-vertical', name: 'Vertical short', hint: 'TikTok, Reels, Shorts · 9:16', ratio: '9:16', look: null, captions: 'bold', titles: [{ tpl: 'headline', text: 'WATCH THIS', at: 0 }] },
  { id: 'vlog', name: 'Vlog', hint: 'Warm look, soft titles · 16:9', ratio: '16:9', look: 'golden', captions: 'clean', titles: [{ tpl: 'chapter', at: 0 }] },
  { id: 'cinematic', name: 'Cinematic', hint: 'Teal & orange, letterbox · 2.35:1', ratio: '2.35:1', look: 'teal-orange', vignette: true, titles: [{ tpl: 'quote', at: 0.5 }] },
  { id: 'promo', name: 'Product promo', hint: 'Bold titles and call to action · 1:1', ratio: '1:1', look: 'vivid', titles: [{ tpl: 'headline', text: 'NEW DROP', at: 0 }, { tpl: 'subscribe', text: 'Shop now →', at: 4 }] },
  { id: 'podcast', name: 'Podcast clip', hint: 'Word-highlight captions · 9:16', ratio: '9:16', captions: 'karaoke', titles: [{ tpl: 'lower-third', at: 0.5 }] },
  { id: 'slideshow', name: 'Photo slideshow', hint: 'Images with smooth transitions · 16:9', ratio: '16:9', look: 'film', slideshow: true, titles: [{ tpl: 'headline', text: 'OUR SUMMER', at: 0 }] },
];

export function projectFromTemplate(tpl, { name } = {}) {
  const p = newProject({ name: name || tpl.name, ratio: tpl.ratio });
  p.template = { id: tpl.id, captions: tpl.captions || null, slideshow: !!tpl.slideshow };
  if (tpl.look || tpl.vignette) p.tracks.unshift({ id: 'fx-1', kind: 'effect', name: 'Look' });
  for (const t of tpl.titles || []) {
    const def = TEXT_TEMPLATES.find(x => x.id === t.tpl); if (!def) continue;
    const clips = textTemplateClips(t.text ? { ...def, items: def.items.map((it, i) => (i === 0 ? { ...it, text: t.text } : it)) } : def, t.at || 0);
    for (const c of clips) {
      const free = p.tracks.find(tr => tr.kind === 'text' && !p.clips.some(o => o.trackId === tr.id && o.start < c.start + c.duration && o.start + o.duration > c.start));
      const track = free || (() => { const tr = { id: 'text-' + (p.tracks.length + 1), kind: 'text', name: 'Text ' + (p.tracks.filter(x => x.kind === 'text').length + 1) }; p.tracks.splice(p.tracks.findIndex(x => x.kind === 'text'), 0, tr); return tr; })();
      c.trackId = track.id; p.clips.push(c);
    }
  }
  if (tpl.look || tpl.vignette) p.clips.push(newClip('adjust', { trackId: 'fx-1', start: 0, duration: 10, name: 'Template look', filter: { id: tpl.look || null, intensity: 0.85 }, effects: tpl.vignette ? [{ id: 'vignette', amount: 0.45 }] : [] }));
  if (tpl.ratio === '2.35:1') p.settings.background = { type: 'black', color: '#000000', blur: 24 };
  if (tpl.captions) p.captionPreset = tpl.captions;
  return p;
}
export const CAPTION_DEFAULT = CAPTION_STYLE;
