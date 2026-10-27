import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createPure } from '../src/core/pure.js';
import { parseJump, stripPentad } from '../src/ui/calendar/parse.js';
import { parsePure } from '../src/ui/calendar/pure-parse.js';

// A date leads with its Pentad as a civil date with its weekday (SPEC §7.5, §15.3); the jump boxes read past it.
const model = createModel();
const pure = createPure(model);
const A = 1791460800; // SPEC vector A: Pentad II of sync 4820
const earth = (s) => parseJump(s, { model, now: A, real: A, zone: 'UTC' });
const pureBox = (s) => parsePure(s, { model, pure, now: A, real: A });
const first = (cs) => cs.map((c) => [c.kind, c.time])[0];

test('stripPentad reads every form of a leading Pentad', () => {
  const cases = [
    ['Pentad II · δ#3 ε#2 5η 5ι', 'Pentad II', 'δ#3 ε#2 5η 5ι'],
    ['pentad 3, sync 4820', 'pentad 3', 'sync 4820'],
    ['Hypopentad α#6 β#3', 'Hypopentad', 'α#6 β#3'],
    ['Pentad II, 3rd Helion · 34η 29ι', 'Pentad II, 3rd Helion', '34η 29ι'],
    ['⬠II 34η 29ι', '⬠II', '34η 29ι'],
    ['⬠II·3 34η', '⬠II·3', '34η'],
    ['◻ sync 4820', '◻', 'sync 4820'],
    ['P2 · +3d', 'P2', '+3d'],
    ['P2.3 δ#3', 'P2.3', 'δ#3'],
    ['H · δ#3', 'H', 'δ#3'],
    ['H.2 δ#3', 'H.2', 'δ#3'],
  ];
  for (const [text, pentad, rest] of cases) assert.deepEqual(stripPentad(text), { pentad, rest }, text);
  // not a Pentad: a position, a word that only starts like one, a bare H before a count
  for (const text of ['p2', 'p2.3', 'p2.9278', 'pentad iota', 'h 5', 'Pentad IV · sync 4820', 'δ#3 ε#2']) {
    assert.deepEqual(stripPentad(text), { pentad: '', rest: text }, text);
  }
});

test('both jump boxes read past a leading Pentad', () => {
  assert.deepEqual(first(pureBox('Pentad II · δ#3 ε#2 5η 5ι')), first(pureBox('δ#3 ε#2 5η 5ι')));
  assert.deepEqual(first(pureBox('⬠II 34η 29ι')), first(pureBox('34η 29ι')));
  assert.deepEqual(first(pureBox('Hypopentad α#6 β#4 γ#9 δ#3 ε#5 34η 29ι')), first(pureBox('α#6 β#4 γ#9 δ#3 ε#5 34η 29ι')));
  assert.deepEqual(first(earth('Pentad II · 2031-06-01 14:30')), first(earth('2031-06-01 14:30')));
  assert.deepEqual(first(earth('P2 · sync 4820')), first(earth('sync 4820')));
  assert.equal(first(earth('p2'))[0], 'position', '"p2" stays a Saros position');
});

test('a Pentad alone is answered, not read', () => {
  for (const box of [earth, pureBox]) {
    const [c] = box('Pentad II');
    assert.equal(c.kind, 'error');
    assert.match(c.label, /A Pentad names a day of the solar sync/);
    assert.match(c.detail, /Pentad II · /);
  }
});
