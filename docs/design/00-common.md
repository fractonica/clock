# Common brief – read this first

## What we are building

A web app for the **Fractonica clock**: an eclipse-anchored harmonic clock. The Saros 141 eclipse series
(70 greatest-eclipse instants, 1613 → 2857, one every ~18.03 years) is the time base. A *position* in Saros
units is linear in time between eclipses. A harmonic hierarchy `S = [5,13,5,5,7,11,9,4]` (repeating) divides each
4-Saros "α cycle" into ever shorter cycles (β ≈ 14 y, γ ≈ 1.1 y, δ ≈ 81 d, ε ≈ 16 d, ζ ≈ 2.3 d, η ≈ 5 h,
θ ≈ 34 min, ι ≈ 8.4 min, κ ≈ 1.7 min, λ ≈ 7.8 s, μ ≈ 1.6 s, ν ≈ 0.31 s, ξ ≈ 44 ms). In pure mode depths 4–13 are
named units (δ Atom, ε Nuclide, ζ Hadron, η Helion, θ Quark, ι Preon, κ Chromon, λ Flavon, μ Somon, ν Blink; see
`docs/design/80-pure.md`). Each cycle at each level is
displayed as a balanced-ternary **phase glyph** (a wave: rising 0→peak, falling peak→valley, rising back to 0).
Odometers of 2–3 glyphs read a cycle with finer and finer resolution. A **solar sync** compares 19 depth-7
cycles with 4 civil days and tracks the accumulated drift. The full definition is `SPEC.md`; the reference
implementation is `fractonica.js` (do not edit either).

The app = a faithful implementation of the spec's clock **plus three additions** the owner asked for:
1. **Cycle visualisations** that make it intuitive where we are exactly, let you navigate, and estimate when the
   next major cycle turns over.
2. **Calendar mapping**: quickly go from Fractonica time to Gregorian time and back.
3. **Sonification** of the cycles.

Every feature is a module; you are building exactly one (your own brief follows this file). Other agents are
building the other modules **at the same time** in the same working tree.

## Read before you write

1. `docs/ARCHITECTURE.md` (module contract, model/store/format API) – authoritative.
2. `src/core/model.js`, `src/core/store.js`, `src/core/format.js`, `src/core/theme.js`, `src/main.js`,
   `src/styles/app.css`, `index.html` – shared code you build on. Skim the tests in `test/` for usage examples.
3. The parts of `SPEC.md` your brief cites. For library details read the header comment of `fractonica.js`
   (first ~290 lines) and the functions it points to.

## Rules

- **Own only your files** (listed in your brief). Do not edit `index.html`, `src/main.js`, `src/core/*`,
  `src/styles/app.css`, other modules' files, `SPEC.md`, `fractonica.js`, `package.json`. If you need a change
  there, finish your work without it (put helpers in your own files) and list it under `requests` in your report.
- Vanilla JS ES modules, no dependencies, no CDN, no fonts to download, no build step, works offline.
  Canvas 2D / SVG / DOM are all fine. Use `ctx.model` for every clock reading; never re-implement spec maths
  that the model/library already provide (a pure helper that converts/formats is fine).
- All times are Unix seconds. Respect the zone in `ctx.fmt` for anything Gregorian. Never extrapolate outside
  the catalogue: show an explicit, tidy out-of-range state instead.
- CSS: your own stylesheet only, every class prefixed with your module prefix; use the tokens in `app.css`
  (`var(--teal)`, `var(--panel-2)`, …) and `core/theme.js` colours. Reuse shared classes (`.card`, `.btn`, `.seg`,
  `.chip`, `.select`, `.input`, `.mono`, `.dim`) rather than restyling them.

## Quality bar

This is a showpiece, not a prototype. Aim for: considered layout and typography (tabular numbers for
anything that ticks), restrained colour (teal for periods, gold for the solar sync, per-level hues for
cycles), crisp canvas rendering on HiDPI, smooth 60 fps, no jank, no layout shift when numbers change,
meaningful empty / loading / out-of-range states, tooltips that teach, and **no placeholder text or TODOs**.
Everything must work with mouse, touch and keyboard (visible focus, aria labels / roles where relevant) and
respect `prefers-reduced-motion`. Layouts must hold from 360 px to 1920 px wide. Prefer clarity over
decoration: the goal is that someone who has never seen a Fractonica clock can understand *where they are in
each cycle and when it turns over*.

Performance budget: `render()` runs every animation frame – keep it under ~3 ms. Cache anything that only
changes per cycle or per second (`model.levelAt` and `model.upcomingEnds` are exact BigInt computations: call
them once per level per frame at most, and heavy ones at ≤ 4 Hz). No DOM writes when the text did not change.

## Verification (mandatory – do not report success without it)

1. `npm test` passes (add `test/<module>.test.js` for any pure logic you write: geometry, parsing, mapping).
2. Run the real app headlessly with the harness and **look at the screenshots** (the Read tool displays PNGs):

```js
// scratch script, e.g. node tools/<yourmodule>-check.mjs   (delete or keep under tools/, your choice)
import { withApp } from './browse.mjs';
await withApp(async ({ page, url, errors, shot }) => {
  await page.goto(url('?t=1791460800&view=rings'));      // deep link: frozen time, tab, zone=UTC optional
  await page.waitForTimeout(800);
  console.log(await shot('rings-desktop.png'));            // tools/out/rings-desktop.png
  // interact: page.click / page.mouse / page.keyboard / page.evaluate(() => window.__fractonica...)
  console.log(errors);                                     // must contain nothing from YOUR files
}, { viewport: { width: 1440, height: 900 } });
```

   Check at 1440×900 **and** 390×844 (mobile); at several instants: `1791460800` (2026-10-08T12:00Z, the spec's
   vector A), `946684800` (2000-01-01), `2886085800` (2061), both catalogue edges (`tMin+5`, `tMax-5`), one
   out-of-range time (`tMax+10`), live mode (no `t` param), and time-lapse (`&rate=3600`).
   Other modules may still be unfinished while you work: ignore console errors and 404s that come from files
   you do not own, but your module must be clean. The harness uses an ephemeral port, so parallel runs do not
   collide.
3. Exercise every interaction you built (click, hover, drag, wheel, keys, resize) via Playwright and confirm the
   state really changes (read it back with `page.evaluate`). Measure `render()` cost by wrapping
   `window.__fractonica.instances.<id>.render` with `performance.now()` for ~120 frames.
4. Iterate on what you see until it genuinely looks good. First drafts are never good enough.

## Report (your final message)

Return the JSON requested by the workflow: a concise `summary`, the `files` you created, the public surface you
expose (`api`), `requests` for shared files (exact change + why), `knownIssues`, and the screenshot paths you
inspected. Be honest about anything unverified or unfinished.
