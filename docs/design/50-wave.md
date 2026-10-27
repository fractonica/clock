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

## Solar wave and pure mode (revision 3: major periods in words, minor ones in counts; SPEC §15)
See docs/design/80-pure.md. Files: `src/ui/wave/solar.js` (geometry/phase), `sun.js` (dial), `words.js` (wording incl. pure). "Half-arc" is
the view's own geometry (a cycle is a crest followed by a trough), not a unit.

- **Major arcs (α β γ δ)**: the cycle in words (`closing half of Delta Trifracton · 3 of 5 in γ`); the read-out shows the quarter word of the
  cycle (`End`, "quarter of this δ cycle") where a minor arc shows its two pairs; tooltips and the depth button say `now in its End quarter`.
- **Minor arcs**: placed by where their cycle starts (`closing half of ε#5 34η`, the 34th Helion of ε#5: Helions are numbered from 1), half-arc and cycle phases as glyph pairs.
- Addresses are the stamp of the cycle's start (`α#6 β#4 γ#9 δ#3 ε#5 34η`), the time next to the focus marker three consecutive tokens of the
  stamp (`δ#3 ε#5 34η`, `34η 29ι 21λ`); spans are the core's (`ends in 6ι 43λ`, a half-arc `18ι long`); depth buttons say what one cycle is
  (`1η (Helion) = 36ι`, `11η`).
- Eclipse labels are `#k` like the position; drift reads `drift −6 236λ`; the solar texts are unchanged (`19η`, 19 Helions).

## Pentads (SPEC §7.5, §15.3)
A date leads with its Pentad like a weekday (`src/ui/pentad.js`: the shape mark – a pentagon with its numeral, the Hypopentad's
square alone – in DOM and on the canvas). Files: `words.js` (which readings lead), `tooltip.js` (`spanHTML`, `ledHTML`), `draw.js`
(`ledText`, the rail), `sun.js` (the band), `solar.js` (`pentadPhase`, `pentadSpans`, `dialPentads`).

- **Readings**: the read-out's span and the tooltip's span lead each end with its Pentad (the end only when it is another one); the
  hovered point's time and the label of the displayed time on the canvas lead with theirs (`⬠II 12:00:00`). Pure mode leads a reading
  that counts down to the Helion: a Helion or finer half-arc in the short letter form (`⬠II δ#3 ε#5 34η`; a ζ, ε or major cycle spans
  several Pentads and keeps its address alone), the label of the displayed time from the δ stage down (`⬠II ε#5 34η 29ι`).
- **Solar mode**: the dial has a band of the sync's four Pentads under its wave (5η, 5η, 5η and the shorter Hypopentad of 4η), each
  starting just after a quarter point – the quarters fall a solar day apart (4¾η), so the Pentads start ¼, ½, ¾ Helion later in the day
  and the Hypopentad ends on the sync's end. The running Pentad is lit and named in the header (`⬠II·2`: Pentad II, its 2nd Helion);
  the tooltip says it in words (pure: "4¾η is a solar day", no hours). On the stage a rail of the sync's Pentads rides just outside the
  ripple (gaps where each starts; the running one bright), with its marks where they have room, clear of the pin and the quarter names.
