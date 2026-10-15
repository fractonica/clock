# Eclipse maps of the diary (`src/diary/geo/`)

A solar eclipse's path drawn on a cubic gnomonic projection centred on the path, for the printed diary.

| file | |
|---|---|
| `saros-geo.js` | decoder of the Saros path files; `loadSarosSeries(n)`, `findSolarRecord(t, saros?)`, `sarosOf(t)` |
| `world.js` | `loadWorld()` → `{land, lakes, borders}` (rings / lines of `[lon, lat]`) |
| `eclipse-map.js` | `eclipseMapSvg({record, world, box, pal, place, pure})` → SVG markup for the diary's `Svg.add()` |
| `load.js` | reads `data/…` with `fetch` in the browser, with `node:fs/promises` in Node |
| `data/<saros>.bin` | solar eclipse paths of Saros series 101 … 173 (2 189 eclipses, 1582 – 2499), 2.3 MB |
| `data/world.json` | the base map, 70 KB |

## Data and credits

**Eclipse paths** — `data/101.bin … 173.bin` are copied unchanged from gnomonicube
(`pentalunex/gnomonicube/src/saros-geo/data/`, its `saros-geo` codec; format in that folder's README and in
`saros-geo.js`). The eclipse elements (type codes such as `Tm`, `An`, `Pb`, `T-`, `H2`; magnitude, gamma, central
duration and width, Sun altitude at greatest eclipse) and the path outlines come from NASA's eclipse predictions by
**Fred Espenak, NASA/GSFC** (*Five Millennium Canon of Solar Eclipses* / NASA Eclipse Web Site Saros catalogues).
gnomonicube does not document the exact download, so the attribution is to those predictions; please credit:
"Eclipse predictions by Fred Espenak, NASA's GSFC".

What the polygons are (checked against a local-circumstances computation with the diary's own Sun and Moon):

- **central eclipses** (`T…`, `A…`, `H…`): the closed outline of the path of totality / annularity — one limit out,
  the other back, closed at the ends by the sunrise / sunset limits (no penumbral limits);
- **partial and non-central eclipses** (`P`, `Pb`, `Pe`, `T±`, `A±`): one magnitude contour — the 0.2 step just below the
  eclipse's magnitude, at most 0.8 (0 = the limit of the penumbra) — from horizon to horizon: an open line, or a ring
  closed by a straight edge in longitude/latitude when it lies wholly in daylight;
- pieces crossing the antimeridian are split at ±180° (several polygons per record); `eclipse-map.js` stitches them.

**Base map** — [Natural Earth](https://www.naturalearthdata.com/) 1:50m land, lakes and admin-0 countries
(public domain), via gnomonicube's `map/medium/`. Built by `tools/build-diary-geo.mjs`: Douglas–Peucker on the sphere
at 0.12° (≈ 0.1 mm on the most zoomed-in map), land rings under 0.25 sq. deg and lakes under 1.2 sq. deg dropped,
borders = the edges two countries share, coordinates rounded to 0.01° and delta-encoded. Rebuild:

    node tools/build-diary-geo.mjs [/path/to/gnomonicube]

## The projection

The globe is turned so that the point of greatest eclipse is the centre of the cube's front face and the path's
principal axis (seen gnomonically from that point) runs left to right, eastward to the right (partial eclipses keep
north up). The net shows the front face, its left and right neighbours, and the faces above and below when the box is
tall; the window is centred on the greatest eclipse and scaled so the path fits (at most the three-face strip across).
Great circles are straight in a gnomonic projection, so every edge is clipped exactly against each face in 3-D and drawn
as a straight segment; everything is clipped with plain geometry (no clip paths).

Styles: total and hybrid paths a solid band (a paper-coloured centre line when wide enough), annular paths an outlined
pale band with a dashed centre line, partial contours a dashed line labelled with its magnitude. Visual check:
`node tools/probes/eclipse-map-shots.mjs [mono]` → `tools/out/eclipse-map-*.png`.
