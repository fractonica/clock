import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createPure, ordinalName, periodName, shortName, UNITS, ORDINAL_NAMES } from '../src/core/pure.js';

const model = createModel();
const T = 1791460800;
const pure = createPure(model, { now: () => T });
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

test('unit ladder reproduces the proposed substitutions', () => {
  const len = (id) => pure.unitPos(UNITS.find((u) => u.id === id));
  near(len('epsilon-half') / len('zeta-half'), 7, 1e-12, 'week-like = 7 day-like');
  near(len('delta-half') / len('epsilon-half'), 5, 1e-12, 'month-like = 5 week-like');
  near(len('gamma') / len('delta-half'), 10, 1e-12, 'γ = 10 month-like');
  near(len('zeta-half') / len('eta'), 5.5, 1e-12, 'day-like = 5.5 hour-like');
  near(len('eta') / len('iota'), 36, 1e-12, 'η = 36 ι');
  near(len('iota') / len('lambda'), 65, 1e-12, 'ι = 65 λ');
  const secs = (id) => pure.unitSeconds(UNITS.find((u) => u.id === id));
  near(secs('zeta-half') / 3600, 27.79, 0.02, 'day-like is 1 d 3 h');
  near(secs('delta-half') / 86400, 40.525, 0.01, 'month-like is 40 d 12 h');
  near(secs('eta') / 3600, 5.052, 0.001);
  near(secs('iota') / 60, 8.421, 0.001);
  near(secs('lambda'), 7.773, 0.001);
});

test('durations are counted in ladder units', () => {
  const half6 = 2 / 11375;
  assert.equal(pure.durationPos(half6), '1ζ½');
  assert.equal(pure.durationPos(half6, { keepZeros: true }), '1ζ½ 0η');
  assert.equal(pure.durationPos(half6 * 1.5), '1ζ½ 2η'); // 0.5 ζ½ = 2.75 η
  assert.equal(pure.durationPos(3 * 4 / 125125 + 5 * 4 / 4504500, { parts: 2 }), '3η 5ι');
  assert.equal(pure.durationPos(0, { parts: 1 }), '0ξ');
  assert.equal(pure.durationPos(4, { parts: 1 }), '1α');
  assert.equal(pure.durationPos(-half6), '−1ζ½');
  // 56 min 12 s at the spec instant = 6.67 ι
  const d = pure.duration(3372, { at: T, parts: 2 });
  assert.match(d, /^6ι 4\dλ$/);
  assert.equal(pure.countdown(3372, { at: T }), 'in ' + d);
  assert.equal(pure.countdown(-3372, { at: T }), d + ' ago');
  // between() measures in position, so it agrees with the model's cycle lengths exactly
  const cyc = model.levelAt(T, 6);
  assert.match(pure.between(cyc.start, cyc.end, { parts: 1 }), /^1η$/);
  assert.equal(pure.between(cyc.start, cyc.end, { parts: 2 }), '1η');
  assert.equal(pure.between(cyc.start, cyc.end, { parts: 2, keepZeros: true }), '1η 0ι');
  // no Earth time unit ever appears
  for (const x of [1, 50, 3600, 86400, 1e7, 1e9]) assert.doesNotMatch(pure.duration(x, { at: T }), /\b(s|min|h|d|y|wk|mo)\b/);
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
    const g = model.levelAt(t, 2).phase * 10;
    assert.equal(d.delta, Math.floor(g) + 1, 'month-like = tenth of γ');
    const w = (g - Math.floor(g)) * 5;
    assert.equal(d.epsilon, Math.floor(w) + 1, 'week-like = fifth of a month-like');
    const z = (w - Math.floor(w)) * 7;
    assert.equal(d.zeta, Math.floor(z) + 1, 'day-like = seventh of a week-like');
    assert.ok(c.eta <= 10 && c.iota <= 35 && c.lambda <= 64);
    assert.ok(d.alpha >= 1 && d.alpha <= 18 && d.beta <= 5 && d.gamma <= 13 && d.delta <= 10 && d.epsilon <= 5 && d.zeta <= 7);
  }
  assert.equal(pure.clockText(T), '0·' + pure.clock(T).iota + '·' + pure.clock(T).lambda);
  assert.equal(pure.dateText(T), 'α#6 β#4 γ#9 · δ½#' + pure.date(T).delta + ' · ε½#' + pure.date(T).epsilon + ' · ζ½#' + pure.date(T).zeta);
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
  assert.match(pure.stamp(T, 'zeta'), /^α#6 β#4 γ#9 · δ½#\d+ · ε½#\d · ζ½#\d$/);
  assert.match(pure.stamp(T, 'lambda'), / · \d+η \d+ι \d+λ$/);
  assert.match(pure.stamp(T, 'eta'), / · \d+η$/);
});

test('speeds are named by the unit that passes per beat', () => {
  assert.equal(pure.rateLabel(1), 'real time');
  assert.equal(pure.rateLabel(pure.unitSeconds(UNITS.find((u) => u.id === 'eta'))), 'η per beat');
  assert.equal(pure.rateLabel(-pure.unitSeconds(UNITS.find((u) => u.id === 'iota'))), 'ι per beat backward');
  // any other rate is a count of the largest unit that passes at least once per beat
  const eta = pure.unitSeconds(UNITS.find((u) => u.id === 'eta'));
  assert.equal(pure.rateLabel(eta / 4), '9ι per beat', 'one η cycle in 4 beats');
  assert.equal(pure.rateLabel(12345), '24.4ι per beat');
  assert.equal(pure.rateLabel(1.5), '4.82ν per beat');
  assert.doesNotMatch(pure.rateLabel(3600), /×|\b3600\b/, 'no bare Earth-constant multiplier');
  assert.equal(pure.beats(1), '1 beat');
  assert.equal(pure.beats(4), '4 beats');
  for (const r of pure.RATES) assert.doesNotMatch(r.label, /\b(s|sec|second|min|hour|day|week|month|year|Hz)\b/i);
});

test('decomposition is exact for whole cycles of every depth (float position error must not read one unit short)', () => {
  const lens = { 6: '1η', 7: '4ι', 8: '1ι', 9: '13λ', 10: '1λ', 11: '1μ', 12: '1ν', 13: '1ξ' };
  for (const [L, text] of Object.entries(lens)) {
    for (const t of [T, 946684800.37, 2886085800.9, 125593320.816, 1.2e10 + 123.456]) {
      const c = model.levelAt(t, Number(L));
      assert.equal(pure.between(c.start, c.end, { parts: 1 }), text, `depth ${Number(L) + 1} @ ${t}`);
      assert.equal(pure.cycleLength(Number(L), { parts: 1 }), text);
    }
  }
  assert.equal(pure.cycleLength(6), '1η');
  assert.equal(pure.cycleLength(8), '1ι');
  assert.equal(pure.cycleLength(5), '2ζ½');
  assert.equal(pure.cycleLength(9), '13λ');
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
