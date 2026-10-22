// Golden fixture for CalendarChecks: what the web calendar (src/ui/calendar/convert.js, month.js, pure-conv.js) computes
// for a spread of months, zones, years, instants and Delta pages, so the native mapping is checked against the
// JavaScript itself rather than against the Swift engine alone.
//
//   node ios/Fractonica/Features/Calendar/Checks/make-calendar-fixture.mjs   (from the repository root; writes fixture.json here)
import { writeFileSync } from 'node:fs';
import '../../../../../fractonica.js';
import { createModel } from '../../../../../src/core/model.js';
import { createFormatter } from '../../../../../src/core/format.js';
import { createPure } from '../../../../../src/core/pure.js';
import { buildMonth, yearSummary, yearRibbon } from '../../../../../src/ui/calendar/month.js';
import { exactPosition, pathOfTime, syncRange, safeSolarAt, solarInfo, eclipseContext, dayStart } from '../../../../../src/ui/calendar/convert.js';
import { buildPureGrid, viewOfTime, viewCount, countersAt } from '../../../../../src/ui/calendar/pure-conv.js';

const model = createModel();
const T_A = 1791460800;
const pure = createPure(model, { now: () => T_A });
const fmtIn = (zone) => createFormatter(() => zone);

const lcg = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const r = lcg(29);
const instants = [T_A, 946684800, 2886085800, model.tMin + 3600, model.tMax - 3600, model.tMin, model.tMax,
  ...Array.from({ length: 24 }, () => Math.round((model.tMin + 1 + r() * (model.tMax - model.tMin - 2)) * 1000) / 1000)];

const out = { tMin: model.tMin, tMax: model.tMax, syncRange: syncRange(model), months: [], years: [], instants: [], pages: [], viewCount: viewCount(model) };

// month grids: zones with clock changes, a skipped date (Apia 2011-12-30), half-hour shifts, both catalogue edges
const months = [
  [2026, 10, 'UTC', 1], [2026, 10, 'Europe/Berlin', 0], [2026, 3, 'Europe/Berlin', 1], [2026, 11, 'America/New_York', 0],
  [2011, 12, 'Pacific/Apia', 1], [2026, 4, 'Australia/Lord_Howe', 1], [2000, 1, 'Asia/Kolkata', 1], [1613, 5, 'UTC', 1],
  [2857, 6, 'UTC', 1], [2061, 7, 'UTC', 0], [1700, 2, 'UTC', 1], [2400, 2, 'Asia/Tokyo', 1],
];
const overlays = [2, 3, 4, 5, 6, 'sync'];
for (const [mi, [year, month, zone, weekStart]] of months.entries()) {
  const f = fmtIn(zone);
  for (const overlay of overlays) {
    if (overlay === 6 && mi > 4) continue; // η: five months are plenty (a month holds ~150 of them)
    const g = buildMonth(model, f, { year, month, weekStart, overlay });
    out.months.push({
      year, month, zone, weekStart, overlay: String(overlay),
      cells: g.cells.map((c) => ({
        y: c.year, m: c.month, d: c.day, inMonth: c.inMonth, dow: c.dow, start: c.start, end: c.end, inRange: c.inRange, eclipse: c.eclipse,
        segs: c.segments.map((s) => ({ idx: s.kind === 'sync' ? s.sync : s.idx, ord: s.kind === 'sync' ? s.q : s.local + 1, start: s.start, end: s.end, sh: s.startsHere, eh: s.endsHere })),
      })),
    });
  }
}

// the year ribbon and its summary
for (const [year, zone] of [[2026, 'UTC'], [2026, 'Europe/Berlin'], [1613, 'UTC'], [1614, 'UTC'], [2857, 'UTC'], [2856, 'America/New_York'], [1612, 'UTC'], [2000, 'Asia/Kolkata']]) {
  const f = fmtIn(zone);
  const rb = yearRibbon(model, f, year);
  out.years.push({
    year, zone, text: yearSummary(model, f, year).text,
    start: rb.start, end: rb.end,
    months: rb.months.map((m) => ({ x0: m.x0, x1: m.x1, inRange: m.inRange })),
    ticks: [...rb.delta, ...rb.eps].map((t) => ({ level: t.level, ord: t.local + 1, start: t.start, x: t.x })),
  });
}

// converter readings at instants
const f = fmtIn('UTC');
for (const t of instants) {
  const pos = exactPosition(model, t, 15);
  const sol = safeSolarAt(model, t);
  const info = sol ? solarInfo(model, f, sol.sync) : null;
  const ec = eclipseContext(model, t);
  const c = countersAt(pure, t);
  out.instants.push({
    t,
    position: pos,
    path: pathOfTime(model, t, 14),
    sync: sol ? { n: sol.sync, start: info?.start ?? null, end: info?.end ?? null, drift: info?.drift ?? null, phase: sol.phase ?? null } : null,
    eclipse: { prev: ec.prev?.k ?? ec.prev?.index ?? null, next: ec.next?.k ?? ec.next?.index ?? null },
    view: viewOfTime(model, t),
    counters: c ? { alpha: c.alpha, beta: c.beta, gamma: c.gamma, delta: c.delta, epsilon: c.epsilon, eta: c.eta, iota: c.iota, lambda: c.lambda, nu: c.nu } : null,
  });
}

// Delta pages: the first, vector A's, around an eclipse, the last
const vc = viewCount(model);
for (const hv of [0, 1, viewOfTime(model, T_A), viewOfTime(model, model.catalogue[22]), viewOfTime(model, 946684800), vc - 2, vc - 1]) {
  const g = buildPureGrid(model, hv);
  out.pages.push({
    hv,
    cells: g.cells.map((c) => ({
      z: c.z, inRange: c.inRange, cut: c.cut, start: c.start, end: c.end, eclipse: c.eclipse, frac: c.eclipseFrac,
      syncs: c.syncs.map((s) => ({ n: s.sync, q: s.q, x: s.x, start: s.start })),
      dq: c.dq.map((q) => ({ q: q.q, x0: q.x0, x1: q.x1, sh: q.startsHere })),
    })),
  });
}

writeFileSync(new URL('./fixture.json', import.meta.url), JSON.stringify(out));
console.log(`fixture.json: ${out.months.length} month grids, ${out.years.length} years, ${out.instants.length} instants, ${out.pages.length} Delta pages`);
