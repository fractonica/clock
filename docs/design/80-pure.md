# Pure mode – Fractonica terms only

Owner request (verbatim intent): *"pure mode. When enabled – don't show Gregorian time or dates anywhere, only
Fractonica. Don't use percentages – use 2 double-stroke glyphs (256 values). It should feel like an alien instrument:
not a single Earth time unit or reference. You can still show how much time is left till thresholds, but only using
Fractonica periods as references."* Revision 2 (owner): *"half cycles turned out to be a bit confusing; let's keep the
cleaner cadence"* – one named unit per depth (Blink, Somon, Flavon, Chromon, Preon, Quark, Helion, Hadron, Nuclide,
Atom), and *"to replace Hz we need the inverse ratio to Blinks: how many cycles fit inside one Blink (pB)"*.

The translation layer (Gregorian ⇄ Fractonica) stays as it is in the normal mode. **Pure mode is the clean version
of the instrument**: same clock, same views, same navigation, but it never says "Thu 8 Oct", "12:56:12", "3 h 20 min",
"UTC", "Hz", "66 %", a month name, a year, or a zone. It is a *presentation* mode: the clock still runs on the device
time underneath (that is how it knows where "now" is), and every internal time is still Unix seconds.

## The vocabulary (all of it lives in `src/core/pure.js` – use it, never re-derive it)

`ctx.pure` is the helper object (created in `main.js`), `ctx.isPure()` / `ctx.store.state.pure` tells the mode.

### Names of cycles
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
- Cycle names are not unit names: "Eta Difracton" is the 2nd η cycle inside its ζ, a **Helion** is the unit of length "one η".

### The unit ladder (`pure.UNITS`, `pure.unitOf`, `pure.unitName(sym, n)`)
One unit per depth, whole cycles only (no halves). A cycle of depth d spans 4 / P(d−1) Saros units, so every ratio below is exact.

| depth | sym | unit | per parent | mean length (never shown) | |
|---|---|---|---|---|---|
| 1 | α | – (Alpha) | – | 72 y | no particle name yet: reads as its level name |
| 2 | β | – (Beta) | 5 | 14.4 y | |
| 3 | γ | – (Gamma) | 13 | 1.1 y | |
| 4 | δ | **Atom** | 5 | 81 d | |
| 5 | ε | **Nuclide** | 5 | 16.2 d | |
| 6 | ζ | **Hadron** | 7 | 2.3 d | |
| 7 | η | **Helion** | 11 | 5.05 h | 19 Helions lock to the sun (one solar sync, ≈ 4 d) |
| 8 | θ | **Quark** | 9 | 33.7 min | |
| 9 | ι | **Preon** | 4 | 8.42 min | |
| 10 | κ | **Chromon** | 5 | 1.68 min | |
| 11 | λ | **Flavon** | 13 | 7.77 s | |
| 12 | μ | **Somon** | 5 | 1.55 s | |
| 13 | ν | **Blink** | 5 | 0.311 s | the atomic unit; the device's real-time tick |

- γ = 5δ, δ = 5ε, ε = 7ζ, ζ = 11η, η = 9θ, θ = 4ι, ι = 5κ, κ = 13λ, λ = 5μ, μ = 5ν.
- The **atomic cadence** is ν –25→ λ –65→ ι –36→ η (Blink, Flavon, Preon, Helion); μ, κ, θ sit between them. The clock keeps
  the three counters η ι λ (11 | 36 | 65).
- ξ (depth 14, 44 ms), ο … are level names (depth chips, ladder rows) but not units: spans finer than a Blink are a
  decimal count of it (`0.14ν`; one ξ cycle is `0.14ν`).
- **Durations** (`pure.duration`, `durationPos`, `countdown`, `between`, `cycleLength`) count greedily from the largest unit
  that fits, up to `parts` (default 2) **non-zero** counts, zero units skipped: `1ζ 4η`, `6ι 3κ`, never `3η 0θ 2ι`.
  `keepZeros` gives the next `parts` consecutive units. Counting uses an absolute 1e-12 Saros tolerance (`pure.EPS_POS`).
  To count in the atomic steps only, drop `mu kappa theta` from `DURATION_UNITS` in `pure.js`.
- **Symbols are the compact notation everywhere; unit names are for prose** (glossary, help texts, tooltips that
  explain a unit, speed-chip tooltips: "One Helion passes every Blink"). A tooltip may explain a unit by its name or by
  its factors ("a Hadron (ζ) is 11η") but never in Earth units.

### Notation (one rule, header of `pure.js`)
`X#n` is an *ordinal* (1-based identity: `ζ#5`, `δ#6`, `α#6`; names count the same way); `nX` is a *count* of units
(durations `6ι 43λ`, clock counters `0η 29ι 21λ` completed since the parent began and counted from 0, ruler ticks `9η`,
speeds `9ι per Blink`); a letter plus a depth number (`η 7`) is only a depth chip. Exact whole-cycle lengths come from
`pure.cycleLength(level)`, never from a float difference.

### Phase instead of percent (`pure.pair`, `pure.pairHTML`, `pure.drawPair`, `pure.pairLabel`)
Anywhere normal mode prints "66 %" (progress through a cycle, a half-arc, a sector, a sync) pure mode shows **two
2-stroke glyphs = 16 × 16 = 256 states** (`index = floor(fraction × 256)`, `hi`, `lo` digits 0…15). For a cycle this is
exactly the SPEC §5 odometer of two glyphs at that depth. HTML: `pure.pairHTML(fraction, {label})` (inherits
`currentColor`, sized by `.pure-pair svg { height: 1.7em }`); canvas: `pure.drawPair(ctx, fraction, x, y, height)`
(`pure.pairWidth(h)` for layout); spoken form `pure.pairLabel(fraction, label)` → "phase 8 and 0 of 256". Progress
*bars* are graphics, not percentages: they may stay. Never print `%` or the word "percent".

### Clock, date, stamp (`pure.clock`, `pure.date`, `pure.dateText`, `pure.stamp`)
- **Clock** = odometer counters inside the current ζ cycle: `η` 0…10 (a Helion within its Hadron), `ι` 0…35 (a Preon
  within its Helion), `λ` 0…64 (a Flavon within its Preon) → `3·17·42`; the header shows `3η 17ι 42λ`.
- **Date** = whole-cycle ordinals `α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#5`: α 1…18, β 1…5, γ 1…13, δ 1…5 in γ, ε 1…5 in δ,
  ζ 1…7 in ε (`levelAt(t, L).local + 1`). One δ is 5 ε × 7 ζ = 35 ζ.
- **Stamp** = any instant as a pure address: `pure.stamp(t, upTo)` with upTo `beta … gamma … zeta … eta … iota … lambda`.
- `ctx.fmt` is mode-aware: in pure mode `fmt.date/time/dateTime/long/short/label/iso` return the pure date/clock/stamp,
  `fmt.tag/inputValue` return '', `fmt.parseInput` returns null, `fmt.duration/countdown/relative` return pure durations.
  That is a safety net, **not** a design: write the pure wording on purpose and make sure the sentence around it
  still reads well. `fmt.parts` / `fmt.toUnix` / `fmt.zone` are for calculations only – never display them.

### Real time: the Blink; frequency: pB (`pure.blinks`, `pure.RATES`, `pure.rateLabel`, `pure.perBlink`, `pure.pbText`)
Real time itself is the one thing a live instrument cannot abstract away, so it is counted in the smallest unit: **one
Blink** is one ν cycle (0.311 real seconds; `pure.blinkSeconds()`). The word *beat* is retired.
- A **speed** is whole cycles of a unit per Blink of real time: `real time`, `μ per Blink` (5×), `λ per Blink` (25×),
  `κ` (325×), `ι` (1 625×), `θ` (6 500×), `η` (58 500×), `ζ`, `ε`, `δ`, `γ per Blink`; backward `… backward`; any other
  rate is a count of the largest unit that passes at least once per Blink (`2.25θ per Blink`). "ν per Blink" is real time.
  The default Play speed is `θ per Blink` in pure mode (one hour per real second in normal mode).
- A **span of device time** is `pure.blinks(seconds)`: "4 Blinks", "0.5 Blinks" (`blinksToSeconds` / `secondsToBlinks` for
  number boxes such as the tempo lock).
- A **frequency** is cycles per Blink, **pB**, replacing Hz: `pure.pbText(pure.perBlink(hz))` → "34.2 pB" (the 110 Hz
  ground), "2 772 pB"; below 0.04 it reads "1 per 65 Blinks". The true rates of the deepest cycles are whole numbers:
  ξ 7, ο 77, π 693, ρ 2 772 pB. Pitch is shown as ratio · octave · cents plus pB; Hz, kHz, BPM and note names never.

### Position and catalogue
Saros position stays (it is Fractonica's own coordinate): `pos 22.927850`. The catalogue range is `α#1 – α#18`
(`pure.catalogueText()`), never years. The word "Saros" is allowed (it is the clock's own base unit) but not eclipse
*dates*; eclipse markers are numbered like the position they sit at (`#0 … #69`, `pure.eclipseName(k)`).

## Rules for every module

1. **Live switching**: pure mode toggles at runtime (header button, `P` key, `?pure=1`). Re-render everything in the new
   vocabulary when `ctx.store.state.pure` changes (check it each `render`, rebuild static labels / tooltips / help text and
   drop text caches). No reload, no stale labels, no leftovers when switching back.
2. **Nothing Earth-ish anywhere a user can see or hear described**: visible text, tooltips (`title`, custom tooltips),
   `aria-label` / screen-reader text, placeholders, help panels, toasts, canvas labels, SVG `<title>`, `<select>` options,
   error messages, empty states, the "How to read" popovers. Forbidden in pure mode: Gregorian dates, month / weekday
   names, clock times with colons, years, "UTC"/"GMT"/zone names/offsets, "Unix"/"ISO", the words second / minute / hour /
   day / week / month / year (and `s`, `min`, `h`, `d`, `wk`, `mo`, `y`, `ms` units), Hz/kHz/BPM, note names, `%` /
   "percent", AM/PM, "today/tomorrow/yesterday", the word "beat", and half-cycle symbols (`δ½` …). Use `λ`, `ι`, `η`,
   `ζ`, Blinks and pB instead.
3. **No Gregorian input either**: fields that take a date, time, zone, Unix seconds or ISO text are hidden or replaced by
   Fractonica inputs (cycle address, position, glyph states, sync number, pure offsets such as `+2ζ 3η` or `+4 Blinks`).
4. **Same function, same quality**: every capability that exists in normal mode and does not *require* Earth time has a
   pure equivalent that is as good. Things that exist only to translate to Gregorian (zone select, ISO/Unix fields, month
   grid of the Gregorian calendar) are replaced by pure counterparts or hidden – say so on screen in one tidy line.
5. **Normal mode must not change** (apart from bug fixes); add tests for the new pure logic.
6. **Verification** – the acceptance test is the leak scanner:
   `node tools/checks/check-pure-leaks.mjs <tab…>` (rules in `tools/pure-scan.mjs`: clock times, dates, month/weekday
   names, Earth units, unit words, zone words, percent, Hz, note names, **half-unit symbols, "beat"**; soft: Saros,
   4-digit numbers, eclipse). It must report **0 hard leaks**; every soft hit must be explained or removed. Also look at
   the screenshots in pure mode at 1440×900 and 390×844.

## Per-module behaviour (as built)

| module | pure behaviour |
|---|---|
| header | counter clock `0η 29ι 21λ`, address `α#6 β#4 γ#9 · δ#3 · ε#2 · ζ#5`, `pos`, speed select in units per Blink, zone select hidden, brand "Pure mode", glossary button |
| face | letters overlay shows the running cycles' names; info labels are countdowns plus `SYNC 4820 · drift −6 236λ`; tooltips name the cycle ("Eta Monofracton · η#1 of 11 in its ζ", "ends → Eta Difracton begins"); caption is the stamp; how-to has the counters/names line |
| rings | centre `ENDS IN 6ι 43λ` with "→ Eta Difracton"; chips with counters and countdowns; phase card shows the glyph pair, started/ends/length as names and counts |
| ladder / up next | rows: counter, countdown, glyph pair; detail: names, exact length, quarter offsets; Up next: hero countdown up to three units, rows grouped by the ζ an event falls in, leads in Blinks, unit clauses ("a Hadron (ζ) is 11η") |
| timeline | ruler of cycle units over the whole ladder with 4–12 labelled ticks at every zoom, context row, eclipses `#k`, zoom presets by unit, status in position |
| wave | pure tooltips, pairs for half-arc / cycle progress, solar strip and ripple in both modes |
| calendar / jump | converter between Fractonica forms (position, names, address, stamp, glyph states, sync) and a pure month page (**one δ = 5 ε rows × 7 ζ columns**, η band inside each cell, sync quarters, eclipses at ¼-fractions of a cell); jump grammar: names, `α#6 β#4`, `pos`, `sync`, `next/prev`, glyph states, offsets `+2ζ 3η`, `+4 Blinks`, unit names (`next Helion`); halves and Gregorian input are answered with a short pointer |
| sound | ratio · octave · cents · pB, "ground" with its pB, cycle lengths as pure durations, speeds per Blink, tempo lock in Blinks (12 Blinks = `3ι per Blink`), physical register in pB (7, 77, 693, 2 772) |

Shell decisions: the in-app **glossary** (header `?` button, key `?`) defines the units with their names and factors, the
counters-vs-ordinals rule, pairs, Blinks and pB, drift, sync numbers and eclipse numbers; module help texts end with
"Press ? for the glossary." `?pure=` accepts 1/true/0/false (any case); `?pos=` takes a plain decimal Saros position; in
pure mode `pos` wins over `t`, and copied pure links carry `pos` with 12 decimals (±1e-9 s). Solar drift is
`pure.driftText(sol)` everywhere (`drift −623λ`, narrow-space digit groups); `sync #4820` is the sync number, one sync is
`19η`.

## The solar wave (both modes)

SPEC §7: a **solar sync** is 19 depth-7 cycles ≈ 4 days; its odometer is yellow `#FFD60A` on the face; its quarters (peak /
node / valley / end) fall about one civil day apart; drift accumulates against civil days. Toggle **Solar** in the Wave
toolbar (`?solar=1|0`, remembered). A dial shows the current sync (number, phase pair/percent, four quarter ticks, next
quarter, drift) and a yellow ripple of exactly one sync wavelength rides along the focused arc where at least 1.5 syncs
fit and the wavelength is ≥ 26 px (depths 4–5 on a desktop stage); a pin marks the current phase and can be dragged to
scrub within the sync. Outside that range only the dial is shown, with a one-line hint of the zoom range. It follows
time-lapse and works in pure mode (no Earth units; drift in λ).
