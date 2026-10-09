import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedParts, zonedToUnix, createFormatter, duration, countdown, daysInMonth, offsetLabel } from '../src/core/format.js';

test('zonedParts / zonedToUnix round trip across zones and DST', () => {
  const zones = ['UTC', 'Europe/Kyiv', 'America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe', 'Pacific/Auckland'];
  for (const z of zones) {
    for (const t of [1791460800, 946684800, 1700000000.5, 2886085800, -1e9, 4e9]) {
      const p = zonedParts(t, z);
      const back = zonedToUnix(p, z);
      assert.ok(Math.abs(back - t) < 1e-3, `${z} ${t} -> ${back}`);
    }
  }
});

test('known conversions', () => {
  assert.equal(zonedToUnix({ year: 2026, month: 10, day: 8, hour: 12 }, 'UTC'), 1791460800);
  assert.equal(zonedToUnix({ year: 2026, month: 10, day: 8, hour: 15 }, 'Europe/Kyiv'), 1791460800); // UTC+3 in October (EEST)
  const p = zonedParts(1791460800, 'America/New_York');
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.weekday, p.offset], [2026, 10, 8, 8, 4, -4 * 3600]);
});

test('DST gap resolves to a valid instant on the right day', () => {
  // 2026-03-29 03:30 does not exist in Europe/Berlin (clocks jump 02:00 -> 03:00)
  const t = zonedToUnix({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, 'Europe/Berlin');
  const p = zonedParts(t, 'Europe/Berlin');
  assert.equal(p.day, 29);
  // fold: 2026-10-25 02:30 happens twice in Berlin
  const f = zonedToUnix({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, 'Europe/Berlin');
  const q = zonedParts(f, 'Europe/Berlin');
  assert.deepEqual([q.day, q.hour, q.minute], [25, 2, 30]);
});

test('formatter', () => {
  const f = createFormatter(() => 'UTC');
  assert.equal(f.date(1791460800), '2026-10-08');
  assert.equal(f.time(1791460800.25, { ms: true }), '12:00:00.250');
  assert.equal(f.long(1791460800), 'Thu 8 Oct 2026, 12:00:00');
  assert.equal(f.label(1791464172.428, 1791460800), '12:56:12');
  assert.equal(f.label(1791509644.786, 1791460800), 'Oct 9 01:34');
  assert.equal(f.iso(1791460800), '2026-10-08T12:00:00+00:00');
  assert.equal(f.parseInput('2026-10-08T12:00'), 1791460800);
  assert.equal(f.parseInput('2026-02-30T12:00'), null);
  assert.equal(f.parseInput('nope'), null);
  const k = createFormatter(() => 'Europe/Kyiv');
  assert.equal(k.tag(1791460800), 'UTC+03:00');
  assert.equal(k.inputValue(1791460800), '2026-10-08T15:00:00');
});

test('duration / countdown', () => {
  assert.equal(duration(0.31), '310 ms');
  assert.equal(duration(7.77), '7.8 s');
  assert.equal(duration(101), '1 min 41 s');
  assert.equal(duration(18188.9), '5 h 3 min');
  assert.equal(duration(86400 * 3 + 3600 * 4 + 5), '3 d 4 h');
  assert.equal(duration(86400 * 81.05), '81 d 1 h');
  assert.equal(duration(31557600 * 1.11), '1.11 y');
  assert.equal(duration(31557600 * 72.12), '72.1 y');
  assert.equal(countdown(90), 'in 1 min 30 s');
  assert.equal(countdown(-3700), '1 h 01 min ago');
  assert.equal(countdown(86400 * 40), 'in 40 d 00 h');
});

test('calendar helpers', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(offsetLabel(-12600), '-03:30');
});

test('milliseconds never reach 1000 when rounding up', () => {
  const f = createFormatter(() => 'UTC');
  assert.equal(f.time(1791460799.9996, { ms: true }), '12:00:00.000');
  assert.equal(zonedParts(1791460799.9996, 'UTC').ms, 0);
  assert.equal(zonedParts(1791460800.9996, 'UTC').second, 1);
});

test('fold resolves to the earlier instant and a gap moves forward, east and west of Greenwich', () => {
  for (const zone of ['Europe/Berlin', 'Europe/Kyiv', 'Australia/Sydney', 'America/New_York']) {
    const fold = zone === 'Australia/Sydney' ? { year: 2026, month: 4, day: 5, hour: 2, minute: 30 } : zone === 'America/New_York' ? { year: 2026, month: 11, day: 1, hour: 1, minute: 30 } : { year: 2026, month: 10, day: 25, hour: zone === 'Europe/Kyiv' ? 3 : 2, minute: 30 };
    const t = zonedToUnix(fold, zone);
    const q = zonedParts(t, zone);
    assert.deepEqual([q.hour, q.minute], [fold.hour, fold.minute], zone);
    assert.equal(zonedParts(t - 3600, zone).hour, fold.hour === 0 ? 23 : fold.hour - 1, zone + ': an hour earlier is before the wall time, so t is the first of the two');
  }
  const gap = zonedToUnix({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, 'Europe/Berlin');
  assert.deepEqual([zonedParts(gap, 'Europe/Berlin').hour, zonedParts(gap, 'Europe/Berlin').minute], [3, 30]);
  assert.equal(zonedToUnix({ year: 50, month: 6, day: 1 }, 'UTC'), -120534393600);
});

test('offset labels keep seconds of local mean time; unknown zones fall back instead of throwing', () => {
  assert.equal(offsetLabel(3208), '+00:53:28');
  assert.equal(offsetLabel(-7200), '-02:00');
  const f = createFormatter(() => 'Not/AZone');
  assert.doesNotThrow(() => f.time(1791460800));
});
