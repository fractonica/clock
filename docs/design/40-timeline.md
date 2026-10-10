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

## Pure mode (revision 2 of docs/design/80-pure.md: whole cycles, named units, the Blink)

The Gregorian axis becomes a **pure ruler** (`src/ui/timeline/ruler.js`, wording in `words.js`, tooltips in `tips.js`).
Nothing Earth-ish is drawn or said; the mode switches live (`applyMode`), in both directions.

**The ladder** is `pure.UNITS`: one unit per depth, whole cycles only, **α β γ δ ε ζ η θ ι κ λ μ ν** (depth 1 … 13; the
Blink ν is the finest, there are no halves and ξ is a level, not a unit). Ticks are the unit boundaries:

| unit | per parent | tick label | notes |
|---|---|---|---|
| α β γ δ ε ζ | catalogue 18 · 5 · 13 · 5 · 5 · 7 | ordinal `ζ#3` (from 1) | the date `α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#5` |
| η | 11 in ζ | count `9η` (from 0) | clock counter |
| θ | 9 in η | count `5θ` | rides along with ι |
| ι | 36 in η | count `17ι` | clock counter (η ι λ read like the header) |
| κ | 5 in ι | count `3κ` | rides along with λ |
| λ | 65 in ι | count `42λ` | clock counter |
| μ | 5 in λ | count `2μ` | rides along with ν |
| ν | 25 in λ | count `12ν` | the Blink |

**What a count is counted inside** (one rule): the atomic cadence ν -25→ λ -65→ ι -36→ η keeps the header clock's counters
(ι inside η 0–35, λ inside ι 0–64, ν inside λ 0–24); the in-between units θ κ μ are counted inside the same parent as the unit
that follows them (θ 0–8 inside η, κ 0–4 inside ι, μ 0–4 inside λ). A count runs on across them: the four ι of `5θ` are
`20ι 21ι 22ι 23ι`. `ruler.per` / `ruler.countedIn` hold the table; the ruler tip says it per step ("Here ι is counted inside
η, from 0 to 35, like the clock in the header").

**Addresses** are written along the main chain α β γ δ ε ζ η ι λ ν exactly like `pure.stamp` (`… · 3η 17ι 21λ`); an
in-between unit is inserted at its place only when it is the tick unit (`… · 3η 5θ`). `ruler.stampText(t, to)` equals
`pure.stamp` for every stamp level (tested). The cursor / now / hover **flag** is the tick unit with the chain unit above and
the one below: ι ticks → `3η 17ι 21λ` (the header), θ → `3η 5θ 17ι`, κ → `17ι 3κ 21λ`, λ and ν → `17ι 21λ 4ν`, ε → `δ#3 · ε#2 · ζ#5`.
The tooltip head runs on two chain units below the tick unit.

**Zoom ladder.** Steps = a whole unit or a multiple m of it (labels every m-th unit of each counting parent while a full step
fits, 2·m ≤ count): ν ×1 ×2 · μ ×1 ×2 · λ ×1 ×2 ×5 · κ ×1 ×2 · ι ×1 ×2 · θ ×1 ×2 ×3 ×4 · η ×1 ×2 ×3 ×5 · ζ ×1 ×2 ×3 ·
ε ×1 ×2 · δ ×1 ×2 · γ ×1 ×2 ×3 ×6 · β ×1 ×2 · α ×1 ×2. Neighbours are at most 2.6 apart, so a plot of 520 px or more
shows **4–12 labelled ticks at every zoom** (including γ and β multiples). The **context row** names the next coarser unit
(`ε#2 · ζ#5` over ζ ticks; `5θ` over ι ticks). Minor (unlabelled) ticks are the next finer unit; the Blink has none, so its
minors are **tenths of a Blink** (`nu/10`, `step.div`). The key in the gutter shows the context unit above and the tick unit
(with its multiple, `ι ×2`) below.

**Presets**: `ν λ ι η ζ ε δ γ β α All`. Each is one unit across **in position** (the status line reads `1η across`); their
titles name the unit ("Show about one Helion (η) across: a depth-7 cycle"). **ν is the deepest zoom**: the narrowest
window (`MIN_SPAN`, a few Blinks across; it reads `1μ 1ν across`), because a single Blink is narrower than the 2 s limit
shared with normal mode. At that scale the ticks are Blinks (6–7 of them, `12ν 13ν …`), the context row is the Somon spans, and
the ticks stay exact (checked against the clock 1 ms after each boundary, also at the catalogue ends).

**Wording** (all in `words.js`; the glossary rule: compact text keeps symbols, names are for prose):
- spans, countdowns, pointers: `ε ends in 1ε 2ζ ▸`, `4η 8θ ago`, status `… · 1η 1θ across`, all counted in every unit with
  zero parts skipped (`pure.duration*`); real-time spans below one Blink are decimals: `0.4ν`, `in 0.32ν`, `<0.001ν`.
  `spanText(t0, t1, parts, slack)` writes the fewest leading parts that come within half a pixel of the window, so a
  window that is a unit across to the pixel reads `1α`, not `1α 5ζ`. `relText` is `now` only within the same millisecond.
- lane heads: letter, `depth n`, and **how many cycles of the next depth make one** (`= 9θ` for η; every lane is itself one
  whole unit, so its length "1η" would only repeat the letter); the tooltip names the unit: "A Helion (η) is one depth-7
  cycle: 11 of them make a ζ. It splits into 9 θ." The plot tooltip adds `lasts 0.14ν` only for a depth finer than the Blink.
- dense lane note: `ε cycles · zoom in`; blocks, eclipses (`#k`), overview labels (`α#n`, `#10`) are unchanged.
- no half units (`[α-ω]½`), no "beat" (real time is Blinks; the scanner flags both as hard leaks).

Verification: `test/timeline.test.js` (the pure section covers the 13-unit ladder, counts per parent, ticks
of every step against the lanes and the clock, the 4–12 label rule, presets, the deepest zoom, wording and tooltips) and
`tools/checks/check-timeline-pure.mjs` (browser: every preset, window edges, drags, keyboard, phone long press, live
switching, leak scan).
