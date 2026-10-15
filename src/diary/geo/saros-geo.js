/**
 * Solar-eclipse paths by Saros series: the compressed records of data/<saros>.bin (Saros 101 … 173, vendored unchanged
 * from gnomonicube's saros-geo; see README.md for the format and the source of the paths).
 *
 * A record: {type, latitude, longitude (of greatest eclipse, degrees), magnitude, gamma, central_duration (s),
 * central_width_km (central eclipses), sun_altitude (degrees, at greatest eclipse), datetime_utc 'YYYY-MM-DD HH:MM:SS',
 * unix_time, saros, position (in the series), geometry: {type: 'MultiPolygon', coordinates: [[ring]…]}}, where a ring
 * is [[lon, lat]…] and
 *   - central eclipses (T…, A…, H…): the closed outline of the path of totality / annularity (one limit out, the other
 *     back), split at the antimeridian into several polygons when it crosses it;
 *   - partial and non-central eclipses (P, Pb, Pe, T±, A±): the contour where the greatest local magnitude is the 0.2
 *     step just below the eclipse's magnitude (0.8 at most; 0 = the limit of the penumbra), from horizon to horizon:
 *     an open line, or a closed ring when it lies wholly in daylight (also split at the antimeridian).
 *
 * The decoder follows gnomonicube's src/saros-geo/saros_geo.js (decodeSeries); it works in Node and the browser.
 */
import { loadBytes } from './load.js';

export const SAROS_MIN = 101;
export const SAROS_MAX = 173;

export const TYPE_NAMES = Object.freeze(['A', 'Am', 'Aminus', 'An', 'Aplus', 'As', 'H', 'H2', 'H3', 'Hm', 'P', 'Pb', 'Pe', 'T', 'Tm', 'Tminus', 'Tplus', 'Ts']);
/** The types whose geometry is a magnitude contour, not a central path. */
export const CONTOUR_TYPES = Object.freeze(new Set(['P', 'Pb', 'Pe', 'Tminus', 'Tplus', 'Aminus', 'Aplus']));

const BITS = { TYPE: 5, UNIX: 35, SUN: 7, MAG: 14, GAMMA_MAG: 14, HAS_DUR: 1, DUR: 10, HAS_CWK: 1, CWK: 11, NPOLY: 5, NPTS: 13 };
const COORD_SCALE = 1_000_000;
const MAG_SCALE = 10_000;

/** MSB-first bit reader over a byte array, from a bit offset. */
class BitReader {
  constructor(buf, bitOffset = 0) {
    this.buf = buf;
    this.pos = bitOffset;
  }
  uint(bits) {
    let value = 0;
    let remaining = bits;
    while (remaining > 0) {
      const byte = this.pos >> 3;
      if (byte >= this.buf.length) throw new Error('saros-geo: read past end');
      const can = 8 - (this.pos & 7);
      const take = Math.min(can, remaining);
      value = value * 2 ** take + ((this.buf[byte] >> (can - take)) & ((1 << take) - 1));
      this.pos += take;
      remaining -= take;
    }
    return value;
  }
  int(bits) {
    const v = this.uint(bits);
    return v >= 2 ** (bits - 1) ? v - 2 ** bits : v;
  }
  coord() {
    const sign = this.uint(1);
    const v = this.uint(28) / COORD_SCALE;
    return sign ? -v : v;
  }
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
/** `YYYY-MM-DD HH:MM:SS` (UTC) of a Unix time, as gnomonicube writes it. */
export function datetimeFromUnix(t) {
  const d = new Date(t * 1000);
  const y = d.getUTCFullYear();
  return `${y >= 0 && y < 10000 ? pad(y, 4) : y}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function decodeEclipse(br) {
  const type = TYPE_NAMES[br.uint(BITS.TYPE)];
  const unix = br.int(BITS.UNIX);
  const latitude = br.coord();
  const longitude = br.coord();
  const sun_altitude = br.uint(BITS.SUN);
  const magnitude = br.uint(BITS.MAG) / MAG_SCALE;
  const gsign = br.uint(1);
  const gmag = br.uint(BITS.GAMMA_MAG);
  const gamma = (gsign ? -gmag : gmag) / MAG_SCALE;
  const duration = br.uint(BITS.HAS_DUR) ? br.uint(BITS.DUR) : null;
  const width = br.uint(BITS.HAS_CWK) ? br.uint(BITS.CWK) : null;
  const record = { type, latitude, longitude, magnitude, gamma };
  if (duration != null) record.central_duration = duration;
  if (width != null) record.central_width_km = width;
  record.sun_altitude = sun_altitude;
  record.datetime_utc = datetimeFromUnix(unix);
  const polys = [];
  for (let i = br.uint(BITS.NPOLY); i > 0; i--) {
    const ring = [];
    for (let j = br.uint(BITS.NPTS); j > 0; j--) {
      const lon = br.coord();
      ring.push([lon, br.coord()]);
    }
    polys.push([ring]);
  }
  record.geometry = { type: 'MultiPolygon', coordinates: polys };
  record.unix_time = unix;
  return record;
}

/**
 * Decode one series file (split mode: uint8 N, 3 zero bytes, uint32 LE bit offsets[N + 1], the packed records).
 * Returns the records with `unix_time` added (the other fields are gnomonicube's decodeSeries output).
 */
export function decodeSeries(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const N = bytes[0];
  const head = 4 + 4 * (N + 1);
  const data = bytes.subarray(head);
  const out = [];
  for (let i = 0; i < N; i++) {
    const o = 4 + 4 * i;
    const off = bytes[o] + bytes[o + 1] * 0x100 + bytes[o + 2] * 0x10000 + bytes[o + 3] * 0x1000000;
    out.push(decodeEclipse(new BitReader(data, off)));
  }
  return out;
}

const cache = new Map();

/** The records of Saros series `n` (101 … 173), oldest first, each with `saros` and `position`. Memoised. */
export function loadSarosSeries(n) {
  const s = Number(n);
  if (!Number.isInteger(s) || s < SAROS_MIN || s > SAROS_MAX) return Promise.reject(new Error(`Saros ${n}: no path data (${SAROS_MIN}…${SAROS_MAX})`));
  let p = cache.get(s);
  if (!p) {
    p = loadBytes(`${s}.bin`).then((bytes) => decodeSeries(bytes).map((r, position) => Object.assign(r, { saros: s, position })));
    p.catch(() => cache.delete(s));
    cache.set(s, p);
  }
  return p;
}

// The Saros number of the solar eclipse at a new Moon: one Saros (223 lunations) keeps it, one Inex (358 lunations)
// adds 1, so one lunation adds 38 (358 · 38 ≡ 1 mod 223). Anchored on 2024-04-08 (Saros 139); checked against every
// record of the data.
const SYNODIC = 29.530588853 * 86400;
const NEW_MOON_2000 = 947182440; // 2000-01-06 18:14 UTC
const lunation = (t) => Math.round((t - NEW_MOON_2000) / SYNODIC);
const K139 = lunation(1712600309);

/** The Saros number of a solar eclipse at Unix time t (the representative nearest the catalogue's range). */
export function sarosOf(t) {
  const d = (((139 + 38 * (lunation(t) - K139)) % 223) + 223) % 223;
  let s = d;
  while (s < 26) s += 223;
  while (s >= 249) s -= 223;
  return s;
}

/**
 * The solar-eclipse record whose greatest eclipse is within `tol` seconds (1 h) of Unix time t, or null.
 * Without a Saros number the series is worked out from t (sarosOf), and all series are searched if that fails.
 */
export async function findSolarRecord(t, sarosNumber = null, { tol = 3600 } = {}) {
  const pick = (records) => {
    let best = null;
    for (const r of records) if (Math.abs(r.unix_time - t) <= tol && (!best || Math.abs(r.unix_time - t) < Math.abs(best.unix_time - t))) best = r;
    return best;
  };
  const tryOne = async (s) => (s >= SAROS_MIN && s <= SAROS_MAX ? pick(await loadSarosSeries(s)) : null);
  if (sarosNumber != null) {
    const hit = await tryOne(Number(sarosNumber));
    if (hit) return hit;
  }
  const guess = sarosOf(t);
  if (guess !== Number(sarosNumber)) {
    const hit = await tryOne(guess);
    if (hit) return hit;
  }
  // the guess cannot miss an eclipse of the catalogue (checked on all of them); the full search is a safety net, and is
  // skipped far from a new Moon (the true one is within a day of the mean one)
  if (Math.abs((t - NEW_MOON_2000) / SYNODIC - lunation(t)) * SYNODIC > tol + 86400) return null;
  for (let s = SAROS_MIN; s <= SAROS_MAX; s++) {
    if (s === guess || s === Number(sarosNumber)) continue;
    const hit = await tryOne(s);
    if (hit) return hit;
  }
  return null;
}
