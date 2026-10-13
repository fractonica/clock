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
// Pure mode: the ruler of Fractonica units, its wording and tooltips (SPEC §15, docs/design/80-pure.md revision 3)
//
// The ladder is α β γ δ ε η ι λ ν (index 0..8, depths 1 2 3 4 5 7 9 11 13). Major periods α–δ are said in words
// ("Delta Trifracton", with a quarter word Peak / Node / Valley / End for a stretch or a moment), never with a phase
// pair; the minor units are the Nuclide ordinal ε#n and the counts η (0–76 in the Nuclide), ι (0–35), λ (0–64),
// ν (0–24): the header clock "33η 29ι 21λ". ζ θ κ μ and ξ are depths, not units.
// =====================================================================================================
const pure = createPure(model, { now: () => T_A });
const ruler = createRuler({ model, pure });
const words = createWords({ model, pure, ruler });
const lcg = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const randomInstants = (n, seed = 7) => {
  const r = lcg(seed);
  return Array.from({ length: n }, () => model.tMin + 1 + r() * (model.tMax - model.tMin - 2));
};
/** Hard rules of the leak scanner (tools/pure-scan.mjs): nothing Gregorian, Earth-unit or percentage, no halves, beats, retired names. */
const hardLeaks = (text) => RULES.filter(([, re, sev]) => sev === 'hard' && re.test(text)).map(([id]) => id);
const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
/** The spelling the ruler used before the notation rule: a unit letter, a space, a number ("η 9"), not a count ("4η 34ι"). */
const OLD_SPELLING = /(?<!\d)[ηικλμν] \d/;
/** Units per parent (α: the catalogue's α count). */
const parentSize = (u) => (u === 0 ? ruler.alphaCount : ruler.per[u]);
const SYMS = ['α', 'β', 'γ', 'δ', 'ε', 'η', 'ι', 'λ', 'ν'];
const IDX = Object.fromEntries(SYMS.map((s, i) => [s, i]));
/** The reading of every ladder counter at t, from the pure date and clock. */
function readingAt(t) {
  const d = pure.date(t);
  const c = pure.clock(t);
  return [d.alpha, d.beta, d.gamma, d.delta, d.epsilon, c.eta, c.iota, c.lambda, c.nu];
}

test('pure ruler: the ladder is the four major periods and the minor units one depth apart', () => {
  assert.deepEqual(ruler.units.map((u) => u.sym), SYMS);
  assert.deepEqual(ruler.units.map((u) => u.level), [0, 1, 2, 3, 4, 6, 8, 10, 12], 'below δ every other depth');
  assert.deepEqual(ruler.units.map((u) => !!u.major), [true, true, true, true, false, false, false, false, false]);
  // α over the catalogue, then 5 β, 13 γ, 5 δ, 5 ε; 77 η in a Nuclide, 36 ι in a Helion, 65 λ in a Preon, 25 ν in a Flavon
  assert.deepEqual(ruler.per, [null, 5, 13, 5, 5, 77, 36, 65, 25]);
  assert.equal(ruler.alphaCount, 18);
  assert.equal(ruler.FIRST_COUNT_UNIT, IDX.η, 'α … ε are ordinals, η … ν counts');
  assert.deepEqual([5, 7, 9, 11, 13].map(ruler.unitOfLevel), [-1, -1, -1, -1, -1], 'ζ θ κ μ ξ are depths, not units');
  assert.deepEqual([4, 6, 8, 10, 12].map(ruler.unitOfLevel), [4, 5, 6, 7, 8]);
  for (let i = 1; i < 9; i++) near(ruler.len[i - 1] / ruler.len[i], ruler.per[i], 1e-9, `${SYMS[i - 1]} = ${ruler.per[i]}${SYMS[i]}`);
  near(ruler.sec[IDX.η] / 3600, 5.05, 0.01, 'a Helion is about five hours (never shown)');
  near(ruler.sec[IDX.ν], pure.blinkSeconds(), 1e-12, 'the finest unit is the Blink');
});

test('pure ruler: tokens are ordinals (α β γ δ ε, from 1) and counts (η ι λ ν, from 0); majors have words', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((u) => ruler.tokenText(u, 5)), ['α#5', 'β#5', 'γ#5', 'δ#5', 'ε#5']);
  assert.deepEqual([5, 6, 7, 8].map((u) => ruler.tokenText(u, 9)), ['9η', '9ι', '9λ', '9ν']);
  assert.deepEqual(ruler.tickLabels(IDX.δ, 3), ['Delta Trifracton', 'δ#3', '#3'], 'words first, then letters');
  assert.deepEqual(ruler.tickLabels(IDX.α, 18), ['Alpha Octadecafracton', 'α#18', '#18']);
  assert.deepEqual(ruler.tickLabels(IDX.ε, 2), ['ε#2', '#2'], 'the Nuclide has no fracton name');
  assert.deepEqual(ruler.tickLabels(IDX.η, 33), ['33η']);
  assert.equal(ruler.counterOf(0, 5), 6);
  assert.equal(ruler.counterOf(IDX.γ, 13), 1, 'the 14th γ is the 1st of the next β');
  assert.equal(ruler.counterOf(IDX.η, 77), 0, 'the 78th η is the first of the next Nuclide: 0 whole η have gone by');
  assert.equal(ruler.counterOf(IDX.η, 76), 76);
  assert.equal(ruler.counterOf(IDX.ν, 49), 24);
  // the address is written as pure.stamp writes it: single spaces, letters only
  assert.equal(ruler.joinTokens(ruler.tokensAtTime(T_A, 0, 8)), pure.stamp(T_A, 'nu'));
  assert.equal(ruler.stampText(T_A, IDX.ν), 'α#6 β#4 γ#9 δ#3 ε#5 33η 29ι 21λ 3ν', 'SPEC §15.6 vector A');
  assert.doesNotMatch(ruler.stampText(T_A, IDX.ν), OLD_SPELLING);
});

test('pure ruler: addresses are exactly the pure stamp, counters exactly the pure date and clock', () => {
  const ids = ['delta', 'epsilon', 'eta', 'iota', 'lambda', 'nu'];
  for (const t of randomInstants(1500)) {
    ids.forEach((id) => assert.equal(ruler.stampText(t, ruler.unitIndex(id)), pure.stamp(t, id), `${id} @${t}`));
    assert.deepEqual(ruler.tokensAtTime(t, 0, 8).map((x) => x.c), readingAt(t), `@${t}`);
  }
  assert.equal(ruler.stampText(model.tMax + 5, IDX.ι), '');
  assert.equal(ruler.flagText(model.tMin - 5, IDX.ι), '');
  assert.deepEqual(ruler.tokensAtTime(model.tMin - 5), []);
});

test('pure ruler: near a boundary the ruler reads exactly what the header reads (REGRESSION: EPS = 1e-9 of a unit read the next one up to 2.3 s early)', () => {
  const grid = [[0, 7], [1, 31], [2, 100], [3, 400], [4, 2000], [5, 50000], [6, 700000], [7, 3000000], [8, 80000000]];
  for (const [u, k] of grid) {
    const b = ruler.startTime(u, k);
    assert.ok(b !== null);
    for (const d of [0.0004, 0.001, 0.003, 0.02, 0.5, 2.5, 5]) {
      for (const t of [b - d, b + d]) {
        assert.equal(ruler.stampText(t, IDX.ν), pure.stamp(t, 'nu'), `unit ${u} #${k} ${d < 1 ? d * 1000 + ' ms' : d + ' s'} ${t < b ? 'before' : 'after'}`);
        assert.equal(ruler.flagText(t, IDX.ι), pure.clockText(t), 'the flag at ι ticks is the header clock');
      }
    }
  }
  // never a mixed reading: once the β counter has moved on, so has every finer counter
  const b = ruler.startTime(1, 30);
  const before = ruler.tokensAtTime(b - 0.003, 0, 8).map((x) => x.c);
  const after = ruler.tokensAtTime(b + 0.003, 0, 8).map((x) => x.c);
  assert.deepEqual(after.slice(3), [1, 1, 0, 0, 0, 0], 'a new β begins at δ#1, ε#1 and 0 whole η, ι, λ, ν');
  assert.deepEqual(before.slice(3), [5, 5, 76, 35, 64, 24], 'and 3 ms before it everything is on its last');
  assert.equal(ruler.indexAtPos(0, 12 - 1e-9), 2);
  assert.equal(ruler.indexAtPos(0, 12), 3);
  assert.equal(ruler.indexAtPos(0, 12 - 1e-14), 3, 'float noise of a position is absorbed');
  assert.equal(ruler.indexAtPos(1, 4 - 1e-9), 4);
  assert.equal(ruler.indexAtPos(1, 4), 5);
});

test('pure ruler: the flags are the header clock from the Preon down, the tick unit between its neighbours above', () => {
  const sym = (u) => ruler.flagUnits(u).map((i) => SYMS[i]).join('');
  assert.deepEqual(Array.from({ length: 9 }, (_, u) => sym(u)), ['αβγ', 'αβγ', 'βγδ', 'γδε', 'δεη', 'εηι', 'ηιλ', 'ηιλν', 'ηιλν']);
  assert.equal(ruler.flagText(T_A, IDX.ι), '33η 29ι 21λ');
  assert.equal(ruler.flagText(T_A, IDX.ι), pure.clockText(T_A));
  assert.equal(ruler.flagText(T_A, IDX.ν), pure.clockText(T_A, 'nu'));
  assert.equal(ruler.flagText(T_A, IDX.η), 'ε#5 33η 29ι');
  assert.equal(ruler.flagText(T_A, IDX.ε), 'δ#3 ε#5 33η');
  assert.equal(ruler.flagText(T_A, IDX.δ), 'γ#9 δ#3 ε#5');
  assert.equal(ruler.flagText(T_A, 0), 'α#6 β#4 γ#9');
  assert.deepEqual([IDX.ι, IDX.η, IDX.δ, IDX.ν].map((u) => ruler.below(u, 2)), [IDX.ν, IDX.λ, IDX.η, IDX.ν]);
});

test('pure ruler: steps ascend, a multiple fits twice in its parent, minors are finer, every unit has a step', () => {
  const S = ruler.STEPS;
  assert.equal(new Set(S.map((s) => s.id)).size, S.length);
  for (let i = 1; i < S.length; i++) {
    assert.ok(S[i].nominal > S[i - 1].nominal, S[i].id);
    // consecutive steps are at most 2.6 apart: that is what keeps 4 to 12 labels on the plot at every zoom
    assert.ok(S[i].nominal / S[i - 1].nominal <= 2.61, `${S[i - 1].id} → ${S[i].id}: ×${(S[i].nominal / S[i - 1].nominal).toFixed(2)}`);
  }
  assert.deepEqual([...new Set(S.map((s) => s.sym))].reverse(), SYMS, 'all nine units have a step, nothing else');
  for (const s of S) {
    assert.ok(s.pure && s.chars > 0 && s.charsShort > 0 && s.charsShort <= s.chars);
    assert.equal(s.level, ruler.units[s.u].level);
    assert.equal(s.ctx, s.u - 1, `${s.id}: the context row is the next coarser unit`);
    assert.equal(s.quarters, s.m === 1 && s.u >= 1 && s.u <= IDX.ε, `${s.id}: quarters of a major period above whole ticks`);
    if (s.m > 1) assert.ok(2 * s.m <= parentSize(s.u), `${s.id}: 2·${s.m} <= ${parentSize(s.u)}`);
    const m = ruler.minorStepOf(s);
    assert.ok(m && m.nominal < s.nominal, `minor of ${s.id}`);
    if (s.m > 1) assert.ok(m.u === s.u && s.m % m.m === 0, `${s.id}: its minor ${m.id} is a divisor, so its ticks include the labelled ones`);
  }
  // the minor ticks of a whole minor unit are the grid of the depth between: θ (4ι) under η, ζ (11η) under ε …
  assert.deepEqual(['eta', 'epsilon', 'iota', 'lambda', 'nu'].map((id) => ruler.minorStepOf(ruler.stepById(id)).id), ['iota×4', 'eta×11', 'lambda×13', 'nu×5', 'nu/10']);
  assert.ok(ruler.stepById('gamma×2') && ruler.stepById('gamma×3') && ruler.stepById('gamma×6'), 'γ has multiples');
  assert.ok(ruler.stepById('eta×11') && ruler.stepById('eta×33') && ruler.stepById('iota×18') && ruler.stepById('lambda×26') && ruler.stepById('nu×10'));
  assert.equal(ruler.stepById('epsilon×3'), null, '3 does not fit twice in 5');
  assert.equal(ruler.stepById('zeta'), null, 'ζ is not a unit');
  const tenth = ruler.stepById('nu/10');
  assert.equal(tenth.div, 10);
  near(tenth.nominal * 10, ruler.sec[IDX.ν], 1e-12);
  assert.ok(!S.includes(tenth), 'never a labelled step');
  assert.equal(ruler.minorStepOf(tenth), null);
});

test('pure ruler: pickStep leaves room, never shows more than 12 labels, prefers a whole unit and coarsens monotonically', () => {
  for (const plotW of [296, 520, 700, 1250, 1820]) {
    let prev = 0;
    for (let e = 3; e >= -13; e -= 0.05) {
      const px = Math.pow(10, e);
      const s = ruler.pickStep(px, plotW);
      assert.ok(s.nominal >= prev, `monotonic at ${px} (${plotW} px): ${s.id}`);
      prev = s.nominal;
      if (s !== ruler.STEPS[ruler.STEPS.length - 1]) {
        assert.ok(s.nominal * px >= plotW / 12 - 1e-9, `${s.id} at ${px}: at most 12 labels across ${plotW} px`);
        assert.ok(s.nominal * px >= (plotW < 520 ? s.charsShort : s.chars) * 6.6, `${s.id} at ${px}: a label fits between two ticks`);
      }
    }
  }
  const pick = (span) => ruler.pickStep(1000 / span, 1000).id;
  assert.equal(pick(ruler.sec[IDX.η]), 'iota×4', 'one Helion across: every 4th Preon (the θ grid)');
  assert.equal(pick(ruler.sec[IDX.ι]), 'lambda×13', 'one Preon: the κ grid');
  assert.equal(pick(ruler.sec[IDX.ε]), 'eta×11', 'one Nuclide: the ζ grid, 0η 11η … 66η');
  assert.equal(pick(ruler.sec[IDX.δ]), 'epsilon', 'one Delta: its five Nuclides, not every 33rd Helion');
  assert.equal(pick(ruler.sec[IDX.γ]), 'delta');
  assert.equal(pick(ruler.sec[IDX.α]), 'beta', 'one Alpha: its five Betas, not every 6th Gamma');
  assert.equal(pick(model.tMax - model.tMin), 'alpha×2', 'the whole catalogue: 8 labels, not 18');
  assert.equal(pick(2), 'nu', 'the narrowest window (2 s, six Blinks) is labelled in Blinks');
});

test('pure ruler: every zoom shows between 4 and 12 labelled ticks, and every step is used', () => {
  const cat = model.tMax - model.tMin;
  const tally = new Map();
  for (const plotW of [1820, 1250, 700, 520]) {
    for (let e = Math.log10(lim.minSpan); e <= Math.log10(lim.maxSpan); e += 0.02) {
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
  for (const s of ruler.STEPS) assert.ok(tally.has(s.id), `${s.id} is used`);
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
      assert.equal(off % s.m, 0, `${s.id}: only every ${s.m}th unit of a parent`);
      assert.ok(off + s.m <= n, `${s.id}: no stub tick squeezed against the next parent`);
      assert.deepEqual(tk.labels, ruler.tickLabels(s.u, tk.counter));
      if (i) {
        assert.ok(tk.t > ticks[i - 1].t);
        const d = tk.idx - ticks[i - 1].idx;
        if (Math.floor(tk.idx / n) === Math.floor(ticks[i - 1].idx / n)) assert.equal(d, s.m, `${s.id}: consecutive inside a parent`);
        else {
          assert.equal(off, 0, `${s.id}: a new parent starts with a tick`);
          assert.ok(d >= s.m && d < 2 * s.m, `${s.id}: the gap over a parent boundary is ${d}, a step is ${s.m}`);
        }
        near(model.positionOf(tk.t) - model.positionOf(ticks[i - 1].t), d * ruler.len[s.u], 1e-9 + 1e-12 * d, `${s.id} spacing`);
      }
      assert.equal(tk.major, s.u === 0 || off === 0);
      // the counter really is what the date and the clock read just after the boundary (the model rounds to 1 ms)
      if (s.nominal > 0.25) assert.equal(tk.counter, readingAt(tk.t + 0.001)[s.u], `${s.id} at ${tk.t}`);
    }
  }
});

test('pure ruler: ticks coincide with the cycles the lanes draw, of the units and of the depths between', () => {
  const data = createData({ model, fmt: utc, pure });
  for (const [u, sym] of SYMS.entries()) {
    const step = ruler.stepById(ruler.units[u].id);
    const level = ruler.units[u].level;
    const mean = model.levelInfo(level).meanSeconds;
    const from = T_A - 5 * mean;
    const to = T_A + 5 * mean;
    const ticks = ruler.ticksIn(step, from, to);
    const lanes = data.blocksFor(level, from, to).filter((b) => b.start >= from && b.start <= to);
    assert.ok(ticks.length >= 8, sym);
    assert.deepEqual(ticks.map((x) => x.idx), lanes.map((b) => b.idx), `${sym}: the same cycles start at the ticks and in the lane`);
    ticks.forEach((tk, i) => near(tk.t, lanes[i].start, 1e-6, `${sym} tick ${i}`));
    if (u <= IDX.ε) ticks.forEach((tk, i) => assert.equal(tk.counter, lanes[i].local + 1, `${sym}: the ordinal is the lane's number`));
    else ticks.forEach((tk, i) => assert.equal(tk.counter, lanes[i].idx % ruler.per[u], `${sym}: the count inside the parent`));
  }
  // the depths between: their cycles start on the grids of the multiples, and the lane names them by that count
  for (const [level, id] of [[5, 'eta×11'], [7, 'iota×4'], [9, 'lambda×13'], [11, 'nu×5']]) {
    const mean = model.levelInfo(level).meanSeconds;
    const from = T_A - 6 * mean;
    const to = T_A + 6 * mean;
    const ticks = ruler.ticksIn(ruler.stepById(id), from, to);
    const lanes = data.blocksFor(level, from, to).filter((b) => b.start >= from && b.start <= to);
    assert.equal(ticks.length, lanes.length, id);
    ticks.forEach((tk, i) => {
      near(tk.t, lanes[i].start, 1e-6, `${id} tick ${i}`);
      assert.equal(tk.labels[0], pure.cycleShort(level, lanes[i].idx), `${id}: the tick reads the placing count of the lane's cycle`);
    });
  }
});

test('pure ruler: whole-catalogue ticks, nothing outside it, majors named in words, counts restart with their parent', () => {
  const alpha = ruler.ticksIn(ruler.stepById('alpha'), model.tMin - 1e9, model.tMax + 1e9);
  assert.deepEqual(alpha.map((x) => x.labels[1]), Array.from({ length: 18 }, (_, i) => `α#${i + 1}`));
  assert.deepEqual(alpha.slice(0, 3).map((x) => x.labels[0]), ['Alpha Monofracton', 'Alpha Difracton', 'Alpha Trifracton']);
  assert.equal(alpha[0].t, model.tMin);
  assert.ok(alpha.every((x) => x.major));
  assert.deepEqual(ruler.ticksIn(ruler.stepById('alpha×2'), model.tMin - 1e9, model.tMax + 1e9).map((x) => x.counter), [1, 3, 5, 7, 9, 11, 13, 15, 17]);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('eta'), model.tMax + 100, model.tMax + 1e6), []);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('eta'), model.tMin - 1e6, model.tMin - 100), []);
  // inside one Helion: ι ×2 is 2ι 4ι … 34ι (the start of the η itself is the previous tick), ι ×4 the θ grid
  const eta = model.levelAt(T_A, 6);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('iota×2'), eta.start + 0.01, eta.end - 0.01).map((x) => x.labels[0]), Array.from({ length: 17 }, (_, i) => `${2 * (i + 1)}ι`));
  assert.deepEqual(ruler.ticksIn(ruler.stepById('iota×4'), eta.start + 0.01, eta.end - 0.01).map((x) => x.labels[0]), ['4ι', '8ι', '12ι', '16ι', '20ι', '24ι', '28ι', '32ι']);
  // inside one Nuclide: η ×11 is the ζ grid 11η … 66η, η ×33 the uneven 33η (two fit, not three)
  const eps = model.levelAt(T_A, 4);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('eta×11'), eps.start + 0.01, eps.end - 0.01).map((x) => x.labels[0]), ['11η', '22η', '33η', '44η', '55η', '66η']);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('eta×33'), eps.start + 0.01, eps.end - 0.01).map((x) => x.labels[0]), ['33η']);
  // inside one Flavon: ν ×5 is the μ grid
  const lam = model.levelAt(T_A, 10);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('nu×5'), lam.start + 0.01, lam.end - 0.01).map((x) => x.labels[0]), ['5ν', '10ν', '15ν', '20ν']);
  const g = model.levelAt(T_A, 2);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('delta×2'), g.start + 1, g.end - 1).map((x) => x.labels[0]), ['Delta Trifracton']);
  // a multiple that does not divide the count restarts with every parent: γ×2 inside a β is γ#1 γ#3 … γ#11, never γ#13
  const beta = model.levelAt(T_A, 1);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('gamma×2'), beta.start, beta.end - 0.01).map((x) => x.counter), [1, 3, 5, 7, 9, 11]);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('gamma×3'), beta.start, beta.end - 0.01).map((x) => x.counter), [1, 4, 7, 10]);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('gamma×6'), beta.start, beta.end - 0.01).map((x) => x.counter), [1, 7]);
  const next = ruler.ticksIn(ruler.stepById('gamma×2'), beta.start, beta.end + 0.5 * (beta.end - beta.start));
  assert.equal(next[6].counter, 1, 'the next β starts with its own γ#1');
  assert.ok(next[6].major && !next[1].major);
  assert.deepEqual(ruler.ticksIn(ruler.stepById('alpha'), model.tMax - 10, model.tMax), [], 'no tick at the closing instant');
});

test('pure ruler: the context row names the coarser unit; above whole major ticks it is cut into quarters said in words', () => {
  for (const s of ruler.STEPS.filter((x) => x.ctx >= 0 && x.m === 1)) {
    const span = 6 * ruler.sec[s.ctx];
    const from = T_A - span / 2;
    const spans = ruler.contextIn(s, from, from + span);
    const q = s.quarters ? 4 : 1;
    assert.ok(spans.length >= 5 * q && spans.length <= 8 * q, `${s.id}: ${spans.length} spans`);
    for (let i = 1; i < spans.length; i++) {
      assert.equal(spans[i].t0, spans[i - 1].t1, `${s.id}: tiles`);
      assert.equal(spans[i].ord, spans[i - 1].ord + 1);
    }
    for (const sp of spans) {
      const mid = (sp.t0 + sp.t1) / 2;
      const c = ruler.unitsTo(s.ctx).length - 1;
      const reading = readingAt(mid);
      // the shortest label is the quarter word, the bare ordinal or the count; the address is never wrong
      if (s.quarters) {
        const word = pure.QUARTER_WORDS[sp.ord % 4];
        assert.equal(word, pure.QUARTER_WORDS[pure.quarterAt(mid, ruler.units[s.ctx].level)], `${s.id}: the quarter of the stretch`);
        assert.equal(sp.labels.at(-1), word);
        assert.equal(sp.labels.at(-2), `${ruler.units[s.ctx].sym}#${reading[c]} ${word}`);
        assert.equal(sp.labels.at(-3), `${pure.majorText(mid, ruler.units[s.ctx].level)}`, 'the words and the quarter of the moment');
        const off = Math.abs((((model.positionOf(sp.t0) * model.levelInfo(ruler.units[s.ctx].level).prefixNum) / 4) % 1) - (sp.ord % 4) / 4);
        near(Math.min(off, 1 - off), 0, 1e-6, 'a quarter starts at a quarter threshold');
      } else if (s.ctx <= IDX.ε) assert.equal(sp.labels.at(-1), `#${reading[c]}`);
      else assert.equal(sp.labels.at(-1), `${reading[c]}${SYMS[s.ctx]}`);
      if (s.ctx <= IDX.δ) assert.match(sp.labels[0], /^Alpha \w+fracton( · | (Peak|Node|Valley|End)$|$)/, `${s.id}: the longest label starts with the major periods in words`);
      else assert.match(sp.labels[0], /^Gamma \w+fracton · Delta \w+fracton · ε#\d/, `${s.id}: a minor stretch reads like a short date, from the Gamma`);
      for (let j = 1; j < sp.labels.length; j++) assert.ok(sp.labels[j].length < sp.labels[j - 1].length, `${sp.labels.join(' | ')}`);
      // the letters of a minor stretch are its stamp
      if (s.ctx > IDX.ε) assert.ok(sp.labels.includes(ruler.stampText(mid, s.ctx).split(' ').slice(4).join(' ')), sp.labels.join(' | '));
    }
    const ticks = ruler.ticksIn(s, spans[0].t0, spans[spans.length - 1].t1);
    for (const tk of ticks.filter((x) => x.major)) assert.ok(spans.some((x) => Math.abs(x.t0 - tk.t) < 1e-4 || Math.abs(x.t1 - tk.t) < 1e-4), `${s.id}: major tick ${tk.labels[0]} starts a context span`);
  }
  assert.deepEqual(ruler.spansIn(-1, 0, 1e10), []);
  const clipped = ruler.spansIn(0, model.tMin - 1e9, model.tMax + 1e9);
  assert.equal(clipped.length, 18);
  assert.equal(clipped[0].t0, model.tMin);
  assert.equal(clipped[17].t1, model.tMax);
  assert.deepEqual(clipped[5].labels, ['Alpha Hexafracton', 'α#6', '#6']);
  // one Delta across: the row reads its quarters
  const d = model.levelAt(T_A, 3);
  const quarters = ruler.contextIn(ruler.stepById('epsilon'), d.start + 1, d.end - 1);
  assert.deepEqual(quarters.map((x) => x.labels.at(-3)), ['Delta Trifracton Peak', 'Delta Trifracton Node', 'Delta Trifracton Valley', 'Delta Trifracton End']);
  assert.equal(quarters[1].labels[2], 'Gamma Nonafracton · Delta Trifracton Node');
  assert.equal(ruler.contextIn(ruler.stepById('iota'), T_A - 1, T_A + 1)[0].labels[0], 'Gamma Nonafracton · Delta Trifracton · ε#5 33η', 'the row above ι ticks');
  // a multiple keeps the plain spans of its parent
  assert.match(ruler.contextIn(ruler.stepById('epsilon×2'), d.start + 1, d.end - 1)[0].labels.at(-3), /^Delta \w+fracton$/);
});

test('pure ruler: windows, spans and countdowns read in ladder units, measured in position', () => {
  const eta = model.levelAt(T_A, 6);
  assert.equal(ruler.spanText(eta.start, eta.end), '1η');
  const zeta = model.levelAt(T_A, 5);
  assert.equal(ruler.spanText(zeta.start, zeta.end), '11η', 'ζ is not a unit: 11 Helions');
  const theta = model.levelAt(T_A, 7);
  assert.equal(ruler.spanText(theta.start, theta.end), '4ι');
  const eps = model.levelAt(T_A, 4);
  assert.equal(ruler.spanText(eps.start, eps.end), '1ε');
  assert.equal(ruler.spanText(T_A, T_A), '0ν');
  near(ruler.posExt(model.tMax + model.meanSaros) - ruler.posExt(model.tMax), 1, 1e-9);
  near(ruler.posExt(model.tMin - 2 * model.meanSaros), -2, 1e-9);
  near(ruler.timeExt(ruler.posExt(model.tMax + 1e8)), model.tMax + 1e8, 1e-3);
  near(ruler.timeExt(ruler.posExt(T_A)), T_A, 1e-6);
  assert.equal(ruler.spanText(model.tMin, model.tMax, 1), '17α');
  assert.equal(ruler.relText(T_A, T_A), 'now');
  assert.equal(ruler.relText(eta.end, eta.start), 'in 1η');
  assert.equal(ruler.relText(eta.start, eta.end), '1η ago');
  assert.equal(ruler.relText(T_A + 3372.428, T_A), 'in 6ι 43λ', 'SPEC §15.6: the depth-7 end at vector A');
  assert.equal(ruler.relText(T_A + 90000, T_A), `in ${pure.between(T_A, T_A + 90000)}`, 'the helper alone writes the duration');
  // a window a few Blinks across, and spans below ten Blinks, read as decimal Blinks
  assert.equal(ruler.spanText(T_A, T_A + 2), '6.4ν');
  assert.equal(ruler.spanText(T_A, T_A + 0.05), '0.16ν');
  assert.equal(ruler.spanText(T_A, T_A + 1), '3.2ν');
  assert.equal(ruler.spanText(T_A, T_A + 4), '12ν', 'from ten Blinks on, whole counts');
  assert.equal(ruler.relText(T_A + 0.1, T_A), 'in 0.32ν');
  assert.equal(ruler.relText(T_A - 0.1, T_A), '0.32ν ago');
  assert.equal(ruler.relText(T_A + 0.0004, T_A), 'now', 'within the same millisecond it is now');
  // the window text writes the shared leading part of both addresses once
  const mid = ruler.rangeText(T_A - 3 * 3600, T_A + 10 * 3600, IDX.ι);
  assert.match(mid, /^α#6 β#4 γ#9 δ#3 ε#5 \d+η \d+ι → \d+η \d+ι$/);
  assert.ok(ruler.stampText(T_A - 3 * 3600, IDX.ι).startsWith(mid.split(' → ')[0]));
  assert.ok(ruler.stampText(T_A + 10 * 3600, IDX.ι).endsWith(mid.split(' → ')[1]));
  const inside = ruler.rangeText(eta.start + 600, eta.start + 1500, IDX.ι);
  assert.match(inside, /^α#6 β#4 γ#9 δ#3 ε#5 \d+η \d+ι → \d+ι$/);
  assert.equal(ruler.rangeText(model.tMin - 1e6, model.tMax + 1e6, 3), 'the whole catalogue');
  assert.equal(ruler.rangeText(model.tMax + 1e6, model.tMax + 2e6, 3), 'after the catalogue');
  assert.equal(ruler.rangeText(model.tMin - 2e6, model.tMin - 1e6, 3), 'before the catalogue');
  assert.match(ruler.rangeText(model.tMin - 1e6, model.tMin + 1e6, 3), /^before the catalogue → α#1 β#1 γ#1 δ#1$/);
  assert.match(ruler.rangeText(model.tMin + 10, model.tMax - 10, 2), /^α#1 β#1 γ#1 → α#18 β#\d γ#\d+$/);
});

test('pure ruler: a window one unit across in position reads exactly one unit (REGRESSION: "4β 12γ across" for α)', () => {
  for (const pos of [0.69, 10.5, 30, 62.1, 68.3]) {
    for (const p of ruler.PRESETS.filter((x) => x.u >= 0 && !x.deepest)) {
      for (const frac of [0.5, 0.2, 0.9]) {
        const at = model.timeOfPosition(pos);
        const w = ruler.presetWindow(p.id, lim, at, frac);
        assert.equal(ruler.spanText(w.c - w.span / 2, w.c + w.span / 2), `1${ruler.units[p.u].sym}`, `${p.id} at pos ${pos}, anchor at ${frac}`);
        near((at - (w.c - w.span / 2)) / w.span, frac, 1e-3, `${p.id} anchor`);
      }
    }
  }
  const t0 = model.timeOfPosition(30);
  const t1 = model.timeOfPosition(30 + 4 * (1 - 2e-5));
  assert.equal(ruler.spanText(t0, t1), '4β 12γ', 'exactly, it IS a hair short of 1α');
  assert.equal(ruler.spanText(t0, t1, 2, 0.5 / 1000), '1α', 'within half a pixel of a 1000 px plot it is 1α');
  assert.equal(ruler.spanText(t0, t1, 2, 0.5 / 1000 * 0.01), '4β 12γ', 'a real shortfall is not hidden by a tiny slack');
  const t2 = model.timeOfPosition(30 + 4 * (1 + 2e-5));
  assert.equal(ruler.spanText(t0, t2, 2, 0.5 / 1000), '1α', 'nor a hair too long ("1α 1ε" is below a pixel)');
  const all = ruler.presetWindow('all', lim, T_A, 0.3);
  assert.equal(all.span, lim.maxSpan);
  near((T_A - (all.c - all.span / 2)) / all.span, 0.3, 1e-9);
});

test('pure ruler: presets are the units, one across (measured at the cursor); ν is the deepest zoom', () => {
  assert.deepEqual(ruler.PRESETS.map((p) => p.label), ['ν', 'λ', 'ι', 'η', 'ε', 'δ', 'γ', 'β', 'α', 'All']);
  assert.equal(new Set(ruler.PRESETS.map((p) => p.id)).size, 10);
  assert.deepEqual(ruler.PRESETS.filter((p) => p.deepest).map((p) => p.label), ['ν']);
  for (const p of ruler.PRESETS.slice(0, -1)) {
    const span = ruler.presetSpan(p.id, lim, T_A);
    assert.equal(ruler.activePreset(span, lim, T_A), p.id);
    assert.equal(ruler.activePreset(span * 1.1, lim, T_A), p.id);
    assert.equal(ruler.activePreset(span * 1.5, lim, T_A), null);
    if (p.deepest) {
      assert.equal(span, lim.minSpan, 'a Blink is narrower than the narrowest window');
      assert.equal(ruler.spanText(T_A - span / 2, T_A + span / 2), '6.4ν');
      continue;
    }
    near(span / ruler.sec[p.u], 1, 0.06, `${p.id} is about one mean unit`);
    assert.equal(ruler.spanText(T_A - span / 2, T_A + span / 2), `1${ruler.units[p.u].sym}`, p.id);
  }
  assert.equal(ruler.activePreset(lim.maxSpan, lim, T_A), 'all');
  assert.equal(ruler.presetSpan('nope', lim, T_A), lim.maxSpan);
  const w = ruler.presetWindow('u:gamma', lim, T_A, 0.5);
  near(w.span, ruler.presetSpan('u:gamma', lim, T_A), 1e-3 * w.span);
  const deep = ruler.presetWindow('u:nu', lim, T_A, 0.3);
  assert.equal(deep.span, lim.minSpan);
  near((T_A - (deep.c - deep.span / 2)) / deep.span, 0.3, 1e-6); // (a float time at 1.8e9 s is good to ~2e-7 s of 2 s)
});

test('pure ruler: the deepest zoom (a few Blinks across) keeps exact ticks, tenths of a Blink and decimal spans', () => {
  const span = lim.minSpan;
  for (const c of [T_A, model.tMin + span, model.tMax - span, model.catalogue[22] + 0.1]) {
    const from = c - span / 2;
    const to = c + span / 2;
    for (const plotW of [296, 700, 1820]) {
      const step = ruler.pickStep(plotW / span, plotW);
      assert.equal(step.id, 'nu', `${plotW} px: the Blink`);
      const ticks = ruler.ticksIn(step, from, to);
      assert.ok(ticks.length >= 6 && ticks.length <= 7, `${ticks.length} Blinks across 2 s`);
      assert.ok(ticks.every((tk) => /^\d+ν$/.test(tk.labels[0]) && tk.counter >= 0 && tk.counter < 25));
      for (let i = 1; i < ticks.length; i++) {
        near(model.positionOf(ticks[i].t) - model.positionOf(ticks[i - 1].t), ruler.len[IDX.ν], 1e-12, 'Blink spacing');
        near(ticks[i].t - ticks[i - 1].t, ruler.sec[IDX.ν], 0.05, 'about 0.31 s');
      }
      for (const tk of ticks) {
        const t = tk.t + 0.001;
        if (t >= model.tMax) continue;
        assert.equal(tk.counter, pure.clock(t).nu);
        assert.equal(ruler.flagText(t, IDX.ν).split(' ').at(-1), `${tk.counter}ν`);
      }
    }
    const tenths = ruler.ticksIn(ruler.stepById('nu/10'), from, to);
    assert.ok(tenths.length >= 60 && tenths.length <= 66, `${tenths.length} tenths`);
    for (const b of ruler.ticksIn(ruler.stepById('nu'), from, to)) assert.ok(tenths.some((x) => x.idx % 10 === 0 && Math.abs(x.t - b.t) < 1e-6), `tenth ${b.labels[0]}`);
    for (let i = 1; i < tenths.length; i++) near(tenths[i].t - tenths[i - 1].t, ruler.sec[IDX.ν] / 10, 0.01);
    assert.ok(tenths.every((x) => x.labels.length === 0 && !x.major), 'unlabelled');
  }
  // the context row at that zoom is the Flavon the Blinks are counted in
  const spans = ruler.contextIn(ruler.stepById('nu'), T_A - 1, T_A + 1);
  assert.ok(spans.length >= 1);
  assert.match(spans[0].labels.at(-1), /^\d+λ$/);
  assert.ok(spans[0].labels.includes('33η 29ι 21λ'));
  assert.equal(ruler.spanText(T_A - 1, T_A + 1, 2, 0.5 / 1000), '6.4ν');
  assert.equal(ruler.spanText(T_A - 0.02, T_A + 0.02), '0.13ν');
  assert.equal(ruler.spanText(T_A - 0.0001, T_A + 0.0001), '<0.001ν');
});

test('pure ruler: the catalogue map is numbered with the eclipse numbers (the position of that eclipse)', () => {
  const m = ruler.overviewMarks();
  assert.deepEqual(m.map((x) => x.labels[0]), ['#10', '#20', '#30', '#40', '#50', '#60']);
  assert.deepEqual(m.map((x) => x.labels[0]), [10, 20, 30, 40, 50, 60].map((k) => pure.eclipseName(k)));
  assert.equal(m[0].t, model.catalogue[10]);
  for (const x of m) near(model.positionOf(x.t), Number(x.labels[0].slice(1)), 1e-9);
});

test('pure wording: lane heads, lengths, block labels and what begins when a cycle ends', () => {
  assert.deepEqual(Array.from({ length: 14 }, (_, L) => words.cycleLength(L)), ['1α', '1β', '1γ', '1δ', '1ε', '11η', '1η', '4ι', '1ι', '13λ', '1λ', '5ν', '1ν', '0.14ν']);
  for (let L = 0; L < 14; L++) assert.equal(words.cycleLength(L), pure.cycleLength(L), 'the exact nominal lengths of the helper');
  // the lane head: one cycle counted in the next unit (the depths between and ξ: their length)
  assert.deepEqual(Array.from({ length: 14 }, (_, L) => words.laneLength(L)), ['= 5β', '= 13γ', '= 5δ', '= 5ε', '= 77η', '= 11η', '= 36ι', '= 4ι', '= 65λ', '= 13λ', '= 25ν', '= 5ν', '= 7ξ', '= 0.14ν']);
  assert.deepEqual([3, 4, 5, 7, 13].map(words.lastsText), ['', '', 'lasts 11η', 'lasts 4ι', 'lasts 0.14ν']);
  assert.deepEqual([4, 5, 13].map(words.denseMsg), ['ε cycles · zoom in', 'ζ cycles of 11η · zoom in', 'cycles of 0.14ν · zoom in']);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(nth), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
  // a major block: words, the quarter at the cursor in the block that holds it; never a pair
  const d = model.levelAt(T_A, 3);
  const major = (o) => words.blockLabels({ level: 3, local: d.local, idx: d.cycle, sib: 5, endsWithCatalogue: false, ...o });
  assert.deepEqual(major({ wide: true, w: 900, quarter: 'End' }), ['δ 4 · Delta Trifracton End (3/5) · ends → Delta Tetrafracton', 'δ 4 · Delta Trifracton End', 'Delta Trifracton End', 'Delta Trifracton', 'δ#3 End', 'δ#3', '3']);
  assert.deepEqual(major({ wide: false, w: 130 }), ['δ 4 · Delta Trifracton', 'Delta Trifracton', 'δ#3', '3']);
  assert.deepEqual(major({ wide: false, w: 20 }), ['3']);
  assert.match(major({ wide: true, w: 900, endsWithCatalogue: true })[0], /ends with the catalogue$/);
  // minor blocks: their placing counts; what begins is said by the counts that change
  const e = model.levelAt(T_A, 6);
  assert.deepEqual(words.blockLabels({ level: 6, local: e.local, idx: e.cycle, sib: 11, wide: true, w: 900, endsWithCatalogue: false }), ['η 7 · ε#5 33η · ends → 34η', 'η 7 · ε#5 33η', 'ε#5 33η', '33η', '33']);
  const n = model.levelAt(T_A, 4);
  assert.deepEqual(words.blockLabels({ level: 4, local: n.local, idx: n.cycle, sib: 5, wide: true, w: 900, endsWithCatalogue: false }), ['ε 5 · ε#5 · ends → ε#1', 'ε 5 · ε#5', 'ε#5', '5']);
  const th = model.levelAt(T_A, 7);
  assert.deepEqual(words.blockLabels({ level: 7, local: th.local, idx: th.cycle, sib: 9, wide: false, w: 60, endsWithCatalogue: false }), ['28ι', '28'], 'a θ cycle is named by the Preon count it starts at');
  assert.deepEqual(words.endsInto(6, e.cycle, false), { short: '34η', long: 'ε#5 34η', say: '34η' });
  assert.deepEqual(words.endsInto(3, d.cycle, false), { short: 'δ#4', long: 'Delta Tetrafracton', say: 'Delta Tetrafracton' });
  assert.equal(words.endsInto(4, n.cycle, false).say, 'ε#1');
  // the last Helion of a Nuclide: the next one starts a new Nuclide, so the Nuclide is named
  const lastEta = Math.floor(n.cycle * 77) + 76; // (the 77th Helion of this Nuclide)
  assert.equal(words.endsInto(6, lastEta, false).say, 'ε#1 0η');
  // eclipses, edges, pointers, chips
  assert.equal(words.eclipseLabel(22), '#22');
  for (const k of [0, 1, 22, 68, 69]) assert.equal(words.eclipseLabel(k), pure.eclipseName(k));
  assert.equal(words.eclipseChip(22, true), '#22 ▸');
  assert.equal(words.eclipseChip(20, false), '◂ #20');
  assert.match(words.eclipseChipTip(22, true), /^Next greatest eclipse of Saros 141 \(#22\) – click/);
  assert.equal(words.edgeLabel('start'), 'catalogue starts · pos 0');
  assert.equal(words.edgeLabel('end'), 'catalogue ends · pos 69');
  assert.equal(words.endsChip('ε', 'in 2ε 10η', true), 'ε ends in 2ε 10η ▸');
  assert.equal(words.endsChip('η', 'in 6ι 43λ', false), '◂ η ends in 6ι 43λ');
  assert.deepEqual(words.markerChip('cursor', '33η 29ι 21λ', true), ['cursor 33η 29ι 21λ ▸', 'cursor ▸']);
  assert.deepEqual(words.markerChip('now', '33η 29ι 21λ', false), ['◂ now 33η 29ι 21λ', '◂ now']);
  assert.deepEqual(words.rulerKey(ruler.stepById('iota×4')), { top: 'η', bottom: 'ι ×4' });
  assert.deepEqual(words.rulerKey(ruler.stepById('alpha')), { top: '', bottom: 'α' });
  assert.match(words.turnoverTip(6, e.cycle, true, false), /^Next turnover of the selected depth, η \(depth 7\): ε#5 33η ends → 34η begins\./);
  assert.match(words.turnoverTip(3, d.cycle, false, false), /^The end of the δ cycle at the cursor lies to the left of the view: Delta Trifracton ends → Delta Tetrafracton begins\./);
  assert.equal(words.selectedSentence(6, e.cycle, e.local, 11, false), 'Selected depth 7 (η): ε#5 33η, ends → 34η begins.');
  assert.equal(words.selectedSentence(3, d.cycle, d.local, 5, false), 'Selected depth 4 (δ): Delta Trifracton, cycle 3 of 5, ends → Delta Tetrafracton begins.');
  assert.match(words.selectedSentence(0, 17, 17, 18, true), /^Selected depth 1 \(α\): Alpha Octadecafracton, cycle 18 of 18, ends with the catalogue\.$/);
});

test('pure wording: the ruler key, preset titles and lane heads name the units in prose', () => {
  const tip = words.rulerTip(ruler.stepById('iota×4'));
  assert.match(tip, /^Each tick starts a Preon \(ι, depth 9\); every 4th one is labelled\. The row above names the Helion \(η\) each one belongs to\./);
  assert.match(tip, /Here ι is counted inside the Helion, from 0 to 35, like the clock in the header\./);
  assert.match(words.rulerTip(ruler.stepById('eta')), /Here η is counted inside the Nuclide, from 0 to 76, like the clock in the header\./);
  assert.match(words.rulerTip(ruler.stepById('nu')), /Here ν is counted inside the Flavon, from 0 to 24\. A count/);
  assert.match(words.rulerTip(ruler.stepById('epsilon')), /^Each tick starts a Nuclide \(ε, depth 5\), named by its place in the Delta \(ε#1 … ε#5\)\. The row above names the Delta \(δ\) and its quarters Peak, Node, Valley and End/);
  assert.match(words.rulerTip(ruler.stepById('delta')), /^Each tick starts a Delta \(δ\), a major period, named in words where there is room \("Delta Trifracton"\) and else in letters \(δ#3\)\./);
  assert.match(words.rulerTip(ruler.stepById('alpha')), /^Each tick starts an Alpha \(α\)/);
  assert.match(tip, /A count such as 33η is how many whole Helions have gone by since the Nuclide began, so it starts at 0; ε#5 names the 5th Nuclide of its Delta and starts at 1\. Press \? for the glossary\.$/);
  assert.deepEqual(ruler.PRESETS.map(words.presetTitle), [
    'Zoom in to the Blink (ν) scale: a few Blinks across, the deepest zoom',
    'Show about one Flavon (λ) across',
    'Show about one Preon (ι) across',
    'Show about one Helion (η) across',
    'Show about one Nuclide (ε) across',
    'Show about one Delta (δ) across: a major period',
    'Show about one Gamma (γ) across: a major period',
    'Show about one Beta (β) across: a major period',
    'Show about one Alpha (α) across: a major period',
    'Show the whole catalogue',
  ]);
  assert.equal(words.laneTip(0, 18), 'Alpha (α): a major period of 4 Saros intervals; the catalogue holds 18 (the last one is cut off). One Alpha is 5 β. Named in words with its quarter: Peak, Node, Valley or End.');
  assert.equal(words.laneTip(3, 18), 'Delta (δ): a major period, depth 4. 5 of them make a γ; one is 5 ε. Named in words with its quarter: Peak, Node, Valley or End.');
  assert.equal(words.laneTip(4, 18), 'Nuclide (ε): a minor unit, depth 5. 5 of them make a Delta (δ); one is 77 Helions (η). Named ε#1 … ε#5 inside its Delta.');
  assert.equal(words.laneTip(6, 18), 'Helion (η): a minor unit, depth 7. 77 of them make a Nuclide (ε); one is 36 Preons (ι). Counted 0η … 76η inside its Nuclide.');
  assert.equal(words.laneTip(12, 18), "Blink (ν): the finest unit, depth 13, and the device's real-time tick. 25 of them make a Flavon (λ). Counted 0ν … 24ν inside its Flavon.");
  assert.equal(words.laneTip(5, 18), 'ζ (depth 6) lies between the units: one cycle is 11η, 7 of them make a Nuclide (ε). A cycle is named by where it starts: 0η, 11η, 22η … 66η.');
  assert.equal(words.laneTip(9, 18), 'κ (depth 10) lies between the units: one cycle is 13λ, 5 of them make a Preon (ι). A cycle is named by where it starts: 0λ, 13λ, 26λ … 52λ.');
  assert.equal(words.laneTip(13, 18), 'ξ (depth 14) is finer than the Blink: one cycle lasts 0.14ν, 7 of them make a ν. A cycle is named by the decimal Blink it starts at.');
});

test('pure wording: no sentence, label or ruler string leaks (Gregorian, Earth units, %, halves, beats, retired names, minor fractons)', () => {
  const strings = new Set();
  const rulerStrings = new Set();
  const add = (x, into = strings) => (Array.isArray(x) ? x.forEach((y) => add(y, into)) : (into.add(String(x)), strings.add(String(x))));
  const addRuler = (x) => add(x, rulerStrings);
  for (let L = 0; L < 14; L++) {
    add([words.cycleLength(L), words.laneLength(L), words.lastsText(L), words.denseMsg(L), words.laneTip(L, 18)]);
    for (const idx of [0, 18, 77, 1000]) {
      add(words.blockLabels({ level: L, local: idx % 5, idx, sib: 5, wide: true, w: 900, endsWithCatalogue: false, quarter: L < 4 ? 'Node' : null }));
      add(words.turnoverTip(L, idx, true, false));
      add(words.selectedSentence(L, idx, idx % 5, 5, false));
    }
    add(words.blockLabels({ level: L, local: 1, idx: 18, sib: 5, wide: true, w: 900, endsWithCatalogue: true }));
    add(words.turnoverTip(L, 1, false, true));
  }
  for (const s of ruler.STEPS) {
    add(words.rulerTip(s));
    add(Object.values(words.rulerKey(s)));
    addRuler(ruler.ticksIn(s, T_A - 9 * s.nominal, T_A + 9 * s.nominal).flatMap((x) => x.labels));
    if (s.ctx >= 0) addRuler(ruler.contextIn(s, T_A - 3 * ruler.sec[s.ctx], T_A + 3 * ruler.sec[s.ctx]).flatMap((x) => x.labels));
    addRuler(ruler.flagText(T_A, s.u));
    addRuler(ruler.rangeText(T_A - 9 * s.nominal, T_A + 9 * s.nominal, s.u));
    addRuler(ruler.spanText(T_A - 9 * s.nominal, T_A + 9 * s.nominal));
    addRuler(ruler.relText(T_A + 5 * s.nominal, T_A));
    addRuler(ruler.relText(T_A - 5 * s.nominal, T_A));
  }
  for (const p of ruler.PRESETS) add([words.presetTitle(p), words.presetLabel(p)]);
  for (const t of randomInstants(60)) {
    addRuler(ruler.stampText(t, IDX.ν));
    addRuler(ruler.flagText(t, IDX.ι));
    addRuler(ruler.relText(t, T_A));
  }
  for (const dt of [0.0004, 0.002, 0.01, 0.1, 0.3, 0.9, 1.4, 4]) addRuler([ruler.relText(T_A + dt, T_A), ruler.relText(T_A - dt, T_A), ruler.spanText(T_A, T_A + dt)]);
  add([words.eclipseLabel(21), words.eclipseChip(3, true), words.eclipseChipTip(3, false), words.edgeLabel('start'), words.edgeLabel('end'), words.outsideTitle, words.rangeLabel()]);
  addRuler(ruler.overviewMarks().flatMap((x) => x.labels));
  assert.ok(strings.size > 600, `${strings.size} strings`);
  assert.deepEqual([...strings].map((x) => [x, hardLeaks(x)]).filter(([, r]) => r.length), []);
  assert.ok(rulerStrings.size > 300);
  assert.deepEqual([...rulerStrings].filter((x) => OLD_SPELLING.test(x)), []);
  assert.ok([...strings].some((x) => /^η 7 · /.test(x)), 'depth chips are kept');
  assert.ok([...strings].some((x) => /Delta \w+fracton (Peak|Node|Valley|End)/.test(x)), 'major periods carry their quarter words');
  assert.ok([...rulerStrings].some((x) => /^(in )?0\.\d+ν( ago)?$/.test(x)), 'sub-Blink spans are decimals');
  // and the scan really sees what it should
  assert.deepEqual(hardLeaks('Thu 8 Oct 12:00 for 3 h at 66 %'), ['clock-time', 'month-name', 'weekday', 'earth-unit', 'percent']);
  assert.deepEqual(hardLeaks('δ½#3 every 4 beats, one Hadron, Eta Difracton'), ['half-unit', 'beat-word', 'retired-unit', 'minor-fracton']);
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
  assert.equal(textOf(tip({ gutter: true, kind: 'lane', lane: 4 })), `ε · depth 5 ${words.laneTip(4, 18)} Click to select this depth in every view.`);
  assert.equal(tip({ gutter: true, kind: 'lane', lane: 99 }), '');
  assert.match(textOf(tip({ gutter: true, kind: 'axis' })), /^Ruler Each tick starts a Preon \(ι, depth 9\)/);
  assert.match(textOf(tip({ gutter: true, kind: 'eclipse' })), /70 greatest-eclipse instants \(α#1 – α#18\) are the time base of the clock\. They are numbered #0 – #69, like the position\. Every fourth one starts an Alpha\./);
  assert.match(textOf(tip({ gutter: true, kind: 'overview' })), /the numbers are eclipse numbers, like the position \(#10 sits at pos 10\)/);
  assert.match(textOf(tip({ gutter: false, kind: 'overview', x: 250 })), /^Alpha \w+fracton \w+, Beta \w+fracton \w+, Gamma \w+fracton \w+, Delta \w+fracton \w+ α#\d+ β#\d β#?|^Alpha \w+fracton (Peak|Node|Valley|End), .* α#\d+ β#\d γ#\d+ δ#\d · pos \d+\.\d{3} Click to centre/);

  // the plot at vector A (ι ticks), pointer on the ε lane: the short date in words, the stamp, the position
  const html = tip({ gutter: false, kind: 'lane', lane: 4, inPlot: true, t: T_A, x: 300, y: 200 });
  const text = textOf(html);
  assert.ok(text.startsWith(`${pure.dateText(T_A, { upTo: 'nu' })} ${pure.stamp(T_A, 'nu')} pos 22.9`), text.slice(0, 120));
  assert.ok(text.startsWith('Delta Trifracton End ε#5 33η 29ι 21λ 3ν α#6 β#4 γ#9 δ#3 ε#5 33η 29ι 21λ 3ν pos 22.927850 · between #22 and #23'), 'SPEC §15.6 vector A');
  assert.match(text, /vs now 4η 34ι ago vs cursor now/);
  assert.match(text, /ε 5 ε#5 ends in [^·]+ → ε#1 begins/);
  assert.equal((html.match(/class="tl-tip-row/g) || []).length, 10, 'one row per lane');
  assert.equal((html.match(/is-on/g) || []).length, 1);
  // the major rows say their quarter, the minor rows their placing count and their phase pair
  assert.match(text, /α 1 6\/18 Valley β 2 4\/5 Valley γ 3 9\/13 Valley δ 4 3\/5 End ε 5 ε#5 ζ 6 33η η 7 33η θ 8 28ι ι 9 29ι κ 10 13λ$/);
  assert.equal((html.match(/class="pure-pair"/g) || []).length, 6, 'pairs only for the six minor depths, never for α–δ');
  for (const L of [4, 6, 9]) {
    const o = model.odometerAt(T_A, L, { strokes: 2, digits: 2 });
    assert.ok(html.includes(`aria-label="phase ${o.digits[0]} and ${o.digits[1]} of 256"`), `pair of depth ${L + 1}`);
  }
  assert.ok(!/%/.test(html));
  assert.ok(!/<title>|vector CBT/.test(html));
  assert.equal(hardLeaks(text).length, 0);
  env.store.live = true;
  assert.doesNotMatch(textOf(tip({ gutter: false, kind: 'lane', lane: 4, inPlot: true, t: T_A })), /vs cursor/);

  // over major ticks the date names every major period with its quarter; the focused major lane its words and quarter
  env.step = ruler.stepById('delta');
  const coarse = textOf(tip({ gutter: false, kind: 'lane', lane: 3, inPlot: true, t: T_A }));
  assert.ok(coarse.startsWith('Alpha Hexafracton Valley, Beta Tetrafracton Valley, Gamma Nonafracton Valley, Delta Trifracton End, ε#5 33η α#6 β#4 γ#9 δ#3 ε#5 33η pos'), coarse.slice(0, 140));
  assert.match(coarse, /δ 4 Delta Trifracton End δ#3 · 3\/5 · ends in [^→]+ → Delta Tetrafracton begins/);
  env.step = ruler.stepById('alpha');
  assert.match(textOf(tip({ gutter: false, kind: 'lane', lane: 0, inPlot: true, t: T_A })), /^Alpha Hexafracton Valley, Beta Tetrafracton Valley, Gamma Nonafracton Valley, Delta Trifracton End α#6 β#4 γ#9 δ#3 pos/);
  env.step = ruler.stepById('nu');
  env.store = { live: false, t: () => T_A, realNow: () => T_A + 0.1 };
  const fine = textOf(tip({ gutter: false, kind: 'lane', lane: 9, inPlot: true, t: T_A + 0.05 }));
  assert.match(fine, /^Delta Trifracton End ε#5 33η 29ι 21λ 3ν /);
  assert.match(fine, /vs now 0\.16ν ago vs cursor in 0\.16ν/, 'below ten Blinks the readings are decimals');
  assert.match(fine, /κ 10 ε#5 33η 29ι 13λ lasts 13λ · ends in \d+λ \d+ν → 26λ begins/, 'a depth between the units names its start and its length');
  assert.equal(hardLeaks(fine).length, 0);

  // outside the catalogue
  assert.equal(textOf(tip({ gutter: false, kind: 'lane', lane: 0, inPlot: true, t: model.tMax + 1e7 })), 'Outside the Saros 141 catalogue The catalogue spans α#1 – α#18; the clock is not extrapolated.');
  assert.equal(tip({ gutter: false, kind: 'lane', lane: 0, inPlot: false, t: null }), '');

  // an eclipse marker is numbered like the position; one that starts an Alpha names it in words
  env.hoverEclipse = 21;
  const e = textOf(tip({ gutter: false, kind: 'eclipse', inPlot: true, t: model.catalogue[21] }));
  assert.match(e, /^Eclipse #21 · one of 70 pos 21 · in α#6 β#2 Greatest eclipse of Saros 141 vs now .+ · click to move the cursor here$/);
  env.hoverEclipse = 20;
  assert.match(textOf(tip({ gutter: false, kind: 'eclipse', inPlot: true, t: model.catalogue[20] })), /^Eclipse #20 .* starts Alpha Hexafracton/);
  assert.equal(hardLeaks(e).length, 0);
});

test('pure tooltips: a lane finer than the Blink says how long its cycle lasts', () => {
  const env = tipEnv({ levels: [11, 12, 13], step: ruler.stepById('nu') });
  const html = pureTipHTML({ gutter: false, kind: 'lane', lane: 2, inPlot: true, t: T_A + 0.2, x: 100, y: 100 }, env);
  assert.match(textOf(html), /ξ 14 ε#5 33η 29ι 21λ \d+\.?\d*ν lasts 0\.14ν · ends in \d\.\d+ν → \d+\.?\d*ν begins/);
  assert.equal(hardLeaks(textOf(html)).length, 0);
});

test('pure tooltips: the same eclipse has one number (REGRESSION: #23 on the timeline, #22 in the calendar)', () => {
  const env = tipEnv();
  for (const k of [0, 1, 22, 23, 68, 69]) {
    env.hoverEclipse = k;
    const e = textOf(pureTipHTML({ gutter: false, kind: 'eclipse', inPlot: true, t: model.catalogue[k] }, env));
    assert.ok(e.startsWith(`Eclipse ${pure.eclipseName(k)} `), e);
    assert.ok(e.includes(` pos ${k} `), 'the number is the position: eclipse #k sits at pos k');
  }
  env.hoverEclipse = -1;
  const t = model.catalogue[22] + 30000;
  assert.match(textOf(pureTipHTML({ gutter: false, kind: 'lane', lane: 4, inPlot: true, t }, env)), /pos 22\.0000\d+ · between #22 and #23 /);
  assert.match(textOf(pureTipHTML({ gutter: false, kind: 'lane', lane: 4, inPlot: true, t: model.tMax - 0.5 }, env)), /between #68 and #69 /);
  assert.equal(words.eclipseChip(22, false), `◂ ${pure.eclipseName(22)}`);
});

test('pure tooltips: no hard leak anywhere on a sweep of instants, steps and lanes', () => {
  const env = tipEnv({ store: { live: false, t: () => T_A, realNow: () => 1.7e9 }, levels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] });
  let n = 0;
  for (const t of [...randomInstants(25), model.tMin + 1, model.tMax - 1, model.tMax + 5, model.tMin - 5, T_A + 0.05]) {
    for (const step of ['nu', 'nu×5', 'lambda', 'eta', 'epsilon', 'delta', 'alpha×2'].map(ruler.stepById)) {
      env.step = step;
      for (const lane of [0, 3, 4, 5, 9, 13]) {
        const html = pureTipHTML({ gutter: false, kind: 'lane', lane, inPlot: true, t, x: 100, y: 100 }, env);
        assert.deepEqual(hardLeaks(textOf(html)), [], textOf(html));
        if (model.inRange(t)) assert.equal((html.match(/class="pure-pair"/g) || []).length, 10, 'never a pair for α–δ');
        n++;
      }
    }
  }
  assert.ok(n > 500);
});

test('pure data layer: ticks, minor ticks and context spans of a pure step are cached and rebuilt on invalidate', () => {
  const data = createData({ model, fmt: utc, pure });
  const step = ruler.stepById('iota×2');
  const a = data.ticksFor(step, T_A, T_A + 20000);
  assert.ok(a.length >= 5 && a.every((tk) => /^\d+ι$/.test(tk.labels[0])));
  assert.strictEqual(data.ticksFor(step, T_A + 100, T_A + 20100), a, 'a slightly moved window reuses the list');
  const minor = data.minorFor(step, T_A, T_A + 20000);
  assert.equal(minor.step.id, 'iota');
  assert.ok(minor.ticks.length >= a.length * 2 - 2);
  const ctx = data.contextFor(step, T_A, T_A + 20000);
  assert.ok(ctx.length >= 1 && /^\d+η$/.test(ctx[0].labels.at(-1)), ctx[0].labels.join(' | '));
  // whole Nuclide ticks: the row above is the quarters of the Delta
  const q = data.contextFor(ruler.stepById('epsilon'), T_A, T_A + 3e6);
  assert.ok(q.length >= 2 && q.every((x) => pure.QUARTER_WORDS.includes(x.labels.at(-1))), q.map((x) => x.labels.at(-1)).join(' '));
  assert.deepEqual(data.contextFor(ruler.stepById('alpha'), T_A, T_A + 20000), []);
  const nu = data.minorFor(ruler.stepById('nu'), T_A, T_A + 2);
  assert.equal(nu.step.id, 'nu/10');
  assert.ok(nu.ticks.length >= 60);
  assert.equal(data.overviewMarks().length, 6);
  assert.equal(createData({ model, fmt: utc }).ruler, null, 'without a pure vocabulary there is no ruler');
  assert.deepEqual(createData({ model, fmt: utc }).overviewMarks(), []);
  data.invalidate();
  assert.notStrictEqual(data.ticksFor(step, T_A, T_A + 20000), a);
  assert.ok(data.ticksFor(stepById('h1'), T_A, T_A + 20000).every((tk) => /^\d\d:00$/.test(tk.labels[0]) || /^[A-Z][a-z]{2} \d+$/.test(tk.labels[0])));
});

test('no dead code and no stale vocabulary: halves, beats, retired names and minor fractons are gone from the pure sources', () => {
  for (const f of ['../src/ui/timeline/tips.js', '../src/ui/timeline/ruler.js', '../src/ui/timeline/words.js']) {
    const src = sourceOf(f);
    assert.doesNotMatch(src, /\.replace\(\/<title>/, `${f}: no workaround for the glyph titles (pure.pairHTML strips them)`);
    assert.doesNotMatch(src, /trimZeros/, `${f}: durations are never trimmed or reformatted here`);
    assert.doesNotMatch(src, /durationPos\(4 \//, `${f}: lane lengths come from pure.cycleLength`);
  }
  for (const f of ['../src/ui/timeline.js', '../src/ui/timeline/tips.js', '../src/ui/timeline/ruler.js', '../src/ui/timeline/words.js', '../src/ui/timeline/paint.js', '../src/ui/timeline/data.js']) {
    const src = sourceOf(f);
    assert.doesNotMatch(src, /[αβγδεζηθικλμνξ]½/, `${f}: no half units`);
    assert.doesNotMatch(src, /\bbeats?\b/i, `${f}: real time is counted in Blinks`);
    assert.doesNotMatch(src, /\b(Hadron|Quark|Chromon|Somon|Atom)s?\b/, `${f}: the depths between have no names`);
    assert.doesNotMatch(src, /\b(Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi)\s+[A-Za-z]*fracton\b/, `${f}: only α–δ have fracton names`);
    assert.doesNotMatch(src, /'(theta|kappa|mu|zeta|xi)'/, `${f}: θ κ μ ζ ξ are not unit ids`);
  }
  assert.equal(typeof ruler.trimZeros, 'undefined');
  assert.equal(typeof ruler.tokensAt, 'undefined', 'positions and times have their own readers now');
});
