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
import { createPure } from '../src/core/pure.js';
import { createRuler } from '../src/ui/timeline/ruler.js';
import { createWords, nth } from '../src/ui/timeline/words.js';
import { pureTipHTML } from '../src/ui/timeline/tips.js';
import { RULES } from '../tools/pure-scan.mjs';

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



// =====================================================================================================
// Pure mode: the ruler of Fractonica units, its wording and tooltips (docs/design/80-pure.md)
//
// Notation (src/core/pure.js): X#n is an ordinal, 1-based (ζ½#5, α#6); nX is a count of whole units gone by,
// 0-based (the ruler tick "9η", the clock "0η 29ι 21λ"); "η 7" is only a depth chip.
// =====================================================================================================
const pure = createPure(model, { now: () => T_A });
const ruler = createRuler({ model, pure });
const words = createWords({ model, pure, ruler });
const lcg = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const randomInstants = (n, seed = 7) => {
  const r = lcg(seed);
  return Array.from({ length: n }, () => model.tMin + 1 + r() * (model.tMax - model.tMin - 2));
};
/** Hard rules of the leak scanner (tools/pure-scan.mjs): nothing Gregorian, Earth-unit or percentage. */
const hardLeaks = (text) => RULES.filter(([, re, sev]) => sev === 'hard' && re.test(text)).map(([id]) => id);
const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
/** The spelling the ruler used before the notation rule: a unit letter, a space, a number ("η 9", "δ½ 3"), not a count ("4η 34ι"). */
const OLD_SPELLING = /(?<!\d)(?:[ηιλμνξ]|[δεζ]½) \d/;
/** Units per parent cycle (α: the catalogue's α count). */
const parentSize = (u) => (u === 0 ? ruler.alphaCount : ruler.per[u]);

test('pure ruler: the unit ladder and the counts per parent', () => {
  assert.deepEqual(ruler.units.map((u) => u.sym), ['α', 'β', 'γ', 'δ½', 'ε½', 'ζ½', 'η', 'ι', 'λ', 'μ', 'ν', 'ξ']);
  // α is counted over the catalogue, then 5 β, 13 γ, 10 δ½, 5 ε½, 7 ζ½ ; 11 η in a depth-6 cycle, 36 ι in an η, 65 λ in an ι, 5 μ, 5 ν, 7 ξ
  assert.deepEqual(ruler.per, [null, 5, 13, 10, 5, 7, 11, 36, 65, 5, 5, 7]);
  assert.equal(ruler.alphaCount, 18);
  near(ruler.sec[5] / 3600, 27.79, 0.02, 'a ζ½ is about a day and three hours');
  near(ruler.sec[3] / 86400, 40.525, 0.01);
});

test('pure ruler: tokens are ordinals (α β γ δ½ ε½ ζ½, from 1) and counts (η ι λ μ ν ξ, from 0), never "η 9"', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((u) => ruler.tokenText(u, 5)), ['α#5', 'β#5', 'γ#5', 'δ½#5', 'ε½#5', 'ζ½#5']);
  assert.deepEqual([6, 7, 8, 9, 10, 11].map((u) => ruler.tokenText(u, 9)), ['9η', '9ι', '9λ', '9μ', '9ν', '9ξ']);
  // the counter of the unit with global index idx: ordinals add 1, counts do not
  assert.equal(ruler.counterOf(0, 5), 6);
  assert.equal(ruler.counterOf(2, 13), 1, 'the 14th γ is the 1st of the next β');
  assert.equal(ruler.counterOf(6, 11), 0, 'the 12th η is the first of the next ζ cycle: 0 whole η have gone by');
  assert.equal(ruler.counterOf(6, 10), 10);
  // groups are written as pure.stamp writes them: α β γ and η ι λ … side by side, the rest after a middle dot
  const toks = ruler.tokensAtTime(T_A, 0, 11);
  assert.equal(ruler.joinTokens(toks.slice(0, 3)), 'α#6 β#4 γ#9');
  assert.equal(ruler.joinTokens(toks.slice(2, 5)), `γ#9 · δ½#${pure.date(T_A).delta} · ε½#${pure.date(T_A).epsilon}`);
  assert.match(ruler.joinTokens(toks.slice(5, 9)), /^ζ½#\d · \d+η \d+ι \d+λ$/);
  assert.doesNotMatch(ruler.stampText(T_A, 11), OLD_SPELLING, 'no letter-then-number counters any more');
});

test('pure ruler: addresses are exactly the pure stamp, counters are exactly the pure clock and date', () => {
  const upTo = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'iota', 'lambda'];
  for (const t of randomInstants(1500)) {
    upTo.forEach((name, i) => assert.equal(ruler.stampText(t, i), pure.stamp(t, name), `${name} @${t}`));
    const c = pure.clock(t);
    const d = pure.date(t);
    const toks = ruler.tokensAtTime(t, 0, 8);
    assert.deepEqual(toks.slice(0, 6).map((x) => x.c), [d.alpha, d.beta, d.gamma, d.delta, d.epsilon, d.zeta]);
    assert.deepEqual(toks.slice(6).map((x) => x.c), [c.eta, c.iota, c.lambda]);
  }
  // the finest units continue the same notation: counts of whole units, from 0
  assert.match(ruler.stampText(T_A, 11), / · \d+η \d+ι \d+λ [0-4]μ [0-4]ν [0-6]ξ$/);
  assert.equal(ruler.stampText(model.tMax + 5, 7), '');
  assert.equal(ruler.flagText(model.tMin - 5, 7), '');
  assert.deepEqual(ruler.tokensAtTime(model.tMin - 5), []);
});

test('pure ruler: near a boundary the ruler reads exactly what the header reads (REGRESSION: EPS = 1e-9 of a unit read the next one up to 2.3 s early)', () => {
  // (before: ruler.stampText(β boundary - 3 ms) was "α#7 β#1 γ#1 … ι 35 · λ 64": the coarse counters ahead, the fine ones behind)
  const grid = [[0, 7], [1, 31], [2, 100], [3, 400], [4, 2000], [5, 10000], [6, 50000], [7, 700000], [8, 3000000]];
  for (const [u, k] of grid) {
    const b = ruler.startTime(u, k);
    assert.ok(b !== null);
    for (const d of [0.0004, 0.001, 0.003, 0.02, 0.5, 2.5, 5]) {
      for (const t of [b - d, b + d]) {
        assert.equal(ruler.stampText(t, 8), pure.stamp(t, 'lambda'), `unit ${u} #${k} ${d < 1 ? d * 1000 + ' ms' : d + ' s'} ${t < b ? 'before' : 'after'}`);
        assert.equal(ruler.flagText(t, 7), ruler.stampText(t, 8).split(' · ').at(-1), 'the flag is the tail of the stamp');
      }
    }
  }
  // never a mixed reading: once the β counter has moved on, so has every finer counter
  const b = ruler.startTime(1, 30);
  const before = ruler.tokensAtTime(b - 0.003, 0, 8).map((x) => x.c);
  const after = ruler.tokensAtTime(b + 0.003, 0, 8).map((x) => x.c);
  assert.deepEqual(after.slice(3), [1, 1, 1, 0, 0, 0], 'a new β begins at δ½ 1, ε½ 1, ζ½ 1 and 0 whole η, ι, λ');
  assert.deepEqual(before.slice(3), [10, 5, 7, 10, 35, 64], 'and 3 ms before it everything is on its last');
  // the position-based reader has an absolute tolerance too: 1e-9 Saros is 0.6 s, not "a unit of α"
  assert.equal(ruler.indexAtPos(0, 12 - 1e-9), 2);
  assert.equal(ruler.indexAtPos(0, 12), 3);
  assert.equal(ruler.indexAtPos(0, 12 - 1e-14), 3, 'float noise of a position is absorbed');
  assert.equal(ruler.indexAtPos(1, 4 - 1e-9), 4);
  assert.equal(ruler.indexAtPos(1, 4), 5);
});

test('pure ruler: the three-unit flag centres on the tick unit', () => {
  assert.equal(ruler.flagText(T_A, 7), ruler.chainAtTime(T_A, 6, 8));
  assert.equal(ruler.flagText(T_A, 0), ruler.chainAtTime(T_A, 0, 2), 'α has no coarser neighbour');
  assert.equal(ruler.flagText(T_A, 11), ruler.chainAtTime(T_A, 9, 11), 'ξ has no finer neighbour');
  assert.match(ruler.flagText(T_A, 7), /^\d+η \d+ι \d+λ$/);
  assert.match(ruler.flagText(T_A, 5), /^ε½#\d · ζ½#\d · \d+η$/);
  assert.match(ruler.flagText(T_A, 3), /^γ#9 · δ½#\d+ · ε½#\d$/);
  assert.match(ruler.flagText(T_A, 1), /^α#6 β#4 γ#9$/, 'α β γ stand side by side, like in the pure stamp');
  for (let u = 0; u < 12; u++) assert.ok(ruler.flagText(T_A, u).split(' · ').length <= 3 && ruler.flagText(T_A, u).length <= 24, `flag ${u}: ${ruler.flagText(T_A, u)}`);
});

test('pure ruler: steps ascend, a multiple fits twice in its parent, minors are finer, no hole in the ladder', () => {
  const S = ruler.STEPS;
  assert.equal(new Set(S.map((s) => s.id)).size, S.length);
  for (let i = 1; i < S.length; i++) {
    assert.ok(S[i].nominal > S[i - 1].nominal, S[i].id);
    // consecutive steps are at most 2.6 apart: that is what keeps 4 to 12 labels on the plot at every zoom
    // (ξ itself is never a labelled step: 2 s across is the narrowest window)
    if (S[i - 1].id !== 'xi') assert.ok(S[i].nominal / S[i - 1].nominal <= 2.61, `${S[i - 1].id} → ${S[i].id}: ×${(S[i].nominal / S[i - 1].nominal).toFixed(2)}`);
  }
  for (const s of S) {
    assert.ok(s.pure && s.chars > 0 && s.charsShort > 0 && s.charsShort <= s.chars);
    assert.equal(s.ctx, s.u - 1, `${s.id}: the context row is the next coarser unit`);
    // m need not divide the count (13 γ make a β): it must fit twice, so a parent has a labelled tick besides its start
    if (s.m > 1) assert.ok(2 * s.m <= parentSize(s.u), `${s.id}: 2·${s.m} <= ${parentSize(s.u)}`);
    const m = ruler.minorStepOf(s);
    if (s.id === 'xi') assert.equal(m, null);
    else {
      assert.ok(m && m.nominal < s.nominal, `minor of ${s.id}`);
      if (s.m > 1) assert.ok(m.u === s.u && s.m % m.m === 0, `${s.id}: its minor ${m.id} is a divisor, so its ticks include the labelled ones`);
    }
  }
  assert.equal(ruler.stepById('iota×6').m, 6);
  assert.equal(ruler.stepById('nope'), null);
  assert.ok(ruler.stepById('gamma×2') && ruler.stepById('gamma×3') && ruler.stepById('gamma×6'), 'γ has multiples');
  assert.ok(ruler.stepById('beta×2') && ruler.stepById('epsilon-half×2') && ruler.stepById('zeta-half×3'));
  assert.equal(ruler.stepById('epsilon-half×3'), null, '3 does not fit twice in 5');
  assert.equal(ruler.stepById('beta×3'), null, '3 does not fit twice in 5');
});

test('pure ruler: pickStep leaves room, never shows more than 12 labels, and coarsens monotonically', () => {
  for (const plotW of [296, 520, 700, 1250, 1820]) {
    let prev = 0;
    for (let e = 3; e >= -13; e -= 0.25) {
      const px = Math.pow(10, e);
      const s = ruler.pickStep(px, plotW);
      assert.ok(s.nominal >= prev, `monotonic at ${px} (${plotW} px)`);
      prev = s.nominal;
      if (s !== ruler.STEPS[ruler.STEPS.length - 1]) {
        assert.ok(s.nominal * px >= plotW / 12 - 1e-9, `${s.id} at ${px}: at most 12 labels across ${plotW} px`);
        assert.ok(s.nominal * px >= (plotW < 520 ? s.charsShort : s.chars) * 6.6, `${s.id} at ${px}: a label fits between two ticks`);
      }
    }
  }
  // typical zooms across 1000 px
  assert.equal(ruler.pickStep(1000 / ruler.sec[6], 1000).u, 7, 'an η-wide window is labelled in ι');
  assert.equal(ruler.pickStep(1000 / (3 * ruler.sec[5]), 1000).u, 6, 'three ζ½ across: labelled in η');
  assert.equal(ruler.pickStep(1000 / (model.tMax - model.tMin), 1000).id, 'alpha×2', 'the whole catalogue across 1000 px: 8 labels, not 18');
  assert.equal(ruler.pickStep(1000 / 2, 1000).u, 10, 'the narrowest window (2 s) is labelled in ν');
});

test('pure ruler: every zoom shows between 4 and 12 labelled ticks (REGRESSION: one label around the β zoom)', () => {
  const cat = model.tMax - model.tMin;
  const widths = [1820, 1250, 700];
  const tally = new Map();
  for (const plotW of widths) {
    for (let e = Math.log10(lim.minSpan); e <= Math.log10(lim.maxSpan); e += 0.05) {
      const span = Math.pow(10, e);
      if (span >= cat) continue; // larger than the catalogue: only the part inside it has ticks
      const lo = model.tMin + span / 2;
      const hi = model.tMax - span / 2;
      for (const c of [lo + 1, (lo + hi) / 2, lo + 0.37 * (hi - lo), hi - 1]) {
        const step = ruler.pickStep(plotW / span, plotW);
        const n = ruler.ticksIn(step, c - span / 2, c + span / 2).length;
        assert.ok(n >= 4 && n <= 13, `${plotW} px, window ${span.toExponential(2)} s at ${c.toExponential(3)}: ${n} ticks of ${step.id}`);
        tally.set(step.id, (tally.get(step.id) ?? 0) + 1);
      }
    }
  }
  // the β zoom itself, the case that read one label: γ multiples carry it now
  const beta = ruler.presetSpan('u:beta', lim, T_A);
  const step = ruler.pickStep(1250 / beta, 1250);
  assert.equal(step.u, 2, 'at the β preset the ticks are γ');
  const n = ruler.ticksIn(step, T_A - beta / 2, T_A + beta / 2).length;
  assert.ok(n >= 5 && n <= 12, `${n} labelled ticks at β`);
  // and every labelled step of the ladder is used by some zoom (ξ only draws the minor ticks of ν: 2 s is the narrowest window)
  for (const s of ruler.STEPS) if (s.id !== 'xi') assert.ok(tally.has(s.id), `${s.id} is used`);
});

test('pure ruler: ticks sit on the unit boundaries and carry the counters the pure date and clock show there', () => {
  for (const s of ruler.STEPS) {
    const n = parentSize(s.u);
    const span = Math.min(14 * s.nominal, (model.tMax - model.tMin) * 0.9);
    const from = T_A - span / 2;
    const ticks = ruler.ticksIn(s, from, from + span);
    assert.ok(ticks.length >= 4 || s.u === 0, `${s.id}: ${ticks.length} ticks`);
    for (let i = 0; i < ticks.length; i++) {
      const tk = ticks[i];
      const off = tk.idx % n;
      assert.ok(tk.t >= from - 1e-6 && tk.t <= from + span + 1e-6 && tk.t < model.tMax);
      // every parent is counted from its own start: 0, m, 2m … while a full step still fits before it ends
      assert.equal(off % s.m, 0, `${s.id}: only every ${s.m}th unit of a parent`);
      assert.ok(off + s.m <= n, `${s.id}: no stub tick squeezed against the next parent`);
      assert.equal(tk.labels[0], ruler.tokenText(s.u, tk.counter));
      if (s.u < 6) assert.deepEqual(tk.labels, [`${s.sym}#${tk.counter}`, `#${tk.counter}`]);
      else assert.deepEqual(tk.labels, [`${tk.counter}${s.sym}`]);
      if (i) {
        assert.ok(tk.t > ticks[i - 1].t);
        const d = tk.idx - ticks[i - 1].idx;
        if (Math.floor(tk.idx / n) === Math.floor(ticks[i - 1].idx / n)) assert.equal(d, s.m, `${s.id}: consecutive inside a parent`);
        else {
          assert.equal(off, 0, `${s.id}: a new parent starts with a tick`);
          assert.ok(d >= s.m && d < 2 * s.m, `${s.id}: the gap over a parent boundary is ${d}, a step is ${s.m}`);
        }
        // exactly d units apart in position, whatever the eclipse intervals in between
        near(model.positionOf(tk.t) - model.positionOf(ticks[i - 1].t), d * ruler.len[s.u], 1e-9 + 1e-12 * d, `${s.id} spacing`);
      }
      assert.equal(tk.major, s.u === 0 || off === 0);
      // the counter really is what the clock reads just after the boundary (the model rounds to 1 ms)
      if (s.nominal > 0.25) {
        const t = tk.t + 0.001;
        const c = pure.clock(t);
        const d = pure.date(t);
        const want = { 3: d.delta, 4: d.epsilon, 5: d.zeta, 6: c.eta, 7: c.iota, 8: c.lambda }[s.u];
        if (want !== undefined) assert.equal(tk.counter, want, `${s.id} at ${tk.t}`);
        if (s.u === 2) assert.equal(tk.counter, d.gamma);
        if (s.u === 1) assert.equal(tk.counter, d.beta);
        if (s.u === 0) assert.equal(tk.counter, d.alpha);
      }
    }
  }
});

test('pure ruler: ticks coincide with the cycle boundaries the lanes draw (full units) and with the half cycles (δ½ ε½ ζ½)', () => {
  const data = createData({ model, fmt: utc, pure });
  const cases = [['alpha', 0], ['beta', 1], ['gamma', 2], ['eta', 6], ['iota', 8], ['lambda', 10], ['mu', 11], ['nu', 12], ['xi', 13]];
  for (const [id, level] of cases) {
    const step = ruler.stepById(id);
    const mean = model.levelInfo(level).meanSeconds;
    const from = T_A - 5 * mean;
    const to = T_A + 5 * mean;
    const ticks = ruler.ticksIn(step, from, to);
    const lanes = data.blocksFor(level, from, to).filter((b) => b.start >= from && b.start <= to);
    assert.ok(ticks.length >= 8, id);
    assert.deepEqual(ticks.map((x) => x.idx), lanes.map((b) => b.idx), `${id}: the same cycles start at the ticks and in the lane`);
    ticks.forEach((tk, i) => near(tk.t, lanes[i].start, 1e-6, `${id} tick ${i}`));
    // the ordinal of α β γ is the lane's 1-based number; the counts η ι λ … are 0-based, one less than the lane's
    if (level <= 2) ticks.forEach((tk, i) => assert.equal(tk.counter, lanes[i].local + 1));
    else ticks.forEach((tk, i) => assert.equal(tk.counter, lanes[i].idx % ruler.per[ruler.unitIndex(id)], `${id}: the count inside the parent`));
  }
  // half units: every second tick is the start of a cycle of the lane, the ones between are its middle (phase 0.5)
  for (const [id, level] of [['delta-half', 3], ['epsilon-half', 4], ['zeta-half', 5]]) {
    const step = ruler.stepById(id);
    const mean = model.levelInfo(level).meanSeconds;
    const ticks = ruler.ticksIn(step, T_A - 5 * mean, T_A + 5 * mean);
    for (const tk of ticks) {
      const phase = model.levelAt(tk.t + 0.001, level).phase;
      near(phase, tk.idx % 2 === 0 ? 0 : 0.5, 1e-3, `${id} idx ${tk.idx} phase`);
    }
    // spacing is half a cycle in position
    near(ruler.len[step.u] * 2, 4 / model.levelInfo(level).prefixNum, 1e-12);
  }
});

test('pure ruler: whole-catalogue ticks, nothing outside it, labels are the ordinal of the cycle', () => {
  const alpha = ruler.ticksIn(ruler.stepById('alpha'), model.tMin - 1e9, model.tMax + 1e9);
  assert.deepEqual(alpha.map((x) => x.labels[0]), Array.from({ length: 18 }, (_, i) => `α#${i + 1}`));
  assert.equal(alpha[0].t, model.tMin);
  assert.ok(alpha.every((x) => x.major));
  assert.deepEqual(ruler.ticksIn(ruler.stepById('alpha×2'), model.tMin - 1e9, model.tMax + 1e9).map((x) => x.counter), [1, 3, 5, 7, 9, 11, 13, 15, 17]);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('eta'), model.tMax + 100, model.tMax + 1e6), []);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('eta'), model.tMin - 1e6, model.tMin - 100), []);
  // ι ×6 inside an η is labelled 6ι 12ι 18ι 24ι 30ι (the start of the η itself is the previous tick), δ½ ×2 counts 1 3 5 7 9
  const eta = model.levelAt(T_A, 6);
  const six = ruler.ticksIn(ruler.stepById('iota×6'), eta.start + 0.01, eta.end - 0.01);
  assert.deepEqual(six.map((x) => x.labels[0]), ['6ι', '12ι', '18ι', '24ι', '30ι']);
  const g = model.levelAt(T_A, 2);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('delta-half×2'), g.start + 1, g.end - 1).map((x) => x.labels[0]), ['δ½#3', 'δ½#5', 'δ½#7', 'δ½#9']);
  // a multiple that does not divide the count restarts with every parent: γ×2 inside a β is γ#1 γ#3 … γ#11, never γ#13
  const beta = model.levelAt(T_A, 1);
  const g2 = ruler.ticksIn(ruler.stepById('gamma×2'), beta.start, beta.end - 0.01);
  assert.deepEqual(g2.map((x) => x.counter), [1, 3, 5, 7, 9, 11]);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('gamma×6'), beta.start, beta.end - 0.01).map((x) => x.counter), [1, 7]);
  const two = ruler.ticksIn(ruler.stepById('gamma×2'), beta.start, beta.end + 0.5 * (beta.end - beta.start));
  assert.equal(two[6].counter, 1, 'the next β starts with its own γ#1');
  assert.ok(two[6].major && !two[1].major);
  // the last cycle: no tick at the closing instant
  const last = ruler.ticksIn(ruler.stepById('alpha'), model.tMax - 10, model.tMax);
  assert.deepEqual(last, []);
});

test('pure ruler: context spans tile the line and are named by the address of the span', () => {
  for (const s of ruler.STEPS.filter((x) => x.ctx >= 0 && x.m === 1)) {
    const span = 6 * ruler.sec[s.ctx];
    const from = T_A - span / 2;
    const spans = ruler.spansIn(s.ctx, from, from + span);
    assert.ok(spans.length >= 5 && spans.length <= 8, `${s.id}: ${spans.length} spans`);
    for (let i = 1; i < spans.length; i++) {
      assert.equal(spans[i].t0, spans[i - 1].t1, `${s.id}: tiles`);
      assert.equal(spans[i].ord, spans[i - 1].ord + 1);
    }
    for (const sp of spans) {
      const mid = (sp.t0 + sp.t1) / 2;
      // longest label = the whole address down to the unit, shortest = the unit's own token ("#5" for an ordinal)
      assert.equal(sp.labels[0], ruler.stampText(mid, s.ctx), `${s.id} @ ${mid}`);
      const last = ruler.tokensAtTime(mid, s.ctx, s.ctx)[0];
      assert.equal(sp.labels[sp.labels.length - 1], s.ctx < 6 ? `#${last.c}` : last.text);
      for (let j = 1; j < sp.labels.length; j++) assert.ok(sp.labels[j].length < sp.labels[j - 1].length, `${sp.labels.join(' | ')}`);
    }
    const ticks = ruler.ticksIn(s, spans[0].t0, spans[spans.length - 1].t1);
    // (the two floats come from different unit grids: they agree to far better than a pixel, not bit for bit)
    for (const tk of ticks.filter((x) => x.major)) assert.ok(spans.some((x) => Math.abs(x.t0 - tk.t) < 1e-4 || Math.abs(x.t1 - tk.t) < 1e-4), `${s.id}: major tick ${tk.labels[0]} starts a context span`);
  }
  assert.deepEqual(ruler.spansIn(-1, 0, 1e10), []);
  const clipped = ruler.spansIn(0, model.tMin - 1e9, model.tMax + 1e9);
  assert.equal(clipped.length, 18);
  assert.equal(clipped[0].t0, model.tMin);
  assert.equal(clipped[17].t1, model.tMax);
  assert.deepEqual(clipped[5].labels, ['α#6', '#6']);
});

test('pure ruler: windows, spans and countdowns read in ladder units, measured in position', () => {
  const eta = model.levelAt(T_A, 6);
  assert.equal(ruler.spanText(eta.start, eta.end), '1η');
  assert.equal(ruler.spanText(eta.start, eta.end, 1), '1η');
  const zeta = model.levelAt(T_A, 5);
  assert.equal(ruler.spanText(zeta.start, zeta.end), '2ζ½', 'no "2ζ½ 0η": pure.durationPos drops trailing zeros itself');
  assert.equal(ruler.spanText(T_A, T_A), '0ξ');
  // windows that reach outside the catalogue are measured with the mean Saros length
  near(ruler.posExt(model.tMax + model.meanSaros) - ruler.posExt(model.tMax), 1, 1e-9);
  near(ruler.posExt(model.tMin - 2 * model.meanSaros), -2, 1e-9);
  near(ruler.timeExt(ruler.posExt(model.tMax + 1e8)), model.tMax + 1e8, 1e-3);
  near(ruler.timeExt(ruler.posExt(T_A)), T_A, 1e-6);
  assert.equal(ruler.spanText(model.tMin, model.tMax, 1), '17α');
  // relative to a reference instant, exact in position
  assert.equal(ruler.relText(T_A, T_A), 'now');
  assert.equal(ruler.relText(eta.end, eta.start), 'in 1η');
  assert.equal(ruler.relText(eta.start, eta.end), '1η ago');
  assert.match(ruler.relText(T_A + 3372, T_A), /^in 6ι 4\dλ$/);
  assert.equal(ruler.relText(T_A + 5000, T_A), `in ${pure.between(T_A, T_A + 5000)}`, 'the helper alone writes the duration');
  // the window text writes the shared leading part of both addresses once
  const mid = ruler.rangeText(T_A - 3 * 3600, T_A + 10 * 3600, 7);
  assert.match(mid, /^α#6 β#4 γ#9 · δ½#\d+ · ε½#\d · ζ½#\d · \d+η \d+ι → \d+η \d+ι$/);
  const a = ruler.stampText(T_A - 3 * 3600, 7);
  const b = ruler.stampText(T_A + 10 * 3600, 7);
  assert.ok(a.startsWith(mid.split(' → ')[0]), 'the left edge is the head plus its own tail');
  assert.ok(b.endsWith(mid.split(' → ')[1]), 'the right edge keeps its own tail');
  // a window inside one η shares the counter of the η: it is written once, then the finer counters differ
  const inside = ruler.rangeText(eta.start + 600, eta.start + 1500, 7);
  assert.match(inside, /^α#6 β#4 γ#9 · δ½#\d+ · ε½#\d · ζ½#\d · \d+η \d+ι → \d+ι$/);
  assert.equal(ruler.rangeText(model.tMin - 1e6, model.tMax + 1e6, 3), 'the whole catalogue');
  assert.equal(ruler.rangeText(model.tMax + 1e6, model.tMax + 2e6, 3), 'after the catalogue');
  assert.equal(ruler.rangeText(model.tMin - 2e6, model.tMin - 1e6, 3), 'before the catalogue');
  assert.match(ruler.rangeText(model.tMin - 1e6, model.tMin + 1e6, 3), /^before the catalogue → α#1 β#1 γ#1 · δ½#1$/);
  // far apart: nothing in common, every part is written
  assert.match(ruler.rangeText(model.tMin + 10, model.tMax - 10, 2), /^α#1 β#1 γ#1 → α#18 β#\d γ#\d+$/);
});

test('pure ruler: a window one unit across in position reads exactly one unit (REGRESSION: "4β 12γ across" for α)', () => {
  // the audit's positions: before the fix the width came from the length of ONE Saros interval, so a window that
  // reaches over several of them came out a hair short of 1α and read "4β 12γ"
  for (const pos of [0.69, 10.5, 30, 62.1, 68.3]) {
    for (const p of ruler.PRESETS.filter((x) => x.u >= 0)) {
      for (const frac of [0.5, 0.2, 0.9]) {
        const at = model.timeOfPosition(pos);
        const w = ruler.presetWindow(p.id, lim, at, frac);
        const sym = ruler.units[p.u].sym;
        assert.equal(ruler.spanText(w.c - w.span / 2, w.c + w.span / 2), `1${sym}`, `${p.id} at pos ${pos}, anchor at ${frac}`);
        // the anchor keeps its place in the window
        near((at - (w.c - w.span / 2)) / w.span, frac, 1e-3, `${p.id} anchor`);
      }
    }
  }
  const alpha = ruler.presetWindow('u:alpha', lim, model.timeOfPosition(0.69), 0.5);
  assert.equal(ruler.spanText(alpha.c - alpha.span / 2, alpha.c + alpha.span / 2), '1α');
  // the same window panned a little (a time-lapse, follow mode) is a hair short in position: half a pixel of slack reads it as 1α
  const t0 = model.timeOfPosition(30);
  const t1 = model.timeOfPosition(30 + 4 * (1 - 2e-5));
  assert.equal(ruler.spanText(t0, t1), '4β 12γ', 'exactly, it IS a hair short of 1α');
  assert.equal(ruler.spanText(t0, t1, 2, 0.5 / 1000), '1α', 'within half a pixel of a 1000 px plot it is 1α');
  assert.equal(ruler.spanText(t0, t1, 2, 0.5 / 1000 * 0.01), '4β 12γ', 'a real shortfall is not hidden by a tiny slack');
  // 'all' is the whole limit, wherever it is anchored
  const all = ruler.presetWindow('all', lim, T_A, 0.3);
  assert.equal(all.span, lim.maxSpan);
  near((T_A - (all.c - all.span / 2)) / all.span, 0.3, 1e-9);
});

test('pure ruler: presets are one unit across (measured at the cursor) and the active one is recognised', () => {
  assert.deepEqual(ruler.PRESETS.map((p) => p.label), ['λ', 'ι', 'η', 'ζ½', 'ε½', 'δ½', 'γ', 'β', 'α', 'All']);
  assert.equal(new Set(ruler.PRESETS.map((p) => p.id)).size, 10);
  for (const p of ruler.PRESETS.slice(0, -1)) {
    const span = ruler.presetSpan(p.id, lim, T_A);
    near(span / ruler.sec[p.u], 1, 0.06, `${p.id} is about one mean unit`);
    assert.equal(ruler.activePreset(span, lim, T_A), p.id);
    assert.equal(ruler.activePreset(span * 1.1, lim, T_A), p.id);
    assert.equal(ruler.activePreset(span * 1.5, lim, T_A), null);
    // the status line of the window reads exactly one unit
    assert.equal(ruler.spanText(T_A - span / 2, T_A + span / 2, 1), `1${ruler.units[p.u].sym}`, p.id);
    assert.equal(ruler.spanText(T_A - span / 2, T_A + span / 2), `1${ruler.units[p.u].sym}`, p.id);
  }
  assert.equal(ruler.presetSpan('all', lim, T_A), lim.maxSpan);
  assert.equal(ruler.activePreset(lim.maxSpan, lim, T_A), 'all');
  assert.equal(ruler.presetSpan('nope', lim, T_A), lim.maxSpan);
  assert.ok(ruler.presetSpan('u:alpha', lim, model.tMax + 1e9) > 0, 'a window centre outside the catalogue still gives a width');
  // the preset width at the cursor and the window the preset lays out are the same width when centred
  const w = ruler.presetWindow('u:gamma', lim, T_A, 0.5);
  near(w.span, ruler.presetSpan('u:gamma', lim, T_A), 1e-3 * w.span);
});

test('pure ruler: the catalogue map is numbered with the eclipse numbers (the position of that eclipse)', () => {
  const m = ruler.overviewMarks();
  assert.deepEqual(m.map((x) => x.labels[0]), ['#10', '#20', '#30', '#40', '#50', '#60']);
  assert.deepEqual(m.map((x) => x.labels[0]), [10, 20, 30, 40, 50, 60].map((k) => pure.eclipseName(k)));
  assert.equal(m[0].t, model.catalogue[10]);
  // the eclipse at the mark sits at exactly that position
  for (const x of m) near(model.positionOf(x.t), Number(x.labels[0].slice(1)), 1e-9);
});

test('pure wording: cycle lengths in ladder units, names and lane labels', () => {
  assert.deepEqual(Array.from({ length: 14 }, (_, L) => words.cycleLength(L)), ['1α', '1β', '1γ', '2δ½', '2ε½', '2ζ½', '1η', '4ι', '1ι', '13λ', '1λ', '1μ', '1ν', '1ξ']);
  for (let L = 0; L < 14; L++) assert.equal(words.cycleLength(L), pure.cycleLength(L), 'the lane lengths are the helper\'s exact nominal lengths');
  assert.equal(words.gloss(5), 'half of a depth-6 cycle');
  assert.equal(words.gloss(6), 'a depth-7 cycle');
  assert.equal(words.denseMsg(9), 'cycles of 13λ · zoom in');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(nth), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
  // labels of a block, longest first; the banner names what begins when the cycle ends
  const eps = model.levelAt(T_A, 4);
  const lab = (o) => words.blockLabels({ level: 4, local: eps.local, idx: eps.cycle, sib: 5, endsWithCatalogue: false, ...o });
  assert.deepEqual(lab({ wide: true, w: 900 }), [
    'ε 5 · Epsilon Pentafracton (5/5) · ends → ε#1',
    'ε 5 · Epsilon Pentafracton',
    'ε 5 · 5/5',
    'ε#5',
    '5',
  ]);
  assert.deepEqual(lab({ wide: false, w: 130 }), ['ε 5 · 5/5', 'ε#5', '5']);
  assert.deepEqual(lab({ wide: false, w: 20 }), ['5']);
  assert.match(lab({ wide: true, w: 900, endsWithCatalogue: true })[0], /ends with the catalogue$/);
  // eclipses are numbered like the position: eclipse k sits at pos k and is "#k", 0-based, in every label
  assert.equal(words.eclipseLabel(22), '#22');
  assert.equal(words.eclipseLabel(0), '#0');
  assert.equal(words.eclipseLabel(69), '#69');
  for (const k of [0, 1, 22, 68, 69]) assert.equal(words.eclipseLabel(k), pure.eclipseName(k));
  assert.equal(words.eclipseChip(22, true), '#22 ▸');
  assert.equal(words.eclipseChip(20, false), '◂ #20');
  assert.match(words.eclipseChipTip(22, true), /^Next greatest eclipse of Saros 141 \(#22\) – click/);
  assert.equal(words.edgeLabel('start'), 'catalogue starts · pos 0');
  assert.equal(words.edgeLabel('end'), 'catalogue ends · pos 69');
  assert.equal(words.endsChip('ε', 'in 1ε½ 2ζ½', true), 'ε ends in 1ε½ 2ζ½ ▸');
  assert.equal(words.endsChip('ε', 'in 1ε½ 2ζ½', false), '◂ ε ends in 1ε½ 2ζ½');
  assert.deepEqual(words.markerChip('cursor', '3η 17ι 21λ', true), ['cursor 3η 17ι 21λ ▸', 'cursor ▸']);
  assert.deepEqual(words.markerChip('now', '3η 17ι 21λ', false), ['◂ now 3η 17ι 21λ', '◂ now']);
  assert.equal(words.rulerKey(ruler.stepById('iota×6')).bottom, 'ι ×6');
  assert.equal(words.rulerKey(ruler.stepById('iota×6')).top, 'η');
  assert.deepEqual(words.rulerKey(ruler.stepById('alpha')), { top: '', bottom: 'α' });
  const tip = words.rulerTip(ruler.stepById('iota×6'));
  assert.match(tip, /^Each tick starts a ι \(a depth-9 cycle\); every 6th one is labelled\. The row above names the η each one belongs to\./);
  // the one place that explains the notation: counts from 0, ordinals from 1, and where to read more
  assert.match(tip, /A count such as 9η is how many whole η have gone by since the parent cycle began, so it starts at 0; a number such as ζ½#5 names the 5th ζ½ of its parent and starts at 1/);
  assert.match(tip, /Press \? for the glossary\.$/);
  assert.equal(words.presetTitle(ruler.PRESETS[3]), 'Show about one ζ½ across: half of a depth-6 cycle');
  assert.equal(words.presetTitle(ruler.PRESETS[9]), 'Show the whole catalogue');
  assert.match(words.turnoverTip(4, eps.cycle, true, false), /^Next turnover of the selected depth, ε \(depth 5\): Epsilon Pentafracton ends → Epsilon Monofracton begins\./);
  assert.match(words.turnoverTip(4, eps.cycle, false, false), /^The end of the ε cycle at the cursor lies to the left of the view: /);
  assert.match(words.selectedSentence(6, 717214, 3, 11, false), /^Selected depth 7 \(η\): Eta Tetrafracton, cycle 4 of 11, ends → Eta Pentafracton begins\.$/);
  assert.match(words.selectedSentence(0, 17, 17, 18, true), /ends with the catalogue\.$/);
});

test('pure wording: no sentence, label or ruler string contains a Gregorian date, an Earth unit or a percentage', () => {
  const strings = new Set();
  const rulerStrings = new Set(); // what the ruler itself writes: ticks, spans, flags, windows, stamps
  const add = (x, into = strings) => (Array.isArray(x) ? x.forEach((y) => add(y, into)) : (into.add(String(x)), strings.add(String(x))));
  const addRuler = (x) => add(x, rulerStrings);
  for (let L = 0; L < 14; L++) {
    add(words.cycleLength(L));
    add(words.denseMsg(L));
    add(words.laneTip(L, 18));
    add(words.blockLabels({ level: L, local: 0, idx: 0, sib: 5, wide: true, w: 900, endsWithCatalogue: false }));
    add(words.blockLabels({ level: L, local: 1, idx: 18, sib: 5, wide: true, w: 900, endsWithCatalogue: true }));
    add(words.turnoverTip(L, 1, true, false));
    add(words.turnoverTip(L, 1, false, true));
    add(words.selectedSentence(L, 5, 2, 11, false));
  }
  for (const s of ruler.STEPS) {
    add(words.rulerTip(s));
    add(Object.values(words.rulerKey(s)));
    addRuler(ruler.ticksIn(s, T_A - 9 * s.nominal, T_A + 9 * s.nominal).flatMap((x) => x.labels));
    if (s.ctx >= 0) addRuler(ruler.spansIn(s.ctx, T_A - 3 * ruler.sec[s.ctx], T_A + 3 * ruler.sec[s.ctx]).flatMap((x) => x.labels));
    addRuler(ruler.flagText(T_A, s.u));
    addRuler(ruler.rangeText(T_A - 9 * s.nominal, T_A + 9 * s.nominal, s.u));
    addRuler(ruler.spanText(T_A - 9 * s.nominal, T_A + 9 * s.nominal));
    addRuler(ruler.relText(T_A + 5 * s.nominal, T_A));
    addRuler(ruler.relText(T_A - 5 * s.nominal, T_A));
  }
  for (const p of ruler.PRESETS) add([words.presetTitle(p), words.presetLabel(p)]);
  for (const t of randomInstants(60)) {
    addRuler(ruler.stampText(t, 11));
    addRuler(ruler.flagText(t, 7));
    addRuler(ruler.relText(t, T_A));
  }
  add([words.eclipseLabel(21), words.eclipseChip(3, true), words.eclipseChipTip(3, false), words.edgeLabel('start'), words.edgeLabel('end'), words.outsideTitle, words.rangeLabel()]);
  addRuler(ruler.overviewMarks().flatMap((x) => x.labels));
  assert.ok(strings.size > 500, `${strings.size} strings`);
  const bad = [...strings].map((x) => [x, hardLeaks(x)]).filter(([, r]) => r.length);
  assert.deepEqual(bad, []);
  // nothing the ruler writes uses the old "η 9" / "δ½ 3" counter spelling (a letter, a space, a number); the depth chips
  // of the lane blocks ("η 7 · Eta Monofracton") are the one place where a letter and a depth number stand together
  assert.ok(rulerStrings.size > 300);
  assert.deepEqual([...rulerStrings].filter((x) => OLD_SPELLING.test(x)), []);
  assert.ok([...strings].some((x) => /^η 7 · /.test(x)), 'depth chips are kept');
  // and the scan really sees what it should
  assert.deepEqual(hardLeaks('Thu 8 Oct 12:00 for 3 h at 66 %'), ['clock-time', 'month-name', 'weekday', 'earth-unit', 'percent']);
});

/** Environment of the pure tooltips on the real model, with a stub store and theme. */
function tipEnv(extra = {}) {
  const data = createData({ model, fmt: utc, pure });
  const store = { live: false, t: () => T_A, realNow: () => T_A + 90000 };
  const theme = { levelColor: () => '#8cf', TEAL: '#4fd1c5' };
  const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return { model, store, pure, ruler, words, theme, levels, data, step: ruler.stepById('iota'), hoverEclipse: -1, ovTime: (x) => model.tMin + x * 1e6, ...extra };
}

test('pure tooltips: lane heads, ruler key, overview, eclipse lane and the plot answer in Fractonica terms', () => {
  const env = tipEnv();
  const tip = (h) => pureTipHTML(h, env);
  const lane = tip({ gutter: true, kind: 'lane', lane: 4 });
  assert.match(textOf(lane), /^ε · depth 5 5 per δ cycle, each lasting 2ε½\. Every δ cycle splits into 5 of them\. Click to select this depth in every view\.$/);
  assert.match(textOf(tip({ gutter: true, kind: 'lane', lane: 0 })), /One α cycle spans 4 Saros intervals; the catalogue holds 18/);
  assert.equal(tip({ gutter: true, kind: 'lane', lane: 99 }), '');
  assert.match(textOf(tip({ gutter: true, kind: 'axis' })), /^Ruler Each tick starts a ι \(a depth-9 cycle\)/);
  assert.match(textOf(tip({ gutter: true, kind: 'axis' })), /A count such as 9η .* starts at 1, like the lane blocks \(η#10\)\. Press \? for the glossary\.$/);
  assert.match(textOf(tip({ gutter: true, kind: 'eclipse' })), /70 greatest-eclipse instants \(α#1 – α#18\) are the time base of the clock\. They are numbered #0 – #69, like the position\./);
  assert.match(textOf(tip({ gutter: true, kind: 'overview' })), /the numbers are eclipse numbers, like the position \(#10 sits at pos 10\)/);
  const ov = textOf(tip({ gutter: false, kind: 'overview', x: 250 }));
  assert.match(ov, /^α#\d+ β#\d+ γ#\d+ pos \d+\.\d{3} Click to centre/);

  // the plot at vector A, pointer on the ε lane
  const html = tip({ gutter: false, kind: 'lane', lane: 4, inPlot: true, t: T_A, x: 300, y: 200 });
  const text = textOf(html);
  assert.match(text, /^\d+η \d+ι \d+λ \d+μ α#6 β#4 γ#9 · δ½#\d+ · ε½#\d · ζ½#\d pos 22\.9\d{5} · between #22 and #23 vs now 4η 34ι ago vs cursor now/);
  assert.match(text, /ε 5 Epsilon Pentafracton ε#5 · 5\/5 · lasts 2ε½ · ends in \d+ε½( \d+ζ½)? → ε#1 begins/);
  assert.equal((html.match(/class="tl-tip-row/g) || []).length, 10, 'one row per lane');
  assert.equal((html.match(/is-on/g) || []).length, 1);
  // the head reads the instant exactly like the header of the app does (pure.stamp)
  assert.ok(text.startsWith(pure.stamp(T_A, 'lambda').split(' · ').at(-1)), 'clock part');
  assert.ok(text.includes(pure.stamp(T_A, 'zeta')), 'date part');
  // every row carries the glyph pair of that cycle's phase (SPEC §5 odometer of two 2-stroke glyphs), never a percentage
  for (const L of [0, 4, 6, 9]) {
    const o = model.odometerAt(T_A, L, { strokes: 2, digits: 2 });
    assert.ok(html.includes(`aria-label="phase ${o.digits[0]} and ${o.digits[1]} of 256"`), `pair of depth ${L + 1}`);
  }
  assert.ok(!/%/.test(html));
  assert.ok(!/<title>|vector CBT/.test(html), 'the glyph titles are gone from the shared helper, no local workaround');
  assert.equal(hardLeaks(text).length, 0);
  // live: no "vs cursor" line
  env.store.live = true;
  assert.doesNotMatch(textOf(tip({ gutter: false, kind: 'lane', lane: 4, inPlot: true, t: T_A })), /vs cursor/);

  // coarse zoom prints only the date part, fine zoom runs on into μ ν ξ
  env.step = ruler.stepById('alpha');
  assert.match(textOf(tip({ gutter: false, kind: 'lane', lane: 0, inPlot: true, t: T_A })), /^α#6 β#4 γ#9 pos /);
  env.step = ruler.stepById('mu');
  assert.match(textOf(tip({ gutter: false, kind: 'lane', lane: 0, inPlot: true, t: T_A })), /^\d+η \d+ι \d+λ \d+μ \d+ν \d+ξ α#6 /, 'at μ ticks the head runs on to ξ');

  // outside the catalogue
  const out = textOf(tip({ gutter: false, kind: 'lane', lane: 0, inPlot: true, t: model.tMax + 1e7 }));
  assert.equal(out, 'Outside the Saros 141 catalogue The catalogue spans α#1 – α#18; the clock is not extrapolated.');
  assert.equal(tip({ gutter: false, kind: 'lane', lane: 0, inPlot: false, t: null }), '');

  // an eclipse marker is numbered like the position, placed in Saros positions, not dated
  env.hoverEclipse = 21;
  const e = textOf(tip({ gutter: false, kind: 'eclipse', inPlot: true, t: model.catalogue[21] }));
  assert.match(e, /^Eclipse #21 · one of 70 pos 21 · in α#6 β#2 Greatest eclipse of Saros 141 vs now .+ · click to move the cursor here$/);
  env.hoverEclipse = 20;
  assert.match(textOf(tip({ gutter: false, kind: 'eclipse', inPlot: true, t: model.catalogue[20] })), /^Eclipse #20 .* starts α#6/);
  assert.equal(hardLeaks(e).length, 0);
});

test('pure tooltips: the same eclipse has one number (REGRESSION: #23 on the timeline, #22 in the calendar)', () => {
  const env = tipEnv();
  for (const k of [0, 1, 22, 23, 68, 69]) {
    env.hoverEclipse = k;
    const e = textOf(pureTipHTML({ gutter: false, kind: 'eclipse', inPlot: true, t: model.catalogue[k] }, env));
    assert.ok(e.startsWith(`Eclipse ${pure.eclipseName(k)} `), e);
    assert.ok(e.includes(` pos ${k} `), 'the number is the position: eclipse #k sits at pos k');
  }
  // an instant 30 000 s after eclipse 22: the plot tooltip says "between #22 and #23", as the calendar's "after eclipse #22"
  env.hoverEclipse = -1;
  const t = model.catalogue[22] + 30000;
  assert.match(textOf(pureTipHTML({ gutter: false, kind: 'lane', lane: 4, inPlot: true, t }, env)), /pos 22\.0000\d+ · between #22 and #23 /);
  assert.match(textOf(pureTipHTML({ gutter: false, kind: 'lane', lane: 4, inPlot: true, t: model.tMax - 0.5 }, env)), /between #68 and #69 /);
  // the chips and lane labels of the painter use the same helper
  assert.equal(words.eclipseChip(22, false), `◂ ${pure.eclipseName(22)}`);
  assert.equal(words.eclipseLabel(22), pure.eclipseName(22));
});

test('pure tooltips: no hard leak anywhere on a sweep of instants, steps and lanes', () => {
  const env = tipEnv({ store: { live: false, t: () => T_A, realNow: () => 1.7e9 } });
  let n = 0;
  for (const t of [...randomInstants(25), model.tMin + 1, model.tMax - 1, model.tMax + 5, model.tMin - 5]) {
    for (const step of [ruler.stepById('xi'), ruler.stepById('lambda'), ruler.stepById('eta'), ruler.stepById('delta-half'), ruler.stepById('alpha×2')]) {
      env.step = step;
      for (const lane of [0, 4, 9]) {
        const html = pureTipHTML({ gutter: false, kind: 'lane', lane, inPlot: true, t, x: 100, y: 100 }, env);
        assert.deepEqual(hardLeaks(textOf(html)), [], textOf(html));
        n++;
      }
    }
  }
  assert.ok(n > 100);
});

test('pure data layer: ticks, minor ticks and context spans of a pure step are cached and rebuilt on invalidate', () => {
  const data = createData({ model, fmt: utc, pure });
  const step = ruler.stepById('iota×6');
  const a = data.ticksFor(step, T_A, T_A + 20000);
  assert.ok(a.length >= 5 && a.every((tk) => /^\d+ι$/.test(tk.labels[0])));
  assert.strictEqual(data.ticksFor(step, T_A + 100, T_A + 20100), a, 'a slightly moved window reuses the list');
  const minor = data.minorFor(step, T_A, T_A + 20000);
  assert.equal(minor.step.id, 'iota×2');
  assert.ok(minor.ticks.length >= a.length * 2);
  const ctx = data.contextFor(step, T_A, T_A + 20000);
  assert.ok(ctx.length >= 1 && /^\d+η$/.test(ctx[0].labels.at(-1)), ctx[0].labels.join(' | '));
  assert.deepEqual(data.contextFor(ruler.stepById('alpha'), T_A, T_A + 20000), []);
  assert.equal(data.overviewMarks().length, 6);
  assert.notStrictEqual(createData({ model, fmt: utc }).ruler, undefined === 1 ? 0 : data.ruler);
  assert.equal(createData({ model, fmt: utc }).ruler, null, 'without a pure vocabulary there is no ruler');
  assert.deepEqual(createData({ model, fmt: utc }).overviewMarks(), []);
  data.invalidate();
  assert.notStrictEqual(data.ticksFor(step, T_A, T_A + 20000), a);
  // the Gregorian steps still work next to it
  assert.ok(data.ticksFor(stepById('h1'), T_A, T_A + 20000).every((tk) => /^\d\d:00$/.test(tk.labels[0]) || /^[A-Z][a-z]{2} \d+$/.test(tk.labels[0])));
});

test('no dead code: the helpers the shipped modules do not call are gone', () => {
  for (const f of ['../src/ui/timeline/tips.js', '../src/ui/timeline/ruler.js', '../src/ui/timeline/words.js']) {
    const src = sourceOf(f);
    assert.doesNotMatch(src, /\.replace\(\/<title>/, `${f}: no workaround for the glyph titles (pure.pairHTML strips them)`);
    assert.doesNotMatch(src, /trimZeros/, `${f}: durations are never trimmed or reformatted here`);
    assert.doesNotMatch(src, /durationPos\(4 \//, `${f}: lane lengths come from pure.cycleLength`);
  }
  assert.equal(typeof ruler.trimZeros, 'undefined');
  assert.equal(typeof ruler.tokensAt, 'undefined', 'positions and times have their own readers now');
});
