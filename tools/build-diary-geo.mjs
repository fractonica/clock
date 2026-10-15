// Builds the vendored map data of the diary's eclipse maps (src/diary/geo/data/) from the gnomonicube project:
//   - the Saros eclipse-path files <saros>.bin, copied unchanged;
//   - world.json: Natural Earth land, lakes and country borders (1:50m), simplified for print (Douglas–Peucker on the
//     sphere), small islands and lakes dropped, coordinates quantised to 0.01° and delta-encoded.
//
//   node tools/build-diary-geo.mjs [/path/to/gnomonicube]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(process.argv[2] ?? path.join(root, '..', 'pentalunex', 'gnomonicube'));
const out = path.join(root, 'src', 'diary', 'geo', 'data');
const DETAIL = 'medium'; // Natural Earth 1:50m
/** Douglas–Peucker tolerance (degrees of arc): ~0.1 mm on the most zoomed-in map. */
const TOL = 0.12;
/** Rings smaller than this (square degrees, cos-latitude weighted) are dropped. */
const MIN_LAND = 0.25;
const MIN_LAKE = 1.2;
const Q = 100; // 0.01°

fs.mkdirSync(out, { recursive: true });

// ---- eclipse paths ---------------------------------------------------------------------------------------------
const binDir = path.join(src, 'src', 'saros-geo', 'data');
let binBytes = 0;
for (const f of fs.readdirSync(binDir).filter((f) => /^\d+\.bin$/.test(f))) {
  fs.copyFileSync(path.join(binDir, f), path.join(out, f));
  binBytes += fs.statSync(path.join(out, f)).size;
}

// ---- Natural Earth ---------------------------------------------------------------------------------------------
const RAD = Math.PI / 180;
const read = (layer) => JSON.parse(fs.readFileSync(path.join(src, 'map', DETAIL, `${layer}.json`), 'utf8'));
const vec = ([lon, lat]) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Angular distance (radians) of p from the great-circle arc a–b. */
function arcDistance(p, a, b) {
  const n = cross(a, b);
  const nl = Math.hypot(...n);
  if (nl < 1e-12) return Math.acos(Math.min(1, dot(p, a)));
  const s = Math.abs(dot(p, n)) / nl;
  // inside the arc's span? (p projected on the plane lies between a and b)
  const inside = dot(cross(a, p), n) >= 0 && dot(cross(p, b), n) >= 0;
  return inside ? Math.asin(Math.min(1, s)) : Math.acos(Math.min(1, Math.max(dot(p, a), dot(p, b))));
}

/** Douglas–Peucker on the sphere; keeps the first and last points. */
function simplify(line, tol = TOL * RAD) {
  if (line.length <= 2) return line;
  const v = line.map(vec);
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1;
    let bi = -1;
    for (let k = i + 1; k < j; k++) {
      const d = arcDistance(v[k], v[i], v[j]);
      if (d > best) {
        best = d;
        bi = k;
      }
    }
    if (bi > 0 && best > tol) {
      keep[bi] = 1;
      stack.push([i, bi], [bi, j]);
    }
  }
  return line.filter((_, k) => keep[k]);
}

/** A closed ring simplified: split at its two mutually farthest-ish points so DP keeps its shape. */
function simplifyRing(ring) {
  const r = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring.slice();
  if (r.length < 4) return r;
  const v0 = vec(r[0]);
  let far = 1;
  let fd = 2;
  r.forEach((p, i) => {
    const d = dot(vec(p), v0);
    if (d < fd) {
      fd = d;
      far = i;
    }
  });
  const a = simplify(r.slice(0, far + 1));
  const b = simplify([...r.slice(far), r[0]]);
  return [...a, ...b.slice(1, -1)];
}

/** Area in cos-latitude weighted square degrees. */
function area(ring) {
  let s = 0;
  let lat = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
    lat += y1;
  }
  return (Math.abs(s) / 2) * Math.cos((lat / ring.length) * RAD);
}

const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

function rings(layer, minArea) {
  const outRings = [];
  for (const f of read(layer).features) {
    for (const poly of polygonsOf(f.geometry)) {
      poly.forEach((ring, k) => {
        // holes are kept when their outer ring is (the evenodd fill takes care of them)
        if (area(ring) < minArea && !(k > 0 && area(ring) >= minArea / 4)) return;
        const s = simplifyRing(ring);
        if (s.length >= 3) outRings.push(s);
      });
    }
  }
  return outRings;
}

/** Country borders: the edges two countries share, chained into lines and simplified. */
function borders() {
  const key = (p) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;
  const edges = new Map();
  for (const f of read('countries').features) {
    for (const poly of polygonsOf(f.geometry)) {
      for (const ring of poly) {
        for (let i = 0; i + 1 < ring.length; i++) {
          const a = key(ring[i]);
          const b = key(ring[i + 1]);
          if (a === b) continue;
          const k = a < b ? `${a}|${b}` : `${b}|${a}`;
          const e = edges.get(k);
          if (e) e.n++;
          else edges.set(k, { a: ring[i], b: ring[i + 1], ka: a, kb: b, n: 1 });
        }
      }
    }
  }
  const shared = [...edges.values()].filter((e) => e.n >= 2 && !(Math.abs(e.a[0]) >= 179.999 && Math.abs(e.b[0]) >= 179.999));
  const adj = new Map();
  const link = (k, e) => (adj.get(k) ?? adj.set(k, []).get(k)).push(e);
  for (const e of shared) {
    link(e.ka, e);
    link(e.kb, e);
  }
  const used = new Set();
  const lines = [];
  const walk = (start, e0) => {
    const line = [];
    let k = start;
    let e = e0;
    line.push(k === e.ka ? e.a : e.b);
    while (e && !used.has(e)) {
      used.add(e);
      const nk = k === e.ka ? e.kb : e.ka;
      line.push(k === e.ka ? e.b : e.a);
      k = nk;
      const next = adj.get(k);
      e = next.length === 2 ? next.find((x) => !used.has(x)) : undefined;
    }
    return line;
  };
  // from the nodes where borders meet or end, then the closed loops (islands shared by two countries)
  for (const [k, list] of adj) if (list.length !== 2) for (const e of list) if (!used.has(e)) lines.push(walk(k, e));
  for (const e of shared) if (!used.has(e)) lines.push(walk(e.ka, e));
  return lines.map((l) => simplify(l)).filter((l) => l.length >= 2);
}

/** Flat delta-encoded integers: [x0, y0, dx1, dy1, …] in 1/Q degree. */
function encode(line) {
  const outLine = [];
  let px = 0;
  let py = 0;
  line.forEach(([lon, lat], i) => {
    const x = Math.round(lon * Q);
    const y = Math.round(lat * Q);
    if (i && x === px && y === py) return;
    outLine.push(i ? x - px : x, i ? y - py : y);
    px = x;
    py = y;
  });
  return outLine;
}

const land = rings('land', MIN_LAND);
const lakes = rings('lakes', MIN_LAKE);
const bord = borders();
const count = (ls) => ls.reduce((s, l) => s + l.length, 0);
const world = {
  source: `Natural Earth 1:50m physical land, lakes and admin-0 countries (public domain), simplified (${TOL}° Douglas–Peucker, rings under ${MIN_LAND} sq. deg dropped), 1/${Q}° delta-encoded`,
  q: Q,
  land: land.map(encode),
  lakes: lakes.map(encode),
  borders: bord.map(encode),
};
const json = JSON.stringify(world);
fs.writeFileSync(path.join(out, 'world.json'), json);
console.log(`saros-geo: ${(binBytes / 1024).toFixed(0)} KB`);
console.log(`world.json: ${(json.length / 1024).toFixed(0)} KB — land ${land.length} rings / ${count(land)} pts, lakes ${lakes.length} / ${count(lakes)}, borders ${bord.length} lines / ${count(bord)} pts`);
