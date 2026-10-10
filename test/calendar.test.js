import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createFormatter, zonedToUnix, zonedParts } from '../src/core/format.js';
import { parseJump, parseGregorian, parseDateText, parseTimeText, eventsAround, dayFirstOfLocale, MAX_INPUT } from '../src/ui/calendar/parse.js';
import { sanitizeHistory, examples, PLACEHOLDER } from '../src/ui/jump.js';
import { hasSound, hearMoment } from '../src/ui/calendar/dom.js';
import {
  landOn,
  pointOfCycle,
  pointTime,
  childCount,
  normalizePath,
  pathOfTime,
  pathText,
  cycleOfPath,
  gregorianInfo,
  positionInfo,
  exactPosition,
  timeOfPositionParts,
  timeOfPositionText,
  eclipseContext,
  stateMeaning,
  levelRows,
  stateTimes,
  syncRange,
  solarInfo,
  shareQuery,
  dayStart,
  addDays,
  describeInstant,
  catalogueRangeText,
  ordinal,
  isLeap,
  localToUnix,
  localTimeIssue,
  isoWithMs,
  isoOffset,
  rangeProblem,
  spanLabel,
  utcStamp,
  chainText,
  addressText,
  clip,
  cycleLabel,
  nominalCount,
  pctFloor,
  wallTimeNote,
} from '../src/ui/calendar/convert.js';
import { monthGrid, buildMonth, cyclesInWindow, syncQuartersInWindow, yearRibbon, yearSummary, weekdayOf, overlayById, clampMonth } from '../src/ui/calendar/month.js';
import { createPure, UNITS, ORDINAL_NAMES } from '../src/core/pure.js';
import { RULES } from '../tools/pure-scan.mjs';
import { PURE_PLACEHOLDER, parsePure, pureExamples, normalizePure, namesToAddress, looksEarthly } from '../src/ui/calendar/pure-parse.js';
import {
  COUNTERS,
  GRID,
  buildPureGrid,
  buildRibbon,
  cellFraction,
  cellOfTime,
  cellTime,
  clampView,
  CELLS_PER,
  countersAt,
  cycleStart,
  overlayCycle,
  EPS_POS,
  entriesText,
  firstMs,
  ladderRanges,
  landCycleAt,
  landPoint,
  landPath,
  counterText,
  pureEclipseContext,
  pureShareQuery,
  pureSolarInfo,
  resolveParts,
  setCounter,
  shiftUnits,
  spanText,
  unitById,
  viewCount,
  viewFromPath,
  viewInfo,
  viewOfTime,
} from '../src/ui/calendar/pure-conv.js';

const model = createModel();
const utc = createFormatter(() => 'UTC');
const kyiv = createFormatter(() => 'Europe/Kyiv');
const A = 1791460800; // 2026-10-08T12:00:00Z, SPEC vector A
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);
const jump = (text, o = {}) => parseJump(text, { model, now: A, real: A + 86400 * 3, fmt: utc, zone: 'UTC', ...o });
const first = (text, o) => jump(text, o)[0];

// ---------------------------------------------------------------------------------------------
// jump parser: Gregorian
// ---------------------------------------------------------------------------------------------
test('jump: ISO date and time forms in the app zone', () => {
  assert.equal(first('2031-06-01').time, Date.UTC(2031, 5, 1) / 1000);
  assert.equal(first('2031-06-01 14:30').time, Date.UTC(2031, 5, 1, 14, 30) / 1000);
  near(first('2031-06-01 14:30:15.250').time, Date.UTC(2031, 5, 1, 14, 30, 15) / 1000 + 0.25, 1e-6);
  assert.equal(first('2031-06-01T14:30').time, Date.UTC(2031, 5, 1, 14, 30) / 1000);
  assert.equal(first('1 Jun 2031 2pm').time, Date.UTC(2031, 5, 1, 14) / 1000);
  assert.equal(first('June 1, 2031 14:30').time, Date.UTC(2031, 5, 1, 14, 30) / 1000);
  assert.equal(first('1st of June 2031').time, Date.UTC(2031, 5, 1) / 1000);
  assert.equal(first('2031/06/01').time, Date.UTC(2031, 5, 1) / 1000);
  assert.equal(first('1.6.2031').time, Date.UTC(2031, 5, 1) / 1000);
  assert.equal(first('2031').time, Date.UTC(2031, 0, 1) / 1000, 'a year is its first instant');
  assert.equal(first('Jun 2031').time, Date.UTC(2031, 5, 1) / 1000);
  assert.equal(first('20310601').time, Date.UTC(2031, 5, 1) / 1000);
});

test('jump: no offset = the app zone, explicit offsets win', () => {
  const k = { fmt: kyiv, zone: 'Europe/Kyiv' };
  // Kyiv is UTC+3 in June
  assert.equal(first('2031-06-01 14:30', k).time, Date.UTC(2031, 5, 1, 11, 30) / 1000);
  assert.equal(first('2031-06-01T14:30Z', k).time, Date.UTC(2031, 5, 1, 14, 30) / 1000);
  assert.equal(first('2031-06-01T14:30:00+05:30', k).time, Date.UTC(2031, 5, 1, 9, 0) / 1000);
  assert.equal(first('2031-06-01 14:30 UTC-5', k).time, Date.UTC(2031, 5, 1, 19, 30) / 1000);
  assert.equal(first('2031-06-01 14:30 +0300', k).time, Date.UTC(2031, 5, 1, 11, 30) / 1000);
});

test('jump: the header readout text can be pasted back', () => {
  const t = first('Thu 8 Oct 2026, 12:00:00').time;
  assert.equal(t, A);
  assert.equal(first('Fri 9 Oct 2026, 14:23:07').time, Date.UTC(2026, 9, 9, 14, 23, 7) / 1000);
});

test('jump: ambiguous d/m vs m/d offers both, unambiguous one', () => {
  const r = jump('03/04/2031');
  assert.equal(r.length, 2);
  assert.equal(r[0].time, Date.UTC(2031, 3, 3) / 1000, 'day/month first');
  assert.equal(r[1].time, Date.UTC(2031, 2, 4) / 1000);
  assert.equal(jump('31/12/2031').length, 1);
  assert.equal(first('12/31/2031').time, Date.UTC(2031, 11, 31) / 1000);
});

test('jump: time of day only is read on the displayed day', () => {
  assert.equal(first('14:30').time, Date.UTC(2026, 9, 8, 14, 30) / 1000);
  assert.equal(first('noon').time, A);
  assert.equal(first('9am').time, Date.UTC(2026, 9, 8, 9) / 1000);
});

test('jump: invalid dates give precise errors', () => {
  assert.match(first('2031-02-30').error, /February 2031 has only 28 days/);
  assert.match(first('2031-13-01').error, /Month 13 does not exist/);
  assert.match(first('2031-06-01 25:00').error, /Hour 25/);
  assert.match(first('2031-06-01 12:61').error, /Minute 61/);
  assert.match(first('1500-01-01').error, /before the catalogue starts \(1613-05-19 UTC\)/);
  assert.match(first('3000-01-01').error, /after the catalogue ends \(2857-06-13 UTC\)/);
  assert.equal(first('3000-01-01').time, null);
  assert.match(first('xyz').error, /Cannot read "xyz"/);
});

// ---------------------------------------------------------------------------------------------
// jump parser: unix, relative, position
// ---------------------------------------------------------------------------------------------
test('jump: unix seconds and milliseconds', () => {
  assert.equal(first('1791460800').time, A);
  assert.equal(first('unix 1791460800').time, A);
  assert.equal(first('1791460800000').time, A);
  assert.equal(first('@1791460800.5').time, A + 0.5);
  assert.equal(first('-11253795486').time, -11253795486);
  assert.match(first('99999999999999999').error, /not a valid Unix time|outside|beyond|after/i);
});

test('jump: now / today / tomorrow / relative offsets', () => {
  assert.equal(first('now').time, A + 86400 * 3, 'now is the device clock');
  assert.equal(first('today').time, Date.UTC(2026, 9, 8) / 1000);
  assert.equal(first('tomorrow').time, Date.UTC(2026, 9, 9) / 1000);
  assert.equal(first('yesterday 18:00').time, Date.UTC(2026, 9, 7, 18) / 1000);
  assert.equal(first('tomorrow 9:30').time, Date.UTC(2026, 9, 9, 9, 30) / 1000);
  assert.equal(first('+3d').time, A + 3 * 86400);
  assert.equal(first('-2h30m').time, A - 9000);
  assert.equal(first('in 2 weeks').time, A + 14 * 86400);
  assert.equal(first('3 days ago').time, A - 3 * 86400);
  assert.equal(first('+90min').time, A + 5400);
  assert.equal(first('+1y').time, Date.UTC(2027, 9, 8, 12) / 1000);
  assert.equal(first('+1mo').time, Date.UTC(2026, 10, 8, 12) / 1000);
  assert.equal(first('+500ms').time, A + 0.5);
  assert.match(first('+3').error, /Add a unit/);
});

test('jump: relative months clamp the day, days keep the wall clock across DST', () => {
  const jan31 = Date.UTC(2027, 0, 31, 12) / 1000;
  assert.equal(first('+1mo', { now: jan31 }).time, Date.UTC(2027, 1, 28, 12) / 1000);
  const berlin = { fmt: createFormatter(() => 'Europe/Berlin'), zone: 'Europe/Berlin' };
  const before = zonedToUnix({ year: 2026, month: 3, day: 28, hour: 12 }, 'Europe/Berlin');
  const t = first('+1d', { now: before, ...berlin }).time;
  assert.equal(t, zonedToUnix({ year: 2026, month: 3, day: 29, hour: 12 }, 'Europe/Berlin'));
  assert.equal(t - before, 23 * 3600, '+1d across the spring-forward night is 23 elapsed hours');
  const h = first('+24h', { now: before, ...berlin }).time;
  assert.equal(h - before, 24 * 3600, 'hours are elapsed time');
});

test('jump: Saros position', () => {
  const t = first('pos 22.927850216635').time;
  near(t, A, 0.002);
  assert.equal(first('p22.927850216635').time, t);
  assert.equal(first('22.927850216635').time, t, 'a bare decimal with many digits is a position');
  assert.equal(first('22 + 0.927850216635').time, t);
  assert.equal(first('saros 0').time, model.tMin);
  assert.equal(first('pos 69').time, model.tMax);
  assert.match(first('pos 70').error, /between 0 and 69/);
  assert.match(first('pos 69.5').error, /between 0 and 69/);
});

// ---------------------------------------------------------------------------------------------
// jump parser: cycles
// ---------------------------------------------------------------------------------------------
test('jump: hierarchical addresses in every notation agree with the model', () => {
  const path = pathOfTime(model, A, 5);
  assert.deepEqual(path, [6, 4, 9, 3, 5]);
  const start = model.levelAt(A, 4).start;
  for (const txt of ['α6 β4 γ9 δ3 ε5', 'a6 b4 g9 d3 e5', '6.4.9.3.5', 'α 6 › β 4 › γ 9 › δ 3 › ε 5', 'alpha6 beta4 gamma9 delta3 epsilon5']) {
    const c = first(txt);
    assert.equal(c.kind, 'cycle', txt);
    near(c.time, start, 0.0011, txt);
    assert.ok(c.time >= start, 'lands inside the cycle that starts there');
    assert.equal(model.levelAt(c.time, 4).cycle, model.levelAt(A, 4).cycle, txt);
  }
});

test('jump: partial addresses take the enclosing cycles from the displayed time', () => {
  const full = first('α6 β4 γ9 δ3 ε5').time;
  assert.equal(first('ε5').time, full);
  assert.equal(first('δ3 ε5').time, full);
  // ε1 inside the displayed δ3
  const e1 = first('ε1').time;
  assert.deepEqual(pathOfTime(model, e1, 5), [6, 4, 9, 3, 1]);
  assert.match(first('ε1').label, /^The 1st ε in the current δ$/, 'the label says in words which cycle it took');
  assert.match(first('ε1').detail, /ε#1/);
});

test('jump: address points (peak / node / valley / end)', () => {
  const c = model.levelAt(A, 4);
  near(first('α6 β4 γ9 δ3 ε5 peak').time, c.thresholds[1].time, 0.0011);
  near(first('a6 b4 g9 d3 e5 node').time, c.thresholds[2].time, 0.0011);
  near(first('a6 b4 g9 d3 e5 valley').time, c.thresholds[3].time, 0.0011);
  near(first('a6 b4 g9 d3 e5 end').time, c.end, 0.0011);
});

test('jump: address errors are precise', () => {
  assert.match(first('α6 β6').error, /Beta has only 5 cycles in an Alpha/);
  assert.match(first('α6 β4 γ14').error, /Gamma has only 13 cycles in a Beta/);
  assert.match(first('α6 β4 γ9 δ3 ε6').error, /Epsilon has only 5 cycles in a Delta/);
  assert.match(first('α19').error, /only 18 Alpha cycles/);
  assert.match(first('α0').error, /start at 1/);
  assert.match(first('α6 γ3').error, /Beta is missing between Alpha and Gamma/);
  assert.match(first('γ3 β2').error, /longest to the shortest/);
  assert.match(first('α18 β3').error, /starts after the catalogue ends/);
  assert.ok(first('α18 β2').time > 0, 'clipped last alpha: β2 still starts inside');
});

test('jump: global cycle index (# form) and depth form', () => {
  const eta = model.levelAt(A, 6);
  assert.equal(eta.cycle, 717211);
  for (const txt of ['d7#717211', 'D7 # 717211', 'depth 7 #717211', 'depth7#717211']) {
    const c = first(txt);
    assert.equal(c.kind, 'cycle', txt);
    near(c.time, eta.start, 0.0011, txt);
  }
  // a Greek letter before the hash is the ordinal inside the parent, never the global index
  assert.equal(first('η#717211').kind, 'error');
  assert.match(first('η#717211').detail, /d7#717211/, 'the error says how to write the global index');
  assert.match(first('d7#99999999').error, /Eta has only 2158407 cycles/);
  assert.match(first('d15#1').error, /Depth must be between 1 and 14/);
});

test('jump: solar sync', () => {
  const s = model.solarAt(A);
  assert.equal(s.sync, 4820);
  near(first('sync 4820').time, s.start, 0.0011);
  near(first('S4820').time, s.start, 0.0011);
  near(first('sync 4820 node').time, s.start + (s.end - s.start) / 2, 0.0011);
  assert.match(first('sync 99999999').error, /not inside the catalogue/);
  const r = syncRange(model);
  assert.ok(r.first < -30000 && r.last > 80000, JSON.stringify(r));
  assert.ok(model.solarSyncByNumber(r.first) && !model.solarSyncByNumber(r.first - 1));
  assert.ok(model.solarSyncByNumber(r.last) && !model.solarSyncByNumber(r.last + 1));
});

test('jump: next / previous boundaries and thresholds', () => {
  const cur = model.levelAt(A, 4);
  near(first('next ε').time, cur.end, 0.0011);
  near(first('next end of ε').time, cur.end, 0.0011);
  near(first('prev ε').time, cur.start, 0.0011, 'previous boundary = start of the current cycle');
  const eta = model.levelAt(A, 6);
  const peakEta = first('next peak η');
  // the first η peak after A: this cycle's when it still lies ahead, else the next cycle's
  const peakThis = model.cycleByIndex(6, eta.cycle).events[1].time;
  const peakNext = model.cycleByIndex(6, eta.cycle + 1).events[1].time;
  near(peakEta.time, peakThis > A ? peakThis : peakNext, 0.0011, 'next peak η is the following η peak');
  assert.ok(peakEta.time > A);
  assert.equal(model.levelAt(peakEta.time, 6).index, 4, 'lands on the peak state (index M=4)');
  // nth next boundary
  const third = first('next 3 ε').time;
  near(third, model.cycleStartTime(4, cur.cycle + 3), 0.0011);
  // previous from exactly a boundary goes to the one before
  const b = first('next ε').time;
  near(first('prev ε', { now: b }).time, cur.start, 0.0011);
  near(first('next ε', { now: b }).time, model.cycleStartTime(4, cur.cycle + 2), 0.0011);
  // a lone level letter offers both directions
  const both = jump('ε');
  assert.equal(both.length, 2);
  assert.ok(both[0].time > A && both[1].time < A);
});

test('jump: odometer state occurrences', () => {
  const r = jump('d7 13,0');
  assert.equal(r.length, 2);
  assert.equal(r[0].kind, 'state');
  const [next] = model.stateOccurrences(6, [13, 0], A, { direction: 1, count: 1 });
  near(r[0].time, next.start, 0.0011);
  assert.equal(model.odometerAt(r[0].time, 6).digits.join(), '13,0');
  assert.deepEqual(jump('η [13,0]').map((c) => c.time), r.map((c) => c.time));
  const prev = jump('prev d7 13,0');
  assert.ok(prev[0].time < A, 'prev lists the earlier occurrence first');
  assert.match(first('d7 16,0').error, /Digit 16 is too large/);
});

test('jump: candidates never extrapolate and results are ordered best first', () => {
  for (const txt of ['3000-01-01', '1500', 'pos 100', 'sync 1e9', 'α99', '-99999999999999']) {
    const r = jump(txt);
    assert.ok(r.length > 0 && r.every((c) => c.kind === 'error' && c.time === null), txt);
  }
  assert.deepEqual(jump(''), []);
  assert.deepEqual(jump('   '), []);
  const r = jump('20310601');
  assert.equal(r[0].kind, 'date');
  assert.equal(r[1].kind, 'unix');
});

test('jump: works near the catalogue edges', () => {
  const lastSync = syncRange(model).last;
  assert.ok(first(`sync ${lastSync}`).time < model.tMax);
  assert.ok(jump('next ε', { now: model.tMax - 10 })[0].error, 'no later boundary at the end');
  assert.ok(first('prev ε', { now: model.tMin + 10 }).error);
  assert.ok(first('next ε', { now: model.tMin + 10 }).time > model.tMin);
  assert.match(first('ε5', { now: model.tMax + 100 }).error, /displayed time is outside the catalogue/);
});

test('eventsAround: strict ordering and landing', () => {
  const ev = eventsAround(model, A, 6, 1, 5, 1);
  assert.equal(ev.length, 5);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].t > ev[i - 1].t);
  const back = eventsAround(model, A, 6, -1, 5, 0);
  for (let i = 1; i < back.length; i++) assert.ok(back[i].t < back[i - 1].t);
  assert.ok(back[0].t < A);
});

// ---------------------------------------------------------------------------------------------
// gregorian field parsing used by the converter inputs
// ---------------------------------------------------------------------------------------------
test('converter inputs: date and time text', () => {
  assert.deepEqual(parseDateText('2031-06-01'), { year: 2031, month: 6, day: 1, time: null });
  assert.equal(parseDateText('2031-6-1').month, 6);
  assert.match(parseDateText('2031-02-31').error, /only 28 days/);
  assert.match(parseDateText('hello').error, /YYYY-MM-DD/);
  assert.deepEqual(parseTimeText('14:30'), { hour: 14, minute: 30, second: 0, ms: 0 });
  assert.deepEqual(parseTimeText('14:30:15.250'), { hour: 14, minute: 30, second: 15, ms: 250 });
  assert.deepEqual(parseTimeText('2pm'), { hour: 14, minute: 0, second: 0, ms: 0 });
  assert.match(parseTimeText('25:00').error, /Hour 25/);
  assert.match(parseTimeText('xx').error, /HH:MM/);
  const r = parseGregorian('2031-06-01T14:30:00.123+02:00', { zone: 'UTC' });
  near(r.results[0].t, Date.UTC(2031, 5, 1, 12, 30, 0) / 1000 + 0.123, 1e-6);
});

// ---------------------------------------------------------------------------------------------
// converter maths: round trips
// ---------------------------------------------------------------------------------------------
const SAMPLE_TIMES = [A, 946684800, 2886085800, 125593320.816, model.tMin + 5, model.tMax - 5, 1700000000.123, -5e9, 2.5e10, 1234567890.987];

test('round trip: Gregorian -> position -> Gregorian within 1 ms', () => {
  for (const t of SAMPLE_TIMES) {
    const p = positionInfo(model, t);
    const back = timeOfPositionParts(model, p.k, '0' + p.fraction);
    near(back.t, t, 1e-3, 'ordinal+fraction @' + t);
    const viaText = timeOfPositionText(model, p.pos);
    near(viaText.t, t, 1e-3, 'text @' + t);
    const viaExact = timeOfPositionText(model, p.exact);
    near(viaExact.t, t, 5e-4, 'exact @' + t);
  }
});

test('round trip: exact position agrees with the library and the float mapping', () => {
  const p = positionInfo(model, A);
  assert.equal(p.k, 22);
  assert.ok(p.pos.startsWith('22.927850216635'), p.pos);
  assert.ok(p.exact.startsWith('22.927850216635'), p.exact);
  near(Number(p.exact), model.positionOf(A), 1e-12);
  assert.equal(exactPosition(model, A).split('.')[1].length, 15);
  assert.equal(positionInfo(model, model.tMax + 1), null);
  assert.equal(positionInfo(model, model.tMin - 1), null);
  assert.equal(positionInfo(model, model.tMax).k, 69);
});

test('round trip: Gregorian -> cycle address -> Gregorian (begin of every depth)', () => {
  for (const t of SAMPLE_TIMES.filter((x) => model.inRange(x))) {
    for (const depth of [1, 2, 5, 8, 11, 14]) {
      const path = pathOfTime(model, t, depth);
      assert.equal(path.length, depth);
      const cyc = cycleOfPath(model, path);
      assert.ok(cyc, pathText(path));
      const l = model.levelAt(t, depth - 1);
      assert.equal(cyc.idx, l.cycle);
      const begin = pointTime(model, path, 'begin');
      near(begin, l.start, 2e-3, `begin depth ${depth} @${t}`);
      const end = pointTime(model, path, 'end');
      assert.ok(begin <= t + 1e-3 && (end === null || end >= t - 1e-3), 'the instant lies inside its cycle');
      // landing inside the cycle at depth: re-reading the address gives the same path
      const landed = landOn(model, begin, depth - 1);
      assert.deepEqual(pathOfTime(model, landed, depth), path, `landOn depth ${depth} @${t}`);
      // same phase maps back onto the instant
      const same = pointTime(model, path, 'phase', l.phase);
      near(same, t, depth >= 14 ? 5e-3 : 1e-3, `same phase depth ${depth}`);
    }
  }
});

test('round trip: points of a cycle match the library events', () => {
  const t = A;
  for (const L of [0, 3, 6, 10]) {
    const l = model.levelAt(t, L);
    const ev = model.cycleByIndex(L, l.cycle).events;
    const idx = l.cycle;
    near(pointOfCycle(model, L, idx, 0), ev[0].time, 1e-3, 'begin');
    near(pointOfCycle(model, L, idx, 0.25), ev[1].time, 1e-3, 'peak');
    near(pointOfCycle(model, L, idx, 0.5), ev[2].time, 1e-3, 'node');
    near(pointOfCycle(model, L, idx, 0.75), ev[3].time, 1e-3, 'valley');
    near(pointOfCycle(model, L, idx, 1), ev[4].time, 1e-3, 'end');
  }
  // clipped last alpha: only the first peak (the catalogue end) exists
  assert.equal(pointOfCycle(model, 0, 17, 0.25), model.tMax);
  assert.equal(pointOfCycle(model, 0, 17, 0.5), null);
  assert.equal(pointOfCycle(model, 0, 18, 0), null);
});

test('landOn: always lands in the cycle that starts at the boundary', () => {
  for (const L of [2, 4, 6, 8, 10, 12, 13]) {
    const base = model.levelAt(A, L).cycle;
    for (let d = 0; d < 25; d++) {
      const start = model.cycleStartTime(L, base + d);
      const t = landOn(model, start, L);
      assert.ok(t >= start && t - start < 0.0025, `L${L} +${d}: ${t - start}`);
      assert.equal(model.levelAt(t, L).cycle, base + d, `L${L} +${d}`);
    }
  }
});

test('addresses: stepping respects clipped last cycles', () => {
  assert.equal(childCount(model, []), 18);
  assert.equal(childCount(model, [6]), 5);
  assert.equal(childCount(model, [18]), 2, 'the clipped last alpha only holds two betas');
  assert.equal(childCount(model, [18, 2]), 4, 'literal: the clipped last β holds only four γ');
  assert.equal(childCount(model, [18, 1]), 13, 'the first β of the last α is complete');
  assert.deepEqual(normalizePath(model, [18, 5, 9]), [18, 2, 4]);
  assert.deepEqual(normalizePath(model, [18, 5, 99]), [18, 2, 4]);
  assert.deepEqual(normalizePath(model, [99, 0, -4]), [18, 1, 1]);
  assert.deepEqual(normalizePath(model, [6, 4, 9, 3, 5]), [6, 4, 9, 3, 5]);
  assert.equal(model.pathToCycle([18, 2, childCount(model, [18, 2]) + 1]), null);
});

test('glyph states: meaning follows SPEC section 4', () => {
  const rising = stateMeaning(model, 3);
  assert.deepEqual([rising.value, rising.derivative, rising.dotted, rising.words], [3, 1, false, 'rising']);
  const peak = stateMeaning(model, 4);
  assert.deepEqual([peak.value, peak.derivative, peak.words], [4, 0, 'peak']);
  const falling = stateMeaning(model, 5);
  assert.deepEqual([falling.value, falling.dotted, falling.words], [3, true, 'falling']);
  const valley = stateMeaning(model, 12);
  assert.deepEqual([valley.value, valley.words], [-4, 'valley']);
  assert.equal(stateMeaning(model, 15).value, -1);
  assert.equal(stateMeaning(model, 0).states, 16);
  assert.equal(stateMeaning(model, 0, 3).states, 52);
});

test('level rows agree with the model at vector A', () => {
  const rows = levelRows(model, A);
  assert.equal(rows.length, 14);
  assert.deepEqual([rows[6].index, rows[6].value, rows[6].local, rows[6].siblings], [13, -3, 1, 11]);
  assert.deepEqual(rows.slice(0, 5).map((r) => r.local), [6, 4, 9, 3, 5]);
  assert.equal(rows[0].siblings, 18);
  assert.deepEqual(levelRows(model, model.tMax + 5).filter(Boolean), []);
});

test('state occurrences: the picker lists next and previous times', () => {
  const st = stateTimes(model, 6, 13, A, 3);
  assert.equal(st.next.length, 3);
  assert.equal(st.prev.length, 3);
  assert.ok(st.next[0].start > A && st.prev[0].start < A);
  for (const o of [...st.next, ...st.prev]) assert.equal(model.levelAt(landOn(model, o.start), 6).index, 13);
  assert.ok(st.next[0].start < st.next[1].start && st.prev[1].start < st.prev[0].start);
});

test('solar sync info: quarters and the civil grid', () => {
  const s = model.solarAt(A);
  const info = solarInfo(model, utc, s.sync);
  near(info.start, s.start, 1e-6);
  near(info.drift, s.drift, 1e-6);
  assert.equal(info.quarters.length, 4);
  near(info.quarters[0].time - info.start, info.length / 4, 1e-6);
  near(info.quarters[3].time, info.end, 1e-6);
  assert.equal(info.startClock, utc.time(Math.round(info.start * 1000) / 1000, { seconds: true }));
  assert.equal(info.quarters[1].name, 'node');
  near(info.quarters[1].time, 1791509644.786, 5e-4);
  assert.equal(solarInfo(model, utc, 1e9), null);
});

test('eclipse context: previous and next catalogue eclipses', () => {
  const c = eclipseContext(model, A);
  assert.equal(c.prev.k, 22);
  assert.equal(c.next.k, 23);
  assert.ok(c.prev.delta > 0 && c.next.delta < 0);
  const e20 = eclipseContext(model, model.catalogue[20] + 1);
  assert.equal(utc.date(e20.prev.time), '1973-12-24');
  assert.equal(eclipseContext(model, model.tMin - 10).prev, null);
  assert.equal(eclipseContext(model, model.tMax + 10).next, null);
  assert.equal(eclipseContext(model, model.tMax).prev.k, 69);
});

test('gregorian info: weekday, day of year, offsets, DST day length', () => {
  const g = gregorianInfo(utc, A);
  assert.equal(g.date, '2026-10-08');
  assert.equal(g.time, '12:00:00.000');
  assert.equal(g.weekdayName, 'Thursday');
  assert.equal(g.dayOfYear, 281);
  assert.equal(g.daysInYear, 365);
  assert.equal(g.iso, '2026-10-08T12:00:00.000+00:00');
  assert.equal(g.dayLength, 86400);
  const berlin = createFormatter(() => 'Europe/Berlin');
  assert.equal(gregorianInfo(berlin, zonedToUnix({ year: 2026, month: 3, day: 29, hour: 12 }, 'Europe/Berlin')).dayLength, 23 * 3600);
  assert.equal(gregorianInfo(berlin, zonedToUnix({ year: 2026, month: 10, day: 25, hour: 12 }, 'Europe/Berlin')).dayLength, 25 * 3600);
  assert.equal(gregorianInfo(utc, Date.UTC(2024, 11, 31) / 1000).dayOfYear, 366);
  assert.ok(isLeap(2000) && !isLeap(2100));
  const k = gregorianInfo(kyiv, A);
  assert.equal(k.time, '15:00:00.000');
  assert.equal(k.offsetLabel, '+03:00');
  assert.match(k.iso, /T15:00:00\.000\+03:00$/);
});

test('describeInstant: full description of vector A', () => {
  const d = describeInstant(model, utc, A);
  assert.equal(d.inRange, true);
  assert.equal(d.position.k, 22);
  assert.equal(d.rows[6].local, 1);
  assert.equal(d.solar.sync, 4820);
  const out = describeInstant(model, utc, model.tMax + 10);
  assert.equal(out.inRange, false);
  assert.equal(out.position, null);
  assert.equal(out.rows, null);
  assert.equal(out.solar, null);
  assert.equal(out.eclipses.next, null);
});

test('share query is location-free and round-trips the instant', () => {
  const q = shareQuery(A + 0.25, { view: 'calendar', zone: 'Europe/Kyiv' });
  assert.equal(q, '?t=1791460800.250&view=calendar&zone=Europe%2FKyiv');
  const u = new URLSearchParams(q);
  assert.equal(Number(u.get('t')), A + 0.25);
  assert.equal(shareQuery(A, { view: null }), '?t=1791460800.000');
});

test('misc helpers', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(22), '22nd');
  assert.equal(catalogueRangeText(model), '1613-05-19 … 2857-06-13');
  assert.deepEqual(addDays(2026, 12, 31, 1), { year: 2027, month: 1, day: 1 });
  assert.deepEqual(addDays(2026, 3, 1, -1), { year: 2026, month: 2, day: 28 });
  assert.equal(weekdayOf(2026, 10, 8), 4);
  assert.equal(weekdayOf(1970, 1, 1), 4);
  assert.equal(weekdayOf(1969, 12, 31), 3);
});

// ---------------------------------------------------------------------------------------------
// month grid
// ---------------------------------------------------------------------------------------------
test('day starts: real local midnights, also where DST happens at midnight', () => {
  for (const zone of ['UTC', 'Europe/Kyiv', 'America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe', 'Pacific/Auckland', 'America/Santiago', 'Asia/Beirut', 'America/Havana', 'Pacific/Apia']) {
    let prev = null;
    let d = { year: 2026, month: 1, day: 1 };
    for (let i = 0; i < 366; i++) {
      const s = dayStart(zone, d.year, d.month, d.day);
      const p = zonedParts(s, zone);
      assert.deepEqual([p.year, p.month, p.day], [d.year, d.month, d.day], `${zone} ${d.year}-${d.month}-${d.day} -> ${JSON.stringify(p)}`);
      const before = zonedParts(s - 1, zone);
      assert.ok(before.day !== d.day || before.month !== d.month, `${zone}: the second before ${d.month}/${d.day} is the previous day`);
      if (prev !== null) {
        const len = s - prev;
        assert.ok(len >= 22 * 3600 && len <= 26 * 3600, `${zone} day length ${len / 3600} h before ${d.month}/${d.day}`);
      }
      prev = s;
      d = addDays(d.year, d.month, d.day, 1);
    }
  }
});

test('month grid: 6 weeks, Monday or Sunday first, spring and autumn DST days', () => {
  const g = monthGrid(utc, 2026, 10, 1);
  assert.equal(g.cells.length, 42);
  assert.equal(g.cells[0].key, '2026-09-28');
  assert.equal(g.cells[0].dow, 1);
  assert.equal(g.cells[3].key, '2026-10-01');
  assert.ok(g.cells[3].inMonth && !g.cells[2].inMonth);
  assert.equal(g.cells[41].key, '2026-11-08');
  assert.ok(g.cells.every((c) => c.length === 86400));
  const sun = monthGrid(utc, 2026, 10, 0);
  assert.equal(sun.cells[0].key, '2026-09-27');
  assert.equal(sun.cells[0].dow, 0);
  const berlin = createFormatter(() => 'Europe/Berlin');
  const march = monthGrid(berlin, 2026, 3, 1);
  assert.equal(march.cells.find((c) => c.key === '2026-03-29').length, 23 * 3600);
  const oct = monthGrid(berlin, 2026, 10, 1);
  assert.equal(oct.cells.find((c) => c.key === '2026-10-25').length, 25 * 3600);
  // cells tile the timeline without gaps
  for (let i = 1; i < 42; i++) assert.equal(oct.cells[i].start, oct.cells[i - 1].end);
  // a 6-row grid starting a month whose first day is a Monday keeps 6 rows
  assert.equal(monthGrid(utc, 2024, 4, 1).cells[0].key, '2024-04-01');
});

test('month bands: segments tile every day, boundaries sit at their time of day', () => {
  for (const overlay of [2, 3, 4, 5, 6, 'sync']) {
    const m = buildMonth(model, kyiv, { year: 2026, month: 10, weekStart: 1, overlay });
    for (const c of m.cells) {
      assert.ok(c.inRange);
      assert.ok(c.segments.length >= 1, `${overlay} ${c.key}`);
      assert.equal(c.segments[0].x0, 0, `${overlay} ${c.key} starts at 0`);
      assert.equal(c.segments.at(-1).x1, 1, `${overlay} ${c.key} ends at 1`);
      for (let i = 1; i < c.segments.length; i++) near(c.segments[i].x0, c.segments[i - 1].x1, 1e-9, 'contiguous');
      for (const s of c.segments) {
        if (s.startsHere) near(s.x0, (s.start - c.start) / c.length, 1e-12);
        assert.ok(s.x1 > s.x0);
      }
    }
  }
  // the ε boundary of vector A (cur.end): which cell and how far across
  const eps = model.levelAt(A, 4);
  const m = buildMonth(model, utc, { year: 2026, month: 10, weekStart: 1, overlay: 4 });
  const cell = m.cells.find((c) => eps.end >= c.start && eps.end < c.end);
  const seg = cell.segments.find((s) => s.startsHere && Math.abs(s.start - eps.end) < 1e-6);
  assert.ok(seg, 'the next ε starts on its day');
  near(seg.x0, (eps.end - cell.start) / 86400, 1e-9);
  assert.equal(seg.label, 'ε#1', 'ε#5 is followed by ε#1 of the next δ');
  assert.equal(cell.key, '2026-10-17');
  near(seg.x0 * 24, 14.19, 0.01, 'starts about 14:11 UTC');
});

test('month bands: DST day, solar quarters and out-of-range days', () => {
  const berlin = createFormatter(() => 'Europe/Berlin');
  const m = buildMonth(model, berlin, { year: 2026, month: 3, weekStart: 1, overlay: 6 });
  const dst = m.cells.find((c) => c.key === '2026-03-29');
  assert.equal(dst.length, 23 * 3600);
  const total = dst.segments.reduce((a, s) => a + (s.x1 - s.x0), 0);
  near(total, 1, 1e-9);
  // 4-day sync = four quarters, one per day, labelled by the threshold that starts them
  const s = buildMonth(model, utc, { year: 2026, month: 10, weekStart: 1, overlay: 'sync' });
  const names = new Set(s.cells.flatMap((c) => c.segments.map((x) => x.name)));
  assert.deepEqual([...names].sort(), ['node', 'peak', 'start', 'valley']);
  const seg = s.cells.flatMap((c) => c.segments).find((x) => x.sync === 4820 && x.q === 1);
  near(seg.start, model.solarAt(A).start + (model.solarAt(A).end - model.solarAt(A).start) / 4, 1e-3);
  assert.equal(seg.label, 'S4820 · peak');
  // before the catalogue: greyed days without bands
  const early = buildMonth(model, utc, { year: 1613, month: 5, weekStart: 1, overlay: 4 });
  const may18 = early.cells.find((c) => c.key === '1613-05-18');
  const may20 = early.cells.find((c) => c.key === '1613-05-20');
  assert.equal(may18.inRange, false);
  assert.equal(may18.segments.length, 0);
  assert.equal(may20.inRange, true);
  assert.ok(may20.segments.length >= 1);
  const may19 = early.cells.find((c) => c.key === '1613-05-19');
  assert.equal(may19.eclipse, 0, 'the first eclipse falls on this day');
  assert.ok(may19.segments[0].x0 > 0.7, 'the band starts at 17:41, after 70% of the day');
  const late = buildMonth(model, utc, { year: 2857, month: 6, weekStart: 1, overlay: 4 });
  assert.equal(late.cells.find((c) => c.key === '2857-06-14').inRange, false);
  assert.equal(late.cells.find((c) => c.key === '2857-06-13').eclipse, 69);
});

test('cyclesInWindow / syncQuartersInWindow: ordered, contiguous, correct local numbers', () => {
  const t0 = A - 40 * 86400;
  const t1 = A + 40 * 86400;
  for (const L of [3, 4, 5, 6, 8]) {
    const cs = cyclesInWindow(model, L, t0, t1);
    assert.ok(cs.length >= 1);
    for (let i = 1; i < cs.length; i++) {
      assert.equal(cs[i].idx, cs[i - 1].idx + 1);
      assert.equal(cs[i].start, cs[i - 1].end);
    }
    assert.ok(cs[0].start <= t0 + 1e-6 && cs.at(-1).end >= t1 - 1e-6);
    const cur = cs.find((c) => c.start <= A && c.end > A);
    const l = model.levelAt(A, L);
    assert.equal(cur.idx, l.cycle);
    assert.equal(cur.local, l.local);
    near(cur.start, l.start, 1e-3);
  }
  const q = syncQuartersInWindow(model, t0, t1);
  assert.ok(q.length >= 40 && q.length % 4 === 0);
  for (let i = 1; i < q.length; i++) near(q[i].start, q[i - 1].end, 1e-6);
  assert.deepEqual(syncQuartersInWindow(model, model.tMax + 1000, model.tMax + 2000), []);
});

test('year ribbon and summary', () => {
  const r = yearRibbon(model, utc, 2026);
  assert.equal(r.months.length, 12);
  near(r.months.at(-1).x1, 1, 1e-12);
  near(r.months[0].x1, 31 / 365, 1e-12);
  assert.ok(r.delta.length >= 4 && r.delta.length <= 6);
  assert.ok(r.eps.length >= 21 && r.eps.length <= 24);
  for (const t of [...r.delta, ...r.eps]) assert.ok(t.x >= 0 && t.x < 1);
  const s = yearSummary(model, utc, 2026);
  near(s.delta.cover, 365 / 81.05, 0.15);
  near(s.eps.cover, 365 / 16.21, 0.3);
  assert.match(s.text, /^2026 covers 4\.\d δ cycles \(.*\) and 22\.\d ε cycles$/);
  assert.match(yearSummary(model, utc, 1500).text, /outside the catalogue/);
  const leap = yearRibbon(model, utc, 2024);
  near(leap.months[1].x1 - leap.months[1].x0, 29 / 366, 1e-12);
  assert.equal(overlayById('sync').id, 'sync');
  assert.equal(overlayById(99).id, 4, 'unknown overlay falls back to epsilon');
});

// ---------------------------------------------------------------------------------------------
// robustness
// ---------------------------------------------------------------------------------------------
test('jump: more notations', () => {
  assert.equal(first('Sept 5 2031').time, Date.UTC(2031, 8, 5) / 1000);
  assert.equal(first('5 sept 2031 18:45').time, Date.UTC(2031, 8, 5, 18, 45) / 1000);
  assert.equal(first('NEXT Ε').kind, 'boundary', 'upper-case Greek');
  assert.equal(first('last ζ').kind, 'boundary');
  assert.equal(first('Α6 Β4 Γ9').kind, 'cycle');
  assert.equal(first('α6 › β4 › γ9').time, first('a6 b4 g9').time);
  const feb29 = Date.UTC(2028, 1, 29, 12) / 1000;
  assert.equal(first('+1y', { now: feb29 }).time, Date.UTC(2029, 1, 28, 12) / 1000, 'a leap day plus a year clamps to Feb 28');
  assert.equal(first('-1mo', { now: Date.UTC(2026, 2, 31, 8) / 1000 }).time, Date.UTC(2026, 1, 28, 8) / 1000);
  assert.equal(first('IN 2 WEEKS').time, A + 14 * 86400);
  assert.equal(first('  +3 d  ').time, A + 3 * 86400);
  assert.equal(first('2031-06-01   14:30').time, Date.UTC(2031, 5, 1, 14, 30) / 1000);
  assert.equal(first('2031-06-01 2:30 pm').time, Date.UTC(2031, 5, 1, 14, 30) / 1000);
  assert.equal(first('2031-06-01 12am').time, Date.UTC(2031, 5, 1, 0) / 1000);
  assert.equal(first('2031-06-01 12pm').time, Date.UTC(2031, 5, 1, 12) / 1000);
  assert.match(first('2031-06-01 13pm').error, /12-hour clock/);
});

test('jump: random input never throws and always answers with well-formed candidates', () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz αβγδεζηθικλμνξΑΒΓ0123456789.,:;+-–−/#@[]()<>›·_*$%^&!?\t"\'\\|~';
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const words = ['next', 'prev', 'sync', 'pos', 'unix', 'in', 'ago', 'today', 'tomorrow', 'peak', 'end', 'of', 'Jun', 'depth', 'd7', 'ε', 'η', '2031', '-', '+', '#', '13,0', '[', ']', 'T', 'Z', 'UTC'];
  for (let i = 0; i < 4000; i++) {
    let s = '';
    const n = 1 + Math.floor(rnd() * 12);
    for (let k = 0; k < n; k++) s += rnd() < 0.45 ? words[Math.floor(rnd() * words.length)] + (rnd() < 0.6 ? ' ' : '') : alphabet[Math.floor(rnd() * alphabet.length)];
    const r = jump(s);
    assert.ok(Array.isArray(r), s);
    for (const c of r) {
      assert.equal(typeof c.label, 'string', s);
      assert.ok(c.kind === 'error' ? c.time === null && typeof c.error === 'string' : Number.isFinite(c.time) && model.inRange(c.time), `${JSON.stringify(s)} -> ${JSON.stringify(c)}`);
    }
    if (r.some((c) => c.kind !== 'error')) assert.ok(r.every((c) => c.kind !== 'error'), 'errors are only returned when nothing parsed: ' + s);
  }
});

// ---------------------------------------------------------------------------------------------
// regression tests for the review fixes
// ---------------------------------------------------------------------------------------------
const zoneFmt = (zone) => createFormatter(() => zone);

test('local time -> instant: a skipped time moves ahead, a repeated one is the first, in every zone', () => {
  // (core zonedToUnix follows these rules only west of Greenwich; the module uses localToUnix)
  const cases = [
    // zone, gap fields, fold fields, [pre-change offset, post-change offset] of the spring change in seconds
    ['Europe/Berlin', { year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, { year: 2026, month: 10, day: 25, hour: 2, minute: 30 }],
    ['Europe/Kyiv', { year: 2026, month: 3, day: 29, hour: 3, minute: 30 }, { year: 2026, month: 10, day: 25, hour: 3, minute: 30 }],
    ['America/New_York', { year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, { year: 2026, month: 11, day: 1, hour: 1, minute: 30 }],
    ['Australia/Sydney', { year: 2026, month: 10, day: 4, hour: 2, minute: 30 }, { year: 2026, month: 4, day: 5, hour: 2, minute: 30 }],
    ['Pacific/Auckland', { year: 2026, month: 9, day: 27, hour: 2, minute: 30 }, { year: 2026, month: 4, day: 5, hour: 2, minute: 30 }],
  ];
  for (const [zone, gap, fold] of cases) {
    const g = localToUnix(gap, zone);
    assert.equal(localTimeIssue(gap, zone), 'gap', zone);
    // forward: the instant reads exactly one hour after the requested wall time
    const p = zonedParts(g, zone);
    assert.deepEqual([p.day, p.hour, p.minute], [gap.day, gap.hour + 1, gap.minute], `${zone} gap resolves forward`);
    const f = localToUnix(fold, zone);
    assert.equal(localTimeIssue(fold, zone), 'fold', zone);
    const q = zonedParts(f, zone);
    assert.deepEqual([q.day, q.hour, q.minute], [fold.day, fold.hour, fold.minute], `${zone} fold reads the wall time`);
    const later = zonedParts(f + 3600, zone);
    assert.deepEqual([later.day, later.hour, later.minute], [fold.day, fold.hour, fold.minute], `${zone}: the same wall time an hour later, so ${zone} resolved to the first`);
    // an ordinary time is untouched
    assert.equal(localToUnix({ year: 2026, month: 6, day: 1, hour: 12 }, zone), zonedToUnix({ year: 2026, month: 6, day: 1, hour: 12 }, zone));
    assert.equal(localTimeIssue({ year: 2026, month: 6, day: 1, hour: 12 }, zone), null);
  }
  assert.equal(localToUnix({ year: 2031, month: 6, day: 1, hour: 14, minute: 30, ms: 250 }, 'UTC'), Date.UTC(2031, 5, 1, 14, 30) / 1000 + 0.25);
  // years before 100 are not shifted into the 1900s
  assert.equal(localToUnix({ year: 50, month: 6, day: 1 }, 'UTC'), -120534393600, 'year 50, not 1950');
});

test('jump: a wall time that does not exist or happens twice is flagged, not silently moved', () => {
  const berlin = { fmt: zoneFmt('Europe/Berlin'), zone: 'Europe/Berlin' };
  const gap = first('2026-03-29 02:30', berlin);
  assert.equal(gap.kind, 'date');
  assert.match(gap.detail, /02:30 does not exist there/);
  assert.equal(gap.time, localToUnix({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, 'Europe/Berlin'));
  const fold = first('2026-10-25 02:30', berlin);
  assert.match(fold.detail, /happens twice/);
  assert.doesNotMatch(first('2026-06-01 02:30', berlin).detail, /does not exist|happens twice/);
  assert.match(first('2026-03-29 02:30 UTC', berlin).detail, /input read as UTC/, 'an explicit offset has no gap');
});

test('days a zone skipped altogether have no instants (Pacific/Apia 2011-12-30), neighbours stay 24 h', () => {
  for (const [zone, y, m, key, prev] of [
    ['Pacific/Apia', 2011, 12, '2011-12-30', '2011-12-29'],
    ['Pacific/Kiritimati', 1994, 12, '1994-12-31', '1994-12-30'],
    ['Asia/Manila', 1844, 12, '1844-12-31', '1844-12-30'],
  ]) {
    const g = monthGrid(zoneFmt(zone), y, m, 1);
    const skipped = g.cells.find((c) => c.key === key);
    assert.equal(skipped.length, 0, `${zone} ${key} is not a day`);
    assert.equal(skipped.skipped, true);
    assert.equal(g.cells.find((c) => c.key === prev).length, 86400, `${zone} ${prev} keeps all 24 hours`);
    for (let i = 1; i < 42; i++) assert.equal(g.cells[i].start, g.cells[i - 1].end, 'cells still tile the timeline');
    const month = buildMonth(model, zoneFmt(zone), { year: y, month: m, weekStart: 1, overlay: 4 });
    const cell = month.cells.find((c) => c.key === key);
    assert.deepEqual([cell.segments.length, cell.inRange, cell.eclipse], [0, false, -1], 'no band, no eclipse on a skipped date');
    // the day after still begins exactly where the skipped one ends
    assert.ok(month.cells.find((c) => c.key === prev).segments.every((s) => s.x1 <= 1 && s.x0 >= 0));
  }
  assert.equal(dayStart('Pacific/Apia', 2011, 12, 30), dayStart('Pacific/Apia', 2011, 12, 31));
  // Sitka's 1867 change repeats a date: that day really lasts 48 elapsed hours, and is a single cell
  const sitka = monthGrid(zoneFmt('America/Sitka'), 1867, 10, 1);
  assert.equal(sitka.cells.find((c) => c.key === '1867-10-19').length, 48 * 3600);
});

test('ISO strings of zones with offsets that have seconds round-trip (local mean time before ~1900)', () => {
  const berlin = zoneFmt('Europe/Berlin');
  const t = Date.UTC(1792, 5, 28, 6, 43, 38) / 1000 + 0.624;
  assert.equal(zonedParts(t, 'Europe/Berlin').offset % 60, 28, 'the zone had +00:53:28 then');
  const iso = isoWithMs(berlin, t);
  assert.match(iso, /\+00:53:28$/);
  near(first(iso, { fmt: berlin, zone: 'Europe/Berlin', now: t }).time, t, 1e-3, 'the ISO string reproduces the instant');
  assert.equal(isoOffset(10800), '+03:00');
  assert.equal(isoOffset(-19800), '-05:30');
  assert.equal(isoOffset(3208), '+00:53:28');
  assert.equal(isoWithMs(utc, A), '2026-10-08T12:00:00.000+00:00');
});

test('jump: years before 1000 are refused (0050 is not 1950), the catalogue edges are reachable', () => {
  assert.match(first('0050-06-01').error, /Year 50 is not supported/);
  assert.match(first('0000-02-29').error, /Year 0 is not supported/);
  assert.match(parseDateText('0050-06-01').error, /Year 50/);
  assert.match(first('1000-06-01').error, /before the catalogue starts/, 'year 1000 is a valid date outside the catalogue');
  // a date, month or year that contains the first instant of the catalogue lands on it instead of contradicting itself
  for (const txt of ['1613-05-19', '1613', 'May 1613', '19 May 1613']) {
    const c = first(txt);
    assert.equal(c.kind, 'date', txt);
    assert.equal(c.time, model.tMin, txt);
    assert.match(c.detail, /the catalogue starts during this/, txt);
  }
  assert.match(first('1613-05-18').error, /before the catalogue starts \(1613-05-19 17:41:53 UTC\)/, 'a day before it names the exact start');
  assert.match(first('1613-01').error, /before the catalogue starts \(1613-05-19 UTC\)/, 'a month entirely before it');
  // a time of day on the last / first date reads against the exact edge, not a contradictory date
  assert.match(first('2857-06-13 10:00').error, /^2857-06-13 10:00 is after the catalogue ends \(2857-06-13 09:33:55 UTC\)/);
  assert.match(first('1613-05-19 10:00').error, /^1613-05-19 10:00 is before the catalogue starts \(1613-05-19 17:41:53 UTC\)/);
  assert.equal(first('2857-06-13 09:00').kind, 'date');
  assert.equal(first('2857-06-13').kind, 'date');
  assert.equal(rangeProblem(model, model.tMin - 10), 'before the catalogue starts (1613-05-19 17:41:53 UTC)');
  assert.equal(utcStamp(model.tMax), '2857-06-13 09:33:55');
  assert.equal(rangeProblem(model, model.tMin - 5 * 86400), 'before the catalogue starts (1613-05-19 UTC)');
  assert.equal(rangeProblem(model, A), null);
});

test('jump: offsets (with seconds, the +14 limit), the Unicode minus and the # index limit', () => {
  assert.equal(first('2031-06-01 14:30 +14:00').time, Date.UTC(2031, 5, 1, 0, 30) / 1000);
  assert.match(first('2031-06-01 14:30 +15:00').error, /not a valid UTC offset/);
  assert.equal(first('2031-06-01T14:30:00+00:53:28').time, Date.UTC(2031, 5, 1, 14, 30) / 1000 - 3208);
  assert.equal(first('−3d').time, A - 3 * 86400, 'U+2212 as printed in the labels');
  assert.equal(first('−2h30m').time, A - 9000);
  const count = Number(model.clock.count(6));
  assert.equal(first(`d7#${count - 1}`).kind, 'cycle', 'the last index exists');
  assert.match(first(`d7#${count}`).error, /Eta has only/, 'the count itself does not');
  assert.equal(first('now').live, true, '"now" asks the app to follow the device clock again');
  assert.equal(first('+3d').live, undefined);
});

test('jump: recent-jump replay keeps the chosen interpretation and bad stored history is dropped', () => {
  const both = jump('03/04/2031');
  assert.deepEqual(both.map((c) => c.kind), ['date', 'date']);
  assert.notEqual(both[0].label, both[1].label, 'kind + label tell the interpretations apart');
  assert.deepEqual(sanitizeHistory({ items: 5 }.items), []);
  assert.deepEqual(sanitizeHistory(null), []);
  assert.deepEqual(sanitizeHistory('abc'), []);
  assert.deepEqual(sanitizeHistory({}), []);
  assert.deepEqual(
    sanitizeHistory([null, 3, { text: 5 }, { text: '' }, { text: '+3d', label: { x: 1 }, kind: 7 }, { text: 'sync 4820', label: 'Solar sync 4820 · start', kind: 'sync' }]),
    [
      { text: '+3d', label: '', kind: '' },
      { text: 'sync 4820', label: 'Solar sync 4820 · start', kind: 'sync' },
    ],
  );
  assert.equal(sanitizeHistory(Array.from({ length: 30 }, (_, i) => ({ text: 't' + i }))).length, 8);
});

test('empty position fields are missing, not zero', () => {
  assert.match(timeOfPositionParts(model, '', '').error, /ordinal must be a whole number/);
  assert.match(timeOfPositionParts(model, '  ', '0.5').error, /ordinal must be a whole number/);
  assert.equal(timeOfPositionParts(model, '0', '').t, model.catalogue[0], 'an explicit 0 is fine');
  assert.equal(timeOfPositionParts(model, 22, '0.5').t, (model.catalogue[22] + model.catalogue[23]) / 2);
});

test('month navigation clamps the month index as a whole', () => {
  assert.deepEqual(clampMonth(1613, 0), { year: 1613, month: 1 }, 'previous at the first month stays');
  assert.deepEqual(clampMonth(1612, 12), { year: 1613, month: 1 });
  assert.deepEqual(clampMonth(2857, 13), { year: 2857, month: 12 }, 'next at the last month stays');
  assert.deepEqual(clampMonth(2858, 1), { year: 2857, month: 12 });
  assert.deepEqual(clampMonth(2026, 0), { year: 2025, month: 12 });
  assert.deepEqual(clampMonth(2026, 13), { year: 2027, month: 1 });
  assert.deepEqual(clampMonth(2026, 10), { year: 2026, month: 10 });
});

test('landOn with a check lands on the state that begins at the boundary even when floats disagree by an ulp', () => {
  let bare = 0;
  let total = 0;
  for (const L of [9, 12, 13]) {
    for (let k = 0; k < 16; k++) {
      for (const base of [1.0e10, 2.0e9, 2.4e10, 2.7e10]) {
        for (const o of model.stateOccurrences(L, [k], base, { direction: 1, count: 5 })) {
          total++;
          const shows = (c) => model.levelAt(c, L)?.index === k;
          if (!shows(landOn(model, o.start))) bare++;
          const t = landOn(model, o.start, undefined, shows);
          assert.ok(shows(t), `L${L} state ${k} at ${o.start}`);
          assert.ok(t - o.start < 0.0045, 'at most a few ms after the boundary');
        }
      }
    }
  }
  assert.ok(bare > 0, `the sample really contains boundaries where the plain landing is one state early (${bare}/${total})`);
});

test('long cycles carry their years in labels', () => {
  const gamma = model.levelAt(A, 2);
  const a = spanLabel(utc, gamma.start, A, gamma.start, gamma.end);
  const b = spanLabel(utc, gamma.end, A, gamma.start, gamma.end);
  assert.match(a, /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.notEqual(a.slice(0, 4), b.slice(0, 4), 'the ends of a 1.1 year cycle are told apart by their year');
  const eps = model.levelAt(A, 4);
  assert.match(spanLabel(utc, eps.start, A, eps.start, eps.end), /^[A-Z][a-z]{2} \d+ \d\d:\d\d$/, 'a 16-day cycle keeps the compact label');
  // a cycle that is short but crosses new year still names its years
  const nye = Date.UTC(2026, 11, 28, 12) / 1000;
  assert.match(spanLabel(utc, nye, nye, nye - 3 * 86400, nye + 10 * 86400), /^2026-12-28/);
});

test('hear this moment: hidden without the sound module, toasts when audio is blocked or out of range', async () => {
  const toasts = [];
  const mk = (sound) => ({ modules: sound === undefined ? {} : { sound }, toast: (m) => toasts.push(m) });
  assert.equal(hasSound(mk(undefined)), false);
  assert.equal(hasSound(mk({})), false);
  assert.equal(await hearMoment(mk(undefined), A), false);
  assert.deepEqual(toasts, [], 'silently nothing: the button is hidden in that case');
  const played = [];
  assert.equal(hasSound(mk({ playMoment: async () => null })), true);
  assert.equal(await hearMoment(mk({ playMoment: async (t) => (played.push(t), { t, notes: [] }) }), A + 5), true);
  assert.deepEqual(played, [A + 5], 'the instant shown is what is played');
  assert.equal(await hearMoment(mk({ playMoment: async () => null }), model.tMax + 10), false);
  assert.match(toasts.at(-1), /Outside the Saros 141 catalogue/);
  assert.equal(
    await hearMoment(
      mk({
        playMoment: async () => {
          throw new Error('The browser blocks audio until you click or press a key on this page');
        },
      }),
      A,
    ),
    false,
  );
  assert.match(toasts.at(-1), /^Audio could not start: The browser blocks audio/);
});

test('more edge branches: rounding carry of the exact position, "after", clipped final cycles in the year summary', () => {
  assert.equal(exactPosition(model, A, 0), '23.0', '22.9278… rounds up and carries into the whole part');
  assert.equal(exactPosition(model, A, 1), '22.9');
  near(first('after ε').time, first('next ε').time, 1e-9, '"after" is "next"');
  assert.notEqual(first('before ε').time, first('after ε').time);
  const last = yearSummary(model, utc, 2857);
  assert.ok(last.delta.cover > 1.5 && last.delta.cover < 2.5, 'the clipped final δ counts as a mean-length cycle: ' + last.delta.cover);
  assert.ok(last.eps.cover > 9 && last.eps.cover < 11, 'ε coverage ' + last.eps.cover);
});

test('catalogue facts the other tests lean on: year summary at the last year, dotted states, the half-syncs', () => {
  assert.match(yearSummary(model, utc, 2857).text, /^2857 covers \d\.\d δ cycles .* and \d+\.\d ε cycles$/);
  assert.equal(stateMeaning(model, 4).dotted, false, 'a peak is not on the falling branch');
  assert.equal(stateMeaning(model, 12).dotted, false, 'neither is a valley');
  assert.equal(stateMeaning(model, 5).dotted, true);
  assert.equal(stateMeaning(model, 3).dotted, false);
  const edge = buildMonth(model, utc, { year: 2857, month: 6, weekStart: 1, overlay: 'sync' });
  const c13 = edge.cells.find((c) => c.key === '2857-06-13');
  assert.equal(c13.inRange, true);
  assert.equal(c13.segments.length, 0, 'the last half-sync has no complete quarters: the day is in range but has no band');
});

// ---------------------------------------------------------------------------------------------
// audit round: one notation (ε#5 is an ordinal, "ε 5" is a depth chip), safe input, DST notes, floored percent
// ---------------------------------------------------------------------------------------------
const ord = (level, t) => model.levelAt(t, level).local + 1;

test('notation: an ordinal is written with a hash everywhere this module prints one', () => {
  assert.equal(cycleLabel(4, 5), 'ε#5');
  assert.equal(pathText([6, 4, 9]), 'α#6 β#4 γ#9');
  assert.equal(chainText([6, 4, 9]), 'α#6 › β#4 › γ#9');
  assert.equal(chainText([3, 5], 3), 'δ#3 › ε#5', 'a path that starts below alpha keeps its own letters');
  assert.equal(addressText(model, A), 'α#6 β#4 γ#9 δ#3 ε#5');
  // month cells, the ribbon and the year summary use it too, never the bare "ε 5" of the depth chip
  const m = buildMonth(model, utc, { year: 2026, month: 10, weekStart: 1, overlay: 4 });
  const segs = m.cells.flatMap((c) => c.segments);
  assert.ok(segs.length > 5);
  for (const sg of segs) {
    assert.match(sg.label, /^ε#\d$/, sg.label);
    assert.equal(sg.short, '#' + sg.label.slice(2));
  }
  const r = yearRibbon(model, utc, 2026);
  for (const t of [...r.delta, ...r.eps]) assert.match(t.label, /^[δε]#\d+$/);
  assert.match(yearSummary(model, utc, 2026).text, /\(γ#\d+·δ#\d+( … γ#\d+·δ#\d+)?\)/);
  // everything the parser accepts for the same cycle
  const full = first('α#6 β#4 γ#9 δ#3 ε#5').time;
  for (const txt of ['α6 β4 γ9 δ3 ε5', 'a6.b4.g9.d3.e5', '6.4.9.3.5', 'α#6 › β#4 › γ#9 › δ#3 › ε#5', 'α # 6 β # 4 γ # 9 δ # 3 ε # 5', 'alpha#6 beta#4 gamma#9 delta#3 epsilon#5']) {
    assert.equal(first(txt).time, full, txt);
  }
});

test('notation: a month-cell label typed into the jump box lands on that very cycle', () => {
  for (const overlay of [3, 4, 5, 6]) {
    let n = 0;
    for (let month = 1; month <= 12; month++) {
      const m = buildMonth(model, utc, { year: 2026, month, weekStart: 1, overlay });
      for (const c of m.cells) {
        for (const sg of c.segments) {
          if (!sg.startsHere || n >= 40) continue;
          // the ancestors come from the displayed time, so display a moment inside that cycle
          const c0 = first(sg.label, { now: sg.start + 1 });
          assert.equal(c0.kind, 'cycle', sg.label);
          near(c0.time, sg.start, 0.0011, `${overlay} ${sg.label}`);
          assert.equal(model.levelAt(c0.time, sg.level).cycle, sg.idx);
          n++;
        }
      }
    }
    assert.ok(n >= 3, `level ${overlay}: ${n} cycles checked`);
  }
});

test('notation: the spaced form "ζ 6" is ambiguous, so it says which reading it took and offers the other', () => {
  const zeta = model.levelAt(A, 5);
  assert.equal(zeta.local + 1, 4, 'vector A: the running ζ is the 4th of 7 (the ladder row reads "ζ 6 · 4 / 7")');
  const r = jump('ζ 6');
  assert.equal(r.length, 2);
  // first: the old reading, the 6th ζ of the current ε, spelled out in words
  assert.equal(r[0].label, 'The 6th ζ in the current ε');
  assert.equal(r[0].time, first('ζ#6').time);
  assert.deepEqual(pathOfTime(model, r[0].time, 6), [6, 4, 9, 3, 5, 6]);
  // second: the depth reading, the zeta that is running (what the ladder's chip shows)
  assert.equal(r[1].label, 'The running ζ (depth 6)');
  near(r[1].time, zeta.start, 0.0011);
  assert.equal(model.levelAt(r[1].time, 5).cycle, zeta.cycle);
  assert.match(r[1].detail, /ζ#4 · 4 \/ 7 in its ε/);
  assert.equal(r[1].time, first('ζ#4').time, 'the depth reading is the cell the calendar labels ζ#4');
  // no depth reading when the number is not the letter's own depth (ε is depth 5), or when the form is explicit
  assert.equal(jump('ε 6').length, 1);
  assert.equal(jump('ζ#6').length, 1);
  assert.equal(jump('ζ6').length, 1);
  // when both readings meet at the same instant it is still one candidate
  assert.equal(jump('ε 5').length, 1);
  assert.equal(first('ε 5').label, 'The 5th ε in the current δ');
  // the whole-address forms are never ambiguous: a chain needs no words
  assert.equal(first('δ 3 ε 5').label, 'δ#3 › ε#5 in the current γ');
  assert.equal(first('α 6 › β 4 › γ 9').label, 'α#6 › β#4 › γ#9');
  // alpha has no parent to name
  assert.equal(first('α 6').label, 'α#6');
  assert.equal(jump('α 1').length, 2, 'α 1 is both the first alpha and the running one when depth 1 = α');
  // out of range as an ordinal (ξ has 4 per parent), fine as a depth: the depth reading is not hidden behind the error
  const xi = jump('ξ 14');
  assert.equal(xi.length, 1);
  assert.equal(xi[0].label, 'The running ξ (depth 14)');
  assert.equal(xi[0].kind, 'cycle');
});

test('notation: a letter before # is never the global index, errors say how to write it', () => {
  const c = first('ε#6');
  assert.equal(c.kind, 'error');
  assert.match(c.error, /Epsilon has only 5 cycles in a Delta/);
  assert.match(c.detail, /ε#1 … ε#5/);
  assert.match(c.detail, /d5#6/);
  assert.match(first('ε#0').error, /start at 1/);
  assert.match(first('α#19').error, /only 18 Alpha cycles/);
  assert.match(first('α#19').detail, /^$|./); // (no throw)
  assert.match(first('α6 β6').detail, /β#1 … β#5/, 'the range in the error uses the hash too');
  assert.match(first('α6 γ3').detail, /α#6 β#3 γ#11/, 'the example in the hint uses the hash');
  assert.match(first('α18 β3').error, /α#18 β#3 starts after the catalogue ends/);
  // the global index keeps its own spelling
  const eta = model.levelAt(A, 6);
  const g = first('d7#' + eta.cycle);
  assert.match(g.label, /^η global index 717211 · α#6 β#4 γ#9 δ#3 ε#5 ζ#4 η#/);
  assert.doesNotMatch(g.label, /η#717211/);
});

test('boundaries say which cycles meet there, in the same notation as the calendar', () => {
  const z = ord(5, A);
  const next = first('next ζ');
  assert.equal(next.label, 'Next ζ boundary');
  assert.match(next.detail, new RegExp(`ζ#${z} ends · ζ#${z + 1} starts`), 'Up next says "ζ 6 ends", this says what ends and what starts');
  const e = ord(4, A);
  assert.match(first('next ε').detail, new RegExp(`ε#${e} ends · ε#1 starts`), 'the last ε of a δ is followed by ε#1');
  assert.match(first('prev ζ').detail, new RegExp(`ζ#${z - 1} ends · ζ#${z} starts`));
  assert.match(first('next peak η', {}).detail, new RegExp(`in η#${ord(6, first('next peak η').time)}`));
  // the first/last boundary of the whole catalogue
  const lastEnd = first('next α', { now: model.tMax - 10 });
  assert.ok(lastEnd.kind === 'error' || /catalogue ends/.test(lastEnd.detail));
});

test('"next peak" without a level uses the selected level, or explains what is missing', () => {
  const bare = first('next peak');
  assert.equal(bare.kind, 'error');
  assert.match(bare.error, /needs a level/);
  assert.match(bare.detail, /next peak η/);
  for (const [txt, word] of [['next peak', 'peak'], ['next node', 'node'], ['next valley', 'valley'], ['next end', 'end'], ['prev peak', 'peak'], ['next 2 node', 'node']]) {
    const c = first(txt, { level: 6 });
    assert.equal(c.kind, 'boundary', txt);
    const explicit = first(txt.replace(word, `${word} η`), {});
    assert.equal(c.time, explicit.time, `${txt} == ${txt} η`);
    assert.match(c.label, /η/, 'the level in use is named');
  }
  assert.equal(first('next peak', { level: 4 }).time, first('next peak ε').time);
  assert.equal(jump('next peak', { level: 99 })[0].kind, 'error', 'a level that does not exist is no level');
});

test('jump: slashes follow the locale (dayFirst), the label says which reading it is', () => {
  const dm = Date.UTC(2031, 0, 6, 14, 30) / 1000;
  const md = Date.UTC(2031, 5, 1, 14, 30) / 1000;
  assert.deepEqual(jump('06/01/2031 14:30').map((c) => c.time), [dm, md], 'default: day/month first');
  assert.deepEqual(jump('06/01/2031 14:30', { dayFirst: true }).map((c) => c.time), [dm, md]);
  const us = jump('06/01/2031 14:30', { dayFirst: false });
  assert.deepEqual(us.map((c) => c.time), [md, dm], 'a month-first locale reads June 1 first');
  assert.match(us[0].label, /month\/day/);
  assert.match(us[1].label, /day\/month/);
  assert.equal(jump('31/12/2031', { dayFirst: false }).length, 1, 'unambiguous stays unambiguous');
  assert.equal(jump('06/06/2031', { dayFirst: false }).length, 1);
  // dashes are day first unless the locale is month first
  assert.deepEqual(jump('06-01-2031').map((c) => c.time), [Date.UTC(2031, 0, 6) / 1000]);
  assert.equal(jump('06-01-2031', { dayFirst: false })[0].time, Date.UTC(2031, 5, 1) / 1000);
  assert.equal(first('2031-06-01', { dayFirst: false }).time, Date.UTC(2031, 5, 1) / 1000, 'ISO needs no ranking');
  assert.equal(first('1 Jun 2031', { dayFirst: false }).time, Date.UTC(2031, 5, 1) / 1000, 'month names are unambiguous');
  // the locale probe
  assert.equal(dayFirstOfLocale('en-US'), false);
  assert.equal(dayFirstOfLocale('en-GB'), true);
  assert.equal(dayFirstOfLocale('de-DE'), true);
  assert.equal(dayFirstOfLocale('not a locale!!'), undefined);
});

test('jump: a zone or city after the time is understood, an unknown one is explained', () => {
  const at = (h, mi, off) => Date.UTC(2031, 5, 1, h, mi) / 1000 - off * 3600;
  assert.equal(first('2031-06-01 14:30 Moscow').time, at(14, 30, 3));
  assert.equal(first('2031-06-01 14:30 Europe/Moscow').time, at(14, 30, 3));
  assert.equal(first('2031-06-01 14:30 europe/moscow').time, at(14, 30, 3));
  assert.equal(first('2031-06-01 14:30 Tokyo').time, at(14, 30, 9));
  assert.equal(first('2031-06-01 14:30 New York').time, at(14, 30, -4));
  assert.equal(first('2031-06-01 14:30 America/New_York').time, at(14, 30, -4));
  assert.equal(first('1 Jun 2031 2pm Kyiv').time, at(14, 0, 3));
  assert.equal(first('14:30 Tokyo').time, Date.UTC(2026, 9, 8, 5, 30) / 1000, 'a bare time on the displayed day, read in Tokyo');
  assert.match(first('2031-06-01 14:30 Moscow').detail, /input read in Europe\/Moscow/);
  assert.equal(first('2031-06-01 Tokyo').time, at(0, 0, 9));
  // an explicit offset still wins, and a city in the app zone changes nothing
  assert.equal(first('2031-06-01 14:30 +03:00').time, at(14, 30, 3));
  // a wall time that does not exist in the NAMED zone is flagged with the same sentence
  const gap = first('2027-03-14 02:30 New York');
  assert.match(gap.detail, /02:30 does not exist there \(the clocks skip it\): moved ahead to 03:30/);
  assert.equal(gap.time, localToUnix({ year: 2027, month: 3, day: 14, hour: 2, minute: 30 }, 'America/New_York'));
  // unknown places are not guessed; the error says what to do
  const bad = first('2031-06-01 14:30 Atlantis');
  assert.equal(bad.kind, 'error');
  assert.match(bad.error, /Cannot read "2031-06-01 14:30 Atlantis"/);
  assert.match(bad.detail, /read in UTC/);
  assert.match(bad.detail, /zone in the header/);
  // words that are not places keep their meaning
  assert.equal(first('2031-06-01 2:30 pm').error, undefined);
  assert.match(first('2031-06-01 25:00 Moscow').error, /Hour 25/);
  // the converter's own fields do not read zone names (they have a zone selector)
  assert.equal(parseGregorian('2031-06-01 14:30 Moscow', { zone: 'UTC' }), null);
  assert.ok(parseGregorian('2031-06-01 14:30 Moscow', { zone: 'UTC', zoneNames: true }).results[0].zone === 'Europe/Moscow');
});

test('jump: any paste answers at once and is never echoed whole into a label', () => {
  assert.equal(MAX_INPUT, 200);
  const sizes = [250, 1000, 20000, 100 * 1024];
  const pastes = [(n) => '1,'.repeat(n / 2), (n) => 'α'.repeat(n), (n) => 'd7 ' + '1,'.repeat(n / 2), (n) => '+' + '9'.repeat(n) + 'd', (n) => 'sync ' + '9'.repeat(n), (n) => '2031-06-01 ' + ' '.repeat(n) + '14:30', (n) => 'x'.repeat(n), (n) => '9'.repeat(n)];
  for (const mk of pastes) {
    for (const n of sizes) {
      const text = mk(n);
      const t0 = performance.now();
      const r = jump(text);
      const ms = performance.now() - t0;
      assert.ok(ms < 50, `${text.slice(0, 12)}… (${text.length}) took ${ms.toFixed(1)} ms`);
      assert.equal(r.length, 1);
      assert.equal(r[0].kind, 'error');
      assert.ok(r[0].label.length <= 80 && r[0].detail.length <= 260, `label ${r[0].label.length} / detail ${r[0].detail.length}`);
      assert.match(r[0].error, /characters/);
    }
  }
  // exactly at the limit it is still read
  assert.equal(jump('2031-06-01' + ' '.repeat(MAX_INPUT - 10))[0].kind, 'date', 'trailing blanks are not text');
  assert.equal(jump('x'.repeat(MAX_INPUT)).length, 1);
  assert.match(jump('x'.repeat(MAX_INPUT))[0].label, /^Cannot read "x{39}…"$/, '"Cannot read" echoes at most ~40 characters');
  // and the converter's parser has the same ceiling
  assert.match(parseGregorian('1'.repeat(1000)).error, /at most 200/);
  assert.match(parseDateText('1'.repeat(100 * 1024)).error, /at most 200/);
  // shorter inputs that still reach the echo sites
  for (const text of ['+' + '9'.repeat(150) + 'd', '@' + '9'.repeat(150), 'tomorrow ' + 'q'.repeat(150), '7'.repeat(190), 'sync ' + '9'.repeat(190), 'unix ' + '9'.repeat(190) + ' ms']) {
    for (const c of jump(text)) assert.ok(c.label.length <= 120 && (c.detail ?? '').length <= 260, `${text.slice(0, 14)}: ${c.label.length}/${c.detail?.length}`);
  }
  assert.equal(clip('abc'), 'abc');
  assert.equal(clip('x'.repeat(100)).length, 40);
  assert.ok(clip('x'.repeat(100)).endsWith('…'));
  assert.equal(sanitizeHistory([{ text: 'a'.repeat(5000), label: 'b'.repeat(5000) }])[0].text.length, MAX_INPUT);
  assert.ok(sanitizeHistory([{ text: 'a', label: 'b'.repeat(5000) }])[0].label.length <= 300);
});

test('jump: offsets and numbers beyond what a date can hold say "after/before the catalogue", never an engine message', () => {
  for (const txt of ['+100000000d', '+9999999999999d', '+99999999999999999999d', '9999999999999999999999 days ago', '-100000000d', 'in 99999999999 weeks', '+99999999999999999999999999 y', '+9'.repeat(1) + '9'.repeat(150) + 'h', '+8000000d', '+4100000d']) {
    const r = jump(txt);
    assert.equal(r.length, 1, txt);
    assert.equal(r[0].kind, 'error', txt);
    assert.match(r[0].error, /is (after the catalogue ends|before the catalogue starts) \(\d{4}-\d\d-\d\d UTC\)/, txt);
    assert.doesNotMatch(r[0].error, /Invalid|NaN|Infinity|RangeError/, txt);
  }
  assert.match(first('+100000000d').error, /after the catalogue ends \(2857-06-13 UTC\)/);
  assert.match(first('9999999999999999999999 days ago').error, /before the catalogue starts \(1613-05-19 UTC\)/);
  assert.match(first('+1000000d').error, /after the catalogue ends/, 'unchanged for the offsets Date can still build');
  // a number/prefix grid never leaks the engine's words
  const prefixes = ['', '+', '-', 'sync ', 'pos ', 'd7#', 'unix ', 'α', 'in ', '@', 'ε#', 'S', 'next ', '1.'];
  const suffixes = ['', 'd', 'y', 'mo', 'h', ' days ago', ' ms', ' weeks', ' node'];
  for (const p of prefixes) {
    for (const n of [1, 5, 18, 20, 100, 190]) {
      for (const sfx of suffixes) {
        const r = jump(p + '9'.repeat(n) + sfx);
        assert.ok(Array.isArray(r), p + n + sfx);
        for (const c of r) assert.doesNotMatch(c.label + ' ' + (c.error ?? ''), /Invalid time|BigInt|Infinity|NaN|undefined|RangeError/, `${p}${'9'.repeat(Math.min(n, 6))}…${sfx}: ${c.label}`);
      }
    }
  }
  // huge sync numbers: friendly, from the parser and from the converter helper alike
  assert.match(first('sync ' + '9'.repeat(190)).error, /Solar sync 9{23}…? is not inside the catalogue/);
  assert.match(first('sync 99999999999999999').error, /not inside the catalogue/);
  assert.equal(solarInfo(model, utc, Infinity), null);
  assert.equal(solarInfo(model, utc, NaN), null);
  assert.equal(solarInfo(model, utc, 1.5), null);
  assert.equal(solarInfo(model, utc, 1e20), null);
  assert.equal(solarInfo(model, utc, -1e300), null);
  assert.equal(solarInfo(model, utc, 4820).sync, 4820);
});

test('wall times a zone does not have exactly once get one sentence, the jump box and the converter share it', () => {
  const ny = zoneFmt('America/New_York');
  const gap = { year: 2027, month: 3, day: 14, hour: 2, minute: 30 };
  const t = localToUnix(gap, 'America/New_York');
  assert.equal(wallTimeNote(gap, 'America/New_York', t, ny), '02:30 does not exist there (the clocks skip it): moved ahead to 03:30');
  assert.equal(wallTimeNote(gap, 'America/New_York', t, ny, 'in America/New York'), '02:30 does not exist in America/New York (the clocks skip it): moved ahead to 03:30');
  const fold = { year: 2026, month: 11, day: 1, hour: 1, minute: 30 };
  assert.equal(wallTimeNote(fold, 'America/New_York', localToUnix(fold, 'America/New_York'), ny), '01:30 happens twice there (the clocks go back): showing the first');
  assert.equal(wallTimeNote({ year: 2026, month: 6, day: 1, hour: 12 }, 'America/New_York', 0, ny), '');
  assert.equal(wallTimeNote(gap, 'UTC', t, utc), '', 'UTC has no clock changes');
  // the jump box prints that very sentence
  const j = jump('2027-03-14 02:30', { fmt: ny, zone: 'America/New_York' })[0];
  assert.ok(j.detail.includes(wallTimeNote(gap, 'America/New_York', t, ny)), j.detail);
  const j2 = jump('2026-11-01 01:30', { fmt: ny, zone: 'America/New_York' })[0];
  assert.ok(j2.detail.includes('01:30 happens twice there (the clocks go back): showing the first'));
  // the resolved time is what the converter's fields must show: gap -> 03:30 on the same day, EDT
  const g = gregorianInfo(ny, t);
  assert.equal(g.time.slice(0, 5), '03:30');
  assert.equal(g.date, '2027-03-14');
  // every zone with a clock change: the note appears exactly when localTimeIssue says so
  for (const [zone, f] of [
    ['Europe/Berlin', { year: 2026, month: 3, day: 29, hour: 2, minute: 30 }],
    ['Australia/Sydney', { year: 2026, month: 4, day: 5, hour: 2, minute: 30 }],
    ['Pacific/Auckland', { year: 2026, month: 9, day: 27, hour: 2, minute: 30 }],
    ['Europe/Berlin', { year: 2026, month: 6, day: 1, hour: 2, minute: 30 }],
  ]) {
    const zt = localToUnix(f, zone);
    assert.equal(wallTimeNote(f, zone, zt, zoneFmt(zone)) !== '', localTimeIssue(f, zone) !== null, `${zone} ${JSON.stringify(f)}`);
  }
});

test('percent through a cycle is floored like the rings: a running cycle never reads 100.0 %', () => {
  assert.equal(pctFloor(0.814589, 1), '81.4');
  assert.equal(pctFloor(0.814589, 2), '81.45');
  assert.equal(pctFloor(0.814589, 3), '81.458');
  assert.equal(pctFloor(0, 1), '0.0');
  assert.equal(pctFloor(0.5, 1), '50.0');
  assert.equal(pctFloor(0.123, 1), '12.3', 'exact thousandths survive the float error');
  assert.equal(pctFloor(0.99999, 1), '99.9');
  assert.equal(pctFloor(1, 1), '99.9', 'capped');
  assert.equal(pctFloor(1, 2), '99.99');
  assert.equal(pctFloor(1, 6), '99.999999');
  assert.equal(pctFloor(-0.2, 1), '0.0');
  // same rule as the rings' percentText (floor of tenths, 99.9 at most) over a sweep
  for (let p = 0; p <= 1.0001; p += 0.00037) {
    const rings = (Math.min(999, Math.max(0, Math.floor(p * 1000 + 1e-7))) / 10).toFixed(1);
    assert.equal(pctFloor(p, 1), rings, String(p));
  }
  // the instant before a cycle ends: toFixed(1) would print 100.0
  const eta = model.levelAt(A, 6);
  const late = model.levelAt(eta.end - 0.001, 6);
  assert.ok(late.phase < 1 && late.phase > 0.9999, String(late.phase));
  assert.equal((late.phase * 100).toFixed(1), '100.0', 'the old formatting');
  assert.equal(pctFloor(late.phase, 1), '99.9');
  assert.equal(pctFloor(model.levelAt(eta.end - 0.001, 9).phase, 1) <= '99.9', true);
});

test('clipped last cycles: the nominal count is what is shown, the stepper range stays on cycles that exist', () => {
  const t = model.tMax - 5;
  const path = pathOfTime(model, t, 8);
  let clippedLevels = 0;
  for (let L = 1; L < path.length; L++) {
    const parent = path.slice(0, L);
    const nominal = nominalCount(model, parent);
    const exists = childCount(model, parent);
    assert.equal(nominal, model.levelInfo(L).siblings, `level ${L}`);
    assert.ok(exists >= path[L] && exists <= nominal, `level ${L}: at ${path[L]} of ${exists} existing / ${nominal} nominal`);
    assert.equal(model.levelAt(t, L).siblings, nominal, 'the ladder, rings and timeline print this denominator');
    if (exists < nominal) clippedLevels++;
  }
  assert.ok(clippedLevels >= 3, 'at the very end several levels are clipped: ' + clippedLevels);
  // the audit's example: 5 s before the end, β 2 of 5, γ 4 of 13, η 9 of 11
  const at = 28005212030;
  const p = pathOfTime(model, at, 7);
  assert.deepEqual([p[1], nominalCount(model, p.slice(0, 1)), childCount(model, p.slice(0, 1))], [2, 5, 2]);
  assert.deepEqual([p[2], nominalCount(model, p.slice(0, 2)), childCount(model, p.slice(0, 2))], [4, 13, 4]);
  assert.deepEqual([p[6], nominalCount(model, p.slice(0, 6)), childCount(model, p.slice(0, 6))], [9, 11, 9]);
  assert.equal(nominalCount(model, []), Number(model.clock.count(0)), 'alpha: the catalogue count');
  // an ordinary place in the middle: both agree
  assert.equal(nominalCount(model, [6, 4]), childCount(model, [6, 4]));
  // normalizePath keeps to the cycles that exist
  assert.deepEqual(normalizePath(model, [18, 5]), [18, 2]);
});

test('jump box documentation strings: the placeholder and every example parse, in both slash orders', () => {
  const pieces = PLACEHOLDER.replace(/^Jump to…\s+/, '').split(' · ');
  assert.ok(pieces.length >= 4);
  assert.ok(pieces.some((x) => x.includes('#')), 'the cycle example uses the hash');
  for (const x of pieces) assert.ok(first(x).time !== null, x);
  for (const df of [undefined, true, false]) {
    const list = examples(df);
    assert.ok(list.length >= 8);
    for (const [text, why] of list) {
      const r = jump(text, { dayFirst: df, fmt: zoneFmt('UTC'), zone: 'UTC' });
      assert.ok(r.some((c) => c.kind !== 'error'), `${text} (${why}) -> ${r[0]?.error}`);
      assert.ok(why.length > 8);
    }
    // the slash example does what its description says
    const slash = list.find(([t]) => t.includes('/'));
    assert.equal(first(slash[0], { dayFirst: df }).time, Date.UTC(2031, 5, 1) / 1000, slash[0]);
    assert.match(slash[1], df === false ? /month\/day/ : /day\/month/);
  }
  assert.ok(examples().some(([t]) => /Tokyo/.test(t)), 'a zone example');
  assert.ok(examples().every(([t]) => !/^[α-ξ] ?\d+$/.test(t)), 'no example is a bare "letter number"');
});


// =============================================================================================
// pure mode (docs/design/80-pure.md): converter maths, the δ½ page, the jump grammar
//
// NOTATION (core/pure.js): X#n is an ordinal counted from 1 (δ½#3), nX a count of units counted from 0 (3η 17ι 21λ).
// The expectations below that used the old spellings ("δ½ 3", "η 0 · ι 17") were updated deliberately; the old
// spellings themselves are still READ by the jump grammar (see 'old spellings' below).
// =============================================================================================
const pure = createPure(model, { now: () => A });
const pj = (text, o = {}) => parsePure(text, { model, pure, now: A, real: A + 5, level: 6, ...o });
const pfirst = (text, o) => pj(text, o)[0];
const HARD = RULES.filter(([, , sev]) => sev === 'hard');
/** Every hard leak rule of the scanner against a string (the visible text of a candidate). */
const leaks = (text) => HARD.filter(([, re]) => re.test(text)).map(([id]) => id);
const PSAMPLES = [A, A + 12345.6, 946684800.5, 2886085800.25, 125593320.816, -9e9, 2.7e10, model.tMin + 5, model.tMax - 5];
const STAMP_UPTO_IDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'iota', 'lambda'];

test('pure counters: the printed ranges are the hierarchy, ordinals count from 1 and counts from 0', () => {
  const R = ladderRanges(model, pure);
  assert.deepEqual(
    Object.fromEntries(Object.entries(R).map(([id, r]) => [id, [r.min, r.max]])),
    { alpha: [1, 18], beta: [1, 5], gamma: [1, 13], 'delta-half': [1, 10], 'epsilon-half': [1, 5], 'zeta-half': [1, 7], eta: [0, 10], iota: [0, 35], lambda: [0, 64] },
  );
  for (const c of COUNTERS) {
    assert.deepEqual([c.min, c.max], [R[c.id].min, R[c.id].max], `${c.sym} range is derived, not re-typed`);
    assert.equal(c.ordinal, c.min === 1, `${c.sym}: ordinals start at 1, counts at 0`);
  }
  assert.deepEqual(COUNTERS.map((c) => counterText(c, 3)), ['δ½#3', 'ε½#3', 'ζ½#3', '3η', '3ι', '3λ']);
  assert.equal(entriesText([{ id: 'alpha', n: 6 }, { id: 'beta', n: 4 }, { id: 'delta-half', n: 3 }, { id: 'zeta-half', n: 5 }, { id: 'eta', n: 3 }, { id: 'iota', n: 17 }]), 'α#6 β#4 · δ½#3 · ζ½#5 · 3η 17ι');
});

test('pure counters: the six editable counters move the moment by whole units of themselves', () => {
  const order = ['delta', 'epsilon', 'zeta', 'eta', 'iota', 'lambda'];
  for (const t of PSAMPLES) {
    const c0 = countersAt(pure, t);
    if (!c0) continue;
    for (const [k, spec] of COUNTERS.entries()) {
      for (const n of [spec.min, spec.max, Math.floor((spec.min + spec.max) / 2)]) {
        const r = setCounter(model, pure, t, spec.id, n);
        if (r.error) continue; // an end of the catalogue
        const c1 = countersAt(pure, r.t);
        assert.equal(c1[spec.key], n, `${spec.sym}=${n} at ${t}`);
        // the coarser counters did not move: the new value is inside the same parent
        // (η ι λ count inside a ζ cycle, which is two ζ½ and may straddle an ε½ or a δ½: only α β γ are sure to stay)
        for (const key of ['alpha', 'beta', 'gamma', ...(k < 3 ? order.slice(0, k) : [])]) assert.equal(c1[key], c0[key], `${key} kept (${spec.sym}=${n} at ${t})`);
        // and the move is a whole number of units of this counter (what is finer than it keeps its place inside the unit)
        const units = (model.positionOf(r.t) - model.positionOf(t)) / pure.unitPos(unitById(spec.id));
        near(units, n - c0[spec.key], 1e-4, `${spec.sym} moves by ${n - c0[spec.key]} units`);
      }
    }
  }
  // out of range values and the catalogue edge are answered, never extrapolated
  assert.match(setCounter(model, pure, A, 'delta-half', 11).error, /δ½#n is numbered 1–10/);
  assert.match(setCounter(model, pure, A, 'lambda', -1).error, /λ counts 0–64/);
  assert.ok(setCounter(model, pure, model.tMax - 2, 'delta-half', 10).error, 'a counter that would leave the catalogue says so');
  assert.equal(shiftUnits(model, pure, model.tMin + 1, 'eta', -1), null);
  assert.equal(shiftUnits(model, pure, model.tMax - 1, 'gamma', 1), null);
  // one ζ½ forward is exactly one ζ½ of position
  const t2 = shiftUnits(model, pure, A, 'zeta-half', 1);
  near(model.positionOf(t2) - model.positionOf(A), pure.unitPos(unitById('zeta-half')), 1e-11);
  assert.equal(setCounter(model, pure, model.tMax + 100, 'eta', 3).error, 'This moment is outside the catalogue');
  // a counter set right at the start of its unit shows that counter (rounding to the millisecond must not land before it)
  for (let k = 0; k < 120; k++) {
    const t = A + k * 1234.567;
    for (const spec of COUNTERS) {
      const r = setCounter(model, pure, t, spec.id, spec.min);
      if (!r.error) assert.equal(countersAt(pure, r.t)[spec.key], spec.min, `${spec.sym}=${spec.min} at ${t}`);
    }
  }
});

test('pure stamps: every entry of the header stamp reads back as the FIRST millisecond of that unit', () => {
  const ids = ['alpha', 'beta', 'gamma', 'delta-half', 'epsilon-half', 'zeta-half', 'eta', 'iota', 'lambda'];
  for (const t of PSAMPLES) {
    const c = countersAt(pure, t);
    if (!c) continue;
    const keys = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'iota', 'lambda'];
    for (let n = 1; n <= ids.length; n++) {
      const parts = ids.slice(0, n).map((id, i) => ({ id, n: c[keys[i]] }));
      const r = resolveParts(model, pure, parts, A);
      assert.ok(!r.error, `${n} entries at ${t}: ${r.error}`);
      // the result is the START of the finest unit: same stamp as t down to that unit, and it is not later than t
      const upTo = STAMP_UPTO_IDS[n - 1];
      assert.equal(pure.stamp(r.t, upTo), pure.stamp(t, upTo), `stamp ${n} at ${t}`);
      assert.ok(r.t <= t + 0.002, `start of the unit is not after t (${n} at ${t})`);
      if (n === 9) assert.ok(t - r.t < 8, 'a λ is shorter than 8 s');
      // and it is the first millisecond: one millisecond earlier the unit before it is shown
      if (r.t - 0.001 >= model.tMin) assert.notEqual(pure.stamp(r.t - 0.001, upTo), pure.stamp(r.t, upTo), `first ms of ${n} entries at ${t}`);
    }
  }
  // missing ancestors come from the shown moment
  const r = resolveParts(model, pure, [{ id: 'delta-half', n: 3 }, { id: 'epsilon-half', n: 2 }], A);
  assert.equal(pure.stamp(r.t, 'epsilon'), 'α#6 β#4 γ#9 · δ½#3 · ε½#2');
  const eta = resolveParts(model, pure, [{ id: 'eta', n: 7 }], A);
  assert.equal(countersAt(pure, eta.t).eta, 7);
  assert.equal(model.levelAt(eta.t, 5).cycle, model.levelAt(A, 5).cycle, 'η counts inside the ζ of the shown moment');
  // errors say what is wrong, in the notation they will be corrected in
  assert.match(resolveParts(model, pure, [{ id: 'alpha', n: 19 }], A).error, /only 18 Alpha/);
  assert.equal(resolveParts(model, pure, [{ id: 'gamma', n: 14 }], A).error, 'γ#14: γ is numbered 1–13 inside a Beta');
  assert.equal(resolveParts(model, pure, [{ id: 'zeta-half', n: 8 }], A).error, 'ζ½#8: ζ½ is numbered 1–7 inside an ε½');
  assert.equal(resolveParts(model, pure, [{ id: 'eta', n: 11 }], A).error, '11η: η counts 0–10 inside a ζ cycle');
  assert.equal(resolveParts(model, pure, [{ id: 'eta', n: 11 }], A).detail, '10η is the last');
  assert.match(resolveParts(model, pure, [{ id: 'delta-half', n: 1 }, { id: 'zeta-half', n: 1 }], A).error, /ε½ is missing between δ½ and ζ½/);
  assert.match(resolveParts(model, pure, [{ id: 'zeta-half', n: 1 }, { id: 'delta-half', n: 1 }], A).error, /longest to the shortest/);
  assert.match(resolveParts(model, pure, [{ id: 'delta-half', n: 1 }], model.tMax + 5).error, /outside the catalogue/);
  assert.match(resolveParts(model, pure, [{ id: 'alpha', n: 18 }, { id: 'beta', n: 5 }, { id: 'gamma', n: 13 }], A).error, /after the catalogue ends/);
  // ζ½ and η must name the same half of their ζ cycle (the η that straddles the middle belongs to both halves: see below)
  const c = countersAt(pure, A);
  const half = (eta) => resolveParts(model, pure, [{ id: 'alpha', n: 6 }, { id: 'beta', n: 4 }, { id: 'gamma', n: 9 }, { id: 'delta-half', n: c.delta }, { id: 'epsilon-half', n: c.epsilon }, { id: 'zeta-half', n: c.zeta }, { id: 'eta', n: eta }], A);
  const lo = half(0);
  const hi = half(10);
  assert.equal([lo, hi].filter((r) => r.error).length, 1, 'exactly one of 0η / 10η belongs to this ζ½');
  assert.match([lo, hi].find((r) => r.error).error, /^ζ½#\d and \d+η do not meet$/);
  assert.match([lo, hi].find((r) => r.error).detail, /^this ζ½ is the (first|second) half of its ζ cycle: it holds the counters (0η–5η|5η–10η)$/);
});

test('pure stamps: the stamp the header prints is always read, also in the second half of the η that straddles a ζ', () => {
  // η 5 of a ζ cycle (11 η) straddles the middle: its first half is in the first ζ½, its second half in the second one.
  // The header prints "…ζ½#6 · 5η" there; the first reading of it failed with "ζ½ 6 and η 5 do not meet".
  let straddle = 0;
  for (let k = 0; k < 25; k++) {
    // built, not searched for: phase 0.52 of a ζ cycle is the second half of its η 5 (η 5 spans 5/11 .. 6/11)
    const t = pointOfCycle(model, 5, 1000 + k * 7919, 0.52) + 0.123;
    const cs = countersAt(pure, t);
    assert.ok(cs.eta === 5 && model.levelAt(t, 5).phase >= 0.5, 'the instant is in the second half of η 5');
    straddle++;
    const text = pure.stamp(t, 'eta');
    assert.match(text, / · 5η$/);
    const r = pj(text, { now: t });
    assert.equal(r[0].kind, 'cycle', `${text}: ${r[0].error}`);
    assert.equal(pure.stamp(r[0].time, 'eta'), text, 'the same stamp comes back');
    assert.ok(r[0].time <= t, text);
    assert.equal(model.levelAt(r[0].time, 6).cycle, model.levelAt(t, 6).cycle, `the ζ½ began inside the η: ${text}`);
    // the first millisecond of the second ζ½ (the one before still shows the first half)
    assert.notEqual(pure.stamp(r[0].time - 0.001, 'zeta'), pure.stamp(r[0].time, 'zeta'));
    // any tail of it, with the date entries above taken from the shown moment
    assert.equal(pure.stamp(pj(text.split(' · ').slice(-2).join(' · '), { now: t })[0].time, 'eta'), text, 'ζ½#n · 5η');
    // the first half of the same η reads back as the η itself
    const t1 = model.levelAt(t, 6).start + 0.001;
    const s1 = pure.stamp(t1, 'eta');
    assert.equal(pure.stamp(pj(s1, { now: t })[0].time, 'eta'), s1);
  }
  assert.equal(straddle, 25, 'enough straddling instants were found');
  // every depth of stamp of many instants reads back (about 2 % of the η-level stamps were refused)
  for (let k = 0; k < 40; k++) {
    const t = -9e9 + k * 985431711.7 + 0.37;
    if (!model.inRange(t)) continue;
    for (const upTo of ['gamma', 'delta', 'epsilon', 'zeta', 'eta', 'iota', 'lambda']) {
      const text = pure.stamp(t, upTo);
      const r = pj(text, { now: t })[0];
      assert.equal(r.kind, 'cycle', `${text}: ${r.error}`);
      assert.equal(pure.stamp(r.time, upTo), text, text);
    }
  }
});

test('pure stamps: the old spellings are still read, the clock the header shows too', () => {
  const t = shiftUnits(model, pure, A, 'iota', 40);
  const st = pure.stamp(t, 'lambda');
  assert.match(st, /^α#6 β#4 γ#9 · δ½#\d+ · ε½#\d · ζ½#\d · \d+η \d+ι \d+λ$/);
  const old = st.replace(/δ½#(\d+)/, 'δ½ $1').replace(/ε½#(\d+)/, 'ε½ $1').replace(/ζ½#(\d+)/, 'ζ½ $1').replace(/ · (\d+)η (\d+)ι (\d+)λ$/, ' · η $1 · ι $2 · λ $3');
  assert.match(old, /δ½ \d+ · ε½ \d · ζ½ \d · η \d+ · ι \d+ · λ \d+$/);
  assert.equal(pfirst(old, { now: t }).time, pfirst(st, { now: t }).time, 'the old spelling of a whole stamp');
  assert.equal(pfirst('δ½ 3 · ε½ 2 · ζ½ 5').time, pfirst('δ½#3 · ε½#2 · ζ½#5').time);
  assert.equal(pfirst('δ½ 3').time, pfirst('δ½#3').time);
  assert.equal(pfirst('ζ½ 6 · η 5').time, pfirst('ζ½#6 · 5η').time);
  assert.equal(pfirst('ζ½ 5 η 3 ι 17').time, pfirst('ζ½#5 · 3η 17ι').time);
  assert.equal(pfirst('η 3 · ι 17 · λ 42').time, pfirst('3η 17ι 42λ').time);
  assert.equal(pfirst('3η17ι42λ').time, pfirst('3η 17ι 42λ').time, 'the header clock copied without spaces');
  // η#4 (the 4th η) is the counter 3
  assert.equal(pfirst('ζ½#3 · η#4').time, pfirst('ζ½#3 · 3η').time);
  assert.match(pfirst('η#0').error, /numbers start at 1/);
  // the clock alone: the counters of the shown ζ come first, the span after the shown moment second
  const clock = pj('0η 29ι 21λ');
  assert.deepEqual(clock.map((c) => c.kind), ['cycle', 'relative']);
  assert.match(clock[0].label, /^0η 29ι 21λ in the current ζ$/);
  assert.match(clock[1].label, /^\+0η 29ι 21λ from the shown moment$/);
  assert.equal(countersAt(pure, clock[0].time).iota, 29);
  // a lone count, a sign, "in" / "ago" and spans that do not start with η are spans
  assert.deepEqual(pj('3η').map((c) => c.kind), ['relative', 'cycle']);
  assert.deepEqual(pj('+0η 29ι').map((c) => c.kind), ['relative']);
  assert.deepEqual(pj('in 6ι 43λ').map((c) => c.kind), ['relative']);
  assert.equal(pj('6ι 43λ')[0].kind, 'relative');
  assert.equal(pj('2ζ½ 3η')[0].kind, 'relative');
  // a count that is no counter says how to write the ordinal
  assert.match(pfirst('α#6 β#4 3γ').error, /3γ is a count of units/);
});

test('pure span text: a span built from whole units reads as those units, without trailing zero parts', () => {
  const t1 = shiftUnits(model, pure, A, 'iota', -1);
  assert.equal(spanText(model, pure, t1, A), '1ι');
  assert.equal(spanText(model, pure, A, t1), '1ι', 'the order of the two moments does not matter');
  const t2 = shiftUnits(model, pure, A, 'zeta-half', 2);
  assert.equal(spanText(model, pure, A, t2), '2ζ½');
  assert.equal(spanText(model, pure, A, A, { parts: 1 }), '0ξ');
  assert.equal(spanText(model, pure, A, shiftUnits(model, pure, A, 'eta', 3.5)), '3η 18ι');
  // the lengths of the cycles in ladder units are clean counts (core: pure.cycleLength)
  const spans = Array.from({ length: 14 }, (_, L) => pure.cycleLength(L, { parts: 1 }));
  assert.deepEqual(spans, ['1α', '1β', '1γ', '2δ½', '2ε½', '2ζ½', '1η', '4ι', '1ι', '13λ', '1λ', '1μ', '1ν', '1ξ']);
  assert.deepEqual(Array.from({ length: 14 }, (_, L) => pure.cycleLength(L)), spans, 'never "1η 0ι"');
  // the sync's drift is the core text, with narrow digit groups
  assert.match(pure.driftText(model.solarSyncByNumber(4820)), /^−\d{1,3}( \d{3})*λ$/);
  const ec = pureEclipseContext(model, pure, A);
  assert.deepEqual([ec.prev.k, ec.next.k], [22, 23]);
  assert.deepEqual([ec.prev.name, ec.next.name], ['#22', '#23'], 'eclipses are named like positions: pure.eclipseName(k)');
  assert.match(ec.prev.text, /^\d+β \d+γ$/);
  assert.equal(pureEclipseContext(model, pure, model.catalogue[22]).prev.exact, true);
  assert.equal(pureEclipseContext(model, pure, model.tMax + 1).prev, null);
  // 12 decimals of the position reproduce the moment (9 decimals were 0.28 s off)
  assert.equal(pureShareQuery(model, A), '?pos=' + model.positionOf(A).toFixed(12) + '&pure=1&view=calendar');
  let worst = 0;
  for (let i = 0; i < 400; i++) {
    const t = Math.round((model.tMin + ((model.tMax - model.tMin) * ((i * 0.6180339887) % 1))) * 1000) / 1000;
    const pos = Number(new URLSearchParams(pureShareQuery(model, t)).get('pos'));
    worst = Math.max(worst, Math.abs(model.timeOfPosition(pos) - t));
  }
  assert.ok(worst < 0.001, `a copied link lands within a millisecond: ${worst}`);
  const s = pureSolarInfo(model, 4820);
  assert.equal(s.quarters.length, 4);
  assert.equal(pure.driftText(s.sol), pure.driftText(model.solarSyncByNumber(4820)));
  assert.ok(pureSolarInfo(model, 1e9) === null && pureSolarInfo(model, 1.5) === null);
});

test('pure page: the 35 cells of a δ½ are exactly the ζ½ the header counts', () => {
  assert.equal(viewCount(model), 11213);
  assert.equal(GRID.cells, GRID.rows * GRID.cols);
  for (const t of PSAMPLES) {
    const hv = viewOfTime(model, t);
    if (hv === null) continue;
    const info = viewInfo(model, hv);
    const g = buildPureGrid(model, hv);
    assert.equal(g.cells.length, 35);
    const d = pure.date(t);
    assert.deepEqual([d.alpha, d.beta, d.gamma, d.delta], [info.alpha, info.beta, info.gammaOrd, info.half], `page of ${t}`);
    const i = cellOfTime(model, g, t);
    assert.ok(i >= 0 && i < 35, `cell of ${t}`);
    assert.equal(g.cells[i].row + 1, d.epsilon, 'the row is the ε½ counter');
    assert.equal(g.cells[i].col + 1, d.zeta, 'the column is the ζ½ counter');
    // every cell: its middle shows its own ε½ and ζ½
    for (const c of g.cells) {
      if (!c.inRange) continue;
      // the start of a cell is the first millisecond that shows it
      assert.deepEqual([pure.date(c.start).epsilon, pure.date(c.start).zeta], [c.row + 1, c.col + 1], `cell ${c.ord} start`);
      const m = pure.date(cellTime(model, c, 0.5));
      if (!m) continue;
      assert.deepEqual([m.delta, m.epsilon, m.zeta], [info.half, c.row + 1, c.col + 1], `cell ${c.ord}`);
    }
  }
  // clipped ends: the last page has cells outside, the first page starts at position 0
  const last = buildPureGrid(model, viewCount(model) - 1);
  assert.ok(last.cells[0].inRange && last.cells.some((c) => !c.inRange), 'the last page is partly outside');
  assert.ok(last.cells.some((c) => c.partial) || last.cells.some((c) => !c.inRange));
  near(buildPureGrid(model, 0).cells[0].start, model.tMin, 0.0011);
  assert.equal(clampView(model, -5), 0);
  assert.equal(clampView(model, 1e9), viewCount(model) - 1);
});

test('pure page: the page and the cell never read ahead of the header (no relative tolerance)', () => {
  // a 1e-9 relative tolerance read the next δ½ page up to 3.5 ms early (and the next α up to 2.3 s early)
  const bad = [];
  const hvs = [1, 7, 10, 130, 650, 3000, 3724, 3725, 5000, 9000, 11000, viewCount(model) - 1];
  for (const hv of hvs) {
    const g = buildPureGrid(model, hv);
    const start = g.cells[0].start;
    assert.equal(viewOfTime(model, start), hv, `page ${hv} at its first millisecond`);
    for (let ms = 1; ms <= 6; ms++) {
      const t = Math.round((start - ms / 1000) * 1000) / 1000;
      const d = pure.date(t);
      const page = viewOfTime(model, t);
      if (page === null) continue;
      if (viewInfo(model, page).half !== d.delta) bad.push(`page ${hv} -${ms}ms: header δ½#${d.delta}, page δ½#${viewInfo(model, page).half}`);
      assert.equal(page, hv - 1, `${ms} ms before page ${hv} is the page before`);
    }
    // each cell: its first millisecond is in it, the millisecond before is in the previous one
    for (const c of g.cells) {
      if (!c.inRange) continue;
      assert.equal(cellOfTime(model, g, c.start), c.index, `cell ${c.ord} of page ${hv}`);
      const before = cellOfTime(model, g, Math.round((c.start - 0.001) * 1000) / 1000);
      assert.equal(before, c.index - 1 >= 0 ? c.index - 1 : -1, `1 ms before cell ${c.ord} of page ${hv}`);
      // and the header agrees at both
      const dz = pure.date(c.start);
      assert.deepEqual([dz.epsilon, dz.zeta], [c.row + 1, c.col + 1]);
      if (c.index > 0) assert.notDeepEqual([pure.date(c.start - 0.001).epsilon, pure.date(c.start - 0.001).zeta], [c.row + 1, c.col + 1]);
      // the end is the start of the next cell
      if (c.index < 34 && g.cells[c.index + 1].inRange) assert.equal(c.end, g.cells[c.index + 1].start);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(EPS_POS === 1e-12, 'the same absolute tolerance as core/pure.js');
});

test('pure landings: the first millisecond that shows the thing, even when the float estimate sits a hair after it', () => {
  // the synthetic case of the audit: an exact boundary on a millisecond, estimated 0.3 µs late
  assert.equal(firstMs(3311840352.0160003, (c) => c >= 3311840352.016), 3311840352.016);
  // ... and one that is really a hair after the millisecond mark: the next millisecond is the first that shows it
  assert.equal(firstMs(3311840352.0160003, (c) => c > 3311840352.0160003), 3311840352.017);
  assert.equal(firstMs(100.5, (c) => c >= 100.5), 100.5);
  assert.equal(firstMs(100.5, () => false), null);
  assert.equal(firstMs(NaN, () => true), null);
  // addresses of every depth: the landing is the first millisecond of that very cycle
  for (const level of [0, 1, 2, 3, 4, 5, 6, 8, 10, 11, 12]) {
    for (const idx of [0, 1, 2, 5, 17, 100, 431]) {
      if (idx >= Number(model.clock.count(level))) continue;
      const t = landPoint(model, level, idx, 0);
      assert.equal(model.levelAt(t, level).cycle, idx, `L${level} #${idx}`);
      if (t - 0.001 >= model.tMin) assert.equal(model.levelAt(t - 0.001, level).cycle, idx - 1, `L${level} #${idx}: one millisecond earlier is the cycle before`);
      assert.equal(landCycleAt(model, model.cycleStartTime(level, idx), level), t, `L${level} #${idx} by its float start`);
    }
  }
  // peak / node / valley: the first millisecond at which the cycle has reached that phase
  for (const phase of [0.25, 0.5, 0.75]) {
    const t = landPoint(model, 4, 1000, phase);
    assert.ok(model.levelAt(t, 4).phase >= phase && model.levelAt(t - 0.001, 4).phase < phase, `ε phase ${phase}`);
    assert.equal(model.levelAt(t, 4).cycle, 1000);
  }
  // the address jump lands exactly there
  assert.equal(pfirst('α#7 β#3').time, landPoint(model, 1, model.pathToCycle([7, 3]) === null ? 0 : Number(model.pathToCycle([7, 3])), 0));
  for (const text of ['α#7 β#3', 'α#7 β#2 γ#12', 'α#4 β#5 γ#13', 'α#12 β#1 γ#1', 'α#3', 'α#18']) {
    const r = pfirst(text);
    assert.equal(r.kind, 'cycle', text);
    const level = text.split(' ').length - 1;
    assert.notEqual(model.levelAt(r.time, level).cycle, model.levelAt(r.time - 0.001, level).cycle, `${text} is the first millisecond`);
  }
  // paths too (the converter's address point)
  const t = landPath(model, [6, 4, 9], 'begin');
  assert.equal(pfirst('α#6 β#4 γ#9').time, t);
  assert.equal(landPath(model, [6, 4, 9], 'end'), landPath(model, [6, 4, 10], 'begin'));
  assert.equal(landPath(model, [19], 'begin'), null);
});

test('pure page: η bands, quarter marks, eclipses, sync marks and the ε phase pair', () => {
  const hv = viewOfTime(model, A);
  const g = buildPureGrid(model, hv);
  for (const c of g.cells) {
    // the η segments tile the cell exactly
    assert.equal(c.etas[0].x0, 0);
    assert.equal(c.etas.at(-1).x1, 1);
    for (let i = 1; i < c.etas.length; i++) assert.equal(c.etas[i].x0, c.etas[i - 1].x1);
    const width = c.etas.reduce((a, e) => a + (e.x1 - e.x0), 0);
    near(width, 1, 1e-12);
    // a ζ½ is 5½ η: 22 quarter steps, 3 of 4 are quarter marks
    assert.equal(c.quarters.length + c.etas.filter((e) => e.startsHere).length, 22);
    for (const e of c.etas) {
      // the counter on the band is the header's η counter at a time inside the segment
      const t = cellTime(model, c, (e.x0 + e.x1) / 2);
      assert.equal(pure.clock(t).eta, e.local, `cell ${c.ord} η ${e.local}`);
    }
    // quarter marks sit at ι 9, 18, 27 of their η
    for (const q of c.quarters) {
      const t = cellTime(model, c, q.x) + 0.002;
      assert.equal(pure.clock(t).iota, q.q * 9, `cell ${c.ord} quarter ${q.name}`);
      assert.equal(pure.clock(t).eta, q.local);
    }
    // the pair is the ε odometer at the start of the cell (16 x 16 states): the cell data keeps it for the tooltip
    const t0 = c.inRange ? cellTime(model, c, 0) + 0.001 : null;
    if (t0) {
      const l = model.levelAt(t0, 4);
      assert.deepEqual([pure.pair(c.epsPhase).hi, pure.pair(c.epsPhase).lo], model.odometerAt(t0, 4, { strokes: 2, digits: 2 }).digits, `cell ${c.ord} pair`);
      near(l.phase, c.epsPhase, 1e-6);
    }
  }
  // an eclipse is at the start or in the middle of its cell; the page holding eclipse #22 marks it
  const hvE = viewOfTime(model, model.catalogue[22] + 1);
  const ge = buildPureGrid(model, hvE);
  const ec = ge.cells.find((c) => c.eclipse === 22);
  assert.ok(ec, 'eclipse #22 is on its page');
  assert.equal(pure.eclipseName(ec.eclipse), '#22', 'the number on the cell is the position of the eclipse');
  assert.ok([0, 0.5].includes(ec.eclipseFrac));
  near(cellFraction(model, ec, model.catalogue[22] + 0.0005), ec.eclipseFrac, 1e-6);
  // the first eclipse sits at position 0 and is #0 (the page of the catalogue start)
  const g0 = buildPureGrid(model, 0);
  assert.equal(g0.cells[0].eclipse, 0);
  assert.equal(pure.eclipseName(g0.cells[0].eclipse), '#0');
  // sync marks: four per sync, in time order, at their exact fraction of the cell
  const marks = g.cells.flatMap((c) => c.syncs.map((s) => ({ ...s, cell: c })));
  assert.ok(marks.length >= 30 && marks.length <= 45, `about 40 quarters on a page: ${marks.length}`);
  for (const m of marks) {
    assert.equal(cellOfTime(model, g, m.start + 0.001), m.cell.index);
    near(cellFraction(model, m.cell, m.start), m.x, 1e-7);
  }
  for (let i = 1; i < marks.length; i++) assert.ok(marks[i].start > marks[i - 1].start);
  assert.ok(marks.filter((m) => m.q === 0).length >= 9, 'about ten sync starts on a page');
  // at most one sync starts in a cell: the label in the corner is one number
  for (const c of g.cells) assert.ok(c.syncs.filter((s) => s.q === 0).length <= 1);
});

test('pure page: navigation maths and the γ ribbon', () => {
  for (const hv of [0, 1, 9, 10, 3725, viewCount(model) - 1]) {
    const info = viewInfo(model, hv);
    assert.equal(viewFromPath(model, info.alpha, info.beta, info.gammaOrd, info.half), hv, `round trip ${hv}`);
  }
  // beyond the clipped end the last γ is used
  assert.equal(viewFromPath(model, 18, 5, 13, 10), viewCount(model) - 1);
  assert.equal(viewOfTime(model, model.tMax + 1), null);
  assert.equal(viewOfTime(model, model.tMax), viewCount(model) - 1);
  const rb = buildRibbon(model, 372);
  assert.equal(rb.segs.length, 10);
  assert.equal(rb.eps.length, 40);
  assert.deepEqual(rb.deltas.map((d) => d.x), [0.2, 0.4, 0.6, 0.8]);
  assert.deepEqual(rb.path, [6, 4, 9]);
  assert.equal(rb.segs[3].hv, 3723);
  assert.equal(viewOfTime(model, A), 3725);
});

test('pure jump grammar: names, addresses, stamps and offsets land on the same moments the header counts', () => {
  const gamma2 = pfirst('Gamma Difracton');
  assert.equal(gamma2.kind, 'cycle');
  assert.equal(pure.stamp(gamma2.time, 'gamma'), 'α#6 β#4 γ#2');
  assert.equal(pfirst('γ#2').time, gamma2.time);
  assert.equal(pfirst('Gamma Difracton in Beta Tetrafracton').time, gamma2.time);
  const full = pfirst('Alpha Hexafracton Beta Tetrafracton Gamma Nonafracton');
  assert.equal(full.time, pfirst('α#6 β#4 γ#9').time);
  assert.match(full.label, /Alpha Hexafracton › Beta Tetrafracton › Gamma Nonafracton/);
  assert.equal(pfirst('a6 b4 g9').time, full.time);
  assert.equal(pfirst('6.4.9').time, full.time);
  assert.equal(pfirst('Delta Pentafracton').time, pfirst('δ#5').time);
  assert.match(pfirst('ε#5').label, /Epsilon Pentafracton in the current Delta/);
  // a spaced "ζ 6" is the ordinal first, the running ζ second
  const z6 = pj('ζ 6');
  assert.deepEqual(z6.map((c) => c.kind), ['cycle', 'cycle']);
  assert.match(z6[1].label, /running ζ/);
  // the header's own stamp, whole or from any entry on
  for (const t of PSAMPLES) {
    const c = countersAt(pure, t);
    if (!c) continue;
    const text = pure.stamp(t, 'lambda');
    const r = pj(text, { now: t })[0];
    assert.equal(r.kind, 'cycle', text);
    assert.equal(pure.stamp(r.time, 'lambda'), text, `the stamp reads back: ${text}`);
    assert.ok(t - r.time < 8 && r.time <= t + 0.002);
  }
  const tail = pfirst('δ½#3 · ε½#2 · ζ½#5');
  assert.equal(pure.stamp(tail.time, 'zeta'), 'α#6 β#4 γ#9 · δ½#3 · ε½#2 · ζ½#5');
  assert.match(tail.label, /^δ½#3 · ε½#2 · ζ½#5 in the current γ$/);
  assert.equal(pfirst('delta half 3').time, pfirst('δ½#3').time);
  assert.equal(pure.stamp(pfirst('ι 17').time, 'iota').split(' · ').pop(), '0η 17ι', 'ι counts inside the shown η');
  // offsets: whole units forward and back, measured in position
  const fwd = pfirst('+2ζ½ 3η');
  near(model.positionOf(fwd.time) - model.positionOf(A), 2 * pure.unitPos(unitById('zeta-half')) + 3 * pure.unitPos(unitById('eta')), 1e-10);
  assert.equal(pfirst('2ζ½ 3η').time, fwd.time, 'a bare span reads as "after"');
  assert.equal(pfirst('in 2ζ½ 3η').time, fwd.time);
  assert.equal(pfirst('-1ι').time, shiftUnits(model, pure, A, 'iota', -1));
  assert.equal(pfirst('1ι ago').time, pfirst('-1ι').time);
  assert.equal(pfirst('+1.5η').time, shiftUnits(model, pure, A, 'eta', 1.5));
  assert.match(pfirst('+2δ').error, /counted in halves/);
  assert.match(pfirst('+2ε½ 3ζ').error ?? '', /counted in halves/);
  assert.match(pfirst('+2θ').error, /not counted/);
  assert.match(pfirst('+3').error, /Add a unit/);
  assert.match(pfirst('+999α').error, /outside the catalogue/);
  assert.match(pfirst('+1β', { now: model.tMax - 1 }).error, /outside the catalogue/);
  // position, sync, now, global index
  assert.equal(pfirst('pos 22.9278').kind, 'position');
  near(model.positionOf(pfirst('pos 22.9278').time), 22.9278, 1e-9);
  assert.equal(pfirst('22 + 0.9278').time, pfirst('pos 22.9278').time);
  assert.equal(pfirst('pos 22.9278').detail.split(' · ').pop(), 'eclipse #22 + 0.9278', 'the eclipse is named like the position: #22');
  assert.match(pfirst('pos 99').error, /between 0 and 69/);
  const s = pfirst('sync 4820 node');
  assert.equal(s.kind, 'sync');
  assert.match(s.detail, /drift [−+]\d{1,3}( \d{3})*λ$/);
  assert.ok(s.detail.endsWith(`drift ${pure.driftText(model.solarSyncByNumber(4820))}`), 'drift is the core text');
  assert.match(pfirst('sync 99999999').error, /not inside the catalogue/);
  assert.equal(pfirst('now').live, true);
  assert.equal(pfirst('live').time, A + 5);
  assert.match(pfirst('d7#717211').label, /η global index 717211/);
});

test('pure jump grammar: boundaries and glyph states', () => {
  const e = pfirst('next ε');
  assert.equal(e.kind, 'boundary');
  assert.ok(e.time > A);
  assert.equal(e.time, landPoint(model, 4, eventsAround(model, A, 4, 1, 1, 1)[0].idx, 0));
  assert.match(e.detail, /ε#\d ends → Epsilon \w+fracton begins/);
  assert.ok(pfirst('prev ζ').time < A);
  assert.equal(pfirst('next peak η').time, pfirst('next peak', { level: 6 }).time);
  assert.match(pfirst('next peak η').detail, /in Eta \w+fracton/);
  assert.equal(pfirst('next 3 ε').label, 'Next 3rd ε boundary');
  assert.equal(pj('ε').length, 2, 'a lone letter offers next and previous');
  assert.match(pfirst('next peak', { level: undefined }).error, /needs a level/);
  // half-units: the boundary of a ζ½ is the start or the middle of a ζ, whichever comes first
  const h1 = pfirst('next ζ½');
  const h2 = pfirst('next ζ');
  assert.ok(h1.time > A && h1.time <= h2.time);
  near(model.positionOf(h1.time) % pure.unitPos(unitById('zeta-half')), 0, 1e-9);
  assert.match(h1.detail, /ζ½#\d begins$/);
  // it is the first millisecond of that ζ½: the header's counter changes there
  assert.notEqual(pure.dateText(h1.time - 0.001), pure.dateText(h1.time));
  assert.equal(pure.date(h1.time).zeta, pure.date(h1.time + 0.5).zeta);
  assert.match(pfirst('next η½').error, /no half/);
  assert.match(pfirst('next ζ½ peak').error, /no peak/);
  assert.equal(pfirst('prev δ½').time < A, true);
  // a glyph state: the pair and the single glyph, both directions
  const st = pj('η [13,0]');
  assert.deepEqual(st.map((c) => c.kind), ['state', 'state']);
  assert.ok(st[0].time > A && st[1].time < A);
  assert.equal(model.odometerAt(st[0].time, 6, { digits: 2 }).digits.join(), '13,0');
  assert.equal(pfirst('η 13·0').time, st[0].time);
  assert.equal(pfirst('d7 13,0').time, st[0].time);
  assert.match(st[0].label, /^Next time η shows 13·0$/);
  assert.equal(model.odometerAt(pfirst('η [13]').time, 6, { digits: 1 }).digits[0], 13);
  assert.match(pfirst('η [16,0]').error, /too large/);
  assert.match(pfirst('d20 1,2').error, /Depth must be between 1 and 14/);
});

test('pure jump box never reads an Earth calendar or clock: one short answer instead', () => {
  const EARTH = ['2031-06-01', '2031-06-01 14:30', '1 Jun 2031', 'Thu 8 Oct 2026', '+3d', '-2h30m', 'in 2 weeks', '3 days ago', 'tomorrow', 'today', 'yesterday', 'noon', 'Moscow', '14:30 Tokyo', 'Europe/Moscow', '1791460800', '1791460800000', 'unix 1791460800', 'UTC', 'Monday', '06/01/2031', '2pm', 'next day', '3 hours', '90 min', '+1y', 'May'];
  for (const text of EARTH) {
    const r = pj(text);
    assert.equal(r.length, 1, text);
    assert.equal(r[0].kind, 'error', text);
    assert.equal(r[0].error, 'Dates and clock times are off in pure mode', text);
    assert.ok(looksEarthly(text), text);
    assert.match(r[0].detail, /read in cycles/);
    assert.match(r[0].detail, /Press \? for the glossary\.$/, 'the help ends with the pointer to the glossary');
  }
  // pure inputs that LOOK a little Earthly are still read
  for (const text of ['sync 4820', 'α#6 β#4 γ#9', '6.4.9', 'next ε', '+2ζ½ 3η', 'η [13,0]', 'pos 22.9278', 'Gamma Difracton', '0η 29ι 21λ', 'ζ½#6 · 5η']) assert.notEqual(pfirst(text).kind, 'error', text);
  assert.ok(!looksEarthly('Gamma Difracton') && !looksEarthly('+2ζ½ 3η') && !looksEarthly('sync 4820') && !looksEarthly('0η 29ι 21λ'));
  // junk is "cannot read", with pure help
  const junk = pfirst('hello world');
  assert.match(junk.error, /^Cannot read "hello world"$/);
  assert.match(junk.detail, /Gamma Difracton/);
  assert.match(junk.detail, /Counters count from 0, # numbers from 1\. Press \? for the glossary\.$/);
  // a huge paste answers at once
  const huge = pj('x'.repeat(5000));
  assert.equal(huge.length, 1);
  assert.match(huge[0].error, /characters/);
  assert.ok(pfirst('Gamma Difracton' + ' '.repeat(400)).kind === 'cycle', 'trailing blanks do not count');
  assert.deepEqual(pj(''), []);
  assert.deepEqual(pj('   '), []);
});

test('pure jump box text never carries an Earth reference (the scanner rules, over many inputs)', () => {
  const inputs = [
    'Gamma Difracton', 'Alpha Hexafracton Beta Tetrafracton Gamma Nonafracton', 'Difracton', 'Omega Monofracton', 'α#6 β#4 γ#9', 'ε#5', 'ζ 6', 'a6 b3 g11', '6.3.11', 'α#19', 'β#6', 'γ#14',
    'δ½#3 · ε½#2 · ζ½#5', 'δ½ 3 · ε½ 2 · ζ½ 5', 'η 3', 'ι 17', 'ζ½ 5 η 3', 'ζ½#6 · 5η', '3η 17ι 21λ', '0η29ι21λ', '5η', '3γ', 'δ½ 11', 'δ½#11', 'ε½ 0', 'η 11', '11η', 'η#0',
    '+2ζ½ 3η', '-1ι', 'in 5λ', '3η ago', '+3', '+2δ', '+2θ', '+9999α',
    'pos 22.9', 'pos 99', 'sync 4820', 'S4820 node', 'sync 99999999', 'next ε', 'prev ζ', 'next ζ½', 'next peak η', 'next 3 ε', 'next peak', 'next ε½ peak', 'ε', 'ι', 'θ', 'ξ',
    'η [13,0]', 'η 13·4', 'η [16,0]', 'd7#717211', 'd7#99999999999', 'd20 1,2', 'now', '2031-06-01', '+3d', 'Moscow', 'tomorrow', '1791460800', 'xyz', 'hello world',
  ];
  for (const now of [A, 946684800, model.tMin + 5, model.tMax - 5, model.tMax + 100]) {
    for (const text of inputs) {
      for (const c of parsePure(text, { model, pure, now, real: now + 5, level: 6 })) {
        const shown = [c.label, c.detail, c.error ?? ''].join(' | ');
        assert.deepEqual(leaks(shown), [], `${text} @ ${now}: ${shown}`);
      }
    }
  }
  for (const [text, why] of pureExamples()) {
    assert.deepEqual(leaks(text + ' ' + why), [], text);
    assert.ok(pj(text).some((c) => c.kind !== 'error'), `${text} -> ${pj(text)[0]?.error}`);
    assert.ok(why.length > 8);
  }
  assert.deepEqual(leaks(PURE_PLACEHOLDER), []);
  const pieces = PURE_PLACEHOLDER.replace(/^Jump to…\s+/, '').split(' · ');
  assert.ok(pieces.length >= 4);
  for (const x of pieces) assert.ok(pj(x).some((c) => c.kind !== 'error'), x);
  // the examples teach the new notation, not the old one
  assert.ok(pureExamples().every(([text]) => !/(?<!\d)[δεζηι]½? \d/.test(text)), 'no old spelling in the examples');
});

test('pure jump helpers: names become hashed ordinals, ½ survives normalisation', () => {
  assert.equal(normalizePure('  δ½ 3 '), 'δ½ 3');
  assert.equal(normalizePure('δ½#3'), 'δ½#3');
  assert.equal(normalizePure('−1ι'), '-1ι');
  assert.equal(normalizePure('δ1⁄2 3'), 'δ½ 3');
  assert.deepEqual(namesToAddress('gamma difracton'), { text: 'γ#2', had: true });
  assert.deepEqual(namesToAddress('gamma difracton in beta tetrafracton'), { text: 'β#4 γ#2', had: true });
  assert.equal(namesToAddress('next ε').had, false);
  // every ordinal name of the shared table is understood
  ORDINAL_NAMES.slice(1).forEach((name, i) => assert.equal(namesToAddress(`beta ${name.toLowerCase()}`).text, `β#${i + 1}`));
  // the pure history never mixes with the normal one: sanitizeHistory keeps what it is given, nothing is added
  assert.deepEqual(sanitizeHistory([{ text: 'Gamma Difracton', label: 'Gamma Difracton in the current Beta', kind: 'cycle' }]).map((x) => x.text), ['Gamma Difracton']);
  assert.ok(UNITS.length >= 12);
});

test('pure page: the δ ε ζ band cycles are whole numbers of cells and start exactly on a cell', () => {
  assert.deepEqual(CELLS_PER, { 3: 70, 4: 14, 5: 2 });
  for (const t of [A, 946684800.5, 2886085800.25]) {
    const hv = viewOfTime(model, t);
    const g = buildPureGrid(model, hv);
    for (const level of [3, 4, 5]) {
      for (const c of g.cells) {
        const cy = overlayCycle(model, c.z, level);
        const l = model.levelAt(cellTime(model, c, 0.5), level);
        assert.equal(l.cycle, cy.idx, `L${level} cell ${c.ord}`);
        assert.equal(l.local + 1, cy.local);
        assert.equal(cy.startsHere, cellTime(model, c, 0) <= l.start + 0.002 && l.start <= cellTime(model, c, 0) + 0.002, `L${level} cell ${c.ord} starts a cycle`);
        if (cy.startsHere) {
          near(cycleStart(model, level, cy.idx), cellTime(model, c, 0), 0.002);
          // both are the first millisecond that shows the cycle
          assert.equal(cycleStart(model, level, cy.idx), cellTime(model, c, 0), `L${level} cell ${c.ord}`);
        }
      }
    }
  }
  assert.equal(cycleStart(model, 6, 1e12), null);
  assert.ok(Math.abs(cycleStart(model, 6, 717211) - model.cycleStartTime(6, 717211)) < 0.002);
});

test('pure jump: Fractonica ordinal names are never mistaken for dates (Mon-ofracton, Oct-afracton, Dec-afracton)', async () => {
  const { looksEarthly } = await import('../src/ui/calendar/pure-parse.js');
  for (const w of ['Monofracton', 'Octafracton', 'Octadecafracton', 'Decafracton', 'Dodecafracton', 'Tetrafracton', 'Gamma Octafracton', 'Sunfracton']) {
    assert.equal(looksEarthly(w), false, w);
  }
  for (const w of ['Monday', 'mon', 'oct 5', 'October', 'dec', 'Sat 3 Oct', 'sun', '2031-06-01', '14:30']) {
    assert.equal(looksEarthly(w), true, w);
  }
});
