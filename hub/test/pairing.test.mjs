import test from 'node:test';
import assert from 'node:assert/strict';
import { testHub, pairClient, rec } from './helpers.mjs';
import { sha256 } from '../lib/util.js';

test('pairing: codes, single use, expiry, device re-pair, rate limit', async (t) => {
  const h = await testHub();
  t.after(h.close);

  const info = await h.api().get('/v1');
  assert.equal(info.status, 200);
  assert.equal(info.body.api, 1);
  assert.deepEqual(info.body.embedding.dims, [768, 512, 256, 128]);
  assert.equal(info.body.embedding.worker, false);
  assert.equal((await h.api().get('/v1/me')).status, 401);

  const p = await h.admin.post('/v1/pairings', { name: "Dimas's iPhone" });
  assert.equal(p.status, 201);
  assert.match(p.body.code, /^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(p.body.link, `fractonica://pair?hub=${encodeURIComponent('http://hub.test:8787')}&code=${p.body.code}`);

  // case-insensitive, ignores dashes and spaces
  const code = p.body.code.toLowerCase().replace('-', ' ');
  const r = await h.api().post('/v1/pair', { code, name: 'iPhone 17 Pro', kind: 'device', platform: 'iOS 26.1', device: 'DEV-1' });
  assert.equal(r.status, 201);
  assert.match(r.body.token, /^fxh_/);
  assert.deepEqual(r.body.client.scopes, ['read', 'write', 'search']);
  assert.deepEqual(r.body.client.kinds, ['*']);
  assert.equal(r.body.client.name, 'iPhone 17 Pro');
  assert.match(r.body.hub.id, /^h_/);
  // only the hash of the token is stored
  const row = h.hub.db.prepare('SELECT token_hash FROM clients WHERE id = ?').get(r.body.client.id);
  assert.equal(row.token_hash, sha256(r.body.token));
  assert.ok(!JSON.stringify(h.hub.db.prepare('SELECT * FROM clients').all()).includes(r.body.token));

  const me = await h.api(r.body.token).get('/v1/me');
  assert.equal(me.body.id, r.body.client.id);

  // single use
  assert.equal((await h.api().post('/v1/pair', { code: p.body.code })).status, 404);

  // the same device pairs again: same client, new token, old token dead
  const p2 = await h.admin.post('/v1/pairings', {});
  const r2 = await h.api().post('/v1/pair', { code: p2.body.code, name: 'iPhone 17 Pro', device: 'DEV-1' });
  assert.equal(r2.body.client.id, r.body.client.id);
  assert.equal((await h.api(r.body.token).get('/v1/me')).status, 401);
  assert.equal((await h.api(r2.body.token).get('/v1/me')).status, 200);

  // expiry
  const p3 = await h.admin.post('/v1/pairings', { ttl: 60 });
  h.clock.shift += 61;
  assert.equal((await h.api().post('/v1/pair', { code: p3.body.code })).status, 404);
  h.clock.shift -= 61;

  // more than 10 wrong codes a minute from one address
  for (let i = 0; i < 9; i++) assert.equal((await h.api().post('/v1/pair', { code: 'ZZZZ-ZZZZ' })).status, 404);
  assert.equal((await h.api().post('/v1/pair', { code: 'ZZZZ-ZZZZ' })).status, 429);
  const p4 = await h.admin.post('/v1/pairings', {});
  assert.equal((await h.api().post('/v1/pair', { code: p4.body.code })).status, 429, 'even a right code waits out the minute');
  h.clock.shift += 61;
  assert.equal((await h.api().post('/v1/pair', { code: p4.body.code })).status, 201);
});

test('clients: admin only, list with counts, rename, revoke', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const dev = await pairClient(h, { name: 'Mac' });
  assert.equal((await dev.get('/v1/clients')).status, 403);
  assert.equal((await dev.post('/v1/pairings', {})).status, 403);
  await dev.put('/v1/records/a', rec());
  await dev.put('/v1/records/b', rec());
  const list = await h.admin.get('/v1/clients');
  const mac = list.body.clients.find((c) => c.id === dev.client.id);
  assert.equal(mac.records, 2);
  assert.ok(mac.lastSeen > 0);
  const renamed = await h.admin.patch(`/v1/clients/${dev.client.id}`, { name: 'Studio Mac', scopes: ['read'] });
  assert.equal(renamed.body.name, 'Studio Mac');
  assert.deepEqual(renamed.body.scopes, ['read']);
  assert.equal((await dev.put('/v1/records/c', rec())).status, 403);
  assert.equal((await h.admin.patch(`/v1/clients/${dev.client.id}`, { scopes: ['root'] })).status, 400);
  assert.equal((await h.admin.del(`/v1/clients/${dev.client.id}`)).status, 200);
  assert.equal((await dev.get('/v1/me')).status, 401);
  assert.equal((await h.admin.get('/v1/records')).body.records.length, 2, 'records stay');
});

test('scopes and kinds: writes outside kinds are 403, reads leave them out', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const sensor = await pairClient(h, { name: 'Thermo', kind: 'service', scopes: ['write'], kinds: ['sensor.*'] });
  const reader = await pairClient(h, { name: 'Dash', scopes: ['read'], kinds: ['sensor.*'] });
  const t0 = 1791460800;
  const s = await sensor.put(`/v1/records/temp:studio:${t0}`, { kind: 'sensor.temperature', time: t0, created: t0, updated: t0, data: { celsius: 21.5, where: 'studio' } });
  assert.equal(s.status, 201);
  assert.equal(s.body.source, sensor.client.id);
  const j = await sensor.put('/v1/records/j1', rec());
  assert.equal(j.status, 403);
  assert.equal(j.body.error.code, 'forbidden');
  assert.equal((await sensor.get('/v1/records')).status, 403, 'no read scope');
  await h.admin.put('/v1/records/j2', rec());
  const seen = await reader.get('/v1/records');
  assert.deepEqual(seen.body.records.map((r) => r.kind), ['sensor.temperature']);
  assert.equal((await reader.get('/v1/records/j2')).status, 404);
  const ch = await reader.get('/v1/changes');
  assert.deepEqual(ch.body.changes.map((r) => r.id), [`temp:studio:${t0}`]);
  assert.equal((await reader.put('/v1/records/x', rec({ kind: 'sensor.temperature' }))).status, 403, 'no write scope');
  assert.equal((await reader.post('/v1/search', { query: 'x' })).status, 403, 'no search scope');
  const kinds = await h.admin.get('/v1/kinds');
  const k = kinds.body.kinds.find((x) => x.kind === 'sensor.temperature');
  assert.equal(k.count, 1);
  assert.deepEqual(k.sources, [{ id: sensor.client.id, name: 'Thermo', count: 1 }]);
});
