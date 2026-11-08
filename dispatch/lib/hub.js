// The dispatch's side of the Fractonica Hub API (hub/API.md): redeeming the app's pairing code, the change feed of the
// phones' call schedules (`dispatch.calls`), and writing its own status (`dispatch.status`). Plain fetch.

export class HubError extends Error {
  constructor(message, status = 0, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class Hub {
  constructor(base, token = null, { timeout = 15_000 } = {}) {
    this.base = base.replace(/\/+$/, '');
    this.token = token;
    this.timeout = timeout;
  }

  async request(method, path, body, { timeout = this.timeout } = {}) {
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(this.base + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      throw new HubError(`the hub at ${this.base} did not answer (${e.cause?.code ?? e.cause?.message ?? e.message})`);
    }
    const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
    if (!res.ok) throw new HubError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data?.error?.code ?? null);
    return data;
  }

  /** `GET /v1`: the hub (no token). */
  info() {
    return this.request('GET', '/v1');
  }

  /** `POST /v1/pair`: the app's code for this dispatch's token (a `service` on `dispatch.*`). */
  redeem(code, { name, platform, device }) {
    return this.request('POST', '/v1/pair', { code, name, kind: 'service', platform, device });
  }

  me() {
    return this.request('GET', '/v1/me');
  }

  /** `GET /v1/changes`: the records of `kinds` changed after `after`, waiting up to `wait` s for one. */
  changes(after, { kinds = [], wait = 0, limit = 500 } = {}) {
    const q = new URLSearchParams({ after: String(after), limit: String(limit) });
    for (const k of kinds) q.append('kind', k);
    if (wait) q.set('wait', String(wait));
    return this.request('GET', `/v1/changes?${q}`, undefined, { timeout: this.timeout + wait * 1000 });
  }

  put(record) {
    return this.request('PUT', `/v1/records/${encodeURIComponent(record.id)}`, record);
  }
}
