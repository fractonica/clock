import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createPure } from '../src/core/pure.js';
import { createFormatter } from '../src/core/format.js';
import { sanitizeDiaryOptions } from '../src/diary/options.js';
import { planDiary, deltaAt, deltaRange } from '../src/diary/plan.js';
import { renderPage, printDocument, pageTitle, sheetsOf, duplexSheets } from '../src/diary/render.js';
import { lineLabel, labelStep, scatter } from '../src/diary/render/helion.js';
import { seedOf, measure, fit, wrap } from '../src/diary/render/common.js';
import { RULES } from '../tools/pure-scan.mjs';
import { createSkyCache, buildDiary, createEclipseCache } from '../src/ui/diary/build.js';

globalThis.Path2D ??= class {};
const model = createModel();
const pure = createPure(model);
const A = 1791460800; // SPEC vector A
const delta = deltaAt(model, A);
const D = model.cycleByIndex(3, delta);
const DAY = 86400;

/** Mean-motion lunar and solar events (the shape of src/diary/astro's output) for a realistic density. */
function synthetic(t0, t1) {
  const out = [];
  const series = (family, ref, period, names, labels, pures = labels, symbols = []) => {
    for (let k = Math.floor((t0 - ref) / period) - 1; ref + k * period <= t1; k++) {
      names.forEach((name, i) => {
        const t = ref + (k + i / names.length) * period;
        if (t >= t0 && t < t1) out.push({ t, family, name, label: labels[i], labelPure: pures[i], symbol: symbols[i] });
      });
    }
  };
  series('synodic', 947182440, 29.530589 * DAY, ['new-moon', 'first-quarter', 'full-moon', 'last-quarter'], ['New Moon', 'First Quarter', 'Full Moon', 'Last Quarter'], undefined, ['●', '◐', '○', '◑']);
  series('anomalistic', 948326400, 27.55455 * DAY, ['perigee', 'post-perigee', 'apogee', 'post-apogee'], ['Perigee', 'Post-perigee', 'Apogee', 'Post-apogee']);
  series('draconic', 946700000, 27.212221 * DAY, ['ascending-node', 'post-ascending', 'descending-node', 'post-descending'], ['Ascending node', 'Post-ascending', 'Descending node', 'Post-descending']);
  series('sidereal', 946900000, 27.321662 * DAY, ['galactic-centre', 'post-centre', 'galactic-anticentre', 'post-anticentre'], ['Galactic centre', 'Post-centre', 'Galactic anticentre', 'Post-anticentre']);
  series('solar', 953537700, 365.2422 * DAY, ['march-equinox', 'june-solstice', 'september-equinox', 'december-solstice'], ['March equinox', 'June solstice', 'September equinox', 'December solstice'], ['Northward equinox', 'Northern solstice', 'Southward equinox', 'Southern solstice']);
  return out.sort((a, b) => a.t - b.t);
}

const skyCache = createSkyCache(8);
const MOSCOW = { place: 'Moscow', lat: 55.7558, lon: 37.6173 };

function build(input = {}, { pureMode = false, zone = 'Europe/Berlin', events, at = delta, place = MOSCOW } = {}) {
  const opts = sanitizeDiaryOptions(input, { pure: pureMode });
  const C = model.cycleByIndex(3, at);
  const sky = opts.sky.on && place ? skyCache(model, at, place) : null;
  const plan = planDiary({ model, pure, opts, delta: at, zone, events: events ?? synthetic(C.start, C.end), sky });
  const env = { model, pure, F: globalThis.Fractonica, fmt: createFormatter(() => plan.zone), pureMode };
  return { plan, env, opts };
}

// ---- reading the markup back ------------------------------------------------------------------------------

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const attr = (a, k) => {
  const m = new RegExp(`(?:^|\\s)${k}="([^"]*)"`).exec(a);
  return m ? m[1] : undefined;
};
/** Every <text> with its estimated box: {s, x0, x1, y0, y1}. */
function texts(svg, font = 'sans') {
  const out = [];
  for (const m of svg.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/g)) {
    const a = m[1];
    const x = Number(attr(a, 'x'));
    const y = Number(attr(a, 'y'));
    const anchor = attr(a, 'text-anchor') ?? 'start';
    const ls = Number(attr(a, 'letter-spacing') ?? 0);
    let w = 0;
    let size = Number(attr(a, 'font-size') ?? 0);
    let s = '';
    if (m[2].includes('<tspan')) {
      for (const t of m[2].matchAll(/<tspan([^>]*)>([\s\S]*?)<\/tspan>/g)) {
        const fs = Number(attr(t[1], 'font-size'));
        const txt = decode(t[2]);
        w += Number(attr(t[1], 'dx') ?? 0) + measure(txt, fs, { weight: Number(attr(t[1], 'font-weight') ?? 400), font });
        size = Math.max(size, fs);
        s += (s ? ' ' : '') + txt;
      }
    } else {
      s = decode(m[2]);
      w = measure(s, size, { weight: Number(attr(a, 'font-weight') ?? 400), font }) + ls * [...s].length;
    }
    const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    // text turned 90° clockwise about (x, y) (the thumb index): it runs down from y, its glyphs stand to the right of x
    if (/rotate\(90 /.test(attr(a, 'transform') ?? '')) out.push({ s, x0: x - size * 0.2, x1: x + size * 0.74, y0: y, y1: y + w, size });
    else out.push({ s, x0, x1: x0 + w, y0: y - size * 0.74, y1: y + size * 0.2, size });
  }
  return out;
}
const textOf = (svg) => texts(svg).map((t) => t.s);

/** Problems of one page: markup, paper bounds, text overlaps (estimated widths are an upper bound of the real ones). */
function problems(svg, W, H, font) {
  const out = [];
  if (!svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')) out.push('not an svg');
  if (!svg.includes(`viewBox="0 0 ${W} ${H}"`) || !svg.includes(`width="${W}mm" height="${H}mm"`)) out.push('viewBox / size');
  if (/NaN|undefined|Infinity|\[object/.test(svg)) out.push('bad value in markup');
  if (/<image|<foreignObject|<script|url\((?!#)|href=/.test(svg)) out.push("non-vector or external content");
  const open = (svg.match(/<(text|tspan|g|svg)\b/g) ?? []).length;
  const close = (svg.match(/<\/(text|tspan|g|svg)>/g) ?? []).length;
  if (open !== close) out.push(`unbalanced tags ${open}/${close}`);
  const ts = texts(svg, font);
  for (const t of ts) if (t.x0 < 0.3 || t.x1 > W - 0.3 || t.y0 < 0.3 || t.y1 > H - 0.3) out.push(`off-paper "${t.s}" ${t.x0.toFixed(1)}..${t.x1.toFixed(1)}`);
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const p = ts[i];
      const q = ts[j];
      if (p.x0 < q.x1 - 0.05 && q.x0 < p.x1 - 0.05 && p.y0 < q.y1 - 0.05 && q.y0 < p.y1 - 0.05) out.push(`overlap "${p.s}" × "${q.s}"`);
    }
  }
  return out;
}

function checkBook({ plan, env, opts }, label) {
  const { width: W, height: H } = opts.page;
  const bad = [];
  for (const p of plan.pages) {
    const pr = problems(renderPage(plan, p, env), W, H, opts.style.font);
    if (pr.length) bad.push(`p${p.no} ${p.kind}: ${pr.slice(0, 3).join(' | ')}`);
  }
  assert.deepEqual(bad, [], `${label}: ${bad.length} pages with problems`);
}

// ---- tests ---------------------------------------------------------------------------------------------------------

const base = build();

test('every page of the default A5 book is a clean vector SVG: on the paper, no overlaps', () => {
  assert.equal(base.opts.page.size, 'A5');
  const kinds = new Set(base.plan.pages.map((p) => p.kind));
  for (const k of ['index', 'gregorian', 'ephemeris', 'ladder', 'milestones', 'planning', 'predictions', 'nuclide', 'lined', 'canvas', 'insert', 'summary', 'notes']) assert.ok(kinds.has(k), k);
  checkBook(base, 'A5');
});

test('paper sizes and density options all hold', () => {
  const cases = [
    [{ page: { size: 'A6' } }, 'A6'],
    [{ page: { size: 'A4' }, front: { cover: true } }, 'A4'],
    [{ page: { size: 'A6' }, lined: { linesPerHelion: 36 }, lock: { sheets: [[4, 4], [4, 4], [3, 0]] } }, 'A6 dense'],
    [{ lined: { linesPerHelion: 6, labels: 'preon' } }, '6 lines'],
    [{ lined: { linesPerHelion: 24 } }, '24 lines'],
    [{ lined: { linesPerHelion: 72, marginGlyphs: false, marginCurve: false } }, '72 lines'],
    [{ lock: { sheets: [[3, 2]] }, closing: { summaryPages: 1 }, front: { planning: 2, predictions: 3 } }, '3/2 locks'],
    [{ style: { ink: 'mono', font: 'serif' }, lined: { labels: 'none' } }, 'mono serif'],
    [{ canvases: [{ type: 'dot-grid', cols: 24, rows: 12 }, { type: 'lined', lines: 20 }, { type: 'blank' }], retro: { lines: 72, canvases: [{ type: 'dots', count: 900 }, { type: 'grid', cols: 40, rows: 30 }] } }, 'canvases'],
    [{ page: { size: 'custom', width: 90, height: 140, margins: { top: 8, bottom: 8, inner: 10, outer: 9 } }, front: { cover: true } }, 'small custom'],
    [{ page: { size: 'A6' }, front: { cover: true }, gregorian: { weekdays: false } }, 'A6 cover'],
  ];
  for (const [o, label] of cases) checkBook(build(o), label);
});

test('the first and last Delta of the catalogue, odd lock patterns, a half-hour zone, unknown events', () => {
  const { first, last } = deltaRange(model);
  const o = { lock: { sheets: [[4, 0], [3, 1]] }, retro: { canvases: [{ type: 'blank' }] }, inserts: { deltaQuarters: false }, front: { cover: true } };
  for (const at of [first, last]) {
    const C = model.cycleByIndex(3, at);
    const odd = [{ t: C.start + 0.3 * (C.end - C.start), family: 'synodic', name: 'blue-moon' }];
    const b = build(o, { at, zone: 'Asia/Kolkata', events: [...synthetic(C.start, C.end), ...odd] });
    checkBook(b, `Delta ${at}`);
    const t = b.plan.pages.flatMap((p) => textOf(renderPage(b.plan, p, b.env)));
    assert.ok(t.some((x) => x.includes('Blue moon')), 'an unnamed event still reads');
    assert.ok(t.every((x) => !/UTC|GMT|Asia|Kolkata/.test(x)), 'no zone labels: Gregorian times are the local times of the zone');
    checkBook(build(o, { at, pureMode: true }), `pure Delta ${at}`);
  }
});

test('a lined page: section headers, line labels, quarter glyphs, the wave, events at their place', () => {
  const { plan, env } = base;
  const page = plan.pages.find((p) => p.kind === 'lined' && !p.retro && p.sections.length === 3);
  const svg = renderPage(plan, page, env);
  const t = textOf(svg);
  for (const s of page.sections) {
    const h = plan.helions[s.d];
    assert.ok(t.some((x) => x.startsWith(`${h.label} ${h.stamp}`)), `header of ${h.label}`);
  }
  for (const k of [0, 3, 6, 9, 12, 33]) assert.ok(t.some((x) => x.startsWith(`${k}ι `)), `label ${k}ι`);
  const h0 = plan.helions[page.sections[0].d];
  assert.ok(t.includes(`0ι ${env.fmt.time(Math.round(h0.t0 / 60) * 60, { seconds: false })}`), 'Preon count and Gregorian time at the inner edge');
  // 4 quarter glyphs per section, drawn from the library geometry, and the Delta's phase (2 glyphs) in the head
  assert.equal((svg.match(/<g transform="translate/g) ?? []).length, 4 * page.sections.length + 2);
  // the wave: per section a crest and a trough, arcs of TRUE circles (rx = ry) of the same radius, as deep as allowed
  const waves = [...svg.matchAll(/M([\d.]+) ([\d.]+)A([\d.]+) \3 0 0 1 \1 ([\d.]+)A\3 \3 0 0 0 \1 ([\d.]+)"/g)];
  assert.equal(waves.length, page.sections.length, 'circular crest + trough per section');
  for (const m of waves) {
    const [r, y0, y1, y2] = [m[3], m[2], m[4], m[5]].map(Number);
    const L = y1 - y0;
    assert.ok(Math.abs(y2 - y1 - L) < 0.02, 'two equal half-cycles');
    const sag = r - Math.sqrt(Math.max(0, r * r - (L * L) / 4));
    assert.ok(sag > 1 && sag < 1.7, `sagitta ${sag.toFixed(2)} mm: the depth the margin allows`);
  }
  // the running head: Delta words with the quarter and the Nuclide; the global Saros phase as the Helion's number in its Alpha
  const h1 = plan.helions[page.sections[0].d];
  assert.ok(t.some((x) => /^Delta Trifracton (Peak|Node|Valley|End).* · ε#\d /.test(x) && x.includes(pure.groupDigits(h1.alpha)) && !x.includes('125 125')), 'running head');
  assert.ok(!t.some((x) => /Lock \d · sheet/.test(x)), 'no lock/sheet label');
  assert.ok(!svg.includes('r="0.32"') && !svg.includes('stroke-width="0.55"'), 'no dial: the number alone');
  assert.ok(t.includes(String(page.no)), 'folio');
});

test('events: a full moon at 0.4 of a Helion, an equinox, a perigee; syncs and majors in words', () => {
  const h = base.plan.helions[100];
  const at = (f, hh = h) => hh.t0 + f * (hh.t1 - hh.t0);
  const h2 = base.plan.helions[200];
  const evs = [
    { t: at(0.4), family: 'synodic', name: 'full-moon', label: 'Full Moon', labelPure: 'Full Moon', symbol: '○' },
    { t: at(0.7), family: 'anomalistic', name: 'perigee', label: 'Perigee', labelPure: 'Perigee', symbol: '■' },
    { t: at(0.55, h2), family: 'solar', name: 'september-equinox', label: 'September equinox', labelPure: 'Southward equinox', symbol: '⊖' },
  ];
  const b = build({}, { events: evs });
  const page = b.plan.pages[b.plan.helions[100].page - 1];
  const t = textOf(renderPage(b.plan, page, b.env));
  const clock = pure.clockText(evs[0].t + 0.01, 'lambda');
  // said on its rule across the body: symbol, name, Gregorian time, Fractonica clock
  const time = b.env.fmt.time(Math.round(evs[0].t / 60) * 60, { seconds: false });
  assert.ok(t.includes(`○ Full Moon · ${time} · ${clock}`), `○ Full Moon · ${time} · ${clock}`);
  assert.ok(t.some((x) => x.includes('Perigee')));
  const eq = textOf(renderPage(b.plan, b.plan.pages[b.plan.helions[200].page - 1], b.env));
  assert.ok(eq.some((x) => x.includes('September equinox') || (x.includes('September') && eq.some((y) => y.includes('equinox')))));
  // the pure page names the equinox by its pure label
  const p = build({}, { events: evs, pureMode: true });
  const peq = textOf(renderPage(p.plan, p.plan.pages[p.plan.helions[200].page - 1], p.env)).join(' ');
  assert.ok(peq.includes('Southward') && !peq.includes('September'));
  // the Delta's peak is said in words on the page that holds it, with its time and clock
  const peak = b.plan.majors.find((m) => m.level === 3 && m.event === 'peak');
  const words = textOf(renderPage(b.plan, b.plan.pages[b.plan.pageOf(peak.t) - 1], b.env));
  assert.ok(words.some((x) => x.startsWith('Delta Trifracton · Peak ends → Node · ') && x.endsWith(pure.clockText(peak.t + 0.01, 'lambda'))), 'major threshold in words');
  // a solar sync names its number and drift
  const sync = b.plan.events.find((e) => e.family === 'sync');
  const st = textOf(renderPage(b.plan, b.plan.pages[sync.page - 1], b.env));
  assert.ok(st.some((x) => x.includes(`Sync ${sync.sync}`)));
  assert.ok(st.some((x) => x.includes(`Sync ${sync.sync} · drift `)));
});

test('coinciding thresholds (Gamma node = Delta node) stack their labels', () => {
  const node = base.plan.majors.filter((m) => m.event === 'node' && Math.abs(m.t - base.plan.majors.find((x) => x.level === 3 && x.event === 'node').t) < 1);
  assert.ok(node.length >= 2, 'the Gamma node falls on the Delta node at vector A');
  const page = base.plan.pages[base.plan.pageOf(node[0].t) - 1];
  const svg = renderPage(base.plan, page, base.env);
  const t = textOf(svg);
  assert.ok(t.some((x) => x.startsWith('Gamma Nonafracton · Node ends → Valley')));
  assert.ok(t.some((x) => x.startsWith('Delta Trifracton · Node ends → Valley')));
  assert.deepEqual(problems(svg, 148, 210, 'sans'), []);
});

test('canvases: the grid, deterministic dots seeded by the Helion, dot-grid, lined, blank', () => {
  const { plan, env } = base;
  const back = plan.pages.find((p) => p.kind === 'canvas' && !p.retro);
  assert.deepEqual(back.sections.map((s) => s.canvas.type), ['grid', 'blank']);
  const svg = renderPage(plan, back, env);
  assert.equal(svg, renderPage(plan, back, env), 'the same page renders the same');
  // 19 × 13 grid: 18 inner verticals and 12 inner horizontals in one path, plus the frame
  const grid = /<path d="((?:M[\d.]+ [\d.]+[VH][\d.]+)+)"[^>]*stroke="#c5cbd1"/.exec(svg)[1];
  assert.equal((grid.match(/V/g) ?? []).length, 18);
  assert.equal((grid.match(/H/g) ?? []).length, 12);
  // as large as fits: the full content width on A5 (148 − 16 − 20 = 112 mm)
  const vs = [...grid.matchAll(/M([\d.]+) /g)].map((m) => Number(m[1]));
  assert.ok(Math.abs((vs[1] - vs[0]) * 19 - 112) < 0.1, "square cells across the width");
  // the blank canvas: its corner marks
  assert.equal((svg.match(/H[\d.]+V[\d.]+/g) ?? []).length, 4);
  // scattered dots on a retro canvas: 385 of them (two arcs each)
  const dotted = build({ retro: { canvases: [{ type: 'blank' }, { type: 'dots', count: 385 }] } });
  const retroDots = dotted.plan.pages.find((p) => p.kind === 'canvas' && p.retro && p.canvas.type === 'dots');
  const dsvg = renderPage(dotted.plan, retroDots, dotted.env);
  const dots = /<path d="((?:M[\d.]+ [\d.]+a[^M]+)+)" fill/.exec(dsvg)[1];
  assert.equal((dots.match(/M/g) ?? []).length, 385);
  assert.equal(dsvg, renderPage(dotted.plan, retroDots, dotted.env), 'the same dots every time');
  const a = scatter(50, 0, 0, 100, 60, seedOf(123, 0, 77));
  assert.deepEqual(a, scatter(50, 0, 0, 100, 60, seedOf(123, 0, 77)), 'deterministic');
  assert.notDeepEqual(a, scatter(50, 0, 0, 100, 60, seedOf(124, 0, 77)), 'another Helion, other dots');
  assert.ok(a.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 60));
  // the retro Helion: a fine lined page (36 lines, one per Preon) and its two canvases on their own pages
  const retro = plan.pages.find((p) => p.kind === 'lined' && p.retro);
  const rt = textOf(renderPage(plan, retro, env));
  for (let k = 0; k < 36; k++) assert.ok(rt.some((x) => x.startsWith(`${k}ι `)), `retro label ${k}ι`);
  assert.ok(rt.some((x) => x.includes('ε#1 · 77η')));
  const [c1, c2] = [plan.pages[retro.no], plan.pages[retro.no + 1]];
  assert.ok(textOf(renderPage(plan, c1, env)).some((x) => x.includes('canvas 1/2')));
  assert.ok(textOf(renderPage(plan, c2, env)).some((x) => x.includes('canvas 2/2')));
  assert.deepEqual([c1.canvas.type, c2.canvas.type], ['blank', 'nuclide-grid']);
});

test('front matter: every index row and day page is printed; the ephemeris lists events with a legend', () => {
  const { plan, env } = base;
  const idx = plan.pages.filter((p) => p.kind === 'index');
  const it = idx.flatMap((p) => textOf(renderPage(plan, p, env)));
  assert.ok(it.includes('Delta Trifracton'));
  assert.ok(it.some((x) => x.startsWith('Alpha Hexafracton · Beta Tetrafracton · Gamma Nonafracton')));
  assert.ok(it.some((x) => x.startsWith('Ends → Delta Tetrafracton begins')));
  for (const r of plan.index) if (r.page) assert.ok(it.includes(String(r.page)), `index page ${r.page}`);
  assert.ok(it.includes('ε#2 lock 3 · 39η–57η'), 'Helions numbered from 1');
  assert.ok(it.includes('ε#2 retrospection · 77η'));
  assert.ok(it.includes('Delta Trifracton · Peak ends → Node'));
  const greg = plan.pages.filter((p) => p.kind === 'gregorian').flatMap((p) => textOf(renderPage(plan, p, env)));
  for (const d of plan.days) assert.ok(greg.includes(String(d.page)), `day ${d.y}-${d.m}-${d.d} → page ${d.page}`);
  const eph = plan.pages.filter((p) => p.kind === 'ephemeris');
  const et = eph.flatMap((p) => textOf(renderPage(plan, p, env)));
  const rows = eph.flatMap((p) => p.rows);
  assert.ok(rows.length > 30);
  for (const e of rows) assert.ok(et.includes(pure.dateText(e.t + 0.01, { letters: true, upTo: 'lambda' })), 'Fractonica to the Flavon');
  for (const w of ['Synodic month', 'Anomalistic month', 'Draconic month', 'Sidereal month', 'Solar events']) assert.ok(et.some((x) => x.startsWith(w)), w);
  // planning, predictions, Nuclide header, insert, summary
  const pl = textOf(renderPage(plan, plan.pages.find((p) => p.kind === 'planning'), env));
  for (let n = 1; n <= 5; n++) assert.ok(pl.some((x) => x.startsWith(`ε#${n} `)), `planning block ε#${n}`);
  const pr = textOf(renderPage(plan, plan.pages.find((p) => p.kind === 'predictions'), env));
  for (const q of ['Peak', 'Node', 'Valley', 'End']) assert.ok(pr.some((x) => x.startsWith(`${q} quarter`)), q);
  const nu = textOf(renderPage(plan, plan.pages.find((p) => p.kind === 'nuclide' && p.n === 1), env));
  assert.ok(nu.includes('ε#2') && nu.includes('Nuclide 2 of Delta Trifracton'));
  for (const l of plan.nuclides[1].locks) assert.ok(nu.includes(String(l.firstPage)));
  assert.ok(nu.includes(String(plan.nuclides[1].retroPage)));
  const ins = plan.pages.find((p) => p.kind === 'insert');
  const insT = textOf(renderPage(plan, ins, env));
  assert.ok(insT.includes(ins.major.name) && insT.some((x) => x.startsWith(`${ins.major.quarter} ends → `)));
  const sum = plan.pages.filter((p) => p.kind === 'summary').flatMap((p) => textOf(renderPage(plan, p, env)));
  for (let n = 1; n <= 5; n++) assert.ok(sum.some((x) => x.startsWith(`ε#${n} `)));
  for (const q of ['Peak', 'Node', 'Valley', 'End']) assert.ok(sum.some((x) => x.startsWith(`${q} quarter`)));
});

test('the reference sheet: the ladder of 63 levels, the milestones of Alpha, Beta, Gamma with their eclipses', () => {
  const { env } = base;
  const page = (p, k) => textOf(renderPage(p.plan, p.plan.pages.find((x) => x.kind === k), p.env));
  const lad = page(base, 'ladder');
  for (let d = 1; d <= 63; d++) assert.ok(lad.includes(String(d)), `depth ${d}`);
  for (const s of ['Helion', 'Blink', '5.05 h', '311 ms', '3.22 Hz', '457 THz', 'visible 656 nm', '4.83 × 10⁻⁴³ s', '2.07 × 10⁴² Hz', '125 125']) assert.ok(lad.includes(s), s);
  assert.ok(lad.some((x) => x.startsWith('The next level, π2 (depth 64)') && x.includes('Planck time is 5.39 × 10⁻⁴⁴ s')));
  assert.ok(lad.some((x) => x.includes('S = 5, 13,')), 'the derivation: the factor sequence');
  const mil = page(base, 'milestones');
  for (let k = 20; k <= 24; k++) assert.ok(mil.includes(`● #${k}`), `eclipse #${k}`);
  assert.ok(mil.includes('Beta Difracton Peak · Gamma Tetrafracton Peak'));
  for (const m of ['● #20 Begins', '● #21 Peak', '● #22 Node', '● #23 Valley', '● #24 End', '▸ this diary', '▸ Beta Tetrafracton']) assert.ok(mil.includes(m), m);
  assert.ok(mil.includes(`● ${env.fmt.parts(model.catalogue[21]).day} Jan 1992`), 'the Beta eclipse cell carries its date');
  // pure mode: Blinks and positions instead of Earth units and dates
  const p = build({}, { pureMode: true });
  const plad = page(p, 'ladder');
  assert.ok(plad.includes('58 500') && plad.includes('2 772 pB') && plad.includes('1 pB'));
  assert.ok(!plad.some((x) => /Hz|\d (s|ms|min|h|d|y)$/.test(x)));
  const pmil = page(p, 'milestones');
  assert.ok(pmil.includes('pos 21') && pmil.includes('20.985') && !pmil.some((x) => /19\d\d|20[0-4]\d/.test(x)));
});

/** The default diary as the Diary tab builds it (real ephemeris, the eclipses with their maps), Moscow's sky. */
async function buildReal({ pureMode = false, input = {} } = {}) {
  const args = { model, pure, F: globalThis.Fractonica, input, delta, appZone: 'Europe/Moscow', pureMode, eclipseCache: createEclipseCache() };
  let b = buildDiary(args);
  for (let i = 0; b.pending && i < 3; i++) {
    await b.pending;
    b = buildDiary(args);
  }
  return b;
}

test('eclipses: the map and circumstances, the Saros index, the Helion in detail, a blank canvas', async () => {
  const b = await buildReal();
  const { plan, env } = b;
  assert.deepEqual(plan.eclipses.map((x) => x.ev.label), ['Total solar eclipse', 'Partial lunar eclipse'], 'Delta Trifracton holds 2026-08-12 and 2026-08-28');
  checkBook(b, 'A5 with eclipses');
  const [sol, lun] = plan.eclipses;
  assert.ok(sol.geo && plan.world, 'the path data and the map are loaded');
  const p1 = renderPage(plan, plan.pages[sol.page - 1], env);
  const t1 = textOf(p1);
  assert.ok(t1.includes('● Total solar eclipse'));
  assert.ok(t1.some((x) => x.startsWith('Saros 126 · 48 of 72')));
  for (const k of ['Where', 'Totality', 'Path width', 'P1 Partial eclipse begins', 'U4 Total eclipse ends', 'AT MOSCOW', 'SAROS 126']) assert.ok(t1.includes(k), k);
  assert.ok(p1.length > 20000, 'the map is drawn');
  const t2 = textOf(renderPage(plan, plan.pages[sol.page], env));
  assert.ok(t2.some((x) => x.startsWith('Saros 126')));
  assert.equal(t2.filter((x) => /^\d+$/.test(x)).filter((x) => Number(x) >= 1 && Number(x) <= 72).length >= 72, true, 'every member numbered');
  const t3 = textOf(renderPage(plan, plan.pages[sol.page + 1], env));
  assert.ok(t3.some((x) => x.startsWith('max · Greatest eclipse · ')));
  assert.ok(t3.some((x) => x.startsWith('↑ before this Helion · P1')), 'a contact before the Helion is listed at its top');
  for (let k = 0; k < 36; k++) assert.ok(t3.some((x) => x.startsWith(`${k}ι `)), `${k}ι`);
  const l1 = textOf(renderPage(plan, plan.pages[lun.page - 1], env));
  for (const k of ['Umbral magnitude', 'U1 Partial eclipse begins', 'SAROS 138']) assert.ok(l1.includes(k), k);
  assert.equal(plan.pages[sol.page + 2].sections[0].canvas.type, 'blank');
  // pure mode: no hard leaks on the eclipse pages
  const p = await buildReal({ pureMode: true });
  const hits = [];
  for (const x of p.plan.eclipses) {
    for (const no of x.pages) {
      for (const str of textOf(renderPage(p.plan, p.plan.pages[no - 1], p.env))) for (const [id, re, sev] of RULES) if (sev === 'hard' && re.test(str)) hits.push(`p${no} ${id}: ${str}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('pure mode: no Gregorian text anywhere, every word passes the leak rules (0 hard hits)', () => {
  for (const o of [{}, { front: { cover: true, planning: 2, predictions: 2 }, closing: { summaryPages: 1 }, page: { size: 'A6' } }]) {
    const p = build(o, { pureMode: true, zone: 'Asia/Kolkata' });
    assert.equal(p.opts.gregorian.on, false);
    const hits = [];
    for (const page of p.plan.pages) {
      const all = [...textOf(renderPage(p.plan, page, p.env)), pageTitle(p.plan, page)];
      for (const s of all) for (const [id, re, sev] of RULES) if (sev === 'hard' && re.test(s)) hits.push(`p${page.no} ${id}: ${s}`);
    }
    assert.deepEqual(hits, []);
    const html = printDocument(p.plan, p.env, { title: 'Delta Trifracton' });
    assert.ok(!/Gregorian|UTC|\d\d:\d\d/.test(html.replace(/<style>[\s\S]*?<\/style>/, '')));
  }
});

test('pageTitle: short labels in Fractonica terms', () => {
  const { plan } = base;
  const titles = plan.pages.map((p) => pageTitle(plan, p));
  const lined = plan.pages.find((p) => p.kind === 'lined');
  assert.equal(pageTitle(plan, lined), `${lined.no} · ε#1 lock 1 pentad 1 · 1η–3η`);
  assert.equal(pageTitle(plan, plan.pages[lined.no]), `${lined.no + 1} · ε#1 lock 1 pentad 1 · 4η–5η · canvas`);
  assert.ok(titles.includes(`${lined.no + 6} · ε#1 lock 1 semi-pentad · 16η–17η · canvas`), 'the Semi-pentad: all canvases');
  assert.ok(titles.includes(`${plan.nuclides[0].retroPage} · ε#1 retrospection · 77η`));
  assert.equal(pageTitle(plan, plan.pages[0]), '1 · Index 1/2');
  assert.ok(titles.every((t) => t.length < 70));
});

test('printDocument two-up: two A5 pages side by side on A4 landscape, as spreads or in sequence', () => {
  const sp = build({ print: { twoUp: true } });
  const n = sp.plan.pages.length;
  const html = printDocument(sp.plan, sp.env, { title: 'two-up' });
  assert.ok(html.includes('@page{size:297mm 210mm;margin:0}'), 'A4 landscape');
  const sheets = html.split('<section class="sheet">').slice(1);
  assert.equal(sheets.length, Math.ceil((n + 1) / 2), 'spreads: [· | 1], [2 | 3] … [n | ·]');
  const cells = (sh) => [...sh.matchAll(/<div class="cell">(<svg[\s\S]*?<\/svg>)?<\/div>/g)].map((m) => m[1] ?? null);
  assert.deepEqual(cells(sheets[0]).map((c) => c === null), [true, false], 'page 1 alone on the right');
  assert.ok(cells(sheets[1])[0] && cells(sheets[1])[1], 'a full spread');
  assert.ok(cells(sheets.at(-1))[1] === null, 'the last verso alone on the left');
  assert.ok(html.includes('.cell{width:148.5mm') && html.includes('.sheet svg{display:block;flex:none;width:148mm;height:210mm}'), 'each page 1:1, centred in its half');
  assert.ok(html.includes('class="fold top"'));
  // a print dialog rounds the page to device pixels: a sheet exactly as tall as the paper spills over into a blank page
  assert.ok(html.includes('height:calc(210mm - 1mm);margin-top:0.5mm'), 'each sheet a hair shorter than the paper, centred');
  assert.equal((html.match(/<svg /g) ?? []).length, n);
  const sq = build({ print: { twoUp: true, pairing: 'sequential' } });
  const sh2 = printDocument(sq.plan, sq.env).split('<section class="sheet">').slice(1);
  assert.equal(sh2.length, Math.ceil(sq.plan.pages.length / 2));
  assert.ok(cells(sh2[0])[0] && cells(sh2[0])[1], '[1 | 2]');
  const first = renderPage(sq.plan, sq.plan.pages[0], sq.env);
  assert.ok(sh2[0].includes(first), 'page 1 first');
});

test('printDocument double-sided: cut and stack, fronts on the odd PDF pages, backs behind them', () => {
  const b = build({ print: { twoUp: true, pairing: 'duplex' } });
  const { plan, env } = b;
  const n = plan.pages.length;
  const S = Math.ceil(n / 4);
  const sides = sheetsOf(plan);
  assert.equal(sides.length, 2 * S);
  const no = (p) => (p ? p.no : null);
  // sheet i: leaf i on the left, leaf S + i on the right; the back mirrors the halves
  sides.forEach((s, k) => {
    const i = k >> 1;
    const a = 2 * i + 1;
    const c = 2 * (S + i) + 1;
    if (k % 2 === 0) assert.deepEqual(s.map(no), [a, c <= n ? c : null], `front of sheet ${i + 1}`);
    else {
      assert.deepEqual(s.map(no), [c + 1 <= n ? c + 1 : null, a + 1], `back of sheet ${i + 1}`);
      assert.ok(s.back && !s.turned);
    }
  });
  // cut and stack: the left halves, then the right halves, give every page once and in order
  const left = [];
  const right = [];
  for (let k = 0; k < sides.length; k += 2) {
    left.push(no(sides[k][0]), no(sides[k + 1][1]));
    right.push(no(sides[k][1]), no(sides[k + 1][0]));
  }
  assert.deepEqual([...left, ...right].filter((x) => x !== null), plan.pages.map((p) => p.no));
  const html = printDocument(plan, env);
  assert.equal(html.split('<section class="sheet').length - 1, 2 * S);
  assert.equal((html.match(/<svg /g) ?? []).length, n, 'every page printed once');
  assert.ok(!html.includes('class="sheet turned"'));
  // turned top over bottom: the backs print upside down
  const t = build({ print: { twoUp: true, pairing: 'duplex', turn: 'top' } });
  const th = printDocument(t.plan, t.env);
  assert.equal((th.match(/<section class="sheet turned">/g) ?? []).length, S);
  assert.ok(th.includes('.sheet.turned .cell{transform:rotate(180deg)}'));
  // an odd number of leaves leaves the last right half blank
  assert.deepEqual(duplexSheets([1, 2, 3, 4, 5, 6].map((no) => ({ no }))).map((s) => s.map(no)), [[1, 5], [6, 2], [3, null], [null, 4]]);
});

test('printDocument: a complete, self-contained print document, one sheet side per page', () => {
  const { plan, env } = base;
  const html = printDocument(plan, env, { title: 'Delta <Trifracton>' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes('<title>Delta &lt;Trifracton&gt;</title>'));
  assert.ok(html.includes('@page{size:148mm 210mm;margin:0}'));
  assert.ok(html.includes('break-after:page'));
  assert.equal((html.match(/<section class="sheet">/g) ?? []).length, plan.pages.length);
  assert.equal((html.match(/<svg /g) ?? []).length, plan.pages.length);
  assert.ok(!/<link|<script|src=|@import|https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(html), 'no external resources');
});

test('text fitting and line labels', () => {
  assert.ok(measure('δ#3 ε#2 33η', 2) > measure('δ#3', 2));
  const f = fit('Delta Trifracton · Peak ends → Node', 20, 2, { min: 1.6 });
  assert.ok(f.width <= 20 && f.text.endsWith('…') && f.size === 1.6);
  assert.equal(fit('33η', 20, 2).text, '33η');
  assert.deepEqual(wrap('Post-ascending', 8, 1.6), ['Post-', 'ascending']);
  assert.deepEqual(wrap('Full Moon', 7.4, 1.6), ['Full Moon'], 'a little smaller rather than broken');
  assert.equal(wrap('Sync 4807', 6, 1.6, { maxLines: 1 }).length, 1);
  assert.equal(lineLabel(0, 12), '0ι');
  assert.equal(lineLabel(11, 12), '33ι');
  assert.equal(lineLabel(1, 5), '7ι 13λ', 'not a whole Preon: counts of completed units');
  assert.equal(lineLabel(1, 7), '5ι 9λ');
  assert.equal(labelStep(12, 4.6), 1);
  assert.equal(labelStep(24, 2.4), 2, 'whole Preons: 0ι 3ι 6ι …');
  assert.equal(labelStep(108, 0.7), 6, 'every 3rd line starts a whole Preon');
});

test('performance: the whole book in well under a second', () => {
  // CPU time, not wall time: the budget is the renderer's own work, whatever else the machine is doing
  const cpu = (f) => {
    const a = process.cpuUsage();
    f();
    const b = process.cpuUsage(a);
    return (b.user + b.system) / 1000;
  };
  const b = build();
  const all = cpu(() => {
    for (const p of b.plan.pages) renderPage(b.plan, p, b.env);
  });
  const page = b.plan.pages.find((p) => p.kind === 'lined');
  const one = cpu(() => {
    for (let i = 0; i < 20; i++) renderPage(b.plan, page, b.env);
  }) / 20;
  assert.ok(all < 1000, `all ${b.plan.pages.length} pages ${all.toFixed(0)} ms of CPU`);
  assert.ok(one < 10, `one lined page ${one.toFixed(2)} ms of CPU`);
});
