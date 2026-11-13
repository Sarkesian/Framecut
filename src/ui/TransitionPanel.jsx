// Details panel for a selected transition (click a transition block on the timeline). Takes over the
// right-hand panel the way a selected clip does. Simple first: pick a type, its direction and length;
// timing, look and sound controls sit in their own sections below.
import { Blend, Play, Square, RotateCcw, Trash2, CopyCheck, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, X, Crosshair } from 'lucide-preact';
import { ui, setUi } from '../lib/uiprefs.js';
import { useEffect } from 'preact/hooks';
import { project, player, toast, transitionHover, transitionSel, previewLoop } from '../lib/state.js';
import { updateClip, removeTransition, transitionToAllCuts } from '../lib/edit.js';
import { Slider, Segmented, Select, Color, Section } from './kit.jsx';
import { TRANSITION_FAMILIES, TRANSITION_EASES, TRANSITION_ALIGN, transitionDef, transitionIn, transitionWindow, transitionCaps } from '../../shared/catalog.mjs';
import { transitionPartner, maxTransition } from '../../shared/model.mjs';
import { shortTime } from '../lib/format.js';

const DIR_ICON = { left: ArrowLeft, right: ArrowRight, up: ArrowUp, down: ArrowDown };
const DIR_TIP = { left: 'Moves to the left', right: 'Moves to the right', up: 'Moves up', down: 'Moves down' };
const LENGTHS = [0.3, 0.5, 0.8, 1, 1.5, 2];
const clipName = c => (c ? c.name || ({ video: 'Video', image: 'Photo', text: 'Text', sticker: 'Sticker' })[c.kind] || 'Clip' : '');

// Previewing a transition. Nothing plays by itself: selecting a transition (or hovering a type) only shows
// its settings. "Play preview" loops from a moment before the transition to a moment after it, following
// its length and placement as they are edited. The loop belongs to the player (player.range): any pause
// (Space, the transport button, a scrub, the Stop button here) ends it for good, and so does seeking away.
// Deselecting while it still loops stops it and puts the playhead back where it was.
// How much of the clips before and after the transition the loop shows is adjustable (ui.trPad, seconds).
let home = null; // { clipId, t }: where the playhead was when this preview was started
function previewWindow(clipId) {
  const p = project.value, cl = p?.clips.find(x => x.id === clipId); if (!cl?.transition) return null;
  const d = Math.min(cl.transition.duration || 0.6, Math.max(0.1, maxTransition(p, cl))); const [T0, T1] = transitionWindow(cl, d);
  const pad = ui.value.trPad ?? 0.5; return [Math.max(0, T0 - pad), T1 + pad];
}
export function playTransition(clipId, { restart = true } = {}) {
  const pl = player.current, w = previewWindow(clipId); if (!pl || !w) return false;
  if (!previewLoop.peek() || home?.clipId !== clipId) home = { clipId, t: pl.t }; // Restart keeps the first position
  return pl.playRange(w[0], w[1], { restart });
}
export const stopTransition = () => { if (previewLoop.peek()) player.current?.pause(); };
function useTransitionPreview(clipId, deps) {
  // Leaving this transition (another one, a clip, or nothing selected) ends its preview.
  useEffect(() => () => {
    const pl = player.current, h = home; home = null; transitionHover.value = null;
    if (pl && previewLoop.peek()) { pl.pause(); if (h?.clipId === clipId) pl.seek(h.t); }
  }, [clipId]);
  // A running loop keeps to the transition while its length, placement or surroundings change.
  useEffect(() => { if (!previewLoop.peek()) return; const w = previewWindow(clipId); if (w) player.current?.updateRange(w[0], w[1]); else player.current?.pause(); }, deps);
}
// Hover a type: the viewer shows that type in place of the real one (not saved until clicked). It never
// starts or resumes playback.
export const hoverType = (clipId, id) => { transitionHover.value = id ? { clipId, id } : null; };


export function TransitionInspector({ c }) {
  const p = project.value, a = transitionPartner(p, c), tr = c.transition;
  const def = transitionDef(tr.id) || transitionDef('dissolve'); const caps = transitionCaps(def);
  const max = Math.max(0.1, maxTransition(p, c)); const d = Math.min(tr.duration || 0.6, max);
  useTransitionPreview(c.id, [c.id, c.start, d, tr.align, ui.value.trPad]);
  const looping = previewLoop.value;
  const previewTransition = () => (looping ? stopTransition() : playTransition(c.id));
  const [W0, W1] = transitionWindow(c, d);
  const close = () => { transitionSel.value = null; };
  const set = (label, fn, key) => updateClip(c.id, x => { if (!x.transition) return false; fn(x.transition); }, { label, key: key ? key + ':' + c.id : undefined });
  const pickFamily = f => set('Transition type', t => { t.id = transitionIn(f.id, def.dir && f.dirs.includes(def.dir) ? def.dir : f.dirs[0]).id; });
  const blur = tr.blur ?? def.blur ?? 0, strength = tr.strength ?? 1;
  const groups = [...new Set(TRANSITION_FAMILIES.map(f => f.group))];
  return <div class="inspector tr-inspector">
    <div class="insp-head"><span class="kind-dot k-transition"><Blend size={13} /></span><div class="grow ellipsis"><b class="ellipsis">{def.family && def.dir ? TRANSITION_FAMILIES.find(f => f.id === def.family)?.name : def.name}</b><small class="muted ellipsis">Transition · {shortTime(d)} · {clipName(a)} → {clipName(c)}</small></div>
      <button class="btn sm tr-done" data-tip="Finish editing this transition and deselect it" data-kbd="Esc" aria-label="Done, deselect transition" onClick={close}><X size={13} />Done</button></div>
    <div class="insp-scroll">
      <Section title="Preview">
        <div class="row">
          <button class={`btn sm tr-play ${looping ? 'primary' : ''}`} aria-pressed={looping} data-tip={looping ? 'Stop the preview (Space also stops it)' : 'Play this transition on a loop until you stop it'} onClick={previewTransition}>{looping ? <><Square size={12} />Stop preview</> : <><Play size={13} />Play preview</>}</button>
          {looping && <button class="btn sm" data-tip="Start the loop again from the top" onClick={() => playTransition(c.id)}><RotateCcw size={13} />Restart</button>}
          {!looping && <button class="btn sm" data-tip="Move the playhead to the middle of this transition" onClick={() => player.current?.seek((W0 + W1) / 2)}><Crosshair size={13} />Go to transition</button>}
        </div>
        <Slider label="Show before & after" min={0} max={3} step={0.1} value={ui.value.trPad ?? 0.5} def={0.5} unit=" s" onChange={v => setUi({ trPad: v })} />
        <small class="muted">{looping ? 'Looping. Space, Stop or a click on the timeline ends the preview.' : 'Nothing plays until you press Play preview. The slider sets how much of the clips around the cut the loop shows.'}</small>
      </Section>
      <Section title="Type">
        <div role="radiogroup" aria-label="Transition type">{groups.map(g => <div key={g} class="tr-pick-group"><small class="muted">{g}</small><div class="tr-pick">{TRANSITION_FAMILIES.filter(f => f.group === g).map(f => <button key={f.id} role="radio" aria-checked={def.family === f.id} class={`tr-pick-tile ${def.family === f.id ? 'on' : ''}`} onClick={() => { hoverType(c.id, null); pickFamily(f); }} data-tip={f.name}
            onPointerEnter={() => hoverType(c.id, transitionIn(f.id, def.dir && f.dirs.includes(def.dir) ? def.dir : f.dirs[0]).id)} onPointerLeave={() => hoverType(c.id, null)}>
          <div class={`tr-demo tr-${f.first}`}><i class="a" /><i class="b" /><i class="dip" /></div><span class="ellipsis">{f.name}</span></button>)}</div></div>)}</div>
        {caps.dirs.length > 0 && <div class="field"><label>Direction</label><Segmented label="Direction" value={def.dir} options={caps.dirs.map(dir => [dir, dir, DIR_ICON[dir], DIR_TIP[dir]])} onChange={dir => set('Transition direction', t => { t.id = transitionIn(def.family, dir).id; })} /></div>}
      </Section>
      <Section title="Timing">
        <Slider label="Length" min={0.1} max={max} step={0.05} value={d} def={0.6} unit=" s" onChange={v => set('Transition length', t => { t.duration = v; }, 'trlen')} />
        <div class="lib-chips tr-lengths">{LENGTHS.filter(x => x <= max + 1e-6).map(x => <button key={x} class={`fchip ${Math.abs(d - x) < 0.01 ? 'on' : ''}`} onClick={() => set('Transition length', t => { t.duration = x; })}>{x} s</button>)}</div>
        {max < 0.6 && <small class="muted">Limited to {shortTime(max)} by the shorter clip. Lengthen the clips for a longer transition.</small>}
        <div class="field"><label>Placement</label><Segmented label="Placement" value={tr.align || 'center'} options={TRANSITION_ALIGN.map(([v, t]) => [v, t, null, v === 'end' ? 'Finishes exactly on the cut' : v === 'start' ? 'Starts exactly on the cut' : 'Centred on the cut'])} onChange={v => set('Transition placement', t => { t.align = v === 'center' ? undefined : v; })} /></div>
        {caps.motion && <div class="field"><label>Easing</label><Select label="Easing" value={tr.ease || 'auto'} options={TRANSITION_EASES} onChange={v => set('Transition easing', t => { t.ease = v === 'auto' ? undefined : v; })} /></div>}
      </Section>
      {(caps.motion || caps.dip) && <Section title="Look">
        {caps.motion && <Slider label="Strength" min={0.2} max={2} step={0.05} value={strength} def={1} fmt={v => Math.round(v * 100) + '%'} onChange={v => set('Transition strength', t => { t.strength = Math.abs(v - 1) < 0.001 ? undefined : v; }, 'trk')} />}
        {caps.motion && <Slider label="Motion blur" min={0} max={1} step={0.05} value={blur} def={def.blur ?? 0} fmt={v => (v < 0.01 ? 'Off' : Math.round(v * 100) + '%')} onChange={v => set('Motion blur', t => { t.blur = v; }, 'trblur')} />}
        {caps.dip && <Color label={def.family === 'flash' ? 'Flash colour' : 'Fade colour'} value={tr.color || def.dip} onChange={(v, live) => set('Transition colour', t => { t.color = v; }, live ? 'trcol' : undefined)} />}
      </Section>}
      <Section title="Sound">
        <Segmented label="Sound at the cut" value={tr.audio === 'smooth' ? 'smooth' : 'cut'} options={[['cut', 'Straight cut', null, 'Sound switches at the cut'], ['smooth', 'Smooth fade', null, 'Sound fades out and back in around the cut']]} onChange={v => set('Transition sound', t => { t.audio = v === 'smooth' ? 'smooth' : undefined; })} />
        <small class="muted">Smooth fade dips the clips’ own sound around the cut so it doesn’t jump.</small>
      </Section>
      <div class="tr-actions">
        
        <button class="btn sm" data-tip="Use these settings on every cut on this track" onClick={() => { const n = transitionToAllCuts(c.id); toast(n ? `Applied to ${n} more cut${n === 1 ? '' : 's'} on this track. Ctrl+Z to undo.` : 'There are no other cuts on this track.'); }}><CopyCheck size={13} />Apply to all cuts</button>
        <span class="grow" />
        <button class="btn sm ghost danger" data-tip="Remove this transition (the clips stay)" data-kbd="Delete" onClick={() => removeTransition(c.id)}><Trash2 size={13} />Remove transition</button>
      </div>
    </div>
  </div>;
}
