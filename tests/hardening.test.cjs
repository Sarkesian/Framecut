const test = require('node:test');
const assert = require('node:assert/strict');
const { JobQueue } = require('../desktop/jobs.cjs');
const { sameOrigin } = require('../desktop/security.cjs');

test('desktop permission origins reject prefix lookalikes and malformed URLs', () => {
  const base = 'http://127.0.0.1:1234';
  assert.equal(sameOrigin(base + '/editor?x=1', base), true);
  for (const url of [base + '5/', base + '.example.org/', 'https://127.0.0.1:1234/', 'http://127.0.0.1:1234@evil.example/', 'null', '', undefined]) {
    assert.equal(sameOrigin(url, base), false, String(url));
  }
});

test('cancelled queued jobs release closures immediately and expire from history', async () => {
  const q = new JobQueue({ lanes: { light: 1 } });
  let release, ran = false;
  const active = q.add({ type: 'test' }, () => new Promise(r => { release = r; }));
  await Promise.resolve();
  const queued = q.add({ type: 'test' }, () => { ran = true; });
  assert.equal(q.cancel(queued.id), true);
  await assert.rejects(queued.promise, e => e.cancelled === true);
  assert.equal(q.waiting.light.length, 0);
  assert.ok(queued.finished);
  queued.finished = Date.now() - 31 * 60e3;
  q.prune(); assert.equal(q.jobs.has(queued.id), false);
  release('ok'); await active.promise;
  assert.equal(ran, false);
});

test('running cancellation remains identifiable even if the worker completes', async () => {
  const q = new JobQueue(); let release;
  const job = q.add({ type: 'test' }, () => new Promise(r => { release = r; }));
  await Promise.resolve(); q.cancel(job.id); release('too late');
  await assert.rejects(job.promise, e => e.cancelled === true);
  assert.equal(job.status, 'cancelled');
  assert.throws(() => q.add({ lane: 'missing' }, () => {}), /Unknown job lane/);
});
