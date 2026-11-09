// Background task indicator (proxies, analysis, AI, export) with cancel.
import { LoaderCircle, X } from 'lucide-preact';
import { jobs } from '../lib/state.js';
import { api } from '../lib/api.js';
import { openMenu } from './kit.jsx';

export function TaskIndicator() {
  // Only work that takes a while: a job that finishes within a second or two never flashes up here.
  const now = Date.now();
  const active = jobs.value.filter(j => ['queued', 'running'].includes(j.status) && now - (j.started || j.created || now) > 1500);
  if (!active.length) return null;
  const main = active.find(j => j.status === 'running') || active[0];
  const pct = Math.round((main.progress || 0) * 100);
  return <button class="task-pill" data-tip="Background tasks — click for details" onClick={e => openMenu(e, [{ label: 'Working in the background' }, ...active.map(j => ({ text: `${j.label} · ${j.status === 'queued' ? 'waiting' : Math.round(j.progress * 100) + '%'}`, icon: X, onClick: () => api('/api/jobs/' + j.id, undefined, 'DELETE') })), { divider: true }, { text: 'Click a task to cancel it', disabled: true }], { align: 'below' })}>
    <LoaderCircle size={14} class="spin" /><span class="ellipsis">{active.length > 1 ? `${active.length} tasks` : main.label}</span>{main.status === 'running' && pct > 0 && <b class="mono">{pct}%</b>}
  </button>;
}
