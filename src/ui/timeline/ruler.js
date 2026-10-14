/**
 * Pure ruler: the Fractonica replacement of the Gregorian axis (SPEC §15, docs/design/80-pure.md revision 3, and
 * docs/design/40-timeline.md).
 *
 * Everything here is presentation of the clock's own units. The ladder is `pure.UNITS`, index 0..8:
 *   major (ultrahelion)   α β γ δ         depth 1-4, said in WORDS: "Delta Trifracton", with a quarter word
 *                                         (Peak, Node, Valley, End) where a stretch of one is meant
 *   minor (infrahelion)   ε η ι λ ν       depth 5 7 9 11 13 (every other depth), said in letters and counts
 * The depths between (ζ θ κ μ) and finer than the Blink (ξ …) are lanes, never ruler units.
 *
 * A tick is the start of a unit and is written in the notation of `pure.stamp` (SPEC §15.3):
 *   - α β γ δ ε are ORDINALS, 1-based: a major tick reads "Delta Trifracton" where there is room, else "δ#3" / "#3";
 *     a Nuclide tick reads "ε#2" / "#2"
 *   - η ι λ ν are written as counts "34η 29ι 21λ 3ν" – exactly the header clock. The Helion is NUMBERED from 1 inside
 *     its Nuclide (1η … 77η), so the ζ grid reads 1η 12η 23η … 67η; Preons (0..35 in the
 *     Helion), Flavons (0..64 in the Preon) and Blinks (0..24 in the Flavon) are completed units counted from 0
 * so a tick can never be mistaken for a lane block.
 *
 * The CONTEXT ROW above the ticks names the next coarser unit. Where that is a major period and the ticks are whole
 * units, the row is cut into its four quarters and says them in words ("Gamma Nonafracton · Delta Trifracton Node"):
 * the quarter words take the place of the major periods' phase, which is never drawn.
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
 * into tenths (`nu/10`), and spans below ten Blinks are read as decimals by the pure helper ("0.4ν", "6.4ν").
 */

/** Float noise of a position near 70 is ~1.4e-14 Saros; this absolute tolerance (60 µs) is above it for every unit. */
const EPS_POS = 1e-13;

/**
 * Multiples of a unit a ruler step may use, by unit id. A multiple m labels every m-th unit of each parent, counted
 * from the parent's start for as long as a full step still fits before the parent ends: m does not have to divide the
 * count (13 γ make a β, 77 η a Nuclide), only 2·m <= count (see `multiplesOf`). The multiples of η are those of the
 * ζ grid (11η) and of ι those of the θ grid (4ι), of λ the κ grid (13λ) and of ν the μ grid (5ν), so the labelled
 * ticks fall where the lanes in between start. Neighbouring steps are at most 2.6 apart, which keeps 4 to 12
 * labelled ticks on the plot at every zoom.
 */
const MULTIPLES = {
  nu: [1, 2, 5, 10],
  lambda: [1, 2, 5, 13, 26],
  iota: [1, 2, 4, 6, 12, 18],
  eta: [1, 2, 3, 5, 11, 22, 33],
  epsilon: [1, 2],
  delta: [1, 2],
  gamma: [1, 2, 3, 6],
  beta: [1, 2],
  alpha: [1, 2], // (1.06 catalogues is the widest window: 3 and more would never be reached)
};
/** The finer step drawn as unlabelled small ticks between the labelled ones of a whole unit (m = 1). */
const MINOR_OF_UNIT = {
  nu: 'nu/10', // a tenth of a Blink: the ladder has nothing finer
  lambda: 'nu×5', // the μ grid: 5 to a Flavon
  iota: 'lambda×13', // the κ grid: 5 to a Preon
  eta: 'iota×4', // the θ grid: 9 to a Helion
  epsilon: 'eta×11', // the ζ grid: 7 to a Nuclide
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
const PRESET_UNITS = ['nu', 'lambda', 'iota', 'eta', 'epsilon', 'delta', 'gamma', 'beta', 'alpha'];

/** The most labelled ticks a plot shows at once, and the plot width below which ordinals may use their short form. */
const MAX_LABELS = 12;
const NARROW_PLOT = 520;
/** A whole unit with at least this many ticks across the plot is preferred to a multiple of the unit below it. */
const PREFER_LABELS = 4.8;

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
  /** The ladder index of a depth (0-based level) when that depth is a unit, else -1. */
  const unitOfLevel = (level) => U.findIndex((u) => u.level === level);
  /** Majors (α β γ δ) and the Nuclide are ordinals "ε#5"; from the Helion on the ladder is written as counts "34η". */
  const FIRST_COUNT_UNIT = unitIndex('eta');
  const ETA = FIRST_COUNT_UNIT;
  /** Units numbered from 1: the ordinals, and the Helion inside its Nuclide (1η … 77η); the finer ones count from 0. */
  const fromOne = (i) => i < FIRST_COUNT_UNIT || i === ETA;
  const GAMMA = unitIndex('gamma');
  const isMajorUnit = (i) => !!U[i]?.major;
  /** How many of this unit make one of the previous unit (the catalogue's α count for α itself). */
  const per = U.map((u, i) => (i === 0 ? null : Math.round(len[i - 1] / len[i])));
  const perOf = (i) => (i === 0 ? alphaCount : per[i]);

  // ---- counters and addresses ---------------------------------------------------------------------
  /** The counter shown for the unit with global index `idx`: from 1 for α β γ δ ε and the Helion, from 0 below it. */
  function counterOf(i, idx) {
    const n = perOf(i);
    return ((idx % n) + n) % n + (fromOne(i) ? 1 : 0);
  }
  /** "α#6", "δ#3", "ε#5" (ordinals) or "34η", "21λ" (the clock's numbers and counts). */
  const tokenText = (i, c) => (i < FIRST_COUNT_UNIT ? `${U[i].sym}#${c}` : `${c}${U[i].sym}`);
  /** "Delta Trifracton": a major period's ordinal in words. */
  const wordsOf = (i, c) => pure.periodName(U[i].level, c);
  /** The labels of a tick, longest first: "Delta Trifracton" → "δ#3" → "#3"; "ε#5" → "#5"; "34η". */
  function tickLabels(i, c) {
    if (isMajorUnit(i)) return [wordsOf(i, c), tokenText(i, c), `#${c}`];
    if (i < FIRST_COUNT_UNIT) return [tokenText(i, c), `#${c}`];
    return [tokenText(i, c)];
  }

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
    return { u: i, c, idx, text: tokenText(i, c) };
  };
  /** The units of the address down to unit `to` (all of them: the ladder has no gaps). */
  const unitsTo = (to) => U.map((u, i) => i).filter((i) => i <= to);
  /**
   * The units of the compact address of the cursor / now / hover flags for ticks of unit `u`. From the Preon on it is
   * the header clock "34η 29ι 21λ" (with the Blinks "… 3ν" while the ticks are λ or ν); coarser ticks show the tick
   * unit between its neighbours: "ε#5 34η 29ι" for η, "δ#3 ε#5 34η" for ε, "γ#9 δ#3 ε#5" for δ.
   */
  function flagUnits(u) {
    const eta = unitIndex('eta');
    const iota = unitIndex('iota');
    if (u >= iota) return u > iota ? [eta, iota, iota + 1, iota + 2] : [eta, iota, iota + 1];
    const a = Math.max(0, Math.min(u - 1, N - 3));
    return [a, a + 1, a + 2];
  }
  /** The unit k steps finer than `u` (the Blink at most): how far a tooltip runs on. */
  const below = (u, k = 1) => Math.min(N - 1, u + k);

  /** Tokens {u, c, idx, text} of the given units at time t; [] outside the catalogue. */
  function tokens(t, units) {
    if (positionRational(t) === null) return [];
    return units.map((i) => tokenOf(i, indexAtTime(i, t)));
  }
  /** Same at a float position (use it far from a boundary, or exactly on the grid). */
  const tokensAtPos = (p, units) => units.map((i) => tokenOf(i, indexAtPos(i, p)));
  /** Tokens of the address down to unit `to` (not above `from`) at time t; [] outside the catalogue. */
  const tokensAtTime = (t, from = 0, to = N - 1) => tokens(t, unitsTo(to).filter((i) => i >= from));

  /** "α#6 β#4 γ#9 δ#3 ε#5 34η 29ι": the letter address, as `pure.stamp` writes it (single spaces). */
  const joinTokens = (toks) => toks.map((t) => t.text).join(' ');
  /** The address chain at time t down to unit `to` (not above `from`); '' outside the catalogue. */
  const chainAtTime = (t, from = 0, to = N - 1) => joinTokens(tokensAtTime(t, from, to));
  /** Position of an instant, or null outside the catalogue. */
  const posOf = (t) => model.positionOf(t);
  /** Same as pure.stamp(t, U[to].id) for any unit from δ down to the Blink; '' outside the catalogue. */
  const stampText = (t, to = unitIndex('iota')) => chainAtTime(t, 0, to);
  /** The compact address of the cursor / now / hover flags (see `flagUnits`): "34η 29ι 21λ" while the ticks are ι. */
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
   * A length of time counted in ladder units around the instants t0 < t1 ("2ε 10η"), measured in position; a span of
   * only a few Blinks keeps a decimal ("6.4ν"). `slack` is the relative width of what the eye cannot tell apart (half
   * a pixel of the plot): a window that is one unit across to within a pixel reads "1α", not "4β 12γ" and not
   * "1α 3ε": the fewest leading parts that come within the slack of the span are written, the rest is dropped.
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
   * "in 2ε 10η" / "6ι 43λ ago" for t relative to ref, measured in position (exact across eclipse intervals); below
   * ten Blinks a decimal ("in 0.32ν"). "now" only within the same millisecond, the clock's resolution.
   */
  function relText(t, ref) {
    if (Math.abs(t - ref) < 0.001) return 'now';
    return t > ref ? `in ${pure.between(ref, t)}` : `${pure.between(t, ref)} ago`;
  }

  /**
   * "from → to" of a window in letters, the shared leading part of both addresses written once:
   * "α#6 β#4 γ#9 δ#3 ε#5 32η 30ι → 34η 1ι". An edge outside the catalogue says so.
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
    const head = common ? joinTokens(A.slice(0, common)) + ' ' : '';
    return `${head}${joinTokens(A.slice(common))} → ${joinTokens(B.slice(common))}`;
  }

  // ---- unit boundaries -----------------------------------------------------------------------------
  /** Time of the start of the unit with global index idx (fractions allowed: quarters, tenths), or null beyond the catalogue. */
  const startTime = (i, idx) => model.cycleStartTime(U[i].level, idx);

  // ---- steps (the zoom ladder of the ruler) --------------------------------------------------------
  const stepId = (i, m) => (m === 1 ? idOf(i) : `${idOf(i)}×${m}`);
  /** The multiples of unit i that produce a real step: at least two labelled ticks fit in every parent (2·m <= count). */
  const multiplesOf = (i) => (MULTIPLES[idOf(i)] ?? [1]).filter((m) => m === 1 || 2 * m <= perOf(i));
  /** Largest counter a unit shows (numbered from 1: its parent's size, "77η"; a count from 0: one less, "64λ"). */
  const topCounter = (i) => (fromOne(i) ? perOf(i) : perOf(i) - 1);
  /**
   * Width of the label a tick must at least be able to show, in characters: the letter form "δ#5", "α#18", "77η"
   * (a major period's words are shown only where they fit).
   */
  const charsOf = (i) => U[i].sym.length + (i < FIRST_COUNT_UNIT ? 1 : 0) + digits(topCounter(i));
  /** … and of its short form (an ordinal without its unit, "#10"), which the painter falls back to. */
  const charsShortOf = (i) => (i < FIRST_COUNT_UNIT ? 1 + digits(topCounter(i)) : charsOf(i));
  /**
   * All ruler steps, finest first: {id, u, level, m, sym, nominal (s), chars, charsShort, ctx (unit index of the context
   * row or -1), quarters (the context row is cut into the quarters of a major period), pure}.
   */
  const STEPS = [];
  for (let i = N - 1; i >= 0; i--) {
    for (const m of multiplesOf(i)) {
      const ctx = i - 1;
      STEPS.push({
        id: stepId(i, m),
        u: i,
        level: U[i].level,
        m,
        sym: U[i].sym,
        nominal: sec[i] * m,
        chars: charsOf(i),
        charsShort: charsShortOf(i),
        ctx,
        quarters: ctx >= 0 && isMajorUnit(ctx) && m === 1,
        pure: true,
      });
    }
  }
  const STEP_BY_ID = new Map(STEPS.map((s) => [s.id, s]));
  /**
   * The unlabelled tenths of a Blink: the minor ticks of the finest steps (never picked as a labelled step, so it is
   * not in STEPS). `div` marks a step that cuts every unit into that many equal parts.
   */
  const NU = unitIndex('nu');
  STEP_BY_ID.set('nu/10', { id: 'nu/10', u: NU, level: U[NU].level, m: 1, div: BLINK_PARTS, sym: U[NU].sym, nominal: sec[NU] / BLINK_PARTS, chars: 0, charsShort: 0, ctx: NU - 1, quarters: false, pure: true });
  const stepById = (id) => STEP_BY_ID.get(id) ?? null;
  /**
   * The unlabelled finer step between the labelled ticks: for a whole unit the grid of the depth between (MINOR_OF_UNIT:
   * 4ι under η, 11η under ε …) or the next unit; for a multiple the smaller multiple of the same unit that divides it
   * into about four.
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
   *
   * A multiple gives way to the next whole unit above it as soon as that unit shows PREFER_LABELS ticks itself: one
   * Delta across reads ε#1 … ε#5 under its quarters, not "1η 34η 1η 34η". The switch happens once on the way out, so
   * the choice still coarsens monotonically.
   */
  function pickStep(pxPerSec, plotW = 1000, charW = 6.6) {
    const roomy = plotW / MAX_LABELS;
    const narrow = plotW < NARROW_PLOT;
    for (let k = 0; k < STEPS.length; k++) {
      const s = STEPS[k];
      const need = Math.max((narrow ? s.charsShort : s.chars) * charW + (narrow ? 10 : 18), roomy);
      if (s.nominal * pxPerSec < need) continue;
      if (s.m > 1) {
        const whole = STEPS.find((x, j) => j > k && x.m === 1);
        if (whole && plotW / (whole.nominal * pxPerSec) >= PREFER_LABELS) return whole;
      }
      return s;
    }
    return STEPS[STEPS.length - 1];
  }

  /**
   * Ticks of a step in [from, to]: {t, idx, counter, labels (long → short), major}. Every parent (a Nuclide for η, a
   * Delta for ε, the catalogue for α …) is counted from its own start: ticks at 0, m, 2m … for as long as a full step
   * of m still fits before the parent ends, so no label is ever squeezed against the next parent's first one.
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
        out.push({ t, idx: k, counter: c, labels: tickLabels(i, c), major: i === 0 || o === 0 });
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

  // ---- the context row -------------------------------------------------------------------------------
  /**
   * The labels of a stretch whose address at position p runs down to unit c, longest first: the major periods in words
   * (joined by " · "), then the minor letters and counts, with the leading parts dropped one by one; then the letter
   * form of the last part and its bare ordinal. `quarter` (a word) is the quarter of the last major period when the
   * stretch is one of its quarters. A minor stretch starts its words at the Gamma, like a short date.
   *   δ quarter   "Alpha Hexafracton · … · Delta Trifracton Node" … "Delta Trifracton Node" → "δ#3 Node" → "Node"
   *   ε           "Gamma Nonafracton · Delta Trifracton · ε#5" … "ε#5" → "#5"
   *   ι           "Gamma Nonafracton · Delta Trifracton · ε#5 34η 29ι" … "34η 29ι" → "29ι"
   */
  function stretchLabels(p, c, quarter = null) {
    const toks = tokensAtPos(p, unitsTo(c).filter((i) => isMajorUnit(c) || i >= GAMMA));
    const parts = toks.map((tk) => (isMajorUnit(tk.u) ? { text: wordsOf(tk.u, tk.c), major: true } : { text: tk.text, major: false }));
    if (quarter) parts[parts.length - 1].text += ` ${quarter}`;
    const join = (ps) => ps.map((x, j) => (j === 0 ? '' : ps[j - 1].major ? ' · ' : ' ') + x.text).join('');
    const labels = [];
    for (let j = 0; j < parts.length; j++) labels.push(join(parts.slice(j)));
    const last = toks[toks.length - 1];
    if (isMajorUnit(c)) {
      labels.push(quarter ? `${last.text} ${quarter}` : last.text);
      labels.push(quarter ?? `#${last.c}`);
    } else if (c < FIRST_COUNT_UNIT) labels.push(`#${last.c}`);
    return labels;
  }
  /**
   * Spans of unit c overlapping [from, to]: {t0, t1, ord, labels (long → short)} (see `stretchLabels`). With `quarters`
   * (c a major period) every cycle is cut into its four quarters, each named by its quarter word (SPEC §15.2: the
   * quarter is named by the threshold that ends it); `ord` is then the global quarter number.
   */
  function spansIn(c, from, to, { quarters = false, limit = 4000 } = {}) {
    if (c < 0) return [];
    const a = Math.max(from, model.tMin);
    const b = Math.min(to, model.tMax);
    if (!(b >= a)) return [];
    const q = quarters ? 4 : 1;
    const k0 = Math.max(0, Math.floor((posOf(a) / len[c]) * q));
    const k1 = Math.max(k0, Math.ceil((posOf(b) / len[c]) * q) - 1);
    const out = [];
    for (let k = k0; k <= k1 && out.length < limit; k++) {
      const t0 = startTime(c, k / q);
      if (t0 === null) break;
      const t1 = startTime(c, (k + 1) / q) ?? model.tMax;
      if (!(t1 > t0)) continue;
      const mid = Math.min(ext - 10 * EPS_POS, ((k + 0.5) / q) * len[c]);
      out.push({ t0, t1, ord: k, labels: stretchLabels(mid, c, quarters ? pure.QUARTER_WORDS[k % 4] : null) });
    }
    return out;
  }
  /** The context row of a step: the quarters of the major period above whole-unit ticks, else the next coarser unit. */
  const contextIn = (step, from, to) => spansIn(step.ctx, from, to, { quarters: !!step.quarters });

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
    alphaCount,
    unitIndex,
    unitOfLevel,
    isMajorUnit,
    FIRST_COUNT_UNIT,
    unitsTo,
    flagUnits,
    below,
    tokensOf: tokens,
    indexAtPos,
    indexAtTime,
    counterOf,
    tokenText,
    tickLabels,
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
    stretchLabels,
    spansIn,
    contextIn,
    overviewMarks,
    PRESETS,
    presetSpan,
    presetWindow,
    activePreset,
  });
}
