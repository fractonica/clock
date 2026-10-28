/**
 * The epicycle figure, without the DOM (checked by test/epicycles-lab.test.js): the same rules as the iOS face
 * (ios/Fractonica/Features/Face/Epicycles/EpicycleGeometry.swift), so a figure found here looks the same there.
 *
 * A ladder of arms from a base level down to a top level, one arm a level, each turning with its own period's phase on
 * the tip of the one before. Children divide their parent exactly (in Saros position), so arm k's phase is
 * frac(N_k · φ) with φ the base's phase and N_k the product of the factors from the base down to k: the whole figure
 * is a function of φ and closes after exactly one base cycle.
 *
 * Angles are turns, 0 at the top, clockwise (right at the peak ¼, bottom at the node ½, left at the valley ¾). Points
 * are in reach units (the arms that are on together reach 1), y down.
 */

/** Arms on one face, base and top included (as the iOS face). */
export const MAX_ARMS = 6;
/** The deepest level with an arm (ξ, depth 14). */
export const DEEPEST = 13;
/** An arm's length, relative to the others (as the iOS face). */
export const RADIUS_MIN = 0.01;
export const RADIUS_MAX = 1;
/** The default lengths by place on the ladder, base first. */
export const DEFAULT_RADII = [1, 0.4, 0.1, 0.03, 0.014, 0.01];

/** The iOS face's default: η down to κ. */
export const STANDARD = Object.freeze({ base: 6, top: 9, radii: {}, off: [], reversed: [], frame: 'dial', tips: true });

const clampRadius = (r) => Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, r));

/** The tops a base allows: one level deeper, up to MAX_ARMS arms and ξ. */
export function topsFor(base) {
  return { min: base + 1, max: Math.min(base + MAX_ARMS - 1, DEEPEST) };
}

/** The arm length of `level` in `config` (set by hand, else the default for its place). */
export function radiusOf(config, level) {
  const set = config.radii[level];
  if (Number.isFinite(set)) return clampRadius(set);
  return DEFAULT_RADII[Math.min(Math.max(level - config.base, 0), DEFAULT_RADII.length - 1)];
}

/** A config with every field valid: anything out of range takes the standard's value. */
export function sanitize(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const base = Number.isInteger(c.base) && c.base >= 0 && c.base <= DEEPEST - 1 ? c.base : STANDARD.base;
  const tops = topsFor(base);
  let top = Number.isInteger(c.top) ? c.top : STANDARD.top;
  if (top < tops.min || top > tops.max) top = Math.min(tops.max, Math.max(tops.min, top));
  const radii = {};
  for (const [k, v] of Object.entries(c.radii ?? {})) {
    const level = Number(k);
    if (Number.isInteger(level) && level >= 0 && level <= DEEPEST && Number.isFinite(v)) radii[level] = clampRadius(v);
  }
  const levels = (xs) => [...new Set((Array.isArray(xs) ? xs : []).filter((l) => Number.isInteger(l) && l >= 0 && l <= DEEPEST))].sort((a, b) => a - b);
  // the pen's arm stays on
  const off = levels(c.off).filter((l) => l !== top);
  return {
    base,
    top,
    radii,
    off,
    reversed: levels(c.reversed),
    frame: c.frame === 'carrier' ? 'carrier' : 'dial',
    tips: c.tips !== false,
  };
}

/**
 * The figure's arms, base first: { level, cycles, sign, turns, length }. `cycles` is the arm's cycles in one base
 * cycle; `turns` its signed turns about the dial in one (in the carrier frame its own on top of its carrier's);
 * `length` its share of the reach (the arms that are on sum to 1, 0 when off).
 */
export function arms(config, factorOf) {
  const levels = [];
  for (let l = config.base; l <= config.top; l++) levels.push(l);
  const on = (l) => !config.off.includes(l);
  const total = levels.filter(on).reduce((s, l) => s + radiusOf(config, l), 0);
  let cycles = 1;
  let carried = 0;
  return levels.map((level) => {
    if (level > config.base) cycles *= factorOf(level - 1);
    const sign = config.reversed.includes(level) ? -1 : 1;
    const own = sign * cycles;
    const turns = config.frame === 'dial' ? own : carried + own;
    carried = turns;
    const length = on(level) && total > 0 ? radiusOf(config, level) / total : 0;
    return { level, cycles, sign, turns, length };
  });
}

/** Arm i's angle `phase` (0 … 1) into the base cycle, in turns, 0 ..< 1. */
export function angle(arm, phase) {
  const x = arm.turns * phase;
  return x - Math.floor(x);
}

/** The hub and every arm's tip `phase` into the base cycle: arms.length + 1 points [x, y]. */
export function joints(list, phase) {
  let x = 0;
  let y = 0;
  const out = [[0, 0]];
  for (const arm of list) {
    if (arm.length > 0) {
      const a = 2 * Math.PI * angle(arm, phase);
      x += arm.length * Math.sin(a);
      y -= arm.length * Math.cos(a);
    }
    out.push([x, y]);
  }
  return out;
}

/** Samples a turn of the fastest arm drawn as a curve, and the most a figure takes. */
export const SAMPLES_PER_TURN = 40;
export const MAX_SAMPLES = 480_000;

/**
 * How much of the figure a curve can hold: the arms base first while each one's loops stay `minSpacing` points apart
 * along its carrier's path at `scale` points to the reach, its own size is at least `minSize` points, and its turns fit
 * the sample budget; the arms that are on past it fold into a band (their lengths together its half-width).
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
    const size = arm.length * scale;
    if (i > 0) {
      const spacing = pathLength / Math.max(1, turns);
      if (size < minSize || spacing < minSpacing || turns * SAMPLES_PER_TURN > MAX_SAMPLES) break;
    }
    // the tip's path is at most its carrier's path plus its own circles
    pathLength += 2 * Math.PI * size * turns;
    detail = i;
  }
  const folded = list.slice(detail + 1).filter((a) => a.length > 0);
  const band = folded.reduce((s, a) => s + a.length, 0);
  const fastest = list.slice(0, detail + 1).reduce((m, a) => Math.max(m, Math.abs(a.turns)), 1);
  const samples = Math.min(MAX_SAMPLES, Math.max(720, fastest * SAMPLES_PER_TURN));
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
    const phase = s / samples;
    let x = 0;
    let y = 0;
    for (let i = 0; i < used.length; i++) {
      const arm = used[i];
      if (arm.length > 0) {
        const a = 2 * Math.PI * angle(arm, phase);
        x += arm.length * Math.sin(a);
        y -= arm.length * Math.cos(a);
      }
      tips[i][2 * s] = x;
      tips[i][2 * s + 1] = y;
    }
  }
  return tips;
}

/** The iOS launch arguments that show this figure in the simulator (ios/ARCHITECTURE.md, "Launch arguments"). */
export function launchArguments(config) {
  const levels = [];
  for (let l = config.base; l <= config.top; l++) levels.push(l);
  const radii = levels.map((l) => +radiusOf(config, l).toPrecision(3)).join(',');
  const args = ['-FXFace epicycles', `-FXEpicycles ${config.base}-${config.top}`, `-FXEpicycleRadii ${radii}`];
  const off = config.off.filter((l) => l >= config.base && l <= config.top);
  const reversed = config.reversed.filter((l) => l >= config.base && l <= config.top);
  if (off.length) args.push(`-FXEpicycleOff ${off.join(',')}`);
  if (reversed.length) args.push(`-FXEpicycleReverse ${reversed.join(',')}`);
  if (config.frame !== 'dial') args.push(`-FXEpicycleFrame ${config.frame}`);
  if (!config.tips) args.push('-FXEpicycleTips 0');
  return args.join(' ');
}

/** The config in a URL hash ("#6-9;r=1,0.4,0.1,0.03;off=;rev=8;f=carrier;tips=0") and back. */
export function toHash(config) {
  const levels = [];
  for (let l = config.base; l <= config.top; l++) levels.push(l);
  const parts = [`${config.base}-${config.top}`, `r=${levels.map((l) => +radiusOf(config, l).toPrecision(3)).join(',')}`];
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
  const raw = { base: +m[1], top: +m[2], radii: {}, off: [], reversed: [], frame: 'dial', tips: true };
  const list = (v) => (v ? v.split(',').map(Number) : []);
  for (const part of rest) {
    const [k, v = ''] = part.split('=');
    if (k === 'r') list(v).forEach((r, i) => { raw.radii[raw.base + i] = r; });
    else if (k === 'off') raw.off = list(v);
    else if (k === 'rev') raw.reversed = list(v);
    else if (k === 'f') raw.frame = v;
    else if (k === 'tips') raw.tips = v !== '0';
  }
  return sanitize(raw);
}
