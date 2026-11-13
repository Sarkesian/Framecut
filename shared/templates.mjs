// Starter templates. Project templates set up format, titles, captions style and looks;
// text templates insert ready-made, animated title combinations.
import { newProject, newClip } from './model.mjs';
import { TEXT_STYLE } from './catalog.mjs';

const T = (props) => newClip('text', props);
// Animated title templates, grouped by category. Each item becomes a normal text clip (grouped, so the
// whole template can be restyled later). `sequence` plays the items one after another.
const A = { fade: 'fade', pop: 'pop', rise: 'slide-up', drop: 'slide-down', left: 'slide-left', right: 'slide-right', zoom: 'zoom', spin: 'spin' };
const anim = (i, o = 'fade', di = 0.45, dout = 0.35) => ({ animIn: i ? { id: A[i], duration: di } : null, animOut: o ? { id: A[o], duration: dout } : null });
const at = (x, y) => ({ transform: { x, y } });
const pill = (bg, color = '#ffffff', r = 0.6) => ({ bgOpacity: 1, bgColor: bg, color, bgRadius: r });
export const TEMPLATE_CATEGORIES = ['Titles', 'Lower thirds', 'Social & promo', 'Quotes & callouts', 'Lists & countdowns', 'Intros & chapters'];
export const TEXT_TEMPLATES = [
  // ---- Titles
  { id: 'headline', cat: 'Titles', name: 'Headline', items: [{ text: 'BIG HEADLINE', style: { size: 0.12, uppercase: true, shadowOpacity: 0.7, letterSpacing: 0.02 }, ...anim('pop') }] },
  { id: 'impact', cat: 'Titles', name: 'Impact', items: [{ text: 'NO WAY', style: { font: 'Anton', size: 0.16, uppercase: true, strokeWidth: 0.08, strokeColor: '#000000', letterSpacing: 0.02 }, ...anim('zoom', 'zoom', 0.35, 0.25) }] },
  { id: 'cinematic', cat: 'Titles', name: 'Cinematic', items: [{ text: 'THE LONG ROAD HOME', style: { font: 'Montserrat', size: 0.05, bold: false, uppercase: true, letterSpacing: 0.42, color: '#f5e6c4' }, ...anim('fade', 'fade', 1.4, 1) }] },
  { id: 'neon-title', cat: 'Titles', name: 'Neon sign', items: [{ text: 'OPEN LATE', style: { size: 0.11, color: '#ffd1f1', shadowColor: '#ff2bd6', shadowOpacity: 1, shadowBlur: 1.4, letterSpacing: 0.08 }, ...anim('fade', 'fade', 0.3), animLoop: { id: 'heartbeat' } }] },
  { id: 'retro', cat: 'Titles', name: 'Retro arcade', items: [{ text: 'LEVEL UP!', style: { font: 'Impact', size: 0.13, color: '#ffd23f', strokeWidth: 0.12, strokeColor: '#ff3b5c', shadowOpacity: 0.8, shadowBlur: 0.2 }, ...anim('pop'), animLoop: { id: 'wiggle' } }] },
  { id: 'minimal', cat: 'Titles', name: 'Minimal', items: [{ text: 'simple things', style: { font: 'Inter', size: 0.07, bold: false, letterSpacing: 0.06 }, ...anim('rise', 'fade', 0.8, 0.5) }] },
  { id: 'boxed', cat: 'Titles', name: 'Boxed title', items: [{ text: 'Today’s topic', style: { font: 'Poppins', size: 0.08, ...pill('#ffffff', '#111318', 0.12) }, ...anim('rise') }] },
  { id: 'outline', cat: 'Titles', name: 'Outline', items: [{ text: 'OUTLINE', style: { font: 'Montserrat', size: 0.13, color: '#111318', strokeWidth: 0.1, strokeColor: '#ffffff', letterSpacing: 0.06 }, ...anim('zoom') }] },
  { id: 'kicker', cat: 'Titles', name: 'Kicker + headline', items: [
    { text: 'BREAKING', style: { size: 0.035, letterSpacing: 0.25, ...pill('#ff3b5c', '#ffffff', 0.2) }, ...at(0, -0.09), ...anim('drop') },
    { text: 'Something big happened', style: { font: 'Poppins', size: 0.075 }, ...at(0, 0.02), ...anim('rise', 'fade', 0.6) },
  ] },
  { id: 'stacked', cat: 'Titles', name: 'Stacked', items: [
    { text: 'MAKE', style: { font: 'Anton', size: 0.11, letterSpacing: 0.04 }, ...at(0, -0.13), ...anim('left', 'fade', 0.4) },
    { text: 'IT', style: { font: 'Anton', size: 0.11, color: '#b6f36a', letterSpacing: 0.04 }, ...at(0, 0), ...anim('right', 'fade', 0.55) },
    { text: 'COUNT', style: { font: 'Anton', size: 0.11, letterSpacing: 0.04 }, ...at(0, 0.13), ...anim('left', 'fade', 0.7) },
  ] },
  // ---- Lower thirds
  { id: 'lower-third', cat: 'Lower thirds', name: 'Name & role', items: [
    { text: 'Alex Morgan', style: { size: 0.055, bgOpacity: 1, bgColor: '#111318', bgRadius: 0.15, align: 'left' }, ...at(-0.28, 0.3), ...anim('right', 'left', 0.4, 0.3) },
    { text: 'Creative director', style: { size: 0.036, bold: false, bgOpacity: 1, bgColor: '#b6f36a', color: '#10180a', bgRadius: 0.15, align: 'left' }, ...at(-0.3, 0.38), ...anim('right', 'left', 0.5, 0.3) },
  ] },
  { id: 'lt-minimal', cat: 'Lower thirds', name: 'Minimal', items: [
    { text: 'Jordan Lee', style: { font: 'Inter', size: 0.05, align: 'left', shadowOpacity: 0.6 }, ...at(-0.3, 0.3), ...anim('rise', 'fade', 0.5) },
    { text: 'Product designer', style: { font: 'Inter', size: 0.032, bold: false, color: '#c9ccd6', align: 'left', shadowOpacity: 0.6 }, ...at(-0.31, 0.37), ...anim('rise', 'fade', 0.7) },
  ] },
  { id: 'lt-pill', cat: 'Lower thirds', name: 'Pill', items: [{ text: 'Sam Rivera · Host', style: { font: 'Poppins', size: 0.042, ...pill('#ff3b5c') }, ...at(-0.22, 0.34), ...anim('pop') }] },
  { id: 'lt-news', cat: 'Lower thirds', name: 'News', items: [
    { text: 'LIVE', style: { size: 0.034, letterSpacing: 0.15, ...pill('#e5252a', '#ffffff', 0.1) }, ...at(-0.4, 0.29), ...anim('pop') },
    { text: 'City council votes tonight', style: { size: 0.045, align: 'left', ...pill('#0f1115', '#ffffff', 0.05) }, ...at(-0.12, 0.29), ...anim('right', 'left', 0.5) },
  ] },
  { id: 'lt-right', cat: 'Lower thirds', name: 'Right side', items: [
    { text: 'Taylor Kim', style: { size: 0.05, align: 'right', bgOpacity: 1, bgColor: '#111318', bgRadius: 0.15 }, ...at(0.28, 0.3), ...anim('left', 'right') },
    { text: 'Chef & author', style: { size: 0.034, bold: false, align: 'right', ...pill('#ffd23f', '#111318', 0.15) }, ...at(0.3, 0.37), ...anim('left', 'right', 0.55) },
  ] },
  { id: 'lt-handle', cat: 'Lower thirds', name: 'Social handle', items: [{ text: '@yourhandle', style: { font: 'Poppins', size: 0.045, bgOpacity: 0.6, bgColor: '#000000', bgRadius: 0.5 }, ...at(-0.27, 0.35), ...anim('rise') }] },
  // ---- Social & calls to action
  { id: 'subscribe', cat: 'Social & promo', name: 'Follow for more', items: [{ text: 'Follow for more ✨', style: { size: 0.06, ...pill('#ff3b5c') }, ...at(0, 0.33), ...anim('pop'), animLoop: { id: 'pulse' } }] },
  { id: 'like-share', cat: 'Social & promo', name: 'Like & share', items: [{ text: '👍 Like & share', style: { font: 'Poppins', size: 0.058, ...pill('#3ab0ff') }, ...at(0, 0.32), ...anim('pop'), animLoop: { id: 'bounce' } }] },
  { id: 'subscribe-bell', cat: 'Social & promo', name: 'Subscribe', items: [{ text: 'SUBSCRIBE 🔔', style: { size: 0.06, letterSpacing: 0.04, ...pill('#ff0000', '#ffffff', 0.25) }, ...at(0, 0.3), ...anim('pop'), animLoop: { id: 'pulse' } }] },
  { id: 'link-bio', cat: 'Social & promo', name: 'Link in bio', items: [{ text: 'Link in bio 👇', style: { font: 'Poppins', size: 0.055, ...pill('#ffffff', '#111318') }, ...at(0, 0.3), ...anim('rise'), animLoop: { id: 'bounce' } }] },
  { id: 'comment', cat: 'Social & promo', name: 'Comment below', items: [{ text: 'Tell me in the comments 💬', style: { size: 0.048, ...pill('#a67cff') }, ...at(0, 0.32), ...anim('pop') }] },
  { id: 'follow-handle', cat: 'Social & promo', name: 'Handle + follow', items: [
    { text: '@yourname', style: { font: 'Poppins', size: 0.07 }, ...at(0, -0.04), ...anim('pop') },
    { text: 'Follow for daily tips', style: { size: 0.04, bold: false, ...pill('#ff3b5c', '#ffffff', 0.6) }, ...at(0, 0.06), ...anim('rise', 'fade', 0.6) },
  ] },
  { id: 'swipe', cat: 'Social & promo', name: 'Swipe up', items: [{ text: '⬆ Swipe up', style: { size: 0.06, shadowOpacity: 0.7 }, ...at(0, 0.36), ...anim('rise'), animLoop: { id: 'float' } }] },
  { id: 'save-this', cat: 'Social & promo', name: 'Save this', items: [{ text: 'Save this for later 📌', style: { font: 'Poppins', size: 0.05, ...pill('#ffd23f', '#111318') }, ...at(0, -0.34), ...anim('drop') }] },
  // ---- Quotes & speech
  { id: 'quote', cat: 'Quotes & callouts', name: 'Classic quote', items: [
    { text: '“Make something\nyou are proud of.”', style: { font: 'Georgia', size: 0.07, bold: false, italic: true, color: '#f5e6c4', lineHeight: 1.25 }, ...anim('fade', 'fade', 0.8, 0.6) },
    { text: '— Your name', style: { size: 0.035, bold: false, color: '#c9ccd6', letterSpacing: 0.1 }, ...at(0, 0.14), ...anim('rise', null, 0.8) },
  ] },
  { id: 'quote-modern', cat: 'Quotes & callouts', name: 'Modern quote', items: [
    { text: 'Done is better\nthan perfect.', style: { font: 'Playfair Display', italic: true, size: 0.08, bold: false, lineHeight: 1.2 }, ...anim('rise', 'fade', 0.9, 0.5) },
    { text: 'YOUR NAME', style: { font: 'Inter', size: 0.03, letterSpacing: 0.3, color: '#b6f36a' }, ...at(0, 0.15), ...anim('fade', null, 1.2) },
  ] },
  { id: 'speech', cat: 'Quotes & callouts', name: 'Speech bubble', items: [{ text: 'Wait for it…', style: { font: 'Poppins', size: 0.055, ...pill('#ffffff', '#111318', 0.5) }, ...at(0.18, -0.25), ...anim('pop'), animLoop: { id: 'float' } }] },
  { id: 'subtitle-box', cat: 'Quotes & callouts', name: 'Subtitle box', items: [{ text: 'Say something important here', style: { size: 0.045, bold: false, bgOpacity: 0.75, bgColor: '#000000', bgRadius: 0.1 }, ...at(0, 0.36), ...anim('fade', 'fade', 0.25, 0.2) }] },
  { id: 'highlight', cat: 'Quotes & callouts', name: 'Highlighter', items: [{ text: 'This changes everything', style: { font: 'Poppins', size: 0.06, ...pill('#ffe14d', '#111318', 0.08) }, ...anim('right') }] },
  { id: 'thought', cat: 'Quotes & callouts', name: 'Meanwhile', items: [{ text: 'Meanwhile… 💭', style: { font: 'Georgia', italic: true, bold: false, size: 0.065, shadowOpacity: 0.8 }, ...at(0, -0.32), ...anim('fade', 'fade', 0.6) }] },
  // ---- Lists & countdowns
  { id: 'countdown', cat: 'Lists & countdowns', name: 'Countdown 3-2-1', sequence: true, items: ['3', '2', '1'].map(n => ({ text: n, duration: 1, style: { size: 0.3, shadowOpacity: 0.6 }, ...anim('pop', 'zoom', 0.3, 0.25) })) },
  { id: 'countdown-5', cat: 'Lists & countdowns', name: 'Countdown 5', sequence: true, items: ['5', '4', '3', '2', '1', 'GO!'].map(n => ({ text: n, duration: 1, style: { font: 'Anton', size: n === 'GO!' ? 0.22 : 0.28, color: n === 'GO!' ? '#b6f36a' : '#ffffff', strokeWidth: 0.06 }, ...anim('zoom', 'fade', 0.25, 0.2) })) },
  { id: 'top-3', cat: 'Lists & countdowns', name: 'Top 3', sequence: true, items: ['#3 Your third pick', '#2 Your second pick', '#1 The winner'].map(s => ({ text: s, duration: 2.5, style: { font: 'Poppins', size: 0.065, ...pill('#111318', '#ffffff', 0.2) }, ...anim('left', 'right', 0.4, 0.3) })) },
  { id: 'steps', cat: 'Lists & countdowns', name: 'Steps', sequence: true, items: ['Step 1', 'Step 2', 'Step 3'].map(s => ({ text: s, duration: 2, style: { font: 'Montserrat', size: 0.06, letterSpacing: 0.06, ...pill('#b6f36a', '#10180a', 0.3) }, ...at(0, -0.32), ...anim('drop', 'fade', 0.4, 0.25) })) },
  { id: 'checklist', cat: 'Lists & countdowns', name: 'Checklist', items: ['✅ Plan the shot', '✅ Hit record', '✅ Share it'].map((s, i) => ({ text: s, style: { font: 'Inter', size: 0.05, align: 'left', shadowOpacity: 0.6 }, ...at(-0.2, -0.1 + i * 0.1), ...anim('right', 'fade', 0.4 + i * 0.35) })) },
  { id: 'fact', cat: 'Lists & countdowns', name: 'Did you know?', items: [
    { text: 'DID YOU KNOW?', style: { size: 0.04, letterSpacing: 0.2, color: '#ffd23f' }, ...at(0, -0.1), ...anim('drop') },
    { text: 'An interesting fact goes here', style: { size: 0.06, font: 'Poppins' }, ...at(0, 0), ...anim('rise', 'fade', 0.7) },
  ] },
  // ---- Promo & sale
  { id: 'sale', cat: 'Social & promo', name: 'Sale', items: [
    { text: 'SALE', style: { font: 'Anton', size: 0.2, color: '#ff3b5c', letterSpacing: 0.05, strokeWidth: 0.05, strokeColor: '#ffffff' }, ...at(0, -0.06), ...anim('zoom'), animLoop: { id: 'heartbeat' } },
    { text: '50% OFF', style: { size: 0.06, ...pill('#ffd23f', '#111318', 0.2) }, ...at(0, 0.1), ...anim('pop', 'fade', 0.6) },
  ] },
  { id: 'new-drop', cat: 'Social & promo', name: 'New drop', items: [
    { text: 'NEW DROP', style: { font: 'Anton', size: 0.14, letterSpacing: 0.12 }, ...anim('zoom') },
    { text: 'Available now', style: { font: 'Inter', size: 0.035, bold: false, letterSpacing: 0.2, color: '#c9ccd6' }, ...at(0, 0.11), ...anim('fade', 'fade', 0.9) },
  ] },
  { id: 'limited', cat: 'Social & promo', name: 'Limited time', items: [{ text: 'LIMITED TIME ONLY', style: { size: 0.055, letterSpacing: 0.1, ...pill('#111318', '#ffd23f', 0.1) }, ...at(0, -0.33), ...anim('drop'), animLoop: { id: 'pulse' } }] },
  { id: 'price', cat: 'Social & promo', name: 'Price tag', items: [
    { text: 'only', style: { font: 'Georgia', italic: true, bold: false, size: 0.04 }, ...at(-0.12, -0.07), ...anim('fade') },
    { text: '$29.99', style: { font: 'Montserrat', size: 0.13, color: '#b6f36a' }, ...at(0, 0.02), ...anim('pop', 'fade', 0.5) },
  ] },
  { id: 'shop-now', cat: 'Social & promo', name: 'Shop now', items: [{ text: 'Shop now →', style: { font: 'Poppins', size: 0.06, ...pill('#ffffff', '#111318') }, ...at(0, 0.32), ...anim('rise'), animLoop: { id: 'pulse' } }] },
  { id: 'discount-code', cat: 'Social & promo', name: 'Discount code', items: [
    { text: 'USE CODE', style: { size: 0.035, letterSpacing: 0.25, color: '#c9ccd6' }, ...at(0, -0.06), ...anim('fade') },
    { text: 'SAVE20', style: { font: 'Montserrat', size: 0.1, letterSpacing: 0.1, ...pill('#a67cff', '#ffffff', 0.15) }, ...at(0, 0.04), ...anim('pop', 'fade', 0.5) },
  ] },
  // ---- Labels & callouts
  { id: 'tag-new', cat: 'Quotes & callouts', name: 'NEW tag', items: [{ text: 'NEW', style: { size: 0.04, letterSpacing: 0.15, ...pill('#ff3b5c', '#ffffff', 0.3) }, ...at(-0.38, -0.38), ...anim('pop'), animLoop: { id: 'wiggle' } }] },
  { id: 'location', cat: 'Quotes & callouts', name: 'Location', items: [{ text: '📍 Lisbon, Portugal', style: { font: 'Poppins', size: 0.045, bgOpacity: 0.65, bgColor: '#000000', bgRadius: 0.5 }, ...at(-0.25, -0.36), ...anim('drop') }] },
  { id: 'date', cat: 'Quotes & callouts', name: 'Date stamp', items: [{ text: 'MON · 12 JUNE', style: { font: 'Montserrat', size: 0.035, letterSpacing: 0.3, bold: false }, ...at(0, -0.38), ...anim('fade', 'fade', 0.8) }] },
  { id: 'warning', cat: 'Quotes & callouts', name: 'Warning', items: [{ text: '⚠️ Don’t try this at home', style: { size: 0.045, ...pill('#ffd23f', '#111318', 0.15) }, ...at(0, 0.36), ...anim('pop'), animLoop: { id: 'shake' } }] },
  { id: 'look-here', cat: 'Quotes & callouts', name: 'Look here', items: [{ text: '👉 Look here', style: { font: 'Poppins', size: 0.055, shadowOpacity: 0.8 }, ...at(-0.15, 0), ...anim('right'), animLoop: { id: 'bounce' } }] },
  { id: 'pov', cat: 'Quotes & callouts', name: 'POV', items: [
    { text: 'POV:', style: { font: 'Poppins', size: 0.06, align: 'left' }, ...at(-0.3, -0.36), ...anim('fade', 'fade', 0.3) },
    { text: 'you finally tried it', style: { font: 'Poppins', size: 0.05, bold: false, align: 'left' }, ...at(-0.16, -0.29), ...anim('fade', 'fade', 0.6) },
  ] },
  { id: 'before-after', cat: 'Quotes & callouts', name: 'Before / after', items: [
    { text: 'BEFORE', style: { size: 0.045, letterSpacing: 0.15, ...pill('#111318', '#ffffff', 0.2) }, ...at(-0.25, -0.38), ...anim('drop') },
    { text: 'AFTER', style: { size: 0.045, letterSpacing: 0.15, ...pill('#b6f36a', '#10180a', 0.2) }, ...at(0.25, -0.38), ...anim('drop', 'fade', 0.6) },
  ] },
  // ---- Intros & outros
  { id: 'welcome', cat: 'Intros & chapters', name: 'Welcome back', items: [
    { text: 'Welcome back', style: { font: 'Poppins', size: 0.09 }, ...at(0, -0.03), ...anim('pop') },
    { text: 'to the channel 👋', style: { size: 0.045, bold: false }, ...at(0, 0.07), ...anim('rise', 'fade', 0.7) },
  ] },
  { id: 'thanks', cat: 'Intros & chapters', name: 'Thanks for watching', items: [
    { text: 'Thanks for watching', style: { font: 'Poppins', size: 0.08 }, ...at(0, -0.03), ...anim('fade', 'fade', 0.8, 0.6) },
    { text: 'See you next time ✌️', style: { size: 0.042, bold: false, color: '#c9ccd6' }, ...at(0, 0.07), ...anim('rise', 'fade', 1) },
  ] },
  { id: 'episode', cat: 'Intros & chapters', name: 'Episode card', items: [
    { text: 'EPISODE 01', style: { font: 'Montserrat', size: 0.035, letterSpacing: 0.35, color: '#b6f36a' }, ...at(0, -0.07), ...anim('fade', 'fade', 0.6) },
    { text: 'Your title here', style: { font: 'Montserrat', size: 0.09 }, ...at(0, 0.02), ...anim('zoom', 'fade', 0.6) },
  ] },
  { id: 'the-end', cat: 'Intros & chapters', name: 'The end', items: [{ text: 'The End', style: { font: 'Playfair Display', italic: true, bold: false, size: 0.12 }, ...anim('fade', 'fade', 1.4, 1) }] },
  { id: 'coming-up', cat: 'Intros & chapters', name: 'Coming up', items: [{ text: 'COMING UP NEXT ▶', style: { size: 0.05, letterSpacing: 0.12, ...pill('#ffffff', '#111318', 0.2) }, ...at(0, 0.34), ...anim('right', 'left') }] },
  // ---- Chapters
  { id: 'chapter', cat: 'Intros & chapters', name: 'Chapter card', items: [
    { text: 'CHAPTER ONE', style: { size: 0.035, color: '#b6f36a', letterSpacing: 0.3 }, ...at(0, -0.06), ...anim('fade', null, 0.6) },
    { text: 'The Beginning', style: { size: 0.09, font: 'Georgia', bold: false }, ...at(0, 0.03), ...anim('rise', 'fade', 0.7, 0.5) },
  ] },
  { id: 'chapter-number', cat: 'Intros & chapters', name: 'Big number', items: [
    { text: '01', style: { font: 'Anton', size: 0.2, color: '#b6f36a' }, ...at(0, -0.06), ...anim('zoom') },
    { text: 'Getting started', style: { font: 'Inter', size: 0.05 }, ...at(0, 0.1), ...anim('rise', 'fade', 0.7) },
  ] },
  { id: 'chapter-side', cat: 'Intros & chapters', name: 'Side chapter', items: [
    { text: 'PART 2', style: { size: 0.035, letterSpacing: 0.25, color: '#ffd23f', align: 'left' }, ...at(-0.3, -0.05), ...anim('right') },
    { text: 'The plan', style: { font: 'Poppins', size: 0.085, align: 'left' }, ...at(-0.28, 0.04), ...anim('right', 'fade', 0.6) },
  ] },
];

// ---------- Options applied when a template is added (Templates tab dropdowns) ----------
export const TEMPLATE_THEMES = [['original', 'Original colours'], ['white', 'Clean white'], ['lime', 'Lime', '#b6f36a'], ['pink', 'Hot pink', '#ff3b5c'], ['yellow', 'Sunshine', '#ffd23f'], ['blue', 'Ocean', '#3ab0ff'], ['purple', 'Violet', '#a67cff'], ['orange', 'Tangerine', '#ff8a3d'], ['red', 'Red', '#e5252a']];
export const TEMPLATE_ANIMS = [['original', 'Original animation'], ['none', 'No animation'], ['fade', 'Fade'], ['pop', 'Pop'], ['slide-up', 'Rise'], ['slide-down', 'Drop in'], ['slide-right', 'Slide in'], ['zoom', 'Zoom']];
export const TEMPLATE_POSITIONS = [['original', 'Original position'], ['top', 'Top'], ['center', 'Centre'], ['bottom', 'Bottom']];
export const TEMPLATE_SIZES = [['1', 'Normal size'], ['0.8', 'Small'], ['1.25', 'Large'], ['1.5', 'Extra large']];
export const TEMPLATE_LENGTHS = [['original', 'Original length'], ['2', '2 seconds'], ['3', '3 seconds'], ['5', '5 seconds'], ['8', '8 seconds']];
const lum = hex => { const m = /^#?([0-9a-f]{6})/i.exec(hex || ''); if (!m) return 1; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
// A copy of the template with the chosen colours, font, size, animation, position and length.
export function customizeTemplate(tpl, { theme = 'original', font = 'original', anim = 'original', pos = 'original', size = '1', length = 'original' } = {}) {
  const accent = TEMPLATE_THEMES.find(x => x[0] === theme)?.[2];
  const ys = tpl.items.map(it => it.transform?.y ?? 0), mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const target = { top: -0.33, center: 0, bottom: 0.3 }[pos];
  const items = tpl.items.map(it => {
    const s = { ...it.style }, n = { ...it, style: s, transform: { ...(it.transform || {}) } };
    if (theme === 'white') { if (s.bgOpacity > 0) { s.bgColor = '#ffffff'; s.color = '#111318'; } else s.color = '#ffffff'; if (s.shadowOpacity >= 1) s.shadowColor = '#ffffff'; if (s.strokeWidth) s.strokeColor = '#000000'; }
    else if (accent) {
      if (s.bgOpacity > 0 && lum(s.bgColor) > 0.08) { s.bgColor = accent; s.color = lum(accent) > 0.6 ? '#111318' : '#ffffff'; }
      else if (s.color && lum(s.color) < 0.93) s.color = accent; // already-coloured text takes the accent
      if (s.shadowOpacity >= 1) s.shadowColor = accent;
      if (s.strokeWidth && lum(s.strokeColor || '#000') > 0.08) s.strokeColor = accent;
    }
    if (font !== 'original') s.font = font;
    if (size !== '1') s.size = Math.min(0.4, (s.size ?? 0.075) * +size);
    if (anim === 'none') { n.animIn = null; n.animOut = null; n.animLoop = null; }
    else if (anim !== 'original') { n.animIn = { id: anim, duration: it.animIn?.duration || 0.45 }; n.animOut = { id: 'fade', duration: 0.35 }; }
    if (target !== undefined) n.transform.y = Math.max(-0.45, Math.min(0.45, (it.transform?.y ?? 0) - mid + target));
    if (length !== 'original') n.duration = +length;
    return n;
  });
  return { ...tpl, items };
}

// The parts of one added template share a group, so its font, colours and size can be edited together.
export function textTemplateClips(tpl, at) {
  let t = at; const group = { id: 'tpl-' + Math.random().toString(36).slice(2, 10), name: tpl.name };
  return tpl.items.map(it => {
    const d = it.duration || 4;
    const c = T({ text: it.text, style: { ...TEXT_STYLE, ...it.style }, start: tpl.sequence ? t : at, duration: d, name: it.text.split('\n')[0].slice(0, 40), transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, ...(it.transform || {}) }, animIn: it.animIn || null, animOut: it.animOut || null, animLoop: it.animLoop || null, ...(tpl.items.length > 1 ? { group } : {}) });
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
  { id: 'tutorial', name: 'Tutorial', hint: 'Steps, clean captions · 16:9', ratio: '16:9', captions: 'clean', swatch: 'linear-gradient(140deg, #3ab0ff, #1d3557)', titles: [{ tpl: 'episode', at: 0 }, { tpl: 'steps', at: 3 }] },
  { id: 'gaming', name: 'Gaming highlight', hint: 'Punchy titles, cyber look · 16:9', ratio: '16:9', look: 'cyber', swatch: 'linear-gradient(140deg, #a67cff, #ff2bd6)', titles: [{ tpl: 'retro', at: 0 }, { tpl: 'subscribe-bell', at: 5 }] },
  { id: 'travel', name: 'Travel diary', hint: 'Sunset look, location tags · 9:16', ratio: '9:16', look: 'sunset', captions: 'clean', swatch: 'linear-gradient(140deg, #ff8a3d, #ffd23f)', titles: [{ tpl: 'location', at: 0 }, { tpl: 'cinematic', text: 'SOMEWHERE NEW', at: 0.5 }] },
  { id: 'recipe', name: 'Recipe', hint: 'Warm look, step titles · 9:16', ratio: '9:16', look: 'golden', captions: 'bold', swatch: 'linear-gradient(140deg, #f4a261, #e76f51)', titles: [{ tpl: 'headline', text: 'EASY PASTA', at: 0 }, { tpl: 'checklist', at: 3 }] },
  { id: 'fitness', name: 'Fitness', hint: 'High contrast, countdown · 9:16', ratio: '9:16', look: 'bleach', captions: 'bold', swatch: 'linear-gradient(140deg, #e5252a, #111318)', titles: [{ tpl: 'countdown', at: 0 }, { tpl: 'impact', text: 'GO HARD', at: 3 }] },
  { id: 'real-estate', name: 'Property tour', hint: 'Bright look, location & price · 16:9', ratio: '16:9', look: 'nordic', swatch: 'linear-gradient(140deg, #8ecae6, #219ebc)', titles: [{ tpl: 'location', text: '📍 12 Harbour Street', at: 0 }, { tpl: 'price', at: 4 }] },
  { id: 'interview', name: 'Interview', hint: 'Name titles, clean captions · 16:9', ratio: '16:9', look: 'matte', captions: 'clean', swatch: 'linear-gradient(140deg, #6c757d, #212529)', titles: [{ tpl: 'lower-third', at: 1 }] },
  { id: 'sale-ad', name: 'Sale ad', hint: 'Bold sale titles & code · 1:1', ratio: '1:1', look: 'vivid', swatch: 'linear-gradient(140deg, #ff3b5c, #ffd23f)', titles: [{ tpl: 'sale', at: 0 }, { tpl: 'discount-code', at: 3 }, { tpl: 'shop-now', at: 6 }] },
  { id: 'storytime', name: 'Storytime', hint: 'POV hook, karaoke captions · 9:16', ratio: '9:16', captions: 'karaoke', swatch: 'linear-gradient(140deg, #7c4dff, #3ab0ff)', titles: [{ tpl: 'pov', at: 0 }] },
  { id: 'wedding', name: 'Wedding film', hint: 'Soft pastel look, elegant titles · 16:9', ratio: '16:9', look: 'pastel', vignette: true, swatch: 'linear-gradient(140deg, #f8c8dc, #f5e6c4)', titles: [{ tpl: 'quote-modern', text: 'Forever starts today', at: 0.5 }, { tpl: 'the-end', at: 8 }] },
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
