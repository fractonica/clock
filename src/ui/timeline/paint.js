/**
 * Timeline painter: stateless canvas drawing. `paint(S)` draws one frame from a scene object `S`
 * built by timeline.js (window, layout, cursor, hover, data caches, colours, fonts).
 * Coordinates are CSS pixels; the context is already scaled by the device pixel ratio.
 * Interactive things drawn here (chips) register themselves in `S.regions` for hit-testing.
 */
import { lastStartAtOrBefore, eclipseLabelStride, depthHeadVariants, turnoverTip } from './helpers.js';
import { drawPentadMark } from '../pentad.js';
import { MARK_RE, splitMarks, bandLabels } from './pentads.js';

// ---- small drawing utilities ------------------------------------------------------------------
const twCache = new Map();
function tw(g, font, text) {
  const key = font + '|' + text;
  let w = twCache.get(key);
  if (w === undefined) {
    g.font = font;
    w = g.measureText(text).width;
    if (twCache.size > 6000) twCache.clear();
    twCache.set(key, w);
  }
  return w;
}
function text(g, s, x, y, font, color, align = 'left') {
  g.font = font;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}
/**
 * Labels that lead with a Pentad (timeline/pentads.js): a private-use character in the string stands for the mark,
 * drawn as the shape + numeral (src/ui/pentad.js) at the size of the text around it.
 */
const fontPx = (font) => Number(/([\d.]+)px/.exec(font)?.[1] ?? 11);
const markSize = (font) => Math.round(fontPx(font) * 1.9) / 2; // ≈ 0.95 em, on half pixels
const mwCache = new Map();
function markW(g, font, m) {
  const key = `${font}|${m.index}|${m.numeral}`;
  let w = mwCache.get(key);
  if (w === undefined) {
    w = drawPentadMark(g, m.index, 0, 0, { size: markSize(font), font, numeral: m.numeral, measure: true });
    if (mwCache.size > 400) mwCache.clear();
    mwCache.set(key, w);
  }
  return w;
}
/** Width of a label that may hold Pentad marks. */
function rw(g, font, s) {
  if (!MARK_RE.test(s)) return tw(g, font, s);
  let w = 0;
  for (const r of splitMarks(s)) w += r.mark ? markW(g, font, r.mark) : tw(g, font, r.text);
  return w;
}
/** Draw a label that may hold Pentad marks; `markColor` paints the marks (default: the text colour). */
function rtext(g, s, x, y, font, color, align = 'left', markColor = color) {
  if (!MARK_RE.test(s)) return text(g, s, x, y, font, color, align);
  const w = rw(g, font, s);
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  for (const r of splitMarks(s)) {
    if (r.mark) {
      drawPentadMark(g, r.mark.index, cx, y, { size: markSize(font), font, numeral: r.mark.numeral, color: markColor });
      cx += markW(g, font, r.mark);
    } else {
      text(g, r.text, cx, y, font, color);
      cx += tw(g, font, r.text);
    }
  }
}
/**
 * A pure-mode count tick ("5θ", "17ι"): the number in `color`, the unit symbol in `symColor` (the unit's lane colour).
 * At 11 px a mono θ is hard to tell from a 0 ("0θ" reads "00"); the colour keeps the two apart. Anything that is not
 * a count (an ordinal "ζ#5") is drawn as one piece.
 */
function countText(g, s, x, y, font, color, symColor) {
  const m = symColor ? /^(\d+)(\p{L})$/u.exec(s) : null;
  if (!m) return text(g, s, x, y, font, color);
  text(g, m[1], x, y, font, color);
  text(g, m[2], x + tw(g, font, m[1]), y, font, symColor);
}
/** Longest variant that fits in `room` px (or null). */
function fit(g, font, variants, room) {
  for (const v of variants) if (v && rw(g, font, v) <= room) return v;
  return null;
}
function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
const clampX = (x, a, b) => Math.min(b, Math.max(a, x));
const MUTED = 'rgba(139,153,168,1)'; // small canvas text: >= 4.5:1 on the dark lane background (the token --ink-3 is a touch lower)

const hatchCache = new Map();
/** Diagonal-stripe pattern in `color` (a CSS colour), crisp at any device pixel ratio. */
function hatch(g, color, dpr, gap = 7) {
  const key = `${color}|${dpr}|${gap}`;
  let p = hatchCache.get(key);
  if (!p) {
    const size = Math.round(gap * dpr);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const h = c.getContext('2d');
    h.strokeStyle = color;
    h.lineWidth = Math.max(1, dpr);
    h.beginPath();
    h.moveTo(-1, size + 1);
    h.lineTo(size + 1, -1);
    h.moveTo(-1 - size / 2, size / 2 + 1);
    h.lineTo(size / 2 + 1, -size / 2 - 1);
    h.moveTo(size / 2 - 1, size + size / 2 + 1);
    h.lineTo(size + size / 2 + 1, size / 2 - 1);
    h.stroke();
    p = g.createPattern(c, 'repeat');
    p.setTransform(new DOMMatrix().scale(1 / dpr));
    hatchCache.set(key, p);
  }
  return p;
}

const styleCache = new Map();
/** Per-level colour strings, built once. */
function laneStyle(theme, level) {
  let s = styleCache.get(level);
  if (!s) {
    const c = theme.levelColor;
    s = {
      fillA: c(level, 0.2, 58),
      fillB: c(level, 0.09, 58),
      fillCur: c(level, 0.34, 62),
      line: c(level, 0.5, 64),
      lineStrong: c(level, 0.95, 68),
      text: c(level, 1, 80),
      textDim: c(level, 0.85, 72),
      wave: c(level, 0.55, 72),
      hatch: c(level, 0.35, 60),
      cur: c(level, 1, 72),
      solid: c(level, 1, 64),
      tint: c(level, 0.075, 60),
    };
    styleCache.set(level, s);
  }
  return s;
}

// ---- main entry ----------------------------------------------------------------------------------
export function paint(S) {
  const { g } = S;
  g.clearRect(0, 0, S.W, S.H);
  S.regions.length = 0;
  S.selChip = planSelChip(S);
  paintOverview(S);
  paintLaneBackdrop(S);
  for (let i = 0; i < S.levels.length; i++) paintLane(S, i);
  paintEclipseLane(S);
  paintOutOfRange(S);
  paintAxis(S);
  paintMarkers(S);
  paintGutters(S);
  paintChips(S);
}

// ---- overview ------------------------------------------------------------------------------------
function paintOverview(S) {
  const { g, L, lim, data, theme, fonts, dpr } = S;
  const y = L.overview.y;
  const h = L.overview.h;
  const x0 = L.px0;
  const x1 = L.px1;
  const w = x1 - x0;
  const dx = (t) => x0 + ((t - lim.d0) / (lim.d1 - lim.d0)) * w;
  const bandH = L.compact ? 17 : 21;

  g.save();
  roundRect(g, x0, y, w, h, 7);
  g.fillStyle = 'rgba(255,255,255,0.03)';
  g.fill();
  g.clip();

  // outside the catalogue
  const a = dx(lim.tMin);
  const b = dx(lim.tMax);
  g.fillStyle = hatch(g, 'rgba(163,177,191,0.16)', dpr, 6);
  g.fillRect(x0, y, a - x0, h);
  g.fillRect(b, y, x1 - b, h);

  // alpha cycles
  const f9 = fonts.ui(600, 9.5);
  for (const al of data.alpha) {
    const ax0 = dx(al.start);
    const ax1 = dx(al.end);
    g.fillStyle = al.idx % 2 ? theme.levelColor(0, 0.1, 60) : theme.levelColor(0, 0.22, 60);
    g.fillRect(ax0, y + 2, Math.max(0, ax1 - ax0), bandH);
    const lab = fit(g, f9, S.isPure ? [`α#${al.idx + 1}`, `#${al.idx + 1}`] : [`α${al.idx + 1}`], ax1 - ax0 - 4);
    if (lab) text(g, lab, (ax0 + ax1) / 2, y + 2 + bandH / 2 + 0.5, f9, theme.levelColor(0, 0.95, 80), 'center');
  }
  // the 70 eclipses
  g.fillStyle = 'rgba(79,209,197,0.75)';
  for (let i = 0; i < data.eclipses.length; i++) {
    const ex = dx(data.eclipses[i]);
    g.fillRect(Math.round(ex * dpr) / dpr, y + 2 + bandH, 1, 4);
  }
  // century labels
  const f8 = fonts.mono(400, 9);
  const ticks = S.isPure ? data.overviewMarks() : data.overviewTicks(); // pure: eclipse numbers instead of centuries
  let lastX = -1e9;
  for (const tk of ticks) {
    if (tk.t < lim.d0 || tk.t > lim.d1) continue;
    const tx = dx(tk.t);
    const lab = tk.labels[0];
    const wd = tw(g, f8, lab);
    if (tx - wd / 2 < x0 + 2 || tx + wd / 2 > x1 - 2 || tx - lastX < wd + 10) continue;
    lastX = tx;
    text(g, lab, tx, y + h - 6, f8, 'rgba(163,177,191,0.8)', 'center');
  }
  g.restore();

  // visible window
  const wx0 = dx(S.t0);
  const wx1 = dx(S.t1);
  const rx0 = clampX(wx0, x0, x1);
  const rx1 = clampX(wx1, x0, x1);
  const rw = Math.max(5, rx1 - rx0);
  S.ovRect = { x: rx0, w: rw };
  g.fillStyle = 'rgba(79,209,197,0.14)';
  g.fillRect(rx0, y + 1, rw, h - 2);
  g.strokeStyle = theme.TEAL;
  g.lineWidth = 1.5;
  roundRect(g, rx0 + 0.75, y + 1.75, rw - 1.5, h - 3.5, 4);
  g.stroke();

  // markers
  if (S.nowShow && Math.abs(S.nowT - S.cursorT) > 1e-3) overviewMark(S, dx(S.nowT), theme.NOW, y, h);
  if (S.cursorIn || S.live) overviewMark(S, dx(S.live ? S.nowT : S.cursorT), S.live ? theme.NOW : theme.CURSOR, y, h);

  // outline
  g.strokeStyle = 'rgba(255,255,255,0.07)';
  g.lineWidth = 1;
  roundRect(g, x0 + 0.5, y + 0.5, w - 1, h - 1, 7);
  g.stroke();
}
function overviewMark(S, x, color, y, h) {
  const { g, L } = S;
  if (x < L.px0 - 1 || x > L.px1 + 1) return;
  g.fillStyle = color;
  g.fillRect(Math.round(x * S.dpr) / S.dpr - 0.5, y + 1, 1.5, h - 2);
  g.beginPath();
  g.moveTo(x - 3, y - 0.5);
  g.lineTo(x + 3, y - 0.5);
  g.lineTo(x, y + 4);
  g.closePath();
  g.fill();
}

// ---- lane backdrop: tints, weekends, grid ---------------------------------------------------------
function paintLaneBackdrop(S) {
  const { g, L, X, t0, t1, data } = S;
  const top = L.lanesY;
  const bottom = L.bottom;
  const px0 = L.px0;
  const w = L.px1 - px0;
  // lane bands
  for (let i = 0; i < S.levels.length; i++) {
    const y = top + i * L.laneH;
    const sel = S.levels[i] === S.selected;
    g.fillStyle = sel ? laneStyle(S.theme, S.levels[i]).tint : 'rgba(255,255,255,0.022)';
    g.fillRect(px0, y + 1, w, L.laneH - 2);
  }
  g.fillStyle = 'rgba(255,255,255,0.022)';
  g.fillRect(px0, L.eclipse.y + 1, w, L.eclipse.h - 2);

  g.save();
  g.beginPath();
  g.rect(px0, S.L.axis.y, w, bottom - S.L.axis.y);
  g.clip();
  // weekends (only when a day is wide enough to read)
  if (!S.isPure && S.k * 86400 >= 7 && S.span < 200 * 86400) {
    g.fillStyle = 'rgba(138,180,255,0.045)';
    for (const s of data.weekendsFor(t0, t1)) {
      const a = X(s.t0);
      const b = X(s.t1);
      if (b < px0 || a > L.px1) continue;
      g.fillRect(Math.max(a, px0), L.axis.y + L.axis.ctxH, b - a, bottom - L.axis.y - L.axis.ctxH);
    }
  }
  // gridlines from the labelled step
  const ticks = data.ticksFor(S.step, t0, t1);
  for (const tk of ticks) {
    const x = X(tk.t);
    if (x < px0 || x > L.px1) continue;
    g.fillStyle = tk.major ? 'rgba(163,177,191,0.16)' : 'rgba(163,177,191,0.08)';
    g.fillRect(Math.round(x * S.dpr) / S.dpr, top, 1, bottom - top);
  }
  g.restore();
}

// ---- lanes ---------------------------------------------------------------------------------------
function paintLane(S, i) {
  const { g, L, X, t0, t1, k, model, data, theme, fonts } = S;
  const level = S.levels[i];
  const info = model.levelInfo(level);
  const st = laneStyle(theme, level);
  const y = L.lanesY + i * L.laneH;
  const h = L.laneH;
  const px0 = L.px0;
  const px1 = L.px1;
  const plotW = px1 - px0;
  const meanPx = info.meanSeconds * k;
  const hover = S.hover && S.hover.lane === i;
  if (hover) {
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(px0, y + 1, plotW, h - 2);
  }

  g.save();
  g.beginPath();
  g.rect(px0, y, plotW, h);
  g.clip();

  const cur = S.cursorIn ? data.cycleAt(level, S.cursorT) : null;
  const sib = info.siblings ?? data.alpha.length;
  const font = fonts.ui(600, 11);
  const fontSm = fonts.ui(500, 10);

  if (meanPx < 3) {
    // too dense: hatch plus the current cycle as a hairline marker
    g.fillStyle = hatch(g, st.hatch, S.dpr, 5);
    g.fillRect(px0, y + 3, plotW, h - 6);
    if (cur) {
      const a = X(cur.start);
      const b = X(cur.end);
      const cx = clampX(a, px0, px1);
      const cw = Math.max(2.5, clampX(b, px0, px1) - cx);
      g.fillStyle = st.cur;
      g.fillRect(cx, y + 2, cw, h - 4);
    }
    const msg = S.isPure ? S.words.denseMsg(level) : `${data.lengthLabel(level)} cycles · zoom in`;
    const mw = tw(g, fontSm, msg);
    const mx = Math.min(Math.max(px0, X(model.tMin)) + 8, px1 - mw - 20);
    if (mx > px0 && X(model.tMax) - mx > mw + 14) {
      roundRect(g, mx, y + h / 2 - 8, mw + 12, 16, 8);
      g.fillStyle = 'rgba(10,14,19,0.82)';
      g.fill();
      text(g, msg, mx + 6, y + h / 2 + 0.5, fontSm, 'rgba(163,177,191,0.95)');
    }
    g.restore();
    return;
  }

  const blocks = data.blocksFor(level, t0, t1);
  let n = lastStartAtOrBefore(blocks, t0);
  if (n < 0) n = 0;
  const showWave = h >= 26;
  // a "◂ ε ends …" chip sits on the left edge of the selected lane: block labels start after it
  const reserve = S.selChip && !S.selChip.right && level === S.selected ? S.selChip.w + 14 : 0;
  for (; n < blocks.length; n++) {
    const b = blocks[n];
    if (b.start > t1) break;
    const x0 = X(b.start);
    const x1 = X(b.end);
    if (x1 < px0) continue;
    const cx0 = Math.max(x0, px0);
    const cx1 = Math.min(x1, px1);
    const w = x1 - x0;
    const isCur = cur && cur.idx === b.idx;
    g.fillStyle = isCur ? st.fillCur : b.idx % 2 ? st.fillB : st.fillA;
    g.fillRect(cx0, y + 1.5, cx1 - cx0, h - 3);
    if (w >= 6 && x0 >= px0) {
      const parent = level === 0 || b.local === 0;
      g.fillStyle = parent ? st.lineStrong : st.line;
      const lx = Math.round(x0 * S.dpr) / S.dpr;
      g.fillRect(lx, y + 1.5, parent ? 1.5 : 1, h - 3);
    }
    if (w >= 80 && showWave && (isCur || w <= plotW * 6)) paintWave(S, level, b, st, y, h, x0, x1, cx0, cx1, isCur);
    if (isCur) {
      // outline: top and bottom always, the sides only where the cycle really begins / ends on screen
      g.strokeStyle = st.cur;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx0, y + 2.25);
      g.lineTo(cx1, y + 2.25);
      g.moveTo(cx0, y + h - 2.25);
      g.lineTo(cx1, y + h - 2.25);
      if (x0 >= px0) {
        g.moveTo(cx0 + 0.75, y + 2.25);
        g.lineTo(cx0 + 0.75, y + h - 2.25);
      }
      if (x1 <= px1) {
        g.moveTo(cx1 - 0.75, y + 2.25);
        g.lineTo(cx1 - 0.75, y + h - 2.25);
      }
      g.stroke();
    }
    if (w >= 14) {
      const n1 = b.local + 1;
      let variants = [];
      if (S.isPure) {
        // a major period says the quarter the cursor is in (its phase is never drawn in pure mode)
        const quarter = isCur && S.pure.isMajor(level) ? S.pure.QUARTER_WORDS[S.pure.quarterAt(S.cursorT, level)] : null;
        variants = S.words.blockLabels({ level, local: b.local, idx: b.idx, sib, wide: w > plotW * 0.45, w, endsWithCatalogue: b.end >= model.tMax - 1e-3, quarter });
      } else {
        // the end is a date: it leads with its Pentad ("ends ⬠III Sat 17 Oct 2026")
        if (w > plotW * 0.45) variants.push(`${info.letter} ${info.depth} · ${n1}/${sib} · ends ${S.pentads.lead(b.end, data.endLabel(level, b.idx, b.end, S.refYear))}`);
        if (w >= 120) variants.push(`${info.letter} ${info.depth} · ${n1}/${sib}`);
        if (w >= 40) variants.push(`${info.letter}${n1}`);
        variants.push(String(n1));
      }
      const vis = cx1 - Math.max(cx0, px0 + reserve);
      const lab = fit(g, font, variants, vis - (w < 30 ? 4 : 10));
      if (lab) {
        const lw = rw(g, font, lab);
        let tx = Math.max(x0, px0 + reserve) + (w < 30 ? 3 : 6);
        if (tx + lw > x1 - 2) tx = x1 - 2 - lw; // pushed by the next block, like a sticky header
        if (tx >= cx0 + 1) {
          const ty = y + (showWave && w >= 80 ? Math.min(11, h * 0.36) : h / 2) + 0.5;
          if (showWave && w >= 80) {
            roundRect(g, tx - 3, ty - 7.5, lw + 6, 15, 5);
            g.fillStyle = 'rgba(10,14,19,0.42)';
            g.fill();
          }
          rtext(g, lab, tx, ty, font, isCur ? st.cur : st.text);
        }
      }
    }
  }
  g.restore();
}

/** Triangle wave of one cycle: 0 -> peak (1/4) -> valley (3/4) -> 0, plus quarter ticks. */
function paintWave(S, level, b, st, y, h, x0, x1, cx0, cx1, isCur) {
  const { g, data } = S;
  const q1 = S.X(data.quarterTime(level, b.idx, 1));
  const q2 = S.X(data.quarterTime(level, b.idx, 2));
  const q3 = S.X(data.quarterTime(level, b.idx, 3));
  const mid = y + h * 0.64;
  const A = h * 0.2;
  const pts = [
    [x0, mid],
    [q1, mid - A],
    [q3, mid + A],
    [x1, mid],
  ];
  g.beginPath();
  let started = false;
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    if (!(bx - ax > 1e-6) || bx < cx0 || ax > cx1) continue; // degenerate when the catalogue ends inside the cycle
    const sa = Math.max(ax, cx0);
    const sb = Math.min(bx, cx1);
    const ya = ay + ((by - ay) * (sa - ax)) / (bx - ax);
    const yb = ay + ((by - ay) * (sb - ax)) / (bx - ax);
    if (!started) {
      g.moveTo(sa, ya);
      started = true;
    }
    g.lineTo(sb, yb);
  }
  g.strokeStyle = st.wave;
  g.lineWidth = 1.2;
  g.lineJoin = 'round';
  g.stroke();
  // where the cursor sits on the wave of its own cycle
  if (isCur && S.cursorIn) {
    const cx = S.X(S.cursorT);
    if (cx > cx0 && cx < cx1) {
      let cy = mid;
      for (let i = 0; i < 3; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        if (bx - ax > 1e-6 && cx >= ax && cx <= bx) {
          cy = ay + ((by - ay) * (cx - ax)) / (bx - ax);
          break;
        }
      }
      g.beginPath();
      g.arc(cx, cy, 3.2, 0, Math.PI * 2);
      g.fillStyle = st.cur;
      g.fill();
      g.strokeStyle = 'rgba(7,9,13,0.9)';
      g.lineWidth = 1.2;
      g.stroke();
    }
  }
  // quarter ticks along the lane bottom; the node (2/4) is the tallest
  g.fillStyle = st.textDim;
  const bottom = y + h - 1.5;
  for (const [qx, tall] of [[q1, 4], [q2, 6], [q3, 4]]) {
    if (qx > cx0 && qx < cx1 && qx < x1 - 0.5) g.fillRect(Math.round(qx * S.dpr) / S.dpr, bottom - tall, 1, tall);
  }
  // pure mode, a major period: its four quarters in words, each centred on its stretch (named by the threshold that ends it)
  if (S.isPure && S.pure.isMajor(level)) {
    if (x1 - x0 >= 160 && h >= 30) {
      const f = S.fonts.ui(500, 9.5);
      const qs = [[x0, q1], [q1, q2], [q2, q3], [q3, x1]];
      qs.forEach(([a, b], i) => {
        const word = S.pure.QUARTER_WORDS[i];
        const cx = (a + b) / 2;
        if (b - a >= tw(g, f, word) + 10 && cx > cx0 + 14 && cx < cx1 - 14) text(g, word, cx, bottom - 11, f, st.textDim, 'center');
      });
    }
    return;
  }
  // names when there is plenty of room
  if (x1 - x0 >= 320 && h >= 30) {
    const f = S.fonts.ui(500, 9.5);
    for (const [qx, name] of [[q1, 'peak'], [q2, 'node'], [q3, 'valley']]) {
      if (qx > cx0 + 14 && qx < cx1 - 14) text(g, name, qx, bottom - 11, f, st.textDim, 'center');
    }
  }
}

// ---- eclipse lane ----------------------------------------------------------------------------------
function paintEclipseLane(S) {
  const { g, L, X, t0, t1, data, theme, fonts, model, fmt } = S;
  const y = L.eclipse.y;
  const h = L.eclipse.h;
  const px0 = L.px0;
  const px1 = L.px1;
  const E = data.eclipses;
  const base = y + h * 0.4;

  g.save();
  g.beginPath();
  g.rect(px0, y, px1 - px0, h);
  g.clip();
  g.fillStyle = 'rgba(163,177,191,0.22)';
  g.fillRect(px0, Math.round(base), px1 - px0, 1);

  // the Saros interval that holds the cursor
  if (S.cursorIn) {
    const loc = model.locate(S.cursorT);
    if (loc && loc.k < E.length - 1) {
      const a = X(E[loc.k]);
      const b = X(E[loc.k + 1]);
      g.fillStyle = 'rgba(79,209,197,0.55)';
      g.fillRect(clampX(a, px0, px1), Math.round(base) - 1, Math.max(1.5, clampX(b, px0, px1) - clampX(a, px0, px1)), 3);
    }
  }

  const sarosPx = model.meanSaros * S.k;
  const stride = S.isPure ? eclipseLabelStride(sarosPx, 34) : eclipseLabelStride(sarosPx); // "#23" is much shorter than a date
  const f = fonts.mono(400, 9.5);
  const fb = fonts.mono(600, 9.5);
  let visible = 0;
  for (let i = 0; i < E.length; i++) {
    const x = X(E[i]);
    if (x < px0 - 40) continue;
    if (x > px1 + 40) break;
    if (x >= px0 && x <= px1) visible++;
    const alpha = i % 4 === 0;
    const hov = S.hoverEclipse === i;
    const r = (alpha ? 5 : 3.4) + (hov ? 1.5 : 0);
    g.beginPath();
    if (alpha) {
      g.moveTo(x, base - r);
      g.lineTo(x + r, base);
      g.lineTo(x, base + r);
      g.lineTo(x - r, base);
      g.closePath();
    } else g.arc(x, base, r, 0, Math.PI * 2);
    g.fillStyle = alpha ? theme.levelColor(0, 1, 70) : theme.TEAL;
    g.fill();
    g.strokeStyle = 'rgba(7,9,13,0.9)';
    g.lineWidth = 1;
    g.stroke();
    if (i % stride === 0 || hov) {
      const lab = S.isPure ? S.words.eclipseLabel(i) : fmt.date(E[i]);
      const lw = tw(g, alpha ? fb : f, lab);
      if (x - lw / 2 > px0 + 2 && x + lw / 2 < px1 - 2) text(g, lab, x, y + h * 0.82, alpha ? fb : f, alpha ? 'rgba(231,237,243,0.9)' : 'rgba(163,177,191,0.85)', 'center');
    }
  }
  g.restore();

  // nothing in view: point at the nearest eclipses on either side
  if (visible === 0) {
    const prev = E.findLastIndex((e) => e < t0);
    const next = E.findIndex((e) => e > t1);
    const cy = base;
    const pu = S.isPure;
    if (prev >= 0) chip(S, pu ? S.words.eclipseChip(prev, false) : `◂ ${S.pentads.lead(E[prev], fmt.date(E[prev]))}`, px0 + 8, cy, { align: 'left', color: theme.TEAL, tip: pu ? S.words.eclipseChipTip(prev, false) : 'Previous greatest eclipse of Saros 141 – click to bring it into view', onClick: () => S.actions.reveal(E[prev], 'left') });
    if (next >= 0) chip(S, pu ? S.words.eclipseChip(next, true) : `${S.pentads.lead(E[next], fmt.date(E[next]))} ▸`, px1 - 8, cy, { align: 'right', color: theme.TEAL, tip: pu ? S.words.eclipseChipTip(next, true) : 'Next greatest eclipse of Saros 141 – click to bring it into view', onClick: () => S.actions.reveal(E[next], 'right') });
    const msg = 'Saros 141 · time base of the clock';
    const mw = tw(g, fonts.ui(500, 10), msg);
    if (px1 - px0 > mw + 330) text(g, msg, (px0 + px1) / 2, y + h * 0.82, fonts.ui(500, 10), MUTED, 'center');
  }
}

// ---- outside the catalogue ---------------------------------------------------------------------------
function paintOutOfRange(S) {
  const { g, L, X, lim, dpr, fonts, fmt } = S;
  const top = L.axis.y + L.axis.ctxH + L.axis.tickH;
  const bottom = L.bottom;
  const px0 = L.px0;
  const px1 = L.px1;
  const a = X(lim.tMin);
  const b = X(lim.tMax);
  const pat = hatch(g, 'rgba(163,177,191,0.2)', dpr, 7);
  const f = fonts.ui(600, 10);
  const edge = (x, side) => {
    if (x < px0 || x > px1) return;
    g.strokeStyle = 'rgba(163,177,191,0.55)';
    g.setLineDash([3, 3]);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, top);
    g.lineTo(Math.round(x) + 0.5, bottom);
    g.stroke();
    g.setLineDash([]);
    const t = side === 'start' ? lim.tMin : lim.tMax;
    const lab = S.isPure ? S.words.edgeLabel(side) : side === 'start' ? `catalogue starts ${fmt.date(t)}` : `catalogue ends ${fmt.date(t)}`;
    const lw = tw(g, f, lab);
    const room = side === 'start' ? x - px0 : px1 - x;
    const tx = side === 'start' ? x - 6 : x + 6;
    if (room > lw + 14) text(g, lab, tx, L.lanesY + 11, f, 'rgba(163,177,191,0.95)', side === 'start' ? 'right' : 'left');
    else {
      const ax = side === 'start' ? x + 6 : x - 6;
      text(g, lab, ax, L.lanesY + 11, f, 'rgba(163,177,191,0.8)', side === 'start' ? 'left' : 'right');
    }
  };
  g.save();
  g.beginPath();
  g.rect(px0, top, px1 - px0, bottom - top);
  g.clip();
  g.fillStyle = 'rgba(7,9,13,0.55)';
  if (a > px0) g.fillRect(px0, top, Math.min(a, px1) - px0, bottom - top);
  if (b < px1) g.fillRect(Math.max(b, px0), top, px1 - Math.max(b, px0), bottom - top);
  g.fillStyle = pat;
  if (a > px0) g.fillRect(px0, top, Math.min(a, px1) - px0, bottom - top);
  if (b < px1) g.fillRect(Math.max(b, px0), top, px1 - Math.max(b, px0), bottom - top);
  g.restore();
  edge(a, 'start');
  edge(b, 'end');
  if (b <= px0 || a >= px1) {
    const msg = 'Outside the Saros 141 catalogue';
    text(g, msg, (px0 + px1) / 2, (top + bottom) / 2, fonts.ui(600, 13), 'rgba(231,237,243,0.9)', 'center');
    text(g, S.isPure ? S.words.rangeLabel() : `${fmt.date(lim.tMin)} – ${fmt.date(lim.tMax)}`, (px0 + px1) / 2, (top + bottom) / 2 + 18, fonts.mono(400, 11), 'rgba(163,177,191,0.9)', 'center');
  }
}

// ---- axis ---------------------------------------------------------------------------------------------
function paintAxis(S) {
  const { g, L, X, t0, t1, data, fonts, step, dpr } = S;
  const symColor = S.isPure && step.pure ? laneStyle(S.theme, step.level).text : null; // pure: the unit symbol in its lane colour
  const px0 = L.px0;
  const px1 = L.px1;
  const ay = L.axis.y;
  const yTick = ay + L.axis.ctxH;
  const rowH = L.axis.tickH;

  g.save();
  g.beginPath();
  g.rect(px0, ay, px1 - px0, L.axis.h);
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.028)';
  g.fillRect(px0, ay, px1 - px0, L.axis.ctxH + rowH);

  // context row
  const fCtx = fonts.ui(600, 10.5);
  const spans = data.contextFor(step, t0, t1);
  for (const s of spans) {
    const a = X(s.t0);
    const b = X(s.t1);
    if (b < px0 || a > px1) continue;
    const ca = Math.max(a, px0);
    const cb = Math.min(b, px1);
    if (s.ord % 2) {
      g.fillStyle = 'rgba(255,255,255,0.035)';
      g.fillRect(ca, ay, cb - ca, L.axis.ctxH);
    }
    if (a >= px0) {
      g.fillStyle = 'rgba(163,177,191,0.4)';
      g.fillRect(Math.round(a * dpr) / dpr, ay + 2, 1, L.axis.ctxH - 3);
    }
    const lab = fit(g, fCtx, s.labels, cb - ca - 14);
    if (lab) {
      const lw = tw(g, fCtx, lab);
      let tx = ca + 6;
      if (tx + lw > cb - 4) tx = cb - 4 - lw;
      text(g, lab, tx, ay + L.axis.ctxH / 2 + 0.5, fCtx, 'rgba(231,237,243,0.88)');
    }
  }

  // weekend tint in the tick row
  if (!S.isPure && S.k * 86400 >= 7 && S.span < 200 * 86400) {
    g.fillStyle = 'rgba(138,180,255,0.07)';
    for (const s of data.weekendsFor(t0, t1)) {
      const a = X(s.t0);
      const b = X(s.t1);
      if (b >= px0 && a <= px1) g.fillRect(Math.max(a, px0), yTick, b - a, rowH);
    }
  }

  // minor ticks
  const minor = data.minorFor(step, t0, t1);
  if (minor && minor.step.nominal * S.k >= 6) {
    g.fillStyle = 'rgba(163,177,191,0.38)';
    for (const tk of minor.ticks) {
      const x = X(tk.t);
      if (x >= px0 && x <= px1) g.fillRect(Math.round(x * dpr) / dpr, yTick + rowH - 5, 1, 5);
    }
  }

  // labelled ticks. One label variant for the whole row (all "Sep", or all "September"), the
  // longest that fits between the closest pair of visible ticks.
  const fTick = fonts.mono(400, 11);
  const fMajor = fonts.mono(600, 11);
  // pure mode: a major period named in words ("Delta Trifracton") is set in the text face, counts stay monospaced
  const fWord = fonts.ui(500, 11);
  const fWordMajor = fonts.ui(600, 11);
  const fontOf = (tk, lab) => (S.isPure && /[A-Za-z]{2}/.test(lab) ? (tk.major ? fWordMajor : fWord) : tk.major ? fMajor : fTick);
  const ticks = data.ticksFor(step, t0, t1);
  const vis = [];
  for (let i = 0; i < ticks.length; i++) {
    const x = X(ticks[i].t);
    if (x < px0 || x > px1) continue;
    const next = ticks[i + 1] ? Math.min(X(ticks[i + 1].t), px1 + 100) : px1 + 100;
    vis.push({ tk: ticks[i], x, room: next - x - 8 });
  }
  let variant = 0;
  const maxVariants = vis.reduce((m, v) => Math.max(m, v.tk.labels.length), 1);
  for (; variant < maxVariants - 1; variant++) {
    let ok = true;
    for (const v of vis) {
      const lab = v.tk.labels[Math.min(variant, v.tk.labels.length - 1)];
      if (tw(g, fontOf(v.tk, lab), lab) > v.room) {
        ok = false;
        break;
      }
    }
    if (ok) break;
  }
  S.axisLabels = []; // what this frame labelled (debug / tests: how many labelled ticks a zoom shows)
  for (const { tk, x, room } of vis) {
    g.fillStyle = tk.major ? 'rgba(231,237,243,0.7)' : 'rgba(163,177,191,0.6)';
    g.fillRect(Math.round(x * dpr) / dpr, yTick + (tk.major ? 1 : 4), 1, rowH - (tk.major ? 1 : 4));
    const lab = tk.labels[Math.min(variant, tk.labels.length - 1)];
    const font = fontOf(tk, lab);
    if (tw(g, font, lab) <= room + 4 && x + 4 + tw(g, font, lab) <= px1 + 40) {
      countText(g, lab, x + 4, yTick + 8, font, tk.major ? 'rgba(231,237,243,0.95)' : 'rgba(163,177,191,0.95)', symColor);
      S.axisLabels.push(lab);
    }
  }
  // base line under the axis
  g.fillStyle = 'rgba(163,177,191,0.25)';
  g.fillRect(px0, yTick + rowH - 1, px1 - px0, 1);
  paintPentads(S);
  g.restore();
}

/**
 * The Pentad band (SPEC §7.5) in the row under the ticks, where the cursor and now flags sit: the Pentads of the window
 * as day-like stretches in the solar gold, alternately tinted, the one holding the cursor brighter, a stronger tick where
 * a sync begins (Pentad I). The Hypopentad is a Helion shorter, so it reads shorter. Each is labelled with its mark
 * (and its name where it fits), sticky to the visible part. Drawn only while the Hypopentad is a few pixels wide.
 */
const GOLD_RGB = '255,214,10';
function paintPentads(S) {
  const { g, L, X, t0, t1, k, fonts, dpr, data } = S;
  if (!S.pentads.bandShown(k)) return;
  const px0 = L.px0;
  const px1 = L.px1;
  const y = L.axis.y + L.axis.ctxH + L.axis.tickH;
  const h = L.axis.markH;
  const f = fonts.ui(600, 10);
  const fPlace = fonts.mono(500, 9.5);
  const cur = S.cursorIn ? S.pentads.at(S.cursorT) : null;
  const list = S.pentads.spans(t0, t1);
  const helionPx = S.pentads.helion * k;
  // the Helions inside each Pentad: a short tick where each one begins (so the Hypopentad shows its four against the
  // others' five) and, where a Helion is wide, its place in the Pentad (2 … 5; the 1st is the Pentad's own label)
  const helions = helionPx >= 8 ? data.blocksFor(6, t0, t1) : [];
  let hi = Math.max(0, lastStartAtOrBefore(helions, t0));
  for (const p of list) {
    const a = X(p.start);
    const b = X(p.end);
    if (b < px0) continue;
    if (a > px1) break;
    const ca = Math.max(a, px0);
    const cb = Math.min(b, px1);
    const isCur = cur && cur.sync === p.sync && cur.index === p.index;
    g.fillStyle = `rgba(${GOLD_RGB},${isCur ? 0.17 : p.index % 2 ? 0.045 : 0.095})`;
    g.fillRect(ca, y + 1, cb - ca, h - 2);
    if (a >= px0 && b - a >= 3) {
      const sync = p.index === 0; // a sync begins: a stronger tick
      g.fillStyle = `rgba(${GOLD_RGB},${sync ? 0.85 : 0.42})`;
      g.fillRect(Math.round(a * dpr) / dpr, y + (sync ? 0 : 2), sync ? 1.5 : 1, h - (sync ? 0 : 4));
    }
    const lab = fit(g, f, bandLabels(p.index, { pure: S.isPure }), cb - ca - 7);
    let labEnd = -Infinity;
    if (lab) {
      const lw = rw(g, f, lab);
      let tx = ca + 4;
      if (tx + lw > b - 3) tx = b - 3 - lw; // pushed by the next Pentad, like a sticky header
      rtext(g, lab, tx, y + h / 2 + 0.5, f, isCur ? 'rgba(231,237,243,0.92)' : 'rgba(231,237,243,0.72)', 'left', `rgba(${GOLD_RGB},${isCur ? 1 : 0.85})`);
      labEnd = tx + lw;
    }
    // the Helions of this Pentad
    const len = (p.end - p.start) / p.helions;
    for (; hi < helions.length && helions[hi].start < p.end - len / 2; hi++) {
      const hs = helions[hi].start;
      if (hs <= p.start + len / 2) continue; // the Pentad's own start
      const x = X(hs);
      if (x < px0 || x > px1) continue;
      g.fillStyle = `rgba(${GOLD_RGB},0.38)`;
      g.fillRect(Math.round(x * dpr) / dpr, y + h - 5, 1, 4);
      const place = String(Math.round((hs - p.start) / len) + 1);
      if (helionPx >= 44 && x + 3 > labEnd + 6) text(g, place, x + 3, y + h / 2 + 0.5, fPlace, `rgba(${GOLD_RGB},0.7)`);
    }
  }
}

// ---- cursor, now, hover ---------------------------------------------------------------------------------
function flag(S, x, label, color, side, scrub = false) {
  const { g, L, fonts } = S;
  const f = fonts.mono(600, 10.5);
  const w = rw(g, f, label) + 12;
  const y = L.axis.y + L.axis.ctxH + L.axis.tickH + 1;
  const h = L.axis.markH - 2;
  let x0 = side === 'left' ? x - w + 1 : side === 'right' ? x - 1 : x - w / 2;
  x0 = clampX(x0, L.px0, L.px1 - w);
  roundRect(g, x0, y, w, h, 4);
  g.fillStyle = color;
  g.fill();
  rtext(g, label, x0 + w / 2, y + h / 2 + 0.5, f, '#07090d', 'center');
  if (scrub) S.regions.push({ x: x0, y, w, h, scrub: true, tip: 'The time cursor. Drag it sideways to scrub time.' });
  S.flagRects.push({ x0, x1: x0 + w });
  return { x0, w };
}

function paintMarkers(S) {
  const { g, L, X, theme, dpr } = S;
  S.flagRects = []; // the cursor / now flags of this frame: the hover pill and the off-screen chips keep clear of them
  const px0 = L.px0;
  const px1 = L.px1;
  const top = L.axis.y + L.axis.ctxH + L.axis.tickH;
  const bottom = L.bottom;
  const line = (x, color, w, alpha = 1, dash) => {
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = w;
    if (dash) g.setLineDash(dash);
    const sx = Math.round(x * dpr) / dpr;
    g.beginPath();
    g.moveTo(sx, top);
    g.lineTo(sx, bottom);
    g.stroke();
    g.restore();
  };

  // hover crosshair
  if (S.hover && S.hover.x >= px0 && S.hover.x <= px1 && S.hover.y > L.overview.y + L.overview.h) {
    line(S.hover.x, '#e7edf3', 1, 0.28, [2, 3]);
  }

  const cx = X(S.cursorT);
  const nx = X(S.nowT);
  const cVis = S.cursorIn && cx >= px0 && cx <= px1;
  const nVis = S.nowShow && nx >= px0 && nx <= px1;
  const same = S.live || Math.abs(cx - nx) < 1;

  if (nVis) line(nx, theme.NOW, S.live ? 2 : 1.25, S.live ? 0.95 : 0.8, S.live ? undefined : [5, 3]);
  if (cVis && !S.live) line(cx, theme.CURSOR, 1.75, 1);
  else if (cVis && S.live) line(cx, theme.CURSOR, 0.75, 0.9);

  if (same && nVis) {
    flag(S, nx, S.live ? `NOW ${S.nowLabel}` : S.cursorLabel, S.live ? theme.NOW : theme.CURSOR, 'center', true);
  } else {
    let cSide = 'center';
    let nSide = 'center';
    if (cVis && nVis && Math.abs(cx - nx) < 130) {
      if (cx < nx) [cSide, nSide] = ['left', 'right'];
      else [cSide, nSide] = ['right', 'left'];
    }
    if (nVis) flag(S, nx, `now ${S.nowLabel}`, theme.NOW, nSide);
    if (cVis) flag(S, cx, S.cursorLabel, theme.CURSOR, cSide, true);
  }

  // hover pill
  if (S.hover && S.hover.x >= px0 && S.hover.x <= px1 && S.hover.y > L.overview.y + L.overview.h && S.hoverLabel) {
    const { g: gg, fonts } = S;
    const f = fonts.mono(500, 10.5);
    const w = rw(gg, f, S.hoverLabel) + 12;
    const y = top + 1;
    const x0 = clampX(S.hover.x - w / 2, px0, px1 - w);
    // never on top of the cursor / now flags: near them the tooltip carries the time
    if (!S.flagRects.some((r) => x0 < r.x1 + 3 && x0 + w > r.x0 - 3)) {
      roundRect(gg, x0, y, w, L.axis.markH - 2, 4);
      gg.fillStyle = 'rgba(43,58,74,0.96)';
      gg.fill();
      gg.strokeStyle = 'rgba(231,237,243,0.35)';
      gg.lineWidth = 1;
      gg.stroke();
      rtext(gg, S.hoverLabel, x0 + w / 2, y + (L.axis.markH - 2) / 2 + 0.5, f, '#e7edf3', 'center');
    }
  }
}

// ---- gutters (lane labels) --------------------------------------------------------------------------------
function paintGutters(S) {
  const { g, L, model, fonts, theme, data } = S;
  const x1 = L.px0;
  // overview + eclipse labels
  const fSmall = fonts.mono(400, 9.5);
  const fTitle = fonts.ui(600, L.compact ? 9.5 : 10.5);
  const ov = L.overview;
  g.save();
  g.fillStyle = 'rgba(7,9,13,0.35)';
  g.fillRect(0, L.lanesY, x1 - 2, L.laneH * L.lanes);
  g.fillRect(0, L.eclipse.y, x1 - 2, L.eclipse.h);
  g.restore();

  text(g, L.compact ? 'Map' : 'Catalogue', 8, L.compact ? ov.y + ov.h / 2 : ov.y + ov.h / 2 - 7, fTitle, 'rgba(163,177,191,0.95)');
  if (!L.compact) text(g, S.catLabel, 8, ov.y + ov.h / 2 + 7, fSmall, MUTED);
  text(g, L.compact ? 'Saros' : 'Saros 141', 8, L.eclipse.y + L.eclipse.h * 0.34, fTitle, theme.TEAL);
  text(g, L.compact ? '70' : '70 eclipses', 8, L.eclipse.y + L.eclipse.h * 0.66, fSmall, MUTED);
  if (S.pentads.bandShown(S.k)) {
    // the band under the ticks: hover for what a Pentad is
    text(g, L.compact ? 'Pentad' : 'Pentads', 8, L.axis.y + L.axis.ctxH + L.axis.tickH + L.axis.markH / 2 + 0.5, fonts.ui(600, L.compact ? 9.5 : 10), `rgba(${GOLD_RGB},0.85)`);
  }
  if (S.isPure && S.step) {
    // the ruler's key: which unit the context row spans and which unit the ticks count (hover for the sentence)
    const key = S.words.rulerKey(S.step);
    const fKey = fonts.mono(600, L.compact ? 9.5 : 10.5);
    if (key.top) text(g, key.top, 8, L.axis.y + L.axis.ctxH / 2 + 0.5, fKey, MUTED);
    text(g, key.bottom, 8, L.axis.y + L.axis.ctxH + L.axis.tickH / 2 + 0.5, fKey, theme.TEAL);
  }

  for (let i = 0; i < S.levels.length; i++) {
    const level = S.levels[i];
    const info = model.levelInfo(level);
    const st = laneStyle(theme, level);
    const y = L.lanesY + i * L.laneH;
    const sel = level === S.selected;
    const hov = S.hover && S.hover.lane === i && S.hover.gutter;
    if (sel || hov) {
      g.fillStyle = sel ? st.tint : 'rgba(255,255,255,0.05)';
      g.fillRect(0, y + 1, x1 - 2, L.laneH - 2);
    }
    if (sel) {
      g.fillStyle = st.solid;
      g.fillRect(0, y + 2, 3, L.laneH - 4);
    }
    const two = L.laneH >= 28; // letter and depth on top, the cycle length underneath
    const snug = L.laneH < 32; // the shortest lanes: pull the two lines apart a little
    const ly = y + (two ? L.laneH * (snug ? 0.33 : 0.36) : L.laneH / 2) + 0.5;
    const fLetter = fonts.ui(600, 15);
    const fDepth = fonts.mono(sel ? 600 : 400, 10);
    text(g, info.letter, 11, ly, fLetter, sel ? st.text : st.textDim);
    const lw = tw(g, fLetter, info.letter);
    // "depth 5" where the gutter has room for the words, the bare number in the 56 px phone gutter
    const depthRoom = x1 - 8 - (11 + lw + 4);
    const depth = fit(g, fDepth, depthHeadVariants(info), depthRoom) ?? String(info.depth);
    text(g, depth, 11 + lw + 4, ly + 1, fDepth, sel ? 'rgba(231,237,243,0.95)' : 'rgba(163,177,191,0.8)');
    // pure: one cycle counted in the next unit, the ladder itself ("= 36ι" for η, "= 11η" for ζ, "= 0.14ν" for ξ);
    // normal: the mean length
    const len = S.isPure ? S.words.laneLength(level) : data.lengthLabel(level);
    const lenFull = S.isPure ? len : `≈ ${len}`;
    if (two) {
      // the compact gutter is 56 px: a smaller mono font keeps "33.7 min" clear of the divider
      const fLen = L.compact ? fonts.mono(400, 9) : fSmall;
      text(g, L.compact && !S.isPure ? len : lenFull, L.compact ? 8 : 11, y + L.laneH * (snug ? 0.8 : 0.74) + 0.5, fLen, MUTED);
    } else if (!L.compact) {
      // one line (never at the standard lane heights): the length only if it clears the depth number
      const room = x1 - 8 - (11 + lw + 4 + tw(g, fDepth, depth) + 8);
      const lab = fit(g, fSmall, [lenFull, len], room);
      if (lab) text(g, lab, x1 - 8, ly, fSmall, MUTED, 'right');
    }
  }
  // divider
  g.fillStyle = 'rgba(163,177,191,0.16)';
  g.fillRect(x1 - 1, L.lanesY, 1, L.laneH * L.lanes + L.eclipse.h);
}

// ---- chips (interactive pills) -----------------------------------------------------------------------------
const CHIP_FONT = (S) => S.fonts.ui(600, 10.5);
const chipWidth = (S, label) => rw(S.g, CHIP_FONT(S), label) + 14;

/** Draws a chip (and registers it for hit-testing); returns its box. */
function chip(S, label, x, cy, o = {}) {
  const { g } = S;
  const f = CHIP_FONT(S);
  const w = chipWidth(S, label);
  const h = 18;
  const x0 = o.align === 'right' ? x - w : x;
  const y0 = cy - h / 2;
  roundRect(g, x0, y0, w, h, 9);
  g.fillStyle = 'rgba(10,14,19,0.92)';
  g.fill();
  g.strokeStyle = o.color ?? 'rgba(138,180,255,0.8)';
  g.lineWidth = 1;
  g.stroke();
  rtext(g, label, x0 + w / 2, cy + 0.5, f, o.color ?? '#e7edf3', 'center');
  S.regions.push({ x: x0, y: y0, w, h, onClick: o.onClick, tip: o.tip });
  return { x: x0, w };
}

/**
 * The pointer for the selected level's turnover when it lies outside the view, or null. Planned before the
 * lanes are drawn, so the lane can keep its own block label clear of a chip that sits on its left edge.
 */
function planSelChip(S) {
  const sel = S.selCycle;
  if (!sel) return null;
  const { L, theme, fmt, model } = S;
  const ex = S.X(sel.end);
  if (!(ex > L.px1 || ex < L.px0)) return null;
  const info = model.levelInfo(S.selected);
  const laneIdx = S.levels.indexOf(S.selected);
  const cy = laneIdx >= 0 ? L.lanesY + laneIdx * L.laneH + L.laneH / 2 : L.axis.y + L.axis.ctxH + L.axis.tickH + L.axis.markH / 2;
  const right = ex > L.px1;
  // the arrow says where the end is; the countdown is from the cursor ("the cursor's cycle ends in ...")
  const rel = S.isPure ? S.ruler.relText(sel.end, S.cursorT) : fmt.countdown(sel.end - S.cursorT);
  const label = S.isPure ? S.words.endsChip(info.letter, rel, right) : right ? `${info.letter} ends ${rel} ▸` : `◂ ${info.letter} ends ${rel}`;
  return {
    right,
    cy,
    label,
    w: chipWidth(S, label),
    color: theme.levelColor(S.selected, 1, 72),
    tip: S.isPure ? S.words.turnoverTip(S.selected, sel.idx, right, sel.end >= model.tMax - 1e-3) : turnoverTip(info, right),
    end: sel.end,
  };
}

function paintChips(S) {
  const { L, theme, fmt } = S;
  const markY = L.axis.y + L.axis.ctxH + L.axis.tickH + L.axis.markH / 2;
  const inView = (t) => {
    const x = S.X(t);
    return x >= L.px0 && x <= L.px1;
  };

  const c = S.selChip;
  if (c) {
    chip(S, c.label, c.right ? L.px1 - 8 : L.px0 + 8, c.cy, {
      align: c.right ? 'right' : 'left',
      color: c.color,
      tip: c.tip,
      onClick: () => S.actions.reveal(c.end, c.right ? 'right' : 'left'),
    });
  }

  // cursor and now, when they are out of view: stacked along the edge they lie beyond. They share a row with
  // the cursor / now flags, so a chip gives way (shorter text, else none) rather than cover a flag.
  const edge = { left: L.px0 + 8, right: L.px1 - 8 };
  const clear = (x0, x1) => !S.flagRects.some((r) => x0 < r.x1 + 4 && x1 > r.x0 - 4);
  const offscreen = (t, name, color, tip, onClick) => {
    const right = S.X(t) > L.px1;
    // the reading leads with its Pentad, like the flags
    const plain = S.isPure ? S.ruler.flagText(t, S.step.u) : fmt.short(t, S.chipYear);
    const reading = S.flagLeads ? S.pentads.lead(t, plain) : plain;
    const lab = `${name} ${reading}`;
    const variants = S.isPure ? S.words.markerChip(name, reading, right) : right ? [`${lab} ▸`, `${name} ▸`] : [`◂ ${lab}`, `◂ ${name}`];
    for (const v of variants) {
      const w = chipWidth(S, v);
      const x0 = right ? edge.right - w : edge.left;
      if (x0 < L.px0 || x0 + w > L.px1 || !clear(x0, x0 + w)) continue;
      chip(S, v, right ? edge.right : edge.left, markY, { align: right ? 'right' : 'left', color, tip, onClick });
      if (right) edge.right -= w + 6;
      else edge.left += w + 6;
      return;
    }
  };
  if (S.cursorIn && !inView(S.cursorT)) offscreen(S.cursorT, 'cursor', theme.CURSOR, 'The time cursor is off screen. Click to centre the view on it.', () => S.actions.centreCursor());
  if (S.nowShow && !S.live && !inView(S.nowT)) offscreen(S.nowT, 'now', theme.NOW, 'The real current time is off screen. Click to centre the view on it.', () => S.actions.centreNow());
}
