// Server and native-shell helpers.
export async function api(url, body, method = body !== undefined ? 'POST' : 'GET') {
  const r = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(Error(data?.error || `Request failed (${r.status})`), { code: data?.code || null, retryAfter: data?.retryAfter || null, status: r.status });
  return data;
}
export const native = typeof window !== 'undefined' && window.framecut?.native ? window.framecut : null;

// Wait for a background job; onProgress(progress, message). Resolves with the result.
export async function waitJob(id, onProgress, signal) {
  for (;;) {
    if (signal?.aborted) { await api('/api/jobs/' + id, undefined, 'DELETE').catch(() => {}); throw Object.assign(Error('Cancelled'), { cancelled: true }); }
    const j = await api('/api/jobs/' + id);
    onProgress?.(j.progress, j.message, j);
    if (j.status === 'done') return j.result;
    if (j.status === 'failed') throw Error(j.error || 'The task failed.');
    if (j.status === 'cancelled') throw Object.assign(Error('Cancelled'), { cancelled: true });
    await new Promise(r => setTimeout(r, 300));
  }
}

// Import local files: native paths when available (no copying), uploads otherwise.
export async function importFiles(files) {
  const paths = [], uploads = [];
  for (const f of files) { const p = native?.pathForFile?.(f); if (p) paths.push(p); else uploads.push(f); }
  const res = { assets: [], errors: [] };
  if (paths.length) { const r = await api('/api/media/import', { paths }); res.assets.push(...r.assets); res.errors.push(...r.errors); }
  if (uploads.length) {
    const form = new FormData(); for (const f of uploads) form.append('files', f);
    const r = await fetch('/api/media/upload', { method: 'POST', body: form }); const d = await r.json(); if (!r.ok) throw Error(d.error);
    res.assets.push(...d.assets); res.errors.push(...d.errors);
  }
  return res;
}
export async function importPaths(paths) { return api('/api/media/import', { paths }); }
export async function pickMedia() {
  if (native) { const paths = await native.openMedia(); return paths?.length ? importPaths(paths) : null; }
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = 'video/*,audio/*,image/*,.mkv,.mov,.avi,.flv,.wmv';
    input.onchange = () => resolve(input.files.length ? importFiles([...input.files]) : null); input.click();
  });
}
export async function pickFile({ title, extensions, accept }) {
  if (native) { const p = await native.openFiles({ title, filters: [{ name: title, extensions }] }); return p?.[0] ? { path: p[0] } : null; }
  return new Promise(resolve => { const input = document.createElement('input'); input.type = 'file'; input.accept = accept || extensions.map(e => '.' + e).join(','); input.onchange = () => resolve(input.files[0] ? { file: input.files[0] } : null); input.click(); });
}
