// FrameCut mark: an "F" assembled from three timeline clips (see assets/brand/).
export const Logo = ({ size = 22 }) => <svg class="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
  <defs>
    <linearGradient id="fc-logo-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a303c" /><stop offset="1" stop-color="#101217" /></linearGradient>
    <linearGradient id="fc-logo-lime" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6fb8a" /><stop offset="1" stop-color="#a6ec6c" /></linearGradient>
    <linearGradient id="fc-logo-mint" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93f2d3" /><stop offset="1" stop-color="#55d6ad" /></linearGradient>
  </defs>
  <rect x="1" y="1" width="30" height="30" rx="7.5" fill="url(#fc-logo-bg)" stroke="rgba(255,255,255,.08)" />
  <rect x="8" y="7" width="5" height="18" rx="1.8" fill="url(#fc-logo-lime)" />
  {size >= 28
    ? <><rect x="14" y="7" width="4.4" height="5" rx="1.6" fill="url(#fc-logo-lime)" /><path d="M20 7h3.2a1.6 1.6 0 0 1 1.6 1.6v1.8a1.6 1.6 0 0 1-1.6 1.6h-4.5z" fill="url(#fc-logo-lime)" /></>
    : <rect x="14" y="7" width="10.5" height="5" rx="1.8" fill="url(#fc-logo-lime)" />}
  <rect x="14" y="14.2" width="7" height="4.6" rx="1.7" fill="url(#fc-logo-mint)" />
</svg>;
