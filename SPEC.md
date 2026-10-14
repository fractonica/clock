# Fractonica Clock Specification

Version 2.1.0. Reference implementation: `fractonica.js` 2.0.0 (§1–§14); the time units and notation of §15 are implemented by the web client in `src/core/pure.js`.

This document specifies an eclipse-anchored harmonic clock and its glyph display, independent of platform. It has everything needed to build a client (iOS, watchOS, web, embedded) that produces the same readings as the reference library and the Zepp watch face. Section 12 lists test vectors to check an implementation against.

Contents:

1. Concepts
2. Time base
3. Harmonic hierarchy
4. Phase glyphs
5. Odometer read-out
6. Counters and thresholds
7. Solar sync
8. Display model
9. Rendering glyphs
10. Interaction and refresh
11. Numeric implementation
12. Test vectors
13. Pitfalls
14. Reference data
15. Time units and notation

## 1. Concepts

- **Catalogue**: the greatest-eclipse instants of one Saros series, such as Solar Saros 141. Consecutive eclipses are one Saros apart, about 18.03 years.
- **Position**: a continuous coordinate in Saros units. The first catalogue eclipse is position 0, the next is 1, and so on. Between eclipses, position is linear in time.
- **Level**: a level of the harmonic hierarchy, zero-based. **Depth** = level + 1 is the user-facing number. Level 0 (depth 1) cycles span 4 Saros.
- **Cycle**: one period at a given level. Each cycle is divided into the states of a **phase glyph**.
- **Glyph**: a balanced-ternary drawing of a phase state. It has one or more **strokes** (trits) stacked on a vertical stem.
- **Odometer**: two or more glyphs side by side. The left glyph is the coarse phase, and each glyph to its right runs a full cycle inside one state of its left neighbour.
- **Solar sync**: a run of N cycles at one level that nearly equals a whole number of days. The run is compared with real days, and the slow mismatch accumulates as **drift**.
- **Major and minor periods**: depths 1–4 (α β γ δ, Alpha to Delta) are the **major** (ultrahelion) periods, said in words. Below them the **minor** (infrahelion) units Nuclide, Helion, Preon, Flavon and Blink take every other depth (5, 7, 9, 11, 13) and are said in letters and counts. §15 defines the notation.

## 2. Time base

### 2.1 Time scale: Unix seconds

Clients work in **Unix seconds**: POSIX time, UTC-based, with every day exactly 86,400 s. The catalogue ships precomputed in Unix seconds (§14). A client feeds the device clock straight in, `t = Date.now() / 1000` or `Date().timeIntervalSince1970`, and needs no TT conversion or leap-second table.

NASA publishes the instants in **TT** (Terrestrial Time; NASA labels them TD). The Unix table is derived once, offline, with the reference library's civil model:

| Era | Conversion | Status |
|---|---|---|
| 1972 – 2027-06-28 | `UTC = TT − (TAI − UTC) − 32.184 s`, using the published leap-second table | exact |
| before 1972 | UT1 estimate `TT − ΔT`, from the NASA ΔT polynomials | approximate (seconds to minutes, growing with age) |
| after the table | TAI − UTC held at 37 s, consistent with the 2022 decision to stop leap seconds by 2035 | projection; a further leap second before 2035 would shift later values by 1 s each |

Values are rounded to milliseconds. The library generates and exposes them as `F.defaults.unixTimestamps`, and `F.create({timeScale: 'unix'})` builds a clock on them. Regenerate the table if a new leap second is announced.

Properties of the Unix time base:

- **Days are civil days.** 86,400 Unix seconds is one UTC day, so the solar sync (§7) is measured against the civil clock, leap seconds included.
- **Leap seconds sit inside intervals.** A Saros interval in Unix seconds is shorter than in TT by the leap seconds inserted inside it: 14 s in 1973–1992 and 3 s in 2010–2028. Readings between eclipses therefore differ from a TT-interpolated clock by less than that count (under 3 s since 2010, 0.22 s in October 2026), and agree exactly at every eclipse.
- **TT clock.** For scientific work the library also provides a TT clock: `F.create()` (TT is its default scale), with `F.fromUTC` for input.

Never mix the two: a Unix catalogue takes Unix query times, and a TT catalogue takes TT query times.

### 2.2 Position from time

The catalogue holds instants `E[0] < E[1] < … < E[n]` with ordinals `0, 1, …, n`. Ordinals are consecutive unless the catalogue skips recurrences.

```
position(t) = k + (t − E[k]) / (E[k+1] − E[k])     where E[k] ≤ t < E[k+1]
time(position) = E[k] + (position − k) · (E[k+1] − E[k])      k = floor(position)
```

This mapping is piecewise linear and exactly invertible. Each Saros interval keeps its real, slightly different length. **Never substitute a mean Saros length**: real intervals differ from the mean by up to ±1.2 h, which changes every derived period and drift (see §7.4).

`t` and `E[k]` are Unix seconds (§2.1). Outside `[E[0], E[n]]` the clock is undefined. Clients show nothing, or an explicit "out of catalogue" state; they must not extrapolate. The last partial cycle at each level is clipped at `E[n]`.

### 2.3 Catalogue data before 1582 (when building a table)

NASA lists dates before 1582-10-15 in the **Julian** calendar. Some data sources store those calendar fields as if they were Gregorian; `saros-eclipse` 0.1.0 is one. Such timestamps are wrong by the calendar difference: 10 days near 1582, and one day less for each century before that. An interval spanning the reform appears 10 days too long, and intervals spanning a Julian-only leap day lose a day.

Fix: take the stored value's proleptic-Gregorian calendar fields, reinterpret them as a Julian date, and convert back. The library function is `F.correctJulianTimestamp(seconds)`.

```
days    = floor(s / 86400);  within = s − 86400·days
(y,m,d) = civilFromDays(days)            // proleptic Gregorian
JDN     = d + floor((153·m' + 2)/5) + 365·y' + floor(y'/4) − 32083
          where a = floor((14 − m)/12), y' = y + 4800 − a, m' = m + 12a − 3
fixed   = (JDN − 2440588)·86400 + within
```

After the fix, the mean of all 13,026 solar Saros intervals is 6585.3213 days, which agrees with the theoretical 6585.3211 days to 0.3 min. Note that the Saros 141 catalogue starts in 1613 and needs no correction.

## 3. Harmonic hierarchy

### 3.1 Factors and prefixes

The default factor sequence repeats:

```
S = [5, 13, 5, 5, 7, 11, 9, 4]
P(0) = 1,   P(L) = P(L−1) · S[(L−1) mod 8]
```

A level-L cycle spans `4 / P(L)` Saros units. Level L contains `S[L mod 8]` cycles of level L+1. A level-L cycle has `S[(L−1) mod 8]` **siblings**, meaning cycles of its own level inside one level L−1 parent.

### 3.2 Cycle index and local index

```
cycle(L)  = floor(position · P(L) / 4)
local(L)  = cycle(L) mod siblings(L)        // 0 = first period of the parent
```

### 3.3 Period lengths

These figures use the 2010–2028 Saros 141 interval. Lengths change slightly between intervals.

| Depth | Level | Name | Unit (§15) | P(L) | Siblings | Cycle length |
|---|---|---|---|---|---|---|
| 1 | 0 | α | Alpha | 1 | — | 72.12 y |
| 2 | 1 | β | Beta | 5 | 5 | 14.42 y |
| 3 | 2 | γ | Gamma | 65 | 13 | 1.11 y |
| 4 | 3 | δ | Delta | 325 | 5 | 81.050 d |
| 5 | 4 | ε | Nuclide | 1,625 | 5 | 16.210 d |
| 6 | 5 | ζ | — | 11,375 | 7 | 2.316 d |
| 7 | 6 | η | Helion | 125,125 | 11 | 5.052 h |
| 8 | 7 | θ | — | 1,126,125 | 9 | 33.683 min |
| 9 | 8 | ι | Preon | 4,504,500 | 4 | 8.421 min |
| 10 | 9 | κ | — | 22,522,500 | 5 | 1.684 min |
| 11 | 10 | λ | Flavon | 292,792,500 | 13 | 7.773 s |
| 12 | 11 | μ | — | 1,463,962,500 | 5 | 1.555 s |
| 13 | 12 | ν | Blink | 7,319,812,500 | 5 | 310.92 ms |
| 14 | 13 | ξ | — | 51,238,687,500 | 7 | 44.42 ms |

### 3.4 Period names

Level L is named with Greek letter `L mod 24` of `αβγδεζηθικλμνξοπρστυφχψω`. After ω the letters repeat with a numeric suffix: level 24 is α1, level 49 is β2. The library function is `F.periodName(level)`. The time units built on these levels, and the names of individual cycles, are defined in §15.

## 4. Phase glyphs

### 4.1 States

A glyph with **d strokes** encodes balanced-ternary values with extreme

```
M = (3^d − 1) / 2          d = 2 → M = 4,  d = 3 → M = 13,  d = 4 → M = 40
```

One cycle has `4M` states, numbered 0 to 4M−1. For an ascending family (the default):

```
index(L, d) = floor(position · P(L) · M) mod 4M
```

A descending family adds 2M before the modulo.

Each state has a value and a derivative:

| Index range | Value | Derivative | Dot |
|---|---|---|---|
| 0 … M−1 | index | +1 (rising) | no |
| M | M | 0 (peak) | no |
| M+1 … 3M−1 | 2M − index | −1 (falling) | **yes** |
| 3M | −M | 0 (valley) | no |
| 3M+1 … 4M−1 | index − 4M | +1 (rising) | no |

Two strokes (16 states):

```
0  1  2  3  4  3• 2• 1• 0• -1• -2• -3• -4  -3  -2  -1
```

Three strokes (52 states):

```
0 … 13,  12• … -12•,  -13,  -12 … -1
```

**Dot convention:** the derivative dot marks the falling branch. Every repeated value then reads bare while rising and dotted while falling, and both extrema are bare.

### 4.2 Trits

A value v in −M…M has d balanced-ternary digits (trits) t ∈ {−1, 0, +1}:

```
v = Σ t_i · 3^i      (i = 0 is the least significant trit)
```

The library returns trit arrays most significant first.

## 5. Odometer read-out

A level-L odometer has k glyphs of d strokes each. With `q = 4M`:

```
step   = floor(position · P(L) · M · q^(k−1)) mod q^k
digit_j = floor(step / q^(k−1−j)) mod q          j = 0 (left) … k−1 (right)
```

Digit 0 always equals the single-glyph index from §4.1. Digit j runs one full q-state cycle while digit j−1 holds one state. The finest digit next changes at `position = (floor(position·P(L)·M·q^(k−1)) + 1) / (P(L)·M·q^(k−1))`. Schedule screen updates from that time rather than polling. The library function is `clock.phaseDigits(position, level, {strokes, digits})`, which returns `next` and `nextTime`.

At depth 7 with 2 two-stroke glyphs, the major glyph changes every 18.9 min and the sub glyph every 71 s. At depth 8 they change every 2.1 min and 7.9 s.

## 6. Counters and thresholds

### 6.1 Sibling counter

Show `siblings(L)` markers, one per period of the parent. Light the markers 0 … local(L), meaning all periods up to and including the current one. The library function is `clock.counterAt(position, level)`.

### 6.2 Thresholds

A cycle has four quarter boundaries. For an ascending family they are:

| Quarter end | Name | Glyph state reached |
|---|---|---|
| 1/4 | peak | index M (value +M) |
| 2/4 | node | index 2M (value 0, falling) |
| 3/4 | valley | index 3M (value −M) |
| 4/4 | end | next cycle, index 0 |

A descending family reaches its valley first. The next threshold is the first boundary strictly after `position`; its time is `time(boundary)`. The library function is `clock.nextThreshold(position, level)`, which returns `{name, position, time}`.

## 7. Solar sync

### 7.1 Definition

Choose a level L, a cycle count N and a day count D such that `N · cycle(L) ≈ D days`. Choose an anchor ordinal A whose eclipse starts a level-L cycle; `A · P(L)` must be divisible by 4.

```
anchorCycle = A · P(L) / 4
sync        = floor((cycle(L) − anchorCycle) / N)
syncStart   = time((anchorCycle + N·sync) · 4 / P(L))
syncEnd     = time((anchorCycle + N·(sync+1)) · 4 / P(L))
phase       = (t − syncStart) / (syncEnd − syncStart)        // time-linear, 0 ≤ phase < 1
nominal     = E[A] + sync · D · 86400
drift       = syncStart − nominal                            // accumulated seconds against civil days
```

Sync boundaries coincide exactly with level-L cycle boundaries. Each sync's own offset is `N · cycle(L) − D · 86400`, which depends on the Saros interval the sync falls in.

The library function is `clock.solarSync({anchor, level, cycles, days, daySeconds})`. Its `.at(t)` returns sync, times, phase, drift and the next quarter threshold; `.digits(t, {strokes, digits})` returns odometer digits. `t` is in the clock's time scale, Unix seconds for a Unix clock.

### 7.2 Reference configuration (Saros 141)

- **Anchor:** A = 20, the first eclipse of Alpha 6, at Unix 125593319.816 (1973-12-24 15:01:59.816 UTC; 15:02:44 TT).
- **Period:** L = 6 (depth 7, η), N = 19, D = 4. The relation 19 × 5.052 h ≈ 4 days.
- **Per-sync offset (Unix seconds):** −10.0309 s (1973–1992), −10.0582 s (1992–2010), −10.0807 s (2010–2028), −10.2204 s (2028–2046). The depth-7 grid runs slightly short of civil days, so each sync lands about 10 s earlier. In TT the same offsets are −10.0224, −10.0534, −10.0789 and −10.2204 s; the difference is the leap seconds inside each interval.
- **Equivalent statements:** 171 depth-8 ticks ≈ 4 days, and 171 depth-9 ticks ≈ 1 day. Since 171 · T9 = 19 · T7 / 4 exactly, these are the same drift, about −2.52 s per day.
- **Lap:** the accumulated drift first passes −86,400 s at the sync of 2067-02-01 15:01:58 UTC, 93.11 years after the anchor. At that point the sync time of day has gone once around the clock back to the anchor's 15:02 UTC.

### 7.3 Display of the sync

- **Odometer:** show the phase as k glyphs of d strokes, `digits = floor(phase · q^k)` split as in §5.
  - The reference uses 3 two-stroke glyphs: 6 h, 22.5 min and 84 s per state, with 4 left states per day.
  - The alternative is 2 three-stroke glyphs: 1.85 h and 2.1 min per state.
- **Thresholds:** quarters of the sync period, at `syncStart + q/4 · (syncEnd − syncStart)`. They fall about one day apart and are named peak, node, valley and end.
- **Sync time:** the local clock time of `syncStart`, read directly from the Unix value. It moves about 10 s earlier per sync and completes one lap in about 93 years.

### 7.4 Why actual intervals matter

These statistics use the TT intervals of every series. The mean Saros (6585.3211 d) gives −10.77 s per sync and a lap of 87.86 years, which differs visibly from the catalogue values above. Across all solar and lunar series, real intervals range from 6585.2595 d to 6585.3712 d. That puts the per-sync drift between −14.0 s and −8.1 s, and the lap between 68 and 116 years. Where an eclipse falls in Earth's orbit explains about 71% of the variation: intervals starting near perihelion are about 46 min longer, and those near aphelion are about 44 min shorter. No real interval comes close to the 6585.5263 d needed for zero drift, so this drift never runs forward.

## 8. Display model

The elements below are platform-neutral. The reference watch face is one arrangement of them, on a 192 × 490 px pill-shaped screen.

| Element | Content | Notes |
|---|---|---|
| Period pair (×2) | Odometer of 2 two-stroke glyphs at levels L and L+1 | Longer period at the top. Default depth 7 over depth 8. Teal (#4FD1C5). |
| Sibling counter (×2) | `siblings(L)` dots, lit through `local(L)` | On an arc concentric with the rounded screen end (top arc for the top period). Spread symmetrically, read left to right. |
| Solar odometer | Sync-phase odometer from §7.3 | Between the period pairs. Yellow (#FFD60A). |
| Period letters | Greek names from §3.4 | Shown briefly after a depth change, or permanently on request. Placed in the gaps beside the solar odometer. |
| Info labels | Next threshold of the top period; next solar threshold; sync time | Shown on request for a few seconds; they replace the letters while visible. Local time with seconds, or `Mon D HH:MM` when the time falls on another day. |

Reference geometry for the watch face:

- Glyph stems are 80 px apart in period pairs and 64 px apart in the three-glyph solar odometer; a 192 px width fits no more.
- Counter arcs have radius `width/2 − 10` and an 11.5° step.
- Period pairs sit ±165 px from the screen centre, and letters and labels ±90 px.

## 9. Rendering glyphs

### 9.1 Geometry (design units)

All dimensions are in design units:

- Stem segment per trit: 3.
- Stroke reach: 2.
- Curve bow: 1.
- Zero bar width: 2.
- Ink thickness: 0.3.
- Caps and joins: round.

Trit i (least significant first) occupies the stem from `y = 3i` to `3i + 3`, with its stroke attached at `y = 3i`. The least significant trit is at the top.

| Trit | Path at junction y |
|---|---|
| 0 | `M -1 y L 1 y` (horizontal bar) |
| +1 | `M 0 y C 0 y 0 y+1 1 y+1 C 2 y+1 2 y 2 y` (curve down and right) |
| −1 | `M 0 y C 0 y 0 y−1 −1 y−1 C −2 y−1 −2 y −2 y` (curve up and left) |
| stem | `M 0 3i L 0 3i+3` for each trit |
| dot | circle at (0, −1.75), radius 0.3, filled, only on dotted states |

The bounds of a d-stroke glyph are `x ∈ [−2.15, 2.15]` and `y ∈ [−2.2, 3d + 0.15]`. Bounds depend only on d, never on the value. The library function `CBT.fromIndex(index, {depth: d}).toSVG(style)` produces exactly these paths.

### 9.2 Pixel-perfect raster

Choose an integer scale u (px per unit) such that `0.3 · u` is an odd integer; the reference uses u = 10, giving a 3 px stroke. Then place the origin on a pixel centre:

```
frame x from −2.65,  width 5.3  → 53 px; x = 0 at pixel column 26.5
frame y from −2.45,  height 3d + 3 → 90 px (d=2) / 120 px (d=3); y = 0 at row 24.5
```

Every stem and bar then sits on whole pixel columns or rows with no anti-aliasing; only curves and the dot are smoothed. Draw at exactly 1:1 and never scale at runtime. In the library, `style {scale: 10, pixelAlign: true}` produces such a frame, with slightly larger padding.

On iOS, rasterise with the same arithmetic at the device scale. For example, at 3× use u = 10 px per unit with a 3 px stroke, laid out in points at 10/3 pt per unit. Alternatively, prerender PNGs per state and colour as the watch face does. Snap glyph image origins to whole pixels.

## 10. Interaction and refresh

- **Depth stepping:** tapping the top region moves to a longer period (depth − 1); tapping the bottom moves to a shorter one (depth + 1). Clamp the top depth to 2…11 on a watch and remember the choice. From depth 11 down, the sub glyph changes faster than about 50 ms (30 ms at depth 11, 6 ms at depth 12) and skips states on screen.
- **Info:** a single tap in the middle shows the info labels for about 4 s. A double tap (two taps within 400 ms) toggles persistent period letters.
- **Refresh:** recompute at the next state change of the finest visible glyph (from `nextTime`), or poll at a fraction of that interval, never faster than the display can show.
- **Battery:** avoid animations such as blinking. The finer glyph already shows how soon the coarser one rolls over.
- **Local time:** use the platform time zone. On devices without one, derive the UTC offset from the wall clock (`local − UTC`, rounded to 15 min), and reject offsets beyond ±14 h. Simulators may report a frozen wall clock.

## 11. Numeric implementation

The reference library uses exact BigInt rationals. A client using IEEE-754 doubles (Swift `Double`) must avoid multiplying a whole position by a large `P(L)`:

```
position = (ordinal: Int, fraction: Double)
units    = P(L) · M · q^(k−1)                       // exact integer
step     = ordinal · units + floor(fraction · units)
```

The Unix table has millisecond decimals; storing them as doubles is accurate to well under a microsecond. `ordinal · units` must stay below 2^53, or 2^63 with Int64. The error in `floor(fraction · units)` is about `units · 1.1e−16`, which is negligible for every level and odometer used here. Times from rational positions, `time(N / D)`, should split `N` into `ordinal = N div D` and `(N − ordinal·D)/D` before interpolating. The Saros 141 watch-face port, running on doubles and the Unix table, agrees with the library's exact Unix clock on 4,800 randomly sampled glyph states.

Swift has no built-in BigInt. Int64 holds `P(L)` well beyond depth 14. For exact rational work, such as exporting calendars or deep levels, use a BigInt package or port the library's rational helpers.

## 12. Test vectors

These are Saros 141 vectors on the Unix clock (`F.create({timeScale: 'unix'})`) with the default sequence, ascending family and anchor 20 / level 6 / 19 cycles / 4 days. Times are Unix seconds; ISO strings are UTC.

**A: 2026-10-08T12:00:00Z** (Unix 1791460800, position 22.927850216635)

| Quantity | Depth 7 (L=6) | Depth 8 (L=7) |
|---|---|---|
| index / value / derivative | 13 / −3 / +1 | 5 / 3 / −1 (dotted) |
| odometer digits (2 × 2-stroke) | [13, 0] | [5, 4] |
| cycle / local / siblings | 717211 / 0 / 11 | 6454906 / 7 / 9 |
| next threshold | end at 1791464172.428 (12:56:12.428Z) | node at 1791461140.937 (12:05:40.937Z) |
| 3-stroke index / value | 42 / −10 | — |

The solar sync at A:

| Quantity | Value |
|---|---|
| sync | 4820 |
| start | 1791336849.826 (2026-10-07T01:34:09.826Z) |
| end | 2026-10-11T01:33:59.745Z |
| phase | 0.358662585 |
| drift | −48469.9899 s |
| digits (3 × 2-stroke) | [5, 11, 13] |
| digits (2 × 3-stroke) | [18, 33] |
| next threshold | node at 1791509644.786 (2026-10-09T01:34:04.786Z) |

**B: 2000-01-01T00:00:00Z** (Unix 946684800, position 21.443111640256)

| Quantity | Value |
|---|---|
| depth 7 | index 5 (3, dotted); digits [5, 6]; local 9 of 11; next node at 946687783.046 (00:49:43.046Z) |
| depth 8 | index 0; digits [0, 6]; local 3 of 9; next peak at 946685256.803 (00:07:36.803Z) |
| solar | sync 2375; start 946369476.520 (1999-12-28T08:24:36.520Z); phase 0.912420883; drift −23843.2957 s; digits [14, 9, 9]; next end at 946715066.462 |

**C: 2061-06-15T18:30:00Z** (Unix 2886085800, position 24.851712757369)

| Quantity | Value |
|---|---|
| depth 7 | index 10 (−2, dotted); digits [10, 3]; local 0 of 11; next valley at 2886087806.395 (19:03:26.395Z) |
| depth 8 | index 12 (−4, valley); digits [12, 1]; local 5 of 9; next end at 2886086290.651 (18:38:10.651Z) |
| solar | sync 7987; start 2061-06-12T16:31:59.691Z; phase 0.770510076; drift −81000.1249 s; digits [12, 5, 4]; next end at 2886165109.343 |

**Anchor:** Unix 125593320.816 (one second after the anchor eclipse) gives sync 0, drift 0 and digits [0, 0, 0].

## 13. Pitfalls

1. **Mixed time scales.** The client catalogue and query times are both Unix seconds. Adding a TT offset to device time, or using the TT table with device time, shifts every reading by about 69 s today.
2. **Mean Saros.** Use real intervals (§7.4); the mean is wrong by up to 1.2 h per interval.
3. **Julian dates.** Pre-1582 catalogue data may need the correction in §2.3.
4. **Float precision.** Split position into ordinal and fraction (§11).
5. **Dot branch.** The dot marks the falling branch only (§4.1).
6. **Depth vs level.** Depth = level + 1. Names and siblings use the level, so siblings(L) = S[(L−1) mod 8].
7. **Final clipped cycle.** At the end of the catalogue the last cycle is clipped. Do not invent later events.
8. **Stale table.** If a leap second is announced, regenerate the Unix table from the TT source (§2.1); values after it move by 1 s.

## 14. Reference data

Solar Saros 141, greatest eclipse in **Unix seconds** (UTC), derived as in §2.1. Index = ordinal; ordinal 0 is 1613-05-19 and ordinal 69 is 2857-06-13. Ordinals 0–19 (before 1972) are ΔT estimates, 20–22 are exact, and 23–69 assume TAI − UTC = 37 s.

```
 -11253795486.968  -10684827340.124  -10115859492.780   -9546891859.112   -8977924443.862
  -8408957014.511   -7839989594.977   -7271021955.471   -6702054209.003   -6133086036.449
  -5564117571.512   -4995148587.324   -4426179194.600   -3857209183.600   -3288238731.185
  -2719267740.393   -2150296298.803   -1581324369.140   -1012352078.953    -443379486.426
    125593319.816     694566278.816    1263539192.816    1832512069.816    2401484716.816
   2970457153.816    3539429150.816    4108400821.816    4677371985.816    5246342709.816
   5815312911.816    6384282725.816    6953252120.816    7522221116.816    8091189841.816
   8660158322.816    9229126685.816    9798094931.816   10367063272.816   10936031708.816
  11505000323.816   12073969225.816   12642938471.816   13211908155.816   13780878253.816
  14349848916.816   14918820110.816   15487791887.816   16056764232.816   16625737153.816
  17194710612.816   17763684496.816   18332658871.816   18901633551.816   19470608536.816
  20039583596.816   20608558814.816   21177533934.816   21746508965.816   22315483725.816
  22884458266.816   23453432422.816   24022406224.816   24591379597.816   25160352610.816
  25729325154.816   26298297370.816   26867269191.816   27436240807.816   28005212035.816
```

The TT source values (NASA/GSFC, Espenak and Meeus) are `F.defaults.timestamps` in `fractonica.js`, and the Unix values are `F.defaults.unixTimestamps`. Unix = TT − 69.184 s for every ordinal from 23 on.

## 15. Time units and notation

This section defines how a client says a moment and a span **in Fractonica terms only**, without Gregorian dates, Earth time units or percentages. The web client's pure mode uses it throughout. The arithmetic is §3; nothing here changes a reading.

### 15.1 Major and minor periods

The ladder has two parts with a clear break between them.

- **Major (ultrahelion) periods** are depths 1–4: Alpha, Beta, Gamma and Delta. They are said in **words**, with a fracton ordinal and a quarter word (§15.2). Their phase is never drawn, because it follows from the Nuclide and Helion count below them.
- **Minor (infrahelion) units** take **every other depth** below Delta: Nuclide (depth 5), Helion (7), Preon (9), Flavon (11) and Blink (13). They are said in **letters and counts**. The depths in between (ζ θ κ μ, and ξ and finer) remain levels of the hierarchy but are not units and have no names of their own.

| Unit | Symbol | Depth | Made of | Mean length (§3.3) | Everyday analogue |
|---|---|---|---|---|---|
| Alpha | α | 1 | 5 Beta | 72.12 y | an era |
| Beta | β | 2 | 13 Gamma | 14.42 y | |
| Gamma | γ | 3 | 5 Delta | 1.11 y | a year |
| Delta | δ | 4 | 5 Nuclide | 81.05 d | a month |
| Nuclide | ε | 5 | 77 Helion (7 ζ × 11 η) | 16.21 d | a week |
| **Helion** | η | 7 | 36 Preon (9 θ × 4 ι) | 5.052 h | an hour |
| **Preon** | ι | 9 | 65 Flavon (5 κ × 13 λ) | 8.421 min | a minute |
| **Flavon** | λ | 11 | 25 Blink (5 μ × 5 ν) | 7.773 s | a second |
| Blink | ν | 13 | — | 310.92 ms | the finest unit; one tick of real time |

Helion, Preon and Flavon are the everyday units, used like hours, minutes and seconds. The Helion is the unit that locks to the Sun: 19 Helions make one solar sync of about 4 days (§7.2). The analogues are for orientation only; a client in Fractonica-only mode never shows them.

### 15.2 Names of major periods

A major cycle is named by its level name and a **fracton ordinal**: its 1-based position inside its parent, `local(L) + 1` (for Alpha the global `cycle(0) + 1`).

| n | Ordinal | n | Ordinal | n | Ordinal |
|---|---|---|---|---|---|
| 1 | Monofracton | 7 | Heptafracton | 13 | Tridecafracton |
| 2 | Difracton | 8 | Octafracton | 14 | Tetradecafracton |
| 3 | Trifracton | 9 | Nonafracton | 15 | Pentadecafracton |
| 4 | Tetrafracton | 10 | Decafracton | 16 | Hexadecafracton |
| 5 | Pentafracton | 11 | Didecafracton | 17 | Heptadecafracton |
| 6 | Hexafracton | 12 | Dodecafracton | 18 | Octadecafracton |

So "Delta Trifracton" is the 3rd Delta of its Gamma. Saros 141 needs ordinals up to 18 for Alpha, 5 for Beta, 13 for Gamma and 5 for Delta. Only the four major levels have fracton names.

The name is followed by the **quarter** the cycle is in, named by the threshold that ends it (§6.2):

```
quarter(L) = floor(4 · phase(L))        phase(L) = frac(position · P(L) / 4)
0 → Peak    1 → Node    2 → Valley    3 → End
```

"Delta Trifracton Node" is the second quarter of the 3rd Delta, the one that ends at its node.

### 15.3 Counts, ordinals and the date

Numbers in a reading are written in two forms:

- `X#n` is an **ordinal**, counted from 1: `δ#3`, `ε#2`. Majors in letter form, and the Nuclide, use it.
- `nX` is used for the minor clock and for spans. In a date or clock the **Helion is numbered from 1** (`1η` … `77η`
  inside its Nuclide), like the day of a month. Preons, Flavons and Blinks are **counts of completed units from 0**,
  like hours and minutes. In a span every part is a count: `5η 12ι` lasts five Helions and twelve Preons.

The minor reading of a moment is the Nuclide ordinal, the Helion's number and three counts, from the local indices of §3.2:

```
ε  = local(4) + 1                       1 … 5    Nuclide inside its Delta
η  = 11 · local(5) + local(6) + 1       1 … 77   the Helion's number in the Nuclide
ι  = 4  · local(7) + local(8)           0 … 35   Preons completed in the Helion
λ  = 13 · local(9) + local(10)          0 … 64   Flavons completed in the Preon
ν  = 5  · local(11) + local(12)         0 … 24   Blinks completed in the Flavon
```

A **date** is the major periods in words, then the minor reading. Flavons and Blinks are optional, like seconds.

| Form | Example |
|---|---|
| Full | `Alpha Pentafracton Peak, Beta Tetrafracton Valley, Gamma Difracton End, Delta Trifracton Node, ε#2 5η 5ι 5λ 5ν` |
| Short | `Delta Trifracton Node ε#2 5η 5ι` |
| Letters | `α#5 β#4 γ#2 δ#3 ε#2 5η 5ι 5λ` |
| Short letters | `δ#3 ε#2 5η 5ι` |

The letter forms omit the quarter words, which the counts imply. The full letter form is the **stamp**: it identifies a moment exactly and can be read back. The Nuclide ordinal is required because a Delta has 5 Nuclides but 4 quarters, so a quarter alone does not say which Nuclide a Helion count belongs to.

The basic reading on screen is the **Helion**: its number in the Nuclide and its phase as an odometer of two 2-stroke glyphs (§5 at depth 7, 256 states of about 71 s each). Preons and Flavons give the fine time.

A minor cycle has no name of its own; it is identified by where it starts in its Nuclide. For example, a depth-9 cycle is `ε#2 5η 9ι`, a depth-8 cycle `ε#2 5η 8ι` (θ starts on multiples of 4ι), and a depth-14 cycle `… 3.43ν` (finer than a Blink, so a decimal).

### 15.4 Spans

A span is a list of counts over the ladder α β γ δ ε η ι λ ν, taken greedily from the largest unit that fits. Units with a zero count are skipped, so a span reads `3η 5λ`, never `3η 0ι 5λ`. Two non-zero parts are the default precision. Spans shorter than one Flavon that are led by the Blink keep a decimal (`2.6ν`, `0.14ν`). Measure spans in position, not in seconds, so they stay exact across Saros intervals.

Exact cycle lengths: depths 1–5, 7, 9, 11 and 13 are one unit each. The depths between are whole counts of the next unit: ζ = `11η`, θ = `4ι`, κ = `13λ`, μ = `5ν`, and ξ = `0.14ν`.

### 15.5 Real time: Blinks and pB

Real time is counted in **Blinks**; one Blink is the mean ν cycle, 310.92 ms.

- **Speed.** A time-lapse rate r (displayed seconds per real second) is said as units per Blink: `r · T(ν) / T(unit)`. The natural presets are whole counts: `5ν` (5×), `λ` (25×), `13λ` (325×), `ι` (1,625×), `4ι` (6,500×), `η` (58,500×), `11η` (643,500×), then `ε`, `δ`, `γ` per Blink. Real time itself is one Blink per Blink.
- **Frequency.** A frequency is said in **cycles per Blink (pB)**: `f_pB = f_Hz · T(ν)`. The true rates of the depths below the Blink are whole numbers: ξ 7, ο 77, π 693 and ρ 2,772 pB. A 110 Hz tone is 34.2 pB.

### 15.6 Test vectors

These use the vectors of §12. The Helion pair is the depth-7 odometer of §12, and the minor reading is §15.3 with Blinks.

| Vector | Full date | Short date | Helion pair |
|---|---|---|---|
| A | `Alpha Hexafracton Valley, Beta Tetrafracton Valley, Gamma Nonafracton Valley, Delta Trifracton End, ε#5 34η 29ι 21λ 3ν` | `Delta Trifracton End ε#5 34η 29ι` | [13, 0] |
| B | `Alpha Hexafracton Node, Beta Difracton End, Gamma Didecafracton Node, Delta Trifracton Node, ε#2 21η 12ι 6λ 5ν` | `Delta Trifracton Node ε#2 21η 12ι` | [5, 6] |
| C | `Alpha Heptafracton Peak, Beta Difracton Peak, Gamma Monofracton End, Delta Pentafracton Peak, ε#2 1η 23ι 1λ 21ν` | `Delta Pentafracton Peak ε#2 1η 23ι` | [10, 3] |
| Anchor + 1 s | `Alpha Hexafracton Peak, Beta Monofracton Peak, Gamma Monofracton Peak, Delta Monofracton Peak, ε#1 1η 0ι 0λ 3ν` | `Delta Monofracton Peak ε#1 1η 0ι` | [0, 0] |

The stamp at A is `α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ 3ν`. At A the depth-7 end is 3,372.428 s away (§12), which is the span `6ι 43λ`.
