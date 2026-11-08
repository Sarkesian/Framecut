// One pointer-drag helper for every draggable thing in the editor (timeline, viewport, splitters, waveforms).
//
// Why it exists: handlers used to listen for pointermove/pointerup on the pressed element. When an ancestor
// also took pointer capture for the same press (the ruler's scrub and the timeline's marquee both did), the
// element never received its pointerup, its move listener stayed attached, and the playhead followed the
// cursor on plain hover. Here, moves and releases are tracked on the window for the pressed pointer id, so a
// drag always ends on release — whoever holds capture, wherever the pointer is, and even if the pressed
// element re-renders or unmounts mid-drag.
//
// Guarantees:
// - At most one drag at a time; the innermost handler for a press wins (later handlers of the same event are ignored).
// - Ends on pointerup, pointercancel, a move that arrives with no buttons held (release outside the window),
//   window blur, or Escape (which cancels).
// - `move` only starts after the pointer travels `threshold` px, so clicks never nudge things.

let active = null;

export const isDragging = () => !!active;
export const activeDrag = () => active;

// Ends the current drag, if any. reason: 'cancel' | 'end'.
export function stopDrag(reason = 'cancel') { active?.finish(null, reason); }

export function beginDrag(e, { move, end, cancel, threshold = 0, capture = e.currentTarget, cursor } = {}) {
  if (active && active.event === e) return null; // an inner handler already owns this press
  if (active) active.finish(null, 'cancel');
  const id = e.pointerId, x0 = e.clientX, y0 = e.clientY, mouse = e.pointerType === 'mouse' || !e.pointerType;
  let moved = threshold <= 0, last = e, done = false;
  // Capture only once it is really a drag: capturing on press retargets click/dblclick to the capturing element.
  const grab = () => { try { capture?.setPointerCapture?.(id); } catch {} };
  if (moved) grab();
  const info = ev => ({ dx: ev.clientX - x0, dy: ev.clientY - y0, moved, x0, y0, start: e });
  const onMove = ev => {
    if (ev.pointerId !== id) return;
    // A release outside the window may never arrive; a move without the button held proves it happened.
    if (mouse && (ev.buttons & 1) === 0) return finish(ev, 'end');
    last = ev;
    if (!moved) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < threshold) return; moved = true; grab(); }
    move?.(ev, info(ev));
  };
  const onUp = ev => { if (ev.pointerId === id) finish(ev, ev.type === 'pointercancel' ? 'cancel' : 'end'); };
  const onKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(null, 'cancel'); } };
  const onBlur = () => finish(null, 'end');
  const prevCursor = document.body.style.cursor;
  if (cursor) document.body.style.cursor = cursor;
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  function finish(ev, reason) {
    if (done) return; done = true;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    try { if (capture?.hasPointerCapture?.(id)) capture.releasePointerCapture(id); } catch {}
    if (cursor) document.body.style.cursor = prevCursor;
    if (active === ctl) active = null;
    const evt = ev || last;
    if (reason === 'cancel') (cancel || end)?.(evt, { ...info(evt), cancelled: true });
    else end?.(evt, info(evt));
  }
  const ctl = { event: e, pointerId: id, finish };
  active = ctl;
  return ctl;
}
