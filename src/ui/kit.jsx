// Shared UI primitives.
import { useEffect, useRef, useState, useLayoutEffect } from 'preact/hooks';
import { signal } from '@preact/signals';
import { X, RotateCcw, ChevronDown, ChevronRight } from 'lucide-preact';
import { menu, dialog, toasts, dismissToast } from '../lib/state.js';

// ---------- Tooltip (any element with data-tip / data-kbd) ----------
const tip = signal(null);
let tipTimer;
export function installTooltips() {
  document.addEventListener('pointerover', e => {
    const el = e.target.closest?.('[data-tip]'); clearTimeout(tipTimer);
    if (!el) { tip.value = null; return; }
    tipTimer = setTimeout(() => { const r = el.getBoundingClientRect(); tip.value = { text: el.dataset.tip, kbd: el.dataset.kbd, x: r.left + r.width / 2, y: r.bottom + 8, top: r.top }; }, 450);
  });
  document.addEventListener('pointerdown', () => { clearTimeout(tipTimer); tip.value = null; }, true);
}
export function TooltipHost() {
  const t = tip.value; const ref = useRef();
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!t || !ref.current) return setPos(null);
    const w = ref.current.offsetWidth, h = ref.current.offsetHeight;
    let x = Math.min(window.innerWidth - w - 8, Math.max(8, t.x - w / 2)), y = t.y; if (y + h > window.innerHeight - 8) y = t.top - h - 8;
    setPos({ x, y });
  }, [t]);
  if (!t) return null;
  return <div ref={ref} class="tooltip" style={{ left: pos?.x ?? -999, top: pos?.y ?? -999 }}>{t.text}{t.kbd && <span class="kbd">{t.kbd}</span>}</div>;
}

// ---------- Menus ----------
export function openMenu(e, items, { align } = {}) {
  e.preventDefault?.(); e.stopPropagation?.();
  const r = e.currentTarget?.getBoundingClientRect?.();
  const x = align === 'below' && r ? r.left : e.clientX, y = align === 'below' && r ? r.bottom + 4 : e.clientY;
  menu.value = { x, y, items };
}
export function MenuHost() {
  const m = menu.value; const ref = useRef(); const [pos, setPos] = useState(null); const [active, setActive] = useState(-1);
  useLayoutEffect(() => {
    if (!m || !ref.current) return; const w = ref.current.offsetWidth, h = ref.current.offsetHeight;
    setPos({ x: Math.min(m.x, window.innerWidth - w - 8), y: m.y + h > window.innerHeight - 8 ? Math.max(8, m.y - h) : m.y }); setActive(-1);
  }, [m]);
  useEffect(() => {
    if (!m) return;
    const close = e => { if (!ref.current?.contains(e.target)) menu.value = null; };
    const key = e => {
      const items = m.items.filter(i => i && !i.divider && !i.label && !i.disabled);
      if (e.key === 'Escape') { menu.value = null; e.stopPropagation(); }
      if (e.key === 'ArrowDown') { setActive(a => (a + 1) % items.length); e.preventDefault(); }
      if (e.key === 'ArrowUp') { setActive(a => (a - 1 + items.length) % items.length); e.preventDefault(); }
      if (e.key === 'Enter' && active >= 0) { menu.value = null; items[active].onClick?.(); e.preventDefault(); }
    };
    setTimeout(() => document.addEventListener('pointerdown', close), 0); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key, true); };
  }, [m, active]);
  if (!m) return null;
  let idx = -1;
  return <div ref={ref} class="menu" role="menu" style={{ left: pos?.x ?? m.x, top: pos?.y ?? m.y, visibility: pos ? 'visible' : 'hidden' }} onContextMenu={e => e.preventDefault()}>
    {m.items.filter(Boolean).map((it, i) => {
      if (it.divider) return <div key={i} class="menu-sep" />;
      if (it.label) return <div key={i} class="menu-label">{it.label}</div>;
      if (!it.disabled) idx++;
      const Icon = it.icon; const myIdx = it.disabled ? -1 : idx;
      return <button key={i} role="menuitem" class={`menu-item ${it.danger ? 'danger' : ''} ${myIdx === active ? 'active' : ''}`} disabled={it.disabled} onClick={() => { menu.value = null; it.onClick?.(); }}>
        <span class="icon">{Icon && <Icon size={15} />}{it.checked !== undefined && (it.checked ? '✓' : '')}</span><span class="ellipsis">{it.text}</span>{it.sc && <span class="sc">{it.sc}</span>}
      </button>;
    })}
  </div>;
}

// ---------- Dialogs ----------
export function showDialog(render, opts = {}) { return new Promise(resolve => { dialog.value = { render, resolve, ...opts }; }); }
export function closeDialog(value) { const d = dialog.value; dialog.value = null; d?.resolve?.(value); }
export function DialogHost() {
  const d = dialog.value;
  useEffect(() => {
    if (!d) return; const key = e => { if (e.key === 'Escape' && !d.locked) { e.stopPropagation(); closeDialog(null); } };
    document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true);
  }, [d]);
  if (!d) return null;
  return <div class="backdrop" onPointerDown={e => { if (e.target === e.currentTarget && !d.locked) closeDialog(null); }}>{d.render()}</div>;
}
export function Modal({ title, children, footer, size = '', onClose = () => closeDialog(null), icon }) {
  return <div class={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title}>
    <div class="modal-head">{icon}<h2>{title}</h2><button class="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
    <div class="modal-body">{children}</div>
    {footer && <div class="modal-foot">{footer}</div>}
  </div>;
}
export async function confirm({ title, text, ok = 'Continue', danger }) {
  return showDialog(() => <Modal title={title} footer={<><button class="btn ghost" onClick={() => closeDialog(false)}>Cancel</button><button class={`btn ${danger ? 'danger' : 'primary'}`} autoFocus onClick={() => closeDialog(true)}>{ok}</button></>}><p class="dim" style={{ margin: 0 }}>{text}</p></Modal>);
}
export async function prompt({ title, label, value = '', ok = 'Save' }) {
  let v = value;
  return showDialog(() => <Modal title={title} footer={<><button class="btn ghost" onClick={() => closeDialog(null)}>Cancel</button><button class="btn primary" onClick={() => closeDialog(v)}>{ok}</button></>}>
    <div class="field"><label>{label}</label><input class="input" autoFocus value={value} onInput={e => (v = e.target.value)} onKeyDown={e => e.key === 'Enter' && closeDialog(v)} /></div>
  </Modal>);
}

// ---------- Toasts ----------
export function ToastHost() {
  return <div class="toasts" role="status" aria-live="polite">{toasts.value.map(t => <div key={t.id} class={`toast ${t.kind}`}>
    <span>{t.text}</span>{t.action && <button class="btn sm" onClick={() => { dismissToast(t.id); t.action.onClick(); }}>{t.action.label}</button>}
    <button class="icon-btn sm" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><X size={14} /></button>
  </div>)}</div>;
}

// Local edit buffer that follows the source value without effects (no post-mount overwrite races).
export function useDraft(source) {
  const [draft, setDraft] = useState(source); const last = useRef(source);
  if (last.current !== source) { last.current = source; if (draft !== source) setDraft(source); }
  return [draft, setDraft];
}

// ---------- Controls ----------
// editScale: the typed number is value × editScale (e.g. 100 for percent, frame width for pixels).
export function Slider({ label, value, min, max, step = 0.01, onChange, onCommit, def, unit = '', fmt, disabled, editScale = 1 }) {
  const v = Number.isFinite(+value) ? +value : def ?? min;
  const show = fmt ? fmt(v) : (Math.abs(step) >= 1 ? Math.round(v) : +v.toFixed(2)) + unit;
  const [edit, setEdit] = useState(null);
  const pct = ((v - min) / (max - min)) * 100;
  return <div class="slider">
    <div class="slider-head"><span class="ellipsis">{label}</span><span class="row" style={{ gap: 2 }}>
      {def !== undefined && Math.abs(v - def) > 1e-6 && <button class="icon-btn sm reset" data-tip="Reset" onClick={() => (onCommit || onChange)(def)}><RotateCcw size={12} /></button>}
      <input class="val" value={edit ?? show} disabled={disabled} aria-label={label + ' value'} onFocus={e => { setEdit(String(+(v * editScale).toFixed(editScale > 1 ? 2 : 3))); setTimeout(() => e.target.select()); }} onInput={e => setEdit(e.target.value)}
        onBlur={() => { const n = parseFloat(edit); setEdit(null); if (Number.isFinite(n)) (onCommit || onChange)(Math.min(max, Math.max(min, n / editScale))); }} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setEdit(null); e.stopPropagation(); setTimeout(() => e.target.blur()); } }} />
    </span></div>
    <input type="range" min={min} max={max} step={step} value={v} disabled={disabled} style={{ '--fill': pct + '%' }} aria-label={label}
      onInput={e => onChange(+e.target.value)} onChange={e => onCommit?.(+e.target.value)} onDblClick={() => def !== undefined && (onCommit || onChange)(def)} />
  </div>;
}
export const Switch = ({ on, onChange, label }) => <button role="switch" aria-checked={!!on} aria-label={label} class={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
export const Toggle = ({ label, on, onChange, hint }) => <label class="check-row" data-tip={hint}><span>{label}</span><Switch on={on} onChange={onChange} label={label} /></label>;
export function Segmented({ value, options, onChange, label }) {
  return <div class="segmented" role="radiogroup" aria-label={label}>{options.map(o => { const [v, text, Icon, tipText] = Array.isArray(o) ? o : [o, o]; return <button key={v} role="radio" aria-checked={value === v} class={value === v ? 'on' : ''} data-tip={tipText} onClick={() => onChange(v)}>{Icon ? <Icon size={15} /> : text}</button>; })}</div>;
}
export function Select({ value, options, onChange, label }) {
  return <select class="select" aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{options.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{t}</option>; })}</select>;
}
const SWATCHES = ['#ffffff', '#000000', '#ffe14d', '#ff4d6d', '#ff8a3d', '#4cd99a', '#5aa9ff', '#a67cff', '#f5e6c4', '#b6f36a'];
export function Color({ value, onChange, label, swatches = true }) {
  return <div class="field"><label>{label}</label><div class="color"><input type="color" value={value} aria-label={label} onInput={e => onChange(e.target.value, true)} onChange={e => onChange(e.target.value)} />
    {swatches && <div class="swatches">{SWATCHES.map(s => <button key={s} class={`swatch ${s === value ? 'on' : ''}`} style={{ background: s }} aria-label={s} onClick={() => onChange(s)} />)}</div>}</div></div>;
}
export function Section({ title, children, open: initial = true, right }) {
  const [open, setOpen] = useState(initial);
  return <section class="insp-section"><header onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span class="grow">{title}</span>{right && <span onClick={e => e.stopPropagation()}>{right}</span>}</header>{open && <div class="insp-body">{children}</div>}</section>;
}
export const Empty = ({ icon: Icon, title, text, children }) => <div class="empty">{Icon && <div class="art"><Icon size={26} /></div>}<h3>{title}</h3>{text && <p>{text}</p>}{children}</div>;
export const Progress = ({ value, indeterminate }) => <div class={`progress ${indeterminate ? 'indeterminate' : ''}`}><div style={{ width: `${Math.round((value || 0) * 100)}%` }} /></div>;
export const Kbd = ({ children }) => <span class="kbd">{children}</span>;
