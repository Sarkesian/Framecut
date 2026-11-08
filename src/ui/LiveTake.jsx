// The take being recorded, drawn live on the timeline: a growing clip with its waveform.
import { signal } from '@preact/signals';

// { start: timeline seconds where recording time 0 lands, trackId, peaks: Float32Array (min,max per 10 ms), n }
export const liveTake = signal(null);
const STEP = 0.01;

export function beginLiveTake(start, trackId) { liveTake.value = { start, trackId, peaks: new Float32Array(2 * 6000), n: 0, v: 0 }; }
export function pushLivePeaks(wave) {
  const L = liveTake.value; if (!L || !wave?.length) return;
  let { peaks, n } = L;
  if (n + wave.length > peaks.length) { const g = new Float32Array(Math.max(peaks.length * 2, n + wave.length)); g.set(peaks.subarray(0, n)); peaks = g; }
  for (let i = 0; i < wave.length; i++) peaks[n + i] = wave[i];
  liveTake.value = { ...L, peaks, n: n + wave.length, v: L.v + 1 };
}
export function endLiveTake() { liveTake.value = null; }

// A temporary lane under the tracks while recording; the finished take lands on the voice track.
// Drawn as one SVG path (no canvas): growing a canvas reallocates its GPU surface on every resize,
// which can stall the main thread.
export function LiveTakeRow({ z, width }) {
  const L = liveTake.value; const height = 56, H = height - 24;
  if (!L) return null;
  const frames = L.n / 2, seconds = frames * STEP, left = Math.max(0, L.start) * z, w = Math.max(2, seconds * z);
  // One column per ~2 px: min/max envelope as a closed path.
  const cols = Math.max(1, Math.min(4000, Math.ceil(w / 2))), per = frames / cols, mid = H / 2, top = [], bot = [];
  for (let x = 0; x < cols; x++) {
    const a = Math.floor(x * per), b = Math.max(a + 1, Math.floor((x + 1) * per)); let lo = 0, hi = 0;
    for (let i = a; i < b && i < frames; i++) { const mn = L.peaks[2 * i], mx = L.peaks[2 * i + 1]; if (mn < lo) lo = mn; if (mx > hi) hi = mx; }
    const px = ((x + 0.5) * w / cols).toFixed(1);
    top.push(px + ',' + (mid - Math.min(1, hi) * mid - 0.5).toFixed(1)); bot.push(px + ',' + (mid - Math.max(-1, lo) * mid + 0.5).toFixed(1));
  }
  const d = 'M' + top.join('L') + 'L' + bot.reverse().join('L') + 'Z';
  return <div class="track-row live-row" style={{ height, width: width + 168 }}>
    <div class="track-head"><span class="rec-dot" /><span class="th-name">Recording</span></div>
    <div class="track-lane" style={{ width }}>
      <div class="live-take" style={{ transform: `translateX(${left}px)`, width: w }}>
        <div class="live-take-label">{seconds.toFixed(1)} s</div>
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none"><path d={d} fill="#ff8a95" /></svg>
      </div>
    </div>
  </div>;
}
