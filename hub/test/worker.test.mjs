import test from 'node:test';
import assert from 'node:assert/strict';
import { testHub, pairClient, rec, sha, fakeEmbed, fakeWorker, b64, unb64, until } from './helpers.mjs';

const workerOf = (h) => pairClient(h, { name: 'GPU box', kind: 'worker', scopes: ['worker'] });

test('worker: leases, requeue after 120 s, park after 3 failures, retry', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const w = await workerOf(h);
  await h.admin.put('/v1/records/r1', rec({ data: { emoji: '🌙', title: 'Night walk', markdown: 'Saw the moon rise' } }));

  const j1 = await w.get('/v1/worker/jobs?max=8');
  assert.equal(j1.body.jobs.length, 1);
  const job = j1.body.jobs[0];
  assert.equal(job.type, 'embed.record');
  assert.equal(job.record.id, 'r1');
  assert.equal(job.text, 'title: 🌙 Night walk | text: Saw the moon rise');
  assert.deepEqual(job.media, []);
  assert.deepEqual((await w.get('/v1/worker/jobs')).body.jobs, [], 'leased: not handed out twice');

  // three expired leases park it
  for (let i = 1; i <= 2; i++) {
    h.clock.shift += 121;
    const again = await w.get('/v1/worker/jobs');
    assert.equal(again.body.jobs[0]?.id, job.id, `requeued after lease ${i}`);
  }
  h.clock.shift += 121;
  assert.deepEqual((await w.get('/v1/worker/jobs')).body.jobs, []);
  let st = await h.admin.get('/v1/worker');
  assert.equal(st.body.queue.parked, 1);
  assert.equal(st.body.parked[0].record, 'r1');
  assert.equal(st.body.parked[0].error, 'lease expired');

  // retry parked; an error with retry requeues, retry:false parks at once
  assert.equal((await h.admin.post('/v1/worker/retry', {})).body.requeued, 1);
  const j2 = (await w.get('/v1/worker/jobs')).body.jobs[0];
  await w.post(`/v1/worker/jobs/${j2.id}`, { error: 'GPU busy', retry: true });
  const j3 = (await w.get('/v1/worker/jobs')).body.jobs[0];
  assert.equal(j3.id, j2.id);
  await w.post(`/v1/worker/jobs/${j3.id}`, { error: 'cannot decode', retry: false });
  st = await h.admin.get('/v1/worker');
  assert.equal(st.body.parked[0].error, 'cannot decode');
  assert.equal((await w.post('/v1/worker/jobs/j_nope', { model: 'm', vectors: [] })).status, 404);
  assert.equal((await h.admin.get('/v1/worker/jobs')).status, 403, 'worker scope needed');
});

test('worker: query jobs come before record jobs; /v1/embed', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const w = await workerOf(h);
  const r503 = await h.admin.post('/v1/embed', { inputs: ['moon'], dim: 256 });
  assert.equal(r503.status, 503);
  assert.equal(r503.body.error.code, 'unavailable');
  assert.ok(r503.headers.get('retry-after'));

  for (let i = 0; i < 3; i++) await h.admin.put(`/v1/records/q${i}`, rec());
  await w.post('/v1/worker/heartbeat', { model: 'test/fake', device: 'cpu', modalities: ['text'] });
  assert.equal((await h.api().get('/v1')).body.embedding.worker, true);
  const pending = h.admin.post('/v1/embed', { inputs: ['the huge orange moon over the river', 'a walk'], task: 'query', dim: 128 });
  await until(async () => (await h.admin.get('/v1/worker')).body.queue.queries === 1);
  const jobs = (await w.get('/v1/worker/jobs?max=2')).body.jobs;
  assert.equal(jobs[0].type, 'embed.query');
  assert.deepEqual(jobs[0].inputs, ['the huge orange moon over the river', 'a walk']);
  assert.equal(jobs[0].task, 'query');
  assert.equal(jobs[1].type, 'embed.record');
  const full = [fakeEmbed('the huge orange moon over the river'), fakeEmbed('a walk')];
  await w.post(`/v1/worker/jobs/${jobs[0].id}`, { model: 'test/fake', vectors: full.map((v, i) => ({ part: String(i), vector: b64(v) })) });
  const r = await pending;
  assert.equal(r.status, 200);
  assert.equal(r.body.dim, 128);
  assert.equal(r.body.model, 'test/fake');
  const v0 = unb64(r.body.vectors[0]);
  assert.equal(v0.length, 128);
  const norm = Math.hypot(...v0);
  assert.ok(Math.abs(norm - 1) < 1e-5);
  const k = Math.hypot(...full[0].slice(0, 128));
  assert.ok(Math.abs(v0[5] - full[0][5] / k) < 1e-6, 'truncated, then re-normalised');
});

test('vectors: feed, dim truncation, forget entries, model change restarts vrev', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const w = await workerOf(h);
  const photo = Buffer.from('a photo');
  const ph = sha(photo);
  await h.admin.put(`/v1/blobs/${ph}`, photo, { 'Content-Type': 'image/jpeg' });
  await h.admin.put('/v1/records/v1', rec({ updated: 1, created: 1, blobs: [{ hash: ph, type: 'image/jpeg', size: photo.length, role: 'photo' }] }));
  await h.admin.put('/v1/records/v2', rec({ updated: 1, created: 1 }));
  const seenJobs = [];
  let worker = fakeWorker(w, { model: 'test/a', onJob: (j) => seenJobs.push(j) });
  await until(async () => (await h.admin.get('/v1/vectors?dim=768')).body.vectors.length === 3);
  const media = seenJobs.find((j) => j.record?.id === 'v1').media;
  assert.deepEqual(media, [{ hash: ph, type: 'image/jpeg', role: 'photo', url: `/v1/blobs/${ph}` }]);
  // the worker may fetch the media it was handed
  assert.equal((await w.get(media[0].url)).status, 200);

  const feed = await h.admin.get('/v1/vectors?dim=256');
  assert.equal(feed.body.model, 'test/a');
  assert.equal(feed.body.dim, 256);
  const parts = feed.body.vectors.map((v) => `${v.record}/${v.part}`).sort();
  assert.deepEqual(parts, [`v1/blob:${ph}`, 'v1/record', 'v2/record']);
  for (const v of feed.body.vectors) {
    const x = unb64(v.vector);
    assert.equal(x.length, 256);
    assert.ok(Math.abs(Math.hypot(...x) - 1) < 1e-5);
  }
  assert.equal((await h.admin.get('/v1/vectors?dim=300')).status, 400);
  const page = await h.admin.get('/v1/vectors?after=0&limit=2');
  assert.equal(page.body.vectors.length, 2);
  assert.equal(page.body.more, true);
  const cursor = feed.body.cursor;

  // an edit drops the old vectors (one forget entry) and the new ones follow
  await h.admin.put('/v1/records/v2', rec({ updated: 2, created: 1, data: { markdown: 'a different text' } }));
  await until(async () => (await h.admin.get(`/v1/vectors?after=${cursor}`)).body.vectors.length === 2);
  const after = (await h.admin.get(`/v1/vectors?after=${cursor}`)).body.vectors;
  assert.deepEqual(after.map((v) => [v.record, v.part, v.vector === null]), [['v2', null, true], ['v2', 'record', false]]);
  assert.ok(after[0].vrev < after[1].vrev);

  // a change that leaves the embedded text alone keeps the vectors
  const c2 = (await h.admin.get('/v1/vectors')).body.cursor;
  await h.admin.put('/v1/records/v2', rec({ updated: 3, created: 1, tags: ['new tag'], data: { markdown: 'a different text' } }));
  assert.deepEqual((await h.admin.get(`/v1/vectors?after=${c2}`)).body.vectors, []);

  // a delete leaves one forget entry
  await h.admin.del('/v1/records/v1');
  const del = (await h.admin.get(`/v1/vectors?after=${c2}`)).body.vectors;
  assert.deepEqual(del.map((v) => [v.record, v.part, v.vector]), [['v1', null, null]]);

  // the worker comes back with another model: everything is re-embedded and vrev restarts
  await worker.stop();
  const before = (await h.admin.get('/v1/vectors')).body.cursor;
  worker = fakeWorker(w, { model: 'test/b' });
  t.after(() => worker.stop());
  await until(async () => (await h.api().get('/v1')).body.embedding.model === 'test/b');
  await until(async () => (await h.admin.get('/v1/vectors')).body.vectors.length === 1);
  const fresh = await h.admin.get('/v1/vectors');
  assert.equal(fresh.body.model, 'test/b');
  assert.deepEqual(fresh.body.vectors.map((v) => [v.record, v.part, v.vrev]), [['v2', 'record', 1]]);
  assert.ok(fresh.body.cursor < before);
});

test('search: keyword (accent/case-insensitive), auto, semantic with a fake worker', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const entries = {
    moon: { emoji: '🌙', title: 'Night walk', markdown: 'The moon rose huge and orange over the river' },
    cafe: { emoji: '☕', title: 'Café Noir', markdown: 'Crème brûlée and an espresso with Ana' },
    code: { emoji: '💻', title: 'Refactor', markdown: 'Rewrote the sync engine; tests pass' },
  };
  for (const [id, data] of Object.entries(entries)) await h.admin.put(`/v1/records/${id}`, rec({ data }));
  await h.admin.put('/v1/records/usage1', { kind: 'computer.usage', time: 5, created: 5, updated: 5, text: 'Xcode — FractonicaKit.swift', data: { app: 'Xcode' } });

  const kw = await h.admin.post('/v1/search', { query: 'CAFE creme', mode: 'auto' });
  assert.equal(kw.status, 200);
  assert.equal(kw.body.mode, 'keyword');
  assert.equal(kw.body.results[0].record.id, 'cafe');
  assert.ok(kw.body.results[0].score > 0 && kw.body.results[0].score <= 1);
  assert.deepEqual((await h.admin.post('/v1/search', { query: 'xcode' })).body.results.map((r) => r.record.id), ['usage1']);
  assert.deepEqual((await h.admin.post('/v1/search', { query: 'xcode', kinds: ['journal.*'] })).body.results, []);
  assert.equal((await h.admin.post('/v1/search', { query: 'moon', mode: 'semantic' })).status, 503);
  assert.equal((await h.admin.post('/v1/search', {})).status, 400);

  const w = await workerOf(h);
  const worker = fakeWorker(w);
  t.after(() => worker.stop());
  await until(async () => (await h.admin.get('/v1/worker')).body.records === 4);
  const sem = await h.admin.post('/v1/search', { query: 'the huge orange moon', mode: 'auto', limit: 2 });
  assert.equal(sem.status, 200);
  assert.equal(sem.body.mode, 'semantic');
  assert.equal(sem.body.results.length, 2);
  assert.equal(sem.body.results[0].record.id, 'moon');
  assert.equal(sem.body.results[0].part, 'record');
  assert.ok(sem.body.results[0].score > sem.body.results[1].score);
  const only = await h.admin.post('/v1/search', { query: 'espresso', kinds: ['computer.*'] });
  assert.deepEqual(only.body.results.map((r) => r.record.kind), ['computer.usage']);
  await h.admin.del('/v1/records/moon');
  const gone = await h.admin.post('/v1/search', { query: 'the huge orange moon' });
  assert.ok(!gone.body.results.some((r) => r.record.id === 'moon'), 'tombstones are never searched');
});
