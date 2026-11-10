// Creative Library: one browser for music, sound effects and stickers. Search online, preview,
// then click, press Enter or drag to put an asset on the timeline. Every result shows its source
// and license; anything that cannot be used for this project says why instead of failing silently.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Music, AudioLines, FolderOpen, Search, X, Play, Pause, Square, Plus, Heart, LoaderCircle, Upload, WifiOff, TriangleAlert, Clock, Info, ExternalLink, Copy, Check, Sparkles, Shapes, Smile, Ban, Mic, Link2, Rows3, LayoutGrid, Volume2, Hourglass, ChevronRight, SlidersHorizontal, Maximize2, Minimize2, Headphones } from 'lucide-preact';
import { project, media, asset, toast, prefs, savePrefs, time, player, audioExpanded } from '../lib/state.js';
import { native, api } from '../lib/api.js';
import { addSticker } from '../lib/edit.js';
import { openMenu, Segmented, Select, Progress, Toggle } from './kit.jsx';
import { importMedia } from './commands.jsx';
import { openStudio } from './Studio.jsx';
import { relinkOne } from './AssetPanel.jsx';
import { EMOJI, SHAPE_STICKERS } from '../../shared/catalog.mjs';
import { creditLine, PROVIDERS } from '../../shared/rights.mjs';
import { AUDIO_DISCOVERY } from '../../shared/audio-library.mjs';
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
  music: [['', 'All music sources'], ['ccmixter', 'ccMixter'], ['openverse', 'Openverse'], ['archive', 'Internet Archive']],
  sfx: [['', 'All sound sources'], ['sfxkit', 'SFX Kit'], ['sfxmint', 'SFXMint'], ['openverse', 'Openverse']],
};
const SOURCE_NAMES = { openverse: 'Openverse', ccmixter: 'ccMixter', archive: 'Internet Archive', sfxmint: 'SFXMint', sfxkit: 'SFX Kit', fluent: 'Fluent Emoji', pixabay: 'Pixabay' };
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
  const tab = audioTab.value, ref = useScrollMemory('audio-' + tab);
  useEffect(() => () => stopPreview(), []);
  const navigate = next => {
    audioTab.value = next;
    if (next === 'sfx' && !searches.sfx.value.visited) search('sfx', { source: '', category: '', q: '', visited: true }, { now: true });
  };
  return <div class="tab-body lib audio-hub" ref={ref}>
    <div class="asset-head"><h2>Audio</h2><div class="grow" />
      <button class="icon-btn sm" aria-label={audioExpanded.value ? 'Compact audio library' : 'Expand audio library'} data-tip={audioExpanded.value ? 'Compact library' : 'More room to browse'} onClick={() => (audioExpanded.value = !audioExpanded.value)}>{audioExpanded.value ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      <button class="btn sm" onClick={() => importMedia()} data-tip="Import your own music or sound files"><Upload size={14} />Import</button>
    </div>
    <nav class="lib-tabs audio-nav" aria-label="Audio library">{[['discover', 'Discover'], ['music', 'Music'], ['sfx', 'Sound FX'], ['favorites', 'Favorites'], ['recent', 'Recent'], ['mine', 'My audio']].map(([id, label]) => <button key={id} class={tab === id ? 'on' : ''} aria-pressed={tab === id} onClick={() => navigate(id)}>{label}</button>)}</nav>
    {tab === 'discover' ? <AudioDiscover /> : tab === 'mine' ? <MyAudio /> : tab === 'favorites' || tab === 'recent' ? <SavedAudio recent={tab === 'recent'} /> : <OnlineAudio key={tab} panel={tab} />}
    <PreviewBar /><Drawer />
  </div>;
}

function browseMusic(item) {
  const patch = { q: '', source: '', category: '', length: '', browseQuery: item[2], browseTitle: item[1] };
  try { localStorage.setItem('fc:audio-last-lens', JSON.stringify(patch)); } catch {}
  audioTab.value = 'music'; search('music', patch, { now: true });
}
function BrowseRail({ label, className, children }) {
  const ref = useRef(), [edges, setEdges] = useState([false, false]);
  useLayoutEffect(() => {
    const el = ref.current;
    const update = () => setEdges([el.scrollLeft > 1, el.scrollLeft + el.clientWidth < el.scrollWidth - 2]);
    const observer = new ResizeObserver(update); observer.observe(el);
    el.addEventListener('scroll', update, { passive: true }); update();
    return () => { observer.disconnect(); el.removeEventListener('scroll', update); };
  }, [children.length]);
  const move = direction => ref.current.scrollBy({ left: direction * ref.current.clientWidth * .8, behavior: reduced() ? 'instant' : 'smooth' });
  return <div class="browse-rail-wrap">
    {(edges[0] || edges[1]) && <div class="browse-rail-controls"><button class="icon-btn sm" aria-label={'Previous ' + label} disabled={!edges[0]} onClick={() => move(-1)}><ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /></button><button class="icon-btn sm" aria-label={'Next ' + label} disabled={!edges[1]} onClick={() => move(1)}><ChevronRight size={14} /></button></div>}
    <div ref={ref} class={className + ' browse-rail'} aria-label={label} tabIndex={0} onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); move(e.key === 'ArrowLeft' ? -1 : 1); } if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); ref.current.scrollTo({ left: e.key === 'Home' ? 0 : ref.current.scrollWidth }); } }}>{children}</div>
  </div>;
}
function DiscoveryRail({ title, items, group }) {
  return <section class="audio-discovery-section"><h3>{title}</h3><BrowseRail className="audio-category-rail" label={title}>{items.map((item, i) => <button key={item[0]} class={`audio-category mood-${group}`} style={{ '--category-hue': (i * 41 + (group === 'mood' ? 20 : 160)) % 360 }} onClick={() => browseMusic(item)} data-tip={'Explore music matching “' + item[2] + '”'}><span class="audio-category-art"><Music size={23} strokeWidth={1.6} /><i /><i /></span><b>{item[1]}</b><span>Explore <ChevronRight size={11} /></span></button>)}</BrowseRail></section>;
}
function AudioDiscover() {
  const s = searches.music.value, fx = searches.sfx.value;
  useEffect(() => {
    if (searches.music.value.status === 'idle') {
      let last = {}; try { last = JSON.parse(localStorage.getItem('fc:audio-last-lens') || '{}'); } catch {}
      search('music', { q: '', browseQuery: last.browseQuery || 'ambient', browseTitle: last.browseTitle || 'Ambient & atmospheric' }, { now: true });
    }
    if (searches.sfx.value.status === 'idle') search('sfx', { q: '', source: 'sfxkit', category: '' }, { now: true });
  }, []);
  return <>
    <SearchField panel="music" placeholder="Search music, artists, moods…" />
    <div class="audio-welcome"><span class="audio-eyebrow">YOUR NEXT VIDEO STARTS HERE</span><h3>Find its sound.</h3><p>Music, little details, big moments.</p><span class="audio-library-note"><Check size={11} />CC0 audio · source details kept with every download</span><button class="audio-comedy-link" onClick={() => browseMusic(AUDIO_DISCOVERY.moods[0])}><Smile size={14} />Goofy & funny music<ChevronRight size={12} /></button></div>
    <DiscoveryRail title="Browse by mood" items={AUDIO_DISCOVERY.moods} group="mood" />
    <section class="audio-discovery-section"><div class="audio-section-head"><div><h3>{s.q ? 'Search results' : s.browseTitle || 'Music to start with'}</h3><small class="muted">{s.q ? 'Across your enabled music sources' : 'A starting point for your edit'}</small></div><button class="icon-btn sm" aria-label="View all music" onClick={() => (audioTab.value = 'music')}><ChevronRight size={17} /></button></div>
      <AudioResults s={s} panel="music" limit={6} compact />
    </section>
    <DiscoveryRail title="Browse by genre" items={AUDIO_DISCOVERY.genres} group="genre" />
    <DiscoveryRail title="Made for your video" items={AUDIO_DISCOVERY.purposes} group="purpose" />
    <section class="audio-discovery-section"><div class="audio-section-head"><div><h3>The finishing touches</h3><small class="muted">Sound effects for cuts, movement & accents</small></div><button class="icon-btn sm" aria-label="Browse sound effects" onClick={() => { audioTab.value = 'sfx'; search('sfx', { q: '', source: '', category: '', visited: true }, { now: true }); }}><ChevronRight size={17} /></button></div><AudioResults s={fx} panel="sfx" limit={4} compact /></section>
    <button class="audio-studio-link" onClick={openStudio}><Headphones size={17} /><span><b>Make it sound like you.</b><small>Record, clean up, balance & duck in Audio Studio</small></span><ChevronRight size={15} /></button>
  </>;
}
function MusicMixOptions() {
  const p = prefs.value;
  return <div class="lib-mix" role="group" aria-label="When adding music">
    <button class={`fchip ${p.libraryBalance ? 'on' : ''}`} aria-pressed={!!p.libraryBalance} onClick={() => savePrefs({ libraryBalance: !p.libraryBalance })} data-tip="Measure new music and set its level. Recordings are never changed."><Volume2 size={12} />Auto balance</button>
    <button class={`fchip ${p.libraryDuck ? 'on' : ''}`} aria-pressed={!!p.libraryDuck} onClick={() => savePrefs({ libraryDuck: !p.libraryDuck })} data-tip="Lower new music during detected speech on voice tracks."><Mic size={12} />Duck under voice</button>
  </div>;
}
function AudioResults({ s, panel, limit, compact }) {
  if (s.status === 'loading' || (s.status === 'idle' && !s.q)) return <Skeleton rows={compact ? 3 : 6} />;
  if (s.status === 'idle') return <p class="muted audio-empty-hint">Type at least two letters, or choose a collection below.</p>;
  if (s.status === 'error' || s.status === 'empty') return <>{s.partial?.length > 0 && <div class="audio-source-notice" role="status">Some sources are still loading or unavailable. <button onClick={() => search(panel, {}, { now: true })}>Retry</button></div>}<StateCard s={s} panel={panel} onRetry={() => search(panel, {}, { now: true })} />{s.page < s.pages && <MoreButton s={s} panel={panel} />}</>;
  let items = [...s.results];
  if (s.sort === 'title') items.sort((a, b) => a.title.localeCompare(b.title));
  if (s.sort === 'short') items.sort((a, b) => (a.durationMs || Infinity) - (b.durationMs || Infinity));
  if (s.sort === 'long') items.sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0));
  if (limit) items = items.slice(0, limit);
  return <>
    {!compact && <div class="audio-result-summary" aria-live="polite"><span>{s.results.length} {panel === 'music' ? 'tracks' : 'sounds'} shown</span><span>{[...new Set(s.results.map(r => r.sourceName || SOURCE_NAMES[r.provider]))].filter(Boolean).join(' · ')}</span></div>}
    {s.partial?.length > 0 && <div class="audio-source-notice" role="status">{s.partial.map(p => `${SOURCE_NAMES[p.provider] || p.provider} ${p.code === 'slow' ? 'is still loading' : p.code === 'quota' ? 'has reached its access limit' : 'is unavailable'}`).join(' · ')}<button onClick={() => search(panel, {}, { now: true })}>Retry</button></div>}
    <AudioList items={items} panel={panel} />
    {!compact && <MoreButton s={s} panel={panel} />}
  </>;
}
function OnlineAudio({ panel }) {
  const s = searches[panel].value, p = prefs.value, [filters, setFilters] = useState(false);
  const listRef = useRef();
  useEffect(() => {
    if (searches[panel].value.status === 'idle') search(panel, {}, { now: true });
    if (panel === 'sfx') { loadCategories('sfxkit'); if (prefs.value.librarySources?.sfxmint !== false) loadCategories('sfxmint'); }
  }, [panel]);
  const fxCategories = panel === 'sfx' ? [...(categories.value.sfxkit || []).map(c => ({ ...c, provider: 'sfxkit' })), ...(categories.value.sfxmint || []).map(c => ({ ...c, provider: 'sfxmint' }))].filter(c => p.librarySources?.[c.provider] !== false) : [];
  const activeFilters = [s.length, s.source].filter(Boolean).length;
  const sourceOptions = SOURCES[panel].filter(([id]) => !id || (p.librarySources?.[id] ?? libStatus.value?.providers?.find(x => x.id === id)?.active ?? id !== 'archive'));
  return <>
    <SearchField panel={panel} placeholder={panel === 'music' ? 'Search music, artists, moods…' : 'Search sound effects — whoosh, click, rain…'} onArrowDown={() => listRef.current?.querySelector('.lib-row')?.focus()} />
    <div class="audio-section-head audio-browse-title"><div><h3>{s.q ? 'Search results' : s.category ? fxCategories.find(c => c.id === s.category && c.provider === s.source)?.name || 'Sound collection' : panel === 'music' ? s.browseTitle || 'Ambient & atmospheric' : 'Sound effects'}</h3><small class="muted">{panel === 'music' ? s.q ? 'Find a track for your video' : 'Discovery search: ' + (s.browseQuery || 'ambient') : 'Transitions, accents & environments'}</small></div><button class={`btn sm ghost ${filters ? 'on' : ''}`} aria-expanded={filters} onClick={() => setFilters(!filters)}><SlidersHorizontal size={13} />Filters{activeFilters ? ` (${activeFilters})` : ''}</button></div>
    {filters && <div class="audio-filter-panel"><div class="lib-filters"><Select label="Source" value={s.source} options={sourceOptions} onChange={v => search(panel, { source: v, category: '' }, { now: true })} /><Select label="Length" value={s.length} options={panel === 'music' ? [['', 'Any length'], ['clip', 'Under 1 min'], ['song', 'Over 1 min']] : [['', 'Any length'], ['short', 'Under 10 s'], ['medium', '10–60 s'], ['long', 'Over 1 min']]} onChange={v => search(panel, { length: v }, { now: true })} /><Select label="Sort shown tracks" value={s.sort} options={[['relevance', 'Provider order'], ['title', 'Title A–Z'], ['short', 'Shortest first'], ['long', 'Longest first']]} onChange={v => (searches[panel].value = { ...searches[panel].value, sort: v })} /></div><p class="muted tiny">Only CC0 audio with source license metadata is shown.</p><details class="audio-project-use"><summary>Project use</summary><UsageSwitch /><small class="muted">For license checks on older assets already in this project.</small></details></div>}
    {panel === 'music' && <MusicMixOptions />}
    {panel === 'sfx' && <Chips label="Goofy & silly sounds" icon={Smile} items={['Boing', 'Cartoon', 'Pop', 'Squeak', 'Laugh', 'Slide whistle']} onPick={q => search('sfx', { q, source: '', category: '' }, { now: true })} />}
    {!s.q && panel === 'sfx' && fxCategories.length > 0 && <BrowseRail className="audio-fx-categories" label="Sound effect categories">{fxCategories.map(c => <button key={c.provider + c.id} class={s.source === c.provider && s.category === c.id ? 'on' : ''} onClick={() => search('sfx', { source: c.provider, category: c.id, q: '' }, { now: true })}><AudioLines size={16} /><b>{c.name}</b><small>{SOURCE_NAMES[c.provider]}</small></button>)}</BrowseRail>}
    {s.q && <Chips label="Recent searches" icon={Clock} items={recentSearches(panel).filter(q => q !== s.q).slice(0, 4)} onPick={q => search(panel, { q }, { now: true })} />}
    <div ref={listRef}><AudioResults s={s} panel={panel} /></div>
    {panel === 'music' && !s.q && <DiscoveryRail title="Try another mood" items={AUDIO_DISCOVERY.moods} group="mood" />}
    {s.source === 'sfxmint' && <p class="muted audio-provider-note">SFXMint offers up to 50 matches per search. Browse another category to explore more. Anonymous access: 20 lookups and 5 selected downloads per UTC day; listening is free. Optional keys are in Preferences › Library.</p>}
  </>;
}
function SavedAudio({ recent }) {
  const [q, setQ] = useState(''); const all = recent ? lists.value.audio.recents : lists.value.audio.favorites;
  const items = all.filter(r => [r.title, r.creator, r.sourceName].join(' ').toLowerCase().includes(q.toLowerCase()));
  return <><div class="search lib-search"><Search size={14} /><input class="input" type="search" aria-label={recent ? 'Filter recently used audio' : 'Filter favorite audio'} placeholder={recent ? 'Filter recently used…' : 'Filter favorites…'} value={q} onInput={e => setQ(e.target.value)} /></div><div class="audio-browse-title"><h3>{recent ? 'Recently used' : 'Your favorites'}</h3><p class="muted">{recent ? 'Sounds you have added to your projects.' : 'The right sound, ready when you need it.'}</p></div>{items.length ? <AudioList items={items} /> : <div class="lib-state">{recent ? <Clock size={22} /> : <Heart size={22} />}<b>{q ? 'No matching saved audio' : recent ? 'Your next sound starts here' : 'Keep the good ones close'}</b><span>{q ? 'Try a different word.' : recent ? 'Audio you add to a timeline will appear here.' : 'Use the heart on any track or sound to save it here.'}</span><button class="btn sm" onClick={() => (audioTab.value = 'discover')}>Explore audio</button></div>}</>;
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
  const s = searches.stickers.value, gridRef = useRef(), pixabay = libStatus.value?.pixabay?.configured;
  useEffect(() => {
    if (searches.stickers.value.status === 'idle' || searches.stickers.value.source === 'assetpolish') search('stickers', { q: '', source: 'fluent', category: 'Smileys & Emotion', collection: '' }, { now: true });
  }, []);
  return <>
    <SearchField panel="stickers" placeholder="Search expressive stickers…" onArrowDown={() => gridRef.current?.querySelector('.st-card')?.focus()} />
    <div class="lib-catalog-head"><b>Expressive stickers</b><span class="muted">Microsoft Fluent · animated 3D artwork</span></div>
    {pixabay && <Select label="Sticker source" value={s.source || 'fluent'} options={[[ 'fluent', 'Microsoft Fluent' ], [ 'pixabay', 'Pixabay illustrations' ]]} onChange={v => search('stickers', { source: v, category: '', q: '' }, { now: true })} />}
    {(!s.source || s.source === 'fluent') && <BrowseRail className="sticker-category-strip" label="Sticker categories"><button class={`fchip ${!s.category ? 'on' : ''}`} onClick={() => search('stickers', { category: '', q: '' }, { now: true })}>All</button>{GROUPS.map(g => <button key={g.id} class={`fchip ${s.category === g.id ? 'on' : ''}`} onClick={() => search('stickers', { category: g.id, q: '' }, { now: true })}>{g.glyph} {g.name}</button>)}</BrowseRail>}
    <div ref={gridRef}>{s.status === 'loading' || s.status === 'idle' ? <Skeleton grid rows={12} /> : s.status === 'empty' || s.status === 'error' ? <StateCard s={s} panel="stickers" onRetry={() => search('stickers', {}, { now: true })} /> : <><ResultCount s={s} panel="stickers" noun="sticker" /><StickerGrid items={s.results} /><MoreButton s={s} panel="stickers" /></>}</div>
    <p class="muted hint lib-intro">Hover to see the animation. Click or drag to add. Downloaded stickers stay available offline. Your own PNG, GIF, APNG, WebP, SVG and Lottie imports are welcome too.</p>
  </>;
}

const GROUPS = [['Smileys & Emotion', '😀'], ['People & Body', '👋'], ['Animals & Nature', '🦊'], ['Food & Drink', '🍕'], ['Activities', '🎉'], ['Travel & Places', '🚀'], ['Objects', '💡'], ['Flags', '🏁']].map(([id, glyph]) => ({ id, name: id.replace(' & ', ' & '), glyph }));
function MoreButton({ s, panel = 'fluent' }) { return s.page < s.pages ? <div class="lib-more lib-pagination"><span class="muted">{['music', 'sfx'].includes(panel) ? `${s.results.length} shown · more available` : `Showing ${s.results.length.toLocaleString()} of ${(s.total || 0).toLocaleString()}`}</span><button class="btn sm ghost" disabled={s.status === 'more'} onClick={() => search(panel, {}, { more: true })}>{s.status === 'more' ? <LoaderCircle size={14} class="spin" /> : null}Show more</button></div> : null; }
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
  const [still, setStill] = useState(null), [broken, setBroken] = useState(false), imageRef = useRef();
  useEffect(() => {
    if (live || !loaded || still || !imageRef.current?.naturalWidth) return;
    try { const c = document.createElement('canvas'); c.width = c.height = 128; c.getContext('2d').drawImage(imageRef.current, 0, 0, 128, 128); setStill(c.toDataURL('image/png')); } catch {}
  }, [live, loaded, still]);
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
    <span class={`emo ${loaded ? 'hide' : ''}`} aria-hidden="true">{rec.glyph || '✨'}</span>
    {!broken && <img ref={imageRef} src={!live && still ? still : `/api/creative/preview/fluent/${rec.sourceId}`} alt="" loading="lazy" draggable={false} class={loaded ? 'on' : ''} onLoad={() => setLoaded(true)} onError={() => { setBroken(true); setLive(false); setLoaded(false); }} />}
    <span class="st-name">{rec.title}</span>
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
  const list = [...media.value.values()].filter(a => a.role === 'sticker' && a.source?.provider !== 'assetpolish').sort((a, b) => (p.mediaIds.includes(b.id) - p.mediaIds.includes(a.id)) || String(b.imported).localeCompare(String(a.imported)));
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
