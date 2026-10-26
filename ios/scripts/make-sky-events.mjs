#!/usr/bin/env node
/**
 * The journal's sky events, precomputed from the printable diary's astronomy (src/diary/astro/index.js `events()`,
 * default flags: every family, quarters, cross-quarters, eclipses and planets).
 *
 *   node ios/scripts/make-sky-events.mjs        (from the repository root; about ten seconds)
 *
 * Writes
 *   ios/Fractonica/Resources/Sky/sky-events.bin                the table, bundled with the app (format below)
 *   ios/Fractonica/Features/Journal/Sky/SkyEventKinds.swift    EVENT_INFO and FAMILIES as Swift (generated: never edit)
 *   ios/Fractonica/Features/Journal/Sky/Checks/sky-fixture.json   fresh events() output over sample windows, which the
 *                                                              Sky checks compare the table against
 *
 * The range is 1900-01-01 … 2200-01-01 UTC (every event in [T0, T1)): about 81 000 events, 0.6 MB, a few seconds to make.
 *
 * sky-events.bin, little-endian, columns after a header:
 *
 *   offset  size        field
 *   0       8           magic "FXSKY\x01\0\0" (the last digit before the zeros is the format version)
 *   8       8           Int64  T0, the range's start (Unix seconds, UTC): events before it are not in the table
 *   16      8           Int64  T1, the range's end (exclusive)
 *   24      8           Int64  base, the first event's time (whole Unix seconds)
 *   32      4           UInt32 N, the number of events
 *   36      4           UInt32 K, the number of kinds (EVENT_INFO's names, in its order: kind k is its k-th name)
 *   40      4           UInt32 L, the number of specific labels
 *   44      …           L labels, each UInt8 byte length + UTF-8 ("Total solar eclipse", "Moon farthest north 28.4°")
 *   …       4·N         UInt32 time steps: event i is at base + Σ steps[0…i] (steps[0] = 0), whole seconds (rounded)
 *   …       N           UInt8  kind of each event
 *   …       2·N         UInt16 label of each event: an index into the labels, or 0xFFFF for the kind's own label
 *
 * Events are in events()' order (time, then family). A specific label is both `label` and `labelPure` (events() gives
 * them the same text); without one the kind's EVENT_INFO label and labelPure apply.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../fractonica.js';
import { events, EVENT_INFO, FAMILIES } from '../../src/diary/astro/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '../Fractonica/Resources/Sky/sky-events.bin');
const SWIFT = join(here, '../Fractonica/Features/Journal/Sky/SkyEventKinds.swift');
const FIXTURE = join(here, '../Fractonica/Features/Journal/Sky/Checks/sky-fixture.json');

const T0 = Date.UTC(1900, 0, 1) / 1000;
const T1 = Date.UTC(2200, 0, 1) / 1000;
const NAMES = Object.keys(EVENT_INFO);
const KIND = new Map(NAMES.map((n, i) => [n, i]));

// ---- the table ----------------------------------------------------------------------------------------------------
const started = performance.now();
const all = [];
for (let y = 1900; y < 2200; y++) {
  const a = Math.max(T0, Date.UTC(y, 0, 1) / 1000);
  const b = Math.min(T1, Date.UTC(y + 1, 0, 1) / 1000);
  for (const e of events(a, b)) all.push(e);
}
const seconds = ((performance.now() - started) / 1000).toFixed(1);

const labels = [];
const labelIndex = new Map();
const rows = all.map((e) => {
  const info = EVENT_INFO[e.name];
  let label = 0xffff;
  if (e.label !== info.label || e.labelPure !== info.labelPure) {
    if (e.label !== e.labelPure) throw new Error(`${e.name}: a specific label differs in pure mode (${e.label} / ${e.labelPure})`);
    if (!labelIndex.has(e.label)) {
      labelIndex.set(e.label, labels.length);
      labels.push(e.label);
    }
    label = labelIndex.get(e.label);
  }
  return { t: Math.round(e.t), kind: KIND.get(e.name), label };
});
for (let i = 1; i < rows.length; i++) {
  if (rows[i].t < rows[i - 1].t) throw new Error(`events out of order at ${i}`);
  if (rows[i].t - rows[i - 1].t > 0xffffffff) throw new Error(`a gap too long at ${i}`);
}
if (labels.length >= 0xffff) throw new Error('too many labels');

const encoded = labels.map((l) => Buffer.from(l, 'utf8'));
const N = rows.length;
const size = 44 + encoded.reduce((s, b) => s + 1 + b.length, 0) + 4 * N + N + 2 * N;
const buf = Buffer.alloc(size);
let o = 0;
buf.write('FXSKY\x01\0\0', o, 'latin1');
o += 8;
buf.writeBigInt64LE(BigInt(T0), o);
o += 8;
buf.writeBigInt64LE(BigInt(T1), o);
o += 8;
buf.writeBigInt64LE(BigInt(N ? rows[0].t : 0), o);
o += 8;
buf.writeUInt32LE(N, o);
o += 4;
buf.writeUInt32LE(NAMES.length, o);
o += 4;
buf.writeUInt32LE(labels.length, o);
o += 4;
for (const b of encoded) {
  if (b.length > 255) throw new Error('a label longer than 255 bytes');
  buf.writeUInt8(b.length, o++);
  b.copy(buf, o);
  o += b.length;
}
for (let i = 0; i < N; i++, o += 4) buf.writeUInt32LE(i ? rows[i].t - rows[i - 1].t : 0, o);
for (let i = 0; i < N; i++) buf.writeUInt8(rows[i].kind, o++);
for (let i = 0; i < N; i++, o += 2) buf.writeUInt16LE(rows[i].label, o);
if (o !== size) throw new Error(`wrote ${o} of ${size} bytes`);
mkdirSync(dirname(BIN), { recursive: true });
writeFileSync(BIN, buf);

// ---- the kinds as Swift ---------------------------------------------------------------------------------------------
const q = (s) => JSON.stringify(s);
const swift = `// Generated by ios/scripts/make-sky-events.mjs from src/diary/astro/index.js (EVENT_INFO, FAMILIES). Do not edit:
// change the JavaScript and run the script again.

/// The families of sky events, in the diary's sort order (events at the same instant).
enum SkyFamily: String, CaseIterable, Sendable, Hashable, Codable {
${FAMILIES.map((f) => `    case ${f}`).join('\n')}
}

/// What a kind of sky event is: its name (the tag's \`sky:<name>\`), family, label, pure-mode label and symbol.
struct SkyKindInfo: Hashable, Sendable {
    let name: String
    let family: SkyFamily
    let label: String
    let labelPure: String
    /// A plain (non-emoji) Unicode mark.
    let symbol: String
}

enum SkyKinds {
    /// Every kind, in EVENT_INFO's order: the table's kind k is \`all[k]\`.
    static let all: [SkyKindInfo] = [
${NAMES.map((n) => {
  const i = EVENT_INFO[n];
  return `        SkyKindInfo(name: ${q(n)}, family: .${i.family}, label: ${q(i.label)}, labelPure: ${q(i.labelPure)}, symbol: ${q(i.symbol)}),`;
}).join('\n')}
    ]
}
`;
mkdirSync(dirname(SWIFT), { recursive: true });
writeFileSync(SWIFT, swift);

// ---- the fixture: fresh events() over sample windows ----------------------------------------------------------------
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
const rand = mulberry32(0x5c1e5);
const DAY = 86400;
const windows = [
  [T0, T0 + 20 * DAY],
  [T1 - 20 * DAY, T1],
  [1791460800 - 15 * DAY, 1791460800 + 15 * DAY],
];
for (let i = 0; i < 40; i++) {
  const a = Math.floor(T0 + rand() * (T1 - T0 - 40 * DAY));
  windows.push([a, a + Math.floor((2 + rand() * 38) * DAY)]);
}
const fixture = {
  generated: 'node ios/scripts/make-sky-events.mjs',
  range: [T0, T1],
  windows: windows.map(([a, b]) => ({
    from: a,
    to: b,
    events: events(a, b).map((e) => [e.t, e.name, e.label, e.labelPure, e.symbol, e.family]),
  })),
};
mkdirSync(dirname(FIXTURE), { recursive: true });
writeFileSync(FIXTURE, JSON.stringify(fixture) + '\n');

console.log(`${N} events ${new Date(T0 * 1000).toISOString().slice(0, 10)} … ${new Date(T1 * 1000).toISOString().slice(0, 10)} in ${seconds} s; ` +
  `${labels.length} labels; ${(size / 1024).toFixed(0)} KB → ${BIN.replace(/.*\/ios\//, 'ios/')}`);
