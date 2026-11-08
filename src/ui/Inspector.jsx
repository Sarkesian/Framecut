// Right panel: properties for whatever is selected.
import { useEffect, useState } from 'preact/hooks';
import { useDraft } from './kit.jsx';
import { FlipHorizontal2, FlipVertical2, RotateCcw, Trash2, Rewind, Snowflake, Gauge, Scissors, AudioLines, Unlink, Wand2, X, Plus, AlignLeft, AlignCenter, AlignRight, Bold, Italic, CaseUpper, Film, Type, Music, Sparkles, LoaderCircle, Scan, Layers } from 'lucide-preact';
import { project, primary, selection, time, toast, asset, media, player, commit, fonts, prefs } from '../lib/state.js';
import { api, waitJob } from '../lib/api.js';
import { updateClip, updateClips, setSpeed, detachAudio, splitAt, trackOf, freeTrack } from '../lib/edit.js';
import { Slider, Toggle, Segmented, Select, Color, Section, Empty } from './kit.jsx';
import { ANIMATIONS, EFFECTS, FILTERS, TRANSITIONS, effectDef, filterDef, TEXT_STYLE, CAPTION_STYLE } from '../../shared/catalog.mjs';
import { RATIOS, RESOLUTIONS, FRAME_RATES, clipEnd, transitionPartner, maxTransition, newClip, DEFAULT_COLOR, DEFAULT_TRANSFORM } from '../../shared/model.mjs';
import { shortTime } from '../lib/format.js';
import { userLuts } from '../lib/state.js';
import { AudioPanel } from './AudioPanel.jsx';
import { signal } from '@preact/signals';
import { removeBackground, matteStatus, MATTE_MODEL } from '../lib/matte.js';
import { confirm, Progress } from './kit.jsx';
import { KEY_PROPS, EASINGS, hasKeys, anyKeys, keyAt, propValue, setKey, removeKey, writeProp } from '../../shared/keys.mjs';
import { Diamond, ChevronLeft, ChevronRight, ExternalLink, Copy, Crosshair } from 'lucide-preact';
import { assessRights, creditLine, PROVIDERS } from '../../shared/rights.mjs';
import { trimClip } from '../lib/edit.js';

const KIND = { video: ['Video', Film], image: ['Photo', Film], audio: ['Audio', Music], text: ['Text', Type], sticker: ['Sticker', Sparkles], adjust: ['Effect layer', Layers] };
const TABS = { video: ['Basic', 'Color', 'Effects', 'Animation', 'Speed', 'Audio'], image: ['Basic', 'Color', 'Effects', 'Animation'], text: ['Text', 'Basic', 'Animation'], sticker: ['Basic', 'Animation'], audio: ['Audio', 'Speed'], adjust: ['Color', 'Effects'] };

export function Inspector() {
  const c = primary.value; const n = selection.value.length;
  const [tab, setTab] = useState({});
  if (!c) return <ProjectPanel />;
  const tabs = TABS[c.kind] || ['Basic']; const active = tabs.includes(tab[c.kind]) ? tab[c.kind] : tabs[0];
  const [label, Icon] = KIND[c.kind] || ['Clip', Film];
  return <div class="inspector">
    <div class="insp-head"><span class={`kind-dot k-${c.kind}`}><Icon size={13} /></span><div class="grow ellipsis"><b class="ellipsis">{c.caption ? 'Caption' : c.name || label}</b><small class="muted">{label} · {shortTime(c.duration)}{n > 1 ? ` · ${n} selected` : ''}</small></div></div>
    <div class="insp-tabs" role="tablist">{tabs.map(t => <button key={t} role="tab" aria-selected={active === t} class={active === t ? 'on' : ''} onClick={() => setTab({ ...tab, [c.kind]: t })}>{t}</button>)}</div>
    <div class="insp-scroll">{
      active === 'Basic' ? <BasicPanel c={c} /> : active === 'Color' ? <ColorPanel c={c} /> : active === 'Effects' ? <EffectsPanel c={c} /> : active === 'Animation' ? <AnimPanel c={c} />
        : active === 'Speed' ? <SpeedPanel c={c} /> : active === 'Audio' ? <AudioPanel c={c} /> : active === 'Text' ? <TextPanel c={c} /> : null}<SourceSection c={c} /></div>
  </div>;
}
const ids = () => selection.value;
const set = (c, label, key, fn) => updateClips(ids().filter(id => project.value.clips.find(x => x.id === id)?.kind === c.kind || id === c.id), fn, { label, key: key + ':' + c.id });

// A transform slider with a keyframe toggle. Animated properties show their value at the playhead,
// and changing them adds or updates the keyframe there.
function Keyed({ c, prop, label, ...rest }) {
  const u = Math.min(Math.max(0, time.value - c.start), c.duration), animated = hasKeys(c, prop), on = !!keyAt(c, prop, u);
  const inside = time.value >= c.start - 1e-6 && time.value <= clipEnd(c) + 1e-6;
  const change = v => animated ? updateClip(c.id, x => writeProp(x, prop, v, u), { label: label + ' keyframe', key: 'kf' + prop + c.id + u.toFixed(3) })
    : set(c, label, 'tr' + prop, x => { x.transform[prop] = v; });
  const toggle = () => {
    if (!inside) return toast('Move the playhead over this clip to add a keyframe.', 'warn');
    updateClip(c.id, x => { if (on) removeKey(x, prop, u); else setKey(x, prop, u, propValue(x, prop, u)); }, { label: on ? 'Remove keyframe' : 'Add keyframe' });
  };
  return <div class="keyed"><Slider label={label} value={propValue(c, prop, u)} onChange={change} {...rest} />
    <button class={`kf-btn ${on ? 'on' : animated ? 'part' : ''}`} data-tip={on ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'} aria-pressed={on} onClick={toggle}><Diamond size={12} /></button></div>;
}
function KeyNav({ c }) {
  if (!anyKeys(c)) return <p class="hint">Click a ◇ to add a keyframe at the playhead, then move the playhead and change the value to animate.</p>;
  const times = [...new Set(KEY_PROPS.flatMap(p => (c.keyframes?.[p] || []).map(k => +k.t.toFixed(4))))].sort((a, b) => a - b);
  const u = time.value - c.start, prev = times.filter(k => k < u - 1e-3).at(-1), next = times.find(k => k > u + 1e-3);
  const go = k => player.current?.seek(c.start + k);
  const here = KEY_PROPS.map(p => keyAt(c, p, u)).filter(Boolean);
  return <div class="key-nav">
    <button class="btn sm ghost" disabled={prev === undefined} data-tip="Previous keyframe" onClick={() => go(prev)}><ChevronLeft size={14} /></button>
    <span class="muted">{times.length} keyframe{times.length === 1 ? '' : 's'}</span>
    <button class="btn sm ghost" disabled={next === undefined} data-tip="Next keyframe" onClick={() => go(next)}><ChevronRight size={14} /></button>
    {here.length > 0 && <Select value={here[0].e || 'smooth'} label="Easing" options={EASINGS.map(e => [e.id, e.name])} onChange={v => updateClip(c.id, x => { for (const p of KEY_PROPS) { const k = keyAt(x, p, u); if (k) k.e = v; } }, { label: 'Keyframe easing' })} />}
    <button class="btn sm ghost" data-tip="Remove all keyframes" onClick={() => updateClip(c.id, x => { for (const p of KEY_PROPS) if (x.keyframes?.[p]?.length) { x.transform[p] = propValue(x, p, u); } delete x.keyframes; }, { label: 'Clear keyframes' })}><Trash2 size={13} /></button>
  </div>;
}
// Library / imported stickers: loop, animation speed and duration, independent of size and position.
function StickerPlayback({ c }) {
  const a = asset(c.mediaId); if (!a) return null;
  const animated = a.kind === 'video', speed = c.speed || 1, once = a.duration / speed;
  return <Section title="Sticker">
    {animated ? <>
      <Toggle label="Loop animation" on={c.loop !== false} onChange={v => updateClip(c.id, x => { x.loop = v; }, { label: v ? 'Loop sticker' : 'Play sticker once' })} hint="When off, the animation plays once and holds its last frame." />
      <Slider label="Animation speed" value={speed} min={0.25} max={4} step={0.05} def={1} fmt={v => v.toFixed(2) + '×'} onChange={v => updateClip(c.id, x => { x.speed = v; }, { label: 'Sticker speed', key: 'stspeed' + c.id })} />
    </> : <p class="muted hint">Still sticker · transparency kept.</p>}
    <Slider label="Duration" value={c.duration} min={0.2} max={Math.max(30, c.duration)} step={0.05} def={3} fmt={v => v.toFixed(1) + ' s'} onChange={v => trimClip(c.id, 'end', c.start + v)} />
    <div class="row">
      {animated && <button class="btn sm" data-tip="Make the clip exactly one play of the animation" onClick={() => trimClip(c.id, 'end', c.start + once)}>One play · {shortTime(once)}</button>}
      <button class="btn sm" onClick={() => updateClip(c.id, x => { x.transform = { ...x.transform, x: 0, y: 0 }; }, { label: 'Center sticker' })}><Crosshair size={13} />Center</button>
    </div>
    {animated && <small class="muted">{shortTime(a.duration)} animation · {Math.round(a.fps || 0)} fps · {a.width}×{a.height}</small>}
  </Section>;
}
// Where a library asset came from and what its license asks for.
function SourceSection({ c }) {
  const a = c.mediaId && asset(c.mediaId); const s = a?.source; if (!s || s.provider === 'local') return null;
  const r = assessRights({ provider: s.provider, license: s.license, licenseVersion: s.licenseVersion, kind: s.kind, usage: project.value.usageMode === 'personal' ? 'personal' : 'commercial' });
  const credit = creditLine(s);
  return <Section title="Source & license" open={r.level === 'blocked' || r.level === 'caution'}>
    <div class="src-card">
      <div><b>{s.title}</b>{s.creator ? <> · {s.creatorUrl ? <a href={s.creatorUrl} target="_blank" rel="noreferrer">{s.creator}</a> : s.creator}</> : null}</div>
      <div class="row"><span class={`lic lic-${r.level}`}>{r.badge}</span>{s.licenseUrl && <a href={s.licenseUrl} target="_blank" rel="noreferrer">{r.name || 'License'} <ExternalLink size={11} /></a>}</div>
      <div>{r.summary}</div>
      {r.details.length > 0 && <ul class="muted" style={{ margin: 0, paddingLeft: 16 }}>{r.details.map(d => <li key={d}>{d}</li>)}</ul>}
      {(r.attribution || s.license === 'mit') && <div class="credit-box"><p>{credit}</p><button class="btn sm ghost" onClick={() => navigator.clipboard.writeText(credit).then(() => toast('Credit copied.'))}><Copy size={12} />Copy credit</button></div>}
      <small class="muted">Via {PROVIDERS[s.provider]?.name || s.provider}{s.sourceName ? ' · ' + s.sourceName : ''}{s.importedAt ? ' · saved ' + new Date(s.importedAt).toLocaleDateString() : ''}. Stored in this computer's project media, so it works offline.</small>
      {s.sourcePageUrl && <a href={s.sourcePageUrl} target="_blank" rel="noreferrer">Open the original page <ExternalLink size={11} /></a>}
    </div>
  </Section>;
}
function BasicPanel({ c }) {
  const T = { ...DEFAULT_TRANSFORM, ...c.transform }, cr = c.crop || {};
  const tr = (k, label) => v => set(c, label, 'tr' + k, x => { x.transform[k] = v; });
  return <>
    {c.kind === 'sticker' && c.sticker?.type === 'media' && <StickerPlayback c={c} />}
    <Section title="Position & size" right={<button class="btn ghost sm" onClick={() => set(c, 'Reset transform', 'trreset', x => { x.transform = { ...DEFAULT_TRANSFORM }; })}><RotateCcw size={12} />Reset</button>}>
      <Keyed c={c} prop="scale" label="Scale" min={0.05} max={4} step={0.01} def={1} fmt={v => Math.round(v * 100) + '%'} />
      <Keyed c={c} prop="x" label="X" min={-1} max={1} step={0.001} def={0} fmt={v => Math.round(v * 100) + '%'} />
      <Keyed c={c} prop="y" label="Y" min={-1} max={1} step={0.001} def={0} fmt={v => Math.round(v * 100) + '%'} />
      <Keyed c={c} prop="rotation" label="Rotation" min={-180} max={180} step={0.5} def={0} unit="°" />
      <Keyed c={c} prop="opacity" label="Opacity" min={0} max={1} step={0.01} def={1} fmt={v => Math.round(v * 100) + '%'} />
      <KeyNav c={c} />
      <div class="row"><button class={`btn sm ${T.flipH ? 'primary' : ''}`} onClick={() => set(c, 'Flip', 'flipH', x => { x.transform.flipH = !T.flipH; })}><FlipHorizontal2 size={14} />Flip</button><button class={`btn sm ${T.flipV ? 'primary' : ''}`} onClick={() => set(c, 'Flip', 'flipV', x => { x.transform.flipV = !T.flipV; })}><FlipVertical2 size={14} />Flip vertical</button></div>
    </Section>
    {(c.kind === 'video' || c.kind === 'image') && <Section title="Frame">
      <div class="field"><label>Fit to canvas</label><Segmented value={c.fit || 'contain'} options={[['contain', 'Fit'], ['cover', 'Fill']]} onChange={v => set(c, 'Fit', 'fit', x => { x.fit = v; })} /></div>
      <div class="field-row">{[['l', 'Crop left'], ['r', 'Crop right'], ['t', 'Crop top'], ['b', 'Crop bottom']].map(([k, l]) => <Slider key={k} label={l} min={0} max={0.45} step={0.005} value={cr[k] || 0} def={0} fmt={v => Math.round(v * 100) + '%'} onChange={v => set(c, 'Crop', 'crop' + k, x => { x.crop[k] = v; })} />)}</div>
    </Section>}
    {c.kind === 'video' && <CutoutSection c={c} />}
    {c.kind !== 'audio' && c.kind !== 'adjust' && <TransitionSection c={c} />}
  </>;
}
// Background removal (MODNet). Runs in the background; progress survives switching clips.
const matteRun = signal(null);
function CutoutSection({ c }) {
  const run = matteRun.value, mine = run?.clipId === c.id, a = asset(c.mediaId);
  const start = async () => {
    if (window.__fc?.matteEngine !== 'synthetic' && !(await matteStatus())) {
      const ok = await confirm({ title: 'Download background removal?', ok: 'Download and remove', text: `FrameCut uses ${MATTE_MODEL.name} (${MATTE_MODEL.license}). It downloads once (${MATTE_MODEL.size}) from Hugging Face, then runs entirely on this computer — your video never leaves it.` });
      if (!ok) return;
    }
    const srcLen = c.duration * (c.speed || 1), from = Math.max(0, c.in - 0.5), to = Math.min(a.duration, c.in + srcLen + 0.5);
    const ctrl = new AbortController(); matteRun.value = { clipId: c.id, progress: 0, message: 'Starting…', ctrl };
    try {
      const r = await removeBackground({ mediaId: c.mediaId, from, to, fps: project.value.settings.fps, signal: ctrl.signal, onProgress: p => { matteRun.value = { ...matteRun.value, ...(p.progress !== undefined && p.progress !== null ? { progress: p.progress } : {}), message: p.message || matteRun.value.message }; } });
      const m = new Map(media.value); m.set(r.asset.id, r.asset); media.value = m;
      updateClip(c.id, x => { x.cutout = { mediaId: x.cutout?.mediaId || x.mediaId, in: x.cutout?.in ?? x.in }; x.in = Math.max(0, x.in - r.from); x.mediaId = r.asset.id; }, { label: 'Remove background' });
      toast('Background removed. Put another clip or a color on the track below to show behind it. Your original file is untouched.');
    } catch (e) { if (!e.cancelled) toast('Background removal failed: ' + e.message, 'error'); }
    finally { matteRun.value = null; }
  };
  const restore = () => updateClip(c.id, x => { x.mediaId = x.cutout.mediaId; x.in = x.cutout.in; delete x.cutout; }, { label: 'Restore background' });
  return <Section title="Remove background" open={!!c.cutout || mine}>
    {mine ? <div class="matte-run"><Progress value={run.progress} indeterminate={!run.progress} /><div class="row"><small class="muted grow">{run.message}</small><button class="btn ghost sm" onClick={() => run.ctrl.abort()}>Cancel</button></div></div>
      : c.cutout ? <div class="row"><span class="badge ok"><Scissors size={11} />Background removed</span><span class="grow" /><button class="btn sm" onClick={restore}>Restore original</button></div>
      : <><button class="btn block" disabled={!!run || a?.missing} onClick={start}><Wand2 size={14} />Remove background</button>
        <p class="muted hint">Works best on people. Runs on this computer (GPU when available) and creates a separate cutout file.</p></>}
  </Section>;
}
function TransitionSection({ c }) {
  const p = project.value; const partner = transitionPartner(p, c);
  if (!partner) return null;
  const max = maxTransition(p, c);
  return <Section title="Transition in">
    <div class="field"><Select value={c.transition?.id || ''} options={[['', 'None (straight cut)'], ...TRANSITIONS.map(t => [t.id, t.name])]} onChange={v => updateClip(c.id, x => { x.transition = v ? { id: v, duration: x.transition?.duration || Math.min(0.6, max) } : null; }, { label: 'Transition' })} /></div>
    {c.transition && <Slider label="Duration" min={0.1} max={max} step={0.05} value={c.transition.duration} def={0.6} unit="s" onChange={v => updateClip(c.id, x => { x.transition.duration = v; }, { label: 'Transition duration', key: 'trd' + c.id })} />}
  </Section>;
}
function ColorPanel({ c }) {
  const col = { ...DEFAULT_COLOR, ...c.color };
  const s = (k, label) => v => set(c, label, 'col' + k, x => { x.color = { ...DEFAULT_COLOR, ...x.color, [k]: v }; });
  const all = [...FILTERS.map(f => [f.id, f.name]), ...userLuts.value.map(l => [l.id, l.name])];
  return <>
    <Section title="Filter">
      <div class="field"><Select value={c.filter?.id || ''} options={[['', 'None'], ...all]} onChange={v => set(c, 'Filter', 'filter', x => { x.filter = { id: v || null, intensity: x.filter?.intensity ?? 1 }; })} /></div>
      {c.filter?.id && <Slider label="Strength" min={0} max={1} step={0.01} value={c.filter.intensity ?? 1} def={1} fmt={v => Math.round(v * 100) + '%'} onChange={v => set(c, 'Filter strength', 'fint', x => { x.filter.intensity = v; })} />}
    </Section>
    <Section title="Adjust" right={<button class="btn ghost sm" onClick={() => set(c, 'Reset color', 'colreset', x => { x.color = { ...DEFAULT_COLOR }; })}><RotateCcw size={12} />Reset</button>}>
      <Slider label="Exposure" min={-2} max={2} step={0.01} value={col.exposure} def={0} onChange={s('exposure', 'Exposure')} />
      <Slider label="Brightness" min={-0.5} max={0.5} step={0.01} value={col.brightness} def={0} onChange={s('brightness', 'Brightness')} />
      <Slider label="Contrast" min={0.3} max={2} step={0.01} value={col.contrast} def={1} onChange={s('contrast', 'Contrast')} />
      <Slider label="Saturation" min={0} max={2.5} step={0.01} value={col.saturation} def={1} onChange={s('saturation', 'Saturation')} />
      <Slider label="Temperature" min={-1} max={1} step={0.01} value={col.temperature} def={0} onChange={s('temperature', 'Temperature')} />
      <Slider label="Tint" min={-1} max={1} step={0.01} value={col.tint} def={0} onChange={s('tint', 'Tint')} />
      <Slider label="Hue" min={-180} max={180} step={1} value={col.hue} def={0} unit="°" onChange={s('hue', 'Hue')} />
    </Section>
  </>;
}
function EffectsPanel({ c }) {
  const list = c.effects || [];
  const avail = EFFECTS.filter(e => !list.some(x => x.id === e.id) && !(c.kind === 'adjust' && e.clipOnly));
  return <>
    {!list.length && <Empty icon={Sparkles} title="No effects yet" text="Add one below, or pick from the Effects panel on the left." />}
    {list.map((e, i) => { const def = effectDef(e.id); return <Section key={e.id} title={def?.name || e.id} right={<button class="icon-btn sm" data-tip="Remove effect" onClick={() => updateClip(c.id, x => { x.effects = x.effects.filter(y => y.id !== e.id); }, { label: 'Remove effect' })}><X size={13} /></button>}>
      {def?.params.map(pr => <Slider key={pr.key} label={pr.label} min={pr.min} max={pr.max} step={pr.step} value={e[pr.key] ?? pr.value} def={pr.value} fmt={v => Math.round(v * 100) + '%'} onChange={v => updateClip(c.id, x => { x.effects[i][pr.key] = v; }, { label: def.name, key: 'fx' + e.id + c.id })} />)}
    </Section>; })}
    {avail.length > 0 && <div class="field" style={{ padding: '0 14px' }}><Select value="" options={[['', '+ Add effect…'], ...avail.map(e => [e.id, e.name])]} onChange={v => { if (!v) return; const def = effectDef(v); updateClip(c.id, x => { x.effects = [...(x.effects || []), { id: v, ...Object.fromEntries(def.params.map(p => [p.key, p.value])) }]; }, { label: 'Add ' + def.name }); }} /></div>}
  </>;
}
function AnimPanel({ c }) {
  const row = (kind, key, title) => {
    const cur = c[key];
    return <Section title={title}>
      <div class="anim-grid"><button class={`anim-opt ${!cur ? 'on' : ''}`} onClick={() => updateClip(c.id, x => { x[key] = null; }, { label: 'Animation' })}>None</button>
        {ANIMATIONS[kind].map(a => <button key={a.id} class={`anim-opt ${cur?.id === a.id ? 'on' : ''}`} onClick={() => updateClip(c.id, x => { x[key] = { id: a.id, duration: x[key]?.duration || (kind === 'loop' ? 1 : 0.5) }; }, { label: 'Animation' })}>{a.name}</button>)}</div>
      {cur && kind !== 'loop' && <Slider label="Duration" min={0.1} max={Math.max(0.2, Math.min(5, c.duration))} step={0.05} value={cur.duration} def={0.5} unit="s" onChange={v => updateClip(c.id, x => { x[key].duration = v; }, { label: 'Animation duration', key: 'an' + key + c.id })} />}
    </Section>;
  };
  return <>{row('in', 'animIn', 'In')}{row('out', 'animOut', 'Out')}{row('loop', 'animLoop', 'Loop')}</>;
}
function SpeedPanel({ c }) {
  const a = asset(c.mediaId); const [busy, setBusy] = useState(null);
  const run = async (label, fn) => { setBusy(label); try { await fn(); } catch (e) { if (!e.cancelled) toast(e.message, 'error'); } finally { setBusy(null); } };
  const swapMedia = (newAsset, label, patch = {}) => { const m = new Map(media.value); m.set(newAsset.id, newAsset); media.value = m; updateClip(c.id, x => { x.mediaId = newAsset.id; x.in = 0; Object.assign(x, patch); }, { label }); };
  const srcLen = c.duration * (c.speed || 1);
  return <>
    <Section title="Speed">
      <div class="speed-presets">{[0.25, 0.5, 1, 1.5, 2, 4].map(s => <button key={s} class={`anim-opt ${Math.abs((c.speed || 1) - s) < 1e-3 ? 'on' : ''}`} onClick={() => setSpeed(c.id, s)}>{s}×</button>)}</div>
      <Slider label="Custom" min={0.1} max={10} step={0.05} value={c.speed || 1} def={1} unit="×" onChange={v => setSpeed(c.id, v)} />
      <p class="muted hint">New length: {shortTime(c.duration)}. Sound keeps its pitch.</p>
    </Section>
    {c.kind !== 'audio' && a && <Section title="Tools">
      <button class="btn block" disabled={!!busy} onClick={() => run('reverse', async () => { const { job } = await api('/api/tools/reverse', { mediaId: c.mediaId, from: c.in, to: c.in + srcLen }); const r = await waitJob(job); swapMedia(r.asset, 'Reverse', { originalMediaId: c.originalMediaId || c.mediaId }); toast('Clip reversed. Your original file is untouched — undo to go back.'); })}>{busy === 'reverse' ? <LoaderCircle size={14} class="spin" /> : <Rewind size={14} />}Reverse</button>
      <button class="btn block" disabled={!!busy || (c.speed || 1) >= 1} data-tip={(c.speed || 1) >= 1 ? 'Slow the clip below 1× first' : 'Creates in-between frames for smooth slow motion'} onClick={() => run('smooth', async () => { const { job } = await api('/api/tools/smooth-slowmo', { mediaId: c.mediaId, from: c.in, to: c.in + srcLen, speed: c.speed, fps: project.value.settings.fps }); const r = await waitJob(job); swapMedia(r.asset, 'Smooth slow motion'); toast('Smooth slow motion created.'); })}>{busy === 'smooth' ? <LoaderCircle size={14} class="spin" /> : <Gauge size={14} />}Smooth slow motion</button>
      <button class="btn block" disabled={!!busy || c.kind === 'image'} onClick={() => run('freeze', () => freezeFrame(c))}>{busy === 'freeze' ? <LoaderCircle size={14} class="spin" /> : <Snowflake size={14} />}Freeze frame at playhead</button>
      <button class="btn block" disabled={!!busy || c.kind === 'image'} onClick={() => run('stab', async () => { const { job } = await api('/api/tools/stabilize', { mediaId: c.mediaId, from: c.in, to: c.in + srcLen }); const r = await waitJob(job); swapMedia(r.asset, 'Stabilize'); toast('Stabilized. Undo to compare with the original.'); })}>{busy === 'stab' ? <LoaderCircle size={14} class="spin" /> : <Scan size={14} />}Stabilize shaky footage</button>
      <button class="btn block" disabled={!!busy || c.kind === 'image'} onClick={() => run('scenes', () => splitScenes(c))}>{busy === 'scenes' ? <LoaderCircle size={14} class="spin" /> : <Scissors size={14} />}Split at scene changes</button>
      {busy && <p class="muted hint">Working… you can keep editing. Cancel from the task indicator at the top.</p>}
    </Section>}
  </>;
}
async function freezeFrame(c) {
  const t = time.value; if (t <= c.start || t >= clipEnd(c)) return toast('Put the playhead inside the clip where you want to freeze.', 'warn');
  const src = c.in + (t - c.start) * (c.speed || 1);
  const r = await api('/api/tools/freeze', { mediaId: c.mediaId, time: src });
  const m = new Map(media.value); m.set(r.asset.id, r.asset); media.value = m;
  splitAt(t, [c.id]);
  const f = newClip('image', { mediaId: r.asset.id, name: 'Freeze frame', start: t, duration: 2, fit: c.fit, transform: structuredClone(c.transform), color: structuredClone(c.color), filter: structuredClone(c.filter) });
  commit('Freeze frame', p => { const main = trackOf(p, c.trackId); f.trackId = main.id; for (const x of p.clips) if (x.trackId === main.id && x.start >= t - 1e-4) x.start += main.main ? 2 : 0; if (!main.main) f.trackId = freeTrack(p, 'video', t, t + 2).id; p.clips.push(f); if (!p.mediaIds.includes(r.asset.id)) p.mediaIds.push(r.asset.id); }, { select: [f.id] });
  toast('Freeze frame added (2 s). Drag its edge to change the length.');
}
async function splitScenes(c) {
  const srcLen = c.duration * (c.speed || 1);
  const { job } = await api('/api/tools/scenes', { mediaId: c.mediaId, from: c.in, to: c.in + srcLen });
  const r = await waitJob(job);
  const cuts = r.times.map(s => c.start + (s - c.in) / (c.speed || 1)).filter(t => t > c.start + 0.3 && t < clipEnd(c) - 0.3);
  if (!cuts.length) return toast('No scene changes found in this clip.', 'warn');
  commit('Split at scenes', p => {
    let cur = p.clips.find(x => x.id === c.id);
    for (const t of cuts) { const local = t - cur.start; const r2 = structuredClone(cur); r2.id = crypto.randomUUID(); r2.start = t; r2.duration = cur.duration - local; r2.in = cur.in + local * (cur.speed || 1); r2.transition = null; cur.duration = local; p.clips.push(r2); cur = r2; }
  });
  toast(`Split into ${cuts.length + 1} scenes.`);
}

function TextPanel({ c }) {
  const s = { ...(c.caption ? CAPTION_STYLE : TEXT_STYLE), ...c.style };
  const [text, setText] = useDraft(c.text);
  const [allCaps, setAllCaps] = useState(true);
  const st = (k, label) => v => {
    if (c.caption && allCaps) commit(label, p => { for (const x of p.clips) if (x.trackId === c.trackId) x.style = { ...x.style, [k]: v }; }, { key: 'ts' + k });
    else updateClips(selection.value.filter(id => project.value.clips.find(x => x.id === id)?.kind === 'text'), x => { x.style = { ...x.style, [k]: v }; }, { label, key: 'ts' + k + c.id });
  };
  const fontList = [...new Set([...fonts.value.user.map(f => f.family), ...fonts.value.system])];
  return <div class="insp-text">
    <Section title={c.caption ? 'Caption text' : 'Text'}>
      <textarea class="input" rows={3} value={text} onInput={e => setText(e.target.value)} onBlur={e => { const v = e.target.value; if (v !== c.text) updateClip(c.id, x => { x.text = v; x.name = v.split('\n')[0].slice(0, 40); if (x.words && x.words.length !== v.split(/\s+/).filter(Boolean).length) x.words = null; }, { label: 'Edit text' }); }} aria-label="Text content" />
      {c.caption && <Toggle label="Apply style to all captions" on={allCaps} onChange={setAllCaps} />}
    </Section>
    <Section title="Font">
      <div class="field"><input class="input" list="font-list" value={s.font} onChange={e => st('font', 'Font')(e.target.value)} aria-label="Font" style={{ fontFamily: s.font }} /><datalist id="font-list">{fontList.map(f => <option key={f} value={f} />)}</datalist></div>
      <Slider label="Size" min={0.015} max={0.35} step={0.001} value={s.size} def={c.caption ? 0.052 : 0.075} fmt={v => Math.round(v * 1000) / 10 + '%'} onChange={st('size', 'Text size')} />
      <div class="row"><Segmented value={s.align} options={[['left', '', AlignLeft, 'Align left'], ['center', '', AlignCenter, 'Center'], ['right', '', AlignRight, 'Align right']]} onChange={st('align', 'Align')} />
        <button class={`icon-btn ${s.bold ? 'on' : ''}`} data-tip="Bold" onClick={() => st('bold', 'Bold')(!s.bold)}><Bold size={15} /></button>
        <button class={`icon-btn ${s.italic ? 'on' : ''}`} data-tip="Italic" onClick={() => st('italic', 'Italic')(!s.italic)}><Italic size={15} /></button>
        <button class={`icon-btn ${s.uppercase ? 'on' : ''}`} data-tip="All caps" onClick={() => st('uppercase', 'Caps')(!s.uppercase)}><CaseUpper size={16} /></button></div>
      <Color label="Color" value={s.color} onChange={st('color', 'Text color')} />
      <div class="field-row"><Slider label="Letter spacing" min={-0.05} max={0.4} step={0.005} value={s.letterSpacing} def={0} onChange={st('letterSpacing', 'Spacing')} /><Slider label="Line height" min={0.8} max={2} step={0.01} value={s.lineHeight} def={1.15} onChange={st('lineHeight', 'Line height')} /></div>
    </Section>
    <Section title="Outline" open={s.strokeWidth > 0}><Slider label="Thickness" min={0} max={0.3} step={0.005} value={s.strokeWidth} def={0} onChange={st('strokeWidth', 'Outline')} /><Color label="Outline color" value={s.strokeColor} onChange={st('strokeColor', 'Outline color')} /></Section>
    <Section title="Shadow & glow" open={s.shadowOpacity > 0}><Slider label="Opacity" min={0} max={1} step={0.01} value={s.shadowOpacity} def={0} onChange={st('shadowOpacity', 'Shadow')} /><Slider label="Softness" min={0} max={2} step={0.01} value={s.shadowBlur} def={0.35} onChange={st('shadowBlur', 'Shadow softness')} /><Color label="Shadow color" value={s.shadowColor} onChange={st('shadowColor', 'Shadow color')} /></Section>
    <Section title="Background" open={s.bgOpacity > 0}><Slider label="Opacity" min={0} max={1} step={0.01} value={s.bgOpacity} def={0} onChange={st('bgOpacity', 'Background')} /><Slider label="Roundness" min={0} max={1} step={0.01} value={s.bgRadius} def={0.25} onChange={st('bgRadius', 'Roundness')} /><Color label="Background color" value={s.bgColor} onChange={st('bgColor', 'Background color')} /></Section>
    {c.caption && <Section title="Word highlight"><Toggle label="Highlight each word as it’s spoken" on={!!s.highlight} onChange={st('highlight', 'Word highlight')} />{s.highlight && <Color label="Highlight color" value={s.highlightColor || '#ffe14d'} onChange={st('highlightColor', 'Highlight color')} />}{s.highlight && !c.words?.length && <p class="muted hint">This caption has no word timing (it was imported or edited). Auto-captions keep word timing.</p>}</Section>}
  </div>;
}

function ProjectPanel() {
  const p = project.value; const s = p.settings;
  const setS = (label, fn) => commit(label, d => fn(d.settings));
  return <div class="inspector">
    <div class="insp-head"><div class="grow"><b>Project</b><small class="muted">Select something on the timeline to edit it</small></div></div>
    <div class="insp-scroll">
      <Section title="Format">
        <div class="ratio-grid compact">{Object.entries(RATIOS).slice(0, 8).map(([r, i]) => <button key={r} class={`ratio-opt ${s.ratio === r ? 'on' : ''}`} data-tip={i.hint} onClick={() => setS('Aspect ratio', x => { x.ratio = r; })}><b>{r}</b><small>{i.name}</small></button>)}</div>
        <div class="field-row"><div class="field"><label>Resolution</label><Select value={s.resolution} options={RESOLUTIONS.map(r => [r, r === 2160 ? '4K' : r === 4320 ? '8K' : r + 'p'])} onChange={v => setS('Resolution', x => { x.resolution = +v; })} /></div><div class="field"><label>Frame rate</label><Select value={s.fps} options={FRAME_RATES.map(f => [f, f + ' fps'])} onChange={v => setS('Frame rate', x => { x.fps = +v; })} /></div></div>
      </Section>
      <Section title="Background">
        <div class="field"><Segmented value={s.background.type} options={[['black', 'Black'], ['color', 'Color'], ['blur', 'Blur']]} onChange={v => setS('Background', x => { x.background.type = v; })} /></div>
        {s.background.type === 'color' && <Color label="Color" value={s.background.color} onChange={v => setS('Background color', x => { x.background.color = v; })} />}
        {s.background.type === 'blur' && <Slider label="Blur strength" min={4} max={60} step={1} value={s.background.blur} def={24} onChange={v => commit('Blur', d => { d.settings.background.blur = v; }, { key: 'bgblur' })} />}
        <p class="muted hint">Fills empty space around clips that don’t match the frame.</p>
      </Section>
      <Section title="Timeline">
        <Toggle label="Magnetic main track" hint="Keeps clips on the main track together with no gaps" on={s.magnetic} onChange={v => setS('Magnetic track', x => { x.magnetic = v; })} />
        <Toggle label="Snapping" hint="Clips snap to the playhead and other clips (N)" on={s.snapping} onChange={v => setS('Snapping', x => { x.snapping = v; })} />
      </Section>
    </div>
  </div>;
}
