import test from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApnsClient, keyIdFromFile, providerToken } from '../lib/apns.js';
import { Dispatcher, readSchedule } from '../lib/dispatcher.js';
import { Hub } from '../lib/hub.js';
import { fromNow, parseWhen } from '../lib/when.js';
import { startHub } from '../../hub/lib/server.js';

const TOKEN = 'a'.repeat(64);
const DEV_TOKEN = 'b'.repeat(64);

/** A stand-in for APNs: plain HTTP/2, answering 200 unless `answer` says otherwise; keeps every request. */
async function fakeApns(answer = () => ({ status: 200 })) {
  const requests = [];
  const server = http2.createServer();
  server.on('stream', (stream, headers) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => (body += d));
    stream.on('end', () => {
      const req = { headers, path: headers[':path'], body: JSON.parse(body), at: Date.now() / 1000 };
      requests.push(req);
      const a = answer(req);
      stream.respond({ ':status': a.status, 'apns-id': 'id-1' });
      stream.end(a.status === 200 ? '' : JSON.stringify({ reason: a.reason }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

const key = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

test('the provider token is an ES256 JWT of the team, signed with the key', () => {
  const { privateKey, publicKey } = key();
  const jwt = providerToken({ key: privateKey, keyId: 'ABC123DEFG', teamId: 'G23G724G3D', iat: 1794000000.7 });
  const [h, c, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'ABC123DEFG' });
  assert.deepEqual(JSON.parse(Buffer.from(c, 'base64url')), { iss: 'G23G724G3D', iat: 1794000000 });
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  assert.equal(keyIdFromFile('/x/AuthKey_ABC123DEFG.p8'), 'ABC123DEFG');
  assert.equal(keyIdFromFile('/x/key.p8'), null);
});

test('APNs: a VoIP push, the other environment for a token of it, a fresh provider token when one expired', async (t) => {
  let expire = 1;
  const prod = await fakeApns((r) => {
    if (r.path.endsWith(DEV_TOKEN)) return { status: 400, reason: 'BadDeviceToken' };
    if (expire-- > 0) return { status: 403, reason: 'ExpiredProviderToken' };
    return { status: 200 };
  });
  const dev = await fakeApns();
  t.after(() => Promise.all([prod.close(), dev.close()]));
  const { privateKey, publicKey } = key();
  const apns = new ApnsClient({ key: privateKey, keyId: 'ABC123DEFG', teamId: 'G23G724G3D', hosts: { production: prod.url, development: dev.url } });
  t.after(() => apns.close());

  const r = await apns.send({ deviceToken: TOKEN, topic: 'app.fractonica.clock.voip', payload: { aps: {}, fx: { id: 'm1' } }, expiration: 1794000086.4 });
  assert.equal(r.ok, true);
  assert.equal(r.environment, 'production');
  assert.equal(prod.requests.length, 2, 'sent again after ExpiredProviderToken');
  const h = prod.requests[1].headers;
  assert.equal(h[':method'], 'POST');
  assert.equal(h[':path'], `/3/device/${TOKEN}`);
  assert.equal(h['apns-topic'], 'app.fractonica.clock.voip');
  assert.equal(h['apns-push-type'], 'voip');
  assert.equal(h['apns-priority'], '10');
  assert.equal(h['apns-expiration'], '1794000086');
  const [jh, jc, js] = h.authorization.replace(/^bearer /, '').split('.');
  assert.ok(verify('sha256', Buffer.from(`${jh}.${jc}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(js, 'base64url')));
  assert.notEqual(prod.requests[0].headers.authorization, h.authorization, 'a new provider token');
  assert.deepEqual(prod.requests[1].body, { aps: {}, fx: { id: 'm1' } });

  // a development build's token: production says BadDeviceToken, the sandbox takes it
  const d = await apns.send({ deviceToken: DEV_TOKEN, topic: 'app.fractonica.clock.voip', payload: { aps: {} } });
  assert.equal(d.ok, true);
  assert.equal(d.environment, 'development');
  assert.equal(dev.requests.length, 1);
  // a failure says why
  const bad = await new ApnsClient({ key: privateKey, keyId: 'ABC123DEFG', hosts: { production: prod.url, development: dev.url } })
    .send({ deviceToken: TOKEN, topic: 't', payload: {} });
  assert.deepEqual([bad.ok, bad.reason], [false, 'no team id']);
});

test('schedules are read leniently: bad calls dropped, the token checked', () => {
  const s = readSchedule({
    id: 'dispatch.calls.x', kind: 'dispatch.calls', updated: 1, source: 'c_1',
    data: { enabled: true, name: 'iPhone', team: 'G23G724G3D', push: { token: TOKEN.toUpperCase(), environment: 'development', topic: 'app.fractonica.clock.voip' },
      calls: [{ id: 'a', at: 10, until: 96 }, { id: 'b', at: 10 }, { at: 1, until: 2 }, { id: 'c', at: 20, until: 10 }, null] },
  });
  assert.deepEqual(s.calls.map((c) => c.id), ['a']);
  assert.equal(s.push.token, TOKEN);
  assert.equal(s.push.environment, 'development');
  assert.equal(s.team, 'G23G724G3D');
  assert.equal(readSchedule({ kind: 'journal.entry', data: {} }), null);
  assert.equal(readSchedule({ id: 'x', kind: 'dispatch.calls', data: { push: { token: 'nothex' } } }).push.token, null);
});

test('dispatch: paired by the phone\'s code, rings each call on time once, follows alert mode and back without pairing again', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-dispatch-'));
  const h = await startHub({ dir, port: 0, host: '127.0.0.1', publicUrl: 'http://hub.test:8787' });
  const apnsServer = await fakeApns();
  const { privateKey } = key();
  const states = [];
  t.after(async () => {
    await apnsServer.close();
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // the phone: a device client of the hub
  const admin = new Hub(h.url, h.hub.createClient({ name: 'Admin', kind: 'browser', scopes: ['read', 'write', 'search', 'admin'] }).token);
  const pc = await admin.request('POST', '/v1/pairings', { name: 'iPhone' });
  const phonePair = await new Hub(h.url).request('POST', '/v1/pair', { code: pc.code, name: 'iPhone', kind: 'device' });
  const phone = new Hub(h.url, phonePair.token);

  // the phone makes the dispatch's code; the dispatch redeems it
  const code = await phone.request('POST', '/v1/pairings', {});
  const paired = await new Hub(h.url).redeem(code.code, { name: 'studio', platform: 'test' });
  assert.deepEqual(paired.client.kinds, ['dispatch.*']);
  const hub = new Hub(h.url, paired.token);

  const now = () => Date.now() / 1000;
  const t0 = now();
  let version = 1;
  const schedule = (enabled, calls) => phone.put({
    id: 'dispatch.calls.install-1', kind: 'dispatch.calls', time: t0, created: t0, updated: t0 + version++ / 1000,
    data: { enabled, name: 'iPhone', team: 'G23G724G3D', push: { token: TOKEN, environment: 'production', topic: 'app.fractonica.clock.voip' }, calls },
  });
  await schedule(true, [
    { id: 'm1', at: t0 + 1.2, until: t0 + 90, title: 'Helion 34η Ascending Node', index: 1 },
    { id: 'm2', at: t0 + 2.4, until: t0 + 90, title: 'Nuclide ε#3 Start', index: 2 },
    { id: 'gone', at: t0 - 200, until: t0 - 100, title: 'rang out already' },
    { id: 'late', at: t0 - 30, until: t0 + 60, title: 'still ringing' },
  ]);

  const store = { held: null, load() { return this.held; }, save(s) { this.held = structuredClone(s); states.push(s); } };
  const apns = new ApnsClient({ key: privateKey, keyId: 'ABC123DEFG', hosts: { production: apnsServer.url, development: apnsServer.url } });
  const d = new Dispatcher({ hub, apns, store, clientId: paired.client.id, name: 'studio', wait: 1, heartbeat: 3600 });
  await d.start();

  await until(() => apnsServer.requests.length >= 3, 6);
  const byId = Object.fromEntries(apnsServer.requests.map((r) => [r.body.fx.id, r]));
  assert.ok(byId.late, 'a call still ringing goes at once');
  assert.ok(!byId.gone, 'one that rang out does not');
  assert.ok(Math.abs(byId.m1.at - (t0 + 1.2)) < 0.75, `m1 on time: ${byId.m1.at - t0}`);
  assert.ok(Math.abs(byId.m2.at - (t0 + 2.4)) < 0.75, `m2 on time: ${byId.m2.at - t0}`);
  assert.equal(byId.m1.headers['apns-topic'], 'app.fractonica.clock.voip');
  assert.equal(byId.m1.body.fx.title, 'Helion 34η Ascending Node');
  assert.equal(byId.m1.body.fx.kind, 'moment');
  assert.equal(byId.m1.headers['apns-expiration'], String(Math.floor(t0 + 90)));
  await sleep(400);
  assert.equal(apnsServer.requests.length, 3, 'each call once');

  // the status the phone reads
  await until(async () => (await phone.request('GET', `/v1/records/dispatch.status.${paired.client.id}`).catch(() => null))?.data?.sent === 3, 4);
  const status = await phone.request('GET', `/v1/records/dispatch.status.${paired.client.id}`);
  assert.equal(status.data.apns, 'ready');
  assert.equal(status.data.devices[0].name, 'iPhone');
  assert.equal(status.data.last.status, 200);

  // alert mode: nothing rings, the pairing stays
  await schedule(false, [{ id: 'm3', at: now() + 1, until: now() + 90 }]);
  await sleep(2500);
  assert.equal(apnsServer.requests.length, 3, 'nothing while the phone is in alert mode');
  // calls again: no new code
  const back = now();
  await schedule(true, [{ id: 'm4', at: back + 1, until: back + 90, title: 'back' }]);
  await until(() => apnsServer.requests.some((r) => r.body.fx.id === 'm4'), 4);
  assert.ok(!apnsServer.requests.some((r) => r.body.fx.id === 'm3'), 'a call listed in alert mode stays unsent');

  // a restart with the state on disk sends nothing twice
  d.stop();
  const again = new Dispatcher({ hub, apns, store, clientId: paired.client.id, wait: 1, heartbeat: 3600 });
  assert.equal(again.cursor > 0, true);
  await again.start();
  await sleep(800);
  again.stop();
  assert.equal(apnsServer.requests.length, 4);
  apns.close();
});

test('dispatch without an APNs key: follows the schedules and says why nothing rings', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fx-dispatch-'));
  const h = await startHub({ dir, port: 0, host: '127.0.0.1' });
  t.after(async () => {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const client = h.hub.createClient({ name: 'd', kind: 'service', scopes: ['read', 'write'], kinds: ['dispatch.*'] });
  const store = { held: null, load() { return this.held; }, save(s) { this.held = s; } };
  const d = new Dispatcher({ hub: new Hub(h.url, client.token), apns: null, store, clientId: client.client.id, wait: 1 });
  const r = await d.send({ id: 'x', name: 'iPhone', enabled: true, push: { token: TOKEN, environment: 'production', topic: 't' } }, { id: 'c', at: 0, until: 1 });
  assert.deepEqual([r.ok, r.reason], [false, 'no APNs key']);
  assert.equal(d.statusRecord().data.apns, 'no APNs key');
});

test('--call: delays, times of day (today, else tomorrow) and dates', () => {
  const now = new Date(2026, 10, 9, 13, 0, 0).getTime() / 1000; // 13:00 on this computer's clock
  const at = (w) => (parseWhen(w, now) === null ? null : parseWhen(w, now) - now);
  assert.deepEqual(['90s', '2m', '2 min', 'in 2m', '1h30m', '1m30s', '45'].map(at), [90, 120, 120, 120, 5400, 90, 45]);
  assert.equal(at('14:30'), 5400);
  assert.equal(at('14:30:15'), 5415);
  assert.equal(parseWhen('12:00', now), new Date(2026, 10, 10, 12, 0, 0).getTime() / 1000, 'passed today: tomorrow');
  assert.equal(at('2026-11-09T14:30'), 5400);
  assert.equal(at('2026-11-09 14:30'), 5400);
  assert.deepEqual(['soon', '25:00', '', '14:60'].map(at), [null, null, null, null]);
  assert.deepEqual([fromNow(now + 133, now), fromNow(now + 3900, now), fromNow(now - 1, now)], ['in 2 min 13 s', 'in 1 h 05 min', 'now']);
});

test('test calls at chosen times: to each phone in Calls mode, named and timed like its next moment, once', async (t) => {
  const apnsServer = await fakeApns();
  const { privateKey } = key();
  const apns = new ApnsClient({ key: privateKey, keyId: 'ABC123DEFG', teamId: 'G23G724G3D', hosts: { production: apnsServer.url, development: apnsServer.url } });
  t.after(async () => {
    apns.close();
    await apnsServer.close();
  });
  const t0 = Date.now() / 1000;
  const hub = { base: 'stub', changes: () => new Promise(() => {}), put: async () => ({}) };
  const store = { held: null, load() { return this.held; }, save(s) { this.held = structuredClone(s); } };
  const phone = (id, enabled, token) => ({
    id, kind: 'dispatch.calls', updated: 1,
    data: { enabled, name: id, team: 'G23G724G3D', push: { token, environment: 'production', topic: 'app.fractonica.clock.voip' },
      calls: [{ id: 'm9', at: t0 + 3600, until: t0 + 3685.5, moment: t0 + 3615.5, index: 9, title: 'Helion 34η Peak', rarity: 'rare', level: 'helion', boundary: 'peak' }] },
  });
  const start = async () => {
    const d = new Dispatcher({ hub, apns, store, clientId: 'c_1', trials: [t0 + 0.8], wait: 1, heartbeat: 3600 });
    d.apply(phone('dispatch.calls.on', true, TOKEN));
    d.apply(phone('dispatch.calls.off', false, DEV_TOKEN));
    await d.start();
    return d;
  };
  const d = await start();
  assert.equal(d.next().call.kind, 'test', 'the test call is the next call');
  await until(() => apnsServer.requests.length >= 1, 4);
  await sleep(400);
  d.stop();
  assert.equal(apnsServer.requests.length, 1, 'once, and not to the phone in alert mode');
  const r = apnsServer.requests[0];
  assert.equal(r.path, `/3/device/${TOKEN}`);
  assert.ok(Math.abs(r.at - (t0 + 0.8)) < 0.75, `on time: ${r.at - t0}`);
  const fx = r.body.fx;
  assert.deepEqual([fx.kind, fx.title, fx.rarity, fx.level, fx.boundary], ['test', 'Helion 34η Peak', 'rare', 'helion', 'peak']);
  assert.ok(Math.abs(fx.until - fx.at - 85.5) < 1e-6, 'rings as long as a moment');
  assert.equal(fx.index, undefined, 'no moment of the calendar');
  assert.equal(r.headers['apns-expiration'], String(Math.floor(fx.until)));

  // launched again with the same time: sent already
  const again = await start();
  await sleep(500);
  again.stop();
  assert.equal(apnsServer.requests.length, 1);

  // `test`: now, to every phone in Calls mode, each phone's result
  const results = await again.test();
  assert.deepEqual(results.map((x) => [x.device, x.ok]), [['dispatch.calls.on', true]]);
  assert.equal(apnsServer.requests.at(-1).body.fx.kind, 'test');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(50);
  }
  assert.fail('timed out');
}
