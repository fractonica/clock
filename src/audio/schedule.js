/**
 * Scheduling logic of the sonification (pure, no Web Audio).
 *
 *  - the glyph wave as a loudness curve: triangle(phase) -> loudness(x)
 *  - chime events: every quarter threshold (peak / node / valley / end) of a sounding level
 *    inside a window of displayed time, merged when several levels turn over together
 *  - the mapping between displayed time and audio-context time
 *
 * Quarter thresholds are the quarter indices i of a level: threshold i lies at position
 * i / P(L) Saros, i.e. model.cycleStartTime(L, i / 4). i mod 4 = 1 peak, 2 node, 3 valley,
 * 0 end (the end of one cycle is the start of the next).
 */

export const KINDS = ['end', 'peak', 'node', 'valley']; // index = quarter index mod 4

const TAU = Math.PI * 2;
/** Cycle ends that happen this close together (seconds) are one chord event. */
export const MERGE_EPS = 5e-4;

// ---------------------------------------------------------------------------------------------
// The glyph wave as a loudness curve
// ---------------------------------------------------------------------------------------------

/**
 * Value of the phase glyph wave, normalised to [-1, 1] (ascending family, SPEC 4.1): 0 at the
 * start, +1 at the peak (1/4), 0 at the node (1/2), -1 at the valley (3/4), back to 0.
 * Continuous version of `levelAt(t, L).value / M`.
 */
export function triangle(phase) {
  const p = phase - Math.floor(phase);
  if (p < 0.25) return 4 * p;
  if (p < 0.75) return 2 - 4 * p;
  return 4 * p - 4;
}

/** Smooth direction cue: +1 rising through the start node, -1 falling through the middle node, 0 at extrema. */
export const directionCue = (phase) => Math.cos(TAU * phase);

export const LOUDNESS_CURVE = 1.6;
/** Loudness 0..1 from the glyph value x in [-1, 1]: silent at the valley, full at the peak. */
export function loudness(x, curve = LOUDNESS_CURVE) {
  const u = (Math.min(1, Math.max(-1, x)) + 1) / 2;
  return Math.pow(u, curve);
}
/** Mean loudness over a whole cycle (value is uniform in [-1, 1]): 1 / (curve + 1). */
export const meanLoudness = (curve = LOUDNESS_CURVE) => 1 / (curve + 1);

/** Real-time rate (Hz) at which a level's cycle repeats at displayed-seconds-per-second `rate`. */
export const cycleHz = (meanSeconds, rate) => Math.abs(rate) / meanSeconds;

/** Modulation up to this rate (Hz, real time) is reproduced at full depth: xi's true 22.5 Hz stays exact. */
export const AM_FULL_HZ = 25;
/** From this rate on a voice no longer follows its cycle at all and rests at its mean loudness. */
export const AM_NONE_HZ = 32;
/**
 * How faithfully a voice follows its cycle: amplitude modulation is reproduced at the true rate up
 * to AM_FULL_HZ; from AM_NONE_HZ on it is too fast to be an envelope and the voice rests at its
 * mean loudness (the cycle averages out); in between the two are cross-faded. The cross-fade is kept
 * short and low: a deep modulation between 30 and 80 Hz is the roughness band, a buzz, not a rhythm.
 */
export function amWeight(hz) {
  if (hz <= AM_FULL_HZ) return 1;
  if (hz >= AM_NONE_HZ) return 0;
  return (AM_NONE_HZ - hz) / (AM_NONE_HZ - AM_FULL_HZ);
}

/**
 * What a voice does at a real-time cycle rate, for words in the UI:
 *   'full'  the cycle is heard as the drone's amplitude modulation (up to AM_FULL_HZ)
 *   'fade'  in the cross-fade: a partial, fading modulation
 *   'rest'  too fast to follow: the voice rests at its mean loudness
 */
export function amZone(hz) {
  return hz <= AM_FULL_HZ ? 'full' : hz >= AM_NONE_HZ ? 'rest' : 'fade';
}

/** Loudness actually heard for a voice at `phase` while its cycle runs at `hz` (real time). */
export function voiceLoudness(phase, hz, { curve = LOUDNESS_CURVE, floor = 0 } = {}) {
  const w = amWeight(hz);
  const v = w * loudness(triangle(phase), curve) + (1 - w) * meanLoudness(curve);
  return floor + (1 - floor) * v;
}

/** Brightness cue is only audible for slow cycles: it fades out between 1 and 8 Hz. */
export const directionWeight = (hz) => Math.min(1, Math.max(0, 1 - (hz - 1) / 7));

/** Continuous phase of a level at displayed time t from the catalogue position (cheap, float). */
export function phaseOf(pos, prefixNum) {
  const x = (pos * prefixNum) / 4;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------------------------
// Chime events
// ---------------------------------------------------------------------------------------------

/** The calm default chime floor, real seconds (the other floors stay selectable in the panel). */
export const DEFAULT_FLOOR = 0.5;

/**
 * Which thresholds of a level chime at this rate (real-time spacing >= `floor` seconds):
 *   'quarters'  period/4 >= floor : every peak, node, valley and end
 *   'ends'      period   >= floor : only the cycle end (the quarters would be a rattle)
 *   null                          : too fast to chime; slower than ~30 Hz it is still heard as the drone's
 *                                   modulation (see amWeight), faster it rests at its mean loudness
 */
export function chimeMode(meanSeconds, rate, floor = DEFAULT_FLOOR) {
  const r = Math.abs(rate);
  if (!(r > 0)) return null;
  const period = meanSeconds / r;
  if (period / 4 >= floor) return 'quarters';
  if (period >= floor) return 'ends';
  return null;
}

const KIND_BASE = { peak: 0.52, node: 0.34, valley: 0.44, end: 0.62 };
/**
 * How major an event is, 0..1: the base weight of the top threshold's kind plus a saturating bonus
 * for every further cycle that ends at the same instant (1 end = a bell, 8 ends = a big chord).
 */
export function eventStrength(kind, ends = 0) {
  const base = KIND_BASE[kind] ?? 0.4;
  if (ends <= 1) return base;
  return Math.min(1, base + (1 - base) * (1 - Math.pow(0.78, ends - 1)));
}

/**
 * Coarse cycles ring bigger than fine ones: bell loudness tapers from 1 (alpha) to ~0.55 (xi), so the
 * constant tick of the fastest cycles stays a murmur under the turnovers that matter.
 */
export const bellTaper = (level) => 0.55 + 0.45 * (1 - Math.min(13, Math.max(0, level)) / 13);

/**
 * Loudness of the main partial of a bell at audio time `p`: its exponential decay from `amp` (after the
 * attack) down to -80 dB over `decay` seconds. A bell that has not started yet is at full strength.
 * @param {{amp:number, start:number, attack:number, decay:number}} bell
 */
export const bellLoudAt = (bell, p) => bell.amp * Math.pow(1e-4 / bell.amp, Math.min(1, Math.max(0, (p - bell.start - bell.attack) / bell.decay)));

/**
 * Is bell `a` less important than bell `b` at audio time `p`? This decides who is stolen when more bells
 * would sound than the polyphony cap allows: the quietest first, then the finest level (higher number),
 * then the oldest. Equal in all three: neither is less important.
 * @param {{amp:number, start:number, attack:number, decay:number, level:number}} a
 */
export function isLessImportant(a, b, p) {
  const la = bellLoudAt(a, p);
  const lb = bellLoudAt(b, p);
  if (la !== lb) return la < lb;
  if (a.level !== b.level) return a.level > b.level;
  return a.start < b.start;
}

/**
 * Chime events of the sounding levels in the half-open window (tA, tB] of displayed time.
 *
 * @param {object} model   ctx.model (levelInfo, positionOf, cycleStartTime, tMin, tMax)
 * @param {number} tA      window start, Unix s (exclusive)
 * @param {number} tB      window end, Unix s (inclusive)
 * @param {object} opts
 *   levels  0-based levels that sound (default 0..11)
 *   rate    displayed seconds per real second (decides which levels are fast enough to chime)
 *   floor   chime floor in real seconds (default DEFAULT_FLOOR = 0.5)
 *   limit   maximum number of events returned (the earliest ones)
 * @returns {{time:number, kind:string, top:number, levels:number[], parts:{level:number,kind:string}[],
 *   ends:number, strength:number}[]} sorted by time. `top` is the coarsest level of the event; an end
 *   of level L lists L and every finer sounding level that ends at the same instant.
 */
export function eventsInWindow(model, tA, tB, opts = {}) {
  const { levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], rate = 1, floor = DEFAULT_FLOOR, limit = 2000 } = opts;
  if (!(tB > tA)) return [];
  const lo = Math.max(tA, model.tMin);
  const hi = Math.min(tB, model.tMax);
  if (!(hi > lo)) return [];
  const pLo = model.positionOf(lo);
  const pHi = model.positionOf(hi);
  if (pLo === null || pHi === null) return [];

  const raw = [];
  for (const L of levels) {
    const info = model.levelInfo(L);
    const mode = chimeMode(info.meanSeconds, rate, floor);
    if (!mode) continue;
    const P = info.prefixNum;
    const first = Math.max(0, Math.floor(pLo * P) - 1);
    const last = Math.ceil(pHi * P) + 1;
    const step = mode === 'ends' ? 4 : 1;
    let i = mode === 'ends' ? Math.floor(first / 4) * 4 : first;
    for (; i <= last; i += step) {
      const time = model.cycleStartTime(L, i / 4);
      if (time === null) break; // beyond the catalogue: never extrapolate
      if (time <= lo || time > hi) continue;
      raw.push({ time, level: L, kind: KINDS[i % 4] });
    }
  }
  raw.sort((a, b) => a.time - b.time || a.level - b.level);

  const events = [];
  for (let k = 0; k < raw.length; ) {
    let j = k + 1;
    while (j < raw.length && raw[j].time - raw[k].time <= MERGE_EPS) j++;
    const group = raw.slice(k, j).sort((a, b) => a.level - b.level);
    const top = group[0];
    const ends = group.filter((g) => g.kind === 'end').length;
    events.push({
      time: top.time,
      kind: top.kind,
      top: top.level,
      levels: group.map((g) => g.level),
      parts: group.map((g) => ({ level: g.level, kind: g.kind })),
      ends,
      strength: eventStrength(top.kind, ends),
    });
    k = j;
    if (events.length >= limit) break;
  }
  return events;
}

// ---------------------------------------------------------------------------------------------
// Displayed time <-> audio time
// ---------------------------------------------------------------------------------------------

/**
 * Linear map between audio-context time `a` and displayed time `t`:  t = t0 + rate * (a - a0).
 * `rate` is displayed seconds per real second (store.rate; 0 = paused, negative = backwards).
 */
export function createClockMap() {
  let a0 = 0;
  let t0 = 0;
  let rate = 0;
  return {
    set(a, t, r) {
      a0 = a;
      t0 = t;
      rate = r;
    },
    tAt: (a) => t0 + rate * (a - a0),
    /** audio time of displayed time t; Infinity while paused */
    aAt: (t) => (rate === 0 ? Infinity : a0 + (t - t0) / rate),
    get rate() {
      return rate;
    },
    get a0() {
      return a0;
    },
    get t0() {
      return t0;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Tempo lock
// ---------------------------------------------------------------------------------------------

/**
 * Time-lapse rate that makes one cycle of `depth` last `seconds` real seconds
 * (hierarchy as nested rhythm: quarters are beats, finer levels are the subdivisions 5:13:5:5:7:11:9:4,
 * a sequence that repeats).
 */
export function tempoRate(model, depth, seconds) {
  return model.levelInfo(depth - 1).meanSeconds / seconds;
}

/**
 * Describe a rate in musical terms for the cycle of `depth`.
 * @returns {{cycle:number, beat:number, bpm:number, child:number, childPerCycle:number}}
 *   cycle: real seconds per cycle, beat: real seconds per quarter, bpm: quarters per minute,
 *   child: real seconds per cycle of the next finer level
 */
export function tempoInfo(model, depth, rate) {
  const info = model.levelInfo(depth - 1);
  const r = Math.abs(rate);
  const cycle = r > 0 ? info.meanSeconds / r : Infinity;
  const beat = cycle / 4;
  return { cycle, beat, bpm: r > 0 ? 60 / beat : 0, child: cycle / info.factor, childPerCycle: info.factor };
}
