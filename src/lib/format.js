export function timecode(s, fps = 30) {
  s = Math.max(0, s || 0); const f = Math.floor((s % 1) * fps + 1e-6);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = Math.floor(s) % 60;
  const p = n => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(sec)}:${p(f)}`;
}
export function shortTime(s) {
  s = Math.max(0, s || 0); const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  if (s < 10 && s % 1) return s.toFixed(1) + 's';
  return `${m}:${String(sec).padStart(2, '0')}`;
}
export function bytes(n) { if (!n) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024))); return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`; }
export function ago(iso) {
  const d = (Date.now() - Date.parse(iso)) / 1000; if (!Number.isFinite(d)) return '';
  if (d < 60) return 'Just now'; if (d < 3600) return `${Math.floor(d / 60)} min ago`; if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`; return new Date(iso).toLocaleDateString();
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
