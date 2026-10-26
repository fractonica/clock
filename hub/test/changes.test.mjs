import test from 'node:test';
import assert from 'node:assert/strict';
import { testHub, rec, sleep } from './helpers.mjs';

test('changes: paging by rev, tombstones, kinds, cursor past filtered changes', async (t) => {
  const h = await testHub();
  t.after(h.close);
  for (let i = 0; i < 5; i++) await h.admin.put(`/v1/records/c${i}`, rec());
  await h.admin.put('/v1/records/s1', { kind: 'sensor.temperature', time: 1, created: 1, updated: 1, data: { celsius: 1 } });
  await h.admin.del('/v1/records/c1');

  const p1 = await h.admin.get('/v1/changes?after=0&limit=3');
  assert.deepEqual(p1.body.changes.map((r) => r.id), ['c0', 'c2', 'c3'], 'a record appears once, at its latest change');
  assert.equal(p1.body.more, true);
  const p2 = await h.admin.get(`/v1/changes?after=${p1.body.cursor}&limit=2`);
  assert.deepEqual(p2.body.changes.map((r) => r.id), ['c4', 's1']);
  assert.equal(p2.body.more, true);
  const p3 = await h.admin.get(`/v1/changes?after=${p2.body.cursor}&limit=3`);
  assert.deepEqual(p3.body.changes.map((r) => [r.id, r.deleted]), [['c1', true]], 'the tombstone is in the feed');
  assert.equal(p3.body.more, false);
  const revs = [...p1.body.changes, ...p2.body.changes, ...p3.body.changes].map((r) => r.rev);
  assert.deepEqual(revs, [...revs].sort((a, b) => a - b));

  const sensors = await h.admin.get('/v1/changes?kind=sensor.*');
  assert.deepEqual(sensors.body.changes.map((r) => r.id), ['s1']);
  assert.equal(sensors.body.cursor, p3.body.cursor, 'the cursor covers changes the filter left out');
  const none = await h.admin.get(`/v1/changes?after=${p3.body.cursor}`);
  assert.deepEqual(none.body, { changes: [], cursor: p3.body.cursor, more: false });
});

test('changes: wait holds the request until something changes', async (t) => {
  const h = await testHub();
  t.after(h.close);
  await h.admin.put('/v1/records/w0', rec());
  const { cursor } = (await h.admin.get('/v1/changes')).body;

  const t0 = Date.now();
  const pending = h.admin.get(`/v1/changes?after=${cursor}&wait=10`);
  await sleep(200);
  await h.admin.put('/v1/records/w1', rec());
  const r = await pending;
  assert.deepEqual(r.body.changes.map((x) => x.id), ['w1']);
  assert.ok(Date.now() - t0 < 5000);

  const t1 = Date.now();
  const empty = await h.admin.get(`/v1/changes?after=${r.body.cursor}&wait=1`);
  assert.deepEqual(empty.body.changes, []);
  assert.ok(Date.now() - t1 >= 900, 'held for the wait time');
});

test('events: SSE change and worker events', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const ac = new AbortController();
  const res = await fetch(`${h.url}/v1/events?token=${encodeURIComponent(h.admin.token)}`, { signal: ac.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  let text = '';
  const readUntil = async (re) => {
    while (!re.test(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString();
    }
  };
  await readUntil(/event: worker\ndata: \{"connected":false\}/);
  await h.admin.put('/v1/records/e1', rec());
  await readUntil(/event: change\ndata: \{"rev":\d+,"id":"e1","kind":"journal.entry","deleted":false\}/);
  ac.abort();
});
