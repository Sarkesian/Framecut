// Preferences: storage locations, performance, captions engine, optional AI connection.
import { matteStatus, deleteMatteModel, MATTE_MODEL } from '../lib/matte.js';
import { useEffect, useState } from 'preact/hooks';
import { HardDrive, Cpu, Captions, Bot, FolderOpen, Trash2, Check, TriangleAlert } from 'lucide-preact';
import { prefs, savePrefs, health, toast } from '../lib/state.js';
import { api, native } from '../lib/api.js';
import { showDialog, Modal, Select, Toggle, Segmented, confirm } from './kit.jsx';
import { bytes } from '../lib/format.js';
import { whisperStatus } from '../lib/whisper.js';

export const openPreferences = () => showDialog(() => <Preferences />);

function Preferences() {
  const [tab, setTab] = useState('general');
  const tabs = [['general', 'General', Cpu], ['storage', 'Storage', HardDrive], ['captions', 'Captions & AI', Captions], ['assistant', 'Writing assistant', Bot]];
  return <Modal title="Preferences" size="wide">
    <div class="prefs"><nav>{tabs.map(([id, label, Icon]) => <button key={id} class={`nav-item ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}</nav>
      <div class="prefs-body">{tab === 'general' ? <General /> : tab === 'storage' ? <Storage /> : tab === 'captions' ? <CaptionsAi /> : <Assistant />}</div></div>
  </Modal>;
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
  const change = async key => {
    const dir = await native.chooseFolder({ title: key === 'dataDir' ? 'Choose where FrameCut keeps projects' : 'Choose where FrameCut keeps cache files', defaultPath: cfg?.[key] }); if (!dir) return;
    const ok = await confirm({ title: 'Restart FrameCut?', text: key === 'dataDir' ? `Projects, fonts, LUTs and settings will be copied to ${dir}. Your media stays where it is. FrameCut restarts to finish.` : `Thumbnails, waveforms and playback copies will be rebuilt in ${dir}. FrameCut restarts to finish.`, ok: 'Move and restart' });
    if (!ok) return; await native.setStorage({ [key]: dir }); native.relaunch();
  };
  return <>
    <h3>Storage locations</h3>
    <p class="muted">Media you import is linked in place — FrameCut never copies your videos. You can move FrameCut’s own files off the system drive.</p>
    <div class="storage-row"><div><b>Projects & settings</b><span class="mono ellipsis">{info?.dataDir}</span><small class="muted">{info ? bytes(info.dataBytes) : '…'}</small></div>{native && <button class="btn" onClick={() => change('dataDir')}><FolderOpen size={15} />Change…</button>}</div>
    <div class="storage-row"><div><b>Cache</b><span class="mono ellipsis">{info?.cacheDir}</span><small class="muted">{info ? bytes(info.cacheBytes) : '…'} · thumbnails, waveforms, playback copies</small></div><div class="row">{native && <button class="btn" onClick={() => change('cacheDir')}><FolderOpen size={15} />Change…</button>}<button class="btn" onClick={async () => { await api('/api/storage/clear-cache', {}); toast('Cache cleared. Playback copies will be rebuilt when needed.'); load(); }}><Trash2 size={15} />Clear</button></div></div>
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
    <div class="field"><label>Model</label><input class="input" list="ai-models" value={form.model} onInput={e => setForm({ ...form, model: e.target.value })} placeholder="Test the connection to list models" /><datalist id="ai-models">{models.map(m => <option key={m} value={m} />)}</datalist></div>
    <div class="row"><button class="btn" onClick={test}>Test connection</button><button class="btn primary" onClick={save}>Use this connection</button><span class="muted">{state}</span></div>
  </>;
}
