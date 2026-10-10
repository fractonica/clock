/**
 * Pure-mode wording of the ladder and up-next cards (docs/design/80-pure.md): everything these two cards say
 * when `ctx.isPure()` is on, in Fractonica terms only. Cycles are named (Gamma Difracton), spans are counted in
 * ladder units (2ζ½ 4η), progress is a pair of 2-stroke glyphs (256 states), real time is a "beat".
 *
 * NOTATION (header of src/core/pure.js, never re-derived here):
 *   X#n   an ordinal, 1-based: ζ#5, δ½#6, α#6          (addresses, dates)
 *   nX    a count of units X: durations "6ι 43λ", clock counters "3η 17ι" (completed units, 0-based)
 *   X d   a depth chip ("η 7"), only on level chips; sentences say "η" or "Eta"
 *
 * DOM-free and unit-tested (test/ladder.test.js). `pure` is `ctx.pure` (src/core/pure.js), `model` is `ctx.model`;
 * nothing here reads the formatter, a zone, a Gregorian field or a percentage. Durations come from
 * pure.durationPos / pure.cycleLength only: this module never trims or reformats them.
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
// spans and countdowns
// ---------------------------------------------------------------------------

/** "6ι 43λ": the time left between two instants counted in ladder units (pure.between). Never negative ("0ξ"). */
export function leftText(model, pure, t1, t2, parts = 2) {
  return t2 > t1 ? pure.between(t1, t2, { parts }) : pure.durationPos(0, { parts });
}

/**
 * Length of a cycle reading `lv` (model.levelAt): "1η", "2ζ½", "1β 3γ". A whole cycle is pure.cycleLength(level)
 * (exact: 4 / P Saros, never measured between two float instants); a cycle clipped by the end of the catalogue
 * keeps its shorter, odd tail.
 */
export function lengthText(model, pure, lv) {
  if (!lv.clipped) return pure.cycleLength(lv.level);
  const P = model.levelInfo(lv.level).prefix;
  return pure.durationPos(Number(BigInt(model.extent) * P - 4n * BigInt(lv.cycleBig)) / Number(P));
}

/**
 * The hero countdown: up to three units ("1ζ½ 4η 12ι"; zero tails are dropped by pure.between), never finer
 * than the λ counter once the span is a few ι long ("34ι 12λ"), like "2 d 03 h 11 min" and "12 min 04 s" in normal mode.
 */
export function heroLeft(model, pure, t1, t2) {
  if (!(t2 > t1)) return pure.durationPos(0);
  const lead = pure.between(t1, t2, { parts: 1 }); // "1ζ½": its unit decides how many parts fit above λ
  const first = pure.UNITS.findIndex((u) => lead.endsWith(u.sym));
  const lambda = pure.UNITS.findIndex((u) => u.id === 'lambda');
  return pure.between(t1, t2, { parts: clamp(lambda - (first < 0 ? lambda : first) + 1, 2, 3) });
}

/** "2 beats", "0.4 beats", "0.001 beats": a short real-time lead counted in beats (Just before / Just after). */
export const leadBeats = (pure, seconds) => pure.beats(seconds);

/** "0.31 beats": how long a cycle too fast to count down lasts, two significant digits. */
export const periodBeats = (seconds) => {
  const n = Number(seconds.toPrecision(2));
  return `${n} ${n === 1 ? 'beat' : 'beats'}`;
};

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
 * Counter tokens of an instant, coarsest first, in the notation of pure.stamp: three ordinals, three half-cycle
 * ordinals and three clock counts: ["α#6","β#4","γ#9","δ½#3","ε½#2","ζ½#5","3η","17ι","42λ"], or null.
 */
export function counterParts(pure, t) {
  const d = pure.date(t);
  const c = pure.clock(t);
  if (!d || !c) return null;
  return [`α#${d.alpha}`, `β#${d.beta}`, `γ#${d.gamma}`, `δ½#${d.delta}`, `ε½#${d.epsilon}`, `ζ½#${d.zeta}`, `${c.eta}η`, `${c.iota}ι`, `${c.lambda}λ`];
}

/**
 * Join counter tokens `from..to` like pure.stamp: α β γ read as one group, every half-cycle ordinal is set off by a
 * dot, and the clock counts η ι λ read as one group again ("ζ½#5 · 3η 17ι").
 */
function joinCounters(parts, from, to) {
  let out = parts[from];
  for (let i = from + 1; i <= to; i++) out += (i <= 2 || i >= 7 ? ' ' : ' · ') + parts[i];
  return out;
}

/** Finest counter that tells the quarter thresholds of a cycle of each level apart (index into counterParts); none from λ down. */
const QUARTER_RESOLUTION = [1, 2, 3, 4, 5, 6, 7, 7, 8, 8];

/**
 * Where a quarter threshold of a cycle of `level` falls, as its two finest counters: "ζ½#5 · 3η", "3η 17ι".
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
 * The pure date (alpha, beta, gamma, δ½, ε½, ζ½: 1-based) of an exact position num/den, by exact integer
 * arithmetic; the same counters as `pure.date(t)` for the instant that position belongs to.
 */
export function dateAtPosition(model, num, den) {
  const unit = (level, len) => (num * model.levelInfo(level).prefix) / (len * den); // floor: the unit that contains p
  return {
    alpha: Number(unit(0, 4n)) + 1,
    beta: Number(unit(1, 4n) % 5n) + 1,
    gamma: Number(unit(2, 4n) % 13n) + 1,
    delta: Number(unit(3, 2n) % 10n) + 1,
    epsilon: Number(unit(4, 2n) % 5n) + 1,
    zeta: Number(unit(5, 2n) % 7n) + 1,
  };
}

/** "δ½#6 · ε½#5 · ζ½#4": the half-cycle ordinals of a date, as pure.dateText writes them. */
export const dateTail = (d) => `δ½#${d.delta} · ε½#${d.epsilon} · ζ½#${d.zeta}`;

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
 * date counters where it falls and a group key (the ζ½ it falls in: the pure "day" of the list).
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
    const group = String((p.num * model.levelInfo(5).prefix) / (2n * p.den));
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
 * Pure counterpart of groupByDay: the "day" of a pure list is the ζ½ an event falls in. `newDay` marks the
 * separator drawn between two groups; `clock` is the date counters shown on wide cards.
 */
export function groupByHalf(model, pure, events) {
  let prev = null;
  return events.map((e, i) => {
    const info = turnoverInfo(model, pure, e);
    const newDay = i > 0 && info.group !== prev;
    prev = info.group;
    return { ...e, dayKey: info.group, newDay, day: null, clock: info.date ? dateTail(info.date) : '' };
  });
}
