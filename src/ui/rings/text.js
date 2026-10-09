/**
 * Text helpers for the rings view: labels, zone-aware "when" strings at a precision that suits
 * the length of the cycle they belong to, and countdown phrases. Pure functions of their inputs;
 * the formatter (`ctx.fmt`) is passed in so they stay testable with `createFormatter`.
 */
import { MONTHS_SHORT, WEEKDAYS_SHORT } from '../../core/format.js';

export const YEAR = 31557600;
export const MINUS = '−';

const pad = (n, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');

/** "ε 5": Greek letter and depth. */
export const levelTag = (info) => `${info.letter} ${info.depth}`;

/** "3/5" counter of a cycle inside its parent (α counts inside the catalogue: "6/18"). */
export const counterText = (lv) => `${lv.local + 1}/${lv.siblings}`;

/** "ε 5 · 3/5". */
export const cycleTag = (info, lv) => `${levelTag(info)} · ${counterText(lv)}`;

/**
 * Gregorian date and time-of-day of `t` in the formatter's zone, with a precision that matches
 * the cycle length `span` (seconds): dates only for multi-year cycles, minutes for day-long ones,
 * milliseconds for sub-10-second ones.
 * @param {object} fmt  ctx.fmt
 * @param {{compact?:boolean, refYear?:number}} [o]  compact: "9 Oct" instead of "Thu 9 Oct 2026";
 *   the year is then only shown when it differs from `refYear`.
 * @returns {{date:string, time:string}}
 */
export function whenParts(fmt, t, span, { compact = false, refYear } = {}) {
  const p = fmt.parts(t);
  const mon = MONTHS_SHORT[p.month - 1];
  const yearScale = span >= YEAR * 0.9;
  let date;
  if (compact) {
    const withYear = yearScale || refYear === undefined || p.year !== refYear;
    date = `${p.day} ${mon}${withYear ? ' ' + p.year : ''}`;
  } else {
    date = `${WEEKDAYS_SHORT[p.weekday]} ${p.day} ${mon} ${p.year}`;
  }
  const hm = `${pad(p.hour)}:${pad(p.minute)}`;
  let time;
  if (yearScale) time = '';
  else if (span >= 86400) time = hm;
  else if (span >= 10) time = `${hm}:${pad(p.second)}`;
  else time = `${hm}:${pad(p.second)}.${pad(Math.min(999, p.ms), 3)}`;
  return { date, time };
}

/** `whenParts` joined on one line: "Thu 9 Oct 2026, 14:23". */
export function whenText(fmt, t, span, o) {
  const { date, time } = whenParts(fmt, t, span, o);
  return time ? `${date}, ${time}` : date;
}

/** "3 d 04 h" from a signed number of seconds (no "in"/"ago"). */
export function countdownBody(fmt, seconds) {
  return fmt.countdown(Math.abs(seconds)).replace(/^in /, '');
}

/**
 * The sentence of the help text about how deep the rings go, true for the view that opens (`opening`: the innermost
 * ring of the default depth range) and for the finest ring there is (`finest`). Both are `model.levelInfo` records.
 */
export function depthRangeNote(fmt, opening, finest) {
  return `The dial opens with ${levelTag(opening)} as its innermost ring (one turn takes about ${fmt.duration(opening.meanSeconds)}); the Depth control goes on down to ${levelTag(finest)}, whose turn lasts about ${fmt.duration(finest.meanSeconds)}.`;
}

/** "starts in 3 h 02 min" / "started 2 d 03 h ago" / "running now". */
export function startPhrase(fmt, start, end, now) {
  if (now >= start && now < end) return 'running now';
  return start > now ? `starts ${fmt.countdown(start - now)}` : `started ${fmt.countdown(start - now)}`;
}

/**
 * Percentage with one decimal: "47.2 %". Floored, so a cycle never reads "100.0 %" before it has ended
 * (the epsilon keeps exact tenths such as 0.29 from flooring one tenth too low). The separator is a narrow no-break space.
 */
export const percentText = (phase) => `${(Math.min(999, Math.max(0, Math.floor(phase * 1000 + 1e-7))) / 10).toFixed(1)}\u202f%`;

/** "+3", "0", "−4" for a glyph value. */
export const valueText = (v) => (v > 0 ? `+${v}` : v < 0 ? `${MINUS}${-v}` : '0');
