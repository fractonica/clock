# Fractonica Clock – architecture and module contract

A zero-build web app: static files, vanilla ES modules, no runtime dependencies. `fractonica.js`
(the reference library, untouched) is loaded with a classic `<script>` and exposes
`globalThis.Fractonica`. Everything else is ES modules under `src/`.

```
index.html                 shell: header, tabs, columns, <link> per module stylesheet
fractonica.js              reference library (do not edit)      SPEC.md   the specification
src/main.js                bootstrap, header, tabs, keyboard, single requestAnimationFrame loop
src/core/model.js          the only code that talks to fractonica.js
src/core/store.js          displayed time (live / time travel / time-lapse) + shared settings
src/core/format.js         zone-aware Gregorian formatting and conversion, durations, countdowns
src/core/theme.js          colours (TEAL, GOLD, level hues) and glyph style helper
src/core/pure.js           pure-mode vocabulary: cycle names, major periods in words (Alpha … Delta) and minor units in letters (Nuclide, Helion, Preon, Flavon, Blink; SPEC.md §15), Blinks and pB for real time, phase pairs, pure clock/date/stamps (docs/design/80-pure.md)
src/ui/*.js                one module per UI region (face, rings, ladder, upnext, timeline, wave,
                           calendar, jump, sound)  –  helpers go in src/ui/<module>/
src/audio/*.js             sonification engine (pure scheduling/tuning + Web Audio)
src/diary/*.js             the printable diary of one Delta: options, page plan, ephemeris (astro/), page renderers (docs/design/90-diary.md)
src/styles/app.css         tokens + shell + shared components;  src/styles/<module>.css per module
test/*.test.js             node --test (model + format cover SPEC §12 test vectors)
tools/browse.mjs           headless Chromium harness (static server + Playwright core, collects console errors)
tools/checks/*.mjs         headless-browser regression checks, one per module + shell (`npm run check`)
tools/probes/*.mjs         screenshot / measurement helpers (not assertions)
```

Run: `npm start` (any static server works) and open http://localhost:5199.
Test: `npm test` (pure logic, no browser). Browser checks: `npm run check` (needs Playwright core and a
Chromium; `tools/browse.mjs` finds the global install, or set `PLAYWRIGHT_CORE` / `CHROMIUM`).

## Time

- All times are **Unix seconds as JS Number** (UTC, 86 400 s days). The catalogue is Saros 141,
  `1613-05-19 .. 2857-06-13`. Outside it nothing is shown (`frame.inRange === false`), never extrapolated.
- **Level** is zero-based, **depth = level + 1** (user-facing). Levels 0..13 (α..ξ, depth 1..14) are shown.
  Level L cycle = `4 / P(L)` Saros, `P = 1,5,65,325,1625,11375,125125,…` (SPEC §3).
- `store.t()` is the displayed time. `store.mode` is `'live'` (device clock) or `'travel'`
  (anchored time advancing at `store.rate` displayed-seconds per real second; 0 = paused).
  Views never keep their own clock: read `frame.t` / `store.t()`.
- Navigate with `ctx.goto(t)` (= `store.setTime`). Discontinuities fire `store.onTime(reason)`.

## Model (`src/core/model.js`) – `ctx.model`

| Call | Returns |
|---|---|
| `levelInfo(L)` | static: `depth, letter, text, factor` (children per cycle), `siblings` (cycles per parent, null for α), `prefixNum, meanSeconds` |
| `levelAt(t, L, {strokes})` | full reading: `cycle, local, siblings, phase (0..1, exact), progress (time-linear), quarter, index/value/derivative/dotted/trits, start, end, duration, remaining, next{name,time}, thresholds[]` or `null` out of range |
| `odometerAt(t, L, {strokes, digits})` | `{digits[], states, nextTime}` (SPEC §5) |
| `solarAt(t)` | solar sync: `sync, start, end, phase, drift, quarter, threshold{name,time}, digits3, digits2x3, nominalStart` |
| `solarSyncByNumber(n)` | `{sync,start,end,nominalStart,drift}` or null |
| `addressAt(t)` | 5-level calendar address `[Alpha..Epsilon]`, 1-based |
| `pathToCycle(path)` / `cycleToPath(L, idx)` | 1-based hierarchical path ⇄ global cycle index (BigInt) |
| `cycleByIndex(L, idx)` / `cycleAt(t, L)` | `{start,end,duration,clipped,events[begin,firstPeak,middleNode,oppositePeak,end]}` |
| `boundaries(L, t0, t1, limit)` | cycle start times in a window `[{idx,local,time}]` |
| `upcomingEnds(t, {fromLevel,toLevel,count,perLevel})` | next cycle ends merged across levels: `[{time, top, levels[]}]` |
| `stateOccurrences(L, digits, t, {strokes,direction,count})` | when an odometer state shows next / previously |
| `positionOf(t)` / `timeOfPosition(p)` / `cycleStartTime(L, idx)` | float catalogue mapping (SPEC §11) |
| `frame(t)` | memoised snapshot passed to `render(frame, info)`: `t, inRange, pos, level(L), odometer(L), solar(), address()` |
| `tMin, tMax, extent, catalogue[]` | catalogue bounds (Unix s), 69 Saros intervals, the 70 eclipse instants |
| `F`, `clock`, `calendar` | raw library handles for anything not wrapped (glyph SVG via `F.CBT`, arcs via `clock.arc`, …) |

Quarter thresholds of a cycle are named `peak, node, valley, end` (ascending family, SPEC §6.2).

## Store (`src/core/store.js`) – `ctx.store`

`t()`, `mode`, `rate`, `playing`, `live`, `setTime(t)`, `shift(dt)`, `setRate(r)`, `pause()`, `goLive()`,
`subscribe(fn(kind, patch))`, `onTime(fn(reason))`, `set(patch)` and `state` (persisted to localStorage). Values are
validated: an unknown IANA zone, a non-integer or out-of-range depth, etc. is ignored and never persisted, and blocked
or garbage storage falls back to the defaults. Time-lapse stops at the catalogue edge (`onTime('edge')`). Settings:

`zone` (IANA or null = system), `pure` (pure mode: Fractonica terms only), `view` (active tab id), `topDepth` (2..11, depth of the upper period on the
face), `selectedLevel` (0-based level highlighted everywhere), `minDepth`/`maxDepth` (1..14, the depth range
shown by rings / ladder / timeline lanes), `showLetters`.

## Formatting (`src/core/format.js`) – `ctx.fmt`

Bound to the current zone: `date, time, dateTime, long, short, label(t, ref), tag, iso, inputValue,
parseInput, parts, toUnix, duration(sec), countdown(sec)`. Free functions `zonedParts`, `zonedToUnix`,
`daysInMonth`, `MONTHS_SHORT`, `WEEKDAYS_SHORT`.

## Module contract

```js
// src/ui/<name>.js
export function mount(el, ctx) {
  // build DOM inside `el` once; keep state in the closure
  return {
    render(frame, info),   // every animation frame while visible; info = {dt, t, real, dirty, view}
    setActive?(bool),      // tab visibility changed (tabs only)
    alwaysOn?: true,       // render even while hidden (side panels / sound engine)
    destroy?(),
  };
}
```

`ctx`: `F, model, store, fmt, pure, isPure(), theme, icons, goto(t), select(level), stepCycle(dir, level?), toast(msg),
requestRender(), QUARTER_NAMES, modules` (other mounted instances by id, e.g. `ctx.modules.sound`).

`info.dirty` is true when time or any setting changed since the previous frame: skip drawing when
`!info.dirty` and you have no animation / hover of your own. Call `ctx.requestRender()` after your own
state changes. A throwing `render` is isolated and logged once; a throwing `mount` shows an error card.

Slots: `face → #slot-face`, `ladder → #slot-ladder`, `upnext → #slot-upnext`, `jump → #slot-jump` (header),
tabs `rings / timeline / wave / calendar / sound / diary → #view-<id>`. Tab modules are only rendered while active.
The sound module must expose `{ enabled, toggle() }` for the header speaker button and keep running when
its tab is hidden (`alwaysOn: true`; drive audio scheduling from its own timer, not requestAnimationFrame).

## Conventions

- **Words and labels.** The user-facing number is the **depth** (never "level" in visible text). A bare letter + number
  such as `ε 5` is a *depth chip* (ε is always depth 5). An *ordinal* inside its parent is written with a hash:
  `ε#5` = the 5th ε inside its δ; an address chain reads `α#6 › β#4 › γ#9`; a global cycle index is `d7#717211`.
  Glyph states use the SPEC's 0-based index (`state 13 of 0–15`). Percentages through a cycle are floored (never
  `100 %` before the end). "Just before" (end − min(2 s, ¼ cycle)) and "Just after" (1 ms into the next cycle) name
  the two navigation actions around a turnover.
- **Shell.** `main.js` supplies a `ResizeObserver` fallback, mirrors `store.rate` in the header speed select, keeps the
  zone select in step with the store, and sets `--topbar-measured` (the real header height, used for sticky offsets and
  `scroll-padding`; `--topbar-h` is only the minimum). Header layout: three rows on phones via `display: contents`.

- Dark theme only. Tokens are CSS custom properties in `app.css`; canvas/SVG code takes colours from
  `core/theme.js` (`TEAL` for periods, `GOLD` for the solar odometer – SPEC §8 –, `levelColor(L)` per level,
  `NOW` / `CURSOR` markers). Prefix every CSS class with the module's prefix (`face-`, `rings-`, `ladder-`,
  `upnext-`, `tl-`, `wave-`, `cal-`, `jump-`, `snd-`, `dy-`).
- Canvas: size by `ResizeObserver` and `devicePixelRatio`; never draw at CSS-pixel resolution only.
- Glyphs come from the library: `F.CBT.fromIndex(index, {depth: strokes}).toSVG(style)` (SPEC §9).
- Deep links: `?t=<unix|ISO>&view=<tab>&zone=<IANA>&rate=<n>&depth=<top depth>&sel=<selected depth>`.
- `window.__fractonica = {ctx, model, store, fmt, instances}` is available for debugging and tests.
- Respect `prefers-reduced-motion`; everything interactive must work with keyboard and touch; layouts work
  from 360 px to 1920 px wide.
