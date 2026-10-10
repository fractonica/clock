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
 *   X#n   the n-th cycle / half-cycle named X inside its parent, 1-based: ζ#5, δ½#6, α#6 (an ordinal, an identity)
 *   nX    a count of units X: durations "6ι 43λ", clock counters "0η 29ι 21λ" (elapsed since the parent began,
 *         0-based), ruler ticks "9η", speeds "9ι per beat"
 *   X d   a depth chip: the letter and its depth number, only on level chips ("η 7")
 *
 * Everything here is presentation only: the clock itself still runs on Unix seconds (model.js).
 * All functions are pure with respect to (model, t); `createPure(model, {now})` binds the model.
 *
 * UNIT LADDER (positions in Saros units; a cycle of depth d spans 4 / P(d-1), a half 2 / P(d-1)):
 *   α β γ  δ½ ε½ ζ½  η ι λ  μ ν ξ
 *   δ½ = half of a depth-4 cycle  ("month"-like, = 5 ε½)      ε½ = half of depth 5 ("week"-like, = 7 ζ½)
 *   ζ½ = half of a depth-6 cycle  ("day"-like,   = 5.5 η)      η = depth 7 ("hour"-like, = 36 ι)
 *   ι  = depth 9 ("minute"-like, = 65 λ)                        λ = depth 11 ("second"-like)
 * γ (depth 3) = 10 δ½.  θ and κ (depths 8, 10) are skipped on purpose.
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

/** The ladder durations are counted in, longest first. `half` units are half a cycle. */
export const UNITS = Object.freeze([
  { id: 'alpha', sym: 'α', level: 0, half: false },
  { id: 'beta', sym: 'β', level: 1, half: false },
  { id: 'gamma', sym: 'γ', level: 2, half: false },
  { id: 'delta-half', sym: 'δ½', level: 3, half: true },
  { id: 'epsilon-half', sym: 'ε½', level: 4, half: true },
  { id: 'zeta-half', sym: 'ζ½', level: 5, half: true },
  { id: 'eta', sym: 'η', level: 6, half: false },
  { id: 'iota', sym: 'ι', level: 8, half: false },
  { id: 'lambda', sym: 'λ', level: 10, half: false },
  { id: 'mu', sym: 'μ', level: 11, half: false },
  { id: 'nu', sym: 'ν', level: 12, half: false },
  { id: 'xi', sym: 'ξ', level: 13, half: false },
]);

/** One "beat" is one tick of the device's real time: speeds are "units per beat". */
export const BEAT = 'beat';

export function createPure(model, { now = () => model.tMin } = {}) {
  const P = (level) => model.levelInfo(level).prefixNum;
  /** Length of a unit in Saros position units. */
  const unitPos = (u) => (u.half ? 2 : 4) / P(u.level);
  /** Length of a whole cycle of `level` in Saros position units (4 / P). */
  const cyclePos = (level) => 4 / P(level);
  const LENGTHS = UNITS.map(unitPos);
  /** Mean seconds of a unit (only used for rate presets). */
  const unitSeconds = (u) => model.levelInfo(u.level).meanSeconds / (u.half ? 2 : 1);

  /** Seconds per Saros position unit around time `at` (the catalogue interval it falls in). */
  function secondsPerPosition(at = now()) {
    const loc = model.locate(Math.min(model.tMax - 1e-3, Math.max(model.tMin, at)));
    const k = loc ? loc.k : 0;
    return model.catalogue[k + 1] - model.catalogue[k];
  }

  // ---- durations --------------------------------------------------------
  /**
   * Break a position span (Saros units, >= 0) into counts of consecutive ladder units, starting from the
   * largest unit that fits. `parts` = how many consecutive units to return.
   * @returns {{unit: object, count: number}[]}
   */
  // Float positions carry ~1e-14 Saros of error (position ~ 70, double precision), which is more than a whole ξ
  // (7.8e-11) times 1e-4: counting units with only a relative fudge reads exact cycle lengths one small unit short.
  // 1e-12 Saros is 0.6 ms: negligible for every unit down to ξ (44 ms).
  const EPS_POS = 1e-12;
  function decompose(dpos, parts = 2) {
    let rem = Math.abs(dpos) + EPS_POS;
    let first = LENGTHS.findIndex((len) => len <= rem);
    if (first < 0) first = UNITS.length - 1;
    const out = [];
    for (let i = first; i < UNITS.length && out.length < parts; i++) {
      const count = Math.floor(rem / LENGTHS[i]);
      out.push({ unit: UNITS[i], count });
      rem -= count * LENGTHS[i];
      if (rem < 0) rem = 0;
    }
    return out;
  }
  /**
   * "2ζ½ 4η". Trailing zero parts are dropped ("1η", not "1η 0ι") unless `keepZeros`: a zero never adds information
   * and makes exact lengths read oddly.
   */
  const join = (cs, keepZeros = false) => {
    const kept = [...cs];
    while (!keepZeros && kept.length > 1 && kept.at(-1).count === 0) kept.pop();
    return kept.map(({ unit, count }) => `${count}${unit.sym}`).join(' ');
  };

  /** "2ζ½ 4η" for a span of `dpos` Saros units (see `join` for trailing zeros). */
  function durationPos(dpos, { parts = 2, keepZeros = false } = {}) {
    const text = join(decompose(dpos, parts), keepZeros);
    return dpos < 0 && /[1-9]/.test(text) ? '−' + text : text;
  }
  /** Same for a number of device seconds around time `at` (default: the displayed time). */
  function duration(seconds, { parts = 2, at, keepZeros = false } = {}) {
    return durationPos(seconds / secondsPerPosition(at), { parts, keepZeros });
  }
  /** "in 2ζ½ 4η" / "2ζ½ 4η ago". */
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
   * The pure "clock": odometer counters inside the current depth-6 cycle (the two-"day" cycle):
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
   * The pure "date": α (1..18) β (1..5 in α) γ (1..13 in β) then half-cycles: month-like δ½ (1..10 in γ),
   * week-like ε½ (1..5 in δ½), day-like ζ½ (1..7 in ε½) – all 1-based. ζ½ boundaries are the start and the
   * middle of every depth-6 cycle.
   * @returns {null | {alpha:number, beta:number, gamma:number, delta:number, epsilon:number, zeta:number}}
   */
  function date(t) {
    const l = [0, 1, 2, 3, 4, 5].map((L) => model.levelAt(t, L));
    if (l.some((x) => !x)) return null;
    const half = (x) => 2 * x.cycle + (x.phase >= 0.5 ? 1 : 0);
    return {
      alpha: l[0].cycle + 1,
      beta: l[1].local + 1,
      gamma: l[2].local + 1,
      delta: (half(l[3]) % 10) + 1,
      epsilon: (half(l[4]) % 5) + 1,
      zeta: (half(l[5]) % 7) + 1,
    };
  }
  /** "α#6 β#4 γ#9 · δ½#3 · ε½#2 · ζ½#5": every part is an ordinal (see NOTATION). */
  function dateText(t) {
    const d = date(t);
    if (!d) return '—';
    return `α#${d.alpha} β#${d.beta} γ#${d.gamma} · δ½#${d.delta} · ε½#${d.epsilon} · ζ½#${d.zeta}`;
  }
  /** Compact date for tight spaces: "6·4·9 · 3·2·5" (α β γ · δ½ ε½ ζ½). */
  function dateCompact(t) {
    const d = date(t);
    return d ? `${d.alpha}·${d.beta}·${d.gamma} · ${d.delta}·${d.epsilon}·${d.zeta}` : '—';
  }
  const STAMP_LEVELS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'iota', 'lambda'];
  /**
   * An instant written as a pure address down to a resolution: upTo = 'beta'|'gamma'|'delta'|'epsilon'|'zeta'
   * (ordinals) or 'eta'|'iota'|'lambda' (adds the elapsed counters). Default 'iota'.
   * "α#6 β#4 γ#9 · δ½#3 · ε½#2 · ζ½#5 · 3η 17ι"
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
    if (k >= 3) parts.push(`δ½#${d.delta}`);
    if (k >= 4) parts.push(`ε½#${d.epsilon}`);
    if (k >= 5) parts.push(`ζ½#${d.zeta}`);
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

  // ---- speeds -------------------------------------------------------------
  /** Time-lapse presets: how many Fractonica units pass per beat (rate = unit mean seconds). */
  const RATE_UNITS = ['xi', 'nu', 'mu', 'lambda', 'iota', 'eta', 'zeta-half', 'epsilon-half', 'delta-half', 'gamma'];
  const RATES = Object.freeze([
    { id: 'real', rate: 1, label: 'real time' },
    ...RATE_UNITS.map((id) => {
      const u = UNITS.find((x) => x.id === id);
      return { id, rate: unitSeconds(u), label: `${u.sym} per ${BEAT}` };
    }),
  ]);
  /**
   * "η per beat" for a preset, "9ι per beat" for any other rate (the largest unit that passes at least once per
   * beat, counted: the tempo lock of one η in 4 beats reads "9ι per beat"). Negative rates read "backward".
   */
  function rateLabel(rate) {
    const r = Math.abs(rate);
    const hit = RATES.find((p) => Math.abs(p.rate - r) / p.rate < 0.005);
    let base;
    if (hit) base = hit.label;
    else {
      const ladder = [...UNITS].sort((a, b) => unitSeconds(b) - unitSeconds(a));
      const u = ladder.find((x) => unitSeconds(x) <= r * 1.0000001) ?? ladder.at(-1);
      const k = r / unitSeconds(u);
      const near = Math.round(k);
      const text = Math.abs(k - near) / near < 0.005 && near >= 1 ? String(near) : String(Number(k.toPrecision(3)));
      base = `${text}${u.sym} per ${BEAT}`;
    }
    return rate < 0 ? `${base} backward` : base;
  }
  /** "3.5 beats" – a span of device seconds counted in beats (tempo lock, scrub lengths). */
  const beats = (seconds) => `${Number(seconds.toPrecision(3))} ${BEAT}${Math.abs(seconds - 1) < 1e-9 ? '' : 's'}`;

  return Object.freeze({
    LEVEL_NAMES, ORDINAL_NAMES, UNITS, RATES, BEAT,
    ordinalName, periodName, shortName,
    unitPos, cyclePos, unitSeconds, secondsPerPosition, EPS_POS,
    decompose, durationPos, duration, countdown, between,
    pair, pairText, pairLabel, pairHTML, drawPair, pairWidth,
    clock, clockText, date, dateText, dateCompact, stamp, eclipseName, cycleLength,
    groupDigits, driftLambda, driftText,
    ordinalOf, cycleName, cycleShort, nameAt, addressAt, catalogueText,
    rateLabel, beats,
  });
}
