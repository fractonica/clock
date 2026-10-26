// Small pure helpers shared by the hub: ids, tokens, canonical JSON, globs, text normalisation, errors.
import { createHash, randomBytes, randomInt } from 'node:crypto';

export const now = () => Date.now() / 1000;

/** An API error: thrown anywhere, rendered by the server as `{ error: { code, message, details } }`. */
export class HubError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const bad = (msg, details) => new HubError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'missing or invalid token') => new HubError(401, 'unauthorized', msg);
export const forbidden = (msg, details) => new HubError(403, 'forbidden', msg, details);
export const notFound = (msg = 'not found') => new HubError(404, 'not_found', msg);
export const conflict = (msg, details) => new HubError(409, 'conflict', msg, details);
export const tooLarge = (msg = 'too large') => new HubError(413, 'too_large', msg);
export const unprocessable = (msg, details) => new HubError(422, 'unprocessable', msg, details);
export const rateLimited = (msg = 'too many attempts') => new HubError(429, 'rate_limited', msg);
export const unavailable = (msg, retryAfter = 10) => Object.assign(new HubError(503, 'unavailable', msg), { retryAfter });

// ---- ids --------------------------------------------------------------------------------------------------------
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID: 48-bit millisecond time + 80 random bits, Crockford base32 (sorts by creation time). */
export function ulid(t = Date.now()) {
  let s = '';
  let ms = Math.floor(t);
  for (let i = 0; i < 10; i++) {
    s = CROCKFORD[ms % 32] + s;
    ms = Math.floor(ms / 32);
  }
  const r = randomBytes(16);
  for (let i = 0; i < 16; i++) s += CROCKFORD[r[i] & 31];
  return s;
}

export const sha256 = (x) => createHash('sha256').update(x).digest('hex');
export const newToken = () => `fxh_${randomBytes(32).toString('base64url')}`;

/** Pairing codes: 8 characters from an alphabet without look-alikes, shown as XXXX-XXXX. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}
/** Input is case-insensitive and ignores `-` and spaces. */
export const normCode = (c) => String(c ?? '').toUpperCase().replace(/[\s-]/g, '');
export const showCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;

// ---- canonical JSON ---------------------------------------------------------------------------------------------
/** JSON with object keys sorted (by UTF-16 code units, as JS sorts) at every depth and no whitespace. */
export function canonicalJSON(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(v[k])}`).join(',')}}`;
}

// ---- globs ------------------------------------------------------------------------------------------------------
export const GLOB_RE = /^[a-z0-9._*?-]{1,128}$/;
const globCache = new Map();
/** `journal.*` matches `journal.entry`; `*` is any run of characters, `?` one character. */
export function globToRegExp(g) {
  let re = globCache.get(g);
  if (!re) {
    re = new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    globCache.set(g, re);
  }
  return re;
}
export const matchesAny = (kind, globs) => globs.some((g) => globToRegExp(g).test(kind));

// ---- text -------------------------------------------------------------------------------------------------------
/** Case- and accent-insensitive form: NFKD, combining marks removed, lower case. */
export const fold = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
/** The words of a query, folded. */
export const terms = (q) => [...new Set(fold(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean))].slice(0, 32);

// ---- floats -----------------------------------------------------------------------------------------------------
/** Little-endian Float32 base64 → Float32Array (copied, aligned). */
export function decodeVector(b64) {
  const buf = Buffer.from(String(b64), 'base64');
  if (buf.length === 0 || buf.length % 4) return null;
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}
export function encodeVector(f32) {
  const buf = Buffer.alloc(f32.length * 4);
  for (let i = 0; i < f32.length; i++) buf.writeFloatLE(f32[i], i * 4);
  return buf.toString('base64');
}
/** The first `dim` components, L2-normalised (Matryoshka truncation). */
export function truncateNormalize(vec, dim) {
  const n = Math.min(dim, vec.length);
  const out = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) s += vec[i] * vec[i];
  const k = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < n; i++) out[i] = vec[i] * k;
  return out;
}
export function dot(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
