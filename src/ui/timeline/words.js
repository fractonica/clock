/**
 * Pure-mode wording of the timeline: every sentence and label that normal mode writes with dates, Earth units or
 * percentages, said with Fractonica names, ladder units and glyph pairs instead (docs/design/80-pure.md).
 *
 * No DOM and no canvas: `createWords({ model, pure, ruler })` returns plain strings (and the HTML of glyph pairs
 * through `pure.pairHTML`), so the wording is unit tested and scanned for forbidden words in test/timeline.test.js.
 */

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st. */
export function nth(n) {
  const r = n % 100;
  return `${n}${r >= 11 && r <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
}

export function createWords({ model, pure, ruler }) {
  const U = ruler.units;
  const info = (L) => model.levelInfo(L);

  /** How long one cycle of a depth lasts, in ladder units: "1α", "2ε½", "1η", "4ι", "13λ" (the exact nominal length). */
  const cycleLength = (L) => pure.cycleLength(L);
  /** "half of a depth-6 cycle" / "a depth-7 cycle": what a ladder unit is. */
  const gloss = (u) => (U[u].half ? `half of a depth-${U[u].level + 1} cycle` : `a depth-${U[u].level + 1} cycle`);

  // ---- toolbar -------------------------------------------------------------------------------------
  const presetTitle = (p) => (p.u < 0 ? 'Show the whole catalogue' : `Show about one ${U[p.u].sym} across: ${gloss(p.u)}`);
  const presetLabel = (p) => (p.u < 0 ? 'All' : `${U[p.u].sym}`);

  // ---- the ruler -----------------------------------------------------------------------------------
  /**
   * What the tick row and the row above it count, for the tooltip of the ruler key in the gutter. This is the one
   * place that says why a tick reads "9η" above a lane block "η#10": counts start at 0, ordinals at 1.
   */
  function rulerTip(step) {
    const u = step.u;
    const every = step.m > 1 ? `; every ${nth(step.m)} one is labelled` : '';
    const ctx = step.ctx >= 0 ? ` The row above names the ${U[step.ctx].sym} each one belongs to.` : '';
    const notation =
      ' A count such as 9η is how many whole η have gone by since the parent cycle began, so it starts at 0; a number such as ζ½#5 names the 5th ζ½ of its parent and starts at 1, like the lane blocks (η#10).';
    return `Each tick starts a ${U[u].sym} (${gloss(u)}${u === 0 ? ', counted over the catalogue' : ''})${every}.${ctx}${notation} Press ? for the glossary.`;
  }
  /** The two short lines the ruler key shows in the gutter: the unit of the context row, the unit of the ticks. */
  function rulerKey(step) {
    return { top: step.ctx >= 0 ? U[step.ctx].sym : '', bottom: step.m > 1 ? `${step.sym} ×${step.m}` : step.sym };
  }

  // ---- lanes ---------------------------------------------------------------------------------------
  /** Tooltip of a lane head: what the depth's cycles are and how many there are. */
  function laneTip(L, alphaCycles) {
    const inf = info(L);
    if (L === 0) return `One α cycle spans 4 Saros intervals; the catalogue holds ${alphaCycles} (the last one is cut off).`;
    const parent = info(L - 1);
    return `${inf.siblings} per ${parent.letter} cycle, each lasting ${cycleLength(L)}. Every ${parent.letter} cycle splits into ${parent.factor} of them.`;
  }
  /** Name and address of cycle `idx` (global index) of depth L: { name: "Epsilon Pentafracton", short: "ε#5" }. */
  const cycleNames = (L, idx) => ({ name: pure.cycleName(L, idx), short: pure.cycleShort(L, idx) });
  /** What a cycle's end is: the cycle that begins there, or the end of the catalogue. */
  function endsInto(L, idx, endsWithCatalogue) {
    return endsWithCatalogue ? { short: 'the end', long: 'the end of the catalogue' } : { short: pure.cycleShort(L, idx + 1), long: pure.cycleName(L, idx + 1) };
  }
  /**
   * Labels of a lane block, longest first (the painter takes the first that fits). `wide`: the block is wider than
   * the plot, so it may carry the banner with what begins when it ends; `w`: its width in px.
   */
  function blockLabels({ level, local, idx, sib, wide, w, endsWithCatalogue }) {
    const inf = info(level);
    const n1 = local + 1;
    const head = `${inf.letter} ${inf.depth}`;
    const { name, short } = cycleNames(level, idx);
    const out = [];
    if (wide) out.push(`${head} · ${name} (${n1}/${sib}) · ${endsWithCatalogue ? 'ends with the catalogue' : `ends → ${endsInto(level, idx, false).short}`}`);
    if (w >= 190) out.push(`${head} · ${name}`);
    if (w >= 120) out.push(`${head} · ${n1}/${sib}`);
    if (w >= 40) out.push(short);
    out.push(String(n1));
    return out;
  }
  /** The note on a lane that is too dense to draw. */
  const denseMsg = (L) => `cycles of ${cycleLength(L)} · zoom in`;

  // ---- eclipse lane and catalogue edges -------------------------------------------------------------
  /** The eclipse that sits at position i is #i, 0-based like the position (the same number everywhere in the app). */
  const eclipseLabel = (i) => pure.eclipseName(i);
  const eclipseChip = (i, right) => (right ? `${eclipseLabel(i)} ▸` : `◂ ${eclipseLabel(i)}`);
  const eclipseChipTip = (i, right) => `${right ? 'Next' : 'Previous'} greatest eclipse of Saros 141 (${eclipseLabel(i)}) – click to bring it into view`;
  const edgeLabel = (side) => (side === 'start' ? 'catalogue starts · pos 0' : `catalogue ends · pos ${model.extent}`);
  const outsideTitle = 'Outside the Saros 141 catalogue';
  const rangeLabel = () => pure.catalogueText();

  // ---- the selected depth's turnover pointer ---------------------------------------------------------
  /** "ε ends in 1ε½ 2ζ½ ▸" (right) / "◂ ε ends in …" – `rel` is the countdown from the cursor to the end. */
  const endsChip = (letter, rel, right) => (right ? `${letter} ends ${rel} ▸` : `◂ ${letter} ends ${rel}`);
  /** Tooltip of that pointer: names what ends and what begins there. */
  function turnoverTip(L, idx, right, endsWithCatalogue) {
    const inf = info(L);
    const { name } = cycleNames(L, idx);
    const into = endsInto(L, idx, endsWithCatalogue);
    const what = endsWithCatalogue ? `${name} ends with the catalogue` : `${name} ends → ${into.long} begins`;
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
    return `Selected depth ${inf.depth} (${inf.letter}): ${name}, cycle ${local + 1} of ${count}, ends ${endsWithCatalogue ? 'with the catalogue' : `→ ${into.long} begins`}.`;
  }

  return Object.freeze({
    nth,
    cycleLength,
    gloss,
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
