/**
 * Pentads on the diary's pages (SPEC §7.5, §15.3): the solar sync's 19 Helions as Pentad I, II, III (5 Helions each) and
 * the Hypopentad (4). A date leads with its Pentad as a civil date leads with its weekday.
 *
 * The short form is a SHAPE drawn as a path – a pentagon with the numeral for Pentads I–III, the Hypopentad's square
 * alone (the side count is the Helion count) – never the ⬠ character, which only one Apple font has. Everything here is
 * plain SVG through the page builder (common.js), so the pages print the same in a browser, in Node and in the iOS app.
 *
 * Pentads follow the solar sync, not the diary's sheets: a lock of the diary counts 19 Helions from its Nuclide, a sync
 * counts them from the sync anchor, so the two drift by one Helion per Nuclide (77 = 4 · 19 + 1).
 */
import { shapePoints, PENTAD_NAMES, PENTAD_NUMERALS } from '../../ui/pentad.js';
import { measure, n2 } from './common.js';

export { PENTAD_NAMES, PENTAD_NUMERALS };

/** The shape's height relative to the type size it stands next to (about the cap height). */
const SHAPE_EM = 0.88;
/** The shape's centre above the baseline, relative to the type size (half the cap height). */
const MID_EM = 0.355;
/** The gap between the shape and its numeral, and after the whole mark, relative to the type size. */
const GAP_EM = 0.16;
const AFTER_EM = 0.42;

/** Path data of shape `index` (0..3) `size` mm tall, its box's left edge at x and its middle at y. */
export function shapeD(index, x, y, size) {
  const s = size / 12;
  const top = y - size / 2;
  return `M${shapePoints(index).map(([px, py]) => `${n2(x + px * s)} ${n2(top + py * s)}`).join('L')}Z`;
}

/** Draw shape `index` `size` mm tall, left edge at x, middle at y, outlined in `color` (or `fill` it). */
export function drawShape(svg, index, x, y, size, color, { fill = null, sw } = {}) {
  svg.path(shapeD(index, x, y, size), { stroke: color, sw: sw ?? Math.max(0.1, size * 0.105), join: 'round', fill: fill ?? undefined });
  return size;
}

/**
 * The text that follows the shape: 'numeral' "II" (empty for the Hypopentad), 'name' "Pentad II" / "Hypopentad", or
 * 'none'.
 */
const textOf = (index, text) => (text === 'name' ? PENTAD_NAMES[index] : text === 'numeral' ? PENTAD_NUMERALS[index] : '');

/** Width (mm) of a mark at type size `fs`: the shape, its text, and `after` (the gap before what it leads). */
export function markWidth(index, fs, { text = 'numeral', weight = 600, font = 'sans', after = true } = {}) {
  if (!(index >= 0 && index <= 3)) return 0;
  const t = textOf(index, text);
  return fs * SHAPE_EM + (t ? fs * GAP_EM + measure(t, fs, { weight, font }) : 0) + (after ? fs * AFTER_EM : 0);
}

/**
 * Draw a Pentad mark on a text baseline: the shape, then its numeral or name, in `color`. `anchor` 'start' puts the mark's
 * left edge at x; 'end' puts its right edge (without the trailing gap) there. Returns the width with the trailing gap.
 */
export function drawMark(svg, index, x, baseline, fs, color, { text = 'numeral', weight = 600, font = 'sans', anchor = 'start' } = {}) {
  if (!(index >= 0 && index <= 3)) return 0;
  const w = markWidth(index, fs, { text, weight, font, after: false });
  const x0 = anchor === 'end' ? x - w : x;
  const size = fs * SHAPE_EM;
  drawShape(svg, index, x0, baseline - fs * MID_EM, size, color);
  const t = textOf(index, text);
  if (t) svg.text(x0 + size + fs * GAP_EM, baseline, t, { size: fs, fill: color, weight });
  return w + fs * AFTER_EM;
}

/**
 * A line of runs led by a Pentad mark, anchored like `svg.runs` at the inner or outer edge: the mark always comes first in
 * reading order (left), whichever side the line is anchored to. `o` as for svg.runs (anchor, maxW, minScale); `mark`
 * {index, fs, color, text}. Returns the total width.
 */
export function markedRuns(svg, x, y, runs, o, mark) {
  if (!mark || !(mark.index >= 0 && mark.index <= 3)) return svg.runs(x, y, runs, o);
  const mw = markWidth(mark.index, mark.fs, { text: mark.text ?? 'numeral', font: svg.font });
  const opts = { ...o, maxW: o.maxW !== undefined ? Math.max(0, o.maxW - mw) : undefined };
  if (o.anchor === 'end') {
    // the runs keep their edge; the mark goes before them by their (estimated, never short) width
    const w = svg.runs(x, y, runs, opts);
    drawMark(svg, mark.index, x - w - mw, y, mark.fs, mark.color, { text: mark.text ?? 'numeral', font: svg.font });
    return w + mw;
  }
  drawMark(svg, mark.index, x, y, mark.fs, mark.color, { text: mark.text ?? 'numeral', font: svg.font });
  return mw + svg.runs(x + mw, y, runs, { ...opts, anchor: 'start' });
}

/**
 * The distinct Pentads met by a list of Helions, in order: [{index, sync}] ("a page holds Pentad II and III").
 */
export function pentadsOf(cx, helions) {
  const out = [];
  for (const h of helions) {
    const p = cx.pentadOfHelion(h);
    if (p && !out.some((q) => q.sync === p.sync && q.index === p.index)) out.push({ sync: p.sync, index: p.index });
  }
  return out;
}
