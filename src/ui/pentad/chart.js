/**
 * The Pentad chart (SPEC §7.5): the running solar sync's 19 Helions as four rows – Pentad I, II, III (5 Helions) and the
 * Hypopentad (4) – laid against the solar day, so the Sun link can be seen rather than read.
 *
 *   rows      one per Pentad, each a solar day of the sync, counted from the time of day the sync began (x = 0)
 *   cells     the Pentad's Helions, one Helion wide; row r starts r/4 Helion later (a quarter Helion later in the day)
 *   day line  the gold line at x = 4¾η, where the Sun is back in the same place: Pentads I–III run ¼, ½ and ¾ Helion
 *             past it, and the Hypopentad – one Helion short – ends exactly on it, so the next Pentad I starts at x = 0
 *   now       the lit Helion, with a needle at the present
 *   labels    each Pentad's mark on the left; on the right when it starts: its clock time (the drift in hours and
 *             minutes) or, in pure mode, "+¼η" against the sync's own time of day
 *
 * createPentadChart(ctx) -> { el, update(t, force), destroy }. Geometry from pentadChart() in ../pentad.js; the SVG is
 * rebuilt once per sync (or mode / zone change) and per frame only the needle, the lit cell and its fill move.
 */
import { pentadChart, pentadName, shapePath, PENTAD_NUMERALS, OFFSET_TEXT, DAY_HELIONS, helionPlace } from '../pentad.js';

const NS = 'http://www.w3.org/2000/svg';
// layout, in SVG user units (the chart scales to its box)
const W = 320;
const L = 46; // the marks
const R = 46; // the start labels
const TOP = 24; // the day line's label
const ROW = 20;
const GAP = 7;
const BOTTOM = 20; // the solar day's bracket
const SPAN = 5.5; // the widest row: Pentad III ends ½ + 5 Helions after its day began
const U = (W - L - R) / SPAN;
const H = TOP + 4 * ROW + 3 * GAP + BOTTOM;
const X = (helions) => L + helions * U;
const Y = (row) => TOP + row * (ROW + GAP);
const f1 = (v) => Number(v.toFixed(1));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A small sun: a disc and eight rays, centred on (x, y). */
function sunSVG(x, y, r) {
  const rays = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    rays.push(`M${f1(x + Math.cos(a) * r * 1.55)} ${f1(y + Math.sin(a) * r * 1.55)}L${f1(x + Math.cos(a) * r * 2.15)} ${f1(y + Math.sin(a) * r * 2.15)}`);
  }
  return `<g class="pc-sun"><circle cx="${f1(x)}" cy="${f1(y)}" r="${r}"/><path d="${rays.join('')}"/></g>`;
}

/** A Pentad's mark drawn in the chart's own units: the shape `s` tall at (x, yMid), then its numeral. */
function markSVG(index, x, yMid, s) {
  const k = s / 12;
  const num = PENTAD_NUMERALS[index];
  return (
    `<path class="pc-shape" d="${shapePath(index)}" transform="translate(${f1(x)} ${f1(yMid - s / 2)}) scale(${k.toFixed(4)})"/>` +
    (num ? `<text class="pc-num" x="${f1(x + s + 2.5)}" y="${f1(yMid)}" dominant-baseline="central">${num}</text>` : '')
  );
}

export function createPentadChart({ model, fmt, isPure }) {
  const el = document.createElement('div');
  el.className = 'pentad-chart';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'pc-svg');
  svg.setAttribute('role', 'img');
  el.append(svg);

  let layout = null; // pentadChart() of the running sync
  let key = '';
  let cells = []; // [{rect, fill, start, end, row}] in sync order
  let needle = null;
  let rowEls = [];
  let lit = -1;
  let lastFill = '';
  let lastLabel = '';

  /** "16:17" – a Pentad's start as a clock time (never in pure mode). */
  const hm = (t) => fmt.time(t, { seconds: false });

  function build(c, pure) {
    const parts = [];
    // the solar day of each row, and what lies past it (the next day)
    for (let r = 0; r < 4; r++) {
      parts.push(`<rect class="pc-day" x="${f1(X(0))}" y="${f1(Y(r) - 2)}" width="${f1(DAY_HELIONS * U)}" height="${ROW + 4}" rx="5"/>`);
    }
    // the sync's time of day (x = 0) and the solar day's end (x = 4¾): where the Sun is back in the same place
    parts.push(`<line class="pc-start" x1="${f1(X(0))}" x2="${f1(X(0))}" y1="${TOP - 6}" y2="${f1(Y(3) + ROW + 6)}"/>`);
    parts.push(`<line class="pc-dayline" x1="${f1(X(DAY_HELIONS))}" x2="${f1(X(DAY_HELIONS))}" y1="${TOP - 4}" y2="${f1(Y(3) + ROW + 6)}"/>`);
    parts.push(sunSVG(X(DAY_HELIONS), 9, 3.2));
    parts.push(`<text class="pc-axis" x="${f1(X(DAY_HELIONS) + 10)}" y="10" dominant-baseline="central">${DAY_HELIONS === 4.75 ? '4¾η' : DAY_HELIONS + 'η'}</text>`);
    parts.push(`<text class="pc-axis pc-axis-0" x="${f1(X(0))}" y="10" text-anchor="middle" dominant-baseline="central">${pure ? '0' : esc(hm(c.rows[0].start ?? 0))}</text>`);
    // the bracket under the day: "a solar day = 4¾η"
    const by = Y(3) + ROW + 11;
    parts.push(`<path class="pc-bracket" d="M${f1(X(0))} ${f1(by - 3)}V${f1(by)}H${f1(X(DAY_HELIONS))}V${f1(by - 3)}"/>`);
    parts.push(`<text class="pc-axis" x="${f1(X(DAY_HELIONS / 2))}" y="${f1(by + 6.5)}" text-anchor="middle" dominant-baseline="central">${pure ? 'a solar day' : 'a solar day · 24 h'}</text>`);
    parts.push(`<text class="pc-axis pc-col" x="${W - 4}" y="10" text-anchor="end" dominant-baseline="central">starts</text>`);
    for (const row of c.rows) {
      const y = Y(row.index);
      const start = row.start === null ? '' : pure ? OFFSET_TEXT[row.index] : hm(row.start);
      parts.push(`<g class="pc-row" data-row="${row.index}">`);
      parts.push(`<g class="pc-mark">${markSVG(row.index, 6, y + ROW / 2, 12)}</g>`);
      for (const cell of row.cells) {
        const x = X(cell.x) + 1.5;
        parts.push(
          `<g class="pc-cell" data-k="${cell.k}"><rect class="pc-box" x="${f1(x)}" y="${y}" width="${f1(U - 3)}" height="${ROW}" rx="4"/>` +
            `<rect class="pc-fill" x="${f1(x)}" y="${y}" width="0" height="${ROW}" rx="4"/>` +
            `<text class="pc-n" x="${f1(x + (U - 3) / 2)}" y="${f1(y + ROW / 2 + 0.5)}" text-anchor="middle" dominant-baseline="central">${cell.j + 1}</text></g>`,
        );
      }
      parts.push(`<text class="pc-when" x="${W - 4}" y="${f1(y + ROW / 2 + 0.5)}" text-anchor="end" dominant-baseline="central">${esc(start)}</text>`);
      parts.push('</g>');
    }
    parts.push(`<line class="pc-needle" x1="0" x2="0" y1="0" y2="0"/>`);
    svg.innerHTML = parts.join('');
    cells = [...svg.querySelectorAll('.pc-cell')].map((g, k) => {
      const cell = c.rows.flatMap((r) => r.cells)[k];
      return { g, box: g.querySelector('.pc-box'), fill: g.querySelector('.pc-fill'), start: cell.start, end: cell.end, x: X(cell.x) + 1.5, row: cell.k < 15 ? Math.floor(cell.k / 5) : 3 };
    });
    rowEls = [...svg.querySelectorAll('.pc-row')];
    needle = svg.querySelector('.pc-needle');
    lit = -1;
    lastFill = '';
  }

  /** Draw the chart for time t. Cheap when nothing visible changed; `force` rebuilds (mode or zone changed). */
  function update(t, force = false) {
    const inside = layout && t >= layout.rows[0].start && t < layout.rows[3].end;
    if (!inside || force) {
      layout = Number.isFinite(t) ? pentadChart(model, t) : null;
      if (!layout || layout.rows[0].start === null || layout.rows[3].end === null) {
        if (key !== 'none') {
          svg.innerHTML = '';
          key = 'none';
          el.classList.add('is-empty');
          svg.setAttribute('aria-label', 'No Pentad: outside the catalogue');
        }
        layout = null;
        return;
      }
    }
    el.classList.remove('is-empty');
    const pure = !!isPure();
    const k = `${layout.sync}|${pure}|${pure ? '' : hm(layout.rows[0].start)}`;
    if (k !== key || force) {
      build(layout, pure);
      key = k;
    }
    // the lit Helion and the needle
    let now = cells.findIndex((c) => t >= c.start && t < c.end);
    if (now < 0) now = t >= cells.at(-1).end ? cells.length - 1 : 0;
    if (now !== lit) {
      cells.forEach((c, i) => c.g.setAttribute('class', `pc-cell ${i < now ? 'is-past' : i === now ? 'is-now' : 'is-next'}`));
      rowEls.forEach((g, r) => g.classList.toggle('is-now', r === cells[now].row));
      lit = now;
    }
    const c = cells[now];
    const phase = Math.min(1, Math.max(0, (t - c.start) / (c.end - c.start)));
    const w = f1((U - 3) * phase);
    const nx = f1(c.x + w);
    const fillKey = `${now}|${w}`;
    if (fillKey !== lastFill) {
      c.fill.setAttribute('width', String(w));
      const y = Y(c.row);
      needle.setAttribute('x1', String(nx));
      needle.setAttribute('x2', String(nx));
      needle.setAttribute('y1', String(y - 4));
      needle.setAttribute('y2', String(y + ROW + 4));
      lastFill = fillKey;
    }
    const row = c.row;
    const place = now - [0, 5, 10, 15][row] + 1;
    const day = isPure() ? 'the solar day' : 'the day';
    const label = `The solar sync's 19 Helions as four Pentads against the solar day: now ${pentadName(row)}, ${helionPlace(place)}. Each Pentad starts a quarter Helion later in ${day}; the Hypopentad, one Helion short, ends on ${day} and brings Pentad I back.`;
    if (label !== lastLabel) {
      svg.setAttribute('aria-label', label);
      lastLabel = label;
    }
  }

  return {
    el,
    update,
    /** The running sync's chart data (null outside the catalogue). */
    get layout() {
      return layout;
    },
    destroy() {
      el.remove();
    },
  };
}
