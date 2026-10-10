# Fractonica Clock

A web app for the **Fractonica clock**: an eclipse-anchored harmonic clock whose time base is the Saros 141
eclipse series (70 greatest eclipses, 1613 → 2857). It implements [`SPEC.md`](SPEC.md) on top of the reference
library [`fractonica.js`](fractonica.js) and adds three things the spec does not cover:

1. **Cycle visualisations** – see exactly where you are in every cycle, move through time, and estimate when the
   next major cycle turns over.
2. **Calendar mapping** – go from Fractonica time to Gregorian time and back.
3. **Sonification** – hear the cycles.
4. **Pure mode** – the same instrument with nothing Earthly in it: no Gregorian dates, zones, Earth time units or
   percentages; only Fractonica periods, names and glyphs.

No build step and no dependencies: static files and vanilla ES modules.

![Rings view](docs/img/rings.jpg)

<p>
<img src="docs/img/timeline.jpg" width="49%" alt="Timeline"> <img src="docs/img/calendar.jpg" width="49%" alt="Calendar mapping">
<img src="docs/img/wave.jpg" width="49%" alt="Wave"> <img src="docs/img/sound.jpg" width="49%" alt="Sound">
</p>

```bash
npm start            # serves http://localhost:5199  (PORT=8080 npm start for another port)
npm test             # node --test: spec vectors, formatting, store and every module's pure logic
npm run check        # headless-browser regression checks (needs Playwright core + Chromium, see tools/browse.mjs)
```

## What is in the app

| Area | What it does |
|---|---|
| **Clock face** (left) | The spec's watch face (SPEC §8–§10) as SVG: two period odometers (default depth 7 over depth 8), sibling counters on the rounded ends, the gold 4-day solar-sync odometer, period letters and info labels. Tap top/bottom to change depth, middle for info, double tap for letters. Hover any glyph for a plain-language reading. |
| **Rings** | Concentric dial, outermost = longest cycle. Each ring shows its phase, its sectors (the next level's cycles), quarter marks (peak / node / valley / end) and a funnel into the next ring. The centre counts down to the end of the selected cycle; click sectors to travel; a waveform inset explains peak/node/valley and scrubs inside the cycle. |
| **Timeline** | Zoomable, pannable multi-scale timeline from the whole catalogue (the 70 eclipses) down to seconds, with the Gregorian axis on top and one lane of cycle blocks per depth. Presets, follow mode, hover read-out, "fit this cycle". |
| **Wave** | The library's circular harmonic geometry as a "you are here" map with one marker per level, zoomable to any depth. |
| **Calendar** | Two-way converter (Gregorian date/time/zone/Unix ⇄ Saros position, cycle address, glyph states, solar sync) and a Gregorian month calendar whose day cells show cycle boundaries at their exact time of day, plus a year ribbon. |
| **Sound** | The harmonic hierarchy as a just-intonation chord (loudness follows each cycle's phase), chimes at peak / node / valley / end where a major boundary rings as a chord of every level that turns over together, time-lapse and tempo lock, and "hear this moment". |
| **Cycle ladder / Up next** (right) | One row per depth with progress, counter and time left; the next turnovers of the cycles you care about with live countdowns. |
| **Header** | Live Gregorian time and Saros position, a jump box (`/` to focus: `2031-06-01 14:30 Moscow`, `+3d`, `α#6 β#3 γ#11`, `pos 24.5`, `sync 4820`, `next ε`…), transport (previous / next cycle, time-lapse ×1 … ×31.6 M, back to live), time zone, link to this moment, sound. |

Time travel is global: every view shows the same displayed time, whether it is the device clock (**LIVE**), a chosen
instant, or a time-lapse. The catalogue ends are respected; nothing is extrapolated.

### Pure mode

Press **P** (or the glyph button in the header, or open `?pure=1`) and the clock stops translating. Everything is said in
Fractonica terms:

- **Where you are**: the header clock counts completed η, ι, λ inside the current ζ (`0η 29ι 21λ`); the date line is the
  cycle address (`α#6 β#4 γ#9 · δ#3 · ε#4 · ζ#7`). Cycles have names: `Gamma Difracton` is the 2nd γ inside its β
  (Mono-, Di-, Tri-, Tetra-, Penta-, Hexa-, Hepta-, Octa-, Nona-, Deca-, Didecafracton, Dodeca-, Trideca- … fracton).
- **How long**: spans are counted in Fractonica periods only: `1ζ 4η 24ι`, `6ι 3κ`. Every depth is one unit, a whole
  cycle of that depth, and the units from depth 4 have names:

  | | δ | ε | ζ | **η** | θ | **ι** | κ | **λ** | μ | **ν** |
  |---|---|---|---|---|---|---|---|---|---|---|
  | unit | Atom | Nuclide | Hadron | **Helion** | Quark | **Preon** | Chromon | **Flavon** | Somon | **Blink** |
  | depth | 4 | 5 | 6 | **7** | 8 | **9** | 10 | **11** | 12 | **13** |

  1γ = 5δ, 1δ = 5ε, 1ε = 7ζ, 1ζ = 11η, 1η = 9θ, 1θ = 4ι, 1ι = 5κ, 1κ = 13λ, 1λ = 5μ, 1μ = 5ν. The atomic steps are
  1η = 36ι, 1ι = 65λ, 1λ = 25ν; 19 Helions lock to the sun. Below a Blink a span is a decimal (`0.14ν`).
- **How far through a cycle**: two 2-stroke glyphs (16 × 16 = 256 states) instead of a percentage.
- **How fast**: real time is counted in **Blinks** (one ν cycle). Time-lapse speeds are units per Blink: `η per Blink`,
  `2.25θ per Blink`; "real time" is one Blink per Blink. A frequency is cycles per Blink, **pB**, instead of Hz: the true
  rates of the deepest cycles come out as whole numbers (7, 77, 693, 2 772 pB).
- **Navigation** keeps working: the timeline gets a ruler of cycle units, the Calendar tab becomes a pure converter and a
  month page of 5 rows × 7 cells (one δ: 5 ε × 7 ζ), the jump box takes names, addresses, `pos`, `sync` and offsets like
  `+2ζ 3η` or `+4 Blinks`.
- Press **?** for the in-app glossary.

The mode is presentation only: the clock still runs on the device time underneath, and switching back and forth is live.
Design notes: [`docs/design/80-pure.md`](docs/design/80-pure.md).

<p>
<img src="docs/img/pure-rings.jpg" width="49%" alt="Pure mode: rings"> <img src="docs/img/pure-timeline.jpg" width="49%" alt="Pure mode: timeline with the pure ruler">
<img src="docs/img/pure-calendar.jpg" width="49%" alt="Pure mode: converter and month page"> <img src="docs/img/wave-solar.jpg" width="49%" alt="Wave view with the yellow solar wave">
</p>

### The solar wave

In the Wave view, the **Solar** button adds a yellow wave for the solar sync (19 η ≈ 4 days): a marker at the current sync
phase with its four quarter ticks, and a ripple of one sync wavelength along the focused arc where it fits (`?solar=1`).

### Reading the labels

`ε 5` is a **depth chip** (ε is always depth 5, an ≈16-day cycle). `ε#5` is the **5th ε inside its parent δ**, and
`α#6 › β#4 › γ#9` is a cycle address. `d7#717211` is the global index of a depth-7 cycle. Glyph states use the spec's
0-based index (`13 of 0–15`).

### Keyboard

`Space` play/pause time-lapse · `N` back to live · `[` / `]` previous / next cycle of the selected level ·
`1`…`5` switch view · `M` sound on/off · `P` pure mode · `?` pure glossary · `/` or `Ctrl/⌘+K` jump box · face: `↑` `↓` depth, `I` info, `L` letters.

### Deep links

`index.html?t=<unix seconds | ISO with zone> | pos=<Saros position>&view=rings|timeline|wave|calendar|sound&zone=<IANA>&rate=<n>&depth=<top depth>&sel=<selected depth>&pure=1&solar=1`
— e.g. `?t=1791460800&view=timeline&zone=UTC` is the spec's test vector A (2026-10-08T12:00:00Z). The header link
button copies a link to the displayed moment (a `?pos=` link in pure mode).

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module contract. In short:

```
src/core/model.js   the only code that talks to fractonica.js (checked against SPEC §12 vectors)
src/core/store.js   displayed time (live / travel / time-lapse) + shared settings
src/core/format.js  zone-aware Gregorian formatting and conversion
src/ui/*.js         one module per UI region: face, rings, ladder, upnext, timeline, wave, calendar, jump, sound
src/audio/*.js      tuning, scheduler and Web Audio engine
docs/design/*.md    the design brief behind each module (intent, interaction, edge cases)
tools/              headless-Chromium harness, regression checks (`npm run check`) and screenshot probes (not needed to run the app)
```

`fractonica.js` is used as delivered. Times are Unix seconds (SPEC §2.1): the app feeds the device clock straight in,
with the library's precomputed Unix catalogue.
