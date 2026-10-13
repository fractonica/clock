import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import {
  createPure, ordinalName, periodName, shortName, unitName, unitOf, levelKind, isMajor, UNITS, UNIT_LEVELS, ORDINAL_NAMES,
  QUARTER_WORDS,
} from '../src/core/pure.js';

const model = createModel();
const T = 1791460800; // SPEC vector A
const B = 946684800;
const C = 2886085800;
const pure = createPure(model, { now: () => T });
const P = (L) => model.levelInfo(L).prefixNum;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);

test('names: fracton ordinals belong to the four major periods only', () => {
  assert.equal(ordinalName(1), 'Monofracton');
  assert.equal(ordinalName(2), 'Difracton');
  assert.equal(ordinalName(11), 'Didecafracton');
  assert.equal(ordinalName(13), 'Tridecafracton');
  assert.equal(ordinalName(18), 'Octadecafracton');
  assert.equal(ordinalName(40), '#40');
  assert.equal(periodName(2, 2), 'Gamma Difracton');
  assert.equal(periodName(3, 5), 'Delta Pentafracton');
  assert.equal(periodName(0, 6), 'Alpha Hexafracton');
  assert.equal(periodName(6, 2), 'η#2', 'a minor level has no fracton name');
  assert.equal(shortName(4, 5), 'ε#5');
  assert.ok(ORDINAL_NAMES.slice(1).every((n) => /fracton$/.test(n)));
  // the majors never need more than 13 per parent, Alpha at most 18
  assert.deepEqual([1, 2, 3].map((L) => model.levelInfo(L).siblings), [5, 13, 5]);
  assert.equal(Number(model.clock.count(0)), 18);
  assert.deepEqual(QUARTER_WORDS, ['Peak', 'Node', 'Valley', 'End'], 'quarters named by the threshold that ends them (SPEC §6.2)');
});

test('unit ladder: four major periods, then one minor unit every other depth', () => {
  assert.deepEqual(UNITS.map((u) => `${u.sym} ${u.name}`), [
    'α Alpha', 'β Beta', 'γ Gamma', 'δ Delta', 'ε Nuclide', 'η Helion', 'ι Preon', 'λ Flavon', 'ν Blink',
  ]);
  assert.deepEqual(UNIT_LEVELS, [0, 1, 2, 3, 4, 6, 8, 10, 12]);
  assert.deepEqual(UNITS.filter((u) => u.major).map((u) => u.sym), ['α', 'β', 'γ', 'δ']);
  const len = (id) => pure.unitPos(unitOf(id));
  const per = [['alpha', 'beta', 5], ['beta', 'gamma', 13], ['gamma', 'delta', 5], ['delta', 'epsilon', 5],
    ['epsilon', 'eta', 77], ['eta', 'iota', 36], ['iota', 'lambda', 65], ['lambda', 'nu', 25]];
  for (const [big, small, k] of per) near(len(big) / len(small), k, 1e-12, `1${big} = ${k} ${small}`);
  const secs = (id) => pure.unitSeconds(unitOf(id));
  near(secs('delta') / 86400, 81.05, 0.01, 'Delta ≈ a month of 81 d');
  near(secs('epsilon') / 86400, 16.21, 0.01, 'Nuclide ≈ a week of 16.2 d');
  near(secs('eta') / 3600, 5.052, 0.001, 'Helion ≈ an hour of 5.05 h');
  near(secs('iota') / 60, 8.421, 0.001, 'Preon ≈ a minute of 8.42 min');
  near(secs('lambda'), 7.773, 0.001, 'Flavon ≈ a second of 7.77 s');
  near(secs('nu') * 1000, 310.9, 0.1, 'Blink 311 ms');
  near(19 * secs('eta') / 86400, 4, 0.01, '19 Helions lock to the sun');
  assert.equal(unitName('η'), 'Helion');
  assert.equal(unitName('eta', 3), 'Helions');
  assert.equal(unitName('δ', 2), 'Deltas');
  assert.equal(unitName(12), 'Blink');
  assert.equal(unitOf('ζ'), undefined, 'ζ θ κ μ are depths, not units');
  assert.deepEqual([3, 4, 5, 6, 7, 11, 12, 13].map(levelKind), ['major', 'unit', 'between', 'unit', 'between', 'between', 'unit', 'sub']);
  assert.ok(isMajor(0) && isMajor(3) && !isMajor(4));
});

test('durations are counted in the ladder, zero parts skipped', () => {
  const eps = 4 / P(4);
  assert.equal(pure.durationPos(eps), '1ε');
  assert.equal(pure.durationPos(eps, { keepZeros: true }), '1ε 0η');
  assert.equal(pure.durationPos(eps * 1.5), '1ε 38η');
  assert.equal(pure.durationPos(3 * 4 / P(6) + 5 * 4 / P(8)), '3η 5ι');
  assert.equal(pure.durationPos(3 * 4 / P(6) + 5 * 4 / P(10)), '3η 5λ', 'the empty ι is skipped');
  assert.equal(pure.durationPos(4, { parts: 1 }), '1α');
  assert.equal(pure.durationPos(-eps), '−1ε');
  assert.equal(pure.durationPos(4 / P(5)), '11η', 'a ζ cycle is 11 Helions');
  // the ladder ends at the Blink: short spans keep a decimal
  assert.equal(pure.durationPos(0, { parts: 1 }), '0ν');
  assert.equal(pure.durationPos(4 / P(12) / 7), '0.14ν');
  assert.equal(pure.durationPos(2.6 * 4 / P(12)), '2.6ν');
  assert.equal(pure.durationPos(16 * 4 / P(12)), '16ν');
  // 56 min 12 s at the spec instant
  assert.equal(pure.duration(3372, { at: T }), '6ι 43λ');
  assert.equal(pure.countdown(3372, { at: T }), 'in 6ι 43λ');
  assert.equal(pure.countdown(-3372, { at: T }), '6ι 43λ ago');
  const cyc = model.levelAt(T, 6);
  assert.equal(pure.between(cyc.start, cyc.end), '1η');
  assert.equal(pure.between(cyc.start, cyc.end, { keepZeros: true }), '1η 0ι');
  for (const x of [0.1, 1, 50, 3600, 86400, 1e7, 1e9]) assert.doesNotMatch(pure.duration(x, { at: T }), /\b(s|min|h|d|y|wk|mo|ms)\b|[ζθκμ]/);
});

test('exact cycle lengths at every depth: majors and units are one unit, the depths between are counts of the next unit', () => {
  const lens = ['1α', '1β', '1γ', '1δ', '1ε', '11η', '1η', '4ι', '1ι', '13λ', '1λ', '5ν', '1ν', '0.14ν'];
  lens.forEach((text, L) => assert.equal(pure.cycleLength(L, { parts: 1 }), text, `depth ${L + 1}`));
  for (const L of [6, 7, 8, 9, 10, 11, 12, 13]) {
    for (const t of [T, 946684800.37, 2886085800.9, 125593320.816, 1.2e10 + 123.456]) {
      const c = model.levelAt(t, L);
      assert.equal(pure.between(c.start, c.end, { parts: 1 }), lens[L], `depth ${L + 1} @ ${t}`);
    }
  }
});

test('phase pair: 256 states from two 2-stroke glyphs; the Helion pair is the SPEC §5 odometer at depth 7', () => {
  assert.deepEqual(pure.pair(0.5), { index: 128, hi: 8, lo: 0 });
  assert.deepEqual(pure.pair(1), { index: 255, hi: 15, lo: 15 });
  assert.equal(pure.pairText(13 / 16 + 4 / 256 + 0.0001), '13·4');
  for (const [t, digits] of [[T, [13, 0]], [B, [5, 6]], [C, [10, 3]]]) {
    const p = pure.pair(model.levelAt(t, 6).phase);
    assert.deepEqual([p.hi, p.lo], digits, `SPEC vector at ${t}`);
  }
  assert.match(pure.pairHTML(0.5), /aria-label="phase 8 and 0 of 256"/);
  assert.equal(pure.pairLabel(0.5, 'volume'), 'volume 8 and 0 of 256');
  assert.ok(!/<title>|vector CBT/.test(pure.pairHTML(0.3)));
});

test('clock: the Nuclide and the counts of completed Helions, Preons, Flavons, Blinks', () => {
  for (const t of [T, T + 12345.6, B + 0.5, C + 0.25, 125593320.816]) {
    const c = pure.clock(t);
    const e = model.levelAt(t, 4);
    const ePhase = e.phase;
    assert.equal(c.epsilon, e.local + 1);
    assert.equal(c.eta, Math.floor(ePhase * 77), 'Helions 0..76 inside the Nuclide');
    const h = model.levelAt(t, 6).phase;
    assert.equal(c.iota, Math.floor(h * 36), 'Preons 0..35 inside the Helion');
    const i = model.levelAt(t, 8).phase;
    assert.equal(c.lambda, Math.floor(i * 65), 'Flavons 0..64 inside the Preon');
    const l = model.levelAt(t, 10).phase;
    assert.equal(c.nu, Math.floor(l * 25), 'Blinks 0..24 inside the Flavon');
    assert.ok(c.eta <= 76 && c.iota <= 35 && c.lambda <= 64 && c.nu <= 24 && c.epsilon <= 5);
  }
  assert.equal(pure.clockText(T), '33η 29ι 21λ');
  assert.equal(pure.clockText(T, 'iota'), '33η 29ι');
  assert.equal(pure.clockText(T, 'nu'), '33η 29ι 21λ 3ν');
  assert.equal(pure.clock(model.tMax + 5), null);
});

test('dates: words for the majors with their quarter, letters for the minor units (SPEC §15 vectors)', () => {
  assert.equal(pure.dateText(T, { form: 'full', upTo: 'nu' }),
    'Alpha Hexafracton Valley, Beta Tetrafracton Valley, Gamma Nonafracton Valley, Delta Trifracton End, ε#5 33η 29ι 21λ 3ν');
  assert.equal(pure.dateText(T), 'Delta Trifracton End ε#5 33η 29ι');
  assert.equal(pure.dateText(T, { letters: true }), 'δ#3 ε#5 33η 29ι');
  assert.equal(pure.stamp(T, 'nu'), 'α#6 β#4 γ#9 δ#3 ε#5 33η 29ι 21λ 3ν');
  assert.equal(pure.stamp(T), 'α#6 β#4 γ#9 δ#3 ε#5 33η 29ι');
  assert.equal(pure.stamp(T, 'delta'), 'α#6 β#4 γ#9 δ#3');
  assert.equal(pure.dateText(B), 'Delta Trifracton Node ε#2 20η 12ι');
  assert.equal(pure.dateText(C), 'Delta Pentafracton Peak ε#2 0η 23ι');
  assert.equal(pure.dateText(125593320.816, { form: 'full' }),
    'Alpha Hexafracton Peak, Beta Monofracton Peak, Gamma Monofracton Peak, Delta Monofracton Peak, ε#1 0η 0ι', 'the anchor eclipse starts Alpha 6');
  assert.equal(pure.majorText(T, 3), 'Delta Trifracton End');
  assert.equal(pure.majorText(T, 0), 'Alpha Hexafracton Valley');
  // the quarter is floor(phase × 4)
  for (const L of [0, 1, 2, 3]) {
    const q = pure.quarterAt(T, L);
    assert.equal(q, Math.floor(model.levelAt(T, L).phase * 4));
    assert.equal(pure.date(T).quarter[['alpha', 'beta', 'gamma', 'delta'][L]], QUARTER_WORDS[q]);
  }
  const d = pure.date(T);
  assert.deepEqual([d.alpha, d.beta, d.gamma, d.delta, d.epsilon], [6, 4, 9, 3, 5]);
  assert.deepEqual(model.addressAt(T), [6, 4, 9, 3, 5], 'the same address as the library calendar');
  assert.equal(pure.dateText(model.tMin - 5), '—');
  assert.doesNotMatch(pure.dateText(T, { form: 'full', upTo: 'nu' }), /[ζθκμ]|½/);
});

test('minor cycles are named by where they start in their Nuclide; counts agree with the clock', () => {
  for (const t of [T, B, C, T + 777.7, 2.3e9]) {
    const clk = pure.clock(t);
    for (const L of [5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      const l = model.levelAt(t, L);
      const startClock = pure.clock(l.start + Math.max(0.002, 1e-4 * (l.end - l.start))); // the model reads instants to the ms
      const c = pure.countsAtStart(L, l.cycleBig);
      assert.equal(c.epsilon, clk.epsilon);
      assert.equal(c.eta, startClock.eta, `η at the start of the depth-${L + 1} cycle`);
      if (L >= 7) assert.equal(c.iota, startClock.iota);
      if (L >= 9) assert.equal(c.lambda, startClock.lambda);
      if (L >= 11) assert.equal(c.nu, startClock.nu);
    }
  }
  const at = (L) => model.levelAt(T, L).cycleBig;
  assert.equal(pure.cycleName(3, at(3)), 'Delta Trifracton');
  assert.equal(pure.cycleName(4, at(4)), 'ε#5');
  assert.equal(pure.cycleName(6, at(6)), 'ε#5 33η');
  assert.equal(pure.cycleName(8, at(8)), 'ε#5 33η 29ι');
  assert.equal(pure.cycleName(7, at(7)), 'ε#5 33η 28ι', 'a θ starts on a multiple of 4ι');
  assert.equal(pure.cycleName(10, at(10), { short: true }), '33η 29ι 21λ');
  assert.equal(pure.cycleName(13, at(13)), 'ε#5 33η 29ι 21λ 3.43ν');
  assert.equal(pure.cycleShort(6, at(6)), '33η');
  assert.equal(pure.cycleShort(3, at(3)), 'δ#3');
  assert.equal(pure.nameAt(T, 2), 'Gamma Nonafracton');
  assert.equal(pure.addressAt(T, 4), 'α#6 β#4 γ#9 δ#3 ε#5');
  assert.equal(pure.addressAt(T, 7), 'α#6 β#4 γ#9 δ#3 ε#5 33η 29ι');
  assert.equal(pure.catalogueText(), 'α#1 – α#18');
});

test('speeds are counted per Blink; presets are whole counts of a unit', () => {
  const B_ = pure.blinkSeconds();
  assert.equal(pure.rateLabel(1), 'real time');
  const byId = Object.fromEntries(pure.RATES.map((r) => [r.id, r]));
  assert.deepEqual(
    ['nu5', 'lambda', 'lambda13', 'iota', 'iota4', 'eta', 'eta11'].map((id) => byId[id].rate),
    [5, 25, 325, 1625, 6500, 58500, 643500],
  );
  assert.deepEqual(pure.RATES.map((r) => r.label), [
    'real time', '5ν per Blink', 'λ per Blink', '13λ per Blink', 'ι per Blink', '4ι per Blink', 'η per Blink', '11η per Blink',
    'ε per Blink', 'δ per Blink', 'γ per Blink',
  ]);
  assert.equal(pure.PLAY_RATE, 6500);
  assert.equal(pure.rateLabel(-1625), 'ι per Blink backward');
  assert.equal(pure.rateLabel(pure.unitSeconds(unitOf('eta')) / (4 * B_)), '9ι per Blink', 'one η in 4 Blinks');
  assert.equal(pure.rateLabel(3600), '2.22ι per Blink');
  assert.equal(pure.rateLabel(0.5), '0.5ν per Blink');
  assert.equal(pure.blinks(B_), '1 Blink');
  assert.equal(pure.blinks(4 * B_), '4 Blinks');
  assert.equal(pure.blinks(58500 * B_), '58 500 Blinks');
  assert.equal(pure.secondsToBlinks(pure.blinksToSeconds(3.5)), 3.5);
  for (const r of pure.RATES) assert.doesNotMatch(r.label, /\b(s|sec|second|min|hour|day|week|month|year|Hz|beat)\b/i);
});

test('frequencies are cycles per Blink (pB), the replacement of Hz', () => {
  assert.equal(pure.perBlink(1 / pure.blinkSeconds()), 1);
  near(pure.perBlink(110), 34.2, 0.05, 'the default ground');
  const true_ = (L) => pure.perBlink(1 / model.levelInfo(L).meanSeconds);
  near(true_(13), 7, 1e-9);
  near(true_(14), 77, 1e-9);
  near(true_(15), 693, 1e-9);
  near(true_(16), 2772, 1e-9);
  assert.equal(pure.pbText(34.23), '34.2 pB');
  assert.equal(pure.pbText(2772), '2 772 pB');
  assert.equal(pure.pbText(1 / 65), '1 per 65 Blinks');
  assert.equal(pure.pbText(0), '—');
});

test('solar drift is counted in λ with narrow digit groups', () => {
  const sol = model.solarAt(T);
  assert.match(pure.driftText(sol), /^−\d{1,3}( \d{3})*λ$/);
  near(pure.driftLambda(sol) * pure.unitSeconds(unitOf('lambda')), sol.drift, 10, 'λ count x λ length ≈ drift');
  assert.equal(pure.groupDigits(-48420), '−48 420');
  assert.equal(pure.driftText(model.solarAt(125593320.816)), '0λ', 'zero at the anchor');
  assert.equal(pure.cyclePos(0), 4);
  assert.equal(pure.EPS_POS, 1e-12);
  assert.equal(pure.eclipseName(22), '#22');
});
