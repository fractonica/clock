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

Third round (applied): *"call 5 Helions a Pentad (3 + 2) and the 4th one a Semi-pentad with 4 blank canvases; each major
period page from the Semi-pentad up refers to the previous and next such page (page number and arrow) on the edge, each
reference at its own height, and regular pages to the previous and next page with the same Helion number; Helion 77 gets
a 7×11 grid with small numbers in the corners to mark each Helion, Semi-pentads distinguished, with the ephemeris marks;
fill the ephemeris's second page with more events; Sun rise/noon/set and Moon rise/culmination/set for a place, mapped
on the pages: the rules split at a vertical horizon, the Sun on odd lines and the Moon on even lines (left below, right
above), rises and sets in the gap; on canvases their trajectories on the side opposite the wave."* Owner's choices: the
Semi-pentad is all canvases; the references are a thumb index; the default place is the zone's city (Moscow); the
ephemeris adds lunistices, cross-quarters, eclipses and planets.

Fourth round (applied): *"make an emphasis on eclipses: a Helion that gets an eclipse gets 4 pages (2 sheets). Page 1: the
eclipse in detail with the path of totality on a map – a cubic gnomonic projection centred on the path, from
gnomonicube – over half the page, and its Saros family (next, previous …); page 2: every eclipse of the series with its
Fractonica address; page 3: the Helion with the complete timeline (first contact, maximum …) divided by Preons and
Flavons; page 4: a blank canvas. A lunar eclipse gets the usual diagram of how much of the Moon is covered."*

Fifth round (applied): Sun and Moon marks without words – a rise or set is a mark on the horizon, a culmination a
square at its altitude – and `sky.dot` sets their size; every event is said on its own dashed rule across the body like
the Delta thresholds ("○ Full Moon · 06:19 · 69η 19ι 22λ"), with a white backing, the rule stopping short of the line
labels (the outer margin keeps only the event's tick); the sidereal month is measured against the galactic centre (Sgr
A*, λ 266.84° J2000): galactic centre, post-centre, galactic anticentre, post-anticentre; the running head shows the
Delta's phase at the page's first Helion as two big 2-stroke glyphs in its middle (the "/125 125" is gone, each side
keeps to its half); no text on an A5 page is smaller than about 1.45 mm (4.1 pt).

## Eclipses

`inserts.eclipses` (needs `events.eclipses`): each eclipse of the Delta gets two sheets right before the sheet that
holds its Helion (the Helion keeps its regular page too):

| page | side | what |
|---|---|---|
| `eclipse` | recto | the name, the Fractonica stamp and Gregorian moment, Saros n · member of count, magnitude, γ; over the top half the figure – solar: the path on a gnomonic cube net (`src/diary/geo/eclipse-map.js`: the globe turned so that greatest eclipse is the centre of the front face and the path runs left to right; front, left, right, top and bottom faces; land, borders, lakes, graticule, the path band, greatest eclipse, the diary's place), lunar: the Moon at each contact crossing the penumbra and umbra (north up, east left); then greatest eclipse (where, solar altitude, duration, path width / magnitudes and phase durations), the global contacts, what the place sees (kind, magnitude, obscuration, local contacts with the solar altitude / the lunar altitude at each contact), and the Saros neighbours (previous, next, first, last) |
| `saros` | verso | every member of the series in two columns: number, date (normal mode), type, Fractonica address (`—` beyond the catalogue), the page when it is in this diary; this eclipse highlighted. Saros 141 is noted as the clock's own series |
| `eclipse-helion` | recto | the Helion on one page, 36 lines (a line per Preon) with the sky; in the inner margin a Flavon ruler (a tick every 13λ, longer at each Preon and 9ι) and bars of the eclipse phases (solar P1–P4, U1–U4; lunar P1–P4, U1–U4, U2–U3); each contact inside the Helion a dashed rule at its moment, a label (name, Gregorian time, Fractonica clock) with a picture of the discs at that moment (the Sun and the Moon over the place, or the Moon in the shadow), labels dodged so they never overlap; contacts outside the Helion listed at its top (↑ before) or bottom (↓ after); the sky's rises and sets join the same list |
| `canvas` | verso | a blank canvas for the Helion |

Data: `plan.eclipses` `[{ev, detail, local, saros, geo, d, page, pages}]` from `createEclipseCache()` in
src/ui/diary/build.js – `detail` / `local` / `saros` from src/diary/astro/eclipse-detail.js (`solarDetail`, `solarLocal`,
`lunarDetail`, `lunarVisibility`, `sarosOf`: Besselian-style shadow geometry on moon.js / sun.js; checked against NASA's
catalogues 1701–2200: Saros numbers exact, contacts within seconds, greatest point within 0.2°, widths 1.4 km rms,
durations within 0.8 s), `geo` the eclipse's record in src/diary/geo/data/<saros>.bin (NASA predictions by F. Espenak,
via gnomonicube's saros-geo; 1582–2499) and `plan.world` (src/diary/geo/data/world.json, Natural Earth 1:50m simplified
to 71 KB). The path data and the map load asynchronously: `buildDiary` returns `pending` until they are in, and the Diary
tab and the PDF export build again when it settles. Index rows `kind: 'eclipse'`; edge references `eclipse` (between
the eclipse pages). Pure mode: Fractonica times only, local contacts spelled "1st contact" …

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
  - `lined {sections:[{d, lines}], nuclide, lock, sheet, sheets, unit, unitNo, retro?, t0, t1}` – a sheet front, or the
    retro Helion. `unit` 'pentad' (a sheet of 5 Helions, `unitNo` 1–3 in its lock) | 'semi' (4 Helions) | 'sheet'.
    A Semi-pentad with `semi.allCanvas` is two canvas pages (front a recto, `semiSide` 'front' / 'back'), 2 Helions each,
    canvases from `semi.canvases`.
  - every Helion page, Nuclide header and Delta sheet carries `nav` `[{kind, label, prev, next}]` (`navigate()`): the
    thumb index. Kinds: `helion` (the page of the same Helion number one Nuclide earlier / later, same page kind),
    `semi` (Semi-pentad fronts with fronts, backs with backs), `lock` (first pages of the solar locks), `retro` (each
    page of the 77th Helion with the same page of the other Nuclides), `nuclide`, `insert`.
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
- **Thumb index** (`opts.nav.on`): a 6 mm strip along the outer paper edge (`frameOf().navW`; the margin labels keep
  the rest of the outer margin, which is 20 mm by default, the inner 16 mm). One tab per reference, turned to read down
  the edge – `‹ 37 · 5η · 191 ›` – at the fixed height of its kind (`NAV_SLOTS`: Nuclide 6 %, Delta sheet 21 %, lock
  37 %, Semi-pentad 53 %, 77th Helion 69 %, Helion 86 % of the content height), tinted in its level's colour to the
  paper edge; the text stays ≥ 4.4 mm from the edge (the unprintable rim).
- **The local sky** (`opts.sky`, `plan.sky` = src/diary/astro/sky.js `skyOf` over `places.js placeOf(opts, zone)`: the
  options' coordinates, else the zone's main city). Lined sections: every rule breaks for 1.8 mm at the middle of the
  writing area; the gaps line up into a vertical horizon. On rule j (its moment is j/lines of the Helion) the Sun (odd
  j, a filled amber dot) or the Moon (even j, a ring) sits at its altitude: left of the horizon below it, right above,
  ±90° at ±half the width. Rises and sets are larger marks on the horizon at their exact moment, culminations at their
  altitude, each with its time ("rise 05:50", "noon 13:11"; pure mode "culmination 29ι 47λ"). Canvas sections: in the
  inner margin, the horizon (a vertical line), the Sun's altitude (solid) and the Moon's (dotted) over the Helion.
- **canvas** – the same section headers and margin ticks/curve/events; the body of each section is its canvas: `grid`
  (cols × rows square cells, 19 × 13 by default, as large as fits), `blank` (the default second canvas), `dots` (`count` dots scattered pseudo-randomly with a
  seed from the Helion's cycle index, so a diary always prints the same), `dot-grid`, `lined`, `blank`, and
  `nuclide-grid` (the 77th Helion's second canvas by default): the Nuclide's 77 Helions as 7 columns (one per ζ of 11
  Helions) × 11 rows, numbered 1–77 down the columns in the cells' top-left corners, Semi-pentad cells tinted, the
  77th outlined, each cell's bottom-right corner carrying the symbols of that Helion's ephemeris events.
- **index** – title block: the Delta in words (Alpha … Delta), its letters, when it begins and **ends** (Fractonica +
  Gregorian); then the rows: thresholds of the major periods ("Delta Trifracton · Peak ends → Node", "Gamma Nonafracton ·
  Node …"), the Nuclides, the locks (`ε#2 lock 3 · 38η–56η`), the retro Helions, the inserts and the sections, each with
  Fractonica time, Gregorian time and page.
- **gregorian** – month grids (weeks from Monday), each day of the Delta with its page number; days outside greyed.
- **ephemeris** – a table: symbol · event · Fractonica (short date down to Flavons) · Gregorian (weekday, date, time,
  zone) · page; a legend of the event families with their definitions. Rows may pack up to 30 % tighter than
  `rowsPerPage` when that saves a page (the default Delta's 63 events fill two pages).
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

`events(t0, t1, opts)` → events in [t0, t1) (Unix seconds, UTC), each `{t, family, name, label, labelPure, symbol, jde}`
plus, where they apply, `dist` (perigee/apogee km, perihelion/aphelion AU, planet events AU), `dec` (lunistices, degrees),
`kind` / `magnitude` / `gamma` (eclipses) and `elongation` (greatest elongations, degrees):

| family | events | definition |
|---|---|---|
| synodic | new-moon · first-quarter · full-moon · last-quarter | geocentric apparent elongation of the Moon from the Sun = 0°, 90°, 180°, 270° |
| anomalistic | perigee · post-perigee · apogee · post-apogee | perigee/apogee = minimum/maximum Earth–Moon distance; post-perigee = the moment halfway (in time) between a perigee and the next apogee; post-apogee likewise |
| draconic | ascending-node · post-ascending · descending-node · post-descending | the Moon crosses the ecliptic northward/southward (latitude 0); post-ascending = halfway between an ascending node and the next descending node (near the northernmost point); post-descending likewise |
| sidereal | sidereal-0 · -90 · -180 · -270 | the Moon's geocentric ecliptic longitude referred to the fixed J2000 equinox = 0°, 90°, 180°, 270° |
| lunistice | moon-north △ · moon-south ▽ | the Moon's greatest geocentric apparent declination north/south (λ + Δψ, β → δ with the true obliquity); label "Moon farthest north 28.4°" |
| solar | march-equinox · june-solstice · september-equinox · december-solstice · perihelion · aphelion · cross-quarter-45 · -135 · -225 · -315 ⊗ | the Sun's apparent longitude 0°/90°/180°/270°; Earth nearest/farthest from the Sun; cross-quarters: apparent longitude 45°/135°/225°/315° ("Cross-quarter 45°") |
| eclipse | solar-eclipse ◍ · lunar-eclipse ◕ | greatest eclipse; `kind` total · annular · hybrid · partial (solar), total · partial · penumbral (lunar); label "Total solar eclipse", "Penumbral lunar eclipse" |
| planet | mercury-/venus- elongation-east · elongation-west · inferior-conjunction · superior-conjunction; mars-/jupiter-/saturn- opposition · conjunction (☿ ♀ ♂ ♃ ♄) | greatest elongation = a maximum of the angular distance from the Sun, east (evening) or west (morning), label "Mercury east elongation 18.4°"; conjunction/opposition = geocentric apparent ecliptic longitude equal to / 180° from the Sun's (inferior: the planet nearer than the Sun) |

Flags (`options.events`, all default true): synodic, anomalistic, draconic, sidereal, quarters, solar, lunistices,
crossQuarters (the cross-quarters alone), eclipses, planets. `quarters: false` drops post-* and the sidereal 90°/270°.
`labelPure` never names a month ("northward equinox", "northern solstice", "southward equinox", "southern solstice") nor
"Sun"; every pure label passes the hard rules of tools/pure-scan.mjs (tested). Families sort in the order above when
two events share an instant.

Algorithms: Meeus, *Astronomical Algorithms* (ch. 47 Moon, 25/27 Sun and seasons, 38 perihelion, 22 nutation, 54
eclipses), root-finding on the series; TT ↔ UTC with `F.fromUTC` / `F.toUnix` (leap seconds and ΔT).
- Eclipses (eclipses.js): Meeus 54 finds the candidates (|sin F| ≤ 0.36), its time and u; greatest eclipse is then refined
  on the Moon and Sun series as the least distance of the shadow axis from the Earth's centre (solar) or of the Moon from
  the axis of the Earth's shadow (lunar), Espenak's definition; γ from that geometry. Solar type by Meeus' criteria
  (central |γ| < 0.9972: total u < 0, annular u > 0.0047, else hybrid when u < 0.00464 √(1 − γ²)); magnitude from
  Meeus' formula for partial eclipses, the Moon/Sun apparent diameter ratio for central ones. Lunar type and magnitudes
  from the shadow geometry with Chauvenet's 2 % enlargement (as the NASA catalogues).
- Planets (planets.js): VSOP87D truncated per planet (vsop87.js, generated from the original VSOP87D files; truncation
  error ≤ 2.7" in geocentric longitude over the catalogue range), the Earth from sun.js, light-time and annual aberration;
  oppositions/conjunctions of the outer planets by angle crossings of λ☉ − λ, the inner planets' conjunctions by sign
  changes of λ − λ☉, greatest elongations by sign changes of the elongation's rate.

Accuracy (measured; the tests keep samples): phases, nodes, sidereal and solar longitudes within ~2 min;
perigee/apogee within ~30 min; perihelion/aphelion within ~1 h; lunistices within 0.8 min and 3" of DE440 (Skyfield),
cross-quarters within 0.9 min; eclipses against F. Espenak's NASA catalogues 1701–2200 – solar: all 1180 found, greatest
eclipse within 0.3 min (TD), γ within 0.0044, 8 types differ at the hybrid/total/annular or annular/partial boundaries,
3 extra partials of magnitude < 0.01; lunar: all 1210 found, no extra, every type right, within 0.94 min, magnitudes within
0.0024; planets against DE440 (371 events in 1620–2604): Mercury within 0.9 min, Venus 2.0, Mars 3.0, Jupiter and Saturn
0.9, elongation angles within 1". It must cover any Delta of the catalogue (1613–2857) and take < 150 ms for one Delta
(≈ 25 ms in Node with every family).

The ephemeris page's legend has one entry per enabled family (lunar months, the tropical month for the lunistices, solar
events with the cross-quarters, eclipses, planets); with every family on it is about 65 mm high (13 table rows of 5.4 mm).

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
