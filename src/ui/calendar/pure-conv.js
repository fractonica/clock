/**
 * Pure-mode calendar maths (no DOM, no Earth units): everything the pure converter, the pure month page and the pure
 * jump box need to talk about a moment in Fractonica terms only (SPEC §15, docs/design/80-pure.md, revision 3).
 *
 * Vocabulary comes from src/core/pure.js (`pure` = createPure(model)):
 *   major periods   α Alpha · β Beta · γ Gamma · δ Delta, said in WORDS with a fracton ordinal and a quarter word
 *                   ("Delta Trifracton Node"; the quarter is named by the threshold that ends it: Peak Node Valley End)
 *   minor units     ε Nuclide (ordinal ε#1–5 in its Delta) · η Helion (NUMBERED 1–77 in the Nuclide: "34η" is the 34th)
 *                   · ι Preon (count 0–35 in the Helion) · λ Flavon (0–64 in the Preon) · ν Blink (0–24 in the Flavon)
 *   ζ θ κ μ (and ξ …) are depths of the hierarchy, not units: a ζ is 11η, a θ 4ι, a κ 13λ, a μ 5ν.
 * The stamp is the full letter form `α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ 3ν`. This file adds the INVERSE of those readings (a
 * date in any of its forms -> a moment), counter editing, exact landings, and the geometry of the pure month page: one
 * Delta as 5 Nuclide rows (ε#1–5) x 7 columns of 11 Helions (the ζ cycles, labelled by their first Helion 1η 12η … 67η),
 * with the Delta's quarter thresholds at 1¼, 2½ and 3¾ Nuclides.
 *
 * NOTATION: X#n is an ORDINAL counted from 1 (δ#3, ε#2); nX is a COUNT of units counted from 0 (17ι, spans 6ι 43λ), except
 * the Helion of a date, which is written nη but NUMBERED from 1 (34η = the 34th Helion of its Nuclide). Spans and offsets
 * stay counts: +5η is five Helions.
 *
 * Everything is computed in Saros POSITION space: the hierarchy is exactly aligned there (a Nuclide is 4/1625 of a Saros
 * unit, 77 Helions make one …), and only the last step converts a position to the Unix seconds the app runs on. Which
 * cycle a moment is in is always asked of the model (exact rational position), exactly like the header does: no relative
 * tolerances, so the page, the cells and the landings agree with the header at every millisecond.
 */
import { LEVEL_NAMES, QUARTER_WORDS, UNITS, ordinalName } from '../../core/pure.js';
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
// the nine entries of a date
// ---------------------------------------------------------------------------------------------
/** The entries of a date, coarse to fine (the ids of core `UNITS`): α β γ δ ε are ordinals and η is numbered (all from 1), ι λ ν counts (from 0). */
export const LADDER = Object.freeze(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'eta', 'iota', 'lambda', 'nu']);
/** Depth level (0-based) of every entry: ε depth 5, η 7, ι 9, λ 11, ν 13. */
export const LEVEL_OF = Object.freeze(Object.fromEntries(LADDER.map((id) => [id, unitById(id).level])));
/** The four major periods, said in words. */
export const MAJOR_IDS = Object.freeze(['alpha', 'beta', 'gamma', 'delta']);
export const isMajorId = (id) => MAJOR_IDS.includes(id);
const SYM = Object.freeze(Object.fromEntries(LADDER.map((id) => [id, unitById(id).sym])));
/** Entries that are ordinals (identity, from 1); the others are counts (completed units, from 0). */
export const ORDINAL_IDS = Object.freeze(new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon']));
export const isOrdinalId = (id) => ORDINAL_IDS.has(id);
/** Entries numbered from 1: the ordinals and the Helion (written 34η, but the 34th Helion of its Nuclide). */
export const NUMBERED_IDS = Object.freeze(new Set([...ORDINAL_IDS, 'eta']));
export const isNumberedId = (id) => NUMBERED_IDS.has(id);
const FIRST = (id) => (NUMBERED_IDS.has(id) ? 1 : 0);
export const stampSym = (id) => SYM[id];
/** What an entry counts inside, in words (error messages). */
const PARENT = Object.freeze({ beta: 'an Alpha', gamma: 'a Beta', delta: 'a Gamma', epsilon: 'a Delta', eta: 'a Nuclide', iota: 'a Helion', lambda: 'a Preon', nu: 'a Flavon' });
/** The unit word of an entry: "Delta", "Nuclide", "Helion" … */
export const unitWord = (id, n = 1) => `${unitById(id).name}${n === 1 ? '' : 's'}`;

const rangeCache = new WeakMap();
/**
 * The printed range of every entry, DERIVED from the hierarchy (sibling counts and unit lengths), not re-typed:
 * {alpha: {1,18}, beta: {1,5}, gamma: {1,13}, delta: {1,5}, epsilon: {1,5}, eta: {1,77}, iota: {0,35}, lambda: {0,64}, nu: {0,24}}.
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
    eta: { min: 1, max: ratio('epsilon', 'eta') },
    iota: { min: 0, max: ratio('eta', 'iota') - 1 },
    lambda: { min: 0, max: ratio('iota', 'lambda') - 1 },
    nu: { min: 0, max: ratio('lambda', 'nu') - 1 },
  });
  rangeCache.set(model, r);
  return r;
}

// ---------------------------------------------------------------------------------------------
// counters: what the header prints
// ---------------------------------------------------------------------------------------------
const spec = (id, min, max) => Object.freeze({ id, key: id, sym: SYM[id], level: unitById(id).level, ordinal: ORDINAL_IDS.has(id), numbered: NUMBERED_IDS.has(id), major: isMajorId(id), min, max });
/** The four major periods, edited by their fracton name (a test checks the ranges against ladderRanges()). */
export const MAJORS = Object.freeze([spec('alpha', 1, 18), spec('beta', 1, 5), spec('gamma', 1, 13), spec('delta', 1, 5)]);
/**
 * The five minor entries that can be edited in place, in ladder order: the Nuclide ordinal ε#1–5, the Helion numbered
 * 1–77 in the Nuclide, and the counts ι 0–35 (in the Helion), λ 0–64 (in the Preon), ν 0–24 (in the Flavon).
 */
export const COUNTERS = Object.freeze([spec('epsilon', 1, 5), spec('eta', 1, 77), spec('iota', 0, 35), spec('lambda', 0, 64), spec('nu', 0, 24)]);
export const counterById = (id) => COUNTERS.find((c) => c.id === id) ?? MAJORS.find((c) => c.id === id);
/** The counter written in the notation: "ε#3", "3η", or a major in words "Delta Trifracton". */
export const counterText = (s, n) => (s.major ? `${LEVEL_NAMES[s.level]} ${ordinalName(n)}` : s.ordinal ? ordText(s.sym, n) : countText(s.sym, n));

/** `pure.date` + `pure.clock` in one object ({alpha … epsilon, quarter, eta, iota, lambda, nu}), or null outside the catalogue. */
export function countersAt(pure, t) {
  const d = pure.date(t);
  const c = pure.clock(t);
  return d && c ? { ...d, ...c } : null;
}

/**
 * What one cycle of `level` is made of: the next unit down for a unit (δ 5ε, ε 77η, η 36ι, ι 65λ, λ 25ν; α 5β, β 13γ,
 * γ 5δ), the exact length for a depth between units (ζ 11η, θ 4ι, κ 13λ, μ 5ν; ξ 0.14ν). '' for the Blink, the finest.
 */
export function madeOf(model, pure, level) {
  const i = UNITS.findIndex((u) => u.level === level);
  if (i < 0) return pure.cycleLength(level);
  const next = UNITS[i + 1];
  if (!next) return '';
  return `${Math.round(pure.unitPos(UNITS[i]) / pure.unitPos(next))}${next.sym}`;
}
/** The unit a depth between units is counted in, and how many: ζ -> {sym η, n 11}, θ -> {ι, 4}, κ -> {λ, 13}, μ -> {ν, 5}. */
export function betweenUnit(model, level) {
  const next = UNITS.find((u) => u.level === level + 1);
  if (!next || UNITS.some((u) => u.level === level)) return null;
  return { unit: next, n: Math.round(P(model, level + 1) / P(model, level)) };
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
 * Edit one entry in place (a major by its ordinal, ε, or a count): the other entries keep their values (the odometer
 * way), the moment moves by whole units of it. Returns {t} or {error}.
 */
export function setCounter(model, pure, t, id, n) {
  const s = counterById(id);
  const cur = countersAt(pure, t);
  if (!s || !cur) return { error: 'This moment is outside the catalogue' };
  if (!Number.isInteger(n) || n < s.min || n > s.max) {
    if (s.major) return { error: `${LEVEL_NAMES[s.level]} runs ${ordinalName(s.min)} … ${ordinalName(s.max)}` };
    return { error: s.ordinal ? `${s.sym}#n is numbered ${s.min}–${s.max}` : s.numbered ? `${s.sym} is numbered ${s.min}–${s.max}` : `${s.sym} counts ${s.min}–${s.max}` };
  }
  if (n === cur[s.key]) return { t: r3(t) };
  let out = shiftUnits(model, pure, t, id, n - cur[s.key]);
  if (out === null) return { error: `That is outside the catalogue ${pure.catalogueText()}` };
  // (rounding to the nearest millisecond can land a hair before a unit boundary, where the old counter still shows)
  for (let i = 0; i < 3 && countersAt(pure, out)?.[s.key] !== n; i++) out = r3(out + 0.001);
  return { t: out };
}

// ---------------------------------------------------------------------------------------------
// dates -> moments
// ---------------------------------------------------------------------------------------------
/** "Delta Trifracton Node" / "ε#2" / "5η": one entry of a date as it is written. */
function partText(p) {
  if (isMajorId(p.id)) return `${LEVEL_NAMES[LEVEL_OF[p.id]]} ${ordinalName(p.n)}${p.quarter !== undefined && p.quarter !== null ? ' ' + QUARTER_WORDS[p.quarter] : ''}`;
  return ORDINAL_IDS.has(p.id) ? ordText(SYM[p.id], p.n) : countText(SYM[p.id], p.n);
}

/**
 * A date read back as a moment: `parts` = [{id, n, quarter?}] consecutive entries of the LADDER, in any of the four forms
 * (`Alpha Hexafracton Valley, …, Delta Trifracton End, ε#5 34η 29ι`, `Delta Trifracton End ε#5 34η 29ι`,
 * `α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ 3ν`, `δ#3 ε#5 34η 29ι`); the entries above the first one are taken from `ref` (the
 * shown moment). The result is the FIRST MILLISECOND that shows the finest entry given.
 *
 * A quarter word (0 Peak … 3 End) on a major entry is checked against the rest of the date; on the finest entry (no minor
 * part follows) it means the start of that quarter: "Delta Trifracton Node" is the peak of Delta Trifracton, where its
 * Node quarter begins. Counts alone ("5η 17ι") are read inside the Nuclide of `ref`.
 * @returns {{t:number, pos:number, id:string, values:object} | {error:string, detail?:string}}
 */
export function resolveParts(model, pure, parts, ref) {
  if (!parts.length) return { error: 'Nothing to read' };
  const ids = parts.map((p) => LADDER.indexOf(p.id));
  const word = (id) => (isMajorId(id) ? LEVEL_NAMES[LEVEL_OF[id]] : SYM[id]);
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] <= ids[i - 1]) return { error: 'Write the entries from the longest to the shortest', detail: 'e.g. Delta Trifracton Node ε#2 21η 12ι · α#6 β#4 γ#9 δ#3 ε#5 34η' };
    if (ids[i] !== ids[i - 1] + 1) return { error: `${word(LADDER[ids[i - 1] + 1])} is missing between ${word(LADDER[ids[i - 1]])} and ${word(LADDER[ids[i]])}`, detail: 'Write consecutive entries, e.g. α#6 β#4 γ#9 δ#3 ε#5 34η 29ι' };
  }
  const etaIdx = LADDER.indexOf('eta');
  const first = ids[0];
  const finestIdx = ids[ids.length - 1];
  const finest = LADDER[finestIdx];
  const R = ladderRanges(model, pure);
  let base = null;
  if (first > 0) {
    base = ref !== undefined && ref !== null ? countersAt(pure, ref) : null;
    if (!base) return { error: 'The shown moment is outside the catalogue, so the enclosing periods are unknown', detail: 'Start the date with the Alpha, e.g. α#6 β#4 γ#9 δ#3' };
  }
  const values = {};
  LADDER.forEach((id, i) => {
    values[id] = i < first ? base[id] : FIRST(id);
  });
  for (const p of parts) {
    const id = p.id;
    const { min, max } = R[id];
    if (!Number.isInteger(p.n) || p.n < min || p.n > max) {
      if (id === 'alpha') return { error: `The catalogue holds only ${max} Alphas (${pure.catalogueText()})`, detail: `Alpha ${ordinalName(1)} … Alpha ${ordinalName(max)}` };
      if (isMajorId(id)) {
        const lv = LEVEL_NAMES[LEVEL_OF[id]];
        return { error: `${lv} ${ordinalName(p.n)}: ${PARENT[id]} holds ${max} ${lv}s`, detail: `${lv} ${ordinalName(min)} … ${lv} ${ordinalName(max)} (${ordText(SYM[id], min)} … ${ordText(SYM[id], max)})` };
      }
      const ord = ORDINAL_IDS.has(id);
      const what = ord ? ordText(SYM[id], p.n) : countText(SYM[id], p.n);
      const edge = p.n > max ? (ord ? ordText(SYM[id], max) : countText(SYM[id], max)) : ord ? ordText(SYM[id], min) : countText(SYM[id], min);
      // (the Helion is numbered from 1: 0η is no Helion)
      const why = id === 'eta' && p.n < min ? ': Helions are numbered from 1' : '';
      return { error: `${what}: ${SYM[id]} ${NUMBERED_IDS.has(id) ? 'is numbered' : 'counts'} ${min}–${max} inside ${PARENT[id]}`, detail: `${edge} is the ${p.n > max ? 'last' : 'first'}${why}` };
    }
    if (p.quarter !== undefined && p.quarter !== null && !(Number.isInteger(p.quarter) && p.quarter >= 0 && p.quarter <= 3)) return { error: 'A quarter is Peak, Node, Valley or End' };
    values[id] = p.n;
  }
  const gIdx = model.pathToCycle([values.alpha, values.beta, values.gamma]);
  if (gIdx === null) return { error: `${partText({ id: 'gamma', n: values.gamma })} of Alpha ${ordinalName(values.alpha)}, Beta ${ordinalName(values.beta)} begins after the catalogue ends`, detail: `The catalogue ends inside Alpha ${ordinalName(R.alpha.max)}; its last periods are clipped` };
  const len = (id) => pure.unitPos(unitById(id));
  let pos = (Number(gIdx) * 4) / P(model, 2) + (values.delta - 1) * len('delta') + (values.epsilon - 1) * len('epsilon');
  // pos is the start of the named (or shown) Nuclide: whole cycles all the way down, so it sits on a Nuclide boundary
  const elen = len('epsilon');
  const nIdx = Math.round(pos / elen);
  pos = nIdx * elen;
  const bare = first >= etaIdx; // counts alone: inside the Nuclide of the shown moment
  const unitStart = pos + (values.eta - 1) * len('eta') + values.iota * len('iota') + values.lambda * len('lambda') + values.nu * len('nu');
  // the span the finest entry names, [lo, hi) in position, narrowed by every quarter word: a quarter word only has to
  // meet the date somewhere ("Delta Trifracton Node ε#2" is the part of ε#2 that lies in the Node quarter, so the short
  // date the header prints always reads back); on the finest entry it is the start of that quarter
  let lo = unitStart;
  let hi = unitStart + len(finest);
  const quartered = parts.filter((p) => isMajorId(p.id) && p.quarter !== undefined && p.quarter !== null);
  for (const p of quartered) {
    const ml = len(p.id);
    const ms = Math.floor((unitStart + EPS_POS) / ml) * ml; // the start of that major cycle (they nest exactly)
    lo = Math.max(lo, ms + (p.quarter * ml) / 4);
    hi = Math.min(hi, ms + ((p.quarter + 1) * ml) / 4);
  }
  if (quartered.length && !(hi - lo > EPS_POS)) return quarterMismatch(model, quartered.find((p) => !quarterMeets(p, unitStart, len(finest), len(p.id))) ?? quartered[0], parts, unitStart, len(finest));
  const target = lo;
  if (!(target >= 0 && target < model.extent)) return { error: `That moment lies after the catalogue ends ${pure.catalogueText()}` };
  // what the first millisecond must show: every entry down to the finest one (or the counts inside that Nuclide)
  const given = LADDER.slice(bare ? etaIdx : 0, finestIdx + 1);
  const want = (c) => {
    const cs = countersAt(pure, c);
    if (!cs) return false;
    if (bare && model.levelAt(c, 4)?.cycle !== nIdx) return false;
    for (const p of quartered) if (pure.quarterAt(c, LEVEL_OF[p.id]) !== p.quarter) return false;
    return given.every((id) => cs[id] === values[id]);
  };
  let t = firstMs(model.timeOfPosition(target), want);
  // (null cannot happen for a position the model itself produced; the nearest millisecond is the honest fallback)
  if (t === null) t = inCatalogue(model, Math.ceil(model.timeOfPosition(target) * 1000) / 1000);
  const last = parts[parts.length - 1];
  return { t, pos: target, id: finest, values, quarter: isMajorId(finest) && last.quarter !== undefined ? last.quarter ?? null : null };
}
/** Does the quarter word of major entry `p` meet the span [start, start + span) of the finest entry? */
function quarterMeets(p, start, span, ml) {
  const ms = Math.floor((start + EPS_POS) / ml) * ml;
  return Math.max(start, ms + (p.quarter * ml) / 4) < Math.min(start + span, ms + ((p.quarter + 1) * ml) / 4) - EPS_POS;
}
/** "Delta Trifracton Node and ε#2 5η do not meet": with the quarter(s) the date does lie in. */
function quarterMismatch(model, p, parts, start, span) {
  const ml = 4 / P(model, LEVEL_OF[p.id]);
  const ms = Math.floor((start + EPS_POS) / ml) * ml;
  const q0 = Math.min(3, Math.floor(((start - ms) / ml) * 4 + 1e-9));
  const q1 = Math.min(3, Math.floor(((start + span - ms) / ml) * 4 - 1e-9));
  const words = q1 > q0 ? `${QUARTER_WORDS[q0]} … ${QUARTER_WORDS[q1]} quarters` : `${QUARTER_WORDS[q0]} quarter`;
  const rest = parts.filter((x) => LADDER.indexOf(x.id) > LADDER.indexOf(p.id)).map(partText).join(' ');
  const name = `${LEVEL_NAMES[LEVEL_OF[p.id]]} ${ordinalName(p.n)}`;
  return {
    error: `${name} ${QUARTER_WORDS[p.quarter]} and ${rest || 'the rest of the date'} do not meet`,
    detail: `${rest || 'That date'} lies in the ${words} of ${name}: write ${name} ${QUARTER_WORDS[q0]}${rest ? ' ' + rest : ''}, or leave the quarter out`,
    quarter: q0,
  };
}

/**
 * Entries of a date in letters, like the stamp: "α#6 β#4 γ#9 δ#3 ε#5 34η 29ι" (`words`: the majors as names with their
 * quarter words, when they were given, "Delta Trifracton Node ε#2 5η").
 */
export function entriesText(parts, { words = false } = {}) {
  return parts.map((p) => (words || p.words ? partText(p) : ORDINAL_IDS.has(p.id) ? ordText(SYM[p.id], p.n) : countText(SYM[p.id], p.n))).join(' ');
}

// ---------------------------------------------------------------------------------------------
// small descriptions
// ---------------------------------------------------------------------------------------------
/**
 * The distance between two moments (a <= b) counted in ladder units, measured in position (pure.between, exact across
 * eclipse intervals). A tiny allowance (2 ms, the size of one rounding to the millisecond at each end) keeps a span
 * that was built from whole units ("-1ι") from reading one small unit short ("64λ 24ν"); spans below ten Blinks are a
 * decimal count of ν and are given as measured.
 */
const SPAN_SLACK = 0.002;
export function spanText(model, pure, a, b, { parts = 2 } = {}) {
  const lo = r3(Math.min(a, b));
  const hi = r3(Math.max(a, b));
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
// the pure month page: one Delta = 5 Nuclide rows x 7 columns of 11 Helions
// ---------------------------------------------------------------------------------------------
/** The page grid: 5 rows (ε#1–5) x 7 columns; a cell is one ζ cycle = 11 Helions. */
export const GRID = Object.freeze({ rows: 5, cols: 7, cells: 35 });
/** Helions in a cell, and the first Helion of each column (numbered from 1 in the Nuclide): 1η 12η 23η 34η 45η 56η 67η. */
export const ETA_PER_CELL = 11;
export const COLUMN_ETA = Object.freeze(Array.from({ length: GRID.cols }, (_, c) => c * ETA_PER_CELL + 1));
/** Pages (Deltas) in one Gamma, Beta and Alpha: 5, 13 x 5, 5 x 13 x 5 (what the ◀ ▶ steps move by). */
export const PAGES_PER = Object.freeze({ gamma: 5, beta: 65, alpha: 325 });
/** Quarter marks inside a Helion (peak, node, valley): 9ι, 18ι, 27ι of its 36. */
export const QUARTER_NAMES = Object.freeze(['', 'peak', 'node', 'valley']);

/** Number of Delta pages that start inside the catalogue. */
export function viewCount(model) {
  return Math.ceil((model.extent * P(model, 3)) / 4);
}
/** Index of the Delta page that holds time `t` (null outside the catalogue): the header's Delta, exactly. */
export function viewOfTime(model, t) {
  const l = model.levelAt(r3(t), 3);
  return l ? Math.min(viewCount(model) - 1, l.cycle) : null;
}
/** Clamp a page index into the catalogue. */
export const clampView = (model, hv) => Math.max(0, Math.min(viewCount(model) - 1, Math.round(hv)));

/** Where a page sits in the hierarchy: its Gamma (global index and α β γ ordinals) and its Delta ordinal 1..5 inside it. */
export function viewInfo(model, hv) {
  const gamma = Math.floor(hv / PAGES_PER.gamma);
  const delta = (hv % PAGES_PER.gamma) + 1;
  const path = model.cycleToPath(2, BigInt(gamma));
  return { hv, gamma, delta, path, alpha: path[0], beta: path[1], gammaOrd: path[2] };
}
/** Page index for α β γ ordinals and a Delta ordinal (clamped into the catalogue). */
export function viewFromPath(model, alpha, beta, gammaOrd, delta) {
  let idx = model.pathToCycle([alpha, beta, gammaOrd]);
  if (idx === null) {
    // beyond the clipped end of the catalogue: step back to the last Gamma that exists
    const last = Number(model.clock.count(2)) - 1;
    idx = BigInt(last);
  }
  return clampView(model, Number(idx) * PAGES_PER.gamma + (delta - 1));
}

const eclipseCells = new WeakMap();
/**
 * Map: global ζ index (a cell) -> the eclipse number that falls inside it. An eclipse sits at an integer position k, which
 * is k x 2843.75 cells: it falls at 0, ¼, ½ or ¾ of its cell (k mod 4 = 0, 1, 2, 3 gives 0, ¾, ½, ¼), and one cell holds
 * at most one eclipse.
 */
function eclipseMap(model) {
  let m = eclipseCells.get(model);
  if (m) return m;
  m = new Map();
  const z = P(model, 5) / 4; // cells per Saros unit (2843.75: k * z is exact in a double)
  for (let k = 0; k <= model.extent; k++) {
    const cell = Math.floor(k * z);
    m.set(cell, { k, frac: k * z - cell });
  }
  eclipseCells.set(model, m);
  return m;
}

/**
 * The quarters of the page's Delta in cell coordinates: quarter q (0 Peak … 3 End) runs from cell index × fraction
 * `from` to `to` (a Delta is 35 cells, a quarter 8¾: the thresholds fall at 1¼, 2½ and 3¾ Nuclides).
 */
export function deltaQuarters() {
  const out = [];
  for (let q = 0; q < 4; q++) out.push({ q, word: QUARTER_WORDS[q], from: (q * GRID.cells) / 4, to: ((q + 1) * GRID.cells) / 4 });
  return out;
}

/**
 * The page for Delta number `hv`: 35 cells, each a ζ cycle of 11 Helions with
 *   - its row (Nuclide ε#row+1), column and first Helion `eta0` (1, 12 … 67: numbered from 1 in the Nuclide),
 *   - its 11 Helions (`count` eta0 … eta0+10, their number in the Nuclide) and the peak / node / valley mark of each,
 *   - the Nuclide phase at the start of the cell (the 256-state pair), the eclipse it holds (and where: 0, ¼, ½, ¾ of
 *     the cell), the sync quarters in it, and the Delta quarter(s) it lies in (`dq`: {q, x0, x1, startsHere}).
 * Cell positions are Saros positions; `start`/`end` are the Unix seconds the app runs on: `start` is the FIRST
 * MILLISECOND that shows the cell (what the header counts), `end` the first millisecond of the next one.
 */
export function buildPureGrid(model, hv) {
  const zN = P(model, 5);
  const ext = model.extent;
  const z0 = hv * GRID.cells;
  const ecl = eclipseMap(model);
  const posOf = (z) => (z * 4) / zN;
  const quarters = deltaQuarters();
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
    const col = i % GRID.cols;
    const cell = {
      index: i,
      row: Math.floor(i / GRID.cols),
      col,
      epsilon: Math.floor(i / GRID.cols) + 1,
      eta0: COLUMN_ETA[col],
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
      epsPhase: col / GRID.cols, // a Nuclide is 7 cells: its phase at the cell start is the column over 7
      etas: [],
      quarters: [],
      syncs: [],
      dq: [],
    };
    // the 11 Helions of the cell: whole cycles, [j/11, (j+1)/11); the peak / node / valley marks sit at ι 9, 18, 27
    for (let j = 0; j < ETA_PER_CELL; j++) {
      const eta = z * ETA_PER_CELL + j;
      cell.etas.push({ eta, local: j, count: cell.eta0 + j, x0: j / ETA_PER_CELL, x1: (j + 1) / ETA_PER_CELL, startsHere: true, endsHere: true, odd: eta & 1 });
      for (let q = 1; q <= 3; q++) cell.quarters.push({ x: (j + q / 4) / ETA_PER_CELL, q, name: QUARTER_NAMES[q], eta, local: j, count: cell.eta0 + j });
    }
    // the Delta quarter(s) this cell lies in
    for (const dq of quarters) {
      const a = Math.max(i, dq.from);
      const b = Math.min(i + 1, dq.to);
      if (b > a) cell.dq.push({ q: dq.q, word: dq.word, x0: a - i, x1: b - i, startsHere: dq.from >= i && dq.from < i + 1 });
    }
    cells.push(cell);
  }
  const grid = { hv, z0, cells, quarters, start: cells[0].start, end: cells[GRID.cells - 1].end, pos0: cells[0].pos0, pos1: cells[GRID.cells - 1].pos1 };
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
/** Index (0..34) of the cell of `grid` holding time `t` (the header's Nuclide and Helion, exactly), or -1. */
export function cellOfTime(model, grid, t) {
  const l = model.levelAt(r3(t), 5);
  if (!l) return -1;
  const i = l.cycle - grid.z0;
  return i >= 0 && i < GRID.cells ? i : -1;
}

/** The first millisecond of Helion `etaIdx` (global index), or null beyond the catalogue. */
export function etaStartTime(model, etaIdx) {
  return cycleStart(model, 6, etaIdx);
}
/** The first millisecond of cycle `idx` of `level` (global index), or null beyond the catalogue. */
export function cycleStart(model, level, idx) {
  if (model.cycleStartTime(level, idx) === null) return null;
  return landPoint(model, level, idx, 0);
}
/** Cells per Nuclide (a row). */
export const CELLS_PER = Object.freeze({ 4: 7, 5: 1 });
/**
 * The cycle of `level` (4 ε, 5 ζ) that runs through cell `z` (global ζ index): such a cycle is always a whole number of
 * cells, so a cell is inside exactly one of them. `local` is its 1-based ordinal inside its parent.
 */
export function overlayCycle(model, z, level) {
  const size = CELLS_PER[level];
  const idx = Math.floor(z / size);
  return { level, idx, local: (idx % model.levelInfo(level).siblings) + 1, startsHere: z % size === 0, cells: size };
}

/**
 * The 5 Deltas of a Gamma for the ribbon: one segment each, the Nuclide rhythm inside it (4 inner ticks: 5 Nuclides per
 * Delta) and the Delta boundaries between the segments.
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
