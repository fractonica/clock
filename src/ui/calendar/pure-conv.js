/**
 * Pure-mode calendar maths (no DOM, no Earth units): everything the pure converter, the pure month grid and the pure
 * jump box need to talk about a moment in Fractonica terms only (docs/design/80-pure.md, REVISION 2).
 *
 * Vocabulary comes from src/core/pure.js (`pure` = createPure(model)): names, the unit ladder (one whole cycle per
 * depth, α β γ δ ε ζ η θ ι κ λ μ ν), the date and clock counters, the 256-state phase pair, eclipse names, cycle
 * lengths and the solar drift text. This file adds the INVERSE of those readings (a stamp -> a moment), counter
 * editing, exact landings, and the geometry of the pure month page: one δ (Atom) as 5 rows (ε) x 7 columns (ζ) = 35
 * ζ cells, 5 pages per γ.
 *
 * NOTATION (core/pure.js): X#n is an ORDINAL counted from 1 (ζ#5); nX is a COUNT of units counted from 0 (3η, 17ι):
 * the clock counters are counts, the date entries are ordinals. A letter + space + number ("η 7") is only a depth chip.
 * A stamp is `α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#5 · 3η 17ι 21λ`; the clock η ι λ counts inside the ζ cycle, so a stamp has
 * no "straddling" case: ζ is a whole cycle of 11 η.
 *
 * Everything is computed in Saros POSITION space: the hierarchy is exactly aligned there (a ζ is 4/11375 of a Saros
 * unit, 7 of them make an ε ...), and only the last step converts a position to the Unix seconds the app runs on.
 * Which cycle / ζ a moment is in is always asked of the model (exact rational position), exactly like the header does:
 * no relative tolerances, so the page, the cells and the landings agree with the header at every millisecond.
 */
import { UNITS } from '../../core/pure.js';
import { POINTS, pointOfCycle, r3 } from './convert.js';
import { syncQuartersInWindow } from './month.js';

export const unitById = (id) => UNITS.find((u) => u.id === id);
const P = (model, level) => model.levelInfo(level).prefixNum;
/**
 * Absolute position tolerance, the same 1e-12 Saros (0.6 ms) as core/pure.js `decompose`: far below the shortest unit
 * the page names (a Blink, 311 ms), far above the float noise of a position (about 1e-14).
 */
export const EPS_POS = 1e-12;

// ---------------------------------------------------------------------------------------------
// notation
// ---------------------------------------------------------------------------------------------
/** "δ#3": an ordinal, counted from 1. */
export const ordText = (sym, n) => `${sym}#${n}`;
/** "3η": a count of completed units, counted from 0. */
export const countText = (sym, n) => `${n}${sym}`;

// ---------------------------------------------------------------------------------------------
// the nine entries of a stamp
// ---------------------------------------------------------------------------------------------
/** The nine entries of a stamp, coarse to fine (ids of core `UNITS`); α … ζ are ordinals (from 1), η ι λ counters (from 0). */
export const LADDER = Object.freeze(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'iota', 'lambda']);
/** Depth level (0-based) of every entry: η is depth 7 (level 6), ι depth 9 (level 8), λ depth 11 (level 10). */
export const LEVEL_OF = Object.freeze({ alpha: 0, beta: 1, gamma: 2, delta: 3, epsilon: 4, zeta: 5, eta: 6, iota: 8, lambda: 10 });
const SYM = Object.freeze(Object.fromEntries(LADDER.map((id) => [id, unitById(id).sym])));
/** Entries that are ordinals (identity, from 1); the others are counters (completed units, from 0). */
export const ORDINAL_IDS = Object.freeze(new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']));
export const isOrdinalId = (id) => ORDINAL_IDS.has(id);
const FIRST = (id) => (ORDINAL_IDS.has(id) ? 1 : 0);
export const stampSym = (id) => SYM[id];
/** What an entry counts inside, in words (error messages). */
const PARENT = Object.freeze({ beta: 'an Alpha', gamma: 'a Beta', delta: 'a γ', epsilon: 'a δ', zeta: 'an ε', eta: 'a ζ', iota: 'an η', lambda: 'an ι' });

const rangeCache = new WeakMap();
/**
 * The printed range of every entry, DERIVED from the hierarchy (sibling counts and unit lengths), not re-typed:
 * {alpha: {min:1, max:18}, beta: {1,5}, gamma: {1,13}, delta: {1,5}, epsilon: {1,5}, zeta: {1,7}, eta: {0,10}, iota: {0,35}, lambda: {0,64}}.
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
    delta: { min: 1, max: ratio('gamma', 'delta') },
    epsilon: { min: 1, max: ratio('delta', 'epsilon') },
    zeta: { min: 1, max: ratio('epsilon', 'zeta') },
    eta: { min: 0, max: ratio('zeta', 'eta') - 1 },
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
 * The six counters that can be edited in place, in ladder order. `ordinal`: δ ε ζ are ordinals counted from 1 and
 * written δ#3; η ι λ are counts of completed units from 0, written 3η. `min`/`max` are the printed range (a test
 * checks them against ladderRanges()). `key` is the field of pure.date() / pure.clock().
 */
export const COUNTERS = Object.freeze(
  [
    ['delta', 1, 5],
    ['epsilon', 1, 5],
    ['zeta', 1, 7],
    ['eta', 0, 10],
    ['iota', 0, 35],
    ['lambda', 0, 64],
  ].map(([id, min, max]) => Object.freeze({ id, key: id, sym: SYM[id], ordinal: ORDINAL_IDS.has(id), min, max })),
);
export const counterById = (id) => COUNTERS.find((c) => c.id === id);
/** The counter written in the notation: "δ#3" or "3η". */
export const counterText = (spec, n) => (spec.ordinal ? ordText(spec.sym, n) : countText(spec.sym, n));

/** `pure.date` + `pure.clock` in one object, or null outside the catalogue. */
export function countersAt(pure, t) {
  const d = pure.date(t);
  const c = pure.clock(t);
  return d && c ? { ...d, ...c } : null;
}

/**
 * How a cycle of `level` is made of finer ones, "7ζ" (an ε), "36ι" (an η), "65λ" (an ι), "25ν" (a λ): the length of a
 * whole cycle in the units that fit it exactly. The clock's counters η ι λ are what η, ι, λ are counted in, so those
 * three skip the depths in between (η = 36ι, not 9θ). Returns '' for ν and finer (the Blink is the finest unit).
 */
export function madeOf(model, pure, level) {
  const next = { 6: 8, 8: 10, 10: 12 }[level] ?? level + 1;
  const to = UNITS.find((u) => u.level === next);
  const from = UNITS.find((u) => u.level === level);
  if (!to || !from) return '';
  return `${Math.round(pure.unitPos(from) / pure.unitPos(to))}${to.sym}`;
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
    return !!l && l.start > t - 5e-3; // the cycle that is shown began at t (or later): the one before began >= 311 ms earlier
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
 * them (`α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#5 · 3η 17ι 21λ`); the entries above the first one are taken from `ref`
 * (the shown moment). The result is the FIRST MILLISECOND that shows the finest entry given.
 *
 * η ι λ count inside the ζ cycle (11 η), which is a whole cycle and the finest ordinal of the date: the counters
 * alone ("3η 17ι") are read inside the ζ of `ref`.
 * @returns {{t:number, pos:number, id:string, values:object} | {error:string, detail?:string}}
 */
export function resolveParts(model, pure, parts, ref) {
  if (!parts.length) return { error: 'Nothing to read' };
  const ids = parts.map((p) => LADDER.indexOf(p.id));
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] <= ids[i - 1]) return { error: 'Write the entries from the longest to the shortest', detail: 'e.g. α#6 β#4 γ#9 · δ#3 · ζ#5 · 3η' };
    if (ids[i] !== ids[i - 1] + 1) return { error: `${SYM[LADDER[ids[i - 1] + 1]]} is missing between ${SYM[LADDER[ids[i - 1]]]} and ${SYM[LADDER[ids[i]]]}`, detail: 'Write consecutive entries, e.g. α#6 β#4 γ#9 · δ#3' };
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
    values[id] = i < first ? base[id] : FIRST(id);
  });
  for (const p of parts) {
    const id = p.id;
    const { min, max } = R[id];
    if (!Number.isInteger(p.n) || p.n < min || p.n > max) {
      if (id === 'alpha') return { error: `The catalogue holds only ${max} Alpha cycles (${pure.catalogueText()})`, detail: `α#1 … α#${max}` };
      const ord = ORDINAL_IDS.has(id);
      const word = ord ? 'is numbered' : 'counts';
      const what = ord ? ordText(SYM[id], p.n) : countText(SYM[id], p.n);
      const edge = p.n > max ? (ord ? ordText(SYM[id], max) : countText(SYM[id], max)) : ord ? ordText(SYM[id], min) : countText(SYM[id], min);
      return { error: `${what}: ${SYM[id]} ${word} ${min}–${max} inside ${PARENT[id]}`, detail: `${edge} is the ${p.n > max ? 'last' : 'first'}` };
    }
    values[id] = p.n;
  }
  const alphaCount = R.alpha.max;
  const gIdx = model.pathToCycle([values.alpha, values.beta, values.gamma]);
  if (gIdx === null) return { error: `α#${values.alpha} β#${values.beta} γ#${values.gamma} begins after the catalogue ends`, detail: `The catalogue ends inside α#${alphaCount}; its last cycles are clipped` };
  let pos = (Number(gIdx) * 4) / P(model, 2);
  pos += (values.delta - 1) * pure.unitPos(unitById('delta'));
  pos += (values.epsilon - 1) * pure.unitPos(unitById('epsilon'));
  pos += (values.zeta - 1) * pure.unitPos(unitById('zeta'));
  // pos is the start of the named (or shown) ζ cycle: whole cycles all the way down, so it sits on a ζ boundary
  const zlen = 4 / P(model, 5);
  const zIdx = Math.round(pos / zlen);
  let target = pos;
  const bare = first >= etaIdx; // η ι λ alone: counted inside the ζ cycle of the shown moment
  if (finestIdx >= etaIdx) {
    target = zIdx * zlen + values.eta * pure.unitPos(unitById('eta')) + values.iota * pure.unitPos(unitById('iota')) + values.lambda * pure.unitPos(unitById('lambda'));
  }
  if (!(target >= 0 && target < model.extent)) return { error: `That moment lies after the catalogue ends ${pure.catalogueText()}` };
  // what the first millisecond must show: every entry down to the finest one, or (bare counters) the clock inside that ζ cycle
  const given = LADDER.slice(bare ? etaIdx : 0, finestIdx + 1);
  const want = (c) => {
    const cs = countersAt(pure, c);
    if (!cs) return false;
    if (bare && model.levelAt(c, 5)?.cycle !== zIdx) return false;
    return given.every((id) => cs[id] === values[id]);
  };
  const t = firstMs(model.timeOfPosition(target), want);
  // (null cannot happen for a position the model itself produced; the nearest millisecond is the honest fallback)
  if (t === null) return { t: inCatalogue(model, Math.ceil(model.timeOfPosition(target) * 1000) / 1000), pos: target, id: finest, values };
  return { t, pos: target, id: finest, values };
}

/**
 * Entries of a stamp written like the header prints it: ordinals "α#6 β#4 γ#9" · "δ#3" · "ε#2" · "ζ#5", then the
 * counters as one clock group "3η 17ι 21λ". `parts` = [{id, n}].
 */
export function entriesText(parts) {
  const head = parts.filter((p) => ['alpha', 'beta', 'gamma'].includes(p.id)).map((p) => ordText(SYM[p.id], p.n));
  const date = parts.filter((p) => ['delta', 'epsilon', 'zeta'].includes(p.id)).map((p) => ordText(SYM[p.id], p.n));
  const clock = parts.filter((p) => ['eta', 'iota', 'lambda'].includes(p.id)).map((p) => countText(SYM[p.id], p.n));
  return [head.join(' '), ...date, clock.join(' ')].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------------------------
// small descriptions
// ---------------------------------------------------------------------------------------------
/**
 * The distance between two moments (a <= b) counted in ladder units, measured in position (pure.between, exact across
 * eclipse intervals). A tiny allowance (2 ms, the size of one rounding to the millisecond at each end) keeps a span
 * that was built from whole units ("-1ι") from reading one small unit short ("64λ 4ν").
 */
const SPAN_SLACK = 0.002;
export function spanText(model, pure, a, b, { parts = 2 } = {}) {
  const lo = r3(Math.min(a, b));
  const hi = r3(Math.max(a, b));
  // below five Blinks the span is a decimal count of ν ("0.14ν", "2.6ν"): exact as measured, the allowance would show
  const exact = pure.between(lo, hi, { parts });
  if (/^[\d.<]+ν$/.test(exact)) return exact;
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
// the pure month page: one δ = 5 rows (ε) x 7 columns (ζ)
// ---------------------------------------------------------------------------------------------
export const GRID = Object.freeze({ rows: 5, cols: 7, cells: 35 });
/** Pages (δ) in one γ, β and α: 5, 13 x 5, 5 x 13 x 5 (what the ◀ ▶ steps move by). */
export const PAGES_PER = Object.freeze({ gamma: 5, beta: 65, alpha: 325 });
/** Quarter marks inside an η (peak, node, valley): ι 9, 18, 27 of its 36. */
export const QUARTER_NAMES = Object.freeze(['', 'peak', 'node', 'valley']);
/** η cycles in a ζ cell (the clock's η counter runs 0..10 across it). */
export const ETA_PER_CELL = 11;

/** Number of δ pages that start inside the catalogue. */
export function viewCount(model) {
  return Math.ceil((model.extent * P(model, 3)) / 4);
}
/** Index of the δ page that holds time `t` (null outside the catalogue): the header's δ cycle, exactly. */
export function viewOfTime(model, t) {
  const l = model.levelAt(r3(t), 3);
  return l ? Math.min(viewCount(model) - 1, l.cycle) : null;
}
/** Clamp a page index into the catalogue. */
export const clampView = (model, hv) => Math.max(0, Math.min(viewCount(model) - 1, Math.round(hv)));

/** Where a page sits in the hierarchy: its γ (global index and α β γ ordinals) and its δ number 1..5 inside it. */
export function viewInfo(model, hv) {
  const gamma = Math.floor(hv / PAGES_PER.gamma);
  const delta = (hv % PAGES_PER.gamma) + 1;
  const path = model.cycleToPath(2, BigInt(gamma));
  return { hv, gamma, delta, path, alpha: path[0], beta: path[1], gammaOrd: path[2] };
}
/** Page index for α β γ ordinals and a δ number (clamped into the catalogue). */
export function viewFromPath(model, alpha, beta, gammaOrd, delta) {
  let idx = model.pathToCycle([alpha, beta, gammaOrd]);
  if (idx === null) {
    // beyond the clipped end of the catalogue: step back to the last γ that exists
    const last = Number(model.clock.count(2)) - 1;
    idx = BigInt(last);
  }
  return clampView(model, Number(idx) * PAGES_PER.gamma + (delta - 1));
}

const eclipseCells = new WeakMap();
/**
 * Map: global ζ index -> the eclipse number that falls inside it. An eclipse sits at an integer position k, which is
 * k x 2843.75 ζ cells: it falls at 0, ¼, ½ or ¾ of its cell (k mod 4 = 0, 1, 2, 3 gives 0, ¾, ½, ¼), and one cell
 * holds at most one eclipse (a cell is 1/2843.75 of a Saros unit).
 */
function eclipseMap(model) {
  let m = eclipseCells.get(model);
  if (m) return m;
  m = new Map();
  const z = P(model, 5) / 4; // ζ per Saros unit (2843.75: k * z is exact in a double)
  for (let k = 0; k <= model.extent; k++) {
    const cell = Math.floor(k * z);
    m.set(cell, { k, frac: k * z - cell });
  }
  eclipseCells.set(model, m);
  return m;
}

/**
 * The page for δ number `hv`: 35 cells, each a whole ζ cycle with
 *   - exact tick geometry: its 11 η cycles (counter 0..10) and the peak / node / valley mark of each η,
 *   - the ε phase at the start of the cell (the 256-state pair index), the eclipse it holds (and where: 0, ¼, ½, ¾ of
 *     the cell), the sync quarters in it.
 * Cell positions are Saros positions; `start`/`end` are the Unix seconds the app runs on: `start` is the FIRST
 * MILLISECOND that shows the cell (what the header counts), `end` the first millisecond of the next one.
 */
export function buildPureGrid(model, hv) {
  const zN = P(model, 5);
  const ext = model.extent;
  const z0 = hv * GRID.cells;
  const ecl = eclipseMap(model);
  const posOf = (z) => (z * 4) / zN;
  // 36 boundaries (a cell ends where the next one begins), each landed on its first millisecond
  const starts = [];
  for (let i = 0; i <= GRID.cells; i++) starts.push(posOf(z0 + i) < ext ? landPoint(model, 5, z0 + i, 0) : model.tMax);
  const cells = [];
  for (let i = 0; i < GRID.cells; i++) {
    const z = z0 + i;
    const pos0 = posOf(z);
    const pos1 = posOf(z + 1);
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
      epsPhase: (z % GRID.cols) / GRID.cols, // an ε cycle is 7 ζ cells: the cell's column
      etas: [],
      quarters: [],
      syncs: [],
    };
    // the 11 η cycles of the cell: whole cycles, [j/11, (j+1)/11); the peak / node / valley marks sit at ι 9, 18, 27
    for (let j = 0; j < ETA_PER_CELL; j++) {
      const eta = z * ETA_PER_CELL + j;
      cell.etas.push({ eta, local: j, x0: j / ETA_PER_CELL, x1: (j + 1) / ETA_PER_CELL, startsHere: true, endsHere: true, odd: eta & 1 });
      for (let q = 1; q <= 3; q++) cell.quarters.push({ x: (j + q / 4) / ETA_PER_CELL, q, name: QUARTER_NAMES[q], eta, local: j });
    }
    cells.push(cell);
  }
  const grid = { hv, z0, cells, start: cells[0].start, end: cells[GRID.cells - 1].end, pos0: cells[0].pos0, pos1: cells[GRID.cells - 1].pos1 };
  if (grid.pos0 < ext) {
    for (const q of syncQuartersInWindow(model, grid.start, Math.min(model.tMax, grid.end) + 1)) {
      const pos = model.positionOf(q.start);
      if (pos === null) continue;
      const z = Math.floor(((pos + EPS_POS) * zN) / 4);
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
/** Index (0..34) of the cell of `grid` holding time `t` (the header's ζ, exactly), or -1. */
export function cellOfTime(model, grid, t) {
  const l = model.levelAt(r3(t), 5);
  if (!l) return -1;
  const i = l.cycle - grid.z0;
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
/** Cells (ζ) per cycle of the band levels that are bigger than or equal to a cell: δ = 35, ε = 7, ζ = 1. */
export const CELLS_PER = Object.freeze({ 3: 35, 4: 7, 5: 1 });
/**
 * The cycle of `level` (3 δ, 4 ε, 5 ζ) that runs through cell `z` (global ζ index): such a cycle is always a whole
 * number of cells, so a cell is inside exactly one of them. `local` is its 1-based ordinal inside its parent.
 */
export function overlayCycle(model, z, level) {
  const size = CELLS_PER[level];
  const idx = Math.floor(z / size);
  return { level, idx, local: (idx % model.levelInfo(level).siblings) + 1, startsHere: z % size === 0, cells: size };
}

/**
 * The 5 δ of a γ for the ribbon: one segment each, the ε rhythm inside it (4 inner ticks: 5 ε per δ) and the δ
 * boundaries between the segments.
 */
export function buildRibbon(model, gammaIdx) {
  const segs = [];
  const per = PAGES_PER.gamma;
  for (let i = 0; i < per; i++) {
    const hv = gammaIdx * per + i;
    segs.push({ hv, delta: i + 1, x0: i / per, x1: (i + 1) / per, inRange: (hv * 4) / P(model, 3) < model.extent });
  }
  const eps = [];
  for (let i = 0; i < per; i++) for (let r = 1; r < 5; r++) eps.push({ x: (i * 5 + r) / (per * 5), hv: gammaIdx * per + i, row: r });
  const deltas = [];
  for (let i = 1; i < per; i++) deltas.push({ x: i / per, hv: gammaIdx * per + i });
  return { gamma: gammaIdx, segs, eps, deltas, path: model.cycleToPath(2, BigInt(gammaIdx)) };
}
