import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createPure } from '../src/core/pure.js';
import { journalReading, arcPoint, ordinal, clampUnit, MAX_UNIT, JOURNAL_UNITS } from '../src/ui/face/journal.js';
import { RULES } from '../tools/pure-scan.mjs';

const model = createModel();
const pure = createPure(model);
const A = 1791460800; // SPEC vector A: Delta Trifracton End ε#5 34η 29ι 21λ 3ν

test('minor units: the triplet in letters; the lead unit’s phase above and its cycle below', () => {
  const c = pure.clock(A);
  const r = journalReading({ model, pure }, A, 5);
  assert.deepEqual(r.levels, [6, 8, 10]);
  const two = (n) => String(n).padStart(2, '0');
  assert.deepEqual(r.tokens.map((x) => x.text), [`${two(c.eta)}η`, `${two(c.iota)}ι`, `${two(c.lambda)}λ`]);
  assert.deepEqual(r.tokens.map((x) => x.text), ['34η', '29ι', '21λ']);
  assert.equal(r.lead.letter, 'η');
  assert.ok(Math.abs(r.lead.phase - model.levelAt(A, 6).phase) < 1e-12);
  assert.deepEqual(journalReading({ model, pure }, A, 4).tokens.map((x) => x.text), ['ε#05', '34η', '29ι']);
  assert.equal(journalReading({ model, pure }, A, 4).lead.letter, 'ε', 'the Nuclide leads: its phase above and below');
  assert.ok(Math.abs(journalReading({ model, pure }, A, 4).lead.phase - model.levelAt(A, 4).phase) < 1e-12);
  assert.deepEqual(journalReading({ model, pure }, A, 6).tokens.map((x) => x.text), ['29ι', '21λ', '03ν']);
});

test('major periods: one at a time, in four lines, with its own 3-stroke state and cycle', () => {
  const r = journalReading({ model, pure }, A, 3);
  assert.equal(r.tokens, null);
  assert.deepEqual(r.levels, [3]);
  assert.deepEqual(r.major.lines, ['5th', 'Delta', 'Trifracton', 'End'], 'the 5th Nuclide of Delta Trifracton, End quarter');
  assert.equal(r.major.index3, model.levelAt(A, 3, { strokes: 3 }).index);
  assert.equal(r.lead.level, 3, 'the cycle at the bottom is its own');
  assert.ok(Math.abs(r.lead.phase - model.levelAt(A, 3).phase) < 1e-12);
  assert.deepEqual(journalReading({ model, pure }, A, 2).major.lines, ['3rd', 'Gamma', 'Nonafracton', 'Valley']);
  assert.deepEqual(journalReading({ model, pure }, A, 1).major.lines, ['9th', 'Beta', 'Tetrafracton', 'Valley']);
  assert.deepEqual(journalReading({ model, pure }, A, 0).major.lines, ['4th', 'Alpha', 'Hexafracton', 'Valley']);
  for (let u = 0; u <= 3; u++) {
    const m = journalReading({ model, pure }, A, u).major;
    assert.ok(m.index3 >= 0 && m.index3 < 52);
  }
});

test('every count in two digits: the reading keeps its width', () => {
  for (const t of [A, A + 777, A + 31337, A + 400000]) {
    for (const u of [4, 5, 6]) {
      const toks = journalReading({ model, pure }, t, u).tokens.map((x) => x.text);
      for (const x of toks) assert.match(x, /^(ε#\d{2}|\d{2}[ηιλν])$/, x);
    }
  }
});

test('units, ordinals, the cycle arcs', () => {
  assert.equal(MAX_UNIT, 6);
  assert.deepEqual(JOURNAL_UNITS.map(([L]) => L), [0, 1, 2, 3, 4, 6, 8, 10, 12]);
  assert.equal(clampUnit(-3), 0);
  assert.equal(clampUnit(99), 6);
  assert.equal(clampUnit(NaN), 5);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 77].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '77th']);
  // left arc descending (below the axis, y down), right arc ascending; ends and middle on the axis
  const g = { cl: 58, cr: 134, cy: 392, R: 38 };
  const p = (f) => arcPoint(f, g);
  assert.deepEqual([p(0).x, p(0).y], [20, 392]);
  assert.ok(Math.abs(p(0.25).y - (392 + 38)) < 1e-9 && Math.abs(p(0.25).x - 58) < 1e-9, 'the bottom of the left arc');
  assert.ok(Math.abs(p(0.5).x - 96) < 1e-9 && Math.abs(p(0.5).y - 392) < 1e-9);
  assert.ok(Math.abs(p(0.75).y - (392 - 38)) < 1e-9 && Math.abs(p(0.75).x - 134) < 1e-9, 'the top of the right arc');
  assert.ok(Math.abs(p(1).x - 172) < 1e-9);
  for (const f of [0.1, 0.3, 0.6, 0.9]) assert.ok(Math.abs(Math.hypot(p(f).nx, p(f).ny) - 1) < 1e-9, 'a unit normal');
});

test('pure mode: the readings say nothing Earth-ish', () => {
  const hits = [];
  for (let u = 0; u <= MAX_UNIT; u++) {
    const r = journalReading({ model, pure }, A, u);
    const texts = r.tokens ? r.tokens.map((x) => x.text) : r.major.lines;
    for (const s of texts) for (const [id, re, sev] of RULES) if (sev === 'hard' && re.test(s)) hits.push(`${u} ${id}: ${s}`);
  }
  assert.deepEqual(hits, []);
});
