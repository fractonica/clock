/**
 * Event search on smooth functions of time: bracket by stepping, then refine with Brent's method.
 * Times are JDE (days); every bracket is found by a scan whose step is small enough that no two events of one kind fall
 * into one step. The scan runs on a fixed grid (multiples of the step), so an event gets the same bracket – and the same
 * time to the last bit – whatever window it is searched in.
 */

/** Degrees reduced to [0, 360). */
export const wrap360 = (x) => {
  const r = x % 360;
  return r < 0 ? r + 360 : r;
};
/** Degrees reduced to [−180, 180). */
export const wrap180 = (x) => wrap360(x + 180) - 180;

/** Default tolerance: 1e-7 day ≈ 9 ms. */
export const TOL = 1e-7;

/**
 * Brent's root finder (van Wijngaarden–Dekker–Brent) for f on [a, b] with f(a), f(b) of opposite signs (or zero).
 */
export function brent(f, a, b, fa = f(a), fb = f(b), tol = TOL) {
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa > 0 === fb > 0) throw new RangeError('brent: the root is not bracketed');
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < 100; i++) {
    if (fb > 0 === fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p;
      let q;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
    fb = f(b);
  }
  return b;
}

/**
 * Instants in [a, b) where a monotonically increasing angle (degrees, any winding) passes each of `targets`.
 * `angle(t)` must advance less than the smallest gap between targets within one `step`.
 * Returns [{jde, target}] in time order.
 */
export function angleCrossings(angle, a, b, step, targets) {
  const out = [];
  let t0 = Math.floor(a / step) * step;
  let v0 = angle(t0);
  while (t0 < b) {
    const t1 = t0 + step;
    const v1 = angle(t1);
    const dv = wrap360(v1 - v0);
    for (const target of targets) {
      const off = wrap360(target - v0);
      if (off > 0 && off <= dv) {
        const g = (t) => wrap180(angle(t) - target);
        const jde = brent(g, t0, t1, -off, dv - off);
        if (jde >= a && jde < b) out.push({ jde, target });
      }
    }
    t0 = t1;
    v0 = v1;
  }
  return out;
}

/**
 * Sign changes of f in [a, b): [{jde, rising}] (rising: f goes from negative to non-negative).
 * f must change sign at most once per `step`.
 */
export function signChanges(f, a, b, step) {
  const out = [];
  let t0 = Math.floor(a / step) * step;
  let f0 = f(t0);
  while (t0 < b) {
    const t1 = t0 + step;
    const f1 = f(t1);
    if (f0 < 0 !== f1 < 0) {
      const jde = brent(f, t0, t1, f0, f1);
      if (jde >= a && jde < b) out.push({ jde, rising: f0 < 0 });
    }
    t0 = t1;
    f0 = f1;
  }
  return out;
}
