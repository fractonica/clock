import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import {
  pitchClass,
  log2Big,
  placeOctaves,
  autoOctaves,
  OCTAVES,
  CLASH_CENTS,
  clashingHarmonics,
  buildTuning,
  frequencyOf,
  noteOf,
  noteLabel,
  physicalLevels,
  weightFor,
  chimeFrequency,
  N_LEVELS,
  KEEP_APART_CENTS,
} from '../src/audio/tuning.js';
import {
  triangle,
  loudness,
  meanLoudness,
  amWeight,
  amZone,
  AM_FULL_HZ,
  AM_NONE_HZ,
  DEFAULT_FLOOR,
  voiceLoudness,
  phaseOf,
  chimeMode,
  eventStrength,
  eventsInWindow,
  createClockMap,
  tempoRate,
  tempoInfo,
  directionCue,
  directionWeight,
  cycleHz,
  bellTaper,
  bellLoudAt,
  isLessImportant,
} from '../src/audio/schedule.js';
import { fmtHz, fmtRate, fmtSeconds, fmtSecondsShort, fmtDb, fmtOct, fmtPeriod, fmtInt } from '../src/audio/format.js';
import { sanitize, DEFAULT_SETTINGS, FLOORS, LIMITS, SETTINGS_REV, presetLevels, matchPreset, loadSettings, saveSettings, STORAGE_KEY, dbToGain } from '../src/audio/settings.js';
import { createEngine, MAX_NOTES, VOICE_AMP, safetyCurve } from '../src/audio/engine.js';
import { labelSlots } from '../src/ui/sound/scope.js';
import { createPure } from '../src/core/pure.js';
import * as W from '../src/audio/words.js';
import { RULES } from '../tools/pure-scan.mjs';

const model = createModel();
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);
const VECTOR_A = 1791460800; // 2026-10-08T12:00:00Z (SPEC §12)
const ETA_END = 1791464172.428; // depth-7 end after vector A

// ------------------------------------------------------------------------------------------------
// tuning
// ------------------------------------------------------------------------------------------------
test('pitch classes are the exact folded prefixes (brief table)', () => {
  const rows = buildTuning(model);
  assert.equal(rows.length, N_LEVELS);
  const want = [
    ['1/1', 0],
    ['5/4', 386],
    ['65/64', 27],
    ['325/256', 413],
    ['1625/1024', 800],
    ['11375/8192', 568],
    ['125125/65536', 1120],
    ['1126125/1048576', 124],
    ['1126125/1048576', 124], // iota = theta + 2 octaves: the same class
    null,
    null,
    null,
    null,
    null,
  ];
  want.forEach((w, L) => {
    if (!w) return;
    const pc = pitchClass(rows[L].prefix);
    assert.equal(pc.text, w[0], `depth ${L + 1}`);
    near(pc.cents, w[1], 1, `cents depth ${L + 1}`);
  });
  // the deeper classes (kappa..xi) from the brief: 510, 150, 537, 923, 692
  [510, 150, 537, 923, 692].forEach((c, i) => near(rows[9 + i].pcCents, c, 0.5, 'depth ' + (10 + i)));
  for (const r of rows) {
    assert.ok(r.pcCents >= 0 && r.pcCents < 1200);
    // exactness: prefix : 2^k = num : den with num odd (BigInt, no rounding)
    assert.equal(r.num % 2n, 1n);
    assert.equal(r.prefix * r.den, r.num * 2n ** BigInt(pitchClass(r.prefix).shift));
    assert.ok(r.num >= r.den && r.num < 2n * r.den, 'folded into [1, 2)');
  }
  assert.equal(pitchClass(4504500n).text, pitchClass(1126125n).text);
  assert.equal(pitchClass(1n).text, '1/1');
});

test('log2Big and pitchClass are exact for huge numbers', () => {
  near(log2Big(2n ** 200n), 200, 1e-9);
  near(log2Big(3n ** 100n), 100 * Math.log2(3), 1e-9);
  const pc = pitchClass(5n ** 40n * 2n ** 7n);
  assert.equal(pc.num, 5n ** 40n);
  assert.equal(2n ** BigInt(Math.ceil(log2Big(pc.den))), pc.den);
  near(pc.cents, 1200 * (40 * Math.log2(5) - Math.floor(40 * Math.log2(5))), 1e-6);
});

test('register: the explicit octave vector never decreases, voices stay in [30 Hz, 3 kHz] and apart', () => {
  const rows = buildTuning(model);
  assert.deepEqual(rows.map((r) => r.octave), [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 4], 'the audited register');
  assert.deepEqual([...OCTAVES], rows.map((r) => r.octave));
  for (let L = 1; L < rows.length; L++) assert.ok(rows[L].octave >= rows[L - 1].octave, `octave monotone at depth ${L + 1}`);
  assert.equal(rows[0].octave, 0);
  assert.ok(rows.at(-1).octave >= 4 && rows.at(-1).octave <= 5, '≈5 octaves in total');
  const f = rows.map((r) => frequencyOf(r, 110));
  assert.equal(f[0], 110);
  for (const hz of f) assert.ok(hz >= 30 && hz <= 3000.5, `${hz} Hz in range (max ≈ 3 kHz)`);
  near(Math.max(...f), 2999.5, 0.5, 'nu is the highest voice');
  // coarse cycles are low, fine ones high: mean frequency of the finer half exceeds the coarser half
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(f.slice(7)) > 2 * mean(f.slice(0, 7)));
  // no two voices within KEEP_APART_CENTS of each other (rough beating)
  for (let i = 0; i < f.length; i++)
    for (let j = i + 1; j < f.length; j++) {
      const cents = Math.abs(1200 * Math.log2(f[i] / f[j]));
      assert.ok(cents >= KEEP_APART_CENTS, `depth ${i + 1} vs ${j + 1}: ${cents.toFixed(1)}¢`);
    }
  // placement is explicit; the automatic rule it was derived from differs in exactly one place: zeta is an octave higher
  const prefixes = rows.map((r) => r.prefix);
  assert.deepEqual(placeOctaves(prefixes), rows.map((r) => r.octave));
  const auto = autoOctaves(prefixes);
  assert.deepEqual(auto, [0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4]);
  assert.deepEqual(auto.map((o, L) => (o === OCTAVES[L] ? null : L + 1)).filter(Boolean), [6], 'only depth 6 (zeta) moved');
  // frequency scales exactly with the base pitch
  for (const r of rows) near(frequencyOf(r, 220) / frequencyOf(r, 110), 2, 1e-12);
});

test('register: zeta moved up an octave to 611 Hz, clear of delta; beta stays where it was', () => {
  const f = buildTuning(model).map((r) => frequencyOf(r, 110));
  const [, beta, , delta, , zeta, eta, theta] = f;
  near(zeta, 611.0, 0.1);
  near(delta, 279.3, 0.1);
  near(beta, 137.5, 0.01, 'beta is not moved up an octave (275.0 Hz would sit 27 cents below delta)');
  assert.ok(Math.abs(f[3] - f[5]) > 300, 'delta and zeta are no longer 26 Hz apart (the roughness maximum)');
  assert.ok(zeta / delta > 2, 'more than an octave between them');
  assert.ok(theta < zeta && zeta < eta, 'theta 472.5 < zeta 611.0 < eta 840.1');
  // the 26 Hz pair is gone: no two voices below 700 Hz are 10..45 Hz apart except alpha-beta (a major third, 27.5 Hz)
  for (let i = 0; i < f.length; i++)
    for (let j = i + 1; j < f.length; j++) {
      if (f[i] > 700 || f[j] > 700 || (i === 0 && j === 1)) continue;
      const d = Math.abs(f[i] - f[j]);
      assert.ok(d < 10 || d > 45, `${i + 1}-${j + 1}: ${d.toFixed(1)} Hz apart`);
    }
});

test('second harmonics: left out exactly where they would beat against another sounding voice', () => {
  const rows = buildTuning(model);
  const freqs = rows.map((r) => frequencyOf(r, 110));
  const def = rows.map((_, L) => L < 12);
  const depths = (skip) => skip.map((s, L) => (s ? L + 1 : null)).filter(Boolean);
  // default chord: alpha beta gamma (2f within 27-97 cents of gamma, delta, theta), zeta (58 cents from kappa),
  // theta (0 cents: it would double iota and put theta's cycle under iota's note), iota and kappa (27 cents)
  assert.deepEqual(depths(clashingHarmonics(freqs, def)), [1, 2, 3, 6, 8, 9, 10]);
  assert.deepEqual(depths(clashingHarmonics(freqs)), [1, 2, 3, 6, 8, 9, 10], 'the same with all 14 voices: no new clash with nu, xi');
  // every decision follows from the table: skipped <=> some other sounding fundamental within CLASH_CENTS of 2f
  freqs.forEach((f, i) => {
    const near = freqs.map((g, j) => (j !== i && def[j] ? Math.abs(1200 * Math.log2((2 * f) / g)) : Infinity));
    assert.equal(clashingHarmonics(freqs, def)[i], def[i] && Math.min(...near) < CLASH_CENTS, `depth ${i + 1}`);
  });
  assert.equal(CLASH_CENTS, 120);
  // only intervals matter: the same set at any base pitch
  for (const base of [55, 82.5, 220]) {
    assert.deepEqual(depths(clashingHarmonics(rows.map((r) => frequencyOf(r, base)), def)), [1, 2, 3, 6, 8, 9, 10], `base ${base}`);
  }
  // "another SOUNDING voice": the partner muted -> the partial is back
  const without = (L) => def.map((on, i) => on && i !== L);
  assert.ok(!depths(clashingHarmonics(freqs, without(2))).includes(1), 'alpha keeps its 2f when gamma is muted');
  assert.ok(depths(clashingHarmonics(freqs, without(2))).includes(2), 'beta still clashes with delta');
  assert.deepEqual(depths(clashingHarmonics(freqs, def.map((_, L) => L < 7))), [1, 2], 'Slow preset (1-7): only the alpha/gamma and beta/delta pairs are in it');
  assert.deepEqual(clashingHarmonics(freqs, def.map(() => false)), def.map(() => false));
  // the old register had delta-zeta 26 Hz apart AND more partials on top of other notes
  const old = [0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4];
  const oldF = rows.map((r, L) => 110 * Math.pow(2, (r.pcCents + 1200 * old[L]) / 1200));
  near(Math.abs(oldF[3] - oldF[5]), 26.2, 0.1, 'delta-zeta in the old register');
});

/** Sethares (1993) sensory dissonance of partials [{f, a}] - the Plomp-Levelt roughness curve. */
function dissonance(partials) {
  let d = 0;
  for (let i = 0; i < partials.length; i++)
    for (let j = i + 1; j < partials.length; j++) {
      const p = partials[i];
      const q = partials[j];
      const s = 0.24 / (0.021 * Math.min(p.f, q.f) + 19);
      const df = Math.abs(p.f - q.f);
      d += p.a * q.a * (Math.exp(-3.5 * s * df) - Math.exp(-5.75 * s * df));
    }
  return d;
}

test('register + harmonics: the default chord is about a third less rough (Sethares dissonance, audited)', () => {
  const rows = buildTuning(model);
  const def = rows.map((_, L) => L < 12);
  const chord = (octaves, h) => {
    const f = rows.map((r, L) => 110 * Math.pow(2, (r.pcCents + 1200 * octaves[L]) / 1200));
    const skip = clashingHarmonics(f, def);
    const parts = [];
    rows.forEach((_, L) => {
      if (!def[L]) return;
      const a = weightFor(f[L]); // every voice at full loudness
      parts.push({ f: f[L], a }, { f: f[L] + 0.15, a: 0.14 * a }); // fundamental + chorus partner
      if (h === 'all' || (h === 'safe' && !skip[L])) parts.push({ f: 2 * f[L], a: 0.1 * a });
    });
    return dissonance(parts);
  };
  const old = [0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4];
  const before = chord(old, 'all');
  const change = (v) => 100 * (v / before - 1);
  near(change(chord(old, 'safe')), -11, 3, 'only dropping the clashing 2f partials (audit: -12 %)');
  near(change(chord(OCTAVES, 'all')), -27, 3, 'only moving zeta (audit: -27 %)');
  near(change(chord(OCTAVES, 'safe')), -37, 3, 'both (audit: -37 %)');
  near(change(chord(OCTAVES, 'none')), -38, 3, 'no 2f at all (audit: -39 %)');
});

test('bells: the valley is exactly an octave below the other bells of its level, for every depth and base', () => {
  for (const base of [55, 82.5, 110, 165, 220]) {
    for (const r of buildTuning(model)) {
      const f = frequencyOf(r, base);
      const peak = chimeFrequency(f, 'peak');
      assert.equal(chimeFrequency(f, 'node'), peak);
      assert.equal(chimeFrequency(f, 'end'), peak);
      assert.equal(chimeFrequency(f, 'valley'), peak / 2, `depth ${r.depth} @${base}: valley is an octave lower`);
      assert.ok(peak >= 60 && peak <= 4200, `bell ${peak} Hz in the pleasant band`);
      assert.ok(peak / 2 >= 30, 'and the valley stays audible');
    }
  }
  // the fine levels used to fold the peak down onto the valley's pitch: mu, nu, xi
  const mu = frequencyOf(buildTuning(model)[11], 110);
  near(chimeFrequency(mu, 'peak'), 2399.6, 0.5);
  near(chimeFrequency(mu, 'valley'), 1199.8, 0.5);
  near(chimeFrequency(frequencyOf(buildTuning(model)[12], 110), 'valley'), 1499.7, 0.5);
  near(chimeFrequency(frequencyOf(buildTuning(model)[13], 110), 'valley'), 1312.3, 0.5);
  // slow levels are unchanged
  assert.equal(chimeFrequency(110, 'peak'), 220);
  assert.equal(chimeFrequency(110, 'valley'), 110);
});

test('true cycle rates: xi 22.5 Hz, omicron 247.7 Hz, pi 2.23 kHz, rho 8.92 kHz', () => {
  const hz = (L) => 1 / model.levelInfo(L).meanSeconds;
  near(hz(13), 22.51, 0.02);
  near(hz(14), 247.65, 0.1);
  near(hz(15), 2228.9, 1);
  near(hz(16), 8915.4, 3);
  near(hz(11), 0.6432, 0.001, 'mu heartbeat 0.64 Hz');
  near(hz(12), 3.216, 0.005, 'nu 3.2 Hz');
  const depths = (shift) => physicalLevels(model, shift).map((p) => p.depth);
  assert.deepEqual(depths(-1), [15, 16, 17], 'omicron, pi, rho one octave down');
  assert.deepEqual(depths(0), [15, 16], 'rho at 8.9 kHz is left out of the safe band; xi at 22.5 Hz is too low');
  assert.deepEqual(depths(3), [13, 14, 15], 'nu, xi, omicron three octaves up');
  assert.equal(model.levelInfo(14).letter, 'ο');
});

test('note names and loudness weighting', () => {
  assert.deepEqual([noteOf(440).name, noteOf(440).cents], ['A4', 0]);
  assert.equal(noteOf(110).name, 'A2');
  assert.equal(noteOf(261.63).name, 'C4');
  assert.equal(noteLabel(349.1), 'F4 −1¢');
  assert.equal(noteLabel(223.4), 'A3 +27¢');
  assert.ok(weightFor(110) > weightFor(1000) && weightFor(1000) > weightFor(5000));
  for (const f of [20, 55, 110, 440, 3000, 12000]) assert.ok(weightFor(f) > 0.3 && weightFor(f) < 4);
  assert.equal(chimeFrequency(110, 'peak'), 220);
  assert.equal(chimeFrequency(110, 'valley'), 110, 'the valley bell is an octave below the others');
  assert.ok(chimeFrequency(3000, 'end') <= 4200);
});

// ------------------------------------------------------------------------------------------------
// loudness mapping
// ------------------------------------------------------------------------------------------------
test('glyph wave: triangle follows the quarters and agrees with the model', () => {
  near(triangle(0), 0, 1e-12);
  near(triangle(0.25), 1, 1e-12);
  near(triangle(0.5), 0, 1e-12);
  near(triangle(0.75), -1, 1e-12);
  near(triangle(1), 0, 1e-12);
  near(triangle(0.125), 0.5, 1e-12);
  near(triangle(1.25), 1, 1e-12, 'periodic');
  // glyph value / M of the library (continuous phase vs quantised index)
  for (const t of [VECTOR_A, 946684800.3, 2886085800]) {
    for (const L of [0, 2, 5, 6, 9, 12]) {
      const l = model.levelAt(t, L, { strokes: 2 });
      const M = 4;
      const x = triangle(l.phase);
      assert.ok(Math.abs(x - l.value / M) <= 1 / M + 1e-9, `L${L}@${t}: ${x} vs ${l.value / M}`);
    }
  }
});

test('glyph value of the model is the quantised triangle: within one step, same sign away from the nodes', () => {
  // 1 / M is the true resolution of a 2-stroke glyph (the worst case reaches 0.99999 of a step), so the
  // tolerance cannot be tighter; the phase itself is pinned to 2e-4 of a cycle in the next test
  let worst = 0;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 1500; i++) {
    const t = model.tMin + rnd() * (model.tMax - model.tMin);
    const L = Math.floor(rnd() * 14);
    const l = model.levelAt(t, L, { strokes: 2 });
    const x = triangle(l.phase) * 4;
    worst = Math.max(worst, Math.abs(x - l.value));
    if (Math.abs(x) > 1) assert.equal(Math.sign(l.value), Math.sign(x), `L${L}@${t}: ${x} vs ${l.value}`);
  }
  assert.ok(worst <= 1 + 1e-9, 'worst ' + worst);
});

test('float phase from the catalogue position matches model.levelAt().phase', () => {
  for (const t of [VECTOR_A, 946684800.123, 2886085800.9, 125593320.5]) {
    const pos = model.positionOf(t);
    for (let L = 0; L <= 13; L++) {
      const exact = model.levelAt(t, L).phase;
      let d = Math.abs(phaseOf(pos, model.levelInfo(L).prefixNum) - exact);
      d = Math.min(d, 1 - d);
      assert.ok(d < 2e-4, `L${L}@${t}: ${d}`);
    }
  }
});

test('loudness: silent valley, full peak, monotone, mean consistent', () => {
  assert.equal(loudness(-1), 0);
  assert.equal(loudness(1), 1);
  assert.ok(loudness(0) > 0.2 && loudness(0) < 0.6);
  let prev = -1;
  for (let x = -1; x <= 1; x += 0.05) {
    const v = loudness(x);
    assert.ok(v >= prev);
    prev = v;
  }
  // numerical mean over a cycle equals the analytic mean
  let s = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) s += loudness(triangle((i + 0.5) / n));
  near(s / n, meanLoudness(), 1e-4);
});

test('amplitude modulation is true up to 25 Hz, absent from 32 Hz on (short cross-fade)', () => {
  assert.equal(AM_FULL_HZ, 25);
  assert.equal(AM_NONE_HZ, 32);
  assert.equal(amWeight(0.64), 1);
  assert.equal(amWeight(22.5), 1, 'xi keeps its true 22.5 Hz modulation at full depth');
  assert.equal(amWeight(25), 1);
  assert.equal(amWeight(32), 0);
  assert.equal(amWeight(80), 0);
  assert.equal(amWeight(1e6), 0);
  near(amWeight(28.5), 0.5, 1e-12, 'linear cross-fade in between');
  assert.ok(amWeight(26) > amWeight(30) && amWeight(30) > 0);
  for (let hz = 0.1; hz < 200; hz *= 1.07) assert.ok(amWeight(hz * 1.01) <= amWeight(hz) + 1e-12, 'never rises with the rate');
  assert.deepEqual([22.5, 25, 26, 31.9, 32, 90].map(amZone), ['full', 'full', 'fade', 'fade', 'rest', 'rest']);
  // above the limit every phase gives the mean loudness
  near(voiceLoudness(0.25, 500), meanLoudness(), 1e-12);
  near(voiceLoudness(0.75, 500), meanLoudness(), 1e-12);
  near(voiceLoudness(0.25, 32), meanLoudness(), 1e-12);
  near(voiceLoudness(0.75, 32), meanLoudness(), 1e-12);
  assert.equal(voiceLoudness(0.25, 0.5), 1);
  assert.equal(voiceLoudness(0.75, 0.5), 0);
  near(voiceLoudness(0.75, 0.5, { floor: 0.06 }), 0.06, 1e-12);
  // real-time cycle rates of the fast levels at real speed
  near(cycleHz(model.levelInfo(11).meanSeconds, 1), 0.643, 0.001);
  near(cycleHz(model.levelInfo(12).meanSeconds, -1), 3.216, 0.005);
  near(cycleHz(model.levelInfo(13).meanSeconds, 1), 22.51, 0.02);
  assert.equal(amWeight(cycleHz(model.levelInfo(13).meanSeconds, 1)), 1, 'the clock heartbeat (mu 0.64, nu 3.2, xi 22.5 Hz) is untouched');
  // the presets that used to park a default voice in the 30-80 Hz roughness band now rest at their mean loudness
  const hzAt = (L, rate) => cycleHz(model.levelInfo(L).meanSeconds, rate);
  near(hzAt(11, 60), 38.6, 0.1);
  near(hzAt(9, 3600), 35.6, 0.1);
  near(hzAt(7, 86400), 42.8, 0.1);
  for (const [L, rate] of [[11, 60], [9, 3600], [7, 86400]]) {
    assert.equal(amWeight(hzAt(L, rate)), 0, `depth ${L + 1} at x${rate}`);
    near(voiceLoudness(0.25, hzAt(L, rate)), voiceLoudness(0.75, hzAt(L, rate)), 1e-12, 'a steady tone, no 35-43 Hz buzz');
  }
  // direction cue: rising through the start node, falling through the middle node, neutral at extrema
  near(directionCue(0), 1, 1e-12);
  near(directionCue(0.5), -1, 1e-12);
  near(directionCue(0.25), 0, 1e-12);
  assert.equal(directionWeight(0.5), 1);
  assert.equal(directionWeight(8), 0);
});

// ------------------------------------------------------------------------------------------------
// chime events
// ------------------------------------------------------------------------------------------------
test('chime floor decides which thresholds sound (explicit 0.12 s: the dense floor kept selectable)', () => {
  const mean = (L) => model.levelInfo(L).meanSeconds;
  const F = 0.12;
  assert.equal(chimeMode(mean(11), 1, F), 'quarters', 'mu: 1.55 s cycle');
  assert.equal(chimeMode(mean(12), 1, F), 'ends', 'nu: 0.31 s cycle, quarters only 78 ms apart');
  assert.equal(chimeMode(mean(13), 1, F), null, 'xi: 44 ms');
  assert.equal(chimeMode(mean(6), 0, F), null, 'paused');
  assert.equal(chimeMode(mean(6), -3600, F), 'quarters', 'direction does not matter');
  assert.equal(chimeMode(mean(8), 3600, F), 'ends', 'iota in a time-lapse: 0.14 s cycle');
  assert.equal(chimeMode(mean(7), 3600, F), 'quarters', 'theta: 0.56 s cycle, quarters 0.14 s apart');
  assert.equal(chimeMode(mean(9), 3600, F), null, 'kappa: 28 ms cycle');
  assert.equal(chimeMode(mean(12), 1, 0.5), null, 'a higher floor silences nu');
});

test('the calm default floor (0.5 s): mu rings only its ends, lambda its quarters, nu stays silent', () => {
  assert.equal(DEFAULT_FLOOR, 0.5);
  assert.equal(DEFAULT_SETTINGS.floor, 0.5);
  const mean = (L) => model.levelInfo(L).meanSeconds;
  assert.equal(chimeMode(mean(10), 1), 'quarters', 'lambda: 7.77 s cycle, a quarter every 1.94 s');
  assert.equal(chimeMode(mean(11), 1), 'ends', 'mu: 1.55 s cycle, quarters 0.39 s apart would be a rattle');
  assert.equal(chimeMode(mean(12), 1), null, 'nu: 0.31 s cycle');
  assert.equal(chimeMode(mean(12), 1, 0.25), 'ends', 'but a 0.25 s floor keeps nu');
  for (const f of FLOORS) assert.ok(f > 0, 'every selectable floor stays available');
  assert.ok(FLOORS.includes(0.05) && FLOORS.includes(0.12) && FLOORS.includes(0.25) && FLOORS.includes(0.5) && FLOORS.includes(1));
  // bell stream at the defaults (levels 1-12, real time): about 1.2 bells a second, none above 3 kHz needed for nu
  const evs = eventsInWindow(model, VECTOR_A, VECTOR_A + 120, { rate: 1 });
  const bells = evs.reduce((n, e) => n + e.parts.length, 0);
  assert.ok(bells / 120 > 1.0 && bells / 120 < 1.5, `${(bells / 120).toFixed(2)} bells per second`);
  const muEvents = evs.filter((e) => e.parts.some((p) => p.level === 11));
  assert.ok(muEvents.every((e) => e.parts.filter((p) => p.level === 11).every((p) => p.kind === 'end')), 'mu rings its end only');
  near(muEvents.length / 120, 1 / mean(11), 0.1, 'about 0.64 ends a second');
  // the dense default of before: three times as many bells
  const dense = eventsInWindow(model, VECTOR_A, VECTOR_A + 120, { rate: 1, floor: 0.12 }).reduce((n, e) => n + e.parts.length, 0);
  assert.ok(dense / 120 > 2.5 * (bells / 120), `${(dense / 120).toFixed(2)} bells per second at 0.12 s`);
  // the All preset no longer rings nu
  const all = eventsInWindow(model, VECTOR_A, VECTOR_A + 60, { levels: presetLevels(1, 14).flatMap((on, L) => (on ? [L] : [])), rate: 1 });
  assert.ok(!all.some((e) => e.levels.includes(12) || e.levels.includes(13)), 'no 3 kHz tick every 311 ms in the All preset');
});

test('vector A: the depth-7 end is found and merged with every finer end into one chord event', () => {
  const evs = eventsInWindow(model, ETA_END - 1, ETA_END + 1, { levels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], rate: 1, floor: 0.12 });
  const end = evs.find((e) => Math.abs(e.time - ETA_END) < 5e-4);
  assert.ok(end, 'depth-7 end at 1791464172.428');
  assert.equal(end.kind, 'end');
  assert.equal(end.top, 6);
  // eta, theta, iota, kappa, lambda, mu, nu end together; xi is too fast to chime at real speed
  assert.deepEqual(end.levels, [6, 7, 8, 9, 10, 11, 12]);
  assert.equal(end.ends, 7);
  assert.equal(end.parts.length, 7);
  assert.ok(end.parts.every((p) => p.kind === 'end'));
  assert.equal(evs.filter((e) => Math.abs(e.time - ETA_END) < 1e-3).length, 1, 'coincident ends are merged, not repeated');
  near(end.time, ETA_END, 5e-4);
  // sorted, inside the half-open window
  for (let i = 1; i < evs.length; i++) assert.ok(evs[i].time >= evs[i - 1].time);
  assert.ok(evs.every((e) => e.time > ETA_END - 1 && e.time <= ETA_END + 1));
  // at the calm default floor nu is left out of the chord, the rest is the same event
  const calm = eventsInWindow(model, ETA_END - 1, ETA_END + 1, { levels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], rate: 1 });
  assert.deepEqual(calm.find((e) => Math.abs(e.time - ETA_END) < 5e-4).levels, [6, 7, 8, 9, 10, 11]);
});

test('events agree with the model: thresholds and merged ends', () => {
  // the quarter thresholds of the current depth-7 cycle (SPEC 6.2) are all found, with the right kinds
  const cur = model.levelAt(VECTOR_A, 6);
  const evs = eventsInWindow(model, cur.start - 1, cur.end + 1, { levels: [6], rate: 1 });
  const byKind = Object.fromEntries(evs.filter((e) => e.time > cur.start && e.time <= cur.end + 0.001).map((e) => [e.kind, e.time]));
  const th = Object.fromEntries(cur.thresholds.map((t, i) => [['begin', 'peak', 'node', 'valley', 'end'][i], t.time]));
  for (const k of ['peak', 'node', 'valley', 'end']) near(byKind[k], th[k], 2e-6, k);
  // upcomingEnds (BigInt, merged across levels) and eventsInWindow (float quarters) tell the same story
  const levels = [4, 5, 6, 7, 8];
  const up = model.upcomingEnds(VECTOR_A, { fromLevel: 4, toLevel: 8, count: 12, perLevel: 12 });
  const mine = eventsInWindow(model, VECTOR_A, up.at(-1).time + 0.01, { levels, rate: 1, floor: 1e-6 }).filter((e) => e.kind === 'end' || e.parts.some((p) => p.kind === 'end'));
  for (const u of up) {
    const m = mine.find((e) => Math.abs(e.time - u.time) < 2e-3);
    assert.ok(m, 'event at ' + u.time);
    assert.deepEqual(
      m.parts.filter((p) => p.kind === 'end').map((p) => p.level),
      u.levels,
    );
  }
});

test('consecutive windows tile the time axis: every threshold exactly once', () => {
  const opts = { levels: [3, 4, 5, 6, 7, 8, 9, 10, 11], rate: 1 };
  const whole = eventsInWindow(model, VECTOR_A, VECTOR_A + 400, opts);
  const pieces = [];
  for (let t = VECTOR_A; t < VECTOR_A + 400; t += 0.5) pieces.push(...eventsInWindow(model, t, Math.min(t + 0.5, VECTOR_A + 400), opts));
  assert.ok(whole.length > 100);
  assert.deepEqual(
    pieces.map((e) => [e.time, e.kind, e.levels.join()]),
    whole.map((e) => [e.time, e.kind, e.levels.join()]),
  );
});

test('muted levels and the chime floor remove events; strength grows with the number of ends', () => {
  const all = eventsInWindow(model, VECTOR_A, VECTOR_A + 60, { levels: [9, 10, 11, 12, 13], rate: 1, floor: 0.12 });
  assert.ok(all.some((e) => e.levels.includes(12)), 'nu rings');
  assert.ok(!all.some((e) => e.levels.includes(13)), 'xi never chimes at real speed');
  const quiet = eventsInWindow(model, VECTOR_A, VECTOR_A + 60, { levels: [9, 10, 11, 12, 13], rate: 1, floor: 0.5 });
  assert.ok(!quiet.some((e) => e.levels.includes(12)));
  const onlyMu = eventsInWindow(model, VECTOR_A, VECTOR_A + 60, { levels: [11], rate: 1, floor: 0.12 });
  assert.ok(onlyMu.every((e) => e.levels.join() === '11'));
  assert.ok(onlyMu.length >= 152 && onlyMu.length <= 156, 'mu: a quarter every 0.39 s, got ' + onlyMu.length);
  assert.deepEqual(eventsInWindow(model, VECTOR_A, VECTOR_A + 60, { levels: [], rate: 1 }), []);
  assert.deepEqual(eventsInWindow(model, VECTOR_A, VECTOR_A + 60, { levels: [9], rate: 0 }), [], 'paused: silence');
  for (let n = 1; n < 12; n++) assert.ok(eventStrength('end', n + 1) > eventStrength('end', n) || eventStrength('end', n) >= 0.99);
  assert.ok(eventStrength('end', 1) > eventStrength('node', 1));
  assert.ok(eventStrength('peak', 1) > eventStrength('node', 1));
  assert.ok(eventStrength('end', 12) <= 1);
});

test('time-lapse: slower levels only; a window outside the catalogue is empty', () => {
  const lapse = eventsInWindow(model, VECTOR_A, VECTOR_A + 3600 * 5, { levels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], rate: 3600, floor: 0.12 });
  const used = new Set(lapse.flatMap((e) => e.levels));
  assert.ok(used.has(8) && !used.has(9) && !used.has(10), 'at x3600 only levels with a cycle >= 0.12 s of real time chime');
  const calm = eventsInWindow(model, VECTOR_A, VECTOR_A + 3600 * 5, { levels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], rate: 3600 });
  const usedCalm = new Set(calm.flatMap((e) => e.levels));
  assert.ok(usedCalm.has(7) && !usedCalm.has(8), 'at the default 0.5 s floor the finest voice that rings at x3600 is theta (0.56 s cycle)');
  assert.deepEqual(eventsInWindow(model, model.tMax + 5, model.tMax + 50, { rate: 1 }), []);
  assert.deepEqual(eventsInWindow(model, model.tMin - 50, model.tMin - 5, { rate: 1 }), []);
  assert.deepEqual(eventsInWindow(model, VECTOR_A + 5, VECTOR_A, { rate: 1 }), []);
  // never extrapolates beyond the catalogue end
  const edge = eventsInWindow(model, model.tMax - 30, model.tMax + 3000, { levels: [8, 9, 10, 11], rate: 1 });
  assert.ok(edge.every((e) => e.time <= model.tMax));
  // at the very start of the catalogue the first threshold is after tMin
  const start = eventsInWindow(model, model.tMin - 1, model.tMin + 20, { levels: [10, 11], rate: 1 });
  assert.ok(start.every((e) => e.time > model.tMin - 1e-9 && e.time <= model.tMin + 20));
});

// ------------------------------------------------------------------------------------------------
// clock map, tempo lock, settings
// ------------------------------------------------------------------------------------------------
test('clock map is linear and invertible; paused maps to infinity', () => {
  const m = createClockMap();
  m.set(10, 1000, 2000);
  assert.equal(m.tAt(10), 1000);
  assert.equal(m.tAt(11), 3000);
  assert.equal(m.aAt(3000), 11);
  m.set(10, 1000, -4);
  assert.equal(m.tAt(12), 992);
  assert.equal(m.aAt(992), 12);
  m.set(0, 5, 0);
  assert.equal(m.aAt(6), Infinity);
  assert.equal(m.tAt(100), 5);
});

test('tempo lock: one cycle of depth N lasts x seconds, quarters are the beats', () => {
  const r = tempoRate(model, 7, 4);
  near(r, model.levelInfo(6).meanSeconds / 4, 1e-9);
  near(r, 4547.2, 0.5);
  const info = tempoInfo(model, 7, r);
  near(info.cycle, 4, 1e-9);
  near(info.beat, 1, 1e-9);
  near(info.bpm, 60, 1e-9);
  assert.equal(info.childPerCycle, 9, 'depth 7 holds 9 cycles of depth 8');
  near(info.child, 4 / 9, 1e-9);
  assert.equal(tempoInfo(model, 7, 0).bpm, 0);
  // the next levels subdivide by the sequence 9, 4, 5, 13, 5, 5, 7, 11
  let cycle = 4;
  const seq = [];
  for (let d = 7; d < 13; d++) {
    const i = tempoInfo(model, d, tempoRate(model, 7, 4) * 1);
    seq.push(Math.round(cycle / i.child));
    cycle = i.child;
  }
  assert.deepEqual(seq, [9, 4, 5, 13, 5, 5]);
});

test('settings: sanitising, presets and persistence', () => {
  assert.deepEqual(sanitize(null), sanitize(undefined));
  const s = sanitize({ volumeDb: 12, reverb: -3, baseHz: 5, floor: 99, physShift: 8.6, levels: [true], tempo: { depth: 99, seconds: -1 }, chord: 'yes' });
  assert.equal(s.volumeDb, -3);
  assert.equal(s.reverb, 0);
  assert.equal(s.baseHz, 55);
  assert.equal(s.floor, 2);
  assert.equal(s.physShift, 3);
  assert.equal(s.levels.length, 14, 'a malformed mask falls back to the default');
  assert.equal(s.tempo.depth, 14);
  assert.equal(s.tempo.seconds, 0.25);
  assert.equal(s.chord, true);
  assert.deepEqual(sanitize(DEFAULT_SETTINGS), { ...DEFAULT_SETTINGS, levels: [...DEFAULT_SETTINGS.levels], tempo: { ...DEFAULT_SETTINGS.tempo } });
  assert.equal(DEFAULT_SETTINGS.volumeDb, -18);
  assert.equal(DEFAULT_SETTINGS.baseHz, 110);
  assert.equal(DEFAULT_SETTINGS.levels.filter(Boolean).length, 12);
  assert.equal(DEFAULT_SETTINGS.floor, 0.5, 'calm default chime floor');
  assert.equal(sanitize({ floor: 0.12 }).floor, 0.12, 'the dense floor stays selectable');
  assert.equal(matchPreset(presetLevels(1, 7)), 'slow');
  assert.equal(matchPreset(presetLevels(1, 12)), 'default');
  assert.equal(matchPreset(presetLevels(1, 14)), 'all');
  assert.equal(matchPreset(presetLevels(2, 5)), null);
  near(dbToGain(-18), 0.1259, 1e-3);

  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(saveSettings({ ...sanitize({}), volumeDb: -30 }, storage), true);
  assert.equal(loadSettings(storage).volumeDb, -30);
  store.set(STORAGE_KEY, '{not json');
  assert.equal(loadSettings(storage).volumeDb, -18, 'corrupt storage falls back to defaults');
  assert.equal(saveSettings({}, { setItem() { throw new Error('blocked'); } }), false);
  assert.equal(loadSettings({ getItem() { throw new Error('blocked'); } }).volumeDb, -18);
});

// ------------------------------------------------------------------------------------------------
// engine with a recording fake of the Web Audio API
// ------------------------------------------------------------------------------------------------
class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(v, t) {
    this.events.push({ type: 'set', v, t });
    return this;
  }
  linearRampToValueAtTime(v, t) {
    this.events.push({ type: 'lin', v, t });
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    this.events.push({ type: 'exp', v, t });
    return this;
  }
  setTargetAtTime(v, t, k) {
    this.events.push({ type: 'target', v, t, k });
    return this;
  }
  cancelScheduledValues(t) {
    this.events = this.events.filter((e) => e.t < t);
    return this;
  }
  cancelAndHoldAtTime(t) {
    this.events = this.events.filter((e) => e.t < t);
    this.events.push({ type: 'hold', t });
    return this;
  }
}
class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.out = [];
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
    this.gain = new FakeParam(1);
    this.pan = new FakeParam(0);
    this.threshold = new FakeParam(0);
    this.knee = new FakeParam(0);
    this.ratio = new FakeParam(0);
    this.attack = new FakeParam(0);
    this.release = new FakeParam(0);
    this.disconnected = false;
  }
  connect(n) {
    this.out.push(n);
    return n;
  }
  disconnect() {
    this.disconnected = true;
  }
  start(t) {
    this.startedAt = t;
  }
  stop(t = 0) {
    this.stoppedAt = t;
  }
}
class FakeContext {
  constructor({ state = 'running', outputLatency = 0 } = {}) {
    this.currentTime = 0;
    this.state = state;
    this.outputLatency = outputLatency;
    this.sampleRate = 48000;
    this.nodes = [];
    this.destination = new FakeNode(this, 'destination');
    this.resumeGate = null; // set to a promise to make resume() slow, like a real browser
  }
  _mk(kind) {
    const n = new FakeNode(this, kind);
    this.nodes.push(n);
    return n;
  }
  createOscillator() {
    return this._mk('osc');
  }
  createGain() {
    return this._mk('gain');
  }
  createStereoPanner() {
    return this._mk('pan');
  }
  createWaveShaper() {
    return this._mk('shaper');
  }
  createConvolver() {
    return this._mk('convolver');
  }
  createDynamicsCompressor() {
    return this._mk('comp');
  }
  createAnalyser() {
    return this._mk('analyser');
  }
  createBuffer(ch, len) {
    return { getChannelData: () => new Float32Array(len) };
  }
  async suspend() {
    this.state = 'suspended';
  }
  async resume() {
    if (this.resumeGate) await this.resumeGate;
    this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }
}

/** Timers the test drives by hand: nothing runs until `advance(ms)`. */
function manualTimers() {
  let now = 0;
  let next = 0;
  const jobs = new Map();
  const add = (fn, ms, every) => {
    const h = ++next;
    jobs.set(h, { fn, ms, at: now + ms, every });
    return h;
  };
  return {
    setInterval: (fn, ms) => add(fn, ms, true),
    setTimeout: (fn, ms) => add(fn, ms, false),
    clearInterval: (h) => jobs.delete(h),
    clearTimeout: (h) => jobs.delete(h),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let hit = null;
        for (const [h, j] of jobs) if (j.at <= end && (!hit || j.at < hit[1].at)) hit = [h, j];
        if (!hit) break;
        const [h, j] = hit;
        now = j.at;
        if (j.every) j.at += j.ms;
        else jobs.delete(h);
        j.fn();
      }
      now = end;
    },
    /** live repeating timers (the scheduler tick) */
    get intervals() {
      return [...jobs.values()].filter((j) => j.every).length;
    },
    get pending() {
      return jobs.size;
    },
  };
}

function makeEngine({ t0 = VECTOR_A, rate = 1, settings = {}, log = [], timers, hidden = false, context } = {}) {
  const ac = context ?? new FakeContext();
  const clk = { rate, base: t0, t0, t: () => clk.base + clk.rate * ac.currentTime };
  timers ??= { setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} };
  const engine = createEngine({
    model,
    clock: { t: () => clk.t(), rate: () => clk.rate },
    createContext: () => ac,
    settings,
    timers,
    hidden: () => hidden,
    log,
  });
  return { engine, ac, clk, log, timers };
}
const oscs = (ac, hz) => ac.nodes.filter((n) => n.kind === 'osc' && Math.abs(n.frequency.value - hz) < 0.01);

test('settings: stored settings keep their values; the old default floor moves to the new one once', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  // saved by the version before the revision field: floor 0.12 was the default then, so it is not a choice
  store.set(STORAGE_KEY, JSON.stringify({ volumeDb: -24, floor: 0.12, reverb: 0.5 }));
  let s = loadSettings(storage);
  assert.equal(s.floor, 0.5);
  assert.equal(s.volumeDb, -24, 'everything else is kept');
  assert.equal(s.reverb, 0.5);
  store.set(STORAGE_KEY, JSON.stringify({ floor: 0.25 }));
  assert.equal(loadSettings(storage).floor, 0.25, 'a floor chosen earlier is kept');
  store.set(STORAGE_KEY, JSON.stringify({ floor: 1 }));
  assert.equal(loadSettings(storage).floor, 1);
  // once saved by this version, a deliberate 0.12 is kept
  saveSettings({ ...sanitize({}), floor: 0.12 }, storage);
  assert.equal(JSON.parse(store.get(STORAGE_KEY)).rev, SETTINGS_REV);
  assert.equal(loadSettings(storage).floor, 0.12);
  store.set(STORAGE_KEY, 'null');
  assert.equal(loadSettings(storage).floor, 0.5);
  store.set(STORAGE_KEY, '42');
  assert.equal(loadSettings(storage).floor, 0.5);
  assert.deepEqual(sanitize(JSON.parse('{"rev":2}')), sanitize({}), 'the revision field is not part of the settings');
});

test('engine: starts one drone voice per sounding level at its tuned pitch', async () => {
  const { engine, ac } = makeEngine();
  assert.equal(engine.enabled, false);
  assert.equal(await engine.start(), true);
  assert.equal(engine.enabled, true);
  assert.deepEqual(engine.voiceLevels(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (const L of engine.voiceLevels()) {
    const f = frequencyOf(engine.tuning[L], 110);
    assert.ok(oscs(ac, f).length >= 2, `two detuned sines at depth ${L + 1}`);
    assert.equal(oscs(ac, 2 * f).length >= 1, true, 'quiet second harmonic');
  }
  assert.equal(engine.stats().chordVoices, 12);
  // the drone is faded in (never an instant jump)
  const fader = ac.nodes.filter((n) => n.kind === 'gain').find((n) => n.gain.events.some((e) => e.type === 'lin' && e.v === 1 && e.t > 0.1));
  assert.ok(fader, 'fader ramps up over 120 ms');
  await engine.stop();
  assert.equal(engine.enabled, false);
  engine.destroy();
});

test('engine: the 2nd harmonic is silent exactly where it would beat against another sounding voice', async () => {
  const { engine, ac } = makeEngine();
  await engine.start();
  const skipped = engine.skippedHarmonics();
  assert.deepEqual(skipped.map((L) => L + 1), [1, 2, 3, 6, 8, 9, 10], 'alpha beta gamma zeta theta iota kappa');
  /** the gain node of the 2f oscillator of a level and its first scheduled value */
  const harmonicGain = (L) => oscs(ac, 2 * engine.frequency(L)).map((o) => o.out[0]).find((n) => n.gain.events.some((e) => e.type === 'set'));
  for (const L of engine.voiceLevels()) {
    const g = harmonicGain(L);
    const first = g.gain.events.find((e) => e.type === 'set').v;
    if (skipped.includes(L)) assert.equal(first, 0, `depth ${L + 1}: no 2nd harmonic`);
    else assert.ok(first > 0.01 && first < 0.19, `depth ${L + 1}: quiet 2nd harmonic (0.1 +- the direction cue), got ${first}`);
  }
  // its automation stays at 0 while the cycle runs (no leftover 0.1 level in the ramps)
  for (let i = 1; i <= 10; i++) {
    ac.currentTime = i * 0.05;
    engine.tick();
  }
  for (const L of skipped) {
    const ramps = harmonicGain(L).gain.events.filter((e) => e.type === 'lin');
    assert.ok(ramps.length > 0 && ramps.every((e) => e.v === 0), `depth ${L + 1} stays silent`);
  }
  assert.ok(harmonicGain(4).gain.events.filter((e) => e.type === 'lin').every((e) => e.v > 0.01 && e.v < 0.19), 'epsilon keeps its partial (0.1 +- the direction cue)');

  // the partner muted -> the partial comes back (40 ms blend), unmuted -> it goes again
  engine.update({ levels: presetLevels(1, 14).map((on, L) => on && L !== 2 && L < 12) });
  assert.ok(!engine.skippedHarmonics().includes(0), 'alpha: gamma is muted, its 2f is free again');
  assert.ok(engine.skippedHarmonics().includes(1), 'beta still clashes with delta');
  const ev = harmonicGain(0).gain.events;
  const hold = ev.findIndex((e) => e.type === 'hold');
  assert.ok(hold >= 0 && ev[hold + 1].type === 'lin' && ev[hold + 1].v > 0.01 && ev[hold + 1].t - ev[hold].t <= 0.041, 'held, then blended in within 40 ms: never a jump');
  ac.currentTime = 0.6;
  engine.tick();
  assert.ok(harmonicGain(0).gain.events.filter((e) => e.type === 'lin').some((e) => e.v > 0.01), 'alpha plays its partial now');
  engine.update({ levels: presetLevels(1, 12) });
  assert.deepEqual(engine.skippedHarmonics().map((L) => L + 1), [1, 2, 3, 6, 8, 9, 10]);
  // a Slow chord (depths 1-7): only the pairs inside it count
  engine.update({ levels: presetLevels(1, 7) });
  assert.deepEqual(engine.skippedHarmonics().map((L) => L + 1), [1, 2]);
  engine.destroy();
});

test('engine: bells of the quarters: the valley is an octave lower than the peak at every depth', async () => {
  const log = [];
  const { engine } = makeEngine({ t0: VECTOR_A, rate: 1, log, settings: { floor: 0.12, levels: presetLevels(1, 14) } });
  await engine.start();
  for (let i = 1; i <= 40; i++) {
    engine.context.currentTime = i * 0.25;
    engine.tick();
  }
  const fMu = (kind) => log.filter((n) => n.level === 11 && n.kind === kind).map((n) => n.f);
  assert.ok(fMu('valley').length >= 2 && fMu('peak').length >= 2, 'mu rings its quarters at the 0.12 s floor');
  for (const f of fMu('peak')) near(f, 2399.6, 0.5);
  for (const f of fMu('valley')) near(f, 1199.8, 0.5, 'mu valley: an octave below its peak (it used to be the same pitch)');
  for (const L of [6, 7, 8, 9, 10, 11]) {
    const peaks = log.filter((n) => n.level === L && n.kind === 'peak');
    const valleys = log.filter((n) => n.level === L && n.kind === 'valley');
    if (peaks.length && valleys.length) near(valleys[0].f * 2, peaks[0].f, 1e-9, `depth ${L + 1}`);
  }
  engine.destroy();
});

test('engine: a graph that cannot be built leaves a clean, retryable engine (no half-initialised context)', async () => {
  const contexts = [];
  let broken = true;
  class BrokenContext extends FakeContext {
    createConvolver() {
      if (broken) throw new Error('convolver unsupported');
      return super.createConvolver();
    }
  }
  const clk = { rate: 1, base: VECTOR_A };
  const engine = createEngine({
    model,
    clock: { t: () => clk.base, rate: () => clk.rate },
    createContext: () => {
      const c = new BrokenContext();
      contexts.push(c);
      return c;
    },
    timers: { setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} },
  });
  await assert.rejects(engine.start(), /convolver unsupported/);
  assert.equal(engine.enabled, false, 'a failed start does not leave the engine "on"');
  assert.equal(engine.context, null, 'no context without a graph');
  assert.equal(engine.analyser, null);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].state, 'closed', 'the context that was created is closed');
  // the second click fails the same honest way, it never reads the missing graph
  await assert.rejects(engine.start(), /convolver unsupported/);
  assert.equal(contexts.length, 2, 'every attempt starts from scratch');
  assert.equal(contexts[1].state, 'closed');
  await assert.rejects(engine.playMoment(VECTOR_A), /convolver unsupported/, 'hear this moment fails cleanly too');
  assert.equal(engine.context, null);
  assert.equal(engine.enabled, false);
  // the browser recovers (or the user retries): everything works
  broken = false;
  assert.equal(await engine.start(), true);
  assert.equal(engine.enabled, true);
  assert.ok(engine.context && engine.analyser, 'a complete context');
  assert.equal(engine.stats().chordVoices, 12);
  assert.equal(contexts.length, 4);
  assert.deepEqual(contexts.slice(0, 3).map((c) => c.state), ['closed', 'closed', 'closed']);
  const m = await engine.playMoment(VECTOR_A);
  assert.equal(m.notes.length, 12);
  engine.destroy();
  assert.equal(contexts[3].state, 'closed');
});

test('engine: voice loudness follows the glyph wave and never produces NaN or runaway gains', async () => {
  const { engine, ac, clk } = makeEngine({ rate: 3600 });
  await engine.start();
  for (let i = 1; i <= 20; i++) {
    ac.currentTime = i * 0.05;
    engine.tick();
  }
  const cycle = ac.nodes.filter((n) => n.kind === 'gain' && n.gain.events.filter((e) => e.type === 'lin').length > 20);
  assert.ok(cycle.length >= 12, 'every voice has a gain curve, got ' + cycle.length);
  for (const n of cycle) {
    let last = -Infinity;
    for (const e of n.gain.events) {
      assert.ok(Number.isFinite(e.v) && e.v >= 0 && e.v < 1, 'finite, bounded gain ' + e.v);
      if (e.type === 'lin') {
        assert.ok(e.t >= last, 'automation times never go backwards');
        last = e.t;
      }
    }
  }
  // the depth-7 voice (a 5 h cycle: 18 s at x3600) follows the glyph wave of the model exactly
  const eta = engine.voiceLevels().find((L) => L === 6);
  const f = engine.frequency(eta);
  const gainNode = oscs(ac, f)[0].out[0];
  const lin = gainNode.gain.events.filter((e) => e.type === 'lin');
  assert.ok(lin.length > 10);
  for (const e of lin.slice(0, 12)) {
    const t = clk.t0 + 3600 * e.t;
    const exact = model.levelAt(t, 6).phase;
    const want = VOICE_AMP * weightFor(f) * voiceLoudness(exact, cycleHz(model.levelInfo(6).meanSeconds, 3600));
    near(e.v, want, 2e-4, 'gain at audio time ' + e.t);
  }
  engine.destroy();
});

test('engine: a cycle end rings once as a strummed chord, coarse to fine, 15 ms apart', async () => {
  const { engine, ac, log } = makeEngine({ t0: ETA_END - 1 });
  await engine.start();
  assert.equal(log.filter((n) => n.level === 6).length, 0, 'depth 7 is silent before its turnover');
  ac.currentTime = 0.5;
  engine.tick();
  ac.currentTime = 0.9;
  engine.tick();
  ac.currentTime = 1.3;
  engine.tick(); // a second pass over the same area must not repeat the strum
  const strum = log.filter((n) => n.kind === 'end' && Math.abs(n.when - 1) < 0.2);
  assert.equal(strum.length, 6, 'eta..mu (depths 7-12) end together; the sounding set stops at depth 12');
  assert.deepEqual(strum.map((n) => n.level), [6, 7, 8, 9, 10, 11], 'coarse -> fine');
  strum.forEach((n, i) => {
    near(n.when, 1 + i * 0.015, 0.002, 'note ' + i);
    near(n.f, chimeFrequency(frequencyOf(engine.tuning[n.level], 110), 'end'), 1e-9);
  });
  // bigger turnovers are louder and ring longer than a lone bell
  assert.ok(strum[0].decay > 1.5 * 1.2);
  engine.destroy();
});

test('engine: reversed time reverses the order of the strum (fine -> coarse); paused time is silent', async () => {
  const back = makeEngine({ t0: ETA_END + 1, rate: -1 });
  await back.engine.start();
  back.ac.currentTime = 0.5;
  back.engine.tick();
  back.ac.currentTime = 0.9;
  back.engine.tick();
  const strum = back.log.filter((n) => n.kind === 'end' && Math.abs(n.when - 1) < 0.2);
  assert.deepEqual(strum.map((n) => n.level), [11, 10, 9, 8, 7, 6], 'fine -> coarse when time runs backwards');
  near(strum[0].when, 1, 0.002);
  back.engine.destroy();

  const paused = makeEngine({ t0: ETA_END - 1, rate: 0 });
  await paused.engine.start();
  for (let i = 1; i < 40; i++) {
    paused.ac.currentTime = i * 0.1;
    paused.engine.tick();
  }
  assert.equal(paused.log.length, 0, 'paused: the drone holds, no bells');
  paused.engine.destroy();
});

test('engine: a jump cancels pending bells and re-anchors without repeating or skipping', async () => {
  const { engine, ac, clk, log } = makeEngine({ t0: ETA_END - 1.5 });
  await engine.start();
  ac.currentTime = 0.2;
  engine.tick(); // schedules up to +0.8 s of audio: nothing yet (end at 1.5 s)
  ac.currentTime = 1.0;
  engine.tick(); // the end at audio time 1.5 is now scheduled
  const before = log.filter((n) => n.kind === 'end').length;
  assert.ok(before >= 1);
  const pendingOsc = ac.nodes.filter((n) => n.kind === 'osc' && n.startedAt > 1.2);
  assert.ok(pendingOsc.length > 0);
  // the user jumps a day ahead
  clk.base += 86400;
  engine.resync();
  assert.ok(pendingOsc.every((n) => n.stoppedAt === 0), 'bells that had not started are cancelled');
  ac.currentTime = 1.1;
  engine.tick();
  const after = log.slice(before);
  assert.ok(after.every((n) => n.when > 1.1), 'everything scheduled after the jump lies after the jump');
  assert.ok(!after.some((n) => n.kind === 'end' && n.level === 6 && Math.abs(n.when - 1.5) < 0.05), 'the cancelled strum is not replayed');
  engine.destroy();
});

/** Most bells of a recording that sound at the same instant; a stolen bell counts until it is cut. */
function maxOverlap(log) {
  const pts = [];
  for (const n of log) {
    const to = n.stolenAt ?? n.end;
    if (to <= n.when) continue; // never sounded
    pts.push([n.when, 1], [to, -1]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of pts) {
    cur += d;
    max = Math.max(max, cur);
  }
  return max;
}

test('engine: polyphony is capped (never more than MAX_NOTES bells at once)', async () => {
  const log = [];
  const { engine, ac } = makeEngine({ rate: 20000, log, settings: { levels: presetLevels(1, 14), floor: 0.03 } });
  await engine.start();
  for (let i = 1; i <= 60; i++) {
    ac.currentTime = i * 0.05;
    engine.tick();
  }
  assert.ok(log.length > 40, 'a dense time-lapse rings, got ' + log.length);
  assert.ok(maxOverlap(log) <= MAX_NOTES, `overlap ${maxOverlap(log)} <= ${MAX_NOTES}`);
  engine.destroy();

  const burst = [];
  const m = makeEngine({ log: burst });
  for (let i = 0; i < 8; i++) await m.engine.playMoment(VECTOR_A); // 96 identical bells asked for at the same instants
  assert.ok(burst.length < 96 && burst.length >= MAX_NOTES, `ignored the surplus: ${burst.length} of 96`);
  assert.ok(maxOverlap(burst) <= MAX_NOTES, `overlap ${maxOverlap(burst)} <= ${MAX_NOTES}`);
  m.engine.destroy();
});

test('bell priority: the quietest goes first, then the finest, then the oldest; a tie keeps what is there', () => {
  const bell = (o) => ({ amp: 0.1, start: 10, attack: 0.004, decay: 1, level: 5, ...o });
  // quieter loses, whatever the level
  assert.equal(isLessImportant(bell({ amp: 0.05, level: 0 }), bell({ amp: 0.1, level: 13 }), 10.1), true);
  assert.equal(isLessImportant(bell({ amp: 0.1, level: 13 }), bell({ amp: 0.05, level: 0 }), 10.1), false);
  // a bell that has decayed is quieter than a fresh one of the same strength: the oldest goes
  const old = bell({ start: 9 });
  const fresh = bell({ start: 10 });
  assert.ok(bellLoudAt(old, 10.2) < bellLoudAt(fresh, 10.2));
  assert.equal(isLessImportant(old, fresh, 10.2), true);
  assert.equal(isLessImportant(fresh, old, 10.2), false);
  near(bellLoudAt(fresh, 10), 0.1, 1e-12, 'a bell that has not started is at full strength');
  near(bellLoudAt(fresh, 10.004), 0.1, 1e-12, 'and so is one at the end of its attack');
  near(bellLoudAt(fresh, 11.004), 1e-4, 1e-9, 'it is at -80 dB when its decay is over');
  // equal loudness: the finer level (higher number) goes first, then the older one
  assert.equal(isLessImportant(bell({ level: 9 }), bell({ level: 2 }), 10), true);
  assert.equal(isLessImportant(bell({ level: 2 }), bell({ level: 9 }), 10), false);
  assert.equal(isLessImportant(bell({ start: 9.5, amp: 0.1, decay: 0 + 1e-9 }), bell({ start: 9.5, decay: 1e-9 }), 12), false, 'identical bells: neither is less important');
  // a strict order: never both ways
  for (const a of [bell({ amp: 0.2 }), bell({ level: 3 }), bell({ start: 9.7 })])
    for (const b of [bell(), bell({ amp: 0.07, level: 11 })]) assert.ok(!(isLessImportant(a, b, 10.3) && isLessImportant(b, a, 10.3)));
});

test('engine: over the cap the least important bell is stolen, so the coarse notes of a major boundary all ring', async () => {
  // the biggest strum of the clock: the end of the depth-1 cycle ends all 14 levels at once, while every
  // level (floor 0.03 s) rings its own bells: ~320 notes are wanted, far more than the 48 slots
  const T = 2401484716.816;
  const log = [];
  const { engine, ac } = makeEngine({ t0: T - 5, rate: 1, log, settings: { levels: presetLevels(1, 14), floor: 0.03 } });
  await engine.start();
  for (let i = 1; i <= 80; i++) {
    ac.currentTime = i * 0.1;
    engine.tick();
  }
  // five seconds of dense bells have filled the 48 slots when the strum comes (first-come-first-served kept only
  // depths 1-4, 7-10 and 13 of it); note i of the strum rings at 5 s + i * 15 ms
  const strum = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((L) => log.find((n) => n.kind === 'end' && n.level === L && Math.abs(n.when - (5 + L * 0.015)) < 0.003));
  assert.ok(strum.every(Boolean), 'all 14 notes of the strum ring, coarse -> fine: ' + strum.map((n) => (n ? n.level + 1 : '-')).join(' '));
  // each of them rings out: if the cap takes one later, it is only after it has decayed (>= 26 dB down)
  for (const n of strum) assert.ok(!n.stolen || (n.stolenAt - n.when > 1 && n.cutLoud < 0.05 * n.amp), `strum note ${n.level + 1} lived ${(n.stolenAt - n.when).toFixed(2)} s`);
  const stolen = log.filter((n) => n.stolen);
  assert.ok(stolen.length > 20, `the cap really was reached: ${stolen.length} bells made room`);
  assert.ok(maxOverlap(log) <= MAX_NOTES, `never more than ${MAX_NOTES} bells at once, got ${maxOverlap(log)}`);
  // a stolen bell is faded out (20 ms), never cut with a click: its envelope is held, then ramped to 0
  assert.ok(stolen.every((n) => n.end === n.when || n.end - n.stolenAt <= 0.0201), 'fade-out of at most 20 ms');
  const faded = ac.nodes.filter((nd) => nd.kind === 'gain' && nd.gain.events.some((e) => e.type === 'hold') && nd.gain.events.some((e) => e.type === 'lin' && e.v === 0));
  assert.ok(faded.length > 0, 'stolen bells ramp to silence');
  engine.destroy();
});

test('engine: settings change without rebuilding the sound; levels fade in and out', async () => {
  const { engine, ac } = makeEngine();
  await engine.start();
  const gainsBefore = ac.nodes.length;
  engine.update({ volumeDb: -30 });
  engine.update({ reverb: 0.5 });
  assert.equal(ac.nodes.length, gainsBefore, 'volume / reverb only move parameters');
  engine.update({ baseHz: 220 });
  const a = engine.voiceLevels();
  assert.equal(a.length, 12);
  const a1 = oscs(ac, 110)[0];
  assert.ok(a1.frequency.events.some((e) => e.type === 'target' && Math.abs(e.v - 220) < 1e-9), 'glides to the new base');
  engine.update({ levels: presetLevels(1, 7) });
  assert.deepEqual(engine.voiceLevels(), [0, 1, 2, 3, 4, 5, 6]);
  engine.update({ levels: presetLevels(1, 14), chord: true });
  assert.equal(engine.voiceLevels().length, 14);
  engine.update({ chord: false });
  assert.equal(engine.voiceLevels().length, 0);
  engine.update({ physical: true, physShift: -1, chord: true });
  assert.deepEqual(engine.physicalVoices().map((v) => v.level), [14, 15, 16]);
  near(engine.physicalVoices()[0].hz, 247.65 / 2, 0.1);
  engine.update({ physShift: 3 });
  assert.deepEqual(engine.physicalVoices().map((v) => v.level), [12, 13, 14]);
  engine.destroy();
});

test('engine: hear this moment plays the chord of any instant, also while off, loudness = phase height', async () => {
  const { engine, ac, log } = makeEngine();
  assert.equal(engine.enabled, false);
  const m = await engine.playMoment(VECTOR_A);
  assert.ok(m);
  assert.equal(m.notes.length, 12);
  assert.deepEqual(m.notes.map((n) => n.level), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const times = m.notes.map((n) => n.at);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], 'arpeggio ascends in time');
  assert.ok(m.end - ac.currentTime >= 3 && m.end - ac.currentTime <= 4.2, '3-4 s long, got ' + (m.end - ac.currentTime));
  const f = model.frame(VECTOR_A);
  for (const n of m.notes) near(n.gain, 0.06 + 0.94 * loudness(triangle(f.level(n.level).phase)), 1e-12);
  assert.equal(log.length, 12);
  assert.equal(engine.enabled, false, 'the continuous layers stay off');
  assert.equal(engine.voiceLevels().length, 0);
  assert.equal(await engine.playMoment(model.tMax + 100), null, 'out of the catalogue: nothing to play');
  engine.destroy();
});

test('engine: offline-style render API schedules every layer for a whole span', async () => {
  const log = [];
  const ac = new FakeContext();
  ac.startRendering = async () => ({ length: 1 });
  const engine = createEngine({ model, clock: { t: () => ETA_END - 1, rate: () => 1 }, createContext: () => ac, log, timers: { setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} } });
  const buf = await engine.renderOffline(3, { momentAt: VECTOR_A });
  assert.equal(buf.length, 1);
  assert.ok(log.some((n) => n.kind === 'end' && Math.abs(n.when - 1) < 0.002));
  assert.ok(log.some((n) => n.kind === 'moment'));
  assert.equal(engine.enabled, false);
});

test('safety curve: transparent for normal levels, never above full scale', () => {
  const c = safetyCurve();
  const at = (x) => c[Math.round(((x + 1) / 2) * (c.length - 1))];
  near(at(0.5), 0.5, 1e-3);
  near(at(-0.7), -0.7, 1e-3);
  assert.ok(at(1) < 0.99 && at(1) > 0.9);
  assert.ok(at(-1) > -0.99);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1] - 1e-9, 'monotone');
  assert.ok(Math.max(...c) < 0.99);
});

test('coarse cycles ring bigger than fine ones', () => {
  assert.equal(bellTaper(0), 1);
  near(bellTaper(13), 0.55, 1e-12);
  for (let L = 1; L <= 13; L++) assert.ok(bellTaper(L) < bellTaper(L - 1));
});

test('formatting of frequencies, rates and durations', () => {
  assert.equal(fmtHz(110), '110.0 Hz');
  assert.equal(fmtHz(2399.6), '2.40 kHz');
  assert.equal(fmtHz(22.51), '22.51 Hz');
  assert.equal(fmtHz(0.6432), '643 mHz');
  assert.equal(fmtHz(5.498e-5), '55.0 µHz');
  assert.equal(fmtHz(4.394e-10), '0.439 nHz');
  assert.equal(fmtHz(0), '—');
  assert.equal(fmtRate(0), 'paused');
  assert.equal(fmtRate(1), '×1');
  assert.equal(fmtRate(4547.2), '×4,547', 'comma grouping, like the header');
  assert.equal(fmtRate(-60), '−×60');
  assert.equal(fmtRate(2629800), '×2.63 M');
  assert.equal(fmtSeconds(4), '4.00 s');
  assert.equal(fmtSeconds(0.0444), '44 ms');
  assert.equal(fmtSeconds(90), '90.0 s');
  assert.equal(fmtSeconds(18188), '5.1 h');
  assert.deepEqual([4, 0.5, 10, 90, 120, 0.044, 2.25].map(fmtSecondsShort), ['4 s', '0.5 s', '10 s', '90 s', '2 min', '44 ms', '2.25 s'], 'trailing zeros dropped: Locked: one η = 4 s');
  assert.equal(fmtDb(-18), '−18 dB');
  assert.equal(fmtOct(-1), '−1 oct');
  assert.equal(fmtOct(0), '0 oct');
});

test('formatting: no exponent notation at unit boundaries, slow motion keeps its digits', () => {
  // frequency: the boundary values round up into the next unit
  assert.equal(fmtHz(0.9999), '1.00 Hz');
  assert.equal(fmtHz(0.99951), '1.00 Hz');
  assert.equal(fmtHz(0.00099951), '1.00 mHz');
  assert.equal(fmtHz(0.000999999), '1.00 mHz');
  assert.equal(fmtHz(9.995e-7), '999 nHz');
  assert.equal(fmtHz(999.96), '1.00 kHz');
  assert.equal(fmtHz(99.996), '100.0 Hz');
  assert.equal(fmtHz(9999.9), '10.0 kHz');
  for (const hz of [1e-10, 4.394e-10, 3e-8, 5.498e-5, 0.0004, 0.6432, 1, 7.7, 99.9, 440, 999.9, 5000, 12345]) assert.ok(!/e[+-]/.test(fmtHz(hz)), fmtHz(hz));
  // rate: a locked tempo that is slower than real time is not shown as zero
  assert.equal(fmtRate(0.011104), '×0.011');
  assert.equal(fmtRate(0.0777), '×0.078');
  assert.equal(fmtRate(0.1777), '×0.18');
  assert.equal(fmtRate(0.5), '×0.5');
  assert.equal(fmtRate(-0.25), '−×0.25');
  assert.equal(fmtRate(0.000074), '×0.000074');
  assert.equal(fmtRate(0.999), '×1');
  assert.equal(fmtRate(9.96), '×10');
  assert.equal(fmtRate(4.5), '×4.5');
  assert.equal(fmtRate(1.82e9), '×1.82 G');
  assert.equal(fmtRate(1e9), '×1.00 G');
  assert.equal(fmtRate(31557600), '×31.6 M');
  assert.equal(fmtRate(9.99e8), '×999.0 M');
  for (const r of [1e-7, 0.011, 0.3, 1, 9.99, 99.5, 12345, 1e6, 5e8, 1e9, 1e12]) assert.ok(!/e[+-]|NaN|Infinity/.test(fmtRate(r)), String(r));
  assert.equal(fmtInt(1234567), '1,234,567');
  assert.equal(fmtInt(1819.4), '1,819');
  assert.equal(fmtInt(999), '999');
  assert.equal(fmtRate(1819.4), '×1,819', 'the tempo-locked eta rate reads as in the header');
  assert.equal(fmtRate(3600), '×3,600');
  assert.equal(fmtRate(86400), '×86,400');
  assert.ok(!/[\u2009\u00a0\u202f ]\d{3}/.test(fmtRate(123456)), 'no space-grouped numbers');
  // cycle periods: one unit, rounded (not floored): kappa is 1.68 min, not "1 min"
  const label = (L) => fmtPeriod(model.levelInfo(L).meanSeconds);
  assert.deepEqual([4, 5, 7, 8, 9].map(label), ['16.2 d', '2.32 d', '33.7 min', '8.42 min', '1.68 min']);
  assert.equal(label(0), '72.1 y');
  assert.equal(label(2), '1.11 y');
  assert.equal(label(3), '81.1 d');
  assert.equal(label(6), '5.05 h');
  assert.equal(label(10), '7.77 s');
  assert.equal(label(11), '1.55 s');
  assert.equal(label(12), '311 ms');
  assert.equal(label(13), '44 ms');
  assert.equal(fmtPeriod(59.99), '60 s');
  assert.equal(fmtPeriod(3599.9), '60 min');
  assert.equal(fmtPeriod(0), '—');
});

// ------------------------------------------------------------------------------------------------
// engine lifecycle: the stop path, a start that is overtaken, latency, drift, lookahead, destroy
// ------------------------------------------------------------------------------------------------
/** The gain node right in front of the limiter: the 100 ms fade-in / fade-out of the whole output. */
const faderOf = (ac) => ac.nodes.find((n) => n.kind === 'gain' && n.out.some((o) => o.kind === 'comp'));
/** Oscillators still scheduled to ring well after `ac.currentTime` (drone voices stop within 0.3 s of a stop). */
const ringing = (ac) => ac.nodes.filter((n) => n.kind === 'osc' && n.startedAt <= ac.currentTime && n.stoppedAt > ac.currentTime + 0.31);

test('engine: switching off fades to silence and the fader stays down (no rebound of drone, bells or reverb)', async () => {
  const timers = manualTimers();
  const { engine, ac } = makeEngine({ t0: ETA_END - 1, timers });
  await engine.start();
  ac.currentTime = 0.9;
  engine.tick();
  ac.currentTime = 1.3; // the depth-7 strum has started: bells are ringing
  engine.tick();
  assert.ok(ringing(ac).length > 0, 'bells are ringing when the sound is switched off');
  const fader = faderOf(ac);
  fader.gain.value = 0.9; // as read back from the audio thread at the moment of the stop
  const convolvers = ac.nodes.filter((n) => n.kind === 'convolver');
  assert.equal(convolvers.length, 1);

  ac.currentTime = 2;
  await engine.stop();
  timers.advance(200); // the stop timer: drone voices, bells and the reverb are released
  const after = fader.gain.events.filter((e) => e.t >= 2);
  assert.ok(after.length > 0 && after.every((e) => e.v !== 1), 'the fader is never raised again behind the tails: ' + JSON.stringify(after));
  const last = fader.gain.events.at(-1);
  assert.deepEqual([last.type, last.v], ['lin', 0], 'it ends at 0');
  assert.ok(last.t - 2 >= 0.09 && last.t - 2 <= 0.11, 'a ~100 ms fade-out');
  assert.equal(engine.stats().voices, 0);
  assert.equal(ringing(ac).length, 0, 'bells that were still ringing are stopped, so nothing can come back later');
  assert.equal(ac.nodes.filter((n) => n.kind === 'convolver').length, 2, 'the reverb is rebuilt empty');
  assert.equal(convolvers[0].disconnected, true, 'the old reverb tail is cut');

  // later sound (hear this moment) raises the fader itself, before its first note
  ac.currentTime = 5;
  const m = await engine.playMoment(VECTOR_A);
  const up = fader.gain.events.filter((e) => e.t >= 5);
  assert.deepEqual(up.map((e) => [e.type, e.v]), [['set', 0], ['lin', 1]]);
  assert.ok(up.at(-1).t < m.notes[0].at, 'fader is up before the first note');
  engine.destroy();
});

test('engine: off and on again during the fade-out continues from the current level and keeps one scheduler', async () => {
  const timers = manualTimers();
  const { engine, ac } = makeEngine({ timers });
  await engine.start();
  const fader = faderOf(ac);
  ac.currentTime = 3;
  await engine.stop();
  fader.gain.value = 0.4; // mid-fade
  ac.currentTime = 3.05;
  await engine.start();
  const up = fader.gain.events.filter((e) => e.t >= 3.05);
  assert.deepEqual(up.map((e) => [e.type, e.v]), [['set', 0.4], ['lin', 1]], 'no step to 0 and back');
  timers.advance(500);
  assert.equal(engine.enabled, true);
  assert.equal(engine.voiceLevels().length, 12, 'the voices were kept');
  assert.equal(timers.intervals, 1);
  assert.equal(timers.pending, 1, 'the cancelled stop timer is gone');
  await engine.stop();
  timers.advance(5);
  assert.equal(timers.intervals, 0);
  engine.destroy();
});

test('engine: a start() overtaken by stop() while the context resumes installs nothing', async () => {
  const timers = manualTimers();
  const ac = new FakeContext({ state: 'suspended' });
  let release;
  ac.resumeGate = new Promise((r) => (release = r));
  const { engine } = makeEngine({ timers, context: ac });
  const first = engine.start(); // waits for the browser to resume the context (as Safari or a slow device does)
  assert.equal(engine.enabled, true);
  await engine.stop(); // double click / held M key
  release();
  assert.equal(await first, false, 'the stop wins');
  assert.equal(engine.enabled, false);
  assert.equal(timers.intervals, 0, 'no scheduler is left running');
  assert.equal(engine.voiceLevels().length, 0);

  // off, on, off, on in quick succession: exactly one scheduler at the end, none after the last off
  ac.state = 'suspended';
  ac.resumeGate = new Promise((r) => (release = r));
  const a = engine.start();
  await engine.stop();
  const b = engine.start();
  release();
  await Promise.all([a, b]);
  assert.equal(engine.enabled, true);
  assert.equal(timers.intervals, 1, 'one tick timer while enabled');
  assert.equal(engine.voiceLevels().length, 12);
  await engine.stop();
  assert.equal(timers.intervals, 0);
  engine.destroy();
  assert.equal(timers.intervals, 0);
});

test('engine: a blocked autoplay start reports the error only while it is still wanted', async () => {
  const timers = manualTimers();
  const ac = new FakeContext({ state: 'suspended' });
  ac.resumeGate = new Promise(() => {}); // never settles: no user gesture
  const { engine } = makeEngine({ timers, context: ac });
  const p = engine.start().then(() => 'started', (e) => e.message);
  timers.advance(2600);
  assert.match(await p, /blocks audio/);
  assert.equal(engine.enabled, false);
  assert.equal(timers.intervals, 0);
  // the user pressed stop meanwhile: nothing to complain about
  const q = engine.start().then((v) => v, () => 'error');
  await engine.stop();
  timers.advance(2600);
  assert.equal(await q, false);
  engine.destroy();
});

test('engine: bells are scheduled earlier by the output latency of the device', async () => {
  const plain = makeEngine({ t0: ETA_END - 1 });
  await plain.engine.start();
  plain.ac.currentTime = 0.5;
  plain.engine.tick();
  const lateral = makeEngine({ t0: ETA_END - 1, context: new FakeContext({ outputLatency: 0.05 }) });
  await lateral.engine.start();
  lateral.ac.currentTime = 0.5;
  lateral.engine.tick();
  const at = (r) => r.log.find((n) => n.kind === 'end' && n.level === 6).when;
  near(at(plain), 1, 0.002);
  near(at(lateral), 0.95, 0.002, 'sounds 50 ms earlier so it is heard on time');
  plain.engine.destroy();
  lateral.engine.destroy();
});

test('engine: when the clock drifts away from the audio clock the scheduler re-anchors', async () => {
  const { engine, ac, clk } = makeEngine();
  await engine.start();
  ac.currentTime = 0.2;
  clk.base += 0.03; // under 50 ms: tolerated
  engine.tick();
  assert.equal(engine.stats().resyncs, 0);
  clk.base += 10; // the displayed time moved without a notification (long main-thread stall, device sleep)
  ac.currentTime = 0.3;
  engine.tick();
  assert.equal(engine.stats().resyncs, 1);
  engine.destroy();
});

test('engine: the lookahead widens in a hidden tab', async () => {
  const visible = makeEngine({ t0: ETA_END - 2 });
  await visible.engine.start();
  visible.engine.tick();
  const strum = (r) => r.log.filter((n) => n.kind === 'end' && n.level === 6).length;
  assert.equal(strum(visible), 0, 'a strum 2 s away is not scheduled with the 0.6 s lookahead');
  const hidden = makeEngine({ t0: ETA_END - 2, hidden: true });
  await hidden.engine.start();
  hidden.engine.tick();
  assert.equal(strum(hidden), 1, 'but it is with the 2.5 s lookahead of a throttled background tab');
  visible.engine.destroy();
  hidden.engine.destroy();
});

test('engine: destroy closes the context and stops every timer; chimes off cancels the pending bells', async () => {
  const timers = manualTimers();
  const { engine, ac } = makeEngine({ t0: ETA_END - 1.5, timers });
  await engine.start();
  ac.currentTime = 1.0;
  engine.tick();
  const pendingBells = ac.nodes.filter((n) => n.kind === 'osc' && n.startedAt > 1.2);
  assert.ok(pendingBells.length > 0);
  engine.update({ chimes: false });
  assert.ok(pendingBells.every((n) => n.stoppedAt === 0), 'turning the chimes off cancels bells that have not rung yet');
  await engine.stop();
  timers.advance(200);
  engine.destroy();
  assert.equal(ac.state, 'closed');
  assert.equal(timers.pending, 0, 'no timer survives destroy()');
  assert.equal(engine.enabled, false);
});

test('engine: an idle context is suspended 1.5 s after switching off and resumed by the next start', async () => {
  const timers = manualTimers();
  const { engine, ac } = makeEngine({ timers });
  await engine.start();
  timers.advance(5000);
  assert.equal(ac.state, 'running', 'never suspended while sounding');
  await engine.stop();
  timers.advance(180 + 1400);
  assert.equal(ac.state, 'running');
  timers.advance(200);
  assert.equal(ac.state, 'suspended');
  await engine.start();
  assert.equal(ac.state, 'running');
  engine.destroy();
});

test('engine: base pitch changes keep the chorus partner a constant 0.15 Hz away', async () => {
  const { engine, ac } = makeEngine();
  await engine.start();
  const partner = oscs(ac, 110).find((o) => o.detune.value > 0);
  near(partner.detune.value, 1200 * Math.log2(1 + 0.15 / 110), 1e-9);
  engine.update({ baseHz: 220 });
  const ev = partner.detune.events.find((e) => e.type === 'target');
  assert.ok(ev, 'the detune glides along with the frequency');
  near(ev.v, 1200 * Math.log2(1 + 0.15 / 220), 1e-9, 'half the cents at twice the pitch = the same beat in Hz');
  engine.destroy();
});

test('engine: gain staging is the quiet, limited default', async () => {
  const { engine, ac } = makeEngine();
  await engine.start();
  const fader = faderOf(ac);
  const master = ac.nodes.find((n) => n.kind === 'gain' && n.out.includes(fader));
  near(master.gain.value, dbToGain(-18), 1e-9, 'master volume −18 dB');
  const comp = ac.nodes.find((n) => n.kind === 'comp');
  assert.equal(comp.threshold.value, -14);
  assert.equal(comp.ratio.value, 12);
  assert.ok(comp.attack.value <= 0.005, 'a fast limiter');
  engine.update({ volumeDb: -30 });
  assert.ok(master.gain.events.some((e) => e.type === 'target' && Math.abs(e.v - dbToGain(-30)) < 1e-9));
  engine.destroy();
});

test('engine: jumping back in time rings the bells of the new moment (the high-water mark is re-anchored)', async () => {
  const { engine, ac, clk, log } = makeEngine({ t0: VECTOR_A + 5000 });
  await engine.start();
  for (let i = 1; i <= 8; i++) {
    ac.currentTime = i * 0.1;
    engine.tick();
  }
  const before = log.length;
  assert.ok(before > 0, 'mu rings every 0.39 s');
  clk.base -= 86400; // a day back: the old high-water mark lies a day in the future of the new position
  engine.resync();
  ac.currentTime = 0.9;
  engine.tick();
  ac.currentTime = 1.4;
  engine.tick();
  const fresh = log.slice(before);
  assert.ok(fresh.length >= 2, 'bells ring after the jump back, got ' + fresh.length);
  assert.ok(fresh.every((n) => n.when >= 0.9), 'and only in the future');
  engine.destroy();
});

test('engine: the tab-visibility listener exists exactly while the sound is on', async () => {
  const handlers = new Set();
  const fakeDoc = { hidden: false, addEventListener: (type, f) => type === 'visibilitychange' && handlers.add(f), removeEventListener: (type, f) => type === 'visibilitychange' && handlers.delete(f) };
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: fakeDoc, configurable: true, writable: true });
  try {
    const timers = manualTimers();
    const { engine } = makeEngine({ timers });
    await engine.start();
    assert.equal(handlers.size, 1);
    const ticks = engine.stats().ticks;
    [...handlers][0](); // the tab went to the background: widen the schedule at once
    assert.equal(engine.stats().ticks, ticks + 1);
    await engine.stop();
    assert.equal(handlers.size, 0);
    await engine.start();
    assert.equal(handlers.size, 1);
    engine.destroy();
    assert.equal(handlers.size, 0);
  } finally {
    if (saved) Object.defineProperty(globalThis, 'document', saved);
    else delete globalThis.document;
  }
});

test('spectrum letters: every tick that has room is labelled, whatever order the levels come in', () => {
  // level order is not frequency order: theta (472 Hz) comes after eta (840 Hz) but stands to its left
  const hz = [110, 137.5, 223.4, 279.3, 349.1, 305.5, 840.1, 472.5, 945.1];
  const x = (f) => 6 + (Math.log(f / 40) / Math.log(8000 / 40)) * 330; // a 342 px canvas
  const items = hz.map((f, key) => ({ key, x: x(f) }));
  const got = labelSlots(items, 13);
  assert.ok(got.has(7), 'theta is labelled although it follows eta in level order');
  // greedy left to right: neighbours closer than the gap lose their letter, everyone else keeps it
  const sorted = [...got].map((k) => items[k].x).sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] > 13);
  for (const it of items) if (!got.has(it.key)) assert.ok(sorted.some((p) => Math.abs(p - it.x) <= 13), `tick ${it.key} lost its letter without a neighbour in the way`);
  assert.deepEqual([...labelSlots([{ key: 'a', x: 10 }, { key: 'b', x: 30 }, { key: 'c', x: 31 }], 13)].sort(), ['a', 'b']);
  assert.equal(labelSlots([], 13).size, 0);
});

// ------------------------------------------------------------------------------------------------
// pure mode wording (docs/design/80-pure.md, revision 2): ratios, octaves, cents, pB, Fractonica periods, Blinks, glyph pairs
// ------------------------------------------------------------------------------------------------
const pure = createPure(model, { now: () => VECTOR_A });
const rowsT = buildTuning(model);
const hardLeaks = (text) => RULES.filter(([, re, severity]) => severity === 'hard' && re.test(text)).map(([id]) => id);
const noLeak = (text, what) => assert.deepEqual(hardLeaks(text), [], `${what}: "${text}"`);
/** What a user reads of a piece of markup. */
// (a narrow no-break space of a digit group stays one: only ASCII white space is folded)
const plainText = (html) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/ ([,.;)])/g, '$1')
    .trim();
const NN = ' '; // the narrow no-break space of a digit group

test('pure wording: a ratio is written with a slash and never looks like a time of day', () => {
  assert.equal(W.ratioText(rowsT[0]), '1/1');
  assert.equal(W.ratioText(rowsT[2]), '65/64');
  assert.equal(W.ratioText(rowsT[4]), '1625/1024');
  // "65:64" is what the normal mode writes: the leak rules read it as 65:64 o'clock
  assert.deepEqual(hardLeaks(rowsT[2].ratio), ['clock-time']);
  for (const r of rowsT) noLeak(W.ratioText(r), `ratio of depth ${r.depth}`);
});

test('pure wording: octave offsets, shifts and cents', () => {
  assert.equal(W.octaveOffset(0), 'octave +0');
  assert.equal(W.octaveOffset(3), 'octave +3');
  assert.equal(W.octaveOffset(-1), 'octave −1');
  assert.equal(W.octaveShift(0), 'no shift');
  assert.equal(W.octaveShift(1), '+1 octave');
  assert.equal(W.octaveShift(-2), '−2 octaves');
  assert.equal(W.cents(799.5), '800¢');
  assert.equal(W.cents(0), '0¢');
  assert.equal(W.cents(1119.6), '1120¢');
});

test('pure wording: the base pitch is an offset of the ground, its absolute pitch is in pB, never a frequency', () => {
  assert.equal(W.groundText(0), 'ground ×1');
  assert.equal(W.groundText(12), '+1 octave ×2');
  assert.equal(W.groundText(-12), '−1 octave ×½');
  assert.equal(W.groundText(7), '+700¢ ×1.5');
  assert.equal(W.groundText(-5), '−500¢ ×0.749');
  assert.equal(W.groundPhrase(0), 'ground ×1');
  assert.equal(W.groundPhrase(3), 'ground +300¢ ×1.19');
  assert.equal(W.groundPhrase(0, '34.2 pB'), 'ground ×1, 34.2 pB');
  assert.equal(W.groundPhrase(7, '51.2 pB'), 'ground +700¢ ×1.5, 51.2 pB');
  let prev = 0;
  for (let k = -12; k <= 12; k++) {
    const { head, sub } = W.groundWords(k);
    noLeak(`${head} ${sub}`, `ground ${k}`);
    // monotone: a higher step is a bigger ratio (the text carries it, the slider carries the order)
    const ratio = Math.pow(2, k / 12);
    assert.ok(ratio > prev);
    prev = ratio;
    if (k !== 0 && Math.abs(k) !== 12) assert.equal(head, `${k < 0 ? '−' : '+'}${Math.abs(k) * 100}¢`);
    // and the ground's pB moves with it: 110 Hz is 34.2 pB, an octave is double
    const pb = W.pbOf(pure, 110 * ratio);
    assert.match(pb, /^[\d. ]+ pB$/);
    noLeak(pb, `ground ${k} in pB`);
  }
  assert.equal(W.pbOf(pure, 110), '34.2 pB', 'the default ground');
  assert.equal(W.pbOf(pure, 55), '17.1 pB');
  assert.equal(W.pbOf(pure, 220), '68.4 pB');
});

test('pure wording: pB (cycles per Blink) of the deepest cycles are whole numbers, slow cycles are "1 per N Blinks"', () => {
  const perBlink = (L) => pure.perBlink(1 / model.levelInfo(L).meanSeconds);
  // the owner's point of choosing the Blink: ξ 7, ο 77, π 693, ρ 2 772 (22.5 Hz, 247.7 Hz, 2.23 kHz, 8.92 kHz before)
  for (const [L, whole] of [[12, 1], [13, 7], [14, 77], [15, 693], [16, 2772]]) near(perBlink(L), whole, whole * 1e-6, `depth ${L + 1}`);
  const pb = (L) => W.pbOf(pure, 1 / model.levelInfo(L).meanSeconds);
  assert.deepEqual([13, 14, 15, 16].map(pb), ['7 pB', '77 pB', '693 pB', `2${NN}772 pB`]);
  assert.equal(pb(12), '1 pB', 'one ν cycle per Blink, by definition');
  assert.equal(pb(11), '0.2 pB', 'μ: one cycle per five Blinks');
  assert.equal(pb(10), '0.04 pB', 'λ: one cycle per 25 Blinks');
  assert.equal(pb(9), '1 per 325 Blinks', 'κ is slower than 0.04 pB: said as a count of Blinks');
  assert.equal(pb(8), `1 per 1${NN}625 Blinks`, 'ι');
  assert.equal(pb(6), `1 per 58${NN}500 Blinks`, 'η: 58 500 Blinks, a whole number');
  assert.equal(pb(0), `1 per 7${NN}319${NN}812${NN}500 Blinks`, 'α');
  assert.equal(W.pbOf(pure, 0), '—');
  assert.equal(W.pbOf(pure, NaN), '—');
  assert.equal(W.pbOf(pure, Infinity), '—');
  for (const r of rowsT) noLeak(W.pbOf(pure, r.trueHz), `true rate of depth ${r.depth}`);
  // finer cycles come faster
  const per = rowsT.map((r) => r.trueHz);
  for (let i = 1; i < per.length; i++) assert.ok(per[i] > per[i - 1]);
  // every voice at the default ground has an absolute pitch in pB; the table of the register above 110 Hz
  const at = rowsT.map((r) => W.pbOf(pure, frequencyOf(r, 110)));
  assert.equal(at[0], '34.2 pB');
  assert.equal(at[4], '108.5 pB');
  assert.equal(at[12], '932.6 pB');
  for (const t of at) noLeak(t, t);
  // the shared helpers keep their meaning
  assert.equal(pure.BLINK, 'Blink');
  assert.equal(pure.PER_BLINK, 'pB');
});

test('pure wording: counts and spans of Blinks', () => {
  assert.equal(W.fmtBlinks(1), '1 Blink');
  assert.equal(W.fmtBlinks(4), '4 Blinks');
  assert.equal(W.fmtBlinks(0.5), '0.5 Blinks');
  assert.equal(W.fmtBlinks(0.00432), '0.00432 Blinks');
  assert.equal(W.fmtBlinks(0.0004), '<0.001 Blinks');
  assert.equal(W.fmtBlinks(12.34), '12.3 Blinks');
  assert.equal(W.fmtBlinks(1234.5), `1${NN}235 Blinks`);
  assert.equal(W.fmtBlinks(58500), `58${NN}500 Blinks`);
  assert.equal(W.fmtBlinks(2.63e6), '2.63 M Blinks');
  assert.equal(W.fmtBlinks(1.82e9), '1.82 G Blinks');
  assert.equal(W.fmtBlinks(NaN), '—');
  assert.equal(W.fmtBlinks(Infinity), '—');
  // no exponent notation, however small the span
  assert.doesNotMatch(W.plain(4.5e-9), /e/);
  assert.equal(W.plain(0), '0');
  for (const b of [0.004, 0.0222, 0.1, 0.25, 1, 4, 13.5, 600, 4547, 1e7, 3e10]) noLeak(W.fmtBlinks(b), `${b} Blinks`);
  // device seconds -> Blinks: 1 Blink is the ν cycle at real time (0.311 s)
  const blink = pure.blinkSeconds();
  assert.equal(W.blinkSpan(pure, blink), '1 Blink');
  assert.equal(W.blinkSpan(pure, 4 * blink), '4 Blinks');
  assert.equal(W.blinkSpan(pure, blink / 2), '0.5 Blinks');
  assert.equal(W.blinkSpan(pure, 4), '12.9 Blinks', 'the normal default of the tempo lock, 4 s');
  assert.equal(W.blinkSpan(pure, 3 * 3600), `34${NN}735 Blinks`);
  // the same words as the helper's own `blinks` below a thousand
  for (const n of [0.5, 1, 3.5, 12, 36, 250]) assert.equal(W.blinkSpan(pure, pure.blinksToSeconds(n)), pure.blinks(pure.blinksToSeconds(n)));
});

test('pure wording: every depth is one unit or a whole count of the next one, written by the helper (pure.cycleLength)', () => {
  // revision 3: the ladder skips every other depth below δ; ζ θ κ μ are counts of the next unit, ξ a decimal Blink
  assert.deepEqual(
    rowsT.map((r) => pure.cycleLength(r.level)),
    ['1α', '1β', '1γ', '1δ', '1ε', '11η', '1η', '4ι', '1ι', '13λ', '1λ', '5ν', '1ν', '0.14ν'],
  );
  // and the counts give the cycle's length back exactly (in Saros position units); ξ is a decimal count of a Blink
  const len = new Map(pure.UNITS.map((u) => [u.sym, pure.unitPos(u)]));
  for (const r of rowsT) {
    const sum = pure.cycleLength(r.level)
      .split(' ')
      .reduce((a, part) => a + Number.parseFloat(part) * len.get(part.replace(/^[\d.]+/, '')), 0);
    near(sum / (4 / Number(r.prefix)), 1, r.depth === 14 ? 0.02 : 1e-12, `depth ${r.depth}`);
    // a zero part never adds information ("1η", not "1η 0ι"): the helper drops it, the panel does not re-trim
    assert.doesNotMatch(pure.cycleLength(r.level), /(^| )0[^.\d]/, `depth ${r.depth}`);
    noLeak(pure.cycleLength(r.level), `length of depth ${r.depth}`);
  }
  // the words module has no length formatter of its own
  assert.equal(W.cycleLength, undefined);
  // what a depth is: majors and units by name, the depths between by their length (the tempo lock's depth list)
  assert.deepEqual(
    rowsT.slice(1).map((r) => W.depthOption(pure, r)),
    ['β 2 · Beta', 'γ 3 · Gamma', 'δ 4 · Delta', 'ε 5 · Nuclide', 'ζ 6 · 11η', 'η 7 · Helion', 'θ 8 · 4ι', 'ι 9 · Preon', 'κ 10 · 13λ', 'λ 11 · Flavon', 'μ 12 · 5ν', 'ν 13 · Blink', 'ξ 14 · 0.14ν'],
  );
  assert.deepEqual(
    [3, 6, 5, 13].map((L) => W.depthKind(pure, L)),
    ['Delta, a major period', 'Helion, a minor unit', 'between two units', 'finer than a Blink'],
  );
  for (const r of rowsT) {
    noLeak(W.depthOption(pure, r), `depth option ${r.depth}`);
    noLeak(W.depthKind(pure, r.level), `depth kind ${r.depth}`);
  }
});

test('pure wording: the spectrum is labelled by the octaves of the ground, in pB and ratios', () => {
  const grid = W.octaveGrid(110, 40, 8000);
  // the lines of the A's of the normal mode (55 .. 3520), plus the one more octave that still fits the axis
  assert.deepEqual(grid.map((g) => g.f), [55, 110, 220, 440, 880, 1760, 3520, 7040]);
  assert.deepEqual(grid.map((g) => g.ratio), ['×½', '×1', '×2', '×4', '×8', '×16', '×32', '×64']);
  assert.deepEqual(grid.map((g) => g.offset), ['−1', '0', '+1', '+2', '+3', '+4', '+5', '+6']);
  assert.deepEqual(grid.map((g) => g.pb), Array(8).fill(''), 'without a formatter there is no pitch text');
  assert.deepEqual(W.octaveGrid(55, 40, 8000).map((g) => g.f), [55, 110, 220, 440, 880, 1760, 3520, 7040]);
  assert.deepEqual(W.octaveGrid(220, 40, 8000).map((g) => g.offset), ['−2', '−1', '0', '+1', '+2', '+3', '+4', '+5']);
  assert.deepEqual(W.octaveGrid(1, 40, 80).map((g) => g.f), [64]);
  for (const base of [55, 110, 163.3, 220]) for (const g of W.octaveGrid(base, 40, 8000)) { noLeak(g.ratio, 'ratio'); noLeak(g.offset, 'offset'); assert.ok(g.f >= 40 && g.f <= 8000 * (1 + 1e-9)); }
  // each line carries its pitch in pB (the axis' numbers: they double from line to line)
  const pb = W.octaveGrid(110, 40, 8000, (hz) => W.pbOf(pure, hz)).map((g) => g.pb);
  assert.deepEqual(pb, ['17.1 pB', '34.2 pB', '68.4 pB', '136.8 pB', '273.6 pB', '547.2 pB', `1${NN}094 pB`, `2${NN}189 pB`]);
  for (const t of pb) noLeak(t, t);
  // the pitch ring: only every third spoke is named, in cents
  assert.deepEqual(Array.from({ length: 12 }, (_, k) => W.spokeLabel(k)), ['1/1', '', '', '300¢', '', '', '600¢', '', '', '900¢', '', '']);
});

test('pure wording: speed buttons are the helper\'s rateLabel (units per Blink) and agree with the header', () => {
  const buttons = W.rateButtons(pure);
  assert.deepEqual(buttons.map((b) => b.label), ['Live', 'real time', 'λ', 'ι', 'η', 'ε', 'δ', 'Pause', 'Reverse']);
  assert.deepEqual(buttons.map((b) => b.unit), ['follow now', '', 'per Blink', 'per Blink', 'per Blink', 'per Blink', 'per Blink', '', '']);
  // the tooltip says what passes, in prose, by the unit's name
  assert.deepEqual(
    buttons.slice(2, 7).map((b) => b.tip),
    ['One Flavon passes every Blink', 'One Preon passes every Blink', 'One Helion passes every Blink', 'One Nuclide passes every Blink', 'One Delta passes every Blink'],
  );
  // the keys are the rates of the header's speed select, read back exactly (the pressed state compares them with ===)
  for (const b of buttons.slice(1, 7)) {
    const say = `${b.label}${b.unit ? ' ' + b.unit : ''}`;
    assert.equal(pure.rateLabel(Number(b.key)), say, 'the words of a button are what the header says for the same rate');
    assert.ok(pure.RATES.some((x) => x.rate === Number(b.key) && x.label === say), b.label);
  }
  // no bare multiplier, no "beat" on any button, whatever the unit
  for (const b of buttons) {
    noLeak(`${b.label} ${b.unit} ${b.tip}`, b.key);
    assert.doesNotMatch(b.tip, /clock time/);
    assert.doesNotMatch(`${b.label} ${b.unit}`, /×|\d{3}/, `${b.key}: no ×N`);
  }
  assert.deepEqual(W.RATE_BUTTON_UNITS, ['lambda', 'iota', 'eta', 'epsilon', 'delta']);
  for (const id of W.RATE_BUTTON_UNITS) assert.ok(pure.RATES.some((r) => r.id === id), `${id} is a preset of the helper`);
});

test('pure wording: every speed reads in prose with the unit\'s name, counted presets included', () => {
  const tip = (id) => W.rateTip(pure, pure.RATES.find((r) => r.id === id).rate);
  assert.deepEqual(
    pure.RATES.map((r) => [r.id, W.rateTip(pure, r.rate)]),
    [
      ['real', 'Real time: one Blink passes every Blink'],
      ['nu5', 'Five Blinks pass every Blink'],
      ['lambda', 'One Flavon passes every Blink'],
      ['lambda13', 'Thirteen Flavons pass every Blink'],
      ['iota', 'One Preon passes every Blink'],
      ['iota4', 'Four Preons pass every Blink'],
      ['eta', 'One Helion passes every Blink'],
      ['eta11', 'Eleven Helions pass every Blink'],
      ['epsilon', 'One Nuclide passes every Blink'],
      ['delta', 'One Delta passes every Blink'],
      ['gamma', 'One Gamma passes every Blink'],
    ],
  );
  assert.equal(tip('iota4'), W.rateTip(pure, pure.PLAY_RATE), 'the default Play speed of pure mode');
  // any other rate: the helper's count, in digits when it is not a small whole number
  assert.equal(W.rateTip(pure, tempoRate(model, 7, pure.blinksToSeconds(12))), 'Three Preons pass every Blink');
  assert.equal(W.rateTip(pure, -pure.RATES.find((r) => r.id === 'eta').rate), 'One Helion passes every Blink, backward');
  assert.match(W.rateTip(pure, 2.5 * pure.RATES.find((r) => r.id === 'iota').rate), /^2\.5 Preons pass every Blink$/);
  assert.match(W.rateTip(pure, 0.5), /^0\.5 Blinks pass every Blink$/);
  for (const r of pure.RATES) noLeak(W.rateTip(pure, r.rate), r.id);
  for (const k of [3, 60, 3600, 86400, 2629800, 0.011]) noLeak(W.rateTip(pure, k), String(k));
});

test('pure wording: a tempo lock is counted in Blinks and reads as a count of one unit per Blink, never as a bare multiplier', () => {
  const unitSec = new Map(pure.UNITS.map((u) => [u.sym, pure.unitSeconds(u)]));
  const blink = pure.blinkSeconds();
  let n = 0;
  for (const depth of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
    for (const blinks of [0.8, 1, 4, 12, 13.5, 60, 600, 1930]) {
      const rate = tempoRate(model, depth, pure.blinksToSeconds(blinks));
      const say = pure.rateLabel(rate);
      // only units are counted (revision 3: ζ θ κ μ are not units)
      assert.match(say, /^(real time|(\d+(\.\d+)?)?(α|β|γ|δ|ε|η|ι|λ|ν) per Blink)$/, `depth ${depth} in ${blinks} Blinks`);
      assert.doesNotMatch(say, /×|,/, 'no bare multiplier, no digit grouping that looks like one');
      noLeak(say, `lock ${depth}/${blinks}`);
      // the count is honest: count x unit lasts (within the 3 digits shown) as long as the clock moves per Blink
      if (say !== 'real time') {
        const [, count, sym] = /^((?:\d+(?:\.\d+)?)?)(.+?) per Blink$/.exec(say);
        near(((count === '' ? 1 : Number(count)) * unitSec.get(sym)) / (rate * blink), 1, 0.006, say);
      } else near(rate, 1, 0.005, 'real time is a rate of one');
      n++;
    }
  }
  assert.equal(n, 104);
  // the panel's own sentences are built from the helper's label and the Blinks of the lock: one η in 12 Blinks
  const rate = tempoRate(model, 7, pure.blinksToSeconds(12));
  assert.equal(pure.rateLabel(rate), '3ι per Blink');
  const ti = tempoInfo(model, 7, rate);
  const lines = [
    `${pure.rateLabel(rate)}: one η cycle lasts ${W.blinkSpan(pure, ti.cycle)}; a quarter lasts ${W.blinkSpan(pure, ti.beat)}.`,
    `Tempo locked: one η cycle = ${W.blinkSpan(pure, pure.blinksToSeconds(12))} (${pure.rateLabel(rate)})`,
    `Tempo unlocked. The speed stays at ${pure.rateLabel(rate)} until you change it.`,
  ];
  assert.equal(lines[0], '3ι per Blink: one η cycle lasts 12 Blinks; a quarter lasts 3 Blinks.');
  assert.equal(lines[1], 'Tempo locked: one η cycle = 12 Blinks (3ι per Blink)');
  for (const l of lines) { noLeak(l, l); assert.doesNotMatch(l, /×\d/); }
  // clean locks are exactly named presets: one η in 36 Blinks is one ι per Blink, one ζ (11η) in 11 Blinks one η per Blink,
  // one η in 9 Blinks the default Play speed (4ι per Blink), one η in 58 500 Blinks real time itself
  assert.equal(pure.rateLabel(tempoRate(model, 7, pure.blinksToSeconds(36))), 'ι per Blink');
  assert.equal(pure.rateLabel(tempoRate(model, 6, pure.blinksToSeconds(11))), 'η per Blink');
  assert.equal(pure.rateLabel(tempoRate(model, 7, pure.blinksToSeconds(9))), '4ι per Blink');
  assert.equal(pure.rateLabel(tempoRate(model, 5, pure.blinksToSeconds(7))), '11η per Blink', 'one ε in 7 Blinks');
  assert.equal(pure.rateLabel(tempoRate(model, 7, pure.blinksToSeconds(58500))), 'real time');
  assert.equal(pure.rateLabel(tempoRate(model, 9, pure.blinksToSeconds(1625))), 'real time');
  // backwards: the same words and "backward"; one ι lasts 1 625 Blinks at real time, so 65 Blinks is λ per Blink... times 25 slower
  assert.equal(pure.rateLabel(-tempoRate(model, 9, pure.blinksToSeconds(65))), 'λ per Blink backward');
});

test('pure wording: the number box of the tempo lock converts Blinks <-> stored seconds, with clean defaults and equal limits', () => {
  const D = DEFAULT_SETTINGS.tempo.seconds; // 4 s, the normal default
  assert.equal(W.TEMPO_DEFAULT_BLINKS, 12);
  assert.equal(W.tempoBlinks(pure, D, D), 12, 'the untouched default reads as a clean number of Blinks');
  // a box value converts exactly, and back (no drift): 12, 36, 0.8, 1930, 13.5
  for (const blinks of [0.8, 1, 12, 13.5, 36, 600, 1930]) {
    const sec = pure.blinksToSeconds(blinks);
    assert.equal(W.tempoBlinks(pure, sec, D), blinks, `${blinks} Blinks round trip`);
    near(pure.secondsToBlinks(sec), blinks, blinks * 1e-12);
  }
  // 12 Blinks is 3.73 s and 3ι per Blink: it is not the default (4 s = 12.9 Blinks), so it shows its own number
  near(pure.blinksToSeconds(12), 3.731, 0.001);
  assert.equal(W.tempoBlinks(pure, 4.0001, D), 12.9);
  assert.equal(W.tempoBlinks(pure, 0.25, D), 0.804);
  assert.equal(W.tempoBlinks(pure, 600, D), 1930);
  // the limits of the box are the stored limits: [0.25 s, 600 s]
  const [lo, hi] = W.tempoBlinkLimits(pure, LIMITS.tempoSeconds);
  assert.deepEqual([lo, hi], [0.8, 1930]);
  near(pure.blinksToSeconds(lo), LIMITS.tempoSeconds[0], 0.003);
  near(pure.blinksToSeconds(hi), LIMITS.tempoSeconds[1], 0.2);
  // what the box accepts is clamped by the settings exactly like seconds: 10 000 Blinks -> 600 s -> 1930 Blinks shown
  const s = sanitize({ tempo: { depth: 7, seconds: pure.blinksToSeconds(10000) } });
  assert.equal(s.tempo.seconds, 600);
  assert.equal(W.tempoBlinks(pure, s.tempo.seconds, D), 1930);
  assert.equal(sanitize({ tempo: { depth: 7, seconds: pure.blinksToSeconds(0.1) } }).tempo.seconds, 0.25);
  // the default lock: one η in 12 Blinks is 3ι per Blink and a quarter is 3 Blinks (a clean read-out)
  assert.equal(pure.rateLabel(tempoRate(model, 7, pure.blinksToSeconds(12))), '3ι per Blink');
});

test('pure wording: a glyph pair is spoken as two digits in the helper\'s words (never "13·0")', () => {
  for (const f of [0, 0.0001, 0.0859375, 0.5, 13 / 16 + 4 / 256 + 0.0001, 0.999, 1]) {
    const p = pure.pair(f);
    for (const label of ['volume', 'reverb', 'loudness', 'phase']) {
      const say = W.pairSay(pure, f, label);
      assert.equal(say, `${label} ${p.hi} and ${p.lo} of 256`);
      // the same words as the accessible name of the drawn pair
      assert.match(pure.pairHTML(f, { label }), new RegExp(`aria-label="${say}"`));
      assert.doesNotMatch(say, /·|\./, 'no dot between the digits: it is read as a decimal');
      noLeak(say, say);
    }
  }
  assert.equal(W.pairSay(pure, 0.5, 'volume'), 'volume 8 and 0 of 256');
  assert.equal(W.pairSay(pure, 1, 'reverb'), 'reverb 15 and 15 of 256');
  assert.equal(W.GLOSSARY_HINT, 'Press ? for the glossary.');
});

test('pure wording: chime floors are counted in Blinks', () => {
  assert.deepEqual(
    FLOORS.map((f) => W.floorLabel(pure, f, f === 0.5 ? 'default' : '')),
    ['0.161 Blinks', '0.386 Blinks', '0.804 Blinks', '1.61 Blinks · default', '3.22 Blinks'],
  );
  // a lock of one cycle of depth 7 in 4 s is the rate the normal mode calls x4,547; pure mode counts the lock in Blinks
  const rate = tempoRate(model, 7, 4);
  assert.equal(fmtRate(rate), '×4,547');
  assert.equal(pure.rateLabel(rate), '2.8ι per Blink');
  const ti = tempoInfo(model, 7, rate);
  assert.equal(W.blinkSpan(pure, ti.cycle), '12.9 Blinks');
  assert.equal(W.blinkSpan(pure, ti.beat), '3.22 Blinks'); // "a quarter lasts 3.22 Blinks"
});

test('pure wording: every static text and every tooltip is free of Earth references', () => {
  for (const [h, p] of W.HOW) noLeak(`${h} ${p}`, h);
  for (const text of [W.CAPTION, W.LEGEND_MIXER, W.LEGEND_RHYTHM]) noLeak(plainText(text), text.slice(0, 30));
  // "30 Hz" became "9 pB"; "beat" is not a word of pure mode any more (the quarters are pulses, real time is Blinks)
  assert.match(W.LEGEND_RHYTHM, /Up to about 9 pB such a cycle/);
  near(pure.perBlink(30), 9, 0.4, '30 Hz is about 9 pB');
  const all = [...W.HOW.flat(), W.CAPTION, W.LEGEND_MIXER, W.LEGEND_RHYTHM].join(' ');
  assert.doesNotMatch(all, /\bbeats?\b|per beat/i);
  assert.doesNotMatch(all, /½|\bHz\b/);
  assert.match(W.HOW.map((x) => x.join(' ')).join(' '), /one Blink is one ν cycle at real time/);
  // the physical register names the true rates: whole numbers of pB
  const tip = plainText(W.physicalTip(pure, [['ξ', 1 / model.levelInfo(13).meanSeconds], ['ο', 1 / model.levelInfo(14).meanSeconds], ['π', 1 / model.levelInfo(15).meanSeconds], ['ρ', 1 / model.levelInfo(16).meanSeconds]]));
  assert.match(tip, new RegExp(`\\(ξ 7 pB, ο 77 pB, π 693 pB, ρ 2${NN}772 pB\\)`));
  noLeak(tip, 'physical tip');
  // the tooltip of every voice, with a live reading and without (outside the catalogue)
  for (const r of rowsT) {
    const info = model.levelInfo(r.level);
    for (const live of [null, { phase: 0.3, loud: 0.62, state: 'falling' }, { phase: 0, loud: 0, state: 'rising' }, { phase: 0.9999, loud: 1, state: 'rising' }]) {
      const html = W.voiceTip({ row: r, info, pure, live, int: pure.groupDigits, color: '#fff', hz: frequencyOf(r, 110) });
      noLeak(plainText(html), `tip of depth ${r.depth}`);
      assert.doesNotMatch(plainText(html), /Hz|%|\bbeats?\b|\b[A-G][#♯]?\d\b/);
      // loudness is a pair; so is the phase of a minor level. A major period never draws its phase: its quarter instead
      assert.equal((html.match(/class="pure-pair"/g) ?? []).length, live ? (pure.isMajor(r.level) ? 1 : 2) : 0, 'phase and loudness are glyph pairs');
      if (live && pure.isMajor(r.level)) assert.match(plainText(html), new RegExp(`Now: (${pure.QUARTER_WORDS.join('|')}) quarter \\(`));
      assert.match(html, new RegExp(`one cycle = ${pure.cycleLength(r.level).replace('.', '\\.')}`));
      assert.match(plainText(html), /Placed .*: [\d. ]+ pB/, 'the placed pitch is in pB');
    }
  }
  assert.match(W.nowPure(pure, null), /^outside the catalogue$/);
});

test('pure wording: the voice tooltip teaches ratio, register, pitch and rate in Fractonica terms', () => {
  const r = rowsT[4]; // epsilon, depth 5
  const html = W.voiceTip({ row: r, info: model.levelInfo(4), pure, live: { phase: 0.3, loud: 0.5, state: 'falling' }, int: pure.groupDigits, color: '#0ff', hz: frequencyOf(r, 110) });
  const text = plainText(html);
  assert.match(text, /^ε depth 5 · Nuclide, a minor unit · one cycle = 1ε /);
  assert.match(text, new RegExp(`1${NN}625 such cycles fit in one α cycle`));
  assert.match(text, /Folded into one octave: 1625\/1024 = ×1\.59 \(799\.5¢\)/);
  assert.match(text, /Placed 1 octave above the ground: 108\.5 pB, sounding at 3\.17 : 1 to α/);
  assert.match(text, new RegExp(`True rate of this cycle: 1 per 4${NN}504${NN}500 Blinks`));
  assert.match(text, /Now: phase \(falling\), loudness/);
  const a = W.voiceTip({ row: rowsT[0], info: model.levelInfo(0), pure, live: null, int: pure.groupDigits, color: '#0ff', hz: 110 });
  assert.match(plainText(a), /The slowest cycle of the hierarchy is the ground itself: 1 : 1\./);
  assert.match(plainText(a), /Placed in the ground octave: 34\.2 pB True rate/);
  // the deepest cycles say their whole number
  const xi = W.voiceTip({ row: rowsT[13], info: model.levelInfo(13), pure, live: null, int: pure.groupDigits, color: '#0ff', hz: frequencyOf(rowsT[13], 110) });
  assert.match(plainText(xi), /one cycle = 0\.14ν/);
  assert.match(plainText(xi), /True rate of this cycle: 7 pB/);
  // a depth between two units: its length is a count of the next unit
  const zeta = W.voiceTip({ row: rowsT[5], info: model.levelInfo(5), pure, live: null, int: pure.groupDigits, color: '#0ff', hz: frequencyOf(rowsT[5], 110) });
  assert.match(plainText(zeta), /^ζ depth 6 · between two units · one cycle = 11η /);
  assert.match(plainText(zeta), new RegExp(`True rate of this cycle: 1 per 643${NN}500 Blinks`));
  // a major period: named in words with its quarter, never a phase pair (the caller passes pure.majorText)
  const major = pure.majorText(VECTOR_A, 3);
  assert.equal(major, 'Delta Trifracton End', 'SPEC §15.6 vector A');
  const delta = W.voiceTip({ row: rowsT[3], info: model.levelInfo(3), pure, live: { phase: 0.9, loud: 0.4, state: 'rising', major }, int: pure.groupDigits, color: '#0ff', hz: frequencyOf(rowsT[3], 110) });
  assert.match(plainText(delta), /^δ depth 4 · Delta, a major period · one cycle = 1δ /);
  assert.match(plainText(delta), /Now: Delta Trifracton End \(rising\), loudness/);
  assert.equal((delta.match(/class="pure-pair"/g) ?? []).length, 1, 'only the loudness pair');
  assert.doesNotMatch(delta, /aria-label="phase/);
  // a minor level keeps its phase pair and never gets a fracton name
  assert.doesNotMatch(plainText(html), /fracton/);
  // without a pitch the sentence stays whole (no "undefined", no stray colon)
  assert.doesNotMatch(plainText(W.voiceTip({ row: r, info: model.levelInfo(4), pure, live: null, int: pure.groupDigits, color: '#0ff' })), /undefined|NaN|: ,/);
});

test('pure wording: normal mode keeps its numbers (the pure helpers do not replace them)', () => {
  assert.equal(fmtHz(247.7), '247.7 Hz');
  assert.equal(fmtOct(-1), '−1 oct');
  assert.equal(fmtRate(3600), '×3,600');
  assert.equal(fmtPeriod(16.2 * 86400), '16.2 d');
  assert.equal(fmtSecondsShort(4), '4 s');
  assert.equal(fmtDb(-18), '−18 dB');
  assert.equal(noteLabel(349.2), 'F4 ±0¢');
  assert.equal(rowsT[2].ratio, '65:64');
  // the stored tempo is still seconds (the settings, the audio and the normal box)
  assert.equal(DEFAULT_SETTINGS.tempo.seconds, 4);
  assert.deepEqual(LIMITS.tempoSeconds, [0.25, 600]);
});
