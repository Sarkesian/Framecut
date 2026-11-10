// Small, persistent provider metadata caches. Audio is downloaded only on selection.
const { readJsonSync, writeJson } = require('../jsonstore.cjs');
class MetadataCache {
  constructor(file, { maxEntries = 160, maxBytes = 8 * 1024 ** 2 } = {}) {
    this.file = file; this.maxEntries = maxEntries; this.maxBytes = maxBytes;
    const { value } = file ? readJsonSync(file, null) : {};
    this.entries = new Map(Array.isArray(value?.entries) ? value.entries.filter(([k, v]) => typeof k === 'string' && v && Number.isFinite(v.at)) : []);
    this.inflight = new Map(); this.failures = new Map();
  }
  async get(key, load, { ttl = 24 * 3600e3, stale = false } = {}) {
    const old = this.entries.get(key), now = Date.now();
    if (old && now - old.at < ttl) return old.value;
    const failure = this.failures.get(key);
    if (failure && failure.until > now) { if (stale && old) return old.value; throw failure.error; }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const pending = (async () => {
      try { const value = await Promise.resolve().then(load); this.set(key, value); this.failures.delete(key); return value; }
      catch (error) { this.failures.set(key, { until: Date.now() + Math.max(60000, (+error.retryAfter || 0) * 1000), error }); if (stale && old) return old.value; throw error; }
      finally { this.inflight.delete(key); }
    })();
    this.inflight.set(key, pending); return pending;
  }
  set(key, value) {
    this.entries.delete(key); this.entries.set(key, { at: Date.now(), value });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    while (this.entries.size && Buffer.byteLength(JSON.stringify([...this.entries])) > this.maxBytes) this.entries.delete(this.entries.keys().next().value);
    clearTimeout(this.timer); if (this.file) this.timer = setTimeout(() => this.flush().catch(() => {}), 300);
  }
  async flush() { clearTimeout(this.timer); if (this.file) await writeJson(this.file, { entries: [...this.entries] }); }
}
module.exports = { MetadataCache };
