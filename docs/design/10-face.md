# Module: clock face  (`face`)

Owns: `src/ui/face.js`, `src/ui/face/*`, `src/styles/face.css`, `test/face.test.js`.  CSS prefix `face-`.
Mounts into `#slot-face` (a tall card in the left column, `alwaysOn: true`).

## Goal

The spec's own display (SPEC §8–§10): the Zepp watch face rebuilt as an inline **SVG**, faithful to the spec's
arrangement and numbers, scaled to fill its card, plus a few web affordances that make it readable to a newcomer.
This is the "reference clock" of the app; the other views explain and navigate it.

## The journal face (default; `src/ui/face/journal.js`)

Owner request: *"make it easier to navigate the journal: the middle shows 72η 24ι 62λ (a triplet of odd periods with
letters, by the selected depth); the top a double 2-stroke glyph with the phase of the period above the longest one
shown (ζ for 72η 24ι 62λ); the bottom 2 alternating arcs for the cycle of the middle's longest unit with a tick at its
position – left arc descending, right ascending; tap the top to go one level up, the bottom to go down; from the Delta
up, explicit words like 5th Delta Trifracton End, each on its own line with a 3-stroke glyph of its phase below."*
Owner's choices: the journal face is the default and the watch face stays one toggle away; "5th" is the Nuclide of the
Delta; a tap moves one named unit; the major mode shows three lines.

- Units (long to short): α β γ δ ε η ι λ ν; `store.state.journalUnit` 0 … 6 is the first one shown (6: ι λ ν).
- Middle, minor: "34η 29ι 21λ", "ε#05 34η 29ι", "29ι 21λ 03ν" – every count in two digits (owner: *"use 00 00 00 so the
  font size doesn't change"*), one fixed size for all minor readings; the numbers white, the letters in their level colours.
- Major periods (α β γ δ, owner's follow-up: *"one major period at a time, only its own: a big 3-stroke glyph on top,
  text in the middle (4 lines), its arc cycle at the bottom"*): the period's phase as one big 3-stroke glyph (52
  states) at the top; four lines – the ordinal of its current child, its name, its fracton word, its quarter ("5th /
  Delta / Trifracton / End": the 5th Nuclide of Delta Trifracton, in its End quarter; "3rd / Gamma / Nonafracton /
  Valley": its 3rd Delta); its own cycle at the bottom.
- Top (minor units; owner's follow-up: *"the top glyphs and the bottom arc show the same phase, that of the middle's
  most significant reading"*): the longest unit's phase (256 states, `pure.pair`) – η for "34η 29ι 21λ", ε for "ε#5 34η 29ι". Bottom: the same unit's cycle as two half-arcs, the left one below the axis (descending), the
  right one above (ascending), dots at the quarter thresholds and a white tick at the present phase.
- Taps: top third one unit up (longer), bottom third down; ↑ ↓ on the focused face; the Longer / Shorter buttons; the
  unit's level becomes the selected level of the other views. The "Watch" button switches to the SPEC face below
  (`store.state.faceMode`, `?face=watch|journal`, `?unit=0…6`).

## Spec-faithful screen (logical size 192 × 490 px, pill-shaped, corner radius 96)

Draw one `<svg viewBox="0 0 192 490">` (preserveAspectRatio meet, centred in the card). Inside, **1 design unit = 10 px**
(SPEC §9.2, u = 10, 3 px ink). Screen background near black with a subtle bezel/rim so it reads as a device.

| Element | Spec |
|---|---|
| Top period odometer | depth `D = store.state.topDepth` (default 7, level D−1): 2 glyphs of 2 strokes, `model.odometerAt(t, level, {strokes:2, digits:2})`, left = coarse, right = sub; stems 80 px apart; centre y = −165 px from the screen centre; teal `#4FD1C5` |
| Bottom period odometer | depth D+1 (level D), same layout, y = +165 px |
| Sibling counters | `siblings(L)` dots lit for local indices 0..local(L) (`levelAt().local / .siblings`; for α use no counter). Dots on an arc concentric with the rounded screen end: top arc for the top period, bottom arc for the bottom one; radius `width/2 − 10` = 86 px, 11.5° step, spread symmetrically about the vertical axis, read left→right. Lit = teal, unlit = dim outline |
| Solar odometer | centre of the screen, **gold `#FFD60A`**: `model.solarAt(t).digits3` = 3 glyphs of 2 strokes, stems 64 px apart (a 192 px width fits no more) |
| Period letters | Greek names (`levelInfo(L).letter`) of the two displayed periods, in the gaps beside the solar odometer at ±90 px; shown for ~4 s after a depth change, or permanently when `store.state.showLetters` |
| Info labels | on request for ~4 s, replacing the letters: next threshold of the top period (`levelAt().next`), next solar threshold (`solarAt().threshold`), sync time (local clock time of `solarAt().start`). Format per SPEC §8: local time with seconds, or `Mon D HH:MM` when on another day – `ctx.fmt.label(time, frame.t)` |

Glyph drawing: compose the library's own geometry. `F.CBT.geometry(F.CBT.fromIndex(index, {depth: 2}), {scale: 10,
thickness: 0.3})` gives `.path` (one path string in design units), `.dot` (the falling-branch dot, or null) and
`.bounds`; or build with `glyph.toSVG(style)`. Stroke caps/joins round, ink 0.3 units. Trit 0 = bar, +1 = curve down-right,
−1 = curve up-left; the least significant trit is at the top; the dot marks the falling branch (SPEC §4, §9).
Update only glyph groups whose digits changed (compare a signature string per odometer) – no per-frame DOM churn.

## Interaction (SPEC §10) – in the web build

- Tap/click the **top** region → longer period (`topDepth − 1`); the **bottom** region → shorter (`topDepth + 1`);
  clamp to **2…11** and persist through `store.set({topDepth})`. Brief letters appear after each change.
- Single tap in the **middle** → info labels for ~4 s. Double tap (two taps within 400 ms) toggles persistent letters
  (`store.set({showLetters})`). Pointer events (works for mouse and touch); no accidental text selection.
- Keyboard: the face is focusable; ↑/↓ change depth, `i` shows info, `l` toggles letters. Below the pill (outside the
  SVG) add four small accessible buttons mirroring the gestures (Longer ▲ / Shorter ▼ / Info ⓘ / Letters Aa).
- Hovering (or focusing) a glyph row shows a tooltip that teaches: "η · depth 7 — state 13 of 16: value −3, rising (↗)
  — next change 12:01:15" and clicking a row selects that level (`ctx.select(level)`), which highlights it across the
  app; give the selected row a subtle accent. Solar odometer tooltip: sync number, phase %, drift, next quarter.
- A compact "How to read" popover (button in the card footer): glyph = phase of the cycle (value −M…+M), dot = falling,
  counter dots = which of the sibling cycles we are in, yellow = 4-day solar sync. Keep it to 5 short lines + a mini
  example of one glyph drawn at its three states (rising / peak / falling).

## States

- Out of catalogue: dim screen, no glyphs, the text "outside Saros 141 catalogue" with the valid range.
- Time travel / time-lapse: the face just shows the displayed time; show a small caption under the pill with the
  displayed Gregorian time only if it is not live (the header already does, so keep it minimal).
- Reduced motion: no transitions on glyph change.

## Notes

- Do not poll faster than needed: compute `odometerAt` for the two period levels + `solarAt` per frame (they are cheap),
  but rebuild SVG attributes only on change.
- Depth ≥ 11 changes faster than ~50 ms: that is expected (SPEC §10); do not throttle, but never let it freeze the page.
- Put pure helpers (counter arc positions, hit-region mapping, label text) in `src/ui/face/helpers.js` and unit-test them.

## Pure mode (revision 3: major periods in words, minor ones in counts; SPEC §15)
The spec display is unchanged (the watch draws its glyph odometers at every depth). What the face says:

- **Caption** (time not live): the short date in words down to the Flavons, `Delta Trifracton End ε#5 34η 29ι 21λ`; where the card is
  too narrow for the words, the letters `δ#3 ε#5 34η 29ι 21λ` (measured on a canvas with the caption's font, no layout). Its hover text
  says which numbers count from 0 and which from 1, and points to the glossary.
- **Letters overlay**: under each letter the running cycle: a major one in words (`Delta Trifracton`), a minor one by where it starts in
  its Nuclide (`ε#5 34η`, `ε#5 34η 28ι`). The Helion is numbered from 1 (`1η` … `77η` in its Nuclide); Preons, Flavons and
  Blinks are counts of completed units from 0.
- **Info labels**: `NEXT END in 6ι 43λ`, `NEXT NODE in …`, `SYNC 4820 · drift −6 236λ` (spans and drift are the core's).
- **Tooltips**: the place of the cycle (`34η of 77 in ε#5`; a depth between two units by what the clock reads while it runs,
  `28ι to 31ι in 34η`, `34η to 44η in ε#5`; a major one
  `Delta Trifracton End · 3 of 5 in its γ`), what one cycle is (`one Helion = 36ι`, `one Delta = 5ε`, `one cycle = 4ι`), the quarter that ends
  next for a major (`Valley ends in 1γ 4ε → End`) and what begins at the end, as briefly as the context allows (`Ends in 6ι 43λ → 35η begins`,
  `→ ε#1 1η begins` across a Nuclide, `→ Delta Tetrafracton begins`). The solar tooltip: `one sync = 19η (19 Helions)`, the phase as a pair,
  `Drift −6 236λ against the solar rhythm`.
- **How to read**: the five lines of normal mode, *The Helion is the basic reading* (its number and its phase; Preons and Flavons the fine
  time; Alpha … Delta in words with their quarter), *Numbers from 1, counts from 0* (34η is the 34th Helion of its Nuclide, 1–77; ε#5 and
  Delta Trifracton are numbered from 1 too; Preons and Flavons are counts), the glossary pointer.
- **Out of range**: "outside the catalogue", from `α#1` to `α#18`.

No fracton name is ever given to a minor depth, and ζ θ κ μ have no names. Strings live in `src/ui/face/pure.js`; nothing there measures a
duration or a drift itself.
