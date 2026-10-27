/**
 * Canvas 2D drawing for the wave view. All coordinates handed to the canvas are pixels
 * (arcs are projected in JS doubles first), so zooming through any number of levels keeps
 * full precision; nothing here touches the clock or the DOM except the canvas itself.
 */
import * as G from './geometry.js';
import { pentadSpans, pinGeometry, QUARTERS, quarterMarks, rippleAmp, rippleFit, ripplePointAt, ripplePoints, rippleSplit, syncsOnArc } from './solar.js';
import { drawPentadMark, PENTAD_NUMERALS } from '../pentad.js';

const BIG_R = 3000; // px: arcs bigger than this are drawn as a polyline of their visible stretch
const PANEL = '11, 16, 21'; // --bg-2, used for text halos
const INK_3 = '#7a8a9a'; // the small year labels: theme.INK_3 is 4.3:1 on the panel, this is 5:1

export function createPainter(canvas, { theme, fonts }) {
  const g = canvas.getContext('2d');
  const colors = new Map();
  const P = {
    canvas,
    g,
    theme,
    fonts,
    W: 0,
    H: 0,
    dpr: 1,
    resize(w, h, dpr) {
      P.W = w;
      P.H = h;
      P.dpr = dpr;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      P.labelMem?.clear();
    },
    /** true while a label is still gliding to its new spot: the next frame has to be drawn too */
    settling: false,
    /** clock of the label glide, in ms (replaceable, so the glide can be tested without waiting) */
    now: () => performance.now(),
    begin() {
      P.settling = false;
      g.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
      g.clearRect(0, 0, P.W, P.H);
      g.lineCap = 'round';
      g.lineJoin = 'round';
    },
    /** CSS colour of a level hue; `grey` swaps in the neutral ink (out-of-range state). */
    level(l, a = 1, light = 64, grey = false) {
      const key = (grey ? 'g' : l) + '|' + Math.round(a * 100) + '|' + light;
      let c = colors.get(key);
      if (!c) {
        c = grey ? `hsl(210 14% ${Math.min(80, light - 6)}% / ${a})` : theme.levelColor(l, a, light);
        if (colors.size > 600) colors.clear();
        colors.set(key, c);
      }
      return c;
    },
  };
  return P;
}

// ------------------------------------------------------------- helpers ----

const tmpA = {};
const tmpB = {};

/** Cheap bounding-box test of a projected arc against the canvas. */
function visible(P, sa, margin = 24) {
  if (sa.r < 0.3) return false;
  if (sa.r > BIG_R) return true;
  return !(sa.x + sa.r < -margin || sa.x - sa.r > P.W + margin || sa.y + sa.r < -margin || sa.y - sa.r > P.H + margin);
}

/** Add the part [t0,t1] of a projected arc to the current path (moveTo + arc, or a polyline for huge circles). */
function pathArc(P, sa, t0, t1) {
  if (!(t1 > t0)) return;
  const g = P.g;
  if (sa.r <= BIG_R) {
    const a0 = sa.a0 + sa.sweep * t0;
    g.moveTo(sa.x + sa.r * Math.cos(a0), sa.y + sa.r * Math.sin(a0));
    g.arc(sa.x, sa.y, sa.r, a0, sa.a0 + sa.sweep * t1, sa.sweep < 0);
    return;
  }
  // a circle far larger than the canvas: sample only the stretch near the middle of the canvas
  const span = Math.abs(sa.sweep);
  const near = G.nearestOnArc(sa, P.W / 2, P.H / 2, t1);
  const half = Math.min(Math.PI, (Math.hypot(P.W, P.H) * 0.8) / sa.r + 0.01) / span;
  const u0 = Math.max(t0, near.t - half);
  const u1 = Math.min(t1, near.t + half);
  if (!(u1 > u0)) return;
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const a = sa.a0 + sa.sweep * (u0 + ((u1 - u0) * i) / n);
    const x = sa.x + sa.r * Math.cos(a);
    const y = sa.y + sa.r * Math.sin(a);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
}

/** Where the segment from the inside point (x0,y0) towards (x1,y1) leaves the rectangle inset..W-inset x inset..H-inset. */
function clipToRect(x0, y0, x1, y1, inset, W, H) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t = 1;
  if (dx > 0) t = Math.min(t, (W - inset - x0) / dx);
  else if (dx < 0) t = Math.min(t, (inset - x0) / dx);
  if (dy > 0) t = Math.min(t, (H - inset - y0) / dy);
  else if (dy < 0) t = Math.min(t, (inset - y0) / dy);
  t = Math.max(0, t);
  return [x0 + dx * t, y0 + dy * t];
}

/**
 * Keep an edge badge off the rectangles of controls (the zoom buttons, the solar dial): slide it along the border.
 * `av` is one rectangle {x0, y0, x1, y1}, a list of them, or null.
 */
function dodge([x, y], av, inset) {
  if (!av) return [x, y];
  const list = Array.isArray(av) ? av : [av];
  for (let pass = 0; pass < 2; pass++) {
    for (const r of list) {
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) {
        if (y <= inset + 0.5) x = r.x0 > 40 ? r.x0 - 14 : r.x1 + 14;
        else y = r.y1 + 14;
      }
    }
  }
  return [x, y];
}

function stroke(P, color, width) {
  P.g.strokeStyle = color;
  P.g.lineWidth = width;
  P.g.stroke();
}

function text(P, str, x, y, { color, font, align = 'center', base = 'middle', halo = true, haloWidth = 3.5 }) {
  const g = P.g;
  g.font = font;
  g.textAlign = align;
  g.textBaseline = base;
  if (halo) {
    g.lineWidth = haloWidth;
    g.strokeStyle = `rgba(${PANEL}, 0.82)`;
    g.strokeText(str, x, y);
  }
  g.fillStyle = color;
  g.fillText(str, x, y);
}

const widths = new Map();
function textWidth(P, str, font) {
  const key = font + '|' + str;
  let w = widths.get(key);
  if (w === undefined) {
    P.g.font = font;
    w = P.g.measureText(str).width;
    if (widths.size > 400) widths.clear();
    widths.set(key, w);
  }
  return w;
}

/** Draw a label and remember the rectangle it covers so later labels can keep clear of it. */
function labelAt(P, occ, str, x, y, style) {
  const w = textWidth(P, str, style.font);
  const align = style.align ?? 'center';
  const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  occ.push({ x0: x0 - 3, x1: x0 + w + 3, y0: y - 8, y1: y + 8, w: SOFT }); // a number under the time label is tolerable
  text(P, str, x, y, style);
}

const overlapArea = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

const LABEL_KEEP = 90; // weighted px^2 of overlap a label tolerates at its current spot (a loop number under it is fine) before it moves
const LABEL_GAPS = [0, 12, 26]; // extra distance (px) from the marker, nearest first
const SOFT = 0.2; // weight of the quiet labels (loop numbers, event names) when the time label looks for room
const LABEL_GLIDE = 70; // ms: time constant of a label's move to a new spot
const LABEL_MAX_STEP = 14; // px a label may move per frame while it glides

/**
 * Put a label next to a marker on the side that is free: tries the outward normal first, then the
 * inward one, the tangents and the diagonals, near and far, and keeps the spot that overlaps the
 * least with earlier labels and markers (and stays inside the canvas). The chosen rectangle is added
 * to `occ`.
 *
 * Steadiness: the rectangle slides around the marker's clearance box continuously with the
 * direction (no jump when the text anchor would switch from centred to left), the width is measured
 * on a stand-in with every digit as "0" (a ticking time never changes the size), and a label stays
 * at its spot, found again by the same `key` next frame, until that spot is genuinely blocked.
 * Without this the first free candidate won every frame and a moving dot's label hopped between
 * near-tied sides several times a second.
 * @returns {{x:number, y:number, align:'center', cost:number}} centre of the text (baseline middle)
 */
export function placeLabel(P, occ, key, str, x, y, nx, ny, font, clear = 12, weight = 1, extra = 0) {
  const hw = (textWidth(P, str.replace(/\d/g, '0'), font) + extra) / 2 + 3;
  const hh = 8;
  const dirs = [
    [nx, ny],
    [-nx, -ny],
    [-ny, nx],
    [ny, -nx],
    [(nx - ny) * 0.71, (ny + nx) * 0.71],
    [(-nx - ny) * 0.71, (-ny + nx) * 0.71],
    [(nx + ny) * 0.71, (ny - nx) * 0.71],
    [(-nx + ny) * 0.71, (-ny - nx) * 0.71],
  ];
  const canvas = { x0: 4, y0: 4, x1: P.W - 4, y1: P.H - 4 };
  // `margin` inflates the label's box: a new spot is chosen with room to spare, so it stays clear
  // for a while, whereas the spot already held is only given up once it truly collides (margin 0)
  const spot = (i, margin) => {
    const gap = LABEL_GAPS[(i / dirs.length) | 0];
    const [dx, dy] = dirs[i % dirs.length];
    // the nearest the rectangle can sit along (dx, dy) without touching the marker's clearance box
    const s = Math.min(Math.abs(dx) > 1e-6 ? (hw + clear) / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? (hh + clear) / Math.abs(dy) : Infinity);
    // slid back inside the canvas when it would poke out (a caption above a dot at the edge stays beside it)
    const cx = Math.max(canvas.x0 + hw, Math.min(canvas.x1 - hw, x + dx * (s + gap)));
    const cy = Math.max(canvas.y0 + hh, Math.min(canvas.y1 - hh, y + dy * (s + gap)));
    const rect = { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
    const box = margin ? { x0: rect.x0 - margin, x1: rect.x1 + margin, y0: rect.y0 - margin, y1: rect.y1 + margin } : rect;
    let cost = 3 * ((box.x1 - box.x0) * (box.y1 - box.y0) - overlapArea(box, canvas)); // area poking out of the canvas
    for (const r of occ) cost += (r.w ?? 1) * overlapArea(box, r);
    return { x: cx, y: cy, align: 'center', cost: cost + gap * 0.01, rect, i };
  };
  const mem = (P.labelMem ??= new Map());
  const last = mem.get(key);
  let held = last === undefined ? null : spot(last.i, 0);
  let best = held;
  if (!held || held.cost >= LABEL_KEEP) {
    best = null;
    const n = LABEL_GAPS.length * dirs.length;
    // first the nearest spot that is free with some room around it, else the one that collides least
    for (let i = 0; i < n && !best; i++) {
      const c = spot(i, 5);
      if (c.cost < 1) best = c;
    }
    if (!best) {
      for (let i = 0; i < n; i++) {
        const c = spot(i, 0);
        if (!best || c.cost < best.cost) best = c;
      }
      // everything collides: do not hop for a marginal gain
      if (held && held.cost - best.cost < LABEL_KEEP / 2) best = held;
    }
  }
  occ.push({ ...best.rect, w: weight });
  // Whatever the spot, the text eases towards it, measured from the dot so that following the dot costs
  // no lag: a label that has to give way to a loop number glides to its new side instead of snapping.
  const now = P.now();
  const tx = best.x - x;
  const ty = best.y - y;
  let ox = tx;
  let oy = ty;
  const dist = last ? Math.hypot(tx - last.ox, ty - last.oy) : 0;
  if (last && dist > 0 && dist < 160 && now > last.t && now - last.t < 400) {
    const k = Math.min(1, LABEL_MAX_STEP / dist, 1 - Math.exp(-(now - last.t) / LABEL_GLIDE));
    ox = last.ox + (tx - last.ox) * k;
    oy = last.oy + (ty - last.oy) * k;
  }
  if (Math.hypot(ox - tx, oy - ty) > 0.4) P.settling = true;
  mem.set(key, { i: best.i, ox, oy, t: now });
  return { x: x + ox, y: y + oy, align: 'center', cost: best.cost, rect: best.rect };
}

function drawMarker(P, x, y, level, { emph = false, size = 4, grey = false }) {
  const g = P.g;
  const col = P.level(level, 1, emph ? 72 : 66, grey);
  g.save();
  if (emph) {
    const halo = g.createRadialGradient(x, y, 0, x, y, size * 3.4);
    halo.addColorStop(0, P.level(level, 0.55, 70, grey));
    halo.addColorStop(1, P.level(level, 0, 70, grey));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(x, y, size * 3.4, 0, G.TAU);
    g.fill();
  }
  g.beginPath();
  g.arc(x, y, size + 1.6, 0, G.TAU);
  g.fillStyle = 'rgba(7, 9, 13, 0.9)';
  g.fill();
  g.beginPath();
  g.arc(x, y, size, 0, G.TAU);
  g.fillStyle = col;
  g.fill();
  if (emph) {
    g.beginPath();
    g.arc(x, y, size * 0.36, 0, G.TAU);
    g.fillStyle = '#fff';
    g.fill();
  }
  g.restore();
}

// ------------------------------------------------------- the solar sync ----

const goldA = (a) => `rgba(255, 214, 10, ${a})`;
/** The part of the ripple the displayed time has not reached: gold at this alpha over the panel is 4:1 (3:1 is the floor). */
export const REST_ALPHA = 0.5;
const tmpS = {};

/**
 * The solar ripple along the focused arc: the polyline of one yellow wave whose wavelength is a sync, bright up
 * to the displayed time and dimmer (still 3:1 against the panel) after it, with a dot on every quarter (peak, node,
 * valley, end) of the syncs it crosses. Nothing is drawn when the arc is too short or too long for a ripple (fewer
 * than 1.5 syncs on it, or a wavelength under MIN_WAVELENGTH). `sun` = {grid, spec, sync, quarter}: the sync grid, the
 * arc in position units, and the sync with the displayed time (quarter = how many of its quarters have passed, 0..3).
 * @returns {null | {fit:object, amp:number}}
 */
function drawRipple(P, scene, sf, trF, sun, quiet, occ) {
  const g = P.g;
  const fit = rippleFit(syncsOnArc(sun.spec.P, scene.fraction, sun.grid), sf.r * Math.abs(sf.sweep) * scene.fraction);
  if (!fit.visible) return null;
  const amp = rippleAmp(fit.wavelength);
  const { xs, ys, n } = ripplePoints(sf, sun.spec, sun.grid, { amp });
  const split = rippleSplit(n, trF, scene.fraction);
  const path = (i0, i1) => {
    g.beginPath();
    g.moveTo(xs[i0], ys[i0]);
    for (let i = i0 + 1; i <= i1; i++) g.lineTo(xs[i], ys[i]);
  };
  g.save();
  g.globalAlpha *= fit.strength;
  if (split < n) {
    path(split, n);
    stroke(P, goldA(REST_ALPHA), 1.3);
  }
  if (split > 0) {
    path(0, split);
    stroke(P, goldA(0.92), 1.5);
  }
  // quarter dots: filled once passed, ringed for the coming one; only a wide wave (a quarter of it 40 px or more) marks every sync on the arc, a tight one just the sync of the displayed time
  const quarterW = fit.wavelength / 4;
  const marks = quarterMarks(sun.spec, sun.grid, quarterW >= 40 ? null : sun.sync);
  for (const m of marks) {
    const pt = ripplePointAt(sf, sun.spec, sun.grid, Math.min(scene.fraction, Math.max(0, m.p)), amp, tmpS);
    const passed = m.sync < sun.sync || (m.sync === sun.sync && m.k <= sun.quarter);
    const next = m.sync === sun.sync && m.k === sun.quarter + 1;
    g.beginPath();
    g.arc(pt.x, pt.y, next ? 3.2 : 2.2, 0, G.TAU);
    if (passed) {
      g.fillStyle = goldA(0.85);
      g.fill();
    } else {
      g.fillStyle = 'rgba(11, 16, 21, 0.9)';
      g.fill();
      stroke(P, goldA(next ? 1 : 0.6), next ? 1.6 : 1.1);
    }
    if (!quiet && m.sync === sun.sync && quarterW >= 46) {
      placeAndLabel(P, occ, 'sq' + m.k, QUARTERS[m.k - 1], pt.x, pt.y, pt.nx, pt.ny, { color: goldA(next ? 1 : 0.78), font: P.fonts.small }, 7);
    }
  }
  drawPentadRail(P, scene, sf, sun, fit, amp, quiet, occ);
  g.restore();
  return { fit, amp };
}

/** px from the ripple's crest to the Pentad rail, and the rail's gap at each Pentad start. */
const RAIL_OFF = 7;
const RAIL_GAP = 4;
/** A Pentad's mark is written on the rail only where the Pentad is at least this long (px). */
const RAIL_LABEL_PX = 30;

/**
 * The Pentads of the sync along the ripple (SPEC §7.5): a rail just outside the ripple's crests, one segment per Pentad –
 * Pentad I, II and III five Helions each, the Hypopentad four, so its segment is visibly shorter – with a gap where each
 * one starts. Each Pentad starts a quarter Helion after the quarter dot before it (the quarters fall a solar day apart):
 * ¼, ½, ¾ Helion, and the Hypopentad ends on the sync's end. The running Pentad is bright, the passed ones solid and
 * dim, the coming ones dim; the marks of the sync with the displayed time are written on the rail where there is room.
 */
function drawPentadRail(P, scene, sf, sun, fit, amp, quiet, occ) {
  const g = P.g;
  const len = sf.r * Math.abs(sf.sweep); // px per unit of progress
  if (!(len > 0)) return;
  const pentadPx = (fit.wavelength * 5) / 19;
  const spans = pentadSpans(sun.spec, sun.grid, fit.wavelength / 4 >= 40 ? null : sun.sync);
  const rail = { x: sf.x, y: sf.y, r: sf.r + amp + RAIL_OFF, a0: sf.a0, sweep: sf.sweep };
  const gapP = RAIL_GAP / len / 2;
  const small = P.fonts.small;
  g.lineCap = 'butt'; // square ends: the gap at each Pentad start stays as wide as it is meant to be
  for (const s of spans) {
    const passed = s.sync < sun.sync || (s.sync === sun.sync && s.index < sun.pentad);
    const now = s.sync === sun.sync && s.index === sun.pentad;
    const p0 = s.p0 + (s.p0 > 0 ? gapP : 0);
    const p1 = s.p1 - (s.p1 < scene.fraction ? gapP : 0);
    if (!(p1 > p0)) continue;
    g.beginPath();
    pathArc(P, rail, p0, p1);
    stroke(P, goldA(now ? 0.95 : passed ? 0.55 : 0.32), now ? 3 : 2);
    if (quiet || s.sync !== sun.sync || pentadPx < RAIL_LABEL_PX) continue;
    // the mark sits on the rail, in the middle of the Pentad's part on the arc, beyond it from the ripple
    const mid = (s.p0 + s.p1) / 2;
    const vis = (s.p1 - s.p0) * len;
    if (vis < RAIL_LABEL_PX * 0.8) continue;
    const a = sf.a0 + sf.sweep * mid;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    const r = rail.r + 9;
    const style = { color: goldA(now ? 1 : passed ? 0.7 : 0.62), font: small };
    const mw = markWidth(P, s.index, small) - fontPx(small) * MARK_GAP;
    const cx = sf.x + r * nx;
    const cy = sf.y + r * ny;
    if (cx < 8 || cy < 8 || cx > P.W - 8 || cy > P.H - 8) continue;
    occ.push({ x0: cx - mw / 2 - 2, x1: cx + mw / 2 + 2, y0: cy - 7, y1: cy + 7, w: SOFT });
    ledText(P, s.index, '', cx + (fontPx(small) * MARK_GAP) / 2, cy, style);
  }
}

/** A label next to (x, y) on the side with room, drawn in its own colour; the spot is remembered per key. */
function placeAndLabel(P, occ, key, str, x, y, nx, ny, style, clear = 8) {
  const spot = placeLabel(P, occ, key, str, x, y, nx, ny, style.font, clear, SOFT);
  text(P, str, spot.x, spot.y, style);
  return spot;
}

// ------------------------------------------------------ the Pentad mark ----

const fontPx = (font) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 12);
/** Height of a Pentad shape that sits with text of this font (a little under the cap height of the digits). */
const markSize = (font) => Math.round(fontPx(font) * 0.84 * 2) / 2;
const MARK_GAP = 0.42; // em between the mark and the text it leads
/** The width a Pentad mark (shape + numeral + the gap to the text) adds in front of a label; 0 without a Pentad. */
export function markWidth(P, index, font) {
  if (index === null || index === undefined || index < 0 || index > 3) return 0;
  const size = markSize(font);
  const num = PENTAD_NUMERALS[index];
  return size + (num ? size * 0.16 + textWidth(P, num, font) : 0) + fontPx(font) * MARK_GAP;
}
/**
 * A label led by its Pentad (SPEC §7.5), centred at (cx, cy) like `text`: the shape (a pentagon, the Hypopentad a
 * square), its numeral and the text, all with the same halo, in the label's colour.
 */
function ledText(P, index, str, cx, cy, style) {
  const mw = markWidth(P, index, style.font);
  if (!mw) return text(P, str, cx, cy, style);
  const tw = textWidth(P, str, style.font);
  const x0 = cx - (mw + tw) / 2;
  const size = markSize(style.font);
  const g = P.g;
  if (style.halo !== false) drawPentadMark(g, index, x0, cy, { size, numeral: false, color: `rgba(${PANEL}, 0.82)`, lineWidth: size * 0.125 + 3 });
  drawPentadMark(g, index, x0, cy, { size, numeral: false, color: style.color });
  const num = PENTAD_NUMERALS[index];
  if (num) text(P, num, x0 + size * 1.16, cy, { ...style, align: 'left' });
  text(P, str, x0 + mw, cy, { ...style, align: 'left' });
}

/**
 * The solar marker: a yellow pin standing on the ripple at the displayed time (its head floats off the arc, so it
 * never hides the dot of the focused level), with the sync number beside it. Pin and label fade together with the
 * ripple. Returns the head position.
 */
function drawSunPin(P, scene, sf, sun, ripple, hovered, o, occ) {
  const g = P.g;
  const pin = pinGeometry(sf, sun.spec, sun.grid, sun.pNow, ripple.amp);
  const { foot, head, nx, ny } = pin;
  const hx = head.x;
  const hy = head.y;
  if (hx < 9 || hy < 9 || hx > P.W - 9 || hy > P.H - 9) return null;
  g.save();
  g.globalAlpha *= ripple.fit.strength;
  g.beginPath();
  g.moveTo(foot.x, foot.y);
  g.lineTo(hx - nx * 4, hy - ny * 4);
  stroke(P, goldA(0.85), 1.3);
  const halo = g.createRadialGradient(hx, hy, 0, hx, hy, 12);
  halo.addColorStop(0, goldA(0.5));
  halo.addColorStop(1, goldA(0));
  g.fillStyle = halo;
  g.beginPath();
  g.arc(hx, hy, 12, 0, G.TAU);
  g.fill();
  g.beginPath();
  g.arc(hx, hy, 5.6, 0, G.TAU);
  g.fillStyle = 'rgba(7, 9, 13, 0.92)';
  g.fill();
  g.beginPath();
  g.arc(hx, hy, 4, 0, G.TAU);
  g.fillStyle = P.theme.GOLD;
  g.fill();
  if (hovered) {
    g.beginPath();
    g.arc(hx, hy, 9.5, 0, G.TAU);
    stroke(P, 'rgba(255,255,255,0.8)', 1.5);
  }
  occ.push({ x0: hx - 8, x1: hx + 8, y0: hy - 8, y1: hy + 8 });
  if (!o.quiet && sun.label) {
    const spot = placeLabel(P, occ, 'sun', sun.label, hx, hy, nx, ny, P.fonts.small, 8, 1);
    text(P, sun.label, spot.x, spot.y, { color: P.theme.GOLD, font: P.fonts.small }); // inside the save: fades with the pin
  }
  g.restore();
  return { x: hx, y: hy };
}

// ---------------------------------------------------------- focus scene ----

/**
 * Draw a focus scene: the focused half-arc, its children (numbered) and grandchildren, the
 * stretch of the parent we are in, and one marker per level joined by thin tethers (ancestors
 * that fall off the canvas are shown as lettered badges on its edge).
 * @param o {{alpha:number, cur:Array|null, markers:Array, hover:object|null, hits:object|null,
 *            grey:boolean, quiet:boolean, eventLabels:string[], letters:string[], nowLabel:string,
 *            avoid:{x0,y0,x1,y1}|null}}
 *   cur = half-arc readings per level, markers = scene markers, hits = collects hit targets,
 *   quiet = no text (outgoing scene while zooming), avoid = rectangle of controls to keep badges off
 */
export function drawFocus(P, scene, view, o) {
  const g = P.g;
  const { cur, markers, hover, hits } = o;
  const alpha = o.alpha ?? 1;
  const L = scene.level;
  const font = P.fonts;
  const is = (kind, level, idx) => hover && hover.kind === kind && hover.level === level && hover.idx === idx;
  const occ = [];
  g.save();
  g.globalAlpha = alpha;

  // ---- the parent: the stretch of its circle this arc stands on (further ancestors only get a marker)
  const anc = scene.ancestors;
  if (anc.length) {
    const a = anc[0];
    const pa = view.arc(a.arc, tmpA);
    if (visible(P, pa, 60)) {
      g.beginPath();
      pathArc(P, pa, 0, a.fraction);
      stroke(P, P.level(a.level, 0.13, 62, o.grey), 1.2);
      g.beginPath();
      pathArc(P, pa, a.slotJ / a.slotM, Math.min(a.fraction, (a.slotJ + 1) / a.slotM));
      stroke(P, P.level(a.level, 0.7, 62, o.grey), 2);
    }
  }

  // ---- grandchildren: faint, batched by state
  const cg = cur ? cur[L + 2] : null;
  if (scene.grand.length) {
    const past = [];
    const future = [];
    let now = null;
    for (const gr of scene.grand) {
      const tr = cg ? G.travelled(gr.idx, cg) : 0;
      if (cg && gr.idx === cg.idx) now = gr;
      else (tr >= 1 ? past : future).push(gr);
    }
    const drawBatch = (list, a, w) => {
      g.beginPath();
      for (const gr of list) {
        const sa = view.arc(gr.arc, tmpA);
        if (visible(P, sa)) pathArc(P, sa, 0, gr.fraction);
      }
      stroke(P, P.level(L + 2, a, 62, o.grey), w);
    };
    drawBatch(future, 0.2, 1);
    drawBatch(past, 0.42, 1.1);
    if (now) {
      const sa = view.arc(now.arc, tmpA);
      if (visible(P, sa)) {
        g.beginPath();
        pathArc(P, sa, cg.local, now.fraction);
        stroke(P, P.level(L + 2, 0.32, 62, o.grey), 1.3);
        g.beginPath();
        pathArc(P, sa, 0, Math.min(cg.local, now.fraction));
        stroke(P, P.level(L + 2, 0.95, 66, o.grey), 1.9);
      }
    }
  }

  // hit targets: the focused arc first (it wins ties), then its children
  if (hits) {
    const sf0 = view.arc(scene.focus, {});
    hits.arcs.push({ kind: 'focus', level: L, idx: scene.idx, sa: { x: sf0.x, y: sf0.y, r: sf0.r, a0: sf0.a0, sweep: sf0.sweep }, fraction: scene.fraction });
  }

  // ---- children
  const cc = cur ? cur[L + 1] : null;
  for (const c of scene.children) {
    const sa = view.arc(c.arc, tmpA);
    const copy = { x: sa.x, y: sa.y, r: sa.r, a0: sa.a0, sweep: sa.sweep };
    if (hits) hits.arcs.push({ kind: 'child', level: c.level, idx: c.idx, j: c.j, sa: copy, fraction: c.fraction });
    if (!visible(P, sa)) continue;
    const tr = cc ? G.travelled(c.idx, cc) : 0;
    const cur1 = cc && c.idx === cc.idx;
    const w = 1.9;
    if (cur1) {
      g.beginPath();
      pathArc(P, sa, Math.min(cc.local, c.fraction), c.fraction);
      stroke(P, P.level(c.level, 0.4, 64, o.grey), w);
      g.beginPath();
      pathArc(P, sa, 0, Math.min(cc.local, c.fraction));
      stroke(P, P.level(c.level, 1, 68, o.grey), w + 1);
    } else {
      g.beginPath();
      pathArc(P, sa, 0, c.fraction);
      stroke(P, P.level(c.level, tr >= 1 ? 0.78 : 0.3, tr >= 1 ? 64 : 62, o.grey), w);
    }
    if (is('child', c.level, c.idx)) {
      g.beginPath();
      pathArc(P, sa, 0, c.fraction);
      stroke(P, 'rgba(255,255,255,0.75)', w + 2);
    }
  }

  // ---- the focused arc
  const sf = view.arc(scene.focus, {});
  const fcur = cur ? cur[L] : null;
  const trF = fcur ? Math.min(scene.fraction, G.travelled(scene.idx, fcur)) : 0;
  if (visible(P, sf)) {
    g.beginPath();
    pathArc(P, sf, trF, scene.fraction);
    stroke(P, P.level(L, 0.34, 64, o.grey), 3);
    if (trF > 0) {
      g.save();
      g.shadowColor = P.level(L, 0.6, 62, o.grey);
      g.shadowBlur = 9 * P.dpr;
      g.beginPath();
      pathArc(P, sf, 0, trF);
      stroke(P, P.level(L, 1, 68, o.grey), 3.4);
      g.restore();
    }
    if (is('focus', L, scene.idx)) {
      g.beginPath();
      pathArc(P, sf, 0, scene.fraction);
      stroke(P, 'rgba(255,255,255,0.55)', 4.6);
    }
    // quarter ticks of the cycle: begin/node/end of the half-arc and its apex (peak or valley)
    const fm = markers?.find((m) => m.level === L);
    const fp = fm ? view.point(fm.x, fm.y, {}) : null;
    for (let k = 0; k < 3; k++) {
      const t = k / 2;
      if (t > scene.fraction + 1e-9) continue;
      const p = G.screenPoint(sf, t);
      const nx = (p.x - sf.x) / sf.r;
      const ny = (p.y - sf.y) / sf.r;
      g.beginPath();
      g.moveTo(p.x - nx * 6, p.y - ny * 6);
      g.lineTo(p.x + nx * 6, p.y + ny * 6);
      stroke(P, P.level(L, 0.9, 74, o.grey), 1.6);
      if (o.eventLabels && !o.quiet && !(fp && Math.hypot(p.x - fp.x, p.y - fp.y) < 22)) {
        const lab = o.eventLabels[k];
        labelAt(P, occ, lab, p.x + nx * 17, p.y + ny * 17, { color: P.theme.INK_2, font: font.small, halo: true });
      }
    }
  }

  // ---- the solar ripple rides the focused arc (the dot of the displayed time comes after the child numbers)
  const ripple = o.sun && visible(P, sf) ? drawRipple(P, scene, sf, trF, o.sun, o.quiet, occ) : null;

  // ---- child numbers (signed: + crest, − trough)
  for (const c of scene.children) {
    const sa = view.arc(c.arc, tmpB);
    if (o.quiet || sa.r < 7 || !visible(P, sa)) continue;
    const p = G.screenPoint(sa, c.fraction / 2);
    const nx = (p.x - sa.x) / sa.r;
    const ny = (p.y - sa.y) / sa.r;
    const cur1 = cc && c.idx === cc.idx;
    const lit = cur1 || is('child', c.level, c.idx);
    labelAt(P, occ, G.signedLabel(c.j + 1, c.arc.sweep), p.x + nx * 12, p.y + ny * 12, {
      color: lit ? '#fff' : P.level(c.level, 0.9, 74, o.grey),
      font: lit ? font.labelBold : font.label,
    });
  }

  // ---- the solar marker (behind the level markers)
  if (ripple && o.sun.here) {
    const head = drawSunPin(P, scene, sf, o.sun, ripple, is('sun', -1, 0), o, occ);
    if (head && hits) hits.sun = { x: head.x, y: head.y };
  }

  // ---- markers and tethers (coarse -> fine)
  if (markers && markers.length) {
    const inset = 15;
    const inside = (p) => p.x >= inset && p.x <= P.W - inset && p.y >= inset && p.y <= P.H - inset;
    const pts = [];
    for (const m of markers) {
      const p = view.point(m.x, m.y, {});
      const on = inside(p);
      pts.push({ m, x: p.x, y: p.y, in: on });
      // only a dot that is drawn is a target (a marker off the canvas is reached through its edge badge)
      if (hits && on) hits.markers.push({ level: m.level, idx: m.idx, local: m.local, x: p.x, y: p.y });
    }
    const badges = [];
    let nowAt = null;
    g.lineWidth = 1.2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a.in && !b.in) continue;
      let x0 = a.x;
      let y0 = a.y;
      let x1 = b.x;
      let y1 = b.y;
      if (!a.in) {
        [x0, y0] = dodge(clipToRect(b.x, b.y, a.x, a.y, inset, P.W, P.H), o.avoid, inset);
        badges.push({ x: x0, y: y0, level: a.m.level, idx: a.m.idx, local: a.m.local });
      } else if (!b.in) {
        [x1, y1] = dodge(clipToRect(a.x, a.y, b.x, b.y, inset, P.W, P.H), o.avoid, inset);
        badges.push({ x: x1, y: y1, level: b.m.level, idx: b.m.idx, local: b.m.local });
      }
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.strokeStyle = P.level(b.m.level, 0.6, 68, o.grey);
      g.setLineDash(b.m.level <= L ? [3, 3] : []);
      g.stroke();
    }
    g.setLineDash([]);
    // fine markers first so coarse ones stay on top of the cluster
    for (let i = pts.length - 1; i >= 0; i--) {
      const { m, x, y } = pts[i];
      if (!pts[i].in) continue;
      const emph = m.level === L;
      const size = emph ? 6.2 : m.level < L ? 4.4 : Math.max(2.2, 4 - (m.level - L) * 0.45);
      drawMarker(P, x, y, m.level, { emph, size, grey: o.grey });
      if (hover && hover.kind === 'marker' && hover.level === m.level) {
        g.beginPath();
        g.arc(x, y, size + 5, 0, G.TAU);
        stroke(P, 'rgba(255,255,255,0.8)', 1.5);
      }
      if (emph && o.nowLabel) nowAt = { x, y };
    }
    if (!o.quiet) {
      // the focus dot and the coarser ones are fixed points for the labels; the finer levels orbit the focus
      // dot several times a second, and a label that dodged them would never keep still
      for (const q of pts) if (q.in && q.m.level <= L) occ.push({ x0: q.x - 9, x1: q.x + 9, y0: q.y - 9, y1: q.y + 9 });
      // colour alone must not name a level: a dot away from the focus marker carries its letter
      const fp0 = pts.find((q) => q.m.level === L && q.in);
      if (fp0 && o.letters) {
        for (const q of pts) {
          const letter = o.letters[q.m.level];
          if (!letter || !q.in || q.m.level === L || Math.hypot(q.x - fp0.x, q.y - fp0.y) < 56) continue;
          const c = view.point(q.m.arc.center.x, q.m.arc.center.y, {});
          const len = Math.hypot(q.x - c.x, q.y - c.y) || 1;
          const spot = placeLabel(P, occ, 'lv' + q.m.level, letter, q.x, q.y, (q.x - c.x) / len, (q.y - c.y) / len, font.labelBold, 8, SOFT);
          text(P, letter, spot.x, spot.y, { color: P.level(q.m.level, 1, 74, o.grey), font: font.labelBold });
        }
      }
    }
    if (nowAt && !o.quiet) {
      // the displayed time next to the focus marker, on the side with room
      const nx = (nowAt.x - sf.x) / (sf.r || 1);
      const ny = (nowAt.y - sf.y) / (sf.r || 1);
      const len = Math.hypot(nx, ny) || 1;
      // led by its Pentad, like a date by its weekday (SPEC §7.5)
      const mw = markWidth(P, o.nowPentad, font.labelBold);
      const spot = placeLabel(P, occ, 'now', o.nowLabel, nowAt.x, nowAt.y, nx / len, ny / len, font.labelBold, 12, 1, mw);
      ledText(P, o.nowPentad, o.nowLabel, spot.x, spot.y, { color: '#fff', font: font.labelBold });
    }
    for (const b of badges) {
      if (hits) hits.markers.push({ level: b.level, idx: b.idx, local: b.local, x: b.x, y: b.y, badge: true });
      g.beginPath();
      g.arc(b.x, b.y, 9.5, 0, G.TAU);
      g.fillStyle = 'rgba(11, 16, 21, 0.92)';
      g.fill();
      stroke(P, P.level(b.level, 0.95, 66, o.grey), 1.4);
      text(P, o.letters ? o.letters[b.level] : '', b.x, b.y + 0.5, { color: P.level(b.level, 1, 74, o.grey), font: font.labelBold, halo: false });
      if (hover && hover.kind === 'marker' && hover.level === b.level) {
        g.beginPath();
        g.arc(b.x, b.y, 13, 0, G.TAU);
        stroke(P, 'rgba(255,255,255,0.8)', 1.5);
      }
    }
  }
  g.restore();
}

// ------------------------------------------------------------- overview ----

/**
 * Draw the catalogue overview: the 35 level-0 half-arcs wrapped into rows, their level-1/2
 * children faintly, eclipse instants with their years, and the markers of the first levels.
 * @param o {{alpha:number, cur:Array|null, markers:Array, hover:object|null, hits:object|null,
 *            grey:boolean, quiet:boolean, years:string[], endYear:string, nowLabel:string,
 *            edge:{before:boolean}|undefined}}   edge = mark the catalogue end the displayed time lies beyond
 */
export function drawOverview(P, ov, view, o) {
  const g = P.g;
  const occ = [];
  const { cur, hover, hits } = o;
  const grey = !!o.grey;
  const k = view.k;
  const font = P.fonts;
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  const alphaArcs = ov.levels[0];

  // a dotted baseline per row, so the crests and troughs read as one wave
  g.setLineDash([2, 6]);
  g.beginPath();
  for (let row = 0; row < ov.layout.rows; row++) {
    const a = view.point(0, row * ov.layout.rowPitch, {});
    const b = view.point(2 * ov.layout.cols, row * ov.layout.rowPitch, {});
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
  }
  stroke(P, 'rgba(163, 177, 191, 0.12)', 1);
  g.setLineDash([]);

  // faint structure first: level 2, then level 1
  for (let l = 2; l >= 1; l--) {
    const list = ov.levels[l];
    const r = list[0].arc.radius * k;
    if (r < 1.1) continue;
    const curH = cur ? cur[l] : null;
    const past = [];
    const future = [];
    for (const e of list) {
      const sa = view.arc(e.arc, tmpA);
      if (!visible(P, sa)) continue;
      const tr = curH ? G.travelled(e.idx, curH) : 0;
      (tr >= 1 ? past : future).push(e);
    }
    const batch = (arr, a, w) => {
      g.beginPath();
      for (const e of arr) pathArc(P, view.arc(e.arc, tmpA), 0, e.fraction);
      stroke(P, P.level(l, a, 62, grey), w);
    };
    batch(future, l === 1 ? 0.28 : 0.15, 1);
    batch(past, l === 1 ? 0.55 : 0.3, 1);
  }

  // level 0: past brighter, future dim, current thick
  const cur0 = cur ? cur[0] : null;
  const past0 = [];
  const future0 = [];
  for (const e of alphaArcs) {
    if (cur0 && e.idx === cur0.idx) continue;
    const sa = view.arc(e.arc, tmpA);
    if (hits) hits.arcs.push({ kind: 'alpha', level: 0, idx: e.idx, sa: { x: sa.x, y: sa.y, r: sa.r, a0: sa.a0, sweep: sa.sweep }, fraction: e.fraction });
    ((cur0 ? G.travelled(e.idx, cur0) : 0) >= 1 ? past0 : future0).push(e);
  }
  const batch0 = (arr, a, w) => {
    g.beginPath();
    for (const e of arr) pathArc(P, view.arc(e.arc, tmpA), 0, e.fraction);
    stroke(P, P.level(0, a, 66, grey), w);
  };
  batch0(future0, 0.4, 2);
  batch0(past0, 0.85, 2.2);
  const hov0 = hover && hover.kind === 'alpha' ? alphaArcs[hover.idx] : null;
  if (hov0) {
    g.beginPath();
    pathArc(P, view.arc(hov0.arc, tmpA), 0, hov0.fraction);
    stroke(P, 'rgba(255,255,255,0.6)', 4);
  }
  if (cur0) {
    const e = alphaArcs[cur0.idx];
    const sa = view.arc(e.arc, tmpA);
    if (hits) hits.arcs.push({ kind: 'alpha', level: 0, idx: e.idx, sa: { x: sa.x, y: sa.y, r: sa.r, a0: sa.a0, sweep: sa.sweep }, fraction: e.fraction });
    g.beginPath();
    pathArc(P, sa, cur0.local, e.fraction);
    stroke(P, P.level(0, 0.45, 66, grey), 3);
    g.save();
    g.shadowColor = P.level(0, 0.7, 62, grey);
    g.shadowBlur = 10 * P.dpr;
    g.beginPath();
    pathArc(P, sa, 0, Math.min(cur0.local, e.fraction));
    stroke(P, P.level(0, 1, 70, grey), 3.6);
    g.restore();
    // the level-1 half-arc we are inside, thicker
    const c1 = cur[1];
    const e1 = ov.levels[1][c1.idx];
    if (e1) {
      const s1 = view.arc(e1.arc, tmpA);
      g.beginPath();
      pathArc(P, s1, c1.local, e1.fraction);
      stroke(P, P.level(1, 0.5, 66, grey), 2);
      g.beginPath();
      pathArc(P, s1, 0, Math.min(c1.local, e1.fraction));
      stroke(P, P.level(1, 1, 68, grey), 2.6);
    }
  }

  // eclipse instants: even ordinals sit on the baseline (labelled with their year), odd ones on the crest / trough
  const small = font.small;
  const stepLabel = k * 2 < 46 ? 2 : 1;
  const dotCol = grey ? 'rgba(160,175,190,0.6)' : P.theme.INK_2;
  const midCol = grey ? 'rgba(160,175,190,0.4)' : INK_3;
  for (const e of alphaArcs) {
    const sa = view.arc(e.arc, tmpA);
    const p0 = G.screenPoint(sa, 0);
    g.beginPath();
    g.arc(p0.x, p0.y, 2.2, 0, G.TAU);
    g.fillStyle = dotCol;
    g.fill();
    if (o.years && e.idx % stepLabel === 0) {
      // the label goes on the side of the junction where no arc runs: under a crest, over a trough
      const crest = e.idx % 2 === 0;
      labelAt(P, occ, o.years[e.idx], p0.x + 4, p0.y + (crest ? 12 : -11), { color: INK_3, font: small, align: 'left', haloWidth: 3 });
    }
    if (e.fraction >= 0.5) {
      const pm = G.screenPoint(sa, 0.5);
      g.beginPath();
      g.arc(pm.x, pm.y, 1.6, 0, G.TAU);
      g.fillStyle = midCol;
      g.fill();
    }
    if (e.fraction < 1) {
      const pe = G.screenPoint(sa, e.fraction);
      g.beginPath();
      g.arc(pe.x, pe.y, 2.2, 0, G.TAU);
      g.fillStyle = dotCol;
      g.fill();
      if (o.years) labelAt(P, occ, o.endYear, pe.x + 5, pe.y + (e.idx % 2 === 0 ? -11 : 12), { color: INK_3, font: small, align: 'left', haloWidth: 3 });
    }
  }

  // markers of the levels that are big enough to see, joined by tethers
  const mk = o.markers || [];
  if (mk.length) {
    const pts = [];
    for (const m of mk) {
      const p = view.point(m.x, m.y, {});
      pts.push({ m, x: p.x, y: p.y });
      if (hits) hits.markers.push({ level: m.level, idx: m.idx, local: m.local, x: p.x, y: p.y });
    }
    g.lineWidth = 1.2;
    for (let i = 1; i < pts.length; i++) {
      g.beginPath();
      g.moveTo(pts[i - 1].x, pts[i - 1].y);
      g.lineTo(pts[i].x, pts[i].y);
      g.strokeStyle = P.level(pts[i].m.level, 0.7, 68, grey);
      g.stroke();
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const { m, x, y } = pts[i];
      const emph = m.level === 0;
      drawMarker(P, x, y, m.level, { emph, size: emph ? 6 : Math.max(2.4, 4.2 - m.level * 0.8), grey });
      if (hover && hover.kind === 'marker' && hover.level === m.level) {
        g.beginPath();
        g.arc(x, y, 11, 0, G.TAU);
        stroke(P, 'rgba(255,255,255,0.8)', 1.5);
      }
    }
    if (o.nowLabel && !o.quiet && pts.length) {
      const q = pts[0];
      occ.push({ x0: q.x - 10, x1: q.x + 10, y0: q.y - 10, y1: q.y + 10 });
      const mw = markWidth(P, o.nowPentad, font.labelBold);
      const spot = placeLabel(P, occ, 'now-all', o.nowLabel, q.x, q.y, 0, -1, font.labelBold, 12, 1, mw);
      ledText(P, o.nowPentad, o.nowLabel, spot.x, spot.y, { color: '#fff', font: font.labelBold });
    }
  }
  if (o.edge && !o.quiet) {
    const e = o.edge.before ? alphaArcs[0] : alphaArcs[alphaArcs.length - 1];
    const p = G.screenPoint(view.arc(e.arc, tmpA), o.edge.before ? 0 : e.fraction);
    drawEdgeMarker(P, occ, p.x, p.y, o.edge.before ? 'before the first eclipse' : 'after the last eclipse');
  }
  g.restore();
}

/**
 * A ring and a caption at a catalogue edge: where the displayed time is when it is out of range.
 * The caption sits on a small panel, on the side of the ring that has room, clear of the year labels.
 */
function drawEdgeMarker(P, occ, x, y, label) {
  const g = P.g;
  g.save();
  g.beginPath();
  g.arc(x, y, 8, 0, G.TAU);
  stroke(P, P.theme.NOW, 2);
  g.beginPath();
  g.arc(x, y, 3, 0, G.TAU);
  g.fillStyle = P.theme.NOW;
  g.fill();
  const hard = occ.map((r) => ({ ...r, w: 1 }));
  const spot = placeLabel(P, hard, 'edge', label, x, y, 0, -1, P.fonts.labelBold, 12);
  const w = textWidth(P, label, P.fonts.labelBold) + 12;
  g.beginPath();
  g.roundRect ? g.roundRect(spot.x - w / 2, spot.y - 10, w, 20, 6) : g.rect(spot.x - w / 2, spot.y - 10, w, 20);
  g.fillStyle = 'rgba(11, 16, 21, 0.92)';
  g.fill();
  text(P, label, spot.x, spot.y, { color: P.theme.NOW, font: P.fonts.labelBold, halo: false });
  g.restore();
}
