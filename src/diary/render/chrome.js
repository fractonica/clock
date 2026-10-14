/**
 * Page furniture: the running head (top) and the folio (outer bottom corner).
 *
 * Head: the outer side says where the page is ("Delta Trifracton Node · ε#2"); on the pages that map Helions the outer
 * top corner carries the GLOBAL SAROS PHASE: a dial of the Alpha cycle (125 125 Helions) filled from the top clockwise
 * to the page's first Helion, with the 5 Beta divisions on the rim and the 13 Gamma divisions of the current Beta, and
 * that Helion's number in its Alpha beside it ("62 508/125 125"). The inner side gives the Gregorian span of the page
 * in small type (normal mode only).
 */
import { SIZE, measure, n2 } from './common.js';
import { majorWords } from './words.js';

const SECTION = {
  index: 'Index',
  gregorian: 'Gregorian index',
  ephemeris: 'Ephemeris',
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
        let what = `Retrospection · ${h.label}`;
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

export const ALPHA_HELIONS = 125125;
const BETA_HELIONS = ALPHA_HELIONS / 5;
const GAMMA_HELIONS = BETA_HELIONS / 13;

/**
 * The global Saros phase as a dial: the circle is the Alpha cycle (125 125 Helions, from the top clockwise), filled to
 * Helion `alpha` (1..125 125); the 5 Betas are rim ticks, the 13 Gammas of the current Beta small inner ticks; a hand
 * points at the Helion. Period colours: Alpha the fill, Beta and Gamma their ticks.
 */
export function drawSarosDial(svg, cx, x, y, r, alpha) {
  const { pal } = cx;
  const at = (f, rr) => [x + rr * Math.sin(f * 2 * Math.PI), y - rr * Math.cos(f * 2 * Math.PI)];
  const f = Math.min(1, Math.max(0, alpha / ALPHA_HELIONS));
  svg.circle(x, y, r, '#ffffff', { stroke: pal.ink4, sw: 0.16 });
  if (f > 0) {
    const [ex, ey] = at(f, r);
    const large = f > 0.5 ? 1 : 0;
    const sector = f >= 0.9999 ? `M${n2(x)} ${n2(y - r)}A${n2(r)} ${n2(r)} 0 1 1 ${n2(x - 0.001)} ${n2(y - r)}Z` : `M${n2(x)} ${n2(y)}L${n2(x)} ${n2(y - r)}A${n2(r)} ${n2(r)} 0 ${large} 1 ${n2(ex)} ${n2(ey)}Z`;
    svg.path(sector, { fill: pal.levelSoft(0) });
    const rr = r - 0.32;
    const [ax, ay] = at(f, rr);
    svg.path(`M${n2(x)} ${n2(y - rr)}A${n2(rr)} ${n2(rr)} 0 ${large} 1 ${n2(ax)} ${n2(ay)}`, { stroke: pal.level(0), sw: 0.55 });
  }
  // the 13 Gammas of the current Beta, then the 5 Betas
  const beta = Math.min(4, Math.floor((alpha - 1) / BETA_HELIONS));
  const g = [];
  for (let k = 1; k < 13; k++) {
    const ff = (beta * BETA_HELIONS + k * GAMMA_HELIONS) / ALPHA_HELIONS;
    const [x0, y0] = at(ff, r - 0.75);
    const [x1, y1] = at(ff, r);
    g.push(`M${n2(x0)} ${n2(y0)}L${n2(x1)} ${n2(y1)}`);
  }
  svg.path(g.join(''), { stroke: pal.level(2), sw: 0.13 });
  const b = [];
  for (let k = 0; k < 5; k++) {
    const [x0, y0] = at(k / 5, r - 1.25);
    const [x1, y1] = at(k / 5, r + 0.45);
    b.push(`M${n2(x0)} ${n2(y0)}L${n2(x1)} ${n2(y1)}`);
  }
  svg.path(b.join(''), { stroke: pal.level(1), sw: 0.3, cap: 'round' });
  const [hx, hy] = at(f, r - 0.2);
  svg.line(x, y, hx, hy, pal.ink, 0.22, { 'stroke-linecap': 'round' });
  svg.circle(x, y, 0.32, pal.ink);
}

export function drawHead(svg, cx, fr, page) {
  if (fr.m.top < 6) return;
  const { outer, inner, helion } = headOf(cx, page);
  const y = fr.y0 - Math.min(4.6, fr.m.top * 0.4);
  const size = SIZE.head;
  let runs = outer.map((r) => ({ size, gap: 1, ...r }));
  // the global Saros phase: a dial in the outer top corner, the Helion's number in its Alpha beside it
  if (helion?.alpha) {
    const r = Math.min(4.2, (fr.m.outer - 2.4) / 2, (fr.m.top - 2.6) / 2);
    if (r >= 1.6) drawSarosDial(svg, cx, fr.outer + fr.dir * (fr.m.outer / 2), y - 0.75, r, helion.alpha);
    const num = [
      { text: cx.pure.groupDigits(helion.alpha), size, weight: 600, fill: cx.pal.level(0), gap: 2.2 },
      { text: `/${cx.pure.groupDigits(ALPHA_HELIONS)}`, size: SIZE.tiny, fill: cx.pal.ink3, gap: 0.3 },
    ];
    // the number goes next to the dial: last on a recto (right-aligned), first on a verso
    runs = fr.recto ? [...runs, ...num] : [{ ...num[0], gap: 1 }, { ...num[1] }, { ...runs[0], gap: 2.2 }, ...runs.slice(1)];
  }
  // the outer side (where the page is) has priority; the inner side gets what is left, or nothing when that is little
  const outerW = runs.reduce((s, r, i) => s + measure(r.text, r.size, { weight: r.weight, font: cx.font }) + (i ? r.gap : 0), 0);
  let innerW = 0;
  if (inner) {
    const room = fr.cw - Math.min(outerW, fr.cw * 0.75) - 4;
    const want = measure(inner, SIZE.tiny, { font: cx.font });
    if (room >= Math.min(want, 22)) innerW = svg.text(fr.inner, y, inner, { size: SIZE.tiny, fill: cx.pal.ink3, anchor: fr.innerAnchor, maxW: room }).width;
  }
  if (runs.length) svg.runs(fr.outer, y, runs, { anchor: fr.outerAnchor, maxW: fr.cw - (innerW ? innerW + 4 : 0), minScale: 0.8 });
}

export function drawFolio(svg, cx, fr, page) {
  if (page.kind === 'cover' || fr.m.bottom < 5) return;
  const y = fr.H - fr.m.bottom + Math.min(6.6, fr.m.bottom * 0.56);
  svg.text(fr.outer, y, String(page.no), { size: SIZE.folio, fill: cx.pal.ink2, anchor: fr.outerAnchor, weight: 600 });
}
