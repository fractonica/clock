# Module: wave  (visualisation #1 – the library's circular geometry)

Owns: `src/ui/wave.js`, `src/ui/wave/*`, `src/styles/wave.css`, `test/wave.test.js`.  CSS prefix `wave-`.
Mounts into `#view-wave` (a tab).

## Goal

The library has its own picture of the clock: the **harmonic wave geometry**. A level-L cycle is two half-cycle
arcs (a semicircle up, a semicircle down, i.e. the wave's crest and trough); each half-arc is divided into
`factor` child half-arcs that are circles tangent to the parent, alternating curvature, exactly like epicycles.
`clock.arc(level, halfArcIndex, {root:'wave'|'ring', relativeTo})` returns `{center, radius, start, sweep, level, index}`
(angles in radians) and `clock.compose(ctx2d, {...})` draws a whole stack of them. Study, in `fractonica.js`:
`child()`, `arc()`, `compose()` (≈ lines 1950–2190) and the header comment's GEOMETRY section.

Build an interactive, beautiful **"you are here" map** in that geometry:

- At the coarsest zoom, the whole Saros 141 wave (35 half-arcs at level 0, ~1613→2857) with the current α half-arc
  highlighted and a bright marker at the current position (the point on the arc at the half-cycle's progress).
- A **focus level** control (slider/segmented, depth 1…10): the view zooms (animated, ease-out ~400 ms; instant under
  reduced motion) onto the half-arc of that level containing the displayed time, rebased with
  `relativeTo:{level,index}` so deep zooms keep float precision (the library explains this). Show the level's arc
  plus its children (`factor` child arcs) and grandchildren faintly, like the library's `view()` in `createArcCalendar`.
- **One marker per level** on its own arc (the point at its progress) joined by thin tethers from the focused arc
  outward, coloured by `theme.levelColor(L)`, so you see the nested positions at once; the marker of the focus
  level is emphasised. A moving dot should visibly orbit when time-lapse is on.
- Current arc segments drawn bright up to the position ("travelled" vs "remaining" in dim), child arcs labelled
  `1…factor` with the current one highlighted; on hover a tooltip: Gregorian start–end (zone aware via `ctx.fmt`),
  duration, "starts/ends in …", the glyph state at that point.
- Click a child arc → `ctx.goto(its start + 0.001)`; click on the focused arc at a point → time at that progress.
  Pan/zoom by wheel changes the focus level (zoom in = deeper) and drag pans within the focused geometry only if you
  support it cleanly; the focus-level control is the primary control. Buttons "◀ ▶ previous / next half-arc" step
  (`ctx.goto` to neighbouring half-arc boundary).
- Level selection is shared (`store.state.selectedLevel`): choosing the focus level here selects it; selecting elsewhere
  focuses here.
- A small caption explains the picture in one sentence and the legend (crest/trough = positive/negative half-cycle,
  `+n` signed index like the library's calendar).

## Rendering

Canvas 2D, HiDPI, `ResizeObserver`. Fit the focused geometry to the canvas with ~10 % margin (compute bounds by
sampling the arcs, as `createArcCalendar.svg` does). Cap work (the library's `maxArcs` idea); numbers only, no BigInt
in the draw loop (compute arc lists when the focus arc changes, markers per frame from phases). Out of range: show the
whole-catalogue wave greyed with an explanatory line. Keep the dark palette (`var(--bg-2)` panel) and avoid the library's
green `#0d1b14` background; you may call `clock.compose` for a quick overview if it fits, but own rendering is preferred.

Add pure geometry helpers (point on arc, bounds, per-level markers) in `src/ui/wave/geometry.js` and test them,
including that the marker of level L lies on the arc of its half-cycle at progress = phase of the half-cycle.
