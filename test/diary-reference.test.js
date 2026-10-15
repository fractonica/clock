import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createPure } from '../src/core/pure.js';
import { deltaAt, deltaPath, deltaRange } from '../src/diary/plan.js';
import { ladderOf, milestonesOf, periodText, frequencyText, bigText, sci, bandOf, LADDER_LEVELS, PLANCK_TIME } from '../src/diary/reference.js';

globalThis.Path2D ??= class {};
const model = createModel();
const pure = createPure(model);
const A = 1791460800; // SPEC vector A
const S = [5, 13, 5, 5, 7, 11, 9, 4];

test('numbers: SI prefixes, calendar units, scientific notation past the prefixes', () => {
  assert.equal(frequencyText(5.55e12), '5.55 THz');
  assert.equal(frequencyText(999.7e9), '1.00 THz', 'rounding moves up a prefix');
  assert.equal(frequencyText(3.216), '3.22 Hz');
  assert.equal(frequencyText(248.3), '248 Hz');
  assert.equal(frequencyText(8.15e23), '815 ZHz');
  assert.equal(frequencyText(3.67e30), '3.67 × 10³⁰ Hz', 'past yotta');
  assert.equal(periodText(2.2759e9), '72.1 y');
  assert.equal(periodText(81.06 * 86400), '81.1 d');
  assert.equal(periodText(5.052 * 3600), '5.05 h');
  assert.equal(periodText(505.25), '8.42 min');
  assert.equal(periodText(7.773), '7.77 s');
  assert.equal(periodText(0.31092), '311 ms');
  assert.equal(periodText(1.79e-13), '179 fs');
  assert.equal(periodText(4.833e-43), '4.83 × 10⁻⁴³ s');
  assert.equal(sci(9.996e5), '1.00 × 10⁶');
  assert.equal(bigText(125125n), '125\u202f125');
  assert.equal(bigText(7319812500n), '7\u202f319\u202f812\u202f500', 'narrow no-break spaces: a number never wraps');
  assert.equal(bigText(20291000000000n), '2.03 × 10¹³');
  assert.equal(bandOf(10), null);
  assert.equal(bandOf(248).name, 'audible');
  assert.equal(bandOf(4.57e14).name, 'visible');
  assert.ok(Math.abs(bandOf(4.57e14).nm - 656) < 1);
  assert.equal(bandOf(1e30), null, 'past the most energetic photons observed');
});

test('ladder: 63 levels derived from the factor sequence, lengths in the eclipse interval of the moment', () => {
  const L = ladderOf(model, A);
  assert.equal(L.rows.length, LADDER_LEVELS);
  assert.equal(LADDER_LEVELS, 63);
  assert.equal(L.interval.k, 22, 'vector A lies between eclipses #22 and #23');
  assert.equal(L.interval.seconds, model.catalogue[23] - model.catalogue[22]);
  let P = 1n;
  for (const r of L.rows) {
    if (r.level) P *= BigInt(S[(r.level - 1) % 8]);
    assert.equal(r.prefix, P, `P(${r.level}) = P(L−1) · S[(L−1) mod 8]`);
    assert.equal(r.siblings, r.level ? S[(r.level - 1) % 8] : null);
    assert.equal(r.depth, r.level + 1);
    assert.ok(Math.abs(r.seconds - (4 * L.interval.seconds) / Number(P)) <= 1e-12 * r.seconds);
    // Blinks: exact counts down to the Blink, exact rates below it
    if (r.level <= 12) assert.equal(r.blinks * r.prefix, 7319812500n);
    if (r.level >= 12) assert.equal(r.perBlink * 7319812500n, r.prefix);
  }
  assert.deepEqual(L.rows.filter((r) => r.unit).map((r) => [r.level, r.unit]), [[0, 'Alpha'], [1, 'Beta'], [2, 'Gamma'], [3, 'Delta'], [4, 'Nuclide'], [6, 'Helion'], [8, 'Preon'], [10, 'Flavon'], [12, 'Blink']]);
  assert.deepEqual(L.rows.slice(22, 26).map((r) => r.text), ['ψ', 'ω', 'α1', 'β1'], 'letters repeat with a suffix after ω');
  assert.equal(periodText(L.rows[6].seconds), '5.05 h');
  assert.equal(periodText(L.rows[12].seconds), '311 ms');
  assert.equal(frequencyText(L.rows[29].hz), '457 THz');
  assert.equal(bandOf(L.rows[29].hz).name, 'visible');
  // the level after the ladder is the Planck time
  assert.equal(L.next.level, 63);
  assert.equal(L.next.text, 'π2');
  assert.ok(Math.abs(L.next.seconds / PLANCK_TIME - 1) < 0.01, `${L.next.seconds} s`);
});

test('milestones: the Alpha of vector A, its eclipses on the quarters and the diagonal through Betas and Gammas', () => {
  const path = deltaPath(model, deltaAt(model, A));
  const M = milestonesOf({ model, pure, path });
  assert.equal(M.alpha.name, 'Alpha Hexafracton');
  assert.deepEqual(M.alpha.thresholds.map((x) => x.event), ['begin', 'peak', 'node', 'valley', 'end']);
  M.alpha.thresholds.forEach((x, q) => {
    assert.equal(x.eclipse, 20 + q);
    assert.ok(Math.abs(x.t - model.catalogue[20 + q]) < 0.01, 'at the greatest eclipse');
  });
  assert.deepEqual(M.alpha.thresholds.map((x) => x.also.map((a) => `${a.name} ${a.event}`).join(' · ')), [
    'Beta Monofracton begin · Gamma Monofracton begin',
    'Beta Difracton peak · Gamma Tetrafracton peak',
    'Beta Trifracton node · Gamma Heptafracton node',
    'Beta Tetrafracton valley · Gamma Decafracton valley',
    'Beta Pentafracton end · Gamma Tridecafracton end',
  ]);
  assert.deepEqual(M.eclipses.map((e) => e.k), [20, 21, 22, 23, 24]);
  // Betas: eclipse b on threshold b of Beta b
  const EV = ['begin', 'peak', 'node', 'valley', 'end'];
  M.betas.forEach((b, i) => {
    const hits = b.thresholds.filter((x) => x.eclipse !== null);
    assert.deepEqual(hits.map((x) => [x.event, x.eclipse]), [[EV[i], 20 + i]], b.name);
    assert.equal(b.current, i === 3, 'this diary is in Beta Tetrafracton');
  });
  // Gammas: 13 × 5, contiguous, one eclipse per Beta on Gamma 1, 4, 7, 10, 13
  const flat = M.gammas.flat();
  assert.equal(flat.length, 65);
  for (let i = 1; i < 65; i++) assert.ok(Math.abs(flat[i].t0 - flat[i - 1].t1) < 1e-3);
  assert.ok(Math.abs(flat[0].t0 - M.alpha.t0) < 1e-3 && Math.abs(flat[64].t1 - M.alpha.t1) < 1e-3);
  assert.deepEqual(flat.filter((g) => g.eclipse).map((g) => [g.beta, g.ord, g.eclipse.k, g.eclipse.event]), [[1, 1, 20, 'begin'], [2, 4, 21, 'peak'], [3, 7, 22, 'node'], [4, 10, 23, 'valley'], [5, 13, 24, 'end']]);
  assert.deepEqual(flat.filter((g) => g.current).map((g) => g.name), ['Gamma Nonafracton']);
});

test('milestones of the first and the last Alpha of the catalogue', () => {
  const { first, last } = deltaRange(model);
  const M0 = milestonesOf({ model, pure, path: deltaPath(model, first) });
  assert.equal(M0.alpha.thresholds[0].eclipse, 0);
  const M1 = milestonesOf({ model, pure, path: deltaPath(model, last) });
  // the catalogue ends at eclipse #69: the last Alpha's later thresholds have no time and no eclipse
  for (const th of M1.alpha.thresholds) if (th.t === null) assert.equal(th.eclipse, null);
  assert.ok(M1.eclipses.every((e) => e.k <= model.extent));
  assert.ok(M1.gammas.flat().some((g) => g.current));
});
