// The dispatcher: follows the phones' call schedules through the hub and sends each call, at its first ring, as an
// APNs VoIP push — the phone rings it as a call (CallKit). Each phone that rings by dispatch keeps one record,
// `dispatch.calls.<install>` (hub/API.md):
//
//   { enabled, name, team, push: { token, environment, topic }, calls: [{ id, at, until, … }] }
//
// `at` is a call's first ring and `until` when it rings out (Unix seconds); the rest goes to the phone as is. A call is
// sent once (sent calls are remembered across restarts), at `at`, and still while at least `minRing` seconds of its
// ringing are left; never when the record says `enabled: false` (the app's alert mode: the pairing stays). The
// schedules are kept on disk too, so the calls go on while the hub cannot be reached. The dispatch's own record,
// `dispatch.status.<client id>`, says it is alive (every `heartbeat` seconds) and how its last push went.

const KIND_CALLS = 'dispatch.calls';
const KIND_STATUS = 'dispatch.status';

/** A schedule record's data, checked: the device to push to and its calls; null when it is no schedule. */
export function readSchedule(record) {
  if (!record || record.kind !== KIND_CALLS || record.deleted) return null;
  const d = record.data ?? {};
  const push = d.push ?? {};
  const token = typeof push.token === 'string' && /^[0-9a-f]{32,200}$/i.test(push.token) ? push.token.toLowerCase() : null;
  const calls = (Array.isArray(d.calls) ? d.calls : [])
    .filter((c) => c && typeof c.id === 'string' && c.id.length <= 120 && Number.isFinite(c.at) && Number.isFinite(c.until) && c.until > c.at)
    .slice(0, 400);
  return {
    id: record.id,
    source: record.source ?? null,
    updated: record.updated,
    enabled: d.enabled === true,
    name: typeof d.name === 'string' ? d.name.slice(0, 120) : 'Phone',
    team: typeof d.team === 'string' && /^[A-Z0-9]{10}$/.test(d.team) ? d.team : null,
    push: {
      token,
      environment: push.environment === 'development' ? 'development' : 'production',
      topic: typeof push.topic === 'string' && push.topic ? push.topic : null,
    },
    calls,
  };
}

export class Dispatcher {
  /**
   * @param {object} o
   * @param {import('./hub.js').Hub} o.hub
   * @param {import('./apns.js').ApnsClient|null} o.apns  null: no APNs key yet (nothing is sent; the status says so)
   * @param {{load: () => object, save: (state: object) => void}} o.store  the dispatch's state on disk
   * @param {string} o.clientId  this dispatch's hub client id
   */
  constructor({ hub, apns, store, clientId, name = 'Dispatch', version = '1.0.0', apnsProblem = null, now = () => Date.now() / 1000,
                log = () => {}, minRing = 10, heartbeat = 600, wait = 30 }) {
    Object.assign(this, { hub, apns, store, clientId, name, version, apnsProblem, now, log, minRing, heartbeat, wait });
    const s = store.load() ?? {};
    this.cursor = s.cursor ?? 0;
    this.devices = new Map(Object.entries(s.devices ?? {}));
    this.sent = new Map(Object.entries(s.sent ?? {})); // "<record>|<call>" -> when
    this.environments = new Map(Object.entries(s.environments ?? {})); // token -> the environment that took it
    this.last = s.last ?? null;
    this.started = this.now();
    this.count = 0;
    this.running = false;
    this.timer = null;
    this.beat = null;
    this.hubOk = null;
  }

  // ---- lifecycle ---------------------------------------------------------------------------------------------------

  async start() {
    this.running = true;
    this.schedule();
    this.beat = setInterval(() => this.writeStatus().catch(() => {}), this.heartbeat * 1000);
    this.beat.unref?.();
    this.feed = this.follow();
    await this.writeStatus().catch((e) => this.log(`status: ${e.message}`));
  }

  /** Stops sending (a long poll in flight ends by itself). */
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    clearInterval(this.beat);
    this.apns?.close();
  }

  persist() {
    const t = this.now();
    for (const [k, at] of this.sent) if (t - at > 3 * 86400) this.sent.delete(k);
    this.store.save({
      cursor: this.cursor,
      devices: Object.fromEntries(this.devices),
      sent: Object.fromEntries(this.sent),
      environments: Object.fromEntries(this.environments),
      last: this.last,
    });
  }

  // ---- the schedules -----------------------------------------------------------------------------------------------

  /** Takes a record from the feed. */
  apply(record) {
    if (record.kind !== KIND_CALLS) return false;
    if (record.deleted) return this.devices.delete(record.id);
    const s = readSchedule(record);
    if (!s) return false;
    this.devices.set(record.id, s);
    return true;
  }

  /** Follows the hub's change feed of schedules (long polls), applying each; backs off while the hub is away. */
  async follow() {
    let delay = 2;
    while (this.running) {
      try {
        const page = await this.hub.changes(this.cursor, { kinds: [KIND_CALLS], wait: this.wait });
        let changed = false;
        for (const r of page.changes ?? []) changed = this.apply(r) || changed;
        this.cursor = page.cursor ?? this.cursor;
        if (changed || (page.changes ?? []).length) {
          this.persist();
          this.schedule();
          this.log(`schedules: ${[...this.devices.values()].map((d) => `${d.name} ${d.enabled ? `${this.pending(d).length} calls` : 'off'}`).join(', ') || 'none'}`);
        }
        if (this.hubOk !== true) {
          this.hubOk = true;
          this.log(`following ${this.hub.base}`);
        }
        delay = 2;
      } catch (e) {
        if (!this.running) break;
        if (e.status === 401) {
          this.log('the hub no longer knows this dispatch (revoked?): pair it again with a code from the app');
          this.hubOk = false;
          await sleep(60_000);
          continue;
        }
        if (this.hubOk !== false) this.log(`${e.message}; the calls go on from the schedules held (${this.devices.size})`);
        this.hubOk = false;
        await sleep(delay * 1000);
        delay = Math.min(60, delay * 2);
      }
    }
  }

  /** A device's calls still to send, soonest first. */
  pending(device, t = this.now()) {
    if (!device.enabled || !device.push.token || !device.push.topic) return [];
    return device.calls
      .filter((c) => !this.sent.has(`${device.id}|${c.id}`) && c.until - Math.max(t, c.at) >= this.minRing)
      .sort((a, b) => a.at - b.at);
  }

  /** The next call of all, or null. */
  next(t = this.now()) {
    let best = null;
    for (const d of this.devices.values()) {
      const c = this.pending(d, t)[0];
      if (c && (!best || c.at < best.call.at)) best = { device: d, call: c };
    }
    return best;
  }

  /** Arms the timer for the next call (re-armed at least every minute: the clock may be set, schedules change). */
  schedule() {
    clearTimeout(this.timer);
    if (!this.running) return;
    const n = this.next();
    const wait = n ? Math.max(0, n.call.at - this.now()) : 60;
    this.timer = setTimeout(() => this.fire(), Math.min(wait, 60) * 1000);
  }

  /** Sends every call whose first ring has come. */
  async fire() {
    const t = this.now();
    const due = [];
    for (const d of this.devices.values()) for (const c of this.pending(d, t)) if (c.at <= t + 0.02) due.push({ device: d, call: c });
    if (due.length) {
      for (const { device, call } of due) this.sent.set(`${device.id}|${call.id}`, t);
      this.persist();
      await Promise.all(due.map(({ device, call }) => this.send(device, call)));
      this.persist();
      await this.writeStatus().catch(() => {});
    }
    this.schedule();
  }

  /** One call as a VoIP push: `fx` carries the call as the phone listed it. */
  async send(device, call) {
    const payload = { aps: {}, fx: { ...call, kind: call.kind ?? 'moment' } };
    let r;
    if (!this.apns) {
      r = { ok: false, status: 0, reason: this.apnsProblem ?? 'no APNs key', environment: device.push.environment };
    } else {
      const environment = this.environments.get(device.push.token) ?? device.push.environment;
      r = await this.apns.send({
        deviceToken: device.push.token, topic: device.push.topic, environment, payload,
        expiration: call.until, teamId: device.team ?? undefined,
      });
      if (r.ok && r.environment !== device.push.environment) this.environments.set(device.push.token, r.environment);
    }
    const late = this.now() - call.at;
    this.count += r.ok ? 1 : 0;
    this.last = { at: this.now(), device: device.name, call: call.id, title: call.title ?? null, status: r.status, reason: r.reason, late: Math.round(late * 1000) / 1000 };
    this.log(`${r.ok ? 'called' : 'FAILED'} ${device.name}: ${call.title ?? call.id}${r.ok ? '' : ` (${r.status} ${r.reason})`}${late > 1 ? `, ${late.toFixed(1)} s late` : ''}`);
    return r;
  }

  /** A test call to every phone that rings by dispatch, now: rings for `seconds`. */
  async test(seconds = 30) {
    const t = this.now();
    const out = [];
    for (const d of this.devices.values()) {
      if (!d.enabled || !d.push.token) continue;
      out.push(await this.send(d, { id: `test-${Math.floor(t)}`, kind: 'test', at: t, until: t + seconds, title: 'Fractonica Dispatch' }));
    }
    return out;
  }

  // ---- its status --------------------------------------------------------------------------------------------------

  statusRecord() {
    const t = this.now();
    const n = this.next(t);
    return {
      id: `${KIND_STATUS}.${this.clientId}`,
      kind: KIND_STATUS,
      time: t,
      created: this.started,
      updated: t,
      data: {
        name: this.name,
        version: this.version,
        started: this.started,
        seen: t,
        heartbeat: this.heartbeat,
        apns: this.apns ? 'ready' : (this.apnsProblem ?? 'no APNs key'),
        devices: [...this.devices.values()].map((d) => ({ id: d.id, name: d.name, enabled: d.enabled, calls: this.pending(d, t).length })),
        next: n ? { device: n.device.name, at: n.call.at, title: n.call.title ?? null } : null,
        last: this.last,
        sent: this.count,
      },
    };
  }

  async writeStatus() {
    await this.hub.put(this.statusRecord());
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
