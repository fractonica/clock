/**
 * Pure helpers shared by the ladder and upnext modules: geometry of the segmented
 * progress bar, duration / countdown wording, Gregorian labels at the right
 * resolution for a cycle's scale, exact Saros-position strings, and the
 * "what turns over next" event list. No DOM here, so everything is unit-tested
 * (test/ladder.test.js).
 */
import { MONTHS_SHORT, WEEKDAYS_SHORT } from '../../core/format.js';

export const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω';
export const letterOf = (level) => GREEK[level] ?? '?';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const YEAR = 31557600; // Julian year, the same unit core/format.js uses
const pad2 = (n) => String(Math.trunc(n)).padStart(2, '0');
const pad3 = (n) => String(Math.trunc(n)).padStart(3, '0');

/** Keep a number inside [lo, hi]. */
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Round to a grid of `steps` per unit; used to skip DOM writes that cannot change a pixel. */
export const quantize = (x, steps) => Math.round(x * steps) / steps;

/** Deepest level the UI shows (ξ, depth 14) and the default window of the ladder (depth 1..10). */
export const MIN_DEPTH = 1;
export const MAX_DEPTH = 14;
export const DEFAULT_MAX_DEPTH = 10;

/** A depth from shared state as an integer 1..14, or `fallback` when it is missing, not a number or below 1. */
export function normDepth(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= MIN_DEPTH ? Math.min(MAX_DEPTH, n) : fallback;
}

/** A selected level (0-based) from shared state as an integer 0..13; anything unusable falls back to `fallback`. */
export function normLevel(v, fallback = 6) {
  const n = typeof v === 'number' ? Math.round(v) : NaN;
  return Number.isFinite(n) ? clamp(n, 0, MAX_DEPTH - 1) : fallback;
}

// ---------------------------------------------------------------------------
// Segmented progress bar
// ---------------------------------------------------------------------------

/**
 * Where a cycle's phase falls among its `factor` child segments.
 * @param {number} phase  0..1, position-linear phase of the cycle (model `levelAt().phase`)
 * @param {number} factor number of child cycles
 * @returns {{index:number, frac:number}} index of the current segment (0-based) and
 *   how far through that segment we are (0..1). Segments before `index` are complete.
 */
export function segmentState(phase, factor) {
  const x = clamp(Number.isFinite(phase) ? phase : 0, 0, 1) * factor;
  const index = Math.floor(x);
  if (index >= factor) return { index: factor - 1, frac: 1 };
  return { index, frac: x - index };
}

/** "3rd of 5" style ordinal text for tooltips. */
export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10]}`;
}

/** Counter text of a level reading: "5 / 11", alpha: "cycle 6 of 18". Always 1-based. */
export function counterText(level, local, siblings) {
  const n = clamp(local + 1, 1, siblings);
  return level === 0 ? `cycle ${n} of ${siblings}` : `${n} / ${siblings}`;
}

// ---------------------------------------------------------------------------
// Percent through a cycle
// ---------------------------------------------------------------------------

/** Thin no-break space between a number and its unit, the same one the rings use ("66 %"). */
const NNBSP = '\u202f';

/**
 * Whole percent through a cycle, floored and capped at 99: a cycle that has not ended is never "100 %".
 * `phase` is the model's position-linear phase, the quantity the segmented bar fills with.
 */
export function pctWhole(phase) {
  const p = Number.isFinite(phase) ? phase : 0;
  return clamp(Math.floor(p * 100 + 1e-7), 0, 99);
}

/** "66 %" (floored). */
export const pctText = (phase) => `${pctWhole(phase)}${NNBSP}%`;

/** "66.4 %" (floored to a tenth, as the rings print it). */
export function pctTenthsText(phase) {
  const p = Number.isFinite(phase) ? phase : 0;
  return `${(clamp(Math.floor(p * 1000 + 1e-7), 0, 999) / 10).toFixed(1)}${NNBSP}%`;
}

// ---------------------------------------------------------------------------
// Just before / Just after
// ---------------------------------------------------------------------------

/** "Just before" stops this many seconds ahead of a turnover (or a quarter of the cycle, when that is shorter). */
export const JUST_BEFORE_S = 2;
export const JUST_BEFORE_SHARE = 0.25;
/** "Just after" lands this far inside the next cycle (s). */
export const JUST_AFTER_S = 0.001;

/**
 * How far before the end of a cycle "Just before" lands: 2 s, but never more than a quarter of the cycle, so
 * the landing stays inside the cycle it was asked for (mu, nu and xi last 1.6 s, 0.31 s and 44 ms).
 * @param {number} duration length of the cycle that ends (s)
 */
export function justBeforeLead(duration) {
  if (!(duration > 0)) return JUST_BEFORE_S;
  return Math.min(JUST_BEFORE_S, duration * JUST_BEFORE_SHARE);
}

/** The instant "Just before" travels to for a cycle that ends at `end` and lasts `duration` s. */
export const justBeforeTime = (end, duration) => end - justBeforeLead(duration);

/** The instant "Just after" travels to: 1 ms into the cycle that follows the one ending at `end`. */
export const justAfterTime = (end) => end + JUST_AFTER_S;

/** "2 s", "400 ms", "11 ms": a lead time as it reads inside a sentence. */
export function leadText(seconds) {
  if (seconds < 1) return `${Math.max(1, Math.round(seconds * 1000))} ms`;
  return `${+seconds.toFixed(1)} s`;
}

/**
 * Where "Just before" lands for the turnover of level `top` at time `time`: inside the cycle that ends there.
 * Reads the exact duration of that cycle from the model (a turnover event only carries its time and top level).
 */
export function justBeforeEventTime(model, time, top) {
  const ending = model.levelAt(time - 0.0005, top);
  return justBeforeTime(time, ending ? ending.duration : model.levelInfo(top).meanSeconds);
}

// ---------------------------------------------------------------------------
// Durations and countdowns
// ---------------------------------------------------------------------------

/** Floor to a tenth of a second (what every countdown shows below 10 s). */
const floorTenth = (s) => Math.floor(s * 10) / 10;

/**
 * The shared countdown (`fmt.countdown`: two most significant units, "in 3 d 04 h", "in 12 min 04 s", "in 7.3 s")
 * without its "in": the ladder rows and tooltips put their own words around it. Tenths below 10 s are floored here as well
 * as in the shared formatter, so a cycle with 9.96 s left never reads "10.0 s" in one card and "9.9 s" in another.
 * @param {{countdown:(s:number)=>string}} fmt
 */
export function countdownText(fmt, seconds) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return fmt.countdown(s < 10 ? floorTenth(s) : s).replace(/^in /, '');
}

/**
 * Hero countdown with up to three units, stable width, e.g.
 *   "3 y 142 d 05 h", "2 d 03 h 11 min", "5 h 03 min 07 s", "12 min 04 s", "37 s", "7.3 s".
 * Under a minute it is the shared countdown, so every card reads the same in the last seconds.
 * @param {{countdown:(s:number)=>string}} fmt
 */
export function countdownLong(fmt, seconds) {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  if (s < 60) return countdownText(fmt, s);
  const w = Math.floor(s);
  if (w >= YEAR) {
    const y = Math.floor(w / YEAR);
    const d = Math.floor((w - y * YEAR) / DAY);
    const h = Math.floor((w - y * YEAR - d * DAY) / HOUR);
    return `${y} y ${d} d ${pad2(h)} h`;
  }
  if (w >= DAY) {
    const d = Math.floor(w / DAY);
    const h = Math.floor((w % DAY) / HOUR);
    const m = Math.floor((w % HOUR) / MINUTE);
    return `${d} d ${pad2(h)} h ${pad2(m)} min`;
  }
  if (w >= HOUR) {
    const h = Math.floor(w / HOUR);
    const m = Math.floor((w % HOUR) / MINUTE);
    return `${h} h ${pad2(m)} min ${pad2(w % MINUTE)} s`;
  }
  return `${Math.floor(w / MINUTE)} min ${pad2(w % MINUTE)} s`;
}

/**
 * Time-left text of a ladder row: the shared countdown, except that a span of a year or more
 * reads as decimal years ("19.3 y"), which suits the long cycles of the first rows.
 * @param {{duration:(s:number)=>string, countdown:(s:number)=>string}} fmt
 */
export function remainingText(fmt, seconds) {
  return seconds >= YEAR ? fmt.duration(seconds) : countdownText(fmt, seconds);
}

// ---------------------------------------------------------------------------
// Gregorian labels (zone-aware through the bound formatter `fmt`)
// ---------------------------------------------------------------------------

/**
 * Nearest millisecond of t. Instants such as ...340.124 are doubles with an error of up to
 * a few microseconds at these magnitudes (|t| up to 3e10), so truncating the fraction
 * would show ...123 for about half of all ms-aligned instants.
 */
export const snapMs = (t) => Math.round(t * 1000) / 1000;

/** Millisecond part of t (0..999). Call with a snapMs() value, so the fraction is a whole number of ms. */
const msOf = (t) => clamp(Math.round((t - Math.floor(t)) * 1000), 0, 999);

/**
 * Time label chosen for the scale of the cycle it belongs to (`span` = cycle length in s):
 *   >= 90 d   2031-03-07
 *   >= 1 d    Oct 12 04:11   (2031-03-07 04:11 when the year differs from `ref`)
 *   <  1 d    14:23:07       (Oct 12 14:23:07 on another day, even across New Year: the year
 *                             is implied by a span this short; .250 ms part below 10 s)
 */
export function whenLabel(fmt, t, ref, span) {
  const precise = span < 10;
  if (precise) t = snapMs(t);
  const p = fmt.parts(t);
  const r = fmt.parts(ref);
  const iso = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  const date = `${MONTHS_SHORT[p.month - 1]} ${p.day}`;
  const sameYear = p.year === r.year;
  const sameDay = sameYear && p.month === r.month && p.day === r.day;
  const hm = `${pad2(p.hour)}:${pad2(p.minute)}`;
  if (span >= 90 * DAY) return iso;
  if (span >= DAY) return sameYear ? `${date} ${hm}` : `${iso} ${hm}`;
  const clock = `${hm}:${pad2(p.second)}${precise ? '.' + pad3(msOf(t)) : ''}`;
  return sameDay ? clock : `${date} ${clock}`;
}

/** Full Gregorian instant: "Fri 9 Oct 2026, 14:23:07" (".250" appended when `precise`). */
export function whenFull(fmt, t, { precise = false } = {}) {
  if (precise) t = snapMs(t);
  const p = fmt.parts(t);
  const clock = `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}${precise ? '.' + pad3(msOf(t)) : ''}`;
  return `${WEEKDAYS_SHORT[p.weekday]} ${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}, ${clock}`;
}

/** Day cell of an event row: "Sun 18 Oct" (same year as `refYear`) or "18 Oct 2027". */
export function dayLabel(fmt, t, refYear) {
  const p = fmt.parts(t);
  if (p.year === refYear) return `${WEEKDAYS_SHORT[p.weekday]} ${p.day} ${MONTHS_SHORT[p.month - 1]}`;
  return `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}`;
}

/** "03:41" clock cell of an event row. */
export function clockLabel(fmt, t) {
  const p = fmt.parts(t);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

// ---------------------------------------------------------------------------
// Exact Saros positions
// ---------------------------------------------------------------------------

/** Decimal string of the non-negative rational num/den with `decimals` places (round half up, exact BigInt). */
export function ratioToDecimal(num, den, decimals) {
  const scale = 10n ** BigInt(decimals);
  const q = (num * scale * 2n + den) / (den * 2n);
  if (decimals === 0) return q.toString();
  const s = q.toString().padStart(decimals + 1, '0');
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

/** Decimals that resolve one cycle (4/P Saros) with one spare digit. */
export function positionDecimals(prefix) {
  const resolution = prefix / 4n || 1n; // ~ 1 / (cycle length in Saros)
  return clamp(String(resolution).length + 1, 2, 14);
}

/**
 * Saros-position span of a cycle: cycle `cycle` of the level with prefix P covers
 * positions 4c/P .. 4(c+1)/P (the last cycle is clipped at the catalogue extent).
 * @returns {{from:string, to:string, delta:string}}
 */
export function positionSpan(cycle, prefix, extent, clipped = false) {
  const c = BigInt(cycle);
  const decimals = positionDecimals(prefix);
  const ext = BigInt(extent);
  let num0 = 4n * c;
  let num1 = 4n * (c + 1n);
  if (num0 > ext * prefix) num0 = ext * prefix;
  if (clipped || num1 > ext * prefix) num1 = ext * prefix;
  return {
    from: ratioToDecimal(num0, prefix, decimals),
    to: ratioToDecimal(num1, prefix, decimals),
    delta: ratioToDecimal(num1 - num0, prefix, decimals),
  };
}

// ---------------------------------------------------------------------------
// Importance filter and upcoming turnovers
// ---------------------------------------------------------------------------

/** Importance choices of the "Up next" card: events whose coarsest rolling level is <= `top`. */
export const IMPORTANCE = Object.freeze(
  [2, 3, 4, 5, 6].map((top) => Object.freeze({ id: letterOf(top), top, label: `α–${letterOf(top)}` })),
);
export const DEFAULT_IMPORTANCE = 'ζ';
export const importanceById = (id) => IMPORTANCE.find((i) => i.id === id) ?? IMPORTANCE.find((i) => i.id === DEFAULT_IMPORTANCE);

/** Levels finer than `top` that are visible in the ladder (top+1 .. maxLevel) and roll over with it. */
export function finerLevels(top, maxLevel) {
  const out = [];
  for (let L = top + 1; L <= maxLevel; L++) out.push(L);
  return out;
}

/** "ζ, η, θ, ι" (or "ζ … κ" when more than `max` letters; four is the most that keeps the hero sentence on one line in the 340 px column). */
export function levelLetters(levels, max = 4) {
  if (levels.length <= max) return levels.map(letterOf).join(', ');
  return `${letterOf(levels[0])} … ${letterOf(levels[levels.length - 1])}`;
}

/** Sentence under the hero: "ε 5 ends — 4 finer cycles (ζ, η, θ, ι) end with it." */
export function turnoverSentence(top, maxLevel) {
  const fin = finerLevels(top, maxLevel);
  const name = `${letterOf(top)} ${top + 1}`;
  if (!fin.length) return `${name} ends.`;
  const noun = fin.length === 1 ? 'finer cycle' : 'finer cycles';
  return `${name} ends — ${fin.length} ${noun} (${levelLetters(fin)}) end${fin.length === 1 ? 's' : ''} with it.`;
}

/**
 * The next turnovers after `t`, newest-first sorted by time, ready for display.
 * `model.upcomingEnds` merges the ends of levels 0..importance.top: an end of a coarse
 * level is also an end of every finer one, so each event carries the coarsest level that
 * rolls over (`top`).
 * @returns {{key:string, time:number, top:number, finer:number}[]}
 */
export function buildEvents(model, t, { importance, maxLevel, count = 8 } = {}) {
  const imp = typeof importance === 'string' ? importanceById(importance) : importance;
  const raw = model.upcomingEnds(t, { fromLevel: 0, toLevel: imp.top, count, perLevel: 8 });
  return raw.map((e) => ({
    key: e.position,
    time: e.time,
    top: e.top,
    finer: Math.max(0, maxLevel - e.top),
  }));
}

/**
 * Decorate an event list with the day grouping used by the list rows:
 * `day` is the label shown on the first row of a civil day (null on the following rows of
 * the same day; the very first row always carries it) and `newDay` marks the separator
 * drawn between two different civil days.
 */
export function groupByDay(events, fmt, refT) {
  const refYear = fmt.parts(refT).year;
  let prev = null;
  return events.map((e, i) => {
    const key = fmt.date(e.time);
    const first = i === 0;
    const newDay = key !== prev;
    prev = key;
    return {
      ...e,
      dayKey: key,
      newDay: !first && newDay,
      day: first || newDay ? dayLabel(fmt, e.time, refYear) : null,
      clock: clockLabel(fmt, e.time),
    };
  });
}

/**
 * Does an event list computed for the window [validFrom, validUntil) still describe the time `t`?
 * The list is valid exactly while t stays inside the current cycle of the finest included level:
 * the window starts at that cycle's start and ends at the first listed event.
 */
export const isStale = (t, validFrom, validUntil) => t < validFrom || t >= validUntil;

/**
 * Compare two event lists for the shift-up animation. Returns how many leading events of
 * `prev` have passed when `next` is the same sequence advanced, or -1 when the lists are
 * unrelated (a jump in time, a different importance, ...).
 */
export function advancedBy(prev, next) {
  if (!prev.length || !next.length) return -1;
  const at = prev.findIndex((e) => e.key === next[0].key);
  if (at < 0) return -1;
  const overlap = Math.min(prev.length - at, next.length);
  for (let i = 0; i < overlap; i++) if (prev[at + i].key !== next[i].key) return -1;
  return at;
}
