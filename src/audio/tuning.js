/**
 * Tuning of the Fractonica hierarchy as a just-intonation series (pure, no Web Audio).
 *
 * The prefixes P(L) = 1, 5, 65, 325, 1625, ... are the frequency ratios of the harmonic
 * levels: level L cycles P(L) times faster than alpha. Folding a ratio into one octave
 * (P / 2^floor(log2 P), reduced exactly with BigInt) gives the level's pitch class; the
 * whole clock becomes a chord. Every note answers "this is the cycle of depth N".
 *
 *   pitchClass(1625n)  -> 1625/1024 (800 cents, a just-ish minor sixth)
 *   OCTAVES            -> the explicit register: one octave number per depth, non-decreasing
 *   buildTuning(model) -> one table row per depth with ratio, cents, octave, true rate
 *   clashingHarmonics  -> which voices must not add a 2nd harmonic (it would beat against another voice)
 *
 * The deepest cycles are physically audible: xi cycles at 22.5 Hz, omicron at 247.7 Hz,
 * pi at 2.23 kHz, rho at 8.92 kHz. `physicalLevels` lists the cycles whose true rate (times
 * a chosen power of two) falls in the audible band.
 */

export const N_LEVELS = 14;
export const DEFAULT_BASE_HZ = 110;
/** Register span in octaves between alpha and the deepest displayed level (used by `autoOctaves`). */
export const DEFAULT_SPAN = 4.99;
/** Two voices closer than this many cents (absolute pitch) would beat roughly: keep them apart. */
export const KEEP_APART_CENTS = 45;
/**
 * Octave above the base pitch of every depth 1..14 (alpha .. xi): coarse cycles low, fine ones high, about
 * five octaves in all, never decreasing, the highest voice (nu) at 3.0 kHz above a 110 Hz base.
 *
 * It is `autoOctaves` with one correction found by listening analysis: zeta (depth 6) sits an octave higher
 * (611 Hz instead of 305.5 Hz). Next to delta (279.3 Hz) it was a 26 Hz apart pair, right at the peak of
 * sensory roughness for a ~290 Hz tone (critical band ~106 Hz). Beta is NOT moved up: at 275.0 Hz it would
 * stand 27 cents below delta as two full-strength fundamentals.
 */
export const OCTAVES = Object.freeze([0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 4]);
/**
 * A voice's 2nd harmonic is left out when it would land this close (cents) to another sounding voice's
 * fundamental: a partial that is a few Hz off a neighbouring note is a beat that belongs to no cycle.
 */
export const CLASH_CENTS = 120;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** log2 of a positive BigInt, exact to double precision for any size. */
export function log2Big(n) {
  n = BigInt(n);
  if (n <= 0n) throw new RangeError('log2Big needs a positive integer');
  const bits = n.toString(2).length;
  if (bits <= 52) return Math.log2(Number(n));
  const shift = bits - 52;
  return Math.log2(Number(n >> BigInt(shift))) + shift;
}

/**
 * Fold the ratio P:1 into one octave, exactly.
 * @param {bigint|number} prefix  P(L), the number of cycles of this level per alpha cycle
 * @returns {{num:bigint, den:bigint, cents:number, ratio:number, text:string, shift:number}}
 *   num/den  reduced fraction in [1, 2);  cents  1200*log2(num/den);  shift  octaves removed
 */
export function pitchClass(prefix) {
  const p = BigInt(prefix);
  if (p < 1n) throw new RangeError('prefix must be >= 1');
  const k = p.toString(2).length - 1; // floor(log2 p)
  let odd = p;
  let tz = 0;
  while ((odd & 1n) === 0n) {
    odd >>= 1n;
    tz++;
  }
  const num = odd;
  const denExp = k - tz; // p / 2^k = odd / 2^(k - tz)
  const den = 1n << BigInt(denExp);
  const cents = 1200 * (log2Big(num) - denExp);
  return { num, den, cents, ratio: Math.pow(2, cents / 1200), text: `${num}/${den}`, shift: k };
}

/** "1625:1024" – the ratio as shown in the mixer. */
export const ratioText = (pc) => `${pc.num}:${pc.den}`;

/**
 * Automatic octave placement: a pure, non-decreasing function of the prefixes, the rule `OCTAVES` was
 * derived from. The true register (log2 P) of the 14 levels spans ~35.6 octaves; it is compressed to
 * `span` octaves (default ~5) so coarse cycles are low and fine ones high. Two voices that
 * would land within KEEP_APART_CENTS of each other are separated by an octave.
 * @param {(bigint|number)[]} prefixes  P(0..n-1), n >= 14
 * @returns {number[]} octave above the base for each level
 */
export function autoOctaves(prefixes, { span = DEFAULT_SPAN, apart = KEEP_APART_CENTS } = {}) {
  const total = log2Big(prefixes[N_LEVELS - 1]);
  const octaves = [];
  const absolute = [];
  for (let L = 0; L < prefixes.length; L++) {
    const cents = pitchClass(prefixes[L]).cents;
    let o = Math.floor((span * log2Big(prefixes[L])) / total + 1e-9);
    if (L > 0) o = Math.max(o, octaves[L - 1]);
    for (let guard = 0; guard < 3; guard++) {
      const c = cents + 1200 * o;
      if (absolute.some((a) => Math.abs(a - c) < apart)) o++;
      else break;
    }
    octaves.push(o);
    absolute.push(cents + 1200 * o);
  }
  return octaves;
}

/**
 * Octave placement of every level for `prefixes` (P(0..n-1)): the explicit, tested vector `OCTAVES`.
 * Levels beyond the table keep the register of the last one.
 * @returns {number[]} octave above the base for each level
 */
export function placeOctaves(prefixes, { octaves = OCTAVES } = {}) {
  return Array.from({ length: prefixes.length }, (_, L) => octaves[Math.min(L, octaves.length - 1)]);
}

/** Equal-tempered note name and cent offset of a frequency (A4 = 440 Hz). */
export function noteOf(freq) {
  const midi = 69 + 12 * Math.log2(freq / 440);
  const n = Math.round(midi);
  const cents = Math.round((midi - n) * 100);
  return { name: NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1), cents, midi: n };
}
/** "F4 −1¢" */
export function noteLabel(freq) {
  const { name, cents } = noteOf(freq);
  const c = cents === 0 ? '±0' : cents > 0 ? `+${cents}` : `−${-cents}`;
  return `${name} ${c}¢`;
}

/**
 * Tuning table for depths 1..count.
 * @param {{levelInfo:(L:number)=>{level:number,depth:number,letter:string,prefix:bigint,meanSeconds:number}}} model
 * @returns {{level:number, depth:number, letter:string, prefix:bigint, num:bigint, den:bigint, ratio:string,
 *   pcCents:number, octave:number, rel:number, cycleSeconds:number, trueHz:number}[]}
 *   rel = frequency relative to the base pitch (2^((pcCents + 1200*octave)/1200))
 */
export function buildTuning(model, { count = N_LEVELS, octaves: vector = OCTAVES } = {}) {
  const infos = Array.from({ length: Math.max(count, N_LEVELS) }, (_, L) => model.levelInfo(L));
  const octaves = placeOctaves(
    infos.map((i) => i.prefix),
    { octaves: vector },
  );
  return infos.slice(0, count).map((info, L) => {
    const pc = pitchClass(info.prefix);
    return {
      level: L,
      depth: info.depth,
      letter: info.letter,
      prefix: info.prefix,
      num: pc.num,
      den: pc.den,
      ratio: ratioText(pc),
      pcCents: pc.cents,
      octave: octaves[L],
      rel: Math.pow(2, (pc.cents + 1200 * octaves[L]) / 1200),
      cycleSeconds: info.meanSeconds,
      trueHz: 1 / info.meanSeconds,
    };
  });
}

/** Frequency (Hz) of a tuning row above a base pitch. */
export const frequencyOf = (row, baseHz = DEFAULT_BASE_HZ) => baseHz * row.rel;

/** Physical register: true cycle rate times 2^shift (octave transposition). */
export const physicalHz = (trueHz, shift = 0) => trueHz * Math.pow(2, shift);

/**
 * Cycles (any depth, also beyond the 14 displayed) whose true rate transposed by `shift` octaves
 * falls inside [lo, hi] Hz.
 */
export function physicalLevels(model, shift, { lo = 25, hi = 6000, maxLevel = 16 } = {}) {
  const out = [];
  for (let L = 0; L <= maxLevel; L++) {
    const info = model.levelInfo(L);
    const hz = physicalHz(1 / info.meanSeconds, shift);
    if (hz >= lo && hz <= hi) out.push({ level: L, depth: info.depth, letter: info.letter, hz, trueHz: 1 / info.meanSeconds });
  }
  return out;
}

/**
 * Loudness compensation (linear gain) so voices at different registers sound about equally
 * loud at a quiet listening level: bass is boosted (capped), the 2-4 kHz region trimmed.
 */
const WEIGHT_DB = [
  [40, 10],
  [80, 9.5],
  [160, 6],
  [320, 2.5],
  [640, 0.5],
  [1280, -1],
  [2560, -3.5],
  [5120, -5],
  [10240, -9],
];
export function weightFor(freq) {
  const f = Math.min(Math.max(freq, WEIGHT_DB[0][0]), WEIGHT_DB[WEIGHT_DB.length - 1][0]);
  let i = 1;
  while (i < WEIGHT_DB.length - 1 && f > WEIGHT_DB[i][0]) i++;
  const [f0, d0] = WEIGHT_DB[i - 1];
  const [f1, d1] = WEIGHT_DB[i];
  const u = (Math.log2(f) - Math.log2(f0)) / (Math.log2(f1) - Math.log2(f0));
  return Math.pow(10, (d0 + (d1 - d0) * u) / 20);
}

/**
 * Bells ring an octave above the drone voice of their level, folded into a pleasant band (60 Hz .. 4.2 kHz).
 * The valley bell is derived from that folded note and sounds an octave BELOW it, so a quarter's identity is
 * audible in pitch for every depth: the fine levels (mu, nu, xi) fold their octave-up note down, and folding
 * the valley separately would have given it the very same pitch as the peak, node and end bells.
 */
export function chimeFrequency(freq, kind) {
  let up = freq * 2;
  while (up > 4200) up /= 2;
  while (up < 60) up *= 2;
  return kind === 'valley' ? up / 2 : up;
}

/**
 * Which voices must not play their 2nd harmonic: the partial 2f of voice i lies within `maxCents` of the
 * fundamental of another sounding voice (an exact coincidence, 0 cents, counts: the doubled note would carry
 * the modulation of the wrong cycle). Pure; compute it from the tuning table, never hard-code it.
 * @param {number[]} freqs  fundamental of every level (Hz)
 * @param {boolean[]} [on]  which levels sound (default all)
 * @returns {boolean[]} true = leave this voice's 2f out
 */
export function clashingHarmonics(freqs, on = freqs.map(() => true), maxCents = CLASH_CENTS) {
  return freqs.map((f, i) => !!on[i] && freqs.some((g, j) => j !== i && !!on[j] && Math.abs(1200 * Math.log2((2 * f) / g)) < maxCents));
}

/** Frequencies are only played when they can be heard and are safe for small speakers. */
export const isAudible = (f, lo = 25, hi = 6000) => f >= lo && f <= hi;
