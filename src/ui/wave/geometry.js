/**
 * Pure geometry helpers for the wave view. No DOM, no clock access: everything
 * here works on the arc objects returned by `clock.arc()`
 *   { center:{x,y}, radius, start, sweep }      (angles in radians, y points down)
 * and on plain numbers, so it can be unit-tested in Node.
 *
 * Vocabulary
 *   half-arc     one half-cycle of a level (the library's arc index); a crest has
 *                a positive sweep, a trough a negative one (= even / odd index)
 *   local        0..1 progress through a half-arc ("the marker position")
 *   camera       { cx, cy, scale, rot } : world point (cx,cy) sits in the middle of
 *                the canvas, `scale` pixels per world unit, world rotated by `rot`
 *   screen arc   an arc projected to canvas pixels { x, y, r, a0, sweep }
 */

export const TAU = Math.PI * 2;
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Wrap an angle into [-PI, PI). */
export function wrapPi(a) {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}

// ---------------------------------------------------------------- arcs ----

/** Point of an arc at progress t (0 = start, 1 = end). */
export function pointOnArc(arc, t, out = {}) {
  const a = arc.start + arc.sweep * t;
  out.x = arc.center.x + arc.radius * Math.cos(a);
  out.y = arc.center.y + arc.radius * Math.sin(a);
  return out;
}

export function emptyBounds() {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}
export function addPoint(b, x, y) {
  if (x < b.x0) b.x0 = x;
  if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y;
  if (y > b.y1) b.y1 = y;
  return b;
}
/** Bounds of the part [t0,t1] of an arc, found by sampling (as the library's svg() does). */
export function arcBounds(arc, t0 = 0, t1 = 1, n = 48) {
  const b = emptyBounds();
  for (let i = 0; i <= n; i++) {
    const p = pointOnArc(arc, t0 + ((t1 - t0) * i) / n);
    addPoint(b, p.x, p.y);
  }
  return b;
}

/**
 * Rotation (radians) that turns a focused arc so that its middle points up for a crest
 * (positive sweep) and down for a trough: every half-arc then reads like the wave it is.
 */
export function viewRotation(arc) {
  const mid = arc.start + arc.sweep / 2;
  return wrapPi((arc.sweep >= 0 ? -Math.PI / 2 : Math.PI / 2) - mid);
}

// -------------------------------------------------------------- camera ----

/**
 * Camera fitting a cloud of world points (flat [x0,y0,x1,y1,...]) into a W x H canvas after
 * rotating the world by `rot`. `pad` = {l,r,t,b} pixels kept free around the figure.
 */
export function fitCamera(points, rot, W, H, pad = {}, { maxScale = Infinity } = {}) {
  const pl = pad.l ?? 0;
  const pr = pad.r ?? 0;
  const pt = pad.t ?? 0;
  const pb = pad.b ?? 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = c * points[i] - s * points[i + 1];
    const y = s * points[i] + c * points[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const bw = Math.max(1e-12, x1 - x0);
  const bh = Math.max(1e-12, y1 - y0);
  const availW = Math.max(40, W - pl - pr);
  const availH = Math.max(40, H - pt - pb);
  const scale = Math.min(availW / bw, availH / bh, maxScale);
  // centre of the figure in rotated space, shifted so it lands in the middle of the free area
  const rx = (x0 + x1) / 2 - (pl + availW / 2 - W / 2) / scale;
  const ry = (y0 + y1) / 2 - (pt + availH / 2 - H / 2) / scale;
  // back to world space
  return { cx: c * rx + s * ry, cy: -s * rx + c * ry, scale, rot };
}

/**
 * Camera between a and b (e in 0..1). Scale moves geometrically and the centre follows the
 * exact "zoom towards a point" path, so whatever stays still on screen between the two
 * cameras stays still all along. The rotation takes the short way round.
 */
export function lerpCamera(a, b, e) {
  const s = Math.exp(Math.log(a.scale) * (1 - e) + Math.log(b.scale) * e);
  const ia = 1 / a.scale;
  const ib = 1 / b.scale;
  const d = ib - ia;
  const g = Math.abs(d) < 1e-9 * Math.max(ia, ib) ? e : (1 / s - ia) / d;
  return {
    cx: a.cx + (b.cx - a.cx) * g,
    cy: a.cy + (b.cy - a.cy) * g,
    scale: s,
    rot: a.rot + wrapPi(b.rot - a.rot) * e,
  };
}

/** Express a camera given in frame X in frame Y, where p_Y = o + k * p_X (translate + uniform scale). */
export function cameraToFrame(cam, o, k) {
  return { cx: o.x + k * cam.cx, cy: o.y + k * cam.cy, scale: cam.scale / k, rot: cam.rot };
}
/** The inverse view: camera in Y (where p_Y = o + k p_X) expressed in X. */
export function cameraFromFrame(cam, o, k) {
  return { cx: (cam.cx - o.x) / k, cy: (cam.cy - o.y) / k, scale: cam.scale * k, rot: cam.rot };
}

export const easeOutCubic = (x) => 1 - Math.pow(1 - clamp01(x), 3);

/** A view caches cos/sin of a camera for projecting many arcs per frame. */
export function makeView(cam, W, H) {
  const c = Math.cos(cam.rot);
  const s = Math.sin(cam.rot);
  const k = cam.scale;
  return {
    cam,
    W,
    H,
    c,
    s,
    k,
    point(x, y, out = {}) {
      const dx = x - cam.cx;
      const dy = y - cam.cy;
      out.x = W / 2 + k * (c * dx - s * dy);
      out.y = H / 2 + k * (s * dx + c * dy);
      return out;
    },
    arc(arc, out = {}) {
      const dx = arc.center.x - cam.cx;
      const dy = arc.center.y - cam.cy;
      out.x = W / 2 + k * (c * dx - s * dy);
      out.y = H / 2 + k * (s * dx + c * dy);
      out.r = arc.radius * k;
      out.a0 = arc.start + cam.rot;
      out.sweep = arc.sweep;
      return out;
    },
  };
}

/** Point of a projected (screen) arc at progress t. */
export function screenPoint(sa, t, out = {}) {
  const a = sa.a0 + sa.sweep * t;
  out.x = sa.x + sa.r * Math.cos(a);
  out.y = sa.y + sa.r * Math.sin(a);
  return out;
}

/**
 * Nearest point of a projected arc (limited to progress 0..tMax) to a pixel.
 * @returns {{t:number, dist:number}} progress of the nearest point and its pixel distance
 */
export function nearestOnArc(sa, px, py, tMax = 1) {
  const dx = px - sa.x;
  const dy = py - sa.y;
  const dir = sa.sweep < 0 ? -1 : 1;
  const span = Math.abs(sa.sweep);
  let d = ((Math.atan2(dy, dx) - sa.a0) * dir) % TAU;
  if (d < 0) d += TAU;
  if (d <= span * tMax) return { t: d / span, dist: Math.abs(Math.hypot(dx, dy) - sa.r) };
  const p0 = screenPoint(sa, 0);
  const p1 = screenPoint(sa, tMax);
  const d0 = Math.hypot(px - p0.x, py - p0.y);
  const d1 = Math.hypot(px - p1.x, py - p1.y);
  return d0 <= d1 ? { t: 0, dist: d0 } : { t: tMax, dist: d1 };
}

// ------------------------------------------------- levels and markers ----

/**
 * Half-arc reading from a full-cycle reading (`model.levelAt`): the cycle number and the
 * phase 0..1 inside the cycle. Half-arc index = 2 * cycle + (second half ? 1 : 0).
 * @returns {{idx:number, local:number, half:0|1}}
 */
export function halfOf(cycle, phase) {
  const half = phase >= 0.5 ? 1 : 0;
  return { idx: cycle * 2 + half, local: Math.min(1, Math.max(0, phase * 2 - half)), half };
}

/** The child half-arc (m children per half-arc) containing progress `local` of half-arc `idx`. */
export function childOf(idx, local, m) {
  const x = local * m;
  let j = Math.floor(x);
  if (j >= m) j = m - 1;
  if (j < 0) j = 0;
  return { idx: idx * m + j, local: x - j, j };
}

/** The parent half-arc of child half-arc `idx` when the parent level has factor m. */
export function parentOf(idx, local, m) {
  const j = idx % m;
  return { idx: (idx - j) / m, local: (j + local) / m, j };
}

/**
 * One marker per level: the point of each level's arc at its progress.
 * @param levels [{level, idx, local, arc}] coarse to fine (arc = the half-arc `idx` of that level)
 * @returns [{level, idx, local, arc, x, y}] with (x, y) = pointOnArc(arc, local), so a marker always
 *          lies on its own arc at the phase of its half-cycle
 */
export function levelMarkers(levels) {
  return levels.map((m) => {
    const p = pointOnArc(m.arc, m.local);
    return { level: m.level, idx: m.idx, local: m.local, arc: m.arc, x: p.x, y: p.y };
  });
}

/** Fraction (0..1) of a half-arc travelled when the current half-arc of that level is `cur`. */
export function travelled(idx, cur) {
  return idx < cur.idx ? 1 : idx > cur.idx ? 0 : cur.local;
}

/** "+3" / "−4": 1-based local index with the sign of the arc's sweep (crest +, trough −). */
export function signedLabel(n, sweep) {
  return (sweep >= 0 ? '+' : '−') + n;
}

/**
 * Phase-glyph state index (CBT vector glyph, ascending family) at progress `t` of half-arc
 * `idx`: floor(cycle phase * 4M) with M = (3^strokes - 1) / 2 (SPEC §4).
 */
export function glyphIndexAt(idx, t, strokes = 2) {
  const M = (3 ** strokes - 1) / 2;
  const states = 4 * M;
  const i = Math.floor(((idx % 2) + clamp01(t)) * 2 * M);
  return ((i % states) + states) % states;
}

// ------------------------------------------------ catalogue overview ----

/**
 * Wrap the 35-arc catalogue wave into rows so it uses the canvas: row r holds `cols` consecutive
 * level-0 half-arcs (2 world units wide each). Returns the layout that gives the biggest scale.
 */
export function layoutRows(n, W, H, { pad = {}, rowPitch = 3.1, minCols = 2, maxCols = n } = {}) {
  const pl = pad.l ?? 0;
  const pr = pad.r ?? 0;
  const pt = pad.t ?? 0;
  const pb = pad.b ?? 0;
  const availW = Math.max(40, W - pl - pr);
  const availH = Math.max(40, H - pt - pb);
  let best = null;
  for (let cols = Math.min(maxCols, n); cols >= minCols; cols--) {
    const rows = Math.ceil(n / cols);
    const worldW = 2 * cols;
    const worldH = (rows - 1) * rowPitch + 2 * 1.4; // arcs reach +-1 and their child loops about 0.4 further
    const scale = Math.min(availW / worldW, availH / worldH);
    if (!best || scale > best.scale * 1.0001) best = { cols, rows, scale, worldW, worldH, rowPitch };
  }
  return best;
}

/** Offset applied to level-0 half-arc r of a row layout: p' = p + offset. */
export function rowOffset(r, layout) {
  const row = Math.floor(r / layout.cols);
  return { x: -2 * layout.cols * row, y: row * layout.rowPitch, row, col: r % layout.cols };
}

/** Camera showing a whole row layout. */
export function overviewCamera(layout, W, H, pad = {}) {
  const pl = pad.l ?? 0;
  const pt = pad.t ?? 0;
  const pr = pad.r ?? 0;
  const pb = pad.b ?? 0;
  const cx = layout.worldW / 2;
  // vertical extent: the loops above the first row down to the loops below the last
  const top = -1.4;
  const bottom = (layout.rows - 1) * layout.rowPitch + 1.4;
  const cy = (top + bottom) / 2;
  const availW = W - pl - pr;
  const availH = H - pt - pb;
  return {
    cx: cx - (pl + availW / 2 - W / 2) / layout.scale,
    cy: cy - (pt + availH / 2 - H / 2) / layout.scale,
    scale: layout.scale,
    rot: 0,
  };
}
