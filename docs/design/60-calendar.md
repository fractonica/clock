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

## Pure mode
The tab becomes a pure converter (`pure-converter.js`: position ⇄ names ⇄ address ⇄ stamp ⇄ glyph states ⇄ sync) and a pure month page
(`pure-month.js`: one δ½ as 5 rows × 7 cells with η/ι ticks, sync quarters, eclipse `#k` and sync `S<n>` labels). The jump box
(`pure-parse.js`) takes names (`Gamma Difracton`), addresses (`α#6 β#4`), stamps (`ζ½#6 · 5η`), `pos`, `sync`, `next/prev`, glyph
states, offsets (`+2ζ½ 3η`); old spellings (`δ½ 3`, `η 5`) still read; Gregorian input gets a pointer. Share links are `?pos=`
with 12 decimals. Parsing helpers: `src/ui/calendar/pure-conv.js` (stamp ⇄ moment, counters, spans).
