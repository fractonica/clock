/**
 * The planets seen from the Earth: Mercury, Venus, Mars, Jupiter and Saturn from the truncated VSOP87D series
 * (vsop87.js), the Earth from sun.js (Meeus' abridged VSOP87D, the same frame: dynamical ecliptic and equinox of the
 * date). Geocentric positions are corrected for light-time (the planet where it was when its light left) and annual
 * aberration (Meeus 23.2, without the e-terms), so that they compare with the Sun's apparent longitude; nutation is left
 * out of both since only differences matter here. Accuracy a few arcseconds over 1613–2857. Time is JDE (TT).
 *
 * Events (planetEvents):
 *   Mercury, Venus   greatest elongation east / west (a maximum of the angular distance from the Sun, the planet
 *                    east = evening or west = morning of it); inferior / superior conjunction (geocentric ecliptic
 *                    longitude equal to the Sun's, the planet nearer / farther than the Sun)
 *   Mars, Jupiter,   opposition / conjunction (geocentric ecliptic longitude 180° from / equal to the Sun's)
 *   Saturn
 */
import { MERCURY, VENUS, MARS, JUPITER, SATURN } from './vsop87.js';
import { earth } from './sun.js';
import { angleCrossings, signChanges, wrap180, wrap360 } from './search.js';

const RAD = Math.PI / 180;
/** Light-time for one AU (days). */
const LIGHT_DAY_PER_AU = 0.0057755183;
/** Constant of aberration (degrees). */
const KAPPA = 20.49552 / 3600;

const SERIES = { mercury: MERCURY, venus: VENUS, mars: MARS, jupiter: JUPITER, saturn: SATURN };
export const PLANETS = Object.freeze(['mercury', 'venus', 'mars', 'jupiter', 'saturn']);
export const INNER = Object.freeze(['mercury', 'venus']);

function series(groups, tau) {
  let v = 0;
  let tk = 1;
  for (const g of groups) {
    let s = 0;
    for (let i = 0; i < g.length; i += 3) s += g[i] * Math.cos(g[i + 1] + g[i + 2] * tau);
    v += s * tk;
    tk *= tau;
  }
  return v / 1e10;
}

/** Heliocentric L, B (radians, not reduced) and R (AU) of a planet at JDE (VSOP87D, ecliptic and equinox of date). */
export function heliocentric(planet, jde) {
  const s = SERIES[planet];
  const tau = (jde - 2451545) / 365250;
  return { L: series(s.L, tau), B: series(s.B, tau), R: series(s.R, tau) };
}

const rect = (p) => {
  const cb = Math.cos(p.B);
  return [p.R * cb * Math.cos(p.L), p.R * cb * Math.sin(p.L), p.R * Math.sin(p.B)];
};

/**
 * The planet seen from the Earth's centre at JDE: {lambda, beta (degrees; lambda in [0, 360)), delta (AU), sun (the
 * Sun's apparent longitude without nutation, degrees), R (Earth–Sun distance, AU)}.
 */
export function geocentric(planet, jde) {
  const e = earth(jde);
  const E = rect(e);
  let delta = 0;
  let x;
  let y;
  let z;
  // light-time: two iterations reach a few milliseconds
  for (let i = 0; i < 3; i++) {
    const P = rect(heliocentric(planet, jde - delta * LIGHT_DAY_PER_AU));
    x = P[0] - E[0];
    y = P[1] - E[1];
    z = P[2] - E[2];
    delta = Math.hypot(x, y, z);
  }
  const lam = Math.atan2(y, x) / RAD;
  const beta = Math.atan2(z, Math.hypot(x, y)) / RAD;
  const sunGeo = e.L / RAD + 180;
  // annual aberration (Meeus 23.2); the Sun's is −κ / R
  const lambda = lam + (-KAPPA * Math.cos((sunGeo - lam) * RAD)) / Math.cos(beta * RAD);
  const b = beta - KAPPA * Math.sin(beta * RAD) * Math.sin((sunGeo - lam) * RAD);
  return { lambda: wrap360(lambda), beta: b, delta, sun: wrap360(sunGeo - KAPPA / e.R), R: e.R };
}

/** Elongation in longitude, λ − λ☉, in [−180, 180) degrees. */
export const longitudeFromSun = (planet, jde) => {
  const g = geocentric(planet, jde);
  return wrap180(g.lambda - g.sun);
};

/** The angular distance from the Sun (degrees) and its sign (east +, west −). */
export function elongation(planet, jde) {
  const g = geocentric(planet, jde);
  const dl = (g.lambda - g.sun) * RAD;
  const cb = Math.cos(g.beta * RAD);
  const E = Math.atan2(Math.hypot(cb * Math.sin(dl), Math.sin(g.beta * RAD)), cb * Math.cos(dl)) / RAD;
  return { E, east: Math.sin(dl) > 0 };
}

// Scan steps (days): Mercury's conjunctions are ≥ 40 days apart and a greatest elongation ≥ 16 days from a conjunction;
// Venus' ≥ 140 / 60 days; the Sun gains on an outer planet at 0.2–1.4° a day.
const STEP = { mercury: 3, venus: 8, mars: 10, jupiter: 10, saturn: 10 };
const H = 0.01;

/** Raw planetary events in the TT window [a, b) (JDE): [{name, jde, elongation?, dist}]. */
export function planetEvents(a, b) {
  const out = [];
  for (const p of PLANETS) {
    const step = STEP[p];
    if (INNER.includes(p)) {
      for (const c of signChanges((t) => longitudeFromSun(p, t), a, b, step)) {
        const g = geocentric(p, c.jde);
        out.push({ name: `${p}-${g.delta < g.R ? 'inferior' : 'superior'}-conjunction`, jde: c.jde, dist: g.delta });
      }
      const rate = (t) => elongation(p, t + H).E - elongation(p, t - H).E;
      for (const c of signChanges(rate, a, b, step)) {
        if (c.rising) continue; // a least elongation, near a conjunction
        const el = elongation(p, c.jde);
        out.push({ name: `${p}-elongation-${el.east ? 'east' : 'west'}`, jde: c.jde, elongation: el.E, dist: geocentric(p, c.jde).delta });
      }
    } else {
      const behind = (t) => {
        const g = geocentric(p, t);
        return g.sun - g.lambda;
      };
      for (const c of angleCrossings(behind, a, b, step, [0, 180])) {
        out.push({ name: `${p}-${c.target ? 'opposition' : 'conjunction'}`, jde: c.jde, dist: geocentric(p, c.jde).delta });
      }
    }
  }
  return out;
}
