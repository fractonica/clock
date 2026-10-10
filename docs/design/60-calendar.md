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

## Pure mode (revision 2: whole cycles, named units, Blinks)

Owner decision, see the REVISION 2 block of `80-pure.md`: the half-cycle units δ½ ε½ ζ½ are gone, the ladder is one unit per
depth (α β γ δ ε ζ η θ ι κ λ μ ν; ids `alpha … nu`, names Atom δ, Nuclide ε, Hadron ζ, Helion η, Quark θ, Preon ι, Chromon κ,
Flavon λ, Somon μ, Blink ν; α β γ have no particle name), γ = 5δ, δ = 5ε, ε = 7ζ, ζ = 11η. Compact text keeps the Greek
symbols (`+2ζ 3η`, `6ι 43λ`); unit names are for prose (legend, tooltips that explain a unit, examples). Notation: `X#n` is an
ordinal from 1, `nX` a count from 0, `η 7` only a depth chip.

The tab becomes a pure converter (`pure-converter.js`: position ⇄ names ⇄ address ⇄ stamp ⇄ glyph pairs ⇄ sync) and a pure
month page (`pure-month.js`). The jump box (`pure-parse.js`) speaks Fractonica only. Pure maths (stamps, counters, page
geometry, landings) is `pure-conv.js`; nothing here prints a Gregorian date, a zone, an Earth unit, a percentage or the word
"beat" (the leak scanner, `node tools/checks/check-pure-leaks.mjs calendar`, must report 0 hard leaks).

### Stamp and counters
`α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#5 · 3η 17ι 21λ`: six ordinals (α 1–18, β 1–5, γ 1–13, δ 1–5, ε 1–5, ζ 1–7) and three counters
(η 0–10, ι 0–35, λ 0–64) that count inside the **ζ cycle** (a whole cycle of 11 η). There is no "straddling" η any more: a
stamp always names exactly one first millisecond, `resolveParts` reads it back with an exact landing, and `3η 17ι` alone is
read inside the ζ of the shown moment. The converter edits the six entries `δ# ε# ζ#` · `η ι λ` in place (the odometer way:
what is finer keeps its place) and every field funnels through one moment `T`.

### The δ page (`pure-conv.js` geometry, `pure-month.js` view)
* One page = one **δ cycle** (an Atom) = **5 rows (ε) × 7 columns (ζ) = 35 ζ cells**; page index = the global δ cycle index
  (`viewCount` = 5607). Header ◀ ▶ step by δ (1 page), γ (5), β (65 = 13 γ) or α (325 = 5 β); PageUp/PageDown the same cell
  of the next page (Shift: a γ); selects for α β γ δ; "Now", "Shown cell".
* A cell is a whole ζ: number 1–35, row `ε#`, column `ζ#`. The band at its foot carries the **11 η** at their exact
  fractional position with the counter 0–10 (every one when the cell is wide, 0 2 4 6 8 10 or 0 5 10 as it narrows, by a
  container query), the node mark (18ι of 36) of each η, the solar sync quarters (gold diamonds) and, for the δ ε ζ band
  levels, one segment per cell (a δ is 35 cells, an ε 7, a ζ 1). The shown moment is a cursor; the live clock marks its cell.
* **Eclipses** sit at the integer positions k, which is k × 2843.75 ζ cells, so one falls at 0, ¼, ½ or ¾ of its cell
  (k mod 4 = 0, 1, 2, 3 gives 0, ¾, ½, ¼). The cell shows `#k` in its corner, the eclipse icon and a gold hairline at that
  fraction; one page in about 81 has one.
* Cell tooltip: stamp, name (`Zeta Pentafracton`), the ε phase at the start as a glyph pair, countdown, eclipse and sync facts.
  Inspector of the shown cell: the cycles of the band level with go buttons (the 11 η in a 3-column grid) and the sync
  quarters. Ribbon: the **5 δ of the γ** with the ε rhythm (4 inner ticks per δ) and the shown position.

### Jump grammar (`pure-parse.js`)
| Input | Meaning |
|---|---|
| `Gamma Difracton`, `α#6 β#4 γ#9`, `δ#3 · ε#2 · ζ#5`, `6.4.9`, `d7#717211` | cycle by name / address (ancestors from the shown moment); a date as the header prints it |
| `α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#5 · 3η 17ι 21λ`, `ζ#5 · 3η`, `3η 17ι 21λ` | stamp or any tail of it; the first millisecond that shows the finest entry |
| `+2ζ 3η`, `-1ι`, `in 5λ`, `3η ago`, `+0.5ν`, `+4 Blinks`, `+2 Hadrons 3 Helions` | offsets in **any unit α … ν**, decimals allowed; below one Blink a decimal (`0.14ν`; a ξ cycle is 0.14ν) |
| `next ε`, `prev ζ`, `next Helion`, `next peak η`, `next 3 Atoms`, `Helion` | boundaries by letter, level name or unit name |
| `pos 22.9`, `sync 4820 node`, `η [13,0]`, `now` | position, sync, glyph state, live clock |

Unit names are aliases wherever a unit letter is read (offsets, boundaries, a lone unit, glyph states) and are *not* cycle names:
"Gamma Difracton" is the 2nd γ in its β, "a Helion" is the unit of length one η. Old half spellings (`δ½ 3`, `ζ½`, `next ζ½`,
`delta half 3`) are answered with one short pointer ("Half-cycle units are gone: write δ, ε or ζ", detail names Atom,
Nuclide, Hadron; the text itself never prints a half). The retired word for a real-time tick gets the same kind of pointer
to Blinks; Gregorian input ("2031-06-01", "+3d", a city) is answered with "Dates and clock times are off in pure mode".
Old spellings without halves (`δ 3 · ε 2 · ζ 5`, `η 5`, `ι 17`) and the header clock (`3η17ι21λ`) are still read. `ν` counts are
spans, never clock entries (the clock is η ι λ).

### Soft leaks kept on purpose
The word "Saros" and "eclipse" (the clock's own base unit and the numbered eclipses `#22`), 4-digit sync numbers (`S4820`) that
look like years to the scanner.

### Tests and checks
`test/calendar.test.js` (pure section: ranges, counters, stamps with no straddle, 35 cells / 5 pages per γ, eclipse
fractions for all 69 eclipses, unit names, decimal Blinks, half pointer, leak rules over many inputs),
`tools/checks/check-calendar-pure.mjs` (leak scan of the tab, tooltips, typed errors, picker, page navigation, jump box,
live switching both ways).
