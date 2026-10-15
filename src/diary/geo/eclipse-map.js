/**
 * A solar eclipse's path on a map for the printed diary: a cubic gnomonic projection centred on the path.
 *
 * The globe is turned (an anchor longitude / latitude / roll, as gnomonicube orients its cube) so that the point of
 * greatest eclipse is the centre of the cube's front face and the path runs left to right across it; the map shows the
 * cube's net around that face — the faces to the left and right (a strip of three) and, when the box is tall enough,
 * parts of the faces above and below. The gnomonic projection keeps great circles straight, so every edge of the data
 * (great-circle arcs between close points) is clipped exactly against the faces in 3-D and drawn as a straight segment.
 *
 * eclipseMapSvg({record, world, box, pal}) returns markup (no outer <svg>) for the diary's Svg.add(): millimetres, the
 * print palette, everything clipped to the faces and the box with plain geometry (no clip paths), a few labels that
 * never overlap. Pure: no strings of Earth time anywhere (only degrees and a magnitude).
 */
import { n2, esc, measure, fit } from '../render/common.js';
import { CONTOUR_TYPES } from './saros-geo.js';

const RAD = Math.PI / 180;

// ---- vectors ---------------------------------------------------------------------------------------------------

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const neg = (a) => [-a[0], -a[1], -a[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : a;
};
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Unit vector of (lon, lat) in degrees: x to (0°, 0°), y to (90°E, 0°), z to the north pole. */
export function vecOf(lon, lat) {
  const c = Math.cos(lat * RAD);
  return [c * Math.cos(lon * RAD), c * Math.sin(lon * RAD), Math.sin(lat * RAD)];
}
const vecs = (line) => line.map(([lon, lat]) => vecOf(lon, lat));

// ---- the eclipse's geometry ------------------------------------------------------------------------------------------

const SEAM = 179.999;
const onSeam = (p) => Math.abs(p[0]) >= SEAM;
const samePoint = (a, b) => (onSeam(a) && onSeam(b) ? Math.abs(a[1] - b[1]) < 1e-4 : Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6);

/**
 * Join the pieces the data splits at the antimeridian: cut every piece at its edges along the ±180° meridian (artefacts
 * of the split) and join the runs whose ends meet across it. Returns {rings (closed, last point not repeated), lines}.
 */
export function stitch(pieces) {
  const runs = [];
  for (const piece of pieces) {
    if (!piece || piece.length < 2) continue;
    let pts = piece.slice();
    const closed = pts.length >= 4 && samePoint(pts[0], pts.at(-1)) && !(onSeam(pts[0]) && onSeam(pts.at(-1)) && pts[0][0] !== pts.at(-1)[0]);
    if (closed) pts.pop();
    const n = pts.length;
    const seamEdge = (i) => onSeam(pts[i]) && onSeam(pts[(i + 1) % n]);
    if (closed) {
      const cuts = [];
      for (let i = 0; i < n; i++) if (seamEdge(i)) cuts.push(i);
      if (!cuts.length) {
        runs.push({ pts, closed: true });
        continue;
      }
      // start after a seam edge and walk round
      const start = (cuts[0] + 1) % n;
      let cur = [];
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        cur.push(pts[i]);
        if (seamEdge(i)) {
          runs.push({ pts: cur, closed: false });
          cur = [];
        }
      }
      if (cur.length) runs.push({ pts: cur, closed: false });
    } else {
      let cur = [pts[0]];
      for (let i = 0; i + 1 < n; i++) {
        if (seamEdge(i)) {
          runs.push({ pts: cur, closed: false });
          cur = [];
        }
        cur.push(pts[i + 1]);
      }
      runs.push({ pts: cur, closed: false });
    }
  }
  let open = runs.filter((r) => !r.closed && r.pts.length >= 2).map((r) => r.pts);
  const rings = runs.filter((r) => r.closed && r.pts.length >= 3).map((r) => r.pts);
  // join across the seam (either direction)
  let joined = true;
  while (joined) {
    joined = false;
    outer: for (let i = 0; i < open.length; i++) {
      for (let j = 0; j < open.length; j++) {
        if (i === j) continue;
        const a = open[i];
        let b = open[j];
        const ends = [
          [a.at(-1), b[0], () => a.concat(b)],
          [a.at(-1), b.at(-1), () => a.concat(b.slice().reverse())],
          [a[0], b.at(-1), () => b.concat(a)],
          [a[0], b[0], () => b.slice().reverse().concat(a)],
        ];
        for (const [p, q, f] of ends) {
          if (onSeam(p) && onSeam(q) && samePoint(p, q)) {
            const m = f();
            open = open.filter((_, k) => k !== i && k !== j);
            open.push(m);
            joined = true;
            break outer;
          }
        }
      }
    }
  }
  const lines = [];
  for (const l of open) {
    // drop the duplicated seam points (lon +180 and −180 at the same latitude)
    const pts = l.filter((p, k) => !(k && onSeam(p) && onSeam(l[k - 1]) && Math.abs(p[1] - l[k - 1][1]) < 1e-4));
    if (pts.length >= 4 && (samePoint(pts[0], pts.at(-1)) || dot(vecOf(...pts[0]), vecOf(...pts.at(-1))) > Math.cos(0.05 * RAD))) rings.push(pts.slice(0, -1));
    else if (pts.length >= 2) lines.push(pts);
  }
  return { rings, lines };
}

/**
 * The data's points are close together except where a contour is closed along the horizon by a long edge drawn
 * straight in longitude and latitude (a parallel, not a great circle): sample such edges every degree, as drawn.
 */
function densify(line) {
  const out = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[i];
    out.push(a);
    const b = line[i + 1];
    if (!b) break;
    let dl = b[0] - a[0];
    if (Math.abs(a[0]) >= SEAM && Math.abs(b[0]) >= SEAM) continue;
    if (dl > 180) dl -= 360;
    else if (dl < -180) dl += 360;
    const db = b[1] - a[1];
    const k = Math.ceil(Math.max(Math.abs(dl), Math.abs(db)) / 1);
    for (let j = 1; j < k; j++) {
      let lon = a[0] + (dl * j) / k;
      if (lon > 180) lon -= 360;
      else if (lon < -180) lon += 360;
      out.push([lon, a[1] + (db * j) / k]);
    }
  }
  return out;
}

const KIND = { T: 'total', A: 'annular', H: 'hybrid' };
/** Paths with both limits (a centre line between them makes sense): not those open to one side (n, s). */
const BOTH_LIMITS = new Set(['T', 'Tm', 'A', 'Am', 'H', 'H2', 'H3', 'Hm']);

/**
 * The drawable geometry of a record: {kind: 'total' | 'annular' | 'hybrid' | 'partial', rings, lines (open), centre
 * (unit vectors along the centre line, or null), level (the magnitude of a partial eclipse's contour)}.
 */
export function eclipseGeometry(record) {
  const pieces = (record?.geometry?.coordinates ?? []).map((p) => p[0]).filter(Boolean).map(densify);
  const { rings, lines } = stitch(pieces);
  const contour = CONTOUR_TYPES.has(record?.type);
  const kind = contour ? 'partial' : KIND[record?.type?.[0]] ?? 'partial';
  const level = contour ? Math.min(0.8, Math.floor((record?.magnitude ?? 0) * 5 + 1e-9) / 5) : null;
  let centre = null;
  if (!contour && BOTH_LIMITS.has(record?.type) && rings.length) {
    const ring = rings.reduce((a, b) => (b.length > a.length ? b : a));
    centre = centreLine(vecs(ring));
  }
  return { kind, rings, lines, centre, level };
}

/** Resample a polyline of unit vectors at `m` equal steps of arc length. */
function resample(line, m) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.acos(Math.max(-1, Math.min(1, dot(line[i - 1], line[i])))));
  const total = cum.at(-1);
  const out = [];
  let j = 1;
  for (let k = 0; k < m; k++) {
    const s = (total * k) / (m - 1);
    while (j < line.length - 1 && cum[j] < s) j++;
    const seg = cum[j] - cum[j - 1];
    out.push(unit(lerp(line[j - 1], line[j], seg > 0 ? (s - cum[j - 1]) / seg : 0)));
  }
  return out;
}

/**
 * The centre line of a path outline (one limit out, the other back): split the ring at its two farthest points (the
 * ends of the path), resample both limits and take the midpoints.
 */
function centreLine(ring) {
  const n = ring.length;
  if (n < 6) return null;
  let best = 2;
  let bi = 0;
  let bj = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = dot(ring[i], ring[j]);
      if (d < best) {
        best = d;
        bi = i;
        bj = j;
      }
    }
  }
  const a = ring.slice(bi, bj + 1);
  const b = [...ring.slice(bj), ...ring.slice(0, bi + 1)].reverse();
  if (a.length < 2 || b.length < 2) return null;
  const m = 96;
  const ra = resample(a, m);
  const rb = resample(b, m);
  return ra.map((p, k) => unit(add(p, rb[k])));
}

// ---- the projection --------------------------------------------------------------------------------------------------

/** The orientation of the map: front f (greatest eclipse), right r (along the path), up u. */
function orientation(record, geo) {
  const f = vecOf(record.longitude ?? 0, record.latitude ?? 0);
  const east = unit([-Math.sin((record.longitude ?? 0) * RAD), Math.cos((record.longitude ?? 0) * RAD), 0]);
  const north = cross(f, east);
  // principal axis of the path seen gnomonically from f (within 75° of it)
  // a partial eclipse keeps north up; a central path runs along its principal axis
  const pts = geo.kind === 'partial' ? [] : geo.centre ?? [...geo.rings, ...geo.lines].flatMap(vecs);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let mx = 0;
  let my = 0;
  const proj = [];
  for (const p of pts) {
    const d = dot(p, f);
    if (d < 0.26) continue;
    proj.push([dot(p, east) / d, dot(p, north) / d]);
  }
  let r = east;
  if (proj.length >= 3) {
    for (const [x, y] of proj) {
      mx += x;
      my += y;
    }
    mx /= proj.length;
    my /= proj.length;
    for (const [x, y] of proj) {
      sxx += (x - mx) ** 2;
      sxy += (x - mx) * (y - my);
      syy += (y - my) ** 2;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    if (sxx + syy > 1e-6) r = unit(add(scale(east, Math.cos(ang)), scale(north, Math.sin(ang))));
  }
  // left to right means eastward (the shadow's way); a north–south path points north
  const e = dot(r, east);
  if (e < -0.05 || (Math.abs(e) <= 0.05 && dot(r, north) < 0)) r = neg(r);
  const u = cross(f, r);
  return { f, r, u };
}

/** The five faces of the net around the front: normal, in-face axes and the face centre in net units. */
function netFaces({ f, r, u }) {
  const faces = [
    { id: 'front', n: f, ax: r, ay: u, ox: 0, oy: 0 },
    { id: 'right', n: r, ax: neg(f), ay: u, ox: 2, oy: 0 },
    { id: 'left', n: neg(r), ax: f, ay: u, ox: -2, oy: 0 },
    { id: 'top', n: u, ax: r, ay: neg(f), ox: 0, oy: 2 },
    { id: 'bottom', n: neg(u), ax: r, ay: f, ox: 0, oy: -2 },
  ];
  for (const F of faces) F.planes = [sub(F.n, F.ax), add(F.n, F.ax), sub(F.n, F.ay), add(F.n, F.ay)];
  return faces;
}

const project = (F, p) => {
  const d = dot(p, F.n);
  return [F.ox + dot(p, F.ax) / d, F.oy + dot(p, F.ay) / d];
};

/** Net coordinates of a unit vector (null on the back face). */
function netPoint(faces, p) {
  let best = null;
  let bd = 0;
  for (const F of faces) {
    const d = dot(p, F.n);
    if (d > bd) {
      bd = d;
      best = F;
    }
  }
  // inside the best face's square? (the back face is not in the net)
  if (!best || dot(p, neg(faces[0].n)) >= bd) return null;
  return project(best, p);
}

/**
 * The layout of a map in `box`: the orientation, the net, the scale s (mm per net unit, a face is 2 units) and the
 * visible half-extents Hx, Hy (net units). `toPage(lon, lat)` gives page millimetres (null when not on the net).
 */
export function eclipseMapFrame({ record, box, geo = eclipseGeometry(record) }) {
  const o = orientation(record, geo);
  const faces = netFaces(o);
  let maxX = 0;
  let maxY = 0;
  const all = [...geo.rings, ...geo.lines];
  for (const line of all) {
    for (const [lon, lat] of line) {
      const q = netPoint(faces, vecOf(lon, lat));
      if (!q) continue;
      maxX = Math.max(maxX, Math.abs(q[0]));
      maxY = Math.max(maxY, Math.abs(q[1]));
    }
  }
  const pad = 0.22;
  const hxNeed = all.length ? Math.max(1.5, Math.min(3, maxX + pad)) : 2.4;
  const hyNeed = Math.max(0.6, Math.min(3, maxY + pad));
  let s = Math.min(box.w / (2 * hxNeed), box.h / (2 * hyNeed));
  s = Math.max(s, box.w / 6);
  // a thin sliver of the faces above and below reads as a mistake: fit the strip's height instead when the path allows
  const hy = box.h / (2 * s);
  if (hy > 1 && hy < 1.2 && maxY < 0.92 && (box.w * 1) / box.h >= maxX + 0.1) s = box.h / 2;
  const Hx = box.w / (2 * s);
  const Hy = box.h / (2 * s);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const page = (X, Y) => [cx + X * s, cy - Y * s];
  return {
    ...o,
    faces,
    s,
    Hx,
    Hy,
    cx,
    cy,
    page,
    toPage(lon, lat) {
      const q = netPoint(faces, vecOf(lon, lat));
      if (!q || Math.abs(q[0]) > Hx || Math.abs(q[1]) > Hy) return null;
      return page(q[0], q[1]);
    },
  };
}

// ---- clipping ----------------------------------------------------------------------------------------------------------

/** Sutherland–Hodgman of a ring of unit vectors against half-spaces p·m ≥ 0 (planes through the centre). */
function clipRing3(pts, planes) {
  let cur = pts;
  for (const m of planes) {
    if (cur.length < 3) return [];
    const out = [];
    let a = cur[cur.length - 1];
    let da = dot(a, m);
    let allIn = true;
    for (const b of cur) {
      const db = dot(b, m);
      if (db >= 0) {
        if (da < 0) out.push(lerp(a, b, da / (da - db)));
        out.push(b);
      } else {
        allIn = false;
        if (da >= 0) out.push(lerp(a, b, da / (da - db)));
      }
      a = b;
      da = db;
    }
    if (!allIn) cur = out;
  }
  return cur;
}

/** Sutherland–Hodgman of a 2-D ring against the rectangle [x0, x1] × [y0, y1]. */
function clipRing2(pts, x0, x1, y0, y1) {
  const edges = [
    (p) => p[0] - x0,
    (p) => x1 - p[0],
    (p) => p[1] - y0,
    (p) => y1 - p[1],
  ];
  let cur = pts;
  for (const e of edges) {
    if (cur.length < 3) return [];
    const out = [];
    let a = cur[cur.length - 1];
    let da = e(a);
    for (const b of cur) {
      const db = e(b);
      if (db >= 0) {
        if (da < 0) {
          const t = da / (da - db);
          out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
        out.push(b);
      } else if (da >= 0) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
      a = b;
      da = db;
    }
    cur = out;
  }
  return cur;
}

/** The face square ∩ the window, or null. */
function faceRect(F, Hx, Hy) {
  const x0 = Math.max(F.ox - 1, -Hx);
  const x1 = Math.min(F.ox + 1, Hx);
  const y0 = Math.max(F.oy - 1, -Hy);
  const y1 = Math.min(F.oy + 1, Hy);
  return x0 < x1 - 1e-9 && y0 < y1 - 1e-9 ? { x0, x1, y0, y1 } : null;
}

/** "M…Z" of rings (unit vectors) on the visible faces, in page mm. */
function areaPath(rings, fr) {
  let d = '';
  for (const F of fr.visible) {
    const R = F.rect;
    for (const ring of rings) {
      const c3 = clipRing3(ring, F.planes);
      if (c3.length < 3) continue;
      const c2 = clipRing2(
        c3.map((p) => project(F, p)),
        R.x0,
        R.x1,
        R.y0,
        R.y1,
      );
      if (c2.length < 3) continue;
      d += c2.map((q, i) => {
        const [x, y] = fr.page(q[0], q[1]);
        return `${i ? 'L' : 'M'}${n2(x)} ${n2(y)}`;
      }).join('') + 'Z';
    }
  }
  return d;
}

/**
 * Lines (unit vectors) clipped to the visible faces: runs of page points. `skip(i)` leaves out edge i → i+1;
 * `ends` (optional) collects the points where a run is cut by the window's edge: {x, y, side, tag}.
 */
function lineRuns(lines, fr, { closed = false, skip = null, ends = null, tag = null } = {}) {
  const runs = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const n = line.length;
    const m = closed ? n : n - 1;
    for (const F of fr.visible) {
      const R = F.rect;
      let run = null;
      for (let i = 0; i < m; i++) {
        if (skip && skip(li, i)) {
          run = null;
          continue;
        }
        const a = line[i];
        const b = line[(i + 1) % n];
        let t0 = 0;
        let t1 = 1;
        let out = false;
        for (const pl of F.planes) {
          const da = dot(a, pl);
          const db = dot(b, pl);
          if (da < 0 && db < 0) {
            out = true;
            break;
          }
          if (da < 0) t0 = Math.max(t0, da / (da - db));
          else if (db < 0) t1 = Math.min(t1, da / (da - db));
        }
        if (out || t0 >= t1) {
          run = null;
          continue;
        }
        const A = project(F, t0 > 0 ? lerp(a, b, t0) : a);
        const B = project(F, t1 < 1 ? lerp(a, b, t1) : b);
        // Liang–Barsky against the face's visible rectangle
        let u0 = 0;
        let u1 = 1;
        let side0 = null;
        let side1 = null;
        const dx = B[0] - A[0];
        const dy = B[1] - A[1];
        const tests = [
          [-dx, A[0] - R.x0, 'left'],
          [dx, R.x1 - A[0], 'right'],
          [-dy, A[1] - R.y0, 'bottom'],
          [dy, R.y1 - A[1], 'top'],
        ];
        let rejected = false;
        for (const [p, q, side] of tests) {
          if (Math.abs(p) < 1e-15) {
            if (q < 0) rejected = true;
            continue;
          }
          const t = q / p;
          if (p < 0) {
            if (t > u1) rejected = true;
            else if (t > u0) {
              u0 = t;
              side0 = side;
            }
          } else if (t < u0) rejected = true;
          else if (t < u1) {
            u1 = t;
            side1 = side;
          }
        }
        if (rejected || u0 >= u1) {
          run = null;
          continue;
        }
        const P = [A[0] + dx * u0, A[1] + dy * u0];
        const Q = [A[0] + dx * u1, A[1] + dy * u1];
        const p0 = fr.page(P[0], P[1]);
        const p1 = fr.page(Q[0], Q[1]);
        const cut0 = t0 > 0 || u0 > 0;
        if (!run || cut0) {
          run = [p0];
          runs.push(run);
          if (ends && side0 && onWindow(P, side0, fr)) ends.push({ x: p0[0], y: p0[1], side: side0, tag, li });
        }
        run.push(p1);
        if (ends && side1 && onWindow(Q, side1, fr)) ends.push({ x: p1[0], y: p1[1], side: side1, tag, li });
        if (t1 < 1 || u1 < 1) run = null;
      }
    }
  }
  return runs;
}

/** Is a point cut on `side` of a face rectangle on the window's edge (not a face edge inside the box)? */
function onWindow(P, side, fr) {
  const e = 1e-9;
  if (side === 'left') return P[0] <= -fr.Hx + e;
  if (side === 'right') return P[0] >= fr.Hx - e;
  if (side === 'bottom') return P[1] <= -fr.Hy + e;
  return P[1] >= fr.Hy - e;
}

const runsPath = (runs) =>
  runs
    .filter((r) => r.length >= 2)
    .map((r) => r.map(([x, y], i) => `${i ? 'L' : 'M'}${n2(x)} ${n2(y)}`).join(''))
    .join('');

// ---- the base map, prepared once per world ---------------------------------------------------------------------------

const prepared = new WeakMap();
function prepare(world) {
  let w = prepared.get(world);
  if (!w) {
    const seamEdges = (line) => line.map((p, i) => {
      const q = line[(i + 1) % line.length];
      // the antimeridian cuts and the edges to the pole (Antarctica is closed through it) are not coasts
      return (Math.abs(p[0]) >= SEAM && Math.abs(q[0]) >= SEAM) || Math.abs(p[1]) >= 89.9 || Math.abs(q[1]) >= 89.9;
    });
    w = {
      land: (world.land ?? []).map(vecs),
      landSeams: (world.land ?? []).map(seamEdges),
      lakes: (world.lakes ?? []).map(vecs),
      borders: (world.borders ?? []).map(vecs),
    };
    prepared.set(world, w);
  }
  return w;
}

// the graticule every 15°: meridians to ±75° (the quarter meridians to the poles), parallels to ±75°
const GRAT = (() => {
  const mer = [];
  for (let lon = -165; lon <= 180; lon += 15) {
    const lim = lon % 90 === 0 ? 90 : 75;
    const line = [];
    for (let lat = -lim; lat <= lim + 1e-9; lat += 2.5) line.push(vecOf(lon, lat));
    mer.push({ value: lon, line });
  }
  const par = [];
  for (let lat = -75; lat <= 75; lat += 15) {
    const line = [];
    for (let lon = -180; lon <= 180; lon += 2) line.push(vecOf(lon, lat));
    par.push({ value: lat, line });
  }
  return { mer, par };
})();

const deg = (v) => `${Math.abs(Math.round(v))}°`;
const latLabel = (v) => (v === 0 ? 'Equator' : deg(v) + (v > 0 ? 'N' : 'S'));
const lonLabel = (v) => (v === 0 || Math.abs(v) === 180 ? deg(v) : deg(v) + (v > 0 ? 'E' : 'W'));

// ---- the map ---------------------------------------------------------------------------------------------------------

const attr = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false && v !== '')
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? n2(v) : esc(v)}"`)
    .join('');

/**
 * The map's markup. `box` {x, y, w, h} in page mm; `pal` the diary palette; `place` {lat, lon, place} marks the reader's
 * place; `font` the page's family for the label estimates ('sans' | 'serif').
 */
export function eclipseMapSvg({ record, world, box, pal, place = null, pure = false, font = 'sans', labelSize = 1.5 }) {
  void pure; // the map carries no time: degrees and a magnitude only
  const geo = eclipseGeometry(record);
  const fr = eclipseMapFrame({ record, box, geo });
  fr.visible = fr.faces.map((F) => ({ ...F, rect: faceRect(F, fr.Hx, fr.Hy) })).filter((F) => F.rect);
  const w = world ? prepare(world) : { land: [], landSeams: [], lakes: [], borders: [] };
  const out = [];
  const P = (d, o) => d && out.push(`<path d="${d}"${attr(o)}/>`);
  const { x: bx, y: by, w: bw, h: bh } = box;

  // the paper outside the net, then the faces (sea)
  out.push(`<rect${attr({ x: bx, y: by, width: bw, height: bh, fill: pal.shade })}/>`);
  for (const F of fr.visible) {
    const [x0, y0] = fr.page(F.rect.x0, F.rect.y1);
    const [x1, y1] = fr.page(F.rect.x1, F.rect.y0);
    out.push(`<rect${attr({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: pal.paper })}/>`);
  }

  // land, lakes
  P(areaPath(w.land, fr), { fill: pal.ruleSoft, 'fill-rule': 'evenodd' });
  P(areaPath(w.lakes, fr), { fill: pal.paper });

  // graticule
  const ends = [];
  const gratRuns = (list, tag) => {
    const minor = [];
    const major = [];
    list.forEach((g) => (g.value % 90 === 0 ? major : minor).push(...lineRuns([g.line], fr, { ends, tag: { kind: tag, value: g.value } })));
    return { minor, major };
  };
  const gm = gratRuns(GRAT.mer, 'lon');
  const gp = gratRuns(GRAT.par, 'lat');
  P(runsPath([...gm.minor, ...gp.minor]), { fill: 'none', stroke: pal.rule, 'stroke-width': 0.08 });
  P(runsPath([...gm.major, ...gp.major]), { fill: 'none', stroke: pal.ink4, 'stroke-width': 0.09 });

  // coasts and borders
  P(runsPath(lineRuns(w.land, fr, { closed: true, skip: (li, i) => w.landSeams[li][i] })), { fill: 'none', stroke: pal.ink4, 'stroke-width': 0.1, 'stroke-linejoin': 'round' });
  P(runsPath(lineRuns(w.lakes, fr, { closed: true })), { fill: 'none', stroke: pal.ink4, 'stroke-width': 0.08 });
  P(runsPath(lineRuns(w.borders, fr)), { fill: 'none', stroke: pal.ink4, 'stroke-width': 0.08, 'stroke-dasharray': '0.5 0.3' });

  // the eclipse
  const ink = pal.eclipse;
  const rings = geo.rings.map(vecs);
  const lines = geo.lines.map(vecs);
  const widthMm = record.central_width_km ? (record.central_width_km / 6371) * fr.s : 0;
  if (geo.kind === 'total' || geo.kind === 'hybrid') {
    // a narrow path keeps at least ~0.4 mm of ink
    P(areaPath(rings, fr), { fill: ink, stroke: ink, 'stroke-width': Math.max(0.15, 0.4 - widthMm), 'stroke-linejoin': 'round' });
    if (geo.centre && widthMm > 1.4) P(runsPath(lineRuns([geo.centre], fr)), { fill: 'none', stroke: pal.paper, 'stroke-width': 0.1 });
  } else if (geo.kind === 'annular') {
    P(areaPath(rings, fr), { fill: pal.eclipseSoft });
    P(runsPath(lineRuns(rings, fr, { closed: true })), { fill: 'none', stroke: ink, 'stroke-width': 0.22, 'stroke-linejoin': 'round' });
    if (geo.centre && widthMm > 0.9) P(runsPath(lineRuns([geo.centre], fr)), { fill: 'none', stroke: ink, 'stroke-width': 0.08, 'stroke-dasharray': '0.6 0.4' });
  } else {
    P(areaPath(rings, fr), { fill: pal.eclipseSoft, opacity: 0.75 });
    P(runsPath([...lineRuns(rings, fr, { closed: true }), ...lineRuns(lines, fr)]), { fill: 'none', stroke: ink, 'stroke-width': 0.28, 'stroke-dasharray': '1.1 0.55', 'stroke-linecap': 'round' });
  }
  // open central paths (one limit beyond the horizon): their limits as lines
  if (geo.kind !== 'partial' && lines.length) P(runsPath(lineRuns(lines, fr)), { fill: 'none', stroke: ink, 'stroke-width': 0.25 });

  // face edges (the cube), the frame
  const edges = [];
  for (const F of fr.visible) {
    const sq = [
      [F.ox - 1, F.oy - 1],
      [F.ox + 1, F.oy - 1],
      [F.ox + 1, F.oy + 1],
      [F.ox - 1, F.oy + 1],
    ];
    for (let i = 0; i < 4; i++) {
      const a = sq[i];
      const b = sq[(i + 1) % 4];
      const key = [a, b].map((p) => p.join(',')).sort().join('|');
      if (edges.some((e) => e.key === key)) continue;
      // clip to the window (axis-aligned segments)
      const x0 = Math.max(Math.min(a[0], b[0]), -fr.Hx);
      const x1 = Math.min(Math.max(a[0], b[0]), fr.Hx);
      const y0 = Math.max(Math.min(a[1], b[1]), -fr.Hy);
      const y1 = Math.min(Math.max(a[1], b[1]), fr.Hy);
      if (x0 > x1 + 1e-9 || y0 > y1 + 1e-9 || (x1 - x0 < 1e-9 && y1 - y0 < 1e-9)) continue;
      if (a[1] === b[1] && Math.abs(a[1]) >= fr.Hy - 1e-9) continue; // on the frame
      if (a[0] === b[0] && Math.abs(a[0]) >= fr.Hx - 1e-9) continue;
      edges.push({ key, p: fr.page(x0, y0), q: fr.page(x1, y1) });
    }
  }
  P(edges.map((e) => `M${n2(e.p[0])} ${n2(e.p[1])}L${n2(e.q[0])} ${n2(e.q[1])}`).join(''), { fill: 'none', stroke: pal.ink3, 'stroke-width': 0.18 });
  out.push(`<rect${attr({ x: bx, y: by, width: bw, height: bh, fill: 'none', stroke: pal.ink3, 'stroke-width': 0.2 })}/>`);

  // markers
  const taken = [];
  const free = (b, gap = 0.9) => b.x0 >= bx + 0.3 && b.x1 <= bx + bw - 0.3 && b.y0 >= by + 0.3 && b.y1 <= by + bh - 0.3 && !taken.some((t) => b.x0 < t.x1 + gap && t.x0 < b.x1 + gap && b.y0 < t.y1 + gap && t.y0 < b.y1 + gap);
  const [gx, gy] = fr.page(0, 0);
  out.push(`<circle${attr({ cx: gx, cy: gy, r: 0.85, fill: pal.paper, stroke: pal.ink, 'stroke-width': 0.22 })}/>`);
  out.push(`<circle${attr({ cx: gx, cy: gy, r: 0.32, fill: pal.ink })}/>`);
  taken.push({ x0: gx - 1, x1: gx + 1, y0: gy - 1, y1: gy + 1 });
  let placeAt = null;
  if (place && Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
    placeAt = fr.toPage(place.lon, place.lat);
    if (placeAt) {
      const [px, py] = placeAt;
      const r = 0.7;
      out.push(`<path d="M${n2(px)} ${n2(py - r)}L${n2(px + r)} ${n2(py)}L${n2(px)} ${n2(py + r)}L${n2(px - r)} ${n2(py)}Z"${attr({ fill: pal.ink, stroke: pal.paper, 'stroke-width': 0.15 })}/>`);
      taken.push({ x0: px - r, x1: px + r, y0: py - r, y1: py + r });
    }
  }

  // labels: the place, the partial eclipse's contour, the graticule at the frame
  const texts = [];
  const size = labelSize;
  const label = (x, y, s, anchor = 'start', fill = pal.ink3, weight = 400) => {
    const wd = measure(s, size, { weight, font });
    const x0 = anchor === 'end' ? x - wd : anchor === 'middle' ? x - wd / 2 : x;
    const b = { x0, x1: x0 + wd, y0: y - size * 0.74, y1: y + size * 0.2 };
    if (!free(b)) return false;
    taken.push(b);
    texts.push(`<text${attr({ x, y, 'font-size': size, fill, 'text-anchor': anchor === 'start' ? undefined : anchor, 'font-weight': weight === 400 ? undefined : weight, stroke: pal.paper, 'stroke-width': 0.45, 'paint-order': 'stroke', 'stroke-linejoin': 'round' })}>${esc(s)}</text>`);
    return true;
  };
  if (placeAt && place.place) {
    const [px, py] = placeAt;
    const name = fit(place.place, Math.min(30, bw * 0.4), size, { min: size * 0.85, font }).text;
    if (name) {
      const base = py + size * 0.27;
      const spots = [];
      for (const d of [1.2, 2.4, 3.6])
        spots.push([px + d, base, 'start'], [px - d, base, 'end'], [px, py - d, 'middle'], [px, py + d + size * 0.74, 'middle']);
      spots.some(([x, y, a]) => label(x, y, name, a, pal.ink, 600));
    }
  }
  if (geo.kind === 'partial' && geo.level !== null && geo.level > 0) {
    // along the contour, nearest the middle of the box
    const runs = [...lineRuns(rings, fr, { closed: true }), ...lineRuns(lines, fr)];
    const pts = runs.flat().filter(([x, y]) => x > bx + 3 && x < bx + bw - 3 && y > by + 3 && y < by + bh - 3);
    pts.sort((a, b) => Math.abs(a[0] - gx) + 0.5 * Math.abs(a[1] - gy) - (Math.abs(b[0] - gx) + 0.5 * Math.abs(b[1] - gy)));
    const txt = level(geo.level);
    for (const [x, y] of pts.filter((_, i) => i % 4 === 0).slice(0, 40)) if (label(x, y - 0.7, txt, 'middle', ink, 600)) break;
  }
  // graticule labels where the lines meet the frame, one per line: 30° multiples first, parallels on the sides and
  // meridians at the top and bottom when they can
  const byLine = new Map();
  for (const e of ends) {
    const k = `${e.tag.kind}${e.tag.value}`;
    (byLine.get(k) ?? byLine.set(k, []).get(k)).push(e);
  }
  const lineOrder = [...byLine.values()].sort((a, b) => {
    const [p, q] = [a[0].tag, b[0].tag];
    return (q.value % 30 === 0) - (p.value % 30 === 0) || (p.kind === 'lat' ? -1 : 1) - (q.kind === 'lat' ? -1 : 1) || Math.abs(p.value) - Math.abs(q.value) || p.value - q.value;
  });
  const sidePref = (e) => ((e.tag.kind === 'lat') === (e.side === 'left' || e.side === 'right') ? 0 : 1);
  for (const list of lineOrder) {
    list.sort((a, b) => sidePref(a) - sidePref(b) || a.x - b.x || a.y - b.y);
    for (const e of list) {
      const s = e.tag.kind === 'lat' ? latLabel(e.tag.value) : lonLabel(e.tag.value);
      const inset = 0.6;
      const ok =
        e.side === 'top'
          ? label(e.x, by + inset + size * 0.74, s, 'middle')
          : e.side === 'bottom'
            ? label(e.x, by + bh - inset - size * 0.2, s, 'middle')
            : e.side === 'left'
              ? label(bx + inset, e.y + size * 0.27, s, 'start')
              : label(bx + bw - inset, e.y + size * 0.27, s, 'end');
      if (ok) break;
    }
  }

  return `<g class="eclipse-map">${out.join('')}${texts.join('')}</g>`;
}

const level = (v) => (Math.round(v * 10) / 10).toFixed(1);
