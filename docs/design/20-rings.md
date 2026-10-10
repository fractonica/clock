# Module: rings  (visualisation #1, main view)

Owns: `src/ui/rings.js`, `src/ui/rings/*`, `src/styles/rings.css`, `test/rings.test.js`.  CSS prefix `rings-`.
Mounts into `#view-rings` (a tab). Default tab.

## Goal

An at-a-glance picture of **where we are in every cycle at once**, and a way to **step through cycles and see when
the next one turns over**. Think nested analogue dials: the outermost ring is the longest cycle (α, ~72 y), each ring
inside it is the next, ten times faster or so. The viewer should be able to answer in two seconds: "which part of
the α/β/γ/δ/ε cycle are we in, and how long until each one ends?"

## The ring dial (canvas 2D, HiDPI, `ResizeObserver`)

Rings for depths `store.state.minDepth … store.state.maxDepth` (default 1…10, adjustable 1…14 with a small range
control in the view; persist via `store.set`). Outer ring = shallowest depth. Level colour from `theme.levelColor(L)`.

For each level L, using `frame.level(L)`:
- A faint **track** circle; the cycle's progress `phase` is an arc swept clockwise from 12 o'clock with a bright
  head/knob at the current phase (the "hand" of that ring). Use the exact `phase`, so deep rings spin smoothly.
- **Sector ticks**: the ring is divided into `levelInfo(L).factor` equal sectors = the child cycles (depth+1). The
  sector currently running is lightly filled. These make nesting legible: the next ring in is "one sector, zoomed".
- **Quarter marks** at 0°, 90°, 180°, 270° = begin / peak / node / valley (`QUARTER_NAMES`), small notches; label them
  only on the selected ring. Mark passed vs upcoming quarters.
- **Funnel**: between ring L and ring L+1 draw a soft wedge from the current sector's two edges on ring L down to the
  full circle of ring L+1 – the visual "zoom" from one cycle into the next. Keep it subtle (alpha ≈ 0.08–0.15).
- Ring label at 12 o'clock-left: Greek letter + depth (`ε 5`) and `local/siblings` (e.g. `3/5`) for L ≥ 1.
- Selected ring (`store.state.selectedLevel`) is brighter/thicker; click on a ring selects it (`ctx.select`).
- **Navigate**: click a sector → `ctx.goto(time of that child cycle's start)` (use `model.cycleStartTime(L+1, idx)`
  with `idx = levelAt(t,L).cycle * factor + j`; only if inside the catalogue). Cursor changes to pointer over
  navigable sectors; hover shows a tooltip: child cycle name, Gregorian start–end in the current zone (`ctx.fmt`),
  duration and "starts in / started … ago".
- Rings whose period is below ~0.5 s are drawn but fade to a glow instead of a crisp hand (no strobing); respect
  reduced-motion by freezing hands of rings with period < 2 s at their current phase.

## Centre read-out (inside the innermost ring; scale with the dial)

For the selected level: big countdown to its end ("ends in 3 d 04 h"), the end's Gregorian date/time (zone aware), and
the current phase name (rising/peak/falling/valley), cycle name `ε 5 · 3/5`. Under it, four chips for the quarter
thresholds `peak / node / valley / end` with their Gregorian times; passed ones struck through, the next one accented
with its countdown. Buttons: ⏮ previous cycle, ⏭ next cycle (`ctx.stepCycle(±1)`), "Next threshold ›" (go to the
next quarter boundary of the selected level, +1 ms).

## Waveform inset (below or beside the dial, responsive)

A small chart of the selected level's cycle: the triangle-wave of glyph value over the cycle (0 → +M → 0 → −M → 0),
four quarter bands tinted, vertical cursor at the current phase, quarter labels with Gregorian times, and the live
glyph (2-stroke, from the library) next to it. Dragging the cursor scrubs time within the cycle
(`ctx.goto(start + x * duration)`), release keeps the position. This is what makes "peak / node / valley" intuitive.

## Layout / behaviour

- Desktop: dial on the left/centre, inset on the right or below; ≤ 700 px: dial on top (square, full width), inset below.
- Range control + "show sectors / quarters / funnels" toggles live in a slim toolbar at the top of the view.
- Keyboard: ←/→ select shallower/deeper ring, `[`/`]` already step cycles globally.
- Out of range: dial greyed with the catalogue range message.
- Rendering must stay under ~3 ms: precompute geometry on resize/range change; per frame only draw arcs + text that changed.

## Pure mode (revision 2: whole cycles, named units, the Blink)
Same view, Fractonica terms only (docs/design/80-pure.md). Strings live in `src/ui/rings/pure-text.js`; `rings.js` asks the mode on every frame.

- **Centre**: `ENDS IN 1θ 2ι 3κ` with `→ Eta Difracton` under it. Two non-zero counts (`pure.durationPos`), plus a third while it is steady
  (never finer than λ: a λ or coarser changes at most every 7.8 s of real time); a compact dial and a span that leads with λ or finer have two.
- **Quarter chips**: countdown (negative once passed: `−5θ 1κ`) and the place on the header clock (`ε#5 · ζ#4 · 0η 9ι`, the ordinals left to the header
  while they do not change).
- **Coordinates** (wave labels, chips, facts): the digits of the header clock: ordinals α β γ δ ε ζ, then the counters η ι λ and μ ν. θ and κ are
  units of the ladder but not digits of the clock. The resolution follows the cycle it labels (a quarter is the step: an η cycle resolves to ι, a κ
  cycle to λ); below one Blink (the ν and ξ rings) the ν counter has decimals (`3.2ν`, `3.43ν`) so the five boundaries still differ.
- **Phase card**: the glyph pair (`phase 13 and 0 of 256`) instead of a percentage; Started / Ends as ordinals + counters + "→ the cycle that begins";
  Length is the exact nominal length from `pure.cycleLength` and the unit's name (`1η (Helion)`, `1γ`, the ξ ring `0.14ν`); only a cycle clipped by
  the catalogue is measured.
- **Real time is counted in Blinks** (`blinkSpan`): "one turn takes about 325 Blinks" in the help, `about 58 500 Blinks per cycle` on a ring too
  fast to follow. Whole numbers, because the ladder is a product of whole factors.
- **Tooltips** name the cycle and its child (`Kappa Monofracton · ends → Kappa Difracton begins · lasts 1κ (Chromon) · started 1κ 8λ ago`).
- **Help**: names from 1, counters from 0, spans are counts, the units have names (Helion, Preon, Flavon, Blink), real time is Blinks, glossary pointer.
- Toolbar / depth-range / ring labels are depth chips (`η 7`) and need no translation.
