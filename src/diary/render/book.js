/**
 * Book pages: the Nuclide header (a verso facing the Nuclide's first Helion page), the Delta insert (a Delta quarter
 * threshold), the retrospection / summary of the Delta, and notes.
 */
import { SIZE } from './common.js';
import { drawTable, writingLines, lineGap, blockHead } from './table.js';
import { QUARTER_GLYPH, QUARTER_WORD, majorWords } from './words.js';
import { nuclidePages } from './front.js';
import { helionPlace } from '../../ui/pentad.js';
import { markedRuns } from './pentad.js';

const NEXT = { peak: 'node', node: 'valley', valley: 'end' };

// ---- Nuclide header -------------------------------------------------------------------------------------------

export function renderNuclide(svg, cx, fr, page) {
  const { plan, pal } = cx;
  const D = plan.delta;
  const nu = plan.nuclides[page.n];
  const big = Math.min(16, fr.ch * 0.085);
  const yb = fr.y0 + big * 0.78;
  const w = svg.text(fr.x0, yb, nu.name, { size: big, weight: 600, fill: pal.level(4) }).width;
  const tx = fr.x0 + w + 4;
  const tw = fr.x1 - tx;
  svg.text(tx, fr.y0 + 4.6, `Nuclide ${nu.n + 1} of ${D.name}`, { size: 3, weight: 600, fill: pal.ink, maxW: tw });
  svg.text(tx, fr.y0 + 8.6, `${D.stamp} ${nu.name} · 77 Helions · 1η–77η`, { size: 1.9, fill: pal.ink3, maxW: tw });
  const next = nu.n < 4 ? `ε#${nu.n + 2}` : cx.nextDelta();
  const begins = [{ text: 'Begins', fill: pal.ink3 }, { text: cx.fShort(nu.t0), fill: pal.ink, gap: 1.2 }];
  if (cx.greg) begins.push({ text: cx.gLong(nu.t0), fill: pal.ink2, gap: 1.4 });
  const ends = [{ text: 'Ends', fill: pal.ink3 }];
  if (next) ends.push({ text: `→ ${next} begins`, fill: pal.level(4), gap: 1.2 });
  if (cx.greg) ends.push({ text: cx.gLong(nu.t1), fill: pal.ink2, gap: 1.4 });
  svg.runs(tx, fr.y0 + 12.4, begins.map((r) => ({ size: 1.9, ...r })), { maxW: tw, minScale: 0.75 });
  svg.runs(tx, fr.y0 + 15.8, ends.map((r) => ({ size: 1.9, ...r })), { maxW: tw, minScale: 0.75 });

  let y = Math.max(fr.y0 + 19, yb + 4);
  // locks, the retro Helions and the Delta sheets of this Nuclide
  // where each lock begins in the Sun's rhythm: the Pentad of its first Helion and that Helion's place in it (the locks
  // count from the Nuclide, the Pentads from the solar sync)
  const placeCell = (p) => (p ? { text: helionPlace(p.helion), fill: pal.ink2, pentad: p.index } : '');
  const startsIn = (d) => placeCell(cx.pentadOfHelion(plan.helions[d]));
  const rows = nu.locks.map((l) => ({
    cells: {
      label: { text: `Lock ${l.k + 1}`, weight: 600 },
      hel: cx.helionRange(l.helions),
      pentad: startsIn(l.helions[0]),
      greg: cx.greg ? cx.gRange(l.t0, l.t1) : '',
      page: { text: String(l.firstPage), weight: 600 },
    },
  }));
  if (nu.retro.length) {
    const h0 = plan.helions[nu.retro[0]];
    const h1 = plan.helions[nu.retro.at(-1)];
    rows.push({ cells: { label: { text: 'Retrospection', weight: 600, fill: pal.ink2 }, hel: cx.helionRange(nu.retro), pentad: startsIn(nu.retro[0]), greg: cx.greg ? cx.gRange(h0.t0, h1.t1) : '', page: { text: String(nu.retroPage), weight: 600 } } });
  }
  for (const ins of plan.inserts.filter((i) => i.nuclide === nu.n)) {
    rows.push({ cells: { label: { text: `Delta sheet · ${majorWords(ins.major)}`, fill: pal.level(3) }, hel: cx.fClock(ins.major.t, 'iota'), pentad: placeCell(cx.pentadAt(ins.major.t)), greg: cx.greg ? cx.gDayTime(ins.major.t) : '', page: { text: String(ins.page), weight: 600 } } });
  }
  rows.sort((a, b) => Number(a.cells.page.text) - Number(b.cells.page.text));
  y = drawTable(svg, cx, {
    x0: fr.x0,
    x1: fr.x1,
    y,
    rowH: 4.6,
    size: 2,
    cols: [{ key: 'label', flex: true }, { key: 'hel' }, { key: 'pentad' }, ...(cx.greg ? [{ key: 'greg' }] : []), { key: 'page', align: 'end', min: 5 }],
    rows,
    header: { label: 'Locks', hel: 'Helions', pentad: 'Begins in', greg: 'Gregorian', page: 'Page' },
  });

  // the events of the Nuclide, as many as leave room for at least four intention lines
  const gap = lineGap(fr);
  const evs = plan.events.filter((e) => e.d !== undefined && plan.helions[e.d].n === nu.n);
  const rowH = 3.9;
  const intentions = 4 * gap + 7;
  const space = fr.y1 - y - 4 - 4 - intentions;
  const fitRows = Math.max(0, Math.floor(space / rowH));
  const shown = evs.length > fitRows ? evs.slice(0, Math.max(0, fitRows - 1)) : evs;
  if (evs.length) {
    const trs = shown.map((e) => ({
      cells: {
        sym: { text: cx.eventSymbol(e), fill: cx.familyColor(e) },
        label: { text: cx.eventName(e) + (e.family === 'sync' && cx.driftText(e) ? ` · drift ${cx.driftText(e)}` : ''), fill: e.family === 'major' ? cx.familyColor(e) : pal.ink },
        clock: { text: cx.fClock(e.t), fill: pal.ink2, pentad: cx.pentadAt(e.t)?.index },
        greg: cx.greg ? { text: cx.gDayTime(e.t), fill: pal.ink2 } : '',
        page: { text: e.page ? String(e.page) : '—', weight: 600 },
      },
    }));
    if (shown.length < evs.length) {
      const eph = plan.sections.find((s) => s.key === 'ephemeris');
      trs.push({ cells: { label: { text: `${evs.length - shown.length} more${eph ? ` in the ephemeris, page ${eph.page}` : ''}`, fill: pal.ink3 } } });
    }
    y = drawTable(svg, cx, {
      x0: fr.x0,
      x1: fr.x1,
      y: y + 4,
      rowH,
      size: 1.8,
      gap: 2,
      cols: [{ key: 'sym', min: 2.4 }, { key: 'label', flex: true }, { key: 'clock' }, ...(cx.greg ? [{ key: 'greg' }] : []), { key: 'page', align: 'end', min: 5 }],
      rows: trs,
      header: { label: 'Events', clock: 'Fractonica', greg: 'Gregorian', page: 'Page' },
    });
  }
  const yr = blockHead(svg, cx, fr, y + 4, [{ text: 'Intentions', fill: pal.ink, weight: 600 }, { text: `for ${nu.name}`, fill: pal.ink3, size: 1.9, gap: 1.4 }], { size: 2.2 });
  writingLines(svg, cx, fr.x0, fr.x1, yr, fr.y1, gap);
}

// ---- Delta insert --------------------------------------------------------------------------------------------------

export function renderInsert(svg, cx, fr, page) {
  const { plan, pal } = cx;
  const D = plan.delta;
  const m = page.major;
  const col = pal.level(m.level);
  svg.text(fr.x0, fr.y0 + 2.4, 'DELTA SHEET', { size: 1.9, fill: pal.ink3, ls: 0.5 });
  const nextQ = NEXT[m.event];
  svg.text(fr.x0, fr.y0 + 10, m.name, { size: 6.4, weight: 600, fill: col, maxW: fr.cw });
  svg.text(fr.x0, fr.y0 + 16, `${m.quarter} ends → ${QUARTER_WORD[nextQ] ?? ''}`.trim(), { size: 4.2, weight: 600, fill: pal.ink, maxW: fr.cw });
  svg.text(fr.x0, fr.y0 + 21, `The ${m.quarter} quarter of ${m.name} ends and the ${QUARTER_WORD[nextQ]} quarter begins.`, { size: 2.2, fill: pal.ink2, maxW: fr.cw });
  let y = fr.y0 + 25.4;
  const when = [
    [cx.fWords(m.t, 'lambda'), pal.ink],
    [cx.fStamp(m.t, 'lambda'), pal.ink2],
  ];
  if (cx.greg) when.push([cx.gLong(m.t), pal.ink2]);
  // the moment in words, led by its Pentad (SPEC §7.5) like a date by its weekday
  const pe = cx.pentadAt(m.t);
  when.forEach(([t, c], i) => {
    const mark = i === 0 && pe ? { index: pe.index, fs: 2.1, color: cx.solar, text: 'name' } : null;
    markedRuns(svg, fr.x0 + 2, y, [{ text: t, size: 2.1, fill: c }], { maxW: fr.cw - 2 }, mark);
    y += 3.4;
  });
  svg.line(fr.x0 + 0.3, fr.y0 + 23.3, fr.x0 + 0.3, y - 2.3, col, 0.45);

  // the four quarters of the Delta, the threshold marked
  y += 6;
  const X = (t) => fr.x0 + ((t - D.t0) / (D.t1 - D.t0)) * fr.cw;
  const qs = plan.majors.filter((x) => x.level === 3 && ['peak', 'node', 'valley'].includes(x.event));
  const bounds = [D.t0, ...qs.map((x) => x.t), D.t1];
  const barH = 6.4;
  const at = m.level === 3 ? m.t : null;
  ['peak', 'node', 'valley', 'end'].forEach((q, i) => {
    if (bounds[i + 1] === undefined) return;
    const a = X(bounds[i]);
    const b = X(bounds[i + 1]);
    const done = at !== null && bounds[i + 1] <= at + 1e-6;
    const current = at !== null && Math.abs(bounds[i] - at) < 1e-6;
    svg.rect(a, y, b - a, barH, { fill: done ? pal.levelSoft(3) : '#ffffff', stroke: current ? col : pal.ruleStrong, sw: current ? 0.5 : 0.2 });
    svg.text((a + b) / 2, y + barH / 2 + 0.75, QUARTER_WORD[q], { size: 2.1, weight: current ? 600 : 400, fill: current ? col : done ? pal.ink2 : pal.ink3, anchor: 'middle', maxW: b - a - 2 });
    const tEnd = bounds[i + 1];
    svg.text(b - 0.5, y + barH + 2.8, cx.greg ? cx.gDay(tEnd) : cx.fShort(tEnd, 'eta'), { size: 1.6, fill: pal.ink3, anchor: 'end', maxW: b - a - 1 });
  });
  if (at !== null) {
    const x = X(at);
    svg.glyph(QUARTER_GLYPH[m.event], x, y - 3, 3.4, col, 0.24);
    svg.line(x, y - 0.6, x, y + barH + 0.6, col, 0.5);
  }
  y += barH + 7;

  // the thresholds still to come in this Delta
  const rest = plan.majors.filter((x) => x.event !== 'begin' && x.t >= m.t - 1e-6 && x.t < D.t1);
  const rows = rest.map((x) => ({
    cells: {
      label: { text: majorWords(x), fill: pal.level(x.level), weight: x === m || (x.t === m.t && x.level === m.level) ? 600 : 400 },
      frac: { text: cx.fShort(x.t), fill: pal.ink2 },
      greg: cx.greg ? { text: cx.gDayTime(x.t), fill: pal.ink2 } : '',
      page: { text: String(plan.pageOf(x.t) ?? '—'), weight: 600 },
    },
  }));
  const next = cx.nextDelta();
  rows.push({ cells: { label: { text: next ? `${D.name} ends → ${next} begins` : `${D.name} ends`, fill: pal.level(3) }, frac: { text: cx.fShort(D.t1), fill: pal.ink2 }, greg: cx.greg ? { text: cx.gDayTime(D.t1), fill: pal.ink2 } : '', page: { text: '—', fill: pal.ink4 } } });
  const maxRows = Math.max(2, Math.floor((fr.y1 - y - 30) / 4.4));
  y = drawTable(svg, cx, {
    x0: fr.x0,
    x1: fr.x1,
    y,
    rowH: 4.4,
    size: 1.95,
    cols: [{ key: 'label', flex: true }, { key: 'frac' }, ...(cx.greg ? [{ key: 'greg' }] : []), { key: 'page', align: 'end', min: 5 }],
    rows: rows.slice(0, maxRows),
    header: { label: 'Thresholds to come', frac: 'Fractonica', greg: 'Gregorian', page: 'Page' },
  });

  // review lines: looking back on the quarter that ends, ahead to the one that begins
  const gap = lineGap(fr);
  const half = (fr.y1 - y - 4) / 2;
  let yy = y + 4;
  for (const [a, b] of [
    ['Looking back', `the ${m.quarter} quarter`],
    ['Looking ahead', `the ${QUARTER_WORD[nextQ]} quarter`],
  ]) {
    const yr = blockHead(svg, cx, fr, yy, [{ text: a, weight: 600, fill: pal.ink }, { text: b, fill: col, size: 1.9, gap: 1.4 }], { size: 2.2 });
    writingLines(svg, cx, fr.x0, fr.x1, yr, yy + half - 1, gap);
    yy += half;
  }
}

// ---- summary ----------------------------------------------------------------------------------------------------

function nuclideBlocks(cx) {
  const { plan, pal } = cx;
  return plan.nuclides.map((nu) => {
    const [p0, p1] = nuclidePages(plan, nu);
    return [
      { text: nu.name, weight: 600, fill: pal.level(4) },
      { text: '1η–77η', fill: pal.ink2, size: 1.9, gap: 1.4 },
      { text: cx.greg ? cx.gDays(nu.t0, nu.t1) : '', fill: pal.ink2, size: 1.9, gap: 1.4 },
      { text: `pages ${p0}–${p1}`, fill: pal.ink3, size: 1.9, gap: 1.4 },
    ];
  });
}
function quarterBlocks(cx) {
  const { plan, pal } = cx;
  const D = plan.delta;
  const qs = plan.majors.filter((m) => m.level === 3 && ['peak', 'node', 'valley'].includes(m.event));
  const bounds = [D.t0, ...qs.map((m) => m.t), D.t1];
  const out = [];
  ['peak', 'node', 'valley', 'end'].forEach((q, i) => {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (b === undefined) return;
    out.push([
      { text: `${QUARTER_WORD[q]} quarter`, weight: 600, fill: pal.level(3) },
      { text: `${cx.fShort(a)} – ${q === 'end' ? `${cx.fShort(b - 1, 'eta')}` : cx.fShort(b)}`, fill: pal.ink2, size: 1.9, gap: 1.4 },
      { text: cx.greg ? cx.gDays(a, b) : '', fill: pal.ink3, size: 1.9, gap: 1.4 },
    ]);
  });
  return out;
}

export function renderSummary(svg, cx, fr, page) {
  const { plan, pal } = cx;
  const D = plan.delta;
  let y;
  if (page.part === 1) {
    svg.text(fr.x0, fr.y0 + 5, 'Retrospection', { size: 5, weight: 600, fill: pal.ink });
    svg.text(fr.x0, fr.y0 + 9.4, [D.name, D.stamp, cx.greg ? cx.gDays(D.t0, D.t1, { year: true }) : null].filter(Boolean).join(' · '), { size: 1.9, fill: pal.ink3, maxW: fr.cw });
    y = fr.y0 + 12;
  } else {
    svg.runs(fr.x0, fr.y0 + 4.4, [{ text: 'Retrospection', size: 3.6, weight: 600, fill: pal.ink }, { text: `${page.part}/${page.of}`, size: SIZE.small, fill: pal.ink3, gap: 2 }], { maxW: fr.cw });
    y = fr.y0 + 7;
  }
  let blocks;
  if (page.of === 1) blocks = [...nuclideBlocks(cx), ...quarterBlocks(cx)];
  else if (page.part === 1) blocks = nuclideBlocks(cx);
  else if (page.part === 2) blocks = quarterBlocks(cx);
  else blocks = null;
  const gap = lineGap(fr);
  if (!blocks) {
    const yr = blockHead(svg, cx, fr, y, [{ text: `${D.name}`, weight: 600, fill: pal.level(3) }, { text: 'what it was, what it taught', fill: pal.ink3, size: 1.9, gap: 1.4 }], { size: 2.2 });
    writingLines(svg, cx, fr.x0, fr.x1, yr, fr.y1, gap);
    return;
  }
  const each = (fr.y1 - y) / blocks.length;
  for (const runs of blocks) {
    const yr = blockHead(svg, cx, fr, y, runs, { size: 2.2 });
    writingLines(svg, cx, fr.x0, fr.x1, yr, y + each - 1, Math.min(gap, Math.max(4.2, (y + each - 1 - yr) / 2)));
    y += each;
  }
}

// ---- notes ------------------------------------------------------------------------------------------------------

export function renderNotes(svg, cx, fr) {
  writingLines(svg, cx, fr.x0, fr.x1, fr.y0, fr.y1, lineGap(fr));
}

