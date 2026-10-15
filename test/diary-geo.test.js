/**
 * The diary's eclipse maps: the Saros path decoder (src/diary/geo/saros-geo.js) against gnomonicube's own decoder, the
 * record lookup, the base map (world.js) and the map renderer (eclipse-map.js): valid markup inside its box, the point
 * of greatest eclipse at the centre, labels that never overlap, deterministic and fast.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import '../fractonica.js';
import { decodeSeries, loadSarosSeries, findSolarRecord, sarosOf, SAROS_MIN, SAROS_MAX, CONTOUR_TYPES } from '../src/diary/geo/saros-geo.js';
import { loadWorld } from '../src/diary/geo/world.js';
import { eclipseMapSvg, eclipseGeometry, eclipseMapFrame, stitch } from '../src/diary/geo/eclipse-map.js';
import { palette, measure } from '../src/diary/render/common.js';

const DATA = new URL('../src/diary/geo/data/', import.meta.url);
const GNOMONICUBE = '/Users/dimas/projects/pentalunex/gnomonicube/src/saros-geo/saros_geo.js';
const t = (iso) => Date.parse(iso) / 1000;
const pal = palette({ style: { ink: 'color' } });
const mono = palette({ style: { ink: 'mono' } });

test('the vendored data: 73 series files and a small base map', () => {
  for (let s = SAROS_MIN; s <= SAROS_MAX; s++) assert.ok(fs.existsSync(new URL(`${s}.bin`, DATA)), `${s}.bin`);
  const size = fs.statSync(new URL('world.json', DATA)).size;
  assert.ok(size < 300 * 1024, `world.json ${size} B`);
});

test('decoder: the same records as gnomonicube\'s saros_geo.js', { skip: !fs.existsSync(GNOMONICUBE) && 'gnomonicube not checked out' }, async () => {
  const ref = await import(pathToFileURL(GNOMONICUBE).href);
  for (const s of [101, 126, 139, 141, 173]) {
    const bytes = fs.readFileSync(new URL(`${s}.bin`, DATA));
    const ours = decodeSeries(bytes).map(({ unix_time, ...r }) => {
      assert.equal(ref.datetimeFromUnix(unix_time), r.datetime_utc);
      return r;
    });
    assert.deepEqual(ours, ref.decodeSeries(bytes), `Saros ${s}`);
  }
});

test('loadSarosSeries: memoised, numbered, and the Saros number follows from the date for every record', async () => {
  const a = await loadSarosSeries(139);
  assert.equal(a, await loadSarosSeries(139));
  assert.ok(a.every((r, i) => r.saros === 139 && r.position === i && Number.isInteger(r.unix_time)));
  await assert.rejects(loadSarosSeries(100));
  let n = 0;
  for (let s = SAROS_MIN; s <= SAROS_MAX; s++) {
    for (const r of await loadSarosSeries(s)) {
      assert.equal(sarosOf(r.unix_time), s, `${r.datetime_utc}`);
      n++;
    }
  }
  assert.ok(n > 2000);
});

test('findSolarRecord: the eclipses of 2024-04-08, 2026-08-12, 2028-01-26', async () => {
  const cases = [
    ['2024-04-08T18:17:00Z', 139, 'T', '2024-04-08 18:18:29'],
    ['2026-08-12T17:46:00Z', 126, 'T', '2026-08-12 17:47:06'],
    ['2028-01-26T15:08:00Z', 141, 'A', '2028-01-26 15:08:59'],
  ];
  for (const [iso, saros, type, dt] of cases) {
    for (const r of [await findSolarRecord(t(iso)), await findSolarRecord(t(iso), saros)]) {
      assert.equal(r?.saros, saros, iso);
      assert.equal(r.type, type);
      assert.equal(r.datetime_utc, dt);
    }
  }
  // 2024-04-08 is a total eclipse at 25.3°N 104.1°W, 198 km wide
  const r = await findSolarRecord(t('2024-04-08T18:18:29Z'));
  assert.deepEqual([r.latitude, r.longitude, r.central_width_km], [25.3, -104.1, 198]);
  // a wrong series number still finds it; a time far from any eclipse finds nothing
  assert.equal((await findSolarRecord(t('2024-04-08T18:18:29Z'), 120))?.saros, 139);
  assert.equal(await findSolarRecord(t('2024-04-08T21:00:00Z')), null);
  assert.equal(await findSolarRecord(t('2025-06-01T00:00:00Z')), null);
});

test('loadWorld: land, lakes and borders in degrees', async () => {
  const w = await loadWorld();
  assert.equal(w, await loadWorld());
  assert.ok(w.land.length > 100 && w.borders.length > 100 && w.lakes.length > 5);
  for (const layer of [w.land, w.lakes, w.borders]) {
    for (const line of layer) for (const [lon, lat] of line) assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
  }
});

test('stitch: pieces split at the antimeridian become one ring / one line', async () => {
  // a ring cut along ±180°
  const left = [[170, 0], [180, 0], [180, 10], [170, 10], [170, 0]];
  const right = [[-180, 0], [-170, 0], [-170, 10], [-180, 10], [-180, 0]];
  const s = stitch([left, right]);
  assert.equal(s.rings.length, 1);
  assert.equal(s.lines.length, 0);
  assert.equal(s.rings[0].length, 6);
  // a contour crossing twice (Saros 163 #3, 2340-04-27: three pieces)
  const rec = (await loadSarosSeries(163))[3];
  assert.equal(rec.geometry.coordinates.length, 3);
  const g = eclipseGeometry(rec);
  assert.equal(g.kind, 'partial');
  assert.equal(g.lines.length + g.rings.length, 1);
  assert.equal(g.level, 0.2);
  // the split total eclipse of Saros 164 #22 (2495-06-23)
  const tot = eclipseGeometry((await loadSarosSeries(164))[22]);
  assert.equal(tot.kind, 'total');
  assert.equal(tot.rings.length, 1);
  assert.ok(tot.centre?.length > 10);
});

// ---- the map ---------------------------------------------------------------------------------------------------------

const attr = (a, k) => a.match(new RegExp(`\\s${k}="([^"]*)"`))?.[1];
function texts(svg) {
  return [...svg.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].map((m) => {
    const a = m[1];
    const s = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const size = Number(attr(a, 'font-size'));
    const w = measure(s, size, { weight: Number(attr(a, 'font-weight') ?? 400) });
    const x = Number(attr(a, 'x'));
    const y = Number(attr(a, 'y'));
    const anchor = attr(a, 'text-anchor') ?? 'start';
    const x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    return { s, x0, x1: x0 + w, y0: y - size * 0.74, y1: y + size * 0.2 };
  });
}

function check(svg, box) {
  const bad = [];
  if (/NaN|undefined|Infinity|\[object/.test(svg)) bad.push('bad value');
  if (/<image|<foreignObject|<script|url\(|href=|<svg/.test(svg)) bad.push('non-vector, external or nested content');
  const open = (svg.match(/<(text|tspan|g)\b/g) ?? []).length;
  const close = (svg.match(/<\/(text|tspan|g)>/g) ?? []).length;
  if (open !== close) bad.push(`unbalanced ${open}/${close}`);
  const e = 0.02;
  const inX = (x) => x >= box.x - e && x <= box.x + box.w + e;
  const inY = (y) => y >= box.y - e && y <= box.y + box.h + e;
  for (const m of svg.matchAll(/ d="([^"]*)"/g)) {
    for (const p of m[1].matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) if (!inX(+p[1]) || !inY(+p[2])) bad.push(`path point ${p[1]},${p[2]} outside`);
  }
  for (const m of svg.matchAll(/<(circle|rect)([^>]*)>/g)) {
    const x = Number(attr(m[2], m[1] === 'circle' ? 'cx' : 'x'));
    const y = Number(attr(m[2], m[1] === 'circle' ? 'cy' : 'y'));
    if (!inX(x) || !inY(y)) bad.push(`${m[1]} outside`);
  }
  const ts = texts(svg);
  for (const q of ts) if (q.x0 < box.x || q.x1 > box.x + box.w || q.y0 < box.y || q.y1 > box.y + box.h) bad.push(`text "${q.s}" outside`);
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const [p, q] = [ts[i], ts[j]];
      if (p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1) bad.push(`overlap "${p.s}" × "${q.s}"`);
    }
  }
  return bad;
}

const DATES = ['2024-04-08T18:18Z', '2026-08-12T17:47Z', '2027-08-02T10:08Z', '2028-01-26T15:09Z', '2025-03-29T10:48Z', '2029-12-05T15:04Z', '2021-12-04T07:34Z', '2023-04-20T04:17Z', '2003-05-31T04:09Z', '2014-04-29T06:04Z'];
const BOXES = [
  { x: 19, y: 30, w: 110, h: 40 },
  { x: 14, y: 100, w: 110, h: 64 },
  { x: 20, y: 40, w: 110, h: 92 },
  { x: 10, y: 10, w: 60, h: 60 },
];

test('eclipseMapSvg: clean markup inside the box, greatest eclipse at the centre, no label overlaps', async () => {
  const world = await loadWorld();
  for (const iso of DATES) {
    const record = await findSolarRecord(t(iso));
    assert.ok(record, iso);
    for (const box of BOXES) {
      for (const [p, place] of [[pal, { lat: 52.52, lon: 13.4, place: 'Berlin' }], [mono, null]]) {
        const svg = eclipseMapSvg({ record, world, box, pal: p, place });
        assert.deepEqual(check(svg, box), [], `${iso} ${JSON.stringify(box)}`);
        // the marker of greatest eclipse: the first circle, at the centre of the box
        const c = svg.match(/<circle cx="([\d.]+)" cy="([\d.]+)"/);
        assert.ok(Math.abs(+c[1] - (box.x + box.w / 2)) < 0.02 && Math.abs(+c[2] - (box.y + box.h / 2)) < 0.02, `${iso}: centre`);
        assert.ok(svg.includes(p.eclipse), 'the path is drawn');
      }
    }
  }
});

test('eclipseMapSvg: the path runs left to right through the centre; north up for a partial eclipse', async () => {
  const box = { x: 0, y: 0, w: 110, h: 50 };
  for (const iso of ['2024-04-08T18:18Z', '2027-08-02T10:08Z', '2028-01-26T15:09Z']) {
    const record = await findSolarRecord(t(iso));
    const geo = eclipseGeometry(record);
    const fr = eclipseMapFrame({ record, box, geo });
    // the centre line seen on the map: it spreads much more across than up and down, and eastward is to the right
    const pts = geo.centre.map((v) => {
      const lat = (Math.asin(v[2]) * 180) / Math.PI;
      const lon = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
      return fr.toPage(lon, lat);
    }).filter(Boolean);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    assert.ok(Math.max(...xs) - Math.min(...xs) > 3 * (Math.max(...ys) - Math.min(...ys)), `${iso}: horizontal`);
    const a = fr.toPage(record.longitude - 1, record.latitude);
    const b = fr.toPage(record.longitude + 1, record.latitude);
    assert.ok(b[0] > a[0], `${iso}: east to the right`);
  }
  const partial = await findSolarRecord(t('2025-03-29T10:48Z'));
  const fr = eclipseMapFrame({ record: partial, box });
  const s = fr.toPage(partial.longitude, partial.latitude - 2);
  const n = fr.toPage(partial.longitude, partial.latitude + 2);
  assert.ok(n[1] < s[1] && Math.abs(n[0] - s[0]) < 0.01, 'north up');
});

test('eclipseMapSvg: styles by type, partial contour labelled, pure-safe, deterministic and fast', async () => {
  const world = await loadWorld();
  const box = { x: 19, y: 30, w: 110, h: 60 };
  const total = await findSolarRecord(t('2024-04-08T18:18Z'));
  const annular = await findSolarRecord(t('2028-01-26T15:09Z'));
  const partial = await findSolarRecord(t('2025-03-29T10:48Z'));
  assert.ok(CONTOUR_TYPES.has(partial.type));
  const sT = eclipseMapSvg({ record: total, world, box, pal });
  const sA = eclipseMapSvg({ record: annular, world, box, pal });
  const sP = eclipseMapSvg({ record: partial, world, box, pal, pure: true, place: { lat: 45.5, lon: -73.57, place: 'Montréal' } });
  assert.ok(sT.includes(`fill="${pal.eclipse}"`), 'total: a solid band');
  assert.ok(sA.includes(`fill="${pal.eclipseSoft}"`) && sA.includes(`stroke="${pal.eclipse}"`), 'annular: an outlined band');
  assert.ok(sP.includes('stroke-dasharray="1.1 0.55"'), 'partial: a dashed contour');
  assert.ok(texts(sP).some((x) => x.s === '0.8'), 'the contour level');
  assert.ok(texts(sP).some((x) => x.s === 'Montréal'), 'the place');
  // degrees only: no month or weekday names, no clock times or Earth time units
  for (const svg of [sT, sA, sP]) {
    for (const { s } of texts(svg)) {
      assert.match(s, /^(Equator|0\.\d|Montréal|\d{1,3}°[NSEW]?)$/, s);
    }
  }
  assert.equal(eclipseMapSvg({ record: total, world, box, pal }), sT, 'deterministic');
  // no geometry at all: centred on the greatest eclipse, still a map
  const bare = { ...partial, geometry: { type: 'MultiPolygon', coordinates: [] } };
  assert.deepEqual(check(eclipseMapSvg({ record: bare, world, box, pal }), box), []);
  const t0 = performance.now();
  for (const r of [total, annular, partial]) eclipseMapSvg({ record: r, world, box: { x: 0, y: 0, w: 110, h: 90 }, pal });
  const ms = (performance.now() - t0) / 3;
  assert.ok(ms < 100, `${ms.toFixed(1)} ms per map`);
});
