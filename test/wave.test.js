import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createFormatter } from '../src/core/format.js';
import * as theme from '../src/core/theme.js';
import * as G from '../src/ui/wave/geometry.js';
import { createEngine, LAND } from '../src/ui/wave/scene.js';
import { createPainter, drawFocus, placeLabel, REST_ALPHA } from '../src/ui/wave/draw.js';
import { followableLevel, parseFlag, sanitizeLevel, solarAtLoad, storedSettings, throughOf, zoomEnabled, zoomPlan } from '../src/ui/wave/nav.js';
import { countdownText, cycleText, floorPercent, glyphState, instantText, loopHint, loopText, nextLines, roundMs, spanHTML, spanParts, spanText, tipHTML, whenText } from '../src/ui/wave/tooltip.js';
import { pentadMarkHTML } from '../src/ui/pentad.js';
import fs from 'node:fs';
import { createPure } from '../src/core/pure.js';
import { RULES } from '../tools/pure-scan.mjs';
import * as SUN from '../src/ui/wave/solar.js';
import { chainShort, chainText, cycleNamedPure, cyclePhaseOf, cyclePure, createWords, eclipseLabels, halfLengthPure, nextLinesPure, nowLabelPure, pairSpoken, pureCountdown, pureCycleLeads, pureNowLeads, pureSpan, quarterWord, tipHTMLPure, whenPure } from '../src/ui/wave/words.js';

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
  const files = ['src/ui/wave.js', 'src/ui/wave/nav.js', 'src/ui/wave/tooltip.js', 'src/ui/wave/draw.js', 'src/ui/wave/scene.js', 'src/ui/wave/geometry.js', 'src/ui/wave/words.js', 'src/ui/wave/solar.js', 'src/ui/wave/sun.js'];
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

// ================================================================== the solar wave ====

const grid = SUN.syncGrid(model.levelInfo(6).prefixNum);
const prefixOf = (l) => model.levelInfo(l).prefixNum;

test('solar grid: sync number and phase from a Saros position agree with the model (SPEC §7)', () => {
  assert.equal(grid.P6, 125125);
  assert.equal(grid.anchor, 625625, 'anchor = A * P6 / 4 η cycles, A = 20');
  for (const t of [TIMES.A, TIMES.B, TIMES.C, TIMES.mid, 1e9, 1.5e9, 2e9, 125593320, model.tMin + 3e6, model.tMax - 3e6]) {
    const s = model.solarAt(t);
    const a = SUN.syncAt(model.positionOf(t), grid);
    assert.equal(a.sync, s.sync, `sync at ${t}`);
    near(a.phase, s.phase, 1e-8, `phase at ${t}`);
    assert.ok(a.phase >= 0 && a.phase < 1);
  }
});

test('solar grid: sync boundaries are η cycle boundaries and match the model', () => {
  for (const n of [-30000, 0, 1, 4820, 4821, 9999, 70000]) {
    const pos = SUN.positionOfCoord(n, grid);
    const cyc = (pos * grid.P6) / 4;
    near(cyc, Math.round(cyc), 1e-6 * Math.max(1, Math.abs(cyc)), `sync ${n} starts on an η cycle boundary`);
    const m = model.solarSyncByNumber(n);
    if (m) near(model.timeOfPosition(pos), m.start, 1e-3, `sync ${n} start time`);
  }
  near(SUN.syncCoord(SUN.positionOfCoord(4820.37, grid), grid), 4820.37, 1e-9, 'the two maps are inverse');
  near(grid.length, 19 * 4 / 125125, 1e-15);
  // 19 η cycles = 38 η half-arcs
  near(SUN.syncsOnArc(prefixOf(6), 1, grid), 1 / 38, 1e-12);
});

test('syncsOnArc: about 10 syncs on a δ half-arc, 2 on an ε half-arc, a third of one on a ζ half-arc', () => {
  near(SUN.syncsOnArc(prefixOf(3), 1, grid), 10.13, 0.01);
  near(SUN.syncsOnArc(prefixOf(4), 1, grid), 2.026, 0.001);
  near(SUN.syncsOnArc(prefixOf(5), 1, grid), 0.289, 0.001);
  near(SUN.syncsOnArc(prefixOf(4), 0.5, grid), 1.013, 0.001, 'a clipped arc carries fewer');
  // the same count from the model: a half-arc lasts half a cycle, a sync lasts 19 η cycles
  const d = eng.describe(4, 18628);
  const sync = model.solarSyncByNumber(4820);
  near(SUN.syncsOnArc(prefixOf(4), 1, grid), d.duration / (sync.end - sync.start), 0.01);
});

test('rippleFit: at least 1.5 syncs on the arc and a wavelength of at least 26 px, fading in to full strength at 40 px', () => {
  assert.equal(SUN.MIN_SYNCS, 1.5);
  assert.equal(SUN.MIN_WAVELENGTH, 26);
  assert.equal(SUN.FULL_WAVELENGTH, 40);
  assert.equal(SUN.rippleFit(2.03, 600).visible, true);
  assert.equal(SUN.rippleFit(2.03, 600).why, 'ok');
  assert.equal(SUN.rippleFit(1.4, 600).why, 'coarse', 'fewer than 1.5 syncs: the arc is too short for a ripple');
  assert.equal(SUN.rippleFit(1.5, 600).visible, true);
  assert.equal(SUN.rippleFit(50, 600).why, 'fine', '12 px wavelength: too tight');
  assert.equal(SUN.rippleFit(10, 259).visible, false, '25.9 px');
  assert.equal(SUN.rippleFit(10, 260).visible, true, '26 px');
  const f = SUN.rippleFit(10, 400);
  near(f.wavelength, 40, 1e-9);
  assert.equal(f.strength, 1, 'a comfortable wavelength is drawn at full strength');
  near(SUN.rippleFit(10, 260).strength, 0.5, 1e-9, 'it fades in from half strength at the minimum');
  near(SUN.rippleFit(10, 330).strength, 0.75, 1e-9, 'half way between the two');
  assert.equal(SUN.rippleFit(10, 5000).strength, 1);
  assert.equal(SUN.rippleFit(0, 600).visible, false);
  // the ripple reads as a wave at every wavelength it is drawn at: a few pixels at the tightest, up to 20 on a wide one
  assert.equal(SUN.rippleAmp(26), 3, 'never below 3 px: a fuzz on a 3 px arc is not a wave');
  near(SUN.rippleAmp(90), 5.4, 1e-9);
  near(SUN.rippleAmp(300), 18, 1e-9);
  assert.equal(SUN.rippleAmp(600), 20, 'a wide wave (ε at a normal stage) gets 20 px, not 12');
  assert.ok(SUN.rippleAmp(500) / 500 >= 1 / 25, 'ε at 1440 x 900 (a 500 px wave): no longer 40 wavelengths to one amplitude (12 / 500)');
});

test('rippleDepths: the depths whose arcs carry a ripple, asking for pixels only where one is possible', () => {
  const asked = [];
  const syncs = [660, 50.7, 10.13, 2.026, 0.29];
  const px = [1300, 1100, 900, 700, 600];
  const got = SUN.rippleDepths(5, (l) => syncs[l], (l) => { asked.push(l); return px[l]; }, 1600);
  assert.deepEqual(got, [2, 3], 'δ (90 px a wave) and ε; γ is 22 px a wave, β and α far less');
  assert.deepEqual(asked, [1, 2, 3], 'α is never measured (at least 26 px a wave would need 17 000 px), nor ζ (0.29 syncs)');
  assert.deepEqual(SUN.rippleDepths(5, (l) => syncs[l], () => 1400, 1600), [1, 2, 3].filter((l) => 1400 / syncs[l] >= 26 && syncs[l] * 26 <= 1600), 'a large arc reaches γ');
  assert.deepEqual(SUN.rippleDepths(5, (l) => [0.5, 0.5, 0.5, 1.01, 0.3][l], () => 700, 1600), [], 'a clipped last arc carries 1.01 syncs: no ripple at all');
});

test('hintDepths: the depths the hint under the dial lists are the depths whose arc really carries the ripple on that stage', () => {
  const PAD = { l: 46, r: 46, t: 44, b: 40 }; // the focus padding of wave.js
  /** Which depths draw a ripple when they are the focus: each level's own scene, fitted to the stage. */
  const drawn = (t, W, H) => {
    const cur = eng.readHalves(model.frame(t));
    const out = [];
    for (let L = 0; L <= 13; L++) {
      const sc = eng.buildFocus(L, cur[L].idx);
      const fit = SUN.rippleFit(SUN.syncsOnArc(prefixOf(L), sc.fraction, grid), G.focusArcLength(sc, W, H, PAD));
      if (fit.visible) out.push(L);
    }
    return out;
  };
  const hint = (t, W, H) => SUN.hintDepths(eng, grid, eng.readHalves(model.frame(t)), W, H, PAD);
  const cases = [
    [TIMES.A, 1190, 506, 'a 1440 x 900 window'],
    [TIMES.A, 966, 604, 'a 1300 x 1000 window (a stage shaped differently: its arcs are fitted larger than on the usual one)'],
    [TIMES.A, 1222, 684, 'a 1920 x 1080 window'],
    [TIMES.A, 358, 420, 'a phone'],
    [TIMES.A, 200, 160, 'a tiny stage'],
    [TIMES.A, 1600, 820, 'the largest stage the page makes'],
    [TIMES.B, 966, 604, 'the year 2000'],
    [TIMES.C, 1190, 506, 'the year 2061'],
    [model.tMax - 3 * 86400, 1190, 506, 'three days before the end: the last ε half-arc is clipped'],
    [model.tMax - 3 * 86400, 966, 604, 'the end, on another stage'],
    [model.tMax - 40 * 86400, 1190, 506, 'forty days before the end'],
    [model.tMin + 2 * 86400, 1190, 506, 'the first days'],
  ];
  for (const [t, W, H, what] of cases) assert.deepEqual(hint(t, W, H), drawn(t, W, H), `${what}`);
  // the two situations of the audit
  assert.deepEqual(hint(TIMES.A, 1190, 506), [3, 4]);
  assert.deepEqual(hint(model.tMax - 3 * 86400, 1190, 506).includes(4), false, 'a clipped ε arc (1.01 syncs) does not claim a ripple at depth 5');
  assert.ok(hint(model.tMax - 3 * 86400, 1190, 506).includes(3), 'δ still does');
  assert.deepEqual(hint(TIMES.A, 1600, 820), [2, 3, 4], 'γ appears only on a genuinely large stage');
  assert.deepEqual(hint(TIMES.A, 1222, 684), [3, 4], 'γ is 21-24 px a wave on a 1920 x 1080 window: not drawn');
  assert.deepEqual(hint(TIMES.A, 200, 160), [4]);
  // the half-arcs of one depth are not alike (their sweeps differ): each is measured for itself, and remembered
  const cur = eng.readHalves(model.frame(TIMES.A));
  const sizes = new Set();
  for (const L of [2, 3, 4]) {
    for (const idx of [cur[L].idx, cur[L].idx + 1, cur[L].idx + 2]) {
      const px = G.focusArcLength(eng.buildFocus(L, idx), 1190, 506, PAD);
      sizes.add(px.toFixed(1));
      near(eng.arcPixels(L, idx, 1190, 506, PAD), px, 1e-9, `depth ${L + 1} half-arc ${idx}`);
      near(eng.arcPixels(L, idx, 1190, 506, PAD), px, 1e-9, 'the second time it comes from the memo');
    }
  }
  assert.ok(sizes.size >= 6, `the neighbours differ in size (${sizes.size} distinct lengths of 9)`);
  const last = eng.halfCount(4) - 1;
  assert.ok(eng.fractionOf(4, last) < 1);
  near(eng.arcPixels(4, last, 1190, 506, PAD), G.focusArcLength(eng.buildFocus(4, last), 1190, 506, PAD), 1e-9);
  assert.notEqual(eng.arcPixels(4, last, 1190, 506, PAD), eng.arcPixels(4, last, 966, 604, PAD), 'another stage, another size');
});

test('ripplePoints: the ripple is the sync phase as a sine riding the arc (peak at 1/4, node at 1/2, valley at 3/4)', () => {
  const idx = 18628;
  const spec = SUN.arcSpec(idx, prefixOf(4), 1);
  const sa = { x: 300, y: 400, r: 200, a0: -Math.PI, sweep: Math.PI };
  const amp = 8;
  const { xs, ys, n } = SUN.ripplePoints(sa, spec, grid, { amp });
  assert.ok(n >= 300 && n <= 1600 && xs.length === n + 1);
  let maxOut = 0;
  let maxIn = 0;
  for (let i = 0; i <= n; i++) {
    const p = i / n;
    const radial = Math.hypot(xs[i] - sa.x, ys[i] - sa.y) - sa.r;
    const phase = SUN.syncAt(spec.pos0 + p * spec.span, grid).phase;
    near(radial, amp * Math.sin(2 * Math.PI * phase), 1e-6, `point ${i}`);
    maxOut = Math.max(maxOut, radial);
    maxIn = Math.min(maxIn, radial);
    // the angle is that of the carrier arc at the same progress
    const ang = Math.atan2(ys[i] - sa.y, xs[i] - sa.x);
    near(Math.cos(ang), Math.cos(sa.a0 + sa.sweep * p), 1e-9);
  }
  near(maxOut, amp, 0.02, 'crest');
  near(maxIn, -amp, 0.02, 'trough');
  // the quarter marks sit where the glyph wave has its thresholds
  const marks = SUN.quarterMarks(spec, grid);
  assert.ok(marks.length >= 6 && marks.length <= 10, `two syncs on the arc: ${marks.length} quarter marks`);
  for (const m of marks) {
    const phase = (m.k / 4) % 1;
    const radial = amp * Math.sin(2 * Math.PI * phase);
    const pt = SUN.ripplePointAt(sa, spec, grid, m.p, amp);
    near(Math.hypot(pt.x - sa.x, pt.y - sa.y) - sa.r, radial, 1e-6, `${m.name} of sync ${m.sync}`);
    assert.equal(m.name, ['peak', 'node', 'valley', 'end'][m.k - 1]);
    assert.ok(m.p >= 0 && m.p <= 1);
  }
});

test('quarterMarks: the quarters fall at the instants the model names (peak, node, valley, end of the sync)', () => {
  for (const [L, idx, t] of [[4, 18628, TIMES.A], [3, 3725, 2e9], [4, 1000, TIMES.B]]) {
    const cur = eng.readHalves(model.frame(t));
    const i = cur[L].idx;
    const spec = SUN.arcSpec(i, prefixOf(L), eng.fractionOf(L, i));
    const marks = SUN.quarterMarks(spec, grid);
    assert.ok(marks.length > 0);
    for (const m of marks) {
      const at = eng.timeAt(L, i, m.p);
      const s = model.solarSyncByNumber(m.sync);
      const expect = s.start + (m.k / 4) * (s.end - s.start);
      near(at, expect, 0.05, `${m.name} of sync ${m.sync} on ${L}:${i}`);
    }
    // only the sync of the displayed time
    const here = SUN.syncAt(model.positionOf(t), grid).sync;
    const mine = SUN.quarterMarks(spec, grid, here);
    assert.ok(mine.every((m) => m.sync === here));
    // the next threshold of the model is the first mark after the displayed time
    const s = model.solarAt(t);
    const next = mine.find((m) => eng.timeAt(L, i, m.p) > t);
    if (next) assert.equal(next.name, s.threshold.name);
  }
});

test('quarterMarks: marks beyond the clipped end of the catalogue are left out', () => {
  const last = eng.halfCount(4) - 1;
  const frac = eng.fractionOf(4, last);
  const spec = SUN.arcSpec(last, prefixOf(4), frac);
  for (const m of SUN.quarterMarks(spec, grid)) assert.ok(m.p <= frac + 1e-9, `${m.p} <= ${frac}`);
});

test('dialShape: one sync as a sine with the quarter points on it', () => {
  const d = SUN.dialShape(200, 30);
  near(d.at(0).y, d.cy, 1e-9);
  near(d.at(0.25).y, d.cy - d.A, 1e-9);
  near(d.at(0.5).y, d.cy, 1e-9);
  near(d.at(0.75).y, d.cy + d.A, 1e-9);
  near(d.at(1).x, 200 - d.padX, 1e-9);
  assert.deepEqual(d.quarters.map((q) => q.name), ['peak', 'node', 'valley', 'end']);
  assert.match(d.path, /^M[\d.]+ [\d.]+L/);
  assert.equal(d.path.match(/L/g).length, 64);
});

test('drawFocus: the solar ripple, quarter labels and pin appear on an ε arc and stay away from the others', () => {
  const W = 742;
  const H = 526;
  const t = TIMES.A;
  const cur = eng.readHalves(model.frame(t));
  const sy = SUN.syncAt(model.positionOf(t), grid);
  const sunFor = (scene) => ({
    grid,
    spec: SUN.arcSpec(scene.idx, prefixOf(scene.level), scene.fraction),
    sync: sy.sync,
    quarter: Math.floor(sy.phase * 4),
    here: cur[scene.level].idx === scene.idx,
    pNow: cur[scene.level].local,
    label: `#${sy.sync}`,
  });
  const run = (L, sun = true) => {
    const scene = eng.buildFocus(L, cur[L].idx);
    const cam = G.fitCamera(scene.samples, scene.rot, W, H, { l: 46, r: 46, t: 44, b: 40 });
    const view = G.makeView(cam, W, H);
    const { P, texts } = makePainter(W, H);
    const hits = { arcs: [], markers: [], sun: null };
    P.begin();
    drawFocus(P, scene, view, { alpha: 1, cur, markers: eng.markersFor(scene, cur), hover: null, hits, grey: false, eventLabels: scene.desc.marks, letters: LETTERS, quiet: false, avoid: null, nowLabel: 'x', sun: sun ? sunFor(scene) : null });
    return { hits, texts, view, scene };
  };
  const eps = run(4);
  assert.ok(eps.hits.sun, 'the pin of the solar marker is a hover target');
  assert.ok(eps.hits.sun.x > 9 && eps.hits.sun.x < W - 9 && eps.hits.sun.y > 9 && eps.hits.sun.y < H - 9);
  assert.ok(eps.texts.some((x) => x.str === `#${sy.sync}`), 'the pin carries the sync number');
  assert.ok(eps.texts.some((x) => x.str === 'node' || x.str === 'peak'), 'the quarters of the sync are named');
  // the pin stands beside the focus marker, not on it
  const fm = eng.markersFor(eps.scene, cur).find((m) => m.level === 4);
  const fp = eps.view.point(fm.x, fm.y);
  assert.ok(Math.hypot(eps.hits.sun.x - fp.x, eps.hits.sun.y - fp.y) > 9, 'the pin does not hide the dot of the focused depth');
  for (const L of [0, 1, 2, 5, 6, 9, 13]) {
    assert.equal(run(L).hits.sun, null, `depth ${L + 1}: no ripple, no pin (the dial carries the sync there)`);
  }
  assert.equal(run(4, false).hits.sun, null, 'solar wave off: nothing drawn');
  // and a drawing with no solar option is the drawing it was
  assert.ok(!run(4, false).texts.some((x) => /^#\d+$/.test(x.str)));
});

test('drawFocus: a quiet (outgoing) scene draws the ripple without its text', () => {
  const W = 742;
  const H = 526;
  const cur = eng.readHalves(model.frame(TIMES.A));
  const scene = eng.buildFocus(4, cur[4].idx);
  const cam = G.fitCamera(scene.samples, scene.rot, W, H, { l: 46, r: 46, t: 44, b: 40 });
  const view = G.makeView(cam, W, H);
  const { P, texts } = makePainter(W, H);
  const sy = SUN.syncAt(model.positionOf(TIMES.A), grid);
  P.begin();
  drawFocus(P, scene, view, {
    alpha: 0.5, cur, markers: [], hover: null, hits: null, grey: false, eventLabels: null, letters: LETTERS, quiet: true, avoid: null, nowLabel: '',
    sun: { grid, spec: SUN.arcSpec(scene.idx, prefixOf(4), scene.fraction), sync: sy.sync, quarter: 1, here: true, pNow: cur[4].local, label: `#${sy.sync}` },
  });
  assert.equal(texts.length, 0);
});

// ---- the drawing, the pin and the dial: what is actually put on the canvas ----

const FOCUS_PAD = { l: 46, r: 46, t: 44, b: 40 }; // the focus padding of wave.js
const GOLD = (a) => `rgba(255, 214, 10, ${a})`;

/** A 2D context that records every stroke, fill and text with the state it was drawn in (style, width, alpha, path). */
function tracingContext() {
  const ops = [];
  const stack = [];
  const st = { strokeStyle: '', fillStyle: '', lineWidth: 1, globalAlpha: 1 };
  let path = [];
  const g = new Proxy(
    {},
    {
      get(o, k) {
        if (k in st) return st[k];
        switch (k) {
          case 'save': return () => stack.push({ ...st });
          case 'restore': return () => Object.assign(st, stack.pop());
          case 'beginPath': return () => { path = []; };
          case 'moveTo': return (x, y) => path.push({ t: 'M', x, y });
          case 'lineTo': return (x, y) => path.push({ t: 'L', x, y });
          case 'arc': return (x, y, r, a0, a1) => path.push({ t: 'A', x, y, r, a0, a1 });
          case 'stroke': return () => ops.push({ op: 'stroke', style: st.strokeStyle, width: st.lineWidth, alpha: st.globalAlpha, path: [...path] });
          case 'fill': return () => ops.push({ op: 'fill', style: typeof st.fillStyle === 'string' ? st.fillStyle : 'gradient', alpha: st.globalAlpha, path: [...path] });
          case 'fillText': return (str, x, y) => ops.push({ op: 'text', str, x, y, style: st.fillStyle, alpha: st.globalAlpha });
          case 'measureText': return (str) => ({ width: String(str).length * 6.5 });
          case 'createRadialGradient': return () => ({ addColorStop() {} });
          default: return () => {};
        }
      },
      set(o, k, v) {
        st[k] = v;
        return true;
      },
    },
  );
  return { g, ops };
}

/** Draw the focus scene of depth `L` (0-based) at time t on a W x H stage with the solar wave on and return what was drawn. */
function paintFocus(L, t, W, H, { camera = null, quiet = false } = {}) {
  const cur = eng.readHalves(model.frame(t));
  const scene = eng.buildFocus(L, cur[L].idx);
  const view = G.makeView(camera ?? G.fitCamera(scene.samples, scene.rot, W, H, FOCUS_PAD), W, H);
  const rec = tracingContext();
  const P = createPainter({ getContext: () => rec.g, width: 0, height: 0 }, { theme, fonts: { label: '11px x', labelBold: 'bold 12px x', small: '10px x' } });
  P.resize(W, H, 1);
  const sy = SUN.syncAt(model.positionOf(t), grid);
  const spec = SUN.arcSpec(scene.idx, prefixOf(L), scene.fraction);
  const sun = { grid, spec, sync: sy.sync, quarter: SUN.quarterOf(sy.phase), here: cur[L].idx === scene.idx, pNow: cur[L].local, label: `#${sy.sync}` };
  const hits = { arcs: [], markers: [], sun: null };
  P.begin();
  drawFocus(P, scene, view, { alpha: 1, cur, markers: eng.markersFor(scene, cur), hover: null, hits, grey: false, eventLabels: scene.desc.marks, letters: LETTERS, quiet, avoid: null, nowLabel: 'x', sun });
  const sa = view.arc(scene.focus, {});
  const fit = SUN.rippleFit(SUN.syncsOnArc(prefixOf(L), scene.fraction, grid), sa.r * Math.abs(sa.sweep) * scene.fraction);
  return { ops: rec.ops, hits, scene, view, sa, fit, cur, spec, sun, amp: SUN.rippleAmp(fit.wavelength), sy, travelled: Math.min(scene.fraction, G.travelled(scene.idx, cur[L])) };
}
const isPinStem = (o) => o.op === 'stroke' && o.style === GOLD(0.85) && o.width === 1.3 && o.path.length === 2;
const isDot = (o) => o.op === 'fill' && o.path.length === 1 && o.path[0].t === 'A' && (o.path[0].r === 2.2 || o.path[0].r === 3.2) && (o.style === GOLD(0.85) || o.style === 'rgba(11, 16, 21, 0.9)');
const at = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

test('drawFocus: the pin stands on the ripple at the displayed time (its angle, its height), its head floats beyond it', () => {
  let offCentre = 0;
  for (const t of [TIMES.A, TIMES.B, TIMES.C, 125593320.5 + 40000]) {
    const r = paintFocus(4, t, 742, 526);
    assert.ok(r.fit.visible, 'ε carries a ripple on this stage');
    const stems = r.ops.filter(isPinStem);
    assert.equal(stems.length, 1, 'one pin');
    const [foot, headEnd] = stems[0].path;
    const local = r.cur[4].local;
    if (Math.abs(local - 0.5) > 0.03) offCentre++;
    // the angle is the carrier's at the progress of the displayed time on the arc (not mirrored, not the middle) ...
    const ang = r.sa.a0 + r.sa.sweep * local;
    near(Math.atan2(foot.y - r.sa.y, foot.x - r.sa.x), Math.atan2(Math.sin(ang), Math.cos(ang)), 1e-9, `angle @ ${t}`);
    // ... and the height is the ripple's: amplitude x sin of the model's own sync phase
    const phase = model.solarAt(t).phase;
    const d = Math.hypot(foot.x - r.sa.x, foot.y - r.sa.y) - r.sa.r;
    near(d, r.amp * Math.sin(2 * Math.PI * phase), 1e-6, `height @ ${t}`);
    // the head stands 17 px beyond the carrier (beyond the ripple when that is outward), on the same normal
    const head = r.hits.sun;
    near(Math.hypot(head.x - r.sa.x, head.y - r.sa.y), r.sa.r + 17 + Math.max(0, d), 1e-6);
    near(Math.atan2(head.y - r.sa.y, head.x - r.sa.x), Math.atan2(foot.y - r.sa.y, foot.x - r.sa.x), 1e-9);
    near(Math.hypot(headEnd.x - head.x, headEnd.y - head.y), 4, 1e-9, 'the stem ends 4 px short of the head');
    // the library of geometry says the same
    const pin = SUN.pinGeometry(r.sa, r.spec, grid, local, r.amp);
    assert.ok(at(pin.foot, foot) && at(pin.head, head));
  }
  assert.ok(offCentre >= 3, 'the instants are not all at the middle of their arc, where a mirrored pin would look right');
});

test('drawFocus: the ripple is bright up to the displayed time and dimmer (at least 3:1) after it', () => {
  for (const t of [TIMES.A, TIMES.B]) {
    const r = paintFocus(4, t, 742, 526);
    const { n } = SUN.ripplePoints(r.sa, r.spec, grid, { amp: r.amp });
    const split = SUN.rippleSplit(n, r.travelled, r.scene.fraction);
    assert.ok(split > n * 0.05 && split < n * 0.95, 'the displayed time is inside the arc');
    const bright = r.ops.find((o) => o.op === 'stroke' && o.style === GOLD(0.92));
    const rest = r.ops.find((o) => o.op === 'stroke' && o.style === GOLD(REST_ALPHA));
    assert.ok(bright && rest, 'both stretches are drawn');
    assert.equal(bright.path.length, split + 1, 'bright: from the start of the arc to the displayed time');
    assert.equal(rest.path.length, n - split + 1, 'dim: the rest');
    assert.ok(at(bright.path.at(-1), rest.path[0]), 'they meet');
    const pts = SUN.ripplePoints(r.sa, r.spec, grid, { amp: r.amp });
    assert.ok(Math.hypot(bright.path[0].x - pts.xs[0], bright.path[0].y - pts.ys[0]) < 1e-6 && Math.hypot(rest.path.at(-1).x - pts.xs[n], rest.path.at(-1).y - pts.ys[n]) < 1e-6);
    const foot = r.ops.find(isPinStem).path[0];
    assert.ok(Math.hypot(bright.path.at(-1).x - foot.x, bright.path.at(-1).y - foot.y) < 3, 'the bright part ends at the pin (to a polyline step)');
    assert.equal(bright.alpha, 1);
  }
});

/** WCAG relative luminance and contrast of sRGB colours. */
const lum = ([r, g, b]) => [r, g, b].map((c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));

test('contrast: the not-yet-travelled parts of the yellow wave are at least 3:1 on the dark panel (WCAG 1.4.11)', () => {
  const gold = [255, 214, 10];
  // the darkest and the lightest the canvas and the dial strip are behind the wave
  const backgrounds = [[11, 16, 21], [14.7, 26.6, 30.7], [21, 29, 38], over(gold, [21, 29, 38], 0.035)];
  for (const bg of backgrounds) {
    assert.ok(contrast(over(gold, bg, REST_ALPHA), bg) >= 3, `the rest of the ripple (alpha ${REST_ALPHA}) on ${bg.map(Math.round)}: ${contrast(over(gold, bg, REST_ALPHA), bg).toFixed(2)}`);
    assert.ok(contrast(over(gold, bg, 0.36), bg) < 3, 'and the old 0.36 was below the floor, so the test does measure');
  }
  const css = fs.readFileSync(new URL('../src/styles/wave.css', import.meta.url), 'utf8');
  const base = /\.wave-sun-base \{[^}]*stroke: rgb\(255 214 10 \/ ([\d.]+)\)/.exec(css);
  assert.ok(base, 'the dial wave to come has a gold stroke');
  for (const bg of backgrounds) assert.ok(contrast(over(gold, bg, Number(base[1])), bg) >= 3, `the dial wave to come (alpha ${base[1]}) on ${bg.map(Math.round)}`);
  const quarter = /\.wave-sun-q \{[^}]*stroke: rgb\(255 214 10 \/ ([\d.]+)\)/.exec(css);
  for (const bg of backgrounds) assert.ok(contrast(over(gold, bg, Number(quarter[1])), bg) >= 3, 'the quarter points still to come');
});

test('drawFocus: quarter dots are filled once passed, ringed while coming, and the next one is larger', () => {
  for (const t of [TIMES.A, TIMES.B, TIMES.C]) {
    const r = paintFocus(4, t, 742, 526);
    const marks = SUN.quarterMarks(r.spec, grid);
    assert.ok(marks.length >= 6);
    const dots = r.ops.filter(isDot);
    assert.equal(dots.length, marks.length, 'a wide wave (a quarter of it 40 px or more) marks every sync on the arc');
    let passedN = 0;
    for (const m of marks) {
      const pt = SUN.ripplePointAt(r.sa, r.spec, grid, Math.min(r.scene.fraction, Math.max(0, m.p)), r.amp);
      const dot = dots.find((o) => at(o.path[0], pt));
      assert.ok(dot, `${m.name} of sync ${m.sync}`);
      const passed = m.sync < r.sy.sync || (m.sync === r.sy.sync && m.k <= r.sun.quarter);
      const next = m.sync === r.sy.sync && m.k === r.sun.quarter + 1;
      assert.equal(dot.path[0].r, next ? 3.2 : 2.2, `${m.name} of sync ${m.sync}: the coming one is larger`);
      const ring = r.ops.find((o) => o.op === 'stroke' && o.path.length === 1 && at(o.path[0], pt));
      if (passed) {
        passedN++;
        assert.equal(dot.style, GOLD(0.85), `${m.name} of sync ${m.sync} is filled`);
        assert.equal(ring, undefined, 'and has no ring');
      } else {
        assert.equal(dot.style, 'rgba(11, 16, 21, 0.9)', `${m.name} of sync ${m.sync} is hollow`);
        assert.ok(ring, 'and ringed');
        assert.equal(ring.style, GOLD(next ? 1 : 0.6));
        assert.equal(ring.width, next ? 1.6 : 1.1);
      }
    }
    assert.ok(passedN >= 1 && passedN < marks.length, 'some passed, some to come');
  }
});

test('drawFocus: a tight wave marks only the sync of the displayed time; a pin and its label fade together with the ripple', () => {
  // a stage on which the wave at δ is between the minimum and full strength
  let r = null;
  for (let W = 330; W <= 460 && !r; W += 5) {
    const c = paintFocus(3, TIMES.A, W, Math.round(W * 1.17));
    if (c.fit.visible && c.fit.strength > 0.5 && c.fit.strength < 0.95 && c.fit.wavelength / 4 < 40) r = c;
  }
  assert.ok(r, 'a phone-sized stage with a faint δ ripple exists');
  const dots = r.ops.filter(isDot);
  const mine = SUN.quarterMarks(r.spec, grid, r.sy.sync);
  assert.equal(dots.length, mine.length, 'only the sync of the displayed time');
  assert.ok(mine.length >= 3 && mine.length <= 4);
  assert.ok(SUN.quarterMarks(r.spec, grid).length > 8, 'and the arc carries many more');
  // everything of the solar wave is drawn at the fit strength: the ripple, the stem, the dots and the label
  const s = r.fit.strength;
  assert.ok(r.ops.filter((o) => o.op === 'stroke' && (o.style === GOLD(0.92) || o.style === GOLD(REST_ALPHA) || isPinStem(o))).every((o) => Math.abs(o.alpha - s) < 1e-9));
  assert.ok(dots.every((o) => Math.abs(o.alpha - s) < 1e-9));
  const label = r.ops.find((o) => o.op === 'text' && o.str === `#${r.sy.sync}`);
  assert.ok(label, 'the pin carries its number');
  assert.ok(Math.abs(label.alpha - s) < 1e-9 && label.alpha < 0.95, `the label fades with the pin: ${label.alpha} vs strength ${s}`);
  // a comfortable wave is drawn at full strength
  const full = paintFocus(4, TIMES.A, 742, 526);
  assert.equal(full.fit.strength, 1);
  assert.equal(full.ops.find((o) => o.op === 'text' && o.str === `#${full.sy.sync}`).alpha, 1);
});

test('drawFocus: a pin whose head would leave the canvas is not drawn and is not a target', () => {
  const t = TIMES.A;
  const scene = eng.buildFocus(4, eng.readHalves(model.frame(t))[4].idx);
  let inside = 0;
  let outside = 0;
  for (let cx = -1.2; cx <= 1.2; cx += 0.2) {
    for (let cy = -1.2; cy <= 1.2; cy += 0.2) {
      const r = paintFocus(4, t, 600, 400, { camera: { cx, cy, scale: 260, rot: scene.rot } });
      const stems = r.ops.filter(isPinStem);
      if (r.hits.sun) {
        inside++;
        assert.equal(stems.length, 1);
        assert.ok(r.hits.sun.x >= 9 && r.hits.sun.x <= 591 && r.hits.sun.y >= 9 && r.hits.sun.y <= 391, `head at ${r.hits.sun.x},${r.hits.sun.y}`);
      } else {
        outside++;
        assert.equal(stems.length, 0, 'no stem without a head');
        assert.equal(r.ops.filter((o) => o.op === 'text' && o.str === `#${r.sy.sync}`).length, 0, 'and no label');
      }
    }
  }
  assert.ok(inside > 5 && outside > 5, `both cases occur (${inside} inside, ${outside} outside)`);
});

test('ripplePoints and quarterMarks on a clipped arc and a whole sync', () => {
  const idx = 18628;
  const sa = { x: 300, y: 400, r: 200, a0: -Math.PI, sweep: Math.PI };
  const spec = SUN.arcSpec(idx, prefixOf(4), 0.5);
  const { xs, ys, n } = SUN.ripplePoints(sa, spec, grid, { amp: 8 });
  assert.equal(n, Math.ceil((sa.r * Math.PI * 0.5) / 2), 'the polyline covers the half of the arc that is inside the catalogue');
  const end = SUN.ripplePointAt(sa, spec, grid, 0.5, 8);
  near(xs[n], end.x, 1e-9);
  near(ys[n], end.y, 1e-9);
  near(Math.atan2(ys[n] - sa.y, xs[n] - sa.x), sa.a0 + sa.sweep * 0.5, 1e-9, 'it stops at the middle of the arc, not at its end');
  // a whole sync has exactly its four quarters: peak, node, valley and the end
  const whole = SUN.arcSpec(idx, prefixOf(4), 1);
  const c0 = SUN.syncCoord(whole.pos0, grid);
  const c1 = SUN.syncCoord(whole.pos0 + whole.span, grid);
  const s = Math.ceil(c0);
  assert.ok(s + 1 <= c1, 'a whole sync fits on the ε arc');
  const q = SUN.quarterMarks(whole, grid, s);
  assert.deepEqual(q.map((m) => [m.k, m.name]), [[1, 'peak'], [2, 'node'], [3, 'valley'], [4, 'end']]);
  near(q[3].coord, s + 1, 1e-12, 'the end is the start of the next sync');
  assert.deepEqual(SUN.quarterMarks(whole, grid, s - 1).map((m) => m.k), [1, 2, 3, 4].filter((k) => s - 1 + k / 4 >= c0), 'the sync before has only the quarters that lie on the arc');
});

test('solar decisions: the quarter, the travel time, the pin drag, the bright stretch', () => {
  assert.deepEqual([0, 0.2499, 0.25, 0.4999, 0.5, 0.7499, 0.75, 0.9999, 1].map(SUN.quarterOf), [0, 0, 1, 1, 2, 2, 3, 3, 3]);
  assert.equal(SUN.quarterOf(-0.1), 0);
  // the dial and the pin travel time-linearly inside the sync, kept a millisecond inside it
  assert.equal(SUN.travelTime(1000, 2000, 0.5), 1500, 'half way is half the sync, not a quarter, not all of it');
  assert.equal(SUN.travelTime(1000, 2000, 0.25), 1250);
  assert.equal(SUN.travelTime(1000, 2000, 0), 1000.001);
  assert.equal(SUN.travelTime(1000, 2000, 1), 1999.999);
  assert.equal(SUN.travelTime(1000, 2000, 7), 1999.999);
  assert.equal(SUN.travelTime(1000, 2000, -3), 1000.001);
  const s = model.solarAt(TIMES.A);
  for (const ph of [0.1, 0.5, 0.9]) near(model.solarAt(SUN.travelTime(s.start, s.end, ph)).phase, ph, 1e-6, `phase ${ph} lands on phase ${ph}`);
  assert.equal(model.solarAt(SUN.travelTime(s.start, s.end, 0)).sync, s.sync, 'the first millisecond is inside the sync');
  assert.equal(model.solarAt(SUN.travelTime(s.start, s.end, 1)).sync, s.sync, 'and the last');
  // dragging the pin along the arc: the phase inside the sync of the pin, held at the ends
  const spec = SUN.arcSpec(18628, prefixOf(4), 1);
  const c0 = SUN.syncCoord(spec.pos0, grid);
  const sync = Math.ceil(c0) + 0;
  const tAt = (coord) => (SUN.positionOfCoord(coord, grid) - spec.pos0) / spec.span;
  near(SUN.pinPhase(spec, grid, tAt(sync + 0.25), sync), 0.25, 1e-9);
  near(SUN.pinPhase(spec, grid, tAt(sync + 0.8), sync), 0.8, 1e-9);
  assert.equal(SUN.pinPhase(spec, grid, tAt(sync - 0.5), sync), 0, 'before the sync: its start');
  assert.equal(SUN.pinPhase(spec, grid, tAt(sync + 1.5), sync), 1, 'after the sync: its end');
  // the bright stretch of the ripple ends at the displayed time
  assert.equal(SUN.rippleSplit(100, 0.5, 1), 50);
  assert.equal(SUN.rippleSplit(100, 0.25, 0.5), 50, 'a clipped arc counts its progress against the part that exists');
  assert.equal(SUN.rippleSplit(100, 0, 1), 0);
  assert.equal(SUN.rippleSplit(100, 2, 1), 100);
});

test('the dial: the dot, the bright stretch, the passed and the coming quarters, the slider value', () => {
  const shape = SUN.dialShape(220, 30);
  const mk = (phase, quarter, name) => ({ phase, quarter, threshold: { name } });
  const a = SUN.dialState(shape, mk(0.6, 2, 'valley'));
  near(a.x, shape.at(0.6).x, 1e-12);
  near(a.y, shape.at(0.6).y, 1e-12);
  assert.ok(a.x > 110 && a.y > shape.cy, 'past the middle, below the axis (the valley is coming)');
  assert.equal(a.dash, '0.6000');
  assert.equal(a.valuenow, 153);
  assert.deepEqual(a.quarters.map((q) => q.past), [true, true, false, false], 'peak and node are behind');
  assert.deepEqual(a.quarters.map((q) => q.next), [false, false, true, false], 'the valley is the coming one');
  assert.deepEqual(a.quarters.map((q) => q.r), [2.2, 2.2, 3.4, 2.2]);
  assert.deepEqual(a.quarters.map((q) => q.name), ['peak', 'node', 'valley', 'end']);
  const b = SUN.dialState(shape, mk(0.1, 0, 'peak'));
  assert.deepEqual(b.quarters.map((q) => [q.past, q.next]), [[false, true], [false, false], [false, false], [false, false]]);
  assert.equal(b.valuenow, 25);
  const c = SUN.dialState(shape, mk(0.9999, 3, 'end'));
  assert.deepEqual(c.quarters.map((q) => [q.past, q.next]), [[true, false], [true, false], [true, false], [false, true]]);
  assert.equal(c.valuenow, 255);
  // one tick of the model's own clock reads as the dial does
  const s = model.solarAt(TIMES.A);
  const d = SUN.dialState(shape, s);
  assert.equal(d.quarters.filter((q) => q.past).length, s.quarter);
  assert.equal(d.quarters.findIndex((q) => q.next), s.quarter);
  assert.equal(['peak', 'node', 'valley', 'end'][s.quarter], s.threshold.name, 'the coming quarter is the one the model names');
});

test('parseFlag: only 1 / 0 / true / false are an answer, in any case; everything else says nothing', () => {
  for (const v of ['1', 'true', 'TRUE', ' True ']) assert.equal(parseFlag(v), true, v);
  for (const v of ['0', 'false', 'False', ' FALSE ']) assert.equal(parseFlag(v), false, v);
  for (const v of ['off', 'no', 'yes', 'on', 'banana', '', ' ', '2', '0.0', '%200', 'null']) assert.equal(parseFlag(v), null, `"${v}"`);
  assert.equal(parseFlag(null), null, 'no parameter at all');
  assert.equal(parseFlag(undefined), null);
});

test('a ?solar= link is a per-page override: the remembered setting and what is stored do not follow it', () => {
  // the link says on, nothing remembered: this page shows it, the memory stays off, and a later write (any unrelated click) keeps it off
  const a = solarAtLoad('1', {});
  assert.deepEqual(a, { shown: true, remembered: false });
  assert.deepEqual(storedSettings({ overview: true, solarRemembered: a.remembered }), { overview: true, solar: false });
  // the link says off over a remembered on
  const b = solarAtLoad('0', { solar: true });
  assert.deepEqual(b, { shown: false, remembered: true });
  assert.equal(storedSettings({ overview: false, solarRemembered: b.remembered }).solar, true);
  // no link, or one that says nothing (off, no, banana): the remembered setting
  for (const v of [null, '', 'off', 'no', 'banana', '2']) {
    assert.deepEqual(solarAtLoad(v, { solar: true }), { shown: true, remembered: true }, `"${v}"`);
    assert.deepEqual(solarAtLoad(v, { solar: false }), { shown: false, remembered: false }, `"${v}"`);
    assert.deepEqual(solarAtLoad(v, null), { shown: false, remembered: false });
    assert.deepEqual(solarAtLoad(v, { solar: 'yes' }), { shown: false, remembered: false }, 'only a true is on');
  }
  assert.deepEqual(storedSettings({ overview: 1, solarRemembered: 0 }), { overview: true, solar: false });
});

test('revisions 2 and 3: no half unit, no "beat", no retired unit name, no minor fracton name anywhere in the wave view', () => {
  const dir = new URL('../src/ui/wave/', import.meta.url);
  const files = [new URL('../src/ui/wave.js', import.meta.url), new URL('../src/styles/wave.css', import.meta.url), ...fs.readdirSync(dir).map((f) => new URL(f, dir))];
  const half = new RegExp(`[αβγδεζηθικλμνξ]\u00bd`);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, half, `${f.pathname}: a half-cycle unit`);
    assert.doesNotMatch(src, /\bbeats?\b/i, `${f.pathname}: the retired word "beat"`);
    assert.doesNotMatch(src, /\b(Hadron|Quark|Chromon|Somon|Atom)s?\b/, `${f.pathname}: a retired unit name`);
    assert.doesNotMatch(src, /\b(Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi)\s+\w*fracton\b/, `${f.pathname}: a minor fracton name`);
  }
});

test('the solar wave is not narrated by the module twice: no old thresholds are left in the source', () => {
  const src = ['src/ui/wave.js', 'src/ui/wave/solar.js', 'src/ui/wave/draw.js', 'src/ui/wave/sun.js', 'src/ui/wave/words.js'].map((f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /\b18 px\b|0\.28 \* S\.w|rippleLevels|at least two/, 'the estimate of the hint and the old wording are gone');
});

// ================================================================== pure mode wording ====

const pureT = createPure(model, { now: () => TIMES.A });
const flag = { on: false };
const words = createWords({ fmt, pure: pureT, model, theme, isPure: () => flag.on });
const HARD = RULES.filter(([, , sev]) => sev === 'hard');
/** The text a person sees or hears in an HTML string: its text content and its aria-labels / titles. */
function seen(html) {
  const attrs = [...String(html).matchAll(/(?:aria-label|title)="([^"]*)"/g)].map((m) => m[1]);
  return [String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'), ...attrs];
}
function assertClean(str, where) {
  // "a solar day" names the Sun's return the Pentads count against (SPEC §7.5: "4¾η is a solar day"), not an Earth unit
  for (const text of seen(str).map((x) => x.replace(/\bsolar day\b/g, 'solar turn'))) {
    for (const [id, re] of HARD) assert.doesNotMatch(text, re, `${where}: ${id} in "${text}"`);
  }
}

test('pureSpan counts on the ladder α β γ δ ε η ι λ ν, skips empty parts and writes what is shorter than ten Blinks as a decimal', () => {
  // half of a ζ cycle is 5.5 η: the span of one ζ half-arc
  assert.equal(pureSpan(pureT, 2 / 11375), '5η 18ι');
  assert.equal(pureSpan(pureT, (2 / 11375) * 1.5), '8η 9ι');
  assert.equal(pureSpan(pureT, 4), '1α');
  assert.equal(pureSpan(pureT, 0), '0ν', 'nothing is nothing');
  assert.equal(pureSpan(pureT, -(2 / 11375) * 1.5), '−8η 9ι');
  const nu = pureT.unitPos(pureT.unitOf('nu'));
  assert.equal(pureSpan(pureT, 0.5 * nu), '0.5ν', 'below one Blink: a decimal count of it, not "0ν"');
  assert.equal(pureSpan(pureT, 0.004 * nu), '0.004ν');
  assert.equal(pureSpan(pureT, 3.4 * nu, 1), '3.4ν', 'a few Blinks keep a decimal as well');
  assert.equal(pureSpan(pureT, 0.00004 * nu), '0ν');
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((l) => words.cycleLength(model.levelInfo(l)) && 0), new Array(14).fill(0));
  flag.on = true;
  // SPEC §15.4: depths 1–5, 7, 9, 11, 13 are one unit each; the depths between are whole counts of the next unit
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((l) => words.cycleLength(model.levelInfo(l))), ['1α', '1β', '1γ', '1δ', '1ε', '11η', '1η', '4ι', '1ι', '13λ', '1λ', '5ν', '1ν', '0.14ν']);
  assert.deepEqual(
    [0, 3, 4, 5, 6, 9, 12, 13].map((l) => cycleNamedPure(pureT, model.levelInfo(l))),
    ['1α = 5β', '1δ = 5ε', '1ε (Nuclide) = 77η', '11η', '1η (Helion) = 36ι', '13λ', '1ν (Blink)', '0.14ν'],
  );
  assert.equal(words.chipTitle(model.levelInfo(6)), 'η · depth 7 · one cycle = 1η (Helion) = 36ι · 9 child half-arcs per half-arc');
  assert.equal(words.chipAria(model.levelInfo(6)), 'Depth 7, η, one cycle is 1η (Helion) = 36ι');
  assert.equal(words.chipTitle(model.levelInfo(7)), 'θ · depth 8 · one cycle = 4ι · 4 child half-arcs per half-arc', 'θ is no unit');
  flag.on = false;
  assert.match(words.chipTitle(model.levelInfo(6)), /^η · depth 7 · cycle ≈ 5 h 3 min · 9 child half-arcs per half-arc$/);
  assert.equal(words.chipAria(model.levelInfo(6)), 'Depth 7, η, cycle about 5 h 3 min');
});

test('pureCountdown measures in position, so it is exact across eclipse intervals', () => {
  const cyc = model.levelAt(TIMES.A, 6);
  assert.equal(pureCountdown(pureT, model, cyc.start, cyc.end, 1), 'in 1η');
  assert.equal(pureCountdown(pureT, model, cyc.end, cyc.start, 1), '1η ago');
  assert.equal(pureCountdown(pureT, model, TIMES.A, cyc.end), 'in 6ι 43λ', 'SPEC §15.6');
  assert.match(pureCountdown(pureT, model, model.tMin - 1e9, model.tMin + 5, 1), /^in \d+[αβγ]/, 'outside the catalogue it still counts');
});

test('chainText is the stamp of the start of a cycle: majors and the Nuclide as ordinals, then the Helion (from 1) and the counts that place it', () => {
  for (const L of [3, 4, 6]) {
    const cur = model.levelAt(TIMES.A, L);
    assert.equal(chainText(pureT, model, L, cur.cycle, 9), pureT.addressAt(TIMES.A, L), `depth ${L + 1}`);
  }
  for (const L of [0, 2]) assert.ok(pureT.addressAt(TIMES.A, L).startsWith(chainText(pureT, model, L, model.levelAt(TIMES.A, L).cycle, 9)));
  assert.equal(chainText(pureT, model, 4, model.levelAt(TIMES.A, 4).cycle), 'α#6 β#4 γ#9 δ#3 ε#5');
  assert.equal(chainText(pureT, model, 7, model.levelAt(TIMES.A, 7).cycle, 9), 'α#6 β#4 γ#9 δ#3 ε#5 34η 28ι', 'a θ starts at 28ι');
  const deep = chainText(pureT, model, 9, model.levelAt(TIMES.A, 9).cycle);
  assert.equal(deep, '… δ#3 ε#5 34η 29ι 13λ', 'a long address keeps its last five links');
  assert.doesNotMatch(chainText(pureT, model, 9, model.levelAt(TIMES.A, 9).cycle, 9), /[ζθικ]#/, 'no ordinals for minor depths');
});

test('nowLabelPure writes three consecutive tokens of the stamp, chosen by the depth of the arc', () => {
  const t = TIMES.A;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 13].map((L) => nowLabelPure(pureT, t, L)), ['α#6 β#4 γ#9', 'β#4 γ#9 δ#3', 'γ#9 δ#3 ε#5', 'δ#3 ε#5 34η', 'ε#5 34η 29ι', '34η 29ι 21λ', '34η 29ι 21λ', '34η 29ι 21λ']);
  assert.equal(nowLabelPure(pureT, model.tMax + 10, 6), '—');
  // the Helion is numbered from 1: the first moment of a Nuclide reads 1η, never 0η
  const nuclideStart = model.levelAt(t, 4).start + 0.001;
  assert.equal(nowLabelPure(pureT, nuclideStart, 6), '1η 0ι 0λ');
  for (const L of [0, 1, 2, 3, 4, 5, 6]) {
    for (const time of [TIMES.A, TIMES.B, TIMES.C, 125593320.5]) {
      const label = nowLabelPure(pureT, time, L);
      assert.ok(pureT.stamp(time, 'lambda').includes(label), `depth ${L + 1} @ ${time}: "${label}" in "${pureT.stamp(time, 'lambda')}"`);
      assert.doesNotMatch(label, /(?<!\d)(?:[δεζ]|[ηιλ]) \d/, 'no "δ 3" or "η 3": an ordinal has a #, a count has its unit after the number');
    }
  }
});

test('cyclePure and whenPure: a major cycle in words, a minor one by where it starts; countdowns on the ladder', () => {
  const plain = (str) => str.replace(/\u00a0/g, ' '); // "6 of 18" never breaks across lines
  assert.ok(cyclePure(pureT, eng.describe(0, 11)).includes('6\u00a0of\u00a018'));
  const cur = eng.readHalves(model.frame(TIMES.A));
  const d = eng.describe(6, cur[6].idx); // the closing (trough) half of the 34th Helion of ε#5
  assert.equal(plain(cyclePure(pureT, d)), 'closing half of ε#5 34η');
  const e = eng.describe(4, cur[4].idx);
  assert.equal(plain(cyclePure(pureT, e)), 'opening half of ε#5');
  assert.equal(plain(cyclePure(pureT, eng.describe(3, cur[3].idx))), 'closing half of Delta Trifracton · 3 of 5 in γ');
  assert.equal(plain(cyclePure(pureT, eng.describe(0, 11))), 'closing half of Alpha Hexafracton · 6 of 18');
  assert.equal(plain(cyclePure(pureT, eng.describe(7, cur[7].idx))), 'opening half of ε#5 34η 28ι', 'θ is no unit: it is placed by its start');
  assert.equal(whenPure(pureT, model, d, TIMES.A), 'ends in 6ι 43λ');
  assert.match(whenPure(pureT, model, d, d.start - 100), /^starts in /);
  assert.match(whenPure(pureT, model, d, d.end + 100), /^ended .* ago$/);
  assert.equal(halfLengthPure(pureT, model, d), '18ι', 'half of a Helion: 18 Preons');
  assert.equal(halfLengthPure(pureT, model, e), '38η 18ι', 'half of a Nuclide: 38.5 Helions');
  // the quarter word of a half-arc reading: the crest holds Peak and Node, the trough Valley and End
  assert.deepEqual([0.1, 0.6].map((x) => quarterWord(pureT, cyclePhaseOf({ crest: true }, x))), ['Peak', 'Node']);
  assert.deepEqual([0.1, 0.6].map((x) => quarterWord(pureT, cyclePhaseOf({ crest: false }, x))), ['Valley', 'End']);
});

test('nextLinesPure takes the decisions of nextLines with pure countdowns', () => {
  const t = TIMES.A;
  const cur = eng.readHalves(model.frame(t));
  for (const L of [0, 3, 6, 9, 13]) {
    const d = eng.describe(L, cur[L].idx);
    const a = nextLines(fmt, eng, d, cur[L], t);
    const b = nextLinesPure(pureT, model, eng, d, cur[L], t);
    assert.deepEqual(b.map((x) => x.dim), a.map((x) => x.dim), `depth ${L + 1}: same lead-in words`);
    assert.deepEqual(b.map((x) => !!x.text), a.map((x) => !!x.text));
    for (const x of b) if (/^in /.test(x.text)) assert.match(x.text, /^in [\d<.]+[α-ω]/);
  }
  // the last half-arc of the catalogue says so, in pure terms too
  const lastT = model.tMax - 0.5;
  const lcur = eng.readHalves(model.frame(lastT));
  const d = eng.describe(0, lcur[0].idx);
  assert.equal(nextLinesPure(pureT, model, eng, d, lcur[0], lastT)[1].dim, 'catalogue ends here');
});

test('eclipse labels: numbered like the position (#0 is the first), years otherwise; the catalogue has 35 α half-arcs on eclipses #0, #2 ... #68', () => {
  // updated deliberately: the junction of α half-arc i is eclipse #(2i) (it sat at #(2i + 1)), the end of the catalogue #(extent)
  const e = eclipseLabels(pureT, model, eng.halfCount(0));
  assert.equal(e.marks.length, 35);
  assert.deepEqual([e.marks[0], e.marks[1], e.marks[11], e.marks[34], e.end], ['#0', '#2', '#22', '#68', '#69']);
  assert.equal(model.extent, 69);
  for (let i = 0; i < 35; i++) assert.equal(e.marks[i], pureT.eclipseName(2 * i), 'the same name every view gives eclipse k');
  // eclipse k sits at pos k: the junction of half-arc 11 is where the position is 22
  near(model.positionOf(eng.timeAt(0, 11, 0)), 22, 1e-9);
  near(model.positionOf(model.tMax), 69, 1e-9);
  flag.on = true;
  assert.deepEqual(words.eclipses(35), e);
  flag.on = false;
  const y = words.eclipses(35);
  assert.deepEqual([y.marks[0], y.end], ['1613', '2857']);
  assert.match(y.marks[10], /^\d{4}$/);
});

test('pure mode: every text the wave module can produce is free of Gregorian, Earth units, percentages and zones', () => {
  flag.on = true;
  let n = 0;
  const check = (str, where) => {
    assertClean(str, where);
    for (const text of seen(str)) {
      assert.doesNotMatch(text, /(?<!\d)(?:[δεζ]|[ηιλ]) \d|\u00bd/, `${where}: an old-style "δ 3" / "η 3" or a half unit in "${text}"`);
      assert.doesNotMatch(text, /\b(Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi)\s+\w*fracton\b|\b(Hadron|Quark|Chromon|Somon|Atom)\b/, `${where}: a retired name in "${text}"`);
      assert.doesNotMatch(text, /[ζθκμ]#\d/, `${where}: an ordinal for a depth that is no unit in "${text}"`);
    }
    n++;
  };
  const instants = [TIMES.A, TIMES.B, TIMES.C, TIMES.early, TIMES.late, TIMES.mid, 125593320.5];
  for (const t of instants) {
    const frame = model.frame(t);
    const cur = eng.readHalves(frame);
    for (let L = 0; L <= 13; L++) {
      const h = cur[L];
      const d = eng.describe(L, h.idx);
      const w = `t=${t} depth ${L + 1}`;
      check(words.span(d), w + ' span');
      check(words.loop(d), w + ' loop');
      check(words.cycle(d), w + ' cycle');
      check(words.when(d, t), w + ' when');
      check(words.nowLabel({ t, level: L, duration: d.duration }), w + ' now label');
      check(words.announce(d, t), w + ' announce');
      check(words.chipLive('Depth', d, h), w + ' chip');
      check(words.canvasLabel(d, h.local), w + ' canvas label');
      check(words.cycleLength(model.levelInfo(L)), w + ' cycle length');
      check(words.chipTitle(model.levelInfo(L)), w + ' chip title');
      check(words.chipAria(model.levelInfo(L)), w + ' chip label');
      check(words.halfLength(model.levelInfo(L)), w + ' half length');
      for (const x of words.nextLines(eng, d, h, t)) check(`${x.dim} ${x.text}`, w + ' next');
      for (const marker of [false, true]) check(words.tip({ d, p: h.local, at: marker ? null : eng.timeAt(L, h.idx, 0.4), now: t, marker, action: 'Click to jump here' }), w + ' tip');
      check(words.share(h.local, 'half-arc phase', 1), w + ' share');
      check(words.sunNumber({ sync: 4820 }), 'sync number');
    }
    check(words.overviewLabel(eng.describe(0, cur[0].idx)), 'overview label');
    check(words.alphaSpan(eng.describe(0, cur[0].idx)), 'alpha span');
    const s = model.solarAt(t);
    if (s) {
      for (const f of ['sunNext', 'sunDrift', 'sunDriftLine', 'sunAria', 'sunPhaseText']) check(words[f](s, t), f);
      for (const by of ['pin', 'dial', 'key']) {
        check(words.sunTip(s, t, { by }), `sun tip ${by}`);
        check(words.sunTip(s, t, { by, touch: true }), `sun tip ${by} touch`);
      }
      check(words.sunEdgeTip(s.sync), 'sun edge tip');
    }
  }
  for (const t of [model.tMin - 5e9, model.tMin - 1, model.tMax + 10, model.tMax + 4e9]) check(words.outOfRange(t), `out of range ${t}`);
  for (const f of ['catalogueSpan', 'sunDefinition', 'sunToggleTitle', 'sunCaption', 'sunLegend', 'sunEdge', 'sunKeys', 'eclipseLegend', 'glossaryHint']) check(words[f](), f);
  check(words.catalogueTitle(35), 'catalogue title');
  check(words.sunAria(null, TIMES.A), 'sun aria at the edge');
  check(words.sunRange([3, 4]), 'range');
  check(words.sunRange([2, 4]), 'range with a gap');
  check(words.sunRange([]), 'empty range');
  check(words.sunNumber({ sync: -6718 }), 'negative sync');
  const e = words.eclipses(35);
  for (const x of [...e.marks, e.end]) check(x, 'eclipse label');
  flag.on = false;
  assert.ok(n > 700, `${n} texts checked`);
});

test('pure mode: the readings are Fractonica names, durations and glyph pairs', () => {
  flag.on = true;
  const t = TIMES.A;
  const cur = eng.readHalves(model.frame(t));
  const d = eng.describe(4, cur[4].idx);
  assert.equal(words.span(d), 'α#6 β#4 γ#9 δ#3 ε#5');
  assert.match(words.share(0.5, 'half-arc phase'), /aria-label="half-arc phase 8 and 0 of 256"/, 'the helper\'s spoken form: updated deliberately (it read "8·0")');
  assert.doesNotMatch(words.share(0.5, 'x'), /<title>|vector CBT/, 'no native tooltip from the library glyphs');
  assert.equal((words.share(0.5, 'x').match(/<svg/g) || []).length, 2, 'two glyphs');
  assert.equal(words.catalogueSpan(), 'α#1 – α#18');
  assert.equal(words.alphaSpan(eng.describe(0, 11)), 'pos 22 → 24');
  assert.equal(words.alphaSpan(eng.describe(0, 34)), 'pos 68 → 69');
  assert.match(words.catalogueTitle(35), /35 α half-arcs, α#1 – α#18$/);
  assert.match(words.outOfRange(model.tMax + 4e9), /^Outside the Saros 141 catalogue\. The wave exists only between the first eclipse \(#0\) and the last \(#69\); the displayed time is \d+[α-ω][^.;]* after the last, so the catalogue is shown greyed\.$/);
  const tip = words.tip({ d, p: 0.3, at: eng.timeAt(4, d.idx, 0.3), now: t, marker: false, action: 'Click or drag to travel along this arc' });
  assert.match(tip, /half-arc \+4/);
  assert.match(tip, /α#6 β#4 γ#9 δ#3 ε#5/);
  // a major arc: words and its quarter, never a pair
  const dd = eng.describe(3, cur[3].idx);
  const dtip = words.tip({ d: dd, p: 0.3, at: eng.timeAt(3, dd.idx, 0.3), now: t, marker: false, action: 'x' });
  assert.match(dtip, /closing half of Delta Trifracton/);
  assert.match(dtip, /2ε 38η long · now in its End quarter/);
  assert.doesNotMatch(dtip, /pure-pair/, 'no glyph pair for a major period');
  assert.match(words.chipLive('Depth 4', dd, cur[3]), /in the End quarter of its cycle\. Closing half of Delta Trifracton/);
  assert.equal(words.isMajor(3), true);
  assert.equal(words.isMajor(4), false);
  assert.equal(words.quarter(dd, cur[3].local), 'End');
  assert.match(tip, /opening half of ε#5/);
  assert.match(tip, /38η 18ι long/);
  assert.match(tip, /pure-pair/, 'the share of a minor half-arc is a pair of glyphs');
  assert.doesNotMatch(seen(tip).join(' '), /%/);
  assert.match(tip, /ends in /);
  assert.match(tip, /glyph index \d+ \(0–15\)/);
  assert.match(tip, /ε#\d+ \d+η \d+ι/, 'the instant under the pointer (an ε arc): the Nuclide and the counts in it');
  assert.doesNotMatch(tip, /(?<!\d)(?:[δεζ]|[ηιλ]) \d|\u00bd/);
  flag.on = false;
});

test('normal mode words are the ones tooltip.js always produced', () => {
  flag.on = false;
  const t = TIMES.A;
  const cur = eng.readHalves(model.frame(t));
  for (const L of [0, 3, 6, 11]) {
    const d = eng.describe(L, cur[L].idx);
    assert.equal(words.span(d), spanText(fmt, d.start, d.end) + (d.clipped ? '  (clipped)' : ''));
    assert.equal(words.cycle(d), cycleText(d));
    assert.equal(words.loop(d), loopText(d));
    assert.equal(words.when(d, t), whenText(fmt, d, t));
    assert.deepEqual(words.nextLines(eng, d, cur[L], t), nextLines(fmt, eng, d, cur[L], t));
    // the tooltip is tooltip.js's own, its dates led by their Pentads
    const pen = { pentad: words.pentadOf, mark: (p) => pentadMarkHTML(p) };
    assert.equal(words.tip({ d, p: 0.4, at: eng.timeAt(L, d.idx, 0.4), now: t, marker: false, action: 'x' }), tipHTML({ d, p: 0.4, at: eng.timeAt(L, d.idx, 0.4), now: t, fmt, model: { F: model.F, glyphSVG: model.glyphSVG }, theme, marker: false, action: 'x', ...pen }));
    assert.equal(words.spanHTML(d), spanHTML(fmt, d.start, d.end, words.pentadOf, pen.mark) + (d.clipped ? '  (clipped)' : ''));
    // without the marks the tooltip is the text it always was
    assert.equal(tipHTML({ d, p: null, at: null, now: t, fmt, model, theme, action: '' }).replace(/<[^>]+>/g, '').includes(spanText(fmt, d.start, d.end)), true);
  }
  assert.equal(words.share(0.2749), '27 %');
  assert.equal(words.share(0.1349, 'x', 1), '13.4 %');
  assert.equal(words.nowLabel({ t, level: 0, overview: true }), '2026-10-08');
  assert.equal(words.nowLabel({ t, level: 2, duration: 3e7 }), '2026-10-08 12:00');
  assert.equal(words.nowLabel({ t, level: 6, duration: 9000 }), '12:00:00');
  assert.equal(words.nowLabel({ t, level: 6, duration: 9000 }), fmt.time(t, { seconds: true, ms: false }));
  assert.equal(words.cycleLength(model.levelInfo(6)), fmt.duration(model.levelInfo(6).meanSeconds));
  assert.equal(words.catalogueTitle(35), 'Catalogue: the whole Saros 141 wave, 35 α half-arcs from 1613 to 2857');
  assert.equal(words.cycle(eng.describe(6, cur[6].idx)), 'second half of η cycle 1 / 11 in ζ');
  assert.match(words.canvasLabel(eng.describe(6, cur[6].idx), 0.6), /now in the second half of this half-arc\.$/);
  assert.match(words.chipLive('Depth 7', eng.describe(6, cur[6].idx), cur[6]), /\d+ % through this half-arc\. Second half of η cycle 1 \/ 11 in ζ\.$/);
  assert.equal(words.eclipseLegend(), 'an eclipse of the series, with its year; the thin loops are β and γ');
});

test('the vocabulary is asked every time: switching modes changes the next text, nothing is cached', () => {
  const d = eng.describe(6, eng.readHalves(model.frame(TIMES.A))[6].idx);
  const seq = [false, true, false, true].map((on) => {
    flag.on = on;
    return words.cycle(d) + '|' + words.share(0.5, 'x').length;
  });
  assert.equal(seq[0], seq[2]);
  assert.equal(seq[1], seq[3]);
  assert.notEqual(seq[0], seq[1]);
  flag.on = false;
});

test('solar words: the sync, its phase, the next quarter and the drift in both vocabularies', () => {
  const s = model.solarAt(TIMES.A);
  flag.on = false;
  assert.equal(words.sunNumber(s), '#4820');
  assert.match(words.sunNext(s, TIMES.A), /^node in \d+ h \d+ min$/);
  assert.match(words.sunDrift(s, TIMES.A), /^−\d+ h \d+ min$/);
  assert.match(words.sunTip(s, TIMES.A), /Solar sync #4820/);
  assert.match(words.sunTip(s, TIMES.A), /Phase 35 % of this 4-day sync/);
  assert.match(words.sunTip(s, TIMES.A), /Drift against civil days −\d+ h \d+ min/);
  assert.match(words.sunToggleTitle(), /19 η cycles \(about 4 days\)/);
  assert.match(words.sunAria(s, TIMES.A), /^Solar sync 4820, phase 35 percent, next node in \d+ h \d+ min, drift against civil days −\d+ h \d+ min\. Pentad II, 2nd Helion\.$/);
  assert.match(words.sunTip(s, TIMES.A), /aria-label="Pentad II"/, 'the tooltip names the Pentad with its shape');
  assert.match(words.sunTip(s, TIMES.A), /Pentad II, 2nd Helion of 5/);
  assert.match(words.sunTip(s, TIMES.A), /A solar day is 4¾η: each Pentad \(5η, about 25 h\) starts ¼η \(about 1 h 16 min\) later in the day/);
  assert.match(words.sunPentadHTML(TIMES.A), /aria-label="Pentad II, 2nd Helion"/);
  assert.equal(words.sunPhaseText(s), '35 percent of sync 4820');
  flag.on = true;
  assert.match(words.sunNext(s, TIMES.A), /^node in \d+η \d+ι$/);
  assert.equal(words.sunDrift(s, TIMES.A), pureT.driftText(s), 'the drift is pure.driftText, counted in λ, the same everywhere');
  assert.match(words.sunDrift(s, TIMES.A), /^−\d{1,3}(\u202f\d{3})*λ$/);
  assert.equal(words.sunDriftLine(s, TIMES.A), `Drift ${pureT.driftText(s)}`);
  assert.equal(words.sunDefinition(), '19η', 'a count of η, written nX');
  const tip = words.sunTip(s, TIMES.A);
  assert.match(tip, /Solar sync #4820/);
  assert.match(tip, /pure-pair/);
  assert.match(tip, /Drift −[\d\u202f]+λ</);
  assert.match(tip, /One sync is 19η: 19 Helions</, 'the unit name where the tooltip explains the sync');
  assert.doesNotMatch(tip.replace(/4¾η is a solar day/, ''), /civil|day|%|steady|beat/);
  assert.doesNotMatch(tip.replace(/<[^>]+>/g, ' '), /\b\d+ ?(h|min)\b|hours?/, 'no hours');
  assert.match(tip, /4¾η is a solar day: each Pentad starts ¼η later in it, and the Hypopentad, one Helion short, brings Pentad I back/, 'pure: no hours, the solar day in Helions');
  assert.match(words.sunAria(s, TIMES.A), /^Solar sync 4820, phase 5 and \d+ of 256, next node in \d+η \d+ι, drift −[\d\u202f]+λ\. Pentad II, 2nd Helion\.$/);
  assert.match(words.sunPhaseText(s), /^sync 4820, phase 5 and \d+ of 256$/);
  assert.equal(words.sunPhaseText(s), `sync 4820, ${pairSpoken(pureT, s.phase, 'phase')}`);
  assert.match(words.sunToggleTitle(), /one yellow wave of 19η \(19 Helions\)\./);
  assert.match(words.sunCaption(), /one wavelength is 19η \(19 Helions\)/);
  assert.doesNotMatch(words.sunCaption() + words.sunLegend() + words.sunToggleTitle(), /19 η/, 'pure: 19η, not "19 η"');
  assert.equal(words.glossaryHint(), 'Press ? for the glossary.');
  flag.on = false;
  assert.equal(words.glossaryHint(), '');
});

test('solar words: the minus of a sync number is the app\'s, and the dial\'s depths read as a list', () => {
  for (const on of [false, true]) {
    flag.on = on;
    assert.equal(words.sunNumber({ sync: -6718 }), '#−6718', 'U+2212, not a hyphen');
    assert.equal(words.sunNumber({ sync: 0 }), '#0');
    assert.match(words.sunAria({ ...model.solarAt(TIMES.B), sync: -6718 }, TIMES.B), /^Solar sync −6718,/);
    assert.match(words.sunTip({ ...model.solarAt(TIMES.B), sync: -6718 }, TIMES.B), /Solar sync #−6718</);
    assert.match(words.sunEdgeTip(-32928), /Solar sync #−32928</);
    assert.match(words.sunRange([3, 4]), /^ripple at depths 4–5$/);
    assert.equal(words.sunRange([4]), 'ripple at depth 5');
    assert.equal(words.sunRange([2, 3, 4]), 'ripple at depths 3–5');
    assert.equal(words.sunRange([2, 4]), 'ripple at depths 3, 5', 'a gap is a list, not a range');
    assert.equal(words.sunRange([]), 'no ripple here: these arcs are too short');
  }
  flag.on = false;
});

test('solar words: the toggle and the caption say one and a half syncs, and the tooltip promises only what the thing hovered does', () => {
  for (const on of [false, true]) {
    flag.on = on;
    assert.match(words.sunToggleTitle(), /where one and a half or more syncs fit/);
    assert.match(words.sunCaption(), /where one and a half or more fit/);
    assert.doesNotMatch(words.sunToggleTitle() + words.sunCaption(), /two or more|at least two/);
    const s = model.solarAt(TIMES.A);
    assert.match(words.sunTip(s, TIMES.A, { by: 'pin' }), /Drag the pin to travel within this sync/);
    assert.doesNotMatch(words.sunTip(s, TIMES.A, { by: 'pin' }), /Click or drag the wave/, 'the pin is dragged, it is not "the wave"');
    assert.match(words.sunTip(s, TIMES.A, { by: 'dial' }), /Click or drag the wave to travel within this sync/);
    assert.match(words.sunTip(s, TIMES.A, { by: 'dial', touch: true }), /Tap or drag the wave to travel within this sync/);
    assert.match(words.sunTip(s, TIMES.A, { by: 'key' }), /Arrow keys travel within this sync, Page keys by a quarter/);
    assert.match(words.sunKeys(), /Arrow keys travel within the sync, Page Up and Page Down by a quarter, Home and End/);
  }
  flag.on = false;
  // normal mode keeps every other word it had
  assert.equal(words.sunDefinition(), '19 η cycles ≈ 4 days');
  assert.equal(words.eclipseLegend(), 'an eclipse of the series, with its year; the thin loops are β and γ');
  assert.equal(words.glossaryHint(), '');
});

test('tipHTMLPure escapes what it is given', () => {
  const cur = eng.readHalves(model.frame(TIMES.A));
  const d = eng.describe(6, cur[6].idx);
  const html = tipHTMLPure({ d: { ...d, letter: '<img src=x>', signed: '+1&"' }, p: null, at: null, now: TIMES.A, pure: pureT, model, theme });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x&gt;/);
});

// ================================================================== the Pentads of the solar sync (SPEC §7.5) ====

test('solar Pentads: four runs of a sync, 5 + 5 + 5 + 4 Helions, each just after its quarter (a solar day)', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(SUN.pentadPhase), [0, 5 / 19, 10 / 19, 15 / 19, 1]);
  // each starts ¼, ½, ¾ Helion (1/76 of a sync each) after the quarter before it; the Hypopentad ends on the sync's end
  for (let i = 1; i < 4; i++) assert.ok(Math.abs(SUN.pentadPhase(i) - i / 4 - i / 76) < 1e-12);
  assert.deepEqual([0, 0.2, 5 / 19 + 1e-9, 0.5, 10 / 19 + 1e-9, 0.78, 15 / 19 + 1e-9, 0.9999, 1].map(SUN.pentadOfPhase), [0, 0, 1, 1, 2, 2, 3, 3, 3]);
  // the grid agrees with the model's Pentad of the displayed time
  const g = SUN.syncGrid(model.levelInfo(6).prefixNum);
  for (const t of [TIMES.A, 946684800, 2886085800, TIMES.A + 86400 * 2.7]) {
    const sy = SUN.syncAt(model.positionOf(t), g);
    const p = model.pentadAt(t);
    assert.equal(sy.sync, p.sync, `sync at ${t}`);
    assert.equal(SUN.pentadOfPhase(sy.phase), p.index, `pentad at ${t}`);
  }
  // the dial's band: four segments in order, the Hypopentad 4/5 of the others
  const shape = SUN.dialShape(220, 30);
  const band = SUN.dialPentads(shape, 0);
  assert.deepEqual(band.map((b) => b.index), [0, 1, 2, 3]);
  const w = band.map((b) => b.x1 - b.x0);
  assert.ok(Math.abs(w[0] - w[1]) < 1e-9 && Math.abs(w[1] - w[2]) < 1e-9 && Math.abs(w[3] / w[0] - 0.8) < 1e-9);
  assert.ok(Math.abs(band[0].x0 - shape.padX) < 1e-9 && Math.abs(band[3].x1 - (shape.padX + shape.W)) < 1e-9);
  const gapped = SUN.dialPentads(shape, 2);
  assert.ok(gapped[1].x0 - gapped[0].x1 > 1.99, 'a gap where each Pentad starts');
});

test('solar Pentads along an arc: the spans of the syncs it carries, clipped to the arc', () => {
  const g = SUN.syncGrid(model.levelInfo(6).prefixNum);
  const f = model.frame(TIMES.A);
  const P4 = model.levelInfo(4).prefixNum;
  const idx = Math.floor((f.pos * P4) / 2); // the ε half-arc of vector A
  const spec = SUN.arcSpec(idx, P4, 1);
  const all = SUN.pentadSpans(spec, g);
  // an ε half-arc is 38.5 Helions: two syncs and a bit, so 8 to 10 Pentads, in order and tiling the arc
  assert.ok(all.length >= 8 && all.length <= 10, `count ${all.length}`);
  assert.equal(all[0].p0, 0);
  assert.equal(all.at(-1).p1, 1);
  for (let i = 1; i < all.length; i++) {
    assert.ok(Math.abs(all[i].p0 - all[i - 1].p1) < 1e-9, 'they follow on');
    assert.equal(all[i].index, (all[i - 1].index + 1) % 4);
  }
  // a whole Pentad on the arc is 5 (or 4) Helions of 38.5
  const whole = all.filter((s) => s.p0 > 0 && s.p1 < 1);
  for (const s of whole) assert.ok(Math.abs((s.p1 - s.p0) * 38.5 - (s.index === 3 ? 4 : 5)) < 1e-6, `length of ${s.index}`);
  const now = SUN.syncAt(f.pos, g).sync;
  const one = SUN.pentadSpans(spec, g, now);
  assert.ok(one.length >= 1 && one.length <= 4 && one.every((s) => s.sync === now));
});

test('pure readings lead with their Pentad where they read down to the Helion', () => {
  assert.deepEqual([3, 4, 5, 6, 8, 12].map(pureCycleLeads), [false, false, false, true, true, true], 'a Helion or finer cycle lies in one Pentad');
  assert.deepEqual([0, 2, 3, 6].map(pureNowLeads), [false, false, true, true]);
  const cur = eng.readHalves(model.frame(TIMES.A));
  const d = eng.describe(6, cur[6].idx);
  assert.equal(chainShort(pureT, model, 6, d.cycle), 'δ#3 ε#5 34η', 'the short letter form of SPEC §15.3');
  flag.on = true;
  const html = words.spanHTML(d);
  assert.match(html, /^<span class="pentad-lead"><span class="pentad-mark" role="img" aria-label="Pentad II"/);
  assert.match(html, /δ#3 ε#5 34η<\/span><\/span>$/);
  assert.equal(words.nowPentad({ t: TIMES.A, level: 2 }), null, 'α#6 β#4 γ#9 has no Helion: no Pentad');
  assert.equal(words.nowPentad({ t: TIMES.A, level: 6 }), 1);
  assert.equal(words.nowPentad({ t: TIMES.A, level: 0, overview: true }), null);
  assertClean(words.spanHTML(d), 'pure span');
  flag.on = false;
  assert.equal(words.nowPentad({ t: TIMES.A, level: 0, overview: true }), 1, 'normal mode: a date always leads with its Pentad');
  const n = words.spanHTML(d);
  assert.match(n, /aria-label="Pentad II"/);
  assert.equal(n.replace(/<[^>]+>/g, ''), 'II' + spanText(fmt, d.start, d.end).replace(' → ', ' → '), 'one mark: both ends are in Pentad II');
});
