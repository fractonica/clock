/**
 * Canvas renderer of the waveform inset: the glyph value of the selected level over one cycle
 * (0 -> +M -> 0 -> -M -> 0), its sixteen glyph states as bars, four tinted quarter bands, a
 * draggable cursor at the current phase and the five boundary times underneath.
 *
 * The slow-changing parts (bands, grid, bars, boundary line) live on a static canvas stacked below the
 * live one (the browser composites them, no blit in JS); each frame only the past highlight, the cursor,
 * the hover marker are drawn on the live canvas. The countdown to the next boundary is DOM text placed over
 * the canvas (see `nextSlot`): setting a canvas font after DOM writes forces a style recalculation.
 */
import { TAU, waveLayout, triangle, stateValue, glyphExtreme } from './geometry.js';
import { valueText } from './text.js';
import { roundRectPath, UI_FONT, MONO_FONT } from './canvas.js';

const BAND_CAPTIONS = ['rising', 'falling', 'falling', 'rising'];
const font = (w, px, mono) => `${w} ${px}px ${mono ? MONO_FONT : UI_FONT}`;
const DATE_FONT = font(500, 10.5, true);
const IN_FONT = font(600, 10, true); // also the font of the countdown that rings.js draws as DOM text
/** Captions and boundary labels: 5.4:1 on the card (the shared --ink-3 is just under 4.5:1 at these sizes). */
const LABEL = '#8493a3';

/**
 * @param {HTMLCanvasElement} canvas  the live layer (receives the pointer events)
 * @param {object} theme              core/theme.js
 * @param {HTMLCanvasElement} [baseCanvas]  static layer stacked below `canvas`
 */
export function createWave(canvas, theme, baseCanvas) {
  const g = canvas.getContext('2d');
  const base = baseCanvas ?? document.createElement('canvas');
  const bg = base.getContext('2d');
  let W = 0;
  let H = 0;
  let R = 1;
  let L = null; // waveLayout
  let baseKey = '';
  let lastSig = '';

  function resize(w, h, ratio) {
    const nw = Math.floor(w);
    const nh = Math.floor(h);
    if (nw === W && nh === H && ratio === R) return false;
    W = nw;
    H = nh;
    R = ratio;
    for (const c of [canvas, base]) {
      c.width = Math.max(1, Math.round(W * R));
      c.height = Math.max(1, Math.round(H * R));
    }
    L = waveLayout(W, H, { left: 34, right: 16, top: 28, bottom: 68 });
    baseKey = lastSig = '';
    return true;
  }

  // ------------------------------------------------------------------------------------------
  function drawBase(s) {
    const c = bg;
    c.setTransform(R, 0, 0, R, 0, 0);
    c.clearRect(0, 0, W, H);
    const { x0, x1, y0, y1, yMid, xOf, yOf } = L;
    const col = (a, l) => theme.levelColor(s.level, a, l);
    const M = s.M;

    // quarter bands
    for (let q = 0; q < 4; q++) {
      const xa = xOf(q / 4);
      const xb = xOf((q + 1) / 4);
      c.fillStyle = q === 0 || q === 3 ? col(0.1) : 'rgba(255,255,255,0.035)';
      c.fillRect(xa, y0, xb - xa, y1 - y0);
      c.fillStyle = LABEL;
      c.font = font(500, 9.5);
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillText(BAND_CAPTIONS[q], (xa + xb) / 2, y0 - 17); // clear of the cursor handle (y0 - 12 .. y0 - 3)
    }
    // band separators
    c.strokeStyle = 'rgba(255,255,255,0.09)';
    c.lineWidth = 1;
    c.beginPath();
    for (let q = 0; q <= 4; q++) {
      const x = Math.round(xOf(q / 4)) + 0.5;
      c.moveTo(x, y0 - 4);
      c.lineTo(x, y1 + 5);
    }
    c.stroke();

    // value grid
    c.setLineDash([3, 4]);
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.beginPath();
    for (const v of [1, -1]) {
      c.moveTo(x0, Math.round(yOf(v)) + 0.5);
      c.lineTo(x1, Math.round(yOf(v)) + 0.5);
    }
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = 'rgba(255,255,255,0.3)';
    c.beginPath();
    c.moveTo(x0, Math.round(yMid) + 0.5);
    c.lineTo(x1, Math.round(yMid) + 0.5);
    c.stroke();
    c.fillStyle = LABEL;
    c.font = font(500, 10, true);
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (const v of [1, 0, -1]) c.fillText(valueText(v * M), x0 - 6, yOf(v) + 0.5);

    // the sixteen glyph states
    const states = 4 * M;
    const bw = (x1 - x0) / states;
    c.fillStyle = col(0.2);
    for (let k = 0; k < states; k++) {
      const v = stateValue(k, M) / M;
      const ya = yOf(0);
      const yb = yOf(v);
      const top = Math.min(ya, yb);
      const h = Math.max(1.5, Math.abs(ya - yb));
      c.fillRect(x0 + k * bw + 1, v === 0 ? ya - 0.75 : top, Math.max(1, bw - 2), h);
    }
    // the ideal wave
    c.beginPath();
    c.moveTo(xOf(0), yOf(0));
    c.lineTo(xOf(0.25), yOf(1));
    c.lineTo(xOf(0.75), yOf(-1));
    c.lineTo(xOf(1), yOf(0));
    c.lineWidth = 1.6;
    c.lineJoin = 'round';
    c.strokeStyle = col(0.5);
    c.stroke();

    // beyond the catalogue: hatch the part of a clipped cycle that does not exist
    if (s.limit < 0.9999) {
      const xl = xOf(s.limit);
      c.save();
      c.beginPath();
      c.rect(xl, y0 - 2, x1 - xl + 1, y1 - y0 + 4);
      c.clip();
      c.fillStyle = 'rgba(7, 9, 13, 0.82)';
      c.fillRect(xl, y0 - 2, x1 - xl + 1, y1 - y0 + 4);
      c.strokeStyle = 'rgba(255,255,255,0.09)';
      c.lineWidth = 1;
      c.beginPath();
      for (let x = xl - (y1 - y0); x < x1 + 10; x += 9) {
        c.moveTo(x, y1 + 2);
        c.lineTo(x + (y1 - y0), y0 - 2);
      }
      c.stroke();
      c.restore();
      c.strokeStyle = 'rgba(255, 214, 10, 0.55)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(Math.round(xl) + 0.5, y0 - 4);
      c.lineTo(Math.round(xl) + 0.5, y1 + 5);
      c.stroke();
      if (x1 - xl > 70) {
        c.fillStyle = LABEL;
        c.font = font(500, 10);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('beyond the catalogue', (xl + x1) / 2, yMid - 14);
      }
    }
    // time axis
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x0, Math.round(y1) + 5.5);
    c.lineTo(x1, Math.round(y1) + 5.5);
    c.stroke();
    drawLabels(c, s);
  }

  // Boundary labels: boxes that never overlap and never leave the canvas however narrow the plot is. Everything
  // except the countdown lives on the static layer (it changes only at quarter boundaries).
  let nextSlot = null;
  /** Text lines of a boundary label; `stack` puts a trailing year of a time-less date on a line of its own. */
  function labelLines(l, stack) {
    const m = stack && !l.time ? /^(.+) (\d{4})$/.exec(l.date) : null;
    return m ? [m[1], m[2]] : [l.date, l.time].filter(Boolean);
  }
  function drawLabels(c, s) {
    const { y1, xOf } = L;
    const col = (a, l) => theme.levelColor(s.level, a, l);
    const ly = y1 + 20;
    const nameFont = (l) => font(l.next ? 700 : 600, 9.5);
    const gap = 8;
    const measure = (stack) =>
      s.labels.map((l, i) => {
        c.font = nameFont(l);
        const nameText = l.next ? `\u25B8 ${l.name}` : l.name;
        let w = c.measureText(nameText).width;
        c.font = DATE_FONT;
        const lines = labelLines(l, stack);
        for (const ln of lines) w = Math.max(w, c.measureText(ln).width);
        const x = xOf(i / 4);
        const left = i === 0 ? x - 4 : i === 4 ? x + 4 - w : x - w / 2;
        return { l, i, x, w, left, nameText, lines };
      });
    let boxes = measure(false);
    // five year-scale dates do not fit side by side on a phone: stack the years under the day and month
    if (boxes.reduce((a, b) => a + b.w, 0) + gap * 4 > W - 4) boxes = measure(true);
    const pushLeft = () => {
      for (let k = boxes.length - 2; k >= 0; k--) {
        const over = boxes[k].left + boxes[k].w + gap - boxes[k + 1].left;
        if (over > 0) boxes[k].left -= over;
      }
    };
    pushLeft();
    if (boxes[0].left < 2) {
      boxes[0].left = 2;
      for (let k = 1; k < boxes.length; k++) {
        const over = boxes[k - 1].left + boxes[k - 1].w + gap - boxes[k].left;
        if (over > 0) boxes[k].left += over;
      }
    }
    // the packing above can run past the right edge: pull the last box back in and let the others make room
    const last = boxes[boxes.length - 1];
    if (last.left + last.w > W - 2) {
      last.left = W - 2 - last.w;
      pushLeft();
    }
    nextSlot = null;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    for (const b of boxes) {
      const { l } = b;
      c.globalAlpha = l.passed ? 0.8 : 1;
      c.fillStyle = l.next ? col(1, 72) : l.passed ? theme.INK_2 : LABEL;
      c.font = nameFont(l);
      c.fillText(b.nameText, b.left, ly);
      c.fillStyle = l.next ? theme.INK : theme.INK_2;
      c.font = DATE_FONT;
      b.lines.forEach((ln, k) => c.fillText(ln, b.left, ly + 13 * (k + 1)));
      if (l.passed && l.time) {
        // passed boundaries get their time struck through
        const tw = c.measureText(l.time).width;
        c.strokeStyle = theme.INK_3;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(b.left, ly + 22.5);
        c.lineTo(b.left + tw, ly + 22.5);
        c.stroke();
      }
      c.globalAlpha = 1;
      // tick on the axis at the true boundary position
      c.fillStyle = l.next ? col(1, 72) : 'rgba(255,255,255,0.35)';
      c.fillRect(Math.round(b.x) - 1, y1 + 3, 2, 5);
      if (l.next) {
        // the countdown hangs under the label, aligned the way the label is anchored to its tick
        const align = b.i === 0 ? 'left' : b.i === 4 ? 'right' : 'center';
        const anchor = align === 'left' ? b.left : align === 'right' ? b.left + b.w : b.left + b.w / 2;
        nextSlot = { i: b.i, anchor, align, y: ly + (b.lines.length > 1 ? 39 : 26), lo: 2, hi: W - 2 };
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  /**
   * @param {object} s
   * @param {boolean} s.inRange
   * @param {boolean} [s.blur]                 the cycle is too fast to draw at the current speed
   * @param {number} s.level
   * @param {number} s.M                       glyph extreme (4)
   * @param {number} s.phase                   current phase
   * @param {number} s.index                   current glyph state
   * @param {number} s.quarter                 0..3
   * @param {number} s.limit                   highest phase inside the catalogue (1 = complete cycle)
   * @param {string} s.key                     identity of the cycle (level, cycle, zone, ...)
   * @param {{name:string,date:string,time:string,passed:boolean,next:boolean,in:string}[]} s.labels  5 boundaries
   * @param {null|{phase:number,text:string}} s.hover
   * @param {boolean} s.scrubbing
   * @param {boolean} s.focused
   */
  function draw(s) {
    if (W < 60 || H < 60 || !L) return false;
    if (s.blur) return drawBlur(s);
    const { x0, x1, y0, y1, xOf, yOf } = L;
    const sig = s.inRange
      ? [
          Math.round(xOf(s.phase) * R),
          s.quarter,
          s.index,
          s.hover ? Math.round(xOf(s.hover.phase)) + s.hover.text : '-',
          s.scrubbing ? 1 : 0,
          s.focused ? 1 : 0,
          nextSlot ? 1 : 0,
        ].join('~')
      : 'off';
    const key = `${W}|${H}|${R}|${s.level}|${s.inRange}|${s.key}|${s.limit}|${s.M}|${s.labels.map((l) => `${+l.passed}${+l.next}${l.date}${l.time}`).join(';')}`;
    let repaint = false;
    if (key !== baseKey) {
      if (s.inRange) drawBase(s);
      else {
        bg.setTransform(1, 0, 0, 1, 0, 0);
        bg.clearRect(0, 0, base.width, base.height);
      }
      baseKey = key;
      repaint = true;
    }
    if (!repaint && sig === lastSig) return false;
    lastSig = sig;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(R, 0, 0, R, 0, 0);

    if (!s.inRange) {
      drawOutOfRange();
      return true;
    }

    const col = (a, l) => theme.levelColor(s.level, a, l);
    const M = s.M;
    const states = 4 * M;
    const cx = xOf(Math.min(s.phase, s.limit));

    // current quarter band, emphasised
    g.fillStyle = col(0.09);
    g.fillRect(xOf(s.quarter / 4), y0, xOf((s.quarter + 1) / 4) - xOf(s.quarter / 4), y1 - y0);

    // the past: brighter bars and line
    g.save();
    g.beginPath();
    g.rect(x0 - 2, y0 - 12, cx - x0 + 2, y1 - y0 + 24);
    g.clip();
    const bw = (x1 - x0) / states;
    g.fillStyle = col(0.42);
    for (let k = 0; k < states; k++) {
      const v = stateValue(k, M) / M;
      const ya = yOf(0);
      const yb = yOf(v);
      g.fillRect(x0 + k * bw + 1, v === 0 ? ya - 0.75 : Math.min(ya, yb), Math.max(1, bw - 2), Math.max(1.5, Math.abs(ya - yb)));
    }
    g.beginPath();
    g.moveTo(xOf(0), yOf(0));
    g.lineTo(xOf(0.25), yOf(1));
    g.lineTo(xOf(0.75), yOf(-1));
    g.lineTo(xOf(1), yOf(0));
    g.lineWidth = 2.4;
    g.lineJoin = 'round';
    g.strokeStyle = col(1, 70);
    g.stroke();
    g.restore();

    // the glyph state showing now
    {
      const k = s.index;
      const v = stateValue(k, M) / M;
      const ya = yOf(0);
      const yb = yOf(v);
      g.fillStyle = col(0.95, 66);
      g.fillRect(x0 + k * bw + 1, v === 0 ? ya - 1.25 : Math.min(ya, yb), Math.max(1.5, bw - 2), Math.max(2.5, Math.abs(ya - yb)));
    }

    // cursor
    const cur = theme.CURSOR;
    g.strokeStyle = cur;
    g.lineWidth = s.scrubbing ? 2.4 : 1.8;
    g.beginPath();
    g.moveTo(Math.round(cx) + 0.5, y0 - 6);
    g.lineTo(Math.round(cx) + 0.5, y1 + 5);
    g.stroke();
    // handle at the top
    g.beginPath();
    g.moveTo(cx - 6, y0 - 12);
    g.lineTo(cx + 6, y0 - 12);
    g.lineTo(cx, y0 - 3);
    g.closePath();
    g.fillStyle = cur;
    g.fill();
    // dot on the wave
    const dy = yOf(triangle(s.phase));
    g.beginPath();
    g.arc(cx, dy, s.scrubbing ? 6 : 4.8, 0, TAU);
    g.fillStyle = cur;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(7,9,13,0.9)';
    g.stroke();
    if (s.focused) {
      g.strokeStyle = cur;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, dy, 9, 0, TAU);
      g.stroke();
    }

    // hover marker
    if (s.hover && !s.scrubbing) {
      const hx = Math.round(xOf(s.hover.phase)) + 0.5;
      g.setLineDash([2, 3]);
      g.strokeStyle = 'rgba(231,237,243,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(hx, y0 - 4);
      g.lineTo(hx, y1 + 5);
      g.stroke();
      g.setLineDash([]);
      g.font = font(600, 10.5, true);
      const tw = g.measureText(s.hover.text).width + 12;
      const bx = Math.min(x1 - tw, Math.max(x0, hx - tw / 2));
      roundRectPath(g, bx, y0 + 4, tw, 18, 9);
      g.fillStyle = 'rgba(10,14,19,0.94)';
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.stroke();
      g.fillStyle = theme.INK;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s.hover.text, bx + tw / 2, y0 + 13.5);
    }

    g.globalAlpha = 1;
    return true;
  }

  /** The selected cycle is too short to follow at the current time-lapse speed: say so, once. */
  function drawBlur(s) {
    const key = `blur|${W}|${H}|${R}|${s.level}`;
    if (key === baseKey) return false;
    baseKey = key;
    lastSig = '';
    nextSlot = null;
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.clearRect(0, 0, base.width, base.height);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(R, 0, 0, R, 0, 0);
    const { x0, x1, y0, y1, yMid } = L;
    g.fillStyle = theme.levelColor(s.level, 0.08);
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.setLineDash([4, 5]);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, yMid);
    g.lineTo(x1, yMid);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = theme.INK_2;
    g.font = font(500, 12);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('This cycle is too fast to follow at the current speed', (x0 + x1) / 2, yMid - 12);
    g.fillStyle = theme.INK_3;
    g.fillText('slow the time-lapse down to see its wave', (x0 + x1) / 2, yMid + 8);
    return true;
  }

  function drawOutOfRange() {
    const { x0, x1, y0, y1, yMid } = L;
    g.setLineDash([4, 5]);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, yMid);
    g.lineTo(x1, yMid);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = theme.INK_3;
    g.font = font(500, 12);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('Outside the Saros 141 catalogue', (x0 + x1) / 2, (y0 + y1) / 2 - 12);
    g.fillText('no cycle to draw', (x0 + x1) / 2, (y0 + y1) / 2 + 8);
  }

  return {
    resize,
    draw,
    invalidate() {
      baseKey = lastSig = '';
    },
    get layout() {
      return L;
    },
    /** Where the countdown to the next boundary goes (css px in the canvas), or null. Refreshed by `draw`. */
    get nextSlot() {
      return nextSlot;
    },
    /** Phase under a css-px x coordinate. */
    phaseAtX(x) {
      return L ? L.phaseOf(x) : 0;
    },
    /** Is (x, y) inside the interactive plot area (plus a margin for the handle)? */
    inPlot(x, y) {
      return !!L && x >= L.x0 - 12 && x <= L.x1 + 12 && y >= L.y0 - 16 && y <= L.y1 + 10;
    },
    glyphExtreme,
  };
}
