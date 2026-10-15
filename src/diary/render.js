/**
 * Page renderers of the diary (docs/design/90-diary.md, "Pages").
 *
 * renderPage(plan, page, env) -> SVG markup of one page: viewBox "0 0 W H" in millimetres, width="Wmm" height="Hmm";
 *                                vector only (rules, the library's glyph paths, <text>), white paper, print colours
 * printDocument(plan, env, {title}) -> a complete HTML document, embedded CSS only; "Save as PDF" (or headless Chromium
 *                                page.pdf()) gives the PDF. One page per sheet (@page {size: Wmm Hmm; margin: 0}), or
 *                                with opts.print.twoUp two pages per sheet of paperSize(opts) (A5 pages on A4 landscape),
 *                                paired as spreads or in sequence (sheetsOf)
 * pageTitle(plan, page) -> a short label for navigation ("11 · ε#1 lock 1 · 1η–3η"), Fractonica terms only
 *   env = { model, pure, F, fmt, pureMode }   fmt = createFormatter(() => plan.zone) (src/core/format.js)
 *
 * The page kinds live in ./render/: helion.js (lined and canvas pages: sections, ruled lines, canvases, the time margin),
 * front.js (cover, index, Gregorian index, ephemeris, planning, predictions), reference.js (period ladder, milestones),
 * book.js (Nuclide header, Delta insert,
 * summary, notes), chrome.js (running head, folio), words.js (what is said, in both modes), common.js (SVG, type, colour).
 */
import { Svg, frameOf, esc, n2 } from './render/common.js';
import { paperSize } from './options.js';
import { contextOf, majorWords } from './render/words.js';
import { drawHead, drawFolio, drawNav, sectionTitle } from './render/chrome.js';
import { renderLinedBody, renderCanvasBody } from './render/helion.js';
import { renderCover, renderIndex, renderGregorian, renderEphemeris, renderPlanning } from './render/front.js';
import { renderNuclide, renderInsert, renderSummary, renderNotes } from './render/book.js';
import { renderLadder, renderMilestones } from './render/reference.js';
import { renderEclipse, renderSaros, renderEclipseHelion } from './render/eclipse.js';

const BODY = {
  cover: renderCover,
  index: renderIndex,
  gregorian: renderGregorian,
  ephemeris: renderEphemeris,
  eclipse: renderEclipse,
  saros: renderSaros,
  'eclipse-helion': renderEclipseHelion,
  ladder: renderLadder,
  milestones: renderMilestones,
  planning: renderPlanning,
  predictions: renderPlanning,
  nuclide: renderNuclide,
  lined: renderLinedBody,
  canvas: renderCanvasBody,
  insert: renderInsert,
  summary: renderSummary,
  notes: renderNotes,
};

export function renderPage(plan, page, env) {
  const cx = contextOf(plan, env);
  const fr = frameOf(plan.opts, page);
  const svg = new Svg(fr.W, fr.H, { font: cx.font, F: cx.F });
  (BODY[page.kind] ?? renderNotes)(svg, cx, fr, page);
  drawHead(svg, cx, fr, page);
  drawFolio(svg, cx, fr, page);
  drawNav(svg, cx, fr, page);
  return svg.toString();
}

const partOf = (p) => (p.of > 1 ? ` ${p.part}/${p.of}` : '');

export function pageTitle(plan, page) {
  const no = `${page.no} · `;
  const H = plan.helions;
  const range = (ds) => {
    const a = H[ds[0]].num;
    const b = H[ds.at(-1)].num;
    return a === b ? `${a}η` : `${a}η–${b}η`;
  };
  const nu = (n) => `ε#${n + 1}`;
  switch (page.kind) {
    case 'cover':
      return `${no}Cover`;
    case 'lined':
    case 'canvas': {
      const ds = page.sections.map((s) => s.d);
      const what = page.kind === 'canvas' ? ' · canvas' : '';
      if (page.eclipse !== undefined) return `${no}${nu(page.nuclide)} eclipse · ${range(ds)}${what}`;
      if (page.retro) return `${no}${nu(page.nuclide)} retrospection · ${range(ds)}${what}`;
      const unit = page.unit === 'pentad' ? ` pentad ${page.unitNo}` : page.unit === 'semi' ? ' semi-pentad' : '';
      return `${no}${nu(page.nuclide)} lock ${page.lock + 1}${unit} · ${range(ds)}${what}`;
    }
    case 'nuclide':
      return `${no}Nuclide ${nu(page.n)}`;
    case 'insert':
      return `${no}Delta sheet · ${majorWords(page.major)}`;
    case 'eclipse':
      return `${no}${plan.eclipses?.[page.eclipse]?.ev.label ?? 'Eclipse'}`;
    case 'saros': {
      const s = plan.eclipses?.[page.eclipse]?.saros;
      return `${no}Saros ${s?.saros ?? ''}`.trim();
    }
    case 'eclipse-helion':
      return `${no}${nu(page.nuclide)} eclipse · ${range([page.helion])}`;
    case 'notes':
      return `${no}Notes`;
    default:
      return `${no}${sectionTitle(page.kind)}${partOf(page)}`;
  }
}

/**
 * Sheets of paper: one page each, or with `opts.print.twoUp` two pages side by side on paper twice as wide
 * (paperSize: two A5 pages make A4 landscape), each page centred 1:1 in its half. Pairing 'spreads' prints facing
 * pages as an open book ([· | 1], [2 | 3] … [n | ·]); 'sequential' prints [1 | 2], [3 | 4] …; 'duplex' prints both sides
 * of the sheets for cut and stack (duplexSheets). A sheet side is an array [left, right] (null = blank half); a back side
 * carries `back: true`, and `turned: true` when it prints upside down.
 */
export function sheetsOf(plan) {
  const n = plan.pages.length;
  const print = plan.opts.print ?? {};
  if (!print.twoUp) return plan.pages.map((p) => [p]);
  if (print.pairing === 'duplex') return duplexSheets(plan.pages, print.turn);
  const out = [];
  if (print.pairing === 'sequential') {
    for (let i = 0; i < n; i += 2) out.push([plan.pages[i], plan.pages[i + 1] ?? null]);
  } else {
    out.push([null, plan.pages[0] ?? null]);
    for (let i = 1; i < n; i += 2) out.push([plan.pages[i], plan.pages[i + 1] ?? null]);
  }
  return out;
}

/**
 * Double-sided cut and stack. The diary's L leaves (page 2k+1 on the front of leaf k, page 2k+2 on its back) go on
 * S = ceil(L / 2) sheets: sheet i carries leaf i on its left half and leaf S + i on its right half. The PDF alternates
 * front and back of each sheet, so printing the odd PDF pages, putting the stack back in and printing the even pages
 * makes the sheets; cut through the middle, and the left halves (leaves 1 … S) laid on the right halves (S + 1 … L) are
 * the book in order. Turned over sideways, the back of the left half is on the right: a back is [back of S + i | back
 * of i]; `turn` 'top' (turned top over bottom) prints that upside down.
 */
export function duplexSheets(pages, turn = 'side') {
  const leaves = Math.ceil(pages.length / 2);
  const S = Math.ceil(leaves / 2);
  const at = (i) => pages[i] ?? null;
  const out = [];
  for (let i = 0; i < S; i++) {
    const a = i;
    const b = S + i;
    out.push([at(2 * a), b < leaves ? at(2 * b) : null]);
    out.push(Object.assign([b < leaves ? at(2 * b + 1) : null, at(2 * a + 1)], { back: true, turned: turn === 'top' }));
  }
  return out;
}

export function printDocument(plan, env, { title = 'Diary' } = {}) {
  const { width: W, height: H } = plan.opts.page;
  const paper = paperSize(plan.opts);
  const pw = `${n2(paper.width)}mm`;
  const ph = `${n2(paper.height)}mm`;
  const w = `${n2(W)}mm`;
  const h = `${n2(H)}mm`;
  const cell = (p) => `<div class="cell">${p ? renderPage(plan, p, env) : ''}</div>`;
  const body = paper.twoUp
    ? sheetsOf(plan)
        .map((s) => `<section class="sheet${s.turned ? ' turned' : ''}">${cell(s[0])}${cell(s[1])}<i class="fold top"></i><i class="fold bottom"></i></section>`)
        .join('\n')
    : plan.pages.map((p) => `<section class="sheet">${renderPage(plan, p, env)}</section>`).join('\n');
  const css =
    `@page{size:${pw} ${ph};margin:0}` +
    `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}` +
    `body{-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    // a sheet is 1 mm shorter than the paper and centred on it (0.5 mm above and below): exactly the paper's height, a
    // print dialog rounds the page to device pixels, the last fraction of a pixel spills over and every sheet is
    // followed by a blank page. Only the paper's white edge is clipped.
    `.sheet{position:relative;width:${pw};height:calc(${ph} - 1mm);margin-top:0.5mm;overflow:hidden;display:flex;align-items:center;justify-content:center;break-after:page;page-break-after:always;break-inside:avoid}` +
    `.sheet:last-child{break-after:auto;page-break-after:auto}` +
    `.sheet svg{display:block;flex:none;width:${w};height:${h}}` +
    (paper.twoUp
      ? `.cell{width:${n2(paper.cell)}mm;height:100%;flex:none;display:flex;align-items:center;justify-content:center}` +
        `.fold{position:absolute;left:50%;width:0;height:4mm;border-left:0.1mm solid #c5cbd1}.fold.top{top:0}.fold.bottom{bottom:0}` +
        // a back printed upside down: the halves change sides and each turns half a circle (the whole sheet rotated)
        `.sheet.turned{flex-direction:row-reverse}.sheet.turned .cell{transform:rotate(180deg)}`
      : '') +
    `@media screen{body{background:#7d848b;padding:8mm 0}.sheet{height:${ph};margin:0 auto 8mm;box-shadow:0 1mm 4mm rgba(0,0,0,.35);background:#fff}}`;
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body>\n${body}\n</body></html>\n`;
}
