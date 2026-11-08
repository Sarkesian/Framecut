// Script → captions. Splits a script into readable caption lines and times them against detected
// speech (timeline seconds). Lines are laid out over speaking time only, so pauses between
// sentences stay caption-free. This is an estimate from pauses, not word recognition.

export function captionUnits(text, { maxChars = 42 } = {}) {
  const sentences = String(text || '')
    .replace(/\r/g, '').split(/\n+/).flatMap(par => par.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g) || [])
    .map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const s of sentences) {
    const words = s.split(/\s+/); let cur = '';
    for (const w of words) {
      if (cur && (cur + ' ' + w).length > maxChars) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) {
      // Avoid a dangling one-word line: rebalance with the previous chunk of the same sentence.
      const prev = out.length && out[out.length - 1];
      if (prev && cur.split(' ').length === 1 && s.includes(prev + ' ' + cur) && (prev + ' ' + cur).length <= maxChars + 12) out[out.length - 1] = prev + ' ' + cur; else out.push(cur);
    }
  }
  return out;
}

// Weight per line: characters plus a constant for the natural pause at line ends.
const weight = s => s.replace(/\s+/g, ' ').length + 6 + (/[.!?…]["'”’)]*$/.test(s) ? 8 : /[,;:]$/.test(s) ? 4 : 0);

export function alignScript(text, speech, { maxChars = 42, minDur = 0.6, span = null } = {}) {
  const units = captionUnits(text, { maxChars });
  let segs = (speech || []).filter(s => s.end - s.start > 0.02).sort((a, b) => a.start - b.start);
  if (!segs.length && span) segs = [{ start: span[0], end: span[1] }];
  if (!units.length || !segs.length) return [];
  let spanA = segs[0].start, spanB = segs.at(-1).end;
  // Too little detected speech to read every line: spread over the whole spoken span, or the voice clip itself.
  if (segs.reduce((n, s) => n + (s.end - s.start), 0) < units.length * minDur) {
    if (span && spanB - spanA < units.length * minDur) { spanA = span[0]; spanB = span[1]; }
    segs = [{ start: spanA, end: spanB }];
  }
  const total = segs.reduce((n, s) => n + (s.end - s.start), 0), W = units.reduce((n, u) => n + weight(u), 0);
  // Map "speaking time" (pauses removed) back to timeline time.
  const toReal = v => { let acc = 0; for (const s of segs) { const d = s.end - s.start; if (v <= acc + d + 1e-9) return s.start + (v - acc); acc += d; } return segs.at(-1).end; };
  const segAt = t => segs.find(s => t >= s.start - 1e-6 && t <= s.end + 1e-6);
  let v = 0; const out = [];
  for (const u of units) {
    const d = (weight(u) / W) * total; let a = toReal(v + 1e-6); const b = toReal(v + d - 1e-6); v += d;
    // A line that starts right before a pause belongs after it.
    const sa = segAt(a); if (sa && sa.end - a < 0.15 && b > sa.end) { const nx = segs[segs.indexOf(sa) + 1]; if (nx) a = nx.start; }
    out.push({ start: a, end: Math.max(b, a), text: u });
  }
  // Readable minimum and no overlaps (forward), then nothing past the end of the voice (backward).
  for (let i = 0; i < out.length; i++) {
    if (i) out[i].start = Math.max(out[i].start, out[i - 1].end);
    out[i].end = Math.max(out[i].end, out[i].start + minDur);
  }
  let limit = spanB;
  for (let i = out.length - 1; i >= 0; i--) {
    const room = (limit - spanA) / (i + 1); // fair share left for this line and those before it
    out[i].end = Math.min(out[i].end, limit);
    out[i].start = Math.max(spanA, Math.min(out[i].start, out[i].end - Math.min(minDur, room)));
    limit = out[i].start;
  }
  return out;
}
