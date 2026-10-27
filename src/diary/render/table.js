/**
 * Tables and writing lines for the front matter and the book pages.
 *
 * Columns size themselves from their content; when the content box is too narrow the whole table takes smaller type
 * (down to `minScale`) and the flexible column (the label) is elided. Nothing leaves the box.
 */
import { measure, n2, SIZE } from './common.js';
import { drawMark, markWidth } from './pentad.js';

const cellText = (c) => (c === null || c === undefined ? '' : typeof c === 'object' ? c.text ?? '' : String(c));
/** A cell's Pentad (0..3) when it leads with one: `{text, pentad}` draws the Pentad's mark before the text. */
const cellPentad = (c) => (c && typeof c === 'object' && c.pentad >= 0 && c.pentad <= 3 ? c.pentad : null);

/**
 * @param {object} t
 *   x0, x1        the box
 *   y             top of the table (the column header, when given, sits in its first `headH` mm)
 *   rowH          row height (mm); size: the type size (mm)
 *   cols          [{key, align:'start'|'end', flex, weight, fill, size (relative), min}]
 *   rows          [{cells:{key: string | {text, fill, weight, pentad}}, fill, weight, rule:'strong'|'none'}]; a cell with
 *                 `pentad` (0..3) leads with that Pentad's mark (SPEC §7.5) in the Sun's colour
 *   header        {key: title} (small caps above the rows) or null
 *   onLayout      ({xs, ws, top, rowH}) => void: called before the rows are drawn (tints and glyphs go under the text)
 * @returns {number} the y below the table
 */
export function drawTable(svg, cx, { x0, x1, y, rowH, size = 2.1, cols, rows, header = null, headH = 4, gap = 2.4, minScale = 0.72, rules = true, onLayout = null }) {
  const { pal, font } = cx;
  const avail = x1 - x0;
  const w0 = cols.map((c) => {
    let w = 0;
    for (const r of rows) {
      const cell = r.cells[c.key];
      const t = cellText(cell);
      const pe = cellPentad(cell);
      const mw = pe === null ? 0 : markWidth(pe, size * (c.size ?? 1), { font, after: !!t });
      if (t || mw) w = Math.max(w, mw + (t ? measure(t, size * (c.size ?? 1), { weight: cell?.weight ?? r.weight ?? c.weight, font }) : 0));
    }
    if (header?.[c.key]) w = Math.max(w, measure(header[c.key], SIZE.tiny * 0.95, { font }) + 0.4);
    return Math.max(c.min ?? 0, w);
  });
  const total = (ws) => ws.reduce((s, w) => s + w, 0) + gap * (cols.length - 1);
  let k = 1;
  if (total(w0) > avail) k = Math.max(minScale, (avail - gap * (cols.length - 1)) / (total(w0) - gap * (cols.length - 1)));
  const ws = w0.map((w) => w * k);
  const flex = Math.max(0, cols.findIndex((c) => c.flex));
  const spare = avail - total(ws);
  ws[flex] = Math.max(4, ws[flex] + spare);
  const xs = [];
  let x = x0;
  for (let i = 0; i < cols.length; i++) {
    xs.push(x);
    x += ws[i] + gap;
  }
  let yy = y;
  if (header) {
    const hb = yy + headH - 1.1;
    cols.forEach((c, i) => {
      const t = header[c.key];
      if (!t) return;
      svg.text(c.align === 'end' ? xs[i] + ws[i] : xs[i], hb, t.toUpperCase(), { size: SIZE.tiny * 0.95, fill: pal.ink3, anchor: c.align === 'end' ? 'end' : 'start', ls: 0.12, maxW: ws[i] + 0.2 });
    });
    yy += headH;
    svg.line(x0, yy, x1, yy, pal.ruleStrong, 0.2);
  }
  const fsRow = size * k;
  onLayout?.({ xs, ws, top: yy, rowH });
  for (const r of rows) {
    if (r.rule === 'strong') svg.line(x0, yy, x1, yy, pal.ruleStrong, 0.2);
    const base = yy + rowH * 0.5 + fsRow * 0.36;
    cols.forEach((c, i) => {
      const cell = r.cells[c.key];
      const t = cellText(cell);
      const pe = cellPentad(cell);
      if (!t && pe === null) return;
      const fs = fsRow * (c.size ?? 1);
      const mw = pe === null ? 0 : markWidth(pe, fs, { font, after: !!t });
      const o = { size: fs, fill: cell?.fill ?? r.fill ?? c.fill ?? pal.ink, weight: cell?.weight ?? r.weight ?? c.weight, anchor: c.align === 'end' ? 'end' : 'start', maxW: ws[i] + 0.2 - mw, min: fs * 0.85 };
      const end = c.align === 'end';
      const tw = t ? svg.text(end ? xs[i] + ws[i] : xs[i] + mw, base, t, o).width : 0;
      // the mark leads the text in reading order, whichever edge the column keeps
      if (pe !== null) drawMark(svg, pe, end ? xs[i] + ws[i] - tw - mw : xs[i], base, fs, cx.solar ?? pal.ink2, { font });
    });
    yy += rowH;
    if (rules && r.rule !== 'none') svg.line(x0, yy, x1, yy, pal.ruleSoft, 0.12);
  }
  return yy;
}

/** Writing lines from yTop (exclusive) to yBottom, `gap` apart; returns how many were drawn. */
export function writingLines(svg, cx, x0, x1, yTop, yBottom, gap) {
  const n = Math.floor((yBottom - yTop) / gap + 1e-6);
  if (n < 1) return 0;
  const d = [];
  for (let i = 1; i <= n; i++) d.push(`M${n2(x0)} ${n2(yTop + i * gap)}H${n2(x1)}`);
  svg.path(d.join(''), { stroke: cx.pal.rule, sw: 0.15 });
  return n;
}

/** The writing-line pitch of free pages (notes, planning): ~6.4 mm on A5, never below 5 or above 8 mm. */
export const lineGap = (fr) => Math.min(8, Math.max(5, fr.ch / 29));

/** A block heading: bold runs on a baseline with a rule under it. Returns the y below the rule. */
export function blockHead(svg, cx, fr, y, runs, { rule = true, size = 2.3 } = {}) {
  const yb = y + size * 1.05;
  svg.runs(fr.x0, yb, runs.map((r) => ({ size, ...r })), { maxW: fr.cw, minScale: 0.75 });
  const yr = yb + 1.3;
  if (rule) svg.line(fr.x0, yr, fr.x1, yr, cx.pal.ruleStrong, 0.2);
  return yr;
}

/** Wrapped paragraph lines (already split); returns the y below. */
export function paragraph(svg, cx, x, y, lines, { size = 1.8, fill, lead = 1.32, maxW } = {}) {
  let yy = y;
  for (const l of lines) {
    yy += size * lead;
    svg.text(x, yy, l, { size, fill: fill ?? cx.pal.ink2, maxW });
  }
  return yy;
}

