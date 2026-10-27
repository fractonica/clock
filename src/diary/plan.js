/**
 * The diary planner: one Delta (5 Nuclides × 77 Helions = 385 Helions) laid out as numbered pages.
 *
 * Pure data, no DOM: `planDiary(...)` returns every page with what it maps (Helions, their times, ticks and events), the
 * index rows with page numbers and the Gregorian day → page map. Renderers (src/diary/render.js) only draw it.
 *
 * Layout rules (docs/design/90-diary.md):
 *   - a SHEET is one leaf: its front is a recto (odd page), its back a verso; filler "notes" pages keep that true;
 *   - front matter: [cover] index · Gregorian index · ephemeris · reference sheet · planning · predictions; the reference
 *     sheet is one leaf: the period ladder on its front (a recto), the milestones of Alpha, Beta, Gamma on its back;
 *   - per Nuclide: a header page on a verso (it faces the first Helion page), then the locks: each lock is the sheets of
 *     opts.lock.sheets ([front lined Helions, back canvas Helions]; 19 Helions by default), then the Helions left over
 *     (77 − 4·19 = 1, "the 77th Helion"): a fine lined page and one page per retro canvas;
 *   - a Delta sheet (insert + notes) before the lock that holds each Delta quarter threshold (Peak, Node, Valley);
 *   - closing: summary pages from a recto; the diary ends on a verso.
 * Times are Unix seconds; `frac` is the time-linear fraction of a tick or event inside its Helion.
 */
import { lockShape, rowsPerPage, monthsPerPage } from './options.js';
import { zonedParts, zonedToUnix } from '../core/format.js';
import { ladderOf, milestonesOf } from './reference.js';

export const DELTA = 3;
export const NUCLIDE = 4;
export const HELION = 6;
export const HELIONS_PER_NUCLIDE = 77;
export const HELIONS_PER_DELTA = 385;
/** Helions in one Alpha cycle (P(6) / P(0) = 5·13·5·5·7·11). */
export const ALPHA_HELIONS = 125125;
const QUARTER = { peak: 'Peak', node: 'Node', valley: 'Valley', end: 'End' };
/** Rows the renderer needs under the last ephemeris table for its legend. */
export const EPHEMERIS_LEGEND_ROWS = 13;
/** The library names the thresholds of a period begin / firstPeak / middleNode / oppositePeak / end (SPEC §6.2 names). */
const EVENT = { begin: 'begin', firstPeak: 'peak', middleNode: 'node', oppositePeak: 'valley', end: 'end' };
const eventName = (n) => EVENT[n] ?? n;

/** Indices of the Deltas that lie wholly inside the catalogue: {first, last}. */
export function deltaRange(model) {
  const count = Number(model.clock.count(DELTA));
  let last = count - 1;
  while (last > 0 && model.cycleByIndex(DELTA, last)?.clipped) last--;
  return { first: 0, last };
}
/** The Delta holding time t, clamped into deltaRange. */
export function deltaAt(model, t) {
  const { first, last } = deltaRange(model);
  const l = model.levelAt(model.clamp(t), DELTA);
  return Math.min(last, Math.max(first, l ? l.cycle : first));
}
/** Ordinals α β γ δ of a Delta (1-based; α global), e.g. [6, 4, 9, 3]. */
export function deltaPath(model, idx) {
  return [0, 1, 2, 3].map((L) => {
    const per = model.levelInfo(DELTA).prefixNum / model.levelInfo(L).prefixNum;
    const c = Math.floor(idx / per);
    const sib = model.levelInfo(L).siblings;
    return sib === null ? c + 1 : (c % sib) + 1;
  });
}
/** The Delta index for ordinals [α, β, γ, δ] (1-based), or null when it does not exist. */
export function deltaFromPath(model, [a, b, g, d]) {
  const idx = (((a - 1) * 5 + (b - 1)) * 13 + (g - 1)) * 5 + (d - 1);
  const { first, last } = deltaRange(model);
  return idx >= first && idx <= last ? idx : null;
}

/**
 * Plan the diary of Delta `delta`.
 * @param {object} a
 * @param {object} a.model   src/core/model.js
 * @param {object} a.pure    src/core/pure.js helpers (names)
 * @param {object} a.opts    sanitizeDiaryOptions(...)
 * @param {number} a.delta   global Delta index (deltaRange)
 * @param {Array}  [a.events] astro events {t, family, name, ...} (src/diary/astro); filtered to the Delta here
 * @param {string} [a.zone]  IANA zone of the Gregorian references
 * @param {object} [a.sky]   the local sky of the Delta (src/diary/astro/sky.js skyOf + {place}), or null
 * @param {Array}  [a.eclipses] the eclipses of the Delta with their circumstances: [{ev (the ephemeris event), detail,
 *                           local, saros, geo}] (src/ui/diary/build.js); each gets 2 sheets before its Helion's sheet
 * @param {object} [a.world] the map data for the eclipse maps (src/diary/geo/world.js), or null
 */
export function planDiary({ model, pure, opts, delta, events = [], zone = 'UTC', sky = null, eclipses = [], world = null }) {
  const D = model.cycleByIndex(DELTA, delta);
  if (!D) throw new RangeError(`Delta ${delta} is outside the catalogue`);
  const shape = lockShape(opts);
  const path = deltaPath(model, delta);
  const deltaInfo = {
    idx: delta,
    path,
    t0: D.start,
    t1: D.end,
    name: pure.periodName(3, path[3]),
    words: [0, 1, 2, 3].map((L) => pure.periodName(L, path[L])),
    stamp: `α#${path[0]} β#${path[1]} γ#${path[2]} δ#${path[3]}`,
    thresholds: D.events.map((e) => ({ name: eventName(e.name), t: e.time })),
  };

  // ---- the 385 Helions and 5 Nuclides --------------------------------------------------------------
  const helions = [];
  for (let d = 0; d < HELIONS_PER_DELTA; d++) {
    const c = model.cycleByIndex(HELION, delta * HELIONS_PER_DELTA + d);
    const n = Math.floor(d / HELIONS_PER_NUCLIDE);
    const h = d % HELIONS_PER_NUCLIDE;
    helions.push({
      d,
      n,
      h,
      // the Helion's number in its Nuclide, from 1 (1..77: SPEC §15); never print `h` itself
      num: h + 1,
      cycle: c.cycle,
      // the Helion's number in its Alpha, from 1 (1..125 125): the global Saros phase of the running head
      alpha: (c.cycle % ALPHA_HELIONS) + 1,
      t0: c.start,
      t1: c.end,
      label: `${h + 1}η`,
      stamp: `δ#${path[3]} ε#${n + 1} ${h + 1}η`,
      // begin / peak / node / valley / end with their fraction of the Helion
      ticks: c.events.map((e) => ({ name: eventName(e.name), t: e.time, frac: (e.time - c.start) / (c.end - c.start) })),
      lock: null,
      page: null,
      events: [],
    });
  }
  const nuclides = [0, 1, 2, 3, 4].map((n) => {
    const c = model.cycleByIndex(NUCLIDE, delta * 5 + n);
    return { n, name: `ε#${n + 1}`, t0: c.start, t1: c.end, headerPage: null, locks: [], retro: [] };
  });
  for (const nu of nuclides) {
    for (let k = 0; k < shape.locks; k++) {
      const ds = Array.from({ length: shape.perLock }, (_, i) => nu.n * 77 + k * shape.perLock + i);
      ds.forEach((d) => (helions[d].lock = k));
      nu.locks.push({ k, helions: ds, t0: helions[ds[0]].t0, t1: helions[ds.at(-1)].t1, firstPage: null, insert: null });
    }
    for (let r = shape.locks * shape.perLock; r < 77; r++) nu.retro.push(nu.n * 77 + r);
  }
  const helionAt = (t) => {
    let lo = 0;
    let hi = helions.length - 1;
    if (!(t >= helions[0].t0 && t < helions.at(-1).t1)) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (helions[mid].t0 <= t) lo = mid;
      else hi = mid - 1;
    }
    return helions[lo];
  };

  // ---- thresholds of the major periods inside the Delta -------------------------------------------
  const majors = [];
  for (let L = 0; L <= 3; L++) {
    const per = model.levelInfo(DELTA).prefixNum / model.levelInfo(L).prefixNum;
    const c = model.cycleByIndex(L, Math.floor(delta / per));
    const ord = path[L];
    for (const raw of c.events) {
      const e = { name: eventName(raw.name), time: raw.time };
      if (e.time === null || e.time < D.start - 1e-6 || e.time > D.end + 1e-6) continue;
      if (e.name === 'begin' && Math.abs(e.time - D.start) > 1e-3) continue;
      majors.push({
        level: L,
        ord,
        name: pure.periodName(L, ord),
        event: e.name,
        // the quarter that ends at this threshold ('begin' ends nothing)
        quarter: QUARTER[e.name] ?? null,
        t: e.time,
      });
    }
  }
  majors.sort((a, b) => a.t - b.t || a.level - b.level);

  // ---- events: astro + solar syncs + majors, attached to their Helion ----------------------------
  const all = [];
  for (const e of events) if (e.t >= D.start && e.t < D.end) all.push({ ...e });
  if (opts.events.solarSync) {
    const s0 = model.solarAt(D.start);
    if (s0) {
      for (let s = s0.sync; ; s++) {
        const sy = model.solarSyncByNumber(s);
        if (!sy || sy.start >= D.end) break;
        if (sy.start >= D.start) all.push({ t: sy.start, family: 'sync', name: 'sync', sync: s, drift: sy.drift, nominalStart: sy.nominalStart });
      }
    }
  }
  if (opts.events.majors) {
    for (const m of majors) if (m.t >= D.start && m.t < D.end && m.event !== 'begin') all.push({ t: m.t, family: 'major', name: m.event, major: m });
  }
  all.sort((a, b) => a.t - b.t);
  for (const e of all) {
    const h = helionAt(e.t);
    if (!h) continue;
    e.d = h.d;
    e.frac = (e.t - h.t0) / (h.t1 - h.t0);
    h.events.push(e);
  }

  // ---- inserts: a Delta sheet before the lock (or retro run) that holds each Delta quarter threshold --------
  const inserts = [];
  if (opts.inserts.deltaQuarters) {
    for (const m of majors) {
      if (m.level !== 3 || !['peak', 'node', 'valley'].includes(m.event)) continue;
      const h = helionAt(m.t);
      if (!h) continue;
      const nu = nuclides[h.n];
      const target = h.lock === null ? { retro: true, nuclide: nu } : nu.locks[h.lock];
      inserts.push({ major: m, helion: h.d, nuclide: h.n, lock: h.lock, target });
    }
  }

  // ---- eclipses: 2 sheets each before the sheet that holds their Helion ----------------------------------------
  const eclipseList = [];
  if (opts.inserts.eclipses && opts.events.eclipses) {
    for (const x of eclipses) {
      const h = x?.ev ? helionAt(x.ev.t) : null;
      if (h) eclipseList.push({ ...x, d: h.d, page: null, pages: [] });
    }
    eclipseList.sort((a, b) => a.ev.t - b.ev.t);
  }

  // ---- pagination -------------------------------------------------------------------------------------
  const pages = [];
  const nextNo = () => pages.length + 1;
  const side = (no) => (no % 2 ? 'recto' : 'verso');
  function add(kind, data = {}, startOn = null) {
    if (startOn && side(nextNo()) !== startOn) pages.push({ no: nextNo(), side: side(nextNo()), kind: 'notes', filler: true });
    const p = { no: nextNo(), side: side(nextNo()), kind, ...data };
    pages.push(p);
    return p;
  }
  const sections = [];
  const section = (title, key, page) => sections.push({ title, key, page: page.no });

  // front matter: counts are known before page numbers, the rows are filled in at the end
  const rpp = rowsPerPage(opts);
  const front = { index: [], gregorian: [], ephemeris: [], planning: [], predictions: [] };
  if (opts.front.cover) section('Cover', 'cover', add('cover', {}, 'recto'));
  const indexRowCount = 2 + majors.length + 5 * (1 + shape.locks + (shape.retro ? 1 : 0)) + inserts.length + eclipseList.length + 8;
  if (opts.front.index) {
    const n = Math.max(1, Math.ceil(indexRowCount / rpp));
    for (let i = 0; i < n; i++) front.index.push(add('index', { part: i + 1, of: n, rows: [] }, i === 0 ? 'recto' : null));
    section('Index', 'index', front.index[0]);
  }
  const days = opts.gregorian.on ? gregorianDays(D.start, D.end, zone) : [];
  const months = [];
  for (const dd of days) if (!months.some((m) => m.y === dd.y && m.m === dd.m)) months.push({ y: dd.y, m: dd.m });
  if (opts.gregorian.on && opts.front.gregorianIndex && months.length) {
    const per = monthsPerPage(opts);
    const n = Math.ceil(months.length / per);
    for (let i = 0; i < n; i++) front.gregorian.push(add('gregorian', { part: i + 1, of: n, months: months.slice(i * per, i * per + per) }));
    section('Gregorian index', 'gregorian', front.gregorian[0]);
  }
  const ephemerisRows = all.filter((e) => e.family !== 'sync' && e.family !== 'major');
  if (opts.front.ephemeris) {
    // the last ephemeris page keeps EPHEMERIS_LEGEND_ROWS rows free for the legend of the months and solar events
    // rows may pack up to 30 % tighter (≥ 4.2 mm on A5) when that saves a page
    const want = ephemerisRows.length + EPHEMERIS_LEGEND_ROWS;
    const n = Math.max(1, Math.ceil(want / Math.floor(rpp * 1.3)));
    const per = Math.max(1, Math.min(Math.floor(rpp * 1.3), Math.ceil(want / n)));
    for (let i = 0; i < n; i++) front.ephemeris.push(add('ephemeris', { part: i + 1, of: n, rows: ephemerisRows.slice(i * per, i * per + per) }));
    section('Ephemeris', 'ephemeris', front.ephemeris[0]);
  }
  // the reference sheet: the ladder of the hierarchy in the eclipse interval of this Delta, and the Alpha that holds it
  let reference = null;
  if (opts.front.reference) {
    reference = { ladder: ladderOf(model, D.start), milestones: milestonesOf({ model, pure, path }) };
    reference.ladderPage = add('ladder', {}, 'recto').no;
    reference.milestonesPage = add('milestones', {}).no;
    section('Period ladder', 'ladder', pages[reference.ladderPage - 1]);
    section('Milestones', 'milestones', pages[reference.milestonesPage - 1]);
  }
  for (let i = 0; i < opts.front.planning; i++) front.planning.push(add('planning', { part: i + 1, of: opts.front.planning }));
  if (front.planning.length) section('Planning', 'planning', front.planning[0]);
  for (let i = 0; i < opts.front.predictions; i++) front.predictions.push(add('predictions', { part: i + 1, of: opts.front.predictions }));
  if (front.predictions.length) section('Predictions', 'predictions', front.predictions[0]);

  // body
  let canvasCursor = 0;
  // `extra.front`: the page is a sheet front (a recto); `extra.canvasList`: the canvases of its sections, in order
  const helionPages = (ds, kind, extra) => {
    const { front = kind === 'lined', canvasList = null, ...meta } = extra;
    const p = add(kind, { ...meta, sections: [] }, front ? 'recto' : null);
    for (const [i, d] of ds.entries()) {
      const h = helions[d];
      if (kind === 'lined') p.sections.push({ d, lines: meta.retro ? opts.retro.lines : opts.lined.linesPerHelion });
      else {
        const cv = canvasList ? canvasList[i % canvasList.length] : meta.retro ? meta.canvas : opts.canvases[canvasCursor++ % opts.canvases.length];
        p.sections.push({ d, canvas: cv });
      }
      if (h.page === null) h.page = p.no;
      (h.pages ??= []).push(p.no);
    }
    p.t0 = helions[ds[0]].t0;
    p.t1 = helions[ds.at(-1)].t1;
    return p;
  };
  const placeInserts = (match) => {
    for (const ins of inserts.filter(match)) {
      const p = add('insert', { major: ins.major, nuclide: ins.nuclide, lock: ins.lock, helion: ins.helion }, 'recto');
      ins.page = p.no;
      add('notes', { insertBack: true });
      section(`${ins.major.name} · ${ins.major.quarter}`, 'insert', p);
    }
  };
  /**
   * An eclipse's 2 sheets: [the eclipse | its Saros series] and [its Helion in detail | a blank canvas]. The Helion keeps
   * its place on its regular sheet too; these pages never become its `page`.
   */
  const placeEclipses = (ds) => {
    for (const [i, x] of eclipseList.entries()) {
      if (x.page !== null || !ds.includes(x.d)) continue;
      const h = helions[x.d];
      const base = { eclipse: i, nuclide: h.n, t0: h.t0, t1: h.t1 };
      const p = add('eclipse', { ...base, helion: x.d }, 'recto');
      x.page = p.no;
      x.pages.push(p.no, add('saros', base).no);
      x.pages.push(add('eclipse-helion', { ...base, helion: x.d, sections: [{ d: x.d, lines: 36 }] }, 'recto').no);
      x.pages.push(add('canvas', { ...base, sections: [{ d: x.d, canvas: { type: 'blank' } }] }).no);
      section(x.ev.label ?? 'Eclipse', 'eclipse', p);
    }
  };
  for (const nu of nuclides) {
    nu.headerPage = add('nuclide', { n: nu.n }, 'verso').no;
    section(`Nuclide ${nu.name}`, `nuclide-${nu.n}`, pages.at(-1));
    for (const lock of nu.locks) {
      placeInserts((i) => i.nuclide === nu.n && i.lock === lock.k);
      canvasCursor = 0;
      let at = 0;
      let pentad = 0;
      opts.lock.sheets.forEach(([f, b], s) => {
        // internal ids: a sheet of 5 Helions is unit 'pentad', of 4 unit 'semi' (by default the lock's last sheet: 2 + 2
        // canvases). Pages never call them Pentads: those follow the solar sync (SPEC §7.5), the lock the Nuclide.
        const unit = f + b === 5 ? 'pentad' : f + b === 4 ? 'semi' : 'sheet';
        const meta = { nuclide: nu.n, lock: lock.k, sheet: s, sheets: opts.lock.sheets.length, unit, unitNo: unit === 'pentad' ? ++pentad : null };
        const ds = lock.helions.slice(at, at + f + b);
        at += f + b;
        placeEclipses(ds);
        if (unit === 'semi' && opts.semi.allCanvas) {
          const half = Math.ceil(ds.length / 2);
          const fr = helionPages(ds.slice(0, half), 'canvas', { ...meta, front: true, canvasList: opts.semi.canvases, semiSide: 'front' });
          if (s === 0) lock.firstPage = fr.no;
          helionPages(ds.slice(half), 'canvas', { ...meta, canvasList: opts.semi.canvases.slice(half).concat(opts.semi.canvases.slice(0, half)), semiSide: 'back' });
          return;
        }
        const fr = helionPages(ds.slice(0, f), 'lined', { ...meta, semiSide: unit === 'semi' ? 'front' : undefined });
        if (s === 0) lock.firstPage = fr.no;
        if (b > 0) helionPages(ds.slice(f), 'canvas', { ...meta, semiSide: unit === 'semi' ? 'back' : undefined });
        else add('notes', { sheetBack: true });
      });
    }
    if (nu.retro.length) {
      placeInserts((i) => i.nuclide === nu.n && i.lock === null);
      placeEclipses(nu.retro);
      for (const d of nu.retro) {
        const meta = { nuclide: nu.n, lock: null, retro: true };
        const lp = helionPages([d], 'lined', meta);
        nu.retroPage = nu.retroPage ?? lp.no;
        opts.retro.canvases.forEach((cv, i) => helionPages([d], 'canvas', { ...meta, canvas: cv, canvasIndex: i, canvases: opts.retro.canvases.length }));
      }
    }
  }
  const summary = [];
  for (let i = 0; i < opts.closing.summaryPages; i++) summary.push(add('summary', { part: i + 1, of: opts.closing.summaryPages }, i === 0 ? 'recto' : null));
  if (summary.length) section('Retrospection and summary', 'summary', summary[0]);
  if (pages.length % 2) add('notes', { tail: true });

  // ---- edge references: each page points to the previous and next page of the same kind -------------------------
  navigate({ pages, helions, nuclides, inserts });
  for (const x of eclipseList) x.ev.page = x.page;

  // ---- page numbers into events, days and the index ------------------------------------------------------
  const pageOf = (t) => helionAt(t)?.page ?? null;
  for (const e of all) e.page = e.d !== undefined ? helions[e.d].page : null;
  for (const dd of days) dd.page = pageOf(Math.max(dd.t0, D.start));

  const indexRows = buildIndexRows({ deltaInfo, majors, nuclides, inserts, helions, sections, pageOf, D, eclipses: eclipseList });
  front.index.forEach((p, i) => (p.rows = indexRows.slice(i * rpp, i * rpp + rpp)));
  // an index longer than planned spills into the last index page (never lost)
  if (front.index.length && indexRows.length > front.index.length * rpp) front.index.at(-1).rows.push(...indexRows.slice(front.index.length * rpp));

  return {
    delta: deltaInfo,
    opts,
    zone,
    shape,
    pages,
    helions,
    nuclides,
    majors,
    events: all,
    inserts,
    reference,
    eclipses: eclipseList,
    world,
    sky: opts.sky?.on ? sky : null,
    days,
    months,
    sections,
    index: indexRows,
    helionAt,
    pageOf,
  };
}

/**
 * The thumb index (docs/design/90-diary.md, "Edge references"): page.nav = [{kind, prev, next, label}] with page numbers
 * (null at either end). Kinds, each at its own height on the outer edge:
 *   nuclide  Nuclide header ↔ header       insert  Delta sheet ↔ Delta sheet      lock  first page of a solar lock ↔ next
 *   semi     4-Helion sheet front ↔ front, back ↔ back                           retro the 77th Helion's pages, page by page
 *   helion   a Helion page ↔ the page of the same Helion number in the previous / next Nuclide (77 Helions away)
 */
export function navigate({ pages, helions, nuclides, inserts }) {
  const link = (list, kind, label) =>
    list.forEach((p, i) => (p.nav ??= []).push({ kind, label, prev: list[i - 1]?.no ?? null, next: list[i + 1]?.no ?? null }));
  link(pages.filter((p) => p.kind === 'nuclide'), 'nuclide', 'Nuclide');
  link(pages.filter((p) => p.kind === 'eclipse'), 'eclipse', 'eclipse');
  link(inserts.map((x) => pages[x.page - 1]).filter(Boolean), 'insert', 'Delta sheet');
  link(nuclides.flatMap((nu) => nu.locks.map((l) => pages[l.firstPage - 1])).filter(Boolean), 'lock', 'solar lock');
  for (const side of ['front', 'back']) link(pages.filter((p) => p.semiSide === side), 'semi', '4-Helion sheet');
  // the 77th Helion: its lined page and each of its canvas pages link to the same page of the other Nuclides
  const roles = new Map();
  for (const p of pages.filter((x) => x.retro)) {
    const key = `${p.kind}|${p.canvasIndex ?? -1}|${p.sections[0].d % 77}`;
    if (!roles.has(key)) roles.set(key, []);
    roles.get(key).push(p);
  }
  for (const list of roles.values()) link(list, 'retro', `${helions[list[0].sections[0].d].num}η`);
  // a Helion page: the page that first maps the same Helion number one Nuclide earlier / later
  for (const p of pages) {
    if (!p.sections || p.retro || p.eclipse !== undefined) continue;
    const h = helions[p.sections[0].d];
    const other = (dd) => helions[dd]?.pages?.find((no) => pages[no - 1].kind === p.kind) ?? helions[dd]?.page ?? null;
    (p.nav ??= []).push({ kind: 'helion', label: h.label, prev: other(h.d - 77), next: other(h.d + 77) });
  }
}

/** Local days in `zone` that overlap [t0, t1): {y, m, d, weekday, t0 (local midnight), t1}. */
export function gregorianDays(t0, t1, zone) {
  const out = [];
  let p = zonedParts(t0, zone);
  let dayStart = zonedToUnix({ year: p.year, month: p.month, day: p.day }, zone);
  for (let guard = 0; dayStart < t1 && guard < 400; guard++) {
    const next = zonedToUnix({ year: p.year, month: p.month, day: p.day + 1 }, zone);
    out.push({ y: p.year, m: p.month, d: p.day, weekday: p.weekday, t0: dayStart, t1: next, page: null });
    dayStart = next;
    p = zonedParts(next + 1, zone);
  }
  return out;
}

function buildIndexRows({ deltaInfo, majors, nuclides, inserts, helions, sections, pageOf, D, eclipses = [] }) {
  const rows = [];
  rows.push({ kind: 'delta-begin', t: D.start, page: pageOf(D.start), label: deltaInfo.name });
  // thresholds of Alpha … Delta inside the Delta; a coarser period that begins with this Delta is listed too
  for (const m of majors) if ((m.event !== 'begin' || m.level < 3) && m.t < D.end) rows.push({ kind: 'major', t: m.t, page: pageOf(m.t), major: m });
  rows.push({ kind: 'delta-end', t: D.end, page: null, label: deltaInfo.name });
  for (const nu of nuclides) {
    rows.push({ kind: 'nuclide', t: nu.t0, page: nu.headerPage, nuclide: nu.n, label: nu.name });
    // Helion numbers from 1 (SPEC §15): a lock of the default pattern holds 1η–19η, the retro Helion is 77η
    for (const l of nu.locks) rows.push({ kind: 'lock', t: l.t0, page: l.firstPage, nuclide: nu.n, lock: l.k, helions: [l.helions[0], l.helions.at(-1)].map((d) => helions[d].num) });
    if (nu.retro.length) rows.push({ kind: 'retro', t: helions[nu.retro[0]].t0, page: nu.retroPage, nuclide: nu.n, helions: nu.retro.map((d) => helions[d].num) });
  }
  for (const ins of inserts) rows.push({ kind: 'insert', t: ins.major.t, page: ins.page, major: ins.major });
  for (const x of eclipses) rows.push({ kind: 'eclipse', t: x.ev.t, page: x.page, eclipse: x, label: x.ev.label });
  for (const s of sections) if (['ephemeris', 'ladder', 'milestones', 'planning', 'predictions', 'summary', 'gregorian'].includes(s.key)) rows.push({ kind: 'section', page: s.page, label: s.title, key: s.key });
  return rows;
}
