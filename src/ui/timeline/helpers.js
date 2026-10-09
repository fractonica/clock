/**
 * Timeline helpers: pure functions (no DOM, no canvas, no model) so they can be unit tested.
 *
 *  - window maths      clampWindow, zoomAtFraction, panWindow, interpolateWindow, fitWindow, presetSpan
 *  - layout            computeLayout
 *  - Gregorian axis    pickStep, generateTicks, generateContext, civilSpans, offsetSegments
 *  - small helpers     formatCycleLength, cycleName, eclipseLabelStride, nearestWithin, roundMs, validLevel, stepLevel, hitTest
 *  - read-out text     percentThrough, rowReadout, depthWords, depthHeadVariants, fitTitle, turnoverTip, selectedDepthSentence
 *
 * All times are Unix seconds. Zone awareness comes from an injected `api` with the shape of
 * `ctx.fmt`: `{ zone(): string, parts(t), toUnix(fields) }`. Local days are real local days, so a
 * DST day has 23 or 25 hours; nothing here assumes 86 400 s except where a comment says so.
 */
import { MONTHS_SHORT, MONTHS_LONG, WEEKDAYS_SHORT } from '../../core/format.js';

export const DAY = 86400;
export const YEAR = 31557600; // Julian year, the unit core/format.js uses
export const MONTH = 2629800; // YEAR / 12
export const MIN_SPAN = 2; // narrowest window: ~2 s across the plot

// ---------------------------------------------------------------------------------------------
// window maths. A window is { c, span }: centre time and width in seconds.
// ---------------------------------------------------------------------------------------------

/**
 * Pan / zoom limits: the catalogue plus a margin on both sides.
 * @returns {{tMin:number,tMax:number,d0:number,d1:number,minSpan:number,maxSpan:number}}
 */
export function limitsFor(tMin, tMax, marginFrac = 0.03) {
  const m = (tMax - tMin) * marginFrac;
  return { tMin, tMax, d0: tMin - m, d1: tMax + m, minSpan: MIN_SPAN, maxSpan: tMax - tMin + 2 * m };
}

/** Clamp span to [minSpan, maxSpan] and keep the window inside [d0, d1]. */
export function clampWindow(win, lim) {
  const span = Math.min(lim.maxSpan, Math.max(lim.minSpan, win.span));
  const c = Math.min(lim.d1 - span / 2, Math.max(lim.d0 + span / 2, win.c));
  return { c, span };
}

/** Zoom by `factor` (>1 zooms out) keeping the time at screen fraction `frac` (0..1) fixed. */
export function zoomAtFraction(win, factor, frac, lim) {
  const p = win.c - win.span / 2 + frac * win.span;
  const span = Math.min(lim.maxSpan, Math.max(lim.minSpan, win.span * factor));
  return clampWindow({ c: p - frac * span + span / 2, span }, lim);
}

/** Shift the window by dt seconds. */
export function panWindow(win, dt, lim) {
  return clampWindow({ c: win.c + dt, span: win.span }, lim);
}

/** Window that shows [start, end] with `margin` (fraction of the length) on each side. */
export function fitWindow(start, end, lim, margin = 0.08) {
  const len = Math.max(end - start, 1e-3);
  return clampWindow({ c: (start + end) / 2, span: len * (1 + 2 * margin) }, lim);
}

/** Window centred on t that keeps the current span. */
export function centreOn(win, t, lim) {
  return clampWindow({ c: t, span: win.span }, lim);
}

/**
 * Time <-> x mapping of a window drawn into [x0, x0 + width]. Works from offsets to the window
 * centre (`t - c` is exact for nearby doubles) so ms-scale views at 1.8e9 s lose nothing.
 */
export function makeScale(win, x0, width) {
  const k = width / win.span;
  const xc = x0 + width / 2;
  return {
    k,
    t0: win.c - win.span / 2,
    t1: win.c + win.span / 2,
    toX: (t) => xc + (t - win.c) * k,
    toT: (x) => win.c + (x - xc) / k,
    /** fraction 0..1 of x across the plot, clamped */
    frac: (x) => Math.min(1, Math.max(0, (x - x0) / width)),
  };
}

export const PRESETS = [
  { id: 'day', label: 'Day', span: DAY },
  { id: 'week', label: 'Week', span: 7 * DAY },
  { id: 'month', label: 'Month', span: 30.4375 * DAY },
  { id: 'year', label: 'Year', span: YEAR },
  { id: 'decade', label: 'Decade', span: 10 * YEAR },
  { id: 'century', label: 'Century', span: 100 * YEAR },
  { id: 'all', label: 'All', span: Infinity },
];

/** Span (seconds) of a preset, "All" being the whole limit. */
export function presetSpan(id, lim) {
  const p = PRESETS.find((x) => x.id === id);
  return !p || !Number.isFinite(p.span) ? lim.maxSpan : Math.min(p.span, lim.maxSpan);
}

/** Preset id whose span is within ~12 % of `span`, else null. */
export function activePreset(span, lim) {
  for (const p of PRESETS) {
    const s = presetSpan(p.id, lim);
    if (Math.abs(Math.log(span / s)) < 0.12) return p.id;
  }
  return null;
}

export const easeOutCubic = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);

/**
 * Window part-way (u in 0..1) from `a` to `b`. The span moves geometrically and the centre follows
 * the "zoom about a fixed point" rule, so the point that stays still on screen is the one that is
 * shared by both windows: a zoom feels like a zoom, not like a pan plus a resize.
 */
export function interpolateWindow(a, b, u) {
  const la = Math.log(a.span);
  const lb = Math.log(b.span);
  const span = Math.exp(la + (lb - la) * u);
  if (Math.abs(lb - la) < 0.02) return { c: a.c + (b.c - a.c) * u, span };
  const p = (b.c * a.span - a.c * b.span) / (a.span - b.span); // screen-stationary time
  return { c: p + (a.c - p) * (span / a.span), span };
}

// ---------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------

/** Fixed sizes (CSS px) of the canvas rows; `compact` is the phone layout. */
export function metrics(width) {
  const compact = width < 560;
  const pad = 6;
  const overview = { y: pad, h: compact ? 34 : 38 };
  const axis = { y: overview.y + overview.h + 8, ctxH: 16, tickH: 20, markH: 16 };
  axis.h = axis.ctxH + axis.tickH + axis.markH;
  const eclipseH = compact ? 36 : 42;
  return {
    compact,
    gutter: compact ? 56 : 92,
    pad,
    overview,
    axis,
    eclipseH,
    fixed: axis.y + axis.h + eclipseH + pad,
    minLane: compact ? 24 : 28,
    maxLane: compact ? 40 : 44,
  };
}

/**
 * Height the canvas should have: every lane as tall as it can be while the whole card still fits
 * in the viewport (`chrome` is the height of everything around the canvas), within the lane limits.
 */
export function stageHeight({ lanes, width, viewportH, chrome = 310 }) {
  const m = metrics(width);
  const n = Math.max(1, lanes);
  const lane = Math.max(m.minLane, Math.min(m.maxLane, Math.floor((viewportH - chrome - m.fixed) / n)));
  return m.fixed + lane * n;
}

/**
 * Vertical / horizontal layout of the canvas (CSS px).
 * @param {{width:number,height:number,lanes:number}} o
 */
export function computeLayout({ width, height, lanes }) {
  const m = metrics(width);
  const n = Math.max(1, lanes);
  const laneH = Math.max(m.minLane, Math.min(m.maxLane, Math.floor((height - m.fixed) / n)));
  const lanesY = m.axis.y + m.axis.h;
  const eclipse = { y: lanesY + laneH * lanes, h: m.eclipseH };
  return {
    compact: m.compact,
    width,
    height,
    gutter: m.gutter,
    px0: m.gutter,
    px1: Math.max(m.gutter + 40, width - 8),
    overview: m.overview,
    axis: m.axis,
    lanesY,
    laneH,
    lanes,
    eclipse,
    minHeight: m.fixed + m.minLane * n,
    bottom: eclipse.y + eclipse.h,
  };
}

/** Which part of the canvas is at (x, y): overview | axis | lane (with index) | eclipse | none. */
export function regionAt(L, x, y) {
  const inGutter = x < L.px0;
  if (y >= L.overview.y && y < L.overview.y + L.overview.h) return { kind: 'overview', gutter: inGutter };
  if (y >= L.axis.y && y < L.axis.y + L.axis.h) return { kind: 'axis', gutter: inGutter };
  if (y >= L.lanesY && y < L.lanesY + L.laneH * L.lanes) {
    return { kind: 'lane', lane: Math.floor((y - L.lanesY) / L.laneH), gutter: inGutter };
  }
  if (y >= L.eclipse.y && y < L.eclipse.y + L.eclipse.h) return { kind: 'eclipse', gutter: inGutter };
  return { kind: 'none', gutter: inGutter };
}

// ---------------------------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------------------------

const sig3 = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));

/** Compact mean cycle length with ~3 significant digits: "72.1 y", "16.2 d", "5.05 h", "311 ms". */
export function formatCycleLength(s) {
  if (s >= YEAR) return `${sig3(s / YEAR)} y`;
  if (s >= DAY) return `${sig3(s / DAY)} d`;
  if (s >= 3600) return `${sig3(s / 3600)} h`;
  if (s >= 60) return `${sig3(s / 60)} min`;
  if (s >= 1) return `${sig3(s)} s`;
  return `${sig3(s * 1000)} ms`;
}

/** "ε 5 · 3/5" – letter, depth, 1-based local index over siblings. */
export function cycleName(info, local, siblings) {
  return `${info.letter} ${info.depth} · ${local + 1}/${siblings}`;
}

/**
 * Whole percent through a cycle for a read-out ("81" for 81.46 %). Floored, never rounded: a running cycle must
 * not read 100 % before it has ended, and it is the rule of the rings text (which floors to a tenth), so the same
 * instant never reads differently here. The epsilon keeps exact values such as 0.29 from flooring one low.
 * @param {number} fraction 0..1
 */
export function percentThrough(fraction) {
  if (!(fraction > 0)) return 0;
  const tenths = Math.min(999, Math.floor(fraction * 1000 + 1e-7)); // 99.9 at most, as in the rings
  return Math.floor(tenths / 10);
}

/** The two figures of a hover read-out row for a `model.levelAt` reading: "3/5" and "81%". */
export function rowReadout(reading) {
  return { count: `${reading.local + 1}/${reading.siblings}`, percent: `${percentThrough(reading.progress)}%` };
}

/** User-facing words say "depth" (1-based), never "level" (the 0-based internal index). */
export const depthWords = (info) => `depth ${info.depth}`;

/** How a lane head names its depth, widest first: "depth 5", else the bare number when the gutter is narrow. */
export const depthHeadVariants = (info) => [depthWords(info), String(info.depth)];

/** Hint at the end of a lane head's tooltip. */
export const LANE_SELECT_HINT = 'Click to select this depth in every view.';

/** Title of the "Fit" button: what the selected depth's cycle is. */
export const fitTitle = (info) => `Zoom to the cycle of the selected depth (${info.letter}, ${depthWords(info)}) at the cursor (F)`;

/** Tooltip of the pointer / chip for the end of the selected depth's cycle (`right`: it lies beyond the right edge). */
export function turnoverTip(info, right) {
  return right
    ? `Next turnover of the selected depth, ${info.letter} (${depthWords(info)}). Click to bring it into view.`
    : `The end of the ${info.letter} cycle at the cursor lies to the left of the view. Click to bring it into view.`;
}

/** Screen-reader sentence about the selected depth's cycle at the cursor; `count` = cycles in its parent (alpha: in the catalogue). */
export function selectedDepthSentence(info, local, count, endText) {
  return `Selected ${depthWords(info)} (${info.letter}): cycle ${local + 1} of ${count}, ends ${endText}.`;
}

/** Every `stride`-th eclipse gets a label so labels are at least `minPx` apart (stride is 1, 2, 4, 8 …). */
export function eclipseLabelStride(pxPerEclipse, minPx = 62) {
  let stride = 1;
  while (pxPerEclipse * stride < minPx && stride < 64) stride *= 2;
  return stride;
}

/** Round an instant to the millisecond, the resolution of the model, before it is split into seconds and ms for a label. */
export const roundMs = (t) => Math.round(t * 1000) / 1000;

/** A stored 0-based level that can be shown (integer 0..13), else `fallback`: persisted settings may be corrupt. */
export function validLevel(v, fallback = 6) {
  return Number.isInteger(v) && v >= 0 && v <= 13 ? v : fallback;
}

/**
 * Level selected by Up (dir -1) / Down (+1), kept within the levels that have a lane (`levels` ascending);
 * a selection outside them moves to the nearest lane.
 */
export function stepLevel(selected, dir, levels) {
  if (!levels.length) return selected;
  return Math.min(levels[levels.length - 1], Math.max(levels[0], selected + dir));
}

/**
 * First region (a painted rectangle {x, y, w, h}) that satisfies `pred` and contains (x, y), enlarged by `slop`
 * pixels on every side (fingers are fatter than a 14 px flag), or null.
 */
export function hitTest(regions, x, y, pred, slop = 0) {
  return regions.find((r) => pred(r) && x >= r.x - slop && x <= r.x + r.w + slop && y >= r.y - slop && y <= r.y + r.h + slop) ?? null;
}

/** Index of the element of sorted `arr` nearest to `t` if it is within `tol`, else -1. */
export function nearestWithin(arr, t, tol) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < t) lo = m + 1;
    else hi = m;
  }
  let best = -1;
  let bd = tol;
  for (const i of [lo - 1, lo]) {
    if (i >= 0 && i < arr.length) {
      const d = Math.abs(arr[i] - t);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
  }
  return best;
}

/** Binary search: index of the last element with arr[i].start <= t, or -1. Elements need `.start`. */
export function lastStartAtOrBefore(arr, t) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m].start <= t) {
      ans = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return ans;
}

const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(n).padStart(3, '0');
const mod = (a, b) => ((a % b) + b) % b;

// ---------------------------------------------------------------------------------------------
// Gregorian axis: step selection
// ---------------------------------------------------------------------------------------------

const UNIT_SECONDS = { ms: 0.001, s: 1, min: 60, h: 3600, day: DAY, week: 7 * DAY, month: MONTH, year: YEAR };
// typical label length (characters) per unit; drives how far apart ticks must be
const UNIT_CHARS = { ms: 7, s: 8, min: 5, h: 5, day: 5, week: 5, month: 3, year: 4 };
const STEP_LIST = [
  ['ms', [1, 2, 5, 10, 20, 50, 100, 200, 500]],
  ['s', [1, 2, 5, 10, 15, 30]],
  ['min', [1, 2, 5, 10, 15, 30]],
  ['h', [1, 2, 3, 6, 12]],
  ['day', [1]],
  ['week', [1]],
  ['month', [1, 3, 6]],
  ['year', [1, 2, 5, 10, 20, 50, 100, 200, 500]],
];

/** All axis steps, finest first: {id, u, n, nominal (s), chars}. */
export const STEPS = STEP_LIST.flatMap(([u, ns]) =>
  ns.map((n) => ({ id: `${u}${n}`, u, n, nominal: UNIT_SECONDS[u] * n, chars: UNIT_CHARS[u] })),
);
const STEP_BY_ID = new Map(STEPS.map((s) => [s.id, s]));
export const stepById = (id) => STEP_BY_ID.get(id) ?? null;

// finer, unlabelled step drawn as small ticks between the labelled ones
const MINOR = {
  ms2: 'ms1', ms5: 'ms1', ms10: 'ms2', ms20: 'ms5', ms50: 'ms10', ms100: 'ms20', ms200: 'ms50', ms500: 'ms100',
  s1: 'ms100', s2: 's1', s5: 's1', s10: 's2', s15: 's5', s30: 's10',
  min1: 's10', min2: 'min1', min5: 'min1', min10: 'min2', min15: 'min5', min30: 'min5',
  h1: 'min15', h2: 'h1', h3: 'h1', h6: 'h1', h12: 'h3',
  day1: 'h6', week1: 'day1', month1: 'day1', month3: 'month1', month6: 'month1',
  year1: 'month1', year2: 'year1', year5: 'year1', year10: 'year1', year20: 'year5', year50: 'year10',
  year100: 'year10', year200: 'year50', year500: 'year100',
};
/** Finer step used for unlabelled minor ticks, or null. */
export function minorStepOf(step) {
  return MINOR[step.id] ? STEP_BY_ID.get(MINOR[step.id]) : null;
}

/**
 * Coarsest-fitting step: the finest one whose labels still have room.
 * @param {number} pxPerSec  horizontal scale
 * @param {number} charW     width of one label character in px
 * @param {number} gap       free space between neighbouring labels in px
 */
export function pickStep(pxPerSec, charW = 6.6, gap = 18) {
  for (const s of STEPS) {
    if (s.nominal * pxPerSec >= s.chars * charW + gap) return s;
  }
  return STEPS[STEPS.length - 1];
}

/** Unit of the "context" row (the bigger unit the ticks live in) for a step, or null. */
export function contextUnitOf(step) {
  switch (step.u) {
    case 'ms':
    case 's':
      return 'minute';
    case 'min':
    case 'h':
      return 'day';
    case 'day':
    case 'week':
      return 'month';
    case 'month':
      return 'year';
    case 'year':
      return step.n <= 5 ? 'decade' : step.n <= 20 ? 'century' : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Gregorian axis: zone-aware generation
// ---------------------------------------------------------------------------------------------

const civilMemo = new Map();
/** Local civil date/time -> Unix seconds, memoised per zone (DST-aware through api.toUnix). */
export function civilToUnix(api, year, month, day, hour = 0) {
  const key = `${api.zone()}|${year}|${month}|${day}|${hour}`;
  let v = civilMemo.get(key);
  if (v === undefined) {
    v = api.toUnix({ year, month, day, hour });
    if (civilMemo.size > 30000) civilMemo.clear();
    civilMemo.set(key, v);
  }
  return v;
}

function addDays(y, m, d, n) {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}
const weekdayOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
/** Local calendar fields of a "local milliseconds since local epoch" value. */
function fieldsOfLocalMs(lms) {
  const dt = new Date(Math.floor(lms / 86400000) * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
}

/**
 * Piecewise-constant UTC offsets over [from, to]: [{from, to, offset}], so that sub-day ticks can
 * be aligned to local wall-clock multiples even across a DST change (the transition is located to
 * one second by bisection).
 */
export function offsetSegments(api, from, to) {
  const segs = [];
  let a = from;
  let oa = api.parts(a).offset;
  let b = from;
  const SAMPLE = DAY; // transitions are never closer together than a day
  while (b < to) {
    const nb = Math.min(to, b + SAMPLE);
    const ob = api.parts(nb).offset;
    if (ob !== oa) {
      let lo = Math.floor(b);
      let hi = Math.ceil(nb);
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (api.parts(mid).offset === oa) lo = mid;
        else hi = mid;
      }
      segs.push({ from: a, to: hi, offset: oa });
      a = hi;
      oa = ob;
    }
    b = nb;
  }
  segs.push({ from: a, to: Math.max(to, a), offset: oa });
  return segs;
}

/**
 * Instants in [from, to] where the local wall clock is a multiple of `stepMs` milliseconds.
 * On a DST fall-back the repeated hour yields its ticks twice; on spring-forward the skipped
 * ticks are simply absent.
 * @returns {{tms:number, lms:number}[]} tms = Unix ms, lms = local ms since the local epoch
 */
export function alignedTicks(stepMs, from, to, api) {
  const out = [];
  const fromMs = Math.floor(from * 1000);
  const toMs = Math.ceil(to * 1000);
  for (const seg of offsetSegments(api, from, to)) {
    const offMs = seg.offset * 1000;
    const lo = Math.max(Math.round(seg.from * 1000), fromMs);
    const hi = Math.min(Math.round(seg.to * 1000), toMs);
    for (let k = Math.ceil((lo + offMs) / stepMs); ; k++) {
      const tms = k * stepMs - offMs;
      if (tms >= hi) break;
      if (tms >= lo) out.push({ tms, lms: k * stepMs });
    }
  }
  return out;
}

const monthLabels = (m) => [MONTHS_LONG[m - 1], MONTHS_SHORT[m - 1], MONTHS_SHORT[m - 1][0]];

/**
 * Ticks of one step in [from, to] (inclusive of one unit of padding is the caller's job).
 * @returns {{t:number, labels:string[], major:boolean}[]} labels run from longest to shortest;
 *   `major` marks ticks that are also a boundary of the next larger unit.
 */
export function generateTicks(step, from, to, api) {
  const out = [];
  const u = step.u;
  if (u === 'ms' || u === 's' || u === 'min' || u === 'h') {
    const stepMs = Math.round(step.nominal * 1000);
    for (const { tms, lms } of alignedTicks(stepMs, from, to, api)) {
      const dayMs = mod(lms, 86400000);
      const hh = Math.floor(dayMs / 3600000);
      const mi = Math.floor(dayMs / 60000) % 60;
      const ss = Math.floor(dayMs / 1000) % 60;
      const ms = dayMs % 1000;
      let labels;
      let major;
      if (u === 'ms') {
        labels = [`:${pad2(ss)}.${pad3(ms)}`];
        major = ms === 0;
      } else if (u === 's') {
        labels = [`${pad2(hh)}:${pad2(mi)}:${pad2(ss)}`, `:${pad2(ss)}`];
        major = ss === 0;
      } else if (u === 'min') {
        labels = [`${pad2(hh)}:${pad2(mi)}`];
        major = mi === 0;
      } else {
        major = hh === 0;
        if (major) {
          const f = fieldsOfLocalMs(lms);
          labels = [`${WEEKDAYS_SHORT[f.wd]} ${f.d}`, `${f.d}`];
        } else labels = [`${pad2(hh)}:00`, pad2(hh)];
      }
      out.push({ t: tms / 1000, labels, major });
    }
    return out;
  }

  const p = api.parts(from);
  const pushIf = (t, labels, major) => {
    if (!(t >= from - 1e-6 && t <= to + 1e-6)) return;
    // a skipped local day (Pacific/Apia 2011-12-30) resolves to the next midnight: keep the day that really starts there
    if (out.length && out[out.length - 1].t === t) out.pop();
    out.push({ t, labels, major });
  };
  if (u === 'day' || u === 'week') {
    let [y, m, d] = [p.year, p.month, p.day];
    if (u === 'week') [y, m, d] = addDays(y, m, d, -mod(weekdayOf(y, m, d) + 6, 7)); // back to Monday
    const inc = u === 'week' ? 7 : 1;
    [y, m, d] = addDays(y, m, d, -inc);
    for (let guard = 0; guard < 2000; guard++) {
      const t = civilToUnix(api, y, m, d);
      if (t > to + DAY) break;
      const wd = weekdayOf(y, m, d);
      pushIf(
        t,
        u === 'day' ? [`${WEEKDAYS_SHORT[wd]} ${d}`, `${d}`] : [`${d} ${MONTHS_SHORT[m - 1]}`, `${d}`],
        u === 'day' ? d === 1 : d <= 7,
      );
      [y, m, d] = addDays(y, m, d, inc);
    }
    return out;
  }
  if (u === 'month') {
    let y = p.year;
    let m = Math.floor((p.month - 1) / step.n) * step.n + 1;
    m -= step.n;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    for (let guard = 0; guard < 4000; guard++) {
      const t = civilToUnix(api, y, m, 1);
      if (t > to + 40 * DAY) break;
      pushIf(t, step.n === 1 ? monthLabels(m) : [MONTHS_LONG[m - 1], MONTHS_SHORT[m - 1]], m === 1);
      m += step.n;
      while (m > 12) {
        m -= 12;
        y += 1;
      }
    }
    return out;
  }
  // year
  let y = Math.floor(p.year / step.n) * step.n - step.n;
  const decade = step.n * 10;
  for (let guard = 0; guard < 4000; guard++) {
    const t = civilToUnix(api, y, 1, 1);
    if (t > to + 366 * DAY * step.n) break;
    pushIf(t, [String(y)], y % decade === 0);
    y += step.n;
  }
  return out;
}

/**
 * Calendar spans of a unit overlapping [from, to]: the background shading / context row.
 * unit: 'minute' | 'day' | 'month' | 'year' | 'decade' | 'century'
 * @returns {{t0:number,t1:number,labels:string[],weekday:number,y:number,m:number,d:number}[]}
 */
export function civilSpans(unit, from, to, api) {
  const out = [];
  if (unit === 'minute') {
    for (const { tms, lms } of alignedTicks(60000, from - 60, to + 60, api)) {
      const f = fieldsOfLocalMs(lms);
      const dayMs = mod(lms, 86400000);
      const hhmm = `${pad2(Math.floor(dayMs / 3600000))}:${pad2(Math.floor(dayMs / 60000) % 60)}`;
      const date = `${f.d} ${MONTHS_SHORT[f.m - 1]} ${f.y}`;
      out.push({
        t0: tms / 1000,
        t1: tms / 1000 + 60,
        labels: [`${WEEKDAYS_SHORT[f.wd]} ${date} · ${hhmm}`, `${date} · ${hhmm}`, hhmm],
        weekday: f.wd,
        y: f.y,
        m: f.m,
        d: f.d,
        ord: Math.floor(tms / 60000),
      });
    }
    return out;
  }
  const p = api.parts(from);
  let y = p.year;
  let m = p.month;
  let d = p.day;
  if (unit === 'month') d = 1;
  else if (unit === 'year') [m, d] = [1, 1];
  else if (unit === 'decade') [y, m, d] = [Math.floor(y / 10) * 10, 1, 1];
  else if (unit === 'century') [y, m, d] = [Math.floor(y / 100) * 100, 1, 1];
  for (let guard = 0; guard < 4000; guard++) {
    let ny = y;
    let nm = m;
    let nd = d;
    if (unit === 'day') [ny, nm, nd] = addDays(y, m, d, 1);
    else if (unit === 'month') [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
    else if (unit === 'year') ny = y + 1;
    else if (unit === 'decade') ny = y + 10;
    else ny = y + 100;
    const wd = weekdayOf(y, m, d);
    let labels;
    if (unit === 'day') labels = [`${WEEKDAYS_SHORT[wd]} ${d} ${MONTHS_SHORT[m - 1]} ${y}`, `${d} ${MONTHS_SHORT[m - 1]} ${y}`, `${WEEKDAYS_SHORT[wd]} ${d}`, `${d}`];
    else if (unit === 'month') labels = [`${MONTHS_LONG[m - 1]} ${y}`, `${MONTHS_SHORT[m - 1]} ${y}`, MONTHS_SHORT[m - 1]];
    else if (unit === 'year') labels = [String(y)];
    else labels = [`${y}s`];
    const t0 = civilToUnix(api, y, m, d);
    const t1 = civilToUnix(api, ny, nm, nd);
    if (unit === 'day') {
      // a DST day is not 24 h long: say so when there is room ("Sun 25 Oct 2026 · 25 h")
      const hours = (t1 - t0) / 3600;
      if (Math.abs(hours - 24) > 0.01) labels = [`${labels[0]} · ${+hours.toFixed(2)} h`, ...labels];
    }
    // stable ordinal: consecutive spans of a unit differ by one, so shading can alternate without flicker
    const ord = unit === 'day' ? Math.round(Date.UTC(y, m - 1, d) / 86400000) : unit === 'month' ? y * 12 + m : unit === 'year' ? y : unit === 'decade' ? y / 10 : y / 100;
    if (t1 > t0) out.push({ t0, t1, labels, weekday: wd, y, m, d, ord }); // a skipped local day has no length
    if (t1 >= to) break;
    [y, m, d] = [ny, nm, nd];
  }
  return out;
}

/** Context spans (the row above the ticks) for a step. */
export function generateContext(step, from, to, api) {
  const unit = contextUnitOf(step);
  return unit ? civilSpans(unit, from, to, api) : [];
}
