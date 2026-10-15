/**
 * The reference sheet: the period ladder (front) and the milestones of Alpha, Beta and Gamma (back).
 *
 * Ladder: how the hierarchy is derived (SPEC §3.1), then one row per level for the 63 levels: depth, letter, unit name,
 * factor from the parent, cycles per Alpha, period, frequency (below one second) and the range it falls in; rounds of
 * 8 levels are banded. Pure mode counts Blinks instead: Blinks per cycle above the Blink, cycles per Blink (pB) below.
 * Milestones: the Alpha that holds the Delta with its quarter thresholds (each one an eclipse), its 5 Betas with their
 * thresholds, and the 13 × 5 grid of its Gammas; eclipse cells are tinted and this diary's Gamma is outlined. Pure mode
 * prints positions (pos) where normal mode prints dates.
 * Data: plan.reference (src/diary/reference.js).
 */
import { SIZE, wrap, measure, n2 } from './common.js';
import { drawTable, blockHead, paragraph } from './table.js';
import { QUARTER_GLYPH, QUARTER_WORD } from './words.js';
import { periodText, frequencyText, bigText, groupBig, bandOf, sci, PLANCK_TIME } from '../reference.js';

function pageTitle(svg, cx, fr, text, aside) {
  svg.runs(fr.x0, fr.y0 + 5, [
    { text, size: 5, weight: 600, fill: cx.pal.ink },
    { text: aside, size: SIZE.small, fill: cx.pal.ink3, gap: 2 },
  ], { maxW: fr.cw });
}

// ---- the period ladder --------------------------------------------------------------------------------------------

export function renderLadder(svg, cx, fr) {
  const { plan, pal, pureMode, font } = cx;
  const ref = plan.reference;
  if (!ref) return;
  const { rows, interval, next } = ref.ladder;
  pageTitle(svg, cx, fr, 'Period ladder', `${rows.length} levels, Alpha to the Planck scale`);
  const k = interval.k;
  // no-break spaces (U+00A0, U+202F in digit groups) keep the sequence, the formulas and the numbers on one line
  const nb = (text) => text.replace(/ /g, '\u00a0');
  const S = nb('S = 5, 13, 5, 5, 7, 11, 9, 4');
  const round = groupBig(4504500);
  const head =
    `Alpha (level 0) spans 4 Saros: four intervals between eclipses of ${pureMode ? 'the catalogue' : 'Saros 141'}. Each level below splits ` +
    `its parent by the next factor of the sequence ${S}, which repeats every 8 levels (each round multiplies by ${round}; rounds are ` +
    `banded). Level L has P(L) cycles per Alpha, ${nb('P(0) = 1')} and ${nb('P(L) = P(L−1) · S[(L−1) mod 8]')}, and one cycle lasts ` +
    `${nb('4 Saros / P(L)')}. Letters run α … ω, then α1, β1 ….`;
  const intro = pureMode
    ? `${head} Lengths are exact counts of the Blink (ν): Blinks per cycle down to it, cycles per Blink (pB) below it.`
    : `${head} Periods use the eclipse interval #${k}–#${k + 1} (${cx.gp(interval.t0).year}–${cx.gp(interval.t1).year}) that holds this Delta; frequencies are given below one second.`;
  const introSize = Math.min(1.75, Math.max(1.45, fr.cw / 66));
  const lines = wrap(intro, fr.cw, introSize, { maxLines: 12, font });
  const yIntro = paragraph(svg, cx, fr.x0, fr.y0 + 7.6, lines, { size: introSize, lead: 1.3, maxW: fr.cw });

  // the last line: the next level would be the Planck time
  const blinkSeconds = (4 * interval.seconds) / Number(rows[12].prefix);
  const nextPerBlink = blinkSeconds / next.seconds;
  const foot = pureMode
    ? `The next level, ${next.text} (depth ${next.level + 1}), would be ${sci(nextPerBlink, 'pB')}: the Planck time is ${sci(blinkSeconds / PLANCK_TIME, 'pB')}.`
    : `The next level, ${next.text} (depth ${next.level + 1}), would last ${sci(next.seconds, 's')}: the Planck time is ${sci(PLANCK_TIME, 's')}.`;
  const footSize = Math.min(1.7, introSize);
  const footY = fr.y1 - 0.6;

  const top = yIntro + 2.2;
  const headH = 3.6;
  const rowH = Math.min(4, (footY - footSize * 1.6 - top - headH) / rows.length);
  const size = Math.min(2, rowH * 0.7);

  // a frequency range is named on its first row; a hairline carries it down
  let range = null;
  const ranges = [];
  const trs = rows.map((r) => {
    const b = bandOf(r.hz);
    const name = b ? b.name : null;
    let bandText = '';
    if (name !== range) {
      range = name;
      if (name) {
        ranges.push({ name, from: r.level, to: r.level });
        bandText = b.nm && !pureMode ? `${name} ${Math.round(b.nm)} nm` : name;
      }
    } else if (name) ranges.at(-1).to = r.level;
    const unitLevel = r.unit !== null;
    const colour = r.level <= 13 ? pal.level(r.level) : pal.ink2;
    const cells = {
      depth: { text: String(r.depth), fill: pal.ink3 },
      sym: { text: r.text, fill: unitLevel || r.level > 12 ? colour : pal.ink3, weight: unitLevel ? 600 : 400 },
      unit: r.unit ? { text: r.unit, fill: colour, weight: r.major ? 600 : 400 } : '',
      f: r.siblings === null ? { text: '—', fill: pal.ink4 } : { text: String(r.siblings), fill: pal.ink2 },
      per: { text: bigText(r.prefix), fill: pal.ink2 },
      band: bandText ? { text: bandText, fill: pal.ink2 } : '',
    };
    if (pureMode) {
      cells.blinks = r.blinks !== null ? { text: groupBig(r.blinks), fill: pal.ink } : '';
      cells.pb = r.perBlink !== null ? { text: `${bigText(r.perBlink)} pB`, fill: pal.ink } : '';
    } else {
      cells.period = { text: periodText(r.seconds), fill: pal.ink };
      cells.freq = r.seconds < 1 ? { text: frequencyText(r.hz), fill: pal.ink } : '';
    }
    // a round is one pass of the factor sequence: levels 1–8 (×5 … ×4), 9–16 …; Alpha stands above them
    return { rule: r.level % 8 === 1 ? 'strong' : undefined, cells };
  });
  const cols = [
    { key: 'depth', align: 'end', min: 3 },
    { key: 'sym', min: 3.5 },
    { key: 'unit' },
    { key: 'f', align: 'end' },
    { key: 'per', align: 'end' },
    ...(pureMode ? [{ key: 'blinks', align: 'end' }, { key: 'pb', align: 'end' }] : [{ key: 'period', align: 'end' }, { key: 'freq', align: 'end' }]),
    { key: 'band', flex: true },
  ];
  const header = { depth: '#', sym: 'Level', unit: 'Unit', f: '×', per: 'Per Alpha', period: 'Period', freq: 'Frequency', blinks: 'Blinks', pb: 'Per Blink', band: 'Range' };
  const bandCol = cols.findIndex((c) => c.key === 'band');
  drawTable(svg, cx, {
    x0: fr.x0,
    x1: fr.x1,
    y: top,
    rowH,
    size,
    gap: 1.8,
    cols,
    rows: trs,
    header,
    headH,
    rules: false,
    onLayout: ({ xs, top: y0 }) => {
      // the rounds of the factor sequence: every other one banded
      for (let r0 = 9; r0 < rows.length; r0 += 16) svg.rect(fr.x0, y0 + r0 * rowH, fr.cw, Math.min(8, rows.length - r0) * rowH, { fill: pal.shade });
      // a range runs on under its name
      const x = xs[bandCol] + 0.5;
      for (const b of ranges) {
        if (b.to <= b.from) continue;
        svg.line(x, y0 + (b.from + 1) * rowH + 0.25, x, y0 + (b.to + 1) * rowH - 0.35, pal.ink4, 0.16);
      }
    },
  });
  svg.text(fr.x0, footY, foot, { size: footSize, fill: pal.ink3, maxW: fr.cw });
}

// ---- milestones ---------------------------------------------------------------------------------------------------

const EVENT_WORD = { begin: 'begins', peak: 'Peak', node: 'Node', valley: 'Valley', end: 'ends' };
const COLUMN_WORD = { begin: 'Begins', peak: 'Peak', node: 'Node', valley: 'Valley', end: 'Ends' };
/** "Beta Difracton Peak", "Gamma Monofracton begins" */
const atWords = (a) => `${a.name} ${EVENT_WORD[a.event] ?? a.event}`;

export function renderMilestones(svg, cx, fr) {
  const { plan, pal, pureMode } = cx;
  const model = cx.env.model;
  const ref = plan.reference;
  if (!ref) return;
  const M = ref.milestones;
  const D = plan.delta;
  const pos = (t) => (t === null || t === undefined ? null : model.positionOf(t));
  const posText = (t, digits) => {
    const p = pos(t);
    return p === null ? '—' : p.toFixed(digits);
  };
  const dateText = (t) => (t === null || t === undefined ? '—' : cx.gDay(t, { year: true, weekday: false }));
  pageTitle(svg, cx, fr, 'Milestones', `${M.alpha.name}, its Betas and Gammas`);
  svg.runs(fr.x0, fr.y0 + 9.4, [
    { text: '●', size: 1.9, fill: pal.eclipse },
    { text: pureMode ? 'an eclipse of the catalogue, #k at pos k' : 'a greatest eclipse of Saros 141', size: 1.9, fill: pal.ink3, gap: 0.8 },
    { text: '▸', size: 1.9, fill: pal.level(3), gap: 2.4 },
    { text: 'this diary', size: 1.9, fill: pal.ink3, gap: 0.8 },
    { text: pureMode ? '· positions in Saros (pos)' : '', size: 1.9, fill: pal.ink3, gap: 1.4 },
  ], { maxW: fr.cw, minScale: 0.75 });

  const legend = 'Alpha spans 4 Saros, so each of its quarter thresholds is an eclipse. A Beta spans 4/5 and a Gamma 4/65 of the same 4 Saros, so every eclipse also meets a threshold of a Beta and of a Gamma, one quarter further along each time: the diagonal in both tables.';
  const legendSize = Math.min(1.65, Math.max(1.4, fr.cw / 70));
  const legendLines = wrap(legend, fr.cw, legendSize, { maxLines: 5, font: cx.font });
  const legendH = legendLines.length * legendSize * 1.3 + 1.2;

  // vertical budget: fixed parts, then rows scaled to fill the page (base heights of A5)
  const blockHeadH = 5.2;
  const tableHeadH = 3.8;
  const gapB = 3;
  const startY = fr.y0 + 11.6;
  const fixed = 3 * blockHeadH + 2 * tableHeadH + 4 + 3 * gapB + legendH;
  const aRows = 6;
  const base = aRows * 4.2 + 5 * 4.4 + 13 * 5.0;
  const s = Math.min(2, Math.max(0.4, (fr.y1 - startY - fixed) / base));
  // type grows with the rows on large paper (A4), never beyond 1.4×
  const fk = Math.min(1.4, Math.max(1, s / 1.25));
  const rA = 4.2 * s;
  const rB = 4.4 * s;
  const rC = 5.0 * s;

  // ---- Alpha: its thresholds, every one an eclipse ---------------------------------------------------------
  let y = blockHead(svg, cx, fr, startY, [
    { text: M.alpha.name, fill: pal.level(0), weight: 600 },
    { text: pureMode ? `#${M.alpha.thresholds[0].eclipse ?? '—'} … #${M.alpha.thresholds.at(-1).eclipse ?? '—'}` : `${dateText(M.alpha.t0)} – ${dateText(M.alpha.t1)}`, fill: pal.ink2, size: 1.9 * fk, gap: 1.8 },
  ], { size: 2.3 * fk });
  const aTrs = [];
  const glyphRows = [];
  const here = { t: D.t0, here: true };
  const seq = [...M.alpha.thresholds];
  const at = seq.findIndex((x) => x.t !== null && x.t > D.t0);
  seq.splice(at < 0 ? seq.length : at, 0, here);
  for (const th of seq) {
    if (th.here) {
      glyphRows.push(null);
      aTrs.push({
        fill: pal.level(3),
        cells: {
          what: { text: '▸ This diary', fill: pal.level(3), weight: 600 },
          ecl: '',
          when: { text: pureMode ? D.stamp : cx.gDays(D.t0, D.t1, { year: true, weekday: false }), fill: pal.ink2 },
          also: { text: `${D.name} of ${D.words[2]}, ${D.words[1]}`, fill: pal.level(3) },
        },
      });
      continue;
    }
    glyphRows.push(QUARTER_GLYPH[th.event] ?? 0);
    const ecl = th.eclipse !== null;
    aTrs.push({
      cells: {
        what: { text: COLUMN_WORD[th.event], fill: pal.level(0), weight: 600 },
        ecl: ecl ? { text: `● #${th.eclipse}`, fill: pal.eclipse, weight: 600 } : '',
        when: { text: th.t === null ? '—' : pureMode ? `pos ${posText(th.t, 0)}` : cx.gLong(th.t), fill: pal.ink },
        also: { text: th.also.map(atWords).join(' · '), fill: pal.ink2 },
      },
    });
  }
  y = drawTable(svg, cx, {
    x0: fr.x0,
    x1: fr.x1,
    y: y + 0.4,
    rowH: rA,
    size: Math.min(1.9 * fk, rA * 0.46),
    gap: 1.8,
    cols: [{ key: 'g', min: Math.min(3.2 * fk, rA * 0.8) }, { key: 'what' }, { key: 'ecl' }, { key: 'when' }, { key: 'also', flex: true }],
    rows: aTrs,
    header: { what: 'Threshold', ecl: 'Eclipse', when: pureMode ? 'Position' : 'Gregorian', also: 'Also' },
    headH: tableHeadH,
    onLayout: ({ xs, ws, top, rowH }) => {
      glyphRows.forEach((g, i) => {
        if (g === null) {
          svg.rect(fr.x0, top + i * rowH, fr.cw, rowH, { fill: pal.levelSoft(3) });
          return;
        }
        if (aTrs[i].cells.ecl) svg.rect(xs[2] - 0.6, top + i * rowH + 0.25, ws[2] + 1.2, rowH - 0.5, { fill: pal.eclipseSoft, rx: 0.5 });
        svg.glyph(g, xs[0] + ws[0] / 2, top + (i + 0.5) * rowH, Math.min(3 * fk, rowH * 0.72), pal.level(0), 0.2 * fk);
      });
    },
  });

  // ---- Betas: begin, quarters, end ------------------------------------------------------------------------
  y = blockHead(svg, cx, fr, y + gapB, [
    { text: 'Betas', fill: pal.level(1), weight: 600 },
    { text: `the 5 Betas of ${M.alpha.name}`, fill: pal.ink2, size: 1.9 * fk, gap: 1.8 },
  ], { size: 2.3 * fk });
  const EV = ['begin', 'peak', 'node', 'valley', 'end'];
  const bTrs = M.betas.map((b) => {
    const cells = { name: { text: `${b.current ? '▸ ' : ''}${b.name}`, fill: pal.level(1), weight: b.current ? 600 : 400 } };
    for (const ev of EV) {
      const th = b.thresholds.find((x) => x.event === ev);
      const t = th?.t ?? null;
      const ecl = th && th.eclipse !== null;
      const txt = t === null ? '—' : pureMode ? posText(t, 1) : dateText(t);
      cells[ev] = { text: ecl ? `● ${txt}` : txt, fill: ecl ? pal.eclipse : t === null ? pal.ink4 : pal.ink, weight: ecl ? 600 : 400 };
    }
    return { cells };
  });
  y = drawTable(svg, cx, {
    x0: fr.x0,
    x1: fr.x1,
    y: y + 0.4,
    rowH: rB,
    size: Math.min(1.85 * fk, rB * 0.44),
    gap: 1.6,
    cols: [{ key: 'name', flex: true }, ...EV.map((key) => ({ key, align: 'end' }))],
    rows: bTrs,
    header: { name: 'Beta', ...COLUMN_WORD },
    headH: tableHeadH,
    onLayout: ({ xs, ws, top, rowH }) => {
      M.betas.forEach((b, i) => {
        if (b.current) svg.rect(fr.x0, top + i * rowH, fr.cw, rowH, { fill: pal.levelSoft(1) });
        EV.forEach((ev, j) => {
          const th = b.thresholds.find((x) => x.event === ev);
          if (th && th.eclipse !== null) svg.rect(xs[j + 1] - 0.6, top + i * rowH + 0.3, ws[j + 1] + 1.2, rowH - 0.6, { fill: pal.eclipseSoft, rx: 0.5 });
        });
      });
    },
  });

  // ---- Gammas: a grid of 13 rows (Gamma) × 5 columns (Beta) with the start of each ------------------------------
  y = blockHead(svg, cx, fr, y + gapB, [
    { text: 'Gammas', fill: pal.level(2), weight: 600 },
    { text: pureMode ? 'where each begins · rows Gamma, columns Beta' : 'the day each begins · rows Gamma, columns Beta', fill: pal.ink2, size: 1.9 * fk, gap: 1.8 },
  ], { size: 2.3 * fk });
  gammaGrid(svg, cx, fr, y + 0.4, rC, tableHeadH, M, { pureMode, posText, dateText, fk });
  paragraph(svg, cx, fr.x0, fr.y1 - legendH + 0.4, legendLines, { size: legendSize, lead: 1.3, maxW: fr.cw, fill: pal.ink3 });
}

function gammaGrid(svg, cx, fr, top, rowH, headH, M, { pureMode, posText, dateText, fk = 1 }) {
  const { pal } = cx;
  const labelSize = Math.min(1.85 * fk, rowH * 0.42);
  const word = (g) => g.name.split(' ').at(-1);
  const labelW = Math.max(...M.gammas[0].map((g) => measure(word(g), labelSize, { font: cx.font }))) + 1.6;
  const colW = (fr.cw - labelW) / 5;
  const two = rowH >= 4.3;
  const fs = Math.min(1.8 * fk, two ? rowH * 0.36 : rowH * 0.48, colW / 7.4);
  const tiny = Math.max(1.5, Math.min(1.45 * fk, fs * 0.82));
  // column heads: the Betas
  M.betas.forEach((b, j) => {
    const x = fr.x0 + labelW + j * colW;
    svg.text(x + 0.7, top + headH - 1.1, b.name, { size: SIZE.tiny * fk, fill: pal.level(1), weight: b.current ? 600 : 400, maxW: colW - 1 });
  });
  svg.text(fr.x0, top + headH - 1.1, 'GAMMA', { size: SIZE.tiny * 0.95, fill: pal.ink3, ls: 0.12, maxW: labelW - 0.6 });
  const y0 = top + headH;
  svg.line(fr.x0, y0, fr.x1, y0, pal.ruleStrong, 0.2);
  const rules = [];
  for (let g = 0; g < 13; g++) {
    const yy = y0 + g * rowH;
    svg.text(fr.x0, yy + rowH * 0.5 + labelSize * 0.36, word(M.gammas[0][g]), { size: labelSize, fill: pal.level(2), maxW: labelW - 0.8 });
    for (let j = 0; j < 5; j++) {
      const c = M.gammas[j][g];
      const x = fr.x0 + labelW + j * colW;
      if (c.t0 === null) svg.rect(x, yy, colW, rowH, { fill: pal.shade });
      if (c.eclipse) svg.rect(x + 0.25, yy + 0.25, colW - 0.5, rowH - 0.5, { fill: pal.eclipseSoft, rx: 0.5 });
      if (c.current) svg.rect(x + 0.2, yy + 0.2, colW - 0.4, rowH - 0.4, { stroke: pal.level(2), sw: 0.35, rx: 0.5 });
      const txt = c.t0 === null ? '—' : pureMode ? posText(c.t0, 3) : dateText(c.t0);
      const marks = [];
      if (c.eclipse) marks.push({ text: `● #${c.eclipse.k} ${QUARTER_WORD[c.eclipse.event] ?? (c.eclipse.event === 'begin' ? 'Begins' : c.eclipse.event)}`, fill: pal.eclipse, weight: 600 });
      if (c.current) marks.push({ text: '▸ this diary', fill: pal.level(3), weight: 600 });
      const strong = c.current || !!c.eclipse;
      if (two || !marks.length) {
        const base = marks.length ? yy + fs + 0.7 : yy + rowH * 0.5 + fs * 0.36;
        svg.text(x + 0.8, base, txt, { size: fs, fill: c.t0 === null ? pal.ink4 : pal.ink, weight: strong ? 600 : 400, maxW: colW - 1.4 });
        if (marks.length) svg.runs(x + 0.8, yy + rowH - 0.75, marks.map((m) => ({ size: tiny, gap: 0.8, ...m })), { maxW: colW - 1.4, minScale: 0.8 });
      } else {
        // one line: the mark goes before the date
        svg.runs(x + 0.8, yy + rowH * 0.5 + fs * 0.36, [{ text: marks.map((m) => m.text[0]).join(''), size: fs, fill: marks[0].fill, weight: 600 }, { text: txt, size: fs, fill: pal.ink, weight: 600, gap: 0.6 }], { maxW: colW - 1.4, minScale: 0.8 });
      }
    }
    rules.push(`M${n2(fr.x0)} ${n2(yy + rowH)}H${n2(fr.x1)}`);
  }
  for (let j = 0; j <= 5; j++) {
    const x = fr.x0 + labelW + j * colW;
    rules.push(`M${n2(x)} ${n2(y0)}V${n2(y0 + 13 * rowH)}`);
  }
  svg.path(rules.join(''), { stroke: pal.ruleSoft, sw: 0.14 });
  return y0 + 13 * rowH;
}
