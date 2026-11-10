// Outbound HTTP for library providers: HTTPS only, public hosts only (no loopback/LAN), validated
// redirects, timeouts, bounded sizes and content-type checks. Nothing downloaded is executed.
const dns = require('node:dns/promises');
const net = require('node:net');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const https = require('node:https');
const { writeStreamedFile } = require('../streams.cjs');

// Some library hosts (ccMixter) take far longer than fetch's fixed 10 s to finish the TLS handshake.
// Requests to those hosts go through node:https with a longer handshake allowance and kept-alive
// sockets, so only the first request pays the cost. Same checks and redirect rules apply.
// (Also used for hosts whose answers exceed the default header size.)
const SLOW_TLS_HOSTS = new Set(['ccmixter.org']);
const slowAgent = new https.Agent({ keepAlive: true, maxSockets: 4, timeout: 45000 });
function slowFetch(url, { method = 'GET', headers = {}, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    // ccMixter search answers can carry headers larger than Node's 16 KB default.
    const req = https.request(url, { method, headers, agent: slowAgent, signal, timeout: 45000, maxHeaderSize: 256 * 1024 }, res => {
      const h = new Headers(); for (const [k, v] of Object.entries(res.headers)) if (v != null) h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      const empty = [204, 304].includes(res.statusCode) || method === 'HEAD';
      if (empty) res.resume();
      resolve(new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, headers: h }));
    });
    req.on('timeout', () => req.destroy(Object.assign(Error('The server took too long to answer.'), { code: 'timeout' })));
    req.on('error', reject);
    req.end(body == null ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : String(body));
  });
}

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168|169\.254)\./i, /^::$/];
const isPrivate = ip => PRIVATE.some(r => r.test(ip));
const UA = 'FrameCutStudio/1.0 (local desktop video editor)';

class SafeHttp {
  constructor({ allowLocal = false, userAgent = UA, slowHosts = SLOW_TLS_HOSTS } = {}) { this.allowLocal = allowLocal; this.ua = userAgent; this.slowHosts = slowHosts; }
  async check(u) {
    const url = new URL(u);
    if (this.allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return url;
    if (url.protocol !== 'https:') throw Object.assign(Error('Only secure (https) downloads are allowed.'), { code: 'unsafe' });
    if (url.username || url.password) throw Object.assign(Error('Unsafe address.'), { code: 'unsafe' });
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host === 'assetpolish.com' || host.endsWith('.assetpolish.com')) throw Object.assign(Error('AssetPolish has been removed from FrameCut’s online library.'), { code: 'unavailable' });
    if (['wikimedia.org', 'wikipedia.org'].some(base => host === base || host.endsWith('.' + base))) throw Object.assign(Error('Wikimedia has been removed from FrameCut’s online library.'), { code: 'unavailable' });
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw Object.assign(Error('You appear to be offline.'), { code: 'offline' }); });
    if (!this.allowLocal && addrs.some(a => isPrivate(a.address))) throw Object.assign(Error('That address points to a private network.'), { code: 'unsafe' });
    return url;
  }
  async open(u, { method = 'GET', headers = {}, body, signal, timeout = 20000, accept } = {}) {
    if (signal?.aborted) throw Object.assign(Error('Cancelled'), { cancelled: true });
    let url = await this.check(u);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(Object.assign(Error('The server took too long to answer.'), { code: 'timeout' })), timeout);
    const onAbort = () => ctl.abort(signal.reason); signal?.addEventListener('abort', onAbort, { once: true });
    try {
      for (let hop = 0; hop < 6; hop++) {
        let res;
        try { const go = this.slowHosts.has(url.hostname) ? slowFetch : fetch; res = await go(url, { method, headers: { 'User-Agent': this.ua, ...headers }, body, redirect: 'manual', signal: ctl.signal }); }
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
    try { onHeaders?.(res.headers); const text = await readLimited(res, 4 * 1024 ** 2, opts.timeout || 20000); return JSON.parse(text.toString('utf8')); }
    catch (e) { if (e instanceof SyntaxError) throw Object.assign(Error('The media service sent an unreadable answer.'), { code: 'http' }); throw e; }
    finally { res.cleanup(); }
  }
  // Streams to `file` (via a .part file), hashing as it goes. Throws when maxBytes is exceeded.
  async toFile(u, file, { accept, headers, maxBytes = 200 * 1024 ** 2, signal, onProgress, timeout = 30000 } = {}) {
    const res = await this.open(u, { accept, headers, signal, timeout });
    const declared = +res.headers.get('content-length') || 0;
    if (declared > maxBytes) { res.body?.cancel().catch(() => {}); res.cleanup(); throw Object.assign(Error('That file is too large to import.'), { code: 'size' }); }
    const part = file + '.part'; const hash = createHash('sha256'), sha1 = createHash('sha1'); let bytes = 0;
    const watch = stallWatch(res, timeout);
    try {
      await writeStreamedFile(Readable.fromWeb(res.body), part, { signal: res.controller.signal, maxBytes, onChunk(chunk, count) {
        watch.kick(); bytes = count; hash.update(chunk); sha1.update(chunk);
        onProgress?.(declared ? bytes / declared : null, bytes);
      } });
      if (!bytes) throw Object.assign(Error('The download was empty.'), { code: 'http' });
      await fsp.rename(part, file);
      return { bytes, sha256: hash.digest('hex'), sha1: sha1.digest('hex'), contentType: (res.headers.get('content-type') || '').split(';')[0], finalUrl: res.finalUrl };
    } catch (e) { await fsp.unlink(part).catch(() => {}); if (watch.stalled) throw watch.error(); if (signal?.aborted) throw Object.assign(Error('Cancelled'), { cancelled: true }); throw e.code ? e : Object.assign(Error('The download was interrupted.'), { code: 'offline', cause: e }); }
    finally { watch.stop(); res.cleanup(); }
  }
}
// The request timeout covers only the wait for headers. While the body streams, a server that stops
// sending (dropped connection, stalled CDN) would otherwise hang the download or search forever:
// abort when no data has arrived for `ms`.
function stallWatch(res, ms) {
  let timer = null;
  const w = {
    stalled: false,
    error: () => Object.assign(Error('The download stalled. Check your internet connection and try again.'), { code: 'timeout' }),
    kick() { clearTimeout(timer); timer = setTimeout(() => { w.stalled = true; res.controller?.abort(w.error()); }, ms); },
    stop() { clearTimeout(timer); },
  };
  w.kick(); return w;
}
async function readLimited(res, max, idleMs = 20000) {
  const parts = []; let n = 0; const watch = stallWatch(res, idleMs);
  try { for await (const c of Readable.fromWeb(res.body)) { watch.kick(); n += c.length; if (n > max) throw Object.assign(Error('Answer too large.'), { code: 'size' }); parts.push(c); } }
  catch (e) { if (watch.stalled) throw watch.error(); throw e; }
  finally { watch.stop(); }
  return Buffer.concat(parts);
}
module.exports = { SafeHttp, isPrivate };
