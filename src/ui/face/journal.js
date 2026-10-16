/**
 * The journal face: the clock read the way the printed diary is addressed (docs/design/90-diary.md, SPEC §15).
 *
 *   top      the phase of the middle's longest unit (its most significant reading): two 2-stroke glyphs (256 states)
 *            and its letter – the same phase as the arc below
 *   middle   three named units from the selected one down, in letters, every count in two digits so the reading
 *            keeps its width and size: "72η 24ι 62λ", "ε#02 72η 24ι", "24ι 62λ 03ν"
 *   bottom   the cycle of the middle's longest unit as two half-arcs – the left one descending (below the axis), the
 *            right one ascending (above it) – with a tick at the present position, and its letter
 *   major    a major period (Alpha … Delta) is shown alone: its phase as one big 3-stroke glyph (52 states) at the top,
 *            four lines of words in the middle – the ordinal of its current child, its name, its fracton word, its
 *            quarter ("5th / Delta / Trifracton / End": the 5th Nuclide of Delta Trifracton, in its End quarter) – and
 *            its own cycle at the bottom
 *   taps     the top third goes one unit up (longer), the bottom third one unit down (shorter); ↑ ↓ keys likewise
 *
 * Units, from long to short: α β γ δ (major) · ε η ι λ ν (minor). `unit` is the index of the first one shown (0 … 6:
 * the last triplet is ι λ ν). Everything is drawn in the 192 × 490 screen units of the watch face (helpers.js SCREEN).
 */
import { SCREEN, BEZEL } from './helpers.js';
import { createGlyphBook } from './glyphs.js';

const NS = 'http://www.w3.org/2000/svg';
/** The named units, long to short: [level, id]. */
export const JOURNAL_UNITS = Object.freeze([
  [0, 'alpha'],
  [1, 'beta'],
  [2, 'gamma'],
  [3, 'delta'],
  [4, 'epsilon'],
  [6, 'eta'],
  [8, 'iota'],
  [10, 'lambda'],
  [12, 'nu'],
]);
export const MAX_UNIT = JOURNAL_UNITS.length - 3; // the last triplet: ι λ ν
const LETTER = { 0: 'α', 1: 'β', 2: 'γ', 3: 'δ', 4: 'ε', 5: 'ζ', 6: 'η', 7: 'θ', 8: 'ι', 9: 'κ', 10: 'λ', 11: 'μ', 12: 'ν' };
const TOP_END = SCREEN.h / 3;
const BOTTOM_START = (2 * SCREEN.h) / 3;

export const clampUnit = (u) => Math.min(MAX_UNIT, Math.max(0, Math.round(Number.isFinite(u) ? u : 5)));

/** "1st", "2nd", "3rd", "4th", "11th", "22nd" */
export function ordinal(n) {
  const v = n % 100;
  const s = v >= 11 && v <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${s}`;
}

/**
 * What the face shows at time t with unit index u (pure data, for tests and the renderer).
 * @returns {null | {
 *   unit, levels: number[],              // the three units' levels
 *   lead: {level, letter, phase},             // the longest unit shown: its phase is the top glyphs and the bottom cycle
 *   tokens: [{level, text}] | null,           // minor mode: "72η" "24ι" "62λ"
 *   major: {level, lines: [ordinal, name, fracton, quarter], index3} | null   // major mode: one period alone
 * }}
 */
export function journalReading({ model, pure }, t, u) {
  const unit = clampUnit(u);
  const first = JOURNAL_UNITS[unit][0];
  // a major period alone; minor units in threes
  const levels = first <= 3 ? [first] : JOURNAL_UNITS.slice(unit, unit + 3).map(([L]) => L);
  const lv = (L, o) => model.levelAt(t, L, o);
  const lead = lv(levels[0]);
  if (!lead) return null;
  const c = pure.clock(t);
  const d = pure.date(t);
  if (!c || !d) return null;
  const out = { unit, levels, lead: { level: first, letter: LETTER[first], phase: lead.phase }, tokens: null, major: null };
  if (first <= 3) {
    const ORD = { 0: d.beta, 1: d.gamma, 2: d.delta, 3: d.epsilon };
    const OWN = { 0: d.alpha, 1: d.beta, 2: d.gamma, 3: d.delta };
    const QUARTER = { 0: d.quarter.alpha, 1: d.quarter.beta, 2: d.quarter.gamma, 3: d.quarter.delta };
    const [name, fracton] = pure.periodName(first, OWN[first]).split(' ');
    out.major = { level: first, lines: [ordinal(ORD[first]), name, fracton, QUARTER[first]], index3: lv(first, { strokes: 3 })?.index ?? 0 };
    return out;
  }
  const two = (n) => String(n).padStart(2, '0');
  const minorText = (L) => ({ 4: `ε#${two(c.epsilon)}`, 6: `${two(c.eta)}η`, 8: `${two(c.iota)}ι`, 10: `${two(c.lambda)}λ`, 12: `${two(c.nu)}ν` })[L];
  out.tokens = levels.map((L) => ({ level: L, text: minorText(L) }));
  return out;
}

function node(name, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (kids.length) e.append(...kids);
  return e;
}

/**
 * @param {{model, pure, F, theme, uid: number, onStep: (dir: number) => boolean}} o
 *   onStep(dir): −1 one unit up, +1 down; returns false when there is no further unit (the face pulses red)
 */
export function createJournalFace({ model, pure, F, theme, uid, onStep }) {
  const g2 = createGlyphBook(F, { strokes: 2 });
  const g3 = createGlyphBook(F, { strokes: 3 });
  const id = (n) => `jf-${n}-${uid}`;
  const svg = node('svg', {
    class: 'face-journal',
    viewBox: `${-BEZEL} ${-BEZEL} ${SCREEN.w + 2 * BEZEL} ${SCREEN.h + 2 * BEZEL}`,
    role: 'img',
    tabindex: '0',
    'aria-label': 'Journal face',
  });
  svg.append(
    node('defs', {}, node('clipPath', { id: id('clip') }, node('rect', { x: 0, y: 0, width: SCREEN.w, height: SCREEN.h, rx: SCREEN.r }))),
    node('rect', { class: 'face-body', x: -5, y: -5, width: SCREEN.w + 10, height: SCREEN.h + 10, rx: SCREEN.r + 5, fill: '#1b242e' }),
    node('rect', { class: 'face-glass', x: 0, y: 0, width: SCREEN.w, height: SCREEN.h, rx: SCREEN.r, fill: '#04070a' }),
  );
  const content = node('g', { 'clip-path': `url(#${id('clip')})` });
  const pulse = node('rect', { x: 0, y: 0, width: SCREEN.w, height: TOP_END, fill: '#4fd1c5', opacity: 0, 'pointer-events': 'none' });
  svg.append(content, pulse);
  // the tap regions' faint dividers
  for (const y of [TOP_END, BOTTOM_START]) content.append(node('line', { x1: 34, x2: SCREEN.w - 34, y1: y, y2: y, stroke: '#ffffff', 'stroke-opacity': 0.06, 'stroke-width': 1 }));
  const top = node('g');
  const mid = node('g');
  const bot = node('g');
  content.append(top, mid, bot);

  const glyphPath = (book, index, cx, cy, h, color, sw) => {
    const g = book.get(index);
    const b = g.bounds;
    const s = h / (b.maxY - b.minY);
    const tx = cx - ((b.minX + b.maxX) / 2) * s;
    const ty = cy - ((b.minY + b.maxY) / 2) * s;
    const grp = node('g', { transform: `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})`, fill: 'none', stroke: color, 'stroke-width': (sw / s).toFixed(3), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, node('path', { d: g.d }));
    if (g.dot) grp.append(node('circle', { cx: g.dot.x, cy: g.dot.y, r: g.dot.r, fill: color, stroke: 'none' }));
    return { el: grp, w: (b.maxX - b.minX) * s };
  };
  const text = (x, y, str, o = {}) => node('text', { x, y, 'text-anchor': o.anchor ?? 'middle', 'font-size': o.size ?? 14, fill: o.fill ?? '#e8eef3', 'font-weight': o.weight, 'font-family': 'var(--font-mono, ui-monospace, monospace)', 'letter-spacing': o.ls }, str);
  /** Font size so that `n` characters fit `w` units (monospace advance ≈ 0.6 em). */
  const fitSize = (n, w, max, min) => Math.max(min, Math.min(max, w / (n * 0.6)));

  let key = '';
  function render(frame, reading) {
    if (!frame?.inRange || !reading) {
      if (key !== 'oor') {
        key = 'oor';
        top.replaceChildren();
        bot.replaceChildren();
        mid.replaceChildren(text(SCREEN.cx, SCREEN.cy, 'outside the catalogue', { size: 12, fill: '#8a96a3' }));
      }
      return;
    }
    const r = reading;
    const p2 = r.tokens ? pure.pair(r.lead.phase) : null;
    const k = JSON.stringify([r.unit, p2?.index, r.tokens?.map((x) => x.text), r.major?.lines, r.major?.index3, Math.round(r.lead.phase * 720)]);
    if (k === key) return;
    key = k;

    // top: the lead unit's phase
    top.replaceChildren();
    if (r.major) {
      // the period's own phase: one big 3-stroke glyph
      top.append(glyphPath(g3, r.major.index3, SCREEN.cx, 92, 92, theme.levelColor(r.major.level), 2.8).el);
    } else {
      // the lead unit's phase as two 2-stroke glyphs: the same phase as the arc below
      const color = theme.levelColor(r.lead.level);
      const gh = 70;
      const a = glyphPath(g2, p2.hi, 0, 0, gh, color, 2.6);
      const b = glyphPath(g2, p2.lo, 0, 0, gh, color, 2.6);
      const gap = 12;
      const w = a.w + gap + b.w;
      top.append(
        glyphPath(g2, p2.hi, SCREEN.cx - w / 2 + a.w / 2, 92, gh, color, 2.6).el,
        glyphPath(g2, p2.lo, SCREEN.cx + w / 2 - b.w / 2, 92, gh, color, 2.6).el,
        text(SCREEN.cx, 148, r.lead.letter, { size: 13, fill: color }),
      );
    }

    // middle: the three units
    mid.replaceChildren();
    if (r.tokens) {
      // one size for every minor reading: the widest is "ε#05 34η 29ι" (12 characters, all counts in two digits)
      const size = fitSize(12, 172, 30, 14);
      const t = text(SCREEN.cx, SCREEN.cy + size * 0.36, '', { size, weight: 600 });
      r.tokens.forEach((x, i) => {
        const m = /^(ε#)?(\d+)([αβγδεζηθικλμν]?)$/.exec(x.text);
        const color = theme.levelColor(x.level);
        if (i) t.append(node('tspan', {}, ' '));
        if (m?.[1]) t.append(node('tspan', { fill: color }, m[1]), node('tspan', {}, m[2]));
        else if (m) t.append(node('tspan', {}, m[2]), node('tspan', { fill: color }, m[3]));
        else t.append(node('tspan', { fill: color }, x.text));
      });
      mid.append(t);
    } else {
      // four lines: the child's ordinal, the name, the fracton word, the quarter
      const color = theme.levelColor(r.major.level);
      const lines = r.major.lines;
      const size = fitSize(Math.max(...lines.map((l) => l.length)), 172, 24, 13);
      const lead = size * 1.25;
      const y0 = SCREEN.cy - (lead * (lines.length - 1)) / 2 + size * 0.36;
      lines.forEach((l, i) => mid.append(text(SCREEN.cx, y0 + i * lead, l, { size: i === 1 ? size : size * (i === 0 || i === 3 ? 0.82 : 1), weight: i === 1 || i === 2 ? 600 : 400, fill: i === 1 || i === 2 ? color : '#c9d3dc' })));
    }

    // bottom: the lead unit's cycle as two half-arcs, a tick at the present position
    bot.replaceChildren();
    const color = theme.levelColor(r.lead.level);
    const R = 38;
    const cy = 392;
    const L0 = SCREEN.cx - 2 * R;
    const cl = SCREEN.cx - R; // left arc centre
    const cr = SCREEN.cx + R; // right arc centre
    bot.append(
      node('line', { x1: L0 - 4, x2: SCREEN.cx + 2 * R + 4, y1: cy, y2: cy, stroke: '#ffffff', 'stroke-opacity': 0.12, 'stroke-width': 1 }),
      // left: descending (below the axis), right: ascending (above it)
      node('path', { d: `M${L0} ${cy}A${R} ${R} 0 0 0 ${SCREEN.cx} ${cy}A${R} ${R} 0 0 1 ${SCREEN.cx + 2 * R} ${cy}`, fill: 'none', stroke: color, 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
    );
    // the quarter thresholds: start, deepest, middle, highest, end
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const q = arcPoint(f, { cl, cr, cy, R });
      bot.append(node('circle', { cx: q.x, cy: q.y, r: 1.6, fill: color, 'fill-opacity': 0.6 }));
    }
    const q = arcPoint(r.lead.phase, { cl, cr, cy, R });
    bot.append(
      node('line', { x1: q.x - q.nx * 9, y1: q.y - q.ny * 9, x2: q.x + q.nx * 9, y2: q.y + q.ny * 9, stroke: '#ffffff', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
      node('circle', { cx: q.x, cy: q.y, r: 3.4, fill: '#ffffff' }),
      text(SCREEN.cx, 460, r.lead.letter, { size: 13, fill: color }),
    );
    svg.setAttribute('aria-label', ariaOf(r));
  }

  function flash(region, refused = false) {
    pulse.setAttribute('y', region === 'top' ? 0 : BOTTOM_START);
    pulse.setAttribute('height', region === 'top' ? TOP_END : SCREEN.h - BOTTOM_START);
    pulse.setAttribute('fill', refused ? '#ff6b6b' : '#4fd1c5');
    pulse.setAttribute('opacity', '0.18');
    pulse.animate?.([{ opacity: 0.18 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });
    setTimeout(() => pulse.setAttribute('opacity', '0'), 260);
  }
  function step(dir) {
    const ok = onStep(dir);
    flash(dir < 0 ? 'top' : 'bottom', !ok);
    return ok;
  }
  svg.addEventListener('pointerup', (e) => {
    const m = svg.getScreenCTM();
    if (!m) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    if (pt.y < TOP_END) step(-1);
    else if (pt.y > BOTTOM_START) step(1);
  });
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(e.key === 'ArrowUp' ? -1 : 1);
    }
  });
  const invalidate = () => (key = '');
  return { svg, render, step, invalidate };
}

/** The point at cycle fraction f on the two half-arcs, with the outward normal (for the tick). */
export function arcPoint(f, { cl, cr, cy, R }) {
  const p = Math.min(1, Math.max(0, f));
  if (p <= 0.5) {
    const a = Math.PI * 2 * p; // 0 at the left end, π at the middle, through the bottom
    const x = cl - R * Math.cos(a);
    const y = cy + R * Math.sin(a);
    return { x, y, nx: (x - cl) / R, ny: (y - cy) / R };
  }
  const a = Math.PI * (2 * p - 1);
  const x = cr - R * Math.cos(a);
  const y = cy - R * Math.sin(a);
  return { x, y, nx: (x - cr) / R, ny: (y - cy) / R };
}

/** What a screen reader hears: "Journal face: 72η 24ι 62λ; the η phase above and its cycle below. …". */
function ariaOf(r) {
  const middle = r.tokens ? r.tokens.map((x) => x.text).join(' ') : r.major.lines.join(' ');
  return `Journal face: ${middle}; the ${r.lead.letter} phase above and its cycle below. Tap the top for a longer unit, the bottom for a shorter one.`;
}
