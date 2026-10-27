import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createFormatter } from '../src/core/format.js';
import { helionPentad, pentadRuns, pagePentadRuns, pentadStartsIn, pentadsOfSpan, syncPentads } from '../src/ui/calendar/pentads.js';
import { buildMonth, OVERLAYS } from '../src/ui/calendar/month.js';
import { buildPureGrid, ETA_PER_CELL, GRID } from '../src/ui/calendar/pure-conv.js';
import { pentadsIn } from '../src/ui/pentad.js';

const model = createModel();
const A = 1791460800; // SPEC vector A: Pentad II of sync 4820
const utc = createFormatter(() => 'UTC');

test('a Helion knows its Pentad exactly as the clock does', () => {
  const helion = model.levelInfo(6).meanSeconds;
  for (let k = -60; k <= 60; k++) {
    const t = A + k * helion * 0.61 + 7;
    const l = model.levelAt(t, 6);
    const want = model.pentadAt(t);
    const got = helionPentad(model, l.cycle);
    assert.deepEqual([got.sync, got.index, got.helion, got.helions], [want.sync, want.index, want.helion, want.helions], `t ${t}`);
    assert.equal(got.first, want.helion === 1);
  }
  // the anchor eclipse's Helion begins Pentad I of sync 0, the Helion before it ends the Hypopentad of sync -1
  const a = (20 * model.levelInfo(6).prefixNum) / 4;
  assert.deepEqual(helionPentad(model, a), { sync: 0, index: 0, helion: 1, helions: 5, first: true });
  assert.deepEqual(helionPentad(model, a - 1), { sync: -1, index: 3, helion: 4, helions: 4, first: false });
});

test('runs: 11 Helions group into Pentads like days into weeks, the Hypopentad four long', () => {
  const a = (20 * model.levelInfo(6).prefixNum) / 4;
  const runs = pentadRuns(model, a + 12, 11); // Helions 12..22 of sync 0: III (2 of it), H (4), I (5) of sync 1
  assert.deepEqual(runs.map((r) => [r.sync, r.index, r.count, r.startsHere, r.endsHere]), [
    [0, 2, 3, false, true],
    [0, 3, 4, true, true],
    [1, 0, 4, true, false],
  ]);
  assert.equal(runs[0].x0, 0);
  assert.equal(runs.at(-1).x1, 1);
  for (let i = 1; i < runs.length; i++) assert.equal(runs[i].x0, runs[i - 1].x1, 'runs tile the block');
  assert.equal(runs[0].place, 3, 'the first run begins at the 3rd Helion of its Pentad');
  // a whole page: every cell's runs add up to its 11 Helions
  const grid = buildPureGrid(model, 1000);
  const page = pagePentadRuns(model, grid.cells.map((c) => ({ etaFirst: c.z * ETA_PER_CELL, n: ETA_PER_CELL, inRange: c.inRange })));
  assert.equal(page.length, GRID.cells);
  for (const runs of page) assert.equal(runs.reduce((s, r) => s + r.count, 0), ETA_PER_CELL);
  // and the first Helion of each cell agrees with the clock at the cell's start
  for (const [i, c] of grid.cells.entries()) {
    const p = model.pentadAt(c.start + 0.002);
    assert.deepEqual([page[i][0].sync, page[i][0].index], [p.sync, p.index], `cell ${i}`);
  }
});

test('days: each local day names the Pentads that begin in it, at their time of day', () => {
  const t0 = Date.UTC(2026, 9, 1) / 1000;
  const t1 = Date.UTC(2026, 10, 1) / 1000;
  const list = pentadsIn(model, t0, t1);
  let from = 0;
  let total = 0;
  for (let d = t0; d < t1; d += 86400) {
    const { starts, next } = pentadStartsIn(list, d, d + 86400, from);
    from = next;
    total += starts.length;
    for (const p of starts) {
      assert.ok(p.start >= d && p.start < d + 86400);
      assert.ok(p.x >= 0 && p.x < 1);
      assert.ok(Math.abs(p.x - (p.start - d) / 86400) < 1e-12);
    }
  }
  assert.equal(total, list.filter((p) => p.start >= t0).length, 'every Pentad begins on exactly one day');
  // the day of vector A begins Pentad II, a quarter Helion later in the day than the day before began Pentad I
  const day = Date.UTC(2026, 9, 8) / 1000;
  const today = pentadStartsIn(list, day, day + 86400).starts;
  const yesterday = pentadStartsIn(list, day - 86400, day).starts;
  assert.deepEqual(today.map((p) => p.index), [1]);
  assert.deepEqual(yesterday.map((p) => p.index), [0]);
  const quarter = model.levelInfo(6).meanSeconds / 4;
  assert.ok(Math.abs(today[0].start - yesterday[0].start - 86400 - quarter) < 60);
  assert.deepEqual(pentadsOfSpan(model, day, day + 86400).map((p) => p.index), [0, 1]);
});

test('the month grid: Pentad starts per cell and a Pentad band', () => {
  assert.ok(OVERLAYS.some((o) => o.id === 'pentad' && o.level === null));
  const g = buildMonth(model, utc, { year: 2026, month: 10, weekStart: 1, overlay: 'pentad' });
  const inMonth = g.cells.filter((c) => c.inMonth);
  // about one Pentad a day: 31 days, 4 Pentads every 4 days
  const starts = inMonth.reduce((s, c) => s + c.pentads.length, 0);
  assert.ok(starts >= 29 && starts <= 33, `starts ${starts}`);
  const eighth = inMonth[7];
  assert.equal(eighth.day, 8);
  assert.deepEqual(eighth.pentads.map((p) => p.index), [1]);
  // the band: Pentad segments tile the days, the Hypopentad shorter
  const segs = eighth.segments;
  assert.ok(segs.every((s) => s.kind === 'pentad'));
  assert.deepEqual(segs.map((s) => s.label), ['Pentad I', 'Pentad II']);
  const hypo = g.items.find((p) => p.index === 3);
  const one = g.items.find((p) => p.index === 0 && p.start > g.start);
  assert.ok(hypo.end - hypo.start < one.end - one.start - 4 * 3600, 'the Hypopentad is a Helion shorter');
  // other overlays keep their bands and still carry the Pentad starts
  const e = buildMonth(model, utc, { year: 2026, month: 10, weekStart: 1, overlay: 4 });
  assert.ok(e.cells[10].segments.every((s) => s.kind === 'cycle'));
  assert.deepEqual(e.cells.map((c) => c.pentads.length), g.cells.map((c) => c.pentads.length));
  // outside the catalogue: no Pentads
  const before = buildMonth(model, utc, { year: 1613, month: 1, weekStart: 1, overlay: 'pentad' });
  assert.ok(before.cells.filter((c) => !c.inRange).every((c) => c.pentads.length === 0));
});

test('a sync has its four Pentads', () => {
  const ps = syncPentads(model, 4820);
  assert.deepEqual(ps.map((p) => [p.index, p.helions]), [[0, 5], [1, 5], [2, 5], [3, 4]]);
  const s = model.solarSyncByNumber(4820);
  assert.equal(ps[0].start, s.start);
  assert.equal(ps[3].end, s.end);
  assert.deepEqual(syncPentads(model, -100000), [], "before the catalogue (syncs before the anchor exist back to 1613)");
});
