/**
 * Everything the printed diary needs about ONE eclipse (an event of eclipses.js / index.js events()).
 *
 *   solarDetail(ev) -> {
 *     kind, t, jde, gamma, magnitude,                     // as the event (t Unix seconds UTC, jde TT)
 *     contacts: [{name, t, jde, label}],                  // global contacts, time order: P1 (the penumbra first
 *                                                         // touches the Earth), U1 (the umbra / antumbra first touches
 *                                                         // it; only when the umbra reaches the Earth), max (greatest
 *                                                         // eclipse = ev), U4, P4
 *     greatest: {lat, lon, sunAlt, sunAz,                 // the point of greatest eclipse (degrees; lon east +, azimuth
 *                                                         // from north through east)
 *                duration,                                // s of totality / annularity on the central line there; null
 *                                                         // when the shadow axis misses the Earth (partial, non-central)
 *                width,                                   // km, path width there; null also when one limit of the path
 *                                                         // is missing (NASA's "n" / "s" eclipses: the umbra overhangs
 *                                                         // the Earth's limb)
 *                central, limits},                        // the axis meets the Earth; both path limits exist
 *     sun: {semidiameter}, moon: {semidiameter},          // degrees, geocentric, at greatest eclipse
 *   }
 *   solarLocal(ev, {lat, lon, height = 0}) -> {
 *     visible,                                            // the Sun is up (centre above −0.8333°, i.e. the upper limb
 *                                                         // above the refracted horizon) at some instant of C1…C4
 *     kind: 'total' | 'annular' | 'partial' | 'none',     // at the place, geometrically (topocentric; on the night side
 *                                                         // the line of sight runs through the Earth – see `visible`)
 *     contacts: [{name, t, jde, label, sunAlt, sunAz}],   // C1, C2, max, C3, C4 (C2 / C3 only when total or annular
 *                                                         // there); kept below the horizon too (sunAlt < 0)
 *     magnitude,                                          // at local maximum: the fraction of the Sun's diameter covered;
 *                                                         // for a total / annular eclipse the ratio of the apparent
 *                                                         // diameters Moon / Sun (NASA convention)
 *     obscuration,                                        // the fraction of the Sun's disc area covered at maximum
 *     at(t) -> {x, y, rSun: 1, rMoon, sunAlt, sunAz},     // the Moon's centre relative to the Sun's centre at Unix t,
 *                                                         // in units of the Sun's apparent radius, in the observer's
 *                                                         // view facing the Sun: x to the right (along the horizon, the
 *                                                         // direction of increasing azimuth – west for a Sun in the
 *                                                         // south), y up (towards the zenith). No refraction.
 *   }
 *   lunarDetail(ev) -> {
 *     kind, t, jde, gamma, umbral, penumbral,             // magnitudes at greatest eclipse
 *     contacts: [{name, t, jde, label}],                  // P1, U1, U2, max, U3, U4, P4 – those that exist
 *     shadow: {umbra, penumbra, moon},                    // radii in degrees at greatest eclipse (Chauvenet's 2 %)
 *     at(t) -> {x, y, umbra, penumbra, moon},             // the Moon's centre relative to the shadow axis (degrees, x
 *                                                         // east +, y north +, on the sky seen from the Earth's centre)
 *   }
 *   lunarVisibility(ev, {lat, lon, height = 0}) -> {
 *     moonAlt: [degrees],                                 // topocentric altitude of the Moon's centre at each contact
 *                                                         // (parallel to lunarDetail(ev).contacts)
 *     contacts: [{name, t, moonAlt}],                     // the same, labelled
 *     visible, visibleUmbral,                             // the Moon up (centre above −0.8333°) at some instant of
 *                                                         // P1…P4 / of U1…U4 (false without an umbral phase)
 *   }
 *   sarosOf(ev) -> {saros, member, count, members: [{member, t, jde, kind, gamma, magnitude, reliable}], prev, next}
 *     `reliable`: the member lies in 1500–2500, where the engine's series were checked (see the test); outside it the
 *     Moon's series and ΔT degrade and a grazing end member may be gained or lost.
 *
 * Methods.
 *  - Positions: the Moon of moon.js (+ Δψ) and the apparent Sun of sun.js, to RA / Dec with the true obliquity;
 *    geocentric equatorial vectors in Earth equatorial radii (6378.137 km); sidereal time from sky.js with UT = TT − ΔT
 *    (ΔT of time.js, held over the eclipse).
 *  - Solar, global: Besselian elements computed directly at each instant (not polynomials): the shadow axis is the
 *    line Moon → Sun; x, y, z the Moon in the fundamental plane, l1 / l2 the radii of the penumbral / umbral cone there
 *    (Sun radius 959.63″ at 1 AU, Moon k = 0.2725076 for the penumbra and 0.272281 for the umbra, as F. Espenak).
 *    The Earth is the WGS-84 ellipsoid, flattened into the fundamental plane with the usual ρ1 scaling of y
 *    (Explanatory Supplement 1961/1992): P1 / P4 when √(x² + y1²) = 1 + l1, U1 / U4 when it is 1 + |l2|, each found
 *    with Brent's method. The point of greatest eclipse is where the axis meets the ellipsoid (or, for a non-central
 *    eclipse, the point of the limb nearest to it), with the Sun's altitude and azimuth there.
 *  - Central duration at greatest eclipse: the local circumstances (below) at that point, C3 − C2. Path width: the
 *    umbral radius at the point L = |l2 − ζ tan f2| swept along the shadow's motion relative to the ground, projected on
 *    the ground: W = 2L / √(1 − (u⊥·n)²), u⊥ the unit normal to the relative velocity in the fundamental plane and n
 *    the geodetic vertical's components there.
 *  - Solar, local: the topocentric (observer on the ellipsoid) angular separation s of the Sun's and the Moon's centres
 *    against sS + sM (C1, C4; Moon k = 0.2725076) and |sM − sS| (C2, C3; k = 0.272281), each a root of Brent's method;
 *    the local maximum is the least s. The Sun's parallax is included (both bodies are topocentric vectors).
 *  - Lunar: the angle d between the Moon and the antisolar point against the shadow radii of eclipses.js (Chauvenet's
 *    2 % enlargement): P1 / P4 at d = penumbra + sM, U1 / U4 at umbra + sM, U2 / U3 at umbra − sM.
 *  - Saros: the series number from the lunation number k (Meeus' k, = F. Espenak's "Luna Num"): one Saros is 223
 *    lunations (same series), one inex 358 lunations (next series, +1). Since 358 ≡ 135 and 135 · 38 ≡ 1 (mod 223),
 *    the series advances by 38 per lunation: S ≡ S0 + 38 (k − k0) (mod 223), calibrated on 2024-04-08 (k = 300,
 *    solar 139) and 2025-03-14 (k = 311.5, lunar 123). Of the values S + 223 n the one whose eclipse k lies nearest the
 *    middle of its series' life is taken (the band of series active at a time is ~80 wide, the residue's period 223).
 *    Members: stepping 223 lunations back and forward with the eclipse engine (eclipseEvents in a ±0.6 day window
 *    around Meeus' time) until a lunation brings no eclipse of the kind. Solar members must also pass
 *    penumbraTouches() (the ellipsoid; eclipses.js' sphere admits a few grazing partials NASA does not list).
 *
 * Accuracy (test/diary-eclipse-detail.test.js; the references are named there): see the header of the test file.
 */
import { moon } from './moon.js';
import { sun } from './sun.js';
import { nutation } from './nutation.js';
import { equatorial, siderealTime } from './sky.js';
import { brent } from './search.js';
import { meeusEclipse, eclipseEvents } from './eclipses.js';
import { jdeFromUnix, unixFromJde, JD_UNIX_EPOCH } from './time.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const EARTH_KM = 6378.137;
const AU_ER = 149597870.7 / EARTH_KM; // AU in Earth equatorial radii
const E2 = 0.00669437999014; // WGS-84 first eccentricity squared
const SUN_R = AU_ER * Math.sin((959.63 / 3600) * RAD); // the Sun's radius in Earth radii (959.63″ at 1 AU)
const K_PEN = 0.2725076; // the Moon's radius in Earth radii: mean (penumbral contacts)
const K_UMB = 0.272281; // … and for the umbral / central contacts (Espenak)
const MOON_KM = 1737.4;
const SUN_H0 = -0.8333;
const H = 5 / 24; // half-width (days) of the brackets around greatest eclipse
const TOL = 1e-6; // day ≈ 0.09 s

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (ra, dec) => {
  const c = Math.cos(dec * RAD);
  return [c * Math.cos(ra * RAD), c * Math.sin(ra * RAD), Math.sin(dec * RAD)];
};
/** The angle between two vectors (radians), accurate when small. */
const angle = (a, b) => Math.atan2(norm(cross(a, b)), dot(a, b));
const unixOf = (jde) => unixFromJde(jde);

/** The eclipse's JDE (and the event's Unix time). */
function when(ev) {
  const jde = Number.isFinite(ev?.jde) ? ev.jde : jdeFromUnix(ev.t);
  return { jde, t: Number.isFinite(ev?.t) ? ev.t : unixOf(jde) };
}
/** ΔT (days) at jde: TT − UT, UT taken as UTC (time.js). */
const deltaT = (jde) => jde - (unixFromJde(jde) / 86400 + JD_UNIX_EPOCH);

/**
 * Geocentric apparent positions at JDE: sun / moon {v (equatorial vector, Earth radii), ra, dec, dist (Earth radii)},
 * R (AU), the Moon's distance in km, and the apparent sidereal time θ0 (degrees) for UT = jde − dT.
 */
function positions(jde, dT) {
  const nut = nutation(jde);
  const s = sun(jde, { nut });
  const m = moon(jde);
  const qs = equatorial(s.apparent, s.beta, nut.eps);
  const qm = equatorial(m.lambda + nut.dpsi, m.beta, nut.eps);
  const rs = s.R * AU_ER;
  const rm = m.dist / EARTH_KM;
  const eqeq = nut.dpsi * Math.cos(nut.eps * RAD);
  return {
    sun: { v: scale(unit(qs.ra, qs.dec), rs), ra: qs.ra, dec: qs.dec, dist: rs },
    moon: { v: scale(unit(qm.ra, qm.dec), rm), ra: qm.ra, dec: qm.dec, dist: rm },
    R: s.R,
    moonKm: m.dist,
    theta0: siderealTime(jde - dT, eqeq),
  };
}

/** The observer's geocentric vector (Earth radii) and geodetic vertical in the equatorial frame of date. */
function site({ lat, lon, height = 0 }, theta0) {
  const p = lat * RAD;
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const N = 1 / Math.sqrt(1 - E2 * sp * sp);
  const h = height / (EARTH_KM * 1000);
  const th = (theta0 + lon) * RAD;
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const rc = (N + h) * cp;
  const rz = (N * (1 - E2) + h) * sp;
  return {
    pos: [rc * ct, rc * st, rz],
    up: [cp * ct, cp * st, sp],
    north: [-sp * ct, -sp * st, cp],
    east: [-st, ct, 0],
  };
}

/** Altitude and azimuth (degrees; azimuth from north through east) of direction v at a site. */
function altAz(v, s) {
  const n = norm(v);
  const alt = Math.asin(dot(v, s.up) / n) * DEG;
  let az = Math.atan2(dot(v, s.east), dot(v, s.north)) * DEG;
  if (az < 0) az += 360;
  return { alt, az };
}

// ---------------------------------------------------------------------------------------------------------------------
// Solar eclipses: Besselian elements

/** Besselian elements at JDE from positions P: {x, y, z, d, a (radians), mu (degrees), l1, l2, tf1, tf2, ex, ey, g}. */
function bessel(P) {
  const S = P.sun.v;
  const M = P.moon.v;
  const G = sub(S, M);
  const gl = norm(G);
  const g = scale(G, 1 / gl);
  const d = Math.asin(g[2]);
  const a = Math.atan2(g[1], g[0]);
  const ex = [-Math.sin(a), Math.cos(a), 0];
  const ey = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  const x = dot(M, ex);
  const y = dot(M, ey);
  const z = dot(M, g);
  const sf1 = (SUN_R + K_PEN) / gl;
  const sf2 = (SUN_R - K_UMB) / gl;
  const cf1 = Math.sqrt(1 - sf1 * sf1);
  const cf2 = Math.sqrt(1 - sf2 * sf2);
  const tf1 = sf1 / cf1;
  const tf2 = sf2 / cf2;
  return {
    x,
    y,
    z,
    d,
    a,
    g,
    ex,
    ey,
    mu: P.theta0 - a * DEG,
    l1: z * tf1 + K_PEN / cf1,
    l2: z * tf2 - K_UMB / cf2,
    tf1,
    tf2,
  };
}

/** √(x² + y1²): the axis' distance from the Earth's centre with the ellipsoid scaled to a unit circle. */
function m1(B) {
  const rho1 = Math.sqrt(1 - E2 * Math.cos(B.d) ** 2);
  return Math.hypot(B.x, B.y / rho1);
}

/** The roots of f on [t0 − H, t0] and [t0, t0 + H] where f(t0) < 0 (null where not bracketed). */
function contactPair(f, t0) {
  const f0 = f(t0);
  if (!(f0 < 0)) return null;
  const fa = f(t0 - H);
  const fb = f(t0 + H);
  const before = fa > 0 ? brent(f, t0 - H, t0, fa, f0, TOL) : null;
  const after = fb > 0 ? brent(f, t0, t0 + H, f0, fb, TOL) : null;
  return [before, after];
}

const SOLAR_U = { total: 'Total', annular: 'Annular', hybrid: 'Central', partial: 'Central' };

/** The global circumstances of a solar eclipse; see the header. */
export function solarDetail(ev) {
  const { jde, t } = when(ev);
  const dT = deltaT(jde);
  const B = (tt) => bessel(positions(tt, dT));
  const P0 = positions(jde, dT);
  const B0 = bessel(P0);
  const kind = ev.kind;
  const contacts = [];
  const pen = contactPair((tt) => {
    const b = B(tt);
    return m1(b) - 1 - b.l1;
  }, jde);
  const umb = contactPair((tt) => {
    const b = B(tt);
    return m1(b) - 1 - Math.abs(b.l2);
  }, jde);
  const word = SOLAR_U[kind] ?? 'Central';
  const push = (name, tt, label) => tt !== null && tt !== undefined && contacts.push({ name, t: unixOf(tt), jde: tt, label });
  if (pen) push('P1', pen[0], 'Partial eclipse begins');
  if (umb && kind !== 'partial') push('U1', umb[0], `${word} eclipse begins`);
  push('max', jde, 'Greatest eclipse');
  if (umb && kind !== 'partial') push('U4', umb[1], `${word} eclipse ends`);
  if (pen) push('P4', pen[1], 'Partial eclipse ends');

  const greatest = greatestPoint(B0, P0);
  if (greatest.central && kind !== 'partial') {
    const loc = solarLocal({ ...ev, jde, t }, { lat: greatest.lat, lon: greatest.lon });
    const c2 = loc.contacts.find((c) => c.name === 'C2');
    const c3 = loc.contacts.find((c) => c.name === 'C3');
    greatest.duration = c2 && c3 ? (c3.jde - c2.jde) * 86400 : null;
    greatest.width = greatest.limits ? pathWidth(jde, dT, greatest) : null;
  } else {
    greatest.duration = null;
    greatest.width = null;
  }
  return {
    kind,
    t,
    jde,
    gamma: ev.gamma,
    magnitude: ev.magnitude,
    contacts,
    greatest,
    sun: { semidiameter: Math.asin(SUN_R / P0.sun.dist) * DEG },
    moon: { semidiameter: Math.asin(K_PEN / P0.moon.dist) * DEG },
  };
}

/** Where the shadow axis meets the ellipsoid (or the limb point nearest to it): {lat, lon, sunAlt, sunAz, central}. */
function greatestPoint(B, P) {
  const rho1 = Math.sqrt(1 - E2 * Math.cos(B.d) ** 2);
  const sd1 = Math.sin(B.d) / rho1;
  const cd1 = (Math.sqrt(1 - E2) * Math.cos(B.d)) / rho1;
  let x = B.x;
  let y1 = B.y / rho1;
  let q = 1 - x * x - y1 * y1;
  const central = q >= 0;
  if (!central) {
    const m = Math.hypot(x, y1);
    x /= m;
    y1 /= m;
    q = 0;
  }
  const z1 = Math.sqrt(q);
  const sphi1 = y1 * cd1 + z1 * sd1;
  const cphiCosH = z1 * cd1 - y1 * sd1;
  const Hh = Math.atan2(x, cphiCosH) * DEG;
  const phi1 = Math.asin(Math.max(-1, Math.min(1, sphi1)));
  const lat = Math.atan(Math.tan(phi1) / Math.sqrt(1 - E2)) * DEG;
  let lon = (((Hh - B.mu) % 360) + 540) % 360 - 180;
  const s = site({ lat, lon }, P.theta0);
  const sunDir = sub(P.sun.v, s.pos);
  const aa = altAz(sunDir, s);
  // both limits of the path exist when the umbra / antumbra lies wholly on the Earth's disc in the fundamental plane
  const limits = central && Math.hypot(B.x, B.y / rho1) + Math.abs(B.l2) < 1;
  return { lat, lon, sunAlt: aa.alt, sunAz: aa.az, central, limits };
}

/** Path width (km) at the point of greatest eclipse: see the header. */
function pathWidth(jde, dT, gp) {
  const h = 1 / 1440;
  const fp = (tt) => {
    const P = positions(tt, dT);
    const b = bessel(P);
    const s = site(gp, P.theta0);
    return { b, xi: dot(s.pos, b.ex), eta: dot(s.pos, b.ey), zeta: dot(s.pos, b.g), n: [dot(s.up, b.ex), dot(s.up, b.ey)] };
  };
  const a = fp(jde - h);
  const c = fp(jde + h);
  const o = fp(jde);
  const vx = c.b.x - c.xi - (a.b.x - a.xi);
  const vy = c.b.y - c.eta - (a.b.y - a.eta);
  const v = Math.hypot(vx, vy);
  const ux = -vy / v;
  const uy = vx / v;
  const L = Math.abs(o.b.l2 - o.zeta * o.b.tf2);
  const wn = ux * o.n[0] + uy * o.n[1];
  return ((2 * L) / Math.sqrt(1 - wn * wn)) * EARTH_KM;
}

// ---------------------------------------------------------------------------------------------------------------------
// Solar eclipses: local circumstances

/** Topocentric geometry at JDE for a place: separation, semidiameters (radians), the Sun's alt / az, vectors. */
function topo(jde, dT, place) {
  const P = positions(jde, dT);
  const s = site(place, P.theta0);
  const S = sub(P.sun.v, s.pos);
  const M = sub(P.moon.v, s.pos);
  const ds = norm(S);
  const dm = norm(M);
  return {
    sep: angle(S, M),
    sS: Math.asin(SUN_R / ds),
    sM: Math.asin(K_PEN / dm),
    sM2: Math.asin(K_UMB / dm),
    S,
    M,
    site: s,
  };
}

/** Area of the intersection of circles of radii r1 and r2 at distance d. */
function lens(r1, r2, d) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  return r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
}

/** The local circumstances of a solar eclipse at a place; see the header. */
export function solarLocal(ev, { lat, lon, height = 0 }) {
  const { jde } = when(ev);
  const place = { lat: Math.max(-90, Math.min(90, lat)), lon, height };
  const dT = deltaT(jde);
  const T = (tt) => topo(tt, dT, place);
  const sep = (tt) => T(tt).sep;

  // local maximum: least separation, scanned every 10 minutes over ±5 h, refined on the derivative
  const step = 10 / 1440;
  let best = 0;
  let bestV = Infinity;
  const n = Math.round(H / step);
  for (let i = -n; i <= n; i++) {
    const v = sep(jde + i * step);
    if (v < bestV) {
      bestV = v;
      best = i;
    }
  }
  const dh = 1e-4;
  const rate = (tt) => sep(tt + dh) - sep(tt - dh);
  let tMax = jde + best * step;
  const ra = rate(tMax - step);
  const rb = rate(tMax + step);
  if (ra < 0 && rb > 0) tMax = brent(rate, tMax - step, tMax + step, ra, rb, TOL);
  const g = T(tMax);

  const at = (tu) => {
    const tt = jdeFromUnix(tu);
    const q = T(tt);
    const sd = q.S.map((c) => c / norm(q.S));
    const right = cross(sd, q.site.up);
    const rn = norm(right);
    const r = rn > 1e-12 ? scale(right, 1 / rn) : q.site.east;
    const up = cross(r, sd);
    const mDot = dot(q.M, sd);
    const ts = Math.tan(q.sS);
    const aa = altAz(q.S, q.site);
    return { x: dot(q.M, r) / mDot / ts, y: dot(q.M, up) / mDot / ts, rSun: 1, rMoon: Math.tan(q.sM) / ts, sunAlt: aa.alt, sunAz: aa.az };
  };

  const kind = g.sep < g.sM2 - g.sS ? 'total' : g.sep < g.sS - g.sM2 ? 'annular' : g.sep < g.sS + g.sM ? 'partial' : 'none';
  if (kind === 'none') return { visible: false, kind, contacts: [], magnitude: 0, obscuration: 0, at };

  const outer = contactPair((tt) => {
    const q = T(tt);
    return q.sep - q.sS - q.sM;
  }, tMax);
  const inner =
    kind === 'partial'
      ? null
      : contactPair((tt) => {
          const q = T(tt);
          return q.sep - Math.abs(q.sM2 - q.sS);
        }, tMax);
  const word = kind === 'total' ? 'Totality' : 'Annularity';
  const contacts = [];
  const push = (name, tt, label) => {
    if (tt === null || tt === undefined) return;
    const q = T(tt);
    const aa = altAz(q.S, q.site);
    contacts.push({ name, t: unixOf(tt), jde: tt, label, sunAlt: aa.alt, sunAz: aa.az });
  };
  push('C1', outer?.[0], 'Eclipse begins');
  if (inner) push('C2', inner[0], `${word} begins`);
  push('max', tMax, 'Maximum eclipse');
  if (inner) push('C3', inner[1], `${word} ends`);
  push('C4', outer?.[1], 'Eclipse ends');

  const magnitude = kind === 'partial' ? (g.sS + g.sM - g.sep) / (2 * g.sS) : g.sM2 / g.sS;
  const obscuration = kind === 'total' ? 1 : lens(g.sS, kind === 'annular' ? g.sM2 : g.sM, g.sep) / (Math.PI * g.sS * g.sS);

  // visible: the Sun up at some instant between C1 and C4
  const a = contacts[0].jde;
  const b = contacts[contacts.length - 1].jde;
  let visible = false;
  const N = 48;
  for (let i = 0; i <= N && !visible; i++) {
    const tt = a + ((b - a) * i) / N;
    const P = positions(tt, dT);
    const s = site(place, P.theta0);
    if (altAz(sub(P.sun.v, s.pos), s).alt > SUN_H0) visible = true;
  }
  return { visible, kind, contacts, magnitude, obscuration, at };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lunar eclipses

/** The Moon against the Earth's shadow at JDE: {d (radians), x, y (degrees), umbra, penumbra, sm (radians)}. */
function lunarGeometry(jde) {
  const nut = nutation(jde);
  const s = sun(jde, { nut });
  const m = moon(jde);
  const qa = equatorial(s.apparent + 180, -s.beta, nut.eps);
  const qm = equatorial(m.lambda + nut.dpsi, m.beta, nut.eps);
  const A = unit(qa.ra, qa.dec);
  const Mv = unit(qm.ra, qm.dec);
  const d = angle(A, Mv);
  // the direction of the Moon from the axis: east = increasing RA, north = increasing Dec
  const east = [-Math.sin(qa.ra * RAD), Math.cos(qa.ra * RAD), 0];
  const north = cross(A, east);
  const ex = dot(Mv, east);
  const ny = dot(Mv, north);
  const k = d / (Math.hypot(ex, ny) || 1);
  const pim = Math.asin(EARTH_KM / m.dist) * 0.99834;
  const sm = Math.asin(MOON_KM / m.dist);
  const ss = ((959.63 / 3600) * RAD) / s.R;
  const pis = ((8.794 / 3600) * RAD) / s.R;
  return {
    d,
    x: ex * k * DEG,
    y: ny * k * DEG,
    umbra: 1.02 * (pim - ss + pis),
    penumbra: 1.02 * (pim + ss + pis),
    sm,
  };
}

/** The circumstances of a lunar eclipse; see the header. */
export function lunarDetail(ev) {
  const { jde, t } = when(ev);
  const G = lunarGeometry(jde);
  const umbral = (G.umbra + G.sm - G.d) / (2 * G.sm);
  const penumbral = (G.penumbra + G.sm - G.d) / (2 * G.sm);
  const pair = (f) => contactPair(f, jde);
  const P = pair((tt) => {
    const g = lunarGeometry(tt);
    return g.d - g.penumbra - g.sm;
  });
  const U = umbral > 0 ? pair((tt) => {
    const g = lunarGeometry(tt);
    return g.d - g.umbra - g.sm;
  }) : null;
  const T = umbral >= 1 ? pair((tt) => {
    const g = lunarGeometry(tt);
    return g.d - g.umbra + g.sm;
  }) : null;
  const contacts = [];
  const push = (name, tt, label) => tt !== null && tt !== undefined && contacts.push({ name, t: unixOf(tt), jde: tt, label });
  if (P) push('P1', P[0], 'Penumbral eclipse begins');
  if (U) push('U1', U[0], 'Partial eclipse begins');
  if (T) push('U2', T[0], 'Total eclipse begins');
  push('max', jde, 'Greatest eclipse');
  if (T) push('U3', T[1], 'Total eclipse ends');
  if (U) push('U4', U[1], 'Partial eclipse ends');
  if (P) push('P4', P[1], 'Penumbral eclipse ends');
  return {
    kind: ev.kind,
    t,
    jde,
    gamma: ev.gamma,
    umbral,
    penumbral,
    contacts,
    shadow: { umbra: G.umbra * DEG, penumbra: G.penumbra * DEG, moon: G.sm * DEG },
    at(tu) {
      const g = lunarGeometry(jdeFromUnix(tu));
      return { x: g.x, y: g.y, umbra: g.umbra * DEG, penumbra: g.penumbra * DEG, moon: g.sm * DEG };
    },
  };
}

/** The Moon's topocentric altitude (degrees) at JDE for a place. */
function moonAlt(jde, dT, place) {
  const P = positions(jde, dT);
  const s = site(place, P.theta0);
  return altAz(sub(P.moon.v, s.pos), s).alt;
}

/** The Moon's altitude at each contact of lunarDetail(ev) and whether the eclipse can be seen; see the header. */
export function lunarVisibility(ev, { lat, lon, height = 0 }) {
  const det = lunarDetail(ev);
  const place = { lat: Math.max(-90, Math.min(90, lat)), lon, height };
  const dT = deltaT(det.jde);
  const moonAltitudes = det.contacts.map((c) => moonAlt(c.jde, dT, place));
  const upDuring = (a, b) => {
    if (a === undefined || b === undefined) return false;
    const N = 48;
    for (let i = 0; i <= N; i++) if (moonAlt(a + ((b - a) * i) / N, dT, place) > SUN_H0) return true;
    return false;
  };
  const by = (name) => det.contacts.find((c) => c.name === name)?.jde;
  return {
    moonAlt: moonAltitudes,
    contacts: det.contacts.map((c, i) => ({ name: c.name, t: c.t, moonAlt: moonAltitudes[i] })),
    visible: upDuring(by('P1') ?? det.jde, by('P4') ?? det.jde),
    visibleUmbral: by('U1') !== undefined && upDuring(by('U1'), by('U4')),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Saros series

const LUNATION = 29.530588861;
const K_EPOCH = 2451550.09766;
/** Calibration: {k0, s0, m0} – lunation, series and the member index of a known eclipse (F. Espenak, NASA). */
const CAL = {
  solar: { k0: 300, s0: 139, m0: 30 }, // 2024-04-08: Saros 139, member 30 of 71
  lunar: { k0: 311.5, s0: 123, m0: 53 }, // 2025-03-14: Saros 123, member 53
};
/** The middle member of a series, roughly (series have 69–87 members). */
const MID = 37;

/** The lunation number k of an eclipse (integer for a solar, + 0.5 for a lunar one). */
function lunationOf(jde, solar) {
  const kf = (jde - K_EPOCH) / LUNATION;
  return solar ? Math.round(kf) : Math.round(kf - 0.5) + 0.5;
}

/** The Saros series number of the eclipse at lunation k. */
export function sarosNumber(k, solar) {
  const { k0, s0, m0 } = solar ? CAL.solar : CAL.lunar;
  const dk = Math.round(k - k0);
  const r = (((s0 + 38 * dk) % 223) + 223) % 223; // the residue of S
  // S = r + 223 n with the member index m = m0 + (dk − 358 (S − s0)) / 223 nearest to MID
  const sIdeal = s0 + (dk - 223 * (MID - m0)) / 358;
  return r + 223 * Math.round((sIdeal - r) / 223);
}

/** Years where the series are trusted: solar membership checked against NASA over 1585–2500, lunar over 1701–2200. */
const RELIABLE = [jdOfYear(1500), jdOfYear(2500)];
function jdOfYear(y) {
  return 2451545 + (y - 2000) * 365.25;
}

/** The eclipse of the given kind found by the engine near lunation k, or null. */
function memberAt(k, name) {
  const m = meeusEclipse(k);
  if (!m) return null;
  const found = eclipseEvents(m.jde - 0.6, m.jde + 0.6).find((e) => e.name === name);
  if (!found || (name === 'solar-eclipse' && !penumbraTouches(found.jde))) return null;
  return found;
}

/**
 * Whether the Moon's penumbra reaches the Earth near greatest eclipse `jde`, by NASA's verdict. eclipses.js tests a
 * sphere (|γ| < 1.5433 + u), which admits a few grazing partial eclipses of magnitude < 0.01 passing just beyond a pole
 * that are not in F. Espenak's catalogues. Here the least of √(x² + y1²) − 1 − l1 (the WGS-84 ellipsoid flattened into
 * the fundamental plane; a parabola through greatest eclipse ± 15 min) must be below TOUCH = 0.0014 Earth radii
 * (9 km): over 1585–2500 the eclipses NASA lists reach at most +0.0009 here (1639-01-04, magnitude 0.0009), those it
 * does not list (8, magnitudes 0.0008–0.0071) at least +0.0019.
 */
const TOUCH = 0.0014;
export function penumbraTouches(jde) {
  const dT = deltaT(jde);
  const h = 15 / 1440;
  const f = (tt) => {
    const b = bessel(positions(tt, dT));
    return m1(b) - 1 - b.l1;
  };
  const a = f(jde - h);
  const o = f(jde);
  const c = f(jde + h);
  const den = a - 2 * o + c;
  const least = den > 0 ? o - (c - a) ** 2 / (8 * den) : Math.min(a, o, c);
  return least < TOUCH;
}

/** The Saros series of an eclipse; see the header. */
export function sarosOf(ev) {
  const { jde } = when(ev);
  const solar = (ev.name ?? 'solar-eclipse') === 'solar-eclipse';
  const name = solar ? 'solar-eclipse' : 'lunar-eclipse';
  const k = lunationOf(jde, solar);
  const saros = sarosNumber(k, solar);
  const self = { jde, kind: ev.kind, gamma: ev.gamma, magnitude: ev.magnitude };
  const before = [];
  for (let kk = k - 223; ; kk -= 223) {
    const e = memberAt(kk, name);
    if (!e) break;
    before.push(e);
    if (before.length > 120) break;
  }
  const after = [];
  for (let kk = k + 223; ; kk += 223) {
    const e = memberAt(kk, name);
    if (!e) break;
    after.push(e);
    if (after.length > 120) break;
  }
  const list = [...before.reverse(), self, ...after];
  const members = list.map((e, i) => ({
    member: i + 1,
    t: unixOf(e.jde),
    jde: e.jde,
    kind: e.kind,
    gamma: e.gamma,
    magnitude: e.magnitude,
    reliable: e.jde >= RELIABLE[0] && e.jde <= RELIABLE[1],
  }));
  const member = before.length + 1;
  return {
    saros,
    member,
    count: members.length,
    members,
    prev: members[member - 2] ?? null,
    next: members[member] ?? null,
  };
}

