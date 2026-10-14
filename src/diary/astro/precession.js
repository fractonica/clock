/**
 * Precession of ecliptic coordinates – Meeus, Astronomical Algorithms (2nd ed.), chapter 21, formulae 21.5–21.7
 * (rigorous: the ecliptic of the starting epoch moves as well as the equinox). Times are JDE (TT).
 */

const RAD = Math.PI / 180;
const AS = 1 / 3600; // one arcsecond in degrees

/**
 * Ecliptic longitude/latitude (degrees) referred to the mean ecliptic and equinox of `from` → those of `to`.
 * Returns {lambda in [0, 360), beta}.
 */
export function precessEcliptic(lambda, beta, from, to) {
  const T = (from - 2451545) / 36525;
  const t = (to - from) / 36525;
  const T2 = T * T;
  const t2 = t * t;
  const t3 = t2 * t;
  const eta = ((47.0029 - 0.06603 * T + 0.000598 * T2) * t + (-0.03302 + 0.000598 * T) * t2 + 0.00006 * t3) * AS * RAD;
  const Pi = (174.876384 + (3289.4789 * T + 0.60622 * T2) * AS - (869.8089 + 0.50491 * T) * t * AS + 0.03536 * t2 * AS) * RAD;
  const p = ((5029.0966 + 2.22226 * T - 0.000042 * T2) * t + (1.11113 - 0.000042 * T) * t2 - 0.000006 * t3) * AS * RAD;
  const l0 = lambda * RAD;
  const b0 = beta * RAD;
  const ce = Math.cos(eta);
  const se = Math.sin(eta);
  const cb = Math.cos(b0);
  const sb = Math.sin(b0);
  const s = Math.sin(Pi - l0);
  const A = ce * cb * s - se * sb;
  const B = cb * Math.cos(Pi - l0);
  const C = ce * sb + se * cb * s;
  let l = (p + Pi - Math.atan2(A, B)) / RAD;
  l %= 360;
  if (l < 0) l += 360;
  return { lambda: l, beta: Math.asin(Math.max(-1, Math.min(1, C))) / RAD };
}

/** Of-date ecliptic coordinates at JDE → the fixed mean ecliptic and equinox of J2000.0. */
export const toJ2000 = (lambda, beta, jde) => precessEcliptic(lambda, beta, jde, 2451545);
