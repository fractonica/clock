/**
 * Helion sections: the body pages of the diary map Helions top to bottom, one section per Helion.
 *
 *   header   the number "34η" large (Helions are numbered 1..77 in their Nuclide), the stamp "δ#3 ε#2 34η", the
 *            Gregorian start–end (outer side)
 *   body     ruled lines (lined pages) or a canvas (grid, dots, dot-grid, lined, blank)
 *   margin   in the OUTER margin, along the body's time axis (frac 0 at the header rule, 1 at the section's last
 *            rule): the Helion's wave as two arcs of true circles (crest = positive, to the right; trough to the left,
 *            constant curvature like the library's half-arcs, as deep as the margin allows), a tick at every quarter threshold with the 2-stroke glyph of that state
 *            (4 peak, 8 node, 12 valley, 0 end) and its time, and a tick for every event at its exact fraction with a
 *            symbol, a short name, the Gregorian time and the Fractonica clock. Labels never overlap: they are laid
 *            out along the axis (with leaders when displaced) and shed detail when a section is crowded.
 *   majors   a threshold of Alpha … Delta is a dashed rule across the body in its level colour, said in words
 *            ("Delta Trifracton · Peak ends → Node · 14:02 · 20η 9ι 0λ").
 */
import { SIZE, dodge, packedHeight, rng, seedOf, n2, wrap, measure } from './common.js';
import { QUARTER_GLYPH } from './words.js';

const HELION_LEVEL = 6;
const PREON_LEVEL = 8;
const FLAVONS = 36 * 65; // Flavons per Helion

/** Vertical boxes of `n` stacked sections inside the content box. */
export function sectionBoxes(fr, n) {
  const hh = Math.min(6.6, Math.max(5, fr.ch * 0.035));
  const gap = n > 1 ? Math.min(3, Math.max(1.6, fr.ch * 0.012)) : 0;
  const sh = (fr.ch - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => {
    const top = fr.y0 + i * (sh + gap);
    return { i, n, top, hh, gap, bodyTop: top + hh, bodyBottom: top + sh, bottom: top + sh };
  });
}

/**
 * Where the margin labels of section i may go: the margin beside a header is free, so a section's labels may reach a
 * little into the next header band (its own labels start a quarter of a Helion down at the earliest, or below the band).
 */
export function marginBounds(fr, boxes, i) {
  const b = boxes[i];
  const lo = i === 0 ? fr.y0 - 0.5 : b.top + 1.6;
  const hi = i === boxes.length - 1 ? fr.y1 + Math.min(2.6, Math.max(0, fr.m.bottom - 8)) : boxes[i + 1].top + 1.4;
  return { lo, hi };
}

const yOf = (box, frac) => box.bodyTop + frac * (box.bodyBottom - box.bodyTop);

// ---- header ---------------------------------------------------------------------------------------------------

export function drawSectionHeader(svg, cx, fr, box, h, { badge } = {}) {
  const { pal } = cx;
  const yb = box.top + box.hh * 0.7;
  const big = Math.min(4.2, box.hh * 0.64);
  const runs = [
    { text: h.label, size: big, weight: 600, fill: pal.level(HELION_LEVEL) },
    { text: h.stamp, size: SIZE.small, fill: pal.ink3, gap: 1.8 },
  ];
  if (badge) runs.push({ text: badge, size: SIZE.small, fill: pal.ink2, weight: 600, gap: 1.6 });
  const right = cx.greg ? cx.gRange(h.t0, h.t1) : null;
  const rightW = right ? Math.min(measure(right, SIZE.small, { font: cx.font }), fr.cw * 0.5) : 0;
  svg.runs(fr.inner + fr.dir * 0, yb, runs, { anchor: fr.innerAnchor, maxW: fr.cw - rightW - 3, minScale: 0.8 });
  if (right) svg.text(fr.outer, yb, right, { size: SIZE.small, fill: pal.ink2, anchor: fr.outerAnchor, maxW: fr.cw * 0.5 });
  svg.line(fr.x0, box.bodyTop, fr.x1, box.bodyTop, pal.ruleStrong, 0.22);
}

// ---- ruled lines with inner-edge labels ------------------------------------------------------------------

/** The Preon reading at the start of line k of `lines`: "9ι", or "7ι 13λ" when it is not a whole Preon (counts). */
export function lineLabel(k, lines) {
  if ((k * 36) % lines === 0) return `${(k * 36) / lines}ι`;
  const fl = Math.floor((k * FLAVONS) / lines);
  const io = Math.floor(fl / 65);
  const la = fl % 65;
  return la ? `${io}ι ${la}λ` : `${io}ι`;
}

/** Label every `step`-th line: readable type, and whole Preons when that costs at most twice the step. */
export function labelStep(lines, rowH) {
  let step = 1;
  while (step < lines && step * rowH < 2.5) step++;
  if ((step * 36) % lines !== 0) {
    for (let s = step + 1; s <= Math.min(lines, step * 2); s++) {
      if ((s * 36) % lines === 0) {
        step = s;
        break;
      }
    }
  }
  return step;
}

const isQuarter = (f) => [0.25, 0.5, 0.75, 1].some((q) => Math.abs(f - q) < 1e-9);

/** Ruled lines of a lined section; returns the width reserved by the labels at the inner edge. */
export function drawRuled(svg, cx, fr, box, h, lines) {
  const { pal, opts } = cx;
  const bh = box.bodyBottom - box.bodyTop;
  const rowH = bh / lines;
  const d = [];
  const dq = [];
  for (let k = 1; k <= lines; k++) {
    const y = n2(box.bodyTop + k * rowH);
    (isQuarter(k / lines) ? dq : d).push(`M${n2(fr.x0)} ${y}H${n2(fr.x1)}`);
  }
  if (d.length) svg.path(d.join(''), { stroke: pal.rule, sw: 0.15 });
  if (dq.length) svg.path(dq.join(''), { stroke: pal.ruleStrong, sw: 0.17 });
  const mode = opts.lined.labels;
  if (mode === 'none') return 0;
  const withTime = mode === 'both' && cx.greg;
  const step = labelStep(lines, rowH);
  // a label fits inside its row when it can be at least 1.3 mm tall; otherwise it spans `step` rows on a white tab
  let fs = Math.min(SIZE.small, rowH * 0.62);
  const tab = fs < 1.3;
  if (tab) fs = Math.min(SIZE.small, Math.max(1.25, step * rowH * 0.46));
  const font = { font: cx.font };
  let reserve = 0;
  for (let k = 0; k < lines; k += step) {
    const top = box.bodyTop + k * rowH;
    const yb = top + Math.min(fs * 0.92 + 0.4, step * rowH - 0.25);
    const runs = [{ text: lineLabel(k, lines), size: fs, fill: pal.level(PREON_LEVEL) }];
    if (withTime) runs.push({ text: cx.gTime(h.t0 + (k / lines) * (h.t1 - h.t0)), size: fs * 0.86, fill: pal.ink3, gap: 1 });
    const w = runs.reduce((acc, r, i) => acc + measure(r.text, r.size, font) + (i ? r.gap : 0), 0);
    if (tab) {
      const x = fr.recto ? fr.inner : fr.inner - w - 0.9;
      svg.rect(x, yb - fs * 0.82, w + 0.9, fs * 1.08, { fill: '#ffffff' });
    }
    svg.runs(fr.inner + fr.dir * 0.5, yb, runs, { anchor: fr.innerAnchor });
    reserve = Math.max(reserve, w + 1.5);
  }
  return reserve;
}

// ---- majors across the body -------------------------------------------------------------------------------

export function drawMajors(svg, cx, fr, box, h, { reserveInner = 14 } = {}) {
  const { pal } = cx;
  // thresholds at the same instant (a Gamma node is also a Delta node) share one rule, their labels stack
  const groups = [];
  for (const e of h.events) {
    if (e.family !== 'major') continue;
    const g = groups.find((x) => Math.abs(x[0].frac - e.frac) < 1e-7);
    if (g) g.push(e);
    else groups.push([e]);
  }
  for (const g of groups) {
    g.sort((a, b) => a.major.level - b.major.level);
    const e0 = g[0];
    const y = yOf(box, e0.frac);
    svg.line(fr.x0, y, fr.x1, y, pal.level(e0.major.level), 0.26, { 'stroke-dasharray': '1.4 0.9' });
    const below = e0.frac < 0.08;
    const tail = [cx.greg ? cx.gTime(e0.t) : null, cx.fClock(e0.t)].filter(Boolean).join(' · ');
    // the finest level sits next to the rule, coarser ones further out; the time goes on the label nearest the rule
    const list = below ? g : g.slice().reverse();
    list.forEach((e, i) => {
      const text = i === 0 ? `${cx.majorWords(e.major)} · ${tail}` : cx.majorWords(e.major);
      const yy = below ? y + 2.4 + i * 2.3 : y - 0.8 - i * 2.3;
      svg.text(fr.outer - fr.dir * 0.6, yy, text, {
        size: 1.8,
        weight: 600,
        fill: pal.level(e.major.level),
        anchor: fr.outerAnchor,
        maxW: fr.cw - reserveInner - 1.2,
        min: 1.45,
        halo: true,
      });
    });
  }
}

// ---- the time margin -----------------------------------------------------------------------------------

/**
 * One cycle as two arcs of true circles along a vertical axis at x from y0 to y1: the crest bulges right over the first
 * half, the trough left over the second (constant curvature, like the library's half-arcs). A half-cycle of chord L is a
 * semicircle when it fits within `depth`; otherwise the circular arc of sagitta `depth` (radius (L²/4 + s²) / 2s).
 */
export function waveArcs(x, y0, y1, depth) {
  const L = (y1 - y0) / 2;
  const sag = Math.max(0.01, Math.min(depth, L / 2));
  const r = (L * L) / 4 / (2 * sag) + sag / 2;
  const R = n2(r);
  const xs = n2(x);
  return `M${xs} ${n2(y0)}A${R} ${R} 0 0 1 ${xs} ${n2(y0 + L)}A${R} ${R} 0 0 0 ${xs} ${n2(y1)}`;
}

/** The pure-mode reading of a quarter threshold: "9ι", "18ι", "27ι", and at the end what begins ("→ 34η"). */
function pureTick(h, name) {
  if (name === 'peak') return '9ι';
  if (name === 'node') return '18ι';
  if (name === 'valley') return '27ι';
  if (h.num < 77) return `→ ${h.num + 1}η`;
  return `→ ε#${h.n < 4 ? h.n + 2 : 1}`;
}

/**
 * The outer margin of one section. `bounds` {lo, hi}: where labels may go.
 */
export function drawMargin(svg, cx, fr, box, h, bounds) {
  const { pal, opts } = cx;
  const usable = fr.marginW - 1.0;
  if (usable < 2.4) return;
  const k = Math.min(1, usable / 13);
  const xc = 2.0 * k; // the zero axis of the wave
  const depth = 1.6 * k; // the deepest bulge the margin allows on both sides of the axis
  const railEnd = 3.7 * k;
  const glyphX = 4.9 * k;
  const evX = 4.1 * k;
  const X = (d) => fr.outer + fr.dir * d;
  const anchor = fr.recto ? 'start' : 'end';
  const top = box.bodyTop;
  const bot = box.bodyBottom;
  const helionColor = pal.level(HELION_LEVEL);

  // the wave: crest (positive, right) over the first half, trough over the second, on a faint zero axis
  if (opts.lined.marginCurve) {
    svg.line(X(xc), top, X(xc), bot, pal.ruleSoft, 0.12);
    svg.path(waveArcs(X(xc), top, bot, depth), { stroke: pal.levelMid(HELION_LEVEL), sw: 0.22 });
  }


  const majorsAt = h.events.filter((e) => e.family === 'major');
  const ticks = h.ticks.filter((t) => t.name !== 'begin');
  const glyphs = opts.lined.marginGlyphs && usable >= 6;
  const glyphH = 3.2 * Math.max(0.8, k);

  // labels, from full detail down to bare ticks until they fit the section
  const room = bounds.hi - bounds.lo;
  let labels = [];
  let fs = SIZE.tiny;
  for (let level = 0; level <= 5; level++) {
    fs = level >= 3 ? 1.3 : 1.5;
    const lh = fs * 1.2;
    labels = [];
    for (const tk of ticks) {
      const text = level >= 4 ? null : cx.greg ? cx.gTime(tk.t) : pureTick(h, tk.name);
      if (!glyphs && !text) continue;
      const hgt = glyphs ? glyphH : fs * 1.25;
      labels.push({ type: 'q', tk, anchor: yOf(box, tk.frac), text, h: hgt, want: yOf(box, tk.frac) - hgt / 2 });
    }
    if (level < 5) {
      for (const e of h.events) {
        if (e.family === 'major') continue;
        const maxW = usable - evX;
        const lines = [];
        const sym = cx.eventSymbol(e);
        const name = cx.eventName(e);
        const nameLines = wrap(name, maxW - measure(sym + ' ', fs, { font: cx.font }), fs, { maxLines: level >= 2 || e.family === 'sync' ? 1 : 2, font: cx.font });
        nameLines.forEach((l, i) => lines.push(i === 0 ? { sym, text: l } : { text: l }));
        if (e.family === 'sync') {
          const dr = cx.driftText(e);
          if (dr && level < 2) lines.push({ text: `drift ${dr}`, fill: pal.ink3 });
          if (cx.greg && level < 2) lines.push({ text: cx.gTime(e.t), fill: pal.ink2 });
        } else {
          if (cx.greg && level < 2) lines.push({ text: cx.gTime(e.t), fill: pal.ink2 });
          if (level < 1) lines.push({ text: cx.fClock(e.t), fill: pal.ink3 });
        }
        const hgt = lines.length * lh;
        const a = yOf(box, e.frac);
        labels.push({ type: 'e', e, lines, anchor: a, h: hgt, lh, want: a - fs * 0.62 });
      }
    }
    if (packedHeight(labels) <= room) break;
  }
  dodge(labels, bounds.lo, bounds.hi);

  // ticks
  const d = [];
  for (const tk of ticks) {
    const y = yOf(box, tk.frac);
    if (majorsAt.some((e) => Math.abs(e.frac - tk.frac) < 1e-6)) continue;
    d.push(`M${n2(X(0))} ${n2(y)}H${n2(X(railEnd))}`);
  }
  if (d.length) svg.path(d.join(''), { stroke: pal.ink3, sw: 0.18 });
  for (const e of h.events) {
    const y = yOf(box, e.frac);
    const c = cx.familyColor(e);
    svg.line(X(0), y, X(railEnd), y, c, e.family === 'major' ? 0.32 : 0.22);
  }

  // labels and leaders
  for (const l of labels) {
    if (l.type === 'q') {
      const cyl = l.y + l.h / 2;
      let x = glyphX - (glyphs ? 0 : 1.1 * k);
      if (Math.abs(cyl - l.anchor) > 0.9) svg.line(X(railEnd), l.anchor, X(x - 1.1 * k), cyl, pal.ink4, 0.12);
      if (glyphs) {
        svg.glyph(QUARTER_GLYPH[l.tk.name], X(glyphX), cyl, glyphH, helionColor, 0.2);
        x = glyphX + 1.45 * k;
      }
      if (l.text) svg.text(X(x), cyl + fs * 0.36, l.text, { size: fs, fill: pal.ink2, anchor, maxW: usable - x, min: 1.2 });
    } else {
      const c = cx.familyColor(l.e);
      const first = l.y + fs * 0.86;
      if (Math.abs(first - fs * 0.32 - l.anchor) > 0.9) svg.line(X(railEnd), l.anchor, X(evX - 0.4), first - fs * 0.32, c, 0.12);
      l.lines.forEach((ln, i) => {
        const y = first + i * l.lh;
        const maxW = usable - evX;
        if (ln.sym) svg.runs(X(evX), y, [{ text: ln.sym, size: fs, fill: c }, { text: ln.text, size: fs, fill: pal.ink, gap: 0.6 }], { anchor, maxW });
        else svg.text(X(evX), y, ln.text, { size: fs, fill: ln.fill ?? pal.ink2, anchor, maxW, min: 1.2 });
      });
    }
  }
}

// ---- canvases ----------------------------------------------------------------------------------------------

/**
 * The body of a canvas section. `salt` separates two canvases of the same Helion (the retro pages).
 */
export function drawCanvas(svg, cx, fr, box, h, canvas, salt = 0) {
  const { pal } = cx;
  const pad = 1.4;
  const x = fr.x0;
  const w = fr.cw;
  const y = box.bodyTop + pad;
  const hh = box.bodyBottom - box.bodyTop - pad;
  if (w < 4 || hh < 4) return;
  switch (canvas.type) {
    case 'grid':
    case 'dot-grid': {
      const cell = Math.min(w / canvas.cols, hh / canvas.rows);
      const gw = cell * canvas.cols;
      const gh = cell * canvas.rows;
      const ox = x + (w - gw) / 2;
      const oy = y + (hh - gh) / 2;
      if (canvas.type === 'grid') {
        const d = [];
        for (let c = 1; c < canvas.cols; c++) d.push(`M${n2(ox + c * cell)} ${n2(oy)}V${n2(oy + gh)}`);
        for (let r = 1; r < canvas.rows; r++) d.push(`M${n2(ox)} ${n2(oy + r * cell)}H${n2(ox + gw)}`);
        if (d.length) svg.path(d.join(''), { stroke: pal.rule, sw: 0.15 });
        svg.rect(ox, oy, gw, gh, { stroke: pal.ruleStrong, sw: 0.2 });
      } else {
        const r = Math.min(0.3, cell * 0.06);
        const d = [];
        for (let c = 0; c <= canvas.cols; c++) for (let rr = 0; rr <= canvas.rows; rr++) d.push(dotPath(ox + c * cell, oy + rr * cell, r));
        svg.path(d.join(''), { fill: pal.ink3 });
      }
      break;
    }
    case 'dots': {
      const pts = scatter(canvas.count, x + 1.2, y + 1.2, w - 2.4, hh - 2.4, seedOf(h.cycle, salt, 77));
      const r = Math.min(0.38, Math.sqrt((w * hh) / Math.max(1, canvas.count)) * 0.07);
      svg.path(pts.map(([px, py]) => dotPath(px, py, r)).join(''), { fill: pal.ink3 });
      break;
    }
    case 'lined': {
      const step = hh / canvas.lines;
      const d = [];
      for (let i = 1; i <= canvas.lines; i++) d.push(`M${n2(x)} ${n2(y + i * step)}H${n2(x + w)}`);
      svg.path(d.join(''), { stroke: pal.rule, sw: 0.15 });
      break;
    }
    default: {
      // blank: corner marks frame the space
      const m = Math.min(3, w / 6, hh / 6);
      const c = [
        [x, y, 1, 1],
        [x + w, y, -1, 1],
        [x, y + hh, 1, -1],
        [x + w, y + hh, -1, -1],
      ];
      svg.path(c.map(([px, py, sx, sy]) => `M${n2(px + sx * m)} ${n2(py)}H${n2(px)}V${n2(py + sy * m)}`).join(''), { stroke: pal.ruleStrong, sw: 0.2 });
    }
  }
}

/** A filled dot as a path segment (two arcs): many dots stay one element. */
const dotPath = (x, y, r) => `M${n2(x - r)} ${n2(y)}a${n2(r)} ${n2(r)} 0 1 0 ${n2(2 * r)} 0a${n2(r)} ${n2(r)} 0 1 0 ${n2(-2 * r)} 0`;

/**
 * `count` points scattered in a box, deterministic for a seed: Mitchell's best candidate (random, but no clumps).
 */
export function scatter(count, x, y, w, h, seed) {
  const rand = rng(seed);
  const pts = [];
  if (count <= 0 || w <= 0 || h <= 0) return pts;
  const cell = Math.max(0.5, Math.sqrt((w * h) / count));
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const grid = Array.from({ length: cols * rows }, () => []);
  const nearest = (px, py) => {
    const gx = Math.min(cols - 1, Math.floor((px - x) / cell));
    const gy = Math.min(rows - 1, Math.floor((py - y) / cell));
    let best = Infinity;
    for (let ring = 0; ring <= 3; ring++) {
      for (let i = gx - ring; i <= gx + ring; i++) {
        for (let j = gy - ring; j <= gy + ring; j++) {
          if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
          if (Math.max(Math.abs(i - gx), Math.abs(j - gy)) !== ring) continue;
          for (const [qx, qy] of grid[j * cols + i]) best = Math.min(best, (qx - px) ** 2 + (qy - py) ** 2);
        }
      }
      if (best < (ring * cell) ** 2) break;
    }
    return best;
  };
  for (let n = 0; n < count; n++) {
    let bx = 0;
    let by = 0;
    let bd = -1;
    for (let c = 0; c < 8; c++) {
      const px = x + rand() * w;
      const py = y + rand() * h;
      const dd = pts.length ? nearest(px, py) : Infinity;
      if (dd > bd) {
        bd = dd;
        bx = px;
        by = py;
      }
    }
    pts.push([bx, by]);
    const gx = Math.min(cols - 1, Math.floor((bx - x) / cell));
    const gy = Math.min(rows - 1, Math.floor((by - y) / cell));
    grid[gy * cols + gx].push([bx, by]);
  }
  return pts;
}

// ---- whole pages -----------------------------------------------------------------------------------------

/** A lined page (a sheet front, or the retro Helion): sections of ruled lines. */
export function renderLinedBody(svg, cx, fr, page) {
  const boxes = sectionBoxes(fr, page.sections.length);
  page.sections.forEach((s, i) => {
    const h = cx.plan.helions[s.d];
    const box = boxes[i];
    drawSectionHeader(svg, cx, fr, box, h, { badge: page.retro ? 'retrospection' : null });
    const reserve = drawRuled(svg, cx, fr, box, h, s.lines);
    drawMajors(svg, cx, fr, box, h, { reserveInner: Math.max(reserve, 4) });
    drawMargin(svg, cx, fr, box, h, marginBounds(fr, boxes, i));
  });
}

/** A canvas page (a sheet back, or a retro canvas): the same sections with canvases as bodies. */
export function renderCanvasBody(svg, cx, fr, page) {
  const boxes = sectionBoxes(fr, page.sections.length);
  const salt = page.retro ? (page.canvasIndex ?? 0) + 1 : 0;
  page.sections.forEach((s, i) => {
    const h = cx.plan.helions[s.d];
    const box = boxes[i];
    drawSectionHeader(svg, cx, fr, box, h, { badge: page.retro ? 'retrospection' : null });
    drawCanvas(svg, cx, fr, box, h, s.canvas, salt);
    drawMajors(svg, cx, fr, box, h, { reserveInner: 2 });
    drawMargin(svg, cx, fr, box, h, marginBounds(fr, boxes, i));
  });
}
