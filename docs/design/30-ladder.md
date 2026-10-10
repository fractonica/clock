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

## Pure mode
Rows: counter (`5 / 11`), countdown (`in 6ι 43λ`), glyph pair instead of a percentage; detail: names, exact length
(`pure.cycleLength`), quarter offsets as countdowns and counters. Up next: hero `in 1ζ½ 4η 24ι · → Zeta Pentafracton begins`,
list rows with the name of the cycle that begins and, on wide cards, the date counters `δ½#6 · ε½#5 · ζ½#4`. Wording lives in
`src/ui/ladder/pure-text.js`. Actions: "Just before" (end − min(2 beats… of the cycle) at ×1) and "Just after" (1 ms in).
