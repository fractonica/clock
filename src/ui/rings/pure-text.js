/**
 * Pure-mode wording of the rings view (docs/design/80-pure.md): cycle names, coordinates on the unit ladder,
 * countdowns, "→ the cycle that begins", the help text. No Gregorian date, zone, Earth time unit or percentage
 * appears in anything produced here. Pure functions of their inputs: `pure` is `createPure(model)` (core/pure.js)
 * and `model` is `createModel()`; both are passed in so the module stays testable without a browser.
 *
 * The notation is the one of core/pure.js (read its header comment):
 *   X#n  an ordinal, 1-based: `ζ½#5`, `α#6`, `η#1`        nX  a count of units: `6ι 43λ`, `0η 29ι 21λ` (0-based clock)
 *   X d  a depth chip, only on level chips: `η 7`
 *
 * A "coordinate" is the pure replacement of a date + time of day. It has the same two parts:
 *   date  the ordinals of the cycles the instant sits in:      `ε½#2 · ζ½#5`  (what a calendar date is to a day)
 *   time  the counters of the finer cycles since the ζ start:  `3η 17ι`       (what a clock reading is to a day)
 * and, like a clock, its resolution follows the length of the cycle it labels (a cycle's quarter is the step).
 *
 * Durations are never measured or trimmed here: they come from `pure.between` / `pure.durationPos` /
 * `pure.cycleLength` (a whole cycle has its exact nominal length, never the difference of two floats).
 */
import { levelTag } from './text.js';

const QUARTERS = ['peak', 'node', 'valley', 'end'];
/** Index of ζ½ in `pure.UNITS`: the ordinal tokens are α#, β#, γ#, δ½#, ε½#, ζ½#; the counters start after it. */
const LAST_ORDINAL = 5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The ladder fields of an instant: 1-based ordinals (α β γ δ½ ε½ ζ½) and 0-based counters (η ι λ μ ν ξ).
 * @returns {null | {ord:number[], count:number[]}} null outside the catalogue
 */
export function pureFields(pure, model, t) {
  const d = pure.date(t);
  const c = pure.clock(t);
  if (!d || !c) return null;
  const sub = (level) => model.levelAt(t, level)?.local ?? 0; // μ ν ξ within their parent
  return {
    ord: [d.alpha, d.beta, d.gamma, d.delta, d.epsilon, d.zeta],
    count: [c.eta, c.iota, c.lambda, sub(11), sub(12), sub(13)],
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
  // whole cycles of `level` (or halves: `per` = 2) completed at the position
  const done = (level, per = 4n) => (num * info(level).prefix) / (per * den);
  const local = (level) => {
    const sib = info(level).siblings;
    const n = done(level);
    return Number(sib === null ? n : n % BigInt(sib));
  };
  const half = (level, within) => Number((done(level, 2n) % BigInt(within)) + 1n);
  return {
    ord: [Number(done(0)) + 1, local(1) + 1, local(2) + 1, half(3, 10), half(4, 5), half(5, 7)],
    count: [local(6), local(7) * info(8).siblings + local(8), local(9) * info(10).siblings + local(10), local(11), local(12), local(13)],
  };
}

/**
 * Nominal length of a cycle of `level` in Saros position units: only to pick the resolution of a coordinate
 * (`resolutionIndex`). Text lengths come from `pure.cycleLength`.
 */
export const cycleSpanPos = (model, level) => 4 / model.levelInfo(level).prefixNum;

/**
 * Index into `pure.UNITS` of the largest unit that fits `divisor` times into a span of `spanPos` Saros units:
 * the resolution a coordinate needs to tell the quarters of a cycle apart (divisor 4) or a pointer position (160).
 */
export function resolutionIndex(pure, spanPos, divisor = 4) {
  const step = spanPos / divisor;
  const i = pure.UNITS.findIndex((u) => pure.unitPos(u) <= step * (1 + 1e-9));
  return i < 0 ? pure.UNITS.length - 1 : i;
}

/** A boundary instant is read 1 ms into the state that starts there (the way the jump buttons land on it). */
const NUDGE = 0.001;

/** Every ordinal is `sym#n`: α#6 β#4 γ#9 · δ½#3 · ε½#2 · ζ½#5, exactly as `pure.dateText` writes them. */
const ordinalToken = (pure, i, n) => `${pure.UNITS[i].sym}#${n}`;
/** Greek ordinals sit together (`α#6 β#4 γ#9`), half-cycle ordinals are set off (`· δ½#3 · ε½#2`), as in `pure.stamp`. */
function joinOrdinals(tokens, firstIndex) {
  let out = '';
  tokens.forEach((tok, k) => {
    const i = firstIndex + k;
    out += k === 0 ? tok : i < 3 ? ` ${tok}` : ` · ${tok}`;
  });
  return out;
}

/** The coordinate text of already-read fields at resolution `res` (see `whenParts`). */
function partsOf(pure, f, res, { dateTokens = 3, timeTokens = 6 } = {}) {
  const last = Math.min(res, LAST_ORDINAL);
  const first = Math.max(0, last - dateTokens + 1);
  const tokens = [];
  for (let i = first; i <= last; i++) tokens.push(ordinalToken(pure, i, f.ord[i]));
  const time = [];
  for (let i = Math.max(LAST_ORDINAL + 1, res - timeTokens + 1); i <= res; i++) time.push(`${f.count[i - LAST_ORDINAL - 1]}${pure.UNITS[i].sym}`);
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
 * Coordinate of instant `t` at resolution `res` (an index into `pure.UNITS`).
 * @param {{dateTokens?:number, timeTokens?:number}} [o]  how many trailing ordinal / counter tokens to keep (the rest is context)
 * @returns {{date:string, time:string}}  `date` "ε½#2 · ζ½#5", `time` "3η 17ι" ('' when the resolution is coarser than η)
 */
export function whenParts(pure, model, t, res, o) {
  const f = fieldsAt(pure, model, t);
  return f ? partsOf(pure, f, res, o) : { date: '—', time: '' };
}

/** `whenParts` on one line: "ε½#2 · ζ½#5 · 3η 17ι". */
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
 * The span between two instants counted on the ladder: "6ι 43λ" (no "in"); `parts` consecutive units, trailing zero
 * parts dropped by the core. Negative when `to` is before `from` ("−20ι 21λ").
 */
export const between = (pure, from, to, parts = 2) => pure.between(from, to, { parts });

/**
 * The big countdown in the middle of the dial. Same rule as the Up next hero: up to three units, but never finer
 * than λ (a third part that is a λ or coarser changes at most every 7.8 s and stays steady; a μ would flicker), so
 * "6ι 43λ" there and here, "1ζ½ 4η 24ι" on both. A compact dial has no room for a third part: two.
 */
export function centreSpan(pure, model, from, to, { compact = false } = {}) {
  const a = model.positionOf(from);
  const b = model.positionOf(to);
  if (compact || a === null || b === null) return between(pure, from, to, 2);
  const d = Math.max(0, b - a);
  const lambda = pure.UNITS.findIndex((u) => u.id === 'lambda');
  const first = pure.UNITS.indexOf(pure.decompose(d, 1)[0].unit);
  return pure.durationPos(d, { parts: clamp(lambda - first + 1, 2, 3) });
}

/** "in 6ι 43λ" / "5ι 2λ ago". */
export const inText = (pure, now, t, parts = 2) => (t >= now ? `in ${between(pure, now, t, parts)}` : `${between(pure, t, now, parts)} ago`);

/** "starts in 4ε½ 1ζ½" / "started 2η ago" / "running now". */
export function startPhrase(pure, start, end, now) {
  if (now >= start && now < end) return 'running now';
  return start > now ? `starts ${inText(pure, now, start)}` : `started ${inText(pure, now, start)}`;
}

/**
 * How long the cycle `cyc` ({start, end, clipped}) of `level` lasts: the exact nominal length of a whole cycle
 * ("1η", "13λ"), never the difference of two float instants; only a cycle clipped by the end of the catalogue,
 * which is shorter than its kind, is measured.
 */
export const lengthText = (pure, level, cyc) => (cyc.clipped ? pure.between(cyc.start, cyc.end) : pure.cycleLength(level));

/** Length of one turn of a ring, for a sentence ("about 13λ") or a ring too fast to follow: counted in position, so exact. */
export const aboutTurn = (pure, info) => pure.cycleLength(info.level, { parts: 1 });

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

/** The glyph fact of the phase card: the pair in words. */
export const stateText = (pure, phase) => pairLabel(pure, phase);

/** Address of cycle `cycleBig` of `level` as ordinal tokens `α#6`, `β#4` … (one per level, shallowest first). */
export const addressTokens = (pure, model, level, cycleBig) => model.cycleToPath(level, cycleBig).map((n, l) => ({ level: l, text: pure.shortName(l, n) }));

/** Slider text for assistive technology: "Rising, phase 13 and 4 of 256 in Eta Monofracton". */
export const sliderText = (pure, word, phase, name) => `${word}, ${pairLabel(pure, phase)} in ${name}`;

// ---------------------------------------------------------------------------------------------
// the "How to read" panel
// ---------------------------------------------------------------------------------------------

/** Sentence about how deep the rings go, in turns counted on the ladder. */
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
        <div><dt>Centre</dt><dd>Countdown to the end of the selected cycle, the cycle that begins there, and its four thresholds. Each threshold has its countdown and its place on the header clock: ε½#4 · ζ½#7 name the half-cycles it falls in (ζ½ is half of a depth-6 cycle), and 0η 9ι counts the η and ι cycles completed since the running ζ cycle began. The wave shows what the glyph does over the same cycle; how far through it you are reads as two glyphs, 256 states.</dd></div>
        <div><dt>Counting</dt><dd>Counters (η ι λ) count from 0 and names (Eta Monofracton, η#1, ζ½#7) from 1. Spans are counts too: 6ι 43λ is six ι and forty-three λ. Press ? for the glossary.</dd></div>
        <div><dt>Navigate</dt><dd>Click a sector to jump to the start of that child cycle, a label to select a ring, drag the wave cursor to scrub inside the cycle. On a touch screen, tap a ring or sector (or touch and hold it) to see what it is, and tap the same sector again to jump. The thresholds in the centre jump to that moment of the selected cycle, passed ones included.</dd></div>
      `;
}
