/**
 * Pure-mode wording of the rings view (docs/design/80-pure.md, SPEC §15): cycle names, coordinates on the unit ladder,
 * countdowns, "→ what begins", the help text. No Gregorian date, zone, Earth time unit or percentage appears in
 * anything produced here. Pure functions of their inputs: `pure` is `createPure(model)` (core/pure.js) and `model` is
 * `createModel()`; both are passed in so the module stays testable without a browser.
 *
 * Revision 3 of the vocabulary splits the ladder in two:
 *   MAJOR rings α β γ δ   said in WORDS with their quarter ("Delta Trifracton End"); their phase is never drawn (no
 *                         glyph pair): the quarter word takes its place.
 *   MINOR rings           said by where the cycle starts in its Nuclide ("ε#5 34η 29ι"), with the phase pair. The units
 *                         are ε Nuclide (ordinal), η Helion (numbered 1–77 in the Nuclide, like the day of a month), ι Preon,
 *                         λ Flavon, ν Blink (counts of completed units from 0); the depths between them (ζ θ κ μ) are no
 *                         units: their cycles are 11η, 4ι, 13λ and 5ν long.
 *
 * The notation is the one of core/pure.js (read its header comment):
 *   X#n  an ordinal, 1-based: `δ#3`, `ε#5`              nX  a count of units, 0-based: `29ι 21λ`, spans `6ι 43λ`;
 *                                                         the Helion of a date is numbered from 1: `34η` (1η … 77η)
 *   X d  a depth chip, only on level chips: `η 7`
 *
 * A "coordinate" is the pure replacement of a date + time of day: the stamp of core/pure.js, cut to a resolution.
 *   date  the ordinals the instant sits in:  `δ#3 ε#5`   (α β γ δ ε)
 *   time  the Helion and the counts:         `34η 29ι`   (η 1–77, then ι 0–35, λ 0–64, ν 0–24)
 * and, like a clock, its resolution follows the length of the cycle it labels (a cycle's quarter is the step). Below one
 * Blink (the ν and ξ rings) the ν count gets decimals: `3.43ν`.
 *
 * Durations are never measured or trimmed here: they come from `pure.between` / `pure.durationPos` /
 * `pure.cycleLength` (a whole cycle has its exact nominal length, never the difference of two floats). Real
 * time (how long a turn lasts for the device) is counted in Blinks: `blinkSpan`.
 */
import { levelTag } from './text.js';

const QUARTERS = ['peak', 'node', 'valley', 'end'];
/**
 * The digits of a coordinate, longest first: ids of `pure.UNITS` (the ordinals α β γ δ ε, the Helion numbered from 1, then
 * the counts ι λ ν),
 * followed by three virtual digits: the first, second and third decimal of the ν count (a count of Blinks finer than
 * one). `resolutionIndex` returns an index into this list.
 */
export const COORD = Object.freeze(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'eta', 'iota', 'lambda', 'nu', 'nu.1', 'nu.2', 'nu.3']);
/** Index of ε in `COORD`: the ordinal tokens are α#, β#, γ#, δ#, ε#; the counts start after it. */
const LAST_ORDINAL = 4;
/** Index of ν in `COORD`: the finest whole digit; the entries after it are its decimals. */
const NU = 8;
/** The symbol of digit `i` of a coordinate ("ε", "λ"; the decimals of ν read "ν"). */
export const coordSym = (pure, i) => pure.unitOf(COORD[Math.min(i, NU)]).sym;
/** The level of the unit a placing count is given in, by its symbol (the colour of an address token). */
const LEVEL_OF_SYM = Object.freeze({ η: 6, ι: 8, λ: 10, ν: 12 });

/**
 * The fields of an instant: 1-based ordinals (α β γ δ ε), the Helion (1–77) and the 0-based counts (ι λ ν, `pure.clock`), plus `frac`, how
 * far the running ν (Blink) has travelled (0..1: the decimals of the ν count below one Blink).
 * @returns {null | {ord:number[], count:number[], frac:number}} null outside the catalogue
 */
export function pureFields(pure, model, t) {
  const d = pure.date(t);
  const c = pure.clock(t);
  if (!d || !c) return null;
  return {
    ord: [d.alpha, d.beta, d.gamma, d.delta, d.epsilon],
    count: [c.eta, c.iota, c.lambda, c.nu],
    frac: model.levelAt(t, 12)?.phase ?? 0,
  };
}

/**
 * The same fields of an exact position `num / den` (Saros units, BigInt), by integer arithmetic on the level
 * table instead of a reading of the model, which never reports an instant at or past the catalogue's closing
 * edge (it reads 1 ms inside, so a boundary that coincides with the edge would show the previous unit).
 * A position on a boundary reads as the state that starts there, like every other threshold label.
 */
export function fieldsAtPosition(model, num, den = 1n) {
  const info = (level) => model.levelInfo(level);
  // whole cycles of `level` completed at the position
  const done = (level) => (num * info(level).prefix) / (4n * den);
  const local = (level) => {
    const sib = info(level).siblings;
    const n = done(level);
    return Number(sib === null ? n : n % BigInt(sib));
  };
  // a count of the minor ladder is the local index of a unit level plus whole cycles of the depth between it and its parent;
  // the Helion is numbered from 1 in its Nuclide (like the day of a month), the finer units are counts from 0
  const count = (between, unit) => local(between) * info(unit).siblings + local(unit);
  const nuWhole = (num * info(12).prefix) / (4n * den);
  const nuRest = num * info(12).prefix - nuWhole * 4n * den;
  return {
    ord: [Number(done(0)) + 1, local(1) + 1, local(2) + 1, local(3) + 1, local(4) + 1],
    count: [count(5, 6) + 1, count(7, 8), count(9, 10), count(11, 12)],
    frac: Number(nuRest) / Number(4n * den),
  };
}

/**
 * Nominal length of a cycle of `level` in Saros position units: only to pick the resolution of a coordinate
 * (`resolutionIndex`). Text lengths come from `pure.cycleLength`.
 */
export const cycleSpanPos = (model, level) => 4 / model.levelInfo(level).prefixNum;

/**
 * Index into `COORD` of the largest digit that fits `divisor` times into a span of `spanPos` Saros units:
 * the resolution a coordinate needs to tell the quarters of a cycle apart (divisor 4) or a pointer position (160).
 * Past the Blink the digits are the decimals of its count; the third decimal is the floor.
 */
export function resolutionIndex(pure, spanPos, divisor = 4) {
  const step = spanPos / divisor;
  const nu = pure.unitPos(pure.unitOf('nu'));
  const lengths = COORD.map((id, i) => (i > NU ? nu / 10 ** (i - NU) : pure.unitPos(pure.unitOf(id))));
  const i = lengths.findIndex((len) => len <= step * (1 + 1e-9));
  return i < 0 ? COORD.length - 1 : i;
}

/** A boundary instant is read 1 ms into the state that starts there (the way the jump buttons land on it). */
const NUDGE = 0.001;

/** Every ordinal is `sym#n`: α#6 β#4 γ#9 δ#3 ε#5, exactly as `pure.stamp` writes them (no separators). */
const ordinalToken = (pure, i, n) => `${coordSym(pure, i)}#${n}`;

/** "3.43": the ν count with `dec` decimals, floored (a count never reads further along than it is). */
function nuCount(whole, frac, dec) {
  const k = 10 ** dec;
  return (Math.floor((whole + frac) * k + 1e-7) / k).toFixed(dec);
}
/**
 * The coordinate text of already-read fields at resolution `res` (an index into COORD; see `whenParts`): the stamp down
 * to that digit, cut into `time`, its trailing counts (at most `timeTokens`), and `date`, the `dateTokens` tokens just
 * before them (ordinals, or the coarser counts when the counts are cut: a λ ring reads "ε#5 34η" / "29ι 21λ 0ν", so the
 * two parts always join into a piece of the stamp).
 */
function partsOf(pure, f, res, { dateTokens = 3, timeTokens = 6 } = {}) {
  const tokens = [];
  for (let i = 0; i <= Math.min(res, LAST_ORDINAL); i++) tokens.push(ordinalToken(pure, i, f.ord[i]));
  const lastDigit = Math.min(res, NU);
  for (let i = LAST_ORDINAL + 1; i <= lastDigit; i++) {
    const n = f.count[i - LAST_ORDINAL - 1];
    // below a Blink the ν count carries its decimals ("3.43ν"): the quarters of a ν or ξ cycle then tell themselves apart
    tokens.push(`${i === NU && res > NU ? nuCount(n, f.frac ?? 0, res - NU) : n}${coordSym(pure, i)}`);
  }
  const counts = Math.max(0, lastDigit - LAST_ORDINAL);
  const cut = tokens.length - Math.min(timeTokens, counts);
  return { date: tokens.slice(Math.max(0, cut - dateTokens), cut).join(' '), time: tokens.slice(cut).join(' ') };
}
/**
 * Fields of a boundary instant: 1 ms into the state that starts there; the catalogue's closing edge (a threshold at
 * or within a millisecond of it, or anything beyond) reads from its exact position.
 */
function fieldsAt(pure, model, t) {
  if (t + NUDGE >= model.tMax) return fieldsAtPosition(model, BigInt(model.extent));
  return pureFields(pure, model, t + NUDGE);
}

/**
 * Coordinate of instant `t` at resolution `res` (an index into `COORD`).
 * @param {{dateTokens?:number, timeTokens?:number}} [o]  how many trailing ordinal / count tokens to keep (the rest is context)
 * @returns {{date:string, time:string}}  `date` "δ#3 ε#5", `time` "34η 29ι" ('' when the resolution is coarser than η)
 */
export function whenParts(pure, model, t, res, o) {
  const f = fieldsAt(pure, model, t);
  return f ? partsOf(pure, f, res, o) : { date: '—', time: '' };
}

/** `whenParts` on one line, as the stamp writes it: "δ#3 ε#5 34η 29ι". */
export function whenText(pure, model, t, res, o) {
  const { date, time } = whenParts(pure, model, t, res, o);
  return [date, time].filter(Boolean).join(' ');
}

/** Coordinate of a boundary of a cycle of `level` (resolves its quarters): the labels under the wave and the chips. */
export function boundaryParts(pure, model, level, t, o) {
  return whenParts(pure, model, t, resolutionIndex(pure, cycleSpanPos(model, level)), o);
}

/**
 * The five boundary labels of a cycle (begin, peak, node, valley, end), `times` as in `levelAt(...).thresholds`
 * (null: beyond the catalogue). Like a clock under a date, the ordinals are written once and repeated only where
 * they change: `date` is '' when the previous label already says it. `alt` holds the same label with less and less
 * context (for plots too narrow for five long ones); `sameAsStart` tells a chip the cycle has not left its first ordinal.
 * @returns {({date:string, time:string, alt:{date:string,time:string}[], sameAsStart:boolean, full:{date:string,time:string}} | null)[]}
 */
export function boundaryLabels(pure, model, level, times) {
  const res = resolutionIndex(pure, cycleSpanPos(model, level));
  const fields = times.map((t) => (t === null || t === undefined ? null : fieldsAt(pure, model, t)));
  const at = (f, o) => (f ? partsOf(pure, f, res, o) : null);
  const full = fields.map((f) => at(f, { dateTokens: 2, timeTokens: 3 }));
  const short = fields.map((f) => at(f, { dateTokens: 1, timeTokens: 2 }));
  const tiny = fields.map((f) => at(f, { dateTokens: 1, timeTokens: 1 }));
  return full.map((p, i) => {
    if (!p) return null;
    let prev = null;
    for (let k = i - 1; k >= 0 && !prev; k--) prev = full[k];
    const sameAsPrev = !!(prev && p.time && prev.date === p.date);
    const less = (q, noDate) => ({ date: sameAsPrev || (noDate && q.time) ? '' : q.date, time: q.time });
    return {
      date: sameAsPrev ? '' : p.date,
      time: p.time,
      alt: [less(short[i]), less(tiny[i], true)],
      sameAsStart: !!(full[0] && p.time && full[0].date === p.date),
      full: p,
    };
  });
}

/**
 * What the facts of the phase card say that does not change while the cycle runs, worked out once per cycle: the
 * coordinates of its start and end, what begins at its end, and its length on the ladder.
 */
export function factParts(pure, model, level, lv) {
  const res = resolutionIndex(pure, cycleSpanPos(model, level));
  const o = { dateTokens: 3, timeTokens: 3 };
  return {
    start: whenParts(pure, model, lv.start, res, o),
    end: whenParts(pure, model, lv.end, res, o),
    endLine: endLine(pure, model, level, lv),
    length: lengthText(pure, level, lv),
    lengthNamed: lengthWithName(pure, level, lv),
  };
}

/** The short text that follows the pointer over the wave: finer than a boundary label. */
export function pointerText(pure, model, level, t) {
  return whenText(pure, model, t, resolutionIndex(pure, cycleSpanPos(model, level), 160), { dateTokens: 1 });
}

// ---------------------------------------------------------------------------------------------
// names and sentences
// ---------------------------------------------------------------------------------------------

/** The exact global index of a reading (BigInt where the model gives one). */
export const bigOf = (lv) => lv.cycleBig ?? BigInt(lv.cycle);

/** Is this a major ring (α β γ δ: words and a quarter, never a phase pair)? */
export const isMajor = (pure, level) => pure.isMajor(level);

/** The quarter word of a reading: Peak, Node, Valley or End (the threshold that ends the quarter it is in). */
export const quarterWord = (pure, lv) => pure.QUARTER_WORDS[Math.min(3, Math.max(0, Math.floor(lv.phase * 4)))];

/**
 * The cycle shown by reading `lv` of `level`: a major one in words ("Delta Trifracton"), a minor one by where it starts
 * in its Nuclide ("ε#5", "ε#5 34η", "ε#5 34η 28ι").
 */
export const cycleName = (pure, level, lv) => pure.cycleName(level, bigOf(lv));

/** The name with the quarter of a major cycle ("Delta Trifracton End"); a minor cycle has its placing only. */
export const displayName = (pure, level, lv) => (pure.isMajor(level) ? `${cycleName(pure, level, lv)} ${quarterWord(pure, lv)}` : cycleName(pure, level, lv));

/**
 * What begins when the cycle `lv` ({cycle, cycleBig, end, clipped}) of `level` ends, said as briefly as the context
 * allows, or null when the catalogue ends there:
 *   major  "Delta Tetrafracton"            ε  "ε#4", or "ε#1 of Delta Tetrafracton" when the Delta turns over
 *   finer  only the placing counts that change: "35η", "30ι", "35η 0ι"; "ε#1 1η" when the Nuclide turns over
 */
export function followerName(pure, model, level, lv) {
  if (lv.clipped || lv.end >= model.tMax - 1e-6) return null;
  const big = bigOf(lv);
  const next = big + 1n;
  if (level < 4) return pure.cycleName(level, next);
  const a = pure.countsAtStart(level, big);
  const b = pure.countsAtStart(level, next);
  if (level === 4) return a.delta === b.delta ? `ε#${b.epsilon}` : `ε#${b.epsilon} of ${pure.periodName(3, b.delta)}`;
  if (a.delta !== b.delta || a.epsilon !== b.epsilon) return pure.cycleName(level, next);
  const was = pure.cycleName(level, big, { short: true }).split(' ');
  const now = pure.cycleName(level, next, { short: true }).split(' ');
  const i = now.findIndex((part, k) => part !== was[k]);
  return now.slice(Math.max(0, i)).join(' ');
}

/** "→ 35η begins" / "→ Delta Tetrafracton begins" (what the end of the cycle is), or "→ end of the catalogue". */
export function endLine(pure, model, level, lv) {
  const next = followerName(pure, model, level, lv);
  return next ? `→ ${next} begins` : '→ end of the catalogue';
}

/** "ends → 35η begins" / "the catalogue ends here". */
export function endsSentence(pure, model, level, lv) {
  const next = followerName(pure, model, level, lv);
  return next ? `ends → ${next} begins` : 'the catalogue ends here';
}

/**
 * The span between two instants counted on the ladder: "6ι 43λ" (no "in"); up to `parts` non-zero counts, longest
 * first, zero units skipped by the core. Negative when `to` is before `from` ("−20ι 21λ").
 */
export const between = (pure, from, to, parts = 2) => pure.between(from, to, { parts });

/**
 * The big countdown in the middle of the dial: two counts, or three while the third stays steady (never finer than
 * λ: a λ or coarser changes at most every 7.8 s of real time, a ν would flicker). "6ι 43λ" or "10η 6ι 43λ". A compact
 * dial has no room for a third count: two. A span that leads with a λ or something finer has no steady third count
 * either, and reads as the core writes it ("21λ 3ν", "16ν").
 */
export function centreSpan(pure, model, from, to, { compact = false } = {}) {
  const a = model.positionOf(from);
  const b = model.positionOf(to);
  if (compact || a === null || b === null) return between(pure, from, to, 2);
  const d = Math.max(0, b - a);
  const lam = pure.unitOf('lambda');
  if (pure.decompose(d, 1)[0].unit.level >= lam.level) return pure.durationPos(d, { parts: 2 });
  // count only down to whole Flavons: the counts of the longer units are then the ones the core would give
  const len = pure.unitPos(lam);
  const steady = Math.floor((d + pure.EPS_POS) / len) * len;
  return pure.durationPos(steady, { parts: 3 });
}

/** "in 6ι 43λ" / "5ι 2λ ago". */
export const inText = (pure, now, t, parts = 2) => (t >= now ? `in ${between(pure, now, t, parts)}` : `${between(pure, t, now, parts)} ago`);

/** "starts in 2ε 10η" / "started 2η ago" / "running now". */
export function startPhrase(pure, start, end, now) {
  if (now >= start && now < end) return 'running now';
  return start > now ? `starts ${inText(pure, now, start)}` : `started ${inText(pure, now, start)}`;
}

/**
 * How long the cycle `cyc` ({start, end, clipped}) of `level` lasts: the exact nominal length of a whole cycle
 * ("1δ", "1η", ζ "11η", θ "4ι", ξ "0.14ν"), never the difference of two float instants; only a cycle clipped by the end
 * of the catalogue, which is shorter than its kind, is measured.
 */
export const lengthText = (pure, level, cyc) => (cyc.clipped ? pure.between(cyc.start, cyc.end) : pure.cycleLength(level));

/** How many of the next unit make one cycle of a unit level, and that unit's symbol: δ 5ε, ε 77η, η 36ι, ι 65λ, λ 25ν. */
const NEXT_UNIT = Object.freeze({ 0: [5, 'β'], 1: [13, 'γ'], 2: [5, 'δ'], 3: [5, 'ε'], 4: [77, 'η'], 6: [36, 'ι'], 8: [65, 'λ'], 10: [25, 'ν'] });

/**
 * The unit a whole cycle of `level` is ("Helion"), or '' where there is none to say: a major cycle is said in words
 * already, the depths between the units (ζ θ κ μ) and below the Blink (ξ) are no units.
 */
export function unitNote(pure, level) {
  return pure.levelKind(level) === 'unit' ? pure.unitName(level) : '';
}
/**
 * `lengthText` with what one cycle is made of, for the Length fact and the sector tooltips: a major "1δ = 5ε", a unit
 * "1η (Helion) = 36ι" (the Blink: "1ν (Blink)"), a depth between "11η", ξ "0.14ν"; a clipped cycle is just measured.
 */
export function lengthWithName(pure, level, cyc) {
  const text = lengthText(pure, level, cyc);
  if (cyc.clipped) return text;
  const name = unitNote(pure, level);
  const made = NEXT_UNIT[level] ? ` = ${NEXT_UNIT[level][0]}${NEXT_UNIT[level][1]}` : '';
  return `${text}${name ? ` (${name})` : ''}${made}`;
}

/**
 * A span of real (device) time counted in Blinks, the one word for real time: "325 Blinks", "58 500 Blinks",
 * "0.143 Blinks". The ladder is a product of whole factors, so a cycle's mean length is a whole number of Blinks: from
 * 100 on it is rounded to the Blink ("1 625", where pure.blinks keeps three digits, "1 630").
 */
export function blinkSpan(pure, seconds) {
  const n = seconds / pure.blinkSeconds();
  if (n >= 100) return `${pure.groupDigits(Math.round(n))} ${pure.BLINK}s`;
  return pure.blinks(seconds);
}

/** Length of one turn of a ring in real time ("about 325 Blinks"): for a sentence or a ring too fast to follow. */
export const aboutTurn = (pure, info) => blinkSpan(pure, info.meanSeconds);

// ---------------------------------------------------------------------------------------------
// threshold chips
// ---------------------------------------------------------------------------------------------

/**
 * What one quarter chip says. `k` 0..3 = peak, node, valley, end; `t` the instant (null: beyond the catalogue);
 * `label` its entry of `boundaryLabels` (read once per cycle): the chip leaves out the ordinals of the cycle's own
 * start, as a clock under its date would. Only the countdown is worked out here, on every call.
 * @returns {{count:string, date:string, time:string, title:string, label:string}}  `label` is what a screen reader says
 */
export function chipText(pure, model, level, lv, k, t, now, label) {
  const name = QUARTERS[k];
  if (t === null || t === undefined || !label) {
    const none = `${name}: beyond the end of the catalogue`;
    return { count: '', date: '—', time: '', title: none, label: none };
  }
  const of = cycleName(pure, level, lv);
  const w = label.full;
  const where = [w.date, w.time].filter(Boolean).join(' ');
  const count = between(pure, now, t); // "6ι 43λ" ahead, "−20ι 21λ" once passed
  const next = followerName(pure, model, level, lv);
  const what = k === 3 ? `the end of ${of} (${next ? `${next} begins` : 'the catalogue ends'})` : `the ${name} of ${of}`;
  const when = inText(pure, now, t);
  return {
    count,
    date: label.sameAsStart && w.time ? '' : w.date,
    time: w.time,
    title: `${lv.quarter > k ? 'Jump back to' : 'Jump just past'} ${what} · ${where} · ${when}`,
    label: `${what}, ${when}, at ${where}`,
  };
}

// ---------------------------------------------------------------------------------------------
// facts of the phase card
// ---------------------------------------------------------------------------------------------

/**
 * "phase 13 and 4 of 256": the two glyphs in words, exactly as `pure.pairHTML` labels them (a bare "13·4" is read as
 * the number 13.4). Taken from the helper's own markup so the words can never drift from it; `label` is the word in front.
 */
export function pairLabel(pure, phase, label = 'phase') {
  const m = /aria-label="([^"]*)"/.exec(pure.pairHTML(phase, { label }));
  if (m) return m[1];
  const p = pure.pair(phase);
  return `${label} ${p.hi} and ${p.lo} of 256`;
}

/**
 * The phase fact of the phase card: the pair in words for a minor cycle, the quarter for a major one ("End quarter"),
 * whose phase is never shown as a pair.
 */
export const stateText = (pure, phase, level = 6) => (pure.isMajor(level) ? `${quarterWord(pure, { phase })} quarter` : pairLabel(pure, phase));

/**
 * The address of cycle `cycleBig` of `level`, as tokens with the level that colours them: the ordinals of the major
 * periods and the Nuclide (`α#6 β#4 γ#9 δ#3 ε#5`), then the Helion and the counts that place a minor cycle in it (`34η 29ι`).
 */
export function addressTokens(pure, model, level, cycleBig) {
  const path = model.cycleToPath(level, cycleBig);
  const out = path.slice(0, Math.min(level, 4) + 1).map((n, l) => ({ level: l, text: pure.shortName(l, n) }));
  if (level >= 5) for (const text of pure.cycleName(level, cycleBig, { short: true }).split(' ')) out.push({ level: LEVEL_OF_SYM[text.at(-1)] ?? level, text });
  return out;
}

/**
 * Slider text for assistive technology: "Rising, phase 13 and 4 of 256 in ε#5 34η" for a minor cycle,
 * "Falling, End quarter of Delta Trifracton" for a major one.
 */
export const sliderText = (pure, word, phase, name, level = 6) =>
  pure.isMajor(level) ? `${word}, ${stateText(pure, phase, level)} of ${name}` : `${word}, ${pairLabel(pure, phase)} in ${name}`;

// ---------------------------------------------------------------------------------------------
// the "How to read" panel
// ---------------------------------------------------------------------------------------------

/** Sentence about how deep the rings go, in turns of real time counted in Blinks. */
export function depthRangeNote(pure, opening, finest) {
  return `The dial opens with ${levelTag(opening)} as its innermost ring (one turn takes about ${aboutTurn(pure, opening)}); the Depth control goes on down to ${levelTag(finest)}, whose turn lasts about ${aboutTurn(pure, finest)}.`;
}

/** Inner HTML of the help panel's `<dl>` in pure vocabulary. */
export function helpHTML(pure, opening, finest) {
  return `
        <div><dt>Labels</dt><dd>The four outer rings are the major periods, said in words: <b>Delta Trifracton End</b> is the 3rd Delta of its Gamma (Monofracton is the 1st, Difracton the 2nd, and so on), in the quarter that ends at its end; Peak, Node, Valley and End are the four quarters. Every finer ring is named by where its cycle starts in its Nuclide: <b>ε#5 34η 29ι</b> (the 34th Helion of the 5th Nuclide, 29 Preons into it). <b>η 7 · 1/11</b> is the depth chip with the place in the parent depth: depth 7, the 1st of the 11 η cycles of its ζ (a ζ is 11 Helions). The pill says what the glyph is doing now and which threshold comes next.</dd></div>
        <div><dt>Rings</dt><dd>Every ring is one cycle. The outermost, α, spans four Saros intervals (${pure.catalogueText()} cover the whole catalogue); each ring inside it is the next harmonic, 4 to 13 times shorter. ${depthRangeNote(pure, opening, finest)}</dd></div>
        <div><dt>Arc and dot</dt><dd>The arc grows clockwise from the top as the cycle runs; the dot is the hand, exactly where we are in that cycle. Rings too fast to follow dissolve into a glow.</dd></div>
        <div><dt>Sectors</dt><dd>A ring is cut into the child cycles it contains. The tinted sector is the one running now, and the funnel shows it opening up into the whole next ring.</dd></div>
        <div><dt>Quarters</dt><dd>Beads at the right, the bottom and the left mark peak, node and valley; they fill in as they are passed. The selected ring is labelled.</dd></div>
        <div><dt>Centre</dt><dd>Countdown to the end of the selected cycle, what begins there, and its four thresholds, each with its countdown and its place on the clock of the header: δ#3 ε#5 names the Delta and the Nuclide it falls in, 34η 9ι the Helion of that Nuclide (its number) and the Preons completed in that Helion. A minor cycle shows how far through it you are as two glyphs, 256 states; a major one shows its quarter instead.</dd></div>
        <div><dt>Counting</dt><dd>Ordinals (Delta Trifracton, δ#3, ε#5) and the Helion of a date are numbered from 1 (1η … 77η in a Nuclide); Preons, Flavons and Blinks (ι λ ν) count completed units from 0. The units below Delta skip every other depth: a Nuclide is 77 Helions, a Helion 36 Preons, a Preon 65 Flavons, a Flavon 25 Blinks. The Helion is the basic reading, Preons and Flavons the fine time; the depths between (ζ θ κ μ) are 11η, 4ι, 13λ and 5ν long. Spans are always counts: 6ι 43λ. Real time is counted in Blinks. Press ? for the glossary.</dd></div>
        <div><dt>Navigate</dt><dd>Click a sector to jump to the start of that child cycle, a label to select a ring, drag the wave cursor to scrub inside the cycle. On a touch screen, tap a ring or sector (or touch and hold it) to see what it is, and tap the same sector again to jump. The thresholds in the centre jump to that moment of the selected cycle, passed ones included.</dd></div>
      `;
}
