# Diary – a printed diary of one Delta

Owner request (intent): *"Make a diary that uses this temporal engine. One sheet is 5 Helions – 3 awake, 2 asleep: 3
Helions on the front page, 2 on the back. Three 3/2 sheets and a last 2/2 sheet make 19 Helions, one solar lock. After 4
locks one more rest Helion catches up to the Nuclide (77 Helions): a page of its own, a retrospection. Then the next
Nuclide begins. One diary holds one Delta (5 Nuclides) with Delta sheets inserted. Front: 1 index (major periods and a
Gregorian index), 2 ephemeris (lunar draconic / anomalistic / synodic / sidereal months with quarters, equinoxes,
solstices, perihelion, aphelion; exact times in Gregorian and Fractonica and the page), 3 planning, 4 predictions, 5 the
first Nuclide header. The last 2 sheets are a retrospection / summary. A 5-Helion sheet: the first page has 3 sections
(Helions) of 12 lines, each line 3 Preons; the outer margin shows the major ticks with glyphs and a subtle curve of the
cycle's direction; the back maps 2 Helions with 2 canvases: a 19×7 square grid and randomly scattered dots. Gregorian
timestamps for all major thresholds; solar and lunar events at their exact place and time. The 77th Helion: one page at
much finer resolution and 2 canvas pages. Configure the format as much as possible and export a PDF of a chosen Delta."*

Vocabulary: SPEC.md §15 (major periods in words with quarter words, minor units ε η ι λ ν; Helions numbered 1–77 in their
Nuclide, Preons/Flavons/Blinks counted from 0, ordinals from 1).

Owner's fixes after the first PDF (applied): canvases default to a 19×13 square grid and a blank canvas (the 77th Helion:
blank and 385 scattered dots); cycle curves are arcs of perfect circles; the cover uses the Wave view's geometry with the
glyphs of begin/peak/node/valley/end (no labels) and three big glyphs for the phases of Alpha, Beta and Gamma; no
time-zone labels anywhere; Helions numbered from 1; the running head shows a glyph of the global Saros phase (the Helion's
number in its Alpha, 1–125 125) instead of "Lock · sheet"; an option prints two pages per sheet (two A5 pages on one A4).

Second round (applied): *"remove the circle diagram from the corner, it barely changes anyway"* – the running head keeps
the number (`91 246/125 125`) without the dial. *"Add a sheet with a detailed spec of each period, how it is derived (the
harmonic sequence), all 63 levels with periods converted to frequency where appropriate (5.55 THz). One page is the
period ladder, the other the major milestones of Alpha, Beta and Gamma, with eclipses highlighted."* – the reference
sheet below.

## Files and owners

| file | what |
|---|---|
| `src/diary/options.js` | `DIARY_DEFAULTS`, `sanitizeDiaryOptions(input, {pure})`, `PAGE_SIZES`, `CANVAS_TYPES`, `lockShape`, `rowsPerPage`, `monthsPerPage` |
| `src/diary/plan.js` | `planDiary({model, pure, opts, delta, events, zone})`, `deltaRange`, `deltaAt`, `deltaPath`, `deltaFromPath`, `gregorianDays` |
| `src/diary/reference.js` | the reference sheet's data: `ladderOf(model, t)`, `milestonesOf({model, pure, path})`; number formats `periodText`, `frequencyText`, `sci`, `bigText`, `bandOf` |
| `src/diary/astro/` | the ephemeris: `events(t0, t1, opts)` (index.js) and its maths |
| `src/diary/render.js`, `src/diary/render/` | `renderPage(plan, page, env)`, `printDocument(plan, env, {title})`, `pageTitle(plan, page)` |
| `src/ui/diary.js`, `src/ui/diary/`, `src/styles/diary.css` | the Diary tab |
| `tools/diary-pdf.mjs` | command-line PDF export |

## The plan (`planDiary`) – the contract between the parts

`planDiary` returns `{delta, opts, zone, shape, pages, helions, nuclides, majors, events, inserts, reference, days, months,
sections, index, helionAt(t), pageOf(t)}`:

- `delta` `{idx, path:[α,β,γ,δ ordinals], t0, t1, name:'Delta Trifracton', words:[Alpha …, Beta …, Gamma …, Delta …],
  stamp:'α#6 β#4 γ#9 δ#3', thresholds:[{name: begin|peak|node|valley|end, t}]}`.
- `helions[385]` `{d (0..384 in the Delta), n (Nuclide 0..4), h (0..76 in the Nuclide: an index, never printed),
  num (1..77: its number), alpha (1..125 125: its number in its Alpha), cycle, t0, t1, label:'34η', stamp:'δ#3 ε#2 34η', ticks:[{name: begin|peak|node|valley|end, t, frac}], lock (0..3 or null for the retro Helion),
  page (first page that maps it), pages, events:[…]}`.
- `nuclides[5]` `{n, name:'ε#2', t0, t1, headerPage, locks:[{k, helions:[d…], t0, t1, firstPage}], retro:[d], retroPage}`.
- `majors` `[{level 0..3, ord, name:'Gamma Nonafracton', event: begin|peak|node|valley|end, quarter:'Peak'|…|null, t}]` –
  the thresholds of Alpha … Delta inside the Delta. `quarter` is the quarter that ENDS at the threshold (SPEC §6.2: the
  Peak quarter ends at the peak), so after a 'peak' threshold the Node quarter runs.
- `events` sorted `[{t, family, name, d, frac, page, …}]`: the astro events (below), `family:'sync'` (start of solar sync
  `sync`, with `drift`) and `family:'major'` (`major`: one of `majors`), each attached to its Helion (`d`, `frac` = time
  fraction inside it) and page. Every Helion also lists its own `events`.
- `reference` (null with `front.reference` off) `{ladder, milestones, ladderPage, milestonesPage}`:
  - `ladder` = `ladderOf(model, delta.t0)`: `rows[63]` `{level, depth, text:'α1', unit:'Helion'|null, major, siblings,
    prefix (BigInt P(L)), seconds, hz, blinks (BigInt, L ≤ 12), perBlink (BigInt, L ≥ 12)}`, `interval {k, t0, t1,
    seconds}` (the eclipse interval holding the Delta: the lengths are 4 Saros / P(L) in it), `next` (level 63, π2, about
    the Planck time).
  - `milestones` = `milestonesOf(...)`: `alpha {name, t0, t1, thresholds:[{event, t, eclipse, also:[Beta and Gamma
    thresholds at the same instant]}]}`, `betas[5] {name, current, thresholds:[{event, t, eclipse}]}`, `gammas[5][13]
    {name, beta, current, t0, t1, eclipse:{k, event}|null}`, `eclipses [{k, t, event}]`. Alpha spans 4 Saros, so its five
    thresholds are the eclipses #4a … #4a+4; a Beta spans 4/5 and a Gamma 4/65 of them, so eclipse #4a+q falls on
    threshold q of Beta q+1 and on threshold q of Gamma 3q+1 of that Beta (the diagonal).
- `pages[]` `{no (1-based), side:'recto'|'verso', kind, …}`; kinds:
  - `cover` · `index {part, of, rows}` · `gregorian {part, of, months:[{y,m}]}` · `ephemeris {part, of, rows:[events]}` ·
    `ladder` · `milestones` · `planning {part, of}` · `predictions {part, of}`
  - `nuclide {n}` – the Nuclide header (a verso, facing the first Helion page)
  - `lined {sections:[{d, lines}], nuclide, lock, sheet, sheets, retro?, t0, t1}` – a sheet front, or the retro Helion
  - `canvas {sections:[{d, canvas:{type, cols, rows | count | lines}}], nuclide, lock, sheet, retro?, t0, t1}`
  - `insert {major, nuclide, lock, helion}` – a Delta sheet before the lock that holds a Delta quarter threshold
  - `summary {part, of}` · `notes {filler | insertBack | sheetBack | tail}`
- `index` rows `{kind: delta-begin|major|delta-end|nuclide|lock|retro|insert|section, t, page, …}`; `days` `[{y, m, d,
  weekday, t0, t1, page}]` (local days in `zone` that overlap the Delta; page of the Helion holding the day's start);
  `months` `[{y, m}]`; `sections` `[{title, key, page}]` for navigation.
- Rules: every lined page is a recto (a sheet front); a Nuclide header is a verso; inserts, the reference sheet (ladder
  recto, milestones on its back) and the summary start on a recto; the diary has an even page count. Default A5: 202
  pages for the Delta at SPEC vector A with the real ephemeris.

## Pages (`render.js`)

One SVG per page, `viewBox="0 0 W H"` in millimetres. Margins from `opts.page.margins`; the INNER margin is on the
left of a recto and on the right of a verso; the OUTER margin carries the time ticks. Running head (top): the Delta in
words with its quarter ("Delta Trifracton Node") · `ε#2` and the global Saros phase; the Gregorian date range of the page
in small type when Gregorian is on. Folio: the page number in the outer bottom corner. Ink: `style.ink` 'color' (level
colours from `src/core/theme.js`, toned for paper) or 'mono'; ruled lines light grey ~0.15 mm; text sizes in mm (body
~2.6 mm, small ~1.9 mm). Fonts: `style.font` sans (system-ui, Helvetica, Arial) or serif. Glyphs are the library's
2-stroke glyph paths (`F.CBT.geometry(F.CBT.fromIndex(i, {depth: 2}))`), never images.

- **Running head**: the Delta in words with its quarter and the Nuclide, and in the outer top corner the **global Saros
  phase** – the first Helion's number in its Alpha (`helion.alpha`, 1–125 125: `91 246/125 125`; the owner dropped the
  dial that drew it, it barely moves). No time-zone labels anywhere: Gregorian times are local times of the chosen zone.
- **lined** – the content height is split into the page's sections (Helions, top to bottom). Each section: a header
  line (the number `34η` large, the stamp `δ#3 ε#2 33η`, the Gregorian start–end), then `lines` ruled lines (12 → one per
  3 Preons; the retro Helion 36 → one per Preon). Inner-edge line labels per `lined.labels`: the Preon count at the line's
  start (`0ι 3ι 6ι …`) and, with 'both', the Gregorian time. Outer margin (`lined.marginGlyphs`, `lined.marginCurve`): a
  subtle curve of the Helion's wave over the section, each half-cycle an arc of a perfect circle (crest outward, trough
  inward; a full semicircle where the margin allows it, otherwise the deepest circular arc that fits), and at each quarter threshold a tick with the glyph of that state (index 4
  peak, 8 node, 12 valley, 0 end) and its Gregorian time. Events (`helion.events`) get a tick at their exact `frac` in
  the outer margin with a symbol, a short name, the Gregorian time and the Fractonica clock (`33η 29ι 21λ`).
- **canvas** – the same section headers and margin ticks/curve/events; the body of each section is its canvas: `grid`
  (cols × rows square cells, 19 × 13 by default, as large as fits), `blank` (the default second canvas), `dots` (`count` dots scattered pseudo-randomly with a
  seed from the Helion's cycle index, so a diary always prints the same), `dot-grid`, `lined`, `blank`.
- **index** – title block: the Delta in words (Alpha … Delta), its letters, when it begins and **ends** (Fractonica +
  Gregorian); then the rows: thresholds of the major periods ("Delta Trifracton · Peak ends → Node", "Gamma Nonafracton ·
  Node …"), the Nuclides, the locks (`ε#2 lock 3 · 38η–56η`), the retro Helions, the inserts and the sections, each with
  Fractonica time, Gregorian time and page.
- **gregorian** – month grids (weeks from Monday), each day of the Delta with its page number; days outside greyed.
- **ephemeris** – a table: symbol · event · Fractonica (short date down to Flavons) · Gregorian (weekday, date, time,
  zone) · page; a legend of the four months and the solar events with their definitions.
- **ladder** (the reference sheet's front) – how the hierarchy is derived (Alpha = 4 Saros; S = 5, 13, 5, 5, 7, 11, 9, 4
  repeating; P(L) = P(L−1) · S[(L−1) mod 8]; a cycle lasts 4 Saros / P(L); letters α … ω, α1 …), then one row per level
  for depths 1–63: depth · letter · unit name · factor (×) · cycles per Alpha (exact below 10¹²) · period (y d h min s, SI
  prefixes down to the yoctosecond, then scientific) · frequency below one second (SI prefixes up to yotta, `5.55 THz`,
  then `3.67 × 10³⁰ Hz`) · range (audible, radio, microwave, infrared, visible with its wavelength, ultraviolet, X-ray,
  gamma ray up to the most energetic photons observed). Each round of the sequence (levels 1–8, 9–16 …) is one band;
  a last line notes that depth 64 would be the Planck time. Pure mode: Blinks per cycle down to the Blink and cycles per
  Blink (pB) below it, both exact, instead of periods and frequencies.
- **milestones** (its back) – the Alpha holding the Delta: its five thresholds, each an eclipse (number, Gregorian time,
  the Beta and Gamma thresholds at the same instant) with "this diary" between them; the 5 Betas × begin, Peak, Node,
  Valley, End; the 13 × 5 grid of Gammas with the day each begins. Eclipse cells are tinted with `● #k` (and the quarter
  they fall on), this diary's Beta row and Gamma cell are marked. Pure mode prints positions (`pos 21`, `20.985`).
- **planning / predictions** – the Delta's frame (5 Nuclides with their dates; the Delta quarters with their thresholds)
  with writing lines.
- **nuclide** – `ε#2` large, "Nuclide 2 of Delta Trifracton", begins/ends, the locks with Helion ranges, Gregorian ranges
  and pages, the retro Helion's page, the events of the Nuclide with pages, intention lines.
- **insert** – the Delta quarter threshold: what ends and what begins, when (Fractonica + Gregorian), a four-segment bar of
  the Delta's quarters with the current one marked, the remaining thresholds with times and pages, review lines.
- **summary** – retrospection of the Delta: a block per Nuclide and per quarter, then writing space. **notes** – lines.
- **cover** (optional) – the Delta drawn in the Wave view's geometry (semicircle half-arcs with their Nuclide children),
  the glyphs of begin, peak, node, valley and end on it without labels, and three big glyphs for the phases of Alpha,
  Beta and Gamma at the Delta's start.

Pure mode (`env.pureMode`): Gregorian is off (sanitizeDiaryOptions forces it), so no Gregorian text anywhere, and the
event labels use `labelPure`. Every visible text follows SPEC §15.

`printDocument(plan, env, {title})`: a complete HTML document, `@page { size: Wmm Hmm; margin: 0 }`, one page per sheet
side, no app chrome; printing it with "Save as PDF" gives the PDF. With `opts.print.twoUp` the paper is `paperSize(opts)`
(two A5 pages on one A4 landscape page, two A6 on A5, two Half Letter on Letter) with each page centred at 1:1 in its half;
`pairing` 'spreads' prints facing pages as an open book (·|1, 2|3, …), 'sequential' 1|2, 3|4 …, 'duplex' double-sided
cut and stack (owner: *"first print odd pages, then insert them again and print even pages on the other side, so the only
thing left is to cut them in half and assemble"*). `duplexSheets`: L leaves on S = ceil(L / 2) sheets, sheet i holds leaf
i on its left half and leaf S + i on its right; the PDF alternates front [page 2i+1 | page 2(S+i)+1] and back
[page 2(S+i)+2 | page 2i+2] (turned over sideways the back of the left half is on the right). Print the odd PDF pages,
put the stack back in, print the even ones; cut along the marks; the left halves laid on the right halves are the book in
order. `turn` 'side' (default; a printer's "flip on short edge") or 'top' ("flip on long edge": the backs print rotated
180°). Default A5 at vector A: 202 pages → 51 sheets, 102 PDF pages.

## Ephemeris (`astro`)

`events(t0, t1, opts)` → events in [t0, t1) (Unix seconds, UTC), each `{t, family, name, label, labelPure, symbol}`:

| family | events | definition |
|---|---|---|
| synodic | new-moon · first-quarter · full-moon · last-quarter | geocentric apparent elongation of the Moon from the Sun = 0°, 90°, 180°, 270° |
| anomalistic | perigee · post-perigee · apogee · post-apogee | perigee/apogee = minimum/maximum Earth–Moon distance; post-perigee = the moment halfway (in time) between a perigee and the next apogee; post-apogee likewise |
| draconic | ascending-node · post-ascending · descending-node · post-descending | the Moon crosses the ecliptic northward/southward (latitude 0); post-ascending = halfway between an ascending node and the next descending node (near the northernmost point); post-descending likewise |
| sidereal | sidereal-0 · -90 · -180 · -270 | the Moon's geocentric ecliptic longitude referred to the fixed J2000 equinox = 0°, 90°, 180°, 270° |
| solar | march-equinox · june-solstice · september-equinox · december-solstice · perihelion · aphelion | the Sun's apparent longitude 0°/90°/180°/270°; Earth nearest/farthest from the Sun |

`quarters: false` drops post-* and the sidereal 90°/270°. `labelPure` never names a month ("northward equinox",
"northern solstice", "southward equinox", "southern solstice"). Accuracy targets: phases, nodes, sidereal and solar
longitudes within ~2 min; perigee/apogee within ~30 min; perihelion/aphelion within ~1 h. Algorithms: Meeus,
*Astronomical Algorithms* (ch. 47 Moon, 25/27 Sun and seasons, 38 perihelion), root-finding on the series; TT ↔ UTC with
`F.fromUTC` / `F.toUnix` (leap seconds and ΔT). It must cover any Delta of the catalogue (1613–2857) and take < 150 ms for
one Delta.

## The Diary tab (`src/ui/diary.js`)

Choose the Delta (fracton-name pickers α β γ δ, ◀ ▶, "the Delta of the shown moment"); configure every option of
`DIARY_DEFAULTS` (paper and margins, Gregorian zone, front-matter pages, the lock pattern, lines per Helion, labels, margin
glyphs and curve, canvases and their sizes, the retro Helion, inserts, event families, closing pages, ink, font); a live
preview (the current page large, spreads of verso + recto on wide screens, navigation by sections and page number,
thumbnails); **Export PDF** (prints `printDocument` in a hidden frame: the browser's "Save as PDF"); options persist in
localStorage (`fractonica.diary.v1`; the chosen Delta, page and open groups in `fractonica.diary.ui.v1`) and reset to
defaults. CSS prefix `dy-`. Pure mode: the tab speaks SPEC §15 only and Gregorian is off.

## Command line

`node tools/diary-pdf.mjs [--t <unix|ISO> | --delta <index> | --path 6,4,9,3] [--options file.json] [--zone Area/City]
[--pure] [--out diary.pdf]` (also `npm run diary -- …`) – renders `printDocument` in headless Chromium (tools/browse.mjs) and writes a vector PDF.
