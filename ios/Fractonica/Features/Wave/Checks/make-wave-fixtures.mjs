#!/usr/bin/env node
/**
 * Fixtures for the native wave view's checks, computed by the web app's own wave modules.
 *
 *   node ios/Fractonica/Features/Wave/Checks/make-wave-fixtures.mjs      (from the repository root)
 *
 * Loads fractonica.js, src/core/model.js and pure.js, src/core/format.js and the wave's src/ui/wave/{geometry,scene,
 * solar,nav,words,tooltip}.js, queries them over a deterministic spread of inputs and writes wave-fixtures.json next to
 * this script. WaveChecks.swift replays every input against the Swift port (WaveGeometry, WaveEngine, WaveSolar,
 * WaveNav, WaveWords): integers and strings exactly, geometry within 1e-9 (relative), times within 0.5 ms.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../../../../fractonica.js';
import { createModel } from '../../../../../src/core/model.js';
import { createPure } from '../../../../../src/core/pure.js';
import { createFormatter } from '../../../../../src/core/format.js';
import * as G from '../../../../../src/ui/wave/geometry.js';
import { createEngine } from '../../../../../src/ui/wave/scene.js';
import * as SOL from '../../../../../src/ui/wave/solar.js';
import * as NAV from '../../../../../src/ui/wave/nav.js';
import { createWords } from '../../../../../src/ui/wave/words.js';
import { countdownText, floorPercent, loopHint } from '../../../../../src/ui/wave/tooltip.js';

const here = dirname(fileURLToPath(import.meta.url));
const model = createModel();
const clock = model.clock;
const eng = createEngine(model);
const pure = createPure(model);
const fmt = createFormatter(() => 'UTC');
const theme = { levelColor: () => '#fff' };
let pureOn = false;
const words = createWords({ fmt, pure, model, theme, isPure: () => pureOn });

// ---- deterministic randomness (mulberry32)
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
const rand = mulberry32(0x3a7e);
const uniform = (lo, hi) => lo + (hi - lo) * rand();
const int = (lo, hi) => Math.floor(uniform(lo, hi + 1));

const A = 1791460800;
const B = 946684800;
const C = 2886085800;
const { tMin, tMax } = model;
const times = [A, B, C, tMin, tMin + 0.5, tMin + 3600, tMax - 3600, tMax - 0.5, tMax, A + 0.123, 125593320.816];
for (let i = 0; i < 14; i++) times.push(Math.round(uniform(tMin, tMax) * 1000) / 1000);
for (let i = 0; i < 6; i++) times.push(A + Math.round(uniform(-1e7, 1e7) * 1000) / 1000);

const arcOf = (a) => [a.center.x, a.center.y, a.radius, a.start, a.sweep];
const num = (b) => Number(b);

// ---- library arcs, absolute and rebased
const arcs = [];
for (let level = 0; level <= 15; level++) {
  const n = eng.halfCount(level);
  const picks = [0, n - 1, int(0, n - 1), int(0, n - 1), int(0, n - 1)];
  for (const idx of picks) {
    if (level <= 9) arcs.push({ level, idx, ref: null, arc: arcOf(clock.arc(level, BigInt(idx))) });
    for (const refLevel of [Math.max(0, level - 3), level]) {
      const refIdx = eng.ancestorIndex(level, idx, refLevel);
      arcs.push({ level, idx, ref: [refLevel, refIdx], arc: arcOf(eng.arcIn(level, idx, { level: refLevel, idx: refIdx })) });
    }
  }
}

// ---- half-arc readings, scenes and markers at the sample times
const halves = [];
const scenes = [];
const W = 393;
const H = 520;
const pad = { l: 46, r: 46, t: 44, b: 40 };
for (const t of times) {
  const frame = model.frame(t);
  const cur = eng.readHalves(frame);
  halves.push({ t, halves: cur ? cur.map((h) => [h.idx, h.local, h.half]) : null });
  if (!cur) continue;
  for (const level of [0, 2, 4, 6, 9, 12, 13]) {
    if (scenes.length > 70) break;
    const sc = eng.buildFocus(level, cur[level].idx);
    const cam = G.fitCamera(sc.samples, sc.rot, W, H, pad);
    scenes.push({
      t,
      level,
      idx: sc.idx,
      r0: sc.r0,
      focus: arcOf(sc.focus),
      fraction: sc.fraction,
      children: sc.children.map((c) => [c.idx, c.j, ...arcOf(c.arc), c.fraction]),
      grandCount: sc.grand.length,
      grand: sc.grand.filter((_, i) => i % 7 === 0).map((g) => [g.idx, g.j, g.k, ...arcOf(g.arc), g.fraction]),
      ancestors: sc.ancestors.map((a) => [a.level, a.idx, a.slotJ, a.slotM, a.fraction, ...arcOf(a.arc)]),
      samples: sc.samples.length,
      sampleSum: sc.samples.reduce((s, x) => s + x, 0),
      rot: sc.rot,
      toAlpha: [sc.toAlpha.x, sc.toAlpha.y, sc.toAlpha.k],
      camera: [cam.cx, cam.cy, cam.scale, cam.rot],
      arcPx: G.focusArcLength(sc, W, H, pad),
      markers: eng.markersFor(sc, cur).map((m) => [m.level, m.idx, m.local, m.x, m.y]),
    });
  }
}

// ---- describe, spans and steps
const describes = [];
const steps = [];
for (let level = 0; level <= 13; level++) {
  const n = eng.halfCount(level);
  for (const idx of [0, 1, n - 2, n - 1, int(0, n - 1), int(0, n - 1)]) {
    const d = eng.describe(level, idx);
    describes.push({
      level, idx, letter: d.letter, parent: d.parent, n: d.n, of: d.of, cycle: d.cycle, cycleN: d.cycleN, cycleOf: d.cycleOf,
      signed: d.signed, crest: d.crest, start: d.start, end: d.end, fraction: d.fraction, clipped: d.clipped,
    });
    for (const dt of [0.0005, 0.002, 0.3]) {
      const t = d.start + dt * Math.max(1, d.duration);
      for (const dir of [-1, 1]) steps.push({ level, idx, t, dir, out: eng.stepTarget(level, idx, t, dir) });
    }
  }
}

// ---- cameras and layouts
const cameras = [];
for (let i = 0; i < 12; i++) {
  const a = { cx: uniform(-3, 3), cy: uniform(-3, 3), scale: Math.exp(uniform(0, 12)), rot: uniform(-4, 4) };
  const b = { cx: uniform(-3, 3), cy: uniform(-3, 3), scale: Math.exp(uniform(0, 12)), rot: uniform(-4, 4) };
  const e = uniform(0, 1);
  const o = { x: uniform(-2, 2), y: uniform(-2, 2) };
  const k = Math.exp(uniform(-10, 0));
  cameras.push({
    a: [a.cx, a.cy, a.scale, a.rot],
    b: [b.cx, b.cy, b.scale, b.rot],
    e,
    lerp: Object.values(G.lerpCamera(a, b, e)),
    o: [o.x, o.y, k],
    to: Object.values(G.cameraToFrame(a, o, k)),
    from: Object.values(G.cameraFromFrame(a, o, k)),
    wrap: [a.rot * 3, G.wrapPi(a.rot * 3)],
  });
}
const layouts = [];
for (const [w, h] of [[393, 520], [700, 420], [1100, 700], [320, 800], [1024, 1100]]) {
  const p = { l: 24, r: 48, t: 30, b: 18 };
  const L = G.layoutRows(eng.halfCount(0), w, h, { pad: p });
  const cam = G.overviewCamera(L, w, h, p);
  layouts.push({ w, h, cols: L.cols, rows: L.rows, scale: L.scale, camera: [cam.cx, cam.cy, cam.scale, cam.rot], offsets: [0, 5, 17, 34].map((r) => Object.values(G.rowOffset(r, L))) });
}
const nearest = [];
for (let i = 0; i < 20; i++) {
  const sa = { x: uniform(0, 400), y: uniform(0, 400), r: Math.exp(uniform(1, 8)), a0: uniform(-7, 7), sweep: uniform(-4.4, 4.4) };
  const px = uniform(-100, 500);
  const py = uniform(-100, 500);
  const tMaxArc = rand() < 0.3 ? uniform(0.2, 1) : 1;
  const r = G.nearestOnArc(sa, px, py, tMaxArc);
  nearest.push({ sa: [sa.x, sa.y, sa.r, sa.a0, sa.sweep], p: [px, py, tMaxArc], out: [r.t, r.dist] });
}
const glyphs = [];
for (let i = 0; i < 30; i++) {
  const idx = int(0, 1000);
  const t = uniform(0, 1);
  glyphs.push([idx, t, G.glyphIndexAt(idx, t)]);
}

// ---- solar
const grid = SOL.syncGrid(model.levelInfo(SOL.SYNC_LEVEL).prefixNum);
const solar = { grid: [grid.P6, grid.anchor, grid.length], at: [], fits: [], marks: [], pins: [] };
for (const t of times) {
  const pos = model.positionOf(t);
  if (pos === null) continue;
  const s = SOL.syncAt(pos, grid);
  solar.at.push([pos, s.sync, s.phase]);
}
for (const [syncs, px] of [[0.5, 300], [1.4, 900], [1.6, 30], [2, 60], [3, 100], [10, 300], [100, 2600], [4, 150]]) {
  const f = SOL.rippleFit(syncs, px);
  solar.fits.push([syncs, px, f.visible, f.strength, f.why]);
}
for (const level of [2, 3, 4, 5]) {
  const P = model.levelInfo(level).prefixNum;
  const idx = int(0, eng.halfCount(level) - 2);
  const spec = SOL.arcSpec(idx, P, eng.fractionOf(level, idx));
  solar.marks.push({ level, idx, marks: SOL.quarterMarks(spec, grid).map((m) => [m.sync, m.k, m.p]) });
  const sync = SOL.syncAt(spec.pos0 + 0.5 * spec.span, grid).sync;
  solar.pins.push({ level, idx, sync, phases: [0, 0.3, 0.7, 1].map((t) => [t, SOL.pinPhase(spec, grid, t, sync)]) });
}

// ---- navigation
const nav = { follow: [], zoom: [] };
for (const rate of [0, 1, 60, 3600, 86400, 31557600, -3600]) {
  for (const reduced of [false, true]) {
    for (const level of [0, 6, 9, 13]) nav.follow.push([level, rate, reduced, NAV.followableLevel(level, { rate, reduced }, (l) => model.levelInfo(l).meanSeconds)]);
  }
}
for (const inRange of [true, false]) {
  for (const overview of [true, false]) {
    for (const [level, eff] of [[0, 0], [6, 6], [6, 3], [13, 13]]) {
      for (const dir of [-1, 1]) nav.zoom.push([inRange, overview, level, eff, dir, NAV.zoomPlan({ inRange, overview, level, eff }, dir)]);
    }
  }
}

// ---- words, both vocabularies, at the sample times
const wordCases = [];
for (const t of times.slice(0, 15)) {
  const frame = model.frame(t);
  const cur = eng.readHalves(frame);
  if (!cur) continue;
  for (const level of [0, 1, 3, 4, 5, 6, 8, 10, 12, 13]) {
    const h = cur[level];
    const d = eng.describe(level, h.idx);
    const rec = { t, level, idx: h.idx, local: h.local };
    for (const p of [false, true]) {
      pureOn = p;
      const key = p ? 'pure' : 'earth';
      rec[key] = {
        loop: words.loop(d),
        loopHint: loopHint(d),
        cycle: words.cycle(d),
        span: words.span(d),
        next: words.nextLines(eng, d, h, t).map((l) => [l.dim, l.text]),
        when: words.when(d, t),
        whenEarly: words.when(d, d.start - 1000),
        now: words.nowLabel({ t, level, duration: d.duration }),
        nowAll: words.nowLabel({ t, level: 0, overview: true }),
        quarter: words.quarter(d, h.local),
        halfLength: words.halfLength(model.levelInfo(level)),
        chipTitle: words.chipTitle(model.levelInfo(level)),
        announce: words.announce(d, t),
        canvas: words.canvasLabel(d, h.local),
      };
    }
    wordCases.push(rec);
  }
}
const staticWords = {};
for (const p of [false, true]) {
  pureOn = p;
  const key = p ? 'pure' : 'earth';
  const sun = model.solarAt(A);
  staticWords[key] = {
    eclipses: words.eclipses(eng.halfCount(0)),
    before: words.outOfRange(tMin - 86400 * 400),
    after: words.outOfRange(tMax + 3600 * 5),
    catalogueSpan: words.catalogueSpan(),
    catalogueTitle: words.catalogueTitle(eng.halfCount(0)),
    sunNext: words.sunNext(sun, A),
    sunDrift: words.sunDrift(sun, A),
    sunNumber: words.sunNumber(sun),
    sunRange: [[], [3], [3, 4], [2, 4]].map((x) => words.sunRange(x)),
    alphaSpan: words.alphaSpan(eng.describe(0, 34)),
  };
}
const percents = [0, 0.29, 0.1349, 0.9999, 1, 0.5].map((f) => [f, floorPercent(f), floorPercent(f, 1)]);
const countdowns = [0.0004, 0.5, 0.9995, 1.2, 75, 3600 * 30, -0.25, -200].map((s) => [s, countdownText(fmt, s)]);

const out = {
  times,
  arcs,
  halves,
  scenes,
  describes,
  steps,
  cameras,
  layouts,
  nearest,
  glyphs,
  solar,
  nav,
  words: wordCases,
  staticWords,
  percents,
  countdowns,
};
const file = join(here, 'wave-fixtures.json');
writeFileSync(file, JSON.stringify(out));
console.log(`${file}: ${arcs.length} arcs, ${scenes.length} scenes, ${wordCases.length} word cases`);
