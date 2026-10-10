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

## Pure mode
The Gregorian axis becomes a **pure ruler** (`src/ui/timeline/ruler.js`, `words.js`, `tips.js`): ticks at unit boundaries of the
ladder α β γ δ½ ε½ ζ½ η ι λ μ ν ξ with 4–12 labelled ticks at every zoom; ordinal ticks `ζ½#3`, count ticks `9η`, `17ι`; a context row
names the larger unit (`ε½#4 · ζ½#6`). Eclipses are numbered `#k` like the position (`#0 … #69`); the overview is labelled with
them; hover tooltips give the stamp, `pos` and the cycle names; the status line measures the span in position.
