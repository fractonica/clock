// Golden fixture for TimelineChecks: what the web timeline's pure ruler (src/ui/timeline/ruler.js) and Gregorian axis
// (src/ui/timeline/helpers.js) produce for a spread of windows, zones and instants.
//
//   node ios/Fractonica/Features/Timeline/Checks/make-fixture.mjs   (from the repository root; writes fixture.json here)
import { writeFileSync } from 'node:fs';
import '../../../../../fractonica.js';
import { createModel } from '../../../../../src/core/model.js';
import { createFormatter } from '../../../../../src/core/format.js';
import { createPure } from '../../../../../src/core/pure.js';
import { createRuler } from '../../../../../src/ui/timeline/ruler.js';
import { pickStep, generateTicks, generateContext, civilSpans, stepById, limitsFor, STEPS } from '../../../../../src/ui/timeline/helpers.js';
import { createWords } from '../../../../../src/ui/timeline/words.js';
import { createData } from '../../../../../src/ui/timeline/data.js';

const model = createModel();
const T_A = 1791460800;
const pure = createPure(model, { now: () => T_A });
const ruler = createRuler({ model, pure });
const lim = limitsFor(model.tMin, model.tMax);

const lcg = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const r = lcg(11);
const instants = [T_A, 946684800, 2886085800, model.tMin + 3600, model.tMax - 3600, ...Array.from({ length: 12 }, () => model.tMin + 1 + r() * (model.tMax - model.tMin - 2))];
const spans = [2.5, 40, 600, 3 * 3600, 86400 * 1.7, 86400 * 20, 86400 * 200, 86400 * 365.25 * 9, 86400 * 365.25 * 120, lim.maxSpan];
const widths = [342, 900];

const out = { steps: ruler.STEPS.map((s) => s.id), pick: [], ticks: [], context: [], flags: [], range: [], span: [], presets: [], greg: [] };
for (const w of widths) {
  for (let k = 0.00001; k < 3000; k *= 1.7) out.pick.push({ k, w, id: ruler.pickStep(k, w).id });
}
for (const t of instants.slice(0, 8)) {
  for (const span of spans) {
    const c = Math.min(lim.d1 - span / 2, Math.max(lim.d0 + span / 2, t));
    const t0 = c - span / 2;
    const t1 = c + span / 2;
    const step = ruler.pickStep(342 / span, 342);
    const ticks = ruler.ticksIn(step, t0, t1);
    out.ticks.push({ step: step.id, t0, t1, ticks: ticks.slice(0, 16).map((x) => ({ t: x.t, labels: x.labels, major: x.major })), count: ticks.length });
    const minor = ruler.minorStepOf(step);
    if (minor) {
      const mt = ruler.ticksIn(minor, t0, t1);
      out.ticks.push({ step: minor.id, t0, t1, ticks: mt.slice(0, 16).map((x) => ({ t: x.t, labels: x.labels, major: x.major })), count: mt.length });
    }
    const ctx = ruler.contextIn(step, t0, t1);
    out.context.push({ step: step.id, t0, t1, spans: ctx.slice(0, 10).map((s) => ({ t0: s.t0, t1: s.t1, labels: s.labels, ord: s.ord })), count: ctx.length });
    out.range.push({ t0, t1, u: step.u, text: ruler.rangeText(t0, t1, step.u) });
    out.span.push({ t0, t1, text: ruler.spanText(t0, t1, 2, 0.5 / 342), plain: ruler.spanText(t0, t1, 1) });
  }
}
for (const t of instants) {
  for (let u = 0; u < 9; u++) out.flags.push({ t, u, text: ruler.flagText(t, u) });
  out.flags.push({ t, rel: ruler.relText(t, T_A) });
  for (const p of ruler.PRESETS) {
    const w = ruler.presetWindow(p.id, lim, t, 0.3);
    out.presets.push({ id: p.id, t, c: w.c, span: w.span, active: ruler.activePreset(w.span, lim, w.c) });
  }
}
// Gregorian axis in three zones, including both 2026 DST changes in Berlin
const zones = ['UTC', 'Europe/Berlin', 'America/New_York', 'Asia/Kolkata'];
const gInstants = [T_A, Date.UTC(2026, 2, 29, 1, 30) / 1000, Date.UTC(2026, 9, 25, 0, 30) / 1000, 946684800, -11e9, 2.7e10];
for (const zone of zones) {
  const fmt = createFormatter(() => zone);
  for (const t of gInstants) {
    for (const span of [3, 50, 1200, 4 * 3600, 2 * 86400, 30 * 86400, 2 * 365.25 * 86400, 60 * 365.25 * 86400, 900 * 365.25 * 86400]) {
      const step = pickStep(342 / span);
      const t0 = t - span / 2;
      const t1 = t + span / 2;
      const ticks = generateTicks(step, t0, t1, fmt);
      const ctx = generateContext(step, t0, t1, fmt);
      const days = span <= 30 * 86400 ? civilSpans('day', t0, t1, fmt) : [];
      out.greg.push({
        zone, step: step.id, t0, t1,
        ticks: ticks.slice(0, 16).map((x) => ({ t: x.t, labels: x.labels, major: x.major })),
        context: ctx.slice(0, 8).map((s) => ({ t0: s.t0, t1: s.t1, labels: s.labels, ord: s.ord })),
        days: days.slice(0, 12).map((s) => ({ t0: s.t0, t1: s.t1, labels: s.labels, weekday: s.weekday })),
      });
    }
  }
}
// the canvas wording (src/ui/timeline/words.js and paint.js): the cursor's cycle at every depth, its block labels in
// pure mode at three widths, its Earth end label; the lane heads, the dense-lane notes and the lane-head explanations
const words = createWords({ model, pure, ruler });
const utc = createData({ model, fmt: createFormatter(() => 'UTC'), pure });
out.words = [];
for (const t of instants) {
  for (let L = 0; L <= 13; L++) {
    const c = utc.cycleAt(L, t, false);
    if (!c) continue;
    const sib = model.levelInfo(L).siblings ?? utc.alpha.length;
    const quarter = pure.isMajor(L) ? pure.QUARTER_WORDS[pure.quarterAt(t, L)] : null;
    const endsWithCatalogue = c.end >= model.tMax - 1e-3;
    const labels = [900, 100, 35].map((w) => words.blockLabels({ level: L, local: c.local, idx: c.idx, sib, wide: w === 900, w, endsWithCatalogue, quarter }));
    out.words.push({ t, L, idx: c.idx, local: c.local, start: c.start, end: c.end, quarter, labels, endLabel: utc.endLabel(L, c.idx, c.end, 2026) });
  }
}
out.lanes = [];
for (let L = 0; L <= 13; L++) out.lanes.push({ L, laneLength: words.laneLength(L), dense: words.denseMsg(L), tip: words.laneTip(L, utc.alpha.length), length: utc.lengthLabel(L) });
out.rulerTips = ruler.STEPS.map((s) => ({ id: s.id, tip: words.rulerTip(s) }));
out.gregSteps = STEPS.map((s) => s.id);
out.gregPick = [];
for (let k = 1e-9; k < 5000; k *= 1.9) out.gregPick.push({ k, id: pickStep(k).id });
writeFileSync(new URL('./fixture.json', import.meta.url), JSON.stringify(out));
console.log(`fixture: ${out.ticks.length} tick sets, ${out.greg.length} gregorian sets, ${out.flags.length} flags`);
