/**
 * Pure-mode wording of the clock face (docs/design/80-pure.md, SPEC §15): every string the face shows, speaks or
 * explains, rewritten in Fractonica terms only. No clock times, dates, zones or Earth time units, no percentages.
 *
 * Revision 3 of the vocabulary splits the ladder in two:
 *   - MAJOR periods α β γ δ (Alpha … Delta) are said in WORDS, with their fracton ordinal and the quarter they are in:
 *     "Delta Trifracton End". Only these four have fracton names.
 *   - MINOR periods are said in LETTERS and COUNTS. The units are ε Nuclide (ordinal ε#1–5 in its Delta), η Helion
 *     (numbered 1–77 in the Nuclide, like the day of a month), ι Preon (0–35), λ Flavon (0–64) and ν Blink (0–24) (counts
 *     of completed units from 0); the depths between them (ζ θ κ μ) are no units: a cycle of any minor depth is named
 *     by where it starts in its Nuclide ("ε#5 34η 28ι").
 *
 * Notation (header of src/core/pure.js): X#n is an ordinal, counted from 1 ("δ#3", "ε#5"); nX is a count of units from 0
 * ("6ι 43λ", "29ι 21λ"), except the Helion of a date or clock, numbered from 1 ("34η"); a letter + a space + a number
 * ("η 7") is only a depth chip.
 *
 *   - countdowns are spans counted in ladder units  ("in 6ι 43λ"),
 *   - cycle ends name what begins                  ("Ends in 6ι 43λ → 35η begins", "→ Delta Tetrafracton begins"),
 *   - progress through a cycle is the glyph odometer the face draws, never a number with a percent sign,
 *   - the solar sync drift is counted in λ          ("drift −6 236λ", ctx.pure.driftText),
 *   - a unit is explained with its name where a tooltip explains one ("one Helion = 36ι", "19 Helions").
 *
 * All spans, cycle lengths, names and drifts come from the shared vocabulary (`ctx.pure`); nothing here measures or
 * trims a duration itself. Like helpers.js nothing here touches the DOM. The functions return the same shapes as their
 * normal-mode counterparts in helpers.js.
 */
import { clampDepth, stepDepth, levelsFor, stateInfo, describeState, intText, thresholdCaption } from './helpers.js';

const DASH = '—';

/** The pointer every pure help text may end with (the shell opens the glossary on "?"). */
export const GLOSSARY_NOTE = 'Press ? for the glossary.';
/** One sentence: which numbers start at 0 and which at 1. Shown in the tooltips of the cycles and in the caption's title. */
export const FROM_ONE = 'Ordinals (fracton names, # numbers) and the Helion (η) count from 1; states and the counts ι λ ν from 0.';
/** What the solar drift is measured against (one phrase, used by the tooltip and the how-to). */
export const DRIFT_REF = 'against the solar rhythm';

/** How many of the next unit make one cycle of a minor unit level, and that unit (η: 36 ι). */
const NEXT_UNIT = Object.freeze({ 4: [77, 'η'], 6: [36, 'ι'], 8: [65, 'λ'], 10: [25, 'ν'] });
/** For a depth between two units: the unit it is counted in and how many make one of its cycles (θ: 4 ι). */
const BETWEEN = Object.freeze({ 5: [11, 'η', 'eta'], 7: [4, 'ι', 'iota'], 9: [13, 'λ', 'lambda'], 11: [5, 'ν', 'nu'] });
/** The minor unit a start count is given in, its count in its parent unit, the parent unit's count key and symbol. */
const PLACE = Object.freeze({
  5: { key: 'eta', sym: 'η', of: 77, parent: 'epsilon' },
  6: { key: 'eta', sym: 'η', of: 77, parent: 'epsilon' },
  7: { key: 'iota', sym: 'ι', of: 36, parent: 'eta' },
  8: { key: 'iota', sym: 'ι', of: 36, parent: 'eta' },
  9: { key: 'lambda', sym: 'λ', of: 65, parent: 'iota' },
  10: { key: 'lambda', sym: 'λ', of: 65, parent: 'iota' },
  11: { key: 'nu', sym: 'ν', of: 25, parent: 'lambda' },
  12: { key: 'nu', sym: 'ν', of: 25, parent: 'lambda' },
});
const SYM = Object.freeze({ epsilon: 'ε', eta: 'η', iota: 'ι', lambda: 'λ', nu: 'ν' });

// ---- durations -----------------------------------------------------------------------------------------
/** "in 6ι 43λ": the span from t to `to`, counted in ladder units (position based, exact across eclipse intervals). */
export const inText = (pure, t, to) => (to == null || !Number.isFinite(to) ? DASH : `in ${pure.between(t, to)}`);
/** "6ι 43λ ago" for a span that has already passed (`from` before t). */
export const agoText = (pure, t, from) => (from == null || !Number.isFinite(from) ? DASH : `${pure.between(from, t)} ago`);

/**
 * What a glyph pair is called when it is spoken ("phase 8 and 0 of 256"): the accessible name of the shared pair
 * image itself, so a spoken pair and a drawn one never read differently.
 */
export function pairSpeech(p, fraction, label = 'phase') {
  const html = p.pairHTML(fraction, { label });
  return /aria-label="([^"]*)"/.exec(html)?.[1] ?? '';
}

// ---- names of cycles -----------------------------------------------------------------------------------
/** The global index of a model reading, exact (BigInt where the model gives one). */
const bigOf = (lv) => lv.cycleBig ?? BigInt(lv.cycle);

/**
 * The name shown under a period letter: a major cycle in words ("Delta Trifracton"), a minor one by where it starts in
 * its Nuclide ("ε#5", "ε#5 34η", "ε#5 34η 28ι").
 */
export const letterName = (p, level, cycleBig) => p.cycleName(level, cycleBig);

/**
 * Where a cycle sits, in one phrase:
 *   major    "Delta Trifracton End · 3 of 5 in its γ"     (α: "… · 6 of 18 in the catalogue")
 *   ε        "ε#5 of 5 in Delta Trifracton"
 *   unit     "34η of 77 in ε#5", "29ι of 36 in 34η"
 *   between  "28ι to 31ι in 34η" (a θ is 4ι: it is said by what the clock reads while it runs, first to last)
 * @param lv a model reading of `level` ({cycle, cycleBig, local, siblings, phase})
 */
export function placeText(p, level, lv, quarter = null) {
  const big = bigOf(lv);
  if (p.isMajor(level)) {
    const head = `${p.cycleName(level, big)}${quarter ? ` ${quarter}` : ''}`;
    const parent = level === 0 ? 'the catalogue' : `its ${'αβγ'[level - 1]}`;
    return `${head} · ${lv.local + 1} of ${lv.siblings} in ${parent}`;
  }
  const c = p.countsAtStart(level, big);
  if (level === 4) return `ε#${c.epsilon} of 5 in ${p.periodName(3, c.delta)}`;
  const pl = PLACE[level];
  if (!pl) return p.cycleName(level, big); // finer than a Blink: the decimal placing says it all
  const parent = pl.parent === 'epsilon' ? `ε#${c.epsilon}` : `${c[pl.parent]}${SYM[pl.parent]}`;
  const start = c[pl.key];
  if (BETWEEN[level]) return `${start}${pl.sym} to ${start + BETWEEN[level][0] - 1}${pl.sym} in ${parent}`;
  return `${start}${pl.sym} of ${pl.of} in ${parent}`;
}

/**
 * What begins when cycle `cycleBig` of `level` ends, said as briefly as the context allows:
 *   major  "Delta Tetrafracton"            ε  "ε#4", or "ε#1 of Delta Tetrafracton" when the Delta turns over
 *   finer  only the placing counts that change: "35η", "30ι", "35η 0ι"; "ε#1 1η" when the Nuclide turns over
 */
export function followerName(p, level, cycleBig) {
  const big = BigInt(cycleBig);
  const next = big + 1n;
  if (level < 4) return p.cycleName(level, next);
  const a = p.countsAtStart(level, big);
  const b = p.countsAtStart(level, next);
  if (level === 4) return a.delta === b.delta ? `ε#${b.epsilon}` : `ε#${b.epsilon} of ${p.periodName(3, b.delta)}`;
  if (a.delta !== b.delta || a.epsilon !== b.epsilon) return p.cycleName(level, next);
  const was = p.cycleName(level, big, { short: true }).split(' ');
  const now = p.cycleName(level, next, { short: true }).split(' ');
  const i = now.findIndex((part, k) => part !== was[k]);
  return now.slice(Math.max(0, i)).join(' ');
}

/**
 * The aside of a period tooltip: what one cycle of the depth is.
 *   major    "one Delta = 5ε"        unit "one Helion = 36ι" (ν: "one Blink, the finest unit")
 *   between  "one cycle = 4ι"
 */
export function cycleAside(p, model, level) {
  if (p.isMajor(level)) return `one ${p.LEVEL_NAMES[level]} = ${model.levelInfo(level + 1).siblings}${model.levelInfo(level + 1).letter}`;
  if (NEXT_UNIT[level]) return `one ${p.unitName(level)} = ${NEXT_UNIT[level][0]}${NEXT_UNIT[level][1]}`;
  if (level === 12) return `one ${p.unitName(12)}, the finest unit`;
  return `one cycle = ${p.cycleLength(level)}`;
}

// ---- info labels (SPEC §8) -----------------------------------------------------------------------------
/**
 * The three info labels in pure wording: the countdown to the next threshold of the top period and of the solar
 * sync, and the sync's number with its drift (instead of the clock time of the sync start).
 * @param {object} p    ctx.pure
 * @param {number} t    displayed time
 * @param {object} lTop levelAt() of the top period
 * @param {object|null} sol model.solarAt() or null
 */
export function pureInfoLabels(p, t, lTop, sol) {
  const next = lTop.next;
  return {
    topCap: thresholdCaption(next.name),
    topVal: inText(p, t, next.time),
    solarCap: sol ? thresholdCaption(sol.threshold.name) : 'SOLAR SYNC',
    solarVal: sol ? inText(p, t, sol.threshold.time) : DASH,
    syncCap: sol ? `SYNC ${intText(sol.sync)}` : 'SYNC',
    syncVal: sol ? `drift ${p.driftText(sol)}` : DASH,
    solarOk: !!sol,
    pure: true,
    syncNumber: sol ? intText(sol.sync) : '',
  };
}

/** What a screen reader hears when the pure info labels are shown (`m` is pureInfoLabels()). */
export function pureInfoSpeech(m) {
  const sentence = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  const val = (v) => (v === DASH ? 'not defined' : v);
  const top = `${sentence(m.topCap)} of the top period: ${val(m.topVal)}.`;
  if (!m.solarOk) return `${top} Solar sync: not defined within one sync of the catalogue edge.`;
  return `${top} ${sentence(m.solarCap)} of the solar sync: ${val(m.solarVal)}. Solar sync ${m.syncNumber}, ${m.syncVal}.`;
}

// ---- tooltips ------------------------------------------------------------------------------------------
function rowHint(d) {
  if (d.by === 'key') return 'Enter: select this cycle in every view';
  const base = 'Click or tap: select this cycle in every view';
  if (d.step < 0) return `${base} and show longer periods`;
  if (d.step > 0) return `${base} and show shorter periods`;
  return base;
}

/**
 * Tooltip model of a period row in pure wording.
 * @param {object} d {letter, depth, level, lv (model reading: cycle, cycleBig, local, siblings, phase, end, next,
 *   thresholds), state(stateInfo), fineIndex, fineNext, majorNext, catalogueEnd, now, step?, by?, aside}
 */
export function purePeriodTooltip(d, p) {
  const s = d.state;
  const lv = d.lv;
  const major = p.isMajor(d.level);
  const q = major ? Math.min(3, Math.floor(lv.phase * 4)) : null;
  const lines = [placeText(p, d.level, lv, major ? p.QUARTER_WORDS[q] : null), `State ${s.index} of ${s.states}: ${describeState(s)}`];
  lines.push(`Right (fine) glyph: state ${d.fineIndex} of ${s.states}` + (d.fineNext != null ? `, changes ${inText(p, d.now, d.fineNext)}` : ''));
  if (d.majorNext != null) lines.push(`Next change ${inText(p, d.now, d.majorNext)}`);
  // a major period is read by its quarter: say when this one ends and which comes next (the End quarter ends with the cycle)
  if (major && q < 3) {
    const at = lv.thresholds?.[q + 1]?.time;
    if (at != null) lines.push(`${p.QUARTER_WORDS[q]} ends ${inText(p, d.now, at)} → ${p.QUARTER_WORDS[q + 1]}`);
  }
  if (lv.end != null) {
    const atEdge = d.catalogueEnd != null && lv.end >= d.catalogueEnd - 1e-3;
    lines.push(atEdge ? `Ends ${inText(p, d.now, lv.end)}, with the catalogue` : `Ends ${inText(p, d.now, lv.end)} → ${followerName(p, d.level, bigOf(lv))} begins`);
  }
  lines.push(FROM_ONE);
  return { title: `${d.letter} · depth ${d.depth}`, aside: d.aside, lines, hint: rowHint(d) };
}

/**
 * Tooltip model of the solar odometer in pure wording. The phase line is HTML (the glyph pair); every other line
 * is text.
 * @param {object} d {sync, phase, thresholdName, thresholdTime, start, now, nominalStart, drift, by?}
 */
export function pureSolarTooltip(d, p) {
  const lines = [
    { html: `Phase ${p.pairHTML(d.phase, { label: 'phase' })} of this sync` },
    `Drift ${p.driftText(d)} ${DRIFT_REF}`,
    `Next ${d.thresholdName} ${inText(p, d.now, d.thresholdTime)}`,
    `Sync began ${agoText(p, d.now, d.start)}`,
  ];
  const hint = d.by === 'key' ? 'Enter: show the info labels · key l: keep the letters' : 'Click or tap: info labels · double tap: letters';
  return { title: `Solar sync #${intText(d.sync)}`, aside: `one sync = 19η (19 ${p.unitName('η', 19)})`, lines, hint };
}

/**
 * The tooltip model of a face row (top / bottom / solar) for the frame, in pure wording; null out of range.
 * Mirrors what face.js builds in normal mode from the same readings.
 */
export function pureTooltipModel({ model, pure: p, frame, row, topDepth, by = 'pointer' }) {
  if (!frame?.inRange) return null;
  const t = frame.t;
  if (row === 'solar') {
    let s = null;
    try {
      s = frame.solar();
    } catch {
      s = null;
    }
    if (!s) return { title: 'Solar sync', aside: '', lines: ['The sync around this instant runs past the catalogue, so it is not defined here.'], hint: '' };
    return pureSolarTooltip({ sync: s.sync, phase: s.phase, drift: s.drift, start: s.start, nominalStart: s.nominalStart, thresholdName: s.threshold.name, thresholdTime: s.threshold.time, now: t, by }, p);
  }
  const lv = levelsFor(topDepth);
  const level = row === 'top' ? lv.top : lv.bottom;
  const info = model.levelInfo(level);
  const cyc = frame.level(level);
  const od = frame.odometer(level);
  if (!cyc || !od) return null;
  const major = model.odometerAt(t, level, { digits: 1 });
  const dir = row === 'top' ? -1 : 1;
  const cur = clampDepth(topDepth);
  return purePeriodTooltip(
    {
      letter: info.letter,
      depth: info.depth,
      level,
      lv: cyc,
      aside: cycleAside(p, model, level),
      state: stateInfo(od.digits[0]),
      fineIndex: od.digits[1],
      fineNext: od.nextTime,
      majorNext: major?.nextTime ?? null,
      catalogueEnd: model.tMax,
      now: t,
      by,
      step: stepDepth(cur, dir) === cur ? 0 : dir,
    },
    p,
  );
}

// ---- aria labels ---------------------------------------------------------------------------------------
/**
 * Accessible label of a glyph row in pure wording. `d` as for rowAriaLabel, with `place` (placeText of the running
 * cycle) for the period rows.
 */
export function pureRowAriaLabel(kind, d, p) {
  if (kind === 'solar') return `Solar sync ${intText(d.sync)}, ${pairSpeech(p, d.phase)}, glyphs ${d.digits.join(', ')}. Activate to show the info labels`;
  const plain = describeState(d.state).replace(/\s*[↗↘]/g, '');
  return `${d.letter} depth ${d.depth} · ${d.place}: state ${d.state.index} of ${d.state.states}, ${plain}. Activate to select this depth`;
}

// ---- caption, letters, out of range --------------------------------------------------------------------
/**
 * The caption under the pill when time is not live: the short date down to the Flavons, in words
 * ("Delta Trifracton End ε#5 34η 29ι 21λ"), or in letters where the words do not fit ("δ#3 ε#5 34η 29ι 21λ").
 * Ordinals are words or carry a #, the counts start at 0 (CAPTION_NOTE says so on hover).
 */
export function pureCaption(p, t, { letters = false } = {}) {
  if (!p.date(t) || !p.clock(t)) return '';
  return p.dateText(t, { upTo: 'lambda', letters });
}
/** The hover text of the caption: which of its numbers start at 0. */
export const CAPTION_NOTE = `${FROM_ONE} ${GLOSSARY_NOTE}`;

/** Texts of the out-of-catalogue state: the range is the first and last α cycle, never years. */
export function pureRange(p) {
  const [from, to] = p.catalogueText().split(' – ');
  return { from, to, label: 'Fractonica clock face: outside the catalogue, no reading', lines: ['outside the', 'catalogue'] };
}

/** Texts shown where the solar sync is not defined (within one sync of the catalogue ends). */
export const PURE_SOLAR_NA = Object.freeze({
  label: 'Solar sync unavailable within one sync of the catalogue ends',
  lines: ['not defined within', 'one sync of the edge'],
});

// ---- how to read ---------------------------------------------------------------------------------------
/**
 * The lines of the "How to read" popover in pure wording (`pairHTML` renders the example glyph pair): the five of
 * normal mode, a line on the reading itself (the Helion count and phase is the basic reading, Preons and Flavons the fine
 * time, Alpha … Delta in words with their quarter) and one on which numbers start at 0 and which at 1; the dialog then
 * ends with the glossary pointer.
 */
export function pureHowToLines(pairHTML) {
  return [
    ['teal', '<b>Glyph = phase.</b> It shows where a cycle is: the value climbs to +4, falls to −4 and returns – 16 states per cycle.'],
    ['dot', '<b>Dot = falling.</b> A dot above the stem marks the falling half; rising and the two turning points have none.'],
    ['pair', `<b>Pair = odometer.</b> The left glyph is the coarse step, the right one the fine step inside it: 16 × 16 = 256 phases of a cycle. ${pairHTML ? `<span class="face-pop-eg">${pairHTML}</span>` : ''}`],
    ['count', '<b>Counter dots</b> are the cycles of the parent period; lit up to the one you are in.'],
    ['units', '<b>The Helion is the basic reading:</b> its number and its phase. Preons and Flavons are the fine time (34η 29ι 21λ). Alpha, Beta, Gamma and Delta are said in words with their quarter: Delta Trifracton End.'],
    ['zero', '<b>Numbers from 1, counts from 0.</b> 34η is the 34th Helion of its Nuclide (1–77); ε#5 and Delta Trifracton are numbered from 1 too. 29ι 21λ count the Preons and Flavons completed, from 0.'],
    ['gold', '<b>Yellow</b> is the solar sync: 19η cycles, 19 Helions. Its start drifts a little earlier with every sync, counted in λ.'],
  ];
}

export { bigOf };
