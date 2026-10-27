import test from 'node:test';
import assert from 'node:assert/strict';
import { testHub, pairClient, rec, sha } from './helpers.mjs';
import { contentHash, normalizeRecord } from '../lib/records.js';

test('PUT: create, idempotent retry, 409 on older, newer wins', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const a = await pairClient(h, { name: 'iPhone' });
  const body = rec({ time: 1791460800.25, updated: 100, created: 100, zone: 'Europe/Kyiv', tags: ['walk'] });
  const r1 = await a.put('/v1/records/0b6c1d0e', body);
  assert.equal(r1.status, 201);
  assert.equal(r1.body.source, a.client.id);
  assert.equal(r1.body.editor, a.client.id);
  assert.equal(r1.body.deleted, false);
  assert.equal(r1.body.end, null);
  assert.deepEqual(r1.body.blobs, []);
  assert.ok(r1.body.rev > 0);
  assert.match(r1.body.fx.stamp, /^α#\d+ β#\d+ γ#\d+ δ#\d+ ε#\d+ \d+η \d+ι$/);
  assert.match(r1.body.fx.clock, /^\d+η \d+ι \d+λ$/);
  // the Pentad the moment falls in (SPEC §7.5): vector A is in Pentad II, its 2nd Helion
  assert.deepEqual(r1.body.fx.pentad, { index: 1, name: 'Pentad II', short: '\u2B20II', helion: 2 });

  const again = await a.put('/v1/records/0b6c1d0e', { ...body, source: 'c_fake', rev: 5, unknown: 1 });
  assert.equal(again.status, 200);
  assert.equal(again.body.rev, r1.body.rev, 'an identical retry changes nothing');
  assert.equal(again.body.source, a.client.id, 'source is set by the hub');

  const older = await a.put('/v1/records/0b6c1d0e', { ...body, updated: 99, data: { markdown: 'old' } });
  assert.equal(older.status, 409);
  assert.equal(older.body.error.code, 'conflict');
  assert.equal(older.body.error.details.current.data.markdown, 'Saw the moon rise');

  const newer = await a.put('/v1/records/0b6c1d0e', { ...body, updated: 101, data: { markdown: 'new' } });
  assert.equal(newer.status, 200);
  assert.ok(newer.body.rev > r1.body.rev);
  assert.equal((await a.get('/v1/records/0b6c1d0e')).body.data.markdown, 'new');

  // validation
  assert.equal((await a.put('/v1/records/bad id', body)).status, 400);
  assert.equal((await a.put('/v1/records/x', { ...body, kind: 'Journal' })).status, 400);
  assert.equal((await a.put('/v1/records/x', { ...body, time: 'now' })).status, 400);
  assert.equal((await a.put('/v1/records/x', { ...body, data: { s: 'x'.repeat(1024 * 1024 + 1) } })).status, 413);
});

test('PUT: ties of updated go to the greater SHA-256 of the canonical JSON', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const id = 'tie';
  const A = rec({ updated: 500, created: 500, data: { markdown: 'version A' } });
  const B = rec({ ...A, data: { markdown: 'version B' } });
  const hA = contentHash(normalizeRecord(id, A));
  const hB = contentHash(normalizeRecord(id, B));
  const [lo, hi] = hA < hB ? [A, B] : [B, A];
  assert.equal((await h.admin.put(`/v1/records/${id}`, lo)).status, 201);
  const up = await h.admin.put(`/v1/records/${id}`, hi);
  assert.equal(up.status, 200, 'the greater hash replaces the smaller');
  assert.equal(up.body.data.markdown, hi.data.markdown);
  const down = await h.admin.put(`/v1/records/${id}`, lo);
  assert.equal(down.status, 409, 'the smaller hash loses');
  assert.equal(down.body.error.details.current.data.markdown, hi.data.markdown);

  // the canonical form ignores key order and defaults absent fields
  const x = { kind: 'a.b', time: 1, created: 1, updated: 1, data: { b: 1, a: [1, { d: 2, c: 3 }] } };
  const y = { updated: 1, created: 1, time: 1, kind: 'a.b', data: { a: [1, { c: 3, d: 2 }], b: 1 }, end: null, tags: [], blobs: [], deleted: false };
  assert.equal(contentHash(normalizeRecord('k', x)), contentHash(normalizeRecord('k', y)));
  assert.equal(
    contentHash(normalizeRecord('k', x)),
    sha('{"blobs":[],"created":1,"data":{"a":[1,{"c":3,"d":2}],"b":1},"deleted":false,"end":null,"id":"k","kind":"a.b","tags":[],"text":null,"time":1,"updated":1,"zone":null}'),
  );
});

test('ownership: only the source edits, except journal.* which any writer may correct', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const phone = await pairClient(h, { name: 'iPhone' });
  const mac = await pairClient(h, { name: 'Mac' });
  await phone.put('/v1/records/e1', rec({ updated: 1, created: 1 }));
  await phone.put('/v1/records/s1', { kind: 'sensor.temperature', time: 1, created: 1, updated: 1, data: { celsius: 20 } });
  const edit = await mac.put('/v1/records/e1', rec({ updated: 2, created: 1, data: { markdown: 'fixed on the Mac' } }));
  assert.equal(edit.status, 200);
  assert.equal(edit.body.source, phone.client.id);
  assert.equal(edit.body.editor, mac.client.id);
  assert.equal((await mac.put('/v1/records/s1', { kind: 'sensor.temperature', time: 1, created: 1, updated: 2, data: { celsius: 0 } })).status, 403);
  assert.equal((await mac.del('/v1/records/s1')).status, 403);
  assert.equal((await h.admin.put('/v1/records/s1', { kind: 'sensor.temperature', time: 1, created: 1, updated: 3, data: { celsius: 1 } })).status, 200, 'admin may');
});

test('batch: each item decided as its own PUT', async (t) => {
  const h = await testHub();
  t.after(h.close);
  await h.admin.put('/v1/records/b2', rec({ updated: 10, created: 10 }));
  const r = await h.admin.post('/v1/records/batch', {
    records: [
      { id: 'b1', ...rec() },
      { id: 'b2', ...rec({ updated: 5, created: 5 }) },
      { id: 'b3', ...rec({ blobs: [{ hash: 'a'.repeat(64), type: 'image/jpeg', size: 3, role: 'photo' }] }) },
      { id: 'bad id!', ...rec() },
    ],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.map((x) => x.status), [201, 409, 422, 400]);
  assert.equal(r.body.results[0].record.id, 'b1');
  assert.equal(r.body.results[1].error.code, 'conflict');
  assert.equal(r.body.results[1].error.details.current.updated, 10);
  assert.deepEqual(r.body.results[2].error.details.missing, ['a'.repeat(64)]);
  assert.equal((await h.admin.post('/v1/records/batch', { records: Array.from({ length: 501 }, () => rec()) })).status, 400);
});

test('422: a record naming missing blobs', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const bytes = Buffer.from('photo bytes');
  const hash = sha(bytes);
  const missing = 'b'.repeat(64);
  const body = rec({
    blobs: [
      { hash, type: 'image/jpeg', size: bytes.length, role: 'photo' },
      { hash: missing, type: 'audio/mp4', size: 9, role: 'audio' },
    ],
  });
  await h.admin.put(`/v1/blobs/${hash}`, bytes, { 'Content-Type': 'image/jpeg' });
  const r = await h.admin.put('/v1/records/m1', body);
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, 'unprocessable');
  assert.deepEqual(r.body.error.details.missing, [missing]);
  assert.equal((await h.admin.get('/v1/records/m1')).status, 404);
});

test('DELETE writes a tombstone: not listed, in the change feed', async (t) => {
  const h = await testHub();
  t.after(h.close);
  await h.admin.put('/v1/records/d1', rec({ tags: ['x'] }));
  const d = await h.admin.del('/v1/records/d1');
  assert.equal(d.status, 200);
  assert.equal(d.body.deleted, true);
  assert.deepEqual(d.body.data, {});
  assert.deepEqual(d.body.blobs, []);
  assert.equal((await h.admin.get('/v1/records')).body.records.length, 0);
  assert.equal((await h.admin.get('/v1/records/d1')).body.deleted, true);
  const ch = await h.admin.get('/v1/changes');
  assert.equal(ch.body.changes.at(-1).deleted, true);
  assert.equal((await h.admin.del('/v1/records/nope')).status, 404);
});

test('list: newest first, filters, paging, keyword q', async (t) => {
  const h = await testHub();
  t.after(h.close);
  for (let i = 0; i < 7; i++) await h.admin.put(`/v1/records/l${i}`, rec({ time: 1000 + i, tags: i % 2 ? ['odd'] : [], data: { markdown: i === 3 ? 'Crème brûlée at the CAFÉ' : 'plain' } }));
  await h.admin.put('/v1/records/s', { kind: 'sensor.temperature', time: 2000, created: 1, updated: 1, data: { celsius: 3 } });
  const all = await h.admin.get('/v1/records?limit=3');
  assert.deepEqual(all.body.records.map((r) => r.id), ['s', 'l6', 'l5']);
  assert.equal(all.body.more, true);
  const p2 = await h.admin.get(`/v1/records?limit=3&cursor=${all.body.cursor}`);
  assert.deepEqual(p2.body.records.map((r) => r.id), ['l4', 'l3', 'l2']);
  assert.deepEqual((await h.admin.get('/v1/records?kind=journal.*&limit=1')).body.records.map((r) => r.id), ['l6']);
  assert.deepEqual((await h.admin.get('/v1/records?kind=sensor.temperature')).body.records.map((r) => r.id), ['s']);
  assert.deepEqual((await h.admin.get('/v1/records?tag=odd')).body.records.map((r) => r.id), ['l5', 'l3', 'l1']);
  assert.deepEqual((await h.admin.get('/v1/records?since=1002&until=1004')).body.records.map((r) => r.id), ['l4', 'l3', 'l2']);
  assert.deepEqual((await h.admin.get('/v1/records?q=cafe%20creme')).body.records.map((r) => r.id), ['l3']);
  assert.equal((await h.admin.get(`/v1/records?source=${h.adminClient.id}`)).body.records.length, 8);
  assert.equal((await h.admin.get('/v1/records?source=c_nobody')).body.records.length, 0);
});

test('fx: the Pentad leads the reading; records stored before it gain it when the hub opens', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openHub } = await import('../lib/hub.js');
  const { fxOf, FX_VERSION } = await import('../lib/fx.js');
  // outside the catalogue (1613 … 2857) nothing is said
  assert.deepEqual(fxOf(-12e9), { stamp: null, clock: null, pentad: null });
  assert.deepEqual(fxOf(NaN), { stamp: null, clock: null, pentad: null });
  // the Hypopentad's short form is its square alone
  const hypo = fxOf(1791460800 + 10.5 * 18187.6).pentad; // vector A is in the 2nd Helion of Pentad II
  assert.deepEqual([hypo.index, hypo.name, hypo.short], [3, 'Hypopentad', '\u25FB']);

  const dir = mkdtempSync(join(tmpdir(), 'fx-hub-'));
  try {
    let hub = openHub(dir);
    const { client } = hub.createClient({ name: 'Admin', kind: 'browser', scopes: ['read', 'write', 'admin'] });
    hub.putRecord(client, 'old', rec({ time: 1791460800.25 }));
    // as a hub before Pentads stored it
    hub.db.prepare('UPDATE records SET fx = ?').run(JSON.stringify({ stamp: 'α#6', clock: '34η' }));
    hub.setMeta('fx_version', null);
    const rev = hub.getRecord(client, 'old').rev;
    hub.close();
    hub = openHub(dir);
    const r = hub.getRecord(client, 'old');
    assert.deepEqual(r.fx.pentad, { index: 1, name: 'Pentad II', short: '⬠II', helion: 2 });
    assert.match(r.fx.stamp, /^α#6 β#4 γ#9 δ#3 ε#5 34η \d+ι$/, 'the whole fx is recomputed');
    assert.equal(r.rev, rev, 'a derived field is not a change');
    assert.equal(Number(hub.getMeta('fx_version')), FX_VERSION);
    hub.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
