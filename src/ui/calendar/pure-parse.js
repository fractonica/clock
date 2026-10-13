/**
 * Pure-mode jump grammar (no DOM, no Earth units): parsePure(text, {model, pure, now, real, level}) turns what a
 * person types into ranked candidate moments, speaking Fractonica only (SPEC §15, docs/design/80-pure.md, revision 3).
 *
 *   dates          all four forms, or any tail of them (the periods above the first entry come from the shown moment):
 *                    full words     Alpha Hexafracton Valley, Beta Tetrafracton Valley, …, Delta Trifracton End, ε#5 33η 29ι
 *                    short words    Delta Trifracton End ε#5 33η 29ι
 *                    letters        α#6 β#4 γ#9 δ#3 ε#5 33η 29ι 21λ 3ν          (the stamp)
 *                    short letters  δ#3 ε#5 33η 29ι
 *                  partial names ("Gamma Difracton", "Delta Trifracton"), the Nuclide and counts ("ε#2 5η"), counts alone
 *                  ("5η 17ι", inside the shown Nuclide). A quarter word (Peak Node Valley End) on a major period is checked
 *                  against the rest; on the finest entry it is the start of that quarter: "Delta Trifracton Node" is where
 *                  the Node quarter of Delta Trifracton begins (its peak).
 *   addresses      a6 b4 g9 · 6.4.9 · d7#717211 (global index) · "ζ 6" (a depth chip: the running ζ)
 *   offsets        +2ε 5η · -3ι · in 5λ · 3η ago · +0.5ν · +4 Blinks · +2 Nuclides 5 Helions (units α β γ δ ε η ι λ ν)
 *   boundaries     next ε · prev η · next Helion · next Delta · next Delta node · next node of Delta · next peak η ·
 *                  next ζ (a boundary of that depth) · next peak (the selected depth)
 *   position       pos 22.9278 · p22.9278 · saros 22.9 · 22 + 0.9278
 *   sync           sync 4820 · S4820 node
 *   odometer       η [13,0] · d7 13,0 · η 13·4 (the glyph pair; major periods have none, they say a quarter word)
 *   now            now · live
 *
 * UNIT NAMES (core/pure.js `UNITS`): Alpha Beta Gamma Delta (major periods, also level names), Nuclide ε, Helion η, Preon ι,
 * Flavon λ, Blink ν (with a plural s) are read wherever a unit letter is: offsets, boundaries, a lone unit. Only the four
 * major periods have fracton names.
 *
 * Old forms get one short pointer each, whose own text passes the leak scanner: the half-cycle units, the depths that are
 * no units any more used as units (+2ζ, ζ#5: "a ζ is 11η"), the retired unit names, fracton names of minor levels, the
 * retired word for a real-time tick. Anything that is an Earth calendar or clock input (a date, a clock time, "+3d", a city,
 * "tomorrow", Unix seconds) is answered with one short message instead of being read. Every candidate is
 * {label, time, kind, detail}; failures are {kind:'error', time:null, error}. Candidates are best first; errors only come
 * back when nothing else parsed.
 *
 * Notation: X#n is an ordinal counted from 1, nX a count of units counted from 0. A bare clock reading "33η 29ι 21λ" can
 * be the counts of the shown Nuclide or a span after the shown moment: the counts come first, the span second.
 */
import { LEVEL_NAMES, ORDINAL_NAMES, QUARTER_WORDS, UNITS, ordinalName } from '../../core/pure.js';
import { LETTERS, POINTS, clip, ordinal, r3, syncRange, pointOfCycle } from './convert.js';
import { MAX_INPUT, eventsAround, levelOfToken, mentionsZone, parseGregorian, phaseOfPoint, pointId, tokenizePath } from './parse.js';
import { LADDER, LEVEL_OF, MAJOR_IDS, betweenUnit, entriesText, firstMs, isMajorId, landCycleAt, landPoint, ladderRanges, madeOf, resolveParts, spanText, unitById } from './pure-conv.js';

export { MAX_INPUT };

/** Placeholder of the header box in pure mode. */
export const PURE_PLACEHOLDER = 'Jump to…  Delta Trifracton Node · ε#2 5η · +2ε 5η · next Helion · pos 24.5';

/** Examples offered while the pure box is empty and there is no history. */
export function pureExamples() {
  return [
    ['Gamma Difracton', 'start of the 2nd Gamma in the current Beta'],
    ['Delta Trifracton Node', 'where the Node quarter of the 3rd Delta begins'],
    ['Delta Trifracton Node ε#2 20η 12ι', 'a short date: Delta and quarter, Nuclide, Helions, Preons'],
    ['α#6 β#4 γ#9 δ#3 ε#5 33η 29ι', 'the stamp: every period in letters, no quarter words'],
    ['ε#2 5η', 'the 2nd Nuclide of the current Delta, 5 Helions in'],
    ['33η 17ι', 'Helions and Preons counted in the shown Nuclide (counts start at 0)'],
    ['+2ε 5η', 'two Nuclides and five Helions after the shown moment'],
    ['+4 Blinks', 'four Blinks (ν) after the shown moment'],
    ['next Helion', 'the next η boundary'],
    ['next Delta node', 'the next node of a Delta (its Valley quarter begins)'],
    ['pos 24.5', 'Saros position'],
    ['sync 4820', 'start of a solar sync'],
    ['η [13,0]', 'next time the Helion shows the glyph pair 13·0'],
  ];
}

const HELP = 'Delta Trifracton Node · α#6 β#4 γ#9 δ#3 · ε#2 5η · 33η 17ι · +2ε 5η · +4 Blinks · next Helion · pos 24.5 · sync 4820';
/** The tail of every help line: where the notation is explained. */
const GLOSSARY = 'Counts start at 0, # numbers at 1. Press ? for the glossary.';
const POINT_WORDS = 'begin|start|peak|node|valley|end|mid|middle';
const QUARTER_ALT = 'peak|node|valley|end';
const DEPTH_ALT = '(?:depth|d)\\s*\\d{1,2}';
const LEVEL_WORDS = LEVEL_NAMES.slice(0, 14).map((name) => name.toLowerCase());
const LEVEL_WORD_ALT = LEVEL_WORDS.join('|');
const MAJOR_WORD_ALT = LEVEL_WORDS.slice(0, 4).join('|');
const ORDINAL_ALT = ORDINAL_NAMES.slice(1).map((s) => s.toLowerCase()).join('|');
/**
 * Unit names (core `UNITS`, with an optional plural s) -> depth level: alpha beta gamma delta (also level names) and
 * nuclide helion preon flavon blink.
 */
const UNIT_WORDS = new Map(UNITS.map((u) => [u.name.toLowerCase(), u.level]));
const UNIT_WORD_ALT = [...UNIT_WORDS.keys()].sort((a, b) => b.length - a.length).map((w) => `${w}s?`).join('|');
const unitWordLevel = (tok) => UNIT_WORDS.get(tok) ?? UNIT_WORDS.get(tok.replace(/s$/, '')) ?? -1;
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
/** "Delta" for a major level, the letter for the others (labels). */
const levelWord = (level) => (level <= 3 ? LEVEL_NAMES[level] : LETTERS[level]);
const pointLabel = (id) => POINTS.find((p) => p.id === id)?.label.toLowerCase() ?? id;
const quarterOf = (w) => (w ? QUARTER_WORDS.findIndex((q) => q.toLowerCase() === w.toLowerCase()) : -1);
const fmtNum = (x) => String(Number(x.toPrecision(6)));

// ---------------------------------------------------------------------------------------------
// old forms: one pointer each (the text of a pointer never repeats what it points away from)
// ---------------------------------------------------------------------------------------------
const err = (message, detail = '') => ({ kind: 'error', label: message, time: null, detail, error: message });
/** The half-cycle units of revision 1: "δ½", "ζ½ 5", "delta half 3". */
const HALF_RE = new RegExp(`(?:[α-ξ]|${LEVEL_WORD_ALT})\\s*(?:½|-\\s*half\\b|\\s+half\\b)`);
const HALF_ANSWER = ['Half-cycle units are gone: count whole units', 'A Delta is 5 Nuclides (ε#1–5), a Nuclide 77 Helions: write Delta Trifracton, ε#2, 33η. Press ? for the glossary.'];
/** The retired word for a real-time tick (real time is counted in Blinks). */
const BEAT_RE = /\bbeats?\b/;
const BEAT_ANSWER = ['Real time is counted in Blinks now: write +4 Blinks or +4ν', 'A Blink (ν) is the finest unit and the tick of the device clock. Speeds read "4ι per Blink", frequencies "pB" (cycles per Blink). Press ? for the glossary.'];
/** Unit names of revision 2 that are retired, and what to write instead (never echoed). */
const RETIRED_RE = /\b(hadron|quark|chromon|somon|atom)s?\b/;
const RETIRED_HINT = {
  atom: 'That period is the Delta now (δ, 5 Nuclides): write Delta, next Delta, +2δ.',
  hadron: 'That depth (ζ) is not a unit any more: it is 11 Helions, write 11η.',
  quark: 'That depth (θ) is not a unit any more: it is 4 Preons, write 4ι.',
  chromon: 'That depth (κ) is not a unit any more: it is 13 Flavons, write 13λ.',
  somon: 'That depth (μ) is not a unit any more: it is 5 Blinks, write 5ν.',
};
const retiredAnswer = (w) => [err('That unit name is retired: the units are Delta, Nuclide, Helion, Preon, Flavon and Blink', `${RETIRED_HINT[w]} Press ? for the glossary.`)];
/** Fracton names of levels below Delta: only Alpha, Beta, Gamma and Delta have them. */
const MINOR_FRACTON_RE = new RegExp(`\\b(${LEVEL_NAMES.slice(4).map((n) => n.toLowerCase()).join('|')})[\\s-]+(${ORDINAL_ALT}|[a-z]*fracton)\\b`);
function minorFractonAnswer(m) {
  const n = ORDINAL_NAMES.findIndex((o) => o.toLowerCase() === m[2]);
  const hint = m[1] === 'epsilon' && n >= 1 ? `A Nuclide is written by its number: ε#${n}. ` : 'Below the Delta a cycle is placed by counts in its Nuclide: ε#2 5η 9ι. ';
  return [err('Only Alpha, Beta, Gamma and Delta have fracton names', `${hint}Press ? for the glossary.`)];
}
/** A depth that is no unit (ζ θ κ μ) used as one: "a ζ is 11η". */
function betweenAnswer(C, level, n, as) {
  const b = betweenUnit(C.model, level);
  const sym = LETTERS[level];
  if (!b) return err(`${sym} is finer than a Blink: count it as a decimal of ν`, `One ${sym} cycle is ${C.pure.cycleLength(level)}, e.g. +${C.pure.cycleLength(level)}`);
  if (as === 'span') return err(`${sym} is a depth, not a unit: a ${sym} is ${b.n}${b.unit.sym}`, `Write +${fmtNum(n * b.n)}${b.unit.sym} for +${fmtNum(n)}${sym}. The units are α β γ δ ε η ι λ ν (Delta, Nuclide, Helion, Preon, Flavon, Blink).`);
  const parent = UNITS.find((u) => u.level === level - 1);
  const where = Number.isInteger(n) && n >= 1 ? `The ${ordinal(n)} ${sym} of a ${parent.name} begins at ${(n - 1) * b.n}${b.unit.sym}` : `A ${sym} is ${b.n}${b.unit.sym}`;
  return err(`${sym} is a depth, not a unit: count ${b.unit.name}s instead`, `${where} (a ${sym} is ${b.n}${b.unit.sym}); a stamp reads α#6 β#4 γ#9 δ#3 ε#5 33η 29ι`);
}

// ---------------------------------------------------------------------------------------------
// candidates
// ---------------------------------------------------------------------------------------------
/** "in 2ε 5η" / "5λ ago" / "the shown moment": the distance from the shown moment, in positions. */
export function relText(C, t) {
  // (both are whole milliseconds; an offset of a fraction of a Blink is still a different moment)
  if (Math.abs(t - C.now) < 0.0005) return 'the shown moment';
  const text = spanText(C.model, C.pure, Math.min(C.now, t), Math.max(C.now, t));
  return t > C.now ? `in ${text}` : `${text} ago`;
}
/** Where a result sits (its stamp, in letters) and how far it is from the shown moment. */
export function whenText(C, t, upTo = 'eta') {
  return `${C.pure.stamp(t, upTo)} (${relText(C, t)})`;
}

function make(C, kind, label, t, { extra = '', upTo = 'eta' } = {}) {
  if (!C.model.inRange(t)) return err(`${label} is outside the catalogue`, `The catalogue runs ${C.pure.catalogueText()}`);
  return { kind, label, time: t, detail: [whenText(C, t, upTo), extra].filter(Boolean).join(' · ') };
}
/** "ε lasts 77η", "ζ lasts 11η": what one cycle of a level is made of (empty for the Blink). */
function lastsText(C, level, clipped = false) {
  const made = madeOf(C.model, C.pure, level);
  if (!made && !clipped) return '';
  return `${levelWord(level)} lasts ${made || '1' + LETTERS[level]}${clipped ? ' (clipped by the catalogue end)' : ''}`;
}
const outsideNote = (C) => `The catalogue runs ${C.pure.catalogueText()}`;
/** The words of the major periods at t: "Delta Trifracton End" (what a letter result says in words). */
const majorsAt = (C, t, level = 3) => C.pure.majorText(t, Math.min(3, level));

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
const earthAnswer = () => [err('Dates and clock times are off in pure mode', `This instrument is read in periods, counts, offsets and positions. Try ${HELP}. ${GLOSSARY}`)];

/** Light normalisation: NFC (NFKC would turn ½ into 1⁄2), plain minus, one kind of space. */
export function normalizePure(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[−‒–—―]/g, '-')
    .replace(/1⁄2/g, '½')
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// recognizers: each returns null (not mine) or an array of candidates / errors
// ---------------------------------------------------------------------------------------------
function recKeyword(C) {
  if (!/^(?:now|live)$/.test(C.lower)) return null;
  const c = make(C, 'relative', 'Now (the live clock)', C.real);
  if (c.kind !== 'error') c.live = true;
  return [c];
}

// ---- offsets: +2ε 5η, +4 Blinks ---------------------------------------------------------------
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
/** The unit of a term: α β γ δ ε η ι λ ν; ζ θ κ μ are depths (a pointer to the unit they are counted in). */
function unitOfTerm(C, term) {
  const level = levelOfUnitToken(term.tok);
  if (level < 0) return { error: err(`"${clip(term.tok, 12)}" is not a unit`) };
  const u = UNITS.find((x) => x.level === level);
  if (u) return { unit: u };
  return { error: betweenAnswer(C, level, term.n, 'span') };
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
  if (/^\d+(?:\.\d+)?$/.test(s) && sign !== null && s.replace('.', '').length <= 5) return [err('Add a unit to the offset', 'e.g. +2ε 5η · -3ι · in 5λ · 3η ago · +4 Blinks')];
  const terms = parseTerms(s);
  if (!terms) return null;
  // "33η 29ι 21λ" with no sign is also the clock the header prints: the counts are the first reading, the span the second
  const clockLike = sign === null && isClockChain(C, terms);
  if (sign === null) sign = 1; // "2ε 5η" is a span as the instrument writes it: read as "after"
  if (terms.length > 9) return [err('At most 9 terms in an offset')];
  let dpos = 0;
  const shown = [];
  for (const term of terms) {
    const r = unitOfTerm(C, term);
    if (r.error) return [r.error];
    dpos += term.n * C.pure.unitPos(r.unit);
    shown.push(`${term.n}${r.unit.sym}`);
  }
  const label = `${sign < 0 ? '−' : '+'}${clip(shown.join(' '), 32)} from the shown moment`;
  const p0 = C.model.positionOf(C.now);
  if (p0 === null) return [err(`${label}: the shown moment is outside the catalogue`, outsideNote(C))];
  const p = p0 + sign * dpos;
  if (!(p >= 0 && p <= C.model.extent)) return [err(`${label} is outside the catalogue`, outsideNote(C))];
  const c = make(C, 'relative', label, r3(C.model.timeOfPosition(p)), { upTo: 'nu' });
  if (clockLike && c.kind !== 'error') c.rank = 1;
  return [c];
}
/** η, η ι, η ι λ or η ι λ ν with whole counts inside their ranges: what the header's clock prints. */
function isClockChain(C, terms) {
  if (terms.length < 2 || terms.length > 4) return false;
  const ids = ['eta', 'iota', 'lambda', 'nu'];
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
  if (level <= 3) return [err(`A ${LEVEL_NAMES[level]} has no glyph pair: it is read by its quarter`, `Write next ${LEVEL_NAMES[level]} node, or ${LEVEL_NAMES[level]} Trifracton Valley (Peak, Node, Valley, End)`)];
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
    out.push(make(C, 'state', label, t, { extra: `lasts ${C.pure.duration(o.end - o.start, { at: o.start })}`, upTo: C.pure.resolutionOf(level) }));
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
  if (idx >= count) return [err(`Depth ${level + 1} has only ${count} cycles in the catalogue (d${level + 1}#0 … d${level + 1}#${count - 1n})`, 'The number after the # is the 0-based index counted over the whole catalogue')];
  const pid = pointId(m[3] ?? 'begin');
  const t = pointOfCycle(model, level, Number(idx), phaseOfPoint(pid));
  if (t === null) return [err(`The ${pointLabel(pid)} of this ${levelWord(level)} cycle lies beyond the end of the catalogue`)];
  const label = `${levelWord(level)} global index ${idx} · ${pure.cycleName(level, idx)}${pid === 'begin' ? '' : ' · ' + pointLabel(pid)}`;
  const c = model.cycleByIndex(level, idx);
  return [make(C, 'cycle', label, landPoint(model, level, Number(idx), phaseOfPoint(pid)), { extra: lastsText(C, level, c.clipped), upTo: pure.resolutionOf(level) })];
}

// ---- dates in all four forms ------------------------------------------------------------------
/** "Gamma Difracton in Beta Tetrafracton" -> "Beta Tetrafracton Gamma Difracton" (the order of a date). */
const IN_SPLIT = /\s+(?:in|of|within|inside)\s+/;
const NAME_TOKEN = new RegExp(`\\s*(${MAJOR_WORD_ALT})[\\s-]+(${ORDINAL_ALT})(?![a-z])(?:\\s+(${QUARTER_ALT}|begin|start)(?![a-z]))?`, 'y');
const LETTER_TOKEN = new RegExp(`\\s*(${LEVEL_WORD_ALT}|[α-ξ])${END}\\s*(#?)\\s*(\\d+)(?:\\s+(${QUARTER_ALT}|begin|start)(?![a-z]))?`, 'y');
const COUNT_TOKEN = new RegExp(`\\s*(\\d+)\\s*(${GREEK_ALT})${END}`, 'y');
/** Tokens of a date text ({kind: 'name' | 'letter' | 'count', level, n, hashed, quarter}), or null when something else is in it. */
export function tokenizeDate(lower) {
  let s = lower.replace(/[,›»>·|]/g, ' ').replace(/\s+/g, ' ').trim();
  // "Gamma Difracton in Beta Tetrafracton": the parent after "in" goes first
  const halves = s.split(IN_SPLIT);
  if (halves.length > 1) s = halves.reverse().join(' ');
  const toks = [];
  let pos = 0;
  while (pos < s.length) {
    let m;
    NAME_TOKEN.lastIndex = pos;
    if ((m = NAME_TOKEN.exec(s)) && m.index === pos) {
      toks.push({ kind: 'name', level: LEVEL_WORDS.indexOf(m[1]), n: ORDINAL_NAMES.findIndex((o) => o.toLowerCase() === m[2]), quarter: quarterOf(m[3]) });
      pos = NAME_TOKEN.lastIndex;
      continue;
    }
    LETTER_TOKEN.lastIndex = pos;
    if ((m = LETTER_TOKEN.exec(s)) && m.index === pos) {
      const level = levelOfToken(m[1]);
      if (level < 0) return null;
      toks.push({ kind: 'letter', level, hashed: m[2] === '#', n: Number(m[3]), quarter: quarterOf(m[4]) });
      pos = LETTER_TOKEN.lastIndex;
      continue;
    }
    COUNT_TOKEN.lastIndex = pos;
    if ((m = COUNT_TOKEN.exec(s)) && m.index === pos) {
      const level = levelOfUnitToken(m[2]);
      if (level < 0) return null;
      toks.push({ kind: 'count', level, n: Number(m[1]), quarter: -1 });
      pos = COUNT_TOKEN.lastIndex;
      continue;
    }
    return null;
  }
  return toks.length ? toks : null;
}
const COUNT_IDS = { 6: 'eta', 8: 'iota', 10: 'lambda', 12: 'nu' };
const ORD_IDS = { 0: 'alpha', 1: 'beta', 2: 'gamma', 3: 'delta', 4: 'epsilon' };
/**
 * Date tokens -> LADDER parts ({id, n, quarter, words}), or {error}. A count-first token ("5η") is a count; "ε#2" /
 * "δ 3" an ordinal; "η 3" (letter first, no hash) the old spelling of the count 3η, "η#4" the 4th Helion (the count 3).
 */
function dateParts(C, toks) {
  const parts = [];
  for (const t of toks) {
    const sym = LETTERS[t.level];
    const quarter = t.quarter >= 0 ? t.quarter : null;
    if (t.kind === 'name') {
      if (t.n < 1) return { error: err('Not a fracton name') };
      parts.push({ id: ORD_IDS[t.level], n: t.n, quarter, words: true });
      continue;
    }
    if (quarter !== null && t.level > 3) return { error: err(`A quarter word belongs to a major period (Alpha, Beta, Gamma, Delta), not to ${sym}`, 'e.g. Delta Trifracton Node ε#2 20η') };
    if (t.kind === 'count') {
      if (COUNT_IDS[t.level]) {
        parts.push({ id: COUNT_IDS[t.level], n: t.n });
        continue;
      }
      if (betweenUnit(C.model, t.level) || t.level > 12) return { error: betweenAnswer(C, t.level, t.n, 'span') };
      return { error: err(`${t.n}${sym} is a count of units, not a date entry`, `A date writes ${t.level <= 4 ? `an ordinal as ${sym}#${t.n}` : 'it as an ordinal'}; the counts are η ι λ ν: 33η 29ι 21λ. A span after the shown moment starts with + : +${t.n}${sym}`) };
    }
    // letter first
    if (ORD_IDS[t.level] !== undefined) {
      if (t.n < 1) return { error: err(`${sym}# numbers start at 1`, `${sym}#1 is the first`) };
      parts.push({ id: ORD_IDS[t.level], n: t.n, quarter });
    } else if (COUNT_IDS[t.level]) {
      if (!t.hashed) parts.push({ id: COUNT_IDS[t.level], n: t.n });
      else {
        if (t.n < 1) return { error: err(`${sym}# numbers start at 1`, `${sym}#1 is the first; a count of completed units starts at 0: 0${sym}`) };
        parts.push({ id: COUNT_IDS[t.level], n: t.n - 1 }); // η#4 is the 4th Helion, the count 3
      }
    } else return { error: betweenAnswer(C, t.level, t.n, 'ordinal'), between: t };
  }
  return { parts };
}
/** The written form of the parts: majors as they were given (words or letters, with a quarter word), then ε# and counts. */
function partsLabel(parts) {
  const text = (p) => {
    if (p.words) return entriesText([p], { words: true });
    const q = p.quarter !== null && p.quarter !== undefined ? ` ${QUARTER_WORDS[p.quarter]}` : '';
    return entriesText([p]) + q;
  };
  // several majors in words read like the full date: "Beta Tetrafracton, Gamma Difracton, ε#2 5η"
  const words = parts.filter((p) => p.words);
  if (words.length < 2) return parts.map(text).join(' ');
  const rest = parts.filter((p) => !p.words).map(text).join(' ');
  return [words.map(text).join(', '), rest].filter(Boolean).join(', ');
}
function recDate(C) {
  const toks = tokenizeDate(C.lower);
  if (!toks) return null;
  // a bare count chain without any ordinal is (also) a span: the offset reader answers it; only η ι λ ν counts are a clock
  if (toks.every((t) => t.kind === 'count') && !toks.every((t) => COUNT_IDS[t.level])) return null;
  // "ζ 6" / "η 7": what a depth chip prints, the running cycle of that depth (and an ordinal, where there is one)
  const chip = toks.length === 1 && toks[0].kind === 'letter' && !toks[0].hashed && toks[0].n === toks[0].level + 1 && toks[0].quarter < 0;
  const dp = dateParts(C, toks);
  if (dp.error) {
    if (chip) {
      const running = runningCycle(C, toks[0].level);
      if (running) return [running];
    }
    return [dp.error];
  }
  const out = recStamp(C, dp.parts);
  if (chip) {
    const running = runningCycle(C, toks[0].level);
    if (running) out.push(running);
  }
  return out;
}
function recStamp(C, parts) {
  const r = resolveParts(C.model, C.pure, parts, C.now);
  if (r.error) return [err(r.error, r.detail ?? '')];
  const finestIdx = LADDER.indexOf(parts[parts.length - 1].id);
  const firstIdx = LADDER.indexOf(parts[0].id);
  const finest = LADDER[finestIdx];
  const level = LEVEL_OF[finest];
  const upTo = isMajorId(finest) ? 'delta' : finest;
  const given = partsLabel(parts);
  let label = given;
  if (firstIdx > 0) {
    const parentLevel = LEVEL_OF[LADDER[firstIdx - 1]];
    const cur = C.model.inRange(C.now) ? C.model.levelAt(C.now, parentLevel) : null;
    label = cur ? `${given} in ${C.pure.cycleName(parentLevel, cur.cycle)}` : given;
  }
  // in words what the letters say (or the letters of what the words say: the stamp leads the detail anyway)
  const words = isMajorId(finest) ? C.pure.majorText(r.t, level) : majorsAt(C, r.t);
  const extra = [words, isMajorId(finest) && r.quarter === null ? lastsText(C, level) : ''].filter(Boolean).join(' · ');
  return [make(C, 'cycle', label, r.t, { extra, upTo })];
}
/** The cycle of `level` running at the shown moment, as a depth chip "ζ 6" shows it (its start). */
function runningCycle(C, level) {
  const { model, pure } = C;
  const cur = model.inRange(C.now) ? model.levelAt(C.now, level) : null;
  if (!cur) return null;
  const label = `The running ${levelWord(level)} (depth ${level + 1})`;
  const extra = [pure.cycleName(level, cur.cycle), lastsText(C, level)].filter(Boolean).join(' · ');
  return make(C, 'cycle', label, landPoint(model, level, cur.cycle, 0), { extra, upTo: pure.resolutionOf(level) });
}

// ---- Latin shorthand and dotted addresses: a6 b4 g9 · 6.4.9 ----------------------------------------
function recAddress(C) {
  if (!/^[a-z]\d|^\d+(?:\.\d+)+$/.test(C.lower)) return null;
  const tok = tokenizePath(C.lower);
  if (!tok) return null;
  for (let i = 1; i < tok.levels.length; i++) if (tok.levels[i] !== tok.levels[i - 1] + 1) return [err('Write the periods from the longest to the shortest, without gaps', 'e.g. a6 b4 g9 · α#6 β#4 γ#9')];
  if (tok.levels.at(-1) > 4) return [err('Below the Nuclide a moment is counted, not numbered', 'e.g. α#6 β#4 γ#9 δ#3 ε#5 33η 29ι')];
  const parts = tok.levels.map((level, i) => ({ id: ORD_IDS[level], n: tok.nums[i], quarter: null }));
  if (tok.point) {
    const q = quarterOf(tok.point);
    if (q < 0 && tok.point !== 'begin') return [err(`"${tok.point}": a date takes a quarter word (Peak, Node, Valley, End)`)];
    if (q >= 0) {
      if (!isMajorId(parts.at(-1).id)) return [err('A quarter word belongs to a major period (Alpha, Beta, Gamma, Delta)')];
      parts.at(-1).quarter = q;
    }
  }
  return recStamp(C, parts);
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

// ---- boundaries: next ε, prev η, next Helion, next Delta node -----------------------------------
function recBoundary(C) {
  const bare = new RegExp(`^(next|prev|previous|last|after|before)\\s*(\\d+)?\\s*(${POINT_WORDS})$`).exec(C.lower);
  if (bare) {
    if (C.level === undefined) return [err(`"${clip(C.text)}" needs a level`, 'Name it: next peak η · next Delta node · next end of ε')];
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
  const phase = pid === 'end' ? 1 : pid === 'begin' ? 0 : phaseOfPoint(pid);
  const ev = eventsAround(model, C.now, level, dir, count, phase);
  const what = pid === 'end' || pid === 'begin' ? 'boundary' : pointLabel(pid);
  const label = `${dir > 0 ? 'Next' : 'Previous'}${count > 1 ? ' ' + ordinal(count) : ''} ${levelWord(level)} ${what}`;
  if (ev.length < count) return [err(`${label}: ${dir > 0 ? 'the catalogue ends before it' : 'it would be before the catalogue starts'}`)];
  const last = ev[ev.length - 1];
  const total = Number(model.clock.count(level));
  // the first millisecond that shows it
  const t = landPoint(model, level, last.idx, phase === 1 ? 0 : phase);
  // inside the shown Nuclide a minor cycle is named by its counts alone ("34η"), across one by its Nuclide too
  const nuclide = model.levelAt(C.now, 4)?.cycle;
  const nameOf = (idx) => {
    if (level < 4) return pure.cycleName(level, idx);
    // a new Nuclide in another Delta says which: "ε#1 of Delta Tetrafracton"
    if (level === 4) {
      const d = Math.floor(Number(idx) / 5);
      return d === model.levelAt(C.now, 3)?.cycle ? pure.cycleName(4, idx) : `${pure.cycleName(4, idx)} of ${pure.cycleName(3, d)}`;
    }
    const start = model.cycleStartTime(level, idx);
    const same = start !== null && model.levelAt(model.clamp(start + 1e-3), 4)?.cycle === nuclide;
    return pure.cycleName(level, idx, { short: same });
  };
  let extra;
  if (phase === 0 || phase === 1) {
    const ends = last.idx >= 1 && last.idx <= total ? `${nameOf(last.idx - 1)} ends` : '';
    const starts = last.idx < total ? `${nameOf(last.idx)} begins` : 'the catalogue ends';
    extra = [ends, starts].filter(Boolean).join(' → ');
  } else if (level <= 3) {
    // a threshold of a major period ends one quarter and begins the next: "Delta Trifracton Node ends → Valley begins"
    const k = Math.round(phase * 4);
    extra = last.idx < total ? `${pure.cycleName(level, last.idx)} ${QUARTER_WORDS[k - 1]} ends → ${QUARTER_WORDS[k]} begins` : '';
  } else extra = last.idx < total ? `${what} of ${nameOf(last.idx)}` : '';
  return [make(C, 'boundary', label, t, { extra, upTo: pure.resolutionOf(level) })];
}
/** A lone depth letter, level name or unit name ("ε", "Helion", "Delta"): offer its next and previous boundary. */
function recLevelOnly(C) {
  const m = new RegExp(`^(${GREEK_ALT})$`).exec(C.lower);
  if (!m) return null;
  const level = levelOfUnitToken(m[1]);
  if (level < 0) return null;
  return [...boundaryCandidates(C, level, 1, 1, 'end'), ...boundaryCandidates(C, level, -1, 1, 'end')];
}

// ---------------------------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------------------------
const RECOGNIZERS = [recKeyword, recOffset, recState, recGlobal, recDate, recAddress, recSync, recPosition, recBoundary, recLevelOnly];

/**
 * @param {string} text
 * @param {{model:object, pure:object, now:number, real?:number, level?:number}} opts
 *   now = the shown moment (offsets and missing periods hang off it); real = the device clock (for "now");
 *   level = the depth "next peak" means
 * @returns {{label:string, time:number|null, kind:string, detail:string, error?:string, live?:boolean}[]}
 */
export function parsePure(text, opts = {}) {
  const s = String(text ?? '');
  if (s.length > MAX_INPUT && s.trim().length > MAX_INPUT) {
    return [err(`That is ${s.trim().length} characters: the jump box reads up to ${MAX_INPUT}`, 'Paste a date, a stamp, counts or an offset')];
  }
  const raw = normalizePure(s);
  if (!raw) return [];
  const lower = raw.toLowerCase();
  // old forms: one pointer each, whatever else the text says (and the pointer never repeats them)
  if (HALF_RE.test(lower)) return [err(HALF_ANSWER[0], HALF_ANSWER[1])];
  if (BEAT_RE.test(lower)) return [err(BEAT_ANSWER[0], BEAT_ANSWER[1])];
  let m;
  if ((m = RETIRED_RE.exec(lower))) return retiredAnswer(m[1]);
  if ((m = MINOR_FRACTON_RE.exec(lower))) return minorFractonAnswer(m);
  const now = r3(opts.now ?? opts.real ?? 0);
  const C = {
    model: opts.model,
    pure: opts.pure,
    now,
    real: r3(opts.real ?? now),
    text: raw,
    lower,
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
  if (bad.length) {
    const seen = new Set();
    return bad.filter((c) => (seen.has(c.error) ? false : seen.add(c.error)));
  }
  if (looksEarthly(raw)) return earthAnswer();
  // (a percentage is no Earth input but must not be printed back)
  const echo = /%|per ?cent/i.test(raw) ? 'that' : `"${clip(raw)}"`;
  return [err(`Cannot read ${echo}`, `Try ${HELP}. ${GLOSSARY}`)];
}

export { unitById, MAJOR_IDS };
