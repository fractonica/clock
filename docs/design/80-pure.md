# Pure mode – Fractonica terms only

Owner request (verbatim intent): *"pure mode. When enabled – don't show Gregorian time or dates anywhere, only
Fractonica. Don't use percentages – use 2 double-stroke glyphs (256 values). It should feel like an alien instrument:
not a single Earth time unit or reference. You can still show how much time is left till thresholds, but only using
Fractonica periods as references. Take depths 7, 9, 11 as the substitute for hours, minutes and seconds. Week is half
of depth 5, day is half of depth 6 (1 d 3 h), month is half of depth 4 (40 d 12 h). For names use emergent ones with
Greek prefixes: monofracton, difracton, trifracton … ; "Gamma Difracton" means the second period of the 3rd level.
Also: add an optional yellow solar wave (1 cycle ≈ 4 days) to the Wave view."*

The translation layer (Gregorian ⇄ Fractonica) stays as it is in the normal mode. **Pure mode is the clean version
of the instrument**: same clock, same views, same navigation, but it never says "Thu 8 Oct", "12:56:12", "3 h 20 min",
"UTC", "Hz", "66 %", a month name, a year, or a zone. It is a *presentation* mode: the clock still runs on the device
time underneath (that is how it knows where "now" is), and every internal time is still Unix seconds.

## The vocabulary (all of it lives in `src/core/pure.js` – use it, never re-derive it)

`ctx.pure` is the helper object (created in `main.js`), `ctx.isPure()` / `ctx.store.state.pure` tells the mode.

### Names
- **Level names**: Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi (Omicron Pi Rho … after).
  Letters α β γ δ ε ζ η θ ι κ λ μ ν ξ stay as symbols. The **depth** number (η = depth 7) is a Fractonica notion and stays.
- **Ordinals**: `Monofracton Difracton Trifracton Tetrafracton Pentafracton Hexafracton Heptafracton Octafracton
  Nonafracton Decafracton Didecafracton Dodecafracton Tridecafracton … Octadecafracton` (1…18, to 20 in the table; the
  hierarchy needs 13 per parent and 18 Alpha cycles). `pure.ordinalName(n)`.
- **Cycle name** = level + ordinal inside the parent (Alpha: global): `pure.periodName(level, ordinal)` →
  *"Gamma Difracton" = the 2nd γ cycle inside its β*. `pure.cycleName(level, cycleIdx)` takes a global cycle index;
  `pure.nameAt(t, level)` the cycle running at t. Compact form `γ#2` (`pure.shortName`, `pure.cycleShort`), address chain
  `α#6 β#4 γ#9 δ#3 ε#5` (`pure.addressAt(t, level)`).
- Where normal mode prints a *date* for a cycle boundary ("ends Thu 8 Oct 15:56:12") pure mode names what happens:
  **"ends → Eta Difracton begins"** (the cycle that starts there), and for thresholds "peak of Eta Monofracton".

### Units for durations (`pure.UNITS`, `pure.duration`, `pure.countdown`, `pure.between`)
Counted greedily from the largest unit that fits, two units by default (`parts`), written `count`+symbol with a space
between units: `2ζ½ 4η`, `6ι 43λ`, `1γ 3δ½`. Symbols:

| symbol | what it is | Earth-ish size (never shown) | note |
|---|---|---|---|
| α, β, γ | depth 1, 2, 3 cycle | 72 y, 14 y, 1.1 y | γ = 10 δ½ |
| δ½ | half of a depth-4 cycle | month ≈ 40 d 12 h | = 5 ε½ |
| ε½ | half of a depth-5 cycle | week ≈ 8.1 d | = 7 ζ½ |
| ζ½ | half of a depth-6 cycle | day ≈ 1 d 3 h | = 5.5 η |
| η | depth-7 cycle | hour ≈ 5.05 h | = 36 ι |
| ι | depth-9 cycle | minute ≈ 8.4 min | = 65 λ |
| λ | depth-11 cycle | second ≈ 7.8 s | |
| μ, ν, ξ | depth 12, 13, 14 | 1.6 s, 0.31 s, 44 ms | |

θ and κ (depths 8, 10) are deliberately skipped. Durations are measured in *position* (Saros fractions), so they are
exact across eclipse intervals. `pure.duration(seconds, {at})` converts device seconds around time `at`.
A tooltip may explain a unit ("ζ½ = half of a depth-6 cycle") but never in Earth units.

### Phase instead of percent (`pure.pair`, `pure.pairHTML`, `pure.drawPair`, `pure.pairText`)
Anywhere normal mode prints "66 %" (progress through a cycle, a half-arc, a sector, a sync) pure mode shows **two
2-stroke glyphs = 16 × 16 = 256 states** (`index = floor(fraction × 256)`, `hi`, `lo` digits 0…15). For a cycle this is
exactly the SPEC §5 odometer of two glyphs at that depth. HTML: `pure.pairHTML(fraction, {label})` (inherits
`currentColor`, sized by `.pure-pair svg { height: 1.7em }` – override per module with a scoped rule); canvas:
`pure.drawPair(ctx, fraction, x, y, height)` after setting `strokeStyle`/`fillStyle` (`pure.pairWidth(h)` for layout);
text for aria-label/tooltips: `pure.pairText(fraction)` → `13·4` ("state 13·4 of 256"). Progress *bars* are graphics, not
percentages: they may stay. Never print `%` or the word "percent".

### Clock and date (`pure.clock`, `pure.date`, `pure.clockText`, `pure.dateText`, `pure.stamp`)
- **Clock** = odometer counters inside the current depth-6 cycle: `η` 0…10 (depth-7 cycle within its ζ), `ι` 0…35 (depth-9
  cycle within its η), `λ` 0…64 (depth-11 cycle within its ι) → `3·17·42`; header shows it as `3η 17ι 42λ`.
- **Date** = `α#6 β#4 γ#9 · δ½#3 · ε½#2 · ζ½#5`: Alpha (1…18), Beta (1…5), Gamma (1…13), then half-cycle ordinals
  δ½ (1…10 inside γ), ε½ (1…5 inside δ½), ζ½ (1…7 inside ε½). So a ε½ has 7 ζ½, a δ½ has 5 ε½, a γ has 10 δ½.
- **Stamp** = any instant as a pure address: `pure.stamp(t, upTo)` with upTo `beta … gamma … zeta … eta … iota … lambda`.
  Use it wherever normal mode prints a full date-time.
- `ctx.fmt` is already mode-aware: in pure mode `fmt.date/time/dateTime/long/short/label/iso` return the pure date/clock/stamp,
  `fmt.tag/inputValue` return '' , `fmt.parseInput` returns null, `fmt.duration/countdown/relative` return pure durations.
  That is a safety net, **not** a design: write the pure wording on purpose (names, durations, glyph pairs) and make sure
  the sentence around it still reads well. `fmt.parts` / `fmt.toUnix` / `fmt.zone` are for calculations only – never display them.

### Speeds and beats (`pure.RATES`, `pure.rateLabel`, `pure.beats`, `pure.BEAT`)
Real time itself is the one thing a live instrument cannot abstract away, so it gets its own neutral word: a **beat** is
one tick of the device's real time. Time-lapse speeds are *units per beat*: `real time`, `λ per beat`, `ι per beat`,
`η per beat`, `ζ½ per beat`, `ε½ per beat`, `δ½ per beat`, `γ per beat` (backward: `… backward`). "make one cycle last 4 s"
becomes "4 beats". Frequencies are "cycles per beat" (never Hz); pitch is shown as ratio, octave offset and cents only (no
Hz, no note names such as A2).

### Position and catalogue
Saros position stays (it is Fractonica's own coordinate): `pos 22.927850`. The catalogue range is `α#1 – α#18`
(`pure.catalogueText()`), never years. The word "Saros" is allowed (it is the clock's own base unit) but not eclipse
*dates*; eclipse markers are numbered (`#22`), not dated.

## Rules for every module

1. **Live switching**: pure mode toggles at runtime (header button, `P` key, `?pure=1`). Re-render everything in the new
   vocabulary when `ctx.store.state.pure` changes (check it each `render`, rebuild static labels / tooltips / help text and
   drop text caches). No reload, no stale labels, no leftovers when switching back.
2. **Nothing Earth-ish anywhere a user can see or hear described**: visible text, tooltips (`title`, custom tooltips),
   `aria-label` / screen-reader text, placeholders, help panels, toasts, canvas labels, SVG `<title>`, `<select>` options,
   error messages, empty states, the `README`-style "How to read" popovers. Forbidden in pure mode: Gregorian dates,
   month / weekday names, clock times with colons, years, "UTC"/"GMT"/zone names/offsets, "Unix"/"ISO", the words second /
   minute / hour / day / week / month / year (and `s`, `min`, `h`, `d`, `wk`, `mo`, `y`, `ms` units), Hz/kHz/BPM, note names,
   `%` / "percent", AM/PM, "today/tomorrow/yesterday". Use `λ`, `ι`, `η`, `ζ½` … instead.
3. **No Gregorian input either**: fields that take a date, time, zone, Unix seconds or ISO text are hidden or replaced by
   Fractonica inputs (cycle address, position, glyph states, sync number, pure offsets such as `+2ζ½ 3η`).
4. **Same function, same quality**: every capability that exists in normal mode and does not *require* Earth time has a
   pure equivalent that is as good (navigation, scrubbing, countdowns, thresholds, selecting levels, time-lapse). Things that
   exist only to translate to Gregorian (zone select, ISO/Unix fields, month grid of the Gregorian calendar, "Hear the
   date") are replaced by pure counterparts or hidden – say so on screen in one tidy line when a whole panel is replaced.
5. **Normal mode must not change** (apart from bug fixes): existing tests keep passing; add tests for the new pure logic.
6. **Verification** – the acceptance test is the leak scanner:
   `node tools/checks/check-pure-leaks.mjs <tab…>` (rules in `tools/pure-scan.mjs`). It loads each tab in pure mode at several
   instants, opens help, hovers a grid and every interactive element, changes selection / depth ranges / time-lapse speed,
   records canvas text, and reports every hard leak. It must report **0 hard leaks** for your tab *and* for the always-visible
   side modules (face, ladder, upnext, jump, header). Soft leaks (`--soft`: the word Saros, 4-digit numbers) must each be
   explained or removed. Also look at the screenshots (Read tool) in pure mode at 1440×900 and 390×844: layouts must hold with
   the longer pure strings and the glyph pairs.

## Per-module requirements

**face** – caption under the pill, info labels (next threshold of the top period, next solar threshold, "sync time"), every
tooltip, the How-to-read popover ("yellow = solar sync of 19 η", not "4-day"), aria-labels, out-of-range text. Info labels
read like `peak in 3η 2ι`, `node in 1ζ½ 3η`; the sync label shows the sync number and drift counted in λ (`drift −623λ`), not a
clock time.

**rings** – centre read-out: "ENDS IN 6ι 43λ", the end shown as the cycle that begins ("→ Eta Difracton"); quarter chips with
countdowns and the name of the quarter's cycle; Cycle phase card: replace the percentage by the glyph pair, started / ends /
length facts by pure names and durations; tooltips of sectors ("starts in 3η", "Eta Trifracton"); waveform inset boundary
labels; help text; the depth-range and toolbar labels.

**ladder + upnext** – rows: time left as pure countdown, `%` → glyph pair (rows must stay compact: pair at ~1.5em), expanded
detail (started / ends / length / Saros span) with names and durations, quarter thresholds as "in 2η" strings; Up next hero
("NEXT MAJOR TURNOVER", "in 1ζ½ 4η", "→ Zeta Pentafracton begins", "N finer cycles end with it", the progress caption with the
glyph pair), the list rows (countdown + the name of the cycle that begins, no dates), the importance legend ("cycles last about
1½ζ½ …" in pure units), the "Just before / Just after" actions and their help text.

**timeline** – replace the Gregorian axis by a **pure ruler**: ticks at unit boundaries chosen by zoom from the ladder
(α β γ δ½ ε½ ζ½ η ι λ μ ν ξ), labelled by the ordinal / counter of the unit inside its parent (`ζ½ 3`, `η 7`, `ι 12`), with a
context row naming the larger unit (`ε#5 · ε½ 2`); no weekend shading, no month names. Eclipse markers numbered (`#22`) not dated;
overview labels `α#n`; hover tooltip = pure stamp + position + cycle names; "now"/cursor flags pure; zoom presets named by units
(`ζ½  ε½  δ½  γ  β  α  all`, plus fine ones `η  ι  λ`); pointers "ε ends in 1ε½ 2ζ½ ▸"; status lines; help text. Block labels
already use ordinals.

**wave** – tooltips, read-out header (the half-arc / cycle progress pairs replace the two percentages), readouts of
start/end/duration, hints. **New in both modes: the optional yellow solar wave** (see below).

**calendar + jump** – in pure mode the tab becomes the **pure converter + pure calendar**: (a) converter between
Fractonica forms only: position ⇄ cycle address (names and `#` form, steppers per depth) ⇄ glyph states / odometer pairs ⇄
solar sync, with "next / previous occurrence" lists expressed as pure countdowns and stamps; the Gregorian panel, zone chip,
Unix/ISO fields and eclipse "years after" context are removed; (b) a **pure month grid**: one *month-like* δ½ as 5 rows
(ε½ "weeks") × 7 columns (ζ½ "days"), each cell showing its ζ½ ordinal, the cycle boundaries inside it (η and ι ticks at their
fractional position within the cell, local numbers), the day's phase glyph pair, markers for "now"/displayed cell and for the
sync quarters; header ◀ ▶ over δ½ / γ / β / α with names (`γ#9 · δ½ 3`), a "Now" button, a jump-by-address strip. The jump box in pure
mode accepts only pure input: names (`Gamma Difracton`, `γ#2`, `α#6 β#4 γ#9`), `pos 22.9`, `sync 4820`, `next ε`, `prev ζ`,
glyph states (`η [13,0]`), pure offsets (`+2ζ½ 3η`, `-1ι`), and answers anything Gregorian ("2031-06-01", "+3d", "Moscow")
with a short helpful message ("Gregorian input is off in pure mode"). The example list / placeholder / footer are pure. "Hear this
moment" buttons stay (they are not Earth references).

**sound** – panel texts: pitches as ratio · octave · cents (no Hz, no note names), cycle lengths as pure durations ("one
cycle = 2ζ½ 3η"), true rates as "cycles per beat", tempo lock "make one ζ last 4 beats", speed chips as units per beat, the
rhythm legend, tooltips, status line, `How to listen`. Base pitch control: shown as an octave-offset / ratio (e.g. "ground ×1",
"+1 octave"), not 110 Hz. Audio itself is unchanged.

**shell (done by the owner of `main.js`)** – header clock/date, brand sub-label, zone select hidden, speed select, copy-link
(`?pos=` instead of `?t=`), toasts. Modules do not touch these.

## The solar wave (Wave view, both modes)

SPEC §7: a **solar sync** is 19 depth-7 cycles ≈ 4 days; its odometer is yellow `#FFD60A` on the face; its quarters (peak /
node / valley / end) fall about one civil day apart; drift accumulates against civil days. In the Wave view add an
**optional yellow solar wave**: a toggle ("Solar", yellow dot, remembered in localStorage) that overlays one more wave whose
cycle is one sync. Because 19 is not a factor of the harmonic hierarchy it cannot be one more level of nested arcs, so draw it
as an overlay riding along the focused arc / geometry in the same visual language (yellow, thinner, behind the level
markers): a ripple whose wavelength is one sync (visible when at least ~1.5 syncs fit on the focused arc and a wavelength is ≥ 18
px; otherwise show only the marker and a one-line hint of the zoom range), a **solar marker** at the current sync phase with its four
quarter ticks (peak / node / valley / end) and the sync number, a tooltip (sync number, phase – pair in pure mode, percent otherwise –,
next quarter countdown, drift), and a legend entry. It must follow time-lapse, work in pure mode (no Earth units; drift in λ),
and cost almost nothing when off. Decide the exact drawing yourself after studying the geometry; explain it in one sentence in the
view's caption.


## Final notation and decisions (after the audits)

**One rule** (header comment of `src/core/pure.js`): `X#n` is an *ordinal* (1-based identity: `ζ#5`, `δ½#6`, `α#6`, names count
the same way); `nX` is a *count* of units (durations `6ι 43λ`, clock counters `0η 29ι 21λ` completed since the parent began and
counted from 0, ruler ticks `9η`, speeds `9ι per beat`); a letter plus a depth number (`η 7`) is only a depth chip.

- Durations drop trailing zero parts (`1η`, not `1η 0ι`); exact whole-cycle lengths come from `pure.cycleLength(level)`,
  never from a float difference. Counting uses an absolute 1e-12 Saros tolerance (`pure.EPS_POS`, 0.6 ms).
- Eclipses are numbered like the position they sit at: `pure.eclipseName(k)` = `#k`, `#0 … #69`, in every module and mode.
- Solar drift is `pure.driftText(sol)` everywhere (`drift −623λ`, narrow-space digit groups), "against the solar rhythm";
  `sync #4820` is the sync number, one sync is `19η`.
- The glyph pair has one spoken form, `pure.pairLabel(fraction, label)` → "phase 8 and 0 of 256"; the library's per-glyph
  titles are stripped by `pure.pairHTML`.
- Speeds: `pure.rateLabel` → `real time`, `η per beat`, or `<count><unit> per beat` for anything else (a tempo lock of one η in
  4 beats is `9ι per beat`). The default Play speed is one η per beat in pure mode (one hour per real second in normal mode).
- The shell has an in-app **glossary** (header `?` button, key `?`) defining the units, the counters-vs-ordinals rule, pairs,
  beats, drift, sync numbers and eclipse numbers; module help texts end with "Press ? for the glossary."
- `?pure=` accepts 1/true/0/false (any case); `?pos=` takes a plain decimal Saros position; in pure mode `pos` wins over `t`,
  and copied pure links carry `pos` with 12 decimals (±1e-9 s).

Per-module summary of what pure mode does:

| module | pure behaviour |
|---|---|
| header | counter clock `0η 29ι 21λ`, address `α#6 β#4 γ#9 · δ½#6 · ε½#4 · ζ½#7`, `pos`, speed select in units per beat, zone select hidden, brand "Pure mode" |
| face | letters overlay shows the running cycles' names; info labels are countdowns plus `SYNC 4820 · drift −6 236λ`; tooltips name the cycle ("Eta Monofracton · η#1 of 11 in its ζ", "ends → Eta Difracton begins"); caption is the stamp; how-to has the counters/names line |
| rings | centre `ENDS IN 6ι 43λ` with "→ Eta Difracton"; chips with counters and countdowns; phase card shows the glyph pair, started/ends/length as names and counts |
| ladder | rows: counter, countdown, glyph pair; detail: names, exact length, quarter offsets; Up next: names of the cycle that begins, finer-cycle counts, date counters on wide cards |
| timeline | ruler of cycle units with 4–12 labelled ticks at every zoom (incl. γ and β multiples), context row, eclipses `#k`, status in position |
| wave | pure tooltips, pairs for half-arc / cycle progress, solar strip and ripple in both modes |
| calendar / jump | converter between Fractonica forms (position, names, address, stamp, glyph states, sync) and a pure month page (one δ½ = 5 × 7 cells with η/ι ticks, sync quarters, eclipse and sync labels); jump grammar: names, `α#6 β#4`, `pos`, `sync`, `next/prev`, glyph states, offsets `+2ζ½ 3η`, old spellings still read; Gregorian input is answered with a short pointer |
| sound | ratio · octave · cents, "ground" instead of Hz, cycle lengths as pure durations, rates per beat, tempo lock in beats |

### The solar wave (final)
Toggle **Solar** in the Wave toolbar (`?solar=1|0`, remembered). A dial shows the current sync (number, phase pair/percent,
four quarter ticks, next quarter, drift) and a yellow ripple of exactly one sync wavelength rides along the focused arc where
at least 1.5 syncs fit and the wavelength is ≥ 26 px (depths 4–5 on a desktop stage); a pin marks the current phase and can be
dragged to scrub within the sync. Outside that range only the dial is shown, with a one-line hint of the zoom range.
