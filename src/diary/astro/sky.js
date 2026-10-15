/**
 * The local sky for the printed diary: the altitude of the Sun and the Moon over a place, sampled on a regular grid,
 * and the day's rise / transit / set of both bodies.
 *
 *   skyOf(t0, t1, {lat, lon, height = 0, step = 120}) -> {
 *     lat, lon, height, t0, t1, step,          // step: seconds between samples
 *     n,                                       // number of samples, ceil((t1 − t0) / step) + 1
 *     sun, moon: Float32Array(n),              // altitude (degrees) at t0 + i·step
 *     altAt(body, t) -> degrees,               // body 'sun' | 'moon'; linear interpolation of the samples, NaN outside
 *                                              // [t0, t1] (or for a non-number t)
 *     events: [{t, body, name, alt?}],         // name 'rise' | 'transit' | 'set'; sorted by t, every t in [t0, t1);
 *                                              // `alt` (degrees, same definition as the samples) only on transits
 *   }
 * Times are Unix seconds (UTC); lat (degrees, north positive), lon (degrees, EAST positive), height (metres above the
 * ellipsoid). fractonica.js must be loaded first (time.js uses it for TT).
 *
 * Definitions (Meeus, Astronomical Algorithms, 2nd ed.):
 *   - Positions. Sun: apparent longitude (sun.js: VSOP87 abridged, FK5, nutation, aberration) and latitude; Moon:
 *     chapter 47 λ + Δψ, β, Δ, horizontal parallax π = asin(6378.14 km / Δ). Both to RA/Dec with the true obliquity
 *     ε = ε0 + Δε (13.3, 13.4).
 *   - Sidereal time: apparent Greenwich sidereal time, 12.4 plus the equation of the equinoxes Δψ cos ε. The UT it needs
 *     is taken as UTC (|UT1 − UTC| < 0.9 s); TT for the series is UTC + ΔT from time.js (evaluated at both ends of the
 *     range and interpolated linearly – a leap second inside the range moves the positions by a negligible amount).
 *   - Altitude (13.6) from the local hour angle H = θ − α (θ local apparent sidereal time).
 *   - Sun: the geometric altitude of the centre (no refraction, no solar parallax). Rises and sets when that altitude
 *     is h0 = −0.8333° (34′ refraction + 16′ semidiameter; chapter 15).
 *   - Moon: the TOPOCENTRIC geometric altitude of the centre (full conversion, chapter 40 – ρ sin φ′, ρ cos φ′ from
 *     the latitude and height, chapter 11), no refraction. Rises and sets when the topocentric centre altitude is
 *     −0.5667° − s′, s′ = the topocentric semidiameter (k = 0.2725 Moon radii per Earth radius: sin s′ = k sin π · Δ/Δ′),
 *     i.e. when the upper limb is at −34′ of refracted altitude. This is the USNO convention, and to first order the
 *     same as Meeus' geocentric h0 = 0.7275 π − 0.5667°.
 *   - Transit: upper culmination, the instant the (geocentric) local hour angle passes 0 – equivalently the meridian
 *     passage of the topocentric position, which has the same RA there. Reported every time, also below the horizon
 *     (alt < 0). On days a body stays up (or down) there are simply no rise / set events; polar latitudes are fine.
 *
 * Method. Both bodies' RA, Dec (and the Moon's parallax, the equation of the equinoxes) are computed from the series on
 * an hourly grid and interpolated with 4-point Lagrange polynomials (error below 0.1″ for the Moon); the altitudes are
 * evaluated from those at every sample. Rises and sets are the sign changes of (alt − h0) between samples, refined with
 * Brent's method on the continuous (interpolated-ephemeris) altitude; transits are the sign changes of the hour angle.
 * Two crossings within one `step` (a grazing rise-and-set at polar latitudes) can be missed – both are dropped
 * together, consistently. 81 days at 120 s take about 60–110 ms in Node (Apple M-series).
 *
 * Accuracy (test/diary-sky.test.js against the USNO's published table): Sun rise/set/transit within 0.52 min, Moon
 * rise/set/transit within 0.52 min – the table's rounding – over 45 place-days at five sites incl. Tromsø.
 *
 * Helpers exported for tests: equatorial, siderealTime, altitude, observer, topocentric, bodyAltitude (exact, no interpolation),
 * SUN_H0, MOON_H0_REFRACTION.
 */
import { moon } from "./moon.js";
import { sun } from "./sun.js";
import { nutation } from "./nutation.js";
import { brent, wrap180, wrap360 } from "./search.js";
import { jdeFromUnix, JD_UNIX_EPOCH } from "./time.js";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const EARTH_RADIUS = 6378.14; // km, Meeus' equatorial radius (chapter 11 and the parallax 47 / 40)
const FLATTENING = 1 / 298.257;
const MOON_K = 0.272481; // Moon radius / Earth equatorial radius
/** Sun: geometric altitude of the centre at rise/set (degrees). */
export const SUN_H0 = -0.8333;
/** Moon: refracted altitude of the upper limb at rise/set is 0, i.e. the geometric upper limb is at −34′. */
export const MOON_H0_REFRACTION = -0.5667;
const NODE = 3600; // seconds between ephemeris nodes
const DAY = 86400;

/** Ecliptic (λ, β) → equatorial {ra, dec} (degrees, ra in [0, 360)) for obliquity ε (degrees). Meeus 13.3, 13.4. */
export function equatorial(lambda, beta, eps) {
  const l = lambda * RAD;
  const b = beta * RAD;
  const e = eps * RAD;
  const sl = Math.sin(l);
  const ra =
    Math.atan2(sl * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l)) * DEG;
  const dec =
    Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * sl) * DEG;
  return { ra: wrap360(ra), dec };
}

/**
 * Greenwich sidereal time (degrees, [0, 360)) at Julian Day `jd` (UT). Mean (Meeus 12.4); with `eqeq` (the equation of
 * the equinoxes Δψ cos ε, degrees) apparent.
 */
export function siderealTime(jd, eqeq = 0) {
  const d = jd - 2451545;
  const T = d / 36525;
  return wrap360(
    280.46061837 +
      360.98564736629 * d +
      T * T * (0.000387933 - T / 38710000) +
      eqeq
  );
}

/** Altitude (degrees) from the local hour angle H, declination and latitude (degrees). Meeus 13.6. */
export function altitude(H, dec, lat) {
  const p = lat * RAD;
  const d = dec * RAD;
  const s =
    Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H * RAD);
  return Math.asin(Math.max(-1, Math.min(1, s))) * DEG;
}

/** ρ sin φ′ and ρ cos φ′ (Earth radii) for a geodetic latitude (degrees) and height (m). Meeus chapter 11. */
export function observer(lat, height = 0) {
  const p = lat * RAD;
  const u = Math.atan((1 - FLATTENING) * Math.tan(p));
  const h = height / (EARTH_RADIUS * 1000);
  return {
    rhoSin: (1 - FLATTENING) * Math.sin(u) + h * Math.sin(p),
    rhoCos: Math.cos(u) + h * Math.cos(p),
  };
}

/**
 * Topocentric {H, dec, scale} from geocentric hour angle H, declination (degrees) and horizontal parallax π (degrees)
 * for an observer {rhoSin, rhoCos}: Meeus 40.2, 40.3 (40.6 for H′ directly). `scale` = Δ′/Δ (topocentric distance).
 */
export function topocentric(H, dec, parallax, obs) {
  const sp = Math.sin(parallax * RAD);
  const h = H * RAD;
  const d = dec * RAD;
  const cd = Math.cos(d);
  // Cartesian, equatorial frame of date with the x axis on the local meridian (Earth radii ÷ distance)
  const x = cd * Math.cos(h) - obs.rhoCos * sp;
  const y = cd * Math.sin(h);
  const z = Math.sin(d) - obs.rhoSin * sp;
  const r = Math.sqrt(x * x + y * y + z * z);
  return { H: Math.atan2(y, x) * DEG, dec: Math.asin(z / r) * DEG, scale: r };
}

/** Ephemeris of a body at one instant: {ra, dec, par (degrees; 0 for the Sun), eqeq (degrees)}. */
function ephemeris(body, jde) {
  const nut = nutation(jde);
  const eqeq = nut.dpsi * Math.cos(nut.eps * RAD);
  if (body === "sun") {
    const s = sun(jde, { nut });
    const q = equatorial(s.apparent, s.beta, nut.eps);
    return { ra: q.ra, dec: q.dec, par: 0, eqeq };
  }
  const m = moon(jde);
  const q = equatorial(m.lambda + nut.dpsi, m.beta, nut.eps);
  return {
    ra: q.ra,
    dec: q.dec,
    par: Math.asin(EARTH_RADIUS / m.dist) * DEG,
    eqeq,
  };
}

const jdOfUnix = (t) => t / DAY + JD_UNIX_EPOCH;

/** Altitude (degrees, the definitions of the samples) from an ephemeris {ra, dec, par, eqeq} at Unix time t. */
function altFrom(body, e, t, lon, lat, obs) {
  const H = siderealTime(jdOfUnix(t), e.eqeq) + lon - e.ra;
  if (body === "sun") return altitude(H, e.dec, lat);
  const tp = topocentric(H, e.dec, e.par, obs);
  return altitude(tp.H, tp.dec, lat);
}

/** Rise/set threshold (degrees of geometric centre altitude, as in the samples). */
function threshold(body, e, H, obs) {
  if (body === "sun") return SUN_H0;
  const tp = topocentric(H, e.dec, e.par, obs);
  const s = Math.asin((MOON_K * Math.sin(e.par * RAD)) / tp.scale) * DEG;
  return MOON_H0_REFRACTION - s;
}

/**
 * The exact altitude (degrees) of `body` ('sun' | 'moon') at Unix time t over {lat, lon, height}: the series evaluated
 * at t, no interpolation. For tests (and single values); skyOf is much faster for many.
 */
export function bodyAltitude(body, t, { lat, lon, height = 0 }) {
  const e = ephemeris(body, jdeFromUnix(t));
  return altFrom(body, e, t, lon, lat, observer(lat, height));
}

/** 4-point Lagrange interpolation of `arr` (values at integer positions) at fractional position x. */
function lagrange4(arr, x) {
  let i = Math.floor(x) - 1;
  if (i < 0) i = 0;
  if (i > arr.length - 4) i = arr.length - 4;
  const u = x - i;
  const y0 = arr[i];
  const y1 = arr[i + 1];
  const y2 = arr[i + 2];
  const y3 = arr[i + 3];
  const a = u - 1;
  const b = u - 2;
  const c = u - 3;
  return (
    (-y0 * a * b * c +
      3 * y1 * u * b * c -
      3 * y2 * u * a * c +
      y3 * u * a * b) /
    6
  );
}

/** Hourly table of one body's ephemeris over [ta, tb] (Unix seconds) with continuous (unwrapped) RA. */
function table(body, ta, n, ttOffset) {
  const ra = new Float64Array(n);
  const dec = new Float64Array(n);
  const par = new Float64Array(n);
  const eqeq = new Float64Array(n);
  let prev = NaN;
  for (let k = 0; k < n; k++) {
    const t = ta + k * NODE;
    const e = ephemeris(body, jdOfUnix(t) + ttOffset(t) / DAY);
    let r = e.ra;
    if (k > 0) r = prev + wrap180(r - prev);
    ra[k] = prev = r;
    dec[k] = e.dec;
    par[k] = e.par;
    eqeq[k] = e.eqeq;
  }
  return (t) => {
    const x = (t - ta) / NODE;
    return {
      ra: lagrange4(ra, x),
      dec: lagrange4(dec, x),
      par: lagrange4(par, x),
      eqeq: lagrange4(eqeq, x),
    };
  };
}

/**
 * The local sky over [t0, t1] (Unix seconds): see the header.
 */
export function skyOf(t0, t1, { lat, lon, height = 0, step = 120 } = {}) {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || !(t1 >= t0))
    throw new RangeError("skyOf: need t0 <= t1");
  if (!Number.isFinite(lat) || !Number.isFinite(lon))
    throw new RangeError("skyOf: need lat and lon");
  if (!(step > 0)) throw new RangeError("skyOf: step must be positive");
  lat = Math.max(-90, Math.min(90, lat));
  const obs = observer(lat, height);
  const n = Math.ceil((t1 - t0) / step) + 1;
  const tEnd = t0 + (n - 1) * step;

  // TT − UTC, linear over the range
  const dA = (jdeFromUnix(t0) - jdOfUnix(t0)) * DAY;
  const dB = (jdeFromUnix(tEnd) - jdOfUnix(tEnd)) * DAY;
  const ttOffset =
    tEnd > t0 ? (t) => dA + ((dB - dA) * (t - t0)) / (tEnd - t0) : () => dA;

  const ta = t0 - 2 * NODE;
  const nodes = Math.ceil((tEnd + 2 * NODE - ta) / NODE) + 1;
  const eph = {
    sun: table("sun", ta, nodes, ttOffset),
    moon: table("moon", ta, nodes, ttOffset),
  };

  const hourAngle = (body, t) =>
    wrap180(
      siderealTime(jdOfUnix(t), eph[body](t).eqeq) + lon - eph[body](t).ra
    );
  const alt = (body, t) => altFrom(body, eph[body](t), t, lon, lat, obs);
  const above = (body, t) => {
    const e = eph[body](t);
    const H = siderealTime(jdOfUnix(t), e.eqeq) + lon - e.ra;
    return altFrom(body, e, t, lon, lat, obs) - threshold(body, e, H, obs);
  };

  const out = {
    lat,
    lon,
    height,
    t0,
    t1,
    step,
    n,
    sun: new Float32Array(n),
    moon: new Float32Array(n),
    events: [],
  };
  const tol = 0.05; // seconds
  for (const body of ["sun", "moon"]) {
    const samples = out[body];
    let fPrev = NaN;
    let hPrev = NaN;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * step;
      const e = eph[body](t);
      const H = siderealTime(jdOfUnix(t), e.eqeq) + lon - e.ra;
      const a = altFrom(body, e, t, lon, lat, obs);
      samples[i] = a;
      const f = a - threshold(body, e, H, obs);
      const h = wrap180(H);
      if (i > 0) {
        const tp = t - step;
        if (fPrev < 0 !== f < 0) {
          const g = (x) => above(body, t0 + x);
          const x = brent(g, tp - t0, t - t0, fPrev, f, tol);
          const te = t0 + x;
          if (te >= t0 && te < t1)
            out.events.push({ t: te, body, name: fPrev < 0 ? "rise" : "set" });
        }
        // hour angle passes 0 upwards (not the ±180° wrap)
        if (hPrev < 0 && h >= 0 && h - hPrev < 90) {
          const g = (x) => hourAngle(body, t0 + x);
          const x = brent(g, tp - t0, t - t0, hPrev, h, tol);
          const te = t0 + x;
          if (te >= t0 && te < t1)
            out.events.push({
              t: te,
              body,
              name: "transit",
              alt: alt(body, te),
            });
        }
      }
      fPrev = f;
      hPrev = h;
    }
  }
  out.events.sort((a, b) => a.t - b.t);

  out.altAt = (body, t) => {
    const s = out[body];
    if (!s || !(t >= t0 && t <= t1)) return NaN;
    const x = (t - t0) / step;
    const i = Math.min(Math.floor(x), n - 2);
    if (i < 0) return s[0];
    const u = x - i;
    return s[i] + (s[i + 1] - s[i]) * u;
  };
  return out;
}
