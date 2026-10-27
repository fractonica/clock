/**
 * Pentads in the calendar (SPEC §7.5): the solar sync's 19 Helions as Pentad I, II, III (5 Helions) and the Hypopentad
 * (4). A Pentad is about a day, so in a Gregorian month each local day carries the Pentad that begins in it (where in the
 * day, like the cycle band), and in the pure Delta page the Helions of a cell group into Pentads the way days group into
 * weeks. Pure data; the views draw it with the shared mark of ../pentad.js.
 */
import { PENTAD_HELIONS, pentadsIn } from '../pentad.js';

/** The anchor's Helion (SPEC §7.5: A · P(6) / 4) and the sync length. */
const SYNC = 19;
const anchorHelion = (model) => (20 * model.levelInfo(6).prefixNum) / 4;
const mod = (a, n) => ((a % n) + n) % n;

/**
 * The Pentad of Helion `eta` (global index at depth 7), exactly as model.pentadAt counts it, without a clock reading:
 * {sync, index 0..3, helion 1..5 (its place in the Pentad), helions 5|4, first (it begins the Pentad)}.
 */
export function helionPentad(model, eta) {
  const k = eta - anchorHelion(model);
  const within = mod(k, SYNC);
  const index = Math.min(3, Math.floor(within / 5));
  const helion = within - 5 * index + 1;
  return { sync: Math.floor(k / SYNC), index, helion, helions: PENTAD_HELIONS[index], first: helion === 1 };
}

/**
 * The runs of Pentads across a block of consecutive Helions [eta0, eta0 + n): one run per Pentad that touches it,
 * with its extent in the block as fractions (x0, x1) and whether it begins / ends inside it. Used for the 11 Helions of
 * a pure calendar cell: {sync, index, x0, x1, startsHere, endsHere, from (first Helion of the run), count}.
 */
export function pentadRuns(model, eta0, n) {
  const runs = [];
  for (let j = 0; j < n; j++) {
    const p = helionPentad(model, eta0 + j);
    const last = runs.at(-1);
    if (last && last.sync === p.sync && last.index === p.index) {
      last.count++;
      last.x1 = (j + 1) / n;
      last.endsHere = p.helion === p.helions;
    } else {
      runs.push({ sync: p.sync, index: p.index, x0: j / n, x1: (j + 1) / n, startsHere: p.first, endsHere: p.helion === p.helions, from: eta0 + j, place: p.helion, count: 1 });
    }
  }
  return runs;
}

/**
 * The Pentads beginning inside a local day [start, end), from a list of Pentads (pentadsIn over the whole month), with
 * where in the day they begin (x, 0..1). `list` must be ordered; `from` is a hint index into it and the next hint is
 * returned as `next`.
 */
export function pentadStartsIn(list, start, end, from = 0) {
  let i = from;
  while (i < list.length && list[i].start < start) i++;
  const next = i;
  const out = [];
  for (; i < list.length && list[i].start < end; i++) {
    const p = list[i];
    out.push({ ...p, x: (p.start - start) / (end - start) });
  }
  return { starts: out, next };
}

/** Every Pentad overlapping [start, end): the inspector's list for a day. */
export const pentadsOfSpan = (model, start, end) => pentadsIn(model, start, end);

/** The Pentads of sync `n` as {index, start, end, helions}; empty where the sync is outside the catalogue. */
export function syncPentads(model, n) {
  const out = [];
  for (let index = 0; index < 4; index++) {
    const s = model.pentadByNumber(n, index);
    if (s) out.push({ sync: n, index, start: s.start, end: s.end, helions: PENTAD_HELIONS[index] });
  }
  return out;
}

/**
 * The Pentad runs of every cell of a pure Delta page (cells of 11 consecutive Helions): `cells` are
 * {etaFirst, n, inRange}; returns one array of runs per cell (none outside the catalogue).
 */
export const pagePentadRuns = (model, cells) => cells.map((c) => (c.inRange ? pentadRuns(model, c.etaFirst, c.n) : []));
