/**
 * Pure-mode wording of the ladder and up-next cards (docs/design/80-pure.md, SPEC §15, revision 3): everything these
 * two cards say when `ctx.isPure()` is on, in Fractonica terms only.
 *
 * TWO KINDS OF PERIOD (src/core/pure.js)
 *   major  α β γ δ (Alpha Beta Gamma Delta): said in WORDS, fracton ordinal and quarter word ("Delta Trifracton Node");
 *          their phase is never drawn (the quarter word stands for it).
 *   minor  ε Nuclide (ordinal ε#2), η Helion, ι Preon, λ Flavon, ν Blink (counts 33η 29ι 21λ 3ν); the depths between
 *          them (ζ θ κ μ) and below the Blink (ξ) are levels but not units: a minor cycle is named by where it starts
 *          in its Nuclide ("ε#5 33η", short "33η"), its phase is a pair of 2-stroke glyphs (256 states).
 * Spans are counted over α β γ δ ε η ι λ ν with zero parts skipped (2ε 10η, 6ι 43λ, 2.6ν); real time is counted in
 * Blinks ("6.43 Blinks").
 *
 * NOTATION (header of src/core/pure.js, never re-derived here)
 *   X#n   an ordinal, 1-based: α#6, δ#3, ε#2        (identities, letter addresses)
 *   nX    a count of units, 0-based: 33η 29ι, spans "6ι 43λ"
 *   X d   a depth chip ("η 7"), only on level chips; sentences say "Delta" (major) or "η" (minor)
 * Unit names (Nuclide, Helion, Preon, Flavon, Blink) appear only in prose: tooltips and legends that explain a unit.
 *
 * DOM-free and unit-tested (test/ladder.test.js). `pure` is `ctx.pure`, `model` is `ctx.model`; nothing here reads the
 * formatter, a zone, a Gregorian field or a percentage. Spans come from pure.between / durationPos / cycleLength only,
 * names from pure.periodName / cycleName / cycleShort: this module never re-counts them by itself, except for the exact
 * BigInt twins of pure.date / pure.clock at a turnover position (tested against the core).
 */
import { clamp, finerLevels, letterOf, levelLetters } from './lib.js';

// ---------------------------------------------------------------------------
// names
// ---------------------------------------------------------------------------

/** "Eta" for level 6; levels beyond the table read "Level 25" (spoken chips only). */
export const levelWord = (pure, level) => pure.LEVEL_NAMES[level] ?? `Level ${level + 1}`;

/** "Eta, depth 7": what a chip says to a screen reader. */
export const depthWords = (pure, level) => `${levelWord(pure, level)}, depth ${level + 1}`;

/** How a sentence names a level: majors in words ("Delta"), every other level by its letter ("η"). */
export const levelSay = (pure, level) => (pure.isMajor(level) ? pure.LEVEL_NAMES[level] : letterOf(level));

/** "Node": the quarter word of a phase (the quarter is named by the threshold that ends it). */
export const quarterWord = (pure, phase) => pure.QUARTER_WORDS[clamp(Math.floor((Number.isFinite(phase) ? phase : 0) * 4), 0, 3)];

/**
 * What a ladder row says next to its chip, for a reading `lv` (model.levelAt):
 *   major  "Trifracton Node"  (the chip completes it: Delta Trifracton Node)
 *   ε      "ε#5"
 *   finer  the count that places the cycle in its Nuclide: "33η" (η), "22η" (ζ), "28ι" (θ), "3.43ν" (ξ)
 */
export function rowLabel(pure, lv) {
  if (pure.isMajor(lv.level)) return `${pure.ordinalName(clamp(lv.local + 1, 1, lv.siblings))} ${quarterWord(pure, lv.phase)}`;
  return pure.cycleShort(lv.level, lv.cycleBig);
}

/** The cycle itself: "Delta Trifracton", "ε#5", "ε#5 33η" (pure.cycleName, no quarter). */
export const cycleTitle = (pure, level, cycleBig) => pure.cycleName(level, cycleBig);

/** Global index of the cycle of `coarse` (<= level) that holds cycle `cycleBig` of `level`. */
const ancestor = (model, level, cycleBig, coarse) => BigInt(cycleBig) / (model.levelInfo(level).prefix / model.levelInfo(coarse).prefix);

/**
 * The letter address of a cycle's start: "α#6 β#4 γ#9" (a Gamma: no finer ordinal than its own), "α#6 β#4 γ#9 δ#3 ε#5
 * 33η" (a minor cycle: pure.addressAt of its start, but exact and with the decimal Blink of a ξ). The major ordinals
 * come from the model's path, the minor placing from pure.cycleName.
 */
export function cycleAddress(model, pure, level, cycleBig) {
  const top = Math.min(level, 3);
  const path = model.cycleToPath(top, level <= 3 ? cycleBig : ancestor(model, level, cycleBig, 3));
  const head = path.map((n, L) => pure.shortName(L, n)).join(' ');
  return level <= 3 ? head : `${head} ${pure.cycleName(level, cycleBig)}`;
}

/**
 * The cycle of `level` that follows the cycle with global index `cycleBig`, or null when the catalogue ends with the
 * current one. `name` is what is said where the current one ends: majors in words ("Delta Tetrafracton"), the Nuclide
 * by its ordinal ("ε#3"), finer cycles by their placing counts, short inside the same Nuclide ("34η", "33η 30ι") and
 * with the Nuclide when it starts a new one ("ε#3 0η").
 * @returns {null | {idx: bigint, name: string, address: string}}
 */
export function nextCycle(model, pure, level, cycleBig) {
  const idx = BigInt(cycleBig) + 1n;
  if (idx >= model.clock.count(level)) return null;
  let name;
  if (level <= 4) name = pure.cycleName(level, idx);
  else {
    const same = ancestor(model, level, idx, 4) === ancestor(model, level, cycleBig, 4);
    name = pure.cycleName(level, idx, { short: same });
  }
  return { idx, name, address: cycleAddress(model, pure, level, idx) };
}

/** "→ Delta Tetrafracton begins" / "→ 34η begins": what happens where a cycle ends (never a date). */
export const endsText = (next) => (next ? `→ ${next.name} begins` : '→ the catalogue ends');

/**
 * The bar sector the phase is in is the child cycle with that index: its name and, for a major child, its quarter word
 * (a major's phase is never drawn). "Beta Tetrafracton" + "Valley", "ε#5", "22η", "28ι".
 * @returns {{name: string, quarter: string | null, major: boolean}}
 */
export function sectorName(pure, lv, sectorIndex, sectorFrac = 0) {
  const child = lv.level + 1;
  if (pure.isMajor(child)) return { name: pure.periodName(child, sectorIndex + 1), quarter: quarterWord(pure, sectorFrac), major: true };
  const idx = BigInt(lv.cycleBig) * BigInt(lv.factor) + BigInt(sectorIndex);
  return { name: pure.cycleShort(child, idx), quarter: null, major: false };
}

// ---------------------------------------------------------------------------
// the unit a cycle is (prose only: tooltips and legends that explain it)
// ---------------------------------------------------------------------------

/** "Helion": the name of a MINOR unit (ε η ι λ ν); '' for majors (their name is the level's) and for non-units. */
export const unitWord = (pure, level) => {
  const u = pure.unitOf(level);
  return u && !u.major ? u.name : '';
};

/** "36ι": how many of the next unit one cycle of a unit level holds; '' for the Blink and for levels that are not units. */
export function holds(model, pure, level) {
  const i = pure.UNIT_LEVELS.indexOf(level);
  if (i < 0 || i === pure.UNIT_LEVELS.length - 1) return '';
  const next = pure.UNIT_LEVELS[i + 1];
  return `${model.levelInfo(next).prefix / model.levelInfo(level).prefix}${letterOf(next)}`;
}

/** "a" or "an" for the word that follows (an Alpha, a Helion; letters read aloud: an α, an ε, an η, a ζ, a ξ). */
const article = (word) => (/^[aeiouαεηιουω]/i.test(word) ? 'an' : 'a');

/**
 * A clause that explains what a cycle of a level is:
 *   major / unit  "a Delta (δ) is 5ε", "a Nuclide (ε) is 77η", "a Helion (η) is 36ι", "a Blink (ν) is the finest unit"
 *   between       "a ζ cycle is 11η, not a unit"
 *   finer         "a ξ cycle is 0.14ν, finer than a Blink"
 */
export function unitClause(model, pure, level) {
  const sym = letterOf(level);
  const kind = pure.levelKind(level);
  if (kind === 'between') return `${article(sym)} ${sym} cycle is ${pure.cycleLength(level)}, not a unit`;
  if (kind === 'sub') return `${article(sym)} ${sym} cycle is ${pure.cycleLength(level)}, finer than a Blink`;
  const name = pure.unitName(level);
  const subject = `${article(name)} ${name} (${sym})`;
  const h = holds(model, pure, level);
  return h ? `${subject} is ${h}` : `${subject} is the finest unit`;
}

/** The clause as a sentence: "A Helion (η) is 36ι." (tooltips). */
export const unitSentence = (model, pure, level) => {
  const c = unitClause(model, pure, level);
  return `${c[0].toUpperCase()}${c.slice(1)}.`;
};

// ---------------------------------------------------------------------------
// spans and countdowns
// ---------------------------------------------------------------------------

/** "6ι 43λ": the time left between two instants counted in ladder units (pure.between). Never negative ("0ν"). */
export function leftText(model, pure, t1, t2, parts = 2) {
  return t2 > t1 ? pure.between(t1, t2, { parts }) : pure.durationPos(0, { parts });
}

/**
 * Length of a cycle reading `lv` (model.levelAt): "1δ", "1η", "11η" (a ζ), "4ι" (a θ), "0.14ν" (a ξ). A whole cycle is
 * pure.cycleLength(level) (exact: 4 / P Saros, never measured between two float instants); a cycle clipped by the end
 * of the catalogue keeps its shorter, odd tail.
 */
export function lengthText(model, pure, lv) {
  if (!lv.clipped) return pure.cycleLength(lv.level);
  const P = model.levelInfo(lv.level).prefix;
  return pure.durationPos(Number(BigInt(model.extent) * P - 4n * BigInt(lv.cycleBig)) / Number(P));
}

/**
 * The hero countdown: up to three units ("2ε 10η 6ι"; zero parts are skipped by the core, so "3η 2λ" never reads
 * "3η 0ι 2λ"), like "2 d 03 h 11 min" in normal mode. Under ten Blinks the core's decimal takes over ("2.6ν").
 */
export function heroLeft(model, pure, t1, t2) {
  return t2 > t1 ? pure.between(t1, t2, { parts: 3 }) : pure.durationPos(0);
}

/** "6.43 Blinks", "0.4 Blinks", "0.00322 Blinks": a short real-time lead counted in Blinks (Just before / Just after). */
export const leadBlinks = (pure, seconds) => pure.blinks(seconds);

/** "0.25 Blinks", "1 Blink": how long a cycle too fast to count down lasts, two significant digits. */
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
// where inside the hierarchy an instant is (the stamp's tokens)
// ---------------------------------------------------------------------------

/**
 * The tokens of an instant's full letter stamp, coarsest first: four major ordinals, the Nuclide ordinal and four
 * counts: ["α#6","β#4","γ#9","δ#3","ε#5","33η","29ι","21λ","3ν"], or null (pure.stamp(t, 'nu') split).
 */
export function counterParts(pure, t) {
  const d = pure.date(t);
  const c = pure.clock(t);
  if (!d || !c) return null;
  return [`α#${d.alpha}`, `β#${d.beta}`, `γ#${d.gamma}`, `δ#${d.delta}`, `ε#${c.epsilon}`, `${c.eta}η`, `${c.iota}ι`, `${c.lambda}λ`, `${c.nu}ν`];
}

/**
 * The finer of the two stamp tokens that place a quarter threshold of a cycle of each level (index into counterParts):
 * the first token that tells the four thresholds apart, except that a Delta's quarters (1¼ Nuclides apart) are placed
 * to the Helion, the basic reading. Below μ no token is fine enough (a ν quarter is a quarter of a Blink).
 */
const QUARTER_RESOLUTION = [1, 2, 3, 5, 6, 6, 6, 6, 7, 7, 8, 8];

/**
 * Where a quarter threshold of a cycle of `level` falls, as two tokens of the stamp: "β#4 γ#4" (β), "ε#2 19η" (δ),
 * "33η 9ι" (η), "29ι 16λ" (ι), "21λ 6ν" (λ). Empty for ν and finer (the ¼ ½ ¾ column says it).
 * Evaluated 1 ms past `when`, so the end of a cycle reads as the start of the next one whatever the rounding.
 */
export function quarterWhere(model, pure, when, level) {
  const res = QUARTER_RESOLUTION[level];
  if (res === undefined || when === null || when === undefined) return '';
  const parts = counterParts(pure, Math.min(when + 0.001, model.tMax));
  return parts ? `${parts[res - 1]} ${parts[res]}` : '';
}

// ---------------------------------------------------------------------------
// turnovers (Up next)
// ---------------------------------------------------------------------------

/** Exact position of an upcoming-turnover event ("num/den" key of model.upcomingEnds) or null. */
export function positionOfKey(key) {
  const m = /^(\d+)\/(\d+)$/.exec(String(key));
  return m ? { num: BigInt(m[1]), den: BigInt(m[2]) } : null;
}

/** Global index of the cycle of `level` that contains the exact position num/den (floor). */
const cycleAtPosition = (model, level, num, den) => (num * model.levelInfo(level).prefix) / (4n * den);
/** Its 0-based index inside the parent (Alpha: global). */
function localAtPosition(model, level, num, den) {
  const c = cycleAtPosition(model, level, num, den);
  const sib = model.levelInfo(level).siblings;
  return Number(sib === null ? c : c % BigInt(sib));
}

/**
 * The pure date of an exact position num/den by exact integer arithmetic: the twin of `pure.date(t)` for the instant
 * that position belongs to: {alpha, beta, gamma, delta, epsilon, quarter: {alpha … delta}}.
 */
export function dateAtPosition(model, pure, num, den) {
  const q = (L) => pure.QUARTER_WORDS[Number(((num * model.levelInfo(L).prefix) / den) % 4n)]; // floor(4 · phase)
  return {
    alpha: localAtPosition(model, 0, num, den) + 1,
    beta: localAtPosition(model, 1, num, den) + 1,
    gamma: localAtPosition(model, 2, num, den) + 1,
    delta: localAtPosition(model, 3, num, den) + 1,
    epsilon: localAtPosition(model, 4, num, den) + 1,
    quarter: { alpha: q(0), beta: q(1), gamma: q(2), delta: q(3) },
  };
}

/** The minor clock of an exact position: the twin of `pure.clock(t)`: {epsilon, eta 0–76, iota, lambda, nu}. */
export function clockAtPosition(model, num, den) {
  const l = (L) => localAtPosition(model, L, num, den);
  return { epsilon: l(4) + 1, eta: l(5) * 11 + l(6), iota: l(7) * 4 + l(8), lambda: l(9) * 13 + l(10), nu: l(11) * 5 + l(12) };
}

/**
 * The hero sentence: "ζ ends — 4 finer cycles (η, θ, ι, κ) end with it." for a minor level (by its letter, never
 * "ζ 6"); a major one is said in words and in a shorter form, so the line still fits the 340 px column:
 * "Gamma ends, with 11 finer cycles (δ … ξ)."
 */
export function turnoverWords(pure, top, maxLevel) {
  const fin = finerLevels(top, maxLevel);
  const name = levelSay(pure, top);
  if (!fin.length) return `${name} ends.`;
  const one = fin.length === 1;
  if (pure.isMajor(top)) return `${name} ends, with ${fin.length} finer ${one ? 'cycle' : 'cycles'} (${levelLetters(fin, 3)}).`;
  return `${name} ends — ${fin.length} finer ${one ? 'cycle' : 'cycles'} (${levelLetters(fin)}) end${one ? 's' : ''} with it.`;
}

const turnoverCache = new Map();

/**
 * What an upcoming turnover is, in pure terms. `name` is the cycle of the event's top level that begins there (majors in
 * words, minors by their placing count: "Delta Tetrafracton", "ε#3", "34η"; null when the catalogue ends there),
 * `address` its full letter address ("α#6 β#4 γ#9 δ#3 ε#5 34η"), `date` / `clock` the exact readings there (twins of
 * pure.date / pure.clock), `group` the Nuclide it falls in (the group of the list), `heading` that Nuclide in words
 * ("Delta Trifracton ε#5") and `stamp` the short letter date of the turnover ("δ#3 ε#5 34η").
 * @param {{key:string, top:number}} ev event from buildEvents
 */
export function turnoverInfo(model, pure, ev) {
  const cacheKey = `${ev.key}|${ev.top}`;
  const hit = turnoverCache.get(cacheKey);
  if (hit) return hit;
  const p = positionOfKey(ev.key);
  const level = ev.top;
  const none = { name: null, address: '', date: null, clock: null, group: ev.key, heading: '', stamp: '' };
  let info;
  if (!p) info = none;
  else {
    const idx = cycleAtPosition(model, level, p.num, p.den);
    const group = String(cycleAtPosition(model, 4, p.num, p.den));
    if (idx >= model.clock.count(level)) info = { ...none, group };
    else {
      const date = dateAtPosition(model, pure, p.num, p.den);
      const clock = clockAtPosition(model, p.num, p.den);
      info = {
        name: level <= 4 ? pure.cycleName(level, idx) : pure.cycleName(level, idx, { short: true }),
        address: cycleAddress(model, pure, level, idx),
        date,
        clock,
        group,
        heading: `${pure.periodName(3, date.delta)} ε#${clock.epsilon}`,
        stamp: `δ#${date.delta} ε#${clock.epsilon} ${clock.eta}η`,
      };
    }
  }
  if (turnoverCache.size > 600) turnoverCache.clear();
  turnoverCache.set(cacheKey, info);
  return info;
}

/**
 * The grouping of the pure list: events are grouped by the Nuclide (ε) they fall in, the pure "week". Per event:
 *   newDay  marks the separator drawn between two groups (never on the first row),
 *   clock   the short letter date of the turnover "δ#3 ε#5 34η" (wide cards write it on every row),
 *   head    the Nuclide in words, "Delta Trifracton ε#5", as the heading of a group of two or more events, on its
 *           first row ('' elsewhere): a group of one is its own date, the heading only helps where several share one.
 */
export function groupByNuclide(model, pure, events) {
  const infos = events.map((e) => turnoverInfo(model, pure, e));
  const size = new Map();
  for (const i of infos) size.set(i.group, (size.get(i.group) ?? 0) + 1);
  let prev = null;
  return events.map((e, i) => {
    const info = infos[i];
    const first = info.group !== prev;
    prev = info.group;
    return { ...e, dayKey: info.group, newDay: i > 0 && first, day: null, clock: info.stamp, head: first && size.get(info.group) > 1 ? info.heading : '' };
  });
}
