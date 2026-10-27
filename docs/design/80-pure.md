# Pure mode – Fractonica terms only

Owner request (verbatim intent): *"pure mode. When enabled – don't show Gregorian time or dates anywhere, only
Fractonica. Don't use percentages – use 2 double-stroke glyphs (256 values). It should feel like an alien instrument:
not a single Earth time unit or reference."*

**Revision 3** (owner, current): *"make Flavon, Preon, Helion the default coarse time units (second, minute, hour);
Nuclide is like a week, Delta like a month; Alpha, Beta, Gamma, Delta are the major periods above. Only Alpha … Delta
have XFracton names. Periods below skip one depth: a Delta is 5 Nuclides, a Nuclide 77 Helions, a Helion 36 Preons, a
Preon 65 Flavons. The basic time unit is the Helion phase (2 glyphs) and its count; coarse time is Preons and Flavons.
Showing the phase of Alpha … Delta is redundant. We need a clear separation of major (ultrahelion) and minor (infrahelion)
periods."* Owner decisions on the details: the date carries the Nuclide ordinal (`ε#2`), and Helions are numbered from 1 (1–77,
like the days of a month; first decided 0–76, changed by the owner with the diary).
The notation is now part of **SPEC.md §15**; this file says how the app uses it.

Pure mode is a *presentation* mode: same clock, views and navigation, but it never says "Thu 8 Oct", "12:56:12",
"3 h 20 min", "UTC", "Hz", "66 %", a month name, a year or a zone. Every internal time is still Unix seconds.

## The vocabulary (`src/core/pure.js` – use it, never re-derive it)

`ctx.pure` is the helper object, `ctx.isPure()` / `ctx.store.state.pure` tells the mode.

### Major and minor periods
| | sym | unit | depth | made of | |
|---|---|---|---|---|---|
| major | α | Alpha | 1 | 5 β | words only, with fracton ordinal and quarter |
| major | β | Beta | 2 | 13 γ | |
| major | γ | Gamma | 3 | 5 δ | |
| major | δ | Delta | 4 | 5 ε | |
| minor | ε | Nuclide | 5 | 77 η | ordinal `ε#2` (1–5 in its Delta) |
| minor | η | **Helion** | 7 | 36 ι | numbered 1–77 in the Nuclide; its phase pair is the basic reading |
| minor | ι | **Preon** | 9 | 65 λ | count 0–35 |
| minor | λ | **Flavon** | 11 | 25 ν | count 0–64 |
| minor | ν | Blink | 13 | – | count 0–24; the device's real-time tick |

- `pure.UNITS` (ids alpha beta gamma delta epsilon eta iota lambda nu; `major` flag), `pure.unitOf(sym|id|name|level)`,
  `pure.unitName(sym, n)` ("Helion"/"Helions"), `pure.isMajor(level)`, `pure.levelKind(level)` → 'major' | 'unit' |
  'between' (ζ θ κ μ) | 'sub' (ξ and finer).
- **ζ θ κ μ are not units** and have no names (no Hadron/Quark/Chromon/Somon/Atom any more). They are still depths of the
  hierarchy: rows, rings, lanes, depth chips (`ζ 6`). Their exact length is a count of the next unit: ζ `11η`, θ `4ι`,
  κ `13λ`, μ `5ν`; ξ is `0.14ν`.
- **Only α β γ δ have fracton names**: "Delta Trifracton" (`pure.periodName`). Minor cycles are named by where they start in
  their Nuclide: `pure.cycleName(level, cycleIdx)` → "ε#2 5η 9ι" (`{short:true}` drops the Nuclide: "5η 9ι"); ε → "ε#2";
  `pure.cycleShort` → the finest placing count ("9ι", "22η"). Where normal mode prints a boundary date ("ends Thu 8 Oct …")
  pure mode says what begins: "→ Delta Tetrafracton begins", "→ ε#3 begins", "→ 34η begins" (use the short form inside the
  same Nuclide).
- **Quarter words** replace the phase of a major period: `pure.QUARTER_WORDS` = Peak, Node, Valley, End (the quarter named
  by the threshold that ends it, SPEC §6.2), `pure.quarterAt(t, level)`, `pure.majorText(t, level)` → "Delta Trifracton Node".
  **Never draw a phase pair for α β γ δ** (it is implied by the Nuclide and Helion count): show the quarter word instead.

### Dates and the clock
- `pure.clock(t)` → `{epsilon 1–5, eta 1–77, iota 0–35, lambda 0–64, nu 0–24}`; `pure.clockText(t, upTo)` → "5η 5ι 5λ".
- `pure.dateText(t, {form, letters, upTo})`:
  - short words (default) `Delta Trifracton Node ε#2 5η 5ι`
  - full words `Alpha Pentafracton Peak, Beta Tetrafracton Valley, Gamma Difracton End, Delta Trifracton Node, ε#2 5η 5ι 5λ 5ν`
  - letters `α#5 β#4 γ#2 δ#3 ε#2 5η 5ι` / short letters `δ#3 ε#2 5η 5ι` (no quarter words)
  - `upTo` 'delta' | 'epsilon' | 'eta' | 'iota' (default) | 'lambda' | 'nu' (Flavons and Blinks are optional, like seconds).
- `pure.stamp(t, upTo)` = the full letter form, the exact identity of a moment (tooltips, copy, the jump box reads it back).
- `pure.addressAt(t, level)` = the stamp at the resolution that shows that level's cycle.
- `pure.date(t)` → `{alpha, beta, gamma, delta, epsilon, quarter:{alpha…delta}}`.
- The **Helion** is the basic reading: its count and its **phase pair** (`pure.pairHTML(levelAt(t, 6).phase)`, the SPEC §5
  odometer at depth 7). Preons and Flavons are the fine time.

### Pentads (SPEC §7.5)
- The solar sync's 19 Helions run as **Pentad I, II, III** (5 Helions) and the **Hypopentad** (4): `model.pentadAt(t)`,
  `pure.pentadText(t, {form, helion})`, the UI helpers in `src/ui/pentad.js`. A solar day is 4¾η, so each Pentad starts ¼η
  later in it and the Hypopentad, one Helion short, brings Pentad I back.
- A date or reading **leads with its Pentad** like a weekday: the shape mark in HTML and on canvases (a pentagon with its
  numeral, a square alone), "Pentad II · …" in plain text. The stamp does not carry it.
- Pure wording: "4¾η is a solar day" – the scanner allows *solar day* and *the Sun*, never hours or plain days.

### Notation (one rule)
`X#n` ordinal from 1 (α#6, δ#3, ε#2); `nX` count from 0 (5ι, spans `6ι 43λ`, ruler ticks `9ι`, speeds `4ι per Blink`) –
except the Helion of a date or clock, numbered from 1 (`1η` … `77η`); `η 7` only a depth chip.

### Spans (`pure.duration`, `durationPos`, `countdown`, `between`, `cycleLength`)
Greedy over α β γ δ ε η ι λ ν, up to `parts` (default 2) non-zero counts, zero units skipped: `2ε 10η`, `5η 17ι`,
`6ι 43λ`, `16ν`; spans led by the Blink below 10ν keep a decimal (`2.6ν`, `0.14ν`); `keepZeros` gives consecutive units.

### Phase instead of percent
Two 2-stroke glyphs, 256 states (`pure.pair`, `pairHTML`, `drawPair`, `pairLabel` → "phase 8 and 0 of 256"). For minor
levels and the depths between, wherever normal mode prints a percentage. For major levels: the quarter word instead.

### Real time and frequency
One **Blink** (mean ν cycle) is the real-time unit; "beat" is retired. Speeds `pure.RATES`: real time, `5ν`, `λ`, `13λ`,
`ι`, `4ι`, `η`, `11η`, `ε`, `δ`, `γ per Blink` (same numeric rates as before, 5× … 112.6 M×); `pure.PLAY_RATE` = `4ι per
Blink` (6 500×) is the default Play speed; `pure.rateLabel(rate)` for any rate. Spans of device time `pure.blinks(s)`.
Frequencies are **pB** = cycles per Blink (`pure.perBlink(hz)`, `pure.pbText(pb)`: 34.2 pB, ξ 7, ο 77, π 693, ρ 2 772).

### Position and catalogue
`pos 22.927850` stays; the catalogue is `α#1 – α#18`; eclipses are `#0 … #69`; "Saros" is allowed, eclipse dates are not.
Solar drift `pure.driftText` (`drift −623λ`), one sync is `19η` (19 Helions).

## Rules for every module
1. **Live switching**: pure mode toggles at runtime; re-render everything in the new vocabulary; no stale labels either way.
2. **Nothing Earth-ish** anywhere a user can see or hear described (text, tooltips, aria, placeholders, help, toasts, canvas
   labels, SVG titles, select options, errors). Forbidden: Gregorian dates, month/weekday names, clock times, years, zones,
   Unix/ISO, second/minute/hour/day/week/month/year (and s, min, h, d, wk, mo, y, ms), Hz/kHz/BPM, note names, %, AM/PM,
   today/tomorrow, "beat", half-cycle symbols, the retired unit names (Hadron, Quark, Chromon, Somon, Atom) and fracton
   names for minor levels ("Eta Difracton").
3. **No Gregorian input**: pure inputs only (words, stamps, counts, offsets `+2ε 5η`, `+4 Blinks`, `pos`, `sync`).
4. **Same function, same quality** as normal mode.
5. **Normal mode must not change** (apart from bug fixes); add tests for the new pure logic.
6. **Verification**: `node tools/checks/check-pure-leaks.mjs <tab…>` (rules in `tools/pure-scan.mjs`, now also
   `retired-unit` and `minor-fracton`) → **0 hard leaks**; look at pure screenshots at 1440×900 and 390×844.

## Per-module behaviour (revision 3)
| module | pure behaviour |
|---|---|
| header | the Helion reading (count + phase pair) with Preons and Flavons `34η ‹pair› 29ι 21λ`, the short date `Delta Trifracton End ε#5`, `pos`, speeds per Blink, glossary |
| face | spec display unchanged; letters overlay names the major periods in words and minor ones by letters; info labels countdowns `in 6ι 43λ` and `SYNC 4820 · drift −6 236λ`; caption = short date |
| rings | major rings: name + quarter word, no pair; minor rings: placing counts, pair, countdowns; "→ Delta Tetrafracton begins" / "→ 34η begins" |
| ladder / up next | rows α–δ with words and quarter (no pair), minor rows with count/pair; up next names what begins in words (major) or counts (minor); list grouped by the Helion or Nuclide |
| timeline | ruler ticks on units only (α β γ δ ε η ι λ ν): majors labelled in words/letters by zoom, η numbered 1–77 in ε, ι in η, λ in ι, ν in λ |
| wave | majors: words + quarter; minors: pairs; solar wave unchanged (19η) |
| calendar / jump | month page = one Delta: 5 Nuclide rows × 7 columns of 11 Helions (labelled 1η 12η … 67η); converter between words, stamps, counts, position, glyph states, sync; jump reads all four date forms, offsets, unit names |
| sound | cycle lengths `11η`, `4ι`; speeds per Blink with the new presets; pB unchanged |

## The solar wave (both modes)
SPEC §7: a solar sync is 19 Helions ≈ 4 days. Toggle **Solar** in the Wave toolbar (`?solar=1|0`): a dial with the sync
number, phase, quarters and drift, and a yellow ripple of one sync wavelength along the focused arc where it fits.
