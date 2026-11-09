// Leaving safely: before the window closes (or the editor goes back to Projects) flush the autosave and,
// only if something would actually be lost, ask first — a failed save, a take being recorded, or
// background work (export, captions, downloads…) that quitting would cancel.
import { TriangleAlert } from 'lucide-preact';
import { project, saveState, saveNow, jobs, dialog, toast, closeProject } from '../lib/state.js';
import { showDialog, closeDialog, Modal } from './kit.jsx';
import { isRecording, closeStudio } from './Studio.jsx';

export async function pendingWork({ quitting = true } = {}) {
  const issues = [];
  if (project.value && saveState.value !== 'saved') {
    await saveNow();
    if (saveState.value !== 'saved') issues.push({ key: 'save', text: 'Your latest changes could not be saved.' });
  }
  if (quitting && isRecording()) issues.push({ key: 'rec', text: 'A voiceover is being recorded. Stop it first to keep the take.' });
  if (quitting) {
    const active = jobs.value.filter(j => ['queued', 'running'].includes(j.status));
    // Proxies and processed-audio caches simply rebuild next time, so they are not worth a prompt.
    const exp = active.filter(j => j.type === 'export'), other = active.filter(j => !['export', 'proxy', 'audiofx'].includes(j.type));
    if (exp.length) issues.push({ key: 'export', text: exp.length > 1 ? `${exp.length} exports are still running and will be cancelled.` : 'An export is still running and will be cancelled.' });
    if (other.length) issues.push({ key: 'jobs', text: other.length > 1 ? `${other.length} background tasks will be cancelled (${other[0].label.toLowerCase()}, …).` : `“${other[0].label}” will be cancelled.` });
  }
  return issues;
}

function ask(issues, { title, ok }) {
  const canRetry = issues.some(i => i.key === 'save');
  return showDialog(() => <Modal title={title} icon={<TriangleAlert size={20} class="warn-icon" />} onClose={() => closeDialog(false)}
    footer={<>
      {canRetry && <button class="btn ghost" onClick={async () => { await saveNow(); if (saveState.value === 'saved' && issues.length === 1) closeDialog(true); }}>Try saving again</button>}
      <div class="grow" />
      <button class="btn" autoFocus onClick={() => closeDialog(false)}>Keep working</button>
      <button class="btn danger" onClick={() => closeDialog(true)}>{ok}</button>
    </>}>
    <ul class="exit-issues">{issues.map(i => <li key={i.key}>{i.text}</li>)}</ul>
  </Modal>).then(v => v === true);
}

let open = null;
// Called by the desktop shell when the window is about to close; resolves true to let it close.
export function canQuit() {
  if (open) return open;
  open = (async () => {
    const issues = await pendingWork();
    if (!issues.length) return true;
    if (dialog.value) closeDialog(null);
    return ask(issues, { title: 'Quit FrameCut?', ok: 'Quit anyway' });
  })().finally(() => { open = null; });
  return open;
}
// Going back to Projects: background work keeps running, so only an unsaved project or a live take matter.
export async function canSwitchProject() {
  if (isRecording()) { toast('Stop recording first.', 'warn'); return false; }
  const issues = await pendingWork({ quitting: false });
  if (issues.length && !(await ask(issues, { title: 'Leave this project?', ok: 'Leave anyway' }))) return false;
  closeStudio(); return true;
}
export async function leaveProject() { if (await canSwitchProject()) await closeProject(); }

export function installExitGuard() {
  window.__framecutCanClose = canQuit;
  // In a plain browser tab (dev mode) fall back to the browser's own prompt.
  if (!window.framecut?.native) window.addEventListener('beforeunload', e => {
    const p = saveState.value !== 'saved' && project.value, busy = isRecording() || jobs.value.some(j => j.type === 'export' && ['queued', 'running'].includes(j.status));
    if (p) saveNow();
    if (p || busy) { e.preventDefault(); e.returnValue = ''; }
  });
}
