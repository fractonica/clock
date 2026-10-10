/**
 * Pure-mode jump grammar (no DOM, no Earth units): parsePure(text, {model, pure, now, real, level}) turns what a
 * person types into ranked candidate moments, speaking Fractonica only (docs/design/80-pure.md, REVISION 2).
 *
 *   names          Gamma Difracton · Gamma Difracton in Beta Tetrafracton · Alpha Hexafracton Beta Tetrafracton
 *   addresses      α#6 β#4 γ#9 · α6 β3 γ11 · a6 b3 g11 · 6.3.11 · ε#5 (ancestors from the shown moment) · d7#717211
 *   stamps         α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#5 · 3η 17ι 21λ — exactly what the header prints, or any tail of it
 *                  (the old spellings δ 3 · ζ 6 · η 5 · ι 17 are still read; so is the clock the header shows: 3η17ι21λ)
 *   offsets        +2ζ 3η · -1ι · in 5λ · 3η ago · +0.5ν · +4 Blinks · +2 Hadrons 3 Helions (every unit α … ν)
 *
 * UNIT NAMES (core/pure.js `UNITS`): Atom δ, Nuclide ε, Hadron ζ, Helion η, Quark θ, Preon ι, Chromon κ, Flavon λ, Somon μ,
 * Blink ν (plural with an s) are read wherever a unit letter is: offsets, boundaries, a lone unit. Alpha, Beta and Gamma
 * have no particle name and stay level names. Unit names are not cycle names: "Gamma Difracton" is the 2nd γ in its β.
 * The half-cycle units are gone (revision 2): "δ½ 3", "ζ½", "next ζ½" are answered with one short pointer to whole cycles.
 *
 * Notation (core/pure.js): X#n is an ordinal counted from 1, nX a count of units counted from 0. A bare clock reading
 * "3η 17ι 21λ" can be the counters of the current ζ or a span after the shown moment: the counters come first (the
 * header prints them), the span is the second candidate. The clock is η ι λ; ν counts are spans, never clock entries.
 *   position       pos 22.9278 · p22.9278 · saros 22.9 · 22 + 0.9278
 *   sync           sync 4820 · S4820 node
 *   boundaries     next ε · prev ζ · next Helion · next end of δ · next peak η · next peak (the selected depth)
 *   odometer       η [13,0] · d7 13,0 · η 13·4 (the glyph pair)
 *   now            now · live
 *
 * Anything that is an Earth calendar or clock input (a date, a clock time, "+3d", a city, "tomorrow", Unix seconds) is
 * answered with one short message instead of being read. Every candidate is {label, time, kind, detail}; failures are
 * {kind:'error', time:null, error}. Candidates are best first; errors only come back when nothing else parsed.
 */
import { LEVEL_NAMES, ORDINAL_NAMES, UNITS } from '../../core/pure.js';
import { LETTERS, POINTS, an, chainText, childCount, clip, cycleLabel, cycleOfPath, ordinal, pathOfTime, pathText, pointOfCycle, r3, syncRange } from './convert.js';
import { MAX_INPUT, eventsAround, levelOfToken, mentionsZone, parseGregorian, phaseOfPoint, pointId, tokenizePath } from './parse.js';
import { LADDER, entriesText, firstMs, landCycleAt, landPoint, ladderRanges, madeOf, resolveParts, spanText, stampSym, unitById } from './pure-conv.js';

export { MAX_INPUT };

/** Placeholder of the header box in pure mode. */
export const PURE_PLACEHOLDER = 'Jump to…  Gamma Difracton · α#6 β#3 γ#11 · +2ζ 3η · next ε · pos 24.5';

/** Examples offered while the pure box is empty and there is no history. */
export function pureExamples() {
  return [
    ['Gamma Difracton', 'the 2nd γ inside the current β'],
    ['α#6 β#4 γ#9', 'start of a cycle by its address (#6 = the 6th inside its parent)'],
    ['δ#3 · ε#2 · ζ#5', 'a date, as the header prints it (the rest comes from the shown moment)'],
    ['3η 17ι 21λ', 'the clock: completed η, ι, λ inside the shown ζ (counters count from 0)'],
    ['+2ζ 3η', 'two ζ and three η after the shown moment'],
    ['+4 Blinks', 'four Blinks (ν) after the shown moment'],
    ['next Helion', 'the next η boundary (a Helion is one η cycle)'],
    ['pos 24.5', 'Saros position'],
    ['sync 4820', 'start of a solar sync'],
    ['η [13,0]', 'next time depth 7 shows [13, 0]'],
  ];
}

const HELP = 'Gamma Difracton · α#6 β#3 γ#11 · ζ#5 · +2ζ 3η · +4 Blinks · next ε · pos 24.5 · sync 4820';
/** The tail of every help line: where the notation is explained. */
const GLOSSARY = 'Counters count from 0, # numbers from 1. Press ? for the glossary.';
const POINT_WORDS = 'begin|start|peak|node|valley|end|mid|middle';
const DEPTH_ALT = '(?:depth|d)\\s*\\d{1,2}';
const LEVEL_WORDS = LEVEL_NAMES.slice(0, 14).map((name) => name.toLowerCase());
const LEVEL_WORD_ALT = LEVEL_WORDS.join('|');
/**
 * Unit names (Atom … Blink, with an optional plural s) -> depth level. Only the units that have a particle name: α β γ
 * stay level names (the ten names are the `name` of `UNITS` in core/pure.js, edit them there).
 */
const UNIT_WORDS = new Map(UNITS.filter((u) => u.named).map((u) => [u.name.toLowerCase(), u.level]));
const UNIT_WORD_ALT = [...UNIT_WORDS.keys()].sort((a, b) => b.length - a.length).map((w) => `${w}s?`).join('|');
const unitWordLevel = (tok) => UNIT_WORDS.get(tok.replace(/s$/, '')) ?? UNIT_WORDS.get(tok) ?? -1;
/** A depth letter, a level name or a unit name (unit names first: "nuclide" must not be read as "nu" + "clide"). */
const GREEK_ALT = `${UNIT_WORD_ALT}|${LEVEL_WORD_ALT}|[α-ξ]`;
/** Level of a unit letter, a level name or a unit name (-1 when it is none of them). */
const levelOfUnitToken = (tok) => {
  const t = String(tok).toLowerCase();
  const w = unitWordLevel(t);
  return w >= 0 ? w : levelOfToken(t);
};
/** No letter may follow a unit token: "3eta" is a count of η, "3etas" and "3etc" are not. */
const END = '(?![a-zα-ω])';
/** The half-cycle units are gone: "δ½", "ζ½ 5", "delta half 3" (the old spellings) get one pointer instead of a reading. */
const HALF_RE = new RegExp(`(?:[α-ξ]|${LEVEL_WORD_ALT})\\s*(?:½|-\\s*half\\b|\\s+half\\b)`);
const HALF_ANSWER = [
  'Half-cycle units are gone: write δ, ε or ζ',
  'Whole cycles only now: δ (Atom), ε (Nuclide), ζ (Hadron). The date reads δ#3 · ε#2 · ζ#5 and a span +2ζ 3η. Press ? for the glossary.',
];
/** The retired word for a real-time tick (revision 2 counts real time in Blinks): one pointer instead of a reading. */
const RETIRED_RE = /\bbeats?\b/;
const RETIRED_ANSWER = [
  'Real time is counted in Blinks now: write +4 Blinks or +4ν',
  'A Blink (ν) is the atomic unit and the tick of the device clock. Speeds read "θ per Blink", frequencies "pB" (cycles per Blink). Press ? for the glossary.',
];
const pointLabel = (id) => POINTS.find((p) => p.id === id)?.label.toLowerCase() ?? id;

/** Light normalisation: NFC (NFKC would turn ½ into 1⁄2), plain minus, one kind of space. */
export function normalizePure(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[−‒–—―]/g, '-')
    .replace(/1⁄2/g, '½')
    .replace(/[  -​  　]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// candidates
// ---------------------------------------------------------------------------------------------
const err = (message, detail = '') => ({ kind: 'error', label: message, time: null, detail, error: message });
const STAMP_UPTO = Object.freeze(['gamma', 'gamma', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'iota', 'iota', 'lambda', 'lambda', 'lambda', 'lambda', 'lambda']);

/** "in 2ζ 3η" / "5λ ago" / "the shown moment": the distance from the shown moment, in positions. */
export function relText(C, t) {
  // (both are whole milliseconds; an offset of a fraction of a Blink is still a different moment)
  if (Math.abs(t - C.now) < 0.0005) return 'the shown moment';
  const text = spanText(C.model, C.pure, Math.min(C.now, t), Math.max(C.now, t));
  return t > C.now ? `in ${text}` : `${text} ago`;
}
/** Where a result sits and how far it is from the shown moment. `upTo` = how deep the stamp goes (a stamp level name). */
export function whenText(C, t, upTo = 'eta') {
  return `${C.pure.stamp(t, upTo)} (${relText(C, t)})`;
}

function make(C, kind, label, t, { extra = '', upTo = 'eta' } = {}) {
  if (!C.model.inRange(t)) return err(`${label} is outside the catalogue`, `The catalogue runs ${C.pure.catalogueText()}`);
  return { kind, label, time: t, detail: [whenText(C, t, upTo), extra].filter(Boolean).join(' · ') };
}
/**
 * "ε lasts 7ζ": the length of a cycle in the next finer units (η = 36ι, ι = 65λ, λ = 25ν follow the clock's counters).
 * Every cycle is exactly one of its own unit, so that would say nothing; the ν cycle is the finest and says nothing.
 */
function lastsText(C, level, clipped = false) {
  const made = madeOf(C.model, C.pure, level);
  if (!made && !clipped) return '';
  return `${LETTERS[level]} lasts ${made || '1' + LETTERS[level]}${clipped ? ' (clipped by the catalogue end)' : ''}`;
}
const outsideNote = (C) => `The catalogue runs ${C.pure.catalogueText()}`;

// ---------------------------------------------------------------------------------------------
// Earth-clock input: answered, never read
// ---------------------------------------------------------------------------------------------
const EARTH_UNIT = /(?:^|[\s+\-(])\d+(?:[.,]\d+)?\s*(?:ms|msec|msecs|s|sec|secs|seconds?|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?|mo|mos|months?|y|yr|yrs|years?)(?![a-zα-ω])/i;
const EARTH_WORD = /\b(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|today|tomorrow|yesterday|noon|midnight|utc|gmt|unix|epoch|timestamp|iso|am|pm|tonight|morning|evening)\b/i;
const EARTH_DATE = /\b\d{1,2}:\d{2}|\b\d{4}-\d{1,2}(?:-\d{1,2})?\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b|^\d{6,}$/i;
/** Does this read like a date, a clock time, an Earth-unit offset, a city or a Unix time? */
export function looksEarthly(raw) {
  const s = normalizePure(raw);
  if (!s) return false;
  if (EARTH_DATE.test(s) || EARTH_WORD.test(s) || EARTH_UNIT.test(s)) return true;
  try {
    if (parseGregorian(s, { zone: 'UTC', ref: { year: 2000, month: 1, day: 1 }, zoneNames: true })) return true;
  } catch {
    /* a RangeError from a silly date is still an Earth date */
    return true;
  }
  return mentionsZone(s);
}
const earthAnswer = () => [err('Dates and clock times are off in pure mode', `This instrument is read in cycles, names, addresses, offsets and positions. Try ${HELP}. ${GLOSSARY}`)];

// ---------------------------------------------------------------------------------------------
// recognizers: each returns null (not mine) or an array of candidates / errors
// ---------------------------------------------------------------------------------------------
function recKeyword(C) {
  if (!/^(?:now|live)$/.test(C.lower)) return null;
  const c = make(C, 'relative', 'Now (the live clock)', C.real);
  if (c.kind !== 'error') c.live = true;
  return [c];
}

// ---- offsets: +2ζ 3η, +4 Blinks ---------------------------------------------------------------
const TERM = new RegExp(`\\s*(\\d+(?:\\.\\d+)?)\\s*(${GREEK_ALT})${END}\\s*,?\\s*(?:and\\s+)?`, 'y');
function parseTerms(s) {
  const out = [];
  let used = 0;
  for (;;) {
    TERM.lastIndex = used;
    const m = TERM.exec(s);
    if (!m || m.index !== used) break;
    out.push({ n: Number(m[1]), tok: m[2], text: m[0].trim() });
    used = TERM.lastIndex;
    if (used >= s.length) break;
  }
  return out.length && used >= s.trimEnd().length ? out : null;
}
/** The unit of a term: every depth from α to ν is a unit; ξ and finer are decimals of a Blink. */
function unitOfTerm(C, term) {
  const level = levelOfUnitToken(term.tok);
  if (level < 0) return { error: `"${term.tok}" is not a unit` };
  const sym = LETTERS[level];
  const u = UNITS.find((x) => x.level === level);
  if (u) return { unit: u };
  return { error: `${sym} is finer than a Blink: count it as a decimal of ν`, detail: `One ${sym} cycle is ${C.pure.cycleLength(level)}, e.g. +${C.pure.cycleLength(level)}` };
}
function recOffset(C) {
  let s = C.lower;
  let sign = null;
  let m;
  if ((m = /^in\s+(.+)$/.exec(s))) {
    sign = 1;
    s = m[1];
  } else if ((m = /^(.+?)\s+(?:ago|before)$/.exec(s))) {
    sign = -1;
    s = m[1];
  } else if ((m = /^(.+?)\s+(?:later|after|ahead)$/.exec(s))) {
    sign = 1;
    s = m[1];
  }
  const lead = /^([+-])\s*(.+)$/.exec(s);
  if (lead) {
    sign = (sign ?? 1) * (lead[1] === '-' ? -1 : 1);
    s = lead[2];
  }
  if (/^\d+(?:\.\d+)?$/.test(s) && sign !== null && s.replace('.', '').length <= 5) return [err('Add a unit to the offset', 'e.g. +2ζ 3η · -1ι · in 5λ · 3η ago · +4 Blinks')];
  const terms = parseTerms(s);
  if (!terms) return null;
  // "3η 17ι 21λ" with no sign is also the clock the header prints: the counters are the first reading, the span the second
  const clockLike = sign === null && isClockChain(C, terms);
  if (sign === null) sign = 1; // "2ζ 3η" is a span as the instrument writes it: read as "after"
  if (terms.length > 8) return [err('At most 8 terms in an offset')];
  let dpos = 0;
  const shown = [];
  for (const term of terms) {
    const r = unitOfTerm(C, term);
    if (r.error) return [err(r.error, r.detail ?? '')];
    dpos += term.n * C.pure.unitPos(r.unit);
    shown.push(`${term.n}${r.unit.sym}`);
  }
  const label = `${sign < 0 ? '−' : '+'}${clip(shown.join(' '), 32)} from the shown moment`;
  const p0 = C.model.positionOf(C.now);
  if (p0 === null) return [err(`${label}: the shown moment is outside the catalogue`, outsideNote(C))];
  const p = p0 + sign * dpos;
  if (!(p >= 0 && p <= C.model.extent)) return [err(`${label} is outside the catalogue`, outsideNote(C))];
  const c = make(C, 'relative', label, r3(C.model.timeOfPosition(p)), { upTo: 'lambda' });
  if (clockLike && c.kind !== 'error') c.rank = 1;
  return [c];
}
/** η, η ι or η ι λ with whole counts inside their ranges: what the header's clock prints. */
function isClockChain(C, terms) {
  if (terms.length < 2 || terms.length > 3) return false;
  const ids = ['eta', 'iota', 'lambda'];
  const R = ladderRanges(C.model, C.pure);
  return terms.every((t, i) => {
    const u = UNITS.find((x) => x.level === levelOfUnitToken(t.tok));
    return !!u && u.id === ids[i] && Number.isInteger(t.n) && t.n <= R[u.id].max;
  });
}

// ---- glyph states: η [13,0] ----------------------------------------------------------------
function parseState(C) {
  const m = new RegExp(`^(?:(next|prev|previous)\\s+)?(${DEPTH_ALT}|${GREEK_ALT})\\s*(.+)$`).exec(C.lower);
  if (!m) return null;
  const bracket = /^[[(]\s*(.*?)\s*[\])]$/.exec(m[3]);
  const body = bracket ? bracket[1] : m[3];
  if (!/^\d{1,3}(?:\s*[,;·\s]\s*\d{1,3})*\s*,?$/.test(body)) return null;
  const digits = body.split(/[,;·\s]+/).filter(Boolean).map(Number);
  const depthForm = new RegExp(`^${DEPTH_ALT}$`).test(m[2]);
  if (!bracket && !body.includes(',') && !body.includes('·') && !(depthForm && digits.length >= 2)) return null;
  return { dir: m[1] ? (m[1] === 'next' ? 1 : -1) : 1, levelTok: m[2], digits };
}
function levelOfDepthToken(tok) {
  const m = /^(?:depth|d)\s*(\d{1,2})$/.exec(tok);
  if (m) {
    const d = Number(m[1]);
    return d >= 1 && d <= 14 ? d - 1 : -2;
  }
  return levelOfUnitToken(tok);
}
function recState(C) {
  const st = parseState(C);
  if (!st) return null;
  const level = levelOfDepthToken(st.levelTok);
  if (level === -2) return [err('Depth must be between 1 and 14')];
  if (level < 0) return null;
  const { model } = C;
  const tc = model.clamp(C.now);
  for (const d of st.digits) if (d > 15) return [err(`Digit ${d} is too large: two-stroke glyphs have 16 states, numbered 0–15`)];
  const names = st.digits.join('·');
  const out = [];
  for (const direction of st.dir >= 0 ? [1, -1] : [-1, 1]) {
    let occ;
    try {
      occ = model.stateOccurrences(level, st.digits, tc, { direction, count: 1 });
    } catch (e) {
      return [err(String(e.message ?? e))];
    }
    const label = `${direction > 0 ? 'Next' : 'Previous'} time ${LETTERS[level]} shows ${names}`;
    if (!occ.length) {
      out.push(err(`${label}: none inside the catalogue`));
      continue;
    }
    const o = occ[0];
    const shows = (c) => model.odometerAt(c, level, { digits: st.digits.length })?.digits.join() === st.digits.join();
    const t = firstMs(o.start, shows) ?? Math.ceil(o.start * 1000) / 1000;
    out.push(make(C, 'state', label, t, { extra: `lasts ${C.pure.duration(o.end - o.start, { at: o.start })}`, upTo: STAMP_UPTO[level] }));
  }
  return out;
}

// ---- global index: d7#717211 ----------------------------------------------------------------
function recGlobal(C) {
  const m = new RegExp(`^(${DEPTH_ALT})\\s*#\\s*(\\d+)(?:\\s+(${POINT_WORDS}))?$`).exec(C.lower);
  if (!m) return null;
  const level = levelOfDepthToken(m[1]);
  if (level === -2) return [err('Depth must be between 1 and 14')];
  if (level < 0) return null;
  const { model, pure } = C;
  const idx = BigInt(m[2]);
  const count = model.clock.count(level);
  if (idx >= count) return [err(`${LEVEL_NAMES[level]} has only ${count} cycles in the catalogue (d${level + 1}#0 … d${level + 1}#${count - 1n})`, 'The number after the # is the 0-based index counted over the whole catalogue')];
  const pid = pointId(m[3] ?? 'begin');
  const t = pointOfCycle(model, level, Number(idx), phaseOfPoint(pid));
  if (t === null) return [err(`The ${pointLabel(pid)} of this ${LETTERS[level]} cycle lies beyond the end of the catalogue`)];
  const path = model.cycleToPath(level, idx);
  const label = `${LETTERS[level]} global index ${idx} · ${pathText(path)}${pid === 'begin' ? '' : ' · ' + pointLabel(pid)}`;
  const c = model.cycleByIndex(level, idx);
  return [make(C, 'cycle', label, landPoint(model, level, Number(idx), phaseOfPoint(pid)), { extra: lastsText(C, level, c.clipped), upTo: STAMP_UPTO[level] })];
}

// ---- names, addresses and stamps ------------------------------------------------------------
const NAME_RE = new RegExp(`\\b(${LEVEL_WORD_ALT})[\\s-]+(${ORDINAL_NAMES.slice(1).map((s) => s.toLowerCase()).join('|')})\\b`, 'g');
/** "gamma difracton in beta tetrafracton" -> "β#4 γ#2" (names become hashed ordinals, "in" reverses the order). */
export function namesToAddress(lower) {
  let had = false;
  let s = lower.replace(NAME_RE, (_, lv, ord) => {
    had = true;
    return `${LETTERS[LEVEL_WORDS.indexOf(lv)]}#${ORDINAL_NAMES.findIndex((n) => n.toLowerCase() === ord)}`;
  });
  const parts = s.split(/\s+(?:in|of|within|inside)\s+/);
  if (parts.length > 1 && parts.every((p) => /^(?:[α-ξ]#\d+\s*)+$/.test(p.trim()))) s = parts.reverse().join(' ');
  return { text: s, had };
}

// "δ#3" "ζ 5" "η 3" "ε#5": the letter first (an ordinal, or an old-style counter)
const STAMP_LETTER = new RegExp(`\\s*(${LEVEL_WORD_ALT}|[α-ξ])${END}\\s*(#?)\\s*(\\d+)`, 'y');
// "3η" "17ι" "0η29ι21λ" "3 Helions": the count first (the clock counters as the header prints them)
const STAMP_COUNT = new RegExp(`\\s*(\\d+)\\s*(${GREEK_ALT})${END}`, 'y');
/** Tokens of a stamp / address text, or null when something else is in it. */
function tokenizeStamp(s) {
  const body = s.replace(/[›»>·|,]/g, ' ').replace(/\s+/g, ' ').trim();
  const toks = [];
  let pos = 0;
  while (pos < body.length) {
    STAMP_LETTER.lastIndex = pos;
    let m = STAMP_LETTER.exec(body);
    if (m && m.index === pos) {
      const level = levelOfToken(m[1]);
      if (level < 0) return null;
      toks.push({ level, hashed: m[2] === '#', n: Number(m[3]), count: false });
      pos = STAMP_LETTER.lastIndex;
      continue;
    }
    STAMP_COUNT.lastIndex = pos;
    m = STAMP_COUNT.exec(body);
    if (!m || m.index !== pos) return null;
    const level = levelOfUnitToken(m[2]);
    if (level < 0) return null;
    toks.push({ level, hashed: false, n: Number(m[1]), count: true });
    pos = STAMP_COUNT.lastIndex;
  }
  return toks.length ? toks : null;
}
/** The clock counters (depth levels of η ι λ) and the date ordinals (α … ζ) a stamp is made of. */
const COUNTER_LEVELS = { 6: 'eta', 8: 'iota', 10: 'lambda' };
const DATE_LEVELS = { 0: 'alpha', 1: 'beta', 2: 'gamma', 3: 'delta', 4: 'epsilon', 5: 'zeta' };

/** Stamp tokens -> LADDER parts, or {error}; null when the tokens are an ordinary cycle address (no counters). */
function stampParts(toks) {
  // a count-first token ("3η") is a clock counter; "ζ#5" / "ζ 5" is the ordinal; "η 3" (old) is a counter, "η#4" the 4th η
  const kinds = toks.map((t) => (t.count ? 'count' : !t.hashed && COUNTER_LEVELS[t.level] ? 'counter' : 'ord'));
  if (!kinds.includes('counter') && !kinds.includes('count')) return null;
  const parts = [];
  for (const [i, t] of toks.entries()) {
    const sym = LETTERS[t.level];
    if (kinds[i] === 'count') {
      if (!COUNTER_LEVELS[t.level]) return { error: `${t.n}${sym} is a count of units, not a stamp entry`, detail: `A stamp writes an ordinal as ${sym}#${t.n}; the clock counts η ι λ: 3η 17ι 21λ. A span after the shown moment starts with + : +${t.n}${sym}` };
      parts.push({ id: COUNTER_LEVELS[t.level], n: t.n });
    } else if (kinds[i] === 'counter') parts.push({ id: COUNTER_LEVELS[t.level], n: t.n });
    else if (COUNTER_LEVELS[t.level]) {
      if (t.n < 1) return { error: `${sym}# numbers start at 1`, detail: `${sym}#1 is the first; the clock counts completed units from 0: 0${sym}` };
      parts.push({ id: COUNTER_LEVELS[t.level], n: t.n - 1 }); // η#4 is the 4th η, the counter 3
    } else if (DATE_LEVELS[t.level]) {
      if (t.n < 1) return { error: `${sym}# numbers start at 1`, detail: `${sym}#1 is the first` };
      parts.push({ id: DATE_LEVELS[t.level], n: t.n });
    } else return { error: `${sym}#${t.n} is not part of a stamp: the clock counts η, ι and λ`, detail: 'Write cycles as α#6 β#4 γ#9 δ#3, the date as δ#3 · ε#2 · ζ#5, the clock as 3η 17ι 21λ' };
  }
  return { parts };
}
function recStamp(C, parts) {
  const r = resolveParts(C.model, C.pure, parts, C.now);
  if (r.error) return [err(r.error, r.detail ?? '')];
  const finestIdx = LADDER.indexOf(parts[parts.length - 1].id);
  const firstIdx = LADDER.indexOf(parts[0].id);
  const upTo = LADDER[finestIdx]; // (the ids of the ladder are the level names pure.stamp takes)
  const full = C.pure.stamp(r.t, upTo);
  const given = entriesText(parts);
  const parent = firstIdx === LADDER.indexOf('eta') ? 'ζ' : stampSym(LADDER[firstIdx - 1]);
  const label = firstIdx > 0 ? `${given} in the current ${parent}` : full;
  return [make(C, 'cycle', label, r.t, { upTo })];
}

function pathCandidates(C, tok) {
  const { model, pure } = C;
  const { levels, nums } = tok;
  const first = levels[0];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] !== levels[i - 1] + 1) {
      if (levels[i] > levels[i - 1]) return [err(`${LEVEL_NAMES[levels[i - 1] + 1]} is missing between ${LEVEL_NAMES[levels[i - 1]]} and ${LEVEL_NAMES[levels[i]]}`, 'Write consecutive levels, e.g. α#6 β#3 γ#11')];
      return [err('Write the levels from the longest to the shortest, e.g. α#6 β#3 γ#11')];
    }
  }
  let prefix = [];
  if (first > 0) {
    if (!model.inRange(C.now)) return [err('The shown moment is outside the catalogue, so the enclosing cycles are unknown', 'Start the address with α, e.g. α#6 β#3')];
    prefix = pathOfTime(model, C.now, first);
  }
  const path = [...prefix];
  for (let i = 0; i < nums.length; i++) {
    const level = first + i;
    const n = nums[i];
    if (n < 1) return [err(`${LEVEL_NAMES[level]} numbers start at 1`)];
    if (level === 0) {
      const count = Number(model.clock.count(0));
      if (n > count) return [err(`The catalogue holds only ${count} Alpha cycles (${cycleLabel(0, 1)} … ${cycleLabel(0, count)})`, pure.catalogueText())];
    } else {
      const sib = model.levelInfo(level).siblings;
      const parent = LEVEL_NAMES[level - 1];
      if (n > sib) {
        const hint = tok.hashed ? ` · for a global cycle index write d${level + 1}#${n}` : '';
        return [err(`${LEVEL_NAMES[level]} has only ${sib} cycles in ${an(parent)} ${parent}`, `${cycleLabel(level, 1)} … ${cycleLabel(level, sib)}${hint}`)];
      }
    }
    path.push(n);
    if (model.pathToCycle(path) === null) {
      const maxHere = childCount(model, path.slice(0, -1));
      return [err(`${pathText(path)} starts after the catalogue ends`, maxHere ? `${LEVEL_NAMES[level]} goes up to ${maxHere} here, the last cycles are clipped` : '')];
    }
  }
  const level = path.length - 1;
  const cyc = cycleOfPath(model, path);
  const pid = tok.point ?? 'begin';
  const t = pointOfCycle(model, level, cyc.idx, phaseOfPoint(pid));
  if (t === null) return [err(`The ${pointLabel(pid)} of ${pathText(path)} lies beyond the end of the catalogue`, 'The last cycle is clipped by the catalogue end')];
  // the cycle named in words ("Gamma Difracton in the current Beta"); a full address from α reads as its chain of names
  const names = path.slice(first).map((n, i) => pure.periodName(first + i, n));
  let label = names.join(' › ');
  if (prefix.length) label = `${label} in the current ${LEVEL_NAMES[first - 1]}`;
  if (pid !== 'begin') label += ' · ' + pointLabel(pid);
  const lasts = lastsText(C, level, cyc.clipped);
  // the ordinal chain is shown when the stamp above it (halves and counters) does not already say it
  const chain = prefix.length ? chainText(path.slice(first), first) : level >= 3 ? pathText(path) : '';
  const extra = [chain, lasts].filter(Boolean).join(' · ');
  return [make(C, 'cycle', label, landPoint(model, level, cyc.idx, phaseOfPoint(pid)), { extra, upTo: STAMP_UPTO[level] })];
}

/** The cycle of `level` running at the shown moment, as a depth chip "ζ 6" shows it (its start). */
function runningCycle(C, level) {
  const { model, pure } = C;
  const cur = model.inRange(C.now) ? model.levelAt(C.now, level) : null;
  if (!cur) return null;
  const label = `The running ${LETTERS[level]} (depth ${level + 1})`;
  const extra = [pure.cycleName(level, cur.cycle), cycleLabel(level, cur.local + 1), lastsText(C, level)].filter(Boolean).join(' · ');
  return make(C, 'cycle', label, landPoint(model, level, cur.cycle, 0), { extra, upTo: STAMP_UPTO[level] });
}

function recAddress(C) {
  const { text, had } = namesToAddress(C.lower);
  const hasGreek = new RegExp(GREEK_ALT).test(text) && /\d/.test(text);
  if (!had && !hasGreek && !/^[a-z]\d|^\d+(?:\.\d+)+$/.test(text)) return null;
  const toks = hasGreek || had ? tokenizeStamp(text) : null;
  if (toks) {
    const sp = stampParts(toks);
    if (sp?.error) return [err(sp.error, sp.detail ?? '')];
    if (sp?.parts) return recStamp(C, sp.parts);
  }
  const tok = tokenizePath(text);
  if (!tok) {
    if (had) return [err(`Cannot read "${clip(C.text)}" as a cycle name`, 'Name the level and the ordinal: Gamma Difracton · Epsilon Pentafracton')];
    return null;
  }
  const out = pathCandidates(C, tok);
  // "ζ 6" is also what a depth chip prints for the ζ that is running now: offer that reading second
  if (tok.spaced && tok.nums[0] === tok.levels[0] + 1) {
    const running = runningCycle(C, tok.levels[0]);
    if (running) out.push(running);
  }
  return out;
}

// ---- sync and position -----------------------------------------------------------------------
function recSync(C) {
  const m = new RegExp(`^(?:sync|solar(?:\\s*sync)?|s)\\s*#?\\s*(-?\\d+)(?:\\s+(${POINT_WORDS}))?$`).exec(C.lower);
  if (!m) return null;
  const n = Number(m[1]);
  const { model, pure } = C;
  const s = Number.isSafeInteger(n) ? model.solarSyncByNumber(n) : null;
  if (!s) {
    const r = syncRange(model);
    return [err(`Solar sync ${clip(m[1], 24)} is not inside the catalogue`, `Syncs ${r.first} … ${r.last}`)];
  }
  const pid = pointId(m[2] ?? 'begin');
  const phase = pid === 'begin' ? 0 : phaseOfPoint(pid);
  const t = s.start + phase * (s.end - s.start);
  const where = pid === 'begin' ? 'start' : pointLabel(pid);
  const extra = `drift ${pure.driftText(s)}`;
  return [make(C, 'sync', `Solar sync ${n} · ${where}`, pid === 'begin' ? landCycleAt(model, t, 6) : Math.ceil(t * 1000) / 1000, { extra, upTo: 'iota' })];
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
  if (k > model.extent || (k === model.extent && f > 0)) return [err(`Position must be between 0 and ${model.extent}`, `The catalogue holds ${model.extent} Saros intervals (${C.pure.catalogueText()})`)];
  const t = k === model.extent ? model.tMax : model.catalogue[k] + f * (model.catalogue[k + 1] - model.catalogue[k]);
  return [make(C, 'position', `Saros position ${k}${f ? frac.slice(1) : ''}`, r3(t), { extra: `eclipse ${C.pure.eclipseName(k)} + ${frac}`, upTo: 'iota' })];
}

// ---- boundaries: next ε, prev ζ, next Helion ---------------------------------------------------
function recBoundary(C) {
  const bare = new RegExp(`^(next|prev|previous|last|after|before)\\s*(\\d+)?\\s*(${POINT_WORDS})$`).exec(C.lower);
  if (bare) {
    if (C.level === undefined) return [err(`"${clip(C.text)}" needs a level`, 'Name it: next peak η · next node ζ · next end of δ')];
    const dir0 = bare[1] === 'next' || bare[1] === 'after' ? 1 : -1;
    return boundaryCandidates(C, C.level, dir0, bare[2] ? Math.max(1, Math.min(500, Number(bare[2]))) : 1, pointId(bare[3]));
  }
  const re = new RegExp(`^(next|prev|previous|last|after|before)\\s*(\\d+)?\\s*(?:(${POINT_WORDS})\\s*(?:of\\s*)?)?(${DEPTH_ALT}|${GREEK_ALT}|[a-z])${END}\\s*(?:(${POINT_WORDS}))?$`);
  const m = re.exec(C.lower);
  if (!m) return null;
  const level = levelOfDepthToken(m[4]);
  if (level === -2) return [err('Depth must be between 1 and 14')];
  if (level < 0) return null;
  const dir = m[1] === 'next' || m[1] === 'after' ? 1 : -1;
  const count = m[2] ? Math.max(1, Math.min(500, Number(m[2]))) : 1;
  const word = m[3] ?? m[5] ?? null;
  return boundaryCandidates(C, level, dir, count, word ? pointId(word) : 'end');
}
function boundaryCandidates(C, level, dir, count, pid) {
  const { model, pure } = C;
  if (!model.inRange(C.now)) return [err('The shown moment is outside the catalogue, so there is no next or previous cycle', outsideNote(C))];
  const letter = LETTERS[level];
  const phase = pid === 'end' ? 1 : pid === 'begin' ? 0 : phaseOfPoint(pid);
  const ev = eventsAround(model, C.now, level, dir, count, phase);
  const what = pid === 'end' || pid === 'begin' ? 'boundary' : pointLabel(pid);
  const label = `${dir > 0 ? 'Next' : 'Previous'}${count > 1 ? ' ' + ordinal(count) : ''} ${letter} ${what}`;
  if (ev.length < count) return [err(`${label}: ${dir > 0 ? 'the catalogue ends before it' : 'it would be before the catalogue starts'}`)];
  const last = ev[ev.length - 1];
  const isBoundary = phase === 0 || phase === 1;
  const total = Number(model.clock.count(level));
  // the first millisecond that shows it
  const t = landPoint(model, level, last.idx, phase === 1 ? 0 : phase);
  let extra;
  if (isBoundary) {
    const ord = (i) => cycleLabel(level, model.cycleToPath(level, BigInt(i)).at(-1));
    const ends = last.idx >= 1 && last.idx <= total ? `${ord(last.idx - 1)} ends` : '';
    const starts = last.idx < total ? `${pure.cycleName(level, last.idx)} begins` : 'the catalogue ends';
    extra = [ends, starts].filter(Boolean).join(' → ');
  } else extra = last.idx < total ? `in ${pure.cycleName(level, last.idx)}` : '';
  return [make(C, 'boundary', label, t, { extra, upTo: STAMP_UPTO[level] })];
}
/** A lone depth letter, level name or unit name ("ε", "Helion"): offer its next and previous boundary. */
function recLevelOnly(C) {
  const m = new RegExp(`^(${GREEK_ALT})$`).exec(C.lower);
  if (!m) return null;
  const level = levelOfUnitToken(m[1]);
  return [...boundaryCandidates(C, level, 1, 1, 'end'), ...boundaryCandidates(C, level, -1, 1, 'end')];
}

// ---------------------------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------------------------
const RECOGNIZERS = [recKeyword, recOffset, recState, recGlobal, recAddress, recSync, recPosition, recBoundary, recLevelOnly];

/**
 * @param {string} text
 * @param {{model:object, pure:object, now:number, real?:number, level?:number}} opts
 *   now = the shown moment (offsets and missing ancestors hang off it); real = the device clock (for "now");
 *   level = the depth "next peak" means
 * @returns {{label:string, time:number|null, kind:string, detail:string, error?:string, live?:boolean}[]}
 */
export function parsePure(text, opts = {}) {
  const s = String(text ?? '');
  if (s.length > MAX_INPUT && s.trim().length > MAX_INPUT) {
    return [err(`That is ${s.trim().length} characters: the jump box reads up to ${MAX_INPUT}`, 'Paste a name, an address, a stamp or an offset')];
  }
  const raw = normalizePure(s);
  if (!raw) return [];
  // the half-cycle units are gone: one pointer to whole cycles, whatever else the text says
  if (HALF_RE.test(raw.toLowerCase())) return [err(HALF_ANSWER[0], HALF_ANSWER[1])];
  if (RETIRED_RE.test(raw.toLowerCase())) return [err(RETIRED_ANSWER[0], RETIRED_ANSWER[1])];
  const now = r3(opts.now ?? opts.real ?? 0);
  const C = {
    model: opts.model,
    pure: opts.pure,
    now,
    real: r3(opts.real ?? now),
    text: raw,
    lower: raw.toLowerCase(),
    level: Number.isInteger(opts.level) && opts.level >= 0 && opts.level < 14 ? opts.level : undefined,
  };
  const good = [];
  const bad = [];
  for (const rec of RECOGNIZERS) {
    let items;
    try {
      items = rec(C);
    } catch (e) {
      items = [err(e instanceof RangeError ? `${clip(raw)} is out of range` : clip(String(e?.message ?? e), 120))];
    }
    if (!items) continue;
    for (const it of items) (it.kind === 'error' ? bad : good).push(it);
  }
  if (good.length) {
    const seen = new Set();
    // (candidates are best first; `rank` demotes a reading that is only the second guess, the order inside a rank is kept)
    return good.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).filter((c) => {
      const key = c.kind + '|' + c.time;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (bad.length) return bad;
  if (looksEarthly(raw)) return earthAnswer();
  return [err(`Cannot read "${clip(raw)}"`, `Try ${HELP}. ${GLOSSARY}`)];
}

export { unitById };
