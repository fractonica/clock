/**
 * Pitch-class ring: the chord as a polar chart. The angle is the folded pitch class (top = the base
 * pitch, clockwise, 12 semitone ticks), the radius is the depth (alpha outside, xi inside), the size and
 * glow of a dot is how loud that cycle is right now. Levels that share a pitch class (theta, iota) sit
 * on the same spoke at different radii.
 */
import { createCanvasView } from './canvas.js';
import { CURSOR, INK, INK_2, INK_3, LINE, levelColor } from '../../core/theme.js';
import { noteOf } from '../../audio/tuning.js';
import { spokeLabel } from '../../audio/words.js';

const SEMITONES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const TAU = Math.PI * 2;
const SMALL = '#8191a1'; // small text on the dark canvas: at least 4.5 : 1

export function createRing(canvas) {
  const view = createCanvasView(canvas);
  let dots = [];

  /**
   * @param {object} s
   * @param {{level:number, letter:string, pcCents:number}[]} s.rows
   * @param {boolean[]} s.on      which levels sound
   * @param {number[]} s.loud     0..1 loudness of each level now
   * @param {boolean} s.enabled   engine running
   * @param {number} s.selected   selected level (0-based) or -1
   * @param {number} s.baseHz
   * @param {boolean} s.reduced   prefers-reduced-motion: no glow
   * @param {Set<number>} [s.flash]  levels whose note of "Hear this moment" is sounding right now
   * @param {{ground:{head:string, sub:string}}|null} [s.pure]  pure mode: spokes are named in cents (no note names), the centre
   *   names the ground (`head` / `sub` from words.groundWords), the corner is as before
   */
  function draw({ rows, on, loud, enabled, selected, baseHz, reduced, flash, pure = null }) {
    if (!view.visible) return;
    const { g, w, h } = view.begin();
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - (pure ? 32 : 24); // pure: the spoke labels ("300¢") are wider than note names
    const rIn = R * 0.42;
    const radius = (L) => R - ((R - rIn) * L) / (rows.length - 1);
    const angle = (cents) => -Math.PI / 2 + (cents / 1200) * TAU;

    // depth rings and semitone spokes
    g.lineWidth = 1;
    for (let L = 0; L < rows.length; L++) {
      g.strokeStyle = L === selected ? 'rgba(138,180,255,0.35)' : 'rgba(43,58,74,0.55)';
      g.beginPath();
      g.arc(cx, cy, radius(L), 0, TAU);
      g.stroke();
    }
    const base = noteOf(baseHz);
    g.font = '10px ui-sans-serif, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let k = 0; k < 12; k++) {
      const a = angle(k * 100);
      const c = Math.cos(a);
      const s = Math.sin(a);
      g.strokeStyle = k === 0 ? INK_3 : LINE;
      g.beginPath();
      g.moveTo(cx + c * (rIn - 6), cy + s * (rIn - 6));
      g.lineTo(cx + c * (R + 5), cy + s * (R + 5));
      g.stroke();
      g.fillStyle = k === 0 ? INK : SMALL;
      const name = pure ? spokeLabel(k) : SEMITONES[(((base.midi + k) % 12) + 12) % 12];
      if (name) g.fillText(name, cx + c * (R + 14), cy + s * (R + 14));
    }

    // the voices
    dots = [];
    for (let L = 0; L < rows.length; L++) {
      const a = angle(rows[L].pcCents);
      const r = radius(L);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const lv = on[L] ? loud[L] : 0;
      dots.push({ level: L, x, y });
      if (!on[L]) {
        g.strokeStyle = 'rgba(108,124,140,0.55)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x, y, 3, 0, TAU);
        g.stroke();
        continue;
      }
      const size = 3 + 5 * lv;
      if (enabled && lv > 0.2 && !reduced) {
        g.shadowColor = levelColor(L, 0.9, 62);
        g.shadowBlur = 5 + 12 * lv;
      }
      g.fillStyle = levelColor(L, (enabled ? 0.45 : 0.3) + 0.55 * lv, 64);
      g.beginPath();
      g.arc(x, y, size, 0, TAU);
      g.fill();
      g.shadowBlur = 0;
      g.shadowColor = 'transparent';
      if (L === selected) {
        g.strokeStyle = CURSOR;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, size + 3.5, 0, TAU);
        g.stroke();
      }
      if (flash?.has(L)) {
        g.strokeStyle = levelColor(L, 0.95, 78);
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, size + 6, 0, TAU);
        g.stroke();
      }
      g.fillStyle = levelColor(L, 0.95, 78);
      g.font = '600 9px ui-sans-serif, system-ui, sans-serif';
      const lx = x + Math.cos(a) * (size + 8);
      const ly = y + Math.sin(a) * (size + 8);
      g.fillText(rows[L].letter, lx, ly);
    }

    // centre: the base pitch
    g.fillStyle = INK;
    g.font = '600 15px ui-sans-serif, system-ui, sans-serif';
    g.fillText(pure ? pure.ground.head : base.name, cx, cy - 6);
    g.fillStyle = INK_2;
    g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.fillText(pure ? pure.ground.sub : `${baseHz.toFixed(baseHz % 1 ? 1 : 0)} Hz`, cx, cy + 9);
    // the selected level's exact interval, in the corner
    if (selected >= 0 && rows[selected]) {
      const r = rows[selected];
      g.textAlign = 'left';
      g.fillStyle = levelColor(selected, 1, 72);
      g.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      g.fillText(`${r.letter} ${r.depth}`, 9, 14);
      g.fillStyle = INK_2;
      g.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
      g.fillText(`${r.pcCents.toFixed(1)}¢`, 9, 28);
    }
  }

  /** Level whose dot is within `slop` px of a client point, or -1. */
  function hit(clientX, clientY, slop = 12) {
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    let best = -1;
    let bd = slop * slop;
    for (const d of dots) {
      const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
      if (dd <= bd) {
        bd = dd;
        best = d.level;
      }
    }
    return best;
  }

  return {
    draw,
    hit,
    /** the canvas was resized (and so cleared) since it was last drawn */
    get stale() {
      return view.stale;
    },
    destroy: () => view.destroy(),
  };
}
