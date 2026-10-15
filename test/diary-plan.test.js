import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createPure } from '../src/core/pure.js';
import { sanitizeDiaryOptions, lockShape, paperSize, DIARY_DEFAULTS } from '../src/diary/options.js';
import { planDiary, deltaAt, deltaRange, deltaPath, deltaFromPath, gregorianDays } from '../src/diary/plan.js';

globalThis.Path2D ??= class {};
const model = createModel();
const pure = createPure(model);
const A = 1791460800; // SPEC vector A
const opts = sanitizeDiaryOptions({});
const delta = deltaAt(model, A);
const plan = planDiary({ model, pure, opts, delta, zone: 'Europe/Berlin' });

test('options: defaults, clamping, pure mode', () => {
  assert.deepEqual(opts.lock.sheets, [[3, 2], [3, 2], [3, 2], [2, 2]]);
  assert.deepEqual(lockShape(opts), { perLock: 19, locks: 4, retro: 1 }, '4 × 19 + 1 = 77');
  const o = sanitizeDiaryOptions({ page: { size: 'custom', width: 5000, height: 'x' }, lined: { linesPerHelion: 0 }, canvases: [{ type: 'grid', cols: 0 }], nope: 1 });
  assert.equal(o.page.width, 420);
  assert.equal(o.page.height, DIARY_DEFAULTS.page.height);
  assert.equal(o.lined.linesPerHelion, 1);
  assert.equal(o.canvases[0].cols, 1);
  assert.equal('nope' in o, false);
  const p = sanitizeDiaryOptions({ gregorian: { on: true } }, { pure: true });
  assert.equal(p.gregorian.on, false, 'pure mode: no Gregorian');
  assert.equal(p.front.gregorianIndex, false);
  assert.deepEqual(lockShape(sanitizeDiaryOptions({ lock: { sheets: [[3, 2]] } })), { perLock: 5, locks: 15, retro: 2 });
  assert.deepEqual(sanitizeDiaryOptions({ page: { size: 'A4' } }).page.width, 210);
  assert.deepEqual(opts.canvases, [{ type: 'grid', cols: 19, rows: 13 }, { type: 'blank' }]);
  assert.deepEqual(opts.retro.canvases, [{ type: 'blank' }, { type: 'dots', count: 385 }]);
  assert.equal(opts.front.reference, true, 'the reference sheet is in by default');
  assert.equal(sanitizeDiaryOptions({ front: { reference: 'yes' } }).front.reference, true, 'non-booleans keep the default');
  // two pages per sheet: two A5 pages make one A4 landscape page exactly
  assert.deepEqual(paperSize(sanitizeDiaryOptions({ print: { twoUp: true } })), { width: 297, height: 210, name: 'A4', twoUp: true, cell: 148.5 });
  assert.equal(paperSize(sanitizeDiaryOptions({ page: { size: 'A6' }, print: { twoUp: true } })).name, 'A5');
  assert.equal(paperSize(sanitizeDiaryOptions({ page: { size: 'Half Letter' }, print: { twoUp: true } })).name, 'Letter');
  assert.deepEqual(paperSize(opts), { width: 148, height: 210, name: null, twoUp: false, cell: 148 });
});

test('Deltas: range, the Delta of a moment, paths both ways', () => {
  const { first, last } = deltaRange(model);
  assert.equal(first, 0);
  assert.equal(model.cycleByIndex(3, last).clipped, false);
  assert.deepEqual(deltaPath(model, delta), [6, 4, 9, 3], 'SPEC vector A: Delta Trifracton of Gamma Nonafracton …');
  assert.equal(deltaFromPath(model, [6, 4, 9, 3]), delta);
  for (const i of [0, 1, 777, last]) assert.equal(deltaFromPath(model, deltaPath(model, i)), i);
  assert.equal(deltaFromPath(model, [18, 5, 13, 5]), null, 'beyond the catalogue');
  assert.equal(plan.delta.name, 'Delta Trifracton');
  assert.deepEqual(plan.delta.words, ['Alpha Hexafracton', 'Beta Tetrafracton', 'Gamma Nonafracton', 'Delta Trifracton']);
});

test('every Helion of the Delta is mapped, in order, with its quarter ticks', () => {
  assert.equal(plan.helions.length, 385);
  for (const h of plan.helions) {
    assert.ok(h.page !== null, `Helion ${h.d} has a page`);
    assert.equal(h.n * 77 + h.h, h.d);
    if (h.d) assert.ok(Math.abs(h.t0 - plan.helions[h.d - 1].t1) < 1e-3, 'contiguous');
    assert.deepEqual(h.ticks.map((x) => x.name), ['begin', 'peak', 'node', 'valley', 'end']);
    for (const [i, x] of h.ticks.entries()) assert.ok(Math.abs(x.frac - i / 4) < 1e-6);
  }
  assert.ok(Math.abs(plan.helions[0].t0 - plan.delta.t0) < 1e-3 && Math.abs(plan.helions[384].t1 - plan.delta.t1) < 1e-3);
  // a lock Helion is on exactly one page; the retro Helion on its lined page and its canvas pages
  const on = new Map();
  for (const p of plan.pages) for (const s of p.sections ?? []) on.set(s.d, (on.get(s.d) ?? 0) + 1);
  for (const h of plan.helions) assert.equal(on.get(h.d), h.lock === null ? 1 + opts.retro.canvases.length : 1, `Helion ${h.d}`);
  assert.deepEqual(plan.nuclides.map((n) => n.retro.map((d) => plan.helions[d].label)), [['77η'], ['77η'], ['77η'], ['77η'], ['77η']], 'the 77th Helion, numbered from 1');
  assert.equal(plan.helions[0].label, '1η');
  assert.equal(plan.helions[0].alpha, (plan.helions[0].cycle % 125125) + 1);
  assert.ok(plan.helions.every((h, i) => !i || h.alpha === plan.helions[i - 1].alpha + 1 || h.alpha === 1), 'the Alpha number runs on');
  for (const nu of plan.nuclides) assert.deepEqual(nu.locks.map((l) => l.helions.length), [19, 19, 19, 19]);
});

test('sheets: fronts are rectos, headers versos, the diary ends on a verso', () => {
  assert.equal(plan.pages.length % 2, 0);
  plan.pages.forEach((p, i) => {
    assert.equal(p.no, i + 1);
    assert.equal(p.side, p.no % 2 ? 'recto' : 'verso');
  });
  for (const p of plan.pages.filter((x) => x.kind === 'lined')) assert.equal(p.side, 'recto', `lined page ${p.no}`);
  for (const p of plan.pages.filter((x) => x.kind === 'nuclide')) assert.equal(p.side, 'verso');
  for (const p of plan.pages.filter((x) => x.kind === 'insert')) assert.equal(p.side, 'recto');
  assert.equal(plan.pages.find((p) => p.kind === 'summary').side, 'recto');
  // a sheet: the lined front, then its canvas back on the next page
  for (const p of plan.pages.filter((x) => x.kind === 'lined' && !x.retro)) {
    const back = plan.pages[p.no];
    assert.equal(back.kind, 'canvas');
    assert.equal(back.sections[0].d, p.sections.at(-1).d + 1, 'the back continues where the front ends');
  }
  const counts = plan.pages.reduce((a, p) => ((a[p.kind] = (a[p.kind] ?? 0) + 1), a), {});
  assert.equal(counts.lined, 5 * (4 * 4 + 1), 'four fronts per lock and one retro page per Nuclide');
  assert.equal(counts.nuclide, 5);
  assert.equal(counts.summary, 4);
  // front matter in the owner's order, the reference sheet after the ephemeris
  const order = plan.pages.slice(0, 14).map((p) => p.kind).filter((k, i, a) => k !== 'notes' && a.indexOf(k) === i);
  assert.deepEqual(order.slice(0, 8), ['index', 'gregorian', 'ephemeris', 'ladder', 'milestones', 'planning', 'predictions', 'nuclide']);
});

test('the reference sheet: one leaf, the period ladder on its front and the milestones on its back', () => {
  const lad = plan.pages.find((p) => p.kind === 'ladder');
  const mil = plan.pages.find((p) => p.kind === 'milestones');
  assert.equal(lad.side, 'recto');
  assert.equal(mil.no, lad.no + 1, 'the back of the same sheet');
  assert.equal(plan.reference.ladderPage, lad.no);
  assert.equal(plan.reference.milestonesPage, mil.no);
  assert.equal(plan.reference.ladder.rows.length, 63);
  assert.deepEqual(plan.reference.milestones.alpha.thresholds.map((x) => x.eclipse), [20, 21, 22, 23, 24]);
  const secs = plan.index.filter((r) => r.kind === 'section').map((r) => [r.key, r.page]);
  assert.deepEqual(secs.filter(([k]) => k === 'ladder' || k === 'milestones'), [['ladder', lad.no], ['milestones', mil.no]], 'listed in the index');
  for (const o of [{ front: { reference: false } }, { front: { reference: false, ephemeris: false } }]) {
    const p = planDiary({ model, pure, opts: sanitizeDiaryOptions(o), delta, zone: 'UTC' });
    assert.equal(p.reference, null);
    assert.ok(!p.pages.some((x) => x.kind === 'ladder' || x.kind === 'milestones'));
  }
  const pp = planDiary({ model, pure, opts: sanitizeDiaryOptions({ front: { ephemeris: false } }, { pure: true }), delta, zone: 'UTC' });
  const l2 = pp.pages.find((p) => p.kind === 'ladder');
  assert.equal(l2.side, 'recto');
  assert.equal(pp.pages[l2.no].kind, 'milestones');
});

test('major thresholds and the Delta inserts', () => {
  const names = plan.majors.map((m) => `${m.name} ${m.event}`);
  for (const q of ['peak', 'node', 'valley']) assert.ok(names.includes(`Delta Trifracton ${q}`));
  assert.ok(names.includes('Gamma Nonafracton node'), 'the Gamma node falls inside this Delta');
  assert.equal(plan.majors.find((m) => m.event === 'peak' && m.level === 3).quarter, 'Peak');
  assert.equal(plan.inserts.length, 3);
  for (const ins of plan.inserts) {
    const page = plan.pages[ins.page - 1];
    assert.equal(page.kind, 'insert');
    // the insert comes just before the lock that holds the threshold (after its back page)
    const lock = plan.nuclides[ins.nuclide].locks[ins.lock];
    assert.equal(lock.firstPage, ins.page + 2);
    assert.ok(ins.major.t >= lock.t0 && ins.major.t < lock.t1);
  }
});

test('events attach to their Helion and page; solar syncs and majors are ticks', () => {
  const t = plan.helions[100].t0 + 0.4 * (plan.helions[100].t1 - plan.helions[100].t0);
  const p = planDiary({ model, pure, opts, delta, zone: 'UTC', events: [{ t, family: 'synodic', name: 'full-moon' }, { t: plan.delta.t1 + 10, family: 'synodic', name: 'new-moon' }] });
  const e = p.events.find((x) => x.family === 'synodic');
  assert.equal(e.d, 100);
  assert.ok(Math.abs(e.frac - 0.4) < 1e-6);
  assert.equal(e.page, p.helions[100].page);
  assert.equal(p.events.filter((x) => x.family === 'synodic').length, 1, 'events outside the Delta are dropped');
  const syncs = p.events.filter((x) => x.family === 'sync');
  assert.ok(syncs.length >= 19 && syncs.length <= 21, `about 81 / 4 syncs, got ${syncs.length}`);
  for (const s of syncs) assert.equal(model.solarAt(s.t + 1).sync, s.sync);
  assert.ok(p.events.some((x) => x.family === 'major' && x.major.name === 'Delta Trifracton'));
  assert.ok(p.pages.filter((x) => x.kind === 'ephemeris').every((x) => x.rows.every((r) => r.family !== 'sync')));
});

test('Gregorian days and the index', () => {
  const days = gregorianDays(plan.delta.t0, plan.delta.t1, 'Europe/Berlin');
  assert.equal(days.length, plan.days.length);
  assert.ok(days[0].t0 <= plan.delta.t0 && days.at(-1).t1 >= plan.delta.t1);
  for (let i = 1; i < plan.days.length; i++) assert.ok(plan.days[i].page >= plan.days[i - 1].page);
  assert.ok(plan.months.length >= 3);
  const kinds = new Set(plan.index.map((r) => r.kind));
  for (const k of ['delta-begin', 'major', 'delta-end', 'nuclide', 'lock', 'retro', 'insert', 'section']) assert.ok(kinds.has(k), k);
  assert.ok(plan.index.filter((r) => r.kind !== 'delta-end').every((r) => Number.isInteger(r.page)));
  const idx = plan.pages.filter((p) => p.kind === 'index').flatMap((p) => p.rows);
  assert.equal(idx.length, plan.index.length, 'every row is printed');
  // pure mode: no Gregorian pages or days
  const pp = planDiary({ model, pure, opts: sanitizeDiaryOptions({}, { pure: true }), delta, zone: 'UTC' });
  assert.equal(pp.days.length, 0);
  assert.equal(pp.pages.some((p) => p.kind === 'gregorian'), false);
});

test('other lock patterns and options still give a valid book', () => {
  for (const o of [
    { lock: { sheets: [[3, 2]] } },
    { lock: { sheets: [[4, 4], [4, 4], [3, 0]] }, inserts: { deltaQuarters: false }, front: { cover: true, planning: 3 } },
    { retro: { canvases: [{ type: 'blank' }] }, closing: { summaryPages: 3 } },
  ]) {
    const so = sanitizeDiaryOptions(o);
    const p = planDiary({ model, pure, opts: so, delta: 0, zone: 'UTC' });
    assert.equal(p.pages.length % 2, 0);
    assert.ok(p.helions.every((h) => h.page !== null));
    assert.ok(p.pages.filter((x) => x.kind === 'lined').every((x) => x.side === 'recto'));
    const { retro } = lockShape(so);
    assert.equal(p.nuclides[0].retro.length, retro);
  }
});
