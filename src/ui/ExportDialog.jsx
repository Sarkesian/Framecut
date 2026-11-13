// Export: pick where the video is going, check the one-line summary, export. Everything technical
// (format, codec, resolution, frame rate, quality, audio) sits under "More options" as dropdowns.
// Progress with ETA and cancel, and clear recovery on failure.
import { useEffect, useState, useRef } from 'preact/hooks';
import { Download, FolderOpen, Play, TriangleAlert, Check, Cpu, ShieldCheck, Copy, FileText, ChevronDown, MonitorPlay, Smartphone, RectangleVertical, Share2, Gem, Music, HardDrive } from 'lucide-preact';
import { targetPlan, estimateBytes, canTarget, cleanShort, qualityKbps, AUDIO_ONLY as AUDIO_FORMATS } from '../../shared/exportsize.mjs';
import { preflight } from '../../shared/rights.mjs';
import { project, selection, health, toast, prefs, savePrefs, saveNow, asset, commit } from '../lib/state.js';
import { api, native, waitJob } from '../lib/api.js';
import { showDialog, closeDialog, Modal, Select, Segmented, Toggle, Progress } from './kit.jsx';
import { dimensions, FRAME_RATES, clipEnd, projectDuration } from '../../shared/model.mjs';
import { exportRasters } from '../engine/raster.js';
import { userPresets } from '../lib/captions.js';
import { timecode, bytes, shortTime } from '../lib/format.js';

const FORMATS = [
  ['mp4', 'MP4 — plays everywhere'], ['mov', 'MOV — Apple & pro editing'], ['webm', 'WebM — web, small files'], ['mkv', 'MKV — flexible container'],
  ['gif', 'GIF — animated, no sound'], ['avi', 'AVI — legacy players'], ['flv', 'FLV — legacy streaming'],
  ['mp3', 'MP3 — audio only'], ['wav', 'WAV — lossless audio'], ['m4a', 'M4A (AAC) — audio only'], ['flac', 'FLAC — lossless audio'], ['ogg', 'OGG — audio only'],
];
const CODECS = { mp4: [['h264', 'H.264 · most compatible'], ['hevc', 'H.265 / HEVC · smaller files']], mov: [['h264', 'H.264'], ['prores', 'ProRes 422 HQ · for editing']], mkv: [['h264', 'H.264'], ['hevc', 'H.265 / HEVC']], webm: [['vp9', 'VP9']], avi: [['mpeg4', 'MPEG-4 (Xvid)']], flv: [['h264', 'H.264']], gif: [['gif', 'GIF']] };
const CODEC_NAME = { h264: 'H.264', hevc: 'HEVC', prores: 'ProRes', vp9: 'VP9', mpeg4: 'MPEG-4', gif: '' };
const AUDIO_ONLY = AUDIO_FORMATS;
const QUALITY_NAME = { high: 'High quality', balanced: 'Balanced quality', small: 'Smaller file' };
// Characters Windows does not allow in a file name.
const BAD_NAME = /[<>:"/\\|?*\x00-\x1f]/g;
const splitPath = full => { const m = /^(.*[\\/])?([^\\/]*?)(\.[^.\\/]*)?$/.exec(full || '') || []; return { dir: m[1] || '', name: m[2] || '', ext: (m[3] || '').slice(1) }; };
const RES_CHIPS = [720, 1080, 1440, 2160];
const resLabel = r => (r === 2160 ? '4K' : r === 4320 ? '8K' : r + 'p');
const SIZE_CHIPS = [25, 100, 300, 500, 1000];
const GRADE = { great: ['ok', 'Plenty for a clear picture'], good: ['ok', 'Looks good'], soft: ['warn', 'Fine detail will soften'], poor: ['bad', 'Will look blocky'], impossible: ['bad', 'Too small for this video'] };
// Destinations. Several share the same encoding settings and differ only in the frame shape they expect,
// so the chosen preset is remembered by id rather than guessed back from the settings.
const PRESETS = [
  { id: 'youtube', name: 'YouTube', hint: 'Widescreen · 1080p', ratio: '16:9', icon: MonitorPlay, set: { format: 'mp4', codec: 'h264', resolution: 1080, quality: 'high' } },
  { id: 'vertical', name: 'TikTok · Reels · Shorts', hint: 'Vertical · 1080p', ratio: '9:16', icon: Smartphone, set: { format: 'mp4', codec: 'h264', resolution: 1080, quality: 'high' } },
  { id: 'instagram', name: 'Instagram post', hint: 'Portrait 4:5 · 1080p', ratio: '4:5', icon: RectangleVertical, set: { format: 'mp4', codec: 'h264', resolution: 1080, quality: 'high' } },
  { id: 'small', name: 'Small file', hint: 'For sharing · 720p', icon: Share2, set: { format: 'mp4', codec: 'hevc', resolution: 720, quality: 'balanced', sizeMode: 'smaller' } },
  { id: 'master', name: 'Best quality', hint: 'ProRes master · large file', icon: Gem, set: { format: 'mov', codec: 'prores', quality: 'high' } },
  { id: 'audio', name: 'Audio only', hint: 'MP3 soundtrack', icon: Music, set: { format: 'mp3' } },
];
const LEGACY_PRESET = { tiktok: 'vertical', youtube4k: 'youtube' };
function initialPreset(p, s) {
  const saved = LEGACY_PRESET[p.export?.preset] || p.export?.preset;
  if (saved === 'custom' || PRESETS.some(x => x.id === saved)) return saved;
  const fits = PRESETS.filter(x => Object.entries(x.set).every(([k, v]) => s[k] === v));
  return (fits.find(x => x.ratio === p.settings.ratio) || fits.find(x => !x.ratio) || fits[0])?.id || 'custom';
}
const bitrateFor = (s, W, H) => qualityKbps(s, W, H, s.fps);

// Library assets on the timeline: one reassuring line when everything is free to use, details only when
// something needs attention (a credit, a restriction, or an asset that can't be used).
function RightsCheck({ pf, ack, setAck, saveCredits, setSaveCredits }) {
  const p = project.value; const commercial = pf.usage === 'commercial';
  const clipsOf = it => p.clips.filter(c => c.mediaId === it.mediaId).map(c => c.id);
  const copy = () => navigator.clipboard.writeText(pf.credits).then(() => toast('Credits copied.')).catch(() => toast('Copy failed.', 'error'));
  const attention = pf.items.filter(it => it.rights.tier !== 'free');
  if (!attention.length) return <div class="export-line ok"><ShieldCheck size={15} />{pf.items.length} library asset{pf.items.length === 1 ? '' : 's'} · free to use, no credit needed</div>;
  return <div class="rights-check">
    <h4>{pf.blocked.length ? <TriangleAlert size={16} style={{ color: 'var(--danger)' }} /> : <ShieldCheck size={16} class="accentc" />}Library assets <span class="chip">{commercial ? 'Monetized / client video' : 'Personal video'}</span>
      <button class="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => commit('Usage mode', d => { d.usageMode = commercial ? 'personal' : 'commercial'; })}>Change</button></h4>
    {attention.map(it => <div key={it.key} class="rights-item">
      <span class={`lic lic-${it.rights.level}`}>{it.rights.badge}</span>
      <div class="grow"><b class="ellipsis">{it.source.title}</b>{it.source.creator ? <span class="muted"> · {it.source.creator}</span> : null}<small>{it.rights.summary}{it.rights.details[0] && it.rights.level !== 'credit' ? ' ' + it.rights.details[0] : ''}</small></div>
      {it.rights.blocked && <button class="btn sm" onClick={() => { selection.value = clipsOf(it); closeDialog(); toast('Selected the clips that use this asset. Replace or delete them, then export again.'); }}>Show clips</button>}
    </div>)}
    {pf.items.length > attention.length && <small class="muted">{pf.items.length - attention.length} other asset{pf.items.length - attention.length === 1 ? '' : 's'} need no credit.</small>}
    {pf.blocked.length > 0 && <label class="check-row" style={{ marginTop: 6 }}><span>I have separate permission for the flagged assets</span><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /></label>}
    {pf.credits && <>
      <div class="row" style={{ margin: '8px 0 6px' }}><b class="grow" style={{ fontSize: 12 }}>Credits</b><button class="btn sm ghost" onClick={copy}><Copy size={12} />Copy</button></div>
      <textarea class="credits-text" readOnly value={pf.credits} aria-label="Credits" />
      <Toggle label="Save credits as a text file next to the video" on={saveCredits} onChange={setSaveCredits} />
    </>}
  </div>;
}

export async function openExport() {
  const p = project.value; if (!p.clips.length) return toast('Your timeline is empty. Add a clip before exporting.', 'warn');
  const missing = p.clips.filter(c => c.mediaId && (!asset(c.mediaId) || asset(c.mediaId).missing));
  if (missing.length) return toast(`${missing.length} clip${missing.length > 1 ? 's are' : ' is'} missing media. Relink from the Media panel first.`, 'error');
  await saveNow();
  showDialog(() => <ExportDialog />, { locked: false });
}

function ExportDialog() {
  const p = project.value;
  const [s, setS] = useState(() => {
    const base = { format: 'mp4', codec: 'h264', quality: 'high', bitrate: 0, hardware: (prefs.value.hardware ?? 'auto') !== 'off', audioBitrate: 192, subtitles: 'burn', range: 'all', sizeMode: 'auto', targetMB: 300, ...p.export, fps: p.export?.fps || p.settings.fps, resolution: cleanShort(p.export?.resolution || p.settings.resolution) };
    if (!['auto', 'smaller', 'target'].includes(base.sizeMode)) base.sizeMode = 'auto';
    base.targetMB = Math.max(1, +base.targetMB || 300);
    return { ...base, preset: initialPreset(p, base) };
  });
  const [more, setMore] = useState(() => !!prefs.value.exportMoreOptions);
  const [output, setOutput] = useState(''), [phase, setPhase] = useState('setup'), [prog, setProg] = useState({ p: 0, msg: '' }), [result, setResult] = useState(null), [error, setError] = useState(null);
  const job = useRef(null), started = useRef(0), confirmed = useRef(null); // path the user agreed to overwrite
  const [errorCode, setErrorCode] = useState(null);
  // Any manual change makes the settings "Custom"; picking a preset applies its whole recipe.
  const set = patch => setS(x => { const n = { ...x, preset: 'custom', ...patch }; if (patch.format && !patch.codec) n.codec = (CODECS[patch.format] || [[null]])[0][0]; return n; });
  const pick = x => setS(cur => ({ ...cur, codec: (CODECS[x.set.format] || [[null]])[0][0], sizeMode: cur.sizeMode === 'target' ? 'target' : 'auto', customRes: x.set.resolution ? false : cur.customRes, ...x.set, resolution: x.set.resolution || cur.resolution, bitrate: 0, preset: x.id }));
  // File size is its own choice, on top of whichever destination is picked (it does not turn the preset into "Custom").
  //   auto: the preset's quality. smaller: HEVC where the format has it, at balanced quality (about half the size,
  //   same frame rate and resolution). target: fit under a number of megabytes.
  const hevcOk = (CODECS[s.format] || []).some(c => c[0] === 'hevc');
  const sizeMode = v => setS(cur => {
    const has = (CODECS[cur.format] || []).some(c => c[0] === 'hevc');
    if (v === 'smaller') return { ...cur, sizeMode: v, bitrate: 0, quality: 'balanced', codec: has ? 'hevc' : cur.codec };
    if (v === 'target') return { ...cur, sizeMode: v, bitrate: 0, codec: cur.codec === 'prores' ? 'h264' : cur.codec };
    return { ...cur, sizeMode: 'auto', bitrate: 0, quality: 'high' };
  });
  const toggleMore = () => { setMore(!more); savePrefs({ exportMoreOptions: !more }).catch(() => {}); };
  const audioOnly = AUDIO_ONLY.includes(s.format);
  const ext = s.format === 'm4a' ? 'm4a' : s.format;
  // Changing the format changes the extension; the server refuses to replace an existing file without the
  // user's say-so, so a switch to MOV never silently overwrites an older "name.mov".
  useEffect(() => { api(`/api/export/default-path?name=${encodeURIComponent(p.name)}&ext=${ext}`).then(r => setOutput(o => (o ? o.replace(/\.[^.\\/]+$/, '') + '.' + ext : r.path))).catch(() => {}); }, [ext]);
  // The file name is its own box: typing there renames the file in place, in whatever folder is chosen.
  const parts = splitPath(output), [nameNote, setNameNote] = useState(false);
  const rename = v => { const clean = v.replace(BAD_NAME, ''); setNameNote(clean !== v); setOutput(parts.dir + clean.slice(0, 180) + '.' + (parts.ext || ext)); };
  const [W, H] = dimensions(p.settings.ratio, s.resolution);
  const landscape = W >= H, customRes = !RES_CHIPS.includes(s.resolution) || s.customRes;
  const setDim = (side, v) => { const n = +v; if (!(n > 0)) return; const short = (side === 'w') === landscape ? n * Math.min(W, H) / Math.max(W, H) : n; setS(x => ({ ...x, preset: 'custom', customRes: true, resolution: cleanShort(short) })); };
  const hasCaptions = p.clips.some(c => c.kind === 'text' && p.tracks.find(t => t.id === c.trackId)?.captions);
  const sel = p.clips.filter(c => selection.value.includes(c.id));
  const full = projectDuration(p);
  const range = s.range === 'selection' && sel.length ? { from: Math.min(...sel.map(c => c.start)), to: Math.max(...sel.map(clipEnd)) } : { from: 0, to: full };
  const len = range.to - range.from;
  const hasSound = p.clips.some(c => (c.kind === 'audio' || c.kind === 'video') && !c.muted);
  const targeting = s.sizeMode === 'target' && canTarget(s.format, s.codec);
  const tp = targeting ? targetPlan({ targetMB: s.targetMB, duration: Math.max(0.1, len), W, H, fps: s.fps, format: s.format, codec: s.codec, audioKbps: s.audioBitrate, hasAudio: hasSound }) : null;
  const est = estimateBytes(s, W, H, len, { hasAudio: hasSound || audioOnly });
  const enc = health.value.encoders || {};
  const preset = PRESETS.find(x => x.id === s.preset) || null;
  const shapeOff = preset?.ratio && preset.ratio !== p.settings.ratio;
  const pf = preflight(p, id => asset(id)?.source || null);
  const [ack, setAck] = useState(false), [saveCredits, setSaveCredits] = useState(() => prefs.value.saveCredits !== false);
  const rightsHold = pf.blocked.length > 0 && !ack;
  const summary = audioOnly ? [s.format.toUpperCase(), ['wav', 'flac'].includes(s.format) ? 'lossless' : s.audioBitrate + ' kbps'] : [s.format.toUpperCase() + (CODEC_NAME[s.codec] ? ' · ' + CODEC_NAME[s.codec] : ''), `${W}×${H}`, `${s.fps} fps`, targeting ? `up to ${s.targetMB} MB` : s.bitrate > 0 ? `${s.bitrate.toLocaleString()} kbps` : QUALITY_NAME[s.quality]];

  // The Windows save dialog already asks before replacing a file, so a path chosen there counts as confirmed.
  const browse = async () => { if (!native) return; const f = await native.saveFile({ title: 'Save video as', defaultPath: output, filters: [{ name: s.format.toUpperCase(), extensions: [ext] }] }); if (f) { setOutput(f); confirmed.current = f; } };
  const start = async (overrides = {}) => {
    setError(null); setPhase('render'); setProg({ p: 0, msg: 'Preparing text and graphics…' }); started.current = Date.now();
    try {
      const { preset: _preset, customRes: _customRes, sizeMode: _sizeMode, targetMB: _targetMB, ...plain } = s;
      const settings = { ...plain, ...(targeting ? { targetMB: s.targetMB, bitrate: 0 } : {}), ...overrides, range: s.range === 'selection' ? range : null, output, hardware: (overrides.hardware ?? s.hardware) ? 'auto' : 'off', credits: saveCredits && pf.credits ? pf.credits : null };
      if (confirmed.current === output) settings.overwrite = true;
      const rasters = await exportRasters(p, W, H, id => asset(id), { captionPresets: userPresets() }); // same caption styles as the preview
      const { job: id } = await api('/api/export', { project: p, rasters, settings });
      job.current = id;
      commit('Export settings', d => { d.export = { preset: s.preset, format: s.format, codec: s.codec, resolution: s.resolution, fps: s.fps, quality: s.quality, bitrate: s.bitrate, audioBitrate: s.audioBitrate, subtitles: s.subtitles, sizeMode: s.sizeMode, targetMB: s.targetMB }; });
      savePrefs({ exportFolder: output.replace(/[\\/][^\\/]+$/, '') }).catch(() => {});
      const r = await waitJob(id, (pp, msg) => setProg({ p: pp, msg }));
      setResult(r); setPhase('done');
    } catch (e) {
      if (e.cancelled) { setPhase('setup'); toast('Export cancelled. Nothing was saved.'); return; }
      setError(e.message); setErrorCode(e.code || null); setPhase('error');
    }
  };
  const cancel = () => { if (job.current) api('/api/jobs/' + job.current, undefined, 'DELETE'); };
  const eta = prog.p > 0.02 ? (Date.now() - started.current) / prog.p * (1 - prog.p) / 1000 : null;

  if (phase === 'render') return <Modal title="Exporting…" onClose={() => {}} footer={<><span class="muted grow">You can keep this window open. Closing FrameCut stops the export.</span><button class="btn danger" onClick={cancel}>Cancel export</button></>}>
    <div class="export-progress"><div class="row"><b class="grow">{prog.msg || 'Rendering…'}</b><span class="mono">{Math.round(prog.p * 100)}%</span></div><Progress value={prog.p} indeterminate={prog.p < 0.005} />
      <div class="row muted"><span class="grow ellipsis">{output}</span>{eta !== null && <span>about {eta > 90 ? Math.ceil(eta / 60) + ' min' : Math.ceil(eta) + ' s'} left</span>}</div></div>
  </Modal>;
  if (phase === 'done') return <Modal title="Your video is ready" icon={<span class="done-badge"><Check size={18} /></span>} footer={<><button class="btn ghost" onClick={() => setPhase('setup')}>Export again</button><button class="btn" onClick={() => native?.showInFolder(result.output)}><FolderOpen size={15} />Show in folder</button><button class="btn primary" onClick={() => { native?.openPath(result.output); closeDialog(); }}><Play size={15} />Play video</button></>}>
    <div class="export-done"><div><b class="ellipsis">{result.output.split(/[\\/]/).pop()}</b><span class="muted">{result.width ? `${result.width}×${result.height} · ` : ''}{shortTime(result.duration)} · {bytes(result.bytes)}{result.targetMB ? (result.fitted ? ` · under your ${result.targetMB} MB limit` : '') : ''}</span>{result.targetMB && result.fitted === false && <span class="warnc row"><TriangleAlert size={13} />This came out larger than {result.targetMB} MB. Lower the resolution and export again to get under it.</span>}{result.creditsFile && <span class="muted row"><FileText size={13} />Credits saved as “{result.creditsFile.split(/[\\/]/).pop()}” — paste them into your video description.</span>}</div></div>
  </Modal>;
  return <Modal title="Export" footer={<>
    <span class="muted grow export-est">{timecode(len, s.fps)} · <b>{targeting ? 'up to ' : 'about '}{bytes(est)}</b></span>
    <button class="btn ghost" onClick={() => closeDialog()}>Cancel</button><button class="btn primary lg" disabled={!output || !parts.name.trim() || rightsHold || tp?.grade === 'impossible'} data-tip={!parts.name.trim() ? 'Give the file a name first' : tp?.grade === 'impossible' ? 'That size is too small for this video' : rightsHold ? 'Resolve or confirm the library assets below first' : null} onClick={() => start()}><Download size={16} />Export</button></>}>
    {phase === 'error' && <div class="notice error"><TriangleAlert size={16} /><div><b>The export didn’t finish.</b><div style={{ whiteSpace: 'pre-line' }}>{error}</div><div class="row" style={{ marginTop: 8 }}>{errorCode === 'exists' ? <button class="btn sm danger" onClick={() => { confirmed.current = output; start(); }}>Replace the existing file</button> : <button class="btn sm" onClick={() => start()}>Try again</button>}{s.hardware && <button class="btn sm" onClick={() => start({ hardware: false })}>Try without hardware encoding</button>}</div></div></div>}
    <div class="export-simple">
      <div class="field export-name"><label for="export-file-name">File name</label>
        <div class="name-box"><input id="export-file-name" class="input" aria-label="File name" value={parts.name} placeholder="Name your video" spellcheck={false} autoComplete="off" onInput={e => rename(e.target.value)} onFocus={e => e.target.select()} onKeyDown={e => { if (e.key === 'Enter' && output && parts.name.trim() && !rightsHold) start(); }} /><span class="name-ext mono">.{parts.ext || ext}</span></div>
        {nameNote && <small class="warnc">File names can’t contain {'< > : " / \\ | ? *'}; those characters were left out.</small>}
        {!parts.name.trim() && <small class="warnc">Type a name for the file.</small>}
      </div>
      <div class="field"><label>Where is it going?</label>
        <div class="dest-grid" role="radiogroup" aria-label="Export preset">{PRESETS.map(x => { const Icon = x.icon; const on = s.preset === x.id; return <button key={x.id} role="radio" aria-checked={on} class={`dest ${on ? 'on' : ''}`} onClick={() => pick(x)}><Icon size={17} /><span><b>{x.name}</b><small>{x.hint}</small></span>{on && <Check size={14} class="dest-check" />}</button>; })}</div>
      </div>
      {shapeOff && <div class="notice warn compact"><TriangleAlert size={15} /><div class="grow">{preset.name} expects {preset.ratio}{preset.ratio === '9:16' ? ' (vertical)' : ''}. This project is {p.settings.ratio}, so the video will keep that shape.</div><button class="btn sm" onClick={() => commit('Change aspect ratio', d => { d.settings.ratio = preset.ratio; })}>Switch project to {preset.ratio}</button></div>}
      {!audioOnly && <div class="field"><label>Resolution</label>
        <div class="lib-chips res-chips" role="radiogroup" aria-label="Resolution">{RES_CHIPS.map(r => { const [w, h] = dimensions(p.settings.ratio, r); return <button key={r} role="radio" aria-checked={!customRes && s.resolution === r} class={`fchip ${!customRes && s.resolution === r ? 'on' : ''}`} data-tip={`${w}×${h}`} onClick={() => setS(x => ({ ...x, preset: x.preset, customRes: false, resolution: r }))}>{resLabel(r)}</button>; })}
          <button role="radio" aria-checked={!!customRes} class={`fchip ${customRes ? 'on' : ''}`} onClick={() => setS(x => ({ ...x, customRes: true }))}>Custom</button>
          {!customRes && <small class="muted">{W}×{H}</small>}</div>
        {customRes && <div class="row custom-res"><input class="input mono" type="number" aria-label="Width in pixels" min="144" max="7680" step="2" value={W} onChange={e => setDim('w', e.target.value)} /><span class="muted">×</span><input class="input mono" type="number" aria-label="Height in pixels" min="144" max="7680" step="2" value={H} onChange={e => setDim('h', e.target.value)} /><small class="muted">px · keeps the project’s {p.settings.ratio} shape</small></div>}
      </div>}
      {!audioOnly && s.format !== 'gif' && s.codec !== 'prores' && <div class="field"><label>File size</label>
        <Segmented label="File size" value={targeting ? 'target' : s.sizeMode === 'smaller' ? 'smaller' : 'auto'} options={[['auto', 'Best quality', null, 'The destination’s normal quality'], ['smaller', 'Smaller file', null, hevcOk ? 'About half the size at the same resolution and frame rate (H.265)' : 'Lower bitrate at the same resolution and frame rate'], ['target', 'Fit under a size', null, 'Pick a limit in megabytes; FrameCut works out the compression']]} onChange={sizeMode} />
        {targeting && <div class="row target-size"><input class="input mono" type="number" aria-label="Target file size in megabytes" min="1" max="100000" step="1" value={s.targetMB} onInput={e => { const n = +e.target.value; if (n > 0) setS(x => ({ ...x, targetMB: n })); }} /><span class="muted">MB</span><div class="lib-chips">{SIZE_CHIPS.map(m => <button key={m} class={`fchip ${s.targetMB === m ? 'on' : ''}`} onClick={() => setS(x => ({ ...x, targetMB: m }))}>{m >= 1000 ? m / 1000 + ' GB' : m + ' MB'}</button>)}</div></div>}
        <div class={`size-line ${tp ? GRADE[tp.grade][0] : ''}`} role="status"><HardDrive size={14} />
          {tp ? <span class="grow"><b>{tp.capped ? `About ${bytes(est)}` : `Up to ${s.targetMB} MB`}</b> · {GRADE[tp.grade][1]} at {W}×{H}, {s.fps} fps{tp.capped ? `. This video doesn’t need ${s.targetMB} MB, so it comes out smaller at full quality.` : ` (${(tp.videoKbps / 1000).toFixed(tp.videoKbps < 10000 ? 1 : 0)} Mbps).`}</span>
            : <span class="grow"><b>About {bytes(est)}</b>{s.sizeMode === 'smaller' ? ` · same ${W}×${H} and ${s.fps} fps${s.codec === 'hevc' ? ', compressed with H.265' : ''}` : ` · ${timecode(len, s.fps)} at ${W}×${H}`}</span>}
          {tp?.suggest && <button class="btn sm" onClick={() => setS(x => ({ ...x, customRes: false, resolution: tp.suggest }))}>Use {resLabel(tp.suggest)}</button>}
        </div>
        {s.sizeMode === 'smaller' && s.codec === 'hevc' && <small class="muted">H.265 plays on phones, current computers and every major site. If something can’t open it, choose Best quality (H.264).</small>}
      </div>}
      <button class={`export-summary ${more ? 'open' : ''}`} onClick={toggleMore} aria-expanded={more}>
        <span class="grow">{s.preset === 'custom' ? <b>Custom · </b> : null}{summary.join(' · ')}</span><span class="muted">More options</span><ChevronDown size={14} />
      </button>
      {more && <div class="export-more">
        <div class="field-row">
          <div class="field"><label>Format</label><Select label="Format" value={s.format} options={FORMATS} onChange={v => set({ format: v })} /></div>
          {!audioOnly && CODECS[s.format]?.length > 1 && <div class="field"><label>Codec</label><Select label="Codec" value={s.codec} options={CODECS[s.format]} onChange={v => set({ codec: v })} /></div>}
        </div>
        {!audioOnly && <>
          <div class="field-row">
            <div class="field"><label>Frame rate</label><Select label="Frame rate" value={s.fps} options={FRAME_RATES.map(f => [f, f + ' fps'])} onChange={v => set({ fps: +v })} /></div>
          </div>
          <div class="field-row">
            {!targeting && <div class="field"><label>Quality</label><Select label="Quality" value={s.bitrate > 0 ? 'custom' : s.quality} options={[['high', 'High'], ['balanced', 'Balanced'], ['small', 'Smaller file'], ['custom', 'Custom bitrate…']]} onChange={v => (v === 'custom' ? set({ bitrate: Math.round(bitrateFor({ ...s, bitrate: 0 }, W, H)) }) : set({ quality: v, bitrate: 0 }))} /></div>}
            {!targeting && s.bitrate > 0 && <div class="field"><label>Video bitrate (kbps)</label><input class="input mono" type="number" min="200" max="400000" value={s.bitrate} onInput={e => set({ bitrate: +e.target.value })} /></div>}
          </div>
        </>}
        {s.format !== 'gif' && s.format !== 'wav' && s.format !== 'flac' && s.codec !== 'prores' && <div class="field-row"><div class="field"><label>Audio quality</label><Select label="Audio quality" value={s.audioBitrate} options={[[128, '128 kbps'], [192, '192 kbps · recommended'], [256, '256 kbps'], [320, '320 kbps']]} onChange={v => set({ audioBitrate: +v })} /></div><div class="field" /></div>}
        {!audioOnly && s.format !== 'gif' && s.codec !== 'prores' && <Toggle label={<span class="row"><Cpu size={14} />Hardware acceleration {enc.preferred ? <span class="chip accent">{enc.preferred.toUpperCase()}</span> : <span class="chip">not available</span>}</span>} on={s.hardware && !!enc.preferred} onChange={v => setS(x => ({ ...x, hardware: v }))} hint="Uses your graphics card to encode much faster. FrameCut falls back to software automatically if it fails." />}
      </div>}
      {sel.length > 0 && <div class="field"><label>What to export</label><Segmented value={s.range} options={[['all', `Whole project · ${shortTime(full)}`], ['selection', `Selected clips · ${shortTime(Math.max(...sel.map(clipEnd)) - Math.min(...sel.map(c => c.start)))}`]]} onChange={v => setS(x => ({ ...x, range: v }))} /></div>}
      {hasCaptions && !audioOnly && <div class="field"><label>Captions</label><Segmented value={s.subtitles} options={[['burn', 'In the video'], ['srt', 'Separate .srt file'], ['none', 'Leave out']]} onChange={v => setS(x => ({ ...x, subtitles: v }))} /></div>}
      {hasCaptions && audioOnly && <Toggle label="Also save captions as .srt" on={s.subtitles === 'srt'} onChange={v => setS(x => ({ ...x, subtitles: v ? 'srt' : 'none' }))} />}
      {pf.items.length > 0 && <RightsCheck pf={pf} ack={ack} setAck={setAck} saveCredits={saveCredits} setSaveCredits={v => { setSaveCredits(v); savePrefs({ saveCredits: v }).catch(() => {}); }} />}
      <div class="field"><label>Save to</label><div class="row"><input class="input mono grow" value={output} onInput={e => setOutput(e.target.value)} aria-label="Output file" spellcheck={false} />{native && <button class="btn" onClick={browse}><FolderOpen size={15} />Browse</button>}</div></div>
    </div>
  </Modal>;
}
