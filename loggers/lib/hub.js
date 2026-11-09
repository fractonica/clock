// A logger's side of the Fractonica Hub API (hub/API.md): redeeming a pairing code, uploading blobs, writing records.
// Plain fetch.
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

export class HubError extends Error {
  constructor(message, status = 0, code = null, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class Hub {
  constructor(base, token = null, { timeout = 30_000 } = {}) {
    this.base = base.replace(/\/+$/, '');
    this.token = token;
    this.timeout = timeout;
  }

  async request(method, path, body, { timeout = this.timeout, raw = null, type = null } = {}) {
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (raw) headers['Content-Type'] = type ?? 'application/octet-stream';
    let res;
    try {
      res = await fetch(this.base + path, {
        method, headers, signal: AbortSignal.timeout(timeout),
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
        ...(raw ? { duplex: 'half' } : {}),
      });
    } catch (e) {
      throw new HubError(`the hub at ${this.base} did not answer (${e.cause?.code ?? e.cause?.message ?? e.message})`);
    }
    const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
    if (!res.ok) throw new HubError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data?.error?.code ?? null, data?.error?.details ?? null);
    return data;
  }

  /** `GET /v1`: the hub (no token). */
  info() {
    return this.request('GET', '/v1');
  }

  /** `POST /v1/pair`: a code for this logger's token, as a `worker`. */
  redeem(code, { name, platform, device }) {
    return this.request('POST', '/v1/pair', { code, name, kind: 'worker', platform, device });
  }

  me() {
    return this.request('GET', '/v1/me');
  }

  put(record) {
    return this.request('PUT', `/v1/records/${encodeURIComponent(record.id)}`, record);
  }

  /** Uploads a file the hub lacks (by its SHA-256) → { hash, size, type }. */
  async upload(file, type) {
    const hash = await sha256File(file);
    const size = statSync(file).size;
    const { missing } = await this.request('POST', '/v1/blobs/check', { hashes: [hash] });
    if (missing.includes(hash)) {
      await this.request('PUT', `/v1/blobs/${hash}`, undefined, {
        raw: Readable.toWeb(createReadStream(file)), type, timeout: Math.max(this.timeout, 120_000),
      });
    }
    return { hash, size, type };
  }
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (b) => h.update(b)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
