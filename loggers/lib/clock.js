// The clock the loggers keep time by: the web app's own modules (src/core), as the hub's fx.js uses them, so a
// logger's Flavons are the clock's own (Saros 141, the solar sync anchored at its ordinal 20) to the millisecond.
//
// Flavons are numbered by their cycle at level λ (10) since the catalogue began; a Helion (η, 6) holds exactly 2340 of
// them (9 θ × 4 ι × 5 κ × 13 λ), a Preon (ι, 8) 65, so Flavon n is in Helion ⌊n / 2340⌋ and a Helion starts with the
// Flavon numbered 2340 × its own number.
import '../../fractonica.js';
import { createModel } from '../../src/core/model.js';
import { createPure } from '../../src/core/pure.js';

const model = createModel();
const pure = createPure(model);

export const FLAVON = 10;
const HELION = 6;
const PREON = 8;

/** Flavons in one cycle of `level` (a Helion's 2340, a Preon's 65). */
export const flavonsIn = (level) => Math.round(model.levelInfo(FLAVON).prefixNum / model.levelInfo(level).prefixNum);
export const PER_HELION = flavonsIn(HELION);
/** A Flavon's mean length, seconds (7.773). */
export const FLAVON_SECONDS = model.levelInfo(FLAVON).meanSeconds;

/** When Flavon `n` starts (Unix seconds); null beyond the catalogue. */
export const flavonStart = (n) => model.cycleStartTime(FLAVON, n);

/** The Flavon running at t (its number), null outside the catalogue. */
export function flavonAt(t) {
  const l = model.levelAt(t, FLAVON);
  return l ? l.cycle : null;
}

/** The first Flavon that starts after t (a boundary at most a millisecond ahead counts as passed). */
export function nextFlavon(t) {
  const n = flavonAt(t);
  if (n === null) return null;
  return flavonStart(n + 1) - t < 0.001 ? n + 2 : n + 1;
}

/**
 * How often a logger closes a record: `helion` (or η), `preon` (ι), or a number of Flavons (`65`, `65λ`).
 * → { flavons, name } (name: "Helion", "Preon", "13 Flavons"), or null.
 */
export function parseEvery(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (s === 'helion' || s === 'η' || s === 'eta') return { flavons: PER_HELION, name: 'Helion' };
  if (s === 'preon' || s === 'ι' || s === 'iota') return { flavons: flavonsIn(PREON), name: 'Preon' };
  const m = s.match(/^(\d+)\s*(?:λ|flavons?)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n >= 1 && n <= PER_HELION)) return null;
  if (n === PER_HELION) return { flavons: n, name: 'Helion' };
  if (n === flavonsIn(PREON)) return { flavons: n, name: 'Preon' };
  return { flavons: n, name: `${n} Flavon${n === 1 ? '' : 's'}` };
}

/**
 * The span Flavon `n` belongs to when a record closes every `flavons`: counted from its Helion's start, so a span never
 * crosses a Helion (a Helion's last span is shorter when `flavons` does not divide 2340). → { start, end } (Flavon
 * numbers, end exclusive).
 */
export function segmentOf(n, flavons) {
  const base = Math.floor(n / PER_HELION) * PER_HELION;
  const start = base + Math.floor((n - base) / flavons) * flavons;
  return { start, end: Math.min(start + flavons, base + PER_HELION) };
}

/** Read a hair inside a Flavon, so its own reading is never its neighbour's (a boundary rounds either way). */
const inside = (n) => flavonStart(n) + 0.25;

/** "33η 3ι 8λ": the Helion in its Nuclide, then Preons and Flavons completed (the app's minor clock). */
export const clockText = (n, upTo = 'lambda') => pure.clockText(inside(n), upTo);

/** "α6 β4 γ9 δ4 ε2": the date, its letters without the cycles' marks (as the app's reels are stamped). */
export function dateText(n) {
  return pure.stamp(inside(n)).split(' ').filter((p) => p.includes('#')).map((p) => p.replace('#', '')).join(' ');
}

/** What a span is called: "Helion 33η", "Preon 33η 3ι", else where it starts, "33η 3ι 8λ". */
export function spanName(seg, every) {
  if (every.name === 'Helion' && seg.end - seg.start === PER_HELION) return `Helion ${clockText(seg.start, 'eta')}`;
  if (every.name === 'Preon' && seg.end - seg.start === flavonsIn(PREON)) return `Preon ${clockText(seg.start, 'iota')}`;
  return clockText(seg.start);
}
