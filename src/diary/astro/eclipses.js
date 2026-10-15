/**
 * Solar and lunar eclipses – Meeus, Astronomical Algorithms (2nd ed.), chapter 54, refined on the Moon and Sun of
 * moon.js / sun.js.
 *
 * 1. Candidates: for each new or full Moon (lunation k, + 0.5 for a full Moon) near a node (|sin F| ≤ 0.36) Meeus'
 *    series give the time of greatest eclipse (to a few minutes) and u, the radius of the umbral cone in the
 *    fundamental plane (Earth equatorial radii).
 * 2. Greatest eclipse (F. Espenak's definition in the NASA catalogues): the instant when the axis of the Moon's shadow
 *    passes closest to the Earth's centre (solar: Δ☾ · sin of the geocentric angle Moon–Sun is least) or the Moon's
 *    centre closest to the axis of the Earth's shadow (lunar: the angle Moon–antisolar point is least), found within
 *    ±3 hours of Meeus' time. γ = that least distance in Earth equatorial radii, positive when the Moon passes north.
 * 3. Type and magnitude.
 *    Solar (Meeus' criteria with this γ): central when |γ| < 0.9972 – total if u < 0, annular if u > 0.0047, otherwise
 *    hybrid when u < 0.00464 √(1 − γ²); non-central total / annular when |γ| < 0.9972 + |u|; partial when
 *    |γ| < 1.5433 + u. Magnitude (fraction of the Sun's diameter covered at greatest eclipse): (1.5433 + u − |γ|) /
 *    (0.5461 + 2u) for a partial eclipse; for a central one the ratio of the apparent diameters of the Moon, seen from
 *    the point of greatest eclipse, and the Sun.
 *    Lunar (the classical geometry with Chauvenet's 2 % enlargement of the shadow, as in the NASA catalogues): radii of
 *    the umbra and penumbra 1.02 (0.998340 π☾ ∓ s☉ + π☉), umbral and penumbral magnitudes (ρ + s☾ − d) / 2s☾ with d
 *    the Moon's distance from the axis: total ≥ 1, partial > 0, penumbral when only the penumbral one is positive.
 *    Magnitude: the umbral one, or the penumbral one for a penumbral eclipse.
 */
import { moon } from './moon.js';
import { sun } from './sun.js';
import { brent } from './search.js';

const RAD = Math.PI / 180;
const EARTH_KM = 6378.137;
const MOON_KM = 1737.4;
/** The Moon's radius in Earth equatorial radii (Espenak's k for the umbral contacts of solar eclipses). */
const MOON_K = 0.272281;
const POS = { lon: true, lat: true, dist: true };

/**
 * Meeus 54 at lunation k (an integer: new Moon; + 0.5: full Moon): {solar, jde, gamma, u}, or null when the Moon is
 * too far from a node (|sin F| > 0.36).
 */
export function meeusEclipse(k) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4) * RAD;
  if (Math.abs(Math.sin(F)) > 0.36) return null;
  const solar = Number.isInteger(k);
  const jde0 = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3) * RAD;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4) * RAD;
  const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3) * RAD;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const F1 = F - 0.02665 * RAD * Math.sin(Om);
  const A1 = (299.77 + 0.107408 * k - 0.009173 * T2) * RAD;
  const s = Math.sin;
  const c = Math.cos;
  let jde = jde0 + (solar ? -0.4075 * s(Mp) + 0.1721 * E * s(M) : -0.4065 * s(Mp) + 0.1727 * E * s(M));
  jde +=
    0.0161 * s(2 * Mp) -
    0.0097 * s(2 * F1) +
    0.0073 * E * s(Mp - M) -
    0.005 * E * s(Mp + M) -
    0.0023 * s(Mp - 2 * F1) +
    0.0021 * E * s(2 * M) +
    0.0012 * s(Mp + 2 * F1) +
    0.0006 * E * s(2 * Mp + M) -
    0.0004 * s(3 * Mp) -
    0.0003 * E * s(M + 2 * F1) +
    0.0003 * s(A1) -
    0.0002 * E * s(M - 2 * F1) -
    0.0002 * E * s(2 * Mp - M) -
    0.0002 * s(Om);
  const P =
    0.207 * E * s(M) + 0.0024 * E * s(2 * M) - 0.0392 * s(Mp) + 0.0116 * s(2 * Mp) - 0.0073 * E * s(Mp + M) + 0.0067 * E * s(Mp - M) + 0.0118 * s(2 * F1);
  const Q = 5.2207 - 0.0048 * E * c(M) + 0.002 * E * c(2 * M) - 0.3299 * c(Mp) - 0.006 * E * c(Mp + M) + 0.0041 * E * c(Mp - M);
  const W = Math.abs(c(F1));
  const gamma = (P * c(F1) + Q * s(F1)) * (1 - 0.0048 * W);
  const u = 0.0059 + 0.0046 * E * c(M) - 0.0182 * c(Mp) + 0.0004 * c(2 * Mp) - 0.0005 * c(M + Mp);
  return { solar, jde, gamma, u };
}

/**
 * The geometry at JDE: d (radians) the geocentric angle Moon–Sun (solar) or Moon–antisolar point (lunar), the Moon's
 * distance (km), the Earth–Sun distance R (AU), gamma (signed, Earth radii) and the Moon's latitude relative to the Sun
 * or the shadow (for the sign).
 */
function geometry(jde, solar) {
  const m = moon(jde, POS);
  const sl = sun(jde, { withNutation: false });
  const ls = (solar ? sl.apparent : sl.apparent + 180) * RAD;
  const bs = (solar ? sl.beta : -sl.beta) * RAD;
  const lm = m.lambda * RAD;
  const bm = m.beta * RAD;
  const x1 = Math.cos(bm) * Math.cos(lm);
  const y1 = Math.cos(bm) * Math.sin(lm);
  const z1 = Math.sin(bm);
  const x2 = Math.cos(bs) * Math.cos(ls);
  const y2 = Math.cos(bs) * Math.sin(ls);
  const z2 = Math.sin(bs);
  // the cross product's length keeps small angles accurate
  const cr = Math.hypot(y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2);
  const d = Math.atan2(cr, x1 * x2 + y1 * y2 + z1 * z2);
  const axis = m.dist * Math.sin(d);
  return { d, dist: m.dist, R: sl.R, axis, gamma: (bm >= bs ? 1 : -1) * (axis / EARTH_KM) };
}

/** Greatest eclipse near `jde`: the least axis distance within ±3 hours (`jde` itself when that is not bracketed). */
function greatest(jde, solar) {
  const h = 0.0005;
  const rate = (t) => geometry(t + h, solar).axis - geometry(t - h, solar).axis;
  const a = jde - 0.125;
  const b = jde + 0.125;
  const fa = rate(a);
  const fb = rate(b);
  if (!(fa < 0 && fb > 0)) return jde;
  return brent(rate, a, b, fa, fb, 1e-6);
}

/** {kind, magnitude} of a solar eclipse, or null. */
function solarCircumstances(gamma, u, g) {
  const ag = Math.abs(gamma);
  if (ag >= 1.5433 + u) return null;
  let kind;
  if (ag < 0.9972) {
    if (u < 0) kind = 'total';
    else if (u > 0.0047) kind = 'annular';
    else kind = u < 0.00464 * Math.sqrt(1 - gamma * gamma) ? 'hybrid' : 'annular';
  } else if (ag < 0.9972 + Math.abs(u)) kind = u < 0 ? 'total' : 'annular';
  else kind = 'partial';
  if (kind === 'partial') return { kind, magnitude: (1.5433 + u - ag) / (0.5461 + 2 * u) };
  // the Moon's apparent diameter from the point of greatest eclipse over the Sun's
  const topo = g.dist - EARTH_KM * Math.sqrt(1 - Math.min(1, ag) ** 2);
  const moonSd = Math.asin((MOON_K * EARTH_KM) / topo);
  const sunSd = (959.63 / 3600 / g.R) * RAD;
  return { kind, magnitude: moonSd / sunSd };
}

/** {kind, magnitude} of a lunar eclipse, or null. */
function lunarCircumstances(g) {
  const pim = Math.asin(EARTH_KM / g.dist) * 0.99834; // the parallax for a mean radius of the oblate Earth
  const sm = Math.asin(MOON_KM / g.dist);
  const ss = ((959.63 / 3600) * RAD) / g.R;
  const pis = ((8.794 / 3600) * RAD) / g.R;
  const umbra = 1.02 * (pim - ss + pis);
  const penumbra = 1.02 * (pim + ss + pis);
  const umb = (umbra + sm - g.d) / (2 * sm);
  const pen = (penumbra + sm - g.d) / (2 * sm);
  if (!(pen > 0)) return null;
  const kind = umb >= 1 ? 'total' : umb > 0 ? 'partial' : 'penumbral';
  return { kind, magnitude: kind === 'penumbral' ? pen : umb };
}

/** Eclipses with greatest eclipse in the TT window [a, b) (JDE): [{name, jde, kind, magnitude, gamma}]. */
export function eclipseEvents(a, b) {
  const out = [];
  const k0 = Math.floor((a - 2451550.09766) / 29.530588861) - 1;
  const k1 = Math.ceil((b - 2451550.09766) / 29.530588861) + 1;
  for (let k2 = 2 * k0; k2 <= 2 * k1; k2++) {
    const e = meeusEclipse(k2 / 2);
    if (!e) continue;
    const jde = greatest(e.jde, e.solar);
    if (!(jde >= a && jde < b)) continue;
    const g = geometry(jde, e.solar);
    const c = e.solar ? solarCircumstances(g.gamma, e.u, g) : lunarCircumstances(g);
    if (c) out.push({ name: e.solar ? 'solar-eclipse' : 'lunar-eclipse', jde, kind: c.kind, magnitude: c.magnitude, gamma: g.gamma });
  }
  return out;
}
