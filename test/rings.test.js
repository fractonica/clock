import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createFormatter } from '../src/core/format.js';
import {
  TAU,
  arcAngle,
  pointAt,
  phaseOfPoint,
  ringLayout,
  hitTest,
  sectorOf,
  funnelCurves,
  glyphExtreme,
  triangle,
  stateValue,
  stateDotted,
  quarterOf,
  phaseWord,
  waveLayout,
  timeAtPhase,
  phaseLimit,
  childCycle,
  isBlur,
  isFast,
  dialLayoutOptions,
  scrubTime,
  dialIntent,
  isHorizontalDrag,
  normLevel,
  normRange,
  stepRangeDepths,
  widenRangeTo,
  thresholdJump,
  holdSlipped,
  HOLD_MS,
} from '../src/ui/rings/geometry.js';
import { createDial } from '../src/ui/rings/dial.js';
import * as theme from '../src/core/theme.js';
import { whenParts, whenText, countdownBody, startPhrase, percentText, valueText, cycleTag, levelTag, counterText, depthRangeNote } from '../src/ui/rings/text.js';
import { createPure } from '../src/core/pure.js';
import * as PT from '../src/ui/rings/pure-text.js';
import { RULES } from '../tools/pure-scan.mjs';

const model = createModel();
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);
const T = 1791460800; // SPEC vector A, 2026-10-08T12:00:00Z

// ---------------------------------------------------------------------------------------------
test('ringLayout: concentric slots tile the annulus between hole and rim (production parameters)', () => {
  for (const size of [322, 352, 419, 420, 538, 670, 740]) {
    for (const count of [1, 2, 5, 10, 14]) {
      const opts = dialLayoutOptions(size, count);
      const lay = ringLayout(opts);
      assert.equal(lay.rings.length, count);
      assert.equal(lay.rings[0].outer, lay.rOuter, 'ring 0 is the outermost');
      near(lay.rings[count - 1].inner, lay.rHole, 1e-9, 'innermost ring touches the hole');
      for (let i = 0; i < count; i++) {
        const r = lay.rings[i];
        assert.ok(r.outer > r.mid && r.mid > r.inner && r.inner > 0);
        near(r.outer - r.inner, lay.band, 1e-9);
        if (i) near(lay.rings[i - 1].inner, r.outer, 1e-9, 'slots touch');
      }
      assert.ok(lay.thick < lay.band, 'a lane remains for the funnels');
      assert.equal(lay.cx, size / 2);
      // the hole is the larger of "holeFrac of the rim" and "what is left after maxBand per ring"
      near(lay.rHole, Math.max(lay.rOuter * opts.holeFrac, lay.rOuter - count * opts.maxBand), 1e-9, `hole ${size}/${count}`);
      assert.ok(lay.band <= opts.maxBand + 1e-9, 'rings are never fatter than maxBand');
      assert.ok(lay.rHole >= lay.rOuter * opts.holeFrac - 1e-9, 'the read-out keeps its stage');
    }
  }
  // few rings are fat but never fatter than maxBand
  assert.ok(ringLayout({ size: 700, count: 2 }).band <= 24 + 1e-9);
  // what a phone and a desktop really get with ten rings (the numbers the read-out and the hit zones are designed around)
  const phone = ringLayout(dialLayoutOptions(352, 10));
  near(phone.rOuter, 172, 1e-9);
  near(phone.band, 9.63, 0.01);
  const desk = ringLayout(dialLayoutOptions(670, 10));
  near(desk.rOuter, 329, 1e-9);
  near(desk.rHole, 171.08, 0.01);
});

test('dial angles: 12 o clock is 0, clockwise', () => {
  const cx = 100;
  const cy = 100;
  near(phaseOfPoint(cx, cy, 100, 20), 0, 1e-12);
  near(phaseOfPoint(cx, cy, 180, 100), 0.25, 1e-12);
  near(phaseOfPoint(cx, cy, 100, 180), 0.5, 1e-12);
  near(phaseOfPoint(cx, cy, 20, 100), 0.75, 1e-12);
  for (const p of [0, 0.1, 0.25, 0.333, 0.5, 0.9, 0.999]) {
    const pt = pointAt(cx, cy, 50, p);
    near(phaseOfPoint(cx, cy, pt.x, pt.y), p, 1e-9);
    near(Math.hypot(pt.x - cx, pt.y - cy), 50, 1e-9);
  }
  near(arcAngle(0), -Math.PI / 2, 1e-12);
  near(arcAngle(1) - arcAngle(0), TAU, 1e-12);
});

test('hitTest: ring by radius, sector by angle, hole and outside', () => {
  const lay = ringLayout({ size: 600, count: 5 });
  assert.equal(hitTest(lay, lay.cx, lay.cy).zone, 'hole');
  assert.equal(hitTest(lay, 0, 0), null);
  assert.equal(hitTest(lay, lay.cx, lay.cy - lay.rOuter - 20), null);
  for (let i = 0; i < 5; i++) {
    const r = lay.rings[i];
    for (const frac of [0.1, 0.5, 0.9]) {
      const p = pointAt(lay.cx, lay.cy, r.inner + frac * lay.band, 0.3);
      const h = hitTest(lay, p.x, p.y);
      assert.equal(h.ring, i);
      near(h.radial, frac, 1e-9);
      near(h.phase, 0.3, 1e-9);
    }
  }
  // factor 5: phases just right of 12 o'clock fall into sector 0, just left into sector 4
  const right = pointAt(lay.cx, lay.cy, lay.rings[0].mid, 0.001);
  const left = pointAt(lay.cx, lay.cy, lay.rings[0].mid, 0.999);
  assert.equal(sectorOf(hitTest(lay, right.x, right.y).phase, 5), 0);
  assert.equal(sectorOf(hitTest(lay, left.x, left.y).phase, 5), 4);
  assert.equal(sectorOf(1, 5), 4, 'phase 1 clamps into the last sector');
  assert.equal(sectorOf(0.2, 5), 1);
  // the hole ends exactly at rHole: a pointer 0.5 px inside is the centre read-out, 0.5 px outside is the innermost ring
  const inner = hitTest(lay, lay.cx, lay.cy - lay.rHole + 0.5);
  const outer = hitTest(lay, lay.cx, lay.cy - lay.rHole - 0.5);
  assert.equal(inner.zone, 'hole');
  assert.equal(outer.zone, 'ring');
  assert.equal(outer.ring, 4);
  // just inside the rim still counts, past the slack it does not
  assert.equal(hitTest(lay, lay.cx, lay.cy - lay.rOuter - 0.5).ring, 0);
  assert.equal(hitTest(lay, lay.cx, lay.cy - lay.rOuter - 2), null);
});

test('sectorOf: floor, not round, with exact boundaries between sectors', () => {
  for (const f of [4, 5, 7, 9, 11, 13]) {
    assert.equal(sectorOf(0, f), 0);
    for (let k = 0; k < f; k++) {
      assert.equal(sectorOf((k + 0.5) / f, f), k, `middle of sector ${k}/${f}`);
      assert.equal(sectorOf((k + 0.999) / f, f), k, `end of sector ${k}/${f} stays in it`);
      assert.equal(sectorOf((k + 0.001) / f, f), k, `start of sector ${k}/${f}`);
      if (k) assert.equal(sectorOf((k - 0.001) / f, f), k - 1, `just before sector ${k}/${f}`);
    }
  }
  assert.equal(sectorOf(0.3, 5), 1, 'phase 0.3 of 5 sectors is in the second one (round would say the third)');
});

test('funnelCurves: the sector opens up smoothly into the full circle', () => {
  const { left, right } = funnelCurves(100, 90, 0.4, 0.6, 20);
  assert.equal(left.length, 21);
  assert.deepEqual([left[0].r, left[0].phase], [100, 0.4]);
  assert.deepEqual([right[0].r, right[0].phase], [100, 0.6]);
  near(left.at(-1).r, 90, 1e-12);
  assert.equal(left.at(-1).phase, 0);
  assert.equal(right.at(-1).phase, 1);
  for (let k = 1; k < left.length; k++) {
    assert.ok(left[k].r < left[k - 1].r);
    assert.ok(left[k].phase <= left[k - 1].phase + 1e-12, 'left edge only moves towards 0');
    assert.ok(right[k].phase >= right[k - 1].phase - 1e-12, 'right edge only moves towards 1');
    assert.ok(left[k].phase >= 0 && right[k].phase <= 1);
  }
  // eased, not linear: a quarter of the way down the edges have moved less than a quarter of their way
  const q = funnelCurves(100, 90, 0.4, 0.6, 20);
  near(q.left[5].phase, 0.4 * (1 - (0.25 * 0.25 * (3 - 2 * 0.25))), 1e-12);
  assert.ok(q.left[5].phase > 0.4 * 0.75, 'smoothstep lags behind the linear interpolation at the start');
  // the first / last sector keep one edge fixed
  const first = funnelCurves(100, 90, 0, 0.2, 8);
  assert.ok(first.left.every((q) => q.phase === 0));
  const last = funnelCurves(100, 90, 0.8, 1, 8);
  assert.ok(last.right.every((q) => q.phase === 1));
});

// ---------------------------------------------------------------------------------------------
test('waveform maths agrees with the glyph the model reports (SPEC §4.1)', () => {
  assert.equal(glyphExtreme(2), 4);
  assert.equal(glyphExtreme(3), 13);
  assert.deepEqual([0, 0.25, 0.5, 0.75, 1].map(triangle), [0, 1, 0, -1, 0]);
  near(triangle(0.125), 0.5, 1e-12);
  near(triangle(0.625), -0.5, 1e-12);
  const sixteen = Array.from({ length: 16 }, (_, k) => stateValue(k, 4));
  assert.deepEqual(sixteen, [0, 1, 2, 3, 4, 3, 2, 1, 0, -1, -2, -3, -4, -3, -2, -1]);
  assert.deepEqual(
    Array.from({ length: 16 }, (_, k) => stateDotted(k, 4)),
    [false, false, false, false, false, true, true, true, true, true, true, true, false, false, false, false],
  );
  for (const t of [T, T + 777.7, 946684800.25, 2886085800]) {
    for (const L of [0, 2, 4, 6, 8, 10, 12]) {
      const lv = model.levelAt(t, L);
      assert.equal(stateValue(lv.index, 4), lv.value, `value L${L}@${t}`);
      assert.equal(stateDotted(lv.index, 4), lv.dotted, `dot L${L}@${t}`);
      assert.ok(Math.abs(triangle(lv.phase) * 4 - lv.value) <= 1 + 1e-9, 'continuous wave is within one state of the glyph');
      assert.equal(quarterOf(lv.phase), lv.quarter);
    }
  }
});

test('phaseWord: rising / peak / falling / valley', () => {
  assert.equal(phaseWord(0, 1).word, 'Rising');
  assert.equal(phaseWord(3, 1).word, 'Rising');
  assert.equal(phaseWord(4, 0).word, 'Peak');
  assert.equal(phaseWord(5, -1).word, 'Falling');
  assert.equal(phaseWord(8, -1).word, 'Falling');
  assert.equal(phaseWord(12, 0).word, 'Valley');
  assert.equal(phaseWord(13, 1).word, 'Rising');
  // vector A: depth 7 is index 13 (value -3, rising); depth 8 index 5 (value 3, falling) – SPEC §12
  const f = model.frame(T);
  assert.equal(phaseWord(f.level(6).index, f.level(6).derivative).word, 'Rising');
  assert.equal(phaseWord(f.level(7).index, f.level(7).derivative).word, 'Falling');
});

test('waveLayout maps phase <-> x and value <-> y', () => {
  const w = waveLayout(400, 220);
  near(w.xOf(0), w.x0, 1e-12);
  near(w.xOf(1), w.x1, 1e-12);
  for (const p of [0, 0.125, 0.5, 0.97, 1]) near(w.phaseOf(w.xOf(p)), p, 1e-12);
  assert.equal(w.phaseOf(-50), 0);
  assert.equal(w.phaseOf(9999), 1);
  assert.ok(w.yOf(1) < w.yOf(0) && w.yOf(0) < w.yOf(-1), 'peak is drawn above the valley');
  near(w.yOf(0), w.yMid, 1e-12);
  assert.ok(w.yOf(1) >= w.y0 && w.yOf(-1) <= w.y1);
});

// ---------------------------------------------------------------------------------------------
test('timeAtPhase: round trip through the model, across uneven Saros intervals', () => {
  for (const L of [0, 1, 2, 4, 6, 8, 9]) {
    const lv = model.levelAt(T, L);
    for (const x of [0.0001, 0.1, 0.25, 0.4999, 0.77, 0.9]) {
      const t = timeAtPhase(model, L, lv.cycle, x);
      assert.ok(t !== null);
      const back = model.levelAt(t + 0.0005, L);
      assert.equal(back.cycle, lv.cycle, `L${L} x${x} stays inside the cycle`);
      // the model rounds queries to 1 ms: allow that much of the cycle
      near(back.phase, x, 0.002 / lv.duration + 1e-9, `L${L} x${x}`);
    }
    near(timeAtPhase(model, L, lv.cycle, 0), lv.start, 1e-3, `L${L} start`);
    near(timeAtPhase(model, L, lv.cycle, 1), lv.end, 1e-3, `L${L} end`);
  }
  // alpha cycle 5 spans four Saros intervals of different length: the half-way point is the node event
  const a = model.levelAt(T, 0);
  near(timeAtPhase(model, 0, a.cycle, 0.5), a.thresholds[2].time, 1e-3);
});

test('phaseLimit: complete cycles reach 1, the last clipped cycle stops at the catalogue end', () => {
  const total = (L) => (model.extent * model.levelInfo(L).prefixNum) / 4;
  for (const L of [0, 3, 5, 9, 13]) {
    assert.equal(phaseLimit(model, L, 0), 1);
    const lastCycle = Math.ceil(total(L)) - 1;
    const lv = model.levelAt(model.tMax - 1e-3, L);
    assert.equal(lv.cycle, lastCycle, `last cycle of L${L}`);
    const lim = phaseLimit(model, L, lastCycle);
    if (Number.isInteger(total(L))) continue;
    assert.ok(lim > 0 && lim < 1);
    assert.ok(lv.clipped);
    near(lv.phase, lim, 1e-6 + 2e-3 / Math.max(lv.duration, 1e-3), `L${L} phase at the last instant`);
  }
  assert.equal(phaseLimit(model, 0, 17), 0.25, 'alpha 18 has one Saros of four');
  assert.equal(model.levelAt(model.tMax - 5, 0).clipped, true);
});

test('childCycle: the factor children tile the parent', () => {
  for (const L of [0, 3, 5, 8]) {
    const lv = model.levelAt(T, L);
    const kids = Array.from({ length: lv.factor }, (_, j) => childCycle(model, L, lv.cycle, j));
    assert.ok(kids.every(Boolean));
    near(kids[0].start, lv.start, 1e-3);
    near(kids.at(-1).end, lv.end, 1e-3);
    for (let j = 0; j < kids.length; j++) {
      assert.equal(kids[j].level, L + 1);
      assert.equal(kids[j].index, lv.cycle * lv.factor + j);
      assert.ok(kids[j].duration > 0 && !kids[j].clipped);
      if (j) near(kids[j].start, kids[j - 1].end, 1e-6);
      const facts = model.cycleByIndex(L + 1, kids[j].index);
      near(facts.start, kids[j].start, 1e-3);
      near(facts.end, kids[j].end, 1e-3);
    }
    // the running child is the one the next level reports as current
    const next = model.levelAt(T, L + 1);
    const running = Math.floor(lv.phase * lv.factor);
    assert.equal(kids[running].index, next.cycle);
    assert.ok(T >= kids[running].start && T < kids[running].end);
  }
  assert.equal(childCycle(model, 0, 5, 5), null, 'no such child');
  assert.equal(childCycle(model, 0, 5, -1), null);
  assert.equal(childCycle(model, 13, 1000, 0), null, 'nothing deeper than the dial shows');
  // last (clipped) alpha cycle: only its first quarter exists, later children lie outside the catalogue
  const first = childCycle(model, 0, 17, 0);
  const late = childCycle(model, 0, 17, 4);
  assert.ok(first && first.start < model.tMax);
  assert.equal(late, null);
});

test('isBlur / isFast follow the period of the ring', () => {
  const blur = Array.from({ length: 14 }, (_, L) => isBlur(model.levelInfo(L))).map(Number).join('');
  const fast = Array.from({ length: 14 }, (_, L) => isFast(model.levelInfo(L))).map(Number).join('');
  assert.equal(blur, '00000000000011'); // nu 0.31 s and xi 44 ms
  assert.equal(fast, '00000000000111'); // mu 1.55 s joins them under reduced motion
});

test('isBlur / isFast thresholds: 0.5 s and 2 s of real time per turn, strictly below', () => {
  assert.equal(isBlur({ meanSeconds: 0.5 }, 1), false);
  assert.equal(isBlur({ meanSeconds: 0.4999 }, 1), true);
  assert.equal(isBlur({ meanSeconds: 0.5 }, 1.0001), true);
  assert.equal(isFast({ meanSeconds: 2 }, 1), false);
  assert.equal(isFast({ meanSeconds: 1.9999 }, 1), true);
  assert.equal(isFast({ meanSeconds: 1.6 }, 1), true, 'mu (1.55 s) is frozen under reduced motion');
  assert.equal(isBlur({ meanSeconds: 1.6 }, 1), false, 'but not blurred');
  // slow motion: a ring that is 6 s per turn at x0.05 is not a glow
  assert.equal(isBlur(model.levelInfo(12), 0.05), false);
  assert.equal(isBlur(model.levelInfo(12), 1), true);
});

test('isBlur / isFast take the time-lapse speed into account; a paused clock blurs nothing', () => {
  const eta = model.levelInfo(6); // 5 h
  const theta = model.levelInfo(7); // 34 min
  const iota = model.levelInfo(8); // 8.4 min
  const xi = model.levelInfo(13);
  assert.equal(isBlur(eta, 3600), false); // 5 s per turn
  assert.equal(isBlur(theta, 3600), false); // 0.56 s per turn
  assert.equal(isBlur(iota, 3600), true); // 0.14 s per turn
  assert.equal(isFast(theta, 3600), true);
  assert.equal(isFast(eta, 3600), false);
  assert.equal(isBlur(xi, 0), false, 'paused: the 44 ms ring is perfectly still');
  assert.equal(isFast(xi, 0), false);
  assert.equal(isBlur(xi, 1), true);
});

// ---------------------------------------------------------------------------------------------
test('text helpers: precision follows the cycle length, zone is respected', () => {
  const utc = createFormatter(() => 'UTC');
  const kyiv = createFormatter(() => 'Europe/Kyiv');
  const year = 31557600;
  assert.deepEqual(whenParts(utc, T, 14 * year), { date: 'Thu 8 Oct 2026', time: '' });
  assert.deepEqual(whenParts(utc, T, 81 * 86400), { date: 'Thu 8 Oct 2026', time: '12:00' });
  assert.deepEqual(whenParts(utc, T, 5 * 3600), { date: 'Thu 8 Oct 2026', time: '12:00:00' });
  assert.deepEqual(whenParts(utc, T + 0.25, 1.5), { date: 'Thu 8 Oct 2026', time: '12:00:00.250' });
  assert.deepEqual(whenParts(utc, T, 5 * 3600, { compact: true, refYear: 2026 }), { date: '8 Oct', time: '12:00:00' });
  assert.deepEqual(whenParts(utc, T, 5 * 3600, { compact: true, refYear: 2031 }), { date: '8 Oct 2026', time: '12:00:00' });
  assert.equal(whenParts(utc, T, 5 * year, { compact: true, refYear: 2026 }).date, '8 Oct 2026', 'year-long cycles always show the year');
  assert.equal(whenText(kyiv, T, 3600), 'Thu 8 Oct 2026, 15:00:00');
  assert.equal(whenText(utc, T, 20 * year), 'Thu 8 Oct 2026');
  // the zone can change the day
  assert.equal(whenParts(createFormatter(() => 'Pacific/Auckland'), T, 86400 * 3).date, 'Fri 9 Oct 2026');

  // precision boundaries: a day or more shows minutes, 10 s or more seconds, below that milliseconds; 0.9 year shows the date only
  assert.equal(whenParts(utc, T, 86400).time, '12:00');
  assert.equal(whenParts(utc, T, 86399.9).time, '12:00:00');
  assert.equal(whenParts(utc, T, 10).time, '12:00:00');
  assert.equal(whenParts(utc, T + 0.5, 9.99).time, '12:00:00.500');
  assert.equal(whenParts(utc, T, year * 0.9).time, '');
  assert.equal(whenParts(utc, T, year * 0.9 - 1).time, '12:00');

  assert.equal(countdownBody(utc, 3 * 86400 + 4 * 3600), '3 d 04 h');
  assert.equal(countdownBody(utc, 56 * 60 + 12), '56 min 12 s');
  assert.equal(countdownBody(utc, -90), '1 min 30 s');
  assert.equal(countdownBody(utc, 7.25), '7.2 s', 'countdowns floor to a tenth below 10 s (the rule every panel shares)');
  assert.equal(startPhrase(utc, T + 600, T + 1200, T), 'starts in 10 min 00 s');
  assert.equal(startPhrase(utc, T - 3700, T - 100, T), 'started 1 h 01 min ago');
  assert.equal(startPhrase(utc, T - 10, T + 10, T), 'running now');
  assert.equal(percentText(0.4721), '47.2 %');
  // a cycle never reads 100.0 % before it has ended; exact tenths are not floored a tenth too low
  assert.equal(percentText(0.999998), '99.9 %');
  assert.equal(percentText(0.9995), '99.9 %');
  assert.equal(percentText(0.4726), '47.2 %', 'floored, not rounded');
  assert.equal(percentText(0), '0.0 %');
  for (const [p, txt] of [[0.29, '29.0'], [0.57, '57.0'], [0.58, '58.0'], [0.1, '10.0'], [0.7, '70.0'], [0.123, '12.3']]) assert.equal(percentText(p), `${txt} %`);
  assert.deepEqual([valueText(3), valueText(0), valueText(-4)], ['+3', '0', '−4']);
});

test('labels: letter, depth and counter', () => {
  const f = model.frame(T);
  assert.equal(levelTag(model.levelInfo(4)), 'ε 5');
  assert.equal(cycleTag(model.levelInfo(6), f.level(6)), 'η 7 · 1/11'); // local 0 of 11 siblings (SPEC §12 vector A)
  assert.equal(counterText(f.level(0)), '6/18'); // Alpha 6 of 18
  assert.equal(counterText(f.level(7)), '8/9'); // vector A: local 7 of 9
});

// ---------------------------------------------------------------------------------------------
test('childCycle: no phantom child at the catalogue end (it would be a zero-length "jump" to a cycle that does not exist)', () => {
  // the last theta cycle is clipped by the catalogue: its second iota child would start exactly at tMax
  const last = model.levelAt(model.tMax - 5, 7);
  assert.equal(last.clipped, true);
  const kids = Array.from({ length: last.factor }, (_, j) => childCycle(model, 7, last.cycle, j));
  assert.ok(kids[0] && kids[0].duration > 0, 'the first child exists and has a length');
  assert.equal(kids[1], null, 'a child starting at tMax does not exist');
  assert.equal(kids[2], null);
  assert.equal(model.cycleStartTime(8, last.cycle * last.factor + 1), model.tMax, 'the model does report tMax as its start');
  // every child that is reported, on every level, at the very end, has a positive length and starts inside
  for (let L = 0; L < 13; L++) {
    const lv = model.levelAt(model.tMax - 0.001, L);
    for (let j = 0; j < lv.factor; j++) {
      const c = childCycle(model, L, lv.cycle, j);
      if (!c) continue;
      assert.ok(c.start < model.tMax && c.duration > 0 && c.end <= model.tMax, `L${L} child ${j}`);
    }
  }
});

test('scrubTime: always lands inside the requested cycle, on the state asked for (including the last one of short cycles)', () => {
  const states = 16;
  for (const t0 of [T, 946684800.5, 2886085800, model.tMin + 5, model.tMax - 5]) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t0, L);
      const limit = phaseLimit(model, L, lv.cycle);
      // End / ArrowRight on the last state, Home / ArrowLeft on the first, and every state in between
      const end = scrubTime(model, L, lv.cycle, 1, { snap: true });
      const e = model.levelAt(end, L);
      assert.equal(e.cycle, lv.cycle, `L${L}@${t0}: End stays in the cycle`);
      if (limit === 1) assert.equal(e.index, states - 1, `L${L}@${t0}: End is the last state`);
      assert.ok(e.phase <= limit + 1e-9);
      const again = scrubTime(model, L, lv.cycle, (e.index + 1) / states, { snap: true });
      assert.equal(model.levelAt(again, L).cycle, lv.cycle, `L${L}@${t0}: ArrowRight on the last state stays put`);
      assert.equal(model.levelAt(again, L).index, e.index);
      const home = model.levelAt(scrubTime(model, L, lv.cycle, 0, { snap: true }), L);
      assert.equal(home.cycle, lv.cycle);
      assert.equal(home.index, 0);
      assert.equal(model.levelAt(scrubTime(model, L, lv.cycle, -1 / states, { snap: true }), L).cycle, lv.cycle, 'ArrowLeft on the first state stays put');
      if (limit < 1) continue; // clipped cycles do not reach every state
      for (let k = 0; k < states; k++) {
        const r = model.levelAt(scrubTime(model, L, lv.cycle, k / states, { snap: true }), L);
        assert.equal(r.cycle, lv.cycle, `L${L} state ${k}`);
        assert.equal(r.index, k, `L${L}@${t0} state ${k}`);
      }
      // a pointer drag to the right edge of the plot never leaves the cycle either (no snap)
      assert.equal(model.levelAt(scrubTime(model, L, lv.cycle, 1), L).cycle, lv.cycle, `L${L}@${t0}: drag to the edge`);
    }
  }
  assert.equal(scrubTime(model, 0, 1e6, 0.5), null, 'beyond the catalogue there is nowhere to scrub to');
});

test('dialIntent: what a click or a tap on the dial does', () => {
  const base = { label: false, hasChild: true, running: false, ringSelected: false, touch: false, previewed: false };
  assert.equal(dialIntent({ ...base }), 'select+goto', 'another sector of an unselected ring: select and jump');
  assert.equal(dialIntent({ ...base, ringSelected: true }), 'goto');
  assert.equal(dialIntent({ ...base, running: true }), 'select', 'where we are is only selected on the first click');
  assert.equal(dialIntent({ ...base, running: true, ringSelected: true }), 'goto', 'the selected ring rewinds to the start of the running child');
  assert.equal(dialIntent({ ...base, label: true }), 'select');
  assert.equal(dialIntent({ ...base, hasChild: false, ringSelected: true }), 'select', 'a sector that leads nowhere');
  // touch: the first tap only previews (and selects), the second tap on the same sector acts
  assert.equal(dialIntent({ ...base, touch: true }), 'preview');
  assert.equal(dialIntent({ ...base, touch: true, ringSelected: true }), 'preview');
  assert.equal(dialIntent({ ...base, touch: true, previewed: true, ringSelected: true }), 'goto');
  assert.equal(dialIntent({ ...base, touch: true, label: true }), 'select', 'a label is a plain select target on touch too');
  // a page scroll that starts on the wave must not scrub: only a clearly sideways drag does
  assert.equal(isHorizontalDrag(2, 40), false);
  assert.equal(isHorizontalDrag(6, 0), false, 'within the slop');
  assert.equal(isHorizontalDrag(7, 3), true);
  assert.equal(isHorizontalDrag(-12, 10), true);
  assert.equal(isHorizontalDrag(12, 12), false, 'diagonal: leave it to the browser');
});

test('depth range: garbage and inverted settings are normalised, the steppers start from what the dial shows', () => {
  assert.deepEqual(normRange(1, 10), { minL: 0, maxL: 9 });
  assert.deepEqual(normRange(9, 3), { minL: 8, maxL: 8 }, 'inverted: the dial shows a single ring');
  assert.deepEqual(normRange('x', null), { minL: 0, maxL: 9 }, 'garbage falls back to the defaults');
  assert.deepEqual(normRange(undefined, undefined), { minL: 0, maxL: 9 });
  assert.deepEqual(normRange(-5, 99), { minL: 0, maxL: 13 });
  assert.deepEqual(normRange(2.4, 5.6), { minL: 1, maxL: 5 });
  // stepping: never NaN, never outside 1..14, min <= max
  assert.deepEqual(stepRangeDepths({ minL: 8, maxL: 8 }, 'min', -1), { minDepth: 8, maxDepth: 9 });
  assert.deepEqual(stepRangeDepths({ minL: 0, maxL: 9 }, 'min', -1), { minDepth: 1, maxDepth: 10 });
  assert.deepEqual(stepRangeDepths({ minL: 0, maxL: 9 }, 'max', 1), { minDepth: 1, maxDepth: 11 });
  assert.deepEqual(stepRangeDepths({ minL: 0, maxL: 13 }, 'max', 1), { minDepth: 1, maxDepth: 14 });
  assert.deepEqual(stepRangeDepths({ minL: 3, maxL: 3 }, 'min', 1), { minDepth: 4, maxDepth: 4 });
  assert.deepEqual(stepRangeDepths({ minL: 3, maxL: 3 }, 'max', -1), { minDepth: 4, maxDepth: 4 }, 'the range never inverts');
  assert.deepEqual(stepRangeDepths({ minL: 3, maxL: 3 }, 'min', -1), { minDepth: 3, maxDepth: 4 });
  assert.deepEqual(stepRangeDepths(normRange('x', null), 'max', 1), { minDepth: 1, maxDepth: 11 });
  for (const garbage of [[NaN, NaN], [null, undefined], ['abc', {}], [-3, 40]]) {
    const next = stepRangeDepths(normRange(...garbage), 'max', 1);
    assert.ok(Number.isInteger(next.minDepth) && Number.isInteger(next.maxDepth) && next.minDepth >= 1 && next.maxDepth <= 14 && next.minDepth <= next.maxDepth);
  }
  // showing a selection that is off the dial
  assert.deepEqual(widenRangeTo({ minL: 0, maxL: 4 }, 6), { minDepth: 1, maxDepth: 7 });
  assert.deepEqual(widenRangeTo({ minL: 4, maxL: 6 }, 1), { minDepth: 2, maxDepth: 7 });
  assert.deepEqual(widenRangeTo({ minL: 2, maxL: 6 }, 4), { minDepth: 3, maxDepth: 7 }, 'already inside: unchanged');
});

test('normLevel: any stored or linked selection becomes a level the model accepts', () => {
  for (const [raw, want] of [[6, 6], [2.5, 3], [3.4, 3], [null, 0], [undefined, 0], ['abc', 0], [-3, 0], [99, 13], ['7', 7], [NaN, 0], [Infinity, 13]]) {
    assert.equal(normLevel(raw), want, String(raw));
    assert.doesNotThrow(() => model.levelInfo(normLevel(raw)));
  }
});

// ---------------------------------------------------------------------------------------------
// The dial renderer with a recording stand-in for the 2D contexts: hit-testing and the reduced-motion freeze.
function fakeCanvas() {
  const calls = [];
  const g = new Proxy(
    {},
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return (text) => ({ width: String(text).length * 6 });
        if (typeof k === 'string' && k.startsWith('create')) return () => ({ addColorStop() {} });
        return (...a) => calls.push([k, ...a]);
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    },
  );
  return { width: 0, height: 0, style: {}, getContext: () => g, calls };
}
function dialAt(size = 640) {
  const [live, base, over] = [fakeCanvas(), fakeCanvas(), fakeCanvas()];
  const d = createDial(live, theme, { base, over });
  d.resize(size, 1);
  d.ensureLayout(10);
  return d;
}
function dialState(t, { selected = 6, speed = 1, reduced = false, epoch = 0, levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], show = { sectors: true, quarters: true, funnels: true } } = {}) {
  const f = model.frame(t);
  const infos = levels.map((L) => model.levelInfo(L));
  const blur = infos.map((i) => isBlur(i, speed));
  return { levels, infos, readings: levels.map((L) => f.level(L)), inRange: true, selected, show, hover: null, reduced, speed, blur, epoch, nowMs: 0 };
}
/** Client point of (ring, phase, radial) on the dial. */
const at = (d, ring, phase, radial = 0.5) => {
  const lay = d.layout;
  const r = lay.rings[ring].inner + radial * lay.band;
  return pointAt(lay.cx, lay.cy, r, phase);
};

test('dial.pick: a ring label selects only a ring that is not selected yet, and only at the height of its text', () => {
  const d = dialAt(640);
  d.draw(dialState(T, { selected: 6 }));
  assert.ok(d.layout.band >= 11, 'labels on every ring at this size');
  // eta (ring 6) is selected: its label area is plain sector area. kappa (ring 9) is not: the label is a target
  const labelPhase = 0.985; // just left of 12 o'clock, inside the text of every ring
  for (const ring of [0, 4, 9]) {
    const p = at(d, ring, labelPhase);
    const h = d.pick(p.x, p.y);
    assert.equal(h.ring, ring);
    assert.equal(h.label, true, `ring ${ring} label hit`);
  }
  const sel = at(d, 6, labelPhase);
  assert.equal(d.pick(sel.x, sel.y).label, undefined, 'the selected ring has no label target: every sector is reachable');
  // the outer and inner edge of the band are outside the text: they keep pointing at the sector
  for (const radial of [0.02, 0.98]) {
    const p = at(d, 9, labelPhase, radial);
    assert.equal(d.pick(p.x, p.y).label, undefined, `radial ${radial}`);
  }
  // away from 12 o'clock there is no label either
  const far = at(d, 9, 0.6);
  assert.equal(d.pick(far.x, far.y).label, undefined);
  assert.equal(d.pick(d.layout.cx, d.layout.cy).zone, 'hole');
});

test('dial: under reduced motion a fast hand keeps its phase until the time jumps (no 1 Hz hopping)', () => {
  const d = dialAt(640);
  const mu = 11; // 1.55 s per turn
  const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const run = (t, epoch, nowMs, reduced = true) => {
    const s = dialState(t, { levels, reduced, epoch });
    s.nowMs = nowMs;
    d.draw(s);
    return d.shown[mu];
  };
  const a = run(T, 1, 0);
  assert.ok(a > 0);
  const b = run(T + 0.5, 1, 600); // half a second later
  const c = run(T + 3.1, 1, 3500); // seconds later: the old behaviour re-sampled once per second
  assert.equal(b, a);
  assert.equal(c, a, 'still frozen');
  const j = run(T + 3.1, 2, 3600); // a jump of the displayed time is a new epoch
  assert.notEqual(j, a);
  assert.ok(Math.abs(j - model.levelAt(T + 3.1, mu).phase) < 1e-9, 'a jump freezes the new phase');
  // slower rings (kappa, 1.7 min) are not frozen
  const k = d.shown[9];
  const k2 = (() => {
    const s = dialState(T + 30, { levels, reduced: true, epoch: 2 });
    d.draw(s);
    return d.shown[9];
  })();
  assert.notEqual(k, k2);
  // without reduced motion the hand follows
  const free1 = run(T + 10, 2, 5000, false);
  const free2 = run(T + 10.4, 2, 5400, false);
  assert.notEqual(free1, free2);
});

// ---------------------------------------------------------------------------------------------
test('thresholdJump: a passed quarter chip goes BACK to that threshold of the cycle on show (+1 ms), an upcoming one forward', () => {
  // SPEC vector A, level 6 (eta 7): 12:00:00 is in the last quarter (valley passed), the cycle ends at 12:56:12
  const L = 6;
  const lv = model.levelAt(T, L);
  assert.equal(lv.quarter, 3);
  const thr = lv.thresholds; // begin, peak, node, valley, end
  assert.equal(thr.length, 5);
  for (let k = 0; k < 4; k++) {
    const q = thr[k + 1].time;
    const j = thresholdJump(model, q, T);
    assert.ok(j.time !== null, `chip ${k} has a target`);
    near(j.time, q + 0.001, 1e-9, `chip ${k}: 1 ms past the threshold`);
    assert.equal(j.kind, k < 3 ? 'back' : 'ahead', `chip ${k}: ${k < 3 ? 'passed: back' : 'next: forward'}`);
    // the target lands inside the SAME cycle, in the quarter that starts at that threshold (the end chip: the next cycle)
    const at = model.levelAt(j.time, L);
    if (k < 3) {
      assert.equal(at.cycle, lv.cycle, `chip ${k} stays in the current cycle`);
      assert.equal(at.quarter, k + 1, `chip ${k} shows the quarter that starts there`);
    } else {
      assert.equal(at.cycle, lv.cycle + 1);
      assert.equal(at.quarter, 0);
    }
  }
  // every level, at several instants: the target is always the threshold + 1 ms, whichever side of "now" it lies on
  for (const t of [T, 946684800, 2886085800, model.tMin + 5, model.tMax - 5]) {
    for (let level = 0; level <= 13; level += 3) {
      const cur = model.levelAt(t, level);
      if (!cur) continue;
      for (const e of cur.thresholds.slice(1)) {
        const j = thresholdJump(model, e.time, t);
        if (e.time === null) assert.equal(j.kind, 'void');
        else if (j.time !== null) near(j.time, Math.min(e.time + 0.001, model.tMax), 1e-9, `L${level} ${e.name}`);
      }
    }
  }
});

test('thresholdJump: only a threshold that does not exist, or the catalogue closing instant, is a dead end', () => {
  assert.deepEqual(thresholdJump(model, null, T), { kind: 'void', time: null });
  assert.deepEqual(thresholdJump(model, undefined, T), { kind: 'void', time: null });
  assert.deepEqual(thresholdJump(model, NaN, T), { kind: 'void', time: null });
  // already standing exactly on the spot the chip leads to: nothing to do, and no claim that the catalogue ended
  const t0 = 1791450530.7206154;
  assert.deepEqual(thresholdJump(model, t0, t0 + 0.001), { kind: 'here', time: null });
  // a threshold within 1 ms of the closing instant clamps to it; once there, that is the end of the catalogue
  assert.deepEqual(thresholdJump(model, model.tMax - 0.0004, model.tMax), { kind: 'end', time: null });
  const clamped = thresholdJump(model, model.tMax - 0.0004, model.tMax - 1);
  assert.equal(clamped.kind, 'ahead');
  assert.equal(clamped.time, model.tMax);
  // an earlier moment of the same last cycle is an ordinary jump back (not "End of the catalogue")
  const last = model.levelAt(model.tMax - 5, 6);
  const back = thresholdJump(model, last.thresholds[1].time, model.tMax - 5);
  assert.equal(back.kind, last.thresholds[1].time + 0.001 < model.tMax - 5 ? 'back' : 'ahead');
  assert.ok(back.time !== null);
});

test('tap and hold: a held touch that slides becomes a scroll, not a hold', () => {
  assert.ok(HOLD_MS >= 300 && HOLD_MS <= 700, 'long enough not to fire on a tap, short enough to feel immediate');
  assert.equal(holdSlipped(0, 0), false);
  assert.equal(holdSlipped(6, 6), false);
  assert.equal(holdSlipped(11, 0), true);
  assert.equal(holdSlipped(-3, 12), true);
  assert.equal(holdSlipped(5, 0, 4), true);
});

test('glyph state numbers are the SPEC index (0-based), as on the face and in the jump box', () => {
  // SPEC vector A: depth 7 reads index 13 (value -3); the rings card prints that same 13, never 14
  const lv = model.levelAt(T, 6);
  assert.equal(lv.index, 13);
  assert.equal(lv.value, -3);
  const M = glyphExtreme(2);
  assert.equal(4 * M, 16);
  assert.ok(lv.index >= 0 && lv.index <= 4 * M - 1, 'index runs 0..15');
});

test('help text: the depth sentence is true for the opening range and for the deepest ring', () => {
  const utc = createFormatter(() => 'UTC');
  const opening = model.levelInfo(9); // depth 10, where the dial opens
  const finest = model.levelInfo(13);
  const note = depthRangeNote(utc, opening, finest);
  assert.match(note, /κ 10/);
  assert.match(note, /1 min 41 s/, 'the opening ring turns in under two minutes, not in a fraction of a second');
  assert.match(note, /ξ 14/);
  assert.match(note, /44 ms/, 'only the deepest ring is that fast');
  assert.ok(opening.meanSeconds > 60 && opening.meanSeconds < 120);
  assert.ok(finest.meanSeconds > 0.04 && finest.meanSeconds < 0.05);
  assert.doesNotMatch(note, /fraction of a second/);
});

test('percentText: the "through this cycle" figure is floored and never reads 100.0 % while the cycle runs', () => {
  // the live end of a cycle: model phase just below 1
  const lv = model.levelAt(model.frame(T).level(6).end - 0.001, 6);
  assert.ok(lv.phase < 1);
  assert.notEqual(percentText(lv.phase), '100.0\u202f%');
  assert.equal(percentText(0.66049), '66.0\u202f%');
  assert.equal(percentText(0.6609), '66.0\u202f%');
});

// ---------------------------------------------------------------------------------------------
// Pure mode (docs/design/80-pure.md, SPEC §15, revision 3): the same view in Fractonica terms only. Major rings (α β γ δ)
// in words with their quarter, minor rings by where they start in their Nuclide, with their phase pair.
// ---------------------------------------------------------------------------------------------
const pure = createPure(model, { now: () => T });
const hardRules = RULES.filter(([, , severity]) => severity === 'hard');
const earthly = (text) => hardRules.filter(([, re]) => re.test(text)).map(([id]) => id);
const INSTANTS = [T, 946684800, 2886085800, model.tMin + 5, model.tMax - 5, model.tMax - 3e8, 125593320.816];
const HALF = '½';
const RETIRED = /\b(Hadron|Quark|Chromon|Somon|Atom)s?\b|\b(Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi)\s+\w*fracton\b/;

test('pure: resolution follows the length of the cycle it labels (a quarter is the step), on the digits ε# η ι λ ν', () => {
  const index = (level, divisor) => PT.resolutionIndex(pure, PT.cycleSpanPos(model, level), divisor);
  const unit = (level, divisor) => PT.coordSym(pure, index(level, divisor));
  assert.equal(unit(0, 4), 'β', 'an α cycle (4 Saros) has quarters of 1 Saros, a bit more than a β');
  assert.equal(unit(3, 4), 'ε', 'a δ cycle (5 ε) has quarters of 1.25 ε');
  assert.equal(unit(4, 4), 'η', 'an ε cycle (77 η) has quarters of 19.25 η');
  assert.equal(unit(5, 4), 'η', 'a ζ cycle (11 η) has quarters of 2.75 η');
  assert.equal(unit(6, 4), 'ι', 'an η cycle (36 ι) has quarters of 9 ι');
  assert.equal(unit(7, 4), 'ι', 'θ (4 ι) has quarters of exactly 1 ι');
  assert.equal(unit(9, 4), 'λ', 'κ (13 λ) has quarters of 3.25 λ');
  assert.equal(unit(10, 4), 'ν', 'λ (25 ν) has quarters of 6.25 ν');
  assert.equal(unit(6, 160), 'λ', 'the pointer over the wave resolves finer than a boundary');
  // ζ θ κ μ are no units: they are never a digit
  assert.deepEqual(PT.COORD.slice(0, 9).map((id) => pure.unitOf(id).sym).join(''), 'αβγδεηιλν');
  // below one Blink the ν count gets decimals, one more digit the finer the quarters are
  assert.equal(index(11, 4), PT.COORD.indexOf('nu'), 'a μ cycle (5 ν) has quarters of 1.25 ν: whole Blinks');
  assert.equal(index(12, 4), PT.COORD.indexOf('nu.1'), 'a ν cycle has quarters of 0.25 ν: one decimal');
  assert.equal(index(13, 4), PT.COORD.indexOf('nu.2'), 'a ξ cycle (0.14 ν) has quarters of 0.036 ν: two decimals');
  assert.equal(index(13, 160), PT.COORD.indexOf('nu.3'), 'the third decimal is the floor, not an error');
  for (let L = 0; L < 14; L++) assert.ok(PT.cycleSpanPos(model, L) > 0);
});

test('pure: coordinates are the stamp of the instant (read 1 ms into the state that starts there)', () => {
  const eta = model.levelAt(T, 6);
  const res = PT.resolutionIndex(pure, PT.cycleSpanPos(model, 6));
  const labels = eta.thresholds.map((e) => PT.whenText(pure, model, e.time, res, { dateTokens: 2, timeTokens: 3 }));
  // SPEC §15.6: vector A is in the 34th Helion (33 completed) of ε#5 of the 3rd Delta; the quarters of a Helion are 9 Preons
  assert.deepEqual(labels, ['δ#3 ε#5 34η 0ι', 'δ#3 ε#5 34η 9ι', 'δ#3 ε#5 34η 18ι', 'δ#3 ε#5 34η 27ι', 'δ#3 ε#5 35η 0ι']);
  // a coordinate is the stamp written the same way (core/pure.js stamp: no separators)
  assert.equal(PT.whenText(pure, model, T - 0.001, PT.COORD.indexOf('lambda'), { dateTokens: 5, timeTokens: 3 }), pure.stamp(T, 'lambda'));
  assert.equal(PT.whenText(pure, model, T - 0.001, PT.COORD.indexOf('lambda'), { dateTokens: 5, timeTokens: 3 }), 'α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ');
  // out of the catalogue nothing is invented
  assert.deepEqual(PT.whenParts(pure, model, model.tMax + 1e6, 6), PT.whenParts(pure, model, model.tMax + 2e6, 6));
  assert.equal(PT.pureFields(pure, model, model.tMin - 5), null);
  assert.deepEqual(PT.whenParts(pure, model, model.tMin - 5, 6), { date: '—', time: '' });
});

test('pure: fields of an instant are the core date and clock: ordinals α β γ δ ε, the Helion 1–77, counts ι λ ν', () => {
  for (const t of INSTANTS) {
    const f = PT.pureFields(pure, model, t);
    const d = pure.date(t);
    const c = pure.clock(t);
    assert.deepEqual(f.ord, [d.alpha, d.beta, d.gamma, d.delta, d.epsilon]);
    assert.deepEqual(f.count, [c.eta, c.iota, c.lambda, c.nu]);
    assert.ok(f.count[0] >= 1 && f.count[0] <= 77 && f.count[1] < 36 && f.count[2] < 65 && f.count[3] < 25, `${f.count}`);
    assert.ok(f.frac >= 0 && f.frac < 1, `how far the running ν has travelled: ${f.frac}`);
  }
});

test('pure: the Helion is numbered from 1 in its Nuclide (1η … 77η), the finer units are counts from 0', () => {
  const eps = model.levelAt(T, 4);
  const first = PT.whenParts(pure, model, eps.start, PT.COORD.indexOf('iota'), { dateTokens: 2, timeTokens: 2 });
  assert.deepEqual(first, { date: 'δ#3 ε#5', time: '1η 0ι' }, 'a Nuclide begins with its first Helion and no Preon completed');
  const last = PT.pureFields(pure, model, eps.end - 0.01);
  assert.deepEqual(last.count.slice(0, 2), [77, 35], 'its last Helion is the 77th, its last Preon count 35');
  // the exact reading agrees at a Nuclide boundary: the position of ε#1 of a Delta reads Helion 1
  const P4 = model.levelInfo(4).prefix;
  const at = PT.fieldsAtPosition(model, 4n * 7n, P4); // the start of the 8th Nuclide of the catalogue
  assert.equal(at.count[0], 1);
  assert.equal(at.ord[4], 3, 'the 8th Nuclide is the 3rd of the 2nd Delta');
});

test('pure: the five boundary labels of a cycle differ at every depth (the ξ ring too) and the end of one cycle reads as the start of the next', () => {
  for (const t of INSTANTS) {
    for (let L = 0; L <= 13; L++) {
      const lv = model.levelAt(t, L);
      const next = lv.end < model.tMax ? model.levelAt(lv.end + 0.001, L) : null;
      const key = (when) => {
        const f = PT.pureFields(pure, model, Math.min(when + 0.001, model.tMax));
        return [...f.ord, ...f.count, f.frac.toFixed(3)];
      };
      const keys = lv.thresholds.filter((e) => e.time !== null).map((e) => key(e.time));
      for (let i = 1; i < keys.length; i++) assert.notEqual(keys[i - 1].join(), keys[i].join(), `level ${L} @${t}: labels ${i - 1} and ${i}`);
      const written = PT.boundaryLabels(pure, model, L, lv.thresholds.map((e) => e.time)).filter(Boolean).map((l) => `${l.full.date}|${l.full.time}`);
      assert.equal(new Set(written).size, written.length, `level ${L} @${t}: written boundary labels differ: ${written.join(' ; ')}`);
      if (next) assert.equal(key(lv.end).join(), key(next.start).join(), `level ${L} @${t}: end of a cycle = start of the next`);
    }
  }
});

test('pure: boundaryLabels write the ordinals once, give a shorter alt, and the two parts always join into a piece of the stamp', () => {
  const lv = model.levelAt(T, 6);
  const labels = PT.boundaryLabels(pure, model, 6, lv.thresholds.map((e) => e.time));
  assert.equal(labels.length, 5);
  assert.equal(labels[0].date, 'δ#3 ε#5', 'the first label carries the ordinals');
  assert.ok(labels.slice(1).every((l) => l.date === '' && l.time && l.sameAsStart), 'inside one Nuclide the others repeat nothing');
  assert.deepEqual(labels.map((l) => l.time), ['34η 0ι', '34η 9ι', '34η 18ι', '34η 27ι', '35η 0ι']);
  for (const l of labels) {
    assert.equal(l.alt.length, 2);
    const size = (x) => (x.date + x.time).length;
    assert.ok(size(l.alt[0]) <= size({ date: l.date || 'xxxxxxxxxxxx', time: l.time }) && size(l.alt[1]) <= size(l.alt[0]));
  }
  assert.deepEqual(labels[2].alt, [{ date: '', time: '34η 18ι' }, { date: '', time: '18ι' }]);
  // a λ ring: the counts are cut to three, and the context before them is the coarser counts, not the ordinals
  const lam = PT.boundaryLabels(pure, model, 10, model.levelAt(T, 10).thresholds.map((e) => e.time));
  assert.equal(lam[0].full.date, 'ε#5 34η');
  assert.deepEqual(lam.map((l) => l.full.time), ['29ι 21λ 0ν', '29ι 21λ 6ν', '29ι 21λ 12ν', '29ι 21λ 18ν', '29ι 22λ 0ν']);
  assert.ok(pure.stamp(T, 'nu').endsWith(`${lam[0].full.date} 29ι 21λ 3ν`), 'the first label is a piece of the stamp of its own start');
  // an ε cycle crosses into the next Delta: the ordinals show again where they change
  const eps = model.levelAt(T, 4);
  const el = PT.boundaryLabels(pure, model, 4, eps.thresholds.map((e) => e.time));
  assert.deepEqual(el.map((l) => `${l.date}/${l.time}`), ['δ#3 ε#5/1η', '/20η', '/39η', '/58η', 'δ#4 ε#1/1η'], 'the Helions of the quarters, numbered from 1');
  // a long cycle has no time line: its ordinals are the label and are never dropped
  const al = PT.boundaryLabels(pure, model, 0, model.levelAt(T, 0).thresholds.map((e) => e.time));
  assert.deepEqual(al.map((l) => l.date), ['α#6 β#1', 'α#6 β#2', 'α#6 β#3', 'α#6 β#4', 'α#7 β#1']);
  assert.ok(al.every((l) => l.time === ''));
  const dl = PT.boundaryLabels(pure, model, 3, model.levelAt(T, 3).thresholds.map((e) => e.time));
  assert.deepEqual(dl.map((l) => l.date), ['δ#3 ε#1', 'δ#3 ε#2', 'δ#3 ε#3', 'δ#3 ε#4', 'δ#4 ε#1'], 'a Delta: its quarters fall in Nuclides 1–4');
  const last = model.levelAt(model.tMax - 5, 0);
  const ll = PT.boundaryLabels(pure, model, 0, last.thresholds.map((e) => e.time));
  assert.equal(ll.length, 5);
  assert.ok(ll.some((l) => l === null) || ll.every((l) => l && l.date));
});

test('pure: names: majors in words (with their quarter), minors by where they start in their Nuclide', () => {
  const lv = (L) => model.levelAt(T, L);
  assert.deepEqual([0, 1, 2, 3].map((L) => PT.displayName(pure, L, lv(L))), ['Alpha Hexafracton Valley', 'Beta Tetrafracton Valley', 'Gamma Nonafracton Valley', 'Delta Trifracton End'], 'SPEC §15.6 vector A');
  assert.deepEqual([0, 3].map((L) => PT.cycleName(pure, L, lv(L))), ['Alpha Hexafracton', 'Delta Trifracton']);
  assert.deepEqual([4, 5, 6, 7, 8, 13].map((L) => PT.displayName(pure, L, lv(L))), ['ε#5', 'ε#5 34η', 'ε#5 34η', 'ε#5 34η 28ι', 'ε#5 34η 29ι', 'ε#5 34η 29ι 21λ 3.43ν']);
  for (let L = 0; L <= 13; L++) assert.equal(PT.cycleName(pure, L, lv(L)), pure.cycleName(L, lv(L).cycleBig), 'the core names it');
  assert.deepEqual([0, 1, 2, 3].map((L) => PT.quarterWord(pure, lv(L))), ['Valley', 'Valley', 'Valley', 'End']);
});

test('pure: the end of a cycle says what begins, as briefly as the context allows; the catalogue end has nothing', () => {
  const lv = (L) => model.levelAt(T, L);
  assert.deepEqual(
    [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((L) => PT.endLine(pure, model, L, lv(L))),
    ['→ Delta Tetrafracton begins', '→ ε#1 of Delta Tetrafracton begins', '→ 45η begins', '→ 35η begins', '→ 32ι begins', '→ 30ι begins', '→ 26λ begins', '→ 22λ begins', '→ 5ν begins', '→ 4ν begins'],
  );
  assert.equal(PT.endsSentence(pure, model, 6, lv(6)), 'ends → 35η begins');
  // the last Helion of a Nuclide is followed by the first of the next one: the full placing
  const last = model.levelAt(model.levelAt(T, 4).end - 0.01, 6);
  assert.equal(PT.followerName(pure, model, 6, last), 'ε#1 1η', 'the first Helion of the next Nuclide');
  // a finer count that rolls over shows the coarser one that changes with it
  const lastIota = model.levelAt(model.levelAt(T, 6).end - 0.01, 8);
  assert.equal(PT.followerName(pure, model, 8, lastIota), '35η 0ι');
  const alpha = model.levelAt(model.tMax - 5, 0);
  assert.ok(alpha.clipped);
  assert.equal(PT.followerName(pure, model, 0, alpha), null);
  assert.equal(PT.endLine(pure, model, 0, alpha), '→ end of the catalogue');
  assert.equal(PT.endsSentence(pure, model, 0, alpha), 'the catalogue ends here');
  for (const t of INSTANTS) for (let L = 0; L <= 13; L++) assert.match(PT.endLine(pure, model, L, model.levelAt(t, L)), /^→ (((Alpha|Beta|Gamma|Delta) [A-Z][a-z]+fracton)|ε#\d( of Delta [A-Z][a-z]+fracton)?|ε#\d [\d.ηιλν ]+|[\d.]+[ηιλν]( [\d.]+[ηιλν])*) begins$|^→ end of the catalogue$/);
});

test('pure: spans and sentences count on the ladder, never in Earth units; real time in Blinks', () => {
  const lv = model.levelAt(T, 6);
  assert.equal(PT.between(pure, T, lv.end, 2), '6ι 43λ', 'SPEC §15.6');
  assert.equal(PT.between(pure, T, lv.end, 3), '6ι 43λ 21ν');
  assert.equal(PT.inText(pure, T, lv.end), 'in 6ι 43λ');
  assert.equal(PT.inText(pure, T, lv.start), '29ι 21λ ago');
  assert.equal(PT.between(pure, lv.end - 0.001, lv.end, 3), pure.between(lv.end - 0.001, lv.end, { parts: 3 }));
  assert.match(PT.between(pure, lv.end - 0.001, lv.end, 3), /^0\.00\d+ν$/);
  assert.equal(PT.between(pure, lv.end, lv.end, 3), '0ν');
  assert.equal(PT.between(pure, lv.end, T, 2), '−6ι 43λ');
  assert.equal(PT.startPhrase(pure, lv.start, lv.end, T), 'running now');
  assert.match(PT.startPhrase(pure, lv.end, lv.end + 1e5, T), /^starts in \d+[αβγδεηιλν]/);
  assert.match(PT.startPhrase(pure, lv.start - 1e5, lv.start - 5, T), /^started \d+[αβγδεηιλν].* ago$/);
  assert.equal(PT.aboutTurn(pure, model.levelInfo(9)), '325 Blinks', 'one turn of the opening ring (κ 10)');
  assert.equal(PT.aboutTurn(pure, model.levelInfo(12)), '1 Blink');
  assert.equal(PT.aboutTurn(pure, model.levelInfo(13)), '0.143 Blinks', 'the ξ ring: a seventh of a Blink');
  assert.equal(PT.aboutTurn(pure, model.levelInfo(8)), '1 625 Blinks', 'whole Blinks (the core keeps three digits: 1 630)');
  assert.equal(PT.aboutTurn(pure, model.levelInfo(6)), '58 500 Blinks');
  assert.match(PT.aboutTurn(pure, model.levelInfo(0)), /^\d{1,3}( \d{3})+ Blinks$/);
  assert.equal(PT.blinkSpan(pure, pure.blinkSeconds() * 4), pure.blinks(pure.blinkSeconds() * 4), 'small spans are the core\'s');
  assert.deepEqual(PT.addressTokens(pure, model, 6, lv.cycleBig).map((a) => a.text), ['α#6', 'β#4', 'γ#9', 'δ#3', 'ε#5', '34η']);
  assert.deepEqual(PT.addressTokens(pure, model, 9, model.levelAt(T, 9).cycleBig).map((a) => `${a.level}:${a.text}`), ['0:α#6', '1:β#4', '2:γ#9', '3:δ#3', '4:ε#5', '6:34η', '8:29ι', '10:13λ'], 'a κ: its start, coloured by unit');
  assert.deepEqual(PT.addressTokens(pure, model, 2, model.levelAt(T, 2).cycleBig).map((a) => a.text), ['α#6', 'β#4', 'γ#9']);
});

test('pure: the phase of a minor cycle is a pair, of a major one its quarter (never a pair)', () => {
  assert.equal(PT.stateText(pure, 13.9 / 16), 'phase 13 and 14 of 256');
  assert.equal(PT.stateText(pure, 0.9, 6), 'phase 14 and 6 of 256');
  assert.equal(PT.stateText(pure, 0.9, 3), 'End quarter');
  assert.equal(PT.stateText(pure, 0.3, 0), 'Node quarter');
  assert.equal(PT.sliderText(pure, 'Rising', 0.8143, 'ε#5 34η'), 'Rising, phase 13 and 0 of 256 in ε#5 34η');
  assert.equal(PT.sliderText(pure, 'Falling', 0.9, 'Delta Trifracton', 3), 'Falling, End quarter of Delta Trifracton');
  assert.equal(PT.pairLabel(pure, 0.5), 'phase 8 and 0 of 256');
  for (const f of [0, 0.3, 0.8143, 0.999]) assert.match(pure.pairHTML(f), new RegExp(`aria-label="${PT.pairLabel(pure, f)}"`));
});

test('pure: threshold chips count to every threshold (passed ones negative) and say where it sits on the clock', () => {
  const lv = model.levelAt(T, 6);
  const times = lv.thresholds.map((e) => e.time);
  const labels = PT.boundaryLabels(pure, model, 6, times);
  const chips = [0, 1, 2, 3].map((k) => PT.chipText(pure, model, 6, lv, k, times[k + 1], T, labels[k + 1]));
  assert.deepEqual(chips.map((c) => c.count), ['−20ι 21λ', '−11ι 21λ', '−2ι 21λ', '6ι 43λ']);
  assert.deepEqual(chips.map((c) => c.time), ['34η 9ι', '34η 18ι', '34η 27ι', '35η 0ι']);
  assert.ok(chips.every((c) => c.date === ''), 'inside one Nuclide the chips leave the ordinals to the header');
  assert.equal(chips[0].title, 'Jump back to the peak of ε#5 34η · δ#3 ε#5 34η 9ι · 20ι 21λ ago');
  assert.equal(chips[3].title, 'Jump just past the end of ε#5 34η (35η begins) · δ#3 ε#5 35η 0ι · in 6ι 43λ');
  assert.equal(chips[0].label, 'the peak of ε#5 34η, 20ι 21λ ago, at δ#3 ε#5 34η 9ι');
  const gone = PT.chipText(pure, model, 6, lv, 3, null, T);
  assert.deepEqual(gone, { count: '', date: '—', time: '', title: 'end: beyond the end of the catalogue', label: 'end: beyond the end of the catalogue' });
  // a major cycle's chips name it in words
  const d = model.levelAt(T, 3);
  const dt = d.thresholds.map((e) => e.time);
  const dChip = PT.chipText(pure, model, 3, d, 3, dt[4], T, PT.boundaryLabels(pure, model, 3, dt)[4]);
  assert.match(dChip.title, /^Jump just past the end of Delta Trifracton \(Delta Tetrafracton begins\) · δ#4 ε#1 · in \d+η \d+ι$/);
  const lastLv = model.levelAt(model.tMax - 5, 0);
  const endChip = PT.chipText(pure, model, 0, lastLv, 3, model.tMax, model.tMax - 5, { full: { date: 'α#18 β#2', time: '' }, sameAsStart: false });
  assert.match(endChip.title, /\(the catalogue ends\)/);
});

test('pure: the tooltip rows of a child cycle name it and what follows it', () => {
  const lv = model.levelAt(T, 4);
  const ch = childCycle(model, 4, lv.cycle, 2);
  assert.equal(pure.cycleName(ch.level, BigInt(ch.index)), 'ε#5 23η', 'the 3rd ζ of the Nuclide starts with its 23rd Helion');
  assert.equal(PT.followerName(pure, model, ch.level, { cycle: ch.index, cycleBig: BigInt(ch.index), clipped: ch.clipped, end: ch.end }), '34η');
  assert.equal(PT.lengthWithName(pure, ch.level, ch), '11η', 'a ζ is no unit: eleven Helions');
  const lastChild = childCycle(model, 4, lv.cycle, 6);
  assert.equal(PT.followerName(pure, model, lastChild.level, { cycle: lastChild.index, cycleBig: BigInt(lastChild.index), clipped: lastChild.clipped, end: lastChild.end }), 'ε#1 1η');
  // the children of a major ring are majors: words
  const g = model.levelAt(T, 2);
  const dch = childCycle(model, 2, g.cycle, 3);
  assert.equal(pure.cycleName(dch.level, BigInt(dch.index)), 'Delta Tetrafracton');
  assert.match(PT.startPhrase(pure, dch.start, dch.end, T), /^(running now|starts in .+|started .+ ago)$/);
});

test('pure: a whole cycle has its exact nominal length at every depth 1-14 (Length fact, sector tooltips)', () => {
  // SPEC §15.4: depths 1–5, 7, 9, 11, 13 are one unit each; the depths between are whole counts of the next unit
  const nominal = ['1α', '1β', '1γ', '1δ', '1ε', '11η', '1η', '4ι', '1ι', '13λ', '1λ', '5ν', '1ν', '0.14ν'];
  for (let L = 0; L < 14; L++) assert.equal(pure.cycleLength(L), nominal[L], `depth ${L + 1}`);
  const named = ['1α = 5β', '1β = 13γ', '1γ = 5δ', '1δ = 5ε', '1ε (Nuclide) = 77η', '11η', '1η (Helion) = 36ι', '4ι', '1ι (Preon) = 65λ', '13λ', '1λ (Flavon) = 25ν', '5ν', '1ν (Blink)', '0.14ν'];
  let checked = 0;
  let seed = 20261013;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const instants = [...INSTANTS, ...Array.from({ length: 120 }, () => model.tMin + 1 + rnd() * (model.tMax - model.tMin - 2))];
  for (const t of instants) {
    for (let L = 0; L < 14; L++) {
      const lv = model.levelAt(t, L);
      if (!lv || lv.clipped) continue;
      checked++;
      const f = PT.factParts(pure, model, L, lv);
      assert.equal(f.length, nominal[L], `Length of depth ${L + 1} @${t}`);
      assert.equal(f.lengthNamed, named[L]);
      if (L < 13) {
        for (const j of [0, Math.floor(model.levelInfo(L).factor / 2)]) {
          const ch = childCycle(model, L, lv.cycle, j);
          if (ch && !ch.clipped) assert.equal(PT.lengthText(pure, ch.level, ch), nominal[ch.level], `child ${j} of depth ${L + 1} @${t}`);
        }
      }
    }
  }
  assert.ok(checked > 1500, `${checked} whole cycles checked`);
  assert.equal(PT.unitNote(pure, 6), 'Helion');
  assert.equal(PT.unitNote(pure, 5), '', 'ζ is no unit');
  assert.equal(PT.unitNote(pure, 3), '', 'a major is said in words already');
  // a whole cycle is never measured: with a core whose between() is off by one unit the text is still exact
  const off = { ...pure, between: () => '35ι 64λ' };
  assert.equal(PT.lengthText(off, 6, model.levelAt(T, 6)), '1η');
});

test('pure: only a cycle clipped by the catalogue end is measured (it is shorter than its kind)', () => {
  const alpha = model.levelAt(model.tMax - 5, 0);
  assert.ok(alpha.clipped);
  assert.equal(PT.lengthText(pure, 0, alpha), pure.between(alpha.start, alpha.end));
  assert.notEqual(PT.lengthText(pure, 0, alpha), pure.cycleLength(0), 'α#18 holds one Saros, not four');
  assert.equal(PT.factParts(pure, model, 0, alpha).lengthNamed, PT.lengthText(pure, 0, alpha), 'a clipped cycle is not one whole unit');
  const last = childCycle(model, 0, alpha.cycle, 0);
  assert.equal(PT.lengthText(pure, last.level, last), last.clipped ? pure.between(last.start, last.end) : pure.cycleLength(1));
});

test('pure: nothing Gregorian, no Earth unit, no percentage, no retired name in any sentence this view writes (all depths, many instants)', () => {
  const bad = [];
  const check = (what, text) => {
    const hit = earthly(text);
    if (hit.length) bad.push(`${what}: ${hit} in "${text}"`);
    if (RETIRED.test(text) || text.includes(HALF)) bad.push(`${what}: retired spelling in "${text}"`);
  };
  const strip = (html) => html.replace(/<[^>]+>/g, ' ');
  for (const t of INSTANTS) {
    for (let L = 0; L <= 13; L++) {
      const lv = model.levelAt(t, L);
      if (!lv) continue;
      const info = model.levelInfo(L);
      const times = lv.thresholds.map((e) => e.time);
      check('name', PT.displayName(pure, L, lv));
      check('end line', PT.endLine(pure, model, L, lv));
      check('ends', PT.endsSentence(pure, model, L, lv));
      check('between', PT.between(pure, t, lv.end, 3));
      check('centre', PT.centreSpan(pure, model, t, lv.end));
      check('in', PT.inText(pure, t, lv.start) + PT.inText(pure, t, lv.end));
      check('about', PT.aboutTurn(pure, info));
      check('pointer', PT.pointerText(pure, model, L, t));
      check('state', PT.stateText(pure, lv.phase, L));
      check('slider', PT.sliderText(pure, 'Falling', lv.phase, PT.cycleName(pure, L, lv), L));
      check('length', PT.lengthWithName(pure, L, lv));
      const labels = PT.boundaryLabels(pure, model, L, times);
      labels.forEach((l, i) => {
        if (!l) return;
        check('label', `${l.date} ${l.time}`);
        check('alt', l.alt.map((a) => `${a.date} ${a.time}`).join(' '));
        if (i >= 1) check('chip', Object.values(PT.chipText(pure, model, L, lv, i - 1, times[i], t, l)).join(' | '));
      });
      check('address', PT.addressTokens(pure, model, L, lv.cycleBig).map((a) => a.text).join(' '));
    }
  }
  const help = strip(PT.helpHTML(pure, model.levelInfo(9), model.levelInfo(13)));
  check('help', help);
  check('depth note', PT.depthRangeNote(pure, model.levelInfo(9), model.levelInfo(13)));
  assert.deepEqual(bad, []);
  for (const w of ['Delta Trifracton End', 'Difracton', 'α#1 – α#18', '256 states', 'κ 10', 'ξ 14', '325 Blinks', '0.143 Blinks', 'Helion', 'Preon', 'Flavon', 'Blink', 'Peak, Node, Valley and End', '11η, 4ι, 13λ and 5ν']) assert.ok(help.includes(w), w);
  assert.doesNotMatch(help, /Gregorian|zone|o’clock|o'clock|%|beat/);
});

test('pure: a threshold on the catalogue end reads the exact end position, not the previous unit', () => {
  const end = model.tMax;
  for (const level of [8, 9, 10, 11, 12]) {
    const P = model.levelInfo(level).prefix;
    for (const cell of [0n, 1n, 12345678901n, BigInt(model.extent) * P / 4n - 1n]) {
      const num = (2n * cell + 1n) * 4n;
      const den = 2n * P;
      const pos = Number(num) / Number(den);
      if (!(pos >= 0 && pos < model.extent)) continue;
      const t = model.timeOfPosition(pos);
      const viaClock = PT.pureFields(pure, model, t);
      const viaPos = PT.fieldsAtPosition(model, num, den);
      assert.deepEqual(viaPos.ord, viaClock.ord, `ordinals at level ${level + 1} cell ${cell}`);
      assert.deepEqual(viaPos.count, viaClock.count, `counts at level ${level + 1} cell ${cell}`);
      near(viaPos.frac, viaClock.frac, 5e-3, `the decimals of ν at level ${level + 1} cell ${cell}`);
    }
  }
  // at the end itself the counts have rolled over: the last ι of the catalogue is complete
  const e = PT.fieldsAtPosition(model, BigInt(model.extent));
  assert.deepEqual(e.count, [20, 9, 0, 0]);
  assert.equal(PT.whenText(pure, model, end, PT.COORD.indexOf('iota'), { dateTokens: 0, timeTokens: 2 }), '20η 9ι');
  assert.equal(PT.whenText(pure, model, end - 5e-4, PT.COORD.indexOf('iota'), { dateTokens: 0, timeTokens: 2 }), '20η 9ι', 'within the 1 ms nudge of the end');
  assert.equal(PT.whenText(pure, model, end + 1e6, PT.COORD.indexOf('iota'), { dateTokens: 0, timeTokens: 2 }), '20η 9ι', 'beyond it nothing is invented');
  const before = PT.pureFields(pure, model, end - 0.001);
  assert.deepEqual(before.count.slice(0, 3), [20, 8, 64], 'one millisecond earlier the ι is still running');
  let seen = 0;
  for (let L = 0; L <= 13; L++) {
    const lv = model.levelAt(end - 5, L);
    const times = lv.thresholds.map((x) => x.time);
    const labels = PT.boundaryLabels(pure, model, L, times);
    times.forEach((time, i) => {
      if (time === null || time < end - 1e-6) return;
      seen++;
      const want = PT.whenParts(pure, model, end, PT.resolutionIndex(pure, PT.cycleSpanPos(model, L)), { dateTokens: 2, timeTokens: 3 });
      assert.deepEqual(labels[i].full, want, `depth ${L + 1}, threshold ${i}`);
      assert.doesNotMatch(labels[i].full.time, /(^| )8ι/, `depth ${L + 1}, threshold ${i}: ${labels[i].full.time}`);
    });
  }
  assert.ok(seen >= 6, `${seen} thresholds sit on the catalogue end`);
  const lam = model.levelAt(end - 5, 10);
  const lamLabels = PT.boundaryLabels(pure, model, 10, lam.thresholds.map((x) => x.time));
  assert.equal(lamLabels[4].time, '9ι 0λ 0ν');
  const xi = model.levelAt(end - 0.0001, 13);
  const xiLabels = PT.boundaryLabels(pure, model, 13, xi.thresholds.map((x) => x.time));
  assert.equal(xiLabels[4].full.time, '9ι 0λ 0.00ν', 'the last ξ cycle ends with the catalogue, decimals included');
});

test('pure: the centre countdown is two counts, or three that stay steady (never finer than λ)', () => {
  const lv = model.levelAt(T, 6);
  // 6ι 43λ left (SPEC §15.6); a third count would be a ν (0.3 of a Flavon): two counts, the same string as everywhere
  assert.equal(PT.centreSpan(pure, model, T, lv.end), '6ι 43λ');
  assert.equal(PT.centreSpan(pure, model, T, lv.end, { compact: true }), '6ι 43λ');
  // a longer span starts coarser: three counts, the last one a λ at finest
  const zeta = model.levelAt(T, 5);
  assert.equal(PT.centreSpan(pure, model, T, zeta.end), '10η 6ι 43λ');
  assert.equal(PT.centreSpan(pure, model, T, zeta.end, { compact: true }), pure.between(T, zeta.end, { parts: 2 }));
  assert.equal(PT.centreSpan(pure, model, T, model.levelAt(T, 3).end), '43η 6ι 43λ');
  // at the end of a ι: only λ and ν remain: two counts, never three
  const iota = model.levelAt(T, 8);
  assert.match(PT.centreSpan(pure, model, iota.end - 43, iota.end), /^5λ \d+ν$/);
  assert.equal(PT.centreSpan(pure, model, lv.end + 5, lv.end), '0ν');
  assert.match(PT.centreSpan(pure, model, iota.end - 0.2, iota.end), /^0\.\d+ν$/);
  for (const t of INSTANTS) for (let L = 0; L <= 13; L++) assert.ok(PT.centreSpan(pure, model, t, model.levelAt(t, L).end).split(' ').length <= 3);
});

test('pure: the help says ordinals and the Helion start at 1, the finer counts at 0, majors are words, and points to the glossary', () => {
  const help = PT.helpHTML(pure, model.levelInfo(9), model.levelInfo(13)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(help, /Ordinals \(.*\) and the Helion of a date are numbered from 1 \(1η … 77η in a Nuclide\); Preons, Flavons and Blinks \(ι λ ν\) count completed units from 0/);
  assert.match(help, /Press \? for the glossary\./);
  assert.match(help, /δ#3 ε#5 names the Delta and the Nuclide/);
  assert.match(help, /a Nuclide is 77 Helions, a Helion 36 Preons, a Preon 65 Flavons, a Flavon 25 Blinks/);
  assert.match(help, /a major one shows its quarter instead/);
});

test('pure: the normal-mode helpers are untouched by pure mode (same strings as before)', () => {
  const utc = createFormatter(() => 'UTC');
  assert.equal(cycleTag(model.levelInfo(6), model.levelAt(T, 6)), 'η 7 · 1/11');
  assert.equal(whenText(utc, T, 5 * 3600), 'Thu 8 Oct 2026, 12:00:00');
  assert.equal(percentText(0.8143), '81.4 %');
  assert.equal(countdownBody(utc, 3372), '56 min 12 s');
});

test('revisions 2 and 3: no half unit, no "beat", no retired unit name, no minor fracton name anywhere in the rings view', () => {
  const dir = '../src/ui/rings/';
  const files = ['../src/ui/rings.js', '../src/styles/rings.css', ...readdirSync(new URL(dir, import.meta.url)).map((f) => dir + f)];
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, new RegExp(`[αβγδεζηθικλμνξ]${HALF}`), `${f}: a half-cycle unit`);
    assert.doesNotMatch(src, /\bbeats?\b/i, `${f}: the retired word "beat"`);
    assert.doesNotMatch(src, RETIRED, `${f}: a retired unit name or a minor fracton name`);
  }
  const note = PT.depthRangeNote(pure, model.levelInfo(9), model.levelInfo(13));
  assert.match(note, /about 325 Blinks/);
  assert.match(note, /about 0\.143 Blinks/);
  assert.deepEqual(earthly(note), []);
});
