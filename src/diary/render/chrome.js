/**
 * Page furniture: the running head (top) and the folio (outer bottom corner).
 *
 * Head: the outer side says where the page is ("Delta Trifracton Node · ε#2"); on the pages that map Helions it ends in
 * the GLOBAL SAROS PHASE, the number of the page's first Helion in its Alpha ("62 508", of 125 125), in the outer top
 * corner, and its middle holds the Delta's phase at that Helion as two big 2-stroke glyphs. The inner side gives the
 * Gregorian span of the page in small type (normal mode only).
 */
import { SIZE, measure } from './common.js';
import { majorWords } from './words.js';

const SECTION = {
  index: 'Index',
  gregorian: 'Gregorian index',
  ephemeris: 'Ephemeris',
  eclipse: 'Eclipse',
  saros: 'Saros series',
  'eclipse-helion': 'Eclipse Helion',
  ladder: 'Period ladder',
  milestones: 'Milestones',
  planning: 'Planning',
  predictions: 'Predictions',
  summary: 'Retrospection and summary',
};
export const sectionTitle = (kind) => SECTION[kind] ?? kind;
const partOf = (p) => (p.of > 1 ? ` ${p.part}/${p.of}` : '');

/** The Delta quarter over a page: "Delta Trifracton Node" or "Delta Trifracton Peak → Node". */
export function quarterSpan(cx, t0, t1) {
  const a = cx.deltaQuarter(t0);
  const b = cx.deltaQuarter(Math.max(t0, t1 - 1));
  if (a === b) return a;
  const qa = a.split(' ').at(-1);
  const qb = b.split(' ').at(-1);
  return a.slice(0, a.length - qa.length) + `${qa} → ${qb}`;
}

/** What the head says on a page: {outer: runs, inner: string|null}. */
export function headOf(cx, page) {
  const { plan, pal } = cx;
  const D = plan.delta;
  const sep = { text: '·', fill: pal.ink4 };
  const deltaRun = (text) => ({ text, fill: pal.level(3), weight: 600 });
  const nuRun = (n) => ({ text: `ε#${n + 1}`, fill: pal.level(4), weight: 600 });
  switch (page.kind) {
    case 'lined':
    case 'canvas': {
      const runs = [deltaRun(quarterSpan(cx, page.t0, page.t1)), sep, nuRun(page.nuclide)];
      if (page.retro) {
        const h = plan.helions[page.sections[0].d];
        // the section's badge says "retrospection"; the head keeps to its half of the page
        let what = h.label;
        if (page.kind === 'canvas' && (page.canvases ?? 1) > 1) what += ` · canvas ${(page.canvasIndex ?? 0) + 1}/${page.canvases}`;
        runs.push(sep, { text: what, fill: pal.ink2 });
      }
      return { outer: runs, inner: cx.greg ? cx.gRange(page.t0, page.t1) : null, helion: plan.helions[page.sections[0].d] };
    }
    case 'nuclide': {
      const nu = plan.nuclides[page.n];
      return { outer: [deltaRun(D.name), sep, { text: `Nuclide ${nu.name}`, fill: pal.level(4), weight: 600 }], inner: cx.greg ? cx.gDays(nu.t0, nu.t1) : null, helion: plan.helions[nu.n * 77] };
    }
    case 'insert':
      return { outer: [{ text: 'Delta sheet', fill: pal.ink2 }, sep, deltaRun(majorWords(page.major))], inner: cx.greg ? cx.gLong(page.major.t) : null, helion: plan.helions[page.helion] ?? null };
    case 'notes': {
      const runs = [{ text: 'Notes', fill: pal.ink2 }];
      if (page.sheetBack || page.insertBack) runs.unshift(deltaRun(D.name), sep);
      return { outer: runs, inner: null };
    }
    case 'cover':
      return { outer: [], inner: null };
    default:
      return {
        outer: [{ text: sectionTitle(page.kind) + partOf(page), fill: pal.ink2, weight: 600 }],
        inner: `${D.name} · ${D.stamp}`,
      };
  }
}

export function drawHead(svg, cx, fr, page) {
  if (fr.m.top < 6) return;
  const { outer, inner, helion } = headOf(cx, page);
  const y = fr.y0 - Math.min(4.6, fr.m.top * 0.4);
  const size = SIZE.head;
  let runs = outer.map((r) => ({ size, gap: 1, ...r }));
  // the global Saros phase: the Helion's number in its Alpha, in the outer top corner
  if (helion?.alpha) {
    const num = { text: cx.pure.groupDigits(helion.alpha), size, weight: 600, fill: cx.pal.level(0), gap: 2.2 };
    // the number takes the outer corner: last on a recto (right-aligned), first on a verso
    runs = fr.recto ? [...runs, num] : [{ ...num, gap: 1 }, { ...runs[0], gap: 2.2 }, ...runs.slice(1)];
  }
  // the Delta's phase at the page's first Helion: two big 2-stroke glyphs (256 states) in the middle of the head
  let half = null; // with the glyphs, each side keeps to its half
  if (helion) {
    const lv = cx.env.model.levelAt(helion.t0 + 0.5, 3);
    if (lv) {
      const { hi, lo } = cx.pure.pair(lv.phase);
      const gh = Math.min(5.6, fr.m.top * 0.5);
      const xm = (fr.x0 + fr.x1) / 2;
      const gy = y - size * 0.35;
      const gap = gh * 0.14;
      const w = svg.glyphWidth(hi, gh) + gap + svg.glyphWidth(lo, gh);
      svg.glyph(hi, xm - w / 2 + svg.glyphWidth(hi, gh) / 2, gy, gh, cx.pal.level(3), 0.32);
      svg.glyph(lo, xm + w / 2 - svg.glyphWidth(lo, gh) / 2, gy, gh, cx.pal.level(3), 0.32);
      half = fr.cw / 2 - w / 2 - 2.5;
    }
  }
  // each side keeps to its half of the head; the outer side (where the page is) has priority within it
  let innerW = 0;
  if (inner) {
    const outerW = runs.reduce((s, r, i) => s + measure(r.text, r.size, { weight: r.weight, font: cx.font }) + (i ? r.gap : 0), 0);
    const room = Math.min(half ?? fr.cw, fr.cw - Math.min(outerW, fr.cw * 0.75) - 4);
    const want = measure(inner, SIZE.tiny, { font: cx.font });
    if (room >= Math.min(want, 22)) innerW = svg.text(fr.inner, y, inner, { size: SIZE.tiny, fill: cx.pal.ink3, anchor: fr.innerAnchor, maxW: room }).width;
  }
  if (runs.length) svg.runs(fr.outer, y, runs, { anchor: fr.outerAnchor, maxW: Math.min(half ?? fr.cw, fr.cw - (innerW ? innerW + 4 : 0)), minScale: 0.75 });
}

/**
 * The thumb index along the outer paper edge: one tab per reference kind, each at its own height, so the tabs of a kind
 * line up through the book. A tab reads down the edge: "‹ 37 · 5η · 191 ›" (‹ the previous page of that kind, up; ›
 * the next, down). The tint runs to the paper edge; the text keeps ≥ 4.4 mm from it (the unprintable rim of most printers).
 */
export const NAV_SLOTS = Object.freeze({ nuclide: 0.06, eclipse: 0.135, insert: 0.21, lock: 0.37, semi: 0.53, retro: 0.69, helion: 0.86 });
const NAV_LEVEL = { nuclide: 4, eclipse: 0, insert: 3, lock: 1, semi: 2, retro: 5, helion: 6 };

export function drawNav(svg, cx, fr, page) {
  if (!fr.navW || !page.nav?.length) return;
  const { pal } = cx;
  const size = 1.7;
  // the text column: its glyphs stand on the baseline towards +x (turned clockwise)
  const xb = fr.recto ? fr.W - 5.7 : 4.5;
  for (const r of page.nav) {
    const parts = [r.prev ? `‹ ${r.prev}` : null, r.label, r.next ? `${r.next} ›` : null].filter(Boolean);
    if (parts.length < 2) continue;
    const text = parts.join(' · ');
    const len = svg.textLength(text, size);
    const yc = fr.y0 + fr.ch * (NAV_SLOTS[r.kind] ?? 0.5);
    const y0 = Math.max(fr.y0, Math.min(fr.y1 - len - 2, yc - len / 2 - 1));
    const x0 = fr.recto ? xb - 0.9 : 0;
    const x1 = fr.recto ? fr.W : xb + size * 0.8 + 0.9;
    svg.rect(Math.min(x0, x1), y0, Math.abs(x1 - x0), len + 2, { fill: pal.levelSoft(NAV_LEVEL[r.kind] ?? 6) });
    svg.line(fr.recto ? x0 : x1, y0, fr.recto ? x0 : x1, y0 + len + 2, pal.levelMid(NAV_LEVEL[r.kind] ?? 6), 0.2);
    svg.textDown(xb, y0 + 1, text, { size, fill: pal.level(NAV_LEVEL[r.kind] ?? 6), weight: 600 });
  }
}

export function drawFolio(svg, cx, fr, page) {
  if (page.kind === 'cover' || fr.m.bottom < 5) return;
  const y = fr.H - fr.m.bottom + Math.min(6.6, fr.m.bottom * 0.56);
  svg.text(fr.outer, y, String(page.no), { size: SIZE.folio, fill: cx.pal.ink2, anchor: fr.outerAnchor, weight: 600 });
}
