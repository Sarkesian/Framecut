// Details panel for a selected transition (click a transition block on the timeline). Takes over the
// right-hand panel the way a selected clip does. Simple first: pick a type, its direction and length;
// timing, look and sound controls sit in their own sections below.
import { Blend, Play, Trash2, CopyCheck, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-preact';
import { project, player, time, toast } from '../lib/state.js';
import { updateClip, removeTransition, transitionToAllCuts } from '../lib/edit.js';
import { Slider, Segmented, Select, Color, Section } from './kit.jsx';
import { TRANSITION_FAMILIES, TRANSITION_EASES, TRANSITION_ALIGN, transitionDef, transitionIn, transitionWindow, transitionCaps } from '../../shared/catalog.mjs';
import { transitionPartner, maxTransition } from '../../shared/model.mjs';
import { shortTime } from '../lib/format.js';

const DIR_ICON = { left: ArrowLeft, right: ArrowRight, up: ArrowUp, down: ArrowDown };
const DIR_TIP = { left: 'Moves to the left', right: 'Moves to the right', up: 'Moves up', down: 'Moves down' };
const LENGTHS = [0.3, 0.5, 0.8, 1, 1.5, 2];
const clipName = c => (c ? c.name || ({ video: 'Video', image: 'Photo', text: 'Text', sticker: 'Sticker' })[c.kind] || 'Clip' : '');

let stopTimer = 0;
// Plays a little before to a little after the transition, then stops.
function previewTransition(c, d) {
  const pl = player.current; if (!pl) return;
  const [T0, T1] = transitionWindow(c, d), from = Math.max(0, T0 - 0.7);
  clearTimeout(stopTimer); pl.pause(); pl.seek(from); time.value = from; pl.play();
  stopTimer = setTimeout(() => pl.pause(), (T1 + 0.7 - from) * 1000);
}

export function TransitionInspector({ c }) {
  const p = project.value, a = transitionPartner(p, c), tr = c.transition;
  const def = transitionDef(tr.id) || transitionDef('dissolve'); const caps = transitionCaps(def);
  const max = Math.max(0.1, maxTransition(p, c)); const d = Math.min(tr.duration || 0.6, max);
  const set = (label, fn, key) => updateClip(c.id, x => { if (!x.transition) return false; fn(x.transition); }, { label, key: key ? key + ':' + c.id : undefined });
  const pickFamily = f => set('Transition type', t => { t.id = transitionIn(f.id, def.dir && f.dirs.includes(def.dir) ? def.dir : f.dirs[0]).id; });
  const blur = tr.blur ?? def.blur ?? 0, strength = tr.strength ?? 1;
  const groups = [...new Set(TRANSITION_FAMILIES.map(f => f.group))];
  return <div class="inspector tr-inspector">
    <div class="insp-head"><span class="kind-dot k-transition"><Blend size={13} /></span><div class="grow ellipsis"><b class="ellipsis">{def.family && def.dir ? TRANSITION_FAMILIES.find(f => f.id === def.family)?.name : def.name}</b><small class="muted ellipsis">Transition · {shortTime(d)} · {clipName(a)} → {clipName(c)}</small></div>
      <button class="icon-btn sm" data-tip="Play the transition" aria-label="Play the transition" onClick={() => previewTransition(c, d)}><Play size={14} /></button></div>
    <div class="insp-scroll">
      <Section title="Type">
        <div class="tr-pick" role="radiogroup" aria-label="Transition type">{groups.flatMap(g => TRANSITION_FAMILIES.filter(f => f.group === g)).map(f => <button key={f.id} role="radio" aria-checked={def.family === f.id} class={`tr-pick-tile ${def.family === f.id ? 'on' : ''}`} onClick={() => pickFamily(f)} data-tip={f.name}>
          <div class={`tr-demo tr-${f.first}`}><i class="a" /><i class="b" /><i class="dip" /></div><span class="ellipsis">{f.name}</span></button>)}</div>
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
        <button class="btn sm" onClick={() => previewTransition(c, d)}><Play size={13} />Play</button>
        <button class="btn sm" data-tip="Use these settings on every cut on this track" onClick={() => { const n = transitionToAllCuts(c.id); toast(n ? `Applied to ${n} more cut${n === 1 ? '' : 's'} on this track. Ctrl+Z to undo.` : 'There are no other cuts on this track.'); }}><CopyCheck size={13} />Apply to all cuts</button>
        <span class="grow" />
        <button class="btn sm ghost danger" onClick={() => removeTransition(c.id)}><Trash2 size={13} />Remove</button>
      </div>
    </div>
  </div>;
}
