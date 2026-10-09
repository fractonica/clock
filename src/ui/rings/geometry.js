/**
 * Pure geometry and cycle maths for the rings view (no DOM, no canvas).
 *
 * Conventions
 *  - "phase" is the exact position inside a cycle, 0..1, as delivered by `frame.level(L).phase`.
 *  - Dial angles are measured clockwise from 12 o'clock, in phase units (0..1) unless a name says `rad`.
 *  - Canvas arcs want radians counter-clockwise from 3 o'clock: use `arcAngle(phase)`.
 *  - Ring 0 is the outermost ring (shallowest depth).
 */

export const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, s) => a + (b - a) * s;
const smooth = (s) => s * s * (3 - 2 * s);

/** Canvas `arc()` angle for a dial phase (0 = 12 o'clock, clockwise). */
export const arcAngle = (phase) => -HALF_PI + phase * TAU;

/** Point on a circle of radius r around (cx, cy) at a dial phase. */
export function pointAt(cx, cy, r, phase) {
  const a = phase * TAU;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/** Dial phase (0..1, clockwise from 12 o'clock) of a point relative to the centre. */
export function phaseOfPoint(cx, cy, x, y) {
  let a = Math.atan2(x - cx, -(y - cy));
  if (a < 0) a += TAU;
  const p = a / TAU;
  return p >= 1 ? 0 : p;
}

/**
 * Concentric layout for `count` rings in a square of `size` px.
 * Each ring owns a radial slot of `band` px; the drawn ring is `thick` px wide inside it so
 * the remaining lane is free for the funnel wedges.
 * @returns {{size:number,cx:number,cy:number,rOuter:number,rHole:number,band:number,thick:number,
 *   count:number,rings:{i:number,outer:number,inner:number,mid:number}[]}}
 */
export function ringLayout({ size, count, pad = 6, holeFrac = 0.46, maxBand = 24 }) {
  const n = Math.max(1, Math.floor(count));
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = Math.max(8, size / 2 - pad);
  // a few rings should be fat, many rings share the space left by the hole
  const rHole = Math.max(rOuter * holeFrac, rOuter - n * maxBand);
  const band = (rOuter - rHole) / n;
  const rings = [];
  for (let i = 0; i < n; i++) {
    const outer = rOuter - i * band;
    rings.push({ i, outer, inner: outer - band, mid: outer - band / 2 });
  }
  return { size, cx, cy, rOuter, rHole, band, thick: band * 0.62, count: n, rings };
}

/** The layout options the dial really uses for a square of `size` css px (shared with the tests). */
export const dialLayoutOptions = (size, count) => ({
  size,
  count,
  pad: size < 420 ? 4 : 6,
  holeFrac: size < 420 ? 0.44 : 0.52,
  maxBand: 26,
});

/**
 * What is under the pointer?
 * @returns {null | {zone:'hole'} | {zone:'ring', ring:number, phase:number, radial:number}}
 *   `radial` is 0 at the ring's inner edge and 1 at its outer edge.
 */
export function hitTest(layout, x, y, slack = 1) {
  const dx = x - layout.cx;
  const dy = y - layout.cy;
  const r = Math.hypot(dx, dy);
  if (r > layout.rOuter + slack) return null;
  if (r < layout.rHole) return { zone: 'hole' };
  const ring = clamp(Math.floor((layout.rOuter - r) / layout.band), 0, layout.count - 1);
  const slot = layout.rings[ring];
  return {
    zone: 'ring',
    ring,
    phase: phaseOfPoint(layout.cx, layout.cy, x, y),
    radial: clamp((r - slot.inner) / layout.band, 0, 1),
  };
}

/** Index of the child sector that a dial phase falls in. */
export const sectorOf = (phase, factor) => clamp(Math.floor(phase * factor), 0, factor - 1);

/**
 * The funnel between ring A (outer, radius ra) and ring B (inner, radius rb) for the sector
 * spanning phases [p0, p1] of ring A. The sector edges open smoothly until, on ring B, they
 * cover the full circle: the visual "zoom" from one cycle into its child.
 * @returns {{left:{r:number,phase:number}[], right:{r:number,phase:number}[]}}
 *   `left` runs from (ra, p0) to (rb, 0); `right` from (ra, p1) to (rb, 1).
 */
export function funnelCurves(ra, rb, p0, p1, steps = 10) {
  const left = [];
  const right = [];
  for (let k = 0; k <= steps; k++) {
    const s = k / steps;
    const e = smooth(s);
    const r = lerp(ra, rb, s);
    left.push({ r, phase: p0 * (1 - e) });
    right.push({ r, phase: lerp(p1, 1, e) });
  }
  return { left, right };
}

// ---------------------------------------------------------------------------------------------
// Waveform of the glyph value over one cycle
// ---------------------------------------------------------------------------------------------

/** Extreme value M of a d-stroke glyph (SPEC §4.1). */
export const glyphExtreme = (strokes = 2) => (3 ** strokes - 1) / 2;

/** Normalised triangle wave of a cycle: 0 -> +1 (peak) -> 0 (node) -> -1 (valley) -> 0. */
export function triangle(phase) {
  const p = clamp(phase, 0, 1);
  if (p < 0.25) return 4 * p;
  if (p < 0.75) return 2 - 4 * p;
  return 4 * p - 4;
}

/** Signed glyph value of state `index` (0 .. 4M-1) for an ascending family (SPEC §4.1). */
export function stateValue(index, M = 4) {
  if (index <= M) return index;
  if (index <= 3 * M) return 2 * M - index;
  return index - 4 * M;
}
/** The derivative dot (falling branch) of a glyph state. */
export const stateDotted = (index, M = 4) => index > M && index < 3 * M;

/** Quarter (0..3) a phase belongs to. */
export const quarterOf = (phase) => Math.min(3, Math.floor(clamp(phase, 0, 1) * 4));

/**
 * Rising / peak / falling / valley as the glyph shows it: the two extreme states (index M and
 * 3M) are the "peak" and "valley" states, everything else rises or falls.
 * @returns {{word:'Rising'|'Peak'|'Falling'|'Valley', dir:1|0|-1}}
 */
export function phaseWord(index, derivative, M = 4) {
  if (index === M) return { word: 'Peak', dir: 0 };
  if (index === 3 * M) return { word: 'Valley', dir: 0 };
  return derivative < 0 ? { word: 'Falling', dir: -1 } : { word: 'Rising', dir: 1 };
}

/**
 * Plot rectangle and axis mappings of the waveform inset.
 * @returns {{x0:number,x1:number,y0:number,y1:number,yMid:number,xOf:(p:number)=>number,
 *   phaseOf:(x:number)=>number,yOf:(v:number)=>number}} `v` is the normalised value -1..1
 */
export function waveLayout(w, h, { left = 34, right = 14, top = 26, bottom = 54 } = {}) {
  const x0 = left;
  const x1 = Math.max(x0 + 40, w - right);
  const y0 = top;
  const y1 = Math.max(y0 + 40, h - bottom);
  const yMid = (y0 + y1) / 2;
  const amp = ((y1 - y0) / 2) * 0.9;
  return {
    x0,
    x1,
    y0,
    y1,
    yMid,
    amp,
    xOf: (p) => x0 + clamp(p, 0, 1) * (x1 - x0),
    phaseOf: (x) => clamp((x - x0) / (x1 - x0), 0, 1),
    yOf: (v) => yMid - v * amp,
  };
}

// ---------------------------------------------------------------------------------------------
// Cycle <-> time helpers built on the model
// ---------------------------------------------------------------------------------------------

/**
 * Unix time at fractional position `phase` of cycle `cycle` at `level` (position-linear, so it
 * respects the uneven Saros intervals). Returns null beyond the catalogue.
 */
export function timeAtPhase(model, level, cycle, phase) {
  return model.cycleStartTime(level, cycle + clamp(phase, 0, 1));
}

/**
 * Highest phase the catalogue reaches inside the cycle with index `cycle` of `level`:
 * 1 for complete cycles, less for the last (clipped) cycle of a level.
 */
export function phaseLimit(model, level, cycle) {
  const P = model.levelInfo(level).prefixNum;
  const total = (model.extent * P) / 4; // cycles of this level in the catalogue (may be fractional)
  const room = total - cycle;
  return room >= 1 ? 1 : clamp(room, 0, 1);
}

/**
 * The child cycle (level + 1) number `j` of cycle `cycle` at `level`.
 * @returns {null | {level:number, index:number, local:number, start:number, end:number, duration:number, clipped:boolean}}
 *   null when the child starts outside the catalogue (at or after its closing instant: such a child has no
 *   duration) or is deeper than `maxLevel`.
 */
export function childCycle(model, level, cycle, j, maxLevel = 13) {
  const cl = level + 1;
  if (cl > maxLevel) return null;
  const factor = model.levelInfo(level).factor;
  if (j < 0 || j >= factor) return null;
  const index = cycle * factor + j;
  const start = model.cycleStartTime(cl, index);
  if (start === null || start >= model.tMax) return null;
  const nextStart = model.cycleStartTime(cl, index + 1);
  const clipped = nextStart === null;
  const end = clipped ? model.tMax : nextStart;
  return { level: cl, index, local: j, start, end, duration: end - start, clipped };
}

/**
 * The time a scrub gesture lands on: position `phase` of cycle `cycle` at `level`, kept strictly inside that
 * cycle on the model's 1 ms grid (the model rounds every query to a millisecond, so a bare `end - epsilon` of a
 * sub-second cycle would otherwise round into the next cycle).
 * @param {{snap?:boolean}} [o]  snap: land just (1 ms) past the exact instant, so the state that starts there shows
 * @returns {number|null}  null beyond the catalogue
 */
export function scrubTime(model, level, cycle, phase, { snap = false } = {}) {
  const limit = phaseLimit(model, level, cycle);
  const p = clamp(phase, 0, limit);
  let t = timeAtPhase(model, level, cycle, p);
  if (t === null) return null;
  if (snap || p < 1e-6) t += 0.001; // land just past exact boundaries
  const endT = limit >= 1 ? (timeAtPhase(model, level, cycle, 1) ?? model.tMax) : model.tMax;
  // latest millisecond strictly before the cycle's end (an end that sits on the grid up to float noise is on it)
  const endMs = endT * 1000;
  const onGrid = Math.abs(endMs - Math.round(endMs)) < 1e-3;
  const latest = (onGrid ? Math.round(endMs) - 1 : Math.floor(endMs)) / 1000;
  const startT = timeAtPhase(model, level, cycle, 0);
  return Math.max(startT ?? t, Math.min(t, latest));
}

/**
 * Where a quarter-threshold control (a chip of the centre read-out, "Next threshold") sends the clock: 1 ms past the
 * threshold instant, so the state that starts there is the one on display. A threshold already passed in the cycle on
 * show is a jump BACK to it (`kind: 'back'`), one still ahead a jump forward (`'ahead'`); both are ordinary moves inside
 * the catalogue. Only the catalogue's closing instant is a dead end.
 * @param {{tMax:number}} model
 * @param {number|null|undefined} threshold  the threshold instant (null: it lies beyond the catalogue)
 * @param {number} now  the displayed time
 * @returns {{kind:'back'|'ahead', time:number} | {kind:'end'|'here'|'void', time:null}}
 *   'end': the clock already stands at the catalogue's closing instant; 'here': it already stands there (nothing to do);
 *   'void': the threshold does not exist
 */
export function thresholdJump(model, threshold, now) {
  if (threshold === null || threshold === undefined || !Number.isFinite(threshold)) return { kind: 'void', time: null };
  const time = Math.min(threshold + 0.001, model.tMax);
  if (Math.abs(time - now) < 1e-6) return { kind: time >= model.tMax - 1e-6 ? 'end' : 'here', time: null };
  return { kind: time < now ? 'back' : 'ahead', time };
}

/** A touch held still for this long (ms) is a "tap and hold": it shows what the ring or sector under it is. */
export const HOLD_MS = 450;
/** A held touch that slides further than `slop` px has become a scroll or a drag, not a hold. */
export const holdSlipped = (dx, dy, slop = 10) => Math.hypot(dx, dy) > slop;

/**
 * What a click (or tap) on the dial does.
 *  - 'preview'      touch only: the first tap on a sector shows what a second tap would do
 *  - 'select'       select the ring, leave the time alone (labels, sectors that lead nowhere, the running sector of
 *                   a ring that is not selected yet: "where we are" is not a place to jump to)
 *  - 'select+goto'  select the ring and jump to the start of the sector's child cycle
 *  - 'goto'         jump (the ring is selected already)
 * @param {{label:boolean, hasChild:boolean, running:boolean, ringSelected:boolean, touch:boolean, previewed:boolean}} o
 * @returns {'preview'|'select'|'select+goto'|'goto'}
 */
export function dialIntent({ label, hasChild, running, ringSelected, touch, previewed }) {
  if (touch && !label && !previewed) return 'preview';
  if (label || !hasChild) return 'select';
  if (running && !ringSelected) return 'select';
  return ringSelected ? 'goto' : 'select+goto';
}

/** A touch that moves sideways by more than `slop` px (and more than it moves vertically) is a scrub, not a page scroll. */
export const isHorizontalDrag = (dx, dy, slop = 6) => Math.abs(dx) > slop && Math.abs(dx) > Math.abs(dy);

/** A level coming from outside (URL, storage, other views) made safe: an integer 0..13. */
export const normLevel = (v) => clamp(Math.round(Number(v)) || 0, 0, 13);

/**
 * The depth range the dial shows, from raw (possibly garbage or inverted) shared settings.
 * @returns {{minL:number, maxL:number}} zero-based levels, minL <= maxL
 */
export function normRange(minDepth, maxDepth) {
  const d = (v, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && v !== null && v !== '' ? n : fallback;
  };
  const minL = clamp(d(minDepth, 1) - 1, 0, 13);
  const maxL = clamp(d(maxDepth, 10) - 1, minL, 13);
  return { minL, maxL };
}

/**
 * One click on a range stepper, starting from the range the dial really shows.
 * @param {{minL:number,maxL:number}} range
 * @param {'min'|'max'} which
 * @param {number} d  +1 / -1 (depth units)
 * @returns {{minDepth:number, maxDepth:number}}
 */
export function stepRangeDepths({ minL, maxL }, which, d) {
  let min = minL + 1;
  let max = maxL + 1;
  if (which === 'min') min = clamp(min + d, 1, max);
  else max = clamp(max + d, min, 14);
  return { minDepth: min, maxDepth: max };
}

/** The smallest range that contains both `range` and level `L`. */
export function widenRangeTo({ minL, maxL }, L) {
  return { minDepth: Math.min(minL, L) + 1, maxDepth: Math.max(maxL, L) + 1 };
}

/**
 * Rings whose period is so short that a crisp hand would only strobe. `speed` is the number of
 * displayed seconds per real second (1 live, 0 paused: nothing moves, so nothing blurs), so a slow ring
 * can blur at x3600.
 */
export const isBlur = (info, speed = 1) => speed > 0 && info.meanSeconds / speed < 0.5;
/** Rings frozen under prefers-reduced-motion (period below 2 s of real time). */
export const isFast = (info, speed = 1) => speed > 0 && info.meanSeconds / speed < 2;
