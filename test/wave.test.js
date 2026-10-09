import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createFormatter } from '../src/core/format.js';
import * as theme from '../src/core/theme.js';
import * as G from '../src/ui/wave/geometry.js';
import { createEngine, LAND } from '../src/ui/wave/scene.js';
import { createPainter, drawFocus, placeLabel } from '../src/ui/wave/draw.js';
import { followableLevel, sanitizeLevel, throughOf, zoomEnabled, zoomPlan } from '../src/ui/wave/nav.js';
import { countdownText, cycleText, floorPercent, glyphState, instantText, loopHint, loopText, nextLines, roundMs, spanText, tipHTML, whenText } from '../src/ui/wave/tooltip.js';
import fs from 'node:fs';

const model = createModel();
const clock = model.clock;
const eng = createEngine(model);
const fmt = createFormatter(() => 'UTC');
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b} (±${eps})`);

const TIMES = {
  A: 1791460800, // 2026-10-08T12:00Z, SPEC vector A
  B: 946684800, // 2000-01-01
  C: 2886085800, // 2061-06-15
  early: model.tMin + 5,
  late: model.tMax - 5,
  mid: 1234567890.123,
};

// ---------------------------------------------------------------- arcs ----

test('pointOnArc: the level-0 half-arcs are a crest and a trough on the baseline', () => {
  const crest = clock.arc(0, 0);
  const trough = clock.arc(0, 1);
  const p0 = G.pointOnArc(crest, 0);
  const pm = G.pointOnArc(crest, 0.5);
  const p1 = G.pointOnArc(crest, 1);
  near(p0.x, 0, 1e-12);
  near(p0.y, 0, 1e-12);
  near(pm.x, 1, 1e-12);
  near(pm.y, -1, 1e-12, 'crest apex points up (y grows downwards)');
  near(p1.x, 2, 1e-12);
  near(p1.y, 0, 1e-12);
  near(G.pointOnArc(trough, 0.5).y, 1, 1e-12, 'trough apex points down');
  assert.ok(crest.sweep > 0 && trough.sweep < 0);
});

test('arcBounds covers the semicircle', () => {
  const b = G.arcBounds(clock.arc(0, 0), 0, 1, 96);
  near(b.x0, 0, 1e-9);
  near(b.x1, 2, 1e-9);
  near(b.y0, -1, 1e-3);
  near(b.y1, 0, 1e-9);
});

test('wrapPi keeps angles in [-pi, pi)', () => {
  for (const a of [0, 1, -1, 3.5, -3.5, 7, -7, 100, Math.PI, -Math.PI]) {
    const w = G.wrapPi(a);
    assert.ok(w >= -Math.PI && w < Math.PI, String(w));
    near(Math.cos(w), Math.cos(a), 1e-9);
    near(Math.sin(w), Math.sin(a), 1e-9);
  }
});

test('sweep sign is the parity of the half-arc index (even = crest = +)', () => {
  for (const L of [1, 2, 3, 5, 8, 11]) {
    for (const i of [0n, 1n, 2n, 3n, 10n, 11n, 100n, 101n]) {
      const a = clock.arc(L, i);
      assert.equal(a.sweep > 0, i % 2n === 0n, `level ${L} index ${i}`);
    }
  }
});

test('a half-arc is followed by its children as a continuous chain from its start to its end', () => {
  for (const [L, idx] of [[0, 11], [1, 57], [3, 3725], [6, 1434423], [9, 258196253]]) {
    const scene = eng.buildFocus(L, idx);
    assert.equal(scene.children.length, eng.factor(L));
    const first = G.pointOnArc(scene.children[0].arc, 0);
    const last = G.pointOnArc(scene.children.at(-1).arc, 1);
    const s = G.pointOnArc(scene.focus, 0);
    const e = G.pointOnArc(scene.focus, 1);
    near(first.x, s.x, 1e-9, `L${L} first child starts at the arc start`);
    near(first.y, s.y, 1e-9);
    near(last.x, e.x, 1e-9, `L${L} last child ends at the arc end`);
    near(last.y, e.y, 1e-9);
    for (let j = 0; j + 1 < scene.children.length; j++) {
      const a = G.pointOnArc(scene.children[j].arc, 1);
      const b = G.pointOnArc(scene.children[j + 1].arc, 0);
      near(a.x, b.x, 1e-9, `L${L} children ${j}/${j + 1} join`);
      near(a.y, b.y, 1e-9);
    }
    // every division point lies on the parent circle
    for (const c of scene.children) {
      const p = G.pointOnArc(c.arc, 0);
      near(Math.hypot(p.x, p.y), 1, 1e-9, 'division point is on the focus circle');
    }
  }
});

test('focus frame: the focused arc is the unit circle at the origin', () => {
  const s = eng.buildFocus(5, 130402);
  assert.deepEqual([s.focus.center.x, s.focus.center.y, s.focus.radius], [0, 0, 1]);
  near(s.focus.start, clock.arc(5, 130402n).start, 1e-12, 'start angle is global');
  near(s.focus.sweep, clock.arc(5, 130402n).sweep, 1e-12);
});

test('ancestor arcs seen from the focus frame pass through the focus arc endpoints', () => {
  for (const [L, idx] of [[1, 57], [4, 18628], [7, 12909812], [10, 3356551292]]) {
    const s = eng.buildFocus(L, idx);
    assert.ok(s.ancestors.length >= 1);
    const parent = s.ancestors[0];
    for (const t of [0, 1]) {
      const p = G.pointOnArc(s.focus, t);
      const d = Math.hypot(p.x - parent.arc.center.x, p.y - parent.arc.center.y);
      near(d / parent.arc.radius, 1, 1e-7, `L${L} parent circle through focus endpoint ${t}`);
    }
    // and the slot the focus sits in is bounded by those same two points
    const m = parent.slotM;
    const a = G.pointOnArc(parent.arc, parent.slotJ / m);
    const b = G.pointOnArc(parent.arc, (parent.slotJ + 1) / m);
    const s0 = G.pointOnArc(s.focus, 0);
    const s1 = G.pointOnArc(s.focus, 1);
    near(a.x, s0.x, 1e-6 * Math.max(1, parent.arc.radius), 'slot start');
    near(a.y, s0.y, 1e-6 * Math.max(1, parent.arc.radius));
    near(b.x, s1.x, 1e-6 * Math.max(1, parent.arc.radius), 'slot end');
    near(b.y, s1.y, 1e-6 * Math.max(1, parent.arc.radius));
  }
});

// --------------------------------------------------------------- markers ----

test('half-arc readings: marker progress = phase of the half-cycle (levels 0..13)', () => {
  for (const t of Object.values(TIMES)) {
    const f = model.frame(t);
    const cur = eng.readHalves(f);
    for (let L = 0; L <= 13; L++) {
      const r = f.level(L);
      const h = cur[L];
      assert.equal(h.idx, r.cycle * 2 + (r.phase >= 0.5 ? 1 : 0), `level ${L} half-arc index at t=${t}`);
      near(h.local, r.phase * 2 - (r.phase >= 0.5 ? 1 : 0), 1e-12, `level ${L} local`);
      // the half-arc is the one the library calls the current half-period at that level
      const per = clock.periodAtTime(t, L, 'half');
      assert.equal(per.index, BigInt(h.idx), `level ${L} matches clock.periodAtTime(...,'half')`);
    }
  }
});

test('the chain of half-arcs is consistent: children are parent*m + j and progress nests', () => {
  for (const t of Object.values(TIMES)) {
    const cur = eng.readHalves(model.frame(t));
    for (let L = 0; L < 13; L++) {
      const m = eng.factor(L);
      const p = G.parentOf(cur[L + 1].idx, cur[L + 1].local, m);
      assert.equal(p.idx, cur[L].idx, `level ${L + 1} lies inside level ${L} at t=${t}`);
      near(p.local, cur[L].local, 1e-9, `progress of level ${L} follows from level ${L + 1}`);
      const c = G.childOf(cur[L].idx, cur[L].local, m);
      assert.equal(c.idx, cur[L + 1].idx);
      near(c.local, cur[L + 1].local, 1e-6 * 13 ** Math.max(0, L - 6));
    }
  }
});

test('markers sit on the library arcs at the phase of their half-cycle (matches clock.compose)', () => {
  const noop = () => {};
  const g = new Proxy({ canvas: { width: 9000, height: 9000 } }, { get: (o, k) => (k in o ? o[k] : noop), set: (o, k, v) => ((o[k] = v), true) });
  for (const [t, L] of [[TIMES.A, 3], [TIMES.A, 6], [TIMES.B, 4], [TIMES.C, 2], [TIMES.mid, 5]]) {
    const f = model.frame(t);
    const cur = eng.readHalves(f);
    const scene = eng.buildFocus(L, cur[L].idx);
    const mine = eng.markersFor(scene, cur);
    const res = clock.compose(g, {
      position: clock.positionAt(F_rational(t)),
      focus: { level: L, index: BigInt(cur[L].idx) },
      levels: 5,
      minRadius: 1e-9,
      maxArcs: 100000,
    });
    for (const m of res.markers) {
      const mm = mine.find((x) => x.level === m.level);
      assert.ok(mm, `marker for level ${m.level}`);
      assert.equal(String(m.index), String(mm.idx), `same half-arc at level ${m.level}`);
      near(m.progress, mm.local, 1e-6, `level ${m.level} progress`);
      near(m.point.x, mm.x, 1e-7, `level ${m.level} x`);
      near(m.point.y, mm.y, 1e-7, `level ${m.level} y`);
    }
    assert.ok(res.markers.length >= 4, 'compose found the nested markers');
  }
});
function F_rational(x) {
  return globalThis.Fractonica.rational(String(x));
}

test('ancestor markers agree with the absolute wave once mapped through toAlpha', () => {
  for (const [t, L] of [[TIMES.A, 4], [TIMES.A, 8], [TIMES.B, 6], [TIMES.C, 5], [TIMES.mid, 7]]) {
    const cur = eng.readHalves(model.frame(t));
    const scene = eng.buildFocus(L, cur[L].idx);
    const mine = eng.markersFor(scene, cur);
    const c0 = clock.arc(0, BigInt(cur[0].idx)).center;
    const anc = mine.filter((x) => x.level < L);
    assert.equal(anc.length, Math.min(L, 4), `L${L}: one marker for each of the (up to four) ancestors`);
    for (const m of anc) {
      // absolute position of the marker of level m.level
      const abs = G.pointOnArc(clock.arc(m.level, BigInt(m.idx)), m.local);
      // focus frame -> alpha frame (translate + scale) -> absolute (alpha arc centre)
      const a = { x: scene.toAlpha.x + scene.toAlpha.k * m.x + c0.x, y: scene.toAlpha.y + scene.toAlpha.k * m.y + c0.y };
      near(a.x, abs.x, 1e-8, `L${L} ancestor ${m.level} x`);
      near(a.y, abs.y, 1e-8, `L${L} ancestor ${m.level} y`);
    }
  }
});

test('a marker never leaves its arc: the marker of every drawn level is at the right distance from its centre', () => {
  const cur = eng.readHalves(model.frame(TIMES.A));
  const scene = eng.buildFocus(6, cur[6].idx);
  for (const m of eng.markersFor(scene, cur)) {
    near(Math.hypot(m.x - m.arc.center.x, m.y - m.arc.center.y), m.arc.radius, 1e-9 * Math.max(1, m.arc.radius), `level ${m.level}`);
  }
  // levels run coarse to fine, focus included
  const levels = eng.markersFor(scene, cur).map((m) => m.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
  assert.ok(levels.includes(6));
});

test('levelMarkers: each level\'s marker lies on its own arc at the phase of its half-cycle', () => {
  for (const t of [TIMES.A, TIMES.B, TIMES.C, TIMES.mid]) {
    const f = model.frame(t);
    const cur = eng.readHalves(f);
    const list = [];
    for (let L = 0; L <= 9; L++) list.push({ level: L, idx: cur[L].idx, local: cur[L].local, arc: clock.arc(L, BigInt(cur[L].idx)) });
    const marks = G.levelMarkers(list);
    assert.equal(marks.length, 10);
    for (const m of marks) {
      const r = f.level(m.level);
      // distance to the arc centre is the arc radius: the marker is on the circle ...
      near(Math.hypot(m.x - m.arc.center.x, m.y - m.arc.center.y), m.arc.radius, 1e-12, `level ${m.level} on its circle`);
      // ... at the angle of the phase of its half-cycle (phase of the cycle * 2, minus the half we are in)
      const wantLocal = r.phase * 2 - (r.phase >= 0.5 ? 1 : 0);
      near(m.local, wantLocal, 1e-12, `level ${m.level} progress = phase of the half-cycle`);
      const ang = Math.atan2(m.y - m.arc.center.y, m.x - m.arc.center.x);
      near(G.wrapPi(ang - (m.arc.start + m.arc.sweep * wantLocal)), 0, 1e-9, `level ${m.level} angle`);
    }
  }
});

test('no markers when the displayed time is outside the scene', () => {
  const cur = eng.readHalves(model.frame(TIMES.A));
  const other = eng.buildFocus(6, cur[6].idx + 5);
  assert.deepEqual(eng.markersFor(other, cur), []);
  assert.equal(eng.readHalves(model.frame(model.tMax + 10)), null);
});

// ---------------------------------------------------------- time mapping ----

test('half-arc spans match the model cycles (begin / node / end events)', () => {
  for (const t of [TIMES.A, TIMES.B, TIMES.C, TIMES.mid]) {
    const cur = eng.readHalves(model.frame(t));
    for (const L of [0, 1, 3, 6, 9]) {
      const idx = cur[L].idx;
      const cyc = model.cycleByIndex(L, Math.floor(idx / 2));
      const ev = Object.fromEntries(cyc.events.map((e) => [e.name, e.time]));
      const d = eng.describe(L, idx);
      const wantStart = idx % 2 === 0 ? ev.begin : ev.middleNode;
      const wantEnd = idx % 2 === 0 ? ev.middleNode : ev.end;
      near(d.start, wantStart, 1e-3, `level ${L} start`);
      near(d.end, wantEnd, 1e-3, `level ${L} end`);
    }
  }
});

test('timeAt inverts the half-arc reading', () => {
  for (const L of [0, 2, 5, 8, 10]) {
    const cur = eng.readHalves(model.frame(TIMES.A));
    const idx = cur[L].idx;
    for (const p of [0.05, 0.3, 0.5, 0.77, 0.95]) {
      const t = eng.timeAt(L, idx, p);
      const back = eng.readHalves(model.frame(t))[L];
      assert.equal(back.idx, idx, `level ${L} p=${p}`);
      near(back.local, p, 2e-3 / Math.max(1, eng.halfSpan(L, idx).duration) + 1e-6, `level ${L} p=${p}`);
    }
  }
});

test('the exact first and last instants of the catalogue map to valid half-arcs at every level', () => {
  for (const t of [model.tMin, model.tMax]) {
    const f = model.frame(t);
    const cur = eng.readHalves(f);
    assert.ok(cur, 'in range');
    for (let L = 0; L <= 15; L++) {
      assert.ok(cur[L].idx >= 0 && cur[L].idx < eng.halfCount(L), `level ${L} index ${cur[L].idx} of ${eng.halfCount(L)} at ${t}`);
      assert.ok(cur[L].local >= 0 && cur[L].local <= 1);
      if (L <= 12) assert.doesNotThrow(() => eng.buildFocus(L, cur[L].idx), `scene for level ${L}`);
    }
  }
  const end = eng.readHalves(model.frame(model.tMax));
  // the end of the catalogue is the end of the clipped last alpha half-arc (half of its nominal sweep)
  near(end[0].local, 0.5, 1e-9);
});

test('the last half-arc of the catalogue is clipped to half its nominal sweep', () => {
  assert.equal(eng.fractionOf(0, 34), 0.5);
  assert.equal(eng.fractionOf(0, 33), 1);
  const d = eng.describe(0, 34);
  assert.equal(d.clipped, true);
  near(d.end, model.tMax, 1e-6);
  assert.equal(eng.halfCount(0), 35);
  const s = eng.buildFocus(0, 34);
  assert.ok(s.children.length < 5 && s.children.length > 0);
  assert.ok(s.children.every((c) => c.fraction > 0));
  // children never exist beyond the catalogue
  assert.ok(s.children.every((c) => c.idx < eng.halfCount(1)));
});

test('describe(): signed index = 1-based local index with the sign of the crest / trough', () => {
  const d = eng.describe(2, 745); // 745 = 57*13 + 4 -> the 5th child of its parent, odd -> trough
  assert.equal(d.n, 5);
  assert.equal(d.of, 13);
  assert.equal(d.crest, false);
  assert.equal(d.signed, '\u22125');
  assert.equal(eng.describe(1, 57).signed, '\u22123'); // 57 = 11*5 + 2: third child of its alpha half-arc
  assert.equal(eng.describe(0, 0).signed, '+1');
  assert.equal(eng.describe(0, 1).signed, '\u22122');
  const ch = eng.buildFocus(0, 0).children;
  assert.deepEqual(ch.map((c) => G.signedLabel(c.j + 1, c.arc.sweep)), ['+1', '\u22122', '+3', '\u22124', '+5']);
});

test('glyphIndexAt reproduces the phase glyph of the model', () => {
  for (const t of [TIMES.A, TIMES.B, TIMES.C, TIMES.mid]) {
    const f = model.frame(t);
    const cur = eng.readHalves(f);
    for (let L = 0; L <= 9; L++) {
      const idx = G.glyphIndexAt(cur[L].idx, cur[L].local);
      assert.equal(idx, f.level(L).index, `level ${L} at t=${t}`);
    }
  }
  assert.equal(G.glyphIndexAt(0, 0), 0);
  assert.equal(G.glyphIndexAt(1, 0), 8);
  assert.equal(G.glyphIndexAt(1, 0.999), 15);
  assert.equal(G.glyphIndexAt(0, 0.5, 3), 13); // 3 strokes: M = 13, 4M = 52
});

// ------------------------------------------------------------- camera ----

test('viewRotation turns every focused arc to a crest (up) or a trough (down)', () => {
  for (const [L, idx] of [[0, 4], [0, 5], [1, 57], [1, 56], [3, 3725], [6, 1434423], [6, 1434424], [9, 258196253]]) {
    const a = eng.buildFocus(L, idx).focus;
    const rot = G.viewRotation(a);
    const mid = a.start + a.sweep / 2 + rot;
    near(Math.cos(mid), 0, 1e-9, `L${L} i${idx} horizontal component of the apex direction`);
    near(Math.sin(mid), a.sweep > 0 ? -1 : 1, 1e-9, `L${L} i${idx} apex direction`);
  }
});

test('fitCamera keeps every point inside the canvas, padded, and centred', () => {
  const s = eng.buildFocus(4, 18628);
  for (const [W, H] of [[742, 526], [368, 440], [1400, 700], [360, 360]]) {
    const pad = { l: 46, r: 46, t: 44, b: 40 };
    const cam = G.fitCamera(s.samples, s.rot, W, H, pad);
    const view = G.makeView(cam, W, H);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < s.samples.length; i += 2) {
      const p = view.point(s.samples[i], s.samples[i + 1]);
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    assert.ok(x0 >= pad.l - 1e-6 && x1 <= W - pad.r + 1e-6 && y0 >= pad.t - 1e-6 && y1 <= H - pad.b + 1e-6, `${W}x${H}: ${x0},${x1},${y0},${y1}`);
    // it touches at least one limit (the fit is tight) and is centred on the other axis
    const tight = Math.abs(x1 - x0 - (W - pad.l - pad.r)) < 1e-6 || Math.abs(y1 - y0 - (H - pad.t - pad.b)) < 1e-6;
    assert.ok(tight, 'tight fit');
    near((x0 + x1) / 2, pad.l + (W - pad.l - pad.r) / 2, 1e-6, 'centred horizontally');
    near((y0 + y1) / 2, pad.t + (H - pad.t - pad.b) / 2, 1e-6, 'centred vertically');
  }
});

test('lerpCamera: end points, and what is fixed on screen stays fixed along the zoom', () => {
  const a = { cx: 0.3, cy: -0.2, scale: 120, rot: 0.4 };
  const b = { cx: 0.31, cy: -0.17, scale: 2600, rot: -2.9 };
  const e0 = G.lerpCamera(a, b, 0);
  const e1 = G.lerpCamera(a, b, 1);
  for (const k of ['cx', 'cy', 'scale']) {
    near(e0[k], a[k], 1e-12);
    near(e1[k], b[k], 1e-9);
  }
  near(G.wrapPi(e1.rot - b.rot), 0, 1e-12);
  // pure zoom (no rotation): the point that sits at the same pixel in both cameras stays there
  const a2 = { cx: 0, cy: 0, scale: 100, rot: 0 };
  const b2 = { cx: 0.5, cy: 0.25, scale: 1000, rot: 0 };
  // fixed point F: 100*(F - c_a) = 1000*(F - c_b)
  const F = { x: (1000 * b2.cx - 100 * a2.cx) / 900, y: (1000 * b2.cy - 100 * a2.cy) / 900 };
  const px = (cam) => ({ x: 400 + cam.scale * (F.x - cam.cx), y: 300 + cam.scale * (F.y - cam.cy) });
  const ref = px(a2);
  for (const e of [0.1, 0.3, 0.5, 0.8, 0.95]) {
    const q = px(G.lerpCamera(a2, b2, e));
    near(q.x, ref.x, 1e-6, `e=${e}`);
    near(q.y, ref.y, 1e-6);
  }
  // scale is monotone and geometric
  let prev = 0;
  for (let i = 0; i <= 10; i++) {
    const s = G.lerpCamera(a2, b2, i / 10).scale;
    assert.ok(s >= prev);
    prev = s;
  }
  near(G.lerpCamera(a2, b2, 0.5).scale, Math.sqrt(100 * 1000), 1e-6);
});

test('frame maps: cameraToFrame and cameraFromFrame are inverse and agree with the point map', () => {
  const cam = { cx: 0.12, cy: -0.4, scale: 250, rot: 1.1 };
  const o = { x: 3.2, y: -0.7 };
  const k = 0.048;
  const back = G.cameraFromFrame(G.cameraToFrame(cam, o, k), o, k);
  for (const key of ['cx', 'cy', 'scale', 'rot']) near(back[key], cam[key], 1e-9, key);
  // a point seen through both representations lands on the same pixel
  const p = { x: 0.2, y: 0.1 }; // in frame X
  const pY = { x: o.x + k * p.x, y: o.y + k * p.y };
  const sx = G.makeView(cam, 700, 500).point(p.x, p.y);
  const sy = G.makeView(G.cameraToFrame(cam, o, k), 700, 500).point(pY.x, pY.y);
  near(sx.x, sy.x, 1e-6);
  near(sx.y, sy.y, 1e-6);
});

test('two focus scenes of one level-0 ancestor map into each other consistently', () => {
  // the focus frame of a child, expressed in the parent frame, must put the child's circle where the library puts it
  const parent = eng.buildFocus(2, 745);
  const kid = parent.children[2];
  const kidScene = eng.buildFocus(kid.level, kid.idx);
  // p_alpha = a + k p for both; so child -> parent map is (aK - aP)/kP + (kK/kP) p
  const A = kidScene.toAlpha;
  const B = parent.toAlpha;
  const map = { x: (A.x - B.x) / B.k, y: (A.y - B.y) / B.k, k: A.k / B.k };
  near(map.x, kid.arc.center.x, 1e-9, 'centre x');
  near(map.y, kid.arc.center.y, 1e-9, 'centre y');
  near(map.k, kid.arc.radius, 1e-9, 'radius');
});

// ---------------------------------------------------------- hit testing ----

test('nearestOnArc finds the progress of points on an arc, in both sweep directions', () => {
  for (const arc of [clock.arc(0, 0), clock.arc(0, 1), eng.buildFocus(3, 3725).children[1].arc, eng.buildFocus(3, 3725).focus]) {
    const view = G.makeView({ cx: 0.2, cy: -0.1, scale: 180, rot: 0.7 }, 800, 600);
    const sa = view.arc(arc);
    for (const t of [0, 0.1, 0.37, 0.5, 0.92, 1]) {
      const p = G.screenPoint(sa, t);
      const n = G.nearestOnArc(sa, p.x, p.y);
      near(n.t, t, 1e-6, `t=${t}`);
      near(n.dist, 0, 1e-6);
    }
    // a point 10 px outside the circle at t=0.5
    const p = G.screenPoint(sa, 0.5);
    const out = { x: sa.x + (p.x - sa.x) * (1 + 10 / sa.r), y: sa.y + (p.y - sa.y) * (1 + 10 / sa.r) };
    near(G.nearestOnArc(sa, out.x, out.y).dist, 10, 1e-6);
  }
});

test('nearestOnArc clamps to the ends of a clipped arc', () => {
  // the arc runs from angle 0 (right of the centre) round the bottom (y grows downwards) to angle pi (left)
  const sa = { x: 100, y: 100, r: 50, a0: 0, sweep: Math.PI };
  // above the circle there is no arc: the nearer end wins, on either side of the middle
  const nearStart = G.nearestOnArc(sa, 170, 70, 1);
  assert.equal(nearStart.t, 0);
  near(nearStart.dist, Math.hypot(170 - 150, 70 - 100), 1e-9);
  const nearEnd = G.nearestOnArc(sa, 30, 70, 1);
  assert.equal(nearEnd.t, 1);
  near(nearEnd.dist, Math.hypot(30 - 50, 70 - 100), 1e-9);
  // limited to the first half (a clipped arc): a point on the unlimited part snaps to the end of the limit, not to progress 0
  const beyond = G.nearestOnArc(sa, 40, 120, 0.5); // at angle ~158 deg, i.e. progress 0.88, outside 0..0.5
  assert.equal(beyond.t, 0.5);
  const p = G.screenPoint(sa, 0.5);
  near(beyond.dist, Math.hypot(40 - p.x, 120 - p.y), 1e-9);
  // inside the limit nothing changes
  near(G.nearestOnArc(sa, 100, 160, 0.5).t, 0.5, 1e-9);
  near(G.nearestOnArc(sa, 120, 148, 0.8).t, Math.atan2(48, 20) / Math.PI, 1e-9);
});

// ------------------------------------------------------------- overview ----

test('layoutRows picks a layout that fits and grows with the canvas', () => {
  for (const [W, H] of [[742, 526], [368, 440], [1300, 300], [360, 700]]) {
    const pad = { l: 26, r: 26, t: 30, b: 20 };
    const lay = G.layoutRows(35, W, H, { pad });
    assert.ok(lay.cols * lay.rows >= 35 && lay.cols >= 2);
    const cam = G.overviewCamera(lay, W, H, pad);
    const view = G.makeView(cam, W, H);
    const ov = eng.buildOverview(lay);
    assert.equal(ov.levels[0].length, 35);
    for (const e of ov.levels[0]) {
      for (const t of [0, 0.25, 0.5, 0.75, e.fraction]) {
        const p = view.point(...Object.values(G.pointOnArc(e.arc, t)));
        assert.ok(p.x >= pad.l - 1 && p.x <= W - pad.r + 1 && p.y >= pad.t - 1 && p.y <= H - pad.b + 1, `${W}x${H} arc ${e.idx} t=${t}: ${p.x},${p.y}`);
      }
    }
  }
  const small = G.layoutRows(35, 400, 400, { pad: {} });
  const big = G.layoutRows(35, 1200, 1200, { pad: {} });
  assert.ok(big.scale > small.scale);
});

test('overview rows are shifted copies of the wave: every arc keeps its shape', () => {
  const lay = G.layoutRows(35, 742, 526, { pad: {} });
  const ov = eng.buildOverview(lay);
  for (const e of ov.levels[0]) {
    const abs = clock.arc(0, BigInt(e.idx));
    near(e.arc.radius, abs.radius, 1e-12);
    near(e.arc.sweep, abs.sweep, 1e-12);
    const o = G.rowOffset(e.idx, lay);
    near(e.arc.center.x, abs.center.x + o.x, 1e-9);
    near(e.arc.center.y, abs.center.y + o.y, 1e-9);
  }
  // first arc of each row starts at x = 0
  for (let row = 0; row < lay.rows; row++) {
    const e = ov.levels[0][row * lay.cols];
    near(G.pointOnArc(e.arc, 0).x, 0, 1e-9);
  }
});

// -------------------------------------------------------------- tooltip ----

test('spanText follows the length of the span', () => {
  const t = TIMES.A;
  assert.equal(spanText(fmt, t, t + 40 * 365.25 * 86400), '2026-10-08 \u2192 2066-10-08');
  assert.match(spanText(fmt, t, t + 40 * 86400), /^2026-10-08 12:00 \u2192 2026-11-17 \d\d:\d\d$/);
  assert.equal(spanText(fmt, t, t + 3600), '2026-10-08 12:00:00 \u2192 13:00:00');
  assert.equal(spanText(fmt, t, t + 2.5), '2026-10-08 12:00:00.000 \u2192 12:00:02.500');
  assert.equal(instantText(fmt, t, 5 * 365.25 * 86400), '2026-10-08');
});

test('countdowns and whenText', () => {
  assert.equal(countdownText(fmt, 0.25), 'in 250 ms');
  assert.equal(countdownText(fmt, -0.004), '4 ms ago');
  assert.equal(countdownText(fmt, 3 * 3600 + 120), 'in 3 h 02 min');
  const d = { start: 100, end: 200 };
  assert.match(whenText(fmt, d, 50), /^starts in /);
  assert.match(whenText(fmt, d, 150), /^ends in /);
  assert.match(whenText(fmt, d, 250), /^ended .* ago$/);
});

test('glyphState reads the CBT glyph', () => {
  assert.deepEqual(
    [glyphState(model.F, 4).label, glyphState(model.F, 5).label, glyphState(model.F, 12).label, glyphState(model.F, 15).label],
    ['+4', '+3', '\u22124', '\u22121'],
  );
  assert.match(glyphState(model.F, 5).dir, /falling/);
  assert.match(glyphState(model.F, 1).dir, /rising/);
  assert.match(glyphState(model.F, 4).dir, /turning/);
});

test('tipHTML explains an arc: dates, duration, countdown and the glyph at the hovered point', () => {
  const f = model.frame(TIMES.A);
  const cur = eng.readHalves(f);
  const d = eng.describe(6, cur[6].idx);
  const html = tipHTML({ d, p: 0.4, at: eng.timeAt(6, d.idx, 0.4), now: TIMES.A, fmt, model: { F: model.F, glyphSVG: model.glyphSVG }, theme });
  assert.match(html, /half-arc \u22122/);
  assert.match(html, /trough/);
  assert.match(html, /2026-10-08 10:24:37/);
  assert.match(html, /ends in 56 min/);
  assert.match(html, /<svg/);
  assert.match(html, /Click to jump here/);
  const marker = tipHTML({ d, p: cur[6].local, at: null, now: TIMES.A, fmt, model: { F: model.F, glyphSVG: model.glyphSVG }, theme, marker: true, action: '' });
  assert.match(marker, /marker/);
  assert.doesNotMatch(marker, /wave-tip-a/);
  // out-of-catalogue clipped arc says so
  const last = eng.describe(0, 34);
  assert.match(tipHTML({ d: last, p: null, at: null, now: TIMES.A, fmt, model: { F: model.F, glyphSVG: model.glyphSVG }, theme }), /clipped/);
});

test('geometry helpers are free of the DOM and of the clock (importable in Node)', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof G.fitCamera, 'function');
});


// ===================================================================================
// Review regressions
// ===================================================================================

// -------------------------------------------------------------- selection ----

test('sanitizeLevel: a stored selection is an integer 0..13, whatever was stored', () => {
  assert.equal(sanitizeLevel(5), 5);
  assert.equal(sanitizeLevel('5'), 5);
  assert.equal(sanitizeLevel(2.5), 3);
  assert.equal(sanitizeLevel(2.4), 2);
  assert.equal(sanitizeLevel(-4), 0);
  assert.equal(sanitizeLevel(99), 13);
  for (const bad of ['abc', NaN, undefined, null, '', {}, [], Infinity]) assert.equal(sanitizeLevel(bad), 6, `fallback for ${String(bad)}`);
});

test('followableLevel: the deepest level whose half-arcs stay on screen long enough', () => {
  const mean = (l) => model.levelInfo(l).meanSeconds;
  assert.equal(followableLevel(13, { rate: 0 }, mean), 13, 'paused: every level can be followed');
  for (const [rate, reduced] of [[1, false], [1, true], [3600, false], [86400, false], [2.63e6, false], [31557600, true]]) {
    for (let level = 0; level <= 13; level++) {
      const r = followableLevel(level, { rate, reduced }, mean);
      const minLife = reduced ? 1.5 : 0.5;
      assert.ok(r <= level);
      assert.ok(r === 0 || mean(r) / 2 / rate >= minLife, `level ${level} at ${rate}x -> ${r} lasts long enough`);
      assert.ok(r === level || mean(r + 1) / 2 / rate < minLife, `level ${level} at ${rate}x -> ${r} is the deepest that does`);
    }
  }
  assert.equal(followableLevel(5, { rate: -3600 }, mean), followableLevel(5, { rate: 3600 }, mean), 'running backwards is as fast as forwards');
  assert.ok(followableLevel(11, { rate: 1, reduced: true }, mean) < followableLevel(11, { rate: 1 }, mean), 'reduced motion asks for longer-lived half-arcs');
});

test('zoomPlan and zoomEnabled: what the zoom controls do and when they can', () => {
  const st = (o) => ({ inRange: true, overview: false, level: 6, eff: 6, ...o });
  assert.deepEqual(zoomPlan(st({}), 1), { kind: 'select', level: 7 });
  assert.deepEqual(zoomPlan(st({}), -1), { kind: 'select', level: 5 });
  assert.deepEqual(zoomPlan(st({ level: 0, eff: 0 }), -1), { kind: 'overview' }, 'out of alpha leads to the catalogue');
  assert.deepEqual(zoomPlan(st({ overview: true }), 1), { kind: 'focus', level: 0 }, 'into the catalogue leads to alpha');
  assert.equal(zoomPlan(st({ overview: true }), -1).kind, 'toast');
  assert.equal(zoomPlan(st({ level: 13, eff: 13 }), 1).kind, 'toast', 'xi is the deepest level');
  assert.deepEqual(zoomPlan(st({ level: 9, eff: 4 }), -1), { kind: 'select', level: 3 }, 'out from a too-fast selection steps from the level that is shown');
  assert.match(zoomPlan(st({ inRange: false }), 1).msg, /Outside the catalogue/);
  assert.match(zoomPlan(st({ inRange: false }), -1).msg, /Outside the catalogue/);
  assert.deepEqual(zoomEnabled(st({})), { in: true, out: true });
  assert.deepEqual(zoomEnabled(st({ level: 13 })), { in: false, out: true });
  assert.deepEqual(zoomEnabled(st({ overview: true })), { in: true, out: false });
  assert.deepEqual(zoomEnabled(st({ inRange: false })), { in: false, out: false });
});

// ----------------------------------------------------------- stepping ----

test('stepTarget: Next lands inside the next half-arc, at every level', () => {
  for (let L = 0; L <= 13; L++) {
    const cur = eng.readHalves(model.frame(TIMES.A));
    const t = eng.timeAt(L, cur[L].idx, 0.5);
    const step = eng.stepTarget(L, cur[L].idx, t, 1);
    near(step.t, eng.timeAt(L, cur[L].idx + 1, 0) + LAND, 1e-9, `level ${L}`);
    assert.equal(eng.readHalves(model.frame(step.t))[L].idx, cur[L].idx + 1, `level ${L}: the landing is inside the next half-arc`);
  }
});

test('stepTarget: Prev restarts the half-arc, then goes back one half-arc per press, even at the deepest level', () => {
  for (let L = 0; L <= 13; L++) {
    let t = eng.timeAt(L, eng.readHalves(model.frame(TIMES.A))[L].idx, 0.5);
    let idx = eng.readHalves(model.frame(t))[L].idx;
    let step = eng.stepTarget(L, idx, t, -1);
    assert.equal(eng.readHalves(model.frame(step.t))[L].idx, idx, `level ${L}: from mid-arc, Prev goes to the start of the same half-arc`);
    // now four more presses, each from the position the previous one landed on
    const seen = [idx];
    for (let i = 0; i < 4; i++) {
      t = step.t;
      idx = eng.readHalves(model.frame(t))[L].idx;
      step = eng.stepTarget(L, idx, t, -1);
      assert.ok(step.t !== undefined, `level ${L} press ${i}`);
      const to = eng.readHalves(model.frame(step.t))[L].idx;
      assert.equal(to, idx - 1, `level ${L} press ${i}: Prev from ${idx} reaches ${idx - 1}, not ${to}`);
      seen.push(to);
    }
    assert.equal(new Set(seen).size, 5);
  }
});

test('stepTarget: the 22 ms half-arcs of depth 14 are not "stuck" by a share of their own length', () => {
  const idx = eng.readHalves(model.frame(TIMES.A))[13].idx;
  const start = eng.timeAt(13, idx, 0);
  const span = eng.halfSpan(13, idx).duration;
  assert.ok(span < 0.03 && LAND / span > 0.02, 'the landing offset is more than 2 % of such an arc');
  assert.ok(eng.stepTarget(13, idx, start + LAND, -1).t < start, 'a press right after landing moves on to the previous half-arc');
  assert.ok(eng.stepTarget(13, idx, start + 0.8 * span, -1).t > start, 'well into the arc it restarts the arc');
});

test('stepTarget: the ends of the catalogue report an edge', () => {
  assert.deepEqual(eng.stepTarget(0, 0, model.tMin + LAND, -1), { edge: 'start' });
  for (const L of [0, 3, 9, 13]) {
    const last = eng.halfCount(L) - 1;
    assert.deepEqual(eng.stepTarget(L, last, model.tMax - 0.0005, 1), { edge: 'end' }, `level ${L}`);
    assert.ok(eng.stepTarget(L, last, model.tMax - 0.0005, -1).t < model.tMax);
  }
});

// ----------------------------------------------------- read-out lines ----

test('nextLines: nothing is announced after the last half-arc of the catalogue (clipped or not)', () => {
  for (let L = 0; L <= 13; L++) {
    const t = model.tMax - 0.002;
    const cur = eng.readHalves(model.frame(t));
    const d = eng.describe(L, cur[L].idx);
    assert.equal(cur[L].idx, eng.halfCount(L) - 1, `level ${L} is in its last half-arc`);
    const lines = nextLines(fmt, eng, d, { local: 0.99 }, t);
    assert.equal(lines[1].dim, 'catalogue ends here', `level ${L}`);
    assert.equal(lines.some((l) => /then a/.test(l.dim)), false);
  }
});

test('nextLines: inside the catalogue the first half names the apex, the second half what follows', () => {
  const cur = eng.readHalves(model.frame(TIMES.A));
  for (const L of [2, 6, 9]) {
    const d = eng.describe(L, cur[L].idx);
    const at = (p) => {
      const t = eng.timeAt(L, d.idx, p);
      return { t, h: eng.readHalves(model.frame(t))[L] };
    };
    const a = at(0.25);
    const first = nextLines(fmt, eng, d, a.h, a.t);
    assert.equal(first[0].dim, d.apex);
    assert.equal(first[1].dim, 'ends');
    assert.match(first[0].text, /^in /, 'the apex is still to come');
    assert.match(first[1].text, /^in /);
    const b = at(0.75);
    const second = nextLines(fmt, eng, d, b.h, b.t);
    assert.equal(second[0].dim, 'ends');
    assert.match(second[0].text, /^in /);
    assert.equal(second[1].dim, 'then a');
    assert.equal(second[1].text, d.crest ? 'trough' : 'crest');
  }
});

test('throughOf: the last instant of the catalogue is 100 %, whichever level', () => {
  for (const L of [0, 1, 7, 8, 9, 13]) {
    const f = model.frame(model.tMax);
    const cur = eng.readHalves(f);
    const d = eng.describe(L, cur[L].idx);
    near(throughOf(d, cur[L].local, model.tMax, model.tMax), 1, 0, `level ${L} at the end`);
    const t = model.tMax - 0.5 * d.duration; // the middle of what is left of this half-arc
    const mid = eng.readHalves(model.frame(t));
    const p = throughOf(d, mid[L].local, t, model.tMax);
    assert.ok(p > 0.3 && p < 0.7, `level ${L}: half a (short) arc before the end reads ${p}`);
  }
  assert.equal(throughOf({ clipped: false, fraction: 1 }, 0.25, 1000, 2000), 0.25);
  assert.equal(throughOf({ clipped: true, fraction: 0.5 }, 0.25, 1000, 2000), 0.5, 'a clipped arc is complete at its fraction');
  assert.equal(throughOf({ clipped: true, fraction: 0.5 }, 0.9, 1000, 2000), 1);
});

// -------------------------------------------------------------- text ----

test('countdownText hands 0.9995..1 s to the seconds format instead of printing "1000 ms"', () => {
  // fmt.countdown owns the seconds format (it floors tenths); what matters here is that no "1000 ms" is printed
  assert.match(countdownText(fmt, 0.9996), /^in (0\.9|1\.0) s$/);
  assert.match(countdownText(fmt, -0.9996), /^(0\.9|1\.0) s ago$/);
  assert.equal(countdownText(fmt, 0.9994), 'in 999 ms');
  assert.equal(countdownText(fmt, -0.0004), '0 ms ago');
});

test('millisecond fields never reach 1000: spans of short arcs carry into the next second', () => {
  assert.equal(roundMs(1791460672.9997), 1791460673);
  const start = 1791460672.2222;
  assert.equal(spanText(fmt, start, 1791460672.9997), '2026-10-08 11:57:52.222 \u2192 11:57:53.000');
  assert.equal(instantText(fmt, 1791460799.9996, 5), '2026-10-08 12:00:00.000');
  for (let i = 0; i < 4000; i++) {
    const t = 1791460800 + i * 0.000731;
    assert.doesNotMatch(instantText(fmt, t, 0.5), /\.\d{4}/, `t=${t}`);
  }
  // an arc that crosses midnight keeps both dates
  assert.equal(spanText(fmt, 1791503999.9996, 1791504000.5), '2026-10-09 00:00:00.000 \u2192 00:00:00.500');
});

test('tipHTML: percent travelled and escaping', () => {
  const f = model.frame(TIMES.A);
  const cur = eng.readHalves(f);
  const d = eng.describe(6, cur[6].idx);
  const m = { F: model.F, glyphSVG: model.glyphSVG };
  const html = tipHTML({ d, p: 0.3, at: null, now: eng.timeAt(6, d.idx, 0.25), fmt, model: m, theme });
  assert.match(html, /25 % of this half-arc travelled/, 'a share always says what it is a share of');
  const before = tipHTML({ d, p: 0.3, at: null, now: d.start - 100, fmt, model: m, theme });
  assert.doesNotMatch(before, /travelled/, 'nothing travelled before the half-arc');
  const nasty = tipHTML({ d: { ...d, letter: '<img src=x>', signed: '+1&"' }, p: null, at: null, now: TIMES.A, fmt, model: m, theme });
  assert.doesNotMatch(nasty, /<img/);
  assert.match(nasty, /&lt;img src=x&gt;/);
  assert.match(nasty, /\+1&amp;&quot;/);
});

// ------------------------------------------------------ geometry / mutants ----

test('travelled: a half-arc before the current one is complete, after it untouched, the current one at its progress', () => {
  const cur = { idx: 10, local: 0.37 };
  assert.equal(G.travelled(9, cur), 1);
  assert.equal(G.travelled(0, cur), 1);
  assert.equal(G.travelled(11, cur), 0);
  assert.equal(G.travelled(10, cur), 0.37);
});

test('makeView.arc and makeView.point agree under rotation, and screenPoint walks the same arc', () => {
  for (const cam of [{ cx: 0.2, cy: -0.1, scale: 180, rot: 0.7 }, { cx: -1, cy: 2, scale: 40, rot: -2.4 }, { cx: 0, cy: 0, scale: 9, rot: 3.1 }]) {
    const view = G.makeView(cam, 800, 600);
    for (const arc of [clock.arc(0, 3), clock.arc(1, 8), eng.buildFocus(3, 3725).children[2].arc]) {
      const sa = view.arc(arc);
      near(sa.r, arc.radius * cam.scale, 1e-9);
      for (const t of [0, 0.3, 0.77, 1]) {
        const a = G.screenPoint(sa, t);
        const b = view.point(G.pointOnArc(arc, t).x, G.pointOnArc(arc, t).y);
        near(a.x, b.x, 1e-6, `rot ${cam.rot} t ${t}`);
        near(a.y, b.y, 1e-6);
      }
    }
  }
});

test('lerpCamera turns the short way round', () => {
  const a = { cx: 0, cy: 0, scale: 100, rot: 3.0 };
  const b = { cx: 0, cy: 0, scale: 100, rot: -3.0 }; // 0.283 rad further on, through pi
  const mid = G.lerpCamera(a, b, 0.5);
  near(Math.abs(G.wrapPi(mid.rot - Math.PI)), 0, 0.01, 'passes through pi, not through 0');
  near(G.wrapPi(G.lerpCamera(a, b, 0.25).rot - (3.0 + 0.25 * G.wrapPi(-6))), 0, 1e-9);
  const c = { ...a, rot: -3.0 };
  const d = { ...a, rot: 3.0 };
  near(Math.abs(G.wrapPi(G.lerpCamera(c, d, 0.5).rot - Math.PI)), 0, 0.01, 'and the other direction');
});

test('fitCamera and overviewCamera honour each side of an unequal padding', () => {
  const s = eng.buildFocus(4, 18628);
  for (const pad of [{ l: 100, r: 10, t: 20, b: 60 }, { l: 10, r: 100, t: 60, b: 20 }, { l: 0, r: 0, t: 0, b: 0 }]) {
    const W = 700;
    const H = 500;
    const view = G.makeView(G.fitCamera(s.samples, s.rot, W, H, pad), W, H);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < s.samples.length; i += 2) {
      const p = view.point(s.samples[i], s.samples[i + 1]);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    assert.ok(x0 >= pad.l - 1e-6 && x1 <= W - pad.r + 1e-6 && y0 >= pad.t - 1e-6 && y1 <= H - pad.b + 1e-6, JSON.stringify([pad, x0, x1, y0, y1]));
    near((x0 + x1) / 2, pad.l + (W - pad.l - pad.r) / 2, 1e-6, 'centre x');
    near((y0 + y1) / 2, pad.t + (H - pad.t - pad.b) / 2, 1e-6, 'centre y');
  }
  for (const pad of [{ l: 24, r: 80, t: 30, b: 18 }, { l: 80, r: 24, t: 18, b: 30 }]) {
    const W = 742;
    const H = 526;
    const lay = G.layoutRows(35, W, H, { pad });
    const view = G.makeView(G.overviewCamera(lay, W, H, pad), W, H);
    for (const e of eng.buildOverview(lay).levels[0]) {
      for (const t of [0, 0.5, e.fraction]) {
        const p = view.point(G.pointOnArc(e.arc, t).x, G.pointOnArc(e.arc, t).y);
        assert.ok(p.x >= pad.l - 1 && p.x <= W - pad.r + 1 && p.y >= pad.t - 1 && p.y <= H - pad.b + 1, `${JSON.stringify(pad)} arc ${e.idx}: ${p.x},${p.y}`);
      }
    }
  }
});

test('layoutRows keeps the rows of loops apart', () => {
  const lay = G.layoutRows(35, 742, 526, { pad: {} });
  const ov = eng.buildOverview(lay);
  const spans = Array.from({ length: lay.rows }, () => ({ y0: Infinity, y1: -Infinity }));
  for (const level of ov.levels) {
    for (const e of level) {
      const b = G.arcBounds(e.arc, 0, e.fraction, 24);
      spans[e.row].y0 = Math.min(spans[e.row].y0, b.y0);
      spans[e.row].y1 = Math.max(spans[e.row].y1, b.y1);
    }
  }
  for (let r = 0; r + 1 < lay.rows; r++) assert.ok(spans[r].y1 < spans[r + 1].y0, `row ${r} (to ${spans[r].y1.toFixed(2)}) clears row ${r + 1} (from ${spans[r + 1].y0.toFixed(2)})`);
});

test('describe(): apex and event names follow the model (peak on a crest, valley on a trough)', () => {
  for (const [L, idx] of [[0, 4], [0, 5], [2, 744], [2, 745], [6, 1434423], [6, 1434424], [9, 258196253], [9, 258196254]]) {
    const d = eng.describe(L, idx);
    const ev = Object.fromEntries(model.cycleByIndex(L, Math.floor(idx / 2)).events.map((e) => [e.name, e.time]));
    assert.equal(d.apex, idx % 2 === 0 ? 'peak' : 'valley', `level ${L} idx ${idx}`);
    assert.deepEqual(d.marks, idx % 2 === 0 ? ['begin', 'peak', 'node'] : ['node', 'valley', 'end']);
    near(eng.timeAt(L, idx, 0.5), idx % 2 === 0 ? ev.firstPeak : ev.oppositePeak, 1e-3, `level ${L} idx ${idx}: the apex of the arc is the model's ${d.apex}`);
  }
});

test('buildFocus keeps the four closest ancestors, markersFor one marker per level coarse to fine', () => {
  const cur = eng.readHalves(model.frame(TIMES.A));
  for (const L of [0, 1, 3, 6, 9, 11]) {
    const scene = eng.buildFocus(L, cur[L].idx);
    assert.equal(scene.ancestors.length, Math.min(L, 4), `level ${L}`);
    assert.deepEqual(scene.ancestors.map((a) => a.level), Array.from({ length: Math.min(L, 4) }, (_, i) => L - 1 - i), 'parent first');
    const levels = eng.markersFor(scene, cur).map((m) => m.level);
    const want = [];
    for (let l = Math.max(0, L - 4); l <= Math.min(15, L + 4); l++) want.push(l);
    assert.deepEqual(levels, want, `level ${L}: ancestors, the focus level, its children and four levels down`);
  }
});

test('halfOf, childOf, parentOf and glyphIndexAt clamp and wrap at their ends', () => {
  assert.deepEqual(G.halfOf(5, 0), { idx: 10, local: 0, half: 0 });
  assert.deepEqual(G.halfOf(5, 0.5), { idx: 11, local: 0, half: 1 });
  assert.deepEqual(G.halfOf(5, 1), { idx: 11, local: 1, half: 1 });
  assert.deepEqual(G.halfOf(5, 1.0000001), { idx: 11, local: 1, half: 1 });
  assert.deepEqual(G.halfOf(5, -0.0000001), { idx: 10, local: 0, half: 0 });
  assert.deepEqual(G.childOf(4, 1, 5), { idx: 24, local: 1, j: 4 }, 'the very end belongs to the last child');
  assert.deepEqual(G.childOf(4, 0, 5), { idx: 20, local: 0, j: 0 });
  near(G.childOf(4, 0.5, 5).local, 0.5, 1e-12);
  assert.equal(G.childOf(4, 0.5, 5).idx, 22);
  assert.deepEqual(G.parentOf(22, 0.5, 5), { idx: 4, local: (2 + 0.5) / 5, j: 2 });
  assert.equal(G.glyphIndexAt(1, 1), 0, 'the end of a trough wraps to the start of the cycle');
  assert.equal(G.glyphIndexAt(2, 0.5), G.glyphIndexAt(0, 0.5));
  assert.equal(G.glyphIndexAt(3, 0.25), G.glyphIndexAt(1, 0.25));
  assert.equal(G.glyphIndexAt(0, 2), G.glyphIndexAt(0, 1), 'progress beyond 1 is clamped');
  assert.equal(G.glyphIndexAt(0, -1), 0);
});

// ------------------------------------------------------------- drawing ----

/** A 2D context that records the text it is asked to draw and ignores everything else. */
function recordingContext() {
  const texts = [];
  const g = new Proxy(
    {},
    {
      get(o, k) {
        if (k in o) return o[k];
        if (k === 'measureText') return (str) => ({ width: String(str).length * 6.5 });
        if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
        if (k === 'fillText') return (str, x, y) => texts.push({ str, x, y });
        return () => {};
      },
      set(o, k, v) {
        o[k] = v;
        return true;
      },
    },
  );
  return { g, texts };
}
function makePainter(W, H) {
  const rec = recordingContext();
  const canvas = { getContext: () => rec.g, width: 0, height: 0 };
  const P = createPainter(canvas, { theme, fonts: { label: '11px x', labelBold: 'bold 12px x', small: '10px x' } });
  P.resize(W, H, 1);
  return { P, texts: rec.texts };
}
const LETTERS = Array.from({ length: 14 }, (_, l) => model.levelInfo(l).text);

test('drawFocus: only dots that are drawn are marker targets; the rest are reached through their edge badge', () => {
  const W = 742;
  const H = 526;
  const t = 2000000000;
  const cur = eng.readHalves(model.frame(t));
  const L = 3;
  const scene = eng.buildFocus(L, cur[L].idx);
  const cam = G.fitCamera(scene.samples, scene.rot, W, H, { l: 46, r: 46, t: 44, b: 40 });
  const view = G.makeView(cam, W, H);
  const { P } = makePainter(W, H);
  const hits = { arcs: [], markers: [] };
  const markers = eng.markersFor(scene, cur);
  drawFocus(P, scene, view, { alpha: 1, cur, markers, hover: null, hits, grey: false, eventLabels: scene.desc.marks, letters: LETTERS, quiet: false, avoid: null, nowLabel: '12:00' });
  const dots = hits.markers.filter((m) => !m.badge);
  const badges = hits.markers.filter((m) => m.badge);
  assert.ok(dots.length >= 3);
  for (const m of dots) assert.ok(m.x >= 15 && m.x <= W - 15 && m.y >= 15 && m.y <= H - 15, `level ${m.level} at ${m.x.toFixed(1)},${m.y.toFixed(1)} is drawn inside the canvas`);
  const outside = markers.filter((m) => { const p = view.point(m.x, m.y); return !(p.x >= 15 && p.x <= W - 15 && p.y >= 15 && p.y <= H - 15); });
  assert.ok(outside.length >= 1, 'this scene has a dot off the canvas');
  assert.ok(badges.length >= 1 && badges.every((b) => b.x >= 0 && b.x <= W && b.y >= 0 && b.y <= H), 'and it is reached through a badge on the edge');
  for (const m of outside) assert.equal(hits.markers.some((h) => h.level === m.level && !h.badge), false, `level ${m.level} has no invisible target`);
});

test('the time label keeps its place while the dot moves: no hops between sides, only short glides', () => {
  const W = 742;
  const H = 526;
  const { P, texts } = makePainter(W, H);
  let clock = 0;
  P.now = () => clock;
  const L = 6;
  const t0 = TIMES.A - 1800;
  const offsets = [];
  let scene = null;
  for (let i = 0; i < 360; i++) {
    const t = t0 + i * 10; // an hour, a 10 s step per frame
    const cur = eng.readHalves(model.frame(t));
    if (!scene || scene.idx !== cur[L].idx) scene = eng.buildFocus(L, cur[L].idx);
    if (scene.idx !== cur[L].idx) continue;
    const cam = G.fitCamera(scene.samples, scene.rot, W, H, { l: 46, r: 46, t: 44, b: 40 });
    const view = G.makeView(cam, W, H);
    const markers = eng.markersFor(scene, cur);
    texts.length = 0;
    P.begin();
    drawFocus(P, scene, view, { alpha: 1, cur, markers, hover: null, hits: null, grey: false, eventLabels: scene.desc.marks, letters: LETTERS, quiet: false, avoid: null, nowLabel: fmt.time(t) });
    clock += 16;
    const label = texts.find((x) => /^\d\d:\d\d:\d\d$/.test(x.str));
    const m = markers.find((x) => x.level === L);
    const p = view.point(m.x, m.y);
    assert.ok(label, 'the time is written');
    offsets.push({ scene: scene.key, ox: label.x - p.x, oy: label.y - p.y });
  }
  assert.ok(offsets.length > 60);
  let hops = 0;
  let maxStep = 0;
  for (let i = 1; i < offsets.length; i++) {
    if (offsets[i].scene !== offsets[i - 1].scene) continue;
    const step = Math.hypot(offsets[i].ox - offsets[i - 1].ox, offsets[i].oy - offsets[i - 1].oy);
    maxStep = Math.max(maxStep, step);
    if (step > 8) hops++;
  }
  assert.ok(maxStep <= 20, `largest move of the label relative to its dot in one frame: ${maxStep.toFixed(1)} px`);
  assert.ok(hops <= 3, `${hops} frames with a big move`);
});

test('a label with no room beside its dot at the canvas edge is slid inside, not dropped off it', () => {
  const W = 300;
  const H = 200;
  const { P, texts } = makePainter(W, H);
  const cur = eng.readHalves(model.frame(TIMES.A));
  const scene = eng.buildFocus(4, cur[4].idx);
  const view = G.makeView({ cx: 0, cy: 0, scale: 300, rot: scene.rot }, W, H); // zoomed in a lot: the dot is near an edge
  P.begin();
  drawFocus(P, scene, view, { alpha: 1, cur, markers: eng.markersFor(scene, cur), hover: null, hits: null, grey: false, eventLabels: scene.desc.marks, letters: LETTERS, quiet: false, avoid: null, nowLabel: '12:00:00' });
  const label = texts.find((x) => x.str === '12:00:00');
  if (label) {
    const w = 8 * 6.5;
    assert.ok(label.x - w / 2 >= 0 && label.x + w / 2 <= W && label.y >= 0 && label.y <= H, `label at ${label.x},${label.y}`);
  }
});

test('placeLabel: keeps its spot against a small overlap, glides away from a real obstacle, and slides inside the canvas', () => {
  const { P } = makePainter(742, 526);
  let clock = 0;
  P.now = () => clock;
  const font = 'bold 12px x';
  const at = (occ, x = 300, y = 200) => placeLabel(P, occ, 'k', '12:00:00', x, y, 0, -1, font);
  const first = at([]);
  clock += 16;
  // a loop number (soft) grazing the label: it stays
  const graze = { x0: first.rect.x0 - 20, x1: first.rect.x0 + 6, y0: first.rect.y0, y1: first.rect.y1, w: 0.2 };
  const kept = at([graze]);
  near(kept.x, first.x, 1e-9, 'stays put against a graze');
  near(kept.y, first.y, 1e-9);
  // a marker (hard) right on it: it moves, in steps of at most 14 px per frame, until it is clear of the obstacle
  const block = { x0: first.rect.x0 - 2, x1: first.rect.x1 + 2, y0: first.rect.y0 - 2, y1: first.rect.y1 + 2 };
  let prev = kept;
  let steps = 0;
  let last = null;
  for (let i = 0; i < 40; i++) {
    clock += 16;
    last = at([block]);
    const step = Math.hypot(last.x - prev.x, last.y - prev.y);
    assert.ok(step <= 14.0001, `frame ${i}: moved ${step.toFixed(1)} px`);
    if (step > 0.5) steps++;
    prev = last;
  }
  assert.ok(steps >= 2, 'it glided over several frames rather than jumping');
  assert.ok(Math.hypot(last.x - first.x, last.y - first.y) > 20, 'and ended on another side');
  // after that it stays where it went, with the obstacle still there, and nothing is left gliding
  clock += 16;
  P.begin();
  const still = at([block]);
  near(still.x, last.x, 1e-6);
  assert.equal(P.settling, false, 'settled by now');
  // a dot at the corner of the canvas: the label is slid back inside
  const corner = placeLabel(P, [], 'corner', 'before the first eclipse', 10, 10, 0, -1, font);
  const hw = 'before the first eclipse'.length * 6.5 / 2;
  assert.ok(corner.x - hw >= 0 && corner.y >= 0, `${corner.x},${corner.y}`);
});


// ===================================================================================
// Audit: bare percentages, half-arc vs cycle numbering, "depth" instead of "level"
// ===================================================================================

// ------------------------------------------------- shares say what they are of ----

test('floorPercent floors (never rounds up), clamps, and holds below 100 until complete', () => {
  assert.equal(floorPercent(0.2749), '27');
  assert.equal(floorPercent(0.2799999), '27', 'floored, not rounded');
  assert.equal(floorPercent(0.29), '29', 'binary noise (0.29 * 100 = 28.999999999999996) does not cost a percent');
  assert.equal(floorPercent(0), '0');
  assert.equal(floorPercent(1), '100');
  assert.equal(floorPercent(0.9999999), '99', 'almost complete is not complete');
  assert.equal(floorPercent(-0.2), '0');
  assert.equal(floorPercent(7), '100');
  assert.equal(floorPercent(0.135, 1), '13.5');
  assert.equal(floorPercent(0.1349999, 1), '13.4');
  assert.equal(floorPercent(0.75, 1), '75.0');
  assert.equal(floorPercent(0.99999, 1), '99.9');
  assert.equal(floorPercent(1, 1), '100.0');
});

test('the half-arc share and the cycle share of one instant agree: the half-arc is half of the cycle', () => {
  // the header prints both ("27 % of this half-arc · 13.5 % of the cycle"): they are one fact, not two
  for (const t of [TIMES.A, TIMES.B, TIMES.C, TIMES.mid, 1791550569.9077802]) {
    const f = model.frame(t);
    const cur = eng.readHalves(f);
    for (let L = 0; L <= 13; L++) {
      const h = cur[L];
      const d = eng.describe(L, h.idx);
      const cyc = (h.idx % 2 + h.local) / 2; // the cycle share rebuilt from the half-arc reading
      near(cyc, h.reading.phase, 1e-9, `level ${L} t=${t}: half-arc ${h.idx} at ${h.local} is ${cyc} of the cycle`);
      const through = throughOf(d, h.local, t, model.tMax);
      if (!d.clipped) {
        const want = Math.floor((d.crest ? through / 2 : 0.5 + through / 2) * 1000 + 1e-7) / 10;
        near(want, Number(floorPercent(h.reading.phase, 1)), 0.1001, `level ${L}: the two printed shares are consistent`);
      }
    }
  }
});

// ------------------------------------------- half-arc numbering vs cycle numbering ----

test('describe(): the half-arc maps onto the cycle numbering (6 / 11) every other view uses', () => {
  for (const t of [TIMES.A, TIMES.B, TIMES.C, TIMES.mid, TIMES.early, TIMES.late, 1791550569.9077802]) {
    const f = model.frame(t);
    const cur = eng.readHalves(f);
    for (let L = 0; L <= 13; L++) {
      const r = f.level(L);
      const d = eng.describe(L, cur[L].idx);
      assert.equal(d.cycle, r.cycle, `level ${L} t=${t}: global cycle`);
      assert.equal(d.cycleN, r.local + 1, `level ${L} t=${t}: cycle number in its parent cycle (the ladder's "n / m")`);
      assert.equal(d.cycleOf, r.siblings, `level ${L} t=${t}: cycles per parent cycle`);
      assert.equal(d.half, r.phase < 0.5 ? 'first' : 'second', `level ${L} t=${t}: which half of the cycle`);
      assert.equal(d.crest, r.phase < 0.5, 'a crest is the first half of its cycle');
    }
  }
});

test('the audit case: a half-arc "1 of 11 in ζ" is the second half of η cycle 6 / 11', () => {
  // 75 % through the 6th η cycle of its ζ cycle (ladder: "6 / 11", model local 5)
  const idx = model.levelAt(TIMES.A, 6).cycle - model.levelAt(TIMES.A, 6).local + 5;
  const t = model.cycleStartTime(6, idx) + 0.75 * (model.cycleStartTime(6, idx + 1) - model.cycleStartTime(6, idx));
  const r = model.levelAt(t, 6);
  assert.equal(r.local, 5);
  assert.equal(r.siblings, 11);
  const h = eng.readHalves(model.frame(t))[6];
  const d = eng.describe(6, h.idx);
  assert.equal(d.signed, '−1', 'the picture numbers it as the first loop of a trough');
  assert.equal(loopText(d), '1 of 11 in this ζ half-arc');
  assert.equal(cycleText(d), 'second half of η cycle 6 / 11 in ζ', 'and the cycle text maps it to the number the ladder shows');
  // the first half of the same cycle is the 11th loop of the previous ζ half-arc: loop 11 of 11, but still cycle 6 / 11
  const first = eng.describe(6, h.idx - 1);
  assert.equal(first.signed, '+11');
  assert.equal(loopText(first), '11 of 11 in this ζ half-arc');
  assert.equal(cycleText(first), 'first half of η cycle 6 / 11 in ζ');
  assert.notEqual(Math.floor(first.idx / 11), Math.floor(d.idx / 11), 'the two halves of one cycle sit in different ζ half-arcs');
});

test('loopText and cycleText name what they count, for α and for deep levels', () => {
  const a = eng.describe(0, 11); // 12th of 35 half-arcs, a trough: the 6th of 18 α cycles
  assert.equal(loopText(a), '12 of 35 in the catalogue');
  assert.equal(cycleText(a), 'second half of α cycle 6 / 18');
  assert.equal(a.parent, null);
  const x = eng.describe(13, 7);
  assert.match(loopText(x), /^\d+ of \d+ in this ν half-arc$/);
  assert.match(cycleText(x), /^second half of ξ cycle \d+ \/ \d+ in ν$/);
  assert.match(loopHint(x), /half-arcs inside its ν half-arc/);
  assert.match(loopHint(a), /whole catalogue/);
  // no bare numbers: every figure the two strings print sits next to a word that says what it counts
  for (const d of [a, x, eng.describe(6, 123456), eng.describe(1, 0)]) {
    assert.match(loopText(d), /\d+ of \d+ in (this \S+ half-arc|the catalogue)$/);
    assert.match(cycleText(d), /^(first|second) half of \S+ cycle \d+ \/ \d+( in \S+)?$/);
  }
});

test('tooltip: names the loop and the cycle of the half-arc it describes', () => {
  const cur = eng.readHalves(model.frame(TIMES.A));
  const d = eng.describe(6, cur[6].idx);
  const html = tipHTML({ d, p: 0.4, at: null, now: TIMES.A, fmt, model: { F: model.F, glyphSVG: model.glyphSVG }, theme });
  assert.ok(html.includes(esc(loopText(d))));
  assert.ok(html.includes(esc(cycleText(d))));
});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// -------------------------------------------------------- "depth", not "level" ----

/** The contents of every string / template literal in `src` (comments skipped, `${}` bodies scanned as code). */
function literalsOf(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  function code(inBraces) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
      if (c === "'" || c === '"') {
        let j = i + 1;
        let s = '';
        while (j < n && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1]; j += 2; } else s += src[j++]; }
        out.push(s);
        i = j + 1;
        continue;
      }
      if (c === '`') { i++; template(); continue; }
      if (c === '/' && /[=(,:;!&|?{}[]\s*$/.test(src.slice(Math.max(0, i - 3), i))) { // a regular expression literal
        let j = i + 1;
        while (j < n && src[j] !== '/' && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
        i = j + 1;
        continue;
      }
      if (c === '{') depth++;
      if (c === '}') { if (inBraces && depth === 0) { i++; return; } depth--; }
      i++;
    }
  }
  function template() {
    let s = '';
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { s += src[i + 1]; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { out.push(s); s = ''; i += 2; code(true); continue; }
      s += src[i++];
    }
    out.push(s);
    i++;
  }
  code(false);
  return out;
}
/** What a person can read or hear from a literal: markup without class / data / style attributes, selectors skipped. */
function visibleText(lit) {
  if (/^[.#[]/.test(lit)) return '';
  return lit.replace(/\s(?:class|style|data-[\w-]+|role|type|tabindex|aria-checked|aria-hidden|viewBox|fill|stroke[\w-]*|d)="[^"]*(?:"|$)/g, ''); // an attribute cut by a ${} stops at the end of the literal
}

test('visible strings say "depth", never "level" (the level number is internal)', () => {
  const files = ['src/ui/wave.js', 'src/ui/wave/nav.js', 'src/ui/wave/tooltip.js', 'src/ui/wave/draw.js', 'src/ui/wave/scene.js', 'src/ui/wave/geometry.js'];
  let total = 0;
  for (const f of files) {
    const lits = literalsOf(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
    total += lits.length;
    for (const lit of lits) assert.doesNotMatch(visibleText(lit), /\blevels?\b/i, `${f}: "${lit.slice(0, 90)}" shows "level" to the user`);
  }
  // the scan really sees the module's strings (a broken scanner would pass vacuously)
  const wave = literalsOf(fs.readFileSync(new URL('../src/ui/wave.js', import.meta.url), 'utf8')).join('\n');
  assert.ok(total > 150);
  assert.match(wave, /Focus depth/);
  assert.match(wave, /Click to focus this depth/);
  assert.match(wave, /change the depth/);
});

test('the zoom limit says "depth"', () => {
  const plan = zoomPlan({ inRange: true, overview: false, level: 13, eff: 13 }, 1);
  assert.equal(plan.kind, 'toast');
  assert.match(plan.msg, /Depth 14/);
  assert.doesNotMatch(plan.msg, /level/i);
});
