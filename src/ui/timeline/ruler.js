/**
 * Pure ruler: the Fractonica replacement of the Gregorian axis (docs/design/80-pure.md, revision 2, and
 * docs/design/40-timeline.md).
 *
 * Everything here is presentation of the clock's own units. The ladder is `pure.UNITS`: one unit per depth, whole
 * cycles only, α β γ δ ε ζ η θ ι κ λ μ ν (index 0..12 = depth 1..13; the Blink ν is the finest). A tick is the start of
 * a unit and is written in the notation of `pure.stamp` (src/core/pure.js, "NOTATION"):
 *   - α β γ δ ε ζ are ORDINALS, 1-based:                    α#6  β#4  γ#9  δ#3  ε#2  ζ#5
 *   - η θ ι κ λ μ ν are COUNTS of whole units gone by, 0-based:   9η  5θ  17ι  3κ  42λ  2μ  12ν
 * so a tick can never be mistaken for a lane block ("η#10" is the 10th η, "9η" the nine that have passed).
 *
 * WHAT A COUNT IS COUNTED INSIDE. The header clock counts η inside ζ (0..10), ι inside η (0..35) and λ inside ι
 * (0..64): the "atomic cadence" ν -25-> λ -65-> ι -36-> η. The ruler uses the same counters, so a flag reads exactly
 * like the header. The units that sit between those steps (θ κ μ) are counted inside the same parent as the unit
 * that follows them: θ inside η (0..8, four ι each), κ inside ι (0..4, thirteen λ each), μ inside λ (0..4, five ν
 * each); ν is counted inside λ (0..24). A count therefore runs on across the in-between units: the four ι of "5θ" are
 * 20ι 21ι 22ι 23ι.
 *
 * No DOM, no canvas, no formatter: `createRuler({ model, pure })` only reads the model's catalogue and the helper
 * vocabulary, so every function is unit tested (test/timeline.test.js).
 *
 * Which unit an instant is in is read twice, each way where it is right:
 *   - by TIME (`tokensAtTime`, `stampText`, `flagText`, `rangeText`): exact rational arithmetic on the millisecond the
 *     header reads (the same floor as `model.levelAt`), so a flag, a tooltip and the header never disagree, not even
 *     within a millisecond of a boundary;
 *   - by POSITION (`tokensAtPos`): float arithmetic for positions that are far from a boundary (the middle of a span)
 *     or exactly on the grid (an eclipse), with an absolute tolerance of 1e-13 Saros (60 microseconds), never a
 *     tolerance that grows with the unit.
 *
 * The finest step is the Blink itself: nothing on the ladder is finer, so its unlabelled minor ticks cut every Blink
 * into tenths (`nu/10`), and spans below one Blink are read as decimals by the pure helper ("0.4ν").
 */

/** Float noise of a position near 70 is ~1.4e-14 Saros; this absolute tolerance (60 µs) is above it for every unit. */
const EPS_POS = 1e-13;
/** Units from this index on (η θ ι κ λ μ ν) are counts ("9η", from 0); the earlier ones are ordinals ("ζ#5", from 1). */
const FIRST_COUNT_UNIT = 6;
/** The units that sit between the atomic steps η ι λ ν; their counts run inside the same parent as the next step's. */
const IN_BETWEEN = ['theta', 'kappa', 'mu'];
/** The unit whose cycle a count restarts in (α: the catalogue). See "WHAT A COUNT IS COUNTED INSIDE". */
const COUNTED_IN = {
  beta: 'alpha',
  gamma: 'beta',
  delta: 'gamma',
  epsilon: 'delta',
  zeta: 'epsilon',
  eta: 'zeta',
  theta: 'eta',
  iota: 'eta',
  kappa: 'iota',
  lambda: 'iota',
  mu: 'lambda',
  nu: 'lambda',
};

/**
 * Multiples of a unit a ruler step may use, by unit id. A multiple m labels every m-th unit of each parent cycle,
 * counted from the parent's start for as long as a full step still fits before the parent ends: m does not have to
 * divide the count (13 γ make a β, 11 η a ζ cycle), only 2·m <= count (see `multiplesOf`). Together with the whole
 * units they make a ladder whose neighbours are at most 2.6 apart (the κ step after λ×5), which is what keeps 4 to
 * 12 labelled ticks on the plot at every zoom.
 */
const MULTIPLES = {
  nu: [1, 2],
  mu: [1, 2],
  lambda: [1, 2, 5],
  kappa: [1, 2],
  iota: [1, 2],
  theta: [1, 2, 3, 4],
  eta: [1, 2, 3, 5],
  zeta: [1, 2, 3],
  epsilon: [1, 2],
  delta: [1, 2],
  gamma: [1, 2, 3, 6],
  beta: [1, 2],
  alpha: [1, 2], // (1.06 catalogues is the widest window: 3 and more would never be reached)
};
/** The finer step drawn as unlabelled small ticks between the labelled ones of a whole unit (m = 1). */
const MINOR_OF_UNIT = {
  nu: 'nu/10', // a tenth of a Blink: the ladder has nothing finer
  mu: 'nu',
  lambda: 'mu',
  kappa: 'lambda',
  iota: 'kappa',
  theta: 'iota',
  eta: 'theta',
  zeta: 'eta',
  epsilon: 'zeta',
  delta: 'epsilon',
  gamma: 'delta',
  beta: 'gamma',
  alpha: 'beta',
};
/** Tenths of a Blink between the labelled ticks of the finest steps. */
const BLINK_PARTS = 10;

/**
 * Zoom presets of the toolbar, finest first: the unit that fills the view (the last one fills the whole catalogue).
 * ν is the deepest zoom: the narrowest window (a few Blinks across) is the finest the clock can be read at.
 */
const PRESET_UNITS = ['nu', 'lambda', 'iota', 'eta', 'zeta', 'epsilon', 'delta', 'gamma', 'beta', 'alpha'];

/** The most labelled ticks a plot shows at once, and the plot width below which ordinals may use their short form. */
const MAX_LABELS = 12;
const NARROW_PLOT = 520;

const digits = (n) => String(Math.max(0, Math.trunc(n))).length;
const roundMs = (t) => Math.round(t * 1000) / 1000;

export function createRuler({ model, pure }) {
  const U = pure.UNITS;
  const N = U.length;
  const E = model.catalogue;
  const ext = model.extent;
  const len = U.map((u) => pure.unitPos(u)); // length of a unit in Saros positions
  const sec = U.map((u) => pure.unitSeconds(u)); // mean length of a unit in device seconds
  const prefix = U.map((u) => model.levelInfo(u.level).prefixNum);
  const prefixBig = U.map((u) => model.levelInfo(u.level).prefix);
  const alphaCount = Number(model.clock.count(0));
  const idOf = (i) => U[i].id;
  const unitIndex = (id) => U.findIndex((u) => u.id === id);
  /** Index of the unit a count restarts in (null for α). */
  const countedIn = U.map((u) => (COUNTED_IN[u.id] ? unitIndex(COUNTED_IN[u.id]) : null));
  /** How many of this unit make one of the unit it is counted in (the catalogue's α count for α itself). */
  const per = U.map((u, i) => (countedIn[i] === null ? null : Math.round(len[countedIn[i]] / len[i])));
  const perOf = (i) => (i === 0 ? alphaCount : per[i]);
  /** The units of the main chain (every unit except θ κ μ): what an address is written in, like `pure.stamp`. */
  const inBetween = (i) => IN_BETWEEN.includes(idOf(i));
  const MAIN = U.map((u, i) => i).filter((i) => !inBetween(i));

  // ---- counters and addresses ---------------------------------------------------------------------
  /** The counter shown for the unit with global index `idx`: an ordinal from 1 (α β γ δ ε ζ), a count from 0. */
  function counterOf(i, idx) {
    const n = perOf(i);
    return ((idx % n) + n) % n + (i < FIRST_COUNT_UNIT ? 1 : 0);
  }
  /** "α#6", "ζ#5" (ordinals) or "9η", "42λ" (counts). */
  const tokenText = (i, c) => (i < FIRST_COUNT_UNIT ? `${U[i].sym}#${c}` : `${c}${U[i].sym}`);
  /** The shortest form of a tick label: the ordinal without its unit ("#5"); a count is as short as it gets. */
  const shortText = (i, c) => (i < FIRST_COUNT_UNIT ? `#${c}` : null);

  /** Index (0-based, from the start of the catalogue) of the unit running at position p; absolute tolerance. */
  const indexAtPos = (i, p) => Math.floor(((p + EPS_POS) * prefix[i]) / 4);

  /** Exact position of the millisecond the model reads for time t (null outside the catalogue). One entry memo. */
  let memoKey = NaN;
  let memoPos = null;
  function positionRational(t) {
    let s = roundMs(t);
    if (!(s >= model.tMin && s <= model.tMax)) return null;
    if (s > model.tMax - 0.001) s = model.tMax - 0.001; // the closing instant belongs to the last cycle (SPEC §2.2)
    if (s !== memoKey) {
      memoPos = model.clock.positionAt(model.F.rational(String(s)));
      memoKey = s;
    }
    return memoPos;
  }
  /** Index of the unit running at time t: exact, the same floor as `model.levelAt` / `pure.date` / `pure.clock`. */
  function indexAtTime(i, t) {
    const p = positionRational(t);
    return p === null ? null : Number((p.numerator * prefixBig[i]) / (p.denominator * 4n));
  }

  const tokenOf = (i, idx) => {
    const c = counterOf(i, idx);
    return { u: i, c, text: tokenText(i, c) };
  };
  // ---- which units an address is written in ---------------------------------------------------------
  /**
   * The units of the address down to unit `to`: every unit of the main chain above it, then `to` itself. For a main
   * chain unit that is exactly what `pure.stamp` writes ("… · 3η 17ι"); an in-between unit is inserted at its place
   * ("… · 3η 5θ"). `include` names more units to write (the tick unit of a tooltip), each at its place.
   */
  function unitsTo(to, include = []) {
    const out = MAIN.filter((i) => i <= to);
    for (const i of [to, ...include]) if (i <= to && !out.includes(i)) out.push(i);
    return out.sort((a, b) => a - b);
  }
  /**
   * The units of the compact three-unit address of the cursor / now / hover flags for ticks of unit `u`: the tick
   * unit with the main-chain unit above it and the one below it ("3η 17ι 21λ" while the ticks are ι, "7η 5θ 22ι"
   * while they are θ), so the header's own counters appear wherever the ticks have them.
   */
  function flagUnits(u) {
    const p = MAIN.indexOf(u);
    if (p >= 0) {
      const a = Math.max(0, Math.min(p - 1, MAIN.length - 3));
      return MAIN.slice(a, a + 3);
    }
    const above = MAIN.filter((i) => i < u).pop();
    const below = MAIN.find((i) => i > u);
    return [above, u, below].filter((x) => x !== undefined);
  }
  /** The k-th main-chain unit below `u` (the finest, ν, when there are not that many): how far a tooltip runs on. */
  function below(u, k = 1) {
    const deeper = MAIN.filter((i) => i > u);
    return deeper.length ? deeper[Math.min(k, deeper.length) - 1] : u;
  }

  /** Tokens {u, c, text} of the given units at time t; [] outside the catalogue. */
  function tokens(t, units) {
    if (positionRational(t) === null) return [];
    return units.map((i) => tokenOf(i, indexAtTime(i, t)));
  }
  /** Same at a float position (use it far from a boundary, or exactly on the grid). */
  const tokensAtPos = (p, units) => units.map((i) => tokenOf(i, indexAtPos(i, p)));
  /** Tokens of the address down to unit `to` (and not above `from`) at time t; [] outside the catalogue. */
  const tokensAtTime = (t, from = 0, to = N - 1) => tokens(t, unitsTo(to).filter((i) => i >= from));

  /**
   * The separator between two neighbouring tokens, as `pure.stamp` writes them: α β γ and the odometer counters
   * η θ ι κ λ … sit side by side, the cycle ordinals and the two groups are set apart by a middle dot.
   */
  const gap = (a, b) => ((a < FIRST_COUNT_UNIT && b < 3) || (a >= FIRST_COUNT_UNIT && b >= FIRST_COUNT_UNIT) ? ' ' : ' · ');
  /** "α#6 β#4 γ#9 · δ#3 · ε#2 · 3η 17ι" */
  const joinTokens = (toks) => toks.map((t, j) => (j === 0 ? '' : gap(toks[j - 1].u, t.u)) + t.text).join('');
  /** The address chain at time t down to unit `to` (not above `from`); '' outside the catalogue. */
  const chainAtTime = (t, from = 0, to = N - 1) => joinTokens(tokensAtTime(t, from, to));
  /** Position of an instant, or null outside the catalogue. */
  const posOf = (t) => model.positionOf(t);
  /** Same as pure.stamp(t, ...) down to unit `to` (any unit, down to the Blink); '' outside the catalogue. */
  const stampText = (t, to = unitIndex('iota')) => chainAtTime(t, 0, to);
  /**
   * The three-unit compact address used by the cursor / now / hover flags (see `flagUnits`), e.g. "3η 17ι 21λ"
   * while the ticks are ι.
   */
  const flagText = (t, u) => joinTokens(tokens(t, flagUnits(u)));
  /** Position of any instant: outside the catalogue it continues at the mean Saros length (for lengths only). */
  function posExt(t) {
    if (t < model.tMin) return -(model.tMin - t) / model.meanSaros;
    if (t > model.tMax) return ext + (t - model.tMax) / model.meanSaros;
    return posOf(t);
  }
  /** The inverse of posExt. */
  function timeExt(p) {
    if (p < 0) return model.tMin + p * model.meanSaros;
    if (p > ext) return model.tMax + (p - ext) * model.meanSaros;
    return model.timeOfPosition(p);
  }
  /**
   * A length of time counted in ladder units around the instants t0 < t1 ("1ζ 2η"), measured in position; a span of
   * only a few Blinks keeps a decimal ("2.6ν"). `slack` is the relative width of what the eye cannot tell apart (half
   * a pixel of the plot): a window that is one unit across to within a pixel reads "1α", not "4β 12γ" and not
   * "1α 5ζ": the fewest leading parts that come within the slack of the span are written, the rest is dropped.
   */
  function spanText(t0, t1, parts = 2, slack = 0) {
    const span = posExt(t1) - posExt(t0);
    if (slack > 0 && span > 0) {
      const eps = span * slack;
      const cs = pure.decompose(span + eps, parts);
      if (cs[0].unit.id !== U[N - 1].id) {
        let acc = 0;
        for (const { unit, count } of cs) {
          acc += count * pure.unitPos(unit);
          if (span - acc <= eps) return pure.durationPos(acc, { parts });
        }
      }
    }
    return pure.durationPos(span, { parts });
  }
  /**
   * "in 3ζ 2η" / "3ζ 2η ago" for t relative to ref, measured in position (exact across eclipse intervals); below
   * one Blink a decimal ("in 0.4ν"). "now" only within the same millisecond, the clock's resolution.
   */
  function relText(t, ref) {
    if (Math.abs(t - ref) < 0.001) return 'now';
    return t > ref ? `in ${pure.between(ref, t)}` : `${pure.between(t, ref)} ago`;
  }

  /**
   * "from → to" of a window, the shared leading part of both addresses written once:
   * "α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#4 · 7η → ζ#5 · 2η". An edge outside the catalogue says so.
   */
  function rangeText(t0, t1, to = unitIndex('iota')) {
    const edge = (t) => (positionRational(t) !== null ? null : t < model.tMin ? 'before the catalogue' : 'after the catalogue');
    const ea = edge(t0);
    const eb = edge(t1);
    if (ea && eb) return ea === eb ? ea : 'the whole catalogue';
    if (ea || eb) return `${ea ?? chainAtTime(t0, 0, to)} → ${eb ?? chainAtTime(t1, 0, to)}`;
    const A = tokensAtTime(t0, 0, to);
    const B = tokensAtTime(t1, 0, to);
    let common = 0;
    while (common < A.length - 1 && A[common].text === B[common].text) common++;
    const head = common ? joinTokens(A.slice(0, common)) + gap(A[common - 1].u, A[common].u) : '';
    return `${head}${joinTokens(A.slice(common))} → ${joinTokens(B.slice(common))}`;
  }

  // ---- unit boundaries -----------------------------------------------------------------------------
  /** Time of the start of the unit with global index idx, or null beyond the catalogue. */
  const startTime = (i, idx) => model.cycleStartTime(U[i].level, idx);

  // ---- steps (the zoom ladder of the ruler) --------------------------------------------------------
  const stepId = (i, m) => (m === 1 ? idOf(i) : `${idOf(i)}×${m}`);
  /** The multiples of unit i that produce a real step: at least two labelled ticks fit in every parent (2·m <= count). */
  const multiplesOf = (i) => (MULTIPLES[idOf(i)] ?? [1]).filter((m) => m === 1 || 2 * m <= perOf(i));
  /** Largest counter a unit shows (an ordinal counts to its parent's size, a count to one less). */
  const topCounter = (i) => (i < FIRST_COUNT_UNIT ? perOf(i) : perOf(i) - 1);
  /** Width of the longest label of a unit in characters: "δ#5", "α#18", "35ι", "4μ". */
  const charsOf = (i) => U[i].sym.length + (i < FIRST_COUNT_UNIT ? 1 : 0) + digits(topCounter(i));
  /** … and of its short form (an ordinal without its unit, "#10"), which the painter falls back to. */
  const charsShortOf = (i) => (i < FIRST_COUNT_UNIT ? 1 + digits(topCounter(i)) : charsOf(i));
  /**
   * All ruler steps, finest first: {id, u, m, sym, nominal (s), chars, charsShort, ctx (unit of the context row or -1),
   * pure}.
   */
  const STEPS = [];
  for (let i = N - 1; i >= 0; i--) {
    for (const m of multiplesOf(i)) {
      STEPS.push({ id: stepId(i, m), u: i, m, sym: U[i].sym, nominal: sec[i] * m, chars: charsOf(i), charsShort: charsShortOf(i), ctx: i - 1, pure: true });
    }
  }
  const STEP_BY_ID = new Map(STEPS.map((s) => [s.id, s]));
  /**
   * The unlabelled tenths of a Blink: the minor ticks of the finest steps (never picked as a labelled step, so it is
   * not in STEPS). `div` marks a step that cuts every unit into that many equal parts.
   */
  const NU = unitIndex('nu');
  STEP_BY_ID.set('nu/10', { id: 'nu/10', u: NU, m: 1, div: BLINK_PARTS, sym: U[NU].sym, nominal: sec[NU] / BLINK_PARTS, chars: 0, charsShort: 0, ctx: NU - 1, pure: true });
  const stepById = (id) => STEP_BY_ID.get(id) ?? null;
  /**
   * The unlabelled finer step between the labelled ticks: for a whole unit the finer unit that cuts it into 5 to 13
   * pieces (MINOR_OF_UNIT); for a multiple the smaller multiple of the same unit that divides it into about four.
   */
  function minorOf(step) {
    if (step.div) return null;
    if (step.m === 1) return STEP_BY_ID.get(MINOR_OF_UNIT[idOf(step.u)] ?? '') ?? null;
    let best = 1;
    for (const x of multiplesOf(step.u)) {
      if (x >= step.m || step.m % x !== 0) continue;
      if (Math.abs(Math.log(step.m / x / 4)) <= Math.abs(Math.log(step.m / best / 4))) best = x;
    }
    return STEP_BY_ID.get(stepId(step.u, best)) ?? null;
  }
  const MINOR_BY_ID = new Map([...STEP_BY_ID.values()].map((s) => [s.id, minorOf(s)]));
  const minorStepOf = (step) => MINOR_BY_ID.get(step.id) ?? null;
  /**
   * Finest step whose labels still have room. Its ticks are `nominal` px apart at least (a multiple never leaves a
   * stub, see `ticksIn`); a label needs its own width plus a gap (the short "#10" form of an ordinal on a phone-width
   * plot, where the key in the gutter and the context row carry the unit) and a plot never shows more than
   * MAX_LABELS of them. The ladder's ratio is at most 2.6, so a plot of 520 px or more shows between 4 and 12 labels
   * at every zoom.
   */
  function pickStep(pxPerSec, plotW = 1000, charW = 6.6) {
    const roomy = plotW / MAX_LABELS;
    const narrow = plotW < NARROW_PLOT;
    for (const s of STEPS) {
      const need = Math.max((narrow ? s.charsShort : s.chars) * charW + (narrow ? 10 : 18), roomy);
      if (s.nominal * pxPerSec >= need) return s;
    }
    return STEPS[STEPS.length - 1];
  }

  /**
   * Ticks of a step in [from, to]: {t, idx, counter, labels (long → short), major}. Every parent cycle (a ζ cycle for
   * η, a δ for ε, the catalogue for α …) is counted from its own start: ticks at 0, m, 2m … for as long as a full
   * step of m still fits before the parent ends, so no label is ever squeezed against the next parent's first one.
   * `major` marks the starts of the parent. Nothing is generated outside the catalogue.
   */
  function ticksIn(step, from, to, limit = 6000) {
    const i = step.u;
    const a = Math.max(from, model.tMin);
    const b = Math.min(to, model.tMax);
    if (!(b >= a)) return [];
    if (step.div) return partTicksIn(step, a, b, from, to, limit);
    const m = step.m;
    const n = perOf(i);
    const lo = Math.max(0, Math.floor(posOf(a) / len[i]) - 1); // a unit of margin each side: the time filter decides
    const hi = Math.ceil(posOf(b) / len[i]) + 1;
    const out = [];
    for (let j = Math.floor(lo / n); j * n <= hi; j++) {
      for (let o = 0; o + m <= n; o += m) {
        const k = j * n + o;
        if (k < lo) continue;
        if (k > hi || out.length >= limit) return out;
        const t = startTime(i, k);
        if (t === null || t >= model.tMax) return out;
        if (t < from - 1e-6 || t > to + 1e-6) continue;
        const c = counterOf(i, k);
        const short = shortText(i, c);
        out.push({ t, idx: k, counter: c, labels: short ? [tokenText(i, c), short] : [tokenText(i, c)], major: i === 0 || o === 0 });
      }
    }
    return out;
  }
  /** The tenths of a unit (`step.div`): {t, idx (the n-th part overall), counter (0..div-1), labels: []}, never major. */
  function partTicksIn(step, a, b, from, to, limit) {
    const i = step.u;
    const d = step.div;
    const lo = Math.max(0, Math.floor((posOf(a) / len[i]) * d) - 1);
    const hi = Math.ceil((posOf(b) / len[i]) * d) + 1;
    const out = [];
    for (let k = lo; k <= hi && out.length < limit; k++) {
      const t = startTime(i, k / d);
      if (t === null || t >= model.tMax) break;
      if (t < from - 1e-6 || t > to + 1e-6) continue;
      out.push({ t, idx: k, counter: k % d, labels: [], major: false });
    }
    return out;
  }

  /**
   * Spans of unit c overlapping [from, to] (the context row): {t0, t1, ord, labels (long → short)}. The labels are the
   * address of the span with its leading parts dropped one by one ("α#6 β#4 γ#9 · δ#3 · ε#2" … "ε#2" … "#2").
   */
  function spansIn(c, from, to, limit = 4000) {
    if (c < 0) return [];
    const a = Math.max(from, model.tMin);
    const b = Math.min(to, model.tMax);
    if (!(b >= a)) return [];
    const k0 = Math.max(0, Math.floor(posOf(a) / len[c]));
    const k1 = Math.max(k0, Math.ceil(posOf(b) / len[c]) - 1);
    const out = [];
    for (let k = k0; k <= k1 && out.length < limit; k++) {
      const t0 = startTime(c, k);
      if (t0 === null) break;
      const t1 = startTime(c, k + 1) ?? model.tMax;
      if (!(t1 > t0)) continue;
      const toks = tokensAtPos(Math.min(ext - 10 * EPS_POS, (k + 0.5) * len[c]), unitsTo(c));
      const labels = [];
      for (let j = 0; j < toks.length; j++) labels.push(joinTokens(toks.slice(j)));
      const last = toks[toks.length - 1];
      const short = shortText(c, last.c);
      if (short) labels.push(short);
      out.push({ t0, t1, ord: k, labels });
    }
    return out;
  }

  // ---- overview: eclipse numbers --------------------------------------------------------------------
  /** Labels of the catalogue map: "#10", "#20" … at the eclipse instants (eclipse k sits at position k). */
  function overviewMarks(every = 10) {
    const out = [];
    for (let k = every; k < ext; k += every) out.push({ t: E[k], labels: [pure.eclipseName(k)] });
    return out;
  }

  // ---- presets -------------------------------------------------------------------------------------
  /** Preset buttons of the toolbar: {id, label, u (unit index or -1 for the whole catalogue), deepest}. */
  const PRESETS = [
    ...PRESET_UNITS.map((id) => {
      const u = unitIndex(id);
      return { id: `u:${id}`, label: U[u].sym, u, deepest: u === NU };
    }),
    { id: 'all', label: 'All', u: -1, deepest: false },
  ];
  const presetOf = (id) => PRESETS.find((x) => x.id === id);
  /**
   * Window width (seconds) of a preset centred on time `at`: exactly one unit across in POSITION (the edges are laid
   * out in positions and converted back, so the status line reads "1η" however the eclipse intervals differ), or the
   * whole limit. The deepest preset, ν, is the narrowest window the view allows (a few Blinks across).
   */
  function presetSpan(id, lim, at = model.tMin) {
    const p = presetOf(id);
    if (!p || p.u < 0) return lim.maxSpan;
    const c = posExt(at);
    const span = Math.min(timeExt(c + len[p.u] / 2) - timeExt(c - len[p.u] / 2), lim.maxSpan);
    return p.deepest ? Math.max(span, lim.minSpan) : span;
  }
  /**
   * The window {c, span} of a preset that keeps time `anchor` at the fraction `frac` of its width, one unit across in
   * position (see presetSpan).
   */
  function presetWindow(id, lim, anchor, frac = 0.5) {
    const p = presetOf(id);
    if (p && p.u >= 0 && !p.deepest) {
      const left = posExt(anchor) - frac * len[p.u];
      const t0 = timeExt(left);
      const t1 = timeExt(left + len[p.u]);
      if (t1 - t0 <= lim.maxSpan) return { c: (t0 + t1) / 2, span: t1 - t0 };
    }
    const span = p && p.deepest ? presetSpan(id, lim, anchor) : lim.maxSpan;
    return { c: anchor - frac * span + span / 2, span };
  }
  /** Preset whose width is within ~12 % of `span` around `at`, else null. */
  function activePreset(span, lim, at) {
    for (const p of PRESETS) if (Math.abs(Math.log(span / presetSpan(p.id, lim, at))) < 0.12) return p.id;
    return null;
  }

  return Object.freeze({
    units: U,
    len,
    sec,
    per,
    countedIn,
    alphaCount,
    unitIndex,
    isInBetween: inBetween,
    mainChain: MAIN,
    unitsTo,
    flagUnits,
    below,
    tokensOf: tokens,
    indexAtPos,
    indexAtTime,
    counterOf,
    tokenText,
    tokensAtTime,
    tokensAtPos,
    joinTokens,
    chainAtTime,
    stampText,
    flagText,
    posExt,
    timeExt,
    spanText,
    relText,
    rangeText,
    startTime,
    STEPS,
    stepById,
    minorStepOf,
    pickStep,
    ticksIn,
    spansIn,
    overviewMarks,
    PRESETS,
    presetSpan,
    presetWindow,
    activePreset,
  });
}
