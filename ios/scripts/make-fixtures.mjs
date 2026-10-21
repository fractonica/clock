#!/usr/bin/env node
/**
 * Golden fixtures for FractonicaKit, generated from the web app's own JavaScript.
 *
 *   node ios/scripts/make-fixtures.mjs        (from the repository root)
 *
 * Loads the reference library (fractonica.js) and the app's real modules – src/core/model.js, pure.js, format.js and
 * src/ui/face/journal.js – queries them over a deterministic spread of inputs, and writes JSON files into
 * ios/FractonicaKit/Tests/FractonicaKitTests/Fixtures/. The Swift tests replay every input and compare: integers and
 * strings exactly, times within 0.5 ms, phases and progress within 1e-9.
 *
 * Inputs come from a seeded PRNG (mulberry32), so the files only change when the JavaScript changes. Times cover the
 * SPEC §12 / §15.6 vectors, the catalogue edges (inside, on, just outside, the 1 ms EDGE rule), every eclipse
 * instant, exact cycle boundaries at several levels, log-uniform offsets around SPEC vector A and uniform draws over
 * the whole catalogue.
 *
 * Compact records. Level readings and odometers are arrays (field order in LEVEL_FIELDS / ODOMETER_FIELDS below) and
 * the times and phases of the per-sample readings are rounded to what the tests resolve (0.1 ms; 13 significant
 * digits), which keeps the fixtures small; every other record is a plain object named after the JavaScript field and
 * keeps full precision. JSON has no BigInt: exact integers that can exceed 2^53 (prefixes, counts) are decimal strings.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../fractonica.js';
import { createModel, QUARTER_NAMES } from '../../src/core/model.js';
import { createPure } from '../../src/core/pure.js';
import * as fmt from '../../src/core/format.js';
import { journalReading, arcPoint, ordinal, clampUnit, MAX_UNIT, JOURNAL_UNITS } from '../../src/ui/face/journal.js';

const F = globalThis.Fractonica;
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '../FractonicaKit/Tests/FractonicaKitTests/Fixtures');

const model = createModel();
const pure = createPure(model);
const { tMin, tMax } = model;
const MAX_LEVEL = 13;
const LEVELS = Array.from({ length: MAX_LEVEL + 1 }, (_, i) => i);
const A = 1791460800; // SPEC vector A, 2026-10-08T12:00:00Z
const B = 946684800;
const C = 2886085800;
const ANCHOR_PLUS_ONE = 125593320.816;

// ---- deterministic randomness ---------------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5a7051);
const uniform = (lo, hi) => lo + (hi - lo) * rand();
const int = (lo, hi) => Math.floor(uniform(lo, hi + 1)); // inclusive
const pick = (xs) => xs[int(0, xs.length - 1)];
const bigRand = (n) => {
  // uniform BigInt in [0, n)
  let r = 0n;
  for (let i = 0; i < 4; i++) r = (r << 32n) | BigInt(Math.floor(rand() * 2 ** 32));
  return r % n;
};

// ---- sample times ---------------------------------------------------------------------------------------------
function sampleTimes() {
  const out = [A, B, C, ANCHOR_PLUS_ONE];
  // catalogue edges and the EDGE rule (levelAt / odometerAt query 1 ms inside the end)
  out.push(tMin, tMin + 0.001, tMin + 0.0004, tMin + 0.0005, tMin - 0.001, tMin - 1);
  out.push(tMax, tMax - 0.001, tMax - 0.0004, tMax - 0.0005, tMax - 0.0006, tMax - 0.002, tMax - 1, tMax + 0.001, tMax + 1);
  // every eclipse instant, a few with a millisecond either side
  model.catalogue.forEach((e, k) => {
    out.push(e);
    if (k % 7 === 3) out.push(e - 0.001, e + 0.001);
  });
  // exact cycle boundaries: the library's start time of random cycles, and the model's float start
  for (const level of [0, 1, 2, 4, 6, 8, 10, 12, 13]) {
    const count = model.clock.count(level);
    for (let i = 0; i < 4; i++) {
      const idx = bigRand(count);
      out.push(F.number(model.clock.timestampAt(F.rational(idx * 4n, model.clock.prefix(level)))));
      const f = model.cycleStartTime(level, Number(idx));
      if (f !== null) out.push(f, f - 0.0005);
    }
  }
  // log-uniform offsets around vector A, both directions, with sub-millisecond parts
  for (let i = 0; i < 85; i++) out.push(A + (rand() < 0.5 ? -1 : 1) * 10 ** uniform(-3.5, 9.3));
  // uniform over the whole catalogue
  for (let i = 0; i < 75; i++) out.push(uniform(tMin, tMax));
  // millisecond rounding ties (Math.round rounds halves up, also for negative times)
  out.push(-1e9 - 0.0005, -1e9 + 0.0005, 1e9 + 0.0005, A + 0.0015, -443379486.4265);
  return out;
}
const TIMES = sampleTimes();

// ---- clock ------------------------------------------------------------------------------------------------------
/**
 * One level reading as an array:
 *   [cycle, local, phase, progress, quarter, index, value, derivative, dotted, trits, start, end, duration, clipped,
 *    remaining, nextName, nextTime, thresholdTimes]
 * thresholdTimes (the cycle's five events) is null where a sample leaves it out; the names are the library's
 * (clock.json `thresholdNames`).
 */
const LEVEL_FIELDS = 'cycle local phase progress quarter index value derivative dotted trits start end duration clipped remaining nextName nextTime thresholdTimes';
/** A time rounded to 0.1 ms, a phase to 13 significant digits (the tests compare within 0.5 ms and 1e-9). */
const time4 = (x) => (x === null ? null : Math.round(x * 1e4) / 1e4);
const fraction13 = (x) => Number(x.toPrecision(13));
const levelRecord = (l, withThresholds = true) =>
  l && [l.cycle, l.local, fraction13(l.phase), fraction13(l.progress), l.quarter, l.index, l.value, l.derivative, l.dotted,
    l.trits, time4(l.start), time4(l.end), time4(l.duration), l.clipped, time4(l.remaining), l.next.name, time4(l.next.time),
    withThresholds ? l.thresholds.map((e) => time4(e.time)) : null];
/** One odometer reading as an array: [states, nextTime, ...digits]. */
const ODOMETER_FIELDS = 'states nextTime ...digits';
const odometerRecord = (o) => o && [o.states, time4(o.nextTime), ...o.digits];

function clockFixture() {
  const levels = Array.from({ length: 21 }, (_, level) => {
    const i = model.levelInfo(level);
    return {
      level, depth: i.depth, letter: i.letter, suffix: i.suffix, text: i.text, factor: i.factor, siblings: i.siblings,
      prefix: String(i.prefix), prefixNum: i.prefixNum, meanSeconds: i.meanSeconds, count: String(model.clock.count(level)),
    };
  });
  // F.number on many reduced rationals: the conversion the model applies to every time, phase and drift
  const numbers = [];
  for (let i = 0; i < 400; i++) {
    const n = bigRand(10n ** BigInt(int(1, 30))) * (rand() < 0.3 ? -1n : 1n);
    const d = bigRand(10n ** BigInt(int(1, 22))) + 1n;
    const r = F.rational(n, d);
    numbers.push([String(r.numerator), String(r.denominator), F.number(r)]);
  }
  const periodNames = Array.from({ length: 60 }, (_, level) => {
    const p = F.periodName(level);
    return [level, p.letter, p.suffix, p.text];
  });
  return {
    sequence: model.sequence, quarterNames: QUARTER_NAMES, greek: model.greek,
    catalogue: model.catalogue, catalogueStrings: F.defaults.unixTimestamps, extent: model.extent, tMin, tMax,
    meanSaros: model.meanSaros, levels, numbers, periodNames,
    thresholdNames: ['begin', 'firstPeak', 'middleNode', 'oppositePeak', 'end'],
  };
}

function samplesFixture() {
  const strokes3Levels = [0, 3, 6, 9, 13];
  // every sample: 2-stroke readings at every level (with the cycle's threshold times in every third sample), the
  // 2 × 2-stroke odometers, solar sync, address; every other sample also the 3-stroke readings and the 3 × 2-stroke
  // and 2 × 3-stroke odometers
  const samples = TIMES.map((t, i) => ({
    t,
    inRange: model.inRange(t),
    clamp: model.clamp(t),
    pos: model.positionOf(t),
    locate: model.locate(t),
    levels: LEVELS.map((L) => levelRecord(model.levelAt(t, L), i % 3 === 0)),
    strokes3: i % 2 ? null : strokes3Levels.map((L) => levelRecord(model.levelAt(t, L, { strokes: 3 }), false)),
    odometer: {
      s2d2: LEVELS.map((L) => odometerRecord(model.odometerAt(t, L))),
      s2d3: i % 2 ? null : LEVELS.map((L) => odometerRecord(model.odometerAt(t, L, { digits: 3 }))),
      s3d2: i % 2 ? null : LEVELS.map((L) => odometerRecord(model.odometerAt(t, L, { strokes: 3 }))),
    },
    solar: model.solarAt(t),
    address: model.addressAt(t),
  }));
  return { levelFields: LEVEL_FIELDS, odometerFields: ODOMETER_FIELDS, strokes3Levels, samples };
}

function cyclesFixture() {
  const factsOf = (c) => c && { start: c.start, end: c.end, duration: c.duration, clipped: c.clipped, events: c.events.map((e) => e.time) };
  const byIndex = [];
  for (const level of LEVELS) {
    const count = model.clock.count(level);
    const idx = new Set([0n, 1n, count - 2n, count - 1n, count, -1n]);
    for (let i = 0; i < 6; i++) idx.add(bigRand(count));
    for (const i of idx) byIndex.push({ level, idx: String(i), facts: factsOf(i < 0n ? null : model.cycleByIndex(level, i)) });
  }
  const at = [];
  for (let i = 0; i < 60; i++) {
    const t = pick(TIMES);
    const level = int(0, MAX_LEVEL);
    at.push({ t, level, facts: factsOf(model.cycleAt(t, level)) });
  }
  const paths = [];
  for (const level of LEVELS) {
    const count = model.clock.count(level);
    for (const idx of [0n, count - 1n, bigRand(count), bigRand(count)]) {
      const path = model.cycleToPath(level, idx);
      const back = model.pathToCycle(path);
      paths.push({ level, idx: String(idx), path, back: back === null ? null : String(back) });
    }
  }
  const badPaths = [[0], [19], [18, 5], [1, 6], [1, 0], [18, 2, 1], [6, 4, 9, 3, 5, 2, 34]].map((path) => {
    const back = model.pathToCycle(path);
    return { path, back: back === null ? null : String(back) };
  });
  const startTimes = [];
  for (const level of LEVELS) {
    const count = Number(model.clock.count(level));
    for (const idx of [0, 1, count - 1, count, count + 1, int(0, count - 1), int(0, count - 1)]) {
      startTimes.push({ level, idx, time: model.cycleStartTime(level, idx) });
    }
  }
  const timeOfPosition = [-1, 0, 1e-9, 0.5, 22.927850216635, 68.9999999, 69, 70].map((p) => [p, model.timeOfPosition(p)]);
  for (let i = 0; i < 40; i++) {
    const p = uniform(0, model.extent);
    timeOfPosition.push([p, model.timeOfPosition(p)]);
  }
  const timestamps = [];
  for (let i = 0; i < 80; i++) {
    const d = bigRand(10n ** BigInt(int(1, 15))) + 1n;
    const n = bigRand(70n * d) - (i % 10 === 0 ? 5n : 0n);
    let time = null;
    try {
      time = F.number(model.clock.timestampAt(F.rational(n, d)));
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
    }
    timestamps.push([String(n), String(d), time]);
  }
  timestamps.push(['69', '1', F.number(model.clock.timestampAt(F.rational(69)))], ['70', '1', null], ['-1', '1000', null]);

  const boundaries = [];
  for (let i = 0; i < 60; i++) {
    const level = int(0, MAX_LEVEL);
    const len = model.levelInfo(level).meanSeconds * uniform(0.2, 12);
    const t0 = i < 4 ? [tMin - len / 2, tMax - len / 2, tMin - 10, tMax - len][i] : pick(TIMES) - uniform(0, len);
    const limit = i % 9 === 0 ? 3 : 600;
    boundaries.push({ level, t0, t1: t0 + len, limit, out: model.boundaries(level, t0, t0 + len, limit) });
  }
  boundaries.push({ level: 6, t0: A, t1: A - 1, limit: 600, out: model.boundaries(6, A, A - 1) });

  const upcoming = [];
  for (const t of [A, B, C, tMin, tMax, tMax - 3600, tMax - 1e6, tMin - 1, ...Array.from({ length: 25 }, () => pick(TIMES))]) {
    upcoming.push({ t, opts: null, out: model.upcomingEnds(t).map(({ time, top, levels }) => ({ time, top, levels })) });
  }
  for (let i = 0; i < 15; i++) {
    const fromLevel = int(0, 6);
    const opts = { fromLevel, toLevel: int(fromLevel, MAX_LEVEL), count: int(1, 30), perLevel: int(1, 10) };
    const t = pick(TIMES);
    upcoming.push({ t, opts, out: model.upcomingEnds(t, opts).map(({ time, top, levels }) => ({ time, top, levels })) });
  }

  const occurrences = [];
  for (let i = 0; i < 80; i++) {
    const level = int(0, MAX_LEVEL);
    const strokes = rand() < 0.7 ? 2 : 3;
    const q = strokes === 2 ? 16 : 52;
    const digits = Array.from({ length: int(1, strokes === 2 ? 3 : 2) }, () => int(0, q - 1));
    const opts = { strokes, direction: rand() < 0.5 ? 1 : -1, count: int(1, 3) };
    const t = i < 6 ? [tMin, tMax, tMin - 100, tMax + 100, tMin + 0.001, tMax - 0.001][i] : pick(TIMES);
    occurrences.push({ level, digits, t, opts, out: model.stateOccurrences(level, digits, t, opts) });
  }
  // the state showing right now, both ways
  const now = model.odometerAt(A, 6);
  for (const direction of [1, -1]) {
    occurrences.push({ level: 6, digits: now.digits, t: A, opts: { strokes: 2, direction, count: 2 }, out: model.stateOccurrences(6, now.digits, A, { direction, count: 2 }) });
  }

  const syncs = [];
  const first = (() => { let n = -2400; while (!model.solarSyncByNumber(n)) n++; return n; })();
  const last = (() => { let n = 60000; while (!model.solarSyncByNumber(n)) n--; return n; })();
  for (const n of [first - 1, first, first + 1, -1, 0, 1, 2375, 4820, 7987, last - 1, last, last + 1]) syncs.push({ n, out: model.solarSyncByNumber(n) });
  for (let i = 0; i < 40; i++) {
    const n = int(first, last);
    syncs.push({ n, out: model.solarSyncByNumber(n) });
  }
  return { byIndex, at, paths, badPaths, startTimes, timeOfPosition, timestamps, boundaries, upcoming, occurrences, syncs };
}

// ---- glyphs -----------------------------------------------------------------------------------------------------
function parsePath(d) {
  const tokens = d.trim().split(/[\s,]+|(?=[MLC])|(?<=[MLC])/).filter(Boolean);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    const n = { M: 2, L: 2, C: 6 }[cmd];
    if (!n) throw new Error(`unexpected path token ${cmd} in ${d}`);
    out.push([cmd, ...tokens.slice(i, i + n).map(Number)]);
    i += n;
  }
  return out;
}
function glyphsFixture() {
  const states = [];
  for (const strokes of [1, 2, 3]) {
    const total = 2 * (3 ** strokes - 1);
    for (let index = 0; index < total; index++) {
      const g = F.CBT.fromIndex(index, { depth: strokes });
      const geo = F.CBT.geometry(g, { thickness: 0.3 });
      states.push({
        strokes, index, value: Number(g.value), derivative: g.derivative, trits: [...g.trits], dotted: geo.dot !== null,
        path: geo.path, commands: parsePath(geo.path),
      });
    }
  }
  const bounds = [1, 2, 3, 4].map((strokes) => {
    const geo = F.CBT.geometry(F.CBT.fromIndex(0, { depth: strokes }), { thickness: 0.3 });
    return { strokes, ...geo.bounds };
  });
  const dot = F.CBT.geometry(F.CBT.fromIndex(5, { depth: 2 }), { thickness: 0.3 }).dot;
  const wrap = [-1, -17, 16, 33, 52, 1000, -1000].flatMap((index) =>
    [2, 3].map((strokes) => ({ index, strokes, k: Number(F.CBT.fromIndex(index, { depth: strokes }).index) })),
  );
  const states4 = Array.from({ length: 160 }, (_, index) => {
    const g = F.CBT.fromIndex(index, { depth: 4 });
    return [Number(g.value), g.derivative, [...g.trits]];
  });
  return { states, bounds, dot, wrap, states4 };
}

// ---- pure notation ----------------------------------------------------------------------------------------------
function pureFixture() {
  const unitJSON = (u) => ({ id: u.id, sym: u.sym, level: u.level, name: u.name, major: u.major });
  const lengths = pure.UNITS.map((u) => pure.unitPos(u));
  const statics = {
    levelNames: pure.LEVEL_NAMES, ordinalNames: pure.ORDINAL_NAMES, quarterWords: pure.QUARTER_WORDS,
    units: pure.UNITS.map(unitJSON), unitLevels: pure.UNIT_LEVELS,
    kinds: Array.from({ length: 21 }, (_, L) => [L, pure.isMajor(L), pure.isUnitLevel(L), pure.levelKind(L)]),
    unitOf: ['η', 'eta', 'Helion', 'ζ', 'zeta', 'nu', 'Blink', 'δ', 'x'].map((k) => [k, pure.unitOf(k)?.id ?? null]),
    unitName: [['η', 1], ['eta', 3], ['δ', 2], ['Blink', 1], ['ζ', 2], ['nu', 0]].map(([k, n]) => [k, n, pure.unitName(k, n)]),
    unitNameLevel: [[12, 1], [6, 2], [5, 1]].map(([k, n]) => [k, n, pure.unitName(k, n)]),
    ordinalName: Array.from({ length: 27 }, (_, i) => [i - 2, pure.ordinalName(i - 2)]),
    periodName: [], shortName: [],
    resolutionOf: Array.from({ length: 16 }, (_, L) => [L, pure.resolutionOf(L)]),
    eclipseName: [0, 22, 69].map((k) => [k, pure.eclipseName(k)]),
    catalogueText: pure.catalogueText(),
    cyclePos: Array.from({ length: 21 }, (_, L) => pure.cyclePos(L)),
    lengths, unitSeconds: pure.UNITS.map((u) => pure.unitSeconds(u)), blinkSeconds: pure.blinkSeconds(),
    rates: pure.RATES, playRate: pure.PLAY_RATE,
  };
  for (let L = 0; L <= 25; L++) {
    for (const n of [1, 2, 5, 11, 18, 25]) {
      statics.periodName.push([L, n, pure.periodName(L, n)]);
      statics.shortName.push([L, n, pure.shortName(L, n)]);
    }
  }

  // spans
  const spanInputs = [0, 1e-14, 4 / model.levelInfo(12).prefixNum / 7, 2.6 * 4 / model.levelInfo(12).prefixNum];
  for (const len of lengths) spanInputs.push(len, -len, len * 1.5, len * 3 - 1e-13, len * 7 + lengths.at(-1) * 0.5);
  for (let L = 0; L <= MAX_LEVEL; L++) spanInputs.push(4 / model.levelInfo(L).prefixNum);
  for (let i = 0; i < 160; i++) spanInputs.push((rand() < 0.2 ? -1 : 1) * 10 ** uniform(-13, 1.9));
  const spans = spanInputs.map((dpos) => {
    const parts = int(1, 4);
    const keepZeros = rand() < 0.3;
    return {
      dpos, parts, keepZeros,
      decompose: pure.decompose(dpos, parts, keepZeros).map((c) => [c.unit.sym, c.count]),
      text: pure.durationPos(dpos, { parts, keepZeros }),
      text2: pure.durationPos(dpos),
    };
  });
  const durations = [];
  for (let i = 0; i < 120; i++) {
    const seconds = (rand() < 0.3 ? -1 : 1) * 10 ** uniform(-3, 9.5);
    const at = pick(TIMES);
    const parts = int(1, 3);
    const keepZeros = rand() < 0.2;
    durations.push({
      seconds, at, parts, keepZeros,
      duration: pure.duration(seconds, { parts, at, keepZeros }),
      countdown: pure.countdown(seconds, { parts, at, keepZeros }),
    });
  }
  durations.push({ seconds: 3372.428, at: A, parts: 2, keepZeros: false, duration: pure.duration(3372.428, { at: A }), countdown: pure.countdown(3372.428, { at: A }) });
  const between = [];
  for (let i = 0; i < 60; i++) {
    const t1 = pick(TIMES);
    const t2 = rand() < 0.5 ? pick(TIMES) : t1 + (rand() < 0.5 ? -1 : 1) * 10 ** uniform(-2, 9);
    const parts = int(1, 3);
    between.push({ t1, t2, parts, text: pure.between(t1, t2, { parts }) });
  }
  const secondsPerPosition = [A, tMin, tMax, tMin - 5, tMax + 5, ...model.catalogue.slice(18, 24)].map((t) => [t, pure.secondsPerPosition(t)]);
  const pairs = [0, 1, -0.5, 1.5, 0.5, 255 / 256, 1 - 1e-12, 13 / 16, 0.0039, ...Array.from({ length: 30 }, () => rand())].map((f) => [f, pure.pair(f), pure.pairText(f)]);

  // counting and naming cycles
  const cycles = [];
  for (let L = 0; L <= MAX_LEVEL; L++) {
    const count = model.clock.count(L);
    for (const idx of [0n, count - 1n, bigRand(count), bigRand(count), bigRand(count)]) {
      cycles.push({
        level: L, idx: String(idx), counts: pure.countsAtStart(L, idx), ordinalOf: pure.ordinalOf(L, idx),
        name: pure.cycleName(L, idx), short: pure.cycleName(L, idx, { short: true }), cycleShort: pure.cycleShort(L, idx),
      });
    }
  }
  const cycleLength = [];
  for (let L = 0; L <= MAX_LEVEL; L++) for (const parts of [1, 2, 3]) cycleLength.push([L, parts, pure.cycleLength(L, { parts })]);

  // readings at an instant
  const UPTO = ['alpha', 'delta', 'epsilon', 'eta', 'iota', 'lambda', 'nu', 'bogus'];
  const moments = TIMES.filter((_, i) => i % 4 === 0).map((t) => ({
    t,
    clock: pure.clock(t),
    clockText: UPTO.map((u) => pure.clockText(t, u)),
    clockTextDefault: pure.clockText(t),
    date: pure.date(t),
    quarter: LEVELS.map((L) => pure.quarterAt(t, L)),
    majorText: [0, 1, 2, 3, 4].map((L) => pure.majorText(t, L)),
    dateText: ['short', 'full'].flatMap((form) => [false, true].flatMap((letters) => UPTO.map((upTo) => pure.dateText(t, { form, letters, upTo })))),
    dateTextDefault: pure.dateText(t),
    stamp: UPTO.map((u) => pure.stamp(t, u)),
    stampDefault: pure.stamp(t),
    nameAt: LEVELS.map((L) => [pure.nameAt(t, L), pure.nameAt(t, L, { short: true })]),
    addressAt: LEVELS.map((L) => pure.addressAt(t, L)),
  }));

  // drift, digits, speeds, real time
  const drift = [];
  for (const t of TIMES.filter((_, i) => i % 4 === 0)) {
    const s = model.solarAt(t);
    if (s) drift.push({ start: s.start, nominalStart: s.nominalStart, drift: s.drift, lambda: pure.driftLambda(s), text: pure.driftText(s) });
  }
  for (const n of [-2300, -100, 0, 1, 4820, 40000, 57000]) {
    const s = model.solarSyncByNumber(n);
    if (s) drift.push({ start: s.start, nominalStart: s.nominalStart, drift: s.drift, lambda: pure.driftLambda(s), text: pure.driftText(s) });
  }
  drift.push({ start: tMax + 100, nominalStart: tMax + 50, drift: 50, lambda: pure.driftLambda({ start: tMax + 100, nominalStart: tMax + 50, drift: 50 }), text: pure.driftText({ start: tMax + 100, nominalStart: tMax + 50, drift: 50 }) });
  const groupDigits = [0, -0, 5, 999, 1000, -1000, 6231, -48420, 1234567.89, -0.7, 999999, 1e15, 123456789012].map((n) => [n, pure.groupDigits(n)]);
  const rateInputs = [...pure.RATES.map((r) => r.rate), ...pure.RATES.map((r) => -r.rate), 0.5, 0.1, 2, 7.3, 1e-3, 31.6, 1e6, 3.16e7, 1e9, 1.003];
  for (let i = 0; i < 40; i++) rateInputs.push((rand() < 0.2 ? -1 : 1) * 10 ** uniform(-2, 9));
  const rateLabel = rateInputs.map((r) => [r, pure.rateLabel(r)]);
  const blinkInputs = [0, 1e-5, 0.0002, 0.3109, 0.311, 1, 2.5, 100, 311, 400, 1e5, -1, -0.31];
  for (let i = 0; i < 30; i++) blinkInputs.push(10 ** uniform(-4, 6));
  const blinks = blinkInputs.map((s) => [s, pure.blinks(s), pure.secondsToBlinks(s), pure.blinksToSeconds(s), pure.perBlink(s)]);
  const pbInputs = [0, -1, 0.01, 0.0399, 0.04, 0.0400000001, 0.2, 7, 34.2, 99.94, 99.95, 99.96, 999.4, 999.5, 2772, 1e6];
  for (let i = 0; i < 30; i++) pbInputs.push(10 ** uniform(-3, 5));
  const pbText = pbInputs.map((pb) => [pb, pure.pbText(pb)]);

  return { statics, spans, durations, between, secondsPerPosition, pairs, cycles, cycleLength, upTo: UPTO, moments, drift, groupDigits, rateLabel, blinks, pbText };
}

// ---- journal face -----------------------------------------------------------------------------------------------
function journalFixture() {
  const readings = [];
  for (const t of [...TIMES.filter((_, i) => i % 5 === 0), A, B, C]) {
    for (let u = -1; u <= MAX_UNIT + 1; u++) {
      const r = journalReading({ model, pure }, t, u);
      readings.push({
        t, u,
        r: r && { unit: r.unit, levels: r.levels, lead: r.lead, tokens: r.tokens, major: r.major },
      });
    }
  }
  const geometry = { cl: 58, cr: 134, cy: 392, R: 38 };
  const arcs = [-0.1, 0, 0.1, 0.25, 0.4999, 0.5, 0.5001, 0.75, 0.9, 1, 1.2, ...Array.from({ length: 20 }, () => rand())].map((f) => [f, arcPoint(f, geometry)]);
  return {
    units: JOURNAL_UNITS, maxUnit: MAX_UNIT,
    clampUnit: [-3, 0, 2.5, 3.49, 5, 6, 99, null].map((u) => [u, clampUnit(u === null ? NaN : u)]),
    ordinal: [0, 1, 2, 3, 4, 10, 11, 12, 13, 14, 21, 22, 23, 77, 100, 101, 111, 112, 113, 121, 1002].map((n) => [n, ordinal(n)]),
    readings, geometry, arcs,
  };
}

// ---- Earth formatting -------------------------------------------------------------------------------------------
function formatFixture() {
  const ZONES = ['UTC', 'Europe/Moscow', 'America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe'];
  const times = [A, B, C, 0, -1, -0.0005, 1.0005, 1700000000.5, 1700000000.4995, tMin, tMax, -2e9, 4e9,
    // DST transitions: New York 2026-03-08 07:00Z / 2026-11-01 06:00Z, Lord Howe 2026-04-05 / 2026-10-04 (half hour)
    1772953200 - 1, 1772953200, 1793512800 - 1, 1793512800, 1775314800, 1791043200,
    ...TIMES.filter((_, i) => i % 6 === 0)];
  const parts = [];
  for (const zone of ZONES) for (const t of times) parts.push({ zone, t, p: fmt.zonedParts(t, zone) });
  const toUnix = [];
  const fieldSets = [
    { year: 2026, month: 10, day: 8, hour: 12 }, { year: 2026, month: 3, day: 8, hour: 2, minute: 30 },
    { year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, { year: 2026, month: 10, day: 4, hour: 2, minute: 15 },
    { year: 2026, month: 4, day: 5, hour: 1, minute: 45 }, { year: 1613, month: 5, day: 19, hour: 23, minute: 59, second: 59, ms: 999 },
    { year: 2857, month: 6, day: 13 }, { year: 2000, month: 2, day: 29, hour: 23, minute: 59, second: 59 },
    { year: 2026, month: 13, day: 1 }, { year: 2026, month: 0, day: 31 }, { year: 1999, month: 12, day: 31, hour: 24 },
  ];
  for (let i = 0; i < 20; i++) {
    fieldSets.push({ year: int(1700, 2800), month: int(1, 12), day: int(1, 28), hour: int(0, 23), minute: int(0, 59), second: int(0, 59), ms: int(0, 999) });
  }
  for (const zone of ZONES) for (const f of fieldSets) toUnix.push({ zone, f, t: fmt.zonedToUnix(f, zone) });

  const formatters = [];
  const inputs = ['2026-10-08T12:00', '2026-10-08 12:00:30', '2026-10-08T12:00:30.5', '2026-10-08T12:00:30.123', '2026-10-08',
    ' 2026-03-08T02:30 ', '2026-02-30T12:00', '2026-13-01', '2026-10-08T24:00', '2026-10-08T12:60', 'nope', '26-10-08', '2028-02-29T00:00:00'];
  for (const zone of ZONES) {
    const f = fmt.createFormatter(() => zone);
    for (const t of times.slice(0, 22)) {
      const ref = t + pick([0, 3600, -86400, 30 * 86400, 400 * 86400]);
      const year = f.parts(t).year;
      formatters.push({
        zone, t, ref,
        date: f.date(t), time: f.time(t), timeShort: f.time(t, { seconds: false }), timeMs: f.time(t, { ms: true }),
        dateTime: f.dateTime(t), dateTimeMs: f.dateTime(t, { ms: true }), long: f.long(t), longShort: f.long(t, { seconds: false }),
        short: f.short(t), shortSameYear: f.short(t, year), shortOtherYear: f.short(t, year + 1),
        label: f.label(t, ref), labelSelf: f.label(t, t), tag: f.tag(t), iso: f.iso(t), inputValue: f.inputValue(t),
      });
    }
  }
  const parseInput = [];
  for (const zone of ZONES) {
    const f = fmt.createFormatter(() => zone);
    for (const s of inputs) parseInput.push({ zone, s, t: f.parseInput(s) });
  }
  const offsets = [0, 3600, -18000, 19800, 9017, -17762, 38180, 37800, -0.4, 5400.6, -1.5].map((o) => [o, fmt.offsetLabel(o)]);
  const civil = [[1970, 1, 1], [2000, 2, 29], [1613, 5, 19], [2857, 6, 13], [1600, 3, 1], [2400, 12, 31], [1582, 10, 15]].map(([y, m, d]) => [y, m, d, fmt.daysFromCivil(y, m, d)]);
  for (let i = 0; i < 20; i++) {
    const y = int(1100, 3000), m = int(1, 12), d = int(1, 28);
    civil.push([y, m, d, fmt.daysFromCivil(y, m, d)]);
  }
  const daysInMonth = [];
  for (const y of [1700, 1800, 1900, 2000, 2024, 2025, 2100, 2400]) for (let m = 1; m <= 12; m++) daysInMonth.push([y, m, fmt.daysInMonth(y, m)]);
  const durationInputs = [0, 0.0004, 0.0005, 0.31, 0.9995, 1, 7.25, 9.95, 9.96, 10, 59.9, 3599, 86399.9, 86400, 31557599, 31557600, 63115199, 63115200, 2.3e9];
  for (let i = 0; i < 60; i++) durationInputs.push(10 ** uniform(-3, 10));
  const durations = durationInputs.flatMap((s) => [s, -s]).map((s) => [s, fmt.duration(s), fmt.duration(s, { parts: 1 }), fmt.duration(s, { parts: 3 }), fmt.duration(s, { parts: 4 }), fmt.countdown(s)]);
  const relative = Array.from({ length: 10 }, () => {
    const t = pick(TIMES), ref = pick(TIMES);
    return [t, ref, fmt.relative(t, ref)];
  });
  return {
    zones: ZONES, monthsShort: fmt.MONTHS_SHORT, monthsLong: fmt.MONTHS_LONG, weekdaysShort: fmt.WEEKDAYS_SHORT,
    parts, toUnix, formatters, parseInput, offsets, civil, daysInMonth, durations, relative,
  };
}

// ---- write --------------------------------------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
const files = {
  clock: clockFixture(),
  samples: samplesFixture(),
  cycles: cyclesFixture(),
  glyphs: glyphsFixture(),
  pure: pureFixture(),
  journal: journalFixture(),
  format: formatFixture(),
};
for (const [name, data] of Object.entries(files)) {
  const json = JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
  writeFileSync(join(OUT, `${name}.json`), json + '\n');
  console.log(`${name}.json  ${(json.length / 1024).toFixed(0)} KB`);
}
console.log(`${TIMES.length} sample times`);
