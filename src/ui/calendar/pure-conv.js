/**
 * Pure-mode calendar maths (no DOM, no Earth units): everything the pure converter, the pure month grid and the pure
 * jump box need to talk about a moment in Fractonica terms only (docs/design/80-pure.md).
 *
 * Vocabulary comes from src/core/pure.js (`pure` = createPure(model)): names, the unit ladder
 * α β γ δ½ ε½ ζ½ η ι λ μ ν ξ, the date and clock counters, the 256-state phase pair, eclipse names, cycle lengths and
 * the solar drift text. This file adds the INVERSE of those readings (a stamp -> a moment), counter editing, exact
 * landings, and the geometry of the pure month page: one δ½ as 5 rows (ε½) x 7 columns (ζ½).
 *
 * NOTATION (core/pure.js): X#n is an ORDINAL counted from 1 (ζ½#5); nX is a COUNT of units counted from 0 (3η, 17ι):
 * the clock counters are counts, the date entries are ordinals. A letter + space + number ("η 7") is only a depth chip.
 * The OLD spellings of a stamp ("δ½ 3 · ε½ 2 · ζ½ 5 · η 3 · ι 17") are still read by the jump grammar.
 *
 * Everything is computed in Saros POSITION space: the hierarchy is exactly aligned there (a ζ½ is 2/11375 of a Saros
 * unit, 7 of them make an ε½ ...), and only the last step converts a position to the Unix seconds the app runs on.
 * Which cycle / ζ½ a moment is in is always asked of the model (exact rational position), exactly like the header does:
 * no relative tolerances, so the page, the cells and the landings agree with the header at every millisecond.
 */
import { UNITS } from '../../core/pure.js';
import { POINTS, pointOfCycle, r3 } from './convert.js';
import { syncQuartersInWindow } from './month.js';

export const unitById = (id) => UNITS.find((u) => u.id === id);
const P = (model, level) => model.levelInfo(level).prefixNum;
/**
 * Absolute position tolerance, the same 1e-12 Saros (0.6 ms) as core/pure.js `decompose`: far below the shortest unit
 * the page names (ξ, 44 ms), far above the float noise of a position (about 1e-14).
 */
export const EPS_POS = 1e-12;

// ---------------------------------------------------------------------------------------------
// notation
// ---------------------------------------------------------------------------------------------
/** "δ½#3": an ordinal, counted from 1. */
export const ordText = (sym, n) => `${sym}#${n}`;
/** "3η": a count of completed units, counted from 0. */
export const countText = (sym, n) => `${n}${sym}`;

// ---------------------------------------------------------------------------------------------
// the nine entries of a stamp
// ---------------------------------------------------------------------------------------------
/** The nine entries of a stamp, coarse to fine; α β γ δ½ ε½ ζ½ are ordinals (from 1), η ι λ counters (from 0). */
export const LADDER = Object.freeze(['alpha', 'beta', 'gamma', 'delta-half', 'epsilon-half', 'zeta-half', 'eta', 'iota', 'lambda']);
/** Keys of the objects pure.date() / pure.clock() return. */
const KEY = Object.freeze({ alpha: 'alpha', beta: 'beta', gamma: 'gamma', 'delta-half': 'delta', 'epsilon-half': 'epsilon', 'zeta-half': 'zeta', eta: 'eta', iota: 'iota', lambda: 'lambda' });
const SYM = Object.freeze(Object.fromEntries(LADDER.map((id) => [id, unitById(id).sym])));
/** Entries that are ordinals (identity, from 1); the others are counters (completed units, from 0). */
export const ORDINAL_IDS = Object.freeze(new Set(['alpha', 'beta', 'gamma', 'delta-half', 'epsilon-half', 'zeta-half']));
export const isOrdinalId = (id) => ORDINAL_IDS.has(id);
const FIRST = (id) => (ORDINAL_IDS.has(id) ? 1 : 0);
export const stampSym = (id) => SYM[id];
/** What an entry counts inside, in words (error messages). */
const PARENT = Object.freeze({ beta: 'an Alpha', gamma: 'a Beta', 'delta-half': 'a γ', 'epsilon-half': 'a δ½', 'zeta-half': 'an ε½', eta: 'a ζ cycle', iota: 'an η', lambda: 'an ι' });

const rangeCache = new WeakMap();
/**
 * The printed range of every entry, DERIVED from the hierarchy (sibling counts and unit lengths), not re-typed:
 * {alpha: {min:1, max:18}, beta: {1,5}, gamma: {1,13}, 'delta-half': {1,10}, ..., eta: {0,10}, iota: {0,35}, lambda: {0,64}}.
 */
export function ladderRanges(model, pure) {
  let r = rangeCache.get(model);
  if (r) return r;
  const len = (id) => pure.unitPos(unitById(id));
  const ratio = (a, b) => Math.round(len(a) / len(b));
  r = Object.freeze({
    alpha: { min: 1, max: Number(model.clock.count(0)) },
    beta: { min: 1, max: model.levelInfo(1).siblings },
    gamma: { min: 1, max: model.levelInfo(2).siblings },
    'delta-half': { min: 1, max: ratio('gamma', 'delta-half') },
    'epsilon-half': { min: 1, max: ratio('delta-half', 'epsilon-half') },
    'zeta-half': { min: 1, max: ratio('epsilon-half', 'zeta-half') },
    eta: { min: 0, max: model.levelInfo(6).siblings - 1 },
    iota: { min: 0, max: ratio('eta', 'iota') - 1 },
    lambda: { min: 0, max: ratio('iota', 'lambda') - 1 },
  });
  rangeCache.set(model, r);
  return r;
}

// ---------------------------------------------------------------------------------------------
// counters: what the header prints
// ---------------------------------------------------------------------------------------------
/**
 * The six counters that can be edited in place, in ladder order. `ordinal`: δ½ ε½ ζ½ are ordinals counted from 1 and
 * written δ½#3; η ι λ are counts of completed units from 0, written 3η. `min`/`max` are the printed range (a test
 * checks them against ladderRanges()).
 */
export const COUNTERS = Object.freeze(
  [
    ['delta-half', 'delta', 1, 10],
    ['epsilon-half', 'epsilon', 1, 5],
    ['zeta-half', 'zeta', 1, 7],
    ['eta', 'eta', 0, 10],
    ['iota', 'iota', 0, 35],
    ['lambda', 'lambda', 0, 64],
  ].map(([id, key, min, max]) => Object.freeze({ id, key, sym: SYM[id], ordinal: ORDINAL_IDS.has(id), min, max })),
);
export const counterById = (id) => COUNTERS.find((c) => c.id === id);
/** The counter written in the notation: "δ½#3" or "3η". */
export const counterText = (spec, n) => (spec.ordinal ? ordText(spec.sym, n) : countText(spec.sym, n));

/** `pure.date` + `pure.clock` in one object, or null outside the catalogue. */
export function countersAt(pure, t) {
  const d = pure.date(t);
  const c = pure.clock(t);
  return d && c ? { ...d, ...c } : null;
}

// ---------------------------------------------------------------------------------------------
// exact landings: the first millisecond that shows something
// ---------------------------------------------------------------------------------------------
/**
 * The first millisecond for which `shows(c)` holds, searched around the float estimate `t` of the exact (rational)
 * boundary. The estimate can sit a few hundred nanoseconds on either side of an exact millisecond, so neither
 * ceil(t) nor round(t) is right: the candidate is checked, and so is the millisecond before it. A boundary that is
 * exactly on a millisecond lands ON it, one a hair after it lands on the next. Returns null when nothing shows it.
 */
export function firstMs(t, shows) {
  if (!Number.isFinite(t)) return null;
  const i0 = Math.ceil(t * 1000 - 1e-3); // forgives a microsecond of float noise
  if (shows(i0 / 1000) && !shows((i0 - 1) / 1000)) return i0 / 1000;
  for (let i = i0 - 3; i <= i0 + 6; i++) if (shows(i / 1000)) return i / 1000;
  return null;
}
const inCatalogue = (model, t) => Math.min(model.tMax, Math.max(model.tMin, t));

/**
 * The first millisecond at which cycle `idx` of `level` has reached `phase` (0 = it begins, 1 = the next one begins,
 * 0.25 / 0.5 / 0.75 = its peak / node / valley). null beyond the catalogue (a clipped last cycle).
 */
export function landPoint(model, level, idx, phase = 0) {
  const t = pointOfCycle(model, level, idx, phase);
  if (t === null) return null;
  const at = (c) => model.levelAt(c, level);
  let shows;
  if (phase <= 0) shows = (c) => (at(c)?.cycle ?? -1) >= idx;
  else if (phase >= 1) shows = (c) => (at(c)?.cycle ?? -1) >= idx + 1;
  else {
    shows = (c) => {
      const l = at(c);
      return !!l && (l.cycle > idx || (l.cycle === idx && l.phase >= phase));
    };
  }
  return firstMs(t, shows) ?? inCatalogue(model, Math.ceil(t * 1000) / 1000);
}
/** The first millisecond of the cycle of `level` that begins at the float time `t` (a boundary the model computed). */
export function landCycleAt(model, t, level) {
  if (t === null || t === undefined || !Number.isFinite(t)) return t;
  const shows = (c) => {
    const l = model.levelAt(c, level);
    return !!l && l.start > t - 5e-3; // the cycle that is shown began at t (or later): the one before began >= 44 ms earlier
  };
  return firstMs(t, shows) ?? inCatalogue(model, Math.ceil(t * 1000) / 1000);
}
/** The first millisecond of the cycle at `path` at the named point ('begin' | 'peak' | 'node' | 'valley' | 'end' | 'phase'). */
export function landPath(model, path, pointId, phaseNow = 0) {
  const idx = model.pathToCycle(path);
  if (idx === null) return null;
  const pt = POINTS.find((p) => p.id === pointId) ?? POINTS[0];
  return landPoint(model, path.length - 1, Number(idx), pt.phase === null ? phaseNow : pt.phase);
}
/** The first millisecond of the ζ½ with global index `z` (cycle z>>1 at phase 0 or 0.5, like the header's date counter). */
export function landHalf(model, level, z) {
  return landPoint(model, level, Math.floor(z / 2), (z % 2) * 0.5);
}

/** Global ζ½ / ε½ / δ½ index of the half that holds `t`, read like pure.date() does (exact), or null outside. */
function halfAt(model, t, level) {
  const l = model.levelAt(t, level);
  return l ? 2 * l.cycle + (l.phase >= 0.5 ? 1 : 0) : null;
}

// ---------------------------------------------------------------------------------------------
// counter editing
// ---------------------------------------------------------------------------------------------
/** Move `t` by `k` units of the ladder (k may be fractional or negative); null when it leaves the catalogue. */
export function shiftUnits(model, pure, t, unitId, k) {
  const pos = model.positionOf(r3(t));
  if (pos === null) return null;
  const p = pos + k * pure.unitPos(unitById(unitId));
  if (!(p >= 0 && p < model.extent)) return null;
  return r3(model.timeOfPosition(p));
}

/**
 * Edit one counter in place: the other counters keep their values (the odometer way), the moment moves by whole
 * units. Returns {t} or {error}.
 */
export function setCounter(model, pure, t, id, n) {
  const spec = counterById(id);
  const cur = countersAt(pure, t);
  if (!spec || !cur) return { error: 'This moment is outside the catalogue' };
  if (!Number.isInteger(n) || n < spec.min || n > spec.max) return { error: spec.ordinal ? `${spec.sym}#n is numbered ${spec.min}–${spec.max}` : `${spec.sym} counts ${spec.min}–${spec.max}` };
  if (n === cur[spec.key]) return { t: r3(t) };
  let out = shiftUnits(model, pure, t, id, n - cur[spec.key]);
  if (out === null) return { error: `That is outside the catalogue ${pure.catalogueText()}` };
  // (rounding to the nearest millisecond can land a hair before a unit boundary, where the old counter still shows)
  for (let i = 0; i < 3 && countersAt(pure, out)?.[spec.key] !== n; i++) out = r3(out + 0.001);
  return { t: out };
}

// ---------------------------------------------------------------------------------------------
// stamps -> moments
// ---------------------------------------------------------------------------------------------
/**
 * A stamp read back as a moment: `parts` = [{id, n}] consecutive entries of the LADDER, exactly as the header prints
 * them (`α#6 β#4 γ#9 · δ½#3 · ε½#2 · ζ½#5 · 3η 17ι 21λ`); the entries above the first one are taken from `ref`
 * (the shown moment). The result is the FIRST MILLISECOND that shows the finest entry given.
 *
 * η ι λ count inside the ζ CYCLE that holds the ζ½ (a ζ½ is only half of it): the η counter 5 straddles the middle
 * of its ζ, so the stamp `ζ½#6 · 5η` of the second half is the first millisecond of that ζ½, inside the η.
 * @returns {{t:number, pos:number, id:string, values:object} | {error:string, detail?:string}}
 */
export function resolveParts(model, pure, parts, ref) {
  if (!parts.length) return { error: 'Nothing to read' };
  const ids = parts.map((p) => LADDER.indexOf(p.id));
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] <= ids[i - 1]) return { error: 'Write the entries from the longest to the shortest', detail: 'e.g. α#6 β#4 γ#9 · δ½#3 · ζ½#5 · 3η' };
    if (ids[i] !== ids[i - 1] + 1) return { error: `${SYM[LADDER[ids[i - 1] + 1]]} is missing between ${SYM[LADDER[ids[i - 1]]]} and ${SYM[LADDER[ids[i]]]}`, detail: 'Write consecutive entries, e.g. α#6 β#4 γ#9 · δ½#3' };
  }
  const etaIdx = LADDER.indexOf('eta');
  const first = ids[0];
  const finestIdx = ids[ids.length - 1];
  const finest = LADDER[finestIdx];
  const R = ladderRanges(model, pure);
  let base = null;
  if (first > 0) {
    base = ref !== undefined && ref !== null ? countersAt(pure, ref) : null;
    if (!base) return { error: 'The shown moment is outside the catalogue, so the enclosing cycles are unknown', detail: 'Start the address with α, e.g. α#6 β#4' };
  }
  const values = {};
  LADDER.forEach((id, i) => {
    values[KEY[id]] = i < first ? base[KEY[id]] : FIRST(id);
  });
  for (const p of parts) {
    const id = p.id;
    const { min, max } = R[id];
    if (!Number.isInteger(p.n) || p.n < min || p.n > max) {
      if (id === 'alpha') return { error: `The catalogue holds only ${max} Alpha cycles (${pure.catalogueText()})`, detail: `α#1 … α#${max}` };
      const word = ORDINAL_IDS.has(id) ? 'is numbered' : 'counts';
      const what = ORDINAL_IDS.has(id) ? ordText(SYM[id], p.n) : countText(SYM[id], p.n);
      const edge = p.n > max ? (ORDINAL_IDS.has(id) ? ordText(SYM[id], max) : countText(SYM[id], max)) : ORDINAL_IDS.has(id) ? ordText(SYM[id], min) : countText(SYM[id], min);
      return { error: `${what}: ${SYM[id]} ${word} ${min}–${max} inside ${PARENT[id]}`, detail: `${edge} is the ${p.n > max ? 'last' : 'first'}` };
    }
    values[KEY[id]] = p.n;
  }
  const alphaCount = R.alpha.max;
  const gIdx = model.pathToCycle([values.alpha, values.beta, values.gamma]);
  if (gIdx === null) return { error: `α#${values.alpha} β#${values.beta} γ#${values.gamma} begins after the catalogue ends`, detail: `The catalogue ends inside α#${alphaCount}; its last cycles are clipped` };
  let pos = (Number(gIdx) * 4) / P(model, 2);
  pos += (values.delta - 1) * pure.unitPos(unitById('delta-half'));
  pos += (values.epsilon - 1) * pure.unitPos(unitById('epsilon-half'));
  pos += (values.zeta - 1) * pure.unitPos(unitById('zeta-half'));
  const named = pos; // the start of the named ζ½ (of the shown one, for bare counters)
  let secondHalf = false;
  let zIdx = -1;
  let target = pos;
  const bare = first >= etaIdx; // η ι λ alone: counted inside the ζ cycle of the shown moment
  if (finestIdx >= etaIdx) {
    const zlen = 4 / P(model, 5);
    const zStart = Math.floor((pos + EPS_POS) / zlen) * zlen;
    zIdx = Math.round(zStart / zlen);
    secondHalf = pos - zStart > zlen / 4;
    const etaLen = pure.unitPos(unitById('eta'));
    target = zStart + values.eta * etaLen + values.iota * pure.unitPos(unitById('iota')) + values.lambda * pure.unitPos(unitById('lambda'));
    // the η that straddles the middle of the ζ: in the second ζ½ the stamp begins where that ζ½ does, inside the η
    if (!bare && finestIdx === etaIdx && secondHalf && target < named && target + etaLen > named) target = named;
  }
  if (!(target >= 0 && target < model.extent)) return { error: `That moment lies after the catalogue ends ${pure.catalogueText()}` };
  // what the first millisecond must show: every entry down to the finest one, or (bare counters) the clock inside that ζ cycle
  const given = LADDER.slice(bare ? etaIdx : 0, finestIdx + 1);
  const want = (c) => {
    const cs = countersAt(pure, c);
    if (!cs) return false;
    if (bare && model.levelAt(c, 5)?.cycle !== zIdx) return false;
    return given.every((id) => cs[KEY[id]] === values[KEY[id]]);
  };
  const t = firstMs(model.timeOfPosition(target), want);
  if (t === null) {
    if (!bare && ids.includes(LADDER.indexOf('zeta-half')) && finestIdx >= etaIdx) {
      const counts = LADDER.slice(etaIdx, finestIdx + 1).map((id) => countText(SYM[id], values[KEY[id]])).join(' ');
      return { error: `${ordText('ζ½', values.zeta)} and ${counts} do not meet`, detail: `this ζ½ is the ${secondHalf ? 'second' : 'first'} half of its ζ cycle: it holds the counters ${secondHalf ? `${R.eta.max / 2}η–${R.eta.max}η` : `0η–${R.eta.max / 2}η`}` };
    }
    // (cannot happen for a position the model itself produced; the nearest millisecond is the honest fallback)
    return { t: inCatalogue(model, Math.ceil(model.timeOfPosition(target) * 1000) / 1000), pos: target, id: finest, values };
  }
  return { t, pos: target, id: finest, values };
}

/**
 * Entries of a stamp written like the header prints it: ordinals "α#6 β#4 γ#9" · "δ½#3" · "ε½#2" · "ζ½#5", then the
 * counters as one clock group "3η 17ι 21λ". `parts` = [{id, n}].
 */
export function entriesText(parts) {
  const head = parts.filter((p) => ['alpha', 'beta', 'gamma'].includes(p.id)).map((p) => ordText(SYM[p.id], p.n));
  const halves = parts.filter((p) => ['delta-half', 'epsilon-half', 'zeta-half'].includes(p.id)).map((p) => ordText(SYM[p.id], p.n));
  const clock = parts.filter((p) => ['eta', 'iota', 'lambda'].includes(p.id)).map((p) => countText(SYM[p.id], p.n));
  return [head.join(' '), ...halves, clock.join(' ')].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------------------------
// small descriptions
// ---------------------------------------------------------------------------------------------
/**
 * The distance between two moments (a <= b) counted in ladder units, measured in position (pure.between, exact across
 * eclipse intervals). A tiny allowance (2 ms, the size of one rounding to the millisecond at each end) keeps a span
 * that was built from whole units ("-1ι") from reading one small unit short ("64λ 4μ").
 */
const SPAN_SLACK = 0.002;
export function spanText(model, pure, a, b, { parts = 2 } = {}) {
  const lo = r3(Math.min(a, b));
  const hi = r3(Math.max(a, b));
  return pure.between(lo, Math.min(model.tMax, hi + SPAN_SLACK), { parts });
}

/**
 * Solar sync n in pure terms: start, end, the drift against the solar rhythm (`sol` goes to pure.driftText) and the
 * four quarter thresholds. null when the sync is not entirely inside the catalogue.
 */
export function pureSolarInfo(model, n) {
  if (!Number.isSafeInteger(n)) return null;
  const s = model.solarSyncByNumber(n);
  if (!s) return null;
  const len = s.end - s.start;
  return {
    sync: n,
    start: s.start,
    end: s.end,
    length: len,
    drift: s.drift,
    sol: s,
    quarters: ['peak', 'node', 'valley', 'end'].map((name, i) => ({ name, time: s.start + ((i + 1) / 4) * len })),
  };
}

/**
 * Query string that deep-links to a moment in pure mode: "?pos=22.927850216635&pure=1&view=calendar". 12 decimals of the
 * Saros position reproduce the moment to well under a millisecond (9 decimals were 0.3 s).
 */
export function pureShareQuery(model, t, { view = 'calendar' } = {}) {
  const q = new URLSearchParams();
  q.set('pos', (model.positionOf(r3(t)) ?? 0).toFixed(12));
  q.set('pure', '1');
  if (view) q.set('view', view);
  return '?' + q.toString();
}

/**
 * Eclipse context in pure units: the previous and the next eclipse as exact position distances. Eclipses are named like
 * positions (eclipse k sits at position k): `name` is pure.eclipseName(k), "#22".
 */
export function pureEclipseContext(model, pure, t) {
  const pos = model.positionOf(r3(t));
  if (pos === null) return { prev: null, next: null };
  const k = Math.floor(pos + EPS_POS);
  const mk = (e) => (e < 0 || e > model.extent ? null : { k: e, name: pure.eclipseName(e), time: model.catalogue[e], delta: Math.abs(e - pos), text: pure.durationPos(Math.abs(e - pos), { parts: 2 }), exact: Math.abs(e - pos) < EPS_POS });
  return { prev: mk(k), next: mk(k + 1) };
}

// ---------------------------------------------------------------------------------------------
// the pure month page: one δ½ = 5 rows (ε½) x 7 columns (ζ½)
// ---------------------------------------------------------------------------------------------
export const GRID = Object.freeze({ rows: 5, cols: 7, cells: 35 });
/** Quarter marks inside an η (peak, node, valley): ι 9, 18, 27 of its 36. */
export const QUARTER_NAMES = Object.freeze(['', 'peak', 'node', 'valley']);

/** Number of δ½ pages that start inside the catalogue. */
export function viewCount(model) {
  return Math.ceil((model.extent * P(model, 3)) / 2);
}
/** Index of the δ½ page that holds time `t` (null outside the catalogue): the header's δ½ counter, exactly. */
export function viewOfTime(model, t) {
  const hv = halfAt(model, r3(t), 3);
  return hv === null ? null : Math.min(viewCount(model) - 1, hv);
}
/** Clamp a page index into the catalogue. */
export const clampView = (model, hv) => Math.max(0, Math.min(viewCount(model) - 1, Math.round(hv)));

/** Where a page sits in the hierarchy: its γ (global index and α β γ ordinals) and its δ½ number 1..10 inside it. */
export function viewInfo(model, hv) {
  const gamma = Math.floor(hv / 10);
  const half = (hv % 10) + 1;
  const path = model.cycleToPath(2, BigInt(gamma));
  return { hv, gamma, half, path, alpha: path[0], beta: path[1], gammaOrd: path[2] };
}
/** Page index for α β γ ordinals and a δ½ number (clamped into the catalogue). */
export function viewFromPath(model, alpha, beta, gammaOrd, half) {
  let idx = model.pathToCycle([alpha, beta, gammaOrd]);
  if (idx === null) {
    // beyond the clipped end of the catalogue: step back to the last γ that exists
    const last = Number(model.clock.count(2)) - 1;
    idx = BigInt(last);
  }
  return clampView(model, Number(idx) * 10 + (half - 1));
}

const eclipseCells = new WeakMap();
/** Map: global ζ½ index -> the eclipse number that falls inside it (an eclipse is at the start or the middle of a ζ½). */
function eclipseMap(model) {
  let m = eclipseCells.get(model);
  if (m) return m;
  m = new Map();
  const z = P(model, 5) / 2; // ζ½ per Saros unit (5687.5: k * z is exact in a double)
  for (let k = 0; k <= model.extent; k++) {
    const cell = Math.floor(k * z);
    m.set(cell, { k, frac: k * z - cell });
  }
  eclipseCells.set(model, m);
  return m;
}

/**
 * The page for δ½ number `hv`: 35 cells, each a ζ½ with
 *   - exact tick geometry in quarter-η steps (22 per cell): η boundaries and the peak / node / valley marks of each η,
 *   - the ε phase at the start of the cell (the 256-state pair index), the eclipse it holds, the sync quarters in it.
 * Cell positions are Saros positions; `start`/`end` are the Unix seconds the app runs on: `start` is the FIRST
 * MILLISECOND that shows the cell (what the header counts), `end` the first millisecond of the next one.
 */
export function buildPureGrid(model, hv) {
  const zN = P(model, 5);
  const ext = model.extent;
  const z0 = hv * GRID.cells;
  const ecl = eclipseMap(model);
  // 36 boundaries (a cell ends where the next one begins), each landed on its first millisecond
  const starts = [];
  for (let i = 0; i <= GRID.cells; i++) starts.push((((z0 + i) * 2) / zN) < ext ? landHalf(model, 5, z0 + i) : model.tMax);
  const cells = [];
  for (let i = 0; i < GRID.cells; i++) {
    const z = z0 + i;
    const pos0 = (z * 2) / zN;
    const pos1 = ((z + 1) * 2) / zN;
    const inRange = pos0 < ext;
    const e = ecl.get(z);
    const cell = {
      index: i,
      row: Math.floor(i / GRID.cols),
      col: i % GRID.cols,
      ord: i + 1,
      z,
      pos0,
      pos1,
      inRange,
      partial: inRange && pos1 > ext,
      cut: inRange && pos1 > ext ? (ext - pos0) / (pos1 - pos0) : 1, // where the catalogue ends inside the cell
      start: inRange ? starts[i] : model.tMax,
      end: inRange && pos1 < ext ? starts[i + 1] : model.tMax,
      eclipse: e && inRange ? e.k : -1,
      eclipseFrac: e ? e.frac : 0,
      epsPhase: (z % 14) / 14, // a ε cycle is 14 ζ½
      etas: [],
      quarters: [],
      syncs: [],
    };
    // quarter-η steps: cell z covers steps [22z, 22z + 22); step Q belongs to η Q>>2 and is its quarter Q&3
    for (let u = 0; u < 22; u++) {
      const Q = 22 * z + u;
      const q = Q & 3;
      if (q === 0) continue;
      cell.quarters.push({ x: u / 22, q, name: QUARTER_NAMES[q], eta: Q >> 2, local: (Q >> 2) % 11 });
    }
    // η segments: [eta, from step, to step)
    const qStart = 22 * z;
    const qEnd = qStart + 22;
    for (let j = qStart >> 2; j * 4 < qEnd; j++) {
      const a = Math.max(j * 4, qStart);
      const b = Math.min(j * 4 + 4, qEnd);
      cell.etas.push({
        eta: j,
        local: j % 11,
        x0: (a - qStart) / 22,
        x1: (b - qStart) / 22,
        startsHere: j * 4 >= qStart,
        endsHere: j * 4 + 4 <= qEnd,
        odd: j & 1,
      });
    }
    cells.push(cell);
  }
  const grid = { hv, z0, cells, start: cells[0].start, end: cells[GRID.cells - 1].end, pos0: cells[0].pos0, pos1: cells[GRID.cells - 1].pos1 };
  if (grid.pos0 < ext) {
    for (const q of syncQuartersInWindow(model, grid.start, Math.min(model.tMax, grid.end) + 1)) {
      const pos = model.positionOf(q.start);
      if (pos === null) continue;
      const z = Math.floor(((pos + EPS_POS) * zN) / 2);
      const cell = cells[z - z0];
      if (cell) cell.syncs.push({ sync: q.sync, q: q.q, name: q.name, x: Math.max(0, (pos - cell.pos0) / (cell.pos1 - cell.pos0)), start: q.start, drift: q.drift });
    }
  }
  return grid;
}

/** Fraction (0..1) of a cell that time `t` has elapsed, measured in position (exact across an eclipse inside the cell). */
export function cellFraction(model, cell, t) {
  const pos = model.positionOf(r3(t));
  if (pos === null) return 0;
  return Math.min(1, Math.max(0, (pos - cell.pos0) / (cell.pos1 - cell.pos0)));
}
/** The moment at fraction `x` of a cell (clamped into the catalogue and never before the cell's own first millisecond). */
export function cellTime(model, cell, x = 0) {
  if (x <= 0 && cell.inRange) return cell.start;
  const p = Math.min(model.extent - EPS_POS, cell.pos0 + x * (cell.pos1 - cell.pos0));
  const t = model.timeOfPosition(p);
  return x <= 0 ? Math.ceil(t * 1000) / 1000 : r3(t);
}
/** Index (0..34) of the cell of `grid` holding time `t` (the header's ζ½, exactly), or -1. */
export function cellOfTime(model, grid, t) {
  const z = halfAt(model, r3(t), 5);
  if (z === null) return -1;
  const i = z - grid.z0;
  return i >= 0 && i < GRID.cells ? i : -1;
}

/** The η cycle of a cell segment -> the time it starts (landing on it), or null beyond the catalogue. */
export function etaStartTime(model, etaIdx) {
  return cycleStart(model, 6, etaIdx);
}
/** The first millisecond of cycle `idx` of `level` (global index), or null beyond the catalogue. */
export function cycleStart(model, level, idx) {
  if (model.cycleStartTime(level, idx) === null) return null;
  return landPoint(model, level, idx, 0);
}
/** Cells (ζ½) per cycle of the band levels that are bigger than a cell: δ = 70, ε = 14, ζ = 2. */
export const CELLS_PER = Object.freeze({ 3: 70, 4: 14, 5: 2 });
/**
 * The cycle of `level` (3 δ, 4 ε, 5 ζ) that runs through cell `z` (global ζ½ index): such a cycle is always a whole number of
 * cells, so a cell is inside exactly one of them. `local` is its 1-based ordinal inside its parent.
 */
export function overlayCycle(model, z, level) {
  const size = CELLS_PER[level];
  const idx = Math.floor(z / size);
  return { level, idx, local: (idx % model.levelInfo(level).siblings) + 1, startsHere: z % size === 0, cells: size };
}

/** The 10 δ½ of a γ for the ribbon: segments, ε½ ticks (4 inside each δ½) and δ boundaries (every second δ½). */
export function buildRibbon(model, gammaIdx) {
  const segs = [];
  for (let i = 0; i < 10; i++) {
    const hv = gammaIdx * 10 + i;
    segs.push({ hv, half: i + 1, x0: i / 10, x1: (i + 1) / 10, inRange: (hv * 2) / P(model, 3) < model.extent });
  }
  const eps = [];
  for (let i = 0; i < 10; i++) for (let r = 1; r < 5; r++) eps.push({ x: (i * 5 + r) / 50, hv: gammaIdx * 10 + i, row: r });
  const deltas = [];
  for (let i = 2; i < 10; i += 2) deltas.push({ x: i / 10, hv: gammaIdx * 10 + i });
  return { gamma: gammaIdx, segs, eps, deltas, path: model.cycleToPath(2, BigInt(gammaIdx)) };
}
