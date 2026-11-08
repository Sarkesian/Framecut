// Outbound HTTP for library providers: HTTPS only, public hosts only (no loopback/LAN), validated
// redirects, timeouts, bounded sizes and content-type checks. Nothing downloaded is executed.
const dns = require('node:dns/promises');
const net = require('node:net');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168|169\.254)\./i, /^::$/];
const isPrivate = ip => PRIVATE.some(r => r.test(ip));
const UA = 'FrameCutStudio/1.0 (local desktop video editor)';

class SafeHttp {
  constructor({ allowLocal = false, userAgent = UA } = {}) { this.allowLocal = allowLocal; this.ua = userAgent; }
  async check(u) {
    const url = new URL(u);
    if (this.allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return url;
    if (url.protocol !== 'https:') throw Object.assign(Error('Only secure (https) downloads are allowed.'), { code: 'unsafe' });
    if (url.username || url.password) throw Object.assign(Error('Unsafe address.'), { code: 'unsafe' });
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw Object.assign(Error('You appear to be offline.'), { code: 'offline' }); });
    if (!this.allowLocal && addrs.some(a => isPrivate(a.address))) throw Object.assign(Error('That address points to a private network.'), { code: 'unsafe' });
    return url;
  }
  async open(u, { method = 'GET', headers = {}, body, signal, timeout = 20000, accept } = {}) {
    let url = await this.check(u);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(Object.assign(Error('The server took too long to answer.'), { code: 'timeout' })), timeout);
    const onAbort = () => ctl.abort(signal.reason); signal?.addEventListener('abort', onAbort, { once: true });
    try {
      for (let hop = 0; hop < 6; hop++) {
        let res;
        try { res = await fetch(url, { method, headers: { 'User-Agent': this.ua, ...headers }, body, redirect: 'manual', signal: ctl.signal }); }
        catch (e) { if (ctl.signal.aborted) throw ctl.signal.reason?.code ? ctl.signal.reason : Object.assign(Error('Cancelled'), { cancelled: true }); throw Object.assign(Error('Could not reach the media service. Check your internet connection.'), { code: 'offline', cause: e }); }
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { res.body?.cancel().catch(() => {}); url = await this.check(new URL(res.headers.get('location'), url).href); method = 'GET'; body = undefined; continue; }
        if (!res.ok) { const text = await res.text().catch(() => ''); throw Object.assign(Error(`The media service answered ${res.status}.`), { status: res.status, retryAfter: res.headers.get('retry-after'), code: res.status === 404 || res.status === 410 ? 'gone' : res.status === 429 ? 'quota' : 'http', body: text.slice(0, 300) }); }
        const type = (res.headers.get('content-type') || '').split(';')[0].trim();
        if (accept && !accept.test(type)) { res.body?.cancel().catch(() => {}); throw Object.assign(Error(`Unexpected file type (${type || 'unknown'}).`), { code: 'type' }); }
        clearTimeout(timer); res.finalUrl = url.href; res.cleanup = () => signal?.removeEventListener('abort', onAbort); res.controller = ctl;
        return res;
      }
      throw Object.assign(Error('Too many redirects.'), { code: 'http' });
    } catch (e) { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); throw e; }
  }
  async json(u, opts = {}, { onHeaders } = {}) {
    const res = await this.open(u, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
    try { onHeaders?.(res.headers); const text = await readLimited(res, 4 * 1024 ** 2); return JSON.parse(text.toString('utf8')); }
    catch (e) { if (e instanceof SyntaxError) throw Object.assign(Error('The media service sent an unreadable answer.'), { code: 'http' }); throw e; }
    finally { res.cleanup(); }
  }
  // Streams to `file` (via a .part file), hashing as it goes. Throws when maxBytes is exceeded.
  async toFile(u, file, { accept, maxBytes = 200 * 1024 ** 2, signal, onProgress, timeout = 30000 } = {}) {
    const res = await this.open(u, { accept, signal, timeout });
    const declared = +res.headers.get('content-length') || 0;
    if (declared > maxBytes) { res.body?.cancel().catch(() => {}); res.cleanup(); throw Object.assign(Error('That file is too large to import.'), { code: 'size' }); }
    const part = file + '.part'; const hash = createHash('sha256'); let bytes = 0;
    const out = fs.createWriteStream(part);
    try {
      for await (const chunk of Readable.fromWeb(res.body)) {
        bytes += chunk.length; if (bytes > maxBytes) throw Object.assign(Error('That file is too large to import.'), { code: 'size' });
        hash.update(chunk); if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
        onProgress?.(declared ? bytes / declared : null, bytes);
      }
      await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
      if (!bytes) throw Object.assign(Error('The download was empty.'), { code: 'http' });
      await fsp.rename(part, file);
      return { bytes, sha256: hash.digest('hex'), contentType: (res.headers.get('content-type') || '').split(';')[0], finalUrl: res.finalUrl };
    } catch (e) { out.destroy(); await fsp.unlink(part).catch(() => {}); if (signal?.aborted) throw Object.assign(Error('Cancelled'), { cancelled: true }); throw e.code ? e : Object.assign(Error('The download was interrupted.'), { code: 'offline', cause: e }); }
    finally { res.cleanup(); }
  }
}
async function readLimited(res, max) {
  const parts = []; let n = 0;
  for await (const c of Readable.fromWeb(res.body)) { n += c.length; if (n > max) throw Object.assign(Error('Answer too large.'), { code: 'size' }); parts.push(c); }
  return Buffer.concat(parts);
}
module.exports = { SafeHttp, isPrivate };
