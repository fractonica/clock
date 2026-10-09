import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';

const model = createModel();
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);

// SPEC §12 test vectors
test('vector A: 2026-10-08T12:00:00Z', () => {
  const t = 1791460800;
  const f = model.frame(t);
  near(f.pos, 22.927850216635, 1e-9, 'position');
  const d7 = f.level(6);
  assert.deepEqual([d7.index, d7.value, d7.derivative], [13, -3, 1]);
  assert.deepEqual(f.odometer(6).digits, [13, 0]);
  assert.deepEqual([d7.cycle, d7.local, d7.siblings], [717211, 0, 11]);
  assert.equal(d7.next.name, 'end');
  near(d7.next.time, 1791464172.428, 5e-4);
  const d7s3 = f.level(6, { strokes: 3 });
  assert.deepEqual([d7s3.index, d7s3.value], [42, -10]);

  const d8 = f.level(7);
  assert.deepEqual([d8.index, d8.value, d8.derivative, d8.dotted], [5, 3, -1, true]);
  assert.deepEqual(f.odometer(7).digits, [5, 4]);
  assert.deepEqual([d8.cycle, d8.local, d8.siblings], [6454906, 7, 9]);
  assert.equal(d8.next.name, 'node');
  near(d8.next.time, 1791461140.937, 5e-4);

  const s = f.solar();
  assert.equal(s.sync, 4820);
  near(s.start, 1791336849.826, 5e-4);
  near(s.phase, 0.358662585, 1e-9);
  near(s.drift, -48469.9899, 5e-4);
  assert.deepEqual(s.digits3, [5, 11, 13]);
  assert.deepEqual(s.digits2x3, [18, 33]);
  assert.equal(s.threshold.name, 'node');
  near(s.threshold.time, 1791509644.786, 5e-4);
  near(s.end, Date.parse('2026-10-11T01:33:59.745Z') / 1000, 1e-3);
});

test('vector B: 2000-01-01T00:00:00Z', () => {
  const f = model.frame(946684800);
  near(f.pos, 21.443111640256, 1e-9);
  const d7 = f.level(6);
  assert.deepEqual([d7.index, d7.value], [5, 3]);
  assert.equal(d7.dotted, true);
  assert.deepEqual(f.odometer(6).digits, [5, 6]);
  assert.deepEqual([d7.local, d7.siblings], [9, 11]);
  assert.equal(d7.next.name, 'node');
  near(d7.next.time, 946687783.046, 5e-4);
  const d8 = f.level(7);
  assert.equal(d8.index, 0);
  assert.deepEqual(f.odometer(7).digits, [0, 6]);
  assert.deepEqual([d8.local, d8.siblings], [3, 9]);
  assert.equal(d8.next.name, 'peak');
  near(d8.next.time, 946685256.803, 5e-4);
  const s = f.solar();
  assert.equal(s.sync, 2375);
  near(s.start, 946369476.52, 5e-4);
  near(s.phase, 0.912420883, 1e-9);
  near(s.drift, -23843.2957, 5e-4);
  assert.deepEqual(s.digits3, [14, 9, 9]);
  near(s.threshold.time, 946715066.462, 5e-4);
  assert.equal(s.threshold.name, 'end');
});

test('vector C: 2061-06-15T18:30:00Z', () => {
  const f = model.frame(2886085800);
  near(f.pos, 24.851712757369, 1e-9);
  const d7 = f.level(6);
  assert.deepEqual([d7.index, d7.value, d7.dotted], [10, -2, true]);
  assert.deepEqual(f.odometer(6).digits, [10, 3]);
  assert.deepEqual([d7.local, d7.siblings], [0, 11]);
  assert.equal(d7.next.name, 'valley');
  near(d7.next.time, 2886087806.395, 5e-4);
  const d8 = f.level(7);
  assert.deepEqual([d8.index, d8.value], [12, -4]);
  assert.deepEqual(f.odometer(7).digits, [12, 1]);
  assert.deepEqual([d8.local, d8.siblings], [5, 9]);
  assert.equal(d8.next.name, 'end');
  near(d8.next.time, 2886086290.651, 5e-4);
  const s = f.solar();
  assert.equal(s.sync, 7987);
  near(s.phase, 0.770510076, 1e-9);
  near(s.drift, -81000.1249, 5e-4);
  assert.deepEqual(s.digits3, [12, 5, 4]);
  near(s.threshold.time, 2886165109.343, 5e-4);
});

test('anchor: one second after the anchor eclipse', () => {
  const s = model.frame(125593320.816).solar();
  assert.equal(s.sync, 0);
  near(s.drift, 0, 1e-6);
  assert.deepEqual(s.digits3, [0, 0, 0]);
});

// Model helpers --------------------------------------------------------------
test('level table: names, siblings, prefix (SPEC §3)', () => {
  const names = Array.from({ length: 14 }, (_, L) => model.levelInfo(L).letter).join('');
  assert.equal(names, 'αβγδεζηθικλμνξ');
  assert.deepEqual(Array.from({ length: 14 }, (_, L) => model.levelInfo(L).prefixNum), [
    1, 5, 65, 325, 1625, 11375, 125125, 1126125, 4504500, 22522500, 292792500, 1463962500, 7319812500, 51238687500,
  ]);
  assert.equal(model.levelInfo(0).siblings, null);
  assert.equal(model.levelInfo(1).siblings, 5);
  assert.equal(model.levelInfo(7).siblings, 9);
  assert.equal(model.levelInfo(6).factor, 9);
  near(model.levelInfo(6).meanSeconds / 3600, 5.052, 0.01, 'depth 7 mean length (h)');
});

test('float catalogue mapping agrees with the exact library (SPEC §11)', () => {
  for (const t of [-1e10, -3e9, 0, 125593319.816, 1791460800.123, 2886085800, 2.5e10]) {
    const exact = model.clock.positionAt(String(t));
    const approx = model.positionOf(t);
    near(approx, model.F.number(exact), 1e-9, 'position@' + t);
    near(model.timeOfPosition(approx), t, 1e-3, 'roundtrip@' + t);
  }
  assert.equal(model.positionOf(model.tMin - 1), null);
  assert.equal(model.positionOf(model.tMax + 1), null);
});

test('out of catalogue: nothing is extrapolated', () => {
  const f = model.frame(model.tMax + 10);
  assert.equal(f.inRange, false);
  assert.equal(f.level(3), null);
  assert.equal(f.solar(), null);
  assert.equal(f.address(), null);
});

test('phase is exact and consistent with the glyph index', () => {
  for (const t of [1791460800, 1791461000.5, 946684800.25]) {
    for (const L of [0, 3, 6, 9, 12]) {
      const l = model.levelAt(t, L);
      assert.equal(Math.floor(l.phase * l.states), l.index, `L${L}@${t}`);
    }
  }
});

test('addresses: cycle path round-trips and matches the library calendar', () => {
  const t = 1791460800;
  assert.deepEqual(model.addressAt(t), [6, 4, 9, 3, 5]);
  for (const L of [0, 2, 4, 6, 8]) {
    const l = model.levelAt(t, L);
    const path = model.cycleToPath(L, l.cycleBig);
    assert.equal(path.length, L + 1);
    assert.equal(model.pathToCycle(path), l.cycleBig);
  }
  assert.equal(model.pathToCycle([1, 6]), null, 'Beta has only 5 siblings');
  assert.equal(model.pathToCycle([19]), null, 'only 18 Alpha cycles');
});

test('boundaries(): ordered, inside the window, consistent with cycleStartTime', () => {
  const t = 1791460800;
  const b = model.boundaries(6, t - 86400, t + 86400);
  assert.ok(b.length >= 9 && b.length <= 11, 'about 10 depth-7 cycles per two days, got ' + b.length);
  for (let i = 1; i < b.length; i++) assert.ok(b[i].time > b[i - 1].time);
  assert.ok(b[0].time >= t - 86400 && b.at(-1).time <= t + 86400);
  for (const x of b) near(x.time, model.cycleStartTime(6, x.idx), 1e-6);
  const cur = model.levelAt(t, 6);
  assert.ok(b.some((x) => x.idx === cur.cycle), 'contains the current cycle start');
});

test('upcomingEnds(): sorted, nested ends are merged', () => {
  const t = 1791460800;
  const ev = model.upcomingEnds(t, { fromLevel: 4, toLevel: 8, count: 20, perLevel: 12 });
  assert.ok(ev.length >= 10);
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].time >= ev[i - 1].time);
  for (const e of ev) {
    assert.ok(e.time > t);
    // an end at level L is an end at every deeper level that was requested
    const top = e.levels[0];
    assert.deepEqual(e.levels, Array.from({ length: 8 - top + 1 }, (_, i) => top + i).filter((L) => e.levels.includes(L)));
  }
});

test('stateOccurrences(): next/previous occurrence of an odometer state', () => {
  const t = 1791460800;
  // depth 7 shows [13,0] now; next time it shows [13,0] again is one cycle (~5 h) later
  const next = model.stateOccurrences(6, [13, 0], t, { direction: 1, count: 2 });
  const prev = model.stateOccurrences(6, [13, 0], t, { direction: -1, count: 1 });
  assert.equal(next.length, 2);
  assert.ok(next[0].start > t && next[1].start > next[0].start);
  assert.ok(prev[0].start < t);
  near((next[0].start - prev[0].start) / 3600, 10.1, 0.1, 'previous/next skip the occurrence showing now: two cycles apart');
  const shown = model.stateOccurrences(6, [13, 0], next[0].start + 1, { direction: -1, count: 1 });
  // `previous` skips the occurrence that is showing at that instant, so it returns the one showing at t
  near(shown[0].start, 1791460762.001, 0.01);
  assert.ok(shown[0].start <= t && t < shown[0].end);
  assert.equal(model.odometerAt(next[0].start + 1, 6).digits.join(), '13,0');
});

test('solarSyncByNumber() agrees with solarAt()', () => {
  const t = 1791460800;
  const at = model.solarAt(t);
  const byN = model.solarSyncByNumber(at.sync);
  near(byN.start, at.start, 1e-6);
  near(byN.end, at.end, 1e-6);
  near(byN.drift, at.drift, 1e-6);
  assert.ok(model.solarSyncByNumber(-10000), 'syncs before the 1973 anchor exist (catalogue starts 1613)');
  assert.equal(model.solarSyncByNumber(-1e6), null);
  assert.equal(model.solarSyncByNumber(1e6), null);
});

test('catalogue edges: closing instant belongs to the last cycle, partial syncs are null', () => {
  const end = model.levelAt(model.tMax, 9); // 69 * P(9) / 4 is an integer: the cycle after the last does not exist
  assert.equal(end.cycle, Number(model.clock.count(9)) - 1);
  assert.ok(end.phase > 0.999);
  assert.ok(model.frame(model.tMax).level(0));
  assert.equal(model.solarAt(model.tMin + 1), null);
  assert.equal(model.solarAt(model.tMax - 1), null);
  assert.ok(model.solarAt(model.tMin + 4 * 86400));
  assert.ok(model.odometerAt(model.tMax, 6));
});
