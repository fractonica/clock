import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createPure, ordinalName, periodName, shortName, unitName, unitOf, UNITS, ORDINAL_NAMES } from '../src/core/pure.js';

const model = createModel();
const T = 1791460800;
const pure = createPure(model, { now: () => T });
const P12 = model.levelInfo(12).prefixNum;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);

test('names: Greek-prefixed ordinals and cycle names', () => {
  assert.equal(ordinalName(1), 'Monofracton');
  assert.equal(ordinalName(2), 'Difracton');
  assert.equal(ordinalName(11), 'Didecafracton');
  assert.equal(ordinalName(12), 'Dodecafracton');
  assert.equal(ordinalName(13), 'Tridecafracton');
  assert.equal(ordinalName(18), 'Octadecafracton');
  assert.equal(ordinalName(40), '#40');
  assert.equal(periodName(2, 2), 'Gamma Difracton');
  assert.equal(periodName(0, 6), 'Alpha Hexafracton');
  assert.equal(shortName(4, 5), 'ε#5');
  assert.ok(ORDINAL_NAMES.slice(1).every((n) => /fracton$/.test(n)), 'every ordinal ends in -fracton');
  assert.equal(new Set(ORDINAL_NAMES).size, ORDINAL_NAMES.length);
  // the hierarchy never needs more than 13 siblings, Alpha at most 18
  const maxSib = Math.max(...Array.from({ length: 14 }, (_, L) => model.levelInfo(L).siblings ?? 0));
  assert.equal(maxSib, 13);
  assert.equal(Number(model.clock.count(0)), 18);
  assert.ok(!ordinalName(18).startsWith('#') && !ordinalName(13).startsWith('#'));
});

test('unit ladder: one named unit per depth, whole cycles only', () => {
  const len = (id) => pure.unitPos(unitOf(id));
  const secs = (id) => pure.unitSeconds(unitOf(id));
  // the factors between neighbours (siblings of the finer level)
  const per = [['beta', 'gamma', 13], ['gamma', 'delta', 5], ['delta', 'epsilon', 5], ['epsilon', 'zeta', 7], ['zeta', 'eta', 11],
    ['eta', 'theta', 9], ['theta', 'iota', 4], ['iota', 'kappa', 5], ['kappa', 'lambda', 13], ['lambda', 'mu', 5], ['mu', 'nu', 5]];
  for (const [big, small, k] of per) near(len(big) / len(small), k, 1e-12, `${big} = ${k} ${small}`);
  // the atomic cadence ν -25-> λ -65-> ι -36-> η
  near(len('lambda') / len('nu'), 25, 1e-12);
  near(len('iota') / len('lambda'), 65, 1e-12);
  near(len('eta') / len('iota'), 36, 1e-12);
  // the names and the Earth-ish sizes they were chosen for (never shown)
  assert.deepEqual(UNITS.filter((u) => u.named).map((u) => u.name),
    ['Atom', 'Nuclide', 'Hadron', 'Helion', 'Quark', 'Preon', 'Chromon', 'Flavon', 'Somon', 'Blink']);
  assert.deepEqual(UNITS.map((u) => u.level), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'one unit per depth 1..13, no halves');
  assert.ok(UNITS.every((u) => !('half' in u)));
  near(secs('nu') * 1000, 311, 1, 'Blink 311 ms');
  near(secs('mu'), 1.555, 0.001, 'Somon 1.55 s');
  near(secs('lambda'), 7.773, 0.001, 'Flavon 7.77 s');
  near(secs('kappa') / 60, 1.684, 0.001, 'Chromon 1.68 min');
  near(secs('iota') / 60, 8.421, 0.001, 'Preon 8.42 min');
  near(secs('theta') / 60, 33.68, 0.01, 'Quark 33.7 min');
  near(secs('eta') / 3600, 5.052, 0.001, 'Helion 5.05 h');
  near(secs('zeta') / 86400, 2.316, 0.001, 'Hadron 2.3 d');
  near(secs('epsilon') / 86400, 16.21, 0.01, 'Nuclide 16.2 d');
  near(secs('delta') / 86400, 81.05, 0.01, 'Atom 81 d');
  // 19 Helions lock to the sun: one sync is about four days
  near(19 * secs('eta') / 86400, 4, 0.01, '19 η ≈ 4 d');
  assert.equal(unitName('η'), 'Helion');
  assert.equal(unitName('eta', 3), 'Helions');
  assert.equal(unitName('λ', 2), 'Flavons');
  assert.equal(unitName('ν', 1), 'Blink');
  assert.equal(unitName('γ'), 'Gamma', 'α β γ have no particle name yet: their level name');
  assert.equal(pure.blinkSeconds(), secs('nu'));
});

test('durations are counted in ladder units', () => {
  const zeta = 4 / 11375;
  assert.equal(pure.durationPos(zeta), '1ζ');
  assert.equal(pure.durationPos(zeta, { keepZeros: true }), '1ζ 0η');
  assert.equal(pure.durationPos(zeta * 1.5), '1ζ 5η'); // 0.5 ζ = 5.5 η
  assert.equal(pure.durationPos(3 * 4 / 125125 + 5 * 4 / 4504500, { parts: 2 }), '3η 1θ', '5ι = 1θ 1ι: every depth is a unit');
  assert.equal(pure.durationPos(3 * 4 / 125125 + 5 * 4 / 4504500, { parts: 3 }), '3η 1θ 1ι');
  assert.equal(pure.durationPos(3 * 4 / 125125 + 2 * 4 / 4504500, { parts: 2 }), '3η 2ι');
  assert.equal(pure.durationPos(4, { parts: 1 }), '1α');
  assert.equal(pure.durationPos(-zeta), '−1ζ');
  assert.equal(pure.durationPos(2 * 4 / P12, { parts: 2 }), '2ν', 'two Blinks');
  // the ladder ends at the Blink: finer spans are a decimal count of it
  assert.equal(pure.durationPos(0, { parts: 1 }), '0ν');
  assert.equal(pure.durationPos(4 / P12 / 7), '0.14ν');
  assert.equal(pure.durationPos(2.6 * 4 / P12), '2.6ν');
  assert.equal(pure.durationPos(4 / P12 * 5), '1μ');
  // 56 min 12 s at the spec instant = 6.67 ι = 1 θ 2 ι 3 κ …
  const d = pure.duration(3372, { at: T, parts: 2 });
  assert.equal(d, '1θ 2ι');
  assert.equal(pure.duration(3372, { at: T, parts: 3 }), '1θ 2ι 3κ');
  assert.equal(pure.countdown(3372, { at: T }), 'in ' + d);
  assert.equal(pure.countdown(-3372, { at: T }), d + ' ago');
  // between() measures in position, so it agrees with the model's cycle lengths exactly
  const cyc = model.levelAt(T, 6);
  assert.match(pure.between(cyc.start, cyc.end, { parts: 1 }), /^1η$/);
  assert.equal(pure.between(cyc.start, cyc.end, { parts: 2 }), '1η');
  assert.equal(pure.between(cyc.start, cyc.end, { parts: 2, keepZeros: true }), '1η 0θ');
  // no Earth time unit ever appears
  for (const x of [0.1, 1, 50, 3600, 86400, 1e7, 1e9]) assert.doesNotMatch(pure.duration(x, { at: T }), /\b(s|min|h|d|y|wk|mo|ms)\b/);
});

test('phase pair: 256 states from two 2-stroke glyphs', () => {
  assert.deepEqual(pure.pair(0), { index: 0, hi: 0, lo: 0 });
  assert.deepEqual(pure.pair(0.5), { index: 128, hi: 8, lo: 0 });
  assert.deepEqual(pure.pair(1), { index: 255, hi: 15, lo: 15 });
  assert.deepEqual(pure.pair(0.999999), { index: 255, hi: 15, lo: 15 });
  assert.equal(pure.pairText(13 / 16 + 4 / 256 + 0.0001), '13·4');
  // it is exactly the SPEC §5 odometer of two 2-stroke glyphs
  for (const L of [0, 3, 6, 9]) {
    for (const t of [T, T + 777.5, 946684800.25]) {
      const l = model.levelAt(t, L);
      const o = model.odometerAt(t, L, { strokes: 2, digits: 2 });
      assert.deepEqual([pure.pair(l.phase).hi, pure.pair(l.phase).lo], o.digits, `L${L}@${t}`);
    }
  }
  assert.match(pure.pairHTML(0.5), /aria-label="phase 8 and 0 of 256"/);
  assert.equal((pure.pairHTML(0.5).match(/<svg/g) || []).length, 2);
});

test('clock and date are hierarchy-aligned counters', () => {
  for (const t of [T, T + 12345.6, 946684800.5, 2886085800.25, 125593320.816]) {
    const c = pure.clock(t);
    const d = pure.date(t);
    const eta = model.levelAt(t, 6);
    const e36 = eta.phase * 36;
    assert.equal(c.eta, eta.local, 'eta digit is the depth-7 local index');
    assert.equal(c.iota, Math.floor(e36), 'iota counts 0..35 inside η');
    assert.equal(c.lambda, Math.floor((e36 - Math.floor(e36)) * 65), 'lambda counts 0..64 inside ι');
    // the date is the whole-cycle ordinal chain: no halves
    for (const [key, L] of [['beta', 1], ['gamma', 2], ['delta', 3], ['epsilon', 4], ['zeta', 5]]) {
      assert.equal(d[key], model.levelAt(t, L).local + 1, `${key} is the 1-based index of the running cycle in its parent`);
    }
    assert.equal(d.alpha, model.levelAt(t, 0).cycle + 1);
    assert.ok(c.eta <= 10 && c.iota <= 35 && c.lambda <= 64);
    assert.ok(d.alpha >= 1 && d.alpha <= 18 && d.beta <= 5 && d.gamma <= 13 && d.delta <= 5 && d.epsilon <= 5 && d.zeta <= 7);
  }
  assert.equal(pure.clockText(T), '0·' + pure.clock(T).iota + '·' + pure.clock(T).lambda);
  assert.equal(pure.dateText(T), 'α#6 β#4 γ#9 · δ#' + pure.date(T).delta + ' · ε#' + pure.date(T).epsilon + ' · ζ#' + pure.date(T).zeta);
  assert.doesNotMatch(pure.dateText(T) + pure.stamp(T, 'lambda'), /½/, 'no half-cycles anywhere');
  assert.equal(pure.clock(model.tMax + 5), null);
  assert.equal(pure.dateText(model.tMin - 5), '—');
});

test('cycle names follow the library calendar address', () => {
  // SPEC vector A sits in Alpha 6 / Beta 4 / Gamma 9 / Delta 3 / Epsilon 5 (src/core/model.js addressAt)
  assert.deepEqual(model.addressAt(T), [6, 4, 9, 3, 5]);
  assert.equal(pure.nameAt(T, 2), 'Gamma Nonafracton');
  assert.equal(pure.nameAt(T, 0), 'Alpha Hexafracton');
  assert.equal(pure.addressAt(T, 4), 'α#6 β#4 γ#9 δ#3 ε#5');
  assert.equal(pure.cycleShort(4, model.levelAt(T, 4).cycle), 'ε#5');
  assert.equal(pure.catalogueText(), 'α#1 – α#18');
  assert.match(pure.stamp(T, 'beta'), /^α#6 β#4$/);
  assert.match(pure.stamp(T, 'zeta'), /^α#6 β#4 γ#9 · δ#\d · ε#\d · ζ#\d$/);
  assert.match(pure.stamp(T, 'lambda'), / · \d+η \d+ι \d+λ$/);
  assert.match(pure.stamp(T, 'eta'), / · \d+η$/);
});

test('speeds are named by the unit that passes per Blink', () => {
  const B = pure.blinkSeconds();
  const rate = (id) => pure.unitSeconds(unitOf(id)) / B;
  assert.equal(pure.rateLabel(1), 'real time');
  assert.equal(pure.rateLabel(rate('eta')), 'η per Blink');
  assert.equal(pure.rateLabel(-rate('iota')), 'ι per Blink backward');
  // the presets are exact integers: the ladder is a product of whole factors
  const byId = Object.fromEntries(pure.RATES.map((r) => [r.id, r.rate]));
  assert.deepEqual([byId.mu, byId.lambda, byId.kappa, byId.iota, byId.theta, byId.eta], [5, 25, 325, 1625, 6500, 58500]);
  // any other rate is a count of the largest unit that passes at least once per Blink
  assert.equal(pure.rateLabel(rate('eta') / 4), '2.25θ per Blink', 'one η in 4 Blinks');
  assert.equal(pure.rateLabel(12345), '1.9θ per Blink');
  assert.equal(pure.rateLabel(0.5), '0.5ν per Blink', 'slower than real time');
  assert.doesNotMatch(pure.rateLabel(3600), /×|\b3600\b|beat/, 'no bare Earth-constant multiplier, no beats');
  assert.equal(pure.blinks(B), '1 Blink');
  assert.equal(pure.blinks(4 * B), '4 Blinks');
  assert.equal(pure.blinks(0.5 * B), '0.5 Blinks');
  assert.equal(pure.secondsToBlinks(pure.blinksToSeconds(3.5)), 3.5);
  for (const r of pure.RATES) assert.doesNotMatch(r.label, /\b(s|sec|second|min|hour|day|week|month|year|Hz|beat)\b/i);
});

test('frequencies are cycles per Blink (pB), the replacement of Hz', () => {
  const B = pure.blinkSeconds();
  assert.equal(pure.perBlink(1 / B), 1, 'one cycle per Blink');
  near(pure.perBlink(110), 34.2, 0.05, 'the default ground, 110 Hz');
  // the true rates of the deepest cycles are whole numbers of pB: ξ 7, ο 77, π 693, ρ 2 772
  const true_ = (L) => pure.perBlink(1 / model.levelInfo(L).meanSeconds);
  near(true_(12), 1, 1e-9);
  near(true_(13), 7, 1e-9);
  near(true_(14), 77, 1e-9);
  near(true_(15), 693, 1e-9);
  near(true_(16), 2772, 1e-9);
  assert.equal(pure.pbText(7), '7 pB');
  assert.equal(pure.pbText(34.23), '34.2 pB');
  assert.equal(pure.pbText(693), '693 pB');
  assert.equal(pure.pbText(2772), '2\u202f772 pB');
  assert.equal(pure.pbText(0.2), '0.2 pB');
  assert.equal(pure.pbText(1 / 65), '1 per 65 Blinks');
  assert.equal(pure.pbText(0), '—');
  assert.doesNotMatch(pure.pbText(34.23), /Hz/);
});

test('decomposition is exact for whole cycles of every depth (float position error must not read one unit short)', () => {
  const lens = { 6: '1η', 7: '1θ', 8: '1ι', 9: '1κ', 10: '1λ', 11: '1μ', 12: '1ν', 13: '0.14ν' };
  for (const [L, text] of Object.entries(lens)) {
    for (const t of [T, 946684800.37, 2886085800.9, 125593320.816, 1.2e10 + 123.456]) {
      const c = model.levelAt(t, Number(L));
      assert.equal(pure.between(c.start, c.end, { parts: 1 }), text, `depth ${Number(L) + 1} @ ${t}`);
      assert.equal(pure.cycleLength(Number(L), { parts: 1 }), text);
    }
  }
  assert.equal(pure.cycleLength(6), '1η');
  assert.equal(pure.cycleLength(7), '1θ');
  assert.equal(pure.cycleLength(8), '1ι');
  assert.equal(pure.cycleLength(5), '1ζ');
  assert.equal(pure.cycleLength(3), '1δ');
  assert.equal(pure.cycleLength(9), '1κ');
  assert.equal(pure.eclipseName(22), '#22');
});

test('pair aria text is spoken as two digits', () => {
  assert.match(pure.pairHTML(0.5), /aria-label="phase 8 and 0 of 256"/);
  assert.ok(!/<title>|vector CBT/.test(pure.pairHTML(0.3)));
});

test('solar drift is counted in λ with narrow digit groups', () => {
  const sol = model.solarAt(T);
  assert.match(pure.driftText(sol), /^−\d{1,3}(\u202f\d{3})*λ$/, 'a spec vector-A drift of about −48 470 s');
  near(pure.driftLambda(sol) * pure.unitSeconds(UNITS.find((u) => u.id === 'lambda')), sol.drift, 10, 'λ count x λ length ≈ drift');
  assert.equal(pure.groupDigits(6231), '6\u202f231');
  assert.equal(pure.groupDigits(-48420), '−48\u202f420');
  assert.equal(pure.groupDigits(999), '999');
  assert.equal(pure.driftText(model.solarAt(125593320.816)), '0λ', 'zero at the anchor');
});

test('pairLabel is the spoken pair; cyclePos is 4 / P', () => {
  assert.equal(pure.pairLabel(0.5), 'phase 8 and 0 of 256');
  assert.equal(pure.pairLabel(0.5, 'volume'), 'volume 8 and 0 of 256');
  assert.ok(pure.pairHTML(0.5, { label: 'volume' }).includes('aria-label="volume 8 and 0 of 256"'));
  assert.equal(pure.cyclePos(0), 4);
  near(pure.cyclePos(6), 4 / 125125, 1e-18);
  assert.equal(pure.EPS_POS, 1e-12);
});
