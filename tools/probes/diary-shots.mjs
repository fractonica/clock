// Visual QA of the diary pages (src/diary/render.js): renders pages to PNG at several sizes and options, and checks in
// headless Chromium that no text overlaps other text or leaves the paper, and how the text measure compares with the
// real fonts.
//   node tools/probes/diary-shots.mjs [set …]      sets: a5 a6 a4 pure dense mono l24 l6 locks canvases all (default a5)
//   PNGs: tools/out/diary-<set>-p<no>-<kind>.png
import '../../fractonica.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withApp, outDir } from '../browse.mjs';
import { createModel } from '../../src/core/model.js';
import { createPure } from '../../src/core/pure.js';
import { createFormatter } from '../../src/core/format.js';
import { sanitizeDiaryOptions } from '../../src/diary/options.js';
import { planDiary, deltaAt } from '../../src/diary/plan.js';
import { renderPage, printDocument } from '../../src/diary/render.js';
import { measure } from '../../src/diary/render/common.js';
import * as astro from '../../src/diary/astro/index.js';

globalThis.Path2D ??= class {};
const model = createModel();
const pure = createPure(model);
const A = 1791460800; // SPEC vector A
const DAY = 86400;

/** Mean-motion lunar and solar events: realistic density while the real engine is not there. */
export function syntheticEvents(t0, t1) {
  const out = [];
  const series = (family, ref, period, names, labels, pures = labels) => {
    for (let k = Math.floor((t0 - ref) / period) - 1; ref + k * period <= t1; k++) {
      names.forEach((name, i) => {
        const t = ref + (k + i / names.length) * period;
        if (t >= t0 && t < t1) out.push({ t, family, name, label: labels[i], labelPure: pures[i] });
      });
    }
  };
  series('synodic', 947182440, 29.530589 * DAY, ['new-moon', 'first-quarter', 'full-moon', 'last-quarter'], ['New moon', 'First quarter', 'Full moon', 'Last quarter']);
  series('anomalistic', 948326400, 27.55455 * DAY, ['perigee', 'post-perigee', 'apogee', 'post-apogee'], ['Perigee', 'Post-perigee', 'Apogee', 'Post-apogee']);
  series('draconic', 946700000, 27.212221 * DAY, ['ascending-node', 'post-ascending', 'descending-node', 'post-descending'], ['Ascending node', 'Post-ascending', 'Descending node', 'Post-descending']);
  series('sidereal', 946900000, 27.321662 * DAY, ['sidereal-0', 'sidereal-90', 'sidereal-180', 'sidereal-270'], ['Sidereal 0°', 'Sidereal 90°', 'Sidereal 180°', 'Sidereal 270°']);
  series('solar', 953537700, 365.2422 * DAY, ['march-equinox', 'june-solstice', 'september-equinox', 'december-solstice'], ['March equinox', 'June solstice', 'September equinox', 'December solstice'], ['Northward equinox', 'Northern solstice', 'Southward equinox', 'Southern solstice']);
  series('solar', 946876680, 365.2596 * DAY, ['perihelion', 'aphelion'], ['Perihelion', 'Aphelion']);
  return out.sort((a, b) => a.t - b.t);
}

const SETS = {
  a5: { opts: {} },
  a6: { opts: { page: { size: 'A6' } } },
  a4: { opts: { page: { size: 'A4' } } },
  pure: { opts: {}, pureMode: true },
  dense: { opts: { page: { size: 'A6' }, lined: { linesPerHelion: 36 }, lock: { sheets: [[4, 4], [4, 4], [3, 0]] } } },
  mono: { opts: { style: { ink: 'mono', font: 'serif' }, front: { cover: true } } },
  l24: { opts: { lined: { linesPerHelion: 24 } } },
  l6: { opts: { lined: { linesPerHelion: 6, labels: 'preon' } } },
  locks: { opts: { lock: { sheets: [[3, 2]] }, front: { cover: true, planning: 2, predictions: 2 }, closing: { summaryPages: 1 } } },
  twoup: { opts: { print: { twoUp: true }, front: { cover: true } } },
  canvases: { opts: { canvases: [{ type: 'dot-grid', cols: 24, rows: 12 }, { type: 'lined', lines: 20 }, { type: 'blank' }], retro: { canvases: [{ type: 'dots', count: 900 }, { type: 'grid', cols: 40, rows: 30 }] } } },
};

function build(name) {
  const s = SETS[name];
  const opts = sanitizeDiaryOptions(s.opts, { pure: !!s.pureMode });
  const delta = deltaAt(model, s.t ?? A);
  const D = model.cycleByIndex(3, delta);
  let events = astro.events(D.start, D.end, opts.events);
  if (!events.length) events = syntheticEvents(D.start, D.end);
  const plan = planDiary({ model, pure, opts, delta, zone: 'Europe/Berlin', events });
  const env = { model, pure, F: globalThis.Fractonica, fmt: createFormatter(() => plan.zone), pureMode: !!s.pureMode };
  return { plan, env };
}

/** The pages worth looking at: one of each kind, the retro pages, an insert and the busiest lined page. */
function pick(plan) {
  const out = new Set();
  const first = (k, f = () => true) => plan.pages.find((p) => p.kind === k && f(p));
  for (const k of ['cover', 'index', 'gregorian', 'ephemeris', 'ladder', 'milestones', 'planning', 'predictions', 'nuclide', 'insert', 'summary']) {
    const p = first(k);
    if (p) out.add(p.no);
  }
  const last = (k) => plan.pages.filter((p) => p.kind === k).at(-1);
  for (const k of ['index', 'ephemeris']) if (last(k)) out.add(last(k).no);
  const busy = plan.pages
    .filter((p) => p.kind === 'lined' && !p.retro)
    .map((p) => [p, p.sections.reduce((s, x) => s + plan.helions[x.d].events.length, 0)])
    .sort((a, b) => b[1] - a[1])[0];
  if (busy) {
    out.add(busy[0].no);
    out.add(busy[0].no + 1);
  }
  const lined = first('lined', (p) => !p.retro);
  if (lined) out.add(lined.no + 1);
  const retro = first('lined', (p) => p.retro);
  if (retro) [0, 1, 2].forEach((i) => out.add(retro.no + i));
  return [...out].filter((n) => n <= plan.pages.length).sort((a, b) => a - b);
}

async function run(name, { shots = true, all = true } = {}) {
  const { plan, env } = build(name);
  const t0 = performance.now();
  const html = printDocument(plan, env, { title: `Diary ${name}` });
  const ms = performance.now() - t0;
  const W = plan.opts.page.width;
  const want = new Set(pick(plan));
  await withApp(
    async ({ page, port }) => {
      await page.goto(`http://127.0.0.1:${port}/package.json`);
      await page.setContent(html);
      await page.evaluate(() => document.fonts.ready);
      const report = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('section.sheet svg').forEach((svg, i) => {
          const [, , W, H] = svg.getAttribute('viewBox').split(' ').map(Number);
          const texts = [...svg.querySelectorAll('text')].map((t) => {
            const b = t.getBBox();
            const first = t.querySelector('tspan') ?? t;
            return { s: t.textContent, x: b.x, y: b.y, w: b.width, h: b.height, size: Number(first.getAttribute('font-size') ?? t.getAttribute('font-size')), weight: Number(t.getAttribute('font-weight') ?? 400), ls: Number(t.getAttribute('letter-spacing') ?? 0), spans: t.querySelectorAll('tspan').length, len: t.getComputedTextLength() };
          });
          const issues = [];
          for (const t of texts) if (t.x < 0.3 || t.y < 0.3 || t.x + t.w > W - 0.3 || t.y + t.h > H - 0.3) issues.push(`off-paper "${t.s}"`);
          // overlaps of the ink boxes (the bbox includes ascent/descent: shrink it vertically)
          const box = (t) => ({ x0: t.x + 0.05, x1: t.x + t.w - 0.05, y0: t.y + t.h * 0.22, y1: t.y + t.h * 0.86 });
          for (let a = 0; a < texts.length; a++) {
            for (let b = a + 1; b < texts.length; b++) {
              const p = box(texts[a]);
              const q = box(texts[b]);
              if (p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1) issues.push(`overlap "${texts[a].s}" × "${texts[b].s}"`);
            }
          }
          out.push({ no: i + 1, issues, texts: texts.filter((t) => !t.spans).map((t) => [t.s, t.size, t.weight, t.len, t.ls]) });
        });
        return out;
      });
      let bad = 0;
      let worst = 0;
      let worstText = '';
      const ratios = [];
      for (const p of report) {
        if (p.issues.length) {
          bad++;
          console.log(`  page ${p.no} (${plan.pages[p.no - 1].kind}):`, p.issues.slice(0, 6).join(' | '));
        }
        for (const [s, size, weight, len, ls] of p.texts) {
          if (!size || s.length < 3) continue;
          const est = measure(s, size, { weight, font: plan.opts.style.font }) + ls * [...s].length;
          const r = len / est;
          ratios.push(r);
          if (r > worst) {
            worst = r;
            worstText = s;
          }
        }
      }
      ratios.sort((a, b) => a - b);
      console.log(`${name}: ${plan.pages.length} pages, printDocument ${ms.toFixed(0)} ms, ${(html.length / 1e6).toFixed(2)} MB; pages with issues: ${bad}; real/estimated width: median ${ratios[ratios.length >> 1]?.toFixed(3)}, max ${worst.toFixed(3)} ("${worstText}")`);
      if (shots) {
        const scale = 3.2 * (148 / W) ** 0.5;
        await page.setViewportSize({ width: Math.ceil(W * scale * 1.05 + 40), height: 1200 });
        await page.addStyleTag({ content: 'body{background:#7d848b;padding:4mm 0}.sheet{margin:0 auto 4mm}' });
        if (plan.opts.print?.twoUp) {
          // whole sheets of paper: the first three and the one holding the first lined page
          await page.setViewportSize({ width: Math.ceil(2 * W * scale * 1.05 + 40), height: 1200 });
          const sheets = await page.$$('section.sheet');
          const lined = plan.pages.find((p) => p.kind === 'lined').no;
          for (const k of [0, 1, 2, Math.floor(lined / 2)]) {
            const file = path.join(outDir, `diary-${name}-sheet${k + 1}.png`);
            await sheets[k].screenshot({ path: file });
            console.log('  ' + path.relative(process.cwd(), file));
          }
        } else {
          const svgs = await page.$$('section.sheet > svg');
          for (const no of want) {
            const file = path.join(outDir, `diary-${name}-p${no}-${plan.pages[no - 1].kind}.png`);
            await svgs[no - 1].screenshot({ path: file });
            console.log('  ' + path.relative(process.cwd(), file));
          }
        }
      }
      if (all && process.env.DIARY_PDF) {
        const file = path.join(outDir, `diary-${name}.pdf`);
        await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
        console.log('  ' + file);
      }
    },
    { viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(outDir, { recursive: true });
  const args = process.argv.slice(2);
  const sets = !args.length ? ['a5'] : args.includes('all') ? Object.keys(SETS) : args;
  for (const s of sets) {
    if (!SETS[s]) throw new Error(`unknown set ${s}; one of ${Object.keys(SETS).join(' ')}`);
    await run(s, { shots: !process.env.NOSHOTS });
  }
}
