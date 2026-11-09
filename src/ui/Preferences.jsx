// Preferences: storage locations, performance, captions engine, optional AI connection.
import { matteStatus, deleteMatteModel, MATTE_MODEL } from '../lib/matte.js';
import { useEffect, useState } from 'preact/hooks';
import { HardDrive, Cpu, Captions, Bot, FolderOpen, Trash2, Check, TriangleAlert, Library as LibraryIcon, KeyRound, Ban } from 'lucide-preact';
import { loadStatus, libStatus } from '../lib/creative.js';
import { prefs, savePrefs, health, toast, saveNow } from '../lib/state.js';
import { api, native } from '../lib/api.js';
import { showDialog, Modal, Select, Toggle, Segmented, confirm, Combo } from './kit.jsx';
import { bytes } from '../lib/format.js';
import { whisperStatus } from '../lib/whisper.js';

export const openPreferences = () => showDialog(() => <Preferences />);

function Preferences() {
  const [tab, setTab] = useState('general');
  const tabs = [['general', 'General', Cpu], ['storage', 'Storage', HardDrive], ['library', 'Library', LibraryIcon], ['captions', 'Captions & AI', Captions], ['assistant', 'Writing assistant', Bot]];
  return <Modal title="Preferences" size="wide">
    <div class="prefs"><nav>{tabs.map(([id, label, Icon]) => <button key={id} class={`nav-item ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}</nav>
      <div class="prefs-body">{tab === 'general' ? <General /> : tab === 'storage' ? <Storage /> : tab === 'library' ? <LibraryPrefs /> : tab === 'captions' ? <CaptionsAi /> : <Assistant />}</div></div>
  </Modal>;
}
// Creative Library: sources, optional Openverse credentials (kept in the Windows credential store).
function LibraryPrefs() {
  const [id, setId] = useState(''), [secret, setSecret] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { loadStatus(); }, []);
  const st = libStatus.value; const ov = st?.openverse || {};
  const save = async clear => {
    setBusy(true);
    try { const r = await api('/api/creative/credentials/openverse', clear ? {} : { clientId: id, clientSecret: secret }, 'PUT'); setId(''); setSecret(''); await loadStatus(); toast(clear ? 'Openverse credentials removed.' : r.persistent ? 'Saved securely in the Windows credential store.' : 'Saved for this session only (secure storage is unavailable).'); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return <>
    <h3>Sources</h3>
    <div class="col">{(st?.providers || []).filter(p => p.id !== 'local').map(p => <div key={p.id} class="row" style={{ alignItems: 'flex-start' }}>
      {p.enabled ? <Check size={15} class="accentc" style={{ marginTop: 2 }} /> : <Ban size={15} class="muted" style={{ marginTop: 2 }} />}
      <div class="grow"><b>{p.name}</b> <span class="muted">· {p.kinds.map(k => ({ music: 'music', sfx: 'sound effects', sticker: 'stickers' })[k]).join(', ')}</span><br /><small class="muted">{p.enabled ? p.note : 'Not enabled — ' + p.reason}</small></div>
    </div>)}</div>
    <h3>Openverse access</h3>
    <p class="muted">Searching works without an account (about 20 searches a minute, 200 a day). For more, register a free Openverse API application and paste its credentials here. They are encrypted by Windows and never shown again.</p>
    <div class="row"><KeyRound size={15} class="muted" /><span>{ov.credentials ? 'Credentials saved' : 'Using anonymous access'}{ov.blockedFor ? ` · paused for ${ov.blockedFor}s` : ''}</span>{ov.credentials && <button class="btn sm ghost" disabled={busy} onClick={() => save(true)}>Remove</button>}</div>
    <div class="field-row"><div class="field"><label>Client ID</label><input class="input mono" value={id} onInput={e => setId(e.target.value)} autocomplete="off" spellcheck={false} /></div><div class="field"><label>Client secret</label><input class="input mono" type="password" value={secret} onInput={e => setSecret(e.target.value)} autocomplete="off" /></div></div>
    <button class="btn sm" disabled={busy || !id || !secret} onClick={() => save(false)}>Save credentials</button>
    <h3>Where library files go</h3>
    <p class="muted">Music, sounds and stickers you add are saved once in your FrameCut data folder (Storage tab) under <span class="mono">media\library</span>, with their source and license, so projects reopen offline. Previews use a temporary cache capped at 250 MB.</p>
  </>;
}
function General() {
  const p = prefs.value, enc = health.value.encoders || {};
  return <>
    <h3>Performance</h3>
    <div class="field"><label>Playback copies (proxies)</label><Select value={p.proxies || 'auto'} options={[['auto', 'Automatic — only for 4K or unsupported formats'], ['always', 'Always — smoothest playback'], ['off', 'Only when a format can’t play']]} onChange={v => savePrefs({ proxies: v })} />
      <small class="muted">Proxies are small copies used only for preview. Exports always use your original files.</small></div>
    <div class="field"><label>Hardware encoding</label><Select value={p.hardware || 'auto'} options={[['auto', enc.preferred ? `Automatic (${enc.preferred.toUpperCase()} detected)` : 'Automatic (none detected)'], ['off', 'Off — software only']]} onChange={v => savePrefs({ hardware: v })} /></div>
    <h3>Editing</h3>
    <div class="field"><label>Default aspect ratio for new projects</label><Select value={p.defaultRatio || '16:9'} options={['16:9', '9:16', '1:1', '4:5', '4:3', '21:9']} onChange={v => savePrefs({ defaultRatio: v })} /></div>
    <Toggle label="Show helpful tips" on={p.showTips !== false} onChange={v => savePrefs({ showTips: v })} />
  </>;
}
function Storage() {
  const [info, setInfo] = useState(null), [cfg, setCfg] = useState(null);
  const load = () => { api('/api/storage').then(setInfo); native?.getStorage().then(setCfg); };
  useEffect(load, []);
  const moveProjects = async dir => {
    const ok = await confirm({ title: 'Move projects and restart?', text: `Your projects will be moved to ${dir}. Media stays where it is. FrameCut restarts to finish.`, ok: 'Move and restart' });
    if (!ok) return;
    try {
      await saveNow(); // the open project's latest edits must be in the folder before it is copied
      const r = await native.setStorage({ projectsDir: dir });
      if (r?.keptInOldFolder) await confirm({ title: 'Some projects were not moved', text: `${r.keptInOldFolder.count} project folder(s) already existed in ${dir}, so the copies in ${r.keptInOldFolder.folder} were left there untouched.`, ok: 'Restart' });
      native.relaunch();
    } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };
  const change = async () => { const dir = await native.chooseFolder({ title: 'Choose where FrameCut keeps your projects', defaultPath: cfg?.projectsDir }); if (dir) moveProjects(dir); };
  const inside = cfg && cfg.projectsDir === cfg.defaultProjectsDir;
  return <>
    <h3>Storage</h3>
    <p class="muted">FrameCut keeps its settings, AI models and caches in one folder next to the app. Media you import is linked in place — FrameCut never copies your videos.</p>
    <div class="storage-row"><div><b>FrameCut folder</b><span class="mono ellipsis">{info?.dataDir}</span><small class="muted">{info ? `${bytes(info.dataBytes)} · AI engines ${bytes(info.engineBytes)} · library media ${bytes(info.mediaBytes)}` : '…'}</small></div>{native && <button class="btn" onClick={() => native.openDataFolder()}><FolderOpen size={15} />Open</button>}</div>
    <div class="storage-row"><div><b>Projects</b><span class="mono ellipsis">{info?.projectsDir}</span><small class="muted">{info ? bytes(info.projectBytes) : '…'}{inside ? ' · kept when FrameCut is updated or uninstalled' : ''}</small></div><div class="row">{native && !inside && <button class="btn" onClick={() => moveProjects(cfg.defaultProjectsDir)}>Move back</button>}{native && <button class="btn" onClick={change}><FolderOpen size={15} />Change…</button>}</div></div>
    <div class="storage-row"><div><b>Cache</b><span class="mono ellipsis">{info?.cacheDir}</span><small class="muted">{info ? bytes(info.cacheBytes) : '…'} · thumbnails, waveforms, playback copies</small></div><div class="row"><button class="btn" onClick={async () => { await api('/api/storage/clear-cache', {}); toast('Cache cleared. Playback copies will be rebuilt when needed.'); load(); }}><Trash2 size={15} />Clear</button></div></div>
  </>;
}
function CaptionsAi() {
  const p = prefs.value; const [w, setW] = useState(null), [bg, setBg] = useState(null);
  useEffect(() => { whisperStatus().then(setW); matteStatus().then(setBg); }, []);
  return <>
    <h3>Automatic captions</h3>
    <p class="muted">Speech recognition runs on this computer with the open-source Whisper model. Nothing is uploaded.</p>
    <div class="field"><label>Accuracy</label><Segmented value={p.captionModel || 'base'} options={[['tiny', 'Fast'], ['base', 'Balanced'], ['small', 'Accurate']]} onChange={v => savePrefs({ captionModel: v })} />
      <small class="muted">Fast ≈ 40 MB · Balanced ≈ 80 MB · Accurate ≈ 250 MB. A model downloads once on first use, then works offline.</small></div>
    <div class="model-list">{(w || []).map(m => <div key={m.id} class="model-row"><b>{m.name}</b><span class={`chip ${m.cached ? 'accent' : ''}`}>{m.cached ? <><Check size={12} />Installed</> : 'Downloads on first use'}</span></div>)}</div>
    <h3>AI tools on this computer</h3>
    <div class="ai-status">
      <Status ok label="Captions (Whisper)" text="Built in" />
      <Status ok label="Noise reduction, voice enhance, pitch" text="Built in (signal processing)" />
      <Status ok label="Silence removal & scene detection" text="Built in (audio/video analysis)" />
      <Status ok label="Stabilization & smooth slow motion" text="Built in (vid.stab, motion interpolation)" />
      <Status ok label="Background removal (MODNet)" text={bg ? 'Installed · runs offline' : `Downloads on first use (${MATTE_MODEL.size})`} />
      <Status ok={false} label="Upscaling, vocal isolation" text="Not included in this version" />
    </div>
    {bg && <div class="row"><button class="btn sm" onClick={async () => { await deleteMatteModel(); setBg(false); toast('Background removal model deleted. It will download again if you use it.'); }}><Trash2 size={13} />Delete background removal model</button></div>}
  </>;
}
const Status = ({ ok, label, text }) => <div class="status-row">{ok ? <Check size={14} class="ok" /> : <TriangleAlert size={14} class="warnc" />}<b>{label}</b><span class="muted">{text}</span></div>;
function Assistant() {
  const p = prefs.value; const ai = p.ai || {};
  const [form, setForm] = useState({ ...ai, key: '' }), [state, setState] = useState(null), [models, setModels] = useState([]);
  const URLS = { ollama: 'http://127.0.0.1:11434/v1', lmstudio: 'http://127.0.0.1:1234/v1', openai: 'https://api.openai.com/v1', custom: form.baseUrl };
  const test = async () => { setState('Checking…'); try { const r = await api('/api/ai/verify', form); setModels(r.models); setState(`Connected · ${r.models.length} models`); if (!form.model) setForm(f => ({ ...f, model: r.models.find(m => !/whisper|embed/i.test(m)) || '' })); } catch (e) { setState(e.message); } };
  const save = async () => { try { await api('/api/ai/config', form); const { key, ...rest } = form; await savePrefs({ ai: rest }); toast('Writing assistant connected.'); } catch (e) { toast(e.message, 'error'); } };
  return <>
    <h3>Writing assistant (optional)</h3>
    <p class="muted">Suggests titles, descriptions and caption translations from your transcript. Works with a local model in Ollama or LM Studio, or any OpenAI-compatible service. Text is only sent when you ask.</p>
    <div class="field"><label>Provider</label><Select value={form.preset || 'ollama'} options={[['ollama', 'Ollama (on this computer)'], ['lmstudio', 'LM Studio (on this computer)'], ['openai', 'OpenAI'], ['custom', 'Other OpenAI-compatible']]} onChange={v => setForm(f => ({ ...f, preset: v, baseUrl: URLS[v] || f.baseUrl }))} /></div>
    <div class="field"><label>Address</label><input class="input mono" value={form.baseUrl} onInput={e => setForm({ ...form, baseUrl: e.target.value })} /></div>
    <div class="field"><label>API key <span class="muted">(kept in memory only, not saved)</span></label><input class="input" type="password" autocomplete="off" value={form.key} onInput={e => setForm({ ...form, key: e.target.value })} placeholder="Not needed for local models" /></div>
    <div class="field"><label>Model</label><Combo label="Model" value={form.model} options={models} commitOnType onChange={v => setForm(f => ({ ...f, model: v }))} placeholder="Test the connection to list models" /></div>
    <div class="row"><button class="btn" onClick={test}>Test connection</button><button class="btn primary" onClick={save}>Use this connection</button><span class="muted">{state}</span></div>
  </>;
}
