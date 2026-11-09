// Captions panel: Generate → Transcript → Style → Animation, all on the shared caption engine.
// One click generates good-looking captions; every change can target all captions, a track, a
// caption or a single word, and inherited values stay editable at the higher levels.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Wand2, Captions as CaptionsIcon, Search, Replace, Scissors, Merge, Play, Repeat, RotateCcw, Copy, ClipboardPaste, Star, Save, Check, TriangleAlert, LoaderCircle, FileText, Download, Music2, ChevronDown, ChevronRight, Sparkles, Type, Layers, Trash2, X } from 'lucide-preact';
import { project, selection, time, player, prefs, savePrefs, toast, commit, libraryTab } from '../lib/state.js';
import { Segmented, Select, Slider, Toggle, Color, Progress, confirm, prompt, openMenu } from './kit.jsx';
import { scriptSuggestions, applySuggestions } from '../lib/captions.js';
import { capScope, capWord, genState, lastResult, allPresets, userPresets, captionClips, capTrackOf, effOf, scopeTarget, scopeLabel, setCap, resetScope, applyPreset, setPopIntensity, saveAsPreset, toggleFavorite, setDefaultPreset, deletePreset, copyStyle, pasteStyle, editWord, setWordTiming, splitCaption, mergeWithNext, searchReplace, regroup, generateCaptions, captionSources, seekWord, nowWord, isCap } from '../lib/captions.js';
import { ENTRANCES, EMPHASES, EXITS, POP_INTENSITY, resolveCaption, captionMotion, wordOverlays, CAPTION_PRESETS_V2 } from '../../shared/captions.mjs';
import { evaluate } from '../../shared/expr.mjs';
import { renderCaptionBase, renderCaptionWord, ensureFont } from '../engine/captionRaster.js';
import { insertCaptions } from '../lib/edit.js';
import { parseSubtitles } from './AssetPanel.jsx';
import { shortTime } from '../lib/format.js';
import { clipEnd } from '../../shared/model.mjs';

const LANGS = [['', 'Detect automatically'], ['English', 'English'], ['Spanish', 'Spanish'], ['French', 'French'], ['German', 'German'], ['Italian', 'Italian'], ['Portuguese', 'Portuguese'], ['Dutch', 'Dutch'], ['Japanese', 'Japanese'], ['Korean', 'Korean'], ['Chinese', 'Chinese'], ['Russian', 'Russian'], ['Hindi', 'Hindi'], ['Arabic', 'Arabic'], ['Turkish', 'Turkish'], ['Polish', 'Polish']];
const FONTS = ['Inter', 'Montserrat', 'Poppins', 'Anton', 'Playfair Display', 'Segoe UI', 'Arial Black', 'Impact', 'Georgia', 'Consolas'];
const POSITIONS = [['top', 'Top', -0.36], ['above-hud', 'Above game HUD', 0.18], ['middle', 'Middle', 0], ['bottom', 'Bottom', 0.34]];
export const capTab = { value: 'generate' };

export function CaptionsPanel() {
  const [tab, setTab] = useState(() => (captionClips(project.value).length ? 'style' : 'generate'));
  useEffect(() => { window.__fcOpenCaptions = () => setTab('style'); return () => { window.__fcOpenCaptions = null; }; }, []);
  const p = project.value, caps = captionClips(p);
  return <div class="tab-body cap-panel">
    <div class="asset-head"><h2>Captions</h2><div class="grow" />{caps.length > 0 && <span class="chip">{caps.length} captions</span>}</div>
    <div class="lib-tabs"><Segmented label="Caption tools" value={tab} options={[['generate', 'Generate'], ['transcript', 'Transcript'], ['style', 'Style'], ['animation', 'Animation']]} onChange={setTab} /></div>
    {tab === 'generate' ? <Generate onDone={() => setTab('style')} /> : !caps.length ? <NoCaptions go={() => setTab('generate')} /> : tab === 'transcript' ? <Transcript /> : tab === 'style' ? <StylePanel /> : <AnimationPanel />}
  </div>;
}
const NoCaptions = ({ go }) => <div class="lib-state"><CaptionsIcon size={22} /><b>No captions yet</b><span>Generate them from your video’s speech, or import an .srt / .vtt file.</span><button class="btn sm primary" onClick={go}><Wand2 size={13} />Generate captions</button></div>;

// ---------------------------------------------------------------- Generate
function Generate({ onDone }) {
  const p = project.value, pr = prefs.value;
  const [source, setSource] = useState('auto'), [lang, setLang] = useState(pr.captionLanguage || ''), [quality, setQuality] = useState(pr.captionQuality || 'best');
  const [lyrics, setLyrics] = useState(pr.captionLyrics !== false), [adv, setAdv] = useState(false), [vocab, setVocab] = useState(pr.captionVocabulary || '');
  const [engine, setEngine] = useState(null); const abort = useRef(null);
  useEffect(() => { fetch('/api/captions/engine').then(r => r.json()).then(setEngine).catch(() => setEngine({ ready: false })); }, []);
  const audioTracks = p.tracks.filter(t => t.kind === 'audio' && p.clips.some(c => c.trackId === t.id));
  const sources = [['auto', p.tracks.some(t => t.voice) ? 'Voice tracks (music left out)' : 'All clips with sound'], ['all', 'Everything you can hear'], ['selected', 'Selected clips only'], ...audioTracks.map(t => ['track:' + t.id, 'Track: ' + t.name])];
  const n = captionSources(p, source).length, gs = genState.value;
  const go = async () => {
    savePrefs({ captionLanguage: lang, captionQuality: quality, captionVocabulary: vocab }).catch(() => {});
    const ctl = new AbortController(); abort.current = ctl;
    try { const r = await generateCaptions({ source, language: lang, quality, lyrics, vocabulary: vocab, signal: ctl.signal }); if (r?.words?.length) onDone(); }
    catch (e) { if (!e.cancelled) toast('Captions could not be generated: ' + e.message, 'error', { timeout: 10000 }); }
  };
  const importSubs = async () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.srt,.vtt,.ass,.ssa';
    input.onchange = async () => { const f = input.files[0]; if (!f) return; const segs = parseSubtitles(await f.text()); if (!segs.length) return toast('No timed captions were found in that file.', 'error'); insertCaptions(segs); toast(`${segs.length} captions imported.`); onDone(); };
    input.click();
  };
  return <>
    <div class="caption-gen">
      <div class="row"><Wand2 size={17} class="accentc" /><b class="grow">Auto captions</b><span class="chip">{engine?.ready ? 'On this computer' : engine ? 'Built-in engine' : '…'}</span></div>
      <div class="field"><label>Listen to</label><Select value={source} options={sources} onChange={setSource} /><small class="muted">{n ? `${n} clip${n > 1 ? 's' : ''}` : 'No audible clips match'}</small></div>
      <div class="field-row">
        <div class="field"><label>Language</label><Select value={lang} options={LANGS} onChange={setLang} /></div>
        <div class="field"><label>Quality</label><Segmented value={quality} options={[['best', 'Best'], ['fast', 'Fast']]} onChange={setQuality} /></div>
      </div>
      <Toggle label={<span class="row"><Music2 size={13} />Include song lyrics</span>} on={lyrics} onChange={v => { setLyrics(v); savePrefs({ captionLyrics: v }).catch(() => {}); }} hint="On: real singing is captioned too. Instrumental music and sound effects never are. Off: spoken words only." />
      <button class="btn ghost sm adv-toggle" onClick={() => setAdv(!adv)}>{adv ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Advanced</button>
      {adv && <div class="col">
        <div class="field"><label>Words to recognize (names, terms)</label><textarea class="input" rows={2} value={vocab} placeholder="FrameCut, Siobhan, Kubernetes…" onInput={e => setVocab(e.target.value)} /><small class="muted">Used as a hint — FrameCut never inserts words that weren’t spoken.</small></div>
        <small class="muted">Engine: {engine?.name || 'checking…'}{engine?.detail ? ` · ${engine.detail}` : ''}</small>
      </div>}
      {gs ? <div class="col"><div class="row"><span class="grow ellipsis">{gs.message}</span><button class="btn sm" onClick={() => abort.current?.abort()}>Cancel</button></div><Progress value={gs.progress ?? 0} indeterminate={!gs.progress} /></div>
        : <button class="btn primary block" disabled={!n} onClick={go}><CaptionsIcon size={15} />Generate captions</button>}
      {quality === 'best' && !gs && <small class="muted">Best quality checks every section for music and invented words, and flags anything uncertain for you to review.</small>}
    </div>
    {engine && !engine.ready && engine.setup && <EngineSetup engine={engine} onReady={setEngine} />}
    {lastResult.value?.regions && <ResultSummary r={lastResult.value} />}
    <div class="row" style={{ margin: '12px 0' }}><button class="btn sm grow" onClick={importSubs}><FileText size={13} />Import .srt / .vtt</button><button class="btn sm grow" disabled={!captionClips(p).length} onClick={() => exportSubs('srt')}><Download size={13} />Save .srt</button><button class="btn sm grow" disabled={!captionClips(p).length} onClick={() => exportSubs('vtt')}><Download size={13} />.vtt</button></div>
  </>;
}
function EngineSetup({ engine, onReady }) {
  const [busy, setBusy] = useState(null);
  const install = async () => {
    setBusy({ p: 0, msg: 'Starting…' });
    try {
      const { job } = await fetch('/api/captions/engine/install', { method: 'POST' }).then(r => r.json());
      for (;;) { const j = await fetch('/api/jobs/' + job).then(r => r.json()); setBusy({ p: j.progress, msg: j.message || 'Installing…' }); if (j.status === 'done') break; if (j.status === 'failed') throw Error(j.error); await new Promise(r => setTimeout(r, 600)); }
      onReady(await fetch('/api/captions/engine').then(r => r.json()));
    } catch (e) { toast('Setup failed: ' + e.message, 'error', { timeout: 12000 }); } finally { setBusy(null); }
  };
  return <div class="notice"><Sparkles size={15} /><div class="grow"><b>Get the best caption accuracy</b><div>{engine.setup}</div>
    {busy ? <div class="col" style={{ marginTop: 8 }}><span class="muted">{busy.msg}</span><Progress value={busy.p} indeterminate={!busy.p} /></div> : <button class="btn sm primary" style={{ marginTop: 8 }} onClick={install}>Set up ({engine.download || 'one-time download'})</button>}</div></div>;
}
function ResultSummary({ r }) {
  const music = r.regions.filter(x => x.kind === 'music' || x.kind === 'singing');
  return <div class="cap-result"><b>Last run</b> · {r.words.length} words · {r.language || 'language detected'} · {r.seconds ? r.seconds.toFixed(1) + ' s' : ''}
    {music.length > 0 && <div class="muted">Skipped {music.length} music / singing section{music.length > 1 ? 's' : ''}: {music.slice(0, 4).map(m => `${shortTime(m.start)}–${shortTime(m.end)}`).join(', ')}</div>}
    {r.words.some(w => w.flag) && <div class="muted"><TriangleAlert size={12} /> {r.words.filter(w => w.flag).length} uncertain words are underlined in the Transcript tab.</div>}
  </div>;
}
function exportSubs(kind) {
  const p = project.value, caps = captionClips(p);
  const ts = (s, sep) => { const ms = Math.round(s * 1000), q = (n, l = 2) => String(n).padStart(l, '0'); return `${q(Math.floor(ms / 3600000))}:${q(Math.floor(ms / 60000) % 60)}:${q(Math.floor(ms / 1000) % 60)}${sep}${q(ms % 1000, 3)}`; };
  const body = kind === 'vtt' ? 'WEBVTT\n\n' + caps.map(c => `${ts(c.start, '.')} --> ${ts(clipEnd(c), '.')}\n${c.text}\n`).join('\n') : caps.map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(clipEnd(c), ',')}\n${c.text}\n`).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain' })); a.download = `${p.name}.${kind}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- Transcript
function Transcript() {
  const p = project.value, caps = captionClips(p);
  const [find, setFind] = useState(''), [repl, setRepl] = useState(''), [onlyFlagged, setOnlyFlagged] = useState(false), [open, setOpen] = useState(null);
  const flagged = caps.reduce((n, c) => n + (c.words || []).filter(w => w.flag).length, 0);
  const list = onlyFlagged ? caps.filter(c => c.words?.some(w => w.flag)) : find ? caps.filter(c => c.text.toLowerCase().includes(find.toLowerCase())) : caps;
  return <>
    <div class="cap-search"><div class="search"><Search size={14} /><input class="input" type="search" placeholder="Find in captions" value={find} onInput={e => setFind(e.target.value)} /></div>
      <div class="row"><input class="input" placeholder="Replace with" value={repl} onInput={e => setRepl(e.target.value)} /><button class="btn sm" disabled={!find} onClick={() => { const n = searchReplace(find, repl); toast(n ? `Replaced ${n} word${n > 1 ? 's' : ''}. Timing kept.` : 'No whole-word matches.'); }}><Replace size={13} />Replace all</button></div></div>
    {flagged > 0 && <button class={`fchip ${onlyFlagged ? 'on' : ''}`} onClick={() => setOnlyFlagged(!onlyFlagged)}><TriangleAlert size={11} /> {flagged} to review</button>}
    {p.script?.text?.trim() && <ScriptCheck />}
    <CaptionTiming />
    <p class="muted hint">Click a word to jump there, double-click to fix its spelling (its timing stays). Right-click for split, merge and timing.</p>
    <div class="cap-list">{list.map(c => <CaptionGroup key={c.id} c={c} open={open === c.id} toggle={() => setOpen(open === c.id ? null : c.id)} />)}</div>
  </>;
}
// Global caption sync: moves every caption (and its word timing) earlier or later together. The total
// is remembered in the project so the slider shows it and can be reset; edits are undoable and, being
// ordinary clip positions, appear identically in the preview, the timeline and the export.
function CaptionTiming() {
  const p = project.value, shift = +(p.settings.captionShift || 0);
  const set = v => commit('Caption timing', d => {
    const caps = captionClips(d).filter(c => !d.tracks.find(t => t.id === c.trackId)?.locked); if (!caps.length) return false;
    const cur = +(d.settings.captionShift || 0);
    // Never push a caption before 0 s: limit how far everything can move earlier.
    const delta = Math.max(-Math.min(...caps.map(c => c.start)), (v - cur) / 1000); if (Math.abs(delta) < 1e-6) return false;
    for (const c of caps) c.start = +(c.start + delta).toFixed(4);
    d.settings.captionShift = Math.round(cur + delta * 1000);
  }, { key: 'capshift' });
  return <div class="field cap-timing">
    <Slider label="Caption timing (all captions)" min={-1000} max={1000} step={10} def={0} value={shift} fmt={v => (v === 0 ? 'in sync' : `${Math.abs(Math.round(v))} ms ${v < 0 ? 'earlier' : 'later'}`)} onChange={set} />
    <small class="muted">Captions showing up late? Drag left. Early? Drag right. Moves every caption together and keeps word timing.</small>
  </div>;
}
function CaptionGroup({ c, open, toggle }) {
  const p = project.value, active = time.value >= c.start && time.value < clipEnd(c), cur = active ? nowWord(c) : -1, sel = selection.value.includes(c.id);
  const [edit, setEdit] = useState(null);
  const pick = (i, e) => { selection.value = [c.id]; capWord.value = { clipId: c.id, i }; if (!e?.detail || e.detail === 1) seekWord(c, c.words[i]); };
  const loop = () => { const pl = player.current; if (!pl) return; pl.seek(c.start); pl.play(); const stop = setInterval(() => { if (!pl.playing) return clearInterval(stop); if (pl.t >= clipEnd(c)) pl.seek(c.start); }, 30); setTimeout(() => clearInterval(stop), 20000); };
  return <div class={`cap-group ${active ? 'on' : ''} ${sel ? 'sel' : ''}`} onContextMenu={e => openMenu(e, [{ text: 'Play this caption on loop', icon: Repeat, onClick: loop }, { text: 'Merge with next', icon: Merge, onClick: () => mergeWithNext(c.id) }, { text: 'Delete caption', icon: Trash2, danger: true, onClick: () => commit('Delete caption', d => { d.clips = d.clips.filter(x => x.id !== c.id); }) }])}>
    <div class="row cap-group-head"><button class="btn ghost sm mono" onClick={() => { selection.value = [c.id]; player.current?.seek(c.start + 0.001); }}>{shortTime(c.start)}</button><div class="grow" />
      <button class="icon-btn sm" data-tip="Play on loop" onClick={loop}><Repeat size={13} /></button>
      <button class="icon-btn sm" data-tip="Word timing" aria-expanded={open} onClick={toggle}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button></div>
    <div class="cap-words">{(c.words || []).length ? c.words.map((w, i) => edit === i
      ? <input key={i} class="input word-edit" autoFocus value={w.text} onKeyDown={e => { if (e.key === 'Enter') { editWord(c.id, i, e.target.value); setEdit(null); } if (e.key === 'Escape') setEdit(null); }} onBlur={e => { if (e.target.value !== w.text) editWord(c.id, i, e.target.value); setEdit(null); }} />
      : <span key={i} role="button" tabIndex={0} class={`cap-word ${i === cur ? 'now' : ''} ${w.flag ? 'flag' : ''} ${w.edited ? 'edited' : ''} ${capWord.value?.clipId === c.id && capWord.value.i === i ? 'picked' : ''}`}
        data-tip={w.flag ? `${w.flag === 'music' ? 'Heard over music' : w.flag === 'low' ? 'Low confidence' : w.flag === 'unsupported' ? 'Little speech detected here' : 'Check this word'}${w.orig ? ' · was “' + w.orig + '”' : ''}` : w.orig ? `Was “${w.orig}”` : null}
        onClick={e => pick(i, e)} onDblClick={() => setEdit(i)} onKeyDown={e => { if (e.key === 'Enter') setEdit(i); }}
        onContextMenu={e => { e.stopPropagation(); openMenu(e, [{ text: 'Fix spelling', icon: Type, onClick: () => setEdit(i) }, i > 0 && { text: 'Start a new caption here', icon: Scissors, onClick: () => splitCaption(c.id, i) }, { text: 'Merge with next caption', icon: Merge, onClick: () => mergeWithNext(c.id) }, { text: 'Style just this word…', icon: Sparkles, onClick: () => { capWord.value = { clipId: c.id, i }; capScope.value = 'word'; toast('Scope set to this word — change its color in Style.'); } }]); }}>{w.text}</span>)
      : <span class="muted">{c.text}</span>}</div>
    {open && <WordTimeline c={c} />}
  </div>;
}
// Drag word edges to fix timing; the preview jumps to the edge you move.
function WordTimeline({ c }) {
  const ref = useRef(); const span = c.duration;
  const drag = (e, i, edge) => {
    e.preventDefault(); e.stopPropagation(); const el = ref.current, r = el.getBoundingClientRect(); const w = c.words[i];
    const move = ev => { const t = Math.max(0, Math.min(span, (ev.clientX - r.left) / r.width * span)); if (edge === 'start') setWordTiming(c.id, i, t, w.end); else setWordTiming(c.id, i, w.start, t); player.current?.seek(c.start + t); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const u = time.value - c.start;
  return <div class="word-tl" ref={ref}>
    {c.words.map((w, i) => <div key={i} class={`wt-word ${w.timing === 'manual' ? 'manual' : ''} ${w.flag ? 'flag' : ''}`} style={{ left: (w.start / span * 100) + '%', width: (Math.max(0.01, w.end - w.start) / span * 100) + '%' }} data-tip={`${w.text} · ${w.start.toFixed(2)}–${w.end.toFixed(2)} s`}>
      <i class="wt-edge l" onPointerDown={e => drag(e, i, 'start')} /><span>{w.text}</span><i class="wt-edge r" onPointerDown={e => drag(e, i, 'end')} /></div>)}
    {u >= 0 && u <= span && <div class="wt-head" style={{ left: (u / span * 100) + '%' }} />}
  </div>;
}

// ---------------------------------------------------------------- Scope bar
function ScopeBar() {
  const tgt = scopeTarget(); const p = project.value;
  const hasSel = p.clips.some(c => selection.value.includes(c.id) && isCap(p, c));
  const opts = [['project', 'All'], ['track', 'Track'], ['caption', 'Caption'], ['word', 'Word']];
  return <div class="scope-bar">
    <Segmented label="Apply changes to" value={capScope.value} options={opts} onChange={v => { if (v === 'caption' && !hasSel) return toast('Select a caption on the timeline or in the transcript first.', 'warn'); if (v === 'word' && !capWord.value) return toast('Click a word in the transcript first.', 'warn'); capScope.value = v; }} />
    <div class="row scope-note"><span class={`scope-dot s-${tgt.level}`} /><span class="grow">Changes apply to <b>{scopeLabel(tgt)}</b>{tgt.level === 'word' ? ` (“${p.clips.find(c => c.id === tgt.clipId)?.words?.[tgt.i]?.text || ''}”)` : ''}</span><button class="btn ghost sm" data-tip="Remove changes made at this level, so it follows the level above again" onClick={resetScope}><RotateCcw size={12} />Reset</button></div>
  </div>;
}
const effNow = () => { const p = project.value, tgt = scopeTarget(); const c = tgt.clipIds ? p.clips.find(x => x.id === tgt.clipIds[0]) : tgt.clipId ? p.clips.find(x => x.id === tgt.clipId) : captionClips(p, tgt.trackId)[0] || null; const e = effOf(p, tgt.level === 'project' ? { trackId: null } : c); if (tgt.level === 'word' && c?.words?.[tgt.i]?.style) e.style = { ...e.style, ...c.words[tgt.i].style }; return e; };

// ---------------------------------------------------------------- Style
function StylePanel() {
  const p = project.value, e = effNow(), s = e.style, tgt = scopeTarget(), word = tgt.level === 'word';
  const fav = prefs.value.captionFavorites || [], def = prefs.value.captionDefault || 'word-pop';
  const presets = allPresets().sort((a, b) => fav.includes(b.id) - fav.includes(a.id));
  const set = (k, label) => v => setCap('style', k, v, { label });
  return <>
    <ScopeBar />
    {!word && <><h4 class="group-title">Styles</h4>
      <div class="preset-gallery">{presets.map(pr => <PresetCard key={pr.id} pr={pr} on={p.captions?.preset === pr.id && tgt.level === 'project'} fav={fav.includes(pr.id)} isDefault={def === pr.id} />)}</div>
      <div class="row wrap" style={{ margin: '8px 0' }}><button class="btn sm" onClick={async () => { const n = await prompt({ title: 'Save this caption style', label: 'Name', value: 'My style' }); if (n) saveAsPreset(n); }}><Save size={12} />Save as style</button><button class="btn sm" onClick={copyStyle}><Copy size={12} />Copy</button><button class="btn sm" onClick={pasteStyle}><ClipboardPaste size={12} />Paste</button></div></>}
    <h4 class="group-title">{word ? 'This word' : 'Text'}</h4>
    {!word && <><div class="field-row"><div class="field"><label>Font</label><Select value={s.font} options={FONTS} onChange={set('font', 'Caption font')} /></div><div class="field"><label>Weight</label><Select value={String(s.weight)} options={[['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold'], ['900', 'Black']]} onChange={v => setCap('style', 'weight', +v, { label: 'Caption weight' })} /></div></div>
      <Slider label="Size" value={s.size} min={0.025} max={0.14} step={0.001} def={0.058} fmt={v => Math.round(v * 1000) / 10 + '%'} onChange={set('size', 'Caption size')} />
      <div class="row"><Toggle label="UPPERCASE" on={s.uppercase} onChange={set('uppercase', 'Caption case')} /><Toggle label="Italic" on={s.italic} onChange={set('italic', 'Caption italic')} /></div>
      <Slider label="Letter spacing" value={s.letterSpacing} min={-0.05} max={0.2} step={0.005} def={0} onChange={set('letterSpacing', 'Letter spacing')} />
      <Slider label="Word spacing" value={s.wordSpacing} min={-0.1} max={0.6} step={0.01} def={0} onChange={set('wordSpacing', 'Word spacing')} /></>}
    <div class="color-row"><Color label="Text" value={s.color} onChange={set('color', 'Caption color')} swatches={false} /><Color label="Spoken word" value={s.activeColor} onChange={set('activeColor', 'Highlight color')} swatches={false} /><Color label="Outline" value={s.strokeColor} onChange={set('strokeColor', 'Outline color')} swatches={false} /></div>
    {!word && <><Slider label="Outline" value={s.strokeWidth} min={0} max={0.3} step={0.005} def={0.1} onChange={set('strokeWidth', 'Outline width')} />
      <Slider label="Shadow" value={s.shadowOpacity} min={0} max={1} step={0.01} def={0.55} fmt={v => Math.round(v * 100) + '%'} onChange={set('shadowOpacity', 'Shadow')} />
      <Slider label="Shadow softness" value={s.shadowBlur} min={0} max={1.2} step={0.01} def={0.35} onChange={set('shadowBlur', 'Shadow softness')} />
      <Slider label="Unspoken words" value={s.inactiveOpacity} min={0.2} max={1} step={0.01} def={1} fmt={v => Math.round(v * 100) + '%'} onChange={set('inactiveOpacity', 'Unspoken opacity')} />
      <h4 class="group-title">Background</h4>
      <div class="color-row"><Color label="Box" value={s.bgColor} onChange={set('bgColor', 'Caption box')} swatches={false} /><Color label="Spoken word box" value={s.activeBg} onChange={set('activeBg', 'Word box')} swatches={false} /></div>
      <Slider label="Box opacity" value={s.bgOpacity} min={0} max={1} step={0.01} def={0} fmt={v => Math.round(v * 100) + '%'} onChange={set('bgOpacity', 'Caption box')} />
      <Slider label="Box padding" value={s.bgPadX} min={0} max={1} step={0.01} def={0.4} onChange={v => { setCap('style', 'bgPadX', v, { label: 'Box padding' }); setCap('style', 'bgPadY', v * 0.45, { label: 'Box padding' }); }} />
      <Slider label="Corner radius" value={s.bgRadius} min={0} max={0.6} step={0.01} def={0.3} onChange={set('bgRadius', 'Box radius')} />
      <h4 class="group-title">Position</h4>
      <div class="row wrap">{POSITIONS.map(([id, label, y]) => <button key={id} class={`fchip ${Math.abs((s.y ?? 0) - y) < 0.02 ? 'on' : ''}`} onClick={() => setCap('style', 'y', y, { label: 'Caption position' })}>{label}</button>)}</div>
      <Slider label="Vertical" value={s.y} min={-0.48} max={0.48} step={0.005} def={0.34} fmt={v => Math.round((v + 0.5) * 100) + '%'} onChange={set('y', 'Caption position')} />
      <h4 class="group-title">Grouping</h4>
      <Segmented value={e.layout.grouping} options={[['auto', 'Auto'], ['word', '1 word'], ['phrase', 'Phrases'], ['sentence', 'Sentences']]} onChange={v => { setCap('layout', 'grouping', v, { label: 'Caption grouping' }); setTimeout(() => regroup(), 0); }} />
      <div class="field-row"><div class="field"><label>Max lines</label><Select value={String(e.layout.maxLines)} options={[['1', '1'], ['2', '2'], ['3', '3']]} onChange={v => { setCap('layout', 'maxLines', +v, { label: 'Max lines' }); setTimeout(() => regroup(), 0); }} /></div><div class="field"><label>Max words</label><Select value={String(e.layout.maxWords || 0)} options={[['0', 'Auto'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['8', '8'], ['10', '10']]} onChange={v => { setCap('layout', 'maxWords', +v, { label: 'Max words' }); setTimeout(() => regroup(), 0); }} /></div></div></>}
  </>;
}
// Live preview: the real caption engine (same rasters and motion expressions as the editor and export).
function PresetCard({ pr, on, fav, isDefault }) {
  const ref = useRef();
  useEffect(() => {
    const cv = ref.current; if (!cv) return; let raf, alive = true; const W = 320, H = 180;
    const fake = { tracks: [], captions: { preset: pr.id, overrides: { style: { y: 0 } } } };
    const eff = resolveCaption(fake, null, { presets: [pr] });
    const words = [{ text: 'Make', start: 0.2, end: 0.55 }, { text: 'it', start: 0.6, end: 0.8 }, { text: 'pop!', start: 0.85, end: 1.4 }];
    const clip = { text: eff.anim.emph?.type === 'none' && eff.layout.maxLines > 1 ? 'Make it pop!' : 'Make it pop!', words };
    ensureFont(eff.style).then(() => {
      if (!alive) return; const ctx = cv.getContext('2d'); const RH = 330; const base = renderCaptionBase(clip, eff, W, RH); // text sized as on a phone-sized frame
      const mo = captionMotion(eff.anim, 0.05, 1.8, { W, H }), ovs = wordOverlays(eff.anim, words, 0.05, 1.8);
      const t0 = performance.now();
      const draw = () => {
        if (!alive) return; const t = ((performance.now() - t0) / 1000) % 2.4;
        ctx.clearRect(0, 0, W, H);
        if (t >= 0.05 && t < 1.8) {
          let a = 1; for (const fd of mo.fades) { const k = Math.min(1, Math.max(0, (t - fd.st) / fd.d)); a *= fd.dir === 'in' ? k : 1 - k; }
          const gs = mo.s.reduce((v, s) => v * evaluate(s, { t }), 1), gx = mo.x.reduce((v, s) => v + evaluate(s, { t }) * W, 0), gy = mo.y.reduce((v, s) => v + evaluate(s, { t }) * H, 0);
          const cx = W / 2 + gx, cy = H / 2 + gy;
          ctx.globalAlpha = a; if (!mo.hidden) ctx.drawImage(base.canvas, cx - base.w * gs / 2, cy - base.h * gs / 2, base.w * gs, base.h * gs);
          for (const ov of ovs) if (t >= ov.from && t < ov.to) {
            const r = renderCaptionWord(clip, eff, ov.i, W, RH, ov.role), b = base.boxes[ov.i]; if (!r || !b) continue;
            const ws = gs * (ov.s ? evaluate(ov.s, { t }) : 1), wy = ov.y ? evaluate(ov.y, { t }) * H : 0;
            ctx.globalAlpha = a * (ov.fade ? Math.min(1, (t - ov.from) / ov.fade) : 1);
            ctx.drawImage(r.canvas, cx + b.x * gs - r.w * ws / 2, cy + b.y * gs + wy - r.h * ws / 2, r.w * ws, r.h * ws);
          }
          ctx.globalAlpha = 1;
        }
        raf = requestAnimationFrame(draw);
      };
      draw();
    });
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [pr.id, JSON.stringify(pr.style), JSON.stringify(pr.anim)]);
  return <div class={`preset-card ${on ? 'on' : ''}`} role="button" tabIndex={0} aria-pressed={on} data-tip={pr.hint} onClick={() => applyPreset(pr.id)} onKeyDown={e => e.key === 'Enter' && applyPreset(pr.id)}
    onContextMenu={e => openMenu(e, [{ text: 'Apply to all captions', icon: Check, onClick: () => applyPreset(pr.id) }, { text: fav ? 'Remove from favorites' : 'Favorite', icon: Star, onClick: () => toggleFavorite(pr.id) }, { text: isDefault ? 'Default for new captions ✓' : 'Use as default for new captions', icon: Sparkles, onClick: () => setDefaultPreset(pr.id) }, pr.custom && { text: 'Delete this style', icon: Trash2, danger: true, onClick: () => deletePreset(pr.id) }])}>
    <canvas ref={ref} width={320} height={180} aria-hidden="true" />
    <span class="row"><b class="grow ellipsis">{pr.name}</b>{fav && <Star size={11} fill="currentColor" class="accentc" />}{isDefault && <span class="chip" data-tip="Default for new captions">Default</span>}</span>
  </div>;
}

// ---------------------------------------------------------------- Animation
function AnimationPanel() {
  const e = effNow(), a = e.anim, word = scopeTarget().level === 'word';
  if (word) return <><ScopeBar /><p class="muted hint">Animations apply to whole captions. Choose Caption, Track or All captions above.</p></>;
  const emph = a.emph || {}, level = Object.entries(POP_INTENSITY).find(([, v]) => Math.abs(v.peak - (emph.peak ?? 0)) < 0.005)?.[0];
  return <>
    <ScopeBar />
    <AnimBlock title="Entrance" defs={ENTRANCES} spec={a.in} section="anim.in" />
    <h4 class="group-title">Word emphasis</h4>
    <Select value={emph.type || 'none'} options={EMPHASES.map(x => [x.id, x.name])} onChange={v => setCap('anim.emph', 'type', v, { label: 'Word emphasis', coalesce: false })} />
    {(emph.type === 'pop' || emph.type === 'pulse' || emph.type === 'background') && <><div class="field" style={{ marginTop: 8 }}><label>Intensity</label><Segmented value={level || 'custom'} options={[['subtle', 'Subtle'], ['balanced', 'Balanced'], ['energetic', 'Energetic'], ...(level ? [] : [['custom', 'Custom']])]} onChange={v => v !== 'custom' && setPopIntensity(v)} /></div></>}
    <Params def={EMPHASES.find(x => x.id === emph.type)} spec={emph} section="anim.emph" style={e.style} />
    <AnimBlock title="Exit" defs={EXITS} spec={a.out} section="anim.out" />
    <button class="btn sm block" style={{ marginTop: 10 }} onClick={() => { const p = project.value, c = p.clips.find(x => selection.value.includes(x.id) && isCap(p, x)) || captionClips(p).find(x => x.start >= time.value - 0.01) || captionClips(p)[0]; if (!c) return; const pl = player.current; pl.seek(c.start); pl.play(); setTimeout(() => pl.pause(), (c.duration + 0.3) * 1000); }}><Play size={13} />Preview a caption</button>
  </>;
}
function AnimBlock({ title, defs, spec = {}, section }) {
  return <><h4 class="group-title">{title}</h4><Select value={spec.type || 'none'} options={defs.map(x => [x.id, x.name])} onChange={v => setCap(section, 'type', v, { label: title, coalesce: false })} /><Params def={defs.find(x => x.id === spec.type)} spec={spec} section={section} /></>;
}
// Only the controls that affect the chosen animation.
function Params({ def, spec = {}, section, style }) {
  if (!def?.params?.length) return null;
  const set = k => v => setCap(section, k, v, { label: 'Animation ' + k });
  const P = {
    dur: () => <Slider key="dur" label="Duration" value={spec.dur ?? 0.15} min={0.04} max={1} step={0.01} fmt={v => v.toFixed(2) + ' s'} onChange={set('dur')} />,
    delay: () => <Slider key="delay" label="Delay" value={spec.delay ?? 0} min={0} max={0.5} step={0.01} fmt={v => v.toFixed(2) + ' s'} onChange={set('delay')} />,
    strength: () => <Slider key="strength" label="Strength" value={spec.strength ?? 0.5} min={0} max={1} step={0.01} fmt={v => Math.round(v * 100) + '%'} onChange={set('strength')} />,
    bounce: () => <Slider key="bounce" label="Bounce" value={spec.bounce ?? 0.45} min={0} max={1} step={0.01} fmt={v => Math.round(v * 100) + '%'} onChange={set('bounce')} />,
    ease: () => <Select key="ease" label="Easing" value={spec.ease || 'out'} options={[['out', 'Ease out'], ['inout', 'Ease in-out'], ['back', 'Overshoot'], ['linear', 'Linear']]} onChange={set('ease')} />,
    dir: () => <Segmented key="dir" value={spec.dir || 'up'} options={[['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→']]} onChange={set('dir')} />,
    from: () => <Slider key="from" label="Initial size" value={spec.from ?? 0.92} min={0.5} max={1.2} step={0.01} fmt={v => Math.round(v * 100) + '%'} onChange={set('from')} />,
    peak: () => <Slider key="peak" label="Peak size" value={spec.peak ?? 1.2} min={1} max={1.6} step={0.01} fmt={v => Math.round(v * 100) + '%'} onChange={set('peak')} />,
    settle: () => <Slider key="settle" label="Final size" value={spec.settle ?? 1} min={0.9} max={1.3} step={0.01} fmt={v => Math.round(v * 100) + '%'} onChange={set('settle')} />,
    overlap: () => <Toggle key="overlap" label="Let popping words overlap their neighbours" on={!!spec.allowOverlap} onChange={set('allowOverlap')} hint="Off: long words pop a little less so they never touch the next word. On: every word reaches the full peak size for a bolder look." />,
    persist: () => <Toggle key="persist" label="Keep words lit after they’re spoken" on={!!spec.persist} onChange={set('persist')} />,
    activeColor: () => style ? <Color key="ac" label="Spoken word color" value={style.activeColor} onChange={v => setCap('style', 'activeColor', v, { label: 'Highlight color' })} swatches={false} /> : null,
    activeBg: () => style ? <Color key="ab" label="Word box color" value={style.activeBg} onChange={v => setCap('style', 'activeBg', v, { label: 'Word box' })} swatches={false} /> : null,
    activeBgOpacity: () => style ? <Slider key="abo" label="Word box opacity" value={style.activeBgOpacity ?? 1} min={0} max={1} step={0.01} onChange={v => setCap('style', 'activeBgOpacity', v, { label: 'Word box' })} /> : null,
  };
  return <div class="anim-params">{def.params.map(k => P[k]?.())}</div>;
}

// Inspector for a selected caption: only what matters for captions.
export function CaptionInspector({ c }) {
  const p = project.value, e = effOf(p, c);
  const [text, setText] = useState(c.text); useEffect(() => setText(c.text), [c.id, c.text]);
  const flagged = (c.words || []).filter(w => w.flag).length;
  const openPanel = scope => { capScope.value = scope; libraryTab.value = 'captions'; setTimeout(() => window.__fcOpenCaptions?.(), 0); };
  return <div class="cap-insp">
    <div class="field"><label>Text</label><textarea class="input" rows={3} value={text} onInput={ev => { setText(ev.target.value); commit('Edit caption', d => { const x = d.clips.find(k => k.id === c.id); x.text = ev.target.value; x.name = ev.target.value.replace(/\n/g, ' ').slice(0, 40); }, { key: 'captext:' + c.id }); }} /><small class="muted">Changes show in the video as you type. Word timing is kept; new words are timed between their neighbours.</small></div>
    {(c.words || []).length > 0 && <div class="cap-words insp-words">{c.words.map((w, i) => <span key={i} class={`cap-word ${w.flag ? 'flag' : ''} ${w.timing === 'estimated' ? 'edited' : ''}`} data-tip={`${w.start.toFixed(2)}–${w.end.toFixed(2)} s${w.flag ? ' · check this word' : ''}${w.timing === 'estimated' ? ' · timing estimated' : ''}`} onClick={() => seekWord(c, w)}>{w.text}</span>)}</div>}
    {flagged > 0 && <div class="notice warn"><TriangleAlert size={14} /><div>{flagged} word{flagged > 1 ? 's' : ''} may be wrong (underlined). Click to hear them.</div></div>}
    <div class="row wrap">
      <button class="btn sm" onClick={() => openPanel('caption')}><Sparkles size={12} />Style this caption</button>
      <button class="btn sm" onClick={() => openPanel('project')}><Layers size={12} />Style all captions</button>
      {c.words?.some(w => w.timing === 'estimated' || w.edited) && <button class="btn sm" onClick={() => import('../lib/captions.js').then(m => m.realign(c.id))}><RotateCcw size={12} />Re-align timing</button>}
      <button class="btn sm" onClick={() => mergeWithNext(c.id)}><Merge size={12} />Merge with next</button>
    </div>
    <small class="muted">Style: {allPresets().find(x => x.id === p.captions?.preset)?.name || 'Custom'}{c.capStyle ? ' · this caption has its own changes' : ''} · {e.style.font} {Math.round(e.style.size * 1000) / 10}%</small>
  </div>;
}

// Compare with the Audio Studio script: offer its spelling only where it clearly matches what was said.
function ScriptCheck() {
  const [list, setList] = useState(null), [pick, setPick] = useState(new Set());
  if (!list) return <button class="btn sm" style={{ margin: '6px 0' }} onClick={() => { const l = scriptSuggestions(); setList(l); setPick(new Set(l.map((_, i) => i))); if (!l.length) toast('The captions already match your script wherever the words line up.'); }}><FileText size={12} />Check against your script</button>;
  if (!list.length) return null;
  return <div class="script-check"><div class="row"><b class="grow">{list.length} difference{list.length > 1 ? 's' : ''} from your script</b><button class="icon-btn sm" aria-label="Close" onClick={() => setList(null)}><X size={12} /></button></div>
    <small class="muted">Only words that clearly match are suggested. Words you skipped or added while speaking are left as spoken.</small>
    {list.map((sg, i) => <label key={i} class="check-row"><span><s>{sg.w.text}</s> → <b>{sg.to}</b> <small class="muted">({sg.why})</small></span><input type="checkbox" checked={pick.has(i)} onChange={e => { const n = new Set(pick); e.target.checked ? n.add(i) : n.delete(i); setPick(n); }} /></label>)}
    <button class="btn sm primary" disabled={!pick.size} onClick={() => { applySuggestions(list.filter((_, i) => pick.has(i))); toast(`Updated ${pick.size} word${pick.size > 1 ? 's' : ''} from your script. Timing kept.`); setList(null); }}>Use script wording for {pick.size}</button>
  </div>;
}
