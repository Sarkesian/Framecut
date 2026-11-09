// "Preview for social media": the TikTok For You screen drawn over the viewer, so titles, captions and
// stickers can be kept clear of the app's own buttons. Plain SVG laid over the canvas — never part of the
// render, so it can't end up in an export or a snapshot.
//
// Everything is placed on TikTok's own 1080×1920 frame (the full-screen vertical video) and scaled to the
// viewer: the top tabs, the action column on the right, the caption block and sound line bottom-left, the
// progress bar and the bottom navigation bar. The dashed box is the commonly used TikTok safe zone
// (about 60 px left, 140 px right, 150 px top and 470 px bottom kept clear). Shapes are drawn to match the
// app's layout and proportions; exact details vary a little by phone and app version.
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

const W = 1080, H = 1920, RED = '#FE2C55', CYAN = '#25F4EE';
const shadow = { filter: 'url(#tt-shadow)' };

// Icons in a 100×100 box, drawn white.
const HEART = 'M50 90C22 68 5 53 5 33 5 18 16 7 30 7c9 0 16 5 20 12 4-7 11-12 20-12 14 0 25 11 25 26 0 20-17 35-45 57z';
const BUBBLE = 'M50 8C24 8 4 25 4 46c0 12 6 23 17 30l-4 17 19-10c4 1 9 2 14 2 26 0 46-17 46-39S76 8 50 8z';
const BOOKMARK = 'M22 6h56c4 0 7 3 7 7v81L50 72 15 94V13c0-4 3-7 7-7z';
const SHARE = 'M57 8l40 38-40 38V62C33 61 16 69 3 90c4-30 20-52 54-56z';
const HOME = 'M50 10L8 46h12v42h22V64h16v24h22V46h12z';

function Icon({ d, x, y, s = 90, fill = '#fff', children }) {
  return <g transform={`translate(${x - s / 2} ${y - s / 2}) scale(${s / 100})`} style={shadow}><path d={d} fill={fill} />{children}</g>;
}
function Count({ x, y, children }) { return <text x={x} y={y} text-anchor="middle" font-size="27" font-weight="600" fill="#fff" style={shadow}>{children}</text>; }

export function SocialOverlay({ cw, ch }) {
  if (ui.value.social !== 'tiktok') return null;
  const ratio = cw / ch, vertical = Math.abs(ratio - 9 / 16) < 0.02;
  const RX = 990; // centre of the action column
  if (!vertical) return <div class="social" aria-hidden="true"><div class="social-note">TikTok plays vertical video full screen — switch the project to 9:16 (Player › aspect ratio) to see the TikTok overlay.</div></div>;
  return <div class="social" aria-hidden="true">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%" font-family="'Inter', 'Proxima Nova', 'Helvetica Neue', Arial, sans-serif">
      <defs>
        <filter id="tt-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000" flood-opacity=".45" /></filter>
        <linearGradient id="tt-bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0" /><stop offset="1" stop-color="#000" stop-opacity=".45" /></linearGradient>
        <linearGradient id="tt-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".3" /><stop offset="1" stop-color="#000" stop-opacity="0" /></linearGradient>
      </defs>
      {/* Shading the app adds behind its text */}
      <rect x="0" y="0" width={W} height="260" fill="url(#tt-top)" />
      <rect x="0" y="1380" width={W} height="410" fill="url(#tt-bottom)" />

      {/* Safe zone: keep titles and important content inside */}
      <rect x="60" y="150" width={W - 60 - 140} height={H - 150 - 470} rx="10" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3" stroke-dasharray="14 10" />
      <text x="72" y="182" font-size="24" font-weight="600" fill="rgba(255,255,255,.7)">Safe zone</text>

      {/* Top bar: LIVE · Explore · Following · For You · search */}
      <g style={shadow}>
        <rect x="34" y="96" width="66" height="44" rx="9" fill="none" stroke="#fff" stroke-width="5" />
        <text x="67" y="126" text-anchor="middle" font-size="19" font-weight="800" fill="#fff">LIVE</text>
      </g>
      <g font-size="37" font-weight="600" text-anchor="middle" style={shadow}>
        <text x="344" y="132" fill="rgba(255,255,255,.72)">Explore</text>
        <text x="548" y="132" fill="rgba(255,255,255,.72)">Following</text>
        <text x="768" y="132" fill="#fff" font-weight="800">For You</text>
      </g>
      <rect x="738" y="152" width="60" height="6" rx="3" fill="#fff" />
      <g style={shadow} fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"><circle cx="1012" cy="112" r="24" /><path d="M1030 130l18 18" /></g>

      {/* Right action column */}
      <g style={shadow}>
        <circle cx={RX} cy="1010" r="52" fill="#9aa0aa" stroke="#fff" stroke-width="4" />
        <circle cx={RX} cy="995" r="20" fill="#e8eaee" /><path d={`M${RX - 34} 1046a34 26 0 0 1 68 0z`} fill="#e8eaee" />
      </g>
      <circle cx={RX} cy="1066" r="22" fill={RED} />
      <path d={`M${RX - 10} 1066h20M${RX} 1056v20`} stroke="#fff" stroke-width="5" stroke-linecap="round" />
      <Icon d={HEART} x={RX} y={1170} s={88} />
      <Count x={RX} y={1250}>128.4K</Count>
      <Icon d={BUBBLE} x={RX} y={1318} s={86}><g fill="#6b6f78"><circle cx="30" cy="46" r="6" /><circle cx="50" cy="46" r="6" /><circle cx="70" cy="46" r="6" /></g></Icon>
      <Count x={RX} y={1396}>1,024</Count>
      <Icon d={BOOKMARK} x={RX} y={1462} s={78} />
      <Count x={RX} y={1540}>9,876</Count>
      <Icon d={SHARE} x={RX} y={1604} s={82} />
      <Count x={RX} y={1682}>2,345</Count>
      <g style={shadow}>
        <circle cx={RX} cy="1744" r="44" fill="#2a2b30" stroke="#55575e" stroke-width="10" />
        <circle cx={RX} cy="1744" r="20" fill="#9aa0aa" />
      </g>

      {/* Caption block, bottom left */}
      <g style={shadow} fill="#fff">
        <text x="40" y="1570" font-size="38" font-weight="800">yourname</text>
        <text x="236" y="1570" font-size="30" font-weight="500" fill="rgba(255,255,255,.75)">· 2d ago</text>
        <text x="40" y="1625" font-size="33" font-weight="500">Your caption goes here and can run onto</text>
        <text x="40" y="1670" font-size="33" font-weight="500">a second line… <tspan font-weight="700">#fyp #foryou</tspan> <tspan fill="rgba(255,255,255,.7)">more</tspan></text>
        <g transform="translate(40 1710)"><path d="M10 6v24a8 8 0 1 1-4-7V2l18 5v7L10 10z" fill="#fff" /></g>
        <text x="80" y="1738" font-size="30" font-weight="500">original sound - yourname</text>
      </g>

      {/* Progress bar and bottom navigation */}
      <rect x="0" y="1786" width={W} height="4" fill="rgba(255,255,255,.3)" /><rect x="0" y="1786" width="360" height="4" fill="#fff" />
      <rect x="0" y="1790" width={W} height="130" fill="#000" />
      <g font-size="22" font-weight="600" text-anchor="middle">
        <Icon d={HOME} x={108} y={1836} s={52} /><text x="108" y="1892" fill="#fff">Home</text>
        <g fill="none" stroke="rgba(255,255,255,.75)" stroke-width="5"><circle cx="314" cy="1826" r="12" /><path d="M292 1856c3-14 14-18 22-18s19 4 22 18" /><circle cx="338" cy="1822" r="9" /></g>
        <text x="314" y="1892" fill="rgba(255,255,255,.75)">Friends</text>
        <rect x="483" y="1814" width="118" height="64" rx="16" fill={CYAN} /><rect x="479" y="1814" width="118" height="64" rx="16" fill={RED} transform="translate(8 0)" />
        <rect x="487" y="1814" width="106" height="64" rx="14" fill="#fff" />
        <path d="M540 1830v32M524 1846h32" stroke="#000" stroke-width="7" stroke-linecap="round" />
        <g fill="none" stroke="rgba(255,255,255,.75)" stroke-width="5" stroke-linejoin="round"><path d="M748 1818h44v32h-14l-8 10-8-10h-14z" /></g>
        <circle cx="796" cy="1814" r="13" fill={RED} /><text x="796" y="1822" font-size="20" fill="#fff">9</text>
        <text x="770" y="1892" fill="rgba(255,255,255,.75)">Inbox</text>
        <g fill="none" stroke="rgba(255,255,255,.75)" stroke-width="5"><circle cx="972" cy="1826" r="13" /><path d="M948 1858c3-14 14-18 24-18s21 4 24 18" /></g>
        <text x="972" y="1892" fill="rgba(255,255,255,.75)">Profile</text>
      </g>
    </svg>
  </div>;
}
