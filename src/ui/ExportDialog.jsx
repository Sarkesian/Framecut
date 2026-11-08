// Export: presets, format options, progress with ETA and cancel, and clear recovery on failure.
import { useEffect, useState, useRef } from 'preact/hooks';
import { Download, FolderOpen, Play, Film, Music, TriangleAlert, Check, Cpu, ShieldCheck, Copy, FileText } from 'lucide-preact';
import { preflight } from '../../shared/rights.mjs';
import { project, selection, health, toast, prefs, savePrefs, saveNow, asset, commit } from '../lib/state.js';
import { api, native, waitJob } from '../lib/api.js';
import { showDialog, closeDialog, Modal, Select, Segmented, Toggle, Progress } from './kit.jsx';
import { dimensions, RESOLUTIONS, FRAME_RATES, clipEnd, projectDuration } from '../../shared/model.mjs';
import { exportRasters } from '../engine/raster.js';
import { timecode, bytes, shortTime } from '../lib/format.js';

const FORMATS = [
  ['mp4', 'MP4', 'Plays everywhere'], ['mov', 'MOV', 'Apple & pro editing'], ['webm', 'WebM', 'Web, small files'], ['mkv', 'MKV', 'Flexible container'],
  ['gif', 'GIF', 'Animated, no sound'], ['avi', 'AVI', 'Legacy players'], ['flv', 'FLV', 'Legacy streaming'],
  ['mp3', 'MP3', 'Audio only'], ['wav', 'WAV', 'Lossless audio'], ['m4a', 'M4A (AAC)', 'Audio only'], ['flac', 'FLAC', 'Lossless audio'], ['ogg', 'OGG', 'Audio only'],
];
const CODECS = { mp4: [['h264', 'H.264 · most compatible'], ['hevc', 'H.265 / HEVC · smaller files']], mov: [['h264', 'H.264'], ['prores', 'ProRes 422 HQ · for editing']], mkv: [['h264', 'H.264'], ['hevc', 'H.265 / HEVC']], webm: [['vp9', 'VP9']], avi: [['mpeg4', 'MPEG-4 (Xvid)']], flv: [['h264', 'H.264']], gif: [['gif', 'GIF']] };
const AUDIO_ONLY = ['mp3', 'wav', 'm4a', 'flac', 'ogg'];
const PRESETS = [
  { id: 'youtube', name: 'YouTube', format: 'mp4', codec: 'h264', resolution: 1080, quality: 'high', ratio: '16:9' },
  { id: 'youtube4k', name: 'YouTube 4K', format: 'mp4', codec: 'h264', resolution: 2160, quality: 'high', ratio: '16:9' },
  { id: 'tiktok', name: 'TikTok / Reels / Shorts', format: 'mp4', codec: 'h264', resolution: 1080, quality: 'high', ratio: '9:16' },
  { id: 'instagram', name: 'Instagram post', format: 'mp4', codec: 'h264', resolution: 1080, quality: 'high', ratio: '4:5' },
  { id: 'small', name: 'Small file (sharing)', format: 'mp4', codec: 'hevc', resolution: 720, quality: 'small' },
  { id: 'master', name: 'Master (ProRes)', format: 'mov', codec: 'prores', resolution: 1080, quality: 'high' },
];
const bitrateFor = (s, W, H) => { if (AUDIO_ONLY.includes(s.format)) return 0; if (+s.bitrate > 0) return +s.bitrate; const base = W * H * s.fps / 1e6; const q = { high: 0.14, balanced: 0.08, small: 0.045 }[s.quality] ?? 0.08; const codecK = s.codec === 'hevc' ? 0.6 : s.codec === 'prores' ? 9 : s.format === 'gif' ? 3 : 1; return base * q * 1000 * codecK; };

// Asset Rights check: what the library assets on the timeline need, in one place, before export.
function RightsCheck({ pf, ack, setAck, saveCredits, setSaveCredits }) {
  const p = project.value; const commercial = pf.usage === 'commercial';
  const clipsOf = it => p.clips.filter(c => c.mediaId === it.mediaId).map(c => c.id);
  const copy = () => navigator.clipboard.writeText(pf.credits).then(() => toast('Credits copied.')).catch(() => toast('Copy failed.', 'error'));
  const ok = !pf.blocked.length && !pf.caution.length;
  return <div class="rights-check">
    <h4>{ok ? <ShieldCheck size={16} class="accentc" /> : <TriangleAlert size={16} style={{ color: pf.blocked.length ? 'var(--danger)' : 'var(--warn)' }} />}Asset rights <span class="chip">{commercial ? 'Monetized / client video' : 'Personal video'}</span>
      <button class="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => commit('Usage mode', d => { d.usageMode = commercial ? 'personal' : 'commercial'; })}>Change</button></h4>
    {pf.items.map(it => <div key={it.key} class="rights-item">
      <span class={`lic lic-${it.rights.level}`}>{it.rights.badge}</span>
      <div class="grow"><b class="ellipsis">{it.source.title}</b>{it.source.creator ? <span class="muted"> · {it.source.creator}</span> : null}<small>{it.rights.summary}{it.rights.details[0] && it.rights.level !== 'credit' ? ' ' + it.rights.details[0] : ''}</small></div>
      {it.rights.blocked && <button class="btn sm" onClick={() => { selection.value = clipsOf(it); closeDialog(); toast('Selected the clips that use this asset. Replace or delete them, then export again.'); }}>Show clips</button>}
    </div>)}
    {pf.blocked.length > 0 && <label class="check-row" style={{ marginTop: 6 }}><span>I have separate permission for the flagged assets</span><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /></label>}
    {pf.credits && <>
      <div class="row" style={{ margin: '8px 0 6px' }}><b class="grow" style={{ fontSize: 12 }}>Credits</b><button class="btn sm ghost" onClick={copy}><Copy size={12} />Copy</button></div>
      <textarea class="credits-text" readOnly value={pf.credits} aria-label="Credits" />
      <Toggle label="Save credits as a text file next to the video" on={saveCredits} onChange={setSaveCredits} />
    </>}
    <small class="muted">Based on the license information each source published. FrameCut can't verify ownership — check the original pages for anything important.</small>
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
  const [s, setS] = useState(() => ({ format: 'mp4', codec: 'h264', quality: 'high', bitrate: 0, hardware: (prefs.value.hardware ?? 'auto') !== 'off', audioBitrate: 192, subtitles: 'burn', range: 'all', ...p.export, fps: p.export?.fps || p.settings.fps, resolution: p.export?.resolution || p.settings.resolution }));
  const [output, setOutput] = useState(''), [phase, setPhase] = useState('setup'), [prog, setProg] = useState({ p: 0, msg: '' }), [result, setResult] = useState(null), [error, setError] = useState(null);
  const job = useRef(null), started = useRef(0);
  const set = patch => setS(x => { const n = { ...x, ...patch }; if (patch.format) n.codec = (CODECS[patch.format] || [[null]])[0][0]; return n; });
  const audioOnly = AUDIO_ONLY.includes(s.format);
  const ext = s.format === 'm4a' ? 'm4a' : s.format;
  useEffect(() => { api(`/api/export/default-path?name=${encodeURIComponent(p.name)}&ext=${ext}`).then(r => setOutput(o => (o ? o.replace(/\.[^.\\/]+$/, '.' + ext) : r.path))).catch(() => {}); }, [ext]);
  const [W, H] = dimensions(p.settings.ratio, s.resolution);
  const hasCaptions = p.clips.some(c => c.kind === 'text' && p.tracks.find(t => t.id === c.trackId)?.captions);
  const sel = p.clips.filter(c => selection.value.includes(c.id));
  const full = projectDuration(p);
  const range = s.range === 'selection' && sel.length ? { from: Math.min(...sel.map(c => c.start)), to: Math.max(...sel.map(clipEnd)) } : { from: 0, to: full };
  const len = range.to - range.from;
  const est = (bitrateFor(s, W, H) + (audioOnly && ['wav', 'flac'].includes(s.format) ? 1411 : s.audioBitrate)) * 1000 / 8 * len;
  const enc = health.value.encoders || {};
  const preset = PRESETS.find(x => x.format === s.format && x.codec === s.codec && x.resolution === s.resolution && x.quality === s.quality);
  const pf = preflight(p, id => asset(id)?.source || null);
  const [ack, setAck] = useState(false), [saveCredits, setSaveCredits] = useState(() => prefs.value.saveCredits !== false);
  const rightsHold = pf.blocked.length > 0 && !ack;

  const browse = async () => { if (!native) return; const f = await native.saveFile({ title: 'Save video as', defaultPath: output, filters: [{ name: s.format.toUpperCase(), extensions: [ext] }] }); if (f) setOutput(f); };
  const start = async (overrides = {}) => {
    setError(null); setPhase('render'); setProg({ p: 0, msg: 'Preparing text and graphics…' }); started.current = Date.now();
    try {
      const settings = { ...s, ...overrides, range: s.range === 'selection' ? range : null, output, hardware: (overrides.hardware ?? s.hardware) ? 'auto' : 'off', credits: saveCredits && pf.credits ? pf.credits : null };
      const rasters = await exportRasters(p, W, H, id => asset(id));
      const { job: id } = await api('/api/export', { project: p, rasters, settings });
      job.current = id;
      commit('Export settings', d => { d.export = { format: s.format, codec: s.codec, resolution: s.resolution, fps: s.fps, quality: s.quality, bitrate: s.bitrate, audioBitrate: s.audioBitrate, subtitles: s.subtitles }; });
      savePrefs({ exportFolder: output.replace(/[\\/][^\\/]+$/, '') }).catch(() => {});
      const r = await waitJob(id, (pp, msg) => setProg({ p: pp, msg }));
      setResult(r); setPhase('done');
    } catch (e) {
      if (e.cancelled) { setPhase('setup'); toast('Export cancelled. Nothing was saved.'); return; }
      setError(e.message); setPhase('error');
    }
  };
  const cancel = () => { if (job.current) api('/api/jobs/' + job.current, undefined, 'DELETE'); };
  const eta = prog.p > 0.02 ? (Date.now() - started.current) / prog.p * (1 - prog.p) / 1000 : null;

  if (phase === 'render') return <Modal title="Exporting…" onClose={() => {}} footer={<><span class="muted grow">You can keep this window open. Closing FrameCut stops the export.</span><button class="btn danger" onClick={cancel}>Cancel export</button></>}>
    <div class="export-progress"><div class="row"><b class="grow">{prog.msg || 'Rendering…'}</b><span class="mono">{Math.round(prog.p * 100)}%</span></div><Progress value={prog.p} indeterminate={prog.p < 0.005} />
      <div class="row muted"><span class="grow ellipsis">{output}</span>{eta !== null && <span>about {eta > 90 ? Math.ceil(eta / 60) + ' min' : Math.ceil(eta) + ' s'} left</span>}</div></div>
  </Modal>;
  if (phase === 'done') return <Modal title="Your video is ready" icon={<span class="done-badge"><Check size={18} /></span>} footer={<><button class="btn ghost" onClick={() => setPhase('setup')}>Export again</button><button class="btn" onClick={() => native?.showInFolder(result.output)}><FolderOpen size={15} />Show in folder</button><button class="btn primary" onClick={() => { native?.openPath(result.output); closeDialog(); }}><Play size={15} />Play video</button></>}>
    <div class="export-done"><div><b class="ellipsis">{result.output.split(/[\\/]/).pop()}</b><span class="muted">{result.width ? `${result.width}×${result.height} · ` : ''}{shortTime(result.duration)} · {bytes(result.bytes)}</span>{result.creditsFile && <span class="muted row"><FileText size={13} />Credits saved as “{result.creditsFile.split(/[\\/]/).pop()}” — paste them into your video description.</span>}</div></div>
  </Modal>;
  return <Modal title="Export" size="wide" footer={<>
    <span class="muted grow">{audioOnly ? 'Audio' : `${W}×${H} · ${s.fps} fps`} · {timecode(len, s.fps)} · about {bytes(est)}</span>
    <button class="btn ghost" onClick={() => closeDialog()}>Cancel</button><button class="btn primary lg" disabled={!output || rightsHold} data-tip={rightsHold ? 'Resolve or confirm the asset rights below first' : null} onClick={() => start()}><Download size={16} />Export</button></>}>
    {phase === 'error' && <div class="notice error"><TriangleAlert size={16} /><div><b>The export didn’t finish.</b><div style={{ whiteSpace: 'pre-line' }}>{error}</div><div class="row" style={{ marginTop: 8 }}><button class="btn sm" onClick={() => start()}>Try again</button>{s.hardware && <button class="btn sm" onClick={() => start({ hardware: false })}>Try without hardware encoding</button>}</div></div></div>}
    <div class="export-grid">
      <div>
        <div class="field"><label>Save to</label><div class="row"><input class="input mono" value={output} onInput={e => setOutput(e.target.value)} aria-label="Output file" />{native && <button class="btn" onClick={browse}><FolderOpen size={15} />Browse</button>}</div></div>
        <div class="field"><label>Presets</label><div class="preset-row">{PRESETS.map(x => <button key={x.id} class={`preset ${preset?.id === x.id ? 'on' : ''}`} onClick={() => set({ format: x.format, codec: x.codec, resolution: x.resolution, quality: x.quality, bitrate: 0 })}><b>{x.name}</b><small>{x.ratio && x.ratio !== p.settings.ratio ? `Best for ${x.ratio}` : `${x.resolution}p · ${x.format.toUpperCase()}`}</small></button>)}</div></div>
        {PRESETS.find(x => x.id === preset?.id)?.ratio && preset.ratio !== p.settings.ratio && <div class="notice warn"><TriangleAlert size={15} /><div>This preset is designed for {preset.ratio}. Your project is {p.settings.ratio}. <button class="btn sm" style={{ marginLeft: 6 }} onClick={() => commit('Change aspect ratio', d => { d.settings.ratio = preset.ratio; })}>Switch project to {preset.ratio}</button></div></div>}
        <div class="field"><label>Format</label><div class="format-grid">{FORMATS.map(([id, name, hint]) => <button key={id} class={`format ${s.format === id ? 'on' : ''}`} onClick={() => set({ format: id })}>{AUDIO_ONLY.includes(id) ? <Music size={14} /> : <Film size={14} />}<span><b>{name}</b><small>{hint}</small></span></button>)}</div></div>
      </div>
      <div>
        {!audioOnly && <>
          {CODECS[s.format]?.length > 1 && <div class="field"><label>Codec</label><Select value={s.codec} options={CODECS[s.format]} onChange={v => set({ codec: v })} /></div>}
          <div class="field-row">
            <div class="field"><label>Resolution</label><Select value={s.resolution} options={RESOLUTIONS.map(r => { const [w, h] = dimensions(p.settings.ratio, r); return [r, `${r === 2160 ? '4K' : r === 4320 ? '8K' : r + 'p'} · ${w}×${h}`]; })} onChange={v => set({ resolution: +v })} /></div>
            <div class="field"><label>Frame rate</label><Select value={s.fps} options={FRAME_RATES.map(f => [f, f + ' fps'])} onChange={v => set({ fps: +v })} /></div>
          </div>
          <div class="field"><label>Quality</label><Segmented value={s.bitrate > 0 ? 'custom' : s.quality} options={[['high', 'High'], ['balanced', 'Balanced'], ['small', 'Smaller'], ['custom', 'Bitrate']]} onChange={v => v === 'custom' ? set({ bitrate: Math.round(bitrateFor({ ...s, bitrate: 0 }, W, H)) }) : set({ quality: v, bitrate: 0 })} /></div>
          {s.bitrate > 0 && <div class="field"><label>Video bitrate (kbps)</label><input class="input mono" type="number" min="200" max="400000" value={s.bitrate} onInput={e => set({ bitrate: +e.target.value })} /></div>}
          {s.format !== 'gif' && s.codec !== 'prores' && <Toggle label={<span class="row"><Cpu size={14} />Hardware acceleration {enc.preferred ? <span class="chip accent">{enc.preferred.toUpperCase()}</span> : <span class="chip">not available</span>}</span>} on={s.hardware && !!enc.preferred} onChange={v => set({ hardware: v })} hint="Uses your graphics card to encode much faster. FrameCut falls back to software automatically if it fails." />}
        </>}
        {s.format !== 'gif' && s.format !== 'wav' && s.format !== 'flac' && s.codec !== 'prores' && <div class="field"><label>Audio quality</label><Select value={s.audioBitrate} options={[[128, '128 kbps'], [192, '192 kbps · recommended'], [256, '256 kbps'], [320, '320 kbps']]} onChange={v => set({ audioBitrate: +v })} /></div>}
        {hasCaptions && !audioOnly && <div class="field"><label>Captions</label><Segmented value={s.subtitles} options={[['burn', 'Burn into video'], ['srt', 'Separate .srt file'], ['none', 'Leave out']]} onChange={v => set({ subtitles: v })} /></div>}
        {hasCaptions && audioOnly && <Toggle label="Also save captions as .srt" on={s.subtitles === 'srt'} onChange={v => set({ subtitles: v ? 'srt' : 'none' })} />}
        {pf.items.length > 0 && <RightsCheck pf={pf} ack={ack} setAck={setAck} saveCredits={saveCredits} setSaveCredits={v => { setSaveCredits(v); savePrefs({ saveCredits: v }).catch(() => {}); }} />}
        <div class="field"><label>Range</label><Segmented value={s.range} options={[['all', `Whole project · ${shortTime(full)}`], ['selection', sel.length ? `Selected · ${shortTime(range.to - range.from)}` : 'Selected clips']]} onChange={v => { if (v === 'selection' && !sel.length) return toast('Select clips on the timeline to export just that part.', 'warn'); set({ range: v }); }} /></div>
      </div>
    </div>
  </Modal>;
}
