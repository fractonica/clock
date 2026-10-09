import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createFormatter } from '../src/core/format.js';
import {
  DEFAULT_IMPORTANCE,
  DEFAULT_MAX_DEPTH,
  IMPORTANCE,
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
