/**
 * Pentads in the UI (SPEC §7.5, §15.3): the solar sync's 19 Helions as Pentad I, II, III (5 Helions each) and the
 * Hypopentad (4). A date leads with its Pentad the way a civil date leads with its weekday.
 *
 *   mark      the short form as a SHAPE: a pentagon with the numeral for Pentads I–III, a square alone for the
 *             Hypopentad (the side count is the Helion count). Inline SVG in `currentColor`, sized to the text around it.
 *             Never the ⬠ character in HTML (it only exists in one Apple font); PENTAD_SHORT is for plain-text contexts.
 *   names     'Pentad II' for words, tooltips, aria labels and copied text; 'P2' where text must stay ASCII.
 *   lead      a reading led by its Pentad: leadHTML(model, t, html) "[⬠II] 44η 15ι", leadText(model, t, text)
 *             "Pentad II · δ#4 ε#1 44η 15ι". The stamp itself (pure.stamp) never carries it: the Pentad is implied.
 *   canvas    drawPentadMark(g, index, x, y, …) for the views that paint their labels.
 *   spans     pentadsIn(model, t0, t1) – the Pentads running in a window, for timelines and calendars – and
 *             pentadLookup(model) – a cached at(t) for many nearby instants (calendar cells, list rows).
 *   chart     pentadChart(model, t) – the geometry of the "19 Helions as four rows" picture (src/ui/pentad/chart.js).
 *
 * Pure with respect to the model: no DOM access except in pentadMarkEl.
 */
import { PENTAD_NAMES, PENTAD_ASCII, PENTAD_NUMERALS, PENTAD_SHORT } from '../core/pure.js';

export { PENTAD_NAMES, PENTAD_ASCII, PENTAD_NUMERALS, PENTAD_SHORT };

/** Helions in each Pentad of a sync: Pentad I, II, III, Hypopentad. */
export const PENTAD_HELIONS = Object.freeze([5, 5, 5, 4]);
/** Helions in one sync (SPEC §7.2). */
export const SYNC_HELIONS = 19;
/** A solar day in Helions: 4¾η ≈ 23.997 h (SPEC §7.5). */
export const DAY_HELIONS = 4.75;
/** "4¾η": the solar day in pure notation. */
export const DAY_TEXT = '4¾η';
/** How much later in the day each Pentad starts than the one before: a quarter Helion. */
export const QUARTER_TEXT = '¼η';
/** The start of Pentad i after the start of its solar day, in pure notation ("+0", "+¼η", "+½η", "+¾η"). */
export const OFFSET_TEXT = Object.freeze(['+0', '+¼η', '+½η', '+¾η']);

const isIndex = (i) => Number.isInteger(i) && i >= 0 && i <= 3;
const indexOf = (p) => (typeof p === 'number' ? p : p?.index);

/** "Pentad II" (index 0..3, or a pentad object); '' for anything else. */
export const pentadName = (p) => (isIndex(indexOf(p)) ? PENTAD_NAMES[indexOf(p)] : '');
/** "P2" / "H": the ASCII form. */
export const pentadAscii = (p) => (isIndex(indexOf(p)) ? PENTAD_ASCII[indexOf(p)] : '');
/** "1st Helion": the Helion's place in its Pentad (1..5). */
export const helionPlace = (n) => `${['1st', '2nd', '3rd', '4th', '5th'][n - 1] ?? `${n}th`} Helion`;
/** "Pentad II, 2nd Helion" (`helion: true` adds the Helion's place) – spoken and tooltip form. */
export function pentadSpoken(p, { helion = false } = {}) {
  const name = pentadName(p);
  if (!name || !helion || !p?.helion) return name;
  return `${name}, ${helionPlace(p.helion)}`;
}

// ---- the shape --------------------------------------------------------------------------------------------------
/** The shapes in a 12 × 12 box: a regular pentagon standing on its base, and a square of about the same weight. */
const BOX = 12;
const pentagonPoints = (() => {
  const cx = 6;
  const r = 5.55;
  const cy = 6.55; // a pentagon's centre sits low so its base and apex share the box's padding
  const pts = [];
  for (let k = 0; k < 5; k++) {
    const a = (-90 + 72 * k) * (Math.PI / 180);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
})();
const SQUARE = [
  [1.75, 1.75],
  [10.25, 1.75],
  [10.25, 10.25],
  [1.75, 10.25],
];
/** The outline of Pentad `index` as points in the 12 × 12 box (a pentagon for 0..2, a square for 3). */
export const shapePoints = (index) => (index === 3 ? SQUARE : pentagonPoints);
const f2 = (v) => Number(v.toFixed(2));
/** SVG path data of the shape in the 12 × 12 box. */
export const shapePath = (index) => `M${shapePoints(index).map(([x, y]) => `${f2(x)} ${f2(y)}`).join('L')}Z`;

/**
 * The shape alone as inline SVG (decorative: aria-hidden). `filled` draws it solid (lit cells, small sizes).
 * The stroke scales with the text: 1.5 of 12 box units.
 */
export function pentadShapeSVG(index, { filled = false, cls = 'pentad-shape' } = {}) {
  if (!isIndex(index)) return '';
  const paint = filled ? 'fill="currentColor" stroke="currentColor"' : 'fill="none" stroke="currentColor"';
  return `<svg class="${cls}" viewBox="0 0 ${BOX} ${BOX}" aria-hidden="true" focusable="false"><path d="${shapePath(index)}" ${paint} stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const markCache = new Map();
/**
 * The short form as HTML: shape + numeral ("⬠II"), the Hypopentad's square alone. One element with role="img" and the
 * full name as its accessible name, so a screen reader says "Pentad II". Options:
 *   numeral  false: the shape alone (dense rows that name the Pentad elsewhere)
 *   helion   a Helion place 1..5 shown small after the mark ("⬠II·3") and spoken ("Pentad II, 3rd Helion")
 *   title    a tooltip (true: the spoken name; a string: that text)
 *   cls      extra classes, e.g. 'is-gold'
 */
export function pentadMarkHTML(p, { numeral = true, helion = null, title = false, cls = '' } = {}) {
  const index = indexOf(p);
  if (!isIndex(index)) return '';
  const h = helion === true ? p?.helion : helion;
  const key = `${index}|${numeral}|${h ?? ''}|${title === true ? 1 : title || ''}|${cls}`;
  let html = markCache.get(key);
  if (html) return html;
  const spoken = h ? `${PENTAD_NAMES[index]}, ${helionPlace(h)}` : PENTAD_NAMES[index];
  const tip = title === true ? spoken : title || '';
  const num = numeral && PENTAD_NUMERALS[index] ? `<span class="pentad-num">${PENTAD_NUMERALS[index]}</span>` : '';
  const hel = h ? `<span class="pentad-hel">·${h}</span>` : '';
  html = `<span class="pentad-mark${index === 3 ? ' is-hypo' : ''}${cls ? ' ' + cls : ''}" role="img" aria-label="${esc(spoken)}"${tip ? ` title="${esc(tip)}"` : ''} data-pentad="${index}">${pentadShapeSVG(index)}${num}${hel}</span>`;
  if (markCache.size > 400) markCache.clear();
  markCache.set(key, html);
  return html;
}

/** The mark as a DOM element (same options as pentadMarkHTML). */
export function pentadMarkEl(p, opts) {
  const tpl = document.createElement('template');
  tpl.innerHTML = pentadMarkHTML(p, opts);
  return tpl.content.firstElementChild ?? document.createElement('span');
}

// ---- leading a reading ------------------------------------------------------------------------------------------
const pentadOf = (model, t) => {
  try {
    return Number.isFinite(t) ? model.pentadAt(t) : null;
  } catch {
    return null;
  }
};

/**
 * HTML of a reading led by its Pentad: `<span class="pentad-lead">[mark] reading</span>`. `html` must already be safe
 * HTML. Outside the catalogue (no Pentad) the reading is returned unchanged. `p` may be passed when already known.
 */
export function leadHTML(model, t, html, { p = pentadOf(model, t), ...opts } = {}) {
  if (!p) return html;
  return `<span class="pentad-lead">${pentadMarkHTML(p, opts)}<span class="pentad-rest">${html}</span></span>`;
}

/**
 * Plain text of a reading led by its Pentad, for tooltips, aria labels and the clipboard:
 *   'full'  "Pentad II · δ#4 ε#1 44η 15ι"   (default)
 *   'ascii' "P2 δ#4 ε#1 44η 15ι"
 *   'short' "⬠II δ#4 ε#1 44η 15ι"           (only where the text is not HTML: native share sheets, plain files)
 */
export function leadText(model, t, text, { form = 'full', p = pentadOf(model, t), sep } = {}) {
  if (!p) return text;
  const name = form === 'ascii' ? PENTAD_ASCII[p.index] : form === 'short' ? PENTAD_SHORT[p.index] : PENTAD_NAMES[p.index];
  if (!text) return name;
  return `${name}${sep ?? (form === 'full' ? ' · ' : ' ')}${text}`;
}

// ---- canvas ------------------------------------------------------------------------------------------------------
/**
 * Draw the mark on a 2D canvas: the shape `size` px tall with its left edge at x and its middle at y, then the numeral in
 * `font` (default the context's). Returns the width drawn, so a label can follow. `measure: true` only measures.
 */
export function drawPentadMark(g, index, x, y, { size = 11, color, font, numeral = true, lineWidth, measure = false } = {}) {
  if (!isIndex(index)) return 0;
  const s = size / BOX;
  const num = numeral ? PENTAD_NUMERALS[index] : '';
  g.save();
  if (font) g.font = font;
  const numW = num ? g.measureText(num).width : 0;
  const gap = num ? size * 0.16 : 0;
  if (!measure) {
    const top = y - size / 2;
    g.beginPath();
    shapePoints(index).forEach(([px, py], k) => (k ? g.lineTo(x + px * s, top + py * s) : g.moveTo(x + px * s, top + py * s)));
    g.closePath();
    if (color) {
      g.strokeStyle = color;
      g.fillStyle = color;
    }
    g.lineWidth = lineWidth ?? Math.max(1, size * 0.125);
    g.lineJoin = 'round';
    g.stroke();
    if (num) {
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillText(num, x + size + gap, y + size * 0.04);
    }
  }
  g.restore();
  return size + gap + numW;
}

// ---- spans -------------------------------------------------------------------------------------------------------
const nextOf = ({ sync, index }) => (index < 3 ? { sync, index: index + 1 } : { sync: sync + 1, index: 0 });
const prevOf = ({ sync, index }) => (index > 0 ? { sync, index: index - 1 } : { sync: sync - 1, index: 3 });
const spanOf = (model, sync, index) => {
  const s = model.pentadByNumber(sync, index);
  return s ? { sync, index, helions: PENTAD_HELIONS[index], start: s.start, end: s.end } : null;
};

/** The Pentad after (dir +1) or before (dir −1) a pentad {sync, index}, with its start and end; null past the catalogue. */
export function pentadStep(model, p, dir = 1) {
  const n = dir > 0 ? nextOf(p) : prevOf(p);
  return spanOf(model, n.sync, n.index);
}

/**
 * The Pentads overlapping [t0, t1), in order: [{sync, index, helions, start, end}] (the catalogue's first and last are cut
 * at its edges). At most `limit` (default 2000).
 */
export function pentadsIn(model, t0, t1, { limit = 2000 } = {}) {
  const out = [];
  if (!(t1 > t0)) return out;
  const from = Math.max(t0, model.tMin);
  const first = pentadOf(model, from);
  if (!first) return out;
  let p = spanOf(model, first.sync, first.index);
  while (p && p.start < t1 && out.length < limit) {
    if (p.end > t0) out.push(p);
    p = pentadStep(model, p, 1);
  }
  return out;
}

/**
 * A cached lookup for many instants close together (calendar cells, list rows, tooltips that follow the pointer):
 * `at(t)` returns {sync, index, helion, helions, start, end} like model.pentadAt, reusing the spans it has seen.
 */
export function pentadLookup(model, { keep = 64 } = {}) {
  const spans = [];
  return function at(t) {
    if (!Number.isFinite(t)) return null;
    for (const s of spans) {
      if (t >= s.start && t < s.end) return s.make(t);
    }
    const p = pentadOf(model, t);
    if (!p) return null;
    const helion = (p.end - p.start) / p.helions;
    const make = (x) => {
      // the Helion's place inside the Pentad from its start; clamped so rounding never says the 6th Helion
      const k = Math.min(p.helions, Math.max(1, Math.floor((x - p.start) / helion) + 1));
      return k === p.helion ? p : { ...p, helion: k };
    };
    // the clock reads to the millisecond, so a Pentad holds from just after its start: skip the exact boundary
    spans.unshift({ start: p.start + 0.001, end: p.end, make });
    if (spans.length > keep) spans.pop();
    return p;
  };
}

// ---- the chart ----------------------------------------------------------------------------------------------------
/**
 * The picture of the Sun link for the sync running at t (SPEC §7.5), in Helion units, aligned to the solar day:
 *   rows    four rows, one per Pentad: row r is solar day r+1 of the sync, counted from the time of day the sync began.
 *           Its cells are the Pentad's Helions, starting at x = r/4 (a quarter Helion later each day) and 1 wide, so
 *           Pentads I–III run past the day's end (x = 4.75) by ¼, ½ and ¾ Helion, and the Hypopentad – one Helion
 *           short – ends exactly on it: the next Pentad I starts again at x = 0.
 *   now     {row, x} the present inside the picture (x in Helions from the day's start) and the lit cell.
 * Cells carry `state`: 'past' | 'now' | 'next', their sync Helion k (0..18) and their start/end times.
 * @returns {null | { sync, index, helion, phase, rows: Array<{index, helions, offset, start, end, cells}>, now, day: 4.75, width }}
 */
export function pentadChart(model, t) {
  const p = pentadOf(model, t);
  if (!p) return null;
  const rows = [];
  let k = 0;
  let nowX = null;
  let phase = 0;
  for (let index = 0; index < 4; index++) {
    const span = model.pentadByNumber(p.sync, index);
    const helions = PENTAD_HELIONS[index];
    const offset = index / 4;
    const cells = [];
    for (let j = 0; j < helions; j++, k++) {
      const start = span ? span.start + ((span.end - span.start) * j) / helions : null;
      const end = span ? span.start + ((span.end - span.start) * (j + 1)) / helions : null;
      let state = 'next';
      if (index < p.index || (index === p.index && j + 1 < p.helion)) state = 'past';
      else if (index === p.index && j + 1 === p.helion) state = 'now';
      cells.push({ k, j, x: offset + j, start, end, state });
      if (state === 'now' && start !== null) {
        phase = Math.min(1, Math.max(0, (t - start) / (end - start)));
        nowX = offset + j + phase;
      }
    }
    rows.push({ index, helions, offset, start: span?.start ?? null, end: span?.end ?? null, cells });
  }
  return {
    sync: p.sync,
    index: p.index,
    helion: p.helion,
    phase,
    rows,
    now: nowX === null ? null : { row: p.index, x: nowX },
    day: DAY_HELIONS,
    width: 2 / 4 + 5, // the widest row: Pentad III ends at ½ + 5 (the Hypopentad at ¾ + 4 = 4.75, on the day's end)
  };
}
