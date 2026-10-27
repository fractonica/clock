// The hub's state and rules: clients and pairing, records with last-writer-wins, blob bookkeeping, the embedding job
// queue, vectors and search. Everything lives in one SQLite file (node:sqlite); blob bytes live on disk (blobs.js).
// HTTP is in server.js; this module never sees a request.
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  now as realNow, ulid, sha256, newToken, newCode, normCode, showCode, matchesAny, GLOB_RE, fold, terms, isObj,
  bad, forbidden, notFound, conflict, unprocessable, rateLimited, unavailable, HubError,
  decodeVector, encodeVector, truncateNormalize, dot,
} from './util.js';
import { normalizeRecord, contentHash, searchable, embeddingInput, ID_RE } from './records.js';
import { fxOf, FX_VERSION } from './fx.js';

export const VERSION = '1.0.0';
export const SCOPES = ['read', 'write', 'search', 'worker', 'admin'];
export const CLIENT_KINDS = ['device', 'service', 'worker', 'browser'];
export const DIMS = [768, 512, 256, 128];
export const DEFAULT_MODEL = 'google/embeddinggemma-2';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, platform TEXT, device TEXT,
  scopes TEXT NOT NULL, kinds TEXT NOT NULL, token_hash TEXT UNIQUE, created REAL NOT NULL, last_seen REAL,
  revoked REAL);
CREATE TABLE IF NOT EXISTS pairings (
  code_hash TEXT PRIMARY KEY, name TEXT, kind TEXT, scopes TEXT NOT NULL, kinds TEXT NOT NULL,
  created REAL NOT NULL, expires REAL NOT NULL, setup INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, time REAL NOT NULL, end_time REAL, zone TEXT, data TEXT NOT NULL,
  text TEXT, tags TEXT NOT NULL, blobs TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL,
  deleted INTEGER NOT NULL, source TEXT NOT NULL, editor TEXT NOT NULL, rev INTEGER NOT NULL UNIQUE, fx TEXT,
  search TEXT NOT NULL, chash TEXT NOT NULL, esig TEXT);
CREATE INDEX IF NOT EXISTS records_time ON records (deleted, time DESC, id DESC);
CREATE INDEX IF NOT EXISTS records_kind ON records (kind);
CREATE INDEX IF NOT EXISTS records_source ON records (source);
CREATE TABLE IF NOT EXISTS record_blobs (record TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (record, hash));
CREATE INDEX IF NOT EXISTS record_blobs_hash ON record_blobs (hash);
CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, type TEXT, size INTEGER NOT NULL, created REAL NOT NULL, seen REAL NOT NULL);
CREATE TABLE IF NOT EXISTS vectors (vrev INTEGER PRIMARY KEY, record TEXT NOT NULL, part TEXT, vec BLOB);
CREATE INDEX IF NOT EXISTS vectors_record ON vectors (record);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, record TEXT NOT NULL UNIQUE, esig TEXT, state TEXT NOT NULL, attempts INTEGER NOT NULL,
  lease_until REAL, leased_by TEXT, error TEXT, queued REAL NOT NULL);
`;

const J = (s, d) => (s == null ? d : JSON.parse(s));

/**
 * Opens (or creates) the hub in `dir`.
 * Options: `clock` (seconds, for tests), `leaseSeconds` (120), `maxAttempts` (3), `workerTimeout` (60 s without a poll
 * or heartbeat), `queryTimeout` (seconds a search waits for the worker), `blobGrace` (24 h), `publicUrl()` (the base
 * URL put in pairing links).
 */
export function openHub(dir, opts = {}) {
  const clock = opts.clock ?? realNow;
  const leaseSeconds = opts.leaseSeconds ?? 120;
  const maxAttempts = opts.maxAttempts ?? 3;
  const workerTimeout = opts.workerTimeout ?? 60;
  const queryTimeout = opts.queryTimeout ?? 30;
  const blobGrace = opts.blobGrace ?? 24 * 3600;
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'hub.sqlite'));
  db.exec(SCHEMA);
  const events = new EventEmitter();
  events.setMaxListeners(0);

  // ---- statements -------------------------------------------------------------------------------------------------
  const cache = new Map();
  const q = (sql) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = db.prepare(sql)));
    return s;
  };
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  // ---- meta ---------------------------------------------------------------------------------------------------------
  const getMeta = (k) => q('SELECT value FROM meta WHERE key = ?').get(k)?.value ?? null;
  const setMeta = (k, v) =>
    v === null
      ? q('DELETE FROM meta WHERE key = ?').run(k)
      : q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
  if (!getMeta('hub_id')) setMeta('hub_id', `h_${ulid()}`);
  // `fx` is derived from `time` for display: when its shape grows (FX_VERSION), recompute it for the stored records once.
  // Not a change of the records (their rev stays): clients that read them again see the new fields.
  if (Number(getMeta('fx_version') ?? 1) < FX_VERSION) {
    tx(() => {
      const put = q('UPDATE records SET fx = ? WHERE id = ?');
      for (const r of q('SELECT id, time FROM records').all()) put.run(JSON.stringify(fxOf(r.time)), r.id);
      setMeta('fx_version', FX_VERSION);
    });
  }
  const hubInfo = () => ({ id: getMeta('hub_id'), name: getMeta('hub_name') ?? 'Fractonica Hub', version: VERSION });

  // ---- clients ------------------------------------------------------------------------------------------------------
  const clientOut = (row) =>
    row && {
      id: row.id, name: row.name, kind: row.kind, platform: row.platform ?? null,
      scopes: J(row.scopes, []), kinds: J(row.kinds, ['*']), created: row.created, lastSeen: row.last_seen ?? null,
      ...(row.revoked ? { revoked: row.revoked } : {}),
    };
  const seen = new Map(); // id -> last time written to the db

  function authenticate(token) {
    if (typeof token !== 'string' || !token) return null;
    const row = q('SELECT * FROM clients WHERE token_hash = ? AND revoked IS NULL').get(sha256(token));
    if (!row) return null;
    const c = clientOut(row);
    const t = clock();
    if (t - (seen.get(c.id) ?? row.last_seen ?? 0) > 30) {
      seen.set(c.id, t);
      q('UPDATE clients SET last_seen = ? WHERE id = ?').run(t, c.id);
    }
    c.lastSeen = t;
    return c;
  }
  const has = (c, scope) => c.scopes.includes(scope);
  const need = (c, scope) => {
    if (!has(c, scope)) throw forbidden(`this client lacks the ${scope} scope`, { scope });
  };

  function checkScopes(scopes) {
    if (!Array.isArray(scopes) || !scopes.every((s) => SCOPES.includes(s))) throw bad(`scopes must be among ${SCOPES.join(', ')}`);
    return [...new Set(scopes)];
  }
  function checkKinds(kinds) {
    if (!Array.isArray(kinds) || !kinds.length || !kinds.every((k) => typeof k === 'string' && GLOB_RE.test(k)))
      throw bad('kinds must be a non-empty list of glob patterns like "journal.*"');
    return [...new Set(kinds)];
  }
  const checkName = (n, d) => {
    if (n === undefined || n === null || n === '') return d;
    if (typeof n !== 'string' || n.length > 120) throw bad('name must be a short string');
    return n.trim() || d;
  };

  function listClients() {
    const counts = new Map(q('SELECT source, count(*) n FROM records WHERE deleted = 0 GROUP BY source').all().map((r) => [r.source, r.n]));
    return q('SELECT * FROM clients ORDER BY created').all().map((row) => ({ ...clientOut(row), records: counts.get(row.id) ?? 0 }));
  }
  function getClient(id) {
    return clientOut(q('SELECT * FROM clients WHERE id = ?').get(id));
  }
  function patchClient(id, body) {
    const row = q('SELECT * FROM clients WHERE id = ?').get(id);
    if (!row) throw notFound('no such client');
    if (!isObj(body)) throw bad('body must be an object');
    const name = checkName(body.name, row.name);
    const scopes = body.scopes === undefined ? J(row.scopes) : checkScopes(body.scopes);
    const kinds = body.kinds === undefined ? J(row.kinds) : checkKinds(body.kinds);
    q('UPDATE clients SET name = ?, scopes = ?, kinds = ? WHERE id = ?').run(name, JSON.stringify(scopes), JSON.stringify(kinds), id);
    return getClient(id);
  }
  function revokeClient(id) {
    const r = q('UPDATE clients SET revoked = ?, token_hash = NULL WHERE id = ? AND revoked IS NULL').run(clock(), id);
    if (!r.changes) throw notFound('no such client');
    return getClient(id);
  }
  /** Makes a client and its token directly (the CLI's `pair --token`, tests). */
  function createClient({ name, kind = 'service', platform = null, device = null, scopes = ['read', 'write', 'search'], kinds = ['*'] }) {
    if (!CLIENT_KINDS.includes(kind)) throw bad(`kind must be one of ${CLIENT_KINDS.join(', ')}`);
    const token = newToken();
    const id = `c_${ulid()}`;
    q('INSERT INTO clients (id, name, kind, platform, device, scopes, kinds, token_hash, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, checkName(name, 'Client'), kind, platform, device, JSON.stringify(checkScopes(scopes)), JSON.stringify(checkKinds(kinds)),
      sha256(token), clock(),
    );
    return { client: getClient(id), token };
  }

  // ---- pairing ------------------------------------------------------------------------------------------------------
  function pairLink(code) {
    const base = opts.publicUrl?.() ?? `http://localhost:${getMeta('port') ?? 8787}`;
    return `fractonica://pair?hub=${encodeURIComponent(base)}&code=${showCode(code)}`;
  }
  function createPairing(body = {}) {
    if (!isObj(body)) throw bad('body must be an object');
    const scopes = body.scopes === undefined ? ['read', 'write', 'search'] : checkScopes(body.scopes);
    const kinds = body.kinds === undefined ? ['*'] : checkKinds(body.kinds);
    const ttl = body.ttl === undefined ? 600 : Number(body.ttl);
    if (!(ttl >= 30 && ttl <= 30 * 86400)) throw bad('ttl must be 30 s … 30 days');
    if (body.kind !== undefined && !CLIENT_KINDS.includes(body.kind)) throw bad(`kind must be one of ${CLIENT_KINDS.join(', ')}`);
    const code = newCode();
    const t = clock();
    q('DELETE FROM pairings WHERE expires < ?').run(t);
    q('INSERT INTO pairings (code_hash, name, kind, scopes, kinds, created, expires, setup) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      sha256(code), checkName(body.name, null), body.kind ?? null, JSON.stringify(scopes), JSON.stringify(kinds), t, t + ttl, body.setup ? 1 : 0,
    );
    return { code: showCode(code), expires: t + ttl, link: pairLink(code) };
  }

  const failures = new Map(); // address -> [times]
  function redeem(body, address = '?') {
    const t = clock();
    const recent = (failures.get(address) ?? []).filter((x) => t - x < 60);
    failures.set(address, recent);
    if (recent.length >= 10) throw rateLimited('too many wrong codes; wait a minute');
    if (!isObj(body)) throw bad('body must be an object');
    const code = normCode(body.code);
    const row = code.length === 8 ? q('SELECT * FROM pairings WHERE code_hash = ?').get(sha256(code)) : null;
    if (!row || row.expires < t) {
      recent.push(t);
      throw notFound('unknown or expired code');
    }
    const kind = body.kind ?? row.kind ?? 'device';
    if (!CLIENT_KINDS.includes(kind)) throw bad(`kind must be one of ${CLIENT_KINDS.join(', ')}`);
    const name = checkName(body.name, row.name ?? 'Device');
    const platform = typeof body.platform === 'string' ? body.platform.slice(0, 120) : null;
    const device = typeof body.device === 'string' && body.device ? body.device.slice(0, 200) : null;
    const token = newToken();
    const out = tx(() => {
      q('DELETE FROM pairings WHERE code_hash = ?').run(row.code_hash);
      const prior = device ? q('SELECT id FROM clients WHERE device = ? AND revoked IS NULL').get(device) : null;
      if (prior) {
        q('UPDATE clients SET name = ?, kind = ?, platform = ?, scopes = ?, kinds = ?, token_hash = ?, last_seen = ? WHERE id = ?').run(
          name, kind, platform, row.scopes, row.kinds, sha256(token), t, prior.id,
        );
        return prior.id;
      }
      const id = `c_${ulid()}`;
      q('INSERT INTO clients (id, name, kind, platform, device, scopes, kinds, token_hash, created, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, name, kind, platform, device, row.scopes, row.kinds, sha256(token), t, t,
      );
      return id;
    });
    const c = getClient(out);
    events.emit('clients');
    return { client: { id: c.id, name: c.name, kind: c.kind, scopes: c.scopes, kinds: c.kinds }, token, hub: hubInfo() };
  }

  /** On a hub without an admin client: a one-time code that makes the first browser an admin (null otherwise). */
  function setupCode() {
    const admins = q("SELECT scopes FROM clients WHERE revoked IS NULL").all().filter((r) => J(r.scopes, []).includes('admin'));
    if (admins.length) return null;
    q('DELETE FROM pairings WHERE setup = 1').run();
    return createPairing({ name: 'Browser', kind: 'browser', scopes: ['read', 'write', 'search', 'admin'], ttl: 7 * 86400, setup: true }).code;
  }

  // ---- kinds filters ------------------------------------------------------------------------------------------------
  /** SQL for "kind matches one of the client's kinds and (if given) one of the requested globs". */
  function kindSQL(client, requested, col = 'kind') {
    const parts = [];
    const params = [];
    for (const set of [client.kinds, requested]) {
      if (!set || !set.length || set.includes('*')) continue;
      parts.push(`(${set.map(() => `${col} GLOB ?`).join(' OR ')})`);
      params.push(...set);
    }
    return { sql: parts.length ? parts.join(' AND ') : '1', params };
  }
  const canSeeKind = (client, kind) => matchesAny(kind, client.kinds);
  function checkGlobs(list, what = 'kind') {
    const l = [].concat(list ?? []).filter((x) => x !== '');
    for (const g of l) if (!GLOB_RE.test(g)) throw bad(`${what} must be a kind or a glob like journal.*`);
    return l;
  }

  // ---- records ------------------------------------------------------------------------------------------------------
  const recordOut = (row) =>
    row && {
      id: row.id, kind: row.kind, time: row.time, end: row.end_time ?? null, zone: row.zone ?? null, data: J(row.data, {}),
      text: row.text ?? null, tags: J(row.tags, []), blobs: J(row.blobs, []), created: row.created, updated: row.updated,
      deleted: !!row.deleted, source: row.source, editor: row.editor, rev: row.rev, fx: J(row.fx, null),
    };
  const getRow = (id) => q('SELECT * FROM records WHERE id = ?').get(id);
  const maxRev = () => q('SELECT coalesce(max(rev), 0) m FROM records').get().m;

  /** Decides one write (hub/API.md § Writing) inside the caller's transaction. Returns { status, record, changed }. */
  function writeOne(client, id, body) {
    need(client, 'write');
    const inc = normalizeRecord(id, body);
    if (!canSeeKind(client, inc.kind)) throw forbidden(`this client may not write ${inc.kind}`, { kind: inc.kind });
    const cur = getRow(id);
    if (cur) {
      if (!canSeeKind(client, cur.kind)) throw forbidden(`this client may not write ${cur.kind}`, { kind: cur.kind });
      const journal = cur.kind.startsWith('journal.') && inc.kind.startsWith('journal.');
      if (cur.source !== client.id && !has(client, 'admin') && !journal)
        throw forbidden('this record belongs to another client');
    }
    const chash = contentHash(inc);
    if (cur) {
      const current = () => recordOut(cur);
      if (cur.updated > inc.updated) throw conflict('the hub has a newer version', { current: current() });
      if (cur.updated === inc.updated) {
        if (cur.chash === chash) return { status: 200, record: current(), changed: false };
        if (chash < cur.chash) throw conflict('same updated, the hub keeps its version (tie break)', { current: current() });
      }
    }
    if (!inc.deleted) {
      const hashes = [...new Set(inc.blobs.map((b) => b.hash))];
      const missing = hashes.filter((h) => !q('SELECT 1 FROM blobs WHERE hash = ?').get(h));
      if (missing.length) throw unprocessable('upload the blobs first', { missing });
    }
    return { status: cur ? 200 : 201, record: store(client, inc, cur, chash), changed: true };
  }

  function store(client, r, cur, chash) {
    const rev = maxRev() + 1;
    const t = clock();
    const { title, body } = searchable(r);
    const input = r.deleted ? null : embeddingInput(r);
    const esig = input?.sig ?? null;
    q(`INSERT INTO records (id, kind, time, end_time, zone, data, text, tags, blobs, created, updated, deleted, source, editor, rev, fx, search, chash, esig)
       VALUES ($id, $kind, $time, $end, $zone, $data, $text, $tags, $blobs, $created, $updated, $deleted, $source, $editor, $rev, $fx, $search, $chash, $esig)
       ON CONFLICT(id) DO UPDATE SET kind = $kind, time = $time, end_time = $end, zone = $zone, data = $data, text = $text,
         tags = $tags, blobs = $blobs, created = $created, updated = $updated, deleted = $deleted, editor = $editor,
         rev = $rev, fx = $fx, search = $search, chash = $chash, esig = $esig`).run({
      $id: r.id, $kind: r.kind, $time: r.time, $end: r.end, $zone: r.zone, $data: JSON.stringify(r.data), $text: r.text,
      $tags: JSON.stringify(r.tags), $blobs: JSON.stringify(r.blobs), $created: r.created, $updated: r.updated,
      $deleted: r.deleted ? 1 : 0, $source: cur?.source ?? client.id, $editor: client.id, $rev: rev,
      $fx: JSON.stringify(fxOf(r.time)), $search: r.deleted ? '' : fold(`${title}\n${body}`), $chash: chash, $esig: esig,
    });
    // blob references (live records only); a hash that loses its last reference starts its grace period now
    const before = q('SELECT hash FROM record_blobs WHERE record = ?').all(r.id).map((x) => x.hash);
    q('DELETE FROM record_blobs WHERE record = ?').run(r.id);
    if (!r.deleted) {
      for (const b of r.blobs) {
        q('INSERT OR IGNORE INTO record_blobs (record, hash) VALUES (?, ?)').run(r.id, b.hash);
        q("UPDATE blobs SET type = ? WHERE hash = ? AND (type IS NULL OR type = '' OR type = 'application/octet-stream')").run(b.type, b.hash);
      }
    }
    for (const h of before) q('UPDATE blobs SET seen = ? WHERE hash = ?').run(t, h);
    // vectors: keep them when what the worker would embed is unchanged
    const unchanged = cur && !cur.deleted && esig && cur.esig === esig;
    if (!unchanged) {
      dropVectors(r.id);
      if (esig) enqueue(r.id, esig);
      else q('DELETE FROM jobs WHERE record = ?').run(r.id);
    }
    const out = recordOut(getRow(r.id));
    pendingEvents.push(['change', { rev, id: r.id, kind: r.kind, deleted: r.deleted }]);
    return out;
  }

  let pendingEvents = [];
  const flush = () => {
    const evs = pendingEvents;
    pendingEvents = [];
    for (const [name, data] of evs) events.emit(name, data);
  };
  const run = (fn) => {
    try {
      return tx(fn);
    } catch (e) {
      pendingEvents = [];
      throw e;
    } finally {
      flush();
    }
  };

  const putRecord = (client, id, body) => run(() => writeOne(client, id, body));

  function batch(client, body) {
    need(client, 'write');
    if (!isObj(body) || !Array.isArray(body.records)) throw bad('body must be { "records": [...] }');
    if (body.records.length > 500) throw bad('at most 500 records per batch');
    return run(() => ({
      results: body.records.map((r) => {
        const id = isObj(r) ? r.id : undefined;
        try {
          const { status, record } = writeOne(client, id, r);
          return { id, status, record };
        } catch (e) {
          if (!(e instanceof HubError)) throw e;
          return { id, status: e.status, error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } };
        }
      }),
    }));
  }

  function deleteRecord(client, id) {
    need(client, 'write');
    return run(() => {
      const cur = getRow(id);
      if (!cur || !canSeeKind(client, cur.kind)) throw notFound('no such record');
      if (cur.deleted) return { status: 200, record: recordOut(cur) };
      // a tombstone must win: "now", or just after the stored version if that is ahead of the hub's clock
      const updated = Math.max(clock(), cur.updated + 0.001);
      const { record } = writeOne(client, id, { kind: cur.kind, time: cur.time, end: cur.end_time, zone: cur.zone, created: cur.created, updated, deleted: true });
      return { status: 200, record };
    });
  }

  function getRecord(client, id) {
    need(client, 'read');
    const row = ID_RE.test(id) ? getRow(id) : null;
    if (!row || !canSeeKind(client, row.kind)) throw notFound('no such record');
    return recordOut(row);
  }

  const encCursor = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const decCursor = (s) => {
    try {
      return JSON.parse(Buffer.from(String(s), 'base64url').toString());
    } catch {
      throw bad('bad cursor');
    }
  };
  const clampInt = (v, d, lo, hi, what) => {
    if (v === undefined || v === null || v === '') return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw bad(`${what} must be a number`);
    return Math.max(lo, Math.min(hi, Math.floor(n)));
  };
  const optNum = (v, what) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw bad(`${what} must be Unix seconds`);
    return n;
  };

  /** GET /v1/records: newest time first, tombstones left out. */
  function listRecords(client, p = {}) {
    need(client, 'read');
    const limit = clampInt(p.limit, 50, 1, 500, 'limit');
    const k = kindSQL(client, checkGlobs(p.kind));
    const where = ['deleted = 0', k.sql];
    const params = [...k.params];
    const sources = [].concat(p.source ?? []).filter(Boolean);
    if (sources.length) {
      where.push(`source IN (${sources.map(() => '?').join(',')})`);
      params.push(...sources);
    }
    const since = optNum(p.since, 'since');
    const until = optNum(p.until, 'until');
    if (since !== null) where.push('time >= ?'), params.push(since);
    if (until !== null) where.push('time <= ?'), params.push(until);
    for (const tag of [].concat(p.tag ?? []).filter(Boolean)) {
      where.push('EXISTS (SELECT 1 FROM json_each(records.tags) WHERE value = ?)');
      params.push(tag);
    }
    for (const t of terms(p.q ?? '')) where.push('instr(search, ?) > 0'), params.push(t);
    if (p.cursor) {
      const [t, id] = decCursor(p.cursor);
      where.push('(time < ? OR (time = ? AND id < ?))');
      params.push(t, t, id);
    }
    const rows = q(`SELECT * FROM records WHERE ${where.join(' AND ')} ORDER BY time DESC, id DESC LIMIT ?`).all(...params, limit + 1);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { records: page.map(recordOut), cursor: last ? encCursor([last.time, last.id]) : null, more };
  }

  /** GET /v1/changes: oldest change first, tombstones included. */
  function changes(client, p = {}) {
    need(client, 'read');
    const after = clampInt(p.after, 0, 0, Number.MAX_SAFE_INTEGER, 'after');
    const limit = clampInt(p.limit, 200, 1, 1000, 'limit');
    const top = maxRev();
    const k = kindSQL(client, checkGlobs(p.kind));
    const rows = q(`SELECT * FROM records WHERE rev > ? AND ${k.sql} ORDER BY rev LIMIT ?`).all(after, ...k.params, limit + 1);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return { changes: page.map(recordOut), cursor: more ? page.at(-1).rev : Math.max(after, top), more };
  }

  function kinds(client) {
    need(client, 'read');
    const names = new Map(q('SELECT id, name FROM clients').all().map((r) => [r.id, r.name]));
    const by = new Map();
    for (const r of q('SELECT kind, source, count(*) n, min(time) first, max(time) last FROM records WHERE deleted = 0 GROUP BY kind, source').all()) {
      if (!canSeeKind(client, r.kind)) continue;
      let k = by.get(r.kind);
      if (!k) by.set(r.kind, (k = { kind: r.kind, count: 0, sources: [], first: r.first, last: r.last }));
      k.count += r.n;
      k.first = Math.min(k.first, r.first);
      k.last = Math.max(k.last, r.last);
      k.sources.push({ id: r.source, name: names.get(r.source) ?? r.source, count: r.n });
    }
    return { kinds: [...by.values()].sort((a, b) => b.count - a.count) };
  }

  // ---- blobs (bookkeeping; bytes are in blobs.js) -------------------------------------------------------------------
  const blobRow = (hash) => q('SELECT * FROM blobs WHERE hash = ?').get(hash);
  function missingBlobs(client, body) {
    need(client, 'write');
    if (!isObj(body) || !Array.isArray(body.hashes) || body.hashes.length > 10000) throw bad('body must be { "hashes": [...] }');
    const hashes = body.hashes.map((h) => String(h).toLowerCase());
    return { missing: hashes.filter((h) => !blobRow(h)) };
  }
  function blobAdded(hash, type, size) {
    const t = clock();
    const had = blobRow(hash);
    if (had) q('UPDATE blobs SET seen = ?, type = coalesce(nullif(?, \'application/octet-stream\'), type) WHERE hash = ?').run(t, type || null, hash);
    else q('INSERT INTO blobs (hash, type, size, created, seen) VALUES (?, ?, ?, ?, ?)').run(hash, type || null, size, t, t);
    return !had;
  }
  /** Who may fetch a blob: read + a readable live record naming it; the worker for any live record's blob. */
  function blobAccess(client, hash) {
    const row = blobRow(hash);
    if (!row) return null;
    const kindsOf = q('SELECT r.kind FROM record_blobs b JOIN records r ON r.id = b.record WHERE b.hash = ? AND r.deleted = 0').all(hash).map((x) => x.kind);
    const ok = (has(client, 'worker') && kindsOf.length > 0) || (has(client, 'read') && kindsOf.some((k) => canSeeKind(client, k)));
    return ok ? { hash, type: row.type || 'application/octet-stream', size: row.size } : null;
  }
  /** Hashes no live record has named for the grace period; their rows are removed (the caller deletes the files). */
  function collectBlobs() {
    const t = clock();
    q('UPDATE blobs SET seen = ? WHERE hash IN (SELECT hash FROM record_blobs)').run(t);
    const dead = q('SELECT hash FROM blobs WHERE seen < ? AND hash NOT IN (SELECT hash FROM record_blobs)').all(t - blobGrace).map((r) => r.hash);
    for (const h of dead) q('DELETE FROM blobs WHERE hash = ?').run(h);
    return dead;
  }

  // ---- vectors ------------------------------------------------------------------------------------------------------
  /** In-memory copy of every live vector for brute-force search: record -> [{ part, vec }]. */
  const vecs = new Map();
  const loadVectors = () => {
    vecs.clear();
    for (const r of q('SELECT record, part, vec FROM vectors WHERE part IS NOT NULL').all()) {
      const v = new Float32Array(new Uint8Array(r.vec).buffer.slice(0));
      if (!vecs.has(r.record)) vecs.set(r.record, []);
      vecs.get(r.record).push({ part: r.part, vec: v });
    }
  };
  loadVectors();
  const nextVrev = () => {
    const v = Number(getMeta('vrev') ?? 0) + 1;
    setMeta('vrev', v);
    return v;
  };
  /** Drops a record's vectors; the feed gets one "forget" entry for it (an older forget entry is superseded). */
  function dropVectors(record) {
    const had = q('SELECT count(*) n FROM vectors WHERE record = ? AND part IS NOT NULL').get(record).n;
    if (!had) return;
    q('DELETE FROM vectors WHERE record = ?').run(record);
    const vrev = nextVrev();
    q('INSERT INTO vectors (vrev, record, part, vec) VALUES (?, ?, NULL, NULL)').run(vrev, record);
    vecs.delete(record);
    pendingEvents.push(['vector', { vrev, record }]);
  }
  function storeVectors(record, parts) {
    dropVectors(record);
    const list = [];
    if (!parts.length) return;
    for (const { part, vec } of parts) {
      const vrev = nextVrev();
      q('INSERT INTO vectors (vrev, record, part, vec) VALUES (?, ?, ?, ?)').run(vrev, record, part, new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength));
      list.push({ part, vec });
      pendingEvents.push(['vector', { vrev, record }]);
    }
    vecs.set(record, list);
  }
  const model = () => getMeta('model') ?? DEFAULT_MODEL;
  const modelDim = () => Number(getMeta('dim') ?? 768);

  /** The worker reports a model: a different one than the vectors were made with drops them all and re-embeds. */
  function adoptModel(name) {
    if (typeof name !== 'string' || !name) return;
    const cur = getMeta('model');
    if (cur === name) return;
    setMeta('model', name);
    if (cur === null && !q('SELECT 1 FROM vectors LIMIT 1').get()) return;
    q('DELETE FROM vectors').run();
    setMeta('vrev', 0);
    setMeta('dim', null);
    vecs.clear();
    for (const r of q('SELECT id, esig FROM records WHERE deleted = 0 AND esig IS NOT NULL').all()) enqueue(r.id, r.esig);
    pendingEvents.push(['model', { model: name }]);
  }

  function vectorsFeed(client, p = {}) {
    need(client, 'read');
    const after = clampInt(p.after, 0, 0, Number.MAX_SAFE_INTEGER, 'after');
    const dim = clampInt(p.dim, 256, 1, 4096, 'dim');
    if (!DIMS.includes(dim)) throw bad(`dim must be one of ${DIMS.join(', ')}`);
    const limit = clampInt(p.limit, 500, 1, 2000, 'limit');
    const k = kindSQL(client, checkGlobs(p.kind), 'r.kind');
    const rows = q(`SELECT v.vrev, v.record, v.part, v.vec FROM vectors v JOIN records r ON r.id = v.record
                    WHERE v.vrev > ? AND ${k.sql} ORDER BY v.vrev LIMIT ?`).all(after, ...k.params, limit + 1);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const top = Number(getMeta('vrev') ?? 0);
    return {
      model: model(),
      dim,
      vectors: page.map((r) => ({
        record: r.record,
        part: r.part,
        vector: r.vec ? encodeVector(truncateNormalize(new Float32Array(new Uint8Array(r.vec).buffer.slice(0)), dim)) : null,
        vrev: r.vrev,
      })),
      cursor: more ? page.at(-1).vrev : Math.max(Math.min(after, top), top),
      more,
    };
  }

  // ---- jobs and the worker ------------------------------------------------------------------------------------------
  function enqueue(record, esig) {
    q(`INSERT INTO jobs (id, record, esig, state, attempts, queued) VALUES (?, ?, ?, 'queued', 0, ?)
       ON CONFLICT(record) DO UPDATE SET id = excluded.id, esig = excluded.esig, state = 'queued', attempts = 0,
         lease_until = NULL, leased_by = NULL, error = NULL, queued = excluded.queued`).run(`j_${ulid()}`, record, esig, clock());
    pendingEvents.push(['job', null]);
  }

  const queries = new Map(); // id -> { id, inputs, task, state, attempts, leaseUntil, resolve, reject, timer }
  const worker = { lastSeen: 0, client: null, model: null, device: null, modalities: null, connected: false };
  const workerConnected = () => clock() - worker.lastSeen < workerTimeout;
  function workerSeen(client) {
    worker.lastSeen = clock();
    worker.client = client.id;
    checkWorker();
  }
  function checkWorker() {
    const c = workerConnected();
    if (c !== worker.connected) {
      worker.connected = c;
      events.emit('worker', { connected: c });
      if (!c) for (const j of queries.values()) if (j.state === 'queued') failQuery(j, unavailable('the worker disconnected'));
    }
  }

  function expireLeases() {
    const t = clock();
    for (const j of queries.values()) {
      if (j.state === 'leased' && j.leaseUntil < t) {
        j.attempts += 1;
        if (j.attempts >= maxAttempts) failQuery(j, unavailable('the worker did not finish the query'));
        else j.state = 'queued';
      }
    }
    q(`UPDATE jobs SET attempts = attempts + 1, state = CASE WHEN attempts + 1 >= ? THEN 'parked' ELSE 'queued' END,
         error = CASE WHEN attempts + 1 >= ? THEN 'lease expired' ELSE error END, lease_until = NULL, leased_by = NULL
       WHERE state = 'leased' AND lease_until < ?`).run(maxAttempts, maxAttempts, t);
  }

  /** Leases up to `max` jobs to a worker, query jobs first. */
  function takeJobs(client, max = 8) {
    need(client, 'worker');
    workerSeen(client);
    expireLeases();
    const t = clock();
    const out = [];
    for (const j of queries.values()) {
      if (out.length >= max) break;
      if (j.state !== 'queued') continue;
      j.state = 'leased';
      j.leaseUntil = t + leaseSeconds;
      out.push({ id: j.id, type: 'embed.query', inputs: j.inputs, task: j.task });
    }
    if (out.length < max) {
      const rows = q("SELECT * FROM jobs WHERE state = 'queued' ORDER BY queued LIMIT ?").all(max - out.length);
      for (const row of rows) {
        const rec = getRow(row.record);
        const input = rec && !rec.deleted ? embeddingInput(recordOut(rec)) : null;
        if (!input) {
          q('DELETE FROM jobs WHERE id = ?').run(row.id);
          continue;
        }
        q("UPDATE jobs SET state = 'leased', lease_until = ?, leased_by = ? WHERE id = ?").run(t + leaseSeconds, client.id, row.id);
        out.push({ id: row.id, type: 'embed.record', record: recordOut(rec), text: input.text, media: input.media });
      }
    }
    return { jobs: out };
  }
  const hasQueuedJobs = () =>
    [...queries.values()].some((j) => j.state === 'queued') || !!q("SELECT 1 FROM jobs WHERE state = 'queued' LIMIT 1").get();

  function parseVectors(list, needDim, allowEmpty = false) {
    if (!Array.isArray(list) || (!list.length && !allowEmpty)) throw bad('vectors must be a non-empty list');
    return list.map((v, i) => {
      if (!isObj(v) || typeof v.part !== 'string' || !v.part) throw bad(`vectors[${i}].part is required`);
      const vec = decodeVector(v.vector);
      if (!vec) throw bad(`vectors[${i}].vector must be base64 little-endian float32`);
      if (needDim && vec.length !== needDim) throw bad(`vectors[${i}] has ${vec.length} dimensions, the model has ${needDim}`);
      return { part: v.part, vec: truncateNormalize(vec, vec.length) };
    });
  }

  function finishJob(client, id, body) {
    need(client, 'worker');
    workerSeen(client);
    if (!isObj(body)) throw bad('body must be an object');
    const qj = queries.get(id);
    if (qj) {
      if (body.error !== undefined) {
        qj.attempts += 1;
        if (body.retry !== false && qj.attempts < maxAttempts) qj.state = 'queued';
        else failQuery(qj, unavailable(`the worker failed: ${String(body.error).slice(0, 300)}`));
        return { ok: true };
      }
      run(() => adoptModel(body.model));
      const parts = parseVectors(body.vectors);
      const byPart = new Map(parts.map((p) => [p.part, p.vec]));
      const vectors = qj.inputs.map((_, i) => byPart.get(String(i)));
      if (vectors.some((v) => !v)) throw bad('a query job needs one vector per input, parts "0", "1", …');
      queries.delete(id);
      clearTimeout(qj.timer);
      qj.resolve(vectors);
      return { ok: true };
    }
    return run(() => {
      const row = q('SELECT * FROM jobs WHERE id = ?').get(id);
      if (!row) throw notFound('no such job (the record changed or was deleted; drop it)');
      if (body.error !== undefined) {
        const attempts = row.attempts + 1;
        const park = body.retry === false || attempts >= maxAttempts;
        q('UPDATE jobs SET attempts = ?, state = ?, error = ?, lease_until = NULL, leased_by = NULL WHERE id = ?').run(
          attempts, park ? 'parked' : 'queued', String(body.error).slice(0, 1000), id,
        );
        if (!park) pendingEvents.push(['job', null]);
        return { ok: true };
      }
      adoptModel(body.model);
      const dimKnown = getMeta('dim') ? modelDim() : null;
      // the worker leaves out the parts it could not decode (a broken video, say): fewer parts, even none, are fine
      const parts = parseVectors(body.vectors, dimKnown, true);
      const d = parts[0]?.vec.length;
      if (parts.some((p) => p.vec.length !== d)) throw bad('all vectors must have the same number of dimensions');
      if (!dimKnown && d) setMeta('dim', d);
      const rec = getRow(row.record);
      // a model change re-queued every record (this one too, under a new job id): the job row may be gone
      const still = q('SELECT * FROM jobs WHERE record = ?').get(row.record);
      if (rec && !rec.deleted && rec.esig === row.esig) {
        storeVectors(row.record, parts);
        if (still && (still.id === id || still.esig === row.esig)) q('DELETE FROM jobs WHERE record = ?').run(row.record);
      } else if (still?.id === id) q('DELETE FROM jobs WHERE id = ?').run(id);
      return { ok: true };
    });
  }

  function heartbeat(client, body = {}) {
    need(client, 'worker');
    workerSeen(client);
    if (isObj(body)) {
      if (typeof body.device === 'string') worker.device = body.device;
      if (typeof body.dtype === 'string') worker.dtype = body.dtype;
      if (typeof body.version === 'string') worker.version = body.version;
      if (Array.isArray(body.modalities)) worker.modalities = body.modalities.filter((m) => typeof m === 'string');
      if (typeof body.model === 'string') {
        worker.model = body.model;
        run(() => adoptModel(body.model));
      }
    }
    return { ok: true };
  }

  function failQuery(j, err) {
    queries.delete(j.id);
    clearTimeout(j.timer);
    j.reject(err);
  }
  /** Embeds `inputs` with the worker (a query job): resolves to full-dimension Float32Arrays. */
  function embed(inputs, task = 'query') {
    if (!workerConnected()) return Promise.reject(unavailable('no embedding worker is connected', 30));
    return new Promise((resolve, reject) => {
      const j = { id: `j_${ulid()}`, inputs, task, state: 'queued', attempts: 0, leaseUntil: 0, resolve, reject };
      j.timer = setTimeout(() => failQuery(j, unavailable('the worker did not answer in time', 10)), queryTimeout * 1000);
      queries.set(j.id, j);
      events.emit('job', null);
    });
  }

  function workerStatus() {
    expireLeases();
    const counts = Object.fromEntries(q('SELECT state, count(*) n FROM jobs GROUP BY state').all().map((r) => [r.state, r.n]));
    const parked = q("SELECT j.id, j.record, j.attempts, j.error, r.kind FROM jobs j LEFT JOIN records r ON r.id = j.record WHERE j.state = 'parked' ORDER BY j.queued LIMIT 100").all();
    const vectorCount = q('SELECT count(*) n FROM vectors WHERE part IS NOT NULL').get().n;
    const embedded = vecs.size;
    return {
      connected: workerConnected(),
      lastSeen: worker.lastSeen || null,
      client: worker.client,
      model: model(),
      workerModel: worker.model,
      device: worker.device,
      dtype: worker.dtype ?? null,
      version: worker.version ?? null,
      modalities: worker.modalities,
      dim: getMeta('dim') ? modelDim() : null,
      vrev: Number(getMeta('vrev') ?? 0),
      queue: { queued: counts.queued ?? 0, leased: counts.leased ?? 0, parked: counts.parked ?? 0, queries: queries.size },
      vectors: vectorCount,
      records: embedded,
      parked: parked.map((p) => ({ job: p.id, record: p.record, kind: p.kind ?? null, attempts: p.attempts, error: p.error })),
    };
  }
  function retryParked() {
    const r = run(() => {
      const n = q("UPDATE jobs SET state = 'queued', attempts = 0, error = NULL WHERE state = 'parked'").run().changes;
      if (n) pendingEvents.push(['job', null]);
      return n;
    });
    return { requeued: r };
  }

  // ---- search -------------------------------------------------------------------------------------------------------
  async function search(client, body) {
    need(client, 'search');
    if (!isObj(body)) throw bad('body must be an object');
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) throw bad('query is required');
    const mode = body.mode ?? 'auto';
    if (!['auto', 'semantic', 'keyword'].includes(mode)) throw bad('mode must be auto, semantic or keyword');
    const limit = clampInt(body.limit, 20, 1, 200, 'limit');
    const want = checkGlobs(body.kinds, 'kinds');
    const since = optNum(body.since, 'since');
    const until = optNum(body.until, 'until');
    const useSemantic = mode === 'semantic' || (mode === 'auto' && workerConnected());
    if (!useSemantic) return keywordSearch(client, { query, want, since, until, limit });

    const [qv] = await embed([query], 'query');
    const hits = [];
    const meta = q('SELECT id, kind, time FROM records WHERE deleted = 0');
    const live = new Map(meta.all().map((r) => [r.id, r]));
    for (const [record, parts] of vecs) {
      const r = live.get(record);
      if (!r || !canSeeKind(client, r.kind) || (want.length && !matchesAny(r.kind, want))) continue;
      if ((since !== null && r.time < since) || (until !== null && r.time > until)) continue;
      let best = -2;
      let part = null;
      for (const p of parts) {
        const s = dot(qv, p.vec.length === qv.length ? p.vec : truncateNormalize(p.vec, qv.length));
        if (s > best) (best = s), (part = p.part);
      }
      hits.push({ id: record, score: best, part });
    }
    hits.sort((a, b) => b.score - a.score);
    return {
      mode: 'semantic',
      results: hits.slice(0, limit).map((h) => ({ record: recordOut(getRow(h.id)), score: Math.round(h.score * 10000) / 10000, part: h.part })),
    };
  }

  function keywordSearch(client, { query, want, since, until, limit }) {
    const words = terms(query);
    if (!words.length) return { mode: 'keyword', results: [] };
    const k = kindSQL(client, want);
    const where = ['deleted = 0', k.sql, `(${words.map(() => 'instr(search, ?) > 0').join(' OR ')})`];
    const params = [...k.params, ...words];
    if (since !== null) where.push('time >= ?'), params.push(since);
    if (until !== null) where.push('time <= ?'), params.push(until);
    const rows = q(`SELECT * FROM records WHERE ${where.join(' AND ')} ORDER BY time DESC LIMIT 5000`).all(...params);
    const t = clock();
    const scored = rows.map((row) => {
      let matched = 0;
      let hitsN = 0;
      for (const w of words) {
        const n = row.search.split(w).length - 1;
        if (n) matched += 1;
        hitsN += n;
      }
      const ageDays = Math.max(0, (t - row.time) / 86400);
      const score = 0.7 * (matched / words.length) + 0.15 * Math.min(1, hitsN / (3 * words.length)) + 0.15 / (1 + ageDays / 30);
      return { row, score };
    });
    scored.sort((a, b) => b.score - a.score || b.row.time - a.row.time);
    return {
      mode: 'keyword',
      results: scored.slice(0, limit).map(({ row, score }) => ({ record: recordOut(row), score: Math.round(score * 10000) / 10000, part: 'record' })),
    };
  }

  async function embedForClient(client, body) {
    need(client, 'search');
    if (!isObj(body) || !Array.isArray(body.inputs) || !body.inputs.length || body.inputs.length > 64 || !body.inputs.every((s) => typeof s === 'string'))
      throw bad('inputs must be a list of 1 … 64 strings');
    const task = body.task ?? 'query';
    if (!['query', 'document'].includes(task)) throw bad('task must be query or document');
    const dim = body.dim === undefined ? 768 : Number(body.dim);
    if (!DIMS.includes(dim)) throw bad(`dim must be one of ${DIMS.join(', ')}`);
    const out = await embed(body.inputs, task);
    return { model: model(), dim, vectors: out.map((v) => encodeVector(truncateNormalize(v, dim))) };
  }

  // ---- status -------------------------------------------------------------------------------------------------------
  function info() {
    return {
      hub: hubInfo(),
      api: 1,
      embedding: { model: model(), dim: 768, dims: DIMS, worker: workerConnected() },
    };
  }

  const tick = setInterval(() => {
    checkWorker();
    expireLeases();
  }, 5000);
  tick.unref();

  function close() {
    clearInterval(tick);
    for (const j of [...queries.values()]) failQuery(j, unavailable('the hub is shutting down'));
    db.close();
  }

  return {
    db, events, getMeta, setMeta, info, hubInfo, close,
    authenticate, has, need, listClients, getClient, patchClient, revokeClient, createClient,
    createPairing, redeem, setupCode,
    putRecord, batch, deleteRecord, getRecord, listRecords, changes, kinds, maxRev,
    missingBlobs, blobAdded, blobAccess, collectBlobs,
    vectorsFeed, takeJobs, hasQueuedJobs, finishJob, heartbeat, workerStatus, workerConnected, retryParked,
    search, embed: embedForClient,
  };
}
