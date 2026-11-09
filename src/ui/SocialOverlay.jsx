// "Preview for social media": the TikTok For You screen drawn over the viewer, so titles, captions and
// stickers can be kept clear of the app's own buttons. Plain SVG laid over the canvas — never part of the
// render, so it can't end up in an export or a snapshot.
//
// Laid out from a real For You screenshot (Android, 691×1536 px). On today's tall phones a 9:16 video fills
// the width and sits between the status bar and the bar under the player, so the bottom navigation is NOT
// on top of the video; what is: the top tabs, the action column on the right (ending in the sound disc at
// the very bottom) and the username + caption bottom-left. Screenshot pixels map onto TikTok's 1080×1920
// frame as x × 1.563 and (y − 70) × 1.563. The dashed box is the area those elements leave clear, with room
// for a second caption line. Exact details vary a little by phone and app version.
import { Smartphone } from 'lucide-preact';
import { ui, setUi } from '../lib/uiprefs.js';
import { openMenu } from './kit.jsx';

export const SOCIAL = { tiktok: { name: 'TikTok' } };

export function socialMenu(e) {
  const cur = ui.value.social || 'none';
  openMenu(e, [
    { label: 'Preview your video for social media' },
    { label: 'Only shown here — never exported' },
    { text: 'TikTok', checked: cur === 'tiktok', onClick: () => setUi({ social: 'tiktok' }) },
    { divider: true },
    { text: 'None', checked: cur !== 'tiktok', onClick: () => setUi({ social: 'none' }) },
  ], { align: 'below' });
}
export const SocialButton = () => {
  const on = ui.value.social === 'tiktok';
  return <button class={`icon-btn sm ${on ? 'on' : ''}`} aria-pressed={on} aria-haspopup="menu" aria-label="Preview for social media" data-tip={on ? 'Previewing as TikTok · not exported' : 'Preview for social media (TikTok)'} onClick={socialMenu}><Smartphone size={15} /></button>;
};

const W = 1080, H = 1920, RED = '#FE2C55';
const shadow = { filter: 'url(#tt-shadow)' };
const SAFE = { l: 40, r: 170, t: 135, b: 230 };

// Icons in a 100×100 box, drawn white.
const HEART = 'M50 90C22 68 5 53 5 33 5 18 16 7 30 7c9 0 16 5 20 12 4-7 11-12 20-12 14 0 25 11 25 26 0 20-17 35-45 57z';
const BUBBLE = 'M50 8C24 8 4 25 4 46c0 12 6 23 17 30l-4 17 19-10c4 1 9 2 14 2 26 0 46-17 46-39S76 8 50 8z';
const BOOKMARK = 'M22 6h56c4 0 7 3 7 7v81L50 72 15 94V13c0-4 3-7 7-7z';
const SHARE = 'M57 8l40 38-40 38V62C33 61 16 69 3 90c4-30 20-52 54-56z';

function Icon({ d, x, y, s = 90, fill = '#fff', children }) {
  return <g transform={`translate(${x - s / 2} ${y - s / 2}) scale(${s / 100})`} style={shadow}><path d={d} fill={fill} />{children}</g>;
}
function Count({ x, y, children }) { return <text x={x} y={y} text-anchor="middle" font-size="32" font-weight="600" fill="#fff" style={shadow}>{children}</text>; }
// A neutral stand-in for a profile picture.
function Avatar({ x, y, r }) {
  return <g style={shadow}><circle cx={x} cy={y} r={r} fill="#8d939e" /><circle cx={x} cy={y - r * 0.2} r={r * 0.36} fill="#e8eaee" /><path d={`M${x - r * 0.66} ${y + r * 0.74}a${r * 0.66} ${r * 0.52} 0 0 1 ${r * 1.32} 0z`} fill="#e8eaee" /></g>;
}

export function SocialOverlay({ cw, ch }) {
  if (ui.value.social !== 'tiktok') return null;
  const ratio = cw / ch, vertical = Math.abs(ratio - 9 / 16) < 0.02;
  const RX = 995; // centre of the action column
  if (!vertical) return <div class="social" aria-hidden="true"><div class="social-note">TikTok plays vertical video full screen — switch the project to 9:16 (Player › aspect ratio) to see the TikTok overlay.</div></div>;
  return <div class="social" aria-hidden="true">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%" font-family="'TikTok Sans', 'Inter', 'Proxima Nova', 'Helvetica Neue', Arial, sans-serif">
      <defs>
        <filter id="tt-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000" flood-opacity=".45" /></filter>
        <linearGradient id="tt-bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0" /><stop offset="1" stop-color="#000" stop-opacity=".4" /></linearGradient>
        <linearGradient id="tt-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".3" /><stop offset="1" stop-color="#000" stop-opacity="0" /></linearGradient>
        <clipPath id="tt-tabs"><rect x="150" y="0" width={W} height="140" /></clipPath>
      </defs>
      {/* Shading the app adds behind its text */}
      <rect x="0" y="0" width={W} height="200" fill="url(#tt-top)" />
      <rect x="0" y="1620" width={W} height="300" fill="url(#tt-bottom)" />

      {/* Safe zone: keep titles and important content inside */}
      <rect x={SAFE.l} y={SAFE.t} width={W - SAFE.l - SAFE.r} height={H - SAFE.t - SAFE.b} rx="10" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3" stroke-dasharray="14 10" />
      <text x={SAFE.l + 14} y={SAFE.t + 34} font-size="24" font-weight="600" fill="rgba(255,255,255,.7)">Safe zone</text>

      {/* Top bar: LIVE · (a tab scrolled half out of view) · Local · Following · Shop · For You · search */}
      <g style={shadow} fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="47" y="50" width="66" height="45" rx="9" /><path d="M68 35l12 14 12-14" />
      </g>
      <text x="80" y="80" text-anchor="middle" font-size="19" font-weight="800" fill="#fff" style={shadow}>LIVE</text>
      <g font-size="39" font-weight="500" text-anchor="middle" fill="rgba(255,255,255,.62)" style={shadow} clip-path="url(#tt-tabs)">
        <text x="242" y="80" text-anchor="end" fill="rgba(255,255,255,.35)">Community</text>
        <text x="324" y="80">Local</text>
        <text x="495" y="80">Following</text>
        <text x="662" y="80">Shop</text>
        <text x="824" y="80" fill="#fff" font-size="42" font-weight="700">For You</text>
      </g>
      <rect x="791" y="111" width="67" height="6" rx="3" fill="#fff" />
      <g style={shadow} fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round"><circle cx="998" cy="62" r="24" /><path d="M1016 80l17 17" /></g>

      {/* Right action column */}
      <g style={shadow}>
        <circle cx={RX} cy="780" r="47" fill="rgba(255,255,255,.28)" />
        <circle cx={RX} cy="780" r="23" fill="none" stroke="#fff" stroke-width="6" />
        <circle cx={RX - 8} cy="778" r="3.5" fill="#fff" /><circle cx={RX + 8} cy="778" r="3.5" fill="#fff" />
      </g>
      <Avatar x={RX} y={957} r={62} />
      <circle cx={RX} cy="1015" r="20" fill={RED} />
      <path d={`M${RX - 9} 1015h18M${RX} 1006v18`} stroke="#fff" stroke-width="4.5" stroke-linecap="round" />
      <Icon d={HEART} x={RX} y={1130} s={88} />
      <Count x={RX} y={1207}>12.3K</Count>
      <Icon d={BUBBLE} x={RX} y={1300} s={84}><g fill="#6b6f78"><circle cx="30" cy="46" r="6" /><circle cx="50" cy="46" r="6" /><circle cx="70" cy="46" r="6" /></g></Icon>
      <Count x={RX} y={1376}>345</Count>
      <Icon d={BOOKMARK} x={RX} y={1468} s={72} />
      <Count x={RX} y={1544}>1,234</Count>
      <Icon d={SHARE} x={RX} y={1638} s={80} />
      <Count x={RX} y={1713}>5.6K</Count>
      <Avatar x={RX} y={1826} r={53} />

      {/* Username and caption, bottom left */}
      <g style={shadow} fill="#fff">
        <text x="34" y="1814" font-size="40" font-weight="700">username</text>
        <text x="34" y="1882" font-size="37" font-weight="600">#yourtags #fyp</text>
      </g>
    </svg>
  </div>;
}
