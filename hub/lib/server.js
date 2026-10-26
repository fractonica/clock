// HTTP for the hub: the /v1 API (hub/API.md), Server-Sent Events and the web UI. node:http only.
import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { HubError, bad, unauthorized, notFound, tooLarge, unavailable, matchesAny } from './util.js';
import { openHub } from './hub.js';
import { openBlobs } from './blobs.js';
import { lanAddress } from './lan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..', 'web');
const REPO = join(HERE, '..', '..');
/** Files of the web app the hub UI imports for its live clock (served read-only). */
const CORE = {
  '/fx/fractonica.js': join(REPO, 'fractonica.js'),
  '/fx/model.js': join(REPO, 'src/core/model.js'),
  '/fx/pure.js': join(REPO, 'src/core/pure.js'),
};
/** The printable diary's astronomy (`/fx/astro/<module>.js`): the UI reads its EVENT_INFO for the sky tags. */
const ASTRO = join(REPO, 'src/diary/astro');
const ASTRO_RE = /^\/fx\/astro\/([a-z0-9-]+\.js)$/;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const HASH_RE = /^[0-9a-f]{64}$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, If-None-Match',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'ETag, Content-Range, Content-Length, Retry-After',
  'Access-Control-Max-Age': '600',
};

function send(res, status, body, headers = {}) {
  const json = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json);
}

async function readJSON(req, limit) {
  const len = Number(req.headers['content-length'] ?? 0);
  if (len > limit) throw tooLarge(`the body is larger than ${limit} bytes`);
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw tooLarge(`the body is larger than ${limit} bytes`);
    chunks.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw bad('the body is not valid JSON');
  }
}

/** Waits until `ready()` is true, an event fires, the deadline passes or the client goes away. */
async function waitUntil(ready, seconds, emitter, names, req) {
  const deadline = Date.now() + seconds * 1000;
  names = [...names, 'closing'];
  while (!emitter.closing && !ready() && Date.now() < deadline && !req.destroyed) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), deadline - Date.now());
    const onClose = () => ac.abort();
    req.once('close', onClose);
    try {
      await Promise.race(names.map((n) => once(emitter, n, { signal: ac.signal })));
    } catch {
      // timeout or the client closed
    } finally {
      clearTimeout(t);
      req.off('close', onClose);
      ac.abort();
    }
  }
}

/**
 * Starts the hub. Options: `dir` (data directory), `port` (0 = ephemeral), `host`, `publicUrl` (base URL for pairing
 * links; default the LAN address), `blobGcInterval` (seconds), plus openHub options. Resolves to
 * { hub, blobs, server, port, url, close() }.
 */
export async function startHub(opts = {}) {
  const dir = opts.dir ?? join(HERE, '..', 'data');
  let port = opts.port ?? 8787;
  const publicUrl = () => opts.publicUrl ?? `http://${lanAddress() ?? 'localhost'}:${port}`;
  const hub = openHub(dir, { ...opts, publicUrl });
  const blobs = openBlobs(dir, { maxSize: opts.maxBlobSize });
  const sse = new Set();

  async function handle(req, res) {
    const url = new URL(req.url, 'http://hub');
    const path = url.pathname;
    const method = req.method;
    if (!path.startsWith('/v1')) return serveStatic(req, res, path);
    if (hub.events.closing) throw unavailable('the hub is shutting down', 5);
    if (method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    const p = url.searchParams;
    const query = (k) => p.get(k) ?? undefined;
    const all = (k) => p.getAll(k);
    const seg = path.split('/').filter(Boolean).slice(1).map(decodeURIComponent); // after "v1"

    if (seg.length === 0 && method === 'GET') return send(res, 200, hub.info());
    if (seg[0] === 'pair' && seg.length === 1 && method === 'POST') {
      const body = await readJSON(req, 64 * 1024);
      return send(res, 201, hub.redeem(body, req.socket.remoteAddress));
    }

    // everything else needs a token; EventSource and <img>/<video> cannot set headers, so those take ?token=
    const auth = req.headers.authorization ?? '';
    let token = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
    if (!token && (method === 'GET' || method === 'HEAD') && (seg[0] === 'events' || seg[0] === 'blobs')) token = query('token');
    const client = hub.authenticate(token);
    if (!client) throw unauthorized();
    const admin = () => hub.need(client, 'admin');

    switch (seg[0]) {
      case 'me':
        if (method === 'GET' && seg.length === 1) return send(res, 200, client);
        break;
      case 'clients':
        admin();
        if (seg.length === 1 && method === 'GET') return send(res, 200, { clients: hub.listClients() });
        if (seg.length === 2 && method === 'PATCH') return send(res, 200, hub.patchClient(seg[1], await readJSON(req, 64 * 1024)));
        if (seg.length === 2 && method === 'DELETE') {
          const out = hub.revokeClient(seg[1]);
          for (const s of sse) if (s.client.id === seg[1]) s.res.end();
          return send(res, 200, out);
        }
        break;
      case 'pairings':
        admin();
        if (seg.length === 1 && method === 'POST') return send(res, 201, hub.createPairing(await readJSON(req, 64 * 1024)));
        break;
      case 'records':
        if (seg.length === 1 && method === 'GET')
          return send(res, 200, hub.listRecords(client, {
            kind: all('kind'), source: all('source'), tag: all('tag'), since: query('since'), until: query('until'),
            q: query('q'), limit: query('limit'), cursor: query('cursor'),
          }));
        if (seg.length === 2 && seg[1] === 'batch' && method === 'POST')
          return send(res, 200, hub.batch(client, await readJSON(req, 256 * 1024 * 1024)));
        if (seg.length === 2 && method === 'GET') return send(res, 200, hub.getRecord(client, seg[1]));
        if (seg.length === 2 && method === 'PUT') {
          const { status, record } = hub.putRecord(client, seg[1], await readJSON(req, 8 * 1024 * 1024));
          return send(res, status, record);
        }
        if (seg.length === 2 && method === 'DELETE') {
          const { status, record } = hub.deleteRecord(client, seg[1]);
          return send(res, status, record);
        }
        break;
      case 'changes':
        if (seg.length === 1 && method === 'GET') {
          const args = { after: query('after'), kind: all('kind'), limit: query('limit') };
          const wait = Math.max(0, Math.min(30, Number(query('wait') ?? 0) || 0));
          let out = hub.changes(client, args);
          if (!out.changes.length && wait > 0) {
            await waitUntil(() => (out = hub.changes(client, args)).changes.length > 0, wait, hub.events, ['change'], req);
            if (hub.events.closing) out = { ...out, changes: [] };
          }
          return send(res, 200, out);
        }
        break;
      case 'kinds':
        if (seg.length === 1 && method === 'GET') return send(res, 200, hub.kinds(client));
        break;
      case 'blobs':
        if (seg.length === 2 && seg[1] === 'check' && method === 'POST') return send(res, 200, hub.missingBlobs(client, await readJSON(req, 4 * 1024 * 1024)));
        if (seg.length === 2 && HASH_RE.test(seg[1])) {
          if (method === 'PUT') return putBlob(req, res, client, seg[1]);
          if (method === 'GET' || method === 'HEAD') return getBlob(req, res, client, seg[1], query('thumb'));
        }
        if (seg.length === 2 && method !== 'POST') throw bad('a blob is named by its lowercase hex SHA-256');
        break;
      case 'search':
        if (seg.length === 1 && method === 'POST') return send(res, 200, await hub.search(client, await readJSON(req, 1024 * 1024)));
        break;
      case 'embed':
        if (seg.length === 1 && method === 'POST') return send(res, 200, await hub.embed(client, await readJSON(req, 1024 * 1024)));
        break;
      case 'vectors':
        if (seg.length === 1 && method === 'GET')
          return send(res, 200, hub.vectorsFeed(client, { after: query('after'), dim: query('dim'), kind: all('kind'), limit: query('limit') }));
        break;
      case 'worker':
        if (seg.length === 1 && method === 'GET') {
          admin();
          return send(res, 200, hub.workerStatus());
        }
        if (seg[1] === 'retry' && seg.length === 2 && method === 'POST') {
          admin();
          return send(res, 200, hub.retryParked());
        }
        if (seg[1] === 'heartbeat' && seg.length === 2 && method === 'POST') return send(res, 200, hub.heartbeat(client, await readJSON(req, 64 * 1024)));
        if (seg[1] === 'jobs' && seg.length === 2 && method === 'GET') {
          const max = Math.max(1, Math.min(64, Number(query('max') ?? 8) || 8));
          const wait = Math.max(0, Math.min(30, Number(query('wait') ?? 0) || 0));
          let out = hub.takeJobs(client, max);
          if (!out.jobs.length && wait > 0) {
            await waitUntil(() => hub.hasQueuedJobs(), wait, hub.events, ['job'], req);
            if (!req.destroyed && !hub.events.closing) out = hub.takeJobs(client, max);
          }
          if (req.destroyed) return; // a job leased to a vanished poll goes back to the queue when its lease ends
          return send(res, 200, out);
        }
        if (seg[1] === 'jobs' && seg.length === 3 && method === 'POST')
          return send(res, 200, hub.finishJob(client, seg[2], await readJSON(req, 64 * 1024 * 1024)));
        break;
      case 'events':
        if (seg.length === 1 && method === 'GET') return events(req, res, client);
        break;
    }
    throw notFound(`no route for ${method} ${path}`);
  }

  async function putBlob(req, res, client, hash) {
    hub.need(client, 'write');
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim() || 'application/octet-stream';
    const length = req.headers['content-length'] !== undefined ? Number(req.headers['content-length']) : undefined;
    let r;
    try {
      r = await blobs.put(hash, req, { length });
    } catch (e) {
      if (e instanceof HubError) res.setHeader('Connection', 'close');
      throw e;
    }
    const created = hub.blobAdded(hash, type, r.size);
    return send(res, created ? 201 : 200, { hash, size: r.size, type });
  }

  async function getBlob(req, res, client, hash, thumb) {
    const a = hub.blobAccess(client, hash);
    if (!a || !blobs.exists(hash)) throw notFound('no such blob');
    let file = blobs.path(hash);
    let type = a.type;
    let etag = `"${hash}"`;
    if (thumb !== undefined) {
      const px = Math.max(64, Math.min(2048, Math.round(Number(thumb)) || 0));
      const t = await blobs.thumb(hash, px, a.type);
      if (!t) throw notFound('cannot make a thumbnail of this blob');
      file = t;
      type = 'image/jpeg';
      etag = `"${hash}-${px}"`;
    }
    const size = statSync(file).size;
    const headers = {
      ...CORS, 'Content-Type': type, ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable', 'Accept-Ranges': 'bytes',
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    let start = 0;
    let end = size - 1;
    let status = 200;
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m && (m[1] !== '' || m[2] !== '')) {
        if (m[1] === '') start = Math.max(0, size - Number(m[2]));
        else {
          start = Number(m[1]);
          end = m[2] === '' ? size - 1 : Math.min(size - 1, Number(m[2]));
        }
        if (start > end || start >= size) {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
          return res.end();
        }
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      }
    }
    headers['Content-Length'] = String(size ? end - start + 1 : 0);
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || size === 0) return res.end();
    createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  }

  function events(req, res, client) {
    hub.need(client, 'read');
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 3000\n\n`);
    const emit = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    const kindsOk = (k) => matchesAny(k, client.kinds);
    const on = {
      change: (d) => kindsOk(d.kind) && emit('change', d),
      vector: (d) => emit('vector', d),
      worker: (d) => emit('worker', d),
      model: (d) => emit('model', d),
      clients: () => client.scopes.includes('admin') && emit('clients', {}),
    };
    for (const [k, fn] of Object.entries(on)) hub.events.on(k, fn);
    emit('worker', { connected: hub.workerConnected() });
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    const entry = { client, res };
    sse.add(entry);
    req.on('close', () => {
      clearInterval(ping);
      for (const [k, fn] of Object.entries(on)) hub.events.off(k, fn);
      sse.delete(entry);
    });
  }

  function serveStatic(req, res, path) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    let file = CORE[path];
    const astro = ASTRO_RE.exec(path);
    if (!file && astro && existsSync(join(ASTRO, astro[1]))) file = join(ASTRO, astro[1]);
    if (!file) {
      const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
      file = join(WEB, rel);
      if (!file.startsWith(WEB) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
      }
    }
    const body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  const server = createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (e instanceof HubError) {
        const headers = e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {};
        return send(res, e.status, { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, headers);
      }
      console.error(e);
      send(res, 500, { error: { code: 'internal', message: String(e?.message ?? e) } });
    }
  });
  server.requestTimeout = 0; // big uploads over Wi-Fi
  server.keepAliveTimeout = 65000;
  server.listen(port, opts.host ?? '0.0.0.0');
  await once(server, 'listening');
  port = server.address().port;
  hub.setMeta('port', port);

  const gc = () => {
    for (const h of hub.collectBlobs()) blobs.remove(h);
  };
  const gcTimer = setInterval(gc, (opts.blobGcInterval ?? 3600) * 1000);
  gcTimer.unref();
  gc();

  async function close() {
    hub.events.closing = true;
    hub.events.emit('closing');
    clearInterval(gcTimer);
    for (const s of sse) s.res.end();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(() => r()));
    hub.close();
  }
  return { hub, blobs, server, port, url: `http://localhost:${port}`, publicUrl, close, gc };
}

