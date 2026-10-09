/**
 * Live spectrum + scope of the output (AnalyserNode). The spectrum has a log frequency axis; the
 * voices of the chord stand on it as ticks in their level colour, as tall as the voice is loud right now,
 * so the picture reads "which cycles are sounding, where, and how much" even before any sound plays.
 */
import { createCanvasView } from './canvas.js';
import { LINE, TEAL, levelColor } from '../../core/theme.js';

const SMALL = '#8191a1'; // small text on the dark canvas: at least 4.5 : 1
const F_MIN = 40;
const F_MAX = 8000;
const DB_MIN = -92;
const DB_MAX = -18;
const SCOPE_H = 38;
const GRID = [
  [55, 'A1'],
  [110, 'A2'],
  [220, 'A3'],
  [440, 'A4'],
  [880, 'A5'],
  [1760, 'A6'],
  [3520, 'A7'],
];

/**
 * Which ticks get a letter: walk the ticks left to right (they come in level order, which is not
 * frequency order) and label one when it stands more than `gap` px right of the previous label.
 * @param {{key:any, x:number}[]} items
 * @returns {Set<any>} keys of the labelled ticks
 */
export function labelSlots(items, gap = 13) {
  const out = new Set();
  let last = -Infinity;
  for (const it of [...items].sort((a, b) => a.x - b.x)) {
    if (it.x - last > gap) {
      out.add(it.key);
      last = it.x;
    }
  }
  return out;
}

export function createScope(canvas) {
  const view = createCanvasView(canvas);
  let freq = null;
  let wave = null;
  const logSpan = Math.log(F_MAX / F_MIN);

  /**
   * @param {object} s
   * @param {AnalyserNode|null} s.analyser
   * @param {{level:number, letter:string, hz:number, loud:number, on:boolean, flash?:boolean}[]} s.voices
   * @param {boolean} s.enabled
   * @param {string} s.hint  text shown when nothing is audible
   */
  function draw({ analyser, voices, enabled, hint }) {
    if (!view.visible) return;
    const { g, w, h } = view.begin();
    const padL = 6;
    const padR = 6;
    const top = 8;
    const specH = h - SCOPE_H - 22 - top;
    const bottom = top + specH;
    const pw = w - padL - padR;
    const xOf = (f) => padL + (Math.log(f / F_MIN) / logSpan) * pw;

    // grid: the A's of the keyboard, labelled where there is room
    g.lineWidth = 1;
    g.font = '10px ui-sans-serif, system-ui, sans-serif';
    g.textBaseline = 'alphabetic';
    for (const [f, name] of GRID) {
      const x = Math.round(xOf(f)) + 0.5;
      g.strokeStyle = LINE;
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, bottom);
      g.stroke();
      g.fillStyle = SMALL;
      g.textAlign = 'center';
      g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x, bottom + 12);
      if (w > 380) {
        g.fillStyle = '#6e7f90';
        g.fillText(name, x, bottom + 22);
      }
    }
    g.strokeStyle = LINE;
    g.beginPath();
    g.moveTo(padL, bottom + 0.5);
    g.lineTo(w - padR, bottom + 0.5);
    g.stroke();

    // spectrum
    let drewSpectrum = false;
    if (analyser && enabled !== undefined) {
      const n = analyser.frequencyBinCount;
      if (!freq || freq.length !== n) freq = new Float32Array(n);
      analyser.getFloatFrequencyData(freq);
      const df = analyser.context.sampleRate / analyser.fftSize;
      const cols = Math.max(2, Math.floor(pw));
      const pts = [];
      let any = false;
      for (let c = 0; c < cols; c++) {
        const f0 = F_MIN * Math.exp((c / cols) * logSpan);
        const f1 = F_MIN * Math.exp(((c + 1) / cols) * logSpan);
        const i0 = Math.max(1, Math.floor(f0 / df));
        const i1 = Math.min(n - 1, Math.max(i0, Math.floor(f1 / df)));
        let m = -Infinity;
        if (f1 - f0 < df && i0 + 1 < n) {
          // a column narrower than one FFT bin: interpolate instead of drawing blocks
          const pos = Math.sqrt(f0 * f1) / df;
          const i = Math.max(1, Math.min(n - 2, Math.floor(pos)));
          const fr = Math.min(1, Math.max(0, pos - i));
          m = freq[i] * (1 - fr) + freq[i + 1] * fr;
        } else {
          for (let i = i0; i <= i1; i++) if (freq[i] > m) m = freq[i];
        }
        if (!Number.isFinite(m)) m = DB_MIN;
        if (m > DB_MIN + 1) any = true;
        const u = Math.min(1, Math.max(0, (m - DB_MIN) / (DB_MAX - DB_MIN)));
        pts.push([padL + (c / cols) * pw, bottom - u * specH]);
      }
      if (any) {
        drewSpectrum = true;
        const grad = g.createLinearGradient(0, top, 0, bottom);
        grad.addColorStop(0, 'rgba(79,209,197,0.34)');
        grad.addColorStop(1, 'rgba(79,209,197,0.02)');
        g.beginPath();
        g.moveTo(pts[0][0], bottom);
        for (const [x, y] of pts) g.lineTo(x, y);
        g.lineTo(pts.at(-1)[0], bottom);
        g.closePath();
        g.fillStyle = grad;
        g.fill();
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.strokeStyle = TEAL;
        g.lineWidth = 1.25;
        g.stroke();
      }
    }

    // the voices of the chord: tick height = loudness now
    g.textAlign = 'center';
    const shown = voices.filter((v) => v.hz >= F_MIN && v.hz <= F_MAX);
    const labelled = labelSlots(shown.filter((v) => v.on).map((v) => ({ key: v.level, x: xOf(v.hz) })));
    for (const v of shown) {
      const x = Math.round(xOf(v.hz)) + 0.5;
      const hgt = 4 + v.loud * (specH - 14);
      const alpha = v.on ? (enabled ? 0.95 : 0.55) : 0.18;
      g.strokeStyle = levelColor(v.level, alpha, v.on ? 66 : 50);
      g.lineWidth = 2;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, bottom - 1);
      g.lineTo(x, bottom - hgt);
      g.stroke();
      g.fillStyle = levelColor(v.level, alpha, v.on ? 72 : 50);
      g.beginPath();
      g.arc(x, bottom - hgt, 2.6, 0, Math.PI * 2);
      g.fill();
      if (v.flash) {
        // a note of "Hear this moment" is sounding right now
        g.strokeStyle = levelColor(v.level, 0.95, 78);
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, bottom - hgt, 7, 0, Math.PI * 2);
        g.stroke();
      }
      if (labelled.has(v.level)) {
        g.fillStyle = levelColor(v.level, enabled ? 0.95 : 0.6, 74);
        g.fillText(v.letter, x, Math.max(top + 9, bottom - hgt - 6));
      }
    }
    g.lineCap = 'butt';

    // scope strip
    const sy = h - SCOPE_H / 2 - 1;
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(padL, sy + 0.5);
    g.lineTo(w - padR, sy + 0.5);
    g.stroke();
    let drewWave = false;
    if (analyser) {
      const n = analyser.fftSize;
      if (!wave || wave.length !== n) wave = new Float32Array(n);
      analyser.getFloatTimeDomainData(wave);
      const span = Math.min(1536, n >> 2);
      let s0 = 0;
      for (let i = 1; i < n - span; i++) {
        if (wave[i - 1] < 0 && wave[i] >= 0) {
          s0 = i;
          break;
        }
      }
      let pk = 0;
      for (let i = 0; i < span; i++) pk = Math.max(pk, Math.abs(wave[s0 + i]));
      if (pk > 1e-5) {
        drewWave = true;
        const gain = Math.min(14, 0.9 / Math.max(pk, 0.02)) * (SCOPE_H / 2 - 3);
        g.beginPath();
        for (let x = 0; x < pw; x++) {
          const y = sy - wave[s0 + Math.floor((x / pw) * (span - 1))] * gain;
          if (x) g.lineTo(padL + x, y);
          else g.moveTo(padL + x, y);
        }
        g.strokeStyle = 'rgba(79,209,197,0.9)';
        g.lineWidth = 1.2;
        g.stroke();
      }
    }

    if (!drewSpectrum && !drewWave && hint) {
      g.fillStyle = SMALL;
      g.font = '12px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(hint, w / 2, top + 16);
    }
  }

  return {
    draw,
    /** the canvas was resized (and so cleared) since it was last drawn */
    get stale() {
      return view.stale;
    },
    destroy: () => view.destroy(),
  };
}
