// Left panel: creative asset browser (media, audio, text, stickers, effects, transitions, filters, captions, templates).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Film, Music, Type, Smile, Sparkles, Blend, Palette, Captions, LayoutTemplate, Plus, Upload, Search, Star, TriangleAlert, FolderOpen, Trash2, Mic, Square, Play, Pause, Image as ImageIcon, Link2, Gauge, Layers, LoaderCircle, Wand2, FileText, Download, Languages, X } from 'lucide-preact';
import { libraryTab, project, media, asset, commit, toast, time, player, selection, primary, prefs, userLuts, fonts } from '../lib/state.js';
import { api, native, importFiles, pickFile, waitJob } from '../lib/api.js';
import { addAssets, addText, addSticker, applyEffect, applyFilter, applyTransition, insertCaptions, trackOf } from '../lib/edit.js';
import { openMenu, Empty, Segmented, Select, Progress, confirm, useDraft } from './kit.jsx';
import { importMedia } from './commands.jsx';
import { TEXT_PRESETS, CAPTION_PRESETS, EMOJI, SHAPE_STICKERS, EFFECTS, TRANSITIONS, FILTERS, CAPTION_STYLE, TEXT_STYLE } from '../../shared/catalog.mjs';
import { TEXT_TEMPLATES, textTemplateClips, PROJECT_TEMPLATES, projectFromTemplate } from '../../shared/templates.mjs';
import { clipEnd, newClip, mainTrack } from '../../shared/model.mjs';
import { renderText, svgUrl } from '../engine/raster.js';
import { filterPreviews, effectPreviews } from './previews.js';
import { shortTime, bytes } from '../lib/format.js';
import { transcribe, groupWords } from '../lib/whisper.js';
import { freeTrack } from '../lib/edit.js';

const TABS = [['media', 'Media', Film], ['audio', 'Audio', Music], ['text', 'Text', Type], ['stickers', 'Stickers', Smile], ['effects', 'Effects', Sparkles], ['transitions', 'Transitions', Blend], ['filters', 'Filters', Palette], ['captions', 'Captions', Captions], ['templates', 'Templates', LayoutTemplate]];
export const dragPayload = (e, data) => { e.dataTransfer.setData('application/x-framecut', JSON.stringify(data)); e.dataTransfer.effectAllowed = 'copy'; window.__fcDrag = data; };

export function AssetPanel() {
  const tab = libraryTab.value;
  return <div class="assets">
    <nav class="asset-rail" aria-label="Asset categories">{TABS.map(([id, label, Icon]) => <button key={id} class={`rail-btn ${tab === id ? 'on' : ''}`} onClick={() => (libraryTab.value = id)} aria-pressed={tab === id}><Icon size={18} /><span>{label}</span></button>)}</nav>
    <div class="asset-content">{{ media: <MediaTab />, audio: <AudioTab />, text: <TextTab />, stickers: <StickerTab />, effects: <EffectsTab />, transitions: <TransitionsTab />, filters: <FiltersTab />, captions: <CaptionsTab />, templates: <TemplatesTab /> }[tab]}</div>
  </div>;
}
const Head = ({ title, children }) => <div class="asset-head"><h2>{title}</h2><div class="grow" />{children}</div>;
const SearchBox = ({ value, onInput, placeholder = 'Search' }) => <div class="search"><Search size={14} /><input class="input" type="search" placeholder={placeholder} value={value} onInput={e => onInput(e.target.value)} /></div>;

// ---------------- Media ----------------
function MediaTab() {
  const p = project.value; const [q, setQ] = useState(''), [kind, setKind] = useState('all'), [scope, setScope] = useState('project'), [over, setOver] = useState(false), [busy, setBusy] = useState(false);
  const all = [...media.value.values()];
  const list = all.filter(a => (scope === 'all' || p.mediaIds.includes(a.id)) && (kind === 'all' || (kind === 'fav' ? p.favorites.includes(a.id) : a.kind === kind)) && a.name.toLowerCase().includes(q.toLowerCase()) && a.kind !== 'audio' || (a.kind === 'audio' && kind === 'audio' && (scope === 'all' || p.mediaIds.includes(a.id)) && a.name.toLowerCase().includes(q.toLowerCase())));
  const missing = all.filter(a => a.missing && p.mediaIds.includes(a.id));
  const drop = async e => {
    e.preventDefault(); setOver(false); if (!e.dataTransfer.files.length) return;
    setBusy(true);
    try { const r = await importFiles([...e.dataTransfer.files]); if (r.errors.length) toast(r.errors.map(x => `${x.name}: ${x.error}`).join('\n'), 'error'); if (r.assets.length) { commit('Import media', d => { for (const a of r.assets) if (!d.mediaIds.includes(a.id)) d.mediaIds.push(a.id); }); const m = new Map(media.value); for (const a of r.assets) m.set(a.id, a); media.value = m; } }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return <div class={`tab-body ${over ? 'drop-over' : ''}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={e => !e.currentTarget.contains(e.relatedTarget) && setOver(false)} onDrop={drop}>
    <Head title="Media"><button class="btn primary sm" onClick={() => importMedia()}><Upload size={14} />Import</button></Head>
    {missing.length > 0 && <div class="notice warn"><TriangleAlert size={15} /><div><b>{missing.length} file{missing.length > 1 ? 's are' : ' is'} missing.</b> They were moved or renamed. <button class="btn sm" onClick={() => relinkFolder()}>Find in folder…</button></div></div>}
    <div class="asset-tools"><SearchBox value={q} onInput={setQ} placeholder="Search media" /><Segmented value={scope} options={[['project', 'Project'], ['all', 'Library']]} onChange={setScope} /></div>
    <div class="filter-chips">{[['all', 'All'], ['video', 'Videos'], ['image', 'Photos'], ['audio', 'Audio'], ['fav', '★ Favorites']].map(([k, l]) => <button key={k} class={`fchip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>)}</div>
    {busy && <div class="row muted" style={{ margin: '8px 0' }}><LoaderCircle size={14} class="spin" />Importing…</div>}
    {!list.length ? <div class="dropzone" onClick={() => importMedia()}><Upload size={26} /><b>{all.length && scope === 'project' ? 'Nothing here yet' : 'Bring your footage in'}</b><span>Drop videos, photos or music here, or click to browse.<br />Files are linked — never copied.</span>{scope === 'project' && all.some(a => !p.mediaIds.includes(a.id)) && <button class="btn sm" onClick={e => { e.stopPropagation(); setScope('all'); }}>Show my whole library</button>}</div>
      : <div class="media-grid">{list.map(a => <MediaCard key={a.id} a={a} fav={p.favorites.includes(a.id)} used={p.clips.some(c => c.mediaId === a.id)} />)}</div>}
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
function MediaCard({ a, fav, used }) {
  const [hover, setHover] = useState(null);
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
    { divider: true },
    { text: used ? 'Remove from project (in use)' : 'Remove from project', icon: Trash2, danger: true, disabled: used, onClick: () => commit('Remove media', p => { p.mediaIds = p.mediaIds.filter(x => x !== a.id); }) },
  ];
  return <div class={`media-card ${a.missing ? 'missing' : ''}`} draggable={!a.missing} tabIndex={0} aria-label={a.name}
    onDragStart={e => dragPayload(e, { type: 'media', id: a.id })} onDblClick={() => add()} onKeyDown={e => e.key === 'Enter' && add()} onContextMenu={e => openMenu(e, menuItems)}
    onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover((e.clientX - r.left) / r.width); }} onPointerLeave={() => setHover(null)}>
    <div class="media-thumb">
      {frame !== null ? <div class="strip-frame" style={{ backgroundImage: `url(${strip.url})`, backgroundSize: `${strip.count * 100}% 100%`, backgroundPosition: `${(frame / Math.max(1, strip.count - 1)) * 100}% 0` }} />
        : a.thumb ? <img src={a.thumb} alt="" loading="lazy" draggable={false} /> : a.svg ? <img src={a.url} alt="" draggable={false} /> : <div class="thumb-icon">{a.kind === 'audio' ? <Music size={22} /> : a.kind === 'image' ? <ImageIcon size={22} /> : <LoaderCircle size={20} class="spin" />}</div>}
      {a.kind !== 'image' && <span class="badge dur">{shortTime(a.duration)}</span>}
      {used && <span class="badge used" data-tip="Used in this project">●</span>}
      {fav && <Star size={13} class="fav" fill="currentColor" />}
      {a.missing && <div class="missing-overlay"><TriangleAlert size={16} />Missing<button class="btn sm" onClick={e => { e.stopPropagation(); relinkOne(a); }}>Relink</button></div>}
      {a.proxyPending && <span class="badge proxy" data-tip="Preparing a smooth playback copy"><LoaderCircle size={10} class="spin" /></span>}
      {!a.missing && <button class="add-btn" data-tip="Add to timeline" aria-label="Add to timeline" onClick={e => { e.stopPropagation(); add(); }}><Plus size={15} /></button>}
    </div>
    <div class="media-name ellipsis" title={a.name}>{a.name}</div>
  </div>;
}

// ---------------- Audio ----------------
function AudioTab() {
  const p = project.value; const [q, setQ] = useState(''), [playingId, setPlayingId] = useState(null); const audioRef = useRef(null);
  const list = [...media.value.values()].filter(a => a.audio && (p.mediaIds.includes(a.id)) && a.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (a.kind === 'audio' ? -1 : 1) - (b.kind === 'audio' ? -1 : 1));
  const preview = a => { if (!audioRef.current) audioRef.current = new Audio(); const el = audioRef.current; if (playingId === a.id) { el.pause(); setPlayingId(null); return; } el.src = a.url; el.currentTime = 0; el.play().catch(() => {}); el.onended = () => setPlayingId(null); setPlayingId(a.id); };
  useEffect(() => () => audioRef.current?.pause(), []);
  return <div class="tab-body">
    <Head title="Audio"><button class="btn primary sm" onClick={() => importMedia()}><Upload size={14} />Import</button></Head>
    <Recorder />
    <div class="asset-tools"><SearchBox value={q} onInput={setQ} placeholder="Search sounds" /></div>
    {!list.length ? <Empty icon={Music} title="No audio yet" text="Import music or sound effects, record a voiceover, or drag a video with sound onto an audio track." />
      : <div class="audio-list">{list.map(a => <div key={a.id} class="audio-row" draggable onDragStart={e => dragPayload(e, { type: 'media', id: a.id, asAudio: true })} onDblClick={() => addAudio(a)}>
        <button class="icon-btn" aria-label={playingId === a.id ? 'Stop preview' : 'Preview'} onClick={() => preview(a)}>{playingId === a.id ? <Pause size={15} /> : <Play size={15} />}</button>
        <div class="grow ellipsis"><div class="ellipsis">{a.name}</div><small class="muted">{shortTime(a.duration)} · {a.kind === 'audio' ? 'Audio' : 'From video'}</small></div>
        <button class="icon-btn" data-tip="Add at playhead" onClick={() => addAudio(a)}><Plus size={16} /></button>
      </div>)}</div>}
  </div>;
}
function addAudio(a) {
  if (a.kind === 'audio') return addAssets([a]);
  // Sound from a video file goes onto an audio track.
  const c = newClip('audio', { mediaId: a.id, name: a.name.replace(/\.[^.]+$/, '') + ' (audio)', start: time.value, duration: a.duration });
  commit('Add audio', p => { c.trackId = freeTrack(p, 'audio', c.start, clipEnd(c)).id; p.clips.push(c); }, { select: [c.id] });
}
function Recorder() {
  const [state, setState] = useState('idle'), [count, setCount] = useState(0), [elapsed, setElapsed] = useState(0), [level, setLevel] = useState(0);
  const rec = useRef(null);
  const start = async () => {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { return toast('FrameCut couldn’t use a microphone. Check that one is connected and allowed in Windows privacy settings.', 'error'); }
    setState('count');
    for (let i = 3; i > 0; i--) { setCount(i); await new Promise(r => setTimeout(r, 700)); }
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' }); const chunks = []; const at = time.value;
    const ctx = new AudioContext(); const an = ctx.createAnalyser(); ctx.createMediaStreamSource(stream).connect(an); const buf = new Uint8Array(an.fftSize);
    const t0 = performance.now(); const meter = setInterval(() => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); setLevel(m / 128); setElapsed((performance.now() - t0) / 1000); }, 80);
    mr.ondataavailable = e => chunks.push(e.data);
    mr.onstop = async () => {
      clearInterval(meter); stream.getTracks().forEach(t => t.stop()); ctx.close(); player.current?.pause(); if (player.current?.master) player.current.master.gain.value = 1;
      setState('saving');
      try {
        const name = `Voiceover ${new Date().toLocaleTimeString().replace(/:/g, '.')}.webm`;
        const r = await importFiles([new File(chunks, name, { type: 'audio/webm' })]);
        const a = r.assets[0]; if (!a) throw Error(r.errors[0]?.error || 'Recording could not be saved.');
        const m = new Map(media.value); m.set(a.id, a); media.value = m;
        const c = newClip('audio', { mediaId: a.id, name: 'Voiceover', start: at, duration: a.duration });
        commit('Record voiceover', p => { c.trackId = freeTrack(p, 'audio', at, at + a.duration).id; p.clips.push(c); if (!p.mediaIds.includes(a.id)) p.mediaIds.push(a.id); }, { select: [c.id] });
        toast('Voiceover added to the timeline.');
      } catch (e) { toast(e.message, 'error'); } finally { setState('idle'); }
    };
    rec.current = mr; mr.start(250); setState('rec');
    // Play the timeline (muted) so you can narrate over the picture.
    if (player.current) { player.current.audio(); player.current.master.gain.value = 0; player.current.play(); }
  };
  const stop = () => rec.current?.state === 'recording' && rec.current.stop();
  return <div class={`recorder ${state}`}>
    {state === 'idle' && <button class="btn block" onClick={start}><Mic size={15} />Record voiceover at playhead</button>}
    {state === 'count' && <div class="rec-count">Recording in <b>{count}</b></div>}
    {state === 'rec' && <div class="row"><span class="rec-dot" /><b class="mono">{shortTime(elapsed)}</b><div class="level"><div style={{ width: Math.min(100, level * 140) + '%' }} /></div><button class="btn danger sm" onClick={stop}><Square size={12} fill="currentColor" />Stop</button></div>}
    {state === 'saving' && <div class="row muted"><LoaderCircle size={14} class="spin" />Saving recording…</div>}
  </div>;
}

// ---------------- Text ----------------
function TextPreview({ style, text = 'Aa' }) {
  const url = useMemo(() => { const r = renderText({ text, style: { ...TEXT_STYLE, ...style, size: 0.32 }, caption: false }, 300, 120); return r.canvas.toDataURL(); }, [JSON.stringify(style), text]);
  return <img src={url} alt="" draggable={false} />;
}
function TextTab() {
  const [q, setQ] = useState('');
  return <div class="tab-body">
    <Head title="Text" />
    <button class="add-text-hero" onClick={() => addText()} draggable onDragStart={e => dragPayload(e, { type: 'text', style: {} })}><Plus size={18} /><div><b>Add text</b><small>Click, or drag to the timeline · <span class="kbd">T</span></small></div></button>
    <h4 class="group-title">Styles</h4>
    <div class="tile-grid">{TEXT_PRESETS.map(t => <button key={t.id} class="tile text-tile" draggable onDragStart={e => dragPayload(e, { type: 'text', style: t.style })} onClick={() => addText({ style: t.style, text: 'Your text' })} data-tip={t.name}><TextPreview style={t.style} /><span>{t.name}</span></button>)}</div>
    <h4 class="group-title">Animated titles</h4>
    <div class="tile-grid two">{TEXT_TEMPLATES.map(t => <button key={t.id} class="tile text-tile" onClick={() => addTextTemplate(t)} draggable onDragStart={e => dragPayload(e, { type: 'textTemplate', id: t.id })}><TextPreview style={t.items[0].style} text={t.items[0].text.split('\n')[0].slice(0, 14)} /><span>{t.name}</span></button>)}</div>
  </div>;
}
export function addTextTemplate(t, at = time.value) {
  const clips = textTemplateClips(t, at);
  commit('Add ' + t.name.toLowerCase(), p => { for (const c of clips) { const tr = p.tracks.find(x => x.kind === 'text' && !x.captions && !x.locked && !p.clips.some(o => o.trackId === x.id && o.start < clipEnd(c) && clipEnd(o) > c.start)); c.trackId = (tr || freeTrack(p, 'text', c.start, clipEnd(c))).id; p.clips.push(c); } }, { select: clips.map(c => c.id) });
}

// ---------------- Stickers ----------------
function StickerTab() {
  const [cat, setCat] = useState('Shapes');
  const cats = ['Shapes', ...Object.keys(EMOJI)];
  return <div class="tab-body">
    <Head title="Stickers" />
    <div class="filter-chips">{cats.map(c => <button key={c} class={`fchip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>
    {cat === 'Shapes' ? <div class="tile-grid">{SHAPE_STICKERS.map(s => <button key={s.id} class="tile sticker-tile" data-tip={s.name} draggable onDragStart={e => dragPayload(e, { type: 'sticker', sticker: { type: 'shape', value: s.id } })} onClick={() => addSticker({ type: 'shape', value: s.id, name: s.name })}><img src={svgUrl(s.svg)} alt={s.name} draggable={false} /></button>)}</div>
      : <div class="emoji-grid">{EMOJI[cat].map(e => <button key={e} class="emoji" draggable onDragStart={ev => dragPayload(ev, { type: 'sticker', sticker: { type: 'emoji', value: e } })} onClick={() => addSticker({ type: 'emoji', value: e })}>{e}</button>)}</div>}
    <p class="muted hint">Stickers can bounce, pulse or spin — select one and open <b>Animation</b>.</p>
  </div>;
}

// ---------------- Effects / Filters / Transitions ----------------
const useSourceThumb = () => { const c = primary.value; const a = c?.mediaId && asset(c.mediaId); return a?.thumb || null; };
function EffectsTab() {
  const [prev, setPrev] = useState({}); const src = useSourceThumb(); const sel = primary.value;
  useEffect(() => { effectPreviews(src).then(setPrev); }, [src]);
  const groups = [...new Set(EFFECTS.map(e => e.group))];
  return <div class="tab-body">
    <Head title="Effects" />
    <p class="muted hint">{sel && sel.kind !== 'audio' ? <>Click to add to <b>{sel.name || 'the selected clip'}</b>. </> : 'Click to add an effect layer at the playhead, or drag onto a clip. '}</p>
    {groups.map(g => <div key={g}><h4 class="group-title">{g}</h4><div class="tile-grid">{EFFECTS.filter(e => e.group === g).map(e => <button key={e.id} class="tile fx-tile" draggable onDragStart={ev => dragPayload(ev, { type: 'effect', id: e.id })} onClick={() => applyEffect(e.id)}>{prev[e.id] ? <img src={prev[e.id]} alt="" draggable={false} /> : <div class="ph" />}<span>{e.name}</span></button>)}</div></div>)}
  </div>;
}
function FiltersTab() {
  const [prev, setPrev] = useState({}); const src = useSourceThumb(); const sel = primary.value;
  useEffect(() => { filterPreviews(src).then(setPrev); }, [src]);
  const groups = [...new Set(FILTERS.map(f => f.group))];
  const importLut = async () => { const f = await pickFile({ title: 'Import LUT', extensions: ['cube'] }); if (!f?.path) return; try { await api('/api/luts/import', { paths: [f.path] }); userLuts.value = await api('/api/luts'); toast('LUT imported. Find it under My LUTs.'); } catch (e) { toast(e.message, 'error'); } };
  return <div class="tab-body">
    <Head title="Filters">{native && <button class="btn sm" onClick={importLut}><Upload size={13} />Import LUT</button>}</Head>
    <p class="muted hint">{sel && !['audio', 'text'].includes(sel.kind) ? <>Click to apply to <b>{sel.name || 'the selected clip'}</b>. Adjust strength in the inspector.</> : 'Click to add a filter layer at the playhead, or select a clip first.'}</p>
    {sel?.filter?.id && <button class="btn sm" style={{ marginBottom: 10 }} onClick={() => commit('Remove filter', p => { const c = p.clips.find(x => x.id === sel.id); c.filter = { id: null, intensity: 1 }; })}><X size={13} />Remove filter from clip</button>}
    {userLuts.value.length > 0 && <><h4 class="group-title">My LUTs</h4><div class="tile-grid">{userLuts.value.map(l => <button key={l.id} class={`tile fx-tile ${sel?.filter?.id === l.id ? 'on' : ''}`} onClick={() => applyFilter(l.id, l.name)} draggable onDragStart={e => dragPayload(e, { type: 'filter', id: l.id, name: l.name })}><div class="ph lut"><Palette size={18} /></div><span>{l.name}</span></button>)}</div></>}
    {groups.map(g => <div key={g}><h4 class="group-title">{g}</h4><div class="tile-grid">{FILTERS.filter(f => f.group === g).map(f => <button key={f.id} class={`tile fx-tile ${sel?.filter?.id === f.id ? 'on' : ''}`} draggable onDragStart={e => dragPayload(e, { type: 'filter', id: f.id, name: f.name })} onClick={() => applyFilter(f.id, f.name)}>{prev[f.id] ? <img src={prev[f.id]} alt="" draggable={false} /> : <div class="ph" />}<span>{f.name}</span></button>)}</div></div>)}
  </div>;
}
function TransitionsTab() {
  const groups = [...new Set(TRANSITIONS.map(t => t.group))];
  return <div class="tab-body">
    <Head title="Transitions" />
    <p class="muted hint">Drag onto the cut between two clips, or click to add at the cut nearest the playhead. Hover to preview.</p>
    {groups.map(g => <div key={g}><h4 class="group-title">{g}</h4><div class="tile-grid">{TRANSITIONS.filter(t => t.group === g).map(t => <button key={t.id} class="tile tr-tile" draggable onDragStart={e => dragPayload(e, { type: 'transition', id: t.id })} onClick={() => applyTransition(t.id)}><div class={`tr-demo tr-${t.id}`}><i class="a" /><i class="b" /><i class="dip" /></div><span>{t.name}</span></button>)}</div></div>)}
  </div>;
}

// ---------------- Captions ----------------
function CaptionsTab() {
  const p = project.value;
  const capTrack = p.tracks.find(t => t.captions);
  const caps = capTrack ? p.clips.filter(c => c.trackId === capTrack.id).sort((a, b) => a.start - b.start) : [];
  const [job, setJob] = useState(null), [lang, setLang] = useState(''), [scope, setScope] = useState('all');
  const abort = useRef(null);
  const sources = () => {
    const sel = p.clips.filter(c => selection.value.includes(c.id) && (c.kind === 'video' || c.kind === 'audio') && asset(c.mediaId)?.audio);
    if (scope === 'selected') return sel;
    const tr = id => p.tracks.find(t => t.id === id);
    return p.clips.filter(c => (c.kind === 'video' || c.kind === 'audio') && !c.muted && !tr(c.trackId)?.muted && asset(c.mediaId)?.audio && (c.kind === 'audio' || !c.detachedAudio));
  };
  const generate = async () => {
    const list = sources(); if (!list.length) return toast(scope === 'selected' ? 'Select a clip with speech first.' : 'Add a video or audio clip with speech first.', 'warn');
    const ctl = new AbortController(); abort.current = ctl;
    try {
      const all = [];
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        setJob({ i, n: list.length, msg: 'Preparing…', p: null });
        const r = await transcribe({ mediaId: c.mediaId, from: c.in, to: c.in + c.duration * (c.speed || 1), model: prefs.value.captionModel || 'base', language: lang || undefined, signal: ctl.signal, onProgress: d => setJob({ i, n: list.length, msg: d.message, p: d.progress ?? null }) });
        // map source time → timeline time
        for (const w of r.words) all.push({ start: c.start + (w.start - c.in) / (c.speed || 1), end: c.start + (w.end - c.in) / (c.speed || 1), text: w.text });
      }
      all.sort((a, b) => a.start - b.start);
      if (!all.length) { toast('No speech was found.', 'warn'); return; }
      const lines = groupWords(all).map(l => ({ ...l, words: l.words.map(w => ({ start: w.start - l.start, end: w.end - l.start, text: w.text })) }));
      const lo = Math.min(...list.map(c => c.start)), hi = Math.max(...list.map(clipEnd));
      const preset = CAPTION_PRESETS.find(x => x.id === p.captionPreset);
      insertCaptions(lines, { replaceRange: [lo, hi], style: preset?.style });
      toast(`${lines.length} captions added. Click any caption to edit its text.`);
    } catch (e) { if (!e.cancelled) toast('Captions could not be generated: ' + e.message, 'error'); }
    finally { setJob(null); abort.current = null; }
  };
  const importSubs = async () => {
    const f = await pickFile({ title: 'Import subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }); if (!f) return;
    const text = f.file ? await f.file.text() : await (await fetch('/api/read-text?path=' + encodeURIComponent(f.path))).text().catch(() => '');
    const segs = parseSubtitles(text); if (!segs.length) return toast('No timed captions were found in that file.', 'error');
    insertCaptions(segs); toast(`${segs.length} captions imported.`);
  };
  const exportSrt = () => {
    if (!caps.length) return;
    const ts = s => { const ms = Math.round(s * 1000); const p2 = (n, l = 2) => String(n).padStart(l, '0'); return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor(ms / 60000) % 60)}:${p2(Math.floor(ms / 1000) % 60)},${p2(ms % 1000, 3)}`; };
    const blob = new Blob([caps.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(clipEnd(c))}\n${c.text}\n`).join('\n')], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = p.name + '.srt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const applyPreset = pr => commit('Caption style', d => { d.captionPreset = pr.id; for (const c of d.clips) if (capTrack && c.trackId === capTrack.id) c.style = { ...CAPTION_STYLE, ...pr.style }; });
  return <div class="tab-body">
    <Head title="Captions" />
    <div class="caption-gen">
      <div class="row"><Wand2 size={17} class="accentc" /><b class="grow">Auto captions</b><span class="chip">On this computer</span></div>
      <p class="muted">Whisper listens to your clips and writes timed, editable captions.</p>
      <div class="field-row"><Select value={scope} options={[['all', 'All clips with sound'], ['selected', 'Selected clips only']]} onChange={setScope} /><Select value={lang} options={[['', 'Detect language'], ['english', 'English'], ['spanish', 'Spanish'], ['french', 'French'], ['german', 'German'], ['italian', 'Italian'], ['portuguese', 'Portuguese'], ['japanese', 'Japanese'], ['korean', 'Korean'], ['chinese', 'Chinese'], ['russian', 'Russian'], ['hindi', 'Hindi'], ['arabic', 'Arabic']]} onChange={setLang} /></div>
      {job ? <div class="col"><div class="row"><span class="grow ellipsis">{job.msg}{job.n > 1 ? ` · clip ${job.i + 1} of ${job.n}` : ''}</span><button class="btn sm" onClick={() => abort.current?.abort()}>Cancel</button></div><Progress value={job.p ?? 0} indeterminate={job.p === null} /></div>
        : <button class="btn primary block" onClick={generate}><Captions size={15} />Generate captions</button>}
    </div>
    <div class="row" style={{ margin: '12px 0' }}><button class="btn sm grow" onClick={importSubs}><FileText size={13} />Import .srt / .vtt</button><button class="btn sm grow" disabled={!caps.length} onClick={exportSrt}><Download size={13} />Save .srt</button></div>
    <h4 class="group-title">Style</h4>
    <div class="tile-grid three">{CAPTION_PRESETS.map(pr => <button key={pr.id} class={`tile text-tile ${p.captionPreset === pr.id ? 'on' : ''}`} onClick={() => applyPreset(pr)}><TextPreview style={{ ...CAPTION_STYLE, ...pr.style, highlight: false, color: pr.style.highlight ? pr.style.highlightColor : (pr.style.color || '#fff') }} text="Hello" /><span>{pr.name}</span></button>)}</div>
    <h4 class="group-title row">Captions <span class="muted">{caps.length || ''}</span>{caps.length > 0 && <button class="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={async () => { if (await confirm({ title: 'Remove all captions?', text: 'You can undo this.', ok: 'Remove', danger: true })) commit('Remove captions', d => { d.clips = d.clips.filter(c => c.trackId !== capTrack.id); }); }}>Clear</button>}</h4>
    {!caps.length ? <p class="muted">No captions yet.</p> : <div class="caption-list">{caps.map(c => <CaptionRow key={c.id} c={c} />)}</div>}
  </div>;
}
function CaptionRow({ c }) {
  const [text, setText] = useDraft(c.text);
  const active = time.value >= c.start && time.value < clipEnd(c);
  return <div class={`caption-row ${active ? 'on' : ''} ${selection.value.includes(c.id) ? 'sel' : ''}`} onClick={() => { player.current?.seek(c.start + 0.001); selection.value = [c.id]; }}>
    <span class="mono muted">{shortTime(c.start)}</span>
    <textarea class="cap-text" rows={1} value={text} onInput={e => setText(e.target.value)} onBlur={e => { const v = e.target.value; if (v !== c.text) commit('Edit caption', p => { const x = p.clips.find(k => k.id === c.id); x.text = v; const n = v.split(/\s+/).filter(Boolean).length; if (x.words && x.words.length !== n) x.words = null; x.name = v.slice(0, 40); }); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); } }} />
  </div>;
}
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
function TemplatesTab() {
  return <div class="tab-body">
    <Head title="Templates" />
    <h4 class="group-title">Animated titles</h4>
    <div class="tile-grid two">{TEXT_TEMPLATES.map(t => <button key={t.id} class="tile text-tile" onClick={() => addTextTemplate(t)} draggable onDragStart={e => dragPayload(e, { type: 'textTemplate', id: t.id })}><TextPreview style={t.items[0].style} text={t.items[0].text.split('\n')[0].slice(0, 14)} /><span>{t.name}</span></button>)}</div>
    <h4 class="group-title">Project looks</h4>
    <p class="muted hint">Adds the template’s titles and color look to this project. Your clips stay as they are.</p>
    <div class="tpl-list">{PROJECT_TEMPLATES.map(t => <button key={t.id} class="tpl-item" onClick={() => applyProjectTemplate(t)}><span class={`tpl-swatch tpl-${t.id}`} /><div><b>{t.name}</b><small class="muted">{t.hint}</small></div></button>)}</div>
  </div>;
}
function applyProjectTemplate(t) {
  const tp = projectFromTemplate(t);
  commit('Apply template ' + t.name, p => {
    const offset = 0;
    for (const tr of tp.tracks) if (!p.tracks.some(x => x.id === tr.id) && tr.kind !== 'video' && tr.kind !== 'audio') p.tracks.splice(tr.kind === 'effect' ? 0 : p.tracks.findIndex(x => x.kind !== 'effect'), 0, { ...tr });
    const end = Math.max(10, ...p.clips.map(clipEnd));
    for (const c of tp.clips) { const n = structuredClone(c); n.start += offset; if (n.kind === 'adjust') n.duration = end; const tr = p.tracks.find(x => x.id === n.trackId) ? n.trackId : freeTrack(p, n.kind === 'adjust' ? 'effect' : 'text', n.start, n.start + n.duration).id; n.trackId = p.clips.some(o => o.trackId === tr && o.start < n.start + n.duration && clipEnd(o) > n.start) ? freeTrack(p, n.kind === 'adjust' ? 'effect' : 'text', n.start, n.start + n.duration).id : tr; p.clips.push(n); }
    if (t.ratio !== p.settings.ratio && !p.clips.some(c => c.kind === 'video')) p.settings.ratio = t.ratio;
    if (tp.captionPreset) p.captionPreset = tp.captionPreset;
  });
  toast(`${t.name} applied. Undo with Ctrl+Z.`);
}
