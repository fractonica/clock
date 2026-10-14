/**
 * Pure-mode wording of the timeline: every sentence and label that normal mode writes with dates, Earth units or
 * percentages, said in Fractonica terms instead (SPEC §15, docs/design/80-pure.md revision 3).
 *
 *   major periods α β γ δ   in WORDS with a fracton ordinal ("Delta Trifracton") and, for a moment or a stretch of a
 *                           quarter, the quarter word (Peak, Node, Valley, End); never a phase pair
 *   minor units ε η ι λ ν   in letters and counts: the Nuclide ordinal "ε#5", the Helion numbered from 1 in it "34η"
 *                           (1η … 77η), then completed Preons, Flavons, Blinks "29ι 21λ 3ν"
 *   depths between (ζ θ κ μ) and finer (ξ …) are not units: named by where their cycles start ("34η 28ι") and
 *                           measured in the next unit ("11η", "4ι", "13λ", "5ν", "0.14ν")
 *
 * Compact text (ticks, chips, lane heads, flags) keeps letters; unit NAMES (Nuclide, Helion, Preon, Flavon, Blink) are
 * for prose: tooltips that explain a unit, the ruler key, preset titles.
 *
 * No DOM and no canvas: `createWords({ model, pure, ruler })` returns plain strings, so the wording is unit tested and
 * scanned for forbidden words in test/timeline.test.js.
 */

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function nth(n) {
  const r = n % 100;
  return `${n}${r >= 11 && r <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

/** "an Alpha", "a Helion": the indefinite article of a unit name. */
const aName = (name) => `${/^[AEIOU]/i.test(name) ? 'an' : 'a'} ${name}`;
/** "an α", "a ζ": the article as the letter is spoken (alpha, epsilon, eta, iota, omicron, upsilon, omega). */
const aLetter = (letter) => `${/[αεηιουω]/.test(letter) ? 'an' : 'a'} ${letter}`;

export function createWords({ model, pure, ruler }) {
  const U = ruler.units;
  const info = (L) => model.levelInfo(L);
  /** The unit of a depth (0-based level), or undefined for the depths between and below the ladder. */
  const unitAt = (L) => pure.unitOf(L);
  const kind = (L) => pure.levelKind(L);
  /** The next unit below a unit level on the ladder (undefined below the Blink). */
  const nextUnit = (L) => U.find((u) => u.level > L);
  const nameOf = (u) => U[u].name;
  const FIRST_CLOCK = ruler.unitIndex('eta');
  const CLOCK = ['eta', 'iota', 'lambda'].map((id) => ruler.unitIndex(id));

  /** How long one cycle of a depth lasts, in ladder units: "1δ", "1η", "11η" (ζ), "4ι" (θ), "0.14ν" (ξ). */
  const cycleLength = (L) => pure.cycleLength(L);
  /** "depth 7": where a ladder unit sits in the hierarchy. */
  const gloss = (u) => `depth ${U[u].level + 1}`;
  /**
   * What the lane head says under the letter: one cycle of the depth counted in the next unit, the ladder itself:
   * α "= 5β", δ "= 5ε", ε "= 77η", η "= 36ι", ι "= 65λ", λ "= 25ν"; the depths between "= 11η", "= 4ι", "= 13λ",
   * "= 5ν"; ξ "= 0.14ν". The Blink has no unit below it and says how many ξ cycles make one ("= 7ξ").
   */
  function laneLength(L) {
    if (kind(L) === 'between' || kind(L) === 'sub') return `= ${cycleLength(L)}`;
    const next = nextUnit(L);
    if (!next) return `= ${info(L).factor}${info(L + 1).letter}`;
    return `= ${Math.round(pure.cyclePos(L) / pure.cyclePos(next.level))}${next.sym}`;
  }
  /** The tail of a cycle's detail line in the plot tooltip: only a depth that is not a unit says how long it lasts. */
  const lastsText = (L) => (kind(L) === 'between' || kind(L) === 'sub' ? `lasts ${cycleLength(L)}` : '');

  // ---- toolbar -------------------------------------------------------------------------------------
  function presetTitle(p) {
    if (p.u < 0) return 'Show the whole catalogue';
    if (p.deepest) return `Zoom in to the Blink (${U[p.u].sym}) scale: a few Blinks across, the deepest zoom`;
    return `Show about one ${nameOf(p.u)} (${U[p.u].sym}) across${U[p.u].major ? ': a major period' : ''}`;
  }
  const presetLabel = (p) => (p.u < 0 ? 'All' : `${U[p.u].sym}`);

  // ---- the ruler -----------------------------------------------------------------------------------
  /**
   * What the tick row and the row above it say, for the tooltip of the ruler key in the gutter: majors in words, the
   * Nuclide by its ordinal, the Helion numbered from 1 and the finer counts from 0 inside their parent (the header clock
   * for η ι λ), quarters in the row
   * above whole major periods.
   */
  function rulerTip(step) {
    const u = step.u;
    const unit = U[u];
    let what;
    if (unit.major) what = `Each tick starts ${aName(unit.name)} (${unit.sym}), a major period, named in words where there is room ("${pure.periodName(unit.level, 3)}") and else in letters (${unit.sym}#3)`;
    else if (u < FIRST_CLOCK) what = `Each tick starts ${aName(unit.name)} (${unit.sym}, ${gloss(u)}), named by its place in the Delta (ε#1 … ε#5)`;
    else what = `Each tick starts ${aName(unit.name)} (${unit.sym}, ${gloss(u)})`;
    const every = step.m > 1 ? `; every ${nth(step.m)} one is labelled` : '';
    let ctx = '';
    if (step.ctx >= 0) {
      const c = U[step.ctx];
      ctx = step.quarters
        ? ` The row above names the ${c.name} (${c.sym}) and its quarters Peak, Node, Valley and End, each named by the threshold that ends it.`
        : ` The row above names the ${c.name} (${c.sym}) each one belongs to.`;
    }
    const inside =
      u >= FIRST_CLOCK
        ? ` Here ${unit.sym} is ${u === FIRST_CLOCK ? 'numbered' : 'counted'} inside the ${U[u - 1].name}, from ${u === FIRST_CLOCK ? `1 to ${ruler.per[u]}` : `0 to ${ruler.per[u] - 1}`}${CLOCK.includes(u) ? ', like the clock in the header' : ''}.`
        : '';
    const notation = ' ε#5 names the 5th Nuclide of its Delta and 34η the 34th Helion of its Nuclide, both numbered from 1; 29ι 21λ 3ν count the Preons, Flavons and Blinks completed since, from 0.';
    return `${what}${every}.${ctx}${inside}${notation} Press ? for the glossary.`;
  }
  /** The two short lines the ruler key shows in the gutter: the unit of the context row, the unit of the ticks. */
  function rulerKey(step) {
    return { top: step.ctx >= 0 ? U[step.ctx].sym : '', bottom: step.m > 1 ? `${step.sym} ×${step.m}` : step.sym };
  }

  // ---- lanes ---------------------------------------------------------------------------------------
  /** Tooltip of a lane head: what the depth's cycles are, how they are named and what they are made of. */
  function laneTip(L, alphaCycles) {
    const inf = info(L);
    const u = unitAt(L);
    const k = kind(L);
    if (L === 0) {
      return `Alpha (α): a major period of 4 Saros intervals; the catalogue holds ${alphaCycles} (the last one is cut off). One Alpha is ${inf.factor} β. Named in words with its quarter: Peak, Node, Valley or End.`;
    }
    const parent = info(L - 1).letter;
    if (k === 'major') {
      return `${u.name} (${u.sym}): a major period, depth ${inf.depth}. ${inf.siblings} of them make ${aLetter(parent)}; one is ${inf.factor} ${info(L + 1).letter}. Named in words with its quarter: Peak, Node, Valley or End.`;
    }
    if (k === 'unit') {
      const above = unitAt(L - 1) ?? unitAt(L - 2);
      const per = Math.round(pure.cyclePos(above.level) / pure.cyclePos(L));
      const next = nextUnit(L);
      const made = next ? `; one is ${Math.round(pure.cyclePos(L) / pure.cyclePos(next.level))} ${pure.unitName(next.sym, 2)} (${next.sym})` : '';
      const head = next ? `${u.name} (${u.sym}): a minor unit, depth ${inf.depth}.` : `${u.name} (${u.sym}): the finest unit, depth ${inf.depth}, and the device's real-time tick.`;
      const naming =
        L === 4
          ? `Named ε#1 … ε#${per} inside its Delta.`
          : u.id === 'eta'
            ? `Numbered 1η … ${per}η inside its Nuclide.`
            : `Counted 0${u.sym} … ${per - 1}${u.sym} inside its ${above.name}.`;
      return `${head} ${per} of them make ${aName(above.name)} (${above.sym})${made}. ${naming}`;
    }
    if (k === 'between') {
      const above = unitAt(L - 1);
      const len = cycleLength(L);
      const n = /^(\d+)/.exec(len)[1];
      const sym = len.slice(n.length);
      const first = sym === 'η' ? 1 : 0; // Helions are numbered from 1 in their Nuclide
      const at = (i) => `${i * n + first}${sym}`;
      return `${inf.letter} (depth ${inf.depth}) lies between the units: one cycle is ${len}, ${inf.siblings} of them make ${aName(above.name)} (${above.sym}). A cycle is named by where it starts: ${[0, 1, 2].map(at).join(', ')} … ${at(inf.siblings - 1)}.`;
    }
    return `${inf.letter} (depth ${inf.depth}) is finer than the Blink: one cycle lasts ${cycleLength(L)}, ${inf.siblings} of them make ${aLetter(parent)}. A cycle is named by the decimal Blink it starts at.`;
  }
  /**
   * Name and short form of cycle `idx` (global index) of depth L: "Delta Trifracton" / "δ#3", "ε#5 34η" / "34η". Cached:
   * the painter asks for every visible block on every frame, and a minor name is exact BigInt arithmetic.
   */
  const nameCache = new Map();
  function cycleNames(L, idx) {
    const key = `${L}|${idx}`;
    let v = nameCache.get(key);
    if (!v) {
      if (nameCache.size > 6000) nameCache.clear();
      v = { name: pure.cycleName(L, idx), short: pure.cycleShort(L, idx) };
      nameCache.set(key, v);
    }
    return v;
  }
  /**
   * What begins when cycle `idx` of depth L ends: { short, long, say }. `say` is how a sentence names it: a major in
   * words ("Delta Tetrafracton"), a minor cycle by the counts that change ("35η" inside the same Nuclide, "ε#1 1η" at
   * the start of the next one).
   */
  function endsInto(L, idx, endsWithCatalogue) {
    if (endsWithCatalogue) return { short: 'the end', long: 'the end of the catalogue', say: 'the end of the catalogue' };
    const next = Number(idx) + 1;
    if (pure.isMajor(L)) {
      const n = cycleNames(L, next);
      return { short: n.short, long: n.name, say: n.name };
    }
    const a = cycleNames(L, idx).name.split(' ');
    const b = cycleNames(L, next).name.split(' ');
    let i = 0;
    while (i < b.length - 1 && a[i] === b[i]) i++;
    const changed = b.slice(i).join(' ');
    return { short: changed, long: b.join(' '), say: changed };
  }
  /**
   * Labels of a lane block, longest first (the painter takes the first that fits). `wide`: the block is wider than the
   * plot, so it may carry the banner with what begins when it ends; `w`: its width in px; `quarter`: the quarter word at
   * the cursor for the block that holds it (major periods only).
   *   major   "δ 4 · Delta Trifracton End (3/5) · ends → Delta Tetrafracton" … "Delta Trifracton End" … "δ#3" … "3"
   *   minor   "η 7 · ε#5 34η · ends → 35η" … "ε#5 34η" … "34η" … "34"
   */
  function blockLabels({ level, local, idx, sib, wide, w, endsWithCatalogue, quarter = null }) {
    const inf = info(level);
    const head = `${inf.letter} ${inf.depth}`;
    const { name, short } = cycleNames(level, idx);
    const into = endsInto(level, idx, false);
    const ends = endsWithCatalogue ? 'ends with the catalogue' : `ends → ${into.say}`;
    const out = [];
    if (pure.isMajor(level)) {
      const n1 = local + 1;
      const named = quarter ? `${name} ${quarter}` : name;
      if (wide) out.push(`${head} · ${named} (${n1}/${sib}) · ${ends}`);
      if (w >= 120) out.push(`${head} · ${named}`, named);
      if (quarter && w >= 90) out.push(name);
      if (w >= 40) out.push(quarter ? `${short} ${quarter}` : short, short);
      out.push(String(n1));
    } else {
      if (wide) out.push(`${head} · ${name} · ${ends}`);
      if (w >= 120) out.push(`${head} · ${name}`, name);
      if (w >= 30) out.push(short);
      out.push(short.replace(/[^\d.#]/g, '').replace(/^#/, ''));
    }
    return [...new Set(out)];
  }
  /** The note on a lane that is too dense to draw: "ε cycles · zoom in", "ζ cycles of 11η …", "cycles of 0.14ν …". */
  function denseMsg(L) {
    const k = kind(L);
    if (k === 'sub') return `cycles of ${cycleLength(L)} · zoom in`;
    if (k === 'between') return `${info(L).letter} cycles of ${cycleLength(L)} · zoom in`;
    return `${info(L).letter} cycles · zoom in`;
  }

  // ---- eclipse lane and catalogue edges -------------------------------------------------------------
  /** The eclipse that sits at position i is #i, 0-based like the position (the same number everywhere in the app). */
  const eclipseLabel = (i) => pure.eclipseName(i);
  const eclipseChip = (i, right) => (right ? `${eclipseLabel(i)} ▸` : `◂ ${eclipseLabel(i)}`);
  const eclipseChipTip = (i, right) => `${right ? 'Next' : 'Previous'} greatest eclipse of Saros 141 (${eclipseLabel(i)}) – click to bring it into view`;
  const edgeLabel = (side) => (side === 'start' ? 'catalogue starts · pos 0' : `catalogue ends · pos ${model.extent}`);
  const outsideTitle = 'Outside the Saros 141 catalogue';
  const rangeLabel = () => pure.catalogueText();

  // ---- the selected depth's turnover pointer ---------------------------------------------------------
  /** "ε ends in 2ε 10η ▸" (right) / "◂ ε ends in …" – `rel` is the countdown from the cursor to the end. */
  const endsChip = (letter, rel, right) => (right ? `${letter} ends ${rel} ▸` : `◂ ${letter} ends ${rel}`);
  /** Tooltip of that pointer: names what ends and what begins there. */
  function turnoverTip(L, idx, right, endsWithCatalogue) {
    const inf = info(L);
    const { name } = cycleNames(L, idx);
    const into = endsInto(L, idx, endsWithCatalogue);
    const what = endsWithCatalogue ? `${name} ends with the catalogue` : `${name} ends → ${into.say} begins`;
    return right
      ? `Next turnover of the selected depth, ${inf.letter} (depth ${inf.depth}): ${what}. Click to bring it into view.`
      : `The end of the ${inf.letter} cycle at the cursor lies to the left of the view: ${what}. Click to bring it into view.`;
  }
  /** Chip for a cursor / now marker that is out of view. */
  const markerChip = (name, label, right) => (right ? [`${name} ${label} ▸`, `${name} ▸`] : [`◂ ${name} ${label}`, `◂ ${name}`]);

  // ---- screen-reader text ---------------------------------------------------------------------------
  /** One sentence about the selected depth's cycle at the cursor. */
  function selectedSentence(L, idx, local, count, endsWithCatalogue) {
    const inf = info(L);
    const { name } = cycleNames(L, idx);
    const into = endsInto(L, idx, endsWithCatalogue);
    const place = pure.isMajor(L) ? `, cycle ${local + 1} of ${count}` : '';
    return `Selected depth ${inf.depth} (${inf.letter}): ${name}${place}, ends ${endsWithCatalogue ? 'with the catalogue' : `→ ${into.say} begins`}.`;
  }

  return Object.freeze({
    nth,
    cycleLength,
    gloss,
    nameOf,
    laneLength,
    lastsText,
    presetTitle,
    presetLabel,
    rulerTip,
    rulerKey,
    laneTip,
    cycleNames,
    endsInto,
    blockLabels,
    denseMsg,
    eclipseLabel,
    eclipseChip,
    eclipseChipTip,
    edgeLabel,
    outsideTitle,
    rangeLabel,
    endsChip,
    turnoverTip,
    markerChip,
    selectedSentence,
  });
}
