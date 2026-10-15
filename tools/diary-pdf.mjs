#!/usr/bin/env node
/**
 * Command-line PDF export of the diary of one Delta (docs/design/90-diary.md, "Command line").
 *
 *   node tools/diary-pdf.mjs [--t <unix|ISO> | --delta <index> | --path 6,4,9,3] [--options file.json]
 *                            [--zone Area/City] [--pure] [--two-up] [--pairing spreads|sequential|duplex] [--turn side|top]
 *                            [--out diary.pdf]
 *   npm run diary -- --path 6,4,9,3 --out delta-trifracton.pdf
 *
 * Serves the repo (tools/browse.mjs), opens tools/diary-print.html in headless Chromium, which plans the diary with the
 * app's own modules (src/ui/diary/build.js, the same builder as the Diary tab) and returns printDocument(); the
 * document is then printed with page.pdf({preferCSSPageSize: true, printBackground: true}): a vector PDF at the paper
 * size of the options (paperSize): one diary page per PDF page, or two side by side with --two-up. The PDF is checked
 * afterwards: its page count (printSheets: pages, ceil((pages + 1) / 2) for facing pages, ceil(pages / 2) in order, both
 * sides of ceil(pages / 4) sheets double-sided) and size.
 *
 *   --t        a moment (Unix seconds or an ISO date): the Delta that holds it (default: now)
 *   --delta    a global Delta index (0 … last Delta of the catalogue)
 *   --path     the ordinals α,β,γ,δ (1-based), e.g. 6,4,9,3 or "α#6 β#4 γ#9 δ#3"
 *   --options  a JSON file of diary options (the Diary tab's "Copy options" gives one); missing keys = defaults
 *   --zone     the zone of the Gregorian references (default: the options' zone, else this computer's zone)
 *   --pure     pure mode: Fractonica terms only, no Gregorian references
 *   --two-up   two diary pages per sheet of paper (two A5 pages on A4 landscape)
 *   --pairing  with two-up: 'spreads' (facing pages as an open book: –|1, 2|3 …, the default), 'sequential' (1|2, 3|4 …)
 *              or 'duplex' (double-sided cut and stack: print the odd PDF pages, reinsert, print the even ones; cut the
 *              sheets in half, left halves on the right halves); implies --two-up
 *   --turn     with duplex: how the stack goes back in, 'side' (flip on the short edge, the default) or 'top' (long edge)
 *   --out      the PDF to write (default diary.pdf)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printSheets } from '../src/ui/diary/logic.js';

const USAGE = `usage: node tools/diary-pdf.mjs [--t <unix|ISO> | --delta <index> | --path 6,4,9,3] [--options file.json] [--zone Area/City] [--pure] [--two-up] [--pairing spreads|sequential|duplex] [--turn side|top] [--out diary.pdf]`;

const validZone = (z) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

/** Parse the command line (without node and the script). Throws an Error with a readable message on bad input. */
export function parseArgs(argv) {
  const out = { t: null, delta: null, path: null, options: null, zone: null, pure: false, twoUp: false, pairing: null, turn: null, out: 'diary.pdf', help: false };
  const args = [];
  for (const a of argv) {
    const m = /^(--[a-z]+)=(.*)$/s.exec(a);
    if (m) args.push(m[1], m[2]);
    else args.push(a);
  }
  const value = (i, name) => {
    const v = args[i + 1];
    if (v === undefined || (v.startsWith('--') && !/^--?\d/.test(v))) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '-h':
      case '--help':
        out.help = true;
        break;
      case '--pure':
        out.pure = true;
        break;
      case '--two-up':
        out.twoUp = true;
        break;
      case '--pairing': {
        const v = value(i++, '--pairing');
        if (!['spreads', 'sequential', 'duplex'].includes(v)) throw new Error(`--pairing: "${v}" is not spreads, sequential or duplex`);
        out.pairing = v;
        out.twoUp = true;
        break;
      }
      case '--turn': {
        const v = value(i++, '--turn');
        if (!['side', 'top'].includes(v)) throw new Error(`--turn: "${v}" is neither side nor top`);
        out.turn = v;
        break;
      }
      case '--t': {
        const v = value(i++, '--t');
        const n = /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : Date.parse(v) / 1000;
        if (!Number.isFinite(n)) throw new Error(`--t: "${v}" is neither Unix seconds nor a date`);
        out.t = n;
        break;
      }
      case '--delta': {
        const v = value(i++, '--delta');
        if (!/^\d+$/.test(v.trim())) throw new Error(`--delta: "${v}" is not a Delta index (0, 1, 2 …)`);
        out.delta = Number(v);
        break;
      }
      case '--path': {
        const v = value(i++, '--path');
        const nums = (v.includes('#') ? [...v.matchAll(/#(\d+)/g)].map((x) => x[1]) : v.split(/[\s,./]+/).filter(Boolean)).map(Number);
        if (nums.length !== 4 || !nums.every((x) => Number.isInteger(x) && x >= 1)) throw new Error(`--path: "${v}" is not four ordinals α,β,γ,δ such as 6,4,9,3`);
        out.path = nums;
        break;
      }
      case '--options':
        out.options = value(i++, '--options');
        break;
      case '--zone': {
        const v = value(i++, '--zone');
        if (!validZone(v)) throw new Error(`--zone: "${v}" is not a time zone (Area/City, e.g. Europe/Berlin)`);
        out.zone = v;
        break;
      }
      case '--out':
        out.out = value(i++, '--out');
        break;
      default:
        throw new Error(`unknown argument "${a}"`);
    }
  }
  if ([out.t, out.delta, out.path].filter((x) => x !== null).length > 1) throw new Error('give only one of --t, --delta, --path');
  return out;
}

/** Pages of a PDF file (counts the page objects). */
export function pdfPageCount(buf) {
  const s = buf.toString('latin1');
  return (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}
/** The page sizes of a PDF in millimetres: distinct MediaBoxes as [[w, h], …]. */
export function pdfPageSizes(buf) {
  const s = buf.toString('latin1');
  const out = new Map();
  for (const m of s.matchAll(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g)) {
    const w = ((+m[3] - +m[1]) * 25.4) / 72;
    const h = ((+m[4] - +m[2]) * 25.4) / 72;
    out.set(`${w.toFixed(1)}x${h.toFixed(1)}`, [w, h]);
  }
  return [...out.values()];
}
/** Do the PDF pages have the size of the paper (Chromium rounds to its device pixels: allow 0.5 mm)? */
export const sameSize = (sizes, { width, height }) => sizes.length === 1 && Math.abs(sizes[0][0] - width) < 0.5 && Math.abs(sizes[0][1] - height) < 0.5;

async function main() {
  let a;
  try {
    a = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`diary-pdf: ${err.message}\n${USAGE}`);
    process.exit(2);
  }
  if (a.help) {
    console.log(USAGE);
    process.exit(0);
  }
  let options = {};
  if (a.options) {
    try {
      options = JSON.parse(fs.readFileSync(a.options, 'utf8'));
    } catch (err) {
      console.error(`diary-pdf: cannot read the options "${a.options}": ${err.message}`);
      process.exit(2);
    }
  }
  const outFile = path.resolve(a.out);
  const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const t0 = Date.now();
  const { withApp } = await import('./browse.mjs');
  let failed = false;
  await withApp(
    async ({ page, port, errors }) => {
      await page.goto(`http://127.0.0.1:${port}/tools/diary-print.html`);
      await page.waitForFunction(() => window.diaryReady === true, null, { timeout: 30000 });
      let doc;
      try {
        const input = a.twoUp ? { ...options, print: { ...(options.print ?? {}), twoUp: true, ...(a.pairing ? { pairing: a.pairing } : {}), ...(a.turn ? { turn: a.turn } : {}) } } : options;
        doc = await page.evaluate((args) => window.diaryBuild(args), { t: a.t, delta: a.delta, path: a.path, options: input, zone: a.zone, appZone: systemZone, pure: a.pure });
      } catch (err) {
        console.error(`diary-pdf: ${String(err.message).split('\n')[0].replace(/^.*?Error: /, '')}`);
        failed = true;
        return;
      }
      await page.setContent(doc.html, { waitUntil: 'load', timeout: 180000 });
      await page.evaluate(() => document.fonts?.ready);
      await page.pdf({ path: outFile, preferCSSPageSize: true, printBackground: true, timeout: 300000 });
      const buf = fs.readFileSync(outFile);
      const n = pdfPageCount(buf);
      const want = printSheets(doc.pages, doc.print);
      const sizes = pdfPageSizes(buf);
      const mb = (buf.length / 1048576).toFixed(1);
      const shown = path.relative(process.cwd(), outFile);
      const size = sizes.length === 1 ? `${Math.round(sizes[0][0])} × ${Math.round(sizes[0][1])} mm` : sizes.length ? 'mixed sizes' : '?';
      const how = doc.print.twoUp ? `, two per sheet (${doc.print.pairing})` : '';
      console.log(`wrote ${shown.startsWith('..') ? outFile : shown}: ${doc.title} · ${doc.pages} diary pages${how} · PDF ${n} pages of ${size}${a.pure ? ' · pure' : ` · ${doc.zone}`} · ${mb} MB · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      if (n !== want) {
        console.error(`diary-pdf: the PDF has ${n} pages, expected ${want}${doc.print.twoUp ? ` (${doc.pages} diary pages, two per sheet, ${doc.print.pairing})` : ''}`);
        failed = true;
      }
      if (sizes.length && !sameSize(sizes, doc.paper)) {
        console.error(`diary-pdf: the PDF pages are ${sizes.map(([w, h]) => `${w.toFixed(1)} × ${h.toFixed(1)}`).join(', ')} mm, expected ${doc.paper.width} × ${doc.paper.height} mm`);
        failed = true;
      }
      if (errors.length) {
        console.error('diary-pdf: page errors:\n  ' + errors.slice(0, 8).join('\n  '));
        failed = true;
      }
    },
    { viewport: { width: 1000, height: 800 } },
  );
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
