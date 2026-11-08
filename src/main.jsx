import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import './styles/app.css';
import './styles/home.css';
import './styles/editor.css';
import './styles/timeline.css';
import { route, prefs, health, fonts, userLuts, refreshMedia, openProject, media, jobs, toast } from './lib/state.js';
import { api } from './lib/api.js';
import { installTooltips, TooltipHost, MenuHost, DialogHost, ToastHost } from './ui/kit.jsx';
import { Home } from './ui/Home.jsx';
import { Editor } from './ui/Editor.jsx';
import * as stateMod from './lib/state.js';
import * as editMod from './lib/edit.js';
// Automation hooks used by the end-to-end tests.
window.__fc = { state: stateMod, edit: editMod, api };

function App() {
  useEffect(() => {
    // Poll the library while thumbnails, waveforms or proxies are being prepared, and background jobs.
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const list = await api('/api/jobs'); jobs.value = list;
        const busy = list.some(j => ['queued', 'running'].includes(j.status)) || [...media.value.values()].some(a => !a.missing && ((a.video && a.kind !== 'image' && !a.strip) || (a.audio && !a.wave) || a.proxyPending));
        if (busy) await refreshMedia();
        setTimeout(tick, busy ? 1000 : 2500);
      } catch { setTimeout(tick, 4000); }
    };
    tick(); return () => { stop = true; };
  }, []);
  return <>
    {route.value.name === 'editor' ? <Editor key={route.value.id} /> : <Home />}
    <DialogHost /><MenuHost /><TooltipHost /><ToastHost />
  </>;
}

async function boot() {
  installTooltips();
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
  // Dropping files anywhere outside a drop zone must never navigate away.
  for (const ev of ['dragover', 'drop']) window.addEventListener(ev, e => { if (!e.defaultPrevented) e.preventDefault(); });
  try {
    const [p, h] = await Promise.all([api('/api/preferences'), api('/api/health')]);
    prefs.value = p; health.value = h;
    await refreshMedia();
    api('/api/fonts').then(f => { fonts.value = f; for (const u of f.user) new FontFace(u.family, `url(${u.url})`).load().then(face => document.fonts.add(face)).catch(() => {}); }).catch(() => {});
    api('/api/luts').then(l => (userLuts.value = l)).catch(() => {});
    const params = new URLSearchParams(location.search);
    if (params.get('project')) await openProject(params.get('project')).catch(e => toast(e.message, 'error'));
  } catch (e) { document.getElementById('app').innerHTML = `<div style="padding:40px;font:14px Segoe UI;color:#eee">FrameCut could not start: ${String(e.message).replace(/</g, '&lt;')}</div>`; return; }
  render(<App />, document.getElementById('app'));
}
boot();
