// Left panel: creative asset browser (media, audio, text, stickers, effects, filters, captions, templates).
// Transitions have no tab here: they are added on a cut in the timeline and edited in the details panel.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { computed } from '@preact/signals';
import { Film, Music, Type, Smile, Sparkles, Palette, Captions, LayoutTemplate, Plus, Upload, Search, Star, TriangleAlert, FolderOpen, Trash2, Image as ImageIcon, Link2, Gauge, Layers, LoaderCircle, X, RotateCcw, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, SlidersHorizontal } from 'lucide-preact';
import { libraryTab, project, media, asset, commit, toast, time, player, selection, primary, userLuts, rememberMedia, importing, trackImport, lookPick, commitTentative, dropTentative, tentativeKey, effectPick, saveNow } from '../lib/state.js';
import { api, native, importFiles, pickFile } from '../lib/api.js';
import { addAssets, addText, applyEffect, removeEffect, effectTarget, applyFilter, removeFilter, filterLayersAt } from '../lib/edit.js';
import { openMenu, Select, Progress, confirm, showDialog, closeDialog, Modal } from './kit.jsx';
import { importMedia } from './commands.jsx';
import { TEXT_PRESETS, CAPTION_PRESETS, EFFECTS, FILTERS, TEXT_STYLE } from '../../shared/catalog.mjs';
import { TEXT_TEMPLATES, textTemplateClips, PROJECT_TEMPLATES, projectFromTemplate, TEMPLATE_CATEGORIES, TEMPLATE_THEMES, TEMPLATE_ANIMS, TEMPLATE_POSITIONS, TEMPLATE_SIZES, TEMPLATE_LENGTHS, customizeTemplate } from '../../shared/templates.mjs';
import { ui, setUi } from '../lib/uiprefs.js';
import { clipEnd } from '../../shared/model.mjs';
import { renderText } from '../engine/raster.js';
import { filterPreviews, effectPreviews } from './previews.js';
import { shortTime } from '../lib/format.js';
import { freeTrack } from '../lib/edit.js';
import { AudioLibrary, StickerLibrary } from './Library.jsx';
import { CaptionsPanel } from './Captions.jsx';

const TABS = [['media', 'Media', Film], ['audio', 'Audio', Music], ['text', 'Text', Type], ['stickers', 'Stickers', Smile], ['effects', 'Effects', Sparkles], ['filters', 'Filters', Palette], ['captions', 'Captions', Captions], ['templates', 'Templates', LayoutTemplate]];
export const dragPayload = (e, data) => { e.dataTransfer.setData('application/x-framecut', JSON.stringify(data)); e.dataTransfer.effectAllowed = 'copy'; window.__fcDrag = data; };

export function AssetPanel() {
  const tab = libraryTab.value;
  return <div class="assets">
    <nav class="asset-rail" aria-label="Asset categories">{TABS.map(([id, label, Icon]) => <button key={id} class={`rail-btn ${tab === id ? 'on' : ''}`} onClick={() => (libraryTab.value = id)} aria-pressed={tab === id}><Icon size={18} /><span>{label}</span></button>)}</nav>
    <div class="asset-content">{{ media: <MediaTab />, audio: <AudioLibrary />, text: <TextTab />, stickers: <StickerLibrary />, effects: <EffectsTab />, filters: <FiltersTab />, captions: <CaptionsPanel />, templates: <TemplatesTab /> }[tab]}</div>
  </div>;
}
const Head = ({ title, children }) => <div class="asset-head"><h2>{title}</h2><div class="grow" />{children}</div>;
const SearchBox = ({ value, onInput, placeholder = 'Search' }) => <div class="search"><Search size={14} /><input class="input" type="search" placeholder={placeholder} value={value} onInput={e => onInput(e.target.value)} /></div>;

// ---------------- Media ----------------
// Two shelves, each with one job:
//   This project: the files this project uses. Importing puts files here; removing one only takes it out of
//                 this project.
//   Library:      every file ever imported into FrameCut, on hand for any project. Using one adds it to the
//                 project; removing one makes FrameCut forget it.
// Files are linked, never copied, and no removal here ever deletes a file of the user's from disk.
const MEDIA_SORTS = [['new', 'Newest first'], ['name', 'Name A to Z'], ['long', 'Longest first'], ['kind', 'By type']];
const sortMedia = (list, by) => [...list].sort((a, b) => (by === 'name' ? a.name.localeCompare(b.name) : by === 'long' ? (b.duration || 0) - (a.duration || 0) : by === 'kind' ? a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) : String(b.imported || '').localeCompare(String(a.imported || ''))));
const usesMedia = (c, id) => c.mediaId === id || c.cutout?.mediaId === id || !!c.takes?.some(t => t.mediaId === id);
// Takes files out of the open project, with the clips that play them. One undo step; nothing on disk changes.
function dropFromProject(ids, label) {
  commit(label, d => {
    const gone = new Set(d.clips.filter(c => ids.some(id => usesMedia(c, id))).map(c => c.id));
    for (const c of d.clips) if (c.detachedAudio && gone.has(c.detachedAudio)) { delete c.detachedAudio; c.muted = false; }
    const from = d.clips.filter(c => gone.has(c.id)).map(c => c.trackId);
    d.clips = d.clips.filter(c => !gone.has(c.id));
    d.tracks = d.tracks.filter(t => t.main || t.captions || t.locked || d.clips.some(c => c.trackId === t.id) || !(t.autoRemove || (from.includes(t.id) && t.kind === 'effect')));
    d.mediaIds = d.mediaIds.filter(x => !ids.includes(x)); d.favorites = d.favorites.filter(x => !ids.includes(x));
  });
}
async function removeFromProject(a) {
  const n = project.value.clips.filter(c => usesMedia(c, a.id)).length;
  if (n && !(await confirm({ title: `Remove “${a.name}” from this project?`, ok: n > 1 ? `Remove it and ${n} clips` : 'Remove it and its clip', danger: true, text: `It is on the timeline (${n} clip${n > 1 ? 's' : ''}), so ${n > 1 ? 'those clips go' : 'that clip goes'} too. The file itself stays on your computer and in your library. Ctrl+Z brings it all back.` }))) return;
  dropFromProject([a.id], 'Remove media from project');
  toast(`“${a.name}” removed from this project${n ? ` with ${n} clip${n > 1 ? 's' : ''}` : ''}. The file is untouched and still in your library. Ctrl+Z to undo.`);
}
async function removeFromLibrary(a) {
  const p = project.value; let usage;
  try { usage = await api(`/api/media/${a.id}/usage`); } catch (e) { return toast(e.message, 'error'); }
  const others = usage.projects.filter(x => x.id !== p.id), here = p.clips.filter(c => usesMedia(c, a.id)).length;
  if (others.length) return showDialog(() => <Modal title="This file is used in other projects" footer={<button class="btn primary" onClick={() => closeDialog()}>OK</button>}><p class="dim" style={{ margin: 0 }}>“{a.name}” is used in {others.map(x => `“${x.name}”`).join(', ')}. Remove it from {others.length > 1 ? 'those projects' : 'that project'} first, then from the library. Nothing was changed.</p></Modal>);
  const file = usage.owned ? 'FrameCut made this file itself (a recording or a processed clip), so the file is deleted too.' : 'Your original file stays exactly where it is on your computer. FrameCut only forgets about it.';
  if (!(await confirm({ title: `Remove “${a.name}” from the library?`, ok: 'Remove from library', danger: true, text: `${file}${here ? ` It is on this project’s timeline (${here} clip${here > 1 ? 's' : ''}); ${here > 1 ? 'those clips are' : 'that clip is'} removed as well.` : ''} This can’t be undone, but you can import the file again at any time.` }))) return;
  try {
    if (p.mediaIds.includes(a.id) || here) { dropFromProject([a.id], 'Remove media'); await saveNow(); }
    const r = await api(`/api/media/${a.id}?except=${p.id}`, undefined, 'DELETE');
    const m = new Map(media.value); m.delete(a.id); media.value = m; player.current?.invalidate();
    toast(r.deletedFile ? `“${a.name}” removed from the library and deleted.` : `“${a.name}” removed from the library. Your file was not touched.`);
  } catch (e) { toast(e.message, 'error', { timeout: 9000 }); }
}
function MediaTab() {
  const p = project.value; const [q, setQ] = useState(''), [kind, setKind] = useState('all'), [over, setOver] = useState(false);
  const scope = ui.value.mediaScope === 'all' ? 'all' : 'project', setScope = v => setUi({ mediaScope: v });
  const sort = MEDIA_SORTS.some(x => x[0] === ui.value.mediaSort) ? ui.value.mediaSort : 'new';
  const all = [...media.value.values()].filter(a => a.role !== 'sticker' && a.role !== 'library-audio');
  const mine = all.filter(a => p.mediaIds.includes(a.id));
  const usedIds = new Set(p.clips.flatMap(c => [c.mediaId, c.cutout?.mediaId, ...(c.takes || []).map(t => t.mediaId)]).filter(Boolean));
  const unused = mine.filter(a => !usedIds.has(a.id));
  // Audio you imported is listed with your videos and photos.
  const list = sortMedia((scope === 'all' ? all : mine).filter(a => (kind === 'all' || (kind === 'fav' ? p.favorites.includes(a.id) : kind === 'unused' ? !usedIds.has(a.id) : a.kind === kind)) && a.name.toLowerCase().includes(q.toLowerCase())), sort);
  const missing = all.filter(a => a.missing && p.mediaIds.includes(a.id));
  const clearUnused = () => { const ids = unused.map(a => a.id); dropFromProject(ids, 'Remove unused media'); toast(`Removed ${ids.length} unused file${ids.length > 1 ? 's' : ''} from this project. They are still in your library. Ctrl+Z to undo.`); };
  const drop = async e => {
    e.preventDefault(); setOver(false); if (!e.dataTransfer.files.length) return;
    const files = [...e.dataTransfer.files];
    try { const r = await trackImport(files.length, () => importFiles(files)); if (r.errors.length) toast(r.errors.map(x => `${x.name}: ${x.error}`).join('\n'), 'error'); if (r.assets.length) { rememberMedia(r.assets); commit('Import media', d => { for (const a of r.assets) if (!d.mediaIds.includes(a.id)) d.mediaIds.push(a.id); }); } }
    catch (err) { toast(err.message, 'error'); }
  };
  return <div class={`tab-body ${over ? 'drop-over' : ''}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={e => !e.currentTarget.contains(e.relatedTarget) && setOver(false)} onDrop={drop}>
    <Head title="Media"><button class="btn primary sm" onClick={() => importMedia()}><Upload size={14} />Import</button></Head>
    {missing.length > 0 && <div class="notice warn"><TriangleAlert size={15} /><div><b>{missing.length} file{missing.length > 1 ? 's are' : ' is'} missing.</b> They were moved or renamed. <button class="btn sm" onClick={() => relinkFolder()}>Find in folder…</button></div></div>}
    <div class="media-scopes" role="tablist" aria-label="Media shelf">
      <button role="tab" aria-selected={scope === 'project'} class={scope === 'project' ? 'on' : ''} onClick={() => setScope('project')}><Film size={14} /><b>This project</b><small>{mine.length}</small></button>
      <button role="tab" aria-selected={scope === 'all'} class={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}><FolderOpen size={14} /><b>Library</b><small>{all.length}</small></button>
    </div>
    <p class="muted hint media-scope-note">{scope === 'project' ? 'Files this project uses. Removing one here only takes it out of this project.' : 'Everything you have imported into FrameCut, ready for any project. Double-click or drag one to use it here.'}</p>
    <div class="asset-tools"><SearchBox value={q} onInput={setQ} placeholder={scope === 'project' ? 'Search this project' : 'Search your library'} /><Select label="Sort media" value={sort} options={MEDIA_SORTS} onChange={v => setUi({ mediaSort: v })} /></div>
    <div class="filter-chips">{[['all', 'All'], ['video', 'Videos'], ['image', 'Photos'], ['audio', 'Audio'], ['fav', '★ Favorites'], ...(scope === 'project' && unused.length ? [['unused', `Not on timeline · ${unused.length}`]] : [])].map(([k, l]) => <button key={k} class={`fchip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>)}
      {scope === 'project' && kind === 'unused' && unused.length > 0 && <button class="btn sm ghost danger" data-tip="Take every file that is not on the timeline out of this project. The files stay in your library and on disk." onClick={clearUnused}><Trash2 size={12} />Remove these {unused.length} from project</button>}</div>
    {importing.value > 0 && <div class="import-bar" role="status"><span>Importing {importing.value} file{importing.value > 1 ? 's' : ''}…</span><Progress indeterminate /></div>}
    {!list.length ? ((q || kind !== 'all') && (scope === 'all' ? all : mine).length ? <div class="lib-state"><Search size={22} /><b>Nothing matches</b><span>Try another word or filter.</span><button class="btn sm" onClick={() => { setQ(''); setKind('all'); }}>Show everything</button></div>
      : <div class="dropzone" onClick={() => importMedia()}><Upload size={26} /><b>{scope === 'project' && all.length ? 'This project has no media yet' : 'Bring your footage in'}</b><span>Drop videos, photos or music here, or click to browse.<br />Files are linked, never copied or moved.</span>{scope === 'project' && all.length > 0 && <button class="btn sm" onClick={e => { e.stopPropagation(); setScope('all'); }}>Reuse something from your library ({all.length})</button>}</div>)
      : <div class="media-grid">{list.map(a => <MediaCard key={a.id} a={a} scope={scope} inProject={p.mediaIds.includes(a.id)} fav={p.favorites.includes(a.id)} used={usedIds.has(a.id)} />)}</div>}
  </div>;
}
async function relinkFolder() {
  if (!native) return toast('Relinking needs the desktop app.', 'warn');
  const dir = await native.chooseFolder({ title: 'Choose the folder that has your missing files' }); if (!dir) return;
  const r = await api('/api/media/relink-folder', { folder: dir }); const list = await api('/api/media'); media.value = new Map(list.map(a => [a.id, a])); player.current?.invalidate();
  toast(r.fixed.length ? `Relinked ${r.fixed.length} file${r.fixed.length > 1 ? 's' : ''}.` : 'No matching files found in that folder.', r.fixed.length ? 'info' : 'warn');
}
export async function relinkOne(a) {
  const f = await pickFile({ title: `Find “${a.name}”`, extensions: [a.name.split('.').pop() || '*', '*'] }); if (!f?.path) return;
  try { const n = await api(`/api/media/${a.id}/relink`, { path: f.path }); const m = new Map(media.value); m.set(n.id, n); media.value = m; player.current?.invalidate(); toast('Relinked.'); } catch (e) { toast(e.message, 'error'); }
}
function MediaCard({ a, fav, used, scope = 'project', inProject = true }) {
  const [hover, setHover] = useState(null);
  // Thumbnail, filmstrip and waveform are built in the background right after import.
  const preparing = !a.missing && ((a.kind === 'video' && (!a.thumb || !a.strip)) || (a.audio && !a.wave));
  const strip = a.strip; const frame = hover !== null && strip ? Math.min(strip.count - 1, Math.floor(hover * strip.count)) : null;
  const add = (overlay = false) => { if (a.missing) return relinkOne(a); addAssets([a], { overlay }); };
  const menuItems = [
    { text: 'Add to timeline', icon: Plus, onClick: () => add() },
    a.kind !== 'audio' && { text: 'Add as overlay (picture-in-picture)', icon: Layers, onClick: () => add(true) },
    { text: fav ? 'Remove from favorites' : 'Add to favorites', icon: Star, onClick: () => commit('Favorite', p => { p.favorites = fav ? p.favorites.filter(x => x !== a.id) : [...p.favorites, a.id]; }) },
    { divider: true },
    a.missing && { text: 'Relink…', icon: Link2, onClick: () => relinkOne(a) },
    native && !a.missing && { text: 'Show in folder', icon: FolderOpen, onClick: () => native.showInFolder(a.folder + '\\' + a.name) },
    a.kind === 'video' && !a.proxyUrl && { text: 'Create playback copy (smoother preview)', icon: Gauge, onClick: () => api(`/api/media/${a.id}/proxy`, {}).then(() => toast('Creating a playback copy in the background.')) },
    !inProject && { text: 'Add to this project (without placing it)', icon: Plus, onClick: () => { commit('Add media to project', p => { if (!p.mediaIds.includes(a.id)) p.mediaIds.push(a.id); }); toast(`“${a.name}” added to this project.`); } },
    { divider: true },
    inProject && { text: used ? 'Remove from project (and its clips)…' : 'Remove from project', icon: Trash2, danger: true, onClick: () => removeFromProject(a) },
    { text: 'Remove from library…', icon: Trash2, danger: true, onClick: () => removeFromLibrary(a) },
    { label: a.owned ? 'Made in FrameCut' : 'Removing never deletes your file' },
  ];
  const remove = scope === 'project' ? () => removeFromProject(a) : () => removeFromLibrary(a);
  return <div class={`media-card ${a.missing ? 'missing' : ''}`} draggable={!a.missing} tabIndex={0} aria-label={a.name}
    onDragStart={e => dragPayload(e, { type: 'media', id: a.id })} onDblClick={() => add()} onKeyDown={e => e.key === 'Enter' && add()} onContextMenu={e => openMenu(e, menuItems)}
    onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover((e.clientX - r.left) / r.width); }} onPointerLeave={() => setHover(null)}>
    <div class="media-thumb">
      {frame !== null ? <div class="strip-frame" style={{ backgroundImage: `url(${strip.url})`, backgroundSize: `${strip.count * 100}% 100%`, backgroundPosition: `${(frame / Math.max(1, strip.count - 1)) * 100}% 0` }} />
        : a.thumb ? <img src={a.thumb} alt="" loading="lazy" draggable={false} /> : a.svg ? <img src={a.url} alt="" draggable={false} /> : <div class="thumb-icon">{a.kind === 'audio' ? <Music size={22} /> : a.kind === 'image' ? <ImageIcon size={22} /> : <Film size={22} />}</div>}
      {preparing && <div class="card-prep" data-tip="Preparing the preview — you can already use this file"><Progress indeterminate /></div>}
      {a.kind !== 'image' && <span class="badge dur">{shortTime(a.duration)}</span>}
      {used && <span class="badge used" data-tip="On this project’s timeline">●</span>}
      {scope === 'all' && inProject && !used && <span class="badge inproj" data-tip="In this project">In project</span>}
      <button class="rm-btn" data-tip={scope === 'project' ? 'Remove from this project (the file is not deleted)' : a.owned ? 'Remove from library (deletes this FrameCut-made file)' : 'Remove from library (your file is not deleted)'} aria-label={scope === 'project' ? 'Remove from project' : 'Remove from library'} onClick={e => { e.stopPropagation(); remove(); }} onDblClick={e => e.stopPropagation()}><Trash2 size={13} /></button>
      {fav && <Star size={13} class="fav" fill="currentColor" />}
      {a.missing && <div class="missing-overlay"><TriangleAlert size={16} />Missing<button class="btn sm" onClick={e => { e.stopPropagation(); relinkOne(a); }}>Relink</button></div>}
      {a.proxyPending && <span class="badge proxy" data-tip="Preparing a smooth playback copy"><LoaderCircle size={10} class="spin" /></span>}
      {!a.missing && <button class="add-btn" data-tip="Add to timeline" aria-label="Add to timeline" onClick={e => { e.stopPropagation(); add(); }}><Plus size={15} /></button>}
    </div>
    <div class="media-name ellipsis" title={a.name}>{a.name}</div>
  </div>;
}

// Audio and Stickers live in Library.jsx (the Creative Library).

// ---------------- Text ----------------
function TextPreview({ style, text = 'Aa' }) {
  const url = useMemo(() => { const r = renderText({ text, style: { ...TEXT_STYLE, ...style, size: 0.32 }, caption: false }, 300, 120); return r.canvas.toDataURL(); }, [JSON.stringify(style), text]);
  return <img src={url} alt="" draggable={false} />;
}
// Selected text clips (not captions) that a style click should restyle instead of adding new text.
const selectedTexts = () => { const p = project.value; return p ? p.clips.filter(c => selection.value.includes(c.id) && c.kind === 'text' && !c.caption && !p.tracks.find(t => t.id === c.trackId)?.captions) : []; };
// Restyle existing text: the preset's look replaces the old one; the words, position and size stay.
export function restyleText(ids, preset) {
  commit(ids.length > 1 ? `Restyle ${ids.length} texts` : 'Restyle text', p => { for (const c of p.clips) if (ids.includes(c.id)) c.style = { ...TEXT_STYLE, ...preset.style, size: c.style?.size ?? preset.style.size ?? TEXT_STYLE.size, align: c.style?.align ?? TEXT_STYLE.align }; });
}
function TextTab() {
  const [q, setQ] = useState('');
  const sel = selectedTexts();
  return <div class="tab-body">
    <Head title="Text" />
    <button class="add-text-hero" onClick={() => addText()} draggable onDragStart={e => dragPayload(e, { type: 'text', style: {} })}><Plus size={18} /><div><b>Add text</b><small>Click, or drag to the timeline · <span class="kbd">T</span></small></div></button>
    <h4 class="group-title">Styles</h4>
    <p class="muted hint">{sel.length ? <>Click a style to change <b>{sel.length > 1 ? `${sel.length} selected texts` : `“${(sel[0].text || 'the selected text').split('\n')[0].slice(0, 24)}”`}</b>. Drag one to add new text instead.</> : 'Click to add text in that style. Select a text first to restyle it.'}</p>
    <div class="tile-grid">{TEXT_PRESETS.map(t => <button key={t.id} class="tile text-tile" draggable onDragStart={e => dragPayload(e, { type: 'text', style: t.style })} onClick={() => { const s = selectedTexts(); s.length ? restyleText(s.map(c => c.id), t) : addText({ style: t.style, text: 'Your text' }); }} data-tip={sel.length ? `Apply ${t.name}` : t.name}><TextPreview style={t.style} /><span>{t.name}</span></button>)}</div>
    <h4 class="group-title">Animated titles</h4>
    <div class="tile-grid two">{TEXT_TEMPLATES.map(t => <button key={t.id} class="tile text-tile" onClick={() => addTextTemplate(t)} draggable onDragStart={e => dragPayload(e, { type: 'textTemplate', id: t.id })}><TextPreview style={t.items[0].style} text={t.items[0].text.split('\n')[0].slice(0, 14)} /><span>{t.name}</span></button>)}</div>
  </div>;
}
// preview: a key such as 'tpl:headline'. The template is then added tentatively (see commitTentative): it is on
// the frame and can be moved or edited straight away, which keeps it; left untouched, dropTemplatePreview removes it.
let previewHome = null;
export function addTextTemplate(t, at = time.value, { preview = null } = {}) {
  const clips = textTemplateClips(t, at), t0 = player.current?.t;
  const put = p => { for (const c of clips) { const tr = p.tracks.find(x => x.kind === 'text' && !x.captions && !x.locked && !p.clips.some(o => o.trackId === x.id && o.start < clipEnd(c) && clipEnd(o) > c.start)); c.trackId = (tr || freeTrack(p, 'text', c.start, clipEnd(c))).id; p.clips.push(c); } };
  const label = 'Add ' + t.name.toLowerCase(), opts = { select: clips.map(c => c.id) };
  if (preview) commitTentative(preview, label, put, opts); else commit(label, put, opts);
  // A title that animates in is invisible on its very first frame: a paused playhead sitting there steps past the entrance.
  const pl = player.current, first = clips[0];
  if (pl && first && !pl.playing) {
    const inDur = Math.max(0, ...clips.filter(c => c.start === first.start).map(c => c.animIn?.duration || 0));
    if (inDur && pl.t >= first.start - 1e-3 && pl.t < first.start + inDur) pl.seek(Math.min(first.start + inDur + 0.05, first.start + first.duration - 0.05));
  }
  previewHome = preview && pl ? { t0, spot: pl.t } : null;
}
// Takes an untouched template preview back off.
// rewind: put the playhead back where it was before the preview, so the next template starts at the same moment.
export function dropTemplatePreview({ rewind = false } = {}) {
  const h = previewHome, pl = player.current; previewHome = null;
  const dropped = dropTentative();
  // Only when another template follows (it steps past its own entrance again); otherwise a kept title would drop out of view.
  if (rewind && h && pl && !pl.playing && Math.abs(pl.t - h.spot) < 0.01) pl.seek(h.t0);
  return dropped;
}

// ---------------- Effects / Filters / Transitions ----------------
const useSourceThumb = () => { const c = primary.value; const a = c?.mediaId && asset(c.mediaId); return a?.thumb || null; };
// Effects work like filters, one step calmer: a click only tries an effect out in the player. Clicking another
// swaps the try-out. Nothing is on the project until Apply, which replaces what was there; "Add on top" is the
// one way to stack. What is applied is listed with a Remove effect button. Esc, a second click or leaving the
// tab ends a try-out. Dragging an effect onto a clip is deliberate, so it applies straight away.
// What the Effects and Filters tabs need from the clock: which layer is under the playhead and whether the
// selected clips are. They read these rather than the time itself, so an open tab re-renders when one of
// them changes instead of on every frame of playback.
const effectsClock = computed(() => { const p = project.value, t = time.value; if (!p) return ''; const { clips, layer } = effectTarget(p, t); return (layer?.id || '') + '|' + (clips.some(c => t >= c.start - 1e-3 && t < clipEnd(c)) ? 1 : 0); });
const filterLayerNow = computed(() => { const p = project.value; return p ? filterLayersAt(p, time.value).at(-1)?.id ?? null : null; });
function EffectsTab() {
  const [prev, setPrev] = useState({}); const src = useSourceThumb();
  useEffect(() => { effectPreviews(src).then(setPrev); }, [src]);
  useEffect(() => () => { effectPick.value = null; }, []);
  const p = project.value, pick = effectPick.value; effectsClock.value; selection.value; const t = time.peek();
  const { clips, layer } = effectTarget(p, t);
  const targets = clips.length ? clips : layer ? [layer] : [];
  const applied = [...new Set(targets.flatMap(c => (c.effects || []).map(e => e.id)))];
  const what = clips.length > 1 ? `${clips.length} selected clips` : clips.length ? (clips[0].kind === 'adjust' ? 'the selected effect layer' : `“${(clips[0].name || clips[0].text || 'the selected clip').slice(0, 28)}”`) : layer ? 'the effect layer under the playhead' : 'the whole picture, as a new effect layer at the playhead';
  const groups = [...new Set(EFFECTS.map(e => e.group))];
  const pickDef = pick && EFFECTS.find(e => e.id === pick.id);
  const tryOut = e => {
    if (pick?.id === e.id) { effectPick.value = null; return; }
    if (e.clipOnly && !clips.some(c => c.kind !== 'adjust')) return toast('Select a clip to try camera shake.', 'warn');
    effectPick.value = { id: e.id, stack: false, at: time.value };
  };
  const apply = stack => { const id = pick.id; effectPick.value = null; if (applyEffect(id, { stack })) toast(`${pickDef.name} ${stack ? 'added on top' : 'applied'}. Adjust it under Effects on the right. Ctrl+Z to undo.`); };
  // The try-out shows where it would go; say so when the playhead is somewhere else.
  const offscreen = pick && clips.length > 0 && !clips.some(c => t >= c.start - 1e-3 && t < clipEnd(c));
  const others = pick ? applied.filter(id => id !== pick.id) : [];
  return <div class="tab-body fx-tab">
    <Head title="Effects" />
    <p class="muted hint">Click an effect to preview it on <b>{what}</b>. Nothing changes until you press <b>Apply</b>. Drag one onto a clip to apply it straight away.</p>
    {applied.length > 0 && <div class="fx-applied" role="region" aria-label="Applied effects">
      <small class="muted">{applied.length > 1 ? 'Applied effects' : 'Applied effect'}</small>
      {applied.map(id => <div key={id} class="row"><Sparkles size={13} class="accentc" /><b class="grow ellipsis">{EFFECTS.find(e => e.id === id)?.name || id}</b><button class="btn sm fx-remove" onClick={() => removeEffect(id)}><X size={12} />Remove effect</button></div>)}
      {applied.length > 1 && <button class="btn sm ghost" onClick={() => removeEffect()}><Trash2 size={12} />Remove all effects</button>}
    </div>}
    {pickDef && <div class="look-card fx-card" role="region" aria-label={`${pickDef.name} effect`}>
      <div class="look-card-head"><div class="grow"><b class="ellipsis">{pickDef.name}</b><small class="muted">Preview · not applied yet</small></div>
        <button class="btn primary sm fx-apply" onClick={() => apply(false)}>{others.length ? 'Replace' : 'Apply'}</button>
        <button class="icon-btn sm" aria-label="Cancel preview" data-tip="Stop previewing without changing anything" data-kbd="Esc" onClick={() => { effectPick.value = null; }}><X size={14} /></button></div>
      {others.length > 0 && <label class="check-row fx-stack"><span>Preview on top of {others.map(id => EFFECTS.find(e => e.id === id)?.name).join(' + ')}</span><input type="checkbox" checked={!!pick.stack} onChange={e => { effectPick.value = { ...pick, stack: e.target.checked }; }} /></label>}
      {others.length > 0 && <div class="row"><small class="muted grow">{pick.stack ? 'Add on top keeps the current effects and stacks this one over them.' : `Replace swaps ${others.length > 1 ? 'the current effects' : 'the current effect'} for this one.`}</small><button class="btn sm fx-add-top" onClick={() => apply(true)}><Plus size={12} />Add on top</button></div>}
      {offscreen && <small class="warnc">Move the playhead over the clip to see the preview.</small>}
    </div>}
    {groups.map(g => <div key={g}><h4 class="group-title">{g}</h4><div class="tile-grid">{EFFECTS.filter(e => e.group === g).map(e => <button key={e.id} class={`tile fx-tile ${pick?.id === e.id ? 'on' : ''} ${applied.includes(e.id) ? 'applied' : ''}`} aria-pressed={pick?.id === e.id} data-tip={pick?.id === e.id ? 'Previewing · click again to stop' : applied.includes(e.id) ? `${e.name} · applied` : `Preview ${e.name}`} draggable onDragStart={ev => dragPayload(ev, { type: 'effect', id: e.id })} onClick={() => tryOut(e)}>{prev[e.id] ? <img src={prev[e.id]} alt="" draggable={false} /> : <div class="ph" />}{applied.includes(e.id) && <b class="look-on" aria-label="Applied"><Check size={11} /></b>}<span>{e.name}</span></button>)}</div></div>)}
  </div>;
}
function FiltersTab() {
  const [prev, setPrev] = useState({}); const src = useSourceThumb(); const sel = primary.value;
  // What a click changes and what Remove takes off: the selected clip, or else the filter layer under the playhead.
  const onClip = sel && !['audio', 'text'].includes(sel.kind), layer = onClip ? null : (filterLayerNow.value, filterLayersAt(project.value, time.peek()).at(-1));
  const current = onClip ? sel.filter?.id : layer?.filter?.id;
  useEffect(() => { filterPreviews(src).then(setPrev); }, [src]);
  const groups = [...new Set(FILTERS.map(f => f.group))];
  const importLut = async () => { const f = await pickFile({ title: 'Import LUT', extensions: ['cube'] }); if (!f?.path) return; try { await api('/api/luts/import', { paths: [f.path] }); userLuts.value = await api('/api/luts'); toast('LUT imported. Find it under My LUTs.'); } catch (e) { toast(e.message, 'error'); } };
  return <div class="tab-body">
    <Head title="Filters">{native && <button class="btn sm" onClick={importLut}><Upload size={13} />Import LUT</button>}</Head>
    <p class="muted hint">{sel && !['audio', 'text'].includes(sel.kind) ? <>Click to apply to <b>{sel.name || 'the selected clip'}</b>. Adjust strength in the inspector.</> : 'Click to add a filter layer at the playhead, or select a clip first.'}</p>
    {current && <button class="btn sm" style={{ marginBottom: 10 }} onClick={removeFilter}><X size={13} />{onClip && sel.kind !== 'adjust' ? 'Remove filter from clip' : 'Remove filter'}</button>}
    {userLuts.value.length > 0 && <><h4 class="group-title">My LUTs</h4><div class="tile-grid">{userLuts.value.map(l => <button key={l.id} class={`tile fx-tile ${current === l.id ? 'on' : ''}`} onClick={() => applyFilter(l.id, l.name)} draggable onDragStart={e => dragPayload(e, { type: 'filter', id: l.id, name: l.name })}><div class="ph lut"><Palette size={18} /></div><span>{l.name}</span></button>)}</div></>}
    {groups.map(g => <div key={g}><h4 class="group-title">{g}</h4><div class="tile-grid">{FILTERS.filter(f => f.group === g).map(f => <button key={f.id} class={`tile fx-tile ${current === f.id ? 'on' : ''}`} draggable onDragStart={e => dragPayload(e, { type: 'filter', id: f.id, name: f.name })} onClick={() => applyFilter(f.id, f.name)}>{prev[f.id] ? <img src={prev[f.id]} alt="" draggable={false} /> : <div class="ph" />}<span>{f.name}</span></button>)}</div></div>)}
  </div>;
}

// ---------------- Captions ----------------
// Captions moved to Captions.jsx (shared caption engine). The subtitle parser below is still used there.
export function parseSubtitles(text) {
  const src = String(text).replace(/^﻿/, '').replace(/\r/g, '');
  const sec = s => { const a = s.trim().replace(',', '.').split(':').map(Number); return a.reduce((v, n) => v * 60 + n, 0); };
  const out = [];
  if (/^\[Script Info\]/m.test(src) || /^Dialogue:/m.test(src)) {
    for (const line of src.split('\n')) { const m = /^Dialogue:\s*[^,]*,([^,]+),([^,]+),(?:[^,]*,){6}(.*)$/.exec(line); if (m) { const t = m[3].replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').trim(); if (t) out.push({ start: sec(m[1]), end: sec(m[2]), text: t }); } }
    return out.filter(c => c.end > c.start).sort((a, b) => a.start - b.start);
  }
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)/.exec(lines[i]); if (!m) continue;
    const body = []; while (i + 1 < lines.length && lines[i + 1].trim()) body.push(lines[++i]);
    const start = sec(m[1]), end = sec(m[2]); const t = body.join('\n').replace(/<[^>]+>/g, '').trim(); if (end > start && t) out.push({ start, end, text: t });
  }
  return out;
}

// ---------------- Templates ----------------
// Title templates in a few collapsible categories: open the ones you want, the rest stay as one-line headers.
// Searching opens every category that has a match. The Style options (colours, font, animation, position, size,
// length) restyle every preview tile live and are applied when a template is added; they stay folded away until
// asked for, and anything changed shows as a chip that puts it back with one click. All remembered on this computer.
const TPL_FONTS = [['original', 'Original font'], ...['Inter', 'Montserrat', 'Poppins', 'Anton', 'Playfair Display', 'Georgia', 'Impact', 'Segoe UI'].map(f => [f, f])];
const TPL_DEFAULTS = { theme: 'original', font: 'original', anim: 'original', pos: 'original', size: '1', length: 'original' };
const TPL_OPTS = [['theme', 'Colours', TEMPLATE_THEMES.map(([k, n]) => [k, n])], ['font', 'Font', TPL_FONTS], ['anim', 'Animation', TEMPLATE_ANIMS], ['pos', 'Position', TEMPLATE_POSITIONS], ['size', 'Size', TEMPLATE_SIZES], ['length', 'Length', TEMPLATE_LENGTHS]];
const TPL_LOOKS = 'Project looks';
function TemplatesTab() {
  const [q, setQuery] = useState(''), [shut, setShut] = useState([]);
  const setQ = v => { setQuery(v); setShut([]); };
  const saved = ui.value.tplOpts || {}; const o = Object.fromEntries(Object.keys(TPL_DEFAULTS).map(k => [k, saved[k] ?? TPL_DEFAULTS[k]]));
  const set = (k, v) => setUi({ tplOpts: { ...o, [k]: v } });
  const active = TPL_OPTS.filter(([k]) => o[k] !== TPL_DEFAULTS[k]); const optsOpen = !!ui.value.tplOptsOpen;
  const needle = q.trim().toLowerCase(); const has = s => !needle || s.toLowerCase().includes(needle);
  const sections = [
    ...TEMPLATE_CATEGORIES.map(c => ({ id: c, list: TEXT_TEMPLATES.filter(t => t.cat === c && has(t.name + ' ' + t.cat + ' ' + t.items.map(i => i.text).join(' '))) })),
    { id: TPL_LOOKS, looks: true, list: PROJECT_TEMPLATES.filter(t => has(t.name + ' ' + t.hint + ' ' + TPL_LOOKS)) },
  ].filter(s => s.list.length);
  // While searching, every category with a match is open (closing one then lasts for that search only).
  const openIds = ui.value.tplOpen || [TEMPLATE_CATEGORIES[0]];
  const isOpen = id => (needle ? !shut.includes(id) : openIds.includes(id));
  const flip = (list, id) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const toggle = id => (needle ? setShut(flip(shut, id)) : setUi({ tplOpen: flip(openIds, id) }));
  const allOpen = sections.length > 0 && sections.every(s => isOpen(s.id));
  const toggleAll = () => (needle ? setShut(allOpen ? sections.map(s => s.id) : []) : setUi({ tplOpen: allOpen ? [] : sections.map(s => s.id) }));
  // Clicking a template tries it out; clicking another swaps it; Esc, a second click or leaving this tab takes it off.
  useEffect(() => {
    const key = e => { if (e.key === 'Escape' && tentativeKey.peek()) dropTemplatePreview(); };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); dropTemplatePreview(); };
  }, []);
  const tile = t => { const c = customizeTemplate(t, o), first = c.items[0]; return <button key={t.id} class={`tile text-tile ${tentativeKey.value === 'tpl:' + t.id ? 'on' : ''}`} aria-pressed={tentativeKey.value === 'tpl:' + t.id} data-tip={`${t.name} · ${t.items.length > 1 ? t.items.length + ' parts' : '1 part'}${t.sequence ? ', one after another' : ''}`} onClick={() => { const same = tentativeKey.peek() === 'tpl:' + t.id; dropTemplatePreview({ rewind: true }); if (!same) addTextTemplate(c, time.value, { preview: 'tpl:' + t.id }); }} draggable onDragStart={e => dragPayload(e, { type: 'textTemplate', id: t.id, tpl: c })}><TextPreview style={first.style} text={first.text.split('\n')[0].slice(0, 16)} /><span>{t.name}</span></button>; };
  // A look is only chosen by a click: the player shows the project with it on (a preview), its card says what it
  // would add, and nothing changes until Apply. The preview ends when the card closes, the section folds or you leave.
  const pick = lookPick.value, setPick = v => { lookPick.value = v; };
  const pickShown = sections.some(s => s.looks && isOpen(s.id) && s.list.some(t => t.id === pick));
  // While paused, the playhead moves to a moment where the look's first title is on screen, and goes back afterwards
  // unless you moved it yourself in the meantime.
  const home = useRef(null), spot = useRef(null);
  const goHome = () => { const pl = player.current; if (pl && home.current !== null && !pl.playing && Math.abs(pl.t - spot.current) < 0.01) pl.seek(Math.min(home.current, pl.duration())); home.current = null; };
  useEffect(() => { if (pick && !pickShown) lookPick.value = null; }, [pick, pickShown]);
  useEffect(() => {
    const pl = player.current; if (!pl) return; pl.invalidate();
    const t = PROJECT_TEMPLATES.find(x => x.id === pick);
    if (!t) return goHome();
    if (pl.playing || appliedLook(project.peek()) === pick) return;
    if (home.current === null) home.current = pl.t;
    pl.seek(Math.min(...(t.titles?.length ? t.titles : [{ at: 0 }]).map(x => x.at || 0)) + 1.2); spot.current = pl.t;
  }, [pick]);
  useEffect(() => () => { lookPick.value = null; player.current?.invalidate(); goHome(); }, []);
  const onLook = appliedLook(project.value);
  const look = t => <button key={t.id} class={`tile look-tile ${pick === t.id ? 'on' : ''}`} aria-pressed={pick === t.id} data-tip={onLook === t.id ? `${t.hint} · on your project now` : t.hint} onClick={() => setPick(pick === t.id ? null : t.id)}><div class={`ph tpl-swatch tpl-${t.id}`} style={t.swatch ? { background: t.swatch } : undefined}><i>{t.ratio}</i>{onLook === t.id && <b class="look-on" aria-label="Applied"><Check size={11} /></b>}</div><span>{t.name}</span></button>;
  return <div class="tab-body tpl-tab">
    <Head title="Templates">{sections.length > 0 && <button class="icon-btn sm" data-tip={allOpen ? 'Collapse all' : 'Expand all'} aria-label={allOpen ? 'Collapse all categories' : 'Expand all categories'} onClick={toggleAll}>{allOpen ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}</button>}</Head>
    <div class="asset-tools"><SearchBox value={q} onInput={setQ} placeholder="Search templates" />
      <button class={`btn sm tpl-style-btn ${optsOpen ? 'on' : ''}`} aria-expanded={optsOpen} data-tip="Change the colours, font, animation, position, size or length of every template before you add it" onClick={() => setUi({ tplOptsOpen: !optsOpen })}><SlidersHorizontal size={13} />Style{active.length > 0 && <b>{active.length}</b>}</button></div>
    {optsOpen ? <div class="tpl-options">
      {TPL_OPTS.map(([k, label, opts]) => <Select key={k} label={label} value={o[k]} options={opts} onChange={v => set(k, v)} />)}
      {active.length > 0 && <button class="btn sm ghost" onClick={() => setUi({ tplOpts: { ...TPL_DEFAULTS } })}><RotateCcw size={12} />Reset style</button>}
    </div> : active.length > 0 && <div class="tpl-active">{active.map(([k, label, opts]) => <button key={k} class="fchip on" data-tip={`Back to the original ${label.toLowerCase()}`} onClick={() => set(k, TPL_DEFAULTS[k])}>{opts.find(x => x[0] === o[k])?.[1] || label}<X size={11} /></button>)}</div>}
    {!sections.length && <p class="muted hint">No templates match “{q}”.</p>}
    {sections.map(s => { const open = isOpen(s.id); return <section key={s.id} class={`tpl-sec ${open ? 'open' : ''}`}>
      <button class="tpl-sec-head" aria-expanded={open} onClick={() => toggle(s.id)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span class="grow ellipsis">{s.id}</span><small>{s.list.length}</small></button>
      {open && (s.looks ? <div class="tpl-sec-body"><p class="muted hint">Click a look to preview it in the player. Nothing changes until you press <b>Apply</b>.</p><div class="tile-grid three">{s.list.map(look)}</div>{s.list.some(t => t.id === pick) && <LookCard t={s.list.find(t => t.id === pick)} onClose={() => setPick(null)} />}</div>
        : <div class="tpl-sec-body"><div class="tile-grid two">{s.list.map(tile)}</div></div>)}
    </section>; })}
    <p class="muted hint tpl-foot">Click to try one; move or edit it to keep it. Drag to the timeline to add it straight away.</p>
  </div>;
}
// The look that is on the project now (its clips are tagged), so applying another one replaces it instead of piling up.
const appliedLook = p => p?.clips.find(c => c.fromLook)?.fromLook || null;
function lookAdds(t, p) {
  const n = (t.titles || []).filter(x => TEXT_TEMPLATES.some(d => d.id === x.tpl)).length;
  const filt = FILTERS.find(f => f.id === t.look)?.name, cap = CAPTION_PRESETS.find(c => c.id === t.captions)?.name;
  return [
    n > 0 && (n > 1 ? `${n} titles` : 'a title'),
    (filt || t.vignette) && (filt ? `the ${filt} colour look${t.vignette ? ' with a vignette' : ''}` : 'a vignette'),
    cap && `${cap} captions`,
    t.ratio !== p.settings.ratio && !p.clips.some(c => c.kind === 'video') && `a ${t.ratio} frame`,
  ].filter(Boolean).join(', ');
}
// Small card pinned under the looks: what the chosen look would add, and the one button that actually applies it.
function LookCard({ t, onClose }) {
  const p = project.value, on = appliedLook(p), isOn = on === t.id, prev = !isOn && PROJECT_TEMPLATES.find(x => x.id === on);
  return <div class="look-card" role="region" aria-label={`${t.name} look`}>
    <div class="look-card-head"><span class={`tpl-swatch tpl-${t.id}`} style={t.swatch ? { background: t.swatch } : undefined} /><div class="grow"><b class="ellipsis">{t.name}</b><small class={isOn ? 'accentc' : 'muted'}>{isOn ? 'On your project' : 'Preview · not applied yet'}</small></div>
      {isOn ? <button class="btn sm" onClick={() => removeProjectLook(t)}>Remove</button> : <button class="btn primary sm" onClick={() => applyProjectTemplate(t)}>{prev ? 'Replace' : 'Apply'}</button>}
      <button class="icon-btn sm" aria-label="Close" data-tip="Close without changing anything" onClick={onClose}><X size={14} /></button></div>
    <small class="muted">{isOn ? 'Remove takes its titles and colour look off again.' : <>Adds {lookAdds(t, p)}.{prev ? ` Replaces “${prev.name}”.` : ''}</>} Your clips stay as they are.</small>
  </div>;
}
// Takes the look's clips off, and the tracks that were only there for them.
function dropLook(p) {
  const used = new Set(p.clips.filter(c => c.fromLook).map(c => c.trackId)); if (!used.size) return;
  p.clips = p.clips.filter(c => !c.fromLook);
  p.tracks = p.tracks.filter(tr => !used.has(tr.id) || p.clips.some(c => c.trackId === tr.id) || (tr.kind !== 'effect' && !p.tracks.some(o => o !== tr && o.kind === tr.kind && !o.captions && !used.has(o.id))));
}
function removeProjectLook(t) {
  commit('Remove look ' + t.name, dropLook);
  toast(`${t.name} removed.`);
}
// Puts a look on a project draft: its titles, colour layer, caption style and (while there is no video) its frame.
function putLook(p, t) {
  const tp = projectFromTemplate(t);
  dropLook(p); // one look at a time: the previous one goes first
  for (const tr of tp.tracks) if (!p.tracks.some(x => x.id === tr.id) && tr.kind !== 'video' && tr.kind !== 'audio') p.tracks.splice(tr.kind === 'effect' ? 0 : p.tracks.findIndex(x => x.kind !== 'effect'), 0, { ...tr });
  const end = Math.max(10, ...p.clips.map(clipEnd));
  for (const c of tp.clips) { const n = structuredClone(c); n.fromLook = t.id; if (n.kind === 'adjust') n.duration = end; const tr = p.tracks.find(x => x.id === n.trackId) ? n.trackId : freeTrack(p, n.kind === 'adjust' ? 'effect' : 'text', n.start, n.start + n.duration).id; n.trackId = p.clips.some(o => o.trackId === tr && o.start < n.start + n.duration && clipEnd(o) > n.start) ? freeTrack(p, n.kind === 'adjust' ? 'effect' : 'text', n.start, n.start + n.duration).id : tr; p.clips.push(n); }
  if (t.ratio !== p.settings.ratio && !p.clips.some(c => c.kind === 'video')) p.settings.ratio = t.ratio;
  if (tp.captionPreset) p.captionPreset = tp.captionPreset;
}
function applyProjectTemplate(t) {
  commit('Apply template ' + t.name, p => { putLook(p, t); });
  toast(`${t.name} applied. Undo with Ctrl+Z.`);
}
// The project as the viewer shows it while a look is being tried out: a copy with that look on. Never saved.
let lookMemo = { p: null, id: null, r: null };
export function withLookPreview(p) {
  const id = lookPick.value; if (!id || !p || appliedLook(p) === id) return p;
  if (lookMemo.p !== p || lookMemo.id !== id) { const t = PROJECT_TEMPLATES.find(x => x.id === id); let r = p; if (t) { r = structuredClone(p); putLook(r, t); } lookMemo = { p, id, r }; }
  return lookMemo.r;
}
export const previewedLook = p => { const id = lookPick.value; return id && p && appliedLook(p) !== id ? PROJECT_TEMPLATES.find(x => x.id === id) || null : null; };
