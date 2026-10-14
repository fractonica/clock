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
  clockAtPosition,
  counterParts,
  cycleAddress,
  cycleTitle,
  dateAtPosition,
  depthWords,
  endsText,
  groupByNuclide,
  heroLeft,
  holds,
  leadBlinks,
  leftText,
  lengthText,
  levelSay,
  levelWord,
  nextCycle,
  periodBlinks,
  phaseWords,
  positionOfKey,
  quarterWhere,
  quarterWord,
  rowLabel,
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
// pure mode (docs/design/80-pure.md, SPEC §15, revision 3): majors in words with quarter words, minor units every
// other depth (ε η ι λ ν), ordinals, the Helion numbered 1–77 in its Nuclide, counts of finer units from 0, Blinks
// ---------------------------------------------------------------------------
const pure = createPure(model, { now: () => A });
const R = model.F.rational;
const exactPos = (t) => model.clock.positionAt(R(String(Math.round(t * 1000) / 1000)));
const SAMPLE = [A, 946684800, 2886085800, 125593320.816, 1e9, -3e9, model.tMin + 5, model.tMax - 5, model.tMax - 3 * 86400];
/** A span the core writes: up to three "count + unit" parts over α β γ δ ε η ι λ ν, or a decimal of ν. */
const DURATION = /^(?:\d+[αβγδεηιλν](?: \d+[αβγδεηιλν]){0,2}|\d+(?:\.\d+)?ν|<0\.001ν)$/u;
/** A token of the stamp: an ordinal of α β γ δ ε, the Helion's number, or a count of ι λ ν. */
const TOKEN = '(?:[αβγδε]#\\d+|\\d+[ηιλν])';
const QW = ['Peak', 'Node', 'Valley', 'End'];

test('pure: SPEC §15.6 vector A reads as the spec says', () => {
  assert.equal(pure.dateText(A, { form: 'full', upTo: 'nu' }), 'Alpha Hexafracton Valley, Beta Tetrafracton Valley, Gamma Nonafracton Valley, Delta Trifracton End, ε#5 34η 29ι 21λ 3ν');
  assert.equal(pure.dateText(A), 'Delta Trifracton End ε#5 34η 29ι');
  assert.equal(counterParts(pure, A).join(' '), 'α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ 3ν');
  // "at A the depth-7 end is 3 372.428 s away, which is the span 6ι 43λ"
  assert.equal(leftText(model, pure, A, model.levelAt(A, 6).end), '6ι 43λ');
  const rows = [];
  for (let L = 0; L < 14; L++) rows.push(rowLabel(pure, model.levelAt(A, L)));
  assert.deepEqual(rows, ['Hexafracton Valley', 'Tetrafracton Valley', 'Nonafracton Valley', 'Trifracton End', 'ε#5', '34η', '34η', '28ι', '29ι', '13λ', '21λ', '0ν', '3ν', '3.43ν']);
  assert.equal(phaseWords(pure, model.levelAt(A, 6).phase).text, '13·0', 'the Helion pair of vector A');
});

test('pure: a row names its cycle the way its kind is said (majors in words with the quarter, minors by ordinal or count)', () => {
  for (const t of SAMPLE) {
    const c = pure.clock(t);
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      const label = rowLabel(pure, lv);
      if (L <= 3) {
        // the chip completes the major name: "Delta" + "Trifracton Node" is pure.majorText
        assert.equal(`${pure.LEVEL_NAMES[L]} ${label}`, pure.majorText(t, L), `depth ${L + 1} at ${t}`);
        assert.ok(QW.includes(label.split(' ').at(-1)), label);
        assert.equal(quarterWord(pure, lv.phase), QW[pure.quarterAt(t, L)]);
      } else {
        assert.equal(label, pure.cycleShort(L, lv.cycleBig), `depth ${L + 1} at ${t}`);
        assert.doesNotMatch(label, /fracton|Peak|Node|Valley|End/);
      }
      // the unit levels show the clock's own reading
      const unit = { 4: `ε#${c.epsilon}`, 6: `${c.eta}η`, 8: `${c.iota}ι`, 10: `${c.lambda}λ`, 12: `${c.nu}ν` }[L];
      if (unit) assert.equal(label, unit, `depth ${L + 1} at ${t}`);
      assert.equal(cycleTitle(pure, L, lv.cycleBig), pure.nameAt(t, L));
      // the bar sector the phase is in is the child cycle with that index, said the same way
      if (L < 13) {
        const seg = segmentState(lv.phase, lv.factor);
        const sec = sectorName(pure, lv, seg.index, seg.frac);
        const child = model.levelAt(t, L + 1);
        if (L + 1 <= 3) {
          assert.equal(sec.name, pure.nameAt(t, L + 1), `sector of depth ${L + 1}`);
          assert.equal(sec.quarter, QW[pure.quarterAt(t, L + 1)]);
          assert.ok(sec.major);
        } else {
          assert.equal(sec.name, pure.cycleShort(L + 1, child.cycleBig), `sector of depth ${L + 1}`);
          assert.equal(sec.quarter, null);
        }
      }
    }
  }
  assert.equal(depthWords(pure, 6), 'Eta, depth 7');
  assert.equal(levelWord(pure, 2), 'Gamma');
  assert.equal(levelWord(pure, 40), 'Level 41');
  assert.deepEqual([0, 3, 4, 5, 6, 13].map((L) => levelSay(pure, L)), ['Alpha', 'Delta', 'ε', 'ζ', 'η', 'ξ']);
  assert.deepEqual([0, 0.24, 0.25, 0.5, 0.99, 1, NaN].map((p) => quarterWord(pure, p)), ['Peak', 'Peak', 'Node', 'Valley', 'End', 'End', 'Peak']);
});

test('pure: the cycle that begins where a cycle ends, and the end of the catalogue', () => {
  for (const t of SAMPLE.slice(0, 7)) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      const next = nextCycle(model, pure, L, lv.cycleBig);
      assert.ok(next, `depth ${L + 1} has a successor at ${t}`);
      const after = lv.end + 0.001;
      const sameNuclide = model.levelAt(after, 4).cycleBig === model.levelAt(lv.end - 0.0005, 4).cycleBig;
      // majors and the Nuclide by name or ordinal; finer cycles by their placing counts, short inside the same Nuclide
      const expect = L <= 4 ? pure.nameAt(after, L) : pure.nameAt(after, L, { short: sameNuclide });
      assert.equal(next.name, expect, `depth ${L + 1} at ${t}`);
      // the core's address of the start, except that a major stops at its own ordinal and a ξ keeps its decimal Blink
      if (L >= 3 && L < 13) assert.equal(next.address, pure.addressAt(after, L), `depth ${L + 1} at ${t}`);
      else if (L < 3) assert.ok(pure.addressAt(after, L).startsWith(`${next.address} `) && next.address.split(' ').length === L + 1, `depth ${L + 1}: ${next.address}`);
      assert.equal(next.address, cycleAddress(model, pure, L, model.levelAt(after, L).cycleBig));
      assert.equal(endsText(next), `→ ${next.name} begins`);
      assert.doesNotMatch(next.name, /^(?:Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi) /, 'minor cycles have no fracton names');
    }
  }
  const at = (L) => endsText(nextCycle(model, pure, L, model.levelAt(A, L).cycleBig));
  assert.equal(at(3), '→ Delta Tetrafracton begins');
  assert.equal(at(4), '→ ε#1 begins');
  assert.equal(at(6), '→ 35η begins');
  assert.equal(at(8), '→ 34η 30ι begins');
  // the last Helion of a Nuclide (77η) is followed by the first of the next Nuclide: its name says so
  const lastEta = model.levelAt(model.levelAt(A, 4).end - 0.5, 6);
  assert.equal(cycleTitle(pure, 6, lastEta.cycleBig), 'ε#5 77η');
  assert.equal(nextCycle(model, pure, 6, lastEta.cycleBig).name, 'ε#1 1η');
  // the last cycle of every level has no successor
  for (let L = 0; L < 14; L++) {
    const last = model.levelAt(model.tMax - 0.002, L);
    assert.equal(nextCycle(model, pure, L, last.cycleBig), null, `depth ${L + 1}`);
  }
  assert.equal(endsText(null), '→ the catalogue ends');
  assert.equal(cycleAddress(model, pure, 3, model.levelAt(A, 3).cycleBig), 'α#6 β#4 γ#9 δ#3');
  assert.equal(cycleAddress(model, pure, 7, model.levelAt(A, 7).cycleBig), 'α#6 β#4 γ#9 δ#3 ε#5 34η 28ι');
});

test('pure: time left is a span over the units, exactly, and never goes negative', () => {
  assert.equal(leftText(model, pure, A, A - 5), '0ν', 'a passed instant reads zero');
  assert.equal(leftText(model, pure, A, A), '0ν');
  for (const t of SAMPLE.slice(0, 7)) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      const txt = leftText(model, pure, t, lv.end);
      assert.match(txt, DURATION, `${L}: ${txt}`);
      assert.ok(txt.split(' ').length <= 2, `${L}: two parts at most: ${txt}`);
      assert.doesNotMatch(txt, /[ζθκμξ½]|beat/iu, 'the depths between the units never count a span');
      // agrees with the core's span between two instants
      assert.equal(txt, pure.between(t, lv.end, { parts: 2 }));
    }
  }
  // the end of the catalogue is a valid instant
  assert.match(leftText(model, pure, model.tMax - 100, model.tMax), /^\d/);
  // outside the catalogue the span falls back to seconds around t1
  assert.match(leftText(model, pure, model.tMax + 100, model.tMax + 5000), DURATION);
  // below ten Blinks it is a decimal count of the Blink
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
    [[['gamma', 3], ['delta', 1], ['epsilon', 2]], 'eta', '3γ 1δ 2ε'],
    [[['beta', 2], ['gamma', 4], ['delta', 3]], 'epsilon', '2β 4γ 3δ'],
    [[['epsilon', 1], ['eta', 40], ['iota', 3]], 'lambda', '1ε 40η 3ι'],
    [[['eta', 3], ['iota', 5], ['lambda', 9]], 'nu', '3η 5ι 9λ'],
    [[['iota', 3], ['lambda', 4]], 'nu', '3ι 4λ'], // half a Blink left over: the third part is zero and skipped
    [[['gamma', 3], ['delta', 0], ['epsilon', 2]], 'eta', '3γ 2ε', 0], // a zero between two counts is skipped, not written "0δ"
    [[['gamma', 3], ['delta', 0], ['epsilon', 2]], 'eta', '3γ 2ε 18ι'], // ... and the next non-zero unit takes the third place
    [[['gamma', 3], ['delta', 1]], 'epsilon', '3γ 1δ', 0], // nothing left: no zero part is written
    [[['epsilon', 2]], 'eta', '2ε', 0], // a whole number of units reads as that count alone
  ];
  for (const [parts, tail, expect, share] of cases) {
    const text = heroLeft(model, pure, t0, after(parts, tail, share));
    assert.equal(text, expect, `${parts.map(([i, n]) => n + sym(i)).join(' ')}`);
    assert.ok(text.split(' ').length <= 3, `at most three units: ${text}`);
    assert.doesNotMatch(text, / 0[^ ]+$/u, `no zero part: ${text}`);
    assert.equal(text, pure.between(t0, after(parts, tail, share), { parts: 3 }), 'the core counts it');
  }
  assert.equal(heroLeft(model, pure, A, A - 1), '0ν', 'nothing left');
  assert.equal(heroLeft(model, pure, A, model.levelAt(A, 6).end), '6ι 43λ 21ν');
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

test('pure: cycle lengths are exact at every depth: one unit, or a count of the next unit for the depths between', () => {
  const expect = ['1α', '1β', '1γ', '1δ', '1ε', '11η', '1η', '4ι', '1ι', '13λ', '1λ', '5ν', '1ν', '0.14ν'];
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
  assert.match(lengthText(model, pure, lastEta), /^\d+ι(?: \d+[λν])?$/u, 'a clipped η is shorter than 1η');
  // the core never writes a zero part, so no length does
  for (let L = 0; L < 14; L++) assert.doesNotMatch(pure.cycleLength(L), / 0\D/u, `depth ${L + 1}`);
});

test('pure: a cycle is explained by what it holds; only the minor units have unit names, the depths between none', () => {
  assert.deepEqual([...Array(14).keys()].map((L) => unitWord(pure, L)), ['', '', '', '', 'Nuclide', '', 'Helion', '', 'Preon', '', 'Flavon', '', 'Blink', '']);
  assert.deepEqual([...Array(14).keys()].map((L) => holds(model, pure, L)), ['5β', '13γ', '5δ', '5ε', '77η', '', '36ι', '', '65λ', '', '25ν', '', '', '']);
  // "one cycle holds N of the next unit" is the ladder's own ratio
  for (let i = 0; i < pure.UNITS.length - 1; i++) {
    const [u, v] = [pure.UNITS[i], pure.UNITS[i + 1]];
    assert.equal(holds(model, pure, u.level), `${Math.round(pure.unitPos(u) / pure.unitPos(v))}${v.sym}`);
  }
  const clauses = [...Array(14).keys()].map((L) => unitClause(model, pure, L));
  assert.deepEqual(clauses, [
    'an Alpha (α) is 5β',
    'a Beta (β) is 13γ',
    'a Gamma (γ) is 5δ',
    'a Delta (δ) is 5ε',
    'a Nuclide (ε) is 77η',
    'a ζ cycle is 11η, not a unit',
    'a Helion (η) is 36ι',
    'a θ cycle is 4ι, not a unit',
    'a Preon (ι) is 65λ',
    'a κ cycle is 13λ, not a unit',
    'a Flavon (λ) is 25ν',
    'a μ cycle is 5ν, not a unit',
    'a Blink (ν) is the finest unit',
    'a ξ cycle is 0.14ν, finer than a Blink',
  ]);
  assert.equal(unitSentence(model, pure, 6), 'A Helion (η) is 36ι.');
  for (const c of clauses) assert.doesNotMatch(c, /Hadron|Quark|Chromon|Somon|Atom/);
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
  for (const s of [2, 0.4, 0.001, nu, xi, xi / 4, 0.0777, 1.555, 33]) {
    for (const t of [leadBlinks(pure, s), periodBlinks(pure, s)]) assert.match(t, /^(?:<?\d+(?:\.\d{1,5})?) Blinks?$/u, t);
  }
});

test('pure: quarter thresholds are placed by two tokens of the stamp; the end reads as the next start', () => {
  const where = (L) => model.levelAt(A, L).thresholds.slice(1).map((th) => quarterWhere(model, pure, th.time, L));
  assert.deepEqual(where(6), ['34η 9ι', '34η 18ι', '34η 27ι', '35η 0ι']);
  assert.deepEqual(where(3), ['ε#2 20η', 'ε#3 39η', 'ε#4 58η', 'ε#1 1η'], 'a Delta to the Helion (numbered from 1), the basic reading');
  assert.deepEqual(where(5), ['36η 27ι', '39η 18ι', '42η 9ι', '45η 0ι'], 'a ζ is 11η');
  assert.deepEqual(where(10), ['21λ 6ν', '21λ 12ν', '21λ 18ν', '22λ 0ν'], 'a Flavon to the Blink');
  assert.deepEqual(where(1), ['β#4 γ#4', 'β#4 γ#7', 'β#4 γ#10', 'β#5 γ#1']);
  for (const t of SAMPLE.slice(0, 7)) {
    for (let L = 0; L < 12; L++) {
      const cyc = model.levelAt(t, L);
      const labels = cyc.thresholds.slice(1).map((th) => quarterWhere(model, pure, th.time, L));
      assert.equal(new Set(labels).size, 4, `depth ${L + 1} at ${t}: four different labels ${labels.join(' / ')}`);
      // two tokens of the stamp, never a depth between the units
      for (const x of labels) assert.match(x, new RegExp(`^${TOKEN} ${TOKEN}$`, 'u'), `depth ${L + 1}: ${x}`);
      // the end is the start of the next cycle (the rounding of the threshold to a millisecond never shows the old one)
      if (cyc.end < model.tMax - 1) {
        const next = counterParts(pure, cyc.end + 0.001);
        assert.ok(next.join(' ').includes(labels[3]), `depth ${L + 1}: ${labels[3]} vs ${next}`);
      }
    }
    for (let L = 12; L < 14; L++) assert.equal(quarterWhere(model, pure, model.levelAt(t, L).thresholds[2].time, L), '', 'ν and finer: the ¼ ½ ¾ column says it');
  }
  assert.equal(quarterWhere(model, pure, null, 6), '');
  assert.equal(quarterWhere(model, pure, model.tMax, 6).length > 0, true, 'the catalogue end is a valid threshold');
});

test('pure: dateAtPosition / clockAtPosition are the exact-arithmetic twins of pure.date / pure.clock', () => {
  let seed = 987654;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 3000; i++) {
    const t = Math.round((model.tMin + rnd() * (model.tMax - model.tMin - 2)) * 1000) / 1000;
    const p = exactPos(t);
    assert.deepEqual(dateAtPosition(model, pure, p.numerator, p.denominator), pure.date(t), `t = ${t}`);
    assert.deepEqual(clockAtPosition(model, p.numerator, p.denominator), pure.clock(t), `t = ${t}`);
  }
  // on a boundary the new unit has begun
  const z = model.levelAt(A, 4);
  const ps = exactPos(z.end + 0.0006);
  assert.deepEqual(dateAtPosition(model, pure, ps.numerator, ps.denominator), pure.date(z.end + 0.0006));
  assert.deepEqual(clockAtPosition(model, ps.numerator, ps.denominator), { epsilon: 1, eta: 1, iota: 0, lambda: 0, nu: 0 }, 'a Nuclide begins with its first Helion: 1η, then 0ι');
  const pa = exactPos(A);
  assert.deepEqual(clockAtPosition(model, pa.numerator, pa.denominator), { epsilon: 5, eta: 34, iota: 29, lambda: 21, nu: 3 });
  // the Helion is numbered 1..77 inside its Nuclide (the day of a month), the finer units are counts from 0
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 2000; i++) {
    const t = Math.round((model.tMin + rnd() * (model.tMax - model.tMin - 2)) * 1000) / 1000;
    const p = exactPos(t);
    const c = clockAtPosition(model, p.numerator, p.denominator);
    lo = Math.min(lo, c.eta);
    hi = Math.max(hi, c.eta);
    assert.ok(c.iota >= 0 && c.iota <= 35 && c.lambda >= 0 && c.lambda <= 64 && c.nu >= 0 && c.nu <= 24);
  }
  assert.ok(lo >= 1 && hi <= 77 && lo <= 3 && hi >= 75, `Helions ${lo}..${hi}`);
  assert.deepEqual(dateAtPosition(model, pure, pa.numerator, pa.denominator).quarter, { alpha: 'Valley', beta: 'Valley', gamma: 'Valley', delta: 'End' });
});

test('pure: an upcoming turnover is named by the cycle that begins there', () => {
  for (const imp of IMPORTANCE) {
    for (const t of [A, 946684800, 2886085800, model.tMin + 5]) {
      for (const e of buildEvents(model, t, { importance: imp, maxLevel: 9, count: 8 })) {
        const ti = turnoverInfo(model, pure, e);
        const after = e.time + 0.001;
        // majors and the Nuclide by name or ordinal, finer cycles by their count inside the Nuclide (a turnover of
        // ζ or η never starts a new Nuclide: that would make it an ε turnover)
        assert.equal(ti.name, e.top <= 4 ? pure.nameAt(after, e.top) : pure.nameAt(after, e.top, { short: true }), `event ${e.key}`);
        if (e.top >= 3) assert.equal(ti.address, pure.addressAt(after, e.top));
        else assert.ok(pure.addressAt(after, e.top).startsWith(`${ti.address} `), ti.address);
        assert.deepEqual(ti.date, pure.date(after));
        assert.deepEqual(ti.clock, pure.clock(after));
        assert.equal(ti.stamp, pure.dateText(after, { letters: true, upTo: 'eta' }), 'the short letter date');
        assert.equal(ti.heading, `${pure.periodName(3, ti.date.delta)} ε#${ti.clock.epsilon}`);
        assert.ok(positionOfKey(e.key).den > 0n);
      }
    }
  }
  // at vector A, importance ζ: a ζ turnover begins the ζ that starts at 44η
  const first = buildEvents(model, A, { importance: 'ζ', maxLevel: 9, count: 8 });
  // (ζ cycles begin at Helions 1, 12, 23, 34, 45, 56, 67 of a Nuclide)
  assert.deepEqual(first.map((e) => turnoverInfo(model, pure, e).name), ['45η', '56η', '67η', 'Delta Tetrafracton', '12η', '23η', '34η', '45η']);
  assert.equal(turnoverInfo(model, pure, first[0]).stamp, 'δ#3 ε#5 45η');
  assert.equal(turnoverInfo(model, pure, first[3]).address, 'α#6 β#4 γ#9 δ#4');
  assert.equal(turnoverInfo(model, pure, buildEvents(model, A, { importance: 'ε', maxLevel: 9, count: 2 })[1]).name, 'ε#2');
  // a turnover whose next cycle would lie past the catalogue (an exact end position) names nothing
  assert.equal(turnoverInfo(model, pure, { key: '276/1', top: 0 }).name, null);
  assert.equal(turnoverInfo(model, pure, { key: 'garbage', top: 5 }).name, null);
  // the turnovers that are left near the end all begin a cycle
  for (const e of buildEvents(model, model.tMax - 6 * 86400, { importance: 'ζ', maxLevel: 9 })) assert.ok(turnoverInfo(model, pure, e).name);
  assert.equal(positionOfKey('x'), null);
});

test('pure: the list is grouped by the Nuclide an event falls in; groups of several carry its name as a heading', () => {
  const nuclide = (t) => model.levelAt(t, 4).cycleBig;
  for (const imp of ['δ', 'ε', 'ζ', 'η']) {
    for (const t of [A, 946684800, 2886085800]) {
      const evs = buildEvents(model, t, { importance: imp, maxLevel: 9, count: 8 });
      const g = groupByNuclide(model, pure, evs.slice(1));
      assert.equal(g.length, evs.length - 1);
      for (let i = 0; i < g.length; i++) {
        const at = evs[i + 1].time + 0.001;
        if (i > 0) assert.equal(g[i].newDay, nuclide(at) !== nuclide(evs[i].time + 0.001), `${imp} row ${i}`);
        assert.equal(g[i].day, null);
        assert.equal(g[i].dayKey, String(nuclide(at)));
        assert.equal(g[i].clock, pure.dateText(at, { letters: true, upTo: 'eta' }));
        const size = g.filter((x) => x.dayKey === g[i].dayKey).length;
        const firstOfGroup = i === 0 || g[i - 1].dayKey !== g[i].dayKey;
        assert.equal(g[i].head, firstOfGroup && size > 1 ? `${pure.periodName(3, pure.date(at).delta)} ε#${pure.clock(at).epsilon}` : '', `${imp} row ${i}`);
      }
      assert.equal(g[0].newDay, false, 'the first row never carries a separator');
    }
  }
  // at vector A, importance ζ: two ζ turnovers left in ε#5, then the Delta turnover opens ε#1 with four more
  const g = groupByNuclide(model, pure, buildEvents(model, A, { importance: 'ζ', maxLevel: 9, count: 8 }).slice(1));
  assert.deepEqual(g.map((e) => e.head), ['Delta Trifracton ε#5', '', 'Delta Tetrafracton ε#1', '', '', '', '']);
  assert.deepEqual(g.map((e) => e.newDay), [false, false, true, false, false, false, false]);
  // Nuclide turnovers each open a Nuclide of their own: no headings, a separator before every row
  const e = groupByNuclide(model, pure, buildEvents(model, A, { importance: 'ε', maxLevel: 9, count: 8 }));
  assert.ok(e.every((x) => x.head === '') && e.slice(1).every((x) => x.newDay));
});

test('pure: everything the two cards can say passes the leak rules (no date, Earth unit, percent, zone, beat, retired unit or minor fracton)', () => {
  const strings = new Set();
  const add = (x) => x && strings.add(String(x));
  for (const t of SAMPLE.slice(0, 8)) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      if (!lv) continue;
      const next = nextCycle(model, pure, L, lv.cycleBig);
      const seg = segmentState(lv.phase, lv.factor);
      const sec = sectorName(pure, lv, seg.index, seg.frac);
      add(rowLabel(pure, lv));
      add(cycleTitle(pure, L, lv.cycleBig));
      add(cycleAddress(model, pure, L, lv.cycleBig));
      add(depthWords(pure, L));
      add(levelSay(pure, L));
      add(leftText(model, pure, t, lv.end));
      add(heroLeft(model, pure, t, lv.end));
      add(leftText(model, pure, lv.start, t) + ' ago');
      add(lengthText(model, pure, lv));
      add(pure.cycleLength(L));
      add(quarterWhere(model, pure, lv.end, L));
      add(endsText(next));
      add(next?.address);
      add(phaseWords(pure, lv.phase).label);
      add(`${quarterWord(pure, lv.phase)} quarter`);
      add(periodBlinks(pure, model.levelInfo(L).meanSeconds));
      add(`+${periodBlinks(pure, lv.duration / 4)}`);
      add(`${sec.name}${sec.quarter ? ` ${sec.quarter}` : ''} · ${seg.index + 1} of ${lv.factor}`);
      for (const th of lv.thresholds.slice(1)) add(quarterWhere(model, pure, th.time, L));
      add(turnoverWords(pure, L, 13));
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
        add(ti.heading);
        add(ti.stamp);
        add(heroLeft(model, pure, t, e.time));
      }
      for (const g of groupByNuclide(model, pure, evs)) add(g.head);
    }
  }
  for (const s of [2, 0.4, 0.0775, 0.011, 0.001]) add(leadBlinks(pure, s));
  add(pure.catalogueText());
  add(pure.stamp(model.tMin, 'beta'));
  add(pure.stamp(model.tMax, 'beta'));
  const hard = judge([...strings].map((text) => ({ kind: 'text', text, where: '' })), 'ladder pure').filter((l) => l.severity === 'hard');
  assert.deepEqual(hard.map((l) => `${l.rule}: ${l.text}`), []);
  assert.ok(strings.size > 300, `${strings.size} strings checked`);
  // vocabulary guards, independent of the scanner
  for (const s of strings) {
    assert.doesNotMatch(s, /½|\bbeats?\b|Hadron|Quark|Chromon|Somon|\bAtom\b/i, s);
    assert.doesNotMatch(s, /\b(?:Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi) [A-Za-z]*fracton/, s);
    assert.doesNotMatch(s, /[ζθκμ]#\d/u, `the depths between the units have no ordinals: ${s}`);
  }
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
  // revisions 2 and 3: no half units, no beats, no retired unit names, no fracton names for minor levels, anywhere
  for (const f of ['ladder.js', 'upnext.js', 'ladder/pure-text.js', 'ladder/dom.js', 'ladder/lib.js']) {
    const text = src(f);
    assert.doesNotMatch(text, /[α-ξ]½/u, `${f} still writes a half-cycle unit`);
    assert.doesNotMatch(text, /\bbeats?\b/i, `${f} still says "beat"`);
    assert.doesNotMatch(text, /Hadron|Quark|Chromon|Somon|\bAtom\b/, `${f} still names a retired unit`);
    assert.doesNotMatch(text, /\b(?:Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi) [A-Za-z]*fracton/, `${f} still gives a minor cycle a fracton name`);
    assert.doesNotMatch(text, /leadBeats|periodBeats|groupByHalf|groupByZeta|counterName|cycleWords/, `${f} still uses a retired helper`);
  }
});

// ---------------------------------------------------------------------------
// pure mode: notation, landings, shared helpers (regressions of the audit)
// ---------------------------------------------------------------------------
test('pure: notation - ordinals are X#n, counts are nX, "X d" is only a chip', () => {
  for (const t of SAMPLE.slice(0, 7)) {
    const parts = counterParts(pure, t);
    assert.equal(parts.length, 9);
    parts.slice(0, 5).forEach((p) => assert.match(p, /^[αβγδε]#\d+$/u, `${t}`));
    parts.slice(5).forEach((p) => assert.match(p, /^\d+[ηιλν]$/u, `${t}`));
    // the tokens are the core's stamp, in its order and spelling
    assert.equal(parts.join(' '), pure.stamp(t, 'nu'));
    for (let L = 0; L < 12; L++) {
      const lv = model.levelAt(t, L);
      for (const th of lv.thresholds.slice(1)) {
        const w = quarterWhere(model, pure, th.time, L);
        assert.match(w, new RegExp(`^${TOKEN} ${TOKEN}$`, 'u'), `${L}: ${w}`);
        assert.doesNotMatch(w, /(^|\s)[α-ω] \d+/u, `${L}: ${w}`);
      }
    }
  }
  // a reading of the end of a cycle is the start of the next: "35η 0ι" for an η that is not the last in its Nuclide
  const eta = model.levelAt(A, 6);
  assert.equal(quarterWhere(model, pure, eta.end, 6), '35η 0ι');
  // the last η of a Nuclide (77η) ends at the start of the next Nuclide: the numbering starts again at 1η
  const last = model.levelAt(model.levelAt(A, 4).end - 0.5, 6);
  assert.equal(pure.clock(last.start + 1).eta, 77);
  assert.match(quarterWhere(model, pure, last.end, 6), /^1η 0ι$/);
  // a placing never reads 0η (Helions are numbered from 1), while spans still count from zero
  for (let L = 5; L < 14; L++) for (const t of SAMPLE.slice(0, 7)) assert.doesNotMatch(rowLabel(pure, model.levelAt(t, L)), /(^| )0η/u);
  assert.equal(pure.durationPos(pure.unitPos(pure.UNITS.find((u) => u.id === 'iota')) * 3), '3ι');
  assert.equal(heroLeft(model, pure, A, eta.end), '6ι 43λ 21ν', 'a span inside the Helion has no Helion part at all');
  // sentences name a cycle by its word (major) or its letter, never "ζ 6"
  for (let top = 0; top <= 6; top++) for (let max = top; max <= 13; max++) assert.doesNotMatch(turnoverWords(pure, top, max), /[α-ω] \d/u, turnoverWords(pure, top, max));
});

test('pure: the hero sentence names the cycle (a major in words, a minor by its letter) and fits one line', () => {
  assert.equal(turnoverWords(pure, 5, 9), 'ζ ends — 4 finer cycles (η, θ, ι, κ) end with it.');
  assert.equal(turnoverWords(pure, 4, 8), 'ε ends — 4 finer cycles (ζ, η, θ, ι) end with it.');
  assert.equal(turnoverWords(pure, 7, 8), 'θ ends — 1 finer cycle (ι) ends with it.');
  assert.equal(turnoverWords(pure, 9, 9), 'κ ends.');
  assert.equal(turnoverWords(pure, 5, 3), 'ζ ends.');
  assert.equal(turnoverWords(pure, 3, 9), 'Delta ends, with 6 finer cycles (ε … κ).');
  assert.equal(turnoverWords(pure, 2, 13), 'Gamma ends, with 11 finer cycles (δ … ξ).');
  assert.equal(turnoverWords(pure, 2, 5), 'Gamma ends, with 3 finer cycles (δ, ε, ζ).');
  assert.equal(turnoverWords(pure, 0, 1), 'Alpha ends, with 1 finer cycle (β).');
  assert.equal(turnoverWords(pure, 3, 3), 'Delta ends.');
  // one line of the 340 px hero: letters are narrow, words are not
  for (let top = 0; top <= 13; top++) {
    for (let max = top; max <= 13; max++) {
      const s = turnoverWords(pure, top, max);
      assert.ok(s.length <= (top <= 3 ? 44 : 52), s);
    }
  }
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
