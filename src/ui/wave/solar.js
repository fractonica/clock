/**
 * The solar wave: geometry and decisions, no DOM and no clock access (plain numbers, so it can be
 * unit-tested in Node).
 *
 * A solar sync is 19 depth-7 (η) cycles (SPEC §7). Its boundaries are η cycle boundaries, so in Saros
 * position units the sync grid is exact: sync n starts at ((anchor + 19 n) * 4 / P6) with P6 the prefix
 * number of level 6 and anchor = A * P6 / 4 η cycles (A = 20, the first eclipse of Alpha 6). Because 19
 * is not a factor of the harmonic hierarchy a sync is not one more level of nested arcs; it is drawn as
 * a ripple whose wavelength is one sync, riding the focused arc:
 *
 *     displacement(p) = amp * sin(2π * syncPhase(position(p)))       (outward = positive)
 *
 * which puts the quarter boundaries where the glyph wave has them: peak at 1/4 of the sync, node at 1/2,
 * valley at 3/4 and the end of the sync back on the carrier. A half-sine crest followed by a half-sine
 * trough is exactly that sine, so the ripple and the mini wave of the dial share one shape.
 *
 * Positions are position-linear (as the arcs are); the sync phase of the model is time-linear. Inside one
 * Saros interval the two are the same, and they agree to 1e-10 at the reference instants (see the tests).
 */

export const SYNC_LEVEL = 6; // depth 7
export const SYNC_CYCLES = 19;
export const SYNC_ANCHOR = 20;
export const QUARTERS = Object.freeze(['peak', 'node', 'valley', 'end']);
/** A ripple needs at least this many syncs on the focused arc ... */
export const MIN_SYNCS = 1.5;
/**
 * ... and a wavelength of at least this many pixels. Below about 26 px the ripple stops reading as a wave (a few
 * pixels of fuzz on the arc); a phone still carries it at δ (27-32 px), a large desktop stage reaches γ (21-29 px).
 */
export const MIN_WAVELENGTH = 26;
/** From this wavelength on the ripple is drawn at full strength; between the two it fades in from MIN_STRENGTH. */
export const FULL_WAVELENGTH = 40;
export const MIN_STRENGTH = 0.5;
/** Amplitude of the ripple (px): 6 % of the wavelength, between these bounds. */
export const AMP_MIN = 3;
export const AMP_MAX = 20;
export const TAU = Math.PI * 2;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The sync grid for the prefix number `P6` of level 6 (125125 for Saros 141). */
export function syncGrid(P6) {
  return Object.freeze({ P6, anchor: (SYNC_ANCHOR * P6) / 4, length: (SYNC_CYCLES * 4) / P6 });
}

/** Sync coordinate of a Saros position: its integer part is the sync number, its fraction the phase. */
export const syncCoord = (pos, g) => ((pos * g.P6) / 4 - g.anchor) / SYNC_CYCLES;
/** The Saros position of a sync coordinate (inverse of syncCoord). */
export const positionOfCoord = (c, g) => ((c * SYNC_CYCLES + g.anchor) * 4) / g.P6;
/** {sync, phase, coord} at a Saros position. */
export function syncAt(pos, g) {
  const coord = syncCoord(pos, g);
  const sync = Math.floor(coord);
  return { sync, phase: coord - sync, coord };
}

/** How many syncs fit on `fraction` (0..1) of a half-arc of a level whose prefix number is `P`. */
export const syncsOnArc = (P, fraction, g) => (2 * fraction) / P / g.length;

/**
 * Where a half-arc sits in position units: progress p (0..1) of half-arc `idx` of a level with prefix `P`
 * is the position pos0 + p * span; `fraction` is the part inside the catalogue (the last arcs are clipped).
 */
export function arcSpec(idx, P, fraction = 1) {
  return { idx, P, pos0: (idx * 2) / P, span: 2 / P, fraction };
}

/**
 * Does the ripple fit on an arc of `arcPx` screen pixels carrying `syncs` syncs?
 * @returns {{visible:boolean, strength:number, wavelength:number, syncs:number, why:'ok'|'coarse'|'fine'}}
 *   why: 'coarse' = fewer than MIN_SYNCS on the arc (the arc is shorter than a sync), 'fine' = the wavelength
 *   would be below MIN_WAVELENGTH px. strength (0..1) fades the ripple in between MIN_WAVELENGTH and FULL_WAVELENGTH.
 */
export function rippleFit(syncs, arcPx) {
  const wavelength = syncs > 0 ? arcPx / syncs : Infinity;
  if (!(syncs >= MIN_SYNCS)) return { visible: false, strength: 0, wavelength, syncs, why: 'coarse' };
  if (!(wavelength >= MIN_WAVELENGTH)) return { visible: false, strength: 0, wavelength, syncs, why: 'fine' };
  const k = (wavelength - MIN_WAVELENGTH) / (FULL_WAVELENGTH - MIN_WAVELENGTH);
  return { visible: true, strength: clamp01(MIN_STRENGTH + (1 - MIN_STRENGTH) * k), wavelength, syncs, why: 'ok' };
}

/**
 * The levels (0-based, `count` of them) whose current half-arc carries a ripple, as the stage really shows them:
 * `syncsOf(level)` = syncs on that arc (a clipped last arc carries fewer), `pxOf(level)` = its length in pixels once
 * it is the focus. `pxOf` is only asked for levels that could have a ripple at all (at least MIN_SYNCS on the arc, and
 * a wavelength of MIN_WAVELENGTH possible on an arc no longer than `maxPx`), so a coarse level is never measured.
 */
export function rippleDepths(count, syncsOf, pxOf, maxPx = Infinity) {
  const out = [];
  for (let l = 0; l < count; l++) {
    const syncs = syncsOf(l);
    if (!(syncs >= MIN_SYNCS) || syncs * MIN_WAVELENGTH > maxPx) continue;
    if (rippleFit(syncs, pxOf(l)).visible) out.push(l);
  }
  return out;
}

/**
 * The depths (0-based levels) the hint under the dial lists: those whose half-arc of the displayed time carries a
 * ripple on a W x H stage. `eng` = the engine of scene.js (prefix, fractionOf, arcPixels), `cur` = readHalves().
 * A clipped last half-arc carries fewer syncs and is fitted by itself. No half-arc is longer than about twice the
 * larger side of the stage (its sweep is at most 4.4 rad, its width fits the stage), which bounds the levels worth
 * measuring: α and β carry hundreds of syncs and are never built.
 */
export function hintDepths(eng, g, cur, W, H, pad, count = 14) {
  return rippleDepths(
    count,
    (l) => syncsOnArc(eng.prefix(l), eng.fractionOf(l, cur[l].idx), g),
    (l) => eng.arcPixels(l, cur[l].idx, W, H, pad),
    2.2 * Math.max(W, H),
  );
}

/** Amplitude (px) of the ripple for a wavelength: 6 % of it, from AMP_MIN on the tightest wave up to AMP_MAX on a wide one. */
export const rippleAmp = (wavelength) => Math.min(AMP_MAX, Math.max(AMP_MIN, wavelength * 0.06));

/** How many quarters of a sync have passed at `phase` (0..3): the quarter the displayed time is in. */
export const quarterOf = (phase) => Math.min(3, Math.max(0, Math.floor(phase * 4)));

/** The Unix time the dial / pin travels to for `phase` of a sync [start, end]: time-linear, kept just inside it. */
export const travelTime = (start, end, phase, margin = 0.001) => Math.min(end - margin, Math.max(start + margin, start + clamp01(phase) * (end - start)));

/**
 * The ripple as a polyline riding the projected focus arc `sa` ({x, y, r, a0, sweep}, screen pixels).
 * Point i sits at progress fraction * i / n; the displacement follows the sync phase at that point.
 * @returns {{xs:Float64Array, ys:Float64Array, n:number}}
 */
export function ripplePoints(sa, spec, g, { amp = 4, step = 2 } = {}) {
  const f = spec.fraction;
  const arcPx = sa.r * Math.abs(sa.sweep) * f;
  const n = Math.max(12, Math.min(1600, Math.ceil(arcPx / step)));
  const xs = new Float64Array(n + 1);
  const ys = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const p = (f * i) / n;
    const a = sa.a0 + sa.sweep * p;
    const coord = syncCoord(spec.pos0 + p * spec.span, g);
    const d = amp * Math.sin(TAU * (coord - Math.floor(coord)));
    xs[i] = sa.x + (sa.r + d) * Math.cos(a);
    ys[i] = sa.y + (sa.r + d) * Math.sin(a);
  }
  return { xs, ys, n };
}

/**
 * Index of the polyline point where the bright (travelled) part of the ripple ends: `travelled` is the progress of
 * the displayed time on the arc (0..fraction), n the number of segments.
 */
export const rippleSplit = (n, travelled, fraction) => Math.max(0, Math.min(n, Math.round((n * travelled) / fraction)));

/**
 * The pin of the displayed time: its foot on the ripple at progress `pNow` and its head, which floats `lift` px
 * beyond the ripple (and never closer to the centre than the carrier plus `lift`), on the same normal.
 * `sa` = the projected focus arc, `spec` = arcSpec of the scene.
 */
export function pinGeometry(sa, spec, g, pNow, amp, lift = 17) {
  const p = Math.min(spec.fraction, Math.max(0, pNow));
  const foot = ripplePointAt(sa, spec, g, p, amp);
  const R = sa.r + lift + Math.max(0, foot.d);
  return { foot: { x: foot.x, y: foot.y }, head: { x: sa.x + R * foot.nx, y: sa.y + R * foot.ny }, nx: foot.nx, ny: foot.ny, d: foot.d };
}

/**
 * Phase (0..1) inside sync number `sync` of the point at progress t of the arc `spec`: what dragging the pin along
 * the arc means. A point beyond the sync's ends is held at its start or end, so a drag never leaves the sync.
 */
export const pinPhase = (spec, g, t, sync) => clamp01(syncCoord(spec.pos0 + t * spec.span, g) - sync);

/** A point of the ripple at progress p (0..fraction): the carrier point pushed out by the ripple. */
export function ripplePointAt(sa, spec, g, p, amp, out = {}) {
  const a = sa.a0 + sa.sweep * p;
  const coord = syncCoord(spec.pos0 + p * spec.span, g);
  const d = amp * Math.sin(TAU * (coord - Math.floor(coord)));
  out.x = sa.x + (sa.r + d) * Math.cos(a);
  out.y = sa.y + (sa.r + d) * Math.sin(a);
  out.nx = Math.cos(a);
  out.ny = Math.sin(a);
  out.d = d; // the displacement (px, outward positive)
  return out;
}

/**
 * Quarter marks of the syncs that overlap the arc: {sync, k (1..4), name, coord, p} with p = progress on
 * the half-arc, only for marks inside [0, fraction]. `only` limits it to one sync (the one with the marker).
 */
export function quarterMarks(spec, g, only = null) {
  const c0 = syncCoord(spec.pos0, g);
  const c1 = syncCoord(spec.pos0 + spec.fraction * spec.span, g);
  const out = [];
  for (let s = Math.floor(c0); s <= Math.floor(c1) + 1; s++) {
    if (only !== null && s !== only) continue;
    for (let k = 1; k <= 4; k++) {
      const coord = s + k / 4;
      if (coord < c0 || coord > c1) continue;
      out.push({ sync: s, k, name: QUARTERS[k - 1], coord, p: (positionOfCoord(coord, g) - spec.pos0) / spec.span });
    }
  }
  return out;
}

/** Shape of the dial's mini wave in a w x h box: the sine of one sync, with the quarter points. */
export function dialShape(w, h, { padX = 7, padY = 5, n = 64 } = {}) {
  const A = h / 2 - padY;
  const cy = h / 2;
  const W = w - 2 * padX;
  const at = (phase) => ({ x: padX + W * phase, y: cy - A * Math.sin(TAU * phase) });
  let d = '';
  for (let i = 0; i <= n; i++) {
    const p = at(i / n);
    d += `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  return { w, h, A, cy, W, padX, at, path: d, quarters: QUARTERS.map((name, i) => ({ k: i + 1, name, ...at((i + 1) / 4) })) };
}

/**
 * What the dial shows for a model reading `sun` ({phase, quarter, threshold:{name}}): the dot, the length of the bright
 * stretch of the wave, the quarter points (passed = filled, coming = ringed and larger) and the slider value.
 */
export function dialState(shape, sun) {
  const p = shape.at(sun.phase);
  return {
    x: p.x,
    y: p.y,
    dash: sun.phase.toFixed(4),
    valuenow: Math.min(255, Math.floor(sun.phase * 256)),
    quarters: QUARTERS.map((name, i) => ({ k: i + 1, name, past: i + 1 <= sun.quarter, next: i === sun.quarter, r: i === sun.quarter ? 3.4 : 2.2 })),
  };
}
