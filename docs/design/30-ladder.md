# Modules: ladder + upnext  (visualisation #1, right-hand column)

Owns: `src/ui/ladder.js`, `src/ui/upnext.js`, `src/ui/ladder/*`, `src/styles/ladder.css`, `test/ladder.test.js`.
CSS prefixes `ladder-` and `upnext-`. Two modules, one stylesheet. Mount into `#slot-ladder` and `#slot-upnext`
(cards in the right column, both `alwaysOn: true`). They are visible on every tab, so they are the app's constant
"status board".

## ladder – the level ladder

One row per depth in `store.state.minDepth … maxDepth` (default 1…10; a "more levels" disclosure can extend to 14).
Each row (use `frame.level(L)`):

- level chip: colour `theme.levelColor(L)`, Greek letter, depth number (`η 7`);
- counter `local / siblings` (e.g. `5 / 11`; α shows `cycle 6 of 18`);
- a **segmented progress bar**: `factor` segments (the child cycles), segments before the current one filled, the
  current one partly filled by the exact sub-phase – so the bar reads as "3rd of 5 sectors, 40 % through it";
  quarter notches optional on the selected row;
- time left to the end of the cycle (`ctx.fmt.duration(levelAt().remaining)`, ticking, tabular numerals) and, on
  hover/selection, the end's Gregorian date/time in the current zone;
- the level's 2-stroke phase glyph at the right (small, library SVG, cached by `index`+`dotted`, only re-inserted on change).

Interaction: click a row → `ctx.select(L)` (selection is shared: rings, timeline and wave follow it). Double-click or a
"Just after" button → jump 1 ms into the next cycle (`ctx.goto(end + 0.001)`); "Just before" → `end − min(2 s, ¼ of the cycle)` and play at ×1 so the turnover can be watched. The selected row expands to show its four quarter
thresholds with times (passed ones muted) and the cycle's start/end/duration and Saros-position span. Keyboard: the list is
a `listbox` (↑/↓ select, Enter = go to next boundary). Rows below ~0.3 s period show the bar but no ticking countdown.
Header of the card: title "Cycle ladder" and the depth-range control (`store.set({minDepth,maxDepth})`).
Out of range: rows disabled with a one-line message.

## upnext – what turns over next ("estimate the next major cycle")

Source: `model.upcomingEnds(t, {fromLevel, toLevel, count, perLevel})`. Remember: when a cycle at level L ends, every
deeper cycle ends at that instant too, so each event has a `top` (coarsest level that rolls over) and `levels[]`.
Show the next ~8 events whose `top ≤ importance`, where **importance** is a segmented control the user picks:
"α–γ", "α–δ", "α–ε", "α–ζ", "α–η" (default α–ζ; persist it in localStorage under your own key, wrapped in try/catch).

- **Hero** (first event): large "Next major turnover" – badge with the coarsest level that rolls over (`ε 5`),
  countdown ("in 2 d 03 h 11 min", live), Gregorian date/time with weekday, and a sentence like
  "ε 5 ends — 4 finer cycles (ζ, η, θ, ι) end with it". A thin progress bar from the previous turnover of that level.
- **List** below: remaining events as compact rows: badge, "in 6 d 12 h", `Sun 18 Oct 03:41`, `+3 finer`. A subtle
  separator when the date changes. Click a row → `ctx.goto(time + 0.001)` (travel to the moment *after* the turnover);
  a second small button on each row "Just before" → `goto(time − min(2 s, ¼ cycle))` and play at ×1 so the user can watch it happen. Every row also shows the floored percent through the cycle.
- Also list the **next quarter threshold of the selected level** (peak/node/valley/end) as a one-line strip above the list.
- Recompute the event list at most 4×/s or when `t` jumps; update countdown text every frame only if the string changed.
  When a displayed event passes (live or time-lapse), animate the list shifting up with a brief highlight
  (skip animation under reduced-motion).
- Out of range or no further events before the catalogue end: say "No further turnovers of this size before the
  catalogue ends (2857-06-13)".

Both cards must look good in the 340 px column and when the layout puts them side by side at ~600 px (≤1320 px
viewports) or full-width on mobile.

## Pure mode (revision 2: whole cycles, one unit per depth, Blinks)
Vocabulary comes from `src/core/pure.js` (see the REVISION 2 block of `80-pure.md`); wording lives in
`src/ui/ladder/pure-text.js` (DOM-free, unit-tested). Nothing here is an Earth unit, a date or a percentage, and there are
no half-cycle units: every depth is one unit (α β γ δ Atom, ε Nuclide, ζ Hadron, η Helion, θ Quark, ι Preon, κ Chromon,
λ Flavon, μ Somon, ν Blink); finer than a Blink is a decimal of it (`0.14ν`).

**Ladder rows**: chip (`η 7`), the ordinal name of the cycle (`Monofracton`), time left counted in units with at most two
non-zero parts (`1θ 2ι`, `10η 1θ`, `1.5ν` under five Blinks), the phase as a pair of 2-stroke glyphs (256 states, the odometer
of the cycle at the displayed instant, rewritten whenever its state changes). Cycles too fast to count down (ν, ξ) show how
long one lasts in Blinks with two significant digits (`1 Blink`, `0.14 Blinks`) and keep the quarter column as `+0.036 Blinks`.
**Detail** of the selected row: the end as "→ Eta Difracton begins", the quarter thresholds as their two finest counters
(`0η 9ι`, `ζ#4 · 2η`; completed units counted from 0) with the time to go, phase and sector as glyph pairs, the cycle's name
and address chain, "started … ago", the length from `pure.cycleLength(level)` (always `1X`, `0.14ν` at depth 14; its tooltip
explains the unit, "An Atom (δ) is 5ε."), and the position span. Actions: "Just before" (end − min(2 s, ¼ of the cycle), then ×1; the
lead reads `6.43 Blinks`) and "Just after" (1 ms in, `0.00322 Blinks`).

**Up next**: hero `in 10η 1θ 2ι` (at most three non-zero units, zero parts skipped by the core), "→ Zeta Pentafracton begins" with
its address chain, the finer-cycle sentence in letters, the phase pair. The legend says what the finest counted cycle holds
(`Counting α–ζ turnovers · a Hadron (ζ) is 11η`; every cycle is one unit, so its length would just repeat its name). The list is
grouped by the **ζ (one Hadron)** an event falls in, the pure "day": separator lines between groups, the name of the cycle that
begins on every row, the date counters `δ#6 · ε#5 · ζ#4` on every row of a wide card (≥ 640 px) and, on narrow cards, as the
heading of a group of two or more events (a group of one needs none). Real-time leads are counted in Blinks everywhere.

Notation: `X#n` ordinal (from 1), `nX` count (from 0), `η 7` only on chips; unit names appear only in prose (tooltips,
legends, hints). Verified by `tools/checks/check-ladder-pure.mjs` (leak scan of every state of both cards, live switching,
behaviour, layout) and `test/ladder.test.js`.
