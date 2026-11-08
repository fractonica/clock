// Apple Push Notification service, token-based: an ES256 JWT signed with the team's APNs auth key (the .p8 from
// developer.apple.com › Keys), and HTTP/2 requests to api.push.apple.com (or the sandbox for development builds).
// No dependencies: node:http2 and node:crypto. One connection per environment, kept open and reused.
import http2 from 'node:http2';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export const APNS_HOSTS = {
  production: 'https://api.push.apple.com',
  development: 'https://api.sandbox.push.apple.com',
};

const b64url = (b) => Buffer.from(b).toString('base64url');

/** The provider token: header {alg ES256, kid}, claims {iss: team, iat}, signed with the auth key. */
export function providerToken({ key, keyId, teamId, iat }) {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(iat) }));
  const signature = sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${claims}.${b64url(signature)}`;
}

/** "AuthKey_ABC123DEFG.p8" → "ABC123DEFG" (the key's id, as Apple names the file); null otherwise. */
export function keyIdFromFile(file) {
  return /^AuthKey_([A-Z0-9]{10})\.p8$/i.exec(basename(file))?.[1]?.toUpperCase() ?? null;
}

/** Reads an APNs auth key (PEM, PKCS#8 EC P-256); throws a readable error for anything else. */
export function loadKey(file) {
  const pem = readFileSync(file, 'utf8');
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ec') throw new Error(`${basename(file)} is not an APNs auth key (an EC key, .p8)`);
  return key;
}

export class ApnsClient {
  /**
   * @param {object} o
   * @param {import('node:crypto').KeyObject} o.key  the auth key
   * @param {string} o.keyId  its 10-character id
   * @param {string} [o.teamId]  the team, unless each send names one
   * @param {{production: string, development: string}} [o.hosts]  (tests: plain http/2 servers)
   */
  constructor({ key, keyId, teamId, hosts = APNS_HOSTS, now = () => Date.now() / 1000, timeout = 15_000 }) {
    this.key = key;
    this.keyId = keyId;
    this.teamId = teamId;
    this.hosts = hosts;
    this.now = now;
    this.timeout = timeout;
    this.tokens = new Map(); // team -> { token, iat }
    this.sessions = new Map(); // environment -> ClientHttp2Session
  }

  /** A provider token for the team, made anew after 40 minutes (APNs takes them for an hour, and no more than one every 20 min). */
  bearer(teamId, fresh = false) {
    const held = this.tokens.get(teamId);
    const t = this.now();
    if (!fresh && held && t - held.iat < 40 * 60) return held.token;
    const token = providerToken({ key: this.key, keyId: this.keyId, teamId, iat: t });
    this.tokens.set(teamId, { token, iat: t });
    return token;
  }

  session(environment) {
    let s = this.sessions.get(environment);
    if (s && !s.closed && !s.destroyed) return s;
    s = http2.connect(this.hosts[environment]);
    s.on('error', () => this.sessions.delete(environment));
    s.on('goaway', () => this.sessions.delete(environment));
    s.on('close', () => this.sessions.delete(environment));
    // an idle session keeps no process alive (`request` holds it while a push is on its way)
    s.unref?.();
    s.inflight = 0;
    this.sessions.set(environment, s);
    return s;
  }

  /** One request; resolves { status, reason, apnsId } (status 0 and a reason for a network failure). */
  request(environment, { deviceToken, topic, payload, pushType, priority, expiration, id, teamId }) {
    return new Promise((settle) => {
      let req, s;
      const resolve = (r) => {
        if (s && --s.inflight === 0) s.unref?.();
        s = null;
        settle(r);
      };
      try {
        s = this.session(environment);
        s.inflight++;
        s.ref?.();
        req = s.request({
          ':method': 'POST',
          ':path': `/3/device/${deviceToken}`,
          authorization: `bearer ${this.bearer(teamId)}`,
          'apns-topic': topic,
          'apns-push-type': pushType,
          'apns-priority': String(priority),
          'apns-expiration': String(Math.max(0, Math.floor(expiration ?? 0))),
          'apns-id': id ?? randomUUID(),
          'content-type': 'application/json',
        });
      } catch (e) {
        this.sessions.delete(environment);
        return resolve({ status: 0, reason: e.message });
      }
      let status = 0, apnsId = null, body = '';
      req.setTimeout(this.timeout, () => req.close(http2.constants.NGHTTP2_CANCEL));
      req.on('response', (h) => {
        status = h[':status'];
        apnsId = h['apns-id'] ?? null;
      });
      req.setEncoding('utf8');
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        let reason = null;
        if (status !== 200) {
          try { reason = JSON.parse(body).reason ?? null; } catch { reason = body || null; }
        }
        resolve({ status, reason, apnsId });
      });
      req.on('error', (e) => {
        this.sessions.delete(environment);
        resolve({ status: 0, reason: e.message });
      });
      req.end(JSON.stringify(payload));
    });
  }

  /**
   * Sends a push. A token of the other environment (a development build's token sent to production, or the reverse)
   * comes back BadDeviceToken: the other environment is tried once, and the answer says which one took it. An expired
   * provider token is made anew and the push sent again.
   * @returns {Promise<{ok: boolean, status: number, reason: string|null, environment: string, apnsId: string|null}>}
   */
  async send({ deviceToken, topic, environment = 'production', payload, pushType = 'voip', priority = 10, expiration, id, teamId = this.teamId }) {
    if (!teamId) return { ok: false, status: 0, reason: 'no team id', environment, apnsId: null };
    const one = { deviceToken, topic, payload, pushType, priority, expiration, id, teamId };
    let env = environment;
    let r = await this.request(env, one);
    if (r.status === 403 && r.reason === 'ExpiredProviderToken') {
      this.bearer(teamId, true);
      r = await this.request(env, one);
    }
    if (r.status === 400 && r.reason === 'BadDeviceToken') {
      const other = env === 'production' ? 'development' : 'production';
      const second = await this.request(other, one);
      if (second.status === 200) {
        env = other;
        r = second;
      }
    }
    return { ok: r.status === 200, status: r.status, reason: r.reason, environment: env, apnsId: r.apnsId };
  }

  close() {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }
}
