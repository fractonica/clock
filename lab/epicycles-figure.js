/**
 * The epicycle figure, without the DOM (checked by test/epicycles-lab.test.js). On circular orbits these are the iOS
 * face's rules (ios/Fractonica/Features/Face/Epicycles/EpicycleGeometry.swift), so a figure found here looks the same
 * there; the lab adds Keplerian orbits.
 *
 * A ladder of arms from a base level down to a top level, one arm a level, each turning with its own period on the tip
 * of the one before. Children divide their parent exactly (in Saros position), so arm k's phase is frac(N_k · φ) with
 * φ the base's phase and N_k the product of the factors from the base down to k: the whole figure is a function of φ
 * and closes after exactly one base cycle.
 *
 * Each arm is the radius vector of an orbit with the tip that carries it at a focus: its length is the orbit's
 * semi-major axis, its eccentricity 0 (a circle, the iOS face) … ECC_MAX, its periapsis in a direction of its own. The
 * arm's phase is the orbit's mean anomaly, so it still goes round exactly once a cycle of its period; at the cycle's
 * start it stands at periapsis, and it sweeps equal areas in equal times (Kepler's second law), fastest at periapsis.
 *
 * Angles are turns, 0 at the top, clockwise (on a circle with the periapsis up: right at the peak ¼, bottom at the
 * node ½, left at the valley ¾). Points are in reach units (the orbits' farthest points together reach 1), y down.
 */

/** Arms on one face, base and top included (as the iOS face). */
export const MAX_ARMS = 6;
/** The deepest level with an arm (ξ, depth 14). */
export const DEEPEST = 13;
/** An arm's length (semi-major axis), relative to the others. */
export const RADIUS_MIN = 0.01;
export const RADIUS_MAX = 10;
/** The iOS face keeps lengths between these (it draws the same figure: lengths are proportions). */
export const IOS_RADIUS_MIN = 0.01;
export const IOS_RADIUS_MAX = 1;
/** The most eccentric orbit. */
export const ECC_MAX = 0.95;
/** The default lengths by place on the ladder, base first. */
export const DEFAULT_RADII = [1, 0.4, 0.1, 0.03, 0.014, 0.01];

/** The iOS face's default: η down to κ, circles. */
export const STANDARD = Object.freeze({ base: 6, top: 9, radii: {}, ecc: {}, peri: {}, off: [], reversed: [], frame: 'dial', tips: true });

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const frac = (x) => x - Math.floor(x);

/** The tops a base allows: one level deeper, up to MAX_ARMS arms and ξ. */
export function topsFor(base) {
  return { min: base + 1, max: Math.min(base + MAX_ARMS - 1, DEEPEST) };
}

/** The arm length (semi-major axis) of `level` in `config` (set by hand, else the default for its place). */
export function radiusOf(config, level) {
  const set = config.radii[level];
  if (Number.isFinite(set)) return clamp(set, RADIUS_MIN, RADIUS_MAX);
  return DEFAULT_RADII[Math.min(Math.max(level - config.base, 0), DEFAULT_RADII.length - 1)];
}

/** The eccentricity of `level`'s orbit (0 a circle). */
export function eccOf(config, level) {
  const e = config.ecc?.[level];
  return Number.isFinite(e) ? clamp(e, 0, ECC_MAX) : 0;
}

/** The direction of `level`'s periapsis, in degrees clockwise from the top (or from its carrier, in that frame). */
export function periOf(config, level) {
  const w = config.peri?.[level];
  return Number.isFinite(w) ? ((w % 360) + 360) % 360 : 0;
}

/** A config with every field valid: anything out of range takes the standard's value. */
export function sanitize(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const base = Number.isInteger(c.base) && c.base >= 0 && c.base <= DEEPEST - 1 ? c.base : STANDARD.base;
  const tops = topsFor(base);
  let top = Number.isInteger(c.top) ? c.top : STANDARD.top;
  if (top < tops.min || top > tops.max) top = clamp(top, tops.min, tops.max);
  // by level, each value fixed into range; a circle's 0 is the default, so it is left out
  const byLevel = (map, fix, keepZero = true) => {
    const out = {};
    for (const [k, v] of Object.entries(map ?? {})) {
      const level = Number(k);
      if (!Number.isInteger(level) || level < 0 || level > DEEPEST || !Number.isFinite(v)) continue;
      const x = fix(v);
      if (keepZero || x !== 0) out[level] = x;
    }
    return out;
  };
  const levels = (xs) => [...new Set((Array.isArray(xs) ? xs : []).filter((l) => Number.isInteger(l) && l >= 0 && l <= DEEPEST))].sort((a, b) => a - b);
  // the pen's arm stays on
  const off = levels(c.off).filter((l) => l !== top);
  return {
    base,
    top,
    radii: byLevel(c.radii, (v) => clamp(v, RADIUS_MIN, RADIUS_MAX)),
    ecc: byLevel(c.ecc, (v) => clamp(v, 0, ECC_MAX), false),
    peri: byLevel(c.peri, (v) => ((v % 360) + 360) % 360, false),
    off,
    reversed: levels(c.reversed),
    frame: c.frame === 'carrier' ? 'carrier' : 'dial',
    tips: c.tips !== false,
  };
}

/** Whether any arm on the ladder has an elliptic orbit. */
export function hasEllipses(config) {
  for (let l = config.base; l <= config.top; l++) if (eccOf(config, l) > 0) return true;
  return false;
}

/**
 * The figure's arms, base first: { level, cycles, sign, own, turns, length, ecc, peri, relative }. `cycles` is the
 * arm's cycles in one base cycle, `own` the same signed by its direction; `turns` its mean turns about the dial in one
 * base cycle (in the carrier frame its own on top of its carrier's); `length` its semi-major axis in reach units (the
 * orbits' farthest points, a(1 + e), of the arms that are on sum to 1; 0 when off); `ecc` its eccentricity; `peri`
 * its periapsis direction in turns; `relative` true when angles count from the carrier.
 */
export function arms(config, factorOf) {
  const levels = [];
  for (let l = config.base; l <= config.top; l++) levels.push(l);
  const on = (l) => !config.off.includes(l);
  const total = levels.filter(on).reduce((s, l) => s + radiusOf(config, l) * (1 + eccOf(config, l)), 0);
  const relative = config.frame === 'carrier';
  let cycles = 1;
  let carried = 0;
  return levels.map((level) => {
    if (level > config.base) cycles *= factorOf(level - 1);
    const sign = config.reversed.includes(level) ? -1 : 1;
    const own = sign * cycles;
    const turns = relative ? carried + own : own;
    carried = turns;
    const length = on(level) && total > 0 ? radiusOf(config, level) / total : 0;
    return { level, cycles, sign, own, turns, length, ecc: eccOf(config, level), peri: periOf(config, level) / 360, relative };
  });
}

/**
 * Kepler's equation: at mean anomaly `mean` (turns, 0 ..< 1) on an orbit of eccentricity e, the true anomaly `nu`
 * (turns from periapsis, 0 ..< 1) and the distance from the focus `r` in semi-major axes.
 */
export function kepler(mean, e) {
  if (e === 0) return { nu: mean, r: 1 };
  const M = 2 * Math.PI * mean;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 40; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return { nu: frac(nu / (2 * Math.PI)), r: 1 - e * Math.cos(E) };
}

/**
 * Arm `arm`'s own angle `phase` into the base cycle, in turns (0 ..< 1), and its distance from its pivot in reach
 * units: on a circle with the periapsis up, the arm's own phase (reversed: 1 − phase).
 */
export function orbit(arm, phase) {
  const k = kepler(frac(arm.cycles * phase), arm.ecc);
  return { angle: frac(arm.peri + arm.sign * k.nu), r: arm.length * k.r };
}

/** Arm `arm`'s own angle `phase` into the base cycle, in turns, 0 ..< 1. */
export function angle(arm, phase) {
  return orbit(arm, phase).angle;
}

/**
 * The figure at `phase` into the base cycle: `joints`, the hub and every arm's tip (arms.length + 1 points [x, y]);
 * `frames`, each arm's reference direction in turns (0, or its carrier's angle when angles count from the carrier);
 * `angles`, each arm's direction about the dial.
 */
export function pose(list, phase) {
  let x = 0;
  let y = 0;
  let carrier = 0;
  const joints = [[0, 0]];
  const frames = [];
  const angles = [];
  for (const arm of list) {
    const { angle: own, r } = orbit(arm, phase);
    const reference = arm.relative ? carrier : 0;
    const a = frac(reference + own);
    frames.push(reference);
    angles.push(a);
    carrier = a;
    if (arm.length > 0) {
      x += r * Math.sin(2 * Math.PI * a);
      y -= r * Math.cos(2 * Math.PI * a);
    }
    joints.push([x, y]);
  }
  return { joints, frames, angles };
}

/** The hub and every arm's tip `phase` into the base cycle: arms.length + 1 points [x, y]. */
export function joints(list, phase) {
  return pose(list, phase).joints;
}

/** How much faster than its mean an orbit of eccentricity e turns at periapsis: (1 + e)² / (1 − e²)^1.5. */
export function peakSpeed(e) {
  return e === 0 ? 1 : (1 + e) ** 2 / (1 - e * e) ** 1.5;
}

/** Samples a turn of the fastest arm drawn as a curve, and the most a figure takes. */
export const SAMPLES_PER_TURN = 40;
export const MAX_SAMPLES = 480_000;

/**
 * How much of the figure a curve can hold: the arms base first while each one's loops stay `minSpacing` points apart
 * along its carrier's path at `scale` points to the reach, its own size is at least `minSize` points, and its turns fit
 * the sample budget; the arms that are on past it fold into a band (their reaches together its half-width).
 * Returns { detail (index of the finest arm drawn as a curve), band (reach units), bandLevel, samples }.
 */
export function detailFor(list, scale, { minSpacing = 2, minSize = 0.5 } = {}) {
  let detail = 0;
  let pathLength = 0; // the carrier's path length per base cycle, in points
  for (let i = 0; i < list.length; i++) {
    const arm = list[i];
    if (arm.length === 0) {
      detail = i;
      continue;
    }
    const turns = Math.abs(arm.turns);
    const size = arm.length * (1 + arm.ecc) * scale;
    if (i > 0) {
      const spacing = pathLength / Math.max(1, turns);
      if (size < minSize || spacing < minSpacing || turns * SAMPLES_PER_TURN > MAX_SAMPLES) break;
    }
    // the tip's path is at most its carrier's path plus its own orbits
    pathLength += 2 * Math.PI * size * turns;
    detail = i;
  }
  const folded = list.slice(detail + 1).filter((a) => a.length > 0);
  const band = folded.reduce((s, a) => s + a.length * (1 + a.ecc), 0);
  // an eccentric orbit needs more samples where it whips round its periapsis (at most 16 times as many)
  const fastest = list.slice(0, detail + 1).reduce((m, a) => Math.max(m, Math.abs(a.turns) * Math.min(16, peakSpeed(a.ecc))), 1);
  const samples = Math.round(Math.min(MAX_SAMPLES, Math.max(720, fastest * SAMPLES_PER_TURN)));
  return { detail, band, bandLevel: folded.length ? folded[folded.length - 1].level : null, samples };
}

/**
 * Every tip's path over a base cycle, arms up to `detail`: tips[i] a Float32Array of x, y pairs at phases 0, 1/n … 1
 * (n + 1 points, the last the first again).
 */
export function curve(list, detail, samples) {
  const used = list.slice(0, detail + 1);
  const tips = used.map(() => new Float32Array((samples + 1) * 2));
  for (let s = 0; s <= samples; s++) {
    const { joints: js } = pose(used, s / samples);
    for (let i = 0; i < used.length; i++) {
      tips[i][2 * s] = js[i + 1][0];
      tips[i][2 * s + 1] = js[i + 1][1];
    }
  }
  return tips;
}

/** Each arm's length scaled so the longest is 1, as the iOS face keeps them (the figure is the same: proportions). */
export function iosRadii(config) {
  const levels = [];
  for (let l = config.base; l <= config.top; l++) levels.push(l);
  const longest = Math.max(...levels.map((l) => radiusOf(config, l)));
  return levels.map((l) => clamp(radiusOf(config, l) / longest, IOS_RADIUS_MIN, IOS_RADIUS_MAX));
}

/** The iOS launch arguments that show this figure in the simulator (circles: the face has no ellipses). */
export function launchArguments(config) {
  const radii = iosRadii(config).map((r) => +r.toPrecision(3)).join(',');
  const args = ['-FXFace epicycles', `-FXEpicycles ${config.base}-${config.top}`, `-FXEpicycleRadii ${radii}`];
  const off = config.off.filter((l) => l >= config.base && l <= config.top);
  const reversed = config.reversed.filter((l) => l >= config.base && l <= config.top);
  if (off.length) args.push(`-FXEpicycleOff ${off.join(',')}`);
  if (reversed.length) args.push(`-FXEpicycleReverse ${reversed.join(',')}`);
  if (config.frame !== 'dial') args.push(`-FXEpicycleFrame ${config.frame}`);
  if (!config.tips) args.push('-FXEpicycleTips 0');
  return args.join(' ');
}

/**
 * The config in a URL hash and back: "#6-9;r=1,0.4,0.1,0.03;e=0,0.5,0,0;w=0,90,0,0;off=;rev=8;f=carrier;tips=0"
 * (lengths, eccentricities and periapsis directions in degrees by place on the ladder, base first).
 */
export function toHash(config) {
  const levels = [];
  for (let l = config.base; l <= config.top; l++) levels.push(l);
  const list = (f) => levels.map((l) => +f(config, l).toPrecision(3)).join(',');
  const parts = [`${config.base}-${config.top}`, `r=${list(radiusOf)}`];
  if (levels.some((l) => eccOf(config, l) > 0)) parts.push(`e=${list(eccOf)}`);
  if (levels.some((l) => periOf(config, l) > 0)) parts.push(`w=${list(periOf)}`);
  if (config.off.length) parts.push(`off=${config.off.join(',')}`);
  if (config.reversed.length) parts.push(`rev=${config.reversed.join(',')}`);
  if (config.frame !== 'dial') parts.push(`f=${config.frame}`);
  if (!config.tips) parts.push('tips=0');
  return parts.join(';');
}

export function fromHash(hash) {
  const text = decodeURIComponent(String(hash ?? '').replace(/^#/, ''));
  const [ladder, ...rest] = text.split(';');
  const m = /^(\d+)-(\d+)$/.exec(ladder ?? '');
  if (!m) return null;
  const raw = { base: +m[1], top: +m[2], radii: {}, ecc: {}, peri: {}, off: [], reversed: [], frame: 'dial', tips: true };
  const list = (v) => (v ? v.split(',').map(Number) : []);
  const byPlace = (map, v) => list(v).forEach((x, i) => { map[raw.base + i] = x; });
  for (const part of rest) {
    const [k, v = ''] = part.split('=');
    if (k === 'r') byPlace(raw.radii, v);
    else if (k === 'e') byPlace(raw.ecc, v);
    else if (k === 'w') byPlace(raw.peri, v);
    else if (k === 'off') raw.off = list(v);
    else if (k === 'rev') raw.reversed = list(v);
    else if (k === 'f') raw.frame = v;
    else if (k === 'tips') raw.tips = v !== '0';
  }
  return sanitize(raw);
}
