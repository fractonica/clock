import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createFormatter } from '../src/core/format.js';
import {
  DAY,
  YEAR,
  MIN_SPAN,
  limitsFor,
  makeScale,
  clampWindow,
  zoomAtFraction,
  panWindow,
  fitWindow,
  centreOn,
  presetSpan,
  activePreset,
  interpolateWindow,
  easeOutCubic,
  computeLayout,
  stageHeight,
  metrics,
  regionAt,
  formatCycleLength,
  cycleName,
  eclipseLabelStride,
  nearestWithin,
  lastStartAtOrBefore,
  roundMs,
  validLevel,
  stepLevel,
  hitTest,
  STEPS,
  stepById,
  pickStep,
  minorStepOf,
  contextUnitOf,
  offsetSegments,
  alignedTicks,
  generateTicks,
  generateContext,
  civilSpans,
  percentThrough,
  rowReadout,
  depthWords,
  depthHeadVariants,
  fitTitle,
  turnoverTip,
  selectedDepthSentence,
  LANE_SELECT_HINT,
} from '../src/ui/timeline/helpers.js';
import { createData } from '../src/ui/timeline/data.js';

const model = createModel();
const lim = limitsFor(model.tMin, model.tMax);
const berlin = createFormatter(() => 'Europe/Berlin');
const utc = createFormatter(() => 'UTC');
const kolkata = createFormatter(() => 'Asia/Kolkata');
const iso = (t) => new Date(t * 1000).toISOString();
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);

// ---- window maths -----------------------------------------------------------------------------
test('limits: catalogue plus a margin; span limits', () => {
  assert.ok(lim.d0 < model.tMin && lim.d1 > model.tMax);
  near(lim.maxSpan, lim.d1 - lim.d0, 1e-3);
  assert.equal(lim.minSpan, MIN_SPAN);
  const w = clampWindow({ c: 0, span: 1e12 }, lim);
  assert.equal(w.span, lim.maxSpan);
  assert.ok(w.c - w.span / 2 >= lim.d0 - 1e-3 && w.c + w.span / 2 <= lim.d1 + 1e-3);
  assert.equal(clampWindow({ c: 1.79e9, span: 0.01 }, lim).span, MIN_SPAN);
  // window never leaves the limits
  const edge = clampWindow({ c: lim.d1 + 1e9, span: 1000 }, lim);
  near(edge.c + edge.span / 2, lim.d1, 1e-3);
});

test('makeScale: time <-> x round trip, exact at millisecond scale far from the epoch', () => {
  const win = { c: 1791460800.123, span: 2 };
  const sc = makeScale(win, 92, 640);
  near(sc.toX(win.c), 92 + 320, 1e-9);
  near(sc.toX(win.c - 1), 92, 1e-6);
  near(sc.toX(win.c + 1), 92 + 640, 1e-6);
  near(sc.k, 320, 1e-9);
  for (const dt of [-0.9, -0.1234, 0, 0.001, 0.5, 0.999]) {
    const t = win.c + dt;
    near(sc.toT(sc.toX(t)), t, 1e-7, `dt ${dt}`);
    // one millisecond is 0.32 px: neighbouring ms stay distinguishable at 1.8e9 s
    near(sc.toX(t + 0.001) - sc.toX(t), 0.32, 1e-3);
  }
  // a catalogue-wide window at the other end of the range
  const all = makeScale({ c: (model.tMin + model.tMax) / 2, span: model.tMax - model.tMin }, 0, 1000);
  near(all.toX(model.tMin), 0, 1e-6);
  near(all.toX(model.tMax), 1000, 1e-6);
  assert.equal(all.frac(-50), 0);
  assert.equal(all.frac(5000), 1);
  assert.equal(sc.t1 - sc.t0, 2);
});

test('zoomAtFraction keeps the anchored time under the pointer', () => {
  const win = { c: 1.79e9, span: 10 * DAY };
  for (const frac of [0, 0.25, 0.5, 0.9, 1]) {
    for (const f of [0.5, 0.8, 1.25, 4]) {
      const p = win.c - win.span / 2 + frac * win.span;
      const z = zoomAtFraction(win, f, frac, lim);
      near(z.span, win.span * f, 1e-6);
      near(z.c - z.span / 2 + frac * z.span, p, 1e-3, `frac ${frac} factor ${f}`);
    }
  }
  // clamps at the zoom limits
  assert.equal(zoomAtFraction({ c: 1.79e9, span: 3 }, 0.1, 0.5, lim).span, MIN_SPAN);
  assert.equal(zoomAtFraction({ c: 1.79e9, span: lim.maxSpan }, 10, 0.5, lim).span, lim.maxSpan);
});

test('pan, centre, fit and presets', () => {
  const win = { c: 1.79e9, span: DAY };
  near(panWindow(win, 3600, lim).c, win.c + 3600, 1e-6);
  near(centreOn(win, 1.8e9, lim).c, 1.8e9, 1e-6);
  const f = fitWindow(1000000, 1001000, lim, 0.1);
  near(f.c, 1000500, 1e-6);
  near(f.span, 1200, 1e-6);
  assert.equal(presetSpan('day', lim), DAY);
  assert.equal(presetSpan('week', lim), 7 * DAY);
  assert.equal(presetSpan('all', lim), lim.maxSpan);
  assert.equal(presetSpan('century', lim), 100 * YEAR);
  assert.equal(activePreset(DAY * 1.05, lim), 'day');
  assert.equal(activePreset(lim.maxSpan, lim), 'all');
  assert.equal(activePreset(3 * DAY, lim), null);
});

test('interpolateWindow: endpoints, and a zoom keeps its fixed point still', () => {
  const a = { c: 1.79e9, span: 10 * DAY };
  const b = { c: 1.79e9 + 2 * DAY, span: 1 * DAY };
  const u0 = interpolateWindow(a, b, 0);
  const u1 = interpolateWindow(a, b, 1);
  near(u0.c, a.c, 1e-3);
  near(u0.span, a.span, 1e-6);
  near(u1.c, b.c, 1e-2);
  near(u1.span, b.span, 1e-6);
  // the screen-stationary time p (shared fraction in both windows) stays at that fraction all the way
  const p = (b.c * a.span - a.c * b.span) / (a.span - b.span);
  const frac = (p - (a.c - a.span / 2)) / a.span;
  for (const u of [0.2, 0.5, 0.8]) {
    const w = interpolateWindow(a, b, u);
    near(w.c - w.span / 2 + frac * w.span, p, 1e-2);
  }
  // pure pan (equal spans) is linear
  const pan = interpolateWindow({ c: 0, span: 100 }, { c: 50, span: 100 }, 0.5);
  near(pan.c, 25, 1e-9);
  // easing is monotonic and hits the ends
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.5);
});

// ---- layout -----------------------------------------------------------------------------------
test('layout: rows are stacked without overlap and fit the height', () => {
  for (const [w, lanes] of [[1200, 10], [390, 10], [1400, 14], [800, 1]]) {
    const m = metrics(w);
    const h = stageHeight({ lanes, width: w, viewportH: 900 });
    const L = computeLayout({ width: w, height: h, lanes });
    assert.ok(L.overview.y + L.overview.h <= L.axis.y);
    assert.ok(L.axis.y + L.axis.h <= L.lanesY);
    assert.equal(L.eclipse.y, L.lanesY + L.laneH * lanes);
    assert.ok(L.bottom <= h, `${L.bottom} <= ${h}`);
    assert.ok(L.laneH >= m.minLane && L.laneH <= m.maxLane);
    assert.ok(L.px1 > L.px0 + 100 || w < 200);
    assert.equal(L.compact, w < 560);
  }
  // taller viewport -> taller lanes (up to the cap), never below the minimum
  assert.ok(stageHeight({ lanes: 10, width: 1200, viewportH: 1400 }) >= stageHeight({ lanes: 10, width: 1200, viewportH: 700 }));
  const tiny = stageHeight({ lanes: 14, width: 1200, viewportH: 300 });
  assert.equal(tiny, metrics(1200).fixed + 14 * metrics(1200).minLane);
});

test('regionAt maps points to the canvas rows', () => {
  const L = computeLayout({ width: 1000, height: stageHeight({ lanes: 10, width: 1000, viewportH: 900 }), lanes: 10 });
  assert.equal(regionAt(L, 300, L.overview.y + 3).kind, 'overview');
  assert.equal(regionAt(L, 300, L.axis.y + 3).kind, 'axis');
  assert.deepEqual(regionAt(L, 300, L.lanesY + L.laneH * 3 + 1), { kind: 'lane', lane: 3, gutter: false });
  assert.equal(regionAt(L, 10, L.lanesY + 1).gutter, true);
  assert.equal(regionAt(L, 300, L.eclipse.y + 1).kind, 'eclipse');
  assert.equal(regionAt(L, 300, L.bottom + 20).kind, 'none');
});

// ---- small formatters ------------------------------------------------------------------------------
test('formatCycleLength / cycleName', () => {
  const want = ['72.1 y', '14.4 y', '1.11 y', '81.1 d', '16.2 d', '2.32 d', '5.05 h', '33.7 min', '8.42 min', '1.68 min', '7.77 s', '1.55 s', '311 ms', '44.4 ms'];
  const got = [];
  for (let L = 0; L < 14; L++) got.push(formatCycleLength(model.levelInfo(L).meanSeconds));
  // the mean over the whole catalogue differs slightly from the 2010-2028 interval used in SPEC §3.3
  for (let i = 0; i < want.length; i++) assert.equal(got[i].split(' ')[1], want[i].split(' ')[1], `${i}: ${got[i]} vs ${want[i]}`);
  near(parseFloat(got[0]), 72.1, 0.3);
  near(parseFloat(got[4]), 16.2, 0.1);
  assert.equal(cycleName(model.levelInfo(4), 2, 5), 'ε 5 · 3/5');
  assert.equal(cycleName(model.levelInfo(0), 7, 18), 'α 1 · 8/18');
});

test('nearestWithin / lastStartAtOrBefore / eclipseLabelStride', () => {
  const a = [10, 20, 30, 40];
  assert.equal(nearestWithin(a, 21, 2), 1);
  assert.equal(nearestWithin(a, 25, 2), -1);
  assert.equal(nearestWithin(a, 5, 6), 0);
  assert.equal(nearestWithin(a, 100, 5), -1);
  assert.equal(nearestWithin([], 1, 5), -1);
  const b = [{ start: 0 }, { start: 5 }, { start: 9 }];
  assert.equal(lastStartAtOrBefore(b, -1), -1);
  assert.equal(lastStartAtOrBefore(b, 5), 1);
  assert.equal(lastStartAtOrBefore(b, 100), 2);
  assert.equal(eclipseLabelStride(200), 1);
  assert.equal(eclipseLabelStride(40), 2);
  assert.equal(eclipseLabelStride(9), 8);
});

// ---- axis steps --------------------------------------------------------------------------------------------
test('steps are sorted, every one has a minor step that is finer', () => {
  for (let i = 1; i < STEPS.length; i++) assert.ok(STEPS[i].nominal > STEPS[i - 1].nominal, STEPS[i].id);
  for (const s of STEPS) {
    const m = minorStepOf(s);
    if (s.id === 'ms1') assert.equal(m, null);
    else assert.ok(m && m.nominal < s.nominal, `minor of ${s.id}`);
  }
});

test('pickStep: labels get enough room at every zoom, and coarsen monotonically', () => {
  let prev = 0;
  for (let e = 4; e >= -12; e -= 0.25) {
    const px = Math.pow(10, e); // px per second
    const s = pickStep(px);
    assert.ok(s.nominal >= prev, `monotonic at ${px}`);
    prev = s.nominal;
    if (s !== STEPS[STEPS.length - 1]) assert.ok(s.nominal * px >= s.chars * 6.6 + 18 - 1e-9, `${s.id} at ${px}`);
  }
  // typical scales
  const w = 1000; // px
  assert.equal(pickStep(w / (86400 * 1)).u, 'h'); // a day across
  assert.equal(pickStep(w / (365.25 * 86400)).u, 'month'); // a year across
  assert.equal(pickStep(w / (100 * 365.25 * 86400)).u, 'year'); // a century across
  assert.ok(pickStep(w / (1244 * 365.25 * 86400)).nominal >= 100 * YEAR - 1); // the whole catalogue: centuries
  assert.equal(pickStep(w / 2).u, 'ms'); // 2 s across
  assert.equal(pickStep(w / 8).u, 's'); // 8 s across
  assert.equal(contextUnitOf(stepById('h3')), 'day');
  assert.equal(contextUnitOf(stepById('year100')), null);
});

// ---- zone aware ticks ---------------------------------------------------------------------------------------------
test('offsetSegments finds the DST transitions to the second', () => {
  const from = Date.UTC(2026, 2, 28, 12) / 1000;
  const to = Date.UTC(2026, 2, 30, 12) / 1000;
  const segs = offsetSegments(berlin, from, to);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs.map((s) => s.offset), [3600, 7200]);
  assert.equal(iso(segs[0].to), '2026-03-29T01:00:00.000Z');
  const fall = offsetSegments(berlin, Date.UTC(2026, 9, 24, 12) / 1000, Date.UTC(2026, 9, 26, 12) / 1000);
  assert.deepEqual(fall.map((s) => s.offset), [7200, 3600]);
  assert.equal(iso(fall[0].to), '2026-10-25T01:00:00.000Z');
  assert.equal(offsetSegments(utc, from, to).length, 1);
});

test('day ticks are local midnights: 23 h and 25 h days around Berlin DST', () => {
  const day = stepById('day1');
  const spring = generateTicks(day, Date.UTC(2026, 2, 27) / 1000, Date.UTC(2026, 3, 1) / 1000, berlin);
  const gaps = [];
  for (let i = 1; i < spring.length; i++) gaps.push((spring[i].t - spring[i - 1].t) / 3600);
  assert.ok(gaps.includes(23), `spring gaps ${gaps}`);
  assert.ok(gaps.filter((g) => g !== 23).every((g) => g === 24));
  for (const tk of spring) assert.equal(berlin.parts(tk.t).hour, 0);
  const fall = generateTicks(day, Date.UTC(2026, 9, 23) / 1000, Date.UTC(2026, 9, 28) / 1000, berlin);
  const fg = [];
  for (let i = 1; i < fall.length; i++) fg.push((fall[i].t - fall[i - 1].t) / 3600);
  assert.ok(fg.includes(25), `fall gaps ${fg}`);
  assert.ok(fall.every((tk) => berlin.parts(tk.t).minute === 0 && berlin.parts(tk.t).hour === 0));
  // labels carry the weekday and the day of the month
  const sun = spring.find((tk) => berlin.parts(tk.t).day === 29);
  assert.equal(sun.labels[0], 'Sun 29');
  assert.equal(sun.labels[1], '29');
});

test('hour ticks across the DST changes: 23 / 25 ticks, repeated 02:00 on fall-back', () => {
  const h1 = stepById('h1');
  const midnight = (m, d) => berlin.toUnix({ year: 2026, month: m, day: d, hour: 0 });
  const springTicks = generateTicks(h1, midnight(3, 29), midnight(3, 30) - 1, berlin);
  assert.equal(springTicks.length, 23);
  assert.ok(!springTicks.some((tk) => tk.labels[0] === '02:00'), 'no 02:00 on spring-forward day');
  const fallTicks = generateTicks(h1, midnight(10, 25), midnight(10, 26) - 1, berlin);
  assert.equal(fallTicks.length, 25);
  assert.equal(fallTicks.filter((tk) => tk.labels[0] === '02:00').length, 2, '02:00 appears twice');
  // ticks are strictly increasing and exactly an hour apart in absolute time
  for (let i = 1; i < fallTicks.length; i++) assert.equal(fallTicks[i].t - fallTicks[i - 1].t, 3600);
  // the first tick of the day is a major one (midnight) labelled with the date
  assert.equal(fallTicks[0].major, true);
  assert.equal(fallTicks[0].labels[0], 'Sun 25');
});

test('sub-day ticks follow the local wall clock in zones with odd offsets', () => {
  const t0 = Date.UTC(2026, 9, 8, 0) / 1000;
  const ticks = generateTicks(stepById('h1'), t0, t0 + 6 * 3600, kolkata);
  assert.ok(ticks.length >= 6);
  for (const tk of ticks) {
    assert.equal(tk.t % 3600, 1800, 'UTC+05:30: every local hour is at :30 UTC');
    assert.equal(kolkata.parts(tk.t).minute, 0);
  }
  const labels = ticks.map((tk) => tk.labels[0]);
  assert.deepEqual(labels.slice(0, 3), ['06:00', '07:00', '08:00']);
  // 15-minute and 30 s alignment
  for (const tk of generateTicks(stepById('min15'), t0, t0 + 3 * 3600, kolkata)) assert.equal(kolkata.parts(tk.t).minute % 15, 0);
  for (const tk of generateTicks(stepById('s30'), t0, t0 + 300, utc)) assert.equal(tk.t % 30, 0);
});

test('local mean time before standardised zones still aligns (Berlin 1650, +00:53:28)', () => {
  const t0 = Date.UTC(1650, 5, 1) / 1000;
  assert.equal(berlin.parts(t0).offset, 3208);
  const ticks = generateTicks(stepById('h3'), t0, t0 + DAY, berlin);
  assert.deepEqual(ticks.map((tk) => tk.labels[0]), ['03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', 'Thu 2']);
  for (const tk of ticks) assert.equal(berlin.parts(tk.t).second, 0);
  const days = civilSpans('day', t0, t0 + 3 * DAY, berlin);
  assert.ok(days.every((d) => d.t1 - d.t0 === DAY));
});

test('millisecond ticks: aligned, labelled with seconds and ms', () => {
  const t0 = 1791460800 + 0.05;
  const ticks = generateTicks(stepById('ms100'), t0, t0 + 1, utc);
  assert.equal(ticks.length, 10);
  assert.deepEqual(ticks.slice(0, 3).map((tk) => tk.labels[0]), [':00.100', ':00.200', ':00.300']);
  assert.equal(ticks[0].t, 1791460800.1);
  const ones = generateTicks(stepById('ms1'), 1791460800.0005, 1791460800.0105, utc);
  assert.equal(ones.length, 10);
  // whole seconds are major
  const sec = generateTicks(stepById('ms500'), 1791460800 - 0.2, 1791460801.2, utc);
  assert.deepEqual(sec.map((tk) => tk.major), [true, false, true]);
});

test('week ticks are Mondays, month ticks align to the step, century ticks are exact', () => {
  const weeks = generateTicks(stepById('week1'), Date.UTC(2026, 8, 1) / 1000, Date.UTC(2026, 11, 1) / 1000, berlin);
  assert.ok(weeks.length >= 12);
  for (const tk of weeks) {
    const p = berlin.parts(tk.t);
    assert.equal(p.weekday, 1);
    assert.equal(p.hour, 0);
  }
  assert.equal(weeks[0].labels[0].includes('Sep') || weeks[0].labels[0].includes('Aug'), true);

  const quarters = generateTicks(stepById('month3'), Date.UTC(2025, 5, 1) / 1000, Date.UTC(2027, 5, 1) / 1000, utc);
  assert.deepEqual(quarters.map((tk) => utc.parts(tk.t).month), [7, 10, 1, 4, 7, 10, 1, 4]);
  assert.deepEqual(quarters.filter((tk) => tk.major).map((tk) => utc.parts(tk.t).year), [2026, 2027]);
  const months = generateTicks(stepById('month1'), Date.UTC(2026, 0, 1) / 1000, Date.UTC(2026, 11, 31) / 1000, utc);
  assert.equal(months.length, 12);
  assert.deepEqual(months[0].labels, ['January', 'Jan', 'J']);

  // century scale across the whole catalogue (1613–2857): Jan 1 of 1700, 1800, … 2800
  const cent = generateTicks(stepById('year100'), model.tMin, model.tMax, utc);
  assert.deepEqual(cent.map((tk) => tk.labels[0]), ['1700', '1800', '1900', '2000', '2100', '2200', '2300', '2400', '2500', '2600', '2700', '2800']);
  cent.forEach((tk, i) => assert.equal(tk.t, Date.UTC(1700 + 100 * i, 0, 1) / 1000));
  assert.equal(cent.find((tk) => tk.labels[0] === '2000').major, true); // multiple of 1000
  // decades with a 1613-based window are still decade-aligned
  const dec = generateTicks(stepById('year10'), Date.UTC(1999, 0, 1) / 1000, Date.UTC(2041, 0, 1) / 1000, utc);
  assert.deepEqual(dec.map((tk) => tk.labels[0]), ['2000', '2010', '2020', '2030', '2040']);
  // 50 y / 500 y steps
  assert.deepEqual(generateTicks(stepById('year500'), model.tMin, model.tMax, utc).map((tk) => tk.labels[0]), ['2000', '2500']);
});

test('context spans: calendar days (23 / 25 h in Berlin), months, years, minutes', () => {
  const days = civilSpans('day', Date.UTC(2026, 9, 24, 12) / 1000, Date.UTC(2026, 9, 27, 12) / 1000, berlin);
  const len = days.map((s) => (s.t1 - s.t0) / 3600);
  assert.ok(len.includes(25), `${len}`);
  // spans tile the line without gaps
  for (let i = 1; i < days.length; i++) assert.equal(days[i].t0, days[i - 1].t1);
  assert.equal(days.find((s) => s.d === 25).weekday, 0); // Sunday
  assert.deepEqual(days.find((s) => s.d === 25).labels.slice(0, 3), ['Sun 25 Oct 2026 · 25 h', 'Sun 25 Oct 2026', '25 Oct 2026']);
  assert.equal(days.find((s) => s.d === 24).labels[0], 'Sat 24 Oct 2026', 'ordinary days carry no length note');

  const spring = civilSpans('day', Date.UTC(2026, 2, 28) / 1000, Date.UTC(2026, 2, 31) / 1000, berlin);
  assert.ok(spring.map((s) => (s.t1 - s.t0) / 3600).includes(23));
  assert.ok(spring.some((s) => s.labels[0].endsWith(' · 23 h')));

  const months = civilSpans('month', Date.UTC(2026, 0, 15) / 1000, Date.UTC(2026, 3, 15) / 1000, utc);
  assert.deepEqual(months.map((s) => s.m), [1, 2, 3, 4]);
  assert.equal(months[1].t1 - months[1].t0, 28 * DAY);
  assert.equal(months[0].labels[0], 'January 2026');
  const years = civilSpans('year', Date.UTC(2023, 5, 1) / 1000, Date.UTC(2026, 5, 1) / 1000, utc);
  assert.deepEqual(years.map((s) => s.y), [2023, 2024, 2025, 2026]);
  assert.equal(years[1].t1 - years[1].t0, 366 * DAY);
  const dec = civilSpans('decade', Date.UTC(1999, 0, 1) / 1000, Date.UTC(2015, 0, 1) / 1000, utc);
  assert.deepEqual(dec.map((s) => s.labels[0]), ['1990s', '2000s', '2010s']);

  const mins = civilSpans('minute', 1791460800.5, 1791460830, utc);
  assert.ok(mins.length >= 1 && mins.every((s) => s.t1 - s.t0 === 60));
  assert.ok(mins[0].labels[0].endsWith('12:00'));
  // generateContext picks the unit from the step
  assert.ok(generateContext(stepById('h6'), 1791460800, 1791460800 + 2 * DAY, utc).every((s) => s.t1 - s.t0 === DAY));
  assert.deepEqual(generateContext(stepById('year200'), 0, 1e9, utc), []);
});

test('alignedTicks never lands off the step grid', () => {
  for (const zone of ['Europe/Berlin', 'America/New_York', 'Australia/Lord_Howe', 'Asia/Kathmandu']) {
    const api = createFormatter(() => zone);
    const from = Date.UTC(2026, 2, 20) / 1000;
    const ticks = alignedTicks(15 * 60 * 1000, from, from + 20 * DAY, api);
    for (let i = 0; i < ticks.length; i += 37) {
      const p = api.parts(ticks[i].tms / 1000);
      assert.equal(p.minute % 15, 0, `${zone} ${iso(ticks[i].tms / 1000)}`);
      assert.equal(p.second, 0);
    }
    for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].tms > ticks[i - 1].tms);
  }
});

// ---- data layer on the real model ------------------------------------------------------------------------------------------
test('blocksFor: contiguous blocks covering the window, ends clipped to the catalogue', () => {
  const data = createData({ model, fmt: utc });
  const t = 1791460800;
  for (const L of [0, 2, 4, 6, 8]) {
    const mean = model.levelInfo(L).meanSeconds;
    const t0 = t - 6 * mean;
    const t1 = t + 6 * mean;
    const blocks = data.blocksFor(L, t0, t1);
    assert.ok(blocks.length >= 12, `level ${L}: ${blocks.length}`);
    assert.ok(blocks[0].start <= Math.max(t0, model.tMin) && blocks[blocks.length - 1].end >= Math.min(t1, model.tMax));
    for (let i = 1; i < blocks.length; i++) {
      assert.equal(blocks[i].start, blocks[i - 1].end, `contiguous at level ${L}`);
      assert.equal(blocks[i].idx, blocks[i - 1].idx + 1);
    }
    const info = model.levelInfo(L);
    for (const b of blocks.slice(0, 20)) assert.equal(b.local, info.siblings === null ? b.idx : b.idx % info.siblings);
  }
  const alpha = data.blocksFor(0, model.tMin, model.tMax);
  assert.equal(alpha.length, 18);
  assert.equal(alpha[0].start, model.tMin);
  assert.equal(alpha[17].end, model.tMax);
  assert.equal(data.alpha.length, 18);
  // a window left of the catalogue has no blocks, one far right neither
  const overlap = (bs, a, b) => bs.filter((x) => x.end > a && x.start < b);
  assert.equal(overlap(data.blocksFor(3, model.tMin - 1e9, model.tMin - 1e8), model.tMin - 1e9, model.tMin - 1e8).length, 0);
  assert.equal(overlap(data.blocksFor(3, model.tMax + 1e8, model.tMax + 1e9), model.tMax + 1e8, model.tMax + 1e9).length, 0);
});

test('cycleAt matches the exact model reading and survives caching', () => {
  const data = createData({ model, fmt: utc });
  for (const t of [1791460800, 946684800, 2886085800, model.tMin + 5, model.tMax - 5, 1791460800.25]) {
    for (const L of [0, 3, 6, 9, 12]) {
      const c = data.cycleAt(L, t);
      const exact = model.levelAt(t, L);
      assert.ok(c, `cycle at ${t} L${L}`);
      assert.ok(c.start <= t && t < c.end);
      assert.equal(c.idx, exact.cycle, `idx at ${t} L${L}`);
      assert.equal(c.local, exact.local);
      near(c.start, exact.start, 2e-3, `start L${L}`);
      near(c.end, exact.end, 2e-3, `end L${L}`);
      assert.equal(data.cycleAt(L, t), data.cycleAt(L, t), 'cached');
    }
  }
  assert.equal(data.cycleAt(4, model.tMax + 5), null);
  assert.equal(data.cycleAt(4, model.tMin - 5), null);
});

test('quarterTime lies on the exact quarter thresholds of the model', () => {
  const data = createData({ model, fmt: utc });
  const t = 1791460800;
  for (const L of [4, 6, 8]) {
    const cur = model.levelAt(t, L);
    const idx = cur.cycle;
    const q = [1, 2, 3].map((k) => data.quarterTime(L, idx, k));
    assert.ok(q[0] > cur.start && q[0] < q[1] && q[1] < q[2] && q[2] < cur.end);
    // thresholds reported by the model: peak, node, valley, end
    const th = cur.thresholds.filter((e) => ['firstPeak', 'middleNode', 'oppositePeak'].includes(e.name));
    for (let i = 0; i < 3; i++) near(q[i], th[i].time, 2e-3, `L${L} quarter ${i + 1}`);
  }
});

test('ticks / context caches serve a sliding window and rebuild on zone change', () => {
  const dataB = createData({ model, fmt: berlin });
  const step = stepById('h3');
  const a = dataB.ticksFor(step, 1791460800, 1791460800 + DAY);
  assert.strictEqual(dataB.ticksFor(step, 1791460800 + 3600, 1791460800 + DAY + 3600), a, 'sliding inside the padded window reuses the list');
  const b = dataB.ticksFor(step, 1791460800 + 5 * DAY, 1791460800 + 6 * DAY);
  assert.notStrictEqual(a, b);
  assert.ok(dataB.minorFor(step, 1791460800, 1791460800 + DAY).ticks.length > a.length);
  const wk = dataB.weekendsFor(1791460800, 1791460800 + 10 * DAY);
  assert.ok(wk.length >= 2 && wk.every((s) => s.weekday === 0 || s.weekday === 6));
  assert.ok(dataB.endLabel(4, 1, 1791460800, 2026).length > 0);
  assert.equal(dataB.lengthLabel(4).endsWith(' d'), true);
});

// ---- regression tests for the review fixes -----------------------------------------------------------------------------------
test('cycleAt: the closing instant belongs to the last cycle at every level (a time-lapse parks exactly there)', () => {
  const data = createData({ model, fmt: utc });
  for (let L = 0; L < 14; L++) {
    for (const cache of [true, false]) {
      const c = data.cycleAt(L, model.tMax, cache);
      const exact = model.levelAt(model.tMax, L);
      assert.ok(c, `level ${L} at tMax (cache ${cache})`);
      assert.equal(c.idx, exact.cycle, `idx at tMax L${L}`);
      assert.equal(c.local, exact.local);
      assert.equal(c.end, model.tMax);
      assert.ok(c.start < model.tMax, `a real, non-empty cycle at L${L}`);
    }
    const first = data.cycleAt(L, model.tMin);
    assert.equal(first.idx, 0);
    assert.equal(first.start, model.tMin);
    assert.equal(data.cycleAt(L, model.tMax + 0.01), null, `past the end, L${L}`);
    assert.equal(data.cycleAt(L, model.tMin - 0.01), null, `before the start, L${L}`);
  }
});

test('cycleAt agrees with the exact model at every eclipse instant (floats one ulp off the decimal table)', () => {
  const data = createData({ model, fmt: utc });
  let checked = 0;
  for (const e of model.catalogue) {
    // the catalogue's own float, its decimal (what a deep link carries) and a millisecond either side
    for (const t of [e, Math.round(e * 1000) / 1000, e + 0.001, e - 0.001]) {
      if (!model.inRange(t)) continue;
      for (let L = 0; L < 14; L++) {
        const exact = model.levelAt(t, L);
        const c = data.cycleAt(L, Math.round(t * 1000) / 1000, false);
        assert.ok(c, `L${L} at ${t}`);
        if (t === e - 0.001) continue; // 1 ms before the boundary may legitimately round either way for float starts
        assert.equal(c.idx, exact.cycle, `L${L} at ${t}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 2500, `checked ${checked}`);
});

test('cycleAt cache follows the cursor across a boundary and never answers for a cycle that ended', () => {
  const data = createData({ model, fmt: utc });
  const L = 6;
  const c0 = data.cycleAt(L, 1791460800);
  assert.ok(c0.start <= 1791460800 && 1791460800 < c0.end);
  const next = data.cycleAt(L, c0.end + 1);
  assert.equal(next.idx, c0.idx + 1);
  assert.equal(next.start, c0.end, 'contiguous');
  const back = data.cycleAt(L, c0.end - 1);
  assert.equal(back.idx, c0.idx);
  assert.equal(data.cycleAt(L, c0.end).idx, c0.idx + 1, 'a boundary instant belongs to the cycle that starts there');
});

test('blocksFor: no zero-length block at the closing instant, every block has a positive length', () => {
  for (let L = 0; L < 14; L++) {
    const data = createData({ model, fmt: utc });
    const mean = model.levelInfo(L).meanSeconds;
    const blocks = data.blocksFor(L, model.tMax - 3 * mean, model.tMax + 3 * mean);
    assert.ok(blocks.length >= 1);
    for (const b of blocks) assert.ok(b.end > b.start && b.start < model.tMax, `L${L} block ${b.idx}`);
    const last = blocks[blocks.length - 1];
    assert.equal(last.end, model.tMax, `L${L}: the last block ends where the catalogue ends`);
    assert.equal(last.idx, model.levelAt(model.tMax, L).cycle, `L${L}: the last block is the last cycle`);
  }
});

test('blocksFor: a window that slides beyond the padded cache rebuilds it (same blocks as a fresh cache)', () => {
  const data = createData({ model, fmt: utc });
  const L = 4;
  const mean = model.levelInfo(L).meanSeconds;
  const t = 1791460800;
  const wins = [[t, t + 4 * mean], [t + 2 * mean, t + 6 * mean], [t + 400 * mean, t + 404 * mean], [t - 900 * mean, t - 896 * mean], [t, t + 4 * mean]];
  for (const [a, b] of wins) {
    const got = data.blocksFor(L, a, b);
    const fresh = createData({ model, fmt: utc }).blocksFor(L, a, b);
    const inWin = (bs) => bs.filter((x) => x.end > a && x.start < b).map((x) => x.idx);
    assert.deepEqual(inWin(got), inWin(fresh), `window ${a}`);
    assert.ok(got[0].start <= a && got[got.length - 1].end >= b, 'covers the window');
  }
});

test('caches are keyed by zone: a zone change gives new ticks, labels and spans', () => {
  let zone = 'UTC';
  const fmtZ = createFormatter(() => zone);
  const data = createData({ model, fmt: fmtZ });
  const h1 = stepById('h1');
  const t0 = Date.UTC(2026, 9, 8, 0) / 1000;
  const utcTicks = data.ticksFor(h1, t0, t0 + 6 * 3600);
  assert.ok(utcTicks.every((tk) => tk.t % 3600 === 0));
  const endUtc = data.endLabel(6, 100, 1791460800, 2026);
  assert.equal(endUtc, 'Oct 8 12:00');
  const wkUtc = data.weekendsFor(t0, t0 + 14 * DAY);
  zone = 'Asia/Kolkata';
  const kTicks = data.ticksFor(h1, t0, t0 + 6 * 3600);
  assert.notStrictEqual(kTicks, utcTicks);
  assert.ok(kTicks.every((tk) => tk.t % 3600 === 1800), 'UTC+05:30 hours fall on :30 UTC');
  assert.equal(data.endLabel(6, 100, 1791460800, 2026), 'Oct 8 17:30', 'label cache is per zone');
  assert.notDeepEqual(data.weekendsFor(t0, t0 + 14 * DAY).map((s) => s.t0), wkUtc.map((s) => s.t0));
  zone = 'UTC';
  assert.strictEqual(data.ticksFor(h1, t0, t0 + 6 * 3600), utcTicks, 'back to UTC: the UTC list is still cached');
  data.invalidate();
  assert.notStrictEqual(data.ticksFor(h1, t0, t0 + 6 * 3600), utcTicks, 'invalidate() drops the caches');
});

test('endLabel: date for long cycles, date + time for hours, seconds for short ones', () => {
  const data = createData({ model, fmt: utc });
  const end = 1791460800;
  assert.equal(data.endLabel(4, 1, end, 2026), 'Thu 8 Oct 2026'); // ε ≈ 16 d: mean >= 5 d
  assert.equal(data.endLabel(6, 1, end, 2026), 'Oct 8 12:00'); // η ≈ 5 h
  assert.equal(data.endLabel(7, 1, end, 2026), 'Oct 8 12:00:00'); // θ ≈ 34 min: under an hour, so with seconds
  assert.equal(data.endLabel(9, 1, end + 7, 2026), 'Oct 8 12:00:07');
  assert.equal(data.endLabel(6, 2, end, 2025), 'Oct 8 2026 12:00', 'the year appears when it differs from the reference year');
});

test('nearestWithin chooses the closer of two candidates inside the tolerance', () => {
  assert.equal(nearestWithin([10, 20], 14, 10), 0);
  assert.equal(nearestWithin([10, 20], 16, 10), 1);
  assert.equal(nearestWithin([10, 20], 14.9, 10), 0);
  assert.equal(nearestWithin([10, 20], 15.1, 10), 1);
  assert.equal(nearestWithin([10, 20, 30], 29, 5), 2);
  assert.equal(nearestWithin([10, 20], 14, 3), -1);
});

test('roundMs: seconds and milliseconds of a label always agree (never ".1000", never a second off)', () => {
  assert.equal(roundMs(1791460800.9996), 1791460801);
  assert.equal(roundMs(1791460800.9994), 1791460800.999);
  assert.equal(utc.time(roundMs(1791460800.9996), { seconds: true, ms: true }), '12:00:01.000');
  assert.equal(utc.time(roundMs(1791460800.9994), { seconds: true, ms: true }), '12:00:00.999');
  for (let i = 0; i < 4000; i++) {
    const t = 1791460800 + i * 0.000731 + 0.0004;
    const r = roundMs(t);
    assert.ok(Math.abs(r - t) <= 0.0005 + 1e-6);
    assert.match(utc.time(r, { seconds: true, ms: true }), /^\d\d:\d\d:\d\d\.\d{3}$/, `t=${t}`);
    assert.ok(utc.parts(r).ms < 1000);
  }
});

test('validLevel / stepLevel: corrupt settings and the keys stay inside what can be shown', () => {
  for (const bad of [null, undefined, -3, 3.5, '6', NaN, 14, {}, []]) assert.equal(validLevel(bad), 6, String(bad));
  assert.equal(validLevel(0), 0);
  assert.equal(validLevel(13), 13);
  assert.equal(validLevel(NaN, 2), 2);
  const lanes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.equal(stepLevel(6, +1, lanes), 7);
  assert.equal(stepLevel(9, +1, lanes), 9, 'Down stops at the last lane');
  assert.equal(stepLevel(0, -1, lanes), 0, 'Up stops at the first lane');
  assert.equal(stepLevel(12, -1, lanes), 9, 'a selection below the lanes moves to the nearest one');
  assert.equal(stepLevel(12, +1, lanes), 9);
  assert.equal(stepLevel(2, -1, [3, 4, 5]), 3);
  assert.equal(stepLevel(5, +1, []), 5);
});

test('hitTest: exact rectangles for a mouse, a few extra pixels for a finger', () => {
  const regions = [{ x: 100, y: 50, w: 40, h: 14, scrub: true }, { x: 200, y: 50, w: 60, h: 18, onClick() {} }];
  const scrub = (r) => r.scrub;
  const chip = (r) => r.onClick;
  assert.equal(hitTest(regions, 110, 55, scrub), regions[0]);
  assert.equal(hitTest(regions, 110, 70, scrub), null, '6 px below the flag: a miss for the mouse');
  assert.equal(hitTest(regions, 110, 70, scrub, 10), regions[0], '... and a hit for a finger');
  assert.equal(hitTest(regions, 110, 55, chip, 10), null, 'the predicate decides what counts');
  assert.equal(hitTest(regions, 195, 60, chip, 10), regions[1]);
  assert.equal(hitTest([], 1, 1, scrub), null);
});

test('a skipped calendar day (Pacific/Apia, 30 Dec 2011) yields no duplicate tick and no empty day', () => {
  const apia = createFormatter(() => 'Pacific/Apia');
  const from = Date.UTC(2011, 11, 20) / 1000;
  const to = Date.UTC(2012, 0, 10) / 1000;
  for (const id of ['day1', 'week1']) {
    const ticks = generateTicks(stepById(id), from, to, apia);
    for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].t > ticks[i - 1].t, `${id}: strictly increasing at ${i}`);
  }
  const days = generateTicks(stepById('day1'), from, to, apia);
  const thirtyOne = days.find((tk) => apia.parts(tk.t).day === 31 && apia.parts(tk.t).month === 12);
  assert.equal(thirtyOne.labels[0], 'Sat 31', 'the day that really starts there keeps the tick');
  assert.ok(!days.some((tk) => tk.labels[0] === 'Fri 30'));
  const spans = civilSpans('day', from, to, apia);
  assert.ok(spans.every((s) => s.t1 > s.t0), 'no zero-length day');
  for (let i = 1; i < spans.length; i++) assert.equal(spans[i].t0, spans[i - 1].t1, 'still tiles the line');
});

test('day ticks: only the first of a month is major; zone-aware century labels', () => {
  const days = generateTicks(stepById('day1'), Date.UTC(2026, 8, 28) / 1000, Date.UTC(2026, 9, 4) / 1000, utc);
  assert.deepEqual(days.filter((tk) => tk.major).map((tk) => tk.labels[1]), ['1']);
  assert.equal(days.length >= 6, true);
});

test('activePreset: within about 12 % of a preset span, otherwise none', () => {
  assert.equal(activePreset(DAY * 1.11, lim), 'day');
  assert.equal(activePreset(DAY / 1.11, lim), 'day');
  assert.equal(activePreset(DAY * 1.2, lim), null);
  assert.equal(activePreset(7 * DAY * 0.95, lim), 'week');
  assert.equal(activePreset(10 * YEAR * 1.05, lim), 'decade');
});

test('layout: the phone breakpoint, plot margin and region boundaries', () => {
  assert.equal(metrics(559).compact, true);
  assert.equal(metrics(560).compact, false);
  assert.ok(metrics(559).gutter < metrics(560).gutter);
  for (const w of [360, 559, 560, 1440]) {
    const h = stageHeight({ lanes: 10, width: w, viewportH: 900 });
    const L = computeLayout({ width: w, height: h, lanes: 10 });
    assert.equal(L.px1, w - 8, `plot ends 8 px before the right edge at ${w}`);
    assert.equal(L.px0, metrics(w).gutter);
    const e = regionAt(L, L.px0 + 10, L.eclipse.y + L.eclipse.h - 1);
    assert.equal(e.kind, 'eclipse');
    assert.equal(regionAt(L, L.px0 + 10, L.eclipse.y + L.eclipse.h).kind, 'none');
    assert.equal(regionAt(L, L.px0 + 10, L.lanesY + L.laneH * 10 - 1).kind, 'lane');
  }
});

test('interpolateWindow: a pure pan stays linear; the span moves geometrically', () => {
  const a = { c: 1000, span: 100 };
  const b = { c: 2000, span: 100 };
  near(interpolateWindow(a, b, 0.25).c, 1250, 1e-9);
  near(interpolateWindow(a, b, 0.25).span, 100, 1e-9);
  const z = interpolateWindow({ c: 0, span: 100 }, { c: 0, span: 10000 }, 0.5);
  near(z.span, 1000, 1e-6);
});

// ---- hover read-out: the percentage through a cycle is floored -----------------------------------------
const T_A = 1791460800; // SPEC §12 vector A (2026-10-08T12:00Z)

test('percentThrough floors: a running cycle never reads 100 %, and exact values are not floored one low', () => {
  assert.equal(percentThrough(0), 0);
  assert.equal(percentThrough(0.814589), 81, '81.46 % is 81, not 82 (never rounded up)');
  assert.equal(percentThrough(0.815), 81);
  assert.equal(percentThrough(0.4999), 49);
  assert.equal(percentThrough(0.99), 99);
  assert.equal(percentThrough(0.995), 99, 'a rounding read-out would say 100 %');
  assert.equal(percentThrough(0.9996), 99);
  assert.equal(percentThrough(1 - 1e-9), 99);
  assert.equal(percentThrough(1), 99, 'capped like the rings text (99.9 at most): the next cycle shows 0');
  for (const k of [1, 7, 29, 57, 58, 64, 83]) assert.equal(percentThrough(k / 100), k, `${k} %`);
  assert.equal(percentThrough(-0.2), 0);
  assert.equal(percentThrough(NaN), 0);
  // never above the true value, never more than one point below it
  for (let i = 0; i < 3000; i++) {
    const p = (i + 0.37) / 3000;
    const v = percentThrough(p);
    assert.ok(v <= p * 100 + 1e-9 && v > p * 100 - 1 - 1e-9 && v <= 99, String(p));
  }
});

test('hover rows at vector A: eta (81.46 % through) reads 81%, and a cycle 1 ms from its end reads 99%, never 100%', () => {
  const eta = model.levelAt(T_A, 6);
  assert.ok(eta.progress > 0.8145 && eta.progress < 0.8146);
  assert.deepEqual(rowReadout(eta), { count: `${eta.local + 1}/${eta.siblings}`, percent: '81%' });
  const kappa = model.levelAt(T_A, 9);
  const late = model.levelAt(kappa.end - 0.001, 9);
  assert.equal(late.cycle, kappa.cycle, 'still the same cycle, 1 ms before its end');
  assert.ok(late.progress > 0.9999 && late.progress < 1);
  assert.equal(Math.round(late.progress * 100), 100, 'the old read-out rounded up to 100');
  assert.equal(rowReadout(late).percent, '99%');
  // across every lane and many instants a row never exceeds the true progress
  for (const t of [T_A, 946684800.25, 2886085800, 1.5e9, 4e8, model.tMin + 5]) {
    for (let L = 0; L < 14; L++) {
      const r = model.levelAt(t, L);
      const p = Number(rowReadout(r).percent.replace('%', ''));
      assert.ok(p <= r.progress * 100 + 1e-9 && p <= 99, `L${L}@${t}: ${p} vs ${r.progress * 100}`);
    }
  }
});

// ---- wording: user-visible strings say "depth" (1-based), never "level" --------------------------------------
test('depth wording of the lane heads, tooltips and screen-reader text', () => {
  const eps = model.levelInfo(4); // epsilon, depth 5
  assert.equal(depthWords(eps), 'depth 5');
  assert.deepEqual(depthHeadVariants(eps), ['depth 5', '5'], 'the phone gutter falls back to the bare number');
  assert.deepEqual(depthHeadVariants(model.levelInfo(13)), ['depth 14', '14']);
  assert.equal(LANE_SELECT_HINT, 'Click to select this depth in every view.');
  assert.equal(fitTitle(eps), `Zoom to the cycle of the selected depth (${eps.letter}, depth 5) at the cursor (F)`);
  assert.equal(turnoverTip(eps, true), `Next turnover of the selected depth, ${eps.letter} (depth 5). Click to bring it into view.`);
  assert.match(turnoverTip(eps, false), /^The end of the \S+ cycle at the cursor lies to the left of the view\./);
  assert.equal(selectedDepthSentence(eps, 2, 5, 'Sat 17 Oct 2026'), `Selected depth 5 (${eps.letter}): cycle 3 of 5, ends Sat 17 Oct 2026.`);
  for (const text of [depthWords(eps), LANE_SELECT_HINT, fitTitle(eps), turnoverTip(eps, true), turnoverTip(eps, false), selectedDepthSentence(eps, 0, 5, 'x')]) {
    assert.ok(!/\blevels?\b/i.test(text), text);
  }
});

const KEYWORDS = /^(?:const|let|var|of|in|return|typeof|new|case|else|void|delete|await|yield|export|function|import|from|as|instanceof|if|do|throw|async|get|set|static)$/;
/**
 * Occurrences of the word "level" in the strings of a source text: identifiers never contain a space, so a
 * word followed by " level" (after the keywords that may precede an identifier), a string that starts with
 * "Level" or "level's" can only be prose.
 */
function levelWordHits(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\w'"`])\/\/.*$/gm, '$1');
  const hits = [];
  for (const m of code.matchAll(/\b([A-Za-z][\w$]*)\s+levels?\b/g)) if (!KEYWORDS.test(m[1])) hits.push(m[0]);
  for (const m of code.matchAll(/['"`>]\s*Levels?\b/g)) hits.push(m[0]);
  for (const m of code.matchAll(/\blevels?['\u2019]s\b/gi)) hits.push(m[0]);
  return hits;
}
const sourceOf = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the wording scan itself: it sees prose "level" but not identifiers', () => {
  assert.deepEqual(levelWordHits('title="Zoom to the selected level\'s cycle"'), ['selected level', "level's"]);
  assert.deepEqual(levelWordHits("liveEl.textContent = `Selected level ${n}`"), ['Selected level']);
  assert.deepEqual(levelWordHits("<div>Click to select this level in every view.</div>"), ['this level']);
  assert.deepEqual(levelWordHits("const a = 'Level mixer';"), ["'Level"]);
  assert.deepEqual(levelWordHits('for (const level of levels) { let level = 1; return level; } // the level here\n/* a level */'), []);
  assert.deepEqual(levelWordHits('const levelInfo = model.levelInfo(selectedLevel); x.level(levelsFor(d)); if (patch && "selectedLevel" in patch) a.levels.push(1)'), []);
});

test('no user-visible string of the timeline says "level"', () => {
  const dir = '../src/ui/timeline/';
  const files = ['../src/ui/timeline.js', '../src/styles/timeline.css', ...readdirSync(new URL(dir, import.meta.url)).map((f) => dir + f)];
  for (const f of files) assert.deepEqual(levelWordHits(sourceOf(f)), [], f);
});
