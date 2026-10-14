/**
 * Shared primitives of the diary page renderers: an SVG string builder in millimetres, text measurement and fitting,
 * the paper palette, the page frame (inner/outer margins), the library's glyph paths, a seeded PRNG and the 1-D label
 * layout used by the time margins.
 *
 * No DOM: everything returns strings, so pages render in Node (tests, PDF export) and in the browser alike.
 */
import { levelHue } from '../../core/theme.js';

/** Round to 0.01 mm: plenty for print, keeps the markup small. */
export const n2 = (v) => Math.round(v * 100) / 100;

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- type ---------------------------------------------------------------------------------------------

export const FONT_FAMILY = Object.freeze({
  sans: "system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Times New Roman', serif",
});

/** Text sizes in mm (cap height is ~0.7 of these). */
export const SIZE = Object.freeze({ body: 2.6, small: 1.9, tiny: 1.6, head: 2.1, folio: 2.3 });

// Advance widths (1/1000 em) measured in Chromium at the sizes the pages use (SVG user units of a few mm, where the
// system sans takes its small optical size and tabular figures): for each character the widest of system-ui (SF),
// Helvetica and Arial, and of Georgia for the serif. tools/probes/diary-shots.mjs reports how the estimate compares with
// the real fonts.
const CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~αβγδεζηθικλμνξοπρστυφχψω·–—→←…−°×  ’‘“”●◐○◑▲△▼▽☊☋★☆☉◎◉◆•";
const WIDTHS = {
  sans: [321, 351, 517, 669, 669, 964, 750, 337, 421, 421, 511, 665, 337, 507, 337, 344, 669, 669, 669, 669, 669, 669, 669, 669, 669, 669, 337, 337, 666, 662, 666, 555, 1014, 712, 696, 754, 765, 666, 612, 785, 781, 307, 577, 698, 607, 913, 781, 809, 674, 809, 721, 676, 661, 776, 710, 1004, 718, 688, 701, 421, 344, 421, 669, 588, 539, 591, 651, 596, 651, 606, 403, 646, 628, 287, 286, 582, 293, 909, 623, 625, 647, 646, 429, 552, 403, 623, 581, 813, 564, 582, 578, 421, 298, 421, 669, 651, 644, 566, 612, 555, 488, 644, 628, 331, 614, 594, 654, 566, 503, 630, 710, 634, 664, 549, 610, 761, 574, 721, 802, 334, 623, 999, 999, 999, 999, 665, 511, 669, 180, 321, 335, 335, 497, 497, 964, 999, 967, 999, 999, 999, 988, 999, 601, 601, 1054, 1054, 999, 999, 999, 982, 505],
  sansBold: [306, 381, 578, 697, 697, 1038, 771, 370, 453, 453, 519, 693, 370, 516, 370, 364, 697, 697, 697, 697, 697, 697, 697, 697, 697, 697, 370, 370, 694, 691, 694, 610, 974, 751, 721, 771, 778, 666, 628, 794, 809, 341, 619, 731, 625, 935, 799, 818, 700, 818, 721, 702, 683, 791, 743, 1032, 752, 722, 710, 453, 364, 453, 697, 617, 540, 616, 676, 614, 676, 625, 437, 670, 657, 314, 313, 621, 320, 951, 652, 644, 671, 671, 462, 580, 438, 652, 609, 862, 601, 618, 597, 453, 325, 453, 697, 684, 668, 599, 633, 596, 518, 677, 645, 363, 644, 623, 688, 598, 536, 649, 765, 655, 687, 576, 624, 801, 615, 774, 844, 366, 652, 999, 999, 999, 999, 693, 519, 695, 180, 306, 369, 369, 560, 560, 981, 999, 983, 999, 999, 999, 988, 999, 601, 601, 1073, 1073, 999, 999, 999, 982, 516],
  serif: [242, 331, 411, 642, 609, 817, 710, 215, 375, 375, 472, 642, 269, 374, 269, 468, 613, 429, 558, 551, 564, 528, 565, 502, 596, 565, 312, 312, 642, 642, 642, 478, 928, 670, 653, 641, 748, 653, 598, 724, 814, 389, 517, 694, 603, 926, 766, 743, 609, 743, 701, 560, 618, 756, 666, 974, 710, 615, 601, 375, 468, 375, 642, 642, 499, 503, 560, 454, 574, 483, 325, 509, 581, 293, 292, 535, 286, 880, 590, 538, 571, 559, 409, 432, 345, 575, 496, 737, 504, 492, 443, 430, 375, 430, 642, 597, 565, 513, 538, 468, 403, 570, 556, 295, 536, 487, 579, 501, 440, 538, 600, 557, 572, 450, 541, 695, 506, 730, 714, 279, 642, 856, 999, 999, 806, 642, 419, 642, 180, 242, 226, 226, 410, 410, 603, 999, 603, 999, 989, 999, 989, 999, 602, 602, 999, 999, 999, 999, 999, 722, 392],
  serifBold: [254, 376, 509, 702, 640, 878, 798, 269, 446, 446, 481, 702, 328, 378, 328, 471, 700, 489, 626, 624, 649, 598, 647, 554, 675, 647, 367, 367, 702, 702, 702, 548, 966, 757, 756, 714, 833, 720, 671, 806, 912, 445, 594, 816, 685, 1022, 838, 819, 700, 819, 796, 648, 683, 832, 761, 1125, 808, 731, 689, 446, 471, 446, 702, 702, 499, 595, 645, 531, 662, 571, 393, 576, 679, 353, 346, 631, 344, 1014, 689, 635, 657, 648, 519, 512, 397, 676, 566, 862, 587, 561, 525, 499, 387, 499, 702, 678, 655, 570, 635, 535, 462, 660, 639, 342, 630, 527, 669, 560, 497, 635, 659, 646, 669, 485, 592, 822, 566, 839, 812, 337, 702, 926, 999, 999, 941, 702, 419, 702, 180, 254, 268, 268, 518, 518, 603, 999, 603, 999, 988, 999, 988, 999, 601, 601, 999, 999, 999, 999, 999, 722, 437],
};
const INDEX = new Map([...CHARS].map((c, i) => [c, i]));
/** A little room for fallback faces with other metrics. */
const SAFETY = 1.02;

/** Estimated advance width (mm) of `text` at `size` mm. */
export function measure(text, size, { weight = 400, font = 'sans' } = {}) {
  const table = WIDTHS[(font === 'serif' ? 'serif' : 'sans') + (weight >= 600 ? 'Bold' : '')];
  let em = 0;
  for (const ch of String(text)) {
    const i = INDEX.get(ch);
    em += i === undefined ? 0.7 : table[i] / 1000;
  }
  return em * size * SAFETY;
}

/**
 * Make `text` fit `maxW`: first smaller type (down to `min`), then a clean elision with "…".
 * @returns {{text:string, size:number, width:number}}
 */
export function fit(text, maxW, size, { min = size * 0.75, weight, font } = {}) {
  const s = String(text ?? '');
  const o = { weight, font };
  if (!(maxW > 0.5) || !s) return { text: '', size, width: 0 };
  const w = measure(s, size, o);
  if (w <= maxW) return { text: s, size, width: w };
  const lo = Math.min(size, min);
  const s2 = Math.max(lo, (size * maxW) / w);
  const w2 = measure(s, s2, o);
  if (w2 <= maxW + 1e-9) return { text: s, size: s2, width: w2 };
  const chars = [...s];
  let a = 0;
  let b = chars.length;
  const cut = (k) => chars.slice(0, k).join('').replace(/[\s·,–—→]+$/u, '') + '…';
  while (a < b) {
    const mid = (a + b + 1) >> 1;
    if (measure(cut(mid), lo, o) <= maxW) a = mid;
    else b = mid - 1;
  }
  const t = a ? cut(a) : '';
  return { text: t, size: lo, width: t ? measure(t, lo, o) : 0 };
}

/** Greedy word wrap into at most `maxLines` lines; the last line is elided when the text does not fit. */
export function wrap(text, maxW, size, { maxLines = 2, weight, font } = {}) {
  const o = { weight, font };
  if (maxLines <= 1) return [fit(String(text ?? ''), maxW, size, { min: size * 0.86, ...o }).text].filter(Boolean);
  // slightly smaller type reads better than a broken name
  if (measure(text ?? '', size * 0.9, o) <= maxW) return [String(text ?? '')];
  // pieces break at spaces and after hyphens ("Post-" / "ascending")
  const pieces = [];
  for (const w of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const parts = w.split(/(?<=-)(?=.)/);
    parts.forEach((p, i) => pieces.push({ text: p, glue: i === 0 ? ' ' : '' }));
  }
  const lines = [];
  let cur = '';
  for (let i = 0; i < pieces.length; i++) {
    const next = cur ? cur + pieces[i].glue + pieces[i].text : pieces[i].text;
    if (!cur || measure(next, size, o) <= maxW) cur = next;
    else {
      lines.push(cur);
      if (lines.length === maxLines - 1) {
        cur = pieces.slice(i).map((p, k) => (k ? p.glue : '') + p.text).join('');
        break;
      }
      cur = pieces[i].text;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => fit(l, maxW, size, { min: size * 0.86, ...o }).text);
}

// ---- colour ---------------------------------------------------------------------------------------------

function hsl(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

const FAMILY_HUE = { synodic: 232, anomalistic: 284, draconic: 330, sidereal: 196, solar: 42, sync: 42 };

/**
 * Paper palette. 'color': the app's level hues (theme.levelHue) toned down for print; 'mono': greys only.
 *   ink ink2 ink3 ink4   text, strong to faint
 *   rule ruleSoft ruleStrong   ruled lines (light grey) and separators
 *   level(L) text-strength colour of a level · levelMid(L) curves · levelSoft(L) tints
 *   family(f) event families
 */
export function palette(opts) {
  const mono = opts.style.ink === 'mono';
  const cache = new Map();
  const memo = (k, f) => {
    let v = cache.get(k);
    if (v === undefined) cache.set(k, (v = f()));
    return v;
  };
  const p = {
    mono,
    paper: '#ffffff',
    ink: '#1b2127',
    ink2: '#4a545e',
    ink3: '#78838e',
    ink4: '#aab2ba',
    rule: '#c5cbd1',
    ruleSoft: '#dfe3e7',
    ruleStrong: '#8c96a0',
    shade: '#f3f4f6',
    level: (L) => memo(`l${L}`, () => (mono ? '#2a3036' : hsl(levelHue(L), 52, 33))),
    levelMid: (L) => memo(`m${L}`, () => (mono ? '#7d858d' : hsl(levelHue(L), 38, 55))),
    levelSoft: (L) => memo(`s${L}`, () => (mono ? '#eef0f2' : hsl(levelHue(L), 45, 93))),
    family: (f) =>
      memo(`f${f}`, () => {
        if (mono) return '#3b434b';
        if (f === 'solar' || f === 'sync') return hsl(40, 78, 34);
        return FAMILY_HUE[f] !== undefined ? hsl(FAMILY_HUE[f], 34, 40) : '#3b434b';
      }),
  };
  return p;
}

// ---- glyphs ---------------------------------------------------------------------------------------------

const glyphCache = new Map();
/** The library's 2-stroke glyph `index` (0..15) as {path, dot, cy, h, w} in design units. */
export function glyphGeo(F, index) {
  let g = glyphCache.get(index);
  if (!g) {
    const geo = F.CBT.geometry(F.CBT.fromIndex(index, { depth: 2 }), { thickness: 0.3 });
    const b = geo.bounds;
    g = { path: geo.path, dot: geo.dot, minY: b.minY, maxY: b.maxY, minX: b.minX, maxX: b.maxX, h: b.maxY - b.minY, w: b.maxX - b.minX };
    glyphCache.set(index, g);
  }
  return g;
}

// ---- svg builder ------------------------------------------------------------------------------------------

const attrs = (o) => {
  let s = '';
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== false) s += ` ${k}="${typeof v === 'number' ? n2(v) : esc(v)}"`;
  return s;
};

/**
 * Collects the markup of one page. Lengths are millimetres (the viewBox is the paper).
 */
export class Svg {
  constructor(W, H, { font = 'sans', F = globalThis.Fractonica } = {}) {
    this.W = W;
    this.H = H;
    this.font = font;
    this.F = F;
    this.out = [];
  }
  add(s) {
    this.out.push(s);
  }
  line(x1, y1, x2, y2, stroke, w = 0.15, extra = {}) {
    this.out.push(`<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${stroke}" stroke-width="${n2(w)}"${attrs(extra)}/>`);
  }
  rect(x, y, w, h, o = {}) {
    this.out.push(`<rect${attrs({ x, y, width: Math.max(0, w), height: Math.max(0, h), rx: o.rx, fill: o.fill ?? 'none', stroke: o.stroke, 'stroke-width': o.sw, 'stroke-dasharray': o.dash, opacity: o.opacity })}/>`);
  }
  circle(cx, cy, r, fill, o = {}) {
    this.out.push(`<circle${attrs({ cx, cy, r, fill, stroke: o.stroke, 'stroke-width': o.sw })}/>`);
  }
  path(d, o = {}) {
    this.out.push(`<path d="${d}"${attrs({ fill: o.fill ?? 'none', stroke: o.stroke, 'stroke-width': o.sw, 'stroke-dasharray': o.dash, 'stroke-linecap': o.cap, 'stroke-linejoin': o.join, opacity: o.opacity })}/>`);
  }
  /**
   * One line of text. With `maxW` it is fitted (smaller type, then elided). Returns the fitted {text, size, width}.
   * o: size, fill, anchor ('start'|'middle'|'end'), weight, italic, ls (letter spacing mm), maxW, min, halo (white
   * outline behind the glyphs, for labels drawn over rules).
   */
  text(x, y, str, o = {}) {
    const size = o.size ?? SIZE.small;
    const mo = { weight: o.weight, font: this.font };
    // the browser adds letter-spacing after every character, the last one included
    const spacing = o.ls ? o.ls * [...String(str ?? '')].length : 0;
    const f = o.maxW !== undefined ? fit(str, o.maxW - spacing, size, { min: o.min, ...mo }) : { text: String(str ?? ''), size, width: measure(str ?? '', size, mo) };
    f.width += spacing;
    if (!f.text) return f;
    this.out.push(
      `<text${attrs({
        x,
        y,
        'font-size': f.size,
        fill: o.fill ?? '#1b2127',
        'text-anchor': o.anchor && o.anchor !== 'start' ? o.anchor : undefined,
        'font-weight': o.weight && o.weight !== 400 ? o.weight : undefined,
        'font-style': o.italic ? 'italic' : undefined,
        'letter-spacing': o.ls,
        stroke: o.halo ? '#ffffff' : undefined,
        'stroke-width': o.halo ? 0.7 : undefined,
        'paint-order': o.halo ? 'stroke' : undefined,
        'stroke-linejoin': o.halo ? 'round' : undefined,
      })}>${esc(f.text)}</text>`,
    );
    return f;
  }
  /**
   * Inline runs [{text, size, fill, weight, gap}] on one baseline; the browser flows them (tspans), so the estimate only
   * decides the fitting. `maxW` scales every run down together (to `minScale`), then elides the last run.
   * Returns the estimated total width.
   */
  runs(x, y, runs, o = {}) {
    const mo = (r) => ({ weight: r.weight, font: this.font });
    let list = runs.filter((r) => r && r.text !== '' && r.text !== undefined && r.text !== null).map((r) => ({ ...r, text: String(r.text) }));
    if (!list.length) return 0;
    const width = (k) => list.reduce((s, r, i) => s + measure(r.text, r.size * k, mo(r)) + (i ? (r.gap ?? 0.9) * k : 0), 0);
    let k = 1;
    if (o.maxW !== undefined) {
      const w = width(1);
      if (w > o.maxW) {
        k = Math.max(o.minScale ?? 0.78, o.maxW / w);
        // still too wide: elide the last run (or drop trailing runs)
        while (list.length && width(k) > o.maxW + 1e-9) {
          const last = list.at(-1);
          const rest = width(k) - measure(last.text, last.size * k, mo(last));
          const room = o.maxW - rest;
          const f = fit(last.text, room, last.size * k, { min: last.size * k, ...mo(last) });
          if (f.text && f.width <= room + 1e-9) {
            list[list.length - 1] = { ...last, text: f.text };
            break;
          }
          list = list.slice(0, -1);
        }
        if (!list.length) return 0;
      }
    }
    const spans = list
      .map((r, i) =>
        `<tspan${attrs({
          dx: i ? (r.gap ?? 0.9) * k : undefined,
          'font-size': r.size * k,
          fill: r.fill,
          'font-weight': r.weight && r.weight !== 400 ? r.weight : undefined,
          'letter-spacing': r.ls,
        })}>${esc(r.text)}</tspan>`,
      )
      .join('');
    this.out.push(
      `<text${attrs({
        x,
        y,
        'text-anchor': o.anchor && o.anchor !== 'start' ? o.anchor : undefined,
        fill: o.fill ?? '#1b2127',
        stroke: o.halo ? '#ffffff' : undefined,
        'stroke-width': o.halo ? 0.7 : undefined,
        'paint-order': o.halo ? 'stroke' : undefined,
        'stroke-linejoin': o.halo ? 'round' : undefined,
      })}>${spans}</text>`,
    );
    return width(k);
  }
  /** The library's 2-stroke glyph `index` centred at (cx, cy), `h` mm tall (its full cell, dot band included). */
  glyph(index, cx, cy, h, color, sw = 0.2) {
    const g = glyphGeo(this.F, index);
    const s = h / g.h;
    const ty = cy - ((g.minY + g.maxY) / 2) * s;
    const dot = g.dot ? `<circle cx="0" cy="${n2(g.dot.y)}" r="0.45" fill="${color}" stroke="none"/>` : '';
    this.out.push(
      `<g transform="translate(${n2(cx)} ${n2(ty)}) scale(${Math.round(s * 10000) / 10000})" fill="none" stroke="${color}" stroke-width="${Math.round((sw / s) * 1000) / 1000}" stroke-linecap="round" stroke-linejoin="round"><path d="${g.path}"/>${dot}</g>`,
    );
    return (g.w * s);
  }
  toString() {
    const { W, H } = this;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n2(W)} ${n2(H)}" width="${n2(W)}mm" height="${n2(H)}mm" ` +
      `font-family="${esc(FONT_FAMILY[this.font] ?? FONT_FAMILY.sans)}" style="font-variant-numeric:tabular-nums">` +
      `<rect width="${n2(W)}" height="${n2(H)}" fill="#ffffff"/>${this.out.join('')}</svg>`
    );
  }
}

// ---- page frame -------------------------------------------------------------------------------------------

/**
 * The content box of a page: the INNER margin (binding) is on the left of a recto and the right of a verso; the OUTER
 * margin carries the time ticks. `dir` points outward (+1 right on a recto, −1 left on a verso).
 */
export function frameOf(opts, page) {
  const { width: W, height: H, margins: m } = opts.page;
  const recto = page.side !== 'verso';
  const x0 = recto ? m.inner : m.outer;
  const x1 = W - (recto ? m.outer : m.inner);
  return {
    W,
    H,
    m,
    recto,
    x0,
    x1,
    y0: m.top,
    y1: H - m.bottom,
    cw: x1 - x0,
    ch: H - m.top - m.bottom,
    outer: recto ? x1 : x0,
    inner: recto ? x0 : x1,
    dir: recto ? 1 : -1,
    /** text anchored on the outer / inner content edge */
    outerAnchor: recto ? 'end' : 'start',
    innerAnchor: recto ? 'start' : 'end',
    /** the margin column that carries the ticks: width */
    marginW: m.outer,
  };
}

// ---- seeded randomness ---------------------------------------------------------------------------------------

/** mulberry32: a tiny deterministic PRNG, uniform in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Mix integers into one 32-bit seed. */
export function seedOf(...xs) {
  let h = 2166136261;
  for (const x of xs) {
    let v = Math.floor(Number(x)) || 0;
    for (let i = 0; i < 4; i++) {
      h = Math.imul(h ^ (v & 255), 16777619);
      v = Math.floor(v / 256);
    }
  }
  return h >>> 0;
}

// ---- 1-D label layout ---------------------------------------------------------------------------------------

/**
 * Place labels along one axis without overlaps: items {want (desired top), h}, inside [lo, hi] with `gap` between.
 * Sets item.y (top). Returns false when they cannot all fit (they are then packed from lo and may run past hi).
 */
export function dodge(items, lo, hi, gap = 0.4) {
  const list = items.slice().sort((a, b) => a.want - b.want);
  let prev = -Infinity;
  for (const it of list) {
    it.y = Math.max(it.want, lo, prev);
    prev = it.y + it.h + gap;
  }
  let next = hi + gap;
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i];
    if (it.y + it.h > next - gap) it.y = next - gap - it.h;
    next = it.y;
  }
  if (list.length && list[0].y < lo - 1e-9) {
    let p = lo;
    for (const it of list) {
      it.y = Math.max(it.y, p);
      p = it.y + it.h + gap;
    }
    return false;
  }
  return true;
}

/** Total height of items packed with gaps. */
export const packedHeight = (items, gap = 0.4) => items.reduce((s, it) => s + it.h, 0) + Math.max(0, items.length - 1) * gap;
