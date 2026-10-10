/**
 * Timeline data layer: everything the painter needs from the clock model and the zone-aware
 * formatter, cached so that a frame costs a few array walks instead of model queries.
 *
 *  - blocksFor(L, t0, t1)   cycle blocks of a lane covering a window (cached on a padded window)
 *  - cycleAt(L, t)         the cycle of level L that contains t (cached until t leaves it)
 *  - ticksFor / contextFor / weekendsFor   Gregorian axis items for a window (cached per step)
 *  - alpha, eclipses       static lists for the overview and the eclipse lane
 *
 * Block lists only hold what the model's float boundary arithmetic returns (`boundaries`,
 * `cycleStartTime`, `timeOfPosition`); exact BigInt readings (`levelAt`) are left to tooltips.
 */
import {
  limitsFor,
  generateTicks,
  generateContext,
  civilSpans,
  minorStepOf,
  stepById,
  formatCycleLength,
} from './helpers.js';
import { createRuler } from './ruler.js';

const MAX_BLOCKS = 4000;
const SLACK = 1.6; // a cycle is never longer than 1.6 x the mean of its level
/**
 * Boundary tolerance (s). The model rounds every query to 1 ms and its catalogue instants are floats
 * that may sit one ulp off the decimal table value, so a cursor exactly on a cycle start must still
 * count as inside that cycle.
 */
const EPS = 1e-4;

export function createData({ model, fmt, pure = null }) {
  const lim = limitsFor(model.tMin, model.tMax);
  /** The pure ruler (Fractonica units instead of the Gregorian axis); null when no pure vocabulary is supplied. */
  const ruler = pure ? createRuler({ model, pure }) : null;
  const blockCache = new Map();
  const currentCache = new Map();
  const spanCache = new Map();
  const labelCache = new Map();

  // ---- lane blocks ------------------------------------------------------------------------
  /**
   * Blocks {idx, local, start, end} of level L that overlap [t0, t1], sorted by start. The array
   * may extend beyond the window; callers clip. Cheap when the window only slides.
   */
  function blocksFor(L, t0, t1) {
    const d = model.levelInfo(L).meanSeconds;
    const need0 = t0 - SLACK * d;
    const need1 = t1 + SLACK * d;
    let e = blockCache.get(L);
    if (!e || e.lo > need0 || e.hi < need1) {
      const span = t1 - t0;
      const lo = need0 - span;
      const hi = need1 + span;
      const bs = model.boundaries(L, lo, hi, MAX_BLOCKS);
      const blocks = new Array(bs.length);
      let n = 0;
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        if (b.time >= model.tMax) continue; // deep levels list a zero-length "cycle" that starts at the closing instant
        const idx = b.idx || 0; // the model's ceil() can yield -0
        blocks[n++] = { idx, local: b.local || 0, start: b.time, end: model.cycleStartTime(L, idx + 1) ?? model.tMax };
      }
      blocks.length = n;
      e = { lo, hi: bs.length >= MAX_BLOCKS ? bs[bs.length - 1].time : hi, blocks };
      blockCache.set(L, e);
    }
    return e.blocks;
  }

  /** Does cycle c contain t? The catalogue's closing instant belongs to its last cycle (SPEC §2.2). */
  const inCycle = (c, t) => t + EPS >= c.start && (t + EPS < c.end || (c.end >= model.tMax && t <= model.tMax + EPS));

  /** Cycle of level L containing t: {level, idx, local, start, end} or null outside the catalogue. */
  function cycleAt(L, t, cache = true) {
    const c = cache ? currentCache.get(L) : null;
    if (c && inCycle(c, t)) return c;
    if (!(t + EPS >= model.tMin && t <= model.tMax + EPS)) {
      if (cache) currentCache.delete(L);
      return null;
    }
    const d = model.levelInfo(L).meanSeconds;
    const bs = model.boundaries(L, t - SLACK * d, t + 0.2 * d, 8);
    let pick = null;
    for (const b of bs) if (b.time <= t + EPS && b.time < model.tMax) pick = b;
    if (!pick) return null;
    const end = model.cycleStartTime(L, (pick.idx || 0) + 1) ?? model.tMax;
    if (!inCycle({ start: pick.time, end }, t)) return null;
    const out = { level: L, idx: pick.idx || 0, local: pick.local || 0, start: pick.time, end };
    if (cache) currentCache.set(L, out);
    return out;
  }

  /** Time of position (idx + q/4) of level L, i.e. the q-th quarter boundary of cycle idx. */
  function quarterTime(L, idx, q) {
    return model.timeOfPosition((4 * idx + q) / model.levelInfo(L).prefixNum);
  }

  // ---- Gregorian axis ---------------------------------------------------------------------
  function spans(kind, key, t0, t1, gen) {
    const k = `${fmt.zone()}|${kind}|${key}`;
    const e = spanCache.get(k);
    if (e && e.from <= t0 && e.to >= t1) return e.items;
    const w = t1 - t0;
    const from = t0 - w;
    const to = t1 + w;
    const items = gen(from, to);
    spanCache.set(k, { from, to, items });
    return items;
  }
  // a step is either a Gregorian one (helpers.js) or a pure ruler step (ruler.js, `step.pure`): same item shapes
  const ticksFor = (step, t0, t1) => spans('tick', step.id, t0, t1, (a, b) => (step.pure ? ruler.ticksIn(step, a, b) : generateTicks(step, a, b, fmt)));
  const minorFor = (step, t0, t1) => {
    const m = step.pure ? ruler.minorStepOf(step) : minorStepOf(step);
    return m ? { step: m, ticks: ticksFor(m, t0, t1) } : null;
  };
  const contextFor = (step, t0, t1) =>
    spans('ctx', step.id, t0, t1, (a, b) => (step.pure ? ruler.spansIn(step.ctx, a, b) : generateContext(step, a, b, fmt)));
  const weekendsFor = (t0, t1) =>
    spans('wk', 'day', t0, t1, (a, b) => civilSpans('day', a, b, fmt).filter((s) => s.weekday === 0 || s.weekday === 6));

  // ---- static lists -----------------------------------------------------------------------
  const alpha = model.boundaries(0, model.tMin, model.tMax, 64).filter((b) => b.time < model.tMax).map((b) => ({
    idx: b.idx || 0,
    start: b.time,
    end: model.cycleStartTime(0, (b.idx || 0) + 1) ?? model.tMax,
  }));
  const eclipses = model.catalogue; // 70 Unix instants, ascending
  /** Overview century ticks (zone aware, rebuilt when the zone changes). */
  const overviewTicks = () => spans('ov', 'year100', lim.d0, lim.d1, (a, b) => generateTicks(stepById('year100'), a, b, fmt));
  /** Pure overview labels: eclipse numbers ("#10" …, the position of that eclipse), which never depend on the zone. */
  const overviewMarks = () => (ruler ? ruler.overviewMarks() : []);

  // ---- strings ----------------------------------------------------------------------------
  /** "Oct 18 03:41" or, for long cycles, "Fri 18 Oct 2030". Cached per zone. */
  function endLabel(L, idx, end, refYear) {
    const k = `${fmt.zone()}|${L}|${idx}|${refYear}`;
    let s = labelCache.get(k);
    if (s === undefined) {
      const mean = model.levelInfo(L).meanSeconds;
      if (mean >= 5 * 86400) s = fmt.long(end, { seconds: false }).split(',')[0];
      else if (mean >= 3600) s = fmt.short(end, refYear);
      else s = fmt.short(end, refYear).slice(0, -5) + fmt.time(end, { seconds: true }); // short cycles: show seconds
      if (labelCache.size > 4000) labelCache.clear();
      labelCache.set(k, s);
    }
    return s;
  }
  const lengthLabel = (L) => formatCycleLength(model.levelInfo(L).meanSeconds);

  return {
    lim,
    blocksFor,
    cycleAt,
    quarterTime,
    ticksFor,
    minorFor,
    contextFor,
    weekendsFor,
    overviewTicks,
    overviewMarks,
    ruler,
    alpha,
    eclipses,
    endLabel,
    lengthLabel,
    invalidate() {
      // zone changes and mode switches: nothing derived from a formatter or a vocabulary may survive
      spanCache.clear();
      labelCache.clear();
    },
  };
}
