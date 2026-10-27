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

## Pentads (both cards; SPEC §7.5, §15.3)

Every moment leads with its Pentad's mark, like a date with its weekday: the hero's date (or "→ 45η begins"), each row's
day, the strip's time, the tooltips, and the ladder detail's Ends, Started and quarter times (quarters only for cycles
longer than a Pentad: a shorter cycle keeps one Pentad, and four equal marks would be noise). A turnover is read as what
begins there (t + 1 ms). Pure mode marks only readings that count down to the Helion (ζ and finer); majors read in words.
On narrow cards the Pentad takes the weekday's place in the rows ("⬠II 12 Oct 23:02"); wide cards keep both. Labels and
tooltips say the full name ("Pentad II · Mon 12 Oct 2026 23:02 UTC"). Marks come from a cached `pentadLookup`.

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

## Pure mode (revision 3: major periods in words, minor units every other depth, Blinks)
Vocabulary from `src/core/pure.js` and SPEC §15 (see `80-pure.md`); the wording lives in `src/ui/ladder/pure-text.js`
(DOM-free, unit-tested). Nothing here is an Earth unit, a date or a percentage; the depths between the minor units
(ζ θ κ μ) and ξ have no names, and no minor cycle gets a fracton name.

**Ladder rows.**
- *Major* (α β γ δ): the fracton ordinal and the quarter word, `Trifracton End` (the chip completes "Delta"), and a four-pip
  quarter indicator in the glyph column (passed pips filled, the current one lit). A major's phase is never drawn.
- *Minor*: ε by its ordinal (`ε#5`); η by its **number in the Nuclide, 1–77** (`34η`, like the day of a month); ι λ ν by
  their count of completed units from 0 (`29ι`); the depths between and ξ by where they start in their Nuclide
  (`pure.cycleShort`: `34η`, `28ι`, `13λ`, `0ν`, `3.43ν`). The phase is a pair of 2-stroke glyphs, the
  odometer of the cycle at the displayed instant.
- Time left is a span over α β γ δ ε η ι λ ν with at most two non-zero parts (`6ι 43λ`, `43η 6ι`, `1.5ν` under ten Blinks).
  ν and ξ, too fast to count down, show how long one lasts (`1 Blink`, `0.14 Blinks`).

**Detail** of the selected row:
- The end says what begins: "→ Delta Tetrafracton begins", "→ ε#1 begins", "→ 35η begins". The short form is used inside a
  Nuclide, and the Nuclide is named when a new one starts (`ε#1 1η`: 77η is followed by 1η).
- The quarter thresholds are placed by two tokens of the stamp. A Delta is placed to the Helion (`ε#2 20η`), a Helion as
  `34η 9ι`, a Flavon as `21λ 6ν`; ν and finer use the ¼ ½ ¾ column only.
- Phase: a glyph pair for minors, "Quarter: End · 4 of 4" with pips for majors. The sector is the child cycle, said the same
  way: `Delta Trifracton End · 3 of 5` with no pair, or `28ι · 8 of 9` with a pair.
- The cycle is given by name and letter address (`ε#5 34η`, `α#6 β#4 γ#9 δ#3 ε#5 34η`), with "started … ago".
- The length comes from `pure.cycleLength` (`1δ`, `1η`, `11η`, `4ι`, `13λ`, `5ν`, `0.14ν`). Its tooltip explains the cycle:
  "A Helion (η) is 36ι.", "A ζ cycle is 11η, not a unit."
- Actions: "Just before" (end − min(2 s, ¼ cycle), then ×1; `6.43 Blinks`) and "Just after" (1 ms in, `0.00322 Blinks`).

**Up next.**
- The hero names what begins: majors in words with their letter address ("→ Delta Tetrafracton begins", `α#6 β#4 γ#9 δ#4`),
  minors by ordinal or by where they start ("→ ε#3 begins", "→ 45η begins", `α#6 β#4 γ#9 δ#3 ε#5 45η`).
- The hero countdown has up to three non-zero units (`10η 6ι 43λ`). Spans are always counts: `10η` lasts ten Helions,
  while `45η` in a placing is the 45th Helion.
- The hero sentence names a minor by its letter ("ζ ends — 4 finer cycles (η, θ, ι, κ) end with it.") and a major in words,
  in a shorter form that fits one line ("Gamma ends, with 11 finer cycles (δ … ξ).").
- The progress caption shows the glyph pair for a minor turnover and the quarter word for a major one ("Valley quarter").
- The strip of a selected minor level gives the span and where the threshold falls ("next end in 6ι 43λ · at 35η 0ι"). A
  major level's strip says which quarter begins ("→ Valley", "→ Peak"); its tooltip names the turnover in words.
- The legend and the importance tooltips explain the finest counted cycle ("a Delta (δ) is 5ε", "a ζ cycle is 11η, not a
  unit", "a Helion (η) is 36ι").
- The list is grouped by the **Nuclide** an event falls in, the pure "week", with separator lines between groups. Each row
  carries what begins (`56η`, `Delta Tetrafracton`). Wide cards (≥ 640 px) write the short letter date on every row
  (`δ#3 ε#5 56η`). Narrow cards head a group of two or more events with the Nuclide in words (`Delta Trifracton ε#5`); a group
  of one needs no heading.
- Real-time leads are counted in Blinks everywhere.

**Notation:** `X#n` is an ordinal (from 1) and `nX` a count (from 0), except that the Helion of a date or a placing is
numbered from 1 (1η … 77η); `η 7` appears only on chips. Unit names (Nuclide, Helion,
Preon, Flavon, Blink) appear only in prose. Verified by `tools/checks/check-ladder-pure.mjs` (leak scan of every state of both
cards, live switching, behaviour, layout) and `test/ladder.test.js`.
