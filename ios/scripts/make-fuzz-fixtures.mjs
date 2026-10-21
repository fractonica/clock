#!/usr/bin/env node
/**
 * Fuzz fixtures for FractonicaKit: an independent second opinion next to make-fixtures.mjs.
 *
 *   node ios/scripts/make-fuzz-fixtures.mjs        (from the repository root)
 *
 * make-fixtures.mjs samples instants the way a user meets them (the SPEC vectors, every eclipse, a log-uniform spread
 * around today). This generator aims where a port breaks instead:
 *
 *   - instants a hair either side of exact cycle boundaries at every level 0 … 13 (±0.5 ms, ±1 ms, ±2 ms, and the
 *     boundary itself), where the 1 ms query rounding, the exact position and the float progress all have to agree
 *   - the same around solar sync boundaries, including the first and last whole syncs of the catalogue
 *   - every Saros interval, the far past and far future of the catalogue, Unix times before 1970
 *   - millisecond rounding ties x.xxx5 (Math.round rounds halves up, also for negative times)
 *   - levels 0 … 13 with 2- and 3-stroke glyphs, odometers of 1 … 3 digits, stateOccurrences both ways with count 3,
 *     upcomingEnds over random level ranges, cycle facts and boundaries windows that start or end on a boundary
 *   - pure-mode dates, stamps, cycle names and spans at random levels and cycles, spans a hair either side of whole
 *     unit counts, the journal face for every unit at unit boundaries, Earth time in zones with odd offsets
 *
 * It uses its own PRNG (sfc32, a different seed) and writes one file, Fixtures/fuzz.json, which FuzzFixtureTests replays
 * with the same tolerances as the golden tests: integers and strings exactly, times within 0.5 ms, phases and progress
 * within 1e-9. Values keep full double precision, so the tests can also report how many times are bit-identical.
 * JSON has no NaN or Infinity: where an input is one of those it is written as the string "NaN", "Infinity" or
 * "-Infinity".
 *
 * Compact records (field orders are written into the file next to the data):
 *   level      [level, strokes, cycle, local, phase, progress, quarter, index, start, end, duration, clipped, remaining,
 *               nextName, nextTime, thresholdTimes | null]   value / derivative / dot / trits follow from `index` and
 *               are checked against the exhaustive glyph fixtures
 *   odometer   [level, strokes, digits, states, nextTime, ...digitValues]
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../fractonica.js';
import { createModel } from '../../src/core/model.js';
import { createPure } from '../../src/core/pure.js';
import * as fmt from '../../src/core/format.js';
import { journalReading, clampUnit, MAX_UNIT } from '../../src/ui/face/journal.js';

const F = globalThis.Fractonica;
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../FractonicaKit/Tests/FractonicaKitTests/Fixtures/fuzz.json');

const model = createModel();
const pure = createPure(model);
const { tMin, tMax, extent } = model;
const MAX_LEVEL = 13;
const LEVELS = Array.from({ length: MAX_LEVEL + 1 }, (_, i) => i);

// ---- deterministic randomness: sfc32, seeded independently of make-fixtures.mjs --------------------------------
function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}
const rand = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x0fa1c0ad);
for (let i = 0; i < 32; i++) rand(); // warm up
const uniform = (lo, hi) => lo + (hi - lo) * rand();
const int = (lo, hi) => Math.floor(uniform(lo, hi + 1)); // inclusive
const pick = (xs) => xs[int(0, xs.length - 1)];
const chance = (p) => rand() < p;
/** Uniform BigInt in [0, n). */
function bigBelow(n) {
  let r = 0n;
  for (let i = 0; i < 4; i++) r = (r << 32n) | BigInt(Math.floor(rand() * 2 ** 32));
  return r % n;
}
/** Draw `k` distinct levels from LEVELS. */
function someLevels(k, must = []) {
  const set = new Set(must.filter((L) => L >= 0 && L <= MAX_LEVEL));
  while (set.size < Math.min(k + must.length, LEVELS.length)) set.add(pick(LEVELS));
  return [...set].sort((a, b) => a - b);
}

// ---- interesting instants -----------------------------------------------------------------------------------------
const P = (L) => model.clock.prefix(L);
/** The library's exact start of cycle `idx` at `level`, as F.number. */
const boundaryTime = (level, idx) => F.number(model.clock.timestampAt(F.rational(idx * 4n, P(level))));
/** Cycle indices worth a look at a level: both ends, around the anchor and 1970, today, and random ones. */
function cycleIndices(level, n) {
  const count = model.clock.count(level);
  const P4 = (pos) => (BigInt(Math.floor(pos * 1e6)) * P(level)) / 4000000n;
  const out = new Set([0n, 1n, count - 1n, P4(20), P4(19.65), P4(22.93)]);
  while (out.size < n) out.add(bigBelow(count));
  return [...out].filter((i) => i >= 0n && i < count);
}
const OFFSETS = [0, -0.0005, 0.0005, -0.001, 0.001, -0.002, 0.002];

/** [t, tag, focusLevel] */
const instants = [];
for (const level of LEVELS) {
  for (const idx of cycleIndices(level, 8)) {
    const b = boundaryTime(level, idx);
    for (const off of OFFSETS) instants.push([b + off, 'boundary', level]);
  }
}
// every Saros interval: its eclipse, a millisecond either side, and two draws inside
for (let k = 0; k < extent; k++) {
  const e0 = model.catalogue[k], e1 = model.catalogue[k + 1];
  instants.push([e0, 'eclipse', -1], [e0 + 0.0005, 'eclipse', -1], [e0 - 0.0015, 'eclipse', -1]);
  instants.push([uniform(e0, e1), 'interval', -1], [uniform(e0, e1), 'interval', -1]);
}
instants.push([tMax, 'edge', -1], [tMax - 0.0005, 'edge', -1], [tMax - 0.0015, 'edge', -1], [tMax + 0.0004, 'edge', -1], [tMin - 0.0004, 'edge', -1], [tMin - 0.0006, 'edge', -1]);
// the far past and far future of the catalogue (first and last 2 % of it)
for (let i = 0; i < 40; i++) instants.push([tMin + uniform(0, 0.02) * (tMax - tMin), 'far', -1], [tMax - uniform(0, 0.02) * (tMax - tMin), 'far', -1]);
// before 1970
for (let i = 0; i < 50; i++) instants.push([uniform(tMin, 0), 'negative', -1]);
// millisecond rounding ties x.xxx5, positive and negative
for (let i = 0; i < 70; i++) {
  const whole = Math.floor(uniform(tMin, tMax) * 1000) / 1000;
  instants.push([whole + 0.0005, 'tie', -1], [whole - 0.0005, 'tie', -1]);
}
for (let i = 0; i < 20; i++) instants.push([Math.floor(uniform(-1e9, 0)) + 0.0005, 'tie', -1], [Math.floor(uniform(-1e9, 0)) - 0.0005, 'tie', -1]);
// a few uniform draws in microseconds-from-now style
for (let i = 0; i < 40; i++) instants.push([1791460800 + uniform(-1, 1) * 10 ** uniform(0, 8), 'near', -1]);

// ---- records ------------------------------------------------------------------------------------------------------
const LEVEL_FIELDS = 'level strokes cycle local phase progress quarter index start end duration clipped remaining nextName nextTime thresholdTimes';
function levelRecord(t, L, strokes, withThresholds) {
  const l = model.levelAt(t, L, { strokes });
  if (!l) return [L, strokes, null];
  return [L, strokes, l.cycle, l.local, l.phase, l.progress, l.quarter, l.index, l.start, l.end, l.duration, l.clipped,
    l.remaining, l.next.name, l.next.time, withThresholds ? l.thresholds.map((e) => e.time) : null];
}
const ODOMETER_FIELDS = 'level strokes digits states nextTime ...digitValues';
function odometerRecord(t, L, strokes, digits) {
  const o = model.odometerAt(t, L, { strokes, digits });
  return o ? [L, strokes, digits, o.states, o.nextTime, ...o.digits] : [L, strokes, digits, null];
}
const solarRecord = (s) => s && [s.sync, s.start, s.end, s.nominalStart, s.phase, s.drift, s.quarter, s.threshold.name, s.threshold.time, s.digits3, s.digits2x3, s.beforeAnchor];
const SOLAR_FIELDS = 'sync start end nominalStart phase drift quarter thresholdName thresholdTime digits3 digits2x3 beforeAnchor';

function readingsSection() {
  return instants.map(([t, tag, focus], i) => {
    const full = tag !== 'boundary' && i % 6 === 0;
    const levels = full ? LEVELS : someLevels(focus >= 0 ? 1 : 4, focus >= 0 ? [focus - 1, focus, focus + 1] : []);
    const L = levels.map((lv) => levelRecord(t, lv, 2, lv === focus || chance(0.15)));
    for (const lv of focus >= 0 ? [focus, pick(LEVELS)] : [pick(LEVELS), pick(LEVELS)]) L.push(levelRecord(t, lv, 3, false));
    const O = [];
    if (focus >= 0) for (const [s, d] of [[2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]]) O.push(odometerRecord(t, focus, s, d));
    for (let k = 0; k < 4; k++) O.push(odometerRecord(t, pick(LEVELS), pick([2, 3]), int(1, 3)));
    const loc = model.locate(t);
    return {
      t, tag, focus, inRange: model.inRange(t), clamp: model.clamp(t), pos: model.positionOf(t), locate: loc && [loc.k, loc.f],
      L, O, S: solarRecord(model.solarAt(t)), A: model.addressAt(t),
    };
  });
}

// ---- solar sync boundaries ----------------------------------------------------------------------------------------
function solarSection() {
  let first = -3000;
  while (!model.solarSyncByNumber(first)) first++;
  let last = 60000;
  while (!model.solarSyncByNumber(last)) last--;
  const numbers = new Set([first, first + 1, last - 1, last, -1, 0, 1]);
  while (numbers.size < 60) numbers.add(int(first, last));
  const out = [];
  for (const n of numbers) {
    const s = model.solarSyncByNumber(n);
    const q = (s.end - s.start) / 4;
    const at = [s.start, s.start + q, s.start + 2 * q, s.start + 3 * q, s.end];
    for (const b of chance(0.5) ? at : [s.start]) {
      for (const off of OFFSETS) out.push([b + off, solarRecord(model.solarAt(b + off))]);
    }
  }
  // just outside the first and last whole syncs
  for (const t of [model.solarSyncByNumber(first).start - 0.001, model.solarSyncByNumber(last).end + 0.001, tMin, tMax]) {
    out.push([t, solarRecord(model.solarAt(t))]);
  }
  const syncs = [...numbers, first - 1, last + 1, -1e6, 1e6].map((n) => {
    const s = model.solarSyncByNumber(n);
    return [n, s && [s.start, s.end, s.nominalStart, s.drift]];
  });
  return { fields: SOLAR_FIELDS, readings: out, syncs };
}

// ---- cycles: facts, windows, upcoming ends, state search ----------------------------------------------------------
const factsRecord = (c) => c && [c.cycle, c.start, c.end, c.duration, c.clipped, c.events.map((e) => e.time)];
function cyclesSection() {
  const facts = [];
  for (const level of LEVELS) {
    const count = model.clock.count(level);
    const idx = new Set([count - 1n, count - 2n, count, count + 1n]);
    for (const i of cycleIndices(level, 14)) idx.add(i);
    for (const i of idx) facts.push([level, String(i), factsRecord(model.cycleByIndex(level, i))]);
  }
  const factsAt = instants.filter((_, i) => i % 11 === 0).map(([t]) => {
    const level = pick(LEVELS);
    return [t, level, factsRecord(model.cycleAt(t, level))];
  });

  const windows = [];
  for (let i = 0; i < 160; i++) {
    const level = pick(LEVELS);
    const count = model.clock.count(level);
    const idx = bigBelow(count);
    const b = boundaryTime(level, idx);
    const len = model.levelInfo(level).meanSeconds * uniform(0.5, 9);
    const shift = pick([0, 1e-7, -1e-7, 1e-6, -1e-6, 2e-6, -2e-6, 0.0005]);
    // windows that start on a boundary, end on one, or straddle the catalogue edges
    const [t0, t1] = i % 4 === 0 ? [b + shift, b + shift + len] : i % 4 === 1 ? [b - len + shift, b + shift] : i % 4 === 2 ? [b - len / 2, b + len / 2] : [pick([tMin, tMax]) - len / 2, pick([tMin, tMax]) + len / 2];
    const limit = pick([600, 600, 1, 2, 5, 0]);
    windows.push([level, t0, t1, limit, model.boundaries(level, t0, t1, limit).map((x) => [x.idx, x.local, x.time])]);
  }
  const startTimes = [];
  for (const level of LEVELS) {
    for (const i of cycleIndices(level, 8)) startTimes.push([level, Number(i), model.cycleStartTime(level, Number(i))]);
  }

  const upcoming = [];
  const ups = instants.filter(([, tag], i) => tag === 'boundary' ? i % 5 === 0 : i % 9 === 0);
  for (const [t] of ups) {
    const fromLevel = int(0, 12);
    const opts = { fromLevel, toLevel: int(fromLevel, MAX_LEVEL), count: int(1, 25), perLevel: int(1, 12) };
    upcoming.push([t, opts.fromLevel, opts.toLevel, opts.count, opts.perLevel,
      model.upcomingEnds(t, opts).map((e) => [e.time, e.top, e.levels])]);
  }
  for (const t of [tMax - 1, tMax - 0.0005, tMax, tMin, tMax - 2e5]) {
    upcoming.push([t, 0, 13, 40, 6, model.upcomingEnds(t, { fromLevel: 0, toLevel: 13, count: 40, perLevel: 6 }).map((e) => [e.time, e.top, e.levels])]);
  }

  const occurrences = [];
  const occ = instants.filter((_, i) => i % 4 === 1);
  for (const [t, tag, focus] of occ) {
    const level = focus >= 0 ? focus : pick(LEVELS);
    const strokes = pick([2, 3]);
    const q = strokes === 2 ? 16 : 52;
    const k = int(1, 3);
    // half the time the state showing right now (both directions must skip it), otherwise a random one
    const now = model.odometerAt(t, level, { strokes, digits: k });
    const digits = now && chance(0.5) ? [...now.digits] : Array.from({ length: k }, () => int(0, q - 1));
    for (const direction of [1, -1]) {
      occurrences.push([level, digits, t, strokes, direction, 3,
        model.stateOccurrences(level, digits, t, { strokes, direction, count: 3 }).map((o) => [o.start, o.end, o.cycle])]);
    }
  }
  for (const [t, level] of [[tMin, 0], [tMax, 0], [tMin + 1, 13], [tMax - 1, 13], [tMax, 6], [tMin, 6]]) {
    for (const direction of [1, -1]) {
      const digits = [0, 15];
      occurrences.push([level, digits, t, 2, direction, 3, model.stateOccurrences(level, digits, t, { strokes: 2, direction, count: 3 }).map((o) => [o.start, o.end, o.cycle])]);
    }
  }

  const paths = [];
  for (const level of LEVELS) {
    for (const i of cycleIndices(level, 6)) {
      const path = model.cycleToPath(level, i);
      const back = model.pathToCycle(path);
      paths.push([level, String(i), path, back === null ? null : String(back)]);
    }
  }
  const positions = [];
  for (let i = 0; i < 150; i++) {
    const p = i < 70 ? i + pick([0, 1e-12, -1e-12, 0.5, 1 - 1e-9]) : uniform(-0.5, extent + 0.5);
    positions.push([p, model.timeOfPosition(p)]);
  }
  return { factsFields: 'cycle start end duration clipped eventTimes', facts, factsAt, windows, startTimes, upcoming, occurrences, paths, positions };
}

// ---- pure notation ------------------------------------------------------------------------------------------------
const UPTO = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'eta', 'iota', 'lambda', 'nu', 'zeta'];
function pureSection() {
  const moments = [];
  const pureTimes = instants.filter(([, tag, focus], i) => (tag === 'boundary' ? focus <= 12 && i % 2 === 0 : i % 3 === 0));
  for (const [t] of pureTimes) {
    const form = pick(['short', 'full']);
    const letters = chance(0.5);
    const upTo = pick(UPTO);
    const levels = someLevels(3);
    moments.push({
      t,
      clock: pure.clock(t),
      date: pure.date(t),
      dateText: [form, letters, upTo, pure.dateText(t, { form, letters, upTo })],
      dateFull: pure.dateText(t, { form: 'full', upTo: 'nu' }),
      stamp: [upTo, pure.stamp(t, upTo)],
      clockText: [upTo, pure.clockText(t, upTo)],
      majorText: [levels[0] % 5, pure.majorText(t, levels[0] % 5)],
      quarter: levels.map((L) => [L, pure.quarterAt(t, L)]),
      names: levels.map((L) => [L, pure.nameAt(t, L), pure.nameAt(t, L, { short: true }), pure.addressAt(t, L)]),
    });
  }

  const cycles = [];
  for (let i = 0; i < 500; i++) {
    const level = i < 21 ? i : int(0, 20);
    const count = model.clock.count(level);
    const idx = i % 7 === 0 ? pick([0n, count - 1n, 1n]) : bigBelow(count);
    cycles.push([level, String(idx), pure.countsAtStart(level, idx), pure.ordinalOf(level, idx), pure.cycleName(level, idx),
      pure.cycleName(level, idx, { short: true }), pure.cycleShort(level, idx)]);
  }

  // spans: whole unit counts and a hair either side of them, random spans, durations and countdowns
  const lengths = pure.UNITS.map((u) => pure.unitPos(u));
  const spanInputs = [];
  for (let i = 0; i < 260; i++) {
    const len = pick(lengths);
    const n = int(1, 80);
    const base = n * len + (chance(0.4) ? pick(lengths) * int(0, 12) : 0);
    const nudge = pick([0, 1e-12, -1e-12, 5e-13, -5e-13, 2e-12, -2e-12, 1e-15, -1e-15]);
    spanInputs.push((chance(0.25) ? -1 : 1) * (base + nudge));
  }
  for (let L = 0; L <= 20; L++) spanInputs.push(4 / model.levelInfo(L).prefixNum, -4 / model.levelInfo(L).prefixNum);
  for (let i = 0; i < 60; i++) spanInputs.push(lengths.at(-1) * uniform(0, 12));
  const spans = spanInputs.map((dpos) => {
    const parts = int(1, 5);
    const keepZeros = chance(0.35);
    return [dpos, parts, keepZeros, pure.decompose(dpos, parts, keepZeros).map((c) => [c.unit.sym, c.count]),
      pure.durationPos(dpos, { parts, keepZeros }), pure.durationPos(dpos)];
  });
  const durations = [];
  for (let i = 0; i < 200; i++) {
    const seconds = (chance(0.3) ? -1 : 1) * (chance(0.3) ? pick([0.31092, 7.773, 505.2, 18187, 1400465]) * int(1, 40) : 10 ** uniform(-4, 10));
    const at = pick(instants)[0];
    const parts = int(1, 4);
    const keepZeros = chance(0.25);
    durations.push([seconds, at, parts, keepZeros, pure.duration(seconds, { parts, at, keepZeros }), pure.countdown(seconds, { parts, at, keepZeros })]);
  }
  const between = [];
  for (let i = 0; i < 200; i++) {
    const [t1] = pick(instants);
    const t2 = chance(0.5) ? pick(instants)[0] : t1 + (chance(0.5) ? -1 : 1) * 10 ** uniform(-3, 9.5);
    const parts = int(1, 4);
    const keepZeros = chance(0.2);
    between.push([t1, t2, parts, keepZeros, pure.between(t1, t2, { parts, keepZeros })]);
  }
  const cycleLength = [];
  for (let L = 0; L <= 20; L++) for (const parts of [1, 2, 3, 4]) cycleLength.push([L, parts, pure.cycleLength(L, { parts })]);

  const drift = [];
  for (let i = 0; i < 120; i++) {
    const n = int(-2300, 57000);
    const s = model.solarSyncByNumber(n);
    if (s) drift.push([s.start, s.nominalStart, s.drift, pure.driftLambda(s), pure.driftText(s)]);
  }
  for (const [t] of instants.filter((_, i) => i % 13 === 0)) {
    const s = model.solarAt(t);
    if (s) drift.push([s.start, s.nominalStart, s.drift, pure.driftLambda(s), pure.driftText(s)]);
  }
  const rateInputs = [];
  for (let i = 0; i < 120; i++) {
    const r = chance(0.4) ? pick(pure.RATES).rate * uniform(0.99, 1.01) : 10 ** uniform(-3, 10);
    rateInputs.push(chance(0.2) ? -r : r);
  }
  const rates = rateInputs.map((r) => [r, pure.rateLabel(r)]);
  const blinks = [];
  for (let i = 0; i < 100; i++) {
    const s = (chance(0.1) ? -1 : 1) * 10 ** uniform(-5, 7);
    blinks.push([s, pure.blinks(s), pure.secondsToBlinks(s), pure.perBlink(s)]);
  }
  const pb = [];
  for (let i = 0; i < 100; i++) {
    const x = chance(0.3) ? pick([0.04, 99.95, 999.5, 7, 77, 693, 2772]) * uniform(0.999, 1.001) : 10 ** uniform(-4, 6);
    pb.push([x, pure.pbText(x)]);
  }
  const groups = [];
  for (let i = 0; i < 60; i++) {
    const n = (chance(0.3) ? -1 : 1) * 10 ** uniform(0, 16);
    groups.push([n, pure.groupDigits(n)]);
  }
  const secondsPerPosition = [];
  for (const e of model.catalogue) for (const off of [0, -0.0005, 0.0005, -0.001]) secondsPerPosition.push([e + off, pure.secondsPerPosition(e + off)]);
  for (const t of [tMax - 0.001, tMax - 0.0009, tMax - 0.0011, tMin - 1, tMax + 1]) secondsPerPosition.push([t, pure.secondsPerPosition(t)]);
  const pairs = [];
  for (let i = 0; i < 120; i++) {
    const f = chance(0.5) ? int(0, 256) / 256 + pick([0, 1e-17, -1e-17, 1e-12, -1e-12]) : uniform(-0.2, 1.2);
    pairs.push([f, pure.pair(f).index, pure.pairText(f)]);
  }
  return { moments, cycles, spans, durations, between, cycleLength, drift, rates, blinks, pb, groups, secondsPerPosition, pairs };
}

// ---- journal face: every unit at unit boundaries --------------------------------------------------------------------
function journalSection() {
  const UNIT_LEVELS = [0, 1, 2, 3, 4, 6, 8, 10, 12];
  const times = [];
  for (const level of UNIT_LEVELS) {
    for (const idx of cycleIndices(level, 5)) {
      const b = boundaryTime(level, idx);
      for (const off of [0, -0.0005, 0.0005, -0.002, 0.002]) times.push(b + off);
    }
  }
  for (let i = 0; i < 20; i++) times.push(uniform(tMin, tMax));
  times.push(tMax, tMax - 0.0005, tMin, tMin - 0.001);
  const out = [];
  for (const t of times) {
    const readings = [];
    for (let u = -1; u <= MAX_UNIT + 1; u++) {
      const r = journalReading({ model, pure }, t, u);
      readings.push(r && [r.unit, r.levels, r.lead.level, r.lead.letter, r.lead.phase,
        r.tokens && r.tokens.map((x) => [x.level, x.text]), r.major && [r.major.level, r.major.lines, r.major.index3]]);
    }
    out.push([t, readings]);
  }
  const clamps = [0, 0.5, 1.5, 2.4999, 5.5, 6.5, 7, -0.5, -3, 1e300, -1e300, ...Array.from({ length: 20 }, () => uniform(-2, 9))].map((u) => [u, clampUnit(u)]);
  return { fields: 'unit levels leadLevel leadLetter leadPhase tokens major', readings: out, clamps };
}

// ---- Earth time in zones with odd offsets ---------------------------------------------------------------------------
function earthSection() {
  const ZONES = ['Europe/London', 'Asia/Kathmandu', 'Pacific/Chatham', 'America/St_Johns', 'Africa/Monrovia',
    'Europe/Amsterdam', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Australia/Adelaide', 'Asia/Tehran',
    'America/Sao_Paulo', 'Europe/Dublin', 'Asia/Tokyo', 'Pacific/Apia', 'America/Caracas'];
  const times = [];
  for (let i = 0; i < 30; i++) times.push(uniform(-2e9, 2.2e9));
  for (let i = 0; i < 12; i++) times.push(uniform(tMin, tMax));
  for (let i = 0; i < 8; i++) times.push(Math.floor(uniform(1.5e9, 2.5e9) / 3600) * 3600 + pick([-1, 0, 1, 1799, 1800]));
  times.push(0, -0.0005, 0.0005, 1e9 + 0.9995, -1e9 - 0.9995);
  const parts = [];
  for (const zone of ZONES) {
    for (const t of times) {
      const p = fmt.zonedParts(t, zone);
      parts.push([zone, t, [p.year, p.month, p.day, p.hour, p.minute, p.second, p.ms, p.weekday, p.offset]]);
    }
  }
  const toUnix = [];
  for (const zone of ZONES) {
    for (let i = 0; i < 18; i++) {
      // half of them around the zone's own transitions: 01:00 … 03:59 local in March, April, September … November
      const near = chance(0.5);
      const f = {
        year: int(near ? 1960 : 1650, near ? 2100 : 2800),
        month: near ? pick([3, 4, 9, 10, 11]) : int(1, 12),
        day: int(1, 28),
        hour: near ? int(0, 3) : int(0, 23),
        minute: pick([0, 15, 30, 45, int(0, 59)]),
        second: int(0, 59),
        ms: int(0, 999),
      };
      toUnix.push([zone, [f.year, f.month, f.day, f.hour, f.minute, f.second, f.ms], fmt.zonedToUnix(f, zone)]);
    }
  }
  const formatted = [];
  for (const zone of ZONES) {
    const f = fmt.createFormatter(() => zone);
    for (let i = 0; i < 6; i++) {
      const t = pick(times);
      const ref = t + pick([0, 1, -1, 43200, -86400, 3e7]);
      formatted.push([zone, t, ref, f.long(t), f.short(t), f.label(t, ref), f.tag(t), f.iso(t), f.dateTime(t, { ms: true })]);
    }
  }
  const durations = [];
  for (let i = 0; i < 80; i++) {
    const s = (chance(0.3) ? -1 : 1) * (chance(0.3) ? pick([0.9995, 9.95, 59.95, 3599.5, 86399.5, 31557599.5]) * uniform(0.999, 1.001) : 10 ** uniform(-4, 10.5));
    durations.push([s, fmt.duration(s), fmt.duration(s, { parts: 3 }), fmt.countdown(s)]);
  }
  // odd inputs the helpers still define: offsets that are not whole or not finite, months and days out of range
  const offsets = [NaN, Infinity, -Infinity, 1e300, -1e25, 0.5, -0.5, 59.5, 3599.5, -86399.4, ...Array.from({ length: 20 }, () => uniform(-2e5, 2e5))].map((o) => [o, fmt.offsetLabel(o)]);
  const civil = Array.from({ length: 60 }, () => {
    const [y, m, d] = [int(-500, 3000), int(-30, 30), int(-40, 80)];
    return [y, m, d, fmt.daysFromCivil(y, m, d)];
  });
  const rollover = [];
  for (const zone of ['UTC', 'Europe/Moscow', 'America/New_York']) {
    for (let i = 0; i < 12; i++) {
      const f = { year: int(1700, 2600), month: int(-14, 26), day: int(-40, 70), hour: int(-30, 50), minute: int(-90, 150), second: int(-100, 200), ms: int(0, 999) };
      rollover.push([zone, [f.year, f.month, f.day, f.hour, f.minute, f.second, f.ms], fmt.zonedToUnix(f, zone)]);
    }
  }
  return { zones: ZONES, parts, toUnix, formatted, durations, offsets, civil, rollover };
}

// ---- write ----------------------------------------------------------------------------------------------------------
const data = {
  levelFields: LEVEL_FIELDS,
  odometerFields: ODOMETER_FIELDS,
  readings: readingsSection(),
  solar: solarSection(),
  cycles: cyclesSection(),
  pure: pureSection(),
  journal: journalSection(),
  earth: earthSection(),
};
const json = JSON.stringify(data, (_k, v) => {
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v); // "NaN", "Infinity", "-Infinity"
  return v;
});
writeFileSync(OUT, json + '\n');
console.log(`fuzz.json  ${(json.length / 1024).toFixed(0)} KB, ${instants.length} instants`);
