/**
 * Pure-mode wording of the rings view (docs/design/80-pure.md): cycle names, coordinates on the unit ladder,
 * countdowns, "→ the cycle that begins", the help text. No Gregorian date, zone, Earth time unit or percentage
 * appears in anything produced here. Pure functions of their inputs: `pure` is `createPure(model)` (core/pure.js)
 * and `model` is `createModel()`; both are passed in so the module stays testable without a browser.
 *
 * The notation is the one of core/pure.js (read its header comment):
 *   X#n  an ordinal, 1-based: `ζ#5`, `α#6`, `η#1`          nX  a count of units: `1θ 2ι`, `0η 29ι 21λ` (0-based clock)
 *   X d  a depth chip, only on level chips: `η 7`
 *
 * One unit per depth, whole cycles only (revision 2): a ζ is a Hadron, an η a Helion, a ν a Blink.
 *
 * A "coordinate" is the pure replacement of a date + time of day. It has the same two parts:
 *   date  the ordinals of the cycles the instant sits in:      `ε#2 · ζ#5`   (what a calendar date is to a day)
 *   time  the counters of the finer cycles since the ζ start:  `3η 17ι`      (what a clock reading is to a day)
 * and, like a clock, its resolution follows the length of the cycle it labels (a cycle's quarter is the step).
 * The digits are the header clock's: α β γ δ ε ζ as ordinals, then η ι λ (the clock) and μ ν (inside their parent);
 * θ and κ are units of the ladder but not digits of the clock. Below one Blink (the ξ ring) the ν counter gets
 * decimals: `3.14ν`.
 *
 * Durations are never measured or trimmed here: they come from `pure.between` / `pure.durationPos` /
 * `pure.cycleLength` (a whole cycle has its exact nominal length, never the difference of two floats). Real
 * time (how long a turn lasts for the device) is counted in Blinks: `blinkSpan`.
 */
import { levelTag } from './text.js';

const QUARTERS = ['peak', 'node', 'valley', 'end'];
/**
 * The digits of a coordinate, longest first: ids of `pure.UNITS` (six ordinals, then the counters η ι λ μ ν), followed
 * by three virtual digits: the first, second and third decimal of the ν counter (a count of Blinks finer than one).
 * `resolutionIndex` returns an index into this list.
 */
export const COORD = Object.freeze(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'iota', 'lambda', 'mu', 'nu', 'nu.1', 'nu.2', 'nu.3']);
/** Index of ζ in `COORD`: the ordinal tokens are α#, β#, γ#, δ#, ε#, ζ#; the counters start after it. */
const LAST_ORDINAL = 5;
/** Index of ν in `COORD`: the finest whole digit; the entries after it are its decimals. */
const NU = 10;
/** The symbol of digit `i` of a coordinate ("ζ", "λ"; the decimals of ν read "ν"). */
export const coordSym = (pure, i) => pure.unitOf(COORD[Math.min(i, NU)]).sym;

/**
 * The fields of an instant: 1-based ordinals (α β γ δ ε ζ) and 0-based counters (η ι λ μ ν), plus `frac`, how far the
 * running ν (Blink) has travelled (0..1: the decimals of the ν counter below one Blink).
 * @returns {null | {ord:number[], count:number[], frac:number}} null outside the catalogue
 */
export function pureFields(pure, model, t) {
  const d = pure.date(t);
  const c = pure.clock(t);
  if (!d || !c) return null;
  const sub = (level) => model.levelAt(t, level)?.local ?? 0; // μ ν within their parent
  return {
    ord: [d.alpha, d.beta, d.gamma, d.delta, d.epsilon, d.zeta],
    count: [c.eta, c.iota, c.lambda, sub(11), sub(12)],
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
  const nuWhole = (num * info(12).prefix) / (4n * den);
  const nuRest = num * info(12).prefix - nuWhole * 4n * den;
  return {
    ord: [Number(done(0)) + 1, local(1) + 1, local(2) + 1, local(3) + 1, local(4) + 1, local(5) + 1],
    count: [local(6), local(7) * info(8).siblings + local(8), local(9) * info(10).siblings + local(10), local(11), local(12)],
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
 * Past the Blink the digits are the decimals of its counter; the third decimal is the floor.
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

/** Every ordinal is `sym#n`: α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#5, exactly as `pure.dateText` writes them. */
const ordinalToken = (pure, i, n) => `${coordSym(pure, i)}#${n}`;
/** The first three ordinals sit together (`α#6 β#4 γ#9`), the others are set off (`· δ#3 · ε#2`), as in `pure.stamp`. */
function joinOrdinals(tokens, firstIndex) {
  let out = '';
  tokens.forEach((tok, k) => {
    const i = firstIndex + k;
    out += k === 0 ? tok : i < 3 ? ` ${tok}` : ` · ${tok}`;
  });
  return out;
}

/** "3.14": the ν counter with `dec` decimals, floored (a count never reads further along than it is). */
function nuCount(whole, frac, dec) {
  const k = 10 ** dec;
  return (Math.floor((whole + frac) * k + 1e-7) / k).toFixed(dec);
}
/** The coordinate text of already-read fields at resolution `res` (an index into COORD; see `whenParts`). */
function partsOf(pure, f, res, { dateTokens = 3, timeTokens = 6 } = {}) {
  const last = Math.min(res, LAST_ORDINAL);
  const first = Math.max(0, last - dateTokens + 1);
  const tokens = [];
  for (let i = first; i <= last; i++) tokens.push(ordinalToken(pure, i, f.ord[i]));
  const time = [];
  const lastDigit = Math.min(res, NU);
  for (let i = Math.max(LAST_ORDINAL + 1, lastDigit - timeTokens + 1); i <= lastDigit; i++) {
    const n = f.count[i - LAST_ORDINAL - 1];
    // below a Blink the ν counter carries its decimals ("3.14ν"): the quarters of a ν or ξ cycle then tell themselves apart
    time.push(`${i === NU && res > NU ? nuCount(n, f.frac ?? 0, res - NU) : n}${coordSym(pure, i)}`);
  }
  return { date: joinOrdinals(tokens, first), time: time.join(' ') };
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
 * @param {{dateTokens?:number, timeTokens?:number}} [o]  how many trailing ordinal / counter tokens to keep (the rest is context)
 * @returns {{date:string, time:string}}  `date` "ε#2 · ζ#5", `time` "3η 17ι" ('' when the resolution is coarser than η)
 */
export function whenParts(pure, model, t, res, o) {
  const f = fieldsAt(pure, model, t);
  return f ? partsOf(pure, f, res, o) : { date: '—', time: '' };
}

/** `whenParts` on one line: "ε#2 · ζ#5 · 3η 17ι". */
export function whenText(pure, model, t, res, o) {
  const { date, time } = whenParts(pure, model, t, res, o);
  return [date, time].filter(Boolean).join(' · ');
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
 * coordinates of its start and end, the cycle that begins at its end, and its length on the ladder.
 */
export function factParts(pure, model, level, lv) {
  const res = resolutionIndex(pure, cycleSpanPos(model, level));
  const o = { dateTokens: 3, timeTokens: 3 };
  return {
    start: whenParts(pure, model, lv.start, res, o),
    end: whenParts(pure, model, lv.end, res, o),
    endLine: endLine(pure, model, level, lv),
    length: lengthText(pure, level, lv),
    lengthNamed: lengthWithName(pure, level, lv, model.levelInfo(level)),
  };
}

/** The short text that follows the pointer over the wave: finer than a boundary label. */
export function pointerText(pure, model, level, t) {
  return whenText(pure, model, t, resolutionIndex(pure, cycleSpanPos(model, level), 160), { dateTokens: 1 });
}

// ---------------------------------------------------------------------------------------------
// names and sentences
// ---------------------------------------------------------------------------------------------

/** "Eta Monofracton": the cycle shown by reading `lv` of `level`. */
export const cycleName = (pure, level, lv) => pure.cycleName(level, lv.cycle);

/** Name of the cycle that begins when `lv` ends, or null when the catalogue ends there. */
export function followerName(pure, model, level, lv) {
  if (lv.clipped || lv.end >= model.tMax - 1e-6) return null;
  return pure.cycleName(level, lv.cycle + 1);
}

/** "→ Eta Difracton" (what the end of the cycle is), or "→ end of the catalogue". */
export function endLine(pure, model, level, lv) {
  const next = followerName(pure, model, level, lv);
  return next ? `→ ${next}` : '→ end of the catalogue';
}

/** "ends → Eta Difracton begins" / "catalogue ends". */
export function endsSentence(pure, model, level, lv) {
  const next = followerName(pure, model, level, lv);
  return next ? `ends → ${next} begins` : 'the catalogue ends here';
}

/**
 * The span between two instants counted on the ladder: "1θ 2ι" (no "in"); up to `parts` non-zero counts, longest
 * first, zero units skipped by the core. Negative when `to` is before `from` ("−1θ 2ι").
 */
export const between = (pure, from, to, parts = 2) => pure.between(from, to, { parts });

/**
 * The big countdown in the middle of the dial: two counts, or three while the third stays steady (never finer than
 * λ: a λ or coarser changes at most every 7.8 s, a μ would flicker). "1θ 2ι" or "1ζ 4η 2θ". A compact dial has no
 * room for a third count: two. A span that leads with a λ or something finer has no steady third count either, and
 * reads as the core writes it ("5λ 1μ", "3μ 2ν").
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

/** "in 1θ 2ι" / "5ι 2λ ago". */
export const inText = (pure, now, t, parts = 2) => (t >= now ? `in ${between(pure, now, t, parts)}` : `${between(pure, t, now, parts)} ago`);

/** "starts in 4ε 1ζ" / "started 2η ago" / "running now". */
export function startPhrase(pure, start, end, now) {
  if (now >= start && now < end) return 'running now';
  return start > now ? `starts ${inText(pure, now, start)}` : `started ${inText(pure, now, start)}`;
}

/**
 * How long the cycle `cyc` ({start, end, clipped}) of `level` lasts: the exact nominal length of a whole cycle
 * ("1η"; the ξ ring "0.14ν"), never the difference of two float instants; only a cycle clipped by the end of the
 * catalogue, which is shorter than its kind, is measured.
 */
export const lengthText = (pure, level, cyc) => (cyc.clipped ? pure.between(cyc.start, cyc.end) : pure.cycleLength(level));

/**
 * The name of the unit a whole cycle of `level` is one of ("Helion"), or '' where there is none to say (α β γ read as
 * their level names, the ξ ring is a part of a Blink). For the tooltips and the Length fact, which explain a unit.
 */
export function unitNote(pure, info) {
  const u = pure.unitOf(info.letter);
  return u?.named ? u.name : '';
}
/** `lengthText` followed by the unit's name where the cycle is a whole one: "1ζ (Hadron)", "3η 2ι" for a clipped one. */
export function lengthWithName(pure, level, cyc, info) {
  const text = lengthText(pure, level, cyc);
  const name = cyc.clipped ? '' : unitNote(pure, info);
  return name ? `${text} (${name})` : text;
}

/**
 * A span of real (device) time counted in Blinks, the one word for real time: "325 Blinks", "58 500 Blinks",
 * "0.143 Blinks". Long ones get digit groups. (pure.blinks writes "58500".)
 */
export function blinkSpan(pure, seconds) {
  const n = seconds / pure.blinkSeconds();
  // the ladder is a product of whole factors, so a cycle's mean length is a whole number of Blinks (1 625, 58 500)
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
  const where = [w.date, w.time].filter(Boolean).join(' · ');
  const count = between(pure, now, t); // "1θ 2ι" ahead, "−5θ 1κ" once passed
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

/** The glyph fact of the phase card: the pair in words. */
export const stateText = (pure, phase) => pairLabel(pure, phase);

/** Address of cycle `cycleBig` of `level` as ordinal tokens `α#6`, `β#4` … (one per level, shallowest first). */
export const addressTokens = (pure, model, level, cycleBig) => model.cycleToPath(level, cycleBig).map((n, l) => ({ level: l, text: pure.shortName(l, n) }));

/** Slider text for assistive technology: "Rising, phase 13 and 4 of 256 in Eta Monofracton". */
export const sliderText = (pure, word, phase, name) => `${word}, ${pairLabel(pure, phase)} in ${name}`;

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
        <div><dt>Labels</dt><dd><b>Eta Monofracton</b> names a cycle: its depth letter and its ordinal inside the parent cycle (Monofracton is the 1st, Difracton the 2nd, Trifracton the 3rd, and so on); η#1 is its short form. <b>η 7 · 1/11</b> adds the depth: depth 7, the 1st of the 11 η cycles inside its parent. The pill says what the glyph is doing now (rising, peak, falling, valley) and which threshold comes next.</dd></div>
        <div><dt>Rings</dt><dd>Every ring is one cycle. The outermost, α, spans four Saros intervals (${pure.catalogueText()} cover the whole catalogue); each ring inside it is the next harmonic, 4 to 13 times shorter. ${depthRangeNote(pure, opening, finest)}</dd></div>
        <div><dt>Arc and dot</dt><dd>The arc grows clockwise from the top as the cycle runs; the dot is the hand, exactly where we are in that cycle. Rings too fast to follow dissolve into a glow.</dd></div>
        <div><dt>Sectors</dt><dd>A ring is cut into the child cycles it contains. The tinted sector is the one running now, and the funnel shows it opening up into the whole next ring.</dd></div>
        <div><dt>Quarters</dt><dd>Beads at the right, the bottom and the left mark peak, node and valley; they fill in as they are passed. The selected ring is labelled.</dd></div>
        <div><dt>Centre</dt><dd>Countdown to the end of the selected cycle, the cycle that begins there, and its four thresholds. Each threshold has its countdown and its place on the header clock: ε#4 · ζ#7 name the ε and ζ cycles it falls in, and 0η 9ι counts the η cycles completed since the ζ began, then the ι cycles completed since that η began. The wave shows what the glyph does over the same cycle; how far through it you are reads as two glyphs, 256 states.</dd></div>
        <div><dt>Counting</dt><dd>Counters (η ι λ) count from 0 and names (Eta Monofracton, η#1, ζ#7) from 1. Spans are counts too: 1θ 2ι is one θ and two ι. Every depth is a unit; from δ down the units have names (a Helion is one η cycle, a Preon one ι, a Flavon one λ, a Blink one ν), and real time is counted in Blinks. Press ? for the glossary.</dd></div>
        <div><dt>Navigate</dt><dd>Click a sector to jump to the start of that child cycle, a label to select a ring, drag the wave cursor to scrub inside the cycle. On a touch screen, tap a ring or sector (or touch and hold it) to see what it is, and tap the same sector again to jump. The thresholds in the centre jump to that moment of the selected cycle, passed ones included.</dd></div>
      `;
}
