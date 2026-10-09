/**
 * Canvas renderer of the concentric cycle dial.
 *
 * Three stacked canvases keep the per-frame cost small (the browser composites them, no blits in JS):
 *   base     tracks, current-sector wedges, sector ticks, quarter notches, funnels, glows of the blurred
 *            rings   (repainted when the selection, the range, a sector index, the layout or a toggle changes)
 *   live     progress arcs, hands, quarter beads and the hover wedge   (repainted when something moved)
 *   over     ring labels and the quarter labels of the selected ring   (repainted when a label changes)
 * Frames in which no hand moved by a visible amount are skipped altogether.
 */
import {
  TAU,
  arcAngle,
  pointAt,
  ringLayout,
  dialLayoutOptions,
  hitTest,
  sectorOf,
  funnelCurves,
  isBlur,
  isFast,
} from './geometry.js';
import { counterText } from './text.js';
import { roundRectPath, UI_FONT, MONO_FONT } from './canvas.js';

const HALO = 'rgba(11, 16, 21, 0.92)';
const KNOB_EDGE = 'rgba(7, 9, 13, 0.9)';
const GREY = (a) => `rgba(108, 124, 140, ${a})`;
const QUARTER_LABELS = ['begin', 'peak', 'node', 'valley'];
const QUARTER_PHASES = [0.25, 0.5, 0.75];

/**
 * @param {HTMLCanvasElement} canvas   the live layer (receives the pointer events)
 * @param {object} theme               core/theme.js
 * @param {{base?:HTMLCanvasElement, over?:HTMLCanvasElement}} [layers]  static layers stacked below / above `canvas`
 */
export function createDial(canvas, theme, layers = {}) {
  const g = canvas.getContext('2d');
  const base = layers.base ?? document.createElement('canvas');
  const over = layers.over ?? document.createElement('canvas');
  const bg = base.getContext('2d');
  const og = over.getContext('2d');

  let S = 0; // css size (square)
  let R = 1; // device pixel ratio
  let layout = null;
  let baseKey = '';
  let overKey = '';
  let lastSig = '';
  let lastShown = [];
  const frozen = new Map(); // level -> {phase, at}
  let labelSpans = [];
  let labelHalf = 6; // half the text height of the ring labels (css px)
  let pickState = { selected: -1, levels: [] }; // what the last frame showed, for pick()
  const palettes = new Map();
  const stats = { base: 0, baseN: 0, over: 0, overN: 0, frame: 0, frameN: 0 };

  // ------------------------------------------------------------------------------------------
  const pal = (L) => {
    let p = palettes.get(L);
    if (!p) {
      const c = theme.levelColor;
      p = {
        fill: c(L, 0.05),
        fillSel: c(L, 0.12),
        edge: c(L, 0.15),
        edgeSel: c(L, 0.72),
        track: c(L, 0.12),
        sector: c(L, 0.13),
        sectorSel: c(L, 0.27),
        tick: c(L, 0.24),
        tickSel: c(L, 0.6),
        funnel: c(L, 0.07),
        funnelSel: c(L, 0.17),
        tail: c(L, 0.24),
        mid: c(L, 0.5),
        head: c(L, 0.96, 68),
        solid: c(L, 0.9),
        knob: c(L, 1, 80),
        halo: c(L, 0.42),
        glow: c(L, 0.12),
        blur: c(L, 0.2),
        text: c(L, 1, 76),
        dim: c(L, 0.85, 70),
      };
      palettes.set(L, p);
    }
    return p;
  };

  function resize(size, ratio) {
    const s = Math.max(0, Math.floor(size));
    if (s === S && ratio === R) return false;
    S = s;
    R = ratio;
    const px = Math.max(1, Math.round(S * R));
    for (const c of [canvas, base, over]) {
      c.width = px;
      c.height = px;
    }
    layout = null;
    baseKey = overKey = lastSig = '';
    return true;
  }

  function ensureLayout(count) {
    if (!layout || layout.count !== count || layout.size !== S) {
      layout = ringLayout(dialLayoutOptions(S, count));
      baseKey = overKey = lastSig = '';
    }
    return layout;
  }

  /** Radius of the hand's knob on a ring. */
  const knobRadius = (selected) => Math.max(2.6, layout.thick * (selected ? 0.62 : 0.46));

  const ringGeom = (i) => {
    const r = layout.rings[i];
    const half = layout.thick / 2;
    return { mid: r.mid, ro: r.mid + half, ri: r.mid - half };
  };

  function annulus(c, ro, ri) {
    c.beginPath();
    c.arc(layout.cx, layout.cy, ro, 0, TAU);
    c.moveTo(layout.cx + ri, layout.cy);
    c.arc(layout.cx, layout.cy, ri, 0, TAU, true);
  }
  function wedge(c, ro, ri, p0, p1) {
    const a0 = arcAngle(p0);
    const a1 = arcAngle(p1);
    c.beginPath();
    c.arc(layout.cx, layout.cy, ro, a0, a1);
    c.arc(layout.cx, layout.cy, ri, a1, a0, true);
    c.closePath();
  }
  function radial(c, r0, r1, phase) {
    const a = arcAngle(phase);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    c.moveTo(layout.cx + r0 * cos, layout.cy + r0 * sin);
    c.lineTo(layout.cx + r1 * cos, layout.cy + r1 * sin);
  }

  // ------------------------------------------------------------------------------------------
  // base layer
  // ------------------------------------------------------------------------------------------
  function drawBase(s) {
    const { cx, cy } = layout;
    bg.setTransform(R, 0, 0, R, 0, 0);
    bg.clearRect(0, 0, S, S);

    // the hole: a faint disc so the read-out has a stage
    const hole = bg.createRadialGradient(cx, cy, layout.rHole * 0.2, cx, cy, layout.rHole);
    hole.addColorStop(0, 'rgba(255,255,255,0.025)');
    hole.addColorStop(1, 'rgba(255,255,255,0.008)');
    bg.fillStyle = hole;
    bg.beginPath();
    bg.arc(cx, cy, layout.rHole - 1, 0, TAU);
    bg.fill();

    const n = s.levels.length;
    // funnels first: they sit in the lanes between rings
    for (let i = 0; i < n - 1; i++) {
      const lv = s.readings[i];
      if (!s.show.funnels || !s.inRange || !lv || s.blur[i]) continue;
      const a = ringGeom(i);
      const b = ringGeom(i + 1);
      const f = s.infos[i].factor;
      const sec = sectorOf(s.shown[i], f);
      const { left, right } = funnelCurves(a.ri, b.ro, sec / f, (sec + 1) / f, 36);
      const p = pal(s.levels[i + 1]);
      bg.beginPath();
      const start = pointAt(cx, cy, a.ri, sec / f);
      bg.moveTo(start.x, start.y);
      bg.arc(cx, cy, a.ri, arcAngle(sec / f), arcAngle((sec + 1) / f));
      for (const q of right) {
        const pt = pointAt(cx, cy, q.r, q.phase);
        bg.lineTo(pt.x, pt.y);
      }
      bg.arc(cx, cy, b.ro, arcAngle(1), arcAngle(0), true);
      for (let k = left.length - 1; k >= 0; k--) {
        const pt = pointAt(cx, cy, left[k].r, left[k].phase);
        bg.lineTo(pt.x, pt.y);
      }
      bg.closePath();
      const chosen = s.levels[i] === s.selected;
      bg.fillStyle = chosen ? p.funnelSel : p.funnel;
      bg.fill();
    }

    for (let i = 0; i < n; i++) {
      const L = s.levels[i];
      const info = s.infos[i];
      const lv = s.readings[i];
      const sel = L === s.selected && s.inRange;
      const { mid, ro, ri } = ringGeom(i);
      const p = pal(L);

      // track
      annulus(bg, ro, ri);
      bg.fillStyle = s.inRange ? (sel ? p.fillSel : p.fill) : GREY(0.06);
      bg.fill();
      bg.lineWidth = 1;
      bg.strokeStyle = s.inRange ? (sel ? p.edgeSel : p.edge) : GREY(0.18);
      bg.beginPath();
      bg.arc(cx, cy, ro, 0, TAU);
      bg.moveTo(cx + ri, cy);
      bg.arc(cx, cy, ri, 0, TAU);
      bg.stroke();
      // centre line of the track
      bg.beginPath();
      bg.arc(cx, cy, mid, 0, TAU);
      bg.lineWidth = Math.max(1, layout.thick * 0.3);
      bg.strokeStyle = s.inRange ? p.track : GREY(0.1);
      bg.stroke();
      if (!s.inRange || !lv) continue;

      const blur = s.blur[i];
      if (blur) {
        // far too fast for a hand: a steady glow instead of a strobing line
        annulus(bg, ro, ri);
        bg.fillStyle = p.blur;
        bg.fill();
      }
      // running sector
      if (s.show.sectors && !blur) {
        const sec = sectorOf(s.shown[i], info.factor);
        wedge(bg, ro, ri, sec / info.factor, (sec + 1) / info.factor);
        bg.fillStyle = sel ? p.sectorSel : p.sector;
        bg.fill();
      }
      // sector ticks
      if (s.show.sectors && !blur) {
        bg.beginPath();
        for (let k = 0; k < info.factor; k++) radial(bg, ri, ro, k / info.factor);
        bg.lineWidth = 1;
        bg.strokeStyle = sel ? p.tickSel : p.tick;
        bg.stroke();
      }
      // quarter notches across the slot
      if (s.show.quarters) {
        bg.beginPath();
        radial(bg, ri - layout.band * 0.18, ro + layout.band * 0.18, 0);
        for (const q of QUARTER_PHASES) radial(bg, ri - layout.band * 0.1, ro + layout.band * 0.1, q);
        bg.lineWidth = sel ? 1.6 : 1.1;
        bg.strokeStyle = sel ? p.tickSel : p.edge;
        bg.stroke();
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // overlay layer: labels
  // ------------------------------------------------------------------------------------------
  function arcText(c, segs, r, gap) {
    const items = [];
    let total = 0;
    for (const seg of segs) {
      c.font = seg.font;
      for (const ch of [...seg.text]) {
        const w = c.measureText(ch).width;
        items.push({ ch, w, color: seg.color, font: seg.font });
        total += w;
      }
    }
    let a = -(total + gap) / r;
    const a0 = a;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    for (const it of items) {
      const mid = a + it.w / (2 * r);
      c.save();
      c.translate(layout.cx, layout.cy);
      c.rotate(mid);
      c.font = it.font;
      c.lineWidth = 3;
      c.strokeStyle = HALO;
      c.strokeText(it.ch, 0, -r);
      c.fillStyle = it.color;
      c.fillText(it.ch, 0, -r);
      c.restore();
      a += it.w / r;
    }
    return { a0, a1: -gap / r };
  }

  function pill(c, text, x, y, fs, p, align) {
    c.font = `600 ${fs}px ${UI_FONT}`;
    const w = c.measureText(text).width + 9;
    const h = fs + 5;
    const left = align === 'left' ? x : x - w / 2;
    roundRectPath(c, left, y - h / 2, w, h, h / 2);
    c.fillStyle = 'rgba(7, 9, 13, 0.9)';
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = p.edgeSel;
    c.stroke();
    c.fillStyle = p.text;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, left + w / 2, y + 0.5);
  }

  function drawOverlay(s) {
    og.setTransform(R, 0, 0, R, 0, 0);
    og.clearRect(0, 0, S, S);
    labelSpans = [];
    const n = s.levels.length;
    const fs = Math.max(8.5, Math.min(11.5, layout.band * 0.62)); // 8.5 px is the floor on phones (the picker also names every ring)
    labelHalf = fs * 0.5 + 1.5;
    const showAll = layout.band >= 11;
    for (let i = 0; i < n; i++) {
      const L = s.levels[i];
      const info = s.infos[i];
      const lv = s.readings[i];
      const sel = L === s.selected && s.inRange;
      if (!showAll && !sel) continue;
      const p = pal(L);
      const { mid } = ringGeom(i);
      const letter = `600 ${fs}px ${UI_FONT}`;
      const mono = `500 ${fs - 0.5}px ${MONO_FONT}`;
      const segs = [
        { text: info.letter, color: s.inRange ? p.text : GREY(0.9), font: letter },
        { text: ` ${info.depth}`, color: s.inRange ? p.dim : GREY(0.8), font: mono },
      ];
      if (s.inRange && lv && !s.blur[i]) {
        segs.push({ text: ` ${counterText(lv)}`, color: 'rgba(231, 237, 243, 0.62)', font: mono });
      }
      // the text ends clear of the hand's knob, which sits right at 12 o'clock whenever a cycle turns over
      labelSpans[i] = arcText(og, segs, mid, knobRadius(sel) + 3);
    }
    // quarter labels on the selected ring
    if (s.show.quarters && s.inRange) {
      const i = s.levels.indexOf(s.selected);
      if (i >= 0) {
        const p = pal(s.selected);
        const { mid } = ringGeom(i);
        const qf = Math.max(8, Math.min(11, layout.thick * 0.7));
        QUARTER_LABELS.forEach((name, q) => {
          const pt = pointAt(layout.cx, layout.cy, mid, q * 0.25);
          if (q === 0) pill(og, name, pt.x + 5, pt.y, qf, p, 'left');
          else pill(og, name, pt.x, pt.y, qf, p, 'center');
        });
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // dynamic frame
  // ------------------------------------------------------------------------------------------
  /**
   * @param {object} s
   * @param {number[]} s.levels            levels shown, outermost ring first
   * @param {object[]} s.infos             model.levelInfo(L) per ring
   * @param {(object|null)[]} s.readings   frame.level(L) per ring
   * @param {boolean} s.inRange
   * @param {number} s.selected            selected level
   * @param {{sectors:boolean,quarters:boolean,funnels:boolean}} s.show
   * @param {null|{ring:number,sector:number|null}} s.hover
   * @param {boolean} s.reduced            prefers-reduced-motion
   * @param {number} s.speed               displayed seconds per real second (1 live, 0 paused, N time-lapse)
   * @param {number} [s.epoch]             counts discontinuities of the displayed time (jumps, rate changes); under
   *                                       reduced motion a frozen hand moves only when it changes
   * @returns {boolean} true when the canvas was repainted
   */
  function draw(s) {
    if (S < 40) return false;
    const n = s.levels.length;
    ensureLayout(n);
    const speed = Math.abs(s.speed ?? 1);
    s.blur = s.blur ?? s.infos.map((info) => isBlur(info, speed));

    // phases to display (under reduced motion the fast rings keep the phase they had when the time last jumped)
    const shown = new Array(n);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const lv = s.readings[i];
      if (!lv) {
        shown[i] = null;
        continue;
      }
      let ph = lv.phase;
      if (s.reduced && isFast(s.infos[i], speed)) {
        let f = frozen.get(s.levels[i]);
        if (!f || f.epoch !== s.epoch) {
          f = { phase: lv.phase, epoch: s.epoch };
          frozen.set(s.levels[i], f);
        }
        ph = f.phase;
      }
      shown[i] = ph;
      if (s.blur[i]) continue; // a steady glow: its phase is irrelevant
      const prev = lastShown[i];
      if (prev === undefined || prev === null) moved = Infinity;
      else {
        let d = Math.abs(ph - prev);
        if (d > 0.5) d = 1; // wrapped around: always repaint
        moved = Math.max(moved, d * TAU * layout.rings[i].mid);
      }
    }

    // static layers
    s.shown = shown;
    pickState = { selected: s.selected, levels: s.levels };
    const sectors = s.readings.map((lv, i) => (lv && !s.blur[i] ? sectorOf(shown[i], s.infos[i].factor) : -1));
    const blurs = s.blur.map(Number).join('');
    const labels = s.readings.map((lv, i) => (lv ? (s.blur[i] ? -2 : lv.local) : -1));
    const flags = `${+s.show.sectors}${+s.show.quarters}${+s.show.funnels}${+s.inRange}`;
    const common = `${S}|${R}|${n}|${s.levels[0]}|${s.selected}|${flags}`;
    const nextBase = `${common}|${blurs}|${sectors.join(',')}`;
    const nextOver = `${common}|${labels.join(',')}`;
    let repaint = false;
    if (nextBase !== baseKey) {
      const t0 = performance.now();
      drawBase(s);
      stats.base += performance.now() - t0;
      stats.baseN++;
      baseKey = nextBase;
      repaint = true;
    }
    if (nextOver !== overKey) {
      const t0 = performance.now();
      drawOverlay(s);
      stats.over += performance.now() - t0;
      stats.overN++;
      overKey = nextOver;
      repaint = true;
    }
    const hoverKey = s.hover ? `${s.hover.ring}:${s.hover.sector}` : '-';
    const sig = `${hoverKey}|${s.reduced}`;
    if (!repaint && sig === lastSig && moved < 0.18) return false;
    lastSig = sig;
    lastShown = shown;

    const tf = performance.now();
    const { cx, cy } = layout;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(R, 0, 0, R, 0, 0);

    if (s.inRange) {
      for (let i = 0; i < n; i++) {
        const lv = s.readings[i];
        if (!lv) continue;
        const L = s.levels[i];
        const sel = L === s.selected;
        const p = pal(L);
        const { mid } = ringGeom(i);
        const ph = shown[i];
        const w = layout.thick * (sel ? 0.7 : 0.46);

        if (s.blur[i]) continue; // painted as a steady glow on the base layer

        const a0 = arcAngle(0);
        const a1 = arcAngle(ph);
        if (ph > 0.0004) {
          if (sel) {
            g.beginPath();
            g.arc(cx, cy, mid, a0, a1);
            g.lineWidth = layout.thick * 1.05;
            g.lineCap = 'butt';
            g.strokeStyle = p.glow;
            g.stroke();
          }
          let style = p.solid;
          if (g.createConicGradient) {
            const grad = g.createConicGradient(a0, cx, cy);
            const end = Math.min(1, Math.max(1e-4, ph));
            grad.addColorStop(0, p.tail);
            grad.addColorStop(end * 0.55, p.mid);
            grad.addColorStop(end, p.head);
            style = grad;
          }
          g.beginPath();
          g.arc(cx, cy, mid, a0, a1);
          g.lineWidth = w;
          g.lineCap = 'round';
          g.strokeStyle = style;
          g.stroke();
        }

        // quarter beads: filled once passed, hollow while ahead
        if (s.show.quarters) {
          const br = Math.max(1.5, layout.thick * (sel ? 0.2 : 0.16));
          g.beginPath();
          for (const q of QUARTER_PHASES) {
            if (ph >= q) {
              const pt = pointAt(cx, cy, mid, q);
              g.moveTo(pt.x + br, pt.y);
              g.arc(pt.x, pt.y, br, 0, TAU);
            }
          }
          g.fillStyle = p.head;
          g.fill();
          g.beginPath();
          for (const q of QUARTER_PHASES) {
            if (ph < q) {
              const pt = pointAt(cx, cy, mid, q);
              g.moveTo(pt.x + br, pt.y);
              g.arc(pt.x, pt.y, br, 0, TAU);
            }
          }
          g.fillStyle = KNOB_EDGE;
          g.fill();
          g.lineWidth = 1;
          g.strokeStyle = p.dim;
          g.stroke();
        }

        // the hand: a knob at the head of the arc
        const head = pointAt(cx, cy, mid, ph);
        const kr = knobRadius(sel);
        if (sel) {
          const halo = g.createRadialGradient(head.x, head.y, kr * 0.4, head.x, head.y, kr * 3.2);
          halo.addColorStop(0, p.halo);
          halo.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = halo;
          g.beginPath();
          g.arc(head.x, head.y, kr * 3.2, 0, TAU);
          g.fill();
        }
        g.beginPath();
        g.arc(head.x, head.y, kr, 0, TAU);
        g.fillStyle = p.knob;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = KNOB_EDGE;
        g.stroke();
      }

      // hover wedge
      if (s.hover && s.hover.ring < n) {
        const i = s.hover.ring;
        const { ro, ri } = ringGeom(i);
        const p = pal(s.levels[i]);
        if (s.hover.sector !== null && s.hover.sector !== undefined) {
          const f = s.infos[i].factor;
          wedge(g, ro + 1, ri - 1, s.hover.sector / f, (s.hover.sector + 1) / f);
          g.fillStyle = 'rgba(255, 255, 255, 0.12)';
          g.fill();
          g.lineWidth = 1.4;
          g.strokeStyle = p.edgeSel;
          g.stroke();
        } else {
          annulus(g, ro + 1, ri - 1);
          g.fillStyle = 'rgba(255, 255, 255, 0.06)';
          g.fill();
        }
      }
    }

    stats.frame += performance.now() - tf;
    stats.frameN++;
    return true;
  }

  // ------------------------------------------------------------------------------------------
  /**
   * Pointer pick in css px relative to the canvas: ring / sector / label under the pointer.
   * A ring's label is a small extra target for selecting a ring that is not selected yet: it only counts
   * within the text's own height, and never on the selected ring, so no sector is ever out of reach there.
   */
  function pick(x, y) {
    if (!layout) return null;
    const h = hitTest(layout, x, y);
    if (!h || h.zone !== 'ring') return h;
    const span = labelSpans[h.ring];
    if (span && pickState.levels[h.ring] !== pickState.selected && Math.abs(h.radial - 0.5) * layout.band <= labelHalf) {
      const rad = h.phase < 0.5 ? h.phase * TAU : h.phase * TAU - TAU;
      if (rad >= span.a0 - 0.02 && rad <= span.a1 + 0.02) return { ...h, label: true };
    }
    return h;
  }

  return {
    resize,
    draw,
    pick,
    ensureLayout,
    /** Force a repaint on the next draw (theme / font change). */
    invalidate() {
      baseKey = overKey = lastSig = '';
      lastShown = [];
      frozen.clear();
    },
    get layout() {
      return layout;
    },
    /** Accumulated repaint costs in ms and counts (debug). */
    stats,
    get size() {
      return S;
    },
    /** Phases the hands were last drawn at (frozen ones differ from the live phase under reduced motion). */
    get shown() {
      return lastShown.slice();
    },
    /** Css-px centre of ring `i` at a dial phase, for anchoring tooltips. */
    anchor(i, phase) {
      if (!layout || !layout.rings[i]) return null;
      return pointAt(layout.cx, layout.cy, layout.rings[i].mid, phase);
    },
  };
}
