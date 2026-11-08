// Start screen: create, open and manage projects.
import { useEffect, useState } from 'preact/hooks';
import { Plus, FolderOpen, Search, Film, Ellipsis, Copy, Trash2, Pencil, Upload, Settings, LayoutTemplate, Clock, Clapperboard, Sparkles, HardDrive } from 'lucide-preact';
import { api, native, importFiles, pickMedia } from '../lib/api.js';
import { openProject, toast, prefs } from '../lib/state.js';
import { addAssets } from '../lib/edit.js';
import { openMenu, confirm, prompt, Empty } from './kit.jsx';
import { RATIOS } from '../../shared/model.mjs';
import { PROJECT_TEMPLATES, projectFromTemplate } from '../../shared/templates.mjs';
import { ago, shortTime } from '../lib/format.js';
import { openPreferences } from './Preferences.jsx';
import { Logo } from './Logo.jsx';

const QUICK = ['16:9', '9:16', '1:1', '4:5'];
const ratioBox = r => { const [a, b] = r.split(':').map(Number); const k = 22 / Math.max(a, b); return { width: a * k + 'px', height: b * k + 'px' }; };

export async function createProject(opts = {}, assets) {
  const p = await api('/api/projects', opts);
  await openProject(p.id);
  if (assets?.length) setTimeout(() => addAssets(assets, { at: 0 }), 50);
}

export function Home() {
  const [list, setList] = useState(null), [q, setQ] = useState(''), [dragging, setDragging] = useState(false), [busy, setBusy] = useState(false);
  const load = () => api('/api/projects').then(setList).catch(e => toast(e.message, 'error'));
  useEffect(() => { load(); native?.setTitleColors?.({ color: '#0b0c10', symbolColor: '#c9ccd6' }); }, []);
  const filtered = (list || []).filter(p => p.name.toLowerCase().includes(q.toLowerCase()));
  const startWith = async (res, ratio) => {
    if (!res) return; if (res.errors?.length) toast(res.errors.map(e => `${e.name}: ${e.error}`).join('\n'), 'error');
    if (!res.assets.length) return;
    const first = res.assets.find(a => a.width && a.height);
    const r = ratio || (first ? (first.height > first.width * 1.2 ? '9:16' : Math.abs(first.width - first.height) < 20 ? '1:1' : '16:9') : '16:9');
    await createProject({ name: res.assets[0].name.replace(/\.[^.]+$/, ''), ratio: r }, res.assets);
  };
  const onDrop = async e => {
    e.preventDefault(); setDragging(false); if (!e.dataTransfer.files.length) return;
    setBusy(true); try { await startWith(await importFiles([...e.dataTransfer.files])); } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const openFile = async () => {
    try {
      if (native) { const [p] = await native.openFiles({ title: 'Open project', filters: [{ name: 'FrameCut project', extensions: ['framecut', 'json'] }] }) || []; if (!p) return; const proj = await api('/api/projects/open-file', { path: p }); await openProject(proj.id); }
      else { const input = document.createElement('input'); input.type = 'file'; input.accept = '.framecut,.json'; input.onchange = async () => { const json = JSON.parse(await input.files[0].text()); const proj = await api('/api/projects/open-file', { json }); await openProject(proj.id); }; input.click(); }
    } catch (e) { toast('That project file could not be opened: ' + e.message, 'error'); }
  };
  const projectMenu = (e, p) => openMenu(e, [
    { text: 'Open', icon: FolderOpen, onClick: () => openProject(p.id) },
    { text: 'Rename…', icon: Pencil, onClick: async () => { const name = await prompt({ title: 'Rename project', label: 'Project name', value: p.name }); if (!name?.trim()) return; const full = await api('/api/projects/' + p.id); full.name = name.trim(); await api('/api/projects/' + p.id, full, 'PUT'); load(); } },
    { text: 'Duplicate', icon: Copy, onClick: async () => { await api(`/api/projects/${p.id}/duplicate`, {}); load(); toast('Project duplicated.'); } },
    { divider: true },
    { text: 'Delete', icon: Trash2, danger: true, onClick: async () => { if (await confirm({ title: `Delete “${p.name}”?`, text: 'The project moves to FrameCut’s trash folder. Your media files are not touched.', ok: 'Delete project', danger: true })) { await api('/api/projects/' + p.id, undefined, 'DELETE'); load(); toast('Project deleted.'); } } },
  ]);
  return <div class={`home ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }} onDrop={onDrop}>
    <header class="titlebar"><Logo /><span class="title-name">FrameCut Studio</span><div class="grow drag" /></header>
    <div class="home-body">
      <nav class="home-nav">
        <button class="nav-item on"><Clapperboard size={17} />Projects</button>
        <button class="nav-item" onClick={() => document.getElementById('templates')?.scrollIntoView({ behavior: 'smooth' })}><LayoutTemplate size={17} />Templates</button>
        <div class="grow" />
        <button class="nav-item" onClick={openPreferences}><Settings size={17} />Preferences</button>
        <div class="nav-foot"><HardDrive size={13} /> Everything stays on this computer</div>
      </nav>
      <main class="home-main">
        <section class="hero">
          <div class="hero-create">
            <button class="create-tile" onClick={() => createProject({ ratio: prefs.value.defaultRatio || '16:9' })} disabled={busy}>
              <div class="create-plus"><Plus size={30} /></div>
              <div><div class="create-title">New project</div><div class="muted">Start with an empty timeline</div></div>
            </button>
            <div class="quick-ratios">{QUICK.map(r => <button key={r} class="ratio-chip" onClick={() => createProject({ ratio: r, name: RATIOS[r].name + ' project' })} data-tip={RATIOS[r].hint}><span class="ratio-shape" style={ratioBox(r)} /><span><b>{r}</b><small>{RATIOS[r].name}</small></span></button>)}</div>
          </div>
          <div class="hero-side">
            <button class="side-tile" onClick={async () => { setBusy(true); try { await startWith(await pickMedia()); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } }}><Upload size={18} /><div><b>Import media & start</b><small>Pick clips — we set up the project for you</small></div></button>
            <button class="side-tile" onClick={openFile}><FolderOpen size={18} /><div><b>Open project file</b><small>.framecut files from another computer</small></div></button>
          </div>
        </section>

        <section id="templates" class="home-section">
          <div class="section-title"><h2>Start from a template</h2><span class="muted">Ready-made looks, titles and caption styles</span></div>
          <div class="template-row">{PROJECT_TEMPLATES.map(t => <button key={t.id} class={`template-card tpl-${t.id}`} onClick={async () => { const p = projectFromTemplate(t); await createProject({ project: p }); }}>
            <div class="template-art"><span class="ratio-shape light" style={ratioBox(t.ratio)} /><Sparkles size={14} class="tpl-spark" /></div>
            <b>{t.name}</b><small>{t.hint}</small>
          </button>)}</div>
        </section>

        <section class="home-section">
          <div class="section-title"><h2>Recent projects</h2>{list?.length > 0 && <div class="search" style={{ width: 240, marginLeft: 'auto' }}><Search size={14} /><input class="input" type="search" placeholder="Search projects" value={q} onInput={e => setQ(e.target.value)} /></div>}</div>
          {list === null ? <div class="project-grid">{[1, 2, 3, 4].map(i => <div key={i} class="project-card skeleton" />)}</div>
            : !list.length ? <Empty icon={Film} title="No projects yet" text="Create a project, pick a template, or drop video files anywhere on this window to begin." />
            : !filtered.length ? <Empty icon={Search} title="No matches" text={`No project is named like “${q}”.`} />
            : <div class="project-grid">{filtered.map(p => <div key={p.id} class="project-card" tabIndex={0} role="button" aria-label={`Open ${p.name}`} onClick={() => openProject(p.id)} onKeyDown={e => e.key === 'Enter' && openProject(p.id)} onContextMenu={e => projectMenu(e, p)}>
              <div class="project-thumb">{p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <Film size={28} />}<span class="chip dur">{shortTime(p.duration)}</span><span class="chip ratio">{p.ratio}</span></div>
              <div class="project-meta"><div class="ellipsis"><b class="ellipsis">{p.name}</b><small><Clock size={11} /> {ago(p.modified)}{p.recovered ? ' · restored' : ''}</small></div><button class="icon-btn sm" aria-label="Project actions" onClick={e => projectMenu(e, p)}><Ellipsis size={16} /></button></div>
            </div>)}</div>}
        </section>
      </main>
    </div>
    {dragging && <div class="drop-overlay"><Upload size={34} /><b>Drop to start a new project</b><span>Videos, photos and music are linked, never copied</span></div>}
  </div>;
}
