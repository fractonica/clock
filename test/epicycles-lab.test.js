import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import * as fig from '../lab/epicycles-figure.js';

const model = createModel();
const factorOf = (level) => model.levelInfo(level).factor;
const frac = (x) => x - Math.floor(x);
const turnGap = (a, b) => Math.min(frac(a - b), frac(b - a));

test('the arms count their cycles in a base cycle and share the reach', () => {
  const arms = fig.arms(fig.sanitize(fig.STANDARD), factorOf);
  assert.deepEqual(arms.map((a) => a.level), [6, 7, 8, 9]);
  assert.deepEqual(arms.map((a) => a.cycles), [1, 9, 36, 180]);
  assert.ok(Math.abs(arms.reduce((s, a) => s + a.length, 0) - 1) < 1e-12);
  const flavon = fig.arms(fig.sanitize({ base: 6, top: 10 }), factorOf);
  assert.equal(flavon.at(-1).cycles, 2340, 'a Helion holds 2340 Flavons');
});

test('every arm (from the top) stands at its own period’s phase, against the engine', () => {
  const vectorA = 1791460800;
  const instants = [vectorA, ...Array.from({ length: 40 }, (_, i) => model.tMin + (model.tMax - model.tMin) * ((i * 0.6180339887) % 1))];
  for (const base of [0, 3, 4, 6, 8]) {
    const config = fig.sanitize({ base, top: Math.min(base + 5, fig.DEEPEST) });
    const arms = fig.arms(config, factorOf);
    for (const t of instants) {
      const phase = model.levelAt(t, base).phase;
      for (const arm of arms) {
        const own = model.levelAt(t, arm.level).phase;
        assert.ok(turnGap(fig.angle(arm, phase), own) < 1e-6, `base ${base}, level ${arm.level} at ${t}: ${fig.angle(arm, phase)} vs ${own}`);
      }
    }
  }
});

test('the figure closes after one base cycle, in either frame and either way round', () => {
  for (const frame of ['dial', 'carrier']) {
    const config = fig.sanitize({ base: 6, top: 10, frame, reversed: [7, 9] });
    const arms = fig.arms(config, factorOf);
    const a = fig.joints(arms, 0);
    const b = fig.joints(arms, 1);
    a.forEach(([x, y], i) => assert.ok(Math.hypot(x - b[i][0], y - b[i][1]) < 1e-9, `${frame}: joint ${i} returns`));
    const { detail, samples } = fig.detailFor(arms, 400);
    const tips = fig.curve(arms, detail, samples);
    const pen = tips[detail];
    assert.ok(Math.hypot(pen[0] - pen[2 * samples], pen[1] - pen[2 * samples + 1]) < 1e-5, `${frame}: the curve closes`);
  }
});

test('the carrier frame adds each arm’s turns to its carrier’s', () => {
  const arms = fig.arms(fig.sanitize({ base: 6, top: 8, frame: 'carrier', reversed: [7] }), factorOf);
  assert.deepEqual(arms.map((a) => a.turns), [1, 1 - 9, 1 - 9 + 36]);
});

test('arms too fine for the size fold into a band', () => {
  const arms = fig.arms(fig.sanitize({ base: 6, top: 10, radii: { 6: 1, 7: 0.35, 8: 0.15, 9: 0.08, 10: 0.04 } }), factorOf);
  const small = fig.detailFor(arms, 20);
  const large = fig.detailFor(arms, 4000);
  assert.ok(small.detail < large.detail, `${small.detail} < ${large.detail}`);
  assert.ok(small.band > 0 && small.bandLevel === 10);
  assert.ok(large.samples <= fig.MAX_SAMPLES);
});

test('a configuration survives the URL hash, and invalid values fall back', () => {
  const config = fig.sanitize({ base: 4, top: 7, radii: { 4: 1, 5: 2.5, 6: 0.12, 7: 0.03 }, ecc: { 5: 0.6, 7: 0.25 }, peri: { 5: 135 }, off: [5], reversed: [6], frame: 'carrier', tips: false });
  assert.deepEqual(fig.fromHash('#' + fig.toHash(config)), config);
  assert.equal(fig.fromHash('#nonsense'), null);
  const odd = fig.sanitize({ base: 99, top: -3, radii: { 6: 50, 7: -1, x: 2 }, ecc: { 6: 1.4, 7: -0.2 }, peri: { 6: -90, 7: 725 }, off: [9], frame: 'sideways' });
  assert.equal(odd.base, 6);
  assert.equal(odd.top, 7);
  assert.deepEqual(odd.radii, { 6: 10, 7: 0.01 });
  assert.deepEqual(odd.ecc, { 6: fig.ECC_MAX }, "a negative eccentricity is a circle, the default");
  assert.deepEqual(odd.peri, { 6: 270, 7: 5 });
  assert.deepEqual(odd.off, [9], 'a level off the ladder is harmless');
  assert.equal(odd.frame, 'dial');
  assert.deepEqual(fig.sanitize({ base: 6, top: 8, off: [8] }).off, [], 'the pen’s arm stays on');
  assert.deepEqual(fig.topsFor(10), { min: 11, max: 13 });
});

test('the iOS launch arguments name the same figure', () => {
  const config = fig.sanitize({ base: 6, top: 9, radii: { 7: 0.5 }, reversed: [8], frame: 'carrier', tips: false });
  assert.equal(fig.launchArguments(config),
    '-FXFace epicycles -FXEpicycles 6-9 -FXEpicycleRadii 1,0.5,0.1,0.03 -FXEpicycleReverse 8 -FXEpicycleFrame carrier -FXEpicycleTips 0');
});

test('lengths past 1 reach iOS as the same proportions', () => {
  const config = fig.sanitize({ base: 6, top: 8, radii: { 6: 1, 7: 4, 8: 0.5 } });
  assert.deepEqual(fig.iosRadii(config), [0.25, 1, 0.125]);
  assert.match(fig.launchArguments(config), /-FXEpicycleRadii 0\.25,1,0\.125/);
});

test('a circular orbit is the plain epicycle', () => {
  const circles = fig.arms(fig.sanitize({ base: 6, top: 9 }), factorOf);
  for (const phase of [0, 0.013, 0.25, 0.5, 0.77]) {
    const pts = fig.joints(circles, phase);
    let x = 0;
    let y = 0;
    circles.forEach((arm, i) => {
      const a = 2 * Math.PI * frac(arm.turns * phase);
      x += arm.length * Math.sin(a);
      y -= arm.length * Math.cos(a);
      assert.ok(Math.hypot(pts[i + 1][0] - x, pts[i + 1][1] - y) < 1e-12);
    });
  }
});

test('a Keplerian arm starts at periapsis, reaches apoapsis halfway round, and sweeps equal areas in equal times', () => {
  const e = 0.7;
  const config = fig.sanitize({ base: 6, top: 7, radii: { 6: 1, 7: 0.01 }, ecc: { 6: e }, peri: { 6: 90 } });
  const [arm] = fig.arms(config, factorOf);
  const a = arm.length;
  assert.ok(Math.abs(a * (1 + e) + fig.arms(config, factorOf)[1].length * 1 - 1) < 1e-12, 'the farthest points reach 1');
  const start = fig.orbit(arm, 0);
  assert.ok(Math.abs(start.r - a * (1 - e)) < 1e-12 && Math.abs(start.angle - 0.25) < 1e-12, 'periapsis to the right');
  const half = fig.orbit(arm, 0.5);
  assert.ok(Math.abs(half.r - a * (1 + e)) < 1e-9 && Math.abs(half.angle - 0.75) < 1e-9, 'apoapsis to the left');
  // the area swept from the focus over equal spans of time is the same anywhere on the orbit
  const swept = (from, to) => {
    let area = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const p = fig.orbit(arm, from + ((to - from) * i) / n);
      const q = fig.orbit(arm, from + ((to - from) * (i + 1)) / n);
      const pa = 2 * Math.PI * p.angle;
      const qa = 2 * Math.PI * q.angle;
      area += 0.5 * Math.abs(p.r * Math.sin(pa) * -q.r * Math.cos(qa) - q.r * Math.sin(qa) * -p.r * Math.cos(pa));
    }
    return area;
  };
  const nearPeri = swept(0, 0.05);
  const nearApo = swept(0.45, 0.5);
  assert.ok(Math.abs(nearPeri - nearApo) / nearApo < 1e-3, `equal areas: ${nearPeri} vs ${nearApo}`);
  const total = Math.PI * a * a * Math.sqrt(1 - e * e);
  assert.ok(Math.abs(nearPeri - total / 20) / total < 1e-3, 'a twentieth of the time sweeps a twentieth of the ellipse');
  // fast at periapsis, slow at apoapsis, one revolution a cycle
  const turnRate = (t) => frac(fig.orbit(arm, t + 1e-4).angle - fig.orbit(arm, t).angle) / 1e-4;
  assert.ok(turnRate(0) / turnRate(0.5) > 30, 'quicker by (1 + e)² / (1 − e)² at periapsis');
});

test('elliptic figures still close after one base cycle', () => {
  for (const frame of ['dial', 'carrier']) {
    const config = fig.sanitize({ base: 6, top: 9, frame, ecc: { 6: 0.4, 7: 0.8, 9: 0.3 }, peri: { 7: 200, 8: 45 }, reversed: [8] });
    const arms = fig.arms(config, factorOf);
    const a = fig.joints(arms, 0);
    const b = fig.joints(arms, 1);
    a.forEach(([x, y], i) => assert.ok(Math.hypot(x - b[i][0], y - b[i][1]) < 1e-9, `${frame}: joint ${i} returns`));
  }
});
