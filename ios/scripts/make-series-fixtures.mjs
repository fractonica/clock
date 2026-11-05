#!/usr/bin/env node
/**
 * Golden fixtures for clocks on Saros series other than 141, from the web app's own model on each series' catalogue.
 *
 *   node ios/scripts/make-series-fixtures.mjs        (from the repository root, after make-saros.mjs)
 *
 * Reads the catalogue FractonicaKit carries (Sources/FractonicaKit/Saros/SarosData.swift), builds src/core/model.js on
 * a few series with their solar anchors (the first ordinal ≡ 0 mod 4 on or after 1972-01-01, as
 * `SarosSeries.solarAnchor`), and writes Tests/FractonicaKitTests/Fixtures/series.json: per series the catalogue, the
 * level table's counts and, at sample times, the position, every level reading, the solar sync and the Pentad.
 * SeriesFixtureTests replays them against `FractonicaClock.on(series:)`.
 *
 * The series: 117 (ends in 2054), 128 (the fastest drift), 145 and 152 (the slowest).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../fractonica.js';
import { createModel } from '../../src/core/model.js';

const here = dirname(fileURLToPath(import.meta.url));
const KIT = join(here, '../FractonicaKit');
const SERIES = [117, 128, 145, 152];

// ---- the catalogue as the kit has it ------------------------------------------------------------------------------
const source = readFileSync(join(KIT, 'Sources/FractonicaKit/Saros/SarosData.swift'), 'utf8');
const blob = Buffer.from([...source.matchAll(/^\s*"([A-Za-z0-9+/=]+)",?$/gm)].map((m) => m[1]).join(''), 'base64');
const catalogue = new Map();
for (let at = 0; at + 4 <= blob.length;) {
  const n = blob.readUInt16LE(at), count = blob.readUInt16LE(at + 2);
  at += 4;
  const ms = [];
  for (let k = 0; k < count; k++, at += 18) ms.push(blob.readBigInt64LE(at));
  catalogue.set(n, ms);
}
const decimal = (ms) => {
  const neg = ms < 0n, a = neg ? -ms : ms;
  return `${neg ? '-' : ''}${a / 1000n}.${String(a % 1000n).padStart(3, '0')}`;
};
const anchorOf = (ms) => {
  for (let k = 0; k < ms.length; k += 4) if (ms[k] >= 63072000000n) return k;
  return Math.floor((ms.length - 1) / 4) * 4;
};

// ---- deterministic randomness -------------------------------------------------------------------------------------
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

const time4 = (x) => (x === null ? null : Math.round(x * 1e4) / 1e4);
const fraction13 = (x) => Number(x.toPrecision(13));
const level = (l) => l && [l.cycle, l.local, fraction13(l.phase), l.quarter, l.index, time4(l.start), time4(l.end),
  l.clipped, l.next.name, time4(l.next.time)];

const out = { levelFields: 'cycle local phase quarter index start end clipped nextName nextTime', series: [] };
for (const n of SERIES) {
  const ms = catalogue.get(n);
  const anchor = anchorOf(ms);
  const model = createModel({ series: n, timestamps: ms.map(decimal), anchor });
  const { tMin, tMax } = model;
  const rand = mulberry32(0x5a7051 + n);
  const times = [tMin, tMin + 0.001, tMax, tMax - 0.001, tMax + 1, tMin - 1];
  model.catalogue.forEach((e, k) => { if (k % 3 === 0) times.push(e, e + 0.0005); });
  const now = 1793836800; // 2026-11-05
  for (let i = 0; i < 40; i++) times.push(now + (rand() < 0.5 ? -1 : 1) * 10 ** (rand() * 9.5));
  for (let i = 0; i < 40; i++) times.push(tMin + (tMax - tMin) * rand());
  const anchorTime = model.catalogue[anchor];
  times.push(anchorTime, anchorTime - 1, anchorTime + 4 * 86400 - 20);
  out.series.push({
    series: n,
    anchor,
    catalogue: model.catalogue,
    extent: model.extent,
    meanSaros: model.meanSaros,
    counts: Array.from({ length: 14 }, (_, L) => String(model.clock.count(L))),
    samples: times.map((t) => ({
      t,
      pos: model.positionOf(t),
      levels: Array.from({ length: 14 }, (_, L) => level(model.levelAt(t, L))),
      solar: model.solarAt(t) && (({ sync, start, end, nominalStart, phase, drift, quarter, digits3, beforeAnchor }) =>
        ({ sync, start, end, nominalStart, phase, drift, quarter, digits3, beforeAnchor }))(model.solarAt(t)),
      pentad: model.pentadAt(t),
    })),
  });
}
const file = join(KIT, 'Tests/FractonicaKitTests/Fixtures/series.json');
writeFileSync(file, JSON.stringify(out));
console.log(`series.json: ${SERIES.join(', ')} — ${out.series.reduce((a, s) => a + s.samples.length, 0)} samples`);
