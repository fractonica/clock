# Module: timeline  (visualisation #1 – navigate and estimate)

Owns: `src/ui/timeline.js`, `src/ui/timeline/*`, `src/styles/timeline.css`, `test/timeline.test.js`.  CSS prefix `tl-`.
Mounts into `#view-timeline` (a tab).

## Goal

A **zoomable, pannable multi-scale timeline**: the tool for moving through time and *seeing* cycle boundaries at
every scale next to the Gregorian calendar. Zoom from the whole catalogue (1613–2857, the 70 Saros eclipses) down to
a few seconds. At any zoom the user sees the Gregorian axis on top and, under it, one lane per depth showing the
cycles of that depth as blocks with their local index, so "when does the next ε start, and what is on the calendar
that day?" is answered by looking.

## Canvas (2D, HiDPI, ResizeObserver) – layout top to bottom

1. **Overview strip** (fixed, ~36 px): the whole catalogue. Marks for the 70 eclipse instants (`model.catalogue`),
   α-cycle blocks tinted alternately, a rectangle for the visible window (draggable, click to recentre), now/cursor
   markers. This is the "where am I in 1613–2857" map.
2. **Gregorian axis**: adaptive ticks chosen from px-per-unit: centuries → decades → years → months → days → 6 h/hours →
   minutes → seconds → ms, with labels that never overlap; weekend or month shading at day scale; **zone aware**
   (`ctx.fmt.parts/toUnix`; days are local days, so DST days are 23/25 h – do not assume 86400 s). A "now" marker
   (rose `theme.NOW`) when live or travelling, and the displayed time cursor (`theme.CURSOR`).
3. **Lanes**: one per depth in `store.state.minDepth … maxDepth`. For each visible lane, draw cycle blocks between
   `model.boundaries(L, t0, t1, limit)` (cap the work; if blocks would be < ~3 px wide, hide the lane's detail and show a
   dense hatch or hide the lane; if one block is wider than the whole canvas, show a thin banner "ε 5 · 3/5 · ends
   Oct 18 03:41" pinned to the visible part). Each block: alternating tint of the level colour, label `local+1` (Greek letter
   on the first lane / when it fits), quarter ticks (peak/node/valley) when wide enough (≥ 80 px per cycle), and the
   current cycle (containing the cursor) outlined. Lane label sticky on the left with the Greek letter, depth, and
   the cycle length ("≈ 16.2 d"). The selected level's lane is highlighted.
4. **Eclipse lane** ("Saros 141"): the 70 greatest eclipses as small markers with their Gregorian date, visible when zoomed
   out to centuries/decades; these are the time base of the whole clock.
5. **Next-boundary pointers**: for the selected level, a pointer at its next end when it is off screen to the right
   ("ε ends in 3 d 04 h ▸"), clickable to bring it into view.

## Interaction

- Drag = pan; wheel = zoom about the pointer (ctrl/⌘+wheel or pinch on touch also; plain wheel zooms, shift+wheel
  pans horizontally); double-click a block = animated zoom to fit that cycle (with a little margin); click = move the
  time cursor to that instant (`ctx.goto(t)`; snap to the block start if the user clicks within 5 px of a boundary);
  hover = crosshair with a tooltip: Gregorian date-time (zone aware), Fractonica position (`model.positionOf`), the cycle
  names at the lanes under the pointer (`ε 5 · 3/5`), time to/since "now".
- Toolbar (above the canvas, `.seg`/`.btn` styles): zoom presets **Day · Week · Month · Year · Decade · Century · All**,
  zoom ± buttons, "Fit selected cycle", "Centre on cursor", and a **Follow** toggle: when on (default while live), the
  window scrolls so the cursor stays at 50 %. Dragging turns follow off. Keyboard: `+`/`-` zoom, ←/→ pan, `Home` centre.
- Zoom limits: from ~2 s across the canvas up to the whole catalogue plus a margin; pan limited to the catalogue ± margin.
  Animated transitions (ease-out ≈ 250 ms; instant under reduced motion).
- All views share `store.state.selectedLevel`: clicking a lane label selects it.
- State to persist in the closure (not localStorage): window `[t0, t1]`, follow flag.

## Rendering notes

- Time → x mapping as float seconds; keep `t0` relative to avoid precision loss at deep zoom (work in offsets from the
  window centre when drawing at ms scale).
- Cache per-lane block lists keyed by `(level, t0, t1)` rounded; recompute only when the window changes.
- Out-of-range cursor or window: draw outside regions with a diagonal "no data" hatch and the catalogue edge labelled.
- Provide small pure helpers (tick generator, nice-step picker, time↔x mapping) in `src/ui/timeline/helpers.js` with tests,
  including DST (e.g. zone `Europe/Berlin` around 2026-03-29 and 2026-10-25) and a century-scale tick case.

## Pure mode (revision 3: SPEC §15 and docs/design/80-pure.md)

The Gregorian axis becomes a **pure ruler** (`src/ui/timeline/ruler.js`, wording in `words.js`, tooltips in `tips.js`).
Nothing Earth-ish is drawn or said; the mode switches live (`applyMode`), in both directions.

**The ladder** is `pure.UNITS`: the four **major periods** α β γ δ (depths 1–4, said in words) and the **minor units** ε η ι λ ν
(depths 5 7 9 11 13, every other depth, said in letters and counts). ζ θ κ μ and ξ are lanes, never ruler units. The
Helion is **numbered from 1** inside its Nuclide (1η … 77η), so the ζ grid ticks read `1η 12η 23η … 67η`; Preons, Flavons
and Blinks count completed units from 0. Spans are unchanged (`5η` is five Helions).

| unit | per parent | tick label | context row above |
|---|---|---|---|
| α | catalogue 18 | `Alpha Hexafracton` → `α#6` → `#6` | – |
| β γ δ | 5 · 13 · 5 | `Delta Trifracton` → `δ#3` → `#3` (words where they fit) | the parent's **quarters**: `Gamma Nonafracton Node` → `γ#9 Node` → `Node` |
| ε | 5 in δ | `ε#2` → `#2` | the Delta's quarters: `Gamma Nonafracton · Delta Trifracton End` |
| η | 77 in ε | numbered `34η` (1–77, from 1) | the Nuclide: `Delta Trifracton · ε#5` |
| ι | 36 in η | count `29ι` (completed, from 0) | `ε#5 34η` |
| λ | 65 in ι | count `21λ` | `ε#5 34η 29ι` |
| ν | 25 in λ | count `3ν` | `34η 29ι 21λ` |

Context labels are long → short: the major periods in words joined by `·`, then the minor letters, dropping leading parts
until one fits. Quarters appear in the row only above whole ticks (a multiple keeps its parent's plain spans); a quarter is
named by the threshold that ends it, so one Delta across reads `Peak | Node | Valley | End` above `ε#1 … ε#5`.

**Flags** (cursor / now / hover): from ι ticks down the header clock (`34η 29ι 21λ`, plus `3ν` over λ and ν ticks); coarser
ticks show the tick unit between its neighbours in letters (`ε#5 34η 29ι`, `δ#3 ε#5 34η`, `γ#9 δ#3 ε#5`). The ruler reads
by exact time, so a flag, a tooltip and the header never disagree near a boundary (tested to the millisecond).

**Zoom ladder.** Steps = a unit or a multiple m of it (labels every m-th unit of its parent while a full step fits,
2·m ≤ count): ν ×1 ×2 ×5 ×10 · λ ×1 ×2 ×5 ×13 ×26 · ι ×1 ×2 ×4 ×6 ×12 ×18 · η ×1 ×2 ×3 ×5 ×11 ×22 ×33 · ε ×1 ×2 · δ ×1 ×2 ·
γ ×1 ×2 ×3 ×6 · β ×1 ×2 · α ×1 ×2. The multiples ν×5, λ×13, ι×4, η×11 are the grids of the depths between (μ κ θ ζ), so the
labelled ticks fall where those lanes start; they are also the minor ticks of the whole units (the Blink's minors are tenths
of a Blink). Neighbours are at most 2.6 apart: a plot of 520 px or more shows **4–12 labelled ticks at every zoom**. A
multiple gives way to the whole unit above it once that unit has ≥ 4.8 ticks on the plot (one Delta across reads ε#1 … ε#5,
not every 33rd Helion); the choice still coarsens monotonically. Tick counts draw their unit symbol in the lane colour (a
monospaced θ or ι next to digits is easy to misread); major names are set in the text face.

**Presets**: `ν λ ι η ε δ γ β α All`, each one unit across **in position** (the status line reads `1η across`), titles
name the unit ("Show about one Helion (η) across", "… Delta (δ) across: a major period"). **ν is the deepest zoom**: the
narrowest window (`MIN_SPAN`, 2 s ≈ 6.4 Blinks, read `6.4ν across`); the ticks are Blinks with tenths, exact to the clock.

**Lanes**: major lanes carry the name in words and, in the block that holds the cursor, the quarter word
(`δ 4 · Delta Trifracton End (3/5) · ends → Delta Tetrafracton`); their wave is labelled with the quarter words in their
stretches, never a phase. Minor lanes and the depths between are named by their placing counts (`η 7 · ε#5 34η · ends →
35η`, θ blocks `28ι`, κ blocks `13λ`). The gutter says one cycle in the next unit: `= 5β` … `= 5ε`, `= 77η`, `= 36ι`,
`= 65λ`, `= 25ν`, `= 7ξ` for the units and the lengths `= 11η`, `= 4ι`, `= 13λ`, `= 5ν`, `= 0.14ν` for the others.

**Tooltips**: the plot gives the date in words (`Delta Trifracton End ε#5 34η 29ι 21λ 3ν`; over major ticks the full form with
every major period and its quarter), the stamp in letters, `pos` and the eclipses it lies between, countdowns to now / the
cursor, and one row per lane: a major period's place and **quarter word** (no glyph pair), a minor depth's placing count and
its phase pair. Lane heads explain the unit by name; the ruler key says what is counted inside what.

**Spans** use `pure.duration*`: `2ε 10η`, `6ι 43λ`, zero parts skipped; below ten Blinks decimals (`0.4ν`, `6.4ν`).
`spanText(t0, t1, parts, slack)` writes the fewest leading parts that come within half a pixel of the window, so a window one
unit across reads `1α`. `relText` says `now` only within the same millisecond. Eclipses are `#k` everywhere; the overview
keeps `α#n` and the eclipse numbers.

Verification: `test/timeline.test.js` (ladder, counts, stamps vs `pure.stamp`, boundaries, flags, steps and the 4–12 rule,
ticks vs lanes of every unit and of the depths between, context quarters, spans, presets, the deepest zoom, wording,
tooltips, leak sweeps) and `tools/checks/check-timeline-pure.mjs` (browser: every preset, window edges, drags, keyboard,
phone long press, live switching, leak scan).

## Pentads (SPEC §7.5)

A date leads with its Pentad, like a weekday (`src/ui/pentad.js`, timeline glue in `src/ui/timeline/pentads.js`).

- **Band.** The row under the ticks (where the flags sit) holds the Pentads of the window once the Hypopentad is at least
  6 px wide (from about a month across down to the deepest zoom): day-like stretches in the solar gold, alternately
  tinted, the one holding the cursor brighter, a stronger tick where a sync begins (Pentad I). Each is labelled with its
  mark, its name where it fits (`⬠ Pentad II`; pure mode adds its length, `· 5η`), sticky to the visible part. Short ticks
  mark the Helions inside each Pentad (four in the Hypopentad, five in the others) and, where a Helion is 44 px wide,
  its place (2 … 5). The gutter says `Pentads`; its tooltip explains the Sun link (pure mode without day, hour or Sun).
  Spans are cached on a window padded by half its width (`pentadsIn`); a frame never asks the model per pixel.
- **Leading readings.** The cursor / now / hover flags, the off-screen cursor and now chips, the Gregorian eclipse chips
  and the `ends …` date of a wide block are led by the mark, drawn on the canvas (a private-use character in the label
  stands for it; it never reaches the DOM). The tooltips lead their date with the mark (HTML, named "Pentad II" for
  screen readers) and add `Pentad II · 2nd of its 5 Helions`; the status line leads each end while the band is drawn
  (once when both ends share a Pentad); the screen-reader summary says `Cursor at Pentad II, …`. In pure mode a reading
  leads with its Pentad only when it reads down to the Helion (a flag over γ ticks, a tooltip over α ticks or a status
  line of Nuclides does not). `api.flags` gives the flag labels with the marks spelled out.
