/**
 * Calendar mapping maths (pure: no DOM, no globals). Everything the converter,
 * the month calendar and the jump box need to go from a Unix instant to its
 * Fractonica description and back. Clock readings always come from the model
 * (src/core/model.js); this file only converts, formats and validates.
 *
 * All times are Unix seconds. A "path" is the 1-based hierarchical cycle address
 * [Alpha, Beta, Gamma, ...] used by model.pathToCycle(). A "level" is zero-based,
 * depth = level + 1.
 */
import { zonedParts, zonedToUnix, daysFromCivil, daysInMonth, offsetLabel } from '../../core/format.js';

export const LETTERS = 'αβγδεζηθικλμνξ';
export const LEVEL_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MAX_DEPTH = 14;
/** Points of a cycle the converter can address (phase = fraction of the cycle, position-linear). */
export const POINTS = [
  { id: 'begin', label: 'Begin', phase: 0 },
  { id: 'peak', label: 'Peak', phase: 0.25 },
  { id: 'node', label: 'Node', phase: 0.5 },
  { id: 'valley', label: 'Valley', phase: 0.75 },
  { id: 'end', label: 'End', phase: 1 },
  { id: 'phase', label: 'Same phase as now', phase: null },
];

const pad2 = (n) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
/** Round to whole milliseconds (the model does the same before every query). */
export const r3 = (t) => Math.round(t * 1000) / 1000;
export const an = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * Percent through a cycle as text with `digits` decimals, FLOORED like the rings do, so that a running
 * cycle never reads 100.0 % before it has ended (the largest value is 99.9 for one decimal).
 */
export function pctFloor(phase, digits = 1) {
  const k = 10 ** digits;
  const v = Math.min(100 * k - 1, Math.max(0, Math.floor(phase * 100 * k + 1e-7)));
  return (v / k).toFixed(digits);
}

/** Echo user text inside a label: at most `max` characters, cut with an ellipsis. */
export function clip(text, max = 40) {
  const s = String(text);
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

// ---------------------------------------------------------------------------------------------
// catalogue text
// ---------------------------------------------------------------------------------------------
/** "1613-05-19" – a Unix time as a UTC date (catalogue edges are quoted in UTC). */
export function utcDate(t) {
  const p = zonedParts(t, 'UTC');
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}
/** "1613-05-19 … 2857-06-13" */
export function catalogueRangeText(model) {
  return `${utcDate(model.tMin)} … ${utcDate(model.tMax)}`;
}
/** "1613-05-19 17:41:53" – a Unix time as a UTC date and time of day. */
export function utcStamp(t) {
  const p = zonedParts(t, 'UTC');
  return `${utcDate(t)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}
/**
 * Why `t` is outside the catalogue ("before ..." / "after ..."), or null when inside. The edge is
 * quoted as a date; within two days of it the time of day is added so that a date that is "outside"
 * never reads as the very day the catalogue starts or ends.
 */
export function rangeProblem(model, t) {
  if (model.inRange(t)) return null;
  const before = t < model.tMin;
  const edge = before ? model.tMin : model.tMax;
  const text = Math.abs(t - edge) < 2 * 86400 ? utcStamp(edge) : utcDate(edge);
  return before ? `before the catalogue starts (${text} UTC)` : `after the catalogue ends (${text} UTC)`;
}

// ---------------------------------------------------------------------------------------------
// landing on boundaries
// ---------------------------------------------------------------------------------------------
/**
 * A time that is guaranteed to show the cycle / state that BEGINS at the boundary `t`.
 * The model rounds queries to 1 ms, so a boundary like ...172.42811 would otherwise render
 * as the previous cycle. Rounds up to the next millisecond and, when `level` is given,
 * verifies against the model that the cycle containing the result is the one starting at t.
 * `want(c)` is an optional extra check for boundaries that are not cycle starts (a glyph state,
 * a threshold): the float time of such a boundary can differ by a few ulps from the exact
 * rational one, so the landing is moved on millisecond by millisecond until the check passes.
 */
export function landOn(model, t, level, want) {
  if (t === null || t === undefined || !Number.isFinite(t)) return t;
  let c = Math.ceil(t * 1000) / 1000;
  if (typeof want === 'function') {
    for (let i = 0; i < 3 && !want(c); i++) c = r3(c + 0.001);
    return c;
  }
  if (level === undefined || level === null) return c;
  for (let i = 0; i < 3; i++) {
    const l = model.levelAt(c, level);
    if (!l || Math.abs(l.start - t) < 5e-3 || l.start > t) return c;
    c = r3(c + 0.001);
  }
  return c;
}

/**
 * Time of the point at fraction `phase` (0..1, position-linear like levelAt().phase) of the
 * cycle `idx` (global, 0-based) at `level`. null when the point lies beyond the catalogue
 * (clipped last cycles). phase 0 equals model.cycleStartTime().
 */
export function pointOfCycle(model, level, idx, phase = 0) {
  const P = model.levelInfo(level).prefixNum;
  const E = model.catalogue;
  const ext = model.extent;
  const n = idx * 4 + phase * 4;
  if (!(n >= 0)) return null;
  const k = Math.floor(n / P);
  if (k > ext) return null;
  const rem = n - k * P;
  if (k === ext) return rem === 0 ? model.tMax : null;
  return E[k] + (rem / P) * (E[k + 1] - E[k]);
}

// ---------------------------------------------------------------------------------------------
// addresses
// ---------------------------------------------------------------------------------------------
/**
 * Notation. A bare "letter number" ("ε 5") is the DEPTH chip of the ladder, Up next, rings and timeline
 * lane heads, so in this module the same string never means an ordinal. The n-th cycle of a level inside
 * its parent is written with a hash: "ε#5" (the 5th ε inside its δ).
 */
export const cycleLabel = (level, n) => `${LETTERS[level]}#${n}`;
/** "α#6 β#4 γ#9" */
export function pathText(path, { sep = ' ' } = {}) {
  return path.map((n, i) => cycleLabel(i, n)).join(sep);
}
/** "α#6 › β#4 › γ#9"; `from` = level of the first entry when the path starts below alpha. */
export function chainText(path, from = 0) {
  return path.map((n, i) => cycleLabel(from + i, n)).join(' › ');
}
/** 1st, 2nd, 3rd, 4th ... */
export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10]}`;
}
/** Short 5-level address of an instant ("α#6 β#4 γ#9 δ#3 ε#5") or null out of range. */
export function addressText(model, t, depth = 5) {
  if (!model.inRange(t)) return null;
  const path = pathOfTime(model, t, depth);
  return path ? pathText(path) : null;
}

/**
 * Number of cycles that exist (inside the catalogue) directly under the cycle `parentPath`
 * (the 1-based maximum for the next path entry). [] = number of Alpha cycles.
 */
export function childCount(model, parentPath) {
  if (parentPath.length === 0) return Number(model.clock.count(0));
  const sib = model.levelInfo(parentPath.length).siblings;
  let n = 0;
  for (let i = 1; i <= sib; i++) {
    if (model.pathToCycle([...parentPath, i]) === null) break;
    n = i;
  }
  return n;
}

/**
 * Nominal number of cycles under the cycle `parentPath` (what every other module prints after the slash,
 * "2 / 5"), whether or not the catalogue ends before all of them. [] = number of Alpha cycles.
 */
export function nominalCount(model, parentPath) {
  return parentPath.length === 0 ? Number(model.clock.count(0)) : model.levelInfo(parentPath.length).siblings;
}

/** Clamp every entry of a path into the range that exists under its parents (clipped last cycles). */
export function normalizePath(model, path) {
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const max = childCount(model, out);
    if (max === 0) break;
    const v = Number.isFinite(path[i]) ? Math.trunc(path[i]) : 1;
    out.push(Math.min(Math.max(1, v), max));
  }
  return out;
}

/** The 1-based path of the cycles containing t, `depth` entries long; null out of range. */
export function pathOfTime(model, t, depth) {
  const path = [];
  for (let L = 0; L < depth; L++) {
    const l = model.levelAt(t, L);
    if (!l) return null;
    path.push(l.local + 1);
  }
  return path;
}

/** Facts of the cycle at a (valid) path: {level, idx, start, end, duration, clipped} or null. */
export function cycleOfPath(model, path) {
  const idx = model.pathToCycle(path);
  if (idx === null) return null;
  const level = path.length - 1;
  const c = model.cycleByIndex(level, idx);
  return c ? { level, idx: Number(idx), idxBig: idx, ...c } : null;
}

/** Time of a named point ('begin'|'peak'|'node'|'valley'|'end'|'phase') of the cycle at `path`. */
export function pointTime(model, path, pointId, phaseNow = 0) {
  const idx = model.pathToCycle(path);
  if (idx === null) return null;
  const pt = POINTS.find((p) => p.id === pointId) ?? POINTS[0];
  const phase = pt.phase === null ? phaseNow : pt.phase;
  return pointOfCycle(model, path.length - 1, Number(idx), phase);
}

// ---------------------------------------------------------------------------------------------
// Gregorian description of an instant
// ---------------------------------------------------------------------------------------------
export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Add n civil days to a y/m/d triple. */
export function addDays(y, m, d, n) {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/** Unix seconds of civil fields read as UTC (years 0..99 are not shifted to 1900..1999 as Date.UTC would). */
export function utcSeconds(year, month, day, hour = 0, minute = 0, second = 0) {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, 0);
  return d.getTime() / 1000;
}

/**
 * Civil fields of a zone -> the instants that show exactly those fields. [] = the local time does not
 * exist (a clock change skipped it), two entries = it happens twice (clocks went back).
 */
function localCandidates(f, zone) {
  const g = utcSeconds(f.year, f.month, f.day, f.hour ?? 0, f.minute ?? 0, f.second ?? 0);
  const offsets = new Set([zonedParts(g - 86400, zone).offset, zonedParts(g, zone).offset, zonedParts(g + 86400, zone).offset]);
  const out = [];
  for (const o of offsets) {
    const t = g - o;
    if (zonedParts(t, zone).offset === o) out.push(t);
  }
  return { g, times: out.sort((a, b) => a - b) };
}

/** Civil fields in `zone` -> Unix seconds (fold -> earlier instant, gap -> forward); see core/format.js. */
export function localToUnix(f, zone = 'UTC') {
  return zonedToUnix(f, zone);
}

/** 'gap' when the local time does not exist in `zone`, 'fold' when it happens twice, else null. */
export function localTimeIssue(f, zone = 'UTC') {
  const { times } = localCandidates(f, zone);
  return times.length === 0 ? 'gap' : times.length > 1 ? 'fold' : null;
}

/**
 * The sentence that explains a wall time the zone does not have exactly once, or '' when it is fine:
 * "02:30 does not exist there (the clocks skip it): moved ahead to 03:30" (gap) or
 * "01:30 happens twice there (the clocks go back): showing the first" (fold). `t` is the resolved instant,
 * `f` a formatter of the same zone, `where` how to name the zone ("there" or its name).
 */
export function wallTimeNote(fields, zone, t, f, where = 'there') {
  const issue = localTimeIssue(fields, zone);
  if (!issue) return '';
  const hm = `${pad2(fields.hour ?? 0)}:${pad2(fields.minute ?? 0)}`;
  if (issue === 'gap') return `${hm} does not exist ${where} (the clocks skip it): moved ahead to ${f.time(r3(t), { seconds: false })}`;
  return `${hm} happens twice ${where} (the clocks go back): showing the first`;
}

/**
 * First instant of the local day y-m-d in `zone`: the first instant whose local date is on or after it.
 * Robust against zones whose clock change happens at midnight (local 00:00 does not exist or happens
 * twice) and against dates a zone skipped altogether (Pacific/Apia 2011-12-30): the skipped date starts
 * where the next one does, so its length is 0.
 */
export function dayStart(zone, y, m, d) {
  const target = daysFromCivil(y, m, d);
  const dn = (t) => {
    const p = zonedParts(t, zone);
    return daysFromCivil(p.year, p.month, p.day);
  };
  let hi = localToUnix({ year: y, month: m, day: d }, zone);
  if (dn(hi) === target && dn(hi - 1) < target) return hi; // an ordinary midnight
  let guard = 0;
  while (dn(hi) < target && guard++ < 100) hi += 900;
  guard = 0;
  let lo = hi - 900;
  while (dn(lo) >= target && guard++ < 100) {
    hi = lo;
    lo -= 900;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (dn(mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Everything the Gregorian side of the converter shows for instant t in the zone bound
 * to `f` (a core/format.js formatter).
 */
export function gregorianInfo(f, t) {
  const r = r3(t);
  const p = f.parts(r);
  const doy = daysFromCivil(p.year, p.month, p.day) - daysFromCivil(p.year, 1, 1) + 1;
  const start = dayStart(f.zone(), p.year, p.month, p.day);
  const nx = addDays(p.year, p.month, p.day, 1);
  const end = dayStart(f.zone(), nx.year, nx.month, nx.day);
  return {
    t: r,
    parts: p,
    date: f.date(r),
    time: f.time(r, { seconds: true, ms: true }),
    unix: r.toFixed(3),
    iso: isoWithMs(f, r),
    weekday: p.weekday,
    weekdayName: WEEKDAYS_LONG[p.weekday],
    monthName: MONTHS_FULL[p.month - 1],
    dayOfYear: doy,
    daysInYear: isLeap(p.year) ? 366 : 365,
    offset: p.offset,
    offsetLabel: offsetLabel(p.offset),
    tag: f.tag(r),
    dayStart: start,
    dayEnd: end,
    dayLength: end - start,
  };
}

/** "+03:00", or "+00:53:28" when the zone had an offset with seconds (before standard time, ~ 1900). */
export function isoOffset(offsetSeconds) {
  const sign = offsetSeconds < 0 ? '-' : '+';
  const a = Math.round(Math.abs(offsetSeconds));
  const sec = a % 60;
  return `${sign}${pad2(Math.floor(a / 3600))}:${pad2(Math.floor((a % 3600) / 60))}${sec ? ':' + pad2(sec) : ''}`;
}

/** "2026-10-08T15:00:00.000+03:00" */
export function isoWithMs(f, t) {
  const r = r3(t);
  return `${f.date(r)}T${f.time(r, { seconds: true, ms: true })}${isoOffset(f.parts(r).offset)}`;
}

/**
 * "Feb 16 10:34" for a time near `ref`; with the year ("2027-03-28 16:36") when the cycle it belongs to
 * spans years, so that the two ends of a long cycle are never ambiguous.
 */
export function spanLabel(f, t, ref, startT, endT) {
  const long = endT - startT > 300 * 86400 || f.date(r3(startT)).slice(0, 4) !== f.date(r3(endT)).slice(0, 4);
  return long ? f.dateTime(r3(t), { seconds: false }) : f.label(r3(t), ref);
}

/** Query string (location-free) that deep-links to instant t: "?t=1791460800.000&view=calendar&zone=UTC". */
export function shareQuery(t, { view = 'calendar', zone = null } = {}) {
  const q = new URLSearchParams();
  q.set('t', r3(t).toFixed(3));
  if (view) q.set('view', view);
  if (zone) q.set('zone', zone);
  return '?' + q.toString();
}

// ---------------------------------------------------------------------------------------------
// position
// ---------------------------------------------------------------------------------------------
/** Exact decimal expansion of the library's rational position at t (digits after the point). */
export function exactPosition(model, t, digits = 15) {
  const R = model.F.rational;
  const p = model.clock.positionAt(R(String(r3(t))));
  const n = BigInt(p.numerator);
  const d = BigInt(p.denominator);
  const whole = n / d;
  const scale = 10n ** BigInt(digits);
  let frac = ((n % d) * scale * 2n + d) / (d * 2n); // round half up
  let w = whole;
  if (frac >= scale) {
    frac -= scale;
    w += 1n;
  }
  return `${w}.${frac.toString().padStart(digits, '0')}`;
}

/**
 * Position fields of an instant: ordinal k, fraction f (13 decimals), joined text, exact text.
 * null outside the catalogue.
 */
export function positionInfo(model, t) {
  const loc = model.locate(r3(t));
  if (!loc) return null;
  const fracText = loc.f.toFixed(13); // "0.9278502166352"
  let k = loc.k;
  let frac = fracText;
  if (frac.startsWith('1.')) {
    k += 1;
    frac = (0).toFixed(13);
  }
  return {
    k,
    f: loc.f,
    fraction: frac.slice(1), // ".9278502166352" (with the leading dot)
    pos: `${k}${frac.slice(1)}`,
    exact: exactPosition(model, t),
    extent: model.extent,
  };
}

/**
 * Time of a position given as ordinal + fraction text (string digits keep full precision).
 * Returns {t} or {error}.
 */
export function timeOfPositionParts(model, ordinal, fractionText) {
  const ot = String(ordinal ?? '').trim();
  const k = ot === '' ? NaN : Number(ot); // an empty ordinal is missing, not 0
  if (!Number.isInteger(k) || k < 0) return { error: 'The ordinal must be a whole number from 0 to ' + model.extent };
  let f = 0;
  const ft = String(fractionText ?? '').trim();
  if (ft !== '') {
    // ".9278" and "0.9278" are decimals; bare digits are the digits after the point
    const digits = /^0?\.(\d*)$/.exec(ft)?.[1] ?? (/^\d+$/.test(ft) ? ft : null);
    if (digits === null) return { error: 'The fraction must be a decimal like 0.9278' };
    f = digits === '' ? 0 : Number('0.' + digits);
    if (!(f >= 0 && f < 1)) return { error: 'The fraction must be at least 0 and below 1' };
  }
  if (k > model.extent || (k === model.extent && f > 0)) {
    return { error: `Position must be between 0 and ${model.extent} (the catalogue holds ${model.extent} Saros intervals)` };
  }
  if (k === model.extent) return { t: model.tMax };
  const E = model.catalogue;
  return { t: E[k] + f * (E[k + 1] - E[k]) };
}

/**
 * Parse a position written as one decimal ("22.927850216635") into a time.
 * Splits the text instead of converting to a float first so no digits are lost.
 */
export function timeOfPositionText(model, text) {
  const m = /^\s*(\d+)(?:\.(\d*))?\s*$/.exec(String(text).replace(',', '.'));
  if (!m) return { error: 'Write the position as a decimal number, e.g. 22.927850216635' };
  return timeOfPositionParts(model, Number(m[1]), m[2] ? '0.' + m[2] : '0');
}

/** Eclipses around t: the previous (E[k] <= t) and the next one, with distances in seconds. */
export function eclipseContext(model, t) {
  const E = model.catalogue;
  const ext = model.extent;
  let prev = null;
  let next = null;
  if (t < model.tMin) next = 0;
  else if (t > model.tMax) prev = ext;
  else {
    const loc = model.locate(t);
    prev = loc.k;
    next = loc.k + 1 <= ext ? loc.k + 1 : null;
    if (t === model.tMax) {
      prev = ext;
      next = null;
    }
  }
  const mk = (k) => (k === null ? null : { k, time: E[k], delta: t - E[k] });
  return { prev: mk(prev), next: mk(next) };
}

/** Index (0-based, into model.catalogue) of the eclipse whose greatest instant falls on [t0, t1), or -1. */
export function eclipseInWindow(model, t0, t1) {
  const E = model.catalogue;
  let lo = 0;
  let hi = E.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (E[mid] < t0) lo = mid + 1;
    else hi = mid;
  }
  return lo < E.length && E[lo] < t1 ? lo : -1;
}

// ---------------------------------------------------------------------------------------------
// glyph states
// ---------------------------------------------------------------------------------------------
/** What a glyph index means (SPEC §4.1) for `strokes` strokes: value, derivative, wording. */
export function stateMeaning(model, index, strokes = 2) {
  const g = model.F.CBT.fromIndex(index, { depth: strokes });
  const value = Number(g.value);
  const derivative = Number(g.derivative);
  const M = (3 ** strokes - 1) / 2;
  const words = derivative > 0 ? 'rising' : derivative < 0 ? 'falling' : value > 0 ? 'peak' : value < 0 ? 'valley' : 'zero';
  const arrow = derivative > 0 ? '↗' : derivative < 0 ? '↘' : value > 0 ? '▲' : '▼';
  const sign = value < 0 ? '−' : value > 0 ? '+' : '';
  return {
    index,
    value,
    derivative,
    dotted: derivative < 0,
    states: 4 * M,
    words,
    arrow,
    text: `value ${sign}${Math.abs(value)}, ${words}`,
  };
}

/**
 * Rows for all 14 depths at instant t: the level reading plus the glyph meaning.
 * Rows are `null` where the instant is outside the catalogue.
 */
export function levelRows(model, t, depths = MAX_DEPTH) {
  const rows = [];
  for (let L = 0; L < depths; L++) {
    const l = model.levelAt(t, L);
    if (!l) {
      rows.push(null);
      continue;
    }
    const info = model.levelInfo(L);
    rows.push({
      level: L,
      depth: L + 1,
      letter: info.letter,
      name: LEVEL_NAMES[L],
      local: l.local + 1,
      siblings: l.siblings,
      cycle: l.cycle,
      phase: l.phase,
      progress: l.progress,
      index: l.index,
      value: l.value,
      derivative: l.derivative,
      dotted: l.dotted,
      trits: l.trits,
      quarter: l.quarter,
      states: l.states,
      start: l.start,
      end: l.end,
      duration: l.duration,
      clipped: l.clipped,
      next: l.next,
    });
  }
  return rows;
}

/**
 * Next / previous occurrences of "depth `level+1` shows glyph state `index`".
 * @returns {{next: object[], prev: object[]}} each {start,end,cycle}
 */
export function stateTimes(model, level, index, t, count = 3) {
  const clamped = model.clamp(t);
  const next = model.stateOccurrences(level, [index], clamped, { direction: 1, count });
  const prev = model.stateOccurrences(level, [index], clamped, { direction: -1, count });
  return { next, prev };
}

// ---------------------------------------------------------------------------------------------
// solar sync
// ---------------------------------------------------------------------------------------------
const syncRangeCache = new WeakMap();
/** First and last sync number that lies completely inside the catalogue. */
export function syncRange(model) {
  let r = syncRangeCache.get(model);
  if (r) return r;
  const probe = (t) => {
    try {
      return model.solarAt(t)?.sync ?? null;
    } catch {
      return null;
    }
  };
  let lo = probe(model.tMin + 6 * 86400);
  let hi = probe(model.tMax - 6 * 86400);
  while (model.solarSyncByNumber(lo - 1)) lo -= 1;
  while (!model.solarSyncByNumber(lo)) lo += 1;
  while (model.solarSyncByNumber(hi + 1)) hi += 1;
  while (!model.solarSyncByNumber(hi)) hi -= 1;
  r = { first: lo, last: hi };
  syncRangeCache.set(model, r);
  return r;
}

/** model.solarAt that returns null instead of throwing in the half-sync at either catalogue edge. */
export function safeSolarAt(model, t) {
  try {
    return model.solarAt(t);
  } catch {
    return null;
  }
}

/**
 * Everything about solar sync n: start/end, the civil-day grid time it drifts against,
 * the drift and the four quarter thresholds (time-linear, SPEC §7.3). null if n is not
 * entirely inside the catalogue.
 */
export function solarInfo(model, f, n) {
  if (!Number.isSafeInteger(n)) return null; // the library turns the number into a BigInt: Infinity / 1.5 would throw
  const s = model.solarSyncByNumber(n);
  if (!s) return null;
  const len = s.end - s.start;
  const names = ['peak', 'node', 'valley', 'end'];
  return {
    sync: n,
    start: s.start,
    end: s.end,
    length: len,
    nominalStart: s.nominalStart,
    drift: s.drift,
    startClock: f.time(r3(s.start), { seconds: true }),
    nominalClock: f.time(r3(s.nominalStart), { seconds: true }),
    quarters: names.map((name, i) => ({ name, time: s.start + ((i + 1) / 4) * len })),
  };
}

// ---------------------------------------------------------------------------------------------
// one-stop description (used by the tests and by the jump box details)
// ---------------------------------------------------------------------------------------------
/** "in 3 d 04 h" / "2 y 14 d ago" relative to `ref`. */
export function relativeText(fmt, t, ref) {
  if (Math.abs(t - ref) < 0.5) return 'the displayed time';
  return fmt.countdown(t - ref);
}

/** Detail line for a target instant: "Thu 8 Oct 2026, 12:00:00 UTC · α#6 β#4 γ#9 δ#3 ε#5 · in 3 d 04 h". */
export function describeTime(model, fmt, t, ref, { date = true } = {}) {
  const parts = [];
  if (date) parts.push(`${fmt.long(r3(t))} ${fmt.tag(r3(t))}`);
  const a = addressText(model, t);
  if (a) parts.push(a);
  if (ref !== undefined) parts.push(relativeText(fmt, t, ref));
  return parts.join(' · ');
}

/** Full position of a time: ordinal-based and address-based descriptors (for round-trip tests). */
export function describeInstant(model, f, t) {
  const g = gregorianInfo(f, t);
  const inRange = model.inRange(r3(t));
  return {
    t: r3(t),
    inRange,
    greg: g,
    position: inRange ? positionInfo(model, t) : null,
    rows: inRange ? levelRows(model, t) : null,
    solar: inRange ? safeSolarAt(model, t) : null,
    eclipses: eclipseContext(model, t),
  };
}

export { zonedToUnix, daysInMonth };
