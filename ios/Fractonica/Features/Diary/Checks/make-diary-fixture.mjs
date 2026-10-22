#!/usr/bin/env node
/**
 * Expected values for DiaryChecks.swift, computed with the web app's own modules (run from the repository root):
 *
 *   node ios/Fractonica/Features/Diary/Checks/make-diary-fixture.mjs
 *
 * Writes diary-fixture.json next to this file: option sanitising (src/diary/options.js), the Delta pickers and range
 * (src/diary/plan.js, src/ui/diary/logic.js), the print readouts (paperSize, printSheets, lockShape, paperLabel,
 * twoUpLabel, printLine, lockReadout), the lines-per-Helion hint (src/core/pure.js) and a plan message as the web host
 * sends it (diary-host.js `summary`). Deterministic.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
await import(path.join(root, 'fractonica.js'));
globalThis.Path2D ??= class {};
const imp = (p) => import(path.join(root, p));
const { createModel } = await imp('src/core/model.js');
const { createPure } = await imp('src/core/pure.js');
const { sanitizeDiaryOptions, paperSize, lockShape, DIARY_DEFAULTS } = await imp('src/diary/options.js');
const { deltaRange, deltaAt, deltaPath, deltaFromPath } = await imp('src/diary/plan.js');
const { placeOf, zonePlace } = await imp('src/diary/places.js');
const L = await imp('src/ui/diary/logic.js');
const { buildDiary } = await imp('src/ui/diary/build.js');
const { pageTitle } = await imp('src/diary/render.js');

const model = createModel();
const pure = createPure(model);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- sanitising: typed inputs (what Swift can hold) with out-of-range and odd values --------------------------
const D = clone(DIARY_DEFAULTS);
const inputs = [
  {},
  D,
  { ...D, page: { size: 'A4', width: 1, height: 1, margins: { top: 1, bottom: 99, inner: 3.25, outer: 50.5 } } },
  { ...D, page: { size: 'custom', width: 500, height: 50.5, margins: D.page.margins } },
  { ...D, page: { size: 'Folio', width: 200, height: 300, margins: D.page.margins } },
  { ...D, front: { cover: true, index: false, gregorianIndex: true, ephemeris: false, reference: false, planning: 40, predictions: -3 } },
  { ...D, lock: { sheets: [[9, 9], [0, -1], [2, 4], [4, 4], [4, 4], [4, 4], [4, 4], [4, 4], [4, 4], [4, 4]] } },
  { ...D, lock: { sheets: [] } },
  { ...D, lock: { sheets: Array.from({ length: 8 }, () => [4, 4]) } },
  { ...D, lined: { linesPerHelion: 0, labels: 'weird', marginGlyphs: false, marginCurve: true } },
  { ...D, lined: { linesPerHelion: 99, labels: 'none', marginGlyphs: true, marginCurve: false } },
  { ...D, canvases: [{ type: 'grid' }, { type: 'grid' }, { type: 'dots', count: 9999 }, { type: 'lined', lines: 0 }, { type: 'dot-grid', cols: 70, rows: 0 }, { type: 'nuclide-grid' }, { type: 'blank' }, { type: 'zigzag' }, { type: 'grid' }, { type: 'grid' }] },
  { ...D, canvases: [] },
  { ...D, semi: { allCanvas: false, canvases: [{ type: 'grid' }, { type: 'dots' }] } },
  { ...D, retro: { lines: 500, canvases: [{ type: 'lined' }] } },
  { ...D, sky: { on: true, lat: 123.5, lon: -200, place: '   Tver   ', dot: 9 } },
  { ...D, sky: { on: false, lat: -12.25, lon: 44.5, place: 'x'.repeat(80), dot: 0.1 } },
  { ...D, closing: { summaryPages: 30 }, style: { ink: 'mono', font: 'serif' }, print: { twoUp: true, pairing: 'duplex', turn: 'top' } },
  { ...D, style: { ink: 'red', font: 'mono' }, print: { twoUp: true, pairing: 'zigzag', turn: 'left' } },
  { ...D, gregorian: { on: true, zone: 'Europe/Moscow', weekdays: false } },
  { ...D, gregorian: { on: true, zone: '', weekdays: true } },
];
const sanitize = inputs.flatMap((input) => [false, true].map((p) => ({ input, pure: p, output: sanitizeDiaryOptions(clone(input), { pure: p }) })));

// ---- Deltas ----------------------------------------------------------------------------------------------------
const range = deltaRange(model);
const times = [model.tMin - 1e6, model.tMin, model.tMin + 1, 946684800, 1791460800, 2886085800, model.tMax - 1, model.tMax, model.tMax + 1e6];
const deltaAtCases = times.map((t) => ({ t, delta: deltaAt(model, t) }));
const paths = [0, 1, 4, 5, 64, 65, 324, 325, 1862, range.last].map((idx) => ({ idx, path: deltaPath(model, idx), logicPath: L.pathOfIndex(idx) }));
const choiceCases = [];
for (const p of [[1, 1, 1, 1], [6, 4, 9, 3], L.pathOfIndex(range.last), [18, 1, 1, 1], [1, 5, 13, 5]]) {
  for (let level = 0; level < 4; level++) choiceCases.push({ level, path: p, choices: L.ordinalChoices(level, p, range) });
}
const clampCases = [[1, 1, 1, 1], [6, 4, 9, 3], [18, 5, 13, 5], [30, 1, 1, 1], [0, 0, 0, 0], [18, 1, 1, 1]].map((p) => ({ path: p, delta: L.clampDelta(p, range), fromPath: deltaFromPath(model, p.map((x) => Math.max(1, x))) }));
const spans = [0, 1862, range.last].map((idx) => {
  const c = model.cycleByIndex(3, idx);
  return { idx, t0: c.start, t1: c.end, name: pure.periodName(3, deltaPath(model, idx)[3]) };
});

// ---- print readouts --------------------------------------------------------------------------------------------
const printOpts = [
  D,
  { ...D, print: { twoUp: true, pairing: 'spreads', turn: 'side' } },
  { ...D, print: { twoUp: true, pairing: 'sequential', turn: 'side' } },
  { ...D, print: { twoUp: true, pairing: 'duplex', turn: 'top' } },
  { ...D, page: { ...D.page, size: 'A6', width: 105, height: 148 }, print: { twoUp: true, pairing: 'spreads', turn: 'side' } },
  { ...D, page: { ...D.page, size: 'Half Letter', width: 139.7, height: 215.9 }, print: { twoUp: true, pairing: 'duplex', turn: 'side' } },
  { ...D, page: { ...D.page, size: 'Traveler', width: 110, height: 210 }, print: { twoUp: true, pairing: 'spreads', turn: 'side' } },
  { ...D, page: { ...D.page, size: 'custom', width: 139.7, height: 200 } },
  { ...D, page: { ...D.page, size: 'custom', width: 139.7, height: 200 }, print: { twoUp: true, pairing: 'sequential', turn: 'side' } },
  { ...D, page: { ...D.page, size: 'B5', width: 176, height: 250 } },
  { ...D, lock: { sheets: [[4, 4], [4, 4], [4, 4]] } },
  { ...D, lock: { sheets: [[1, 0]] } },
  { ...D, lock: { sheets: [[3, 4], [4, 4]] } },
].map((o) => sanitizeDiaryOptions(o));
const print = [];
for (const [opt, o] of printOpts.entries()) {
  for (const pages of [1, 2, 3, 201, 202, 210, 211]) {
    print.push({
      opt,
      pages,
      paper: paperSize(o),
      sheets: L.printSheets(pages, o.print),
      lines: [false, true].map((p) => L.printLine(o, pages, p)),
    });
  }
}
const labels = printOpts.map((o) => ({
  shape: lockShape(o),
  lockReadout: L.lockReadout(lockShape(o)),
  paperLabel: [false, true].map((p) => L.paperLabel(o.page.size, o.page, p)),
  twoUpLabel: [false, true].map((p) => L.twoUpLabel(o, p)),
  pairing: L.pairingWords(o.print),
}));
const sizeLabels = ['A6', 'A5', 'B5', 'A4', 'Half Letter', 'Letter', 'Traveler', 'custom'].map((s) => ({ size: s, labels: [false, true].map((p) => L.paperLabel(s, { width: 120.25, height: 180 }, p)) }));

// ---- the lines-per-Helion hint ---------------------------------------------------------------------------------
const perLine = [1, 2, 3, 4, 6, 9, 12, 18, 24, 36, 48, 72, 144].map((n) => ({ lines: n, text: `one line per ${pure.durationPos(pure.cyclePos(6) / n)}` }));

// ---- a plan message as diary-host.js sends it -------------------------------------------------------------------
const ASTRO = new Set(['synodic', 'anomalistic', 'draconic', 'sidereal', 'solar']);
const b = buildDiary({ model, pure, input: {}, delta: 1862, appZone: 'Europe/Moscow', pureMode: false });
const p = b.plan;
const o = b.opts;
const planMessage = {
  type: 'plan', token: 7, final: !b.pending, title: b.title, zone: b.zone,
  delta: { idx: p.delta.idx, path: p.delta.path, t0: p.delta.t0, t1: p.delta.t1, name: p.delta.name, stamp: p.delta.stamp },
  pages: p.pages.map((pg) => ({ no: pg.no, kind: pg.kind, side: pg.side, title: pageTitle(p, pg) })),
  sections: p.sections.map((s) => ({ title: s.title, key: s.key, page: s.page })),
  shape: p.shape, inserts: p.inserts.length, eclipses: p.eclipses?.length ?? 0,
  events: p.events.filter((e) => ASTRO.has(e.family)).length,
  size: { width: o.page.width, height: o.page.height }, paper: paperSize(o), sheets: L.printSheets(p.pages.length, o.print),
  place: o.sky.on ? placeOf(o, b.zone) : null, zoneCity: zonePlace(b.zone),
};
const sectionAt = [1, 2, 11, 12, 13, 43, 100, p.pages.length].map((no) => ({ no, key: L.sectionAt(p.sections, no)?.key ?? null, page: L.sectionAt(p.sections, no)?.page ?? null }));

const out = { range, deltaAtCases, paths, choiceCases, clampCases, spans, sanitize, printOptions: printOpts, print, labels, sizeLabels, perLine, planMessage: JSON.stringify(planMessage), sectionAt };
fs.writeFileSync(path.join(here, 'diary-fixture.json'), JSON.stringify(out) + '\n');
console.log(`diary-fixture.json: ${sanitize.length} sanitize cases, ${print.length} print cases, plan of ${p.pages.length} pages`);
