import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { testHub, pairClient, rec, sha } from './helpers.mjs';

test('blobs: hash check, upload, Range, ETag, access, ?token=', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  const hash = sha(bytes);

  assert.deepEqual((await h.admin.post('/v1/blobs/check', { hashes: [hash] })).body, { missing: [hash] });
  const wrong = await h.admin.put(`/v1/blobs/${'0'.repeat(64)}`, bytes, { 'Content-Type': 'audio/mp4' });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.body.error.details.actual, hash);
  assert.equal((await h.admin.put('/v1/blobs/XYZ', bytes)).status, 400);

  const up = await h.admin.put(`/v1/blobs/${hash}`, bytes, { 'Content-Type': 'audio/mp4' });
  assert.equal(up.status, 201);
  assert.equal((await h.admin.put(`/v1/blobs/${hash}`, bytes, { 'Content-Type': 'audio/mp4' })).status, 200);
  assert.deepEqual((await h.admin.post('/v1/blobs/check', { hashes: [hash] })).body, { missing: [] });
  assert.ok(existsSync(join(h.dir, 'blobs', hash.slice(0, 2), hash)));

  // not named by any record yet: nobody reads it
  assert.equal((await h.admin.get(`/v1/blobs/${hash}`)).status, 404);
  await h.admin.put('/v1/records/a1', rec({ blobs: [{ hash, type: 'audio/mp4', size: 1000, role: 'audio', duration: 1.5 }] }));

  const full = await h.admin.get(`/v1/blobs/${hash}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'audio/mp4');
  assert.equal(full.headers.get('etag'), `"${hash}"`);
  assert.equal(full.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(full.body, bytes);

  const part = await h.admin.get(`/v1/blobs/${hash}`, { Range: 'bytes=10-19' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
  assert.deepEqual(part.body, bytes.subarray(10, 20));
  const tail = await h.admin.get(`/v1/blobs/${hash}`, { Range: 'bytes=-5' });
  assert.deepEqual(tail.body, bytes.subarray(995));
  const open = await h.admin.get(`/v1/blobs/${hash}`, { Range: 'bytes=990-' });
  assert.equal(open.headers.get('content-range'), 'bytes 990-999/1000');
  assert.equal((await h.admin.get(`/v1/blobs/${hash}`, { Range: 'bytes=2000-' })).status, 416);
  assert.equal((await h.admin.get(`/v1/blobs/${hash}`, { 'If-None-Match': `"${hash}"` })).status, 304);

  // a reader of other kinds cannot fetch it; the browser's ?token= works for GET
  const sensors = await pairClient(h, { scopes: ['read'], kinds: ['sensor.*'] });
  assert.equal((await sensors.get(`/v1/blobs/${hash}`)).status, 404);
  const viaQuery = await h.api().get(`/v1/blobs/${hash}?token=${encodeURIComponent(h.admin.token)}`);
  assert.equal(viaQuery.status, 200);
  assert.equal((await h.api().get('/v1/records?token=' + encodeURIComponent(h.admin.token))).status, 401, '?token= only for blobs and events');

  // the record goes: the blob lives through the grace period, then is collected
  await h.admin.del('/v1/records/a1');
  h.gc();
  assert.ok(existsSync(join(h.dir, 'blobs', hash.slice(0, 2), hash)));
  h.clock.shift += 24 * 3600 + 1;
  h.gc();
  assert.ok(!existsSync(join(h.dir, 'blobs', hash.slice(0, 2), hash)));
  assert.deepEqual((await h.admin.post('/v1/blobs/check', { hashes: [hash] })).body, { missing: [hash] });
});

test('blobs: size limit is 413', async (t) => {
  const h = await testHub({ maxBlobSize: 100 });
  t.after(h.close);
  const bytes = Buffer.alloc(200, 1);
  const r = await h.admin.put(`/v1/blobs/${sha(bytes)}`, bytes);
  assert.equal(r.status, 413);
});

let ffmpeg = null;
try {
  ffmpeg = execFileSync('/usr/bin/which', ['ffmpeg'], { encoding: 'utf8' }).trim() || null;
} catch {}

test('blobs: ?thumb= makes a cached JPEG', { skip: !ffmpeg && 'no ffmpeg' }, async (t) => {
  const h = await testHub();
  t.after(h.close);
  const src = join(h.dir, 'src.png');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=640x400', '-frames:v', '1', src]);
  const bytes = readFileSync(src);
  const hash = sha(bytes);
  await h.admin.put(`/v1/blobs/${hash}`, bytes, { 'Content-Type': 'image/png' });
  await h.admin.put('/v1/records/p1', rec({ blobs: [{ hash, type: 'image/png', size: bytes.length, role: 'photo', width: 640, height: 400 }] }));
  const th = await h.admin.get(`/v1/blobs/${hash}?thumb=128`);
  assert.equal(th.status, 200);
  assert.equal(th.headers.get('content-type'), 'image/jpeg');
  assert.equal(th.body[0], 0xff);
  assert.equal(th.body[1], 0xd8);
  assert.ok(existsSync(join(h.dir, 'thumbs', hash.slice(0, 2), `${hash}-128.jpg`)));
  const tiny = await h.admin.get(`/v1/blobs/${hash}?thumb=1`);
  assert.equal(tiny.headers.get('etag'), `"${hash}-64"`, 'clamped to 64');
});
