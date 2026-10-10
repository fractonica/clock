# Module: clock face  (`face`)

Owns: `src/ui/face.js`, `src/ui/face/*`, `src/styles/face.css`, `test/face.test.js`.  CSS prefix `face-`.
Mounts into `#slot-face` (a tall card in the left column, `alwaysOn: true`).

## Goal

The spec's own display (SPEC §8–§10): the Zepp watch face rebuilt as an inline **SVG**, faithful to the spec's
arrangement and numbers, scaled to fill its card, plus a few web affordances that make it readable to a newcomer.
This is the "reference clock" of the app; the other views explain and navigate it.

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

## Pure mode
Letters overlay: the running cycles' names under their letters. Info labels: `NEXT END in 6ι 43λ`, `NEXT NODE in 2η 24ι`,
`SYNC 4820 · drift −6 236λ`. Tooltips: cycle name, `η#1 of 11 in its ζ`, `one cycle = 1η`, `ends → Eta Difracton begins`, the
solar phase as a glyph pair. Caption: the pure stamp. How-to: six lines incl. "counters from 0, names from 1" and the
glossary pointer. Out of range: "outside the catalogue, from α#1 to α#18". Strings live in `src/ui/face/pure.js`.
