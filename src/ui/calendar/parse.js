/**
 * Jump-box parser (pure). parseJump(text, {now, zone, model, fmt}) turns anything a person
 * might type into a ranked list of candidate instants:
 *
 *   dates / times  2031-06-01 · 2031-06-01 14:30:15 · 1 Jun 2031 2pm · 2031-06-01T14:30Z · Thu 8 Oct 2026, 12:00:00
 *                  2031-06-01 14:30 Moscow (a zone name or IANA zone after the time) · 06/01/2031 (slashes: day/month,
 *                  or month/day when `dayFirst` is false)
 *   unix           1791460800 · unix 1791460800 · 1791460800000 (ms)
 *   relative       now · today · tomorrow 9:00 · +3d · -2h30m · in 2 weeks · 3 days ago · +1y
 *   position       pos 22.9278 · p22.9278 · saros 22.9 · 22 + 0.9278
 *   cycles         α#6 β#3 γ#11 · α6 β3 γ11 · a6 b3 g11 · 6.3.11 · ε#5 (ancestors from the displayed time) · d7#717211
 *   sync           sync 4820 · S4820 node
 *   boundaries     next ε · prev ζ · next end of δ · next peak η · next peak (the selected level) · next 3 ε
 *   odometer       d7 13,0 · η [13,0]
 *
 * Notation: a bare "letter number" such as "ε 5" is the DEPTH chip shown by the ladder, Up next, rings and
 * timeline, so this module writes an ordinal with a hash: "ε#5" is the 5th ε inside its parent. The parser
 * still reads the old spellings (α6 β3 γ11, a6.b3.g11, 6.3.11, "ε 5"); the spaced single form is ambiguous,
 * so its first candidate says in words which reading it took and a second one offers the depth reading
 * ("the running ζ") where there is one. The global 0-based cycle index is only written with the depth form,
 * "d7#717211", never with a Greek letter.
 *
 * Every candidate is {label, time, kind, detail}; failures are {kind:'error', time:null, error}.
 * Candidates are best first; the error entries are only returned when nothing else parsed.
 * `now` is the displayed time (relative inputs hang off it), `real` the device clock (for "now").
 * Input is capped at MAX_INPUT characters and never echoed in full into a label.
 */
import { createFormatter, zonedParts, daysInMonth } from '../../core/format.js';
import {
  LETTERS,
  LEVEL_NAMES,
  MONTHS_FULL,
  POINTS,
  an,
  addDays,
  catalogueRangeText,
  childCount,
  chainText,
  clip,
  cycleLabel,
  cycleOfPath,
  dayStart,
  describeTime,
  isoOffset,
  landOn,
  localToUnix,
  ordinal,
  pathOfTime,
  pathText,
  pointOfCycle,
  r3,
  rangeProblem,
  syncRange,
  utcDate,
  utcSeconds,
  utcStamp,
  wallTimeNote,
} from './convert.js';

/** Longest input the jump box reads (the input has the same maxlength). */
export const MAX_INPUT = 200;

// ---------------------------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------------------------
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[−‒-―]/g, '-')
    .replace(/[  -​ 　]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LEVEL_WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi'];
const LATIN = { a: 0, b: 1, g: 2, d: 3, e: 4, z: 5, h: 6, t: 7, th: 7, i: 8, k: 9, l: 10, m: 11, n: 12, x: 13 };
const LEVEL_ALT = 'alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|th|[α-ξ]|[a-z]';
const DEPTH_ALT = '(?:depth|d)\\s*\\d{1,2}';
const POINT_WORDS = 'begin|start|peak|node|valley|end|mid|middle';

/** zero-based level for a Greek letter, English name or Latin shorthand; -1 if unknown. */
export function levelOfToken(tok) {
  const t = String(tok).toLowerCase();
  const w = LEVEL_WORDS.indexOf(t);
  if (w >= 0) return w;
  if (t.length === 1 && LETTERS.includes(t)) return LETTERS.indexOf(t);
  return t in LATIN ? LATIN[t] : -1;
}
/** Level from a token that may also be "d7" / "depth 7" (depth form, 1-based). */
function levelOfDepthToken(tok) {
  const m = /^(?:depth|d)\s*(\d{1,2})$/.exec(tok);
  if (m) {
    const d = Number(m[1]);
    return d >= 1 && d <= 14 ? d - 1 : -2; // -2 = depth outside 1..14
  }
  return levelOfToken(tok);
}
const pointId = (w) => (w === 'start' || w === 'begin' ? 'begin' : w === 'mid' || w === 'middle' ? 'node' : w);
const phaseOfPoint = (id) => POINTS.find((p) => p.id === id)?.phase ?? 0;
const pointLabel = (id) => POINTS.find((p) => p.id === id)?.label.toLowerCase() ?? id;

const MONTH_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const monthNum = (w) => MONTH_NUM[w.slice(0, 3)];

/**
 * Does a locale write the day before the month in a numeric date? true (en-GB, de-DE), false (en-US),
 * undefined when it cannot be told. The jump box ranks the readings of "06/01/2031" by it.
 */
export function dayFirstOfLocale(locale) {
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(2031, 5, 1));
    const order = parts.filter((p) => p.type === 'day' || p.type === 'month').map((p) => p.type);
    return order[0] === 'day' ? true : order[0] === 'month' ? false : undefined;
  } catch {
    return undefined;
  }
}

// IANA zones and their cities, for "2031-06-01 14:30 Moscow" / "... America/New_York" / "... new york".
// A city that two zones share ("Indianapolis") is not offered; modern names the runtime may lack are aliases.
const ZONE_ALIASES = { kyiv: 'Europe/Kyiv', kolkata: 'Asia/Kolkata', yangon: 'Asia/Yangon', 'ho chi minh': 'Asia/Ho_Chi_Minh', 'sao paulo': 'America/Sao_Paulo' };
let zoneIndex = null;
function zoneLookup() {
  if (zoneIndex) return zoneIndex;
  const map = new Map();
  const shared = new Set();
  const put = (key, zone) => {
    if (map.has(key) && map.get(key) !== zone) shared.add(key);
    else map.set(key, zone);
  };
  let names = [];
  try {
    names = Intl.supportedValuesOf('timeZone');
  } catch {
    names = [];
  }
  for (const z of names) {
    if (!z.includes('/') || z.startsWith('Etc/')) continue;
    const low = z.toLowerCase();
    put(low, z);
    put(low.replace(/_/g, ' '), z);
    put(low.split('/').pop().replace(/_/g, ' '), z);
  }
  for (const k of shared) map.delete(k);
  for (const [alias, z] of Object.entries(ZONE_ALIASES)) {
    if (map.has(alias)) continue;
    try {
      new Intl.DateTimeFormat('en', { timeZone: z });
      map.set(alias, z);
    } catch {
      /* the runtime does not know this name */
    }
  }
  zoneIndex = map;
  return map;
}
/** "2031-06-01 14:30 new york" -> {zone:'America/New_York', rest:'2031-06-01 14:30'}; null when no zone ends the text. */
function trailingZone(s) {
  const words = s.split(' ');
  if (words.length < 2) return null;
  const index = zoneLookup();
  for (let k = Math.min(4, words.length - 1); k >= 1; k--) {
    const zone = index.get(words.slice(-k).join(' '));
    if (zone) return { zone, rest: words.slice(0, -k).join(' ') };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Gregorian date / time parsing
// ---------------------------------------------------------------------------------------------
function offsetSeconds(zoneWord, numeric) {
  let sec = 0;
  if (numeric) {
    // +03:00, -0500, +3, and +00:53:28 (zones before standard time had offsets with seconds)
    const m = /^([+-])(\d{1,2})(?::?(\d{2}))?(?::(\d{2}))?$/.exec(numeric);
    if (!m) return null;
    if (Number(m[2]) > 14 || (m[3] && Number(m[3]) > 59) || (m[4] && Number(m[4]) > 59)) return null;
    sec = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0));
  } else if (!zoneWord) return null;
  return sec;
}

/**
 * Parse a Gregorian date and/or time. Returns null when the text is not date-like, {error}
 * when it is but a value is invalid, or {results:[{t, fields, hasTime, offset, zone, precision}]}
 * (several results when d/m vs m/d is ambiguous). Times without an explicit offset are read
 * in `zone`; `ref` {year,month,day} supplies a missing year or the date of a bare time.
 * `dayFirst === false` ranks month/day before day/month for "06/01/2031" (and reads "06-01-2031" both ways);
 * `zoneNames` accepts an IANA zone or a city after the date ("... 14:30 Moscow"), reported in `zone`.
 */
export function parseGregorian(text, { zone = 'UTC', ref, dayFirst, zoneNames = false } = {}) {
  if (String(text ?? '').length > MAX_INPUT) return { error: `That is ${String(text).length} characters: dates and times are at most ${MAX_INPUT}` };
  let s = normalize(text).toLowerCase();
  if (!s) return null;
  s = s
    .replace(/[;,]/g, ' ')
    .replace(/\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b\.?/g, ' ')
    .replace(/\b(?:at|on|the|of)\b/g, ' ')
    .replace(/(\d)(?:st|nd|rd|th)\b/g, '$1')
    .replace(/\bnoon\b/g, '12:00')
    .replace(/\bmidnight\b/g, '00:00')
    .replace(/\s+/g, ' ')
    .trim();
  let zoneOverride = null;
  if (zoneNames && s) {
    const z = trailingZone(s);
    if (z) {
      zoneOverride = z.zone;
      s = z.rest;
    }
  }
  if (!s) return null;

  // ---- time of day (+ offset) ----
  let time = null;
  let offset = null;
  let m = /(^|[\st])(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(?:\s*(am|pm))?(?![\d:])/.exec(s);
  let rest = s;
  if (!m) m = /(^|\s)(\d{1,2})()()()\s*(am|pm)\b/.exec(s);
  if (m) {
    const hasMinute = m[3] !== '';
    time = {
      hour: Number(m[2]),
      minute: hasMinute ? Number(m[3]) : 0,
      second: m[4] ? Number(m[4]) : 0,
      ms: m[5] ? Math.round(Number('0.' + m[5]) * 1000) : 0,
      ampm: m[6] ?? null,
    };
    let end = m.index + m[0].length;
    const after = /^\s*(?:(z|utc|gmt)\s*)?([+-]\d{1,2}(?::?\d{2}(?::\d{2})?)?)?(?=\s|$)/.exec(s.slice(end));
    if (after && after[0].trim() !== '') {
      const sec = offsetSeconds(after[1], after[2]);
      if (sec === null && after[2]) return { error: `"${after[2]}" is not a valid UTC offset (use +03:00, -0500 or Z)` };
      offset = sec ?? 0;
      end += after[0].length;
    }
    rest = (s.slice(0, m.index) + ' ' + s.slice(end)).replace(/\s+/g, ' ').trim();
  } else {
    const z = /\s*\b(z|utc|gmt)\s*([+-]\d{1,2}(?::?\d{2}(?::\d{2})?)?)?$/.exec(s);
    if (z && z.index > 0) {
      offset = offsetSeconds(z[1], z[2]) ?? 0;
      rest = s.slice(0, z.index).trim();
    }
  }
  if (time) {
    if (time.ampm) {
      if (time.hour < 1 || time.hour > 12) return { error: `Hour ${time.hour} does not exist on a 12-hour clock (1–12)` };
      time.hour = (time.hour % 12) + (time.ampm === 'pm' ? 12 : 0);
    } else if (time.hour > 23) return { error: `Hour ${time.hour} does not exist (0–23)` };
    if (time.minute > 59) return { error: `Minute ${time.minute} does not exist (00–59)` };
    if (time.second > 59) return { error: `Second ${time.second} does not exist (00–59)` };
  }

  // ---- date ----
  const d = rest;
  const options = []; // {year, month, day, precision, note}
  const push = (year, month, day, precision, note) => options.push({ year, month, day, precision, note });
  let r;
  if (d === '') {
    if (!time || !ref) return null;
    push(ref.year, ref.month, ref.day, 'time');
  } else if ((r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(d))) push(+r[1], +r[2], +r[3], 'day');
  else if ((r = /^(\d{4})[-/.](\d{1,2})$/.exec(d))) push(+r[1], +r[2], 1, 'month');
  else if ((r = /^(\d{4})$/.exec(d))) push(+r[1], 1, 1, 'year');
  else if ((r = /^(\d{4})(\d{2})(\d{2})$/.exec(d))) push(+r[1], +r[2], +r[3], 'day', 'compact');
  else if ((r = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/.exec(d))) {
    const a = +r[1];
    const b = +r[3];
    const y = +r[4];
    if (a > 12 && b > 12) return { error: `Neither ${a} nor ${b} can be a month (1–12)` };
    if (a > 12) push(y, b, a, 'day', 'day first');
    else if (b > 12) push(y, a, b, 'day', 'month first');
    else if (r[2] === '/' || (dayFirst === false && r[2] === '-')) {
      // both readings are offered; the locale decides which one is the default (Enter takes the first)
      const dm = () => push(y, b, a, 'day', 'day/month');
      const md = () => push(y, a, b, 'day', 'month/day');
      if (dayFirst === false) {
        md();
        if (a !== b) dm();
      } else {
        dm();
        if (a !== b) md();
      }
    } else push(y, b, a, 'day', 'day first');
  } else if ((r = new RegExp(`^(\\d{1,2})\\s+${MONTH_WORD}(?:\\s+(\\d{4}))?$`).exec(d))) push(r[3] ? +r[3] : ref?.year, monthNum(r[2]), +r[1], 'day');
  else if ((r = new RegExp(`^${MONTH_WORD}\\s+(\\d{1,2})(?:\\s+(\\d{4}))?$`).exec(d))) push(r[3] ? +r[3] : ref?.year, monthNum(r[1]), +r[2], 'day');
  else if ((r = new RegExp(`^${MONTH_WORD}\\s+(\\d{4})$`).exec(d))) push(+r[2], monthNum(r[1]), 1, 'month');
  else if ((r = new RegExp(`^(\\d{4})\\s+${MONTH_WORD}(?:\\s+(\\d{1,2}))?$`).exec(d))) push(+r[1], monthNum(r[2]), r[3] ? +r[3] : 1, r[3] ? 'day' : 'month');
  else if ((r = new RegExp(`^${MONTH_WORD}$`).exec(d))) push(ref?.year, monthNum(r[1]), 1, 'month');
  else return null;

  const results = [];
  let firstError = null;
  for (const o of options) {
    if (o.year === undefined) {
      firstError ??= 'Add a year, e.g. ' + d + ' 2031';
      continue;
    }
    if (o.month < 1 || o.month > 12) {
      firstError ??= `Month ${o.month} does not exist (1–12)`;
      continue;
    }
    if (o.year < 1000) {
      // Date.UTC would read 0050 as 1950; no year before 1000 is meaningful for the clock anyway
      firstError ??= `Year ${o.year} is not supported (years 1000 to 9999 only)`;
      continue;
    }
    const dim = daysInMonth(o.year, o.month);
    if (o.day < 1) {
      firstError ??= `Day ${o.day} does not exist`;
      continue;
    }
    if (o.day > dim) {
      firstError ??= `${MONTHS_FULL[o.month - 1]} ${o.year} has only ${dim} days`;
      continue;
    }
    const fields = {
      year: o.year,
      month: o.month,
      day: o.day,
      hour: time?.hour ?? 0,
      minute: time?.minute ?? 0,
      second: time?.second ?? 0,
      ms: time?.ms ?? 0,
    };
    const t =
      offset !== null
        ? utcSeconds(fields.year, fields.month, fields.day, fields.hour, fields.minute, fields.second) - offset + fields.ms / 1000
        : localToUnix(fields, zoneOverride ?? zone);
    results.push({ t, fields, hasTime: !!time, offset, zone: offset === null ? zoneOverride : null, precision: o.precision, note: o.note });
  }
  if (!results.length) return { error: firstError ?? 'Not a valid date' };
  return { results };
}

/** Date input of the converter: "2031-06-01" (or any parseGregorian form) -> {year,month,day} | {error}. */
export function parseDateText(text, ref) {
  const r = parseGregorian(text, { zone: 'UTC', ref });
  if (!r) return { error: 'Write the date as YYYY-MM-DD' };
  if (r.error) return { error: r.error };
  const f = r.results[0].fields;
  return { year: f.year, month: f.month, day: f.day, time: r.results[0].hasTime ? f : null };
}
/** Time input of the converter: "14:30[:15[.250]]", "2pm", "noon" -> {hour,minute,second,ms} | {error}. */
export function parseTimeText(text) {
  const r = parseGregorian(text, { zone: 'UTC', ref: { year: 2000, month: 1, day: 1 } });
  if (!r || (!r.error && !r.results[0].hasTime)) return { error: 'Write the time as HH:MM:SS.mmm' };
  if (r.error) return { error: r.error };
  const { hour, minute, second, ms } = r.results[0].fields;
  return { hour, minute, second, ms };
}

// ---------------------------------------------------------------------------------------------
// candidates
// ---------------------------------------------------------------------------------------------
const err = (message, detail = '') => ({ kind: 'error', label: message, time: null, detail, error: message });

/** Build a candidate, or an error when the instant is outside the catalogue. */
function make(C, kind, label, t, { extra = '', date = true } = {}) {
  const problem = rangeProblem(C.model, t);
  if (problem) return err(`${label} is ${problem}`, `Catalogue: ${catalogueRangeText(C.model)} (UTC)`);
  const detail = [describeTime(C.model, C.fmt, t, C.now, { date }), extra].filter(Boolean).join(' · ');
  return { kind, label, time: t, detail };
}

function refDate(C) {
  const p = zonedParts(C.now, C.zone);
  return { year: p.year, month: p.month, day: p.day };
}

// ---------------------------------------------------------------------------------------------
// recognizers: each returns null (not mine) or an array of candidates / errors
// ---------------------------------------------------------------------------------------------
function recKeyword(C) {
  const m = /^(now|today|tomorrow|tmrw|yesterday)(?:\s+(.+))?$/.exec(C.lower);
  if (!m) return null;
  const word = m[1];
  if (word === 'now') {
    if (m[2]) return null;
    const c = make(C, 'relative', 'Now (device clock)', C.real);
    // choosing it returns the app to the live device clock instead of freezing on this instant
    if (c.kind !== 'error') c.live = true;
    return [c];
  }
  const ref0 = refDate(C);
  const shift = word === 'yesterday' ? -1 : word === 'today' ? 0 : 1;
  const day = addDays(ref0.year, ref0.month, ref0.day, shift);
  let t;
  let label;
  if (m[2]) {
    const r = parseGregorian(m[2], { zone: C.zone, ref: day });
    if (!r) return [err(`Cannot read the time "${clip(m[2])}" after "${word}"`, 'Try 14:30, 2pm or noon')];
    if (r.error) return [err(r.error)];
    if (r.results[0].precision !== 'time') return [err(`After "${word}" write only a time of day, e.g. ${word} 14:30`)];
    t = r.results[0].t;
    label = `${word[0].toUpperCase()}${word.slice(1)} ${clip(m[2])}`;
  } else {
    t = dayStart(C.zone, day.year, day.month, day.day);
    label = `${word[0].toUpperCase()}${word.slice(1)} (start of the day)`;
  }
  return [make(C, 'relative', label, t)];
}

const UNIT_ALIASES = [
  [/^(?:ms|msec|msecs|millisecond|milliseconds)$/, 'ms'],
  [/^(?:s|sec|secs|second|seconds)$/, 's'],
  [/^(?:m|min|mins|minute|minutes)$/, 'min'],
  [/^(?:h|hr|hrs|hour|hours)$/, 'h'],
  [/^(?:d|day|days)$/, 'd'],
  [/^(?:w|wk|wks|week|weeks)$/, 'w'],
  [/^(?:mo|mos|mon|month|months)$/, 'mo'],
  [/^(?:y|yr|yrs|year|years)$/, 'y'],
];
const UNIT_TEXT = { ms: 'ms', s: 's', min: 'min', h: 'h', d: 'd', w: 'wk', mo: 'mo', y: 'y' };

function recRelative(C) {
  let s = C.lower;
  let sign = null;
  let m;
  if ((m = /^in\s+(.+)$/.exec(s))) {
    sign = 1;
    s = m[1];
  } else if ((m = /^(.+?)\s+(?:ago|before)$/.exec(s))) {
    sign = -1;
    s = m[1];
  } else if ((m = /^(.+?)\s+(?:later|from now|after|ahead|hence)$/.exec(s))) {
    sign = 1;
    s = m[1];
  }
  const lead = /^([+-])\s*(.+)$/.exec(s);
  if (lead) {
    sign = (sign ?? 1) * (lead[1] === '-' ? -1 : 1);
    s = lead[2];
  }
  if (sign === null) return null;
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    // "+3" / "-5": a unit is missing; long digit strings are Unix seconds, left to the unix recognizer
    if (s.replace('.', '').length > 5) return null;
    return [err('Add a unit to the offset', 'e.g. +3d, +90min, -2h30m, in 2 weeks, 5 days ago')];
  }
  const comps = { y: 0, mo: 0, w: 0, d: 0, h: 0, min: 0, s: 0, ms: 0 };
  const re = /\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*(?:,|and)?/y;
  let used = 0;
  const shown = [];
  for (;;) {
    re.lastIndex = used;
    const p = re.exec(s);
    if (!p || p.index !== used) break;
    const unit = UNIT_ALIASES.find(([rx]) => rx.test(p[2]))?.[1];
    if (!unit) return null;
    if ((unit === 'y' || unit === 'mo') && !/^\d+$/.test(p[1])) return [err('Years and months must be whole numbers', 'use +18mo or +1.5d instead of +1.5y')];
    comps[unit] += Number(p[1]);
    shown.push(`${p[1]} ${UNIT_TEXT[unit]}`);
    used = re.lastIndex;
    if (used >= s.length) break;
  }
  if (!shown.length || used < s.trimEnd().length) return null;

  const label = `${sign < 0 ? '−' : '+'}${clip(shown.join(' '), 32)} from the displayed time`;
  const dd = sign * (comps.d + comps.w * 7);
  const secs = sign * (comps.h * 3600 + comps.min * 60 + comps.s + comps.ms / 1000);
  // An offset of thousands of years cannot be built as a calendar date (Date overflows into "Invalid time value"):
  // say which end of the catalogue it lies beyond instead.
  const tooFar = () => [err(`${label} is ${rangeProblem(C.model, sign < 0 ? -Infinity : Infinity)}`, `Catalogue: ${catalogueRangeText(C.model)} (UTC)`)];
  if (![dd, secs, comps.mo, comps.y].every(Number.isFinite) || Math.abs(dd) > 4e6) return tooFar();

  const p = zonedParts(C.now, C.zone);
  let mo = p.month - 1 + sign * comps.mo + 12 * sign * comps.y;
  const year = p.year + Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  if (year < 1000 || year > 9999) return tooFar();
  const day = Math.min(p.day, daysInMonth(year, mo + 1));
  const whole = Math.trunc(dd);
  const civ = addDays(year, mo + 1, day, whole);
  if (!Number.isFinite(civ.year) || civ.year < 1000 || civ.year > 9999) return tooFar();
  let t = localToUnix({ year: civ.year, month: civ.month, day: civ.day, hour: p.hour, minute: p.minute, second: p.second, ms: p.ms }, C.zone);
  t += (dd - whole) * 86400 + secs;
  t = r3(t);
  return [make(C, 'relative', label, t)];
}

function parseState(C) {
  const m = new RegExp(`^(?:(next|prev|previous)\\s+)?(${DEPTH_ALT}|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|[α-ξ])\\s*(.+)$`).exec(C.lower);
  if (!m) return null;
  const bracket = /^[[(]\s*(.*?)\s*[\])]$/.exec(m[3]);
  const body = bracket ? bracket[1] : m[3];
  if (!/^\d{1,3}(?:\s*[,;\s]\s*\d{1,3})*\s*,?$/.test(body)) return null;
  const digits = body.split(/[,;\s]+/).filter(Boolean).map(Number);
  const depthForm = new RegExp(`^${DEPTH_ALT}$`).test(m[2]);
  if (!bracket && !body.includes(',') && !(depthForm && digits.length >= 2)) return null;
  return { dir: m[1] ? (m[1] === 'next' ? 1 : -1) : 1, levelTok: m[2], digits };
}
function recState(C) {
  const st = parseState(C);
  if (!st) return null;
  const level = levelOfDepthToken(st.levelTok);
  if (level === -2) return [err('Depth must be between 1 and 14')];
  if (level < 0) return null;
  const { model } = C;
  const tc = model.clamp(C.now);
  const names = `[${st.digits.join(', ')}]`;
  for (const d of st.digits) {
    if (d > 15) return [err(`Digit ${d} is too large: two-stroke glyphs have 16 states, numbered 0–15`)];
  }
  const out = [];
  const order = st.dir >= 0 ? [1, -1] : [-1, 1];
  for (const direction of order) {
    let occ;
    try {
      occ = model.stateOccurrences(level, st.digits, tc, { direction, count: 1 });
    } catch (e) {
      return [err(String(e.message ?? e))];
    }
    const label = `${direction > 0 ? 'Next' : 'Previous'} time depth ${level + 1} (${LETTERS[level]}) shows ${names}`;
    if (!occ.length) {
      out.push(err(`${label}: none inside the catalogue`));
      continue;
    }
    const o = occ[0];
    const shows = (c) => model.odometerAt(c, level, { digits: st.digits.length })?.digits.join() === st.digits.join();
    out.push(make(C, 'state', label, landOn(model, o.start, undefined, shows), { extra: `lasts ${C.fmt.duration(o.end - o.start)}` }));
  }
  return out;
}

/**
 * The global 0-based cycle index of a level. Only the depth form carries it ("d7#717211", "depth 7 #717211"):
 * a Greek letter before a hash ("ε#5") is the ordinal inside the parent, see recPath.
 */
function recGlobal(C) {
  const m = new RegExp(`^(${DEPTH_ALT})\\s*#\\s*(\\d+)(?:\\s+(${POINT_WORDS}))?$`).exec(C.lower);
  if (!m) return null;
  const level = levelOfDepthToken(m[1]);
  if (level === -2) return [err('Depth must be between 1 and 14')];
  if (level < 0) return null;
  const { model } = C;
  const idx = BigInt(m[2]);
  const count = model.clock.count(level);
  if (idx >= count) {
    return [err(`${LEVEL_NAMES[level]} has only ${count} cycles in the catalogue (d${level + 1}#0 … d${level + 1}#${count - 1n})`, 'The number after the # is the 0-based index counted over the whole catalogue')];
  }
  const pid = pointId(m[3] ?? 'begin');
  const t = pointOfCycle(model, level, Number(idx), phaseOfPoint(pid));
  if (t === null) return [err(`The ${pointLabel(pid)} of this ${LETTERS[level]} cycle lies beyond the end of the catalogue`)];
  const path = model.cycleToPath(level, idx);
  const label = `${LETTERS[level]} global index ${idx} · ${pathText(path)}${pid === 'begin' ? '' : ' · ' + pointLabel(pid)}`;
  const c = model.cycleByIndex(level, idx);
  return [make(C, 'cycle', label, landOn(model, t, pid === 'begin' ? level : undefined), { extra: `${LETTERS[level]} lasts ${C.fmt.duration(c.duration)}${c.clipped ? ' (clipped by the catalogue end)' : ''}` })];
}

/**
 * Tokenise an address like "α#6 β#3 γ#11", "α6 β3 γ11", "a6 b3 g11", "6.3.11" ->
 * {levels:[...], nums:[...], point, hashed, spaced} | null. `spaced` marks one "letter number" pair written
 * with a space and no hash ("ζ 6"): the text of a depth chip, so it can mean two things.
 */
function tokenizePath(lower) {
  // (a dot between entries is a separator too: a6.b3.g11)
  const body = lower.replace(/[›»>·|,]/g, ' ').replace(/(\d)\s*\.\s*(?=[a-zα-ξ#])/g, '$1 ').replace(/\s+/g, ' ').trim();
  const dotted = lower.replace(/[›»>·|]/g, '.');
  if (/^\d{1,3}(?:\s*\.\s*\d{1,3})+$/.test(dotted)) {
    const nums = dotted.split(/\s*\.\s*/).map(Number);
    return { levels: nums.map((_, i) => i), nums, point: null, hashed: false, spaced: false };
  }
  const re = new RegExp(`(\\s*)(${LEVEL_ALT})(\\s*)(#?)(\\s*)(\\d+)`, 'y');
  const levels = [];
  const nums = [];
  let hashed = false;
  let spaced = false;
  let pos = 0;
  while (pos < body.length) {
    re.lastIndex = pos;
    const m = re.exec(body);
    if (!m) break;
    const lv = levelOfToken(m[2]);
    if (lv < 0) return null;
    levels.push(lv);
    nums.push(Number(m[6]));
    if (m[4]) hashed = true;
    else if (m[3] || m[5]) spaced = true;
    pos = re.lastIndex;
  }
  if (!levels.length) return null;
  const tail = body.slice(pos).trim();
  if (tail && !new RegExp(`^@?\\s*(${POINT_WORDS})$`).test(tail)) return null;
  return { levels, nums, point: tail ? pointId(tail.replace(/^@\s*/, '')) : null, hashed, spaced: levels.length === 1 && spaced && !hashed };
}

function pathCandidates(C, tok) {
  const { model } = C;
  const { levels, nums } = tok;
  const first = levels[0];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] !== levels[i - 1] + 1) {
      if (levels[i] > levels[i - 1]) {
        return [err(`${LEVEL_NAMES[levels[i - 1] + 1]} is missing between ${LEVEL_NAMES[levels[i - 1]]} and ${LEVEL_NAMES[levels[i]]}`, 'Write consecutive levels, e.g. α#6 β#3 γ#11')];
      }
      return [err('Write the levels from the longest to the shortest, e.g. α#6 β#3 γ#11')];
    }
  }
  // ancestors from the displayed time when the address starts below alpha
  let prefix = [];
  if (first > 0) {
    if (!model.inRange(C.now)) return [err('The displayed time is outside the catalogue, so the enclosing cycles are unknown', 'Start the address with α, e.g. α#6 β#3')];
    prefix = pathOfTime(model, C.now, first);
  }
  const path = [...prefix];
  for (let i = 0; i < nums.length; i++) {
    const level = first + i;
    const n = nums[i];
    if (n < 1) return [err(`${LEVEL_NAMES[level]} numbers start at 1`)];
    if (level === 0) {
      const count = Number(model.clock.count(0));
      if (n > count) return [err(`The catalogue holds only ${count} Alpha cycles (${cycleLabel(0, 1)} … ${cycleLabel(0, count)})`, catalogueRangeText(model) + ' UTC')];
    } else {
      const sib = model.levelInfo(level).siblings;
      const parent = LEVEL_NAMES[level - 1];
      if (n > sib) {
        // a Greek letter before a hash is the ordinal; the global index has its own spelling
        const hint = tok.hashed ? ` · for a global cycle index write d${level + 1}#${n}` : '';
        return [err(`${LEVEL_NAMES[level]} has only ${sib} cycles in ${an(parent)} ${parent}`, `${cycleLabel(level, 1)} … ${cycleLabel(level, sib)}${hint}`)];
      }
    }
    path.push(n);
    if (model.pathToCycle(path) === null) {
      const maxHere = childCount(model, path.slice(0, -1));
      return [err(`${pathText(path)} starts after the catalogue ends (${utcDate(model.tMax)})`, maxHere ? `${LEVEL_NAMES[level]} goes up to ${maxHere} here, the last cycles are clipped` : '')];
    }
  }
  const level = path.length - 1;
  const cyc = cycleOfPath(model, path);
  const pid = tok.point ?? 'begin';
  const t = pointOfCycle(model, level, cyc.idx, phaseOfPoint(pid));
  if (t === null) return [err(`The ${pointLabel(pid)} of ${pathText(path)} lies beyond the end of the catalogue`, 'The last cycle is clipped by the catalogue end')];
  // What the text was taken to mean, in words, whenever the displayed time supplies the missing ancestors:
  // "the 6th ζ in the current ε". A full address from α needs no words.
  const chain = chainText(path.slice(first), first);
  let label = chain;
  if (prefix.length) {
    const parent = LETTERS[first - 1];
    label = nums.length === 1 ? `The ${ordinal(nums[0])} ${LETTERS[first]} in the current ${parent}` : `${chain} in the current ${parent}`;
  }
  if (pid !== 'begin') label += ' · ' + pointLabel(pid);
  const lasts = `${LETTERS[level]} lasts ${C.fmt.duration(cyc.duration)}${cyc.clipped ? ' (clipped by the catalogue end)' : ''}`;
  const extra = prefix.length && nums.length === 1 ? `${chain} · ${lasts}` : lasts;
  return [make(C, 'cycle', label, landOn(C.model, t, pid === 'begin' ? level : undefined), { extra })];
}

/** The cycle of `level` running at the displayed time, as the ladder's depth chip "ζ 6" shows it (its start). */
function runningCycle(C, level) {
  const { model } = C;
  const cur = model.inRange(C.now) ? model.levelAt(C.now, level) : null;
  if (!cur) return null;
  const parent = level > 0 ? ` in its ${LETTERS[level - 1]}` : '';
  const label = `The running ${LETTERS[level]} (depth ${level + 1})`;
  const extra = `${cycleLabel(level, cur.local + 1)} · ${cur.local + 1} / ${cur.siblings}${parent} · ${LETTERS[level]} lasts ${C.fmt.duration(cur.duration)}`;
  return make(C, 'cycle', label, landOn(model, cur.start, level), { extra });
}

function recPath(C) {
  const tok = tokenizePath(C.lower);
  if (!tok) return null;
  const out = pathCandidates(C, tok);
  // "ζ 6" is also what the ladder prints for the zeta that is running now (zeta is depth 6): offer that reading second
  if (tok.spaced && tok.nums[0] === tok.levels[0] + 1) {
    const running = runningCycle(C, tok.levels[0]);
    if (running) out.push(running);
  }
  return out;
}

function recSync(C) {
  const m = new RegExp(`^(?:sync|solar(?:\\s*sync)?|s)\\s*#?\\s*(-?\\d+)(?:\\s+(${POINT_WORDS}))?$`).exec(C.lower);
  if (!m) return null;
  const n = Number(m[1]);
  const { model } = C;
  // (a digit string beyond 2^53 is no sync number, and the library cannot turn it into a BigInt)
  const s = Number.isSafeInteger(n) ? model.solarSyncByNumber(n) : null;
  if (!s) {
    const r = syncRange(model);
    return [err(`Solar sync ${clip(m[1], 24)} is not inside the catalogue`, `Syncs ${r.first} … ${r.last}`)];
  }
  const pid = pointId(m[2] ?? 'begin');
  const phase = pid === 'begin' ? 0 : phaseOfPoint(pid);
  const t = s.start + phase * (s.end - s.start);
  const where = pid === 'begin' ? 'start' : pointLabel(pid);
  const drift = s.drift;
  const extra = `drift ${drift < 0 ? '−' : '+'}${C.fmt.duration(Math.abs(drift))} vs the civil grid`;
  return [make(C, 'sync', `Solar sync ${n} · ${where}`, pid === 'begin' ? landOn(model, t, 6) : landOn(model, t), { extra })];
}

function recPosition(C) {
  let m = /^(?:pos(?:ition)?|saros|p)\s*[:=]?\s*(\d+)(?:[.,](\d*))?$/.exec(C.lower);
  let k;
  let frac;
  if (m) {
    k = Number(m[1]);
    frac = m[2] ? '0.' + m[2] : '0';
  } else if ((m = /^(\d+)\s*\+\s*(0?\.\d+)$/.exec(C.lower))) {
    k = Number(m[1]);
    frac = m[2].startsWith('.') ? '0' + m[2] : m[2];
  } else if ((m = /^(\d+)\.(\d{4,})$/.exec(C.lower))) {
    k = Number(m[1]);
    frac = '0.' + m[2];
  } else return null;
  const { model } = C;
  const f = Number(frac);
  if (k > model.extent || (k === model.extent && f > 0)) {
    return [err(`Position must be between 0 and ${model.extent}`, `The catalogue holds ${model.extent} Saros intervals (${catalogueRangeText(model)})`)];
  }
  const t = k === model.extent ? model.tMax : model.catalogue[k] + f * (model.catalogue[k + 1] - model.catalogue[k]);
  return [make(C, 'position', `Saros position ${k}${f ? frac.slice(1) : ''}`, r3(t), { extra: `eclipse #${k} + ${frac}` })];
}

/**
 * Times at which cycles of `level` reach `phase` (a fraction, 0 = boundary), after `now`
 * (dir +1) or before it (dir -1); `count` results. Boundaries need a 10 ms margin so a
 * boundary we just landed on is not returned again.
 */
export function eventsAround(model, now, level, dir, count, phase) {
  const cur = model.levelAt(model.clamp(now), level);
  if (!cur) return [];
  const out = [];
  const total = Number(model.clock.count(level));
  const eps = 0.01;
  const ph = phase === 1 ? 0 : phase;
  const bump = phase === 1 ? 1 : 0;
  if (dir > 0) {
    for (let idx = Math.max(0, cur.cycle - 1); idx <= total && out.length < count; idx++) {
      const t = pointOfCycle(model, level, idx + bump, ph);
      if (t === null) break;
      if (t > now) out.push({ t, idx: idx + bump });
    }
  } else {
    for (let idx = Math.min(total - 1, cur.cycle + 1); idx >= 0 && out.length < count; idx--) {
      const t = pointOfCycle(model, level, idx + bump, ph);
      if (t === null) continue;
      if (t < now - eps) out.push({ t, idx: idx + bump });
    }
  }
  return out;
}

function recBoundary(C) {
  // "next peak" / "prev node" / "next end" without a level: the level selected in the app (opts.level), else a hint
  const bare = new RegExp(`^(next|prev|previous|last|after|before)\\s*(\\d+)?\\s*(${POINT_WORDS})$`).exec(C.lower);
  if (bare) {
    if (C.level === undefined) return [err(`"${clip(C.text)}" needs a level`, 'Name it: next peak η · next node ζ · next end of δ')];
    const dir0 = bare[1] === 'next' || bare[1] === 'after' ? 1 : -1;
    return boundaryCandidates(C, C.level, dir0, bare[2] ? Math.max(1, Math.min(500, Number(bare[2]))) : 1, pointId(bare[3]));
  }
  const re = new RegExp(
    `^(next|prev|previous|last|after|before)\\s*(\\d+)?\\s*(?:(${POINT_WORDS})\\s*(?:of\\s*)?)?(${DEPTH_ALT}|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|[α-ξ]|[a-z])\\s*(?:(${POINT_WORDS}))?$`,
  );
  const m = re.exec(C.lower);
  if (!m) return null;
  const level = levelOfDepthToken(m[4]);
  if (level === -2) return [err('Depth must be between 1 and 14')];
  if (level < 0) return null;
  const dir = m[1] === 'next' || m[1] === 'after' ? 1 : -1;
  const count = m[2] ? Math.max(1, Math.min(500, Number(m[2]))) : 1;
  const word = m[3] ?? m[5] ?? null;
  const pid = word ? pointId(word) : 'end';
  return boundaryCandidates(C, level, dir, count, pid);
}

function boundaryCandidates(C, level, dir, count, pid) {
  const { model } = C;
  if (!model.inRange(C.now)) return [err('The displayed time is outside the catalogue, so there is no next or previous cycle', `Catalogue: ${catalogueRangeText(model)} (UTC)`)];
  const phase = pid === 'end' ? 1 : pid === 'begin' ? 0 : phaseOfPoint(pid);
  const ev = eventsAround(model, C.now, level, dir, count, phase);
  const letter = LETTERS[level];
  const what = pid === 'end' || pid === 'begin' ? 'boundary' : pointLabel(pid);
  const label = `${dir > 0 ? 'Next' : 'Previous'}${count > 1 ? ' ' + ordinal(count) : ''} ${letter} ${what}`;
  if (ev.length < count) return [err(`${label}: ${dir > 0 ? 'the catalogue ends before it' : 'it would be before the catalogue starts'}`)];
  const last = ev[ev.length - 1];
  const isBoundary = phase === 0 || phase === 1;
  // which cycles meet there, in the "ε#5" notation: Up next says "ζ 6 ends 18:27", this says what ends and what starts
  const total = Number(model.clock.count(level));
  const ord = (i) => cycleLabel(level, model.cycleToPath(level, BigInt(i)).at(-1));
  let extra;
  if (isBoundary) {
    const ends = last.idx >= 1 && last.idx <= total ? `${ord(last.idx - 1)} ends` : '';
    const starts = last.idx < total ? `${ord(last.idx)} starts` : 'the catalogue ends';
    extra = [ends, starts].filter(Boolean).join(' · ');
  } else extra = last.idx < total ? `in ${ord(last.idx)}` : '';
  return [make(C, 'boundary', label, isBoundary ? landOn(model, last.t, level) : landOn(model, last.t), { extra })];
}

/** A lone Greek letter / level name: offer its next and previous boundary. */
function recLevelOnly(C) {
  const m = /^(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|[α-ξ])$/.exec(C.lower);
  if (!m) return null;
  const level = levelOfToken(m[1]);
  return [...boundaryCandidates(C, level, 1, 1, 'end'), ...boundaryCandidates(C, level, -1, 1, 'end')];
}

/** First instant after the period (day / month / year) a date-like input names, in the zone or at the explicit offset. */
function periodEnd(x, zone) {
  const { year, month, day } = x.fields;
  const next = x.precision === 'year' ? { year: year + 1, month: 1, day: 1 } : x.precision === 'month' ? addDays(year, month, 1, daysInMonth(year, month)) : addDays(year, month, day, 1);
  return x.offset !== null ? utcSeconds(next.year, next.month, next.day) - x.offset : dayStart(zone, next.year, next.month, next.day);
}

function recGregorian(C) {
  const r = parseGregorian(C.text, { zone: C.zone, ref: refDate(C), dayFirst: C.dayFirst, zoneNames: true });
  if (!r) return null;
  if (r.error) return [err(r.error)];
  return r.results.map((x) => {
    const zone = x.zone ?? C.zone; // a zone named in the text wins over the app zone
    let t = r3(x.t);
    let note = '';
    let problem = rangeProblem(C.model, t);
    if (problem && t < C.model.tMin && !x.hasTime && x.precision !== 'time' && periodEnd(x, zone) > C.model.tMin) {
      // "1613", "May 1613" or "1613-05-19": the period contains the first instant of the catalogue
      const what = x.precision === 'day' ? 'day' : x.precision;
      t = r3(C.model.tMin);
      problem = null;
      note = `the catalogue starts during this ${what} (${utcStamp(C.model.tMin)} UTC): showing its first instant`;
    }
    const when = C.fmt.long(t) + ' ' + C.fmt.tag(t);
    let label = when;
    if (x.precision === 'year') label = `${x.fields.year} · ${when}`;
    else if (x.precision === 'month') label = `${MONTHS_FULL[x.fields.month - 1]} ${x.fields.year} · ${when}`;
    else if (x.precision === 'day' && x.note) label = `${when} (${x.note})`;
    if (problem) {
      const f = x.fields;
      const p2 = (n) => String(n).padStart(2, '0');
      const shown = `${String(f.year).padStart(4, '0')}-${p2(f.month)}-${p2(f.day)}${x.hasTime ? ` ${p2(f.hour)}:${p2(f.minute)}${f.second ? ':' + p2(f.second) : ''}` : ''}`;
      return err(`${shown} is ${problem}`, `Catalogue: ${catalogueRangeText(C.model)} (UTC)`);
    }
    if (x.offset !== null) note = [`input read as UTC${x.offset === 0 ? '' : isoOffset(x.offset)}`, note].filter(Boolean).join(' · ');
    else {
      if (x.zone) note = [`input read in ${x.zone}`, note].filter(Boolean).join(' · ');
      else if (x.hasTime && x.precision !== 'time') note = [`input read in ${C.zone}`, note].filter(Boolean).join(' · ');
      if (x.hasTime) {
        const issue = wallTimeNote(x.fields, zone, t, x.zone ? createFormatter(() => zone) : C.fmt);
        if (issue) note += `${note ? ' · ' : ''}${issue}`;
      }
    }
    return make(C, 'date', label, t, { extra: note, date: false });
  });
}

function recUnix(C) {
  const m = /^(?:(unix|epoch|ts|timestamp|unixtime)\s*[:=]?\s*|@\s*)?(-?\d+(?:\.\d+)?)\s*(ms|s|sec)?$/.exec(C.lower);
  if (!m) return null;
  const explicit = !!m[1] || C.lower.startsWith('@');
  const digits = m[2].replace(/^-/, '').split('.')[0].length;
  if (!explicit && digits < 5) return null;
  let v = Number(m[2]);
  let unit = m[3] === 'ms' ? 'ms' : m[3] ? 's' : digits >= 12 && digits <= 14 ? 'ms' : 's';
  const sec = unit === 'ms' ? v / 1000 : v;
  if (!Number.isFinite(sec) || Math.abs(sec) > 8.64e12) return [err(`${clip(m[2])} is not a valid Unix time`)];
  const t = r3(sec);
  return [make(C, 'unix', unit === 'ms' ? `Unix milliseconds ${clip(m[2])}` : `Unix seconds ${clip(m[2])}`, t)];
}

// ---------------------------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------------------------
const RECOGNIZERS = [recKeyword, recRelative, recState, recGlobal, recPath, recSync, recPosition, recBoundary, recLevelOnly, recGregorian, recUnix];

/**
 * @param {string} text
 * @param {{now:number, real?:number, zone?:string, model:object, fmt?:object, dayFirst?:boolean, level?:number}} opts
 *   dayFirst: false ranks "06/01/2031" as June 1st first (a month-first locale); level: the level "next peak" means
 * @returns {{label:string, time:number|null, kind:string, detail:string, error?:string}[]}
 */
export function parseJump(text, opts = {}) {
  const s = String(text ?? '');
  // A paste of any size answers at once: nothing below runs on more than MAX_INPUT characters.
  if (s.length > MAX_INPUT && s.trim().length > MAX_INPUT) {
    return [err(`That is ${s.trim().length} characters: the jump box reads up to ${MAX_INPUT}`, 'Paste a date, a Unix time, an offset or a cycle address')];
  }
  const raw = normalize(s);
  if (!raw) return [];
  const fmt = opts.fmt ?? createFormatter(() => opts.zone ?? 'UTC');
  const zone = opts.zone ?? fmt.zone();
  const now = r3(opts.now ?? opts.real ?? 0);
  const C = { model: opts.model, fmt, zone, now, real: r3(opts.real ?? now), text: raw, lower: raw.toLowerCase(), dayFirst: opts.dayFirst, level: Number.isInteger(opts.level) && opts.level >= 0 && opts.level < 14 ? opts.level : undefined };
  const good = [];
  const bad = [];
  for (const rec of RECOGNIZERS) {
    let items;
    try {
      items = rec(C);
    } catch (e) {
      // (a RangeError is the engine refusing a date or number far outside anything meaningful)
      items = [err(e instanceof RangeError ? `${clip(raw)} is out of range` : clip(String(e?.message ?? e), 120))];
    }
    if (!items) continue;
    for (const it of items) (it.kind === 'error' ? bad : good).push(it);
  }
  if (good.length) {
    // the same instant by two routes is one candidate
    const seen = new Set();
    return good.filter((c) => {
      const key = c.kind + '|' + c.time;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (bad.length) return bad;
  return [
    err(
      `Cannot read "${clip(raw)}"`,
      `Try 2031-06-01 14:30 · +3d · α#6 β#3 γ#11 · pos 24.5 · sync 4820 · next ε. A time without an offset is read in ${zone.replace(/_/g, ' ')}: add a city or zone (14:30 Tokyo), an offset (+03:00), or change the zone in the header.`,
    ),
  ];
}

export { phaseOfPoint, pointId };
