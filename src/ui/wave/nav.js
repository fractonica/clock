/**
 * Pure navigation decisions of the wave view: which level a stored selection means, which level
 * is followable, what the zoom and step controls do, and how far through a half-arc we are.
 * No DOM and no clock access; the engine (scene.js) and plain numbers are all they need, so the
 * rules can be unit-tested in Node.
 */

export const MAX_LEVEL = 13;
export const OUT_OF_RANGE_HINT = 'Outside the catalogue: use “Go to the first eclipse” or “Go to the last eclipse”';

/** A shared level selection as an integer 0..max; anything that is not a number falls back to `fallback`. */
export function sanitizeLevel(n, max = MAX_LEVEL, fallback = 6) {
  const isNumeric = typeof n === 'number' || (typeof n === 'string' && n.trim() !== '');
  const v = isNumeric ? Math.round(Number(n)) : NaN;
  return Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback;
}

/**
 * The level to focus: the selected one unless its half-arcs would change faster than the eye can
 * follow, in which case the deepest level that still lasts `minLife` seconds on screen.
 * @param rate displayed seconds per real second (0 when the clock is paused)
 * @param meanSeconds (level) => mean cycle length in seconds
 */
export function followableLevel(level, { rate = 0, reduced = false } = {}, meanSeconds) {
  if (!rate) return level;
  const minLife = reduced ? 1.5 : 0.5;
  let l = level;
  while (l > 0 && meanSeconds(l) / 2 / Math.abs(rate) < minLife) l--;
  return l;
}

/**
 * What a zoom step does. dir > 0 goes one level deeper, dir < 0 one level out (level 0 leads to
 * the catalogue). `eff` is the level actually shown (it can be coarser than the selection).
 * @returns {{kind:'select', level:number} | {kind:'focus', level:number} | {kind:'overview'} | {kind:'toast', msg:string}}
 */
export function zoomPlan({ inRange, overview, level, eff }, dir, max = MAX_LEVEL) {
  if (!inRange) return { kind: 'toast', msg: OUT_OF_RANGE_HINT };
  if (dir > 0) {
    if (overview) return { kind: 'focus', level: 0 };
    if (level < max) return { kind: 'select', level: level + 1 };
    return { kind: 'toast', msg: `Depth ${max + 1} (ξ) is the deepest shown` };
  }
  if (overview) return { kind: 'toast', msg: 'The whole catalogue is already shown' };
  const from = Math.min(level, eff);
  return from > 0 ? { kind: 'select', level: from - 1 } : { kind: 'overview' };
}

/** Whether the zoom buttons can act: {in, out} (false = nothing would happen). */
export function zoomEnabled({ inRange, overview, level }, max = MAX_LEVEL) {
  return { in: inRange && (overview || level < max), out: inRange && !overview };
}

/**
 * Progress 0..1 through the part of half-arc `d` that lies inside the catalogue. The model reads
 * the last millisecond one step inside, so the final instant counts as complete.
 * @param d describe() of the half-arc, local = the marker's progress through it
 */
export function throughOf(d, local, t, tMax) {
  if (t >= tMax - 0.001) return 1;
  const p = d.clipped ? local / Math.max(1e-9, d.fraction) : local;
  return Math.min(1, Math.max(0, p));
}
