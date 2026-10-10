/**
 * Pure-mode wording of the clock face (docs/design/80-pure.md): every string the face shows, speaks or
 * explains, rewritten in Fractonica terms only. No clock times, dates, zones or Earth time units, no percentages.
 *
 * Notation (header of src/core/pure.js): X#n is an ordinal, counted from 1 ("η#1", "δ½#6"); nX is a count of units
 * ("6ι 43λ", the clock counters "0η 29ι 21λ" count completed units from 0); a letter + a space + a number ("η 7") is only
 * a depth chip.
 *
 *   - countdowns are spans counted in ladder units  ("in 3η 2ι"),
 *   - cycle ends name the cycle that begins          ("ends in 6ι 43λ → Eta Difracton begins"),
 *   - progress through a cycle is a pair of 2-stroke glyphs (256 states), never a number with a percent sign,
 *   - the solar sync drift is counted in λ           ("drift −623λ", ctx.pure.driftText),
 *   - cycles carry their emergent names              ("Eta Monofracton" = η#1, the 1st η inside its ζ).
 *
 * All spans, cycle lengths and drifts come from the shared vocabulary (`ctx.pure`); nothing here measures or trims a
 * duration itself. Like helpers.js nothing here touches the DOM. The functions return the same shapes as their
 * normal-mode counterparts in helpers.js.
 */
import { clampDepth, stepDepth, levelsFor, stateInfo, describeState, intText, thresholdCaption } from './helpers.js';

const DASH = '—';

/** The pointer every pure help text may end with (the shell opens the glossary on "?"). */
export const GLOSSARY_NOTE = 'Press ? for the glossary.';
/** One sentence: which numbers start at 0 and which at 1. Shown in the tooltips of the cycles and in the caption's title. */
export const FROM_ONE = 'Names and # numbers count from 1; states and clock counters (η ι λ) count from 0.';
/** What the solar drift is measured against (one phrase, used by the tooltip and the how-to). */
export const DRIFT_REF = 'against the solar rhythm';

// ---- durations -----------------------------------------------------------------------------------------
/** "in 3η 2ι": the span from t to `to`, counted in ladder units (position based, exact across eclipse intervals). */
export const inText = (pure, t, to) => (to == null || !Number.isFinite(to) ? DASH : `in ${pure.between(t, to)}`);
/** "3η 2ι ago" for a span that has already passed (`from` before t). */
export const agoText = (pure, t, from) => (from == null || !Number.isFinite(from) ? DASH : `${pure.between(from, t)} ago`);

/**
 * What a glyph pair is called when it is spoken ("phase 8 and 0 of 256"): the accessible name of the shared pair
 * image itself, so a spoken pair and a drawn one never read differently.
 */
export function pairSpeech(p, fraction, label = 'phase') {
  const html = p.pairHTML(fraction, { label });
  return /aria-label="([^"]*)"/.exec(html)?.[1] ?? '';
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
 * @param {object} d {letter, depth, level, cycle, state(stateInfo), fineIndex, fineNext, majorNext, cycleEnd,
 *   catalogueEnd, local, siblings, parentLetter, now, step?, by?, length (ctx.pure.cycleLength(level))}
 */
export function purePeriodTooltip(d, p) {
  const s = d.state;
  const name = p.cycleName(d.level, d.cycle);
  const ord = p.cycleShort(d.level, d.cycle);
  const where = d.siblings != null ? ` of ${d.siblings}${d.parentLetter ? ` in its ${d.parentLetter}` : ''}` : '';
  const lines = [`${name} · ${ord}${where}`, `State ${s.index} of ${s.states}: ${describeState(s)}`];
  lines.push(`Right (fine) glyph: state ${d.fineIndex} of ${s.states}` + (d.fineNext != null ? `, changes ${inText(p, d.now, d.fineNext)}` : ''));
  if (d.majorNext != null) lines.push(`Next change ${inText(p, d.now, d.majorNext)}`);
  if (d.cycleEnd != null) {
    const atEdge = d.catalogueEnd != null && d.cycleEnd >= d.catalogueEnd - 1e-3;
    lines.push(atEdge ? `Ends ${inText(p, d.now, d.cycleEnd)}, with the catalogue` : `Ends ${inText(p, d.now, d.cycleEnd)} → ${p.cycleName(d.level, d.cycle + 1)} begins`);
  }
  lines.push(FROM_ONE);
  return { title: `${d.letter} · depth ${d.depth}`, aside: `one cycle = ${d.length}`, lines, hint: rowHint(d) };
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
  return { title: `Solar sync #${intText(d.sync)}`, aside: '19η per sync', lines, hint };
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
      cycle: cyc.cycle,
      length: p.cycleLength(level),
      state: stateInfo(od.digits[0]),
      fineIndex: od.digits[1],
      fineNext: od.nextTime,
      majorNext: major?.nextTime ?? null,
      cycleEnd: cyc.end,
      catalogueEnd: model.tMax,
      local: cyc.local,
      siblings: cyc.siblings,
      parentLetter: level > 0 ? model.levelInfo(level - 1).letter : null,
      now: t,
      by,
      step: stepDepth(cur, dir) === cur ? 0 : dir,
    },
    p,
  );
}

// ---- aria labels ---------------------------------------------------------------------------------------
/** Accessible label of a glyph row in pure wording (`d` as for rowAriaLabel plus `name` for the period rows). */
export function pureRowAriaLabel(kind, d, p) {
  if (kind === 'solar') return `Solar sync ${intText(d.sync)}, ${pairSpeech(p, d.phase)}, glyphs ${d.digits.join(', ')}. Activate to show the info labels`;
  const plain = describeState(d.state).replace(/\s*[↗↘]/g, '');
  const cycle = d.siblings != null ? `, cycle ${d.local + 1} of ${d.siblings}` : '';
  return `${d.letter} depth ${d.depth} · ${d.name}: state ${d.state.index} of ${d.state.states}, ${plain}${cycle}. Activate to select this depth`;
}

// ---- caption, letters, out of range --------------------------------------------------------------------
/**
 * The caption under the pill when time is not live: the address down to the clock counters, in one short line
 * ("α#6 β#4 γ#9 · δ½#3 ε½#2 ζ½#5 · 3η 17ι 42λ": the numbers of pure.stamp(t, 'lambda') without the separators that
 * cost width). Ordinals carry a #, the counters are counts and start at 0 (CAPTION_NOTE says so on hover).
 */
export function pureCaption(p, t) {
  const d = p.date(t);
  const c = p.clock(t);
  if (!d || !c) return '';
  return `α#${d.alpha} β#${d.beta} γ#${d.gamma} · δ½#${d.delta} ε½#${d.epsilon} ζ½#${d.zeta} · ${c.eta}η ${c.iota}ι ${c.lambda}λ`;
}
/** The hover text of the caption: which of its numbers start at 0. */
export const CAPTION_NOTE = `${FROM_ONE} ${GLOSSARY_NOTE}`;

/** "Eta Monofracton": the name shown under a period letter. */
export const letterName = (p, level, local) => p.periodName(level, local + 1);

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
 * normal mode, plus one on which numbers start at 0 and which at 1 (the dialog then ends with the glossary pointer).
 */
export function pureHowToLines(pairHTML) {
  return [
    ['teal', '<b>Glyph = phase.</b> It shows where a cycle is: the value climbs to +4, falls to −4 and returns – 16 states per cycle.'],
    ['dot', '<b>Dot = falling.</b> A dot above the stem marks the falling half; rising and the two turning points have none.'],
    ['pair', `<b>Pair = odometer.</b> The left glyph is the coarse step, the right one the fine step inside it: 16 × 16 = 256 phases of a cycle. ${pairHTML ? `<span class="face-pop-eg">${pairHTML}</span>` : ''}`],
    ['count', '<b>Counter dots</b> are the cycles of the parent period; lit up to the one you are in.'],
    ['zero', '<b>Counters from 0, names from 1.</b> A clock counter such as 0η 29ι 21λ counts completed units from 0; an ordinal such as δ½#6 or Eta Monofracton (η#1) counts from 1.'],
    ['gold', '<b>Yellow</b> is the solar sync: 19η cycles. Its start drifts a little earlier with every sync, counted in λ.'],
  ];
}
