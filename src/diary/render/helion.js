/**
 * Helion sections: the body pages of the diary map Helions top to bottom, one section per Helion.
 *
 *   header   the number "34η" large (Helions are numbered 1..77 in their Nuclide), the stamp "δ#3 ε#2 34η", the
 *            Gregorian start–end (outer side)
 *   body     ruled lines (lined pages) or a canvas (grid, dots, dot-grid, lined, blank)
 *   margin   in the OUTER margin, along the body's time axis (frac 0 at the header rule, 1 at the section's last
 *            rule): the Helion's wave as two arcs of true circles (crest = positive, to the right; trough to the left,
 *            constant curvature like the library's half-arcs, as deep as the margin allows), a tick at every quarter threshold with the 2-stroke glyph of that state
 *            (4 peak, 8 node, 12 valley, 0 end) and its time, and a tick for every event at its exact fraction. Labels
 *            never overlap: they are laid out along the axis (with leaders when displaced) and shed detail when crowded.
 *   events   a threshold of Alpha … Delta and every event is a dashed rule across the body in its colour, said in words
 *            on the rule ("Delta Trifracton · Peak ends → Node · 14:02 · 20η 9ι 0λ", "○ Full Moon · 19:37 · 73η 6ι 0λ").
 */
import { SIZE, dodge, packedHeight, rng, seedOf, n2, measure } from './common.js';
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

/** The width the inner-edge line labels will take (before they are drawn): the widest label of the section. */
function labelReserve(cx, rowH, lines) {
  const mode = cx.opts.lined.labels;
  if (mode === 'none') return 0;
  const fs = Math.max(1.25, Math.min(SIZE.small, rowH * 0.62));
  const time = mode === 'both' && cx.greg ? measure('00:00', fs * 0.86, { font: cx.font }) + 1 : 0;
  return measure(lineLabel(lines - 1, lines), fs, { font: cx.font }) + time + 1.5;
}

// ---- the local sky ------------------------------------------------------------------------------------------

/**
 * Where the sky goes on a lined section: a vertical horizon at the middle of the writing area (the rules break there),
 * below the horizon to the left, above to the right, ±90° at ±half. Null without a sky.
 */
export function skyFrame(cx, fr, reserve) {
  if (!cx.plan.sky) return null;
  const left = fr.x0 + (fr.recto ? reserve : 0) + 1;
  const right = fr.x1 - (fr.recto ? 0 : reserve) - 1;
  const xh = (fr.x0 + fr.x1) / 2;
  const half = Math.max(4, Math.min(xh - left, right - xh) - 1);
  return { xh, half, gap: 1.8, x: (alt) => xh + Math.max(-1, Math.min(1, alt / 90)) * half };
}
/** The radius (mm) of the Sun and Moon marks: half the options' dot diameter. */
const skyR = (cx) => (cx.opts.sky?.dot ?? 1.1) / 2;
/** A Sun (filled) or Moon (ring) mark; `square` for a culmination. */
function skyDot(svg, cx, body, x, y, r = skyR(cx), square = false) {
  const sun = body === 'sun';
  const fill = sun ? cx.pal.family('solar') : '#ffffff';
  const o = sun ? {} : { stroke: cx.pal.ink2, sw: 0.2 };
  if (square) svg.rect(x - r, y - r, 2 * r, 2 * r, { fill, stroke: o.stroke, sw: o.sw });
  else svg.circle(x, y, r, fill, o);
}

/**
 * The sky on a lined section: on every odd rule the Sun, on every even rule the Moon, at their altitude at the rule's
 * moment. A rise or a set is a mark on the horizon (in the gap of the rules) at its exact moment, a culmination a square
 * at its altitude – no words: where they stand says what they are.
 */
export function drawSkyLines(svg, cx, fr, box, h, lines, sf) {
  const sky = cx.plan.sky;
  const bh = box.bodyBottom - box.bodyTop;
  const at = (j) => h.t0 + (j / lines) * (h.t1 - h.t0);
  for (let j = 1; j <= lines; j++) {
    const body = j % 2 ? 'sun' : 'moon';
    const alt = sky.altAt(body, Math.min(at(j), sky.t1));
    if (!Number.isFinite(alt)) continue;
    skyDot(svg, cx, body, sf.x(alt), box.bodyTop + (j / lines) * bh);
  }
  for (const e of sky.events) {
    if (e.t < h.t0 || e.t >= h.t1) continue;
    const y = box.bodyTop + ((e.t - h.t0) / (h.t1 - h.t0)) * bh;
    const transit = e.name === 'transit';
    skyDot(svg, cx, e.body, transit ? sf.x(e.alt) : sf.xh, y, skyR(cx) * 1.2, transit);
  }
}

/**
 * The sky beside a canvas section, in the INNER margin (the wave is in the outer one): the horizon as a vertical line,
 * the Sun's altitude as a solid curve and the Moon's dotted, over the Helion from top to bottom (below the horizon
 * towards the left, above towards the right).
 */
export function drawSkyTrack(svg, cx, fr, box, h) {
  const sky = cx.plan.sky;
  if (!sky) return;
  const { pal } = cx;
  const band = fr.m.inner - 4.5;
  if (band < 4) return;
  const xh = fr.recto ? fr.inner - 1.2 - band / 2 : fr.inner + 1.2 + band / 2;
  const half = band / 2 - 0.3;
  const X = (alt) => xh + Math.max(-1, Math.min(1, alt / 90)) * half;
  const top = box.bodyTop;
  const bot = box.bodyBottom;
  svg.line(xh, top, xh, bot, pal.ruleStrong, 0.15);
  const N = 72;
  for (const body of ['sun', 'moon']) {
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = Math.min(h.t0 + (i / N) * (h.t1 - h.t0), sky.t1);
      const alt = sky.altAt(body, t);
      if (Number.isFinite(alt)) pts.push(`${n2(X(alt))} ${n2(top + (i / N) * (bot - top))}`);
    }
    if (pts.length > 1) {
      const d = `M${pts.join('L')}`;
      if (body === 'sun') svg.path(d, { stroke: pal.family('solar'), sw: 0.3 });
      else svg.path(d, { stroke: pal.ink2, sw: 0.25, dash: '0.25 0.6', cap: 'round' });
    }
  }
}

/** Ruled lines of a lined section; returns the width reserved by the labels at the inner edge. */
export function drawRuled(svg, cx, fr, box, h, lines) {
  const { pal, opts } = cx;
  const bh = box.bodyBottom - box.bodyTop;
  const rowH = bh / lines;
  const d = [];
  const dq = [];
  // with a sky, every rule breaks at the horizon so that the gaps line up into a vertical line
  const sf = skyFrame(cx, fr, labelReserve(cx, rowH, lines));
  for (let k = 1; k <= lines; k++) {
    const y = n2(box.bodyTop + k * rowH);
    const seg = sf ? `M${n2(fr.x0)} ${y}H${n2(sf.xh - sf.gap / 2)}M${n2(sf.xh + sf.gap / 2)} ${y}H${n2(fr.x1)}` : `M${n2(fr.x0)} ${y}H${n2(fr.x1)}`;
    (isQuarter(k / lines) ? dq : d).push(seg);
  }
  if (d.length) svg.path(d.join(''), { stroke: pal.rule, sw: 0.15 });
  if (dq.length) svg.path(dq.join(''), { stroke: pal.ruleStrong, sw: 0.17 });
  if (sf) drawSkyLines(svg, cx, fr, box, h, lines, sf);
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

/**
 * Thresholds of Alpha … Delta and every event (lunar, solar, planets, syncs) as a dashed rule across the body at its
 * moment, said in words on the rule at the outer side: "Delta Trifracton · Peak ends → Node · 14:02 · 20η 9ι 0λ",
 * "○ Full Moon · 19:37 · 73η 6ι 0λ". Rules at the same instant share one rule and stack their labels; a label that
 * would touch another moves to the other side of its rule or further out. `skip(e)`: events to leave out.
 */
export function drawMajors(svg, cx, fr, box, h, { reserveInner = 14, skip = null } = {}) {
  const { pal } = cx;
  const size = 1.8;
  const lh = size * 1.25;
  const groups = [];
  for (const e of h.events) {
    if (skip?.(e)) continue;
    const g = groups.find((x) => Math.abs(x[0].frac - e.frac) < 1e-7);
    if (g) g.push(e);
    else groups.push([e]);
  }
  groups.sort((a, b) => a[0].frac - b[0].frac);
  const order = (e) => (e.family === 'major' ? e.major.level : 10);
  const placed = []; // baselines in use
  const free = (yb) => yb - size * 0.8 >= box.bodyTop + 0.2 && yb + 0.4 <= box.bodyBottom + 1.5 && placed.every((p) => Math.abs(p - yb) >= lh);
  for (const g of groups) {
    g.sort((a, b) => order(a) - order(b));
    const e0 = g[0];
    const y = yOf(box, e0.frac);
    const major = e0.family === 'major';
    const color = major ? pal.level(e0.major.level) : cx.familyColor(e0);
    // the rule leaves the line labels at the inner edge readable
    const ra = fr.recto ? fr.x0 + reserveInner : fr.x0;
    const rb = fr.recto ? fr.x1 : fr.x1 - reserveInner;
    svg.line(ra, y, rb, y, color, major ? 0.26 : 0.22, { 'stroke-dasharray': major ? '1.4 0.9' : '0.9 0.7' });
    const tail = (e) => [cx.greg ? cx.gTime(e.t) : null, cx.fClock(e.t)].filter(Boolean).join(' · ');
    const words = (e) => (e.family === 'major' ? cx.majorWords(e.major) : `${cx.eventSymbol(e)} ${cx.eventName(e)}${e.family === 'sync' && cx.driftText(e) ? ` · drift ${cx.driftText(e)}` : ''}`);
    // the finest level sits next to the rule; the time goes on the label nearest to it
    g.forEach((e, i) => {
      const text = i === 0 ? `${words(e)} · ${tail(e)}` : words(e);
      const above = [y - 0.8 - i * lh, y + size + 0.5 + i * lh];
      let yb = above.find(free);
      for (let k = 1; yb === undefined && k < 8; k++) yb = [y - 0.8 - (i + k) * lh, y + size + 0.5 + (i + k) * lh].find(free);
      if (yb === undefined) yb = y - 0.8;
      placed.push(yb);
      // a paper-white backing: the label stays clear of other rules that pass under it
      const maxW = fr.cw - reserveInner - 1.2;
      const w = Math.min(measure(text, size, { weight: 600, font: cx.font }), maxW);
      const xo = fr.outer - fr.dir * 0.6;
      svg.rect(fr.recto ? xo - w - 0.5 : xo - 0.5, yb - size * 0.88, w + 1, size * 1.2, { fill: '#ffffff' });
      svg.text(xo, yb, text, {
        size,
        weight: 600,
        fill: e.family === 'major' ? pal.level(e.major.level) : cx.familyColor(e),
        anchor: fr.outerAnchor,
        maxW,
        min: 1.45,
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
    fs = level >= 3 ? 1.45 : 1.6;
    labels = [];
    for (const tk of ticks) {
      const text = level >= 4 ? null : cx.greg ? cx.gTime(tk.t) : pureTick(h, tk.name);
      if (!glyphs && !text) continue;
      const hgt = glyphs ? glyphH : fs * 1.25;
      labels.push({ type: 'q', tk, anchor: yOf(box, tk.frac), text, h: hgt, want: yOf(box, tk.frac) - hgt / 2 });
    }
    // the events are said on their rules across the body (drawMajors); the margin keeps only their ticks
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
    const cyl = l.y + l.h / 2;
    let x = glyphX - (glyphs ? 0 : 1.1 * k);
    if (Math.abs(cyl - l.anchor) > 0.9) svg.line(X(railEnd), l.anchor, X(x - 1.1 * k), cyl, pal.ink4, 0.12);
    if (glyphs) {
      svg.glyph(QUARTER_GLYPH[l.tk.name], X(glyphX), cyl, glyphH, helionColor, 0.2);
      x = glyphX + 1.45 * k;
    }
    if (l.text) svg.text(X(x), cyl + fs * 0.36, l.text, { size: fs, fill: pal.ink2, anchor, maxW: usable - x, min: 1.4 });
  }
}

// ---- canvases ----------------------------------------------------------------------------------------------

/**
 * The body of a canvas section. `salt` separates two canvases of the same Helion (the retro pages).
 */
export function drawCanvas(svg, cx, fr, box, h, canvas, salt = 0) {
  const { pal } = cx;
  if (canvas.type === 'nuclide-grid') return drawNuclideGrid(svg, cx, fr, box, h);
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

/** Event families that the ephemeris lists (the grid shows their marks). */
const ASTRO_FAMILIES = new Set(['synodic', 'anomalistic', 'draconic', 'sidereal', 'solar', 'lunistice', 'cross-quarter', 'eclipse', 'planet']);

/**
 * The Nuclide's 77 Helions as a 7 × 11 grid to mark each one: a column per ζ (11 Helions), numbered 1…77 down the
 * columns in the top-left corner of each cell. Cells of Semi-pentads are tinted, the 77th Helion (this page) outlined;
 * the bottom-right corner carries the symbols of the Helion's ephemeris events in their family colours.
 */
export function drawNuclideGrid(svg, cx, fr, box, h) {
  const { pal, plan } = cx;
  const pad = 1.4;
  const w = fr.cw;
  const hh = box.bodyBottom - box.bodyTop - pad;
  const cols = 7;
  const rows = 11;
  const cell = Math.min(w / cols, hh / rows);
  if (cell < 3) return;
  const gw = cell * cols;
  const gh = cell * rows;
  const ox = fr.x0 + (w - gw) / 2;
  const oy = box.bodyTop + pad + (hh - gh) / 2;
  const base = h.n * 77;
  const numSize = Math.min(1.7, cell * 0.16);
  const markSize = Math.min(2, cell * 0.2);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const k = c * rows + r;
      const hx = plan.helions[base + k];
      if (!hx) continue;
      const x = ox + c * cell;
      const y = oy + r * cell;
      const page = plan.pages[(hx.page ?? 1) - 1];
      if (page?.unit === 'semi') svg.rect(x, y, cell, cell, { fill: pal.levelSoft(2) });
      if (hx.d === h.d) svg.rect(x + 0.3, y + 0.3, cell - 0.6, cell - 0.6, { stroke: pal.level(4), sw: 0.35 });
      svg.text(x + 0.7, y + numSize + 0.5, hx.label, { size: numSize, fill: page?.unit === 'semi' ? pal.level(2) : pal.ink3 });
      const marks = hx.events.filter((e) => ASTRO_FAMILIES.has(e.family));
      if (marks.length) {
        svg.runs(
          x + cell - 0.6,
          y + cell - 0.7,
          marks.map((e, i) => ({ text: cx.eventSymbol(e), size: markSize, fill: cx.familyColor(e), gap: i ? 0.3 : 0 })),
          { anchor: 'end', maxW: cell - 1.2, minScale: 0.6 },
        );
      }
    }
  }
  const d = [];
  for (let c = 1; c < cols; c++) d.push(`M${n2(ox + c * cell)} ${n2(oy)}V${n2(oy + gh)}`);
  for (let r = 1; r < rows; r++) d.push(`M${n2(ox)} ${n2(oy + r * cell)}H${n2(ox + gw)}`);
  svg.path(d.join(''), { stroke: pal.rule, sw: 0.15 });
  svg.rect(ox, oy, gw, gh, { stroke: pal.ruleStrong, sw: 0.22 });
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

const badgeOf = (page) => (page.retro ? 'retrospection' : page.unit === 'semi' ? 'semi-pentad' : null);

/** A lined page (a sheet front, or the retro Helion): sections of ruled lines. */
export function renderLinedBody(svg, cx, fr, page) {
  const boxes = sectionBoxes(fr, page.sections.length);
  page.sections.forEach((s, i) => {
    const h = cx.plan.helions[s.d];
    const box = boxes[i];
    drawSectionHeader(svg, cx, fr, box, h, { badge: badgeOf(page) });
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
    drawSectionHeader(svg, cx, fr, box, h, { badge: badgeOf(page) });
    drawCanvas(svg, cx, fr, box, h, s.canvas, salt);
    drawSkyTrack(svg, cx, fr, box, h);
    // the Nuclide grid carries the events of all its Helions; the 77th's own are said on its lined page
    if (s.canvas.type !== 'nuclide-grid') drawMajors(svg, cx, fr, box, h, { reserveInner: 2 });
    drawMargin(svg, cx, fr, box, h, marginBounds(fr, boxes, i));
  });
}
