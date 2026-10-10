import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createFormatter } from '../src/core/format.js';
import { createPure } from '../src/core/pure.js';
import { judge } from '../tools/pure-scan.mjs';
import {
  DEFAULT_IMPORTANCE,
  DEFAULT_MAX_DEPTH,
  IMPORTANCE,
  JUST_AFTER_S,
  MAX_DEPTH,
  MIN_DEPTH,
  advancedBy,
  buildEvents,
  clamp,
  clockLabel,
  countdownLong,
  countdownText,
  counterText,
  dayLabel,
  finerLevels,
  groupByDay,
  importanceById,
  isStale,
  justAfterTime,
  justBeforeEventTime,
  justBeforeLead,
  justBeforeTime,
  leadText,
  letterOf,
  levelLetters,
  normDepth,
  normLevel,
  ordinal,
  pctText,
  pctTenthsText,
  pctWhole,
  positionDecimals,
  positionSpan,
  quantize,
  ratioToDecimal,
  remainingText,
  segmentState,
  snapMs,
  turnoverSentence,
  whenFull,
  whenLabel,
} from '../src/ui/ladder/lib.js';
import {
  counterName,
  counterParts,
  cycleWords,
  dateAtPosition,
  dateTail,
  depthWords,
  endsText,
  groupByZeta,
  heroLeft,
  holds,
  leadBlinks,
  leftText,
  lengthText,
  levelWord,
  nextCycle,
  pathText,
  periodBlinks,
  phaseWords,
  positionOfKey,
  quarterWhere,
  sectorName,
  turnoverInfo,
  turnoverWords,
  unitClause,
  unitSentence,
  unitWord,
} from '../src/ui/ladder/pure-text.js';

const model = createModel();
const utc = createFormatter(() => 'UTC');
const kyiv = createFormatter(() => 'Europe/Kyiv');
const A = 1791460800; // 2026-10-08T12:00:00Z, SPEC vector A
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);

// ---------------------------------------------------------------------------
// segmented bar
// ---------------------------------------------------------------------------
test('segmentState: which child sector, and how far through it', () => {
  assert.deepEqual(segmentState(0, 5), { index: 0, frac: 0 });
  const mid = segmentState(0.5, 5); // exactly half way = middle of sector 3
  assert.equal(mid.index, 2);
  near(mid.frac, 0.5, 1e-12);
  const third = segmentState(0.3, 5); // "2nd of 5, 50 % through"
  assert.equal(third.index, 1);
  near(third.frac, 0.5, 1e-12);
  assert.equal(segmentState(0.999999, 13).index, 12);
  assert.deepEqual(segmentState(1, 7), { index: 6, frac: 1 }); // never an out-of-range segment
  assert.deepEqual(segmentState(-0.2, 4), { index: 0, frac: 0 });
  assert.deepEqual(segmentState(NaN, 4), { index: 0, frac: 0 });
});

test('segmentState is monotone and its sectors are the child cycles', () => {
  // the filled fraction of the bar equals the phase, so frac/index agree with the child level's own phase
  const f = model.frame(A);
  for (let L = 0; L < 10; L++) {
    const lv = f.level(L);
    const seg = segmentState(lv.phase, lv.factor);
    const child = f.level(L + 1);
    assert.equal(seg.index, child.local, `level ${L}: sector index = child's local index`);
    near(seg.frac, child.phase, 1e-9, `level ${L}: sector fraction = child's phase`);
  }
  let prev = -1;
  for (let i = 0; i <= 1000; i++) {
    const s = segmentState(i / 1000, 11);
    const v = s.index + s.frac;
    assert.ok(v >= prev - 1e-12);
    prev = v;
  }
});

test('counterText is 1-based and alpha says "cycle n of N"', () => {
  const f = model.frame(A);
  const a = f.level(0);
  assert.equal(counterText(0, a.local, a.siblings), 'cycle 6 of 18');
  const eta = f.level(6); // SPEC vector A: local 0 of 11
  assert.equal(counterText(6, eta.local, eta.siblings), '1 / 11');
  const theta = f.level(7); // local 7 of 9
  assert.equal(counterText(7, theta.local, theta.siblings), '8 / 9');
  assert.equal(counterText(3, 99, 5), '5 / 5', 'never exceeds the sibling count');
});

test('normDepth / normLevel turn garbage shared state into something drawable', () => {
  assert.equal(normDepth(7, 10), 7);
  assert.equal(normDepth('7', 10), 7);
  assert.equal(normDepth(3.4, 10), 3);
  assert.equal(normDepth(99, 10), MAX_DEPTH);
  assert.equal(normDepth(14, 10), 14);
  // each bound has its own fallback: a missing minimum must not collapse the list to one row
  assert.equal(normDepth('x', MIN_DEPTH), 1);
  assert.equal(normDepth(null, MIN_DEPTH), 1);
  assert.equal(normDepth(0, MIN_DEPTH), 1);
  assert.equal(normDepth(undefined, DEFAULT_MAX_DEPTH), 10);
  assert.equal(normDepth(NaN, DEFAULT_MAX_DEPTH), 10);
  assert.equal(normDepth(-3, DEFAULT_MAX_DEPTH), 10);
  assert.equal(normLevel(6), 6);
  assert.equal(normLevel(99), 13);
  assert.equal(normLevel(-3), 0);
  assert.equal(normLevel(1.5), 2);
  assert.equal(normLevel('abc'), 6);
  assert.equal(normLevel(null), 6);
  assert.equal(normLevel(undefined, 2), 2);
});

test('ordinal / quantize / clamp helpers', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '112th']);
  assert.equal(quantize(0.4166, 240), 100 / 240);
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
});

// ---------------------------------------------------------------------------
// durations
// ---------------------------------------------------------------------------
test('remainingText (ladder rows) reads like the Up next countdowns', () => {
  assert.equal(remainingText(utc, 9.96), '9.9 s', 'floored, not rounded to 10.0');
  assert.equal(remainingText(utc, 1.06), '1.0 s');
  assert.equal(remainingText(utc, 0.86), '0.8 s');
  assert.equal(remainingText(utc, 125.6), '2 min 05 s');
  assert.equal(remainingText(utc, 3700), '1 h 01 min');
  assert.equal(remainingText(utc, 171 * 86400 + 4 * 3600), '171 d 04 h');
  assert.equal(remainingText(utc, 19.3 * 31557600), '19.3 y', 'multi-year spans stay decimal');
  // the same instant gives the same leading text in a row and in the hero countdown
  for (const s of [0.05, 3.3, 9.99, 10, 37.5, 59, 60, 125.6, 3599, 3700, 86399, 86400, 200000, 5e6, 3e7]) {
    assert.ok(countdownLong(utc, s).startsWith(remainingText(utc, s)), `${s}: ${countdownLong(utc, s)} vs ${remainingText(utc, s)}`);
  }
});

test('the countdowns are the shared fmt.countdown, floored to tenths below 10 s, so every card agrees', () => {
  // whatever the shared formatter does with a raw 9.96 (older builds rounded it to "in 10.0 s"), the cards floor
  assert.equal(countdownText(utc, 9.96), '9.9 s');
  assert.equal(countdownText(utc, 0.96), '0.9 s');
  assert.equal(countdownText(utc, 3.96), '3.9 s');
  assert.equal(countdownText(utc, 9.99), '9.9 s');
  assert.equal(countdownText(utc, 10), '10 s');
  assert.equal(countdownLong(utc, 9.96), '9.9 s');
  for (const s of [0, 0.04, 0.96, 1.06, 3.96, 7.3, 9.96, 9.99, 10, 37.5, 59.99, 60, 125.6, 3599, 3700, 86399, 86400, 200000, 5e6, 3e7, 1e9]) {
    assert.equal(`in ${countdownText(utc, s)}`, utc.countdown(s < 10 ? Math.floor(s * 10) / 10 : s), `${s}: text is the shared countdown`);
    if (s >= 10) assert.equal(`in ${countdownText(utc, s)}`, utc.countdown(s), `${s}: identical to the shared countdown above 10 s`);
  }
  // 0.1 s steps are exact: every tenth reads as itself, never one tenth low
  for (let k = 0; k < 100; k++) assert.equal(countdownText(utc, k / 10), `${(k / 10).toFixed(1)} s`, `${k / 10}`);
});

test('countdownLong keeps a stable shape across unit boundaries', () => {
  assert.equal(countdownLong(utc, 2 * 86400 + 3 * 3600 + 11 * 60 + 59), '2 d 03 h 11 min');
  assert.equal(countdownLong(utc, 86400), '1 d 00 h 00 min');
  assert.equal(countdownLong(utc, 86399), '23 h 59 min 59 s');
  assert.equal(countdownLong(utc, 3600), '1 h 00 min 00 s');
  assert.equal(countdownLong(utc, 3599), '59 min 59 s');
  assert.equal(countdownLong(utc, 60), '1 min 00 s');
  assert.equal(countdownLong(utc, 59.9), '59 s');
  assert.equal(countdownLong(utc, 10), '10 s');
  assert.equal(countdownLong(utc, 9.99), '9.9 s');
  assert.equal(countdownLong(utc, 0.04), '0.0 s');
  assert.equal(countdownLong(utc, -5), '0.0 s');
  assert.equal(countdownLong(utc, NaN), '0.0 s');
  assert.equal(countdownLong(utc, 3 * 31557600 + 142 * 86400 + 5 * 3600), '3 y 142 d 05 h');
});

test('countdownText shows the two most significant units', () => {
  assert.equal(countdownText(utc, 6 * 86400 + 12 * 3600 + 5), '6 d 12 h');
  assert.equal(countdownText(utc, 6 * 86400 + 5 * 3600 + 5), '6 d 05 h', 'hours are zero padded under a day count');
  assert.equal(countdownText(utc, 3600 + 5 * 60 + 9), '1 h 05 min', 'minutes are zero padded under an hour count');
  assert.equal(countdownText(utc, 3 * 3600 + 41 * 60 + 9), '3 h 41 min');
  assert.equal(countdownText(utc, 12 * 60 + 4), '12 min 04 s');
  assert.equal(countdownText(utc, 37), '37 s');
  assert.equal(countdownText(utc, 7.84), '7.8 s');
  assert.equal(countdownText(utc, 2 * 31557600 + 40 * 86400), '2 y 40 d');
  assert.equal(countdownText(utc, -3), '0.0 s', 'a passed instant never reads "ago" in a row');
});

// ---------------------------------------------------------------------------
// percent through a cycle
// ---------------------------------------------------------------------------
test('pctWhole floors and never reaches 100; pctTenthsText floors to a tenth like the rings', () => {
  assert.equal(pctWhole(0), 0);
  assert.equal(pctWhole(0.6699), 66, 'floored, not rounded');
  assert.equal(pctWhole(0.66), 66, 'exact hundredths survive float error');
  assert.equal(pctWhole(0.29), 29);
  assert.equal(pctWhole(0.57), 57);
  assert.equal(pctWhole(0.999999), 99);
  assert.equal(pctWhole(1), 99, 'a cycle that has not ended is not 100 %');
  assert.equal(pctWhole(-0.2), 0);
  assert.equal(pctWhole(NaN), 0);
  assert.equal(pctText(0.668), '66\u202f%');
  assert.equal(pctTenthsText(0.668), '66.8\u202f%');
  assert.equal(pctTenthsText(0.135), '13.5\u202f%');
  assert.equal(pctTenthsText(0.9999), '99.9\u202f%');
  assert.equal(pctTenthsText(1), '99.9\u202f%');
  assert.equal(pctTenthsText(0), '0.0\u202f%');
  // the percent is the bar's own fill: filled segments plus the partly filled one, over the segment count
  const f = model.frame(A);
  for (let L = 0; L < 10; L++) {
    const lv = f.level(L);
    const seg = segmentState(lv.phase, lv.factor);
    assert.equal(pctWhole((seg.index + seg.frac) / lv.factor), pctWhole(lv.phase), `level ${L}`);
  }
  // SPEC vector A, eta: 56 min 12 s left of 5 h 3 min -> 81.4 % through
  assert.equal(pctTenthsText(f.level(6).phase), '81.4\u202f%');
  assert.equal(pctText(f.level(6).phase), '81\u202f%');
});

// ---------------------------------------------------------------------------
// Just before / Just after
// ---------------------------------------------------------------------------
test('justBeforeLead: 2 s, or a quarter of a cycle that is shorter than 8 s', () => {
  assert.equal(justBeforeLead(5 * 3600), 2);
  assert.equal(justBeforeLead(7.8), 1.95);
  assert.equal(justBeforeLead(8), 2);
  assert.equal(justBeforeLead(8.5), 2);
  assert.equal(justBeforeLead(1.6), 0.4);
  assert.equal(justBeforeLead(0.31), 0.0775);
  assert.equal(justBeforeLead(0.044), 0.011);
  assert.equal(justBeforeLead(NaN), 2, 'an unknown length falls back to the 2 s of every long cycle');
  assert.equal(justBeforeLead(0), 2);
  assert.equal(justBeforeTime(1000, 3600), 998);
  assert.equal(justBeforeTime(1000, 0.4), 999.9);
  assert.equal(justAfterTime(1000), 1000.001);
  assert.deepEqual([2, 0.4, 0.0775, 0.011, 1.5].map(leadText), ['2 s', '400 ms', '78 ms', '11 ms', '1.5 s']);
});

test('Just before lands inside the cycle it was asked for, at every depth (mu, nu and xi are shorter than 2 s)', () => {
  const instants = [A, 946684800, 2886085800, 1e9, model.tMin + 5, model.tMax - 3 * 86400];
  for (const t of instants) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      const dest = justBeforeTime(lv.end, lv.duration);
      const at = model.levelAt(dest, L);
      assert.equal(at.cycle, lv.cycle, `depth ${L + 1} at ${t}: lands in the same cycle (was ${lv.cycle - model.levelAt(lv.end - 2, L).cycle} cycles earlier with a fixed 2 s)`);
      assert.ok(dest > lv.start, `depth ${L + 1}: after the start`);
      assert.ok(lv.end - dest <= 2 + 1e-5, `depth ${L + 1}: no more than 2 s ahead`);
      // (doubles near 3e10 s are 4 microseconds apart, hence the 10 microsecond slack)
      assert.ok(lv.end - dest <= lv.duration * 0.25 + 1e-5, `depth ${L + 1}: no more than a quarter of the cycle ahead`);
      // watching it for the lead time carries the clock over the end, into the next cycle
      if (lv.end < model.tMax - 0.01) {
        const over = model.levelAt(dest + justBeforeLead(lv.duration) + 0.002, L);
        assert.equal(over.cycle, lv.cycle + 1, `depth ${L + 1}: the turnover happens after the lead time`);
      }
    }
  }
  // the three short ones named in the audit, at spec vector A
  for (const [L, d] of [[11, 1.555], [12, 0.311], [13, 0.044]]) {
    const lv = model.levelAt(A, L);
    assert.ok(Math.abs(lv.duration - d) < 0.002, `level ${L} lasts ${d} s`);
    assert.notEqual(model.levelAt(lv.end - 2, L).cycle, lv.cycle, `a fixed 2 s would leave level ${L}'s cycle`);
    assert.equal(model.levelAt(justBeforeTime(lv.end, lv.duration), L).cycle, lv.cycle);
  }
});

test('Just after lands 1 ms inside the next cycle, at every depth', () => {
  for (const t of [A, 946684800, 2886085800]) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      const at = model.levelAt(justAfterTime(lv.end), L);
      assert.equal(at.cycle, lv.cycle + 1, `depth ${L + 1}`);
      assert.ok(at.start <= justAfterTime(lv.end) && justAfterTime(lv.end) - at.start < 0.002, `depth ${L + 1}: 1 ms past the start`);
    }
  }
});

test('Up next: Just before for a turnover lands inside the cycle that ends there', () => {
  for (const imp of IMPORTANCE) {
    for (const e of buildEvents(model, A, { importance: imp, maxLevel: 9, count: 8 })) {
      const dest = justBeforeEventTime(model, e.time, e.top);
      assert.equal(model.levelAt(dest, e.top).cycle, model.levelAt(e.time - 0.01, e.top).cycle, `event at ${e.time}`);
      assert.ok(Math.abs(e.time - dest - 2) < 1e-6, 'cycles of hours: the full 2 s');
    }
  }
  // a turnover of a very short cycle (not offered by the importance control, but the helper must hold for it)
  const nu = model.levelAt(A, 12);
  const dest = justBeforeEventTime(model, nu.end, 12);
  assert.equal(model.levelAt(dest, 12).cycle, nu.cycle);
  assert.ok(Math.abs(nu.end - dest - nu.duration / 4) < 1e-6);
});

test('wording: the two navigation actions are "Just before" and "Just after", and the UI says depth, not level', () => {
  // user-visible strings only: comments may say "level" (the internal, zero-based word)
  const src = (f) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  for (const f of ['ladder.js', 'upnext.js', 'ladder/lib.js', 'ladder/dom.js']) {
    const text = src(f);
    for (const bad of ['Go to end', 'Jump after', 'Jump to just after', 'Coarsest level', 'Finest level', 'finer level', 'Fewer levels', 'choose a level', 'selected level shown']) {
      assert.ok(!text.includes(bad), `${f} still says "${bad}"`);
    }
  }
  assert.ok(src('ladder.js').includes('<span>Just before</span>') && src('ladder.js').includes('<span>Just after</span>'));
  assert.ok(src('upnext.js').includes('<span>Just before</span>') && src('upnext.js').includes('<span>Just after</span>'));
});

// ---------------------------------------------------------------------------
// Gregorian labels
// ---------------------------------------------------------------------------
test('whenLabel picks a resolution that fits the cycle length', () => {
  const t = Date.UTC(2026, 9, 18, 3, 41, 12, 250) / 1000;
  const ref = Date.UTC(2026, 9, 18, 0, 0, 0) / 1000;
  const refOther = Date.UTC(2026, 9, 9, 0, 0, 0) / 1000;
  const refYear = Date.UTC(2025, 0, 1) / 1000;
  assert.equal(whenLabel(utc, t, ref, 72 * 365 * 86400), '2026-10-18'); // alpha .. gamma-ish: date only
  assert.equal(whenLabel(utc, t, ref, 100 * 86400), '2026-10-18');
  assert.equal(whenLabel(utc, t, ref, 16 * 86400), 'Oct 18 03:41');
  assert.equal(whenLabel(utc, t, refYear, 16 * 86400), '2026-10-18 03:41'); // other year shows the year
  assert.equal(whenLabel(utc, t, ref, 5 * 3600), '03:41:12'); // same civil day: clock only
  assert.equal(whenLabel(utc, t, refOther, 5 * 3600), 'Oct 18 03:41:12');
  assert.equal(whenLabel(utc, t, ref, 7.77), '03:41:12.250'); // below 10 s: milliseconds
});

test('whenLabel: scale thresholds are exactly 1 day and 90 days', () => {
  const t = Date.UTC(2026, 9, 18, 3, 41, 12) / 1000;
  const ref = Date.UTC(2026, 9, 18, 0, 0, 0) / 1000;
  assert.equal(whenLabel(utc, t, ref, 86400 - 1), '03:41:12');
  assert.equal(whenLabel(utc, t, ref, 86400), 'Oct 18 03:41');
  assert.equal(whenLabel(utc, t, ref, 90 * 86400 - 1), 'Oct 18 03:41');
  assert.equal(whenLabel(utc, t, ref, 90 * 86400), '2026-10-18');
  // same month and day in another year is not "the same day"
  const lastYear = Date.UTC(2025, 9, 18, 0, 0, 0) / 1000;
  assert.equal(whenLabel(utc, t, lastYear, 5 * 3600), 'Oct 18 03:41:12');
});

test('whenLabel: a short cycle that spans New Year never needs the year (it would overflow the quarter column)', () => {
  const t = Date.UTC(2000, 0, 1, 0, 49, 43) / 1000;
  const start = Date.UTC(1999, 11, 31, 23, 33, 55) / 1000;
  assert.equal(whenLabel(utc, t, start, 5.3 * 3600), 'Jan 1 00:49:43');
  assert.equal(whenLabel(utc, start, start, 5.3 * 3600), '23:33:55');
  assert.equal(whenLabel(utc, t, start, 7.7), 'Jan 1 00:49:43.000');
  assert.ok(whenLabel(utc, t, start, 5.3 * 3600).length <= 16);
});

test('milliseconds of precise labels are the nearest millisecond (doubles near 1e10 carry microsecond errors)', () => {
  // ms-aligned instants that are not exact in binary: truncating the fraction would give ...123 for ...124 etc.
  for (const [t, expect] of [
    [1113199951.438, '14:32:31.438'],
    [-10684827340.124, '00:24:19.876'],
    [-10684827340.114, '00:24:19.886'],
    [28005212030.816, '09:33:50.816'],
    [A + 0.001, '12:00:00.001'],
  ]) {
    assert.ok(whenLabel(utc, t, t, 5).endsWith(expect.slice(-4)), `${t}: ${whenLabel(utc, t, t, 5)}`);
    assert.ok(whenFull(utc, t, { precise: true }).endsWith(expect.slice(-4)), `${t}: ${whenFull(utc, t, { precise: true })}`);
  }
  // property: whatever the ms-aligned instant, the label shows exactly its ms (and its whole second)
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 4000; i++) {
    const k = Math.floor((rnd() * (2857 - 1613) + 1613 - 1970) * 31557600 * 1000); // integer ms, 1613..2857
    const t = k / 1000;
    const ms = ((k % 1000) + 1000) % 1000;
    const label = whenFull(utc, t, { precise: true });
    assert.equal(label.slice(-3), String(ms).padStart(3, '0'), `${k}: ${label}`);
    const secs = Math.floor(k / 1000);
    assert.equal(label.slice(-12, -4), utc.time(secs), `${k}: whole second of ${label}`);
    assert.equal(whenLabel(utc, t, t, 5).slice(-3), String(ms).padStart(3, '0'));
  }
  // a fraction just below the next second belongs to that second, not ".1000" or the previous second
  assert.equal(whenFull(utc, A + 0.9996, { precise: true }), 'Thu 8 Oct 2026, 12:00:01.000');
  assert.equal(snapMs(A + 0.9996), A + 1);
  // the catalogue's own instants (the cycle boundaries of the finest rows)
  for (const e of model.catalogue) {
    const label = whenFull(utc, e, { precise: true });
    assert.equal(Number(label.slice(-3)), (((Math.round(e * 1000) % 1000) + 1000) % 1000));
  }
});

test('whenFull / dayLabel / clockLabel honour the zone', () => {
  assert.equal(whenFull(utc, A), 'Thu 8 Oct 2026, 12:00:00');
  assert.equal(whenFull(kyiv, A), 'Thu 8 Oct 2026, 15:00:00'); // EEST, UTC+3
  assert.equal(whenFull(utc, A + 0.25, { precise: true }), 'Thu 8 Oct 2026, 12:00:00.250');
  assert.equal(dayLabel(utc, A, 2026), 'Thu 8 Oct');
  assert.equal(dayLabel(utc, A, 2025), '8 Oct 2026');
  assert.equal(clockLabel(kyiv, A), '15:00');
  // a day rolls over in the other zone
  const late = Date.UTC(2026, 9, 8, 22, 30) / 1000;
  assert.equal(dayLabel(kyiv, late, 2026), 'Fri 9 Oct');
  assert.equal(clockLabel(kyiv, late), '01:30');
});

// ---------------------------------------------------------------------------
// exact Saros positions
// ---------------------------------------------------------------------------
test('ratioToDecimal is exact and rounds half up', () => {
  assert.equal(ratioToDecimal(1n, 3n, 6), '0.333333');
  assert.equal(ratioToDecimal(2n, 3n, 6), '0.666667');
  assert.equal(ratioToDecimal(7n, 1n, 2), '7.00');
  assert.equal(ratioToDecimal(5n, 2n, 0), '3');
  assert.equal(ratioToDecimal(1n, 1000n, 2), '0.00');
  assert.equal(ratioToDecimal(123456789012345678901234567890n, 1000000000000n, 3), '123456789012345678.901');
});

test('positionDecimals resolves one cycle with a spare digit', () => {
  assert.equal(positionDecimals(1n), 2); // alpha: 4 Saros
  assert.equal(positionDecimals(125125n), 6); // eta: 3.2e-5 Saros
  assert.equal(positionDecimals(51238687500n), 12); // xi
  for (let L = 0; L < 14; L++) {
    const P = model.levelInfo(L).prefix;
    const d = positionDecimals(P);
    assert.ok(10 ** -d <= 4 / Number(P), `level ${L}: ${d} decimals resolve one cycle`);
  }
});

test('positionSpan matches the model position of the cycle boundaries', () => {
  const f = model.frame(A);
  for (const L of [0, 3, 6, 8]) {
    const lv = f.level(L);
    const span = positionSpan(lv.cycleBig, model.levelInfo(L).prefix, model.extent, lv.clipped);
    const tol = 10 ** -positionDecimals(model.levelInfo(L).prefix);
    near(Number(span.from), model.positionOf(lv.start + 1e-6), tol, `level ${L} from`);
    near(Number(span.to), model.positionOf(lv.end - 1e-6), tol, `level ${L} to`);
    near(Number(span.to) - Number(span.from), 4 / model.levelInfo(L).prefixNum, tol, `level ${L} delta`);
  }
  // SPEC vector A: eta cycle 717211 starts at position 4*717211/125125
  const eta = positionSpan(717211n, 125125n, 69, false);
  assert.equal(eta.from, '22.927824');
  assert.equal(eta.to, '22.927856');
});

test('positionSpan clips the last cycle at the catalogue end', () => {
  const lv = model.frame(model.tMax - 5).level(0);
  assert.equal(lv.clipped, true);
  const s = positionSpan(lv.cycleBig, 1n, model.extent, lv.clipped);
  assert.equal(s.from, '68.00');
  assert.equal(s.to, '69.00'); // not 72.00
});

// ---------------------------------------------------------------------------
// importance, wording
// ---------------------------------------------------------------------------
test('importance choices are alpha-gamma .. alpha-eta and default to zeta', () => {
  assert.deepEqual(
    IMPORTANCE.map((i) => i.label),
    ['α–γ', 'α–δ', 'α–ε', 'α–ζ', 'α–η'],
  );
  assert.deepEqual(
    IMPORTANCE.map((i) => i.top),
    [2, 3, 4, 5, 6],
  );
  assert.equal(importanceById(DEFAULT_IMPORTANCE).label, 'α–ζ');
  assert.equal(importanceById('nonsense').id, DEFAULT_IMPORTANCE);
  assert.equal(importanceById(null).id, DEFAULT_IMPORTANCE);
  assert.equal(letterOf(4), 'ε');
});

test('turnoverSentence lists the finer cycles that end with it', () => {
  assert.equal(turnoverSentence(4, 8), 'ε 5 ends — 4 finer cycles (ζ, η, θ, ι) end with it.');
  assert.equal(turnoverSentence(7, 8), 'θ 8 ends — 1 finer cycle (ι) ends with it.');
  assert.equal(turnoverSentence(9, 9), 'κ 10 ends.');
  assert.equal(turnoverSentence(5, 3), 'ζ 6 ends.');
  assert.equal(turnoverSentence(0, 9), 'α 1 ends — 9 finer cycles (β … κ) end with it.');
  assert.deepEqual(finerLevels(4, 8), [5, 6, 7, 8]);
  assert.equal(levelLetters([5, 6, 7]), 'ζ, η, θ');
  assert.equal(levelLetters([5, 6, 7, 8]), 'ζ, η, θ, ι');
  assert.equal(levelLetters([5, 6, 7, 8, 9]), 'ζ … κ', 'five letters no longer fit one line in the 340 px column');
  assert.equal(turnoverSentence(4, 9), 'ε 5 ends — 5 finer cycles (ζ … κ) end with it.');
  // the hero sentence has to fit one line (about 52 characters at 12.5 px in the narrowest column) for every top / range
  for (let top = 0; top <= 13; top++) for (let max = top; max <= 13; max++) assert.ok(turnoverSentence(top, max).length <= 52, turnoverSentence(top, max));
});

// ---------------------------------------------------------------------------
// upcoming turnovers
// ---------------------------------------------------------------------------
test('buildEvents: sorted, within importance, and each event really is a cycle end', () => {
  for (const imp of IMPORTANCE) {
    const evs = buildEvents(model, A, { importance: imp, maxLevel: 9, count: 8 });
    assert.equal(evs.length, 8);
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      assert.ok(e.time > A, 'in the future');
      if (i) assert.ok(e.time > evs[i - 1].time, 'strictly ascending');
      assert.ok(e.top <= imp.top, 'within importance');
      assert.equal(e.finer, 9 - e.top);
      // the top level has a cycle boundary exactly here ...
      const before = model.levelAt(e.time - 0.01, e.top);
      const after = model.levelAt(e.time + 0.01, e.top);
      near(before.end, e.time, 2e-3, `event ${i} ends a level-${e.top} cycle`);
      near(after.start, e.time, 2e-3, `event ${i} starts the next level-${e.top} cycle`);
      assert.equal(after.cycle, before.cycle + 1);
      // ... and the next coarser level does not roll over (that would make it the top)
      if (e.top > 0) assert.ok(model.levelAt(e.time - 0.01, e.top - 1).end > e.time + 0.5, 'coarser level continues');
      // every finer level ends with it
      for (let L = e.top + 1; L <= 9; L++) near(model.levelAt(e.time - 0.01, L).end, e.time, 2e-3, `level ${L} ends with it`);
    }
    // the hero is the end of the current cycle at the finest included level
    near(evs[0].time, model.levelAt(A, imp.top).end, 1e-3, 'hero = end of the current finest-importance cycle');
  }
});

test('buildEvents: coarser turnovers appear inside the list with the right top', () => {
  // spec vector A: the next delta/epsilon boundary is 2026-10-17T14:11:36.982Z (ε and δ end together)
  const evs = buildEvents(model, A, { importance: 'ζ', maxLevel: 9, count: 8 });
  const big = evs.find((e) => e.top === 3);
  assert.ok(big, 'a delta turnover is listed');
  near(big.time, Date.UTC(2026, 9, 17, 14, 11, 36, 982) / 1000, 2e-3);
  assert.ok(evs.filter((e) => e.top === 5).length >= 5);
  assert.equal(evs.filter((e) => e.top < 3).length, 0);
});

test('buildEvents: the first events of an alpha / beta turnover carry the right top level', () => {
  // just before an alpha end (which is also the end of every finer level) the top must be 0, not 1
  const a = model.cycleByIndex(0, 5);
  const atAlpha = buildEvents(model, a.end - 1000, { importance: 'γ', maxLevel: 9 });
  near(atAlpha[0].time, a.end, 2e-3);
  assert.equal(atAlpha[0].top, 0);
  assert.equal(atAlpha[0].finer, 9);
  // a beta end that is not an alpha end
  const b = model.cycleByIndex(1, 7);
  const atBeta = buildEvents(model, b.end - 1000, { importance: 'γ', maxLevel: 9 });
  near(atBeta[0].time, b.end, 2e-3);
  assert.equal(atBeta[0].top, 1);
});

test('buildEvents: finer count follows the ladder range and never goes negative', () => {
  const shallow = buildEvents(model, A, { importance: 'ζ', maxLevel: 2, count: 8 });
  assert.ok(shallow.some((e) => e.top === 5), 'zeta events are listed even when the ladder stops at gamma');
  assert.ok(shallow.every((e) => e.finer === 0), 'no finer cycles are visible');
  const evs = buildEvents(model, A, { importance: 'ζ', maxLevel: 5, count: 3 });
  assert.ok(evs.every((e) => e.finer === 0));
  const deep = buildEvents(model, A, { importance: 'ζ', maxLevel: 13, count: 3 });
  assert.ok(deep.every((e) => e.finer === 13 - e.top));
});

test('buildEvents: empty outside the catalogue and near its end', () => {
  assert.deepEqual(buildEvents(model, model.tMax + 10, { importance: 'ζ', maxLevel: 9 }), []);
  assert.deepEqual(buildEvents(model, model.tMin - 10, { importance: 'ζ', maxLevel: 9 }), []);
  assert.deepEqual(buildEvents(model, model.tMax - 5, { importance: 'ζ', maxLevel: 9 }), []);
  const early = buildEvents(model, model.tMin + 5, { importance: 'ζ', maxLevel: 9 });
  assert.equal(early.length, 8);
  assert.ok(early[0].time > model.tMin);
});

test('buildEvents near the end returns the few turnovers that are left, in order', () => {
  const evs = buildEvents(model, model.tMax - 6 * 86400, { importance: 'ζ', maxLevel: 9 });
  assert.ok(evs.length > 0 && evs.length < 8);
  assert.ok(evs.every((e) => e.time <= model.tMax));
});

test('groupByDay labels the first row of each civil day', () => {
  const d = (day, h) => Date.UTC(2026, 9, day, h, 0, 0) / 1000;
  const evs = [
    { key: 'a', time: d(10, 2), top: 5, finer: 4 },
    { key: 'b', time: d(10, 13), top: 5, finer: 4 },
    { key: 'c', time: d(11, 1), top: 4, finer: 5 },
    { key: 'd', time: d(11, 23), top: 5, finer: 4 },
  ];
  const g = groupByDay(evs, utc, d(8, 0));
  assert.deepEqual(
    g.map((e) => e.day),
    ['Sat 10 Oct', null, 'Sun 11 Oct', null],
  );
  assert.deepEqual(
    g.map((e) => e.newDay),
    [false, false, true, false],
  );
  assert.deepEqual(
    g.map((e) => e.clock),
    ['02:00', '13:00', '01:00', '23:00'],
  );
  // the same instants in Kyiv (UTC+3 in October) fall on other days
  const k = groupByDay(evs, kyiv, d(8, 0));
  assert.deepEqual(
    k.map((e) => e.day),
    ['Sat 10 Oct', null, 'Sun 11 Oct', 'Mon 12 Oct'],
  );
});

test('isStale: a list is valid for the current cycle of the finest included level', () => {
  const win = [100, 200];
  assert.equal(isStale(100, ...win), false, 'the start of the window belongs to it');
  assert.equal(isStale(150, ...win), false);
  assert.equal(isStale(199.999, ...win), false);
  assert.equal(isStale(200, ...win), true, 'the first listed event has passed');
  assert.equal(isStale(5e9, ...win), true, 'far forward (a month per second)');
  assert.equal(isStale(99.9, ...win), true, 'time ran backwards out of the window');
  assert.equal(isStale(5, -Infinity, Infinity), false, 'an empty list stays valid until time runs back');
  // the window of a real list: events are all after t, and every t inside the window sees the same list
  const evs = buildEvents(model, A, { importance: 'ζ', maxLevel: 9, count: 8 });
  const from = model.levelAt(A, 5).start;
  const until = evs[0].time;
  for (const t of [from, A, until - 0.01]) {
    assert.equal(isStale(t, from, until), false);
    assert.deepEqual(buildEvents(model, t, { importance: 'ζ', maxLevel: 9, count: 8 }).map((e) => e.key), evs.map((e) => e.key));
  }
  assert.equal(isStale(until + 0.01, from, until), true);
  assert.notDeepEqual(buildEvents(model, until + 0.01, { importance: 'ζ', maxLevel: 9, count: 8 }).map((e) => e.key), evs.map((e) => e.key));
});

test('buildEvents at time-lapse speeds: events are always after the displayed time when recomputed per frame', () => {
  // the Up next card recomputes whenever the window is stale; at 1 year per second a 60 Hz frame advances half a year
  let t = A;
  let [from, until] = [-Infinity, -Infinity];
  let list = [];
  for (let frame = 0; frame < 300; frame++, t += 31557600 / 60) {
    if (isStale(t, from, until)) {
      list = buildEvents(model, t, { importance: 'ζ', maxLevel: 9, count: 8 });
      from = model.levelAt(t, 5).start;
      until = list[0].time;
    }
    assert.ok(list[0].time > t, `frame ${frame}: hero ${list[0].time} is after ${t}`);
  }
});

test('advancedBy recognises a list that has moved forward', () => {
  const k = (...ks) => ks.map((key) => ({ key }));
  assert.equal(advancedBy(k('a', 'b', 'c'), k('b', 'c', 'd')), 1);
  assert.equal(advancedBy(k('a', 'b', 'c'), k('c', 'd', 'e')), 2);
  assert.equal(advancedBy(k('a', 'b', 'c'), k('a', 'b', 'c')), 0);
  assert.equal(advancedBy(k('a', 'b', 'c'), k('x', 'y', 'z')), -1, 'a jump in time');
  assert.equal(advancedBy(k('a', 'b', 'c'), k('b', 'x', 'd')), -1, 'different sequence');
  assert.equal(advancedBy([], k('a')), -1);
  assert.equal(advancedBy(k('a'), []), -1);
});

// ---------------------------------------------------------------------------
// pure mode (docs/design/80-pure.md, revision 2): Fractonica terms only; one unit per depth, whole cycles, Blinks
// ---------------------------------------------------------------------------
const pure = createPure(model, { now: () => A });
const R = model.F.rational;
const exactPos = (t) => model.clock.positionAt(R(String(Math.round(t * 1000) / 1000)));
const SAMPLE = [A, 946684800, 2886085800, 125593320.816, 1e9, -3e9, model.tMin + 5, model.tMax - 5, model.tMax - 3 * 86400];

test('pure: names are the library vocabulary of cycles, counters and sectors', () => {
  for (const t of SAMPLE) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      assert.equal(cycleWords(pure, L, lv.local), pure.nameAt(t, L), `depth ${L + 1} at ${t}`);
      assert.equal(counterName(pure, lv.local, lv.siblings), pure.ordinalName(lv.local + 1));
      assert.ok(cycleWords(pure, L, lv.local).endsWith(counterName(pure, lv.local, lv.siblings)), 'the row counter completes the chip');
      // the bar sector the phase is in is the child cycle of that number
      if (L < 13) {
        const seg = segmentState(lv.phase, lv.factor);
        assert.equal(sectorName(pure, L, seg.index), pure.nameAt(t, L + 1), `sector of depth ${L + 1}`);
      }
    }
  }
  assert.equal(counterName(pure, 99, 5), 'Pentafracton', 'never beyond the sibling count');
  assert.equal(depthWords(pure, 6), 'Eta, depth 7');
  assert.equal(levelWord(pure, 2), 'Gamma');
  assert.equal(levelWord(pure, 40), 'Level 41');
});

test('pure: the cycle that begins where a cycle ends, and the end of the catalogue', () => {
  for (const t of SAMPLE.slice(0, 7)) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      const next = nextCycle(model, pure, L, lv.cycleBig);
      assert.ok(next, `depth ${L + 1} has a successor at ${t}`);
      assert.equal(next.name, pure.nameAt(lv.end + 0.001, L), `depth ${L + 1} at ${t}`);
      assert.equal(next.address, pure.addressAt(lv.end + 0.001, L));
      assert.equal(next.short, pure.cycleShort(L, model.levelAt(lv.end + 0.001, L).cycle));
      assert.equal(endsText(next), `→ ${next.name} begins`);
    }
  }
  // the last cycle of every level has no successor
  for (let L = 0; L < 14; L++) {
    const last = model.levelAt(model.tMax - 0.002, L);
    assert.equal(nextCycle(model, pure, L, last.cycleBig), null, `depth ${L + 1}`);
  }
  assert.equal(endsText(null), '→ the catalogue ends');
});

/** A duration the core writes: up to three "count + unit symbol" parts of the ladder (α … ν), or a decimal of ν. */
const DURATION = /^(?:\d+[α-ν](?: \d+[α-ν]){0,2}|\d+(?:\.\d+)?ν|<0\.001ν)$/u;

test('pure: time left is counted in ladder units, exactly, and never goes negative', () => {
  // SPEC vector A: eta has 56 min 12 s left = 6.67 iota = 1 theta + 2.67 iota
  const eta = model.levelAt(A, 6);
  assert.equal(leftText(model, pure, A, eta.end), '1θ 2ι');
  assert.equal(leftText(model, pure, A, A - 5), '0ν', 'a passed instant reads zero');
  assert.equal(leftText(model, pure, A, A), '0ν');
  for (const t of SAMPLE.slice(0, 7)) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      const txt = leftText(model, pure, t, lv.end);
      assert.match(txt, DURATION, `${L}: ${txt}`);
      assert.ok(txt.split(' ').length <= 2, `${L}: two parts at most: ${txt}`);
      assert.doesNotMatch(txt, /½|beat/i);
      // agrees with the core's span between two instants
      assert.equal(txt, pure.between(t, lv.end, { parts: 2 }));
    }
  }
  // the end of the catalogue is a valid instant
  assert.match(leftText(model, pure, model.tMax - 100, model.tMax), /^\d/);
  // outside the catalogue the span falls back to seconds around t1
  assert.match(leftText(model, pure, model.tMax + 100, model.tMax + 5000), DURATION);
  // below one Blink it is a decimal count of it, never a unit that does not exist
  const nu = model.levelAt(A, 12);
  assert.match(leftText(model, pure, nu.end - 0.1, nu.end), /^0\.\d+ν$/u);
});

test('pure: the hero countdown shows at most three units, zero parts skipped by the core', () => {
  const U = pure.UNITS;
  const len = (id) => pure.unitPos(U.find((u) => u.id === id));
  const sym = (id) => U.find((u) => u.id === id).sym;
  const p0 = 22.9;
  const t0 = model.timeOfPosition(p0);
  /** The instant `parts` = [[unit id, count], ...] after p0, plus `share` of the unit that follows the last one (no float edge). */
  const after = (parts, tailId, share = 0.5) => model.timeOfPosition(p0 + parts.reduce((a, [id, n]) => a + n * len(id), 0) + share * len(tailId));
  const cases = [
    // [parts, the unit after them, expected text, share of that unit added]
    [[['gamma', 3], ['delta', 1], ['epsilon', 2]], 'zeta', '3γ 1δ 2ε'],
    [[['beta', 2], ['gamma', 4], ['delta', 3]], 'epsilon', '2β 4γ 3δ'],
    [[['zeta', 1], ['eta', 4], ['theta', 3]], 'iota', '1ζ 4η 3θ'],
    [[['eta', 3], ['theta', 5], ['iota', 2]], 'kappa', '3η 5θ 2ι'],
    [[['iota', 3], ['kappa', 4], ['lambda', 9]], 'mu', '3ι 4κ 9λ'],
    [[['lambda', 3], ['mu', 2]], 'nu', '3λ 2μ'], // half a Blink left over: the third part is zero and skipped
    [[['gamma', 3], ['delta', 0], ['epsilon', 2]], 'zeta', '3γ 2ε', 0], // a zero between two counts is skipped, not written "0δ"
    [[['gamma', 3], ['delta', 0], ['epsilon', 2]], 'zeta', '3γ 2ε 5η'], // ... and the next non-zero unit takes the third place
    [[['gamma', 3], ['delta', 1]], 'epsilon', '3γ 1δ', 0], // nothing left: no zero part is written, "0ε"
    [[['zeta', 2]], 'eta', '2ζ', 0], // a whole number of units reads as that count alone
  ];
  for (const [parts, tail, expect, share] of cases) {
    const text = heroLeft(model, pure, t0, after(parts, tail, share));
    assert.equal(text, expect, `${parts.map(([i, n]) => n + sym(i)).join(' ')}`);
    assert.ok(text.split(' ').length <= 3, `at most three units: ${text}`);
    assert.doesNotMatch(text, / 0[^ ]+$/u, `no zero part: ${text}`);
    assert.equal(text, pure.between(t0, after(parts, tail, share), { parts: 3 }), 'the core counts it');
  }
  assert.equal(heroLeft(model, pure, A, A - 1), '0ν', 'nothing left');
  // a span of a few Blinks keeps the core's decimal
  assert.match(heroLeft(model, pure, A, A + 0.7), /^2\.\dν$/u);
  // the three-unit hero text starts like the two-unit row text of the same span
  for (const t of SAMPLE.slice(0, 5)) {
    const lv = model.levelAt(t, 5);
    const hero = heroLeft(model, pure, t, lv.end);
    const row = leftText(model, pure, t, lv.end);
    assert.ok(hero.startsWith(row.split(' ')[0]), `${t}: ${hero} vs ${row}`);
    assert.ok(hero.split(' ').length <= 3 && row.split(' ').length <= 2);
  }
});

test('pure: cycle lengths are the units themselves, exactly, at every depth (core pure.cycleLength, no local trimming)', () => {
  const expect = ['1α', '1β', '1γ', '1δ', '1ε', '1ζ', '1η', '1θ', '1ι', '1κ', '1λ', '1μ', '1ν', '0.14ν'];
  for (let L = 0; L < 14; L++) {
    assert.equal(pure.cycleLength(L), expect[L], `depth ${L + 1}`);
    for (const t of [A, 946684800, 2886085800, model.tMin + 5]) assert.equal(lengthText(model, pure, model.levelAt(t, L)), expect[L], `depth ${L + 1} at ${t}`);
  }
  // a cycle clipped by the end of the catalogue keeps its odd tail
  const clipped = model.levelAt(model.tMax - 5, 0);
  assert.ok(clipped.clipped);
  assert.equal(lengthText(model, pure, clipped), '1β 3γ', 'the last alpha keeps 1 of its 4 saros intervals (69 - 68), a bit over a beta');
  assert.equal(lengthText(model, pure, clipped), pure.durationPos(1, { parts: 2 }));
  const lastEta = model.levelAt(model.tMax - 0.002, 6);
  assert.equal(lastEta.clipped, true);
  assert.equal(lengthText(model, pure, lastEta), '2θ 1ι', 'a clipped η is shorter than 1η');
  // the core never writes a zero part, so no length does
  for (let L = 0; L < 14; L++) assert.doesNotMatch(pure.cycleLength(L), / 0\D/u, `depth ${L + 1}`);
});

test('pure: a unit is explained by what it holds, with its particle name only where it has one', () => {
  // names come from the core's table; α β γ have none yet and ξ is not a unit
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((L) => unitWord(pure, L)), ['', '', '', 'Atom', 'Nuclide', 'Hadron', 'Helion', 'Quark', 'Preon', 'Chromon', 'Flavon', 'Somon', 'Blink', '']);
  assert.equal(holds(model, 5), '11η');
  assert.equal(holds(model, 6), '9θ');
  assert.equal(holds(model, 2), '5δ');
  for (let L = 0; L < 13; L++) {
    // "one cycle holds N of the next unit" is the ladder's own factor, the same as the unit lengths say
    const n = model.levelInfo(L).factor;
    assert.equal(holds(model, L), `${n}${pure.UNITS[L + 1]?.sym ?? 'ξ'}`);
    if (pure.UNITS[L + 1]) assert.ok(Math.abs(pure.unitPos(pure.UNITS[L]) / pure.unitPos(pure.UNITS[L + 1]) - n) < 1e-9, `depth ${L + 1}`);
  }
  assert.equal(unitClause(model, pure, 5), 'a Hadron (ζ) is 11η');
  assert.equal(unitClause(model, pure, 3), 'an Atom (δ) is 5ε');
  assert.equal(unitClause(model, pure, 2), 'a γ cycle is 5δ');
  assert.equal(unitClause(model, pure, 0), 'an α cycle is 5β');
  assert.equal(unitClause(model, pure, 12), 'a Blink (ν) is 7ξ');
  assert.equal(unitClause(model, pure, 13), 'a ξ cycle is 0.14ν', 'finer than a Blink: told as a part of it');
  assert.equal(unitSentence(model, pure, 6), 'A Helion (η) is 9θ.');
});

test('pure: the phase is a pair of glyphs (256 states) whose high digit is the ladder glyph', () => {
  for (const t of SAMPLE.slice(0, 7)) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      const ph = phaseWords(pure, lv.phase);
      assert.equal(ph.hi, lv.index, `depth ${L + 1}: the glyph normal mode shows is the high digit`);
      assert.equal(ph.index, ph.hi * 16 + ph.lo);
      assert.equal(ph.text, `${ph.hi}·${ph.lo}`);
      // the accessible name is the helper's: two digits spoken as numbers, never "13 point 0"
      assert.equal(ph.label, `phase ${ph.hi} and ${ph.lo} of 256`);
      assert.match(pure.pairHTML(lv.phase), new RegExp(`aria-label="${ph.label}"`), 'the label is the one pure.pairHTML draws');
    }
  }
  assert.equal(phaseWords(pure, 0).text, '0·0');
  assert.equal(phaseWords(pure, 1).text, '15·15');
  assert.equal(phaseWords(pure, 0.5).index, 128);
  assert.equal(phaseWords(pure, 0.5).label, 'phase 8 and 0 of 256');
  assert.equal(phaseWords(pure, 0.5, 'sector phase').label, 'sector phase 8 and 0 of 256');
});

test('pure: real-time leads are counted in Blinks, lengths of too-fast cycles in two digits', () => {
  // the 2 s of "Just before" and the 1 ms of "Just after", the core's pure.blinks (3 significant digits)
  assert.deepEqual([2, 0.4, 0.0775, 0.011, 1.5].map((s) => leadBlinks(pure, s)), ['6.43 Blinks', '1.29 Blinks', '0.249 Blinks', '0.0354 Blinks', '4.82 Blinks']);
  assert.equal(leadBlinks(pure, JUST_AFTER_S), '0.00322 Blinks');
  assert.equal(leadBlinks(pure, justBeforeLead(model.levelInfo(11).meanSeconds)), '1.25 Blinks', 'a quarter of a μ cycle');
  for (const s of [2, 0.4, 0.001, 0.0775]) assert.equal(leadBlinks(pure, s), pure.blinks(s), 'the core counts it');
  // too fast to count down: two significant digits of a Blink
  const nu = model.levelInfo(12).meanSeconds;
  const xi = model.levelInfo(13).meanSeconds;
  assert.equal(periodBlinks(pure, nu), '1 Blink', 'a ν cycle is one Blink, singular');
  assert.equal(periodBlinks(pure, xi), '0.14 Blinks');
  assert.equal(periodBlinks(pure, 0.311), '1 Blink');
  assert.equal(periodBlinks(pure, 0.0777), '0.25 Blinks');
  assert.equal(periodBlinks(pure, xi / 4), '0.036 Blinks');
  assert.equal(periodBlinks(pure, 1.555), '5 Blinks');
  // never a "beat", an Earth unit, or a long float tail
  for (const s of [2, 0.4, 0.001, nu, xi, xi / 4, 0.0777, 1.555, 33]) {
    for (const t of [leadBlinks(pure, s), periodBlinks(pure, s)]) assert.match(t, /^(?:<?\d+(?:\.\d{1,5})?) Blinks?$/u, t);
  }
});

test('pure: quarter thresholds are named by their two finest counters; the end reads as the next start', () => {
  const lv = model.levelAt(A, 6); // eta 1 of 11, SPEC vector A
  const where = lv.thresholds.slice(1).map((t) => quarterWhere(model, pure, t.time, 6));
  const c = (t) => counterParts(pure, t);
  // clock readings in the notation of the header clock: completed units, count first (0-based), joined by spaces
  assert.deepEqual(where, [`0η 9ι`, `0η 18ι`, `0η 27ι`, `1η 0ι`]);
  assert.equal(where[3], `${c(lv.end + 0.001)[6]} ${c(lv.end + 0.001)[7]}`);
  // whole cycles all the way down: the date counters of a ζ's quarters are η counts inside it
  const zeta = model.levelAt(A, 5);
  assert.deepEqual(
    zeta.thresholds.slice(1).map((t) => quarterWhere(model, pure, t.time, 5)),
    ['ζ#4 · 2η', 'ζ#4 · 5η', 'ζ#4 · 8η', 'ζ#5 · 0η'],
  );
  for (const t of SAMPLE.slice(0, 7)) {
    for (let L = 0; L < 10; L++) {
      const cyc = model.levelAt(t, L);
      const labels = cyc.thresholds.slice(1).map((th) => quarterWhere(model, pure, th.time, L));
      assert.equal(new Set(labels).size, 4, `depth ${L + 1} at ${t}: four different labels ${labels.join(' / ')}`);
      // the end is the start of the next cycle (the rounding of the threshold to a millisecond never shows the old one)
      if (cyc.end < model.tMax - 1) {
        const next = counterParts(pure, cyc.end + 0.001);
        assert.ok(labels[3].endsWith(next.slice(0, 9)[Math.min(8, [1, 2, 3, 4, 5, 6, 7, 7, 8, 8][L])]), `depth ${L + 1}: ${labels[3]} vs ${next}`);
      }
      assert.ok(labels.every((x) => x.split(' · ').length <= 2 || /^[αβγ]#\d+ [βγ]#\d+$/.test(x)), `at most two counters: ${labels}`);
      // notation: ordinals are X#n, counts are nX; the old "ζ 5 · η 3" (symbol, space, number) never appears
      assert.ok(labels.every((x) => !/(^|[\s·])[α-ω] \d+(?![\dα-ω#])/u.test(x) && !/½/.test(x)), `no symbol-then-number counters: ${labels}`);
    }
    for (let L = 10; L < 14; L++) assert.equal(quarterWhere(model, pure, model.levelAt(t, L).thresholds[2].time, L), '', 'λ and finer: the ¼ ½ ¾ column says it');
  }
  assert.equal(quarterWhere(model, pure, null, 6), '');
  assert.equal(quarterWhere(model, pure, model.tMax, 6).length > 0, true, 'the catalogue end is a valid threshold');
});

test('pure: dateAtPosition is the exact-arithmetic twin of pure.date', () => {
  let seed = 987654;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 3000; i++) {
    const t = Math.round((model.tMin + rnd() * (model.tMax - model.tMin - 2)) * 1000) / 1000;
    const p = exactPos(t);
    const d = dateAtPosition(model, p.numerator, p.denominator);
    assert.deepEqual(d, pure.date(t), `t = ${t}`);
  }
  // on a boundary the new unit has begun
  const z = model.levelAt(A, 5);
  const ps = exactPos(z.end + 0.0006);
  assert.deepEqual(dateAtPosition(model, ps.numerator, ps.denominator), pure.date(z.end + 0.0006));
  // whole cycles: each ordinal is its cycle's index inside the parent, 1-based (γ 1..13, δ 1..5, ε 1..5, ζ 1..7)
  const hi = { beta: 5, gamma: 13, delta: 5, epsilon: 5, zeta: 7 };
  for (let i = 0; i < 400; i++) {
    const t = Math.round((model.tMin + rnd() * (model.tMax - model.tMin - 2)) * 1000) / 1000;
    const p = exactPos(t);
    const d = dateAtPosition(model, p.numerator, p.denominator);
    assert.ok(d.alpha >= 1 && d.alpha <= 18, `α ${d.alpha}`);
    for (const [k, n] of Object.entries(hi)) assert.ok(d[k] >= 1 && d[k] <= n, `${k} ${d[k]} of ${n}`);
  }
  assert.equal(dateTail({ delta: 3, epsilon: 2, zeta: 5 }), 'δ#3 · ε#2 · ζ#5');
  // the tail is the end of pure.dateText: the one spelling of a date
  for (const t of [A, 946684800, 2886085800]) assert.ok(pure.dateText(t).endsWith(dateTail(pure.date(t))), t);
  assert.equal(pure.dateText(A), `α#6 β#4 γ#9 · ${dateTail(pure.date(A))}`);
});

test('pure: an upcoming turnover is named by the cycle that begins there', () => {
  for (const imp of IMPORTANCE) {
    for (const t of [A, 946684800, 2886085800, model.tMin + 5]) {
      for (const e of buildEvents(model, t, { importance: imp, maxLevel: 9, count: 8 })) {
        const ti = turnoverInfo(model, pure, e);
        const after = e.time + 0.001;
        assert.equal(ti.name, pure.nameAt(after, e.top), `event ${e.key}`);
        assert.equal(ti.address, pure.addressAt(after, e.top));
        assert.equal(ti.short, pure.cycleShort(e.top, model.levelAt(after, e.top).cycle));
        const d = pure.date(after);
        assert.deepEqual(ti.date, d);
        assert.ok(positionOfKey(e.key).den > 0n);
      }
    }
  }
  // a turnover whose next cycle would lie past the catalogue (an exact end position) names nothing
  assert.equal(turnoverInfo(model, pure, { key: '276/1', top: 0 }).name, null);
  assert.equal(turnoverInfo(model, pure, { key: 'garbage', top: 5 }).name, null);
  // the turnovers that are left near the end all begin a cycle
  for (const e of buildEvents(model, model.tMax - 6 * 86400, { importance: 'ζ', maxLevel: 9 })) assert.ok(turnoverInfo(model, pure, e).name);
  assert.equal(positionOfKey('x'), null);
});

test('pure: the list is grouped by the ζ (one Hadron) an event falls in, the pure "day"', () => {
  const evs = buildEvents(model, A, { importance: 'η', maxLevel: 9, count: 8 });
  const g = groupByZeta(model, pure, evs.slice(1));
  assert.equal(g.length, 7);
  const zeta = (t) => model.levelAt(t, 5).cycleBig;
  for (let i = 0; i < g.length; i++) {
    const at = evs[i + 1].time + 0.001;
    const same = i > 0 && zeta(at) === zeta(evs[i].time + 0.001);
    if (i > 0) assert.equal(g[i].newDay, !same, `row ${i}`);
    assert.equal(g[i].day, null);
    assert.equal(g[i].clock, dateTail(pure.date(at)));
    // the group is the date counters through ζ: one heading is one ζ
    assert.equal(g[i].dayKey, String(zeta(at)));
  }
  assert.equal(g[0].newDay, false, 'the first row never carries a separator');
  // η turnovers come several to a ζ: the first row of such a group carries the date counters as its heading
  const heads = g.filter((e) => e.head);
  assert.ok(heads.length >= 1, 'a group of several events has a heading');
  for (const e of heads) {
    const k = g.filter((x) => x.dayKey === e.dayKey).length;
    assert.ok(k > 1, 'only groups of two or more are headed');
    assert.equal(e.head, e.clock);
    assert.ok(g.indexOf(e) === 0 || g[g.indexOf(e) - 1].dayKey !== e.dayKey, 'on the first row of the group');
  }
  assert.equal(g.filter((e) => e.head).length, new Set(g.filter((e) => e.head).map((e) => e.dayKey)).size, 'one heading per group');
  // events of ζ and coarser each fall in a ζ of their own: every row is its own group, none is headed
  const coarse = buildEvents(model, A, { importance: 'ζ', maxLevel: 9, count: 8 });
  const cg = groupByZeta(model, pure, coarse);
  assert.ok(cg.slice(1).every((e) => e.newDay));
  assert.ok(cg.every((e) => e.head === ''));
  assert.equal(new Set(cg.map((e) => e.dayKey)).size, cg.length);
});

test('pure: everything the two cards can say passes the leak rules (no date, unit word, percent, zone, half or beat)', () => {
  const strings = new Set();
  const add = (x) => x && strings.add(String(x));
  for (const t of SAMPLE.slice(0, 8)) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      if (!lv) continue;
      const next = nextCycle(model, pure, L, lv.cycleBig);
      add(counterName(pure, lv.local, lv.siblings));
      add(cycleWords(pure, L, lv.local));
      add(depthWords(pure, L));
      add(leftText(model, pure, t, lv.end));
      add(heroLeft(model, pure, t, lv.end));
      add(leftText(model, pure, lv.start, t) + ' ago');
      add(lengthText(model, pure, lv));
      add(pure.cycleLength(L));
      add(quarterWhere(model, pure, lv.end, L));
      add(endsText(next));
      add(next?.address);
      add(pathText(pure, model.cycleToPath(L, lv.cycleBig)));
      add(phaseWords(pure, lv.phase).label);
      add(periodBlinks(pure, model.levelInfo(L).meanSeconds));
      add(`+${periodBlinks(pure, lv.duration / 4)}`);
      add(sectorName(pure, L, segmentState(lv.phase, lv.factor).index));
      for (const th of lv.thresholds.slice(1)) add(quarterWhere(model, pure, th.time, L));
      add(turnoverWords(L, 13));
      add(unitClause(model, pure, L));
      add(unitSentence(model, pure, L));
      add(unitWord(pure, L));
    }
    for (const imp of IMPORTANCE) {
      add(`Counting ${imp.label} turnovers · ${unitClause(model, pure, imp.top)}`);
      add(`Turnovers of cycles down to ${imp.id}, depth ${imp.top + 1}. ${unitSentence(model, pure, imp.top)}`);
      const evs = buildEvents(model, t, { importance: imp, maxLevel: 9 });
      for (const e of evs) {
        const ti = turnoverInfo(model, pure, e);
        add(ti.name);
        add(ti.address);
        add(`→ ${ti.name} begins`);
        add(dateTail(ti.date ?? { delta: 1, epsilon: 1, zeta: 1 }));
        add(heroLeft(model, pure, t, e.time));
      }
      for (const g of groupByZeta(model, pure, evs)) add(g.head);
    }
  }
  for (const s of [2, 0.4, 0.0775, 0.011, 0.001]) add(leadBlinks(pure, s));
  add(pure.catalogueText());
  add(pure.stamp(model.tMin, 'beta'));
  add(pure.stamp(model.tMax, 'beta'));
  const hard = judge([...strings].map((text) => ({ kind: 'text', text, where: '' })), 'ladder pure').filter((l) => l.severity === 'hard');
  assert.deepEqual(hard.map((l) => `${l.rule}: ${l.text}`), []);
  assert.ok(strings.size > 300, `${strings.size} strings checked`);
  // revision 2 vocabulary guards, independent of the scanner: no half units, no beats
  for (const s of strings) assert.doesNotMatch(s, /½|\bbeats?\b/i, s);
});

test('pure: the ladder and up next say nothing Earth-ish in their own source strings', () => {
  const src = (f) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8');
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // every string literal that sits in a pure branch must not carry an Earth unit (checked on the pure wording module whole)
  const code = strip(src('ladder/pure-text.js'));
  const literals = (code.match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"/g) ?? []).join('\n');
  assert.ok(literals.length > 200);
  for (const bad of [' ms', ' min', 'hour', ' day', 'week', 'month', 'year', 'second', 'minute', 'UTC', 'percent', '%', ' Hz', 'Unix', 'ISO']) {
    assert.ok(!literals.includes(bad), `pure-text.js strings mention "${bad}"`);
  }
  // revision 2: whole cycles and Blinks. No half units, no beats, no "ξ" as a unit, in any code or comment of the two cards
  for (const f of ['ladder.js', 'upnext.js', 'ladder/pure-text.js', 'ladder/dom.js', 'ladder/lib.js']) {
    const text = src(f);
    assert.doesNotMatch(text, /[α-ξ]½/u, `${f} still writes a half-cycle unit`);
    assert.doesNotMatch(text, /\bbeats?\b/i, `${f} still says "beat"`);
    assert.doesNotMatch(text, /leadBeats|periodBeats|groupByHalf/, `${f} still uses a retired helper`);
  }
});

// ---------------------------------------------------------------------------
// pure mode: notation, landings, shared helpers (regressions of the audit)
// ---------------------------------------------------------------------------
test('pure: notation - ordinals are X#n, counts are nX, "X d" is only a chip', () => {
  const ORD = /^[α-ζ]#\d+$/u;
  const COUNT = /^\d+[ηιλ]$/u;
  for (const t of SAMPLE.slice(0, 7)) {
    const parts = counterParts(pure, t);
    assert.equal(parts.length, 9);
    parts.slice(0, 6).forEach((p) => assert.match(p, ORD, `${t}`));
    parts.slice(6).forEach((p) => assert.match(p, COUNT, `${t}`));
    // the counters are the ones pure.stamp writes, in its order and spelling
    const c = pure.clock(t);
    assert.equal(`${parts[6]} ${parts[7]} ${parts[8]}`, `${c.eta}η ${c.iota}ι ${c.lambda}λ`);
    assert.ok(pure.stamp(t, 'lambda').endsWith(` · ${parts[6]} ${parts[7]} ${parts[8]}`));
    assert.ok(pure.stamp(t, 'zeta').endsWith(` · ${parts[3]} · ${parts[4]} · ${parts[5]}`));
    assert.equal(pure.dateText(t).split(' · ').slice(1).join(' · '), `${parts[3]} · ${parts[4]} · ${parts[5]}`);
    for (let L = 0; L < 10; L++) {
      const lv = model.levelAt(t, L);
      for (const th of lv.thresholds.slice(1)) {
        const w = quarterWhere(model, pure, th.time, L);
        // grammar: TOKEN ((" · " | " ") TOKEN)* with TOKEN an ordinal or a count; never a letter, a space and a number
        assert.match(w, /^(?:[α-ζ]#\d+|\d+[ηιλ])(?: · | )(?:[α-ζ]#\d+|\d+[ηιλ])$/u, `${L}: ${w}`);
        assert.doesNotMatch(w, /(^|[\s·])[α-ω] \d+(?![\dα-ω#])/u, `${L}: ${w}`);
      }
    }
  }
  // a clock reading of the end of a cycle is the start of the next: "1η 0ι" for an η that is not the last in its ζ
  const eta = model.levelAt(A, 6);
  assert.equal(quarterWhere(model, pure, eta.end, 6), '1η 0ι');
  // the last η of a ζ ends at the start of the next ζ: counters wrap to 0η
  const last = model.levelAt(model.levelAt(A, 5).end - 0.5, 6);
  assert.equal(last.local, 10);
  assert.match(quarterWhere(model, pure, last.end, 6), /^0η 0ι$/);
  // sentences name a cycle by its letter or its name, never "ζ 6"
  for (let top = 0; top <= 6; top++) for (let max = top; max <= 13; max++) assert.doesNotMatch(turnoverWords(top, max), /[α-ω] \d/u, turnoverWords(top, max));
});

test('pure: the hero sentence names the cycle by its letter and fits one line', () => {
  assert.equal(turnoverWords(5, 9), 'ζ ends — 4 finer cycles (η, θ, ι, κ) end with it.');
  assert.equal(turnoverWords(4, 8), 'ε ends — 4 finer cycles (ζ, η, θ, ι) end with it.');
  assert.equal(turnoverWords(7, 8), 'θ ends — 1 finer cycle (ι) ends with it.');
  assert.equal(turnoverWords(9, 9), 'κ ends.');
  assert.equal(turnoverWords(5, 3), 'ζ ends.');
  assert.equal(turnoverWords(0, 9), 'α ends — 9 finer cycles (β … κ) end with it.');
  for (let top = 0; top <= 13; top++) for (let max = top; max <= 13; max++) assert.ok(turnoverWords(top, max).length <= 52, turnoverWords(top, max));
  // normal mode keeps its own sentence ("ζ 6 ends — ...")
  assert.equal(turnoverSentence(5, 9), 'ζ 6 ends — 4 finer cycles (η, θ, ι, κ) end with it.');
});

test('Just after / Just before land exactly 1 ms inside (or the lead before) the cycle boundary, at every depth, on any boundary', () => {
  let seed = 20260810;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let checked = 0;
  for (let i = 0; i < 300; i++) {
    const t = model.tMin + rnd() * (model.tMax - model.tMin - 10);
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      if (!lv || lv.end >= model.tMax - 1) continue;
      const dest = justAfterTime(lv.end);
      const at = model.levelAt(dest, L);
      assert.equal(at.cycle, lv.cycle + 1, `depth ${L + 1} at ${t}`);
      // 1 ms inside the new cycle: not 0, not 2 (instants near 3e10 s are only ~4 microseconds apart)
      near(dest - at.start, JUST_AFTER_S, 2e-5, `depth ${L + 1} at ${t}: into the next cycle`);
      checked++;
    }
  }
  // boundaries that are exact milliseconds (every catalogue instant is, and an α boundary is one of every depth)
  for (let k = 4; k < model.catalogue.length - 4; k += 4) {
    const edge = model.catalogue[k];
    for (const L of [0, 3, 6, 9, 13]) {
      const lv = model.levelAt(edge - 0.002, L);
      near(lv.end, edge, 1e-5, `catalogue instant ${k} ends a depth ${L + 1} cycle`);
      const at = model.levelAt(justAfterTime(lv.end), L);
      assert.equal(at.cycle, lv.cycle + 1);
      near(justAfterTime(lv.end) - at.start, JUST_AFTER_S, 2e-5, `catalogue instant ${k}, depth ${L + 1}`);
      checked++;
    }
  }
  // and every Up next turnover, for the coarsest level that rolls and every finer one with it
  for (const imp of IMPORTANCE) {
    for (const t of [A, 946684800, 2886085800, model.tMin + 5]) {
      for (const e of buildEvents(model, t, { importance: imp, maxLevel: 13, count: 8 })) {
        const dest = justAfterTime(e.time);
        for (let L = e.top; L < 14; L++) {
          const before = model.levelAt(e.time - 0.003, L);
          const at = model.levelAt(dest, L);
          assert.equal(at.cycle, before.cycle + 1, `turnover ${e.key} depth ${L + 1}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 4000, `${checked} landings checked`);
});

test('pure: the ladder and up next use the core helpers instead of local copies', () => {
  const src = (f) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8');
  for (const f of ['ladder.js', 'upnext.js', 'ladder/pure-text.js', 'ladder/dom.js']) {
    const text = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\btrimZeros\b|\bnominalLength\b|\bpairGlyphs\b|\bcycleLength\(model/.test(text), `${f} still carries a local copy of a core helper`);
  }
  assert.ok(src('ladder/pure-text.js').includes('pure.cycleLength('), 'cycle lengths come from pure.cycleLength');
  assert.ok(src('ladder/dom.js').includes('pure.pairHTML('), 'the glyph pair is pure.pairHTML');
});
