# FractonicaKit

The Fractonica clock engine for the native iOS and macOS apps and their widgets: a dependency-free Swift package
(iOS 26 / macOS 26, Swift 6 language mode) that reproduces the web app's readings exactly.

```swift
import FractonicaKit

let clock = FractonicaClock.shared
let t = Date().timeIntervalSince1970
let helion = clock.level(at: t, 6)               // depth 7: cycle, phase, glyph state, next threshold …
let pair = clock.odometer(at: t, 6)              // [13, 0], and when the finer glyph next changes
let sync = clock.solar(at: t)                    // the 4-day solar sync
let date = Notation().dateText(at: t)            // "Delta Trifracton End ε#5 34η 29ι"
let face = Journal.reading(at: t, unit: 5)       // "34η" "29ι" "21λ" with the Helion's phase
let label = EarthFormatter(zone: "Europe/Moscow").label(helion!.next.time!, ref: t)
```

## What is ported from where

| Swift | Web source | Notes |
|---|---|---|
| `FractonicaClock` | `src/core/model.js` over `fractonica.js` (`positionAt`, `phaseAt`, `phaseDigits`, `period`, `nextThreshold`, `solarSync`, `createCycleCalendar().at`, `timestampAt`, `count`, `prefix`) | Saros 141 Unix catalogue, default sequence, ascending family, solar sync anchor 20 / level 6 / 19 cycles / 4 days |
| `Fractonica` | `F.defaults`, `F.periodName`, model.js `MAX_LEVEL` / `QUARTER_NAMES` | catalogue in whole milliseconds (SPEC §14) |
| `GlyphState`, `GlyphGeometry` | `F.CBT.fromIndex`, `F.CBT.geometry` (round style, thickness 0.3) | path commands in design units, bounds, dot; `cgPath` for CoreGraphics |
| `Notation` | `src/core/pure.js` (SPEC §15) | pure-mode names, spans, dates, stamps, rates, Blinks, pB |
| `Journal` | `src/ui/face/journal.js` (`journalReading`, `arcPoint`, `ordinal`, `clampUnit`) | the reading only; drawing is the app's |
| `EarthTime`, `EarthFormatter` | `src/core/format.js` (free functions, `createFormatter`) | `TimeZone` offsets + proleptic-Gregorian arithmetic (see below) |

Deliberate differences:

- Cycle events are named `begin`, `peak`, `node`, `valley`, `end`: the names `next` already uses. The library calls the
  middle three `firstPeak`, `middleNode`, `oppositePeak`; for the ascending family they are the same instants.
- Readings exist for levels 0 … 20 (`Fractonica.supportedLevels`) and 1 … 4 strokes; outside that they are `nil`
  (the library throws). Invalid odometer digits give an empty `stateOccurrences` instead of a `RangeError`.
- No argument traps. Where the API returns a value rather than an optional, out-of-range input is clamped: `levelInfo`
  and `count` clamp the level into 0 … 20, `GlyphState` / `GlyphGeometry` the stroke count into 1 … 20, and
  `Fractonica.periodName` reads a negative level as 0. Searches return nothing for an unsupported level, odometers and
  state searches nothing beyond 2^80 steps per Saros, `time(atPositionNumerator:denominator:)` nothing for a
  denominator beyond 2^80, `zonedToUnix` NaN outside JavaScript's Date range; spans and drift counts beyond `Int` read
  "—" and 0. Non-finite numbers print as JavaScript prints them (`offsetLabel(.nan)` is "+NaN:NaN").
- `EarthTime.daysInMonth` (and so `EarthFormatter.parseInput`) uses the true proleptic Gregorian calendar for years 0 … 99, where
  JavaScript's `Date.UTC` maps them to 1900 … 1999 (no difference inside the catalogue, 1613 … 2857).
- Foundation's `Calendar(identifier: .gregorian)` turns Julian before 1582; `Intl` does not. `EarthTime` therefore
  takes only the zone offset from `TimeZone` and does the calendar arithmetic itself. Offsets, including local mean
  time seconds before standard time (Moscow +02:30:17 in 1613), agree with Node's `Intl` in every fixture zone.

## Numerics

The reference library computes in exact BigInt rationals; so does this port, on 64/128-bit integers.

- model.js rounds every query to 1 ms and hands the library the decimal of that double, so an exact position is
  always k + (t_ms − E_ms[k]) / (E_ms[k+1] − E_ms[k]) over whole milliseconds, reduced like the library's `rational()`.
  Cycle indices, glyph states, odometer digits, thresholds, quarters, addresses and solar digits are exact integers.
- `Double` appears only at the end, through the library's own conversion `F.number` (`Ratio.libraryDouble`). That
  conversion is not correctly rounded (it divides the leading 16 digits of numerator and denominator); repeating it
  keeps times bit-identical, which matters for time-linear progress at depth 14, where an ulp is 5e-6 of a cycle.
- Where model.js itself uses floats (`locate`, `positionOf`, `timeOfPosition`, `cycleStartTime`, `boundaries`, the
  float catalogue, pure.js spans), the port repeats the same operations in the same order.
- JavaScript's number formatting is reproduced exactly (`JSNumber`): `Math.round` rounds halves up, `toFixed` /
  `toPrecision` round the exact binary value with ties up, `String(x)` prints shortest digits in ECMAScript layout.
- Edge rules as in model.js: nothing outside the catalogue, the closing instant is read 1 ms inside the last cycle
  (EDGE), the last cycle at each level is clipped, and the first and last partial solar syncs read `nil`.
- Products stay far below `Int128.max` for every supported level and odometer (overflow-checked where inputs vary).

Cost, release build on Apple silicon (`PerformanceTests`, run with `swift test -c release -Xswiftc -enable-testing
--filter Performance`): 14 level readings plus 14 odometers take about 25 µs per frame at 60 fps, where consecutive
frames mostly hit the cycle-facts cache, and about 70 µs with the solar sync at 10 000 random instants, where nearly
every reading builds its cycle's facts afresh (debug builds: about 200 µs and 500 µs). Cycle facts are cached behind a
lock, so one `FractonicaClock.shared` serves the app, widgets and background work.

## Golden fixtures

`Tests/FractonicaKitTests/Fixtures/*.json` are generated from the web app's real modules:

```bash
node ios/scripts/make-fixtures.mjs     # from the repository root; deterministic (seeded PRNG)
swift test --package-path ios/FractonicaKit
```

Regenerate whenever `fractonica.js`, `src/core/{model,pure,format}.js` or `src/ui/face/journal.js` change, then run the
tests. A second, independent generator aims where a port breaks rather than where users look:

```bash
node ios/scripts/make-fuzz-fixtures.mjs   # Fixtures/fuzz.json, replayed by FuzzFixtureTests
```

It uses its own PRNG and seed and samples instants a hair either side of exact cycle boundaries at every level (±0.5,
±1, ±2 ms), solar sync boundaries including the first and last whole syncs, every Saros interval, the far past and
future, Unix times before 1970 and millisecond rounding ties; 2- and 3-stroke readings, odometers of 1 … 3 digits,
`stateOccurrences` both ways with count 3, `upcomingEnds` over random level ranges, boundary windows that start or end
on a boundary; pure dates, stamps and cycle names at random levels 0 … 20, spans a hair either side of whole unit
counts, the journal face for every unit at unit boundaries, and Earth time in fifteen zones with odd offsets and
rolled-over fields. About 330 000 comparisons; each fuzz test also prints how many tolerance comparisons were not
bit-identical (all zero so far). The fixtures cover the SPEC §12 / §15.6 vectors, about 380 instants (catalogue edges, every eclipse, exact cycle
boundaries, log-uniform around 2026-10-08, uniform over 1613 … 2857) at every level 0 … 13, every glyph state, the
notation, the journal face and Earth formatting in five zones. Integers and strings must match exactly, times within
0.5 ms, phases and progress within 1e-9; the catalogue, `F.number` and exact timestamps are checked bit for bit.
`SpecVectorTests` repeats the SPEC vectors by hand.
