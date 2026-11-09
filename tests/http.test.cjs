// Library downloads must fail cleanly (not hang) when a server stops sending mid-response.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { SafeHttp } = require('../desktop/providers/http.cjs');

function stallingServer() {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': req.url.startsWith('/json') ? 'application/json' : 'audio/mpeg', 'Content-Length': '100000' });
    res.write(req.url.startsWith('/json') ? '{"results": [' : Buffer.alloc(1000)); // then nothing more
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, close: () => { for (const s of sockets) s.destroy(); server.close(); } })));
}

test('a download that stalls mid-body times out and leaves no partial file', async () => {
  const srv = await stallingServer(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'framecut-http-'));
  try {
    const started = Date.now();
    await assert.rejects(new SafeHttp({ allowLocal: true }).toFile(srv.url + '/file.mp3', path.join(dir, 'a.mp3'), { timeout: 600 }), e => e.code === 'timeout');
    assert.ok(Date.now() - started < 5000, 'gave up promptly');
    assert.deepEqual(fs.readdirSync(dir), [], 'no .part file left');
  } finally { srv.close(); }
});

test('a search answer that stalls mid-body times out instead of hanging', async () => {
  const srv = await stallingServer();
  try { await assert.rejects(new SafeHttp({ allowLocal: true }).json(srv.url + '/json', { timeout: 600 }), e => e.code === 'timeout'); }
  finally { srv.close(); }
});
