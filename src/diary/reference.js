/**
 * The reference sheet of the diary (docs/design/90-diary.md, "Reference sheet"): pure data and number formatting.
 *
 *   ladderOf(model, t)              the 63 levels of the harmonic hierarchy (SPEC §3): factor, cycles per Alpha, length
 *                                   in the eclipse interval holding t, frequency, cycles per Blink, frequency band
 *   milestonesOf(model, pure, ...)  the Alpha holding a Delta, its 5 Betas and 65 Gammas with their thresholds, and the
 *                                   eclipses of the catalogue inside that Alpha (they fall on Alpha's quarter thresholds,
 *                                   and on Beta's and Gamma's: SPEC §3.1, a level-L cycle spans 4 / P(L) Saros)
 *   periodText(s) · frequencyText(hz) · sci(x, unit) · bigText(n) · bandOf(hz)
 *
 * No DOM; the renderer (render/reference.js) only draws what this returns.
 */

/** Levels on the ladder: depth 1 (α) to depth 63 (ο2, 4.83 × 10⁻⁴³ s); the next one is the Planck time. */
export const LADDER_LEVELS = 63;
/** The Planck time (CODATA 2018), seconds. */
export const PLANCK_TIME = 5.391247e-44;
/** Level of the Blink (ν): the real-time unit of pure mode. */
const BLINK_LEVEL = 12;
/** Unit names of the levels that are units (SPEC §15). */
const UNIT_NAMES = { 0: 'Alpha', 1: 'Beta', 2: 'Gamma', 3: 'Delta', 4: 'Nuclide', 6: 'Helion', 8: 'Preon', 10: 'Flavon', 12: 'Blink' };
const QUARTER_EVENTS = ['begin', 'peak', 'node', 'valley'];
const EVENT = { begin: 'begin', firstPeak: 'peak', middleNode: 'node', oppositePeak: 'valley', end: 'end' };

// ---- numbers ---------------------------------------------------------------------------------------------

const NNBSP = '\u202f';
const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
/** Three significant digits, as the number reads best ("5.55", "81.1", "248", "10.0"). */
const three = (v) => {
  const s = v.toPrecision(3);
  return s.includes('e') ? String(Number(s)) : s;
};
/** Digit groups with narrow no-break spaces: 7319812500 -> "7 319 812 500" (Number or BigInt). */
export const groupBig = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);

/** Scientific notation with a real exponent: sci(4.83e-43, 's') -> "4.83 × 10⁻⁴³ s". */
export function sci(x, unit = '') {
  if (!(x > 0) || !Number.isFinite(x)) return '—';
  let e = Math.floor(Math.log10(x));
  let m = Number((x / 10 ** e).toPrecision(3));
  if (m >= 10) {
    m /= 10;
    e += 1;
  }
  const exp = [...String(e)].map((c) => SUP[c] ?? c).join('');
  return `${m.toFixed(2)} × 10${exp}${unit ? ' ' + unit : ''}`;
}

/** A large count: exact with digit groups below 10¹², else scientific ("2.03 × 10¹³"). Number or BigInt. */
export function bigText(n) {
  const b = typeof n === 'bigint' ? n : BigInt(Math.round(n));
  if (b < 10n ** 12n) return groupBig(b);
  const s = b.toString();
  return sci(Number(`${s[0]}.${s.slice(1, 6)}`) * 10 ** (s.length - 1));
}

/** SI prefixes, from yocto to yotta (ronto/ronna and quecto/quetta read too unfamiliar: scientific beyond). */
const PREFIX = [[-24, 'y'], [-21, 'z'], [-18, 'a'], [-15, 'f'], [-12, 'p'], [-9, 'n'], [-6, 'µ'], [-3, 'm'], [0, ''], [3, 'k'], [6, 'M'], [9, 'G'], [12, 'T'], [15, 'P'], [18, 'E'], [21, 'Z'], [24, 'Y']];
function si(x, unit) {
  if (!(x > 0) || !Number.isFinite(x)) return '—';
  // the exponent after rounding to three digits (999.7 GHz reads 1.00 THz)
  const e3 = Math.floor(Math.log10(Number(x.toPrecision(3))) / 3) * 3;
  if (e3 < PREFIX[0][0] || e3 > PREFIX.at(-1)[0]) return sci(x, unit);
  const [, p] = PREFIX.find(([e]) => e === e3);
  return `${three(x / 10 ** e3)} ${p}${unit}`;
}

/** A frequency with the SI prefix that fits: "3.22 Hz", "8.92 kHz", "5.55 THz", "815 ZHz", "3.67 × 10³⁰ Hz". */
export const frequencyText = (hz) => si(hz, 'Hz');

/**
 * A cycle length: calendar-like units from a second up ("72.1 y", "81.1 d", "5.05 h", "33.7 min", "7.77 s"), SI prefixes
 * below ("311 ms", "179 fs") and scientific notation past the yoctosecond ("4.83 × 10⁻⁴³ s").
 */
export function periodText(s) {
  if (!(s > 0) || !Number.isFinite(s)) return '—';
  if (s >= 31557600) return `${three(s / 31557600)} y`;
  if (s >= 86400) return `${three(s / 86400)} d`;
  if (s >= 3600) return `${three(s / 3600)} h`;
  if (s >= 60) return `${three(s / 60)} min`;
  return si(s, 's');
}

/**
 * The range a frequency falls in: audible sound, then the bands of the electromagnetic spectrum (ISO 21348 boundaries,
 * rounded), up to the most energetic photons observed (~1.4 PeV, 3.4 × 10²⁹ Hz). `nm` is the wavelength of visible light.
 * @returns {{name:string, nm?:number}|null}
 */
export function bandOf(hz) {
  if (!(hz >= 20)) return null;
  if (hz < 2e4) return { name: 'audible' };
  if (hz < 3e8) return { name: 'radio' };
  if (hz < 3e11) return { name: 'microwave' };
  if (hz < 4e14) return { name: 'infrared' };
  if (hz < 7.9e14) return { name: 'visible', nm: 299792458 / hz * 1e9 };
  if (hz < 3e16) return { name: 'ultraviolet' };
  if (hz < 3e19) return { name: 'X-ray' };
  if (hz < 3.4e29) return { name: 'gamma ray' };
  return null;
}

// ---- the ladder ------------------------------------------------------------------------------------------

/**
 * The 63 levels of the ladder with their lengths in the eclipse interval that holds `t` (SPEC §3.3 uses the 2010–2028
 * interval of Saros 141 the same way).
 * @returns {{rows: object[], interval: {k:number, t0:number, t1:number, seconds:number}, next: {level:number, text:string, seconds:number}}}
 *   row: {level, depth, text (α … ω, α1 …), unit (name or null), major, siblings (null for α), prefix (BigInt P(L)),
 *         seconds, hz, blinks (BigInt Blinks per cycle, L ≤ 12, else null), perBlink (BigInt cycles per Blink, L ≥ 12)}
 */
export function ladderOf(model, t, levels = LADDER_LEVELS) {
  const E = model.catalogue;
  const pos = model.positionOf(model.clamp(t)) ?? 0;
  const k = Math.min(model.extent - 1, Math.max(0, Math.floor(pos)));
  const saros = E[k + 1] - E[k];
  const pBlink = model.levelInfo(BLINK_LEVEL).prefix;
  const row = (L) => {
    const info = model.levelInfo(L);
    const P = info.prefix;
    const seconds = (4 * saros) / Number(P);
    return {
      level: L,
      depth: L + 1,
      text: info.text,
      unit: UNIT_NAMES[L] ?? null,
      major: L <= 3,
      siblings: info.siblings,
      prefix: P,
      seconds,
      hz: 1 / seconds,
      blinks: L <= BLINK_LEVEL ? pBlink / P : null,
      perBlink: L >= BLINK_LEVEL ? P / pBlink : null,
    };
  };
  const rows = Array.from({ length: levels }, (_, L) => row(L));
  const nx = row(levels);
  return { rows, interval: { k, t0: E[k], t1: E[k + 1], seconds: saros }, next: { level: nx.level, text: nx.text, seconds: nx.seconds } };
}

// ---- milestones --------------------------------------------------------------------------------------------

/**
 * Threshold `j` (in quarters of the level, counted from the Alpha's start) of a level with `n` cycles per Alpha:
 * {idx (0..n−1, within the Alpha), event}. The Alpha's end is the last cycle's 'end'.
 */
function quarterStep(n, j) {
  const idx = Math.floor(j / 4);
  if (idx >= n) return { idx: n - 1, event: 'end' };
  return { idx, event: QUARTER_EVENTS[j % 4] };
}

/**
 * The Alpha that holds Delta `delta` (global index; `path` = deltaPath), its Betas and Gammas and the eclipses in it.
 * Times are Unix seconds (null past the catalogue's end).
 * @returns {{
 *   alpha: {idx, ord, name, t0, t1, thresholds: {event, t, eclipse, also: {level, ord, name, event}[]}[]},
 *   betas: {idx, ord, name, current, t0, t1, thresholds: {event, t, eclipse}[]}[],
 *   gammas: {idx, ord, name, beta, current, t0, t1, eclipse: {k, event}|null}[][],
 *   eclipses: {k, t, event}[]
 * }}
 */
export function milestonesOf({ model, pure, path }) {
  const E = model.catalogue;
  const a = path[0] - 1;
  const eclipseAt = (t) => {
    if (t === null || t === undefined) return null;
    const k = Math.round(model.positionOf(t) ?? NaN);
    return Number.isInteger(k) && E[k] !== undefined && Math.abs(E[k] - t) < 0.5 ? k : null;
  };
  const thresholdsOf = (c) =>
    c.events.map((e) => {
      const t = e.time ?? null;
      return { event: EVENT[e.name] ?? e.name, t, eclipse: eclipseAt(t) };
    });
  const A = model.cycleByIndex(0, a);
  const alpha = {
    idx: a,
    ord: path[0],
    name: pure.periodName(0, path[0]),
    t0: A.start,
    t1: A.end,
    clipped: !!A.clipped,
    thresholds: thresholdsOf(A).map((th, q) => {
      // the Beta and Gamma thresholds at the same instant: quarter q of the Alpha is quarter-step q·n of a level
      // with n cycles per Alpha
      const also = [
        [1, 5],
        [2, 65],
      ].map(([level, n]) => {
        const s = quarterStep(n, q * n);
        const ord = level === 1 ? s.idx + 1 : (s.idx % 13) + 1;
        const name = pure.periodName(level, ord);
        return { level, ord, name, event: s.event, beta: level === 2 ? Math.floor(s.idx / 13) + 1 : null };
      });
      return { ...th, also };
    }),
  };
  const betas = [];
  const gammas = [];
  for (let b = 0; b < 5; b++) {
    const B = model.cycleByIndex(1, a * 5 + b);
    betas.push({ idx: a * 5 + b, ord: b + 1, name: pure.periodName(1, b + 1), current: b === path[1] - 1, t0: B?.start ?? null, t1: B?.end ?? null, thresholds: B ? thresholdsOf(B) : [] });
    const row = [];
    for (let g = 0; g < 13; g++) {
      const gi = (a * 5 + b) * 13 + g;
      const G = model.cycleByIndex(2, gi);
      const ths = G ? thresholdsOf(G) : [];
      const hit = ths.find((x) => x.eclipse !== null);
      row.push({
        idx: gi,
        ord: g + 1,
        name: pure.periodName(2, g + 1),
        beta: b + 1,
        current: b === path[1] - 1 && g === path[2] - 1,
        t0: G?.start ?? null,
        t1: G?.end ?? null,
        eclipse: hit ? { k: hit.eclipse, event: hit.event } : null,
      });
    }
    gammas.push(row);
  }
  const eclipses = alpha.thresholds.filter((x) => x.eclipse !== null).map((x) => ({ k: x.eclipse, t: x.t, event: x.event }));
  return { alpha, betas, gammas, eclipses };
}
