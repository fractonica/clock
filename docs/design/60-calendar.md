# Modules: calendar + jump  (addition #2 – calendar mapping)

Owns: `src/ui/calendar.js`, `src/ui/calendar/*`, `src/ui/jump.js`, `src/styles/calendar.css`, `test/calendar.test.js`.
CSS prefixes `cal-` and `jump-`. `calendar` mounts into `#view-calendar` (a tab); `jump` into `#slot-jump` (header, `alwaysOn`).

## Goal

"I need to be able to quickly navigate from Fractonica time to Gregorian time and back." Make the mapping both
**explicit** (a precise two-way converter) and **visible** (a Gregorian calendar annotated with Fractonica cycles),
plus a **one-line jump box** in the header so any time, in any notation, is one Enter away. Every result can be
applied (`ctx.goto(t)`), copied and shared (the app supports `?t=` deep links; use `location`-free helpers – main.js owns the link button).

## 1. Jump box (`jump.js`, header)

A single input (placeholder "Jump to…  2031-06-01 · +3d · α6 β3 γ11 · pos 24.5 · sync 4820", `/` key focuses it) with a
dropdown of live interpretations. Parse in a pure, tested function `parseJump(text, {now, zone, model, fmt})` →
list of candidates `{label, time, kind, detail}` (best first, Enter takes the first, ↑/↓ choose, Esc clears):

| Input | Meaning |
|---|---|
| `2031-06-01`, `2031-06-01 14:30[:15]`, `1 Jun 2031 2pm`, `2031-06-01T14:30Z`, with/without offset (no offset = the app zone) | Gregorian instant |
| `1791460800`, `unix 1791460800`, 13-digit ms | Unix seconds / milliseconds |
| `now`, `today`, `tomorrow`, `+3d`, `-2h30m`, `in 2 weeks`, `+1y` | relative to the displayed time |
| `pos 22.9278`, `p22.9278`, `saros 22.9` | Saros position |
| `α#6 β#3 γ#11`, `α6 β3 γ11`, `a6 b3 g11`, `6.3.11`, `ε#5` | start of that cycle (hierarchical path of 1-based ordinals; `ε#5` / `ε 5` = the 5th ε inside the current parent and the answer says so in words; a spaced `ζ 6` also offers the *depth* reading, the running ζ) |
| `d7#717211` | global cycle index at depth 7 (a Greek letter before `#` is always an ordinal) |
| `2031-06-01 14:30 Moscow`, `… Europe/Moscow`, `… Tokyo` | a zone or city after the time overrides the app zone for that input |
| `sync 4820` | start of solar sync n |
| `next ε`, `prev ζ`, `next end of δ`, `next peak η` | next/previous boundary of a level relative to the displayed time |
| `d7 13,0` / `η [13,0]` | next occurrence of that odometer state (`model.stateOccurrences`) |

Input is capped at 200 characters (long pastes must never freeze the page); echoed text in labels is truncated. Slash dates are ranked by `navigator.language`. `next peak` without a level uses the selected depth. Show errors precisely ("outside the catalogue 1613-05-19 … 2857-06-13", "Beta has only 5 cycles in an Alpha"). Remember the
last 8 jumps (localStorage, try/catch) and offer them when the box is focused and empty.

## 2. Converter (`calendar` tab, left half)

Two linked panels in one card; editing either side updates the other. A **pin** toggle: unpinned = follows the displayed
time (live readout of the current moment); pinned = freezes on what the user typed so it can be studied; an "Apply"
button navigates the whole app there (`ctx.goto`), "Use displayed time" reloads.

**Gregorian side**: date input + time input (seconds + ms), zone chip (the app zone; a small select can override it just
for the converter, default UTC ⇄ app zone toggle), Unix seconds field, ISO string, weekday, "day N of year", the offset in
force. Context line: nearest Saros 141 eclipses around the instant (`model.catalogue`, ordinals) and "52.8 y after
eclipse #20 (1973-12-24)".

**Fractonica side** (sub-sections, each editable):
1. *Position*: Saros ordinal + fraction (`22 + 0.927850216635`) and the exact decimal; editable.
2. *Cycle address*: for depth 1…14 (a depth selector, default = the face's deep level) show the chain
   `α 6 › β 4 › γ 9 › δ 3 › ε 5 › …` with a numeric stepper per level (ranges from `levelInfo().siblings`, α up to the catalogue
   count; clipped last cycles respected via `model.pathToCycle`), a "point in cycle" selector (begin, peak, node, valley,
   end, or "now's phase") and the resulting Gregorian instant + cycle length. Stepping a field changes the Gregorian side
   immediately. Mirror of `model.addressAt` for the current time.
3. *Glyph states*: for each depth 1…14, the current glyph (library SVG), digits and meaning ("state 13/16, value −3, rising").
   Clicking a glyph opens a picker of the 16 states of that depth; choose one → "next 3 / previous 3 times this depth shows
   that state" with Gregorian times (`model.stateOccurrences`), each with a go button.
4. *Solar sync*: sync number (editable), phase, start/end instants, nominal civil-day grid time and the drift between them
   (`solarAt`, `solarSyncByNumber`), the sync's time of day, and the four quarter thresholds.

Every output has a small copy button; invalid input is flagged inline without clearing the other side. Round trip
Gregorian → Fractonica → Gregorian must reproduce the instant to ≤ 1 ms (unit-test this).

## 3. Month calendar (`calendar` tab, right half) – the visible mapping

A Gregorian month grid (Monday-first by default, setting in the card header: Mon/Sun) for the app zone. Header: ◀ month year ▶,
"Today", month/year pickers. Each day cell:

- day number; the displayed day ringed; today marked;
- a **cycle band** along the bottom of the cell for the chosen **overlay level** (segmented control: `γ δ ε ζ η` and `Solar sync`;
  default ε): the cycles covering that day drawn as coloured segments, with the **exact boundaries at their time of day**
  (a cycle that starts at 15:20 begins 64 % across the cell). The first segment of each new cycle shows its local number
  (`ε 5`, `ε 6`…); hover shows a tooltip with exact start–end, `local/siblings`, and next threshold; click on a segment → `ctx.goto(its start)`;
- the day number area click → `ctx.goto(that day at the displayed time-of-day)` (clamped to the catalogue); double-click = noon.
- With *Solar sync* overlay the band shows the 4-day sync quarters (peak/node/valley/end, ≈ one day each) with `S4820 · node`
  labels, and the drift of the sync start vs the civil grid in the tooltip.
Below the grid, a **year ribbon**: 12 month segments for the displayed year with δ and ε boundaries as ticks and the displayed
instant marked; click a month → that month; ◀ ▶ by year; a **decade jump** (year select) for far navigation, and a one-line
summary: "Year 2026 contains 4.5 δ cycles (δ 3·2 … δ 3·4), 23 ε cycles".

Layout: desktop two columns (converter left, calendar right); under ~1000 px stacked with a segmented switch
"Converter | Calendar"; mobile friendly (cells ≥ 40 px, 16 px inputs so iOS does not zoom).

## Notes

- DST: day cells are local days; convert day boundaries with `ctx.fmt.toUnix({year,month,day})` (do not add 86400).
- Performance: build the month's boundary lists once per (month, level, zone) with `model.boundaries`; per frame only update
  the "now/displayed" marker and live fields that changed.
- Out-of-range days (before 1613-05-19 / after 2857-06-13) are shown greyed with no band; the converter shows a clear message.
- Pure logic (`parseJump`, month grid builder, converter maths, round trips, DST days) goes to `src/ui/calendar/*.js` with tests.

## Notation (final)

Ordinals carry a hash everywhere this module prints one (`ε#5`, `α#6 › β#4 › γ#9`); a bare `ε 5` is the depth chip used by
the ladder, Up next, rings and timeline. Percentages are floored and capped at 99.9 before a cycle ends. A wall time that does
not exist (DST gap) or happens twice (fold) is flagged inline with the same sentence in the jump box and the converter.

## Pure mode (revision 3: major periods in words, minor units by counts)

The vocabulary is **SPEC §15** (see also `80-pure.md`). Major (ultrahelion) periods α Alpha, β Beta, γ Gamma, δ Delta are
said in **words** with a fracton ordinal and a **quarter word** ("Delta Trifracton Node"; the quarter is named by the
threshold that ends it: Peak, Node, Valley, End) and never get a phase pair. The minor (infrahelion) units skip every
other depth: ε Nuclide (ordinal `ε#1–5` in its Delta), η Helion (count 0–76 in the Nuclide), ι Preon (0–35), λ Flavon (0–64),
ν Blink (0–24). ζ θ κ μ are depths, not units: a ζ is 11η, a θ 4ι, a κ 13λ, a μ 5ν. Notation: `X#n` is an ordinal from 1,
`nX` a count from 0, `η 7` only a depth chip. The stamp is the full letter form `α#6 β#4 γ#9 δ#3 ε#5 33η 29ι 21λ 3ν`.

The tab becomes a pure converter (`pure-converter.js`) and a pure month page (`pure-month.js`). The jump box
(`pure-parse.js`) speaks Fractonica only. Pure maths (dates ⇄ moments, counters, page geometry, landings) is
`pure-conv.js`; nothing here prints a Gregorian date, a zone, an Earth unit, a percentage, "beat", a half-cycle symbol, a
retired unit name or a fracton name below the Delta (`node tools/checks/check-pure-leaks.mjs calendar`: 0 hard leaks).

### Dates and entries (`pure-conv.js`)
`resolveParts` reads any tail of a date, the periods above its first entry taken from the shown moment, and lands on the
**first millisecond** that shows the finest entry. Counts alone ("33η 17ι") are read in the shown Nuclide. A quarter word
on a major period is checked against the rest of the date and only has to meet it somewhere: "Delta Trifracton Node ε#2" is
the part of ε#2 that lies in the Node quarter (so every short date the header prints reads back, even in a Nuclide that
straddles two quarters); on the finest entry it is the start of that quarter ("Delta Trifracton Node" = the Delta's peak,
`ε#2 19η 9ι`). A quarter word that does not meet the date is answered with the quarter it does lie in. The converter edits
the four majors by fracton name (a select each, with the quarter word beside it), the Nuclide `ε#` and the counts η ι λ ν in
place (the odometer way: what is finer keeps its place).

### The Delta page (`pure-conv.js` geometry, `pure-month.js` view)
* One page = one **Delta** = **5 Nuclide rows (ε#1–5) × 7 columns of 11 Helions** (the ζ cycles, labelled by their first
  Helion count `0η 11η 22η … 66η`, never `ζ#`); page index = the global Delta index (`viewCount` 5607). Header: the page in
  words "Gamma Nonafracton · Delta Trifracton" with the letters `α#6 β#4 γ#9 δ#3` under it; ◀ ▶ step by Delta (1 page),
  Gamma (5), Beta (65) or Alpha (325); selects of the four fracton names; "Now", "Shown cell"; PageUp/PageDown the same cell
  of the next page (Shift: a Gamma).
* A cell holds 11 Helions: its band shows them at their exact position with their counts in the Nuclide (every fifth
  labelled where the cell is narrow), the node mark of each (18ι of 36), the solar sync quarters (gold diamonds). Band
  choices: δ (the Delta's quarters), ε (the Nuclide rows), η (the Helions; default); the choice is the app-wide selected level.
* **Delta quarters**: a quarter is 8¾ cells; Peak Node Valley End begin at 0, 1¼, 2½ and 3¾ Nuclides (`ε#2 19η 9ι`,
  `ε#3 38η 18ι`, `ε#4 57η 27ι`). A **quarter bar** above the grid shows the four quarters (the current one marked, a click
  goes to where it begins) with the five Nuclides under it; inside the grid a line in the Delta colour marks each threshold.
* **Eclipses** sit at the integer positions k = k × 2843.75 cells: one falls at 0, ¼, ½ or ¾ of its cell (k mod 4 = 0, 1,
  2, 3 gives 0, ¾, ½, ¼); the cell shows `#k`, the eclipse icon and a gold hairline at that fraction.
* Cell tooltip: `ε#5 · 33η–43η`, the Delta quarter(s), the stamp, the Nuclide phase pair at the start, countdown, eclipse
  and sync facts. Inspector of the shown cell: the Helions (3-column grid), or the Nuclide, or the Delta quarters, with go
  buttons and countdowns, and the sync quarters. Ribbon: the **5 Deltas of the Gamma** (fracton names, `δ#n` on a phone)
  with the Nuclide rhythm (4 inner ticks per Delta) and the shown position.

### Converter (`pure-converter.js`)
Moment: the Helion reading (`33η ‹pair› 29ι 21λ 3ν`), the full date in words, chips of the majors with their quarter and the
Nuclide, the stamp field (reads every date form, counts and offsets), the majors by name, `ε#` and η ι λ ν, the eclipses
around it. Cycles: position; cycle address (α β γ δ ε numbered, a finer cycle placed by its counts in its Nuclide with a ±
stepper, the result in letters and in words); the phase at every depth (α–δ: their quarter word, no pair and no bar; every
other depth: its glyph pair with the "when does it show this pair" picker); the solar sync (19 Helions).

### Jump grammar (`pure-parse.js`)
| Input | Meaning |
|---|---|
| `Alpha Hexafracton Valley, …, Delta Trifracton End, ε#5 33η 29ι 21λ 3ν`, `Delta Trifracton End ε#5 33η 29ι` | dates in words, full or short |
| `α#6 β#4 γ#9 δ#3 ε#5 33η 29ι 21λ 3ν`, `δ#3 ε#5 33η 29ι`, `a6 b4 g9`, `6.4.9` | dates in letters (the stamp), or any tail |
| `Gamma Difracton`, `Delta Trifracton`, `Delta Trifracton Node`, `ε#2 5η`, `33η 17ι` | partial names, a quarter start, the Nuclide and counts, counts alone |
| `+2ε 5η`, `-3ι`, `in 5λ`, `3η ago`, `+0.5ν`, `+4 Blinks`, `+2 Nuclides 5 Helions` | offsets over α β γ δ ε η ι λ ν (decimals below ten Blinks) |
| `next Helion`, `next Delta`, `next Delta node`, `next node of Delta`, `next peak η`, `next ζ`, `Helion` | boundaries by letter, level or unit name (ζ θ κ μ stay boundaries of their depth) |
| `pos 22.9`, `sync 4820 node`, `η [13,0]`, `d7#717211`, `now` | position, sync, glyph state (not for α–δ), global index, live clock |

Unit names Delta, Nuclide, Helion, Preon, Flavon, Blink (and Alpha, Beta, Gamma) are read wherever a unit letter is. Old forms
get one short pointer whose text passes the scanner: half-cycle units, the depths ζ θ κ μ used as units (`+2ζ` → "a ζ is 11η:
write +22η", `ζ#5` → "begins at 44η of its Nuclide"), the retired unit names (never echoed), fracton names below the Delta
("Only Alpha, Beta, Gamma and Delta have fracton names"; `Epsilon Trifracton` → `ε#3`), the retired word for a real-time
tick. Gregorian input is answered with "Dates and clock times are off in pure mode".

### Soft leaks kept on purpose
The words "Saros" and "eclipse" (the clock's base unit and the numbered eclipses `#22`) and 4-digit sync numbers (`S4820`)
that look like years to the scanner.

### Tests and checks
`test/calendar.test.js` (pure section: ranges, entries, every date form read back at the first millisecond, quarter words,
the 35 cells and the quarter thresholds of a page, eclipse fractions for all 69 eclipses, ribbon, unit names, decimal Blinks,
pointers for old forms, scanner rules over many inputs), `tools/checks/check-calendar-pure.mjs` (leak scan of the tab,
tooltips, typed errors, majors and counts, picker, quarter bar, page navigation, jump box, live switching both ways).
