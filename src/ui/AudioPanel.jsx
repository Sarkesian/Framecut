// Audio inspector: one-click profiles, the ten essential tools (simple / advanced), fades, takes, and mixing helpers.
import { useEffect, useState } from 'preact/hooks';
import { Wand2, Copy, ClipboardPaste, Unlink, Volume2, VolumeX, Play, Pause, Check, Save, RotateCcw, Ear, Trash2 } from 'lucide-preact';
import { project, selection, asset, toast, prefs, savePrefs, player, commit, media } from '../lib/state.js';
import { updateClip, updateClips, detachAudio } from '../lib/edit.js';
import { Slider, Toggle, Segmented, Select, Section, prompt, Switch } from './kit.jsx';
import { AUDIO_PROFILES, AUDIO_DEFAULTS, audioFx, profileFx } from '../../shared/audio.mjs';
import { shortTime } from '../lib/format.js';
import { preview, togglePreview, stopPreview } from '../lib/creative.js';

let fxClipboard = null;
const customProfiles = () => prefs.value.audioProfiles || [];
// Selected clips that make their own sound — the same rule as Ctrl+M: never a silent video, and never a video
// whose sound was separated (unmuting that would play the sound twice).
const ownSound = x => x && (x.kind === 'audio' || (x.kind === 'video' && !!asset(x.mediaId)?.audio && !x.detachedAudio));
const sel = c => selection.value.filter(id => ownSound(project.value.clips.find(k => k.id === id)));

const VOL_MIN_DB = -60, VOL_MAX_DB = 24;
const toDb = v => (v <= 0.001 ? VOL_MIN_DB : Math.max(VOL_MIN_DB, Math.min(VOL_MAX_DB, Math.round(20 * Math.log10(v) * 2) / 2)));
const fromDb = d => (d <= VOL_MIN_DB ? 0 : 10 ** (d / 20));

export function AudioPanel({ c }) {
  const fx = audioFx(c); const a = asset(c.mediaId);
  const [advanced, setAdvanced] = useState(() => !!prefs.value.audioAdvanced);
  const ids = sel(c).length ? sel(c) : [c.id];
  const setFx = (label, fn, key) => updateClips(ids, x => { const n = audioFx(x); fn(n); n.profile = 'custom'; x.audioFx = n; }, { label, key: key && 'afx' + key + c.id });
  const applyProfile = id => { const pf = profileFx(id, customProfiles()); updateClips(ids, x => { x.audioFx = structuredClone(pf); }, { label: 'Audio profile' }); toast(`${[...AUDIO_PROFILES, ...customProfiles()].find(p => p.id === id)?.name} applied${ids.length > 1 ? ` to ${ids.length} clips` : ''}. Press “Compare” to hear the original.`); };
  const compare = () => { const pl = player.current; if (!pl) return; pl.bypass ||= new Set(); const on = pl.bypass.has(c.id); on ? pl.bypass.delete(c.id) : pl.bypass.add(c.id); pl.invalidate(); setBypass(!on); if (!pl.playing) { pl.seek(Math.max(c.start, Math.min(pl.t, c.start + c.duration - 0.5))); pl.play(); } };
  const [bypass, setBypass] = useState(false);
  useEffect(() => { setBypass(false); return () => { player.current?.bypass?.delete(c.id); player.current?.invalidate(); }; }, [c.id]);
  if (!a?.audio) return <p class="muted hint" style={{ padding: 14 }}>This clip has no sound.</p>;
  if (c.kind === 'video' && c.detachedAudio) return <p class="muted hint" style={{ padding: 14 }}>This video’s sound was separated into its own audio clip. Select that clip to change its volume.</p>;
  const saveProfile = async () => { const name = await prompt({ title: 'Save audio profile', label: 'Profile name', value: 'My voice' }); if (!name?.trim()) return; const { profile, bypass: _, ...rest } = fx; const id = 'user-' + Date.now().toString(36); await savePrefs({ audioProfiles: [...customProfiles(), { id, name: name.trim(), hint: 'Your profile', fx: rest }] }); toast('Profile saved. It’s available for every project.'); };
  const all = [...AUDIO_PROFILES, ...customProfiles()];
  return <div class="audio-panel">
    <Section title="Volume" right={<label class="mute-toggle" data-tip={c.muted ? 'Muted — click to hear this clip' : 'Mute this clip'}><span>Mute</span><Switch on={!!c.muted} label="Mute clip" onChange={v => updateClips(ids, x => { x.muted = v; }, { label: v ? 'Mute' : 'Unmute' })} /></label>}>
      {/* In decibels so quiet and loud settings both get room: −60 dB is silence, 0 dB as recorded, up to +24 dB. */}
      <Slider label="Volume" min={VOL_MIN_DB} max={VOL_MAX_DB} step={0.5} value={toDb(c.volume ?? 1)} def={0} disabled={c.muted} fmt={d => d <= VOL_MIN_DB ? '−∞ dB' : (d > 0 ? '+' : '') + d.toFixed(1) + ' dB'} editScale={1} onChange={d => updateClips(ids, x => { x.volume = fromDb(d); }, { label: 'Volume', key: 'vol' + c.id })} />
      <div class="field-row"><Slider label="Fade in" min={0} max={Math.min(10, c.duration / 2)} step={0.05} value={c.fadeIn || 0} def={0} unit="s" onChange={v => updateClips(ids, x => { x.fadeIn = v; }, { label: 'Fade in', key: 'fi' + c.id })} /><Slider label="Fade out" min={0} max={Math.min(10, c.duration / 2)} step={0.05} value={c.fadeOut || 0} def={0} unit="s" onChange={v => updateClips(ids, x => { x.fadeOut = v; }, { label: 'Fade out', key: 'fo' + c.id })} /></div>
      <div class="row wrap">
        {c.kind === 'video' && !c.detachedAudio && <button class="btn sm" onClick={() => detachAudio(c.id)}><Unlink size={13} />Separate audio</button>}
        {(c.volumeKeys?.length > 0) && <button class="btn sm" onClick={() => updateClip(c.id, x => { x.volumeKeys = null; }, { label: 'Clear volume keyframes' })}><Trash2 size={13} />Clear keyframes</button>}
        {(c.duckKeys?.length > 0) && <span class="chip accent" data-tip="Lowered automatically while someone speaks">Ducking active</span>}
      </div>
    </Section>

    <Section title="Voice profile" right={<button class={`btn sm ${bypass ? 'primary' : ''}`} aria-pressed={bypass} onClick={compare} data-tip="Play the original sound to compare"><Ear size={13} />{bypass ? 'Hearing original' : 'Compare'}</button>}>
      <div class="profile-grid">{all.map(pf => <button key={pf.id} class={`profile ${fx.profile === pf.id ? 'on' : ''}`} onClick={() => applyProfile(pf.id)}><b>{pf.name}</b><small>{pf.hint}</small>{fx.profile === pf.id && <Check size={13} class="tick" />}</button>)}</div>
      <div class="row wrap" style={{ marginTop: 8 }}>
        <button class="btn sm" data-tip="Copy audio settings" onClick={() => { fxClipboard = structuredClone(fx); toast('Audio settings copied.'); }}><Copy size={13} />Copy</button>
        <button class="btn sm" disabled={!fxClipboard} data-tip="Paste audio settings onto the selected clips" onClick={() => { updateClips(ids, x => { x.audioFx = structuredClone(fxClipboard); }, { label: 'Paste audio settings' }); }}><ClipboardPaste size={13} />Paste</button>
        <button class="btn sm" onClick={saveProfile}><Save size={13} />Save as profile</button>
        <button class="btn sm" data-tip="Use for new recordings" onClick={() => savePrefs({ recordingProfile: fx.profile !== 'custom' ? fx.profile : 'clean' }).then(() => toast('New recordings will use this profile.'))}>Default for recordings</button>
      </div>
      {fx.profile === 'custom' && <p class="muted hint">Custom settings · based on your adjustments below.</p>}
    </Section>

    <div class="mode-switch"><Segmented value={advanced ? 'adv' : 'simple'} options={[['simple', 'Simple'], ['adv', 'Advanced']]} onChange={v => { setAdvanced(v === 'adv'); savePrefs({ audioAdvanced: v === 'adv' }); }} /></div>

    <Tool title="Loudness" on={fx.level.on} onToggle={v => setFx('Loudness', n => { n.level.on = v; })} hint="Brings the clip to a consistent perceived loudness">
      <Segmented value={fx.level.mode} options={[['loudness', 'Normalize'], ['auto', 'Auto-level']]} onChange={v => setFx('Loudness', n => { n.level.mode = v; })} />
      {fx.level.mode === 'loudness' && <Slider label="Target" min={-30} max={-9} step={0.5} value={fx.level.target} def={-16} unit=" LUFS" onChange={v => setFx('Loudness target', n => { n.level.target = v; }, 'lt')} />}
      {advanced && <Slider label="Extra gain" min={-24} max={24} step={0.5} value={fx.gain} def={0} unit=" dB" onChange={v => setFx('Gain', n => { n.gain = v; }, 'gain')} />}
    </Tool>
    <Tool title="Noise reduction" on={fx.denoise.on} onToggle={v => setFx('Noise reduction', n => { n.denoise.on = v; })} hint="Reduces steady hiss, hum and room noise">
      <Slider label="Amount" min={0.05} max={1} step={0.01} value={fx.denoise.amount} def={0.4} fmt={v => Math.round(v * 100) + '%'} onChange={v => setFx('Noise reduction', n => { n.denoise.amount = v; }, 'dn')} />
    </Tool>
    <Tool title="Rumble filter" on={fx.highpass.on} onToggle={v => setFx('High-pass', n => { n.highpass.on = v; })} hint="High-pass filter: removes low rumble, wind and desk thumps">
      {advanced && <Slider label="Cutoff" min={30} max={300} step={1} value={fx.highpass.freq} def={80} unit=" Hz" onChange={v => setFx('High-pass', n => { n.highpass.freq = v; }, 'hp')} />}
    </Tool>
    <Tool title="Background gate" on={fx.gate.on} onToggle={v => setFx('Noise gate', n => { n.gate.on = v; })} hint="Gently lowers sound between words (expander, never a hard cut)">
      <Slider label="Threshold" min={-70} max={-20} step={1} value={fx.gate.threshold} def={-50} unit=" dB" onChange={v => setFx('Gate', n => { n.gate.threshold = v; }, 'gt')} />
      {advanced && <><Slider label="Ratio" min={1.2} max={8} step={0.1} value={fx.gate.ratio} def={2.5} unit=":1" onChange={v => setFx('Gate', n => { n.gate.ratio = v; }, 'gr')} /><Slider label="Release" min={50} max={1000} step={10} value={fx.gate.release} def={250} unit=" ms" onChange={v => setFx('Gate', n => { n.gate.release = v; }, 'grl')} /></>}
    </Tool>
    <Tool title="De-esser" on={fx.deesser.on} onToggle={v => setFx('De-esser', n => { n.deesser.on = v; })} hint="Softens harsh “s” and “sh” sounds">
      <Slider label="Amount" min={0.05} max={1} step={0.01} value={fx.deesser.amount} def={0.4} fmt={v => Math.round(v * 100) + '%'} onChange={v => setFx('De-esser', n => { n.deesser.amount = v; }, 'de')} />
    </Tool>
    <Tool title="Equalizer" on={fx.eq.on} onToggle={v => setFx('Equalizer', n => { n.eq.on = v; })} hint="Shape the tone: warmth, presence, clarity">
      {['bass', 'mid', 'treble'].map(k => <div key={k}><Slider label={{ bass: 'Bass', mid: 'Mid', treble: 'Treble' }[k]} min={-12} max={12} step={0.5} value={fx.eq[k]} def={0} unit=" dB" onChange={v => setFx('EQ', n => { n.eq[k] = v; }, 'eq' + k)} />
        {advanced && <Slider label={`${k[0].toUpperCase() + k.slice(1)} frequency`} min={{ bass: 40, mid: 300, treble: 2500 }[k]} max={{ bass: 400, mid: 5000, treble: 14000 }[k]} step={10} value={fx.eq[k + 'Freq']} def={AUDIO_DEFAULTS.eq[k + 'Freq']} unit=" Hz" onChange={v => setFx('EQ', n => { n.eq[k + 'Freq'] = v; }, 'eqf' + k)} />}</div>)}
    </Tool>
    <Tool title="Compressor" on={fx.compressor.on} onToggle={v => setFx('Compressor', n => { n.compressor.on = v; })} hint="Evens out loud and quiet moments">
      <Slider label="Amount" min={1.2} max={10} step={0.1} value={fx.compressor.ratio} def={3} unit=":1" onChange={v => setFx('Compressor', n => { n.compressor.ratio = v; }, 'cr')} />
      {advanced && <><Slider label="Threshold" min={-40} max={-5} step={0.5} value={fx.compressor.threshold} def={-20} unit=" dB" onChange={v => setFx('Compressor', n => { n.compressor.threshold = v; }, 'ct')} /><Slider label="Attack" min={1} max={100} step={1} value={fx.compressor.attack} def={12} unit=" ms" onChange={v => setFx('Compressor', n => { n.compressor.attack = v; }, 'ca')} /><Slider label="Release" min={20} max={800} step={5} value={fx.compressor.release} def={160} unit=" ms" onChange={v => setFx('Compressor', n => { n.compressor.release = v; }, 'crl')} /><Slider label="Makeup gain" min={0} max={18} step={0.5} value={fx.compressor.makeup} def={2} unit=" dB" onChange={v => setFx('Compressor', n => { n.compressor.makeup = v; }, 'cm')} /></>}
    </Tool>
    <Tool title="Limiter" on={fx.limiter.on} onToggle={v => setFx('Limiter', n => { n.limiter.on = v; })} hint="Keeps peaks under the ceiling so nothing clips">
      {advanced && <Slider label="Ceiling" min={-6} max={0} step={0.1} value={fx.limiter.ceiling} def={-1} unit=" dB" onChange={v => setFx('Limiter', n => { n.limiter.ceiling = v; }, 'lc')} />}
    </Tool>
    {advanced && <Section title="Voice effects" open={!!(fx.creative.pitch || fx.creative.echo || fx.creative.reverb)}>
      <Slider label="Pitch" min={-12} max={12} step={0.5} value={fx.creative.pitch} def={0} unit=" st" onChange={v => setFx('Pitch', n => { n.creative.pitch = v; }, 'pi')} />
      <Slider label="Echo" min={0} max={1} step={0.01} value={fx.creative.echo} def={0} fmt={v => Math.round(v * 100) + '%'} onChange={v => setFx('Echo', n => { n.creative.echo = v; }, 'ec')} />
      <Slider label="Room reverb" min={0} max={1} step={0.01} value={fx.creative.reverb} def={0} fmt={v => Math.round(v * 100) + '%'} onChange={v => setFx('Reverb', n => { n.creative.reverb = v; }, 'rv')} />
    </Section>}
    <div style={{ padding: '4px 14px 16px' }}><button class="btn ghost sm" onClick={() => updateClips(ids, x => { x.audioFx = structuredClone(profileFx('original')); }, { label: 'Reset audio' })}><RotateCcw size={13} />Reset all audio processing</button></div>
    {c.takes?.length > 1 && <Takes c={c} />}
  </div>;
}
function Tool({ title, on, onToggle, hint, children }) {
  return <section class={`tool ${on ? 'on' : ''}`}><header><span class="grow" data-tip={hint}>{title}</span><Switch on={on} onChange={onToggle} label={title} /></header>{on && children && <div class="tool-body">{children}</div>}</section>;
}
function Takes({ c }) {
  // Takes play through the shared preview player: click again to pause, again to resume.
  const keyOf = k => 'take:' + k.mediaId, pv = preview.value;
  useEffect(() => () => { if (preview.peek().key?.startsWith('take:')) stopPreview(); }, [c.id]);
  const audition = (k, i) => { const a = asset(k.mediaId); if (!a || a.missing) return; togglePreview({ key: keyOf(k), url: a.url, title: `Take ${i + 1}`, durationMs: (a.duration || 0) * 1000 }); };
  return <Section title={`Takes · ${c.takes.length}`}>
    {c.takes.map((k, i) => { const a = asset(k.mediaId); const active = k.mediaId === c.mediaId; return <div key={k.mediaId} class={`take ${active ? 'on' : ''}`}>
      {(() => { const on = pv.key === keyOf(k) && pv.state !== 'paused'; return <button class={`icon-btn sm ${pv.key === keyOf(k) ? 'on' : ''}`} disabled={!a || a.missing} onClick={() => audition(k, i)} aria-label={on ? 'Pause take' : 'Listen'} data-tip={on ? 'Pause' : 'Listen to this take'}>{on ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}</button>; })()}
      <div class="grow"><b>Take {i + 1}</b><small class="muted">{a ? shortTime(a.duration) : 'missing'}{k.markers?.length ? ` · ${k.markers.length} marker${k.markers.length > 1 ? 's' : ''}` : ''}</small></div>
      {active ? <span class="chip accent">In use</span> : <button class="btn sm" onClick={() => updateClip(c.id, x => { x.mediaId = k.mediaId; x.in = k.in ?? 0; x.duration = a ? Math.max(0.1, (a.duration - (k.in ?? 0)) / (x.speed || 1)) : x.duration; x.markers = k.markers || []; }, { label: 'Choose take' })}>Use</button>}
    </div>; })}
  </Section>;
}
