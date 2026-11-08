// Background job queue with progress, cancellation and per-lane concurrency.
const { randomUUID } = require('node:crypto');

class JobQueue {
  constructor({ lanes = { heavy: 1, light: 3, export: 1 } } = {}) {
    this.jobs = new Map(); this.lanes = lanes; this.running = {}; this.waiting = {};
    for (const k of Object.keys(lanes)) { this.running[k] = 0; this.waiting[k] = []; }
  }
  // fn(job) receives {signal, progress(p, message)} and returns a result.
  add({ type, label, lane = 'light', meta = {}, hidden = false }, fn) {
    const controller = new AbortController();
    const job = { id: randomUUID(), type, label, lane, meta, hidden, status: 'queued', progress: 0, message: '', error: null, result: null, created: Date.now(), controller };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    job.promise.catch(() => {});
    job.fn = fn; this.jobs.set(job.id, job); this.waiting[lane].push(job); this.pump(lane);
    return job;
  }
  pump(lane) {
    while (this.running[lane] < this.lanes[lane] && this.waiting[lane].length) {
      const job = this.waiting[lane].shift(); if (job.status === 'cancelled') continue;
      this.running[lane]++; job.status = 'running'; job.started = Date.now();
      const ctx = { signal: job.controller.signal, progress: (p, message) => { job.progress = Math.max(0, Math.min(1, p)); if (message) job.message = message; } };
      Promise.resolve().then(() => job.fn(ctx)).then(result => {
        if (job.status === 'cancelled') return job.reject(Error('Cancelled'));
        job.status = 'done'; job.progress = 1; job.result = result; job.resolve(result);
      }, err => {
        if (job.status !== 'cancelled') { job.status = err?.cancelled ? 'cancelled' : 'failed'; job.error = err?.message || String(err); }
        job.reject(err);
      }).finally(() => { job.finished = Date.now(); this.running[lane]--; this.pump(lane); this.prune(); });
    }
  }
  cancel(id) {
    const job = this.jobs.get(id); if (!job || !['queued', 'running'].includes(job.status)) return false;
    job.status = 'cancelled'; job.controller.abort(); if (!job.started) job.reject(Object.assign(Error('Cancelled'), { cancelled: true }));
    return true;
  }
  prune() { const cutoff = Date.now() - 30 * 60e3; for (const [id, j] of this.jobs) if (j.finished && j.finished < cutoff) this.jobs.delete(id); }
  view(job) { return job && { id: job.id, type: job.type, label: job.label, status: job.status, progress: job.progress, message: job.message, error: job.error, result: job.result, meta: job.meta, started: job.started, created: job.created }; }
  list() { return [...this.jobs.values()].filter(j => !j.hidden).map(j => this.view(j)); }
}
module.exports = { JobQueue };
