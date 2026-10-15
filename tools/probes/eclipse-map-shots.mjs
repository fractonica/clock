// Visual QA of the diary's eclipse maps (src/diary/geo/eclipse-map.js): renders a few solar eclipses into A5 pages
// (two box shapes each, colour and mono palettes) and screenshots them with headless Chromium.
//   node tools/probes/eclipse-map-shots.mjs [mono]        PNGs: tools/out/eclipse-map-<name>.png
import '../../fractonica.js';
import fs from 'node:fs';
import path from 'node:path';
import { withApp, outDir } from '../browse.mjs';
import { Svg, palette, SIZE } from '../../src/diary/render/common.js';
import { findSolarRecord } from '../../src/diary/geo/saros-geo.js';
import { loadWorld } from '../../src/diary/geo/world.js';
import { eclipseMapSvg } from '../../src/diary/geo/eclipse-map.js';

const CASES = [
  ['2024-04-08', '2024-04-08T18:18:00Z', { lat: 40.71, lon: -74.01, place: 'New York' }],
  ['2026-08-12', '2026-08-12T17:46:00Z', { lat: 52.52, lon: 13.4, place: 'Berlin' }],
  ['2027-08-02', '2027-08-02T10:07:00Z', { lat: 25.69, lon: 32.64, place: 'Luxor' }],
  ['2028-01-26', '2028-01-26T15:08:00Z', null],
  ['2025-03-29-partial', '2025-03-29T10:48:00Z', { lat: 55.75, lon: 37.62, place: 'Moscow' }],
  ['2029-12-05-polar-partial', '2029-12-05T15:03:00Z', null],
  ['2021-12-04-polar-total', '2021-12-04T07:33:00Z', null],
  ['2023-04-20-hybrid', '2023-04-20T04:17:00Z', { lat: -31.95, lon: 115.86, place: 'Perth' }],
];

const mono = process.argv.includes('mono');
const pal = palette({ style: { ink: mono ? 'mono' : 'color' } });
const world = await loadWorld();
const pages = [];
for (const [name, iso, place] of CASES) {
  const rec = await findSolarRecord(Date.parse(iso) / 1000);
  if (!rec) throw new Error(`no record for ${name}`);
  const svg = new Svg(148, 250);
  svg.text(19, 18, `${name} · Saros ${rec.saros} · ${rec.type} · mag ${rec.magnitude}`, { size: SIZE.head, weight: 600 });
  const times = [];
  const boxes = [
    { x: 19, y: 24, w: 110, h: 40 },
    { x: 19, y: 70, w: 110, h: 64 },
    { x: 19, y: 140, w: 110, h: 92 },
  ];
  boxes.forEach((box, i) => {
    const t0 = performance.now();
    svg.add(eclipseMapSvg({ record: rec, world, box, pal, place: i === 2 ? null : place, pure: i === 2 }));
    times.push(performance.now() - t0);
  });
  console.log(`${name}: ${rec.datetime_utc} saros ${rec.saros} ${rec.type}; ${times.map((t) => t.toFixed(1)).join(' / ')} ms`);
  pages.push([name, svg.toString()]);
}
fs.mkdirSync(outDir, { recursive: true });
await withApp(
  async ({ page, port }) => {
    await page.goto(`http://127.0.0.1:${port}/package.json`);
    await page.setContent(`<body style="margin:0;background:#7d848b">${pages.map(([n, s]) => `<div style="padding:8px" data-n="${n}">${s.replace('<svg ', '<svg style="width:148mm;height:250mm;display:block" ')}</div>`).join('')}</body>`);
    const divs = await page.$$('div[data-n] > svg');
    for (let i = 0; i < divs.length; i++) {
      const file = path.join(outDir, `eclipse-map-${pages[i][0]}${mono ? '-mono' : ''}.png`);
      await divs[i].screenshot({ path: file });
      console.log('  ' + path.relative(process.cwd(), file));
    }
  },
  { viewport: { width: 700, height: 900 }, deviceScaleFactor: 3 },
);
