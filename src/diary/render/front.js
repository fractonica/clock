/**
 * Front matter: cover · index · Gregorian index · ephemeris · planning · predictions.
 *
 * The planner splits the index and the ephemeris by `rowsPerPage(opts)` (a 22 mm header and 5.4 mm rows): every page
 * keeps its title block inside those 22 mm, and the rows take at most 5.4 mm each (less when a page carries more).
 */
import { SIZE, wrap, n2 } from './common.js';
import { drawTable, writingLines, lineGap, blockHead, paragraph } from './table.js';
import { QUARTER_GLYPH, QUARTER_WORD, majorWords, eventSymbolOf } from './words.js';
import { monthsPerPage } from '../options.js';
import { daysInMonth } from '../../core/format.js';

const HEADER = 22;
const ROW = 5.4;

// ---- shared bits ----------------------------------------------------------------------------------------------

function title(svg, cx, fr, text, sub, { size = 5.2, color } = {}) {
  svg.text(fr.x0, fr.y0 + size * 0.86, text, { size, weight: 600, fill: color ?? cx.pal.ink, maxW: fr.cw });
  if (sub) svg.text(fr.x0, fr.y0 + size * 0.86 + 4.4, sub, { size: SIZE.small, fill: cx.pal.ink3, maxW: fr.cw });
}

/** Pages a Nuclide spans: its header to the last page of its Helions. */
export function nuclidePages(plan, nu) {
  let last = nu.headerPage;
  for (let d = nu.n * 77; d < nu.n * 77 + 77; d++) for (const p of plan.helions[d].pages ?? []) last = Math.max(last, p);
  return [nu.headerPage, last];
}

/** "Begins …" / "Ends …" runs of a span (Fractonica, and Gregorian when on). */
function spanRuns(cx, t, which, { next } = {}) {
  const { pal } = cx;
  const runs = [{ text: which, fill: pal.ink3 }];
  if (which === 'Ends' && next) runs.push({ text: `→ ${next} begins`, fill: pal.level(3) });
  runs.push({ text: cx.fStamp(t), fill: pal.ink, gap: 1.4 });
  if (cx.greg) runs.push({ text: cx.gLong(t), fill: pal.ink2, gap: 1.6 });
  return runs;
}

// ---- cover ------------------------------------------------------------------------------------------------------

/**
 * The Delta drawn in the library's harmonic wave geometry (the app's Wave view, `clock.arc`): its crest and trough
 * half-arcs, the Nuclides' half-arcs nested on them as epicycles and the ζ half-arcs faintly. The figure is turned so
 * that the Delta runs left to right with its crest up, and fitted into `box`. Every arc is a true circle. Returns the
 * map from library to page coordinates and the two Delta half-arcs.
 */
function deltaWave(svg, cx, box) {
  const { pal, plan } = cx;
  const clock = cx.env.model.clock;
  const d = plan.delta.idx;
  const get = (L, i) => {
    try {
      return clock.arc(L, BigInt(i));
    } catch {
      return null;
    }
  };
  const crest = get(3, 2 * d);
  const trough = get(3, 2 * d + 1);
  if (!crest || !trough) return null;
  const nus = Array.from({ length: 10 }, (_, i) => get(4, 10 * d + i)).filter(Boolean);
  const zetas = Array.from({ length: 70 }, (_, i) => get(5, 70 * d + i)).filter(Boolean);
  const P = (a, t) => ({ x: a.center.x + a.radius * Math.cos(a.start + a.sweep * t), y: a.center.y + a.radius * Math.sin(a.start + a.sweep * t) });
  const p0 = P(crest, 0);
  const p2 = P(trough, 1);
  const th = Math.atan2(p2.y - p0.y, p2.x - p0.x);
  const c = Math.cos(-th);
  const sn = Math.sin(-th);
  const rot = (p) => ({ x: (p.x - p0.x) * c - (p.y - p0.y) * sn, y: (p.x - p0.x) * sn + (p.y - p0.y) * c });
  const flip = rot(P(crest, 0.5)).y > 0 ? -1 : 1; // the crest goes up (y points down)
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const a of [crest, trough, ...nus, ...zetas]) {
    for (let i = 0; i <= 24; i++) {
      const q = rot(P(a, i / 24));
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y * flip);
      y1 = Math.max(y1, q.y * flip);
    }
  }
  const k = Math.min(box.w / (x1 - x0), box.h / (y1 - y0));
  const ox = box.x + (box.w - (x1 - x0) * k) / 2 - x0 * k;
  const oy = box.y + (box.h - (y1 - y0) * k) / 2 - y0 * k;
  const map = (p) => {
    const q = rot(p);
    return { x: ox + q.x * k, y: oy + q.y * flip * k };
  };
  const arcPath = (list) =>
    list
      .map((a) => {
        const s0 = map(P(a, 0));
        const s1 = map(P(a, 1));
        const R = n2(a.radius * k);
        const large = Math.abs(a.sweep) > Math.PI ? 1 : 0;
        const sweep = a.sweep > 0 === flip > 0 ? 1 : 0;
        return `M${n2(s0.x)} ${n2(s0.y)}A${R} ${R} 0 ${large} ${sweep} ${n2(s1.x)} ${n2(s1.y)}`;
      })
      .join('');
  const base = map(p0);
  const end = map(p2);
  svg.line(base.x, base.y, end.x, end.y, pal.ruleSoft, 0.2);
  if (zetas.length) svg.path(arcPath(zetas), { stroke: pal.rule, sw: 0.16 });
  if (nus.length) svg.path(arcPath(nus), { stroke: pal.levelMid(4), sw: 0.3 });
  svg.path(arcPath([crest, trough]), { stroke: pal.level(3), sw: 0.5 });
  return { map, P, crest, trough, k };
}

export function renderCover(svg, cx, fr) {
  const { plan, pal } = cx;
  const D = plan.delta;
  const mid = (fr.x0 + fr.x1) / 2;
  const s = Math.min(1.25, Math.max(0.65, Math.min(fr.cw / 116, fr.ch / 186)));
  let y = fr.y0 + fr.ch * 0.07;
  svg.text(mid, y, 'FRACTONICA', { size: 2.4 * s, fill: pal.ink3, anchor: 'middle', ls: 0.9 * s, maxW: fr.cw });
  y += 13 * s;
  svg.text(mid, y, D.name, { size: 11 * s, weight: 600, fill: pal.level(3), anchor: 'middle', maxW: fr.cw });
  y += 7 * s;
  svg.text(mid, y, D.stamp, { size: 2.6 * s, fill: pal.ink3, anchor: 'middle', ls: 0.2 * s, maxW: fr.cw });

  // the phases of Alpha, Beta and Gamma at the Delta's start: three big glyphs with their names
  const t = D.t0 + 0.01;
  const gh = 14 * s;
  const gy = fr.y0 + fr.ch * 0.31;
  [0, 1, 2].forEach((L) => {
    const l = cx.env.model.levelAt(t, L);
    if (!l) return;
    const x = fr.x0 + (fr.cw * (L + 0.5)) / 3;
    svg.glyph(l.index, x, gy, gh, pal.level(L), 0.55 * s);
    svg.text(x, gy + gh / 2 + 4.2 * s, D.words[L], { size: 2.3 * s, fill: pal.ink2, anchor: 'middle', maxW: fr.cw / 3 - 2 });
  });

  // the Delta in the wave geometry, with the glyphs of its thresholds on the wave (0 begin, 4 peak, 8 node, 12 valley, 0 end)
  const box = { x: fr.x0 + fr.cw * 0.02, y: fr.y0 + fr.ch * 0.43, w: fr.cw * 0.96, h: fr.ch * 0.37 };
  const w = deltaWave(svg, cx, box);
  if (w) {
    const g = 6.2 * s;
    const marks = [
      [0, w.P(w.crest, 0)],
      [4, w.P(w.crest, 0.5)],
      [8, w.P(w.crest, 1)],
      [12, w.P(w.trough, 0.5)],
      [0, w.P(w.trough, 1)],
    ];
    for (const [index, p] of marks) {
      const q = w.map(p);
      const gw = g * 0.56;
      svg.rect(q.x - gw / 2, q.y - g / 2, gw, g, { fill: '#ffffff' });
      svg.glyph(index, q.x, q.y, g, pal.level(3), 0.36 * s);
    }
  }

  y = fr.y0 + fr.ch * 0.88;
  if (cx.greg) {
    svg.text(mid, y, `${cx.gDay(D.t0, { year: true })} – ${cx.gDay(D.t1, { year: true })}`, { size: 3 * s, fill: pal.ink, anchor: 'middle', maxW: fr.cw });
    y += 5.2 * s;
    svg.text(mid, y, `${cx.gTime(D.t0)} – ${cx.gTime(D.t1)}`, { size: 2.2 * s, fill: pal.ink3, anchor: 'middle', maxW: fr.cw });
    y += 5.2 * s;
  }
  svg.text(mid, y, `5 Nuclides · 385 Helions · ${plan.pages.length} pages`, { size: 2.2 * s, fill: pal.ink3, anchor: 'middle', maxW: fr.cw });
}

// ---- index --------------------------------------------------------------------------------------------------------

function indexLabel(cx, r) {
  const { plan, pal } = cx;
  const D = plan.delta;
  switch (r.kind) {
    case 'delta-begin':
      return { text: `${D.name} begins`, fill: pal.level(3), weight: 600 };
    case 'delta-end': {
      const next = cx.nextDelta();
      return { text: next ? `${D.name} ends → ${next} begins` : `${D.name} ends`, fill: pal.level(3), weight: 600 };
    }
    case 'major':
      return { text: majorWords(r.major), fill: pal.level(r.major.level), weight: r.major.level === 3 ? 600 : 400 };
    case 'nuclide':
      return { text: `Nuclide ε#${r.nuclide + 1} begins`, fill: pal.level(4), weight: 600 };
    case 'lock':
      return { text: `ε#${r.nuclide + 1} lock ${r.lock + 1} · ${r.helions[0]}η–${r.helions[1]}η`, fill: pal.ink };
    case 'retro': {
      const hs = r.helions;
      return { text: `ε#${r.nuclide + 1} retrospection · ${hs.length > 1 ? `${hs[0]}η–${hs.at(-1)}η` : `${hs[0]}η`}`, fill: pal.ink2 };
    }
    case 'insert':
      return { text: `Delta sheet · ${majorWords(r.major)}`, fill: pal.level(3) };
    case 'eclipse': {
      const s = r.eclipse?.saros;
      return { text: `${r.label}${s ? ` · Saros ${s.saros} (${s.member}/${s.count})` : ''}`, fill: pal.eclipse, weight: 600 };
    }
    case 'section':
      return { text: r.label, fill: pal.ink, weight: 600 };
    default:
      return { text: r.label ?? r.kind, fill: pal.ink };
  }
}
const GROUP = { 'delta-begin': 'delta', major: 'delta', 'delta-end': 'delta', nuclide: 'nu', lock: 'nu', retro: 'nu', insert: 'insert', eclipse: 'insert', section: 'section' };

export function renderIndex(svg, cx, fr, page) {
  const { plan, pal } = cx;
  const D = plan.delta;
  if (page.part === 1) {
    svg.text(fr.x0, fr.y0 + 5.4, D.name, { size: 6, weight: 600, fill: pal.level(3), maxW: fr.cw });
    svg.text(fr.x0, fr.y0 + 9.9, D.words.join(' · '), { size: 2, fill: pal.ink2, maxW: fr.cw });
    svg.runs(fr.x0, fr.y0 + 13.5, spanRuns(cx, D.t0, 'Begins').map((r) => ({ size: 1.9, ...r })), { maxW: fr.cw, minScale: 0.72 });
    svg.runs(fr.x0, fr.y0 + 16.9, spanRuns(cx, D.t1, 'Ends', { next: cx.nextDelta() }).map((r) => ({ size: 1.9, ...r })), { maxW: fr.cw, minScale: 0.72 });
  } else {
    svg.runs(fr.x0, fr.y0 + 5.4, [
      { text: 'Index', size: 4.4, weight: 600, fill: pal.ink },
      { text: `${D.name} · continued`, size: SIZE.small, fill: pal.ink3, gap: 2 },
    ], { maxW: fr.cw });
  }
  const rows = page.rows ?? [];
  const yTable = fr.y0 + HEADER - 4;
  const avail = fr.y1 - (yTable + 4);
  const rowH = Math.min(ROW, avail / Math.max(1, rows.length));
  let prev = null;
  const trs = rows.map((r) => {
    const g = GROUP[r.kind];
    const strong = prev !== null && (g !== prev || r.kind === 'nuclide');
    prev = g;
    const timed = r.kind !== 'section' && r.t !== undefined && r.t !== null;
    return {
      rule: strong ? 'strong' : undefined,
      cells: {
        label: indexLabel(cx, r),
        frac: timed ? { text: cx.fShort(r.t), fill: pal.ink2 } : '',
        greg: timed && cx.greg ? { text: cx.gDayTime(r.t), fill: pal.ink2 } : '',
        page: { text: r.page ? String(r.page) : '—', weight: 600, fill: r.page ? pal.ink : pal.ink4 },
      },
    };
  });
  const cols = [
    { key: 'label', flex: true },
    { key: 'frac' },
    ...(cx.greg ? [{ key: 'greg' }] : []),
    { key: 'page', align: 'end', min: 5 },
  ];
  drawTable(svg, cx, {
    x0: fr.x0,
    x1: fr.x1,
    y: yTable,
    rowH,
    size: Math.min(2.1, rowH * 0.42),
    cols,
    rows: trs,
    header: { label: 'Entry', frac: 'Fractonica', greg: 'Gregorian', page: 'Page' },
  });
}

// ---- Gregorian index --------------------------------------------------------------------------------------------

export function renderGregorian(svg, cx, fr, page) {
  const { plan, pal, opts } = cx;
  const D = plan.delta;
  if (!cx.greg) return;
  svg.runs(fr.x0, fr.y0 + 4.6, [
    { text: 'Gregorian index', size: 4.4, weight: 600, fill: pal.ink },
    { text: page.of > 1 ? `${page.part}/${page.of}` : '', size: SIZE.small, fill: pal.ink3, gap: 2 },
  ], { maxW: fr.cw });
  svg.text(fr.x0, fr.y0 + 9, `Each day of ${D.name} and the page of the Helion holding its start`, { size: 1.8, fill: pal.ink3, maxW: fr.cw });
  const byDay = new Map(plan.days.map((d) => [`${d.y}-${d.m}-${d.d}`, d]));
  const per = monthsPerPage(opts);
  const top = fr.y0 + 12;
  const gap = 4;
  const bh = (fr.y1 - top - gap * (per - 1)) / per;
  page.months.forEach((mo, i) => monthGrid(svg, cx, fr, mo, top + i * (bh + gap), bh, byDay));
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthGrid(svg, cx, fr, { y: year, m }, top, height, byDay) {
  const { plan, pal } = cx;
  const D = plan.delta;
  const first = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const nd = daysInMonth(year, m);
  const weeks = 6;
  const cw = fr.cw / 7;
  const titleH = 5.6;
  const headH = 3.6;
  const ch = (height - titleH - headH) / weeks;
  svg.text(fr.x0, top + 3.6, `${cx.monthName(m)} ${year}`, { size: 3.2, weight: 600, fill: pal.ink });
  const inMonth = plan.days.filter((d) => d.y === year && d.m === m && d.page);
  if (inMonth.length) {
    const p0 = inMonth[0].page;
    const p1 = inMonth.at(-1).page;
    svg.text(fr.x1, top + 3.6, p0 === p1 ? `page ${p0}` : `pages ${p0}–${p1}`, { size: 1.9, fill: pal.ink3, anchor: 'end' });
  }
  const gy = top + titleH;
  WEEK.forEach((w, c) => svg.text(fr.x0 + c * cw + 0.8, gy + 2.5, w, { size: 1.7, fill: c >= 5 ? pal.ink2 : pal.ink3, maxW: cw - 1 }));
  const y0 = gy + headH;
  // shading of the days outside the Delta, then the grid
  const dayFs = Math.min(2.5, ch * 0.32);
  const smallFs = Math.min(1.55, ch * 0.2);
  let prevNu = null;
  for (let d = 1; d <= nd; d++) {
    const idx = first + d - 1;
    const r = Math.floor(idx / 7);
    const c = idx % 7;
    const x = fr.x0 + c * cw;
    const y = y0 + r * ch;
    const day = byDay.get(`${year}-${m}-${d}`);
    const inside = !!(day && day.t1 > D.t0 && day.t0 < D.t1);
    if (!inside) svg.rect(x, y, cw, ch, { fill: pal.shade });
    svg.text(x + 0.9, y + dayFs + 0.5, String(d), { size: dayFs, fill: inside ? pal.ink : pal.ink4, weight: inside ? 600 : 400 });
    if (!inside) continue;
    const t = Math.max(day.t0, D.t0);
    const h = plan.helionAt(t);
    if (day.page) svg.text(x + cw - 0.8, y + ch - 1, String(day.page), { size: Math.min(2.4, ch * 0.3), fill: pal.level(6), weight: 600, anchor: 'end' });
    if (h) svg.text(x + 0.9, y + ch - 1.1, h.label, { size: smallFs, fill: pal.ink3, maxW: cw * 0.5 });
    // a Nuclide that begins on this day, and Delta quarter thresholds
    const nu = plan.nuclides.find((n) => n.t0 >= day.t0 && n.t0 < day.t1);
    const marks = [];
    if (plan.majors.some((mj) => mj.level === 3 && ['peak', 'node', 'valley'].includes(mj.event) && mj.t >= day.t0 && mj.t < day.t1)) marks.push({ text: '◆', fill: pal.level(3) });
    if (nu && nu.n !== prevNu) marks.push({ text: nu.name, fill: pal.level(4), weight: 600 });
    if (nu) prevNu = nu.n;
    if (marks.length) svg.runs(x + cw - 0.8, y + smallFs + 0.7, marks.map((mk) => ({ size: smallFs, gap: 0.6, ...mk })), { anchor: 'end', maxW: cw - dayFs * 1.6 - 1.5 });
  }
  const dd = [];
  for (let r = 0; r <= weeks; r++) dd.push(`M${n2(fr.x0)} ${n2(y0 + r * ch)}H${n2(fr.x1)}`);
  for (let c = 0; c <= 7; c++) dd.push(`M${n2(fr.x0 + c * cw)} ${n2(y0)}V${n2(y0 + weeks * ch)}`);
  svg.path(dd.join(''), { stroke: pal.rule, sw: 0.15 });
}

// ---- ephemeris -----------------------------------------------------------------------------------------------------

const MEAN_DAYS = { synodic: 29.530589, anomalistic: 27.55455, draconic: 27.212221, sidereal: 27.321662, tropical: 27.321582 };

function legendEntries(cx) {
  const { plan, opts, pureMode, pure } = cx;
  const ev = opts.events;
  const sym = (name, fallback) => plan.events.find((e) => e.name === name)?.symbol || eventSymbolOf(name) || fallback;
  const len = (f) => (pureMode ? pure.duration(MEAN_DAYS[f] * 86400, { at: plan.delta.t0 }) : `${MEAN_DAYS[f].toFixed(2)} d`);
  const unit = pureMode ? 'cycle' : 'month';
  const q = ev.quarters;
  const out = [];
  if (ev.synodic)
    out.push([`${sym('new-moon', '●')} ${sym('first-quarter', '◐')} ${sym('full-moon', '○')} ${sym('last-quarter', '◑')}`, `Synodic ${unit} (lunation, ${len('synodic')})`, `New moon, first quarter, full moon, last quarter: the Moon's geocentric elongation from the ${pureMode ? 'solar direction' : 'Sun'} is 0°, 90°, 180°, 270°.`]);
  if (ev.anomalistic)
    out.push([q ? `${sym('perigee', '■')} ${sym('post-perigee', '◧')} ${sym('apogee', '□')} ${sym('post-apogee', '◨')}` : `${sym('perigee', '■')} ${sym('apogee', '□')}`, `Anomalistic ${unit} (${len('anomalistic')})`, `Perigee and apogee: least and greatest Earth–Moon distance.${q ? ' Post-perigee and post-apogee: halfway in time to the next apogee or perigee.' : ''}`]);
  if (ev.draconic)
    out.push([q ? `${sym('ascending-node', '☊')} ${sym('post-ascending', '▲')} ${sym('descending-node', '☋')} ${sym('post-descending', '▼')}` : `${sym('ascending-node', '☊')} ${sym('descending-node', '☋')}`, `Draconic ${unit} (${len('draconic')})`, `Ascending and descending node: the Moon crosses the ecliptic northward or southward.${q ? ' Post-ascending and post-descending: halfway in time between the nodes.' : ''}`]);
  if (ev.sidereal)
    out.push([q ? `${sym('galactic-centre', '★')} ${sym('post-centre', '✦')} ${sym('galactic-anticentre', '☆')} ${sym('post-anticentre', '✧')}` : `${sym('galactic-centre', '★')} ${sym('galactic-anticentre', '☆')}`, `Sidereal ${unit} (${len('sidereal')})`, `Galactic centre and anticentre: the Moon passes the direction of the galactic centre (Sgr A*, ecliptic longitude 266.8°) and its opposite.${q ? ' Post-centre and post-anticentre: 90° past them.' : ''}`]);
  if (ev.lunistices)
    out.push([`${sym('moon-north', '△')} ${sym('moon-south', '▽')}`, `Tropical ${unit} (${len('tropical')})`, "Moon farthest north and south: the Moon's greatest apparent declination north and south of the celestial equator, with its value."]);
  const cross = ev.crossQuarters ? sym('cross-quarter-45', '⊗') : '';
  const crossDef = pureMode
    ? 'Cross-quarters: the apparent solar longitude is 45°, 135°, 225°, 315°, halfway between an equinox and a solstice.'
    : "Cross-quarters: the Sun's apparent longitude is 45°, 135°, 225°, 315°, halfway between an equinox and a solstice.";
  if (ev.solar)
    out.push([
      `${sym('march-equinox', '⊖')} ${sym('june-solstice', '◒')} ${sym('december-solstice', '◓')} ${sym('perihelion', '◉')} ${sym('aphelion', '◎')}${cross ? ' ' + cross : ''}`,
      'Solar events',
      (pureMode
        ? 'Northward and southward equinox, northern and southern solstice: the apparent solar longitude is 0°, 180°, 90°, 270°. Perihelion and aphelion: Earth nearest to and farthest from the solar centre.'
        : "Equinoxes and solstices: the Sun's apparent longitude is 0° (March), 90° (June), 180° (September), 270° (December). Perihelion and aphelion: Earth nearest to and farthest from the Sun.") +
        (cross ? ' ' + crossDef : ''),
    ]);
  else if (cross) out.push([cross, 'Cross-quarters', crossDef]);
  if (ev.eclipses)
    out.push([
      `${sym('solar-eclipse', '◍')} ${sym('lunar-eclipse', '◕')}`,
      'Eclipses',
      pureMode
        ? 'Solar eclipses (total, annular, hybrid, partial) and lunar eclipses (total, partial, penumbral), at the instant of greatest eclipse: the shadow axis nearest to the centre of the Earth, or the Moon nearest to the axis of the shadow of the Earth.'
        : "Solar eclipses (total, annular, hybrid, partial) and lunar eclipses (total, partial, penumbral), at greatest eclipse: the axis of the Moon's shadow nearest to the Earth's centre, or the Moon nearest to the axis of the Earth's shadow.",
    ]);
  if (ev.planets)
    out.push([
      `${sym('mercury-elongation-east', '☿')} ${sym('venus-elongation-east', '♀')} ${sym('mars-opposition', '♂')} ${sym('jupiter-opposition', '♃')} ${sym('saturn-opposition', '♄')}`,
      'Planets',
      pureMode
        ? 'Mercury, Venus: greatest elongation east or west (the angle from the solar direction), inferior and superior conjunction. Mars, Jupiter, Saturn: opposition and conjunction: geocentric ecliptic longitude 180° from or equal to the solar one.'
        : "Mercury, Venus: greatest elongation east (evening) or west (morning), with the angle from the Sun; inferior and superior conjunction. Mars, Jupiter, Saturn: opposition and conjunction, geocentric ecliptic longitude 180° from or equal to the Sun's.",
    ]);
  return out;
}

function legendHeight(cx, entries, width, size) {
  let h = 2;
  for (const [, , def] of entries) h += size * 1.45 + wrap(def, width, size, { maxLines: 4, font: cx.font }).length * size * 1.3 + 1.1;
  return h;
}

function drawLegend(svg, cx, fr, y, entries, size) {
  const { pal } = cx;
  svg.line(fr.x0, y, fr.x1, y, pal.ruleStrong, 0.2);
  let yy = y + 0.6;
  for (const [syms, name, def] of entries) {
    yy += size * 1.45;
    svg.runs(fr.x0, yy, [
      { text: name, size, fill: pal.ink, weight: 600 },
      { text: syms, size, fill: pal.ink2, gap: 1.6 },
    ], { maxW: fr.cw });
    yy = paragraph(svg, cx, fr.x0, yy, wrap(def, fr.cw, size, { maxLines: 4, font: cx.font }), { size, lead: 1.3, maxW: fr.cw });
    yy += 1.1;
  }
  return yy;
}

export function renderEphemeris(svg, cx, fr, page) {
  const { plan, pal, opts } = cx;
  const D = plan.delta;
  svg.runs(fr.x0, fr.y0 + 5, [
    { text: 'Ephemeris', size: 5, weight: 600, fill: pal.ink },
    { text: page.of > 1 ? `${page.part}/${page.of}` : '', size: SIZE.small, fill: pal.ink3, gap: 2 },
  ], { maxW: fr.cw });
  const what = opts.events.planets ? 'Lunar, solar and planetary events' : 'Lunar and solar events';
  const sub = cx.greg ? `${what} of ${D.name} · Fractonica and Gregorian time` : `${what} of ${D.name} · Fractonica time to the Flavon`;
  svg.text(fr.x0, fr.y0 + 9.6, sub, { size: 1.9, fill: pal.ink3, maxW: fr.cw });
  const rows = page.rows ?? [];
  const last = page.part === page.of;
  const entries = last ? legendEntries(cx) : [];
  const yTable = fr.y0 + HEADER - 4;
  const avail = fr.y1 - (yTable + 4);
  let legendSize = 1.75;
  let legendH = entries.length ? legendHeight(cx, entries, fr.cw, legendSize) : 0;
  let rowH = Math.min(ROW, (avail - legendH - 2) / Math.max(1, rows.length));
  if (entries.length && rowH < 4.2) {
    legendSize = 1.5;
    legendH = legendHeight(cx, entries, fr.cw, legendSize);
    rowH = Math.min(ROW, (avail - legendH - 2) / Math.max(1, rows.length));
  }
  if (rowH < 3.4) {
    // no room for the definitions on this page: the rows keep their size, the legend shrinks to the symbols
    legendH = 0;
    rowH = Math.min(ROW, avail / Math.max(1, rows.length));
  }
  let y;
  if (!rows.length) {
    svg.text(fr.x0, yTable + 8, 'No astronomical events are selected for this Delta.', { size: SIZE.small, fill: pal.ink3, maxW: fr.cw });
    y = yTable + 12;
  } else {
    const trs = rows.map((e) => ({
      cells: {
        sym: { text: cx.eventSymbol(e), fill: cx.familyColor(e) },
        label: { text: cx.eventLabel(e), fill: pal.ink },
        frac: { text: cx.fShort(e.t, 'lambda'), fill: pal.ink2 },
        greg: cx.greg ? { text: cx.gDayTime(e.t), fill: pal.ink2 } : '',
        page: { text: e.page ? String(e.page) : '—', weight: 600 },
      },
    }));
    const cols = [{ key: 'sym', min: 2.6 }, { key: 'label', flex: true }, { key: 'frac' }, ...(cx.greg ? [{ key: 'greg' }] : []), { key: 'page', align: 'end', min: 5 }];
    y = drawTable(svg, cx, {
      x0: fr.x0,
      x1: fr.x1,
      y: yTable,
      rowH,
      size: Math.min(2.05, rowH * 0.42),
      gap: 2,
      cols,
      rows: trs,
      header: { label: 'Event', frac: 'Fractonica', greg: 'Gregorian', page: 'Page' },
    });
  }
  if (entries.length && legendH) drawLegend(svg, cx, fr, Math.max(y + 2, fr.y1 - legendH), entries, legendSize);
}

// ---- planning / predictions ---------------------------------------------------------------------------------------

/** The Delta's frame: five Nuclides along a bar, the four quarters above with the thresholds' glyphs. */
function frameBar(svg, cx, fr, top) {
  const { plan, pal } = cx;
  const D = plan.delta;
  const X = (t) => fr.x0 + ((t - D.t0) / (D.t1 - D.t0)) * fr.cw;
  const barTop = top + 8.6;
  const barH = 5;
  const qs = plan.majors.filter((m) => m.level === 3 && ['peak', 'node', 'valley'].includes(m.event));
  const bounds = [D.t0, ...qs.map((m) => m.t), D.t1];
  ['Peak', 'Node', 'Valley', 'End'].forEach((w, i) => {
    if (bounds[i + 1] === undefined) return;
    const xm = (X(bounds[i]) + X(bounds[i + 1])) / 2;
    svg.text(xm, top + 2.9, `${w} quarter`, { size: 1.9, fill: pal.level(3), anchor: 'middle', maxW: X(bounds[i + 1]) - X(bounds[i]) - 4 });
  });
  plan.nuclides.forEach((nu, i) => {
    const a = X(nu.t0);
    const b = X(nu.t1);
    svg.rect(a, barTop, b - a, barH, { fill: i % 2 ? '#ffffff' : pal.levelSoft(4), stroke: pal.ruleStrong, sw: 0.18 });
    const under = cx.greg ? cx.gDay(nu.t0) : `${nu.name} 1η`;
    svg.text(a + 0.4, barTop + barH + 2.8, under, { size: 1.6, fill: pal.ink3, maxW: b - a - 1 });
  });
  for (const m of qs) {
    const x = X(m.t);
    svg.line(x, barTop - 0.9, x, barTop + barH + 0.9, pal.level(3), 0.4);
    svg.glyph(QUARTER_GLYPH[m.event], x, barTop - 2.7, 2.7, pal.level(3), 0.2);
  }
  // the Nuclide names, each in the widest stretch of its segment that no threshold line cuts
  const cuts = qs.map((m) => X(m.t));
  plan.nuclides.forEach((nu) => {
    const pts = [X(nu.t0), ...cuts.filter((x) => x > X(nu.t0) + 0.5 && x < X(nu.t1) - 0.5), X(nu.t1)];
    let best = [pts[0], pts[1]];
    for (let i = 1; i < pts.length - 1; i++) if (pts[i + 1] - pts[i] > best[1] - best[0]) best = [pts[i], pts[i + 1]];
    svg.text((best[0] + best[1]) / 2, barTop + barH * 0.5 + 0.75, nu.name, { size: 2.1, weight: 600, fill: pal.level(4), anchor: 'middle', maxW: best[1] - best[0] - 0.8 });
  });
  return barTop + barH + 6;
}

export function renderPlanning(svg, cx, fr, page) {
  const { plan, pal } = cx;
  const D = plan.delta;
  const word = page.kind === 'predictions' ? 'Predictions' : 'Planning';
  const gap = lineGap(fr);
  if (page.part > 1) {
    svg.runs(fr.x0, fr.y0 + 4.6, [
      { text: word, size: 4.4, weight: 600, fill: pal.ink },
      { text: `${page.part}/${page.of}`, size: SIZE.small, fill: pal.ink3, gap: 2 },
    ], { maxW: fr.cw });
    writingLines(svg, cx, fr.x0, fr.x1, fr.y0 + 7, fr.y1, gap);
    return;
  }
  svg.runs(fr.x0, fr.y0 + 5, [
    { text: word, size: 5, weight: 600, fill: pal.ink },
    { text: page.of > 1 ? `1/${page.of}` : '', size: SIZE.small, fill: pal.ink3, gap: 2 },
  ], { maxW: fr.cw });
  const sub = [D.name, D.stamp, cx.greg ? cx.gDays(D.t0, D.t1, { year: true }) : null].filter(Boolean).join(' · ');
  svg.text(fr.x0, fr.y0 + 9.4, sub, { size: 1.9, fill: pal.ink3, maxW: fr.cw });
  let y = frameBar(svg, cx, fr, fr.y0 + 11.5);
  const blocks = [];
  if (page.kind === 'planning') {
    for (const nu of plan.nuclides) {
      const [p0, p1] = nuclidePages(plan, nu);
      blocks.push([
        { text: nu.name, fill: pal.level(4), weight: 600 },
        { text: cx.greg ? cx.gDays(nu.t0, nu.t1) : '1η–77η', fill: pal.ink2, size: 1.9, gap: 1.6 },
        { text: `pages ${p0}–${p1}`, fill: pal.ink3, size: 1.9, gap: 1.6 },
      ]);
    }
  } else {
    const qs = plan.majors.filter((m) => m.level === 3 && ['peak', 'node', 'valley'].includes(m.event));
    const ends = [...qs.map((m) => m.t), D.t1];
    ['peak', 'node', 'valley', 'end'].forEach((q, i) => {
      const t = ends[i];
      if (t === undefined) return;
      const until = cx.greg ? `until ${cx.gDayTime(t)}` : `until ${cx.fShort(t)}`;
      blocks.push([
        { text: `${QUARTER_WORD[q]} quarter`, fill: pal.level(3), weight: 600 },
        { text: until, fill: pal.ink2, size: 1.9, gap: 1.6 },
        { text: q === 'end' ? '' : cx.fShort(t), fill: pal.ink3, size: 1.9, gap: 1.6 },
      ]);
    });
  }
  const each = (fr.y1 - y) / blocks.length;
  for (const runs of blocks) {
    const yr = blockHead(svg, cx, fr, y, runs, { size: 2.2 });
    writingLines(svg, cx, fr.x0, fr.x1, yr, y + each - 1.2, Math.min(gap, Math.max(4.4, (y + each - 1.2 - yr) / 3)));
    y += each;
  }
}

