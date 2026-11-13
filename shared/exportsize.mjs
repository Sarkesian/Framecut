// Export size planning, shared by the export dialog (estimate before exporting) and the renderer (the
// bitrate actually used), so the number shown is the number encoded.
//
// Everything is expressed in "bits per pixel per frame" (bpp) of an H.264-equivalent stream: codecs that
// need fewer bits for the same picture (HEVC, VP9) are scaled by CODEC_K. That one figure says how a
// bitrate will look at a given resolution and frame rate, which is what lets a target size be judged
// ("300 MB is plenty for 1080p here" / "too little for 4K, use 1440p") instead of just obeyed.

export const AUDIO_ONLY = ['mp3', 'wav', 'm4a', 'flac', 'ogg'];
export const CODEC_K = { h264: 1, hevc: 0.6, vp9: 0.65, mpeg4: 1.6, prores: 9, gif: 3 };
export const QUALITY_BPP = { high: 0.14, balanced: 0.08, small: 0.045 };
export const STANDARD_HEIGHTS = [480, 720, 1080, 1440, 2160, 4320];
export const MIN_SHORT = 144, MAX_SHORT = 4320;
// Below this the picture visibly breaks up; above GOOD more bits are hard to see.
const POOR = 0.022, FAIR = 0.04, GOOD = 0.07;
const AUDIO_STEPS = [96, 128, 160, 192, 256, 320];

export const codecFor = (format, codec) => (format === 'webm' ? 'vp9' : format === 'avi' ? 'mpeg4' : format === 'gif' ? 'gif' : format === 'flv' ? 'h264' : codec === 'hevc' || codec === 'prores' ? codec : 'h264');
// Target sizes do not apply to formats without a controllable video bitrate.
export const canTarget = (format, codec) => !AUDIO_ONLY.includes(format) && format !== 'gif' && codecFor(format, codec) !== 'prores';
// A short side (the "p" number) that every encoder accepts: even, within range.
export const cleanShort = v => { const n = Math.round(+v / 2) * 2; return Number.isFinite(n) ? Math.min(MAX_SHORT, Math.max(MIN_SHORT, n)) : 1080; };

// Video bitrate (kbps) FrameCut expects from a quality setting. A custom bitrate wins.
export function qualityKbps({ format, codec, quality = 'high', bitrate = 0 }, W, H, fps) {
  if (AUDIO_ONLY.includes(format)) return 0;
  if (+bitrate > 0) return +bitrate;
  return W * H * fps * (QUALITY_BPP[quality] ?? QUALITY_BPP.balanced) * (CODEC_K[codecFor(format, codec)] ?? 1) / 1000;
}

// Fit a video into targetMB (decimal megabytes, so the file is under the limit however a site counts).
// Returns the bitrates to encode with and a plain judgement of how it will look.
//   scale: applied to the video bitrate on a retry after an encode came out over the limit.
export function targetPlan({ targetMB, duration, W, H, fps, format = 'mp4', codec = 'h264', audioKbps = 192, hasAudio = true, scale = 1 }) {
  const k = CODEC_K[codecFor(format, codec)] ?? 1, px = Math.max(1, W * H * fps);
  const totalKbps = Math.max(0, +targetMB) * 8000 / Math.max(0.1, duration) * 0.975; // 2.5% for the container
  // Sound gets at most an eighth of a tight budget, and never more than was asked for.
  let audio = 0;
  if (hasAudio) { audio = AUDIO_STEPS.filter(a => a <= audioKbps && a <= totalKbps / 8).at(-1) ?? AUDIO_STEPS[0]; }
  const budget = (totalKbps - audio) * 0.97 * scale; // single-pass rate control drifts a little: leave room
  // More bits than the best quality setting would use buy nothing: the file simply comes out smaller.
  const ceiling = px * QUALITY_BPP.high * 1.25 * k / 1000;
  const videoKbps = Math.round(Math.max(80, Math.min(budget, ceiling)));
  const bpp = videoKbps * 1000 / px / k;
  const grade = budget < 80 ? 'impossible' : bpp >= GOOD ? 'great' : bpp >= FAIR ? 'good' : bpp >= POOR ? 'soft' : 'poor';
  const capped = budget > ceiling;
  const bytes = (videoKbps + audio) * 125 * duration / 0.975;
  // When the picture would suffer, the largest standard size that still looks good at this budget.
  let suggest = null;
  if (grade === 'soft' || grade === 'poor' || grade === 'impossible') {
    const short = Math.min(W, H), ar = Math.max(W, H) / short;
    for (const h of [...STANDARD_HEIGHTS].reverse()) if (h < short && Math.max(80, budget) * 1000 / (h * h * ar * fps) / k >= FAIR) { suggest = h; break; }
    if (!suggest && short > STANDARD_HEIGHTS[0] && grade !== 'soft') suggest = STANDARD_HEIGHTS[0];
  }
  return { videoKbps, audioKbps: audio, bpp, grade, capped, bytes, suggest };
}

// Size in bytes an export is expected to have. Lossless audio and ProRes are sized by their fixed rates.
export function estimateBytes(s, W, H, duration, { hasAudio = true } = {}) {
  const lossless = ['wav', 'flac'].includes(s.format) || codecFor(s.format, s.codec) === 'prores';
  const audio = !hasAudio || s.format === 'gif' ? 0 : lossless ? 1411 : +s.audioBitrate || 192;
  if (s.sizeMode === 'target' && +s.targetMB > 0 && canTarget(s.format, s.codec)) return targetPlan({ targetMB: s.targetMB, duration, W, H, fps: s.fps, format: s.format, codec: s.codec, audioKbps: audio, hasAudio }).bytes;
  return (qualityKbps(s, W, H, s.fps) + audio) * 125 * duration;
}
