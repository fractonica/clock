/**
 * Pure mode vocabulary: how to say everything in Fractonica terms only (revision 3, SPEC §15).
 *
 * No Gregorian dates, no zones, no Earth time units (s, min, h, d, wk, mo, y, Hz) and no percentages.
 *
 * TWO KINDS OF PERIOD
 *   major (ultrahelion)   α Alpha · β Beta · γ Gamma · δ Delta. Said in WORDS: the level, its fracton ordinal inside the
 *                         parent and the quarter it is in: "Delta Trifracton Node". The quarter is named by the threshold
 *                         that ends it (SPEC §6.2): Peak, Node, Valley, End. Their phase is never drawn: it follows from
 *                         the Nuclide and Helion count.
 *   minor (infrahelion)   ε Nuclide · η Helion · ι Preon · λ Flavon · ν Blink. Said in LETTERS. Below δ the ladder skips
 *                         every other depth: a Delta is 5 Nuclides, a Nuclide 77 Helions (7 ζ x 11 η), a Helion
 *                         36 Preons, a Preon 65 Flavons, a Flavon 25 Blinks. ζ θ κ μ (and ξ, ο …) stay depths of the
 *                         hierarchy (rows, rings, lanes) but are not units and have no names of their own.
 *   Helion, Preon and Flavon are the everyday units; a Helion's phase (two 2-stroke glyphs, 256 states) is the basic
 *   reading, the Blink is the finest unit and the device's real-time tick.
 *
 * DATES (all from one reading of the clock)
 *   full words    Alpha Pentafracton Peak, Beta Tetrafracton Valley, Gamma Difracton End, Delta Trifracton Node, ε#2 5η 5ι 5λ 5ν
 *   short words   Delta Trifracton Node ε#2 5η 5ι
 *   full letters  α#5 β#4 γ#2 δ#3 ε#2 5η 5ι 5λ          (the stamp: unambiguous, no quarter words)
 *   short letters δ#3 ε#2 5η 5ι
 *   ε#n is the Nuclide inside its Delta (1..5); then COUNTS of completed units: Helions 0..76 inside the Nuclide,
 *   Preons 0..35, Flavons 0..64, Blinks 0..24 (Flavons and Blinks optional, like seconds).
 *
 * NOTATION (one rule)
 *   X#n   an ordinal, 1-based (α#6, δ#3, ε#2): an identity
 *   nX    a count of units, 0-based (5η 5ι, spans "6ι 43λ", ruler ticks "9η", speeds "4ι per Blink")
 *   X d   a depth chip, only on level chips ("η 7")
 *
 * Everything here is presentation only: the clock itself still runs on Unix seconds (model.js).
 * All functions are pure with respect to (model, t); `createPure(model, {now})` binds the model.
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

/** The quarter of a major period, named by the threshold that ends it (SPEC §6.2). */
export const QUARTER_WORDS = Object.freeze(['Peak', 'Node', 'Valley', 'End']);

/** Levels said in words (α β γ δ). */
export const MAJOR_LEVELS = Object.freeze([0, 1, 2, 3]);
export const isMajor = (level) => level >= 0 && level <= 3;

/** "Difracton" for 2; beyond the table a plain "#25". */
export function ordinalName(n) {
  return n >= 1 && n < ORDINAL_NAMES.length ? ORDINAL_NAMES[n] : `#${n}`;
}
/**
 * "Delta Trifracton": the `ordinal`-th (1-based, local to its parent; global for Alpha) cycle of a MAJOR level. Only α β γ δ
 * have fracton names; for any other level this returns the letter form "ε#2" (see `cycleName` for the minor naming).
 */
export function periodName(level, ordinal) {
  if (!isMajor(level)) return shortName(level, ordinal);
  return `${LEVEL_NAMES[level]} ${ordinalName(ordinal)}`;
}
/** "γ#2": the compact letter form of an ordinal. */
export function shortName(level, ordinal) {
  return `${LEVEL_LETTERS[level] ?? '?'}#${ordinal}`;
}

/**
 * The unit ladder, longest first: the four major periods, then the minor units one depth apart.
 * `parent` is how many of this unit make one of the previous unit (Alpha: none).
 */
export const UNITS = Object.freeze(
  [
    ['alpha', 'α', 0, 'Alpha', true],
    ['beta', 'β', 1, 'Beta', true],
    ['gamma', 'γ', 2, 'Gamma', true],
    ['delta', 'δ', 3, 'Delta', true],
    ['epsilon', 'ε', 4, 'Nuclide', false],
    ['eta', 'η', 6, 'Helion', false],
    ['iota', 'ι', 8, 'Preon', false],
    ['lambda', 'λ', 10, 'Flavon', false],
    ['nu', 'ν', 12, 'Blink', false],
  ].map(([id, sym, level, name, major]) => Object.freeze({ id, sym, level, name, major, named: true })),
);
/** Levels that are units (0 1 2 3 4 6 8 10 12). */
export const UNIT_LEVELS = Object.freeze(UNITS.map((u) => u.level));
export const isUnitLevel = (level) => UNIT_LEVELS.includes(level);

/** The unit of a symbol ("η"), id ("eta"), name ("Helion") or level (6); undefined when it is not on the ladder. */
export const unitOf = (key) =>
  UNITS.find((u) => u.sym === key || u.id === key || u.name === key || (typeof key === 'number' && u.level === key));
/** "Helion" / "Helions" for a symbol, id or level; `n` = 1 gives the singular. */
export function unitName(key, n = 1) {
  const u = unitOf(key);
  if (!u) return String(key);
  return n === 1 ? u.name : `${u.name}s`;
}
/**
 * What a depth is: 'major' (α β γ δ), 'unit' (ε η ι λ ν), 'between' (ζ θ κ μ: skipped by the ladder) or 'sub' (ξ and finer,
 * shorter than a Blink).
 */
export function levelKind(level) {
  if (isMajor(level)) return 'major';
  if (isUnitLevel(level)) return 'unit';
  return level < 12 ? 'between' : 'sub';
}

/** The word for one tick of the device's real time: speeds are "units per Blink", frequencies "cycles per Blink". */
export const BLINK = 'Blink';
/** Compact form of "cycles per Blink": the replacement of Hz. */
export const PER_BLINK = 'pB';

/** Resolution words of `stamp` / `dateText`, coarse to fine. */
const STAMP_LEVELS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'eta', 'iota', 'lambda', 'nu'];

export function createPure(model, { now = () => model.tMin } = {}) {
  const P = (level) => model.levelInfo(level).prefixNum;
  const PB = (level) => BigInt(P(level));
  /** Length of a unit (one whole cycle of its depth) in Saros position units. */
  const unitPos = (u) => 4 / P(u.level);
  /** Length of a whole cycle of `level` in Saros position units (4 / P). */
  const cyclePos = (level) => 4 / P(level);
  const LENGTHS = UNITS.map(unitPos);
  /** Mean seconds of a unit (only used for real-time conversions). */
  const unitSeconds = (u) => model.levelInfo(u.level).meanSeconds;
  const NU = UNITS.at(-1);
  const FINEST = UNITS.length - 1;
  /** Mean device seconds in one Blink: the bridge between real time and the ladder (rates, tempo lock, pB). */
  const blinkSeconds = () => unitSeconds(NU);

  /** Seconds per Saros position unit around time `at` (the catalogue interval it falls in). */
  function secondsPerPosition(at = now()) {
    const loc = model.locate(Math.min(model.tMax - 1e-3, Math.max(model.tMin, at)));
    const k = loc ? loc.k : 0;
    return model.catalogue[k + 1] - model.catalogue[k];
  }

  // ---- durations --------------------------------------------------------
  // Float positions carry ~1e-14 Saros of error (position ~ 70, double precision), which is more than a whole ν
  // (5.5e-10) times 1e-4: counting units with only a relative fudge reads exact cycle lengths one small unit short.
  // 1e-12 Saros is 0.6 ms: negligible next to the finest unit, the Blink (311 ms).
  const EPS_POS = 1e-12;
  /**
   * Break a position span (Saros units, >= 0) into counts of ladder units (α β γ δ ε η ι λ ν), starting from the largest
   * unit that fits. Returns up to `parts` NON-ZERO counts, longest first, skipping units whose count is zero ("3η 2λ",
   * never "3η 0ι 2λ"). With `keepZeros` the parts are the next `parts` consecutive units instead, zeros included.
   * @returns {{unit: object, count: number}[]}
   */
  function decompose(dpos, parts = 2, keepZeros = false) {
    let rem = Math.abs(dpos) + EPS_POS;
    let first = LENGTHS.findIndex((len) => len <= rem);
    if (first < 0) first = FINEST; // finer than a Blink: count 0 (durationPos writes it as a decimal)
    const out = [];
    for (let i = first; i < UNITS.length && out.length < parts; i++) {
      const count = Math.floor(rem / LENGTHS[i]);
      rem -= count * LENGTHS[i];
      if (rem < 0) rem = 0;
      if (count > 0 || keepZeros || out.length === 0) out.push({ unit: UNITS[i], count });
    }
    return out;
  }
  const join = (cs) => cs.map(({ unit, count }) => `${count}${unit.sym}`).join(' ');

  /**
   * A count of Blinks with a decimal part: "0.14", "2.6", "4" (two significant digits below one, one decimal above).
   * Used where the ladder runs out: a span finer than a Blink, or one that is only a few Blinks long.
   */
  function blinkCount(x) {
    if (x < 1e-4) return '0';
    if (x < 0.001) return '<0.001';
    if (x < 1) return String(Number(x.toPrecision(2)));
    return String(Math.round(x * 10) / 10);
  }
  /**
   * "2ε 5η" / "5η 12ι" / "6ι 43λ" for a span of `dpos` Saros units (see `decompose` for zeros). The ladder ends at the
   * Blink: a span shorter than one Flavon (its leading unit is ν itself) keeps a decimal, "2.6ν", "0.14ν".
   */
  function durationPos(dpos, { parts = 2, keepZeros = false } = {}) {
    const span = Math.abs(dpos);
    const cs = decompose(dpos, parts, keepZeros);
    let text;
    if (cs[0].unit === NU && span / LENGTHS[FINEST] < 10) text = `${blinkCount(span / LENGTHS[FINEST])}${NU.sym}`;
    else text = join(cs);
    return dpos < 0 && /[1-9]/.test(text) ? '−' + text : text;
  }
  /** Same for a number of device seconds around time `at` (default: the displayed time). */
  function duration(seconds, { parts = 2, at, keepZeros = false } = {}) {
    return durationPos(seconds / secondsPerPosition(at), { parts, keepZeros });
  }
  /** "in 5η 12ι" / "5η 12ι ago". */
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
  /** "13·4": the pair as two digits (tests, compact tooltips). */
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

  // ---- counting a global cycle index into the minor ladder ---------------
  /**
   * Where the start of cycle `cycleBig` of `level` falls on the minor ladder: the Nuclide ordinal and the counts of
   * completed Helions (in the Nuclide), Preons (in the Helion), Flavons (in the Preon) and Blinks (in the Flavon) – the
   * counts of units finer than `level` are 0 at a start, and `nuFrac` is the fraction of a Blink for levels below ν.
   * Exact BigInt arithmetic: every P ratio is a whole number.
   */
  function countsAtStart(level, cycleBig) {
    const c = BigInt(cycleBig);
    const at = (L) => (L <= level ? c / (PB(level) / PB(L)) : c * (PB(L) / PB(level)));
    const local = (L, parentL) => Number(at(L) % (PB(L) / PB(parentL)));
    const out = {
      delta: Number(at(3) % 5n) + 1,
      epsilon: local(4, 3) + 1,
      eta: local(6, 4),
      iota: local(8, 6),
      lambda: local(10, 8),
      nu: local(12, 10),
      nuFrac: 0,
    };
    if (level > 12) {
      const ratio = PB(level) / PB(12);
      out.nuFrac = Number(c % ratio) / Number(ratio);
    }
    return out;
  }

  // ---- clocks, dates, stamps ---------------------------------------------
  /**
   * The pure clock: the Nuclide (ordinal 1..5 in its Delta) and the counts of completed minor units:
   * eta 0..76 (in the Nuclide), iota 0..35 (in the Helion), lambda 0..64 (in the Preon), nu 0..24 (in the Flavon).
   * @returns {null | {epsilon:number, eta:number, iota:number, lambda:number, nu:number}}
   */
  function clock(t) {
    const l = [4, 5, 6, 7, 8, 9, 10, 11, 12].map((L) => model.levelAt(t, L));
    if (l.some((x) => !x)) return null;
    const [ep, ze, et, th, io, ka, la, mu, nu] = l;
    return {
      epsilon: ep.local + 1,
      eta: ze.local * 11 + et.local,
      iota: th.local * 4 + io.local,
      lambda: ka.local * 13 + la.local,
      nu: mu.local * 5 + nu.local,
    };
  }
  /** "5η 5ι 5λ" (counts only, down to `upTo`: 'eta' | 'iota' | 'lambda' | 'nu'). */
  function clockText(t, upTo = 'lambda') {
    const c = clock(t);
    if (!c) return '—';
    const k = STAMP_LEVELS.indexOf(upTo);
    const parts = [`${c.eta}η`];
    if (k >= 6) parts.push(`${c.iota}ι`);
    if (k >= 7) parts.push(`${c.lambda}λ`);
    if (k >= 8) parts.push(`${c.nu}ν`);
    return parts.join(' ');
  }
  /** 0..3: the quarter of the running cycle of `level` (0 = Peak … 3 = End), or null outside. */
  function quarterAt(t, level) {
    const l = model.levelAt(t, level);
    return l ? Math.min(3, Math.floor(l.phase * 4)) : null;
  }
  /**
   * The pure date: ordinals of the four major periods (α 1..18, β 1..5, γ 1..13, δ 1..5) with their quarter words,
   * and the Nuclide ordinal ε 1..5.
   * @returns {null | {alpha, beta, gamma, delta, epsilon:number, quarter:{alpha, beta, gamma, delta:string}}}
   */
  function date(t) {
    const l = [0, 1, 2, 3, 4].map((L) => model.levelAt(t, L));
    if (l.some((x) => !x)) return null;
    const q = (x) => QUARTER_WORDS[Math.min(3, Math.floor(x.phase * 4))];
    return {
      alpha: l[0].cycle + 1,
      beta: l[1].local + 1,
      gamma: l[2].local + 1,
      delta: l[3].local + 1,
      epsilon: l[4].local + 1,
      quarter: { alpha: q(l[0]), beta: q(l[1]), gamma: q(l[2]), delta: q(l[3]) },
    };
  }
  /** "Delta Trifracton Node": a major period running at t in words, with its quarter. */
  function majorText(t, level) {
    const l = model.levelAt(t, level);
    if (!l || !isMajor(level)) return '—';
    return `${periodName(level, ordinalOf(level, l.cycleBig ?? l.cycle))} ${QUARTER_WORDS[Math.min(3, Math.floor(l.phase * 4))]}`;
  }
  /**
   * The date at t.
   *   form 'short' (default)  "Delta Trifracton Node ε#2 5η 5ι"
   *   form 'full'             "Alpha Pentafracton Peak, Beta Tetrafracton Valley, Gamma Difracton End, Delta Trifracton Node, ε#2 5η 5ι"
   *   letters: true           "δ#3 ε#2 5η 5ι" / "α#5 β#4 γ#2 δ#3 ε#2 5η 5ι" (no quarter words: they are implied)
   *   upTo                    the finest part: 'delta' | 'epsilon' | 'eta' | 'iota' (default) | 'lambda' | 'nu'
   */
  function dateText(t, { form = 'short', letters = false, upTo = 'iota' } = {}) {
    const d = date(t);
    if (!d) return '—';
    const k = Math.max(3, STAMP_LEVELS.indexOf(upTo));
    const majorLevels = form === 'full' ? [0, 1, 2, 3] : [3];
    const keys = ['alpha', 'beta', 'gamma', 'delta'];
    const major = majorLevels.map((L) =>
      letters ? `${LEVEL_LETTERS[L]}#${d[keys[L]]}` : `${periodName(L, d[keys[L]])} ${d.quarter[keys[L]]}`,
    );
    const minor = [];
    if (k >= 4) minor.push(`ε#${d.epsilon}`);
    if (k >= 5) minor.push(clockText(t, STAMP_LEVELS[k]));
    if (letters) return [...major, ...minor].join(' ');
    const head = major.join(', ');
    if (!minor.length) return head;
    return `${head}${form === 'full' ? ', ' : ' '}${minor.join(' ')}`;
  }
  /**
   * An instant as its full letter address down to a resolution (default 'iota'): "α#5 β#4 γ#2 δ#3 ε#2 5η 5ι". This is
   * the unambiguous identity of a moment (tooltips, copy, the jump box reads it back).
   */
  const stamp = (t, upTo = 'iota') => dateText(t, { form: 'full', letters: true, upTo: STAMP_LEVELS.includes(upTo) ? upTo : 'iota' });

  /** The n-th eclipse of the catalogue, 0-based like the position (eclipse #22 sits at pos 22): "#22". */
  const eclipseName = (k) => `#${k}`;
  /**
   * Exact nominal length of one full cycle of `level`: "1δ", "1ε", "11η" (a ζ), "4ι" (a θ), "13λ", "5ν", "0.14ν" (a ξ).
   * Never measured between two floats.
   */
  const cycleLength = (level, { parts = 2 } = {}) => durationPos(4 / P(level), { parts });

  // ---- solar drift ---------------------------------------------------------
  const NNBSP = ' ';
  /** 6231 -> "6 231" (narrow no-break space), -48420 -> "−48 420": digit groups never look like a year. */
  function groupDigits(n) {
    const v = Math.trunc(n);
    const body = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
    return (v < 0 ? '−' : '') + body;
  }
  /**
   * Solar drift counted in λ (Flavons), the same everywhere: the accumulated shift of a sync start against the 4-day
   * grid, measured in position (exact across eclipse intervals). `sol` is a model.solarAt() / solarSyncByNumber() reading.
   */
  function driftLambda({ start, nominalStart, drift }) {
    const lam = unitPos(unitOf('lambda'));
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
    if (sib === null) return Number(cycleIdx) + 1;
    return Number(BigInt(cycleIdx) % BigInt(sib)) + 1;
  }
  /** Decimal Blinks for a start inside a ν: "11ν" or "11.29ν". */
  const nuWithFrac = (c) => (c.nuFrac ? `${Number((c.nu + c.nuFrac).toFixed(2))}ν` : `${c.nu}ν`);
  /**
   * The counts that place the start of a minor cycle, down to the first unit at or finer than its level:
   * ζ "22η", η "5η", θ "5η 8ι", ι "5η 9ι", κ "5η 9ι 26λ", λ "5η 9ι 27λ", μ "… 27λ 10ν", ν "… 11ν", ξ "… 11.29ν".
   */
  function minorStartParts(level, c) {
    const parts = [];
    if (level >= 5) parts.push(`${c.eta}η`);
    if (level >= 7) parts.push(`${c.iota}ι`);
    if (level >= 9) parts.push(`${c.lambda}λ`);
    if (level >= 11) parts.push(nuWithFrac(c));
    return parts;
  }
  /**
   * The name of cycle `cycleIdx` (global index) of `level`:
   *   major   "Delta Trifracton"
   *   ε       "ε#2"
   *   finer   where it starts inside its Nuclide: "ε#2 5η 9ι" (`short: true` drops the Nuclide: "5η 9ι")
   */
  function cycleName(level, cycleIdx, { short = false } = {}) {
    if (isMajor(level)) return periodName(level, ordinalOf(level, cycleIdx));
    const c = countsAtStart(level, cycleIdx);
    if (level === 4) return `ε#${c.epsilon}`;
    const parts = minorStartParts(level, c);
    return short ? parts.join(' ') : [`ε#${c.epsilon}`, ...parts].join(' ');
  }
  /** Compact form: "δ#3", "ε#2", or the finest placing count of a minor cycle ("22η", "8ι", "11ν"). */
  function cycleShort(level, cycleIdx) {
    if (level <= 4) return shortName(level, ordinalOf(level, cycleIdx));
    return minorStartParts(level, countsAtStart(level, cycleIdx)).at(-1);
  }
  /** The name of the cycle running at t (or null). */
  function nameAt(t, level, opts) {
    const l = model.levelAt(t, level);
    return l ? cycleName(level, l.cycleBig ?? l.cycle, opts) : null;
  }
  /** The stamp resolution that shows a level's cycle: δ 'delta', ε 'epsilon', ζ η 'eta', θ ι 'iota', κ λ 'lambda', finer 'nu'. */
  const resolutionOf = (level) =>
    level <= 4 ? STAMP_LEVELS[Math.max(0, level)] : level <= 6 ? 'eta' : level <= 8 ? 'iota' : level <= 10 ? 'lambda' : 'nu';
  /** The letter address of the moment t down to the resolution of `level`: "α#6 β#4 γ#9 δ#3 ε#2 5η 9ι". */
  const addressAt = (t, level) => stamp(t, resolutionOf(level));
  /** The catalogue's extent in pure terms: "α#1 – α#18". */
  const catalogueText = () => `${shortName(0, 1)} – ${shortName(0, Number(model.clock.count(0)))}`;

  // ---- speeds and real time ------------------------------------------------
  /**
   * Time-lapse presets: how much of the ladder passes per Blink of real time. Real time is one Blink per Blink; the
   * others are whole counts of a unit (5ν = 5x, λ = 25x, 13λ = 325x, ι = 1 625x, 4ι = 6 500x, η = 58 500x …), because
   * the hierarchy is a product of whole factors.
   */
  const RATE_STEPS = [
    ['nu5', 'nu', 5], ['lambda', 'lambda', 1], ['lambda13', 'lambda', 13], ['iota', 'iota', 1], ['iota4', 'iota', 4],
    ['eta', 'eta', 1], ['eta11', 'eta', 11], ['epsilon', 'epsilon', 1], ['delta', 'delta', 1], ['gamma', 'gamma', 1],
  ];
  const RATES = Object.freeze([
    { id: 'real', rate: 1, label: 'real time' },
    ...RATE_STEPS.map(([id, unit, n]) => {
      const u = unitOf(unit);
      return {
        id,
        rate: Number(((n * unitSeconds(u)) / blinkSeconds()).toPrecision(12)),
        label: `${n === 1 ? '' : n}${u.sym} per ${BLINK}`,
      };
    }),
  ]);
  /** The default Play speed of pure mode: 4ι per Blink (6 500x). */
  const PLAY_RATE = RATES.find((r) => r.id === 'iota4').rate;
  /**
   * "η per Blink" / "4ι per Blink" for a preset; any other rate is counted in the largest unit that passes at least
   * once per Blink: "2.22ι per Blink". Slower than real time it reads "0.5ν per Blink". Negative rates read "… backward".
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
      base = `${text === '1' ? '' : text}${u.sym} per ${BLINK}`;
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
  /** "34.2 pB", "2 772 pB", "0.2 pB"; slower than one cycle per 25 Blinks it reads "1 per 65 Blinks". */
  function pbText(pb) {
    if (!(pb > 0) || !Number.isFinite(pb)) return '—';
    if (pb < 0.04 - 1e-9) return `1 per ${groupDigits(Math.round(1 / pb))} ${BLINK}s`;
    const v = pb >= 999.5 ? groupDigits(Math.round(pb)) : pb >= 99.95 ? String(Number(pb.toFixed(1))) : String(Number(pb.toPrecision(3)));
    return `${v} ${PER_BLINK}`;
  }

  return Object.freeze({
    LEVEL_NAMES, ORDINAL_NAMES, QUARTER_WORDS, MAJOR_LEVELS, UNIT_LEVELS, UNITS, RATES, PLAY_RATE, BLINK, PER_BLINK,
    isMajor, isUnitLevel, levelKind, unitOf, unitName, ordinalName, periodName, shortName,
    unitPos, cyclePos, unitSeconds, blinkSeconds, secondsPerPosition, EPS_POS,
    decompose, durationPos, duration, countdown, between,
    pair, pairText, pairLabel, pairHTML, drawPair, pairWidth,
    countsAtStart, clock, clockText, quarterAt, date, majorText, dateText, stamp, eclipseName, cycleLength,
    groupDigits, driftLambda, driftText,
    ordinalOf, cycleName, cycleShort, nameAt, resolutionOf, addressAt, catalogueText,
    rateLabel, blinks, blinksToSeconds, secondsToBlinks, perBlink, pbText,
  });
}
