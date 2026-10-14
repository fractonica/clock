// Diary tab helpers (src/ui/diary/logic.js, src/ui/diary/build.js) and the command line (tools/diary-pdf.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createPure } from '../src/core/pure.js';
import { sanitizeDiaryOptions, lockShape, DIARY_DEFAULTS } from '../src/diary/options.js';
import { deltaRange, deltaPath, deltaFromPath, deltaAt } from '../src/diary/plan.js';
import {
  clampPage,
  spreadOf,
  stepPage,
  sectionAt,
  rawDeltaIndex,
  pathOfIndex,
  ordinalChoices,
  clampDelta,
  getIn,
  setIn,
  loadOptions,
  saveOptions,
  loadUi,
  saveUi,
  lockReadout,
  paperLabel,
  sheetsOf,
  printSheets,
  twoUpLabel,
  printLine,
  customOptions,
  cliCommand,
  OPTIONS_KEY,
  UI_KEY,
} from '../src/ui/diary/logic.js';
import { buildDiary, createEventCache, resolveZone, diaryTitle, deltaSpan } from '../src/ui/diary/build.js';
import { parseArgs, pdfPageCount, pdfPageSizes, sameSize } from '../tools/diary-pdf.mjs';
import { paperSize } from '../src/diary/options.js';

globalThis.Path2D ??= class {};
const model = createModel();
const pure = createPure(model);
const range = deltaRange(model);
const A = 1791460800; // SPEC vector A

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

test('pages and spreads: page 1 alone on the right, then verso | recto', () => {
  assert.equal(clampPage(0, 10), 1);
  assert.equal(clampPage(11, 10), 10);
  assert.equal(clampPage('x', 10), 1);
  assert.equal(clampPage(3.6, 10), 4);
  assert.deepEqual(spreadOf(1, 10), [null, 1]);
  assert.deepEqual(spreadOf(2, 10), [2, 3]);
  assert.deepEqual(spreadOf(3, 10), [2, 3]);
  assert.deepEqual(spreadOf(10, 10), [10, null], 'an even last page is a verso on its own');
  assert.deepEqual(spreadOf(9, 9), [8, 9]);
  // single pages
  assert.equal(stepPage(1, -1, 10), 1);
  assert.equal(stepPage(1, 1, 10), 2);
  assert.equal(stepPage(10, 1, 10), 10);
  // spreads: 1 → 2|3 → 4|5 …, and back
  assert.equal(stepPage(1, 1, 10, true), 2);
  assert.equal(stepPage(2, 1, 10, true), 4);
  assert.equal(stepPage(3, 1, 10, true), 4);
  assert.equal(stepPage(4, -1, 10, true), 3);
  assert.equal(stepPage(3, -1, 10, true), 1);
  assert.equal(stepPage(1, -1, 10, true), 1, 'stays at the start');
  assert.equal(stepPage(10, 1, 10, true), 10, 'stays at the end');
  assert.equal(stepPage(8, 1, 10, true), 10);
  // every page is reached walking spreads
  const seen = new Set();
  for (let p = 1, guard = 0; guard < 20; guard++) {
    for (const x of spreadOf(p, 11)) if (x) seen.add(x);
    const n = stepPage(p, 1, 11, true);
    if (n === p) break;
    p = n;
  }
  assert.equal(seen.size, 11);
});

test('sections: the section that holds a page', () => {
  const s = [
    { title: 'Index', page: 1 },
    { title: 'Ephemeris', page: 5 },
    { title: 'Nuclide ε#1', page: 8 },
  ];
  assert.equal(sectionAt(s, 1).title, 'Index');
  assert.equal(sectionAt(s, 7).title, 'Ephemeris');
  assert.equal(sectionAt(s, 99).title, 'Nuclide ε#1');
  assert.equal(sectionAt([{ title: 'X', page: 3 }], 2), null);
  assert.equal(sectionAt(undefined, 2), null);
});

test('Delta pickers: paths, valid ordinals, clamping into the catalogue', () => {
  for (const i of [0, 1, 4, 5, 64, 65, 324, 325, 1862, range.last]) {
    assert.deepEqual(pathOfIndex(i), deltaPath(model, i), `index ${i}`);
    assert.equal(rawDeltaIndex(pathOfIndex(i)), i);
  }
  assert.deepEqual(pathOfIndex(deltaAt(model, A)), [6, 4, 9, 3], 'SPEC vector A');
  const last = pathOfIndex(range.last);
  // Alpha: 1 … the Alpha of the last Delta
  const alpha = ordinalChoices(0, last, range);
  assert.equal(alpha.length, last[0]);
  assert.ok(alpha.every((c) => c.ok));
  // in the last Alpha only the Betas up to the last one exist
  const beta = ordinalChoices(1, last, range);
  assert.deepEqual(beta.map((c) => c.ok), [1, 2, 3, 4, 5].map((b) => b <= last[1]));
  const gamma = ordinalChoices(2, last, range);
  assert.deepEqual(gamma.filter((c) => c.ok).map((c) => c.ord).at(-1), last[2]);
  // a full Alpha in the middle: everything exists
  assert.ok(ordinalChoices(3, [6, 4, 9, 3], range).every((c) => c.ok));
  assert.equal(ordinalChoices(3, [6, 4, 9, 3], range).length, 5);
  // clamping: an impossible combination lands on the last Delta; valid ones map exactly
  assert.equal(clampDelta([6, 4, 9, 3], range), deltaFromPath(model, [6, 4, 9, 3]));
  assert.equal(clampDelta([last[0], 5, 13, 5], range), range.last);
  assert.equal(clampDelta([0, 0, 0, 0], range), range.first);
});

test('option paths: get and set without touching the source', () => {
  const o = sanitizeDiaryOptions({});
  assert.equal(getIn(o, 'page.margins.top'), 12);
  assert.equal(getIn(o, 'canvases.0.rows'), 13);
  assert.equal(getIn(o, 'retro.canvases.1.count'), 385);
  assert.equal(getIn(o, 'print.pairing'), 'spreads');
  assert.equal(getIn(o, 'lock.sheets.3.0'), 2);
  assert.equal(getIn(o, 'nope.deeper'), undefined);
  const o2 = setIn(o, 'page.margins.top', 20);
  assert.equal(o2.page.margins.top, 20);
  assert.equal(o.page.margins.top, 12, 'the source is untouched');
  const o3 = setIn(o, 'canvases.0.cols', 30);
  assert.equal(o3.canvases[0].cols, 30);
  assert.ok(Array.isArray(o3.canvases));
  assert.equal(setIn({}, 'a.b.c', 1).a.b.c, 1);
  // a form edit goes through the sanitizer
  assert.equal(sanitizeDiaryOptions(setIn(o, 'lined.linesPerHelion', 500)).lined.linesPerHelion, 72);
  assert.equal(sanitizeDiaryOptions(setIn(o, 'print.twoUp', true)).print.twoUp, true);
  assert.equal(sanitizeDiaryOptions(setIn(o, 'print.pairing', 'zigzag')).print.pairing, 'spreads');
});

test('persistence: options and tab state survive garbage and blocked storage', () => {
  const s = memoryStorage();
  assert.deepEqual(loadOptions(s), sanitizeDiaryOptions({}), 'empty storage gives the defaults');
  const custom = sanitizeDiaryOptions({ page: { size: 'A4' }, lined: { linesPerHelion: 24 }, gregorian: { zone: 'Asia/Tokyo' } });
  assert.ok(saveOptions(s, custom));
  assert.deepEqual(JSON.parse(s.map.get(OPTIONS_KEY)), custom, 'the stored value is the options object itself');
  assert.deepEqual(loadOptions(s), custom);
  assert.deepEqual(loadOptions(memoryStorage({ [OPTIONS_KEY]: '{not json' })), sanitizeDiaryOptions({}));
  assert.deepEqual(loadOptions(memoryStorage({ [OPTIONS_KEY]: '{"page":{"size":"B5"},"evil":1}' })).page.width, 176);
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.deepEqual(loadOptions(blocked), sanitizeDiaryOptions({}));
  assert.equal(saveOptions(blocked, custom), false);
  assert.equal(saveOptions(null, custom), false);
  // the tab's own state
  assert.deepEqual(loadUi(memoryStorage()), { follow: true, delta: null, page: 1, layout: 'spread', open: ['paper', 'lock'] });
  const u = memoryStorage();
  saveUi(u, { follow: false, delta: 1862, page: 44, layout: 'page', open: ['events'] });
  assert.deepEqual(loadUi(u), { follow: false, delta: 1862, page: 44, layout: 'page', open: ['events'] });
  assert.deepEqual(loadUi(memoryStorage({ [UI_KEY]: '{"follow":"yes","delta":-3,"page":0,"layout":"x","open":[1,"a"]}' })), { follow: true, delta: null, page: 1, layout: 'spread', open: ['a'] });
  assert.equal(loadUi(blocked).follow, true);
});

test('readouts: the lock shape, the paper', () => {
  assert.equal(lockReadout(lockShape(sanitizeDiaryOptions({}))), '19 Helions per lock · 4 locks + 1 retrospection Helion');
  assert.equal(lockReadout(lockShape(sanitizeDiaryOptions({ lock: { sheets: [[3, 2]] } }))), '5 Helions per lock · 15 locks + 2 retrospection Helions');
  assert.equal(lockReadout({ perLock: 7, locks: 11, retro: 0 }), '7 Helions per lock · 11 locks · no retrospection Helion');
  assert.equal(lockReadout({ perLock: 1, locks: 77, retro: 0 }), '1 Helion per lock · 77 locks · no retrospection Helion');
  assert.equal(lockReadout({ perLock: 77, locks: 1, retro: 0 }), '77 Helions per lock · 1 lock · no retrospection Helion');
  const o = sanitizeDiaryOptions({});
  assert.equal(paperLabel('A5', o.page), 'A5 · 148 × 210 mm');
  assert.equal(paperLabel('Half Letter', o.page), 'Half Letter · 139.7 × 215.9 mm');
  assert.equal(paperLabel('custom', { width: 120, height: 180 }), 'Custom · 120 × 180 mm');
  // pure mode: no bare ISO name (it would read like a note name)
  assert.equal(paperLabel('A5', o.page, true), '148 × 210 mm · A series');
  assert.equal(paperLabel('B5', o.page, true), '176 × 250 mm · B series');
  assert.doesNotMatch(paperLabel('A4', o.page, true), /\b[A-G]\d\b/);
  assert.equal(sheetsOf(198), 99);
  assert.equal(sheetsOf(7), 4);
});

test('build: zone, events memo, plan, env, title', () => {
  assert.equal(resolveZone('Asia/Tokyo', 'Europe/Berlin'), 'Asia/Tokyo');
  assert.equal(resolveZone(null, 'Europe/Berlin'), 'Europe/Berlin');
  assert.equal(resolveZone('Not/AZone', 'Europe/Berlin'), 'Europe/Berlin');
  assert.equal(typeof resolveZone(null, null), 'string');
  let calls = 0;
  const cache = createEventCache((t0, t1) => {
    calls++;
    return [{ t: t0 + (t1 - t0) / 2, family: 'synodic', name: 'full-moon', label: 'Full moon', labelPure: 'Full moon', symbol: '○' }];
  });
  const delta = deltaAt(model, A);
  const a = buildDiary({ model, pure, input: {}, delta, appZone: 'Europe/Berlin', eventCache: cache });
  assert.equal(a.zone, 'Europe/Berlin');
  assert.equal(a.title, 'Diary · Delta Trifracton (α#6 β#4 γ#9 δ#3)');
  assert.equal(diaryTitle(a.plan), a.title);
  assert.equal(a.plan.events.filter((e) => e.family === 'synodic').length, 1, 'the ephemeris reaches the plan');
  assert.equal(a.env.pureMode, false);
  assert.equal(a.env.fmt.zone(), 'Europe/Berlin', 'the renderer formats in the plan’s zone');
  assert.equal(a.env.F, model.F);
  // paper and lock changes reuse the ephemeris; another Delta or other families recompute it
  buildDiary({ model, pure, input: { page: { size: 'A4' }, lock: { sheets: [[3, 2]] }, events: { solarSync: false } }, delta, appZone: 'UTC', eventCache: cache });
  assert.equal(calls, 1);
  buildDiary({ model, pure, input: { events: { synodic: false } }, delta, eventCache: cache });
  assert.equal(calls, 2);
  buildDiary({ model, pure, input: {}, delta: delta + 1, eventCache: cache });
  assert.equal(calls, 3);
  // pure mode: Gregorian off, whatever the options say
  const p = buildDiary({ model, pure, input: { gregorian: { on: true } }, delta, appZone: 'Europe/Berlin', pureMode: true, eventCache: cache });
  assert.equal(p.opts.gregorian.on, false);
  assert.equal(p.plan.days.length, 0);
  assert.equal(p.env.pureMode, true);
  // the options change the plan
  const a4 = buildDiary({ model, pure, input: { page: { size: 'A4' }, lined: { linesPerHelion: 24 } }, delta, eventCache: cache });
  assert.equal(a4.plan.opts.page.width, 210);
  assert.equal(a4.plan.pages.find((x) => x.kind === 'lined').sections[0].lines, 24);
  // a failing ephemeris never breaks the diary
  const broken = createEventCache(() => {
    throw new Error('boom');
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(buildDiary({ model, pure, input: {}, delta, eventCache: broken }).plan.pages.length % 2, 0);
  } finally {
    console.warn = warn;
  }
  const sp = deltaSpan(model, delta);
  assert.ok(sp.t0 <= A && A < sp.t1);
});

test('command line: arguments', () => {
  assert.deepEqual(parseArgs([]), { t: null, delta: null, path: null, options: null, zone: null, pure: false, twoUp: false, pairing: null, out: 'diary.pdf', help: false });
  assert.equal(parseArgs(['--t', '1791460800']).t, 1791460800);
  assert.equal(parseArgs(['--t=2026-10-08T12:00:00Z']).t, Date.UTC(2026, 9, 8, 12) / 1000);
  assert.equal(parseArgs(['--t', '-11253795000']).t, -11253795000, 'negative Unix seconds are a value, not a flag');
  assert.equal(parseArgs(['--delta', '1862']).delta, 1862);
  assert.deepEqual(parseArgs(['--path', '6,4,9,3']).path, [6, 4, 9, 3]);
  assert.deepEqual(parseArgs(['--path', 'α#6 β#4 γ#9 δ#3']).path, [6, 4, 9, 3]);
  const all = parseArgs(['--path', '6,4,9,3', '--options', 'o.json', '--zone', 'Europe/Berlin', '--pure', '--out', 'x.pdf']);
  assert.deepEqual(all, { t: null, delta: null, path: [6, 4, 9, 3], options: 'o.json', zone: 'Europe/Berlin', pure: true, twoUp: false, pairing: null, out: 'x.pdf', help: false });
  assert.equal(parseArgs(['--two-up']).twoUp, true);
  assert.deepEqual([parseArgs(['--pairing', 'sequential']).twoUp, parseArgs(['--pairing=sequential']).pairing], [true, 'sequential'], '--pairing implies two-up');
  assert.throws(() => parseArgs(['--pairing', 'zigzag']), /--pairing/);
  assert.equal(parseArgs(['-h']).help, true);
  assert.throws(() => parseArgs(['--t', 'soon']), /--t/);
  assert.throws(() => parseArgs(['--delta', '1.5']), /--delta/);
  assert.throws(() => parseArgs(['--path', '6,4,9']), /--path/);
  assert.throws(() => parseArgs(['--zone', 'Mars/Olympus']), /--zone/);
  assert.throws(() => parseArgs(['--out']), /needs a value/);
  assert.throws(() => parseArgs(['--delta', '3', '--t', '5']), /only one/);
  assert.throws(() => parseArgs(['--frobnicate']), /unknown/);
});

test('command line: PDF page count', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] >>\n2 0 obj << /Type /Page >>\n3 0 obj <</Type/Page/Parent 1 0 R>>\n', 'latin1');
  assert.equal(pdfPageCount(pdf), 2);
  const a4l = Buffer.from('<< /Type /Page /MediaBox [0 0 841.68 595.2] >> << /Type /Page /MediaBox [0 0 841.68 595.2] >>', 'latin1');
  const sizes = pdfPageSizes(a4l);
  assert.equal(sizes.length, 1);
  assert.ok(sameSize(sizes, { width: 297, height: 210 }), 'Chromium rounds A4 landscape to its pixels');
  assert.ok(!sameSize(sizes, { width: 210, height: 297 }));
  assert.ok(!sameSize(pdfPageSizes(Buffer.from('/MediaBox [0 0 100 100] /MediaBox [0 0 200 100]')), { width: 297, height: 210 }), 'mixed sizes fail');
  assert.ok(DIARY_DEFAULTS.page.size);
});

test('printing: two pages per sheet, the PDF it makes, the command line', () => {
  // facing pages: page 1 alone on the right, then 2|3 …; in order: 1|2, 3|4 …
  assert.equal(printSheets(200, { twoUp: false }), 200);
  assert.equal(printSheets(200, { twoUp: true, pairing: 'spreads' }), 101);
  assert.equal(printSheets(200, { twoUp: true, pairing: 'sequential' }), 100);
  assert.equal(printSheets(199, { twoUp: true, pairing: 'sequential' }), 100);
  assert.equal(printSheets(198, { twoUp: true, pairing: 'spreads' }), 100);
  const o = sanitizeDiaryOptions({ print: { twoUp: true } });
  assert.deepEqual(paperSize(o), { width: 297, height: 210, name: 'A4', twoUp: true, cell: 148.5 }, 'two A5 pages on A4 landscape');
  assert.equal(twoUpLabel(o), '2 × A5 on A4 landscape (297 × 210 mm)');
  assert.equal(twoUpLabel(sanitizeDiaryOptions({ page: { size: 'A4' } })), '2 × A4 on A3 landscape (420 × 297 mm)', 'what two-up would make, also while it is off');
  assert.equal(twoUpLabel(sanitizeDiaryOptions({ page: { size: 'custom', width: 120, height: 180 } })), '2 pages on 240 × 180 mm, landscape');
  // pure mode: no ISO names (a bare "A5" reads like a note name)
  assert.equal(twoUpLabel(o, true), '2 pages on 297 × 210 mm, landscape');
  assert.equal(printLine(sanitizeDiaryOptions({}), 200), 'PDF: 200 pages of A5 · 148 × 210 mm');
  assert.equal(printLine(sanitizeDiaryOptions({}), 200, true), 'PDF: 200 pages of 148 × 210 mm');
  assert.equal(printLine(o, 200), 'PDF: 101 pages of A4 landscape · 297 × 210 mm, two diary pages each (facing pages)');
  assert.equal(printLine(sanitizeDiaryOptions({ print: { twoUp: true, pairing: 'sequential' } }), 200, true), 'PDF: 100 pages of 297 × 210 mm landscape, two diary pages each (in order)');
  for (const text of [twoUpLabel(o, true), printLine(o, 200, true)]) assert.doesNotMatch(text, /\b[A-G]\d\b/);
  // the command line
  assert.equal(customOptions(sanitizeDiaryOptions({})), false);
  assert.equal(customOptions(sanitizeDiaryOptions({ print: { twoUp: true } })), false, 'print settings travel as flags');
  assert.equal(customOptions(sanitizeDiaryOptions({ page: { size: 'A4' } })), true);
  assert.equal(cliCommand([6, 4, 9, 3], sanitizeDiaryOptions({})), 'node tools/diary-pdf.mjs --path 6,4,9,3');
  assert.equal(cliCommand([6, 4, 9, 3], o, { pureMode: true }), 'node tools/diary-pdf.mjs --path 6,4,9,3 --two-up --pure');
  assert.equal(cliCommand([6, 4, 9, 3], sanitizeDiaryOptions({ lined: { linesPerHelion: 24 }, print: { twoUp: true, pairing: 'sequential' } })), 'node tools/diary-pdf.mjs --path 6,4,9,3 --options diary-options.json --two-up --pairing sequential');
  assert.equal(cliCommand([6, 4, 9, 3], sanitizeDiaryOptions({ print: { pairing: 'sequential' } })), 'node tools/diary-pdf.mjs --path 6,4,9,3', 'pairing alone prints nothing two-up');
});
