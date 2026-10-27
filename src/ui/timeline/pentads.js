/**
 * Pentads on the timeline (SPEC §7.5): a date leads with its Pentad like a weekday.
 *
 *   band    the Pentads of the visible window, drawn as a day-like strip under the ticks (paint.js `paintPentads`) once
 *           the Hypopentad is at least BAND_MIN_PX wide; cached on a padded window so a sliding view costs nothing.
 *   lead    canvas labels carry a Pentad mark as one private-use character (U+E000 + index, U+E004 + index for the shape
 *           without its numeral); paint.js measures and draws it as the shape + numeral of src/ui/pentad.js. These
 *           characters never reach the DOM: DOM text uses leadHTML / leadText (plain "Pentad II · …").
 *   at      a cached lookup (pentadLookup) for the cursor, now, hover and banner instants, so a frame never asks the
 *           model's exact BigInt reading more than once per new Pentad.
 */
import { pentadsIn, pentadLookup, pentadName, PENTAD_HELIONS } from '../pentad.js';

const PLACE = ['1st', '2nd', '3rd', '4th', '5th'];
/** "Pentad II · 2nd of its 5 Helions": where a moment is in its Pentad (tooltips; plain text). */
export const placeText = (p) => (p ? `${pentadName(p.index)} · ${PLACE[p.helion - 1] ?? `${p.helion}th`} of its ${p.helions} Helions` : '');
/**
 * What the band is, for its gutter tooltip. Pure mode says it without Earth words (no day, no hours, and not even the
 * Sun by name: the pure-mode scan reads "Sun" as a weekday): the solar rhythm stands for the solar day.
 */
export function bandTip(pure) {
  return pure
    ? 'Pentads: the 19 Helions of a solar sync as Pentad I, II and III (5 Helions each) and the Hypopentad (4). The solar rhythm repeats every 4¾ Helions, so each Pentad begins a quarter Helion later against it than the one before, and the Hypopentad, one Helion short, brings the next Pentad I back to where the sync began. A date leads with its Pentad.'
    : 'Pentads: the 19 Helions of a solar sync as Pentad I, II and III (5 Helions each) and the Hypopentad (4), each about a day. A solar day is 4¾ Helions, so each Pentad starts a quarter Helion (≈ 1.26 h) later in the day than the one before, and the Hypopentad, one Helion short, brings the next Pentad I back to the time of day the sync began. A date leads with its Pentad, like a weekday.';
}

/** Private-use characters that stand for a mark: with its numeral (E000–E003) or the shape alone (E004–E007). */
export const MARK_BASE = 0xe000;
export const SHAPE_BASE = 0xe004;
export const MARK_RE = /[-]/;
const MARK_SPLIT = /([-])/;
/** The character of Pentad `index`'s mark; `numeral: false` the shape alone. */
export const markChar = (index, numeral = true) => String.fromCharCode((numeral ? MARK_BASE : SHAPE_BASE) + index);
/** {index, numeral} of a mark character, or null for any other text. */
export function markOf(ch) {
  const c = ch.length === 1 ? ch.charCodeAt(0) : -1;
  if (c >= MARK_BASE && c < MARK_BASE + 4) return { index: c - MARK_BASE, numeral: true };
  if (c >= SHAPE_BASE && c < SHAPE_BASE + 4) return { index: c - SHAPE_BASE, numeral: false };
  return null;
}
/** A label cut into text runs and marks: ["", " 12:00"] -> [{mark}, {text}]. */
export function splitMarks(s) {
  if (!MARK_RE.test(s)) return [{ text: s }];
  const out = [];
  for (const part of s.split(MARK_SPLIT)) {
    if (!part) continue;
    const m = markOf(part);
    out.push(m ? { mark: m } : { text: part });
  }
  return out;
}
/** The label as plain text, marks spelled out ("Pentad II 12:00"): for anything that leaves the canvas. */
export const plainMarks = (s) => s.replace(/[-]/g, (ch) => pentadName(markOf(ch).index));

/** Below this width of the Hypopentad (px) the band is not drawn: Pentads would be a hatch, not days. */
export const BAND_MIN_PX = 6;

/**
 * The band's label for one Pentad, longest first; the painter takes the first that fits. Pure mode adds its length in
 * Helions ("Pentad II · 5η"); normal mode keeps to words (no Fractonica counts on the Gregorian axis).
 */
export function bandLabels(index, { pure = false } = {}) {
  const name = pentadName(index);
  const shape = markChar(index, false); // with the name spelled out, the shape alone leads it ("⬠ Pentad II")
  const out = [];
  if (pure) out.push(`${shape} ${name} · ${PENTAD_HELIONS[index]}η`);
  out.push(`${shape} ${name}`, markChar(index), shape);
  return [...new Set(out)];
}

/**
 * The Pentad machinery of one timeline: `at(t)`, `lead(t, label)` and `spans(t0, t1)` (the band's Pentads, cached on a
 * window padded by half its width on either side; a zoom in reuses it, a pan or zoom out beyond it rebuilds it).
 */
export function createPentads(model) {
  const at = pentadLookup(model);
  let cache = null;
  const helion = model.levelInfo(6).meanSeconds;
  function spans(t0, t1) {
    if (cache && t0 >= cache.a && t1 <= cache.b) return cache.list;
    const pad = (t1 - t0) * 0.5;
    cache = { a: t0 - pad, b: t1 + pad, list: pentadsIn(model, t0 - pad, t1 + pad) };
    return cache.list;
  }
  /** " 12:00:00": a canvas label led by the mark of the Pentad at t (unchanged outside the catalogue). */
  const lead = (t, label) => {
    const p = at(t);
    return p && label ? `${markChar(p.index)} ${label}` : label;
  };
  /** Whether the band is drawn at `k` px per second. */
  const bandShown = (k) => 4 * helion * k >= BAND_MIN_PX;
  return { at, lead, spans, bandShown, helion };
}
