// Creative Library: one browser for music, sound effects and stickers. Search online, preview,
// then click, press Enter or drag to put an asset on the timeline. Every result shows its source
// and license; anything that cannot be used for this project says why instead of failing silently.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Music, AudioLines, FolderOpen, Search, X, Play, Pause, Square, Plus, Heart, LoaderCircle, Upload, WifiOff, TriangleAlert, Clock, Info, ExternalLink, Copy, Check, Sparkles, Shapes, Smile, Ban, Mic, Link2, Rows3, LayoutGrid, Volume2, Hourglass } from 'lucide-preact';
import { project, media, asset, toast, prefs, savePrefs, time, player } from '../lib/state.js';
import { native, api } from '../lib/api.js';
import { addSticker } from '../lib/edit.js';
import { openMenu, Segmented, Select, Progress, Toggle } from './kit.jsx';
import { importMedia } from './commands.jsx';
import { openStudio } from './Studio.jsx';
import { relinkOne } from './AssetPanel.jsx';
import { EMOJI, SHAPE_STICKERS } from '../../shared/catalog.mjs';
import { creditLine, PROVIDERS } from '../../shared/rights.mjs';
import { svgUrl } from '../engine/raster.js';
import { shortTime } from '../lib/format.js';
import {
  audioTab, stickerTab, searches, search, recentSearches, lists, loadLists, loadStatus, libStatus, toggleFavorite, togglePreview, stopPreview, preview, previewTime, seekPreview, setPreviewVolume,
  useRecord, dragRecord, dragAsset, insertAudio, insertSticker, busyKeys, warmPreview, selectedRecord, usageMode, setUsageMode, rightsOf, importStickerFiles, pickStickerFiles, categories, loadCategories, warmSources,
} from '../lib/creative.js';

const MUSIC_IDEAS = ['Cinematic', 'Lo-fi', 'Upbeat', 'Acoustic', 'Ambient', 'Electronic', 'Piano', 'Guitar', 'Hip hop', 'Techno', 'Rock', 'Happy', 'Chill', 'Epic', 'Jazz', 'Orchestral'];
const SFX_IDEAS = ['Whoosh', 'Click', 'Pop', 'Swoosh', 'Applause', 'Footsteps', 'Notification', 'Camera shutter', 'Typing', 'Laugh', 'Door', 'Ding'];
const STICKER_IDEAS = ['Star', 'Heart', 'Arrow', 'Speech bubble', 'Crown', 'Trophy', 'Rocket', 'Lightning', 'Fire', 'Music note', 'Sun', 'Flower', 'Cat', 'Dog', 'Bird', 'Tree', 'Check mark', 'Question mark'];
// Source filter per panel. Whole providers (ccMixter, SFX Kit) or Openverse's own sources.
const SOURCES = {
  music: [['', 'All sources'], ['ccmixter', 'ccMixter'], ['freesound', 'Freesound']],
  sfx: [['', 'All sources'], ['sfxkit', 'SFX Kit'], ['freesound', 'Freesound']],
};
const SOURCE_NAMES = { openverse: 'Openverse', ccmixter: 'ccMixter', sfxkit: 'SFX Kit', fluent: 'Fluent Emoji', pixabay: 'Pixabay', assetpolish: 'AssetPolish' };
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const scrollMemory = new Map();

// Keeps a panel's scroll position when you switch away and back.
function useScrollMemory(key) {
  const ref = useRef();
  useLayoutEffect(() => { const el = ref.current; if (!el) return; el.scrollTop = scrollMemory.get(key) || 0; const on = () => scrollMemory.set(key, el.scrollTop); el.addEventListener('scroll', on, { passive: true }); return () => el.removeEventListener('scroll', on); }, [key]);
  return ref;
}
// Arrow-key navigation between the focusable items of a list or grid.
function navKeys(e, selector) {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return false;
  const items = [...e.currentTarget.querySelectorAll(selector)]; const i = items.indexOf(document.activeElement); if (i < 0) return false;
  const top = items[i].offsetTop; const cols = Math.max(1, items.filter(x => x.offsetTop === top).length);
  const grid = items.length > 1 && items[1].offsetTop === items[0].offsetTop;
  const step = { ArrowDown: grid ? cols : 1, ArrowUp: grid ? -cols : -1, ArrowRight: 1, ArrowLeft: -1, Home: -i, End: items.length }[e.key];
  const next = items[Math.max(0, Math.min(items.length - 1, i + step))]; e.preventDefault(); next?.focus(); next?.scrollIntoView({ block: 'nearest' });
  return true;
}

function useLibraryBoot() { useEffect(() => { if (!libStatus.value) loadStatus(); loadLists(); }, []); }

// ---------------------------------------------------------------- shared bits
export function LicenseBadge({ rec, compact }) {
  const r = rightsOf(rec);
  return <span class={`lic lic-${r.level}`} data-tip={`${r.name ? r.name + ' — ' : ''}${r.summary}`}>{r.blocked ? <Ban size={10} /> : null}{compact ? (r.name || r.badge) : r.badge}</span>;
}
function UsageSwitch() {
  return <div class="usage" data-tip="FrameCut hides licenses that don't allow this kind of video, and checks again at export. Based on license metadata — not legal advice.">
    <Select label="This video is" value={usageMode()} options={[['commercial', 'Monetized video'], ['personal', 'Personal video']]} onChange={setUsageMode} />
  </div>;
}
function SearchField({ panel, placeholder, onArrowDown }) {
  const s = searches[panel].value; const input = useRef();
  return <div class="search lib-search" role="search">
    <Search size={14} />
    <input ref={input} class="input" type="search" placeholder={placeholder} value={s.q} aria-label={placeholder}
      onInput={e => search(panel, { q: e.target.value })}
      onKeyDown={e => { if (e.key === 'Enter') search(panel, {}, { now: true }); if (e.key === 'ArrowDown') { e.preventDefault(); onArrowDown?.(); } if (e.key === 'Escape' && s.q) { e.stopPropagation(); search(panel, { q: '' }, { now: true }); } }} />
    {s.status === 'loading' ? <LoaderCircle size={14} class="spin lib-search-end" /> : s.q ? <button class="icon-btn sm lib-search-end" aria-label="Clear search" onClick={() => { search(panel, { q: '' }, { now: true }); input.current?.focus(); }}><X size={13} /></button> : null}
  </div>;
}
function Chips({ items, onPick, label, icon: Icon }) {
  if (!items.length) return null;
  return <div class="lib-chips" aria-label={label}>{Icon && <Icon size={12} class="muted" />}{items.map(x => <button key={x} class="fchip" onClick={() => onPick(x)}>{x}</button>)}</div>;
}
function StateCard({ s, panel, onRetry }) {
  if (s.status === 'error') {
    const e = s.error || {};
    const offline = e.code === 'offline' || navigator.onLine === false;
    const quota = e.code === 'quota';
    return <div class={`lib-state ${quota ? 'warn' : ''}`} role="status">
      {offline ? <WifiOff size={22} /> : quota ? <Hourglass size={22} /> : <TriangleAlert size={22} />}
      <b>{offline ? 'You’re offline' : quota ? 'Taking a short break' : 'Search didn’t work'}</b>
      <span>{offline ? 'Online search needs internet. Everything already in your project keeps working — see My audio and Mine.' : quota ? `${e.message} Try again in ${e.retryAfter || 60} s.${/openverse/i.test(e.message) ? ' Free Openverse API credentials in Preferences › Library raise the limit.' : ''}` : e.message}</span>
      <button class="btn sm" onClick={onRetry}>Try again</button>
    </div>;
  }
  if (s.status === 'empty') return <div class="lib-state" role="status"><Search size={22} /><b>{s.q ? <>No results for “{s.q}”</> : 'Nothing here yet'}</b><span>Try fewer or broader words{s.length || s.source || s.category || s.collection ? ', or clear the filters' : ''}. Only items that need no credit are shown.</span>{(s.length || s.source || s.category || s.collection) && <button class="btn sm" onClick={() => search(panel, { length: '', source: '', category: '', collection: '' }, { now: true })}>Clear filters</button>}</div>;
  return null;
}
// "120 results from Openverse, SFX Kit" plus any source that was slow or failed, with a retry.
function ResultCount({ s, panel, noun = 'result' }) {
  const n = s.total > s.results.length ? s.total : s.results.length;
  const names = (s.sources || []).filter(x => x.total > 0).map(x => SOURCE_NAMES[x.provider] || x.provider);
  return <div class="lib-count muted" aria-live="polite">
    {n > s.results.length ? `${n.toLocaleString()} ${noun}s` : `${s.results.length} ${noun}${s.results.length === 1 ? '' : 's'}`}{names.length ? ' from ' + names.join(', ') : ''}
    {s.partial?.length > 0 && <> · <span class="warnc">{s.partial.map(p => `${SOURCE_NAMES[p.provider] || p.name || p.provider} ${p.code === 'slow' ? 'is slow to answer' : 'didn’t answer'}`).join(', ')}</span> <button class="btn sm ghost lib-retry" onClick={() => search(panel, {}, { now: true })}>Try again</button></>}
  </div>;
}
// Category chips of a source that has categories (SFX Kit sounds). Picking one browses that category.
function CategoryChips({ panel, provider, title }) {
  useEffect(() => { loadCategories(provider); }, [provider]);
  const cats = categories.value[provider] || []; if (!cats.length) return null;
  return <><h4 class="group-title">{title}</h4><div class="lib-chips" aria-label={title}>{cats.map(c => <button key={c.id} class="fchip" onClick={() => search(panel, { category: c.id, q: '' }, { now: true })}>{c.name}{c.count ? <small class="muted"> {c.count}</small> : null}</button>)}</div></>;
}
function ActiveCategory({ s, panel, provider }) {
  if (!s.category) return null;
  const name = (categories.value[provider] || []).find(c => c.id === s.category)?.name || s.category;
  return <div class="lib-chips"><button class="fchip on" aria-label={'Remove category ' + name} onClick={() => search(panel, { category: '' }, { now: true })}>{name} <X size={11} /></button>{s.q ? <small class="muted">Searching inside this category</small> : null}</div>;
}
function Skeleton({ rows = 6, grid }) { return <div class={grid ? 'sticker-grid' : 'audio-list'} aria-hidden="true">{Array.from({ length: rows }, (_, i) => <div key={i} class={grid ? 'skel tile-skel' : 'skel row-skel'} />)}</div>; }

// ---------------------------------------------------------------- AUDIO
export function AudioLibrary() {
  useLibraryBoot();
  const tab = audioTab.value; const ref = useScrollMemory('audio-' + tab);
  useEffect(() => () => stopPreview(), []);
  return <div class="tab-body lib" ref={ref}>
    <div class="asset-head"><h2>Audio</h2><div class="grow" /><button class="btn sm" onClick={() => importMedia()} data-tip="Import your own music or sound files"><Upload size={14} />Import</button></div>
    <div class="lib-tabs"><Segmented label="Audio library" value={tab} options={[['music', 'Music'], ['sfx', 'Sound FX'], ['mine', 'My audio']]} onChange={v => { stopPreview(); audioTab.value = v; }} /></div>
    {tab === 'mine' ? <MyAudio /> : <OnlineAudio key={tab} panel={tab} />}
    <PreviewBar />
    <Drawer />
  </div>;
}

function OnlineAudio({ panel }) {
  const s = searches[panel].value; const listRef = useRef(); const p = prefs.value;
  const ideas = panel === 'music' ? MUSIC_IDEAS : SFX_IDEAS;
  const L = lists.value.audio; const fav = L.favorites.filter(x => x.kind === panel), rec = L.recents.filter(x => x.kind === panel);
  const focusFirst = () => listRef.current?.querySelector('.lib-row')?.focus();
  const more = useRef();
  useEffect(() => { warmSources(panel); }, [panel]);
  useEffect(() => { const el = more.current; if (!el) return; const io = new IntersectionObserver(es => { if (es[0].isIntersecting && searches[panel].value.status === 'ok' && searches[panel].value.page < searches[panel].value.pages) search(panel, {}, { more: true }); }, { rootMargin: '200px' }); io.observe(el); return () => io.disconnect(); }, [panel, s.status, s.page]);
  return <>
    <SearchField panel={panel} placeholder={panel === 'music' ? 'Search free music — mood, genre, instrument' : 'Search sound effects — whoosh, click, rain…'} onArrowDown={focusFirst} />
    <div class="lib-filters">
      <Select label="Length" value={s.length} options={panel === 'music' ? [['', 'Any length'], ['clip', 'Under 1 min'], ['song', 'Over 1 min']] : [['', 'Any length'], ['short', 'Under 10 s'], ['medium', '10–60 s'], ['long', 'Over 1 min']]} onChange={v => search(panel, { length: v }, { now: true })} />
      <Select label="Source" value={s.source} options={SOURCES[panel]} onChange={v => search(panel, { source: v, ...(v && v !== 'sfxkit' ? { category: '' } : {}) }, { now: true })} />
      <UsageSwitch />
    </div>
    {panel === 'music' && <div class="lib-mix" role="group" aria-label="When adding music">
      <button class={`fchip ${p.libraryBalance ? 'on' : ''}`} aria-pressed={!!p.libraryBalance} onClick={() => savePrefs({ libraryBalance: !p.libraryBalance })} data-tip="Sets new music's volume to sit under speech. Your recordings are never changed."><Volume2 size={12} />Auto balance</button>
      <button class={`fchip ${p.libraryDuck ? 'on' : ''}`} aria-pressed={!!p.libraryDuck} onClick={() => savePrefs({ libraryDuck: !p.libraryDuck })} data-tip="Music dips automatically while someone speaks on a voice track (Audio Studio ducking)."><Mic size={12} />Duck under voice</button>
    </div>}
    <ActiveCategory s={s} panel={panel} provider="sfxkit" />
    {!s.q.trim() && !s.category ? <div class="lib-idle">
      <Chips label="Ideas" items={ideas} onPick={q => search(panel, { q }, { now: true })} />
      <Chips label="Recent searches" icon={Clock} items={recentSearches(panel)} onPick={q => search(panel, { q }, { now: true })} />
      {panel === 'sfx' && <CategoryChips panel="sfx" provider="sfxkit" title="Sound effect categories" />}
      {fav.length > 0 && <><h4 class="group-title">Favorites</h4><AudioList items={fav} panel={panel} /></>}
      {rec.length > 0 && <><h4 class="group-title">Recently used</h4><AudioList items={rec} panel={panel} /></>}
      {!fav.length && !rec.length && <p class="muted hint lib-intro">{panel === 'music' ? 'Free music you can use without credit: CC0 tracks from ccMixter, plus public-domain and CC0 recordings from Freesound (via Openverse).' : 'Free sound effects you can use without credit: the 320-sound SFX Kit made for video editing, plus CC0 sounds from Freesound (via Openverse).'} Every result is license-checked before it’s added.</p>}
    </div>
      : s.status === 'loading' ? <Skeleton />
        : s.status === 'error' || s.status === 'empty' ? <StateCard s={s} panel={panel} onRetry={() => search(panel, {}, { now: true })} />
          : <>
            <ResultCount s={s} panel={panel} />
            <div ref={listRef}><AudioList items={s.results} panel={panel} /></div>
            <div ref={more} class="lib-more">{s.status === 'more' ? <LoaderCircle size={16} class="spin" /> : s.page < s.pages ? <button class="btn sm ghost" onClick={() => search(panel, {}, { more: true })}>Load more</button> : s.results.length > 8 ? <span class="muted">That’s everything.</span> : null}</div>
          </>}
  </>;
}

function AudioList({ items, panel }) {
  return <div class="audio-list" role="listbox" aria-label="Results" onKeyDown={e => navKeys(e, '.lib-row')}>{items.map(r => <AudioRow key={r.key} rec={r} panel={panel} />)}</div>;
}
function AudioRow({ rec, panel }) {
  const pv = preview.value, playing = pv.key === rec.key, paused = playing && pv.state === 'paused', busy = busyKeys.value.has(rec.key), prog = busyKeys.value.get(rec.key);
  const r = rightsOf(rec); const sel = selectedRecord.value?.key === rec.key;
  const add = () => useRecord(rec).then(id => id && rec.kind === 'music' && afterMusic(id));
  const menu = e => openMenu(e, [
    { text: r.blocked ? 'Can’t be used — see why' : 'Add at playhead', icon: r.blocked ? Info : Plus, onClick: r.blocked ? () => (selectedRecord.value = rec) : add },
    { text: playing && !paused ? 'Pause preview' : paused ? 'Resume preview' : 'Preview', icon: playing && !paused ? Pause : Play, onClick: () => togglePreview(rec) },
    playing && { text: 'Stop preview', icon: Square, onClick: stopPreview },
    { text: rec.favorite ? 'Remove from favorites' : 'Save to favorites', icon: Heart, onClick: () => toggleFavorite(rec) },
    { divider: true },
    { text: 'View license & source', icon: Info, onClick: () => (selectedRecord.value = rec) },
    rec.sourcePageUrl && { text: 'Open source page', icon: ExternalLink, onClick: () => window.open(rec.sourcePageUrl, '_blank') },
    { text: 'Copy credit', icon: Copy, onClick: () => copy(creditLine(rec)) },
    rec.imported && native && { text: 'Reveal project file', icon: FolderOpen, onClick: () => { const a = asset(rec.imported); a && native.showInFolder(a.folder + '\\' + a.fileName); } },
  ]);
  return <div class={`audio-row lib-row ${playing ? 'playing' : ''} ${sel ? 'sel' : ''} ${r.blocked ? 'blocked' : ''}`} role="option" aria-selected={sel} tabIndex={0} draggable={!r.blocked}
    aria-label={`${rec.title}${rec.creator ? ' by ' + rec.creator : ''}, ${rec.durationMs ? shortTime(rec.durationMs / 1000) : ''}, ${r.badge}`}
    onDragStart={e => dragRecord(e, rec)} onDblClick={e => { if (!e.target.closest('button') && !r.blocked) add(); }} onContextMenu={menu} onClick={e => { if (!e.target.closest('button')) togglePreview(rec); }}
    onPointerEnter={() => warmPreview(rec)} onPointerLeave={() => warmPreview(null)} onFocus={() => warmPreview(rec, 400)}
    onKeyDown={e => {
      if (e.target !== e.currentTarget) return;
      if (e.key === ' ') { e.preventDefault(); togglePreview(rec); } else if (e.key === 'Enter' || e.key === '+') { e.preventDefault(); r.blocked ? (selectedRecord.value = rec) : add(); }
      else if (e.key === 'Escape') stopPreview(); else if (e.key.toLowerCase() === 'f' && !e.ctrlKey) toggleFavorite(rec); else if (e.key === 'i') selectedRecord.value = rec;
    }}>
    <PlayButton active={playing} onClick={() => togglePreview(rec)} />
    <div class="grow lib-meta">
      <div class="ellipsis lib-title" title={rec.title}>{rec.title}</div>
      <div class="lib-sub"><button class="lic-btn" tabIndex={-1} aria-label="License and source" onClick={() => (selectedRecord.value = rec)}><Info size={12} /></button><small class={`ellipsis ${busy ? 'lib-dl' : 'muted'}`}>{busy ? `Downloading${prog != null ? ' ' + Math.round(prog * 100) + '%' : '…'}` : [rec.durationMs ? shortTime(rec.durationMs / 1000) : null, rec.creator, rec.sourceName].filter(Boolean).join(' · ')}</small></div>
    </div>
    <button class={`icon-btn sm fav-btn ${rec.favorite ? 'on' : ''}`} tabIndex={-1} aria-label={rec.favorite ? 'Remove from favorites' : 'Save to favorites'} aria-pressed={rec.favorite} onClick={() => toggleFavorite(rec)}><Heart size={14} fill={rec.favorite ? 'currentColor' : 'none'} /></button>
    {busy ? <span class="busy-ring" role="progressbar" aria-label="Downloading" data-tip="Downloading — it is added to the timeline when it arrives" style={{ '--p': ((prog ?? 0.15) * 100) + '%' }}><LoaderCircle size={14} class="spin" /></span>
      : <button class="icon-btn sm add" tabIndex={-1} disabled={false} data-tip={r.blocked ? r.summary : rec.imported ? 'Add at playhead (already downloaded)' : 'Add at playhead'} aria-label="Add at playhead" onClick={() => (r.blocked ? (selectedRecord.value = rec) : add())}>{r.blocked ? <Info size={15} /> : rec.imported ? <Check size={15} /> : <Plus size={16} />}</button>}
  </div>;
}
async function afterMusic(clipId) {
  const p = prefs.value;
  if (p.libraryBalance) { const { balanceClip } = await import('../lib/creative.js'); await balanceClip(clipId); }
  if (p.libraryDuck) { const pr = project.value; if (!pr?.clips.some(c => c.id === clipId)) return; const hasVoice = pr.tracks.some(t => t.voice && pr.clips.some(c => c.trackId === t.id)); if (hasVoice) { const { applyDucking } = await import('./Studio.jsx'); await applyDucking(); } else toast('Add or mark a voice track, then turn on ducking in Audio Studio to lower this music while you speak.', 'info'); }
}
function copy(text) { navigator.clipboard.writeText(text).then(() => toast('Credit copied.')).catch(() => toast('Copy failed.', 'error')); }

// Round play/pause button with a progress ring. Only the active button subscribes to the clock.
function PlayButton({ active, onClick, disabled }) {
  const pv = preview.value, state = active ? pv.state : 'idle';
  const frac = active && pv.d ? Math.min(1, previewTime.value / pv.d) : 0;
  return <button class={`lib-play ${active ? 'on' : ''}`} tabIndex={-1} disabled={disabled} aria-label={state === 'playing' || state === 'loading' ? 'Pause preview' : state === 'paused' ? 'Resume preview' : 'Preview'}
    onClick={e => { e.stopPropagation(); onClick(); }} style={active ? { '--p': frac * 100 + '%' } : null}>
    {state === 'loading' ? <LoaderCircle size={14} class="spin" /> : state === 'playing' ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" class="play-glyph" />}
  </button>;
}

function PreviewBar() {
  const pv = preview.value; if (!pv.key) return null;
  const title = pv.title || 'Preview'; const t = previewTime.value;
  const seekAt = e => { const r = e.currentTarget.getBoundingClientRect(); seekPreview((e.clientX - r.left) / r.width); };
  const scrub = e => { if (e.button !== 0) return; const el = e.currentTarget; el.setPointerCapture(e.pointerId); seekAt(e); const mv = ev => seekAt({ currentTarget: el, clientX: ev.clientX }); const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); };
  const playingNow = pv.state === 'playing' || pv.state === 'loading';
  return <div class="preview-bar" role="region" aria-label="Preview">
    <div class="pv-row">
      <button class="icon-btn sm pv-toggle" aria-label={playingNow ? 'Pause preview' : 'Resume preview'} onClick={() => togglePreview({ key: pv.key })}>{playingNow ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</button>
      <b class="grow ellipsis" title={title}>{title}</b>
      <span class="mono muted pv-time">{clock(t)}{pv.d ? ' / ' + clock(pv.d) : ''}</span>
      <button class="icon-btn sm" aria-label="Stop preview" data-tip="Stop" onClick={stopPreview}><X size={14} /></button>
    </div>
    <div class="pv-row">
      <div class="pv-track grow" role="slider" aria-label="Preview position" aria-valuemin={0} aria-valuemax={Math.round(pv.d)} aria-valuenow={Math.round(t)} tabIndex={0} onPointerDown={scrub}
        onKeyDown={e => { if (!pv.d) return; if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); seekPreview(e.key === 'Home' ? 0 : e.key === 'End' ? 1 : (t + (e.key === 'ArrowRight' ? 5 : -5)) / pv.d); } }}><i style={{ width: (pv.d ? Math.min(1, t / pv.d) * 100 : 0) + '%' }} /></div>
      <Volume2 size={13} class="muted" />
      <input type="range" class="pv-vol" min="0" max="1" step="0.05" aria-label="Preview volume" data-tip="Preview volume" value={prefs.value.libraryPreviewVolume ?? 0.8} onInput={e => setPreviewVolume(+e.target.value)} onChange={e => savePrefs({ libraryPreviewVolume: +e.target.value })} />
    </div>
  </div>;
}
const clock = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// License & source drawer: everything needed to judge an item, without leaving FrameCut.
function Drawer() {
  const rec = selectedRecord.value; if (!rec) return null;
  const r = rightsOf(rec); const busy = busyKeys.value.has(rec.key);
  const close = () => (selectedRecord.value = null);
  return <div class="lib-drawer" role="dialog" aria-label={'About ' + rec.title} onKeyDown={e => e.key === 'Escape' && close()}>
    <div class="row"><b class="grow ellipsis" title={rec.title}>{rec.title}</b><button class="icon-btn sm" aria-label="Close" onClick={close}><X size={14} /></button></div>
    <div class="muted small">{rec.creator ? <>by {rec.creatorUrl ? <a href={rec.creatorUrl} target="_blank" rel="noreferrer">{rec.creator}</a> : rec.creator}</> : 'Creator not listed'}{rec.sourceName ? <> · {rec.sourceName}</> : null}{rec.durationMs ? <> · {shortTime(rec.durationMs / 1000)}</> : null}</div>
    <div class={`rights rights-${r.level}`}><div class="row"><LicenseBadge rec={rec} />{rec.licenseUrl && <a href={rec.licenseUrl} target="_blank" rel="noreferrer">{r.name || 'License'} <ExternalLink size={11} /></a>}</div><p>{r.summary}</p>{r.details.length > 0 && <ul>{r.details.map(d => <li key={d}>{d}</li>)}</ul>}</div>
    {rec.description ? <p class="small">{rec.description}{rec.useFor?.length ? <span class="muted"> Good for: {rec.useFor.join(', ').toLowerCase()}.</span> : null}</p> : null}
    {(rec.genres?.length || rec.tags?.length) ? <div class="lib-tags">{[...(rec.genres || []), ...(rec.tags || [])].slice(0, 8).map(t => <span key={t} class="chip">{t}</span>)}</div> : null}
    {r.attribution && <div class="credit-box"><small class="muted">Credit</small><p>{creditLine(rec)}</p><button class="btn sm ghost" onClick={() => copy(creditLine(rec))}><Copy size={12} />Copy</button></div>}
    {r.restrictions?.length > 0 && <ul class="muted tiny">{r.restrictions.map(x => <li key={x}>{x}</li>)}</ul>}
    <p class="muted tiny">Found through {PROVIDERS[rec.provider]?.name}. {PROVIDERS[rec.provider]?.note} {rec.sourcePageUrl && <a href={rec.sourcePageUrl} target="_blank" rel="noreferrer">Open the original page</a>}</p>
    <div class="row">
      <button class="btn sm" onClick={() => toggleFavorite(rec)}><Heart size={13} fill={rec.favorite ? 'currentColor' : 'none'} />{rec.favorite ? 'Saved' : 'Save'}</button>
      {rec.kind !== 'sticker' && <button class="btn sm" onClick={() => togglePreview(rec)}>{preview.value.key === rec.key && preview.value.state !== 'paused' ? <><Pause size={13} />Pause</> : <><Play size={13} />Preview</>}</button>}
      <div class="grow" />
      {r.blocked ? (r.reason === 'non-commercial' ? <button class="btn sm" onClick={() => setUsageMode('personal')}>This is a personal video</button> : <span class="muted small">Can’t be used in video</span>)
        : <button class="btn sm primary" disabled={busy} onClick={() => useRecord(rec).then(id => { if (id && rec.kind === 'music') afterMusic(id); if (id) close(); })}>{busy ? <LoaderCircle size={13} class="spin" /> : <Plus size={13} />}Use in project</button>}
    </div>
  </div>;
}

function MyAudio() {
  const p = project.value; const [q, setQ] = useState('');
  const all = [...media.value.values()].filter(a => a.audio && a.role !== 'sticker' && (p.mediaIds.includes(a.id) || a.role === 'library-audio') && a.name.toLowerCase().includes(q.toLowerCase()));
  all.sort((a, b) => (p.mediaIds.includes(b.id) - p.mediaIds.includes(a.id)) || String(b.imported).localeCompare(String(a.imported)));
  const keyOf = a => 'mine:' + a.id;
  const play = a => !a.missing && togglePreview({ key: keyOf(a), url: a.url, title: (a.source?.title || a.name).replace(/\.[^.]+$/, ''), durationMs: (a.duration || 0) * 1000 });
  const kindOf = a => (a.source?.kind === 'sfx' ? 'sfx' : a.source?.kind === 'music' ? 'music' : a.duration < 20 ? 'sfx' : 'music');
  const add = a => (a.missing ? relinkOne(a) : a.kind === 'audio' ? insertAudio(a, kindOf(a)) : insertAudio(a, 'sfx'));
  return <>
    <button class="studio-entry" onClick={openStudio}><span class="dot" /><div><b>Record voiceover</b><small>Studio-quality WAV · script reader · auto cleanup</small></div></button>
    <div class="asset-tools"><div class="search"><Search size={14} /><input class="input" type="search" placeholder="Search your audio" value={q} onInput={e => setQ(e.target.value)} /></div></div>
    {!all.length ? <div class="lib-state"><Music size={22} /><b>No audio yet</b><span>Add music or sound effects from the other tabs, import your own files, or record a voiceover. Everything here works offline.</span></div>
      : <div class="audio-list" role="listbox" aria-label="My audio" onKeyDown={e => navKeys(e, '.lib-row')}>{all.map(a => {
        const src = a.source && a.source.provider !== 'local' ? a.source : null;
        return <div key={a.id} class={`audio-row lib-row ${a.missing ? 'blocked' : ''}`} role="option" tabIndex={0} draggable={!a.missing} onDragStart={e => dragAsset(e, a, kindOf(a))} onDblClick={e => { if (!e.target.closest('button')) add(a); }}
          onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === ' ') { e.preventDefault(); play(a); } if (e.key === 'Enter') { e.preventDefault(); add(a); } }}
          onContextMenu={e => openMenu(e, [{ text: 'Add at playhead', icon: Plus, onClick: () => add(a) }, src && { text: 'Copy credit', icon: Copy, onClick: () => copy(creditLine(src)) }, src?.sourcePageUrl && { text: 'Open source page', icon: ExternalLink, onClick: () => window.open(src.sourcePageUrl, '_blank') }, native && !a.missing && { text: 'Reveal file', icon: FolderOpen, onClick: () => native.showInFolder(a.folder + '\\' + a.fileName) }, a.missing && { text: 'Relink…', icon: Link2, onClick: () => relinkOne(a) }])}>
          <PlayButton active={preview.value.key === keyOf(a)} disabled={a.missing} onClick={() => play(a)} />
          <div class="grow lib-meta"><div class="ellipsis lib-title">{(src?.title || a.name).replace(/\.[^.]+$/, '')}</div><div class="lib-sub"><small class="muted ellipsis">{a.missing ? 'File missing — relink to use' : [shortTime(a.duration), a.recording ? 'Recording' : src ? src.sourceName || 'Openverse' : a.kind === 'audio' ? 'Your file' : 'From video', p.mediaIds.includes(a.id) ? 'In project' : 'Ready offline'].filter(Boolean).join(' · ')}</small></div></div>
          <button class="icon-btn sm add" tabIndex={-1} data-tip="Add at playhead" aria-label="Add at playhead" onClick={() => add(a)}>{a.missing ? <Link2 size={15} /> : <Plus size={16} />}</button>
        </div>;
      })}</div>}
  </>;
}

// ---------------------------------------------------------------- STICKERS
export function StickerLibrary() {
  useLibraryBoot();
  const tab = stickerTab.value; const ref = useScrollMemory('stickers-' + tab);
  const [size, setSize] = useState(() => { try { return localStorage.getItem('fc:sticker-size') || 'm'; } catch { return 'm'; } });
  useEffect(() => { try { localStorage.setItem('fc:sticker-size', size); } catch {} }, [size]);
  const [over, setOver] = useState(false);
  const drop = async e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setOver(false); stickerTab.value = 'mine'; await importStickerFiles([...e.dataTransfer.files]); };
  return <div class={`tab-body lib size-${size} ${over ? 'drop-over' : ''}`} ref={ref} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={e => !e.currentTarget.contains(e.relatedTarget) && setOver(false)} onDrop={drop}>
    <div class="asset-head"><h2>Stickers</h2><div class="grow" />
      <button class="icon-btn sm" data-tip={size === 'l' ? 'Smaller tiles' : 'Larger tiles'} aria-label="Tile size" onClick={() => setSize(size === 's' ? 'm' : size === 'm' ? 'l' : 's')}>{size === 'l' ? <Rows3 size={14} /> : <LayoutGrid size={14} />}</button>
      <button class="btn sm" onClick={pickStickerFiles} data-tip="PNG, GIF, APNG, WebP, SVG or Lottie"><Upload size={14} />Import</button></div>
    <div class="lib-tabs"><Segmented label="Sticker library" value={tab} options={[['discover', 'Discover'], ['animated', 'Animated'], ['static', 'Static'], ['mine', 'Mine']]} onChange={v => (stickerTab.value = v)} /></div>
    {tab === 'discover' ? <Discover /> : tab === 'animated' ? <Animated /> : tab === 'static' ? <StaticStickers /> : <MyStickers />}
    <Drawer />
  </div>;
}
// Discover searches every free sticker source at once: Fluent animated emoji, CC0 illustrations and
// silhouettes from Openverse, and Pixabay when the creator has added a key.
function Discover() {
  const s = searches.stickers.value; const groups = GROUPS; const L = lists.value.sticker;
  const gridRef = useRef(); const pixabay = libStatus.value?.pixabay?.configured;
  const cats = categories.value.assetpolish || [];
  const total = cats.find(c => c.group === 'all')?.count;
  const topics = cats.filter(c => c.group === 'topic'), collections = cats.filter(c => c.group === 'collection');
  const browsingAssetPolish = !s.source || s.source === 'assetpolish';
  useEffect(() => {
    loadCategories('assetpolish');
    if (searches.stickers.value.status === 'idle') search('stickers', {}, { now: true });
  }, []);
  return <>
    <SearchField panel="stickers" placeholder="Search stickers — party, star, arrow, cat…" onArrowDown={() => gridRef.current?.querySelector('.st-card')?.focus()} />
    <div class="lib-catalog-head"><b>{total != null ? total.toLocaleString() + ' free assets' : 'Free stickers & illustrations'}</b><span class="muted">AssetPolish · CC0{collections.length ? ` · ${collections.length} collections` : ''}</span></div>
    <div class="lib-filters sticker-filters">
      <Select label="Sticker source" value={s.source} options={[['', 'All sources'], ['assetpolish', 'AssetPolish'], ['fluent', 'Fluent Emoji'], ['openverse', 'Openverse'], ...(pixabay ? [['pixabay', 'Pixabay']] : [])]} onChange={v => search('stickers', { source: v, category: '', collection: '' }, { now: true })} />
      {browsingAssetPolish && <>
        <Select label="Sticker topic" value={s.category} options={[[ '', 'All topics' ], ...topics.map(c => [c.id, `${c.name} (${c.count})`])]} onChange={v => search('stickers', { category: v, source: v ? 'assetpolish' : s.source }, { now: true })} />
      </>}
    </div>
    {browsingAssetPolish && <details class="lib-collections" open={!!s.collection}><summary>{s.collection ? s.collection.replace(/^collection:/, '') : 'Browse collections'}</summary><Select label="Sticker collection" value={s.collection} options={[[ '', 'All collections' ], ...collections.map(c => [c.id, `${c.name} (${c.count})`])]} onChange={v => search('stickers', { collection: v, source: v ? 'assetpolish' : s.source }, { now: true })} /></details>}
    <div ref={gridRef}>{s.status === 'loading' || s.status === 'idle' ? <Skeleton grid rows={12} /> : s.status === 'empty' || s.status === 'error' ? <StateCard s={s} panel="stickers" onRetry={() => search('stickers', {}, { now: true })} /> : <><ResultCount s={s} panel="stickers" noun="asset" /><StickerGrid items={s.results} /><MoreButton s={s} panel="stickers" /></>}</div>
    <details class="lib-emoji-browse"><summary>Emoji, shapes & saved stickers</summary>
      {L.recents.length > 0 && <><h4 class="group-title">Recently used</h4><StickerGrid items={L.recents.slice(0, 12)} /></>}
      {L.favorites.length > 0 && <><h4 class="group-title">Favorites</h4><StickerGrid items={L.favorites.slice(0, 24)} /></>}
      <div class="cat-grid">{groups.map(g => <button key={g.id} class="cat-tile" onClick={() => { stickerTab.value = 'animated'; search('fluent', { category: g.id, q: '' }, { now: true }); }}><span class="emo">{g.glyph}</span><span>{g.name}</span></button>)}<button class="cat-tile" onClick={() => (stickerTab.value = 'static')}><Shapes size={22} /><span>Shapes & emoji</span></button></div>
    </details>
    <p class="muted hint lib-intro">No credits needed. Motion designs from AssetPolish are offered as still stickers; use Animated for moving emoji. Added stickers are saved locally and work offline.</p>
  </>;
}
const GROUPS = [['Smileys & Emotion', '😀'], ['People & Body', '👋'], ['Animals & Nature', '🦊'], ['Food & Drink', '🍕'], ['Activities', '🎉'], ['Travel & Places', '🚀'], ['Objects', '💡'], ['Flags', '🏁']].map(([id, glyph]) => ({ id, name: id.replace(' & ', ' & '), glyph }));
function MoreButton({ s, panel = 'fluent' }) { return s.page < s.pages ? <div class="lib-more lib-pagination"><span class="muted">Showing {s.results.length.toLocaleString()} of {s.total.toLocaleString()}</span><button class="btn sm ghost" disabled={s.status === 'more'} onClick={() => search(panel, {}, { more: true })}>{s.status === 'more' ? <LoaderCircle size={14} class="spin" /> : null}Show more</button></div> : null; }
function Animated() {
  const s = searches.fluent.value;
  useEffect(() => { if (!s.category && !s.q) search('fluent', { category: GROUPS[0].id }, { now: true }); }, []);
  return <>
    <SearchField panel="fluent" placeholder="Search animated stickers" />
    <div class="filter-chips">{GROUPS.map(g => <button key={g.id} class={`fchip ${s.category === g.id ? 'on' : ''}`} onClick={() => search('fluent', { category: s.category === g.id ? '' : g.id }, { now: true })}>{g.glyph} {g.name}</button>)}</div>
    {s.status === 'loading' ? <Skeleton grid rows={18} /> : s.status === 'empty' || s.status === 'error' ? <StateCard s={s} panel="fluent" onRetry={() => search('fluent', {}, { now: true })} /> : <><StickerGrid items={s.results} /><MoreButton s={s} /></>}
  </>;
}
function StickerGrid({ items }) {
  return <div class="sticker-grid" role="listbox" aria-label="Stickers" onKeyDown={e => navKeys(e, '.st-card')}>{items.map(r => (r.provider === 'fluent' ? <FluentCard key={r.key} rec={r} /> : <ImageCard key={r.key} rec={r} />))}</div>;
}
// Illustration / silhouette sticker from Openverse or Pixabay: thumbnail preview, source in the tooltip.
function ImageCard({ rec }) {
  const [loaded, setLoaded] = useState(false), [broken, setBroken] = useState(false);
  const busy = busyKeys.value.has(rec.key), prog = busyKeys.value.get(rec.key);
  const add = () => useRecord(rec);
  const local = rec.imported && asset(rec.imported);
  const src = local && !local.missing ? local.url : `/api/creative/preview/${rec.provider}/${encodeURIComponent(rec.sourceId)}`;
  const from = rec.sourceName || PROVIDERS[rec.provider]?.name || rec.provider;
  const menu = e => openMenu(e, [
    { text: 'Add at playhead', icon: Plus, onClick: add },
    { text: rec.favorite ? 'Remove from favorites' : 'Save to favorites', icon: Heart, onClick: () => toggleFavorite(rec) },
    { divider: true },
    { text: 'View license & source', icon: Info, onClick: () => (selectedRecord.value = rec) },
    rec.sourcePageUrl && { text: 'Open source page', icon: ExternalLink, onClick: () => window.open(rec.sourcePageUrl, '_blank') },
  ]);
  return <div class={`st-card img-card ${busy ? 'busy' : ''}`} role="option" tabIndex={0} aria-label={`${rec.title}, ${rec.animated ? 'animated ' : ''}sticker from ${from}${rec.imported ? ', ready offline' : ''}`} data-tip={`${rec.title} · ${from}${rec.creator && rec.creator !== from ? ' · ' + rec.creator : ''} · ${rightsOf(rec).badge}`} draggable
    onDragStart={e => dragRecord(e, rec)} onClick={add} onContextMenu={menu}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ' || e.key === '+') { e.preventDefault(); add(); } if (e.key.toLowerCase() === 'f') toggleFavorite(rec); if (e.key === 'i') selectedRecord.value = rec; }}>
    {!loaded && <span class="st-skel" aria-hidden="true">{broken ? <TriangleAlert size={16} class="muted" /> : <Shapes size={18} class="muted" />}</span>}
    {!broken && <img src={src} alt="" loading="lazy" draggable={false} class={loaded ? 'on' : ''} onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />}
    <span class="st-src">{from}</span>
    <span class="st-name">{rec.title}</span>
    {rec.animated && <span class="st-anim" data-tip="Animated"><Sparkles size={10} /></span>}
    {rec.imported && <span class="st-ready" data-tip="Downloaded — works offline"><Check size={10} /></span>}
    {rec.favorite && <Heart size={11} class="st-fav" fill="currentColor" />}
    {busy && <span class="st-busy" style={{ '--p': ((prog ?? 0.1) * 100) + '%' }}><LoaderCircle size={16} class="spin" /></span>}
  </div>;
}
function FluentCard({ rec }) {
  const [live, setLive] = useState(false), [loaded, setLoaded] = useState(false);
  const busy = busyKeys.value.has(rec.key), prog = busyKeys.value.get(rec.key);
  const animate = () => { if (!reduced()) setLive(true); };
  const add = () => useRecord(rec);
  const menu = e => openMenu(e, [
    { text: 'Add at playhead', icon: Plus, onClick: add },
    { text: live ? 'Stop animation preview' : 'Preview animation', icon: Play, onClick: () => setLive(!live) },
    { text: rec.favorite ? 'Remove from favorites' : 'Save to favorites', icon: Heart, onClick: () => toggleFavorite(rec) },
    { divider: true },
    { text: 'View license & source', icon: Info, onClick: () => (selectedRecord.value = rec) },
    { text: 'Copy credit', icon: Copy, onClick: () => copy(creditLine(rec)) },
  ]);
  return <div class={`st-card ${busy ? 'busy' : ''}`} role="option" tabIndex={0} aria-label={`${rec.title}, animated sticker${rec.imported ? ', ready offline' : ''}`} data-tip={`${rec.title} · Fluent Emoji · MIT`} draggable
    onDragStart={e => dragRecord(e, rec)} onClick={add} onContextMenu={menu} onPointerEnter={animate} onPointerLeave={() => setLive(false)} onFocus={animate} onBlur={() => setLive(false)}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ' || e.key === '+') { e.preventDefault(); add(); } if (e.key.toLowerCase() === 'f') toggleFavorite(rec); if (e.key === 'i') selectedRecord.value = rec; }}>
    <span class={`emo ${live && loaded ? 'hide' : ''}`} aria-hidden="true">{rec.glyph || '✨'}</span>
    {live && <img src={`/api/creative/preview/fluent/${rec.sourceId}`} alt="" draggable={false} class={loaded ? 'on' : ''} onLoad={() => setLoaded(true)} onError={() => setLive(false)} />}
    {rec.imported && <span class="st-ready" data-tip="Downloaded — works offline"><Check size={10} /></span>}
    {rec.favorite && <Heart size={11} class="st-fav" fill="currentColor" />}
    {busy && <span class="st-busy" style={{ '--p': ((prog ?? 0.1) * 100) + '%' }}><LoaderCircle size={16} class="spin" /></span>}
  </div>;
}
function StaticStickers() {
  const [cat, setCat] = useState('Shapes');
  const cats = ['Shapes', ...Object.keys(EMOJI)];
  return <>
    <div class="filter-chips">{cats.map(c => <button key={c} class={`fchip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>
    {cat === 'Shapes' ? <div class="tile-grid">{SHAPE_STICKERS.map(s => <button key={s.id} class="tile sticker-tile" data-tip={s.name} draggable onDragStart={e => { e.dataTransfer.setData('application/x-framecut', '{}'); window.__fcDrag = { type: 'sticker', sticker: { type: 'shape', value: s.id } }; }} onClick={() => addSticker({ type: 'shape', value: s.id, name: s.name })}><img src={svgUrl(s.svg)} alt={s.name} draggable={false} /></button>)}</div>
      : <div class="emoji-grid">{EMOJI[cat].map(e => <button key={e} class="emoji" draggable data-tip="Drag onto the video or the timeline, or into a text box to add it to the text" onDragStart={ev => { ev.dataTransfer.setData('application/x-framecut', '{}'); ev.dataTransfer.setData('text/plain', e); ev.dataTransfer.effectAllowed = 'copy'; window.__fcDrag = { type: 'sticker', sticker: { type: 'emoji', value: e } }; }} onClick={() => addSticker({ type: 'emoji', value: e })}>{e}</button>)}</div>}
    <p class="muted hint">Built-in shapes and your system’s emoji. Select one and open <b>Animation</b> to make it bounce, pulse or spin.</p>
  </>;
}
function MyStickers() {
  const p = project.value;
  const list = [...media.value.values()].filter(a => a.role === 'sticker').sort((a, b) => (p.mediaIds.includes(b.id) - p.mediaIds.includes(a.id)) || String(b.imported).localeCompare(String(a.imported)));
  return <>
    <button class="dropzone compact" onClick={pickStickerFiles}><Upload size={20} /><b>Import your stickers</b><span>PNG, GIF, APNG, WebP, SVG or Lottie (.json) — or drop files here. Transparency and animation are kept.</span></button>
    {list.length > 0 && <div class="sticker-grid" role="listbox" aria-label="My stickers" onKeyDown={e => navKeys(e, '.st-card')}>{list.map(a => <AssetSticker key={a.id} a={a} />)}</div>}
    {!list.length && <p class="muted hint">Stickers you add from Discover also appear here, ready to use offline.</p>}
  </>;
}
function AssetSticker({ a }) {
  const [live, setLive] = useState(false);
  const add = () => (a.missing ? relinkOne(a) : insertSticker(a));
  const src = a.source && a.source.provider !== 'local' ? a.source : null;
  return <div class={`st-card ${a.missing ? 'missing' : ''}`} role="option" tabIndex={0} draggable={!a.missing} aria-label={a.name} data-tip={(src ? `${src.title} · ${src.sourceName || ''} · ${src.license?.toUpperCase()}` : a.name.replace(/\s*\(sticker\)$/, '')) + (a.missing ? ' — file missing' : '')}
    onDragStart={e => dragAsset(e, a, 'sticker')} onClick={add} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(); } }}
    onPointerEnter={() => !reduced() && setLive(true)} onPointerLeave={() => setLive(false)} onFocus={() => !reduced() && setLive(true)} onBlur={() => setLive(false)}
    onContextMenu={e => openMenu(e, [{ text: 'Add at playhead', icon: Plus, onClick: add }, src && { text: 'Copy credit', icon: Copy, onClick: () => copy(creditLine(src)) }, native && !a.missing && { text: 'Reveal file', icon: FolderOpen, onClick: () => native.showInFolder(a.folder + '\\' + a.fileName) }, a.missing && { text: 'Relink…', icon: Link2, onClick: () => relinkOne(a) }])}>
    {a.missing ? <TriangleAlert size={20} class="muted" /> : a.kind === 'video' ? <video src={a.url} muted loop playsInline autoplay={live} ref={el => { if (el) { live ? el.play().catch(() => {}) : (el.pause(), (el.currentTime = Math.min(0.5, (a.duration || 1) / 2))); } }} /> : <img src={a.url} alt="" draggable={false} />}
    {a.animated && <span class="st-anim" data-tip="Animated"><Sparkles size={10} /></span>}
  </div>;
}
