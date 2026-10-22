// Expected values for RingsChecks.swift, computed by the web app's own modules (src/ui/rings/*.js, src/core/*.js).
// Deterministic. Run from the repository root:
//
//   node ios/Fractonica/Features/Rings/Checks/make-fixture.mjs > ios/Fractonica/Features/Rings/Checks/fixture.json
import '../../../../../fractonica.js';
import { createModel } from '../../../../../src/core/model.js';
import { createFormatter } from '../../../../../src/core/format.js';
import { createPure } from '../../../../../src/core/pure.js';
import * as G from '../../../../../src/ui/rings/geometry.js';
import * as TX from '../../../../../src/ui/rings/text.js';
import * as PT from '../../../../../src/ui/rings/pure-text.js';

const model = createModel();
const P = createPure(model);
const fmt = createFormatter(() => 'UTC');

const TIMES = [
  1791460800, // SPEC vector A, 2026-10-08 12:00 UTC
  946684800, // 2000-01-01
  2886085800,
  model.tMin + 1000.25,
  model.tMin + 86400 * 400,
  model.tMax - 3600.5,
  model.tMax - 86400 * 30,
  model.tMax - 0.001,
  -3000000000,
  1e10,
];
const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

const out = { tMin: model.tMin, tMax: model.tMax, readings: [], layouts: [], scrubs: [], children: [] };

for (const t of TIMES) {
  const frame = model.frame(t >= model.tMax ? model.tMax - 0.001 : t);
  for (const L of LEVELS) {
    const lv = frame.level(L);
    if (!lv) continue;
    const times = lv.thresholds.map((e) => e.time);
    const labels = PT.boundaryLabels(P, model, L, times);
    const facts = PT.factParts(P, model, L, lv);
    const chips = [0, 1, 2, 3].map((k) => PT.chipText(P, model, L, lv, k, times[k + 1], t, labels[k + 1]));
    const earthParts = times.map((x) => (x === null ? null : TX.whenParts(fmt, x, lv.duration)));
    const earthCompact = times.map((x) => (x === null ? null : TX.whenParts(fmt, x, lv.duration, { compact: true, refYear: fmt.parts(t).year })));
    out.readings.push({
      t,
      level: L,
      cycle: Number(lv.cycleBig),
      phase: lv.phase,
      displayName: PT.displayName(P, L, lv),
      cycleName: PT.cycleName(P, L, lv),
      centre: PT.centreSpan(P, model, t, lv.end),
      centreCompact: PT.centreSpan(P, model, t, lv.end, { compact: true }),
      endLine: PT.endLine(P, model, L, lv),
      labels,
      chips,
      factStart: facts.start,
      factEnd: facts.end,
      length: facts.lengthNamed,
      address: PT.addressTokens(P, model, L, lv.cycleBig).map((a) => a.text),
      addressLevels: PT.addressTokens(P, model, L, lv.cycleBig).map((a) => a.level),
      stateText: PT.stateText(P, lv.phase, L),
      pointer: PT.pointerText(P, model, L, t),
      inEnd: PT.inText(P, t, lv.end),
      inStart: PT.inText(P, t, lv.start),
      aboutTurn: PT.aboutTurn(P, model.levelInfo(L)),
      earthParts,
      earthCompact,
      countdown: TX.countdownBody(fmt, lv.remaining),
      percent: TX.percentText(lv.phase),
      tag: TX.cycleTag(model.levelInfo(L), lv),
      phaseLimit: G.phaseLimit(model, L, lv.cycle),
    });
    // children of this cycle
    if (L < 13) {
      const f = model.levelInfo(L).factor;
      for (const j of [0, Math.floor(f / 2), f - 1]) {
        const ch = G.childCycle(model, L, lv.cycle, j);
        out.children.push({ t, level: L, cycle: lv.cycle, j, child: ch && { level: ch.level, index: ch.index, start: ch.start, end: ch.end, clipped: ch.clipped } });
        if (ch) {
          const follower = PT.followerName(P, model, ch.level, { cycle: ch.index, cycleBig: BigInt(ch.index), clipped: ch.clipped, end: ch.end });
          out.children[out.children.length - 1].follower = follower;
          out.children[out.children.length - 1].startPhrase = PT.startPhrase(P, ch.start, ch.end, t);
          out.children[out.children.length - 1].earthStart = TX.startPhrase(fmt, ch.start, ch.end, t);
        }
      }
    }
    for (const ph of [0, 0.25, 0.5, 0.999999, 1]) {
      out.scrubs.push({ level: L, cycle: lv.cycle, phase: ph, time: G.scrubTime(model, L, lv.cycle, ph), snap: G.scrubTime(model, L, lv.cycle, ph, { snap: true }), at: G.timeAtPhase(model, L, lv.cycle, ph) });
    }
  }
}

for (const size of [322, 370, 419, 420, 600, 740]) {
  for (const count of [1, 5, 10, 14]) {
    const lay = G.ringLayout(G.dialLayoutOptions(size, count));
    const hits = [];
    for (const [x, y] of [[size / 2, 3], [size / 2 + 10, size / 2], [size - 6, size / 2 + 1], [size * 0.2, size * 0.8], [size / 2, size - 10], [1, 1]]) {
      hits.push({ x, y, hit: G.hitTest(lay, x, y) });
    }
    out.layouts.push({ size, count, rOuter: lay.rOuter, rHole: lay.rHole, band: lay.band, thick: lay.thick, hits });
  }
}

process.stdout.write(JSON.stringify(out));
