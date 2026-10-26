#!/usr/bin/env node
// A small stand-in for the Fractonica hub (hub/API.md), for the app's sync checks and for trying the app before the
// real hub exists. It implements the endpoints the app uses, faithfully: pairing (codes, device replacement, 404 and
// 429), records (PUT and batch with 201/200/409/422 and the tie rule), the change feed with long poll, blobs
// (check, streamed upload with hash verification, download with Range), embed / search / the vector feed (a fake
// worker: deterministic word-hash vectors), kinds, and revocation. In memory, optionally saved to a file so a restart
// keeps the data (`--state`).
//
//   node mockhub.mjs [--port 8787] [--host 0.0.0.0] [--code K7QF-2MXD …] [--name "Mock Hub"] [--admin TOKEN]
//                    [--state file.json] [--no-worker] [--model NAME] [--bonjour] [--quiet]
//
// Prints "LISTENING <port>" once ready (port 0 picks one). Test controls, all under /_mock (admin token):
//   POST /_mock/code     {code?}                 mint a pairing code (also POST /v1/pairings)
//   POST /_mock/worker   {connected}             connect or disconnect the fake embedding worker
//   POST /_mock/model    {model}                 change the model: the vector feed restarts from vrev 0
//   POST /_mock/lie      {count}                 the next N blob checks answer "nothing missing" (422 path)
//   POST /_mock/corrupt  {hash}                  serve wrong bytes for a blob (hash verification)
//   POST /_mock/forget-blob {hash}               drop a stored blob
//   GET  /_mock/state                            counts, rev, vrev, clients, blob hashes
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
function optAll(name) {
  const out = [];
  args.forEach((a, i) => { if (a === `--${name}` && i + 1 < args.length) out.push(args[i + 1]); });
  return out;
}
const flag = (name) => args.includes(`--${name}`);

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const PORT = Number(opt('port', '8787'));
const HOST = opt('host', '0.0.0.0');
const ADMIN = opt('admin', 'fxh_admin');
const STATE_FILE = opt('state', null);
const QUIET = flag('quiet');
const log = (...a) => { if (!QUIET) console.error('[mockhub]', ...a); };

// ---------------------------------------------------------------- state

let S = {
  hub: { id: 'h_' + crypto.randomBytes(6).toString('hex'), name: opt('name', 'Mock Hub'), version: '1.0.0-mock' },
  model: opt('model', 'google/embeddinggemma-2'),
  worker: !flag('no-worker'),
  rev: 0,
  vrev: 0,
  clients: {},       // id -> { id, name, kind, platform, scopes, kinds, device, token, created, lastSeen, revoked }
  codes: {},         // CODE -> { expires, scopes, kinds, name }
  records: {},       // id -> record (with rev)
  vectors: [],       // { record, part, vector (base64 768 float32) | null, vrev }
  blobs: {},         // hash -> { type, size }
};
const blobData = new Map(); // hash -> Buffer
let lies = 0;
const corrupt = new Set();
const failures = new Map(); // ip -> [times]
const changes = new EventEmitter();
changes.setMaxListeners(1000);

if (STATE_FILE && fs.existsSync(STATE_FILE)) {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  S = saved.S;
  for (const [hash, b64] of Object.entries(saved.blobs || {})) blobData.set(hash, Buffer.from(b64, 'base64'));
  log('state loaded', Object.keys(S.records).length, 'records');
}
function persist() {
  if (!STATE_FILE) return;
  const blobs = {};
  for (const [hash, buf] of blobData) blobs[hash] = buf.toString('base64');
  fs.writeFileSync(STATE_FILE, JSON.stringify({ S, blobs }));
}
for (const code of optAll('code')) addCode(code);

function addCode(code, extra = {}) {
  const chars = normCode(code || Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join(''));
  S.codes[chars] = { expires: now() + (extra.ttl ?? 3600), scopes: extra.scopes || ['read', 'write', 'search'],
                     kinds: extra.kinds || ['*'], name: extra.name || null };
  return chars.slice(0, 4) + '-' + chars.slice(4);
}
function normCode(text) { return String(text).toUpperCase().replace(/[-\s]/g, ''); }
function now() { return Date.now() / 1000; }

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
const CODES = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict',
                413: 'too_large', 422: 'unprocessable', 429: 'rate_limited', 503: 'unavailable' };
const fail = (status, message, details) => { throw new HttpError(status, CODES[status], message, details); };

function send(res, status, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length,
                          'Access-Control-Allow-Origin': '*', ...headers });
  res.end(data);
}
async function readBody(req, limit = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) fail(413, 'body too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readJSON(req) {
  const body = await readBody(req);
  if (!body.length) return {};
  try { return JSON.parse(body.toString('utf8')); } catch { fail(400, 'invalid JSON'); }
}
function glob(pattern, kind) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(kind);
}
const kindAllowed = (client, kind) => (client.kinds || ['*']).some((p) => glob(p, kind));

function auth(req, scope) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token === ADMIN) return { id: 'c_admin', name: 'admin', kind: 'browser', scopes: ['read', 'write', 'search', 'admin', 'worker'], kinds: ['*'] };
  const client = token && Object.values(S.clients).find((c) => c.token === token && !c.revoked);
  if (!client) fail(401, 'unknown or revoked token');
  client.lastSeen = now();
  if (scope && !client.scopes.includes(scope) && !client.scopes.includes('admin')) fail(403, `missing scope ${scope}`);
  return client;
}

// The written fields, canonical (sorted keys), for the tie rule.
const WRITTEN = ['id', 'kind', 'time', 'end', 'zone', 'data', 'text', 'tags', 'blobs', 'created', 'updated', 'deleted'];
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function written(r) { const o = {}; for (const k of WRITTEN) if (r[k] !== undefined && r[k] !== null) o[k] = r[k]; if (o.deleted === false) delete o.deleted; return o; }
const contentHash = (r) => crypto.createHash('sha256').update(canonical(written(r))).digest('hex');

// ---------------------------------------------------------------- the fake worker

function wordVector(word) {
  const seed = crypto.createHash('sha256').update(word).digest();
  const v = new Float32Array(768);
  let x = seed.readUInt32LE(0) || 1;
  for (let i = 0; i < 768; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; v[i] = (x / 4294967296) - 0.5; }
  return v;
}
function embedText(text) {
  const words = String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) || ['empty'];
  const v = new Float32Array(768);
  for (const w of words) { const wv = wordVector(w); for (let i = 0; i < 768; i++) v[i] += wv[i]; }
  return normalize(v);
}
function normalize(v) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); }
function truncate(v, dim) { return normalize(Float32Array.from(v.slice(0, dim))); }
const b64 = (v) => Buffer.from(Float32Array.from(v).buffer).toString('base64');
const unb64 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };

function searchable(r) {
  if (r.kind === 'journal.entry') return [r.data?.emoji, r.data?.title, r.data?.markdown, r.data?.transcript].filter(Boolean).join(' ');
  return r.text || r.data?.text || r.data?.title || r.data?.summary || '';
}
function embedRecord(r, hadVectors) {
  if (hadVectors) S.vectors = S.vectors.filter((e) => e.record !== r.id);
  if (hadVectors || r.deleted) S.vectors.push({ record: r.id, part: null, vector: null, vrev: ++S.vrev });
  if (r.deleted) return;
  S.vectors.push({ record: r.id, part: 'record', vector: b64(embedText(searchable(r))), vrev: ++S.vrev });
  for (const b of r.blobs || []) {
    if (['photo', 'video', 'audio'].includes(b.role)) {
      S.vectors.push({ record: r.id, part: 'blob:' + b.hash, vector: b64(embedText('media ' + b.hash.slice(0, 6) + ' ' + searchable(r))), vrev: ++S.vrev });
    }
  }
}

// ---------------------------------------------------------------- records

const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const KIND_RE = /^[a-z0-9]+(\.[a-z0-9_-]+)+$/;

function writeRecord(client, input) {
  if (!input || typeof input !== 'object') return { status: 400, error: { code: 'bad_request', message: 'not an object' } };
  const id = input.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) return { id, status: 400, error: { code: 'bad_request', message: 'bad id' } };
  if (typeof input.kind !== 'string' || !KIND_RE.test(input.kind)) return { id, status: 400, error: { code: 'bad_request', message: 'bad kind' } };
  for (const k of ['time', 'created', 'updated']) if (typeof input[k] !== 'number') return { id, status: 400, error: { code: 'bad_request', message: `missing ${k}` } };
  if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) return { id, status: 400, error: { code: 'bad_request', message: 'data must be an object' } };
  if (!client.scopes.includes('write') && !client.scopes.includes('admin')) return { id, status: 403, error: { code: 'forbidden', message: 'missing scope write' } };
  if (!kindAllowed(client, input.kind)) return { id, status: 403, error: { code: 'forbidden', message: 'kind not allowed' } };
  const blobs = input.deleted ? [] : (input.blobs || []);
  const missing = blobs.map((b) => b.hash).filter((h) => !blobData.has(h));
  const stored = S.records[id];
  if (stored) {
    const admin = client.scopes.includes('admin');
    if (!admin && stored.source !== client.id && !stored.kind.startsWith('journal.')) {
      return { id, status: 403, error: { code: 'forbidden', message: 'not your record' } };
    }
    if (stored.updated > input.updated) return { id, status: 409, error: { code: 'conflict', message: 'stored copy is newer', details: { current: stored } } };
  }
  if (missing.length) return { id, status: 422, error: { code: 'unprocessable', message: 'missing blobs', details: { missing } } };
  const record = written(input);
  if (record.deleted) { record.data = {}; record.blobs = []; }
  if (stored) {
    const same = contentHash(stored) === contentHash(record);
    if (stored.updated === input.updated) {
      if (same) return { id, status: 200, record: stored };
      if (contentHash(record) < contentHash(stored)) return { id, status: 200, record: stored };
    }
  }
  const full = { ...record, source: stored ? stored.source : client.id, editor: client.id, rev: ++S.rev,
                 fx: { stamp: 'mock', clock: 'mock' } };
  const hadVectors = S.vectors.some((e) => e.record === id && e.vector);
  S.records[id] = full;
  embedRecord(full, hadVectors);
  setImmediate(() => changes.emit('change'));
  return { id, status: stored ? 200 : 201, record: full };
}

// ---------------------------------------------------------------- routes

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const q = url.searchParams;
  const method = req.method;
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                         'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE' });
    return res.end();
  }

  if (path === '/v1' && method === 'GET') {
    return send(res, 200, { hub: S.hub, api: 1, embedding: { model: S.model, dim: 768, dims: [768, 512, 256, 128], worker: S.worker } });
  }

  if (path === '/v1/pair' && method === 'POST') {
    const ip = req.socket.remoteAddress;
    const recent = (failures.get(ip) || []).filter((t) => t > now() - 60);
    failures.set(ip, recent);
    if (recent.length >= 10) fail(429, 'too many attempts');
    const body = await readJSON(req);
    const chars = normCode(body.code || '');
    const code = S.codes[chars];
    if (!code || code.expires < now()) { recent.push(now()); fail(404, 'unknown or expired code'); }
    delete S.codes[chars];
    let client = body.device && Object.values(S.clients).find((c) => c.device === body.device);
    const token = 'fxh_' + crypto.randomBytes(18).toString('base64url');
    if (client) {
      Object.assign(client, { token, revoked: false, name: body.name || client.name, platform: body.platform, scopes: code.scopes, kinds: code.kinds });
    } else {
      client = { id: 'c_' + crypto.randomBytes(6).toString('hex'), name: body.name || code.name || 'Device', kind: body.kind || 'device',
                 platform: body.platform, scopes: code.scopes, kinds: code.kinds, device: body.device || null, token,
                 created: now(), lastSeen: now() };
      S.clients[client.id] = client;
    }
    persist();
    const { token: _t, device: _d, revoked: _r, ...pub } = client;
    return send(res, 201, { client: pub, token, hub: S.hub });
  }

  if (path === '/v1/pairings' && method === 'POST') {
    auth(req, 'admin');
    const body = await readJSON(req);
    const code = addCode(null, body);
    return send(res, 201, { code, expires: S.codes[normCode(code)].expires, link: `fractonica://pair?hub=${encodeURIComponent('http://localhost:' + server.address().port)}&code=${code}` });
  }

  if (path.startsWith('/_mock/')) {
    auth(req, 'admin');
    const body = method === 'POST' ? await readJSON(req) : {};
    switch (path) {
      case '/_mock/code': return send(res, 201, { code: addCode(body.code) });
      case '/_mock/worker': S.worker = !!body.connected; return send(res, 200, { worker: S.worker });
      case '/_mock/model':
        S.model = body.model; S.vrev = 0; S.vectors = [];
        for (const r of Object.values(S.records).sort((a, b) => a.rev - b.rev)) if (!r.deleted) embedRecord(r, false);
        return send(res, 200, { model: S.model, vrev: S.vrev });
      case '/_mock/lie': lies = body.count ?? 1; return send(res, 200, { lies });
      case '/_mock/corrupt': corrupt.add(body.hash); return send(res, 200, {});
      case '/_mock/forget-blob': blobData.delete(body.hash); delete S.blobs[body.hash]; return send(res, 200, {});
      case '/_mock/state':
        return send(res, 200, { rev: S.rev, vrev: S.vrev, model: S.model, worker: S.worker,
                                records: Object.keys(S.records).length, live: Object.values(S.records).filter((r) => !r.deleted).length,
                                blobs: [...blobData.keys()], clients: Object.values(S.clients).map(({ token, ...c }) => c) });
    }
    fail(404, 'no such control');
  }

  const client = auth(req);

  if (path === '/v1/me' && method === 'GET') {
    const { token, device, revoked, ...pub } = client;
    return send(res, 200, pub);
  }

  let m;
  if ((m = path.match(/^\/v1\/clients\/([^/]+)$/)) && method === 'DELETE') {
    if (!client.scopes.includes('admin')) fail(403, 'admin only');
    const target = S.clients[m[1]];
    if (!target) fail(404, 'no such client');
    target.revoked = true; persist();
    return send(res, 200, {});
  }

  if (path === '/v1/records/batch' && method === 'POST') {
    const body = await readJSON(req);
    if (!Array.isArray(body.records) || body.records.length > 500) fail(400, 'records: 1…500');
    const results = body.records.map((r) => writeRecord(client, r));
    persist();
    return send(res, 200, { results });
  }

  if ((m = path.match(/^\/v1\/records\/([^/]+)$/))) {
    const id = decodeURIComponent(m[1]);
    if (method === 'GET') {
      const r = S.records[id];
      if (!r || !kindAllowed(client, r.kind)) fail(404, 'no such record');
      return send(res, 200, r);
    }
    if (method === 'PUT') {
      const body = await readJSON(req);
      const result = writeRecord(client, { ...body, id });
      persist();
      if (result.error) throw new HttpError(result.status, result.error.code, result.error.message, result.error.details);
      return send(res, result.status, result.record);
    }
    if (method === 'DELETE') {
      const r = S.records[id];
      if (!r) fail(404, 'no such record');
      const result = writeRecord(client, { ...r, deleted: true, data: {}, blobs: [], updated: Math.max(now(), r.updated + 0.001) });
      persist();
      if (result.error) throw new HttpError(result.status, result.error.code, result.error.message, result.error.details);
      return send(res, 200, result.record);
    }
  }

  if (path === '/v1/changes' && method === 'GET') {
    if (!client.scopes.includes('read') && !client.scopes.includes('admin')) fail(403, 'missing scope read');
    const after = Number(q.get('after') || 0);
    const limit = Math.min(Number(q.get('limit') || 200), 1000);
    const wait = Math.min(Number(q.get('wait') || 0), 30);
    const kinds = q.getAll('kind');
    const collect = () => Object.values(S.records)
      .filter((r) => r.rev > after && kindAllowed(client, r.kind) && (!kinds.length || kinds.some((k) => glob(k, r.kind))))
      .sort((a, b) => a.rev - b.rev);
    let list = collect();
    if (!list.length && wait > 0) {
      await new Promise((resolve) => {
        const timer = setTimeout(done, wait * 1000);
        function done() { clearTimeout(timer); changes.off('change', done); resolve(); }
        changes.on('change', done);
        req.on('close', done);
      });
      list = collect();
    }
    const page = list.slice(0, limit);
    // Nothing to read: the hub's latest rev (below `after` only when the hub lost its data).
    const cursor = page.length ? page[page.length - 1].rev : S.rev;
    return send(res, 200, { changes: page, cursor, more: list.length > limit });
  }

  if (path === '/v1/kinds' && method === 'GET') {
    const by = {};
    for (const r of Object.values(S.records)) {
      if (r.deleted || !kindAllowed(client, r.kind)) continue;
      const k = (by[r.kind] ||= { kind: r.kind, count: 0, sources: {}, first: r.time, last: r.time });
      k.count++; k.first = Math.min(k.first, r.time); k.last = Math.max(k.last, r.time);
      k.sources[r.source] = (k.sources[r.source] || 0) + 1;
    }
    return send(res, 200, { kinds: Object.values(by).map((k) => ({ ...k, sources: Object.entries(k.sources).map(([id, count]) => ({ id, name: S.clients[id]?.name, count })) })) });
  }

  if (path === '/v1/blobs/check' && method === 'POST') {
    if (!client.scopes.includes('write') && !client.scopes.includes('admin')) fail(403, 'missing scope write');
    const body = await readJSON(req);
    if (lies > 0) { lies--; return send(res, 200, { missing: [] }); }
    return send(res, 200, { missing: (body.hashes || []).filter((h) => !blobData.has(h)) });
  }

  if ((m = path.match(/^\/v1\/blobs\/([0-9a-f]{64})$/))) {
    const hash = m[1];
    if (method === 'PUT') {
      if (!client.scopes.includes('write') && !client.scopes.includes('admin')) fail(403, 'missing scope write');
      const hasher = crypto.createHash('sha256');
      const chunks = [];
      for await (const c of req) { hasher.update(c); chunks.push(c); }
      const actual = hasher.digest('hex');
      if (actual !== hash) fail(422, 'hash mismatch', { actual });
      const had = blobData.has(hash);
      blobData.set(hash, Buffer.concat(chunks));
      S.blobs[hash] = { type: req.headers['content-type'] || 'application/octet-stream', size: blobData.get(hash).length };
      persist();
      return send(res, had ? 200 : 201, { hash, size: S.blobs[hash].size });
    }
    if (method === 'GET') {
      const named = Object.values(S.records).some((r) => !r.deleted && kindAllowed(client, r.kind) && (r.blobs || []).some((b) => b.hash === hash));
      if (!blobData.has(hash) || !named) fail(404, 'no such blob');
      if (q.has('thumb')) fail(404, 'no thumbnails in the mock hub');
      let data = blobData.get(hash);
      if (corrupt.has(hash)) data = Buffer.from(data.map((b) => b ^ 0xff));
      const headers = { 'Content-Type': S.blobs[hash].type, ETag: `"${hash}"`, 'Cache-Control': 'private, max-age=31536000, immutable', 'Accept-Ranges': 'bytes' };
      const range = req.headers.range && req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
      if (range) {
        const start = range[1] ? Number(range[1]) : data.length - Number(range[2]);
        const end = range[1] && range[2] ? Number(range[2]) : data.length - 1;
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
        return res.end(data.subarray(start, end + 1));
      }
      res.writeHead(200, { ...headers, 'Content-Length': data.length });
      return res.end(data);
    }
  }

  if (path === '/v1/embed' && method === 'POST') {
    if (!client.scopes.includes('search') && !client.scopes.includes('admin')) fail(403, 'missing scope search');
    const body = await readJSON(req);
    if (!S.worker) { res.setHeader('Retry-After', '30'); fail(503, 'no worker connected'); }
    const dim = Number(body.dim || 768);
    if (![768, 512, 256, 128].includes(dim)) fail(400, 'dim: 768, 512, 256 or 128');
    return send(res, 200, { model: S.model, dim, vectors: (body.inputs || []).map((t) => b64(truncate(embedText(t), dim))) });
  }

  if (path === '/v1/vectors' && method === 'GET') {
    const after = Number(q.get('after') || 0);
    const dim = Number(q.get('dim') || 256);
    const limit = Math.min(Number(q.get('limit') || 500), 2000);
    const list = S.vectors.filter((e) => e.vrev > after && (!S.records[e.record] || kindAllowed(client, S.records[e.record].kind)));
    const page = list.slice(0, limit);
    return send(res, 200, { model: S.model, dim,
      vectors: page.map((e) => ({ record: e.record, part: e.part, vector: e.vector ? b64(truncate(unb64(e.vector), dim)) : null, vrev: e.vrev })),
      cursor: page.length ? page[page.length - 1].vrev : after, more: list.length > limit });
  }

  if (path === '/v1/search' && method === 'POST') {
    const body = await readJSON(req);
    const mode = body.mode === 'auto' || !body.mode ? (S.worker ? 'semantic' : 'keyword') : body.mode;
    if (mode === 'semantic' && !S.worker) fail(503, 'no worker connected');
    const live = Object.values(S.records).filter((r) => !r.deleted && kindAllowed(client, r.kind));
    let results;
    if (mode === 'semantic') {
      const qv = embedText(body.query);
      const best = {};
      for (const e of S.vectors) {
        if (!e.vector) continue;
        const v = unb64(e.vector); let s = 0; for (let i = 0; i < 768; i++) s += v[i] * qv[i];
        if (!best[e.record] || best[e.record].score < s) best[e.record] = { score: s, part: e.part };
      }
      results = live.filter((r) => best[r.id]).map((r) => ({ record: r, ...best[r.id] }));
    } else {
      const words = String(body.query || '').toLowerCase().match(/[a-z0-9]+/g) || [];
      results = live.map((r) => { const t = searchable(r).toLowerCase(); const hits = words.filter((w) => t.includes(w)).length; return { record: r, score: words.length ? hits / words.length : 0, part: 'record' }; })
        .filter((x) => x.score > 0);
    }
    results.sort((a, b) => b.score - a.score);
    return send(res, 200, { mode, results: results.slice(0, body.limit || 20) });
  }

  fail(404, `no route ${method} ${path}`);
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (e) {
    if (e instanceof HttpError) {
      if (!res.headersSent) send(res, e.status, { error: { code: e.code, message: e.message, details: e.details || {} } });
    } else {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: { code: 'internal', message: String(e) } });
    }
  }
});
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 5_000;

let bonjour = null;
server.listen(PORT, HOST, () => {
  const port = server.address().port;
  console.log(`LISTENING ${port}`);
  for (const [code] of Object.entries(S.codes)) log('pairing code', code.slice(0, 4) + '-' + code.slice(4));
  if (flag('bonjour')) {
    bonjour = spawn('dns-sd', ['-R', S.hub.name, '_fractonica-hub._tcp', 'local', String(port), `id=${S.hub.id}`, `version=${S.hub.version}`], { stdio: 'ignore' });
    log('advertising _fractonica-hub._tcp on', port);
  }
});
function shutdown() { if (bonjour) bonjour.kill(); persist(); process.exit(0); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.stdin.on('end', () => { if (flag('exit-on-stdin-close')) shutdown(); });
if (flag('exit-on-stdin-close')) process.stdin.resume();
