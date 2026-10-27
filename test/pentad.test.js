import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import {
  PENTAD_HELIONS, DAY_HELIONS, pentadName, pentadAscii, pentadSpoken, shapePoints, shapePath, pentadShapeSVG, pentadMarkHTML,
  leadHTML, leadText, drawPentadMark, pentadsIn, pentadStep, pentadLookup, pentadChart,
} from '../src/ui/pentad.js';

const model = createModel();
const A = 1791460800; // SPEC vector A: Pentad II, 2nd Helion of sync 4820

test('names: full, ASCII and spoken', () => {
  assert.deepEqual([0, 1, 2, 3].map(pentadName), ['Pentad I', 'Pentad II', 'Pentad III', 'Hypopentad']);
  assert.deepEqual([0, 1, 2, 3].map(pentadAscii), ['P1', 'P2', 'P3', 'H']);
  assert.equal(pentadName(7), '');
  assert.equal(pentadName(null), '');
  const p = model.pentadAt(A);
  assert.equal(pentadName(p), 'Pentad II');
  assert.equal(pentadSpoken(p, { helion: true }), 'Pentad II, 2nd Helion');
  assert.equal(pentadSpoken(p), 'Pentad II');
});

test('shapes: the side count is the Helion count', () => {
  for (let i = 0; i < 4; i++) assert.equal(shapePoints(i).length, PENTAD_HELIONS[i]);
  // the pentagon stands on its base: apex on top, centred, inside the 12-unit box
  const pts = shapePoints(0);
  assert.ok(Math.abs(pts[0][0] - 6) < 1e-9 && pts[0][1] < 2);
  for (const [x, y] of [...pts, ...shapePoints(3)]) assert.ok(x >= 0 && x <= 12 && y >= 0 && y <= 12);
  assert.match(shapePath(0), /^M[\d. L]+Z$/);
  assert.equal((shapePath(3).match(/L/g) ?? []).length, 3);
  assert.match(pentadShapeSVG(1), /aria-hidden="true"/);
  assert.match(pentadShapeSVG(1), /stroke="currentColor"/);
  assert.equal(pentadShapeSVG(9), '');
});

test('the mark: shape + numeral, the Hypopentad its square alone, named for screen readers', () => {
  const two = pentadMarkHTML(1);
  assert.match(two, /role="img"/);
  assert.match(two, /aria-label="Pentad II"/);
  assert.match(two, /<span class="pentad-num">II<\/span>/);
  assert.doesNotMatch(two, /⬠/, 'never the ⬠ character in HTML');
  const hypo = pentadMarkHTML(3);
  assert.match(hypo, /aria-label="Hypopentad"/);
  assert.match(hypo, /is-hypo/);
  assert.doesNotMatch(hypo, /pentad-num/);
  assert.doesNotMatch(pentadMarkHTML(0, { numeral: false }), /pentad-num/);
  const withHelion = pentadMarkHTML(model.pentadAt(A), { helion: true, title: true });
  assert.match(withHelion, /aria-label="Pentad II, 2nd Helion"/);
  assert.match(withHelion, /title="Pentad II, 2nd Helion"/);
  assert.match(withHelion, /pentad-hel">·2</);
  assert.equal(pentadMarkHTML(5), '');
});

test('leading a reading: HTML and plain text', () => {
  const html = leadHTML(model, A, '44η 15ι');
  assert.match(html, /^<span class="pentad-lead"><span class="pentad-mark[^"]*" role="img" aria-label="Pentad II"/);
  assert.match(html, /<span class="pentad-rest">44η 15ι<\/span><\/span>$/);
  assert.equal(leadHTML(model, model.tMin - 10, 'x'), 'x', 'outside the catalogue the reading stands alone');
  assert.equal(leadText(model, A, 'δ#4 ε#1 44η 15ι'), 'Pentad II · δ#4 ε#1 44η 15ι');
  assert.equal(leadText(model, A, '44η 15ι', { form: 'ascii' }), 'P2 44η 15ι');
  assert.equal(leadText(model, A, '44η 15ι', { form: 'short' }), '⬠II 44η 15ι');
  assert.equal(leadText(model, A, ''), 'Pentad II');
  assert.equal(leadText(model, model.tMax + 10, 'x'), 'x');
});

test('canvas: the mark draws its shape and numeral and reports its width', () => {
  const calls = [];
  const g = {
    font: '10px sans-serif',
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo: (x, y) => calls.push(['M', x, y]),
    lineTo: (x, y) => calls.push(['L', x, y]),
    stroke: () => calls.push(['stroke']),
    fillText: (s) => calls.push(['text', s]),
    measureText: (s) => ({ width: s.length * 6 }),
  };
  const w = drawPentadMark(g, 2, 10, 20, { size: 12 });
  assert.equal(calls.filter((c) => c[0] === 'L').length, 4, 'a pentagon');
  assert.deepEqual(calls.at(-1), ['text', 'III']);
  assert.ok(w > 12 + 18 - 1e-9);
  calls.length = 0;
  const wh = drawPentadMark(g, 3, 0, 0, { size: 12 });
  assert.equal(calls.filter((c) => c[0] === 'L').length, 3, 'a square');
  assert.ok(!calls.some((c) => c[0] === 'text'), 'the Hypopentad has no numeral');
  assert.equal(wh, 12);
  calls.length = 0;
  assert.equal(drawPentadMark(g, 0, 0, 0, { size: 12, measure: true }), w - 12);
  assert.equal(calls.length, 0, 'measure draws nothing');
});

test('spans: the Pentads in a window follow on, each about a day', () => {
  const list = pentadsIn(model, A - 3 * 86400, A + 3 * 86400);
  assert.ok(list.length >= 6 && list.length <= 8, `count ${list.length}`);
  for (let i = 1; i < list.length; i++) {
    assert.equal(list[i].start, list[i - 1].end, 'they tile time');
    const prev = list[i - 1];
    assert.equal(list[i].index, (prev.index + 1) % 4);
    assert.equal(list[i].sync, prev.index === 3 ? prev.sync + 1 : prev.sync);
  }
  const helion = model.levelInfo(6).meanSeconds;
  for (const p of list) assert.ok(Math.abs(p.end - p.start - p.helions * helion) < 60);
  assert.ok(list[0].start <= A - 3 * 86400 && list.at(-1).end >= A + 3 * 86400);
  // the step helpers
  const cur = model.pentadAt(A);
  const next = pentadStep(model, cur, 1);
  assert.deepEqual([next.sync, next.index], [4820, 2]);
  const back = pentadStep(model, { sync: 4820, index: 0 }, -1);
  assert.deepEqual([back.sync, back.index, back.helions], [4819, 3, 4]);
  // at the catalogue edges: cut, and nothing outside
  assert.deepEqual(pentadsIn(model, model.tMin - 100, model.tMin - 1), []);
  assert.equal(pentadsIn(model, model.tMin - 100, model.tMin + 10)[0].start, model.tMin);
  assert.equal(pentadsIn(model, A, A).length, 0);
});

test('lookup: the same answers as the model, from cached spans', () => {
  const at = pentadLookup(model);
  const helion = model.levelInfo(6).meanSeconds;
  for (let k = -40; k <= 40; k++) {
    const t = A + k * helion * 0.37 + 11;
    const want = model.pentadAt(t);
    const got = at(t);
    assert.deepEqual([got.sync, got.index, got.helion, got.start, got.end], [want.sync, want.index, want.helion, want.start, want.end], `t ${t}`);
  }
  assert.equal(at(model.tMin - 5), null);
  assert.equal(at(NaN), null);
});

test('chart: four day rows, each Pentad a quarter Helion later, the Hypopentad ends on the day', () => {
  const c = pentadChart(model, A);
  assert.equal(c.sync, 4820);
  assert.deepEqual(c.rows.map((r) => r.helions), [5, 5, 5, 4]);
  assert.deepEqual(c.rows.map((r) => r.offset), [0, 0.25, 0.5, 0.75]);
  assert.equal(c.day, DAY_HELIONS);
  // every row's end against the solar day: ¼, ½, ¾ Helion past it, then exactly on it
  assert.deepEqual(c.rows.map((r) => r.offset + r.helions - c.day), [0.25, 0.5, 0.75, 0]);
  const cells = c.rows.flatMap((r) => r.cells);
  assert.deepEqual(cells.map((x) => x.k), [...Array(19).keys()]);
  assert.deepEqual(cells.map((x) => x.state).join(''), ['past', 'past', 'past', 'past', 'past', 'past', 'now', ...Array(12).fill('next')].join(''));
  assert.equal(c.now.row, 1);
  assert.ok(c.now.x > 1.25 && c.now.x < 2.25, `now x ${c.now.x}`);
  assert.ok(c.phase >= 0 && c.phase < 1);
  // the rows' times are the model's Pentads, and each starts about a day and a quarter Helion after the one before
  const helion = model.levelInfo(6).meanSeconds;
  for (let i = 1; i < 4; i++) {
    assert.equal(c.rows[i].start, c.rows[i - 1].end);
    assert.ok(Math.abs(c.rows[i].start - c.rows[0].start - i * 86400 - (i * helion) / 4) < 60);
  }
  assert.equal(pentadChart(model, model.tMax + 1), null);
});
