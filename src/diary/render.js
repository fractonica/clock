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
 * front.js (cover, index, Gregorian index, ephemeris, planning, predictions), book.js (Nuclide header, Delta insert,
 * summary, notes), chrome.js (running head, folio), words.js (what is said, in both modes), common.js (SVG, type, colour).
 */
import { Svg, frameOf, esc, n2 } from './render/common.js';
import { paperSize } from './options.js';
import { contextOf, majorWords } from './render/words.js';
import { drawHead, drawFolio, sectionTitle } from './render/chrome.js';
import { renderLinedBody, renderCanvasBody } from './render/helion.js';
import { renderCover, renderIndex, renderGregorian, renderEphemeris, renderPlanning } from './render/front.js';
import { renderNuclide, renderInsert, renderSummary, renderNotes } from './render/book.js';

const BODY = {
  cover: renderCover,
  index: renderIndex,
  gregorian: renderGregorian,
  ephemeris: renderEphemeris,
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
      if (page.retro) return `${no}${nu(page.nuclide)} retrospection · ${range(ds)}${what}`;
      return `${no}${nu(page.nuclide)} lock ${page.lock + 1} · ${range(ds)}${what}`;
    }
    case 'nuclide':
      return `${no}Nuclide ${nu(page.n)}`;
    case 'insert':
      return `${no}Delta sheet · ${majorWords(page.major)}`;
    case 'notes':
      return `${no}Notes`;
    default:
      return `${no}${sectionTitle(page.kind)}${partOf(page)}`;
  }
}

/**
 * Sheets of paper: one page each, or with `opts.print.twoUp` two pages side by side on paper twice as wide
 * (paperSize: two A5 pages make A4 landscape), each page centred 1:1 in its half. Pairing 'spreads' prints facing
 * pages as an open book ([· | 1], [2 | 3] … [n | ·]); 'sequential' prints [1 | 2], [3 | 4] ….
 */
export function sheetsOf(plan) {
  const n = plan.pages.length;
  const print = plan.opts.print ?? {};
  if (!print.twoUp) return plan.pages.map((p) => [p]);
  const out = [];
  if (print.pairing === 'sequential') {
    for (let i = 0; i < n; i += 2) out.push([plan.pages[i], plan.pages[i + 1] ?? null]);
  } else {
    out.push([null, plan.pages[0] ?? null]);
    for (let i = 1; i < n; i += 2) out.push([plan.pages[i], plan.pages[i + 1] ?? null]);
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
        .map(([a, b]) => `<section class="sheet">${cell(a)}${cell(b)}<i class="fold top"></i><i class="fold bottom"></i></section>`)
        .join('\n')
    : plan.pages.map((p) => `<section class="sheet">${renderPage(plan, p, env)}</section>`).join('\n');
  const css =
    `@page{size:${pw} ${ph};margin:0}` +
    `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}` +
    `body{-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    `.sheet{position:relative;width:${pw};height:${ph};overflow:hidden;display:flex;align-items:center;justify-content:center;break-after:page;page-break-after:always;break-inside:avoid}` +
    `.sheet:last-child{break-after:auto;page-break-after:auto}` +
    `.sheet svg{display:block;flex:none;width:${w};height:${h}}` +
    (paper.twoUp
      ? `.cell{width:${n2(paper.cell)}mm;height:${ph};flex:none;display:flex;align-items:center;justify-content:center}` +
        `.fold{position:absolute;left:50%;width:0;height:4mm;border-left:0.1mm solid #c5cbd1}.fold.top{top:0}.fold.bottom{bottom:0}`
      : '') +
    `@media screen{body{background:#7d848b;padding:8mm 0}.sheet{margin:0 auto 8mm;box-shadow:0 1mm 4mm rgba(0,0,0,.35);background:#fff}}`;
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body>\n${body}\n</body></html>\n`;
}
