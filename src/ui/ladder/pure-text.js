/**
 * Pure-mode wording of the ladder and up-next cards (docs/design/80-pure.md, revision 2): everything these two cards
 * say when `ctx.isPure()` is on, in Fractonica terms only. Cycles are named (Gamma Difracton), spans are counted in
 * ladder units, one unit per depth, whole cycles only (4ι 3κ, 1ζ 4η, 0.14ν), progress is a pair of 2-stroke glyphs
 * (256 states) and real time is counted in Blinks (the device's tick: "6.43 Blinks").
 *
 * NOTATION (header of src/core/pure.js, never re-derived here):
 *   X#n   an ordinal, 1-based: ζ#5, δ#6, α#6            (addresses, dates)
 *   nX    a count of units X: durations "6ι 3κ", clock counters "3η 17ι" (completed units, 0-based)
 *   X d   a depth chip ("η 7"), only on level chips; sentences say "η" or "Eta"
 * Unit NAMES (Hadron, Helion, Preon ...) appear only in prose: tooltips and legends that explain a unit.
 *
 * DOM-free and unit-tested (test/ladder.test.js). `pure` is `ctx.pure` (src/core/pure.js), `model` is `ctx.model`;
 * nothing here reads the formatter, a zone, a Gregorian field or a percentage. Durations come from
 * pure.durationPos / pure.between / pure.cycleLength only: this module never trims or reformats them.
 */
import { clamp, finerLevels, letterOf, levelLetters } from './lib.js';

// ---------------------------------------------------------------------------
// names
// ---------------------------------------------------------------------------

/** "Eta" for level 6; levels beyond the table read "Level 25". */
export const levelWord = (pure, level) => pure.LEVEL_NAMES[level] ?? `Level ${level + 1}`;

/** "Eta, depth 7": what a chip says to a screen reader. */
export const depthWords = (pure, level) => `${levelWord(pure, level)}, depth ${level + 1}`;

/** The ordinal name a row's counter shows: "Pentafracton" for the 5th cycle in its parent (`local` is 0-based). */
export const counterName = (pure, local, siblings) => pure.ordinalName(clamp(local + 1, 1, siblings));

/** "Alpha Hexafracton": full name of the cycle with 0-based `local` index (for Alpha: the global index). */
export const cycleWords = (pure, level, local) => pure.periodName(level, local + 1);

/** Address chain "α#6 β#4 γ#9" of a 1-based path [alpha, beta, ...] (model.cycleToPath). */
export const pathText = (pure, path) => path.map((n, level) => pure.shortName(level, n)).join(' ');

/**
 * The cycle of `level` that follows the cycle with global index `cycleBig`: its name and address, or null when
 * the catalogue ends with the current one.
 * @returns {null | {idx: bigint, name: string, short: string, address: string}}
 */
export function nextCycle(model, pure, level, cycleBig) {
  const idx = BigInt(cycleBig) + 1n;
  if (idx >= model.clock.count(level)) return null;
  const path = model.cycleToPath(level, idx);
  return { idx, name: pure.periodName(level, path[level]), short: pure.shortName(level, path[level]), address: pathText(pure, path) };
}

/** "→ Eta Difracton begins": what happens where a cycle ends (never a date). */
export const endsText = (next) => (next ? `→ ${next.name} begins` : '→ the catalogue ends');

/** The bar sector the phase is in is the child cycle of that number: "Theta Octafracton" (0-based sector index). */
export const sectorName = (pure, level, sectorIndex) => pure.periodName(level + 1, sectorIndex + 1);

// ---------------------------------------------------------------------------
// the unit a cycle is (prose only: tooltips and legends that explain it)
// ---------------------------------------------------------------------------

/** "Hadron": the particle name of a level's unit; '' for α β γ (no name yet) and for ξ and finer (not units). */
export const unitWord = (pure, level) => {
  const u = pure.UNITS[level];
  return u?.named ? u.name : '';
};

/** "11η": how many cycles of the next finer level one cycle of `level` holds, written as a count. */
export const holds = (model, level) => `${model.levelInfo(level).factor}${letterOf(level + 1)}`;

/** "a" or "an" for the word that follows (names: an Atom; letters read aloud: an α, an ε, an η, a β, a ξ). */
const article = (word) => (/^[aeiouαεηιουω]/i.test(word) ? 'an' : 'a');

/**
 * A clause that explains a level's unit: "a Hadron (ζ) is 11η", "a γ cycle is 5δ". Below the Blink there is no
 * unit: a ξ cycle is told as the part of a Blink it is ("a ξ cycle is 0.14ν").
 */
export function unitClause(model, pure, level) {
  const sym = letterOf(level);
  if (!pure.UNITS[level]) return `${article(sym)} ${sym} cycle is ${pure.cycleLength(level)}`;
  const name = unitWord(pure, level);
  const subject = name ? `${article(name)} ${name} (${sym})` : `${article(sym)} ${sym} cycle`;
  return `${subject} is ${holds(model, level)}`;
}

/** The clause as a sentence: "A Hadron (ζ) is 11η." (tooltips). */
export const unitSentence = (model, pure, level) => {
  const c = unitClause(model, pure, level);
  return `${c[0].toUpperCase()}${c.slice(1)}.`;
};

// ---------------------------------------------------------------------------
// spans and countdowns
// ---------------------------------------------------------------------------

/** "6ι 3κ": the time left between two instants counted in ladder units (pure.between). Never negative ("0ν"). */
export function leftText(model, pure, t1, t2, parts = 2) {
  return t2 > t1 ? pure.between(t1, t2, { parts }) : pure.durationPos(0, { parts });
}

/**
 * Length of a cycle reading `lv` (model.levelAt): "1η", "1ζ", "0.14ν". A whole cycle is pure.cycleLength(level)
 * (exact: 4 / P Saros, never measured between two float instants); a cycle clipped by the end of the catalogue
 * keeps its shorter, odd tail.
 */
export function lengthText(model, pure, lv) {
  if (!lv.clipped) return pure.cycleLength(lv.level);
  const P = model.levelInfo(lv.level).prefix;
  return pure.durationPos(Number(BigInt(model.extent) * P - 4n * BigInt(lv.cycleBig)) / Number(P));
}

/**
 * The hero countdown: up to three units ("1ζ 4η 3θ"; zero parts are skipped by the core, so "3η 2ι" never reads
 * "3η 0θ 2ι"), like "2 d 03 h 11 min" in normal mode. Under five Blinks the core's decimal takes over ("2.6ν").
 */
export function heroLeft(model, pure, t1, t2) {
  return t2 > t1 ? pure.between(t1, t2, { parts: 3 }) : pure.durationPos(0);
}

/** "6.43 Blinks", "0.4 Blinks", "0.00322 Blinks": a short real-time lead counted in Blinks (Just before / Just after). */
export const leadBlinks = (pure, seconds) => pure.blinks(seconds);

/** "0.31 Blinks", "1 Blink": how long a cycle too fast to count down lasts, two significant digits. */
export function periodBlinks(pure, seconds) {
  const n = Number(pure.secondsToBlinks(seconds).toPrecision(2));
  return pure.blinks(pure.blinksToSeconds(n));
}

// ---------------------------------------------------------------------------
// phase pair
// ---------------------------------------------------------------------------

const nameCache = new Map();
/**
 * The accessible name pure.pairHTML gives a pair ("phase 8 and 0 of 256"), read from the helper itself so it can
 * never drift from it; used where a sentence names a pair without drawing it (row labels, the progress bar).
 */
function pairName(pure, index, label) {
  const key = `${label}|${index}`;
  let s = nameCache.get(key);
  if (s === undefined) {
    s = /aria-label="([^"]*)"/.exec(pure.pairHTML((index + 0.5) / 256, { label }))?.[1] ?? '';
    nameCache.set(key, s);
  }
  return s;
}

/** The two glyph digits of a fraction of a cycle, and the words that stand for them ("13·0", "phase 13 and 0 of 256"). */
export function phaseWords(pure, fraction, label = 'phase') {
  const p = pure.pair(fraction);
  return { index: p.index, hi: p.hi, lo: p.lo, text: pure.pairText(fraction), label: pairName(pure, p.index, label) };
}

// ---------------------------------------------------------------------------
// where inside the hierarchy an instant is (clock and date counters)
// ---------------------------------------------------------------------------

/**
 * Counter tokens of an instant, coarsest first, in the notation of pure.stamp: six whole-cycle ordinals and three
 * clock counts: ["α#6","β#4","γ#9","δ#3","ε#2","ζ#5","3η","17ι","42λ"], or null.
 */
export function counterParts(pure, t) {
  const d = pure.date(t);
  const c = pure.clock(t);
  if (!d || !c) return null;
  return [`α#${d.alpha}`, `β#${d.beta}`, `γ#${d.gamma}`, `δ#${d.delta}`, `ε#${d.epsilon}`, `ζ#${d.zeta}`, `${c.eta}η`, `${c.iota}ι`, `${c.lambda}λ`];
}

/**
 * Join counter tokens `from..to` like pure.stamp: α β γ read as one group, every further ordinal is set off by a
 * dot, and the clock counts η ι λ read as one group again ("ζ#5 · 3η 17ι").
 */
function joinCounters(parts, from, to) {
  let out = parts[from];
  for (let i = from + 1; i <= to; i++) out += (i <= 2 || i >= 7 ? ' ' : ' · ') + parts[i];
  return out;
}

/** Finest counter that tells the quarter thresholds of a cycle of each level apart (index into counterParts); none from λ down. */
const QUARTER_RESOLUTION = [1, 2, 3, 4, 5, 6, 7, 7, 8, 8];

/**
 * Where a quarter threshold of a cycle of `level` falls, as its two finest counters: "ζ#5 · 3η", "3η 17ι".
 * Empty for cycles of λ and finer (the counters cannot tell their quarters apart: the ¼ ½ ¾ column does).
 * Evaluated 1 ms past `when`, so the end of a cycle reads as the start of the next one whatever the rounding.
 */
export function quarterWhere(model, pure, when, level) {
  const res = QUARTER_RESOLUTION[level];
  if (res === undefined || when === null || when === undefined) return '';
  const parts = counterParts(pure, Math.min(when + 0.001, model.tMax));
  return parts ? joinCounters(parts, Math.max(0, res - 1), res) : '';
}

// ---------------------------------------------------------------------------
// turnovers (Up next)
// ---------------------------------------------------------------------------

/** Exact position of an upcoming-turnover event ("num/den" key of model.upcomingEnds) or null. */
export function positionOfKey(key) {
  const m = /^(\d+)\/(\d+)$/.exec(String(key));
  return m ? { num: BigInt(m[1]), den: BigInt(m[2]) } : null;
}

/**
 * The pure date (alpha, beta, gamma, delta, epsilon, zeta: 1-based whole-cycle ordinals) of an exact position
 * num/den, by exact integer arithmetic; the same counters as `pure.date(t)` for the instant that position belongs to.
 */
export function dateAtPosition(model, num, den) {
  const ordinalAt = (level) => {
    const cycle = (num * model.levelInfo(level).prefix) / (4n * den); // floor: the cycle that contains p
    const sib = model.levelInfo(level).siblings;
    return Number(sib === null ? cycle : cycle % BigInt(sib)) + 1;
  };
  return {
    alpha: ordinalAt(0),
    beta: ordinalAt(1),
    gamma: ordinalAt(2),
    delta: ordinalAt(3),
    epsilon: ordinalAt(4),
    zeta: ordinalAt(5),
  };
}

/** "δ#6 · ε#5 · ζ#4": the whole-cycle ordinals of a date, as pure.dateText writes them after the α β γ group. */
export const dateTail = (d) => `δ#${d.delta} · ε#${d.epsilon} · ζ#${d.zeta}`;

/** "ζ ends — 4 finer cycles (η, θ, ι, κ) end with it.": the hero sentence (a letter names the cycle, never "ζ 6"). */
export function turnoverWords(top, maxLevel) {
  const fin = finerLevels(top, maxLevel);
  const name = letterOf(top);
  if (!fin.length) return `${name} ends.`;
  const one = fin.length === 1;
  return `${name} ends — ${fin.length} finer ${one ? 'cycle' : 'cycles'} (${levelLetters(fin)}) end${one ? 's' : ''} with it.`;
}

const turnoverCache = new Map();

/**
 * What an upcoming turnover is, in pure terms: the cycle that begins (name, short name, address chain), the
 * date counters where it falls and a group key (the ζ cycle, one Hadron, it falls in: the group of the list).
 * `name` is null when the catalogue ends there.
 * @param {{key:string, top:number}} ev event from buildEvents
 */
export function turnoverInfo(model, pure, ev) {
  const hit = turnoverCache.get(ev.key);
  if (hit) return hit;
  const p = positionOfKey(ev.key);
  const level = ev.top;
  let info;
  if (!p) info = { name: null, short: '', address: '', date: null, group: ev.key };
  else {
    const idx = (p.num * model.levelInfo(level).prefix) / (4n * p.den);
    const group = String((p.num * model.levelInfo(5).prefix) / (4n * p.den));
    if (idx >= model.clock.count(level)) info = { name: null, short: '', address: '', date: null, group };
    else {
      const path = model.cycleToPath(level, idx);
      info = {
        name: pure.periodName(level, path[level]),
        short: pure.shortName(level, path[level]),
        address: pathText(pure, path),
        date: dateAtPosition(model, p.num, p.den),
        group,
      };
    }
  }
  if (turnoverCache.size > 600) turnoverCache.clear();
  turnoverCache.set(ev.key, info);
  return info;
}

/**
 * The grouping of the pure list: events are grouped by the ζ (Hadron) they fall in, the pure "day". Per event:
 *   newDay  marks the separator drawn between two groups (never on the first row),
 *   clock   the date counters "δ#6 · ε#5 · ζ#4" (wide cards write them on every row),
 *   head    the same counters as the heading of a group of two or more events, on its first row ('' elsewhere):
 *           a group of one is its own date, the heading only helps where several events share a ζ.
 */
export function groupByZeta(model, pure, events) {
  const infos = events.map((e) => turnoverInfo(model, pure, e));
  const size = new Map();
  for (const i of infos) size.set(i.group, (size.get(i.group) ?? 0) + 1);
  let prev = null;
  return events.map((e, i) => {
    const info = infos[i];
    const first = info.group !== prev;
    prev = info.group;
    const clock = info.date ? dateTail(info.date) : '';
    return { ...e, dayKey: info.group, newDay: i > 0 && first, day: null, clock, head: first && size.get(info.group) > 1 ? clock : '' };
  });
}
