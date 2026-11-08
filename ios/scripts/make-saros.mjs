#!/usr/bin/env node
/**
 * The Saros catalogue's data: every solar Saros series of NASA's catalogue (1 … 180), the 40 running now (117 … 156)
 * among them, their eclipses' times for the clock and the Saros search, and the paths and the map they are drawn on.
 *
 *   node ios/scripts/make-saros.mjs <saros-eclipse>/data/solar <saros-geo folder> <natural-earth map folder>
 *
 * e.g. (from the repository root)
 *
 *   node ios/scripts/make-saros.mjs ~/saros-eclipse/package/data/solar \
 *       ~/projects/pentalunex/gnomonicube/src/saros-geo ~/projects/pentalunex/gnomonicube/map
 *
 * Inputs
 *   saros-eclipse 0.1.0 (npm, `npm pack saros-eclipse@0.1.0`): every solar eclipse of NASA's catalogue (Espenak and
 *     Meeus) — eclipse_times.db (int64 LE TT seconds; before 1582-10-15 Julian calendar fields stored as Gregorian),
 *     eclipse_info.db (10 bytes: int16 lat×10, int16 lon×10, uint16 central duration or 65535, u8 saros, u8 position,
 *     u8 type, u8 sun altitude) and saros.db (194 bytes a series: u8 count, uint16 LE global indices from offset 2).
 *   saros-geo (gnomonicube): data/<n>.bin, each series' eclipses from 1582 to 2500 with their paths (MultiPolygons of
 *     the central path, or a partial eclipse's limits), read with its own codec saros_geo.js.
 *   Natural Earth (gnomonicube's map folder): low/land.json (1:110m) and medium/{land,lakes,countries}.json (1:50m).
 *
 * Outputs
 *   ios/FractonicaKit/Sources/FractonicaKit/Saros/SarosData.swift
 *     Every series' eclipses (1 … 180, in order) as one base64 blob (`SarosData.blob`): u16 series, u16 count, then per eclipse 18 bytes —
 *     i64 Unix milliseconds, i16 lat×10, i16 lon×10, u16 central duration (s; 65535 none), u8 type (saros-eclipse's
 *     SolarEclipseType), u8 sun altitude, u8 the eclipse's record in geo-<n>.bin (255 none), u8 0. The Unix times are
 *     the reference library's own conversion, F.toUnix(F.correctJulianTimestamp(TT)) rounded to the millisecond, so
 *     Saros 141 reproduces F.defaults.unixTimestamps exactly (checked here).
 *   ios/Fractonica/Resources/Saros/geo-<n>.bin    saros-geo's files, as they are (the series it has: 101 … 173)
 *   ios/Fractonica/Resources/Saros/{land-110m,land,lakes,borders}.bin
 *     "FXMP", u32 ring count, then per ring u32 point count and i16 pairs (lon × 32767/180, lat × 32767/90). Land and
 *     lake rings run counterclockwise seen from outside the globe around the smaller of the two regions they bound
 *     (the map clips them as such); borders are the countries' outlines, drawn as lines.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [solarDir, geoDir, mapDir] = process.argv.slice(2).map((p) => resolve(p));
if (!solarDir || !geoDir || !mapDir) {
  console.error('usage: node ios/scripts/make-saros.mjs <saros-eclipse/data/solar> <saros-geo> <natural-earth map>');
  process.exit(2);
}
await import(pathToFileURL(join(here, '../../fractonica.js')).href);
const F = globalThis.Fractonica;
const { decodeSeries } = await import(pathToFileURL(join(geoDir, 'saros_geo.js')).href);

const FIRST = 1, LAST = 180;
const KIT = join(here, '../FractonicaKit/Sources/FractonicaKit/Saros');
const RES = join(here, '../Fractonica/Resources/Saros');
mkdirSync(KIT, { recursive: true });
mkdirSync(RES, { recursive: true });

// ---- the eclipses ----------------------------------------------------------------------------------------------
const times = readFileSync(join(solarDir, 'eclipse_times.db'));
const info = readFileSync(join(solarDir, 'eclipse_info.db'));
const saros = readFileSync(join(solarDir, 'saros.db'));
const ttOf = (i) => times.readBigInt64LE(i * 8);
const members = (n) => {
  const off = (n - 1) * 194, count = saros[off];
  return Array.from({ length: count }, (_, p) => saros.readUInt16LE(off + 2 + p * 2));
};

/** n / d rounded half up (floor((2n + d) / 2d)), either sign. */
function roundHalfUp(n, d) {
  const q = 2n * n + d, den = 2n * d;
  let r = q / den;
  if ((q % den !== 0n) && (q < 0n)) r -= 1n;
  return r;
}
/** Unix milliseconds of a TT second as the library converts it. */
function unixMsExact(tt) {
  const u = F.rational(F.toUnix(F.correctJulianTimestamp(tt)));
  return roundHalfUp(u.numerator * 1000n, u.denominator);
}

const chunks = [];
let records = 0, matched = 0, series = 0, geoFiles = 0;
const summary = [];
for (let n = FIRST; n <= LAST; n++) {
  const idx = members(n);
  if (idx.length === 0) continue;
  series++;
  // saros-geo has the series with eclipses between 1582 and 2500 (101 … 173)
  const geoFile = join(geoDir, `data/${n}.bin`);
  const hasGeo = existsSync(geoFile);
  const geo = hasGeo ? decodeSeries(readFileSync(geoFile)) : [];
  // saros-geo's times are NASA's TT (to the second), labelled UTC
  const geoAt = new Map(geo.map((r, i) => [Date.parse(r.datetime_utc.replace(' ', 'T') + 'Z') / 1000, i]));
  const head = Buffer.alloc(4);
  head.writeUInt16LE(n, 0);
  head.writeUInt16LE(idx.length, 2);
  chunks.push(head);
  let previous = null, found = 0;
  idx.forEach((g, p) => {
    const tt = ttOf(g);
    const fixedTT = F.number(F.rational(F.correctJulianTimestamp(tt)));
    const ms = unixMsExact(tt);
    if (previous !== null && ms <= previous) throw new Error(`series ${n}: eclipse ${p} is not after the one before`);
    previous = ms;
    const o = g * 10;
    if (info[o + 6] !== n || info[o + 7] !== p) throw new Error(`series ${n}: record ${g} is ${info[o + 6]}[${info[o + 7]}]`);
    let geoIndex = geoAt.get(fixedTT);
    if (geoIndex === undefined) geoIndex = geoAt.get(fixedTT + 1) ?? geoAt.get(fixedTT - 1);
    if (geoIndex !== undefined) found++;
    const r = Buffer.alloc(18);
    r.writeBigInt64LE(ms, 0);
    r.writeInt16LE(info.readInt16LE(o), 8);
    r.writeInt16LE(info.readInt16LE(o + 2), 10);
    r.writeUInt16LE(info.readUInt16LE(o + 4), 12);
    r[14] = info[o + 8];
    r[15] = info[o + 9];
    r[16] = geoIndex ?? 255;
    chunks.push(r);
    records++;
  });
  // every path belongs to one of the series' eclipses
  if (found !== geo.length) throw new Error(`series ${n}: ${found} of ${geo.length} paths matched an eclipse`);
  matched += found;
  summary.push(`${n}: ${idx.length} eclipses, ${geo.length} paths`);
  if (hasGeo) {
    copyFileSync(geoFile, join(RES, `geo-${n}.bin`));
    geoFiles++;
  }
}
const blob = Buffer.concat(chunks);

// Saros 141 must be the library's own table
const t141 = F.defaults.unixTimestamps.map((v) => {
  const r = F.rational(v);
  return roundHalfUp(r.numerator * 1000n, r.denominator);
});
const ours141 = members(141).map((g) => unixMsExact(ttOf(g)));
if (t141.length !== ours141.length || t141.some((v, i) => v !== ours141[i])) {
  throw new Error('Saros 141 differs from F.defaults.unixTimestamps');
}

const base64 = blob.toString('base64');
const lines = base64.match(/.{1,116}/g).map((l) => `        "${l}"`).join(',\n');
writeFileSync(join(KIT, 'SarosData.swift'), `// Generated by ios/scripts/make-saros.mjs from saros-eclipse 0.1.0 (NASA's catalogue, Espenak and Meeus). Do not edit.

/// Every eclipse of the solar Saros series ${FIRST} … ${LAST} (${series} series, ${records} eclipses), in order of series, as
/// \`SarosCatalogue\` reads them: per series u16 number, u16 count, then per eclipse 18 bytes — i64 Unix milliseconds
/// (the library's conversion from TT), i16 latitude × 10, i16 longitude × 10, u16 central duration in seconds (65535:
/// none), u8 type, u8 the Sun's altitude, u8 the record of the eclipse's path in the app's geo-<n>.bin (255: none),
/// u8 0. All little-endian.
enum SarosData {
    static let blob: [String] = [
${lines},
    ]
}
`);
console.log(`SarosData.swift: ${series} series, ${records} eclipses, ${matched} with paths (${geoFiles} geo files), ${blob.length} bytes`);

// ---- the map ---------------------------------------------------------------------------------------------------
const rad = Math.PI / 180;
const vec = ([lon, lat]) => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)];
/** Whether a ring runs counterclockwise (seen from outside) around the smaller region it bounds. */
function counterclockwise(ring) {
  const v = ring.map(vec);
  const mean = [0, 0, 0];
  for (const p of v) { mean[0] += p[0]; mean[1] += p[1]; mean[2] += p[2]; }
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    s += c[0] * mean[0] + c[1] * mean[1] + c[2] * mean[2];
  }
  return s > 0;
}
function rings(file, kind) {
  const json = JSON.parse(readFileSync(join(mapDir, file)));
  const out = [];
  const add = (ring, closed) => {
    let r = ring.map(([lon, lat]) => [Math.max(-180, Math.min(180, lon)), Math.max(-90, Math.min(90, lat))]);
    if (closed && r.length > 1 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]) r = r.slice(0, -1);
    if (r.length < (closed ? 3 : 2)) return;
    if (kind === 'area' && !counterclockwise(r)) r.reverse();
    out.push(r);
  };
  for (const feature of json.features) {
    const g = feature.geometry;
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const polygon of polygons) for (const ring of polygon) add(ring, true);
  }
  return out;
}
function writeMap(name, list) {
  const n = list.reduce((a, r) => a + r.length, 0);
  const buf = Buffer.alloc(8 + list.length * 4 + n * 4);
  buf.write('FXMP', 0, 'ascii');
  buf.writeUInt32LE(list.length, 4);
  let o = 8;
  for (const r of list) {
    buf.writeUInt32LE(r.length, o); o += 4;
    for (const [lon, lat] of r) {
      buf.writeInt16LE(Math.round(lon / 180 * 32767), o);
      buf.writeInt16LE(Math.round(lat / 90 * 32767), o + 2);
      o += 4;
    }
  }
  writeFileSync(join(RES, `${name}.bin`), buf);
  console.log(`${name}.bin: ${list.length} rings, ${n} points, ${buf.length} bytes`);
}
writeMap('land-110m', rings('low/land.json', 'area'));
writeMap('land', rings('medium/land.json', 'area'));
writeMap('lakes', rings('medium/lakes.json', 'area'));
writeMap('borders', rings('medium/countries.json', 'line'));
console.log(summary.join('\n'));
