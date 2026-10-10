/**
 * Pure mode vocabulary: how to say everything in Fractonica terms only.
 *
 * No Gregorian dates, no zones, no Earth time units (s, min, h, d, wk, mo, y, Hz) and no percentages.
 * Instead:
 *   - cycles are named by depth letter + ordinal ("Gamma Difracton" = the 2nd γ cycle in its β),
 *   - durations are counted in Fractonica periods (the "unit ladder" below),
 *   - progress through a cycle is a pair of 2-stroke glyphs (16 x 16 = 256 states, SPEC §5 odometer),
 *   - "dates" and "clocks" are cycle addresses and odometer counters.
 *
 * NOTATION (one rule, used everywhere):
 *   X#n   the n-th cycle named X inside its parent, 1-based: ζ#5, δ#6, α#6 (an ordinal, an identity)
 *   nX    a count of units X: durations "6ι 3κ", clock counters "0η 29ι 21λ" (elapsed since the parent began,
 *         0-based), ruler ticks "9η", speeds "9ι per Blink"
 *   X d   a depth chip: the letter and its depth number, only on level chips ("η 7")
 *
 * Everything here is presentation only: the clock itself still runs on Unix seconds (model.js).
 * All functions are pure with respect to (model, t); `createPure(model, {now})` binds the model.
 *
 * UNIT LADDER: one unit per depth, whole cycles only (no halves). A cycle of depth d spans 4 / P(d-1) Saros units.
 *
 *   depth  sym  unit      per parent   mean length
 *      1    α    (Alpha)       –        72 y
 *      2    β    (Beta)        5        14.4 y
 *      3    γ    (Gamma)      13        1.1 y
 *      4    δ    Atom          5        81 d
 *      5    ε    Nuclide       5        16.2 d
 *      6    ζ    Hadron        7        2.3 d
 *      7    η    Helion       11        5.05 h      <- 19 of them lock to the sun (one solar sync, ~4 d)
 *      8    θ    Quark         9        33.7 min
 *      9    ι    Preon         4        8.42 min
 *     10    κ    Chromon       5        1.68 min
 *     11    λ    Flavon       13        7.77 s
 *     12    μ    Somon         5        1.55 s
 *     13    ν    Blink         5        0.311 s     <- the atomic unit and the device's real-time tick
 *
 * The "atomic" cadence is ν -25-> λ -65-> ι -36-> η (Blink, Flavon, Preon, Helion); μ, κ, θ sit between them.
 * Spans finer than one Blink are written as a decimal count of it ("0.14ν"). Real time is counted in Blinks and a
 * real frequency in cycles per Blink ("34 pB"), never in seconds or Hz.
 */

const F = globalThis.Fractonica;

export const LEVEL_NAMES = Object.freeze([
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi',
  'Omicron', 'Pi', 'Rho', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega',
]);
export const LEVEL_LETTERS = 'αβγδεζηθικλμνξοπρστυφχψω';

/** Ordinal names, 1-based. Edit this table to rename them (11 follows the owner's own coinage). */
export const ORDINAL_NAMES = Object.freeze([
  '', 'Monofracton', 'Difracton', 'Trifracton', 'Tetrafracton', 'Pentafracton', 'Hexafracton', 'Heptafracton',
  'Octafracton', 'Nonafracton', 'Decafracton', 'Didecafracton', 'Dodecafracton', 'Tridecafracton',
  'Tetradecafracton', 'Pentadecafracton', 'Hexadecafracton', 'Heptadecafracton', 'Octadecafracton',
  'Nonadecafracton', 'Icosafracton',
]);

/** "Difracton" for 2; beyond the table a plain "#25". */
export function ordinalName(n) {
  return n >= 1 && n < ORDINAL_NAMES.length ? ORDINAL_NAMES[n] : `#${n}`;
}
/** "Gamma Difracton": the `ordinal`-th (1-based, local to its parent; global for Alpha) cycle of `level`. */
export function periodName(level, ordinal) {
  return `${LEVEL_NAMES[level] ?? 'Level ' + (level + 1)} ${ordinalName(ordinal)}`;
}
/** "γ#2": compact form of the same thing. */
export function shortName(level, ordinal) {
  return `${LEVEL_LETTERS[level] ?? '?'}#${ordinal}`;
}

/**
 * The ladder durations are counted in, longest first: one unit per depth. `name` is the unit's own word (α β γ have
 * no particle name yet and read as their level name: edit this table to rename any of them; `named` marks the ten
 * that do).
 */
export const UNITS = Object.freeze(
  [
    ['alpha', 'α', 0, null],
    ['beta', 'β', 1, null],
    ['gamma', 'γ', 2, null],
    ['delta', 'δ', 3, 'Atom'],
    ['epsilon', 'ε', 4, 'Nuclide'],
    ['zeta', 'ζ', 5, 'Hadron'],
    ['eta', 'η', 6, 'Helion'],
    ['theta', 'θ', 7, 'Quark'],
    ['iota', 'ι', 8, 'Preon'],
    ['kappa', 'κ', 9, 'Chromon'],
    ['lambda', 'λ', 10, 'Flavon'],
    ['mu', 'μ', 11, 'Somon'],
    ['nu', 'ν', 12, 'Blink'],
  ].map(([id, sym, level, name]) =>
    Object.freeze({ id, sym, level, name: name ?? LEVEL_NAMES[level], named: name !== null }),
  ),
);

/** The unit of a symbol ("η") or id ("eta"); undefined when it is not on the ladder. */
export const unitOf = (key) => UNITS.find((u) => u.sym === key || u.id === key);
/** "Helion" / "Helions" for a symbol or id; `n` = 1 gives the singular. */
export function unitName(key, n = 1) {
  const u = unitOf(key);
  if (!u) return String(key);
  return n === 1 || u.named === false ? u.name : `${u.name}s`;
}

/** Ids of the units durations are counted in (all thirteen; see `COUNTED` in createPure). */
const DURATION_UNITS = UNITS.map((u) => u.id);

/** The word for one tick of the device's real time: speeds are "units per Blink", frequencies "cycles per Blink". */
export const BLINK = 'Blink';
/** Compact form of "cycles per Blink": the replacement of Hz. */
export const PER_BLINK = 'pB';

export function createPure(model, { now = () => model.tMin } = {}) {
  const P = (level) => model.levelInfo(level).prefixNum;
  /** Length of a unit (one whole cycle of its depth) in Saros position units. */
  const unitPos = (u) => 4 / P(u.level);
  /** Length of a whole cycle of `level` in Saros position units (4 / P). */
  const cyclePos = (level) => 4 / P(level);
  /**
   * The units durations are counted in. Every depth is a unit; to count in the four "atomic" steps only
   * (ν λ ι η and above) drop 'mu', 'kappa' and 'theta' from this list: nothing else changes.
   */
  const COUNTED = UNITS.filter((u) => DURATION_UNITS.includes(u.id));
  const LENGTHS = COUNTED.map(unitPos);
  /** Mean seconds of a unit (only used for rate presets). */
  const unitSeconds = (u) => model.levelInfo(u.level).meanSeconds;
  const NU = UNITS.at(-1);
  const FINEST = UNITS.length - 1; // the Blink is always the last counted unit
  /** Mean device seconds in one Blink: the bridge between real time and the ladder (rates, tempo lock, pB). */
  const blinkSeconds = () => unitSeconds(NU);

  /** Seconds per Saros position unit around time `at` (the catalogue interval it falls in). */
  function secondsPerPosition(at = now()) {
    const loc = model.locate(Math.min(model.tMax - 1e-3, Math.max(model.tMin, at)));
    const k = loc ? loc.k : 0;
    return model.catalogue[k + 1] - model.catalogue[k];
  }

  // ---- durations --------------------------------------------------------
  /**
   * Break a position span (Saros units, >= 0) into counts of ladder units, starting from the largest unit that fits.
   * Returns up to `parts` NON-ZERO counts, longest first, skipping units whose count is zero ("3η 2ι", never
   * "3η 0θ 2ι": every count carries its own symbol, so a skipped unit loses nothing). With `keepZeros` the parts are
   * the next `parts` consecutive units instead, zeros included ("1ζ 0η").
   * @returns {{unit: object, count: number}[]}
   */
  // Float positions carry ~1e-14 Saros of error (position ~ 70, double precision), which is more than a whole ν
  // (5.5e-10) times 1e-4: counting units with only a relative fudge reads exact cycle lengths one small unit short.
  // 1e-12 Saros is 0.6 ms: negligible next to the finest unit, the Blink (311 ms).
  const EPS_POS = 1e-12;
  function decompose(dpos, parts = 2, keepZeros = false) {
    let rem = Math.abs(dpos) + EPS_POS;
    let first = LENGTHS.findIndex((len) => len <= rem);
    if (first < 0) first = FINEST; // finer than a Blink: count 0 (durationPos writes it as a decimal)
    const out = [];
    for (let i = first; i < COUNTED.length && out.length < parts; i++) {
      const count = Math.floor(rem / LENGTHS[i]);
      rem -= count * LENGTHS[i];
      if (rem < 0) rem = 0;
      if (count > 0 || keepZeros || out.length === 0) out.push({ unit: COUNTED[i], count });
    }
    return out;
  }
  /** "2ζ 4η". With `keepZeros` trailing zero parts stay ("1ζ 0η"); otherwise zero parts are never printed. */
  const join = (cs) => cs.map(({ unit, count }) => `${count}${unit.sym}`).join(' ');

  /**
   * A count of Blinks with a decimal part: "0.14", "2.6", "4" (two significant digits below one, one decimal above).
   * Used where the ladder runs out: a span finer than a Blink, or one that is only a few Blinks long.
   */
  function blinkCount(x) {
    if (x < 1e-4) return '0';
    if (x < 0.001) return '<0.001';
    if (x < 1) return String(Number(x.toPrecision(2)));
    const r = Math.round(x * 10) / 10;
    return String(r);
  }
  /**
   * "2ζ 4η" for a span of `dpos` Saros units (see `decompose` for zeros). The ladder ends at the Blink: a span
   * shorter than five Blinks (its leading unit is ν itself) keeps a decimal, "2.6ν", "0.14ν".
   */
  function durationPos(dpos, { parts = 2, keepZeros = false } = {}) {
    const span = Math.abs(dpos);
    const cs = decompose(dpos, parts, keepZeros);
    let text;
    if (cs[0].unit === NU) text = `${blinkCount(span / LENGTHS[FINEST])}${NU.sym}`;
    else text = join(cs);
    return dpos < 0 && /[1-9]/.test(text) ? '−' + text : text;
  }
  /** Same for a number of device seconds around time `at` (default: the displayed time). */
  function duration(seconds, { parts = 2, at, keepZeros = false } = {}) {
    return durationPos(seconds / secondsPerPosition(at), { parts, keepZeros });
  }
  /** "in 2ζ 4η" / "2ζ 4η ago". */
  function countdown(seconds, { parts = 2, at, keepZeros = false } = {}) {
    const d = Math.abs(seconds);
    const text = duration(d, { parts, at, keepZeros });
    return seconds < 0 ? `${text} ago` : `in ${text}`;
  }
  /** Span between two instants measured in position (exact across eclipse intervals). */
  function between(t1, t2, { parts = 2, keepZeros = false } = {}) {
    const a = model.positionOf(t1);
    const b = model.positionOf(t2);
    if (a === null || b === null) return duration(t2 - t1, { parts, at: t1, keepZeros });
    return durationPos(b - a, { parts, keepZeros });
  }

  // ---- 256-state phase pairs ---------------------------------------------
  /** Fraction 0..1 of a cycle -> two 2-stroke glyph indices (0..15 each), 256 states. */
  function pair(fraction) {
    const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
    const index = Math.min(255, Math.floor(f * 256));
    return { index, hi: index >> 4, lo: index & 15 };
  }
  /** "13·4": the pair as two digits (aria-labels, tooltips, tests). */
  const pairText = (fraction) => {
    const p = pair(fraction);
    return `${p.hi}·${p.lo}`;
  };
  const glyphCache = new Map();
  function glyph(index, color) {
    const key = index + color;
    let g = glyphCache.get(key);
    if (!g) {
      g = F.CBT.fromIndex(index, { depth: 2 })
        .toSVG({ color, scale: 10, thickness: 0.3, padding: 0.25 })
        // the wrapper carries the one label; the library's per-glyph <title>/aria-label would add a native
        // tooltip ("vector CBT value 3, index 5 ...") and double screen-reader output
        .replace(/<title>[\s\S]*?<\/title>/, '')
        .replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true" focusable="false"');
      glyphCache.set(key, g);
    }
    return g;
  }
  /** The spoken name of a pair: "phase 8 and 0 of 256" (aria-label / aria-valuetext / tooltips). */
  const pairLabel = (fraction, label = 'phase') => {
    const p = pair(fraction);
    return `${label} ${p.hi} and ${p.lo} of 256`;
  };
  /**
   * Inline HTML for the pair: two library glyphs side by side, coloured by `currentColor`, sized by CSS
   * (`.pure-pair svg { height: 1.7em }` in app.css). `label` prefixes the aria-label ("phase").
   */
  function pairHTML(fraction, { label = 'phase', color = 'currentColor' } = {}) {
    const p = pair(fraction);
    return `<span class="pure-pair" role="img" aria-label="${pairLabel(fraction, label)}">${glyph(p.hi, color)}${glyph(p.lo, color)}</span>`;
  }
  const pathCache = new Map();
  function glyphPath(index) {
    let g = pathCache.get(index);
    if (!g) {
      const geo = F.CBT.geometry(F.CBT.fromIndex(index, { depth: 2 }), { thickness: 0.3 });
      g = { path: new Path2D(geo.path), dot: geo.dot, bounds: geo.bounds };
      pathCache.set(index, g);
    }
    return g;
  }
  /**
   * Draw the pair on a canvas with its top-left at (x, y) and the given pixel height; returns the width used.
   * Strokes use the context's current strokeStyle/fillStyle (set them first).
   */
  function drawPair(ctx, fraction, x, y, height, { lineWidth } = {}) {
    const p = pair(fraction);
    const b = glyphPath(0).bounds;
    const h = b.maxY - b.minY;
    const s = height / h;
    const gap = 1.1;
    const w = (b.maxX - b.minX) * s;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lineWidth ?? Math.max(1, 0.3 * s);
    for (let i = 0; i < 2; i++) {
      const g = glyphPath(i ? p.lo : p.hi);
      ctx.save();
      ctx.translate(x + (i ? w + gap * s : 0) + -b.minX * s, y - b.minY * s);
      ctx.scale(s, s);
      ctx.lineWidth = ctx.lineWidth / s;
      ctx.stroke(g.path);
      if (g.dot) {
        ctx.beginPath();
        ctx.arc(0, b.dotY, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
    return 2 * w + gap * s;
  }
  /** Width the pair takes at a given pixel height (for layout before drawing). */
  function pairWidth(height) {
    const b = glyphPath(0).bounds;
    const s = height / (b.maxY - b.minY);
    return 2 * (b.maxX - b.minX) * s + 1.1 * s;
  }

  // ---- clocks, dates, stamps ---------------------------------------------
  /**
   * The pure "clock": odometer counters inside the current ζ cycle (depth 6, one Hadron):
   * eta 0..10 (depth 7 within ζ), iota 0..35 (depth 9 within η), lambda 0..64 (depth 11 within ι).
   * @returns {null | {eta:number, iota:number, lambda:number}}
   */
  function clock(t) {
    const e = model.levelAt(t, 6);
    if (!e) return null;
    const th = model.levelAt(t, 7);
    const io = model.levelAt(t, 8);
    const ka = model.levelAt(t, 9);
    const la = model.levelAt(t, 10);
    return { eta: e.local, iota: th.local * 4 + io.local, lambda: ka.local * 13 + la.local };
  }
  /** "3·17·42" */
  function clockText(t) {
    const c = clock(t);
    return c ? `${c.eta}·${c.iota}·${c.lambda}` : '—';
  }
  /**
   * The pure "date": the ordinal of the running cycle inside its parent for the six longest depths, all 1-based:
   * α (1..18) β (1..5 in α) γ (1..13 in β) δ (1..5 in γ) ε (1..5 in δ) ζ (1..7 in ε). Whole cycles only.
   * @returns {null | {alpha:number, beta:number, gamma:number, delta:number, epsilon:number, zeta:number}}
   */
  function date(t) {
    const l = [0, 1, 2, 3, 4, 5].map((L) => model.levelAt(t, L));
    if (l.some((x) => !x)) return null;
    return {
      alpha: l[0].cycle + 1,
      beta: l[1].local + 1,
      gamma: l[2].local + 1,
      delta: l[3].local + 1,
      epsilon: l[4].local + 1,
      zeta: l[5].local + 1,
    };
  }
  /** "α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#5": every part is an ordinal (see NOTATION). */
  function dateText(t) {
    const d = date(t);
    if (!d) return '—';
    return `α#${d.alpha} β#${d.beta} γ#${d.gamma} · δ#${d.delta} · ε#${d.epsilon} · ζ#${d.zeta}`;
  }
  /** Compact date for tight spaces: "6·4·9 · 3·2·5" (α β γ · δ ε ζ). */
  function dateCompact(t) {
    const d = date(t);
    return d ? `${d.alpha}·${d.beta}·${d.gamma} · ${d.delta}·${d.epsilon}·${d.zeta}` : '—';
  }
  const STAMP_LEVELS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'iota', 'lambda'];
  /**
   * An instant written as a pure address down to a resolution: upTo = 'beta'|'gamma'|'delta'|'epsilon'|'zeta'
   * (ordinals) or 'eta'|'iota'|'lambda' (adds the elapsed counters). Default 'iota'.
   * "α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#5 · 3η 17ι"
   */
  function stamp(t, upTo = 'iota') {
    const d = date(t);
    if (!d) return '—';
    const k = Math.max(0, STAMP_LEVELS.indexOf(upTo));
    const parts = [];
    const head = [`α#${d.alpha}`];
    if (k >= 1) head.push(`β#${d.beta}`);
    if (k >= 2) head.push(`γ#${d.gamma}`);
    parts.push(head.join(' '));
    if (k >= 3) parts.push(`δ#${d.delta}`);
    if (k >= 4) parts.push(`ε#${d.epsilon}`);
    if (k >= 5) parts.push(`ζ#${d.zeta}`);
    if (k >= 6) {
      const c = clock(t);
      const counters = [`${c.eta}η`];
      if (k >= 7) counters.push(`${c.iota}ι`);
      if (k >= 8) counters.push(`${c.lambda}λ`);
      parts.push(counters.join(' '));
    }
    return parts.join(' · ');
  }

  /** The n-th eclipse of the catalogue, 0-based like the position (eclipse #22 sits at pos 22): "#22". */
  const eclipseName = (k) => `#${k}`;
  /** Exact nominal length of one full cycle of `level` ("1η 0ι"): never measured between two floats. */
  const cycleLength = (level, { parts = 2 } = {}) => durationPos(4 / P(level), { parts });

  // ---- solar drift ---------------------------------------------------------
  const NNBSP = '\u202f';
  /** 6231 -> "6 231" (narrow no-break space), -48420 -> "−48 420": digit groups never look like a year. */
  function groupDigits(n) {
    const v = Math.trunc(n);
    const body = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
    return (v < 0 ? '−' : '') + body;
  }
  /**
   * Solar drift counted in λ, the same everywhere: the accumulated shift of a sync start against the 4-day grid,
   * measured in position (exact across eclipse intervals). `sol` is a model.solarAt() / solarSyncByNumber() reading.
   */
  function driftLambda({ start, nominalStart, drift }) {
    const lam = unitPos(UNITS.find((u) => u.id === 'lambda'));
    const a = model.positionOf(nominalStart);
    const b = model.positionOf(start);
    const dpos = a !== null && b !== null ? b - a : drift / secondsPerPosition(start);
    return Math.round(dpos / lam) || 0;
  }
  /** "−623λ" / "+12λ" / "0λ" */
  const driftText = (sol) => {
    const n = driftLambda(sol);
    return `${n > 0 ? '+' : ''}${groupDigits(n)}λ`;
  };

  // ---- cycle names -------------------------------------------------------
  /** 1-based ordinal of cycle `cycleIdx` of `level` inside its parent (Alpha: global). */
  function ordinalOf(level, cycleIdx) {
    const sib = model.levelInfo(level).siblings;
    const i = Number(cycleIdx);
    return sib === null ? i + 1 : (i % sib) + 1;
  }
  /** "Zeta Pentafracton" for cycle `cycleIdx` (global index) of `level`. */
  const cycleName = (level, cycleIdx) => periodName(level, ordinalOf(level, cycleIdx));
  /** "ζ#5" */
  const cycleShort = (level, cycleIdx) => shortName(level, ordinalOf(level, cycleIdx));
  /** The name of the cycle running at t (or null). */
  function nameAt(t, level) {
    const l = model.levelAt(t, level);
    return l ? cycleName(level, l.cycle) : null;
  }
  /** Full address chain of the cycle running at t down to `level`: "α#6 β#4 γ#9 δ#3". */
  function addressAt(t, level) {
    const parts = [];
    for (let L = 0; L <= level; L++) {
      const l = model.levelAt(t, L);
      if (!l) return '—';
      parts.push(shortName(L, ordinalOf(L, l.cycle)));
    }
    return parts.join(' ');
  }
  /** The catalogue's extent in pure terms: "α#1 – α#18". */
  const catalogueText = () => `${shortName(0, 1)} – ${shortName(0, Number(model.clock.count(0)))}`;

  // ---- speeds and real time ------------------------------------------------
  /**
   * Time-lapse presets: how many whole cycles of a unit pass per Blink of real time. "ν per Blink" is real time
   * itself (one Blink of clock per Blink of device time); the others are exact integers (μ 5, λ 25, κ 325, ι 1625,
   * θ 6 500, η 58 500 ...) because the ladder is a product of whole factors.
   */
  const RATE_UNITS = ['mu', 'lambda', 'kappa', 'iota', 'theta', 'eta', 'zeta', 'epsilon', 'delta', 'gamma'];
  const RATES = Object.freeze([
    { id: 'real', rate: 1, label: 'real time' },
    ...RATE_UNITS.map((id) => {
      const u = unitOf(id);
      return { id, rate: Number((unitSeconds(u) / blinkSeconds()).toPrecision(12)), label: `${u.sym} per ${BLINK}` };
    }),
  ]);
  /**
   * "η per Blink" for a preset; any other rate is counted in the largest unit that passes at least once per Blink:
   * "3.6η per Blink". Slower than real time it reads "0.5ν per Blink". Negative rates read "… backward".
   */
  function rateLabel(rate) {
    const r = Math.abs(rate);
    const hit = RATES.find((p) => Math.abs(p.rate - r) / p.rate < 0.005);
    let base;
    if (hit) base = hit.label;
    else {
      const per = r * blinkSeconds(); // clock seconds per Blink of real time
      const u = UNITS.find((x) => unitSeconds(x) <= per * 1.0000001) ?? NU;
      const k = per / unitSeconds(u);
      const near = Math.round(k);
      const text = Math.abs(k - near) / near < 0.005 && near >= 1 ? String(near) : String(Number(k.toPrecision(3)));
      base = `${text}${u.sym} per ${BLINK}`;
    }
    return rate < 0 ? `${base} backward` : base;
  }
  /** "3.5 Blinks": a span of device (real) seconds counted in Blinks (tempo lock, scrub lengths, leads). */
  function blinks(seconds) {
    const n = seconds / blinkSeconds();
    if (n > 0 && n < 0.001) return `<0.001 ${BLINK}s`;
    const rounded = Number(n.toPrecision(3));
    const text = rounded >= 1000 ? groupDigits(rounded) : String(rounded);
    return `${text} ${BLINK}${text === '1' ? '' : 's'}`;
  }
  /** Device seconds of a count of Blinks (the inverse of `blinks`, for number boxes). */
  const blinksToSeconds = (n) => n * blinkSeconds();
  const secondsToBlinks = (s) => s / blinkSeconds();
  /**
   * A real frequency (cycles per device second, "Hz") as cycles per Blink: the replacement of Hz. 22.5 Hz -> 7.
   * The true rates of the deepest cycles are whole numbers of it (ξ 7, ο 77, π 693, ρ 2 772).
   */
  const perBlink = (hz) => hz * blinkSeconds();
  /**
   * "34.2 pB", "2 772 pB", "0.2 pB"; slower than one cycle per 25 Blinks it reads "1 per 190 Blinks" (a cycle
   * length is better said in units: use `cycleLength`).
   */
  function pbText(pb) {
    if (!(pb > 0) || !Number.isFinite(pb)) return '—';
    if (pb < 0.04 - 1e-9) {
      const every = 1 / pb;
      return `1 per ${groupDigits(Math.round(every))} ${BLINK}s`;
    }
    const v = pb >= 999.5 ? groupDigits(Math.round(pb)) : pb >= 99.95 ? String(Number(pb.toFixed(1))) : String(Number(pb.toPrecision(3)));
    return `${v} ${PER_BLINK}`;
  }

  return Object.freeze({
    LEVEL_NAMES, ORDINAL_NAMES, UNITS, RATES, BLINK, PER_BLINK, unitOf, unitName,
    ordinalName, periodName, shortName,
    unitPos, cyclePos, unitSeconds, blinkSeconds, secondsPerPosition, EPS_POS,
    decompose, durationPos, duration, countdown, between,
    pair, pairText, pairLabel, pairHTML, drawPair, pairWidth,
    clock, clockText, date, dateText, dateCompact, stamp, eclipseName, cycleLength,
    groupDigits, driftLambda, driftText,
    ordinalOf, cycleName, cycleShort, nameAt, addressAt, catalogueText,
    rateLabel, blinks, blinksToSeconds, secondsToBlinks, perBlink, pbText,
  });
}
