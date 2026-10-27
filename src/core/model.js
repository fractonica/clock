/**
 * Fractonica clock model: the one place that talks to fractonica.js.
 *
 * Everything in the UI reads the clock through this module so that readings
 * stay identical to the reference library (SPEC.md §12 test vectors are
 * checked in test/model.test.js).
 *
 * Conventions
 * - Time is always Unix seconds as a JS Number (UTC, 86400 s days, SPEC §2.1).
 *   The model rounds every query to 1 ms before it reaches the library.
 * - level = zero-based harmonic level; depth = level + 1 (user-facing).
 * - Cycle indices at a level are returned as Number (exact up to level 13;
 *   the library keeps BigInt, `cycleBig` is also given when exactness matters).
 * - Out of catalogue (before 1613-05-19 or after 2857-06-13) the model never
 *   extrapolates: `frame.inRange === false` and level()/solar() return null.
 */

const F = globalThis.Fractonica;
if (!F) throw new Error('fractonica.js must be loaded before the app (globalThis.Fractonica).');

const num = F.number;
const R = F.rational;
const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω';

/** Highest level shown in the UI (depth 14, ξ), per SPEC §3.3. */
export const MAX_LEVEL = 13;
/** Quarter names of a cycle for the ascending family (SPEC §6.2). */
export const QUARTER_NAMES = ['peak', 'node', 'valley', 'end'];

const ms = (t) => Math.round(t * 1000) / 1000;
/** The catalogue's closing instant belongs to its last cycle (SPEC §2.2): query 1 ms inside it. */
const EDGE = 0.001;
const bigToNumber = (b) => Number(b);

export function createModel() {
  const clock = F.create({ timeScale: 'unix' });
  const sequence = [...F.defaults.sequence];
  const E = clock.timestamps.map((r) => num(r)); // Unix seconds, Float64
  const extent = Number(clock.extent);
  const tMin = E[0];
  const tMax = E[extent];
  const solarSync = clock.solarSync(); // anchor 20 / level 6 / 19 cycles / 4 days
  const calendar = F.createCycleCalendar(clock);

  // ---- static level table -------------------------------------------------
  const levelInfoCache = [];
  const meanSaros = (tMax - tMin) / extent;
  /**
   * Static facts about a level.
   * @returns {{level:number, depth:number, letter:string, suffix:string, text:string,
   *   factor:number, siblings:number|null, prefix:bigint, prefixNum:number,
   *   meanSeconds:number}}
   *   factor   = number of level+1 cycles inside one cycle of this level
   *   siblings = number of cycles of this level inside one parent cycle
   *              (null for level 0: it has no parent)
   */
  function levelInfo(level) {
    if (levelInfoCache[level]) return levelInfoCache[level];
    const name = F.periodName(level);
    const prefix = clock.prefix(level);
    const info = Object.freeze({
      level,
      depth: level + 1,
      letter: name.letter,
      suffix: name.suffix,
      text: name.text,
      factor: sequence[level % sequence.length],
      siblings: level === 0 ? null : sequence[(level - 1) % sequence.length],
      prefix,
      prefixNum: bigToNumber(prefix),
      meanSeconds: (4 * meanSaros) / bigToNumber(prefix),
    });
    levelInfoCache[level] = info;
    return info;
  }

  // ---- float catalogue helpers (SPEC §11: ordinal + fraction) -------------
  /** Locate t in the catalogue: {k, f} with E[k] <= t < E[k+1], or null. */
  function locate(t) {
    if (!(t >= tMin && t <= tMax)) return null;
    let lo = 0;
    let hi = extent;
    while (lo + 1 < hi) {
      const m = (lo + hi) >> 1;
      if (E[m] <= t) lo = m;
      else hi = m;
    }
    return { k: lo, f: (t - E[lo]) / (E[lo + 1] - E[lo]) };
  }
  /** Position (Saros units, Number) of a time; null when out of range. */
  function positionOf(t) {
    const l = locate(t);
    return l ? l.k + l.f : null;
  }
  /** Time (Number) of a position (Saros units); clamps to the catalogue. */
  function timeOfPosition(pos) {
    if (pos <= 0) return tMin;
    if (pos >= extent) return tMax;
    const k = Math.floor(pos);
    return E[k] + (pos - k) * (E[k + 1] - E[k]);
  }
  /**
   * Time of the start of cycle `idx` at `level`, with float arithmetic split
   * into ordinal and fraction (exact for level <= 13). Returns null beyond the
   * catalogue end.
   */
  function cycleStartTime(level, idx) {
    const P = levelInfo(level).prefixNum;
    const n = idx * 4;
    const k = Math.floor(n / P);
    if (k > extent) return null;
    if (k === extent) return n - k * P === 0 ? tMax : null;
    const f = (n - k * P) / P;
    return E[k] + f * (E[k + 1] - E[k]);
  }

  // ---- exact helpers via the library --------------------------------------
  function posRational(t) {
    return clock.positionAt(R(String(ms(t))));
  }
  const cycleCache = new Map();
  /** Cached period() facts for (level, cycle): times of begin/peak/node/valley/end. */
  function cycleFacts(level, cycleBig) {
    const key = level + ':' + cycleBig;
    let c = cycleCache.get(key);
    if (c) return c;
    const p = clock.period(level, cycleBig);
    c = {
      start: num(p.startTime),
      end: num(p.endTime),
      duration: num(p.duration),
      clipped: p.clipped,
      events: p.events.map((e) => ({ name: e.name, time: e.time ? num(e.time) : null })),
    };
    if (cycleCache.size > 4000) cycleCache.clear();
    cycleCache.set(key, c);
    return c;
  }

  /**
   * Full reading of one level at time t (Number).
   * @returns {null | {
   *  level:number, depth:number, name:string, factor:number, siblings:number|null,
   *  cycle:number, cycleBig:bigint, local:number,
   *  phase:number,            // 0..1 position within the cycle (position-linear, exact)
   *  progress:number,         // 0..1 time-linear fraction between start and end
   *  quarter:number,          // 0..3 index into QUARTER_NAMES
   *  index:number, value:number, derivative:number, dotted:boolean, trits:number[],
   *  states:number, strokes:number,
   *  start:number, end:number, duration:number, clipped:boolean,
   *  remaining:number,        // seconds until `end` (time-linear)
   *  next:{name:string,time:number|null},   // next quarter threshold (SPEC §6.2)
   *  thresholds:{name:string,time:number|null}[]  // begin..end of this cycle
   * }}
   */
  function levelAt(t, level, { strokes = 2 } = {}) {
    t = ms(t);
    if (!(t >= tMin && t <= tMax)) return null;
    if (t > tMax - EDGE) t = tMax - EDGE;
    const p = posRational(t);
    const info = levelInfo(level);
    const x = p.numerator * info.prefix;
    const quad = 4n * p.denominator;
    const cycleBig = x / quad;
    const rem = x - cycleBig * quad;
    const phase = Number(rem) / Number(quad);
    const ph = clock.phaseAt(p, level, { strokes });
    const facts = cycleFacts(level, cycleBig === clock.count(level) ? cycleBig - 1n : cycleBig);
    const span = facts.end - facts.start;
    const progress = span > 0 ? Math.min(1, Math.max(0, (t - facts.start) / span)) : 0;
    const nt = clock.nextThreshold(p, level);
    const local = info.siblings === null ? Number(cycleBig) : Number(cycleBig % BigInt(info.siblings));
    return {
      level,
      depth: info.depth,
      name: info.text,
      factor: info.factor,
      siblings: info.siblings === null ? Number(clock.count(0)) : info.siblings,
      cycle: Number(cycleBig),
      cycleBig,
      local,
      phase,
      progress,
      quarter: Math.min(3, Math.floor(phase * 4)),
      index: Number(ph.index),
      value: Number(ph.value),
      derivative: ph.derivative,
      dotted: ph.derivative < 0,
      trits: [...ph.trits],
      states: Number(ph.states),
      strokes,
      start: facts.start,
      end: facts.end,
      duration: facts.duration,
      clipped: facts.clipped,
      remaining: Math.max(0, facts.end - t),
      next: { name: nt.name, time: nt.time ? num(nt.time) : null },
      thresholds: facts.events,
    };
  }

  /**
   * Odometer read-out (SPEC §5): `digits` glyph indices, coarsest first, plus the
   * time at which the finest digit next changes.
   * @returns {null | {digits:number[], states:number, nextTime:number|null}}
   */
  function odometerAt(t, level, { strokes = 2, digits = 2 } = {}) {
    t = ms(t);
    if (!(t >= tMin && t <= tMax)) return null;
    if (t > tMax - EDGE) t = tMax - EDGE;
    const d = clock.phaseDigits(posRational(t), level, { strokes, digits });
    return { digits: d.digits.map(Number), states: Number(d.states), nextTime: d.nextTime ? num(d.nextTime) : null };
  }

  /**
   * Solar sync reading (SPEC §7).
   * Null outside the catalogue and inside the first / last partial sync (about 2.5 days at each edge),
   * whose start or end would fall outside it.
   * @returns {null | {
   *  sync:number, start:number, end:number, phase:number, drift:number, quarter:number,
   *  threshold:{name:string,time:number}, digits3:number[], digits2x3:number[],
   *  nominalStart:number, beforeAnchor:boolean }}
   */
  function solarAt(t) {
    t = ms(t);
    if (!(t >= tMin && t <= tMax)) return null;
    let at;
    try {
      at = solarSync.at(R(String(t)));
    } catch (err) {
      if (err instanceof RangeError) return null; // the first/last partial sync runs past the catalogue
      throw err;
    }
    return {
      sync: Number(at.sync),
      start: num(at.startTime),
      end: num(at.endTime),
      nominalStart: num(at.nominalStart),
      phase: num(at.phase),
      drift: num(at.drift),
      quarter: at.quarter,
      threshold: { name: at.threshold.name, time: num(at.threshold.time) },
      digits3: solarSync.digits(R(String(t)), { strokes: 2, digits: 3 }).map(Number),
      digits2x3: solarSync.digits(R(String(t)), { strokes: 3, digits: 2 }).map(Number),
      beforeAnchor: t < num(solarSync.anchorTime),
    };
  }
  /** Start/end/nominal of sync number n (any integer), or null outside the catalogue. */
  function solarSyncByNumber(n) {
    const a = 20n * clock.prefix(6) / 4n; // anchor cycle at level 6
    const p = clock.prefix(6);
    const pos = (k) => R((a + 19n * BigInt(k)) * 4n, p);
    const lo = pos(n), hi = pos(n + 1);
    const ext = R(clock.extent);
    if (F.compare(lo, R(0)) < 0 || F.compare(hi, ext) > 0) return null;
    const start = num(clock.timestampAt(lo));
    const end = num(clock.timestampAt(hi));
    const nominal = num(solarSync.anchorTime) + n * 4 * 86400;
    return { sync: n, start, end, nominalStart: nominal, drift: start - nominal };
  }

  /**
   * The Pentad running at t (SPEC §7.5): the solar sync's 19 Helions as Pentad I, II, III (5 Helions each) and the
   * Hypopentad (4), so that a Pentad is about a day: each one starts a quarter Helion later in the day than the one
   * before, and the Hypopentad, one Helion short, brings the next Pentad I back to the same time of day.
   * Counted from the sync anchor like the sync itself, but on whole Helions, so it is defined in the partial syncs at
   * the catalogue's ends too. Null outside the catalogue.
   * @returns {null | { sync:number, index:number, helion:number, helions:number, start:number, end:number }}
   *   index 0..3 (3 = Hypopentad), helion 1..5 the Helion's place in it, helions 5 or 4.
   */
  function pentadAt(t) {
    const l = levelAt(t, 6);
    if (!l) return null;
    const a = 20n * clock.prefix(6) / 4n; // the sync anchor's Helion
    const k = l.cycleBig - a;
    const sync = k >= 0n ? k / 19n : -((-k + 18n) / 19n);
    const within = Number(k - sync * 19n); // 0..18
    const index = Math.min(3, Math.floor(within / 5));
    const span = pentadByNumber(Number(sync), index);
    if (!span) return null;
    return { sync: Number(sync), index, helion: within - 5 * index + 1, helions: index === 3 ? 4 : 5, start: span.start, end: span.end };
  }
  /** Start and end of Pentad `index` (0..3) of sync `n`, or null where it runs outside the catalogue. */
  function pentadByNumber(n, index) {
    const a = 20n * clock.prefix(6) / 4n;
    const p = clock.prefix(6);
    const first = a + 19n * BigInt(n) + 5n * BigInt(index);
    const last = first + (index === 3 ? 4n : 5n);
    const lo = R(first * 4n, p);
    const hi = R(last * 4n, p);
    const ext = R(clock.extent);
    // the catalogue's first and last Pentads are cut at its edges
    if (F.compare(hi, R(0)) <= 0 || F.compare(lo, ext) >= 0) return null;
    const start = F.compare(lo, R(0)) < 0 ? tMin : num(clock.timestampAt(lo));
    const end = F.compare(hi, ext) > 0 ? tMax : num(clock.timestampAt(hi));
    return { start, end };
  }

  /** The five-level calendar address (Alpha..Epsilon), 1-based like the library UI. */
  function addressAt(t) {
    t = ms(t);
    if (!(t >= tMin && t <= tMax)) return null;
    return calendar.at(posRational(t)).map((i) => Number(i) + 1);
  }

  // ---- hierarchical cycle addressing (any depth) -------------------------
  /**
   * Convert a path of 1-based local indices [Alpha, Beta, Gamma, ...] into the global
   * cycle index at level path.length-1. Alpha is the global index (1..count(0)); every
   * other entry is local within its parent (1..siblings). Returns null if out of range.
   */
  function pathToCycle(path) {
    let idx = BigInt(path[0]) - 1n;
    if (idx < 0n) return null;
    for (let l = 1; l < path.length; l++) {
      const sib = BigInt(levelInfo(l).siblings);
      const loc = BigInt(path[l]) - 1n;
      if (loc < 0n || loc >= sib) return null;
      idx = idx * sib + loc;
    }
    return idx < clock.count(path.length - 1) ? idx : null;
  }
  /** Inverse of pathToCycle: global cycle index at `level` -> 1-based path. */
  function cycleToPath(level, cycleBig) {
    let idx = BigInt(cycleBig);
    const path = [];
    for (let l = level; l >= 1; l--) {
      const sib = BigInt(levelInfo(l).siblings);
      path.unshift(Number(idx % sib) + 1);
      idx /= sib;
    }
    path.unshift(Number(idx) + 1);
    return path;
  }
  /** Facts (start/end/events) of a cycle at a level; null if outside the catalogue. */
  function cycleByIndex(level, cycleIdx) {
    const big = BigInt(cycleIdx);
    if (big < 0n || big >= clock.count(level)) return null;
    return { level, cycle: Number(big), cycleBig: big, ...cycleFacts(level, big) };
  }
  /** Facts of the cycle containing time t at `level` (same shape as cycleByIndex). */
  function cycleAt(t, level) {
    const l = levelAt(t, level);
    return l ? cycleByIndex(level, l.cycleBig) : null;
  }

  // ---- boundaries & upcoming events --------------------------------------
  /**
   * Start times of the cycles of `level` that begin inside [t0, t1].
   * @returns {{idx:number, local:number, time:number}[]} at most `limit` entries
   */
  function boundaries(level, t0, t1, limit = 600) {
    const info = levelInfo(level);
    const lo = Math.max(t0, tMin);
    const hi = Math.min(t1, tMax);
    if (!(hi >= lo)) return [];
    const p0 = positionOf(lo);
    const p1 = positionOf(hi);
    const P = info.prefixNum;
    let i = Math.ceil((p0 * P) / 4 - 1e-9);
    const last = Math.floor((p1 * P) / 4 + 1e-9);
    const out = [];
    for (; i <= last && out.length < limit; i++) {
      const time = cycleStartTime(level, i);
      if (time === null) break;
      if (time < lo - 1e-6 || time > hi + 1e-6) continue;
      out.push({ idx: i, local: info.siblings === null ? i : i % info.siblings, time });
    }
    return out;
  }

  /**
   * The next cycle-end events after t, merged across levels. An end of level L is
   * also an end of every deeper level, so each event lists the coarsest level that
   * rolls over (`top`) and how many cycles end together.
   * @returns {{time:number, top:number, levels:number[], position:string}[]}
   */
  function upcomingEnds(t, { fromLevel = 0, toLevel = 9, count = 12, perLevel = 8 } = {}) {
    t = ms(t);
    if (!(t >= tMin && t <= tMax)) return [];
    const p = posRational(t);
    const byPos = new Map();
    for (let L = fromLevel; L <= toLevel; L++) {
      const P = levelInfo(L).prefix;
      const cur = (p.numerator * P) / (4n * p.denominator);
      for (let i = 1; i <= perLevel; i++) {
        const pos = R((cur + BigInt(i)) * 4n, P);
        if (F.compare(pos, R(clock.extent)) > 0) break;
        const key = pos.numerator + '/' + pos.denominator;
        let e = byPos.get(key);
        if (!e) {
          e = { pos, levels: [] };
          byPos.set(key, e);
        }
        e.levels.push(L);
      }
    }
    return [...byPos.values()]
      .map((e) => ({ time: num(clock.timestampAt(e.pos)), top: e.levels[0], levels: e.levels, position: e.pos.numerator + '/' + e.pos.denominator }))
      .sort((a, b) => a.time - b.time)
      .slice(0, count);
  }

  /**
   * Times at which the odometer of `level` shows the given digit tuple
   * (coarsest first). `direction` +1 = next occurrences after t, -1 = previous.
   * Each occurrence lasts until `end`.
   * @returns {{start:number,end:number,cycle:number}[]}
   */
  function stateOccurrences(level, digits, t, { strokes = 2, direction = 1, count = 1 } = {}) {
    const m = (3n ** BigInt(strokes) - 1n) / 2n;
    const q = 4n * m;
    const k = digits.length;
    let within = 0n;
    for (const d of digits) {
      if (!Number.isInteger(d) || d < 0 || BigInt(d) >= q) throw new RangeError('digit outside 0..' + (q - 1n));
      within = within * q + BigInt(d);
    }
    const units = clock.prefix(level) * m * q ** BigInt(k - 1); // odometer steps per Saros unit
    const perCycle = q ** BigInt(k); // steps in one level-`level` cycle
    const total = BigInt(clock.extent) * units;
    const p = posRational(Math.min(tMax, Math.max(tMin, ms(t))));
    const cur = (p.numerator * units) / p.denominator; // step showing at t
    const diff = cur - within;
    const step = direction >= 0 ? 1n : -1n;
    // +1: first cycle whose state starts after `cur`; -1: last cycle whose state starts before `cur`
    let c = direction >= 0 ? (diff >= 0n ? diff / perCycle + 1n : 0n) : diff > 0n ? (diff - 1n) / perCycle : -1n;
    const out = [];
    for (let guard = 0; out.length < count && guard < count + 2; guard++, c += step) {
      if (c < 0n) break;
      const s0 = c * perCycle + within;
      if (s0 + 1n > total) break;
      out.push({
        start: num(clock.timestampAt(R(s0, units))),
        end: num(clock.timestampAt(R(s0 + 1n, units))),
        cycle: Number(c),
      });
    }
    return out;
  }

  /** Glyph for (level, digits) as SVG string, using the library's CBT. */
  function glyphSVG(index, { strokes = 2, ...style } = {}) {
    return F.CBT.fromIndex(index, { depth: strokes }).toSVG(style);
  }

  // ---- frame: everything about one instant, lazily computed ---------------
  /**
   * @typedef {object} Frame
   * @property {number} t           Unix seconds shown (rounded to ms)
   * @property {boolean} inRange    false = outside the Saros 141 catalogue
   * @property {number|null} pos    position in Saros units (0..69)
   * @property {(level:number, opts?:{strokes?:number}) => ReturnType<typeof levelAt>} level
   * @property {(level:number, opts?:{strokes?:number,digits?:number}) => ReturnType<typeof odometerAt>} odometer
   * @property {() => ReturnType<typeof solarAt>} solar
   * @property {() => ReturnType<typeof pentadAt>} pentad
   * @property {() => number[]|null} address
   */
  function frame(t) {
    t = ms(t);
    const inRange = t >= tMin && t <= tMax;
    const memo = new Map();
    const cached = (key, fn) => {
      if (!memo.has(key)) memo.set(key, fn());
      return memo.get(key);
    };
    return {
      t,
      inRange,
      pos: inRange ? positionOf(t) : null,
      level: (L, o) => cached('L' + L + ':' + (o?.strokes ?? 2), () => levelAt(t, L, o)),
      odometer: (L, o) => cached('O' + L + ':' + (o?.strokes ?? 2) + ':' + (o?.digits ?? 2), () => odometerAt(t, L, o)),
      solar: () => cached('S', () => solarAt(t)),
      pentad: () => cached('P', () => pentadAt(t)),
      address: () => cached('A', () => addressAt(t)),
    };
  }

  return Object.freeze({
    F,
    clock,
    calendar,
    sequence,
    extent,
    tMin,
    tMax,
    catalogue: E,
    meanSaros,
    levelInfo,
    levelAt,
    odometerAt,
    solarAt,
    solarSyncByNumber,
    pentadAt,
    pentadByNumber,
    addressAt,
    pathToCycle,
    cycleToPath,
    cycleByIndex,
    cycleAt,
    boundaries,
    upcomingEnds,
    stateOccurrences,
    glyphSVG,
    locate,
    positionOf,
    timeOfPosition,
    cycleStartTime,
    frame,
    inRange: (t) => t >= tMin && t <= tMax,
    clamp: (t) => Math.min(tMax, Math.max(tMin, t)),
    greek: GREEK,
  });
}
