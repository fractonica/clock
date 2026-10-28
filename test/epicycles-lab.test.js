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
  const config = fig.sanitize({ base: 4, top: 7, radii: { 4: 1, 5: 0.5, 6: 0.12, 7: 0.03 }, off: [5], reversed: [6], frame: 'carrier', tips: false });
  assert.deepEqual(fig.fromHash('#' + fig.toHash(config)), config);
  assert.equal(fig.fromHash('#nonsense'), null);
  const odd = fig.sanitize({ base: 99, top: -3, radii: { 6: 5, 7: -1, x: 2 }, off: [9], frame: 'sideways' });
  assert.equal(odd.base, 6);
  assert.equal(odd.top, 7);
  assert.deepEqual(odd.radii, { 6: 1, 7: 0.01 });
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
