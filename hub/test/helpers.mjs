// Test helpers: a hub on an ephemeral port in a temporary directory, an API client, a fake embedding worker.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startHub } from '../lib/server.js';

/** Starts a hub; `clock.shift` moves the hub's time forward (leases, pairing expiry, grace periods). */
export async function testHub(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fx-hub-'));
  const clock = { shift: 0, now: () => Date.now() / 1000 + clock.shift };
  const h = await startHub({ dir, port: 0, host: '127.0.0.1', clock: clock.now, publicUrl: 'http://hub.test:8787', ...opts });
  const admin = h.hub.createClient({ name: 'Admin', kind: 'browser', scopes: ['read', 'write', 'search', 'admin'] });
  const close = async () => {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { ...h, dir, clock, admin: api(h.url, admin.token), adminClient: admin.client, api: (token) => api(h.url, token), close };
}

/** fetch wrapper: `await c.put('/v1/records/x', body)` → { status, body, headers }. */
export function api(base, token) {
  const call = async (method, path, body, headers = {}) => {
    const init = { method, headers: { ...headers } };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
      if (body instanceof Uint8Array || typeof body === 'string') init.body = body;
      else {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
      }
    }
    const res = await fetch(base + path, init);
    const ct = res.headers.get('content-type') ?? '';
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: data, headers: res.headers };
  };
  return {
    token,
    get: (p, h) => call('GET', p, undefined, h),
    put: (p, b, h) => call('PUT', p, b, h),
    post: (p, b, h) => call('POST', p, b, h),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
  };
}

/** Makes a client with the given scopes/kinds through the admin API (pairing) and returns its API wrapper. */
export async function pairClient(t, { name = 'Device', scopes, kinds, kind = 'device', device } = {}) {
  const p = await t.admin.post('/v1/pairings', { name, scopes, kinds });
  const r = await t.api().post('/v1/pair', { code: p.body.code, name, kind, device });
  if (r.status !== 201) throw new Error(`pairing failed: ${JSON.stringify(r.body)}`);
  return Object.assign(t.api(r.body.token), { client: r.body.client });
}

let n = 0;
/** A record body with sensible defaults. */
export function rec(over = {}) {
  const t = over.time ?? 1791460800 + n++;
  return { kind: 'journal.entry', time: t, created: t, updated: t, data: { emoji: '🌙', title: 'Night walk', markdown: 'Saw the moon rise' }, ...over };
}

export const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Deterministic "embedding": hashed bag of words in 768 dimensions, L2-normalised; similar words → similar vectors. */
export function fakeEmbed(text, dim = 768) {
  const v = new Float32Array(dim);
  const words = String(text).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
  for (const w of words) {
    const h = createHash('sha256').update(w).digest();
    for (let k = 0; k < 4; k++) v[h.readUInt16LE(k * 2) % dim] += 1;
  }
  if (!words.length) v[0] = 1;
  let s = 0;
  for (const x of v) s += x * x;
  for (let i = 0; i < dim; i++) v[i] /= Math.sqrt(s);
  return v;
}
export const b64 = (f32) => {
  const buf = Buffer.alloc(f32.length * 4);
  f32.forEach((x, i) => buf.writeFloatLE(x, i * 4));
  return buf.toString('base64');
};
export const unb64 = (s) => {
  const buf = Buffer.from(s, 'base64');
  return Array.from({ length: buf.length / 4 }, (_, i) => buf.readFloatLE(i * 4));
};

/** A worker that polls the hub and answers every job with fakeEmbed vectors until stopped. */
export function fakeWorker(w, { model = 'test/fake-embed', onJob } = {}) {
  let running = true;
  const loop = (async () => {
    await w.post('/v1/worker/heartbeat', { model, device: 'cpu', modalities: ['text'] });
    while (running) {
      try {
        await step();
      } catch (e) {
        if (running) throw e;
      }
    }
  })();
  async function step() {
    {
      const r = await w.get('/v1/worker/jobs?wait=1&max=8');
      for (const job of r.body.jobs ?? []) {
        onJob?.(job);
        const vectors =
          job.type === 'embed.query'
            ? job.inputs.map((s, i) => ({ part: String(i), vector: b64(fakeEmbed(s)) }))
            : [
                { part: 'record', vector: b64(fakeEmbed(job.text)) },
                ...job.media.map((m) => ({ part: `blob:${m.hash}`, vector: b64(fakeEmbed(`${m.role} ${m.hash}`)) })),
              ];
        await w.post(`/v1/worker/jobs/${job.id}`, { model, vectors });
      }
    }
  }
  return { stop: async () => ((running = false), await loop) };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Polls `fn` until it returns truthy (or throws after `ms`). */
export async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(25);
  }
}
